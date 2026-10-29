import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { ipcMain } from '../../security/ipc.js'
import store from '../../storage/store/index.js'
import { getJobDetail, listJobs } from './source-install-task/taskStore.js'

const VAMHUB_BASE_URL = 'https://hub.virtamate.com'
const VAMHUB_API_URL = `${VAMHUB_BASE_URL}/citizenx/api.php`
const VAMHUB_COOKIE_KEY = 'systemConfig.settings.vamhubAuthCookie'
const VAMHUB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_PAGE_SIZE = 24
const MAX_BROWSE_FETCH_PAGES = 8
const resolveAbortMap = new Map()

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function normalizeHubCookieText(value = '') {
  return String(value || '')
    .replace(/[\r\n]+/g, '; ')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('; ')
}

function getSavedAuthCookie() {
  return normalizeHubCookieText(store.get(VAMHUB_COOKIE_KEY) || '')
}

export function buildVamHubCookieHeader() {
  const savedCookie = getSavedAuthCookie()
  const cookieParts = ['vamhubconsent=yes']
  if (savedCookie) {
    savedCookie
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !item.toLowerCase().startsWith('vamhubconsent='))
      .forEach((item) => cookieParts.push(item))
  }
  return cookieParts.join('; ')
}

export function buildVamHubRequestHeaders(extra = {}) {
  return {
    'User-Agent': VAMHUB_USER_AGENT,
    Accept: 'application/json,text/html,application/octet-stream,*/*',
    Referer: `${VAMHUB_BASE_URL}/`,
    Cookie: buildVamHubCookieHeader(),
    ...extra
  }
}

function toAbsoluteHubUrl(url = '') {
  const safeUrl = toSafeText(url)
  if (!safeUrl) return ''
  try {
    return new URL(safeUrl, VAMHUB_BASE_URL).toString()
  } catch {
    return safeUrl
  }
}

function normalizeHubResponseData(data) {
  if (typeof data !== 'string') {
    return data
  }
  try {
    return JSON.parse(data)
  } catch (error) {
    const summary = data.slice(0, 180).replace(/\s+/g, ' ')
    throw new Error(`Hub JSON 解析失败：${error?.message || error}；响应摘要：${summary}`)
  }
}

async function requestHubApi(body = {}, options = {}) {
  const payload = {
    source: 'VaM',
    latest_image: 'Y',
    ...toPlainJson(body, {})
  }

  try {
    const response = await axios.post(VAMHUB_API_URL, payload, {
      timeout: Number(options.timeout || 30000),
      signal: options.signal,
      headers: buildVamHubRequestHeaders({
        'Content-Type': 'application/json'
      }),
      transformResponse: [(data) => data],
      validateStatus: (status) => status >= 200 && status < 300
    })
    const data = normalizeHubResponseData(response.data)
    if (data?.status === 'error') {
      throw new Error(toSafeText(data.error, 'Hub 返回错误'))
    }
    return data
  } catch (error) {
    if (axios.isCancel?.(error) || error?.name === 'CanceledError') {
      throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
    }
    const status = error?.response?.status
    if (status) {
      throw new Error(`Hub returned unsuccessful status code: ${status}`)
    }
    throw error
  }
}

function normalizePagination(data = {}) {
  const pagination =
    data?.pagination && typeof data.pagination === 'object'
      ? data.pagination
      : data?.page && typeof data.page === 'object'
        ? data.page
        : {}
  return {
    current_page: String(
      pagination.current_page || pagination.currentPage || data.current_page || 1
    ),
    total_pages: String(pagination.total_pages || pagination.totalPages || data.total_pages || 1),
    total_found: String(pagination.total_found || pagination.total || data.total_found || 0)
  }
}

function extractResourceList(data = {}) {
  const candidates = [
    data.resources,
    data.records,
    data.results,
    data.packages,
    data.data,
    data.resource
  ]
  const list = candidates.find((item) => Array.isArray(item))
  return Array.isArray(list) ? list : []
}

function normalizeResourceSummary(item = {}) {
  const resourceId = toSafeText(item.resource_id || item.resourceId || item.id)
  return {
    ...toPlainJson(item, {}),
    resource_id: resourceId,
    title: toSafeText(item.title || item.name || resourceId, '未命名资源'),
    tag_line: toSafeText(item.tag_line || item.tagLine || item.summary),
    username: toSafeText(item.username || item.userName || item.author),
    version_string: toSafeText(item.version_string || item.versionString || item.version),
    image_url: toAbsoluteHubUrl(item.image_url || item.imageUrl || item.pictureUrl),
    icon_url: toAbsoluteHubUrl(item.icon_url || item.iconUrl),
    category: toSafeText(item.category || item.priceCategory),
    type: toSafeText(item.type || item.resource_type || item.resourceType),
    download_count: toSafeNumber(item.download_count || item.downloadCount, 0),
    view_count: toSafeNumber(item.view_count || item.viewCount, 0),
    rating_avg: toSafeNumber(item.rating_avg || item.ratingAvg || item.rating, 0),
    rating_count: toSafeNumber(item.rating_count || item.ratingCount, 0),
    last_update: item.last_update || item.lastUpdate || '',
    resource_date: item.resource_date || item.resourceDate || ''
  }
}

function dedupeResources(resources = []) {
  const map = new Map()
  resources.forEach((item) => {
    const normalized = normalizeResourceSummary(item)
    const key =
      toSafeText(normalized.resource_id) ||
      `${normalized.title}:${normalized.username}:${normalized.version_string}`.toLowerCase()
    if (key && !map.has(key)) {
      map.set(key, normalized)
    }
  })
  return [...map.values()]
}

function normalizeComparableNumber(value) {
  if (value instanceof Date) return value.getTime()
  const number = Number(value)
  if (Number.isFinite(number)) return number
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function sortResources(resources = [], sort = 'last_update') {
  const safeSort = toSafeText(sort, 'last_update')
  const stringSortSet = new Set(['title', 'username'])
  return [...resources].sort((left, right) => {
    if (stringSortSet.has(safeSort)) {
      return toSafeText(left?.[safeSort]).localeCompare(toSafeText(right?.[safeSort]), 'zh-Hans')
    }
    return (
      normalizeComparableNumber(right?.[safeSort]) - normalizeComparableNumber(left?.[safeSort])
    )
  })
}

function buildBrowseBody(payload = {}, page = 1) {
  const pricing = toSafeText(payload.pricing, 'free')
  const body = {
    action: 'getResources',
    page: Math.max(1, Math.floor(Number(page || 1))),
    search: toSafeText(payload.search || payload.keyword),
    type: toSafeText(payload.resourceType || payload.type)
  }
  if (pricing === 'free') {
    body.category = 'Free'
  } else if (pricing === 'premium' || pricing === 'paid') {
    body.category = 'Paid'
  }
  Object.keys(body).forEach((key) => {
    if (body[key] === '') {
      delete body[key]
    }
  })
  return body
}

async function browsePackages(payload = {}) {
  const page = Math.max(1, Math.floor(Number(payload.page || 1)))
  const pageSize = Math.max(1, Math.floor(Number(payload.pageSize || DEFAULT_PAGE_SIZE)))
  const first = await requestHubApi(buildBrowseBody(payload, 1))
  const firstPagination = normalizePagination(first)
  const hubTotalPages = Math.max(1, toSafeNumber(firstPagination.total_pages, 1))
  const maxPage = Math.min(hubTotalPages, MAX_BROWSE_FETCH_PAGES)
  const extraPages = []
  for (let currentPage = 2; currentPage <= maxPage; currentPage += 1) {
    extraPages.push(currentPage)
  }
  const rest = await Promise.all(
    extraPages.map((currentPage) =>
      requestHubApi(buildBrowseBody(payload, currentPage)).catch(() => ({ resources: [] }))
    )
  )
  const allResources = dedupeResources(
    [first, ...rest].flatMap((entry) => extractResourceList(entry))
  )
  const sorted = sortResources(allResources, payload.sort)
  const startIndex = (page - 1) * pageSize
  const records = sorted.slice(startIndex, startIndex + pageSize)
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))

  return {
    status: 'success',
    resources: records,
    pagination: {
      current_page: String(page),
      total_pages: String(pages),
      total_found: String(sorted.length || firstPagination.total_found || 0)
    }
  }
}

export async function browseVamHubPackages(payload = {}) {
  return await browsePackages(payload)
}

function extractDetailObject(data = {}) {
  const candidates = [
    data.resource,
    data.detail,
    data.package,
    data.data,
    data.result,
    Array.isArray(data.resources) ? data.resources[0] : null
  ]
  return candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)) || data
}

function normalizeHubFile(file = {}) {
  const fileName = toSafeText(file.filename || file.fileName || file.name)
  const downloadUrl = toAbsoluteHubUrl(
    file.downloadUrl || file.download_url || file.urlHosted || file.url || file.href
  )
  return {
    ...toPlainJson(file, {}),
    filename: fileName,
    file_size: toSafeText(file.file_size || file.fileSize || file.size),
    creatorName: toSafeText(file.creatorName || file.creator || file.username),
    licenseType: toSafeText(file.licenseType || file.license_type || file.license),
    urlHosted: downloadUrl,
    downloadUrl
  }
}

function normalizeDependency(dep = {}, defaults = {}) {
  const filename = toSafeText(dep.filename || dep.fileName)
  const packageName = toSafeText(dep.packageName || dep.package_name || dep.name || filename)
  const downloadUrl = toAbsoluteHubUrl(
    dep.downloadUrl || dep.download_url || dep.latestUrl || dep.latest_url || dep.url || dep.href
  )
  return {
    ...toPlainJson(dep, {}),
    packageName,
    filename,
    username: toSafeText(dep.username || dep.creator || dep.creatorName),
    licenseType: toSafeText(dep.licenseType || dep.license_type || dep.license),
    version: toSafeText(dep.version || dep.latest_version || dep.latestVersion),
    downloadUrl,
    file_size: toSafeText(dep.file_size || dep.fileSize || dep.size),
    resource_id: toSafeText(dep.resource_id || dep.resourceId),
    latest_version: toSafeText(dep.latest_version || dep.latestVersion),
    latestUrl: toAbsoluteHubUrl(dep.latestUrl || dep.latest_url || dep.latestDownloadUrl),
    dependencyType: toSafeText(dep.dependencyType || dep.dependency_type, defaults.dependencyType),
    tier: toSafeNumber(dep.tier, defaults.tier ?? 0)
  }
}

function normalizeDependencyGroups(dependencies) {
  const groups = {
    direct: [],
    sub: []
  }
  if (Array.isArray(dependencies)) {
    groups.direct = dependencies.map((item) =>
      normalizeDependency(item, { dependencyType: 'direct' })
    )
    return groups
  }
  if (!dependencies || typeof dependencies !== 'object') {
    return groups
  }
  Object.entries(dependencies).forEach(([key, value]) => {
    const list = Array.isArray(value) ? value : value ? [value] : []
    const groupKey = key.toLowerCase().includes('sub') ? 'sub' : 'direct'
    groups[groupKey].push(
      ...list.map((item) =>
        normalizeDependency(item, {
          dependencyType: groupKey
        })
      )
    )
  })
  return groups
}

function normalizePackageDetail(data = {}, fallback = {}) {
  const detail = extractDetailObject(data)
  const hubFiles = Array.isArray(detail.hubFiles)
    ? detail.hubFiles
    : Array.isArray(detail.hub_files)
      ? detail.hub_files
      : Array.isArray(detail.files)
        ? detail.files
        : []
  return {
    ...toPlainJson(detail, {}),
    title: toSafeText(detail.title || detail.name || fallback.packageName, '未命名资源'),
    tag_line: toSafeText(detail.tag_line || detail.tagLine || detail.summary),
    username: toSafeText(detail.username || detail.userName || detail.author),
    version_string: toSafeText(detail.version_string || detail.versionString || detail.version),
    description: toSafeText(detail.description || detail.desc),
    download_count: toSafeText(detail.download_count || detail.downloadCount),
    rating_avg: toSafeText(detail.rating_avg || detail.ratingAvg || detail.rating),
    image_url: toAbsoluteHubUrl(detail.image_url || detail.imageUrl || detail.pictureUrl),
    icon_url: toAbsoluteHubUrl(detail.icon_url || detail.iconUrl),
    resource_id: toSafeText(detail.resource_id || detail.resourceId || fallback.resourceId),
    category: toSafeText(detail.category),
    view_count: toSafeText(detail.view_count || detail.viewCount),
    rating_count: toSafeText(detail.rating_count || detail.ratingCount),
    dependency_count: toSafeNumber(detail.dependency_count || detail.dependencyCount, 0),
    hubFiles: hubFiles.map((file) => normalizeHubFile(file)),
    dependencies: normalizeDependencyGroups(detail.dependencies || detail.dependency || {})
  }
}

function buildDetailBody(packageName = '') {
  const safePackageName = toSafeText(packageName)
  const isResourceId = /^\d+$/.test(safePackageName)
  return {
    action: 'getResourceDetail',
    ...(isResourceId ? { resource_id: safePackageName } : { package_name: safePackageName })
  }
}

async function getPackageBasic(payload = {}, options = {}) {
  const packageName = toSafeText(payload.packageName || payload.resourceId || payload.resource_id)
  if (!packageName) {
    throw new Error('缺少 VAM-Hub 资源标识')
  }
  const data = await requestHubApi(buildDetailBody(packageName), options)
  return normalizePackageDetail(data, {
    packageName,
    resourceId: /^\d+$/.test(packageName) ? packageName : ''
  })
}

export async function getVamHubPackageBasic(payload = {}, options = {}) {
  return await getPackageBasic(payload, options)
}

function parseResourceIdFromHref(href = '') {
  const match = toSafeText(href).match(/\/resources\/(?:[^/]*\.)?(\d+)(?:\/|$)/i)
  return match ? match[1] : ''
}

async function fetchDependencyHtml(resourceId = '', options = {}) {
  const safeResourceId = toSafeText(resourceId)
  if (!safeResourceId) return ''
  try {
    const response = await axios.get(
      `${VAMHUB_BASE_URL}/resources/${safeResourceId}/dependencies`,
      {
        timeout: 30000,
        signal: options.signal,
        responseType: 'text',
        headers: buildVamHubRequestHeaders({
          Accept: 'text/html,*/*'
        }),
        validateStatus: (status) => status >= 200 && status < 300
      }
    )
    return String(response.data || '')
  } catch (error) {
    if (axios.isCancel?.(error) || error?.name === 'CanceledError') {
      throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
    }
    return ''
  }
}

function htmlUnescapeMinimal(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function splitDependencyFullName(fullName = '') {
  const text = toSafeText(fullName)
  const idx = text.lastIndexOf('.')
  if (idx > 0) {
    const pkg = text.slice(0, idx)
    const ver = text.slice(idx + 1)
    if (ver.toLowerCase() === 'latest' || /^\d+$/.test(ver)) {
      return { packageName: pkg, version: ver }
    }
  }
  return { packageName: text, version: '' }
}

// 与 vam-box 的 parse_dependency_section 对齐：用 dataList 表格行正则精确解析 VAM-Hub 依赖页
function parseDependencySection(html = '', dependencyType = 'direct') {
  const safeHtml = toSafeText(html)
  if (!safeHtml) return []
  const rowRe = /<tr class="dataList-row">([\s\S]*?)<\/tr>/g
  const packageRe = /<td class="dataList-cell">\s*<a href="(\/resources\/[^"]+\/)">([^<]+)<\/a>/
  const licenseRe = /<span class="label[^"]*"[^>]*>([^<]+)<\/span>/
  const tierRe = /<td class="dataList-cell">(\d+)<\/td>/
  const downloadRe = /href="([^"]+\/download[^"]*)"/

  const deps = []
  let rowMatch
  while ((rowMatch = rowRe.exec(safeHtml)) !== null) {
    const rowHtml = rowMatch[1]
    const pkgMatch = packageRe.exec(rowHtml)
    if (!pkgMatch) continue
    const href = pkgMatch[1]
    const fullName = htmlUnescapeMinimal(pkgMatch[2].trim())
    if (!fullName) continue
    const { packageName, version } = splitDependencyFullName(fullName)
    const resourceId = parseResourceIdFromHref(href)
    const tierMatch = tierRe.exec(rowHtml)
    const tier = tierMatch ? Number(tierMatch[1]) : dependencyType === 'direct' ? 1 : 2
    const licenseMatch = licenseRe.exec(rowHtml)
    const licenseType = licenseMatch ? htmlUnescapeMinimal(licenseMatch[1].trim()) : ''
    const downloadMatch = downloadRe.exec(rowHtml)
    let downloadUrl = ''
    if (downloadMatch) {
      const url = downloadMatch[1].replace(/&amp;/g, '&')
      downloadUrl = url.startsWith('http') ? url : `${VAMHUB_BASE_URL}${url}`
    }
    const fileName = fullName.toLowerCase().endsWith('.var') ? fullName : `${fullName}.var`

    deps.push(
      normalizeDependency(
        {
          packageName,
          filename: fileName,
          resource_id: resourceId,
          version,
          licenseType,
          downloadUrl,
          tier
        },
        { dependencyType, tier }
      )
    )
  }
  return deps
}

function parseDependenciesFromHtml(html = '') {
  const safeHtml = toSafeText(html)
  if (!safeHtml) return []

  // 与 vam-box 的 parse_dependency_page 对齐：先定位 Direct/Sub 文本锚点再分段解析
  const directStart = safeHtml.indexOf('Direct Dependencies')
  if (directStart === -1) return []
  const subStart = safeHtml.indexOf('Sub-dependencies')

  const directHtml =
    subStart !== -1 && subStart > directStart
      ? safeHtml.slice(directStart, subStart)
      : safeHtml.slice(directStart)

  let deps = parseDependencySection(directHtml, 'direct')
  if (subStart !== -1) {
    deps = deps.concat(parseDependencySection(safeHtml.slice(subStart), 'sub'))
  }

  const map = new Map()
  deps.forEach((item) => {
    const key = [item.dependencyType, item.resource_id, item.packageName, item.filename].join(':')
    if (!map.has(key)) {
      map.set(key, item)
    }
  })
  return [...map.values()]
}

function flattenDependencyGroups(groups = {}) {
  if (Array.isArray(groups)) {
    return groups.map((item) => normalizeDependency(item))
  }
  return Object.values(groups || {})
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((item) => normalizeDependency(item))
}

function mergeDependencyGroups(apiGroups = {}, htmlDeps = []) {
  const result = {
    ...apiGroups,
    direct: Array.isArray(apiGroups.direct) ? [...apiGroups.direct] : [],
    sub: Array.isArray(apiGroups.sub) ? [...apiGroups.sub] : []
  }
  const known = new Set(
    flattenDependencyGroups(result).map((item) =>
      [item.dependencyType, item.resource_id, item.packageName, item.filename].join(':')
    )
  )

  htmlDeps.forEach((dep) => {
    const normalized = normalizeDependency(dep)
    const key = [
      normalized.dependencyType,
      normalized.resource_id,
      normalized.packageName,
      normalized.filename
    ].join(':')
    if (known.has(key)) return
    known.add(key)
    const groupKey = normalized.dependencyType === 'sub' ? 'sub' : 'direct'
    result[groupKey].push(normalized)
  })
  return result
}

async function getPackageDetail(payload = {}, options = {}) {
  const detail = await getPackageBasic(payload, options)
  const html = await fetchDependencyHtml(detail.resource_id, options)
  const htmlDeps = parseDependenciesFromHtml(html)
  return {
    ...detail,
    dependencies: mergeDependencyGroups(detail.dependencies || {}, htmlDeps),
    dependency_page_loaded: !!html,
    dependency_page_warning:
      detail.resource_id && !html ? '依赖页拉取失败，已使用 API 依赖字段' : ''
  }
}

export async function getVamHubPackageDetail(payload = {}, options = {}) {
  return await getPackageDetail(payload, options)
}

function normalizePackageFileName(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

function parseVamPackage(value = '', fallbackVersion = 0) {
  const base = toSafeText(value).replace(/\.var$/i, '')
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 2) {
    return {
      creator: '',
      name: base,
      version: Number(fallbackVersion || 0),
      sourceModKey: base,
      id: base
    }
  }
  const creator = parts[0]
  const last = parts[parts.length - 1]
  const parsedVersion = /^\d+$/.test(last) ? Number(last) : Number(fallbackVersion || 0)
  const nameParts =
    /^\d+$/.test(last) || last.toLowerCase() === 'latest' ? parts.slice(1, -1) : parts.slice(1)
  const name = nameParts.join('.') || parts.slice(1).join('.')
  const sourceModKey = [creator, name].filter(Boolean).join('.')
  const version = parsedVersion || 1
  const id = [sourceModKey, version].filter(Boolean).join('.')
  return {
    creator,
    name,
    version,
    sourceModKey,
    id
  }
}

function parseFileSizeBytes(value = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = toSafeText(value)
  if (!text) return 0
  const number = Number(text.replace(/,/g, '').match(/[\d.]+/)?.[0] || 0)
  if (!Number.isFinite(number)) return 0
  const lower = text.toLowerCase()
  if (lower.includes('gb')) return Math.round(number * 1024 * 1024 * 1024)
  if (lower.includes('mb')) return Math.round(number * 1024 * 1024)
  if (lower.includes('kb')) return Math.round(number * 1024)
  return Math.round(number)
}

function getAddonPackagesRoot(gameRoot = '') {
  const safeRoot = toSafeText(gameRoot)
  return safeRoot ? path.join(safeRoot, 'AddonPackages') : ''
}

function scanInstalledVamPackages(gameRoot = '') {
  const addonRoot = getAddonPackagesRoot(gameRoot)
  const map = new Map()
  if (!addonRoot || !fs.existsSync(addonRoot)) {
    return map
  }
  const files = fs.readdirSync(addonRoot, { withFileTypes: true })
  files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.var'))
    .forEach((entry) => {
      const parsed = parseVamPackage(entry.name)
      if (!parsed.sourceModKey) return
      const current = map.get(parsed.sourceModKey)
      if (!current || parsed.version > current.version) {
        map.set(parsed.sourceModKey, {
          ...parsed,
          filename: entry.name,
          filePath: path.join(addonRoot, entry.name)
        })
      }
    })
  return map
}

function collectQueuedVamPackages() {
  const activeStates = new Set([
    'created',
    'prechecking',
    'precheck_blocked',
    'resolving',
    'queued',
    'downloading',
    'downloaded',
    'previewing',
    'installing',
    'health_checking',
    'waiting'
  ])
  const map = new Map()
  const jobs = listJobs({ source: 'vamhub', pageSize: 100 })?.records || []
  jobs
    .filter((job) => activeStates.has(toSafeText(job.state)))
    .forEach((job) => {
      const detail = getJobDetail(job.job_id)
      const items = Array.isArray(detail?.items) ? detail.items : []
      items.forEach((item) => {
        const installPayload = item.metadata?.installPayload || {}
        const sourceModKey = toSafeText(
          installPayload.sourceModKey ||
            installPayload.source_mod_key ||
            item.source_mod_key ||
            installPayload.modId
        )
        const parsed = parseVamPackage(
          installPayload.id || installPayload.fileName || item.version,
          installPayload.version
        )
        const key = sourceModKey || parsed.sourceModKey
        if (!key) return
        const current = map.get(key)
        const version = toSafeNumber(installPayload.version || parsed.version, 1)
        if (!current || version > current.version) {
          map.set(key, {
            sourceModKey: key,
            version,
            itemId: item.item_id,
            jobId: job.job_id
          })
        }
      })
    })
  return map
}

function resolvePrimaryHubFile(detail = {}) {
  const files = Array.isArray(detail.hubFiles) ? detail.hubFiles : []
  return files.find((file) => file.downloadUrl || file.urlHosted) || files[0] || {}
}

function buildResolvedDependency(dep = {}, context = {}) {
  const fileName = normalizePackageFileName(dep.filename || dep.packageName || dep.id)
  const parsed = parseVamPackage(fileName || dep.packageName, dep.latest_version || dep.version)
  const installed = context.installedMap.get(parsed.sourceModKey)
  const queued = context.queuedMap.get(parsed.sourceModKey)
  const downloadUrl = toSafeText(dep.downloadUrl || dep.latestUrl || dep.download_url)
  let status = 'no_source'
  if (installed && installed.version >= parsed.version) {
    status = 'installed'
  } else if (queued && queued.version >= parsed.version) {
    status = 'queued'
  } else if ((installed || queued) && downloadUrl) {
    status = 'upgraded'
  } else if (downloadUrl) {
    status = 'need_download'
  }

  return {
    id: parsed.id,
    filename: fileName,
    creator: parsed.creator,
    name: parsed.name,
    version: parsed.version,
    file_size: toSafeText(dep.file_size),
    file_size_bytes: parseFileSizeBytes(dep.file_size),
    download_url: downloadUrl,
    status,
    installed_version: installed?.version ?? null,
    queued_version: queued?.version ?? null,
    resource_id: toSafeText(dep.resource_id),
    packageName: toSafeText(dep.packageName || fileName.replace(/\.var$/i, '')),
    licenseType: toSafeText(dep.licenseType),
    dependencyType: toSafeText(dep.dependencyType),
    tier: toSafeNumber(dep.tier, 0)
  }
}

function addDependencyCandidate(map, dep = {}, fallback = {}) {
  const normalized = normalizeDependency(dep, fallback)
  const key =
    toSafeText(normalized.packageName) ||
    toSafeText(normalized.filename) ||
    toSafeText(normalized.resource_id)
  if (!key) return
  const existing = map.get(key) || {}
  map.set(key, {
    ...existing,
    ...normalized,
    downloadUrl: toSafeText(existing.downloadUrl || normalized.downloadUrl || normalized.latestUrl),
    filename: toSafeText(existing.filename || normalized.filename),
    packageName: toSafeText(existing.packageName || normalized.packageName),
    dependencyType: toSafeText(existing.dependencyType || normalized.dependencyType),
    parentPackageId: fallback.parentPackageId || existing.parentPackageId || ''
  })
}

function emitResolveProgress(event, payload = {}) {
  event?.sender?.send?.('vamhub:resolve-dependencies-progress', payload)
}

async function resolveDependencies(event, payload = {}) {
  const packageName = toSafeText(payload.packageName || payload.resourceId)
  if (!packageName) {
    throw new Error('缺少 VAM-Hub 资源标识')
  }
  const controller = new AbortController()
  resolveAbortMap.set(packageName, controller)
  const maxDepth = Math.max(0, Math.min(6, Number(payload.maxDepth ?? 3)))
  const includeSubDependencies = payload.includeSubDependencies !== false
  const gameRoot = toSafeText(payload.gameRoot || payload.gameRootPath)
  const installedMap = scanInstalledVamPackages(gameRoot)
  const queuedMap = collectQueuedVamPackages()
  const providedMainDetail =
    payload.mainDetail && typeof payload.mainDetail === 'object' ? payload.mainDetail : null
  const candidates = new Map()
  const visited = new Set()
  let mainDetail = null
  let resolvedCount = 0

  const isCancelled = () => controller.signal.aborted
  const throwIfCancelled = () => {
    if (isCancelled()) {
      const err = new Error('CANCELLED')
      err.code = 'CANCELLED'
      throw err
    }
  }

  const fetchPackage = async (pkgName) => {
    if (isCancelled()) return null
    const fetchOptions = { signal: controller.signal, timeout: 30000 }
    try {
      // 递归解析后续层只用 basic（API 已含 dependencies 列表），省掉 HTML 抓取，与 vam-box 的 fetch_hub_package_info_basic 等价
      return await getPackageBasic({ packageName: pkgName }, fetchOptions)
    } catch (error) {
      if (
        axios.isCancel?.(error) ||
        error?.name === 'CanceledError' ||
        error?.code === 'CANCELLED' ||
        error?.message === 'CANCELLED'
      ) {
        return null
      }
      console.warn(`[VAM-Hub] 解析依赖获取失败: ${pkgName}`, error?.message || error)
      return null
    }
  }

  // 主包需要含依赖页解析（dataList 表格）的完整详情，与 vam-box 的 fetch_hub_package_info(enrich=true) 等价
  const fetchPackageEnriched = async (pkgName) => {
    if (isCancelled()) return null
    const fetchOptions = { signal: controller.signal, timeout: 30000 }
    try {
      return await getPackageDetail({ packageName: pkgName }, fetchOptions)
    } catch (error) {
      if (
        axios.isCancel?.(error) ||
        error?.name === 'CanceledError' ||
        error?.code === 'CANCELLED' ||
        error?.message === 'CANCELLED'
      ) {
        return null
      }
      console.warn(`[VAM-Hub] 解析主包详情失败: ${pkgName}`, error?.message || error)
      return null
    }
  }

  const BATCH_SIZE = 15
  let currentLayer = []
  let depth = 0

  // 把一个包的 dependencies 收集进 candidates，并按需把子依赖推入下一层
  const collectDepsIntoCandidates = (item, detail) => {
    if (!detail) return
    const deps = flattenDependencyGroups(detail.dependencies).filter(
      (dep) => includeSubDependencies || dep.dependencyType !== 'sub'
    )
    deps.forEach((dep) => {
      addDependencyCandidate(candidates, dep, {
        parentPackageId: detail.resource_id || item.packageName,
        dependencyType: dep.dependencyType || item.role
      })
      if (item.depth >= maxDepth) return

      const depFileName = toSafeText(dep.filename || dep.packageName)
      const depParsed = parseVamPackage(depFileName, dep.version || dep.latest_version)
      const requiredVersion = Number(depParsed.version || 0) || 0
      const installed = installedMap.get(depParsed.sourceModKey)
      const queued = queuedMap.get(depParsed.sourceModKey)
      const alreadySatisfied =
        (installed && Number(installed.version) >= requiredVersion) ||
        (queued && Number(queued.version) >= requiredVersion)
      if (alreadySatisfied) return

      const nextPackage = toSafeText(dep.resource_id || dep.packageName)
      if (nextPackage && !visited.has(nextPackage)) {
        visited.add(nextPackage)
        currentLayer.push({
          packageName: nextPackage,
          depth: item.depth + 1,
          role: dep.dependencyType || 'direct'
        })
      }
    })
  }

  // 主包：优先复用前端已加载且确实含依赖的 mainDetail；若前端传的是列表摘要（无依赖页解析结果），
  // 则在后端用 getPackageDetail 重新抓依赖页，保证主包依赖一定被解析（避免“未解析到依赖”）
  const providedHasDeps =
    providedMainDetail && flattenDependencyGroups(providedMainDetail.dependencies).length > 0
  let resolvedMainDetail = providedHasDeps ? providedMainDetail : null
  if (!resolvedMainDetail) {
    resolvedMainDetail = await fetchPackageEnriched(packageName)
  }
  if (!resolvedMainDetail) {
    resolvedMainDetail = providedMainDetail
  }

  if (resolvedMainDetail) {
    mainDetail = resolvedMainDetail
    if (!visited.has(packageName)) visited.add(packageName)
    resolvedCount += 1
    emitResolveProgress(event, {
      resolved_count: resolvedCount,
      total_discovered: visited.size,
      current_package: packageName
    })
    collectDepsIntoCandidates({ packageName, depth: 0, role: 'main' }, resolvedMainDetail)
  } else {
    currentLayer.push({ packageName, depth: 0, role: 'main' })
  }

  try {
    while (currentLayer.length && depth < maxDepth) {
      throwIfCancelled()

      // 本层去重（visited 已在推入时标记，这里只过滤已 visited 的）
      const toFetch = currentLayer.filter((item) => {
        const key = toSafeText(item.packageName || item.resourceId)
        return !!key
      })
      if (!toFetch.length) break

      const layerResults = []

      // 分批并行请求（每批 15 个），与 vam-box 的 chunks(15) + join_all 等价
      for (let offset = 0; offset < toFetch.length; offset += BATCH_SIZE) {
        throwIfCancelled()
        const batch = toFetch.slice(offset, offset + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const pkgKey = toSafeText(item.packageName || item.resourceId)
            const detail = await fetchPackage(pkgKey)
            return { item, detail }
          })
        )

        for (const { item, detail } of batchResults) {
          layerResults.push({ item, detail })
          if (!detail) continue
          resolvedCount += 1
        }

        emitResolveProgress(event, {
          resolved_count: resolvedCount,
          total_discovered: visited.size,
          current_package: toSafeText(batch[batch.length - 1]?.packageName || '')
        })
      }

      // 收集本层所有包的 deps，并构建下一层（已满足的依赖跳过，减少 API 调用）
      // 注意：与 vam-box 对齐，只把 dep 收集进 candidates，不收集依赖自身的 primaryFile
      const nextLayer = []
      for (const { item, detail } of layerResults) {
        if (!detail) continue
        const deps = flattenDependencyGroups(detail.dependencies).filter(
          (dep) => includeSubDependencies || dep.dependencyType !== 'sub'
        )
        deps.forEach((dep) => {
          addDependencyCandidate(candidates, dep, {
            parentPackageId: detail.resource_id || item.packageName,
            dependencyType: dep.dependencyType || item.role
          })
          if (item.depth + 1 >= maxDepth) return

          const depFileName = toSafeText(dep.filename || dep.packageName)
          const depParsed = parseVamPackage(depFileName, dep.version || dep.latest_version)
          const requiredVersion = Number(depParsed.version || 0) || 0
          const installed = installedMap.get(depParsed.sourceModKey)
          const queued = queuedMap.get(depParsed.sourceModKey)
          const alreadySatisfied =
            (installed && Number(installed.version) >= requiredVersion) ||
            (queued && Number(queued.version) >= requiredVersion)
          if (alreadySatisfied) return

          const nextPackage = toSafeText(dep.resource_id || dep.packageName)
          if (nextPackage && !visited.has(nextPackage)) {
            visited.add(nextPackage)
            nextLayer.push({
              packageName: nextPackage,
              depth: item.depth + 1,
              role: dep.dependencyType || 'direct'
            })
          }
        })
      }

      currentLayer = nextLayer
      depth += 1
    }
  } finally {
    resolveAbortMap.delete(packageName)
  }

  const context = { installedMap, queuedMap }
  const dependencies = [...candidates.values()]
    .map((dep) => buildResolvedDependency(dep, context))
    .filter((dep) => dep.id || dep.filename)
  const mainFile = resolvePrimaryHubFile(mainDetail || {})
  const mainFileName = normalizePackageFileName(
    mainFile.filename || mainDetail?.title || packageName
  )

  return {
    main_package_id: parseVamPackage(mainFileName).id || packageName,
    main_package_filename: mainFileName,
    total_size_bytes: dependencies.reduce(
      (sum, item) => sum + Number(item.file_size_bytes || 0),
      0
    ),
    dependencies
  }
}

export async function resolveVamHubDependencies(payload = {}) {
  return await resolveDependencies(null, payload)
}

async function resolveDownloadUrl(payload = {}) {
  const rawUrl = toAbsoluteHubUrl(payload.downloadUrl || payload.url)
  if (!rawUrl) {
    return { success: false, downloadUrl: '', message: '缺少下载地址' }
  }

  try {
    const head = await axios.head(rawUrl, {
      timeout: 15000,
      maxRedirects: 5,
      headers: buildVamHubRequestHeaders({
        Accept: 'application/octet-stream,application/zip,*/*'
      }),
      validateStatus: (status) => status >= 200 && status < 400
    })
    const contentType = toSafeText(head.headers?.['content-type']).toLowerCase()
    const finalUrl = toSafeText(head.request?.res?.responseUrl || rawUrl)
    if (contentType && !contentType.includes('text/html')) {
      return { success: true, downloadUrl: finalUrl }
    }
  } catch {
    // HEAD 失败时继续尝试按 HTML 下载页解析。
  }

  try {
    const response = await axios.get(rawUrl, {
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text',
      maxContentLength: 1024 * 1024,
      headers: buildVamHubRequestHeaders({
        Accept: 'text/html,*/*'
      }),
      validateStatus: (status) => status >= 200 && status < 400
    })
    const html = String(response.data || '')
    const match = html.match(
      /https:\/\/hub\.virtamate\.com\/internal_data\/attachments\/[^"'\s<>]+\.data|\/internal_data\/attachments\/[^"'\s<>]+\.data/i
    )
    if (match) {
      return { success: true, downloadUrl: toAbsoluteHubUrl(match[0]) }
    }
    const contentType = toSafeText(response.headers?.['content-type']).toLowerCase()
    if (!contentType.includes('text/html')) {
      return {
        success: true,
        downloadUrl: toSafeText(response.request?.res?.responseUrl || rawUrl)
      }
    }
    return {
      success: false,
      downloadUrl: rawUrl,
      message: '下载页未找到真实附件地址，可能需要登录或 Hub 页面已变更'
    }
  } catch (error) {
    return {
      success: false,
      downloadUrl: rawUrl,
      message: String(error?.message || '解析下载地址失败')
    }
  }
}

function registerHandle(channel, handler) {
  ipcMain.handle(channel, async (event, payload = {}) => {
    try {
      return await handler(event, payload)
    } catch (error) {
      if (error?.code === 'CANCELLED' || error?.message === 'CANCELLED') {
        return { status: 'error', error: 'CANCELLED' }
      }
      return {
        status: 'error',
        error: String(error?.message || error || 'VAM-Hub 请求失败')
      }
    }
  })
}

export function vamhubIndex() {
  registerHandle('vamhub:browse-packages', async (_event, payload = {}) => browsePackages(payload))

  registerHandle('vamhub:get-package-basic', async (_event, payload = {}) => {
    return await getPackageBasic(payload)
  })

  registerHandle('vamhub:get-package-detail', async (_event, payload = {}) => {
    return await getPackageDetail(payload)
  })

  registerHandle('vamhub:resolve-dependencies', async (event, payload = {}) => {
    return await resolveDependencies(event, payload)
  })

  registerHandle('vamhub:cancel-resolve-dependencies', async (_event, payload = {}) => {
    const packageName = toSafeText(payload.packageName || payload.resourceId)
    const controller = resolveAbortMap.get(packageName)
    if (controller) {
      controller.abort()
      resolveAbortMap.delete(packageName)
    }
    return { success: true }
  })

  registerHandle('vamhub:get-login-status', async () => ({
    loggedIn: !!getSavedAuthCookie()
  }))

  registerHandle('vamhub:save-auth-cookie', async (_event, payload = {}) => {
    const cookie = normalizeHubCookieText(payload.cookie || '')
    store.set(VAMHUB_COOKIE_KEY, cookie)
    return { success: true, loggedIn: !!cookie }
  })

  registerHandle('vamhub:resolve-download-url', async (_event, payload = {}) => {
    return await resolveDownloadUrl(payload)
  })
}
