import { randomUUID } from 'node:crypto'
import { classifyAiAgentError } from '../../../../shared/ai/conversation/ai-agent-error.js'
import { resolveAiAgentOutcome } from '../../../../shared/ai/conversation/ai-agent-outcome.js'

// One authority across both renderer windows. A cancellation request keeps the
// lease until the actual operation settles; it cannot unlock a newer request.
export function createConversationExecutionCoordinator() {
  let active = null
  const settled = new Map()
  const notify = (callback, ...args) => {
    try {
      callback?.(...args)
    } catch {
      console.warn('[AI Agent] 会话状态通知失败，执行状态仍保留。')
    }
  }
  const state = () =>
    active
      ? {
          executionId: active.executionId,
          sessionId: active.sessionId,
          senderId: active.senderId,
          cancelRequested: active.cancelRequested
        }
      : null
  return {
    state,
    getResult: (id) => settled.get(id),
    async run(payload, options, execute) {
      if (active)
        return {
          success: false,
          accepted: false,
          errorCode: 'agent_busy',
          assistantMessage: '另一轮处理尚未结束，请等待或停止后再发送。',
          active: state()
        }
      const executionId = String(payload.executionId || randomUUID())
      if (settled.has(executionId)) {
        const previous = settled.get(executionId)
        return previous.payload.sessionId === payload.sessionId &&
          previous.senderId === options.event?.sender?.id
          ? previous.result
          : {
              success: false,
              accepted: false,
              assistantMessage: '请求标识与会话不匹配，请重新发送。'
            }
      }
      const lease = {
        executionId,
        sessionId: String(payload.sessionId || ''),
        senderId: options.event?.sender?.id,
        cancelRequested: false,
        onState: options.onState
      }
      active = lease
      notify(options.onState, state())
      const sender = options.event?.sender
      const onDestroyed = () => options.cancel?.({ executionId })
      sender?.once?.('destroyed', onDestroyed)
      try {
        let result
        try {
          result = await execute({ ...payload, executionId }, options)
        } catch (error) {
          // 编排器已自行处理模型错误；能抛到这里的是本地流程异常，不应提示成 AI 服务故障。
          const failure = classifyAiAgentError(error, {
            source: error?.vertexErrorSource || (/^nexus_/i.test(String(error?.code || '')) ? 'nexus' : 'agent')
          })
          result = { success: false, error: failure, assistantMessage: failure.message }
        }
        result = { ...result, sessionId: lease.sessionId, executionId, accepted: true }
        result.outcome = resolveAiAgentOutcome(result)
        settled.set(executionId, { payload, result, senderId: lease.senderId })
        while (settled.size > 40) settled.delete(settled.keys().next().value)
        notify(options.onSettled, payload, result)
        return result
      } finally {
        sender?.removeListener?.('destroyed', onDestroyed)
        if (active === lease) active = null
        notify(options.onState, state())
      }
    },
    async cancel(payload, cancel) {
      if (!payload.executionId) return { success: false, message: '缺少要停止的请求标识。' }
      if (!active || active.executionId !== payload.executionId) {
        if (settled.has(payload.executionId))
          return { success: true, settled: true, result: settled.get(payload.executionId).result }
        // Script/debug invocations have their own registry. Keep exact-ID routing.
        return await cancel(payload)
      }
      active.cancelRequested = true
      notify(active.onState, state())
      const response = await cancel(payload)
      return { ...response, cancelRequested: true, settled: false }
    }
  }
}

export const conversationExecutions = createConversationExecutionCoordinator()
