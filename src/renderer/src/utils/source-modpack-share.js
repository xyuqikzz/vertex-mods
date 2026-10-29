import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { getFicsitModVersions } from '@renderer/utils/ficsit-api.js'
import {
  getModioApiConfig,
  getModioModFile,
  getModioModFiles,
  resolveEffectiveModioApiConfig
} from '@renderer/utils/modio-api.js'
import {
  getNexusModFiles,
  getNexusModInfo
} from '@renderer/utils/nexus-api.js'
import {
  buildNexusManualDownloadPreviewItem,
  isNexusDownloadLinkForbiddenError
} from '../../../shared/sources/nexus-download-link.js'
import {
  listSourceModpackImportSources,
  resolveSourcePlatformLabel
} from '../../../shared/sources/source-platform-registry.js'
import { getSourceModpackAdapter } from './source-modpack-adapters/registry.js'
import {
  buildDefaultDependencyBatchEntries,
  buildGithubDependencySourceModKey,
  buildNexusDependencySourceModKey,
  getDefaultDependencyList,
  resolveNexusDependencyProvider
} from '../views/game/nexus/nexus-service.js'

export const SOURCE_MODPACK_PLATFORMS = Object.freeze({
  MIXED: 'mixed',
  THUNDERSTORE: 'thunderstore',
  NEXUS: 'nexus',
  MODIO: 'modio',
  FICSIT: 'ficsit',
  VAMHUB: 'vamhub'
})

const SOURCE_PLATFORM_LABEL_MAP = Object.freeze({
  get mixed() { return uiText('ui.mixedSources') }
})

const THUNDERSTORE_DOWNLOAD_BASE_URL = 'https://thunderstore.io/package/download'
const FICSIT_DOWNLOAD_BASE_URL = 'https://api.ficsit.app'
const SOURCE_MODPACK_PROFILE_NAME_MAX_LENGTH = 32
const SOURCE_MODPACK_PROFILE_NAME_INVALID_PATTERN = /[\\/:*?"<>|]/g

function isSourceModpackImportPlatform(value = '') {
  const platform = normalizeSourceModpackPlatform(value)
  if (!platform || platform === SOURCE_MODPACK_PLATFORMS.MIXED) return false
  if (typeof listSourceModpackImportSources !== 'function') return true
  return listSourceModpackImportSources().includes(platform)
}

export function toPlainSourceModpackJson(payload, fallback) {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch {
    return fallback
  }
}

export async function copySourceModpackTextToClipboard(text) {
  const value = String(text || '').trim()
  if (!value) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return !!copied
  }
}

export function normalizeSourceModpackPlatform(value = '') {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (text === 'mod.io') return SOURCE_MODPACK_PLATFORMS.MODIO
  return text
}

export function getSourceModpackPlatformLabel(value = '') {
  const platform = normalizeSourceModpackPlatform(value)
  return (
    SOURCE_PLATFORM_LABEL_MAP[platform] ||
    resolveSourcePlatformLabel(platform, platform || uiText('ui.externalSource'))
  )
}

export function normalizeSourceModpackImportProfileName(value = '', fallback = '分享整合包') {
  const rawText = String(value || fallback || '分享整合包').trim()
  const normalized = rawText
    .replace(SOURCE_MODPACK_PROFILE_NAME_INVALID_PATTERN, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  return normalized.slice(0, SOURCE_MODPACK_PROFILE_NAME_MAX_LENGTH).trim() || '分享整合包'
}

function parseMetadataJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  const text = String(value || '').trim()
  if (!text) {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function resolveItemSortIndex(item = {}, fallback = 0) {
  const metadata = getItemMetadata(item)
  return toSafeNumber(
    item.sortIndex ?? item.sort_index ?? metadata.sortIndex ?? metadata.sort_index,
    fallback
  )
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) {
      return text
    }
  }
  return ''
}

function getItemMetadata(item = {}) {
  return item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
}

function getDetailSourceGameId(detail = {}, item = {}) {
  const pack = getSourceModpackDetailPack(detail)
  return firstText(
    item.sourceGameId,
    item.source_game_id,
    getItemMetadata(item).sourceGameId,
    getItemMetadata(item).source_game_id,
    pack.sourceGameId,
    pack.source_game_id
  )
}

function getDetailSourceGameSlug(detail = {}, item = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const metadata = getItemMetadata(item)
  return firstText(
    item.sourceGameSlug,
    item.source_game_slug,
    item.sourceGameDomain,
    item.source_game_domain,
    metadata.sourceGameSlug,
    metadata.source_game_slug,
    metadata.sourceGameDomain,
    metadata.source_game_domain,
    metadata.domainName,
    metadata.gameDomainName,
    pack.sourceGameSlug,
    pack.source_game_slug
  )
}

function normalizeFicsitDownloadUrl(rawUrl) {
  const text = String(rawUrl || '').trim()
  if (!text) return ''
  try {
    return new URL(text, FICSIT_DOWNLOAD_BASE_URL).toString()
  } catch {
    return ''
  }
}

function parseThunderstorePackageFullName(fullName = '') {
  const raw = String(fullName || '').trim()
  const match = raw.match(/^([^-]+)-(.+)$/)
  if (!match) {
    return {
      namespace: '',
      packageName: '',
      fullName: raw
    }
  }

  return {
    namespace: String(match[1] || '').trim(),
    packageName: String(match[2] || '').trim(),
    fullName: raw
  }
}

function resolveThunderstoreFullName(item = {}) {
  const metadata = getItemMetadata(item)
  const rawFullName = firstText(
    metadata.fullName,
    metadata.full_name,
    metadata.packageFullName,
    metadata.package_full_name,
    item.packageFullName,
    item.package_full_name,
    item.sourceModId,
    item.source_mod_id,
    item.sourceModKey,
    item.source_mod_key
  )
  const keyParts = rawFullName.split(':').map((part) => part.trim()).filter(Boolean)
  return keyParts.find((part) => /^([^-]+)-(.+)$/.test(part)) || rawFullName
}

function resolveThunderstorePackageInfo(item = {}, detail = {}) {
  const metadata = getItemMetadata(item)
  const fullName = resolveThunderstoreFullName(item)
  const parsed = parseThunderstorePackageFullName(fullName)
  const namespace = firstText(metadata.packageOwner, metadata.owner, metadata.namespace, parsed.namespace)
  const packageName = firstText(metadata.packageName, metadata.package_name, parsed.packageName)
  const version = firstText(item.version, item.sourceFileId, item.source_file_id, metadata.version)
  const community = firstText(metadata.community, metadata.sourceGameId, getDetailSourceGameId(detail, item))

  return {
    fullName,
    namespace,
    packageName,
    version,
    community
  }
}

function resolveThunderstoreDownloadUrl(item = {}, detail = {}) {
  const { namespace, packageName, version } = resolveThunderstorePackageInfo(item, detail)
  if (!namespace || !packageName || !version) {
    return ''
  }

  return `${THUNDERSTORE_DOWNLOAD_BASE_URL}/${encodeURIComponent(namespace)}/${encodeURIComponent(
    packageName
  )}/${encodeURIComponent(version)}/`
}

export function normalizeSourceModpackItems(items = [], fallbackPlatform = '') {
  const fallbackSource = normalizeSourceModpackPlatform(fallbackPlatform)
  const result = []
  const seen = new Set()
  const sourceItems = Array.isArray(items) ? items : []

  for (let rawIndex = 0; rawIndex < sourceItems.length; rawIndex++) {
    const rawItem = sourceItems[rawIndex]
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {}
    const metadata = parseMetadataJson(item.metadata || item.metadataJson || item.metadata_json)
    const sourcePlatform = normalizeSourceModpackPlatform(
      item.sourcePlatform || item.source_platform || fallbackSource
    )
    const sourceModId = String(item.sourceModId || item.source_mod_id || '').trim()
    const sourceFileId = String(item.sourceFileId || item.source_file_id || '').trim()
    const sourceModKey = String(item.sourceModKey || item.source_mod_key || sourceModId).trim()
    if (!sourcePlatform || (!sourceModId && !sourceModKey)) {
      continue
    }

    const key = [sourcePlatform, sourceModKey || sourceModId, sourceFileId].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    result.push({
      sourcePlatform,
      sourceGameId: firstText(item.sourceGameId, item.source_game_id, metadata.sourceGameId) || undefined,
      sourceGameSlug: firstText(item.sourceGameSlug, item.source_game_slug, metadata.sourceGameSlug) || undefined,
      sourceModId,
      sourceFileId,
      sourceModKey,
      name: String(item.name || '').trim(),
      version: String(item.version || '').trim(),
      downloadUrl: String(item.downloadUrl || item.download_url || '').trim(),
      sortIndex: resolveItemSortIndex(
        {
          ...item,
          metadata
        },
        rawIndex
      ),
      metadata
    })
  }

  return result.sort((left, right) => {
    return toSafeNumber(left.sortIndex, 0) - toSafeNumber(right.sortIndex, 0)
  })
}

export function buildSourceModpackCreatePayload(options = {}) {
  const sourceType = normalizeSourceModpackPlatform(options.sourceType)
  const items = normalizeSourceModpackItems(options.items, sourceType)
  return toPlainSourceModpackJson(
    {
      sourceType,
      sourceGameId: String(options.sourceGameId || '').trim(),
      sourceGameSlug: String(options.sourceGameSlug || '').trim(),
      sourceGameName: String(options.sourceGameName || '').trim(),
      name: String(options.name || '').trim(),
      cover: String(options.cover || '').trim(),
      description: String(options.description || '').trim(),
      version: String(options.version || '1.0.0').trim(),
      isPublic: options.isPublic === true,
      items
    },
    {
      sourceType,
      items: []
    }
  )
}

export function extractSourceModpackShareCode(result = {}) {
  return String(result.shareCode || result.share_code || result.code || result.key || '').trim()
}

export function getSourceModpackDetailPack(detail = {}) {
  const target = detail && typeof detail === 'object' ? detail : {}
  return target.modpack && typeof target.modpack === 'object' ? target.modpack : target
}

function getSourceModpackEditorItemMetadata(item = {}) {
  const metadata = {}
  for (const candidate of [item.metadata_json, item.metadataJson, item.metadata]) {
    Object.assign(metadata, parseMetadataJson(candidate))
  }
  return toPlainSourceModpackJson(metadata, {})
}

function normalizeSourceModpackEditorDependencies(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  try {
    const parsed = JSON.parse(String(value || ''))
    return Array.isArray(parsed) || (parsed && typeof parsed === 'object') ? parsed : []
  } catch {
    return []
  }
}

function normalizeSourceModpackEditorItem(item = {}, fallbackPlatform = '', fallbackIndex = 0) {
  const target = item && typeof item === 'object' ? item : {}
  const metadata = getSourceModpackEditorItemMetadata(target)
  const sourcePlatform = normalizeSourceModpackPlatform(
    target.sourcePlatform || target.source_platform || fallbackPlatform
  )
  const sourceModId = firstText(target.sourceModId, target.source_mod_id)
  const sourceFileId = firstText(target.sourceFileId, target.source_file_id)
  const sourceModKey = firstText(target.sourceModKey, target.source_mod_key)

  if (
    !isSourceModpackImportPlatform(sourcePlatform) ||
    (!sourceModId && !sourceModKey)
  ) {
    return null
  }

  return {
    sourcePlatform,
    sourceGameId: firstText(target.sourceGameId, target.source_game_id, metadata.sourceGameId) || undefined,
    sourceGameSlug: firstText(target.sourceGameSlug, target.source_game_slug, metadata.sourceGameSlug) || undefined,
    sourceModId,
    sourceFileId,
    sourceModKey,
    name: String(target.name || '').trim(),
    version: String(target.version || '').trim(),
    cover: target.cover != null ? String(target.cover).trim() : firstText(target.icon, metadata.cover, metadata.icon),
    description: target.description != null ? String(target.description).trim() : firstText(
      target.description,
      target.summary,
      metadata.description,
      metadata.summary
    ),
    dependencies: normalizeSourceModpackEditorDependencies(
      target.dependencies ?? metadata.dependencies
    ),
    downloadUrl: target.downloadUrl != null ? String(target.downloadUrl).trim() : firstText(
      target.downloadUrl,
      target.download_url,
      metadata.downloadUrl,
      metadata.download_url
    ),
    metadata,
    sortIndex: resolveItemSortIndex(
      {
        ...target,
        metadata
      },
      fallbackIndex
    )
  }
}

function inferSourceModpackEditorSourceType(items = []) {
  const platforms = new Set(
    items
      .map((item) => normalizeSourceModpackPlatform(item?.sourcePlatform))
      .filter((platform) => isSourceModpackImportPlatform(platform))
  )
  if (platforms.size > 1) return SOURCE_MODPACK_PLATFORMS.MIXED
  return platforms.values().next().value || ''
}

function toSourceModpackEditorBoolean(value) {
  if (typeof value === 'string') {
    return value.trim() === '1' || value.trim().toLowerCase() === 'true'
  }
  return value === true || value === 1
}

export function normalizeSourceModpackEditorDraft(detail = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const fallbackPlatform = normalizeSourceModpackPlatform(pack.sourceType || pack.source_type)
  const rawItems = Array.isArray(detail?.items) ? detail.items : []
  const items = rawItems
    .map((item, index) => ({
      item: normalizeSourceModpackEditorItem(item, fallbackPlatform, index),
      index
    }))
    .filter((entry) => entry.item)
    .sort((left, right) => left.item.sortIndex - right.item.sortIndex || left.index - right.index)
    .map((entry, index) => ({
      ...entry.item,
      sortIndex: index
    }))

  return toPlainSourceModpackJson(
    {
      name: String(pack.name || '').trim(),
      version: String(pack.version || '1.0.0').trim(),
      cover: String(pack.cover || '').trim(),
      description: String(pack.description || '').trim(),
      isPublic: toSourceModpackEditorBoolean(pack.isPublic ?? pack.is_public),
      sourceType: inferSourceModpackEditorSourceType(items) || fallbackPlatform,
      sourceGameId: firstText(pack.sourceGameId, pack.source_game_id),
      sourceGameSlug: firstText(pack.sourceGameSlug, pack.source_game_slug),
      sourceGameName: firstText(pack.sourceGameName, pack.source_game_name),
      items
    },
    {
      name: '',
      version: '1.0.0',
      cover: '',
      description: '',
      isPublic: false,
      sourceType: '',
      sourceGameId: '',
      sourceGameSlug: '',
      sourceGameName: '',
      items: []
    }
  )
}

export function buildSourceModpackUpdatePayload(detail = {}, draft = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const fallbackPlatform = normalizeSourceModpackPlatform(pack.sourceType || pack.source_type)
  const items = []
  const rawItems = Array.isArray(draft?.items) ? draft.items : []

  for (let index = 0; index < rawItems.length; index++) {
    const item = normalizeSourceModpackEditorItem(rawItems[index], fallbackPlatform, index)
    if (!item) continue
    items.push({
      ...item,
      sortIndex: items.length
    })
  }

  if (!items.length) {
    throw new Error(uiText('ui.keepAtLeastOneValidModEntry'))
  }

  return toPlainSourceModpackJson(
    {
      expectedRevision: Number(pack.currentRevision ?? pack.current_revision ?? 0) || undefined,
      sourceType: inferSourceModpackEditorSourceType(items),
      sourceGameId: firstText(pack.sourceGameId, pack.source_game_id),
      sourceGameSlug: firstText(pack.sourceGameSlug, pack.source_game_slug),
      sourceGameName: firstText(pack.sourceGameName, pack.source_game_name),
      name: String(draft.name ?? pack.name ?? '').trim(),
      cover: String(draft.cover ?? pack.cover ?? '').trim(),
      description: String(draft.description ?? pack.description ?? '').trim(),
      version: String(draft.version ?? pack.version ?? '1.0.0').trim(),
      isPublic:
        draft.isPublic === undefined
          ? toSourceModpackEditorBoolean(pack.isPublic ?? pack.is_public)
          : draft.isPublic === true,
      items
    },
    {
      sourceType: '',
      items: []
    }
  )
}

export function buildSourceModpackImportProfileName(detail = {}, sourceType = '') {
  const pack = getSourceModpackDetailPack(detail)
  const shareCode = String(pack.shareCode || pack.share_code || '').trim()
  const suffix = shareCode ? shareCode.slice(-4) : ''
  const fallbackName = uiText('ui.valueSharedModpack', { value1: (getSourceModpackPlatformLabel(sourceType || pack.sourceType || pack.source_type)) })
  if (!suffix) {
    return normalizeSourceModpackImportProfileName(pack.name, fallbackName)
  }

  const maxBaseLength = SOURCE_MODPACK_PROFILE_NAME_MAX_LENGTH - suffix.length - 1
  const baseName = normalizeSourceModpackImportProfileName(pack.name, fallbackName)
    .slice(0, Math.max(maxBaseLength, 1))
    .trim()
  return normalizeSourceModpackImportProfileName(`${baseName}-${suffix}`, fallbackName)
}

export function getSourceModpackDetailItems(detail = {}, sourceType = '') {
  const target = detail && typeof detail === 'object' ? detail : {}
  const pack = getSourceModpackDetailPack(target)
  const platform = normalizeSourceModpackPlatform(sourceType || pack.sourceType || pack.source_type)
  const fallbackPlatform = platform === SOURCE_MODPACK_PLATFORMS.MIXED ? '' : platform
  return normalizeSourceModpackItems(target.items || [], fallbackPlatform).filter((item) => {
    if (platform === SOURCE_MODPACK_PLATFORMS.MIXED) {
      return true
    }
    return !platform || item.sourcePlatform === platform
  })
}

function resolveEntrySourcePlatform(entry = {}) {
  const meta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {}
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  const installPayload =
    meta.installPayload && typeof meta.installPayload === 'object'
      ? meta.installPayload
      : entry?.installPayload && typeof entry.installPayload === 'object'
        ? entry.installPayload
        : item?.installPayload && typeof item.installPayload === 'object'
          ? item.installPayload
          : {}
  return normalizeSourceModpackPlatform(
    meta.sourcePlatform ||
      meta.sourceType ||
      item.sourcePlatform ||
      item.sourceType ||
      installPayload.sourcePlatform ||
      installPayload.sourceType ||
      installPayload.source ||
      ''
  )
}

function resolveEntrySourceGameId(entry = {}, detail = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const meta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {}
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  const installPayload =
    meta.installPayload && typeof meta.installPayload === 'object'
      ? meta.installPayload
      : entry?.installPayload && typeof entry.installPayload === 'object'
        ? entry.installPayload
        : item?.installPayload && typeof item.installPayload === 'object'
          ? item.installPayload
          : {}
  return firstText(
    installPayload.sourceGameId,
    installPayload.gameId,
    meta.sourceGameId,
    item.sourceGameId,
    item.source_game_id,
    pack.sourceGameId,
    pack.source_game_id
  )
}

function resolveEntrySourceGameSlug(entry = {}, detail = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const meta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {}
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  const installPayload =
    meta.installPayload && typeof meta.installPayload === 'object'
      ? meta.installPayload
      : entry?.installPayload && typeof entry.installPayload === 'object'
        ? entry.installPayload
        : item?.installPayload && typeof item.installPayload === 'object'
          ? item.installPayload
          : {}
  return firstText(
    installPayload.sourceGameSlug,
    installPayload.sourceGameDomain,
    meta.sourceGameSlug,
    meta.sourceGameDomain,
    item.sourceGameSlug,
    item.source_game_slug,
    item.sourceGameDomain,
    item.source_game_domain,
    pack.sourceGameSlug,
    pack.source_game_slug
  )
}

export function groupSourceModpackItemsByPlatform(items = []) {
  const groupMap = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const platform = resolveEntrySourcePlatform(item)
    if (!platform || platform === SOURCE_MODPACK_PLATFORMS.MIXED) {
      continue
    }
    if (!groupMap.has(platform)) {
      groupMap.set(platform, [])
    }
    groupMap.get(platform).push(item)
  }
  return Array.from(groupMap.entries()).map(([sourcePlatform, platformItems]) => ({
    sourcePlatform,
    items: platformItems
  }))
}

export function buildSourceModpackInstallTaskPayload(detail = {}, options = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const source = normalizeSourceModpackPlatform(options.source || pack.sourceType || pack.source_type)
  const rawProfileName = String(
    options.profileName ||
      options.targetProfileName ||
      options.sourceMeta?.targetProfileName ||
      options.sourceMeta?.profileName ||
      options.options?.targetProfileName ||
      options.options?.profileName ||
      ''
  ).trim()
  const profileName = rawProfileName ? normalizeSourceModpackImportProfileName(rawProfileName) : ''
  return toPlainSourceModpackJson(
    {
      source,
      sourceAdapter: options.sourceAdapter || source,
      sourceGameId: String(options.sourceGameId || pack.sourceGameId || pack.source_game_id || '').trim(),
      sourceGameSlug: String(options.sourceGameSlug || pack.sourceGameSlug || pack.source_game_slug || '').trim(),
      gameKey: String(options.gameKey || `${source}:${pack.sourceGameId || pack.source_game_id || 'unknown'}`),
      gameRoot: String(options.gameRoot || '').trim(),
      ...(profileName ? { profileName, targetProfileName: profileName } : {}),
      title:
        String(options.title || pack.name || '').trim() ||
        uiText('ui.valueShareImport', { value1: (getSourceModpackPlatformLabel(source)) }),
      mainItem: options.mainItem || {},
      items: Array.isArray(options.items) ? options.items : [],
      installRule: options.installRule || {},
      sourceMeta: {
        source,
        sourceModpackId: pack.id,
        shareCode: pack.shareCode || pack.share_code || '',
        sourceGameSlug: String(options.sourceGameSlug || pack.sourceGameSlug || pack.source_game_slug || '').trim(),
        ...(options.sourceMeta || {}),
        ...(profileName ? { profileName, targetProfileName: profileName } : {})
      },
      options: {
        autoStart: true,
        includeDependencies: true,
        ...(options.options || {}),
        ...(profileName ? { profileName, targetProfileName: profileName } : {})
      }
    },
    {
      source,
      items: []
    }
  )
}

export function buildSourceModpackInstallTaskPayloads(detail = {}, options = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const requestedSource = normalizeSourceModpackPlatform(
    options.source || pack.sourceType || pack.source_type
  )
  const items = Array.isArray(options.items) ? options.items : []
  const groups = groupSourceModpackItemsByPlatform(items)

  if (requestedSource && requestedSource !== SOURCE_MODPACK_PLATFORMS.MIXED && !groups.length) {
    return [
      buildSourceModpackInstallTaskPayload(detail, {
        ...options,
        source: requestedSource,
        sourceAdapter: options.sourceAdapter || requestedSource,
        items
      })
    ]
  }

  const effectiveGroups =
    requestedSource && requestedSource !== SOURCE_MODPACK_PLATFORMS.MIXED
      ? groups.filter((group) => group.sourcePlatform === requestedSource)
      : groups

  return effectiveGroups.map((group) => {
    const sourceGameId = resolveEntrySourceGameId(group.items[0], detail)
    const sourceGameSlug = resolveEntrySourceGameSlug(group.items[0], detail)
    const label = getSourceModpackPlatformLabel(group.sourcePlatform)
    return buildSourceModpackInstallTaskPayload(detail, {
      ...options,
      source: group.sourcePlatform,
      sourceAdapter: group.sourcePlatform,
      sourceGameId,
      sourceGameSlug,
      gameKey: `${group.sourcePlatform}:${sourceGameId || sourceGameSlug || 'unknown'}`,
      title: options.title
        ? `${options.title} - ${label}`
        : uiText('ui.valueImport', { value1: (String(pack.name || label).trim()) }),
      items: group.items,
      sourceMeta: {
        ...(options.sourceMeta || {}),
        source: group.sourcePlatform,
        sourceGameId,
        sourceGameSlug,
        sourceModpackPreview: options.sourceMeta?.sourceModpackPreview === true
      }
    })
  })
}

export function normalizeSourceModpackPage(pageData = {}) {
  const data = pageData && typeof pageData === 'object' ? pageData : {}
  const records = Array.isArray(data.records) ? data.records : Array.isArray(data.list) ? data.list : []
  return {
    records,
    total: Number(data.total || records.length || 0),
    current: Number(data.current || data.page || 1),
    size: Number(data.size || data.pageSize || 12)
  }
}

function resolvePreviewDownloadUrl(item = {}, detail = {}) {
  const metadata = getItemMetadata(item)
  const originalFicsitVersion =
    metadata.originalFicsitVersion && typeof metadata.originalFicsitVersion === 'object'
      ? metadata.originalFicsitVersion
      : {}
  const directUrl = String(
    item.downloadUrl ||
      item.download_url ||
      metadata.downloadUrl ||
      metadata.download_url ||
      originalFicsitVersion.link ||
      ''
  ).trim()
  if (directUrl) {
    return directUrl
  }

  if (normalizeSourceModpackPlatform(item.sourcePlatform) === SOURCE_MODPACK_PLATFORMS.THUNDERSTORE) {
    return resolveThunderstoreDownloadUrl(item, detail)
  }

  return ''
}

function resolvePreviewFileType(downloadUrl = '') {
  const text = String(downloadUrl || '').trim()
  if (!text) return 'zip'
  try {
    const fileName = new URL(text).pathname.split('/').filter(Boolean).pop() || ''
    const match = fileName.match(/\.([a-z0-9]{2,8})$/i)
    return match ? match[1].toLowerCase() : 'zip'
  } catch {
    const fileName = text.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || ''
    const match = fileName.match(/\.([a-z0-9]{2,8})$/i)
    return match ? match[1].toLowerCase() : 'zip'
  }
}

export function buildSourceModpackPreviewItems(detail = {}) {
  return getSourceModpackDetailItems(detail).map((item, index) => {
    const sourcePlatform = normalizeSourceModpackPlatform(item.sourcePlatform)
    const adapter = getSourceModpackAdapter(sourcePlatform)
    const sourceModKey = String(item.sourceModKey || item.sourceModId || '').trim()
    const sourceFileId = String(item.sourceFileId || item.version || '').trim()
    const adapterPreview =
      adapter?.buildPreviewItem?.(item, detail, { index }) || null
    const downloadUrl = adapterPreview
      ? String(adapterPreview.downloadUrl || '').trim()
      : resolvePreviewDownloadUrl(item, detail)
    let status = 'success'
    let reason = uiText('ui.readyToImport')
    if (!sourcePlatform || !sourceModKey) {
      status = 'error'
      reason = '缺少来源模组标识'
    } else if (!downloadUrl) {
      status = 'error'
      reason = '当前分享条目需要按来源重新解析下载地址'
    }
    return {
      ...item,
      previewKey: [sourcePlatform, sourceModKey, sourceFileId, index].join(':'),
      sourcePlatform,
      sourcePlatformLabel: getSourceModpackPlatformLabel(sourcePlatform),
      sourceModKey,
      sourceFileId,
      sortIndex: resolveItemSortIndex(item, index),
      downloadUrl,
      status,
      reason,
      canImport: status === 'success',
      ...(adapterPreview || {})
    }
  })
}

function buildRegeneratedNexusDefaultDependencyPreviewItems(
  detail = {},
  currentNexusRule = null,
  existingItems = []
) {
  const pack = getSourceModpackDetailPack(detail)
  const source = normalizeSourceModpackPlatform(pack.sourceType || pack.source_type)
  if (source !== SOURCE_MODPACK_PLATFORMS.NEXUS || !currentNexusRule) {
    return []
  }

  const supportedSources = new Set(['github_release', 'nexus_file'])
  const existingKeys = new Set(
    (Array.isArray(existingItems) ? existingItems : [])
      .map((item) =>
        String(item?.sourceModKey || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  )

  return getDefaultDependencyList(currentNexusRule)
    .map((dependency, index) => {
      const dependencySource = String(dependency?.source || '')
        .trim()
        .toLowerCase()
      if (!supportedSources.has(dependencySource)) {
        return null
      }

      const sourceModKey =
        buildShareDefaultDependencySourceModKey(dependency) ||
        `dependency:${dependencySource}:${String(dependency?.id || index + 1).trim()}`
      const normalizedKey = sourceModKey.trim().toLowerCase()
      if (!normalizedKey || existingKeys.has(normalizedKey)) {
        return null
      }
      existingKeys.add(normalizedKey)

      const name = String(dependency?.name || dependency?.id || uiText('ui.defaultDependencyValue', { value1: (index + 1) })).trim()
      const sortIndex = index
      return {
        sourcePlatform: SOURCE_MODPACK_PLATFORMS.NEXUS,
        sourceModId: String(dependency?.id || sourceModKey).trim(),
        sourceFileId: '',
        sourceModKey,
        name,
        version: String(dependency?.version || dependency?.notes || '').trim(),
        downloadUrl: '',
        sortIndex,
        previewKey: [SOURCE_MODPACK_PLATFORMS.NEXUS, sourceModKey, 'default', sortIndex].join(':'),
        status: 'error',
        reason: uiText('ui.defaultDependenciesMustBeRegeneratedFromInstallationConfiguration'),
        canImport: false,
        metadata: {
          category: 'default_dependency',
          dependencyRole: 'default_dependency',
          isDefaultDependency: true,
          dependencyId: String(dependency?.id || '').trim(),
          dependencySource,
          sortIndex
        }
      }
    })
    .filter(Boolean)
}

function resolvePreferredModioFile(files = []) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => toSafeNumber(file?.fileId || file?.id, 0) > 0)
    .sort((left, right) => toSafeNumber(right?.dateAdded, 0) - toSafeNumber(left?.dateAdded, 0))[0]
}

function resolveModioShareItemIdentifiers(item = {}) {
  const metadata = getItemMetadata(item)
  const keyParts = String(item?.sourceModKey || '').split(':')
  return {
    modId: toSafeNumber(item?.sourceModId || metadata.modId || keyParts[1], 0),
    fileId: toSafeNumber(item?.sourceFileId || metadata.fileId || keyParts[2], 0)
  }
}

async function resolveModioPreviewItem(item = {}, detail = {}, options = {}) {
  const { modId, fileId } = resolveModioShareItemIdentifiers(item)
  const gameId = toSafeNumber(getDetailSourceGameId(detail, item) || options.modioGameId, 0)
  if (!gameId || !modId) {
    throw new Error(uiText('ui.modIoGameOrModIdentifierIsMissing'))
  }

  const apiConfig = resolveEffectiveModioApiConfig(
    options.modioApiConfig,
    options.systemConfig?.modioApi,
    getModioApiConfig()
  )
  let targetFile = null
  if (fileId > 0) {
    targetFile = await getModioModFile(gameId, modId, fileId, apiConfig)
  } else {
    const fileResult = await getModioModFiles(gameId, modId, apiConfig, { limit: 20 })
    targetFile = resolvePreferredModioFile(fileResult?.records || [])
  }

  const downloadUrl = String(targetFile?.downloadUrl || '').trim()
  if (!targetFile || !downloadUrl) {
    throw new Error(uiText('ui.noModIoDownloadURLWasReturnedValue', { value1: (item?.name || modId) }))
  }

  return {
    downloadUrl,
    sourceFileId: String(targetFile.fileId || fileId || '').trim(),
    version: String(targetFile.version || item.version || '').trim(),
    metadata: {
      ...getItemMetadata(item),
      fileName: String(targetFile.name || '').trim(),
      fileSize: toSafeNumber(targetFile.filesize, 0),
      fileMd5: String(targetFile.filehash || '').trim(),
      platforms: Array.isArray(targetFile.platforms) ? targetFile.platforms : []
    }
  }
}

function normalizeDependencyMatchText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function isNexusDefaultDependencyShareItem(item = {}) {
  const metadata = getItemMetadata(item)
  const sourceModKey = String(item?.sourceModKey || '').trim().toLowerCase()
  const category = String(metadata.category || metadata.type || '').trim().toLowerCase()
  const dependencyRole = String(metadata.dependencyRole || metadata.dependency_role || '')
    .trim()
    .toLowerCase()
  return (
    sourceModKey.startsWith('dependency:') ||
    category === 'default_dependency' ||
    dependencyRole === 'default_dependency' ||
    metadata.isDefaultDependency === true ||
    metadata.is_default_dependency === true ||
    toSafeNumber(metadata.typeId || metadata.type_id, 0) === 1
  )
}

function buildShareDefaultDependencySourceModKey(dependency = {}) {
  const source = String(dependency?.source || '').trim().toLowerCase()
  if (source === 'github_release') {
    return buildGithubDependencySourceModKey(dependency, {
      asset: {
        name: String(
          dependency?.provider?.asset_name ||
            dependency?.provider?.assetName ||
            dependency?.id ||
            ''
        ).trim()
      }
    })
  }

  if (source === 'nexus_file') {
    return buildNexusDependencySourceModKey(
      resolveNexusDependencyProvider(dependency?.provider || {})
    )
  }

  return ''
}

function buildDefaultDependencyCandidateTextList(dependency = {}) {
  const provider =
    dependency?.provider && typeof dependency.provider === 'object' ? dependency.provider : {}
  const resolvedProvider = resolveNexusDependencyProvider(provider)
  return [
    dependency?.id,
    dependency?.name,
    dependency?.notes,
    dependency?.description,
    provider?.asset_name,
    provider?.assetName,
    provider?.url,
    provider?.downloadUrl,
    buildShareDefaultDependencySourceModKey(dependency),
    resolvedProvider?.modId && resolvedProvider?.fileId
      ? buildNexusDependencySourceModKey(resolvedProvider)
      : ''
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function isNexusFileDefaultDependency(dependency = {}) {
  return String(dependency?.source || '')
    .trim()
    .toLowerCase() === 'nexus_file'
}

function findMatchedDefaultDependencyForShareItem(item = {}, currentNexusRule = null) {
  const dependencyList = getDefaultDependencyList(currentNexusRule)
  if (!dependencyList.length) {
    return null
  }

  const metadata = getItemMetadata(item)
  const shareTexts = [
    item.sourceModKey,
    item.sourceModId,
    item.sourceFileId,
    item.name,
    metadata.dependencyId,
    metadata.dependency_id,
    metadata.fileName,
    metadata.file_name
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const shareTextSet = new Set(shareTexts.map((value) => value.toLowerCase()))
  const normalizedShareTexts = shareTexts.map((value) => normalizeDependencyMatchText(value)).filter(Boolean)

  for (const dependency of dependencyList) {
    const candidateTexts = buildDefaultDependencyCandidateTextList(dependency)
    if (candidateTexts.some((value) => shareTextSet.has(value.toLowerCase()))) {
      return dependency
    }
  }

  for (const dependency of dependencyList) {
    const candidateTexts = buildDefaultDependencyCandidateTextList(dependency)
    const normalizedCandidateTexts = candidateTexts
      .map((value) => normalizeDependencyMatchText(value))
      .filter(Boolean)
    const matched = normalizedCandidateTexts.some((candidate) => {
      return normalizedShareTexts.some((shareText) => {
        return shareText === candidate || shareText.includes(candidate) || candidate.includes(shareText)
      })
    })
    if (matched) {
      return dependency
    }
  }

  return null
}

function buildSingleDefaultDependencyRule(currentNexusRule = null, dependency = {}) {
  const ruleJson =
    currentNexusRule?.ruleJson && typeof currentNexusRule.ruleJson === 'object'
      ? currentNexusRule.ruleJson
      : {}
  const setup =
    ruleJson.setup && typeof ruleJson.setup === 'object' && !Array.isArray(ruleJson.setup)
      ? ruleJson.setup
      : {}
  return {
    ...(currentNexusRule || {}),
    ruleJson: {
      ...ruleJson,
      setup: {
        ...setup,
        default_dependencies: [],
        defaultDependencies: []
      },
      default_dependencies: [dependency],
      defaultDependencies: []
    }
  }
}

function resolveNexusShareItemIdentifiers(item = {}, detail = {}) {
  const metadata = getItemMetadata(item)
  const keyParts = String(item?.sourceModKey || '')
    .split(':')
    .map((part) => part.trim())
  const isNexusDependencyKey = keyParts[0] === 'dependency' && keyParts[1] === 'nexus'
  const keyModId = isNexusDependencyKey ? keyParts[2] : keyParts[1]
  const keyFileId = isNexusDependencyKey ? keyParts[3] : keyParts[2]
  return {
    modId: toSafeNumber(item?.sourceModId || metadata.modId || keyModId, 0),
    fileId: toSafeNumber(item?.sourceFileId || metadata.fileId || keyFileId, 0),
    domainName: getDetailSourceGameSlug(detail, item)
  }
}

function buildNexusManualPreviewResolution(context = {}) {
  const base = buildNexusManualDownloadPreviewItem(context)
  const extraMetadata =
    context?.metadata && typeof context.metadata === 'object' && !Array.isArray(context.metadata)
      ? context.metadata
      : {}
  return {
    ...base,
    metadata: {
      ...(base?.metadata && typeof base.metadata === 'object' ? base.metadata : {}),
      ...extraMetadata
    }
  }
}

async function buildNexusDefaultDependencyManualPreviewItem(
  item = {},
  dependency = {},
  apiConfig = {},
  metadata = {}
) {
  const provider =
    dependency?.provider && typeof dependency.provider === 'object' ? dependency.provider : {}
  const resolvedProvider = resolveNexusDependencyProvider(provider)
  const domainName = String(resolvedProvider?.domainName || '').trim()
  const modId = toSafeNumber(resolvedProvider?.modId, 0)
  const fileId = toSafeNumber(resolvedProvider?.fileId, 0)
  if (!domainName || modId <= 0 || fileId <= 0) {
    throw new Error(
      uiText('ui.defaultDependencyValueHasNoValidNexusFileIdentifier', { value1: (String(dependency?.name || dependency?.id || '').trim() || uiText('ui.unknownItem')) })
    )
  }

  const [modInfo, fileResponse] = await Promise.all([
    getNexusModInfo(domainName, modId, apiConfig).catch(() => ({
      modId,
      name: item?.name || String(dependency?.name || '').trim() || `Nexus 模组-${modId}`,
      pictureUrl: getItemMetadata(item).cover || ''
    })),
    getNexusModFiles(domainName, modId, apiConfig).catch(() => ({ files: [] }))
  ])
  const targetFile =
    (Array.isArray(fileResponse?.files) ? fileResponse.files : []).find((file) => {
      return toSafeNumber(file?.file_id || file?.fileId || file?.id, 0) === fileId
    }) || {}

  return buildNexusManualPreviewResolution({
    item,
    modInfo,
    targetFile,
    domainName,
    modId,
    fileId,
    metadata
  })
}

async function resolveNexusDefaultDependencyPreviewItem(item = {}, detail = {}, options = {}) {
  const currentNexusRule = options.currentNexusRule || options.nexusRule || null
  if (!currentNexusRule) {
    throw new Error(uiText('ui.nexusGameInstallationConfigurationIsUnavailableCannotResolveDefaultDependencies'))
  }

  const dependency = findMatchedDefaultDependencyForShareItem(item, currentNexusRule)
  if (!dependency) {
    throw new Error(uiText('ui.noDefaultDependenciesFoundInTheNexusGameConfiguration'))
  }

  if (options.skipNexusDownloadLinkResolve === true && isNexusFileDefaultDependency(dependency)) {
    return await buildNexusDefaultDependencyManualPreviewItem(
      item,
      dependency,
      options.nexusApiConfig || {}
    )
  }

  const pack = getSourceModpackDetailPack(detail)
  const singleRule = buildSingleDefaultDependencyRule(currentNexusRule, dependency)
  let entries = []
  try {
    entries = await buildDefaultDependencyBatchEntries({
      currentNexusRule: singleRule,
      gameBaseInfo: {
        domainName: getDetailSourceGameSlug(detail, item),
        name: firstText(pack.sourceGameName, pack.source_game_name, pack.name)
      },
      detectedRootPath: String(options.detectedRootPath || '').trim(),
      resolvedNexusAppId: toSafeNumber(options.resolvedNexusAppId, 0),
      systemConfig: options.systemConfig || {},
      apiConfig: options.nexusApiConfig || {},
      installedSourceModKeys: new Set(),
      startSortIndex: 0
    })
  } catch (error) {
    if (isNexusDownloadLinkForbiddenError(error) && isNexusFileDefaultDependency(dependency)) {
      return await buildNexusDefaultDependencyManualPreviewItem(
        item,
        dependency,
        options.nexusApiConfig || {},
        { stopNexusDownloadLinkResolve: true }
      )
    }
    throw error
  }
  const entry = entries[0] || null
  const downloadUrl = String(entry?.item?.download_url || entry?.item?.downloadUrl || '').trim()
  if (!entry || !downloadUrl) {
    throw new Error(
      uiText('ui.noNexusDefaultDependencyDownloadURLWasReturnedValue', { value1: (item?.name || dependency?.name || dependency?.id || uiText('ui.unknownItem')) })
    )
  }

  const metadata = getItemMetadata(item)
  return {
    downloadUrl,
    sourceModId: firstText(entry.item?.sourceModId, item.sourceModId),
    sourceFileId: firstText(entry.item?.sourceFileId, item.sourceFileId),
    sourceModKey: firstText(entry.item?.sourceModKey, item.sourceModKey),
    name: firstText(item.name, entry.meta?.displayName, dependency?.name, entry.item?.task_name),
    version: firstText(item.version, entry.item?.version),
    metadata: {
      ...metadata,
      category: 'default_dependency',
      dependencyRole: 'default_dependency',
      isDefaultDependency: true,
      dependencyId: String(dependency?.id || '').trim(),
      dependencySource: String(dependency?.source || '').trim(),
      sourceGameDomain: firstText(metadata.sourceGameDomain, metadata.source_game_domain, getDetailSourceGameSlug(detail, item)),
      fileName: firstText(entry.item?.file_name, entry.item?.fileName, metadata.fileName, metadata.file_name),
      fileSize: toSafeNumber(entry.item?.file_size || entry.item?.fileSize || metadata.fileSize || metadata.file_size, 0)
    },
    resolvedInstallEntry: toPlainSourceModpackJson(entry, null)
  }
}

async function resolveNexusPreviewItem(item = {}, detail = {}, options = {}) {
  if (isNexusDefaultDependencyShareItem(item)) {
    return await resolveNexusDefaultDependencyPreviewItem(item, detail, options)
  }

  const { modId, fileId, domainName } = resolveNexusShareItemIdentifiers(item, detail)
  const apiConfig = options.nexusApiConfig || {}
  if (!domainName || !modId || !fileId) {
    throw new Error(uiText('ui.nexusGameModOrFileIdentifierIsMissing'))
  }

  const [modInfo, fileResponse] = await Promise.all([
    getNexusModInfo(domainName, modId, apiConfig).catch(() => ({
      modId,
      name: item?.name || `Nexus 模组-${modId}`,
      pictureUrl: getItemMetadata(item).cover || ''
    })),
    getNexusModFiles(domainName, modId, apiConfig)
  ])
  const targetFile =
    (Array.isArray(fileResponse?.files) ? fileResponse.files : []).find((file) => {
      return toSafeNumber(file?.file_id || file?.fileId || file?.id, 0) === fileId
    }) || {}
  if (options.skipNexusDownloadLinkResolve === true) {
    return buildNexusManualPreviewResolution({
      item,
      modInfo,
      targetFile,
      domainName,
      modId,
      fileId
    })
  }
  return buildNexusManualPreviewResolution({
    item,
    modInfo,
    targetFile,
    domainName,
    modId,
    fileId,
    metadata: {
      stopNexusDownloadLinkResolve: true
    }
  })
}

function resolveFicsitShareItemIdentifiers(item = {}) {
  const metadata = getItemMetadata(item)
  return {
    modReference: firstText(
      metadata.modReference,
      metadata.mod_reference,
      item.sourceModKey,
      item.sourceModId
    ),
    version: firstText(item.version, item.sourceFileId, metadata.version),
    versionId: firstText(metadata.versionId, metadata.version_id, item.sourceFileId)
  }
}

async function resolveFicsitPreviewItem(item = {}) {
  const { modReference, version, versionId } = resolveFicsitShareItemIdentifiers(item)
  if (!modReference) {
    throw new Error(uiText('ui.ficsitModIdentifierIsMissing'))
  }

  const mod = await getFicsitModVersions(modReference)
  const versions = Array.isArray(mod?.versions) ? mod.versions : []
  const targetVersion =
    versions.find((entry) => {
      return (
        (versionId && String(entry?.id || '').trim() === versionId) ||
        (version && String(entry?.version || '').trim() === version)
      )
    }) || versions[0]
  const downloadUrl = normalizeFicsitDownloadUrl(targetVersion?.link)
  if (!downloadUrl) {
    throw new Error(uiText('ui.noFicsitDownloadURLWasReturnedValue', { value1: (item?.name || modReference) }))
  }

  return {
    downloadUrl,
    name: firstText(item.name, mod?.name, modReference),
    version: firstText(targetVersion?.version, version),
    sourceFileId: firstText(item.sourceFileId, targetVersion?.id, targetVersion?.version),
    metadata: {
      ...getItemMetadata(item),
      modReference,
      versionId: String(targetVersion?.id || versionId || '').trim(),
      fileSize: toSafeNumber(targetVersion?.size, 0),
      stability: String(targetVersion?.stability || '').trim(),
      dependencies: Array.isArray(targetVersion?.dependencies) ? targetVersion.dependencies : []
    }
  }
}

async function resolvePreviewItemBySource(item = {}, detail = {}, options = {}) {
  const sourcePlatform = normalizeSourceModpackPlatform(item.sourcePlatform)
  const adapter = getSourceModpackAdapter(sourcePlatform)
  if (adapter?.resolvePreviewItem) {
    return await adapter.resolvePreviewItem(item, detail, options)
  }
  if (sourcePlatform === SOURCE_MODPACK_PLATFORMS.MODIO) {
    return await resolveModioPreviewItem(item, detail, options)
  }
  if (sourcePlatform === SOURCE_MODPACK_PLATFORMS.NEXUS) {
    return await resolveNexusPreviewItem(item, detail, options)
  }
  if (sourcePlatform === SOURCE_MODPACK_PLATFORMS.FICSIT) {
    return await resolveFicsitPreviewItem(item, detail)
  }

  const downloadUrl = resolvePreviewDownloadUrl(item, detail)
  return downloadUrl ? { downloadUrl } : null
}

export async function buildResolvedSourceModpackPreviewItems(detail = {}, options = {}) {
  const previewItems = buildSourceModpackPreviewItems(detail)
  const items = [
    ...previewItems,
    ...buildRegeneratedNexusDefaultDependencyPreviewItems(
      detail,
      options.currentNexusRule || options.nexusRule || null,
      previewItems
    )
  ]
  const resolvedItems = []
  let skipNexusDownloadLinkResolve = options.skipNexusDownloadLinkResolve === true
  for (const item of items) {
    if (item.canImport || !item.sourcePlatform || !item.sourceModKey) {
      resolvedItems.push(item)
      continue
    }

    try {
      const resolved = await resolvePreviewItemBySource(item, detail, {
        ...options,
        skipNexusDownloadLinkResolve
      })
      const downloadUrl = String(resolved?.downloadUrl || '').trim()
      const resolvedMetadata =
        resolved?.metadata && typeof resolved.metadata === 'object' ? resolved.metadata : {}
      if (resolvedMetadata.stopNexusDownloadLinkResolve === true) {
        skipNexusDownloadLinkResolve = true
      }
      if (resolved?.manualDownload) {
        resolvedItems.push({
          ...item,
          ...resolved,
          metadata: {
            ...getItemMetadata(item),
            ...resolvedMetadata
          },
          downloadUrl,
          status: resolved.status || 'manual_pending',
          reason: resolved.reason || uiText('ui.authorizeTheDownloadManuallyOnTheNexusWebsite'),
          canImport: false
        })
        continue
      }
      if (!downloadUrl) {
        resolvedItems.push(item)
        continue
      }

      resolvedItems.push({
        ...item,
        ...resolved,
        metadata: {
          ...getItemMetadata(item),
          ...resolvedMetadata
        },
        downloadUrl,
        status: 'success',
        reason: uiText('ui.readyToImport'),
        canImport: true
      })
    } catch (error) {
      resolvedItems.push({
        ...item,
        status: 'error',
        reason: String(error?.message || item.reason || uiText('ui.couldNotResolveSource')).trim(),
        errorCode: String(error?.code || '').trim(),
        canImport: false
      })
    }
  }

  return resolvedItems
}

function buildInstallSourceModKey(sourcePlatform = '', sourceGameId = '', item = {}, version = '') {
  const source = normalizeSourceModpackPlatform(sourcePlatform)
  if (source === SOURCE_MODPACK_PLATFORMS.THUNDERSTORE) {
    const fullName = resolveThunderstoreFullName(item)
    return [source, sourceGameId, fullName, version].filter(Boolean).join(':')
  }
  return String(item.sourceModKey || item.sourceModId || '').trim()
}

function resolveSourceModpackResolvedEntry(item = {}) {
  const entry =
    item?.resolvedInstallEntry && typeof item.resolvedInstallEntry === 'object'
      ? item.resolvedInstallEntry
      : null
  if (!entry?.item || !entry?.meta) {
    return null
  }
  return toPlainSourceModpackJson(entry, null)
}

export function buildSourceModpackGenericInstallEntries(previewItems = [], detail = {}, options = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const rawProfileName = String(options.profileName || options.targetProfileName || '').trim()
  const profileName = rawProfileName ? normalizeSourceModpackImportProfileName(rawProfileName) : ''
  return (Array.isArray(previewItems) ? previewItems : [])
    .filter((item) => item?.canImport)
    .map((item, index) => {
      const sortIndex = resolveItemSortIndex(item, index)
      const resolvedEntry = resolveSourceModpackResolvedEntry(item)
      if (resolvedEntry) {
        const resolvedInstallPayload =
          resolvedEntry.meta?.installPayload || resolvedEntry.installPayload || resolvedEntry.item?.installPayload || {}
        return {
          ...resolvedEntry,
          item: {
            ...(resolvedEntry.item || {}),
            showOpenInDownloadList: true
          },
          meta: {
            ...(resolvedEntry.meta || {}),
            sortIndex,
            installPayload: {
              ...resolvedInstallPayload,
              priorityOrder: sortIndex,
              ...(profileName ? { profileName, targetProfileName: profileName } : {})
            }
          }
        }
      }

      const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
      const sourcePlatform = normalizeSourceModpackPlatform(item.sourcePlatform || pack.sourceType)
      const sourceGameId = getDetailSourceGameId(detail, item)
      const sourceGameSlug = getDetailSourceGameSlug(detail, item)
      const adapter = getSourceModpackAdapter(sourcePlatform)
      if (adapter?.buildInstallEntry) {
        return adapter.buildInstallEntry(item, detail, {
          ...options,
          sourceGameId,
          sourceGameSlug
        })
      }
      const sourceModId = String(item.sourceModId || item.sourceModKey || '').trim()
      const sourceFileId = String(item.sourceFileId || item.version || '').trim()
      const sourceModKey = String(item.sourceModKey || sourceModId).trim()
      const displayName = String(item.name || sourceModKey || '外部来源模组').trim()
      const version = String(item.version || sourceFileId || '').trim()
      const downloadUrl = resolvePreviewDownloadUrl(item, detail)
      const localFilePath = String(item.localFilePath || metadata.localPath || metadata.filePath || '').trim()
      const installSourceModKey = buildInstallSourceModKey(sourcePlatform, sourceGameId, item, version)
      const thunderstoreInfo = resolveThunderstorePackageInfo(item, detail)
      const installPayload = {
        sourceType: sourcePlatform,
        sourcePlatform,
        sourceModId,
        sourceFileId,
        sourceModKey: installSourceModKey,
        sourceGameId,
        sourceGameSlug,
        name: displayName,
        modName: displayName,
        version,
        downloadUrl,
        localPath: localFilePath,
        filePath: localFilePath,
        fileSize: Number(metadata.fileSize || metadata.file_size || 0),
        manualDownload: item.manualDownload === true || metadata.manualDownload === true,
        priorityOrder: sortIndex,
        ...(profileName ? { profileName, targetProfileName: profileName } : {}),
        metadata: {
          ...metadata,
          sortIndex,
          sourceGameId,
          sourceGameSlug,
          localPath: localFilePath,
          ...(profileName ? { profileName } : {})
        },
        ...(sourcePlatform === SOURCE_MODPACK_PLATFORMS.THUNDERSTORE
          ? {
              fullName: thunderstoreInfo.fullName,
              packageFullName: thunderstoreInfo.fullName,
              packageOwner: thunderstoreInfo.namespace,
              packageName: thunderstoreInfo.packageName,
              community: thunderstoreInfo.community,
              profileName: profileName || String(metadata.profileName || '').trim()
            }
          : {})
      }
      return {
        item: {
          task_name: uiText('ui.valueModDownloadValueValue', { value1: (getSourceModpackPlatformLabel(sourcePlatform)), value2: (displayName), value3: (version ? `@${version}` : '') }),
          module: '游戏',
          file_type: resolvePreviewFileType(downloadUrl),
          download_url: downloadUrl,
          filePath: localFilePath,
          file_size: Number(metadata.fileSize || metadata.file_size || 0),
          saveType: 2,
          sourcePlatform,
          sourceType: sourcePlatform,
          sourceGameId,
          sourceGameSlug,
          sourceModId,
          sourceFileId,
          sourceModKey: installSourceModKey,
          version,
          ...(sourcePlatform === SOURCE_MODPACK_PLATFORMS.THUNDERSTORE
            ? {
                packageFullName: thunderstoreInfo.fullName
              }
            : {}),
          dedupeKey: [sourcePlatform, sourceGameId, sourceModKey, sourceFileId || version]
            .filter(Boolean)
            .join(':'),
          showOpenInDownloadList: true,
          fun: {
            type: 0
          }
        },
        meta: {
          sourcePlatform,
          sourceType: sourcePlatform,
          sourceGameId,
          sourceGameSlug,
          displayName,
          sortIndex,
          installPayload
        }
      }
    })
}
