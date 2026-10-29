<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { describeSharedRuleFailure } from '../../../../../shared/installation/shared-install-rule.js'
import { createDescriptionTranslationPlan } from '@renderer/utils/mod-description-translation.js'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { resolveGameNameFromDict } from '@renderer/utils/game-name-dict.js'
import SourceModpackShareCodeModal from '@renderer/views/game/component/source-modpack-share-code-modal.vue'
import SourceModpackUpdateModal from '@renderer/views/game/sourceModpack/component/SourceModpackUpdateModal.vue'
import {
  CREATE_SOURCE_MODPACK
} from '@renderer/api/modules/source-modpack.js'
import {
  buildSourceModpackCreatePayload,
  copySourceModpackTextToClipboard,
  extractSourceModpackShareCode,
  toPlainSourceModpackJson
} from '@renderer/utils/source-modpack-share.js'
import { requestSourceModpackShareName } from '@renderer/utils/source-modpack-share-name.js'
import { inspectShareImport, applyShareImport } from '@renderer/utils/source-modpack-coordinator-runtime.js'
import { requestSourceModpackInspectionConfirmation } from '@renderer/utils/source-modpack-import-ui.js'
import ModSourceProfileModal from '@renderer/views/game/component/profile/mod-source-profile-modal.vue'
import ModSourceCreateProfileModal from '@renderer/views/game/component/profile/mod-source-create-profile-modal.vue'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'
import { buildCsmPayload, signCsmPayload } from '@renderer/utils/cross-source-modpack-schema.js'
import {
  openOfflinePackExportDialog,
  openOfflinePackImportDialog,
  pickOfflinePackImportFile
} from '@renderer/views/game/vxpack/vxpack-service.js'
import { Modal } from 'ant-design-vue'
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
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import {
  REPORT_RULE_ISSUE,
  GET_SHARED_INSTALL_RULE,
} from '@renderer/api/modules/game.js'
import UnifiedModHeader from '@views/game/component/unifiedModList/UnifiedModHeader.vue'
import UnifiedModSearchBar from '@views/game/component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '@views/game/component/unifiedModList/UnifiedModListGrid.vue'
import { buildGameSiteDetailRoute } from '@views/game/site-detail-route.js'
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import ProfileSwitchProgressDialog from '@renderer/views/game/component/profile/profile-switch-progress-dialog.vue'
import {
  formatInstallDate,
  formatInstallDateTime,
  formatInstallSize
} from '@views/game/component/install-confirm/install-confirm-format.js'
import {
  getModioApiConfig,
  getModioModDependencies,
  getModioModFile,
  getModioModFiles,
  getModioModList,
  hasModioEnvApiKey,
  resolveEffectiveModioApiConfig
} from '@renderer/utils/modio-api.js'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import {
  buildSourceDownloadOnlyMessage,
  getSourcePlatformInstallPolicy,
  shouldDownloadOnlyWhenRuleUnmatched
} from '../../../../../shared/sources/source-platform-install-policy.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../../shared/translation/ai-translation-config.js'

const route = useRoute()
const router = useRouter()
const aiPageContextProvider = useAiPageContextProvider(route)
const { setMenuName: setPageMenuName } = useMenuName()
const downloadStore = useDownloadStore()
const appStore = useAppStore()
const MODIO_SOURCE_PLATFORM = 'modio'
const modioInstallPolicy = getSourcePlatformInstallPolicy(MODIO_SOURCE_PLATFORM)

// 配置方案（本地 profile）
const modioProfileState = useModSourceProfiles({
  sourceKey: 'modio',
  identifier: () => {
    const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
    return String(raw || '').trim()
  }
})
const profileConfigModal = ref({ open: false })
const profileSwitching = ref(false)
const sharingProfile = ref(false)
const importingProfile = ref(false)
const createProfileModal = ref({ open: false, confirmLoading: false, name: '' })

// 配置切换进度弹窗
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
  const validation = modioProfileState.validateNewProfileName(createProfileModal.value.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  createProfileModal.value.confirmLoading = true
  try {
    modioProfileState.ensureProfile(validation.name, { select: false })
    $message.success(uiMessage('ui.profileCreatedValue', { value1: (validation.name) }))
    createProfileModal.value = { open: false, confirmLoading: false, name: '' }
  } catch (error) {
    console.error('新增 Mod.io 配置失败', error)
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
  const currentName = modioProfileState.resolveProfileNameInList(payload?.profileName)
  const validation = modioProfileState.validateProfileRename(currentName, payload?.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  try {
    const sourceId = String(getCurrentGameId() || route.params.id || '')
    const result = await ipcRenderer.invoke('sourceProfile:rename', {
      appId: 0,
      source: 'modio',
      sourceId,
      previousProfile: currentName,
      nextProfile: validation.name,
      endpointType: 0
    })
    if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRenameProfile'))
    modioProfileState.renameProfile(currentName, validation.name)
    await refreshInstalledModioMods()
    $message.success(result.message || uiText('ui.renamedToValue', { value1: (validation.name) }))
  } catch (error) {
    console.error('重命名 Mod.io 配置失败', error)
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
    fromProfile: modioProfileState.activeProfileName.value,
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
    const result = await ipcRenderer.invoke('sourceProfile:switch', {
      appId: 0,
      source: 'modio',
      sourceId: String(getCurrentGameId() || route.params.id || ''),
      targetProfile: name,
      currentProfile: modioProfileState.activeProfileName.value,
      endpointType: 0
    })
    if (!result?.success) {
      throw new Error(result?.message || uiText('ui.someOperationsFailedWhileSwitchingProfiles'))
    }
    modioProfileState.setSelectedProfile(name)
    // 与 nexus 同：直接用后端 message（含按 profile 维度拆分的明细），避免前端再拼总数误导用户。
    $message.success(result.message || uiText('ui.switchedToProfileValue', { value1: (modioProfileState.activeProfileName.value) }))
    await refreshInstalledModioMods()
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

async function prepareModioImportProfile(profileName = '') {
  const previousProfileName = modioProfileState.activeProfileName.value
  const targetProfileName = modioProfileState.ensureProfile(profileName)
  try {
    const result = await ipcRenderer.invoke('sourceProfile:switch', {
      appId: 0,
      source: 'modio',
      sourceId: String(getCurrentGameId() || route.params.id || ''),
      targetProfile: targetProfileName,
      endpointType: 0
    })
    if (!result?.success) {
      throw new Error(result?.message || uiText('ui.couldNotSwitchToTheImportedProfileValue', { value1: (targetProfileName) }))
    }
    modioProfileState.setSelectedProfile(targetProfileName)
    await refreshInstalledModioMods()
    return modioProfileState.activeProfileName.value
  } catch (error) {
    modioProfileState.setSelectedProfile(previousProfileName)
    throw error
  }
}
function handleProfileDelete(name) {
  const resolvedName = modioProfileState.resolveProfileNameInList(name)
  if (resolvedName === modioProfileState.defaultProfileName.value) return
  if (
    String(resolvedName || '').toLowerCase() ===
    String(modioProfileState.activeProfileName.value || '').toLowerCase()
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
      const targetName = modioProfileState.resolveProfileNameInList(name)
      if (
        String(targetName || '').toLowerCase() ===
        String(modioProfileState.activeProfileName.value || '').toLowerCase()
      ) {
        $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
        return
      }
      const deleteResult = await ipcRenderer.invoke('sourceProfile:delete', {
        appId: 0,
        source: 'modio',
        sourceId: String(getCurrentGameId() || route.params.id || ''),
        targetProfile: targetName,
        isDefault: targetName === modioProfileState.defaultProfileName.value,
        endpointType: 0
      })
      if (!deleteResult?.success) {
        throw new Error(deleteResult?.message || uiText('ui.couldNotDeleteProfile'))
      }
      modioProfileState.removeProfile(targetName)
      await refreshInstalledModioMods()
      // 后端 message 已包含「清理 N 个模组及其源文件」之类的详情，直接透传
      $message.success(deleteResult.message || uiText('ui.profileDeletedValue', { value1: (resolvedName) }))
    }
  })
}

async function handleExportToFile() {
  try {
    await refreshInstalledModioMods()
    const items = buildModioSourceModpackShareItems()
    if (!items.length) {
      $message.warning(uiMessage('ui.noInstalledModIoModsAreAvailableToExport'))
      return
    }
    const gameId = getCurrentGameId()
    const csm = buildCsmPayload({
      name: `${gameDisplayName.value || gameId} - ${modioProfileState.activeProfileName.value}`,
      description: `Mod.io Profile：${modioProfileState.activeProfileName.value}`,
      cover: String(gameBaseInfo.value.coverImage || '').trim(),
      primaryGame: {
        gameKey: `modio:${gameId}`,
        sourceType: 'modio',
        sourceGameId: String(gameId || '').trim(),
        sourceGameSlug: String(gameBaseInfo.value.nameId || gameId || '').trim(),
        sourceGameName: gameDisplayName.value || String(gameBaseInfo.value.name || '').trim()
      },
      items
    })
    csm.checksum = await signCsmPayload(csm)
    openOfflinePackExportDialog({
      profilePayload: csm,
      exportItems: items,
      gameName: gameDisplayName.value || String(gameBaseInfo.value.name || '').trim(),
      sourcePlatform: 'modio',
      sourceGameId: String(gameId || '').trim(),
      sourceGameSlug: String(gameBaseInfo.value.nameId || gameId || '').trim(),
      profileName: modioProfileState.activeProfileName.value
    })
  } catch (error) {
    console.error('导出离线安装包失败', error)
    $message.error(uiMessage('ui.exportFailedValue', { value1: (error?.message || uiText('tools.unknownError')) }))
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
    console.error('导入离线安装包失败', error)
    $message.error(uiMessage('ui.importFailedValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

function getIpcFallback(payload) {
  if (Array.isArray(payload)) return []
  if (payload && typeof payload === 'object') return {}
  return payload
}

function invokeIpc(channel, payload, fallback = getIpcFallback(payload)) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

function sendIpc(channel, payload, fallback = getIpcFallback(payload)) {
  ipcRenderer.send(channel, sanitizeIpcPayload(payload, fallback))
}

const sortOptions = [
  { get label() { return uiText('tools.recentlyUpdated') }, value: 'updated_desc' },
  { get label() { return uiText('ui.newestReleases') }, value: 'published_desc' },
  { get label() { return uiText('ui.mostDownloads') }, value: 'downloads_desc' },
  { get label() { return uiText('ui.byName') }, value: 'name_asc' }
]

const loading = ref(false)
const systemConfig = ref({
  modioApi: {
    baseUrl: 'https://api.mod.io/v1',
    apiKey: ''
  },
  aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
})
const query = ref({
  page: 1,
  limit: 20,
  keyword: '',
  effectiveKeyword: '',
  sort: 'updated_desc'
})
const gameBaseInfo = ref({
  id: 0,
  name: '',
  nameId: '',
  coverImage: '',
  description: '',
  modCount: 0,
  profileUrl: ''
})
const pageData = ref({
  records: [],
  total: 0,
  pages: 1,
  current: 1
})
const currentModioRule = ref(null)
const installRuleFailure = ref(null)
const modioBinding = ref(null)
const installedModioMods = ref([])
const sourceModpackSharing = ref(false)
const sourceModpackUpdateModal = ref({ open: false, snapshot: null })
const sourceModpackImportModal = ref({
  open: false,
  code: '',
  loading: false
})
const detectStatus = ref('unknown')
const installSubmitting = ref(false)
const downloadModal = ref({
  open: false,
  loading: false,
  item: null,
  files: [],
  dependencies: [],
  errorText: '',
  dependencyErrorText: ''
})
const downloadingMap = ref({})
const selectedDownloadFileKeys = ref([])
const modioTranslationMap = ref({})
const modioTranslationResolvedMap = ref({})
const modioFileTranslationMap = ref({})
const modioFileTranslationResolvedMap = ref({})
const modioAutoTranslationInFlightSignature = ref('')
const modioAutoTranslationCompletedSignature = ref('')
const modioFileAutoTranslationInFlightSignature = ref('')
const modioFileAutoTranslationCompletedSignature = ref('')
let modioSearchResolveToken = 0
const modioPageTranslationLoading = ref(false)
const modioPageTranslationProgress = ref({
  current: 0,
  total: 0
})
const modioItemTranslationLoadingMap = ref({})
const modioFileTranslationLoading = ref(false)
let modioTranslationToken = 0
let modioFileTranslationToken = 0
let currentModioRuleLoadPromise = null
let currentModioRuleLoadKey = ''
let skippedInitialActivation = false

const hasApiKey = computed(() => hasModioEnvApiKey(getCurrentModioApiConfig()))
const pageMods = computed(() => pageData.value.records || [])
const aiTranslationConfig = computed(() => resolveAiTranslationConfig(systemConfig.value))
const canUseModioAiTranslation = computed(() =>
  isAiTranslationAvailable(systemConfig.value, 'modio')
)
const showAiOriginalText = computed(() => !!aiTranslationConfig.value.showOriginalText)
function countUntranslatedModioMods(list = pageMods.value) {
  return (Array.isArray(list) ? list : []).filter((item) => !isModioCardTranslationResolved(item))
    .length
}
const untranslatedModioModCount = computed(() => countUntranslatedModioMods(pageMods.value))
const modioFloatingActions = computed(() => {
  if (!canUseModioAiTranslation.value || !pageMods.value.length) {
    return []
  }

  return [
    {
      key: 'translate-current-page',
      label: untranslatedModioModCount.value > 0 ? uiText('ui.translateCurrentPage') : uiText('ui.currentPageTranslated'),
      loading: modioPageTranslationLoading.value,
      get loadingText() { return uiText('ui.translateCurrentPage') },
      progressCurrent: modioPageTranslationProgress.value.current,
      progressTotal: modioPageTranslationProgress.value.total,
      disabled: modioPageTranslationLoading.value || untranslatedModioModCount.value <= 0,
      visible: true
    }
  ]
})
const canInstallByRule = computed(() => {
  return detectStatus.value === 'identified' && hasModioInstallRuleContent(currentModioRule.value)
})
const canManualBindGame = computed(() => {
  return hasModioInstallRuleContent(currentModioRule.value)
})
const canOpenGameRoot = computed(() => {
  return (
    detectStatus.value === 'identified' &&
    !!String(modioBinding.value?.detectedRootPath || '').trim()
  )
})

const detectedGameExecutablePath = computed(() => {
  return String(modioBinding.value?.detectedExePath || '').trim()
})

const launchGameButtonText = computed(() => '启动游戏')

const canLaunchGame = computed(() => {
  return detectStatus.value === 'identified'
})

const selectedDownloadFileKeySet = computed(() => new Set(selectedDownloadFileKeys.value))
const selectedDownloadFiles = computed(() => {
  const keySet = selectedDownloadFileKeySet.value
  return downloadModal.value.files.filter((file) => keySet.has(resolveModioFileSelectionKey(file)))
})
const selectedDownloadFileCount = computed(() => selectedDownloadFiles.value.length)
const downloadDependencyCount = computed(() => downloadModal.value.dependencies.length)

const modioDialogMeta = computed(() => {
  const modId = getCardModId(downloadModal.value.item || {})
  return [gameDisplayName.value, modId ? { text: `Mod ID ${modId}` } : '']
})
const modioDialogItems = computed(() =>
  downloadModal.value.files.map((file) => {
    const sizeBytes = toSafeNumber(file?.filesize || file?.fileSize, 0)
    const translatedName = getModioTranslatedFileName(file)
    const dateAdded = toSafeNumber(file?.dateAdded, 0)
    return {
      key: resolveModioFileSelectionKey(file),
      title: translatedName || file?.name || '--',
      originalTitle: showAiOriginalText.value && translatedName ? file?.name || '' : '',
      description: getModioTranslatedFileChangelog(file) || file?.changelog || '',
      sizeBytes,
      sizeText: formatInstallSize(sizeBytes),
      values: {
        platforms: Array.isArray(file?.platforms) ? file.platforms : [],
        version: toSafeText(file?.version) || '未标注',
        size: formatInstallSize(sizeBytes),
        date: dateAdded ? formatInstallDate(dateAdded) : '',
        dateTitle: dateAdded ? formatInstallDateTime(dateAdded) : ''
      }
    }
  })
)
const modioDialogColumns = computed(() =>
  [
    downloadModal.value.files.some((file) => Array.isArray(file?.platforms) && file.platforms.length)
      ? { key: 'platforms', get label() { return uiText('ui.platform') }, width: '140px', chips: true }
      : null,
    { key: 'version', get label() { return uiText('tools.version') }, width: '72px' },
    { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' },
    downloadModal.value.files.some((file) => toSafeNumber(file?.dateAdded, 0) > 0)
      ? { key: 'date', get label() { return uiText('ui.uploadedOn') }, width: '88px', muted: true }
      : null
  ].filter(Boolean)
)
const modioDialogTarget = computed(() => [
  { get label() { return uiText('taskCenter.table.game') }, value: gameDisplayName.value },
  {
    get label() { return uiText('dialogs.configDetail.rules') },
    tag: canInstallByRule.value
      ? { get text() { return uiText('ui.matched') }, tone: 'success' }
      : { get text() { return uiText('dialogs.vamCookie.notSet') }, tone: 'warning' }
  },
  {
    get label() { return uiText('siteDetail.download.writeTo') },
    value: canInstallByRule.value ? '按安装规则写入游戏目录' : '下载目录（不写入游戏）',
    small: true
  }
])
const modioDialogNotice = computed(() =>
  canInstallByRule.value
    ? null
    : {
        tone: 'warning',
        get text() { return uiText('ui.thisGameHasNoUsableInstallationRulesOrItsFolder') }
      }
)
const modioDialogDependencies = computed(() => {
  const items = downloadModal.value.dependencies.map((dependency, index) => ({
    key: String(dependency?.id || dependency?.modId || index),
    name: toSafeText(dependency?.name) || `依赖 ${index + 1}`,
    meta: [
      dependency?.modId ? `Mod ID ${dependency.modId}` : '',
      dependency?.version ? uiText('ui.versionValue', { value1: (dependency.version) }) : ''
    ]
      .filter(Boolean)
      .join(' · '),
    note: toSafeText(dependency?.summary),
    status: 'install',
    get statusText() { return uiText('ui.handleDuringInstallation') },
    actionText: dependency?.profileUrl ? '主页' : ''
  }))
  const errorText = toSafeText(downloadModal.value.dependencyErrorText)
  return {
    state: 'ready',
    items,
    summary: errorText
      ? { get text() { return uiText('ui.couldNotReadDependencies') }, tone: 'warning' }
      : items.length
        ? { text: uiText('ui.valueItemsWillBeHandledDuringInstallation', { value1: (items.length) }), tone: 'muted' }
        : null,
    emptyText: errorText || uiText('ui.thisModDeclaresNoDependencies')
  }
})
const modioDialogTotal = computed(() => {
  const files = selectedDownloadFiles.value
  if (!files.length) return { value: '—', note: '尚未选择文件' }
  const bytes = files.reduce(
    (sum, file) => sum + toSafeNumber(file?.filesize || file?.fileSize, 0),
    0
  )
  const notes = [uiText('ui.valueFiles', { value1: (files.length) })]
  if (downloadDependencyCount.value) notes.push('依赖大小以安装时为准')
  return { value: formatInstallSize(bytes) || '—', note: notes.join(' · ') }
})
const modioDialogTool = computed(() => {
  if (!canUseModioAiTranslation.value) return null
  if (modioFileTranslationLoading.value) return { get label() { return uiText('ui.translatingFileList') }, loading: true }
  return {
    label: modioFileTranslateButtonText.value,
    disabled: installSubmitting.value || untranslatedModioFileCount.value <= 0
  }
})
const modioDialogFooterHint = computed(() =>
  !downloadModal.value.loading && downloadModal.value.files.length && !selectedDownloadFileCount.value
    ? '至少选择一个文件'
    : ''
)
const modioDialogActions = computed(() => {
  const count = selectedDownloadFileCount.value
  const disabled = !canSubmitDownloadSelection.value
  if (!canInstallByRule.value) {
    return [
      {
        key: 'download',
        label: count ? uiText('ui.downloadValueFiles', { value1: (count) }) : uiText('tools.download'),
        variant: 'primary',
        disabled,
        loading: installSubmitting.value
      }
    ]
  }
  return [
    { key: 'download', get label() { return uiText('ui.downloadOnly') }, variant: 'secondary', disabled },
    {
      key: 'install',
      label: count ? uiText('ui.installValueFiles', { value1: (count) }) : uiText('modBrowser.install'),
      variant: 'primary',
      disabled,
      loading: installSubmitting.value
    }
  ]
})
function normalizeModioContextFile(file = {}) {
  return {
    fileId: String(file?.fileId || file?.id || '').trim(),
    fileName: String(file?.name || file?.filename || '').trim(),
    version: String(file?.version || '').trim(),
    fileSize: toSafeNumber(file?.filesize || file?.fileSize, 0),
    downloadAvailable: Boolean(String(file?.downloadUrl || file?.download_url || '').trim())
  }
}

function buildModioAiContextMod() {
  const item = downloadModal.value.item || null
  if (!item) return {}

  const modId = getCardModId(item)
  if (modId <= 0) return {}

  const files = (Array.isArray(downloadModal.value.files) ? downloadModal.value.files : []).map(
    (file) => normalizeModioContextFile(file)
  )
  const selectedFiles = selectedDownloadFiles.value.map((file) => normalizeModioContextFile(file))
  const firstSelectedFile = selectedFiles[0] || null

  return {
    source: 'modio',
    modId,
    id: String(modId),
    name: getCardDisplayName(item),
    title: getCardDisplayName(item),
    version: String(firstSelectedFile?.version || item?.version || '').trim(),
    selectedFileId: String(firstSelectedFile?.fileId || '').trim(),
    selectedFileName: String(firstSelectedFile?.fileName || '').trim(),
    downloadAvailable: files.some((file) => file.downloadAvailable),
    dependencyCount: downloadDependencyCount.value,
    files,
    selectedFile: firstSelectedFile
  }
}

function publishModioAiPageContext() {
  const sourceGameId = String(
    gameBaseInfo.value.id || route.params.id || route.query?.gameId || ''
  ).trim()
  const profileName = String(modioProfileState.activeProfileName.value || 'default').trim()
  const installRoot = String(modioBinding.value?.detectedRootPath || '').trim()
  const executableFile = String(modioBinding.value?.detectedExePath || '').trim()

  return aiPageContextProvider.update({
    game: {
      source: 'modio',
      name: String(gameBaseInfo.value.name || route.query?.name || '').trim(),
      sourceGameId,
      sourceSlug: String(gameBaseInfo.value.nameId || route.params.id || '').trim(),
      gameId: sourceGameId,
      gameRootConfigured: detectStatus.value === 'identified',
      bindingConfigured: detectStatus.value === 'identified',
      installRoot,
      gameRoot: installRoot,
      clientRootPath: installRoot,
      executableFile,
      clientExePath: executableFile,
      profileName
    },
    search: {
      keyword: String(query.value.keyword || '').trim(),
      sort: String(query.value.sort || '').trim(),
      page: Number(query.value.page || pageData.value.current || 1),
      pageSize: Number(query.value.limit || 20),
      selectedIds: selectedDownloadFileKeys.value,
      filters: {
        sourceGameId,
        profile: profileName
      }
    },
    mod: buildModioAiContextMod(),
    install: {
      bindingConfigured: detectStatus.value === 'identified',
      ruleConfigured: Boolean(currentModioRule.value),
      installRoot,
      profileName
    },
    auth: {
      source: 'modio',
      status: hasApiKey.value ? 'configured' : 'missing',
      configured: hasApiKey.value,
      required: true,
      credentialType: 'api_key'
    },
    sourceState: {
      source: 'modio',
      status: hasApiKey.value ? 'active' : 'auth_required',
      label: 'Mod.io',
      configured: hasApiKey.value,
      summary: hasApiKey.value ? uiText('ui.modIoAPIKeyConfigured') : uiText('ui.modIoAPIKeyNotConfigured')
    }
  })
}
const canSubmitDownloadSelection = computed(
  () =>
    !downloadModal.value.loading && !installSubmitting.value && selectedDownloadFileCount.value > 0
)

function resolveInstalledModioRecordModId(item = {}) {
  const raw = item?.raw && typeof item.raw === 'object' ? item.raw : {}
  const directModId = toSafeNumber(item?.mod_id || item?.modId || raw?.mod_id || raw?.modId, 0)
  if (directModId > 0) {
    return directModId
  }

  const sourceModKey = String(
    item?.source_mod_key || item?.sourceModKey || raw?.source_mod_key || raw?.sourceModKey || ''
  ).trim()
  const parts = sourceModKey
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) {
    return 0
  }

  return toSafeNumber(parts[0].toLowerCase() === 'modio' ? parts[1] : parts[0], 0)
}

const installedModioModRecordMap = computed(() => {
  const map = new Map()
  const safeList = Array.isArray(installedModioMods.value) ? installedModioMods.value : []
  for (const item of safeList) {
    const modId = resolveInstalledModioRecordModId(item)
    if (modId <= 0 || map.has(modId)) {
      continue
    }
    map.set(modId, item)
  }
  return map
})
const installedModioRefreshScheduler = createSourceInstallTaskRefreshScheduler(
  () => refreshInstalledModioMods(),
  {
    logMessage: '刷新 Mod.io 已安装模组失败'
  }
)
const untranslatedModioFileCount = computed(() =>
  countUntranslatedModioFiles(downloadModal.value.files)
)
const modioFileTranslateButtonText = computed(() =>
  untranslatedModioFileCount.value > 0 ? '翻译当前文件列表' : '文件列表已翻译'
)

const gameDisplayName = computed(() => {
  return gamePresentation(gameBaseInfo.value).title || gameBaseInfo.value.nameId || 'Mod.io'
})

const headerTags = computed(() => {
  const tags = [modioInstallPolicy.displayName]
  if (gameBaseInfo.value.id) {
    tags.push(`Game ID ${gameBaseInfo.value.id}`)
  }
  if (gameBaseInfo.value.nameId) {
    tags.push(gameBaseInfo.value.nameId)
  }
  return tags
})

const headerStats = computed(() => [
  {
    get label() { return uiText('modBrowser.count') },
    value: formatNumber(pageData.value.total || gameBaseInfo.value.modCount || 0),
    accent: true
  }
])

const headerStatusText = computed(() => {
  if (!hasApiKey.value) {
    return uiText('ui.noAPIKeyConfigured')
  }
  if (detectStatus.value === 'identified') {
    return uiText('modBrowser.identified')
  }
  if (detectStatus.value === 'scanning') {
    return uiText('modBrowser.scanning')
  }
  if (detectStatus.value === 'no_rule') {
    return installRuleFailure.value?.label || uiText('ui.noRulesConfigured')
  }
  if (detectStatus.value === 'unidentified') {
    return uiText('modBrowser.unidentified')
  }
  return uiText('modBrowser.unknownStatus')
})

const headerStatusSubText = computed(() => '')

const headerStatusType = computed(() => {
  if (!hasApiKey.value) return 'danger'
  if (detectStatus.value === 'identified') return 'success'
  if (detectStatus.value === 'no_rule') return 'danger'
  if (detectStatus.value === 'unidentified') return 'danger'
  return 'info'
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
    disabled: !canInstallByRule.value
  },
  {
    key: 'manage-local-mod',
    get label() { return uiText('localMod.title') },
    placement: 'more',
    loading: detectStatus.value === 'scanning',
    disabled: detectStatus.value === 'scanning'
  },
  {
    key: 'launch',
    label: launchGameButtonText.value,
    type: 'primary',
    disabled: !canLaunchGame.value
  },
  {
    key: 'open-root',
    get label() { return uiText('modBrowser.openRoot') },
    placement: 'more',
    visible: canOpenGameRoot.value
  },
  {
    key: 'scan',
    get label() { return uiText('ui.scanNow') },
    get loadingText() { return uiText('modBrowser.scanning') },
    placement: 'more',
    loading: detectStatus.value === 'scanning',
    disabled:
      detectStatus.value === 'scanning' || !hasModioInstallRuleContent(currentModioRule.value)
  },
  {
    key: 'manual-bind',
    get label() { return uiText('ui.addManually') },
    placement: 'more',
    visible: canManualBindGame.value,
    loading: detectStatus.value === 'scanning'
  },
  {
    key: 'rule-config',
    get label() { return uiText('ui.editInstallationRules') },
    placement: 'more'
  }
])

const listNotice = computed(() => {
  if (hasApiKey.value) {
    return { show: false }
  }

  return {
    show: true,
    get title() { return uiText('ui.noModIoAPIKeyDetected') },
    get text() { return uiText('ui.addAModIoAPIKeyUnderAPISettingsFirst') },
    actionText: '查看提示'
  }
})

function toSafeText(value = '', fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function buildModioTitleTranslationKey(item = {}) {
  return `mod:${toSafeNumber(item?.modId || item?.id, 0)}:title`
}

function buildModioSummaryTranslationKey(item = {}) {
  return `mod:${toSafeNumber(item?.modId || item?.id, 0)}:summary`
}

function buildModioFileTranslationKey(file = {}) {
  const modId = toSafeNumber(file?.modId || getCardModId(downloadModal.value.item || {}), 0)
  const fileId = toSafeNumber(file?.fileId || file?.id, 0)
  return `file:${modId}:${fileId}:name`
}

function mergeTranslationResultMap(resultMap = new Map(), textStateRef, resolvedStateRef) {
  if (!(resultMap instanceof Map) || resultMap.size <= 0) {
    return 0
  }

  const nextTextState = {
    ...(textStateRef?.value || {})
  }
  const nextResolvedState = {
    ...(resolvedStateRef?.value || {})
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

  textStateRef.value = nextTextState
  resolvedStateRef.value = nextResolvedState
  return updatedCount
}

function isModioTranslationKeyResolved(translationKey = '') {
  return !!modioTranslationResolvedMap.value[String(translationKey || '').trim()]
}

function isModioFileTranslationKeyResolved(translationKey = '') {
  return !!modioFileTranslationResolvedMap.value[String(translationKey || '').trim()]
}

function getModioTranslatedTitle(item = {}) {
  if (!canUseModioAiTranslation.value) {
    return ''
  }

  const original = toSafeText(item?.name)
  const translated = toSafeText(modioTranslationMap.value[buildModioTitleTranslationKey(item)])
  return translated && translated !== original ? translated : ''
}

function getModioTranslatedDescription(item = {}) {
  if (!canUseModioAiTranslation.value) {
    return ''
  }

  const original = toSafeText(item?.summary)
  const translated = toSafeText(modioTranslationMap.value[buildModioSummaryTranslationKey(item)])
  return translated && translated !== original ? translated : ''
}

function getModioTranslatedFileName(file = {}) {
  if (!canUseModioAiTranslation.value) {
    return ''
  }

  const original = toSafeText(file?.name)
  const translated = toSafeText(modioFileTranslationMap.value[buildModioFileTranslationKey(file)])
  return translated && translated !== original ? translated : ''
}

function isModioCardTranslationResolved(item = {}) {
  const modId = toSafeNumber(item?.modId || item?.id, 0)
  if (modId <= 0) {
    return true
  }

  const requiredKeys = []
  if (toSafeText(item?.name)) {
    requiredKeys.push(buildModioTitleTranslationKey(item))
  }
  if (toSafeText(item?.summary)) {
    requiredKeys.push(buildModioSummaryTranslationKey(item))
  }

  return (
    requiredKeys.length <= 0 ||
    requiredKeys.every((translationKey) => isModioTranslationKeyResolved(translationKey))
  )
}

function isModioFileTranslationResolved(file = {}) {
  if (!toSafeNumber(file?.fileId || file?.id, 0)) {
    return true
  }
  return !buildModioFileTranslationRequestItems([file], downloadModal.value.item, { unresolvedOnly: true }).length
}

function getModioFileChangelogPlan(file = {}) {
  return createDescriptionTranslationPlan({
    id: buildModioFileTranslationKey(file).replace(/:name$/, ':changelog'),
    text: file?.changelog,
    kind: 'file_description'
  })
}

function getModioTranslatedFileChangelog(file = {}) {
  return canUseModioAiTranslation.value ? getModioFileChangelogPlan(file).apply(modioFileTranslationMap.value) : ''
}

function buildModioTranslationRequestItems(list = pageMods.value, options = {}) {
  const safeList = Array.isArray(list) ? list : []
  const unresolvedOnly = !!options?.unresolvedOnly
  const requestItems = []

  for (const item of safeList) {
    const modId = toSafeNumber(item?.modId || item?.id, 0)
    const displayName = toSafeText(item?.name)
    const description = toSafeText(item?.summary)
    if (modId <= 0) {
      continue
    }

    if (displayName) {
      const titleKey = buildModioTitleTranslationKey(item)
      if (!unresolvedOnly || !isModioTranslationKeyResolved(titleKey)) {
        requestItems.push({
          id: titleKey,
          text: displayName,
          kind: 'mod_name',
          context: uiText('ui.gameValueVariant3', { value1: (gameDisplayName.value) })
        })
      }
    }

    if (description) {
      const summaryKey = buildModioSummaryTranslationKey(item)
      if (!unresolvedOnly || !isModioTranslationKeyResolved(summaryKey)) {
        requestItems.push({
          id: summaryKey,
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.gameValueModValue', { value1: (gameDisplayName.value), value2: (displayName || modId) })
        })
      }
    }
  }

  return requestItems
}

function buildModioFileTranslationRequestItems(list = [], mod = {}, options = {}) {
  const safeList = Array.isArray(list) ? list : []
  const unresolvedOnly = !!options?.unresolvedOnly
  const modName = toSafeText(mod?.name || mod?.title || getCardDisplayName(mod))
  return safeList
    .flatMap((file) => {
      const fileId = toSafeNumber(file?.fileId || file?.id, 0)
      const fileName = toSafeText(file?.name)
      const cacheKey = buildModioFileTranslationKey(file)
      if (fileId <= 0) return []
      const context = uiText('ui.gameValueModValue', { value1: (gameDisplayName.value), value2: (modName || '--') })
      const nameItems = fileName ? [{ id: cacheKey, text: fileName, kind: 'file_name', context }] : []
      return [...nameItems, ...getModioFileChangelogPlan(file).items.map((entry) => ({ ...entry, context }))]
        .filter((entry) => !unresolvedOnly || !isModioFileTranslationKeyResolved(entry.id))
    })
    .filter(Boolean)
}

const listItems = computed(() => {
  return pageMods.value.map((item) => {
    const translatedTitle = getModioTranslatedTitle(item)
    const translatedDescription = getModioTranslatedDescription(item)
    const translationResolved = isModioCardTranslationResolved(item)
    const itemKey = String(item?.modId || item?.id || item?.name || '').trim()
    const installedRecord =
      installedModioModRecordMap.value.get(toSafeNumber(item?.modId, 0)) || null
    const installedVersion = String(installedRecord?.version || '').trim()
    return {
      id: item.id,
      cover: item.pictureUrl,
      title: item.name,
      translatedTitle,
      subtitle: item.author ? uiText('ui.authorValueVariant2', { value1: (item.author) }) : '',
      description: item.summary || uiText('ui.noDescription'),
      translatedDescription,      tags: [
        ...item.tags,
        ...(item.version ? [uiText('ui.versionValue', { value1: (item.version) })] : []),
        ...(item.subscribers ? [uiText('ui.subscriptionsValue', { value1: (formatNumber(item.subscribers)) })] : [])
      ].slice(0, 4),
      detailText: '详情',
      installable: true,
      installText: canInstallByRule.value ? (installedRecord ? '重装' : '安装') : '下载',
      installingText: canInstallByRule.value ? '安装中...' : '下载中...',
      installing: !!downloadingMap.value[`mod:${item.modId}`],
      translateActionText: modioItemTranslationLoadingMap.value[itemKey] ? '翻译中...' : '翻译',
      translateHidden: !canUseModioAiTranslation.value || translationResolved,
      translateDisabled: !!modioItemTranslationLoadingMap.value[itemKey],
      actionButtons: [],
      installedText: installedRecord
        ? installedVersion
          ? uiText('ui.installedValue', { value1: (installedVersion) })
          : '已安装'
        : '',
      downloadCount: item.downloads,
      raw: {
        ...item.raw,
        sourcePageUrl: item.profileUrl,
        domainName: '',
        modId: item.modId,
        gameId: item.gameId,
        name: item.name,
        summary: item.summary,
        version: item.version,
        profileUrl: item.profileUrl
      }
    }
  })
})

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatNumber(value) {
  return toSafeNumber(value, 0).toLocaleString('zh-CN')
}

function normalizeSystemConfig(data) {
  const target = data && typeof data === 'object' ? data : {}
  const modioApi = target.modioApi && typeof target.modioApi === 'object' ? target.modioApi : {}
  return {
    ...target,
    modioApi: getModioApiConfig(modioApi),
    aiTranslation: normalizeAiTranslationConfig(target.aiTranslation)
  }
}

function getCurrentModioApiConfig() {
  return resolveEffectiveModioApiConfig(
    systemConfig.value?.modioApi,
    getModioApiConfig()
  )
}

function requestSystemConfig() {
  return requestSystemConfigSettings({})
}

async function loadAiSystemConfig() {
  systemConfig.value = normalizeSystemConfig(await requestSystemConfig())
}

function getFileType(file = {}) {
  const source = String(file?.name || file?.downloadUrl || '').trim()
  const match = source.match(/\.([a-z0-9]{2,8})(?:$|\?)/i)
  return match ? match[1].toLowerCase() : 'zip'
}

function getCurrentGameId() {
  return toSafeNumber(gameBaseInfo.value.id || route.params.id, 0)
}

function getCardRawItem(card = {}) {
  return card?.raw && typeof card.raw === 'object' ? card.raw : card || {}
}

function getCardModId(card = {}) {
  const raw = getCardRawItem(card)
  return toSafeNumber(raw?.modId || raw?.id || card?.modId || card?.id, 0)
}

function getCardDisplayName(card = {}) {
  const raw = getCardRawItem(card)
  return String(card?.title || raw?.name || raw?.modName || 'Modio 模组').trim()
}

function setModioDialogSelection(keys = []) {
  if (installSubmitting.value) {
    return
  }
  const validKeys = new Set(downloadModal.value.files.map((file) => resolveModioFileSelectionKey(file)))
  selectedDownloadFileKeys.value = keys.map((key) => String(key)).filter((key) => validKeys.has(key))
}

function handleModioDialogAction(key) {
  if (key === 'download') {
    handleDownloadSelectionSubmit('download', false)
    return
  }
  handleDownloadSelectionSubmit('install', true)
}

function handleModioDependencyAction(key) {
  const dependency = downloadModal.value.dependencies.find(
    (item, index) => String(item?.id || item?.modId || index) === String(key)
  )
  if (dependency?.profileUrl) {
    openExternalUrl(dependency.profileUrl)
  }
}

function handleModioDialogClose() {
  if (downloadModal.value.loading || installSubmitting.value) {
    return
  }
  closeDownloadModal()
}

function resolveModioFileSelectionKey(file = {}) {
  return String(file?.fileId || file?.id || '').trim()
}

function resolvePreferredModioFile(files = []) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => toSafeNumber(file?.fileId || file?.id, 0) > 0)
    .sort((left, right) => toSafeNumber(right?.dateAdded, 0) - toSafeNumber(left?.dateAdded, 0))[0]
}

function createDownloadBatchId(modId, fileId) {
  return `modio_${getCurrentGameId()}_${modId}_${fileId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function setDownloading(key, value) {
  downloadingMap.value = {
    ...downloadingMap.value,
    [key]: !!value
  }
}

function setModioBatchBusy(files = [], value = false) {
  const card = downloadModal.value.item || {}
  const modId = getCardModId(card)
  if (modId) {
    setDownloading(`mod:${modId}`, value)
  }
  ;(Array.isArray(files) ? files : []).forEach((file) => {
    const fileId = toSafeNumber(file?.fileId || file?.id, 0)
    if (modId && fileId) {
      setDownloading(`file:${modId}:${fileId}`, value)
    }
  })
}

async function hydrateModioModTranslations(list = pageMods.value) {
  const safeList = Array.isArray(list) ? list : []
  modioTranslationToken += 1
  const currentToken = modioTranslationToken

  if (!canUseModioAiTranslation.value || !safeList.length) {
    return
  }

  const requestItems = buildModioTranslationRequestItems(safeList)
  if (!requestItems.length) {
    return
  }

  try {
    const translatedMap = await queryCachedTextBatchService({
      systemConfig: systemConfig.value,
      source: 'modio',
      scene: 'mod_list_card',
      items: requestItems
    })

    if (currentToken !== modioTranslationToken || !translatedMap.size) {
      return
    }

    mergeTranslationResultMap(translatedMap, modioTranslationMap, modioTranslationResolvedMap)
  } catch (error) {
    console.warn('[MODIO] 模组翻译缓存读取失败', error)
  }
}

async function translateModioMods(list = pageMods.value, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const edgeOnly = options?.edgeOnly === true
  const shouldApplyResult =
    typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
  const requestItems = buildModioTranslationRequestItems(list, {
    unresolvedOnly: true
  })

  if ((!edgeOnly && !canUseModioAiTranslation.value) || !requestItems.length) {
    return 0
  }

  const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
  const translatedMap = await translateService({
    systemConfig: systemConfig.value,
    source: 'modio',
    scene: 'mod_list_card',
    items: requestItems,
    onChunkSettled: onProgress
      ? ({ chunkResultMap }) => {
          if (!shouldApplyResult()) {
            return
          }
          mergeTranslationResultMap(
            chunkResultMap,
            modioTranslationMap,
            modioTranslationResolvedMap
          )
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

  return mergeTranslationResultMap(translatedMap, modioTranslationMap, modioTranslationResolvedMap)
}

function buildModioAutoTranslationSignature(list = pageMods.value) {
  return [
    'modio',
    query.value.page,
    query.value.effectiveKeyword || query.value.keyword,
    query.value.sort,
    (Array.isArray(list) ? list : []).map((item) => item?.modId || item?.id || '').join(','),
    aiTranslationConfig.value.targetLanguage
  ].join('|')
}

async function autoTranslateModioMods(list = pageMods.value) {
  const signature = buildModioAutoTranslationSignature(list)
  if (
    !signature ||
    modioAutoTranslationCompletedSignature.value === signature ||
    modioAutoTranslationInFlightSignature.value === signature
  ) {
    return
  }

  const requestItems = buildModioTranslationRequestItems(list, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    modioAutoTranslationCompletedSignature.value = signature
    return
  }

  modioAutoTranslationInFlightSignature.value = signature
  try {
    const translatedCount = await translateModioMods(list, {
      edgeOnly: true,
      shouldApplyResult: () => modioAutoTranslationInFlightSignature.value === signature
    })
    if (translatedCount > 0 && modioAutoTranslationInFlightSignature.value === signature) {
      modioAutoTranslationCompletedSignature.value = signature
    }
  } catch (error) {
    console.warn('[MODIO] 模组自动翻译失败', error)
  } finally {
    if (modioAutoTranslationInFlightSignature.value === signature) {
      modioAutoTranslationInFlightSignature.value = ''
    }
  }
}

function resetModioPageTranslationProgress() {
  modioPageTranslationProgress.value = {
    current: 0,
    total: 0
  }
}

function updateModioPageTranslationProgress(total = 0) {
  modioPageTranslationProgress.value = {
    current: Math.max(total - countUntranslatedModioMods(pageMods.value), 0),
    total: Math.max(Number(total || 0), 0)
  }
}

function countUntranslatedModioFiles(list = downloadModal.value.files) {
  return (Array.isArray(list) ? list : []).filter((file) => !isModioFileTranslationResolved(file))
    .length
}

async function hydrateModioFileTranslations(list = [], mod = {}) {
  const safeList = Array.isArray(list) ? list : []
  modioFileTranslationToken += 1
  const currentToken = modioFileTranslationToken

  if (!canUseModioAiTranslation.value || !safeList.length) {
    return
  }

  const requestItems = buildModioFileTranslationRequestItems(safeList, mod)
  if (!requestItems.length) {
    return
  }

  try {
    const translatedMap = await queryCachedTextBatchService({
      systemConfig: systemConfig.value,
      source: 'modio',
      scene: 'file_list',
      items: requestItems
    })

    if (currentToken !== modioFileTranslationToken || !translatedMap.size) {
      return
    }

    mergeTranslationResultMap(
      translatedMap,
      modioFileTranslationMap,
      modioFileTranslationResolvedMap
    )
  } catch (error) {
    console.warn('[MODIO] 文件列表翻译缓存读取失败', error)
  }
}

async function translateModioFileList(list = [], mod = {}, options = {}) {
  const currentToken = modioFileTranslationToken
  const edgeOnly = options?.edgeOnly === true
  const shouldApplyResult =
    typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
  const requestItems = buildModioFileTranslationRequestItems(list, mod, {
    unresolvedOnly: true
  })

  if ((!edgeOnly && !canUseModioAiTranslation.value) || !requestItems.length) {
    return 0
  }

  const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
  const translatedMap = await translateService({
    systemConfig: systemConfig.value,
    source: 'modio',
    scene: 'file_list',
    items: requestItems
  })

  if (currentToken !== modioFileTranslationToken || !shouldApplyResult()) {
    return 0
  }

  return mergeTranslationResultMap(
    translatedMap,
    modioFileTranslationMap,
    modioFileTranslationResolvedMap
  )
}

function buildModioFileAutoTranslationSignature(list = [], mod = {}) {
  return [
    'modio-file',
    getCardModId(mod),
    (Array.isArray(list) ? list : []).map((item) => `${item?.fileId || item?.id}:${item?.name || ''}:${item?.changelog || ''}`).join('|'),
    aiTranslationConfig.value.targetLanguage
  ].join('|')
}

async function autoTranslateModioFileList(list = [], mod = {}) {
  const signature = buildModioFileAutoTranslationSignature(list, mod)
  if (
    !signature ||
    modioFileAutoTranslationCompletedSignature.value === signature ||
    modioFileAutoTranslationInFlightSignature.value === signature
  ) {
    return
  }

  const requestItems = buildModioFileTranslationRequestItems(list, mod, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    modioFileAutoTranslationCompletedSignature.value = signature
    return
  }

  modioFileAutoTranslationInFlightSignature.value = signature
  const currentToken = modioFileTranslationToken
  modioFileTranslationLoading.value = true
  try {
    const translatedCount = await translateModioFileList(list, mod, {
      edgeOnly: true,
      shouldApplyResult: () => modioFileAutoTranslationInFlightSignature.value === signature
    })
    if (translatedCount > 0 && modioFileAutoTranslationInFlightSignature.value === signature &&
        !buildModioFileTranslationRequestItems(list, mod, { unresolvedOnly: true }).length) {
      modioFileAutoTranslationCompletedSignature.value = signature
    }
  } catch (error) {
    console.warn('[MODIO] 文件列表自动翻译失败', error)
  } finally {
    if (currentToken === modioFileTranslationToken && modioFileAutoTranslationInFlightSignature.value === signature) {
      modioFileAutoTranslationInFlightSignature.value = ''
    }
    if (currentToken === modioFileTranslationToken) modioFileTranslationLoading.value = false
  }
}

function parseModioRuleJson(rawRuleJson) {
  if (rawRuleJson && typeof rawRuleJson === 'object' && !Array.isArray(rawRuleJson)) {
    return compileInstallRuleJson(rawRuleJson)
  }

  const text = String(rawRuleJson || '').trim()
  if (!text) {
    return {}
  }

  return compileInstallRuleJson(parseInstallRuleJsonText(text))
}

function normalizeModioGameRulePayload(rawPayload = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}
  const nestedRule =
    source.rule && typeof source.rule === 'object' && !Array.isArray(source.rule)
      ? source.rule
      : null
  const target = nestedRule || source
  const rawRuleJson =
    target.ruleJson ??
    target.rule_json ??
    target.ruleJsonText ??
    target.rule_json_text ??
    source.ruleJsonText ??
    source.rule_json_text ??
    target.ruleBody ??
    target.rule_body ??
    (target.install_rules || target.installRules || target.game_detect || target.gameDetect
      ? target
      : {})
  let ruleJson = {}

  try {
    ruleJson = parseModioRuleJson(rawRuleJson)
  } catch (error) {
    console.warn('[MODIO] 安装规则解析失败', error)
    ruleJson = {}
  }

  return {
      ...target,
    id: toSafeNumber(target.id || source.id, 0),
    modioGameId: toSafeNumber(
      target.modioGameId || target.modio_game_id || source.modioGameId || getCurrentGameId(),
      0
    ),
    gameId: toSafeNumber(target.gameId || target.game_id || source.gameId || source.game_id, 0),
    nameId: String(
      target.nameId ||
        target.name_id ||
        source.nameId ||
        source.name_id ||
        gameBaseInfo.value.nameId
    ).trim(),
    ruleVersion: toSafeNumber(
      target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version,
      0
    ),
    sourceType: String(
      target.sourceType || target.source_type || source.sourceType || 'server'
    ).trim(),
    ruleJson
  }
}

function hasModioInstallRuleContent(rule = null) {
  const ruleJson =
    rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
      ? rule.ruleJson
      : null
  const installRules = Array.isArray(ruleJson?.install_rules)
    ? ruleJson.install_rules
    : Array.isArray(ruleJson?.installRules)
      ? ruleJson.installRules
      : []

  return installRules.length > 0
}

function getCurrentNameId() {
  return String(gameBaseInfo.value.nameId || route.query?.nameId || '').trim()
}

function getCurrentSteamAppId() {
  return toSafeNumber(route.query?.appId || route.query?.steamAppId, 0)
}

function resolveCurrentModioAppId() {
  return toSafeNumber(modioBinding.value?.appId || getCurrentGameId(), 0)
}

function getDetectedModioGameRoot() {
  return String(modioBinding.value?.detectedRootPath || '').trim()
}

function buildModioSourceMeta(extra = {}) {
  const modioGameId = getCurrentGameId()
  return {
    source: 'modio',
    sourceId: modioGameId,
    sourceSlug: getCurrentNameId(),
    appId: resolveCurrentModioAppId(),
    modioGameId,
    ruleVersion: toSafeNumber(currentModioRule.value?.ruleVersion, 0) || null,
    modName: String(extra?.modName || '').trim(),
    fileName: String(extra?.fileName || '').trim(),
    profileName: String(extra?.profileName || '').trim()
  }
}

function buildMainModioInstallRule() {
  return hasModioInstallRuleContent(currentModioRule.value) ? currentModioRule.value.ruleJson : {}
}

async function loadLocalModioRuleCache() {
  const modioGameId = getCurrentGameId()
  if (!modioGameId) {
    return null
  }

  try {
    const localRule = await invokeIpc('modioGetLatestGameRule', {
      modioGameId
    })
    return localRule ? normalizeModioGameRulePayload(localRule) : null
  } catch (error) {
    console.warn('[MODIO] 读取本地安装规则缓存失败', error)
    return null
  }
}

function buildModioInstallConfigMatchParams() {
  const modioGameId = getCurrentGameId()
  return {
    sourcePlatform: 'modio',
    gameKey: route.query?.gameKey ||  modioGameId ? `modio:${modioGameId}` : '',
    gameId: null,
    nexusGameId: null,
    domainName: getCurrentNameId(),
    appId: getCurrentSteamAppId() || null
  }
}

function hasModioInstallConfigMatchIdentifier(params = {}) {
  return !!(
    String(params?.gameKey || '').trim() ||
    String(params?.domainName || '').trim() ||
    toSafeNumber(params?.gameId, 0) > 0 ||
    toSafeNumber(params?.appId, 0) > 0
  )
}

async function loadMatchedModioInstallConfigRule() {
  installRuleFailure.value = null
  const modioGameId = getCurrentGameId()
  const params = buildModioInstallConfigMatchParams()
  if (!hasModioInstallConfigMatchIdentifier(params)) {
    return null
  }

  try {
    const response = await GET_SHARED_INSTALL_RULE(params)
    const ruleJsonText = String(response?.ruleJsonText || '').trim()
    if (!ruleJsonText) {
      return null
    }

    const normalizedRule = normalizeModioGameRulePayload({
      ...response,
      ruleJsonText,
      modioGameId,
      nameId: getCurrentNameId(),
      sourceType: 'server'
    })

    if (!hasModioInstallRuleContent(normalizedRule)) {
      return null
    }



    return normalizedRule
  } catch (error) {
    console.warn('[MODIO] 统一安装配置匹配失败，公共规则当前不可用', error)
    installRuleFailure.value = describeSharedRuleFailure(error)
    return null
  }
}

async function loadCloudModioRuleFromServer() { return loadMatchedModioInstallConfigRule() }

async function doLoadCurrentModioRule() {
  // Public rules do not require Mod.io credentials, which may still be loading on entry.
  const cloudRule = await loadCloudModioRuleFromServer()
  const storedRule = await loadLocalModioRuleCache()
  const privateRule = ['local_override', 'player_profile', 'local', 'player'].includes(storedRule?.sourceType) ? storedRule : null
  const localRule = privateRule || cloudRule
  currentModioRule.value = hasModioInstallRuleContent(localRule) ? localRule : null
}

async function refreshImportedRule() {
  try {
    await loadCurrentModioRule()
    await resolveModioBindingByRule()
    await refreshInstalledModioMods()
  } catch (error) {
    $message.warning(uiMessage('ui.rulesSavedButGameStatusRefreshFailedValue', { value1: (error?.message || uiText('ui.reopenThisPage')) }))
  }
}

function buildCurrentModioRuleLoadKey() {
  return [getCurrentGameId(), getCurrentNameId(), getCurrentSteamAppId()].join('|')
}

async function loadCurrentModioRule() {
  const loadKey = buildCurrentModioRuleLoadKey()
  if (currentModioRuleLoadPromise && currentModioRuleLoadKey === loadKey) {
    return currentModioRuleLoadPromise
  }

  currentModioRuleLoadKey = loadKey
  currentModioRuleLoadPromise = doLoadCurrentModioRule().finally(() => {
    if (currentModioRuleLoadKey === loadKey) {
      currentModioRuleLoadPromise = null
      currentModioRuleLoadKey = ''
    }
  })
  return currentModioRuleLoadPromise
}

async function upsertDetectedModioBinding(detectResult = {}) {
  const modioGameId = getCurrentGameId()
  const result = await invokeIpc('modioUpsertGameBinding', {
    modioGameId,
    nameId: getCurrentNameId(),
    appId: modioGameId,
    backendGameId: toSafeNumber(currentModioRule.value?.gameId, 0),
    gameName: gameDisplayName.value,
    coverImage: String(gameBaseInfo.value.coverImage || '').trim(),
    ruleVersion: toSafeNumber(currentModioRule.value?.ruleVersion, 0),
    detectedRootPath: String(detectResult?.rootPath || '').trim(),
    detectedExePath: String(detectResult?.exePath || '').trim()
  })

  if (!result?.success || !result?.binding) {
    throw new Error(String(result?.reason || uiText('ui.couldNotSaveGamePath')))
  }

  modioBinding.value = result.binding
  detectStatus.value = 'identified'
  return result.binding
}

async function resolveModioBindingByRule() {
  const modioGameId = getCurrentGameId()
  if (!hasModioInstallRuleContent(currentModioRule.value)) {
    modioBinding.value = null
    detectStatus.value = 'no_rule'
    return
  }

  detectStatus.value = 'scanning'
  try {
    const existingBinding = await invokeIpc('modioGetGameBinding', {
      modioGameId,
      nameId: getCurrentNameId(),
      appId: modioGameId
    })

    if (existingBinding?.detectedRootPath) {
      modioBinding.value = existingBinding
      detectStatus.value = 'identified'
      return
    }

    const detectResult = await invokeIpc('modioDetectGameRootByRule', {
      modioGameId,
      nameId: getCurrentNameId(),
      domainName: getCurrentNameId(),
      ruleJson: currentModioRule.value.ruleJson
    })

    if (detectResult?.success) {
      await upsertDetectedModioBinding(detectResult)
      return
    }

    modioBinding.value = null
    detectStatus.value = 'unidentified'
  } catch (error) {
    console.warn('[MODIO] 识别游戏路径失败', error)
    modioBinding.value = null
    detectStatus.value = 'unidentified'
  }
}

function applyRouteInfo() {
  const gameId = toSafeNumber(route.params.id, 0)
  gameBaseInfo.value = {
    id: gameId,
    name: String(route.query?.name || '').trim(),
    englishTitle: String(route.query?.englishTitle || '').trim(),
    nameId: String(route.query?.nameId || '').trim(),
    coverImage: String(route.query?.cover || '').trim(),
    description: String(route.query?.desc || '').trim(),
    modCount: toSafeNumber(route.query?.mods, 0),
    profileUrl: String(route.query?.profileUrl || '').trim()
  }
}

async function resolveModioGameDisplayName() {
  const rawName = String(gameBaseInfo.value.name || gameBaseInfo.value.nameId || '').trim()
  if (!rawName) {
    return
  }

  try {
    const resolved = await resolveGameNameFromDict({
      sourcePlatform: 'modio',
      rawName,
      fallbackName: gameBaseInfo.value.name || gameBaseInfo.value.nameId
    })
    const displayName = String(resolved?.displayName || '').trim()
    if (displayName) {
      gameBaseInfo.value = {
        ...gameBaseInfo.value,
        englishTitle: gameBaseInfo.value.englishTitle || resolved?.rawName || rawName,
        name: displayName
      }
    }
  } catch (error) {
    console.warn('[MODIO] 游戏中文名字典解析失败', error)
  }
}

function syncMenuName() {
  setPageMenuName(() => `[Mod]-${gameDisplayName.value}`, route.path)
}

async function loadModList() {
  const gameId = toSafeNumber(gameBaseInfo.value.id || route.params.id, 0)
  if (!gameId) {
    $message.warning(uiMessage('ui.modIoGameIDMissingCannotLoadMods'))
    return
  }

  if (!hasApiKey.value) {
    pageData.value = {
      records: [],
      total: 0,
      pages: 1,
      current: 1
    }
    return
  }

  loading.value = true
  try {
    const { effectiveKeyword, ...baseQuery } = query.value
    const requestQuery = {
      ...baseQuery,
      keyword: effectiveKeyword || query.value.keyword
    }
    pageData.value = await getModioModList(gameId, getCurrentModioApiConfig(), requestQuery)
  } catch (error) {
    console.error('加载 Modio 模组列表失败', error)
    pageData.value = {
      records: [],
      total: 0,
      pages: 1,
      current: 1
    }
    $message.warning(uiMessage('ui.couldNotLoadModIoModsCheckYourAPIKey'))
  } finally {
    loading.value = false
  }
}

async function refreshInstalledModioMods() {
  const gameId = getCurrentGameId()
  if (!gameId) {
    installedModioMods.value = []
    return
  }

  try {
    const result = await invokeIpc('getInstalledModsBySource', {
      appId: resolveCurrentModioAppId(),
      endpointType: 0,
      sourceMeta: buildModioSourceMeta()
    })
    const records = Array.isArray(result?.records) ? result.records : []
    const activeProfile = modioProfileState.activeProfileName.value || 'default'
    installedModioMods.value = records.filter(
      (item) => String(item?.profile_name || 'default').trim() === activeProfile
    )
  } catch (error) {
    console.warn('[MODIO] 读取已安装模组数量失败', error)
    installedModioMods.value = []
  }
}

function buildModioInstallTaskGameKeys() {
  const gameId = getCurrentGameId()
  return [gameId ? `modio:${gameId}` : '']
}

async function handleSourceInstallTaskUpdated(_event, data = {}) {
  if (
    !shouldRefreshInstalledModsAfterSourceTask(data, 'modio', buildModioInstallTaskGameKeys(), {
      allowSourceOnly: true
    })
  ) {
    return
  }
  installedModioRefreshScheduler.schedule()
}

function parseModioInstalledMetadata(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  const text = String(value || '').trim()
  if (!text) {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildModioSourceModpackShareItems() {
  return (Array.isArray(installedModioMods.value) ? installedModioMods.value : [])
    .filter((item) => toSafeNumber(item?.is_active ?? item?.isActive, 1) !== 0)
    .map((item, index) => {
      const metadata = parseModioInstalledMetadata(item?.metadata_json || item?.metadata)
      const modId = String(item?.mod_id || item?.modId || '').trim()
      const fileId = String(item?.option_id || item?.fileId || '').trim()
      const sourceModKey =
        String(item?.source_mod_key || item?.sourceModKey || '').trim() ||
        ['modio', modId, fileId].filter(Boolean).join(':')
      if (!modId && !sourceModKey) {
        return null
      }
      const installRulePlan =
        metadata.installRulePlan && typeof metadata.installRulePlan === 'object'
          ? metadata.installRulePlan
          : {}
      const archivePath = String(
        item?.archivePath ||
          item?.archive_path ||
          metadata.archivePath ||
          metadata.archive_path ||
          item?.archivedSourcePath ||
          item?.archived_source_path ||
          metadata.archivedSourcePath ||
          metadata.archived_source_path ||
          ''
      ).trim()
      const stagingPath = String(
        item?.stagingPath ||
          item?.staging_path ||
          metadata.stagingPath ||
          metadata.staging_path ||
          installRulePlan.sourceRoot ||
          installRulePlan.source_root ||
          installRulePlan.lifecycleStagingRoot ||
          installRulePlan.lifecycle_staging_root ||
          ''
      ).trim()
      const sourcePath = String(
        archivePath ||
          stagingPath ||
          item?.sourcePath ||
          item?.source_path ||
          metadata.sourcePath ||
          metadata.source_path ||
          metadata.sourceRoot ||
          metadata.source_root ||
          item?.filePath ||
          item?.file_path ||
          item?.localPath ||
          item?.local_path ||
          metadata.filePath ||
          metadata.file_path ||
          metadata.localPath ||
          metadata.local_path ||
          ''
      ).trim()
      const installRule =
        item?.installRule ||
        metadata.installRule ||
        metadata.sourceInstallRule ||
        buildMainModioInstallRule()

      return {
        sourcePlatform: 'modio',
        sourceModId: modId,
        sourceFileId: fileId,
        sourceModKey,
        name: String(item?.name || item?.option_name || metadata.modName || sourceModKey).trim(),
        displayName: String(
          item?.displayName || item?.name || item?.option_name || metadata.modName || sourceModKey
        ).trim(),
        version: String(item?.version || '').trim(),
        cover: String(item?.cover || metadata.cover || '').trim(),
        summary: String(item?.summary || item?.description || metadata.description || '').trim(),
        author: String(item?.author || metadata.author || metadata.submittedBy || '').trim(),
        isDefaultDependency:
          item?.isDefaultDependency === true ||
          String(item?.dependencyRole || metadata?.category || '').trim() ===
            'default_dependency' ||
          String(sourceModKey || '').startsWith('dependency:'),
        dependentCount: toSafeNumber(item?.dependentCount, 0),
        dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
        sortIndex: toSafeNumber(item?.priority_order ?? item?.priorityOrder, index),
        sourcePath,
        archivePath,
        stagingPath,
        filePath: sourcePath,
        primaryInstallPath: String(
          item?.primaryInstallPath || metadata.primaryInstallPath || ''
        ).trim(),
        targetPath: String(item?.targetPath || metadata.targetPath || '').trim(),
        installRoot: String(
          modioBinding.value?.detectedRootPath || metadata.installRoot || ''
        ).trim(),
        installRule,
        sourceInstallRule: installRule,
      ruleSelection: ['local_override', 'player_profile', 'player', 'local'].includes(currentModioRule.value?.sourceType) ? 'local_override' : 'public',
      sharedRuleDocument: currentModioRule.value?.sharedRuleDocument || null,
        installPayload: item?.installPayload || metadata.installPayload || null,
        metadata: {
          ...metadata,
          sourcePath,
          sourceRoot: sourcePath,
          archivePath,
          stagingPath,
          filePath: sourcePath,
          cover: String(item?.cover || metadata.cover || '').trim(),
          fileName: String(item?.option_name || metadata.fileName || '').trim(),
          profileUrl: String(metadata.profileUrl || '').trim(),
          sourcePageUrl: String(metadata.sourcePageUrl || '').trim(),
          sortIndex: toSafeNumber(item?.priority_order ?? item?.priorityOrder, index)
        }
      }
    })
    .filter(Boolean)
}

function buildModioSourceModpackSnapshot(items = [], name = '') {
  return buildSourceModpackCreatePayload({
    sourceType: 'modio',
    sourceGameId: String(getCurrentGameId()),
    sourceGameSlug: getCurrentNameId(),
    sourceGameName: gameDisplayName.value,
    name,
    cover: gameBaseInfo.value.coverImage,
    items
  })
}

async function prepareModioSourceModpackSnapshot(name = '') {
  if (!getCurrentGameId()) throw new Error(uiText('ui.invalidModIoGameIdentifier'))
  await refreshInstalledModioMods()
  const items = buildModioSourceModpackShareItems()
  if (!items.length) throw new Error(uiText('ui.noInstalledModIoModsAreAvailableToShare'))
  return buildModioSourceModpackSnapshot(items, name)
}

async function shareModioSourceModpack() {
  if (sourceModpackSharing.value) return

  sourceModpackSharing.value = true
  try {
    const snapshot = await prepareModioSourceModpackSnapshot()
    const shareName = await requestSourceModpackShareName(
      uiText('ui.valueModIoModpack', { value1: (gameDisplayName.value || getCurrentGameId()) })
    )
    if (!shareName) {
      return
    }
    const result = await CREATE_SOURCE_MODPACK({ ...snapshot, name: shareName })
    const shareCode = extractSourceModpackShareCode(result)
    if (!shareCode) {
      throw new Error(uiText('ui.noShareCodeWasReturned'))
    }

    const copied = await copySourceModpackTextToClipboard(shareCode)
    if (copied) {
      $message.success(uiMessage('ui.shareCodeCopied'))
    } else {
      $message.warning(uiMessage('ui.shareCodeCreatedValue', { value1: (shareCode) }))
    }
  } catch (error) {
    console.error('生成 Mod.io 分享码失败', error)
    $message.error(uiMessage('ui.couldNotCreateShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
  }
}

async function updateModioSourceModpack() {
  if (sourceModpackSharing.value) return
  sourceModpackSharing.value = true
  try {
    const snapshot = await prepareModioSourceModpackSnapshot()
    sourceModpackUpdateModal.value = { open: true, snapshot }
  } catch (error) {
    console.error('准备 Mod.io 分享更新失败', error)
    $message.error(uiMessage('ui.couldNotUpdateShareValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
  }
}

function openSourceModpackImportModal() {
  if (sourceModpackImportModal.value.loading) {
    return
  }
  sourceModpackImportModal.value = {
    open: true,
    code: '',
    loading: false
  }
}

function closeSourceModpackImportModal() {
  if (sourceModpackImportModal.value.loading) {
    return
  }
  sourceModpackImportModal.value = {
    open: false,
    code: '',
    loading: false
  }
}

async function confirmModioSourceModpackImport() {
  const code = String(sourceModpackImportModal.value.code || '').trim()
  if (!code) {
    $message.warning(uiMessage('ui.enterAShareCode'))
    return
  }
  if (!getCurrentGameId()) {
    $message.warning(uiMessage('ui.invalidModIoGameIdentifierCannotImport'))
    return
  }

  sourceModpackImportModal.value = { ...sourceModpackImportModal.value, loading: true }
  try {
    const inspection = await inspectShareImport({
      shareCode: code,
      entryPoint: 'modio',
      targetContext: {
        localGameInstallationId: toSafeNumber(modioBinding.value?.id, 0),
        sourcePlatform: 'modio',
        sourceGameId: String(getCurrentGameId()),
        sourceGameSlug: getCurrentNameId(),
        appId: resolveCurrentModioAppId(),
        gameName: gameDisplayName.value,
        gameRoot: getDetectedModioGameRoot(),
        endpointType: 0,
        profileName: modioProfileState.activeProfileName.value,
        installRule: buildMainModioInstallRule(),
        currentModioRule: toPlainSourceModpackJson(currentModioRule.value, {}),
        modioApiConfig: getCurrentModioApiConfig()
      }
    })
    if (inspection.mode === 'latest') {
      $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
      closeSourceModpackImportModal()
      return
    }
    if (!(await requestSourceModpackInspectionConfirmation(Modal, inspection))) return
    const profileName = inspection.profileTargets?.[0]?.profileName
    if (profileName) await prepareModioImportProfile(profileName)
    const result = await applyShareImport({ planToken: inspection.planToken, expectedPlanHash: inspection.planHash })
    sourceModpackImportModal.value = { open: false, code: '', loading: false }
    $message.success(result.message || '已加入安装任务')
  } catch (error) {
    console.error('导入 Mod.io 分享码失败', error)
    $message.error(uiMessage('ui.couldNotImportShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackImportModal.value = {
      ...sourceModpackImportModal.value,
      loading: false
    }
  }
}

async function handleSearch() {
  const currentToken = ++modioSearchResolveToken
  const keyword = String(query.value.keyword || '').trim()
  const resolvedKeyword = await resolveEdgeSearchKeyword({
    keyword,
    source: 'modio',
    scene: 'mod_search_keyword',
    systemConfig: systemConfig.value,
    context: 'Mod.io 模组搜索'
  })
  if (
    currentToken !== modioSearchResolveToken ||
    String(query.value.keyword || '').trim() !== keyword
  ) {
    return
  }
  query.value.keyword = keyword
  query.value.effectiveKeyword = resolvedKeyword.effectiveKeyword
  query.value.page = 1
  loadModList()
}

function handleReset() {
  modioSearchResolveToken += 1
  query.value.effectiveKeyword = ''
  query.value.page = 1
  loadModList()
}

function changePage(page) {
  query.value.page = page
  loadModList()
}

function handleSortChange(value) {
  query.value.sort = value
  query.value.page = 1
  loadModList()
}

function handleNoticeAction() {
  $message.info(uiMessage('ui.openAPISettingsAndEnterYourModIoAPIURL'))
}

function openGameRootPath() {
  const rootPath = String(modioBinding.value?.detectedRootPath || '').trim()
  if (!rootPath) {
    $message.warning(uiMessage('ui.noGameFolderDetectedYet'))
    return
  }
  sendIpc('openSpecifyPath', rootPath)
}

function launchGame() {
  if (!canLaunchGame.value) {
    $message.warning(uiMessage('ui.detectTheGamePathBeforeLaunching'))
    return
  }

  if (!detectedGameExecutablePath.value) {
    $message.warning(uiMessage('ui.theGameFolderWasDetectedButNoExecutablePathIs'))
    return
  }

  sendIpc('startSpecifiedApp', {
    path: detectedGameExecutablePath.value,
    steamAppId: null
  })
}

function openInstalledManager(options = {}) {
  if (!canInstallByRule.value) {
    $message.warning(uiMessage('ui.detectTheGamePathBeforeManagingInstalledMods'))
    return
  }

  const modioGameId = getCurrentGameId()
  const backendGameId = toSafeNumber(currentModioRule.value?.gameId, 0)
  const appId = resolveCurrentModioAppId()
  const query = Object.fromEntries(
    Object.entries({
      source: 'modio',
      sourceId: String(modioGameId || ''),
      modioGameId: String(modioGameId || ''),
      gameId: String(backendGameId || ''),
      backendGameId: String(backendGameId || ''),
      appId: String(appId || ''),
      name: gameDisplayName.value,
      nameId: getCurrentNameId(),
      cover: String(gameBaseInfo.value.coverImage || '').trim(),
      rootPath: String(modioBinding.value?.detectedRootPath || '').trim(),
      action: options.action
    }).filter(([, value]) => String(value || '').trim() !== '')
  )

  router.push({
    name: 'GameModManagement',
    params: {
      source: 'modio',
      id: String(modioGameId || route.params.id || '')
    },
    query
  })
}

function handleHeaderAction(actionKey = '') {
  const key = String(actionKey || '').trim()
  if (key === 'profile-scheme') {
    openProfileSchemeModal()
    return
  }
  if (key === 'manual-bind') {
    selectGameRootByRule()
    return
  }
  if (key === 'scan') {
    resolveModioBindingByRule().then()
    return
  }
  if (key === 'launch') {
    launchGame()
    return
  }
  if (key === 'open-root') {
    openGameRootPath()
    return
  }
  if (key === 'manage') {
    openInstalledManager()
    return
  }
  if (key === 'manage-local-mod') {
    openLocalBindingWithGameRootCheck()
    return
  }
  if (key === 'rule-config') {
    openModioRuleConfigPage()
    return
  }
  if (key === 'share-source-modpack') {
    shareModioSourceModpack().then()
    return
  }
  if (key === 'import-source-modpack') {
    openSourceModpackImportModal()
  }
}

function openExternalUrl(url = '') {
  const safeUrl = String(url || '').trim()
  if (!safeUrl) {
    $message.warning(uiMessage('ui.noLinkAvailableToOpen'))
    return
  }
  sendIpc('openBrowse', { url: safeUrl })
}

function isValidSiteDetailUrl(url = '') {
  return /^https?:\/\/[^\s"']+$/i.test(String(url || '').trim())
}

function resolveModioDetailUrl(item = {}) {
  const urlCandidates = [
    item?.profileUrl,
    item?.sourcePageUrl,
    item?.profile_url,
    item?.source_page_url
  ]
  let hasInvalidUrl = false
  for (const candidate of urlCandidates) {
    const url = String(candidate || '').trim()
    if (!url) {
      continue
    }
    if (isValidSiteDetailUrl(url)) {
      return {
        url,
        hasInvalidUrl: false
      }
    }
    hasInvalidUrl = true
  }
  return {
    url: '',
    hasInvalidUrl
  }
}

function openModioModPage(card = {}) {
  const rawItem = card?.raw || card
  const detailUrl = resolveModioDetailUrl(rawItem)
  const url = detailUrl.url
  if (!url) {
    $message.warning(detailUrl.hasInvalidUrl ? '当前模组详情链接无效' : '当前模组缺少详情链接')
    return
  }

  const modId = toSafeNumber(rawItem?.modId || rawItem?.id, 0)
  router.push(
    buildGameSiteDetailRoute({
      url,
      title: String(rawItem?.name || card?.title || uiText('ui.modIoModDetails')).trim(),
      subtitle: String(
        rawItem?.author ? uiText('ui.authorValueVariant2', { value1: (rawItem.author) }) : modId ? `Mod ID：${modId}` : ''
      ).trim(),
      source: 'Mod.io',
      sourceKey: 'modio',
      cover: String(rawItem?.pictureUrl || rawItem?.cover || card?.cover || '').trim(),
      backPath: route.fullPath,
      gameId: String(toSafeNumber(currentModioRule.value?.gameId, 0) || '').trim(),
      gameName: String(gameBaseInfo.value.name || route.query?.name || '').trim(),
      sourceGameId: String(getCurrentGameId() || '').trim(),
      sourceSlug: String(getCurrentNameId() || '').trim(),
      domainName: String(getCurrentNameId() || '').trim(),
      appId: String(getCurrentSteamAppId() || '').trim(),
      modId: String(modId || '').trim(),
      modName: String(rawItem?.name || card?.title || 'Mod.io 模组详情').trim(),
      author: String(rawItem?.author || '').trim()
    })
  )
}

function handleOpenModDetail(card) {
  openModioModPage(card)
}

function openModioRuleConfigPage() {
  router.push({
    name: 'GameSourceInstallConfig',
    params: {
      sourcePlatform: 'modio',
      id: String(route.params.id || getCurrentGameId())
    },
    query: {
      ...route.query,
      sourcePlatform: 'modio',
      name: gameBaseInfo.value.name || route.query?.name,
      nameId: gameBaseInfo.value.nameId || route.query?.nameId,
      cover: gameBaseInfo.value.coverImage || route.query?.cover,
      desc: gameBaseInfo.value.description || route.query?.desc,
      mods: gameBaseInfo.value.modCount || route.query?.mods,
      profileUrl: gameBaseInfo.value.profileUrl || route.query?.profileUrl,
      gameId: toSafeNumber(currentModioRule.value?.gameId || route.query?.gameId, 0) || undefined
    }
  })
}

async function selectGameRootByRule() {
  if (!hasModioInstallRuleContent(currentModioRule.value)) {
    $message.warning(uiMessage('ui.thisGameHasNoInstallationRulesForFolderDetection'))
    return false
  }

  const previousStatus = detectStatus.value
  detectStatus.value = 'scanning'
  try {
    const detectResult = await invokeIpc('modioSelectAndDetectGameRootByRule', {
      modioGameId: getCurrentGameId(),
      nameId: getCurrentNameId(),
      domainName: getCurrentNameId(),
      defaultPath: String(modioBinding.value?.detectedRootPath || '').trim(),
      ruleJson: currentModioRule.value.ruleJson,
      title: uiText('ui.selectTheValueGameFolder', { value1: (gameDisplayName.value) })
    })

    if (detectResult?.canceled) {
      detectStatus.value = previousStatus
      return false
    }

    if (!detectResult?.success) {
      detectStatus.value = previousStatus
      $message.warning(uiMessage('ui.theSelectedFolderDoesNotMatchThisModIoGame'))
      return false
    }

    await upsertDetectedModioBinding(detectResult)
    $message.success(uiMessage('ui.gameFolderDetectedAndSaved'))
    return true
  } catch (error) {
    detectStatus.value = previousStatus
    console.error('选择 Modio 游戏目录失败', error)
    $message.warning(uiMessage('ui.couldNotDetectGameFolderValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    return false
  }
}

function openLocalBindingWithGameRootCheck() {
  if (detectStatus.value === 'scanning') {
    return
  }

  if (canInstallByRule.value) {
    openInstalledManager({ action: 'manage-local-mod' })
    return
  }

  Modal.confirm({
    get title() { return uiText('ui.noGameDetected') },
    content: '当前还未识别游戏目录，是否先绑定游戏根目录？绑定完成后才能管理本地模组。',
    get okText() { return uiText('ui.chooseFolder') },
    get cancelText() { return uiText('ui.cancel') },
    async onOk() {
      const success = await selectGameRootByRule()
      if (success && canInstallByRule.value) {
        openInstalledManager({ action: 'manage-local-mod' })
      }
    }
  })
}

function closeDownloadModal() {
  downloadModal.value.open = false
  selectedDownloadFileKeys.value = []
}

async function openDownloadModal(card = {}) {
  const gameId = getCurrentGameId()
  const modId = getCardModId(card)
  if (!gameId || !modId) {
    $message.warning(uiMessage('ui.modIoGameIDOrModIDMissingCannotQuery'))
    return
  }

  downloadModal.value = {
    open: true,
    loading: true,
    item: card,
    files: [],
    dependencies: [],
    errorText: '',
    dependencyErrorText: ''
  }
  selectedDownloadFileKeys.value = []

  try {
    const [fileResult, dependencyResult] = await Promise.allSettled([
      getModioModFiles(gameId, modId, getCurrentModioApiConfig()),
      getModioModDependencies(gameId, modId, getCurrentModioApiConfig())
    ])

    if (fileResult.status === 'fulfilled') {
      downloadModal.value.files = fileResult.value?.records || []
    } else {
      console.error('查询 Modio 模组文件失败', fileResult.reason)
      downloadModal.value.errorText = '模组文件查询失败，请检查 API Key 或稍后重试'
    }

    if (dependencyResult.status === 'fulfilled') {
      downloadModal.value.dependencies = dependencyResult.value?.records || []
    } else {
      console.warn('[MODIO] 查询文件弹窗依赖失败', dependencyResult.reason)
      downloadModal.value.dependencyErrorText = '依赖查询失败，请稍后重试'
    }

    if (!downloadModal.value.errorText && !downloadModal.value.files.length) {
      downloadModal.value.errorText = '当前模组没有可下载文件'
    }
  } catch (error) {
    console.error('查询 Modio 模组文件失败', error)
    downloadModal.value.errorText = '模组文件查询失败，请检查 API Key 或稍后重试'
  } finally {
    downloadModal.value.loading = false
  }
}

async function previewSourceInstall(payload = {}) {
  return await invokeIpc('source-install:preview', payload)
}

async function executeSourceInstall(payload = {}) {
  return await invokeIpc('source-install:execute', payload)
}

function isSourceInstallTaskEnabled() {
  return true
}

async function submitModioSourceInstallTask(payload = {}) {
  return await invokeIpc('source-install-task:create', payload)
}

async function buildModioDependencyReferences(modId = 0) {
  const gameId = getCurrentGameId()
  const safeModId = toSafeNumber(modId, 0)
  if (!gameId || !safeModId) {
    return []
  }

  try {
    const result = await getModioModDependencies(gameId, safeModId, getCurrentModioApiConfig())
    return (Array.isArray(result?.records) ? result.records : [])
      .filter((item) => toSafeNumber(item?.modId, 0) > 0)
      .map((item) => ({
        source: 'modio',
        sourceType: 'modio',
        sourceModKey: toSafeNumber(item.fileId || item.file_id, 0)
          ? `modio:${toSafeNumber(item.modId, 0)}:${toSafeNumber(item.fileId || item.file_id, 0)}`
          : `modio:${toSafeNumber(item.modId, 0)}`,
        modId: toSafeNumber(item.modId, 0),
        fileId: toSafeNumber(item.fileId || item.file_id, 0),
        name: String(item.name || '').trim(),
        version: String(item.version || '').trim(),
        dependencyRole: 'modio_requirement'
      }))
  } catch (error) {
    console.warn('[MODIO] 安装前依赖查询失败，继续安装当前文件', error)
    return []
  }
}

function buildModioUnifiedInstallPayload(options = {}) {
  const gameId = getCurrentGameId()
  const modId = toSafeNumber(options?.modId, 0)
  const fileId = toSafeNumber(options?.fileId, 0)
  const targetFile =
    options?.targetFile && typeof options.targetFile === 'object' ? options.targetFile : {}
  const rawCard = options?.rawCard && typeof options.rawCard === 'object' ? options.rawCard : {}
  const modName = String(options?.modName || '').trim()
  const fileName = String(options?.fileName || '').trim()
  const version = String(options?.version || '').trim()
  const dependencyRole = String(options?.dependencyRole || '').trim()
  const parentModId = toSafeNumber(options?.parentModId, 0)
  const parentFileId = toSafeNumber(options?.parentFileId, 0)
  const parentModName = String(options?.parentModName || '').trim()
  const profileName = String(options?.profileName || '').trim()
  const sortIndex = toSafeNumber(options?.sortIndex, 0)
  const installRule = buildMainModioInstallRule()
  const sourceMeta = buildModioSourceMeta({
    modName,
    fileName,
    profileName
  })
  const dependencyOf =
    dependencyRole && parentModId > 0
      ? {
          source: 'modio',
          dependencyRole,
          modId: parentModId,
          fileId: parentFileId,
          name: parentModName,
          sourceModKey: parentFileId
            ? `modio:${parentModId}:${parentFileId}`
            : `modio:${parentModId}`
        }
      : null
  const metadata = {
    category: 'modio',
    source: 'modio',
    sourceMeta,
    fileId,
    platforms: Array.isArray(targetFile?.platforms) ? targetFile.platforms : [],
    profileUrl: String(options?.profileUrl || rawCard?.profileUrl || '').trim(),
    sourcePageUrl: String(options?.sourcePageUrl || rawCard?.sourcePageUrl || '').trim(),
    dependencyRole,
    dependencyOf,
    sortIndex,
    profileName
  }

  return sanitizeIpcPayload(
    {
      source: 'modio',
      sourceType: 'modio',
      sourcePlatform: 'modio',
      sourceAdapter: 'modio',
      sourceGameId: gameId,
      modioGameId: gameId,
      appid: resolveCurrentModioAppId(),
      appId: resolveCurrentModioAppId(),
      gameId: toSafeNumber(currentModioRule.value?.gameId, 0),
      gameName: gameDisplayName.value,
      gameRoot: getDetectedModioGameRoot(),
      clientInstallPath: '.',
      serverInstallPath: '',
      modId,
      fileId,
      id: fileId,
      modName,
      name: fileName,
      packageFolderName: modName || `modio-${modId}`,
      version,
      fileSize: toSafeNumber(targetFile?.filesize || options?.fileSize, 0),
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: 0,
      cover: String(
        options?.cover || rawCard?.logo?.thumb_320x180 || rawCard?.pictureUrl || ''
      ).trim(),
      downloadUrl: String(options?.downloadUrl || '').trim(),
      gameSourceId: String(gameId),
      gameSourceSlug: getCurrentNameId(),
      sourceGameSlug: getCurrentNameId(),
      sourceId: String(modId),
      sourceSlug: getCurrentNameId(),
      sourceGameDomain: getCurrentNameId(),
      sourceModKey: `modio:${modId}:${fileId}`,
      priorityOrder: sortIndex,
      profileName,
      targetProfileName: profileName,
      cleanupSourceArchiveAfterInstall: true,
      fileMd5: String(targetFile?.filehash || '').trim(),
      modVersion: version,
      dependencyRole,
      dependencyOf,
      dependencies: Array.isArray(options?.dependencies) ? options.dependencies : [],
      installRule,
      modioInstallRule: installRule,
      sourceInstallRule: installRule,
      ruleSelection: ['local_override', 'player_profile', 'player', 'local'].includes(currentModioRule.value?.sourceType) ? 'local_override' : 'public',
      sharedRuleDocument: currentModioRule.value?.sharedRuleDocument || null,
      sourceMeta,
      metadata
    },
    {}
  )
}

async function buildModioFileBatchEntry(file = {}, options = {}) {
  const card = downloadModal.value.item || {}
  const gameId = getCurrentGameId()
  const modId = toSafeNumber(options?.modId || file?.modId, 0) || getCardModId(card)
  const fileId = toSafeNumber(file?.fileId || file?.id, 0)
  if (!gameId || !modId || !fileId) {
    throw new Error(uiText('ui.downloadParametersAreIncompleteCannotCreateTask'))
  }

  const refreshedFile = await getModioModFile(gameId, modId, fileId, getCurrentModioApiConfig())
  const targetFile = refreshedFile || file
  const downloadUrl = String(targetFile?.downloadUrl || file?.downloadUrl || '').trim()
  if (!downloadUrl) {
    throw new Error(uiText('ui.noUsableDownloadLinkWasReturned'))
  }

  const rawCard = getCardRawItem(card)
  const modName = String(options?.modName || '').trim() || getCardDisplayName(card)
  const fileName = String(targetFile?.name || file?.name || uiText('ui.fileValue', { value1: (fileId) })).trim()
  const version = String(targetFile?.version || file?.version || '').trim()
  const dependencies =
    options.withInstallPayload && options.includeDependencies
      ? await buildModioDependencyReferences(modId)
      : []
  const installPayload = options.withInstallPayload
    ? buildModioUnifiedInstallPayload({
        targetFile,
        rawCard,
        modId,
        fileId,
        modName,
        fileName,
        version,
        fileSize: toSafeNumber(targetFile?.filesize || file?.filesize, 0),
        downloadUrl,
        cover: String(options?.cover || '').trim(),
        profileUrl: String(options?.profileUrl || '').trim(),
        sourcePageUrl: String(options?.sourcePageUrl || '').trim(),
        dependencies,
        dependencyRole: String(options?.dependencyRole || '').trim(),
        parentModId: toSafeNumber(options?.parentModId, 0),
        parentFileId: toSafeNumber(options?.parentFileId, 0),
        parentModName: String(options?.parentModName || '').trim(),
        profileName: String(options?.profileName || '').trim(),
        sortIndex: toSafeNumber(options?.sortIndex, 0)
      })
    : null

  return {
    item: {
      task_name: uiText('ui.modIoModDownloadValueValue', { value1: (modName), value2: (version ? `@${version}` : '') }),
      module: '游戏',
      file_type: getFileType(targetFile),
      download_url: downloadUrl,
      file_size: toSafeNumber(targetFile?.filesize || file?.filesize, 0),
      saveType: 2,
      sourcePlatform: 'modio',
      sourceType: 'modio',
      gameId,
      sourceGameId: gameId,
      sourceModId: modId,
      sourceFileId: fileId,
      preferredFileName: fileName,
      dedupeKey: ['modio', String(gameId), String(modId), String(fileId)].join(':'),
      showOpenInDownloadList: !!options.showOpenInDownloadList || !!options.withInstallPayload,
      ...(!options.withInstallPayload ? { downloadPurpose: 'download_only' } : {}),
      fun: {
        type: 0
      }
    },
    meta: {
      sourceType: 'modio',
      sourcePlatform: 'modio',
      displayName: modName,
      fileName,
      version,
      gameId,
      modId,
      fileId,
      filehash: String(targetFile?.filehash || '').trim(),
      platforms: Array.isArray(targetFile?.platforms) ? targetFile.platforms : [],
      profileUrl: String(options?.profileUrl || rawCard?.profileUrl || '').trim(),
      sourcePageUrl: String(options?.sourcePageUrl || rawCard?.sourcePageUrl || '').trim(),
      sortIndex: toSafeNumber(options?.sortIndex, 0),
      installPayload
    }
  }
}

async function buildModioDependencyFileBatchEntries(options = {}) {
  const gameId = getCurrentGameId()
  const currentModId = getCardModId(downloadModal.value.item || {})
  const dependencies = (
    Array.isArray(downloadModal.value.dependencies) ? downloadModal.value.dependencies : []
  ).filter((item) => {
    const modId = toSafeNumber(item?.modId, 0)
    return modId > 0 && modId !== currentModId
  })

  if (!gameId || !dependencies.length) {
    return []
  }

  const entries = []
  for (const dependency of dependencies) {
    const dependencyModId = toSafeNumber(dependency?.modId, 0)
    try {
      const fileResult = await getModioModFiles(
        gameId,
        dependencyModId,
        getCurrentModioApiConfig(),
        {
          limit: 20
        }
      )
      const targetFile = resolvePreferredModioFile(fileResult?.records || [])
      if (!targetFile) {
        continue
      }

      entries.push(
        await buildModioFileBatchEntry(targetFile, {
          ...options,
          modId: dependencyModId,
          modName: String(dependency?.name || `依赖模组-${dependencyModId}`).trim(),
          profileUrl: String(dependency?.profileUrl || '').trim(),
          cover: String(dependency?.pictureUrl || '').trim(),
          dependencyRole: 'modio_requirement',
          parentModId: currentModId,
          parentModName: getCardDisplayName(downloadModal.value.item || {}),
          showOpenInDownloadList: true
        })
      )
    } catch (error) {
      console.warn('[MODIO] 生成依赖下载项失败，已跳过', dependency, error)
    }
  }

  return entries
}

async function markUnmatchedInstallDownloadRecords(previewList = []) {
  const safePreviewList = Array.isArray(previewList) ? previewList : []
  if (!safePreviewList.length) {
    return
  }

  await Promise.allSettled(
    safePreviewList.map((item) =>
      invokeIpc('markDownloadRecordOpenable', {
        taskId: String(item?.taskId || '').trim(),
        filePath: String(item?.filePath || '').trim()
      })
    )
  )
}

function stringifyRuleUnmatchedContext(value = {}) {
  try {
    return JSON.stringify(value || {})
  } catch {
    return '{}'
  }
}

async function reportModioUnmatchedInstallRecord(previewPayload = {}) {
  const installPayload =
    previewPayload?.installPayload && typeof previewPayload.installPayload === 'object'
      ? previewPayload.installPayload
      : {}

  try {
    const document = previewPayload?.previewResult?.sharedRuleDocument || installPayload.sharedRuleDocument || {}
    await REPORT_RULE_ISSUE({
      sourcePlatform: 'modio',
      sourceGameId: String(getCurrentGameId()),
      documentId: document.documentId || null,
      canonicalGameKey: document.canonicalGameKey || '',
      revision: document.revision || null,
      contentHash: document.contentHash || '',
      gameId: toSafeNumber(currentModioRule.value?.gameId, 0),
      gameNameId: getCurrentNameId(),
      modioGameId: getCurrentGameId(),
      modId: toSafeNumber(installPayload?.modId || previewPayload?.modId, 0),
      fileId: toSafeNumber(installPayload?.id || previewPayload?.fileId, 0),
      modName: String(installPayload?.modName || previewPayload?.name || '').trim(),
      archiveName: String(previewPayload?.archiveName || '').trim(),
      clientVersion: String(appStore.AppData?.version || '').trim(),
      ruleVersion: toSafeNumber(currentModioRule.value?.ruleVersion, 0),
      inspectReason: String(previewPayload?.inspectReason || '').trim(),
      failureStage: 'rule_missed',
      archiveStructureJson: stringifyRuleUnmatchedContext({
        archiveName: String(previewPayload?.archiveName || '').trim(),
        previewResult:
          previewPayload?.previewResult && typeof previewPayload.previewResult === 'object'
            ? previewPayload.previewResult
            : null
      }),
      precheckJson: stringifyRuleUnmatchedContext({
        status: 'blocked',
        get summary() { return uiText('ui.noInstallationRuleMatched') },
        failureStage: 'rule_missed',
        inspectReason: String(previewPayload?.inspectReason || '').trim()
      })
    })
  } catch (error) {
    console.warn('[MODIO] 上报未识别安装规则记录失败', error)
  }
}

function notifyRuleUnmatchedDownloadOnly(previewList = []) {
  const safePreviewList = Array.isArray(previewList) ? previewList : []
  if (!safePreviewList.length) {
    return
  }

  const message = buildSourceDownloadOnlyMessage(MODIO_SOURCE_PLATFORM, 'rule_unmatched')
  $message.warning(
    safePreviewList.length > 1 ? uiText('ui.valueValueFilesTotal', { value1: (message), value2: (safePreviewList.length) }) : message
  )
}

function normalizeModioSourceInstallIssueList(value = []) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => {
      if (item && typeof item === 'object') {
        return item
      }
      const message = String(item ?? '').trim()
      return message ? { message } : null
    })
    .filter(Boolean)
}

function collectModioSourceInstallPreviewIssues(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  return {
    risks: [
      ...normalizeModioSourceInstallIssueList(result?.risks),
      ...normalizeModioSourceInstallIssueList(plan?.risks)
    ],
    warnings: [
      ...normalizeModioSourceInstallIssueList(result?.warnings),
      ...normalizeModioSourceInstallIssueList(plan?.warnings)
    ]
  }
}

function isBlockingModioSourceInstallWarning(issue = {}) {
  const level = String(issue?.level || issue?.severity || '')
    .trim()
    .toLowerCase()
  return issue?.blocking === true || ['high', 'critical', 'fatal'].includes(level)
}

function canAutoExecuteModioSourceInstall(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  const issues = collectModioSourceInstallPreviewIssues(result)
  const autoExecutable = result?.autoExecutable === true || plan?.autoExecutable === true
  const requiresUserConfirm =
    result?.requiresUserConfirm === true || plan?.requiresUserConfirm === true

  return (
    result?.success === true &&
    result?.matched === true &&
    autoExecutable &&
    !requiresUserConfirm &&
    issues.risks.length <= 0 &&
    !issues.warnings.some((item) => isBlockingModioSourceInstallWarning(item))
  )
}

function resolveModioPreviewBlockReason(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  const issues = collectModioSourceInstallPreviewIssues(result)
  const riskMessages = issues.risks
    .map((item) => String(item?.message || item?.code || '').trim())
    .filter(Boolean)
  const warningMessages = issues.warnings
    .filter((item) => isBlockingModioSourceInstallWarning(item))
    .map((item) => String(item?.message || item?.code || '').trim())
    .filter(Boolean)

  if (result?.success === false) {
    return String(result?.message || uiText('ui.couldNotCreateInstallationPlan')).trim()
  }
  if (result?.matched !== true) {
    return String(result?.reason || 'rule_not_matched').trim()
  }
  if (result?.requiresUserConfirm === true || plan?.requiresUserConfirm === true) {
    return String(plan?.confirmReason || result?.confirmReason || 'requires_user_confirm').trim()
  }
  if (riskMessages.length) {
    return riskMessages.join('；')
  }
  if (warningMessages.length) {
    return warningMessages.join('；')
  }
  if (result?.autoExecutable !== true && plan?.autoExecutable !== true) {
    return 'preview_not_auto_executable'
  }
  return 'requires_user_confirm'
}

function buildModioInstallPayloadForArchive(installPayload = {}, filePath = '') {
  const safePayload = installPayload && typeof installPayload === 'object' ? installPayload : {}
  const archivePath = String(filePath || '').trim()
  return sanitizeIpcPayload(
    {
      ...safePayload,
      archivePath,
      source: 'modio',
      sourceType: 'modio',
      sourcePlatform: 'modio',
      sourceAdapter: 'modio',
      sourceMeta:
        safePayload?.sourceMeta && typeof safePayload.sourceMeta === 'object'
          ? safePayload.sourceMeta
          : buildModioSourceMeta({
              modName: String(safePayload?.modName || '').trim(),
              fileName: String(safePayload?.name || '').trim()
            })
    },
    {}
  )
}

function buildModioDownloadOnlyPreviewItem(entry = {}, previewResult = {}, installPayload = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const payload = installPayload && typeof installPayload === 'object' ? installPayload : {}
  const filePath = String(entry?.filePath || '').trim()
  return {
    taskId: String(entry?.id || '').trim(),
    name: String(entry?.meta?.displayName || payload.modName || payload.name || '').trim(),
    archiveName: String(
      result?.archiveName || entry?.payload?.fileName || payload.name || ''
    ).trim(),
    filePath,
    modId: toSafeNumber(payload?.modId, 0),
    fileId: toSafeNumber(payload?.id || payload?.fileId, 0),
    inspectReason: resolveModioPreviewBlockReason(result),
    installPlan: result?.installPlan || null,
    previewResult: result,
    installPayload: payload
  }
}

function notifyModioPreviewBlockedDownloadOnly(blockedList = []) {
  const safeList = Array.isArray(blockedList) ? blockedList : []
  if (!safeList.length) {
    return
  }

  const firstReason = String(safeList[0]?.inspectReason || '').trim()
  const countText = safeList.length > 1 ? uiText('ui.valueFilesTotal', { value1: (safeList.length) }) : ''
  $message.warning(uiMessage('ui.thisModIoInstallationPlanNeedsManualHandlingValueItRemains', { value1: (countText), value2: (firstReason) }))
}

async function processDownloadedModioBatchResults(results = []) {
  const safeResults = Array.isArray(results) ? results : []
  const previewList = []
  const blockedList = []
  let installedCount = 0

  for (const entry of safeResults) {
    const installPayload =
      entry?.meta?.installPayload && typeof entry.meta.installPayload === 'object'
        ? entry.meta.installPayload
        : null
    const filePath = String(entry?.filePath || '').trim()
    if (!installPayload || !filePath) {
      throw new Error(uiText('ui.theDownloadResultHasNoInstallationParameters'))
    }

    const sourceInstallPayload = buildModioInstallPayloadForArchive(installPayload, filePath)
    const previewResult = await previewSourceInstall({
      filePath,
      data: sourceInstallPayload,
      type: 1,
      source: 'modio'
    })

    if (!previewResult?.success) {
      blockedList.push(
        buildModioDownloadOnlyPreviewItem(entry, previewResult, sourceInstallPayload)
      )
      continue
    }

    if (previewResult?.matched && canAutoExecuteModioSourceInstall(previewResult)) {
      const inspectToken = String(
        previewResult?.inspectToken || previewResult?.stagingToken || ''
      ).trim()
      const installResult = await executeSourceInstall({
        filePath,
        data: {
          ...sourceInstallPayload,
          standardInspectToken: inspectToken
        },
        type: 1,
        source: 'modio',
        inspectToken
      })

      if (!installResult?.success) {
        throw new Error(String(installResult?.message || uiText('ui.installationFailed')))
      }

      installedCount += 1
      continue
    }

    const previewItem = buildModioDownloadOnlyPreviewItem(
      entry,
      previewResult,
      sourceInstallPayload
    )
    if (previewResult?.matched) {
      blockedList.push(previewItem)
    } else {
      previewList.push(previewItem)
    }
  }

  if (previewList.length) {
    await markUnmatchedInstallDownloadRecords(previewList)
    await Promise.allSettled(previewList.map((item) => reportModioUnmatchedInstallRecord(item)))
    if (shouldDownloadOnlyWhenRuleUnmatched(MODIO_SOURCE_PLATFORM)) {
      notifyRuleUnmatchedDownloadOnly(previewList)
    }
  }

  if (blockedList.length) {
    await markUnmatchedInstallDownloadRecords(blockedList)
    notifyModioPreviewBlockedDownloadOnly(blockedList)
  }

  return {
    installedCount,
    previewCount: previewList.length,
    blockedCount: blockedList.length
  }
}

async function handleDownloadFilesWithoutRule(files = [], options = {}) {
  if (installSubmitting.value) {
    $message.warning(uiMessage('ui.aDownloadTaskIsAlreadyBeingPrepared'))
    return
  }

  const selectedFiles = (Array.isArray(files) ? files : [files]).filter(
    (file) => toSafeNumber(file?.fileId || file?.id, 0) > 0
  )
  if (!selectedFiles.length) {
    $message.warning(uiMessage('ui.selectFilesToProcessFirst'))
    return
  }

  const card = downloadModal.value.item || {}
  const modId = getCardModId(card)
  const includeDependencies = options?.includeDependencies === true
  installSubmitting.value = true
  setModioBatchBusy(selectedFiles, true)

  try {
    const [dependencyEntries, fileEntries] = await Promise.all([
      includeDependencies
        ? buildModioDependencyFileBatchEntries({
            withInstallPayload: false,
            includeDependencies: false
          })
        : [],
      Promise.all(
        selectedFiles.map((file) =>
          buildModioFileBatchEntry(file, {
            showOpenInDownloadList: true,
            withInstallPayload: false,
            includeDependencies: false
          })
        )
      )
    ])
    const batchEntries = [...dependencyEntries, ...fileEntries]
    const batchResult = downloadStore.addDownloadBatch(batchEntries, {
      batchId: createDownloadBatchId(
        modId,
        selectedFiles.length > 1 ? 'batch' : selectedFiles[0]?.fileId
      )
    })

    if (!batchResult?.success) {
      $message.warning(batchResult?.message || '加入下载队列失败')
      return
    }

    closeDownloadModal()
    if (includeDependencies && downloadDependencyCount.value > 0 && !dependencyEntries.length) {
      $message.warning(uiMessage('ui.noDownloadableDependencyFilesWereFoundOnlyTheCurrentSelection'))
    }
    $message.success(
      batchEntries.length > 1
        ? uiText('ui.addedValueFilesToTheDownloadQueue', { value1: (batchEntries.length) })
        : '已加入下载队列，完成后可在下载记录中打开文件'
    )
  } catch (error) {
    console.error('创建 Modio 下载任务失败', error)
    $message.warning(uiMessage('ui.downloadPreparationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    installSubmitting.value = false
    setModioBatchBusy(selectedFiles, false)
  }
}

async function handleInstallFiles(files = [], options = {}) {
  if (installSubmitting.value) {
    $message.warning(uiMessage('ui.anInstallationTaskIsAlreadyBeingPrepared'))
    return
  }

  const selectedFiles = (Array.isArray(files) ? files : [files]).filter(
    (file) => toSafeNumber(file?.fileId || file?.id, 0) > 0
  )
  if (!selectedFiles.length) {
    $message.warning(uiMessage('ui.selectFilesToProcessFirst'))
    return
  }

  const card = downloadModal.value.item || {}
  const modId = getCardModId(card)
  const includeDependencies = options?.includeDependencies === true
  installSubmitting.value = true
  setModioBatchBusy(selectedFiles, true)

  try {
    const [dependencyEntries, fileEntries] = await Promise.all([
      includeDependencies
        ? buildModioDependencyFileBatchEntries({
            withInstallPayload: true,
            includeDependencies: false
          })
        : [],
      Promise.all(
        selectedFiles.map((file) =>
          buildModioFileBatchEntry(file, {
            showOpenInDownloadList: true,
            withInstallPayload: true,
            includeDependencies
          })
        )
      )
    ])
    const batchEntries = [...dependencyEntries, ...fileEntries]
    if (isSourceInstallTaskEnabled()) {
      const result = await submitModioSourceInstallTask({
        source: 'modio',
        sourceAdapter: 'modio',
        sourceGameId: getCurrentGameId(),
        gameKey: `modio:${getCurrentGameId()}`,
        gameRoot: getDetectedModioGameRoot(),
        title: getCardDisplayName(card) || uiText('ui.modIoInstallationTask'),
        items: batchEntries,
        installRule: buildMainModioInstallRule(),
        sourceMeta: buildModioSourceMeta({
          modName: getCardDisplayName(card),
          fileName: selectedFiles.length > 1 ? '批量安装' : String(selectedFiles[0]?.name || '')
        }),
        options: {
          autoStart: true,
          includeDependencies
        }
      })

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotAddInstallationTask')))
      }

      closeDownloadModal()
      if (includeDependencies && downloadDependencyCount.value > 0 && !dependencyEntries.length) {
        $message.warning(uiMessage('ui.noDownloadableDependencyFilesWereFoundOnlyTheCurrentSelection'))
      }
      $message.success(result?.message || '已加入安装任务')
      setModioBatchBusy(selectedFiles, false)
      return
    }

    const batchResult = downloadStore.addDownloadBatch(batchEntries, {
      batchId: createDownloadBatchId(
        modId,
        selectedFiles.length > 1 ? 'batch' : selectedFiles[0]?.fileId
      ),
      onComplete: async (results) => {
        try {
          const processResult = await processDownloadedModioBatchResults(results)
          if (processResult.installedCount > 0) {
            await refreshInstalledModioMods()
          }
          const downloadOnlyCount =
            toSafeNumber(processResult.previewCount, 0) +
            toSafeNumber(processResult.blockedCount, 0)
          if (downloadOnlyCount > 0 && processResult.installedCount > 0) {
            $message.warning(
              uiMessage('ui.someModIoFilesWereInstalledFilesWithNoMatching')
            )
          } else if (processResult.previewCount > 0) {
            $message.warning(uiMessage('ui.noInstallationRuleMatchedKeptInDownloadHistory'))
          } else if (processResult.blockedCount > 0) {
            $message.warning(uiMessage('ui.theModIoInstallationPlanNeedsManualStepsKeptIn'))
          } else {
            $message.success(uiMessage('ui.modIoModInstallationComplete'))
          }
        } catch (error) {
          console.error('Modio 下载完成后安装失败', error)
          $message.error(uiMessage('ui.installationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
        } finally {
          setModioBatchBusy(selectedFiles, false)
        }
      },
      onError: async ({ message = '' }) => {
        setModioBatchBusy(selectedFiles, false)
        $message.error(uiMessage('ui.modIoDownloadFailedValue', { value1: (String(message || uiText('tools.unknownError'))) }))
      }
    })

    if (!batchResult?.success) {
      throw new Error(String(batchResult?.message || uiText('ui.couldNotAddToTheDownloadQueue')))
    }

    closeDownloadModal()
    if (includeDependencies && downloadDependencyCount.value > 0 && !dependencyEntries.length) {
      $message.warning(uiMessage('ui.noDownloadableDependencyFilesWereFoundOnlyTheCurrentSelection'))
    }
    $message.success(
      batchEntries.length > 1
        ? uiText('ui.addedValueFilesToTheDownloadQueueMatchingRulesWill', { value1: (batchEntries.length) })
        : '已加入下载队列，命中规则后会自动安装；未命中则保留下载记录'
    )
  } catch (error) {
    console.error('创建 Modio 安装任务失败', error)
    setModioBatchBusy(selectedFiles, false)
    $message.error(uiMessage('ui.installationPreparationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    installSubmitting.value = false
  }
}

async function handleDownloadSelectionSubmit(actionMode = 'install', includeDependencies = false) {
  if (!canSubmitDownloadSelection.value) {
    $message.warning(uiMessage('ui.selectFilesToProcessFirst'))
    return
  }

  const files = selectedDownloadFiles.value
  const normalizedActionMode =
    String(actionMode || '')
      .trim()
      .toLowerCase() === 'download'
      ? 'download'
      : 'install'
  if (normalizedActionMode === 'download') {
    await handleDownloadFilesWithoutRule(files, {
      includeDependencies: !!includeDependencies
    })
    return
  }

  if (canInstallByRule.value) {
    await handleInstallFiles(files, {
      includeDependencies: !!includeDependencies
    })
    return
  }

  await handleDownloadFilesWithoutRule(files, {
    includeDependencies: !!includeDependencies
  })
}

async function handleTranslateModioCurrentPage() {
  if (modioPageTranslationLoading.value) {
    return
  }

  const requestItems = buildModioTranslationRequestItems(pageMods.value, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    $message.info(uiMessage('ui.modsOnThisPageTranslated'))
    return
  }

  const totalCount = countUntranslatedModioMods(pageMods.value)
  updateModioPageTranslationProgress(totalCount)
  modioPageTranslationLoading.value = true
  try {
    await waitForUiRender()
    await translateModioMods(pageMods.value, {
      onProgress: () => {
        updateModioPageTranslationProgress(totalCount)
      }
    })
    const completedCount = Math.max(totalCount - countUntranslatedModioMods(pageMods.value), 0)
    if (completedCount > 0) {
      $message.success(uiMessage('ui.translatedValueValueModsOnThisPage', { value1: (completedCount), value2: (totalCount) }))
      return
    }
    $message.info(uiMessage('ui.noNewTranslationsForThisPage'))
  } catch (error) {
    console.error('[MODIO] 当前页模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateThisPageValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    modioPageTranslationLoading.value = false
    resetModioPageTranslationProgress()
  }
}

async function handleTranslateModioSingleMod(card = {}) {
  const rawItem = card?.raw || card
  const modId = toSafeNumber(rawItem?.modId || rawItem?.id, 0)
  if (modId <= 0) {
    return
  }

  const requestItems = buildModioTranslationRequestItems([rawItem], {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    return
  }

  modioItemTranslationLoadingMap.value = {
    ...modioItemTranslationLoadingMap.value,
    [modId]: true
  }

  try {
    const translatedMap = await translateTextBatchService({
      systemConfig: systemConfig.value,
      source: 'modio',
      scene: 'mod_list_card',
      items: requestItems
    })

    const translatedCount = mergeTranslationResultMap(
      translatedMap,
      modioTranslationMap,
      modioTranslationResolvedMap
    )
    if (translatedCount > 0) {
      $message.success(uiMessage('ui.modTranslationComplete'))
    } else {
      $message.info(uiMessage('ui.noNewTranslationsForThisMod'))
    }
  } catch (error) {
    console.error('[MODIO] 单模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateModValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    modioItemTranslationLoadingMap.value = {
      ...modioItemTranslationLoadingMap.value,
      [modId]: false
    }
  }
}

async function handleTranslateModioFiles() {
  if (modioFileTranslationLoading.value) {
    return
  }

  const requestItems = buildModioFileTranslationRequestItems(
    downloadModal.value.files,
    downloadModal.value.item,
    {
      unresolvedOnly: true
    }
  )
  if (!requestItems.length) {
    $message.info(uiMessage('ui.fileListTranslated'))
    return
  }

  modioFileTranslationLoading.value = true
  try {
    const translatedCount = await translateModioFileList(
      downloadModal.value.files,
      downloadModal.value.item
    )
    if (translatedCount > 0) {
      $message.success(uiMessage('ui.addedValueFileListTranslations', { value1: (translatedCount) }))
    } else {
      $message.info(uiMessage('ui.noNewTranslationsForTheFileList'))
    }
  } catch (error) {
    console.error('[MODIO] 文件列表翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateFileListValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    modioFileTranslationLoading.value = false
  }
}

function handleModioFloatingAction(action = {}) {
  const actionKey = String(action?.key || '').trim()
  if (actionKey === 'translate-current-page') {
    handleTranslateModioCurrentPage().then()
  }
}

async function initPage() {
  applyRouteInfo()
  await resolveModioGameDisplayName()
  syncMenuName()
  // 列表依赖本地 API 配置，必须等配置就绪后请求；安装规则仍可并行加载。
  const modListPromise = loadAiSystemConfig().then(() => loadModList())
  await loadCurrentModioRule()
  await resolveModioBindingByRule()
  await refreshInstalledModioMods()
  await modListPromise
}

function handleUpdateSystemConfig() {
  loadAiSystemConfig().then()
}

watch(
  () =>
    [
      pageMods.value
        .map((item) => `${item?.modId || item?.id}:${item?.name || ''}:${item?.summary || ''}`)
        .join('|'),
      JSON.stringify([aiTranslationConfig.value, contentLocale.value])
    ].join('::'),
  async () => {
    modioTranslationMap.value = {}
    modioTranslationResolvedMap.value = {}
    modioItemTranslationLoadingMap.value = {}
    await hydrateModioModTranslations(pageMods.value)
    await autoTranslateModioMods(pageMods.value)
  },
  { immediate: true }
)

watch(
  () =>
    [
      downloadModal.value.open ? '1' : '0',
      (Array.isArray(downloadModal.value.files) ? downloadModal.value.files : [])
        .map((item) => `${item?.modId || ''}:${item?.fileId || item?.id}:${item?.name || ''}:${item?.changelog || ''}`)
        .join('|'),
      JSON.stringify([aiTranslationConfig.value, contentLocale.value])
    ].join('::'),
  async (_value, _oldValue, onCleanup) => {
    let cancelled = false
    onCleanup(() => { cancelled = true })
    modioFileTranslationMap.value = {}
    modioFileTranslationResolvedMap.value = {}
    modioFileTranslationLoading.value = false
    modioFileAutoTranslationInFlightSignature.value = ''
    modioFileAutoTranslationCompletedSignature.value = ''
    modioFileTranslationToken++
    if (!downloadModal.value.open) {
      return
    }
    await hydrateModioFileTranslations(downloadModal.value.files, downloadModal.value.item)
    if (cancelled || !downloadModal.value.open) return
    await autoTranslateModioFileList(downloadModal.value.files, downloadModal.value.item)
  },
  { immediate: true }
)

watch(
  () => query.value.keyword,
  () => {
    query.value.effectiveKeyword = ''
  },
  { flush: 'sync' }
)

watch(
  () =>
    [
      query.value.keyword,
      query.value.sort,
      query.value.page,
      query.value.limit,
      gameBaseInfo.value.id,
      gameBaseInfo.value.name,
      gameBaseInfo.value.nameId,
      modioBinding.value?.detectedRootPath,
      modioBinding.value?.detectedExePath,
      detectStatus.value,
      modioProfileState.activeProfileName.value,
      currentModioRule.value?.ruleVersion,
      hasApiKey.value ? '1' : '0',
      downloadModal.value.open ? '1' : '0',
      downloadModal.value.item?.modId || downloadModal.value.item?.id,
      downloadModal.value.files.length,
      selectedDownloadFileKeys.value.join('|')
    ].join('::'),
  () => {
    publishModioAiPageContext()
  },
  { immediate: true }
)

const { activate: activateSourceTaskListeners, deactivate: deactivateSourceTaskListeners } =
  createSourceInstallTaskSubscriptions(ipcRenderer, {
    onTaskUpdated: handleSourceInstallTaskUpdated,
    refreshScheduler: installedModioRefreshScheduler,
    listeners: [['update-system-config', handleUpdateSystemConfig]]
  })

onMounted(async () => {
  activateSourceTaskListeners()
  await initPage()
})

onActivated(async () => {
  activateSourceTaskListeners()
  if (!skippedInitialActivation) {
    skippedInitialActivation = true
    return
  }

  applyRouteInfo()
  await resolveModioGameDisplayName()
  syncMenuName()
  await loadAiSystemConfig()
  await loadCurrentModioRule()
  await resolveModioBindingByRule()
  await refreshInstalledModioMods()
})

onDeactivated(() => {
  deactivateSourceTaskListeners()
})

onUnmounted(() => {
  deactivateSourceTaskListeners()
  aiPageContextProvider.clear()
})

defineOptions({
  name: 'GameModioModList'
})
</script>

<template>
  <div class="modio-mod-list-page">
    <page-body>
      <div class="max_width">
        <unified-mod-header
          :rule-ai-context="{ sourcePlatform: 'modio', gameName: gameDisplayName, sourceGameId: getCurrentGameId(), sourceSlug: getCurrentNameId(), appId: getCurrentSteamAppId() }"
          :rule-ai-missing="detectStatus === 'no_rule' && installRuleFailure?.state === 'NOT_CONFIGURED' && !currentModioRule"
          rule-ai-editor-action="rule-config"
          :dlss-context="{ name: gameDisplayName, gameId: gameBaseInfo.id, sourcePlatform: 'modio', gameRoot: detectStatus === 'identified' ? modioBinding?.detectedRootPath || '' : '', exePath: detectStatus === 'identified' ? modioBinding?.detectedExePath || '' : '' }"
          :cover-image="gameBaseInfo.coverImage"
          :title="gameDisplayName"
          :subtitle="gameBaseInfo.nameId || $t('ui.modIoGame')"
          :tags="headerTags"
          :stats="headerStats"
          :status-text="headerStatusText"
          :status-type="headerStatusType"
          :status-sub-text="headerStatusSubText"
          :actions="headerActions"
          @action="handleHeaderAction"
          @rule-saved="refreshImportedRule"
        />

        <mod-source-profile-modal
          :open="profileConfigModal.open"
          :active-profile-name="modioProfileState.activeProfileName.value"
          :profile-options="modioProfileState.profileOptions.value"
          :profile-mod-count="installedModioMods.length"
          :profile-switching="profileSwitching"
          :profile-operation-locked="false"
          :sharing-profile="sharingProfile"
          :importing-profile="importingProfile"
          :show-namespace-hint="false"
          :create-profile-loading="createProfileModal.confirmLoading"
          :profile-name-max-length="modioProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeProfileSchemeModal"
          @switch-profile="handleProfileSwitch"
          @rename-profile="handleProfileRename"
          @delete-profile="handleProfileDelete"
          @create-profile="openCreateProfileModal"
          @confirm-create-profile="handleInlineCreateProfile"
          @share-profile="shareModioSourceModpack"
          @update-profile="updateModioSourceModpack"
          @import-profile="openSourceModpackImportModal"
          @export-file="handleExportToFile"
          @import-file="handleImportFromFile"
        />

        <mod-source-create-profile-modal
          :open="createProfileModal.open"
          :confirm-loading="createProfileModal.confirmLoading"
          :name="createProfileModal.name"
          :max-length="modioProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeCreateProfileModal"
          @confirm="confirmCreateProfileModal"
          @update:name="(value) => (createProfileModal.name = value)"
        />

        <unified-mod-search-bar
          :keyword="query.keyword"
          :sort="query.sort"
          :sort-options="sortOptions"
          :loading="loading"
          :disable-search="!hasApiKey"
          :keyword-placeholder="$t('ui.searchModioNames')"
          @update:keyword="(value) => (query.keyword = value)"
          @update:sort="handleSortChange"
          @search="handleSearch"
          @reset="handleReset"
        />

        <unified-mod-list-grid
          :notice="listNotice"
          :loading="loading"
          :loading-text="$t('ui.loadingModIoMods')"
          :empty-text="$t('ui.noModIoModsMatchTheCurrentFilters')"
          :items="listItems"
          :floating-actions="modioFloatingActions"
          :current="query.page"
          :pages="pageData.pages"
          :total="pageData.total"
          :size="query.limit"
          :current-count="pageMods.length"
          :show-pagination="hasApiKey && !loading && pageData.total > 0"
          @notice-action="handleNoticeAction"
          @install="openDownloadModal"
          @open-detail="handleOpenModDetail"
          @translate-item="handleTranslateModioSingleMod"
          @floating-action="handleModioFloatingAction"
          @page-change="changePage"
        />
      </div>
    </page-body>

    <InstallConfirmDialog
      :open="downloadModal.open"
      :mode="canInstallByRule ? 'install' : 'download'"
      :title="getCardDisplayName(downloadModal.item || {})"
      :fallback-initial="getCardDisplayName(downloadModal.item || {})"
      source-label="mod.io"
      :meta="modioDialogMeta"
      :loading="downloadModal.loading"
      :loading-text="$t('ui.fetchingFilesFromModIo')"
      :error-text="downloadModal.errorText"
      :busy="installSubmitting"
      selection-type="multi"
      :columns="modioDialogColumns"
      :items="modioDialogItems"
      :selected-keys="selectedDownloadFileKeys"
      :target="modioDialogTarget"
      :notice="modioDialogNotice"
      :dependencies="modioDialogDependencies"
      :total="modioDialogTotal"
      :tool="modioDialogTool"
      :footer-hint="modioDialogFooterHint"
      :actions="modioDialogActions"
      @update:selected-keys="setModioDialogSelection"
      @action="handleModioDialogAction"
      @tool="handleTranslateModioFiles"
      @dependency-action="handleModioDependencyAction"
      @close="handleModioDialogClose"
    />

    <source-modpack-share-code-modal
      :open="sourceModpackImportModal.open"
      :code="sourceModpackImportModal.code"
      :loading="sourceModpackImportModal.loading"
      :title="$t('ui.importAModIoShareCode')"
      :hint="$t('ui.createInstallationTasksForTheModIoFilesInThis')"
      @update:code="(value) => (sourceModpackImportModal.code = value)"
      @confirm="confirmModioSourceModpackImport"
      @cancel="closeSourceModpackImportModal"
    />

    <SourceModpackUpdateModal
      v-model="sourceModpackUpdateModal.open"
      :snapshot="sourceModpackUpdateModal.snapshot"
    />

    <profile-switch-progress-dialog
      :progress="profileSwitchProgress"
      @close="profileSwitchProgress.open = false"
    />
  </div>
</template>

<style scoped lang="scss">
.max_width {
  min-width: 0;
  width: 100%;
  margin: 0;
}

.modio-mod-list-page {
  width: 100%;
  height: 100%;
  background: #f8fafc;
}
</style>
