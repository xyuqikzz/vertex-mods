/**
 * 长耗时 Agent 工具的取消信号检查工具。
 *
 * orchestrator 在 toolContext 中注入 signal（来自当前 execution 的 AbortController）。
 * 长耗时工具（安装预检、安装提交、回滚、冲突修复、生命周期执行等）应在关键点调用
 * assertToolExecutionActive(signal) 检查取消状态，并在 abort 时抛出 AbortError，
 * 让 toolRegistry 识别为取消而非失败。
 */

const ABORT_ERROR_NAME = 'AbortError'
const ABORT_ERROR_MESSAGE = 'AI 助手工具执行已取消'

export class AgentToolAbortError extends Error {
  constructor(message = ABORT_ERROR_MESSAGE) {
    super(message)
    this.name = ABORT_ERROR_NAME
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AgentToolAbortError)
    }
  }
}

export function isAgentToolAbortError(error = null) {
  return (
    error?.name === ABORT_ERROR_NAME ||
    error?.code === 'ABORT_ERR' ||
    /abort/i.test(String(error?.message || ''))
  )
}

/**
 * 检查 signal 是否已 abort，若是则抛出 AgentToolAbortError。
 * signal 为空/未提供时为 no-op，保留对无 signal 调用路径的兼容。
 */
export function assertToolExecutionActive(signal = null) {
  if (signal?.aborted === true) {
    throw new AgentToolAbortError()
  }
}
