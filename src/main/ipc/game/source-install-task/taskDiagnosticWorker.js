import { parentPort } from 'node:worker_threads'
import { buildPublicSourceInstallTaskDetail } from './taskSecurity.js'

parentPort.on('message', ({ requestId, detail, format }) => {
  try {
    const sanitized = buildPublicSourceInstallTaskDetail(detail)
    const result = format === 'diagnostic-json'
      ? JSON.stringify({
          task: sanitized.job || {},
          precheck: sanitized.precheck || {},
          failure: sanitized.failure || {},
          health: sanitized.health || {},
          items: sanitized.items || [],
          artifacts: sanitized.artifacts || [],
          logs: sanitized.logs || []
        }, null, 2)
      : sanitized
    parentPort.postMessage({ requestId, result })
  } catch {
    // 异常中可能包含原始诊断或凭据，只返回固定错误信息。
    parentPort.postMessage({ requestId, error: '安装任务诊断处理失败' })
  }
})
