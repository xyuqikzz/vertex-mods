/**
 * 已安装模组只读工具：
 * - vertex.mod.installed_list  → listInstalledModsTool
 * - vertex.mod.installed_detail → getInstalledModDetailTool
 */

const MAX_MANIFEST_PREVIEW = 30

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseJsonSafe(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ''))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

async function getDefaultDbInstance() {
  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

function normalizeInstalledModRow(row = {}) {
  return {
    installedModId: toSafeNumber(row.id),
    gameId: toSafeNumber(row.game_id),
    source: toSafeText(row.source),
    modId: toSafeText(row.mod_id),
    optionId: toSafeText(row.option_id),
    sourceModKey: toSafeText(row.source_mod_key),
    name: toSafeText(row.name),
    optionName: toSafeText(row.option_name),
    version: toSafeText(row.version) || toSafeText(row.mod_version),
    endpointType: toSafeNumber(row.endpoint_type),
    isActive: toSafeNumber(row.is_active) === 1,
    priorityOrder: toSafeNumber(row.priority_order),
    deployDomain: toSafeText(row.deploy_domain),
    installModel: toSafeText(row.install_model),
    profileName: toSafeText(row.profile_name),
    installedAt: toSafeText(row.installed_at) || toSafeText(row.created_at)
  }
}

export async function listInstalledModsTool(args = {}, deps = {}) {
  const gameId = toSafeNumber(args.gameId, 0)
  if (gameId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_game_id',
      message: 'gameId 无效，请先调用 vertex.game.list 获取本地游戏列表。'
    }
  }

  const limit = Math.max(1, Math.min(100, toSafeNumber(args.limit, 50)))
  const conditions = ['game_id = ?']
  const params = [gameId]

  if (args.endpointType === 0 || args.endpointType === 1) {
    conditions.push('endpoint_type = ?')
    params.push(toSafeNumber(args.endpointType))
  }
  const deployDomain = toSafeText(args.deployDomain)
  if (deployDomain) {
    conditions.push('deploy_domain = ?')
    params.push(deployDomain)
  }
  const source = toSafeText(args.source).toLowerCase()
  if (source) {
    conditions.push('lower(source) = ?')
    params.push(source)
  }
  const keyword = toSafeText(args.keyword)
  if (keyword) {
    conditions.push('(name LIKE ? OR option_name LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  const db = deps.db || (await getDefaultDbInstance())
  const totalRow = db.get(
    `SELECT COUNT(*) AS total FROM mods WHERE ${conditions.join(' AND ')}`,
    params
  )
  const rows = db.all(
    `SELECT * FROM mods
     WHERE ${conditions.join(' AND ')}
     ORDER BY priority_order ASC, id ASC
     LIMIT ?`,
    [...params, limit]
  )

  return {
    success: true,
    total: toSafeNumber(totalRow?.total),
    mods: rows.map((row) => normalizeInstalledModRow(row))
  }
}

function listManifestPreview(installedModId = 0, db) {
  if (!db.tableExists('mod_file_manifest')) {
    return { totalFiles: 0, files: [] }
  }
  try {
    const totalRow = db.get(
      `SELECT COUNT(*) AS total FROM mod_file_manifest WHERE mod_id = ?`,
      [installedModId]
    )
    const rows = db.all(
      `SELECT target_relative_path, deploy_method
       FROM mod_file_manifest
       WHERE mod_id = ?
       ORDER BY target_relative_path ASC
       LIMIT ?`,
      [installedModId, MAX_MANIFEST_PREVIEW]
    )
    return {
      totalFiles: toSafeNumber(totalRow?.total),
      files: rows.map((row) => ({
        targetRelativePath: toSafeText(row.target_relative_path),
        deployMethod: toSafeText(row.deploy_method)
      }))
    }
  } catch {
    return { totalFiles: 0, files: [] }
  }
}

export async function getInstalledModDetailTool(args = {}, deps = {}) {
  const installedModId = toSafeNumber(args.installedModId, 0)
  if (installedModId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_installed_mod_id',
      message: 'installedModId 无效，请先调用 vertex.mod.installed_list。'
    }
  }

  const db = deps.db || (await getDefaultDbInstance())
  const row = db.get(`SELECT * FROM mods WHERE id = ? LIMIT 1`, [installedModId])
  if (!row) {
    return {
      success: false,
      errorCode: 'installed_mod_not_found',
      message: `本地未找到已安装模组记录（installedModId=${installedModId}）。`
    }
  }

  const manifest = listManifestPreview(installedModId, db)

  return {
    success: true,
    mod: {
      ...normalizeInstalledModRow(row),
      description: toSafeText(row.description).slice(0, 500),
      dependencies: parseJsonSafe(row.dependencies_json, []),
      fileSize: toSafeNumber(row.file_size),
      targetPathConfigured: Boolean(toSafeText(row.target_path)),
      stagingPathConfigured: Boolean(toSafeText(row.staging_path))
    },
    manifest
  }
}
