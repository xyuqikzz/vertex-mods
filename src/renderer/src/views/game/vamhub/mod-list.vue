<script setup>
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { loadPrivateVamhubRule } from './useVamhubRuleConfigPage.js'
import { describeSharedRuleFailure } from '../../../../../shared/installation/shared-install-rule.js'
import { useSourceDescriptionTranslation } from '@renderer/composables/source-description-translation.js'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Modal } from 'ant-design-vue'
import PageBody from '@renderer/component/page-body.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { GET_SHARED_INSTALL_RULE } from '@renderer/api/modules/game.js'
import UnifiedModHeader from '@views/game/component/unifiedModList/UnifiedModHeader.vue'
import UnifiedModSearchBar from '@views/game/component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '@views/game/component/unifiedModList/UnifiedModListGrid.vue'
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import { formatInstallSize } from '@views/game/component/install-confirm/install-confirm-format.js'
import ModSourceProfileModal from '@renderer/views/game/component/profile/mod-source-profile-modal.vue'
import ModSourceCreateProfileModal from '@renderer/views/game/component/profile/mod-source-create-profile-modal.vue'
import SourceModpackShareCodeModal from '@views/game/component/source-modpack-share-code-modal.vue'
import SourceModpackUpdateModal from '@views/game/sourceModpack/component/SourceModpackUpdateModal.vue'
import VamhubCookieDialog from './vamhub-cookie-dialog.vue'
import ProfileSwitchProgressDialog from '@renderer/views/game/component/profile/profile-switch-progress-dialog.vue'
import { VxButton, VxDialogActions, VxDrawer, VxModal, VxTag } from '@renderer/component/vertex-ui'
import { ToolEmpty, ToolIcon } from '@renderer/component/tool-page'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'
import {
  CREATE_SOURCE_MODPACK
} from '@renderer/api/modules/source-modpack.js'
import {
  buildSourceModpackCreatePayload,
  copySourceModpackTextToClipboard,
  extractSourceModpackShareCode
} from '@renderer/utils/source-modpack-share.js'
import { normalizeVamHubShareItem } from '@renderer/utils/source-modpack-adapters/vamhub.js'
import { requestSourceModpackShareName } from '@renderer/utils/source-modpack-share-name.js'
import { inspectShareImport, applyShareImport } from '@renderer/utils/source-modpack-coordinator-runtime.js'
import { buildCsmPayload, signCsmPayload } from '@renderer/utils/cross-source-modpack-schema.js'
import {
  openOfflinePackExportDialog,
  openOfflinePackImportDialog,
  pickOfflinePackImportFile
} from '@renderer/views/game/vxpack/vxpack-service.js'
import {
  isAiTranslationAvailable,
  queryCachedTextBatch as queryCachedTextBatchService,
  resolveEdgeSearchKeyword,
  resolveAiTranslationConfig,
  translateTextBatch as translateTextBatchService,
  translateTextBatchByEdge
} from '@renderer/utils/ai-translation.js'
import { waitForUiRender } from '@renderer/utils/ui-render.js'
import {
  createSourceInstallTaskRefreshScheduler,
  createSourceInstallTaskSubscriptions,
  shouldRefreshInstalledModsAfterSourceTask
} from '@renderer/utils/source-install-task-events.js'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../../shared/translation/ai-translation-config.js'
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'
import { buildGameSiteDetailRoute } from '@views/game/site-detail-route.js'
import {
  browseVamHubPackages,
  cancelResolveVamHubDependencies,
  getVamHubLoginStatus,
  getVamHubPackageBasic,
  getVamHubPackageDetail,
  resolveVamHubDependencies,
  resolveVamHubDownloadUrl,
  saveVamHubAuthCookie,
  submitVamHubInstallTask
} from './vamhub-service.js'

const route = useRoute()
const { t } = useI18n()
const router = useRouter()
const aiPageContextProvider = useAiPageContextProvider(route)
const { setMenuName: setPageMenuName } = useMenuName()
const downloadStore = useDownloadStore()
const VAMHUB_SOURCE_LABEL = resolveSourcePlatformLabel('vamhub', 'VAM-Hub')

const RESOURCE_TYPES = [
  { get label() { return uiText('ui.allCategories') }, value: '' },
  { label: 'Scenes', value: 'Scenes' },
  { label: 'Looks', value: 'Looks' },
  { label: 'Clothing', value: 'Clothing' },
  { label: 'Hairstyles', value: 'Hairstyles' },
  { label: 'Plugins + Scripts', value: 'Plugins + Scripts' },
  { label: 'Morphs', value: 'Morphs' },
  { label: 'Assets + Accessories', value: 'Assets + Accessories' },
  { label: 'Toolkits + Templates', value: 'Toolkits + Templates' },
  { label: 'Audio', value: 'Audio' }
]

const PRICING_OPTIONS = [
  { get label() { return uiText('ui.free') }, value: 'free' },
  { get label() { return uiText('tools.all') }, value: 'all' },
  { get label() { return uiText('ui.paid') }, value: 'premium' }
]

const SORT_OPTIONS = [
  { get label() { return uiText('tools.recentlyUpdated') }, value: 'last_update' },
  { get label() { return uiText('ui.submissionDate') }, value: 'resource_date' },
  { get label() { return uiText('modBrowser.columnDownloads') }, value: 'download_count' },
  { get label() { return uiText('ui.rating') }, value: 'rating_weighted' },
  { get label() { return uiText('ui.ratingCount') }, value: 'rating_count' },
  { get label() { return uiText('ui.title') }, value: 'title' },
  { get label() { return uiText('localMod.author') }, value: 'username' }
]

const STATUS_TEXT = {
  get need_download() { return uiText('ui.awaitingDownload') },
  get upgraded() { return uiText('ui.upgradeRequired') },
  get queued() { return uiText('ui.alreadyQueued') },
  get installed() { return uiText('tools.installed') },
  get no_source() { return uiText('ui.noDownloadSource') }
}

const SOURCE_INSTALL_DEPENDENCY_PREVIEW_LIMIT = 8

const sourceGameId = computed(() => String(route.params.id || route.query.sourceGameId || 'vam'))
const gameInfo = computed(() => ({
  name: String(route.query.name || 'Virt a Mate').trim(),
  englishName: String(route.query.englishName || 'Virt a Mate').trim(),
  coverImage: String(route.query.cover || '').trim(),
  description: String(
    route.query.desc ||
      uiText('ui.virtAMateIsAFlexible3DVRSimulatorAnd')
  ).trim(),
  modCount: Number(route.query.mods || 0) || 0
}))

const rootStorageKey = computed(() => `vertex:vamhub:${getRuleSourceGameId()}:gameRoot`)
const exeStorageKey = computed(() => `vertex:vamhub:${getRuleSourceGameId()}:gameExePath`)
const gameRoot = ref('')
const gameExePath = ref('')
const loading = ref(false)
const pathLoading = ref(false)
const systemConfig = ref({
  aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
})
const resources = ref([])
const installRuleCache = ref(null)
const installRuleFailure = ref(null)
const sharedRuleDocument = ref(null)
const installRuleSelection = ref('public')
const pagination = ref({
  current: 1,
  pages: 1,
  total: 0
})
const query = ref({
  search: '',
  effectiveKeyword: '',
  pricing: 'free',
  resourceType: '',
  sort: 'last_update',
  page: 1,
  pageSize: 24
})

const detailDrawerOpen = ref(false)
const selectedResource = ref(null)
const packageBasicLoading = ref(false)
const packageDetailLoading = ref(false)
const packageDetail = ref(null)
const detailDescriptionTranslation = useSourceDescriptionTranslation({
  source: 'vamhub',
  systemConfig,
  active: detailDrawerOpen,
  entries: computed(() => [{
    id: `detail:${packageDetail.value?.resource_id || packageDetail.value?.title || ''}`,
    text: stripHtml(packageDetail.value?.description),
    context: uiText('ui.modValue', { value1: (packageDetail.value?.title || '--') })
  }])
})
const translatedDetailDescription = computed(() => detailDescriptionTranslation.getText(
  `detail:${packageDetail.value?.resource_id || packageDetail.value?.title || ''}`,
  stripHtml(packageDetail.value?.description)
))
const installingKeyMap = ref({})
const sourceInstallModal = ref(createEmptySourceInstallModalState())
const sourceInstallResolvePackageName = ref('')
const vamhubAutoTranslationInFlightSignature = ref('')
const vamhubAutoTranslationCompletedSignature = ref('')
let vamhubSearchResolveToken = 0

const dependencyModalOpen = ref(false)
const resolvingDependencies = ref(false)
const submittingDependencies = ref(false)
const dependencyResult = ref(null)
const selectedDependencyMap = ref({})
const resolveProgress = ref({
  resolved_count: 0,
  total_discovered: 0,
  current_package: ''
})

const cookieModalOpen = ref(false)
const cookieSaving = ref(false)
const cookieInput = ref('')
const loginStatus = ref({ loggedIn: false })
const vamhubTranslationMap = ref({})
const vamhubTranslationResolvedMap = ref({})
const vamhubPageTranslationLoading = ref(false)
const vamhubPageTranslationProgress = ref({
  current: 0,
  total: 0
})
const vamhubItemTranslationLoadingMap = ref({})
let vamhubTranslationToken = 0

// 配置方案（本地 profile）
const vamhubProfileState = useModSourceProfiles({
  sourceKey: 'vamhub',
  identifier: () => {
    const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
    return String(raw || getRuleSourceGameId() || 'vam').trim()
  }
})
const profileConfigModal = ref({ open: false })
const profileSwitching = ref(false)
const sharingProfileLoading = ref(false)
const importingProfile = ref(false)
const createProfileModal = ref({ open: false, confirmLoading: false, name: '' })
const profileSwitchProgress = ref({
  open: false,
  stage: 'start',
  targetProfile: '',
  current: 0,
  total: 0,
  modName: '',
  disabledCount: 0,
  enabledCount: 0
})
const sourceModpackSharing = ref(false)
const sourceModpackUpdateModal = ref({ open: false, snapshot: null })
const sourceModpackImportModal = ref({
  open: false,
  code: '',
  loading: false
})
const sourceModpackImportPreview = ref({
  open: false,
  installing: false,
  detail: null,
  items: [],
  selectedKeys: {},
  profileName: '',
  inspection: null
})
const installedVamHubMods = ref([])
const installedVamHubRefreshScheduler = createSourceInstallTaskRefreshScheduler(
  () => refreshInstalledVamHubMods(),
  {
    logMessage: '[VAM-Hub] 安装任务完成后刷新已安装模组失败'
  }
)

const selectedVamHubImportItems = computed(() =>
  sourceModpackImportPreview.value.items.filter(
    (item) =>
      item?.canImport && sourceModpackImportPreview.value.selectedKeys[item.previewKey] === true
  )
)
const canSubmitVamHubSourceModpackImport = computed(
  () => selectedVamHubImportItems.value.length > 0 && !sourceModpackImportPreview.value.installing
)

const isGameFound = computed(() => !!toSafeText(gameRoot.value))
const detectedGameRootPath = computed(() => toSafeText(gameRoot.value))
const detectedGameExecutablePath = computed(() => toSafeText(gameExePath.value))
const canLaunchGame = computed(() => isGameFound.value && !!detectedGameExecutablePath.value)
const aiTranslationConfig = computed(() => resolveAiTranslationConfig(systemConfig.value))
const canUseVamHubAiTranslation = computed(() => isAiTranslationAvailable(systemConfig.value))

const headerStats = computed(() => [])

const headerStatusText = computed(() => {
  if (!installRuleCache.value && installRuleFailure.value) return installRuleFailure.value.label
  if (pathLoading.value) return uiText('ui.detectingFolder')
  return isGameFound.value ? uiText('modBrowser.identified') : uiText('modBrowser.unidentified')
})

const headerStatusType = computed(() => {
  if (!installRuleCache.value && installRuleFailure.value) return 'danger'
  if (pathLoading.value) return 'info'
  return isGameFound.value ? 'success' : 'danger'
})

const headerActions = computed(() => [
  {
    key: 'profile-scheme',
    get label() { return uiText('modBrowser.profiles') }
  },
  {
    key: 'manage',
    get label() { return uiText('modBrowser.manage') },
    tone: 'strong',
    disabled: !isGameFound.value
  },
  {
    key: 'manage-local-mod',
    get label() { return uiText('localMod.title') },
    placement: 'more',
    loading: pathLoading.value,
    disabled: pathLoading.value
  },
  {
    key: 'launch',
    get label() { return uiText('modBrowser.launch') },
    type: 'primary',
    disabled: !canLaunchGame.value
  },
  {
    key: 'open-root',
    get label() { return uiText('modBrowser.openRoot') },
    placement: 'more',
    visible: isGameFound.value
  },
  {
    key: 'scan',
    get label() { return uiText('ui.scanNow') },
    get loadingText() { return uiText('modBrowser.scanning') },
    placement: 'more',
    loading: pathLoading.value,
    disabled: pathLoading.value
  },
  {
    key: 'manual-bind',
    get label() { return uiText('ui.addManually') },
    placement: 'more',
    loading: pathLoading.value,
    disabled: pathLoading.value
  },
  {
    key: 'rule-config',
    get label() { return uiText('ui.editInstallationRules') },
    placement: 'more'
  },
  {
    key: 'cookie',
    label: loginStatus.value.loggedIn ? uiText('ui.updateCookie') : uiText('ui.configureCookie'),
    placement: 'more'
  }
])

function countUntranslatedVamHubMods(list = resources.value) {
  return (Array.isArray(list) ? list : []).filter((item) => !isVamHubCardTranslationResolved(item))
    .length
}

const untranslatedVamHubModCount = computed(() => countUntranslatedVamHubMods(resources.value))
const vamhubFloatingActions = computed(() => {
  if (!canUseVamHubAiTranslation.value || !resources.value.length) {
    return []
  }

  return [
    {
      key: 'translate-current-page',
      label: untranslatedVamHubModCount.value > 0 ? uiText('ui.translateCurrentPage') : uiText('ui.currentPageTranslated'),
      loading: vamhubPageTranslationLoading.value,
      get loadingText() { return uiText('ui.translateCurrentPage') },
      progressCurrent: vamhubPageTranslationProgress.value.current,
      progressTotal: vamhubPageTranslationProgress.value.total,
      disabled: vamhubPageTranslationLoading.value || untranslatedVamHubModCount.value <= 0,
      visible: true
    }
  ]
})

const listItems = computed(() =>
  resources.value.map((item) => {
    const key = getResourceKey(item)
    const translatedTitle = getVamHubTranslatedTitle(item)
    const translatedDescription = getVamHubTranslatedDescription(item)
    const translationResolved = isVamHubCardTranslationResolved(item)
    return {
      id: key,
      title: toSafeText(item.title, uiText('ui.vAMHubResources')),
      translatedTitle,
      subtitle: [item.username, item.version_string].filter(Boolean).join(' / '),
      description: toSafeText(item.tag_line || stripHtml(item.description), uiText('ui.noDescription')),
      translatedDescription,      cover: item.image_url || item.icon_url,
      tags: ['VAM-Hub', item.type, item.category].filter(Boolean),
      downloadCount: formatNumber(item.download_count),
      detailText: '详情',
      installText: isGameFound.value ? '安装' : '下载',
      installingText: isGameFound.value ? '加载中...' : '下载中...',
      installable: true,
      installing: !!installingKeyMap.value[key],
      translateActionText: vamhubItemTranslationLoadingMap.value[key] ? '翻译中...' : '翻译',
      translateHidden: !canUseVamHubAiTranslation.value || translationResolved,
      translateDisabled: !!vamhubItemTranslationLoadingMap.value[key],
      raw: item,
      sourceRecord: item
    }
  })
)

const detailTitle = computed(() =>
  String(packageDetail.value?.title || selectedResource.value?.title || '[Mod]-Vam').trim()
)

const detailFiles = computed(() =>
  (Array.isArray(packageDetail.value?.hubFiles) ? packageDetail.value.hubFiles : []).filter(
    (item) => item?.downloadUrl || item?.urlHosted
  )
)

const dependencyGroups = computed(() => {
  const deps = packageDetail.value?.dependencies || {}
  return {
    direct: Array.isArray(deps.direct) ? deps.direct : [],
    sub: Array.isArray(deps.sub) ? deps.sub : []
  }
})

const detailDescriptionExpanded = ref(false)
const detailDescriptionLong = computed(() => {
  const text = String(translatedDetailDescription.value || '')
  return text.length > 220 || text.split('\n').length > 4
})
watch(
  () => packageDetail.value?.resource_id || packageDetail.value?.title || '',
  () => {
    detailDescriptionExpanded.value = false
  }
)

const detailDependencySections = computed(() => [
  {
    key: 'direct',
    label: t('dialogs.vamDetail.direct'),
    empty: t('dialogs.vamDetail.noDirect'),
    items: dependencyGroups.value.direct
  },
  {
    key: 'sub',
    label: t('dialogs.vamDetail.sub'),
    empty: t('dialogs.vamDetail.noSub'),
    items: dependencyGroups.value.sub
  }
])

const dependencyList = computed(() =>
  Array.isArray(dependencyResult.value?.dependencies) ? dependencyResult.value.dependencies : []
)

const installableDependencyList = computed(() =>
  dependencyList.value.filter((item) => ['need_download', 'upgraded'].includes(item.status))
)

const selectedSourceInstallOption = computed(
  () =>
    sourceInstallModal.value.options.find(
      (item) => String(item?.id || '') === String(sourceInstallModal.value.selectedId || '')
    ) || null
)

const sourceInstallDependencyItems = computed(() => {
  if (sourceInstallModal.value.dependenciesLoading) return []
  const resolved = sourceInstallModal.value.resolvedDependencies
  if (Array.isArray(resolved) && resolved.length) {
    return resolved.map((dep, index) => {
      const packageName = toSafeText(dep.filename || dep.id || dep.packageName, uiText('ui.dependencyValue', { value1: (index + 1) }))
      const meta =
        [toSafeText(dep.dependencyType), toSafeText(dep.licenseType)].filter(Boolean).join(' · ') ||
        '安装时自动匹配版本'
      return {
        key: `${packageName}:${dep.id || dep.dependencyType || index}`,
        name: packageName,
        meta,
        tag: normalizeVamHubDependencyStatus(dep.status),
        raw: dep
      }
    })
  }
  return buildVamHubDependencyPreviewItems(sourceInstallModal.value.detail)
})

const sourceInstallDependencyPreviewItems = computed(() =>
  sourceInstallDependencyItems.value.slice(0, SOURCE_INSTALL_DEPENDENCY_PREVIEW_LIMIT)
)

const sourceInstallDependencyMoreCount = computed(() =>
  Math.max(
    sourceInstallDependencyItems.value.length - sourceInstallDependencyPreviewItems.value.length,
    0
  )
)

const sourceInstallDisplayName = computed(() =>
  toSafeText(sourceInstallModal.value.title, 'VAM-Hub 资源')
)

const sourceInstallDisplaySubtitle = computed(() =>
  toSafeText(
    sourceInstallModal.value.subtitle || sourceInstallModal.value.detail?.resource_id,
    'VAM-Hub'
  )
)

const sourceInstallActionDisabled = computed(
  () =>
    sourceInstallModal.value.confirmLoading ||
    sourceInstallModal.value.dependenciesLoading ||
    !selectedSourceInstallOption.value
)

const showSourceInstallDownloadAction = computed(() => sourceInstallModal.value.mode === 'install')

const VAMHUB_DEPENDENCY_STATUS = Object.freeze({
  need_download: 'install',
  upgraded: 'install',
  queued: 'skipped',
  installed: 'installed',
  no_source: 'manual'
})

const vamHubDialogMeta = computed(() => [
  gamePresentation(gameInfo.value).title || 'Virt a Mate',
  packageDetail.value?.username ? uiText('ui.authorValue', { value1: (packageDetail.value.username) }) : ''
])

const sourceInstallDialogMeta = computed(() => [
  gamePresentation(gameInfo.value).title || 'Virt a Mate',
  sourceInstallDisplaySubtitle.value
])

const vamHubDialogTarget = computed(() => [
  { get label() { return uiText('taskCenter.table.game') }, value: gamePresentation(gameInfo.value).title || 'Virt a Mate' },
  {
    get label() { return uiText('siteDetail.download.writeTo') },
    value: isGameFound.value ? 'AddonPackages（按安装规则）' : '下载目录（不写入游戏）',
    small: true
  }
])

const vamHubDialogNotice = computed(() =>
  isGameFound.value
    ? null
    : {
        tone: 'warning',
        get text() { return uiText('ui.noVaMGameFolderIsSetFilesWillOnlyBe') }
      }
)

const vamHubMainFileColumns = Object.freeze([
  { key: 'type', get label() { return uiText('tools.type') }, width: '96px', muted: true },
  { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' }
])

const vamHubMainFileItems = computed(() =>
  detailFiles.value.map((file, index) => {
    const sizeBytes = toSafeNumber(file.file_size_bytes, parseFileSizeBytes(file.file_size))
    return {
      key: String(file.filename || file.downloadUrl || file.urlHosted || index),
      title: normalizeVamFileName(file.filename || detailTitle.value),
      monoTitle: true,
      sizeBytes,
      sizeText: formatInstallSize(sizeBytes),
      values: {
        type: toSafeText(file.licenseType),
        size: formatInstallSize(sizeBytes)
      }
    }
  })
)

const vamHubDependencyPlan = computed(() => {
  const items = dependencyList.value.map((dep) => {
    const installable = ['need_download', 'upgraded'].includes(dep.status)
    const sizeBytes = toSafeNumber(dep.file_size_bytes, parseFileSizeBytes(dep.file_size))
    return {
      key: String(dep.id || dep.filename),
      name: dep.filename || dep.id,
      meta: [toSafeText(dep.dependencyType), formatInstallSize(sizeBytes)].filter(Boolean).join(' · '),
      status: VAMHUB_DEPENDENCY_STATUS[dep.status] || 'pending',
      statusText: STATUS_TEXT[dep.status] || dep.status,
      checkable: true,
      checked: !!selectedDependencyMap.value[dep.id],
      disabled: !installable
    }
  })
  const progress = resolveProgress.value
  const selectedCount = installableDependencyList.value.filter(
    (dep) => selectedDependencyMap.value[dep.id]
  ).length
  return {
    state: resolvingDependencies.value ? 'resolving' : 'ready',
    progressText: uiText('ui.resolvingValueValueValue', { value1: (progress.resolved_count), value2: (progress.total_discovered || 1), value3: (progress.current_package || detailTitle.value) }),
    summary: resolvingDependencies.value
      ? null
      : items.some((item) => item.status === 'manual')
        ? { get text() { return uiText('ui.someDependenciesHaveNoDownloadSource') }, tone: 'warning' }
        : installableDependencyList.value.length
          ? { text: uiText('ui.selectedValueValueItems', { value1: (selectedCount), value2: (installableDependencyList.value.length) }), tone: 'muted' }
          : items.length
            ? { get text() { return uiText('ui.allRequirementsMet') }, tone: 'success' }
            : null,
    items,
    get emptyText() { return uiText('ui.noDependenciesFound') }
  }
})

const vamHubDependencyTotal = computed(() => {
  const mainBytes = vamHubMainFileItems.value.reduce((sum, item) => sum + item.sizeBytes, 0)
  const selected = installableDependencyList.value.filter(
    (dep) => selectedDependencyMap.value[dep.id]
  )
  const dependencyBytes = selected.reduce(
    (sum, dep) => sum + toSafeNumber(dep.file_size_bytes, parseFileSizeBytes(dep.file_size)),
    0
  )
  return {
    value: formatInstallSize(mainBytes + dependencyBytes) || '—',
    note: uiText('ui.valueMainFilesValueDependencies', { value1: (detailFiles.value.length), value2: (selected.length) })
  }
})

const vamHubDependencyActions = computed(() => [
  {
    key: 'confirm',
    label: isGameFound.value ? uiText('ui.addToInstallationTasks') : uiText('tools.addToDownloads'),
    variant: 'primary',
    disabled: dependencyDialogActionDisabled.value,
    loading: submittingDependencies.value
  }
])

const vamHubOptionColumns = Object.freeze([
  { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' }
])

const sourceInstallDialogItems = computed(() =>
  sourceInstallModal.value.options.map((option) => ({
    key: String(option.id),
    title: option.title || '--',
    monoTitle: true,
    description: option.subtitle || '',
    tags: option.tag ? [{ text: option.tag, tone: 'neutral' }] : [],
    sizeBytes: toSafeNumber(option.fileSize, 0),
    sizeText: formatInstallSize(option.fileSize),
    values: { size: formatInstallSize(option.fileSize) }
  }))
)

const sourceInstallDependencyPlan = computed(() => {
  const progress = sourceInstallModal.value.dependencyResolveProgress || {}
  const download = sourceInstallModal.value.mode === 'download'
  return {
    state: sourceInstallModal.value.dependenciesLoading ? 'resolving' : 'ready',
    count: sourceInstallDependencyItems.value.length,
    progressText: progress.total_discovered
      ? uiText('ui.resolvingValueValueValue', { value1: (progress.resolved_count), value2: (progress.total_discovered), value3: (progress.current_package || sourceInstallDisplayName.value) })
      : '正在解析依赖…',
    summary: sourceInstallDependencyItems.value.length
      ? { text: download ? uiText('ui.resolveAutomaticallyDuringInstallation') : uiText('ui.handleWithTheMainFile'), tone: 'muted' }
      : null,
    items: sourceInstallDependencyPreviewItems.value.map((dependency) => ({
      key: dependency.key,
      name: dependency.name,
      meta: dependency.meta,
      status: dependency.tag === '已安装' ? 'installed' : 'install',
      statusText: dependency.tag
    })),
    get emptyText() { return uiText('ui.thisResourceHasNoAdditionalDependencies') },
    moreText:
      sourceInstallDependencyMoreCount.value > 0
        ? uiText('ui.anotherValueDependenciesWillBeResolvedAutomaticallyDuringExecution', { value1: (sourceInstallDependencyMoreCount.value) })
        : ''
  }
})

const sourceInstallDialogTotal = computed(() => {
  const option = selectedSourceInstallOption.value
  if (!option) return { value: '—', note: '尚未选择文件' }
  return {
    value: formatInstallSize(option.fileSize) || '—',
    note: sourceInstallDependencyItems.value.length ? '依赖大小以安装时为准' : '1 个文件'
  }
})

const sourceInstallDialogActions = computed(() => {
  const resolving = sourceInstallModal.value.dependenciesLoading
  const loading = sourceInstallModal.value.confirmLoading
  if (!showSourceInstallDownloadAction.value) {
    return [
      {
        key: 'primary',
        label: resolving ? uiText('ui.resolvingDependencies') : uiText('tools.download'),
        variant: 'primary',
        disabled: sourceInstallActionDisabled.value,
        loading
      }
    ]
  }
  return [
    {
      key: 'download',
      get label() { return uiText('ui.downloadOnly') },
      variant: 'secondary',
      disabled: sourceInstallActionDisabled.value
    },
    {
      key: 'primary',
      label: resolving ? uiText('ui.resolvingDependencies') : uiText('modBrowser.install'),
      variant: 'primary',
      disabled: sourceInstallActionDisabled.value,
      loading
    }
  ]
})

const dependencyDialogActionDisabled = computed(
  () => resolvingDependencies.value || submittingDependencies.value || !detailFiles.value.length
)

function getInitialGameRoot() {
  return (
    String(
      route.query.gameRoot ||
        route.query.gameRootPath ||
        route.query.clientRootPath ||
        route.query.client_root_path ||
        ''
    ).trim() || String(localStorage.getItem(rootStorageKey.value) || '').trim()
  )
}

function getInitialGameExePath() {
  return (
    String(
      route.query.gameExePath ||
        route.query.exePath ||
        route.query.clientExePath ||
        route.query.client_exe_path ||
        ''
    ).trim() || String(localStorage.getItem(exeStorageKey.value) || '').trim()
  )
}

function persistGameRoot() {
  const value = String(gameRoot.value || '').trim()
  if (value) {
    localStorage.setItem(rootStorageKey.value, value)
  } else {
    localStorage.removeItem(rootStorageKey.value)
  }
  const exePath = String(gameExePath.value || '').trim()
  if (exePath) {
    localStorage.setItem(exeStorageKey.value, exePath)
  } else {
    localStorage.removeItem(exeStorageKey.value)
  }
}

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '--'
  if (number >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}W`
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(number)
}

function formatRating(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number.toFixed(1).replace(/\.0$/, '') : '--'
}

function formatFileSize(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) {
    if (number >= 1024 * 1024 * 1024) return `${(number / 1024 / 1024 / 1024).toFixed(2)} GB`
    if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`
    if (number >= 1024) return `${(number / 1024).toFixed(1)} KB`
    return `${number} B`
  }
  return toSafeText(value, '--')
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeSystemConfig(data) {
  const target = data && typeof data === 'object' ? data : {}
  return {
    ...target,
    aiTranslation: normalizeAiTranslationConfig(target.aiTranslation)
  }
}

function requestSystemConfig() {
  return requestSystemConfigSettings({})
}

async function loadAiSystemConfig() {
  systemConfig.value = normalizeSystemConfig(await requestSystemConfig())
}

function handleSystemConfigUpdated() {
  loadAiSystemConfig().then()
}

function getResourceKey(item = {}) {
  return toSafeText(item.resource_id || item.id || `${item.title}:${item.username}`)
}

function normalizeVamHubTranslationIdentity(item = {}) {
  return String(getResourceKey(item) || item?.title || '')
    .trim()
    .toLowerCase()
}

function buildVamHubTitleTranslationKey(item = {}) {
  return `mod:${normalizeVamHubTranslationIdentity(item)}:title`
}

function buildVamHubSummaryTranslationKey(item = {}) {
  return `mod:${normalizeVamHubTranslationIdentity(item)}:summary`
}

function mergeVamHubTranslationResultMap(resultMap = new Map()) {
  if (!(resultMap instanceof Map) || resultMap.size <= 0) {
    return 0
  }

  const nextTextState = {
    ...vamhubTranslationMap.value
  }
  const nextResolvedState = {
    ...vamhubTranslationResolvedMap.value
  }
  let updatedCount = 0

  resultMap.forEach((text, key) => {
    const safeKey = String(key || '').trim()
    if (!safeKey) {
      return
    }

    nextTextState[safeKey] = String(text || '')
    nextResolvedState[safeKey] = true
    updatedCount += 1
  })

  vamhubTranslationMap.value = nextTextState
  vamhubTranslationResolvedMap.value = nextResolvedState
  return updatedCount
}

function isVamHubTranslationKeyResolved(translationKey = '') {
  return !!vamhubTranslationResolvedMap.value[String(translationKey || '').trim()]
}

function getVamHubTranslatedTitle(item = {}) {
  if (!canUseVamHubAiTranslation.value) {
    return ''
  }

  const original = toSafeText(item?.title)
  const translated = String(
    vamhubTranslationMap.value[buildVamHubTitleTranslationKey(item)] || ''
  ).trim()
  return translated && translated !== original ? translated : ''
}

function getVamHubTranslatedDescription(item = {}) {
  if (!canUseVamHubAiTranslation.value) {
    return ''
  }

  const original = toSafeText(item?.tag_line || stripHtml(item?.description))
  const translated = String(
    vamhubTranslationMap.value[buildVamHubSummaryTranslationKey(item)] || ''
  ).trim()
  return translated && translated !== original ? translated : ''
}

function isVamHubCardTranslationResolved(item = {}) {
  const requiredKeys = []
  if (toSafeText(item?.title)) {
    requiredKeys.push(buildVamHubTitleTranslationKey(item))
  }
  if (toSafeText(item?.tag_line || stripHtml(item?.description))) {
    requiredKeys.push(buildVamHubSummaryTranslationKey(item))
  }

  return (
    requiredKeys.length <= 0 ||
    requiredKeys.every((translationKey) => isVamHubTranslationKeyResolved(translationKey))
  )
}

function buildVamHubTranslationRequestItems(list = [], options = {}) {
  const safeList = Array.isArray(list) ? list : []
  const unresolvedOnly = !!options?.unresolvedOnly
  return safeList.flatMap((item) => {
    const requestItems = []
    const title = toSafeText(item?.title)
    const summary = toSafeText(item?.tag_line || stripHtml(item?.description))
    const resourceId = getResourceKey(item)
    if (!resourceId) {
      return requestItems
    }

    if (title) {
      const titleKey = buildVamHubTitleTranslationKey(item)
      if (!unresolvedOnly || !isVamHubTranslationKeyResolved(titleKey)) {
        requestItems.push({
          id: titleKey,
          text: title,
          kind: 'mod_name',
          context: uiText('ui.gameValueSourceVAMHub', { value1: (gameInfo.value.name || 'Virt a Mate') })
        })
      }
    }

    if (summary) {
      const summaryKey = buildVamHubSummaryTranslationKey(item)
      if (!unresolvedOnly || !isVamHubTranslationKeyResolved(summaryKey)) {
        requestItems.push({
          id: summaryKey,
          text: summary,
          kind: 'mod_summary',
          context: uiText('ui.gameValueResourceValue', { value1: (gameInfo.value.name || 'Virt a Mate'), value2: (title || resourceId) })
        })
      }
    }

    return requestItems
  })
}

async function hydrateVamHubModTranslations(list = resources.value) {
  const safeList = Array.isArray(list) ? list : []
  vamhubTranslationToken += 1
  const currentToken = vamhubTranslationToken

  if (!canUseVamHubAiTranslation.value || !safeList.length) {
    return
  }

  const requestItems = buildVamHubTranslationRequestItems(safeList)
  if (!requestItems.length) {
    return
  }

  try {
    const translatedMap = await queryCachedTextBatchService({
      systemConfig: systemConfig.value,
      source: 'vamhub',
      scene: 'mod_list_card',
      items: requestItems
    })

    if (currentToken !== vamhubTranslationToken || !translatedMap.size) {
      return
    }

    mergeVamHubTranslationResultMap(translatedMap)
  } catch (error) {
    console.warn('[VAM-Hub] 模组翻译缓存读取失败', error)
  }
}

async function translateVamHubMods(list = resources.value, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const edgeOnly = options?.edgeOnly === true
  const shouldApplyResult =
    typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
  const requestItems = buildVamHubTranslationRequestItems(list, {
    unresolvedOnly: true
  })

  if ((!edgeOnly && !canUseVamHubAiTranslation.value) || !requestItems.length) {
    return 0
  }

  const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
  const translatedMap = await translateService({
    systemConfig: systemConfig.value,
    source: 'vamhub',
    scene: 'mod_list_card',
    items: requestItems,
    onChunkSettled: onProgress
      ? ({ chunkResultMap }) => {
          if (!shouldApplyResult()) {
            return
          }
          mergeVamHubTranslationResultMap(chunkResultMap)
          onProgress()
        }
      : null
  })

  if (onProgress) {
    return 0
  }

  if (!shouldApplyResult()) {
    return 0
  }

  return mergeVamHubTranslationResultMap(translatedMap)
}

function buildVamHubAutoTranslationSignature(list = resources.value) {
  return [
    'vamhub',
    query.value.page,
    query.value.effectiveKeyword || query.value.search,
    query.value.pricing,
    query.value.resourceType,
    query.value.sort,
    (Array.isArray(list) ? list : []).map((item) => getResourceKey(item)).join(','),
    aiTranslationConfig.value.targetLanguage
  ].join('|')
}

async function autoTranslateVamHubMods(list = resources.value) {
  const signature = buildVamHubAutoTranslationSignature(list)
  if (
    !signature ||
    vamhubAutoTranslationCompletedSignature.value === signature ||
    vamhubAutoTranslationInFlightSignature.value === signature
  ) {
    return
  }

  const requestItems = buildVamHubTranslationRequestItems(list, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    vamhubAutoTranslationCompletedSignature.value = signature
    return
  }

  vamhubAutoTranslationInFlightSignature.value = signature
  try {
    const translatedCount = await translateVamHubMods(list, {
      edgeOnly: true,
      shouldApplyResult: () => vamhubAutoTranslationInFlightSignature.value === signature
    })
    if (translatedCount > 0 && vamhubAutoTranslationInFlightSignature.value === signature) {
      vamhubAutoTranslationCompletedSignature.value = signature
    }
  } catch (error) {
    console.warn('[VAM-Hub] 模组自动翻译失败', error)
  } finally {
    if (vamhubAutoTranslationInFlightSignature.value === signature) {
      vamhubAutoTranslationInFlightSignature.value = ''
    }
  }
}

function resetVamHubPageTranslationProgress() {
  vamhubPageTranslationProgress.value = {
    current: 0,
    total: 0
  }
}

function updateVamHubPageTranslationProgress(total = 0) {
  vamhubPageTranslationProgress.value = {
    current: Math.max(total - countUntranslatedVamHubMods(resources.value), 0),
    total: Math.max(Number(total || 0), 0)
  }
}

function isExactPackageQuery(value = '') {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+\.(?:latest|\d+)$/i.test(toSafeText(value))
}

function normalizeVamFileName(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

function parseVamPackage(value = '', fallbackVersion = 1) {
  const base = toSafeText(value).replace(/\.var$/i, '')
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 2) {
    return {
      creator: '',
      name: base,
      version: Number(fallbackVersion || 1),
      sourceModKey: base,
      id: base
    }
  }
  const creator = parts[0]
  const last = parts[parts.length - 1]
  const hasVersion = /^\d+$/.test(last) || last.toLowerCase() === 'latest'
  const version = /^\d+$/.test(last) ? Number(last) : Number(fallbackVersion || 1)
  const name = (hasVersion ? parts.slice(1, -1) : parts.slice(1)).join('.')
  const sourceModKey = [creator, name || parts.slice(1).join('.')].filter(Boolean).join('.')
  return {
    creator,
    name: name || parts.slice(1).join('.'),
    version: version || 1,
    sourceModKey,
    id: [sourceModKey, version || 1].filter(Boolean).join('.')
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

function clonePlainObject(value = {}) {
  return JSON.parse(JSON.stringify(value || {}))
}

function hasInstallRuleContent(rule = null) {
  const installRules = Array.isArray(rule?.install_rules)
    ? rule.install_rules
    : Array.isArray(rule?.installRules)
      ? rule.installRules
      : []
  return installRules.length > 0
}

function normalizeInstallRuleFromResponse(response = null) {
  if (!response || typeof response !== 'object') return null
  const rawRule =
    response.ruleJson && typeof response.ruleJson === 'object'
      ? response.ruleJson
      : response.rule_json && typeof response.rule_json === 'object'
        ? response.rule_json
        : null
  if (rawRule) {
    const compiled = compileInstallRuleJson(rawRule)
    return hasInstallRuleContent(compiled) ? compiled : null
  }

  const ruleText = toSafeText(response.ruleJsonText || response.rule_json_text || response.content)
  if (!ruleText) return null

  const parsed = parseInstallRuleJsonText(ruleText)
  const compiled = compileInstallRuleJson(parsed)
  return hasInstallRuleContent(compiled) ? compiled : null
}



function getCurrentAppId() {
  return toSafeNumber(route.query.appId || route.query.appid || route.query.steamAppId, 0)
}

function getCurrentBackendGameId() {
  return toSafeNumber(route.query.gameId || route.query.backendGameId, 0)
}

function getCurrentSourceGameSlug() {
  const rawSlug = toSafeText(
    route.query.sourceSlug || route.query.sourceGameSlug || sourceGameId.value,
    'vam'
  ).toLowerCase()
  if (['game:vam', 'vamhub:vam', 'virt-a-mate', 'virtamate'].includes(rawSlug)) return 'vam'
  return rawSlug || 'vam'
}

function getRuleSourceGameId() {
  const rawId = toSafeText(
    route.query.installRuleGameId ||
      route.query.ruleGameId ||
      route.query.sourceSlug ||
      route.query.sourceGameSlug ||
      route.query.sourceGameId ||
      route.params.id,
    'vam'
  ).toLowerCase()
  if (['game:vam', 'vamhub:vam', 'virt-a-mate', 'virtamate'].includes(rawId)) return 'vam'
  return rawId || 'vam'
}

function buildInstallConfigMatchParams() {
  const appId = getCurrentAppId()
  const backendGameId = getCurrentBackendGameId()
  const sourceId = getRuleSourceGameId()
  const sourceSlug = sourceId
  return {
    sourcePlatform: 'vamhub',
    gameKey: route.query?.gameKey ||  `vamhub:${sourceId}`,
    gameId: backendGameId || null,
    nexusGameId: null,
    domainName: sourceSlug,
    appId: appId || null
  }
}

async function resolveVamHubInstallRule() {
  installRuleCache.value = null
  sharedRuleDocument.value = null
  installRuleFailure.value = null
  installRuleSelection.value = 'public'
  const privateRule = loadPrivateVamhubRule(getRuleSourceGameId())
  if (privateRule) {
    installRuleCache.value = privateRule.ruleJson
    installRuleSelection.value = 'local_override'
    return clonePlainObject(privateRule.ruleJson)
  }
  try {
    const response = await GET_SHARED_INSTALL_RULE(buildInstallConfigMatchParams())
    const matchedRule = normalizeInstallRuleFromResponse(response)
    if (!matchedRule) throw new Error(uiText('ui.thisGameHasNoPublishedPublicInstallationRules'))
    installRuleCache.value = matchedRule
    sharedRuleDocument.value = response.sharedRuleDocument
    return clonePlainObject(matchedRule)
  } catch (error) {
    installRuleFailure.value = describeSharedRuleFailure(error)
    throw error
  }
}

function getPackageIdentifier(record = {}) {
  return toSafeText(record.resource_id || record.packageName || record.filename || record.title)
}

function createEmptySourceInstallModalState() {
  return {
    open: false,
    mode: 'download',
    loading: false,
    confirmLoading: false,
    title: '',
    subtitle: '',
    description: '',
    cover: '',
    sourceLabel: VAMHUB_SOURCE_LABEL,
    optionTitle: '选择文件',
    options: [],
    selectedId: '',
    detail: null,
    dependenciesLoading: false,
    resolvedDependencies: [],
    dependencyResolveProgress: {
      resolved_count: 0,
      total_discovered: 0,
      current_package: ''
    }
  }
}

function resolveVamHubDownloadFiles(detail = {}) {
  return (Array.isArray(detail?.hubFiles) ? detail.hubFiles : []).filter(
    (item) => item?.downloadUrl || item?.urlHosted
  )
}

function normalizeVamHubFileOption(file = {}, detail = {}) {
  const fileName = toSafeText(file.filename || file.fileName || detail.title, 'VAM-Hub 资源')
  const downloadUrl = toSafeText(file.downloadUrl || file.download_url || file.urlHosted)
  if (!downloadUrl) return null
  return {
    id: toSafeText(fileName || downloadUrl, downloadUrl),
    title: normalizeVamFileName(fileName),
    subtitle: toSafeText(file.licenseType || detail.category || detail.username, uiText('ui.vAMHubFile')),
    tag: toSafeText(detail.category || file.licenseType, 'VAR'),
    fileSize: toSafeNumber(file.file_size_bytes, parseFileSizeBytes(file.file_size)),
    file: {
      ...file,
      filename: normalizeVamFileName(fileName),
      downloadUrl,
      title: detail.title,
      category: detail.category,
      resource_id: detail.resource_id
    }
  }
}

function buildVamHubFileOptions(detail = {}) {
  return resolveVamHubDownloadFiles(detail)
    .map((file) => normalizeVamHubFileOption(file, detail))
    .filter(Boolean)
}

async function closeSourceInstallModal(force = false) {
  if (sourceInstallModal.value.confirmLoading && !force) return
  const packageName = sourceInstallResolvePackageName.value
  if (packageName) {
    sourceInstallResolvePackageName.value = ''
    try {
      await cancelResolveVamHubDependencies({ packageName })
    } catch {
      // ignore
    }
  }
  sourceInstallModal.value = createEmptySourceInstallModalState()
  publishVamHubAiPageContext()
}

function handleSourceInstallDialogAction(key) {
  if (key === 'download') {
    confirmVamHubSourceInstall('download')
    return
  }
  confirmVamHubSourceInstall(showSourceInstallDownloadAction.value ? 'install' : 'download')
}

function handleSourceInstallOptionSelect(id = '') {
  sourceInstallModal.value = {
    ...sourceInstallModal.value,
    selectedId: String(id || '').trim()
  }
  publishVamHubAiPageContext()
}

function normalizeVamHubDependencyStatus(value = '') {
  const text = toSafeText(value)
  return STATUS_TEXT[text] || text || uiText('taskCenter.detail.dependency')
}

function buildVamHubDependencyPreviewItems(detail = {}) {
  const dependencies = detail?.dependencies || {}
  const direct = Array.isArray(dependencies?.direct) ? dependencies.direct : []
  const sub = Array.isArray(dependencies?.sub) ? dependencies.sub : []
  return [...direct, ...sub]
    .map((item, index) => {
      const packageName = toSafeText(
        item?.packageName || item?.filename || item?.resource_id || item?.id,
        uiText('ui.dependencyValue', { value1: (index + 1) })
      )
      return {
        key: `${packageName}:${item?.dependencyType || item?.licenseType || index}`,
        name: packageName,
        meta:
          [toSafeText(item?.licenseType || item?.version), toSafeText(item?.dependencyType)]
            .filter(Boolean)
            .join(' · ') || '安装时自动匹配版本',
        tag: normalizeVamHubDependencyStatus(item?.status || item?.dependencyType || item?.type)
      }
    })
    .filter((item) => item.name)
}

function normalizeVamHubContextFile(file = {}) {
  const fileName = normalizeVamFileName(file.filename || file.fileName || file.name)
  const downloadUrl = toSafeText(file.downloadUrl || file.download_url || file.urlHosted)
  return {
    fileId: toSafeText(file.id || file.fileId || fileName || downloadUrl),
    fileName,
    fileSize: toSafeNumber(file.file_size_bytes, parseFileSizeBytes(file.file_size)),
    downloadAvailable: Boolean(downloadUrl),
    downloadUrl
  }
}

function buildVamHubContextMod() {
  const detail = packageDetail.value || selectedResource.value || {}
  const modId = getPackageIdentifier(detail)
  if (!modId) return {}

  const files = resolveVamHubDownloadFiles(detail).map((file) => normalizeVamHubContextFile(file))
  const selectedOption = selectedSourceInstallOption.value
  const selectedFile = selectedOption?.file ? normalizeVamHubContextFile(selectedOption.file) : null

  return {
    source: 'vamhub',
    modId,
    id: modId,
    resourceId: toSafeText(detail.resource_id || detail.resourceId || modId),
    packageName: toSafeText(detail.packageName || detail.title || modId),
    name: toSafeText(detail.title || detail.name || modId),
    title: toSafeText(detail.title || detail.name || modId),
    author: toSafeText(detail.username || detail.author),
    version: toSafeText(detail.version_string || detail.version),
    selectedFileId: toSafeText(selectedOption?.id || selectedFile?.fileId),
    selectedFileName: toSafeText(selectedOption?.title || selectedFile?.fileName),
    downloadAvailable: files.some((file) => file.downloadAvailable),
    dependencyCount: dependencyGroups.value.direct.length + dependencyGroups.value.sub.length,
    files,
    selectedFile
  }
}

function publishVamHubAiPageContext() {
  const sourceId = getRuleSourceGameId()
  const sourceSlug = getCurrentSourceGameSlug()
  const contextMod = buildVamHubContextMod()
  return aiPageContextProvider.update({
    game: {
      source: 'vamhub',
      name: gameInfo.value.name,
      englishName: gameInfo.value.englishName,
      sourceGameId: sourceId,
      sourceSlug,
      gameId: String(getCurrentBackendGameId() || ''),
      appId: String(getCurrentAppId() || ''),
      gameRootConfigured: isGameFound.value,
      bindingConfigured: isGameFound.value,
      installRoot: detectedGameRootPath.value,
      gameRoot: detectedGameRootPath.value,
      gameRootPath: detectedGameRootPath.value,
      clientRootPath: detectedGameRootPath.value,
      executableFile: detectedGameExecutablePath.value,
      clientExePath: detectedGameExecutablePath.value,
      gameExePath: detectedGameExecutablePath.value
    },
    search: {
      keyword: toSafeText(query.value.search),
      sort: toSafeText(query.value.sort),
      page: Number(query.value.page || pagination.value.current || 1),
      pageSize: Number(query.value.pageSize || 24),
      filters: {
        pricing: toSafeText(query.value.pricing),
        resourceType: toSafeText(query.value.resourceType),
        sourceGameId: sourceId,
        sourceSlug
      }
    },
    mod: contextMod,
    install: {
      bindingConfigured: isGameFound.value,
      ruleConfigured: Boolean(installRuleCache.value),
      installRoot: detectedGameRootPath.value
    },
    auth: {
      source: 'vamhub',
      status: loginStatus.value.loggedIn ? 'configured' : 'missing_cookie',
      configured: loginStatus.value.loggedIn === true,
      required: true,
      credentialType: 'cookie'
    },
    sourceState: {
      source: 'vamhub',
      status: 'active',
      label: 'VAM-Hub',
      configured: loginStatus.value.loggedIn === true,
      summary: loginStatus.value.loggedIn ? uiText('ui.vAMHubCookieConfigured') : uiText('ui.vAMHubCookieNotConfigured')
    }
  })
}

async function loadPackages(page = query.value.page) {
  loading.value = true
  try {
    const { effectiveKeyword, ...baseQuery } = query.value
    const payload = {
      ...baseQuery,
      search: effectiveKeyword || query.value.search,
      page
    }
    const result = await browseVamHubPackages({
      ...payload
    })
    resources.value = Array.isArray(result.resources) ? result.resources : []
    pagination.value = {
      current: Number(result.pagination?.current_page || page),
      pages: Math.max(1, Number(result.pagination?.total_pages || 1)),
      total: Number(result.pagination?.total_found || 0)
    }
    query.value.page = page
  } catch (error) {
    resources.value = []
    pagination.value = { current: page, pages: 1, total: 0 }
    $message.error(error?.message || 'VAM-Hub 资源列表加载失败')
  } finally {
    loading.value = false
    publishVamHubAiPageContext()
  }
}

async function handleSearch() {
  const currentToken = ++vamhubSearchResolveToken
  const keyword = toSafeText(query.value.search)
  if (isExactPackageQuery(keyword)) {
    query.value.effectiveKeyword = ''
    openPackageDetail({ packageName: keyword, title: keyword })
    return
  }
  const resolvedKeyword = await resolveEdgeSearchKeyword({
    keyword,
    source: 'vamhub',
    scene: 'mod_search_keyword',
    systemConfig: systemConfig.value,
    context: 'VAM-Hub 资源搜索'
  })
  if (currentToken !== vamhubSearchResolveToken || toSafeText(query.value.search) !== keyword) {
    return
  }
  query.value.search = keyword
  query.value.effectiveKeyword = resolvedKeyword.effectiveKeyword
  loadPackages(1)
}

function handleReset() {
  vamhubSearchResolveToken += 1
  query.value.search = ''
  query.value.effectiveKeyword = ''
  query.value.pricing = 'free'
  query.value.resourceType = ''
  query.value.sort = 'last_update'
  loadPackages(1)
}

function handlePricingChange(value) {
  query.value.pricing = value
  loadPackages(1)
}

function handleResourceTypeChange(value) {
  query.value.resourceType = value
  loadPackages(1)
}

function handleSortChange(value) {
  query.value.sort = value
  loadPackages(1)
}

function handlePageChange(page) {
  loadPackages(page)
}

function handleOpenListItem(item = {}) {
  openModPage(item.sourceRecord || item.raw || item)
}

function openModPage(record = {}) {
  const resourceId = toSafeText(
    record?.resource_id || record?.resourceId || record?.id || record?.packageName
  )
  if (!resourceId) {
    $message.warning(uiMessage('ui.thisResourceHasNoDetailsLink'))
    return
  }

  const ruleSourceGameId = getRuleSourceGameId()
  const sourceSlug = getCurrentSourceGameSlug()
  const title = toSafeText(record?.title, 'VAM-Hub 资源')
  const author = toSafeText(record?.username || record?.author)

  router.push(
    buildGameSiteDetailRoute({
      url: `https://hub.virtamate.com/resources/${encodeURIComponent(resourceId)}/`,
      title,
      subtitle: author ? uiText('ui.authorValueVariant2', { value1: (author) }) : uiText('ui.resourceIDValue', { value1: (resourceId) }),
      source: 'VAM-Hub',
      sourceKey: 'vamhub',
      cover: toSafeText(record?.image_url || record?.icon_url),
      backPath: route.fullPath,
      gameId: String(getCurrentBackendGameId() || ''),
      gameName: toSafeText(gameInfo.value.name, 'Virt a Mate'),
      sourceGameId: ruleSourceGameId,
      sourceSlug,
      domainName: sourceSlug,
      appId: String(getCurrentAppId() || ''),
      modId: resourceId,
      modName: title,
      author
    })
  )
}

async function openPackageDetail(record = {}) {
  selectedResource.value = record
  detailDrawerOpen.value = true
  packageDetail.value = null
  packageBasicLoading.value = true
  packageDetailLoading.value = false
  const packageName = getPackageIdentifier(record)
  try {
    const basic = await getVamHubPackageBasic({ packageName })
    packageDetail.value = basic
    packageBasicLoading.value = false
    packageDetailLoading.value = true
    const detail = await getVamHubPackageDetail({ packageName })
    packageDetail.value = detail
  } catch (error) {
    $message.error(error?.message || 'VAM-Hub 资源详情加载失败')
  } finally {
    packageBasicLoading.value = false
    packageDetailLoading.value = false
    publishVamHubAiPageContext()
  }
}

async function loadVamHubDetailForInstall(record = {}) {
  const packageName = getPackageIdentifier(record)
  if (!packageName) {
    throw new Error(uiText('ui.resourceIdentifierMissingCannotLoadDownloadFiles'))
  }
  return await getVamHubPackageDetail({ packageName })
}

function recordHasResolvedDependencies(record = {}) {
  if (!record?.hubFiles) return false
  const deps = record?.dependencies
  if (!deps) return false
  if (Array.isArray(deps)) return deps.length > 0
  const direct = Array.isArray(deps.direct) ? deps.direct : []
  const sub = Array.isArray(deps.sub) ? deps.sub : []
  return direct.length > 0 || sub.length > 0
}

async function openVamHubSourceInstallModal(record = {}, selectedFileId = '') {
  const key = getResourceKey(record)
  if (installingKeyMap.value[key]) return
  installingKeyMap.value = { ...installingKeyMap.value, [key]: true }
  try {
    // 列表摘要(record)有 hubFiles 但没有依赖页解析结果，必须重新拉完整详情；
    // 仅当 record 已含解析过的依赖(direct/sub)时才复用，避免重复请求
    const detail = recordHasResolvedDependencies(record)
      ? record
      : await loadVamHubDetailForInstall(record)
    const options = buildVamHubFileOptions(detail)
    if (!options.length) {
      throw new Error(uiText('ui.thisResourceHasNoDownloadableVarFiles'))
    }
    packageDetail.value = detail
    selectedResource.value = record
    const targetSelectedId =
      (selectedFileId && options.find((item) => String(item.id) === String(selectedFileId))?.id) ||
      options[0]?.id ||
      ''
    sourceInstallModal.value = {
      ...createEmptySourceInstallModalState(),
      open: true,
      mode: isGameFound.value ? 'install' : 'download',
      title: toSafeText(detail.title || record.title, uiText('ui.vAMHubResources')),
      subtitle: toSafeText(detail.username || record.username || 'VAM-Hub'),
      description: stripHtml(detail.description || record.description || record.tag_line),
      cover: toSafeText(detail.image_url || detail.icon_url || record.image_url || record.icon_url),
      options,
      selectedId: String(targetSelectedId || '').trim(),
      detail: null,
      dependenciesLoading: true,
      resolvedDependencies: [],
      dependencyResolveProgress: {
        resolved_count: 0,
        total_discovered: 0,
        current_package: ''
      }
    }
    publishVamHubAiPageContext()
    resolveSourceInstallDependencies(detail, record).then()
  } catch (error) {
    $message.error(error?.message || '读取下载文件失败')
  } finally {
    const next = { ...installingKeyMap.value }
    delete next[key]
    installingKeyMap.value = next
  }
}

async function resolveSourceInstallDependencies(detail = {}, record = {}) {
  const packageName = toSafeText(
    detail?.resource_id ||
      detail?.packageName ||
      getPackageIdentifier(detail) ||
      getPackageIdentifier(record)
  )
  if (!packageName) {
    sourceInstallModal.value = {
      ...sourceInstallModal.value,
      dependenciesLoading: false
    }
    return
  }

  // 复用已加载的主包 detail（含 HTML 依赖页），避免 resolveDependencies 重复 fetch 主包
  // 按 AGENTS.md 第 5 节要求，IPC 传参前转纯 JSON
  const plainMainDetail =
    detail && typeof detail === 'object' ? JSON.parse(JSON.stringify(detail)) : null

  sourceInstallResolvePackageName.value = packageName
  try {
    const result = await resolveVamHubDependencies({
      packageName,
      gameRoot: getOptionalGameRoot(),
      maxDepth: 3,
      includeSubDependencies: true,
      mainDetail: plainMainDetail
    })
    if (sourceInstallResolvePackageName.value !== packageName) return
    const dependencies = Array.isArray(result?.dependencies) ? result.dependencies : []
    sourceInstallModal.value = {
      ...sourceInstallModal.value,
      dependenciesLoading: false,
      resolvedDependencies: dependencies
    }
    publishVamHubAiPageContext()
  } catch (error) {
    if (sourceInstallResolvePackageName.value !== packageName) return
    if (error?.message !== 'CANCELLED') {
      console.warn('[VAM-Hub] 下载弹窗依赖解析失败', error)
    }
    // 失败时用主包 detail 的 dependencies 作为 fallback，至少展示 direct/sub 依赖，避免右栏空白
    const fallbackDeps = buildVamHubDependencyPreviewItems(plainMainDetail).map((item) => ({
      id: item.key,
      filename: item.name,
      packageName: item.name,
      dependencyType: item.meta,
      licenseType: '',
      status: 'need_download',
      download_url: '',
      file_size: '',
      file_size_bytes: 0,
      resource_id: '',
      ...item.raw
    }))
    sourceInstallModal.value = {
      ...sourceInstallModal.value,
      dependenciesLoading: false,
      resolvedDependencies: fallbackDeps
    }
  } finally {
    if (sourceInstallResolvePackageName.value === packageName) {
      sourceInstallResolvePackageName.value = ''
    }
  }
}

function handleInstallFromList(item = {}) {
  openVamHubSourceInstallModal(item.sourceRecord || item.raw || item).then()
}

async function handleTranslateVamHubCurrentPage() {
  if (vamhubPageTranslationLoading.value) {
    return
  }

  const requestItems = buildVamHubTranslationRequestItems(resources.value, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    $message.info(uiMessage('ui.modsOnThisPageTranslated'))
    return
  }

  const totalCount = countUntranslatedVamHubMods(resources.value)
  updateVamHubPageTranslationProgress(totalCount)
  vamhubPageTranslationLoading.value = true
  try {
    await waitForUiRender()
    await translateVamHubMods(resources.value, {
      onProgress: () => {
        updateVamHubPageTranslationProgress(totalCount)
      }
    })
    const completedCount = Math.max(totalCount - countUntranslatedVamHubMods(resources.value), 0)
    if (completedCount > 0) {
      $message.success(uiMessage('ui.translatedValueValueModsOnThisPage', { value1: (completedCount), value2: (totalCount) }))
      return
    }
    $message.info(uiMessage('ui.noNewTranslationsForThisPage'))
  } catch (error) {
    console.error('[VAM-Hub] 当前页模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateThisPageValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    vamhubPageTranslationLoading.value = false
    resetVamHubPageTranslationProgress()
  }
}

async function handleTranslateVamHubSingleMod(card = {}) {
  const rawItem = card?.raw || card
  const itemKey = getResourceKey(rawItem)
  if (!itemKey) {
    return
  }

  const requestItems = buildVamHubTranslationRequestItems([rawItem], {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    return
  }

  vamhubItemTranslationLoadingMap.value = {
    ...vamhubItemTranslationLoadingMap.value,
    [itemKey]: true
  }

  try {
    const translatedMap = await translateTextBatchService({
      systemConfig: systemConfig.value,
      source: 'vamhub',
      scene: 'mod_list_card',
      items: requestItems
    })

    const translatedCount = mergeVamHubTranslationResultMap(translatedMap)
    if (translatedCount > 0) {
      $message.success(uiMessage('ui.modTranslationComplete'))
    } else {
      $message.info(uiMessage('ui.noNewTranslationsForThisMod'))
    }
  } catch (error) {
    console.error('[VAM-Hub] 单模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateModValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    vamhubItemTranslationLoadingMap.value = {
      ...vamhubItemTranslationLoadingMap.value,
      [itemKey]: false
    }
  }
}

function handleVamHubFloatingAction(action = {}) {
  const actionKey = String(action?.key || '').trim()
  if (actionKey === 'translate-current-page') {
    handleTranslateVamHubCurrentPage().then()
  }
}

function getOptionalGameRoot() {
  const root = toSafeText(gameRoot.value)
  persistGameRoot()
  return root
}

async function resolveDownloadUrlOrThrow(downloadUrl = '') {
  const rawUrl = toSafeText(downloadUrl)
  if (!rawUrl) {
    throw new Error(uiText('ui.noUsableDownloadLinkWasReturned'))
  }
  const result = await resolveVamHubDownloadUrl({ downloadUrl: rawUrl })
  if (result?.success === false) {
    throw new Error(result.message || uiText('ui.couldNotResolveTheDownloadLinkSignInMayBe'))
  }
  return toSafeText(result?.downloadUrl, rawUrl)
}

async function buildInstallEntry(source = {}, options = {}) {
  const role = options.role || 'main'
  const dependencyType = options.dependencyType || source.dependencyType || ''
  const installRule =
    options.installRule && typeof options.installRule === 'object' ? options.installRule : {}
  const fileName = normalizeVamFileName(source.filename || source.fileName || source.packageName)
  const parsed = parseVamPackage(fileName || source.packageName, source.version)
  const displayName = toSafeText(
    source.displayName || source.title || source.packageName || source.filename || parsed.id,
    'VAM-Hub 资源'
  )
  const downloadUrl = await resolveDownloadUrlOrThrow(
    source.download_url || source.downloadUrl || source.urlHosted || source.latestUrl
  )
  const fileSize = toSafeNumber(source.file_size_bytes, parseFileSizeBytes(source.file_size))
  const sourceModKey = parsed.sourceModKey || displayName
  const sourceFileId = parsed.id || sourceModKey
  const targetFileName = fileName || `${sourceFileId}.var`
  const appId = getCurrentAppId()
  const backendGameId = getCurrentBackendGameId()
  const ruleSourceGameId = getRuleSourceGameId()
  const sourceGameSlug = getCurrentSourceGameSlug()
  const sourceMeta = {
    source: 'vamhub',
    sourceId: ruleSourceGameId,
    sourceSlug: sourceGameSlug,
    appId: appId || '',
    gameId: backendGameId || 0,
    platformLabel: VAMHUB_SOURCE_LABEL,
    resourceId: toSafeText(source.resource_id || packageDetail.value?.resource_id),
    packageName: toSafeText(source.packageName || source.filename || sourceFileId),
    fileName: targetFileName
  }
  const metadata = {
    category: 'vamhub',
    source: 'vamhub',
    sourceType: 'vamhub',
    sourcePlatform: 'vamhub',
    sourceMeta,
    fileName: targetFileName,
    packageName: toSafeText(source.packageName || source.filename || sourceFileId),
    licenseType: toSafeText(source.licenseType),
    resourceId: toSafeText(source.resource_id || packageDetail.value?.resource_id),
    dependencyType,
    tier: toSafeNumber(source.tier, 0)
  }
  const installPayload = {
    source: 'vamhub',
    sourceType: 'vamhub',
    sourcePlatform: 'vamhub',
    sourceAdapter: 'vamhub',
    sourceGameId: ruleSourceGameId,
    gameSourceId: ruleSourceGameId,
    gameSourceSlug: sourceGameSlug,
    sourceGameSlug,
    sourceSlug: sourceGameSlug,
    sourceGameDomain: sourceGameSlug,
    gameSourceDomain: sourceGameSlug,
    appid: appId,
    appId,
    gameId: backendGameId,
    gameName: gameInfo.value.name,
    gameRoot: gameRoot.value,
    gameRootPath: gameRoot.value,
    clientRootPath: gameRoot.value,
    sourceModKey,
    sourceModId: sourceModKey,
    sourceFileId,
    modId: sourceModKey,
    fileId: sourceFileId,
    id: sourceFileId,
    modName: displayName,
    name: targetFileName,
    packageFolderName: sourceModKey || displayName,
    version: parsed.version,
    fileName: targetFileName,
    archiveName: targetFileName,
    fileSize,
    downloadUrl,
    installType: 0,
    taskType: 0,
    usageType: 1,
    typeId: 0,
    cleanupSourceArchiveAfterInstall: true,
    dependencyRole: role,
    dependencyType,
    installRule,
    vamhubInstallRule: installRule,
    sourceInstallRule: installRule,
    ruleSelection: installRuleSelection.value,
    sharedRuleDocument: clonePlainObject(sharedRuleDocument.value),
    sourceMeta,
    metadata
  }

  return {
    item: {
      id: `vamhub:${sourceFileId}`,
      task_name: uiText('ui.vAMHubDownloadValue', { value1: (displayName) }),
      module: '游戏',
      file_type: 'var',
      file_size: fileSize,
      download_url: downloadUrl,
      saveType: 2,
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceGameId: ruleSourceGameId,
      sourceModKey,
      sourceModId: sourceModKey,
      sourceFileId,
      name: displayName,
      version: parsed.version,
      fileName: targetFileName,
      dedupeKey: ['vamhub', ruleSourceGameId, sourceModKey, parsed.version].join(':'),
      showOpenInDownloadList: true,
      fun: { type: 0 }
    },
    meta: {
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      displayName,
      fileName: targetFileName,
      version: parsed.version,
      sourceGameId: ruleSourceGameId,
      sourceMeta,
      artifactKey: `vamhub:${ruleSourceGameId}:${sourceModKey}:${parsed.version}`,
      dependencyRef: {
        dependencyRole: role,
        dependencyType,
        tier: toSafeNumber(source.tier, 0),
        parentPackageId: toSafeText(source.parentPackageId || packageDetail.value?.resource_id)
      },
      installPayload
    }
  }
}

function buildInstallTaskPayload(
  entries = [],
  title = '',
  includeDependencies = false,
  installRule = {}
) {
  const ruleSourceGameId = getRuleSourceGameId()
  return {
    source: 'vamhub',
    sourceAdapter: 'vamhub',
    sourceGameId: ruleSourceGameId,
    gameKey: `vamhub:${ruleSourceGameId}`,
    gameRoot: gameRoot.value,
    title,
    mainItem: entries[0]?.item || {},
    mainMeta: entries[0]?.meta || {},
    items: entries,
    installRule,
    sourceMeta: {
      source: 'vamhub',
      sourceId: sourceGameId.value,
      sourceSlug: getCurrentSourceGameSlug(),
      appId: getCurrentAppId() || '',
      gameId: getCurrentBackendGameId() || 0,
      sourceGameId: ruleSourceGameId,
      platformLabel: VAMHUB_SOURCE_LABEL,
      resourceId: toSafeText(packageDetail.value?.resource_id),
      packageName: toSafeText(packageDetail.value?.title)
    },
    options: {
      autoStart: true,
      includeDependencies
    }
  }
}

function attachInstallRuleToEntries(entries = [], installRule = {}) {
  return entries.map((entry) => ({
    ...entry,
    meta: {
      ...(entry.meta || {}),
      installPayload: {
        ...(entry.meta?.installPayload || {}),
        installRule,
        vamhubInstallRule: installRule,
        sourceInstallRule: installRule,
        ruleSelection: installRuleSelection.value,
        sharedRuleDocument: clonePlainObject(sharedRuleDocument.value)
      }
    }
  }))
}

async function submitEntries(entries = [], title = '', includeDependencies = false) {
  if (!entries.length) {
    throw new Error(uiText('ui.noInstallationItemsToSubmit'))
  }
  const installRule = await resolveVamHubInstallRule()
  const normalizedEntries = attachInstallRuleToEntries(entries, installRule)
  const result = await submitVamHubInstallTask(
    buildInstallTaskPayload(normalizedEntries, title, includeDependencies, installRule)
  )
  $message.success(result?.message || '已加入安装任务')
}

async function downloadVamHubEntriesOnly(entries = [], title = 'VAM-Hub 资源') {
  if (!entries.length) {
    throw new Error(uiText('ui.noDownloadItemsToSubmit'))
  }
  // 不用 addDownloadBatch：批次内任一文件下载失败会触发 runBatchErrorHook，
  // 把整批（含主文件）静默移除且无提示。VAM-Hub 主文件 + 多个依赖应各自独立下载，
  // 单个依赖失败不影响其他文件（与 vam-box 的逐包下载一致）。
  let added = 0
  let duplicated = 0
  for (const entry of entries) {
    const preferredFileName = String(entry?.item?.fileName || entry?.meta?.fileName || '').trim()
    const item = {
      ...(entry.item || {}),
      showOpenInDownloadList: true,
      downloadPurpose: 'download_only',
      ...(preferredFileName ? { preferredFileName } : {})
    }
    const created = downloadStore.addDownloadItem(item, {
      meta: entry.meta
    })
    if (created) {
      added += 1
    } else {
      duplicated += 1
    }
  }
  if (!added) {
    throw new Error(duplicated ? uiText('ui.downloadTaskAlreadyExists') : uiText('ui.couldNotAddToTheDownloadQueue'))
  }
  const extra = duplicated ? uiText('ui.valueAlreadyQueued', { value1: (duplicated) }) : ''
  $message.success(uiMessage('ui.addedValueFilesToTheDownloadQueueValueValue', { value1: (added), value2: (extra), value3: (title) }))
}

async function handleDownloadFile(file = {}) {
  const detail = packageDetail.value || selectedResource.value || {}
  const option = normalizeVamHubFileOption(file, detail)
  openVamHubSourceInstallModal(detail, option?.id || '').then()
}

async function confirmVamHubSourceInstall(action = 'install') {
  const selected =
    sourceInstallModal.value.options.find(
      (item) => String(item?.id || '') === String(sourceInstallModal.value.selectedId || '')
    ) || null
  if (!selected?.file) {
    $message.warning(uiMessage('ui.selectAnAvailableFile'))
    return
  }
  if (sourceInstallModal.value.dependenciesLoading) {
    $message.warning(uiMessage('ui.dependenciesAreBeingResolvedPleaseWait'))
    return
  }

  getOptionalGameRoot()
  sourceInstallModal.value = {
    ...sourceInstallModal.value,
    confirmLoading: true
  }

  try {
    const detail = sourceInstallModal.value.detail || {}
    const mainEntry = await buildInstallEntry(
      {
        ...selected.file,
        title: detail.title,
        category: detail.category,
        resource_id: detail.resource_id
      },
      { role: 'main' }
    )
    const installableDependencies = (sourceInstallModal.value.resolvedDependencies || []).filter(
      (dep) =>
        ['need_download', 'upgraded'].includes(dep.status) && (dep.download_url || dep.downloadUrl)
    )
    const dependencyEntries = await Promise.all(
      installableDependencies.map((dep) =>
        buildInstallEntry(dep, {
          role: 'dependency',
          dependencyType: dep.dependencyType
        })
      )
    )
    const entries = [mainEntry, ...dependencyEntries]
    const title = toSafeText(detail.title || selected.title, 'VAM-Hub 资源')
    if (action === 'download' || !isGameFound.value) {
      await downloadVamHubEntriesOnly(entries, title)
    } else {
      await submitEntries(
        entries,
        uiText('ui.vAMHubInstallationValueValue', { value1: (title), value2: (dependencyEntries.length ? `（含 ${dependencyEntries.length} 个依赖）` : '') }),
        dependencyEntries.length > 0
      )
    }
    closeSourceInstallModal(true)
  } catch (error) {
    $message.error(error?.message || (isGameFound.value ? '加入安装任务失败' : '加入下载队列失败'))
    sourceInstallModal.value = {
      ...sourceInstallModal.value,
      confirmLoading: false
    }
  }
}

function toggleDependencySelection(id = '', checked = false) {
  selectedDependencyMap.value = {
    ...selectedDependencyMap.value,
    [id]: checked
  }
}

async function openDependencyModal() {
  const root = getOptionalGameRoot()
  const packageName = getPackageIdentifier(packageDetail.value || selectedResource.value || {})
  if (!packageName) {
    $message.warning(uiMessage('ui.resourceIdentifierMissingCannotResolveDependencies'))
    return
  }
  dependencyModalOpen.value = true
  resolvingDependencies.value = true
  dependencyResult.value = null
  selectedDependencyMap.value = {}
  resolveProgress.value = { resolved_count: 0, total_discovered: 0, current_package: packageName }
  try {
    const result = await resolveVamHubDependencies({
      packageName,
      gameRoot: root,
      maxDepth: 3,
      includeSubDependencies: true
    })
    dependencyResult.value = result
    const nextSelected = {}
    ;(result.dependencies || []).forEach((item) => {
      nextSelected[item.id] = ['need_download', 'upgraded'].includes(item.status)
    })
    selectedDependencyMap.value = nextSelected
  } catch (error) {
    if (error?.message !== 'CANCELLED') {
      $message.error(error?.message || '依赖解析失败')
    }
  } finally {
    resolvingDependencies.value = false
  }
}

function handleVamHubDependencyDialogClose() {
  if (submittingDependencies.value) return
  closeDependencyModal()
}

async function closeDependencyModal() {
  const packageName = getPackageIdentifier(packageDetail.value || selectedResource.value || {})
  if (resolvingDependencies.value && packageName) {
    await cancelResolveVamHubDependencies({ packageName })
  }
  dependencyModalOpen.value = false
}

async function confirmDependencyInstall() {
  getOptionalGameRoot()
  submittingDependencies.value = true
  try {
    const mainFiles = detailFiles.value
    if (!mainFiles.length) {
      throw new Error(uiText('ui.theMainResourceHasNoDownloadableVarFile'))
    }
    const selectedDependencies = dependencyList.value.filter(
      (item) =>
        selectedDependencyMap.value[item.id] && ['need_download', 'upgraded'].includes(item.status)
    )
    const mainEntries = await Promise.all(
      mainFiles.map((file) =>
        buildInstallEntry(
          {
            ...file,
            title: packageDetail.value?.title,
            category: packageDetail.value?.category,
            resource_id: packageDetail.value?.resource_id
          },
          { role: 'main' }
        )
      )
    )
    const dependencyEntries = await Promise.all(
      selectedDependencies.map((dep) =>
        buildInstallEntry(dep, {
          role: 'dependency',
          dependencyType: dep.dependencyType
        })
      )
    )
    const entries = [...mainEntries, ...dependencyEntries]
    if (isGameFound.value) {
      await submitEntries(entries, uiText('ui.vAMHubQuickInstallationValue', { value1: (detailTitle.value) }), true)
    } else {
      await downloadVamHubEntriesOnly(entries, detailTitle.value)
    }
    dependencyModalOpen.value = false
  } catch (error) {
    $message.error(error?.message || (isGameFound.value ? '加入安装任务失败' : '加入下载队列失败'))
  } finally {
    submittingDependencies.value = false
  }
}

function openCookieModal() {
  cookieInput.value = ''
  cookieModalOpen.value = true
}

async function saveCookie() {
  cookieSaving.value = true
  try {
    loginStatus.value = await saveVamHubAuthCookie({ cookie: cookieInput.value })
    publishVamHubAiPageContext()
    cookieModalOpen.value = false
    $message.success(loginStatus.value.loggedIn ? 'VAM-Hub Cookie 已保存' : 'VAM-Hub Cookie 已清空')
  } catch (error) {
    $message.error(error?.message || 'VAM-Hub Cookie 保存失败')
  } finally {
    cookieSaving.value = false
  }
}

function openProfileSchemeModal() {
  profileConfigModal.value.open = true
}

function closeProfileSchemeModal() {
  profileConfigModal.value.open = false
}

function openCreateProfileModal() {
  createProfileModal.value = { open: true, confirmLoading: false, name: '' }
}

function closeCreateProfileModal() {
  if (createProfileModal.value.confirmLoading) return
  createProfileModal.value = { open: false, confirmLoading: false, name: '' }
}

async function confirmCreateProfileModal() {
  const validation = vamhubProfileState.validateNewProfileName(createProfileModal.value.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  createProfileModal.value.confirmLoading = true
  try {
    vamhubProfileState.ensureProfile(validation.name, { select: false })
    $message.success(uiMessage('ui.profileCreatedValue', { value1: (validation.name) }))
    createProfileModal.value = { open: false, confirmLoading: false, name: '' }
  } catch (error) {
    console.error('新增 VAM-Hub 配置失败', error)
    createProfileModal.value = { ...createProfileModal.value, confirmLoading: false }
    $message.error(uiMessage('ui.couldNotCreateProfileValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

async function handleInlineCreateProfile(name = '') {
  createProfileModal.value = { ...createProfileModal.value, name, confirmLoading: false }
  await confirmCreateProfileModal()
}

async function handleProfileRename(payload = {}) {
  if (profileSwitching.value) return
  const currentName = vamhubProfileState.resolveProfileNameInList(payload?.profileName)
  const validation = vamhubProfileState.validateProfileRename(currentName, payload?.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  try {
    const result = await ipcRenderer.invoke('sourceProfile:rename', {
      appId: getCurrentAppId() || 0,
      source: 'vamhub',
      sourceId: getRuleSourceGameId(),
      previousProfile: currentName,
      nextProfile: validation.name,
      endpointType: 0
    })
    if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRenameProfile'))
    vamhubProfileState.renameProfile(currentName, validation.name)
    $message.success(result.message || uiText('ui.renamedToValue', { value1: (validation.name) }))
  } catch (error) {
    console.error('重命名 VAM-Hub 配置失败', error)
    $message.error(uiMessage('ui.couldNotRenameValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

async function handleProfileSwitch(name) {
  if (profileSwitching.value) return
  profileSwitching.value = true
  profileSwitchProgress.value = {
    open: true,
    stage: 'start',
    targetProfile: name,
    fromProfile: vamhubProfileState.activeProfileName.value,
    current: 0,
    total: 0,
    modName: '',
    disabledCount: 0,
    enabledCount: 0
  }

  const onProgress = (_event, data) => {
    if (data.stage === 'start') {
      profileSwitchProgress.value.total = data.totalSteps || 0
    } else if (data.stage === 'disabling' || data.stage === 'enabling') {
      profileSwitchProgress.value.stage = data.stage
      profileSwitchProgress.value.current = data.current || 0
      profileSwitchProgress.value.total = data.total || 0
      profileSwitchProgress.value.modName = data.modName || ''
    } else if (data.stage === 'done') {
      profileSwitchProgress.value.stage = 'done'
      profileSwitchProgress.value.disabledCount = data.disabledCount || 0
      profileSwitchProgress.value.enabledCount = data.enabledCount || 0
    }
  }
  ipcRenderer.on('sourceProfile:switchProgress', onProgress)

  try {
    const ruleSourceGameId = getRuleSourceGameId()
    const result = await ipcRenderer.invoke('sourceProfile:switch', {
      appId: getCurrentAppId() || 0,
      source: 'vamhub',
      sourceId: ruleSourceGameId,
      targetProfile: name,
      currentProfile: vamhubProfileState.activeProfileName.value,
      endpointType: 0
    })
    if (!result?.success) {
      throw new Error(result?.message || uiText('ui.someOperationsFailedWhileSwitchingProfiles'))
    }
    vamhubProfileState.setSelectedProfile(name)
    await refreshInstalledVamHubMods()
    $message.success(result.message || uiText('ui.switchedToProfileValue', { value1: (vamhubProfileState.activeProfileName.value) }))
  } catch (error) {
    console.error('切换配置方案失败', error)
    $message.error(uiMessage('ui.couldNotSwitchValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  } finally {
    ipcRenderer.removeListener('sourceProfile:switchProgress', onProgress)
    profileSwitching.value = false
    setTimeout(() => {
      profileSwitchProgress.value.open = false
    }, 600)
  }
}

function handleProfileDelete(name) {
  const resolvedName = vamhubProfileState.resolveProfileNameInList(name)
  if (resolvedName === vamhubProfileState.defaultProfileName.value) return
  if (
    String(resolvedName || '').toLowerCase() ===
    String(vamhubProfileState.activeProfileName.value || '').toLowerCase()
  ) {
    $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
    return
  }
  Modal.confirm({
    get title() { return uiText('ui.deleteThisProfile') },
    content: uiText('ui.deletingProfileValueDisablesAndUninstallsAllItsModsAnd', { value1: (resolvedName) }),
    get okText() { return uiText('ui.deleteProfile') },
    get cancelText() { return uiText('ui.cancel') },
    okButtonProps: { danger: true },
    async onOk() {
      const targetName = vamhubProfileState.resolveProfileNameInList(name)
      if (
        String(targetName || '').toLowerCase() ===
        String(vamhubProfileState.activeProfileName.value || '').toLowerCase()
      ) {
        $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
        return
      }
      const deleteResult = await ipcRenderer.invoke('sourceProfile:delete', {
        appId: getCurrentAppId() || 0,
        source: 'vamhub',
        sourceId: getRuleSourceGameId(),
        targetProfile: targetName,
        isDefault: targetName === vamhubProfileState.defaultProfileName.value,
        endpointType: 0
      })
      if (!deleteResult?.success) {
        $message.error(deleteResult?.message || '删除配置失败')
        return
      }
      vamhubProfileState.removeProfile(targetName)
      $message.success(deleteResult.message || uiText('ui.profileDeletedValue', { value1: (resolvedName) }))
    }
  })
}

function buildVamHubSourceModpackSnapshot(items = [], name = '') {
  return buildSourceModpackCreatePayload({
    sourceType: 'vamhub',
    sourceGameId: getRuleSourceGameId(),
    sourceGameSlug: getCurrentSourceGameSlug(),
    sourceGameName: gameInfo.value.name,
    name,
    cover: gameInfo.value.coverImage,
    description: `VAM-Hub Profile：${vamhubProfileState.activeProfileName.value}`,
    items
  })
}

async function prepareVamHubSourceModpackSnapshot(name = '') {
  const records = await refreshInstalledVamHubMods()
  const items = buildVamHubSourceModpackItems(records)
  if (!items.length) throw new Error(uiText('ui.thisVAMHubProfileHasNoValidVarModsTo'))
  return buildVamHubSourceModpackSnapshot(items, name)
}

async function shareVamHubSourceModpack() {
  if (sourceModpackSharing.value) return
  sourceModpackSharing.value = true
  sharingProfileLoading.value = true
  try {
    const snapshot = await prepareVamHubSourceModpackSnapshot()

    const defaultName = `${gameInfo.value.name || 'Virt a Mate'} - ${vamhubProfileState.activeProfileName.value}`
    const shareName = await requestSourceModpackShareName(defaultName)
    if (!shareName) return

    const result = await CREATE_SOURCE_MODPACK({ ...snapshot, name: shareName })
    const shareCode = extractSourceModpackShareCode(result)
    if (!shareCode) {
      throw new Error(uiText('ui.noShareCodeWasReturned'))
    }
    const copied = await copySourceModpackTextToClipboard(shareCode)
    if (copied) {
      $message.success(uiMessage('ui.vAMHubShareCodeCopied'))
    } else {
      $message.warning(uiMessage('ui.vAMHubShareCodeCreatedValue', { value1: (shareCode) }))
    }
  } catch (error) {
    console.error('生成 VAM-Hub 分享码失败', error)
    $message.error(uiMessage('ui.couldNotCreateShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
    sharingProfileLoading.value = false
  }
}

async function updateVamHubSourceModpack() {
  if (sourceModpackSharing.value) return
  sourceModpackSharing.value = true
  sharingProfileLoading.value = true
  try {
    const snapshot = await prepareVamHubSourceModpackSnapshot()
    sourceModpackUpdateModal.value = { open: true, snapshot }
  } catch (error) {
    console.error('准备 VAM-Hub 分享更新失败', error)
    $message.error(uiMessage('ui.couldNotUpdateShareValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
    sharingProfileLoading.value = false
  }
}

function buildVamHubInstalledSourceMeta() {
  const sourceId = getRuleSourceGameId()
  const profileName = vamhubProfileState.activeProfileName.value
  return {
    source: 'vamhub',
    sourceId,
    sourceSlug: getCurrentSourceGameSlug(),
    sourceGameId: sourceId,
    appId: getCurrentAppId() || '',
    gameId: getCurrentBackendGameId() || 0,
    profileName,
    targetProfileName: profileName,
    platformLabel: VAMHUB_SOURCE_LABEL,
    repairUnscopedProfile: true
  }
}

async function refreshInstalledVamHubMods() {
  const profileName = String(vamhubProfileState.activeProfileName.value || 'default')
    .trim()
    .toLowerCase()
  const payload = clonePlainObject({
    appId: getCurrentAppId() || 0,
    endpointType: 0,
    sourceMeta: buildVamHubInstalledSourceMeta()
  })
  const result = await ipcRenderer.invoke('getInstalledModsBySource', payload)
  if (result?.success === false) {
    throw new Error(result.message || uiText('ui.couldNotReadInstalledVAMHubMods'))
  }
  const records = Array.isArray(result?.records) ? result.records : []
  installedVamHubMods.value = records.filter((item) => {
    const recordProfile = String(item?.profile_name || 'default')
      .trim()
      .toLowerCase()
    return recordProfile === profileName && toSafeNumber(item?.is_active ?? item?.isActive, 1) !== 0
  })
  return installedVamHubMods.value
}

function buildVamHubInstallTaskGameKeys() {
  const sourceGameId = getRuleSourceGameId()
  return [sourceGameId ? `vamhub:${sourceGameId}` : '']
}

async function handleSourceInstallTaskUpdated(_event, data = {}) {
  if (
    !shouldRefreshInstalledModsAfterSourceTask(data, 'vamhub', buildVamHubInstallTaskGameKeys(), {
      allowSourceOnly: true
    })
  ) {
    return
  }
  installedVamHubRefreshScheduler.schedule()
}

function buildVamHubSourceModpackItems(records = installedVamHubMods.value, options = {}) {
  const context = {
    sourceGameId: getRuleSourceGameId(),
    sourceGameSlug: getCurrentSourceGameSlug(),
    steamAppId: getCurrentAppId() || '',
    profileName: vamhubProfileState.activeProfileName.value,
    gameRoot: gameRoot.value,
    installRule: options.installRule || {}
  }
  return (Array.isArray(records) ? records : [])
    .map((record) => normalizeVamHubShareItem(record, context, options))
    .filter(Boolean)
    .map((item, index) => ({
      ...item,
      sortIndex: index
    }))
}

function openSourceModpackImportModal() {
  sourceModpackImportModal.value = {
    open: true,
    code: '',
    loading: false
  }
}

function closeSourceModpackImportModal() {
  if (sourceModpackImportModal.value.loading) return
  sourceModpackImportModal.value = {
    open: false,
    code: '',
    loading: false
  }
}

async function confirmVamHubSourceModpackImport() {
  const code = String(sourceModpackImportModal.value.code || '').trim()
  if (!code) {
    $message.warning(uiMessage('ui.enterAShareCode'))
    return
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) {
    $message.warning(uiMessage('ui.invalidShareCodeFormat'))
    return
  }

  sourceModpackImportModal.value = {
    ...sourceModpackImportModal.value,
    loading: true
  }
  try {
    const installRule = await resolveVamHubInstallRule()
    const inspection = await inspectShareImport({
      shareCode: code,
      entryPoint: 'vamhub',
      targetContext: {
        sourcePlatform: 'vamhub',
        sourceGameId: getRuleSourceGameId(),
        sourceGameSlug: getCurrentSourceGameSlug(),
        appId: getCurrentAppId() || 0,
        backendGameId: getCurrentBackendGameId() || 0,
        gameName: gameInfo.value.name,
        gameRoot: getOptionalGameRoot(),
        endpointType: 0,
        profileName: vamhubProfileState.activeProfileName.value,
        installRule
      }
    })
    if (inspection.mode === 'latest') {
      $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
      closeSourceModpackImportModal()
      return
    }
    const items = inspection.canonicalPlan?.items || []
    const selectedKeys = {}
    for (const [index, item] of items.entries()) {
      item.previewKey = `${item.itemKey}:${index}`
      item.canImport = true
      item.status = 'success'
      item.reason = '可导入'
      selectedKeys[item.previewKey] = true
    }
    sourceModpackImportPreview.value = {
      open: true,
      installing: false,
      detail: null,
      items,
      selectedKeys,
      profileName: inspection.profileTargets?.[0]?.profileName || '',
      inspection
    }
    sourceModpackImportModal.value = {
      open: false,
      code: '',
      loading: false
    }
  } catch (error) {
    console.error('读取 VAM-Hub 分享码失败', error)
    $message.error(uiMessage('ui.couldNotImportShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackImportModal.value = {
      ...sourceModpackImportModal.value,
      loading: false
    }
  }
}

function toggleVamHubSourceModpackPreviewItem(item = {}, checked = false) {
  if (!item?.canImport || sourceModpackImportPreview.value.installing) return
  sourceModpackImportPreview.value = {
    ...sourceModpackImportPreview.value,
    selectedKeys: {
      ...sourceModpackImportPreview.value.selectedKeys,
      [item.previewKey]: checked === true
    }
  }
}

function closeVamHubSourceModpackPreview(force = false) {
  if (sourceModpackImportPreview.value.installing && !force) return
  sourceModpackImportPreview.value = {
    open: false,
    installing: false,
    detail: null,
    items: [],
    selectedKeys: {},
    profileName: '',
    inspection: null
  }
}

async function confirmVamHubSourceModpackPreviewImport() {
  if (!canSubmitVamHubSourceModpackImport.value) {
    $message.warning(uiMessage('ui.noVAMHubEntriesAvailableForInstallationTasks'))
    return
  }
  if (!getOptionalGameRoot()) {
    $message.warning(uiMessage('ui.detectTheVAMGameFolderBeforeImportingAShareCode'))
    return
  }

  sourceModpackImportPreview.value = {
    ...sourceModpackImportPreview.value,
    installing: true
  }
  importingProfile.value = true
  try {
    const profileName = sourceModpackImportPreview.value.profileName
    vamhubProfileState.ensureProfile(profileName, { select: false })
    const inspection = sourceModpackImportPreview.value.inspection
    const result = await applyShareImport({
      planToken: inspection?.planToken,
      expectedPlanHash: inspection?.planHash
    })
    $message.success(result.message || '已加入安装任务')
    closeVamHubSourceModpackPreview(true)
  } catch (error) {
    console.error('创建 VAM-Hub 分享码安装任务失败', error)
    $message.error(uiMessage('ui.couldNotCreateInstallationTaskValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    importingProfile.value = false
    if (sourceModpackImportPreview.value.open) {
      sourceModpackImportPreview.value = {
        ...sourceModpackImportPreview.value,
        installing: false
      }
    }
  }
}

async function handleExportToFile() {
  if (sharingProfileLoading.value) return
  sharingProfileLoading.value = true
  try {
    const installRule = await resolveVamHubInstallRule()
    const records = await refreshInstalledVamHubMods()
    const items = buildVamHubSourceModpackItems(records, {
      includeLocalPaths: true,
      installRule
    })
    if (!items.length) {
      $message.warning(uiMessage('ui.thisVAMHubProfileHasNoValidVarModsToVariant2'))
      return
    }

    const sourceGameId = getRuleSourceGameId()
    const sourceGameSlug = getCurrentSourceGameSlug()
    const profileName = vamhubProfileState.activeProfileName.value
    const csm = buildCsmPayload({
      name: `${gameInfo.value.name || 'Virt a Mate'} - ${profileName}`,
      description: `VAM-Hub Profile：${profileName}`,
      cover: gameInfo.value.coverImage,
      primaryGame: {
        gameKey: `vamhub:${sourceGameId}`,
        sourceType: 'vamhub',
        sourceGameId,
        sourceGameSlug,
        sourceGameName: gameInfo.value.name
      },
      items
    })
    csm.checksum = await signCsmPayload(csm)
    openOfflinePackExportDialog({
      profilePayload: csm,
      exportItems: items,
      gameName: gameInfo.value.name || 'Virt a Mate',
      sourcePlatform: 'vamhub',
      sourceGameId,
      sourceGameSlug,
      gameKey: `vamhub:${sourceGameId}`,
      profileName
    })
  } catch (error) {
    console.error('导出 VAM-Hub 离线安装包失败', error)
    $message.error(uiMessage('ui.exportFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sharingProfileLoading.value = false
  }
}

async function handleImportFromFile() {
  try {
    const result = await pickOfflinePackImportFile()
    if (result?.canceled) return
    if (!result?.success) {
      $message.error(result?.message || '导入失败')
      return
    }
    if (result.kind !== 'offline-pack') {
      $message.error(uiMessage('ui.chooseAV2OfflinePackageVxpack'))
      return
    }
    openOfflinePackImportDialog(result.packagePath || result.filePath)
  } catch (error) {
    console.error('导入 VAM-Hub 离线安装包失败', error)
    $message.error(uiMessage('ui.importFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  }
}

function handleResolveProgress(_event, payload = {}) {
  const resolvedCount = Number(payload.resolved_count || 0)
  const totalDiscovered = Number(payload.total_discovered || 0)
  const currentPackage = toSafeText(payload.current_package)
  resolveProgress.value = {
    resolved_count: resolvedCount,
    total_discovered: totalDiscovered,
    current_package: currentPackage
  }
  if (sourceInstallModal.value.dependenciesLoading) {
    sourceInstallModal.value = {
      ...sourceInstallModal.value,
      dependencyResolveProgress: {
        resolved_count: resolvedCount,
        total_discovered: totalDiscovered,
        current_package: currentPackage
      }
    }
  }
}

function buildDetectRulePayload(ruleJson = {}) {
  const ruleSourceGameId = getRuleSourceGameId()
  return {
    sourcePlatform: 'vamhub',
    gameKey: `vamhub:${ruleSourceGameId}`,
    domainName: ruleSourceGameId,
    nexusGameId: 0,
    ruleJson
  }
}

function applyDetectedGamePath(detectResult = {}) {
  const rootPath = toSafeText(
    detectResult.rootPath || detectResult.detectedRootPath || detectResult.gameRoot
  )
  const exePath = toSafeText(detectResult.exePath || detectResult.detectedExePath)
  if (!rootPath) return false
  gameRoot.value = rootPath
  gameExePath.value = exePath
  persistGameRoot()
  publishVamHubAiPageContext()
  return true
}

async function searchGamePath(silent = false) {
  if (pathLoading.value) return false
  pathLoading.value = true
  try {
    const installRule = await resolveVamHubInstallRule()
    if (!hasInstallRuleContent(installRule)) {
      if (!silent) $message.warning(uiMessage('ui.thisGameHasNoInstallationRulesForFolderScanning'))
      return false
    }
    const detectResult = await ipcRenderer.invoke(
      'nexusDetectGameRootByRule',
      buildDetectRulePayload(installRule)
    )
    if (detectResult?.success && applyDetectedGamePath(detectResult)) {
      if (!silent) $message.success(uiMessage('ui.gameFolderDetected'))
      return true
    }
    if (!silent) $message.warning(uiMessage('ui.noMatchingVAMGameFolderFound'))
    return false
  } catch (error) {
    console.warn('[VAM-Hub] 识别游戏目录失败', error)
    if (!silent) $message.warning(error?.message || '识别游戏目录失败')
    return false
  } finally {
    pathLoading.value = false
  }
}

async function selectGameRootByRule() {
  if (pathLoading.value) return false
  const previousRoot = gameRoot.value
  const previousExePath = gameExePath.value
  pathLoading.value = true
  try {
    const installRule = await resolveVamHubInstallRule()
    if (!hasInstallRuleContent(installRule)) {
      $message.warning(uiMessage('ui.thisGameHasNoInstallationRulesForFolderDetection'))
      return false
    }
    const detectResult = await ipcRenderer.invoke('nexusSelectAndDetectGameRootByRule', {
      ...buildDetectRulePayload(installRule),
      defaultPath: detectedGameRootPath.value,
      title: uiText('ui.selectTheValueGameFolder', { value1: (gameInfo.value.name || 'Virt a Mate') })
    })
    if (detectResult?.canceled) {
      return false
    }
    if (!detectResult?.success || !applyDetectedGamePath(detectResult)) {
      gameRoot.value = previousRoot
      gameExePath.value = previousExePath
      $message.warning(uiMessage('ui.theSelectedFolderDoesNotMatchThisGameSInstallation'))
      return false
    }
    $message.success(uiMessage('ui.gameFolderDetectedAndSaved'))
    return true
  } catch (error) {
    gameRoot.value = previousRoot
    gameExePath.value = previousExePath
    console.error('[VAM-Hub] 选择游戏目录失败', error)
    $message.warning(error?.message || '识别游戏目录失败')
    return false
  } finally {
    persistGameRoot()
    pathLoading.value = false
  }
}

function openGameFolder() {
  if (!detectedGameRootPath.value) {
    $message.warning(uiMessage('ui.noGameFolderDetected'))
    return
  }
  ipcRenderer.send('openSpecifyPath', detectedGameRootPath.value)
}

function launchGame() {
  if (!detectedGameExecutablePath.value) {
    $message.warning(uiMessage('ui.noGameExecutableDetected'))
    return
  }
  ipcRenderer.send('startSpecifiedApp', {
    path: detectedGameExecutablePath.value,
    steamAppId: null
  })
}

function openInstalledManager(options = {}) {
  if (!isGameFound.value) {
    $message.warning(uiMessage('ui.detectTheGamePathBeforeManagingInstalledMods'))
    return
  }
  const ruleSourceGameId = getRuleSourceGameId()
  router.push({
    name: 'GameModManagement',
    params: {
      source: 'vamhub',
      id: ruleSourceGameId
    },
    query: {
      source: 'vamhub',
      sourceId: ruleSourceGameId,
      sourceGameId: ruleSourceGameId,
      appId: String(getCurrentAppId() || ''),
      gameId: String(getCurrentBackendGameId() || ''),
      name: gameInfo.value.name,
      cover: gameInfo.value.coverImage,
      rootPath: detectedGameRootPath.value,
      gameRootPath: detectedGameRootPath.value,
      action: options.action
    }
  })
}

function openVamhubRuleConfigPage() {
  const ruleSourceGameId = getRuleSourceGameId()
  router.push({
    name: 'GameSourceInstallConfig',
    params: {
      sourcePlatform: 'vamhub',
      id: encodeURIComponent(ruleSourceGameId)
    },
    query: {
      ...route.query,
      sourcePlatform: 'vamhub',
      sourceGameId: ruleSourceGameId,
      sourceSlug: getCurrentSourceGameSlug(),
      sourceGameSlug: getCurrentSourceGameSlug(),
      sourceGameDomain: getCurrentSourceGameSlug(),
      gameKey: `vamhub:${ruleSourceGameId}`,
      name: gameInfo.value.name,
      englishName: gameInfo.value.englishName,
      cover: gameInfo.value.coverImage,
      desc: gameInfo.value.description,
      appId: String(getCurrentAppId() || ''),
      gameId: String(getCurrentBackendGameId() || ''),
      backendGameId: String(getCurrentBackendGameId() || '')
    }
  })
}

function openLocalBindingWithGameRootCheck() {
  if (pathLoading.value) return
  if (isGameFound.value) {
    openInstalledManager({ action: 'manage-local-mod' })
    return
  }

  Modal.confirm({
    get title() { return uiText('ui.noGameDetected') },
    content: '当前还未识别游戏目录，是否先选择游戏根目录？识别完成后才能管理本地模组。',
    get okText() { return uiText('ui.chooseFolder') },
    get cancelText() { return uiText('ui.cancel') },
    async onOk() {
      const selected = await selectGameRootByRule()
      if (selected) {
        openInstalledManager({ action: 'manage-local-mod' })
      }
    }
  })
}

function handleHeaderAction(key) {
  const actionKey = String(key || '').trim()
  if (actionKey === 'profile-scheme') {
    openProfileSchemeModal()
    return
  }
  if (actionKey === 'manage') {
    openInstalledManager()
    return
  }
  if (actionKey === 'manage-local-mod') {
    openLocalBindingWithGameRootCheck()
    return
  }
  if (actionKey === 'launch') {
    launchGame()
    return
  }
  if (actionKey === 'open-root') {
    openGameFolder()
    return
  }
  if (actionKey === 'scan') {
    searchGamePath(false).then()
    return
  }
  if (actionKey === 'manual-bind') {
    selectGameRootByRule().then()
    return
  }
  if (actionKey === 'rule-config') {
    openVamhubRuleConfigPage()
    return
  }
  if (actionKey === 'cookie') {
    openCookieModal()
  }
}

watch(
  () => query.value.search,
  () => {
    query.value.effectiveKeyword = ''
  },
  { flush: 'sync' }
)

watch(
  () =>
    [
      resources.value
        .map((item) => {
          return `${getResourceKey(item)}:${item?.title || ''}:${item?.tag_line || item?.description || ''}`
        })
        .join('|'),
      JSON.stringify([aiTranslationConfig.value, contentLocale.value])
    ].join('::'),
  async () => {
    vamhubTranslationMap.value = {}
    vamhubTranslationResolvedMap.value = {}
    vamhubItemTranslationLoadingMap.value = {}
    await hydrateVamHubModTranslations(resources.value)
    await autoTranslateVamHubMods(resources.value)
  },
  { immediate: true }
)

const { activate: activateSourceTaskListeners, deactivate: deactivateSourceTaskListeners } =
  createSourceInstallTaskSubscriptions(ipcRenderer, {
    onTaskUpdated: handleSourceInstallTaskUpdated,
    refreshScheduler: installedVamHubRefreshScheduler,
    listeners: [['vamhub:resolve-dependencies-progress', handleResolveProgress], ['update-system-config', handleSystemConfigUpdated]]
  })

onMounted(async () => {
  gameRoot.value = getInitialGameRoot()
  gameExePath.value = getInitialGameExePath()
  persistGameRoot()
  setPageMenuName(() => `[Mod]-${gamePresentation(gameInfo.value).title}`, route.path)
  activateSourceTaskListeners()
  const preloadRulePromise = resolveVamHubInstallRule().catch((error) => {
    console.warn('[VAM-Hub] 公共规则不可用', error)
    return null
  })
  const loadAiConfigPromise = loadAiSystemConfig()
  loadPackages(1)
  try {
    loginStatus.value = await getVamHubLoginStatus()
  } catch {
    loginStatus.value = { loggedIn: false }
  }
  await loadAiConfigPromise
  await preloadRulePromise
  publishVamHubAiPageContext()
  if (!isGameFound.value) {
    searchGamePath(true).then()
  }
})

onActivated(() => {
  activateSourceTaskListeners()
})

onDeactivated(() => {
  deactivateSourceTaskListeners()
})

onBeforeUnmount(() => {
  deactivateSourceTaskListeners()
})

defineOptions({
  name: 'GameVamHubModList'
})
</script>

<template>
  <page-body>
    <div class="vamhub-page">
      <unified-mod-header
        :rule-ai-context="{ sourcePlatform: 'vamhub', gameName: gameInfo.name, sourceGameId: getRuleSourceGameId(), sourceSlug: getCurrentSourceGameSlug(), appId: getCurrentAppId() }"
        :rule-ai-missing="!installRuleCache && installRuleFailure?.state === 'NOT_CONFIGURED'"
        rule-ai-editor-action="rule-config"
        :dlss-context="{ name: gameInfo.name, sourcePlatform: 'vamhub', gameRoot: isGameFound ? detectedGameRootPath : '', exePath: isGameFound ? detectedGameExecutablePath : '' }"
        :cover-image="gameInfo.coverImage"
        :title="gamePresentation(gameInfo).title"
        :subtitle="gamePresentation(gameInfo).subtitle"
        :description="gameInfo.description"
        :stats="headerStats"
        :status-text="headerStatusText"
        :status-type="headerStatusType"
        :status-sub-text="''"
        :actions="headerActions"
        :more-button-text="$t('ui.moreSettings')"
        @action="handleHeaderAction"
        @rule-saved="searchGamePath(true)"
      />

      <unified-mod-search-bar
        v-model:keyword="query.search"
        :keyword-placeholder="$t('ui.searchResources')"
        :loading="loading"
        :filter-value="query.pricing"
        :filter-options="PRICING_OPTIONS"
        show-filter
        :sort="query.sort"
        :sort-options="SORT_OPTIONS"
        @update:filter-value="handlePricingChange"
        @update:sort="handleSortChange"
        @search="handleSearch"
        @reset="handleReset"
      >
        <template #right-before>
          <a-select
            class="vamhub-type-select"
            :value="query.resourceType"
            :options="RESOURCE_TYPES"
            :disabled="loading"
            @change="handleResourceTypeChange"
          />
        </template>
        <template #right>
          <a-button class="vamhub-reset-button" :disabled="loading" @click="handleReset">
            {{ $t('ui.reset') }}
          </a-button>
        </template>
      </unified-mod-search-bar>

      <unified-mod-list-grid
        :items="listItems"
        :floating-actions="vamhubFloatingActions"
        :loading="loading"
        :loading-text="$t('ui.loadingVAMHubResources')"
        :empty-text="$t('ui.noVAMHubResourcesMatchTheCurrentFilters')"
        :current="pagination.current"
        :pages="pagination.pages"
        :total="pagination.total"
        :size="query.pageSize"
        :current-count="listItems.length"
        @open-detail="handleOpenListItem"
        @translate-item="handleTranslateVamHubSingleMod"
        @floating-action="handleVamHubFloatingAction"
        @install="handleInstallFromList"
        @page-change="handlePageChange"
      />

      <VxDrawer
        v-model="detailDrawerOpen"
        :width="600"
        :close-label="t('dialogs.vamDetail.close')"
        panel-class="vamhub-detail"
      >
        <template #header>
          <div class="vamhub-detail__head">
            <span class="vamhub-detail__thumb">
              <img
                v-if="packageDetail?.image_url || packageDetail?.icon_url"
                :src="packageDetail.image_url || packageDetail.icon_url"
                alt=""
              />
            </span>
            <div class="vamhub-detail__head-main">
              <h2 class="vamhub-detail__title">{{ detailTitle }}</h2>
              <p v-if="packageDetail" class="vamhub-detail__meta">
                <span>{{ packageDetail.username || 'VAM-Hub' }}</span>
                <span class="vamhub-detail__chip">{{ packageDetail.category || 'Free' }}</span>
                <span class="vamhub-detail__chip is-mono">{{
                  packageDetail.version_string || 'latest'
                }}</span>
              </p>
              <p v-if="packageDetail" class="vamhub-detail__stats">
                <span>{{
                  t('dialogs.vamDetail.downloads', {
                    count: formatNumber(packageDetail.download_count)
                  })
                }}</span>
                <span>{{
                  t('dialogs.vamDetail.views', { count: formatNumber(packageDetail.view_count) })
                }}</span>
                <span>{{
                  t('dialogs.vamDetail.rating', { score: formatRating(packageDetail.rating_avg) })
                }}</span>
              </p>
            </div>
          </div>
        </template>

        <div v-if="packageBasicLoading" class="vamhub-detail__skeleton" aria-hidden="true">
          <span class="tool-skeleton is-line"></span>
          <span class="tool-skeleton is-line"></span>
          <span class="tool-skeleton is-short"></span>
        </div>

        <div v-else-if="packageDetail" class="vamhub-detail__body">
          <p
            v-if="packageDetail.dependency_page_warning"
            class="vamhub-detail__warning"
            role="status"
          >
            <ToolIcon name="warning" :size="15" />
            <span>{{ packageDetail.dependency_page_warning }}</span>
          </p>

          <div v-if="translatedDetailDescription" class="vamhub-detail__desc">
            <p
              id="vamhub-detail-desc"
              class="vamhub-detail__desc-text"
              :class="{ 'is-clamped': !detailDescriptionExpanded }"
            >
              {{ translatedDetailDescription }}
            </p>
            <button
              v-if="detailDescriptionLong"
              type="button"
              class="vamhub-detail__more"
              aria-controls="vamhub-detail-desc"
              :aria-expanded="detailDescriptionExpanded"
              @click="detailDescriptionExpanded = !detailDescriptionExpanded"
            >
              {{
                detailDescriptionExpanded
                  ? t('dialogs.vamDetail.collapse')
                  : t('dialogs.vamDetail.expand')
              }}
            </button>
          </div>

          <section class="vamhub-detail__section" aria-labelledby="vamhub-detail-files">
            <h3 id="vamhub-detail-files" class="vamhub-detail__section-title">
              {{ t('dialogs.vamDetail.files') }}
              <small>{{ detailFiles.length }}</small>
            </h3>
            <ul v-if="detailFiles.length" class="vamhub-detail__list">
              <li
                v-for="file in detailFiles"
                :key="file.filename || file.downloadUrl"
                class="vamhub-detail__file"
              >
                <span class="vamhub-detail__file-name" :title="file.filename || detailTitle">{{
                  file.filename || detailTitle
                }}</span>
                <span class="vamhub-detail__file-size">{{ formatFileSize(file.file_size) }}</span>
                <VxButton
                  variant="secondary"
                  size="sm"
                  :loading="!!installingKeyMap[file.filename || file.downloadUrl]"
                  @click="handleDownloadFile(file)"
                >
                  {{
                    isGameFound
                      ? t('dialogs.vamDetail.installOne')
                      : t('dialogs.vamDetail.downloadOne')
                  }}
                </VxButton>
              </li>
            </ul>
            <p v-else class="vamhub-detail__empty">{{ t('dialogs.vamDetail.noFiles') }}</p>
          </section>

          <section class="vamhub-detail__section" aria-labelledby="vamhub-detail-deps">
            <h3 id="vamhub-detail-deps" class="vamhub-detail__section-title">
              {{ t('dialogs.vamDetail.dependencies') }}
              <span
                v-if="packageDetailLoading"
                class="tool-inline-spinner"
                :aria-label="t('dialogs.vamDetail.dependenciesLoading')"
              ></span>
            </h3>
            <div class="vamhub-detail__deps">
              <template v-for="group in detailDependencySections" :key="group.key">
                <div class="vamhub-detail__dep-group">
                  {{ group.label }} <span>{{ group.items.length }}</span>
                </div>
                <div
                  v-for="dep in group.items"
                  :key="dep.packageName || dep.resource_id || dep.downloadUrl"
                  class="vamhub-detail__dep"
                >
                  <span class="vamhub-detail__dep-name">{{
                    dep.packageName || dep.filename || dep.resource_id
                  }}</span>
                  <span class="vamhub-detail__dep-meta">{{
                    dep.licenseType || dep.version || '--'
                  }}</span>
                </div>
                <p v-if="!group.items.length" class="vamhub-detail__dep-empty">
                  {{
                    packageDetailLoading ? t('dialogs.vamDetail.dependenciesLoading') : group.empty
                  }}
                </p>
              </template>
            </div>
          </section>
        </div>

        <ToolEmpty
          v-else
          compact
          icon="info"
          :title="t('dialogs.vamDetail.emptyTitle')"
          :description="t('dialogs.vamDetail.emptyDesc')"
        />

        <template v-if="packageDetail && !packageBasicLoading" #footer>
          <button type="button" class="vamhub-detail__web" @click="openModPage(packageDetail)">
            {{ t('dialogs.vamDetail.openWeb') }}
            <ToolIcon name="external" :size="12" />
          </button>
          <VxButton :disabled="!detailFiles.length" @click="openDependencyModal">
            {{
              isGameFound ? t('dialogs.vamDetail.installAll') : t('dialogs.vamDetail.downloadAll')
            }}
          </VxButton>
        </template>
      </VxDrawer>

      <InstallConfirmDialog
        :open="dependencyModalOpen"
        :mode="isGameFound ? 'install' : 'download'"
        :title="detailTitle"
        :icon-url="packageDetail?.image_url || packageDetail?.icon_url || ''"
        :fallback-initial="detailTitle"
        source-label="VaM-Hub"
        :meta="vamHubDialogMeta"
        :busy="submittingDependencies"
        :empty-text="$t('ui.thisResourceHasNoDownloadableMainVarFileCheckThe')"
        selection-type="none"
        :selection-title="$t('ui.mainFiles')"
        :selection-caption="$t('ui.allMainFiles')"
        :columns="vamHubMainFileColumns"
        :items="vamHubMainFileItems"
        :target="vamHubDialogTarget"
        :notice="vamHubDialogNotice"
        :show-selected="false"
        :dependencies="vamHubDependencyPlan"
        :total="vamHubDependencyTotal"
        :actions="vamHubDependencyActions"
        @action="confirmDependencyInstall"
        @dependency-toggle="toggleDependencySelection"
        @close="handleVamHubDependencyDialogClose"
      />

      <VamhubCookieDialog
        v-model:open="cookieModalOpen"
        v-model:value="cookieInput"
        :logged-in="!!loginStatus.loggedIn"
        :saving="cookieSaving"
        @save="saveCookie"
      />

      <ModSourceProfileModal
        :open="profileConfigModal.open"
        :active-profile-name="vamhubProfileState.activeProfileName.value"
        :profile-options="vamhubProfileState.profileOptions.value"
        :profile-mod-count="installedVamHubMods.length"
        :profile-switching="profileSwitching"
        :profile-operation-locked="false"
        :sharing-profile="sharingProfileLoading"
        :importing-profile="importingProfile"
        :show-namespace-hint="false"
        :create-profile-loading="createProfileModal.confirmLoading"
        :profile-name-max-length="vamhubProfileState.PROFILE_NAME_MAX_LENGTH"
        @close="closeProfileSchemeModal"
        @switch-profile="handleProfileSwitch"
        @rename-profile="handleProfileRename"
        @delete-profile="handleProfileDelete"
        @create-profile="openCreateProfileModal"
        @confirm-create-profile="handleInlineCreateProfile"
        @share-profile="shareVamHubSourceModpack"
        @update-profile="updateVamHubSourceModpack"
        @import-profile="openSourceModpackImportModal"
        @export-file="handleExportToFile"
        @import-file="handleImportFromFile"
      />

      <ModSourceCreateProfileModal
        :open="createProfileModal.open"
        :confirm-loading="createProfileModal.confirmLoading"
        :name="createProfileModal.name"
        :max-length="vamhubProfileState.PROFILE_NAME_MAX_LENGTH"
        @close="closeCreateProfileModal"
        @confirm="confirmCreateProfileModal"
        @update:name="(value) => (createProfileModal.name = value)"
      />

      <SourceModpackShareCodeModal
        :open="sourceModpackImportModal.open"
        :code="sourceModpackImportModal.code"
        :loading="sourceModpackImportModal.loading"
        :title="$t('ui.importAVAMHubShareCode')"
        :placeholder="$t('ui.enterAVAMHubShareCode')"
        :hint="$t('ui.createInstallationTasksForTheVAMHubModsInThis')"
        @update:code="(value) => (sourceModpackImportModal.code = value)"
        @confirm="confirmVamHubSourceModpackImport"
        @cancel="closeSourceModpackImportModal"
      />

      <SourceModpackUpdateModal
        v-model="sourceModpackUpdateModal.open"
        :snapshot="sourceModpackUpdateModal.snapshot"
      />

      <VxModal
        :model-value="sourceModpackImportPreview.open"
        :title="$t('ui.previewSharedVAMHubModpack')"
        :description="$t('ui.downloadLinksWereResolvedAgainUsingStableResourceIdentitiesItems')"
        :width="760"
        :close-on-overlay="!sourceModpackImportPreview.installing"
        :close-on-esc="!sourceModpackImportPreview.installing"
        @update:model-value="(visible) => !visible && closeVamHubSourceModpackPreview()"
      >
        <div class="vamhub-source-modpack-preview">
          <div class="vamhub-source-modpack-preview__summary">
            <span>
              {{ $t('ui.targetProfile') }}
              <strong>{{ sourceModpackImportPreview.profileName || '--' }}</strong>
            </span>
            <span>
              {{ $t('ui.installable') }}
              <strong
                >{{ selectedVamHubImportItems.length }} /
                {{ sourceModpackImportPreview.items.length }}</strong
              >
            </span>
          </div>

          <div class="vamhub-source-modpack-preview__items vx-ui-scrollbar">
            <label
              v-for="item in sourceModpackImportPreview.items"
              :key="item.previewKey"
              class="vamhub-source-modpack-preview__item"
              :class="{ 'is-blocked': !item.canImport }"
            >
              <input
                type="checkbox"
                :checked="!!sourceModpackImportPreview.selectedKeys[item.previewKey]"
                :disabled="!item.canImport || sourceModpackImportPreview.installing"
                @change="toggleVamHubSourceModpackPreviewItem(item, $event.target.checked)"
              />
              <span class="vamhub-source-modpack-preview__main">
                <strong>{{
                  item.name || item.sourceModKey || item.sourceModId || $t('ui.unnamedEntry')
                }}</strong>
                <small>
                  {{ item.metadata?.fileName || item.sourceFileId || '--' }}
                  <template v-if="item.version"> · {{ item.version }}</template>
                </small>
                <small :class="{ 'is-error': !item.canImport }">
                  {{ item.reason || (item.canImport ? $t('ui.readyToImport') : $t('ui.couldNotParse')) }}
                  <code v-if="item.errorCode">{{ item.errorCode }}</code>
                </small>
              </span>
              <VxTag :tone="item.canImport ? 'success' : 'danger'" size="sm">
                {{ item.canImport ? $t('ui.installable') : $t('ui.blocked') }}
              </VxTag>
            </label>
          </div>
        </div>

        <template #footer>
          <VxDialogActions
            :cancel-text="$t('ui.cancel')"
            :confirm-text="$t('ui.addToInstallationTasks')"
            :cancel-disabled="sourceModpackImportPreview.installing"
            :confirm-disabled="!canSubmitVamHubSourceModpackImport"
            :confirm-loading="sourceModpackImportPreview.installing"
            @cancel="closeVamHubSourceModpackPreview"
            @confirm="confirmVamHubSourceModpackPreviewImport"
          />
        </template>
      </VxModal>

      <profile-switch-progress-dialog
        :progress="profileSwitchProgress"
        @close="profileSwitchProgress.open = false"
      />

      <InstallConfirmDialog
        :open="sourceInstallModal.open"
        :mode="sourceInstallModal.mode === 'download' ? 'download' : 'install'"
        :title="sourceInstallDisplayName"
        :icon-url="sourceInstallModal.cover"
        :fallback-initial="sourceInstallDisplayName"
        source-label="VaM-Hub"
        :meta="sourceInstallDialogMeta"
        :busy="sourceInstallModal.confirmLoading"
        :empty-text="$t('ui.thisResourceHasNoDownloadableVarFileCheckTheSource')"
        selection-type="single"
        :selection-title="$t('modBrowser.selectFile')"
        :columns="vamHubOptionColumns"
        :items="sourceInstallDialogItems"
        :selected-keys="sourceInstallModal.selectedId ? [sourceInstallModal.selectedId] : []"
        :target="vamHubDialogTarget"
        :notice="sourceInstallModal.mode === 'download' ? null : vamHubDialogNotice"
        :show-selected="false"
        :dependencies="sourceInstallDependencyPlan"
        :total="sourceInstallDialogTotal"
        :actions="sourceInstallDialogActions"
        @update:selected-keys="(keys) => handleSourceInstallOptionSelect(keys[0])"
        @action="handleSourceInstallDialogAction"
        @close="closeSourceInstallModal()"
      />
    </div>
  </page-body>
</template>

<style scoped lang="scss">
.vamhub-page {
  min-height: 100%;
}

.vamhub-type-select {
  width: 190px;

  :deep(.ant-select-selector) {
    height: 38px !important;
    border-radius: 10px !important;
    border-color: #d9e3f0 !important;
    background: #f8fbff !important;
    padding-inline: 10px !important;
  }

  :deep(.ant-select-selection-item),
  :deep(.ant-select-selection-placeholder) {
    line-height: 36px !important;
  }
}

.vamhub-reset-button {
  height: 38px;
  border-radius: 10px;
  padding: 0 18px;
  border-color: #d9e3f0;
  background: #f8fbff;
  color: #4b5563;
  font-weight: 600;
}

.vamhub-detail__head {
  display: flex;
  gap: 14px;
  min-width: 0;
}

.vamhub-detail__thumb {
  flex: 0 0 auto;
  width: 120px;
  height: 68px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-surface-strong, #e8edf3);

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.vamhub-detail__head-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vamhub-detail__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.vamhub-detail__meta,
.vamhub-detail__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 0;
  font-size: 12.5px;
}

.vamhub-detail__meta {
  color: var(--color-text-tertiary, #5d6779);
}

.vamhub-detail__stats {
  gap: 6px 14px;
  color: var(--color-text-secondary, #344054);
  font-variant-numeric: tabular-nums;
}

.vamhub-detail__chip {
  padding: 0 6px;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: 4px;
  background: var(--color-surface-hover, #f1f4f8);
  color: var(--color-text-secondary, #344054);
  font-weight: 500;

  &.is-mono {
    font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
    font-weight: 400;
  }
}

.vamhub-detail__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.vamhub-detail__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.vamhub-detail__warning {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #f2d6a5;
  border-radius: 10px;
  background: #fffaf0;
  color: #7a3d06;
  font-size: 12.5px;

  :deep(svg) {
    flex: 0 0 auto;
    margin-top: 2px;
    color: var(--color-warning-strong, #b45309);
  }
}

.vamhub-detail__desc {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vamhub-detail__desc-text {
  margin: 0;
  color: var(--color-text-secondary, #344054);
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  &.is-clamped {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  }
}

.vamhub-detail__more,
.vamhub-detail__web {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-active, #0677c7);
  font: inherit;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: var(--color-accent-strong, #0b4f85);
    text-decoration: underline;
  }

  &:focus-visible {
    outline: none;
    border-radius: 4px;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }
}

.vamhub-detail__web {
  flex: 1 1 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

.vamhub-detail__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vamhub-detail__section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;

  small {
    color: var(--color-text-muted, #667085);
    font-size: 14px;
    font-weight: 500;
  }
}

.vamhub-detail__list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: 8px;
  overflow: hidden;
}

.vamhub-detail__file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;

  & + & {
    border-top: 1px solid var(--color-bg, #eef1f5);
  }
}

.vamhub-detail__file-name,
.vamhub-detail__dep-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12.5px;
}

.vamhub-detail__file-size,
.vamhub-detail__dep-meta {
  flex: 0 0 auto;
  color: var(--color-text-tertiary, #5d6779);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.vamhub-detail__empty {
  margin: 0;
  color: var(--color-text-muted, #667085);
  font-size: 13px;
}

.vamhub-detail__deps {
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: 8px;
  overflow: hidden;
}

.vamhub-detail__dep-group {
  padding: 7px 14px;
  border-bottom: 1px solid var(--color-border, #d9e0e8);
  background: var(--color-surface-soft, #f7f8fa);
  color: var(--color-text-tertiary, #5d6779);
  font-size: 12px;
  font-weight: 600;

  &:not(:first-child) {
    border-top: 1px solid var(--color-border, #d9e0e8);
  }
}

.vamhub-detail__dep {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;

  & + & {
    border-top: 1px solid var(--color-bg, #eef1f5);
  }
}

.vamhub-detail__dep-empty {
  margin: 0;
  padding: 10px 14px;
  color: var(--color-text-muted, #667085);
  font-size: 12.5px;
}

.dependency-modal__state {
  display: grid;
  gap: 8px;
  place-items: center;
  min-height: 180px;
  color: #526176;
}

.dependency-modal__summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #e3e9f2;
  border-radius: 10px;
  background: #f8fafc;
  color: #526176;
  font-size: 13px;
  font-weight: 600;
}

.dependency-table {
  max-height: 420px;
  overflow: auto;
  border: 1px solid #e3e9f2;
  border-radius: 12px;
  background: #ffffff;
}

.dependency-table__row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 80px 90px 82px;
  gap: 10px;
  align-items: center;
  min-height: 42px;
  padding: 8px 10px;
  border-bottom: 1px solid #edf2f7;
  color: #526176;
  font-size: 13px;

  &:last-child {
    border-bottom: 0;
  }

  strong {
    text-align: right;
    font-size: 12px;
  }
}

.dependency-table__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-need strong,
.is-upgrade strong {
  color: #1677ff;
}

.is-queued strong {
  color: #475569;
}

.is-installed strong {
  color: #64748b;
}

.is-blocked strong {
  color: #b91c1c;
}

.vamhub-source-modpack-preview {
  display: grid;
  gap: var(--space-4);
}

.vamhub-source-modpack-preview__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.vamhub-source-modpack-preview__summary span {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  font-size: var(--font-size-sm);
}

.vamhub-source-modpack-preview__summary strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.vamhub-source-modpack-preview__items {
  display: grid;
  gap: var(--space-2);
  max-height: 420px;
  overflow-y: auto;
  padding-right: var(--space-1);
}

.vamhub-source-modpack-preview__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
}

.vamhub-source-modpack-preview__item.is-blocked {
  background: var(--color-danger-soft);
  cursor: not-allowed;
}

.vamhub-source-modpack-preview__item input {
  margin-top: 3px;
}

.vamhub-source-modpack-preview__main {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.vamhub-source-modpack-preview__main strong,
.vamhub-source-modpack-preview__main small {
  overflow-wrap: anywhere;
}

.vamhub-source-modpack-preview__main small {
  color: var(--color-text-muted);
}

.vamhub-source-modpack-preview__main small.is-error {
  color: var(--color-danger);
}

.vamhub-source-modpack-preview__main code {
  margin-left: var(--space-2);
  font-size: 11px;
}

@media (max-width: 720px) {
  .vamhub-type-select {
    width: 100%;
  }

  .dependency-table__row,
  .vamhub-source-modpack-preview__summary {
    grid-template-columns: 1fr;
  }

  .dependency-table__row strong {
    text-align: left;
  }
}
</style>
