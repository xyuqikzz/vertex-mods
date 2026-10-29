import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
const axios = createMainHttp('thunderstore')
import ipcRenderer from '@renderer/common/ipcRenderer.js'

const { VITE_THUNDERSTORE_BASE_URL } = import.meta.env

/**
 * 社区 API 根地址（可通过环境变量覆盖）
 */
const BASE_URL = resolveBaseUrl(VITE_THUNDERSTORE_BASE_URL)
const REQUEST_TIMEOUT = 60000
const R2MM_ECOSYSTEM_CACHE_KEY = 'thunderstore_r2mm_ecosystem_cache'
let ecosystemCache = null
let ecosystemUpdateListenerRegistered = false

function ensureEcosystemUpdateListener() {
  if (ecosystemUpdateListenerRegistered) {
    return
  }
  try {
    ipcRenderer.on('thunderstore-ecosystem-updated', () => {
      ecosystemCache = null
    })
    ecosystemUpdateListenerRegistered = true
  } catch {
    // 非 Electron 预览环境继续使用调用时缓存。
  }
}

/**
 * 解析基础地址：
 * - 兼容传入 https://thunderstore.io/api 这类带路径的配置
 * - 最终只保留 origin，避免出现 /api/api/... 的 404
 */
function resolveBaseUrl(input) {
  const raw = String(input || 'https://thunderstore.io').trim()
  try {
    return new URL(raw).origin.replace(/\/+$/, '')
  } catch {
    return 'https://thunderstore.io'
  }
}

/**
 * 构建绝对 URL
 */
function toAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) {
    throw new Error(uiText('ui.requestURLIsRequired'))
  }

  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }

  const normalized = String(pathOrUrl).startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${BASE_URL}${normalized}`
}

/**
 * 基础 JSON 请求
 */
async function getJson(pathOrUrl, config = {}) {
  const response = await axios.get(toAbsoluteUrl(pathOrUrl), {
    timeout: REQUEST_TIMEOUT,
    ...config
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.requestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  return response.data
}

function normalizeR2modmanEcosystemData(data = {}) {
  return {
    schemaVersion: String(data?.schemaVersion || ''),
    games: data?.games && typeof data.games === 'object' ? data.games : {},
    communities: data?.communities && typeof data.communities === 'object' ? data.communities : {},
    packageInstallers:
      data?.packageInstallers && typeof data.packageInstallers === 'object'
        ? data.packageInstallers
        : {},
    modloaderPackages: Array.isArray(data?.modloaderPackages) ? data.modloaderPackages : []
  }
}

/**
 * 统一提取社区标识：
 * 支持以下输入：
 * - lethal-company
 * - /c/lethal-company/
 * - https://thunderstore.io/c/lethal-company/
 */
function normalizeCommunityIdentifier(community) {
  const raw = String(community || '').trim()
  if (!raw) {
    return ''
  }

  // 处理完整 URL
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const parts = url.pathname.split('/').filter(Boolean)
      const cIndex = parts.findIndex((p) => p.toLowerCase() === 'c')
      if (cIndex >= 0 && parts[cIndex + 1]) {
        return decodeURIComponent(parts[cIndex + 1])
          .trim()
          .toLowerCase()
      }
      if (parts[0]) {
        return decodeURIComponent(parts[0]).trim().toLowerCase()
      }
    } catch {
      return ''
    }
  }

  // 处理 /c/xxx 或 c/xxx
  const normalized = raw.replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length >= 2 && segments[0].toLowerCase() === 'c') {
    return decodeURIComponent(segments[1]).trim().toLowerCase()
  }

  return decodeURIComponent(segments[segments.length - 1] || '')
    .trim()
    .toLowerCase()
}

/**
 * 基础二进制请求（社区分片索引/分片内容使用）
 */
async function getArrayBuffer(pathOrUrl, config = {}) {
  const response = await axios.get(toAbsoluteUrl(pathOrUrl), {
    timeout: REQUEST_TIMEOUT,
    responseType: 'arraybuffer',
    ...config
  })

  if (Number(response?.status) !== 200 || !response?.data) {
    throw new Error(uiText('ui.couldNotDownloadBinaryData'))
  }

  return response.data
}

/**
 * 计算 SHA-256（用于给分片做变更追踪）
 */
async function sha256Hex(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashByteArray = Array.from(new Uint8Array(hashBuffer))
  return hashByteArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 尝试解析二进制 JSON：
 * 1. 先按明文 JSON 解析
 * 2. 失败后按 gzip 解压再解析
 */
async function parseBlobJson(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder()

  // 先尝试明文 JSON
  try {
    const text = decoder.decode(uint8)
    return JSON.parse(text)
  } catch {
    // 继续尝试 gzip
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error(uiText('ui.thisEnvironmentDoesNotSupportGzipDecompressionUpdateElectronChromium'))
  }

  const stream = new Blob([uint8]).stream().pipeThrough(new DecompressionStream('gzip'))
  const text = await new Response(stream).text()
  return JSON.parse(text)
}

/**
 * 获取社区列表（用于“游戏社区搜索/选择”）
 * 接口：GET /api/experimental/community/
 *
 * @param {Object} [params] 查询参数
 * @param {string} [params.cursor] 分页游标（上一页返回的 next_link 中可提取）
 * @returns {Promise<{
 *   pagination: { next_link: string|null, previous_link: string|null },
 *   results: Array<{
 *     identifier: string,
 *     name: string,
 *     discord_url: string|null,
 *     wiki_url: string|null,
 *     require_package_listing_approval: boolean
 *   }>
 * }>}
 */
export async function getCommunityList(params = {}) {
  return getJson('/api/experimental/community/', { params })
}

/**
 * 获取带游戏封面的社区列表（推荐用于“游戏选择页”）
 * 接口：GET /api/cyberstorm/community/
 *
 * 说明：
 * - 这个接口会返回 cover_image_url / hero_image_url / background_image_url
 * - 相比 experimental/community，它包含更完整的展示字段
 *
 * @param {Object} [params] 查询参数
 * @param {boolean} [params.is_listed] 是否仅显示已上架社区
 * @param {boolean} [params.has_mod_manager_support] 是否仅显示支持管理器的社区
 * @returns {Promise<{
 *   count: number,
 *   next: string|null,
 *   previous: string|null,
 *   results: Array<{
 *     identifier: string,
 *     name: string,
 *     short_description: string|null,
 *     cover_image_url: string|null,
 *     hero_image_url: string|null,
 *     background_image_url: string|null,
 *     community_icon_url: string|null,
 *     has_mod_manager_support: boolean,
 *     is_listed: boolean,
 *     total_package_count: number
 *   }>
 * }>}
 */
export async function getCommunityListWithCover(params = {}) {
  const CACHE_KEY = 'thunderstore_community_list_cache'
  const today = new Date().toISOString().slice(0, 10)

  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached && cached.date === today && cached.data) {
        return cached.data
      }
    }
  } catch {
    // ignore
  }

  const data = await getJson('/api/cyberstorm/community/', { params })

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, data }))
  } catch {
    // ignore
  }

  return data
}

/**
 * 获取单个社区详情（带封面）
 * 接口：GET /api/cyberstorm/community/{community}/
 *
 * @param {string} community 社区标识（如 riskofrain2）
 * @returns {Promise<{
 *   identifier: string,
 *   name: string,
 *   short_description: string|null,
 *   description: string|null,
 *   cover_image_url: string|null,
 *   hero_image_url: string|null,
 *   background_image_url: string|null,
 *   community_icon_url: string|null,
 *   total_download_count: number,
 *   total_package_count: number
 * }>}
 */
export async function getCommunityDetailWithCover(community) {
  const identifier = normalizeCommunityIdentifier(community)
  if (!identifier) {
    throw new Error(uiText('ui.communityIsRequired'))
  }

  try {
    return await getJson(`/api/cyberstorm/community/${identifier}/`)
  } catch (error) {
    // 兼容性兜底：有些环境会出现单社区接口 404，
    // 回退到列表接口按 identifier 精确匹配。
    const status = Number(error?.response?.status || 0)
    if (status !== 404) {
      throw error
    }

    const list = await getCommunityListWithCover()
    const results = Array.isArray(list?.results) ? list.results : []
    const hit = results.find((item) => String(item?.identifier || '').toLowerCase() === identifier)

    if (!hit) {
      throw error
    }

    return hit
  }
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeStringList(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input.map((item) => String(item || '').trim()).filter(Boolean)
}

export function buildCommunityPackagePageUrl(community, namespace, name) {
  const identifier = normalizeCommunityIdentifier(community)
  const safeNamespace = String(namespace || '').trim()
  const safeName = String(name || '').trim()
  if (!identifier || !safeNamespace || !safeName) {
    return ''
  }

  return `${BASE_URL}/c/${encodeURIComponent(identifier)}/p/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}/`
}

function normalizeCyberstormPackagePreview(community, data = {}) {
  const identifier = normalizeCommunityIdentifier(community || data?.community_identifier)
  const namespace = String(data?.namespace || '').trim()
  const name = String(data?.name || '').trim()
  const fullName = namespace && name ? `${namespace}-${name}` : name || namespace
  const categories = Array.isArray(data?.categories)
    ? data.categories
        .map((item) => String(item?.name || item?.slug || item || '').trim())
        .filter(Boolean)
    : []
  const lastUpdated = String(data?.last_updated || data?.datetime_created || '').trim()

  return {
    name,
    namespace,
    full_name: fullName,
    owner: namespace,
    package_url: buildCommunityPackagePageUrl(identifier, namespace, name),
    rating_score: toSafeNumber(data?.rating_count, 0),
    rating_count: toSafeNumber(data?.rating_count, 0),
    download_count: toSafeNumber(data?.download_count, 0),
    is_pinned: Boolean(data?.is_pinned),
    is_deprecated: Boolean(data?.is_deprecated),
    has_nsfw_content: Boolean(data?.is_nsfw),
    categories,
    versions: [
      {
        name,
        version_number: '',
        description: String(data?.description || '').trim(),
        icon: String(data?.icon_url || '').trim(),
        downloads: toSafeNumber(data?.download_count, 0),
        dependencies: [],
        download_url: '',
        file_size: toSafeNumber(data?.size, 0),
        date_created: lastUpdated,
        is_active: true
      }
    ]
  }
}

function normalizeCyberstormPackageVersions(data = []) {
  const list = Array.isArray(data) ? data : []
  return list.map((item) => ({
    name: String(item?.name || '').trim(),
    version_number: String(item?.version_number || '').trim(),
    description: String(item?.description || '').trim(),
    icon: String(item?.icon_url || item?.icon || '').trim(),
    date_created: String(item?.datetime_created || '').trim(),
    downloads: toSafeNumber(item?.download_count, 0),
    download_url: String(item?.download_url || '').trim(),
    install_url: String(item?.install_url || '').trim(),
    file_size: toSafeNumber(item?.size ?? item?.file_size, 0),
    website_url: String(item?.website_url || '').trim(),
    dependencies: [],
    is_active: true
  }))
}

function normalizeCyberstormPackageListingDetail(community, data = {}) {
  const identifier = normalizeCommunityIdentifier(community || data?.community_identifier)
  const namespace = String(data?.namespace || '').trim()
  const name = String(data?.name || '').trim()
  const versionNumber = String(data?.version_number || data?.latest_version_number || '').trim()
  const fullName = namespace && name ? `${namespace}-${name}` : name || namespace
  const categories = Array.isArray(data?.categories)
    ? data.categories
        .map((item) => String(item?.name || item?.slug || item || '').trim())
        .filter(Boolean)
    : []

  return {
    name,
    namespace,
    full_name: fullName,
    owner: String(data?.team?.name || namespace || '').trim(),
    package_url: buildCommunityPackagePageUrl(identifier, namespace, name),
    rating_score: toSafeNumber(data?.rating_count, 0),
    rating_count: toSafeNumber(data?.rating_count, 0),
    dependency_count: toSafeNumber(data?.dependency_count, 0),
    latest_version_number: String(data?.latest_version_number || versionNumber).trim(),
    categories,
    versions: [
      {
        name,
        version_number: versionNumber,
        description: String(data?.description || '').trim(),
        icon: String(data?.icon_url || '').trim(),
        downloads: toSafeNumber(data?.download_count, 0),
        dependencies: toSafeStringList(
          Array.isArray(data?.dependencies)
            ? data.dependencies.map((item) =>
                item?.namespace && item?.name && item?.version_number
                  ? `${item.namespace}-${item.name}-${item.version_number}`
                  : ''
              )
            : []
        ),
        download_url: String(data?.download_url || '').trim(),
        file_size: toSafeNumber(data?.size, 0),
        date_created: String(data?.datetime_created || '').trim(),
        install_url: String(data?.install_url || '').trim(),
        website_url: String(data?.website_url || '').trim(),
        is_active: true
      }
    ]
  }
}

function normalizeCyberstormPackageVersionDetail(data = {}) {
  const namespace = String(data?.namespace || '').trim()
  const name = String(data?.name || '').trim()
  const versionNumber = String(data?.version_number || '').trim()
  const fullName = namespace && name ? `${namespace}-${name}` : name || namespace

  return {
    name,
    namespace,
    full_name: fullName,
    owner: String(data?.team?.name || namespace || '').trim(),
    dependency_count: toSafeNumber(data?.dependency_count, 0),
    version_number: versionNumber,
    description: String(data?.description || '').trim(),
    icon: String(data?.icon_url || '').trim(),
    downloads: toSafeNumber(data?.download_count, 0),
    dependencies: toSafeStringList(
      Array.isArray(data?.dependencies)
        ? data.dependencies.map((item) =>
            item?.namespace && item?.name && item?.version_number
              ? `${item.namespace}-${item.name}-${item.version_number}`
              : ''
          )
        : []
    ),
    download_url: String(data?.download_url || '').trim(),
    file_size: toSafeNumber(data?.size, 0),
    date_created: String(data?.datetime_created || '').trim(),
    install_url: String(data?.install_url || '').trim(),
    website_url: String(data?.website_url || '').trim()
  }
}

function normalizeCyberstormPackageDependency(data = {}) {
  const namespace = String(data?.namespace || '').trim()
  const name = String(data?.name || '').trim()
  const versionNumber = String(data?.version_number || '').trim()
  return {
    name,
    namespace,
    full_name: namespace && name ? `${namespace}-${name}` : name || namespace,
    version_number: versionNumber,
    description: String(data?.description || '').trim(),
    icon: String(data?.icon_url || '').trim(),
    is_active: data?.is_active !== false,
    is_removed: Boolean(data?.is_removed)
  }
}

/**
 * 获取社区模组列表（在线仓库）
 * 接口：GET /c/{community}/api/v1/package/
 *
 * 说明：
 * - 当前返回结构通常是“数组”，不是标准分页对象
 * - page/limit/offset 等参数大概率会被忽略，建议前端自行分页
 *
 * @param {string} community 社区标识（如 lethal-company）
 * @param {Object} [params] 透传查询参数（例如 ordering）
 * @returns {Promise<Array<{
 *   name: string,
 *   full_name: string,
 *   owner: string,
 *   package_url: string,
 *   rating_score: number,
 *   categories: string[],
 *   versions: Array<{
 *     version_number: string,
 *     description: string,
 *     icon: string,
 *     downloads: number,
 *     dependencies: string[],
 *     download_url: string,
 *     file_size: number,
 *     date_created: string
 *   }>
 * }>>}
 */
export async function getCommunityModList(community, params = {}) {
  const identifier = normalizeCommunityIdentifier(community)
  if (!identifier) {
    throw new Error(uiText('ui.communityIsRequired'))
  }

  const CACHE_KEY = `thunderstore_mod_list_cache_${identifier}`
  const today = new Date().toISOString().slice(0, 10)

  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached && cached.date === today && cached.data) {
        return cached.data
      }
    }
  } catch {
    // ignore
  }

  const data = await getJson(`/c/${encodeURIComponent(identifier)}/api/v1/package/`, { params })

  let resultData
  if (Array.isArray(data)) {
    resultData = data
  } else if (Array.isArray(data?.results)) {
    resultData = data.results
  } else {
    throw new Error(uiText('ui.invalidCommunityModListExpectedAnArray'))
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, data: resultData }))
  } catch {
    // ignore
  }

  return resultData
}

/**
 * 获取社区模组分页列表（Cyberstorm）
 * 接口：GET /api/cyberstorm/listing/{community}/
 *
 * @param {string} community 社区标识
 * @param {Object} [params]
 * @param {number} [params.page] 页码（从 1 开始）
 * @param {string} [params.ordering] 排序：last-updated/newest/most-downloaded/top-rated
 * @param {string} [params.q] 搜索关键字
 * @param {boolean} [params.deprecated] 是否包含已弃用包
 * @param {boolean} [params.nsfw] 是否包含 NSFW 包
 * @param {string[]} [params.included_categories] 需要包含的分类 ID
 * @param {string[]} [params.excluded_categories] 需要排除的分类 ID
 * @param {string} [params.section] 社区分区 UUID
 * @returns {Promise<{
 *   count: number,
 *   next: string|null,
 *   previous: string|null,
 *   results: any[]
 * }>}
 */
export async function getCommunityModListPage(community, params = {}) {
  const identifier = normalizeCommunityIdentifier(community)
  if (!identifier) {
    throw new Error(uiText('ui.communityIsRequired'))
  }

  const requestParams = {}
  const page = Number(params?.page || 1)
  if (Number.isFinite(page) && page > 0) {
    requestParams.page = Math.trunc(page)
  }

  const ordering = String(params?.ordering || '').trim()
  if (ordering) {
    requestParams.ordering = ordering
  }

  const keyword = String(params?.q || '').trim()
  if (keyword) {
    requestParams.q = keyword
  }

  if (typeof params?.deprecated === 'boolean') {
    requestParams.deprecated = params.deprecated
  }
  if (typeof params?.nsfw === 'boolean') {
    requestParams.nsfw = params.nsfw
  }

  // 分类过滤需要重复参数（included_categories=1&included_categories=2）。
  // 默认的 params 序列化会生成 included_categories[]=1，服务端无法识别，所以直接拼进地址。
  const categoryQuery = new URLSearchParams()
  toSafeStringList(params?.included_categories)
    .filter((id) => /^\d+$/.test(id))
    .forEach((id) => categoryQuery.append('included_categories', id))
  toSafeStringList(params?.excluded_categories)
    .filter((id) => /^\d+$/.test(id))
    .forEach((id) => categoryQuery.append('excluded_categories', id))

  const section = String(params?.section || '').trim()
  if (section) {
    requestParams.section = section
  }

  const categorySearch = categoryQuery.toString()
  const data = await getJson(
    `/api/cyberstorm/listing/${encodeURIComponent(identifier)}/${categorySearch ? `?${categorySearch}` : ''}`,
    { params: requestParams }
  )

  return {
    count: toSafeNumber(data?.count, 0),
    next: data?.next || null,
    previous: data?.previous || null,
    results: Array.isArray(data?.results)
      ? data.results.map((item) => normalizeCyberstormPackagePreview(identifier, item))
      : []
  }
}

/**
 * 获取社区可用的模组分类（用于列表筛选）
 * 接口：GET /api/cyberstorm/community/{community}/filters/
 *
 * @param {string} community 社区标识
 * @returns {Promise<{ categories: Array<{ id: string, name: string, slug: string }> }>}
 */
export async function getCommunityFilters(community) {
  const identifier = normalizeCommunityIdentifier(community)
  if (!identifier) {
    throw new Error(uiText('ui.communityIsRequired'))
  }

  const data = await getJson(`/api/cyberstorm/community/${encodeURIComponent(identifier)}/filters/`)
  const categories = (Array.isArray(data?.package_categories) ? data.package_categories : [])
    .map((item) => ({
      id: String(item?.id ?? '').trim(),
      name: String(item?.name || item?.slug || '').trim(),
      slug: String(item?.slug || '').trim()
    }))
    .filter((item) => /^\d+$/.test(item.id) && item.name)

  return { categories }
}

/**
 * 获取社区内单个包详情（当前版本或最新版本）
 * 接口：GET /api/cyberstorm/listing/{community}/{namespace}/{name}/
 * 接口：GET /api/cyberstorm/listing/{community}/{namespace}/{name}/v/{version}/
 */
export async function getCommunityPackageDetail(community, namespace, name, version = '') {
  const identifier = normalizeCommunityIdentifier(community)
  const safeNamespace = String(namespace || '').trim()
  const safeName = String(name || '').trim()
  const safeVersion = String(version || '').trim()
  if (!identifier || !safeNamespace || !safeName) {
    throw new Error(uiText('ui.communityNamespaceAndNameAreRequired'))
  }

  const versionPath = safeVersion ? `/v/${encodeURIComponent(safeVersion)}` : ''
  const data = await getJson(
    `/api/cyberstorm/listing/${encodeURIComponent(identifier)}/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}${versionPath}/`
  )
  return normalizeCyberstormPackageListingDetail(identifier, data)
}

/**
 * 获取包的所有可用版本
 * 接口：GET /api/cyberstorm/package/{namespace}/{name}/versions/
 */
export async function getCommunityPackageVersions(namespace, name) {
  const safeNamespace = String(namespace || '').trim()
  const safeName = String(name || '').trim()
  if (!safeNamespace || !safeName) {
    throw new Error(uiText('ui.namespaceAndNameAreRequired'))
  }

  const data = await getJson(
    `/api/cyberstorm/package/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}/versions/`
  )
  return normalizeCyberstormPackageVersions(data)
}

/**
 * 获取指定版本详情
 * 接口：GET /api/cyberstorm/package/{namespace}/{name}/v/{version}/
 */
export async function getPackageVersionDetail(namespace, name, version) {
  const safeNamespace = String(namespace || '').trim()
  const safeName = String(name || '').trim()
  const safeVersion = String(version || '').trim()
  if (!safeNamespace || !safeName || !safeVersion) {
    throw new Error(uiText('ui.namespaceNameAndVersionAreRequired'))
  }

  const data = await getJson(
    `/api/cyberstorm/package/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}/v/${encodeURIComponent(safeVersion)}/`
  )
  return normalizeCyberstormPackageVersionDetail(data)
}

/**
 * 获取指定版本的全部依赖（自动翻页）
 * 接口：GET /api/cyberstorm/package/{namespace}/{name}/v/{version}/dependencies/
 */
export async function getAllPackageVersionDependencies(namespace, name, version) {
  const safeNamespace = String(namespace || '').trim()
  const safeName = String(name || '').trim()
  const safeVersion = String(version || '').trim()
  if (!safeNamespace || !safeName || !safeVersion) {
    throw new Error(uiText('ui.namespaceNameAndVersionAreRequired'))
  }

  let nextUrl = `/api/cyberstorm/package/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}/v/${encodeURIComponent(safeVersion)}/dependencies/`
  const results = []

  while (nextUrl) {
    const data = await getJson(nextUrl)
    const pageResults = Array.isArray(data?.results) ? data.results : []
    results.push(...pageResults.map((item) => normalizeCyberstormPackageDependency(item)))
    nextUrl = String(data?.next || '').trim()
  }

  return results
}

/**
 * 获取 Thunderstore 有效生态配置（用于社区 -> 游戏分发平台映射）
 * 数据源：主进程合并后的 r2modmanPlus 上游快照与 Vertex 后端 Overlay
 *
 * @returns {Promise<{
 *   schemaVersion: string,
 *   games: Record<string, any>,
 *   communities: Record<string, any>
 * }>}
 */
export function invalidateR2modmanEcosystemCache() {
  ecosystemCache = null
}

export async function getR2modmanEcosystem(options = {}) {
  ensureEcosystemUpdateListener()
  const forceRefresh = options?.forceRefresh === true
  if (ecosystemCache && !forceRefresh) {
    return ecosystemCache
  }

  let cachedRecord = null

  try {
    const raw = localStorage.getItem(R2MM_ECOSYSTEM_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        cachedRecord = parsed
      }
    }
  } catch {
    // ignore
  }

  try {
    // 优先走主进程本地/内置数据，远端更新交给主进程后台刷新。
    const data = await ipcRenderer.invoke('thunderstoreGetEcosystem', { forceRefresh })
    ecosystemCache = normalizeR2modmanEcosystemData(data)

    try {
      localStorage.setItem(
        R2MM_ECOSYSTEM_CACHE_KEY,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          data: ecosystemCache
        })
      )
    } catch {
      // ignore
    }

    return ecosystemCache
  } catch (error) {
    // 主进程异常时再回退到渲染层旧缓存，避免影响前端预览和跳转。
    if (cachedRecord?.data) {
      ecosystemCache = normalizeR2modmanEcosystemData(cachedRecord.data)
      return ecosystemCache
    }
    throw error
  }
}

/**
 * 根据 Thunderstore 社区标识查询 r2modman 游戏元信息
 *
 * @param {string} community 社区标识（如 lethal-company）
 * @returns {Promise<{
 *   community: string,
 *   gameKey: string,
 *   displayName: string,
 *   steamAppIds: number[],
 *   packageLoader: string,
 *   exeNames: string[],
 *   steamFolderName: string
 * } | null>}
 */
export async function getR2modmanGameMetaByCommunity(community) {
  const communityId = normalizeCommunityIdentifier(community)
  if (!communityId) {
    return null
  }

  const ecosystem = await getR2modmanEcosystem()
  const games = ecosystem?.games || {}
  const needle = `/c/${communityId}/api/v1/package-listing-index/`

  for (const [gameKey, gameItem] of Object.entries(games)) {
    const variants = Array.isArray(gameItem?.r2modman) ? gameItem.r2modman : []
    const matchedVariant = variants.find((variant) =>
      String(variant?.packageIndex || '')
        .toLowerCase()
        .includes(needle)
    )
    if (!matchedVariant) {
      continue
    }

    const distributions = Array.isArray(gameItem?.distributions) ? gameItem.distributions : []
    const steamAppIds = distributions
      .filter((d) => String(d?.platform || '').toLowerCase() === 'steam')
      .map((d) => Number(d?.identifier))
      .filter((id) => Number.isFinite(id) && id > 0)

    return {
      community: communityId,
      gameKey,
      displayName: String(
        matchedVariant?.meta?.displayName || gameItem?.meta?.displayName || gameKey
      ),
      steamAppIds: Array.from(new Set(steamAppIds)),
      packageLoader: String(matchedVariant?.packageLoader || ''),
      exeNames: Array.isArray(matchedVariant?.exeNames)
        ? matchedVariant.exeNames.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      steamFolderName: String(matchedVariant?.steamFolderName || '').trim()
    }
  }

  return null
}

/**
 * 根据 SteamAppId 反查 Thunderstore 社区元信息
 *
 * @param {number|string} steamAppId Steam AppId
 * @returns {Promise<{
 *   steamAppId: number,
 *   community: string,
 *   gameKey: string,
 *   displayName: string,
 *   steamAppIds: number[],
 *   packageLoader: string,
 *   exeNames: string[],
 *   steamFolderName: string
 * } | null>}
 */
export async function getR2modmanCommunityMetaBySteamAppId(steamAppId) {
  const targetAppId = Number(steamAppId)
  if (!Number.isFinite(targetAppId) || targetAppId <= 0) {
    return null
  }

  try {
    const ecosystem = await getR2modmanEcosystem()
    const games = ecosystem?.games || {}

    for (const [gameKey, gameItem] of Object.entries(games)) {
      const variants = Array.isArray(gameItem?.r2modman) ? gameItem.r2modman : []
      if (!variants.length) {
        continue
      }

      for (const variant of variants) {
        const packageIndex = String(variant?.packageIndex || '').trim()
        if (!packageIndex) {
          continue
        }

        const communityMatch = packageIndex
          .toLowerCase()
          .match(/\/c\/([^/]+)\/api\/v1\/package-listing-index\/?/)
        const community = normalizeCommunityIdentifier(communityMatch?.[1] || '')
        if (!community) {
          continue
        }

        const distributions = Array.isArray(variant?.distributions)
          ? variant.distributions
          : Array.isArray(gameItem?.distributions)
            ? gameItem.distributions
            : []
        const steamAppIds = distributions
          .filter((item) => String(item?.platform || '').toLowerCase() === 'steam')
          .map((item) => Number(item?.identifier))
          .filter((id) => Number.isFinite(id) && id > 0)
        const safeSteamAppIds = Array.from(new Set(steamAppIds))
        if (!safeSteamAppIds.includes(targetAppId)) {
          continue
        }

        return {
          steamAppId: targetAppId,
          community,
          gameKey,
          displayName: String(variant?.meta?.displayName || gameItem?.meta?.displayName || gameKey),
          steamAppIds: safeSteamAppIds,
          packageLoader: String(variant?.packageLoader || ''),
          exeNames: Array.isArray(variant?.exeNames)
            ? variant.exeNames.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
          steamFolderName: String(variant?.steamFolderName || '').trim()
        }
      }
    }
  } catch (error) {
    console.error('[Thunderstore] 通过 SteamAppId 反查社区失败', error)
    return null
  }

  return null
}

/**
 * 获取社区包索引（分片 URL 列表）
 * 接口：GET /c/{community}/api/v1/package-listing-index/
 * 注意：该接口返回 gzip 二进制 JSON（通常是 URL 数组）
 *
 * @param {string} community 社区标识（如 riskofrain2）
 * @returns {Promise<{
 *   fetchedAt: string,
 *   hash: string,
 *   chunkUrls: string[]
 * }>}
 */
export async function getCommunityPackageIndex(community) {
  if (!community) {
    throw new Error(uiText('ui.communityIsRequired'))
  }

  const endpoint = `/c/${encodeURIComponent(community)}/api/v1/package-listing-index/`
  const arrayBuffer = await getArrayBuffer(endpoint)
  const content = await parseBlobJson(arrayBuffer)
  const hash = await sha256Hex(arrayBuffer)

  if (!Array.isArray(content)) {
    throw new Error(uiText('ui.invalidCommunityPackageIndexExpectedAnArrayOfShardURLs'))
  }

  return {
    fetchedAt: new Date().toISOString(),
    hash,
    chunkUrls: content
  }
}

/**
 * 获取单个社区分片（包含包与版本列表）
 * 接口：GET {chunkUrl}
 * 注意：chunkUrl 来自 getCommunityPackageIndex 的 chunkUrls
 *
 * @param {string} chunkUrl 分片绝对 URL
 * @returns {Promise<{
 *   fetchedAt: string,
 *   hash: string,
 *   packages: Array<{
 *     full_name: string,
 *     owner: string,
 *     package_url: string,
 *     categories: string[],
 *     versions: Array<{
 *       full_name: string,
 *       version_number: string,
 *       dependencies: string[],
 *       download_url: string,
 *       file_size: number,
 *       icon: string
 *     }>
 *   }>
 * }>}
 */
export async function getCommunityPackageChunk(chunkUrl) {
  const arrayBuffer = await getArrayBuffer(chunkUrl)
  const content = await parseBlobJson(arrayBuffer)
  const hash = await sha256Hex(arrayBuffer)

  if (!Array.isArray(content)) {
    throw new Error(uiText('ui.invalidCommunityShardExpectedAnArray'))
  }

  return {
    fetchedAt: new Date().toISOString(),
    hash,
    packages: content
  }
}

/**
 * 获取社区全部包（会顺序拉取所有分片并合并）
 * 用途：本地搜索索引构建、离线筛选
 *
 * @param {string} community 社区标识
 * @param {Object} [options]
 * @param {(progress: number, loaded: number, total: number) => void} [options.onProgress] 进度回调
 * @param {number} [options.chunkLimit] 仅拉取前 N 个分片（调试或快速预览）
 * @returns {Promise<{
 *   indexHash: string,
 *   packages: any[]
 * }>}
 */
export async function getAllCommunityPackages(community, options = {}) {
  const { onProgress, chunkLimit } = options
  const indexData = await getCommunityPackageIndex(community)
  const maxCount =
    Number(chunkLimit) > 0
      ? Math.min(indexData.chunkUrls.length, Number(chunkLimit))
      : indexData.chunkUrls.length
  const selectedChunks = indexData.chunkUrls.slice(0, maxCount)
  const allPackages = []

  for (let i = 0; i < selectedChunks.length; i++) {
    const chunk = await getCommunityPackageChunk(selectedChunks[i])
    allPackages.push(...chunk.packages)
    if (typeof onProgress === 'function') {
      const progress = Math.round(((i + 1) / selectedChunks.length) * 100)
      onProgress(progress, i + 1, selectedChunks.length)
    }
  }

  return {
    indexHash: indexData.hash,
    packages: allPackages
  }
}

/**
 * 获取包详情（全站维度，不限单一社区）
 * 接口：GET /api/experimental/package/{namespace}/{name}/
 *
 * @param {string} namespace 作者/命名空间
 * @param {string} name 包名
 * @returns {Promise<{
 *   full_name: string,
 *   owner: string,
 *   package_url: string,
 *   latest: {
 *     version_number: string,
 *     dependencies: string[],
 *     download_url: string,
 *     file_size: number
 *   },
 *   community_listings: Array<{
 *     community: string,
 *     categories: string[],
 *     has_nsfw_content: boolean,
 *     review_status: string
 *   }>
 * }>}
 */
export async function getPackageDetail(namespace, name) {
  if (!namespace || !name) {
    throw new Error(uiText('ui.namespaceAndNameAreRequiredVariant2'))
  }
  return getJson(
    `/api/experimental/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`
  )
}

/**
 * 获取包版本 README（HTML）
 * 接口：GET /api/cyberstorm/package/{namespace}/{name}/v/{version}/readme/
 *
 * @param {string} namespace 作者/命名空间
 * @param {string} name 包名
 * @param {string} version 版本号（如 1.2.3）
 * @returns {Promise<{
 *   html: string
 * }>}
 */
export async function getPackageReadme(namespace, name, version) {
  if (!namespace || !name || !version) {
    throw new Error(uiText('ui.namespaceNameAndVersionAreRequired'))
  }
  return getJson(
    `/api/cyberstorm/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}/readme/`
  )
}

/**
 * 获取包版本 CHANGELOG（HTML）
 * 接口：GET /api/cyberstorm/package/{namespace}/{name}/v/{version}/changelog/
 *
 * @param {string} namespace 作者/命名空间
 * @param {string} name 包名
 * @param {string} version 版本号（如 1.2.3）
 * @returns {Promise<{
 *   html: string
 * }>}
 */
export async function getPackageChangelog(namespace, name, version) {
  if (!namespace || !name || !version) {
    throw new Error(uiText('ui.namespaceNameAndVersionAreRequired'))
  }
  return getJson(
    `/api/cyberstorm/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}/changelog/`
  )
}

/**
 * 生成包下载地址（安装流程可直接下载 zip）
 * 规则：/package/download/{namespace}/{name}/{version}/
 *
 * @param {string} namespace 作者/命名空间
 * @param {string} name 包名
 * @param {string} version 版本号
 * @returns {string} 完整下载 URL
 */
export function buildPackageDownloadUrl(namespace, name, version) {
  if (!namespace || !name || !version) {
    throw new Error(uiText('ui.namespaceNameAndVersionAreRequired'))
  }
  return `${BASE_URL}/package/download/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/`
}

/**
 * 生成包页面地址（用于“在浏览器打开”）
 *
 * @param {string} namespace 作者/命名空间
 * @param {string} name 包名
 * @returns {string} 包页面 URL
 */
export function buildPackagePageUrl(namespace, name) {
  if (!namespace || !name) {
    throw new Error(uiText('ui.namespaceAndNameAreRequiredVariant2'))
  }
  return `${BASE_URL}/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`
}

/**
 * 导出默认对象，方便统一引用
 */
const CommunityApi = {
  getCommunityList,
  getCommunityListWithCover,
  getCommunityDetailWithCover,
  getCommunityFilters,
  getCommunityModList,
  getCommunityModListPage,
  getCommunityPackageDetail,
  getCommunityPackageVersions,
  getR2modmanEcosystem,
  invalidateR2modmanEcosystemCache,
  getR2modmanGameMetaByCommunity,
  getR2modmanCommunityMetaBySteamAppId,
  getCommunityPackageIndex,
  getCommunityPackageChunk,
  getAllCommunityPackages,
  getPackageDetail,
  getPackageVersionDetail,
  getAllPackageVersionDependencies,
  getPackageReadme,
  getPackageChangelog,
  buildPackageDownloadUrl,
  buildCommunityPackagePageUrl,
  buildPackagePageUrl
}

export default CommunityApi
