import {
  getSourcePlatformCapabilityFlags,
  getSourcePlatformDefinition,
  normalizeSourcePlatform,
  resolveBusinessSource
} from '../../sources/source-platform-registry.js'

const SENSITIVE_KEY_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session)/i
const SENSITIVE_URL_PARAM_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session|access.?token|refresh.?token|signature|credential|policy|expires|key.?pair.?id|^key$|^sig$)/i
const INLINE_URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/gi
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi
const PRIVATE_PATH_LIST_KEY_PATTERN = /^(private.?paths?|path.?list|paths?)$/i
const ALLOWED_CONTEXT_PATH_FIELD_KEYS = Object.freeze(
  new Set([
    'installRoot',
    'gameRoot',
    'gameRootPath',
    'clientRootPath',
    'executableFile',
    'clientExePath',
    'gameExePath'
  ])
)
const ALLOWED_CONTEXT_PATH_ROOT_SECTIONS = Object.freeze(
  new Set(['game', 'install', 'thunderstore'])
)
const PAGE_CONTEXT_TOP_LEVEL_FIELDS = Object.freeze(
  new Set([
    'displaySource',
    'businessSource',
    'sourceGameId',
    'sourceSlug',
    'sourceLabel',
    'businessSourceLabel',
    'sourceStatus',
    'route',
    'page',
    'game',
    'mod',
    'search',
    'install',
    'installTask',
    'capabilities',
    'auth',
    'sourceState',
    'thunderstore'
  ])
)
const PAGE_CONTEXT_SECTION_FIELDS = Object.freeze({
  route: Object.freeze(new Set(['path', 'name'])),
  page: Object.freeze(
    new Set([
      'type',
      'title',
      'source',
      'displaySource',
      'businessSource',
      'sourceLabel',
      'businessSourceLabel',
      'scene'
    ])
  ),
  game: Object.freeze(
    new Set([
      'gameId',
      'id',
      'name',
      'englishName',
      'source',
      'displaySource',
      'businessSource',
      'sourceGameId',
      'sourceSlug',
      'steamAppId',
      'appId',
      'domainName',
      'gameDomainName',
      'nexusGameDomain',
      'community',
      'packageLoader',
      'gameRootConfigured',
      'bindingConfigured',
      'installRoot',
      'gameRoot',
      'gameRootPath',
      'clientRootPath',
      'executableFile',
      'clientExePath',
      'gameExePath',
      'profileName',
      'profile'
    ])
  ),
  mod: Object.freeze(
    new Set([
      'modId',
      'id',
      'source',
      'displaySource',
      'businessSource',
      'name',
      'title',
      'author',
      'version',
      'selectedVersionId',
      'selectedVersionName',
      'selectedVersion',
      'fileId',
      'fileName',
      'resourceId',
      'packageName',
      'selectedFileId',
      'selectedFileName',
      'loader',
      'packageLoader',
      'fileSize',
      'downloadAvailable',
      'downloadUrl',
      'dependencyCount',
      'versions',
      'files',
      'selectedFile'
    ])
  ),
  search: Object.freeze(
    new Set([
      'keyword',
      'sort',
      'filters',
      'page',
      'pageSize',
      'selectedIds',
      'selectedRecord',
      'selectedRecords'
    ])
  ),
  install: Object.freeze(
    new Set([
      'ruleConfigured',
      'bindingConfigured',
      'ruleStatus',
      'bindingStatus',
      'taskSummary',
      'canCreateInstallPlan',
      'installRoot',
      'installDirectory',
      'profileName',
      'profile'
    ])
  ),
  installTask: Object.freeze(
    new Set(['activeCount', 'waitingCount', 'failedCount', 'visibleCount'])
  ),
  capabilities: Object.freeze(
    new Set([
      'canSearchMods',
      'canCreateInstallPlan',
      'canSubmitInstallTask',
      'needNexusApiKey',
      'needModioApiKey',
      'aiSearch',
      'aiDetail',
      'aiInstallPlan',
      'install',
      'displaySource',
      'businessSource'
    ])
  ),
  auth: Object.freeze(
    new Set(['source', 'status', 'configured', 'required', 'credentialType', 'helpUrl', 'helpText'])
  ),
  thunderstore: Object.freeze(
    new Set([
      'community',
      'gameName',
      'profileName',
      'gameExePath',
      'totalPackageCount',
      'totalDownloadCount',
      'hasModManagerSupport',
      'installed'
    ])
  ),
  sourceState: Object.freeze(new Set(['source', 'status', 'label', 'configured', 'summary']))
})
const PAGE_CONTEXT_WILDCARD_SECTIONS = Object.freeze(
  new Set([
    'search.filters',
    'search.selectedRecord',
    'search.selectedRecords',
    'mod.files',
    'mod.versions',
    'mod.selectedVersion',
    'mod.selectedFile',
    'install.ruleStatus',
    'install.bindingStatus',
    'install.installDirectory',
    'install.profile',
    'install.taskSummary'
  ])
)
const SAFE_SENSITIVE_CONTEXT_FIELD_PATHS = Object.freeze(
  new Set(['capabilities.needNexusApiKey', 'capabilities.needModioApiKey'])
)

const ROUTE_PAGE_MAP = Object.freeze({
  Home: { type: 'home', title: '首页', scene: 'home' },
  Game: { type: 'game_center', title: '模组中心', scene: 'game_center' },
  GameDetails: { type: 'game_detail', title: '游戏详情', scene: 'game_detail' },
  GameModList: { type: 'mod_list', title: 'Vertex 模组列表', scene: 'mod_list', source: 'vertex' },
  GameModDetails: { type: 'mod_detail', title: '模组详情', scene: 'mod_detail', source: 'vertex' },
  GameSiteDetail: { type: 'mod_detail', title: '来源模组详情', scene: 'mod_detail' },
  GameModManagement: { type: 'mod_management', title: '模组管理', scene: 'mod_management' },
  GameThunderStoreModList: {
    type: 'source_mod_list',
    title: 'Thunderstore 模组列表',
    scene: 'source_mod_list',
    source: 'thunderstore'
  },
  GameFicsitModList: {
    type: 'source_mod_list',
    title: 'Ficsit 模组列表',
    scene: 'source_mod_list',
    source: 'ficsit'
  },
  GameNexusModList: {
    type: 'source_mod_list',
    title: 'Nexus 模组列表',
    scene: 'source_mod_list',
    source: 'nexus'
  },
  GameModioModList: {
    type: 'source_mod_list',
    title: 'Mod.io 模组列表',
    scene: 'source_mod_list',
    source: 'modio'
  },
  GameVamHubModList: {
    type: 'source_mod_list',
    title: 'VAM-Hub 模组列表',
    scene: 'source_mod_list',
    source: 'vamhub'
  },
  GameSourceInstallConfig: {
    type: 'source_install_config',
    title: '来源安装配置',
    scene: 'source_install_config'
  },
  GameModioConfigEditor: {
    type: 'source_install_config',
    title: 'Mod.io 安装配置',
    scene: 'source_install_config',
    source: 'modio'
  },
  GameNexusConfigEditor: {
    type: 'source_install_config',
    title: 'Nexus 安装配置',
    scene: 'source_install_config',
    source: 'nexus'
  },
  GameInstallTaskCenter: {
    type: 'install_task_center',
    title: '安装任务中心',
    scene: 'install_task_center'
  },
  Settings: { type: 'settings', title: '设置', scene: 'settings' },
  Download: { type: 'download', title: '下载中心', scene: 'download' }
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeUrlHashValue(hash = '') {
  const text = String(hash || '')
  if (!text || !SENSITIVE_URL_PARAM_PATTERN.test(text)) return hash

  const body = text.startsWith('#') ? text.slice(1) : text
  if (!body) return '#[redacted]'

  const questionIndex = body.indexOf('?')
  if (questionIndex < 0 && body.startsWith('/')) return '#[redacted]'

  const prefix = questionIndex >= 0 ? body.slice(0, questionIndex) : ''
  const queryText = questionIndex >= 0 ? body.slice(questionIndex + 1) : body
  if (!queryText || (!queryText.includes('=') && !queryText.includes('&'))) {
    return '#[redacted]'
  }

  const params = new URLSearchParams(queryText)
  let changed = false
  for (const key of [...params.keys()]) {
    const value = params.get(key)
    if (SENSITIVE_URL_PARAM_PATTERN.test(key) || SENSITIVE_URL_PARAM_PATTERN.test(value || '')) {
      params.set(key, '[redacted]')
      changed = true
    }
  }
  if (!changed) return '#[redacted]'

  const nextQuery = params.toString()
  return `#${prefix ? `${prefix}?` : ''}${nextQuery}`
}

function sanitizeTextValue(value = '') {
  const text = String(value ?? '')
  const sanitizeUrlValue = (rawUrl = '') => {
    try {
      const parsed = new URL(rawUrl)
      let changed = false
      for (const key of [...parsed.searchParams.keys()]) {
        if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
          parsed.searchParams.set(key, '[redacted]')
          changed = true
        }
      }
      if (parsed.hash && SENSITIVE_URL_PARAM_PATTERN.test(parsed.hash)) {
        parsed.hash = sanitizeUrlHashValue(parsed.hash)
        changed = true
      }
      return changed ? parsed.toString() : rawUrl
    } catch {
      return rawUrl
    }
  }

  const sanitizedText = text
    .replace(INLINE_URL_PATTERN, (matched) => sanitizeUrlValue(matched))
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')

  return sanitizedText === text ? value : sanitizedText
}

function sanitizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item))
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return sanitizeTextValue(value)
    }
    return value
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (
      SENSITIVE_KEY_PATTERN.test(key) ||
      PRIVATE_PATH_LIST_KEY_PATTERN.test(key) ||
      (/path/i.test(key) && !ALLOWED_CONTEXT_PATH_FIELD_KEYS.has(key))
    ) {
      return result
    }
    result[key] = sanitizeObject(item)
    return result
  }, {})
}

function normalizeRecord(value) {
  return sanitizeObject(toPlainJson(value && typeof value === 'object' ? value : {}, {}))
}

function isAllowedContextPathField(pathParts = [], key = '') {
  if (pathParts.length === 1 && pathParts[0] === 'route' && key === 'path') return true
  if (!ALLOWED_CONTEXT_PATH_FIELD_KEYS.has(key)) return false
  return ALLOWED_CONTEXT_PATH_ROOT_SECTIONS.has(pathParts[0])
}

function resolveSectionKey(pathParts = []) {
  return pathParts.slice(0, 2).join('.')
}

function isAllowedSensitiveContextField(pathParts = [], key = '') {
  return SAFE_SENSITIVE_CONTEXT_FIELD_PATHS.has([...pathParts, key].join('.'))
}

function isAllowedPageContextField(pathParts = [], key = '', options = {}) {
  if (SENSITIVE_KEY_PATTERN.test(key) && !isAllowedSensitiveContextField(pathParts, key)) {
    return false
  }
  if (ALLOWED_CONTEXT_PATH_FIELD_KEYS.has(key) && !isAllowedContextPathField(pathParts, key)) {
    return false
  }
  if (PRIVATE_PATH_LIST_KEY_PATTERN.test(key) && !isAllowedContextPathField(pathParts, key)) {
    return false
  }
  if (/path/i.test(key) && !isAllowedContextPathField(pathParts, key)) return false
  if (!pathParts.length) {
    if (key === 'route' && options.allowRoute === false) return false
    return PAGE_CONTEXT_TOP_LEVEL_FIELDS.has(key)
  }

  const sectionKey = resolveSectionKey(pathParts)
  if (PAGE_CONTEXT_WILDCARD_SECTIONS.has(sectionKey)) {
    return true
  }

  if (pathParts.length > 1) {
    return false
  }

  const allowedFields = PAGE_CONTEXT_SECTION_FIELDS[pathParts[0]]
  return allowedFields ? allowedFields.has(key) : false
}

function sanitizePageContextValue(value, pathParts = [], options = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePageContextValue(item, pathParts, options))
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return sanitizeTextValue(value)
    }
    return value
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (!isAllowedPageContextField(pathParts, key, options)) {
      return result
    }
    result[key] = sanitizePageContextValue(item, [...pathParts, key], options)
    return result
  }, {})
}

export function normalizeAiPageContextPatch(value = {}, options = {}) {
  return sanitizePageContextValue(
    toPlainJson(value && typeof value === 'object' ? value : {}, {}),
    [],
    options
  )
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeSourceKey(value = '') {
  return normalizeSourcePlatform(value)
}

function normalizeRoute(routeLike = {}) {
  const source = routeLike && typeof routeLike === 'object' ? routeLike : {}

  return {
    path: toSafeText(source.path),
    fullPath: toSafeText(source.fullPath || source.path),
    name: toSafeText(source.name),
    params: normalizeRecord(source.params),
    query: normalizeRecord(source.query),
    meta: normalizeRecord(source.meta)
  }
}

function inferSourceFromRoute(route) {
  const routeConfig = ROUTE_PAGE_MAP[route.name] || {}
  const fromConfig = normalizeSourceKey(routeConfig.source)
  if (fromConfig) return fromConfig

  const fromMeta = normalizeSourceKey(route.meta?.sourcePlatform)
  if (fromMeta) return fromMeta.toLowerCase()

  const fromParam = normalizeSourceKey(route.params?.source || route.params?.sourcePlatform)
  if (fromParam) return fromParam.toLowerCase()

  const fromQuery = normalizeSourceKey(route.query?.sourceKey || route.query?.sourcePlatform)
  if (fromQuery) return fromQuery

  const fromLabel = normalizeSourceKey(route.query?.source)
  if (fromLabel) return fromLabel

  const path = route.path.toLowerCase()
  if (path.includes('/nexus/')) return 'nexus'
  if (path.includes('/modio/')) return 'modio'
  if (path.includes('/ficsit/')) return 'ficsit'
  if (path.includes('/thunderstore/')) return 'thunderstore'
  if (path.includes('/vamhub/')) return 'vamhub'
  if (path.includes('/game/mod/')) return 'vertex'
  return ''
}

function inferPage(route, displaySource, businessSource) {
  const routeConfig = ROUTE_PAGE_MAP[route.name] || {}
  const fallbackTitle = route.meta?.title || route.name || route.path || '当前页面'
  const source = businessSource || displaySource || ''
  const displayDefinition = getSourcePlatformDefinition(displaySource)
  const businessDefinition = getSourcePlatformDefinition(businessSource)

  return {
    type: toSafeText(routeConfig.type || 'unknown'),
    title: toSafeText(routeConfig.title || fallbackTitle),
    source,
    displaySource: displaySource || '',
    businessSource: businessSource || '',
    sourceLabel: displaySource ? displayDefinition?.label || displaySource : '',
    businessSourceLabel: businessSource ? businessDefinition?.label || businessSource : '',
    scene: toSafeText(routeConfig.scene || route.name || 'unknown')
  }
}

function buildGameContext(route, source, displaySource) {
  const { params, query } = route
  const id = pickFirstText(params.id, query.gameId, query.id)
  const routeParamSourceGameId =
    source === 'ficsit' || source === 'thunderstore' || source === 'vamhub' ? params.id : ''
  const appId = pickFirstText(
    query.appId,
    query.appid,
    query.steamAppId,
    query.gameSteamAppId,
    source === 'ficsit' ? params.id : ''
  )
  const sourceGameId = pickFirstText(
    query.sourceGameId,
    query.sourceId,
    query.game_id,
    routeParamSourceGameId
  )
  const routeParamSourceSlug =
    source === 'nexus' || source === 'thunderstore' || source === 'vamhub' ? params.id : ''
  const sourceSlug = pickFirstText(
    query.sourceSlug,
    query.sourceGameSlug,
    query.slug,
    query.community,
    query.domainName,
    query.gameDomainName,
    query.nexusGameDomain,
    routeParamSourceSlug
  )
  const nexusDomainName = source === 'nexus' ? sourceSlug : ''

  return {
    id,
    appId,
    name: pickFirstText(query.gameName, query.name, query.title, query.game),
    sourceGameId,
    sourceSlug,
    domainName: nexusDomainName,
    gameDomainName: nexusDomainName,
    nexusGameDomain: nexusDomainName,
    installRoot: pickFirstText(query.installRoot, query.gameRootPath, query.clientRootPath),
    executableFile: pickFirstText(query.executableFile, query.clientExePath, query.gameExePath),
    clientExePath: pickFirstText(query.clientExePath, query.gameExePath),
    packageLoader: pickFirstText(query.packageLoader, query.loader),
    source,
    displaySource: displaySource || source,
    businessSource: source
  }
}

function buildModContext(route, source, page, displaySource) {
  const { params, query } = route
  const routeParamModId = page.type === 'mod_detail' ? params.id : ''

  return {
    source,
    modId: pickFirstText(query.modId, query.mod_id, params.modId, routeParamModId),
    fileId: pickFirstText(query.fileId, query.file_id),
    name: pickFirstText(query.modName, query.name, query.title),
    version: pickFirstText(query.version, query.modVersion),
    author: pickFirstText(query.author, query.owner),
    displaySource: displaySource || source,
    businessSource: source
  }
}

function buildSearchContext(route) {
  const { query } = route
  const filterKeys = ['category', 'tag', 'tags', 'loader', 'profile', 'section', 'source']
  const filters = filterKeys.reduce((result, key) => {
    const value = query[key]
    if (toSafeText(value)) {
      result[key] = value
    }
    return result
  }, {})

  return {
    keyword: pickFirstText(query.keyword, query.q, query.search, query.text),
    filters,
    sort: pickFirstText(query.sort, query.order)
  }
}

export function normalizeInstallTaskSummary(summary = {}) {
  const target = summary && typeof summary === 'object' ? summary : {}
  const waitingCount = Number(target.waitingCount ?? target.visibleCount ?? target.activeCount ?? 0)
  const failedCount = Number(target.failedCount ?? 0)
  const activeCount = Number(target.activeCount ?? waitingCount ?? 0)

  return {
    activeCount: Number.isFinite(activeCount) ? activeCount : 0,
    waitingCount: Number.isFinite(waitingCount) ? waitingCount : 0,
    failedCount: Number.isFinite(failedCount) ? failedCount : 0
  }
}

export function mergeInstallTaskSummaryIntoContext(context = {}, installTaskSummary = undefined) {
  const nextContext = normalizeAiPageContextPatch(context)
  if (typeof installTaskSummary !== 'undefined') {
    nextContext.installTask = normalizeInstallTaskSummary(installTaskSummary)
    return toPlainJson(nextContext, {})
  }

  if (typeof nextContext.installTask !== 'undefined') {
    nextContext.installTask = normalizeInstallTaskSummary(nextContext.installTask)
  }

  return toPlainJson(nextContext, {})
}

function buildRouteSourceRecord(route, displaySource) {
  const { params, query, meta } = route
  return {
    displaySource,
    sourcePlatform: displaySource,
    businessSource: pickFirstText(
      query.businessSource,
      query.business_source,
      meta.businessSource,
      meta.business_source
    ),
    targetSourcePlatform: pickFirstText(
      query.targetSourcePlatform,
      query.target_source_platform,
      params.targetSourcePlatform,
      params.target_source_platform,
      meta.targetSourcePlatform,
      meta.target_source_platform
    )
  }
}

function hasSearchSelectedRecord(search = {}) {
  if (!isPlainObject(search)) return false
  if (isPlainObject(search.selectedRecord)) return true
  return Array.isArray(search.selectedRecords) && search.selectedRecords.some(isPlainObject)
}

function buildCapabilities(page, displaySource, businessSource, mod, search = {}) {
  const searchablePageTypes = new Set(['home', 'game_center', 'game_detail', 'source_mod_list'])
  const sourceCapabilities = getSourcePlatformCapabilityFlags(businessSource)
  const hasBusinessSource = !!businessSource
  const canSearchMods =
    (searchablePageTypes.has(page.type) || hasBusinessSource) &&
    (!hasBusinessSource || sourceCapabilities.aiSearch)
  const baseCanCreateInstallPlan =
    page.type === 'mod_detail' ||
    page.type === 'source_mod_list' ||
    !!mod.modId ||
    hasSearchSelectedRecord(search)
  const canCreateInstallPlan =
    baseCanCreateInstallPlan && (!hasBusinessSource || sourceCapabilities.aiInstallPlan)

  return {
    canSearchMods,
    canCreateInstallPlan,
    canSubmitInstallTask:
      canCreateInstallPlan && (!hasBusinessSource || sourceCapabilities.install),
    needNexusApiKey: businessSource === 'nexus',
    needModioApiKey: businessSource === 'modio',
    aiSearch: sourceCapabilities.aiSearch,
    aiDetail: sourceCapabilities.aiDetail,
    aiInstallPlan: sourceCapabilities.aiInstallPlan,
    install: sourceCapabilities.install,
    displaySource: displaySource || '',
    businessSource: businessSource || ''
  }
}

export function refreshAiPageContextCapabilities(context = {}) {
  const nextContext = normalizeAiPageContextPatch(context)
  const page = isPlainObject(nextContext.page) ? nextContext.page : {}
  const game = isPlainObject(nextContext.game) ? nextContext.game : {}
  const mod = isPlainObject(nextContext.mod) ? nextContext.mod : {}
  const search = isPlainObject(nextContext.search) ? nextContext.search : {}
  const displaySource = pickFirstText(
    nextContext.displaySource,
    page.displaySource,
    mod.displaySource,
    game.displaySource,
    page.source,
    mod.source,
    game.source
  )
  const businessSource = pickFirstText(
    nextContext.businessSource,
    page.businessSource,
    mod.businessSource,
    game.businessSource,
    page.source,
    mod.source,
      game.source
  )
  const capabilities = buildCapabilities(page, displaySource, businessSource, mod, search)
  const install = isPlainObject(nextContext.install)
    ? {
        ...nextContext.install,
        ...(Object.prototype.hasOwnProperty.call(nextContext.install, 'canCreateInstallPlan')
          ? {
              canCreateInstallPlan:
                nextContext.install.canCreateInstallPlan === true && capabilities.aiInstallPlan
            }
          : {})
      }
    : nextContext.install

  return toPlainJson(
    {
      ...nextContext,
      install,
      sourceState: getSourcePlatformDefinition(businessSource)?.status === 'removed'
        ? { ...nextContext.sourceState, status: 'removed' }
        : nextContext.sourceState,
      capabilities
    },
    {}
  )
}

function buildRouteContext(route) {
  return {
    path: route.path,
    name: route.name
  }
}

export function buildAiPageContextSnapshot(routeLike = {}, options = {}) {
  const route = normalizeRoute(routeLike)
  const displaySource = inferSourceFromRoute(route)
  const sourceRecord = buildRouteSourceRecord(route, displaySource)
  const businessSource =
    resolveBusinessSource(sourceRecord) || (displaySource === 'aggregate' ? '' : displaySource)
  const page = inferPage(route, displaySource, businessSource)
  const game = buildGameContext(route, businessSource, displaySource)
  const mod = buildModContext(route, businessSource, page, displaySource)
  const search = buildSearchContext(route)
  const installTask = normalizeInstallTaskSummary(options.installTaskSummary)
  const capabilities = buildCapabilities(page, displaySource, businessSource, mod, search)
  const businessDefinition = getSourcePlatformDefinition(businessSource)

  return toPlainJson(
    {
      displaySource: displaySource || '',
      businessSource: businessSource || '',
      sourceGameId: game.sourceGameId,
      sourceSlug: game.sourceSlug,
      sourceLabel: page.sourceLabel,
      businessSourceLabel: page.businessSourceLabel,
      sourceStatus: businessDefinition?.status || '',
      route: buildRouteContext(route),
      page,
      game,
      mod,
      search,
      installTask,
      capabilities
    },
    {}
  )
}

export function getAiPageQuickSuggestions(context = {}) {
  const pageType = toSafeText(context?.page?.type)

  if (pageType === 'install_task_center') {
    return ['解释失败原因', '查看可重试任务', '总结当前安装队列']
  }

  if (pageType === 'mod_detail' || toSafeText(context?.mod?.modId)) {
    return ['解释这个模组', '检查前置依赖', '生成安装计划']
  }

  if (pageType === 'source_mod_list' || pageType === 'game_detail') {
    return ['找画质增强模组', '找必装前置模组', '找最近更新的热门模组']
  }

  return ['帮我找一个热门模组', '给指定游戏找画质模组', '查看最近失败的安装任务']
}

export function formatAiPageContextTitle(context = {}) {
  const pageTitle = toSafeText(context?.page?.title) || '当前页面'
  const gameName = toSafeText(context?.game?.name)
  const sourceLabel = toSafeText(context?.page?.sourceLabel || context?.page?.source)
  const modName = toSafeText(context?.mod?.name)
  const parts = [pageTitle, gameName, sourceLabel, modName].filter(Boolean)

  return parts.join(' · ')
}
