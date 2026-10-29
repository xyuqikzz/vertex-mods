import { all, buildUpdateSql, get, run } from './db.js'
import { JOB_STATE, nowIso, stringifyJson, toSafeNumber, toSafeText } from '../contracts.js'
import {
  getInstallTaskStatesForGroup,
  INSTALL_TASK_STATE_GROUP,
  summarizeInstallTaskStates
} from '../../../../../shared/tasks/install-task-center-policy.js'
import {
  sanitizeSourceInstallTaskDiagnostic,
  sanitizeSourceInstallTaskPayloadForPersistence
} from '../taskSecurity.js'
import { buildSourceInstallTaskListRecord } from '../taskSummary.js'

export function insertJob(job = {}) {
  const now = nowIso()
  run(
    `
      INSERT INTO source_install_job
        (job_id, agent_task_id, source, source_adapter, game_key, game_root, title, state, progress,
         current_step, error_message, precheck_status, precheck_json, failure_stage, failure_json,
         health_status, health_json, warning_count, blocker_count, payload_json, created_at,
         updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      toSafeText(job.job_id),
      toSafeText(job.agent_task_id || job.agentTaskId),
      toSafeText(job.source, 'nexus'),
      toSafeText(job.source_adapter || job.sourceAdapter || job.source, 'nexus'),
      toSafeText(job.game_key || job.gameKey),
      toSafeText(job.game_root || job.gameRoot),
      toSafeText(job.title, '安装任务'),
      toSafeText(job.state, JOB_STATE.CREATED),
      toSafeNumber(job.progress, 0),
      toSafeText(job.current_step || job.currentStep),
      toSafeText(job.error_message || job.errorMessage),
      toSafeText(job.precheck_status || job.precheckStatus),
      stringifyJson(job.precheck_json ?? job.precheck ?? {}, '{}'),
      toSafeText(job.failure_stage || job.failureStage),
      stringifyJson(job.failure_json ?? job.failure ?? {}, '{}'),
      toSafeText(job.health_status || job.healthStatus),
      stringifyJson(job.health_json ?? job.health ?? {}, '{}'),
      toSafeNumber(job.warning_count || job.warningCount, 0),
      toSafeNumber(job.blocker_count || job.blockerCount, 0),
      stringifyJson(
        sanitizeSourceInstallTaskPayloadForPersistence(job.payload_json ?? job.payload ?? {}),
        '{}'
      ),
      toSafeText(job.created_at, now),
      toSafeText(job.updated_at, now),
      toSafeText(job.completed_at || job.completedAt)
    ]
  )
}

export function updateJob(jobId = '', patch = {}) {
  const safeJobId = toSafeText(jobId)
  if (!safeJobId) return
  const nextPatch = { ...patch }
  if (
    [
      JOB_STATE.COMPLETED,
      JOB_STATE.COMPLETED_WITH_WARNING,
      JOB_STATE.PARTIAL_FAILED,
      JOB_STATE.FAILED,
      JOB_STATE.CANCELLED
    ].includes(nextPatch.state) &&
    !nextPatch.completed_at
  ) {
    nextPatch.completed_at = nowIso()
  }
  const { sql, params } = buildUpdateSql('source_install_job', 'job_id', safeJobId, nextPatch)
  run(sql, params)
}

export function appendTaskLog(jobId = '', itemId = '', level = 'info', message = '', detail = {}) {
  run(
    `
      INSERT INTO source_install_step_log (job_id, item_id, level, message, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      toSafeText(jobId),
      toSafeText(itemId),
      toSafeText(level, 'info'),
      toSafeText(sanitizeSourceInstallTaskDiagnostic(message)),
      stringifyJson(sanitizeSourceInstallTaskDiagnostic(detail), '{}'),
      nowIso()
    ]
  )
}

export function getJob(jobId = '') {
  return get(`SELECT * FROM source_install_job WHERE job_id = ? LIMIT 1`, [toSafeText(jobId)])
}

export function listJobs(filter = {}) {
  const where = []
  const params = []
  const state = toSafeText(filter.state)
  const source = toSafeText(filter.source)
  const gameKey = toSafeText(filter.gameKey || filter.game_key)
  const agentTaskId = toSafeText(filter.agentTaskId || filter.agent_task_id)
  const stateGroup = toSafeText(filter.stateGroup || filter.state_group).toLowerCase()
  const page = Math.max(1, toSafeNumber(filter.page, 1))
  const pageSize = Math.max(1, Math.min(100, toSafeNumber(filter.pageSize || filter.page_size, 20)))

  if (state) {
    where.push('state = ?')
    params.push(state)
  } else if (stateGroup) {
    const states = resolveFilterStates(stateGroup)
    if (states.length) {
      where.push(`state IN (${states.map(() => '?').join(', ')})`)
      params.push(...states)
    }
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
  const totalRow = get(`SELECT count(*) AS total FROM source_install_job ${whereSql}`, params)
  const records = all(
    `
      SELECT *
      FROM source_install_job
      ${whereSql}
      ORDER BY
        CASE
          WHEN state IN (${getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ATTENTION)
            .map(() => '?')
            .join(', ')}) THEN 0
          WHEN state IN (${getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ACTIVE)
            .map(() => '?')
            .join(', ')}) THEN 1
          WHEN state IN (${getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.FAILED)
            .map(() => '?')
            .join(', ')}) THEN 2
          ELSE 3
        END,
        datetime(updated_at) DESC,
        id DESC
      LIMIT ? OFFSET ?
    `,
    [
      ...params,
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ATTENTION),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ACTIVE),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.FAILED),
      pageSize,
      (page - 1) * pageSize
    ]
  )

  return {
    records,
    total: toSafeNumber(totalRow?.total, 0),
    current: page,
    pageSize
  }
}

export function listPublicJobs(filter = {}) {
  const result = listJobs(filter)
  return {
    ...result,
    records: result.records.map(buildSourceInstallTaskListRecord)
  }
}

function resolveFilterStates(stateGroup = '') {
  if (stateGroup === 'pending') {
    return [
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ACTIVE),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ATTENTION),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.FAILED)
    ]
  }
  if (stateGroup === 'history') {
    return [
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.COMPLETED),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.CANCELLED)
    ]
  }
  if (stateGroup === 'needs_action') {
    return [
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.ATTENTION),
      ...getInstallTaskStatesForGroup(INSTALL_TASK_STATE_GROUP.FAILED)
    ]
  }
  return getInstallTaskStatesForGroup(stateGroup)
}

export function summarizeJobs() {
  const rows = all(
    `
      SELECT state, count(*) AS count
      FROM source_install_job
      GROUP BY state
    `
  )
  const byState = {}
  rows.forEach((row) => {
    const state = toSafeText(row?.state)
    const count = toSafeNumber(row?.count, 0)
    if (!state) return
    byState[state] = count
  })
  const summary = summarizeInstallTaskStates(byState)
  return {
    ...summary,
    visibleCount: summary.badgeCount
  }
}

export function getJobLogs(jobId = '', limit = 200) {
  return all(
    `
      SELECT *
      FROM source_install_step_log
      WHERE job_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [toSafeText(jobId), Math.max(1, Math.min(500, toSafeNumber(limit, 200)))]
  )
}
