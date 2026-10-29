function run(database, sql, params = []) {
  return database.run(sql, params)
}

function all(database, sql, params = []) {
  return database.all(sql, params)
}

function clearStatementCache(database) {
  if (typeof database.clearStatementCache === 'function') {
    database.clearStatementCache()
  }
}

function runSchema(database, sql, params = []) {
  clearStatementCache(database)
  const result = run(database, sql, params)
  clearStatementCache(database)
  return result
}

function getTableColumnNames(database, tableName = '') {
  clearStatementCache(database)
  return all(database, `PRAGMA table_info(${tableName})`).map((item) => item.name)
}

function getMissingColumnName(error = {}) {
  const message = String(error?.message || '')
  const match = message.match(/no such column:\s*([A-Za-z0-9_]+)/i)
  return match?.[1] || ''
}

function ensureTableColumn(database, tableName = '', columnName = '', columnSql = '') {
  const existingColumns = getTableColumnNames(database, tableName)
  if (existingColumns.includes(columnName)) {
    return
  }
  runSchema(database, `ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`)
}

function runSchemaIndex(database, sql, tableName = '', columnFallbacks = {}) {
  try {
    return runSchema(database, sql)
  } catch (error) {
    const missingColumnName = getMissingColumnName(error)
    const columnSql = columnFallbacks[missingColumnName]
    if (!columnSql) {
      throw error
    }

    ensureTableColumn(database, tableName, missingColumnName, columnSql)
    return runSchema(database, sql)
  }
}

export function ensureSourceInstallTaskTables(database) {
  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS source_install_job
    (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT NOT NULL UNIQUE,
      agent_task_id  TEXT,
      source         TEXT NOT NULL,
      source_adapter TEXT NOT NULL,
      game_key       TEXT NOT NULL,
      game_root      TEXT NOT NULL,
      title          TEXT NOT NULL,
      state          TEXT NOT NULL,
      progress       INTEGER DEFAULT 0 NOT NULL,
      current_step   TEXT,
      error_message  TEXT,
      precheck_status TEXT,
      precheck_json  TEXT,
      failure_stage  TEXT,
      failure_json   TEXT,
      health_status  TEXT,
      health_json    TEXT,
      warning_count  INTEGER DEFAULT 0,
      blocker_count  INTEGER DEFAULT 0,
      payload_json   TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      completed_at   TEXT
    );
  `
  )

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS source_install_job_item
    (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      item_type      TEXT NOT NULL,
      source_mod_key TEXT,
      dependency_key TEXT,
      install_key    TEXT,
      artifact_key   TEXT,
      title          TEXT NOT NULL,
      version        TEXT,
      state          TEXT NOT NULL,
      progress       INTEGER DEFAULT 0 NOT NULL,
      error_message  TEXT,
      failure_stage  TEXT,
      failure_json   TEXT,
      health_status  TEXT,
      health_json    TEXT,
      conflict_json  TEXT,
      install_plan_json TEXT,
      transaction_id TEXT,
      transaction_status TEXT,
      rollback_status TEXT,
      rollback_error TEXT,
      change_set_json TEXT,
      metadata_json  TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE (job_id, item_id)
    );
  `
  )

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS source_install_artifact
    (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_key     TEXT NOT NULL UNIQUE,
      source           TEXT NOT NULL,
      game_key         TEXT NOT NULL,
      provider         TEXT,
      provider_id      TEXT,
      version          TEXT,
      file_name        TEXT,
      file_path        TEXT,
      download_task_id TEXT,
      download_url     TEXT,
      file_size        INTEGER DEFAULT 0,
      md5              TEXT,
      sha256           TEXT,
      state            TEXT NOT NULL,
      error_message    TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
  `
  )

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS source_install_step_log
    (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL,
      item_id     TEXT,
      level       TEXT NOT NULL,
      message     TEXT NOT NULL,
      detail_json TEXT,
      created_at  TEXT NOT NULL
    );
  `
  )

  ensureTableColumn(database, 'source_install_job', 'precheck_status', 'precheck_status TEXT')
  ensureTableColumn(database, 'source_install_job', 'agent_task_id', 'agent_task_id TEXT')
  ensureTableColumn(database, 'source_install_job', 'precheck_json', 'precheck_json TEXT')
  ensureTableColumn(database, 'source_install_job', 'failure_stage', 'failure_stage TEXT')
  ensureTableColumn(database, 'source_install_job', 'failure_json', 'failure_json TEXT')
  ensureTableColumn(database, 'source_install_job', 'health_status', 'health_status TEXT')
  ensureTableColumn(database, 'source_install_job', 'health_json', 'health_json TEXT')
  ensureTableColumn(database, 'source_install_job', 'warning_count', 'warning_count INTEGER DEFAULT 0')
  ensureTableColumn(database, 'source_install_job', 'blocker_count', 'blocker_count INTEGER DEFAULT 0')
  ensureTableColumn(database, 'source_install_job_item', 'failure_stage', 'failure_stage TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'failure_json', 'failure_json TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'health_status', 'health_status TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'health_json', 'health_json TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'conflict_json', 'conflict_json TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'install_plan_json', 'install_plan_json TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'transaction_id', 'transaction_id TEXT')
  ensureTableColumn(
    database,
    'source_install_job_item',
    'transaction_status',
    'transaction_status TEXT'
  )
  ensureTableColumn(database, 'source_install_job_item', 'rollback_status', 'rollback_status TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'rollback_error', 'rollback_error TEXT')
  ensureTableColumn(database, 'source_install_job_item', 'change_set_json', 'change_set_json TEXT')

  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_source_install_job_state
    ON source_install_job (state, updated_at);
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_source_install_job_game
    ON source_install_job (source, game_key, updated_at);
  `
  )
  runSchemaIndex(
    database,
    `
      CREATE INDEX IF NOT EXISTS idx_source_install_job_agent_task
      ON source_install_job (agent_task_id, updated_at);
    `,
    'source_install_job',
    {
      agent_task_id: 'agent_task_id TEXT'
    }
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_source_install_item_job
    ON source_install_job_item (job_id, state);
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_source_install_item_install_key
    ON source_install_job_item (install_key, state);
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_source_install_artifact_state
    ON source_install_artifact (state, updated_at);
  `
  )
}
