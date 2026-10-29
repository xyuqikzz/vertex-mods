import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
/**
 * 离线安装包内置 profile payload 工具。
 */

export const CSM_SCHEMA_VERSION = 2
export const CSM_KIND = 'vertex.install-profile'
export const CSM_FORMAT_CROSS = 'cross-source'
export const CSM_FORMAT_SINGLE = 'single-source'

// 支持的来源平台
export const CSM_PLATFORMS = Object.freeze({
  THUNDERSTORE: 'thunderstore',
  NEXUS: 'nexus',
  MODIO: 'modio',
  FICSIT: 'ficsit',
  VAMHUB: 'vamhub',
  GITHUB_RELEASE: 'github_release',
  DEFAULT_DEPENDENCY: 'default_dependency'
})

// 条目角色
export const CSM_ITEM_ROLES = Object.freeze({
  MOD: 'mod',
  DEFAULT_DEPENDENCY: 'default_dependency',
  EXTERNAL_DEPENDENCY: 'external_dependency',
  LOCAL_FILE: 'local_file',
  OPTIONAL: 'optional'
})

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizePlatform(value = '') {
  return normalizeText(value).toLowerCase()
}

function normalizeNumberText(value = '') {
  const text = normalizeText(value)
  if (!text) return ''
  const numberValue = Number(text)
  return Number.isFinite(numberValue) && numberValue > 0 ? String(numberValue) : text
}

function getObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

function normalizeGameContext(game = {}) {
  const sourceType = normalizePlatform(game.sourceType || game.sourcePlatform || game.platform)
  const sourceGameId = normalizeText(game.sourceGameId || game.source_game_id)
  const sourceGameSlug = normalizeText(game.sourceGameSlug || game.source_game_slug)
  const sourceGameName = normalizeText(
    game.sourceGameName || game.source_game_name || game.displayName
  )
  const gameKey = normalizeText(
    game.gameKey ||
      game.game_key ||
      (sourceType && (sourceGameId || sourceGameSlug)
        ? `${sourceType}:${sourceGameId || sourceGameSlug}`
        : '')
  )
  return {
    gameKey,
    sourceType,
    sourceGameId,
    sourceGameSlug,
    sourceGameName
  }
}

function buildWarning(item = {}, reason = '', index = 0) {
  return {
    name: normalizeText(
      item?.name || item?.sourceModKey || item?.sourceModId || `条目 ${index + 1}`
    ),
    reason: normalizeText(reason)
  }
}

// 规范化 JSON：按 key 排序、去除 undefined，用于完整性校验。
export function canonicalJsonStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {}
      for (const k of Object.keys(value).sort()) {
        if (value[k] !== undefined) {
          sorted[k] = value[k]
        }
      }
      return sorted
    }
    return value
  })
}

export async function computeSha256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signCsmPayload(payload) {
  const rest = { ...(payload || {}) }
  delete rest.signature
  delete rest.checksum
  const canonical = canonicalJsonStringify(rest)
  const hash = await computeSha256(canonical)
  return {
    algo: 'sha256',
    hash
  }
}

export function normalizeCsmItem(raw = {}, fallbackIndex = 0, context = {}) {
  const item = getObject(raw)
  const metadata = getObject(item.metadata)
  const sourcePlatform = normalizePlatform(
    item.sourcePlatform || item.source_platform || context.sourcePlatform
  )
  const sourceGameId = normalizeText(
    item.sourceGameId ||
      item.source_game_id ||
      metadata.sourceGameId ||
      metadata.source_game_id ||
      context.sourceGameId
  )
  const sourceGameSlug = normalizeText(
    item.sourceGameSlug ||
      item.source_game_slug ||
      metadata.sourceGameSlug ||
      metadata.source_game_slug ||
      metadata.sourceGameDomain ||
      metadata.domainName ||
      context.sourceGameSlug
  )
  return {
    sortIndex: Number.isFinite(Number(item.sortIndex ?? item.sort_index))
      ? Number(item.sortIndex ?? item.sort_index)
      : fallbackIndex,
    sourcePlatform,
    sourceGameId,
    sourceGameSlug,
    sourceModId: normalizeNumberText(
      item.sourceModId || item.source_mod_id || metadata.sourceModId || metadata.modId
    ),
    sourceFileId: normalizeNumberText(
      item.sourceFileId || item.source_file_id || metadata.sourceFileId || metadata.fileId
    ),
    sourceModKey: normalizeText(item.sourceModKey || item.source_mod_key),
    name: normalizeText(item.name),
    version: normalizeText(item.version),
    downloadUrl: normalizeText(item.downloadUrl || item.download_url),
    role: normalizeText(item.role || metadata.role || CSM_ITEM_ROLES.MOD),
    enabled: item.enabled !== false,
    metadata,
    installRule: item.installRule && typeof item.installRule === 'object' ? item.installRule : null
  }
}

function validateAutoImportableItem(item = {}) {
  const role = normalizeText(item.role || CSM_ITEM_ROLES.MOD)
  if (role === CSM_ITEM_ROLES.DEFAULT_DEPENDENCY) {
    return { ok: false, reason: uiText('ui.defaultDependenciesMustBeRegeneratedFromInstallationRules') }
  }
  if (role === CSM_ITEM_ROLES.EXTERNAL_DEPENDENCY) {
    return { ok: false, reason: uiText('ui.externalDependenciesRequireManualHandling') }
  }
  if (role === CSM_ITEM_ROLES.LOCAL_FILE) {
    return { ok: false, reason: uiText('ui.localFilesCannotBeRestoredDirectlyOnAnotherDevice') }
  }

  const platform = normalizePlatform(item.sourcePlatform)
  if (!platform) {
    return { ok: false, reason: uiText('ui.sourcePlatformIsMissing') }
  }

  if (platform === CSM_PLATFORMS.NEXUS) {
    if (!item.sourceGameSlug || !item.sourceModId || !item.sourceFileId) {
      return { ok: false, reason: uiText('ui.nexusGameDomainModIDOrFileIDIsMissing') }
    }
    return { ok: true }
  }

  if (platform === CSM_PLATFORMS.MODIO) {
    if (!item.sourceGameId || !item.sourceModId || !item.sourceFileId) {
      return { ok: false, reason: uiText('ui.modIoGameIDModIDOrFileIDIs') }
    }
    return { ok: true }
  }

  if (platform === CSM_PLATFORMS.FICSIT) {
    if (!(item.sourceModKey || item.sourceModId) || !(item.sourceFileId || item.version)) {
      return { ok: false, reason: uiText('ui.ficsitModReferenceOrVersionIdentifierIsMissing') }
    }
    return { ok: true }
  }

  if (platform === CSM_PLATFORMS.THUNDERSTORE) {
    if (!(item.sourceModKey || item.sourceModId) || !(item.sourceFileId || item.version)) {
      return { ok: false, reason: uiText('ui.thunderstorePackageNameOrVersionIsMissing') }
    }
    return { ok: true }
  }

  if (platform === CSM_PLATFORMS.VAMHUB) {
    const metadata = getObject(item.metadata)
    const hasStableIdentity =
      item.sourceModId ||
      item.sourceModKey ||
      normalizeText(metadata.resourceId || metadata.packageName)
    const hasVersionIdentity =
      item.sourceFileId ||
      item.version ||
      normalizeText(metadata.fileName || metadata.version)
    if (!hasStableIdentity || !hasVersionIdentity) {
      return { ok: false, reason: uiText('ui.vAMHubStableResourceOrVersionIdentifierIsMissing') }
    }
    return { ok: true }
  }

  if (!item.sourceModId && !item.sourceModKey) {
    return { ok: false, reason: uiText('ui.sourceModIdentifierIsMissing') }
  }
  return { ok: true }
}

function splitExportItems(rawItems = [], context = {}) {
  const autoImportable = []
  const manualOnly = []
  const warnings = []

  rawItems.forEach((rawItem, index) => {
    const item = normalizeCsmItem(rawItem, index, context)
    const validation = validateAutoImportableItem(item)
    if (validation.ok) {
      autoImportable.push(item)
      return
    }
    if (
      item.role === CSM_ITEM_ROLES.DEFAULT_DEPENDENCY ||
      item.role === CSM_ITEM_ROLES.EXTERNAL_DEPENDENCY ||
      item.role === CSM_ITEM_ROLES.LOCAL_FILE
    ) {
      manualOnly.push({
        ...item,
        metadata: {
          ...item.metadata,
          manualReason: validation.reason
        }
      })
      return
    }
    warnings.push(buildWarning(item, validation.reason, index))
  })

  return { autoImportable, manualOnly, warnings }
}

export function buildCsmPayload(options = {}) {
  const primaryGame = normalizeGameContext(options.primaryGame || {})
  const sourcePlatform = normalizePlatform(
    options.profile?.sourcePlatform || primaryGame.sourceType || options.sourcePlatform
  )
  const context = {
    sourcePlatform,
    sourceGameId: primaryGame.sourceGameId,
    sourceGameSlug: primaryGame.sourceGameSlug
  }
  const { autoImportable, manualOnly, warnings } = splitExportItems(
    Array.isArray(options.items) ? options.items : [],
    context
  )
  const extraManualItems = (Array.isArray(options.manualItems) ? options.manualItems : []).map(
    (item, index) => normalizeCsmItem(item, index, context)
  )
  const items = autoImportable
  const manualItems = [...manualOnly, ...extraManualItems]
  const platforms = [
    ...new Set(
      [...items, ...manualItems]
        .map((item) => normalizePlatform(item.sourcePlatform))
        .filter(Boolean)
    )
  ]
  const format = platforms.length > 1 ? CSM_FORMAT_CROSS : CSM_FORMAT_SINGLE
  const name = normalizeText(options.name || options.profile?.name) || '未命名配置方案'
  const createdAt = options.createdAt || new Date().toISOString()
  const profile = {
    name,
    sourcePlatform: sourcePlatform || platforms[0] || '',
    exportedAt: createdAt,
    clientVersion: normalizeText(options.profile?.clientVersion || options.clientVersion)
  }
  const game = {
    gameKey: primaryGame.gameKey,
    sourceGameId: primaryGame.sourceGameId,
    sourceGameSlug: primaryGame.sourceGameSlug,
    displayName: primaryGame.sourceGameName
  }

  return {
    schemaVersion: CSM_SCHEMA_VERSION,
    kind: CSM_KIND,
    format,
    id: options.id || generateId(),
    shareCode: normalizeText(options.shareCode),
    name,
    description: normalizeText(options.description),
    cover: normalizeText(options.cover),
    version: normalizeText(options.version || '1.0.0'),
    createdAt,
    profile,
    game,
    rules: getObject(options.rules, {}),
    primaryGame,
    items,
    manualItems,
    warnings: [...(Array.isArray(options.warnings) ? options.warnings : []), ...warnings],
    author: {
      id: options.author?.id || null,
      name: normalizeText(options.author?.name),
      avatar: normalizeText(options.author?.avatar)
    },
    compat: {
      minClientVersion: normalizeText(options.compat?.minClientVersion),
      requiredAdapters: platforms
    },
    checksum: null
  }
}
