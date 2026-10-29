// One bounded worker queue keeps PE parsing off Electron's UI/main thread.
// Cancellation terminates only the current read-only analysis, never an install.
export function createAnalysisClient(factory, timeoutMs = 45000) {
  let worker,
    active,
    serial = 0,
    disposed = false
  const queue = []
  const abortError = () => Object.assign(new Error('检查已取消'), { code: 'analysis_cancelled' })
  function finish(error, value) {
    const job = active
    if (!job) return
    active = null
    clearTimeout(job.timer)
    job.signal?.removeEventListener('abort', job.abort)
    if (error) job.reject(error)
    else job.resolve(value)
    next()
  }
  function discard() {
    const previous = worker
    worker = null
    previous?.removeAllListeners()
    previous?.terminate().catch(() => {})
  }
  function next() {
    if (active || disposed || !queue.length) return
    active = queue.shift()
    try {
      if (!worker) {
        worker = factory()
        worker.on('message', (message) => {
          if (message.id !== active?.id) return
          finish(
            message.error
              ? Object.assign(new Error(message.error.message), { code: message.error.code })
              : null,
            message.value
          )
        })
        worker.on('error', (error) => {
          discard()
          finish(error)
        })
        worker.on('exit', () => {
          worker = null
          finish(new Error('扫描进程已退出，请重试'))
        })
      }
      active.timer = setTimeout(() => {
        discard()
        finish(new Error('扫描超时，请缩小到游戏安装文件夹后重试'))
      }, timeoutMs)
      worker.postMessage({ id: active.id, action: active.action, input: active.input })
    } catch (error) {
      discard()
      finish(error)
    }
  }
  function run(action, input, { signal } = {}) {
    if (disposed || signal?.aborted) return Promise.reject(abortError())
    if (queue.length >= 8) return Promise.reject(new Error('等待检查的任务过多，请稍后重试'))
    return new Promise((resolve, reject) => {
      const job = { id: ++serial, action, input, signal, resolve, reject }
      job.abort = () => {
        if (active === job) {
          discard()
          finish(abortError())
        } else {
          const index = queue.indexOf(job)
          if (index >= 0) queue.splice(index, 1)
          signal?.removeEventListener('abort', job.abort)
          reject(abortError())
        }
      }
      signal?.addEventListener('abort', job.abort, { once: true })
      queue.push(job)
      next()
    })
  }
  return {
    scan: (root, { signal, captureCandidates } = {}) =>
      run('scan', { root, captureCandidates }, { signal }),
    observe: (input, options) => run('observe', input, options),
    check: (input, options) => run('check', input, options),
    snapshot: (root) => run('snapshot', root),
    dispose() {
      disposed = true
      discard()
      finish(abortError())
      for (const job of queue.splice(0)) {
        job.signal?.removeEventListener('abort', job.abort)
        job.reject(abortError())
      }
    }
  }
}
