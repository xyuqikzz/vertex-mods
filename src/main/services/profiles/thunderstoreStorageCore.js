import path from 'path'

export const THUNDERSTORE_STORAGE_DIRECTORY = 'Thunderstore'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function normalizePathKey(value = '') {
  const safeValue = toSafeText(value)
  if (!safeValue) return ''
  return path.resolve(safeValue).replace(/\//g, '\\').toLowerCase()
}

export function matchRunningThunderstoreProfiles(profiles = [], processData = {}) {
  const processList = Array.isArray(processData?.list) ? processData.list : []
  const result = []
  const seen = new Set()
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const executablePath = toSafeText(profile?.game_exe_path || profile?.gameExePath)
    if (!executablePath) continue
    const executableKey = normalizePathKey(executablePath)
    const executableName = path.basename(executablePath).toLowerCase()
    const exactMatches = processList.filter(
      (processInfo) => normalizePathKey(processInfo?.path) === executableKey
    )
    const matches = exactMatches.length
      ? exactMatches
      : processList.filter(
          (processInfo) =>
            !toSafeText(processInfo?.path) &&
            String(processInfo?.name || '')
              .trim()
              .toLowerCase() === executableName
        )
    if (!matches.length || seen.has(executableKey)) continue
    seen.add(executableKey)
    result.push({
      gameId: Number(profile?.game_id || profile?.gameId || 0),
      gameName:
        toSafeText(profile?.game_name || profile?.gameName) ||
        toSafeText(profile?.community) ||
        executableName,
      executablePath,
      pids: matches.map((item) => Number(item?.pid || 0)).filter((pid) => pid > 0)
    })
  }
  return result
}

export function resolveThunderstoreStoragePaths(downloadPath = '') {
  const safeDownloadPath = toSafeText(downloadPath)
  if (!safeDownloadPath) {
    throw new Error('下载路径不能为空')
  }
  const downloadRoot = path.resolve(safeDownloadPath)
  const root = path.join(downloadRoot, THUNDERSTORE_STORAGE_DIRECTORY)
  return {
    downloadRoot,
    root,
    cacheRoot: path.join(root, 'cache'),
    profileRoot: path.join(root, 'profiles'),
    ecosystemRoot: path.join(root, 'ecosystem'),
    ecosystemCacheFile: path.join(root, 'ecosystem', 'ecosystem-cache.json')
  }
}

export function isPathInsideRoot(targetPath = '', rootPath = '') {
  const targetKey = normalizePathKey(targetPath)
  const rootKey = normalizePathKey(rootPath)
  return !!targetKey && !!rootKey && (targetKey === rootKey || targetKey.startsWith(`${rootKey}\\`))
}

export function normalizePathMappings(mappings = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(mappings) ? mappings : []) {
    const from = toSafeText(item?.from)
    const to = toSafeText(item?.to)
    if (!from || !to) continue
    const kind = item?.kind === 'file' ? 'file' : 'root'
    const fromKey = normalizePathKey(from)
    const toKey = normalizePathKey(to)
    if (!fromKey || !toKey || fromKey === toKey) continue
    const key = `${kind}:${fromKey}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ from: path.resolve(from), to: path.resolve(to), kind })
  }
  return result.sort((left, right) => right.from.length - left.from.length)
}

export function rebaseThunderstorePath(value = '', mappings = []) {
  const safeValue = toSafeText(value)
  if (!safeValue || !path.isAbsolute(safeValue)) return safeValue
  const resolvedValue = path.resolve(safeValue)
  const valueKey = normalizePathKey(resolvedValue)

  for (const mapping of normalizePathMappings(mappings)) {
    const fromKey = normalizePathKey(mapping.from)
    if (mapping.kind === 'file') {
      if (valueKey === fromKey) return mapping.to
      continue
    }
    if (valueKey === fromKey) return mapping.to
    if (valueKey.startsWith(`${fromKey}\\`)) {
      return path.resolve(mapping.to, path.relative(mapping.from, resolvedValue))
    }
  }
  return safeValue
}

export function rewriteThunderstoreJsonPaths(value, mappings = []) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteThunderstoreJsonPaths(item, mappings))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteThunderstoreJsonPaths(item, mappings)])
    )
  }
  return typeof value === 'string' ? rebaseThunderstorePath(value, mappings) : value
}

function rewriteJsonText(value = '', mappings = []) {
  const text = toSafeText(value)
  if (!text) return value
  try {
    return JSON.stringify(rewriteThunderstoreJsonPaths(JSON.parse(text), mappings))
  } catch {
    return value
  }
}

function tableExists(database, tableName = '') {
  if (typeof database?.tableExists === 'function') return database.tableExists(tableName)
  return Boolean(
    database?.get?.(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`, [
      tableName
    ])
  )
}

function getTableColumns(database, tableName = '') {
  if (!tableExists(database, tableName)) return new Set()
  return new Set((database.all(`PRAGMA table_info(${tableName})`) || []).map((item) => item.name))
}

function rewriteScalarColumns(database, tableName, rows, columns, mappings, summary) {
  for (const row of rows) {
    const patch = {}
    for (const column of columns) {
      if (!(column in row)) continue
      const nextValue = rebaseThunderstorePath(row[column], mappings)
      if (nextValue !== row[column]) patch[column] = nextValue
    }
    if (!Object.keys(patch).length) continue
    const assignments = Object.keys(patch).map((column) => `${column} = ?`)
    const params = Object.values(patch)
    if ('updated_at' in row) {
      assignments.push('updated_at = ?')
      params.push(new Date().toISOString())
    }
    params.push(row.id)
    database.run(`UPDATE ${tableName} SET ${assignments.join(', ')} WHERE id = ?`, params)
    summary.updatedRows += 1
  }
}

function rewriteJsonColumns(database, tableName, rows, columns, mappings, summary) {
  for (const row of rows) {
    const patch = {}
    for (const column of columns) {
      if (!(column in row)) continue
      const nextValue = rewriteJsonText(row[column], mappings)
      if (nextValue !== row[column]) patch[column] = nextValue
    }
    if (!Object.keys(patch).length) continue
    const assignments = Object.keys(patch).map((column) => `${column} = ?`)
    const params = Object.values(patch)
    if ('updated_at' in row) {
      assignments.push('updated_at = ?')
      params.push(new Date().toISOString())
    }
    params.push(row.id)
    database.run(`UPDATE ${tableName} SET ${assignments.join(', ')} WHERE id = ?`, params)
    summary.updatedRows += 1
  }
}

function rewriteManagedAssets(database, mappings, summary) {
  if (!tableExists(database, 'managed_file_assets')) return
  const assets = database.all(
    `SELECT * FROM managed_file_assets WHERE lower(COALESCE(source_platform, '')) = 'thunderstore'`
  )
  for (const asset of assets) {
    const nextFilePath = rebaseThunderstorePath(asset.file_path, mappings)
    const nextStorageRoot = rebaseThunderstorePath(asset.storage_root_path, mappings)
    if (nextFilePath === asset.file_path && nextStorageRoot === asset.storage_root_path) continue

    const duplicate = database.get(
      `SELECT * FROM managed_file_assets WHERE file_path = ? AND asset_id <> ? LIMIT 1`,
      [nextFilePath, asset.asset_id]
    )
    if (duplicate) {
      if (tableExists(database, 'managed_file_asset_owners')) {
        database.run(
          `INSERT OR IGNORE INTO managed_file_asset_owners
             (asset_id, owner_type, owner_id, relation_type, delete_policy_override, created_at, updated_at)
           SELECT ?, owner_type, owner_id, relation_type, delete_policy_override, created_at, updated_at
           FROM managed_file_asset_owners WHERE asset_id = ?`,
          [duplicate.asset_id, asset.asset_id]
        )
        database.run(`DELETE FROM managed_file_asset_owners WHERE asset_id = ?`, [asset.asset_id])
      }
      database.run(`DELETE FROM managed_file_assets WHERE asset_id = ?`, [asset.asset_id])
    } else {
      database.run(
        `UPDATE managed_file_assets
         SET file_path = ?, storage_root_path = ?, updated_at = ?
         WHERE asset_id = ?`,
        [nextFilePath, nextStorageRoot, new Date().toISOString(), asset.asset_id]
      )
    }
    summary.updatedRows += 1
  }
}

export function rewriteThunderstoreDatabasePaths(database, mappings = []) {
  if (!database?.run || !database?.all || !database?.transaction) {
    throw new Error('数据库实例不可用')
  }
  const normalizedMappings = normalizePathMappings(mappings)
  const summary = { updatedRows: 0 }
  if (!normalizedMappings.length) return summary

  database.transaction(() => {
    if (tableExists(database, 'thunderstore_profiles')) {
      const rows = database.all(`SELECT * FROM thunderstore_profiles`)
      rewriteScalarColumns(database, 'thunderstore_profiles', rows, ['profile_root'], normalizedMappings, summary)
    }

    if (tableExists(database, 'mods')) {
      const rows = database.all(`SELECT * FROM mods WHERE lower(COALESCE(source, '')) = 'thunderstore'`)
      rewriteScalarColumns(
        database,
        'mods',
        rows,
        ['archive_path', 'staging_path', 'target_path', 'source_root_path'],
        normalizedMappings,
        summary
      )
      rewriteJsonColumns(
        database,
        'mods',
        rows,
        ['install_paths_json', 'files_json', 'metadata_json'],
        normalizedMappings,
        summary
      )
    }

    if (tableExists(database, 'source_install_artifact')) {
      const rows = database.all(
        `SELECT * FROM source_install_artifact WHERE lower(COALESCE(source, '')) = 'thunderstore'`
      )
      rewriteScalarColumns(
        database,
        'source_install_artifact',
        rows,
        ['file_path'],
        normalizedMappings,
        summary
      )
    }

    if (tableExists(database, 'source_install_job')) {
      const rows = database.all(
        `SELECT * FROM source_install_job WHERE lower(COALESCE(source, '')) = 'thunderstore'`
      )
      const jobColumns = getTableColumns(database, 'source_install_job')
      rewriteJsonColumns(
        database,
        'source_install_job',
        rows,
        ['payload_json', 'precheck_json', 'failure_json', 'health_json'].filter((item) => jobColumns.has(item)),
        normalizedMappings,
        summary
      )

      if (tableExists(database, 'source_install_job_item')) {
        const itemColumns = getTableColumns(database, 'source_install_job_item')
        const itemRows = database.all(
          `SELECT item.* FROM source_install_job_item item
           INNER JOIN source_install_job job ON job.job_id = item.job_id
           WHERE lower(COALESCE(job.source, '')) = 'thunderstore'`
        )
        rewriteJsonColumns(
          database,
          'source_install_job_item',
          itemRows,
          [
            'metadata_json',
            'failure_json',
            'health_json',
            'conflict_json',
            'install_plan_json',
            'change_set_json'
          ].filter((item) => itemColumns.has(item)),
          normalizedMappings,
          summary
        )
      }
    }

    if (tableExists(database, 'download_records')) {
      const columns = getTableColumns(database, 'download_records')
      const where = columns.has('source_platform')
        ? `lower(COALESCE(source_platform, '')) = 'thunderstore'`
        : `lower(COALESCE(task_name, '')) LIKE 'thunderstore%'
           OR lower(COALESCE(download_url, '')) LIKE '%thunderstore.io/%'`
      const rows = database.all(`SELECT * FROM download_records WHERE ${where}`)
      rewriteScalarColumns(database, 'download_records', rows, ['file_path'], normalizedMappings, summary)
    }

    if (tableExists(database, 'files')) {
      const rows = database.all(`SELECT * FROM files`)
      rewriteScalarColumns(database, 'files', rows, ['file_path'], normalizedMappings, summary)
    }

    rewriteManagedAssets(database, normalizedMappings, summary)
  })

  return summary
}
