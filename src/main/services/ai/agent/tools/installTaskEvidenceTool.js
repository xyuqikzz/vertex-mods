import { assertToolExecutionActive } from './toolAbortUtils.js'

export function summarizeInstallVerification(result = {}) {
  const data = result.data || result
  const job = data.job || data
  const state = job.state || ''
  const health = data.health || job.health || {}
  const finished = ['completed', 'completed_with_warning'].includes(state)
  return {
    state,
    verified: result.success !== false && finished && health.status === 'passed',
    completionState: finished
      ? health.status === 'passed'
        ? 'verified'
        : 'needs_review'
      : state || 'unknown',
    health,
    gameLoadVerified: false
  }
}

export async function getInstallTaskEvidenceTool(args = {}, ctx = {}, deps = {}) {
  assertToolExecutionActive(ctx.signal)
  const getDetail =
    deps.getDetail ||
    (await import('../../../../ipc/game/source-install-task/orchestrator.js'))
      .getSourceInstallTaskDetail
  const result = await getDetail({ jobId: args.jobId })
  if (result.success === false) return result
  const data = result.data || {}
  const all = data.items || []
  const offset = Math.max(0, Math.trunc(Number(args.offset) || 0))
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(args.limit) || 10)))
  const items = all.slice(offset, offset + limit)
  return {
    ...result,
    data: { ...data, items },
    jobId: args.jobId,
    ...summarizeInstallVerification(result),
    page: {
      offset,
      total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null
    },
    selectionRequests: items.flatMap((item) => {
      const request = item.metadata?.selectionRequest || item.selectionRequest
      return request ? [{ itemId: item.item_id || item.itemId, selectionRequest: request }] : []
    }),
    message: '只有任务完成且 health.status=passed 才能报告安装写后核验通过；游戏内加载需另行验证。'
  }
}
