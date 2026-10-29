// A running Job may already have skipped the waiting item. Wait for that pass to
// finish before scheduling another pass, coalescing callbacks for the same Job.
export function createNexusTaskResumer({ getRunning, canResume, schedule }) {
  const pending = new Map()
  return function resume(jobId, message = '授权后继续任务失败') {
    if (pending.has(jobId)) return
    const active = getRunning(jobId)
    const ticket = {}
    pending.set(jobId, ticket)
    Promise.resolve(active).catch(() => {}).then(() => {
      queueMicrotask(() => {
        if (pending.get(jobId) !== ticket) return
        pending.delete(jobId)
        if (canResume(jobId)) schedule(jobId, message)
      })
    })
  }
}
