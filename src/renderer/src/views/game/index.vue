<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import {
  computed,
  defineAsyncComponent,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GET_SOURCE_GAME_LIST, GET_STEAM_WORKSHOP_GAMES } from '@renderer/api/modules/game.js'
import { applyPublicRuleSupport, publicGameKey, createPublicRuleSupportLoader } from '../../../../shared/games/game-rule-support.js'
import common from '@renderer/common/index.js'
import PageBody from '@renderer/component/page-body.vue'
import GameCard from '@views/game/component/index/game-card.vue'
import GameSearch from '@views/game/component/index/game-search.vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { createGamebananaClient, createGamebananaCatalogLoader } from '@renderer/utils/gamebanana-api.js'
import { GAMEBANANA_MAX_PER_PAGE } from '../../../../shared/sources/gamebanana-catalog.js'
import {
  GAME_CARD_LAYOUT,
  GAME_CARD_MIN_COLUMN,
  remapPageForSize,
  resolveGameCardPageSize
} from '@views/game/component/index/game-card-layout.js'
import { normalizeWorkshopGames, gamebananaGamesPage } from '../../../../shared/sources/community-source.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import Pagination from '@renderer/component/Pagination.vue'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import {
  getCommunityListWithCover,
  getR2modmanEcosystem,
  invalidateR2modmanEcosystemCache
} from '@renderer/utils/community-api.js'
import { getNexusGameList } from '@renderer/utils/nexus-api.js'
import {
  applyEffectiveNexusApiConfig,
  normalizeNexusApiConfig
} from '@renderer/utils/nexus-api-config.js'
import {
  getModioApiConfig,
  getModioGameList,
  hasModioEnvApiKey,
  resolveEffectiveModioApiConfig
} from '@renderer/utils/modio-api.js'
import { resolveGameNameDictBatch, resolveGameNameSearchNameFromDict } from '@renderer/utils/game-name-dict.js'
import {
  GET_SHARED_RULE_GAME_KEYS,
  GET_MODIO_BACKEND_GAME_LIST,
  GET_NEXUS_BACKEND_GAME_LIST
} from '@renderer/api/modules/game.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { resolveSourcePlatformLabel, filterBrowsableSourceEntries, listModCenterSources } from '../../../../shared/sources/source-platform-registry.js'
import { useUserStore } from '@renderer/store/userStore.js'
import {
  SOURCE_MODPACK_VIEWS,
  isSourceModpackView
} from '@views/game/sourceModpack/source-modpack-views.js'
// 整合包面板首次进入时才加载，避免拖慢模组中心首屏。
const SourceModpackPanel = defineAsyncComponent(() => import('@views/game/sourceModpack/index.vue'))
const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const aiPageContextProvider = useAiPageContextProvider(route)

// 模组来源标识常量（用于数据存储）
const GAME_SOURCE = Object.freeze({
  SERVER: 'server',
  AGGREGATE: 'aggregate',
  THUNDERSTORE: 'thunderstore',
  FICSIT: 'ficsit',
  NEXUS: 'nexus',
  MODIO: 'modio',
  GAMEBANANA: 'gamebanana',
  WORKSHOP: 'steam-workshop'
})

const SUPPORTED_GAME_SOURCE_SET = new Set([
  GAME_SOURCE.GAMEBANANA,
  GAME_SOURCE.WORKSHOP,
  GAME_SOURCE.AGGREGATE,
  GAME_SOURCE.THUNDERSTORE,
  GAME_SOURCE.FICSIT,
  GAME_SOURCE.NEXUS,
  GAME_SOURCE.MODIO
])

const RULE_FILTER = Object.freeze({
  ALL: 'all',
  SUPPORTED: 'supported'
})

const RULE_FILTERABLE_SOURCE_SET = new Set(Object.values(GAME_SOURCE))
const ruleSupportLoader = createPublicRuleSupportLoader(GET_SHARED_RULE_GAME_KEYS)
const ruleSupportState = ref(ruleSupportLoader.getState())
let modCenterMounted = false
let skipInitialActivation = true

const ruleTabList = Object.freeze([
  { key: RULE_FILTER.ALL, get label() { return uiText('tools.all') } },
  { key: RULE_FILTER.SUPPORTED, get label() { return uiText('ui.supported') } }
])

// 来源及顺序由客户端固定配置，密钥只影响相应入口的可用状态。
const sourceTabList = computed(() => buildSourceTabList(listModCenterSources()))

// 组件引用
const pageRef = ref()
const gameSearchRef = ref()
const containerRef = ref(null)

// 来源 Tab 滑块相关
const tabItemRefs = ref([])
const sliderStyle = ref({})
const ruleTabItemRefs = ref([])
const ruleSliderStyle = ref({})
/**
 * 更新滑块位置和宽度，实现平滑跟随动画
 */
function updateSegmentSliderPosition(activeKey, tabList, itemRefs, sliderStyleRef) {
  const activeIndex = tabList.findIndex((item) => item.key === activeKey)
  if (activeIndex < 0) return

  const el = itemRefs.value[activeIndex]
  if (!el) return

  sliderStyleRef.value = {
    width: `${el.offsetWidth}px`,
    transform: `translateX(${el.offsetLeft}px)`
  }
}

function updateSliderPosition() {
  updateSegmentSliderPosition(
    currentSource.value,
    sourceTabList.value,
    tabItemRefs,
    sliderStyle
  )
}

function updateRuleSliderPosition() {
  updateSegmentSliderPosition(currentRuleFilter.value, ruleTabList, ruleTabItemRefs, ruleSliderStyle)
}

/**
 * 设置 tab item ref
 */
function setTabItemRef(el, index) {
  if (el) {
    tabItemRefs.value[index] = el
  }
}

function setRuleTabItemRef(el, index) {
  if (el) {
    ruleTabItemRefs.value[index] = el
  }
}

// 响应式数据
const isLoading = ref(false)
const currentSource = ref('')
const gamebananaClient = createGamebananaClient()
const gamebananaCatalogLoader = createGamebananaCatalogLoader(gamebananaClient)
const gamebananaTotal = ref(0)
const gamebananaSupportedTotal = ref(0)
const sourceLoadError = ref('')
const sourceConfigDialogVisible = ref(false)
const sourceConfigLabel = ref('')
const sourceConfigKey = ref('')
let sourceRequestId = 0
let sourceController = null
const currentRuleFilter = ref(RULE_FILTER.ALL)
const isRuleFilterEnabled = computed(() => RULE_FILTERABLE_SOURCE_SET.has(currentSource.value))

// 内容区面板：games 为游戏列表（按来源），modpack 为整合包（原「外部来源整合包」页）。
// 两个面板都保留状态：切回游戏列表时不重新加载，整合包面板首次进入后用 v-show 保留。
const PANEL = Object.freeze({ GAMES: 'games', MODPACK: 'modpack' })
const activePanel = ref(PANEL.GAMES)
const modpackView = ref('')
const modpackMounted = ref(false)
const modpackNavMeta = ref({})
const modpackInitialCode = ref('')
const isModpackPanel = computed(() => activePanel.value === PANEL.MODPACK)

/**
 * 从客户端固定配置选择默认来源
 */
function loadModSourceList() {
  currentSource.value = sourceTabList.value.find((source) => !source.disabled)?.key || ''
}

// 监听当前来源变化，自动更新滑块位置
watch(currentSource, () => {
  nextTick(() => {
    updateSliderPosition()
    updateRuleSliderPosition()
  })
})

watch(currentRuleFilter, () => {
  nextTick(() => updateRuleSliderPosition())
})
const query = ref({
  page: 1,
  limit: 20,
  keyword: ''
})
const pageData = ref()
const appidList = ref([])
const sourceRecords = ref({
  [GAME_SOURCE.SERVER]: [],
  [GAME_SOURCE.AGGREGATE]: [],
  [GAME_SOURCE.THUNDERSTORE]: [],
  [GAME_SOURCE.FICSIT]: [],
  [GAME_SOURCE.NEXUS]: [],
  [GAME_SOURCE.MODIO]: []
})
const fetchedSource = ref({
  [GAME_SOURCE.SERVER]: false,
  [GAME_SOURCE.AGGREGATE]: false,
  [GAME_SOURCE.THUNDERSTORE]: false,
  [GAME_SOURCE.FICSIT]: false,
  [GAME_SOURCE.NEXUS]: false,
  [GAME_SOURCE.MODIO]: false
})
const systemConfig = ref({
  nexusApi: {
    apiKey: '',
    apiKeySource: '',
  },
  modioApi: {
    baseUrl: 'https://api.mod.io/v1',
    apiKey: ''
  },
})
const nexusApiKeySnapshot = ref('')
const hasNexusApiKey = computed(
  () => String(normalizeNexusApiConfig(systemConfig.value?.nexusApi).apiKey || '').trim() !== ''
)
const hasModioApiKey = computed(() => hasModioEnvApiKey(getCurrentModioApiConfig()))

function normalizeSourceKey(key = '') {
  const value = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
  if (value === 'aggregate') return GAME_SOURCE.AGGREGATE
  if (value === 'modio') return GAME_SOURCE.MODIO
  if (value === 'nexus') return GAME_SOURCE.NEXUS
  if (value === 'thunderstore') return GAME_SOURCE.THUNDERSTORE
  if (value === 'ficsit') return GAME_SOURCE.FICSIT
  if (value === 'server' || value === 'vertex') return GAME_SOURCE.SERVER
  return String(key || '').trim()
}

function resolveSourceDisabled(source = {}) {
  const sourceKey = normalizeSourceKey(source?.key)
  if (sourceKey === GAME_SOURCE.NEXUS) return !hasNexusApiKey.value
  if (sourceKey === GAME_SOURCE.MODIO) return !hasModioApiKey.value
  return Boolean(source?.disabled)
}

function buildSourceTabItem(source = {}) {
  const sourceKey = normalizeSourceKey(source?.key)
  return {
    ...source,
    key: sourceKey,
    label: source.label,
    ...(Array.isArray(source?.children)
      ? {
          children: source.children
            .map((item) => normalizeSourceKey(item))
            .filter((item) => SUPPORTED_GAME_SOURCE_SET.has(item))
        }
      : {}),
    disabled: resolveSourceDisabled({ ...source, key: sourceKey })
  }
}

function buildSourceTabList(list = []) {
  return filterBrowsableSourceEntries(list)
    .map((source) => buildSourceTabItem(source))
    .filter((source) => SUPPORTED_GAME_SOURCE_SET.has(source.key))
}

function normalizeCardSourceLabel(source, label = '') {
  if (source === GAME_SOURCE.SERVER) return resolveSourcePlatformLabel('vertex', label || 'Vertex')
  if (
    source === GAME_SOURCE.MODIO ||
    source === GAME_SOURCE.NEXUS ||
    source === GAME_SOURCE.THUNDERSTORE ||
    source === GAME_SOURCE.FICSIT
  ) {
    return resolveSourcePlatformLabel(source, label || source)
  }
  return String(label || source || '').trim()
}

function resolveSourceDisplayLabel(source = '') {
  const sourceKey = normalizeSourceKey(source)
  const currentTab = sourceTabList.value.find((tab) => tab.key === sourceKey)
  return normalizeCardSourceLabel(sourceKey, currentTab ? currentTab.label : sourceKey)
}

function resolveAiContextSource(source = currentSource.value) {
  const sourceKey = normalizeSourceKey(source)
  return sourceKey === GAME_SOURCE.SERVER ? 'vertex' : sourceKey
}

function getCurrentBusinessSources() {
  if (currentSource.value !== GAME_SOURCE.AGGREGATE) {
    return [resolveAiContextSource(currentSource.value)].filter(Boolean)
  }

  const records = getSourceRecords(GAME_SOURCE.AGGREGATE)
  return [
    ...new Set(
      (Array.isArray(records) ? records : [])
        .map((item) => resolveAiContextSource(item?.targetSourcePlatform || item?.sourcePlatform))
        .filter((item) => item && item !== GAME_SOURCE.AGGREGATE)
    )
  ]
}

function resolveCurrentBusinessSource() {
  const displaySource = resolveAiContextSource(currentSource.value)
  if (displaySource !== GAME_SOURCE.AGGREGATE) {
    return displaySource
  }

  const businessSources = getCurrentBusinessSources()
  return businessSources.length === 1 ? businessSources[0] : ''
}

function resolveSourceConfigured(source = currentSource.value) {
  const sourceKey = normalizeSourceKey(source)
  if (sourceKey === GAME_SOURCE.NEXUS) return hasNexusApiKey.value
  if (sourceKey === GAME_SOURCE.MODIO) return hasModioApiKey.value
  return true
}

function publishGameIndexAiPageContext() {
  const displaySource = resolveAiContextSource(currentSource.value)
  const businessSource = resolveCurrentBusinessSource()
  const businessSources = getCurrentBusinessSources()
  const sourceLabel = resolveSourceDisplayLabel(currentSource.value)
  const businessSourceLabel = businessSource ? resolveSourceDisplayLabel(businessSource) : ''
  const configured = resolveSourceConfigured(currentSource.value)
  const records = Array.isArray(pageData.value?.records) ? pageData.value.records : []

  return aiPageContextProvider.update({
    displaySource,
    businessSource,
    sourceLabel,
    businessSourceLabel,
    page: {
      type: 'source_game_list',
      get title() { return uiText('nav.mods') },
      source: businessSource || displaySource,
      displaySource,
      businessSource,
      sourceLabel,
      businessSourceLabel
    },
    search: {
      keyword: String(query.value.keyword || '').trim(),
      sort: String(currentRuleFilter.value || '').trim(),
      page: Number(query.value.page || pageData.value?.current || 1),
      pageSize: Number(query.value.limit || 20),
      filters: {
        displaySource,
        businessSource,
        businessSources,
        ruleFilter: currentRuleFilter.value,
        ruleFilterEnabled: isRuleFilterEnabled.value,
        total: Number(pageData.value?.total || 0),
        visibleCount: records.length
      }
    },
    sourceState: {
      source: businessSource || displaySource,
      status: configured ? 'active' : 'auth_required',
      label: businessSourceLabel || sourceLabel,
      configured,
      summary:
        displaySource === GAME_SOURCE.AGGREGATE
          ? uiText('ui.theAggregateSourceIncludesValueBusinessSources', { value1: (businessSources.length) })
          : configured
            ? uiText('ui.valueSourceAvailable', { value1: (sourceLabel) })
            : uiText('ui.valueSourceNeedsAuthorizationSettings', { value1: (sourceLabel) })
    }
  })
}

function normalizeSystemConfig(data) {
  const target = data && typeof data === 'object' ? data : {}
  const nexusApi = target.nexusApi && typeof target.nexusApi === 'object' ? target.nexusApi : {}
  const modioApi = target.modioApi && typeof target.modioApi === 'object' ? target.modioApi : {}
  return {
    ...target,
    nexusApi: normalizeNexusApiConfig(nexusApi),
    modioApi: getModioApiConfig(modioApi),
  }
}

function getNexusApiConfig() {
  return normalizeNexusApiConfig(systemConfig.value?.nexusApi)
}

function getCurrentModioApiConfig() {
  return resolveEffectiveModioApiConfig(
    systemConfig.value?.modioApi,
    getModioApiConfig()
  )
}

function getSystemConfig() {
  ipcRenderer.send('getConfigByKey', {
    key: 'systemConfig.settings',
    replyName: 'get-systemConfig-game'
  })
}

async function ensureEffectiveNexusApiConfig() {
  const nextConfig = await applyEffectiveNexusApiConfig(systemConfig.value)
  const currentApiKey = String(systemConfig.value?.nexusApi?.apiKey || '').trim()
  const nextApiKey = String(nextConfig?.nexusApi?.apiKey || '').trim()
  const currentSource = String(systemConfig.value?.nexusApi?.apiKeySource || '').trim()
  const nextSource = String(nextConfig?.nexusApi?.apiKeySource || '').trim()
  if (currentApiKey !== nextApiKey || currentSource !== nextSource) {
    systemConfig.value = nextConfig
  }
}

/**
 * 统一分页结构，避免 records 非数组导致页面不渲染
 */
function ensurePageDataShape(data) {
  if (!data || typeof data !== 'object') {
    return {
      records: [],
      total: 0,
      pages: 1,
      current: query.value.page
    }
  }

  return {
    ...data,
    records: Array.isArray(data.records) ? data.records : [],
    total: Number(data.total || 0),
    pages: Number(data.pages || 1),
    current: Number(data.current || query.value.page)
  }
}

/**
 * 读取游戏模组数量（统一兼容不同字段）
 */
function getModCount(item) {
  const count = Number(
    item?.modCount ??
      item?.mods_count_total ??
      item?.modsCountTotal ??
      item?.stats?.mods_count_total ??
      item?.total_package_count ??
      0
  )
  return Number.isFinite(count) ? count : 0
}

function buildNexusGameTileCoverUrl(nexusGameId = 0) {
  const safeNexusGameId = Number(nexusGameId)
  if (!Number.isFinite(safeNexusGameId) || safeNexusGameId <= 0) {
    return ''
  }
  return `https://images.nexusmods.com/images/games/v2/${safeNexusGameId}/tile.jpg`
}

function resolveNexusGameCoverImage(item = {}, backendGame = null) {
  const source = item && typeof item === 'object' ? item : {}
  const backend = backendGame && typeof backendGame === 'object' ? backendGame : {}
  const safeNexusGameId = Number(backend?.nexusGameId || source?.id || 0)

  return String(
    source?.logo ||
      source?.image_url ||
      source?.imageUrl ||
      source?.picture_url ||
      source?.pictureUrl ||
      source?.cover_image ||
      source?.coverImage ||
      buildNexusGameTileCoverUrl(safeNexusGameId) ||
      backend?.logoUrl ||
      backend?.logo_url ||
      backend?.coverImage ||
      backend?.cover_image ||
      ''
  ).trim()
}

function resolveNexusSourceGameName(item = {}, domainName = '') {
  return String(item?.name || item?.game_name || item?.gameName || domainName || '').trim()
}

/**
 * 按模组数量降序
 */
function sortByModCountDesc(list = []) {
  return [...list].sort((a, b) => getModCount(b) - getModCount(a))
}

function normalizeSourceGameList(source, records = []) {
  const list = Array.isArray(records) ? records : []

  return list
    .map((item) => {
      const sourceGameId = String(item?.sourceGameId || item?.source_game_id || item?.id || '').trim()
      const sourceSlug = String(item?.sourceSlug || item?.source_slug || '').trim()
      const targetSourcePlatform = normalizeSourceKey(
        item?.targetSourcePlatform || item?.target_source_platform || source
      )
      const targetSourcePlatformName = String(
        item?.targetSourcePlatformName ||
          item?.target_source_platform_name ||
          item?.sourcePlatformName ||
          item?.source_platform_name ||
          ''
      ).trim()
      const steamAppId = Number(item?.steamAppId || item?.steam_app_id || 0)
      const modCount = Number(item?.modCount ?? item?.mod_count ?? 0)
      const supportsMods = Number(item?.supportsMods ?? item?.supports_mods ?? 1) === 1
      const safeSteamAppId = Number.isFinite(steamAppId) ? steamAppId : 0
      const safeModCount = Number.isFinite(modCount) ? modCount : 0
      const ficsitGameId = Number(sourceGameId || safeSteamAppId)

      if (!sourceGameId && !sourceSlug && !safeSteamAppId) {
        return null
      }

      if (
        source === GAME_SOURCE.FICSIT &&
        (!Number.isFinite(ficsitGameId) || ficsitGameId <= 0)
      ) {
        return null
      }

      const normalized = {
        id:
          source === GAME_SOURCE.FICSIT
            ? ficsitGameId
            : sourceGameId || sourceSlug,
        sourceGameId,
        gameKey: publicGameKey(item),
        sourceSlug,
        steamAppId: safeSteamAppId,
        coverImage: String(item?.coverImage || item?.cover_image || '').trim(),
        modCount: safeModCount,
        supportsMods,
        targetSourcePlatformName,
        chineseTitle: String(item?.chineseTitle || item?.chinese_title || '').trim(),
        englishTitle: String(item?.englishTitle || item?.english_title || '').trim(),
        description: String(item?.description || '').trim()
      }

      if (targetSourcePlatform) {
        normalized.targetSourcePlatform = targetSourcePlatform
      }

      if (targetSourcePlatform === GAME_SOURCE.FICSIT) {
        normalized.isFicsit = 1
      }
      if (targetSourcePlatform === GAME_SOURCE.THUNDERSTORE) {
        normalized.isSQ = 1
      }
      if (targetSourcePlatform === GAME_SOURCE.NEXUS) {
        normalized.isNexus = 1
      }
      if (targetSourcePlatform === GAME_SOURCE.MODIO) {
        normalized.isModio = 1
      }

      return normalized
    })
    .filter(Boolean)
}

function buildGameNameDictQuery(source, item = {}) {
  const dictSource = normalizeSourceKey(item?.targetSourcePlatform || source)

  if (dictSource === GAME_SOURCE.THUNDERSTORE) {
    return {
      sourcePlatform: 'thunderstore',
      externalId: String(item?.id || item?.sourceId || '').trim(),
      sourceSlug: String(item?.id || item?.sourceSlug || '').trim(),
      rawName: String(item?.englishTitle || item?.chineseTitle || item?.name || '').trim()
    }
  }

  if (dictSource === GAME_SOURCE.FICSIT) {
    return {
      sourcePlatform: 'ficsit',
      externalId: String(item?.id || item?.steamAppId || '').trim(),
      sourceSlug: String(item?.sourceSlug || '').trim(),
      rawName: String(
        item?.englishTitle || item?.chineseTitle || item?.sourceSlug || item?.sourceGameId || ''
      ).trim()
    }
  }

  if (dictSource === GAME_SOURCE.NEXUS) {
    return {
      sourcePlatform: 'nexus',
      externalId: String(item?.nexusGameId || '').trim(),
      sourceSlug: String(item?.nexusDomainName || '').trim(),
      rawName: String(
        item?.nexusOriginalName || item?.englishTitle || item?.nexusDomainName || ''
      ).trim()
    }
  }

  if (dictSource === GAME_SOURCE.MODIO) {
    return {
      sourcePlatform: 'modio',
      externalId: String(item?.modioGameId || item?.id || '').trim(),
      sourceSlug: String(item?.modioNameId || item?.nameId || '').trim(),
      rawName: String(item?.englishTitle || item?.chineseTitle || item?.name || '').trim()
    }
  }

  return {
    sourcePlatform: dictSource || source,
    rawName: String(item?.englishTitle || item?.chineseTitle || item?.name || '').trim()
  }
}

async function localizeSourceGameRecords(source, records = []) {
  const list = Array.isArray(records) ? records : []
  if (!list.length || source === GAME_SOURCE.SERVER) {
    return list
  }

  try {
    const resolvedList = await resolveGameNameDictBatch(
      list.map((item) => buildGameNameDictQuery(source, item))
    )

    return list.map((item, index) => {
      const resolved = resolvedList[index]
      if (!resolved?.matched || !resolved?.displayName) {
        return item
      }

      const originalEnglishTitle = String(
        normalizeSourceKey(item?.targetSourcePlatform || source) === GAME_SOURCE.NEXUS
          ? item?.englishTitle || item?.nexusOriginalName || item?.nexusDomainName || ''
          : item?.englishTitle || item?.chineseTitle || ''
      ).trim()
      return {
        ...item,
        chineseTitle: resolved.displayName,
        englishTitle: originalEnglishTitle || resolved.rawName || resolved.displayName,
        gameNameDictMatched: true,
        gameNameDictMatchType: resolved.matchType || ''
      }
    })
  } catch (error) {
    console.warn('本地游戏名称字典查询失败，使用来源原名', error)
    return list
  }
}

/**
 * 基于本地列表构建分页结构
 */
function buildLocalPageData(records = []) {
  const limit = Math.max(Number(query.value.limit || 20), 1)
  const total = records.length
  const pages = Math.max(Math.ceil(total / limit), 1)
  const current = Math.min(Math.max(Number(query.value.page || 1), 1), pages)
  const start = (current - 1) * limit
  const pagedRecords = records.slice(start, start + limit)

  return {
    records: pagedRecords,
    total,
    pages,
    current
  }
}

/**
 * 记录来源数据
 */
function setSourceRecords(source, records = []) {
  const list = Array.isArray(records) ? records : []
  const currentTab = sourceTabList.value.find((tab) => tab.key === source)
  const sourceLabel = normalizeCardSourceLabel(source, currentTab ? currentTab.label : source)

  sourceRecords.value = {
    ...sourceRecords.value,
    [source]: list.map((item) => ({ ...item, source: sourceLabel }))
  }
}

function setAggregateSourceRecords(records = []) {
  sourceRecords.value = {
    ...sourceRecords.value,
    [GAME_SOURCE.AGGREGATE]: (Array.isArray(records) ? records : []).map((item) => {
      const targetSourcePlatform = normalizeSourceKey(item?.targetSourcePlatform)
      const targetSourcePlatformName = String(item?.targetSourcePlatformName || '').trim()
      return {
        ...item,
        source:
          targetSourcePlatformName ||
          resolveSourceDisplayLabel(targetSourcePlatform || GAME_SOURCE.AGGREGATE)
      }
    })
  }
}

/**
 * 标记来源已加载
 */
function markSourceFetched(source) {
  fetchedSource.value = {
    ...fetchedSource.value,
    [source]: true
  }
}

/**
 * 重置来源缓存（用于手动刷新重拉）
 */
function resetSourceCache(source) {
  if (source === GAME_SOURCE.GAMEBANANA) gamebananaCatalogLoader.clear()
  setSourceRecords(source, [])
  fetchedSource.value = {
    ...fetchedSource.value,
    [source]: false
  }
}

/**
 * 判断来源是否已加载
 */
function hasSourceFetched(source) {
  return Boolean(fetchedSource.value[source])
}

/**
 * 获取来源数据
 */
function getSourceRecords(source = currentSource.value) {
  return sourceRecords.value[source] || []
}

/**
 * 加载服务器游戏
 */
/**
 * 加载 Thunderstore 游戏
 */
function buildThunderstoreRuleSupportedCommunitySet(ecosystem = {}) {
  const supportedCommunities = new Set()
  const games = ecosystem?.games && typeof ecosystem.games === 'object' ? ecosystem.games : {}

  for (const gameItem of Object.values(games)) {
    const variants = Array.isArray(gameItem?.r2modman) ? gameItem.r2modman : []
    for (const variant of variants) {
      const hasInstallRule = (Array.isArray(variant?.installRules) ? variant.installRules : []).some(
        (rule) => String(rule?.route || '').trim()
      )
      if (!hasInstallRule) {
        continue
      }

      const communityMatch = String(variant?.packageIndex || '')
        .trim()
        .toLowerCase()
        .match(/\/c\/([^/]+)\/api\/v1\/package-listing-index\/?/)
      const community = String(communityMatch?.[1] || '').trim()
      if (community) {
        supportedCommunities.add(community)
      }
    }
  }

  return supportedCommunities
}

async function loadThunderstoreGameData() {
  if (hasSourceFetched(GAME_SOURCE.THUNDERSTORE)) {
    return
  }

  const [res, ecosystem] = await Promise.all([
    getCommunityListWithCover({ is_listed: true, has_mod_manager_support: true }),
    getR2modmanEcosystem()
  ])
  const ruleSupportedCommunities = buildThunderstoreRuleSupportedCommunitySet(ecosystem)
  const list = [...(res.results || [])].sort(
    (a, b) => (b.total_package_count || 0) - (a.total_package_count || 0)
  )
  const communityList = list
    .filter((item) => item.has_mod_manager_support === true && item.total_package_count > 1)
    .map((item) => ({
      id: item.identifier,
      coverImage: item.cover_image_url,
      modCount: item.total_package_count,
      supportsMods: item.has_mod_manager_support,
      chineseTitle: item.name,
      description: item.short_description,
      englishTitle: item.name,
      isHasRule: ruleSupportedCommunities.has(
        String(item.identifier || '')
          .trim()
          .toLowerCase()
      )
        ? 1
        : 0,
      isSQ: 1
    }))

  const localizedList = await localizeSourceGameRecords(GAME_SOURCE.THUNDERSTORE, communityList)
  setSourceRecords(GAME_SOURCE.THUNDERSTORE, sortByModCountDesc(localizedList))
  markSourceFetched(GAME_SOURCE.THUNDERSTORE)
}

async function loadFicsitGameData() {
  if (hasSourceFetched(GAME_SOURCE.FICSIT)) {
    return
  }

  try {
    const serverList = await GET_SOURCE_GAME_LIST({
      sourcePlatform: GAME_SOURCE.FICSIT
    })
    const normalizedList = normalizeSourceGameList(GAME_SOURCE.FICSIT, serverList)
    if (normalizedList.length > 0) {
      const localizedList = await localizeSourceGameRecords(GAME_SOURCE.FICSIT, normalizedList)
      setSourceRecords(GAME_SOURCE.FICSIT, localizedList)
      markSourceFetched(GAME_SOURCE.FICSIT)
      return
    }
  } catch (error) {
    console.warn('[FICSIT] 获取服务端游戏列表失败', error)
    throw error
  }

  setSourceRecords(GAME_SOURCE.FICSIT, [])
  markSourceFetched(GAME_SOURCE.FICSIT)
}

async function fetchRuleSupportedRecords(force = false) {
  const loading = ruleSupportLoader.load({ force })
  ruleSupportState.value = ruleSupportLoader.getState()
  const state = await loading
  ruleSupportState.value = state
  return state
}

function hasRuleSupportedMatch(source, item = {}, state = ruleSupportState.value) {
  return state?.status === 'ready' && state.gameKeys.has(publicGameKey(item))
}

async function refreshRuleSupportedFlags() {
  await fetchRuleSupportedRecords()
}

async function fetchRuleSupportedLookup() {
  return fetchRuleSupportedRecords()
}

async function refreshPublicRuleSupport() {
  await fetchRuleSupportedRecords(true)
  if (currentSource.value === GAME_SOURCE.GAMEBANANA) {
    await getPageList({}, { keepScroll: true })
  } else renderPageDataFromLocal()
}

function mergeModioBackendRecord(item = {}, backendRecord = null) {
  if (!backendRecord || typeof backendRecord !== 'object') {
    return item
  }

  return {
    ...item,
    gameKey: backendRecord.gameKey || item.gameKey,
    backendGameId: Number(backendRecord?.id || item?.backendGameId || 0),
    backendGameName: String(backendRecord?.name || item?.backendGameName || '').trim(),
    coverImage: String(
      item?.coverImage || backendRecord?.logoUrl || backendRecord?.logo_url || ''
    ).trim()
  }
}

function applyRuleSupportedFlag(source, item = {}, lookup = {}, backendRecord = null) {
  const mergedItem = mergeModioBackendRecord(item, backendRecord)
  if (!hasRuleSupportedMatch(source, mergedItem, lookup)) {
    return {
      ...mergedItem,
      isHasRule: 0
    }
  }

  return {
    ...mergedItem,
    isHasRule: 1
  }
}

function normalizeNexusGameList(list = [], backendGames = [], supportLookup = null) {
  // 构建后端配置的游戏数据哈希表，提升查找速度 (O(n))
  const backendMap = new Map()
  for (const bg of Array.isArray(backendGames) ? backendGames : []) {
    backendMap.set(Number(bg.nexusGameId), bg)
  }

  // 以N网全部列表为骨架，拼装后端配置的数据
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      // 通过 id 找对应的后端数据
      const bg = backendMap.get(Number(item.id))

      const domainName = String(item?.domain_name || item?.domainName || '').trim()
      const sourceGameName = resolveNexusSourceGameName(item, domainName)
      const modCount = Number(item?.mods ?? item?.mod_count ?? item?.modCount ?? 0)
      const safeModCount = Number.isFinite(modCount) ? modCount : 0
      const supportAutoDetect = Number(
        bg?.supportAutoDetect ??
          bg?.support_auto_detect ??
          item?.supportAutoDetect ??
          item?.support_auto_detect ??
          0
      )
      const safeSupportAutoDetect = supportAutoDetect === 1 ? 1 : 0
      const steamAppId = Number(
        bg?.steamAppId ||
          bg?.steam_app_id ||
          bg?.steam_appid ||
          bg?.steamGameId ||
          bg?.steam_game_id ||
          item?.steam_app_id ||
          item?.steamAppId ||
          item?.steam_appid ||
          0
      )
      const safeSteamAppId = Number.isFinite(steamAppId) ? steamAppId : 0

      // 如果N网API里没返回这个domain_name说明不可用
      if (!domainName || !sourceGameName) {
        return null
      }

      const result = {
        id: `nexus-${domainName}`,
        gameKey: publicGameKey({ gameKey: bg?.gameKey, nexusDomainName: domainName }),
        backendGameId: Number(bg?.id || 0),
        nexusGameId: Number(bg?.nexusGameId || item?.id || 0),
        coverImage: resolveNexusGameCoverImage(item, bg),
        modCount: safeModCount,
        supportsMods: safeModCount > 0,
        chineseTitle: sourceGameName,
        englishTitle: sourceGameName,
        nexusOriginalName: sourceGameName,
        backendGameName: String(bg?.name || '').trim(),
        description: String(bg?.summary || item?.summary || item?.description || ''),
        isNexus: 1,
        nexusDomainName: domainName,
        steamAppId: safeSteamAppId,
        appId: safeSteamAppId,
        supportAutoDetect: safeSupportAutoDetect,
        isHasRule: 0
      }

      if (supportLookup && hasRuleSupportedMatch(GAME_SOURCE.NEXUS, result, supportLookup)) {
        result.isHasRule = 1
      }

      return result
    })
    .filter(Boolean)
}

async function loadNexusGameData() {
  if (hasSourceFetched(GAME_SOURCE.NEXUS)) {
    await refreshRuleSupportedFlags(GAME_SOURCE.NEXUS)
    return
  }

  await ensureEffectiveNexusApiConfig()

  if (!hasNexusApiKey.value) {
    setSourceRecords(GAME_SOURCE.NEXUS, [])
    markSourceFetched(GAME_SOURCE.NEXUS)
    return
  }

  try {
    const apiConfig = getNexusApiConfig()
    const [list, backendRes, supportLookup] = await Promise.all([
      getNexusGameList(apiConfig),
      GET_NEXUS_BACKEND_GAME_LIST().catch(() => ({ data: [] })),
      fetchRuleSupportedLookup(GAME_SOURCE.NEXUS)
    ])
    const backendGames = backendRes || []
    // 自定义排序：支持自动识别优先，其次优先显示已完成后端接入的游戏，同组内再按 modCount 降序
    const normalizedList = normalizeNexusGameList(list, backendGames, supportLookup)
    const sortedList = [...normalizedList].sort((a, b) => {
      const aSupportAutoDetect = Number(a?.supportAutoDetect || 0)
      const bSupportAutoDetect = Number(b?.supportAutoDetect || 0)
      if (aSupportAutoDetect !== bSupportAutoDetect) return bSupportAutoDetect - aSupportAutoDetect
      const aHasRule = a.isHasRule ? 1 : 0
      const bHasRule = b.isHasRule ? 1 : 0
      if (aHasRule !== bHasRule) return bHasRule - aHasRule
      return getModCount(b) - getModCount(a)
    })
    const localizedList = await localizeSourceGameRecords(GAME_SOURCE.NEXUS, sortedList)
    setSourceRecords(GAME_SOURCE.NEXUS, localizedList)
    markSourceFetched(GAME_SOURCE.NEXUS)
  } catch (error) {
    console.error('加载 Nexus 游戏数据失败', error)
    throw error
  }
}

async function loadModioGameData() {
  if (hasSourceFetched(GAME_SOURCE.MODIO)) {
    await refreshRuleSupportedFlags(GAME_SOURCE.MODIO)
    return
  }

  if (!hasModioApiKey.value) {
    setSourceRecords(GAME_SOURCE.MODIO, [])
    markSourceFetched(GAME_SOURCE.MODIO)
    return
  }

  try {
    const [{ records }, backendRes, supportLookup] = await Promise.all([
      getModioGameList(getCurrentModioApiConfig(), {
        limit: 100
      }),
      GET_MODIO_BACKEND_GAME_LIST().catch(() => []),
      fetchRuleSupportedLookup(GAME_SOURCE.MODIO)
    ])
    const backendGames = Array.isArray(backendRes) ? backendRes : Array.isArray(backendRes?.data) ? backendRes.data : []
    const backendMap = new Map()
    for (const bg of backendGames) {
      backendMap.set(Number(bg?.modioGameId || bg?.modio_game_id || 0), bg)
    }

    const normalizedList = (Array.isArray(records) ? records : []).map((item) =>
      applyRuleSupportedFlag(
        GAME_SOURCE.MODIO,
        item,
        supportLookup,
        backendMap.get(Number(item?.modioGameId || 0)) || null
      )
    )

    const sortedList = [...normalizedList].sort((a, b) => {
      const aHasRule = a?.isHasRule ? 1 : 0
      const bHasRule = b?.isHasRule ? 1 : 0
      if (aHasRule !== bHasRule) return bHasRule - aHasRule
      return getModCount(b) - getModCount(a)
    })
    const localizedList = await localizeSourceGameRecords(GAME_SOURCE.MODIO, sortedList)
    setSourceRecords(GAME_SOURCE.MODIO, localizedList)
    markSourceFetched(GAME_SOURCE.MODIO)
  } catch (error) {
    console.error('加载 Modio 游戏数据失败', error)
    throw error
  }
}

function buildAggregateRecordKey(item = {}, index = 0) {
  return [
    GAME_SOURCE.AGGREGATE,
    normalizeSourceKey(item?.targetSourcePlatform),
    String(item?.id || item?.sourceGameId || item?.sourceSlug || item?.nexusDomainName || '').trim(),
    String(index)
  ]
    .filter(Boolean)
    .join(':')
}

async function loadAggregateGameData() {
  if (hasSourceFetched(GAME_SOURCE.AGGREGATE)) {
    return
  }

  try {
    const serverList = await GET_SOURCE_GAME_LIST({
      sourcePlatform: GAME_SOURCE.AGGREGATE
    })
    const normalizedList = normalizeSourceGameList(GAME_SOURCE.AGGREGATE, serverList)
    const localizedList = await localizeSourceGameRecords(GAME_SOURCE.AGGREGATE, normalizedList)
    const aggregateRecords = localizedList.map((item, index) => ({
      ...item,
      aggregateKey: buildAggregateRecordKey(item, index)
    }))

    setAggregateSourceRecords(sortByModCountDesc(aggregateRecords))
    markSourceFetched(GAME_SOURCE.AGGREGATE)
  } catch (error) {
    console.warn('[聚合来源] 获取服务端游戏列表失败', error)
    throw error
  }
}

/**
 * 确保当前来源数据可用
 */
async function ensureSourceDataReady(source = currentSource.value) {
  if (source === GAME_SOURCE.WORKSHOP) {
    if (!hasSourceFetched(source)) {
      setSourceRecords(source, normalizeWorkshopGames(await GET_STEAM_WORKSHOP_GAMES()))
      markSourceFetched(source)
    }
  } else if (source === GAME_SOURCE.AGGREGATE) {
    await loadAggregateGameData()
  } else if (source === GAME_SOURCE.THUNDERSTORE) {
    await loadThunderstoreGameData()
  } else if (source === GAME_SOURCE.FICSIT) {
    await loadFicsitGameData()
  } else if (source === GAME_SOURCE.NEXUS) {
    await loadNexusGameData()
  } else if (source === GAME_SOURCE.MODIO) {
    await loadModioGameData()
  } else {
    setSourceRecords(source, [])
    markSourceFetched(source)
  }
}

/**
 * 本地关键字模糊匹配（中文名/英文名）
 */
function normalizeSearchText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

/**
 * 本地关键字模糊匹配（中文名/英文名，忽略大小写与常见符号）
 */
function filterLocalRecordsByKeyword(records = [], keyword = '') {
  const text = normalizeSearchText(keyword)
  if (!text) {
    return records
  }

  return records.filter((item) => {
    const chineseTitle = normalizeSearchText(item?.chineseTitle)
    const englishTitle = normalizeSearchText(item?.englishTitle)
    return chineseTitle.includes(text) || englishTitle.includes(text)
  })
}

function hasServerInstallRule(item = {}) {
  return Number(item?.isHasRule ?? item?.is_has_rule ?? 0) === 1
}

function filterLocalRecordsByRule(records = []) {
  if (!isRuleFilterEnabled.value || currentRuleFilter.value !== RULE_FILTER.SUPPORTED) {
    return records
  }

  return records.filter((item) => hasServerInstallRule(item))
}

/**
 * 基于当前来源的本地缓存刷新页面数据
 */
function renderPageDataFromLocal() {
  const keyword = String(query.value.keyword || '').trim()
  const currentRecords = getSourceRecords(currentSource.value).map(item => applyPublicRuleSupport(item, currentSource.value, ruleSupportState.value))
  const filtered = filterLocalRecordsByRule(
    filterLocalRecordsByKeyword(currentRecords, keyword)
  )
  const localPageData = buildLocalPageData(filtered)

  query.value.page = localPageData.current
  pageData.value = ensurePageDataShape(localPageData)
}

/**
 * 重置搜索状态
 */
function resetSearchState(triggerSearch = false) {
  query.value = {
    ...query.value,
    page: 1,
    keyword: ''
  }
  gameSearchRef.value?.eliminate?.(triggerSearch)
}

// 获取页面数据
// keepScroll：窗口缩放重新分页、后台刷新规则时保持滚动位置；换页、换来源、搜索、筛选回到顶部。
async function getPageList(data = {}, { keepScroll = false } = {}) {
  const requestId = ++sourceRequestId
  const source = currentSource.value
  if (!keepScroll) resetScroll(PANEL.GAMES)
  sourceController?.abort()
  const controller = new AbortController()
  sourceController = controller
  sourceLoadError.value = ''
  isLoading.value = true
  try {
    // 合并查询参数
    const newQuery = {
      ...query.value,
      ...data
    }

    // 关键字搜索默认回到第一页，避免页码越界导致空结果
    if (
      Object.prototype.hasOwnProperty.call(data, 'keyword') &&
      !Object.prototype.hasOwnProperty.call(data, 'page')
    ) {
      newQuery.page = 1
    }

    const keyword = String(newQuery.keyword || '').trim()
    // 每次请求前按当前宽度和来源布局重新计算每页数量。
    measureResultsWidth()
    newQuery.limit = resolvePageLimit(source)

    // 清理空属性
    query.value = common.cleanEmptyProperties({
      ...newQuery,
      keyword
    })

    if (source === GAME_SOURCE.GAMEBANANA) {
      const support = await fetchRuleSupportedRecords()
      if (requestId !== sourceRequestId) return
      const supportedOnly = currentRuleFilter.value === RULE_FILTER.SUPPORTED
      // 没有已确认的公共规则时直接显示空态，不拉取整个 Banana 目录。
      if (supportedOnly && (support.status !== 'ready' || support.gameKeys.size === 0)) {
        gamebananaSupportedTotal.value = 0
        query.value.page = 1
        pageData.value = buildLocalPageData([])
        return
      }
      let searchKeyword = keyword
      if (keyword) {
        try {
          const resolved = await resolveGameNameSearchNameFromDict({ keyword })
          searchKeyword = resolved.searchName || keyword
        } catch (error) {
          console.warn('游戏名称字典搜索失败，使用原搜索词', error)
        }
      }
      if (requestId !== sourceRequestId) return
      const result = supportedOnly
        ? await gamebananaCatalogLoader.load(searchKeyword, controller.signal)
        : await gamebananaClient.list(
            { page: query.value.page, keyword: searchKeyword, perPage: query.value.limit },
            controller.signal
          )
      if (requestId !== sourceRequestId) return
      const gamePage = gamebananaGamesPage(result)
      const supportedRecords = gamePage.records.map(item => applyPublicRuleSupport(item, source, support))
      const records = await localizeSourceGameRecords(source, supportedOnly
        ? supportedRecords.filter(hasServerInstallRule) : supportedRecords)
      if (requestId === sourceRequestId) {
        gamebananaTotal.value = gamePage.total
        if (supportedOnly) gamebananaSupportedTotal.value = records.length
        pageData.value = supportedOnly ? buildLocalPageData(records) : { ...gamePage, records }
        query.value.page = pageData.value.current
      }
    } else {
      await ensureSourceDataReady(source)
      if (requestId === sourceRequestId) renderPageDataFromLocal()
    }
  } catch (e) {
    if (requestId !== sourceRequestId) return
    sourceLoadError.value = source === GAME_SOURCE.WORKSHOP
      ? Number(e?.code) === 404
        ? 'Steam游戏列表接口不可用（HTTP 404），请联系服务维护者确认接口已上线。'
        : uiText('ui.couldNotLoadSteamSupportListValue', { value1: (e?.message || '请检查服务连接后重试。') })
      : String(e?.message || '游戏列表加载失败，请重试')
    pageData.value = ensurePageDataShape(null)
  } finally {
    if (requestId === sourceRequestId) isLoading.value = false
  }
}

/**
 * 切换来源
 */
async function changeSource(source) {
  if (source === currentSource.value) {
    return
  }

  currentSource.value = source
  resetSearchState(false)
  await getPageList({ page: 1, keyword: '' })
}

async function changeRuleFilter(ruleFilter) {
  if (!RULE_FILTERABLE_SOURCE_SET.has(currentSource.value)) {
    return
  }

  if (ruleFilter === currentRuleFilter.value) {
    return
  }

  currentRuleFilter.value = ruleFilter
  await getPageList({ page: 1 })
}

async function handleRuleTabClick(ruleTab) {
  if (!ruleTab?.key || !isRuleFilterEnabled.value) {
    return
  }

  await changeRuleFilter(ruleTab.key)
}

async function handleSourceTabClick(source) {
  if (!source?.key || sourceConfigDialogVisible.value) {
    return
  }

  const sourceRoute = route.fullPath
  if (source.key === GAME_SOURCE.NEXUS) {
    await ensureEffectiveNexusApiConfig()
  }
  if (route.fullPath !== sourceRoute) return

  if (!resolveSourceConfigured(source.key)) {
    sourceConfigLabel.value = resolveSourceDisplayLabel(source.key)
    sourceConfigKey.value = source.key
    sourceConfigDialogVisible.value = true
    return
  }

  if (resolveSourceDisabled(source)) {
    return
  }

  activePanel.value = PANEL.GAMES
  if (source.key === currentSource.value) {
    return
  }

  pageData.value = {
    records: [],
    total: 0,
    pages: 1,
    current: 1
  }

  await changeSource(source.key)
}

async function openSourceApiSettings() {
  // 设置页按来源分类：Mod.io 直达 Mod.io，其余（Nexus）进 Nexus Mods。
  const section = sourceConfigKey.value === GAME_SOURCE.MODIO ? 'modio' : 'nexus'
  const failure = await router.push({ path: '/app/settings', query: { section } })
  if (failure) throw new Error(uiText('ui.couldNotOpenAPISettingsPleaseTryAgain'))
}

function pageChange(data = {}) {
  getPageList({ page: data.page })
}

function openModpackView(view = '') {
  modpackMounted.value = true
  activePanel.value = PANEL.MODPACK
  if (isSourceModpackView(view)) modpackView.value = view
}

function handleModpackNavMeta(meta = {}) {
  modpackNavMeta.value = meta || {}
}

function resolveModpackViewState(view = {}) {
  if (view.requiresLogin && !userStore.isLogin) return { lock: true }
  const meta = modpackNavMeta.value?.[view.id] || {}
  if (meta.badge) return { badge: meta.badge }
  if (meta.count !== null && meta.count !== undefined) return { count: meta.count }
  return {}
}

// 旧路由 /app/game/source-modpacks 重定向为 ?view=modpack（可带 tab、code），这里读取后从地址栏去掉，
// 这样再次从别处打开整合包时 query 会重新变化。
function consumeModpackRouteQuery() {
  if (route.query?.view !== PANEL.MODPACK) return
  const restQuery = { ...route.query }
  delete restQuery.view
  delete restQuery.tab
  delete restQuery.code
  openModpackView(String(route.query.tab || ''))
  const shareCode = String(route.query.code || '').trim()
  if (shareCode) modpackInitialCode.value = shareCode
  router.replace({ query: restQuery }).catch(() => {})
}

watch(() => route.query?.view, consumeModpackRouteQuery)

// 游戏列表被 v-show 隐藏时，规则筛选滑块量不到宽度；切回来后重新对齐。
watch(activePanel, (panel) => {
  if (panel === PANEL.GAMES) nextTick(() => updateRuleSliderPosition())
})

// 刷新数据
async function refreshData() {
  resetSourceCache(currentSource.value)
  resetSearchState(false)
  await fetchRuleSupportedRecords(true)
  await getPageList()
}

function changePage(e) {
  query.value.page = e
  getPageList()
}

watch(
  () => pageData.value,
  (nv) => {
    console.log(nv)
  }
)

watch(
  () =>
    [
      currentSource.value,
      currentRuleFilter.value,
      query.value.keyword,
      query.value.page,
      query.value.limit,
      pageData.value?.total,
      pageData.value?.current,
      Array.isArray(pageData.value?.records) ? pageData.value.records.length : 0,
      hasNexusApiKey.value ? '1' : '0',
      hasModioApiKey.value ? '1' : '0'
    ].join('::'),
  () => {
    publishGameIndexAiPageContext()
  },
  { immediate: true }
)

useIpc('get-systemConfig-game', async (data) => {
  const previousApiKey = nexusApiKeySnapshot.value
  systemConfig.value = await applyEffectiveNexusApiConfig(normalizeSystemConfig(data))
  const nextApiKey = String(systemConfig.value?.nexusApi?.apiKey || '').trim()
  nexusApiKeySnapshot.value = nextApiKey

  if (previousApiKey !== nextApiKey) {
    resetSourceCache(GAME_SOURCE.NEXUS)
  }

  if (!hasNexusApiKey.value && currentSource.value === GAME_SOURCE.NEXUS) {
    currentSource.value = sourceTabList.value.find((source) => !source.disabled)?.key || ''
    getPageList({ page: 1 }).then()
  }
})

useIpc('thunderstore-ecosystem-updated', () => {
  invalidateR2modmanEcosystemCache()
  resetSourceCache(GAME_SOURCE.THUNDERSTORE)
  if (currentSource.value === GAME_SOURCE.THUNDERSTORE) {
    getPageList({ page: 1 }).catch((error) => {
      console.warn('刷新 Thunderstore 规则筛选失败', error)
    })
  }
})

// 初始化
onMounted(async () => {
  setPageMenuName('模组中心', route.path)
  observeResultsWidth()
  consumeModpackRouteQuery()
  const supportReady = fetchRuleSupportedRecords(true)
  // 加载模组来源列表（优先于其他数据加载）
  await loadModSourceList()
  // 预热 r2modman 生态映射，后续页面直接走当日缓存
  getR2modmanEcosystem().catch((error) => {
    console.warn('预加载 r2modman ecosystem 失败', error)
  })
  getSystemConfig()
  await Promise.all([getPageList(), supportReady])
  if (currentSource.value !== GAME_SOURCE.GAMEBANANA) renderPageDataFromLocal()
  modCenterMounted = true
  ipcRenderer.send('getGameAppIdList')

  // 初始化滑块位置
  await nextTick()
  updateSliderPosition()
  updateRuleSliderPosition()

})

onActivated(() => {
  restoreScroll()
  getSystemConfig()
  if (skipInitialActivation) { skipInitialActivation = false; return }
  if (modCenterMounted) refreshPublicRuleSupport().catch(error => console.warn(error))
})

onDeactivated(() => {
  sourceConfigDialogVisible.value = false
})

// 退出登录后，需要登录的整合包分类在左栏显示锁；整合包面板自己会切回本地整合包。
const modpackNavItems = computed(() =>
  SOURCE_MODPACK_VIEWS.map((view) => ({ ...view, ...resolveModpackViewState(view) }))
)

onBeforeUnmount(() => {
  sourceController?.abort()
  stopObservingResultsWidth()
  aiPageContextProvider.clear()
})

useIpc('getGameAppIdListSuccess', (data) => {
  appidList.value = data || []
})

// Thunderstore、Nexus 的游戏封面是竖版图，其余来源（含聚合）用横版卡片。
const PORTRAIT_COVER_SOURCE_SET = new Set([GAME_SOURCE.THUNDERSTORE, GAME_SOURCE.NEXUS])
function resolveCardLayout(source = currentSource.value) {
  return PORTRAIT_COVER_SOURCE_SET.has(source)
    ? GAME_CARD_LAYOUT.PORTRAIT
    : GAME_CARD_LAYOUT.LANDSCAPE
}
const cardLayout = computed(() => resolveCardLayout(currentSource.value))
const skeletonGridStyle = computed(() => ({
  '--game-card-min-column': `${GAME_CARD_MIN_COLUMN[cardLayout.value]}px`
}))
const skeletonCount = computed(() => Math.max(Number(query.value.limit) || 0, 1))

// ---------- 每页数量：按结果区宽度算出列数，每页正好铺满 5 行 ----------
// 结果区最近一次量到的宽度；被隐藏（整合包面板、后台标签）时量到 0，保留上一次的值。
const resultsWidth = ref(0)
const RESIZE_SETTLE_MS = 200
let resultsResizeObserver = null
let resizeFrame = 0
let resizeTimer = 0

function measureResultsWidth() {
  const width = Math.floor(containerRef.value?.clientWidth || 0)
  if (width > 0) resultsWidth.value = width
  return resultsWidth.value
}

// Banana 按服务端分页，每页数量受接口上限约束；其余来源在本地分页，没有上限。
function isServerPagedSource(source = currentSource.value) {
  return source === GAME_SOURCE.GAMEBANANA && currentRuleFilter.value !== RULE_FILTER.SUPPORTED
}

function resolvePageLimit(source = currentSource.value) {
  return resolveGameCardPageSize(resultsWidth.value, resolveCardLayout(source), {
    maxPageSize: isServerPagedSource(source) ? GAMEBANANA_MAX_PER_PAGE : undefined
  })
}

// 宽度变化后列数变了才重新分页：本地来源直接重排，Banana 重新请求；页码换算到仍包含当前第一条的位置。
function applyResponsivePageLimit() {
  if (isModpackPanel.value || !currentSource.value) return
  const previous = Math.max(Number(query.value.limit) || 1, 1)
  const next = resolvePageLimit()
  if (next === previous) return
  const page = remapPageForSize(query.value.page, previous, next)
  if (currentSource.value === GAME_SOURCE.GAMEBANANA) {
    getPageList({ page }, { keepScroll: true }).catch((error) =>
      console.warn('按窗口宽度重新分页失败', error)
    )
    return
  }
  query.value = { ...query.value, limit: next, page }
  // 正在加载时，加载结束后的本地分页会读到新的数量，不必重复渲染。
  if (!isLoading.value) renderPageDataFromLocal()
}

function handleResultsResize() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    const previousWidth = resultsWidth.value
    if (measureResultsWidth() === previousWidth) return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(applyResponsivePageLimit, RESIZE_SETTLE_MS)
  })
}

function observeResultsWidth() {
  measureResultsWidth()
  if (resultsResizeObserver || typeof ResizeObserver === 'undefined' || !containerRef.value) return
  resultsResizeObserver = new ResizeObserver(handleResultsResize)
  resultsResizeObserver.observe(containerRef.value)
}

function stopObservingResultsWidth() {
  resultsResizeObserver?.disconnect()
  resultsResizeObserver = null
  cancelAnimationFrame(resizeFrame)
  clearTimeout(resizeTimer)
}

// ---------- 列表滚动 ----------
// 页面不再整体滚动，滚动位置由两个列表区域各自记录。KeepAlive 移走 DOM 后滚动位置会丢失，
// 切回页签时按记录恢复。
const gamesScrollRef = ref(null)
const modpackScrollRef = ref(null)
const scrollPositions = { [PANEL.GAMES]: 0, [PANEL.MODPACK]: 0 }

function resolveScrollElement(panel) {
  return panel === PANEL.MODPACK ? modpackScrollRef.value : gamesScrollRef.value
}

function rememberScroll(panel, event) {
  scrollPositions[panel] = event?.target?.scrollTop || 0
}

function resetScroll(panel) {
  scrollPositions[panel] = 0
  const element = resolveScrollElement(panel)
  if (element) element.scrollTop = 0
}

function restoreScroll() {
  nextTick(() => {
    for (const panel of [PANEL.GAMES, PANEL.MODPACK]) {
      const element = resolveScrollElement(panel)
      if (element) element.scrollTop = scrollPositions[panel]
    }
  })
}
const showRuleSupportError = computed(
  () => ruleSupportState.value.status === 'error' && currentSource.value !== GAME_SOURCE.THUNDERSTORE
)
const currentKeyword = computed(() => String(query.value.keyword || '').trim())
const currentSourceTab = computed(
  () => sourceTabList.value.find((tab) => tab.key === currentSource.value) || null
)
const currentSourceLabel = computed(() => currentSourceTab.value?.label || '模组中心')

const sourceGameCount = computed(() =>
  currentSource.value === GAME_SOURCE.GAMEBANANA
    ? gamebananaTotal.value
    : getSourceRecords(currentSource.value).length
)

const supportedGameCount = computed(() => {
  if (currentSource.value !== GAME_SOURCE.THUNDERSTORE && ruleSupportState.value.status !== 'ready') {
    return 0
  }
  if (currentSource.value === GAME_SOURCE.GAMEBANANA) {
    return currentRuleFilter.value === RULE_FILTER.SUPPORTED ? gamebananaSupportedTotal.value : 0
  }
  return getSourceRecords(currentSource.value)
    .map((item) => applyPublicRuleSupport(item, currentSource.value, ruleSupportState.value))
    .filter((item) => hasServerInstallRule(item)).length
})

// 数量已显示在规则筛选上，这里只在搜索时说明结果。
const resultSummary = computed(() => {
  if (isLoading.value || sourceLoadError.value || !currentKeyword.value) return ''
  return uiText('ui.searchResultsForValueValueGames', { value1: (currentKeyword.value), value2: (Number(pageData.value?.total || 0)) })
})

function resolveRuleTabCount(ruleTab = {}) {
  if (isLoading.value) return ''
  if (ruleTab.key === RULE_FILTER.SUPPORTED) {
    return supportedGameCount.value > 0 ? String(supportedGameCount.value) : ''
  }
  return sourceGameCount.value > 0 ? String(sourceGameCount.value) : ''
}

// 数量异步到达后选项变宽，需要重新对齐滑块。
watch(
  () => [sourceGameCount.value, supportedGameCount.value, isLoading.value].join(':'),
  () => nextTick(() => updateRuleSliderPosition())
)

function resolveSourceTabTitle(source = {}) {
  if (!source.disabled) return undefined
  if (source.key === GAME_SOURCE.NEXUS) return uiText('ui.addYourNexusAPIKeyInSettingsFirst')
  if (source.key === GAME_SOURCE.MODIO) return uiText('ui.addYourModIoAPIKeyInSettingsFirst')
  return uiText('ui.thisSourceIsCurrentlyUnavailable')
}

function resolveRuleTabLabel(ruleTab = {}) {
  return ruleTab.key === RULE_FILTER.SUPPORTED ? uiText('ui.installationRulesAvailable') : ruleTab.label
}

function clearSearch() {
  gameSearchRef.value?.eliminate?.(true)
}

defineOptions({
  name: 'Game'
})
</script>

<template>
  <div class="game-index">
    <!-- 页面本身不滚动：标题、搜索和筛选固定，只有下面的列表区域滚动。 -->
    <page-body ref="pageRef" :is-scroll-enabled="false">
      <div class="mod-center">
        <!-- 左侧来源导航 -->
        <aside class="mc-rail" aria-labelledby="mod-center-title">
          <h1 id="mod-center-title" class="mc-rail__title">{{ $t('nav.mods') }}</h1>

          <div
            class="mc-rail__list"
            role="tablist"
            aria-orientation="vertical"
            :aria-label="$t('ui.modSources')"
          >
            <button
              v-for="(source, index) in sourceTabList"
              :key="source.key"
              :ref="(el) => setTabItemRef(el, index)"
              type="button"
              role="tab"
              class="mc-source"
              :class="{
                'is-active': !isModpackPanel && currentSource === source.key,
                'is-locked': source.disabled
              }"
              :aria-selected="!isModpackPanel && currentSource === source.key"
              :aria-disabled="source.disabled || undefined"
              :title="resolveSourceTabTitle(source)"
              @click="handleSourceTabClick(source)"
            >
              <span class="mc-source__name">{{ source.label }}</span>
              <span v-if="source.disabled" class="mc-source__state">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 11h12v9H6z" />
                  <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                </svg>
                {{ $t('ui.setupRequired') }}
              </span>
            </button>
          </div>

          <!-- 整合包：原「外部来源整合包」页的分类，直接在右侧内容区切换，不再跳转页面 -->
          <div class="mc-rail__group" role="group" aria-labelledby="mod-center-modpack-label">
            <div id="mod-center-modpack-label" class="mc-rail__label">{{ $t('ui.modpacks') }}</div>
            <div
              class="mc-rail__list"
              role="tablist"
              aria-orientation="vertical"
              :aria-label="$t('ui.modpacks')"
            >
              <button
                v-for="item in modpackNavItems"
                :key="item.id"
                type="button"
                role="tab"
                class="mc-source"
                :class="{ 'is-active': isModpackPanel && modpackView === item.id }"
                :aria-selected="isModpackPanel && modpackView === item.id"
                @click="openModpackView(item.id)"
              >
                <span class="mc-source__name">{{ item.label }}</span>
                <span v-if="item.lock" class="mc-source__state">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 11h12v9H6z" />
                    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                  </svg>
                  <span class="mc-sr-only">{{ $t('ui.signInRequired') }}</span>
                </span>
                <span v-else-if="item.badge" class="mc-source__badge">{{ item.badge }}</span>
                <span v-else-if="item.count !== undefined" class="mc-source__count">
                  {{ item.count }}
                </span>
              </button>
            </div>
          </div>
        </aside>

        <!-- 右侧内容 -->
        <section
          class="mc-main"
          :aria-label="isModpackPanel ? $t('ui.modpacks') : $t('ui.valueGames', { value1: (currentSourceLabel) })"
        >
          <div v-show="!isModpackPanel" class="mc-games">
            <header class="mc-head">
              <div class="mc-head__row">
                <h2 class="mc-head__title">{{ currentSourceLabel }}</h2>
                <div class="mc-head__tools">
                  <GameSearch ref="gameSearchRef" class="mc-search" :get-page-list="getPageList" />
                  <button
                    type="button"
                    class="mc-icon-button"
                    :aria-label="$t('tools.refreshList')"
                    :title="$t('tools.refreshList')"
                    :disabled="isLoading"
                    @click="refreshData"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 11a8 8 0 0 0-14.5-4.6L4 8" />
                      <path d="M4 4v4h4" />
                      <path d="M4 13a8 8 0 0 0 14.5 4.6L20 16" />
                      <path d="M20 20v-4h-4" />
                    </svg>
                  </button>
                </div>
              </div>

              <div class="mc-head__row is-sub">
                <div
                  class="mc-segment"
                  :class="{ 'is-disabled': !isRuleFilterEnabled }"
                  role="tablist"
                  :aria-label="$t('ui.filterByInstallationRuleSupport')"
                  :title="isRuleFilterEnabled ? undefined : $t('ui.thisSourceDoesNotSupportFilteringByInstallationRules')"
                >
                  <div class="mc-segment__slider" :style="ruleSliderStyle" aria-hidden="true"></div>
                  <button
                    v-for="(ruleTab, index) in ruleTabList"
                    :key="ruleTab.key"
                    :ref="(el) => setRuleTabItemRef(el, index)"
                    type="button"
                    role="tab"
                    class="mc-segment__item"
                    :class="{ 'is-active': currentRuleFilter === ruleTab.key }"
                    :aria-selected="currentRuleFilter === ruleTab.key"
                    :disabled="!isRuleFilterEnabled"
                    @click="handleRuleTabClick(ruleTab)"
                  >
                    {{ resolveRuleTabLabel(ruleTab) }}
                    <span v-if="resolveRuleTabCount(ruleTab)" class="mc-segment__count">
                      {{ resolveRuleTabCount(ruleTab) }}
                    </span>
                  </button>
                </div>

                <p v-if="resultSummary" class="mc-head__summary" aria-live="polite">
                  {{ resultSummary }}
                  <button type="button" class="mc-link" @click="clearSearch">{{ $t('tools.clearSearch') }}</button>
                </p>
              </div>
            </header>

            <div v-if="showRuleSupportError" class="mc-notice" role="status">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 2 20h20L12 3z" />
                <path d="M12 10v4M12 17h.01" />
              </svg>
              <span class="mc-notice__text"
                >{{ $t('ui.couldNotLoadRuleSupportData') }}{{ ruleSupportState.error }}</span
              >
              <VxButton variant="secondary" size="sm" @click="refreshPublicRuleSupport"
                >{{ $t('tools.retry') }}</VxButton
              >
            </div>

            <div
              ref="gamesScrollRef"
              class="mc-scroll"
              @scroll.passive="rememberScroll(PANEL.GAMES, $event)"
            >
              <div
                ref="containerRef"
                class="mc-results"
                :aria-busy="isLoading"
                :data-page-size="query.limit"
              >
                <div
                  v-if="isLoading"
                  class="mc-skeleton-grid"
                  :class="`is-${cardLayout}`"
                  :style="skeletonGridStyle"
                  :aria-label="$t('ui.loadingGames')"
                >
                  <div
                    v-for="n in skeletonCount"
                    :key="n"
                    class="mc-skeleton-card"
                    aria-hidden="true"
                  >
                    <span class="mc-skeleton-card__line"></span>
                    <span class="mc-skeleton-card__line is-short"></span>
                  </div>
                </div>
                <div v-else-if="sourceLoadError" role="alert" class="mc-state">
                  <span class="mc-state__icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
                      <path d="M12 8v5M12 16h.01" />
                    </svg>
                  </span>
                  <strong>{{ $t('ui.couldNotLoadGames') }}</strong>
                  <p>{{ sourceLoadError }}</p>
                  <VxButton variant="secondary" size="sm" @click="getPageList()">{{ $t('tools.retry') }}</VxButton>
                </div>
                <GameCard
                  v-else
                  id="GameCard"
                  :page-data="pageData"
                  :show-source="currentSource === GAME_SOURCE.AGGREGATE"
                  :layout="cardLayout"
                  @page-change="pageChange"
                  @refresh="refreshData"
                />
              </div>

              <pagination
                v-if="pageData && !isLoading"
                :current="query.page"
                :size="query.limit"
                :pages="pageData.pages"
                :total="pageData.total"
                @change="changePage"
              />
            </div>
          </div>

          <div
            v-if="modpackMounted"
            v-show="isModpackPanel"
            ref="modpackScrollRef"
            class="mc-scroll is-panel"
            @scroll.passive="rememberScroll(PANEL.MODPACK, $event)"
          >
            <SourceModpackPanel
              v-model:view="modpackView"
              :active="isModpackPanel"
              :initial-code="modpackInitialCode"
              @nav-meta="handleModpackNavMeta"
            />
          </div>
        </section>
      </div>
    </page-body>
    <VxConfirmModal
      v-model="sourceConfigDialogVisible"
      :title="$t('ui.configureValueAPI', { value1: (sourceConfigLabel) })"
      :content="$t('ui.noValueAPIKeyIsConfiguredOpenSettingsToAdd', { value1: (sourceConfigLabel) })"
      :confirm-text="$t('ui.configure')"
      :cancel-text="$t('ui.cancel')"
      :confirm-action="openSourceApiSettings"
    />
  </div>
</template>

<style scoped lang="scss">
.game-index {
  position: relative;
  width: 100%;
  height: 100%;
  color: var(--color-text);
  font-family: var(--font-family-base);
}

svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.mod-center {
  display: flex;
  align-items: stretch;
  gap: var(--space-6);
  // 占满页面内容区高度，滚动交给内部的列表区域。
  height: 100%;
  min-width: 0;
  min-height: 0;
}

// ---------- 来源导航 ----------
// 导航直接放在页面底色上，不再套卡片；选中项用白底加描边，与内容区的卡片呼应。
.mc-rail {
  display: flex;
  flex: 0 0 188px;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 0;
  // 窗口很矮时导航自己滚动，不撑高页面。
  overflow-y: auto;
  scrollbar-width: none;
}

.mc-rail__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.mc-rail__list {
  display: grid;
  gap: 2px;
}

.mc-rail__group {
  display: grid;
  gap: 2px;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.mc-rail__label {
  padding: var(--space-1) var(--space-3) 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.mc-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.mc-source {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 36px;
  padding: 0 var(--space-3);
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 55%, transparent);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  &.is-locked {
    color: var(--color-text-muted);
  }
}

.mc-source__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mc-source__state {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: var(--font-weight-regular);

  svg {
    width: 12px;
    height: 12px;
  }
}

.mc-source__count {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}

// 订阅有更新：与原整合包页左栏同一样式（accent-soft 底、accent-strong 字）。
.mc-source__badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  color: var(--color-accent-strong);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  background: var(--color-accent-soft);
  border-radius: var(--radius-xs);
}

// ---------- 内容区 ----------
.mc-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
}

.mc-games {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
}

.mc-head {
  display: grid;
  flex: none;
  gap: var(--space-3);
}

.mc-notice {
  flex: none;
}

// ---------- 列表滚动区域 ----------
// 标题、搜索和筛选在区域之外，不随列表滚动。滚动条放进页面右侧留白里（向右借 16px，
// 其中 7px 是滚动条），列表右边缘仍与标题栏的刷新按钮对齐。
.mc-scroll {
  --mc-scrollbar-size: 7px;

  flex: 1 1 auto;
  min-height: 0;
  margin-right: calc(-1 * var(--space-4));
  padding-right: calc(var(--space-4) - var(--mc-scrollbar-size));
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;

  &::-webkit-scrollbar {
    width: var(--mc-scrollbar-size);
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
  }

  &::-webkit-scrollbar-thumb {
    min-height: 40px;
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

.mc-head__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  min-width: 0;

  &.is-sub {
    justify-content: flex-start;
  }
}

.mc-head__title {
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--control-height-sm);
}

.mc-head__tools {
  display: flex;
  flex: 0 1 460px;
  align-items: center;
  gap: var(--space-2);
  min-width: 260px;
}

.mc-search {
  flex: 1 1 auto;
}

.mc-head__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
  gap: var(--space-1) var(--space-3);
  min-width: 0;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.mc-link {
  padding: 0;
  color: var(--color-accent-active);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  outline: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.mc-icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--control-text-disabled);
    background: var(--control-bg-disabled);
    cursor: not-allowed;
  }
}

// ---------- 规则筛选 ----------
.mc-segment {
  position: relative;
  display: flex;
  flex: none;
  height: 32px;
  padding: 2px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-md);

  &.is-disabled {
    opacity: 0.6;
  }
}

.mc-segment__slider {
  position: absolute;
  top: 2px;
  left: 0;
  height: calc(100% - 4px);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--duration-base) var(--ease-standard),
    width var(--duration-base) var(--ease-standard);
}

.mc-segment__count {
  margin-left: 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

.mc-segment__item.is-active .mc-segment__count {
  color: var(--color-accent-strong);
}

.mc-segment__item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  height: 100%;
  padding: 0 14px;
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled):not(.is-active) {
    color: var(--color-text);
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  &:disabled {
    cursor: not-allowed;
  }
}

// ---------- 提示条 ----------
.mc-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  color: var(--color-warning-strong);
  font-size: var(--font-size-sm);
  background: var(--color-warning-soft);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, var(--color-border));
  border-radius: var(--radius-md);

  > svg {
    flex: none;
    width: 16px;
    height: 16px;
  }
}

.mc-notice__text {
  flex: 1 1 auto;
  min-width: 0;
}

// ---------- 结果区 ----------
.mc-results {
  position: relative;
  min-height: 420px;
}

.mc-skeleton-grid {
  display: grid;
  // 列宽、比例与 game-card.vue 的两种布局保持一致，加载前后不跳动。
  grid-template-columns: repeat(auto-fill, minmax(var(--game-card-min-column, 260px), 1fr));
  gap: var(--space-4);

  &.is-portrait .mc-skeleton-card {
    aspect-ratio: 3 / 4;
  }

  &.is-landscape .mc-skeleton-card {
    aspect-ratio: 16 / 9;
  }
}

// 骨架只保留封面块和底部两条文字位置，对应叠在封面上的名称与信息行。
.mc-skeleton-card {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  padding: var(--space-3);
  background: var(--color-surface-strong);
  border-radius: var(--radius-md);
  animation: mc-pulse 1.4s ease-in-out infinite;
}

.mc-skeleton-card__line {
  width: 60%;
  height: 12px;
  background: var(--color-border);
  border-radius: var(--radius-xs);

  &.is-short {
    width: 36%;
    height: 9px;
  }
}

@keyframes mc-pulse {
  50% {
    opacity: 0.55;
  }
}

.mc-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 360px;
  padding: var(--space-8);
  text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  strong {
    color: var(--color-text);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }

  p {
    max-width: 520px;
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
    overflow-wrap: anywhere;
  }
}

.mc-state__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--space-1);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-pill);

  svg {
    width: 22px;
    height: 22px;
  }
}

// ---------- 窄窗口：来源导航折叠为横向条 ----------
@media (max-width: 980px) {
  .mod-center {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
  }

  .mc-rail {
    position: static;
    flex: none;
    flex-flow: row wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .mc-rail__list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .mc-rail__group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    padding: 0 0 0 var(--space-2);
    border-top: 0;
    border-left: 1px solid var(--color-border);
  }

  .mc-rail__label {
    display: none;
  }

  .mc-source {
    width: auto;
    white-space: nowrap;
  }

  .mc-head__tools {
    flex-basis: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mc-skeleton-card {
    animation: none;
  }
}
</style>
