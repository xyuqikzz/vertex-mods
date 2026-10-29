import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
const axios = createMainHttp('modio')
import {
  DEFAULT_MODIO_API_BASE_URL,
  DEFAULT_MODIO_PLATFORM,
  hasModioApiKey,
  resolveEffectiveModioApiConfig,
  resolveModioApiRequestConfig
} from '../../../shared/sources/modio-api-config.js'

const DEFAULT_BASE_URL = DEFAULT_MODIO_API_BASE_URL
const REQUEST_TIMEOUT = 60000
const DEFAULT_PLATFORM = DEFAULT_MODIO_PLATFORM

const MODIO_SORT_MAP = Object.freeze({
  updated_desc: '-date_updated',
  published_desc: '-date_live',
  downloads_desc: '-downloads',
  name_asc: 'name'
})

export { hasModioApiKey, resolveEffectiveModioApiConfig }

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function resolveSort(sort = '') {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return MODIO_SORT_MAP[key] || MODIO_SORT_MAP.updated_desc
}

function pickImageUrl(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    if (typeof candidate === 'string') {
      const text = candidate.trim()
      if (text) return text
      continue
    }

    if (candidate && typeof candidate === 'object') {
      const url = String(
        candidate.original ||
          candidate.thumb_1280x720 ||
          candidate.thumb_640x360 ||
          candidate.thumb_320x180 ||
          candidate.thumb_640x320 ||
          candidate.thumb_320x160 ||
          candidate.thumb_100x100 ||
          candidate.thumb_50x50 ||
          ''
      ).trim()
      if (url) return url
    }
  }

  return ''
}

function pickLogoOriginalUrl(logo = null) {
  if (!logo || typeof logo !== 'object') {
    return ''
  }

  return String(logo.original || '').trim()
}

function normalizeFileHash(value) {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'object') {
    return String(value.md5 || value.sha1 || value.sha256 || value.hash || '').trim()
  }

  return ''
}

function normalizePlatformList(list = []) {
  if (!Array.isArray(list)) {
    return []
  }

  return list
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim()
      }

      return String(item?.platform || item?.name || item?.os || '').trim()
    })
    .filter(Boolean)
}

function extractListPayload(data = {}) {
  if (Array.isArray(data)) {
    return {
      records: data,
      total: data.length
    }
  }

  const records = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
      ? data.results
      : []
  const total = toSafeNumber(
    data?.result_total ?? data?.total ?? data?.count ?? data?.result_count,
    records.length
  )

  return {
    records,
    total
  }
}

async function modioRequest(endpoint, config = {}, options = {}) {
  const requestConfig = resolveModioApiRequestConfig(
    resolveEffectiveModioApiConfig(config)
  )
  const apiKey = String(requestConfig.apiKey || '').trim()
  if (!apiKey) {
    throw new Error(uiText('ui.addYourOwnModIoAPIKeyInSettingsAPI'))
  }

  const baseUrl = String(requestConfig.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const response = await axios({
    url,
    method: options.method || 'GET',
    timeout: REQUEST_TIMEOUT,
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Modio-Platform':
        String(requestConfig.platform || DEFAULT_PLATFORM).trim() || DEFAULT_PLATFORM,
      ...(options.headers || {})
    },
    params: {
      api_key: apiKey,
      ...(options.params || {})
    }
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.modIoRequestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  return response?.data
}

export function hasModioEnvApiKey(config = {}) {
  return hasModioApiKey(getModioApiConfig(config))
}

export function getModioApiConfig(config = {}) {
  return resolveEffectiveModioApiConfig(config)
}

export function normalizeModioGameList(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const id = toSafeNumber(item?.id, 0)
      const nameId = String(item?.name_id || item?.nameId || '').trim()
      const name = String(item?.name || nameId || uiText('ui.modIoGameValue', { value1: (index + 1) })).trim()
      const modCount = toSafeNumber(
        item?.mods_count_total ??
          item?.modsCountTotal ??
          item?.mods_count ??
          item?.mod_count ??
          item?.modCount ??
          item?.stats?.mods_count_total ??
          item?.stats?.modsCountTotal ??
          item?.stats?.mods_count,
        0
      )

      if (!id || !name) {
        return null
      }

      return {
        id: `modio-${id}`,
        modioGameId: id,
        modioNameId: nameId,
        coverImage:
          pickLogoOriginalUrl(item?.logo) || pickImageUrl(item?.header, item?.logo, item?.icon),
        modCount,
        supportsMods: modCount > 0,
        chineseTitle: name,
        englishTitle: name,
        description: String(
          item?.summary || item?.description_plaintext || item?.description || ''
        ),
        isModio: 1,
        profileUrl: String(item?.profile_url || '').trim()
      }
    })
    .filter(Boolean)
}

export function normalizeModioModList(list = [], gameId = 0) {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const modId = toSafeNumber(item?.id, 0)
    const latestFile = item?.modfile && typeof item.modfile === 'object' ? item.modfile : {}
    const stats = item?.stats && typeof item.stats === 'object' ? item.stats : {}
    const submittedBy =
      item?.submitted_by && typeof item.submitted_by === 'object' ? item.submitted_by : {}
    const tags = Array.isArray(item?.tags)
      ? item.tags
          .map((tag) => String(tag?.name || tag?.tag || tag || '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : []

    return {
      id: modId || `modio-mod-${index}`,
      modId,
      gameId: toSafeNumber(gameId || item?.game_id, 0),
      name: String(item?.name || `未命名模组-${index + 1}`).trim(),
      summary: String(item?.summary || item?.description_plaintext || '').trim(),
      version: String(latestFile?.version || '').trim(),
      author: String(submittedBy?.username || '').trim(),
      pictureUrl: pickImageUrl(item?.logo, item?.media?.images?.[0]),
      profileUrl: String(item?.profile_url || '').trim(),
      downloads: toSafeNumber(stats?.downloads_total ?? item?.downloads, 0),
      subscribers: toSafeNumber(stats?.subscribers_total ?? item?.subscribers, 0),
      updatedAt: toSafeNumber(item?.date_updated, 0),
      tags,
      raw: item
    }
  })
}

export function normalizeModioFileList(list = [], gameId = 0, modId = 0) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const fileId = toSafeNumber(item?.id ?? item?.file_id ?? item?.fileId, 0)
      const download = item?.download && typeof item.download === 'object' ? item.download : {}
      const version = String(item?.version || '').trim()
      const filename = String(
        item?.filename || item?.file_name || item?.name || item?.display_name || ''
      ).trim()

      if (!fileId) {
        return null
      }

      return {
        id: fileId,
        fileId,
        gameId: toSafeNumber(gameId || item?.game_id || item?.gameId, 0),
        modId: toSafeNumber(modId || item?.mod_id || item?.modId, 0),
        name: filename || (version ? `版本 ${version}` : `Modio 文件-${index + 1}`),
        version,
        changelog: String(item?.changelog || '').trim(),
        filesize: toSafeNumber(item?.filesize ?? item?.file_size ?? item?.size, 0),
        filehash: normalizeFileHash(item?.filehash),
        platforms: normalizePlatformList(item?.platforms),
        downloadUrl: String(
          download?.binary_url ||
            download?.binaryUrl ||
            download?.url ||
            item?.binary_url ||
            item?.download_url ||
            ''
        ).trim(),
        dateAdded: toSafeNumber(item?.date_added ?? item?.dateAdded, 0),
        raw: item
      }
    })
    .filter(Boolean)
}

export function normalizeModioDependencyList(list = [], gameId = 0) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => {
      if (typeof item === 'number' || typeof item === 'string') {
        const primitiveModId = toSafeNumber(item, 0)
        if (!primitiveModId) {
          return null
        }

        return {
          id: primitiveModId,
          modId: primitiveModId,
          gameId: toSafeNumber(gameId, 0),
          name: `依赖模组-${primitiveModId}`,
          summary: '',
          version: '',
          profileUrl: '',
          pictureUrl: '',
          raw: item
        }
      }

      const mod =
        item?.mod && typeof item.mod === 'object'
          ? item.mod
          : item?.dependency && typeof item.dependency === 'object'
            ? item.dependency
            : item
      const latestFile = mod?.modfile && typeof mod.modfile === 'object' ? mod.modfile : {}
      const modId = toSafeNumber(
        item?.mod_id ?? item?.modId ?? item?.dependency_id ?? item?.dependencyId ?? mod?.id,
        0
      )
      const name = String(
        item?.name || item?.mod_name || item?.dependency_name || mod?.name || ''
      ).trim()

      if (!modId && !name) {
        return null
      }

      return {
        id: modId || `modio-dependency-${index}`,
        modId,
        gameId: toSafeNumber(gameId || item?.game_id || item?.gameId || mod?.game_id, 0),
        name: name || `依赖模组-${index + 1}`,
        summary: String(item?.summary || mod?.summary || mod?.description_plaintext || '').trim(),
        version: String(item?.version || latestFile?.version || '').trim(),
        profileUrl: String(item?.profile_url || mod?.profile_url || '').trim(),
        pictureUrl: pickImageUrl(item?.logo, mod?.logo, mod?.media?.images?.[0]),
        raw: item
      }
    })
    .filter(Boolean)
}

export async function getModioGameList(config = {}, options = {}) {
  const limit = Math.max(toSafeNumber(options?.limit, 100), 1)
  const offset = Math.max(toSafeNumber(options?.offset, 0), 0)
  const data = await modioRequest('/games', config, {
    params: {
      _limit: limit,
      _offset: offset,
      _sort: '-mods_count_total'
    }
  })
  const payload = extractListPayload(data)

  return {
    records: normalizeModioGameList(payload.records),
    total: payload.total,
    limit,
    offset
  }
}

export async function getModioModList(gameId, config = {}, params = {}) {
  const safeGameId = toSafeNumber(gameId, 0)
  if (safeGameId <= 0) {
    throw new Error(uiText('ui.invalidModIoGameID'))
  }

  const page = Math.max(toSafeNumber(params?.page, 1), 1)
  const limit = Math.max(toSafeNumber(params?.limit, 20), 1)
  const offset = (page - 1) * limit
  const keyword = String(params?.keyword || '').trim()
  const requestParams = {
    _limit: limit,
    _offset: offset,
    _sort: resolveSort(params?.sort)
  }

  if (keyword) {
    requestParams._q = keyword
  }

  const data = await modioRequest(`/games/${encodeURIComponent(safeGameId)}/mods`, config, {
    params: requestParams
  })
  const payload = extractListPayload(data)
  const total = Math.max(toSafeNumber(payload.total, payload.records.length), 0)

  return {
    records: normalizeModioModList(payload.records, safeGameId),
    total,
    pages: Math.max(Math.ceil(total / limit), 1),
    current: page,
    limit
  }
}

export async function getModioModFiles(gameId, modId, config = {}, params = {}) {
  const safeGameId = toSafeNumber(gameId, 0)
  const safeModId = toSafeNumber(modId, 0)
  if (safeGameId <= 0 || safeModId <= 0) {
    throw new Error(uiText('ui.invalidModIoGameIDOrModID'))
  }

  const limit = Math.max(toSafeNumber(params?.limit, 100), 1)
  const offset = Math.max(toSafeNumber(params?.offset, 0), 0)
  const data = await modioRequest(
    `/games/${encodeURIComponent(safeGameId)}/mods/${encodeURIComponent(safeModId)}/files`,
    config,
    {
      params: {
        _limit: limit,
        _offset: offset
      }
    }
  )
  const payload = extractListPayload(data)

  return {
    records: normalizeModioFileList(payload.records, safeGameId, safeModId),
    total: payload.total,
    limit,
    offset
  }
}

export async function getModioModFile(gameId, modId, fileId, config = {}) {
  const safeGameId = toSafeNumber(gameId, 0)
  const safeModId = toSafeNumber(modId, 0)
  const safeFileId = toSafeNumber(fileId, 0)
  if (safeGameId <= 0 || safeModId <= 0 || safeFileId <= 0) {
    throw new Error(uiText('ui.invalidModIoGameIDModIDOrFileID'))
  }

  const data = await modioRequest(
    `/games/${encodeURIComponent(safeGameId)}/mods/${encodeURIComponent(safeModId)}/files/${encodeURIComponent(safeFileId)}`,
    config
  )
  const normalized = normalizeModioFileList([data], safeGameId, safeModId)
  return normalized[0] || null
}

export async function getModioModDependencies(gameId, modId, config = {}) {
  const safeGameId = toSafeNumber(gameId, 0)
  const safeModId = toSafeNumber(modId, 0)
  if (safeGameId <= 0 || safeModId <= 0) {
    throw new Error(uiText('ui.invalidModIoGameIDOrModID'))
  }

  const data = await modioRequest(
    `/games/${encodeURIComponent(safeGameId)}/mods/${encodeURIComponent(safeModId)}/dependencies`,
    config
  )
  const payload = extractListPayload(data)

  return {
    records: normalizeModioDependencyList(payload.records, safeGameId),
    total: payload.total
  }
}
