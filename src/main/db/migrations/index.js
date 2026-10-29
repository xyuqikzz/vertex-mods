import dbInstance from '../dbInstance.js'
import UPDATE_SQL from './update.sql?raw'
import { ensureAiTranslationCacheScopeTable } from '../cache/aiTranslationCache.js'
import { ensureManagedFileAssetTables } from '../files/managedFileAssets.js'
import { ensureModioGameRuleTable } from '../sources/modio/modioRule.js'
import fs from 'fs'
import path from 'path'
import { resolveModDeployDomain, THUNDERSTORE_SOURCE } from '../mods/modDeployment.js'
import { ensureDownloadRecordSourcePlatformColumn } from './downloadRecordSchema.js'
import { ensureSourceModpackInstanceTables } from '../mods/sourceModpackInstances.js'
import { ensureDeploymentJournalTable, migrateDeploymentOwnerPaths } from './deploymentLedgerSchema.js'

// 兼容旧版 PRAGMA user_version 的目标版本
const TARGET_DB_VERSION = 1
// 代码内数据库版本号（与 app_config.db_version 对比）
const CODE_DB_VERSION = '2.3.1'

function loadUpdateStatements() {
  const sqlContent = String(UPDATE_SQL || '').replace(/^\uFEFF/, '')
  return sqlContent
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement && !statement.startsWith('--'))
    .map((statement) => `${statement};`)
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value) {
  return String(value ?? '').trim()
}

function parseJsonObjectSafe(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  const text = toSafeText(value)
  if (!text) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getModPriorityOrder(row = {}) {
  return toSafeNumber(row.priority_order, 0)
}

function getModInstallTimestamp(row = {}) {
  const installedAt = Date.parse(String(row.installed_at || '').trim())
  if (Number.isFinite(installedAt)) {
    return installedAt
  }
  const createdAt = Date.parse(String(row.created_at || '').trim())
  return Number.isFinite(createdAt) ? createdAt : 0
}

function hasZeroBasedContinuousPriority(rows = []) {
  const prioritySet = new Set(rows.map((row) => getModPriorityOrder(row)))
  return (
    prioritySet.size === rows.length &&
    [...prioritySet].every((value) => value >= 0) &&
    rows.every((_, index) => prioritySet.has(index))
  )
}

function ensureAppConfigTable() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS app_config
    (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key   TEXT NOT NULL UNIQUE,
      config_value TEXT NOT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP
    );
  `)
}

function getLocalDbVersion() {
  const row = dbInstance.get(`SELECT config_value FROM app_config WHERE config_key = ? LIMIT 1`, [
    'db_version'
  ])
  return String(row?.config_value || '').trim()
}

function setLocalDbVersion(version) {
  const now = new Date().toISOString()
  dbInstance.run(
    `
      INSERT INTO app_config (config_key, config_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = excluded.updated_at
    `,
    ['db_version', version, now]
  )
}

function getTableColumns(tableName) {
  try {
    return dbInstance.db.prepare(`PRAGMA table_info(${tableName})`).all()
  } catch (error) {
    console.error(`[数据库更新] 读取 ${tableName} 表结构失败`, error)
    return []
  }
}

function isTableMissingColumn(tableName, columnName) {
  if (!dbInstance.tableExists(tableName)) {
    return true
  }
  return !getTableColumns(tableName).some((column) => column.name === columnName)
}

function hasTableColumn(tableName, columnName) {
  return !isTableMissingColumn(tableName, columnName)
}

function ensureTableColumn(tableName, columnName, columnSql) {
  if (!dbInstance.tableExists(tableName)) {
    return false
  }

  const columns = getTableColumns(tableName)
  if (columns.some((column) => column.name === columnName)) {
    return false
  }

  dbInstance.db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`).run()
  console.log(`[数据库更新] ${tableName} 新增 ${columnName} 字段成功`)
  return true
}

function copyTextColumnIfBlank(tableName, targetColumn, sourceColumn) {
  if (!hasTableColumn(tableName, targetColumn) || !hasTableColumn(tableName, sourceColumn)) {
    return
  }

  dbInstance.run(
    `UPDATE ${tableName}
     SET ${targetColumn} = ${sourceColumn}
     WHERE ((${targetColumn} IS NULL OR trim(${targetColumn}) = '')
       AND ${sourceColumn} IS NOT NULL
       AND trim(${sourceColumn}) <> '')`
  )
}

function copyNumberColumnIfZero(tableName, targetColumn, sourceColumn) {
  if (!hasTableColumn(tableName, targetColumn) || !hasTableColumn(tableName, sourceColumn)) {
    return
  }

  dbInstance.run(
    `UPDATE ${tableName}
     SET ${targetColumn} = ${sourceColumn}
     WHERE ((${targetColumn} IS NULL OR ${targetColumn} = 0)
       AND ${sourceColumn} IS NOT NULL
       AND ${sourceColumn} <> 0)`
  )
}

function ensureModDeployTableColumns() {
  ensureTableColumn('mod_deploy_domains', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_deploy_domains', 'source', "source TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_deploy_domains',
    'endpoint_type',
    'endpoint_type INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn('mod_deploy_domains', 'deploy_domain', "deploy_domain TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_domains', 'target_root', "target_root TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_deploy_domains',
    'metadata_json',
    "metadata_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn('mod_deploy_domains', 'created_at', "created_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_domains', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''")

  ensureTableColumn('mod_deploy_transactions', 'task_id', "task_id TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_transactions', 'agent_task_id', "agent_task_id TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_transactions', 'task_type', "task_type TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_transactions', 'status', "status TEXT NOT NULL DEFAULT 'queued'")
  ensureTableColumn(
    'mod_deploy_transactions',
    'reconcile_type',
    "reconcile_type TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_transactions', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_deploy_transactions', 'source', "source TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_deploy_transactions',
    'endpoint_type',
    'endpoint_type INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn(
    'mod_deploy_transactions',
    'deploy_domain',
    "deploy_domain TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_transactions', 'mod_id', 'mod_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_deploy_transactions',
    'payload_json',
    "payload_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn(
    'mod_deploy_transactions',
    'result_json',
    "result_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn('mod_deploy_transactions', 'error_code', "error_code TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_deploy_transactions',
    'error_message',
    "error_message TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_transactions', 'started_at', "started_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_deploy_transactions',
    'finished_at',
    "finished_at TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_transactions', 'created_at', "created_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_transactions', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''")

  ensureTableColumn('mod_file_manifest', 'mod_id', 'mod_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_file_manifest', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_file_manifest', 'source', "source TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_file_manifest',
    'endpoint_type',
    'endpoint_type INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn('mod_file_manifest', 'deploy_domain', "deploy_domain TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_manifest', 'source_path', "source_path TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_file_manifest',
    'target_relative_path',
    "target_relative_path TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_file_manifest', 'target_path', "target_path TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_manifest', 'file_hash', "file_hash TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_manifest', 'file_size', 'file_size INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_file_manifest',
    'deploy_method',
    "deploy_method TEXT NOT NULL DEFAULT 'link'"
  )
  ensureTableColumn('mod_file_manifest', 'source_type', "source_type TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_file_manifest',
    'metadata_json',
    "metadata_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn('mod_file_manifest', 'created_at', "created_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_manifest', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''")

  ensureTableColumn('mod_file_owners', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_file_owners', 'endpoint_type', 'endpoint_type INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_file_owners', 'deploy_domain', "deploy_domain TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_file_owners',
    'target_relative_path',
    "target_relative_path TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_file_owners', 'target_path', "target_path TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_owners', 'owner_mod_id', 'owner_mod_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_file_owners',
    'owner_priority_order',
    'owner_priority_order INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn('mod_file_owners', 'file_hash', "file_hash TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_owners', 'metadata_json', "metadata_json TEXT NOT NULL DEFAULT '{}'")
  ensureTableColumn('mod_file_owners', 'created_at', "created_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_file_owners', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''")

  ensureTableColumn('mod_backup_snapshots', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_backup_snapshots',
    'endpoint_type',
    'endpoint_type INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn(
    'mod_backup_snapshots',
    'deploy_domain',
    "deploy_domain TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_backup_snapshots', 'mod_id', 'mod_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mod_backup_snapshots', 'target_path', "target_path TEXT NOT NULL DEFAULT ''")
  ensureTableColumn(
    'mod_backup_snapshots',
    'snapshot_path',
    "snapshot_path TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_backup_snapshots', 'file_hash', "file_hash TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_backup_snapshots', 'state', "state TEXT NOT NULL DEFAULT 'active'")
  ensureTableColumn(
    'mod_backup_snapshots',
    'metadata_json',
    "metadata_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn('mod_backup_snapshots', 'created_at', "created_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_backup_snapshots', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''")

  ensureTableColumn(
    'mod_deploy_backup_entries',
    'session_id',
    "session_id TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'agent_task_id',
    "agent_task_id TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_backup_entries', 'game_id', 'game_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'endpoint_type',
    'endpoint_type INTEGER NOT NULL DEFAULT 0'
  )
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'deploy_domain',
    "deploy_domain TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_backup_entries', 'mod_id', 'mod_id INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'target_path',
    "target_path TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'backup_path',
    "backup_path TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn('mod_deploy_backup_entries', 'reason', "reason TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mod_deploy_backup_entries', 'state', "state TEXT NOT NULL DEFAULT 'active'")
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'metadata_json',
    "metadata_json TEXT NOT NULL DEFAULT '{}'"
  )
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'created_at',
    "created_at TEXT NOT NULL DEFAULT ''"
  )
  ensureTableColumn(
    'mod_deploy_backup_entries',
    'updated_at',
    "updated_at TEXT NOT NULL DEFAULT ''"
  )
}

function ensureNexusRuleTrustSchemaColumns() {
  ensureTableColumn('nexus_game_rule', 'rule_checksum', "rule_checksum TEXT DEFAULT ''")
  ensureTableColumn('nexus_game_rule', 'trust_level', "trust_level TEXT DEFAULT 'community'")
}

function ensureUpdateBackup(reason = 'schema') {
  try {
    const dbPath = String(dbInstance.dbPath || '').trim()
    if (!dbPath || !fs.existsSync(dbPath)) {
      return ''
    }

    const backupDir = path.join(path.dirname(dbPath), 'db-backup')
    fs.mkdirSync(backupDir, { recursive: true })
    const safeReason = String(reason || 'schema').replace(/[^\w.-]+/g, '_')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(
      backupDir,
      `${path.basename(dbPath)}.${safeReason}.${timestamp}.bak`
    )
    fs.copyFileSync(dbPath, backupPath)
    console.log(`[数据库更新] 已创建升级前备份：${backupPath}`)
    return backupPath
  } catch (error) {
    console.error('[数据库更新] 创建升级前备份失败，继续执行可重复迁移', error)
    return ''
  }
}

function ensureModDeployTables() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_deploy_domains
    (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id       INTEGER NOT NULL,
      source        TEXT    NOT NULL DEFAULT '',
      endpoint_type INTEGER NOT NULL DEFAULT 0,
      deploy_domain TEXT    NOT NULL DEFAULT '',
      target_root   TEXT    NOT NULL DEFAULT '',
      metadata_json TEXT    NOT NULL DEFAULT '{}',
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (game_id, source, endpoint_type, deploy_domain)
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_domains_scope
    ON mod_deploy_domains (game_id, source, endpoint_type, deploy_domain);
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_deploy_transactions
    (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         TEXT    NOT NULL DEFAULT '',
      agent_task_id   TEXT    NOT NULL DEFAULT '',
      task_type       TEXT    NOT NULL DEFAULT '',
      status          TEXT    NOT NULL DEFAULT 'queued',
      reconcile_type  TEXT    NOT NULL DEFAULT '',
      game_id         INTEGER NOT NULL DEFAULT 0,
      source          TEXT    NOT NULL DEFAULT '',
      endpoint_type   INTEGER NOT NULL DEFAULT 0,
      deploy_domain   TEXT    NOT NULL DEFAULT '',
      mod_id          INTEGER NOT NULL DEFAULT 0,
      payload_json    TEXT    NOT NULL DEFAULT '{}',
      result_json     TEXT    NOT NULL DEFAULT '{}',
      error_code      TEXT    NOT NULL DEFAULT '',
      error_message   TEXT    NOT NULL DEFAULT '',
      started_at      TEXT    NOT NULL DEFAULT '',
      finished_at     TEXT    NOT NULL DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_transactions_scope
    ON mod_deploy_transactions (game_id, source, endpoint_type, deploy_domain, status);
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_transactions_agent_task
    ON mod_deploy_transactions (agent_task_id, updated_at);
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_file_manifest
    (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      mod_id               INTEGER NOT NULL,
      game_id              INTEGER NOT NULL DEFAULT 0,
      source               TEXT    NOT NULL DEFAULT '',
      endpoint_type        INTEGER NOT NULL DEFAULT 0,
      deploy_domain        TEXT    NOT NULL DEFAULT '',
      source_path          TEXT    NOT NULL DEFAULT '',
      target_relative_path TEXT    NOT NULL DEFAULT '',
      target_path          TEXT    NOT NULL DEFAULT '',
      file_hash            TEXT    NOT NULL DEFAULT '',
      file_size            INTEGER NOT NULL DEFAULT 0,
      deploy_method        TEXT    NOT NULL DEFAULT 'link',
      source_type          TEXT    NOT NULL DEFAULT '',
      metadata_json        TEXT    NOT NULL DEFAULT '{}',
      created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (mod_id, endpoint_type, deploy_domain, target_relative_path)
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_file_manifest_scope
    ON mod_file_manifest (game_id, endpoint_type, deploy_domain, target_relative_path);
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_file_owners
    (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id              INTEGER NOT NULL DEFAULT 0,
      endpoint_type        INTEGER NOT NULL DEFAULT 0,
      deploy_domain        TEXT    NOT NULL DEFAULT '',
      target_relative_path TEXT    NOT NULL DEFAULT '',
      target_path          TEXT    NOT NULL DEFAULT '',
      target_path_key      TEXT    NOT NULL DEFAULT '',
      owner_mod_id         INTEGER NOT NULL DEFAULT 0,
      owner_priority_order INTEGER NOT NULL DEFAULT 0,
      file_hash            TEXT    NOT NULL DEFAULT '',
      metadata_json        TEXT    NOT NULL DEFAULT '{}',
      created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (game_id, endpoint_type, deploy_domain, target_path_key)
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_file_owners_owner
    ON mod_file_owners (owner_mod_id, game_id, endpoint_type);
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_backup_snapshots
    (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id        INTEGER NOT NULL DEFAULT 0,
      endpoint_type  INTEGER NOT NULL DEFAULT 0,
      deploy_domain  TEXT    NOT NULL DEFAULT '',
      mod_id         INTEGER NOT NULL DEFAULT 0,
      target_path     TEXT    NOT NULL DEFAULT '',
      snapshot_path   TEXT    NOT NULL DEFAULT '',
      file_hash       TEXT    NOT NULL DEFAULT '',
      state           TEXT    NOT NULL DEFAULT 'active',
      metadata_json   TEXT    NOT NULL DEFAULT '{}',
      created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (game_id, endpoint_type, deploy_domain, target_path)
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_backup_snapshots_mod
    ON mod_backup_snapshots (mod_id, state);
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_deploy_backup_entries
    (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT    NOT NULL DEFAULT '',
      agent_task_id  TEXT    NOT NULL DEFAULT '',
      game_id        INTEGER NOT NULL DEFAULT 0,
      endpoint_type  INTEGER NOT NULL DEFAULT 0,
      deploy_domain  TEXT    NOT NULL DEFAULT '',
      mod_id         INTEGER NOT NULL DEFAULT 0,
      target_path    TEXT    NOT NULL DEFAULT '',
      backup_path    TEXT    NOT NULL DEFAULT '',
      reason         TEXT    NOT NULL DEFAULT '',
      state          TEXT    NOT NULL DEFAULT 'active',
      metadata_json  TEXT    NOT NULL DEFAULT '{}',
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  ensureModDeployTableColumns()

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_session
    ON mod_deploy_backup_entries (session_id, game_id, endpoint_type, deploy_domain);
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_agent_task
    ON mod_deploy_backup_entries (agent_task_id, updated_at);
  `)
}

function ensureModDeploymentColumns() {
  if (!dbInstance.tableExists('mods')) {
    return
  }

  ensureTableColumn('mods', 'description', "description TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mods', 'priority_order', 'priority_order INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn('mods', 'deploy_domain', "deploy_domain TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mods', 'install_model', "install_model TEXT NOT NULL DEFAULT 'legacy'")
  ensureTableColumn('mods', 'last_reconcile_at', "last_reconcile_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mods', 'compat_flags', "compat_flags TEXT NOT NULL DEFAULT '[]'")
  ensureTableColumn('mods', 'profile_enabled', 'profile_enabled INTEGER NOT NULL DEFAULT 1')
  ensureTableColumn('mods', 'source_status', "source_status TEXT NOT NULL DEFAULT 'normal'")
  ensureTableColumn('mods', 'source_status_checked_at', "source_status_checked_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mods', 'source_lock_state', "source_lock_state TEXT NOT NULL DEFAULT 'unlocked'")
  ensureTableColumn('mods', 'source_lock_at', "source_lock_at TEXT NOT NULL DEFAULT ''")
  ensureTableColumn('mods', 'source_root_path', "source_root_path TEXT NOT NULL DEFAULT ''")

  // 数据修复：将旧版空或 NULL 的 profile_name 统一为 'default'
  dbInstance.run(`UPDATE mods SET profile_name = 'default' WHERE profile_name IS NULL OR profile_name = ''`)

  dbInstance.run('DROP INDEX IF EXISTS idx_mods_priority_scope')
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mods_priority_scope
    ON mods (game_id, endpoint_type, deploy_domain, priority_order ASC, id ASC);
  `)
}

function backfillModDeploymentFields() {
  if (!dbInstance.tableExists('mods')) {
    return
  }

  copyTextColumnIfBlank('mod_deploy_transactions', 'task_type', 'action_type')
  copyTextColumnIfBlank('mod_deploy_transactions', 'payload_json', 'plan_json')
  copyTextColumnIfBlank('mod_file_manifest', 'target_relative_path', 'relative_path')
  copyTextColumnIfBlank('mod_file_owners', 'target_relative_path', 'relative_path')
  copyNumberColumnIfZero('mod_file_owners', 'owner_priority_order', 'priority_order')
  copyTextColumnIfBlank('mod_backup_snapshots', 'snapshot_path', 'backup_path')

  if (hasTableColumn('mods', 'description')) {
    const descriptionBackfillRows = dbInstance.all(
      `SELECT id, description, metadata_json
       FROM mods
       WHERE description IS NULL OR trim(description) = ''`
    )

    descriptionBackfillRows.forEach((row) => {
      const metadata = parseJsonObjectSafe(row?.metadata_json)
      const description = toSafeText(
        metadata?.description ??
          metadata?.summary ??
          metadata?.shortDescription ??
          metadata?.fullDescription
      )
      if (!description) {
        return
      }

      dbInstance.run(`UPDATE mods SET description = ? WHERE id = ?`, [
        description,
        toSafeNumber(row?.id, 0)
      ])
    })
  }

  const rows = dbInstance.all(
    `SELECT id, source, endpoint_type, deploy_domain, metadata_json, profile_name
     FROM mods
     WHERE lower(source) <> ?
       AND (deploy_domain IS NULL OR trim(deploy_domain) = '')`,
    [THUNDERSTORE_SOURCE]
  )

  rows.forEach((row) => {
    dbInstance.run(`UPDATE mods SET deploy_domain = ? WHERE id = ?`, [
      resolveModDeployDomain(row),
      row.id
    ])
  })

  const orderedRows = dbInstance.all(
    `SELECT id, game_id, source, endpoint_type, deploy_domain, priority_order, installed_at, created_at
     FROM mods
     WHERE lower(source) <> ?
     ORDER BY game_id ASC,
              lower(source) ASC,
              endpoint_type ASC,
              datetime(NULLIF(installed_at, '')) ASC,
              datetime(created_at) ASC,
              id ASC`,
    [THUNDERSTORE_SOURCE]
  )

  const groupMap = new Map()
  orderedRows.forEach((row) => {
    const groupKey = `${row.game_id}:${String(row.source || '').toLowerCase()}:${row.endpoint_type}`
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, [])
    }
    groupMap.get(groupKey).push(row)
  })

  for (const groupRows of groupMap.values()) {
    if (hasZeroBasedContinuousPriority(groupRows)) {
      continue
    }

    const repairedRows = [...groupRows].sort((left, right) => {
      const priorityDiff = getModPriorityOrder(left) - getModPriorityOrder(right)
      if (priorityDiff !== 0) {
        return priorityDiff
      }

      const installTimeDiff = getModInstallTimestamp(left) - getModInstallTimestamp(right)
      if (installTimeDiff !== 0) {
        return installTimeDiff
      }

      return Number(left.id || 0) - Number(right.id || 0)
    })

    repairedRows.forEach((row, index) => {
      dbInstance.run(`UPDATE mods SET priority_order = ? WHERE id = ?`, [index, row.id])
    })
  }

  dbInstance.run(
    `UPDATE mods
     SET install_model = 'legacy'
     WHERE lower(source) <> ?
       AND (install_model IS NULL OR trim(install_model) = '')`,
    [THUNDERSTORE_SOURCE]
  )

  dbInstance.run(
    `UPDATE mods
     SET compat_flags = '["legacy_unmanaged"]'
     WHERE lower(source) <> ?
       AND (compat_flags IS NULL OR trim(compat_flags) = '' OR trim(compat_flags) = '[]')`,
    [THUNDERSTORE_SOURCE]
  )
}

function ensureModDeploymentSchema() {
  try {
    const columns = getTableColumns('mods')
    const needsBackup =
      !columns.some((column) => column.name === 'priority_order') ||
      !columns.some((column) => column.name === 'deploy_domain') ||
      !columns.some((column) => column.name === 'install_model') ||
      !columns.some((column) => column.name === 'last_reconcile_at') ||
      !columns.some((column) => column.name === 'compat_flags') ||
      !dbInstance.tableExists('mod_deploy_transactions') ||
      !dbInstance.tableExists('mod_file_manifest') ||
      !dbInstance.tableExists('mod_file_owners') ||
      !dbInstance.tableExists('mod_backup_snapshots') ||
      !dbInstance.tableExists('mod_deploy_domains') ||
      !dbInstance.tableExists('mod_deploy_backup_entries') ||
      isTableMissingColumn('mod_deploy_domains', 'source') ||
      isTableMissingColumn('mod_deploy_domains', 'endpoint_type') ||
      isTableMissingColumn('mod_deploy_domains', 'deploy_domain') ||
      isTableMissingColumn('mod_deploy_transactions', 'source') ||
      isTableMissingColumn('mod_deploy_transactions', 'agent_task_id') ||
      isTableMissingColumn('mod_deploy_transactions', 'endpoint_type') ||
      isTableMissingColumn('mod_deploy_transactions', 'deploy_domain') ||
      isTableMissingColumn('mod_deploy_transactions', 'status') ||
      isTableMissingColumn('mod_file_manifest', 'source') ||
      isTableMissingColumn('mod_file_manifest', 'endpoint_type') ||
      isTableMissingColumn('mod_file_manifest', 'deploy_domain') ||
      isTableMissingColumn('mod_file_manifest', 'target_relative_path') ||
      isTableMissingColumn('mod_file_owners', 'owner_mod_id') ||
      isTableMissingColumn('mod_file_owners', 'endpoint_type') ||
      isTableMissingColumn('mod_file_owners', 'deploy_domain') ||
      isTableMissingColumn('mod_file_owners', 'target_relative_path') ||
      isTableMissingColumn('mod_file_owners', 'target_path_key') ||
      isTableMissingColumn('mod_backup_snapshots', 'mod_id') ||
      isTableMissingColumn('mod_backup_snapshots', 'endpoint_type') ||
      isTableMissingColumn('mod_backup_snapshots', 'deploy_domain') ||
      isTableMissingColumn('mod_backup_snapshots', 'state') ||
      isTableMissingColumn('mod_deploy_backup_entries', 'session_id') ||
      isTableMissingColumn('mod_deploy_backup_entries', 'agent_task_id') ||
      isTableMissingColumn('mod_deploy_backup_entries', 'target_path') ||
      isTableMissingColumn('mod_deploy_backup_entries', 'backup_path') ||
      isTableMissingColumn('mod_deploy_backup_entries', 'reason')
    if (needsBackup) {
      ensureUpdateBackup('mod_deployment')
    }
    dbInstance.transaction(() => {
      ensureModDeploymentColumns()
      ensureModDeployTables()
      backfillModDeploymentFields()
      migrateDeploymentOwnerPaths(dbInstance)
      ensureDeploymentJournalTable(dbInstance)
    })
  } catch (error) {
    console.error('[数据库更新] 模组部署架构迁移失败，不阻断应用启动', error)
  }
}

function runLegacyPragmaMigrations() {
  const pragmaResult = dbInstance.db.pragma('user_version', { simple: true })
  let currentVersion = Number(pragmaResult) || 0

  console.log(`[数据库版本][PRAGMA] 当前版本: ${currentVersion}, 目标版本: ${TARGET_DB_VERSION}`)

  if (currentVersion >= TARGET_DB_VERSION) {
    console.log('[数据库更新][PRAGMA] 版本一致，跳过旧版升级脚本')
    return
  }

  dbInstance.transaction(() => {
    if (currentVersion < 1) {
      console.log('[数据库更新] 执行 V1 升级脚本...')
      try {
        const columns = dbInstance.db.prepare(`PRAGMA table_info(mods)`).all()
        const hasIsActive = columns.some((col) => col.name === 'is_active')
        if (!hasIsActive) {
          dbInstance.db.prepare(`ALTER TABLE mods ADD COLUMN is_active INTEGER DEFAULT 1`).run()
        }
      } catch (e) {
        console.error('[数据库更新] V1 升级异常 (is_active 字段)', e)
      }
      currentVersion = 1
    }

    if (currentVersion === TARGET_DB_VERSION) {
      dbInstance.db.pragma(`user_version = ${TARGET_DB_VERSION}`)
      console.log(`[数据库更新][PRAGMA] 更新完成! 当前版本: ${TARGET_DB_VERSION}`)
    }
  })
}

function ensureAiTranslationCacheShareColumns() {
  if (!dbInstance.tableExists('ai_translation_cache')) {
    return
  }

  try {
    const columns = dbInstance.db.prepare(`PRAGMA table_info(ai_translation_cache)`).all()
    const hasSharedUploadedAt = columns.some((col) => col.name === 'shared_uploaded_at')
    if (!hasSharedUploadedAt) {
      dbInstance.db
        .prepare(
          `ALTER TABLE ai_translation_cache ADD COLUMN shared_uploaded_at TIMESTAMP DEFAULT NULL`
        )
        .run()
      console.log('[数据库更新] ai_translation_cache 新增 shared_uploaded_at 字段成功')
    }
  } catch (error) {
    console.error('[数据库更新] ai_translation_cache 补字段失败', error)
  }
}

function ensureAiTranslationCacheManagementTables() {
  try {
    ensureAiTranslationCacheScopeTable()
  } catch (error) {
    console.error('[数据库更新] ai_translation_cache_scope 检查失败', error)
  }
}

function ensureLocalToolchainTables() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS local_mod_library
    (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id            INTEGER NOT NULL DEFAULT 0,
      source_platform    TEXT    NOT NULL DEFAULT 'local',
      source_profile     TEXT    NOT NULL DEFAULT 'default',
      display_name       TEXT    NOT NULL DEFAULT '',
      file_name          TEXT    NOT NULL DEFAULT '',
      version            TEXT    NOT NULL DEFAULT '',
      author             TEXT    NOT NULL DEFAULT '',
      website            TEXT    NOT NULL DEFAULT '',
      description        TEXT    NOT NULL DEFAULT '',
      cover_path         TEXT    NOT NULL DEFAULT '',
      import_source_type TEXT    NOT NULL DEFAULT 'archive',
      import_origin_path TEXT    NOT NULL DEFAULT '',
      library_root_path  TEXT    NOT NULL DEFAULT '',
      fingerprint        TEXT    NOT NULL DEFAULT '',
      mod_type           TEXT    NOT NULL DEFAULT '',
      tags_json          TEXT    NOT NULL DEFAULT '[]',
      metadata_json      TEXT    NOT NULL DEFAULT '{}',
      created_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      state              TEXT    NOT NULL DEFAULT 'active'
    );
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS local_mod_library_entry
    (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id    INTEGER NOT NULL DEFAULT 0,
      relative_path TEXT    NOT NULL DEFAULT '',
      entry_type    TEXT    NOT NULL DEFAULT 'file',
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      file_hash     TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS vxpack_history
    (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id          INTEGER NOT NULL DEFAULT 0,
      operation_type   TEXT    NOT NULL DEFAULT '',
      package_path     TEXT    NOT NULL DEFAULT '',
      manifest_version INTEGER NOT NULL DEFAULT 1,
      mod_count        INTEGER NOT NULL DEFAULT 0,
      profile_count    INTEGER NOT NULL DEFAULT 0,
      size_bytes       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      state            TEXT    NOT NULL DEFAULT 'completed'
    );
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_local_mod_library_scope
    ON local_mod_library (game_id, source_platform, source_profile, state);
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_local_mod_library_fingerprint
    ON local_mod_library (game_id, fingerprint, state);
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_local_mod_library_entry_library
    ON local_mod_library_entry (library_id);
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_vxpack_history_scope
    ON vxpack_history (game_id, operation_type, created_at);
  `)
}

export const upDate = () => {
  console.log('执行数据库更新检查...')
  try {
    // 1) 先执行旧版数字迁移，兼容历史数据库
    runLegacyPragmaMigrations()
    ensureAiTranslationCacheShareColumns()
    ensureAiTranslationCacheManagementTables()
    ensureNexusRuleTrustSchemaColumns()
    ensureModDeploymentSchema()
    ensureModioGameRuleTable()
    ensureLocalToolchainTables()
    ensureManagedFileAssetTables()
    ensureDownloadRecordSourcePlatformColumn(dbInstance)
    ensureSourceModpackInstanceTables(dbInstance)

    // 2) 再走字符串版本迁移
    ensureAppConfigTable()
    const localDbVersion = getLocalDbVersion()
    console.log(
      `[数据库版本][配置表] 本地版本: ${localDbVersion || '未设置'}, 代码版本: ${CODE_DB_VERSION}`
    )

    if (localDbVersion === CODE_DB_VERSION) {
      console.log('[数据库更新] 配置表版本一致，跳过 update.sql')
      return
    }

    const statements = loadUpdateStatements()
    dbInstance.transaction(() => {
      statements.forEach((sql) => dbInstance.run(sql))
      ensureAiTranslationCacheShareColumns()
      ensureAiTranslationCacheManagementTables()
      ensureNexusRuleTrustSchemaColumns()
      ensureModioGameRuleTable()
      ensureLocalToolchainTables()
      ensureManagedFileAssetTables()
      ensureDownloadRecordSourcePlatformColumn(dbInstance)
      ensureSourceModpackInstanceTables(dbInstance)
      setLocalDbVersion(CODE_DB_VERSION)
    })
    console.log(`[数据库更新] update.sql 执行完成，版本已更新到 ${CODE_DB_VERSION}`)
  } catch (err) {
    console.error('[数据库更新失败] 致命错误:', err)
  }
}
