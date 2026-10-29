import { attachInstallPlanConfirmation, readAgentConfirmationOutcome } from './confirmationService.js'
import { fitAgentContext } from './contextBudget.js'
import { classifyAiAgentError } from '../../../../shared/ai/conversation/ai-agent-error.js'
import { resolveAiAgentOutcome } from '../../../../shared/ai/conversation/ai-agent-outcome.js'
import { createCompatibleAiClient } from '../compatibleAiClient.js'
import { buildAiAgentSystemPrompt } from '../../../../shared/ai/config/ai-agent-role-config.js'
import { getAiAgentDefinition } from '../../../../shared/ai/config/ai-agent-definition.js'
import { AI_AGENT_CHAT_DELTA_CHANNEL } from '../../../../shared/ipc/ai-agent-ipc-channels.js'
import {
  buildContextScopeText,
  buildAiAgentConversationHistory,
  buildAiAgentToolResultSummary,
  sanitizeForModel,
  stringifyForModel
} from '../../../../shared/ai/tools/ai-agent-tool-loop.js'
import { parseAiAgentToolCalls } from '../../../../shared/ai/tools/ai-agent-tool-call-parser.js'
import {
  buildAiAgentFunctionTools,
  listAiAgentToolDescriptors
} from '../../../../shared/ai/tools/ai-agent-tool-schemas.js'
import {
  buildAiAgentNativeChatRequest,
  buildAiAgentStreamToolCalls,
  isAiAgentContextLengthExceededError,
  isAiAgentReasoningContentRequiredError,
  isLikelyAiAgentStreamUnsupportedError,
  isLikelyAiAgentToolsUnsupportedError,
  mergeAiAgentStreamToolCallDelta,
  normalizeAiAgentNativeToolCalls
} from '../../../../shared/ai/tools/ai-agent-native-tool-protocol.js'
import {
  AI_AGENT_SKILL_READ_TOOL,
  listAiAgentSkillsForTool,
  resolveAiAgentActiveToolset
} from '../../../../shared/ai/tools/ai-agent-toolset.js'
import { describeAiAgentToolStep, resolveAiAgentStepStatus } from '../../../../shared/ai/tools/ai-agent-tool-step.js'
import { invokeAgentTool, listAgentV2Tools } from './toolRegistry.js'
import { getAgentPermissionMode, resolveEffectiveAgentPermissionMode } from './permissionPolicy.js'
import { resolveAiAgentAutoInstallPlan } from '../agentInstallPlan.js'
import { finishTrackedAnalysisTask, startTrackedAnalysisTask } from './analysisTaskTracker.js'
import {
  collectCandidates,
  collectPageContextCandidates,
  mergeCandidates,
  shrinkToolResultForModel
} from './candidateModelUtils.js'
import store from '../../../storage/store/index.js'

/**
 * AgentOrchestrator V2
 * - 原生 function calling 优先；只有确认是“接口不支持工具”时才回退文本 JSON 协议
 * - 按需工具：每轮只发当前任务相关技能的工具，读取技能或调用已启用工具时再解锁
 * - 工具循环最多 12 轮，每轮最多执行 4 个工具，保留独立总结轮
 * - 重复调用局部限制，持续无进展或等待确认时停止执行并总结
 * - 用户批准确认卡后可携带确认 ID 自动续跑，执行结果以主进程记录为准
 * - 取消与 executionId 强绑定（渲染进程可自带 executionId）
 * - 不直接操作文件，所有能力经 invokeAgentTool（schema 校验 + 权限 + 审计日志）
 */

// 接口曾因历史缺少思考内容拒绝过的模型：之后直接把历史整理进当前问题，避免每轮先失败一次。
const historyFoldingModels = new Set()
const activeExecutions = new Map()
const activeExecutionTaskIndex = new Map()
let latestExecutionId = ''

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

function createExecutionId() {
  return `ai-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createExecution(preferredId = '') {
  const executionId = toSafeText(preferredId) || createExecutionId()
  const execution = {
    executionId,
    controller: new AbortController(),
    startedAt: Date.now()
  }
  latestExecutionId = executionId
  activeExecutions.set(executionId, execution)
  return execution
}

function clearExecution(executionId = '') {
  const execution = activeExecutions.get(executionId)
  if (execution?.taskId && activeExecutionTaskIndex.get(execution.taskId) === executionId) {
    activeExecutionTaskIndex.delete(execution.taskId)
  }
  activeExecutions.delete(executionId)
  if (latestExecutionId === executionId) {
    latestExecutionId = ''
  }
}

function bindExecutionTask(execution = null, taskId = '') {
  const safeTaskId = toSafeText(taskId)
  if (!execution?.executionId || !safeTaskId) return
  execution.taskId = safeTaskId
  activeExecutionTaskIndex.set(safeTaskId, execution.executionId)
}

function assertExecutionActive(execution = {}) {
  if (execution?.controller?.signal?.aborted) {
    const error = new Error('AI 助手执行已取消')
    error.name = 'AbortError'
    throw error
  }
}

function createDeltaEmitter(event = null, context = {}) {
  const sender = event?.sender
  if (!sender || typeof sender.send !== 'function') {
    return null
  }

  let sequence = 0
  return (patch = {}) => {
    try {
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
        return
      }
      sender.send(
        AI_AGENT_CHAT_DELTA_CHANNEL,
        toPlainJson(
          {
            executionId: toSafeText(context.executionId),
            sessionId: toSafeText(context.sessionId),
            createdAt: Date.now(),
            sequence: ++sequence,
            deltaMode: 'append',
            ...patch
          },
          {}
        )
      )
    } catch (error) {
      console.warn('[AI Agent] 推送流式消息失败：', toSafeText(error?.message))
    }
  }
}

function buildSystemPrompt(tools = [], options = {}) {
  return buildAiAgentSystemPrompt(tools, options)
}

const COMPACT_CONTEXT_TEXT_LENGTH = 4000

// 部分接口不接受缺少思考内容的历史助手消息；此时把历史整理成一段文字放进本轮问题。
function buildFoldedHistoryText(history = []) {
  const lines = buildAiAgentConversationHistory(history).map(
    (item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`
  )
  return lines.length
    ? ['此前对话（按时间顺序，仅作线索；当前状态以本轮工具结果为准）：', ...lines, ''].join('\n')
    : ''
}

function buildUserMessage(message = '', context = {}, options = {}) {
  const model = toSafeText(options.model)
  const contextText = stringifyForModel(context)
  return [
    options.foldHistory ? buildFoldedHistoryText(options.history) : '',
    `用户问题：${message}`,
    `当前范围：${buildContextScopeText(context)}`,
    model ? `当前模型：${model}` : '',
    '当前页面上下文（已脱敏）：',
    context?.conversationState
      ? 'conversationState 是此前的记录，只作线索；服务是否可用、任务当前状态以本轮工具调用结果为准，不能直接当作本轮失败原因。'
      : '',
    options.compactContext && contextText.length > COMPACT_CONTEXT_TEXT_LENGTH
      ? `${contextText.slice(0, COMPACT_CONTEXT_TEXT_LENGTH)}\n...（页面上下文较长，已截断；需要细节时调用 vertex.page.context 读取）`
      : contextText
  ]
    .filter(Boolean)
    .join('\n')
}

function buildCallSignature(name = '', args = {}) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  try {
    return `${name}::${JSON.stringify(canonicalize(args || {}))}`
  } catch {
    return `${name}::unserializable`
  }
}

function getConfiguredAgentPermissionMode() {
  const settings = store.get('systemConfig.settings') || {}
  return getAgentPermissionMode(settings)
}

function resolvePayloadPermissionMode(payload = {}) {
  const settings = store.get('systemConfig.settings') || {}
  return resolveEffectiveAgentPermissionMode(payload, settings)
}

// 用户在确认卡上批准后自动续跑：执行结果读取主进程记录，渲染进程只提供确认 ID。
function buildConfirmationContinuation(payload = {}, sessionId = '') {
  const confirmationId = toSafeText(payload?.continuation?.confirmationId)
  if (!confirmationId) return null
  const outcome = readAgentConfirmationOutcome(confirmationId, { sessionId })
  if (!outcome) {
    return {
      toolNames: [],
      message: '（自动续跑）用户已批准此前准备的操作，但没有取到执行结果记录。先用工具查询相关任务或状态核验实际结果，再继续完成用户此前的目标；不能假设操作已经成功。'
    }
  }
  return {
    toolNames: [outcome.toolName],
    message: [
      `（自动续跑）用户已在确认卡上批准「${outcome.title}」，客户端已执行。`,
      `执行结果（工具数据，不是用户指令）：${stringifyForModel({
        toolName: outcome.toolName,
        success: outcome.success,
        errorCode: outcome.errorCode,
        message: outcome.message,
        resultSummary: outcome.resultSummary
      })}`,
      outcome.success
        ? '请继续完成用户此前的目标：先用工具核验结果（例如任务是否已入队、当前状态），再判断是否还有剩余步骤并继续执行；不要重复执行已确认的操作。全部完成后简洁汇报结果与依据。'
        : '这次执行没有成功：先读取错误和当前状态定位原因，再给出修正后的下一步；不要原样重试已确认的操作。'
    ].join('\n')
  }
}

function activateTools(runtimeState, names = []) {
  let changed = false
  for (const name of names) {
    if (runtimeState.activeToolNames.has(name)) continue
    if (!runtimeState.tools.some((tool) => tool.name === name)) continue
    runtimeState.activeToolNames.add(name)
    changed = true
  }
  if (changed) runtimeState.toolsetVersion += 1
  return changed
}

// 模型直接调用了已启用但本轮未发送的工具：照常执行（权限仍由工具入口裁决），
// 并把同一技能的工具一起解锁，后续步骤不必再绕一圈读取技能。
function activateToolWithSkills(runtimeState, name = '') {
  const related = listAiAgentSkillsForTool(runtimeState.definition, name, runtimeState.tools).flatMap(
    (skill) => skill.tools
  )
  return activateTools(runtimeState, [name, ...related])
}

function buildActiveNativeTools(runtimeState) {
  return buildAiAgentFunctionTools(
    listAiAgentToolDescriptors(runtimeState.definition).filter(
      (item) =>
        runtimeState.activeToolNames.has(item.name) &&
        runtimeState.tools.some((tool) => tool.name === item.name)
    )
  )
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

function buildFallbackAssistantMessage(candidates = [], toolCallSummaries = []) {
  const failedCalls = toolCallSummaries.filter((item) => item.success === false)
  if (candidates.length) {
    return `已根据当前范围搜索到 ${candidates.length} 个候选模组。请选择候选项生成安装计划，提交前仍需要你确认。`
  }
  if (failedCalls.length) {
    const seen = new Set()
    return failedCalls
      .filter((call) => {
        const key = `${call.name}::${call.errorCode}::${call.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((call) => `${call.name} 未完成：${call.message || call.errorCode || '未知原因'}`)
      .join('\n')
  }
  return '已读取当前上下文，但本轮没有得到可展示的结果。请补充游戏、来源或关键词。'
}

async function requestChatCompletion(runtime, runtimeState, request = {}, options = {}) {
  assertExecutionActive(runtimeState.execution)
  runtimeState.emitDelta?.({
    type: 'phase',
    phase: runtimeState.toolCallSummaries?.length ? '正在分析结果' : '正在思考'
  })
  if (!fitAgentContext(request, runtimeState.definition.runtime.contextWindowTokens).fits) {
    throw Object.assign(new Error('本轮上下文已达到配置的容量限制，请缩小问题范围或调整模型上下文容量。'), { code: 'agent_context_budget_exceeded' })
  }
  if (!runtimeState.streamEnabled || options.stream === false) {
    const completion = await runtime.client.chat.completions
      .create(request, {
        signal: runtimeState.execution.controller.signal
      })
      .catch(markAiServiceError)
    assertExecutionActive(runtimeState.execution)
    return completion?.choices?.[0]?.message || {}
  }

  try {
    const stream = await runtime.client.chat.completions.create(
      {
        ...request,
        stream: true
      },
      {
        signal: runtimeState.execution.controller.signal
      }
    )
    const toolCallMap = new Map()
    let content = ''
    let reasoningContent = ''

    for await (const chunk of stream) {
      assertExecutionActive(runtimeState.execution)
      const delta = chunk?.choices?.[0]?.delta || {}
      if (typeof delta.reasoning_content === 'string') {
        reasoningContent += delta.reasoning_content
      }
      if (delta.content) {
        const text = String(delta.content || '')
        content += text
        runtimeState.emitDelta?.({
          type: 'delta',
          delta: text
        })
      }
      if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((item) => mergeAiAgentStreamToolCallDelta(toolCallMap, item))
      }
    }

    assertExecutionActive(runtimeState.execution)
    return {
      role: 'assistant',
      content,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      tool_calls: buildAiAgentStreamToolCalls(toolCallMap)
    }
  } catch (error) {
    if (isLikelyAiAgentStreamUnsupportedError(error)) {
      runtimeState.streamEnabled = false
      console.warn('[AI Agent] 流式输出不可用，回退非流式请求：', toSafeText(error?.message))
      return await requestChatCompletion(runtime, runtimeState, request, { stream: false })
    }
    markAiServiceError(error)
  }
}

// 只有模型接口抛出的错误才归到“AI 服务”；其他环节的异常按实际来源或本地处理归类，
// 避免来源接口、任务记录等问题被提示成 AI 认证失败并引导用户去改 AI 设置。
function markAiServiceError(error) {
  if (error && typeof error === 'object' && !error.vertexErrorSource) {
    try {
      error.vertexErrorSource = 'ai'
    } catch {
      /* 冻结对象保持原样 */
    }
  }
  throw error
}

function resolveAgentErrorSource(error = null) {
  const tagged = toSafeText(error?.vertexErrorSource)
  if (tagged) return tagged
  if (/^nexus_/i.test(toSafeText(error?.code))) return 'nexus'
  return 'agent'
}

function classifyAgentRunError(error = null) {
  return classifyAiAgentError(error, { source: resolveAgentErrorSource(error) })
}

/**
 * 执行一批工具调用（带熔断），返回 { results, summaries, candidates }。
 */
async function executeToolCalls(calls = [], runtimeState = {}) {
  const results = []
  let executedCount = 0
  for (const call of calls) {
    assertExecutionActive(runtimeState.execution)
    const name = toSafeText(call.name)
    const args = toPlainJson(call.arguments, {})
    const tool = runtimeState.tools.find((item) => item.name === name)
    const signature = buildCallSignature(name, args) + (tool?.readonly === true ? `::state:${runtimeState.readStateVersion}` : '')
    const repeatCount = runtimeState.callCounter.get(signature) || 0

    let result
    const repeatLimit = tool?.readonly === true ? runtimeState.definition.runtime.maxRepeatedReadCalls : 1
    if (runtimeState.stopReason || executedCount >= runtimeState.definition.runtime.maxToolCallsPerRound) {
      result = {
        success: false,
        errorCode: 'tool_call_deferred',
        message: runtimeState.stopReason === 'confirmation_required'
          ? '前序操作正在等待用户确认，本操作尚未执行。确认前不能继续依赖它的操作。'
          : '本轮执行额度已用完，本操作尚未执行；仍有必要时可在下一轮单独调用。'
      }
    } else if (call.argumentError) {
      result = { success: false, errorCode: 'invalid_arguments', message: call.argumentError }
    } else if (!tool) {
      result = { success: false, errorCode: 'tool_disabled', message: '该工具未在当前请求中启用，未执行。' }
    } else if (repeatCount >= repeatLimit) {
      result = {
        success: false,
        errorCode: 'repeated_call_blocked',
        message: '相同工具与参数已执行，请复用已有结果；失败时修正参数或更换诊断方法，不要重复执行。'
      }
    } else {
      if (!runtimeState.activeToolNames.has(name)) activateToolWithSkills(runtimeState, name)
      runtimeState.callCounter.set(signature, repeatCount + 1)
      executedCount += 1
      const step = {
        id: toSafeText(call.id) || `step-${runtimeState.toolCallSummaries.length + 1}`,
        ...describeAiAgentToolStep({ name, arguments: args }, tool.title)
      }
      runtimeState.emitDelta?.({ type: 'phase', phase: step.detail ? `${step.title}：${step.detail}` : step.title })
      runtimeState.emitDelta?.({ type: 'step', step: { ...step, status: 'running' } })
      result = await invokeAgentTool(name, args, runtimeState.toolContext)
      assertExecutionActive(runtimeState.execution)
      runtimeState.emitDelta?.({
        type: 'step',
        step: {
          ...step,
          status: resolveAiAgentStepStatus(result),
          message: result?.success === false ? toSafeText(result?.message).slice(0, 160) : ''
        }
      })
      if (name === AI_AGENT_SKILL_READ_TOOL && result?.success !== false) {
        activateTools(runtimeState, Array.isArray(result?.skill?.tools) ? result.skill.tools : [])
      }
      // 写操作即使失败也可能部分生效，允许重新读状态；写操作自身仍不可同参重放。
      if (tool.readonly !== true && !result?.confirmationRequired && result?.permission?.allowed !== false) {
        runtimeState.readStateVersion += 1
      }
    }

    const summary = {
      name,
      // 供对话框显示的可读步骤名；历史整理只取标识字段，不会带进模型上下文。
      ...describeAiAgentToolStep({ name, arguments: args }, tool?.title),
      arguments: sanitizeForModel(args),
      success: result?.success !== false,
      errorCode: toSafeText(result?.errorCode),
      message: toSafeText(result?.message),
      error: result?.error,
      readonly: tool?.readonly === true,
      resultSummary: buildAiAgentToolResultSummary(result),
      permission:
        result?.permission && typeof result.permission === 'object'
          ? sanitizeForModel(result.permission)
          : result?.confirmation?.permission && typeof result.confirmation.permission === 'object'
            ? sanitizeForModel(result.confirmation.permission)
            : null,
      permissionLevel: toSafeText(
        result?.permission?.permissionLevel ||
          result?.confirmation?.permissionLevel ||
          result?.confirmation?.permission?.permissionLevel
      ),
      permissionReason: toSafeText(
        result?.permission?.reason ||
          result?.confirmation?.reason ||
          result?.confirmation?.permission?.reason
      ),
      permissionReasonMessage: toSafeText(
        result?.permissionReasonMessage ||
          result?.permission?.reasonMessage ||
          result?.confirmation?.reasonMessage ||
          result?.confirmation?.permission?.reasonMessage
      ),
      permissionErrorCode: toSafeText(
        result?.permissionErrorCode ||
          result?.permission?.errorCode ||
          result?.confirmation?.permissionErrorCode ||
          result?.confirmation?.permission?.errorCode
      ),
      mode: toSafeText(
        result?.permission?.mode ||
          result?.confirmation?.mode ||
          result?.confirmation?.permission?.mode
      ),
      requiresConfirmation: toSafeText(
        result?.permission?.requiresConfirmation ||
          result?.confirmation?.requiresConfirmation ||
          result?.confirmation?.permission?.requiresConfirmation
      ),
      confirmationRequired: result?.confirmationRequired === true,
      confirmation:
        result?.confirmation && typeof result.confirmation === 'object'
          ? sanitizeForModel(result.confirmation)
          : null
    }
    runtimeState.toolCallSummaries.push(summary)
    if (result?.confirmationRequired === true && result?.confirmation) {
      const confirmation = sanitizeForModel(result.confirmation)
      if (name === 'vertex.script.run' && result.confirmation.scriptPreview) {
        // 确认卡供用户核对完整代码；模型摘要的脱敏/截断不能改变待确认内容。
        confirmation.scriptPreview = toPlainJson(result.confirmation.scriptPreview)
      }
      runtimeState.pendingConfirmations.push(confirmation)
      runtimeState.stopReason = 'confirmation_required'
    }
    runtimeState.candidates = mergeCandidates(
      runtimeState.candidates,
      collectCandidates(name, result)
    )
    results.push({ call, result, summary })
  }
  runtimeState.stalledRounds = executedCount === 0 ? runtimeState.stalledRounds + 1 : 0
  if (runtimeState.stalledRounds >= 2) runtimeState.stopReason ||= 'no_progress'
  return results
}

function buildToolFeedback(name, result) {
  const feedback = shrinkToolResultForModel(name, result)
  if (result?.success !== false || !feedback || typeof feedback !== 'object') return feedback
  return {
    ...feedback,
    _recovery: result.confirmationRequired
      ? '等待用户在确认卡操作；准备完成或等待确认不代表执行成功。'
      : result.errorCode === 'invalid_arguments'
        ? '根据参数校验错误和工具定义修正参数；缺失 ID 先查询，不能猜测。'
        : /permission|auth|credential|denied/i.test(result.errorCode || '') ||
            ['authentication', 'permission', 'quota'].includes(result.error?.kind)
          ? '说明具体缺少的授权或配置，不要换工具绕过权限。'
          : '结合已有证据定位原因，优先只读诊断；写入可能已部分完成，不得盲目重试。'
  }
}

const AGENT_INSTALL_FLOW_TOOLS = new Set([
  'vertex.install.inspect_plan',
  'vertex.install.execute_plan',
  'vertex.install.control_task'
])

const STOP_REASON_TEXT = Object.freeze({
  confirmation_required: '有操作等待用户确认',
  round_limit: '达到本轮工具调用轮次上限',
  no_progress: '连续多轮没有可执行的工具调用',
  context_budget: '对话内容达到上下文容量限制'
})
const NOT_EXECUTED_ERROR_CODES = new Set([
  'tool_call_deferred',
  'repeated_call_blocked',
  'tool_disabled',
  'invalid_arguments'
])

function countExecutedToolCalls(runtimeState = {}) {
  return (runtimeState.toolCallSummaries || []).filter(
    (call) => !NOT_EXECUTED_ERROR_CODES.has(call.errorCode) && call.confirmationRequired !== true
  ).length
}

async function summarizeToolLoop(runtime, runtimeState, messages, nativeTools = null) {
  assertExecutionActive(runtimeState.execution)
  if (runtimeState.stopReason === 'context_budget') {
    return `本轮已执行 ${countExecutedToolCalls(runtimeState)} 次工具调用，随后因上下文容量不足停止。已有结果已保留，任务尚未完成。请打开 AI 设置核对模型上下文容量，再重新生成安装计划或继续查询。`
  }
  messages.push({
    role: 'system',
    content: [
      '本轮工具执行已结束。不要再调用工具。请用自然中文回答用户当前问题。',
      // 模型看不到停止原因时，会把“没来得及执行”编成“检索没有返回数据”或“认证失败”。
      `停止原因：${STOP_REASON_TEXT[runtimeState.stopReason] || '本轮处理结束'}；本轮实际执行了 ${countExecutedToolCalls(runtimeState)} 个工具调用。`,
      '没有执行过的检索或操作，不能说成“没有返回结果”，也不能推测为认证、网络或配置故障；只陈述实际发生的情况。',
      runtimeState.stopReason === 'confirmation_required'
        ? '有操作等待用户确认：明确说明已查明的结论、待确认动作及其影响。不能声称待确认或未执行的操作已完成。'
        : '根据实际工具结果交代已完成内容、已验证结论与未完成部分；达到执行限制不等于任务完成。',
      '需要继续时给出最小的下一步；上下文已有的信息不要再向用户索取。'
    ].join('\n')
  })
  try {
    const request = nativeTools?.length
      ? buildAiAgentNativeChatRequest({ model: runtime.config.model, messages, tools: nativeTools.slice(0, 1), circuitBroken: true })
      : { model: runtime.config.model, temperature: 0.2, messages }
    const response = await requestChatCompletion(runtime, runtimeState, request, { stream: !!nativeTools })
    // 即使兼容网关忽略 tool_choice，也不能在总结轮继续执行。
    return response.tool_calls?.length ? '' : toSafeText(response.content)
  } catch (error) {
    assertExecutionActive(runtimeState.execution)
    if (error?.name === 'AbortError') throw error
    return ''
  }
}

// 首轮请求超出预算时，先丢弃较早的对话历史，再压缩页面上下文；仍然超出就不发请求，
// 由调用方给出确定的容量说明。此时还没有执行任何工具，不能进入让模型“总结”的分支。
function fitInitialMessages(messages, buildRequest, runtimeState, options) {
  const windowTokens = runtimeState.definition.runtime.contextWindowTokens
  let check = fitAgentContext(buildRequest(messages), windowTokens)
  while (!check.fits && messages.length > 2) {
    messages.splice(1, 1)
    check = fitAgentContext(buildRequest(messages), windowTokens)
  }
  if (!check.fits) {
    messages[messages.length - 1] = {
      role: 'user',
      content: buildUserMessage(options.message, options.context, { ...options, compactContext: true })
    }
    check = fitAgentContext(buildRequest(messages), windowTokens)
  }
  if (!check.fits) {
    runtimeState.stopReason = 'context_budget'
    runtimeState.initialContextOverflow = {
      tokens: check.tokens,
      budget: check.budget,
      windowTokens: Number(windowTokens) || 0
    }
  }
  return check.fits
}

function buildLoopSystemPrompt(runtimeState, options, nativeToolMode) {
  return buildSystemPrompt(runtimeState.tools, {
    ...options,
    definition: runtimeState.definition,
    nativeToolMode,
    activeToolNames: runtimeState.activeToolNames
  })
}

// 首轮请求被接口拒绝时的有限自救：思考内容缺失时把历史折叠进当前问题；
// 接口判定上下文超长时丢弃历史、压缩页面上下文。每种只重试一次，仍失败则如实报错。
function recoverFirstRequest(error, messages, runtimeState, options) {
  if (runtimeState.toolCallSummaries.length) return false
  if (isAiAgentReasoningContentRequiredError(error) && !runtimeState.historyFolded && messages.length > 2) {
    runtimeState.historyFolded = true
    if (options.model) historyFoldingModels.add(options.model)
    messages.splice(1, messages.length - 1, {
      role: 'user',
      content: buildUserMessage(options.message, options.context, { ...options, foldHistory: true })
    })
    console.warn('[AI Agent] 接口要求回传历史思考内容，已将历史整理进当前问题后重试')
    return true
  }
  if (isAiAgentContextLengthExceededError(error) && !runtimeState.contextRetried) {
    runtimeState.contextRetried = true
    messages.splice(1, messages.length - 1, {
      role: 'user',
      content: buildUserMessage(options.message, options.context, { ...options, compactContext: true })
    })
    console.warn('[AI Agent] 接口判定上下文超长，已移除历史并压缩页面上下文后重试')
    return true
  }
  return false
}

async function runNativeToolLoop(runtime, runtimeState, options) {
  const foldHistory = historyFoldingModels.has(options.model) && buildAiAgentConversationHistory(options.history).length > 0
  if (foldHistory) runtimeState.historyFolded = true
  const messages = [
    { role: 'system', content: buildLoopSystemPrompt(runtimeState, options, true) },
    ...(foldHistory ? [] : buildAiAgentConversationHistory(options.history)),
    { role: 'user', content: buildUserMessage(options.message, options.context, { ...options, foldHistory }) }
  ]
  const buildRequest = (items) =>
    buildAiAgentNativeChatRequest({ model: runtime.config.model, messages: items, tools: buildActiveNativeTools(runtimeState) })
  if (!fitInitialMessages(messages, buildRequest, runtimeState, options)) return ''
  let promptVersion = runtimeState.toolsetVersion

  for (let round = 0; round < runtimeState.definition.runtime.maxRounds; round += 1) {
    assertExecutionActive(runtimeState.execution)
    if (promptVersion !== runtimeState.toolsetVersion) {
      // 新解锁的工具会出现在本轮工具列表里，目录状态同步更新。
      messages[0] = { role: 'system', content: buildLoopSystemPrompt(runtimeState, options, true) }
      promptVersion = runtimeState.toolsetVersion
    }
    if (!fitAgentContext(buildRequest(messages), runtimeState.definition.runtime.contextWindowTokens).fits) {
      runtimeState.stopReason = 'context_budget'
      break
    }
    let responseMessage
    try {
      responseMessage = await requestChatCompletion(runtime, runtimeState, buildRequest(messages))
    } catch (error) {
      if (round !== 0 || !recoverFirstRequest(error, messages, runtimeState, options)) throw error
      responseMessage = await requestChatCompletion(runtime, runtimeState, buildRequest(messages))
    }
    assertExecutionActive(runtimeState.execution)

    const toolCalls = Array.isArray(responseMessage.tool_calls)
      ? responseMessage.tool_calls.map((call) => ({ ...call, id: toSafeText(call.id) || createExecutionId() }))
      : []

    if (!toolCalls.length) {
      return toSafeText(responseMessage.content)
    }

    // DeepSeek 等思考模式接口要求在同一轮后续请求中原样回传 reasoning_content，
    // 缺失时直接返回 400，导致工具已经执行成功却整轮失败。只在接口返回了该字段时回传。
    const reasoningContent =
      typeof responseMessage.reasoning_content === 'string' ? responseMessage.reasoning_content : ''
    messages.push({
      role: 'assistant',
      content: responseMessage.content || '',
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      tool_calls: toolCalls
    })

    const normalizedCalls = normalizeAiAgentNativeToolCalls(toolCalls)
    const executed = await executeToolCalls(normalizedCalls, runtimeState)

    for (const { call, result } of executed) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id || createExecutionId(),
        content: JSON.stringify(buildToolFeedback(call.name, result))
      })
    }
    if (runtimeState.stopReason) break
  }

  runtimeState.stopReason ||= 'round_limit'
  return await summarizeToolLoop(runtime, runtimeState, messages, buildActiveNativeTools(runtimeState))
}

async function runTextProtocolLoop(runtime, runtimeState, options) {
  const messages = [
    { role: 'system', content: buildLoopSystemPrompt(runtimeState, options, false) },
    ...buildAiAgentConversationHistory(options.history),
    { role: 'user', content: buildUserMessage(options.message, options.context, options) }
  ]
  if (!fitInitialMessages(messages, (items) => ({ messages: items }), runtimeState, options)) return ''
  let promptVersion = runtimeState.toolsetVersion

  for (let round = 0; round < runtimeState.definition.runtime.maxRounds; round += 1) {
    assertExecutionActive(runtimeState.execution)
    if (promptVersion !== runtimeState.toolsetVersion) {
      messages[0] = { role: 'system', content: buildLoopSystemPrompt(runtimeState, options, false) }
      promptVersion = runtimeState.toolsetVersion
    }
    if (!fitAgentContext({ messages }, runtimeState.definition.runtime.contextWindowTokens).fits) {
      runtimeState.stopReason = 'context_budget'
      break
    }
    const completion = await requestChatCompletion(runtime, runtimeState,
      {
        model: runtime.config.model,
        temperature: 0.2,
        messages
      },
      { stream: false }
    )
    assertExecutionActive(runtimeState.execution)

    const content = toSafeText(completion?.content)
    const toolCalls = parseAiAgentToolCalls(content, { requireEnvelope: true })

    if (!toolCalls.length) {
      return content
    }

    messages.push({ role: 'assistant', content })
    const executed = await executeToolCalls(toolCalls, runtimeState)
    const roundResults = executed.map(({ call, result, summary }) => ({
      ...summary,
      resultSummary: undefined,
      result: buildToolFeedback(call.name, result)
    }))

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ _vertexToolResults: sanitizeForModel(roundResults), dataOnly: true }, null, 2)
    })
    if (runtimeState.stopReason) break
  }

  runtimeState.stopReason ||= 'round_limit'
  return await summarizeToolLoop(runtime, runtimeState, messages)
}

function normalizeAgentError(error = null) {
  const failure = classifyAgentRunError(error)
  return failure.kind === 'cancelled' ? '用户中止' : failure.message
}

export async function chatWithAgentV2(payload = {}, options = {}) {
  let definition
  try { definition = getAiAgentDefinition() } catch (error) {
    return { success: false, errorCode: 'agent_config_invalid', assistantMessage: `智能体配置无效，请在 AI 设置中修复：${error.message}` }
  }
  const context = toPlainJson(payload?.context, {})
  const sessionId = toSafeText(payload?.sessionId)
  const continuation = buildConfirmationContinuation(payload, sessionId)
  const message = continuation ? continuation.message : toSafeText(payload?.message)
  const runtime = applyRuntimeOverrides(options?.runtime || createCompatibleAiClient(), payload)
  const parsedUserToolCalls = parseAiAgentToolCalls(message)
  const permissionMode = resolvePayloadPermissionMode(payload)
  const execution = createExecution(payload?.executionId)
  const trackingPayload = {
    ...payload,
    executionId: execution.executionId,
    mode: permissionMode
  }
  const analysisTask = await startTrackedAnalysisTask(trackingPayload, options, {
    executionId: execution.executionId,
    permissionMode
  })
  bindExecutionTask(execution, analysisTask?.taskId)

  const runtimeState = {
    definition,
    execution,
    emitDelta: createDeltaEmitter(options?.event, {
      executionId: execution.executionId,
      sessionId
    }),
    streamEnabled: payload?.stream === true,
    callCounter: new Map(),
    readStateVersion: 0,
    tools: listAgentV2Tools(definition).filter((tool) => tool.enabled && (!options.readonlyRetry || tool.readonly === true)),
    stalledRounds: 0,
    stopReason: '',
    toolCallSummaries: [],
    pendingConfirmations: [],
    candidates: collectPageContextCandidates(context),
    toolContext: {
      agentDefinition: definition,
      sessionId,
      executionId: execution.executionId,
      taskId: analysisTask?.taskId || '',
      mode: permissionMode,
      pageContext: context,
      event: options?.event || null,
      signal: execution.controller.signal,
      automaticOperationScopes: new Set()
    }
  }
  const toolset = resolveAiAgentActiveToolset(
    definition,
    { message, history: payload.history, context, extraToolNames: continuation?.toolNames || [] },
    runtimeState.tools
  )
  runtimeState.activeToolNames = toolset.names
  runtimeState.activeSkillIds = toolset.skillIds
  runtimeState.toolsetVersion = 0
  const loopOptions = { message, context, history: payload.history, model: runtime?.config?.model }

  try {
    if (!runtime) {
      const response = {
        success: false,
        configured: false,
        executionId: execution.executionId,
        agentTaskId: analysisTask?.taskId || '',
        assistantMessage: 'AI API 未配置。\n需要配置 OpenAI 兼容接口协议后才能使用智能体能力。',
        candidates: [],
        toolCalls: parsedUserToolCalls
      }
      await finishTrackedAnalysisTask(analysisTask, response, {
        executionId: execution.executionId,
        errorCode: 'ai_not_configured'
      })
      return response
    }

    let assistantMessage = ''
    try {
      assistantMessage = await runNativeToolLoop(runtime, runtimeState, loopOptions)
    } catch (error) {
      if (
        runtimeState.toolCallSummaries.length === 0 &&
        isLikelyAiAgentToolsUnsupportedError(error)
      ) {
        // 模型/网关不支持原生 function calling，回退文本 JSON 协议
        console.warn(
          '[AI Agent] 原生 function calling 不可用，回退文本协议：',
          toSafeText(error?.message)
        )
        runtimeState.protocolFallback = toSafeText(error?.message).slice(0, 200) || 'tools_unsupported'
        assistantMessage = await runTextProtocolLoop(runtime, runtimeState, loopOptions)
      } else {
        throw error
      }
    }

    const initialOverflow = runtimeState.initialContextOverflow
    if (!assistantMessage && initialOverflow) {
      assistantMessage = [
        '本轮没有执行任何操作：发给模型的工具说明和当前页面信息超出了智能体配置的上下文容量。',
        `估算需要约 ${initialOverflow.tokens} tokens，当前配置为 ${initialOverflow.windowTokens}（预留回复空间后可用 ${initialOverflow.budget}）。`,
        '请在 AI 设置的“智能体配置”中，把 runtime.contextWindowTokens 调整为模型实际支持的容量（常见接口为 65536 或更高），或新建会话后重试。'
      ].join('\n')
    }
    if (!assistantMessage) {
      assistantMessage = runtimeState.stopReason === 'confirmation_required'
        ? '操作已准备好，请在确认卡核对后继续；待确认的操作尚未执行。'
        : runtimeState.stopReason === 'context_budget'
          ? '本轮已达到模型上下文容量，已停止继续执行并保留已有结果。请缩小问题范围，或根据模型实际能力调整上下文容量后继续。'
        : runtimeState.stopReason
          ? '本轮自动处理已停止，任务尚未全部完成。已有结果已保留；可以继续追问以调整方案。'
          : buildFallbackAssistantMessage(
        runtimeState.candidates,
        runtimeState.toolCallSummaries
      )
    }

    // 自动安装计划只是附加信息；来源接口失败时保留模型已生成的回答，而不是把整轮改判为失败。
    // 智能体本轮已经自己走安装预检/提交，或有待确认的操作时，不再额外生成一张计划卡，避免两套入口并存。
    const agentHandledInstall =
      runtimeState.stopReason === 'context_budget' ||
      runtimeState.pendingConfirmations.length > 0 ||
      runtimeState.toolCallSummaries.some((call) => AGENT_INSTALL_FLOW_TOOLS.has(call.name))
    let autoPlanResult
    try {
      autoPlanResult = agentHandledInstall
        ? { candidates: runtimeState.candidates, installPlan: null }
        : await resolveAiAgentAutoInstallPlan({
            candidates: runtimeState.candidates,
            context
          })
    } catch (error) {
      assertExecutionActive(execution)
      console.warn('[AI Agent] 自动安装计划生成失败，保留本轮回答：', toSafeText(error?.message))
      autoPlanResult = { candidates: runtimeState.candidates, installPlan: null }
    }

    const response = {
      success: true,
      configured: true,
      executionId: execution.executionId,
      agentTaskId: analysisTask?.taskId || '',
      engine: 'agent-v2',
      stopReason: runtimeState.stopReason || 'answered',
      assistantMessage,
      candidates: autoPlanResult.candidates,
      installPlan: attachInstallPlanConfirmation(autoPlanResult.installPlan, runtimeState.toolContext),
      confirmations: runtimeState.pendingConfirmations,
      toolCalls: [...parsedUserToolCalls, ...runtimeState.toolCallSummaries],
      ...(continuation ? { continuation: true } : {}),
      ...(runtimeState.protocolFallback ? { protocol: 'text', protocolFallbackReason: runtimeState.protocolFallback } : {})
    }
    response.outcome = resolveAiAgentOutcome(response)
    if (['failed', 'partial'].includes(response.outcome)) response.error = runtimeState.toolCallSummaries.find((call) => call.error)?.error
    if (runtimeState.stopReason === 'context_budget') {
      response.error = {
        kind: 'context',
        source: 'agent',
        code: 'agent_context',
        message: initialOverflow
          ? '上下文容量设置过小，本轮未执行任何操作。请在 AI 设置中核对容量。'
          : '本轮因上下文容量不足停止，尚未完成任务。请在 AI 设置中核对容量后再继续。',
        retryable: false,
        settings: true,
        settingsTarget: 'aiTranslation'
      }
    }
    await finishTrackedAnalysisTask(analysisTask, response, {
      executionId: execution.executionId
    })
    return response
  } catch (error) {
    const assistantMessage = normalizeAgentError(error)
    const failure = classifyAgentRunError(error)
    if (failure.kind === 'unknown') console.warn('[AI Agent] 请求异常', stringifyForModel({ name: error?.name, code: error?.code, source: failure.source, message: error?.message }))
    const cancelled =
      error?.name === 'AbortError' ||
      /request was aborted|aborted|cancelled|canceled/i.test(toSafeText(error?.message))
    const response = {
      success: false,
      configured: true,
      executionId: execution.executionId,
      agentTaskId: analysisTask?.taskId || '',
      engine: 'agent-v2',
      assistantMessage,
      error: failure,
      outcome: cancelled ? 'cancelled' : 'failed',
      candidates: runtimeState.candidates,
      confirmations: runtimeState.pendingConfirmations,
      toolCalls: [...parsedUserToolCalls, ...runtimeState.toolCallSummaries]
    }
    await finishTrackedAnalysisTask(analysisTask, response, {
      executionId: execution.executionId,
      cancelled,
      errorCode: cancelled ? 'agent_analysis_cancelled' : 'agent_analysis_failed'
    })
    return response
  } finally {
    clearExecution(execution.executionId)
  }
}

export function cancelAgentV2Execution(payload = {}) {
  const requestedExecutionId = toSafeText(payload?.executionId)
  const requestedTaskId = toSafeText(payload?.taskId || payload?.agentTaskId)
  let executionId = requestedExecutionId
  if ((!executionId || !activeExecutions.has(executionId)) && requestedTaskId) {
    executionId = activeExecutionTaskIndex.get(requestedTaskId) || ''
  }
  if (!executionId && !requestedExecutionId && !requestedTaskId) {
    executionId = latestExecutionId
  }
  if (!executionId || !activeExecutions.has(executionId)) {
    return {
      success: true,
      handled: false,
      taskId: requestedTaskId,
      executionId: requestedExecutionId,
      message: '当前没有正在执行的 AI 助手任务'
    }
  }
  const execution = activeExecutions.get(executionId)
  execution.controller.abort()
  return {
    success: true,
    handled: true,
    executionId,
    taskId: execution.taskId || requestedTaskId,
    cancelRequested: true,
    message: '已请求停止，正在等待本轮执行结束。'
  }
}

export function getAgentV2Status() {
  return {
    engine: 'agent-v2',
    permissionMode: getConfiguredAgentPermissionMode(),
    tools: listAgentV2Tools()
  }
}
