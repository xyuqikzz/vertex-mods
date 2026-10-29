import crypto from 'crypto'

export const THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION = '0.2.3'
export const THUNDERSTORE_ECOSYSTEM_BASE_SHA256 =
  '2FBC2A9A646C86A1BFA7683A044A0E4E6052900C0200D971386890F80E9A899B'
export const THUNDERSTORE_ECOSYSTEM_MERGE_POLICY = 'upstream-wins-v1'

const KNOWN_SECTIONS = Object.freeze([
  'games',
  'communities',
  'packageInstallers',
  'modloaderPackages'
])

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    )
  }
  return value
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

export function hashEcosystemJson(value) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value), 'utf8')
    .digest('hex')
    .toUpperCase()
}

export function createEmptyEcosystemOverlay() {
  return {
    games: {},
    communities: {},
    packageInstallers: {},
    modloaderPackages: []
  }
}

export function normalizeEcosystemData(data = {}) {
  const source = data && typeof data === 'object' ? data : {}
  return {
    schemaVersion: String(source.schemaVersion || ''),
    games:
      source.games && typeof source.games === 'object' && !Array.isArray(source.games)
        ? cloneJson(source.games, {})
        : {},
    communities:
      source.communities &&
      typeof source.communities === 'object' &&
      !Array.isArray(source.communities)
        ? cloneJson(source.communities, {})
        : {},
    packageInstallers:
      source.packageInstallers &&
      typeof source.packageInstallers === 'object' &&
      !Array.isArray(source.packageInstallers)
        ? cloneJson(source.packageInstallers, {})
        : {},
    modloaderPackages: Array.isArray(source.modloaderPackages)
      ? cloneJson(source.modloaderPackages, [])
      : []
  }
}

export function normalizeEcosystemOverlay(data = {}) {
  const source = data && typeof data === 'object' ? data : {}
  return {
    games:
      source.games && typeof source.games === 'object' && !Array.isArray(source.games)
        ? cloneJson(source.games, {})
        : {},
    communities:
      source.communities &&
      typeof source.communities === 'object' &&
      !Array.isArray(source.communities)
        ? cloneJson(source.communities, {})
        : {},
    packageInstallers:
      source.packageInstallers &&
      typeof source.packageInstallers === 'object' &&
      !Array.isArray(source.packageInstallers)
        ? cloneJson(source.packageInstallers, {})
        : {},
    modloaderPackages: Array.isArray(source.modloaderPackages)
      ? cloneJson(source.modloaderPackages, [])
      : []
  }
}

function isSafeRelativeRoute(route = '') {
  const normalized = String(route || '')
    .trim()
    .replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    return false
  }
  return normalized.split('/').every((segment) => segment && segment !== '..')
}

function collectInvalidInstallRulePaths(rules = [], parentPath = '', errors = []) {
  for (const [index, rule] of (Array.isArray(rules) ? rules : []).entries()) {
    const rulePath = `${parentPath}[${index}]`
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(`${rulePath} 必须是对象`)
      continue
    }
    if (!isSafeRelativeRoute(rule.route)) {
      errors.push(`${rulePath}.route 不是安全的相对路径`)
    }
    collectInvalidInstallRulePaths(rule.subRoutes, `${rulePath}.subRoutes`, errors)
  }
  return errors
}

function validateGameInstallRules(games = {}, errors = []) {
  for (const [gameKey, game] of Object.entries(games || {})) {
    if (!game || typeof game !== 'object' || Array.isArray(game)) {
      errors.push(`games.${gameKey} 必须是对象`)
      continue
    }
    const variants = Array.isArray(game.r2modman) ? game.r2modman : []
    for (const [variantIndex, variant] of variants.entries()) {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
        errors.push(`games.${gameKey}.r2modman[${variantIndex}] 必须是对象`)
        continue
      }
      const packageIndex = String(variant.packageIndex || '').trim()
      if (
        !/^https:\/\/(?:www\.)?thunderstore\.io\/c\/[^/]+\/api\/v1\/package-listing-index\/?$/i.test(
          packageIndex
        )
      ) {
        errors.push(`games.${gameKey}.r2modman[${variantIndex}].packageIndex 无效`)
      }
      collectInvalidInstallRulePaths(
        variant.installRules,
        `games.${gameKey}.r2modman[${variantIndex}].installRules`,
        errors
      )
    }
  }
  return errors
}

export function validateEcosystemData(data = {}) {
  const normalized = normalizeEcosystemData(data)
  const errors = []
  if (normalized.schemaVersion !== THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION) {
    errors.push(`不支持的 ecosystem schemaVersion：${normalized.schemaVersion || 'empty'}`)
  }
  if (!Object.keys(normalized.games).length) {
    errors.push('ecosystem.games 不能为空')
  }
  validateGameInstallRules(normalized.games, errors)
  return {
    valid: errors.length === 0,
    errors,
    data: normalized,
    hash: errors.length ? '' : hashEcosystemJson(normalized)
  }
}

export function validateBackendOverlayEnvelope(envelope = {}) {
  const source = envelope && typeof envelope === 'object' ? envelope : {}
  const errors = []
  if (String(source.targetSchemaVersion || '') !== THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION) {
    errors.push('后端 Overlay schemaVersion 不兼容')
  }
  if (String(source.baseSha256 || '').toUpperCase() !== THUNDERSTORE_ECOSYSTEM_BASE_SHA256) {
    errors.push('后端 Overlay 基线 SHA-256 不匹配')
  }
  if (String(source.mergePolicy || '') !== THUNDERSTORE_ECOSYSTEM_MERGE_POLICY) {
    errors.push('后端 Overlay 合并策略不兼容')
  }

  const unknownSections = Object.keys(source.overlay || {}).filter(
    (key) => !KNOWN_SECTIONS.includes(key)
  )
  if (unknownSections.length) {
    errors.push(`后端 Overlay 包含未知字段：${unknownSections.join(', ')}`)
  }

  const overlay = normalizeEcosystemOverlay(source.overlay)
  validateGameInstallRules(overlay.games, errors)
  const contentHash = hashEcosystemJson(overlay)
  if (source.contentHash && String(source.contentHash).toUpperCase() !== contentHash) {
    errors.push('后端 Overlay 内容哈希校验失败')
  }

  return {
    valid: errors.length === 0,
    errors,
    envelope: {
      revision: Number(source.revision || 0),
      targetSchemaVersion: THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION,
      baseSha256: THUNDERSTORE_ECOSYSTEM_BASE_SHA256,
      mergePolicy: THUNDERSTORE_ECOSYSTEM_MERGE_POLICY,
      contentHash,
      publishedAt: String(source.publishedAt || ''),
      overlay
    }
  }
}

function mergeKeyedSection(section, overlaySection = {}, upstreamSection = {}, conflicts = []) {
  const overlay = overlaySection && typeof overlaySection === 'object' ? overlaySection : {}
  const upstream = upstreamSection && typeof upstreamSection === 'object' ? upstreamSection : {}
  for (const key of Object.keys(overlay)) {
    if (Object.prototype.hasOwnProperty.call(upstream, key)) {
      conflicts.push({ section, key, winner: 'upstream', loser: 'vertex-backend' })
    }
  }
  return {
    ...cloneJson(overlay, {}),
    ...cloneJson(upstream, {})
  }
}

function mergeModloaderPackages(overlayPackages = [], upstreamPackages = [], conflicts = []) {
  const upstream = cloneJson(Array.isArray(upstreamPackages) ? upstreamPackages : [], [])
  const upstreamIds = new Set(
    upstream
      .map((item) =>
        String(item?.packageId || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  )
  const appendedIds = new Set()
  const additions = []

  for (const item of Array.isArray(overlayPackages) ? overlayPackages : []) {
    const packageId = String(item?.packageId || '').trim()
    const identity = packageId.toLowerCase()
    if (!identity) {
      continue
    }
    if (upstreamIds.has(identity)) {
      conflicts.push({
        section: 'modloaderPackages',
        key: packageId,
        winner: 'upstream',
        loser: 'vertex-backend'
      })
      continue
    }
    if (appendedIds.has(identity)) {
      continue
    }
    appendedIds.add(identity)
    additions.push(cloneJson(item, {}))
  }
  return [...upstream, ...additions]
}

export function mergeThunderstoreEcosystem(upstreamInput = {}, overlayInput = {}) {
  const upstreamValidation = validateEcosystemData(upstreamInput)
  if (!upstreamValidation.valid) {
    const error = new Error(`上游 ecosystem 无效：${upstreamValidation.errors.join('；')}`)
    error.code = 'ecosystem_upstream_invalid'
    throw error
  }

  const upstream = upstreamValidation.data
  const overlay = normalizeEcosystemOverlay(overlayInput)
  const conflicts = []
  const data = {
    schemaVersion: upstream.schemaVersion,
    games: mergeKeyedSection('games', overlay.games, upstream.games, conflicts),
    communities: mergeKeyedSection(
      'communities',
      overlay.communities,
      upstream.communities,
      conflicts
    ),
    packageInstallers: mergeKeyedSection(
      'packageInstallers',
      overlay.packageInstallers,
      upstream.packageInstallers,
      conflicts
    ),
    modloaderPackages: mergeModloaderPackages(
      overlay.modloaderPackages,
      upstream.modloaderPackages,
      conflicts
    )
  }

  return {
    data,
    hash: hashEcosystemJson(data),
    conflicts
  }
}
