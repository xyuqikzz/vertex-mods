import { attachInstallPlanConfirmation, confirmAgentTool } from './agent/confirmationService.js'
import { statSync } from 'node:fs'
import store from '../../storage/store/index.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import path from 'node:path'
import {
  createCompatibleAiClient,
  getCompatibleAiConfigStatus,
  listCompatibleAiModels
} from './compatibleAiClient.js'
import { listAiAgentSkills } from './skillRegistry.js'
import { listAiAgentTools } from './toolRegistry.js'
import {
  getSourceInstallTaskDetail,
  getSourceInstallTaskSummary,
  listSourceInstallTasks
} from '../../ipc/game/source-install-task/orchestrator.js'
import { getModSourceDetail, searchModSource } from '../mod-source/index.js'
import {
  normalizeAiAgentToolCall,
  parseAiAgentToolCalls
} from '../../../shared/ai/tools/ai-agent-tool-call-parser.js'
import { normalizeAiAgentToolName } from '../../../shared/ai/tools/ai-agent-tool-schemas.js'
import {
  DEFAULT_AI_AGENT_SESSION_TITLE,
  normalizeAiAgentSessionTitle
} from '../../../shared/ai/conversation/ai-agent-session-title.js'
import { runAiAgentToolLoop } from '../../../shared/ai/tools/ai-agent-tool-loop.js'
import { resolveAiAgentReadinessStatus } from '../../../shared/ai/readiness/ai-agent-readiness.js'
import {
  createAiAgentInstallPlanPreview,
  resolveAiAgentAutoInstallPlan
} from './agentInstallPlan.js'
import { resolveDependenciesTool } from './agent/tools/dependencyResolverTool.js'
import { getInstalledGamesTool } from './agent/tools/gameContextTool.js'
import { getInstallRuleReferenceDocsTool } from './agent/tools/installRuleReferenceDocsTool.js'
import { getAiAgentFeatureFlags } from '../../ipc/game/featureFlags.js'
import { cancelAgentV2Execution, chatWithAgentV2, getAgentV2Status } from './agent/orchestrator.js'
import { cancelAgentToolInvocation } from './agent/debugToolInvoker.js'
import { conversationExecutions } from './agent/conversationExecution.js'
import { classifyAiAgentError } from '../../../shared/ai/conversation/ai-agent-error.js'
import { resolveAiAgentOutcome } from '../../../shared/ai/conversation/ai-agent-outcome.js'
import { getAiAgentToolDescriptor } from '../../../shared/ai/tools/ai-agent-tool-schemas.js'

const activeExecutions = new Map()
let latestExecutionId = ''
const REAL_DIRECTORY_ROOT_ENV_KEYS = Object.freeze([
  'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT',
  'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT',
  'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT'
])
const REAL_DIRECTORY_SMOKE_MARKER_FILE = '.vertex-real-smoke-ok'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function parseEnvListText(value = '') {
  return String(value || '')
    .split(/[\r\n;]+/)
    .map((item) => item.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

function buildNexusApiKeyStatus() {
  const settings = sanitizeUserSystemConfig(store.get('systemConfig.settings') || {})
  const configured = Boolean(toSafeText(settings.nexusApi?.apiKey))
  return { hasApiKey: configured, sources: { store: configured } }
}

function resolveRealExternalLogPathTexts(env = process.env) {
  return [
    ...parseEnvListText(env?.VERTEX_REAL_EXTERNAL_LOG_PATHS),
    ...parseEnvListText(env?.VERTEX_REAL_EXTERNAL_LOG_PATH)
  ]
}

function buildExternalLogFileStatus(env = process.env) {
  return resolveRealExternalLogPathTexts(env).map((filePath) => {
    const resolvedPath = path.resolve(filePath)
    try {
      const fileStat = statSync(resolvedPath)
      return {
        filePath,
        exists: true,
        isFile: fileStat.isFile()
      }
    } catch {
      return {
        filePath,
        exists: false,
        isFile: false
      }
    }
  })
}

function buildDirectoryRootStatus(env = process.env) {
  return REAL_DIRECTORY_ROOT_ENV_KEYS.map((key) => toSafeText(env?.[key]))
    .filter(Boolean)
    .map((filePath) => {
      const resolvedPath = path.resolve(filePath)
      const markerPath = path.join(resolvedPath, REAL_DIRECTORY_SMOKE_MARKER_FILE)
      try {
        const fileStat = statSync(resolvedPath)
        let markerExists = false
        let markerIsFile = false
        try {
          const markerStat = statSync(markerPath)
          markerExists = true
          markerIsFile = markerStat.isFile()
        } catch {
          markerExists = false
          markerIsFile = false
        }
        return {
          filePath,
          exists: true,
          isDirectory: fileStat.isDirectory(),
          markerFile: REAL_DIRECTORY_SMOKE_MARKER_FILE,
          markerExists,
          markerIsFile
        }
      } catch {
        return {
          filePath,
          exists: false,
          isDirectory: false,
          markerFile: REAL_DIRECTORY_SMOKE_MARKER_FILE,
          markerExists: false,
          markerIsFile: false
        }
      }
    })
}

function createExecutionId() {
  return `ai-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createAiAgentExecution(preferredId = '') {
  const executionId = preferredId || createExecutionId()
  const controller = new AbortController()
  const execution = {
    executionId,
    controller,
    startedAt: Date.now()
  }

  latestExecutionId = executionId
  activeExecutions.set(executionId, execution)
  return execution
}

function applyRuntimeOverrides(runtime = null, payload = {}) {
  if (!runtime?.config) {
    return runtime
  }
  const model = toSafeText(payload?.model)
  if (!model || model === runtime.config.model) {
    return runtime
  }
  return {
    ...runtime,
    config: {
      ...runtime.config,
      model
    }
  }
}

function clearAiAgentExecution(executionId = '') {
  activeExecutions.delete(executionId)
  if (latestExecutionId === executionId) {
    latestExecutionId = ''
  }
}

function assertExecutionActive(execution = {}) {
  if (execution?.controller?.signal?.aborted) {
    const error = new Error('AI 助手执行已取消')
    error.name = 'AbortError'
    throw error
  }
}

async function requestCompatibleAiCompletion(runtime = {}, messages = [], execution = {}) {
  assertExecutionActive(execution)
  const completion = await runtime.client.chat.completions.create(
    {
      model: runtime.config.model,
      temperature: 0.2,
      messages
    },
    {
      signal: execution?.controller?.signal
    }
  )
  assertExecutionActive(execution)
  return toSafeText(completion?.choices?.[0]?.message?.content)
}

function resolveEnabledTool(name = '') {
  const target = normalizeAiAgentToolName(name)
  return listAiAgentTools().find((tool) => tool.name === target && tool.enabled)
}

function normalizeListTasksResult(result = {}) {
  const safeResult = toPlainJson(result, {})
  if (Array.isArray(safeResult)) {
    return {
      success: true,
      tasks: safeResult.slice(0, 10)
    }
  }
  const tasks = Array.isArray(safeResult?.records)
    ? safeResult.records
    : Array.isArray(safeResult?.list)
      ? safeResult.list
      : Array.isArray(safeResult?.tasks)
        ? safeResult.tasks
        : []
  return {
    success: safeResult?.success !== false,
    ...safeResult,
    tasks: tasks.slice(0, 10)
  }
}

export async function executeAiAgentToolCall(call = {}, context = {}) {
  const normalizedCall = normalizeAiAgentToolCall(call)
  const requestedToolName = toSafeText(normalizedCall?.name)
  const toolName = normalizeAiAgentToolName(requestedToolName)
  const args = toPlainJson(normalizedCall?.arguments, {})
  const tool = resolveEnabledTool(toolName)

  if (!tool) {
    return {
      success: false,
      errorCode: 'tool_disabled',
      message: `${requestedToolName || toolName || '未知工具'} 未启用或不在白名单内。`
    }
  }

  if (toolName === 'vertex.game.list') {
    return await getInstalledGamesTool(args, context)
  }

  if (toolName === 'vertex.mod.search') {
    return await searchModSource({
      ...args,
      context
    })
  }

  if (toolName === 'vertex.mod.detail') {
    return await getModSourceDetail({
      ...args,
      context
    })
  }

  if (toolName === 'vertex.install.tasks') {
    const summary = getSourceInstallTaskSummary()
    const tasks = normalizeListTasksResult(
      listSourceInstallTasks({
        ...args,
        limit: Math.min(Number(args.limit || 10), 10)
      })
    )
    return {
      success: true,
      summary,
      tasks: tasks.tasks
    }
  }

  if (toolName === 'vertex.install.task_detail') {
    return getSourceInstallTaskDetail(args)
  }

  if (toolName === 'vertex.install_rule.reference_docs') {
    return await getInstallRuleReferenceDocsTool(args)
  }

  if (toolName === 'vertex.install.resolve_dependencies') {
    return await resolveDependenciesTool(args, {
      pageContext: context
    })
  }

  return {
    success: false,
    errorCode: 'tool_not_supported',
    message: `${toolName} 暂未接入 Agent 工具循环。`
  }
}

export function getAiAgentRuntimeStatus() {
  const featureFlags = getAiAgentFeatureFlags()
  if (featureFlags.enableAgentV2) {
    const v2Status = getAgentV2Status()
    const status = {
      ...getCompatibleAiConfigStatus(),
      engine: v2Status.engine,
      permissionMode: v2Status.permissionMode,
      tools: v2Status.tools,
      skills: listAiAgentSkills()
    }
    return {
      ...status,
      readiness: resolveAiAgentReadinessStatus(status, {
        featureFlags,
        env: process.env,
        directoryRootStatus: buildDirectoryRootStatus(process.env),
        nexusApiKeyStatus: buildNexusApiKeyStatus(),
        externalLogFileStatus: buildExternalLogFileStatus(process.env)
      })
    }
  }
  const status = {
    ...getCompatibleAiConfigStatus(),
    tools: listAiAgentTools(),
    skills: listAiAgentSkills()
  }
  return {
    ...status,
    readiness: resolveAiAgentReadinessStatus(status, {
      featureFlags,
      env: process.env,
      directoryRootStatus: buildDirectoryRootStatus(process.env),
      nexusApiKeyStatus: buildNexusApiKeyStatus(),
      externalLogFileStatus: buildExternalLogFileStatus(process.env)
    })
  }
}

function normalizeAiAgentError(error = null) {
  return classifyAiAgentError(error).message
}

export async function generateAiAgentSessionTitle(payload = {}) {
  const message = toSafeText(payload?.message)
  const assistantMessage = toSafeText(payload?.assistantMessage).slice(0, 600)
  const fallbackTitle = normalizeAiAgentSessionTitle(message, DEFAULT_AI_AGENT_SESSION_TITLE)
  if (!message) {
    return {
      success: false,
      configured: false,
      title: DEFAULT_AI_AGENT_SESSION_TITLE,
      message: '缺少用户消息'
    }
  }

  const runtime = applyRuntimeOverrides(createCompatibleAiClient(), payload)
  if (!runtime) {
    return {
      success: false,
      configured: false,
      title: fallbackTitle,
      message: 'AI API 未配置'
    }
  }

  try {
    const completion = await runtime.client.chat.completions.create({
      model: runtime.config.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你只负责为一段用户对话生成中文会话标题。',
            '标题必须基于用户首条消息和助手回复，不超过 12 个中文字。',
            '只输出标题本身，不要解释，不要加引号、句号、编号或 Markdown。'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `用户首条消息：${message}`,
            assistantMessage ? `助手回复：${assistantMessage}` : ''
          ]
            .filter(Boolean)
            .join('\n')
        }
      ]
    })
    const title = normalizeAiAgentSessionTitle(
      completion?.choices?.[0]?.message?.content,
      fallbackTitle
    )
    return {
      success: true,
      configured: true,
      title
    }
  } catch (error) {
    return {
      success: false,
      configured: true,
      title: fallbackTitle,
      message: normalizeAiAgentError(error)
    }
  }
}

function buildAutoInstallPlanAssistantMessage(message = '', plan = null, metadata = {}) {
  const safeMessage = toSafeText(message)
  if (!plan || typeof plan !== 'object') {
    return safeMessage
  }

  const lines = [safeMessage]
  if (metadata?.detailResolved) {
    lines.push(`已自动补全 ${plan.modName || '当前模组'} 的详情，并生成安装计划预览。`)
  } else {
    lines.push(`已自动生成 ${plan.modName || '当前模组'} 的安装计划预览。`)
  }
  if (plan?.canSubmit === true && plan?.autoTaskPayloadResolved === true) {
    lines.push('当前安装计划已自动补齐任务数据，可直接加入安装任务。')
  }
  if (plan?.precheckText) {
    lines.push(toSafeText(plan.precheckText))
  }

  return lines.filter(Boolean).join('\n')
}

export async function chatWithAiAgent(payload = {}, options = {}) {
  if (payload.retryOfExecutionId) {
    const previous = conversationExecutions.getResult(payload.retryOfExecutionId)
    if (!previous || previous.payload.sessionId !== payload.sessionId || !previous.result.canRetry) {
      return { success: false, accepted: false, assistantMessage: '此请求不能直接重试，请核实任务状态后继续。' }
    }
    payload = { ...previous.payload, executionId: payload.executionId, userMessageId: payload.userMessageId, createdAt: payload.createdAt, retryOfExecutionId: undefined }
    options = { ...options, readonlyRetry: true }
  }
  return conversationExecutions.run(payload, { ...options, cancel: cancelAiAgentExecution }, async (request, executionOptions) => {
    const result = await chatWithAiAgentInternal(request, executionOptions)
    result.outcome = resolveAiAgentOutcome(result)
    const calls = result.toolCalls || []
    // 容量不足时原样重试只会得到同样的结果，不提供“重试查询”。
    result.canRetry = (result.success === false || ['failed', 'partial'].includes(result.outcome)) &&
      result.stopReason !== 'context_budget' &&
      !result.confirmations?.length && !result.installPlan?.submitted &&
      calls.every((call) => getAiAgentToolDescriptor(call.name)?.readonly === true)
    return result
  })
}

async function chatWithAiAgentInternal(payload = {}, options = {}) {
  if (getAiAgentFeatureFlags().enableAgentV2) {
    return await chatWithAgentV2(payload, options)
  }
  const message = toSafeText(payload?.message)
  const context = toPlainJson(payload?.context, {})
  const runtime = applyRuntimeOverrides(createCompatibleAiClient(), payload)
  const parsedUserToolCalls = parseAiAgentToolCalls(message)

  if (!runtime) {
    return {
      success: false,
      configured: false,
      assistantMessage: 'AI API 未配置。\n需要配置 OpenAI 兼容接口协议后才能使用智能体能力。',
      candidates: [],
      toolCalls: parsedUserToolCalls
    }
  }

  const execution = createAiAgentExecution(payload.executionId)

  try {
    const result = await runAiAgentToolLoop({
      message,
      context,
      execution,
      tools: listAiAgentTools().filter((tool) => !options.readonlyRetry || getAiAgentToolDescriptor(tool.name)?.readonly === true),
      model: runtime.config.model,
      history: payload.history,
      executeTool: (call, context) => options.readonlyRetry && getAiAgentToolDescriptor(call.name)?.readonly !== true
        ? { success: false, message: '重试只允许读取操作。' }
        : executeAiAgentToolCall(call, context),
      requestCompletion: (messages) => requestCompatibleAiCompletion(runtime, messages, execution)
    })
    const autoPlanResult = await resolveAiAgentAutoInstallPlan({
      candidates: result.candidates,
      context
    })

    return {
      success: true,
      configured: true,
      executionId: execution.executionId,
      assistantMessage: buildAutoInstallPlanAssistantMessage(
        result.assistantMessage,
        autoPlanResult.installPlan,
        autoPlanResult
      ),
      candidates: autoPlanResult.candidates,
      installPlan: attachInstallPlanConfirmation(autoPlanResult.installPlan, { sessionId: payload.sessionId, event: options.event }),
      confirmations: result.confirmations || [],
      toolCalls: [...parsedUserToolCalls, ...result.toolCalls]
    }
  } catch (error) {
    return {
      success: false,
      configured: true,
      executionId: execution.executionId,
      assistantMessage: normalizeAiAgentError(error),
      error: classifyAiAgentError(error),
      candidates: [],
      confirmations: [],
      toolCalls: parsedUserToolCalls
    }
  } finally {
    clearAiAgentExecution(execution.executionId)
  }
}

export async function cancelAiAgentExecution(payload = {}) {
  const toolResult = cancelAgentToolInvocation(payload)
  if (toolResult) return toolResult
  // 优先尝试取消 Agent V2 执行；未命中再回落旧执行表
  const v2Result = cancelAgentV2Execution(payload)
  if (v2Result.handled) {
    return v2Result
  }

  const executionId = toSafeText(payload?.executionId || latestExecutionId)
  if (!executionId || !activeExecutions.has(executionId)) {
    return {
      success: true,
      message: '当前没有正在执行的 AI 助手任务'
    }
  }

  const execution = activeExecutions.get(executionId)
  execution.controller.abort()
  return {
    success: true,
    executionId,
    cancelRequested: true,
    message: '已请求停止，正在等待本轮执行结束。'
  }
}

export async function listAiAgentModels() {
  try {
    return await listCompatibleAiModels()
  } catch (error) {
    return {
      success: false,
      configured: true,
      models: [],
      message: normalizeAiAgentError(error)
    }
  }
}

export async function createAiAgentInstallPlan(payload = {}, options = {}) {
  const result = await createAiAgentInstallPlanPreview(payload)
  return { ...result, plan: attachInstallPlanConfirmation(result.plan, { sessionId: payload.sessionId, event: options.event }) }
}

export async function submitAiAgentInstallPlan(event, payload = {}) {
  return confirmAgentTool(payload, { event })
}

export async function executeAiAgentConflictRepair(event, payload = {}) {
  return confirmAgentTool(payload, { event })
}
