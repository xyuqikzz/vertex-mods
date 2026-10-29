import crypto from 'node:crypto'
import createInstalledAppIconCandidateWorker from './installedAppIconCandidateWorker.js?nodeWorker'

let worker = null
const pendingRequests = new Map()

function rejectPending(error) {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  pendingRequests.clear()
}

function ensureWorker() {
  if (worker) return worker
  worker = createInstalledAppIconCandidateWorker({ name: 'vertex-installed-app-icon-candidates' })
  worker.on('message', ({ requestId, candidates = [], error = '' }) => {
    const request = pendingRequests.get(requestId)
    if (!request) return
    pendingRequests.delete(requestId)
    clearTimeout(request.timer)
    if (error) {
      request.reject(new Error(error))
      return
    }
    request.resolve(Array.isArray(candidates) ? candidates : [])
  })
  worker.on('error', (error) => {
    rejectPending(error)
    worker = null
  })
  worker.on('exit', (code) => {
    if (code !== 0) rejectPending(new Error(`应用图标扫描 Worker 异常退出：${code}`))
    worker = null
  })
  return worker
}

export function resolveInstalledAppIconCandidates(payload = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('应用图标候选扫描超时'))
    }, timeoutMs)
    pendingRequests.set(requestId, { resolve, reject, timer })
    ensureWorker().postMessage({ requestId, payload })
  })
}
