import { ensureDeploymentJournalTable } from '../../db/migrations/deploymentLedgerSchema.js'

export const DEPLOYMENT_BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const entryTypes = [
  'appliedEntries',
  'backupEntries',
  'restoredBackupEntries',
  'missingBackupEntries',
  'discardedBackupEntries'
]
const savedCounts = new WeakMap()

function sessionHeader(session) {
  return Object.fromEntries(Object.entries(session).filter(([key]) => !entryTypes.includes(key)))
}

export function createDeploymentJournal(database, scope, session, backupRoot) {
  ensureDeploymentJournalTable(database)
  database.run(
    `INSERT INTO mod_deploy_journal
    (session_id, game_id, source, endpoint_type, deploy_domain, state, backup_root, session_json, updated_at)
    VALUES (?, ?, ?, ?, ?, 'applying', ?, ?, ?)`,
    [
      session.sessionId,
      scope.gameId,
      scope.source,
      scope.endpointType,
      scope.deployDomain,
      backupRoot,
      JSON.stringify(sessionHeader(session)),
      Date.now()
    ]
  )
}

export function checkpointDeploymentJournal(database, session, state = 'applying') {
  const counts = savedCounts.get(session) || {}
  database.transaction(() => {
    // 每次只保存新增项及仍可能更新的最后一项，避免 N 个文件产生 N² 的日志写入。
    for (const type of entryTypes) {
      const entries = session[type] || []
      for (let index = Math.max(0, (counts[type] || 0) - 1); index < entries.length; index++) {
        database.run(
          `INSERT INTO mod_deploy_journal_entries(session_id, entry_type, entry_index, payload_json)
          VALUES (?, ?, ?, ?) ON CONFLICT(session_id, entry_type, entry_index)
          DO UPDATE SET payload_json = excluded.payload_json WHERE payload_json != excluded.payload_json`,
          [session.sessionId, type, index, JSON.stringify(entries[index])]
        )
      }
    }
    const result = database.run(
      `UPDATE mod_deploy_journal SET state = ?, session_json = ?, updated_at = ?
      WHERE session_id = ?`,
      [state, JSON.stringify(sessionHeader(session)), Date.now(), session.sessionId]
    )
    if (!result.changes) throw new Error('部署恢复日志不存在，已阻止文件写入')
  })
  savedCounts.set(
    session,
    Object.fromEntries(entryTypes.map((type) => [type, (session[type] || []).length]))
  )
}

export function readDeploymentJournalSession(database, row) {
  const session = JSON.parse(row.session_json)
  for (const type of entryTypes) session[type] = []
  for (const entry of database.all(
    `SELECT * FROM mod_deploy_journal_entries WHERE session_id = ?
    ORDER BY entry_index ASC`,
    [row.session_id]
  )) {
    if (!entryTypes.includes(entry.entry_type)) throw new Error('部署恢复日志包含未知操作')
    session[entry.entry_type].push(JSON.parse(entry.payload_json))
  }
  return session
}

export function listPendingDeploymentJournals(database, scope = null) {
  if (!database.tableExists('mod_deploy_journal')) return []
  return database.all(
    `SELECT * FROM mod_deploy_journal WHERE state IN ('applying', 'needs_repair')
    ${scope ? 'AND game_id = ? AND endpoint_type = ? AND deploy_domain = ?' : ''}
    ORDER BY updated_at ASC`,
    scope ? [scope.gameId, scope.endpointType, scope.deployDomain] : []
  )
}
