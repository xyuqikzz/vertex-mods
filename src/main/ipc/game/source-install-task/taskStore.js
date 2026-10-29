import dbInstance from '../../../db/dbInstance.js'
import { all, ensureSourceInstallTaskTables as ensureTables, run } from './store/db.js'
import { getJob, getJobLogs } from './store/jobStore.js'
import { getJobItems } from './store/itemStore.js'
import { createJobDeletionStore } from './store/jobDeletionStore.js'
import { buildNexusAuthorizationTaskSnapshot } from './nexusAuthorizationTask.js'
import createTaskDiagnosticWorker from './taskDiagnosticWorker.js?nodeWorker'
import { createTaskDiagnosticClient } from './taskDiagnosticClient.js'
import {
  sanitizeSourceInstallTaskDiagnostic,
  sanitizeSourceInstallTaskPayloadForPersistence
} from './taskSecurity.js'
import {
  ARTIFACT_STATE,
  ITEM_STATE,
  JOB_STATE,
  nowIso,
  parseJsonObject,
  stringifyJson,
  toSafeText
} from './contracts.js'

const processTaskDiagnostic = createTaskDiagnosticClient(() =>
  createTaskDiagnosticWorker({ name: 'vertex-install-task-diagnostic' })
)

function sanitizeStoredJson(value = '', mode = 'diagnostic') {
  const parsed = parseJsonObject(value, {})
  const sanitized =
    mode === 'payload'
      ? sanitizeSourceInstallTaskPayloadForPersistence(parsed)
      : sanitizeSourceInstallTaskDiagnostic(parsed)
  return stringifyJson(sanitized, '{}')
}

export function sanitizePersistedSourceInstallTaskData() {
  const jobs = all(
    `SELECT job_id, payload_json, precheck_json, failure_json, health_json FROM source_install_job`
  )
  jobs.forEach((job) => {
    const patch = {
      payload_json: sanitizeStoredJson(job.payload_json, 'payload'),
      precheck_json: sanitizeStoredJson(job.precheck_json),
      failure_json: sanitizeStoredJson(job.failure_json),
      health_json: sanitizeStoredJson(job.health_json)
    }
    run(
      `UPDATE source_install_job SET payload_json = ?, precheck_json = ?, failure_json = ?, health_json = ? WHERE job_id = ?`,
      [patch.payload_json, patch.precheck_json, patch.failure_json, patch.health_json, job.job_id]
    )
  })

  const items = all(
    `SELECT item_id, metadata_json, failure_json, health_json, conflict_json, install_plan_json, change_set_json FROM source_install_job_item`
  )
  items.forEach((item) => {
    run(
      `UPDATE source_install_job_item
       SET metadata_json = ?, failure_json = ?, health_json = ?, conflict_json = ?,
           install_plan_json = ?, change_set_json = ?
       WHERE item_id = ?`,
      [
        sanitizeStoredJson(item.metadata_json, 'payload'),
        sanitizeStoredJson(item.failure_json),
        sanitizeStoredJson(item.health_json),
        sanitizeStoredJson(item.conflict_json),
        sanitizeStoredJson(item.install_plan_json),
        sanitizeStoredJson(item.change_set_json),
        item.item_id
      ]
    )
  })

  const logs = all(`SELECT id, message, detail_json FROM source_install_step_log`)
  logs.forEach((log) => {
    run(`UPDATE source_install_step_log SET message = ?, detail_json = ? WHERE id = ?`, [
      String(sanitizeSourceInstallTaskDiagnostic(log.message) || ''),
      sanitizeStoredJson(log.detail_json),
      log.id
    ])
  })
  run(`UPDATE source_install_artifact SET download_url = '' WHERE lower(source) = 'nexus'`)
  const downloadRecordTable = all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'download_records' LIMIT 1`
  )
  if (downloadRecordTable.length) {
    const downloadRecordColumns = new Set(
      all(`PRAGMA table_info(download_records)`).map((column) => String(column?.name || ''))
    )
    if (downloadRecordColumns.has('source_platform') && downloadRecordColumns.has('download_url')) {
      run(`UPDATE download_records SET download_url = '' WHERE lower(source_platform) = 'nexus'`)
    }
  }
}

export function ensureSourceInstallTaskTables() {
  ensureTables()
  sanitizePersistedSourceInstallTaskData()
}

/**
 * 在单个 SQLite 事务内执行同步写入操作。
 *
 * 约束：传入的 operations 必须是同步函数（禁止 await），better-sqlite3 的
 * 事务 API 不支持异步操作；任一步抛错会整体回滚，避免留下脏数据。
 *
 * @param {Function} operations 仅包含同步 DB 操作的函数
 * @returns {*} dbInstance.transaction 的返回值
 */
export function runInTransaction(operations) {
  if (typeof operations !== 'function') {
    throw new TypeError('runInTransaction 需要一个同步函数参数')
  }
  let result
  dbInstance.transaction(() => {
    result = operations()
  })
  return result
}

const jobDeletionStore = createJobDeletionStore({ all, run, transaction: runInTransaction })
export {
  insertJob,
  updateJob,
  appendTaskLog,
  getJob,
  listJobs,
  listPublicJobs,
  summarizeJobs,
  getJobLogs
} from './store/jobStore.js'
export {
  insertItem,
  updateItem,
  getJobItems,
  getItemsByArtifactKey,
  findInstalledModByItem,
  parseItemMetadata,
  parseItemDependencyRefs
} from './store/itemStore.js'
export {
  upsertArtifact,
  updateArtifact,
  getArtifactByKey,
  getArtifactByDownloadTaskId,
  isArtifactFileAvailable
} from './store/artifactStore.js'

export function getJobDetail(jobId = '') {
  const job = getJob(jobId)
  if (!job) {
    return null
  }
  const items = getJobItems(jobId).map((item) => ({
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
    ? all(
        `SELECT * FROM source_install_artifact WHERE artifact_key IN (${artifactKeys
          .map(() => '?')
          .join(', ')})`,
        artifactKeys
      )
    : []
  const logs = getJobLogs(jobId)
  const parsedJob = {
    ...job,
    payload: parseJsonObject(job.payload_json, {}),
    precheck: parseJsonObject(job.precheck_json, {}),
    failure: parseJsonObject(job.failure_json, {}),
    health: parseJsonObject(job.health_json, {})
  }
  return {
    ...job,
    job: parsedJob,
    payload: parsedJob.payload,
    precheck: parsedJob.precheck,
    failure: parsedJob.failure,
    health: parsedJob.health,
    items,
    artifacts,
    logs: logs.map((item) => ({
      ...item,
      detail: parseJsonObject(item.detail_json, {})
    }))
  }
}

export function clearCompletedJobs() {
  const targetStates = [JOB_STATE.COMPLETED, JOB_STATE.COMPLETED_WITH_WARNING, JOB_STATE.CANCELLED]
  const ids = all(
    `SELECT job_id FROM source_install_job WHERE state IN (${targetStates.map(() => '?').join(', ')})`,
    targetStates
  ).map((row) => row.job_id)
  if (!ids.length) {
    return { success: true, changes: 0, deletedIds: [], rejected: [], reasonCode: '' }
  }
  return jobDeletionStore.deleteJobsByIds(ids, {
    expectedStates: Object.fromEntries(ids.map((jobId) => [jobId, getJob(jobId)?.state || '']))
  })
}

export async function getPublicJobDetail(jobId = '', options = {}) {
  const detail = getJobDetail(jobId)
  if (!detail) return null
  return processTaskDiagnostic({
    ...detail,
    nexusAuthorization: buildNexusAuthorizationTaskSnapshot(detail)
  }, options.format)
}

export function deleteJobsByIds(jobIds = [], options = {}) {
  return jobDeletionStore.deleteJobsByIds(jobIds, options)
}

export function markStartupRecoverableTasks() {
  const now = nowIso()
  run(
    `
      UPDATE source_install_job_item
      SET state = ?, error_message = ?, failure_stage = ?, failure_json = ?, updated_at = ?
      WHERE state = ?
    `,
    [
      ITEM_STATE.WAITING_AUTHORIZATION,
      '客户端重启后需要重新完成 Nexus 授权',
      'nexus_authorization_required',
      stringifyJson({
        code: 'nexus_authorization_required',
        stage: 'nexus_authorization',
        message: '客户端重启后需要重新完成 Nexus 授权',
        recoverable: true
      }),
      now,
      ITEM_STATE.AUTHENTICATING
    ]
  )
  run(
    `
      UPDATE source_install_job
      SET state = ?, current_step = ?, error_message = '', updated_at = ?
      WHERE state = ?
    `,
    [JOB_STATE.WAITING_USER_ACTION, '等待 Nexus 授权', now, JOB_STATE.WAITING_USER_ACTION]
  )
  const recoverableJobStates = [
    JOB_STATE.PRECHECKING,
    JOB_STATE.RESOLVING,
    JOB_STATE.QUEUED,
    JOB_STATE.DOWNLOADING,
    JOB_STATE.DOWNLOADED,
    JOB_STATE.PREVIEWING,
    JOB_STATE.INSTALLING,
    JOB_STATE.HEALTH_CHECKING,
    JOB_STATE.WAITING
  ]
  const artifactStates = [ARTIFACT_STATE.QUEUED, ARTIFACT_STATE.DOWNLOADING]
  const itemStates = [
    ITEM_STATE.PRECHECKING,
    ITEM_STATE.WAITING_DEPENDENCY,
    ITEM_STATE.WAITING_ARTIFACT,
    ITEM_STATE.DOWNLOADING,
    ITEM_STATE.INSPECTING_ARCHIVE,
    ITEM_STATE.PREVIEWING,
    ITEM_STATE.WAITING_INSTALL,
    ITEM_STATE.INSTALLING,
    ITEM_STATE.DEPLOYING,
    ITEM_STATE.RECORDING,
    ITEM_STATE.HEALTH_CHECKING
  ]

  run(
    `
      UPDATE source_install_job
      SET state = ?, current_step = ?, failure_stage = ?, failure_json = ?, updated_at = ?
      WHERE state IN (${recoverableJobStates.map(() => '?').join(', ')})
    `,
    [
      JOB_STATE.RECOVERABLE,
      '客户端重启后需要恢复',
      'task_recovery_required',
      stringifyJson({
        stage: 'task_recovery_required',
        message: '客户端重启后任务中断，需要重新预检后重试',
        userAction: '可在安装任务中心点击重试',
        recoverable: true
      }),
      now,
      ...recoverableJobStates
    ]
  )
  run(
    `
      UPDATE source_install_job_item
      SET state = ?, error_message = ?, failure_stage = ?, failure_json = ?, updated_at = ?
      WHERE state IN (${itemStates.map(() => '?').join(', ')})
    `,
    [
      ITEM_STATE.FAILED,
      '客户端重启后任务中断，可在安装任务中心重试',
      'task_recovery_required',
      stringifyJson({
        stage: 'task_recovery_required',
        message: '客户端重启后安装项中断',
        userAction: '重试任务会复用已下载文件并重新预检',
        recoverable: true
      }),
      now,
      ...itemStates
    ]
  )
  run(
    `
      UPDATE source_install_artifact
      SET state = ?, error_message = ?, updated_at = ?
      WHERE state IN (${artifactStates.map(() => '?').join(', ')})
    `,
    [ARTIFACT_STATE.FAILED, '客户端重启后下载状态不可确认，可重试任务', now, ...artifactStates]
  )
}

export function resetJobForRetry(jobId = '') {
  const detail = getJobDetail(jobId)
  if (!detail) {
    return null
  }
  const now = nowIso()
  run(
    `
      UPDATE source_install_job
      SET state = ?, progress = 0, current_step = ?, error_message = '',
          failure_stage = '', failure_json = '{}', health_status = '', health_json = '{}',
          warning_count = 0, blocker_count = 0, completed_at = '', updated_at = ?
      WHERE job_id = ?
    `,
    [JOB_STATE.QUEUED, '等待重试', now, toSafeText(jobId)]
  )
  run(
    `
      UPDATE source_install_job_item
      SET state = ?, progress = 0, error_message = '', failure_stage = '', failure_json = '{}',
          health_status = '', health_json = '{}', conflict_json = '{}', install_plan_json = '{}',
          change_set_json = '{}', transaction_id = '', transaction_status = 'none',
          rollback_status = 'none', rollback_error = '', updated_at = ?
      WHERE job_id = ?
        AND state IN (?, ?, ?, ?)
    `,
    [
      ITEM_STATE.CREATED,
      now,
      toSafeText(jobId),
      ITEM_STATE.FAILED,
      ITEM_STATE.CANCELLED,
      ITEM_STATE.WAITING_ARTIFACT,
      ITEM_STATE.PRECHECK_BLOCKED
    ]
  )

  const artifactKeys = detail.items.map((item) => toSafeText(item.artifact_key)).filter(Boolean)
  if (artifactKeys.length) {
    run(
      `
        UPDATE source_install_artifact
        SET state = ?, error_message = '', updated_at = ?
        WHERE artifact_key IN (${artifactKeys.map(() => '?').join(', ')})
          AND state IN (?, ?, ?)
      `,
      [
        ARTIFACT_STATE.CREATED,
        now,
        ...artifactKeys,
        ARTIFACT_STATE.FAILED,
        ARTIFACT_STATE.CANCELLED,
        ARTIFACT_STATE.MISSING
      ]
    )
  }

  return getJobDetail(jobId)
}
