/**
 * 游戏上下文只读工具：
 * - vertex.game.list  → getInstalledGamesTool
 * - vertex.game.context → getGameContextTool
 */

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

async function getDefaultDbInstance() {
  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

async function getDefaultGameList() {
  const module = await import('../../../../db/games/game.js')
  return module.getGameList
}

function normalizeGameRow(row = {}) {
  return {
    gameId: toSafeNumber(row.id),
    ...(toSafeNumber(row.game_id) > 0 ? { backendGameId: toSafeNumber(row.game_id) } : {}),
    source: toSafeText(row.source),
    sourceId: toSafeText(row.source_id),
    sourceSlug: toSafeText(row.source_slug),
    appId: toSafeText(row.app_id),
    name: toSafeText(row.name),
    englishName: toSafeText(row.english_name),
    installRootConfigured: Boolean(toSafeText(row.client_root_path)),
    serverInstalled: toSafeNumber(row.is_server_installed) === 1,
    clientModCount: toSafeNumber(row.clientModCount),
    serverModCount: toSafeNumber(row.serverModCount),
    updatedAt: toSafeText(row.updated_at)
  }
}

export async function getInstalledGamesTool(args = {}, deps = {}) {
  const keyword = toSafeText(args.keyword).toLowerCase()
  const limit = Math.max(1, Math.min(50, toSafeNumber(args.limit, 20)))
  const readGameList =
    typeof deps.getGameList === 'function' ? deps.getGameList : await getDefaultGameList()

  const rows = (await readGameList()) || []
  const games = rows
    .map((row) => normalizeGameRow(row))
    .filter((game) => {
      if (!keyword) return true
      return (
        game.name.toLowerCase().includes(keyword) ||
        game.englishName.toLowerCase().includes(keyword) ||
        game.sourceSlug.toLowerCase().includes(keyword)
      )
    })
    .slice(0, limit)

  return {
    success: true,
    total: rows.length,
    games
  }
}

function listDeployDomains(gameId = 0, db) {
  if (!db.tableExists('mod_deploy_domains')) return []
  try {
    return db
      .all(
        `SELECT source, endpoint_type, deploy_domain, target_root
         FROM mod_deploy_domains
         WHERE game_id = ?
         ORDER BY endpoint_type ASC, deploy_domain ASC`,
        [gameId]
      )
      .map((row) => ({
        source: toSafeText(row.source),
        endpointType: toSafeNumber(row.endpoint_type),
        deployDomain: toSafeText(row.deploy_domain),
        targetRootConfigured: Boolean(toSafeText(row.target_root))
      }))
  } catch {
    return []
  }
}

function summarizeModsByGame(gameId = 0, db) {
  try {
    const rows = db.all(
      `SELECT source, endpoint_type,
              COUNT(*) AS total,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count
       FROM mods
       WHERE game_id = ?
       GROUP BY source, endpoint_type
       ORDER BY total DESC`,
      [gameId]
    )
    return rows.map((row) => ({
      source: toSafeText(row.source),
      endpointType: toSafeNumber(row.endpoint_type),
      total: toSafeNumber(row.total),
      activeCount: toSafeNumber(row.active_count),
      disabledCount: toSafeNumber(row.total) - toSafeNumber(row.active_count)
    }))
  } catch {
    return []
  }
}

export async function getGameContextTool(args = {}, deps = {}, ctx = {}) {
  const gameId = toSafeNumber(args.gameId, 0)
  if (gameId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_game_id',
      message: 'gameId 无效，请先调用 vertex.game.list 获取本地游戏列表。'
    }
  }

  const db = deps.db || (await getDefaultDbInstance())
  let row = db.get(`SELECT * FROM games WHERE id = ? LIMIT 1`, [gameId])
  const pageGame = ctx.pageContext?.game || {}
  const source = toSafeText(pageGame.businessSource || pageGame.source)
  const sourceId = toSafeText(pageGame.sourceGameId)
  const sourceSlug = toSafeText(pageGame.sourceSlug || pageGame.domainName)
  const legacyPageId = toSafeNumber(pageGame.backendGameId || pageGame.gameId)
  // 兼容旧会话把页面后端编号当成本地主键的情况。只能按当前页面的来源身份
  // 唯一解析，不能全库用 game_id 猜，也不能把别的游戏恰好相同的 id 当成命中。
  if (gameId === legacyPageId && source && (sourceId || sourceSlug)) {
    const conditions = ['source = ?']
    const params = [source]
    if (sourceId) {
      conditions.push('source_id = ?')
      params.push(sourceId)
    }
    if (sourceSlug) {
      conditions.push('source_slug = ?')
      params.push(sourceSlug)
    }
    const matches = db.all(`SELECT * FROM games WHERE ${conditions.join(' AND ')} LIMIT 2`, params)
    if (matches.length !== 1 || ![Number(matches[0].id), Number(matches[0].game_id)].includes(gameId)) {
      return {
        success: false,
        errorCode: matches.length > 1 ? 'ambiguous_game_identity' : 'game_identity_mismatch',
        message: '页面游戏编号与本地记录不一致，请调用 vertex.game.list 获取该游戏的本地 gameId。'
      }
    }
    row = matches[0]
  }
  if (!row) {
    return {
      success: false,
      errorCode: 'game_not_found',
      message: `本地未找到游戏记录（gameId=${gameId}）。请调用 vertex.game.list 获取本地主键，不要使用来源或后端游戏编号。`
    }
  }

  return {
    success: true,
    game: normalizeGameRow(row),
    deployDomains: listDeployDomains(row.id, db),
    modSummary: summarizeModsByGame(row.id, db)
  }
}
