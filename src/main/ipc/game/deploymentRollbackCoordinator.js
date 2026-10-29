import fs from 'fs-extra'
import {
  getDeploymentScopeMutationKey,
  inspectDeploymentScopeMutationLocks,
  normalizeDeploymentScopeForLock,
  withDeploymentScopeMutationLocks
} from './deploymentScopeMutationLock.js'

const MAX_TRANSACTION_IDS = 20
const MAX_BACKUP_ENTRIES = 200
const CLEANUP_POLICIES = new Set(['disable', 'uninstall'])

export const DEPLOYMENT_ROLLBACK_STAGE = Object.freeze({
  PLANNED: 'planned',
  FILES_RESTORED: 'files_restored',
  MOD_STATE_UPDATED: 'mod_state_updated',
  LEDGER_REBUILT: 'ledger_rebuilt',
  ARCHIVED: 'archived',
  REPAIR_REQUIRED: 'repair_required'
})

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    if (typeof value === 'string') {
      const text = value.trim()
      return text ? JSON.parse(text) : fallback
    }
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function normalizeIdList(value = [], limit = MAX_TRANSACTION_IDS) {
  const source = Array.isArray(value) ? value : [value]
  return [...new Set(source.map((item) => toSafeNumber(item)).filter((item) => item > 0))].slice(
    0,
    limit
  )
}

function normalizeTextList(value = []) {
  const source = Array.isArray(value) ? value : [value]
  return [...new Set(source.map((item) => toSafeText(item)).filter(Boolean))]
}

function normalizeModId(value = {}) {
  return toSafeNumber(value.modId ?? value.mod_id ?? value.installedModId ?? value.installed_mod_id)
}

function normalizeCleanupPolicy(value = '') {
  const policy = toSafeText(value, 'disable').toLowerCase()
  return CLEANUP_POLICIES.has(policy) ? policy : 'disable'
}

function normalizeScope(value = {}) {
  return normalizeDeploymentScopeForLock(value)
}

function isScopeComplete(scope = {}) {
  return Boolean(
    toSafeNumber(scope.gameId) > 0 && toSafeText(scope.source) && toSafeText(scope.deployDomain)
  )
}

function canReconcileRollbackScope(scope = {}) {
  return isScopeComplete(scope) && toSafeText(scope.source).toLowerCase() !== 'thunderstore'
}

function dedupeByKey(list = [], keyGetter = () => '') {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const key = toSafeText(keyGetter(item))
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function createSqlPlaceholders(count = 0) {
  return Array.from({ length: count }, () => '?').join(', ')
}

function normalizeTransactionRow(row = {}) {
  const payload = toPlainJson(row.payload_json || row.payload, {})
  const result = toPlainJson(row.result_json || row.result, {})
  const transaction = {
    id: toSafeNumber(row.id),
    transactionId: toSafeText(row.id || row.transactionId),
    taskId: toSafeText(row.task_id || row.taskId),
    agentTaskId: toSafeText(row.agent_task_id || row.agentTaskId),
    taskType: toSafeText(row.task_type || row.taskType),
    status: toSafeText(row.status),
    reconcileType: toSafeText(row.reconcile_type || row.reconcileType),
    scope: normalizeScope({
      gameId: row.game_id ?? row.gameId,
      source: row.source,
      endpointType: row.endpoint_type ?? row.endpointType,
      deployDomain: row.deploy_domain ?? row.deployDomain
    }),
    modId: toSafeNumber(row.mod_id || row.modId || payload.modId || payload.mod_id),
    payload,
    result,
    errorCode: toSafeText(row.error_code || row.errorCode),
    errorMessage: toSafeText(row.error_message || row.errorMessage)
  }
  transaction.sessionId = toSafeText(
    row.session_id || row.sessionId || result.sessionId || result.taskId || transaction.taskId
  )
  return transaction
}

function normalizeBackupEntry(row = {}) {
  const metadata = toPlainJson(row.metadata_json || row.metadata, {})
  return {
    id: toSafeNumber(row.id),
    sessionId: toSafeText(row.session_id || row.sessionId),
    agentTaskId: toSafeText(row.agent_task_id || row.agentTaskId),
    gameId: toSafeNumber(row.game_id || row.gameId),
    endpointType: toSafeNumber(row.endpoint_type || row.endpointType),
    deployDomain: toSafeText(row.deploy_domain || row.deployDomain),
    modId: toSafeNumber(row.mod_id || row.modId),
    targetPath: toSafeText(row.target_path || row.targetPath),
    backupPath: toSafeText(row.backup_path || row.backupPath),
    reason: toSafeText(row.reason),
    state: toSafeText(row.state, 'active'),
    targetType: toSafeText(metadata.targetType || row.targetType, 'file')
  }
}

function normalizeAgentTask(task = null) {
  if (!task) return null
  return {
    taskId: toSafeText(task.taskId || task.task_id),
    type: toSafeText(task.type),
    stage: toSafeText(task.stage),
    linkedJobId: toSafeText(task.linkedJobId || task.linked_job_id),
    result: toPlainJson(task.result || task.result_json, {}),
    plan: toPlainJson(task.plan || task.plan_json, {})
  }
}

function normalizeSourceJob(detail = null) {
  if (!detail) return null
  const job = detail.job && typeof detail.job === 'object' ? detail.job : detail
  const items = Array.isArray(detail.items) ? detail.items : []
  return {
    jobId: toSafeText(job.job_id || job.jobId || detail.job_id || detail.jobId),
    agentTaskId: toSafeText(job.agent_task_id || job.agentTaskId || detail.agent_task_id),
    source: toSafeText(job.source || detail.source),
    state: toSafeText(job.state || detail.state),
    title: toSafeText(job.title || detail.title),
    items: items.map((item) => ({
      itemId: toSafeText(item.item_id || item.itemId),
      title: toSafeText(item.title),
      state: toSafeText(item.state),
      transactionId: toSafeText(
        item.transaction?.transactionId || item.transaction_id || item.transactionId
      ),
      rollbackStatus: toSafeText(
        item.transaction?.rollbackStatus || item.rollback_status || item.rollbackStatus
      ),
      rollbackError: toSafeText(
        item.transaction?.rollbackError || item.rollback_error || item.rollbackError
      )
    }))
  }
}

function getAgentTaskFromDb(database, taskId = '') {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId || !database?.tableExists?.('agent_task')) return null
  const row = database.get('SELECT * FROM agent_task WHERE task_id = ? LIMIT 1', [safeTaskId])
  return row ? normalizeAgentTask(row) : null
}

function getSourceJobDetailFromDb(database, jobId = '') {
  const safeJobId = toSafeText(jobId)
  if (!safeJobId || !database?.tableExists?.('source_install_job')) return null
  const job = database.get('SELECT * FROM source_install_job WHERE job_id = ? LIMIT 1', [safeJobId])
  if (!job) return null
  const items = database?.tableExists?.('source_install_job_item')
    ? database.all('SELECT * FROM source_install_job_item WHERE job_id = ? ORDER BY id ASC', [
        safeJobId
      ])
    : []
  return { job, items }
}

function listDeployTransactionsFromDb(database, filter = {}) {
  if (!database?.tableExists?.('mod_deploy_transactions')) return []
  const where = []
  const params = []
  const transactionIds = normalizeIdList(filter.transactionIds || filter.transactionId)
  const taskIds = normalizeTextList(filter.taskIds || filter.taskId)
  const agentTaskId = toSafeText(filter.agentTaskId || filter.agent_task_id)
  const scope = normalizeScope(filter.scope || filter)

  if (transactionIds.length) {
    where.push(`id IN (${createSqlPlaceholders(transactionIds.length)})`)
    params.push(...transactionIds)
  }
  if (taskIds.length) {
    where.push(`task_id IN (${createSqlPlaceholders(taskIds.length)})`)
    params.push(...taskIds)
  }
  if (agentTaskId) {
    where.push('agent_task_id = ?')
    params.push(agentTaskId)
  }
  if (scope.gameId > 0) {
    where.push('game_id = ?')
    params.push(scope.gameId)
  }
  if (scope.source) {
    where.push('lower(source) = ?')
    params.push(scope.source)
  }
  if (toSafeText(filter.endpointType ?? filter.endpoint_type) || scope.endpointType !== 0) {
    where.push('endpoint_type = ?')
    params.push(scope.endpointType)
  }
  if (scope.deployDomain) {
    where.push('deploy_domain = ?')
    params.push(scope.deployDomain)
  }
  if (!where.length) return []

  return database.all(
    `SELECT *
       FROM mod_deploy_transactions
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT 50`,
    params
  )
}

function listDeployBackupEntriesFromDb(database, filter = {}) {
  if (!database?.tableExists?.('mod_deploy_backup_entries')) return []
  const where = []
  const params = []
  const sessionIds = normalizeTextList(filter.sessionIds || filter.sessionId)
  const backupEntryIds = normalizeIdList(
    filter.backupEntryIds || filter.backupEntryId,
    MAX_BACKUP_ENTRIES
  )
  const agentTaskId = toSafeText(filter.agentTaskId || filter.agent_task_id)
  const modId = normalizeModId(filter)
  const scope = normalizeScope(filter.scope || filter)

  if (backupEntryIds.length) {
    where.push(`id IN (${createSqlPlaceholders(backupEntryIds.length)})`)
    params.push(...backupEntryIds)
  }
  if (sessionIds.length) {
    where.push(`session_id IN (${createSqlPlaceholders(sessionIds.length)})`)
    params.push(...sessionIds)
  }
  if (agentTaskId) {
    where.push('agent_task_id = ?')
    params.push(agentTaskId)
  }
  if (modId > 0) {
    where.push('mod_id = ?')
    params.push(modId)
  }
  if (scope.gameId > 0) {
    where.push('game_id = ?')
    params.push(scope.gameId)
  }
  if (toSafeText(filter.endpointType ?? filter.endpoint_type) || scope.endpointType !== 0) {
    where.push('endpoint_type = ?')
    params.push(scope.endpointType)
  }
  if (scope.deployDomain) {
    where.push('deploy_domain = ?')
    params.push(scope.deployDomain)
  }
  if (!where.length) return []

  return database.all(
    `SELECT *
       FROM mod_deploy_backup_entries
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    [...params, MAX_BACKUP_ENTRIES]
  )
}

function persistRollbackProgressToDb(database, transactionIds = [], progress = {}) {
  const ids = normalizeIdList(transactionIds)
  if (!ids.length || !database?.tableExists?.('mod_deploy_transactions')) {
    return { changes: 0 }
  }
  let changes = 0
  for (const id of ids) {
    const row = database.get(
      'SELECT result_json FROM mod_deploy_transactions WHERE id = ? LIMIT 1',
      [id]
    )
    if (!row) continue
    const result = toPlainJson(row.result_json, {})
    const updateResult = database.run(
      `UPDATE mod_deploy_transactions
          SET result_json = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        JSON.stringify({
          ...result,
          rollbackExecution: toPlainJson(progress, {})
        }),
        id
      ]
    )
    changes += Number(updateResult?.changes || 0)
  }
  return { changes }
}

function markDeployTransactionsRolledBackInDb(database, transactionIds = [], result = {}) {
  const ids = normalizeIdList(transactionIds)
  if (!ids.length || !database?.tableExists?.('mod_deploy_transactions')) {
    return { changes: 0 }
  }
  return database.run(
    `UPDATE mod_deploy_transactions
        SET status = 'rolled_back',
            error_code = '',
            error_message = '',
            result_json = ?,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${createSqlPlaceholders(ids.length)})
        AND status = 'completed'`,
    [JSON.stringify(toPlainJson(result, {})), ...ids]
  )
}

function markDeployBackupEntriesRestoredInDb(database, backupEntryIds = []) {
  const ids = normalizeIdList(backupEntryIds, MAX_BACKUP_ENTRIES)
  if (!ids.length || !database?.tableExists?.('mod_deploy_backup_entries')) {
    return { changes: 0, restoredCount: 0 }
  }
  const updateResult = database.run(
    `UPDATE mod_deploy_backup_entries
        SET state = 'restored',
            updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${createSqlPlaceholders(ids.length)})
        AND state = 'active'`,
    ids
  )
  const restoredRows = database.all(
    `SELECT id
       FROM mod_deploy_backup_entries
      WHERE id IN (${createSqlPlaceholders(ids.length)})
        AND state = 'restored'`,
    ids
  )
  return {
    ...updateResult,
    restoredCount: Array.isArray(restoredRows) ? restoredRows.length : 0
  }
}

function createNoopEvent() {
  return {
    sender: {
      send() {}
    },
    reply() {}
  }
}

async function getDependencies(overrides = {}, options = {}) {
  const deps = { ...overrides }
  let database = deps.db || null
  const databaseRequired =
    (options.skipPlanning !== true &&
      (typeof deps.getAgentTask !== 'function' ||
        typeof deps.getJobDetail !== 'function' ||
        typeof deps.listDeployTransactions !== 'function' ||
        typeof deps.listDeployBackupEntries !== 'function')) ||
    typeof deps.getModById !== 'function' ||
    (options.includeExecution === true &&
      (typeof deps.persistRollbackProgress !== 'function' ||
        typeof deps.markDeployTransactionsRolledBack !== 'function' ||
        typeof deps.markDeployBackupEntriesRestored !== 'function'))
  if (!database && databaseRequired) {
    const dbModule = await import('../../db/dbInstance.js')
    database = dbModule.default
  }

  deps.getAgentTask = deps.getAgentTask || ((taskId = '') => getAgentTaskFromDb(database, taskId))
  deps.getJobDetail =
    deps.getJobDetail || ((jobId = '') => getSourceJobDetailFromDb(database, jobId))
  deps.listDeployTransactions =
    deps.listDeployTransactions || ((filter = {}) => listDeployTransactionsFromDb(database, filter))
  deps.listDeployBackupEntries =
    deps.listDeployBackupEntries ||
    ((filter = {}) => listDeployBackupEntriesFromDb(database, filter))
  deps.getModById =
    deps.getModById ||
    ((modId = 0) => database.get('SELECT * FROM mods WHERE id = ? LIMIT 1', [modId]))
  deps.readDeploymentSessionFile =
    deps.readDeploymentSessionFile ||
    (async (filePath = '') => {
      const safePath = toSafeText(filePath)
      if (!safePath || !(await fs.pathExists(safePath))) return null
      return await fs.readJson(safePath)
    })
  deps.inspectDeploymentScopeLocks =
    deps.inspectDeploymentScopeLocks || inspectDeploymentScopeMutationLocks
  deps.withDeploymentScopeLocks =
    deps.withDeploymentScopeLocks ||
    ((scopes, callback, lockOptions = {}) =>
      withDeploymentScopeMutationLocks(scopes, callback, lockOptions))
  deps.persistRollbackProgress =
    deps.persistRollbackProgress ||
    ((transactionIds = [], progress = {}) =>
      persistRollbackProgressToDb(database, transactionIds, progress))
  deps.markDeployTransactionsRolledBack =
    deps.markDeployTransactionsRolledBack ||
    ((transactionIds = [], result = {}) =>
      markDeployTransactionsRolledBackInDb(database, transactionIds, result))
  deps.markDeployBackupEntriesRestored =
    deps.markDeployBackupEntriesRestored ||
    ((backupEntryIds = []) => markDeployBackupEntriesRestoredInDb(database, backupEntryIds))

  if (options.includeExecution === true) {
    if (
      typeof deps.rollbackDeploymentSession !== 'function' ||
      typeof deps.reconcileDeploy !== 'function'
    ) {
      const deployReconciler = await import('./deployReconcilerRuntime.js')
      deps.rollbackDeploymentSession =
        deps.rollbackDeploymentSession || deployReconciler.rollbackDeploymentSession
      deps.reconcileDeploy = deps.reconcileDeploy || deployReconciler.reconcileDeploy
    }
    if (typeof deps.disableMod !== 'function' || typeof deps.uninstallMod !== 'function') {
      const gameMethod = await import('./method.js')
      deps.disableMod =
        deps.disableMod ||
        (async (modId = 0, context = {}) =>
          await gameMethod.setModActiveStateForDeploymentRollback(
            context.event || createNoopEvent(),
            {
              id: modId,
              isActive: false,
              force: true,
              agentTaskId: context.agentTaskId,
              skipDeploymentReconcile: true
            },
            {
              update: context.updateProgress,
              scopeLockToken: context.scopeLockToken
            }
          ))
      deps.uninstallMod =
        deps.uninstallMod ||
        (async (modId = 0, context = {}) =>
          await gameMethod.uninstallModById(context.event || createNoopEvent(), {
            id: modId,
            force: true,
            scopeLockToken: context.scopeLockToken,
            skipDeploymentReconcile: true
          }))
    }
    if (typeof deps.updateItem !== 'function') {
      const taskStore = await import('./source-install-task/taskStore.js')
      deps.updateItem = taskStore.updateItem
      deps.updateJob = deps.updateJob || taskStore.updateJob
      deps.runInTransaction = deps.runInTransaction || taskStore.runInTransaction
    }
    deps.archiveRollbackState =
      deps.archiveRollbackState ||
      ((plan = {}, result = {}) => {
        const archive = () => {
          const backupResult = deps.markDeployBackupEntriesRestored(plan.target.backupEntryIds)
          const archivedBackupCount = Number(
            backupResult?.restoredCount ?? backupResult?.changes ?? 0
          )
          if (
            archivedBackupCount <
            normalizeIdList(plan.target.backupEntryIds, MAX_BACKUP_ENTRIES).length
          ) {
            throw createCoordinatorError(
              'rollback_backup_archive_failed',
              '部署备份条目状态归档不完整。',
              DEPLOYMENT_ROLLBACK_STAGE.ARCHIVED
            )
          }
          const transactionResult = deps.markDeployTransactionsRolledBack(
            plan.target.transactionIds,
            result
          )
          if (
            Number(transactionResult?.changes || 0) <
            normalizeIdList(plan.target.transactionIds).length
          ) {
            throw createCoordinatorError(
              'rollback_transaction_archive_failed',
              '部署事务状态归档不完整。',
              DEPLOYMENT_ROLLBACK_STAGE.ARCHIVED
            )
          }
          const idSet = new Set(normalizeIdList(plan.target.transactionIds).map(String))
          for (const item of Array.isArray(plan.sourceJob?.items) ? plan.sourceJob.items : []) {
            if (!idSet.has(toSafeText(item.transactionId))) continue
            deps.updateItem(item.itemId, {
              rollback_status: 'rolled_back',
              rollback_error: ''
            })
          }
          if (plan.sourceJob?.jobId && typeof deps.updateJob === 'function') {
            deps.updateJob(plan.sourceJob.jobId, {
              current_step: '已回滚',
              error_message: '',
              failure_stage: '',
              failure_json: '{}'
            })
          }
          return { success: true }
        }
        return typeof deps.runInTransaction === 'function'
          ? deps.runInTransaction(archive)
          : archive()
      })
  }

  return deps
}

function createPlanError(errorCode, message, detail = {}) {
  return {
    success: false,
    rollbackAvailable: false,
    errorCode,
    message,
    ...detail,
    actions: []
  }
}

function createUnavailablePlan(context = {}) {
  const warning = {
    code: toSafeText(context.errorCode, 'rollback_not_available'),
    message: toSafeText(context.message, '当前没有可执行的自动回滚动作。')
  }
  return {
    success: true,
    rollbackAvailable: false,
    target: {
      taskId: toSafeText(context.taskId),
      jobId: toSafeText(context.sourceJob?.jobId || context.requestedJobId),
      modId: context.requestedModId > 0 ? context.requestedModId : undefined,
      cleanupPolicy: normalizeCleanupPolicy(context.cleanupPolicy),
      transactionIds: [],
      sessionIds: [],
      backupEntryIds: []
    },
    agentTask: context.agentTask || null,
    sourceJob: context.sourceJob || null,
    transactions: [],
    backupEntries: [],
    affectedMods: [],
    impact: {
      transactionCount: 0,
      backupEntryCount: 0,
      activeBackupEntryCount: 0,
      restoreFileCount: 0,
      modCount: 0,
      scopes: [],
      requiresRedeploy: false
    },
    warnings: [warning],
    actions: [],
    message: warning.message
  }
}

function collectTransactionIdsFromJob(job = null) {
  return normalizeIdList(
    (Array.isArray(job?.items) ? job.items : []).map((item) => item.transactionId).filter(Boolean)
  )
}

function filterAppliedEntriesForMod(appliedEntries = [], backupEntries = [], modId = 0) {
  if (modId <= 0) return appliedEntries
  const backupPathKeys = new Set(
    backupEntries.map((entry) => toSafeText(entry.targetPath).replace(/\\/g, '/').toLowerCase())
  )
  return appliedEntries.filter((entry) => {
    const winnerModId = toSafeNumber(
      entry.winnerModId || entry.winner_mod_id || entry.modId || entry.mod_id
    )
    const targetKey = toSafeText(entry.targetPath || entry.target_path)
      .replace(/\\/g, '/')
      .toLowerCase()
    return winnerModId === modId || backupPathKeys.has(targetKey)
  })
}

function normalizeSessionBackupEntry(entry = {}) {
  return {
    ...toPlainJson(entry, {}),
    id: toSafeNumber(entry.id),
    sessionId: toSafeText(entry.sessionId || entry.session_id),
    modId: toSafeNumber(entry.modId || entry.mod_id),
    targetPath: toSafeText(entry.targetPath || entry.target_path),
    backupPath: toSafeText(entry.backupPath || entry.backup_path),
    targetType: toSafeText(entry.targetType, 'file')
  }
}

function normalizeSessionAppliedEntry(entry = {}) {
  return {
    ...toPlainJson(entry, {}),
    targetPath: toSafeText(entry.targetPath || entry.target_path),
    winnerModId: toSafeNumber(
      entry.winnerModId || entry.winner_mod_id || entry.modId || entry.mod_id
    ),
    action: toSafeText(entry.action)
  }
}

function resolveFallbackSession(transaction = {}) {
  const candidates = [
    transaction.result?.rollbackSession,
    transaction.result?.deploymentSession,
    transaction.result?.session
  ]
  return candidates.find((item) => item && typeof item === 'object') || null
}

async function loadRollbackSessions(
  transactions = [],
  backupEntries = [],
  selectedModId = 0,
  deps = {}
) {
  const sessions = []
  const errors = []
  for (const transaction of transactions) {
    const sessionBackups = backupEntries.filter(
      (entry) =>
        entry.sessionId === transaction.sessionId &&
        (selectedModId <= 0 || entry.modId === selectedModId)
    )
    const deploymentPath = toSafeText(transaction.result?.deploymentPath)
    const fileSession = deploymentPath
      ? await Promise.resolve(deps.readDeploymentSessionFile(deploymentPath)).catch(() => null)
      : null
    const storedSession = fileSession || resolveFallbackSession(transaction)
    if (!storedSession || typeof storedSession !== 'object') {
      errors.push({
        transactionId: transaction.id,
        sessionId: transaction.sessionId,
        code: 'rollback_session_incomplete'
      })
      continue
    }

    const allAppliedEntries = (
      Array.isArray(storedSession.appliedEntries) ? storedSession.appliedEntries : []
    ).map(normalizeSessionAppliedEntry)
    const storedBackupEntries = (
      Array.isArray(storedSession.backupEntries) ? storedSession.backupEntries : []
    ).map(normalizeSessionBackupEntry)
    const appliedEntries = filterAppliedEntriesForMod(
      allAppliedEntries,
      sessionBackups,
      selectedModId
    )
    if (!appliedEntries.length && !sessionBackups.length) {
      errors.push({
        transactionId: transaction.id,
        sessionId: transaction.sessionId,
        code: 'rollback_session_incomplete'
      })
      continue
    }

    sessions.push({
      transaction,
      scope: transaction.scope,
      deploymentPath,
      usedFallbackSession: !fileSession,
      session: {
        ...toPlainJson(storedSession, {}),
        sessionId: toSafeText(storedSession.sessionId || transaction.sessionId),
        appliedEntries,
        backupEntries: sessionBackups.map((databaseEntry) => {
          const storedEntry = storedBackupEntries.find(
            (entry) =>
              (entry.id > 0 && entry.id === databaseEntry.id) ||
              (entry.targetPath && entry.targetPath === databaseEntry.targetPath)
          )
          return normalizeSessionBackupEntry({
            ...(storedEntry || {}),
            ...databaseEntry,
            boundaryRoot:
              storedEntry?.boundaryRoot ||
              storedEntry?.targetBoundaryRoot ||
              databaseEntry.boundaryRoot,
            targetBoundaryRoot:
              storedEntry?.targetBoundaryRoot ||
              storedEntry?.boundaryRoot ||
              databaseEntry.targetBoundaryRoot
          })
        })
      }
    })
  }
  return { sessions, errors }
}

function collectResumeState(transactions = []) {
  const states = transactions
    .map((transaction) => toPlainJson(transaction.result?.rollbackExecution, null))
    .filter(Boolean)
  const latest = states[0] || {}
  return {
    stage: toSafeText(latest.stage, DEPLOYMENT_ROLLBACK_STAGE.PLANNED),
    completedStages: normalizeTextList(states.flatMap((state) => state.completedStages || [])),
    completedSessionIds: normalizeTextList(
      states.flatMap((state) => state.completedSessionIds || [])
    ),
    restoredBackupEntryIds: normalizeIdList(
      states.flatMap((state) => state.restoredBackupEntryIds || []),
      MAX_BACKUP_ENTRIES
    ),
    updatedModIds: normalizeIdList(
      states.flatMap((state) => state.updatedModIds || []),
      MAX_BACKUP_ENTRIES
    ),
    reconciledScopeKeys: normalizeTextList(
      states.flatMap((state) => state.reconciledScopeKeys || [])
    ),
    mutationStarted: states.some((state) => state.mutationStarted === true)
  }
}

function summarizeImpact(transactions = [], backupEntries = [], sessions = [], modIds = []) {
  const scopes = dedupeByKey(
    transactions.map((item) => item.scope).filter(isScopeComplete),
    getDeploymentScopeMutationKey
  )
  const restoredTargets = new Set()
  for (const item of sessions) {
    for (const entry of item.session.appliedEntries) {
      if (entry.targetPath) restoredTargets.add(entry.targetPath)
    }
    for (const entry of item.session.backupEntries) {
      if (entry.targetPath) restoredTargets.add(entry.targetPath)
    }
  }
  return {
    transactionCount: transactions.length,
    backupEntryCount: backupEntries.length,
    activeBackupEntryCount: backupEntries.filter((item) => item.state === 'active').length,
    restoreFileCount: restoredTargets.size,
    modCount: modIds.length,
    scopes,
    requiresRedeploy: scopes.length > 0
  }
}

function buildRollbackAction(context = {}) {
  return {
    id: [
      'rollback-plan',
      context.agentTask?.taskId,
      context.sourceJob?.jobId,
      context.transactionIds.join('-')
    ]
      .filter(Boolean)
      .join(':'),
    type: 'rollback_task',
    title: context.requestedModId > 0 ? '回滚指定模组部署结果' : '回滚安装/部署任务',
    destructive: true,
    requiresConfirmation: true,
    cleanupPolicy: context.cleanupPolicy,
    affectedMods: context.affectedMods,
    affectedScopes: context.impact.scopes,
    restoreFileCount: context.impact.restoreFileCount,
    willDisableModIds: context.cleanupPolicy === 'disable' ? context.modIds : [],
    willUninstallModIds: context.cleanupPolicy === 'uninstall' ? context.modIds : [],
    requiresRedeploy: context.impact.requiresRedeploy,
    risks: [
      '回滚将写入游戏目录并恢复部署备份。',
      context.cleanupPolicy === 'uninstall'
        ? '目标模组记录将通过现有卸载流程永久删除。'
        : '目标模组记录将保留，但会被禁用并退出活动部署集合。',
      '文件恢复开始后取消请求将延后到一致性恢复完成。'
    ],
    executionPayload: {
      actionType: 'rollback_task',
      taskId: toSafeText(context.agentTask?.taskId),
      jobId: toSafeText(context.sourceJob?.jobId || context.requestedJobId),
      modId: context.requestedModId > 0 ? context.requestedModId : undefined,
      cleanupPolicy: context.cleanupPolicy,
      transactionIds: context.transactionIds,
      sessionIds: context.sessions.map((item) => item.session.sessionId),
      backupEntryIds: context.backupEntryIds,
      reason: 'agent_rollback_plan'
    },
    message:
      context.cleanupPolicy === 'uninstall'
        ? `确认后恢复 ${context.impact.restoreFileCount} 个文件目标、卸载 ${context.modIds.length} 个模组并重建 ${context.impact.scopes.length} 个部署域。`
        : `确认后恢复 ${context.impact.restoreFileCount} 个文件目标、禁用 ${context.modIds.length} 个模组并重建 ${context.impact.scopes.length} 个部署域。`
  }
}

export async function planDeploymentRollback(input = {}, dependencyOverrides = {}) {
  const deps = await getDependencies(dependencyOverrides)
  const taskId = toSafeText(input.taskId || input.task_id)
  const requestedJobId = toSafeText(input.jobId || input.job_id)
  const requestedTransactionIds = normalizeIdList(
    input.transactionIds || input.transactionId || input.transaction_id
  )
  const selectedBackupEntryIds = normalizeIdList(
    input.backupEntryIds || input.backupEntryId || input.backup_entry_id,
    MAX_BACKUP_ENTRIES
  )
  const requestedModId = normalizeModId(input)
  const requestedCleanupPolicy = toSafeText(
    input.cleanupPolicy || input.cleanup_policy
  ).toLowerCase()
  if (requestedCleanupPolicy && !CLEANUP_POLICIES.has(requestedCleanupPolicy)) {
    return createPlanError(
      'rollback_cleanup_policy_invalid',
      'cleanupPolicy 只支持 disable 或 uninstall，未开始文件写入。'
    )
  }
  const cleanupPolicy = normalizeCleanupPolicy(requestedCleanupPolicy)
  const requestedScope = normalizeScope(input.scope || input)

  if (
    !taskId &&
    !requestedJobId &&
    !requestedTransactionIds.length &&
    !isScopeComplete(requestedScope)
  ) {
    return createPlanError(
      'missing_rollback_target',
      '请提供 taskId、jobId、transactionId 或完整部署 scope 以生成回滚计划。'
    )
  }

  let agentTask = null
  let sourceJob = null
  const transactionIdSet = new Set(requestedTransactionIds)
  const transactionRows = []
  const backupRows = []

  if (taskId) {
    agentTask = normalizeAgentTask(await deps.getAgentTask(taskId))
    const linkedJobId = toSafeText(agentTask?.linkedJobId)
    if (linkedJobId && !requestedJobId) {
      sourceJob = normalizeSourceJob(await deps.getJobDetail(linkedJobId))
    }
  }
  if (requestedJobId && !sourceJob) {
    sourceJob = normalizeSourceJob(await deps.getJobDetail(requestedJobId))
  }
  collectTransactionIdsFromJob(sourceJob).forEach((id) => transactionIdSet.add(id))

  if (transactionIdSet.size) {
    transactionRows.push(...deps.listDeployTransactions({ transactionIds: [...transactionIdSet] }))
  }
  if (agentTask?.taskId) {
    transactionRows.push(...deps.listDeployTransactions({ agentTaskId: agentTask.taskId }))
  }
  if (!transactionRows.length && isScopeComplete(requestedScope)) {
    transactionRows.push(...deps.listDeployTransactions({ scope: requestedScope }))
  }

  const allTransactions = dedupeByKey(transactionRows.map(normalizeTransactionRow), (item) =>
    String(item.id)
  )
  const warnings = []
  if (!allTransactions.length) {
    if (requestedTransactionIds.length) {
      return createPlanError('no_deploy_transaction', '指定部署事务不存在，未开始文件写入。', {
        missingTransactionIds: requestedTransactionIds
      })
    }
    return createUnavailablePlan({
      errorCode: 'no_deploy_transaction',
      message: '未找到可关联的部署事务，无法定位回滚范围。',
      taskId,
      requestedJobId,
      requestedModId,
      cleanupPolicy,
      agentTask,
      sourceJob
    })
  }
  if (requestedTransactionIds.length) {
    const foundIdSet = new Set(allTransactions.map((item) => item.id))
    const missingTransactionIds = requestedTransactionIds.filter((id) => !foundIdSet.has(id))
    if (missingTransactionIds.length) {
      return createPlanError('no_deploy_transaction', '部分指定部署事务不存在，未开始文件写入。', {
        missingTransactionIds
      })
    }
    const requestedIdSet = new Set(requestedTransactionIds)
    if (
      allTransactions.some((item) => requestedIdSet.has(item.id) && item.status === 'rolled_back')
    ) {
      return createPlanError(
        'transaction_already_rolled_back',
        '指定部署事务已经回滚，不能再次作为新回滚目标。'
      )
    }
  }
  if (allTransactions.some((item) => item.status === 'rolled_back')) {
    warnings.push({
      code: 'transaction_already_rolled_back',
      message: '存在已回滚的部署事务，不能重复作为回滚目标。'
    })
  }

  let transactions = allTransactions.filter((item) => item.status === 'completed')
  if (requestedTransactionIds.length) {
    const requestedSet = new Set(requestedTransactionIds)
    transactions = transactions.filter((item) => requestedSet.has(item.id))
  }
  if (requestedModId > 0) {
    if (!transactions.some((item) => item.modId === requestedModId || item.modId === 0)) {
      return createPlanError(
        'rollback_mod_identity_missing',
        '指定模组与部署事务不匹配，未开始文件写入。'
      )
    }
    transactions = transactions.filter((item) => item.modId === requestedModId || item.modId === 0)
  }
  transactions.sort((left, right) => right.id - left.id)
  if (!transactions.length) {
    return createPlanError(
      allTransactions.some((item) => item.status === 'rolled_back')
        ? 'transaction_already_rolled_back'
        : 'no_completed_transaction',
      '未找到尚未回滚的已完成部署事务。',
      { warnings }
    )
  }
  const resumeState = collectResumeState(transactions)

  const sessionIds = normalizeTextList(transactions.map((item) => item.sessionId))
  if (sessionIds.length) {
    backupRows.push(
      ...deps.listDeployBackupEntries({
        sessionIds,
        modId: requestedModId,
        backupEntryIds: selectedBackupEntryIds
      })
    )
  }
  if (!backupRows.length && agentTask?.taskId) {
    backupRows.push(
      ...deps.listDeployBackupEntries({
        agentTaskId: agentTask.taskId,
        modId: requestedModId,
        backupEntryIds: selectedBackupEntryIds
      })
    )
  }

  let backupEntries = dedupeByKey(backupRows.map(normalizeBackupEntry), (item) => String(item.id))
  if (selectedBackupEntryIds.length) {
    const selectedSet = new Set(selectedBackupEntryIds)
    backupEntries = backupEntries.filter((item) => selectedSet.has(item.id))
  }
  const resumableBackupEntryIds = new Set(resumeState.restoredBackupEntryIds)
  const rollbackBackupEntries = backupEntries.filter(
    (item) =>
      item.state === 'active' || (item.state === 'restored' && resumableBackupEntryIds.has(item.id))
  )
  if (!rollbackBackupEntries.length) {
    return createPlanError(
      'no_active_backup_entries',
      '未找到 active 状态或已由当前回滚进度确认恢复的部署备份条目，未开始文件写入。',
      { warnings }
    )
  }
  const invalidBackupEntries = rollbackBackupEntries.filter(
    (item) => item.id <= 0 || !item.sessionId || !item.targetPath || !item.backupPath
  )
  if (invalidBackupEntries.length) {
    return createPlanError(
      'rollback_session_incomplete',
      '部署备份条目缺少 session、目标路径或备份路径，未开始文件写入。',
      {
        invalidBackupEntryIds: invalidBackupEntries.map((item) => item.id).filter((id) => id > 0)
      }
    )
  }

  const incompleteScopes = transactions
    .map((item) => item.scope)
    .filter((scope) => !isScopeComplete(scope))
  if (incompleteScopes.length) {
    return createPlanError(
      'rollback_scope_incomplete',
      '部署 scope 缺少 gameId、source 或 deployDomain，未开始文件写入。'
    )
  }
  const unavailableScopes = transactions
    .map((item) => item.scope)
    .filter((scope) => !canReconcileRollbackScope(scope))
  if (unavailableScopes.length) {
    return createPlanError(
      'rollback_reconcile_unavailable',
      '目标部署域不进入现有统一部署协调，未开始文件写入。',
      { unavailableScopes }
    )
  }

  const modIds =
    requestedModId > 0
      ? [requestedModId]
      : normalizeIdList(
          transactions.map((item) => item.modId),
          MAX_BACKUP_ENTRIES
        )
  if (!modIds.length || (requestedModId <= 0 && transactions.some((item) => item.modId <= 0))) {
    return createPlanError(
      'rollback_mod_identity_missing',
      '无法从部署事务定位需要退出活动部署集合的模组，未开始文件写入。'
    )
  }

  const affectedModRows = modIds.map((modId) => ({
    modId,
    mod: deps.getModById(modId)
  }))
  const missingModIds = affectedModRows.filter((item) => !item.mod).map((item) => item.modId)
  const canResumeCompletedUninstall =
    cleanupPolicy === 'uninstall' &&
    resumeState.mutationStarted === true &&
    resumeState.completedStages.includes(DEPLOYMENT_ROLLBACK_STAGE.FILES_RESTORED)
  if (missingModIds.length && !canResumeCompletedUninstall) {
    return createPlanError(
      'rollback_mod_identity_missing',
      '目标模组记录不存在或身份不完整，未开始文件写入。',
      { missingModIds }
    )
  }
  const affectedMods = affectedModRows.map(
    (item) =>
      item.mod || {
        id: item.modId,
        name: '已卸载模组',
        is_active: 0,
        rollbackResumeMissing: true
      }
  )

  const sessionResult = await loadRollbackSessions(
    transactions,
    rollbackBackupEntries,
    requestedModId,
    deps
  )
  if (sessionResult.errors.length || sessionResult.sessions.length !== transactions.length) {
    return createPlanError(
      'rollback_session_incomplete',
      '部署 session 文件和数据库 fallback 数据不足，未开始文件写入。',
      { incompleteSessions: sessionResult.errors }
    )
  }

  const scopes = dedupeByKey(
    transactions.map((item) => item.scope),
    getDeploymentScopeMutationKey
  )
  const lockInspection = deps.inspectDeploymentScopeLocks(scopes)
  if (lockInspection?.available === false) {
    return createPlanError(
      'rollback_concurrent_mutation',
      '同一部署域存在正在执行的安装、部署或回滚任务，未开始文件写入。',
      { conflicts: lockInspection.conflicts || [] }
    )
  }

  const transactionIds = transactions.map((item) => item.id)
  const backupEntryIds = rollbackBackupEntries.map((item) => item.id)
  const impact = summarizeImpact(
    transactions,
    rollbackBackupEntries,
    sessionResult.sessions,
    modIds
  )
  const request = {
    taskId,
    jobId: toSafeText(sourceJob?.jobId || requestedJobId),
    modId: requestedModId || undefined,
    cleanupPolicy,
    transactionIds,
    backupEntryIds
  }
  const context = {
    agentTask,
    sourceJob,
    requestedJobId,
    requestedModId,
    cleanupPolicy,
    transactions,
    activeBackupEntries: rollbackBackupEntries,
    sessions: sessionResult.sessions,
    scopes,
    modIds,
    affectedMods,
    transactionIds,
    backupEntryIds,
    impact,
    resumeState
  }
  const action = buildRollbackAction(context)
  return {
    success: true,
    rollbackAvailable: true,
    request,
    target: {
      taskId,
      jobId: request.jobId,
      modId: requestedModId || undefined,
      cleanupPolicy,
      transactionIds,
      sessionIds: sessionResult.sessions.map((item) => item.session.sessionId),
      backupEntryIds
    },
    agentTask,
    sourceJob,
    transactions,
    backupEntries: rollbackBackupEntries,
    sessions: sessionResult.sessions,
    affectedMods: affectedMods.map((mod) => ({
      id: toSafeNumber(mod?.id),
      name: toSafeText(mod?.name),
      active: Number(mod?.is_active ?? 0) === 1
    })),
    impact,
    resumeState,
    warnings,
    actions: [action],
    message: `已生成完整回滚计划：恢复 ${impact.restoreFileCount} 个文件目标，${cleanupPolicy === 'uninstall' ? '卸载' : '禁用'} ${modIds.length} 个模组，并重建 ${scopes.length} 个部署域。`
  }
}

function createExecutionState(plan = {}) {
  const resume = toPlainJson(plan.resumeState, {})
  return {
    stage: toSafeText(resume.stage, DEPLOYMENT_ROLLBACK_STAGE.PLANNED),
    completedStages: normalizeTextList(resume.completedStages || []),
    completedSessionIds: normalizeTextList(resume.completedSessionIds || []),
    restoredBackupEntryIds: normalizeIdList(
      resume.restoredBackupEntryIds || [],
      MAX_BACKUP_ENTRIES
    ),
    updatedModIds: normalizeIdList(resume.updatedModIds || [], MAX_BACKUP_ENTRIES),
    reconciledScopeKeys: normalizeTextList(resume.reconciledScopeKeys || []),
    mutationStarted: resume.mutationStarted === true,
    repairRequired: false,
    errorCode: '',
    errorMessage: ''
  }
}

function markStageCompleted(state = {}, stage = '') {
  state.stage = stage
  if (!state.completedStages.includes(stage)) state.completedStages.push(stage)
}

async function persistExecutionState(plan = {}, state = {}, deps = {}) {
  await Promise.resolve(
    deps.persistRollbackProgress(plan.target.transactionIds, toPlainJson(state, {}))
  )
}

async function updateSourceJobRollbackState(
  sourceJob = null,
  transactionIds = [],
  patch = {},
  deps = {}
) {
  if (!sourceJob || typeof deps.updateItem !== 'function') return
  const idSet = new Set(normalizeIdList(transactionIds).map(String))
  for (const item of Array.isArray(sourceJob.items) ? sourceJob.items : []) {
    if (!idSet.has(toSafeText(item.transactionId))) continue
    await Promise.resolve(deps.updateItem(item.itemId, patch))
  }
}

function createCoordinatorError(errorCode, message, stage, detail = {}) {
  const error = new Error(message)
  error.code = errorCode
  error.stage = stage
  Object.assign(error, detail)
  return error
}

function getUnfinishedScopes(plan = {}, state = {}) {
  const completed = new Set(state.reconciledScopeKeys || [])
  return (Array.isArray(plan.impact?.scopes) ? plan.impact.scopes : []).filter(
    (scope) => !completed.has(getDeploymentScopeMutationKey(scope))
  )
}

export async function executeDeploymentRollback(plan = {}, dependencyOverrides = {}) {
  if (!plan?.success || !plan?.rollbackAvailable) {
    return createPlanError(
      plan?.errorCode || 'rollback_not_available',
      plan?.message || '当前回滚计划不可执行。'
    )
  }

  const deps = await getDependencies(dependencyOverrides, {
    includeExecution: true,
    skipPlanning: true
  })
  const state = createExecutionState(plan)
  const cleanupPolicy = normalizeCleanupPolicy(plan.target?.cleanupPolicy)
  const affectedModIds = (Array.isArray(plan.affectedMods) ? plan.affectedMods : [])
    .map((mod) => toSafeNumber(mod?.id))
    .filter((id) => id > 0)
  const signalCheck = typeof deps.assertActive === 'function' ? deps.assertActive : () => {}

  if (cleanupPolicy === 'uninstall' && deps.uninstallAuthorized !== true) {
    return {
      success: false,
      errorCode: 'rollback_uninstall_not_authorized',
      stage: DEPLOYMENT_ROLLBACK_STAGE.PLANNED,
      repairRequired: false,
      completedStages: state.completedStages,
      unfinishedScopes: plan.impact?.scopes || [],
      retryable: true,
      message: '显式 uninstall 清理策略未通过现有破坏性权限确认，未开始文件写入。'
    }
  }

  try {
    signalCheck()
    return await deps.withDeploymentScopeLocks(
      plan.impact.scopes,
      async (scopeLockToken) => {
        signalCheck()
        markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.PLANNED)
        await persistExecutionState(plan, state, deps)
        if (typeof deps.updateProgress === 'function') {
          await deps.updateProgress({
            stage: 'applying',
            progress: 30,
            cancelable: false,
            currentTarget: '已锁定部署域，开始恢复文件；后续取消将延后到一致性恢复完成'
          })
        }
        signalCheck()

        const completedSessionIds = new Set(state.completedSessionIds)
        const restoredBackupEntryIds = new Set(state.restoredBackupEntryIds)
        for (const item of plan.sessions) {
          const sessionId = toSafeText(item.session?.sessionId)
          if (completedSessionIds.has(sessionId)) continue
          state.mutationStarted = true
          state.repairRequired = true
          await persistExecutionState(plan, state, deps)
          const restoreResult = await deps.rollbackDeploymentSession(item.scope, item.session, {
            throwOnFailure: true,
            completedBackupEntryIds: [...restoredBackupEntryIds],
            onBackupEntryRestored: async (entry = {}) => {
              const backupEntryId = toSafeNumber(entry.id)
              if (backupEntryId <= 0 || restoredBackupEntryIds.has(backupEntryId)) return
              restoredBackupEntryIds.add(backupEntryId)
              state.restoredBackupEntryIds = [...restoredBackupEntryIds]
              await persistExecutionState(plan, state, deps)
            }
          })
          if (restoreResult?.success === false) {
            throw createCoordinatorError(
              toSafeText(restoreResult?.code, 'rollback_file_restore_failed'),
              toSafeText(
                restoreResult?.message,
                '部署 session 文件恢复不完整，已进入需要修复状态。'
              ),
              DEPLOYMENT_ROLLBACK_STAGE.FILES_RESTORED,
              { restoreResult }
            )
          }
          completedSessionIds.add(sessionId)
          state.completedSessionIds = [...completedSessionIds]
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.FILES_RESTORED)
          await persistExecutionState(plan, state, deps)
        }
        if (!state.completedStages.includes(DEPLOYMENT_ROLLBACK_STAGE.FILES_RESTORED)) {
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.FILES_RESTORED)
          await persistExecutionState(plan, state, deps)
        }

        if (typeof deps.updateProgress === 'function') {
          await deps.updateProgress({
            progress: 55,
            currentTarget: cleanupPolicy === 'uninstall' ? '卸载回滚目标模组' : '禁用回滚目标模组'
          })
        }
        const updatedModIds = new Set(state.updatedModIds)
        for (const modId of affectedModIds) {
          if (updatedModIds.has(modId)) continue
          const currentMod = deps.getModById(modId)
          if (cleanupPolicy === 'disable') {
            if (currentMod && Number(currentMod?.is_active ?? 0) === 1) {
              const disableResult = await deps.disableMod(modId, {
                scopeLockToken,
                agentTaskId: deps.rollbackTaskId,
                event: deps.event,
                updateProgress: deps.updateProgress
              })
              if (disableResult?.success !== true) {
                throw createCoordinatorError(
                  toSafeText(
                    disableResult?.code || disableResult?.errorCode,
                    'rollback_mod_disable_failed'
                  ),
                  toSafeText(disableResult?.message, '回滚文件已恢复，但禁用目标模组失败。'),
                  DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED
                )
              }
            }
          } else {
            if (currentMod && Number(currentMod?.is_active ?? 0) === 1) {
              const disableResult = await deps.disableMod(modId, {
                agentTaskId: deps.rollbackTaskId,
                event: deps.event,
                updateProgress: deps.updateProgress
              })
              if (disableResult?.success !== true) {
                throw createCoordinatorError(
                  toSafeText(
                    disableResult?.code || disableResult?.errorCode,
                    'rollback_mod_disable_failed'
                  ),
                  toSafeText(disableResult?.message, '卸载前禁用目标模组失败。'),
                  DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED
                )
              }
            }
            if (deps.getModById(modId)) {
              const uninstallResult = await deps.uninstallMod(modId, {
                scopeLockToken,
                event: deps.event,
                agentTaskId: deps.rollbackTaskId
              })
              if (uninstallResult?.success !== true) {
                throw createCoordinatorError(
                  toSafeText(
                    uninstallResult?.code || uninstallResult?.errorCode,
                    'rollback_mod_uninstall_failed'
                  ),
                  toSafeText(uninstallResult?.message, '回滚文件已恢复，但卸载目标模组失败。'),
                  DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED
                )
              }
            }
          }
          updatedModIds.add(modId)
          state.updatedModIds = [...updatedModIds]
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED)
          await persistExecutionState(plan, state, deps)
        }
        if (!state.completedStages.includes(DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED)) {
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.MOD_STATE_UPDATED)
          await persistExecutionState(plan, state, deps)
        }

        if (typeof deps.updateProgress === 'function') {
          await deps.updateProgress({
            progress: 75,
            currentTarget: '使用剩余启用模组重建部署域账本'
          })
        }
        const reconciledScopeKeys = new Set(state.reconciledScopeKeys)
        const reconcileResults = []
        for (const scope of plan.impact.scopes) {
          const scopeKey = getDeploymentScopeMutationKey(scope)
          if (reconciledScopeKeys.has(scopeKey)) continue
          const reconcileResult = await deps.reconcileDeploy({
            mode: 'domain_rebuild',
            scope,
            reason: 'deployment_rollback',
            agentTaskId: deps.rollbackTaskId,
            scopeLockToken
          })
          if (
            reconcileResult?.success !== true ||
            reconcileResult?.skipped === true ||
            reconcileResult?.ledger?.success !== true ||
            reconcileResult?.ledger?.skipped === true
          ) {
            throw createCoordinatorError(
              toSafeText(
                reconcileResult?.code || reconcileResult?.errorCode,
                'rollback_reconcile_unavailable'
              ),
              toSafeText(reconcileResult?.message, '回滚文件已恢复，但部署域账本重建失败。'),
              DEPLOYMENT_ROLLBACK_STAGE.LEDGER_REBUILT,
              { reconcileResult }
            )
          }
          reconcileResults.push({
            scope,
            transactionId: toSafeNumber(reconcileResult.transactionId),
            ledger: toPlainJson(reconcileResult.ledger, {})
          })
          reconciledScopeKeys.add(scopeKey)
          state.reconciledScopeKeys = [...reconciledScopeKeys]
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.LEDGER_REBUILT)
          await persistExecutionState(plan, state, deps)
        }
        if (!state.completedStages.includes(DEPLOYMENT_ROLLBACK_STAGE.LEDGER_REBUILT)) {
          markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.LEDGER_REBUILT)
          await persistExecutionState(plan, state, deps)
        }

        if (typeof deps.updateProgress === 'function') {
          await deps.updateProgress({
            progress: 90,
            currentTarget: '归档部署事务、备份和来源安装任务状态'
          })
        }
        const result = {
          success: true,
          stage: DEPLOYMENT_ROLLBACK_STAGE.ARCHIVED,
          actionType: 'rollback_task',
          cleanupPolicy,
          transactionIds: plan.target.transactionIds,
          backupEntryIds: plan.target.backupEntryIds,
          disabledModIds: cleanupPolicy === 'disable' ? affectedModIds : [],
          uninstalledModIds: cleanupPolicy === 'uninstall' ? affectedModIds : [],
          reconciledScopes: plan.impact.scopes,
          reconcileResults,
          ledgerStatus: 'rebuilt',
          requiresLedgerRebuild: false,
          repairRequired: false,
          completedStages: [
            ...new Set([...state.completedStages, DEPLOYMENT_ROLLBACK_STAGE.ARCHIVED])
          ],
          retryable: false,
          message:
            cleanupPolicy === 'uninstall'
              ? '回滚完成：文件已恢复，目标模组已卸载，部署账本和任务状态已归档。'
              : '回滚完成：文件已恢复，目标模组已禁用，部署账本和任务状态已归档。'
        }

        await Promise.resolve(deps.archiveRollbackState(plan, result))
        state.repairRequired = false
        markStageCompleted(state, DEPLOYMENT_ROLLBACK_STAGE.ARCHIVED)
        await persistExecutionState(plan, state, deps)
        return result
      },
      {
        ownerId: deps.rollbackTaskId || `rollback:${plan.target.transactionIds.join('-')}`,
        operation: 'rollback',
        errorCode: 'rollback_concurrent_mutation'
      }
    )
  } catch (error) {
    const completedMutation =
      state.mutationStarted === true ||
      state.completedSessionIds.length > 0 ||
      state.updatedModIds.length > 0 ||
      state.reconciledScopeKeys.length > 0
    const errorCode = toSafeText(error?.code, 'rollback_failed')
    const stage = toSafeText(error?.stage, state.stage || DEPLOYMENT_ROLLBACK_STAGE.PLANNED)
    if (!completedMutation) {
      return {
        success: false,
        errorCode,
        stage: toSafeText(stage, DEPLOYMENT_ROLLBACK_STAGE.PLANNED),
        repairRequired: false,
        completedStages: state.completedStages,
        unfinishedScopes: plan.impact?.scopes || [],
        retryable: true,
        message: toSafeText(error?.message, '回滚在文件恢复开始前中止。')
      }
    }

    state.stage = DEPLOYMENT_ROLLBACK_STAGE.REPAIR_REQUIRED
    state.repairRequired = completedMutation
    state.errorCode = errorCode
    state.errorMessage = toSafeText(error?.message, '回滚执行失败')
    await persistExecutionState(plan, state, deps)
    if (completedMutation) {
      await updateSourceJobRollbackState(
        plan.sourceJob,
        plan.target.transactionIds,
        {
          rollback_status: 'repair_required',
          rollback_error: state.errorMessage
        },
        deps
      )
      if (plan.sourceJob?.jobId && typeof deps.updateJob === 'function') {
        await Promise.resolve(
          deps.updateJob(plan.sourceJob.jobId, {
            current_step: '回滚后需要修复',
            error_message: state.errorMessage,
            failure_stage: 'rollback_repair_required',
            failure_json: JSON.stringify({
              errorCode,
              stage,
              repairRequired: true,
              completedStages: state.completedStages,
              unfinishedScopes: getUnfinishedScopes(plan, state)
            })
          })
        )
      }
    }
    return {
      success: false,
      errorCode,
      stage,
      repairRequired: completedMutation,
      completedStages: state.completedStages,
      completedSessionIds: state.completedSessionIds,
      restoredBackupEntryIds: state.restoredBackupEntryIds,
      updatedModIds: state.updatedModIds,
      unfinishedScopes: getUnfinishedScopes(plan, state),
      retryable: true,
      message: state.errorMessage
    }
  }
}
