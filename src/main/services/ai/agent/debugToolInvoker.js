import { getAgentPermissionMode } from './permissionPolicy.js'
import { randomUUID } from 'node:crypto'

const activeToolInvocations = new Map()

export function cancelAgentToolInvocation(payload = {}) {
  const executionId = String(payload.executionId || '').trim()
  const execution = activeToolInvocations.get(executionId)
  if (!execution) return null
  execution.controller.abort()
  return { success: true, handled: true, executionId, message: '正在停止工具执行。' }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function toPlainObject(value, fallback = {}) {
  const normalized = toPlainJson(value, fallback)
  return isPlainObject(normalized) ? normalized : fallback
}

function compactUndefined(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== 'undefined')
  )
}

export function normalizeDebugToolInvokePayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {}
  const context = toPlainObject(source.context ?? source.pageContext, {})
  const args = toPlainObject(source.args ?? source.arguments, {})

  const ctx = compactUndefined({
    sessionId: toSafeText(source.sessionId, context.sessionId),
    executionId: toSafeText(source.executionId, context.executionId),
    pageContext: context
  })

  return {
    name: toSafeText(source.name ?? source.toolName ?? source.tool),
    args,
    context,
    ctx
  }
}

export async function invokeAiAgentToolForDebug(payload = {}, options = {}) {
  const normalized = normalizeDebugToolInvokePayload(payload)
  if (!normalized.name) {
    return {
      success: false,
      errorCode: 'missing_tool_name',
      message: '缺少 Agent 工具名称。'
    }
  }

  const invokeTool =
    typeof options.invokeTool === 'function'
      ? options.invokeTool
      : (await import('./toolRegistryRuntime.js')).invokeAgentTool

  const settings = options.settings || (options.invokeTool ? {} :
    (await import('./tools/runtimeStore.js')).getRuntimeStore().get('systemConfig.settings') || {})
  return invokeConfirmedAgentTool(normalized.name, normalized.args, {
    ...normalized.ctx, mode: getAgentPermissionMode(settings), event: options.event || null
  }, { invokeTool })
}

// This entry is main-process only; IPC confirmation resolves its arguments from a snapshot.
export async function invokeConfirmedAgentTool(name, args, ctx, options = {}) {
  const normalized = { name, args, ctx }
  const invokeTool = options.invokeTool || (await import('./toolRegistryRuntime.js')).invokeAgentTool

  const executionId = normalized.ctx.executionId || randomUUID()
  if (activeToolInvocations.has(executionId)) {
    return { success: false, errorCode: 'execution_in_progress', message: '该操作正在执行，请勿重复提交。' }
  }
  const controller = new AbortController()
  const sender = ctx.event?.sender
  const onDestroyed = () => controller.abort()
  activeToolInvocations.set(executionId, { controller })
  sender?.once?.('destroyed', onDestroyed)
  try {
    return toPlainJson(
      await invokeTool(normalized.name, normalized.args, {
        ...normalized.ctx,
        executionId,
        signal: controller.signal,
        event: ctx.event || null
      }),
      {
        success: false,
        errorCode: 'invalid_tool_result',
        message: 'Agent 工具调试调用返回结果无法序列化。'
      }
    )
  } catch (error) {
    return {
      success: false,
      errorCode: 'debug_tool_invoke_failed',
      message: error?.message || 'Agent 工具调试调用失败。'
    }
  } finally {
    sender?.removeListener?.('destroyed', onDestroyed)
    activeToolInvocations.delete(executionId)
  }
}
