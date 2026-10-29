<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { describeSharedRuleFailure } from '../../../../../shared/installation/shared-install-rule.js'
import { computed, h, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import PageBody from '@renderer/component/page-body.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import storage from '@renderer/common/storage.js'
import { $message } from '@renderer/common/message.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { useGameStore } from '@renderer/store/gameStore.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { GET_SHARED_INSTALL_RULE } from '@renderer/api/modules/game.js'
import {
  CREATE_SOURCE_MODPACK
} from '@renderer/api/modules/source-modpack.js'
import SourceModpackShareCodeModal from '@renderer/views/game/component/source-modpack-share-code-modal.vue'
import SourceModpackUpdateModal from '@renderer/views/game/sourceModpack/component/SourceModpackUpdateModal.vue'
import {
  buildSourceModpackCreatePayload,
  copySourceModpackTextToClipboard,
  extractSourceModpackShareCode
} from '@renderer/utils/source-modpack-share.js'
import { requestSourceModpackShareName } from '@renderer/utils/source-modpack-share-name.js'
import { inspectShareImport, applyShareImport } from '@renderer/utils/source-modpack-coordinator-runtime.js'
import { requestSourceModpackInspectionConfirmation } from '@renderer/utils/source-modpack-import-ui.js'
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
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'
import {
  getFicsitModList,
  getFicsitModVersions
} from '@renderer/utils/ficsit-api.js'
import {
  ficsitCheckModFileOccupancy,
  getFicsitInstalledMods,
  prepareFicsitInstallPlan,
  executeSourceInstall,
  previewSourceInstall,
  resolveFicsitGamePath,
  setFicsitModEnabled,
  submitSourceInstallTask,
  uninstallFicsitMod
} from './ficsit-service.js'
import ModManageModal from '@views/game/component/modManagement/mod-manage-modal.vue'
import { buildFicsitModManageProtocol } from '@views/game/component/modManagement/adapters/ficsit-adapter.js'
import UnifiedModHeader from '@views/game/component/unifiedModList/UnifiedModHeader.vue'
import UnifiedModSearchBar from '@views/game/component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '@views/game/component/unifiedModList/UnifiedModListGrid.vue'
import FicsitInstallVersionModal from './component/ficsit-install-version-modal.vue'
import { buildGameSiteDetailRoute } from '@views/game/site-detail-route.js'
import { resolveGameNameFromDict } from '@renderer/utils/game-name-dict.js'
import ModSourceProfileModal from '@renderer/views/game/component/profile/mod-source-profile-modal.vue'
import ModSourceCreateProfileModal from '@renderer/views/game/component/profile/mod-source-create-profile-modal.vue'
import ProfileSwitchProgressDialog from '@renderer/views/game/component/profile/profile-switch-progress-dialog.vue'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'
import { buildCsmPayload, signCsmPayload } from '@renderer/utils/cross-source-modpack-schema.js'
import {
  openOfflinePackExportDialog,
  openOfflinePackImportDialog,
  pickOfflinePackImportFile
} from '@renderer/views/game/vxpack/vxpack-service.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../../shared/translation/ai-translation-config.js'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'

const route = useRoute()
const router = useRouter()
const aiPageContextProvider = useAiPageContextProvider(route)
const gameStore = useGameStore()
const downloadStore = useDownloadStore()
const FICSIT_SOURCE_LABEL = resolveSourcePlatformLabel('ficsit', 'Ficsit')
const { setMenuName: setPageMenuName } = useMenuName()
const FICSIT_STEAM_APP_ID = 526870

const DEFAULT_GAME_INFO = Object.freeze({
  name: '幸福工厂',
  englishName: 'Satisfactory',
  coverImage:
    'https://shared.st.dl.eccdnx.com/store_item_assets/steam/apps/526870/header.jpg?t=1749717464',
  get description() { return uiText('ui.isAFirstPersonOpenWorldFactoryBuildingGameWith') },
  modCount: 0
})

const DEFAULT_EXECUTABLE = 'FactoryGameSteam.exe'
const INSTALL_PROGRESS_HIDE_DELAY = 1500
const INSTALL_ERROR_HIDE_DELAY = 2500
const FICSIT_DOWNLOAD_BASE_URL = 'https://api.ficsit.app'
const FICSIT_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'active-install-config-profile'

// 配置方案（本地 profile）
const ficsitProfileState = useModSourceProfiles({
  sourceKey: 'ficsit',
  identifier: () => {
    const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
    return String(raw || FICSIT_STEAM_APP_ID || '').trim()
  }
})
const profileConfigModal = ref({ open: false })
const profileSwitching = ref(false)
const sharingProfileLoading = ref(false)
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
  const validation = ficsitProfileState.validateNewProfileName(createProfileModal.value.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  createProfileModal.value.confirmLoading = true
  try {
    ficsitProfileState.ensureProfile(validation.name, { select: false })
    $message.success(uiMessage('ui.profileCreatedValue', { value1: (validation.name) }))
    createProfileModal.value = { open: false, confirmLoading: false, name: '' }
  } catch (error) {
    console.error('新增 Ficsit 配置失败', error)
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
  const currentName = ficsitProfileState.resolveProfileNameInList(payload?.profileName)
  const validation = ficsitProfileState.validateProfileRename(currentName, payload?.name)
  if (!validation.ok) {
    $message.warning(validation.reason)
    return
  }
  try {
    const appId = Number(
      gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
    )
    const result = await ipcRenderer.invoke('sourceProfile:rename', {
      appId,
      source: 'ficsit',
      sourceId: String(appId),
      previousProfile: currentName,
      nextProfile: validation.name,
      endpointType: 0
    })
    if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRenameProfile'))
    ficsitProfileState.renameProfile(currentName, validation.name)
    await refreshInstalledMods()
    $message.success(result.message || uiText('ui.renamedToValue', { value1: (validation.name) }))
  } catch (error) {
    console.error('重命名 Ficsit 配置失败', error)
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
    fromProfile: ficsitProfileState.activeProfileName.value,
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
    const appId = Number(
      gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
    )
    const result = await ipcRenderer.invoke('sourceProfile:switch', {
      appId,
      source: 'ficsit',
      sourceId: String(appId),
      targetProfile: name,
      currentProfile: ficsitProfileState.activeProfileName.value,
      endpointType: 0
    })
    if (!result?.success) {
      throw new Error(result?.message || uiText('ui.someOperationsFailedWhileSwitchingProfiles'))
    }
    ficsitProfileState.setSelectedProfile(name)
    // 与 nexus 同：直接用后端 message（含按 profile 维度拆分的明细），避免前端再拼总数误导用户。
    $message.success(result.message || uiText('ui.switchedToProfileValue', { value1: (ficsitProfileState.activeProfileName.value) }))
    await refreshInstalledMods()
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

async function prepareFicsitImportProfile(profileName = '') {
  const previousProfileName = ficsitProfileState.activeProfileName.value
  const targetProfileName = ficsitProfileState.ensureProfile(profileName)
  const appId = Number(
    gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
  )
  try {
    const result = await ipcRenderer.invoke('sourceProfile:switch', {
      appId,
      source: 'ficsit',
      sourceId: String(appId),
      targetProfile: targetProfileName,
      endpointType: 0
    })
    if (!result?.success) {
      throw new Error(result?.message || uiText('ui.couldNotSwitchToTheImportedProfileValue', { value1: (targetProfileName) }))
    }
    ficsitProfileState.setSelectedProfile(targetProfileName)
    await refreshInstalledMods()
    return ficsitProfileState.activeProfileName.value
  } catch (error) {
    ficsitProfileState.setSelectedProfile(previousProfileName)
    throw error
  }
}
function handleProfileDelete(name) {
  const resolvedName = ficsitProfileState.resolveProfileNameInList(name)
  if (resolvedName === ficsitProfileState.defaultProfileName.value) return
  if (
    String(resolvedName || '').toLowerCase() ===
    String(ficsitProfileState.activeProfileName.value || '').toLowerCase()
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
      const targetName = ficsitProfileState.resolveProfileNameInList(name)
      if (
        String(targetName || '').toLowerCase() ===
        String(ficsitProfileState.activeProfileName.value || '').toLowerCase()
      ) {
        $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
        return
      }
      const appId = Number(
        gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
      )
      const deleteResult = await ipcRenderer.invoke('sourceProfile:delete', {
        appId,
        source: 'ficsit',
        sourceId: String(appId),
        targetProfile: targetName,
        isDefault: targetName === ficsitProfileState.defaultProfileName.value,
        endpointType: 0
      })
      if (!deleteResult?.success) {
        throw new Error(deleteResult?.message || uiText('ui.couldNotDeleteProfile'))
      }
      ficsitProfileState.removeProfile(targetName)
      await refreshInstalledMods()
      // 后端 message 已包含「清理 N 个模组及其源文件」之类的详情，直接透传
      $message.success(deleteResult.message || uiText('ui.profileDeletedValue', { value1: (resolvedName) }))
    }
  })
}

async function handleExportToFile() {
  try {
    if (!installedClientList.value.length) {
      await refreshInstalledMods()
    }
    const items = buildFicsitSourceModpackShareItems()
    if (!items.length) {
      $message.warning(uiMessage('ui.noInstalledFicsitModsAreAvailableToExport'))
      return
    }
    const appId = Number(
      gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
    )
    const gameName = String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim()
    const csm = buildCsmPayload({
      name: `${gameName} - ${ficsitProfileState.activeProfileName.value}`,
      description: `Ficsit Profile：${ficsitProfileState.activeProfileName.value}`,
      cover: String(gameBaseInfo.value.coverImage || gameBaseInfo.value.logo || '').trim(),
      primaryGame: {
        gameKey: `ficsit:${appId}`,
        sourceType: 'ficsit',
        sourceGameId: String(appId).trim(),
        sourceGameSlug: String(appId).trim(),
        sourceGameName: gameName
      },
      items
    })
    csm.checksum = await signCsmPayload(csm)
    openOfflinePackExportDialog({
      profilePayload: csm,
      exportItems: items,
      gameName,
      sourcePlatform: 'ficsit',
      sourceGameId: String(appId).trim(),
      sourceGameSlug: String(appId).trim(),
      profileName: ficsitProfileState.activeProfileName.value
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

const sortOptions = [
  { get label() { return uiText('ui.mostPopular') }, value: 'popularity_desc' },
  { get label() { return uiText('ui.mostDownloaded') }, value: 'downloads_desc' },
  { get label() { return uiText('tools.recentlyUpdated') }, value: 'updated_desc' }
]

function createEmptyFicsitVersionModalState() {
  return {
    open: false,
    mode: 'install',
    confirmLoading: false,
    item: null,
    profileName: 'Ficsit',
    currentVersion: '',
    versionNumber: '',
    versions: [],
    versionListLoading: false,
    versionDetailLoading: false,
    selectedVersionDetail: null,
    dependencyItems: [],
    dependencyItemsLoading: false
  }
}

function isSourceInstallTaskEnabled() {
  return true
}

const loading = ref(false)
const pathLoading = ref(false)
const pendingLocalBindingAfterManualBind = ref(false)
const systemConfig = ref({
  aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
})
const gameBaseInfo = ref({ ...DEFAULT_GAME_INFO })
const query = ref({
  page: 1,
  limit: 20,
  keyword: '',
  effectiveKeyword: '',
  sort: 'popularity_desc'
})
const pageData = ref({
  records: [],
  total: 0,
  pages: 1,
  current: 1
})

const gameRuntime = ref({
  gameId: 0,
  steamAppId: FICSIT_STEAM_APP_ID,
  executableFile: DEFAULT_EXECUTABLE,
  hasServer: false,
  serverExecutable: '',
  clientRootPath: '',
  clientExePath: '',
  targetPath: '',
  isGameFound: false,
  isServerInstalled: false
})
const ficsitAutoTranslationInFlightSignature = ref('')
const ficsitAutoTranslationCompletedSignature = ref('')
let ficsitSearchResolveToken = 0

const manageVisible = ref(false)
const manageLoading = ref(false)
const manageActiveTab = ref('client')
const installedClientList = ref([])
const installedServerList = ref([])
const installedFicsitRefreshScheduler = createSourceInstallTaskRefreshScheduler(
  () => refreshInstalledMods(),
  {
    logMessage: '刷新 Ficsit 已安装模组失败'
  }
)
const installingMap = ref({})
const operationMap = ref({})
const installProgressMap = ref({})
const installProgressTimerMap = new Map()
const versionDialogLoadingMap = ref({})
const ficsitVersionModal = ref(createEmptyFicsitVersionModalState())
const ficsitTranslationMap = ref({})
const ficsitTranslationResolvedMap = ref({})
const currentFicsitRule = ref(null)
const installRuleFailure = ref(null)
const sourceModpackSharing = ref(false)
const sourceModpackUpdateModal = ref({ open: false, snapshot: null })
const sourceModpackImportModal = ref({
  open: false,
  code: '',
  loading: false
})
const ficsitPageTranslationLoading = ref(false)
const ficsitPageTranslationProgress = ref({
  current: 0,
  total: 0
})
const ficsitItemTranslationLoadingMap = ref({})
let ficsitTranslationToken = 0
let ficsitVersionModalToken = 0
let ficsitInitialActivationSkipped = false

const pageMods = computed(() => pageData.value.records || [])
const aiTranslationConfig = computed(() => resolveAiTranslationConfig(systemConfig.value))
const canUseFicsitAiTranslation = computed(() =>
  isAiTranslationAvailable(systemConfig.value, 'ficsit')
)

function buildFicsitAiContextMod() {
  const modal = ficsitVersionModal.value || {}
  const item = modal.item || null
  if (!item) return {}

  const selectedVersion = modal.selectedVersionDetail || {}
  const modReference = String(item.modReference || item.mod_reference || item.id || '').trim()
  if (!modReference) return {}

  const version = String(
    modal.versionNumber ||
      selectedVersion.version ||
      selectedVersion.version_number ||
      item.latestVersion ||
      item.version ||
      ''
  ).trim()
  const downloadUrl = String(
    selectedVersion.install_url || selectedVersion.downloadUrl || ''
  ).trim()

  return {
    source: 'ficsit',
    modId: modReference,
    id: modReference,
    name: String(item.name || item.title || modReference).trim(),
    title: String(item.name || item.title || modReference).trim(),
    version,
    selectedVersion: version,
    selectedFileId: String(selectedVersion.id || version || '').trim(),
    selectedFileName: version ? `${modReference}@${version}` : modReference,
    downloadAvailable: Boolean(downloadUrl),
    downloadUrl,
    fileSize: toSafeNumber(selectedVersion.file_size, 0),
    dependencyCount: Array.isArray(modal.dependencyItems) ? modal.dependencyItems.length : 0
  }
}

function publishFicsitAiPageContext() {
  const sourceGameId = String(route.query?.sourceGameId || FICSIT_STEAM_APP_ID).trim()
  const sourceSlug = String(route.query?.sourceSlug || 'satisfactory').trim()
  const profileName = String(ficsitProfileState.activeProfileName.value || 'Ficsit').trim()
  return aiPageContextProvider.update({
    game: {
      source: 'ficsit',
      name: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
      englishName: String(gameBaseInfo.value.englishName || DEFAULT_GAME_INFO.englishName).trim(),
      sourceGameId,
      sourceSlug,
      steamAppId: String(gameRuntime.value.steamAppId || FICSIT_STEAM_APP_ID),
      gameId: String(gameRuntime.value.gameId || route.query?.gameId || ''),
      gameRootConfigured: Boolean(gameRuntime.value.isGameFound),
      bindingConfigured: Boolean(gameRuntime.value.isGameFound),
      installRoot: String(gameRuntime.value.clientRootPath || '').trim(),
      gameRoot: String(gameRuntime.value.clientRootPath || '').trim(),
      clientRootPath: String(gameRuntime.value.clientRootPath || '').trim(),
      executableFile: String(
        gameRuntime.value.clientExePath || gameRuntime.value.executableFile || ''
      ).trim(),
      clientExePath: String(gameRuntime.value.clientExePath || '').trim(),
      profileName
    },
    search: {
      keyword: String(query.value.keyword || '').trim(),
      sort: String(query.value.sort || '').trim(),
      page: Number(query.value.page || pageData.value.current || 1),
      pageSize: Number(query.value.limit || 20),
      filters: {
        sourceGameId,
        sourceSlug,
        profile: profileName
      }
    },
    mod: buildFicsitAiContextMod(),
    install: {
      bindingConfigured: Boolean(gameRuntime.value.isGameFound),
      ruleConfigured: Boolean(currentFicsitRule.value),
      installRoot: String(gameRuntime.value.clientRootPath || '').trim(),
      profileName
    },
    sourceState: {
      source: 'ficsit',
      status: 'active',
      label: 'Ficsit',
      configured: Boolean(currentFicsitRule.value),
      summary: currentFicsitRule.value ? uiText('ui.ficsitInstallationRulesConfigured') : uiText('ui.ficsitInstallationRulesNotConfigured')
    }
  })
}

function countUntranslatedFicsitMods(list = pageMods.value) {
  return (Array.isArray(list) ? list : []).filter((item) => !isFicsitCardTranslationResolved(item))
    .length
}

const untranslatedFicsitModCount = computed(() => {
  return countUntranslatedFicsitMods(pageMods.value)
})
const ficsitFloatingActions = computed(() => {
  if (!canUseFicsitAiTranslation.value || !pageMods.value.length) {
    return []
  }

  return [
    {
      key: 'translate-current-page',
      label: untranslatedFicsitModCount.value > 0 ? uiText('ui.translateCurrentPage') : uiText('ui.currentPageTranslated'),
      loading: ficsitPageTranslationLoading.value,
      get loadingText() { return uiText('ui.translateCurrentPage') },
      progressCurrent: ficsitPageTranslationProgress.value.current,
      progressTotal: ficsitPageTranslationProgress.value.total,
      disabled: ficsitPageTranslationLoading.value || untranslatedFicsitModCount.value <= 0,
      visible: true
    }
  ]
})

const activeInstallProgress = computed(() => {
  const installingKeys = Object.keys(installingMap.value).filter((k) => installingMap.value[k])
  if (installingKeys.length > 0) {
    const key = installingKeys[0]
    const progress = installProgressMap.value[key]
    if (progress) {
      return progress
    }
    return {
      modReference: key,
      percent: 0,
      message: uiText('ui.preparingInstallationTask'),
      stage: 'prepare'
    }
  }

  const keys = Object.keys(installProgressMap.value)
  for (const key of keys) {
    const progress = installProgressMap.value[key]
    const stage = String(progress?.stage || '').toLowerCase()
    if (stage && stage !== 'done' && stage !== 'error') {
      return progress
    }
  }

  return null
})

const activeInstallStatus = computed(() => {
  const stage = String(activeInstallProgress.value?.stage || '').toLowerCase()
  if (stage === 'error') return 'exception'
  if (stage === 'done') return 'success'
  return 'active'
})
const manageProtocol = computed(() =>
  buildFicsitModManageProtocol({
    loading: manageLoading.value,
    activeTab: manageActiveTab.value,
    clientList: installedClientList.value,
    serverList: installedServerList.value,
    operationMap: operationMap.value,
    showServerTab: false,
    gameName: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
    gameLogoUrl: String(gameBaseInfo.value.coverImage || DEFAULT_GAME_INFO.coverImage).trim(),
    platformLabel: FICSIT_SOURCE_LABEL,
    workspaceLabel: '当前分组',
    gamePath: gamePathText.value,
    gameStatusText: headerStatusText.value,
    gameStatusTone: headerStatusType.value,
    pathLabel: '安装路径',
    summaryExtraText: headerStatusSubText.value
  })
)

const installedByReference = computed(() => {
  const map = new Map()
  for (const item of installedClientList.value) {
    const key = normalizeText(item?.modReference)
    if (key && !map.has(key)) {
      map.set(key, item)
    }
  }
  return map
})

const installedByName = computed(() => {
  const map = new Map()
  for (const item of installedClientList.value) {
    const key = normalizeText(item?.name)
    if (key && !map.has(key)) {
      map.set(key, item)
    }
  }
  return map
})

const headerTags = computed(() => {
  const tags = ['Ficsit']
  const appId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || 0)
  if (appId > 0) {
    tags.push(`AppID ${appId}`)
  }
  return tags
})

const headerStats = computed(() => {
  return [
    {
      get label() { return uiText('modBrowser.count') },
      value: String(pageData.value.total || 0),
      accent: true
    }
  ]
})

const headerStatusType = computed(() => {
  if (!currentFicsitRule.value && installRuleFailure.value) return 'danger'
  if (pathLoading.value) return 'info'
  return gameRuntime.value.isGameFound ? 'success' : 'danger'
})

const headerStatusText = computed(() => {
  if (!currentFicsitRule.value && installRuleFailure.value) return installRuleFailure.value.label
  if (pathLoading.value) return uiText('ui.detectingFolder')
  return gameRuntime.value.isGameFound ? uiText('modBrowser.identified') : uiText('modBrowser.unidentified')
})

const gamePathText = computed(() => {
  const targetPath = String(gameRuntime.value.targetPath || '').trim()
  if (targetPath) return targetPath
  const exePath = String(gameRuntime.value.clientExePath || '').trim()
  if (exePath) return exePath
  const rootPath = String(gameRuntime.value.clientRootPath || '').trim()
  if (rootPath) return rootPath
  return uiText('ui.noUsablePathDetectedAddItManually')
})

const headerStatusSubText = computed(() => '')

const headerActions = computed(() => [
  {
    key: 'profile-scheme',
    get label() { return uiText('modBrowser.profiles') }
  },
  {
    key: 'manage',
    get label() { return uiText('modBrowser.manage') },
    tone: 'strong'
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
    disabled: !gameRuntime.value.isGameFound
  },
  {
    key: 'open-root',
    get label() { return uiText('modBrowser.openRoot') },
    placement: 'more',
    disabled: !gameRuntime.value.isGameFound
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
    disabled: pathLoading.value
  },
  {
    key: 'rule-config',
    get label() { return uiText('ui.editInstallationRules') },
    placement: 'more'
  }
])

function buildFicsitTitleTranslationKey(item = {}) {
  return `mod:${normalizeText(item?.modReference || item?.id || item?.name)}:title`
}

function buildFicsitSummaryTranslationKey(item = {}) {
  return `mod:${normalizeText(item?.modReference || item?.id || item?.name)}:summary`
}

function mergeFicsitTranslationResultMap(resultMap = new Map()) {
  if (!(resultMap instanceof Map) || resultMap.size <= 0) {
    return 0
  }

  const nextTextState = {
    ...ficsitTranslationMap.value
  }
  const nextResolvedState = {
    ...ficsitTranslationResolvedMap.value
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

  ficsitTranslationMap.value = nextTextState
  ficsitTranslationResolvedMap.value = nextResolvedState
  return updatedCount
}

function isFicsitTranslationKeyResolved(translationKey = '') {
  return !!ficsitTranslationResolvedMap.value[String(translationKey || '').trim()]
}

function getFicsitTranslatedTitle(item = {}) {
  if (!canUseFicsitAiTranslation.value) {
    return ''
  }

  const original = String(item?.name || '').trim()
  const translated = String(
    ficsitTranslationMap.value[buildFicsitTitleTranslationKey(item)] || ''
  ).trim()
  return translated && translated !== original ? translated : ''
}

function getFicsitTranslatedDescription(item = {}) {
  if (!canUseFicsitAiTranslation.value) {
    return ''
  }

  const original = String(item?.shortDescription || item?.fullDescription || '').trim()
  const translated = String(
    ficsitTranslationMap.value[buildFicsitSummaryTranslationKey(item)] || ''
  ).trim()
  return translated && translated !== original ? translated : ''
}

function isFicsitCardTranslationResolved(item = {}) {
  const requiredKeys = []
  if (String(item?.name || '').trim()) {
    requiredKeys.push(buildFicsitTitleTranslationKey(item))
  }
  if (String(item?.shortDescription || item?.fullDescription || '').trim()) {
    requiredKeys.push(buildFicsitSummaryTranslationKey(item))
  }

  return (
    requiredKeys.length <= 0 ||
    requiredKeys.every((translationKey) => isFicsitTranslationKeyResolved(translationKey))
  )
}

function buildFicsitTranslationRequestItems(list = pageMods.value, options = {}) {
  const safeList = Array.isArray(list) ? list : []
  const unresolvedOnly = !!options?.unresolvedOnly

  return safeList.flatMap((item) => {
    const displayName = String(item?.name || '').trim()
    const description = String(item?.shortDescription || item?.fullDescription || '').trim()
    const requestItems = []

    if (displayName) {
      const titleKey = buildFicsitTitleTranslationKey(item)
      if (!unresolvedOnly || !isFicsitTranslationKeyResolved(titleKey)) {
        requestItems.push({
          id: titleKey,
          text: displayName,
          kind: 'mod_name',
          context: uiText('ui.gameValueVariant3', { value1: (gameBaseInfo.value.name || DEFAULT_GAME_INFO.name) })
        })
      }
    }

    if (description) {
      const summaryKey = buildFicsitSummaryTranslationKey(item)
      if (!unresolvedOnly || !isFicsitTranslationKeyResolved(summaryKey)) {
        requestItems.push({
          id: summaryKey,
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.gameValueModValue', { value1: (gameBaseInfo.value.name || DEFAULT_GAME_INFO.name), value2: (displayName || '--') })
        })
      }
    }

    return requestItems
  })
}

async function hydrateFicsitModTranslations(list = pageMods.value) {
  const safeList = Array.isArray(list) ? list : []
  ficsitTranslationToken += 1
  const currentToken = ficsitTranslationToken

  if (!canUseFicsitAiTranslation.value || !safeList.length) {
    return
  }

  const requestItems = buildFicsitTranslationRequestItems(safeList)
  if (!requestItems.length) {
    return
  }

  try {
    const translatedMap = await queryCachedTextBatchService({
      systemConfig: systemConfig.value,
      source: 'ficsit',
      scene: 'mod_list_card',
      items: requestItems
    })

    if (currentToken !== ficsitTranslationToken || !translatedMap.size) {
      return
    }

    mergeFicsitTranslationResultMap(translatedMap)
  } catch (error) {
    console.warn('[FICSIT] 模组翻译缓存读取失败', error)
  }
}

async function translateFicsitMods(list = pageMods.value, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const edgeOnly = options?.edgeOnly === true
  const shouldApplyResult =
    typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
  const requestItems = buildFicsitTranslationRequestItems(list, {
    unresolvedOnly: true
  })

  if ((!edgeOnly && !canUseFicsitAiTranslation.value) || !requestItems.length) {
    return 0
  }

  const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
  const translatedMap = await translateService({
    systemConfig: systemConfig.value,
    source: 'ficsit',
    scene: 'mod_list_card',
    items: requestItems,
    onChunkSettled: onProgress
      ? ({ chunkResultMap }) => {
          if (!shouldApplyResult()) {
            return
          }
          mergeFicsitTranslationResultMap(chunkResultMap)
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

  return mergeFicsitTranslationResultMap(translatedMap)
}

function buildFicsitAutoTranslationSignature(list = pageMods.value) {
  return [
    'ficsit',
    query.value.page,
    query.value.effectiveKeyword || query.value.keyword,
    query.value.sort,
    (Array.isArray(list) ? list : []).map((item) => item?.modReference || item?.id || '').join(','),
    aiTranslationConfig.value.targetLanguage
  ].join('|')
}

async function autoTranslateFicsitMods(list = pageMods.value) {
  const signature = buildFicsitAutoTranslationSignature(list)
  if (
    !signature ||
    ficsitAutoTranslationCompletedSignature.value === signature ||
    ficsitAutoTranslationInFlightSignature.value === signature
  ) {
    return
  }

  const requestItems = buildFicsitTranslationRequestItems(list, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    ficsitAutoTranslationCompletedSignature.value = signature
    return
  }

  ficsitAutoTranslationInFlightSignature.value = signature
  try {
    const translatedCount = await translateFicsitMods(list, {
      edgeOnly: true,
      shouldApplyResult: () => ficsitAutoTranslationInFlightSignature.value === signature
    })
    if (translatedCount > 0 && ficsitAutoTranslationInFlightSignature.value === signature) {
      ficsitAutoTranslationCompletedSignature.value = signature
    }
  } catch (error) {
    console.warn('[FICSIT] 模组自动翻译失败', error)
  } finally {
    if (ficsitAutoTranslationInFlightSignature.value === signature) {
      ficsitAutoTranslationInFlightSignature.value = ''
    }
  }
}

function resetFicsitPageTranslationProgress() {
  ficsitPageTranslationProgress.value = {
    current: 0,
    total: 0
  }
}

function updateFicsitPageTranslationProgress(total = 0) {
  ficsitPageTranslationProgress.value = {
    current: Math.max(total - countUntranslatedFicsitMods(pageMods.value), 0),
    total: Math.max(Number(total || 0), 0)
  }
}

const listItems = computed(() => {
  return pageMods.value.map((item) => {
    const installed = !!resolveInstalledInfo(item)
    const installing = isInstallingMod(item)
    const versionDialogLoading =
      !!versionDialogLoadingMap.value[normalizeText(item?.modReference || item?.id || item?.name)]
    const translatedTitle = getFicsitTranslatedTitle(item)
    const translatedDescription = getFicsitTranslatedDescription(item)
    const translationResolved = isFicsitCardTranslationResolved(item)
    const itemKey = String(item?.modReference || item?.id || item?.name || '').trim()
    return {
      id: item.id,
      cover: item.logo,
      title: item.name,
      translatedTitle,
      subtitle: item.modReference,
      description: item.shortDescription || item.fullDescription || uiText('ui.noDescription'),
      translatedDescription,      author: 'Ficsit',
      tags: [uiText('ui.versionValue', { value1: (item.latestVersion || '--') })],
      detailText: '详情',
      installText: gameRuntime.value.isGameFound ? (installed ? '重装' : '安装') : '下载',
      installing: installing || versionDialogLoading,
      installingText: versionDialogLoading
        ? '加载版本...'
        : gameRuntime.value.isGameFound
          ? '安装中...'
          : '下载中...',
      installable: true,
      translateActionText: ficsitItemTranslationLoadingMap.value[itemKey] ? '翻译中...' : '翻译',
      translateHidden: !canUseFicsitAiTranslation.value || translationResolved,
      translateDisabled: !!ficsitItemTranslationLoadingMap.value[itemKey],
      installedText: installed ? '已安装' : '',
      downloadCount: item.downloads,
      raw: item
    }
  })
})

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatFileSize(bytes, decimals = 1) {
  const size = Math.max(toSafeNumber(bytes, 0), 0)
  if (size <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const precision = unitIndex <= 0 ? 0 : Math.max(toSafeNumber(decimals, 1), 0)
  const value = size / 1024 ** unitIndex
  return `${value.toFixed(precision).replace(/\.0+$/, '')} ${units[unitIndex]}`
}

function formatTransferSpeed(bytesPerSecond) {
  const speed = Math.max(toSafeNumber(bytesPerSecond, 0), 0)
  if (speed <= 0) return ''
  return `${formatFileSize(speed)}/s`
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

function getResolvedGameId() {
  const routeGameId = toSafeNumber(route.query?.gameId || route.params?.id, 0)
  const runtimeGameId = toSafeNumber(gameRuntime.value.gameId, 0)
  const baseGameId = toSafeNumber(gameBaseInfo.value.id, 0)
  const appId = toSafeNumber(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId, 0)
  return routeGameId || runtimeGameId || baseGameId || appId
}

function normalizeFicsitDownloadUrl(rawUrl) {
  const text = String(rawUrl || '').trim()
  if (!text) return ''
  try {
    return new URL(text, FICSIT_DOWNLOAD_BASE_URL).toString()
  } catch {
    return ''
  }
}

function normalizeFicsitRuleJson(rawText = '') {
  const text = String(rawText || '').trim()
  if (!text) {
    return {}
  }

  try {
    return compileInstallRuleJson(parseInstallRuleJsonText(text))
  } catch (error) {
    console.warn('[FICSIT] 云端安装配置解析失败', error)
    return {}
  }
}

function hasFicsitInstallRuleContent(rule = null) {
  const ruleJson =
    rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
      ? rule.ruleJson
      : null
  const installRules = Array.isArray(ruleJson?.install_rules)
    ? ruleJson.install_rules
    : Array.isArray(ruleJson?.installRules)
      ? ruleJson.installRules
      : []

  return !!ruleJson && installRules.length > 0
}

function normalizeFicsitInstallConfigProfile(profile = {}) {
  const source = profile && typeof profile === 'object' ? profile : {}
  const rawRuleJson =
    source?.ruleJson && typeof source.ruleJson === 'object' && !Array.isArray(source.ruleJson)
      ? source.ruleJson
      : source?.rule_json &&
          typeof source.rule_json === 'object' &&
          !Array.isArray(source.rule_json)
        ? source.rule_json
        : null
  const ruleJsonText = String(
    source?.ruleJsonText || source?.rule_json_text || source?.content || ''
  ).trim()
  const ruleJson = rawRuleJson || normalizeFicsitRuleJson(ruleJsonText)
  return {
    ...source,
    sourcePlatform: 'ficsit',
    sourceType: source?.configScope === 'player' ? 'player_profile' : String(source?.sourceType || 'server'),
    gameId: toSafeNumber(source?.gameId || source?.game_id, 0),
    appId: toSafeNumber(source?.appId || source?.app_id, 0),
    ruleVersion: toSafeNumber(source?.ruleVersion || source?.rule_version, 0),
    ruleJson
  }
}

function resolveFicsitInstallConfigGameKey() {
  const appId = toSafeNumber(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId, 0)
  return `ficsit:${appId || FICSIT_STEAM_APP_ID}`
}

function resolveFicsitActiveConfigStorageKey() {
  return `${FICSIT_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX}:ficsit:${resolveFicsitInstallConfigGameKey()}`
}

function loadStoredFicsitActiveProfile() {
  const snapshot = storage.local.get(resolveFicsitActiveConfigStorageKey())
  if (!snapshot || typeof snapshot !== 'object' ||
      !(snapshot.configScope === 'player' || ['local', 'local_override', 'player_profile', 'player'].includes(snapshot.sourceType))) {
    return null
  }

  const ruleJsonText = String(snapshot?.ruleJsonText || '').trim()
  if (!ruleJsonText) {
    return null
  }

  const normalizedRule = normalizeFicsitInstallConfigProfile({
    ...snapshot,
    sourceType: String(snapshot?.sourceType || 'active_profile').trim() || 'active_profile',
    ruleJsonText
  })
  return hasFicsitInstallRuleContent(normalizedRule) ? normalizedRule : null
}

function buildFicsitInstallConfigMatchParams() {
  const appId = toSafeNumber(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId, 0)
  const gameId = getResolvedGameId()
  const sourceGameId = appId || gameId || FICSIT_STEAM_APP_ID
  return {
    sourcePlatform: 'ficsit',
    gameKey: route.query?.gameKey ||  `ficsit:${sourceGameId}`,
    gameId: gameId || null,
    nexusGameId: null,
    domainName: 'satisfactory',
    appId: appId || null
  }
}

async function loadCurrentFicsitInstallRule() {
  currentFicsitRule.value = null
  installRuleFailure.value = null
  const storedRule = loadStoredFicsitActiveProfile()
  if (storedRule) {
    currentFicsitRule.value = storedRule
    return storedRule
  }
  try {
    const response = await GET_SHARED_INSTALL_RULE(buildFicsitInstallConfigMatchParams())
    const matchedRule = normalizeFicsitInstallConfigProfile(response)
    if (hasFicsitInstallRuleContent(matchedRule)) {
      currentFicsitRule.value = matchedRule
      return matchedRule
    }
  } catch (error) {
    console.warn('[FICSIT] 公共规则不可用，仅保留用户主动选择的私人配置', error)
    installRuleFailure.value = describeSharedRuleFailure(error)
  }

  return null
}

function buildMainFicsitInstallRule() {
  return hasFicsitInstallRuleContent(currentFicsitRule.value)
    ? currentFicsitRule.value.ruleJson
    : {}
}

function getVersionInfo(latestVersions) {
  const versions = latestVersions && typeof latestVersions === 'object' ? latestVersions : {}
  const release = versions.release && typeof versions.release === 'object' ? versions.release : null
  const beta = versions.beta && typeof versions.beta === 'object' ? versions.beta : null
  const alpha = versions.alpha && typeof versions.alpha === 'object' ? versions.alpha : null
  if (release) {
    return {
      type: 'release',
      version: String(release.version || '--').trim(),
      link: normalizeFicsitDownloadUrl(release.link)
    }
  }
  if (beta) {
    return {
      type: 'beta',
      version: String(beta.version || '--').trim(),
      link: normalizeFicsitDownloadUrl(beta.link)
    }
  }
  if (alpha) {
    return {
      type: 'alpha',
      version: String(alpha.version || '--').trim(),
      link: normalizeFicsitDownloadUrl(alpha.link)
    }
  }
  return {
    type: 'unknown',
    version: '--',
    link: ''
  }
}

function normalizeFicsitModList(list = []) {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const versionInfo = getVersionInfo(item?.latestVersions)
    const modReference = String(item?.mod_reference || '').trim()
    return {
      id: String(modReference || `ficsit-mod-${index}`),
      modId: toSafeNumber(item?.id, 0),
      modReference,
      name: String(item?.name || `未命名模组-${index + 1}`).trim(),
      shortDescription: String(item?.short_description || '').trim(),
      fullDescription: String(item?.full_description || '').trim(),
      logo: String(item?.logo || '').trim(),
      downloads: toSafeNumber(item?.downloads, 0),
      views: toSafeNumber(item?.views, 0),
      popularity: toSafeNumber(item?.popularity, 0),
      updatedAt: String(item?.updated_at || '').trim(),
      latestVersion: versionInfo.version || '--',
      latestVersionType: versionInfo.type,
      downloadLink: versionInfo.link
    }
  })
}

function normalizeFicsitVersionModalItem(item = {}) {
  const modReference = String(item?.modReference || item?.mod_reference || '').trim()
  return {
    ...item,
    full_name: modReference,
    modReference,
    name: String(item?.name || modReference || '--').trim(),
    owner: 'Ficsit',
    currentVersion: String(resolveInstalledInfo(item)?.version || '').trim()
  }
}

function normalizeFicsitVersionForModal(version = {}, item = {}) {
  const versionNumber = String(version?.version || version?.version_number || '').trim()
  const downloadUrl = normalizeFicsitDownloadUrl(version?.link || version?.install_url || '')
  if (!versionNumber || !downloadUrl) {
    return null
  }

  return {
    id: String(version?.id || version?.versionId || '').trim(),
    version_number: versionNumber,
    version: versionNumber,
    install_url: downloadUrl,
    link: downloadUrl,
    stability: String(version?.stability || '').trim(),
    downloads: toSafeNumber(version?.downloads, 0),
    file_size: toSafeNumber(version?.size || version?.file_size, 0),
    date_created: String(version?.created_at || version?.date_created || '').trim(),
    date_updated: String(version?.updated_at || version?.date_updated || '').trim(),
    icon: String(item?.logo || '').trim(),
    description: String(item?.shortDescription || item?.fullDescription || '').trim(),
    dependencies: Array.isArray(version?.dependencies) ? version.dependencies : [],
    is_active: version?.approved !== false
  }
}

function resolveFicsitModalDefaultVersion(versions = [], item = {}) {
  const preferred = String(item?.latestVersion || '').trim()
  if (preferred) {
    const matched = versions.find((version) => String(version?.version_number || '') === preferred)
    if (matched) {
      return String(matched.version_number || '').trim()
    }
  }

  return String(
    versions.find((version) => version?.is_active !== false)?.version_number || ''
  ).trim()
}

function normalizeInstalledRecord(item = {}) {
  return {
    id: toSafeNumber(item?.id, 0),
    appId: toSafeNumber(item?.appId, 0),
    modId: toSafeNumber(item?.modId, 0),
    modReference: String(item?.modReference || '').trim(),
    name: String(item?.name || '').trim(),
    version: String(item?.version || '').trim(),
    downloadUrl: String(item?.downloadUrl || '').trim(),
    logo: String(item?.logo || '').trim(),
    installState: toSafeNumber(item?.installState, 0),
    fileCount: toSafeNumber(item?.fileCount, 0),
    dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
    dependents: Array.isArray(item?.dependents) ? item.dependents : [],
    activeDependents: Array.isArray(item?.activeDependents) ? item.activeDependents : [],
    metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    source: String(item?.source || 'ficsit').trim(),
    sourceAdapter: String(item?.sourceAdapter || 'ficsit').trim(),
    installedAt: String(item?.installedAt || '').trim(),
    updatedAt: String(item?.updatedAt || '').trim(),
    priorityOrder: toSafeNumber(item?.priorityOrder ?? item?.priority_order, 0)
  }
}

function buildInstalledRecordKey(item = {}) {
  const referenceKey = normalizeText(item?.modReference)
  if (referenceKey) return `ref:${referenceKey}`
  const nameKey = normalizeText(item?.name)
  if (nameKey) return `name:${nameKey}`
  return ''
}

function mergeInstalledRecords(list = [], options = {}) {
  const nextRecords = Array.isArray(list) ? list.map((item) => normalizeInstalledRecord(item)) : []
  const replace = !!options?.replace
  if (!nextRecords.length) {
    if (replace) {
      installedClientList.value = []
    }
    return
  }

  const recordMap = new Map()
  const baseList = replace ? [] : installedClientList.value

  for (const item of baseList) {
    const key = buildInstalledRecordKey(item)
    if (key && !recordMap.has(key)) {
      recordMap.set(key, item)
    }
  }

  for (const item of nextRecords) {
    const key = buildInstalledRecordKey(item)
    if (!key) {
      continue
    }
    recordMap.set(key, item)
  }

  installedClientList.value = Array.from(recordMap.values())
}

async function syncInstalledStateAfterInstallSuccess(installResult = {}) {
  const installPlan = Array.isArray(installResult?.installPlan) ? installResult.installPlan : []
  const fallbackPlanItem = installPlan[installPlan.length - 1] || null
  const records = installResult?.records?.length
    ? installResult.records
    : installResult?.record
      ? [installResult.record]
      : []

  if (records.length > 0) {
    mergeInstalledRecords(records)
  }

  const fallbackModReference = String(
    installResult?.requestModReference || fallbackPlanItem?.modReference || ''
  ).trim()
  if (!records.length && fallbackModReference) {
    mergeInstalledRecords([
      {
        modReference: fallbackModReference,
        name: String(
          installResult?.record?.name || fallbackPlanItem?.name || fallbackModReference
        ).trim(),
        version: String(installResult?.record?.version || fallbackPlanItem?.version || '').trim(),
        logo: String(installResult?.record?.logo || '').trim(),
        installState: 1
      }
    ])
  }

  const settledResults = await Promise.allSettled([refreshInstalledMods(), loadModList()])
  const rejectedTasks = settledResults.filter((item) => item.status === 'rejected')
  if (rejectedTasks.length > 0) {
    console.warn('安装完成后刷新 Ficsit 列表失败', rejectedTasks)
  }
}

function resolveFicsitFileType(downloadUrl = '') {
  const normalizedUrl = normalizeFicsitDownloadUrl(downloadUrl)
  if (!normalizedUrl) {
    return 'zip'
  }

  try {
    const match = new URL(normalizedUrl).pathname.match(/\.([a-z0-9]{2,8})$/i)
    return match ? match[1].toLowerCase() : 'zip'
  } catch {
    return 'zip'
  }
}

function buildFicsitDownloadBusinessId(appId, planItem = {}) {
  const sourceGameId = String(appId || getResolvedGameId() || FICSIT_STEAM_APP_ID).trim()
  const modKey = normalizeText(planItem?.modReference || planItem?.modId || planItem?.name)
  return sourceGameId && modKey ? `ficsit:${sourceGameId}:${modKey}` : ''
}

function buildFicsitDownloadDedupeKey(appId, planItem = {}) {
  const businessId = buildFicsitDownloadBusinessId(appId, planItem)
  const fileKey = normalizeText(planItem?.version || planItem?.versionId || planItem?.downloadUrl)
  return [businessId, fileKey].filter(Boolean).join(':')
}

function toPlainFicsitJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function resolveFicsitSourceGameId(appId = 0) {
  return Number(
    appId || gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
  )
}

function getFicsitArchiveName(archivePath = '') {
  return (
    String(archivePath || '')
      .trim()
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ''
  )
}

function normalizeFicsitDependencyRecord(item = {}) {
  if (typeof item === 'string') {
    const modReference = String(item || '').trim()
    return modReference
      ? {
          source: 'ficsit',
          sourceType: 'ficsit',
          sourceModKey: modReference,
          dependencyRole: 'ficsit_requirement',
          modReference,
          condition: '',
          optional: false,
          name: modReference,
          version: ''
        }
      : null
  }

  const source = item && typeof item === 'object' ? item : {}
  const modReference = String(
    source.modReference ||
      source.mod_reference ||
      source.sourceModKey ||
      source.source_mod_key ||
      ''
  ).trim()
  if (!modReference) {
    return null
  }

  return {
    source: 'ficsit',
    sourceType: 'ficsit',
    sourceModKey: String(source.sourceModKey || source.source_mod_key || modReference).trim(),
    dependencyRole: String(source.dependencyRole || 'ficsit_requirement').trim(),
    modReference,
    condition: String(source.condition || source.requiredVersion || '').trim(),
    optional: source.optional === true,
    name: String(source.name || source.modName || modReference).trim(),
    version: String(source.version || '').trim()
  }
}

function normalizeFicsitDependencyRecords(list = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const dependency = normalizeFicsitDependencyRecord(item)
    if (!dependency) {
      continue
    }

    const key = `${normalizeText(dependency.modReference)}@${String(dependency.condition || '')
      .trim()
      .toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(dependency)
  }
  return result
}

function buildFicsitSourceInstallPayload(planItem = {}, options = {}) {
  const appId = resolveFicsitSourceGameId(options?.appId)
  const installRule =
    options?.installRule && typeof options.installRule === 'object'
      ? options.installRule
      : buildMainFicsitInstallRule()
  const modReference = String(planItem?.modReference || planItem?.sourceModKey || '').trim()
  const version = String(planItem?.version || '').trim()
  const versionId = String(
    planItem?.versionId || planItem?.fileId || planItem?.metadata?.versionId || ''
  ).trim()
  const fileId = versionId || version || modReference
  const archivePath = String(
    options?.archivePath || planItem?.archivePath || planItem?.filePath || ''
  ).trim()
  const archiveName = String(options?.archiveName || getFicsitArchiveName(archivePath)).trim()
  const displayName = String(planItem?.name || modReference).trim()
  const dependencies = normalizeFicsitDependencyRecords(planItem?.dependencies)
  const profileName = String(options?.profileName || 'Ficsit').trim()
  const sortIndex = toSafeNumber(planItem?.sortIndex ?? options?.sortIndex, 0)
  const sourceMeta = {
    source: 'ficsit',
    sourceId: appId,
    sourceSlug: 'satisfactory',
    modReference,
    modName: displayName,
    version,
    versionId,
    stability: String(planItem?.stability || planItem?.metadata?.stability || '').trim(),
    fileName: archiveName,
    profileName
  }

  return toPlainFicsitJson({
    source: 'ficsit',
    sourceType: 'ficsit',
    sourcePlatform: 'ficsit',
    sourceAdapter: 'ficsit',
    sourceGameId: appId,
    sourceGameSlug: 'satisfactory',
    ficsitGameId: appId,
    appid: Number(appId || 0),
    appId,
    steamAppId: appId,
    gameId: getResolvedGameId(),
    gameName: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
    gameRoot: String(gameRuntime.value.clientRootPath || '').trim(),
    clientInstallPath: '.',
    serverInstallPath: '',
    modId: modReference,
    fileId,
    id: fileId,
    modReference,
    modName: displayName,
    name: displayName,
    packageFolderName: modReference,
    version,
    fileSize: toSafeNumber(planItem?.fileSize, 0),
    installType: 0,
    taskType: 0,
    usageType: 1,
    typeId: 0,
    cover: String(planItem?.logo || planItem?.cover || '').trim(),
    downloadUrl: String(planItem?.downloadUrl || '').trim(),
    archivePath,
    gameSourceId: String(appId),
    gameSourceSlug: 'satisfactory',
    sourceId: modReference,
    sourceSlug: 'satisfactory',
    sourceGameDomain: 'satisfactory',
    gameDomainName: 'satisfactory',
    sourceModKey: modReference,
    priorityOrder: sortIndex,
    profileName,
    targetProfileName: profileName,
    cleanupSourceArchiveAfterInstall: true,
    modVersion: version,
    dependencies,
    ficsitInstallRule: installRule,
    sourceInstallRule: installRule,
      ruleSelection: ['local_override', 'player_profile', 'player', 'local'].includes(currentFicsitRule.value?.sourceType) ? 'local_override' : 'public',
      sharedRuleDocument: currentFicsitRule.value?.sharedRuleDocument || null,
    installRule,
    sourceMeta,
    metadata: {
      source: 'ficsit',
      sourceType: 'ficsit',
      sourceAdapter: 'ficsit',
      category: 'ficsit',
      sourceModKey: modReference,
      modReference,
      versionId: String(planItem?.versionId || '').trim(),
      sortIndex,
      profileName,
      stability: String(planItem?.stability || planItem?.metadata?.stability || '').trim(),
      dependencies,
      originalFicsitVersion: {
        id: versionId,
        version,
        stability: String(planItem?.stability || planItem?.metadata?.stability || '').trim(),
        link: String(planItem?.downloadUrl || '').trim()
      }
    },
    sourceOriginal: {
      ...sourceMeta,
      dependencies
    }
  })
}

function buildFicsitDownloadBatchEntries(installPlan = [], appId = 0, options = {}) {
  const installRule = buildMainFicsitInstallRule()
  const sourceGameId = String(appId || getResolvedGameId() || FICSIT_STEAM_APP_ID).trim()
  const profileName = String(options?.profileName || 'Ficsit').trim()

  return (Array.isArray(installPlan) ? installPlan : []).map((planItem, index) => {
    const modReference = String(planItem?.modReference || '').trim()
    const displayName = String(planItem?.name || modReference || '未知模组').trim()
    const version = String(planItem?.version || '').trim()
    const downloadUrl = String(planItem?.downloadUrl || '').trim()
    const preferredFileName = `${displayName}${version ? `-${version}` : ''}`
    const businessId = buildFicsitDownloadBusinessId(appId, planItem)
    const sortIndex = toSafeNumber(planItem?.sortIndex, index)
    return {
      item: {
        task_name: uiText('ui.ficsitModDownloadValueValue', { value1: (displayName), value2: (version ? `@${version}` : '') }),
        module: '游戏',
        file_type: resolveFicsitFileType(downloadUrl),
        download_url: downloadUrl,
        file_size: toSafeNumber(planItem?.fileSize, 0),
        saveType: 2,
        sourcePlatform: 'ficsit',
        sourceType: 'ficsit',
        sourceGameId,
        sourceModId: modReference,
        sourceModKey: businessId,
        modReference,
        version,
        preferredFileName,
        businessId,
        dedupeKey: buildFicsitDownloadDedupeKey(appId, planItem),
        fun: {
          type: 0
        }
      },
      meta: {
        ...planItem,
        sortIndex,
        sourcePlatform: 'ficsit',
        sourceType: 'ficsit',
        displayName,
        installPayload: buildFicsitSourceInstallPayload(planItem, {
          appId,
          installRule,
          profileName
        })
      }
    }
  })
}

function buildFicsitSourceModpackShareItems() {
  const appId = Number(
    gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
  )
  return (Array.isArray(installedClientList.value) ? installedClientList.value : [])
    .filter((item) => toSafeNumber(item?.installState, 1) !== 0)
    .map((item, index) => {
      const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
      const originalVersion =
        metadata?.originalFicsitVersion && typeof metadata.originalFicsitVersion === 'object'
          ? metadata.originalFicsitVersion
          : {}
      const modReference = String(item?.modReference || metadata?.modReference || '').trim()
      const version = String(item?.version || originalVersion?.version || '').trim()
      const versionId = String(metadata?.versionId || originalVersion?.id || version || '').trim()
      if (!modReference) {
        return null
      }
      const installRulePlan =
        metadata?.installRulePlan && typeof metadata.installRulePlan === 'object'
          ? metadata.installRulePlan
          : {}
      const archivePath = String(
        item?.archivePath ||
          item?.archive_path ||
          metadata?.archivePath ||
          metadata?.archive_path ||
          item?.archivedSourcePath ||
          item?.archived_source_path ||
          metadata?.archivedSourcePath ||
          metadata?.archived_source_path ||
          ''
      ).trim()
      const stagingPath = String(
        item?.stagingPath ||
          item?.staging_path ||
          metadata?.stagingPath ||
          metadata?.staging_path ||
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
          metadata?.sourcePath ||
          metadata?.source_path ||
          metadata?.sourceRoot ||
          metadata?.source_root ||
          item?.filePath ||
          item?.file_path ||
          metadata?.filePath ||
          metadata?.file_path ||
          ''
      ).trim()
      const installRule =
        item?.installRule ||
        metadata?.installRule ||
        metadata?.sourceInstallRule ||
        buildMainFicsitInstallRule()
      return {
        sourcePlatform: 'ficsit',
        sourceModId: modReference,
        sourceModKey: modReference,
        sourceFileId: versionId,
        name: String(item?.name || modReference).trim(),
        displayName: String(item?.displayName || item?.name || modReference).trim(),
        version,
        cover: String(item?.cover || item?.logo || metadata?.logo || '').trim(),
        summary: String(item?.summary || item?.description || metadata?.description || '').trim(),
        author: String(item?.author || metadata?.author || '').trim(),
        isDefaultDependency:
          item?.isDefaultDependency === true ||
          String(item?.dependencyRole || metadata?.category || '').trim() ===
            'default_dependency' ||
          String(modReference || '').startsWith('dependency:'),
        dependentCount: toSafeNumber(item?.dependentCount, 0),
        dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
        sortIndex: toSafeNumber(item?.priorityOrder ?? item?.priority_order, index),
        sourcePath,
        archivePath,
        stagingPath,
        filePath: sourcePath,
        primaryInstallPath: String(
          item?.primaryInstallPath || metadata?.primaryInstallPath || ''
        ).trim(),
        targetPath: String(item?.targetPath || metadata?.targetPath || '').trim(),
        installRoot: String(gameRuntime.value.clientRootPath || metadata?.installRoot || '').trim(),
        installRule,
        sourceInstallRule: installRule,
      ruleSelection: ['local_override', 'player_profile', 'player', 'local'].includes(currentFicsitRule.value?.sourceType) ? 'local_override' : 'public',
      sharedRuleDocument: currentFicsitRule.value?.sharedRuleDocument || null,
        installPayload: item?.installPayload || metadata?.installPayload || null,
        metadata: {
          ...metadata,
          appId,
          modId: Number(item?.modId || metadata?.modId || 0),
          modReference,
          sourcePath,
          sourceRoot: sourcePath,
          archivePath,
          stagingPath,
          filePath: sourcePath,
          downloadUrl: normalizeFicsitDownloadUrl(
            item?.downloadUrl || metadata?.downloadUrl || originalVersion?.link || ''
          ),
          logo: String(item?.logo || metadata?.logo || '').trim(),
          dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
          versionId,
          sortIndex: toSafeNumber(item?.priorityOrder ?? item?.priority_order, index),
          stability: String(metadata?.stability || originalVersion?.stability || '').trim()
        }
      }
    })
    .filter(Boolean)
}

function buildFicsitSourceModpackSnapshot(items = [], name = '') {
  const appId = Number(
    gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
  )
  const gameName = String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim()
  return buildSourceModpackCreatePayload({
    sourceType: 'ficsit',
    sourceGameId: String(resolveFicsitSourceGameId(appId)),
    sourceGameSlug: 'satisfactory',
    sourceGameName: gameName,
    name,
    cover: String(gameBaseInfo.value.coverImage || DEFAULT_GAME_INFO.coverImage).trim(),
    get description() { return uiText('ui.shareInstalledFicsitMods') },
    version: '1.0.0',
    items
  })
}

async function prepareFicsitSourceModpackSnapshot(name = '') {
  await refreshInstalledMods()
  const items = buildFicsitSourceModpackShareItems()
  if (!items.length) throw new Error(uiText('ui.noInstalledFicsitModsAreAvailableToShare'))
  return buildFicsitSourceModpackSnapshot(items, name)
}

async function shareFicsitSourceModpack() {
  if (sourceModpackSharing.value) return

  sourceModpackSharing.value = true
  try {
    const snapshot = await prepareFicsitSourceModpackSnapshot()
    const gameName = String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim()
    const shareName = await requestSourceModpackShareName(uiText('ui.valueFicsitModpack', { value1: (gameName) }))
    if (!shareName) {
      return
    }
    const result = await CREATE_SOURCE_MODPACK({ ...snapshot, name: shareName })
    const shareCode = extractSourceModpackShareCode(result)
    if (!shareCode) {
      throw new Error(uiText('ui.theServerDidNotReturnAShareCode'))
    }
    const copied = await copySourceModpackTextToClipboard(shareCode)
    $message.success(copied ? uiText('ui.shareCodeCreatedAndCopiedValue', { value1: (shareCode) }) : uiText('ui.shareCodeCreatedValue', { value1: (shareCode) }))
  } catch (error) {
    console.error('生成 Ficsit 分享码失败', error)
    $message.error(uiMessage('ui.couldNotCreateShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
  }
}

async function updateFicsitSourceModpack() {
  if (sourceModpackSharing.value) return
  sourceModpackSharing.value = true
  try {
    const snapshot = await prepareFicsitSourceModpackSnapshot()
    sourceModpackUpdateModal.value = { open: true, snapshot }
  } catch (error) {
    console.error('准备 Ficsit 分享更新失败', error)
    $message.error(uiMessage('ui.couldNotUpdateShareValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sourceModpackSharing.value = false
  }
}

function openSourceModpackImportModal() {
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

async function confirmFicsitSourceModpackImport() {
  const code = String(sourceModpackImportModal.value.code || '').trim()
  if (!code) {
    $message.warning(uiMessage('ui.enterAShareCode'))
    return
  }

  if (!gameRuntime.value.isGameFound) {
    await searchGamePath(false)
    if (!gameRuntime.value.isGameFound) {
      return
    }
  }

  sourceModpackImportModal.value.loading = true
  try {
    const appId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID)
    const inspection = await inspectShareImport({
      shareCode: code,
      entryPoint: 'ficsit',
      targetContext: {
        sourcePlatform: 'ficsit',
        sourceGameId: String(appId),
        sourceGameSlug: 'satisfactory',
        appId,
        backendGameId: getResolvedGameId(),
        gameName: gameBaseInfo.value.name,
        gameRoot: String(gameRuntime.value.clientRootPath || '').trim(),
        executableFile: String(gameRuntime.value.executableFile || DEFAULT_EXECUTABLE),
        endpointType: 0,
        profileName: ficsitProfileState.activeProfileName.value,
        installRule: buildMainFicsitInstallRule(),
        currentFicsitRule: JSON.parse(JSON.stringify(currentFicsitRule.value || {}))
      }
    })
    if (inspection.mode === 'latest') {
      $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
      closeSourceModpackImportModal()
      return
    }
    if (!(await requestSourceModpackInspectionConfirmation(Modal, inspection))) return
    const profileName = inspection.profileTargets?.[0]?.profileName
    if (profileName) await prepareFicsitImportProfile(profileName)
    const result = await applyShareImport({ planToken: inspection.planToken, expectedPlanHash: inspection.planHash })
    sourceModpackImportModal.value = { open: false, code: '', loading: false }
    $message.success(result.message || '已加入安装任务')
  } catch (error) {
    console.error('导入 Ficsit 分享码失败', error)
    $message.error(uiMessage('ui.couldNotImportShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    if (sourceModpackImportModal.value.open) {
      sourceModpackImportModal.value.loading = false
    }
  }
}

function normalizeFicsitSourceInstallIssueList(value = []) {
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

function collectFicsitSourceInstallPreviewIssues(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  return {
    risks: [
      ...normalizeFicsitSourceInstallIssueList(result?.risks),
      ...normalizeFicsitSourceInstallIssueList(plan?.risks)
    ],
    warnings: [
      ...normalizeFicsitSourceInstallIssueList(result?.warnings),
      ...normalizeFicsitSourceInstallIssueList(plan?.warnings)
    ]
  }
}

function isBlockingFicsitSourceInstallWarning(issue = {}) {
  const level = String(issue?.level || issue?.severity || '')
    .trim()
    .toLowerCase()
  return issue?.blocking === true || ['high', 'critical', 'fatal'].includes(level)
}

function canAutoExecuteFicsitSourceInstall(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  const issues = collectFicsitSourceInstallPreviewIssues(result)
  const autoExecutable = result?.autoExecutable === true || plan?.autoExecutable === true
  const requiresUserConfirm =
    result?.requiresUserConfirm === true || plan?.requiresUserConfirm === true

  return (
    result?.success === true &&
    result?.matched === true &&
    autoExecutable &&
    !requiresUserConfirm &&
    issues.risks.length <= 0 &&
    !issues.warnings.some((item) => isBlockingFicsitSourceInstallWarning(item))
  )
}

function resolveFicsitPreviewBlockReason(previewResult = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const plan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}
  const issues = collectFicsitSourceInstallPreviewIssues(result)
  const riskMessages = issues.risks
    .map((item) => String(item?.message || item?.code || '').trim())
    .filter(Boolean)
  const warningMessages = issues.warnings
    .filter((item) => isBlockingFicsitSourceInstallWarning(item))
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

function buildFicsitDownloadOnlyPreviewItem(entry = {}, previewResult = {}, installPayload = {}) {
  const result = previewResult && typeof previewResult === 'object' ? previewResult : {}
  const payload = installPayload && typeof installPayload === 'object' ? installPayload : {}
  const filePath = String(entry?.filePath || '').trim()
  return {
    taskId: String(entry?.id || '').trim(),
    name: String(entry?.meta?.displayName || payload.modName || payload.name || '').trim(),
    archiveName: String(
      result?.archiveName || getFicsitArchiveName(filePath) || payload.name || ''
    ).trim(),
    filePath,
    source: 'ficsit',
    sourceGameId: toSafeNumber(payload?.sourceGameId || payload?.ficsitGameId, FICSIT_STEAM_APP_ID),
    modReference: String(payload?.modReference || payload?.sourceModKey || '').trim(),
    version: String(payload?.version || '').trim(),
    archivePath: filePath,
    ruleVersion: toSafeNumber(currentFicsitRule.value?.ruleVersion, 0),
    inspectReason: resolveFicsitPreviewBlockReason(result),
    installPlan: result?.installPlan || null,
    previewResult: result,
    installPayload: payload,
    recognitionSummary:
      result?.recognitionSummary && typeof result.recognitionSummary === 'object'
        ? result.recognitionSummary
        : null
  }
}

async function markFicsitDownloadRecordsOpenable(previewList = []) {
  const safePreviewList = Array.isArray(previewList) ? previewList : []
  if (!safePreviewList.length) {
    return
  }

  await Promise.allSettled(
    safePreviewList.map((item) =>
      ipcRenderer.invoke('markDownloadRecordOpenable', {
        taskId: String(item?.taskId || '').trim(),
        filePath: String(item?.filePath || '').trim()
      })
    )
  )
}

function notifyFicsitRuleUnmatchedDownloadOnly(previewList = []) {
  const safePreviewList = Array.isArray(previewList) ? previewList : []
  if (!safePreviewList.length) {
    return
  }

  const reason = String(safePreviewList[0]?.inspectReason || '').trim()
  const countText = safePreviewList.length > 1 ? uiText('ui.valueFilesTotalVariant2', { value1: (safePreviewList.length) }) : ''
  $message.warning(
    uiMessage('ui.noUsableInstallationRulesMatchedThisModDownloadedFilesWere', { value1: (countText), value2: (reason ? `原因：${reason}` : '') })
  )
  console.info('[FICSIT] 未命中安装规则，已按下载记录保留', safePreviewList)
}

function notifyFicsitPreviewBlockedDownloadOnly(blockedList = []) {
  const safeList = Array.isArray(blockedList) ? blockedList : []
  if (!safeList.length) {
    return
  }

  const reason = String(safeList[0]?.inspectReason || '').trim()
  const countText = safeList.length > 1 ? uiText('ui.valueFilesTotal', { value1: (safeList.length) }) : ''
  $message.warning(uiMessage('ui.thisInstallationHasRisksRequiringConfirmationValueDownloadedFilesWereKept', { value1: (countText), value2: (reason) }))
}

function getFicsitInstallPlanOperationCount(plan = {}) {
  return Array.isArray(plan?.operations) ? plan.operations.length : 0
}

function buildFicsitSourceInstallPlanPreviewRows(previewItem = {}) {
  const plan =
    previewItem?.installPlan && typeof previewItem.installPlan === 'object'
      ? previewItem.installPlan
      : previewItem?.previewResult?.installPlan &&
          typeof previewItem.previewResult.installPlan === 'object'
        ? previewItem.previewResult.installPlan
        : {}
  const issues = collectFicsitSourceInstallPreviewIssues(previewItem?.previewResult || {})
  const riskMessages = issues.risks
    .map((item) => String(item?.message || item?.code || '').trim())
    .filter(Boolean)

  return [
    uiText('ui.ruleValueVariant2', { value1: (String(plan?.ruleId || plan?.strategy || '--').trim() || '--') }),
    uiText('ui.targetValue', { value1: (String(plan?.targetRoot || '--').trim() || '--') }),
    uiText('ui.filesToDeployValue', { value1: (getFicsitInstallPlanOperationCount(plan)) }),
    riskMessages.length ? uiText('ui.riskValue', { value1: (riskMessages.join('；')) }) : ''
  ].filter(Boolean)
}

function confirmFicsitSourceInstallPlans(previewItems = []) {
  const safeItems = Array.isArray(previewItems) ? previewItems : []
  if (!safeItems.length) {
    return true
  }

  return new Promise((resolve) => {
    Modal.confirm({
      get title() { return uiText('ui.confirmFicsitInstallationRisks') },
      width: 720,
      get okText() { return uiText('ui.continueInstallation') },
      get cancelText() { return uiText('ui.keepDownloadedFiles') },
      content: h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:12px;max-height:52vh;overflow:auto;' },
        safeItems.map((item, index) =>
          h(
            'div',
            {
              key: `${String(item?.filePath || '')}-${index}`,
              style: 'padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;'
            },
            [
              h(
                'div',
                { style: 'font-weight:700;color:#0f172a;margin-bottom:8px;' },
                String(item?.name || item?.archiveName || uiText('ui.installationItemValue', { value1: (index + 1) })).trim()
              ),
              ...buildFicsitSourceInstallPlanPreviewRows(item).map((line) =>
                h('div', { style: 'font-size:12px;line-height:1.7;color:#475569;' }, line)
              )
            ]
          )
        )
      ),
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

async function processDownloadedFicsitBatchResults(results = [], options = {}) {
  const safeResults = Array.isArray(results) ? results : []
  const appId = resolveFicsitSourceGameId(options?.appId)
  const requestModReference = String(options?.requestModReference || '').trim()
  const installRule = buildMainFicsitInstallRule()
  const previewItems = []

  for (let index = 0; index < safeResults.length; index += 1) {
    const entry = safeResults[index]
    const installPayload =
      entry?.meta?.installPayload && typeof entry.meta.installPayload === 'object'
        ? entry.meta.installPayload
        : entry?.meta && typeof entry.meta === 'object'
          ? entry.meta
          : null
    const filePath = String(entry?.filePath || '').trim()
    if (!installPayload || !filePath) {
      throw new Error(uiText('ui.theDownloadResultHasNoInstallationParameters'))
    }

    const sourceInstallPayload = buildFicsitSourceInstallPayload(installPayload, {
      appId,
      archivePath: filePath,
      archiveName: getFicsitArchiveName(filePath),
      installRule
    })

    upsertInstallProgress({
      modReference: requestModReference || sourceInstallPayload.modReference,
      stage: 'inspect',
      percent: Math.round(((index + 1) / safeResults.length) * 100),
      message: uiText('ui.resolvingInstallationRulesValue', { value1: (sourceInstallPayload.modName || sourceInstallPayload.modReference || uiText('ui.ficsitMod')) })
    })

    const previewResult = await previewSourceInstall({
      filePath,
      data: sourceInstallPayload,
      type: 1,
      source: 'ficsit'
    })

    previewItems.push(
      buildFicsitDownloadOnlyPreviewItem(entry, previewResult, sourceInstallPayload)
    )
  }

  const unmatchedList = previewItems.filter(
    (item) => item?.previewResult?.success !== true || item?.previewResult?.matched !== true
  )
  if (unmatchedList.length) {
    await markFicsitDownloadRecordsOpenable(previewItems)
    notifyFicsitRuleUnmatchedDownloadOnly(unmatchedList)
    return {
      installedCount: 0,
      previewCount: unmatchedList.length,
      blockedCount: 0,
      canceled: false
    }
  }

  const confirmList = previewItems.filter(
    (item) => !canAutoExecuteFicsitSourceInstall(item?.previewResult || {})
  )
  if (confirmList.length) {
    upsertInstallProgress({
      modReference: requestModReference || confirmList[0]?.modReference,
      stage: 'confirm',
      percent: 100,
      message: uiText('ui.thisInstallationIncludesScriptsOrExecutableActionsConfirmToContinue')
    })

    const confirmed = await confirmFicsitSourceInstallPlans(confirmList)
    if (!confirmed) {
      await markFicsitDownloadRecordsOpenable(previewItems)
      notifyFicsitPreviewBlockedDownloadOnly(confirmList)
      return {
        installedCount: 0,
        previewCount: 0,
        blockedCount: confirmList.length,
        canceled: true
      }
    }
  }

  let installedCount = 0
  for (let index = 0; index < previewItems.length; index += 1) {
    const previewItem = previewItems[index]
    const inspectToken = String(
      previewItem?.previewResult?.inspectToken || previewItem?.previewResult?.stagingToken || ''
    ).trim()
    const executePayload = {
      ...previewItem.installPayload,
      standardInspectToken: inspectToken
    }

    upsertInstallProgress({
      modReference: requestModReference || previewItem.modReference,
      stage: 'install',
      percent: Math.round(((index + 1) / previewItems.length) * 100),
      message: uiText('ui.deployingFilesValue', { value1: (previewItem.name || previewItem.modReference || uiText('ui.ficsitMod')) })
    })

    const installResult = await executeSourceInstall({
      filePath: previewItem.filePath,
      data: executePayload,
      type: 1,
      source: 'ficsit',
      inspectToken
    })

    if (!installResult?.success) {
      throw new Error(String(installResult?.message || uiText('ui.installationFailed')))
    }
    installedCount += 1
  }

  return {
    installedCount,
    previewCount: 0,
    blockedCount: 0,
    canceled: false,
    installPlan: previewItems.map((item) => ({
      modReference: String(item?.modReference || '').trim(),
      name: String(item?.name || '').trim(),
      version: String(item?.version || '').trim()
    }))
  }
}

function buildFicsitDownloadOnlyBatchEntry(item = {}) {
  const appId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || 0)
  const modReference = String(item?.modReference || '').trim()
  const planItem = {
    modId: Number(item?.modId || 0),
    modReference,
    name: String(item?.name || modReference).trim(),
    version: String(item?.latestVersion || '').trim(),
    versionId: String(item?.versionId || '').trim(),
    downloadUrl: String(item?.downloadLink || '').trim(),
    logo: String(item?.logo || '').trim(),
    fileSize: toSafeNumber(item?.fileSize, 0),
    stability: String(item?.latestVersionType || '').trim()
  }
  const entry = buildFicsitDownloadBatchEntries([planItem], appId)[0]
  const preferredFileName = `${planItem.name || modReference}${planItem.version ? `-${planItem.version}` : ''}.zip`
  return {
    ...entry,
    item: {
      ...(entry?.item || {}),
      showOpenInDownloadList: true,
      downloadPurpose: 'download_only',
      preferredFileName
    }
  }
}

async function downloadFicsitModOnly(item = {}) {
  const modReference = String(item?.modReference || '').trim()
  if (!modReference) {
    $message.warning(uiMessage('ui.thisModHasNoReferenceIdentifierForDownloading'))
    return
  }
  if (isInstallingMod(item)) {
    $message.warning(uiMessage('ui.thisModIsAlreadyDownloading'))
    return
  }

  const downloadUrl = String(item?.downloadLink || '').trim()
  if (!downloadUrl) {
    $message.warning(uiMessage('ui.thisModHasNoAvailableDownloadLink'))
    return
  }

  setInstallLoading(modReference, true)
  upsertInstallProgress({
    modReference,
    stage: 'queue',
    percent: 0,
    message: uiText('ui.addingToDownloadQueue')
  })

  try {
    const batchResult = downloadStore.addDownloadBatch([buildFicsitDownloadOnlyBatchEntry(item)], {
      batchId: `ficsit_download_${modReference}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      onComplete: async () => {
        upsertInstallProgress({
          modReference,
          stage: 'done',
          percent: 100,
          message: uiText('taskCenter.states.downloaded')
        })
        scheduleClearInstallProgress(modReference, 'done')
        setInstallLoading(modReference, false)
        $message.success(uiMessage('ui.downloadCompleteOpenTheFileFromDownloadHistory'))
      },
      onError: async ({ message = '' }) => {
        const errorMessage = String(message || '下载失败')
        upsertInstallProgress({
          modReference,
          stage: 'error',
          percent: 100,
          message: errorMessage
        })
        scheduleClearInstallProgress(modReference, 'error')
        setInstallLoading(modReference, false)
      }
    })

    if (!batchResult?.success) {
      throw new Error(String(batchResult?.message || uiText('ui.couldNotAddToTheDownloadQueue')))
    }

    $message.success(uiMessage('ui.addedToDownloadQueueVariant2'))
  } catch (error) {
    console.error('下载 Ficsit 模组失败', error)
    const message = String(error?.message || '下载失败')
    $message.error(message)
    upsertInstallProgress({
      modReference,
      stage: 'error',
      percent: 100,
      message
    })
    scheduleClearInstallProgress(modReference, 'error')
    setInstallLoading(modReference, false)
  }
}

function setInstallLoading(modReference, loadingState) {
  const key = normalizeText(modReference)
  if (!key) return
  const next = { ...installingMap.value }
  if (loadingState) {
    next[key] = true
  } else {
    delete next[key]
  }
  installingMap.value = next
}

function setVersionDialogLoading(modReference = '', loadingState = false) {
  const key = normalizeText(modReference)
  if (!key) return

  const next = { ...versionDialogLoadingMap.value }
  if (loadingState) {
    next[key] = true
  } else {
    delete next[key]
  }
  versionDialogLoadingMap.value = next
}

function setOperationLoading(id, loadingState) {
  const safeId = Number(id || 0)
  if (!safeId) return
  const next = { ...operationMap.value }
  if (loadingState) {
    next[safeId] = true
  } else {
    delete next[safeId]
  }
  operationMap.value = next
}

function clearInstallProgressTimer(modReference) {
  const key = normalizeText(modReference)
  if (!key) return
  const timer = installProgressTimerMap.get(key)
  if (timer) {
    clearTimeout(timer)
    installProgressTimerMap.delete(key)
  }
}

function clearInstallProgress(modReference) {
  const key = normalizeText(modReference)
  if (!key) return
  clearInstallProgressTimer(key)
  const next = { ...installProgressMap.value }
  delete next[key]
  installProgressMap.value = next
}

function clearAllInstallProgress() {
  Array.from(installProgressTimerMap.values()).forEach((timer) => clearTimeout(timer))
  installProgressTimerMap.clear()
  installProgressMap.value = {}
}

function scheduleClearInstallProgress(modReference, stage) {
  const delay = stage === 'done' ? INSTALL_PROGRESS_HIDE_DELAY : INSTALL_ERROR_HIDE_DELAY
  const key = normalizeText(modReference)
  if (!key) return
  clearInstallProgressTimer(key)
  const timer = setTimeout(() => {
    clearInstallProgress(key)
  }, delay)
  installProgressTimerMap.set(key, timer)
}

function applyRouteInfo() {
  const routeName = String(route.query?.name || '').trim()
  const routeEnglishName = String(route.query?.englishName || '').trim()
  const routeCover = String(route.query?.cover || '').trim()
  const routeDesc = String(route.query?.desc || '').trim()
  const routeModCount = toSafeNumber(route.query?.mods, 0)
  const routeSteamAppId = toSafeNumber(route.query?.steamAppId, FICSIT_STEAM_APP_ID)
  const routeId = toSafeNumber(route.query?.gameId || route.params?.id, 0)
  const safeSteamAppId = routeSteamAppId || FICSIT_STEAM_APP_ID
  const safeGameId = routeId || safeSteamAppId

  gameBaseInfo.value = {
    id: safeGameId,
    steamAppId: safeSteamAppId,
    name: routeName || DEFAULT_GAME_INFO.name,
    englishName: routeEnglishName || DEFAULT_GAME_INFO.englishName,
    coverImage: routeCover || DEFAULT_GAME_INFO.coverImage,
    description: routeDesc || DEFAULT_GAME_INFO.description,
    modCount: routeModCount
  }

  gameRuntime.value.gameId = safeGameId
  gameRuntime.value.steamAppId = safeSteamAppId
}

async function resolveFicsitGameDisplayName() {
  try {
    const resolved = await resolveGameNameFromDict({
      sourcePlatform: 'ficsit',
      rawName: gameBaseInfo.value.englishName || DEFAULT_GAME_INFO.englishName,
      fallbackName: gameBaseInfo.value.name || DEFAULT_GAME_INFO.name
    })
    const displayName = String(resolved?.displayName || '').trim()
    if (displayName) {
      gameBaseInfo.value = {
        ...gameBaseInfo.value,
        name: displayName,
        englishName:
          gameBaseInfo.value.englishName || resolved?.rawName || DEFAULT_GAME_INFO.englishName
      }
    }
  } catch (error) {
    console.warn('[Ficsit] 游戏中文名字典解析失败', error)
  }
}

function syncPageMenu() {
  setPageMenuName(() => `[Mod]-${gamePresentation(gameBaseInfo.value).title || DEFAULT_GAME_INFO.name}`, route.path)
}

function buildSourceMeta() {
  return {
    source: 'ficsit',
    sourceId: String(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || '').trim(),
    name: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
    backgroundImage: String(gameBaseInfo.value.coverImage || DEFAULT_GAME_INFO.coverImage).trim()
  }
}

function openModPage(item) {
  const modReference = String(item?.modReference || '').trim()
  if (!modReference) {
    $message.warning(uiMessage('ui.thisModHasNoDetailsLink'))
    return
  }

  router.push(
    buildGameSiteDetailRoute({
      url: `https://ficsit.app/mod/${encodeURIComponent(modReference)}`,
      title: String(item?.name || modReference).trim(),
      subtitle: modReference,
      source: 'Ficsit',
      sourceKey: 'ficsit',
      cover: String(item?.logo || '').trim(),
      backPath: route.fullPath,
      gameId: String(getResolvedGameId() || '').trim(),
      gameName: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
      sourceGameId: String(
        Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID)
      ).trim(),
      sourceSlug: 'satisfactory',
      appId: String(
        Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID)
      ).trim(),
      modId: modReference,
      modName: String(item?.name || modReference).trim(),
      author: String(item?.author || '').trim()
    })
  )
}

function handleOpenModDetail(card) {
  openModPage(card?.raw || card)
}

async function openFicsitInstallVersionModal(item = {}) {
  const normalizedItem = normalizeFicsitVersionModalItem(item)
  const modReference = String(normalizedItem?.modReference || '').trim()
  if (!modReference) {
    $message.warning(uiMessage('ui.thisModHasNoReferenceIdentifierForVersionSelection'))
    return
  }
  if (isInstallingMod(normalizedItem)) {
    $message.warning(uiMessage('ui.thisModIsBeingProcessed'))
    return
  }

  const currentToken = ++ficsitVersionModalToken
  ficsitVersionModal.value = createEmptyFicsitVersionModalState()
  setVersionDialogLoading(modReference, true)

  try {
    const detail = await getFicsitModVersions(modReference)
    if (currentToken !== ficsitVersionModalToken) {
      return
    }

    const sourceVersions = Array.isArray(detail?.versions) ? detail.versions : []
    const versions = sourceVersions
      .map((version) => normalizeFicsitVersionForModal(version, normalizedItem))
      .filter(Boolean)
    const targetVersion = resolveFicsitModalDefaultVersion(versions, normalizedItem)
    const selectedVersion =
      versions.find((version) => String(version?.version_number || '') === targetVersion) || null

    if (!versions.length || !targetVersion || !selectedVersion) {
      throw new Error(uiText('ui.noAvailableVersionsFound'))
    }

    ficsitVersionModal.value = {
      ...createEmptyFicsitVersionModalState(),
      open: true,
      mode: gameRuntime.value.isGameFound ? 'install' : 'download',
      item: normalizedItem,
      currentVersion: normalizedItem.currentVersion,
      profileName: 'Ficsit',
      versionNumber: targetVersion,
      versions,
      versionListLoading: false,
      selectedVersionDetail: selectedVersion,
      dependencyItems: selectedVersion.dependencies || []
    }
  } catch (error) {
    if (currentToken !== ficsitVersionModalToken) {
      return
    }
    console.error('加载 Ficsit 版本列表失败', error)
    $message.error(uiMessage('ui.couldNotLoadVersionListValue', { value1: (String(error?.message || modReference)) }))
    ficsitVersionModal.value = createEmptyFicsitVersionModalState()
  } finally {
    setVersionDialogLoading(modReference, false)
  }
}

function closeFicsitVersionModal(force = false) {
  if (ficsitVersionModal.value.confirmLoading && !force) {
    return
  }
  ficsitVersionModalToken += 1
  ficsitVersionModal.value = createEmptyFicsitVersionModalState()
}

function handleFicsitVersionChange(value) {
  const versionNumber = String(value || '').trim()
  const selectedVersion =
    ficsitVersionModal.value.versions.find(
      (version) => String(version?.version_number || '') === versionNumber
    ) || null

  ficsitVersionModal.value = {
    ...ficsitVersionModal.value,
    versionNumber,
    selectedVersionDetail: selectedVersion,
    dependencyItems: selectedVersion?.dependencies || []
  }
}

async function confirmFicsitVersionInstall(action = 'install') {
  const item = ficsitVersionModal.value.item
  const versionNumber = String(ficsitVersionModal.value.versionNumber || '').trim()
  if (!item?.modReference || !versionNumber) {
    $message.warning(uiMessage('ui.chooseAVersion'))
    return
  }
  if (ficsitVersionModal.value.versionListLoading) {
    $message.info(uiMessage('ui.loadingVersionInformationPleaseWait'))
    return
  }

  const selectedVersion =
    ficsitVersionModal.value.versions.find(
      (version) => String(version?.version_number || '') === versionNumber
    ) || ficsitVersionModal.value.selectedVersionDetail
  if (!selectedVersion?.install_url) {
    $message.warning(uiMessage('ui.theSelectedVersionHasNoDownloadLink'))
    return
  }

  ficsitVersionModal.value = {
    ...ficsitVersionModal.value,
    confirmLoading: true
  }

  const nextItem = {
    ...item,
    latestVersion: String(selectedVersion.version_number || versionNumber).trim(),
    latestVersionType: String(selectedVersion.stability || '').trim(),
    versionId: String(selectedVersion.id || '').trim(),
    downloadLink: normalizeFicsitDownloadUrl(selectedVersion.install_url),
    fileSize: toSafeNumber(selectedVersion.file_size, 0),
    dependencies: Array.isArray(selectedVersion.dependencies) ? selectedVersion.dependencies : []
  }
  const shouldInstall = action !== 'download' && !!gameRuntime.value.isGameFound
  closeFicsitVersionModal(true)

  if (shouldInstall) {
    await installMod(nextItem)
    return
  }
  await downloadFicsitModOnly(nextItem)
}

function handleInstallFromList(card) {
  const item = card?.raw || card
  openFicsitInstallVersionModal(item).then()
}

function openGameFolder() {
  const openPath =
    String(gameRuntime.value.targetPath || '').trim() ||
    String(gameRuntime.value.clientExePath || '').trim() ||
    String(gameRuntime.value.clientRootPath || '').trim()
  if (!openPath) {
    $message.warning(uiMessage('ui.noGamePathDetectedYet'))
    return
  }
  ipcRenderer.send('openSpecifyPath', openPath)
}

function scanNow() {
  if (pathLoading.value) {
    return
  }

  pathLoading.value = true
  ipcRenderer.send('scanNowGameById', {
    appId: String(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || ''),
    gameId: getResolvedGameId(),
    executableFile: String(gameRuntime.value.executableFile || DEFAULT_EXECUTABLE),
    sourceMeta: buildSourceMeta()
  })
}

function manuallyAddGame() {
  if (pathLoading.value) {
    return
  }

  pathLoading.value = true
  ipcRenderer.send('manuallyAddGame', {
    appId: String(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || ''),
    executableFile: String(gameRuntime.value.executableFile || DEFAULT_EXECUTABLE),
    client_root_path: String(gameRuntime.value.clientRootPath || ''),
    gameId: getResolvedGameId(),
    sourceMeta: buildSourceMeta()
  })
}

function launchGame() {
  if (!gameRuntime.value.isGameFound) {
    $message.warning(uiMessage('ui.detectTheGamePathBeforeLaunching'))
    return
  }

  const exePath = String(gameRuntime.value.clientExePath || '').trim()
  if (!exePath) {
    $message.warning(uiMessage('ui.theGameFolderWasDetectedButNoExecutablePathIs'))
    return
  }

  ipcRenderer.send('startSpecifiedApp', {
    path: exePath,
    steamAppId: Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || 0)
  })
}

function openLocalBindingWithGameRootCheck() {
  if (pathLoading.value) {
    return
  }

  if (gameRuntime.value.isGameFound) {
    openManageModal({ action: 'manage-local-mod' })
    return
  }

  Modal.confirm({
    get title() { return uiText('ui.noGameDetected') },
    content: '当前还未识别游戏目录，是否先绑定游戏根目录？绑定完成后才能管理本地模组。',
    get okText() { return uiText('ui.chooseFolder') },
    get cancelText() { return uiText('ui.cancel') },
    onOk() {
      pendingLocalBindingAfterManualBind.value = true
      manuallyAddGame()
    }
  })
}

function handleHeaderAction(actionKey = '') {
  const key = String(actionKey || '').trim()
  if (key === 'profile-scheme') {
    openProfileSchemeModal()
    return
  }
  if (key === 'manage') {
    openManageModal()
    return
  }
  if (key === 'manage-local-mod') {
    openLocalBindingWithGameRootCheck()
    return
  }
  if (key === 'launch') {
    launchGame()
    return
  }
  if (key === 'open-root') {
    openGameFolder()
    return
  }
  if (key === 'scan') {
    scanNow()
    return
  }
  if (key === 'rule-config') {
    openFicsitRuleConfigPage()
    return
  }
  if (key === 'share-source-modpack') {
    shareFicsitSourceModpack().then()
    return
  }
  if (key === 'import-source-modpack') {
    openSourceModpackImportModal()
    return
  }
  if (key === 'manual-bind') {
    manuallyAddGame()
  }
}

function openFicsitRuleConfigPage() {
  router.push({
    name: 'GameSourceInstallConfig',
    params: {
      sourcePlatform: 'ficsit',
      id: String(
        gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
      )
    },
    query: {
      ...route.query,
      sourcePlatform: 'ficsit',
      name: gameBaseInfo.value.name || DEFAULT_GAME_INFO.name,
      cover: gameBaseInfo.value.coverImage || DEFAULT_GAME_INFO.coverImage,
      appId: Number(
        gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || FICSIT_STEAM_APP_ID
      ),
      gameId: getResolvedGameId()
    }
  })
}

async function searchGamePath(silent = true) {
  pathLoading.value = true
  try {
    const result = await resolveFicsitGamePath({
      appId: Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId),
      executableFile: String(gameRuntime.value.executableFile || DEFAULT_EXECUTABLE),
      gameId: getResolvedGameId(),
      sourceMeta: buildSourceMeta()
    })

    if (!result?.success) {
      gameRuntime.value.clientRootPath = ''
      gameRuntime.value.clientExePath = ''
      gameRuntime.value.targetPath = ''
      gameRuntime.value.isGameFound = false
      installedClientList.value = []
      installedServerList.value = []
      if (!silent) {
        $message.warning(result?.message || '未识别到游戏路径')
      }
      return
    }

    const game = result?.game || {}
    gameRuntime.value.clientRootPath = String(game.clientRootPath || '')
    gameRuntime.value.clientExePath = String(game.clientExePath || '')
    gameRuntime.value.targetPath = String(game.targetPath || '')
    gameRuntime.value.executableFile = String(
      game.executableFile || gameRuntime.value.executableFile || DEFAULT_EXECUTABLE
    )
    gameRuntime.value.isGameFound = !!game.found
    await refreshInstalledMods()
  } catch (error) {
    console.error('识别游戏路径失败', error)
    gameRuntime.value.isGameFound = false
    if (!silent) {
      $message.warning(uiMessage('ui.couldNotDetectGamePathValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    }
  } finally {
    pathLoading.value = false
  }
}

async function loadGameDetails() {
  syncPageMenu()
  await searchGamePath(true)
}

async function loadModList() {
  loading.value = true
  try {
    const result = await getFicsitModList({
      page: query.value.page,
      limit: query.value.limit,
      keyword: query.value.effectiveKeyword || query.value.keyword,
      sort: query.value.sort
    })

    pageData.value = {
      records: normalizeFicsitModList(result.records),
      total: toSafeNumber(result.total, 0),
      pages: Math.max(toSafeNumber(result.pages, 1), 1),
      current: Math.max(toSafeNumber(result.current, query.value.page), 1)
    }
    query.value.page = pageData.value.current
    gameBaseInfo.value.modCount = pageData.value.total
  } catch (error) {
    console.error('加载 Ficsit 模组列表失败', error)
    pageData.value = {
      records: [],
      total: 0,
      pages: 1,
      current: 1
    }
    $message.warning(uiMessage('ui.couldNotLoadFicsitModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    loading.value = false
  }
}

async function refreshInstalledMods() {
  const appId = Number(gameRuntime.value.steamAppId || 0)
  if (!appId) {
    installedClientList.value = []
    installedServerList.value = []
    return
  }

  manageLoading.value = true
  try {
    const result = await getFicsitInstalledMods({ appId })

    if (!result?.success) {
      return
    }
    const activeProfile = ficsitProfileState.activeProfileName.value || 'default'
    const filteredRecords = (result.records || []).filter(
      (item) => String(item?.profileName || 'default').trim() === activeProfile
    )
    mergeInstalledRecords(filteredRecords, { replace: true })
    installedServerList.value = []
  } catch (error) {
    console.error('读取已安装 Ficsit 模组失败', error)
  } finally {
    manageLoading.value = false
  }
}

function buildFicsitInstallTaskGameKeys() {
  const appId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || 0)
  const gameId = getResolvedGameId()
  return [
    appId ? `ficsit:${appId}` : '',
    gameId ? `ficsit:${gameId}` : '',
    `ficsit:${FICSIT_STEAM_APP_ID}`
  ]
}

async function handleSourceInstallTaskUpdated(_event, data = {}) {
  if (
    !shouldRefreshInstalledModsAfterSourceTask(data, 'ficsit', buildFicsitInstallTaskGameKeys(), {
      allowSourceOnly: true
    })
  ) {
    return
  }
  installedFicsitRefreshScheduler.schedule()
}

function openManageModal(options = {}) {
  goToModManagement(options)
}

function goToModManagement(options = {}) {
  const steamAppId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId || 0)
  const gameId = getResolvedGameId()
  const sourceId = String(gameId || steamAppId || FICSIT_STEAM_APP_ID).trim()

  gameStore.setCurrentManagedGame({
    sourceId,
    steamAppId,
    chineseTitle: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
    is_server_installed: 0,
    server_install_mod_type: 0,
    gId: gameId,
    sourceType: 'ficsit',
    sourceGameId: gameId
  })

  const query = Object.fromEntries(
    Object.entries({
      source: 'ficsit',
      sourceId,
      gameId: String(gameId || ''),
      steamAppId: String(steamAppId || ''),
      name: String(gameBaseInfo.value.name || DEFAULT_GAME_INFO.name).trim(),
      action: options.action
    }).filter(([, value]) => String(value || '').trim() !== '')
  )

  router.push({
    name: 'GameModManagement',
    params: {
      source: 'ficsit',
      id: sourceId
    },
    query
  })
}

function handleManageTabChange(tab) {
  manageActiveTab.value = String(tab || 'client')
}

function resolveInstalledInfo(item) {
  const key = normalizeText(item?.modReference)
  if (key && installedByReference.value.has(key)) {
    return installedByReference.value.get(key)
  }
  return installedByName.value.get(normalizeText(item?.name)) || null
}

function isInstallingMod(item) {
  const key = normalizeText(item?.modReference)
  if (!key) return false
  if (installingMap.value[key]) {
    return true
  }

  const progress = installProgressMap.value[key]
  if (!progress) return false

  const stage = String(progress.stage || '').toLowerCase()
  return stage && stage !== 'done' && stage !== 'error'
}

function resolveProgressMessage(progress) {
  if (!progress) return ''
  const message = String(progress.message || '').trim()
  if (message) return message
  const stage = String(progress.stage || '').toLowerCase()
  if (stage === 'queue') return '已加入下载队列...'
  if (stage === 'download') return '正在下载模组...'
  if (stage === 'inspect') return '正在解析安装规则...'
  if (stage === 'confirm') return '等待风险确认...'
  if (stage === 'install') return '正在安装 Ficsit 模组...'
  if (stage === 'extract') return '正在解压模组...'
  if (stage === 'deploy') return '正在部署模组...'
  if (stage === 'done') return '安装完成'
  if (stage === 'error') return '安装失败'
  return ''
}

function shouldShowDownloadSize(progress) {
  if (!progress) return false
  const stage = String(progress.stage || '').toLowerCase()
  if (stage !== 'download') return false
  return toSafeNumber(progress.totalBytes, 0) > 0 || toSafeNumber(progress.downloadedBytes, 0) > 0
}

function resolveDownloadSizeText(progress) {
  const downloadedBytes = toSafeNumber(progress?.downloadedBytes, 0)
  const totalBytes = toSafeNumber(progress?.totalBytes, 0)
  if (totalBytes > 0) {
    return uiText('ui.fileValueValue', { value1: (formatFileSize(downloadedBytes)), value2: (formatFileSize(totalBytes)) })
  }
  return uiText('ui.downloadedValue', { value1: (formatFileSize(downloadedBytes)) })
}

function shouldShowDownloadSpeed(progress) {
  if (!progress) return false
  const stage = String(progress.stage || '').toLowerCase()
  if (stage !== 'download') return false
  return toSafeNumber(progress.speed, 0) > 0
}

function upsertInstallProgress(payload = {}) {
  const key = normalizeText(payload?.modReference)
  if (!key) return

  const prev = installProgressMap.value[key] || {}
  const stage = String(payload?.stage || prev.stage || '').toLowerCase()
  const next = {
    ...prev,
    jobId: String(payload?.jobId || prev.jobId || ''),
    stage,
    percent: toSafeNumber(payload?.percent, prev.percent ?? 0),
    downloadedBytes: toSafeNumber(payload?.downloadedBytes, prev.downloadedBytes ?? 0),
    totalBytes: toSafeNumber(payload?.totalBytes, prev.totalBytes ?? 0),
    speed: stage === 'download' ? toSafeNumber(payload?.speed, prev.speed ?? 0) : 0,
    message: String(payload?.message || prev.message || ''),
    modReference: key
  }

  installProgressMap.value = {
    ...installProgressMap.value,
    [key]: next
  }

  if (stage === 'done' || stage === 'error') {
    scheduleClearInstallProgress(key, stage)
  }
}

function handleFicsitInstallProgress(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    return
  }
  upsertInstallProgress(payload)
}

async function installMod(item) {
  const modReference = String(item?.modReference || '').trim()
  if (!modReference) {
    $message.warning(uiMessage('ui.thisModHasNoReferenceIdentifierForInstallation'))
    return
  }

  if (!gameRuntime.value.isGameFound) {
    await searchGamePath(false)
    if (!gameRuntime.value.isGameFound) {
      return
    }
  }

  if (isInstallingMod(item)) {
    $message.warning(uiMessage('ui.thisModIsAlreadyBeingInstalled'))
    return
  }

  const downloadUrl = String(item?.downloadLink || '').trim()
  if (!downloadUrl) {
    $message.warning(uiMessage('ui.thisModHasNoAvailableDownloadLink'))
    return
  }

  const useSourceInstallTask = isSourceInstallTaskEnabled()
  setInstallLoading(modReference, true)
  if (!useSourceInstallTask) {
    upsertInstallProgress({
      modReference,
      stage: 'prepare',
      percent: 0,
      message: uiText('ui.creatingInstallationPlan')
    })
  }

  try {
    const appId = Number(gameRuntime.value.steamAppId || gameBaseInfo.value.steamAppId)
    const planResult = await prepareFicsitInstallPlan({
      appId,
      gameId: getResolvedGameId(),
      executableFile: String(gameRuntime.value.executableFile || DEFAULT_EXECUTABLE),
      modId: Number(item?.modId || 0),
      modReference,
      name: String(item?.name || modReference),
      version: String(item?.latestVersion || ''),
      downloadUrl,
      logo: String(item?.logo || ''),
      sourceInstallRule: buildMainFicsitInstallRule()
    })

    if (!planResult?.success) {
      throw new Error(planResult?.message || uiText('ui.couldNotCreateInstallationPlanVariant2'))
    }

    const installPlan = Array.isArray(planResult?.installPlan) ? planResult.installPlan : []
    if (!installPlan.length) {
      throw new Error(uiText('ui.theInstallationPlanIsEmptyCannotCreateDownloadTasks'))
    }

    const batchEntries = buildFicsitDownloadBatchEntries(installPlan, appId)
    if (useSourceInstallTask) {
      const result = await submitSourceInstallTask({
        source: 'ficsit',
        sourceAdapter: 'ficsit',
        sourceGameId: String(appId || getResolvedGameId() || FICSIT_STEAM_APP_ID),
        gameKey: `ficsit:${String(appId || getResolvedGameId() || FICSIT_STEAM_APP_ID)}`,
        gameRoot: String(gameRuntime.value.clientRootPath || gameRuntime.value.clientExePath || ''),
        title: String(item?.name || modReference || uiText('ui.ficsitInstallationTask')),
        items: batchEntries,
        installRule: buildMainFicsitInstallRule(),
        sourceMeta: {
          source: 'ficsit',
          modReference,
          gameId: getResolvedGameId(),
          appId
        },
        options: {
          autoStart: true,
          includeDependencies: true
        }
      })

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotAddInstallationTask')))
      }

      setInstallLoading(modReference, false)
      $message.success(result?.message || '已加入安装任务')
      return
    }

    upsertInstallProgress({
      modReference,
      stage: 'queue',
      percent: 0,
      message: uiText('ui.createdValueDownloadTasksAddingToQueue', { value1: (batchEntries.length) })
    })

    const batchResult = downloadStore.addDownloadBatch(batchEntries, {
      batchId: `ficsit_${modReference}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      onComplete: async (results) => {
        upsertInstallProgress({
          modReference,
          stage: 'prepare',
          percent: 0,
          message: uiText('ui.downloadCompleteInstallingMods')
        })

        try {
          const processResult = await processDownloadedFicsitBatchResults(results, {
            appId,
            requestModReference: String(planResult?.requestModReference || modReference).trim()
          })

          if (toSafeNumber(processResult?.installedCount, 0) > 0) {
            await syncInstalledStateAfterInstallSuccess({
              requestModReference: modReference,
              installPlan: processResult?.installPlan || []
            })
            upsertInstallProgress({
              modReference,
              stage: 'done',
              percent: 100,
              message:
                toSafeNumber(processResult.installedCount, 0) > 1
                  ? uiText('ui.installationCompleteIncludingValueDependencies', { value1: (toSafeNumber(processResult.installedCount, 0) - 1) })
                  : uiText('ui.installationComplete')
            })
            $message.success(uiMessage('ui.modInstallationComplete'))
            return
          }

          upsertInstallProgress({
            modReference,
            stage: 'done',
            percent: 100,
            message: uiText('ui.downloadedFilesWereKeptWithoutAutomaticInstallation')
          })
        } catch (error) {
          console.error('安装已下载的 Ficsit 模组失败', error)
          const message = String(error?.message || '安装失败')
          $message.error(message)
          upsertInstallProgress({
            modReference,
            stage: 'error',
            percent: 100,
            message
          })
          scheduleClearInstallProgress(modReference, 'error')
        } finally {
          setInstallLoading(modReference, false)
        }
      },
      onError: async ({ message = '' }) => {
        const errorMessage = String(message || '下载失败')
        setInstallLoading(modReference, false)
        upsertInstallProgress({
          modReference,
          stage: 'error',
          percent: 100,
          message: errorMessage
        })
        scheduleClearInstallProgress(modReference, 'error')
      }
    })

    if (!batchResult?.success) {
      throw new Error(String(batchResult?.message || uiText('ui.couldNotAddToTheDownloadQueue')))
    }

    upsertInstallProgress({
      modReference,
      stage: 'queue',
      percent: 0,
      message:
        batchEntries.length > 1
          ? uiText('ui.addedToDownloadQueueIncludingValueDependencies', { value1: (batchEntries.length - 1) })
          : uiText('ui.addedToDownloadQueueVariant2')
    })
    $message.success(uiMessage('ui.addedToDownloadQueueInstallationStartsAutomaticallyAfterDownloading'))
  } catch (error) {
    console.error('安装 Ficsit 模组失败', error)
    $message.error(String(error?.message || '安装失败'))
    setInstallLoading(modReference, false)
    if (!useSourceInstallTask) {
      upsertInstallProgress({
        modReference,
        stage: 'error',
        percent: 100,
        message: String(error?.message || uiText('ui.installationFailed'))
      })
      scheduleClearInstallProgress(modReference, 'error')
    }
  }
}

async function handleToggleMod(payload) {
  const mod = payload?.mod
  const checked = !!payload?.checked
  const modId = Number(mod?.id || 0)
  if (!modId) return

  setOperationLoading(modId, true)
  try {
    const result = await setFicsitModEnabled({ id: modId, enabled: checked })
    if (result?.success) {
      $message.success(result?.message || '状态已更新')
      await refreshInstalledMods()
    } else {
      $message.error(result?.message || '状态更新失败')
    }
  } catch (error) {
    console.error('切换模组状态失败', error)
    $message.error(uiMessage('ui.couldNotChangeModState'))
  } finally {
    setOperationLoading(modId, false)
  }
}

async function handleUninstallMod(mod) {
  const modId = Number(mod?.id || 0)
  if (!modId) return
  setOperationLoading(modId, true)
  try {
    const result = await uninstallFicsitMod({ id: modId })

    if (result?.success) {
      $message.success(result?.message || '卸载完成')
      await refreshInstalledMods()
    } else {
      $message.error(result?.message || '卸载失败')
    }
  } catch (error) {
    console.error('卸载模组失败', error)
    $message.error(uiMessage('ui.couldNotUninstallMod'))
  } finally {
    setOperationLoading(modId, false)
  }
}

async function handleToggleAll(payload) {
  const list = payload?.list || []
  const checked = !!payload?.checked
  if (!list.length) return

  if (!checked) {
    const targetIds = list
      .filter((mod) => Number(mod?.installState || 0) !== 0)
      .map((mod) => Number(mod?.id || 0))
      .filter((id) => id > 0)
    if (!targetIds.length) {
      $message.success(uiMessage('ui.allModsAreAlreadyDisabled'))
      return
    }

    const occupancyResult = await ficsitCheckModFileOccupancy({
      ids: targetIds
    })
    if (!occupancyResult?.success) {
      $message.warning(String(occupancyResult?.message || '检测到模组文件被占用，请关闭游戏后重试'))
      return
    }
  }

  manageLoading.value = true
  try {
    const promises = list
      .filter((mod) => mod.installState !== (checked ? 1 : 0))
      .map((mod) => setFicsitModEnabled({ id: Number(mod.id || 0), enabled: checked }))

    await Promise.allSettled(promises)
    $message.success(uiMessage('ui.allModsValue', { value1: (checked ? uiText('ui.enable') : uiText('ui.disable')) }))
    await refreshInstalledMods()
  } catch (error) {
    console.error('批量切换模组状态失败', error)
    $message.error(uiMessage('ui.couldNotChangeModStatesInBulk'))
  } finally {
    manageLoading.value = false
  }
}

async function handleUninstallAll(list) {
  if (!list || !list.length) return

  const occupancyResult = await ficsitCheckModFileOccupancy({
    ids: list.map((mod) => Number(mod?.id || 0)).filter((id) => id > 0)
  })
  if (!occupancyResult?.success) {
    $message.warning(String(occupancyResult?.message || '检测到模组文件被占用，请关闭游戏后重试'))
    return
  }

  manageLoading.value = true
  try {
    const promises = list.map((mod) => uninstallFicsitMod({ id: Number(mod.id || 0) }))
    await Promise.allSettled(promises)
    $message.success(uiMessage('ui.allModsUninstalled'))
    await refreshInstalledMods()
  } catch (error) {
    console.error('批量卸载模组失败', error)
    $message.error(uiMessage('ui.couldNotUninstallModsInBulk'))
  } finally {
    manageLoading.value = false
  }
}

async function handleSearch() {
  const currentToken = ++ficsitSearchResolveToken
  const keyword = String(query.value.keyword || '').trim()
  if (keyword && keyword.length < 3) {
    $message.warning(uiMessage('ui.enterAtLeast3CharactersToSearch'))
    return
  }
  const resolvedKeyword = await resolveEdgeSearchKeyword({
    keyword,
    source: 'ficsit',
    scene: 'mod_search_keyword',
    systemConfig: systemConfig.value,
    context: 'Ficsit 模组搜索'
  })
  if (
    currentToken !== ficsitSearchResolveToken ||
    String(query.value.keyword || '').trim() !== keyword
  ) {
    return
  }
  query.value.keyword = keyword
  query.value.effectiveKeyword = resolvedKeyword.effectiveKeyword
  query.value.page = 1
  loadModList()
}

async function handleTranslateFicsitCurrentPage() {
  if (ficsitPageTranslationLoading.value) {
    return
  }

  const requestItems = buildFicsitTranslationRequestItems(pageMods.value, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    $message.info(uiMessage('ui.modsOnThisPageTranslated'))
    return
  }

  const totalCount = countUntranslatedFicsitMods(pageMods.value)
  updateFicsitPageTranslationProgress(totalCount)
  ficsitPageTranslationLoading.value = true
  try {
    // 先把悬浮按钮的加载态和进度文案渲染出来，再进入模型加载/翻译流程。
    await waitForUiRender()
    await translateFicsitMods(pageMods.value, {
      onProgress: () => {
        updateFicsitPageTranslationProgress(totalCount)
      }
    })
    const completedCount = Math.max(totalCount - countUntranslatedFicsitMods(pageMods.value), 0)
    if (completedCount > 0) {
      $message.success(uiMessage('ui.translatedValueValueModsOnThisPage', { value1: (completedCount), value2: (totalCount) }))
      return
    }
    $message.info(uiMessage('ui.noNewTranslationsForThisPage'))
  } catch (error) {
    console.error('[FICSIT] 当前页模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateThisPageValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    ficsitPageTranslationLoading.value = false
    resetFicsitPageTranslationProgress()
  }
}

async function handleTranslateFicsitSingleMod(card = {}) {
  const rawItem = card?.raw || card
  const itemKey = String(rawItem?.modReference || rawItem?.id || rawItem?.name || '').trim()
  if (!itemKey) {
    return
  }

  const requestItems = buildFicsitTranslationRequestItems([rawItem], {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    return
  }

  ficsitItemTranslationLoadingMap.value = {
    ...ficsitItemTranslationLoadingMap.value,
    [itemKey]: true
  }

  try {
    const translatedMap = await translateTextBatchService({
      systemConfig: systemConfig.value,
      source: 'ficsit',
      scene: 'mod_list_card',
      items: requestItems
    })

    const translatedCount = mergeFicsitTranslationResultMap(translatedMap)
    if (translatedCount > 0) {
      $message.success(uiMessage('ui.modTranslationComplete'))
    } else {
      $message.info(uiMessage('ui.noNewTranslationsForThisMod'))
    }
  } catch (error) {
    console.error('[FICSIT] 单模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateModValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    ficsitItemTranslationLoadingMap.value = {
      ...ficsitItemTranslationLoadingMap.value,
      [itemKey]: false
    }
  }
}

function handleFicsitFloatingAction(action = {}) {
  const actionKey = String(action?.key || '').trim()
  if (actionKey === 'translate-current-page') {
    handleTranslateFicsitCurrentPage().then()
  }
}

function changePage(page) {
  query.value.page = page
  loadModList()
}

watch(
  () => query.value.keyword,
  () => {
    query.value.effectiveKeyword = ''
  },
  { flush: 'sync' }
)

watch(
  () => query.value.sort,
  () => {
    query.value.page = 1
    loadModList()
  }
)

watch(
  () => [
    query.value.keyword,
    query.value.sort,
    query.value.page,
    query.value.limit,
    gameBaseInfo.value.name,
    gameRuntime.value.gameId,
    gameRuntime.value.clientRootPath,
    gameRuntime.value.clientExePath,
    gameRuntime.value.isGameFound,
    ficsitProfileState.activeProfileName.value,
    currentFicsitRule.value?.ruleVersion || '',
    ficsitVersionModal.value.open,
    ficsitVersionModal.value.item?.modReference || ficsitVersionModal.value.item?.id || '',
    ficsitVersionModal.value.versionNumber,
    ficsitVersionModal.value.selectedVersionDetail?.id || ''
  ],
  () => {
    publishFicsitAiPageContext()
  },
  { immediate: true }
)

watch(
  () =>
    [
      pageMods.value
        .map((item) => {
          return `${item?.modReference || item?.id || item?.name || ''}:${item?.name || ''}:${item?.shortDescription || item?.fullDescription || ''}`
        })
        .join('|'),
      JSON.stringify([aiTranslationConfig.value, contentLocale.value])
    ].join('::'),
  async () => {
    ficsitTranslationMap.value = {}
    ficsitTranslationResolvedMap.value = {}
    ficsitItemTranslationLoadingMap.value = {}
    await hydrateFicsitModTranslations(pageMods.value)
    await autoTranslateFicsitMods(pageMods.value)
  },
  { immediate: true }
)

useIpc('scanNowGameSuccess', async () => {
  $message.success(uiMessage('ui.scanCompleteRefreshingPathInformation'))
  await searchGamePath(false)
})

useIpc('scanNowGameFail', () => {
  pathLoading.value = false
  $message.warning(uiMessage('ui.scanFailedTryAddingTheGameManually'))
})

useIpc('manuallyAddGameSuccess', async () => {
  $message.success(uiMessage('ui.addedManually'))
  await searchGamePath(false)
  if (pendingLocalBindingAfterManualBind.value && gameRuntime.value.isGameFound) {
    openManageModal({ action: 'manage-local-mod' })
  }
  pendingLocalBindingAfterManualBind.value = false
})

useIpc('manuallyAddGameFail', () => {
  pathLoading.value = false
  pendingLocalBindingAfterManualBind.value = false
  $message.warning(uiMessage('ui.selectTheCorrectExecutable'))
})

useIpc('updateLocalInfo', (data = {}) => {
  const appId = Number(data?.app_id || 0)
  if (appId !== Number(gameRuntime.value.steamAppId)) return
  searchGamePath(true)
})

function handleFicsitSystemConfigUpdated() {
  loadAiSystemConfig().then()
}

const { activate: activateSourceTaskListeners, deactivate: deactivateSourceTaskListeners } =
  createSourceInstallTaskSubscriptions(ipcRenderer, {
    onTaskUpdated: handleSourceInstallTaskUpdated,
    refreshScheduler: installedFicsitRefreshScheduler,
    listeners: [['ficsitInstallProgress', handleFicsitInstallProgress], ['update-system-config', handleFicsitSystemConfigUpdated]]
  })

onMounted(async () => {
  activateSourceTaskListeners()
  applyRouteInfo()
  await resolveFicsitGameDisplayName()
  syncPageMenu()
  await Promise.all([
    loadCurrentFicsitInstallRule(),
    loadGameDetails(),
    loadModList(),
    loadAiSystemConfig()
  ])
})

onActivated(async () => {
  activateSourceTaskListeners()
  if (!ficsitInitialActivationSkipped) {
    ficsitInitialActivationSkipped = true
    return
  }

  applyRouteInfo()
  await resolveFicsitGameDisplayName()
  syncPageMenu()
  await loadCurrentFicsitInstallRule()
  await refreshInstalledMods()
})

onDeactivated(() => {
  deactivateSourceTaskListeners()
})

onUnmounted(() => {
  clearAllInstallProgress()
  deactivateSourceTaskListeners()
  aiPageContextProvider.clear()
})

defineOptions({
  name: 'GameFicsitModList'
})
</script>

<template>
  <div class="ficsit-mod-list-page">
    <page-body>
      <div class="max_width">
        <unified-mod-header
          :rule-ai-context="{ sourcePlatform: 'ficsit', gameName: gameBaseInfo.name || DEFAULT_GAME_INFO.name, sourceGameId: String(gameRuntime.steamAppId || gameBaseInfo.steamAppId || FICSIT_STEAM_APP_ID), appId: gameRuntime.steamAppId || gameBaseInfo.steamAppId || FICSIT_STEAM_APP_ID }"
          :rule-ai-missing="!currentFicsitRule && installRuleFailure?.state === 'NOT_CONFIGURED'"
          rule-ai-editor-action="rule-config"
          :dlss-context="{ name: gameBaseInfo.name, gameId: gameRuntime.gameId, steamAppId: gameRuntime.steamAppId, sourcePlatform: 'ficsit', gameRoot: gameRuntime.isGameFound ? gameRuntime.clientRootPath : '', exePath: gameRuntime.isGameFound ? gameRuntime.clientExePath : '' }"
          :cover-image="gameBaseInfo.coverImage"
          :title="gamePresentation(gameBaseInfo).title"
          :subtitle="gamePresentation(gameBaseInfo).subtitle"
          :description="gameBaseInfo.description"
          :tags="headerTags"
          :stats="headerStats"
          :status-text="headerStatusText"
          :status-type="headerStatusType"
          :status-sub-text="headerStatusSubText"
          :actions="headerActions"
          @action="handleHeaderAction"
          @rule-saved="loadCurrentFicsitInstallRule"
        />

        <mod-source-profile-modal
          :open="profileConfigModal.open"
          :active-profile-name="ficsitProfileState.activeProfileName.value"
          :profile-options="ficsitProfileState.profileOptions.value"
          :profile-mod-count="installedClientList.length + installedServerList.length"
          :profile-switching="profileSwitching"
          :profile-operation-locked="false"
          :sharing-profile="sharingProfileLoading"
          :importing-profile="importingProfile"
          :show-namespace-hint="false"
          :create-profile-loading="createProfileModal.confirmLoading"
          :profile-name-max-length="ficsitProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeProfileSchemeModal"
          @switch-profile="handleProfileSwitch"
          @rename-profile="handleProfileRename"
          @delete-profile="handleProfileDelete"
          @create-profile="openCreateProfileModal"
          @confirm-create-profile="handleInlineCreateProfile"
          @share-profile="shareFicsitSourceModpack"
          @update-profile="updateFicsitSourceModpack"
          @import-profile="openSourceModpackImportModal"
          @export-file="handleExportToFile"
          @import-file="handleImportFromFile"
        />

        <mod-source-create-profile-modal
          :open="createProfileModal.open"
          :confirm-loading="createProfileModal.confirmLoading"
          :name="createProfileModal.name"
          :max-length="ficsitProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeCreateProfileModal"
          @confirm="confirmCreateProfileModal"
          @update:name="(value) => (createProfileModal.name = value)"
        />

        <unified-mod-search-bar
          :keyword="query.keyword"
          :sort="query.sort"
          :sort-options="sortOptions"
          :loading="loading"
          :keyword-placeholder="$t('ui.searchModDescriptions')"
          @update:keyword="(value) => (query.keyword = value)"
          @update:sort="(value) => (query.sort = value)"
          @search="handleSearch"
        />

        <div v-if="activeInstallProgress" class="install-progress">
          <div class="progress-head">
            <span>{{ $t('tools.installationProgress') }}</span>
          </div>
          <a-progress :percent="activeInstallProgress.percent" :status="activeInstallStatus" />
          <div class="progress-meta">
            <span>{{ resolveProgressMessage(activeInstallProgress) }}</span>
            <span v-if="shouldShowDownloadSize(activeInstallProgress)">
              {{ resolveDownloadSizeText(activeInstallProgress) }}
            </span>
            <span v-if="shouldShowDownloadSpeed(activeInstallProgress)">{{ $t('ui.speed') }}{{ formatTransferSpeed(activeInstallProgress.speed) }}
            </span>
          </div>
        </div>

        <unified-mod-list-grid
          :loading="loading"
          :loading-text="$t('ui.loadingFicsitMods')"
          :empty-text="$t('modBrowser.empty')"
          :items="listItems"
          :floating-actions="ficsitFloatingActions"
          :current="query.page"
          :pages="pageData.pages"
          :total="pageData.total"
          :size="query.limit"
          :current-count="pageMods.length"
          :show-pagination="!loading && pageData.total > 0"
          @open-detail="handleOpenModDetail"
          @translate-item="handleTranslateFicsitSingleMod"
          @floating-action="handleFicsitFloatingAction"
          @install="handleInstallFromList"
          @page-change="changePage"
        />
      </div>

      <ficsit-install-version-modal
        :system-config="systemConfig"
        :open="ficsitVersionModal.open"
        :modal-state="ficsitVersionModal"
        active-profile-name="Ficsit"
        :game-name="gamePresentation(gameBaseInfo).title || ''"
        @close="closeFicsitVersionModal"
        @confirm="confirmFicsitVersionInstall"
        @version-change="handleFicsitVersionChange"
      />

      <source-modpack-share-code-modal
        :open="sourceModpackImportModal.open"
        :code="sourceModpackImportModal.code"
        :loading="sourceModpackImportModal.loading"
        :title="$t('ui.importAFicsitShareCode')"
        :hint="$t('ui.createInstallationTasksForTheFicsitModsInThisShare')"
        @update:code="(value) => (sourceModpackImportModal.code = value)"
        @confirm="confirmFicsitSourceModpackImport"
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

      <mod-manage-modal
        v-if="false"
        v-model:open="manageVisible"
        :protocol="manageProtocol"
        @refresh="refreshInstalledMods"
        @tab-change="handleManageTabChange"
        @toggle-row="handleToggleMod"
        @toggle-all="handleToggleAll"
        @uninstall-row="handleUninstallMod"
        @uninstall-all="handleUninstallAll"
      />
    </page-body>
  </div>
</template>

<style scoped lang="scss">
/* ======================================
   Ficsit 模组列表主页面 — 深色沉浸风格
   ====================================== */

.max_width {
  min-width: 0;
  width: 100%;
  margin: 0;
  padding: 16px 0; /* Add top/bottom padding for the whole view */
}

.ficsit-mod-list-page {
  width: 100%;
  height: 100%;
}

/* 加载 / 空数据 状态区域 */
.status-view {
  margin-top: 16px;
  padding: 40px 16px;
  text-align: center;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(30, 35, 50, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-size: 14px;
  letter-spacing: 0.5px;
}

/* 模组网格 */
.mod-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px; /* UI Token: 16px gap between cards */
  margin-bottom: 24px;
}

.install-progress {
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #c7d2fe;
  background: #f8faff;

  .progress-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: #1e293b;
    font-size: 13px;
    gap: 10px;
  }

  .progress-meta {
    margin-top: 8px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    color: #475569;
    font-size: 12px;
  }
}
</style>
