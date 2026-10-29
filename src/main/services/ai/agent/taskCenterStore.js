import crypto from 'crypto'

export const AGENT_TASK_STAGE = Object.freeze({
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  CANCELLING: 'cancelling',
  WAITING_CONFIRMATION: 'waiting_confirmation',
  PARTIAL: 'partial',
  SUBMITTED: 'submitted',
  SEARCHING: 'searching',
  RESOLVING_DEPENDENCIES: 'resolving_dependencies',
  DOWNLOADING: 'downloading',
  INSPECTING: 'inspecting',
  PLANNING: 'planning',
  DETECTING_CONFLICTS: 'detecting_conflicts',
  BACKING_UP: 'backing_up',
  INSTALLING: 'installing',
  VERIFYING: 'verifying',
  REPAIRING: 'repairing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ROLLBACKING: 'rollbacking',
  ROLLED_BACK: 'rolled_back'
})

const STAGE_SET = new Set(Object.values(AGENT_TASK_STAGE))
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const readyDatabases = new WeakSet()

function assertDatabase(database) {
  if (
    !database ||
    typeof database !== 'object' ||
    typeof database.run !== 'function' ||
    typeof database.get !== 'function' ||
    typeof database.all !== 'function'
  ) {
    throw new Error('agent_task database is not available')
  }
}

function clearStatementCache(database) {
  if (typeof database.clearStatementCache === 'function') {
    database.clearStatementCache()
  }
}

function runSchema(database, sql, params = []) {
  clearStatementCache(database)
  const result = database.run(sql, params)
  clearStatementCache(database)
  return result
}

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function stringifyJson(value, fallback = null) {
  if (value === undefined) return fallback
  try {
    return JSON.stringify(value ?? fallback)
  } catch {
    return JSON.stringify(fallback)
  }
}

function parseJson(value, fallback = null) {
  const text = toSafeText(value)
  if (!text) return fallback

  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function nowIso() {
  return new Date().toISOString()
}

function clampProgress(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

function normalizeStage(stage = '') {
  const safeStage = toSafeText(stage)
  return STAGE_SET.has(safeStage) ? safeStage : AGENT_TASK_STAGE.QUEUED
}

function normalizeLimit(value = DEFAULT_LIMIT) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(number)))
}

export function createAgentTaskId(type = 'agent') {
  const safeType = toSafeText(type, 'agent').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'agent'
  if (typeof crypto.randomUUID === 'function') {
    return `agent:${safeType}:${crypto.randomUUID()}`
  }
  return `agent:${safeType}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

export function ensureAgentTaskSchemaForDatabase(database) {
  assertDatabase(database)
  if (readyDatabases.has(database)) return

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS agent_task (
      task_id TEXT PRIMARY KEY,
      session_id TEXT,
      type TEXT NOT NULL,
      stage TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      current_target TEXT,
      error_code TEXT,
      error_message TEXT,
      cancelable INTEGER DEFAULT 0,
      linked_job_id TEXT,
      plan_json TEXT,
      result_json TEXT,
      backup_ref TEXT,
      authorization_mode TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_task_session_updated
    ON agent_task(session_id, updated_at)
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_task_stage
    ON agent_task(stage)
  `
  )
  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS agent_task_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    )
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_task_log_task_created
    ON agent_task_log(task_id, created_at)
  `
  )

  readyDatabases.add(database)
}

export function normalizeAgentTaskRow(row = null) {
  if (!row) return null

  return {
    taskId: toSafeText(row.task_id),
    sessionId: toSafeText(row.session_id),
    type: toSafeText(row.type),
    stage: normalizeStage(row.stage),
    progress: clampProgress(row.progress),
    currentTarget: toSafeText(row.current_target),
    errorCode: toSafeText(row.error_code),
    errorMessage: toSafeText(row.error_message),
    cancelable: Number(row.cancelable) === 1,
    linkedJobId: toSafeText(row.linked_job_id),
    plan: parseJson(row.plan_json, null),
    result: parseJson(row.result_json, null),
    backupRef: toSafeText(row.backup_ref),
    authorizationMode: toSafeText(row.authorization_mode),
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

export async function createAgentTaskInDatabase(database, options = {}) {
  ensureAgentTaskSchemaForDatabase(database)
  const createdAt = nowIso()
  const task = {
    taskId: toSafeText(options.taskId) || createAgentTaskId(options.type),
    sessionId: toSafeText(options.sessionId),
    type: toSafeText(options.type, 'agent_task') || 'agent_task',
    stage: normalizeStage(options.stage || AGENT_TASK_STAGE.QUEUED),
    progress: clampProgress(options.progress),
    currentTarget: toSafeText(options.currentTarget),
    errorCode: toSafeText(options.errorCode),
    errorMessage: toSafeText(options.errorMessage),
    cancelable: options.cancelable === true ? 1 : 0,
    linkedJobId: toSafeText(options.linkedJobId),
    planJson: stringifyJson(options.plan ?? options.planJson, null),
    resultJson: stringifyJson(options.result ?? options.resultJson, null),
    backupRef: toSafeText(options.backupRef),
    authorizationMode: toSafeText(options.authorizationMode),
    createdAt
  }

  database.run(
    `
      INSERT INTO agent_task (
        task_id,
        session_id,
        type,
        stage,
        progress,
        current_target,
        error_code,
        error_message,
        cancelable,
        linked_job_id,
        plan_json,
        result_json,
        backup_ref,
        authorization_mode,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      task.taskId,
      task.sessionId,
      task.type,
      task.stage,
      task.progress,
      task.currentTarget,
      task.errorCode,
      task.errorMessage,
      task.cancelable,
      task.linkedJobId,
      task.planJson,
      task.resultJson,
      task.backupRef,
      task.authorizationMode,
      task.createdAt,
      task.createdAt
    ]
  )

  return await getAgentTaskFromDatabase(database, task.taskId)
}

export async function getAgentTaskFromDatabase(database, taskId = '') {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  ensureAgentTaskSchemaForDatabase(database)
  return normalizeAgentTaskRow(
    database.get(
      `
        SELECT *
        FROM agent_task
        WHERE task_id = ?
      `,
      [safeTaskId]
    )
  )
}

export async function listAgentTasksFromDatabase(database, options = {}) {
  ensureAgentTaskSchemaForDatabase(database)
  const limit = normalizeLimit(options.limit)
  const sessionId = toSafeText(options.sessionId)

  if (sessionId) {
    return database
      .all(
        `
          SELECT *
          FROM agent_task
          WHERE session_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `,
        [sessionId, limit]
      )
      .map((row) => normalizeAgentTaskRow(row))
  }

  return database
    .all(
      `
        SELECT *
        FROM agent_task
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      [limit]
    )
    .map((row) => normalizeAgentTaskRow(row))
}

export async function updateAgentTaskInDatabase(database, taskId = '', patch = {}) {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  ensureAgentTaskSchemaForDatabase(database)
  const updates = []
  const params = []
  const addUpdate = (column, value) => {
    updates.push(`${column} = ?`)
    params.push(value)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'stage')) {
    addUpdate('stage', normalizeStage(patch.stage))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'progress')) {
    addUpdate('progress', clampProgress(patch.progress))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'currentTarget')) {
    addUpdate('current_target', toSafeText(patch.currentTarget))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'errorCode')) {
    addUpdate('error_code', toSafeText(patch.errorCode))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'errorMessage')) {
    addUpdate('error_message', toSafeText(patch.errorMessage))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'cancelable')) {
    addUpdate('cancelable', patch.cancelable === true ? 1 : 0)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'linkedJobId')) {
    addUpdate('linked_job_id', toSafeText(patch.linkedJobId))
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'plan') ||
    Object.prototype.hasOwnProperty.call(patch, 'planJson')
  ) {
    addUpdate('plan_json', stringifyJson(patch.plan ?? patch.planJson, null))
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'result') ||
    Object.prototype.hasOwnProperty.call(patch, 'resultJson')
  ) {
    addUpdate('result_json', stringifyJson(patch.result ?? patch.resultJson, null))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'backupRef')) {
    addUpdate('backup_ref', toSafeText(patch.backupRef))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authorizationMode')) {
    addUpdate('authorization_mode', toSafeText(patch.authorizationMode))
  }

  if (!updates.length) {
    return await getAgentTaskFromDatabase(database, safeTaskId)
  }

  addUpdate('updated_at', nowIso())
  params.push(safeTaskId)
  database.run(
    `
      UPDATE agent_task
      SET ${updates.join(', ')}
      WHERE task_id = ?
    `,
    params
  )

  return await getAgentTaskFromDatabase(database, safeTaskId)
}

export async function appendAgentTaskLogToDatabase(
  database,
  taskId = '',
  level = 'info',
  message = '',
  detail = {}
) {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  ensureAgentTaskSchemaForDatabase(database)
  const log = {
    taskId: safeTaskId,
    level: toSafeText(level, 'info') || 'info',
    message: toSafeText(message),
    detail: toPlainJson(detail, {}),
    createdAt: nowIso()
  }

  database.run(
    `
      INSERT INTO agent_task_log (
        task_id,
        level,
        message,
        detail_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [log.taskId, log.level, log.message, stringifyJson(log.detail, {}), log.createdAt]
  )

  return log
}
