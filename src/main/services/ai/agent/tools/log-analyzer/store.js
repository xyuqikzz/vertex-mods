// 安装任务数据读取与依赖注入。
import { toSafeText, toSafeNumber, parseJsonObject } from './values.js'

const FAILURE_JOB_STATES = Object.freeze([
  'failed',
  'partial_failed',
  'precheck_blocked',
  'completed_with_warning',
  'recoverable'
])

function listJobsFromDatabase(database, filter = {}) {
  const where = []
  const params = []
  const state = toSafeText(filter.state)
  const source = toSafeText(filter.source)
  const gameKey = toSafeText(filter.gameKey || filter.game_key)
  const agentTaskId = toSafeText(filter.agentTaskId || filter.agent_task_id)
  const page = Math.max(1, toSafeNumber(filter.page, 1))
  const pageSize = Math.max(1, Math.min(100, toSafeNumber(filter.pageSize || filter.page_size, 20)))

  if (state) {
    where.push('state = ?')
    params.push(state)
  }
  if (source) {
    where.push('source = ?')
    params.push(source)
  }
  if (gameKey) {
    where.push('game_key = ?')
    params.push(gameKey)
  }
  if (agentTaskId) {
    where.push('agent_task_id = ?')
    params.push(agentTaskId)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const totalRow = database.get(
    `SELECT count(*) AS total FROM source_install_job ${whereSql}`,
    params
  )
  const records = database.all(
    `
      SELECT *
      FROM source_install_job
      ${whereSql}
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, pageSize, (page - 1) * pageSize]
  )

  return {
    records,
    total: toSafeNumber(totalRow?.total, 0),
    current: page,
    pageSize
  }
}

function getJobDetailFromDatabase(database, jobId = '') {
  const safeJobId = toSafeText(jobId)
  const job = database.get(`SELECT * FROM source_install_job WHERE job_id = ? LIMIT 1`, [safeJobId])
  if (!job) return null

  const items = database
    .all(`SELECT * FROM source_install_job_item WHERE job_id = ? ORDER BY id ASC`, [safeJobId])
    .map((item) => ({
      ...item,
      failure: parseJsonObject(item.failure_json, {}),
      health: parseJsonObject(item.health_json, {}),
      conflict: parseJsonObject(item.conflict_json, {}),
      installPlan: parseJsonObject(item.install_plan_json, {}),
      changeSet: parseJsonObject(item.change_set_json, {}),
      transaction: {
        transactionId: toSafeText(item.transaction_id),
        status: toSafeText(item.transaction_status || 'none'),
        rollbackStatus: toSafeText(item.rollback_status || 'none'),
        rollbackError: toSafeText(item.rollback_error)
      },
      metadata: parseJsonObject(item.metadata_json, {})
    }))
  const artifactKeys = [
    ...new Set(items.map((item) => toSafeText(item.artifact_key)).filter(Boolean))
  ]
  const artifacts = artifactKeys.length
    ? database.all(
        `SELECT * FROM source_install_artifact WHERE artifact_key IN (${artifactKeys
          .map(() => '?')
          .join(', ')})`,
        artifactKeys
      )
    : []
  const logs = database
    .all(
      `
        SELECT *
        FROM source_install_step_log
        WHERE job_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [safeJobId, 200]
    )
    .map((item) => ({
      ...item,
      detail: parseJsonObject(item.detail_json, {})
    }))

  return {
    ...job,
    job: {
      ...job,
      payload: parseJsonObject(job.payload_json, {}),
      precheck: parseJsonObject(job.precheck_json, {}),
      failure: parseJsonObject(job.failure_json, {}),
      health: parseJsonObject(job.health_json, {})
    },
    payload: parseJsonObject(job.payload_json, {}),
    precheck: parseJsonObject(job.precheck_json, {}),
    failure: parseJsonObject(job.failure_json, {}),
    health: parseJsonObject(job.health_json, {}),
    items,
    artifacts,
    logs
  }
}

export async function getDeps(overrides = {}) {
  const deps = { ...overrides }
  if (deps.db) {
    deps.listJobs = deps.listJobs || ((filter = {}) => listJobsFromDatabase(deps.db, filter))
    deps.getJobDetail =
      deps.getJobDetail || ((jobId = '') => getJobDetailFromDatabase(deps.db, jobId))
  }
  if (typeof deps.listJobs !== 'function' || typeof deps.getJobDetail !== 'function') {
    const taskStore = await import('../../../../../ipc/game/source-install-task/taskStore.js')
    deps.listJobs = deps.listJobs || taskStore.listJobs
    deps.getJobDetail = deps.getJobDetail || taskStore.getJobDetail
  }
  if (typeof deps.classifyInstallFailure !== 'function') {
    const failureClassifier = await import(
      '../../../../../ipc/game/source-install-task/failureClassifier.js'
    )
    deps.classifyInstallFailure = failureClassifier.classifyInstallFailure
  }
  return deps
}

export function listRecentFailureJobs(args = {}, deps = {}) {
  const limit = Math.max(1, Math.min(5, toSafeNumber(args.limit, 3)))
  const requestedState = toSafeText(args.state)
  const states = requestedState ? [requestedState] : FAILURE_JOB_STATES
  const rows = []
  for (const state of states) {
    const result = deps.listJobs({
      state,
      source: args.source,
      gameKey: args.gameKey,
      agentTaskId: args.agentTaskId,
      page: 1,
      pageSize: limit
    })
    const records = Array.isArray(result?.records) ? result.records : []
    rows.push(...records)
  }
  return rows
    .filter((row, index, list) => {
      const jobId = toSafeText(row.job_id || row.jobId)
      return (
        jobId && list.findIndex((item) => toSafeText(item.job_id || item.jobId) === jobId) === index
      )
    })
    .sort((left, right) =>
      toSafeText(right.updated_at || right.updatedAt).localeCompare(
        toSafeText(left.updated_at || left.updatedAt)
      )
    )
    .slice(0, limit)
}
