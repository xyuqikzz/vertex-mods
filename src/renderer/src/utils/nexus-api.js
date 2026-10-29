import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
const axios = createMainHttp('nexus')
import {
  buildNexusDownloadLinkQueryParams,
  buildNexusManualDownloadPageUrl,
  parseNexusDownloadLinkEndpoint
} from '../../../shared/sources/nexus-download-link.js'
import {
  isNexusRequirementRawExternal,
  resolveNexusRequirementExternalFlag,
  resolveNexusRequirementModId
} from '../../../shared/sources/nexus-requirement-normalizer.js'
export { NEXUS_MOD_FILE_CATEGORY_ID } from '../../../shared/sources/nexus-file-category.js'

const { VITE_NEXUS_API_BASE_URL } = import.meta.env
const REQUEST_TIMEOUT = 60000

/**
 * Nexus 模组列表类型
 */
export const NEXUS_MOD_LIST_TYPE = Object.freeze({
  LATEST_UPDATED: 'latest_updated',
  LATEST_ADDED: 'latest_added',
  TRENDING: 'trending'
})

const NEXUS_MOD_LIST_ENDPOINT_MAP = Object.freeze({
  [NEXUS_MOD_LIST_TYPE.LATEST_UPDATED]: 'latest_updated',
  [NEXUS_MOD_LIST_TYPE.LATEST_ADDED]: 'latest_added',
  [NEXUS_MOD_LIST_TYPE.TRENDING]: 'trending'
})

// ==========================================
// 核心请求配置与封装
// ==========================================

/**
 * 解析并获取 Nexus API 基础路径
 * @returns {string} 处理好的基础 URL
 */
function resolveBaseUrl() {
  const raw = String(VITE_NEXUS_API_BASE_URL || 'https://api.nexusmods.com/v1').trim()
  return raw ? raw.replace(/\/+$/, '') : 'https://api.nexusmods.com/v1'
}

/**
 * 统一构建请求 Headers
 * @param {Object} config 配置对象，包含 apiKey 等
 * @returns {Object} 组装好的 headers 对象
 */
function buildHeaders(config = {}) {
  void config
  // OAuth / API Key selection and application identity are owned by the main process.
  return { Accept: 'application/json' }
}

function normalizeNexusApiError(error, endpoint = '') {
  const status = Number(error?.response?.status || 0)
  const responseData = error?.response?.data
  const responseMessage = String(
    typeof responseData === 'string' ? responseData : responseData?.message || ''
  ).trim()
  const endpointText = String(endpoint || '')
  const isDownloadLinkEndpoint = endpointText.includes('/download_link.json')
  const isDownloadLinkForbidden =
    status === 403 &&
    isDownloadLinkEndpoint &&
    /download links|premium users|visting nexusmods\.com|visiting nexusmods\.com/i.test(
      responseMessage
    )

  if (isDownloadLinkForbidden) {
    const nexusError = new Error(
      uiText('ui.directNexusDownloadLinksRequireAccountPermissionVisitTheFile')
    )
    nexusError.code = 'NEXUS_DOWNLOAD_LINK_FORBIDDEN'
    nexusError.status = status
    nexusError.endpoint = endpointText
    nexusError.downloadAuthorizationTarget = parseNexusDownloadLinkEndpoint(endpointText)
    nexusError.manualDownloadPageUrl = buildNexusManualDownloadPageUrl(
      nexusError.downloadAuthorizationTarget
    )
    return nexusError
  }

  if (status && responseMessage) {
    const nexusError = new Error(uiText('ui.nexusRequestFailedHTTPValueValue', { value1: (status), value2: (responseMessage) }))
    nexusError.status = status
    nexusError.endpoint = endpointText
    nexusError.responseData = responseData
    if (isDownloadLinkEndpoint && status === 400) {
      nexusError.code = 'NEXUS_DOWNLOAD_ACCOUNT_MISMATCH'
    } else if (isDownloadLinkEndpoint && status === 410) {
      nexusError.code = 'NEXUS_DOWNLOAD_AUTHORIZATION_EXPIRED'
    }
    return nexusError
  }
  if (status) {
    const nexusError = new Error(uiText('ui.nexusRequestFailedWithHTTPStatusValue', { value1: (status) }))
    nexusError.status = status
    nexusError.endpoint = endpointText
    if (isDownloadLinkEndpoint && status === 400) {
      nexusError.code = 'NEXUS_DOWNLOAD_ACCOUNT_MISMATCH'
    } else if (isDownloadLinkEndpoint && status === 410) {
      nexusError.code = 'NEXUS_DOWNLOAD_AUTHORIZATION_EXPIRED'
    }
    return nexusError
  }
  return error instanceof Error ? error : new Error(String(error || uiText('ui.nexusRequestFailed')))
}

/**
 * 统一的 API 请求封装，处理配置、Headers、超时和基础状态码校验 (REST v1)
 * @param {string} endpoint 请求端点路径 (如 '/games.json')
 * @param {Object} config API 配置对象 (含 apiKey)
 * @param {Object} [options={}] Axios 额外请求项 (如 params, method)
 * @returns {Promise<any>} 响应体数据 (response.data)
 */
async function nexusRequest(endpoint, config = {}, options = {}) {
  const baseUrl = resolveBaseUrl()
  const headers = buildHeaders(config)
  const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  let response
  try {
    response = await axios({
      url,
      method: options.method || 'GET',
      timeout: REQUEST_TIMEOUT,
      ...options,
      headers: { ...headers, ...(options.headers || {}) }
    })
  } catch (error) {
    throw normalizeNexusApiError(error, endpoint)
  }

  if (response?.status !== 200) {
    throw normalizeNexusApiError({ response }, endpoint)
  }

  return response?.data
}

/**
 * 统一的 GraphQL请求封装 (V2 GraphQL API)
 * @param {string} query GraphQL查询语句
 * @param {Object} variables 查询变量
 * @param {Object} config API 配置对象
 * @returns {Promise<any>} data下的主要内容
 */
async function nexusGraphQLRequest(query, variables, config = {}) {
  const headers = buildHeaders(config)
  const url = 'https://api.nexusmods.com/v2/graphql'

  const response = await axios({
    url,
    method: 'POST',
    timeout: REQUEST_TIMEOUT,
    headers,
    data: {
      query,
      variables
    }
  })

  if (response?.status !== 200) {
    throw new Error(uiText('ui.nexusGraphQLRequestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  if (response?.data?.errors?.length) {
    throw new Error(uiText('ui.nexusGraphQLErrorValue', { value1: (response.data.errors[0]?.message || uiText('tools.unknownError')) }))
  }

  return response?.data?.data
}

// ==========================================
// 数据格式化与辅助方法
// ==========================================

function normalizeGameDomainName(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
}

function parseNexusModPageLink(value) {
  const rawUrl = String(value || '').trim()
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
    const hostname = String(url.hostname || '').trim().toLowerCase()
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

    const fileId = Number(url.searchParams.get('file_id') || url.searchParams.get('fileId') || 0)

    return {
      isNexusModLink: true,
      domainName: normalizeGameDomainName(pathMatch[1]),
      modId: Number(pathMatch[2] || 0),
      fileId: Number.isFinite(fileId) && fileId > 0 ? fileId : 0
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

function normalizeModListType(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  return NEXUS_MOD_LIST_ENDPOINT_MAP[text] ? text : NEXUS_MOD_LIST_TYPE.LATEST_UPDATED
}

// ==========================================
// 业务 API 接口定义
// ==========================================

/**
 * 获取 Nexus 支持的游戏列表
 * @param {Object} config API 配置对象
 * @returns {Promise<Array>} 游戏列表数组
 */
export async function getNexusGameList(config = {}) {
  const CACHE_KEY = 'nexus_game_list_cache'
  const today = new Date().toISOString().slice(0, 10)

  // 尝试读取今日缓存
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached && cached.date === today && Array.isArray(cached.data)) {
        return cached.data
      }
    }
  } catch {
    // 缓存读取失败，继续请求 API
  }

  // 缓存不存在或非今日，发起请求
  const data = await nexusRequest('/games.json', config)
  const list = Array.isArray(data) ? data : []

  // 写入今日缓存
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, data: list }))
  } catch {
    // 缓存写入失败，不影响正常使用
  }

  return list
}

/**
 * 获取某个游戏的模组列表 (支持最新更新、最新添加、热门) - 已改造为 GraphQL V2 查询
 * @param {string} gameDomainName 游戏域名标识 (如 'stardewvalley')
 * @param {Object} config API 配置对象
 * @param {string} listType 列表类型 (NEXUS_MOD_LIST_TYPE)
 * @param {Object} [options={}] 请求选项 (含 page 分页等)
 * @returns {Promise<Array>} 模组列表数组
 */
export async function getNexusModList(gameDomainName, config = {}, listType, options = {}) {
  const domainName = normalizeGameDomainName(gameDomainName)
  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }

  const type = normalizeModListType(listType)
  const page = Number(options?.page)
  const validPage = Number.isFinite(page) && page > 0 ? page : 1
  const customLimit = Number(options?.limit)
  const limit = Number.isFinite(customLimit) && customLimit > 0 ? customLimit : 40
  const offset = (validPage - 1) * limit
  const keyword = String(options?.keyword || '').trim()

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
          ...ModTileFragment
        }
      }
    }

    fragment ModTileFragment on Mod {
      adultContent
      createdAt
      downloads
      endorsements
      fileSize

      game {
        domainName
        id
        name
      }

      modCategory {
        categoryId
        name
      }

      modId
      name
      status
      summary
      thumbnailUrl
      thumbnailBlurredUrl
      uid
      updatedAt

      uploader {
        avatar
        memberId
        name
      }

      viewerDownloaded
      viewerEndorsed
      viewerTracked
      viewerUpdateAvailable
      viewerIsBlocked
    }
  `

  const sortConfig = Object.create(null)
  if (type === NEXUS_MOD_LIST_TYPE.LATEST_UPDATED) {
    sortConfig.updatedAt = { direction: 'DESC' }
  } else if (type === NEXUS_MOD_LIST_TYPE.LATEST_ADDED) {
    sortConfig.createdAt = { direction: 'DESC' }
  } else if (type === NEXUS_MOD_LIST_TYPE.TRENDING) {
    sortConfig.downloads = { direction: 'DESC' }
  } else {
    sortConfig.updatedAt = { direction: 'DESC' }
  }

  const variables = {
    count: limit,
    offset,
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
            .map((w) => ({ op: 'WILDCARD', value: `${w}` }))
        : []
    },
    postFilter: {},
    sort: [sortConfig]
  }

  const data = await nexusGraphQLRequest(query, variables, config)
  const nodes = Array.isArray(data?.mods?.nodes) ? data.mods.nodes : []
  const totalCount = Number(data?.mods?.totalCount) || 0
  const gameNode =
    nodes
      .map((node) => (node && typeof node === 'object' ? node.game : null))
      .find((game) => {
        const gameDomainName = normalizeGameDomainName(game?.domainName)
        return gameDomainName && gameDomainName.toLowerCase() === domainName.toLowerCase()
      }) || null

  // 为了向下兼容 Vue 遗留的 normalizeNexusModList 方法，将字段重新做一层映射
  const list = nodes.map((node) => ({
    mod_id: node.modId,
    name: node.name,
    summary: node.summary,
    version: node.version,
    author: node.uploader?.name || '',
    picture_url: node.thumbnailUrl || node.thumbnailBlurredUrl,
    mod_downloads: node.downloads,
    endorsement_count: node.endorsements,
    updated_timestamp: node.updatedAt ? new Date(node.updatedAt).getTime() / 1000 : 0,
    created_timestamp: node.createdAt ? new Date(node.createdAt).getTime() / 1000 : 0
  }))

  return {
    list,
    totalCount,
    game: gameNode
      ? {
          id: Number(gameNode.id || 0),
          name: String(gameNode.name || '').trim(),
          domainName: normalizeGameDomainName(gameNode.domainName)
        }
      : null
  }
}

/**
 * 获取指定游戏和模组 ID 的文件列表
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {Object} config API 配置对象
 * @returns {Promise<Object>} 包含 files 数组的模组文件信息对象
 */
export async function getNexusModFiles(gameDomainName, modId, config = {}) {
  const domainName = normalizeGameDomainName(gameDomainName)
  const safeModId = Number(modId)

  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }
  if (!Number.isFinite(safeModId) || safeModId <= 0) {
    throw new Error(uiText('ui.invalidNexusModID'))
  }

  const data = await nexusRequest(
    `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(safeModId)}/files.json`,
    config
  )

  const safeData = data && typeof data === 'object' ? data : {}
  const files = Array.isArray(safeData?.files) ? safeData.files : []
  return { ...safeData, files }
}

/**
 * 获取单个文件的详情（包含 description 和 changelog）
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {number|string} fileId 文件 ID
 * @param {Object} config API 配置对象
 * @returns {Promise<Object>} 文件详情对象
 */
export async function getNexusModFileDetail(gameDomainName, modId, fileId, config = {}) {
  const domainName = normalizeGameDomainName(gameDomainName)
  const safeModId = Number(modId)
  const safeFileId = Number(fileId)

  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }
  if (!Number.isFinite(safeModId) || safeModId <= 0) {
    throw new Error(uiText('ui.invalidNexusModID'))
  }
  if (!Number.isFinite(safeFileId) || safeFileId <= 0) {
    throw new Error(uiText('ui.invalidNexusFileID'))
  }

  const data = await nexusRequest(
    `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(safeModId)}/files/${encodeURIComponent(safeFileId)}.json`,
    config
  )

  return data && typeof data === 'object' ? data : {}
}

/**
 * 批量获取文件详情（带并发控制）
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {number[]} fileIds 文件 ID 列表
 * @param {Object} config API 配置对象
 * @param {number} concurrency 并发数
 * @returns {Promise<Map<number, Object>>} fileId -> 文件详情的映射
 */
export async function getNexusModFileDetailBatch(
  gameDomainName,
  modId,
  fileIds,
  config = {},
  concurrency = 3
) {
  const result = new Map()
  const safeFileIds = (Array.isArray(fileIds) ? fileIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)

  if (!safeFileIds.length) {
    return result
  }

  for (let i = 0; i < safeFileIds.length; i += concurrency) {
    const batch = safeFileIds.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map((fileId) => getNexusModFileDetail(gameDomainName, modId, fileId, config))
    )
    results.forEach((r, index) => {
      if (r.status === 'fulfilled' && r.value) {
        result.set(batch[index], r.value)
      }
    })
  }

  return result
}

/**
 * 获取指定游戏和模组 ID 的模组详情
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {Object} config API 配置对象
 * @returns {Promise<Object>} 模组详情对象
 */
export async function getNexusModInfo(gameDomainName, modId, config = {}) {
  const domainName = normalizeGameDomainName(gameDomainName)
  const safeModId = Number(modId)

  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }
  if (!Number.isFinite(safeModId) || safeModId <= 0) {
    throw new Error(uiText('ui.invalidNexusModID'))
  }

  const data = await nexusRequest(
    `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(safeModId)}.json`,
    config
  )

  const safeData = data && typeof data === 'object' ? data : {}
  return {
    ...safeData,
    modId: Number(safeData?.mod_id || safeData?.modId || safeModId),
    name: String(safeData?.name || '').trim(),
    summary: String(safeData?.summary || safeData?.description || '').trim(),
    version: String(safeData?.version || '').trim(),
    author: String(safeData?.author || safeData?.uploaded_by || '').trim(),
    pictureUrl: String(
      safeData?.picture_url ||
        safeData?.pictureUrl ||
        safeData?.thumbnail_url ||
        safeData?.thumbnailUrl ||
        ''
    ).trim()
  }
}

/**
 * 通过 Nexus 官方 GraphQL 查询模组依赖信息
 * 说明：
 * - 站内依赖与站外依赖都来自 nexusRequirements
 * - externalRequirement 为 true 时，若有明确 modId 或链接可识别为 Nexus 模组页，则按 Nexus 依赖处理
 * - DLC 依赖来自 dlcRequirements
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {Object} config API 配置对象
 * @param {Object} [options={}] 查询选项
 * @returns {Promise<Object>} 归一化后的依赖结果
 */
export async function getNexusModRequirements(gameDomainName, modId, config = {}, options = {}) {
  const domainName = normalizeGameDomainName(gameDomainName)
  const safeModId = Number(modId)

  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }
  if (!Number.isFinite(safeModId) || safeModId <= 0) {
    throw new Error(uiText('ui.invalidNexusModID'))
  }

  const requestCount = Number(options?.count)
  const count = Number.isFinite(requestCount) && requestCount > 0 ? requestCount : 100

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
        modId: safeModId
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
      id: String(item?.id || '').trim(),
      modId: resolvedModId,
      name: String(item?.modName || '').trim(),
      url: String(item?.url || '').trim(),
      notes: String(item?.notes || '').trim(),
      gameId: Number(item?.gameId || 0),
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
    id: String(item?.gameExpansion?.id || '').trim(),
    name: String(item?.gameExpansion?.name || '').trim(),
    notes: String(item?.notes || '').trim()
  }))

  return {
    domainName,
    modId: safeModId,
    modName: String(mod?.name || '').trim(),
    totalCount: Number(nexusRequirementData?.totalCount || dependencies.length || 0),
    dependencies,
    nexusDependencies,
    externalDependencies,
    dlcRequirements,
    raw: mod || null
  }
}

/**
 * 获取指定模组文件的下载链接
 * @param {string} gameDomainName 游戏域名标识
 * @param {number|string} modId 模组 ID
 * @param {number|string} fileId 文件 ID
 * @param {Object} config API 配置对象
 * @param {Object} options 下载链接授权选项，可传入 key/expires 或 downloadAuthorization
 * @returns {Promise<Array>} 文件下载链接列表数组
 */
export async function getNexusModDownloadLinks(
  gameDomainName,
  modId,
  fileId,
  config = {},
  options = {}
) {
  const domainName = normalizeGameDomainName(gameDomainName)
  const safeModId = Number(modId)
  const safeFileId = Number(fileId)

  if (!domainName) {
    throw new Error(uiText('ui.nexusGameIdentifierIsEmpty'))
  }
  if (!Number.isFinite(safeModId) || safeModId <= 0) {
    throw new Error(uiText('ui.invalidNexusModID'))
  }
  if (!Number.isFinite(safeFileId) || safeFileId <= 0) {
    throw new Error(uiText('ui.invalidNexusFileID'))
  }

  const queryParams = buildNexusDownloadLinkQueryParams(
    options?.downloadAuthorization ||
      options?.authorization ||
      config?.downloadAuthorization ||
      options
  )
  const requestOptions = Object.keys(queryParams).length ? { params: queryParams } : {}

  const data = await nexusRequest(
    `/games/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(safeModId)}/files/${encodeURIComponent(safeFileId)}/download_link.json`,
    config,
    requestOptions
  )

  return Array.isArray(data) ? data : []
}
