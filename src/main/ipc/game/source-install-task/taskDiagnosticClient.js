// 工作者生命周期独立于 Electron，便于用真实 Worker 验证失败与恢复路径。
export function createTaskDiagnosticClient(createWorker, { timeoutMs = 30_000 } = {}) {
  let worker = null
  let serial = 0
  const pending = new Map()

  function discardWorker(current, error) {
    if (worker !== current) return
    worker = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    void current.terminate().catch(() => {})
  }

  function ensureWorker() {
    if (worker) return worker
    const current = createWorker()
    worker = current
    current.on('message', ({ requestId, result, error }) => {
      if (worker !== current) return
      const request = pending.get(requestId)
      if (!request) return
      pending.delete(requestId)
      clearTimeout(request.timer)
      if (pending.size === 0) current.unref()
      if (error) request.reject(new Error(error))
      else request.resolve(result)
    })
    current.on('error', () => discardWorker(current, new Error('安装任务诊断工作线程异常')))
    current.on('exit', () => discardWorker(current, new Error('安装任务诊断工作线程已退出')))
    current.unref()
    return current
  }

  return function processDiagnostic(detail, format = '') {
    return new Promise((resolve, reject) => {
      let current
      try {
        current = ensureWorker()
        current.ref()
        const requestId = ++serial
        const timer = setTimeout(() => {
          discardWorker(current, new Error('安装任务诊断处理超时，请重试'))
        }, timeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        current.postMessage({ requestId, detail, format })
      } catch {
        const error = new Error('无法启动安装任务诊断处理')
        if (current) discardWorker(current, error)
        reject(error)
      }
    })
  }
}
