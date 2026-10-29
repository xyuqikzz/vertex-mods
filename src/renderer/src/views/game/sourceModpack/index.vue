<script setup>
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { computed, h, nextTick, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUserStore } from '@renderer/store/userStore.js'
import { Modal } from 'ant-design-vue'
import UserLogin from '@renderer/component/auth/user-login.vue'
import { VxButton, VxModal, VxSegmented, VxSelect } from '@renderer/component/vertex-ui'
import ToolIcon from '@renderer/component/tool-page/ToolIcon.vue'
import GameCover from '@views/game/component/index/game-cover.vue'
import SourceModpackEditorModal from '@views/game/sourceModpack/component/SourceModpackEditorModal.vue'
import SourceModpackPreviewModal from '@views/game/sourceModpack/component/SourceModpackPreviewModal.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { useI18n } from 'vue-i18n'
import {
  DELETE_SOURCE_MODPACK,
  GET_MY_SOURCE_MODPACK_FAVORITES,
  GET_MY_SOURCE_MODPACK_LIST,
  GET_MY_SOURCE_MODPACK_SUBSCRIPTIONS,
  GET_SOURCE_MODPACK_BY_CODE,
  GET_SOURCE_MODPACK_INFO,
  GET_SOURCE_MODPACK_LIST,
  GET_SOURCE_MODPACK_SUBSCRIPTION_UPDATES,
  MARK_SOURCE_MODPACK_SUBSCRIPTION_SEEN,
  TOGGLE_SOURCE_MODPACK_FAVORITE,
  TOGGLE_SOURCE_MODPACK_LIKE,
  TOGGLE_SOURCE_MODPACK_SUBSCRIBE,
  UPDATE_SOURCE_MODPACK,
  UPDATE_SOURCE_MODPACK_PUBLISH
} from '@renderer/api/modules/source-modpack.js'
import {
  GET_SHARED_INSTALL_RULE,
} from '@renderer/api/modules/game.js'
import {
  getSourceModpackDetailPack,
  getSourceModpackPlatformLabel,
  normalizeSourceModpackEditorDraft,
  normalizeSourceModpackPlatform,
  normalizeSourceModpackPage
} from '@renderer/utils/source-modpack-share.js'
import { ensureSourceProfile } from '@renderer/utils/source-profile-registry.js'
import { inspectShareImport, applyShareImport } from '@renderer/utils/source-modpack-coordinator-runtime.js'
import {
  buildSourceModpackLocalRecords,
  buildSourceModpackInstanceTargetOverrides,
  buildSourceModpackSubscriptionUpdates
} from '@renderer/utils/source-modpack-update-view-model.js'
import { applyEffectiveNexusApiConfig } from '@renderer/utils/nexus-api-config.js'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import {
  listSourceModpackImportSources,
  resolveSourcePlatformLabel
} from '../../../../../shared/sources/source-platform-registry.js'
import { getSourceModpackViewLabel, isSourceModpackView } from './source-modpack-views.js'

// 整合包面板嵌在模组中心内容区：分类导航在模组中心左栏，由父组件通过 v-model:view 控制。
// 旧路由 GameSourceModpacks 已重定向到模组中心，本组件不再作为独立页面使用。
const props = defineProps({
  // 当前分类：public / local / mine / favorites / subscriptions；为空时按登录状态选默认分类。
  view: { type: String, default: '' },
  // 面板是否可见（父组件用 v-show 切换，隐藏时需要关闭浮层菜单）。
  active: { type: Boolean, default: true },
  // 从旧路由 ?code= 带入的分享码，进入后自动预览。
  initialCode: { type: String, default: '' }
})
const emit = defineEmits(['update:view', 'nav-meta'])

const userStore = useUserStore()
const { t } = useI18n()
function requireCloudAccount() {
  if (userStore.isLogin) return true
  $message.info(uiMessage('ui.signInToUseThisActionLocalModpacksRemainAvailable'))
  return false
}

const platformOptions = [
  { value: '', get label() { return uiText('ui.allPlatforms') } },
  ...listSourceModpackImportSources().map((source) => ({
    value: source,
    label: resolveSourcePlatformLabel(source)
  })),
  { value: 'mixed', get label() { return uiText('ui.mixedSources') } }
]

const activeTab = ref(
  isSourceModpackView(props.view) ? props.view : userStore.isLogin ? 'public' : 'local'
)
const loading = ref(false)
const records = ref([])
const total = ref(0)
const subscriptionUpdates = ref([])
const codeInput = ref('')
const query = ref({
  page: 1,
  size: 12,
  keyword: '',
  sourceType: '',
  sourceGameId: ''
})
const preview = ref({
  open: false,
  loading: false,
  installing: false,
  detail: null,
  items: [],
  selectedKeys: {},
  inspection: null,
  intent: 'auto'
})
const previewResolverOptions = ref({})
const manualDownloadOpen = ref(false)
const targetPicker = ref({
  open: false,
  detail: null,
  candidates: [],
  loadingId: 0
})
const sourceModpackEditor = ref({
  open: false,
  loadingId: '',
  saving: false,
  detail: null
})
// 页面展示状态：左栏数量、分段筛选、分享码就地错误、「更多」菜单。
const localInstances = ref([])
const localFilter = ref('all')
const mineFilter = ref('all')
const localStats = ref({ all: 0, update: 0, attention: 0 })
const mineStats = ref({ all: 0, public: 0, code: 0, off: 0, imports: 0 })
const mineLoaded = ref(false)
const codeError = ref('')
const codeInputRef = ref(null)
const userLoginRef = ref(null)
const menuState = ref({ pack: null, style: {} })
const menuRef = ref(null)
let menuTrigger = null
let listRequestSerial = 0
let subscriptionRequestSerial = 0
let resolverOptionsPromise = null
let sourceInstallTaskRefreshTimer = null
const nexusRuleRequestCache = new Map()

const BUSY_INSTANCE_STATES = ['installing', 'updating', 'repairing', 'removing']
const ATTENTION_STATES = ['partial', 'repair_required', 'conflict', 'orphaned']
const BUSY_STATE_TEXT = {
  get installing() { return uiText('taskCenter.states.installing') },
  get updating() { return uiText('ui.updatingVariant2') },
  get repairing() { return uiText('ui.repairing') },
  get removing() { return uiText('ui.uninstallingVariant2') }
}

const totalPage = computed(() => Math.max(1, Math.ceil(total.value / query.value.size)))
// 「订阅更新」不再是独立标签：在左栏归入「我的订阅」，在该视图里是「有更新」筛选。
const navView = computed(() => (activeTab.value === 'updates' ? 'subscriptions' : activeTab.value))
const subscriptionUpdateCount = computed(
  () => subscriptionUpdates.value.filter((item) => item.deviceUpdateState !== 'latest').length
)
const localInstanceCount = computed(
  () => buildSourceModpackLocalRecords(localInstances.value, {}).length
)
// 左栏「整合包」分组的数量和更新标记，交给模组中心渲染。
const navMeta = computed(() => ({
  local: { count: localInstanceCount.value },
  mine: { count: mineLoaded.value ? mineStats.value.all : null },
  subscriptions: {
    badge: subscriptionUpdateCount.value ? uiText('ui.valueUpdates', { value1: (subscriptionUpdateCount.value) }) : ''
  }
}))
const currentViewLabel = computed(() => getSourceModpackViewLabel(navView.value))
const requiresLogin = computed(() => !userStore.isLogin && navView.value !== 'local')
const isBrowseView = computed(() =>
  ['public', 'favorites', 'subscriptions'].includes(navView.value)
)
const showKeywordFilter = computed(() => activeTab.value !== 'updates')
const showPlatformFilter = computed(() =>
  ['public', 'favorites', 'subscriptions'].includes(activeTab.value)
)
const showSourceIdFilter = computed(() => ['public', 'favorites'].includes(activeTab.value))
const subscriptionSegmentOptions = computed(() => [
  { value: 'subscriptions', get label() { return uiText('tools.all') } },
  {
    value: 'updates',
    label: subscriptionUpdateCount.value ? uiText('ui.updatesAvailableValue', { value1: (subscriptionUpdateCount.value) }) : uiText('ui.updateAvailable')
  }
])
const localSegmentOptions = computed(() => [
  { value: 'all', label: uiText('ui.allValue', { value1: (localStats.value.all) }) },
  { value: 'update', label: uiText('ui.updatesAvailableValue', { value1: (localStats.value.update) }) },
  { value: 'attention', label: uiText('ui.needsAttentionValue', { value1: (localStats.value.attention) }) }
])
const mineSegmentOptions = computed(() => [
  { value: 'all', label: uiText('ui.allValue', { value1: (mineStats.value.all) }) },
  { value: 'public', label: uiText('ui.publicValue', { value1: (mineStats.value.public) }) },
  { value: 'code', label: uiText('ui.shareCodeOnlyValue', { value1: (mineStats.value.code) }) },
  { value: 'off', label: uiText('ui.unlistedValue', { value1: (mineStats.value.off) }) }
])
const filterChips = computed(() => {
  const chips = []
  const keyword = normalizeText(query.value.keyword)
  if (showKeywordFilter.value && keyword)
    chips.push({ key: 'keyword', label: uiText('ui.keywordValue', { value1: (keyword) }) })
  const sourceType = normalizeText(query.value.sourceType)
  if (showPlatformFilter.value && sourceType) {
    const option = platformOptions.find((item) => item.value === sourceType)
    chips.push({ key: 'sourceType', label: uiText('ui.platformValue', { value1: (option?.label || sourceType) }) })
  }
  const sourceGameId = normalizeText(query.value.sourceGameId)
  if (showSourceIdFilter.value && sourceGameId) {
    chips.push({ key: 'sourceGameId', label: uiText('ui.sourceIDValue', { value1: (sourceGameId) }) })
  }
  return chips
})
const hasActiveFilters = computed(
  () =>
    filterChips.value.length > 0 ||
    (navView.value === 'local' && localFilter.value !== 'all') ||
    (navView.value === 'mine' && mineFilter.value !== 'all')
)
const resultText = computed(() => {
  const unitMap = {
    local: '个本地整合包',
    mine: '个分享',
    subscriptions: activeTab.value === 'updates' ? '个待处理订阅' : '个订阅'
  }
  const text = uiText('ui.valueValueTotal', { value1: (formatCount(total.value)), value2: (unitMap[navView.value] || uiText('ui.modpacksVariant2')) })
  return totalPage.value > 1 ? uiText('ui.valuePageValueOfValue', { value1: (text), value2: (query.value.page), value3: (totalPage.value) }) : text
})
const pageNumbers = computed(() => {
  const count = totalPage.value
  const current = query.value.page
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const pages = new Set([1, count, current - 1, current, current + 1])
  const sorted = [...pages].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b)
  const result = []
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) result.push(`gap-${page}`)
    result.push(page)
  })
  return result
})
const emptyState = computed(() => {
  if (hasActiveFilters.value) {
    return {
      icon: 'search',
      get title() { return uiText('ui.noModpacksMatchTheCurrentFilters') },
      get text() { return uiText('ui.tryAnotherKeywordOrRemoveSomeFilters') },
      actions: [{ key: 'clear-filters', get label() { return uiText('tools.clearFilters') } }]
    }
  }
  const browse = userStore.isLogin ? [{ key: 'browse', get label() { return uiText('ui.browsePublicModpacks') }, ghost: true }] : []
  const map = {
    public: {
      icon: 'box',
      get title() { return uiText('ui.noPublicModpacksYet') },
      get text() { return uiText('ui.checkAgainLater') },
      actions: []
    },
    local: {
      icon: 'box',
      get title() { return uiText('ui.noModpacksHaveBeenImportedOnThisComputer') },
      get text() { return uiText('ui.importAShareCodeOrChooseAPublicModpackManage') },
      actions: [{ key: 'focus-code', get label() { return uiText('ui.enterShareCode') } }, ...browse]
    },
    mine: {
      icon: 'share',
      get title() { return uiText('ui.youHaveNotSharedAnyModpacksYet') },
      get text() { return uiText('ui.yourSharedModpacksWillAppearHere') },
      actions: []
    },
    favorites: {
      icon: 'star',
      get title() { return uiText('ui.noFavoriteModpacksYet') },
      get text() { return uiText('ui.clickFavoriteInAModpackPreviewToAddItHere') },
      actions: browse
    },
    subscriptions: {
      icon: 'bell',
      get title() { return uiText('ui.noSubscriptionsYet') },
      get text() { return uiText('ui.subscribeToBeNotifiedHereWhenAModpackHasA') },
      actions: browse
    },
    updates: {
      icon: 'check',
      get title() { return uiText('ui.subscribedModpacksAreUpToDate') },
      get text() { return uiText('ui.newRevisionsAndInstancesNeedingAttentionWillAppearHere') },
      actions: []
    }
  }
  return map[activeTab.value] || map.public
})
const menuEntries = computed(() =>
  menuState.value.pack ? getPackMenuEntries(menuState.value.pack) : []
)
// 模板里每条记录要用到的展示数据一次算好，避免同一行重复解析状态。
const recordViews = computed(() =>
  records.value.map((pack) => {
    const state = getCardStateView(pack)
    return {
      pack,
      key: getRecordKey(pack),
      state,
      revision: getPackRevisionView(pack),
      visibility: getPackVisibility(pack),
      action: getPackCardAction(pack),
      busy: !!state?.busy || isLocalInstanceBusy(pack),
      instanceLabel: getPackLocalInstanceLabel(pack)
    }
  })
)

// 页面内的线性图标（24 网格、描边），只在本页使用。
const ICON_PATHS = {
  compass: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'm15.5 8.5-2 5-5 2 2-5z'],
  monitor: [
    'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M8 20h8M12 16v4'
  ],
  share: [
    'M18 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M6 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M18 16.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'm8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4'
  ],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z'],
  bell: ['M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8', 'M10 20a2 2 0 0 0 4 0'],
  link: [
    'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1',
    'M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1'
  ],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-3.5-3.5'],
  close: ['M7 7l10 10M17 7 7 17'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  download: ['M12 4v11m0 0-4-4m4 4 4-4', 'M4 19h16'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  up: ['M12 19V5m0 0-6 6m6-6 6 6'],
  check: ['m5 12 4.5 4.5L19 7'],
  alert: ['M12 3 2.5 20h19z', 'M12 10v4M12 17h.01'],
  archive: [
    'M4 4h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M5 9v10h14V9M10 13h4'
  ],
  spin: ['M21 12a9 9 0 1 1-6.2-8.6'],
  globe: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'
  ],
  lock: [
    'M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
    'M8 11V8a4 4 0 0 1 8 0v3'
  ],
  copy: [
    'M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
    'M5 15V5a2 2 0 0 1 2-2h8'
  ],
  edit: ['M4 20h4L19 9l-4-4L4 16z'],
  refresh: [
    'M20 11a8 8 0 0 0-14.6-4.5L4 8',
    'M4 4v4h4',
    'M4 13a8 8 0 0 0 14.6 4.5L20 16',
    'M20 20v-4h-4'
  ],
  user: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M4 21a8 8 0 0 1 16 0'],
  box: ['M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z', 'M3 7.5 12 12l9-4.5M12 12v9'],
  arrowRight: ['M5 12h14m0 0-5-5m5 5-5 5'],
  chevronLeft: ['m15 18-6-6 6-6'],
  chevronRight: ['m9 18 6-6-6-6']
}

function SmpIcon(props) {
  const size = props.size || 16
  return h(
    'svg',
    {
      class: ['smp-icon', { 'is-spinning': props.name === 'spin' }],
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false'
    },
    (ICON_PATHS[props.name] || []).map((d) => h('path', { d }))
  )
}
SmpIcon.props = { name: String, size: [Number, String] }
const isMineTab = computed(() => activeTab.value === 'mine')
const isUpdatesTab = computed(() => activeTab.value === 'updates')
const isLocalTab = computed(() => activeTab.value === 'local')
const previewPack = computed(() => getSourceModpackDetailPack(preview.value.detail || {}))
const previewImportableItems = computed(() =>
  preview.value.items.filter((item) => item.canImport && preview.value.selectedKeys[item.previewKey])
)
const previewManualItems = computed(() =>
  preview.value.items.filter((item) => isNexusManualPreviewItem(item))
)
const previewPendingManualItems = computed(() =>
  previewManualItems.value.filter((item) => {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const status = normalizeText(metadata.manualDownloadStatus || item.status)
    return status !== 'ready_to_install'
  })
)
const previewFailedItems = computed(() =>
  preview.value.items.filter((item) => !item.canImport && !isNexusManualPreviewItem(item))
)
const canSubmitPreviewImport = computed(
  () => previewImportableItems.value.length > 0 && !preview.value.installing &&
    previewPendingManualItems.value.length === 0 &&
    !['latest', 'conflict'].includes(preview.value.inspection?.mode)
)
const canInstallPreviewAsNewCopy = computed(() => {
  const inspection = preview.value.inspection
  return (
    preview.value.intent !== 'install_new_copy' &&
    inspection?.local?.state &&
    inspection.local.state !== 'uninstalled' &&
    !preview.value.installing
  )
})

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function isNexusManualPreviewItem(item = {}) {
  const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  const source = normalizeSourceModpackPlatform(item.sourcePlatform || metadata.sourcePlatform)
  const status = normalizeText(metadata.manualDownloadStatus || item.status)
  return (
    source === 'nexus' &&
    (item.manualDownload === true ||
      metadata.manualDownload === true ||
      [
        'manual_pending',
        'waiting_browser_download',
        'nxm_captured',
        'resolving_download_link',
        'download_link_resolved',
        'waiting_local_file',
        'validating_local_file',
        'ready_to_install',
        'account_mismatch_suspected'
      ].includes(status))
  )
}

function getPackId(pack = {}) {
  return toSafeNumber(pack?.id, 0)
}

function getPackName(pack = {}) {
  return normalizeText(pack?.name) || '未命名整合包'
}

function getPackSourceType(pack = {}) {
  return normalizeText(pack?.sourceType || pack?.source_type)
}

function getPackSourceGameId(pack = {}) {
  return normalizeText(pack?.sourceGameId || pack?.source_game_id)
}

function getPackSourceGameSlug(pack = {}) {
  return normalizeText(pack?.sourceGameSlug || pack?.source_game_slug)
}

function getPackGameName(pack = {}) {
  return normalizeText(pack?.sourceGameName || pack?.source_game_name) || '未标记游戏'
}

function getPackShareCode(pack = {}) {
  return normalizeText(pack?.shareCode || pack?.share_code)
}

function getPackModNum(pack = {}) {
  return toSafeNumber(pack?.modNum || pack?.mod_num, 0)
}

function getPackLikeCount(pack = {}) {
  return toSafeNumber(pack?.likeCount || pack?.like_count, 0)
}

function getPackFavoriteCount(pack = {}) {
  return toSafeNumber(pack?.favoriteCount || pack?.favorite_count, 0)
}

function getPackSubscribeCount(pack = {}) {
  return toSafeNumber(pack?.subscribeCount || pack?.subscribe_count, 0)
}

function getPackUpdateInfo(pack = {}) {
  return pack?._subscriptionUpdate && typeof pack._subscriptionUpdate === 'object'
    ? pack._subscriptionUpdate
    : null
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1'
}

function isPackPublished(pack = {}) {
  return isTruthyFlag(pack?.isPublished ?? pack?.is_published)
}

function isPackPublicVisible(pack = {}) {
  return isTruthyFlag(pack?.isPublic ?? pack?.is_public) && isPackPublished(pack)
}

function formatCount(value) {
  return toSafeNumber(value, 0).toLocaleString()
}

// 今年的日期只显示「MM-DD」，用于卡片元信息，避免整行换行。
function formatShortDate(value) {
  const text = formatDate(value)
  const year = String(new Date().getFullYear())
  return text.startsWith(`${year}-`) ? text.slice(5) : text
}

function formatDate(value) {
  const text = normalizeText(value)
  if (!text) return '--'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

// 大于等于 1 万时显示「1.2 万」，与模组列表页一致。
function formatCompactCount(value) {
  const number = toSafeNumber(value, 0)
  if (number < 10000) return number.toLocaleString()
  const text = (number / 10000).toFixed(number >= 100000 ? 0 : 1).replace(/\.0$/, '')
  return uiText('ui.value10000', { value1: (text) })
}

function getPackUid(pack = {}) {
  return normalizeText(pack?.packUid || pack?.pack_uid)
}

function getPackRevision(pack = {}) {
  return toSafeNumber(pack?.currentRevision ?? pack?.current_revision, 0)
}

function getPackDescription(pack = {}) {
  return normalizeText(pack?.description) || '暂无说明'
}

function isActiveLocalInstance(instance = {}) {
  return !['detached', 'removed'].includes(normalizeText(instance?.state).toLowerCase())
}

// 本机状态来源：记录自带的更新信息 → 订阅更新列表 → 本机实例列表。
function getPackDeviceInfo(pack = {}) {
  const own = getPackUpdateInfo(pack)
  if (own) return own
  const packUid = getPackUid(pack)
  if (!packUid) return null
  const entry = subscriptionUpdates.value.find((item) => getPackUid(item.modpack || {}) === packUid)
  if (entry) return entry
  const instance = localInstances.value.find(
    (item) =>
      isActiveLocalInstance(item) &&
      normalizeText(item.remotePackUid || item.remote_pack_uid) === packUid
  )
  return instance ? { localInstance: instance, deviceUpdateState: 'installed' } : null
}

function getPackStateView(pack = {}) {
  const info = getPackDeviceInfo(pack)
  if (!info) return null
  const state = normalizeText(info.deviceUpdateState)
  const instanceState = normalizeText(info.localInstance?.state)
  const busyState = [instanceState, state].find((item) => BUSY_INSTANCE_STATES.includes(item))
  const map = {
    update: { tone: 'accent', icon: 'up', get text() { return uiText('ui.newRevisionAvailable') }, action: '查看更新' },
    latest: { tone: 'success', icon: 'check', get text() { return uiText('ui.upToDate') }, action: '预览' },
    installed: { tone: 'success', icon: 'check', get text() { return uiText('ui.installedOnThisComputer') }, action: '预览' },
    partial: {
      tone: 'danger',
      icon: 'alert',
      get text() { return uiText('ui.thePreviousUpdateDidNotComplete') },
      reason: normalizeText(info.localInstance?.lastErrorMessage) || uiText('ui.runPreflightAgainToContinue'),
      action: '重新预检'
    },
    repair_required: {
      tone: 'warning',
      icon: 'alert',
      get text() { return uiText('ui.localContentMissing') },
      reason: uiText('ui.someFilesWereRemovedOrChangedAndNeedRepair'),
      action: '预览修复'
    },
    conflict: {
      tone: 'danger',
      icon: 'alert',
      get text() { return uiText('ui.localChangesConflictWithTheRemoteVersion') },
      reason: uiText('ui.reviewTheUpdateAndChooseWhichChangesToKeep'),
      action: '查看更新'
    },
    orphaned: {
      tone: 'muted',
      icon: 'archive',
      get text() { return uiText('ui.theRemoteShareWasDeletedOrRemovedFromTheListing') },
      reason: uiText('ui.localContentIsUnchangedUnlinkItToContinueUsingIt'),
      action: '保留并解绑'
    },
    not_installed: { tone: 'muted', icon: '', get text() { return uiText('ui.notInstalledOnThisComputer') }, action: '预览导入' }
  }
  if (busyState) {
    // 进行中：按钮沿用底层状态的文案，但禁用。
    return {
      key: 'busy',
      tone: 'accent',
      icon: 'spin',
      text: BUSY_STATE_TEXT[busyState] || uiText('ui.operationInProgress'),
      reason: uiText('ui.viewProgressInTheTaskCenter'),
      action: map[state]?.action || '预览',
      busy: true
    }
  }
  const view = map[state]
  return view ? { key: state, reason: '', busy: false, ...view } : null
}

function getPackRevisionView(pack = {}) {
  const info = getPackDeviceInfo(pack)
  const instance = info?.localInstance
  const installed = toSafeNumber(
    info?.installedRevision || instance?.installedRevision || instance?.installed_revision,
    0
  )
  const current = toSafeNumber(info?.currentRevision, 0) || getPackRevision(pack)
  const next = info?.deviceUpdateState === 'update' && current > installed ? current : 0
  return { installed: installed || current, next }
}

function getPackVisibility(pack = {}) {
  if (!isPackPublished(pack)) {
    return { key: 'off', icon: 'archive', tone: 'muted', get text() { return uiText('ui.unlisted') }, desc: '新用户无法导入' }
  }
  if (isPackPublicVisible(pack)) {
    return {
      key: 'public',
      icon: 'globe',
      tone: 'success',
      get text() { return uiText('ui.public') },
      desc: '已上架，出现在公开列表'
    }
  }
  return {
    key: 'code',
    icon: 'link',
    tone: 'muted',
    get text() { return uiText('ui.shareCodeOnly') },
    desc: '持有分享码的人可导入'
  }
}

function getPackCardAction(pack = {}) {
  const view = getPackStateView(pack)
  if (view?.key === 'orphaned' && !getPackDeviceInfo(pack)?.localInstance) return ''
  if (view?.action) return view.action
  return getPackId(pack) ? '预览导入' : ''
}

function runPackPrimaryAction(pack = {}) {
  const view = getPackStateView(pack)
  if (view?.busy) return
  if (view?.key === 'orphaned' && getPackDeviceInfo(pack)?.localInstance) {
    detachLocalShareInstance(pack)
    return
  }
  const id = getPackId(pack)
  if (id) openPreviewById(id, pack)
}

function getRecordKey(pack = {}) {
  return (
    pack._subscriptionRecordKey ||
    getPackId(pack) ||
    getPackShareCode(pack) ||
    pack._localInstanceId
  )
}

function buildQueryParams() {
  const params = {
    page: query.value.page,
    size: query.value.size,
    keyword: normalizeText(query.value.keyword)
  }
  // 只提交当前视图可见的筛选条件，避免在别的视图设置的平台筛选悄悄生效。
  if (showPlatformFilter.value) params.sourceType = normalizeText(query.value.sourceType)
  if (showSourceIdFilter.value) params.sourceGameId = normalizeText(query.value.sourceGameId)
  return params
}

function requestSystemConfig() {
  return requestSystemConfigSettings({})
}

function parseInstallRuleJsonPayload(rawRuleJson) {
  if (rawRuleJson && typeof rawRuleJson === 'object' && !Array.isArray(rawRuleJson)) {
    return compileInstallRuleJson(rawRuleJson)
  }
  return compileInstallRuleJson(parseInstallRuleJsonText(rawRuleJson))
}

function normalizeNexusGameRulePayload(rawPayload = {}, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}
  const pack = fallback?.pack && typeof fallback.pack === 'object' ? fallback.pack : {}
  const nestedRule =
    source.rule && typeof source.rule === 'object'
      ? source.rule
      : source.latest && typeof source.latest === 'object'
        ? source.latest
        : source.data && typeof source.data === 'object'
          ? source.data
          : null
  const target = nestedRule || source
  const rawRuleJson =
    target.ruleJson ??
    target.rule_json ??
    source.ruleJson ??
    source.rule_json ??
    target.ruleJsonText ??
    target.rule_json_text ??
    source.ruleJsonText ??
    source.rule_json_text ??
    target.ruleBody ??
    target.rule_body ??
    target.content ??
    source.content ??
    target.config ??
    source.config ??
    (target.game_detect ||
    target.gameDetect ||
    target.install_rules ||
    target.installRules ||
    target.default_dependencies ||
    target.defaultDependencies
      ? target
      : {})
  let ruleJson = {}
  try {
    ruleJson = parseInstallRuleJsonPayload(rawRuleJson)
  } catch (error) {
    console.warn('解析 Nexus 游戏安装规则失败', error)
    ruleJson = {}
  }

  if (
    !Object.keys(ruleJson).length &&
    (target.game_detect ||
      target.gameDetect ||
      target.install_rules ||
      target.installRules ||
      target.default_dependencies ||
      target.defaultDependencies)
  ) {
    try {
      ruleJson = compileInstallRuleJson({
        game_detect: target.game_detect || target.gameDetect || {},
        install_rules: target.install_rules || target.installRules || [],
        default_dependencies: target.default_dependencies || target.defaultDependencies || []
      })
    } catch (error) {
      console.warn('编译 Nexus 游戏安装规则失败', error)
      ruleJson = {}
    }
  }

  return {
      ...target,
    nexusGameId: toSafeNumber(
      target.nexusGameId ||
        target.nexus_game_id ||
        source.nexusGameId ||
        source.nexus_game_id ||
        getPackSourceGameId(pack),
      0
    ),
    gameId: toSafeNumber(target.gameId || target.game_id || source.gameId || source.game_id, 0),
    steamAppId: toSafeNumber(
      target.appId ||
        target.app_id ||
        target.steamAppId ||
        target.steam_app_id ||
        target.steam_appid ||
        source.appId ||
        source.app_id ||
        source.steamAppId ||
        source.steam_app_id ||
        source.steam_appid,
      0
    ),
    ruleVersion: toSafeNumber(
      target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version,
      0
    ),
    gameName:
      normalizeText(
        target.gameName ||
          target.game_name ||
          target.name ||
          target.title ||
          source.gameName ||
          source.game_name ||
          source.name ||
          source.title
      ) ||
      getPackGameName(pack),
    coverImage: normalizeText(
      target.coverImage ||
        target.cover_image ||
        target.pictureUrl ||
        target.picture_url ||
        target.imageUrl ||
        target.image_url ||
        source.coverImage ||
        source.cover_image ||
        source.pictureUrl ||
        source.picture_url ||
        source.imageUrl ||
        source.image_url
    ),
    domainName:
      normalizeText(target.domainName || target.domain_name || source.domainName || source.domain_name) ||
      getPackSourceGameSlug(pack),
    sourceType: normalizeText(target.sourceType || target.source_type || source.sourceType || source.source_type),
    baseRuleVersion: toSafeNumber(target.baseRuleVersion || target.base_rule_version, 0),
    baseRuleJson: target.baseRuleJson || target.base_rule_json || null,
    dismissedRuleVersion: toSafeNumber(target.dismissedRuleVersion || target.dismissed_rule_version, 0),
    dismissedRuleJson: target.dismissedRuleJson || target.dismissed_rule_json || null,
    ruleJson
  }
}

function hasNexusRuleContent(rule = null) {
  return !!(
    rule &&
    rule.ruleJson &&
    typeof rule.ruleJson === 'object' &&
    Object.keys(rule.ruleJson).length
  )
}

async function loadLocalNexusRuleOverrideForPack(pack = {}) {
  const domainName = getPackSourceGameSlug(pack)
  const nexusGameId = toSafeNumber(getPackSourceGameId(pack), 0)
  if (!domainName && !nexusGameId) {
    return null
  }

  const localRule = await ipcRenderer.invoke('nexusGetGameRuleOverride', {
    domainName,
    nexusGameId
  })
  const rule = localRule ? normalizeNexusGameRulePayload(localRule, { pack }) : null
  return hasNexusRuleContent(rule) ? rule : null
}

function buildNexusInstallConfigMatchParamsForPack(pack = {}) {
  const nexusGameId = toSafeNumber(getPackSourceGameId(pack), 0)
  return {
    sourcePlatform: 'nexus',
    gameKey: nexusGameId > 0 ? `nexus:${nexusGameId}` : '',
    gameId: null,
    nexusGameId: nexusGameId || null,
    domainName: getPackSourceGameSlug(pack),
    appId: null
  }
}

function hasInstallConfigMatchIdentifier(params = {}) {
  return !!(
    normalizeText(params?.gameKey) ||
    normalizeText(params?.domainName) ||
    toSafeNumber(params?.nexusGameId, 0) > 0 ||
    toSafeNumber(params?.gameId, 0) > 0 ||
    toSafeNumber(params?.appId, 0) > 0
  )
}

async function loadMatchedNexusRuleForPack(pack = {}) {
  const params = buildNexusInstallConfigMatchParamsForPack(pack)
  if (!hasInstallConfigMatchIdentifier(params)) {
    return null
  }

  try {
    const response = await GET_SHARED_INSTALL_RULE(params)
    const ruleJsonText = normalizeText(response?.ruleJsonText)
    if (!ruleJsonText) {
      return null
    }

    const rule = normalizeNexusGameRulePayload(
      {
        ...(response || {}),
        ruleJsonText,
        sourceType: 'server'
      },
      { pack }
    )
    return hasNexusRuleContent(rule) ? rule : null
  } catch (error) {
    console.warn('统一安装配置匹配失败，公共规则当前不可用', error)
    return null
  }
}

async function loadCloudNexusRuleForPack(pack = {}) { return loadMatchedNexusRuleForPack(pack) }

async function loadNexusRuleForDetail(detail = {}) {
  const pack = getSourceModpackDetailPack(detail)
  const source = normalizeSourceModpackPlatform(getPackSourceType(pack))
  if (source !== 'nexus') {
    return null
  }

  const cacheKey = [source, getPackSourceGameId(pack), getPackSourceGameSlug(pack)].join(':')
  if (cacheKey === 'nexus::') {
    return null
  }

  if (!nexusRuleRequestCache.has(cacheKey)) {
    nexusRuleRequestCache.set(
      cacheKey,
      (async () => {
        const localRule = await loadLocalNexusRuleOverrideForPack(pack)
        if (localRule) {
          return localRule
        }
        return await loadCloudNexusRuleForPack(pack)
      })().catch((error) => {
        console.warn('读取 Nexus 游戏安装规则失败', error)
        return null
      })
    )
  }

  return await nexusRuleRequestCache.get(cacheKey)
}

async function getSourceResolverOptions(detail = {}) {
  if (!resolverOptionsPromise) {
    resolverOptionsPromise = requestSystemConfig()
      .then((config) => applyEffectiveNexusApiConfig(config || {}))
      .then((config) => ({
        systemConfig: config || {},
        nexusApiConfig: config?.nexusApi || {}
      }))
      .catch((error) => {
        console.warn('读取外部来源解析配置失败', error)
        return {}
      })
  }
  const baseOptions = await resolverOptionsPromise
  const currentNexusRule = await loadNexusRuleForDetail(detail)
  return {
    ...baseOptions,
    currentNexusRule
  }
}

function getLocalRecordFilterKey(pack = {}) {
  const state = normalizeText(getPackUpdateInfo(pack)?.deviceUpdateState)
  if (state === 'update') return 'update'
  if (ATTENTION_STATES.includes(state)) return 'attention'
  return ''
}

// 本地记录只知道实例自身状态；若订阅更新里有同一实例的新修订，把远程修订信息合并进来。
function mergeLocalRecordUpdate(pack = {}) {
  const instanceId = normalizeText(pack._localInstanceId)
  const entry = subscriptionUpdates.value.find(
    (item) =>
      item.deviceUpdateState === 'update' &&
      normalizeText(item.localInstance?.instanceId || item.localInstance?.instance_id) === instanceId
  )
  if (!instanceId || !entry) return pack
  return {
    ...pack,
    _subscriptionUpdate: {
      ...pack._subscriptionUpdate,
      deviceUpdateState: 'update',
      currentRevision: entry.currentRevision,
      installedRevision: entry.installedRevision
    }
  }
}

async function loadAllMinePacks(params = {}) {
  const result = []
  for (let page = 1; ; page++) {
    const response = normalizeSourceModpackPage(
      await GET_MY_SOURCE_MODPACK_LIST({ ...params, page, size: 50 })
    )
    result.push(...response.records)
    if (!response.records.length || result.length >= response.total) return result
  }
}

async function loadList(options = {}) {
  closeMenu()
  if (!userStore.isLogin && activeTab.value !== 'local') {
    listRequestSerial++
    records.value = []
    total.value = 0
    loading.value = false
    return
  }
  const silent = options?.silent === true
  const serial = ++listRequestSerial
  if (!silent) {
    loading.value = true
  }
  try {
    if (isLocalTab.value) {
      const result = await ipcRenderer.invoke('source-modpack-instance:list', {})
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotLoadLocalModpacks'))
      if (serial !== listRequestSerial) return
      localInstances.value = Array.isArray(result.data) ? result.data : []
      const local = buildSourceModpackLocalRecords(localInstances.value, {
        keyword: query.value.keyword
      }).map(mergeLocalRecordUpdate)
      localStats.value = {
        all: local.length,
        update: local.filter((pack) => getLocalRecordFilterKey(pack) === 'update').length,
        attention: local.filter((pack) => getLocalRecordFilterKey(pack) === 'attention').length
      }
      const filtered =
        localFilter.value === 'all'
          ? local
          : local.filter((pack) => getLocalRecordFilterKey(pack) === localFilter.value)
      total.value = filtered.length
      const start = (query.value.page - 1) * query.value.size
      records.value = filtered.slice(start, start + query.value.size)
      return
    }
    if (isMineTab.value) {
      // 我的分享数量通常不大，一次取全，可见性筛选和计数才准确。
      const all = await loadAllMinePacks(buildQueryParams())
      if (serial !== listRequestSerial) return
      mineStats.value = {
        all: all.length,
        public: all.filter((pack) => getPackVisibility(pack).key === 'public').length,
        code: all.filter((pack) => getPackVisibility(pack).key === 'code').length,
        off: all.filter((pack) => getPackVisibility(pack).key === 'off').length,
        imports: all.reduce(
          (sum, pack) => sum + toSafeNumber(pack.importCount || pack.import_count, 0),
          0
        )
      }
      mineLoaded.value = true
      const filtered =
        mineFilter.value === 'all'
          ? all
          : all.filter((pack) => getPackVisibility(pack).key === mineFilter.value)
      total.value = filtered.length
      const start = (query.value.page - 1) * query.value.size
      records.value = filtered.slice(start, start + query.value.size)
      return
    }
    if (isUpdatesTab.value) {
      const updates = await loadSubscriptionUpdates()
      if (serial !== listRequestSerial) {
        return
      }
      const start = (query.value.page - 1) * query.value.size
      const pageRecords = updates.slice(start, start + query.value.size).map((item) => ({
        ...(item.modpack || {}),
        _subscriptionUpdate: item,
        _subscriptionRecordKey: item.recordKey
      }))
      records.value = pageRecords
      total.value = updates.length
      return
    }

    const loaderMap = {
      public: GET_SOURCE_MODPACK_LIST,
      mine: GET_MY_SOURCE_MODPACK_LIST,
      favorites: GET_MY_SOURCE_MODPACK_FAVORITES,
      subscriptions: GET_MY_SOURCE_MODPACK_SUBSCRIPTIONS
    }
    const loader = loaderMap[activeTab.value] || GET_SOURCE_MODPACK_LIST
    const data = normalizeSourceModpackPage(await loader(buildQueryParams()))
    if (serial !== listRequestSerial) {
      return
    }
    records.value = data.records
    total.value = data.total
  } catch (error) {
    if (serial === listRequestSerial && !silent) {
      console.error('加载外部来源整合包列表失败', error)
      $message.error(uiMessage('ui.couldNotLoadListValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
    }
  } finally {
    // 最新的一次请求负责结束加载态；静默刷新覆盖了普通加载时也要结束，否则骨架会一直显示。
    if (serial === listRequestSerial) {
      loading.value = false
    }
  }
}

async function loadSubscriptionUpdates() {
  if (!userStore.isLogin) { subscriptionUpdates.value = []; return [] }
  const serial = ++subscriptionRequestSerial
  try {
    const loadSubscriptions = async () => {
      const result = []
      for (let page = 1; ; page++) {
        const response = normalizeSourceModpackPage(await GET_MY_SOURCE_MODPACK_SUBSCRIPTIONS({ page, size: 50 }))
        result.push(...response.records)
        if (!response.records.length || result.length >= response.total) return result
      }
    }
    const [updates, subscriptionsResponse, instanceResult] = await Promise.all([
      GET_SOURCE_MODPACK_SUBSCRIPTION_UPDATES(),
      loadSubscriptions(),
      ipcRenderer.invoke('source-modpack-instance:list', {})
    ])
    if (serial !== subscriptionRequestSerial) return subscriptionUpdates.value
    if (!instanceResult?.success) throw new Error(instanceResult?.message || uiText('ui.couldNotLoadLocalModpackInstances'))
    const instances = Array.isArray(instanceResult?.data) ? instanceResult.data : []
    localInstances.value = instances
    subscriptionUpdates.value = buildSourceModpackSubscriptionUpdates({
      updates,
      subscriptions: subscriptionsResponse,
      instances
    })
  } catch (error) {
    console.warn('读取外部来源整合包订阅更新失败', error)
    // 暂时请求失败时保留上次结果，避免把正在更新的实例显示为没有更新。
  }
  return subscriptionUpdates.value
}

// 未登录时也允许切换，内容区显示登录说明，而不是静默不加载。
function changeTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  query.value.page = 1
  loadList()
}

function changeLocalFilter(value) {
  localFilter.value = value
  searchList()
}

function changeMineFilter(value) {
  mineFilter.value = value
  searchList()
}

function searchList() {
  query.value.page = 1
  loadList()
}

function clearKeyword() {
  if (!query.value.keyword) return
  query.value.keyword = ''
  searchList()
}

function removeFilterChip(key) {
  if (!(key in query.value)) return
  query.value[key] = ''
  searchList()
}

function resetFilters() {
  query.value = {
    page: 1,
    size: query.value.size,
    keyword: '',
    sourceType: '',
    sourceGameId: ''
  }
  localFilter.value = 'all'
  mineFilter.value = 'all'
  loadList()
}

function changePage(offset) {
  goToPage(query.value.page + offset)
}

function goToPage(page) {
  const nextPage = Math.min(Math.max(Number(page) || 1, 1), totalPage.value)
  if (nextPage === query.value.page) return
  query.value.page = nextPage
  loadList()
}

function openLogin() {
  userLoginRef.value?.open?.()
}

function focusCodeInput() {
  codeInputRef.value?.focus?.()
}

function handleCodeInput() {
  if (codeError.value) codeError.value = ''
}

function handleEmptyAction(key) {
  if (key === 'clear-filters') resetFilters()
  else if (key === 'focus-code') focusCodeInput()
  else if (key === 'browse') changeTab('public')
}

// 订阅视图里没有本机记录的整合包，明确显示「本机未安装」。
function getCardStateView(pack = {}) {
  const view = getPackStateView(pack)
  if (view || navView.value !== 'subscriptions') return view
  return {
    key: 'not_installed',
    tone: 'muted',
    icon: '',
    get text() { return uiText('ui.notInstalledOnThisComputer') },
    reason: '',
    busy: false
  }
}

function getPackMenuEntries(pack = {}) {
  const id = getPackId(pack)
  const shareCode = getPackShareCode(pack)
  const instance = getPackDeviceInfo(pack)?.localInstance
  const busy = isLocalInstanceBusy(pack)
  const entries = []
  if (navView.value === 'mine') {
    const published = isPackPublished(pack)
    entries.push(
      { key: 'preview', get label() { return uiText('tools.preview2') }, disabled: !id },
      { key: 'copy', get label() { return uiText('ui.copyShareCode') }, disabled: !shareCode },
      { key: 'publish', label: published ? uiText('ui.unlist') : uiText('ui.publishListing') },
      { key: 'sep-danger', separator: true },
      { key: 'delete', get label() { return uiText('ui.deleteShare') }, danger: true }
    )
    return entries
  }
  if (navView.value === 'local') {
    entries.push(
      { key: 'copy', get label() { return uiText('ui.copyShareCode') }, disabled: !shareCode },
      { key: 'preview', get label() { return uiText('ui.viewRemoteShare') }, disabled: !id || busy }
    )
  } else {
    entries.push(
      { key: 'preview', get label() { return uiText('ui.previewDetails') }, disabled: !id },
      { key: 'copy', get label() { return uiText('ui.copyShareCode') }, disabled: !shareCode }
    )
    if (instance && navView.value === 'subscriptions') {
      entries.push({ key: 'go-local', get label() { return uiText('ui.viewInLocalModpacks') } })
    }
  }
  if (instance && (navView.value === 'local' || navView.value === 'subscriptions')) {
    entries.push(
      { key: 'sep-danger', separator: true },
      { key: 'detach', get label() { return uiText('ui.keepModsAndUnlink') }, disabled: busy },
      { key: 'remove', get label() { return uiText('ui.uninstallInstanceMods') }, danger: true, disabled: busy }
    )
  }
  return entries
}

function positionMenu(trigger) {
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const padding = 12
  const width = 200
  const height = menuRef.value?.scrollHeight || 200
  const below = window.innerHeight - rect.bottom - padding - 4
  const upwards = below < height && rect.top > below
  menuState.value = {
    ...menuState.value,
    style: {
      left: `${Math.max(padding, Math.min(rect.right - width, window.innerWidth - width - padding))}px`,
      top: `${upwards ? Math.max(padding, rect.top - height - 4) : rect.bottom + 4}px`,
      width: `${width}px`
    }
  }
}

async function openMenu(pack, event) {
  if (menuState.value.pack === pack) {
    closeMenu(true)
    return
  }
  menuTrigger = event?.currentTarget || null
  menuState.value = { pack, style: {} }
  positionMenu(menuTrigger)
  await nextTick()
  positionMenu(menuTrigger)
  menuRef.value?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
}

function closeMenu(restoreFocus = false) {
  if (!menuState.value.pack) return
  menuState.value = { pack: null, style: {} }
  if (restoreFocus === true) menuTrigger?.focus?.()
  menuTrigger = null
}

function handleMenuEntry(entry = {}) {
  const pack = menuState.value.pack
  if (!pack || entry.disabled || entry.separator) return
  closeMenu(true)
  if (entry.key === 'preview') openPreviewById(getPackId(pack), pack)
  else if (entry.key === 'copy') copyShareCode(getPackShareCode(pack))
  else if (entry.key === 'publish') updatePublish(pack, !isPackPublished(pack))
  else if (entry.key === 'delete') deletePack(pack)
  else if (entry.key === 'detach') detachLocalShareInstance(pack)
  else if (entry.key === 'remove') removeLocalShareInstance(pack)
  else if (entry.key === 'go-local') changeTab('local')
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'Tab') {
    closeMenu(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const entries = [...(menuRef.value?.querySelectorAll('button:not(:disabled)') || [])]
    if (!entries.length) return
    const index = entries.indexOf(document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
    entries[next].focus()
  }
}

function handleOutsidePointer(event) {
  if (!menuState.value.pack) return
  if (menuRef.value?.contains(event.target) || menuTrigger?.contains?.(event.target)) return
  closeMenu()
}

function handleViewportChange() {
  if (menuState.value.pack) closeMenu()
}

async function refreshLocalInstances() {
  try {
    const result = await ipcRenderer.invoke('source-modpack-instance:list', {})
    if (result?.success) localInstances.value = Array.isArray(result.data) ? result.data : []
  } catch (error) {
    console.warn('读取本地整合包实例失败', error)
  }
}

async function checkLocalUpdates() {
  await loadSubscriptionUpdates()
  await loadList({ silent: true })
}

async function applyPreviewDetail(detail, options = {}) {
  const manualResolvedItems = Array.isArray(options.manualResolvedItems)
    ? options.manualResolvedItems
    : []
  const intent = normalizeText(options.intent || 'auto') || 'auto'
  const targetOverrides =
    options.targetOverrides && typeof options.targetOverrides === 'object'
      ? options.targetOverrides
      : {}
  manualDownloadOpen.value = false
  const resolverOptions = await getSourceResolverOptions(detail)
  previewResolverOptions.value = resolverOptions
  const pack = getSourceModpackDetailPack(detail)
  const source = getPackSourceType(pack)
  const inspection = await inspectShareImport({
    shareCode: getPackShareCode(pack),
    entryPoint: 'external',
    intent,
    targetContext: {
      sourcePlatform: source,
      sourceGameId: getPackSourceGameId(pack),
      sourceGameSlug: getPackSourceGameSlug(pack),
      endpointType: 0,
      currentNexusRule: resolverOptions.currentNexusRule,
      nexusApiConfig: resolverOptions.nexusApiConfig,
      systemConfig: resolverOptions.systemConfig,
      installRule: resolverOptions.currentNexusRule?.ruleJson || {},
      manualResolvedItems,
      ...targetOverrides
    }
  })
  if (inspection.mode === 'latest') {
    $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
  }
  if (inspection.mode === 'conflict') {
    $message.warning(uiMessage('ui.theRemoteVersionConflictsWithLocalChangesNoInstallationTask'))
  }
  const manualActionMap = new Map(
    (inspection.manualActions || []).map((item) => [normalizeText(item.itemKey), item])
  )
  const items = (inspection.canonicalPlan?.items || []).map((item, index) => {
    const manualAction = manualActionMap.get(normalizeText(item.itemKey))
    return {
      ...item,
      ...(manualAction || {}),
      itemKey: item.itemKey,
      previewKey: `${item.itemKey}:${item.dependencyRole}:${index}`,
      sourcePlatformLabel: getSourceModpackPlatformLabel(item.sourcePlatform),
      status: manualAction ? 'manual_pending' : 'success',
      reason: manualAction ? manualAction.reason : uiText('ui.aNormalizedInstallationPlanHasBeenCreated'),
      canImport: !manualAction,
      downloadUrl: manualAction ? '' : item.download?.url || ''
    }
  })
  const selectedKeys = {}
  items.forEach((item) => {
    if (item.canImport) {
      selectedKeys[item.previewKey] = true
    }
  })
  preview.value = {
    open: true,
    loading: false,
    installing: false,
    detail,
    items,
    selectedKeys,
    inspection,
    intent
  }
  const subscribed = detail?.subscribed === true || detail?.modpack?.subscribed === true
  if (subscribed && inspection.remote?.packUid) {
    await MARK_SOURCE_MODPACK_SUBSCRIPTION_SEEN(
      inspection.remote.packUid,
      inspection.remote.revision
    ).catch((error) => {
      console.warn('标记整合包订阅修订已查看失败', error)
    })
    await loadSubscriptionUpdates()
  }
}

async function inspectPreviewAsNewCopy() {
  if (!canInstallPreviewAsNewCopy.value) return
  preview.value.loading = true
  try {
    await applyPreviewDetail(preview.value.detail, { intent: 'install_new_copy' })
    $message.success(uiMessage('ui.switchedToInstallingANewCopyInASeparateProfile'))
  } catch (error) {
    preview.value.loading = false
    console.error('生成整合包新副本计划失败', error)
    $message.error(uiMessage('ui.couldNotCreateAPlanForANewCopyValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
  }
}

function openTargetPicker(error = {}, detail = null) {
  const candidates = Array.isArray(error?.detail?.candidates) ? error.detail.candidates : []
  if (normalizeText(error?.code) !== 'target_game_ambiguous' || !candidates.length) return false
  targetPicker.value = {
    open: true,
    detail,
    candidates,
    loadingId: 0
  }
  return true
}

async function selectPreviewTarget(candidate = {}) {
  const localGameInstallationId = toSafeNumber(candidate.id, 0)
  if (!localGameInstallationId || targetPicker.value.loadingId) return
  targetPicker.value.loadingId = localGameInstallationId
  try {
    await applyPreviewDetail(targetPicker.value.detail, {
      targetOverrides: {
        localGameInstallationId,
        gameRoot: normalizeText(candidate.gameRoot)
      }
    })
    targetPicker.value = { open: false, detail: null, candidates: [], loadingId: 0 }
  } catch (error) {
    targetPicker.value.loadingId = 0
    console.error('选择整合包目标游戏失败', error)
    $message.error(uiMessage('ui.couldNotSelectTargetValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
  }
}

function closeTargetPicker() {
  if (targetPicker.value.loadingId) return
  targetPicker.value = { open: false, detail: null, candidates: [], loadingId: 0 }
  closePreview()
}

function patchPackById(id, patch = {}) {
  const safeId = getPackId({ id })
  if (!safeId) return
  records.value = records.value.map((pack) => {
    if (getPackId(pack) !== safeId) return pack
    return {
      ...pack,
      ...patch
    }
  })
}

function removePackFromList(id) {
  const safeId = getPackId({ id })
  if (!safeId) return
  const nextRecords = records.value.filter((pack) => getPackId(pack) !== safeId)
  if (nextRecords.length === records.value.length) return
  records.value = nextRecords
  total.value = Math.max(0, total.value - 1)
  if (!nextRecords.length && query.value.page > 1) {
    query.value.page -= 1
  }
}

function applyInteractionResult(result = {}) {
  const pack = previewPack.value
  const id = getPackId(pack)
  if (!id) return

  const nextPatch = {
    liked: result.liked === true,
    favorited: result.favorited === true,
    subscribed: result.subscribed === true,
    likeCount: toSafeNumber(result.likeCount ?? result.like_count ?? getPackLikeCount(pack), 0),
    favoriteCount: toSafeNumber(result.favoriteCount ?? result.favorite_count ?? getPackFavoriteCount(pack), 0),
    subscribeCount: toSafeNumber(result.subscribeCount ?? result.subscribe_count ?? getPackSubscribeCount(pack), 0)
  }
  Object.assign(pack, nextPatch)
  if (preview.value.detail && typeof preview.value.detail === 'object') {
    preview.value.detail = {
      ...preview.value.detail,
      liked: nextPatch.liked,
      favorited: nextPatch.favorited,
      subscribed: nextPatch.subscribed
    }
  }
  patchPackById(id, nextPatch)
}

async function toggleInteraction(type) {
  if (!requireCloudAccount()) return
  const pack = previewPack.value
  const id = getPackId(pack)
  if (!id || !isPackPublicVisible(pack)) return
  const actionMap = {
    like: TOGGLE_SOURCE_MODPACK_LIKE,
    favorite: TOGGLE_SOURCE_MODPACK_FAVORITE,
    subscribe: TOGGLE_SOURCE_MODPACK_SUBSCRIBE
  }
  const action = actionMap[type]
  if (!action) return
  try {
    const result = await action(id)
    applyInteractionResult(result || {})
    if (type === 'subscribe') {
      await loadSubscriptionUpdates()
    }
  } catch (error) {
    console.error('切换外部来源整合包互动状态失败', error)
    $message.error(uiMessage('ui.operationFailedValue', { value1: (normalizeText(error?.message) || uiText('ui.makeSureYouAreSignedIn')) }))
  }
}

async function openPreviewById(id, pack = {}) {
  if (!requireCloudAccount()) return
  const safeId = getPackId({ id })
  if (!safeId) return
  preview.value = {
    ...preview.value,
    open: true,
    loading: true,
    detail: null,
    items: [],
    selectedKeys: {},
    inspection: null,
    intent: 'auto'
  }
  try {
    const detail = pack._localInstanceId
      ? await GET_SOURCE_MODPACK_BY_CODE(getPackShareCode(pack))
      : await GET_SOURCE_MODPACK_INFO(safeId)
    preview.value.detail = detail
    await applyPreviewDetail(detail, {
      targetOverrides: buildSourceModpackInstanceTargetOverrides(
        getPackUpdateInfo(pack)?.localInstance
      )
    })
  } catch (error) {
    if (openTargetPicker(error, preview.value.detail)) return
    if (pack._localInstanceId && /^(share_removed|share_unpublished)/.test(normalizeText(error?.message))) {
      await ipcRenderer.invoke('source-modpack-instance:orphan', {
        remotePackUid: pack.packUid, reasonCode: normalizeText(error.message).split(':')[0], message: error.message
      })
      await loadList()
    }
    closePreview()
    console.error('读取外部来源整合包详情失败', error)
    $message.error(uiMessage('ui.couldNotReadDetailsValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
  }
}

async function openPreviewByCode() {
  if (!requireCloudAccount()) return
  const code = normalizeText(codeInput.value)
  if (!code) {
    codeError.value = '请输入分享码'
    focusCodeInput()
    return
  }
  codeError.value = ''
  preview.value = {
    ...preview.value,
    open: true,
    loading: true,
    detail: null,
    items: [],
    selectedKeys: {},
    intent: 'auto'
  }
  try {
    const detail = await GET_SOURCE_MODPACK_BY_CODE(code)
    preview.value.detail = detail
    await applyPreviewDetail(detail)
  } catch (error) {
    if (openTargetPicker(error, preview.value.detail)) return
    const reasonCode = ['share_removed', 'share_unpublished'].find((item) =>
      normalizeText(error?.message).startsWith(item)
    )
    if (reasonCode) {
      await ipcRenderer.invoke('source-modpack-instance:orphan', {
        shareCode: code,
        reasonCode,
        message: normalizeText(error?.message)
      })
      await loadSubscriptionUpdates()
      if (isUpdatesTab.value) await loadList({ silent: true })
    }
    closePreview()
    console.error('读取分享码失败', error)
    // 错误就地显示在分享码输入框下方，不只弹 toast。
    const reasonText = {
      share_removed: '分享码对应的整合包已被作者删除',
      share_unpublished: '该整合包已下架，暂时无法导入'
    }
    codeError.value =
      reasonText[reasonCode] || uiText('ui.couldNotReadShareCodeValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) })
  }
}

function closePreview() {
  if (preview.value.installing) return
  manualDownloadOpen.value = false
  previewResolverOptions.value = {}
  preview.value = {
    open: false,
    loading: false,
    installing: false,
    detail: null,
    items: [],
    selectedKeys: {},
    inspection: null,
    intent: 'auto'
  }
}

async function confirmPreviewImport() {
  if (preview.value.installing) return
  if (!canSubmitPreviewImport.value) {
    $message.warning(uiMessage('ui.noEntriesAvailableForInstallationTasks'))
    return
  }
  preview.value.installing = true
  try {
    const inspection = preview.value.inspection
    for (const target of inspection?.profileTargets || []) {
      ensureSourceProfile(target.sourcePlatform, target.sourceGameId || target.sourcePlatform, target.profileName)
    }
    const result = await applyShareImport({
      planToken: inspection?.planToken,
      expectedPlanHash: inspection?.planHash
    })
    await loadSubscriptionUpdates()
    $message.success(result.message || '已加入安装任务')
    preview.value.installing = false
    closePreview()
  } catch (error) {
    console.error('创建外部来源整合包安装任务失败', error)
    $message.error(uiMessage('ui.couldNotCreateInstallationTaskValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
  } finally {
    if (preview.value.open) {
      preview.value.installing = false
    }
  }
}

function handleSourceInstallTaskUpdated() {
  if (sourceInstallTaskRefreshTimer) {
    clearTimeout(sourceInstallTaskRefreshTimer)
  }
  sourceInstallTaskRefreshTimer = setTimeout(() => {
    sourceInstallTaskRefreshTimer = null
    if (isUpdatesTab.value || isLocalTab.value) {
      loadList({ silent: true })
      return
    }
    loadSubscriptionUpdates()
  }, 350)
}

function getPackLocalInstanceLabel(pack = {}) {
  const instance = getPackUpdateInfo(pack)?.localInstance
  if (!instance) return ''
  const target = Array.isArray(instance.targets) ? instance.targets[0] : null
  const parts = []
  const profileName = normalizeText(target?.profileName || target?.profile_name)
  if (profileName) parts.push(profileName)
  const localGameInstallationId = toSafeNumber(
    instance.localGameInstallationId || instance.local_game_installation_id,
    0
  )
  if (localGameInstallationId) parts.push(uiText('ui.gameValueVariant2', { value1: (localGameInstallationId) }))
  const instanceSlot = normalizeText(instance.instanceSlot || instance.instance_slot)
  if (instanceSlot && instanceSlot !== 'default') parts.push(instanceSlot)
  return parts.join(' · ')
}

function isLocalInstanceBusy(pack = {}) {
  return BUSY_INSTANCE_STATES.includes(getPackDeviceInfo(pack)?.localInstance?.state)
}

async function detachLocalShareInstance(pack = {}) {
  const instanceId = getPackDeviceInfo(pack)?.localInstance?.instanceId
  if (!instanceId) return
  Modal.confirm({
    get title() { return uiText('ui.keepModsAndUnlinkVariant2') },
    content: '本地模组和配置不会被删除，之后不再随该远程分享更新。',
    get okText() { return uiText('ui.unlink') },
    get cancelText() { return uiText('ui.cancel') },
    onOk: async () => {
      const result = await ipcRenderer.invoke('source-modpack-instance:detach', { instanceId })
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotUnlink'))
      $message.success(result.message)
      await loadList()
    }
  })
}

async function removeLocalShareInstance(pack = {}) {
  const instanceId = getPackDeviceInfo(pack)?.localInstance?.instanceId
  if (!instanceId) return
  Modal.confirm({
    get title() { return uiText('ui.uninstallTheModsManagedByThisInstance') },
    content: '只会卸载该实例独占管理且通过安全预检的模组；用户模组和共享模组会保留。',
    get okText() { return uiText('ui.uninstallSafely') },
    okType: 'danger',
    get cancelText() { return uiText('ui.cancel') },
    onOk: async () => {
      const result = await ipcRenderer.invoke('source-modpack-instance:remove', { instanceId })
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotUninstallInstance'))
      $message.success(result.message)
      await loadList()
    }
  })
}

function isSourceModpackEditorOpening(pack = {}) {
  const id = getPackId(pack)
  return !!id && sourceModpackEditor.value.loadingId === String(id)
}

async function openSourceModpackEditor(pack = {}) {
  if (!requireCloudAccount()) return
  if (!isMineTab.value || sourceModpackEditor.value.loadingId || sourceModpackEditor.value.saving) {
    return
  }
  const id = getPackId(pack)
  if (!id) return

  sourceModpackEditor.value.loadingId = String(id)
  try {
    const detail = await GET_SOURCE_MODPACK_INFO(id)
    if (!isMineTab.value) return
    const detailPack = getSourceModpackDetailPack(detail)
    const detailId = getPackId(detailPack)
    const draft = normalizeSourceModpackEditorDraft(detail)
    if (!detailId || String(detailId) !== String(id) || !draft.items.length) {
      throw new Error(uiText('ui.theDetailsContainNoValidEditableModEntries'))
    }
    sourceModpackEditor.value.detail = detail
    sourceModpackEditor.value.open = true
  } catch (error) {
    console.error('读取外部来源整合包编辑详情失败', error)
    $message.error(uiMessage('ui.couldNotOpenEditorValue', { value1: (normalizeText(error?.message) || uiText('ui.couldNotLoadFullDetails')) }))
  } finally {
    sourceModpackEditor.value.loadingId = ''
  }
}

function closeSourceModpackEditor() {
  if (sourceModpackEditor.value.saving) return
  sourceModpackEditor.value.open = false
  sourceModpackEditor.value.detail = null
}

function handleSourceModpackEditorVisibleChange(visible) {
  if (!visible) {
    closeSourceModpackEditor()
  }
}

async function saveSourceModpackEdit(payload) {
  if (!requireCloudAccount()) return
  if (sourceModpackEditor.value.saving || !sourceModpackEditor.value.open) return
  const detailPack = getSourceModpackDetailPack(sourceModpackEditor.value.detail || {})
  const id = getPackId(detailPack)
  if (!id) {
    $message.error(uiMessage('ui.saveFailedInvalidModpackID'))
    return
  }

  sourceModpackEditor.value.saving = true
  let saved = false
  try {
    await UPDATE_SOURCE_MODPACK(id, payload)
    saved = true
    $message.success(uiMessage('ui.modpackUpdated'))
  } catch (error) {
    console.error('更新外部来源整合包失败', error)
    $message.error(uiMessage('ui.saveFailedValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
  } finally {
    sourceModpackEditor.value.saving = false
  }

  if (saved) {
    closeSourceModpackEditor()
    await loadList()
  }
}

function updatePublish(pack = {}, publish = true) {
  if (!requireCloudAccount()) return
  const id = getPackId(pack)
  if (!id) return
  
  Modal.confirm({
    title: publish ? uiText('ui.confirmListing') : uiText('ui.confirmUnlisting'),
    content: publish ? '上架后，其他用户将可以在公开列表中查看该整合包。' : '下架后，该内容将不再公开展示。',
    okText: publish ? uiText('ui.listPublicly') : uiText('ui.unlistVariant2'),
    get cancelText() { return uiText('ui.cancel') },
    onOk: () => {
      UPDATE_SOURCE_MODPACK_PUBLISH(id, publish)
        .then(() => {
          $message.success(publish ? '已上架' : '已下架')
          loadList()
        })
        .catch((error) => {
          console.error('更新外部来源整合包状态失败', error)
          $message.error(uiMessage('ui.couldNotUpdateStatusValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
        })
    }
  })
}

function deletePack(pack = {}) {
  if (!requireCloudAccount()) return
  const id = getPackId(pack)
  if (!id) return
  Modal.confirm({
    get title() { return uiText('ui.deleteThisShare') },
    content: uiText('ui.deletingValueCannotBeUndoneItsShareCodeWillStop', { value1: (getPackName(pack)) }),
    get okText() { return uiText('ui.confirmDeletion') },
    get cancelText() { return uiText('ui.cancel') },
    okType: 'danger',
    onOk: async () => {
      try {
        await DELETE_SOURCE_MODPACK(id)
        removePackFromList(id)
        if (getPackId(previewPack.value) === id) {
          closePreview()
        }
        $message.success(uiMessage('ui.deleted'))
        setTimeout(() => {
          loadList({ silent: true })
        }, 0)
      } catch (error) {
        console.error('删除外部来源整合包失败', error)
        $message.error(uiMessage('ui.deletionFailedValue', { value1: (normalizeText(error?.message) || uiText('tools.unknownError')) }))
        throw error
      }
    }
  })
}

async function copyShareCode(code) {
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    $message.success(uiMessage('ui.shareCodeCopiedVariant2'))
  } catch (error) {
    console.error('复制分享码失败', error)
    $message.error(uiMessage('ui.copyingFailedSelectTheShareCodeAndCopyItManually'))
  }
}

function previewInitialCode(value) {
  const code = normalizeText(value)
  if (!code || !userStore.isLogin) return
  codeInput.value = code
  openPreviewByCode()
}

// 父组件切换左栏分类 → 面板切换视图；面板内部切换（登录说明、空状态按钮、退出登录）→ 通知父组件。
watch(
  () => props.view,
  (view) => {
    if (isSourceModpackView(view) && view !== navView.value) changeTab(view)
  }
)
watch(navView, (view) => emit('update:view', view), { immediate: true })
watch(navMeta, (meta) => emit('nav-meta', meta), { immediate: true })
watch(
  () => props.active,
  (active) => {
    if (!active) closeMenu()
  }
)
watch(
  () => props.initialCode,
  (code) => previewInitialCode(code)
)

onMounted(() => {
  ipcRenderer.on('source-install-task:updated', handleSourceInstallTaskUpdated)
  previewInitialCode(props.initialCode)
  refreshLocalInstances()
  loadSubscriptionUpdates()
  loadList()
  document.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

watch(() => userStore.token, () => {
  listRequestSerial++
  subscriptionRequestSerial++
  records.value = []
  subscriptionUpdates.value = []
  mineLoaded.value = false
  mineStats.value = { all: 0, public: 0, code: 0, off: 0, imports: 0 }
  total.value = 0
  preview.value.open = false
  sourceModpackEditor.value.open = false
  // 退出登录回到本地整合包；刚登录则留在用户点「登录」时所在的视图。
  if (!userStore.isLogin) activeTab.value = 'local'
  loadSubscriptionUpdates()
  loadList()
})

// 订阅更新到达后，本地整合包表格需要合并新修订信息。
watch(subscriptionUpdates, () => {
  if (isLocalTab.value) loadList({ silent: true })
})

onDeactivated(() => closeMenu())

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
  ipcRenderer.removeListener('source-install-task:updated', handleSourceInstallTaskUpdated)
  if (sourceInstallTaskRefreshTimer) {
    clearTimeout(sourceInstallTaskRefreshTimer)
    sourceInstallTaskRefreshTimer = null
  }
})
</script>

<template>
  <div class="source-modpack-page">
    <div class="smp-layout">
      <section class="smp-main" aria-labelledby="smp-view-title">
        <!-- 标题行与模组中心游戏列表的标题行同一结构：左标题，右侧工具（分享码导入） -->
        <header class="smp-head">
          <h2 id="smp-view-title" class="smp-head__title">{{ currentViewLabel }}</h2>
          <form
            class="smp-import"
            :aria-label="$t('ui.importAShareCode')"
            novalidate
            @submit.prevent="openPreviewByCode"
          >
            <label class="smp-sr-only" for="smp-share-code">{{ $t('ui.vertexShareCode') }}</label>
            <div class="smp-field" :class="{ 'has-error': codeError }">
              <SmpIcon name="link" :size="15" />
              <input
                id="smp-share-code"
                ref="codeInputRef"
                v-model="codeInput"
                type="text"
                :placeholder="$t('ui.pasteAVertexShareCode')"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="Boolean(codeError)"
                :aria-describedby="codeError ? 'smp-share-code-error' : undefined"
                @input="handleCodeInput"
              />
            </div>
            <VxButton type="submit">{{ $t('ui.previewImport') }}</VxButton>
            <p v-if="codeError" id="smp-share-code-error" class="smp-field-error" role="alert">
              <SmpIcon name="alert" :size="13" />
              <span>{{ codeError }}</span>
            </p>
          </form>
        </header>

        <section v-if="requiresLogin" class="smp-empty">
          <span class="smp-empty__icon"><SmpIcon name="user" :size="22" /></span>
          <h3>{{ navView === 'public' ? $t('ui.signInToBrowsePublicModpacks') : $t('ui.signInToViewYourModpacks') }}</h3>
          <p>{{ $t('ui.publicListingsFavoritesSubscriptionsAndSharingRequireAVertexAccount') }}</p>
          <div class="smp-empty__actions">
            <VxButton variant="secondary" size="sm" @click="openLogin">{{ $t('auth.login.submit') }}</VxButton>
            <VxButton variant="ghost" size="sm" @click="changeTab('local')"
              >{{ $t('ui.viewLocalModpacks') }}</VxButton
            >
          </div>
        </section>

        <template v-else>
          <div class="smp-toolbar" role="search">
            <VxSegmented
              v-if="navView === 'subscriptions'"
              class="smp-segmented"
              :model-value="activeTab"
              :options="subscriptionSegmentOptions"
              :aria-label="$t('ui.filterSubscriptions')"
              @update:model-value="changeTab"
            />
            <VxSegmented
              v-else-if="navView === 'local'"
              class="smp-segmented"
              :model-value="localFilter"
              :options="localSegmentOptions"
              :aria-label="$t('tools.filterByStatus')"
              @update:model-value="changeLocalFilter"
            />
            <VxSegmented
              v-else-if="navView === 'mine'"
              class="smp-segmented"
              :model-value="mineFilter"
              :options="mineSegmentOptions"
              :aria-label="$t('ui.filterByVisibility')"
              @update:model-value="changeMineFilter"
            />

            <div v-if="showKeywordFilter" class="smp-search">
              <label class="smp-search__field">
                <SmpIcon name="search" />
                <input
                  v-model="query.keyword"
                  type="text"
                  :placeholder="$t('ui.searchNamesGamesOrShareCodes')"
                  :aria-label="$t('ui.searchNamesGamesOrShareCodes')"
                  @keydown.enter.prevent="searchList"
                  @keydown.esc="clearKeyword"
                />
                <button
                  v-if="query.keyword"
                  type="button"
                  class="smp-search__clear"
                  :aria-label="$t('modBrowser.clearSearch')"
                  @click="clearKeyword"
                >
                  <SmpIcon name="close" :size="14" />
                </button>
              </label>
              <VxButton variant="secondary" class="smp-search__submit" @click="searchList">
                {{ $t('tools.search') }}
              </VxButton>
            </div>

            <div v-if="showPlatformFilter" class="smp-select">
              <VxSelect
                v-model="query.sourceType"
                :options="platformOptions"
                :aria-label="$t('ui.platform')"
                @change="searchList"
              />
            </div>

            <label v-if="showSourceIdFilter" class="smp-id-field">
              <span class="smp-sr-only">{{ $t('ui.sourceGameID') }}</span>
              <input
                v-model="query.sourceGameId"
                type="text"
                :placeholder="$t('ui.sourceGameID')"
                @keydown.enter.prevent="searchList"
              />
            </label>

            <span class="smp-toolbar__spacer"></span>

            <VxButton
              v-if="navView === 'local' && userStore.isLogin"
              variant="ghost"
              :disabled="loading"
              @click="checkLocalUpdates"
            >
              <SmpIcon name="refresh" :size="15" />
              {{ $t('tools.checkForUpdates') }}
            </VxButton>
          </div>

          <div v-if="isBrowseView || filterChips.length" class="smp-result">
            <span>{{ loading ? $t('ui.loadingVariant2') : resultText }}</span>
            <template v-if="filterChips.length">
              <span v-for="chip in filterChips" :key="chip.key" class="smp-chip">
                {{ chip.label }}
                <button
                  type="button"
                  :aria-label="$t('ui.removeValue', { value1: (chip.label) })"
                  @click="removeFilterChip(chip.key)"
                >
                  <SmpIcon name="close" :size="12" />
                </button>
              </span>
              <button type="button" class="smp-text-button" @click="resetFilters">
                {{ $t('tools.clearFilters') }}
              </button>
            </template>
          </div>

          <div v-if="loading" aria-busy="true">
            <span class="smp-sr-only" role="status">{{ $t('ui.loadingModpacks') }}</span>
            <div v-if="isBrowseView" class="smp-grid">
              <div v-for="i in 6" :key="i" class="smp-card is-skeleton" aria-hidden="true">
                <div class="smp-card__top">
                  <span class="smp-skeleton smp-thumb"></span>
                  <span class="smp-card__body smp-skeleton-lines">
                    <span class="smp-skeleton" style="width: 60%; height: 14px"></span>
                    <span class="smp-skeleton is-soft" style="width: 40%"></span>
                    <span class="smp-skeleton is-soft" style="width: 90%"></span>
                  </span>
                </div>
                <div class="smp-card__footer">
                  <span class="smp-skeleton is-soft" style="width: 36%"></span>
                  <span class="smp-toolbar__spacer"></span>
                  <span class="smp-skeleton" style="width: 72px; height: 24px"></span>
                </div>
              </div>
            </div>
            <div v-else class="smp-table">
              <div v-for="i in 5" :key="i" class="smp-skeleton-row" aria-hidden="true">
                <span class="smp-skeleton smp-thumb is-small"></span>
                <span class="smp-skeleton-lines">
                  <span class="smp-skeleton" style="width: 220px; height: 12px"></span>
                  <span class="smp-skeleton is-soft" style="width: 140px"></span>
                </span>
              </div>
            </div>
          </div>

          <section v-else-if="!records.length" class="smp-empty">
            <span class="smp-empty__icon"><SmpIcon :name="emptyState.icon" :size="22" /></span>
            <h3>{{ emptyState.title }}</h3>
            <p>{{ emptyState.text }}</p>
            <div v-if="emptyState.actions.length" class="smp-empty__actions">
              <VxButton
                v-for="action in emptyState.actions"
                :key="action.key"
                :variant="action.ghost ? 'ghost' : 'secondary'"
                size="sm"
                @click="handleEmptyAction(action.key)"
              >
                {{ action.label }}
              </VxButton>
            </div>
          </section>

          <!-- 发现类：公开整合包 / 我的收藏 / 我的订阅 -->
          <div v-else-if="isBrowseView" class="smp-grid">
            <article v-for="row in recordViews" :key="row.key" class="smp-card">
              <div class="smp-card__top">
                <span class="smp-thumb" aria-hidden="true">
                  <GameCover :src="row.pack.cover" :fallback-text="getPackGameName(row.pack)" />
                </span>
                <div class="smp-card__body">
                  <h3 class="smp-card__title">
                    <button
                      type="button"
                      :title="getPackName(row.pack)"
                      :disabled="!getPackId(row.pack)"
                      @click="openPreviewById(getPackId(row.pack), row.pack)"
                    >
                      {{ getPackName(row.pack) }}
                    </button>
                  </h3>
                  <div class="smp-meta">
                    <span>{{ getPackGameName(row.pack) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ getSourceModpackPlatformLabel(getPackSourceType(row.pack)) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ getPackModNum(row.pack) }} {{ $t('ui.mods') }}</span>
                    <template v-if="navView === 'subscriptions'">
                      <span aria-hidden="true">·</span>
                      <span>{{ formatShortDate(row.pack.updatedAt || row.pack.updated_at) }} {{ $t('taskCenter.table.updated') }}</span>
                    </template>
                  </div>
                  <p class="smp-card__desc">{{ getPackDescription(row.pack) }}</p>
                </div>
              </div>
              <div class="smp-card__footer">
                <div class="smp-card__info">
                  <template v-if="navView !== 'subscriptions'">
                    <span class="smp-stat" :title="$t('ui.imports')">
                      <SmpIcon name="download" :size="13" />
                      {{ formatCompactCount(row.pack.importCount || row.pack.import_count) }}
                    </span>
                    <template v-if="isPackPublicVisible(row.pack)">
                      <span class="smp-stat" :title="$t('ui.likes')">
                        <SmpIcon name="heart" :size="13" />
                        {{ formatCompactCount(getPackLikeCount(row.pack)) }}
                      </span>
                      <span class="smp-stat" :title="$t('ui.subscribers')">
                        <SmpIcon name="bell" :size="13" />
                        {{ formatCompactCount(getPackSubscribeCount(row.pack)) }}
                      </span>
                    </template>
                  </template>
                  <span
                    v-if="row.state"
                    class="smp-state"
                    :class="`is-${row.state.tone}`"
                    :title="row.state.reason || undefined"
                  >
                    <SmpIcon v-if="row.state.icon" :name="row.state.icon" :size="13" />
                    {{ row.state.text }}
                    <span v-if="row.revision.next" class="smp-mono smp-state__rev">
                      r{{ row.revision.installed }} → r{{ row.revision.next }}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  class="smp-icon-button"
                  :class="{ 'is-open': menuState.pack === row.pack }"
                  :aria-label="$t('ui.moreActions')"
                  aria-haspopup="menu"
                  :aria-expanded="menuState.pack === row.pack"
                  @click.stop="openMenu(row.pack, $event)"
                >
                  <SmpIcon name="more" />
                </button>
                <VxButton
                  v-if="row.action"
                  variant="secondary"
                  size="sm"
                  :disabled="row.busy"
                  @click="runPackPrimaryAction(row.pack)"
                >
                  {{ row.action }}
                </VxButton>
              </div>
            </article>
          </div>

          <!-- 本地整合包：本机实例管理表格 -->
          <div
            v-else-if="navView === 'local'"
            class="smp-table"
            role="table"
            :aria-label="$t('ui.localModpacksVariant2')"
          >
            <div class="smp-table__scroll">
              <div class="smp-row smp-row--head smp-cols-local" role="row">
                <span role="columnheader">{{ $t('ui.modpacks') }}</span>
                <span role="columnheader">{{ $t('taskCenter.toolbar.sourceLabel') }}</span>
                <span role="columnheader">{{ $t('ui.revision') }}</span>
                <span role="columnheader" class="is-num">{{ $t('ui.mod') }}</span>
                <span role="columnheader">{{ $t('modBrowser.columnStatus') }}</span>
                <span role="columnheader" class="is-end">{{ $t('ui.actions') }}</span>
              </div>
              <div
                v-for="row in recordViews"
                :key="row.key"
                class="smp-row smp-cols-local"
                :class="{ 'is-menu-open': menuState.pack === row.pack }"
                role="row"
              >
                <div class="smp-name-cell" role="cell">
                  <span class="smp-thumb is-small" aria-hidden="true">
                    <GameCover :src="row.pack.cover" :fallback-text="getPackGameName(row.pack)" />
                  </span>
                  <span class="smp-name-cell__text">
                    <strong :title="getPackName(row.pack)">{{ getPackName(row.pack) }}</strong>
                    <span class="smp-name-cell__sub">
                      <span>{{ getPackGameName(row.pack) }}</span>
                      <span v-if="row.instanceLabel" class="smp-tag" :title="row.instanceLabel">
                        {{ row.instanceLabel }}
                      </span>
                    </span>
                  </span>
                </div>
                <div class="smp-cell" role="cell">
                  {{ getSourceModpackPlatformLabel(getPackSourceType(row.pack)) }}
                </div>
                <div class="smp-cell smp-mono smp-rev" role="cell">
                  <span>{{ row.revision.installed ? `r${row.revision.installed}` : '—' }}</span>
                  <template v-if="row.revision.next">
                    <SmpIcon name="arrowRight" :size="12" class="smp-rev__arrow" />
                    <span class="smp-rev__next">r{{ row.revision.next }}</span>
                  </template>
                </div>
                <div class="smp-cell is-num" role="cell">{{ getPackModNum(row.pack) }}</div>
                <div class="smp-state-cell" role="cell">
                  <span v-if="row.state" class="smp-state" :class="`is-${row.state.tone}`">
                    <SmpIcon v-if="row.state.icon" :name="row.state.icon" :size="14" />
                    {{ row.state.text }}
                  </span>
                  <span v-else class="smp-state is-muted">—</span>
                  <span
                    v-if="row.state?.reason"
                    class="smp-state-cell__reason"
                    :title="row.state.reason"
                  >
                    {{ row.state.reason }}
                  </span>
                </div>
                <div class="smp-ops" role="cell">
                  <VxButton
                    v-if="row.action"
                    variant="secondary"
                    size="sm"
                    :disabled="row.busy"
                    @click="runPackPrimaryAction(row.pack)"
                  >
                    {{ row.action }}
                  </VxButton>
                  <button
                    type="button"
                    class="smp-icon-button"
                    :class="{ 'is-open': menuState.pack === row.pack }"
                    :aria-label="$t('ui.moreActionsForValue', { value1: (getPackName(row.pack)) })"
                    aria-haspopup="menu"
                    :aria-expanded="menuState.pack === row.pack"
                    @click.stop="openMenu(row.pack, $event)"
                  >
                    <SmpIcon name="more" />
                  </button>
                </div>
              </div>
            </div>
            <div class="smp-table__footer">
              <span>
                {{ $t('ui.total') }} {{ localStats.all }} {{ $t('ui.localModpacks') }}{{ localStats.update }} {{ $t('ui.haveNewRevisions') }}{{
                  localStats.attention
                }}
                {{ $t('ui.needAttention') }}
              </span>
              <span>{{ $t('ui.localModpacksDoNotRequireSignIn') }}</span>
            </div>
          </div>

          <!-- 我的分享：发布管理表格 -->
          <div v-else class="smp-table" role="table" :aria-label="$t('ui.myShares')">
            <div class="smp-table__scroll">
              <div class="smp-row smp-row--head smp-cols-mine" role="row">
                <span role="columnheader">{{ $t('ui.modpacks') }}</span>
                <span role="columnheader">{{ $t('ui.shareCode') }}</span>
                <span role="columnheader">{{ $t('ui.visibility') }}</span>
                <span role="columnheader">{{ $t('ui.revision') }}</span>
                <span role="columnheader" class="is-num">{{ $t('ui.import') }}</span>
                <span role="columnheader">{{ $t('ui.engagement') }}</span>
                <span role="columnheader">{{ $t('taskCenter.table.updated') }}</span>
                <span role="columnheader" class="is-end">{{ $t('ui.actions') }}</span>
              </div>
              <div
                v-for="row in recordViews"
                :key="row.key"
                class="smp-row smp-cols-mine"
                :class="{ 'is-menu-open': menuState.pack === row.pack }"
                role="row"
              >
                <div class="smp-name-cell" role="cell">
                  <span class="smp-thumb is-small" aria-hidden="true">
                    <GameCover :src="row.pack.cover" :fallback-text="getPackGameName(row.pack)" />
                  </span>
                  <span class="smp-name-cell__text">
                    <strong :title="getPackName(row.pack)">{{ getPackName(row.pack) }}</strong>
                    <span class="smp-name-cell__sub is-text">
                      {{ getPackGameName(row.pack) }} ·
                      {{ getSourceModpackPlatformLabel(getPackSourceType(row.pack)) }} ·
                      {{ getPackModNum(row.pack) }} {{ $t('ui.mods') }}
                    </span>
                  </span>
                </div>
                <div class="smp-cell smp-code-cell" role="cell">
                  <span class="smp-mono">{{ getPackShareCode(row.pack) || '—' }}</span>
                  <button
                    v-if="getPackShareCode(row.pack)"
                    type="button"
                    class="smp-icon-button is-tiny"
                    :aria-label="$t('ui.copyShareCodeValue', { value1: (getPackShareCode(row.pack)) })"
                    @click="copyShareCode(getPackShareCode(row.pack))"
                  >
                    <SmpIcon name="copy" :size="13" />
                  </button>
                </div>
                <div class="smp-state-cell" role="cell">
                  <span class="smp-state" :class="`is-${row.visibility.tone}`">
                    <SmpIcon :name="row.visibility.icon" :size="14" />
                    {{ row.visibility.text }}
                  </span>
                  <span class="smp-state-cell__reason">{{ row.visibility.desc }}</span>
                </div>
                <div class="smp-cell smp-mono" role="cell">
                  {{ getPackRevision(row.pack) ? `r${getPackRevision(row.pack)}` : '—' }}
                </div>
                <div class="smp-cell is-num" role="cell">
                  {{ formatCount(row.pack.importCount || row.pack.import_count) }}
                </div>
                <div class="smp-interactions" role="cell">
                  <template v-if="row.visibility.key === 'public'">
                    <span :title="$t('ui.like')"
                      ><SmpIcon name="heart" :size="12" />{{
                        formatCompactCount(getPackLikeCount(row.pack))
                      }}</span
                    >
                    <span :title="$t('ui.favorite')"
                      ><SmpIcon name="star" :size="12" />{{
                        formatCompactCount(getPackFavoriteCount(row.pack))
                      }}</span
                    >
                    <span :title="$t('ui.subscribe')"
                      ><SmpIcon name="bell" :size="12" />{{
                        formatCompactCount(getPackSubscribeCount(row.pack))
                      }}</span
                    >
                  </template>
                  <span v-else>—</span>
                </div>
                <div class="smp-cell is-muted" role="cell">
                  {{ formatDate(row.pack.updatedAt || row.pack.updated_at) }}
                </div>
                <div class="smp-ops" role="cell">
                  <VxButton
                    variant="secondary"
                    size="sm"
                    :loading="isSourceModpackEditorOpening(row.pack)"
                    :disabled="!!sourceModpackEditor.loadingId || sourceModpackEditor.saving"
                    @click="openSourceModpackEditor(row.pack)"
                  >
                    <SmpIcon name="edit" :size="14" />
                    {{ $t('modelSettings.edit') }}
                  </VxButton>
                  <button
                    type="button"
                    class="smp-icon-button"
                    :class="{ 'is-open': menuState.pack === row.pack }"
                    :aria-label="$t('ui.moreActionsForValue', { value1: (getPackName(row.pack)) })"
                    aria-haspopup="menu"
                    :aria-expanded="menuState.pack === row.pack"
                    @click.stop="openMenu(row.pack, $event)"
                  >
                    <SmpIcon name="more" />
                  </button>
                </div>
              </div>
            </div>
            <div class="smp-table__footer">
              <span
                >{{ $t('ui.total') }} {{ mineStats.all }} {{ $t('ui.sharesTotalImports') }}
                {{ formatCount(mineStats.imports) }} {{ $t('ui.times') }}</span
              >
              <span>{{ $t('ui.deletingAShareDoesNotAffectContentAlreadyImportedBy') }}</span>
            </div>
          </div>

          <nav
            v-if="!loading && records.length && totalPage > 1"
            class="smp-pager"
            :aria-label="$t('pagination.label')"
          >
            <span>{{ $t('ui.perPage') }} {{ query.size }} {{ $t('ui.itemsVariant2') }}</span>
            <div class="smp-pager__pages">
              <button
                type="button"
                class="smp-page"
                :aria-label="$t('modBrowser.previous')"
                :disabled="query.page <= 1"
                @click="changePage(-1)"
              >
                <SmpIcon name="chevronLeft" :size="14" />
              </button>
              <template v-for="page in pageNumbers" :key="page">
                <span v-if="typeof page === 'string'" class="smp-page is-gap" aria-hidden="true"
                  >…</span
                >
                <button
                  v-else
                  type="button"
                  class="smp-page"
                  :class="{ 'is-active': page === query.page }"
                  :aria-current="page === query.page ? 'page' : undefined"
                  @click="goToPage(page)"
                >
                  {{ page }}
                </button>
              </template>
              <button
                type="button"
                class="smp-page"
                :aria-label="$t('modBrowser.next')"
                :disabled="query.page >= totalPage"
                @click="changePage(1)"
              >
                <SmpIcon name="chevronRight" :size="14" />
              </button>
            </div>
          </nav>
        </template>
      </section>
    </div>

    <!-- 「更多」菜单：Teleport 到 body，避免被 page-body 滚动容器和表格横向滚动裁切 -->
    <Teleport to="body">
      <div
        v-if="menuState.pack"
        ref="menuRef"
        class="smp-menu"
        role="menu"
        :aria-label="$t('ui.moreActionsForValue', { value1: (getPackName(menuState.pack)) })"
        :style="menuState.style"
        @keydown="handleMenuKeydown"
      >
        <template v-for="entry in menuEntries" :key="entry.key">
          <div v-if="entry.separator" class="smp-menu__separator" role="separator"></div>
          <button
            v-else
            type="button"
            role="menuitem"
            class="smp-menu__item"
            :class="{ 'is-danger': entry.danger }"
            :disabled="!!entry.disabled"
            @click="handleMenuEntry(entry)"
          >
            {{ entry.label }}
          </button>
        </template>
      </div>
    </Teleport>

    <UserLogin ref="userLoginRef" />

    <SourceModpackEditorModal
      :model-value="sourceModpackEditor.open"
      :detail="sourceModpackEditor.detail || {}"
      :saving="sourceModpackEditor.saving"
      @update:model-value="handleSourceModpackEditorVisibleChange"
      @save="saveSourceModpackEdit"
    />

    <SourceModpackPreviewModal
      :model-value="preview.open"
      :loading="preview.loading"
      :installing="preview.installing"
      :detail="preview.detail || {}"
      :items="preview.items"
      :selected-keys="preview.selectedKeys"
      :inspection="preview.inspection"
      :intent="preview.intent"
      :pending-manual-count="previewPendingManualItems.length"
      :failed-item-count="previewFailedItems.length"
      :can-submit="canSubmitPreviewImport"
      @close="closePreview"
      @toggle-interaction="toggleInteraction"
      @install-new-copy="inspectPreviewAsNewCopy"
      @confirm="confirmPreviewImport"
    />

    <VxModal
      :model-value="targetPicker.open"
      :title="t('dialogs.targetPicker.title')"
      :subtitle="t('dialogs.targetPicker.subtitle', { count: targetPicker.candidates.length })"
      :width="520"
      :show-close="!targetPicker.loadingId"
      :close-on-esc="!targetPicker.loadingId"
      @update:model-value="(value) => !value && closeTargetPicker()"
    >
      <ul class="target-picker" :aria-busy="!!targetPicker.loadingId">
        <li v-for="candidate in targetPicker.candidates" :key="candidate.id">
          <button
            type="button"
            class="target-picker__item"
            :class="{ 'is-busy': targetPicker.loadingId === candidate.id }"
            :disabled="!!targetPicker.loadingId"
            :aria-busy="targetPicker.loadingId === candidate.id"
            @click="selectPreviewTarget(candidate)"
          >
            <span class="target-picker__icon" aria-hidden="true">
              <ToolIcon name="folder" :size="16" />
            </span>
            <span class="target-picker__main">
              <span class="target-picker__name">{{
                candidate.name || t('dialogs.targetPicker.recordName', { id: candidate.id })
              }}</span>
              <span class="target-picker__root" :title="candidate.gameRoot || ''">{{
                candidate.gameRoot || t('dialogs.targetPicker.noRoot')
              }}</span>
            </span>
            <span class="target-picker__action">
              <span
                v-if="targetPicker.loadingId === candidate.id"
                class="pro-spinner small"
                aria-hidden="true"
              ></span>
              {{
                targetPicker.loadingId === candidate.id
                  ? t('dialogs.targetPicker.analyzing')
                  : t('dialogs.targetPicker.choose')
              }}
            </span>
          </button>
        </li>
      </ul>

      <template #footer>
        <span class="target-picker__foot">{{ t('dialogs.targetPicker.missingHint') }}</span>
        <VxButton
          variant="secondary"
          :disabled="!!targetPicker.loadingId"
          @click="closeTargetPicker"
        >
          {{ t('dialogs.cancel') }}
        </VxButton>
      </template>
    </VxModal>
  </div>
</template>

<style scoped lang="scss">
// 整合包面板（嵌在模组中心内容区）：视觉规范见项目文档《外部来源整合包页 UI 重设计方案》（2026-10-20）
// 与《整合包并入模组中心》（2026-10-27）。只使用 vertex-ui/styles.scss 中的 token。
// 面板不自带滚动容器，跟随模组中心的 page-body 滚动。
.source-modpack-page {
  width: 100%;
  min-width: 0;
}

.smp-layout {
  // 给右下角 AI 吉祥物留出空间，避免遮挡分页和表格最后一行的操作。
  padding-bottom: var(--space-12);
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-md);
}

.smp-icon {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;

  &.is-spinning {
    animation: smp-spin 0.9s linear infinite;
  }
}

.smp-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.smp-mono {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}

// ───────── 标题行：分类名 + 分享码导入 ─────────
// 与模组中心 .mc-head__row 对齐：标题 22px，右侧工具区最宽 460px。

.smp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  min-width: 0;
}

.smp-head__title {
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--control-height-md);
}

.smp-import {
  display: flex;
  flex: 0 1 460px;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 260px;
  margin: 0;

  .smp-field {
    flex: 1 1 200px;
  }
}

.smp-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-height-md);
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  &.has-error {
    border-color: var(--color-danger);
    box-shadow: 0 0 0 3px var(--color-danger-soft);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-sm);
    background: transparent;
    border: 0;
    outline: none;

    &::placeholder {
      color: var(--color-placeholder);
    }
  }
}

.smp-field-error {
  display: flex;
  flex-basis: 100%;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);

  .smp-icon {
    margin-top: 2px;
  }
}

// ───────── 内容区 ─────────

.smp-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.smp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.smp-toolbar__spacer {
  flex: 1;
}

// VxSegmented 默认占满整行；这里按内容宽度显示，和搜索框放在同一行。
.smp-segmented {
  flex: none;
  width: auto;
}

.smp-search {
  display: flex;
  flex: 1 1 260px;
  max-width: 420px;
  min-width: 0;
}

.smp-search__field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-height-md);
  padding: 0 6px 0 var(--space-3);
  color: var(--color-text-muted);
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  cursor: text;

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    position: relative;
    z-index: 1;
    border-color: var(--color-accent);
    border-right: 1px solid var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-sm);
    background: transparent;
    border: 0;
    outline: none;

    &::placeholder {
      color: var(--color-placeholder);
    }
  }
}

.smp-search__clear {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text);
    background: var(--color-surface-hover);
    outline: none;
  }
}

.smp-search__submit {
  flex: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.smp-select {
  width: 148px;
}

.smp-id-field {
  display: flex;
  width: 148px;

  input {
    width: 100%;
    height: var(--control-height-md);
    padding: 0 var(--space-3);
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-sm);
    background: var(--control-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    outline: none;

    &::placeholder {
      color: var(--color-placeholder);
    }

    &:hover {
      border-color: var(--color-border-strong);
    }

    &:focus {
      border-color: var(--color-accent);
      box-shadow: var(--focus-ring);
    }
  }
}

.smp-result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px var(--space-2);
  min-height: 24px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.smp-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 6px 0 10px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);

  button {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--color-text-muted);
    background: transparent;
    border: 0;
    border-radius: var(--radius-xs);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      color: var(--color-text);
      background: var(--color-surface-hover);
      outline: none;
    }
  }
}

.smp-text-button {
  padding: 0 var(--space-1);
  color: var(--color-accent-strong);
  font-family: var(--font-family-base);
  font-size: var(--font-size-xs);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

// ───────── 发现类卡片 ─────────

.smp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
  gap: var(--space-4);
}

.smp-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-skeleton) {
    border-color: var(--color-border-strong);
  }
}

.smp-card__top {
  display: flex;
  gap: 14px;
  min-width: 0;
}

.smp-thumb {
  display: block;
  flex: 0 0 80px;
  width: 80px;
  height: 80px;
  overflow: hidden;
  border-radius: var(--radius-sm);

  &.is-small {
    flex-basis: 40px;
    width: 40px;
    height: 40px;

    :deep(.game-cover__fallback) {
      font-size: var(--font-size-sm);
    }
  }
}

.smp-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.smp-card__title {
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;

  button {
    max-width: 100%;
    padding: 0;
    overflow: hidden;
    color: inherit;
    font: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: 0;
    border-radius: var(--radius-xs);
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--color-accent-strong);
    }

    &:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    &:disabled {
      cursor: default;
    }
  }
}

.smp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) 6px;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.smp-card__desc {
  display: -webkit-box;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.smp-card__footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-height-sm);
  margin-top: auto;
}

.smp-card__info {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.smp-stat {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

// 状态文字：图标 + 文字，颜色用 *-strong，满足 AA 对比度。
.smp-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: inherit;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;

  &.is-accent {
    color: var(--color-accent-strong);
  }

  &.is-success {
    color: var(--color-success-strong);
  }

  &.is-warning {
    color: var(--color-warning-strong);
  }

  &.is-danger {
    color: var(--color-danger);
  }

  &.is-muted {
    color: var(--color-text-secondary);
    font-weight: var(--font-weight-medium);
  }
}

.smp-state__rev {
  font-weight: var(--font-weight-regular);
}

.smp-icon-button {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  color: var(--color-text-secondary);
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  .smp-icon {
    stroke-width: 3;
  }

  &:hover,
  &.is-open {
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &.is-tiny {
    width: 24px;
    height: 24px;
    color: var(--color-text-muted);
    background: transparent;
    border-color: transparent;

    .smp-icon {
      stroke-width: 1.8;
    }

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);
    }
  }
}

// ───────── 表格（本地整合包 / 我的分享）─────────

.smp-table {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.smp-table__scroll {
  overflow-x: auto;

  &::-webkit-scrollbar {
    height: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

.smp-row {
  display: grid;
  align-items: center;
  gap: var(--space-4);
  min-height: 64px;
  padding: 10px var(--space-4);
  border-bottom: 1px solid var(--color-surface-strong);

  &:last-child {
    border-bottom: 0;
  }

  &:not(.smp-row--head):hover,
  &.is-menu-open {
    background: var(--color-surface-hover);
  }
}

.smp-row--head {
  min-height: 36px;
  padding-top: 0;
  padding-bottom: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.smp-cols-local {
  grid-template-columns: minmax(240px, 2.2fr) 112px 120px 56px minmax(200px, 1.6fr) 176px;
  min-width: 1000px;
}

.smp-cols-mine {
  grid-template-columns: minmax(220px, 2fr) 148px 150px 52px 72px 150px 88px 136px;
  min-width: 1080px;
}

.is-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.is-end {
  text-align: right;
}

.smp-cell {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  &.is-muted {
    color: var(--color-text-muted);
  }
}

.smp-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.smp-name-cell__text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    overflow: hidden;
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.smp-name-cell__sub {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smp-name-cell__sub.is-text {
  display: block;
}

.smp-tag {
  display: inline-flex;
  align-items: center;
  max-width: 160px;
  height: 18px;
  padding: 0 6px;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-surface-strong);
  border-radius: var(--radius-xs);
}

.smp-rev {
  display: flex;
  align-items: center;
  gap: 6px;
}

.smp-rev__arrow {
  color: var(--color-accent-active);
}

.smp-rev__next {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  color: var(--color-accent-strong);
  font-weight: var(--font-weight-semibold);
  background: var(--color-accent-soft);
  border-radius: var(--radius-xs);
}

.smp-state-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: var(--font-size-sm);
}

.smp-state-cell__reason {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smp-code-cell {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.smp-interactions {
  display: flex;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);

  span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
}

.smp-ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.smp-table__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 40px;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  border-top: 1px solid var(--color-border);
}

// ───────── 空状态 / 未登录 ─────────

.smp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-12) var(--space-6);
  text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: var(--font-weight-semibold);
  }

  p {
    max-width: 360px;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
  }
}

.smp-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  background: var(--color-surface-hover);
  border-radius: var(--radius-md);
}

.smp-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

// ───────── 加载骨架 ─────────

.smp-skeleton {
  display: block;
  height: 10px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-xs);
  animation: smp-pulse 1.4s var(--ease-standard) infinite;

  &.is-soft {
    background: var(--color-surface-hover);
  }

  &.smp-thumb {
    height: 80px;
    border-radius: var(--radius-sm);
  }

  &.smp-thumb.is-small {
    height: 40px;
  }
}

.smp-skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-1);
}

.smp-skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 64px;
  padding: 10px var(--space-4);
  border-bottom: 1px solid var(--color-surface-strong);

  &:last-child {
    border-bottom: 0;
  }
}

// ───────── 分页 ─────────

.smp-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.smp-pager__pages {
  display: flex;
  gap: var(--space-1);
}

.smp-page {
  display: inline-grid;
  place-items: center;
  min-width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0 var(--space-2);
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover:not(:disabled):not(.is-active):not(.is-gap) {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--control-text-disabled);
    cursor: not-allowed;
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  &.is-gap {
    cursor: default;
  }
}

// ───────── 安装目标选择弹窗（原有功能，样式改用 token）─────────

.pro-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-surface-strong);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: smp-spin 0.8s linear infinite;

  &.small {
    width: 12px;
    height: 12px;
    border-width: 1.5px;
  }
}

.target-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.target-picker__item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  color: var(--color-text);
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: inherit;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
    border-color: var(--color-accent);
  }

  &:hover:not(:disabled) .target-picker__action {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-text-inverse);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: default;
  }

  &:disabled:not(.is-busy) {
    opacity: 0.55;
  }

  &.is-busy {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }
}

.target-picker__icon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--color-surface-strong);
  color: var(--color-text-tertiary);
}

.target-picker__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.target-picker__name {
  font-size: 14px;
  font-weight: var(--font-weight-semibold);
}

.target-picker__root {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-picker__action {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: var(--font-weight-semibold);
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.target-picker__item.is-busy .target-picker__action {
  border-color: transparent;
  background: transparent;
  color: var(--color-accent-strong);
}

.target-picker__foot {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
}

// 窄窗口：分享码导入换到标题下方并占满一行。
@media (max-width: 980px) {
  .smp-import {
    flex-basis: 100%;
  }
}

@keyframes smp-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes smp-pulse {
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .smp-icon.is-spinning,
  .pro-spinner,
  .smp-skeleton {
    animation: none;
  }
}
</style>

<style lang="scss">
// 「更多」菜单通过 Teleport 渲染到 body，样式不能使用 scoped。
.smp-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  box-sizing: border-box;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  .smp-menu__item {
    display: block;
    width: 100%;
    height: var(--control-height-sm);
    padding: 0 10px;
    overflow: hidden;
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-sm);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;

    &:hover:not(:disabled),
    &:focus-visible {
      background: var(--color-surface-hover);
      outline: none;
    }

    &:focus-visible {
      box-shadow: inset 0 0 0 2px var(--color-accent);
    }

    &:disabled {
      color: var(--control-text-disabled);
      cursor: not-allowed;
    }

    &.is-danger:not(:disabled) {
      color: var(--color-danger);
    }
  }

  .smp-menu__separator {
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--color-surface-strong);
  }
}
</style>
