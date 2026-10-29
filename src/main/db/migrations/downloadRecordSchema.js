function tableExists(database, tableName = '') {
  if (typeof database?.tableExists === 'function') return database.tableExists(tableName)
  return Boolean(
    database?.get?.(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`, [
      tableName
    ])
  )
}

export function ensureDownloadRecordSourcePlatformColumn(database) {
  if (!database?.run || !database?.all || !tableExists(database, 'download_records')) return
  const columns = new Set(
    (database.all(`PRAGMA table_info(download_records)`) || []).map((item) => item.name)
  )
  if (!columns.has('source_platform')) {
    database.clearStatementCache?.()
    database.run(
      `ALTER TABLE download_records ADD COLUMN source_platform TEXT NOT NULL DEFAULT ''`
    )
    database.clearStatementCache?.()
  }

  const thunderstoreConditions = [
    `lower(COALESCE(task_name, '')) LIKE 'thunderstore%'`,
    `lower(COALESCE(download_url, '')) LIKE '%thunderstore.io/%'`
  ]
  if (tableExists(database, 'source_install_artifact')) {
    thunderstoreConditions.push(`EXISTS (
      SELECT 1 FROM source_install_artifact artifact
      WHERE lower(COALESCE(artifact.source, '')) = 'thunderstore'
        AND artifact.file_path = download_records.file_path
    )`)
  }
  if (tableExists(database, 'mods')) {
    thunderstoreConditions.push(`EXISTS (
      SELECT 1 FROM mods
      WHERE lower(COALESCE(mods.source, '')) = 'thunderstore'
        AND mods.archive_path = download_records.file_path
    )`)
  }
  database.run(`
    UPDATE download_records
    SET source_platform = 'thunderstore'
    WHERE COALESCE(source_platform, '') = ''
      AND (${thunderstoreConditions.join(' OR ')})
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_download_records_source_platform
    ON download_records (source_platform)
  `)
}

