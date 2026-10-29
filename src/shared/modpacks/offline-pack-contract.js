export const OFFLINE_PACK_SCHEMA_VERSION = 2
export const OFFLINE_PACK_PACKAGE_TYPE = 'vertex-offline-install-pack'
export const OFFLINE_PACK_FORMAT = 'vxpack-v2'
export const OFFLINE_PACK_FILE_EXTENSION = '.vxpack'
export const OFFLINE_PACK_PROFILE_NAME_MAX_LENGTH = 32
export const OFFLINE_PACK_CACHE_RETENTION_DAYS = 7
export const OFFLINE_PACK_MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024
export const OFFLINE_PACK_MAX_ENTRY_BYTES = 2 * 1024 * 1024 * 1024
export const OFFLINE_PACK_MAX_ENTRY_COUNT = 5000
// manifest 加固（审计 🟢#22）
export const OFFLINE_PACK_MAX_DEPENDENCIES_PER_ITEM = 256
export const OFFLINE_PACK_ALLOWED_COVER_SCHEMES = ['https:', 'data:']
export const OFFLINE_PACK_IMPORT_FILE_KIND = Object.freeze({
  OFFLINE_PACK: 'offline-pack',
  UNKNOWN: 'unknown'
})

export const OFFLINE_PACK_ERROR_CODE = Object.freeze({
  INVALID: 'offline_pack_invalid',
  UNSUPPORTED_VERSION: 'offline_pack_unsupported_version',
  CHECKSUM_FAILED: 'offline_pack_checksum_failed',
  GAME_UNMATCHED: 'offline_pack_game_unmatched',
  GAME_ROOT_MISSING: 'offline_pack_game_root_missing',
  GAME_NOT_REGISTERED: 'offline_pack_game_not_registered',
  GAME_AMBIGUOUS: 'offline_pack_game_ambiguous',
  PROFILE_CREATE_FAILED: 'offline_pack_profile_create_failed',
  ARTIFACT_MISSING: 'offline_pack_artifact_missing',
  RULE_MISSING: 'offline_pack_rule_missing',
  SIZE_LIMIT_EXCEEDED: 'offline_pack_size_limit_exceeded',
  TASK_CREATE_FAILED: 'offline_pack_task_create_failed'
})

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeOfflinePackProfileName(value = '', fallback = '离线安装包导入') {
  const text = toSafeText(value, fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, OFFLINE_PACK_PROFILE_NAME_MAX_LENGTH)
  return text || fallback
}

export function createUniqueOfflinePackProfileName(baseName = '', profileStats = []) {
  const normalizedStats = Array.isArray(profileStats) ? profileStats : []
  const usedProfiles = new Set(
    normalizedStats
      .filter((item) => Number(item?.totalCount || 0) > 0 || Number(item?.activeCount || 0) > 0)
      .map((item) => toSafeText(item?.profileName).toLowerCase())
      .filter(Boolean)
  )
  let base = sanitizeOfflinePackProfileName(baseName)
  if (base.toLowerCase() === 'default') {
    base = sanitizeOfflinePackProfileName('离线安装包导入')
  }
  if (!usedProfiles.has(base.toLowerCase())) {
    return base
  }
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`
    const candidateBase = base.slice(0, OFFLINE_PACK_PROFILE_NAME_MAX_LENGTH - suffix.length)
    const candidate = `${candidateBase}${suffix}`
    if (!usedProfiles.has(candidate.toLowerCase())) {
      return candidate
    }
  }
  return `${base.slice(0, OFFLINE_PACK_PROFILE_NAME_MAX_LENGTH - 8)}-${Date.now()
    .toString(36)
    .slice(-7)}`
}

export function resolveOfflinePackReusableProfileName(manifest = {}, fallback = 'default') {
  const safeManifest = isPlainObject(manifest) ? manifest : {}
  const profile = isPlainObject(safeManifest.profile) ? safeManifest.profile : {}
  return sanitizeOfflinePackProfileName(
    profile.name || profile.profileName || safeManifest.profileName,
    fallback
  )
}

export function isOfflinePackProfileOccupied(profileStats = [], profileName = '', options = {}) {
  const targetName = toSafeText(profileName, 'default').toLowerCase()
  if (!targetName) return false
  const targetSource = toSafeText(
    options.source ?? options.sourcePlatform ?? options.source_platform
  ).toLowerCase()
  return (Array.isArray(profileStats) ? profileStats : []).some((item) => {
    const itemName = toSafeText(item?.profileName ?? item?.profile_name, 'default').toLowerCase()
    if (itemName !== targetName) return false
    if (targetSource) {
      const itemSource = toSafeText(item?.source ?? item?.sourcePlatform ?? item?.source_platform).toLowerCase()
      if (itemSource !== targetSource) return false
    }
    return (
      toSafeNumber(item?.totalCount ?? item?.count, 0) > 0 || toSafeNumber(item?.activeCount, 0) > 0
    )
  })
}

export function normalizeOfflinePackCacheRetentionDays(
  value,
  fallback = OFFLINE_PACK_CACHE_RETENTION_DAYS
) {
  const days = Number(value)
  return Number.isFinite(days) && days >= 0 ? days : fallback
}

export function shouldCleanupOfflinePackCacheEntry(payload = {}) {
  const retentionDays = normalizeOfflinePackCacheRetentionDays(payload.retentionDays)
  const nowMs = Number.isFinite(Number(payload.nowMs)) ? Number(payload.nowMs) : Date.now()
  const mtimeMs = Number(payload.mtimeMs)
  if (!Number.isFinite(mtimeMs)) return false
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000
  return Math.max(0, nowMs - mtimeMs) > maxAgeMs
}

export function resolveOfflinePackSelectedGameCandidate(candidates = [], selectedGameId = '') {
  const selectedId = toSafeText(selectedGameId)
  if (!selectedId || !Array.isArray(candidates)) return null
  return candidates.find((item) => toSafeText(item?.id) === selectedId) || null
}

export function resolveOfflinePackCacheKeyFromPayload(payload = {}) {
  const safePayload = isPlainObject(payload) ? payload : {}
  const sourceMeta = isPlainObject(safePayload.sourceMeta)
    ? safePayload.sourceMeta
    : isPlainObject(safePayload.source_meta)
      ? safePayload.source_meta
      : {}
  return toSafeText(
    sourceMeta.offlinePackPackageSha256 ||
      sourceMeta.packageSha256 ||
      sourceMeta.offlinePackCacheKey ||
      safePayload.offlinePackPackageSha256 ||
      safePayload.packageSha256 ||
      safePayload.offlinePackCacheKey
  )
}

export function normalizeOfflinePackSizeLimits(overrides = {}) {
  return {
    maxPackageBytes: Math.max(
      0,
      toSafeNumber(overrides.maxPackageBytes, OFFLINE_PACK_MAX_PACKAGE_BYTES)
    ),
    maxEntryBytes: Math.max(0, toSafeNumber(overrides.maxEntryBytes, OFFLINE_PACK_MAX_ENTRY_BYTES)),
    maxEntryCount: Math.max(0, toSafeNumber(overrides.maxEntryCount, OFFLINE_PACK_MAX_ENTRY_COUNT))
  }
}

function formatOfflinePackLimitBytes(value = 0) {
  const size = Math.max(0, toSafeNumber(value, 0))
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function validateOfflinePackPackageLimits(payload = {}, overrides = {}) {
  const limits = normalizeOfflinePackSizeLimits(overrides)
  const packageBytes = Math.max(
    0,
    toSafeNumber(payload.packageBytes ?? payload.packageSize ?? payload.sizeBytes, 0)
  )
  const entrySizes = Array.isArray(payload.entrySizes) ? payload.entrySizes : []
  const entryCount = Math.max(0, toSafeNumber(payload.entryCount, entrySizes.length))

  if (limits.maxPackageBytes > 0 && packageBytes > limits.maxPackageBytes) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED,
      message: `离线安装包大小超过上限 ${formatOfflinePackLimitBytes(limits.maxPackageBytes)}`,
      details: {
        packageBytes,
        maxPackageBytes: limits.maxPackageBytes
      }
    }
  }

  if (limits.maxEntryCount > 0 && entryCount > limits.maxEntryCount) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED,
      message: `离线安装包文件数量超过上限 ${limits.maxEntryCount} 个`,
      details: {
        entryCount,
        maxEntryCount: limits.maxEntryCount
      }
    }
  }

  const oversizedEntry = entrySizes.find((entry) => {
    const size =
      typeof entry === 'object' ? (entry.sizeBytes ?? entry.size ?? entry.uncompressedSize) : entry
    return limits.maxEntryBytes > 0 && toSafeNumber(size, 0) > limits.maxEntryBytes
  })

  if (oversizedEntry) {
    const entryPath = toSafeText(
      typeof oversizedEntry === 'object' ? oversizedEntry.path || oversizedEntry.entryName : ''
    )
    const entryBytes = Math.max(
      0,
      toSafeNumber(
        typeof oversizedEntry === 'object'
          ? (oversizedEntry.sizeBytes ?? oversizedEntry.size ?? oversizedEntry.uncompressedSize)
          : oversizedEntry,
        0
      )
    )
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED,
      message: `离线安装包单文件超过上限 ${formatOfflinePackLimitBytes(limits.maxEntryBytes)}`,
      details: {
        entryPath,
        entryBytes,
        maxEntryBytes: limits.maxEntryBytes
      }
    }
  }

  return {
    valid: true,
    code: '',
    message: '',
    details: {
      packageBytes,
      entryCount,
      limits
    }
  }
}

export function normalizeOfflinePackPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

export function isSafeOfflinePackRelativePath(value = '') {
  const normalized = normalizeOfflinePackPath(value)
  if (!normalized) return false
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith('/')) return false
  return !normalized.split('/').some((segment) => segment === '..' || segment === '')
}

export function isOfflinePackFilePath(value = '') {
  return toSafeText(value).toLowerCase().endsWith(OFFLINE_PACK_FILE_EXTENSION)
}

export function detectOfflinePackImportFileKind(value = '') {
  const filePath = toSafeText(value).toLowerCase()
  if (isOfflinePackFilePath(filePath)) {
    return OFFLINE_PACK_IMPORT_FILE_KIND.OFFLINE_PACK
  }
  return OFFLINE_PACK_IMPORT_FILE_KIND.UNKNOWN
}

export function resolveOfflinePackGameKey(game = {}) {
  const safeGame = isPlainObject(game) ? game : {}
  const sourceType = toSafeText(
    safeGame.sourceType || safeGame.sourcePlatform || safeGame.source || ''
  ).toLowerCase()
  const sourceGameId = toSafeText(safeGame.sourceGameId || safeGame.source_game_id)
  const sourceGameSlug = toSafeText(
    safeGame.sourceGameSlug || safeGame.source_game_slug || safeGame.sourceSlug
  )
  return (
    toSafeText(safeGame.gameKey || safeGame.game_key) ||
    (sourceType && (sourceGameId || sourceGameSlug)
      ? `${sourceType}:${sourceGameId || sourceGameSlug}`
      : '')
  )
}

export function validateOfflinePackManifest(manifest = {}) {
  if (!isPlainObject(manifest)) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: 'manifest 格式不正确'
    }
  }
  if (
    manifest.packageType !== OFFLINE_PACK_PACKAGE_TYPE ||
    manifest.format !== OFFLINE_PACK_FORMAT
  ) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '不是 Vertex 离线安装包'
    }
  }
  const schemaVersion = toSafeNumber(manifest.schemaVersion, 0)
  if (!schemaVersion) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '离线安装包缺少 schemaVersion'
    }
  }
  if (schemaVersion > OFFLINE_PACK_SCHEMA_VERSION) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.UNSUPPORTED_VERSION,
      message: '当前客户端暂不支持该离线安装包版本'
    }
  }
  if (!isPlainObject(manifest.game)) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '离线安装包缺少游戏信息'
    }
  }
  if (!resolveOfflinePackGameKey(manifest.game)) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '离线安装包缺少可匹配的游戏来源标识'
    }
  }
  if (!Array.isArray(manifest.items)) {
    return {
      valid: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '离线安装包缺少安装条目'
    }
  }
  for (const [index, item] of manifest.items.entries()) {
    if (!isPlainObject(item)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 格式不正确`
      }
    }
    if (!toSafeText(item.itemId || item.item_id)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 缺少 itemId`
      }
    }
    if (!toSafeText(item.artifactId || item.artifact_id)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 缺少 artifactId`
      }
    }
    const artifactPath = toSafeText(item.artifactPath || item.artifact_path)
    if (!isSafeOfflinePackRelativePath(artifactPath)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 的 artifactPath 不安全`
      }
    }
    // 校验条目 sourcePlatform：必须是非空字符串且在已知来源集合内
    const itemSourcePlatform = toSafeText(item.sourcePlatform || item.source_platform)
    if (itemSourcePlatform && !isKnownOfflinePackSourcePlatform(itemSourcePlatform)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 的 sourcePlatform "${itemSourcePlatform}" 未识别`
      }
    }
    // 校验 dependencies 数组长度上限
    const deps = Array.isArray(item.dependencies) ? item.dependencies : null
    if (deps && deps.length > OFFLINE_PACK_MAX_DEPENDENCIES_PER_ITEM) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 的依赖项超过上限 ${OFFLINE_PACK_MAX_DEPENDENCIES_PER_ITEM}`
      }
    }
    // 校验 cover：仅允许内嵌 coverPath 或 https / data URL
    const coverValue = toSafeText(item.cover)
    if (coverValue && !isValidOfflinePackCoverValue(coverValue)) {
      return {
        valid: false,
        code: OFFLINE_PACK_ERROR_CODE.INVALID,
        message: `离线安装包条目 ${index + 1} 的封面仅允许内嵌路径或 https/data URL`
      }
    }
  }
  return { valid: true, code: '', message: '' }
}

// 来源白名单：与 source-platform-registry 集成（静态 import，无循环依赖）。
// registry 列表为模块加载时快照，进程内单例。
import {
  listOfflinePackSources
} from '../sources/source-platform-registry.js'

let cachedKnownSourcePlatformSet = null
function getKnownOfflinePackSourcePlatformSet() {
  if (cachedKnownSourcePlatformSet) return cachedKnownSourcePlatformSet
  try {
    const offlineKeys = Array.isArray(listOfflinePackSources()) ? listOfflinePackSources() : []
    cachedKnownSourcePlatformSet = new Set(
      [...offlineKeys, 'local'].map((key) => String(key || '').toLowerCase())
    )
  } catch {
    cachedKnownSourcePlatformSet = null
  }
  return cachedKnownSourcePlatformSet
}

function isKnownOfflinePackSourcePlatform(sourcePlatform = '') {
  if (!sourcePlatform) return false
  const set = getKnownOfflinePackSourcePlatformSet()
  if (!set) return true // registry 不可用时退化为不校验
  return set.has(sourcePlatform.toLowerCase())
}

function isValidOfflinePackCoverValue(cover = '') {
  if (!cover) return true
  const trimmed = String(cover).trim()
  if (!trimmed) return true

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return OFFLINE_PACK_ALLOWED_COVER_SCHEMES.includes(url.protocol.toLowerCase())
    } catch {
      return false
    }
  }

  // 内嵌 coverPath（相对路径，由 isSafeOfflinePackRelativePath 校验）
  return isSafeOfflinePackRelativePath(trimmed)
}

export function createOfflinePackError(code, message, details = {}) {
  return {
    success: false,
    code: code || OFFLINE_PACK_ERROR_CODE.INVALID,
    message: message || '离线安装包处理失败',
    details: isPlainObject(details) ? details : {}
  }
}
