<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../i18n/message.js'

import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { resolveSelectedSourceProfileName } from '@renderer/utils/source-profile-registry.js'
import { groupGameLibrary, sourceLibraryMeta, sourceLibraryRoute } from '../../../../shared/games/game-library.js'
import { normalizeSourcePlatform, getSourcePlatformDefinition, SOURCE_PLATFORM_DEFINITIONS, resolveSourcePlatformLabel } from '../../../../shared/sources/source-platform-registry.js'
import { getRetiredSourceFailure } from '../../../../shared/sources/retired-source-policy.js'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui/index.js'
import LibraryCard from './component/library/LibraryCard.vue'
import LibraryDetail from './component/library/LibraryDetail.vue'
import LibraryAttention from './component/library/LibraryAttention.vue'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch
} from 'vue'
import { useRoute } from 'vue-router'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import router from '@renderer/router/index.js'
import { useGameStore } from '@renderer/store/gameStore.js'
import { $message } from '@renderer/common/message.js'
import { GET_GAME_DETAILS } from '@renderer/api/modules/game.js'
import {
  getQuickLaunchPrimaryActionText,
  startQuickLaunchGame
} from '@renderer/utils/quick-launch-game-action.js'

const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()
const gameStore = useGameStore()

const SOURCE_TYPE = Object.freeze({
  ALL: 'all',
  VERTEX: 'vertex',
  THUNDERSTORE: 'thunderstore',
  FICSIT: 'ficsit',
  NEXUS: 'nexus',
  MODIO: 'modio'
})

const SOURCE_LABEL_MAP = Object.freeze({ get all() { return uiText('tools.all') }, ...Object.fromEntries(Object.keys(SOURCE_PLATFORM_DEFINITIONS).map(source => [source, resolveSourcePlatformLabel(source)])) })

const FICSIT_STEAM_APP_ID = 526870

// 支持“接管本地模组”的来源，与原页面保持一致。
const TAKEOVER_SOURCES = Object.freeze(['vertex', 'nexus', 'modio', 'ficsit', 'thunderstore'])

// 目录缺失的游戏固定排在最后，并在顶部提示条列出，因此不再提供“需处理优先”。
const SORT_OPTIONS = Object.freeze([
  { get label() { return uiText('ui.byModCount') }, value: 'mods' },
  { get label() { return uiText('taskCenter.toolbar.sortName') }, value: 'name' }
])

// 封面卡片徽标空间有限，长来源名用简称。
const SOURCE_SHORT_LABEL_MAP = Object.freeze({ thunderstore: 'TS', 'steam-workshop': 'Steam' })
const CARD_BADGE_LIMIT = 2

// 列数 = clamp(floor((内容宽 + 列间距) / (最小卡宽 + 列间距)), 2, 6)，与样式里的列间距保持一致。
const GRID_GAP_X = 22
const CARD_MIN_WIDTH = 210
const MIN_COLUMNS = 2
const MAX_COLUMNS = 6
const DEFAULT_COLUMNS = 5
const DETAIL_ID = 'repo-detail'
const CARET_HALF = 7

// 启动按钮的“启动中”至少保持这么久，避免一闪而过。
const LAUNCH_MIN_BUSY_MS = 800

// “稍后提醒”只在本次运行内有效：模块级变量在页面缓存销毁后仍保留，重启客户端后恢复。
let attentionDismissedThisRun = false

// 无封面时的占位底色：低饱和深色，保证白色字母可读，仅用于封面占位。
const COVER_PLACEHOLDER_TONES = Object.freeze([
  '#4a4f7a', '#6b5a2e', '#5a3a32', '#2d3f5c', '#3f4a3a',
  '#4b3a5e', '#3a5258', '#44484e', '#5a4632', '#2f4a4a'
])

const GAME_STATUS = Object.freeze({
  ready: { key: 'ready', get label() { return uiText('ui.ready') } },
  missing: { key: 'missing', get label() { return uiText('ui.missingFolder') } },
  unbound: { key: 'unbound', get label() { return uiText('ui.notReadyLocally') } }
})

// 网格分组顺序：可启动 → 未绑定目录 → 目录缺失。
const STATUS_RANK = Object.freeze({ ready: 0, unbound: 1, missing: 2 })

const RECENT_MOD_LIMIT = 3
const MENU_WIDTH = Object.freeze({ sort: 180, more: 228 })
const MENU_GAP = 6
const VIEWPORT_MARGIN = 8

const pageList = ref([])
const isLibraryLoaded = ref(false)
const selectedGame = ref(null)
const sourceFilter = ref(SOURCE_TYPE.ALL)
const selectedGameSource = ref('')
const nexusSteamAppIdByGameId = ref({})
const searchKeyword = ref('')
const sortKey = ref('mods')
const failedCovers = reactive({})
const recentMods = ref([])
const recentModsState = ref('idle')
let recentModsRequestId = 0

const scrollRef = ref(null)
const columnCount = ref(DEFAULT_COLUMNS)
let gridResizeObserver = null

// 正在启动的游戏（libraryKey → true）；只禁用正在启动的那个，其它游戏照常可启动。
const launchingKeys = reactive({})
const isRefreshing = ref(false)
let manualRefreshPending = false
const attentionDismissed = ref(attentionDismissedThisRun)

// 排序与更多操作共用一个浮层，Teleport 到 body，避免被滚动容器裁切。
const activeMenu = ref('')
const menuStyle = ref({})
const menuRef = ref(null)
const sortTriggerRef = ref(null)
// 更多操作按钮在详情子组件里，打开菜单时记录触发元素，关闭后用于还原焦点。
const menuTriggerEl = ref(null)

const confirmDialog = reactive({
  open: false,
  title: '',
  content: '',
  get confirmText() { return uiText('ui.confirm') },
  danger: false,
  action: null
})

const sourceCountMap = computed(() => {
  const counts = { all: pageList.value.length }
  for (const game of pageList.value) for (const source of game.availableSources || []) counts[source] = (counts[source] || 0) + 1
  return counts
})

// 只展示有游戏的平台；当前选中的平台即使变为 0 也保留，避免页签突然消失。
const sourceTabs = computed(() => {
  const sources = Object.keys(SOURCE_PLATFORM_DEFINITIONS).filter(
    (source) =>
      SOURCE_PLATFORM_DEFINITIONS[source].display?.showInGameRepository &&
      ((sourceCountMap.value[source] || 0) > 0 || source === sourceFilter.value)
  )
  return [SOURCE_TYPE.ALL, ...sources].map((key) => ({
    key,
    label: SOURCE_LABEL_MAP[key],
    count: sourceCountMap.value[key] || 0
  }))
})

const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase())

const filteredPageList = computed(() => {
  const list = Array.isArray(pageList.value) ? pageList.value : []
  const keyword = normalizedKeyword.value
  const filteredList = list.filter((item) => {
    if (sourceFilter.value !== SOURCE_TYPE.ALL) {
      const availableSources = Array.isArray(item?.availableSources) ? item.availableSources : []
      if (!availableSources.includes(sourceFilter.value)) return false
    }
    if (keyword) {
      const text = [item?.chineseTitle, item?.englishTitle, item?.name].join(' ').toLowerCase()
      if (!text.includes(keyword)) return false
    }
    return true
  })
  return [...filteredList].sort(compareGames)
})

const missingGames = computed(() =>
  pageList.value
    .filter((game) => getGameStatus(game).key === GAME_STATUS.missing.key)
    .sort((a, b) =>
      gamePresentation(a).title.localeCompare(gamePresentation(b).title, contentLocale.value)
    )
)

const attentionItems = computed(() =>
  missingGames.value.map((game) => ({
    key: game.libraryKey,
    title: gamePresentation(game).title,
    path: String(game?.client_root_path || '').trim(),
    tone: getCoverTone(game),
    monogram: getMonogram(game),
    hasSources: (game.availableSources || []).length > 0
  }))
)

// 选了来源或在搜索时，提示条会和筛选结果混在一起，因此只在“全部”且没有搜索词时显示。
const showAttention = computed(
  () =>
    isLibraryLoaded.value &&
    !attentionDismissed.value &&
    attentionItems.value.length > 0 &&
    sourceFilter.value === SOURCE_TYPE.ALL &&
    !normalizedKeyword.value
)

const gridTitle = computed(() => {
  if (sourceFilter.value !== SOURCE_TYPE.ALL) {
    return uiText('ui.valueGame', { value1: (SOURCE_LABEL_MAP[sourceFilter.value] || sourceFilter.value) })
  }
  return normalizedKeyword.value ? uiText('modBrowser.searchResults') : uiText('ui.allGames')
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`
}))

// 按当前列数把游戏切成行，详情区插在选中游戏所在行的后面。
const gridRows = computed(() => {
  const rows = []
  const list = filteredPageList.value
  for (let index = 0; index < list.length; index += columnCount.value) {
    const items = list.slice(index, index + columnCount.value)
    rows.push({
      key: items[0]?.libraryKey || String(index),
      items,
      selectedIndex: items.findIndex((game) => isSelected(game))
    })
  }
  return rows
})

const skeletonCount = computed(() => columnCount.value * 2)

const sortLabel = computed(
  () => SORT_OPTIONS.find((option) => option.value === sortKey.value)?.label || SORT_OPTIONS[0].label
)

const emptyFilterText = computed(() =>
  normalizedKeyword.value
    ? uiText('ui.noGameNamesContainValue', { value1: (searchKeyword.value.trim()) })
    : '当前筛选下没有游戏'
)

const selectedGamePrimaryActionText = computed(() =>
  getQuickLaunchPrimaryActionText(selectedGame.value || {})
)

const selectedStatus = computed(() =>
  selectedGame.value ? getEntryStatus(selectedGame.value) : GAME_STATUS.unbound
)
const selectedCanLaunch = computed(() => Boolean(selectedGame.value?.isGameLocalPathExist))
const selectedHasSources = computed(() => (selectedGame.value?.availableSources || []).length > 0)
const selectedSubtitle = computed(() => getSubtitle(selectedGame.value))
const selectedPath = computed(() => String(selectedGame.value?.client_root_path || '').trim())
const selectedModCount = computed(() =>
  selectedGame.value ? getLibraryModCount(selectedGame.value) : 0
)
const selectedSourceModCount = computed(() => getInstalledModCount(selectedGame.value || {}))
const selectedSummary = computed(() => {
  const status = selectedStatus.value
  if (status.key === GAME_STATUS.unbound.key) {
    return selectedHasSources.value ? uiText('ui.valueNoGameFolderBoundYet', { value1: (status.label) }) : status.label
  }
  if (status.key !== GAME_STATUS.ready.key) return status.label
  if (!selectedHasSources.value) return status.label
  if (selectedModCount.value <= 0) return uiText('ui.readyNoModsInstalled')
  const active = getLibraryActiveModCount(selectedGame.value)
  const activeText = active === null ? '' : uiText('ui.valueEnabled', { value1: (active) })
  return uiText('ui.readyValueModsValue', { value1: (selectedModCount.value), value2: (activeText) })
})
const selectedSourceOptions = computed(() =>
  (selectedGame.value?.availableSources || []).map((source) => ({
    value: source,
    label: SOURCE_LABEL_MAP[source] || source
  }))
)
const selectedSourceLabel = computed(() => SOURCE_LABEL_MAP[selectedGameSource.value] || '')
const canPreviewMods = computed(
  () =>
    selectedHasSources.value &&
    !getRetiredSourceFailure(resolveSelectedSourceForGame(selectedGame.value || {}))
)
const canTakeoverLocalMods = computed(() => TAKEOVER_SOURCES.includes(selectedGameSource.value))
const primaryRepairText = computed(() =>
  selectedStatus.value.key === GAME_STATUS.missing.key ? '重新定位游戏目录' : '绑定游戏目录'
)
const removeBlockReason = computed(() => {
  const game = selectedGame.value
  if (!game) return ''
  if (game.discovered && getGameStatus(game).key !== GAME_STATUS.missing.key) {
    return uiText('ui.onlyAutomaticallyDetectedGamesWithMissingFoldersCanBeRemoved')
  }
  if (getInstalledModCount(game) > 0) return uiText('ui.uninstallAllModsBeforeRemovingThisGame')
  return ''
})

// 行内详情区的纯展示数据。
const detailView = computed(() => {
  const game = selectedGame.value
  if (!game) return null
  return {
    title: gamePresentation(game).title,
    subtitle: selectedSubtitle.value,
    cover: hasCover(game) ? game.coverImage : '',
    tone: getCoverTone(game),
    monogram: getMonogram(game),
    status: selectedStatus.value.key,
    summary: selectedSummary.value,
    canLaunch: selectedCanLaunch.value,
    primaryText: selectedGamePrimaryActionText.value,
    repairText: primaryRepairText.value,
    hasSources: selectedHasSources.value,
    canPreview: canPreviewMods.value,
    folderExists: Boolean(game.isGameFolderExist),
    sourceOptions: selectedSourceOptions.value,
    source: selectedGameSource.value,
    sourceLabel: selectedSourceLabel.value,
    sourceModCount: selectedSourceModCount.value,
    modCount: selectedModCount.value,
    canRemove: !removeBlockReason.value,
    path: selectedPath.value
  }
})

function setMenuName() {
  setPageMenuName('我的游戏', route.path)
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function getInstalledModCount(game = {}) {
  return toSafeNumber(game?.clientModCount ?? game?.modCount, 0)
}

// 同一游戏目录可能关联多个来源记录，展示时按记录汇总。
function getLibraryEntries(game = {}) {
  return Array.isArray(game?.sourceEntries) && game.sourceEntries.length ? game.sourceEntries : [game]
}

function getLibraryModCount(game = {}) {
  return getLibraryEntries(game).reduce((total, entry) => total + getInstalledModCount(entry), 0)
}

// 旧版主进程没有启用数时返回 null，界面不展示启用数而不是猜测。
function getLibraryActiveModCount(game = {}) {
  let total = 0
  for (const entry of getLibraryEntries(game)) {
    if (entry?.clientActiveModCount === undefined || entry?.clientActiveModCount === null) {
      if (getInstalledModCount(entry) > 0) return null
      continue
    }
    total += toSafeNumber(entry.clientActiveModCount, 0)
  }
  return total
}

function getEntryStatus(entry = {}) {
  if (entry?.isGameLocalPathExist) return GAME_STATUS.ready
  if (String(entry?.client_root_path || '').trim() && !entry?.isGameFolderExist) {
    return GAME_STATUS.missing
  }
  return GAME_STATUS.unbound
}

function getGameStatus(game = {}) {
  const statuses = getLibraryEntries(game).map(getEntryStatus)
  if (statuses.some((status) => status.key === GAME_STATUS.ready.key)) return GAME_STATUS.ready
  if (statuses.some((status) => status.key === GAME_STATUS.missing.key)) return GAME_STATUS.missing
  return GAME_STATUS.unbound
}

function compareGames(a, b) {
  const rankDiff = STATUS_RANK[getGameStatus(a).key] - STATUS_RANK[getGameStatus(b).key]
  if (rankDiff) return rankDiff
  if (sortKey.value === 'name') {
    return gamePresentation(a).title.localeCompare(gamePresentation(b).title, contentLocale.value)
  }
  return getLibraryModCount(b) - getLibraryModCount(a)
}

function getSubtitle(game) {
  return gamePresentation(game).subtitle
}

// 卡片副标题只讲用户关心的一件事：模组数量或需要处理的状态。
function getCardMeta(game = {}) {
  const status = getGameStatus(game)
  const hasSources = (game?.availableSources || []).length > 0
  if (status.key === GAME_STATUS.missing.key) return hasSources ? '需要重新定位目录' : '找不到游戏目录'
  if (status.key === GAME_STATUS.unbound.key) return '未绑定游戏目录'
  if (!hasSources) return '本机识别 · 未关联模组来源'
  const modCount = getLibraryModCount(game)
  if (modCount <= 0) return '未安装模组'
  const active = getLibraryActiveModCount(game)
  return active === null ? uiText('ui.valueMods', { value1: (modCount) }) : uiText('ui.valueModsValueEnabled', { value1: (modCount), value2: (active) })
}

function getCardBadges(game = {}) {
  const labels = (game?.availableSources || []).map(
    (source) => SOURCE_SHORT_LABEL_MAP[source] || SOURCE_LABEL_MAP[source] || source
  )
  if (labels.length <= CARD_BADGE_LIMIT) return labels
  return [...labels.slice(0, CARD_BADGE_LIMIT - 1), `+${labels.length - CARD_BADGE_LIMIT + 1}`]
}

function getCardView(game = {}) {
  const primaryText = getQuickLaunchPrimaryActionText(game)
  return {
    key: game.libraryKey,
    title: gamePresentation(game).title,
    meta: getCardMeta(game),
    status: getGameStatus(game).key,
    cover: hasCover(game) ? game.coverImage : '',
    tone: getCoverTone(game),
    monogram: getMonogram(game),
    badges: getCardBadges(game),
    canLaunch: Boolean(game?.isGameLocalPathExist),
    launchLabel: primaryText,
    launchShort: primaryText === '启动游戏' ? '启动' : primaryText
  }
}

// 详情区小箭头对准第 column 列卡片的中心。
function getCaretLeft(column) {
  const columns = columnCount.value
  const centerPercent = ((column + 0.5) * 100) / columns
  const gapOffset = GRID_GAP_X * (column - ((column + 0.5) * (columns - 1)) / columns)
  return `calc(${centerPercent.toFixed(4)}% + ${(gapOffset - CARET_HALF).toFixed(2)}px)`
}

function getMonogram(game = {}) {
  const words = getSubtitle(game).split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length > 1) return words.slice(0, 3).map((word) => word[0]).join('').toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return [...(gamePresentation(game).title || '?')][0]
}

function getCoverTone(game = {}) {
  const key = String(game?.libraryKey || game?.chineseTitle || '')
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COVER_PLACEHOLDER_TONES[hash % COVER_PLACEHOLDER_TONES.length]
}

function hasCover(game = {}) {
  return Boolean(game?.coverImage) && !failedCovers[game.coverImage]
}

function markCoverFailed(game = {}) {
  if (game?.coverImage) failedCovers[game.coverImage] = true
}

function isSelected(game = {}) {
  return Boolean(selectedGame.value) && selectedGame.value.libraryKey === game.libraryKey
}

function getGameSteamAppId(game = {}) {
  return toSafeNumber(game?.steamAppId || game?.app_id || game?.appId || game?.steam_app_id, 0)
}

function getGameDetailId(game = {}) {
  return toSafeNumber(game?.game_id || game?.id, 0)
}

function getVertexDetailId(game = {}) {
  return toSafeNumber(game?.vertexGameId, 0)
}

function normalizeSourceType(value = '') {
  const source = normalizeSourcePlatform(value)
  return getSourcePlatformDefinition(source) ? source : ''
}

function buildManageKey(game = {}) {
  const source = normalizeSourceType(game?.source || game?.currentSource)
  return [
    source,
    String(game?.source_id || '').trim(),
    String(game?.source_slug || '').trim()
  ].join(':')
}

function getThunderstoreCommunity(game = {}) {
  return String(game?.source_slug || game?.source_id || '')
    .trim()
    .toLowerCase()
}

function getSourceMetaForGame(game = {}, sourceType = SOURCE_TYPE.VERTEX) {
  if (['modio', 'vamhub', 'gamebanana', 'steam-workshop'].includes(sourceType)) return sourceLibraryMeta(game)
  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    const community = getThunderstoreCommunity(game)
    if (!community) {
      return null
    }
    return {
      community,
      displayName: String(game?.chineseTitle || game?.englishTitle || game?.name || '').trim()
    }
  }

  if (sourceType === SOURCE_TYPE.FICSIT) {
    const ficsitGameId = getGameSteamAppId(game) || getGameDetailId(game)
    return {
      gameId: ficsitGameId,
      steamAppId: getGameSteamAppId(game) || FICSIT_STEAM_APP_ID
    }
  }

  if (sourceType === SOURCE_TYPE.NEXUS) {
    const domainName = String(game?.source_slug || '').trim()
    if (!domainName) {
      return null
    }
    return {
      domainName,
      gameName: String(game?.chineseTitle || game?.englishTitle || game?.name || '').trim(),
      coverImage: String(game?.coverImage || '').trim(),
      nexusGameId: String(game?.source_id || '').trim(),
      backendGameId: toSafeNumber(game?.game_id, 0)
    }
  }

  return {
    gameId: toSafeNumber(game?.game_id || game?.vertexGameId, 0)
  }
}

function resolveSelectedSourceForGame(game = {}) {
  const availableSources = getAvailableSources(game)
  return availableSources.includes(game.currentSource) ? game.currentSource : availableSources[0] || ''
}

function getAvailableSources(game = {}) {
  if (game.sourceEntries) return game.availableSources || []
  const source = normalizeSourceType(
    game?.targetSourcePlatform ||
      game?.target_source_platform ||
      game?.sourcePlatform ||
      game?.source_platform ||
      game?.source ||
      game?.currentSource
  )
  return source ? [source] : []
}

function mapGameWithSourceInfo(game = {}) {
  const availableSources = getAvailableSources(game)
  const currentSource = resolveSelectedSourceForGame(game)
  const sourceMeta = { [currentSource]: getSourceMetaForGame(game, currentSource) }
  const chineseTitle = String(
    game?.name || game?.chineseTitle || game?.englishTitle || '未知游戏'
  ).trim()
  const englishTitle = String(game?.english_name || game?.englishTitle || chineseTitle).trim()
  const coverImage = String(
    game?.cover_image || game?.coverImage || game?.background_image || ''
  ).trim()

  return {
    ...game,
    manageKey: buildManageKey(game),
    chineseTitle,
    englishTitle,
    coverImage,
    availableSources,
    sourceMeta,
    currentSource
  }
}

async function rebuildPageWithSourceInfo(rawList = []) {
  pageList.value = groupGameLibrary((Array.isArray(rawList) ? rawList : []).map(mapGameWithSourceInfo))
}

function refreshLibrary() {
  ipcRenderer.send('getGameListData')
}

// 只有手动刷新显示转圈和完成提示；进入页面时的静默刷新不打扰用户。
function refreshLibraryManually() {
  if (isRefreshing.value) return
  manualRefreshPending = true
  isRefreshing.value = true
  refreshLibrary()
}

// ===== 列数：按滚动区内容宽度计算 =====
function updateColumnCount(width) {
  const next = Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, Math.floor((width + GRID_GAP_X) / (CARD_MIN_WIDTH + GRID_GAP_X)))
  )
  if (Number.isFinite(next) && next !== columnCount.value) columnCount.value = next
}

function observeGridWidth() {
  const element = scrollRef.value
  if (!element || gridResizeObserver || typeof ResizeObserver === 'undefined') return
  gridResizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect?.width
    if (width > 0) updateColumnCount(width)
  })
  gridResizeObserver.observe(element)
}

// ===== 行内详情：点击封面展开，再点一次或 Esc 收起 =====
function getCoverButton(libraryKey = '') {
  if (!libraryKey) return null
  const selector = `[data-library-key="${CSS.escape(String(libraryKey))}"]`
  return scrollRef.value?.querySelector(selector) || null
}

function scrollDetailIntoView() {
  nextTick(() => {
    const detail = document.getElementById(DETAIL_ID)
    if (!detail) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    detail.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  })
}

function selectGame(game, { reveal = true } = {}) {
  closeMenu()
  selectedGame.value = game
  if (reveal) scrollDetailIntoView()
}

function toggleGame(game) {
  if (isSelected(game)) {
    closeDetail()
    return
  }
  selectGame(game)
}

function closeDetail({ restoreFocus = false } = {}) {
  const libraryKey = selectedGame.value?.libraryKey
  closeMenu()
  selectedGame.value = null
  if (restoreFocus) nextTick(() => getCoverButton(libraryKey)?.focus())
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (!selectedGame.value || activeMenu.value || confirmDialog.open) return
  closeDetail({ restoreFocus: true })
}

function handleDetailEscape() {
  if (activeMenu.value || confirmDialog.open) return
  closeDetail({ restoreFocus: true })
}

function setSourceFilter(source) {
  sourceFilter.value = source
}

function clearAllFilters() {
  searchKeyword.value = ''
  sourceFilter.value = SOURCE_TYPE.ALL
}

function handleSearchKeydown(event) {
  if (event.key !== 'Escape' || !searchKeyword.value) return
  // 搜索框里的 Esc 只清空搜索，不收起详情。
  event.preventDefault()
  searchKeyword.value = ''
}

function selectSort(value) {
  sortKey.value = value
  closeMenu({ restoreFocus: true })
}

// ===== 启动 =====
function isLaunching(game = {}) {
  return Boolean(game?.libraryKey && launchingKeys[game.libraryKey])
}

async function launchGame(game) {
  const key = game?.libraryKey
  if (!game || !key || launchingKeys[key]) return
  launchingKeys[key] = true
  const startedAt = Date.now()
  try {
    await startQuickLaunchGame(game)
  } catch (error) {
    console.error('我的游戏启动执行失败', error)
    $message.error(uiMessage('ui.launchFailedValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  } finally {
    const remaining = LAUNCH_MIN_BUSY_MS - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    delete launchingKeys[key]
  }
}

function startGame() {
  launchGame(selectedGame.value)
}

// ===== 需处理提示条 =====
function findGameByKey(libraryKey = '') {
  return pageList.value.find((game) => game.libraryKey === libraryKey) || null
}

function openAttentionGame(libraryKey) {
  const game = findGameByKey(libraryKey)
  if (game) selectGame(game)
}

function relocateAttentionGame(libraryKey) {
  const game = findGameByKey(libraryKey)
  if (!game) return
  selectGame(game, { reveal: false })
  relocateGameRoot()
}

function removeAttentionGame(libraryKey) {
  const game = findGameByKey(libraryKey)
  if (!game) return
  selectGame(game)
  if (removeBlockReason.value) {
    $message.info(removeBlockReason.value)
    return
  }
  requestRemoveGame()
}

function dismissAttention() {
  attentionDismissedThisRun = true
  attentionDismissed.value = true
}

function buildFicsitRouteQuery(game = {}, gameId = '') {
  const modCount = getInstalledModCount(game)
  return {
    name: String(game?.chineseTitle || game?.englishTitle || '幸福工厂').trim(),
    englishName: String(game?.englishTitle || 'Satisfactory').trim(),
    cover: String(game?.coverImage || '').trim(),
    desc: String(game?.description || '').trim(),
    mods: String(modCount),
    steamAppId: String(getGameSteamAppId(game) || FICSIT_STEAM_APP_ID),
    gameId: String(gameId || '')
  }
}

function resolveManageGameId(game = {}, sourceType = '', sourceMeta = {}) {
  if (sourceType === SOURCE_TYPE.VERTEX) {
    return toSafeNumber(sourceMeta?.gameId, getVertexDetailId(game))
  }
  if (sourceType === SOURCE_TYPE.FICSIT) {
    return toSafeNumber(sourceMeta?.gameId, getGameSteamAppId(game))
  }
  if (sourceType === SOURCE_TYPE.NEXUS) {
    return toSafeNumber(sourceMeta?.backendGameId, getGameDetailId(game))
  }
  return toSafeNumber(sourceMeta?.gameId, getGameDetailId(game))
}

function resolveManageSourceId(game = {}, sourceType = '', sourceMeta = {}, steamAppId = 0) {
  if (['modio', 'vamhub', 'gamebanana', 'steam-workshop'].includes(sourceType)) return String(sourceMeta.sourceId || sourceMeta.modioGameId || game.source_id || '')
  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    return String(sourceMeta?.community || getThunderstoreCommunity(game) || '')
      .trim()
      .toLowerCase()
  }
  if (sourceType === SOURCE_TYPE.FICSIT) {
    return String(sourceMeta?.gameId || getGameSteamAppId(game) || FICSIT_STEAM_APP_ID).trim()
  }
  if (sourceType === SOURCE_TYPE.NEXUS) {
    return (
      String(sourceMeta?.nexusGameId || '').trim() ||
      String(sourceMeta?.domainName || '').trim().toLowerCase()
    )
  }
  return String(steamAppId || getGameSteamAppId(game) || '').trim()
}

function buildModManagementQuery(game = {}, sourceType = '', sourceMeta = {}, steamAppId = 0) {
  const gameId = resolveManageGameId(game, sourceType, sourceMeta)
  const sourceId = resolveManageSourceId(game, sourceType, sourceMeta, steamAppId)
  const query = {
    source: sourceType,
    legacyGameRowId: sourceType === SOURCE_TYPE.VERTEX ? String(game.source_row_id || game.id || '') : '',
    sourceId: String(sourceId || '').trim(),
    gameId: String(gameId || ''),
    community:
      sourceType === SOURCE_TYPE.THUNDERSTORE ? String(sourceMeta?.community || '').trim() : '',
    profile: resolveSelectedSourceProfileName(sourceType, sourceId),
    name: game.chineseTitle || game.name || '',
    rootPath: game.client_root_path || '',
    sourceSlug: game.source_slug || '',
    domainName: sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.domainName || '').trim() : '',
    nexusGameId:
      sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.nexusGameId || '').trim() : '',
    backendGameId:
      sourceType === SOURCE_TYPE.NEXUS
        ? String(sourceMeta?.backendGameId || gameId || '').trim()
        : '',
    appId: String(steamAppId || '').trim()
  }
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => String(value || '').trim() !== '')
  )
}

async function ensureNexusSteamAppId(game = {}) {
  const existingAppId = getGameSteamAppId(game)
  if (existingAppId > 0) {
    return existingAppId
  }

  const sourceType = normalizeSourceType(game?.source || game?.currentSource || game?.sourceType)
  const backendGameId = toSafeNumber(game?.game_id || game?.sourceMeta?.nexus?.backendGameId, 0)
  if (sourceType !== SOURCE_TYPE.NEXUS || backendGameId <= 0) {
    return 0
  }

  const cachedAppId = toSafeNumber(nexusSteamAppIdByGameId.value[backendGameId], 0)
  if (cachedAppId > 0) {
    game.steamAppId = cachedAppId
    game.app_id = String(cachedAppId)
    return cachedAppId
  }

  try {
    const detail = (await GET_GAME_DETAILS(backendGameId)) || {}
    const resolvedAppId = toSafeNumber(
      detail?.steamAppId || detail?.app_id || detail?.appId || detail?.steam_app_id,
      0
    )
    if (resolvedAppId > 0) {
      nexusSteamAppIdByGameId.value = {
        ...nexusSteamAppIdByGameId.value,
        [backendGameId]: resolvedAppId
      }
      game.steamAppId = resolvedAppId
      game.app_id = String(resolvedAppId)
      return resolvedAppId
    }
  } catch (error) {
    console.warn('[Game Repository] 读取 Nexus 游戏 AppId 失败', error)
  }

  return 0
}

async function goToModManagement(options = {}) {
  const game = selectedGame.value
  if (!game) return

  const sourceType = resolveSelectedSourceForGame(game)
  if (!sourceType) {
    $message.warning(uiMessage('ui.thisGameHasNoAvailableSourceForModManagement'))
    return
  }

  const steamAppId = await ensureNexusSteamAppId(game)
  if (!steamAppId && (sourceType === SOURCE_TYPE.VERTEX || sourceType === SOURCE_TYPE.FICSIT)) {
    $message.warning(uiMessage('ui.noValidGameIdentifierFound'))
    return
  }

  const sourceMeta = game?.sourceMeta?.[sourceType] || {}
  const gameId = resolveManageGameId(game, sourceType, sourceMeta)
  const sourceId = resolveManageSourceId(game, sourceType, sourceMeta, steamAppId)
  if (!sourceId) {
    $message.warning(uiMessage('ui.thisSourceHasNoValidIdentifierForModManagement'))
    return
  }

  gameStore.setCurrentManagedGame({
    manageKey: game.manageKey || buildManageKey(game),
    sourceId,
    steamAppId,
    chineseTitle: String(game?.chineseTitle || game?.englishTitle || '').trim(),
    is_server_installed: Number(game?.is_server_installed || 0),
    server_install_mod_type: Number(game?.server_install_mod_type || 0),
    gId: gameId,
    sourceType,
    sourceCommunity:
      sourceType === SOURCE_TYPE.THUNDERSTORE ? String(sourceMeta?.community || '') : '',
    sourceProfile: resolveSelectedSourceProfileName(sourceType, sourceId),
    sourceGameId: gameId,
    sourceDomainName:
      sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.domainName || '').trim() : '',
    sourceNexusGameId:
      sourceType === SOURCE_TYPE.NEXUS ? toSafeNumber(sourceMeta?.nexusGameId, 0) : 0
  })

  router.push({
    path: `/app/game/modManagement/${encodeURIComponent(String(sourceType))}/${encodeURIComponent(String(sourceId))}`,
    query: {
      ...buildModManagementQuery(game, sourceType, sourceMeta, steamAppId),
      ...(options.action ? { action: options.action } : {})
    }
  })
}

function openConfirm({ title, content, confirmText = uiText('ui.confirm'), danger = false, action = null }) {
  Object.assign(confirmDialog, { open: true, title, content, confirmText, danger, action })
}

async function runConfirmAction() {
  const action = confirmDialog.action
  if (typeof action === 'function') await action()
}

function takeoverLocalMods() {
  closeMenu()
  confirmGameRootBindingBeforeLocalModManage()
}

function confirmGameRootBindingBeforeLocalModManage() {
  const game = selectedGame.value
  if (!game) return

  if (game.isGameLocalPathExist) {
    goToModManagement({ action: 'manage-local-mod' })
    return
  }

  openConfirm({
    get title() { return uiText('ui.noGameDetected') },
    content:
      '当前还未识别游戏目录，是否先前往来源页面绑定游戏根目录？绑定完成后才能管理本地模组。',
    get confirmText() { return uiText('ui.chooseAFolder') },
    action: () => goToModDownload()
  })
}

function openFolder() {
  closeMenu()
  const path = selectedPath.value
  if (!path) {
    $message.warning(uiMessage('ui.gameFolderNotFound'))
    return
  }
  ipcRenderer.send('openSpecifyPath', path)
}

async function copySelectedPath() {
  closeMenu()
  const path = selectedPath.value
  if (!path) {
    $message.warning(uiMessage('ui.noFolderIsRecordedForThisGame'))
    return
  }
  try {
    await navigator.clipboard.writeText(path)
    $message.success(uiMessage('ui.gamePathCopied'))
  } catch (error) {
    console.warn('[游戏库] 复制游戏路径失败', error)
    $message.error(uiMessage('tools.copyFailedTryAgainLater'))
  }
}

// 目录缺失或未绑定时，前往来源页面重新绑定游戏根目录。
function relocateGameRoot() {
  closeMenu()
  goToModDownload()
}

function requestRemoveGame() {
  const game = selectedGame.value
  closeMenu()
  if (!game || removeBlockReason.value) return

  const hasMultipleSources = (game.availableSources || []).length > 1
  const sourceText = hasMultipleSources ? uiText('ui.sourceRecordForValue', { value1: (selectedSourceLabel.value) }) : ''
  openConfirm({
    get title() { return uiText('ui.removeFromLibrary') },
    content: game.discovered
      ? uiText('ui.removeTheInvalidAutomaticallyDetectedRecordForValueGameFiles', { value1: (game.chineseTitle) })
      : uiText('ui.removeValueValueFromTheLibraryOnlyVertexManagementRecords', { value1: (game.chineseTitle), value2: (sourceText) }),
    get confirmText() { return uiText('ui.remove') },
    danger: true,
    action: async () => {
      const result = await ipcRenderer.invoke('removeGame', game.id)
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRemoveTheGame'))
      $message.success(result.message || '已从游戏库移除')
      refreshLibrary()
    }
  })
}

async function goToModDownload() {
  const game = selectedGame.value
  if (!game) return

  const sourceType = resolveSelectedSourceForGame(game)
  const retired = getRetiredSourceFailure(sourceType)
  if (retired) { $message.info(retired.message); return }
  if (!sourceType) {
    $message.warning(uiMessage('ui.thisGameHasNoAvailableSourceForModPreview'))
    return
  }
  const sourceMeta = game?.sourceMeta?.[sourceType] || {}
  const sharedRoute = sourceLibraryRoute(game, sourceType)
  if (sharedRoute) { router.push(sharedRoute); return }

  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    const community = String(sourceMeta?.community || '')
      .trim()
      .toLowerCase()
    if (!community) {
      $message.warning(uiMessage('ui.thisGameHasNoThunderstoreCommunityIdentifierForPreview'))
      return
    }
    router.push(`/app/game/thunderstore/mod/list/${encodeURIComponent(community)}`)
    return
  }

  if (sourceType === SOURCE_TYPE.FICSIT) {
    const gameId = toSafeNumber(sourceMeta?.gameId, getGameSteamAppId(game))
    if (!gameId) {
      $message.warning(uiMessage('ui.thisFicsitGameHasNoValidIdentifierForPreview'))
      return
    }
    router.push({
      path: `/app/game/ficsit/mod/list/${encodeURIComponent(String(gameId))}`,
      query: buildFicsitRouteQuery(game, gameId)
    })
    return
  }

  if (sourceType === SOURCE_TYPE.NEXUS) {
    const steamAppId = await ensureNexusSteamAppId(game)
    const domainName = String(sourceMeta?.domainName || '')
      .trim()
      .toLowerCase()
    if (!domainName) {
      $message.warning(uiMessage('ui.thisNexusGameHasNoDomainIdentifierForPreview'))
      return
    }
    router.push({
      path: `/app/game/nexus/mod/list/${encodeURIComponent(domainName)}`,
      query: {
        name: String(
          sourceMeta?.gameName || game?.chineseTitle || game?.englishTitle || domainName
        ).trim(),
        cover: String(sourceMeta?.coverImage || game?.coverImage || '').trim(),
        mods: String(getInstalledModCount(game)),
        nexusGameId: String(sourceMeta?.nexusGameId || ''),
        englishTitle: String(game?.englishTitle || '').trim(),
        backendGameId: String(sourceMeta?.backendGameId || ''),
        appId: String(steamAppId || '')
      }
    })
    return
  }

  const gameId = toSafeNumber(sourceMeta?.gameId, getVertexDetailId(game))
  if (!gameId) {
    $message.warning(uiMessage('ui.noValidIdentifierFoundForGameDetails'))
    return
  }
  $message.info(uiMessage('ui.thisSourceDoesNotSupportOnlineBrowsingViewInstalledMods'))
}

function switchSelectedGameSource(sourceType = '') {
  const group = selectedGame.value
  const entry = group?.sourceEntries?.find(record => normalizeSourceType(record.source || record.currentSource) === sourceType)
  if (!entry) return
  selectedGame.value = { ...group, ...entry, libraryKey: group.libraryKey, sourceEntries: group.sourceEntries, availableSources: group.availableSources, sourceMeta: group.sourceMeta, currentSource: sourceType }
  selectedGameSource.value = normalizeSourceType(sourceType)
}

// ===== 最近安装 =====
function getSelectedGameRowIds(game = {}) {
  return getLibraryEntries(game)
    .filter((entry) => !entry?.discovered)
    .map((entry) => Number(entry?.source_row_id ?? entry?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
}

async function loadRecentMods(game) {
  const requestId = ++recentModsRequestId
  const gameRowIds = game ? getSelectedGameRowIds(game) : []
  if (!gameRowIds.length || getLibraryModCount(game) <= 0) {
    recentMods.value = []
    recentModsState.value = 'ready'
    return
  }
  recentModsState.value = 'loading'
  try {
    const result = await ipcRenderer.invoke('getRecentInstalledMods', {
      gameRowIds,
      limit: RECENT_MOD_LIMIT
    })
    if (requestId !== recentModsRequestId) return
    if (result?.success === false) throw new Error(result?.code || 'recent_mods_read_failed')
    recentMods.value = Array.isArray(result?.list) ? result.list : []
    recentModsState.value = 'ready'
  } catch (error) {
    if (requestId !== recentModsRequestId) return
    console.warn('[游戏库] 读取最近安装模组失败', error)
    recentMods.value = []
    recentModsState.value = 'error'
  }
}

// ===== 浮层菜单（排序 / 更多操作） =====
function getMenuTrigger() {
  return menuTriggerEl.value
}

function getMenuItems() {
  return [...(menuRef.value?.querySelectorAll('button:not(:disabled)') || [])]
}

async function openMenu(name, trigger) {
  if (!trigger) return
  menuTriggerEl.value = trigger
  const width = MENU_WIDTH[name] || MENU_WIDTH.more
  const rect = trigger.getBoundingClientRect()
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_MARGIN)
  )
  menuStyle.value = { top: `${rect.bottom + MENU_GAP}px`, left: `${left}px`, width: `${width}px` }
  activeMenu.value = name
  await nextTick()
  const menu = menuRef.value
  if (menu) {
    const height = menu.offsetHeight
    if (rect.bottom + MENU_GAP + height > window.innerHeight - VIEWPORT_MARGIN) {
      menuStyle.value = {
        ...menuStyle.value,
        top: `${Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - height)}px`
      }
    }
    const items = getMenuItems()
    const checked = menu.querySelector('[aria-checked="true"]')
    ;(checked && items.includes(checked) ? checked : items[0])?.focus()
  }
  document.addEventListener('mousedown', handleOutsidePointer, true)
  document.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('blur', handleViewportChange)
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!activeMenu.value) return
  const trigger = getMenuTrigger()
  activeMenu.value = ''
  document.removeEventListener('mousedown', handleOutsidePointer, true)
  document.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('blur', handleViewportChange)
  if (restoreFocus) trigger?.focus()
}

function toggleMenu(name, trigger) {
  if (activeMenu.value === name) {
    closeMenu()
    return
  }
  closeMenu()
  openMenu(name, trigger)
}

function handleViewportChange(event) {
  // 菜单自身滚动不关闭。
  if (event?.type === 'scroll' && menuRef.value?.contains(event.target)) return
  closeMenu()
}

function handleOutsidePointer(event) {
  if (menuRef.value?.contains(event.target) || getMenuTrigger()?.contains(event.target)) return
  closeMenu()
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') event.preventDefault()
    closeMenu({ restoreFocus: event.key === 'Escape' })
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = getMenuItems()
  if (!items.length) return
  const index = items.indexOf(document.activeElement)
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[nextIndex]?.focus()
}

// 游戏列表刷新后，用 libraryKey 重新绑定已展开的详情；游戏不存在时收起面板。
watch(pageList, (list) => {
  const current = selectedGame.value
  if (!current) return
  const hit = list.find((item) => item.libraryKey === current.libraryKey)
  if (!hit) {
    closeDetail()
    return
  }
  const currentSource = selectedGameSource.value
  selectedGame.value = hit
  if (hit.availableSources.includes(currentSource)) switchSelectedGameSource(currentSource)
})

watch(
  selectedGame,
  (game) => {
    if (!game) {
      selectedGameSource.value = ''
      return
    }
    selectedGameSource.value = resolveSelectedSourceForGame(game)
  },
  { immediate: true }
)

watch(
  () => [selectedGame.value?.libraryKey || '', selectedModCount.value],
  ([libraryKey]) => {
    if (libraryKey) loadRecentMods(selectedGame.value)
  },
  { immediate: true }
)

// 筛选、搜索把选中的游戏过滤掉时收起详情，避免详情区找不到所在行。
watch(filteredPageList, (list) => {
  const current = selectedGame.value
  if (current && !list.some((game) => game.libraryKey === current.libraryKey)) closeDetail()
})

onMounted(observeGridWidth)

onActivated(() => {
  refreshLibrary()
  setMenuName()
  observeGridWidth()
  document.addEventListener('keydown', handleDocumentKeydown)
})

function teardown() {
  closeMenu()
  document.removeEventListener('keydown', handleDocumentKeydown)
}

onDeactivated(teardown)
onBeforeUnmount(() => {
  teardown()
  gridResizeObserver?.disconnect()
  gridResizeObserver = null
})

useIpc('getGameListDataSuccess', async (data = []) => {
  await rebuildPageWithSourceInfo(Array.isArray(data) ? data : [])
  isLibraryLoaded.value = true
  isRefreshing.value = false
  if (manualRefreshPending) {
    manualRefreshPending = false
    $message.success(uiMessage('ui.gameLibraryRefreshed'))
  }
})

defineOptions({
  name: 'GameRepository'
})
</script>

<template>
  <div class="gameRepository-index">
    <page-body :is-scroll-enabled="false">
      <div class="repo">
        <header class="repo-toolbar">
          <div class="repo-filters" role="group" :aria-label="$t('ui.filterBySource')">
            <button
              v-for="tab in sourceTabs"
              :key="tab.key"
              type="button"
              class="repo-filter"
              :class="{ 'is-active': sourceFilter === tab.key }"
              :aria-pressed="sourceFilter === tab.key"
              @click="setSourceFilter(tab.key)"
            >
              {{ tab.label }}
              <span v-if="isLibraryLoaded" class="repo-filter__count">{{ tab.count }}</span>
            </button>
          </div>

          <div class="repo-tools">
            <label class="repo-search">
              <svg
                class="repo-search__icon"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" />
              </svg>
              <input
                v-model="searchKeyword"
                type="text"
                :placeholder="$t('tools.searchGames')"
                :aria-label="$t('tools.searchGames')"
                @keydown="handleSearchKeydown"
              />
              <button
                v-if="searchKeyword"
                type="button"
                class="repo-search__clear"
                :aria-label="$t('tools.clearSearch')"
                @click="searchKeyword = ''"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              </button>
            </label>

            <button
              ref="sortTriggerRef"
              type="button"
              class="repo-ghost-button"
              aria-haspopup="menu"
              :aria-expanded="activeMenu === 'sort'"
              @click="toggleMenu('sort', sortTriggerRef)"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M4 3v10M2 11l2 2 2-2M9 4h5M9 8h3.5M9 12h2" />
              </svg>
              {{ sortLabel }}
            </button>

            <button
              type="button"
              class="repo-ghost-button is-icon"
              :aria-label="$t('ui.refreshLibrary')"
              :title="$t('ui.refreshLibrary')"
              :disabled="isRefreshing"
              :aria-busy="isRefreshing"
              @click="refreshLibraryManually"
            >
              <svg
                :class="{ 'is-spinning': isRefreshing }"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3" />
              </svg>
            </button>
          </div>
        </header>

        <div ref="scrollRef" class="repo-scroll">
          <LibraryAttention
            v-if="showAttention"
            :items="attentionItems"
            @relocate="relocateAttentionGame"
            @remove="removeAttentionGame"
            @open="openAttentionGame"
            @dismiss="dismissAttention"
          />

          <div
            v-if="!isLibraryLoaded"
            class="repo-grid"
            :style="gridStyle"
            aria-busy="true"
            :aria-label="$t('ui.loadingGameLibrary')"
          >
            <div
              v-for="index in skeletonCount"
              :key="index"
              class="repo-skeleton-card"
              aria-hidden="true"
            >
              <span class="repo-skeleton-card__cover"></span>
              <span class="repo-skeleton-line is-wide"></span>
              <span class="repo-skeleton-line"></span>
            </div>
          </div>

          <section
            v-else-if="filteredPageList.length"
            class="repo-library"
            aria-labelledby="repo-grid-title"
          >
            <div class="repo-library__heading">
              <h1 id="repo-grid-title">{{ gridTitle }}</h1>
              <span>{{ filteredPageList.length }} {{ $t('ui.itemsVariant2') }}</span>
            </div>

            <div class="repo-rows">
              <div v-for="row in gridRows" :key="row.key" class="repo-row-group">
                <div class="repo-grid" :style="gridStyle">
                  <LibraryCard
                    v-for="game in row.items"
                    :key="game.libraryKey"
                    :view="getCardView(game)"
                    :selected="isSelected(game)"
                    :launching="isLaunching(game)"
                    :detail-id="DETAIL_ID"
                    @select="toggleGame(game)"
                    @launch="launchGame(game)"
                    @cover-error="markCoverFailed(game)"
                  />
                </div>

                <LibraryDetail
                  v-if="row.selectedIndex >= 0 && detailView"
                  :detail-id="DETAIL_ID"
                  :view="detailView"
                  :caret-left="getCaretLeft(row.selectedIndex)"
                  :launching="isLaunching(selectedGame)"
                  :more-expanded="activeMenu === 'more'"
                  :recent-mods="recentMods"
                  :recent-state="recentModsState"
                  :recent-limit="RECENT_MOD_LIMIT"
                  @close="closeDetail({ restoreFocus: true })"
                  @escape="handleDetailEscape"
                  @launch="startGame"
                  @relocate="relocateGameRoot"
                  @manage="goToModManagement()"
                  @browse="goToModDownload"
                  @open-folder="openFolder"
                  @copy-path="copySelectedPath"
                  @toggle-more="(trigger) => toggleMenu('more', trigger)"
                  @switch-source="switchSelectedGameSource"
                  @remove="requestRemoveGame"
                  @cover-error="markCoverFailed(selectedGame)"
                />
              </div>
            </div>
          </section>

          <div v-else-if="pageList.length" class="repo-empty">
            <strong>{{ $t('ui.noMatchingGames') }}</strong>
            <span>{{ emptyFilterText }}</span>
            <VxButton variant="secondary" size="sm" @click="clearAllFilters">{{ $t('tools.clearFilters') }}</VxButton>
          </div>

          <div v-else class="repo-empty is-library">
            <span class="repo-empty__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="2.5" y="7" width="19" height="11" rx="5.5" />
                <path d="M7.5 10.5v4M5.5 12.5h4" />
                <circle cx="15.5" cy="11.5" r=".8" fill="currentColor" />
                <circle cx="17.5" cy="13.5" r=".8" fill="currentColor" />
              </svg>
            </span>
            <strong>{{ $t('ui.noGamesDetectedYet') }}</strong>
            <span>{{ $t('ui.vertexDetectsGamesInstalledOnThisComputerRefreshTheLibrary') }}</span>
            <VxButton size="lg" :loading="isRefreshing" @click="refreshLibraryManually"
              >{{ $t('ui.refreshLibrary') }}</VxButton
            >
          </div>
        </div>
      </div>
    </page-body>

    <Teleport to="body">
      <div
        v-if="activeMenu"
        ref="menuRef"
        class="repo-menu"
        role="menu"
        :aria-label="activeMenu === 'sort' ? $t('modBrowser.sortBy') : $t('ui.moreActions')"
        :style="menuStyle"
        @keydown="handleMenuKeydown"
      >
        <template v-if="activeMenu === 'sort'">
          <button
            v-for="option in SORT_OPTIONS"
            :key="option.value"
            type="button"
            role="menuitemradio"
            class="repo-menu__item is-row"
            :aria-checked="sortKey === option.value"
            @click="selectSort(option.value)"
          >
            <span>{{ option.label }}</span>
            <svg
              v-if="sortKey === option.value"
              class="repo-menu__check"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            role="menuitem"
            class="repo-menu__item"
            :disabled="!selectedGame?.isGameFolderExist"
            @click="openFolder"
          >
            {{ $t('ui.openGameFolder') }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="repo-menu__item"
            :disabled="!selectedPath"
            @click="copySelectedPath"
          >
            {{ $t('ui.copyGamePath') }}
          </button>
          <button
            v-if="selectedHasSources && canTakeoverLocalMods"
            type="button"
            role="menuitem"
            class="repo-menu__item"
            @click="takeoverLocalMods"
          >
            {{ $t('ui.manageExistingLocalMods') }}
          </button>
          <button
            v-if="selectedHasSources"
            type="button"
            role="menuitem"
            class="repo-menu__item"
            @click="relocateGameRoot"
          >
            {{ $t('ui.changeGameFolder') }}
          </button>
          <div class="repo-menu__divider" role="separator"></div>
          <button
            type="button"
            role="menuitem"
            class="repo-menu__item is-danger"
            :disabled="Boolean(removeBlockReason)"
            @click="requestRemoveGame"
          >
            <span>{{ $t('ui.removeFromLibrary') }}</span>
            <small v-if="removeBlockReason">{{ removeBlockReason }}</small>
          </button>
        </template>
      </div>
    </Teleport>

    <VxConfirmModal
      v-model="confirmDialog.open"
      :title="confirmDialog.title"
      :content="confirmDialog.content"
      :confirm-text="confirmDialog.confirmText"
      :danger="confirmDialog.danger"
      :confirm-action="runConfirmAction"
    />
  </div>
</template>

<style scoped lang="scss">
$page-x: 28px;
// 与脚本里的 GRID_GAP_X 保持一致，详情区箭头按它计算位置。
$grid-gap-x: 22px;
$grid-gap-y: 28px;

@mixin inner-scrollbar {
  &::-webkit-scrollbar {
    width: 7px;
  }
  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--radius-sm);
  }
  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
    min-height: 40px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

@mixin focus-ring {
  outline: none;

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.gameRepository-index {
  width: 100%;
  height: 100%;
}

.repo {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

/* ===== 顶部：来源胶囊 + 工具 ===== */
.repo-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
  padding: var(--space-5) $page-x var(--space-4);
}

.repo-filters {
  display: flex;
  flex: 1 1 480px;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.repo-filter {
  @include focus-ring;

  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height-sm);
  padding: 0 14px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  background: var(--color-surface-hover);
  border: 0;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-active) {
    background: var(--color-surface-strong);
  }

  &.is-active {
    color: var(--color-text-inverse);
    background: var(--color-text);

    .repo-filter__count {
      color: color-mix(in srgb, var(--color-text-inverse) 78%, var(--color-text));
    }
  }
}

.repo-filter__count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

.repo-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.repo-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 220px;
  height: var(--control-height-md);
  padding: 0 6px 0 var(--space-3);
  color: var(--color-text-muted);
  background: var(--color-surface-hover);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:focus-within {
    background: var(--color-surface);
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  input {
    flex: 1;
    min-width: 0;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    background: transparent;
    border: 0;
    outline: none;

    &::placeholder {
      color: var(--color-placeholder);
    }
  }
}

.repo-search__icon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
}

.repo-search__clear {
  @include focus-ring;

  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--color-text-muted);
  background: var(--color-surface-strong);
  border: 0;
  border-radius: 50%;
  cursor: pointer;

  svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    color: var(--color-text);
  }
}

.repo-ghost-button {
  @include focus-ring;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--control-height-md);
  padding: 0 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  svg {
    width: 15px;
    height: 15px;
  }

  &.is-icon {
    width: var(--control-height-md);
    padding: 0;
  }

  &:hover:not(:disabled),
  &[aria-expanded='true'] {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:disabled {
    cursor: progress;
  }
}

.is-spinning {
  animation: repo-spin 800ms linear infinite;
}

@keyframes repo-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ===== 滚动区：提示条 + 封面网格 ===== */
.repo-scroll {
  @include inner-scrollbar;

  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-1) $page-x var(--space-8);
  overflow-y: auto;
}

.repo-library {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.repo-library__heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: var(--font-weight-semibold);
  }

  span {
    color: var(--color-text-muted);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
}

.repo-rows {
  display: flex;
  flex-direction: column;
  gap: $grid-gap-y;
}

.repo-row-group {
  display: flex;
  flex-direction: column;
}

.repo-grid {
  display: grid;
  gap: $grid-gap-y $grid-gap-x;
  align-content: start;
}

.repo-skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.repo-skeleton-card__cover {
  display: block;
  aspect-ratio: 16 / 9;
  background: var(--color-surface-strong);
  border-radius: 10px;
  animation: repo-pulse 1.4s var(--ease-standard) infinite;
}

.repo-skeleton-line {
  display: block;
  width: 40%;
  height: 10px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-xs);
  animation: repo-pulse 1.4s var(--ease-standard) infinite;

  &.is-wide {
    width: 70%;
  }
}

@keyframes repo-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

.repo-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 120px var(--space-4);
  color: var(--color-text-muted);
  text-align: center;
  line-height: var(--line-height-base);

  strong {
    color: var(--color-text);
    font-size: 15px;
    font-weight: var(--font-weight-semibold);
  }

  span {
    max-width: 420px;
  }

  :deep(.vx-button) {
    margin-top: var(--space-2);
  }

  &.is-library strong {
    font-size: var(--font-size-lg);
  }
}

.repo-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 6px;
  color: var(--color-text-tertiary);
  background: var(--color-surface-hover);
  border-radius: var(--radius-xl);

  svg {
    width: 26px;
    height: 26px;
  }
}

/* ===== 浮层菜单（Teleport 到 body） ===== */
.repo-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  padding: var(--space-1);
  font-family: var(--font-family-base);
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-white));
  border-radius: 10px;
  box-shadow: 0 16px 32px -16px rgba(15, 23, 42, 0.35);
}

.repo-menu__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;

  &.is-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  small {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--color-surface-hover);
  }

  &.is-danger {
    color: var(--color-danger);
  }

  &:disabled {
    color: var(--control-text-disabled);
    cursor: not-allowed;
  }
}

.repo-menu__check {
  width: 14px;
  height: 14px;
  color: var(--color-accent);
}

.repo-menu__divider {
  height: 1px;
  margin: var(--space-1) 6px;
  background: color-mix(in srgb, var(--color-border) 60%, var(--color-white));
}

@media (prefers-reduced-motion: reduce) {
  .repo-filter,
  .repo-search,
  .repo-ghost-button {
    transition: none;
  }

  .repo-skeleton-line,
  .repo-skeleton-card__cover {
    animation: none;
  }
}
</style>
