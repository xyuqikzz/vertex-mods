import { normalizeDeploymentPath } from '../../utils/deploymentPathIdentity.js'

export function ensureDeploymentJournalTable(database) {
  database.run(`CREATE TABLE IF NOT EXISTS mod_deploy_journal (
    session_id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    endpoint_type INTEGER NOT NULL DEFAULT 0,
    deploy_domain TEXT NOT NULL,
    state TEXT NOT NULL,
    backup_root TEXT NOT NULL,
    session_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  database.run(`CREATE INDEX IF NOT EXISTS idx_mod_deploy_journal_scope
    ON mod_deploy_journal (game_id, endpoint_type, deploy_domain, state)`)
  database.run(`CREATE TABLE IF NOT EXISTS mod_deploy_journal_entries (
    session_id TEXT NOT NULL, entry_type TEXT NOT NULL, entry_index INTEGER NOT NULL,
    payload_json TEXT NOT NULL, PRIMARY KEY (session_id, entry_type, entry_index)
  )`)
}

const LEGACY_OWNER_UNIQUE =
  /(,?)(\s*)((?:CONSTRAINT\s+(?:"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[\w$]+)\s*)?UNIQUE\s*\(\s*game_id\s*,\s*endpoint_type\s*,\s*deploy_domain\s*,\s*target_relative_path\s*\)(?:\s*ON\s+CONFLICT\s+\w+)?)/i

/**
 * 生成与原 SQL 等长的“匹配视图”：注释替换为空白、字符串字面量内容替换为占位符，
 * 引号标识符原样保留。下标与原 SQL 一一对应，便于在原文上按位置删改。
 */
function maskSqlForMatching(sql) {
  let masked = ''
  let index = 0
  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]
    let end
    if (char === '-' && next === '-') {
      end = sql.indexOf('\n', index)
      if (end === -1) end = sql.length
      masked += ' '.repeat(end - index)
    } else if (char === '/' && next === '*') {
      end = sql.indexOf('*/', index + 2)
      end = end === -1 ? sql.length : end + 2
      masked += sql.slice(index, end).replace(/[^\n]/g, ' ')
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char
      end = index + 1
      while (end < sql.length) {
        if (sql[end] === close) {
          if (close !== ']' && sql[end + 1] === close) {
            end += 2
            continue
          }
          end += 1
          break
        }
        end += 1
      }
      const chunk = sql.slice(index, end)
      masked +=
        char === "'"
          ? chunk.replace(/[^\n]/g, (c, offset) =>
              offset === 0 || offset === chunk.length - 1 ? c : '_'
            )
          : chunk
    } else {
      end = index + 1
      masked += char
    }
    index = end
  }
  return masked
}

/**
 * 删除旧的 (game_id, endpoint_type, deploy_domain, target_relative_path) 唯一约束。
 * SQLite 的 ADD COLUMN 会把新列插到表约束前的逗号处，逗号与 UNIQUE 之间常隔着 `-- 注释`，
 * 因此在匹配视图里定位，再按位置删除原文中的逗号与约束本体，注释保留。
 */
function stripLegacyOwnerUnique(sql) {
  const masked = maskSqlForMatching(sql)
  const match = LEGACY_OWNER_UNIQUE.exec(masked)
  if (!match) return sql
  const [, comma, gap, constraint] = match
  const commaIndex = match.index
  const constraintStart = commaIndex + comma.length + gap.length
  const constraintEnd = constraintStart + constraint.length
  // 后面紧跟的若既不是逗号也不是右括号（SQLite 允许表约束之间省略逗号），则保留前导逗号
  const following = masked.slice(constraintEnd).trimStart()[0]
  const dropComma = comma && (following === ',' || following === ')')
  return (
    sql.slice(0, dropComma ? commaIndex : commaIndex + comma.length) +
    sql.slice(commaIndex + comma.length, constraintStart) +
    sql.slice(constraintEnd)
  )
}

/** 保留旧表的扩展列、索引和触发器；重复归属另行留档，不丢弃迁移证据。 */
export function migrateDeploymentOwnerPaths(database) {
  if (!database.tableExists('mod_file_owners')) return
  const table = database.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mod_file_owners'"
  )
  const columns = database.all('PRAGMA table_info(mod_file_owners)')
  const legacyIndexes = new Set(
    database
      .all('PRAGMA index_list(mod_file_owners)')
      .filter(
        (index) =>
          index.unique &&
          database
            .all(`PRAGMA index_info("${index.name.replace(/"/g, '""')}")`)
            .map((column) => column.name)
            .join(',') === 'game_id,endpoint_type,deploy_domain,target_relative_path'
      )
      .map((index) => index.name)
  )
  if (
    columns.some((column) => column.name === 'target_path_key') &&
    !LEGACY_OWNER_UNIQUE.test(maskSqlForMatching(table.sql)) &&
    !legacyIndexes.size
  )
    return

  database.transaction(() => {
    if (!columns.some((column) => column.name === 'target_path_key')) {
      database.run(
        "ALTER TABLE mod_file_owners ADD COLUMN target_path_key TEXT NOT NULL DEFAULT ''"
      )
    }
    const currentSql = database.get(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mod_file_owners'"
    ).sql
    const extraSchema = database
      .all(
        `SELECT name, sql FROM sqlite_master
      WHERE tbl_name = 'mod_file_owners' AND type IN ('index', 'trigger') AND sql IS NOT NULL`
      )
      .filter((entry) => !legacyIndexes.has(entry.name))
    const nextSql = stripLegacyOwnerUnique(
      currentSql.replace(
        /^(CREATE TABLE(?: IF NOT EXISTS)?\s+)["`[]?mod_file_owners["`\]]?/i,
        '$1mod_file_owners_path_migration'
      )
    )
    database.run('DROP TABLE IF EXISTS mod_file_owners_path_migration')
    database.run(nextSql)
    database.run(`CREATE TABLE IF NOT EXISTS mod_file_owners_migration_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    const seen = new Set()
    const rows = database.all(
      'SELECT * FROM mod_file_owners ORDER BY owner_priority_order DESC, id DESC'
    )
    for (const row of rows) {
      const originalRow = JSON.stringify(row)
      row.target_path_key = normalizeDeploymentPath(row.target_path)
      let metadata
      try {
        metadata = JSON.parse(row.metadata_json || '{}')
      } catch {
        metadata = {}
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {}
      if (!metadata.targetBoundaryRoot && database.tableExists('mods')) {
        const mod = database.get('SELECT * FROM mods WHERE id = ?', [row.owner_mod_id])
        let modMetadata
        try {
          modMetadata = JSON.parse(mod?.metadata_json || '{}')
        } catch {
          modMetadata = {}
        }
        if (!modMetadata || typeof modMetadata !== 'object' || Array.isArray(modMetadata)) modMetadata = {}
        const boundary = modMetadata.targetPath || mod?.target_path
        if (boundary) metadata.targetBoundaryRoot = boundary
      }
      row.metadata_json = JSON.stringify(metadata)
      const key = JSON.stringify([
        row.game_id,
        row.endpoint_type,
        row.deploy_domain,
        row.target_path_key
      ])
      if (!row.target_path_key || seen.has(key)) {
        database.run(
          'INSERT INTO mod_file_owners_migration_archive(original_json, reason) VALUES (?, ?)',
          [
            originalRow,
            row.target_path_key ? 'duplicate_target_path' : 'missing_target_path'
          ]
        )
        continue
      }
      seen.add(key)
      const names = Object.keys(row)
      database.run(
        `INSERT INTO mod_file_owners_path_migration (${names.map((name) => `"${name.replace(/"/g, '""')}"`).join(',')})
        VALUES (${names.map(() => '?').join(',')})`,
        names.map((name) => row[name])
      )
    }
    database.run('DROP TABLE mod_file_owners')
    database.run('ALTER TABLE mod_file_owners_path_migration RENAME TO mod_file_owners')
    for (const entry of extraSchema) database.run(entry.sql)
    database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_file_owners_target
      ON mod_file_owners(game_id, endpoint_type, deploy_domain, target_path_key)`)
  })
  database.clearStatementCache?.()
}
