import {
  assertSourceCapability,
  getSourcePlatformDefinition,
  normalizeSourcePlatform
} from '../../../../../shared/sources/source-platform-registry.js'

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function redactModelText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeInstalledModId(args = {}) {
  return toSafeNumber(
    args.installedModId || args.installed_mod_id || args.modRecordId || args.mod_record_id || args.id
  )
}

function normalizeInstalledModRow(row = {}) {
  const metadata = parseJsonObject(row.metadata_json || row.metadata)
  return {
    installedModId: toSafeNumber(row.id),
    gameId: toSafeNumber(row.game_id),
    source: normalizeSourcePlatform(row.source),
    modId: toSafeText(row.mod_id),
    optionId: toSafeText(row.option_id),
    sourceModKey: toSafeText(row.source_mod_key),
    name: toSafeText(row.name),
    optionName: toSafeText(row.option_name),
    version: toSafeText(row.version) || toSafeText(row.mod_version),
    packageOwner: toSafeText(row.package_owner),
    packageName: toSafeText(row.package_name),
    endpointType: toSafeNumber(row.endpoint_type),
    isActive: toSafeNumber(row.is_active) === 1,
    priorityOrder: toSafeNumber(row.priority_order),
    deployDomain: toSafeText(row.deploy_domain),
    installModel: toSafeText(row.install_model),
    profileName: toSafeText(row.profile_name),
    metadata
  }
}

function normalizeGameRow(row = {}) {
  const metadata = parseJsonObject(row.metadata_json || row.metadata)
  return {
    id: toSafeNumber(row.id),
    source: normalizeSourcePlatform(row.source),
    sourceId: toSafeText(row.source_id),
    sourceSlug: toSafeText(row.source_slug),
    gameId: toSafeText(row.game_id),
    appId: toSafeText(row.app_id),
    name: toSafeText(row.name),
    metadata
  }
}

function summarizeInstalledMod(mod = {}) {
  return {
    installedModId: toSafeNumber(mod.installedModId),
    name: redactModelText(mod.name),
    source: toSafeText(mod.source),
    modId: redactModelText(mod.modId),
    sourceModKey: redactModelText(mod.sourceModKey),
    version: redactModelText(mod.version),
    endpointType: toSafeNumber(mod.endpointType),
    isActive: mod.isActive === true,
    priorityOrder: toSafeNumber(mod.priorityOrder),
    deployDomain: redactModelText(mod.deployDomain),
    profileName: redactModelText(mod.profileName)
  }
}

function summarizeRemoteRecord(record = {}) {
  return {
    source: toSafeText(record.source),
    sourceLabel: redactModelText(record.sourceLabel),
    modId: redactModelText(record.modId || record.id),
    id: redactModelText(record.id || record.modId),
    name: redactModelText(record.name),
    version: redactModelText(resolveLatestVersion(record)),
    sourceGameId: redactModelText(record.sourceGameId),
    sourceSlug: redactModelText(record.sourceSlug),
    packageOwner: redactModelText(record.packageOwner),
    packageName: redactModelText(record.packageName),
    fullName: redactModelText(record.fullName || record.packageFullName),
    updatedAt: redactModelText(record.updatedAt || record.updated_at)
  }
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveLatestVersion(record = {}) {
  const latestVersions =
    record?.latestVersions && typeof record.latestVersions === 'object'
      ? record.latestVersions
      : record?.latest_versions && typeof record.latest_versions === 'object'
        ? record.latest_versions
        : {}
  return pickFirstText(
    record?.latestVersion?.version,
    record?.latestVersion?.version_number,
    record?.latest_version?.version,
    record?.latest_version?.version_number,
    latestVersions?.release?.version,
    latestVersions?.beta?.version,
    latestVersions?.alpha?.version,
    record?.version
  )
}

function normalizeVersionText(value = '') {
  return toSafeText(value).replace(/^v/i, '').toLowerCase()
}

function compareVersionText(currentVersion = '', latestVersion = '') {
  const current = normalizeVersionText(currentVersion)
  const latest = normalizeVersionText(latestVersion)
  if (!current || !latest) return null
  if (current === latest) return 0
  const currentParts = current.split(/[^0-9a-z]+/i).filter(Boolean)
  const latestParts = latest.split(/[^0-9a-z]+/i).filter(Boolean)
  const length = Math.max(currentParts.length, latestParts.length)
  for (let index = 0; index < length; index += 1) {
    const left = currentParts[index] || '0'
    const right = latestParts[index] || '0'
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) return rightNumber > leftNumber ? 1 : -1
      continue
    }
    const compared = right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' })
    if (compared !== 0) return compared > 0 ? 1 : -1
  }
  return latest.length === current.length ? 0 : latest.length > current.length ? 1 : -1
}

function resolveSourceGameIdentity(mod = {}, game = {}, args = {}) {
  const metadata = mod.metadata || {}
  const gameMetadata = game.metadata || {}
  return {
    sourceGameId: pickFirstText(
      args.sourceGameId,
      args.source_game_id,
      args.gameId,
      args.game_id,
      game.sourceId,
      game.gameId,
      metadata.sourceGameId,
      metadata.source_game_id,
      gameMetadata.sourceGameId,
      gameMetadata.source_game_id
    ),
    sourceSlug: pickFirstText(
      args.sourceSlug,
      args.source_slug,
      args.domainName,
      args.community,
      game.sourceSlug,
      metadata.sourceSlug,
      metadata.source_slug,
      gameMetadata.sourceSlug,
      gameMetadata.source_slug
    )
  }
}

function buildDetailPayload(source = '', mod = {}, game = {}, args = {}) {
  const identity = resolveSourceGameIdentity(mod, game, args)
  const basePayload = {
    source,
    context: {
      game: {
        source: game.source || source,
        sourceGameId: identity.sourceGameId,
        sourceSlug: identity.sourceSlug,
        id: game.id,
        name: game.name
      }
    }
  }

  if (source === 'nexus') {
    return {
      ...basePayload,
      domainName: pickFirstText(args.domainName, identity.sourceSlug, identity.sourceGameId),
      modId: pickFirstText(args.modId, mod.modId, mod.sourceModKey),
      fileId: pickFirstText(args.fileId, mod.optionId)
    }
  }
  if (source === 'modio') {
    return {
      ...basePayload,
      gameId: pickFirstText(args.gameId, identity.sourceGameId),
      modId: pickFirstText(args.modId, mod.modId, mod.sourceModKey)
    }
  }
  if (source === 'ficsit') {
    return {
      ...basePayload,
      modReference: pickFirstText(args.modReference, mod.sourceModKey, mod.modId),
      modId: pickFirstText(args.modId, mod.modId, mod.sourceModKey)
    }
  }
  if (source === 'thunderstore') {
    const fullName =
      pickFirstText(args.fullName, args.packageFullName, mod.sourceModKey, mod.modId) ||
      [mod.packageOwner, mod.packageName].filter(Boolean).join('-')
    return {
      ...basePayload,
      community: pickFirstText(args.community, identity.sourceSlug, identity.sourceGameId),
      fullName,
      packageFullName: fullName,
      modId: fullName
    }
  }
  if (source === 'vamhub') {
    return {
      ...basePayload,
      sourceGameId: identity.sourceGameId,
      sourceSlug: identity.sourceSlug,
      modId: pickFirstText(args.modId, mod.modId, mod.sourceModKey)
    }
  }
  return {
    ...basePayload,
    modId: pickFirstText(args.modId, mod.modId, mod.sourceModKey),
    id: pickFirstText(args.id, mod.modId, mod.sourceModKey)
  }
}

function validateDetailPayload(source = '', payload = {}) {
  if (source === 'nexus' && (!payload.domainName || !payload.modId)) {
    return 'Nexus 更新检查缺少 domainName 或 modId。'
  }
  if (source === 'modio' && (!payload.gameId || !payload.modId)) {
    return 'Mod.io 更新检查缺少 gameId 或 modId。'
  }
  if (source === 'ficsit' && !pickFirstText(payload.modReference, payload.modId)) {
    return 'Ficsit 更新检查缺少 modReference。'
  }
  if (source === 'thunderstore' && (!payload.community || !payload.fullName)) {
    return 'Thunderstore 更新检查缺少 community 或 fullName。'
  }
  if (source === 'vamhub' && (!payload.sourceGameId || !payload.modId)) {
    return 'VAM-Hub 更新检查缺少 sourceGameId 或 modId。'
  }
  if (!pickFirstText(payload.modId, payload.id, payload.modReference, payload.fullName)) {
    return '更新检查缺少来源模组标识。'
  }
  return ''
}

async function getDefaultDbInstance() {
  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

async function getDefaultModSourceDetail() {
  const module = await import('../../../mod-source/runtime.js')
  return module.getModSourceDetail
}

async function getDeps(overrides = {}) {
  const deps = { ...overrides }
  if (!deps.db) deps.db = await getDefaultDbInstance()
  if (typeof deps.getDetail !== 'function') deps.getDetail = await getDefaultModSourceDetail()
  return deps
}

function getInstalledModById(db, installedModId = 0) {
  if (!db || installedModId <= 0) return null
  return db.get(`SELECT * FROM mods WHERE id = ? LIMIT 1`, [installedModId])
}

function getGameById(db, gameId = 0) {
  if (!db || gameId <= 0) return null
  return db.get(`SELECT * FROM games WHERE id = ? LIMIT 1`, [gameId])
}

export async function checkModUpdateTool(args = {}, ctx = {}, depsOverride = {}) {
  void ctx
  const installedModId = normalizeInstalledModId(args)
  if (installedModId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_installed_mod_id',
      message: 'installedModId 无效，请先调用 vertex.mod.installed_list。'
    }
  }

  const deps = await getDeps(depsOverride)
  const row = getInstalledModById(deps.db, installedModId)
  if (!row) {
    return {
      success: false,
      errorCode: 'installed_mod_not_found',
      installedModId,
      message: `本地未找到已安装模组记录（installedModId=${installedModId}）。`
    }
  }

  const mod = normalizeInstalledModRow(row)
  const source = normalizeSourcePlatform(args.source || mod.source)
  const definition = getSourcePlatformDefinition(source)
  const sourceLabel = definition?.label || source
  const capability = assertSourceCapability(source, 'ai.detail')
  if (!capability.ok) {
    return {
      success: false,
      errorCode: capability.errorCode,
      source,
      sourceLabel,
      installedMod: summarizeInstalledMod(mod),
      message: capability.message
    }
  }

  const game = normalizeGameRow(getGameById(deps.db, mod.gameId) || {})
  const detailPayload = buildDetailPayload(source, mod, game, args)
  const missingIdentityMessage = validateDetailPayload(source, detailPayload)
  if (missingIdentityMessage) {
    return {
      success: false,
      errorCode: 'missing_source_identity',
      source,
      sourceLabel,
      installedMod: summarizeInstalledMod(mod),
      message: missingIdentityMessage
    }
  }

  const detailResult = await deps.getDetail(detailPayload)
  if (!detailResult?.success || !detailResult?.record) {
    return {
      success: false,
      errorCode: 'source_detail_unavailable',
      source,
      sourceLabel,
      installedMod: summarizeInstalledMod(mod),
      message: redactModelText(detailResult?.message, '来源详情查询失败，无法判断更新状态。')
    }
  }

  const currentVersion = toSafeText(mod.version)
  const latestVersion = resolveLatestVersion(detailResult.record)
  const compareResult = compareVersionText(currentVersion, latestVersion)
  const hasUpdate =
    compareResult === null
      ? Boolean(currentVersion && latestVersion && normalizeVersionText(currentVersion) !== normalizeVersionText(latestVersion))
      : compareResult > 0
  const status = !latestVersion ? 'unknown' : hasUpdate ? 'update_available' : 'up_to_date'
  const safeCurrentVersion = redactModelText(currentVersion)
  const safeLatestVersion = redactModelText(latestVersion)

  return {
    success: true,
    source,
    sourceLabel,
    installedMod: summarizeInstalledMod(mod),
    remoteRecord: summarizeRemoteRecord(detailResult.record),
    currentVersion: safeCurrentVersion,
    latestVersion: safeLatestVersion,
    compareResult,
    hasUpdate,
    updateAvailable: hasUpdate,
    status,
    executionSupported: false,
    lifecycleUpdateSupported: false,
    nextActions: hasUpdate
      ? [
          {
            type: 'create_install_plan',
            tool: 'vertex.install.inspect_plan',
            message: '检测到远端版本不同。如需更新，请先用来源详情生成新的安装预检计划，再由用户确认安装。'
          }
        ]
      : [
          {
            type: 'no_update_action',
            message: latestVersion ? '当前版本与远端版本一致，无需生成更新计划。' : '未能识别远端版本，请在来源页面复核。'
          }
        ],
    message: hasUpdate
      ? `检测到可用更新：${safeCurrentVersion || 'unknown'} -> ${safeLatestVersion || 'unknown'}。`
      : latestVersion
        ? `当前已是最新版本：${safeCurrentVersion || safeLatestVersion}。`
        : '已查询来源详情，但未能识别远端版本。'
  }
}
