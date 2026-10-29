import { assertSourceCapability } from '../../../shared/sources/source-platform-registry.js'
import { classifyAiAgentError } from '../../../shared/ai/conversation/ai-agent-error.js'
import axios from 'axios'
import { nexusAccount } from '../nexus/account.js'
import { createNexusDownloadService } from '../nexus/downloadService.js'
import store from '../../storage/store/index.js'
import { normalizeModRecord } from './normalizeModRecord.js'
import {
  buildModSourceRequestCacheKey,
  runCachedModSourceRequest
} from './requestCoordinator.js'
import {
  resolveEffectiveModioApiConfig,
  resolveModioApiRequestConfig
} from '../../../shared/sources/modio-api-config.js'
import {
  isNexusRequirementRawExternal,
  resolveNexusRequirementExternalFlag,
  resolveNexusRequirementModId
} from '../../../shared/sources/nexus-requirement-normalizer.js'
import {
  normalizeSourcePlatform,
  resolveSourcePlatformLabel
} from '../../../shared/sources/source-platform-registry.js'
import {
  browseVamHubPackages,
  getVamHubPackageDetail
} from '../../ipc/game/vamhub.js'
import {
  normalizeVamHubRecord,
  resolveVamHubPackageIdentifier
} from './vamhubAdapter.js'

const REQUEST_TIMEOUT = 60000
const DEFAULT_LIMIT = 8
const NEXUS_BASE_URL = 'https://api.nexusmods.com/v1'
const NEXUS_GRAPHQL_URL = 'https://api.nexusmods.com/v2/graphql'
const FICSIT_GRAPHQL_ENDPOINT = 'https://api.ficsit.app/v2/query'
const THUNDERSTORE_BASE_URL = 'https://thunderstore.io'
const NEXUS_MOD_FILE_CATEGORY_ID = Object.freeze({
  MAIN: 1,
  UPDATE: 2,
  OPTIONAL: 3,
  OLD_VERSION: 4,
  MISCELLANEOUS: 5,
  DELETED: 6,
  ARCHIVED: 7
})

const FICSIT_SORT_MAP = Object.freeze({
  popularity_desc: { orderBy: 'popularity', order: 'desc' },
  downloads_desc: { orderBy: 'downloads', order: 'desc' },
  updated_desc: { orderBy: 'updated_at', order: 'desc' },
  created_desc: { orderBy: 'created_at', order: 'desc' },
  name_asc: { orderBy: 'name', order: 'asc' }
})

const THUNDERSTORE_ORDERING_MAP = Object.freeze({
  rating_desc: 'top-rated',
  top_rated: 'top-rated',
  'top-rated': 'top-rated',
  downloads_desc: 'most-downloaded',
  downloads: 'most-downloaded',
  '-downloads': 'most-downloaded',
  download_count: 'most-downloaded',
  '-download_count': 'most-downloaded',
  most_downloaded: 'most-downloaded',
  'most-downloaded': 'most-downloaded',
  updated_desc: 'last-updated',
  last_updated: 'last-updated',
  'last-updated': 'last-updated',
  created_desc: 'newest',
  newest: 'newest'
})

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

// 保留 HTTP 状态和来源，错误分类才能区分认证失败、权限不足和服务不可用。
function createSourceHttpError(message = '', status = 0, source = '') {
  return Object.assign(new Error(message), {
    status: Number(status) || 0,
    vertexErrorSource: source
  })
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function getEnvValue(key = '') {
  const metaEnv = import.meta.env && typeof import.meta.env === 'object' ? import.meta.env : {}
  return toSafeText(process.env?.[key] || metaEnv[key])
}

function normalizeSource(value = '') {
  return normalizeSourcePlatform(value)
}

function resolveSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source, '未知来源')
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveSearchSource(payload = {}) {
  return normalizeSource(
    payload?.source || payload?.context?.page?.source || payload?.context?.game?.source
  )
}

function resolveKeyword(payload = {}) {
  return pickFirstText(
    payload?.keyword,
    payload?.q,
    payload?.message,
    payload?.context?.search?.keyword
  )
}

function resolveLimit(payload = {}) {
  const limit = toSafeNumber(payload?.limit, DEFAULT_LIMIT)
  return Math.max(1, Math.min(20, Math.trunc(limit)))
}

function resolvePage(payload = {}) {
  const page = toSafeNumber(payload?.page, 1)
  return Math.max(1, Math.trunc(page))
}

function createUnavailableResult(options = {}) {
  const source = normalizeSource(options.source)
  return {
    success: false,
    source,
    sourceLabel: resolveSourceLabel(source),
    keyword: toSafeText(options.keyword),
    records: [],
    total: 0,
    page: resolvePage(options),
    limit: resolveLimit(options),
    errorCode: toSafeText(options.errorCode || 'source_unavailable'),
    error: options.error,
    message: toSafeText(options.message || '当前来源暂不可搜索。')
  }
}

function createSearchResult(options = {}) {
  const source = normalizeSource(options.source)
  const records = (Array.isArray(options.records) ? options.records : [])
    .map((record) =>
      normalizeModRecord(record, {
        source,
        sourceLabel: resolveSourceLabel(source),
        community: options.community,
        domainName: options.domainName,
        gameId: options.gameId
      })
    )
    .filter(Boolean)
    .slice(0, resolveLimit(options))

  return {
    success: true,
    source,
    sourceLabel: resolveSourceLabel(source),
    keyword: toSafeText(options.keyword),
    records,
    total: toSafeNumber(options.total, records.length),
    page: resolvePage(options),
    limit: resolveLimit(options),
    message: toSafeText(options.message)
  }
}

function normalizeGameDomainName(value = '') {
  return toSafeText(value).replace(/^\/+|\/+$/g, '')
}

function parseNexusModPageLink(value = '') {
  const rawUrl = toSafeText(value)
  if (!rawUrl) {
    return {
      isNexusModLink: false,
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }

  try {
    const url = new URL(rawUrl)
    const hostname = toSafeText(url.hostname).toLowerCase()
    const isNexusHost =
      hostname === 'nexusmods.com' ||
      hostname === 'www.nexusmods.com' ||
      hostname === 'next.nexusmods.com'
    const pathMatch = url.pathname.match(/^\/([^/]+)\/mods\/(\d+)(?:\/|$)/i)

    if (!isNexusHost || !pathMatch) {
      return {
        isNexusModLink: false,
        domainName: '',
        modId: 0,
        fileId: 0
      }
    }

    const fileId = toSafeNumber(
      url.searchParams.get('file_id') || url.searchParams.get('fileId'),
      0
    )

    return {
      isNexusModLink: true,
      domainName: normalizeGameDomainName(pathMatch[1]),
      modId: toSafeNumber(pathMatch[2], 0),
      fileId: fileId > 0 ? fileId : 0
    }
  } catch {
    return {
      isNexusModLink: false,
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }
}

function isUsableNexusFile(file = {}) {
  const categoryName = toSafeText(file?.category_name || file?.categoryName).toUpperCase()
  const categoryId = toSafeNumber(file?.category_id || file?.categoryId, 0)
  return categoryName !== 'DELETED' && categoryId !== NEXUS_MOD_FILE_CATEGORY_ID.DELETED
}

function resolveNexusFileCategoryPriority(file = {}) {
  const categoryName = toSafeText(file?.category_name || file?.categoryName).toUpperCase()
  const categoryId = toSafeNumber(file?.category_id || file?.categoryId, 0)

  if (categoryName === 'MAIN' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MAIN) {
    return 0
  }
  if (categoryName === 'UPDATE' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.UPDATE) {
    return 1
  }
  if (categoryName === 'OPTIONAL' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OPTIONAL) {
    return 2
  }
  if (
    categoryName === 'MISCELLANEOUS' ||
    categoryName === 'MISC' ||
    categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MISCELLANEOUS
  ) {
    return 3
  }
  if (categoryName === 'OLD_VERSION' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION) {
    return 4
  }

  return 5
}

function isLikelyDeveloperNexusFile(file = {}) {
  const fileName = toSafeText(file?.name || file?.file_name).toLowerCase()
  if (!fileName) {
    return false
  }
  return (
    fileName.includes('for developers') ||
    fileName.includes('developer') ||
    fileName.includes('strict mode')
  )
}

function resolvePreferredNexusFile(files = []) {
  const safeFiles = (Array.isArray(files) ? files : []).filter((item) => isUsableNexusFile(item) &&
    !/(?:^|[\s._-])(?:alpha|beta|rc|preview|pre-release|prerelease|nightly)(?:[\s._\d-]|$)/i.test(`${item.version || ''} ${item.name || item.file_name || ''}`) &&
    resolveNexusFileCategoryPriority(item) < 4)
  if (!safeFiles.length) {
    return null
  }

  const sortedFiles = [...safeFiles].sort((left, right) => {
    const categoryGap =
      resolveNexusFileCategoryPriority(left) - resolveNexusFileCategoryPriority(right)
    if (categoryGap !== 0) {
      return categoryGap
    }

    const developerGap =
      Number(isLikelyDeveloperNexusFile(left)) - Number(isLikelyDeveloperNexusFile(right))
    if (developerGap !== 0) {
      return developerGap
    }

    const uploadedGap =
      toSafeNumber(right?.uploaded_timestamp || right?.uploadedTimestamp, 0) -
      toSafeNumber(left?.uploaded_timestamp || left?.uploadedTimestamp, 0)
    if (uploadedGap !== 0) {
      return uploadedGap
    }

    const primaryGap =
      toSafeNumber(right?.is_primary || right?.isPrimary, 0) -
      toSafeNumber(left?.is_primary || left?.isPrimary, 0)
    if (primaryGap !== 0) {
      return primaryGap
    }

    return (
      toSafeNumber(right?.file_id || right?.fileId, 0) -
      toSafeNumber(left?.file_id || left?.fileId, 0)
    )
  })

  return sortedFiles[0] || null
}

function resolveNexusConfig() {
  const status = nexusAccount.snapshot()
  return { available: status.available,
    revision: status.revision }
}

async function nexusGraphQLRequest(query, variables, config = {}) {
  const cacheKey = buildModSourceRequestCacheKey('nexus', 'graphql', { query, variables, revision: config.revision })
  return await runCachedModSourceRequest({ source: 'nexus', cacheKey }, async () => {
    const response = await nexusAccount.request({
      url: NEXUS_GRAPHQL_URL,
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      data: {
        query,
        variables
      }
    })

    if (Number(response?.status) !== 200) {
      throw createSourceHttpError(`Nexus GraphQL 请求失败，HTTP 状态码：${response?.status}`, response?.status, 'nexus')
    }
    if (Array.isArray(response?.data?.errors) && response.data.errors.length) {
      throw new Error(`Nexus GraphQL 错误：${response.data.errors[0]?.message || '未知错误'}`)
    }

    return response?.data?.data
  })
}

async function nexusRestRequest(endpoint, config = {}) {
  const normalizedEndpoint = `${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const cacheKey = buildModSourceRequestCacheKey('nexus', 'rest', { endpoint: normalizedEndpoint, revision: config.revision })
  const cacheable = !/\/download_link\.json/i.test(normalizedEndpoint)

  return await runCachedModSourceRequest({ source: 'nexus', cacheKey, cacheable }, async () => {
    const response = await nexusAccount.request({
      url: `${NEXUS_BASE_URL}${normalizedEndpoint}`,
      method: 'GET',
      timeout: REQUEST_TIMEOUT
    })

    if (Number(response?.status) !== 200) {
      throw createSourceHttpError(`Nexus 请求失败，HTTP 状态码：${response?.status}`, response?.status, 'nexus')
    }

    return response?.data
  })
}

export const exchangeNexusDownloadLink = createNexusDownloadService(nexusAccount)

async function searchNexusMods(payload = {}) {
  const keyword = resolveKeyword(payload)
  const domainName = normalizeGameDomainName(
    pickFirstText(
      payload?.domainName,
      payload?.gameDomainName,
      payload?.nexusGameDomain,
      payload?.context?.game?.domainName,
      payload?.context?.game?.gameDomainName,
      payload?.context?.game?.nexusGameDomain,
      payload?.context?.game?.sourceSlug,
      payload?.context?.route?.query?.domainName,
      payload?.context?.route?.query?.gameDomainName,
      payload?.context?.route?.query?.nexusGameDomain,
      payload?.context?.page?.source === 'nexus' ? payload?.context?.route?.params?.id : ''
    )
  )
  const config = resolveNexusConfig()
  const page = resolvePage(payload)
  const limit = resolveLimit(payload)

  if (!domainName) {
    return createUnavailableResult({
      source: 'nexus',
      keyword,
      page,
      limit,
      errorCode: 'need_game_context',
      message: '缺少 Nexus 游戏标识，无法搜索当前来源。'
    })
  }
  if (!config.available) {
    return createUnavailableResult({
      source: 'nexus',
      keyword,
      page,
      limit,
      errorCode: 'need_api_key',
      message: 'Nexus API Key 未配置，无法搜索 Nexus。'
    })
  }

  const query = `
    query ModsListing(
      $count: Int
      $facets: ModsFacet
      $filter: ModsFilter
      $offset: Int
      $postFilter: ModsFilter
      $sort: [ModsSort!]
    ) {
      mods(
        count: $count
        facets: $facets
        filter: $filter
        offset: $offset
        postFilter: $postFilter
        sort: $sort
        viewUserBlockedContent: false
      ) {
        totalCount
        nodes {
          createdAt
          downloads
          endorsements
          game { domainName id name }
          modId
          name
          summary
          thumbnailUrl
          thumbnailBlurredUrl
          updatedAt
          uploader { name }
        }
      }
    }
  `
  const variables = {
    count: limit,
    offset: (page - 1) * limit,
    facets: {
      categoryName: [],
      languageName: [],
      tag: []
    },
    filter: {
      filter: [],
      gameDomainName: [
        {
          op: 'EQUALS',
          value: domainName
        }
      ],
      name: keyword
        ? keyword
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => ({ op: 'WILDCARD', value: word }))
        : []
    },
    postFilter: {},
    sort: [{ downloads: { direction: 'DESC' } }]
  }
  const data = await nexusGraphQLRequest(query, variables, config)
  const nodes = Array.isArray(data?.mods?.nodes) ? data.mods.nodes : []
  const records = nodes.map((node) => ({
    source: 'nexus',
    id: node?.modId,
    modId: node?.modId,
    domainName,
    name: node?.name,
    summary: node?.summary,
    author: node?.uploader?.name,
    pictureUrl: node?.thumbnailUrl || node?.thumbnailBlurredUrl,
    downloads: node?.downloads,
    updatedAt: node?.updatedAt,
    profileUrl: `https://www.nexusmods.com/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(node?.modId || '')}`
  }))

  return createSearchResult({
    source: 'nexus',
    keyword,
    page,
    limit,
    domainName,
    records,
    total: toSafeNumber(data?.mods?.totalCount, records.length)
  })
}

export async function getNexusModRequirements(payload = {}) {
  const domainName = normalizeGameDomainName(
    pickFirstText(
      payload?.domainName,
      payload?.gameDomainName,
      payload?.nexusGameDomain,
      payload?.context?.game?.domainName,
      payload?.context?.game?.gameDomainName,
      payload?.context?.game?.nexusGameDomain,
      payload?.context?.game?.sourceSlug,
      payload?.context?.route?.query?.domainName,
      payload?.context?.route?.query?.gameDomainName,
      payload?.context?.route?.query?.nexusGameDomain,
      payload?.context?.page?.source === 'nexus' ? payload?.context?.route?.params?.id : ''
    )
  )
  const modId = toSafeNumber(pickFirstText(payload?.modId, payload?.mod_id, payload?.id), 0)

  if (!domainName || !modId) {
    return {
      success: false,
      source: 'nexus',
      domainName,
      modId,
      dependencies: [],
      nexusDependencies: [],
      externalDependencies: [],
      dlcRequirements: [],
      totalCount: 0,
      message: '缺少 Nexus 游戏标识或模组 ID。'
    }
  }

  const config = resolveNexusConfig()
  if (!config.available) {
    throw new Error('Nexus API Key 未配置')
  }

  const requestCount = toSafeNumber(payload?.count, 100)
  const count = Math.max(1, Math.min(100, requestCount || 100))
  const query = `
    query GetModRequirements($ids: [CompositeDomainWithIdInput!]!, $count: Int) {
      legacyModsByDomain(ids: $ids, count: 1) {
        nodes {
          modId
          name
          modRequirements {
            nexusRequirements(count: $count) {
              totalCount
              nodes {
                id
                modId
                modName
                url
                notes
                externalRequirement
                gameId
              }
            }
            dlcRequirements {
              notes
              gameExpansion {
                id
                name
              }
            }
          }
        }
      }
    }
  `
  const variables = {
    ids: [
      {
        gameDomain: domainName,
        modId
      }
    ],
    count
  }
  const data = await nexusGraphQLRequest(query, variables, config)
  const mod = Array.isArray(data?.legacyModsByDomain?.nodes)
    ? data.legacyModsByDomain.nodes[0]
    : null
  const nexusRequirementData = mod?.modRequirements?.nexusRequirements || {}
  const requirementNodes = Array.isArray(nexusRequirementData?.nodes)
    ? nexusRequirementData.nodes
    : []
  const dlcRequirementNodes = Array.isArray(mod?.modRequirements?.dlcRequirements)
    ? mod.modRequirements.dlcRequirements
    : []
  const dependencies = requirementNodes.map((item) => {
    const linkMeta = parseNexusModPageLink(item?.url)
    const rawExternalRequirement = isNexusRequirementRawExternal(item)
    const resolvedModId = resolveNexusRequirementModId(item, linkMeta)
    const externalRequirement = resolveNexusRequirementExternalFlag(item, resolvedModId, linkMeta)

    return {
      source: 'nexus',
      id: toSafeText(item?.id),
      modId: resolvedModId,
      name: toSafeText(item?.modName),
      url: toSafeText(item?.url),
      notes: toSafeText(item?.notes),
      gameId: toSafeNumber(item?.gameId, 0),
      fileId: linkMeta.fileId,
      domainName: linkMeta.domainName || domainName,
      externalRequirement,
      rawExternalRequirement,
      sourceType: externalRequirement ? 'external' : 'nexus'
    }
  })
  const nexusDependencies = dependencies.filter((item) => item.sourceType === 'nexus')
  const externalDependencies = dependencies.filter((item) => item.sourceType === 'external')
  const dlcRequirements = dlcRequirementNodes.map((item) => ({
    id: toSafeText(item?.gameExpansion?.id),
    name: toSafeText(item?.gameExpansion?.name),
    notes: toSafeText(item?.notes)
  }))

  return {
    success: true,
    source: 'nexus',
    domainName,
    modId,
    modName: toSafeText(mod?.name),
    totalCount: toSafeNumber(nexusRequirementData?.totalCount, dependencies.length),
    dependencies,
    nexusDependencies,
    externalDependencies,
    dlcRequirements,
    raw: mod || null
  }
}

function resolveModioConfig(payload = {}) {
  const settings = store.get('systemConfig.settings') || {}
  const localConfig =
    settings.modioApi && typeof settings.modioApi === 'object' ? settings.modioApi : {}
  const payloadConfig = payload?.config && typeof payload.config === 'object' ? payload.config : {}
  return resolveEffectiveModioApiConfig(localConfig, payloadConfig)
}

async function modioRequest(endpoint, config = {}, options = {}) {
  const requestConfig = resolveModioApiRequestConfig(config)
  if (!requestConfig.apiKey) {
    throw new Error('请在设置 → API配置中填写自己的 Mod.io API Key')
  }

  const method = toSafeText(options.method || 'GET').toUpperCase()
  const normalizedEndpoint = `${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const requestOptions = { ...options }
  delete requestOptions.cacheable
  delete requestOptions.cacheTtlMs
  delete requestOptions.method

  const params = {
    api_key: requestConfig.apiKey,
    ...(options.params || {})
  }
  const cacheKey = buildModSourceRequestCacheKey('modio', 'rest', {
    baseUrl: requestConfig.baseUrl,
    endpoint: normalizedEndpoint,
    method,
    params,
    platform: toSafeText(requestConfig.platform, 'windows')
  })
  const cacheable = method === 'GET' && options.cacheable !== false

  return await runCachedModSourceRequest(
    {
      source: 'modio',
      cacheKey,
      cacheable,
      ttlMs: options.cacheTtlMs
    },
    async () => {
      const response = await axios({
        url: `${requestConfig.baseUrl.replace(/\/+$/, '')}${normalizedEndpoint}`,
        timeout: REQUEST_TIMEOUT,
        ...requestOptions,
        method,
        headers: {
          Accept: 'application/json',
          'X-Modio-Platform': toSafeText(requestConfig.platform, 'windows'),
          ...(options.headers || {})
        },
        params
      })

      if (Number(response?.status) !== 200) {
        throw createSourceHttpError(`Modio 请求失败，HTTP 状态码：${response?.status}`, response?.status, 'modio')
      }

      return response?.data
    }
  )
}

function extractListPayload(data = {}) {
  const records = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : []
  return {
    records,
    total: toSafeNumber(data?.result_total ?? data?.total ?? data?.count, records.length)
  }
}

async function searchModioMods(payload = {}) {
  const keyword = resolveKeyword(payload)
  const gameId = toSafeNumber(
    pickFirstText(
      payload?.gameId,
      payload?.modioGameId,
      payload?.context?.game?.sourceGameId,
      payload?.context?.route?.query?.sourceGameId,
      payload?.context?.route?.query?.modioGameId,
      payload?.context?.game?.id
    ),
    0
  )
  const page = resolvePage(payload)
  const limit = resolveLimit(payload)
  const config = resolveModioConfig(payload)

  if (!gameId) {
    return createUnavailableResult({
      source: 'modio',
      keyword,
      page,
      limit,
      errorCode: 'need_game_context',
      message: '缺少 Mod.io 游戏 ID，无法搜索当前来源。'
    })
  }
  if (!config.apiKey) {
    return createUnavailableResult({
      source: 'modio',
      keyword,
      page,
      limit,
      errorCode: 'need_api_key',
      message: 'Mod.io API Key 未配置，无法搜索 Mod.io。'
    })
  }

  const data = await modioRequest(`/games/${encodeURIComponent(gameId)}/mods`, config, {
    params: {
      _limit: limit,
      _offset: (page - 1) * limit,
      _sort: '-downloads',
      ...(keyword ? { _q: keyword } : {})
    }
  })
  const payloadData = extractListPayload(data)

  return createSearchResult({
    source: 'modio',
    keyword,
    page,
    limit,
    gameId,
    records: payloadData.records.map((record) => {
      const stats = record?.stats && typeof record.stats === 'object' ? record.stats : {}
      const submittedBy =
        record?.submitted_by && typeof record.submitted_by === 'object' ? record.submitted_by : {}
      const latestFile = record?.modfile && typeof record.modfile === 'object' ? record.modfile : {}
      return {
        source: 'modio',
        id: record?.id,
        modId: record?.id,
        gameId,
        name: record?.name,
        summary: record?.summary || record?.description_plaintext,
        version: latestFile?.version,
        author: submittedBy?.username,
        pictureUrl: record?.logo?.thumb_640x360 || record?.logo?.original,
        profileUrl: record?.profile_url,
        downloads: stats?.downloads_total,
        updatedAt: record?.date_updated
      }
    }),
    total: payloadData.total
  })
}

function resolveFicsitSort(sort = '') {
  const key = toSafeText(sort || 'popularity_desc').toLowerCase()
  return FICSIT_SORT_MAP[key] || FICSIT_SORT_MAP.popularity_desc
}

export function resolveThunderstoreOrdering(ordering = '') {
  const key = toSafeText(ordering || 'most-downloaded').toLowerCase()
  return THUNDERSTORE_ORDERING_MAP[key] || THUNDERSTORE_ORDERING_MAP['most-downloaded']
}

function resolveGraphQLErrorMessage(data = {}, fallbackText = '接口请求失败') {
  const errors = Array.isArray(data?.errors) ? data.errors : []
  return toSafeText(errors?.[0]?.message, fallbackText)
}

async function ficsitGraphQLRequest(payload = {}) {
  const cacheKey = buildModSourceRequestCacheKey('ficsit', 'graphql', payload)
  return await runCachedModSourceRequest({ source: 'ficsit', cacheKey }, async () => {
    const response = await axios.post(FICSIT_GRAPHQL_ENDPOINT, payload, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (Number(response?.status) !== 200) {
      throw createSourceHttpError(`Ficsit 接口请求失败，HTTP 状态码：${response?.status}`, response?.status, 'ficsit')
    }
    const data = response?.data && typeof response.data === 'object' ? response.data : {}
    if (Array.isArray(data?.errors) && data.errors.length) {
      throw new Error(resolveGraphQLErrorMessage(data, 'Ficsit 接口请求失败'))
    }

    return data?.data
  })
}

async function searchFicsitMods(payload = {}) {
  const keyword = resolveKeyword(payload)
  const page = resolvePage(payload)
  const limit = resolveLimit(payload)
  const offset = (page - 1) * limit
  const { orderBy, order } = resolveFicsitSort(payload?.sort || payload?.context?.search?.sort)
  const data = await ficsitGraphQLRequest({
    operationName: 'GetFicsitMods',
    query:
      'query GetFicsitMods($limit: Int!, $offset: Int!, $search: String, $orderBy: ModFields, $order: Order) { getMods(filter: { limit: $limit, offset: $offset, search: $search, order_by: $orderBy, order: $order }) { count mods { id mod_reference name short_description full_description logo downloads views popularity updated_at created_at latestVersions { release { version link created_at } beta { version link created_at } alpha { version link created_at } } } } }',
    variables: {
      limit,
      offset,
      search: keyword || null,
      orderBy,
      order
    }
  })
  const result = data?.getMods && typeof data.getMods === 'object' ? data.getMods : {}
  const records = Array.isArray(result?.mods) ? result.mods : []

  return createSearchResult({
    source: 'ficsit',
    keyword,
    page,
    limit,
    records,
    total: toSafeNumber(result?.count, records.length)
  })
}

function normalizeCommunityIdentifier(community = '') {
  const raw = toSafeText(community)
  if (!raw) return ''

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const parts = url.pathname.split('/').filter(Boolean)
      const cIndex = parts.findIndex((part) => part.toLowerCase() === 'c')
      if (cIndex >= 0 && parts[cIndex + 1]) {
        return decodeURIComponent(parts[cIndex + 1])
          .trim()
          .toLowerCase()
      }
      return decodeURIComponent(parts[0] || '')
        .trim()
        .toLowerCase()
    } catch {
      return ''
    }
  }

  const segments = raw
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
  if (segments.length >= 2 && segments[0].toLowerCase() === 'c') {
    return decodeURIComponent(segments[1]).trim().toLowerCase()
  }
  return decodeURIComponent(segments[segments.length - 1] || '')
    .trim()
    .toLowerCase()
}

function resolveThunderstoreBaseUrl() {
  return pickFirstText(getEnvValue('VITE_THUNDERSTORE_BASE_URL'), THUNDERSTORE_BASE_URL).replace(
    /\/+$/,
    ''
  )
}

async function thunderstoreGet(endpoint, options = {}) {
  const normalizedEndpoint = `${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const params = options.params || {}
  const requestOptions = { ...options }
  delete requestOptions.cacheable
  delete requestOptions.cacheTtlMs
  const cacheKey = buildModSourceRequestCacheKey('thunderstore', 'get', {
    baseUrl: resolveThunderstoreBaseUrl(),
    endpoint: normalizedEndpoint,
    params
  })

  return await runCachedModSourceRequest(
    {
      source: 'thunderstore',
      cacheKey,
      cacheable: options.cacheable !== false,
      ttlMs: options.cacheTtlMs
    },
    async () => {
      const response = await axios.get(`${resolveThunderstoreBaseUrl()}${normalizedEndpoint}`, {
        timeout: REQUEST_TIMEOUT,
        ...requestOptions,
        params
      })

      if (Number(response?.status) !== 200) {
        throw createSourceHttpError(`Thunderstore 请求失败，HTTP 状态码：${response?.status}`, response?.status, 'thunderstore')
      }

      return response?.data && typeof response.data === 'object' ? response.data : {}
    }
  )
}

function parseThunderstorePackageFullName(fullName = '') {
  const raw = toSafeText(fullName)
  if (!raw) {
    return {
      namespace: '',
      packageName: '',
      fullName: ''
    }
  }

  const matched = raw.match(/^([^-\s]+)-(.+)$/)
  if (!matched) {
    return {
      namespace: '',
      packageName: raw,
      fullName: raw
    }
  }

  return {
    namespace: toSafeText(matched[1]),
    packageName: toSafeText(matched[2]),
    fullName: raw
  }
}

async function searchThunderstoreMods(payload = {}) {
  const keyword = resolveKeyword(payload)
  const page = resolvePage(payload)
  const limit = resolveLimit(payload)
  const community = normalizeCommunityIdentifier(
    pickFirstText(
      payload?.community,
      payload?.context?.route?.query?.community,
      payload?.context?.route?.query?.sourceSlug,
      payload?.context?.game?.sourceGameId,
      payload?.context?.game?.sourceSlug,
      payload?.context?.game?.id
    )
  )

  if (!community) {
    return createUnavailableResult({
      source: 'thunderstore',
      keyword,
      page,
      limit,
      errorCode: 'need_community',
      message: '缺少 Thunderstore 社区标识，无法搜索当前来源。'
    })
  }

  const data = await thunderstoreGet(`/api/cyberstorm/listing/${encodeURIComponent(community)}/`, {
    params: {
      page,
      ...(keyword ? { q: keyword } : {}),
      ordering: resolveThunderstoreOrdering(payload?.ordering || payload?.sort),
      deprecated: false,
      nsfw: false
    }
  })
  const records = Array.isArray(data?.results) ? data.results : []

  return createSearchResult({
    source: 'thunderstore',
    keyword,
    page,
    limit,
    community,
    records: records.map((record) => ({
      ...record,
      source: 'thunderstore',
      community,
      profileUrl: `${resolveThunderstoreBaseUrl()}/c/${encodeURIComponent(community)}/p/${encodeURIComponent(record?.namespace || '')}/${encodeURIComponent(record?.name || '')}/`
    })),
    total: toSafeNumber(data?.count, records.length)
  })
}

async function searchVamHubMods(payload = {}) {
  const keyword = resolveKeyword(payload)
  const page = resolvePage(payload)
  const limit = resolveLimit(payload)
  const result = await browseVamHubPackages({
    search: keyword,
    keyword,
    page,
    pageSize: limit,
    sort: payload?.sort || payload?.context?.search?.sort,
    pricing: payload?.pricing || payload?.context?.search?.filters?.pricing,
    resourceType: payload?.resourceType || payload?.context?.search?.filters?.resourceType
  })
  const pagination = result?.pagination && typeof result.pagination === 'object' ? result.pagination : {}
  const records = Array.isArray(result?.resources) ? result.resources : []

  return createSearchResult({
    source: 'vamhub',
    keyword,
    page,
    limit,
    records: records.map((record) => normalizeVamHubRecord(record)),
    total: toSafeNumber(pagination.total_found, records.length)
  })
}

async function getVamHubDetail(payload = {}) {
  const packageName = resolveVamHubPackageIdentifier(payload)
  if (!packageName) return null
  const detail = await getVamHubPackageDetail({ packageName })
  return normalizeVamHubRecord(detail)
}

function normalizeServiceError(error = null, source = '') {
  return classifyAiAgentError(error, { source: source || error?.vertexErrorSource || 'mod_source' }).message
}

export async function searchModSource(payload = {}) {
  const safePayload = toPlainJson(payload, {})
  const source = resolveSearchSource(safePayload)
  const keyword = resolveKeyword(safePayload)
  const capability = assertSourceCapability(source, 'search')
  if (!capability.ok) return createUnavailableResult({ ...capability, keyword })

  if (!source) {
    return createUnavailableResult({
      source,
      keyword,
      errorCode: 'need_source',
      message: '缺少模组来源，无法确定搜索目标。'
    })
  }

  try {
    if (source === 'nexus') return await searchNexusMods(safePayload)
    if (source === 'modio') return await searchModioMods(safePayload)
    if (source === 'ficsit') return await searchFicsitMods(safePayload)
    if (source === 'thunderstore') return await searchThunderstoreMods(safePayload)
    if (source === 'vamhub') return await searchVamHubMods(safePayload)

    return createUnavailableResult({
      source,
      keyword,
      errorCode: 'unsupported_source',
      message: `${resolveSourceLabel(source)} 暂未接入 AI 来源搜索。`
    })
  } catch (error) {
    return createUnavailableResult({
      source,
      keyword,
      page: resolvePage(safePayload),
      limit: resolveLimit(safePayload),
      errorCode: 'request_failed',
      error: classifyAiAgentError(error, { source }),
      message: normalizeServiceError(error, source)
    })
  }
}

async function getFicsitDetail(payload = {}) {
  const modReference = pickFirstText(
    payload?.modReference,
    payload?.mod_reference,
    payload?.modId,
    payload?.id
  )
  if (!modReference) return null

  const data = await ficsitGraphQLRequest({
    operationName: 'GetFicsitModByReference',
    query:
      'query GetFicsitModByReference($modReference: ModReference!) { getModByReference(modReference: $modReference) { id mod_reference name short_description full_description logo downloads views popularity updated_at created_at latestVersions { release { version link created_at } beta { version link created_at } alpha { version link created_at } } } }',
    variables: {
      modReference
    }
  })

  return data?.getModByReference || null
}

async function getNexusDetail(payload = {}) {
  const domainName = normalizeGameDomainName(
    pickFirstText(
      payload?.domainName,
      payload?.gameDomainName,
      payload?.nexusGameDomain,
      payload?.context?.game?.domainName,
      payload?.context?.game?.gameDomainName,
      payload?.context?.game?.nexusGameDomain,
      payload?.context?.game?.sourceSlug,
      payload?.context?.page?.source === 'nexus' ? payload?.context?.route?.params?.id : ''
    )
  )
  const modId = pickFirstText(payload?.modId, payload?.mod_id, payload?.id)
  if (!domainName || !modId) return null

  const config = resolveNexusConfig()
  if (!config.available) {
    throw new Error('Nexus API Key 未配置')
  }
  const record = await nexusRestRequest(
    `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(modId)}.json`,
    config
  )

  let selectedFile = null
  let fileList = []
  const downloadUrl = ''
  try {
    const fileResponse = await nexusRestRequest(
      `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(modId)}/files.json`,
      config
    )
    fileList = Array.isArray(fileResponse?.files) ? fileResponse.files : []
    const requestedFileId = toSafeText(payload.fileId)
    const requestedVersion = toSafeText(payload.version)
    selectedFile = requestedFileId
      ? fileList.find((item) => String(item.file_id || item.fileId) === requestedFileId && isUsableNexusFile(item))
      : requestedVersion && requestedVersion !== 'latest'
        ? resolvePreferredNexusFile(fileList.filter((item) => toSafeText(item.version) === requestedVersion)) || fileList.find((item) => toSafeText(item.version) === requestedVersion && isUsableNexusFile(item))
        : resolvePreferredNexusFile(fileList)
  } catch {
    fileList = []
    selectedFile = null
  }

  if ((payload.fileId || (payload.version && payload.version !== 'latest')) && !selectedFile) {
    throw Object.assign(new Error('指定文件或版本不可用，请重新读取文件列表；未自动改用最新版本。'), { code: 'requested_mod_file_unavailable' })
  }
  if (fileList.length && !selectedFile) throw Object.assign(new Error('当前没有可自动选择的正式文件，请明确选择需要的版本。'), { code: 'no_stable_mod_file' })

  return {
    ...record,
    source: 'nexus',
    domainName,
    modId,
    fileId: toSafeNumber(selectedFile?.file_id || selectedFile?.fileId, 0),
    fileName: toSafeText(selectedFile?.name || selectedFile?.file_name),
    version: pickFirstText(selectedFile?.version, record?.version, record?.modVersion),
    fileSize: toSafeNumber(selectedFile?.size_kb, 0) * 1024,
    downloadUrl,
    primaryFile: selectedFile,
    files: fileList,
    downloadLinkAvailable: Boolean(downloadUrl)
  }
}

async function getModioDetail(payload = {}) {
  const gameId = pickFirstText(
    payload?.gameId,
    payload?.modioGameId,
    payload?.context?.game?.sourceGameId
  )
  const modId = pickFirstText(payload?.modId, payload?.mod_id, payload?.id)
  if (!gameId || !modId) return null

  const config = resolveModioConfig(payload)
  if (!config.apiKey) {
    throw new Error('Mod.io API Key 未配置')
  }
  const record = await modioRequest(
    `/games/${encodeURIComponent(gameId)}/mods/${encodeURIComponent(modId)}`,
    config
  )
  if (payload.fileId) {
    record.modfile = await modioRequest(`/games/${encodeURIComponent(gameId)}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(payload.fileId)}`, config)
    if (String(record.modfile?.id) !== String(payload.fileId)) throw Object.assign(new Error('指定 Mod.io 文件不可用，未改用最新文件。'), { code: 'requested_mod_file_unavailable' })
  }
  return {
    ...record,
    source: 'modio',
    gameId,
    modId
  }
}

export async function getModioModDependencies(payload = {}) {
  const gameId = pickFirstText(
    payload?.gameId,
    payload?.modioGameId,
    payload?.context?.game?.sourceGameId,
    payload?.context?.route?.query?.sourceGameId,
    payload?.context?.route?.query?.modioGameId,
    payload?.context?.game?.id
  )
  const modId = pickFirstText(payload?.modId, payload?.mod_id, payload?.id)
  if (!gameId || !modId) {
    return {
      success: false,
      source: 'modio',
      records: [],
      dependencies: [],
      total: 0,
      message: '缺少 Mod.io 游戏 ID 或模组 ID。'
    }
  }

  const config = resolveModioConfig(payload)
  if (!config.apiKey) {
    throw new Error('Mod.io API Key 未配置')
  }

  const data = await modioRequest(
    `/games/${encodeURIComponent(gameId)}/mods/${encodeURIComponent(modId)}/dependencies`,
    config
  )
  const payloadData = extractListPayload(data)

  return {
    success: true,
    source: 'modio',
    gameId,
    modId,
    records: payloadData.records,
    dependencies: payloadData.records,
    total: payloadData.total
  }
}

async function getThunderstoreDetail(payload = {}) {
  const community = normalizeCommunityIdentifier(
    pickFirstText(
      payload?.community,
      payload?.context?.game?.sourceGameId,
      payload?.context?.game?.sourceSlug,
      payload?.context?.route?.query?.community,
      payload?.context?.route?.params?.id
    )
  )
  const parsed = parseThunderstorePackageFullName(
    pickFirstText(payload?.fullName, payload?.packageFullName, payload?.modId, payload?.id)
  )

  if (!community || !parsed.namespace || !parsed.packageName) {
    return null
  }

  const data = await thunderstoreGet(
    `/api/cyberstorm/listing/${encodeURIComponent(community)}/${encodeURIComponent(parsed.namespace)}/${encodeURIComponent(parsed.packageName)}/`
  )

  return {
    ...data,
    source: 'thunderstore',
    community,
    full_name: parsed.fullName,
    package_url: `${resolveThunderstoreBaseUrl()}/c/${encodeURIComponent(community)}/p/${encodeURIComponent(parsed.namespace)}/${encodeURIComponent(parsed.packageName)}/`
  }
}

export async function getModSourceDetail(payload = {}) {
  const safePayload = toPlainJson(payload, {})
  const source = resolveSearchSource(safePayload)
  const sourceLabel = resolveSourceLabel(source)
  const capability = assertSourceCapability(source, 'detail')
  if (!capability.ok) return { ...capability, record: null }

  if (safePayload?.record && typeof safePayload.record === 'object') {
    const sourceRecord =
      source === 'vamhub' ? normalizeVamHubRecord(safePayload.record) : safePayload.record
    const record = normalizeModRecord(sourceRecord, {
      source,
      sourceLabel
    })
    return {
      success: Boolean(record),
      record,
      message: record ? '' : '模组详情为空。'
    }
  }

  try {
    const rawRecord =
      source === 'ficsit'
        ? await getFicsitDetail(safePayload)
        : source === 'nexus'
          ? await getNexusDetail(safePayload)
          : source === 'modio'
          ? await getModioDetail(safePayload)
          : source === 'thunderstore'
            ? await getThunderstoreDetail(safePayload)
            : source === 'vamhub'
              ? await getVamHubDetail(safePayload)
              : null
    const record = rawRecord
      ? normalizeModRecord(rawRecord, {
          source,
          sourceLabel
        })
      : null

    const catalogs = {}
    if (record) {
      const offset = Math.max(0, Math.trunc(Number(safePayload.fileOffset) || 0))
      const limit = Math.max(1, Math.min(30, Math.trunc(Number(safePayload.fileLimit) || 20)))
      const paginate = safePayload.fileOffset !== undefined || safePayload.fileLimit !== undefined
      for (const key of ['files', 'versions']) {
        if (!Array.isArray(record[key])) continue
        const total = record[key].length
        catalogs[key] = { offset: paginate ? offset : 0, total, nextOffset: paginate && offset + limit < total ? offset + limit : null }
        if (paginate) record[key] = record[key].slice(offset, offset + limit)
      }
    }

    return {
      success: Boolean(record),
      record,
      catalogs,
      message: record ? '' : '当前来源缺少详情查询参数。'
    }
  } catch (error) {
    return {
      success: false,
      record: null,
      errorCode: error.code || 'mod_detail_failed',
      message: normalizeServiceError(error, source)
    }
  }
}
