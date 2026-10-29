import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../i18n/message.js'
import { describeSharedRuleFailure, sharedRuleError } from '../../../../../shared/installation/shared-install-rule.js'
import { useNexusListQuery } from './useNexusListQuery.js'
import { useNexusFiles } from './useNexusFiles.js'
import { createDescriptionTranslationPlan } from '@renderer/utils/mod-description-translation.js'
import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { useNexusInstallSubmission } from './useNexusInstallSubmission.js'
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  toRaw,
  watch
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import storage from '@renderer/common/storage.js'
import { $message } from '@renderer/common/message.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { resolveGameNameFromDict } from '@renderer/utils/game-name-dict.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useGameStore } from '@renderer/store/gameStore.js'
import { useUserStore } from '@renderer/store/userStore.js'
import {
  GET_SHARED_INSTALL_RULE,
} from '@renderer/api/modules/game.js'
import { normalizeNexusApiConfig } from '@renderer/utils/nexus-api-config.js'
import {
  isAiTranslationAvailable,
  queryCachedTextBatch as queryCachedTextBatchService,
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
import { buildGameSiteDetailRoute } from '@views/game/site-detail-route.js'
import { CREATE_SOURCE_MODPACK } from '@renderer/api/modules/source-modpack.js'
import {
  buildSourceModpackCreatePayload,
  copySourceModpackTextToClipboard,
  extractSourceModpackShareCode,
  toPlainSourceModpackJson
} from '@renderer/utils/source-modpack-share.js'
import { requestSourceModpackShareName } from '@renderer/utils/source-modpack-share-name.js'
import {
  inspectShareImport,
  applyShareImport
} from '@renderer/utils/source-modpack-coordinator-runtime.js'
import { requestSourceModpackInspectionConfirmation } from '@renderer/utils/source-modpack-import-ui.js'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { buildCsmPayload, signCsmPayload } from '@renderer/utils/cross-source-modpack-schema.js'
import {
  openOfflinePackExportDialog,
  openOfflinePackImportDialog,
  pickOfflinePackImportFile
} from '@renderer/views/game/vxpack/vxpack-service.js'
import {
  buildNexusSourceMeta as buildNexusSourceMetaService,
  decorateInstalledNexusRecords as decorateInstalledNexusRecordsService,
  getInstalledModsBySource as getInstalledModsBySourceService,
  normalizeInstalledNexusRecord as normalizeInstalledNexusRecordService,
  resolveCurrentRuleInjectDescriptor as resolveCurrentRuleInjectDescriptorService
} from './nexus-service.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../../shared/translation/ai-translation-config.js'
import {
  compileInstallRuleJson as compileNexusRuleJson,
  parseInstallRuleJsonText as parseNexusRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'

// 页面协调入口：规则、档案与页面上下文留在此处，查询/选择/提交各自拥有状态。
export function useNexusPageController() {
  const route = useRoute()

  const router = useRouter()

  const aiPageContextProvider = useAiPageContextProvider(route)

  const gameStore = useGameStore()

  const userStore = useUserStore()

  const { setMenuName: setPageMenuName } = useMenuName()

  const ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'active-install-config-profile'

  const LEGACY_NEXUS_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX =
    'nexus-active-install-config-profile'

  const nexusProfileState = useModSourceProfiles({
    sourceKey: 'nexus',
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
    const validation = nexusProfileState.validateNewProfileName(createProfileModal.value.name)
    if (!validation.ok) {
      $message.warning(validation.reason)
      return
    }
    createProfileModal.value.confirmLoading = true
    try {
      nexusProfileState.ensureProfile(validation.name, { select: false })
      $message.success(uiMessage('ui.profileCreatedValue', { value1: (validation.name) }))
      createProfileModal.value = { open: false, confirmLoading: false, name: '' }
    } catch (error) {
      console.error('新增 Nexus 配置失败', error)
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
    const currentName = nexusProfileState.resolveProfileNameInList(payload?.profileName)
    const validation = nexusProfileState.validateProfileRename(currentName, payload?.name)
    if (!validation.ok) {
      $message.warning(validation.reason)
      return
    }
    try {
      const result = await ipcRenderer.invoke('sourceProfile:rename', {
        appId: resolvedNexusAppId.value,
        source: 'nexus',
        sourceId: resolveCurrentNexusDomainName(),
        previousProfile: currentName,
        nextProfile: validation.name,
        endpointType: 0
      })
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRenameProfile'))
      nexusProfileState.renameProfile(currentName, validation.name)
      await refreshInstalledNexusMods()
      $message.success(result.message || uiText('ui.renamedToValue', { value1: (validation.name) }))
    } catch (error) {
      console.error('重命名 Nexus 配置失败', error)
      $message.error(uiMessage('ui.couldNotRenameValue', { value1: (error?.message || uiText('tools.unknownError')) }))
    }
  }

  async function handleProfileSwitch(name) {
    if (profileSwitching.value) return
    profileSwitching.value = true

    // 初始化切换进度弹窗
    profileSwitchProgress.value = {
      open: true,
      stage: 'start',
      targetProfile: name,
      fromProfile: nexusProfileState.activeProfileName.value,
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
        appId: resolvedNexusAppId.value,
        source: 'nexus',
        sourceId: resolveCurrentNexusDomainName(),
        targetProfile: name,
        currentProfile: nexusProfileState.activeProfileName.value,
        endpointType: 0
      })
      if (!result?.success) {
        throw new Error(result?.message || uiText('ui.someOperationsFailedWhileSwitchingProfiles'))
      }
      nexusProfileState.setSelectedProfile(name)
      // 后端已经按 profile 维度拼好分组文案（已激活 X / 已停用「B」Y / 附带清理孤儿 Z），
      // 直接用 result.message，避免前端再用 disabled/enabled 两个总数误导用户。
      $message.success(result.message || uiText('ui.switchedToProfileValue', { value1: (nexusProfileState.activeProfileName.value) }))
      // 刷新已安装模组列表
      await refreshInstalledNexusMods()
    } catch (error) {
      console.error('切换配置方案失败', error)
      $message.error(uiMessage('ui.couldNotSwitchValue', { value1: (error?.message || uiText('tools.unknownError')) }))
    } finally {
      ipcRenderer.removeListener('sourceProfile:switchProgress', onProgress)
      profileSwitching.value = false
      // 短暂延迟后关闭弹窗，让用户看到完成状态
      setTimeout(() => {
        profileSwitchProgress.value.open = false
      }, 600)
    }
  }

  async function prepareNexusImportProfile(profileName = '') {
    const previousProfileName = nexusProfileState.activeProfileName.value
    const targetProfileName = nexusProfileState.ensureProfile(profileName)
    try {
      const result = await ipcRenderer.invoke('sourceProfile:switch', {
        appId: resolvedNexusAppId.value,
        source: 'nexus',
        sourceId: resolveCurrentNexusDomainName(),
        targetProfile: targetProfileName,
        endpointType: 0
      })
      if (!result?.success) {
        throw new Error(result?.message || uiText('ui.couldNotSwitchToTheImportedProfileValue', { value1: (targetProfileName) }))
      }
      nexusProfileState.setSelectedProfile(targetProfileName)
      await refreshInstalledNexusMods()
      return nexusProfileState.activeProfileName.value
    } catch (error) {
      nexusProfileState.setSelectedProfile(previousProfileName)
      throw error
    }
  }

  function handleProfileDelete(name) {
    const resolvedName = nexusProfileState.resolveProfileNameInList(name)
    if (resolvedName === nexusProfileState.defaultProfileName.value) return
    if (
      String(resolvedName || '').toLowerCase() ===
      String(nexusProfileState.activeProfileName.value || '').toLowerCase()
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
        const targetName = nexusProfileState.resolveProfileNameInList(name)
        if (
          String(targetName || '').toLowerCase() ===
          String(nexusProfileState.activeProfileName.value || '').toLowerCase()
        ) {
          $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
          return
        }
        const deleteResult = await ipcRenderer.invoke('sourceProfile:delete', {
          appId: resolvedNexusAppId.value,
          source: 'nexus',
          sourceId: resolveCurrentNexusDomainName(),
          targetProfile: targetName,
          isDefault: targetName === nexusProfileState.defaultProfileName.value,
          endpointType: 0
        })
        if (!deleteResult?.success) {
          throw new Error(deleteResult?.message || uiText('ui.couldNotDeleteProfile'))
        }
        nexusProfileState.removeProfile(targetName)
        await refreshInstalledNexusMods()
        // 后端 message 已包含「清理 N 个模组及其源文件」之类的详情，直接透传
        $message.success(deleteResult.message || uiText('ui.profileDeletedValue', { value1: (resolvedName) }))
      }
    })
  }

  async function handleExportToFile() {
    try {
      await refreshInstalledNexusMods()
      const items = buildNexusSourceModpackShareItems()
      if (!items.length) {
        $message.warning(uiMessage('ui.noInstalledNexusModsAreAvailableToExport'))
        return
      }
      const domainName = String(gameBaseInfo.value.domainName || '').trim()
      const csm = buildCsmPayload({
        name: `${gameDisplayName.value || domainName} - ${nexusProfileState.activeProfileName.value}`,
        description: `Nexus Profile：${nexusProfileState.activeProfileName.value}`,
        cover: String(gameBaseInfo.value.coverImage || '').trim(),
        primaryGame: {
          gameKey: `nexus:${domainName}`,
          sourceType: 'nexus',
          sourceGameId: String(currentNexusRule.value?.nexusGameId || '').trim(),
          sourceGameSlug: domainName,
          sourceGameName: gameDisplayName.value || domainName
        },
        items
      })
      csm.checksum = await signCsmPayload(csm)
      openOfflinePackExportDialog({
        profilePayload: csm,
        exportItems: items,
        gameName: gameDisplayName.value || domainName,
        sourcePlatform: 'nexus',
        sourceGameId: String(currentNexusRule.value?.nexusGameId || '').trim(),
        sourceGameSlug: domainName,
        profileName: nexusProfileState.activeProfileName.value
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

  const userLoginRef = ref(null)

  const systemConfig = ref({
    nexusApi: {
      apiKey: '',
      apiKeySource: '',
    },
    aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
  })

  const gameBaseInfo = ref({
    domainName: '',
    name: '',
    coverImage: '',
    modCount: 0
  })

  const cloudNexusRule = ref(null)

  const localNexusRuleOverride = ref(null)

  const currentNexusRule = ref(null)

  const nexusBinding = ref(null)

  const detectStatus = ref('idle')
  const ruleLoadFailure = ref(null)

  const installSubmitting = ref(false)

  const installedNexusRefreshScheduler = createSourceInstallTaskRefreshScheduler(
    () => refreshInstalledNexusMods(),
    {
      logMessage: '刷新 Nexus 已安装模组失败'
    }
  )

  const nexusAutoTranslationInFlightSignature = ref('')

  const nexusAutoTranslationCompletedSignature = ref('')

  const nexusFileAutoTranslationInFlightSignature = ref('')

  const nexusFileAutoTranslationCompletedSignature = ref('')


  const installedNexusMods = ref([])

  const sourceModpackSharing = ref(false)

  const sourceModpackUpdateModal = ref({ open: false, snapshot: null })

  const sourceModpackImportModal = ref({
    open: false,
    code: '',
    loading: false
  })

  const hasInitializedPageMenuName = ref(false)

  const lastResolvedBindingSignature = ref('')

  const modTranslationMap = ref({})

  const modTranslationResolvedMap = ref({})

  const nexusFileTranslationMap = ref({})

  const nexusFileTranslationResolvedMap = ref({})

  const modPageTranslationLoading = ref(false)

  const modPageTranslationProgress = ref({
    current: 0,
    total: 0
  })

  const modItemTranslationLoadingMap = ref({})

  const nexusFileTranslationLoading = ref(false)

  const nexusInstallingMap = ref({})

  const nexusRuleCloudUpdatePrompting = ref(false)

  const manualBindingLoading = ref(false)

  const activeInstallConfigProfileSnapshot = ref(null)

  let modTranslationToken = 0

  let nexusFileTranslationToken = 0

  const hasNexusApiKey = computed(
    () => nexusAccountState.mode === 'oauth' ? nexusAccountState.connected :
      String(normalizeNexusApiConfig(systemConfig.value?.nexusApi).apiKey || '').trim() !== ''
  )

  const aiTranslationConfig = computed(() => resolveAiTranslationConfig(systemConfig.value))

  const canUseNexusAiTranslation = computed(() =>
    isAiTranslationAvailable(systemConfig.value, 'nexus')
  )

  function normalizeNexusContextFile(file = {}) {
    const fileId = toSafeNumber(file?.fileId || file?.id || file?.file_id, 0)
    const fileName = String(file?.name || file?.fileName || '').trim()
    return {
      fileId: fileId > 0 ? String(fileId) : '',
      id: fileId > 0 ? String(fileId) : '',
      fileName,
      name: fileName,
      version: normalizeVersionText(file?.version),
      category: String(file?.categoryLabel || file?.rawCategoryName || '').trim(),
      fileSize: toSafeNumber(file?.filesize || file?.fileSize || file?.size, 0),
      downloadAvailable: Boolean(String(file?.downloadUrl || file?.download_url || '').trim())
    }
  }

  function resolveNexusContextSelectedFile() {
    const targetFileId = toSafeNumber(nexusFileModal.value.targetFileId, 0)
    if (targetFileId <= 0) {
      return null
    }

    const files = Array.isArray(nexusFileModal.value.files) ? nexusFileModal.value.files : []
    return (
      files.find(
        (file) => toSafeNumber(file?.fileId || file?.id || file?.file_id, 0) === targetFileId
      ) || null
    )
  }

  function buildNexusAiContextMod() {
    const item = nexusFileModal.value.item || null
    if (!item) return {}

    const modId = toSafeNumber(item?.modId || item?.id, 0)
    if (modId <= 0) return {}

    const files = (Array.isArray(nexusFileModal.value.files) ? nexusFileModal.value.files : [])
      .filter((file) => !isHiddenNexusFile(file))
      .map((file) => normalizeNexusContextFile(file))
    const selectedFile = resolveNexusContextSelectedFile()
    const selectedFileContext = selectedFile ? normalizeNexusContextFile(selectedFile) : null
    const title = String(item?.name || item?.title || '').trim()
    const targetFileId = String(nexusFileModal.value.targetFileId || '').trim()

    return {
      source: 'nexus',
      modId,
      id: String(modId),
      name: title,
      title,
      version: String(selectedFileContext?.version || normalizeVersionText(item?.version)).trim(),
      selectedFileId: String(selectedFileContext?.fileId || targetFileId).trim(),
      selectedFileName: String(selectedFileContext?.fileName || '').trim(),
      targetFileId,
      downloadAvailable: files.some((file) => file.downloadAvailable),
      dependencyCount: toSafeNumber(nexusFileModal.value.requirementSummary?.totalCount, 0),
      fileCount: files.length,
      files,
      selectedFile: selectedFileContext
    }
  }

  function publishNexusAiPageContext() {
    const sourceGameId = String(resolveCurrentNexusGameId() || '').trim()
    const backendGameId = String(resolveCurrentNexusBackendGameId() || '').trim()
    const sourceSlug = resolveCurrentNexusDomainName()
    const steamAppId = String(resolveCurrentNexusSteamAppId() || '').trim()
    const profileName =
      String(
        nexusProfileState.activeProfileName.value || nexusProfileState.DEFAULT_PROFILE_NAME
      ).trim() || 'Default'
    const installRoot = String(nexusBinding.value?.detectedRootPath || '').trim()
    const executableFile = String(nexusBinding.value?.detectedExePath || '').trim()
    const ruleConfigured = hasNexusRuleContent(currentNexusRule.value)
    const apiConfigured = hasNexusApiKey.value

    return aiPageContextProvider.update({
      game: {
        source: 'nexus',
        name: gameDisplayName.value,
        sourceGameId,
        sourceSlug,
        domainName: sourceSlug,
        // AI 本地工具按 games.id 查询；后端规则编号和 Nexus 编号另行保留。
        gameId: String(nexusBinding.value?.id || ''),
        localGameId: String(nexusBinding.value?.id || ''),
        backendGameId,
        steamAppId,
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
        sort: String(listType.value || '').trim(),
        page: Number(query.value.page || 1),
        pageSize: Number(query.value.limit || 40),
        filters: {
          sourceGameId,
          sourceSlug,
          profile: profileName
        }
      },
      mod: buildNexusAiContextMod(),
      install: {
        bindingConfigured: detectStatus.value === 'identified',
        ruleConfigured,
        installRoot,
        profileName
      },
      auth: {
        source: 'nexus',
        status: apiConfigured ? 'configured' : 'missing',
        configured: apiConfigured,
        required: true,
        credentialType: 'api_key'
      },
      sourceState: {
        source: 'nexus',
        status: apiConfigured ? 'active' : 'auth_required',
        label: 'Nexus',
        configured: apiConfigured,
        summary: apiConfigured ? uiText('ui.nexusAPIKeyConfigured') : uiText('ui.nexusAPIKeyNotConfigured')
      }
    })
  }

  const canManualBindGame = computed(() => {
    return hasNexusRuleContent(currentNexusRule.value)
  })

  const showAiOriginalText = computed(() => !!aiTranslationConfig.value.showOriginalText)

  function countUntranslatedNexusMods(list = pageMods.value) {
    return (Array.isArray(list) ? list : []).filter((item) => !isModCardTranslationResolved(item))
      .length
  }

  const untranslatedPageModCount = computed(() => {
    return countUntranslatedNexusMods(pageMods.value)
  })

  const nexusModFloatingActions = computed(() => {
    if (!canUseNexusAiTranslation.value || !pageMods.value.length) {
      return []
    }

    return [
      {
        key: 'translate-current-page',
        label: untranslatedPageModCount.value > 0 ? uiText('ui.translateCurrentPage') : uiText('ui.currentPageTranslated'),
        loading: modPageTranslationLoading.value,
        get loadingText() { return uiText('ui.translateCurrentPage') },
        progressCurrent: modPageTranslationProgress.value.current,
        progressTotal: modPageTranslationProgress.value.total,
        disabled: modPageTranslationLoading.value || untranslatedPageModCount.value <= 0,
        visible: true
      }
    ]
  })

  const gameDisplayName = computed(() => {
    const name = gamePresentation(gameBaseInfo.value).title
    if (name) return name
    return String(gameBaseInfo.value?.domainName || '').trim() || 'Nexus 游戏'
  })

  const nexusConfigGameContext = computed(() => {
    const domainName = resolveCurrentNexusDomainName()
    return {
      sourcePlatform: 'nexus',
      gameKey: domainName ? `nexus:${domainName}` : '',
      gameId: resolveCurrentNexusBackendGameId(),
      nexusGameId: resolveCurrentNexusGameId(),
      appId: resolvedNexusAppId.value,
      domainName,
      gameName: gameDisplayName.value
    }
  })

  const hasCloudNexusRule = computed(() => hasNexusRuleContent(cloudNexusRule.value))

  const listTypeLabel = computed(() => {
    return typeOptions.find((item) => item.value === listType.value)?.label || '--'
  })

  const headerTags = computed(() => {
    const tags = ['Nexus']
    const domainName = String(gameBaseInfo.value.domainName || '').trim()
    if (domainName) {
      tags.push(uiText('ui.domainValue', { value1: (domainName) }))
    }
    tags.push(uiText('ui.listValue', { value1: (listTypeLabel.value) }))
    if (remoteHasMorePage.value) {
      tags.push('可继续翻页')
    }
    return tags
  })

  const listTotalCount = computed(() => {
    return remoteTotalCount.value
  })

  const headerStats = computed(() => {
    return [
      {
        get label() { return uiText('modBrowser.count') },
        value: formatNumber(listTotalCount.value),
        accent: true
      }
    ]
  })

  const detectStatusText = computed(() => {
    if (detectStatus.value === 'scanning') return uiText('modBrowser.scanning')
    if (detectStatus.value === 'identified') return uiText('modBrowser.identified')
    if (detectStatus.value === 'unidentified') return uiText('modBrowser.unidentified')
    if (detectStatus.value === 'rule_unavailable') return ruleLoadFailure.value?.label || uiText('modBrowser.ruleError')
    if (detectStatus.value === 'no_detection_rule') return uiText('ui.detectionConfigurationMissing')
    if (detectStatus.value === 'no_rule') return uiText('ui.noRulesConfigured')
    return uiText('modBrowser.unknownStatus')
  })

  const detectStatusType = computed(() => {
    if (detectStatus.value === 'identified') return 'success'
    if (detectStatus.value === 'scanning') return 'info'
    if (['no_rule', 'rule_unavailable', 'no_detection_rule'].includes(detectStatus.value)) return 'danger'
    if (detectStatus.value === 'unidentified') return 'danger'
    return 'info'
  })

  const detectStatusSubText = computed(() => {
    if (detectStatus.value === 'rule_unavailable') return ruleLoadFailure.value?.message || ''
    if (detectStatus.value === 'no_detection_rule') return uiText('ui.rulesWereRetrievedButDoNotIncludeGameFolderDetection')
    return ''
  })
  const canGenerateRulePrompt = computed(() => {
    if (hasNexusRuleContent(currentNexusRule.value)) return false
    return detectStatus.value === 'no_rule' || (
      detectStatus.value === 'rule_unavailable' && ruleLoadFailure.value?.state === 'NOT_CONFIGURED'
    )
  })
  const dlssContext = computed(() => ({
    name: gameDisplayName.value,
    gameRoot: detectStatus.value === 'identified' ? nexusBinding.value?.detectedRootPath || '' : '',
    exePath: detectStatus.value === 'identified' ? nexusBinding.value?.detectedExePath || '' : '',
    gameId: resolveCurrentNexusBackendGameId(),
    steamAppId: resolveCurrentNexusSteamAppId(),
    sourcePlatform: 'nexus'
  }))

  const detectedGameExecutablePath = computed(() => {
    return String(nexusBinding.value?.detectedExePath || '').trim()
  })

  const activeInjectableNexusMods = computed(() => {
    return (Array.isArray(installedNexusMods.value) ? installedNexusMods.value : []).filter(
      (item) => {
        return !!item?.isInjectable && toSafeNumber(item?.isActive, 0) === 1
      }
    )
  })

  const activeDefaultExecutableNexusMods = computed(() => {
    return (Array.isArray(installedNexusMods.value) ? installedNexusMods.value : []).filter(
      (item) => {
        return !!item?.isDefaultExecutable && toSafeNumber(item?.isActive, 0) === 1
      }
    )
  })

  const preferredInjectableNexusMod = computed(() => {
    return activeInjectableNexusMods.value[0] || null
  })

  const preferredDefaultExecutableNexusMod = computed(() => {
    return activeDefaultExecutableNexusMods.value[0] || null
  })

  const currentRuleInjectDescriptor = computed(() => {
    return resolveCurrentRuleInjectDescriptorService(currentNexusRule.value, {
      gameRootPath: String(nexusBinding.value?.detectedRootPath || '').trim()
    })
  })

  const launchGameButtonText = computed(() => {
    return preferredInjectableNexusMod.value || currentRuleInjectDescriptor.value
      ? uiText('quickLaunch.inject')
      : uiText('modBrowser.launch')
  })

  const canLaunchGame = computed(() => {
    return detectStatus.value === 'identified'
  })

  const canOpenGameRoot = computed(() => {
    return (
      detectStatus.value === 'identified' &&
      !!String(nexusBinding.value?.detectedRootPath || '').trim()
    )
  })

  const canInstallByRule = computed(() => {
    return detectStatus.value === 'identified'
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
      loading: manualBindingLoading.value,
      disabled: detectStatus.value === 'scanning' || manualBindingLoading.value
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
      disabled: detectStatus.value === 'scanning' || !hasNexusRuleContent(currentNexusRule.value)
    },
    {
      key: 'manual-bind',
      get label() { return uiText('ui.addManually') },
      placement: 'more',
      visible: canManualBindGame.value,
      loading: manualBindingLoading.value
    },
    {
      key: 'rule-config',
      get label() { return uiText('ui.editInstallationRules') },
      placement: 'more'
    }
  ])

  function resolveCurrentNexusSteamAppId() {
    return toSafeNumber(
      nexusBinding.value?.appId ||
        currentNexusRule.value?.steamAppId ||
        route.query?.appId ||
        route.query?.steamAppId,
      0
    )
  }

  function resolveCurrentNexusBackendGameId() {
    return toSafeNumber(
      nexusBinding.value?.backendGameId ||
        currentNexusRule.value?.gameId ||
        route.query?.backendGameId ||
        route.query?.gameId,
      0
    )
  }

  function resolveCurrentNexusGameId() {
    return toSafeNumber(
      nexusBinding.value?.nexusGameId ||
        currentNexusRule.value?.nexusGameId ||
        route.query?.nexusGameId,
      0
    )
  }

  function resolveCurrentNexusDomainName() {
    return String(
      nexusBinding.value?.domainName || gameBaseInfo.value.domainName || route.params.id || ''
    )
      .trim()
      .toLowerCase()
  }

  const resolvedNexusAppId = computed(() => {
    return resolveCurrentNexusSteamAppId()
  })

  const installedSourceModKeySet = computed(() => {
    return new Set(
      (Array.isArray(installedNexusMods.value) ? installedNexusMods.value : [])
        .map((item) => String(item?.sourceModKey || '').trim())
        .filter(Boolean)
    )
  })

  const installedNexusModIdSet = computed(() => {
    return new Set(
      (Array.isArray(installedNexusMods.value) ? installedNexusMods.value : [])
        .map((item) => toSafeNumber(item?.modId || item?.raw?.mod_id, 0))
        .filter((item) => item > 0)
    )
  })

  const installedNexusModRecordMap = computed(() => {
    const map = new Map()
    const safeList = Array.isArray(installedNexusMods.value) ? installedNexusMods.value : []

    for (const item of safeList) {
      const modId = toSafeNumber(item?.modId || item?.raw?.mod_id, 0)
      if (modId <= 0) {
        continue
      }

      const existing = map.get(modId)
      if (!existing) {
        map.set(modId, item)
        continue
      }

      const currentScore = Number(item?.isActive ? 1000000 : 0) + toSafeNumber(item?.id, 0)
      const existingScore = Number(existing?.isActive ? 1000000 : 0) + toSafeNumber(existing?.id, 0)
      if (currentScore >= existingScore) {
        map.set(modId, item)
      }
    }

    return map
  })

  const installedNexusFileIdSetMap = computed(() => {
    const map = new Map()
    const safeList = Array.isArray(installedNexusMods.value) ? installedNexusMods.value : []

    for (const item of safeList) {
      const modId = toSafeNumber(item?.modId || item?.raw?.mod_id, 0)
      const fileId = resolveInstalledNexusRecordFileId(item)
      if (modId <= 0 || fileId <= 0) {
        continue
      }

      if (!map.has(modId)) {
        map.set(modId, new Set())
      }
      map.get(modId).add(fileId)
    }

    return map
  })

  const listNotice = computed(() => {
    if (hasNexusApiKey.value) {
      return { show: false }
    }
    return {
      show: true,
      get title() { return uiText('ui.noUsableNexusAPIKeyDetected') },
      get text() { return uiText('ui.addAnAPIKeyInSettingsOrWaitForThe') },
      actionText: '前往设置'
    }
  })

  function resolveNexusInstallStateKey(modId = 0) {
    const safeModId = toSafeNumber(modId, 0)
    return safeModId > 0 ? String(safeModId) : ''
  }

  function resolveNexusTargetModId(file = {}, results = []) {
    const directModId = toSafeNumber(file?.modId || file?.mod_id || file?.modID, 0)
    if (directModId > 0) {
      return directModId
    }

    const fallbackModId = toSafeNumber(
      nexusFileModal.value?.item?.modId || nexusFileModal.value?.item?.id,
      0
    )
    if (fallbackModId > 0) {
      return fallbackModId
    }

    for (const entry of Array.isArray(results) ? results : []) {
      const resultModId = toSafeNumber(entry?.meta?.installPayload?.modId, 0)
      if (resultModId > 0) {
        return resultModId
      }
    }

    return 0
  }

  function getNexusInstallState(modId = 0) {
    const stateKey = resolveNexusInstallStateKey(modId)
    if (!stateKey) {
      return null
    }
    return nexusInstallingMap.value[stateKey] || null
  }

  function setNexusInstallState(modId = 0, patch = {}) {
    const stateKey = resolveNexusInstallStateKey(modId)
    if (!stateKey) {
      return
    }

    const currentState = getNexusInstallState(modId) || {
      count: 0,
      text: ''
    }
    const nextState = {
      count: Math.max(0, toSafeNumber(patch?.count, currentState.count)),
      text: String(patch?.text ?? currentState.text ?? '').trim()
    }
    const nextMap = {
      ...nexusInstallingMap.value
    }

    if (nextState.count <= 0) {
      delete nextMap[stateKey]
    } else {
      nextMap[stateKey] = nextState
    }

    nexusInstallingMap.value = nextMap
  }

  function beginNexusInstallState(file = {}, text = '正在生成任务...') {
    const modId = resolveNexusTargetModId(file)
    if (modId <= 0) {
      return 0
    }

    const currentState = getNexusInstallState(modId) || {
      count: 0,
      text: ''
    }
    setNexusInstallState(modId, {
      count: currentState.count + 1,
      text
    })
    return modId
  }

  function updateNexusInstallStateText(modId = 0, text = '安装中...') {
    const currentState = getNexusInstallState(modId)
    if (!currentState) {
      return
    }

    setNexusInstallState(modId, {
      count: currentState.count,
      text
    })
  }

  function finishNexusInstallState(modId = 0) {
    const currentState = getNexusInstallState(modId)
    if (!currentState) {
      return
    }

    setNexusInstallState(modId, {
      count: currentState.count - 1
    })
  }

  const listItems = computed(() => {
    return pageMods.value.map((item) => {
      const modId = toSafeNumber(item?.modId, 0)
      const installState = getNexusInstallState(modId)
      const installedRecord = installedNexusModRecordMap.value.get(modId) || null
      const installedFileCount = installedNexusFileIdSetMap.value.get(modId)?.size || 0
      const installedVersion = normalizeVersionText(installedRecord?.version)
      const latestVersion = normalizeVersionText(item?.version)
      const isInstalled = !!installedRecord
      const isRunnable = !!installedRecord?.isRunnable
      const canSwitchVersion =
        isInstalled && !!installedVersion && !!latestVersion && installedVersion !== latestVersion
      const statusText = isInstalled && isRunnable ? uiText('ui.runnable') : ''
      const actionButtons = []

      if (isInstalled && isRunnable) {
        actionButtons.push({
          key: 'run-executable',
          get label() { return uiText('tools.run') },
          tone: 'accent'
        })
      }

      const translatedTitle = getTranslatedModTitle(modId, item?.name)
      const translatedDescription = getTranslatedModSummary(modId, item?.summary)
      const isTranslationResolved = isModCardTranslationResolved(item)

      return {
        id: item.id,
        cover: item.pictureUrl,
        title: item.name,
        translatedTitle,
        subtitle: item.author ? uiText('ui.authorValueVariant2', { value1: (item.author) }) : '',
        description: item.summary || uiText('ui.noDescription'),
        translatedDescription,        author: item.author ? `${item.author}` : '',
        tags: [...(isRunnable ? ['可运行'] : [])],
        detailText: '详情',
        actionButtons,
        installText: canInstallByRule.value
          ? isInstalled
            ? '安装其他文件'
            : '安装'
          : isInstalled
            ? '下载其他文件'
            : '下载',
        installing: !!installState,
        installingText: String(installState?.text || '安装中...').trim() || '安装中...',
        installable: true,
        installedText: isInstalled
          ? uiText('ui.installedValueValueValue', { value1: (installedVersion ? ` ${installedVersion}` : ''), value2: (installedFileCount > 0 ? ` · ${installedFileCount} 个文件` : ''), value3: (isRunnable ? ' / 可运行' : '') })
          : '',
        secondaryText: canSwitchVersion ? '切换版本' : '',
        secondaryActionKey: canSwitchVersion ? 'switch-version' : '',
        secondaryDisabled: !canInstallByRule.value,
        translateActionText: modItemTranslationLoadingMap.value[modId] ? '翻译中...' : '翻译',
        translateHidden: !canUseNexusAiTranslation.value || isTranslationResolved,
        translateDisabled: !!modItemTranslationLoadingMap.value[modId],
        statusText,
        downloadCount: item.modDownloads,
        installedRecord,
        raw: item
      }
    })
  })

  function setPageMenuNameAfterFirstInit() {
    if (hasInitializedPageMenuName.value) return
    const menuName = String(gameBaseInfo.value?.name || gameBaseInfo.value?.domainName || '').trim()
    if (!menuName) return
    setPageMenuName(() => `[Mod]-${gameDisplayName.value}`, route.path)
    hasInitializedPageMenuName.value = true
  }

  function normalizeSystemConfig(data) {
    const target = data && typeof data === 'object' ? data : {}
    const nexusApi = target.nexusApi && typeof target.nexusApi === 'object' ? target.nexusApi : {}
    return {
      ...target,
      nexusApi: normalizeNexusApiConfig(nexusApi),
      aiTranslation: normalizeAiTranslationConfig(target.aiTranslation)
    }
  }

  function getNexusApiConfig() {
    return normalizeNexusApiConfig(systemConfig.value?.nexusApi)
  }

  function requestSystemConfig() {
    return requestSystemConfigSettings({})
  }

  function toSafeNumber(value, defaultValue = 0) {
    const result = Number(value)
    return Number.isFinite(result) ? result : defaultValue
  }

  function toSafeText(value, fallback = '') {
    const text = String(value || '').trim()
    return text || fallback
  }

  function buildModTitleTranslationKey(modId = 0) {
    return `mod:${toSafeNumber(modId, 0)}:title`
  }

  function buildModSummaryTranslationKey(modId = 0) {
    return `mod:${toSafeNumber(modId, 0)}:summary`
  }

  function buildNexusFileTranslationKey(fileId = 0) {
    return `file:${toSafeNumber(fileId, 0)}:name`
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

  function isModTranslationKeyResolved(cacheKey = '') {
    return !!modTranslationResolvedMap.value[String(cacheKey || '').trim()]
  }

  function isNexusFileTranslationKeyResolved(cacheKey = '') {
    return !!nexusFileTranslationResolvedMap.value[String(cacheKey || '').trim()]
  }

  function getTranslatedModTitle(modId = 0, original = '') {
    if (!canUseNexusAiTranslation.value) {
      return ''
    }
    const translated = toSafeText(modTranslationMap.value[buildModTitleTranslationKey(modId)])
    return translated && translated !== toSafeText(original) ? translated : ''
  }

  function getTranslatedModSummary(modId = 0, original = '') {
    if (!canUseNexusAiTranslation.value) {
      return ''
    }
    const translated = toSafeText(modTranslationMap.value[buildModSummaryTranslationKey(modId)])
    return translated && translated !== toSafeText(original) ? translated : ''
  }

  function buildModTranslationRequestItems(list = pageMods.value, options = {}) {
    const safeList = Array.isArray(list) ? list : []
    const unresolvedOnly = !!options?.unresolvedOnly
    const requestItems = []

    for (const item of safeList) {
      const modId = toSafeNumber(item?.modId || item?.id, 0)
      const modName = toSafeText(item?.name)
      const summary = toSafeText(item?.summary)

      if (modId <= 0) {
        continue
      }

      if (modName) {
        const titleKey = buildModTitleTranslationKey(modId)
        if (unresolvedOnly && isModTranslationKeyResolved(titleKey)) {
          continue
        }

        requestItems.push({
          id: titleKey,
          text: modName,
          kind: 'mod_name',
          context: uiText('ui.gameValueVariant3', { value1: (gameDisplayName.value) })
        })
      }

      if (summary) {
        const summaryKey = buildModSummaryTranslationKey(modId)
        if (unresolvedOnly && isModTranslationKeyResolved(summaryKey)) {
          continue
        }

        requestItems.push({
          id: summaryKey,
          text: summary,
          kind: 'mod_summary',
          context: uiText('ui.gameValueModValue', { value1: (gameDisplayName.value), value2: (modName || modId) })
        })
      }
    }

    return requestItems
  }

  function isModCardTranslationResolved(item = {}) {
    const modId = toSafeNumber(item?.modId || item?.id, 0)
    if (modId <= 0) {
      return true
    }

    const requiredKeys = []
    if (toSafeText(item?.name)) {
      requiredKeys.push(buildModTitleTranslationKey(modId))
    }
    if (toSafeText(item?.summary)) {
      requiredKeys.push(buildModSummaryTranslationKey(modId))
    }

    return requiredKeys.length <= 0 || requiredKeys.every((key) => isModTranslationKeyResolved(key))
  }

  async function hydrateVisibleNexusModTranslations(list = pageMods.value) {
    const safeList = Array.isArray(list) ? list : []
    modTranslationToken += 1
    const currentToken = modTranslationToken

    if (!canUseNexusAiTranslation.value || !safeList.length) {
      return
    }

    const requestItems = buildModTranslationRequestItems(safeList)
    if (!requestItems.length) {
      return
    }

    try {
      const translatedMap = await queryCachedTextBatchService({
        systemConfig: systemConfig.value,
        source: 'nexus',
        scene: 'mod_list_card',
        items: requestItems
      })

      if (currentToken !== modTranslationToken || !translatedMap.size) {
        return
      }

      mergeTranslationResultMap(translatedMap, modTranslationMap, modTranslationResolvedMap)
    } catch (error) {
      console.warn('[NEXUS] 当前页模组缓存读取失败', error)
    }
  }

  async function translateVisibleNexusMods(list = pageMods.value, options = {}) {
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
    const edgeOnly = options?.edgeOnly === true
    const shouldApplyResult =
      typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
    const requestItems = buildModTranslationRequestItems(list, {
      unresolvedOnly: true
    })

    if ((!edgeOnly && !canUseNexusAiTranslation.value) || !requestItems.length) {
      return 0
    }

    const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
    const translatedMap = await translateService({
      systemConfig: systemConfig.value,
      source: 'nexus',
      scene: 'mod_list_card',
      items: requestItems,
      onChunkSettled: onProgress
        ? ({ chunkResultMap }) => {
            if (!shouldApplyResult()) {
              return
            }
            mergeTranslationResultMap(chunkResultMap, modTranslationMap, modTranslationResolvedMap)
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

    return mergeTranslationResultMap(translatedMap, modTranslationMap, modTranslationResolvedMap)
  }

  function buildNexusAutoTranslationSignature(list = pageMods.value) {
    return [
      'nexus',
      query.value.page,
      query.value.effectiveKeyword || query.value.keyword,
      listType.value,
      (Array.isArray(list) ? list : []).map((item) => item?.modId || item?.id || '').join(','),
      aiTranslationConfig.value.targetLanguage
    ].join('|')
  }

  async function autoTranslateVisibleNexusMods(list = pageMods.value) {
    const signature = buildNexusAutoTranslationSignature(list)
    if (
      !signature ||
      nexusAutoTranslationCompletedSignature.value === signature ||
      nexusAutoTranslationInFlightSignature.value === signature
    ) {
      return
    }

    const requestItems = buildModTranslationRequestItems(list, {
      unresolvedOnly: true
    })
    if (!requestItems.length) {
      nexusAutoTranslationCompletedSignature.value = signature
      return
    }

    nexusAutoTranslationInFlightSignature.value = signature
    try {
      const translatedCount = await translateVisibleNexusMods(list, {
        edgeOnly: true,
        shouldApplyResult: () => nexusAutoTranslationInFlightSignature.value === signature
      })
      if (translatedCount > 0 && nexusAutoTranslationInFlightSignature.value === signature) {
        nexusAutoTranslationCompletedSignature.value = signature
      }
    } catch (error) {
      console.warn('[NEXUS] 当前页模组自动翻译失败', error)
    } finally {
      if (nexusAutoTranslationInFlightSignature.value === signature) {
        nexusAutoTranslationInFlightSignature.value = ''
      }
    }
  }

  function resetModPageTranslationProgress() {
    modPageTranslationProgress.value = {
      current: 0,
      total: 0
    }
  }

  function updateModPageTranslationProgress(total = 0) {
    modPageTranslationProgress.value = {
      current: Math.max(total - countUntranslatedNexusMods(pageMods.value), 0),
      total: Math.max(Number(total || 0), 0)
    }
  }

  function buildNexusFileTranslationRequestItems(list = [], mod = {}, options = {}) {
    const safeList = Array.isArray(list) ? list : []
    const unresolvedOnly = !!options?.unresolvedOnly
    const modName = toSafeText(mod?.name || mod?.title)
    return safeList
      .flatMap((item) => {
        const fileId = toSafeNumber(item?.fileId || item?.id, 0)
        const fileName = toSafeText(item?.name)
        const cacheKey = buildNexusFileTranslationKey(fileId)
        if (fileId <= 0) return []
        const context = uiText('ui.gameValueModValue', { value1: (gameDisplayName.value), value2: (modName || '--') })
        const descriptionItems = createDescriptionTranslationPlan({
          id: cacheKey.replace(/:name$/, ':description'),
          text: item?.description,
          format: 'html',
          kind: 'file_description',
          context
        }).items
        const nameItems = fileName ? [{ id: cacheKey, text: fileName, kind: 'file_name', context }] : []
        return [...nameItems, ...descriptionItems].filter(
          (entry) => !unresolvedOnly || !isNexusFileTranslationKeyResolved(entry.id)
        )
      })
      .filter(Boolean)
  }

  async function hydrateNexusFileTranslations(list = [], mod = {}) {
    const safeList = Array.isArray(list) ? list : []
    nexusFileTranslationToken += 1
    const currentToken = nexusFileTranslationToken

    if (!canUseNexusAiTranslation.value || !safeList.length) {
      return
    }

    const requestItems = buildNexusFileTranslationRequestItems(safeList, mod)
    if (!requestItems.length) {
      return
    }

    try {
      const translatedMap = await queryCachedTextBatchService({
        systemConfig: systemConfig.value,
        source: 'nexus',
        scene: 'file_list',
        items: requestItems
      })

      if (currentToken !== nexusFileTranslationToken || !translatedMap.size) {
        return
      }

      mergeTranslationResultMap(
        translatedMap,
        nexusFileTranslationMap,
        nexusFileTranslationResolvedMap
      )
    } catch (error) {
      console.warn('[NEXUS] 文件列表缓存读取失败', error)
    }
  }

  async function translateNexusFileList(list = [], mod = {}, options = {}) {
    const currentToken = nexusFileTranslationToken
    const edgeOnly = options?.edgeOnly === true
    const shouldApplyResult =
      typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
    const requestItems = buildNexusFileTranslationRequestItems(list, mod, {
      unresolvedOnly: true
    })

    if ((!edgeOnly && !canUseNexusAiTranslation.value) || !requestItems.length) {
      return 0
    }

    const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
    const translatedMap = await translateService({
      systemConfig: systemConfig.value,
      source: 'nexus',
      scene: 'file_list',
      items: requestItems
    })

    if (currentToken !== nexusFileTranslationToken || !shouldApplyResult()) {
      return 0
    }

    return mergeTranslationResultMap(
      translatedMap,
      nexusFileTranslationMap,
      nexusFileTranslationResolvedMap
    )
  }

  function buildNexusFileAutoTranslationSignature(list = [], mod = {}) {
    return [
      'nexus-file',
      toSafeNumber(mod?.modId || mod?.id, 0),
      (Array.isArray(list) ? list : []).map((item) => `${item?.fileId || item?.id}:${item?.name || ''}:${item?.description || ''}`).join('|'),
      aiTranslationConfig.value.targetLanguage
    ].join('|')
  }

  async function autoTranslateNexusFileList(list = [], mod = {}) {
    const signature = buildNexusFileAutoTranslationSignature(list, mod)
    if (
      !signature ||
      nexusFileAutoTranslationCompletedSignature.value === signature ||
      nexusFileAutoTranslationInFlightSignature.value === signature
    ) {
      return
    }

    const requestItems = buildNexusFileTranslationRequestItems(list, mod, {
      unresolvedOnly: true
    })
    if (!requestItems.length) {
      nexusFileAutoTranslationCompletedSignature.value = signature
      return
    }

    nexusFileAutoTranslationInFlightSignature.value = signature
    const currentToken = nexusFileTranslationToken
    nexusFileTranslationLoading.value = true
    try {
      const translatedCount = await translateNexusFileList(list, mod, {
        edgeOnly: true,
        shouldApplyResult: () => nexusFileAutoTranslationInFlightSignature.value === signature
      })
      if (translatedCount > 0 && nexusFileAutoTranslationInFlightSignature.value === signature &&
          !buildNexusFileTranslationRequestItems(list, mod, { unresolvedOnly: true }).length) {
        nexusFileAutoTranslationCompletedSignature.value = signature
      }
    } catch (error) {
      console.warn('[NEXUS] 文件列表自动翻译失败', error)
    } finally {
      if (currentToken === nexusFileTranslationToken && nexusFileAutoTranslationInFlightSignature.value === signature) {
        nexusFileAutoTranslationInFlightSignature.value = ''
      }
      if (currentToken === nexusFileTranslationToken) nexusFileTranslationLoading.value = false
    }
  }

  function buildNexusGameTileCoverUrl(nexusGameId = 0) {
    const safeNexusGameId = toSafeNumber(nexusGameId, 0)
    if (safeNexusGameId <= 0) {
      return ''
    }
    return `https://images.nexusmods.com/images/games/v2/${safeNexusGameId}/tile.jpg`
  }

  function resolveNexusGameCoverImage(candidateList = [], nexusGameId = 0) {
    const safeCandidateList = Array.isArray(candidateList) ? candidateList : []
    for (const candidate of safeCandidateList) {
      const coverImage = String(candidate || '').trim()
      if (coverImage) {
        return coverImage
      }
    }
    return buildNexusGameTileCoverUrl(nexusGameId)
  }

  function normalizeNexusGameHeaderCompareText(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
  }

  function shouldReplaceNexusGameHeaderName(currentName = '', domainName = '') {
    const currentText = normalizeNexusGameHeaderCompareText(currentName)
    const domainText = normalizeNexusGameHeaderCompareText(domainName)
    return !currentText || (!!domainText && currentText === domainText)
  }

  async function resolveNexusGameHeaderDisplayName(rawName = '', domainName = '') {
    const safeRawName = toSafeText(rawName, domainName)
    if (!safeRawName) {
      return ''
    }

    try {
      const resolved = await resolveGameNameFromDict({
        sourcePlatform: 'nexus',
        rawName: safeRawName,
        fallbackName: safeRawName
      })
      return toSafeText(resolved?.displayName, safeRawName)
    } catch (error) {
      console.warn('[NEXUS] 游戏名称补查翻译失败', error)
      return safeRawName
    }
  }

  async function hydrateNexusGameBaseInfoFromApi(apiGame = {}, totalCount = 0) {
    const game = apiGame && typeof apiGame === 'object' ? apiGame : {}
    const currentDomainName = resolveCurrentNexusDomainName()
    const apiDomainName = toSafeText(
      game?.domainName || game?.domain_name || currentDomainName
    ).toLowerCase()

    if (!currentDomainName || apiDomainName !== currentDomainName) {
      return
    }

    const currentBaseInfo = gameBaseInfo.value || {}
    const currentName = toSafeText(currentBaseInfo?.name)
    const rawName = toSafeText(game?.name, currentDomainName)
    const displayName = await resolveNexusGameHeaderDisplayName(rawName, currentDomainName)
    const nexusGameId = toSafeNumber(game?.id || game?.nexusGameId || game?.nexus_game_id, 0)
    const coverImage = resolveNexusGameCoverImage(
      [toSafeText(currentBaseInfo?.coverImage)],
      nexusGameId
    )

    gameBaseInfo.value = {
      ...currentBaseInfo,
      domainName: currentDomainName,
      englishTitle: rawName || currentBaseInfo.englishTitle,
      name: shouldReplaceNexusGameHeaderName(currentName, currentDomainName)
        ? displayName || currentName || currentDomainName
        : currentName,
      coverImage,
      modCount: toSafeNumber(totalCount, toSafeNumber(currentBaseInfo?.modCount, 0))
    }
  }

  function normalizeVersionText(value) {
    const text = String(value || '').trim()
    if (!text || text === '--') {
      return ''
    }
    return text
  }

  function resolveNexusInstallConfigProfileStorageKey(context = {}) {
    const source = context && typeof context === 'object' ? context : {}
    const sourcePlatform =
      String(
        source?.sourcePlatform || nexusConfigGameContext.value?.sourcePlatform || 'nexus'
      ).trim() || 'nexus'
    const gameKey =
      String(source?.gameKey || nexusConfigGameContext.value?.gameKey || '').trim() ||
      String(source?.domainName || '')
        .trim()
        .toLowerCase() ||
      resolveCurrentNexusDomainName() ||
      (toSafeNumber(source?.nexusGameId || resolveCurrentNexusGameId(), 0) > 0
        ? `nexusGameId:${toSafeNumber(source?.nexusGameId || resolveCurrentNexusGameId(), 0)}`
        : '') ||
      (toSafeNumber(source?.gameId || resolveCurrentNexusBackendGameId(), 0) > 0
        ? `gameId:${toSafeNumber(source?.gameId || resolveCurrentNexusBackendGameId(), 0)}`
        : '')

    if (!gameKey) {
      return ''
    }

    return `${ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX}:${sourcePlatform}:${gameKey}`
  }

  function resolveLegacyNexusInstallConfigProfileStorageKey(context = {}) {
    const storageKey = resolveNexusInstallConfigProfileStorageKey(context)
    return storageKey
      ? storageKey.replace(
          ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX,
          LEGACY_NEXUS_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX
        )
      : ''
  }

  function normalizeInstallConfigProfileSnapshot(snapshot = null) {
    if (!snapshot || typeof snapshot !== 'object') {
      return null
    }

    const configName = String(snapshot?.configName || '').trim()
    const configScope = String(snapshot?.configScope || '').trim()
    const sourceType = String(snapshot?.sourceType || '').trim()
    if (!configName && !configScope && !sourceType) {
      return null
    }

    return {
      id: Number(snapshot?.id || 0) || null,
      profileKey: String(snapshot?.profileKey || '').trim(),
      configName,
      configScope,
      ownerDisplayName: String(snapshot?.ownerDisplayName || '').trim(),
      ruleVersion: toSafeNumber(snapshot?.ruleVersion, 0),
      sourceType
    }
  }

  function loadStoredInstallConfigProfileSnapshot(context = {}) {
    const storageKey = resolveNexusInstallConfigProfileStorageKey(context)
    if (!storageKey) {
      return null
    }
    return (
      normalizeInstallConfigProfileSnapshot(storage.local.get(storageKey)) ||
      normalizeInstallConfigProfileSnapshot(
        storage.local.get(resolveLegacyNexusInstallConfigProfileStorageKey(context))
      )
    )
  }

  function persistInstallConfigProfileSnapshot(snapshot = null, context = {}) {
    const storageKey = resolveNexusInstallConfigProfileStorageKey(context)
    if (!storageKey) {
      activeInstallConfigProfileSnapshot.value = normalizeInstallConfigProfileSnapshot(snapshot)
      return activeInstallConfigProfileSnapshot.value
    }

    const normalizedSnapshot = normalizeInstallConfigProfileSnapshot(snapshot)
    activeInstallConfigProfileSnapshot.value = normalizedSnapshot
    if (normalizedSnapshot) {
      storage.local.set(storageKey, normalizedSnapshot)
    } else {
      storage.local.remove(storageKey)
    }
    return normalizedSnapshot
  }

  function buildInstallConfigProfileSnapshot(snapshot = {}) {
    return normalizeInstallConfigProfileSnapshot(snapshot)
  }

  function buildCloudOfficialProfileSnapshot(cloudRule = cloudNexusRule.value) {
    if (!hasNexusRuleContent(cloudRule)) {
      return null
    }

    const gameKey =
      String(
        nexusConfigGameContext.value?.gameKey || resolveCurrentNexusDomainName() || ''
      ).trim() ||
      `nexus:${resolveCurrentNexusGameId() || resolveCurrentNexusBackendGameId() || 'unknown'}`

    return buildInstallConfigProfileSnapshot({
      id: null,
      profileKey: `legacy:official:${gameKey}`,
      configName: `${gameDisplayName.value} 官方配置`,
      configScope: 'official',
      ownerDisplayName: 'Vertex 官方',
      ruleVersion: toSafeNumber(cloudRule?.ruleVersion, 0),
      sourceType: 'cloud_rule'
    })
  }

  function stringifyNexusRuleJson(ruleJson = {}, defaultValue = '') {
    if (ruleJson && typeof ruleJson === 'object' && !Array.isArray(ruleJson)) {
      try {
        return JSON.stringify(ruleJson)
      } catch {
        return defaultValue
      }
    }

    const text = String(ruleJson ?? '').trim()
    if (!text) {
      return defaultValue
    }

    try {
      return JSON.stringify(JSON.parse(text))
    } catch {
      return text
    }
  }

  function buildNexusRuleJsonIpcPayload(rule = null) {
    const rawRuleJson =
      rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
        ? toRaw(rule.ruleJson)
        : rule?.ruleJson

    return stringifyNexusRuleJson(rawRuleJson, '{}')
  }

  function resolveNexusRuleCandidateList(rule = null) {
    const ruleJson =
      rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
        ? rule.ruleJson
        : {}
    const gameDetect =
      ruleJson?.game_detect && typeof ruleJson.game_detect === 'object'
        ? ruleJson.game_detect
        : ruleJson?.gameDetect && typeof ruleJson.gameDetect === 'object'
          ? ruleJson.gameDetect
          : {}

    if (Array.isArray(gameDetect.candidates)) {
      return gameDetect.candidates
    }
    if (Array.isArray(gameDetect.candidate_list)) {
      return gameDetect.candidate_list
    }
    if (Array.isArray(gameDetect.candidateList)) {
      return gameDetect.candidateList
    }
    return []
  }

  function hasNexusRuleContent(rule = null) {
    const ruleJson =
      rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
        ? rule.ruleJson
        : null
    return !!ruleJson && Object.keys(ruleJson).length > 0
  }

  function applyEffectiveNexusRule() {
    currentNexusRule.value = localNexusRuleOverride.value || cloudNexusRule.value || null
  }

  function buildNexusRuleSignature(ruleVersion = 0, ruleJson = '') {
    const text = stringifyNexusRuleJson(ruleJson)
    if (!text) {
      return ''
    }
    return `${toSafeNumber(ruleVersion, 0)}::${text}`
  }

  function resolveCurrentCloudRuleSignature() {
    return buildNexusRuleSignature(
      cloudNexusRule.value?.ruleVersion,
      cloudNexusRule.value?.ruleJson
    )
  }

  function resolveLocalBaseRuleSignature() {
    return buildNexusRuleSignature(
      localNexusRuleOverride.value?.baseRuleVersion,
      localNexusRuleOverride.value?.baseRuleJson
    )
  }

  function resolveLocalDismissedRuleSignature() {
    return buildNexusRuleSignature(
      localNexusRuleOverride.value?.dismissedRuleVersion,
      localNexusRuleOverride.value?.dismissedRuleJson
    )
  }

  function shouldPromptNexusRuleCloudUpdate() {
    if (!localNexusRuleOverride.value || !hasCloudNexusRule.value) {
      return false
    }

    const cloudSignature = resolveCurrentCloudRuleSignature()
    if (!cloudSignature) {
      return false
    }

    const baseSignature = resolveLocalBaseRuleSignature()
    const dismissedSignature = resolveLocalDismissedRuleSignature()

    if (baseSignature && baseSignature === cloudSignature) {
      return false
    }

    if (dismissedSignature && dismissedSignature === cloudSignature) {
      return false
    }

    return true
  }

  function buildNexusRuleCloudUpdatePromptContent() {
    const cloudRuleVersion = toSafeNumber(cloudNexusRule.value?.ruleVersion, 0)
    const cloudVersionText = cloudRuleVersion > 0 ? uiText('ui.versionValue', { value1: (cloudRuleVersion) }) : '最新内容'

    if (!resolveLocalBaseRuleSignature()) {
      return uiText('ui.cloudRulesAreNowAvailableValueYourLocalConfigurationWill', { value1: (cloudVersionText) })
    }

    return uiText('ui.cloudRulesWereUpdatedToValueButYouAreStill', { value1: (cloudVersionText) })
  }

  async function loadLocalNexusRuleOverride() {
    const domainName = resolveCurrentNexusDomainName()
    const nexusGameId = resolveCurrentNexusGameId()
    if (!domainName && !nexusGameId) {
      return null
    }

    try {
      const localRule = await invokeIpc('nexusGetGameRuleOverride', {
        domainName,
        nexusGameId
      })
      return localRule ? normalizeNexusGameRulePayload(localRule) : null
    } catch (error) {
      console.error('[NEXUS] 读取本地规则配置失败', error)
      return null
    }
  }

  function buildNexusInstallConfigMatchParams() {
    const nexusGameId = resolveCurrentNexusGameId()
    return {
      sourcePlatform: 'nexus',
      gameKey: route.query?.gameKey ||  nexusGameId > 0 ? `nexus:${nexusGameId}` : '',
      gameId: resolveCurrentNexusBackendGameId() || null,
      nexusGameId: nexusGameId || null,
      domainName: resolveCurrentNexusDomainName(),
      appId: resolvedNexusAppId.value || null
    }
  }

  function hasNexusInstallConfigMatchIdentifier(params = {}) {
    return !!(
      String(params?.gameKey || '').trim() ||
      String(params?.domainName || '').trim() ||
      toSafeNumber(params?.nexusGameId, 0) > 0 ||
      toSafeNumber(params?.gameId, 0) > 0 ||
      toSafeNumber(params?.appId, 0) > 0
    )
  }

  async function loadMatchedNexusInstallConfigRule() {
    ruleLoadFailure.value = null
    const params = buildNexusInstallConfigMatchParams()
    if (!hasNexusInstallConfigMatchIdentifier(params)) {
      ruleLoadFailure.value = describeSharedRuleFailure(sharedRuleError('IDENTITY_MISSING', '当前页面缺少来源游戏标识'))
      return null
    }

    try {
      const response = await GET_SHARED_INSTALL_RULE(params)
      const ruleJsonText = String(response?.ruleJsonText || '').trim()
      if (!ruleJsonText) {
        throw sharedRuleError('INVALID_RESPONSE', '公共规则响应缺少正文')
      }

      const normalizedRule = normalizeNexusGameRulePayload({
        ...response,
        ruleJsonText,
        minVersion: response?.minClientVersion,
        sourceType: 'server'
      })

      if (!hasNexusRuleContent(normalizedRule)) {
        throw sharedRuleError('INVALID_RESPONSE', '公共文档没有可用的安装规则')
      }



      return normalizedRule
    } catch (error) {
      ruleLoadFailure.value = describeSharedRuleFailure(error)
      console.warn('[NEXUS] 统一安装配置匹配失败，公共规则当前不可用', error)
      return null
    }
  }

  async function loadCloudNexusRuleFromServer() { return loadMatchedNexusInstallConfigRule() }

  async function saveLocalNexusRuleOverride(payload = {}) {
    const domainName = resolveCurrentNexusDomainName()
    if (!domainName) {
      throw new Error(uiText('ui.gameDomainMissingCannotSaveConfiguration'))
    }

    const result = await invokeIpc('nexusUpsertGameRuleOverride', {
      domainName,
      nexusGameId: resolveCurrentNexusGameId(),
      gameId: resolveCurrentNexusBackendGameId(),
      appId: resolvedNexusAppId.value,
      sourceType: 'local_override',
      ...payload
    })

    if (!result?.success || !result?.override) {
      throw new Error(String(result?.reason || uiText('ui.saveFailed')))
    }

    localNexusRuleOverride.value = normalizeNexusGameRulePayload(result.override)
    applyEffectiveNexusRule()
    return localNexusRuleOverride.value
  }

  async function acknowledgeNexusRuleCloudUpdate() {
    const domainName = resolveCurrentNexusDomainName()
    if (!domainName || !hasCloudNexusRule.value) {
      return
    }

    const result = await invokeIpc('nexusAcknowledgeGameRuleOverrideUpdate', {
      domainName,
      nexusGameId: resolveCurrentNexusGameId(),
      dismissedRuleVersion: toSafeNumber(cloudNexusRule.value?.ruleVersion, 0),
      dismissedRuleJson: cloudNexusRule.value?.ruleJson || {}
    })

    if (result?.success && result?.override) {
      localNexusRuleOverride.value = normalizeNexusGameRulePayload(result.override)
      applyEffectiveNexusRule()
    }
  }

  async function handleUseLatestCloudRule() {
    if (!hasCloudNexusRule.value) {
      return
    }

    const cloudRule = cloudNexusRule.value
    await saveLocalNexusRuleOverride({
      ruleVersion: toSafeNumber(cloudRule?.ruleVersion, 0),
      ruleJson: cloudRule?.ruleJson || {},
      baseRuleVersion: toSafeNumber(cloudRule?.ruleVersion, 0),
      baseRuleJson: cloudRule?.ruleJson || {},
      dismissedRuleVersion: toSafeNumber(cloudRule?.ruleVersion, 0),
      dismissedRuleJson: cloudRule?.ruleJson || {}
    })

    persistInstallConfigProfileSnapshot(
      buildCloudOfficialProfileSnapshot(cloudRule),
      nexusConfigGameContext.value
    )
    lastResolvedBindingSignature.value = ''
    await ensureNexusGameBinding({
      forceDetect: detectStatus.value === 'unidentified' || detectStatus.value === 'no_rule'
    })
    $message.success(uiMessage('ui.updatedToTheLatestCloudConfiguration'))
  }

  async function promptNexusRuleCloudUpdateIfNeeded() {
    if (nexusRuleCloudUpdatePrompting.value || !shouldPromptNexusRuleCloudUpdate()) {
      return
    }

    nexusRuleCloudUpdatePrompting.value = true
    try {
      const shouldUpdate = await new Promise((resolve) => {
        Modal.confirm({
          get title() { return uiText('ui.cloudRuleUpdateDetected') },
          content: buildNexusRuleCloudUpdatePromptContent(),
          get cancelText() { return uiText('ui.notNowVariant3') },
          get okText() { return uiText('ui.useCloudUpdate') },
          centered: true,
          onOk() {
            resolve(true)
          },
          onCancel() {
            resolve(false)
          }
        })
      })

      if (shouldUpdate) {
        await handleUseLatestCloudRule()
        return
      }

      await acknowledgeNexusRuleCloudUpdate()
    } catch (error) {
      console.error('[NEXUS] 处理云端规则更新提示失败', error)
    } finally {
      nexusRuleCloudUpdatePrompting.value = false
    }
  }

  function openNexusRuleConfigDialog() {
    router.push({
      name: 'GameSourceInstallConfig',
      params: {
        sourcePlatform: 'nexus',
        id: encodeURIComponent(resolveCurrentNexusDomainName() || resolveRouteDomainName())
      },
      query: {
        sourcePlatform: 'nexus',
        name: gameDisplayName.value,
        cover: String(gameBaseInfo.value?.coverImage || '').trim(),
        nexusGameId: resolveCurrentNexusGameId() || '',
        backendGameId: resolveCurrentNexusBackendGameId() || '',
        appId: resolvedNexusAppId.value || ''
      }
    })
  }

  async function handleManualBindGame() {
    if (manualBindingLoading.value) {
      return
    }

    const effectiveRule = currentNexusRule.value
    if (!effectiveRule || !hasNexusRuleContent(effectiveRule)) {
      $message.warning(uiMessage('ui.noRulesAreAvailableForManuallyBindingAGameFolder'))
      return
    }

    const candidateList = resolveNexusRuleCandidateList(effectiveRule)
    if (!candidateList.length) {
      $message.warning(uiMessage('ui.theCurrentRulesHaveNoGameDetectCandidatesForManual'))
      return
    }

    manualBindingLoading.value = true
    try {
      const detectResult = await invokeIpc('nexusSelectAndDetectGameRootByRule', {
        nexusGameId: effectiveRule.nexusGameId,
        domainName: effectiveRule.domainName,
        ruleJson: buildNexusRuleJsonIpcPayload(effectiveRule),
        title: uiText('ui.chooseAGameFolderForValue', { value1: (gameDisplayName.value) }),
        defaultPath: String(
          nexusBinding.value?.detectedRootPath || nexusBinding.value?.rootPath || ''
        ).trim()
      })

      if (detectResult?.canceled) {
        return
      }

      if (!detectResult?.success) {
        const failedPath = String(detectResult?.selectedDirectory || '').trim()
        const reasonText = failedPath
          ? uiText('ui.theSelectedFolderValueDidNotPassTheCurrentJSON', { value1: (failedPath) })
          : '所选目录未通过当前 JSON 规则校验，请确认目录层级或调整规则。'
        $message.warning(reasonText)
        return
      }

      const upsertResult = await invokeIpc('nexusUpsertGameBinding', {
        nexusGameId: effectiveRule.nexusGameId,
        backendGameId: effectiveRule.gameId,
        appId: effectiveRule.steamAppId || toSafeNumber(detectResult.appId, 0),
        domainName: effectiveRule.domainName,
        gameName: effectiveRule.gameName,
        coverImage: effectiveRule.coverImage,
        ruleVersion: effectiveRule.ruleVersion,
        detectedRootPath: String(detectResult.rootPath || '').trim(),
        detectedExePath: String(detectResult.exePath || '').trim()
      })

      if (!upsertResult?.success || !upsertResult?.binding?.isAvailable) {
        nexusBinding.value = null
        detectStatus.value = 'unidentified'
        throw new Error(upsertResult?.success
          ? uiText('ui.theGameFolderOrExecutableIsNoLongerAvailableSelect')
          : String(upsertResult?.reason || uiText('ui.couldNotSaveGameBinding')))
      }

      nexusBinding.value = upsertResult.binding
      detectStatus.value = 'identified'
      lastResolvedBindingSignature.value = buildCurrentPageSignature()
      await refreshInstalledNexusMods()
      $message.success(uiMessage('ui.gameFolderBoundUsingTheCurrentJSONRules'))
    } catch (error) {
      console.error('[NEXUS] 手动绑定游戏目录失败', error)
      $message.error(uiMessage('ui.manualBindingFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      manualBindingLoading.value = false
    }
  }

  function resolveRouteDomainName() {
    const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
    const domainName = String(raw || '').trim()
    if (!domainName) return ''
    try {
      return decodeURIComponent(domainName)
    } catch {
      return domainName
    }
  }

  function applyRouteBaseInfo() {
    const domainName = resolveRouteDomainName()
    const currentBaseInfo = gameBaseInfo.value || {}
    const isSwitchingGame =
      !!domainName && domainName !== String(currentBaseInfo?.domainName || '').trim()
    const routeName = String(route.query?.name || '').trim()
    const routeCover = String(route.query?.cover || '').trim()
    const routeModCount = toSafeNumber(route.query?.mods, 0)
    const routeNexusGameId = toSafeNumber(route.query?.nexusGameId, 0)

    const fallbackBaseInfo = isSwitchingGame
      ? { domainName: '', name: '', coverImage: '', modCount: 0 }
      : currentBaseInfo

    gameBaseInfo.value = {
      domainName: domainName || String(fallbackBaseInfo?.domainName || '').trim(),
      englishTitle: String(route.query?.englishTitle || fallbackBaseInfo?.englishTitle || '').trim(),
      name:
        routeName ||
        domainName ||
        String(fallbackBaseInfo?.name || '').trim() ||
        String(fallbackBaseInfo?.domainName || '').trim(),
      coverImage: resolveNexusGameCoverImage(
        [routeCover, String(fallbackBaseInfo?.coverImage || '').trim()],
        routeNexusGameId
      ),
      modCount: routeModCount > 0 ? routeModCount : toSafeNumber(fallbackBaseInfo?.modCount, 0)
    }

    if (isSwitchingGame || !activeInstallConfigProfileSnapshot.value) {
      activeInstallConfigProfileSnapshot.value = loadStoredInstallConfigProfileSnapshot({
        sourcePlatform: 'nexus',
        gameKey: domainName ? `nexus:${domainName}` : '',
        domainName,
        nexusGameId: routeNexusGameId
      })
    }
  }

  function buildCurrentPageSignature() {
    return JSON.stringify({
      routeId: String(resolveRouteDomainName() || '').trim(),
      nexusGameId: toSafeNumber(route.query?.nexusGameId, 0),
      backendGameId: toSafeNumber(route.query?.backendGameId || route.query?.gameId, 0),
      appId: toSafeNumber(route.query?.appId || route.query?.steamAppId, 0),
      name: String(route.query?.name || '').trim(),
      cover: String(route.query?.cover || '').trim()
    })
  }

  function shouldReuseResolvedNexusBinding(signature = '') {
    if (!signature || signature !== lastResolvedBindingSignature.value) {
      return false
    }

    if (detectStatus.value === 'idle' || detectStatus.value === 'scanning') {
      return false
    }

    if (detectStatus.value === 'identified') {
      return !!currentNexusRule.value && !!nexusBinding.value
    }

    return false
  }

  function normalizeNexusGameRulePayload(rawPayload = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}
    const nestedRule =
      (source.rule && typeof source.rule === 'object' && !Array.isArray(source.rule)
        ? source.rule
        : null) ||
      (source.latest && typeof source.latest === 'object' && !Array.isArray(source.latest)
        ? source.latest
        : null) ||
      (source.data && typeof source.data === 'object' && !Array.isArray(source.data)
        ? source.data
        : null)
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
      target.content ??
      source.content ??
      target.config ??
      source.config ??
      (target.game_detect || target.gameDetect || target.install_rules || target.installRules
        ? target
        : {})

    let ruleJson = {}
    if (rawRuleJson && typeof rawRuleJson === 'object' && !Array.isArray(rawRuleJson)) {
      ruleJson = compileNexusRuleJson(rawRuleJson)
    } else {
      ruleJson = compileNexusRuleJson(parseNexusRuleJsonText(rawRuleJson))
    }

    if (!Object.keys(ruleJson).length && (target.game_detect || target.gameDetect)) {
      ruleJson = compileNexusRuleJson(target)
    }

    const resolvedNexusGameId = toSafeNumber(
      target.nexusGameId ||
        target.nexus_game_id ||
        source.nexusGameId ||
        source.nexus_game_id ||
        route.query?.nexusGameId,
      0
    )

    return {
      ...target,
      nexusGameId: resolvedNexusGameId,
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
          source.steam_appid ||
          route.query?.appId ||
          route.query?.steamAppId,
        0
      ),
      ruleVersion: toSafeNumber(
        target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version,
        0
      ),
      gameName: String(
        target.gameName ||
          target.game_name ||
          target.name ||
          target.title ||
          source.gameName ||
          source.game_name ||
          source.name ||
          source.title ||
          gameBaseInfo.value.name ||
          ''
      ).trim(),
      coverImage: resolveNexusGameCoverImage(
        [
          gameBaseInfo.value.coverImage,
          target.pictureUrl,
          target.picture_url,
          target.imageUrl,
          target.image_url,
          target.thumbnailUrl,
          target.thumbnail_url,
          target.logoUrl,
          target.logo_url,
          target.logo,
          target.coverImage,
          target.cover_image,
          source.pictureUrl,
          source.picture_url,
          source.imageUrl,
          source.image_url,
          source.thumbnailUrl,
          source.thumbnail_url,
          source.logoUrl,
          source.logo_url,
          source.logo,
          source.coverImage,
          source.cover_image
        ],
        resolvedNexusGameId
      ),
      domainName: String(
        target.domainName ||
          target.domain_name ||
          source.domainName ||
          source.domain_name ||
          gameBaseInfo.value.domainName ||
          ''
      ).trim(),
      ruleVersionText: String(
        target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version || ''
      ).trim(),
      sourceType: String(
        target.sourceType || target.source_type || source.sourceType || source.source_type || ''
      ).trim(),
      baseRuleVersion: toSafeNumber(
        target.baseRuleVersion ||
          target.base_rule_version ||
          source.baseRuleVersion ||
          source.base_rule_version,
        0
      ),
      baseRuleJson: String(
        target.baseRuleJson ||
          target.base_rule_json ||
          source.baseRuleJson ||
          source.base_rule_json ||
          ''
      ).trim(),
      dismissedRuleVersion: toSafeNumber(
        target.dismissedRuleVersion ||
          target.dismissed_rule_version ||
          source.dismissedRuleVersion ||
          source.dismissed_rule_version,
        0
      ),
      dismissedRuleJson: String(
        target.dismissedRuleJson ||
          target.dismissed_rule_json ||
          source.dismissedRuleJson ||
          source.dismissed_rule_json ||
          ''
      ).trim(),
      ruleJson
    }
  }

  async function ensureNexusGameBinding(options = {}) {
    const forceDetect = !!options?.forceDetect
    const currentBindingSignature = buildCurrentPageSignature()
    // 规则可以复用，历史路径的存在性必须在每次进入页面时重新核实。
    const reuseResolvedRule = !forceDetect && shouldReuseResolvedNexusBinding(currentBindingSignature)

    const nexusGameId = resolveCurrentNexusGameId()
    const domainName = resolveCurrentNexusDomainName()
    if (!nexusGameId && !domainName) {
      cloudNexusRule.value = null
      localNexusRuleOverride.value = null
      currentNexusRule.value = null
      nexusBinding.value = null
      installedNexusMods.value = []
      ruleLoadFailure.value = describeSharedRuleFailure(sharedRuleError('IDENTITY_MISSING', '当前页面缺少来源游戏标识'))
      detectStatus.value = 'rule_unavailable'
      lastResolvedBindingSignature.value = currentBindingSignature
      return
    }

    detectStatus.value = 'scanning'
    try {
      if (!reuseResolvedRule) {
        cloudNexusRule.value = await loadCloudNexusRuleFromServer(nexusGameId)
        localNexusRuleOverride.value = await loadLocalNexusRuleOverride()
        if (!localNexusRuleOverride.value) {
          persistInstallConfigProfileSnapshot(
            hasNexusRuleContent(cloudNexusRule.value)
              ? buildCloudOfficialProfileSnapshot(cloudNexusRule.value)
              : null,
            nexusConfigGameContext.value
          )
        }
      }
      applyEffectiveNexusRule()

      const effectiveRule = currentNexusRule.value
      if (
        !effectiveRule ||
        (!hasNexusRuleContent(effectiveRule) && !localNexusRuleOverride.value)
      ) {
        nexusBinding.value = null
        installedNexusMods.value = []
        ruleLoadFailure.value ||= describeSharedRuleFailure(sharedRuleError('INVALID_RESPONSE', '公共文档没有可用的安装规则'))
        detectStatus.value = 'rule_unavailable'
        lastResolvedBindingSignature.value = currentBindingSignature
        return
      }

      const candidateList = resolveNexusRuleCandidateList(effectiveRule)
      if (!candidateList.length) {
        nexusBinding.value = null
        installedNexusMods.value = []
        detectStatus.value = 'no_detection_rule'
        lastResolvedBindingSignature.value = currentBindingSignature
        await promptNexusRuleCloudUpdateIfNeeded()
        return
      }

      if (!forceDetect) {
        const existingBinding = await invokeIpc('nexusGetGameBinding', {
          nexusGameId: effectiveRule.nexusGameId,
          domainName: effectiveRule.domainName,
          appId: effectiveRule.steamAppId
        })

        if (existingBinding?.isAvailable === true) {
          nexusBinding.value = existingBinding
          detectStatus.value = 'identified'
          lastResolvedBindingSignature.value = currentBindingSignature
          await refreshInstalledNexusMods()
          await promptNexusRuleCloudUpdateIfNeeded()
          return
        }
      }

      const detectedGame = await invokeIpc('nexusDetectGameRootByRule', {
        nexusGameId: effectiveRule.nexusGameId,
        domainName: effectiveRule.domainName,
        ruleJson: buildNexusRuleJsonIpcPayload(effectiveRule)
      })

      if (!detectedGame?.success) {
        nexusBinding.value = null
        installedNexusMods.value = []
        detectStatus.value = 'unidentified'
        lastResolvedBindingSignature.value = currentBindingSignature
        await promptNexusRuleCloudUpdateIfNeeded()
        return
      }

      const upsertResult = await invokeIpc('nexusUpsertGameBinding', {
        nexusGameId: effectiveRule.nexusGameId,
        backendGameId: effectiveRule.gameId,
        appId: effectiveRule.steamAppId || toSafeNumber(detectedGame.appId, 0),
        domainName: effectiveRule.domainName,
        gameName: effectiveRule.gameName,
        coverImage: effectiveRule.coverImage,
        ruleVersion: effectiveRule.ruleVersion,
        detectedRootPath: String(detectedGame.rootPath || '').trim(),
        detectedExePath: String(detectedGame.exePath || '').trim()
      })
      const bindingAvailable = upsertResult?.success && upsertResult?.binding?.isAvailable === true
      nexusBinding.value = bindingAvailable ? upsertResult.binding : null
      detectStatus.value = bindingAvailable ? 'identified' : 'unidentified'
      lastResolvedBindingSignature.value = currentBindingSignature
      if (bindingAvailable) {
        await refreshInstalledNexusMods()
      } else {
        installedNexusMods.value = []
      }
      await promptNexusRuleCloudUpdateIfNeeded()
    } catch (error) {
      applyEffectiveNexusRule()
      nexusBinding.value = null
      installedNexusMods.value = []
      if (!currentNexusRule.value) ruleLoadFailure.value ||= describeSharedRuleFailure(error)
      detectStatus.value = currentNexusRule.value ? 'unidentified' : 'rule_unavailable'
      console.error('自动识别并同步游戏失败', error)
    }
  }

  function buildNexusSourceMeta() {
    const profileSnapshot =
      activeInstallConfigProfileSnapshot.value &&
      typeof activeInstallConfigProfileSnapshot.value === 'object'
        ? activeInstallConfigProfileSnapshot.value
        : null
    const modProfileName =
      String(
        nexusProfileState.activeProfileName.value || nexusProfileState.DEFAULT_PROFILE_NAME
      ).trim() || nexusProfileState.DEFAULT_PROFILE_NAME
    const configProfileId = String(profileSnapshot?.id || profileSnapshot?.profileKey || '').trim()
    const configProfileName = String(profileSnapshot?.configName || '').trim()
    const profileScope = String(profileSnapshot?.configScope || '').trim()
    const ruleProfileId = toSafeNumber(profileSnapshot?.id, 0) || null
    const ruleVersion =
      toSafeNumber(profileSnapshot?.ruleVersion, 0) ||
      toSafeNumber(currentNexusRule.value?.ruleVersion, 0) ||
      null
    const sourceMeta = buildNexusSourceMetaService({
      currentNexusRule: currentNexusRule.value,
      routeQuery: route.query,
      gameBaseInfo: gameBaseInfo.value,
      resolvedNexusAppId: resolvedNexusAppId.value
    })
    return {
      ...sourceMeta,
      profileId: configProfileId || null,
      ruleProfileId,
      profileName: modProfileName,
      targetProfileName: modProfileName,
      profileScope,
      profileKey: String(profileSnapshot?.profileKey || '').trim(),
      configProfileId,
      configProfileName,
      installConfigProfileId: configProfileId,
      installConfigProfileName: configProfileName,
      installConfigProfileScope: profileScope,
      installConfigSourceType: String(profileSnapshot?.sourceType || '').trim(),
      ruleVersion
    }
  }

  function buildNexusInstallConfigPayload() {
    const profileSnapshot =
      activeInstallConfigProfileSnapshot.value &&
      typeof activeInstallConfigProfileSnapshot.value === 'object'
        ? activeInstallConfigProfileSnapshot.value
        : null
    const modProfileName =
      String(
        nexusProfileState.activeProfileName.value || nexusProfileState.DEFAULT_PROFILE_NAME
      ).trim() || nexusProfileState.DEFAULT_PROFILE_NAME
    const configProfileId = String(profileSnapshot?.id || profileSnapshot?.profileKey || '').trim()
    const configProfileName = String(profileSnapshot?.configName || '').trim()
    const ruleProfileId = toSafeNumber(profileSnapshot?.id, 0) || null
    const profileScope = String(profileSnapshot?.configScope || '').trim()
    const ruleVersion =
      toSafeNumber(profileSnapshot?.ruleVersion, 0) ||
      toSafeNumber(currentNexusRule.value?.ruleVersion, 0) ||
      null

    return {
      profileId: configProfileId,
      ruleProfileId,
      profileName: modProfileName,
      targetProfileName: modProfileName,
      profileScope,
      profileKey: String(profileSnapshot?.profileKey || '').trim(),
      configProfileId,
      configProfileName,
      installConfigProfileId: configProfileId,
      installConfigProfileName: configProfileName,
      installConfigProfileScope: profileScope,
      installConfigSourceType: String(profileSnapshot?.sourceType || '').trim(),
      ruleVersion
    }
  }

  function normalizeInstalledNexusRecord(item = {}) {
    return normalizeInstalledNexusRecordService(item, {
      gameDomainName: gameBaseInfo.value.domainName,
      currentNexusRule: currentNexusRule.value,
      gameRootPath: String(nexusBinding.value?.detectedRootPath || '').trim()
    })
  }

  function decorateInstalledNexusRecords(records = []) {
    return decorateInstalledNexusRecordsService(records)
  }

  function openGameRootPath() {
    const rootPath = String(nexusBinding.value?.detectedRootPath || '').trim()
    if (!rootPath) return
    sendIpc('openSpecifyPath', rootPath)
  }

  function buildNexusExecutableLaunchPayload(mod = {}) {
    const launchPath = String(mod?.enableExecutablePath || '').trim()
    if (!launchPath) {
      return null
    }

    return {
      path: launchPath,
      args: Array.isArray(mod?.launchArgs)
        ? mod.launchArgs.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [],
      steamAppId: null
    }
  }

  function launchGame() {
    if (!canLaunchGame.value) {
      $message.warning(uiMessage('ui.detectTheGamePathBeforeLaunching'))
      return
    }

    const injectableMod = preferredInjectableNexusMod.value
    const injectLaunchPayload = buildNexusExecutableLaunchPayload(injectableMod)
    if (injectLaunchPayload?.path) {
      if (activeInjectableNexusMods.value.length > 1) {
        const preferredName = String(
          injectableMod?.displayName || injectableMod?.name || '当前模组'
        ).trim()
        $message.warning(uiMessage('ui.multipleInjectionModsDetectedUsingValueFirst', { value1: (preferredName) }))
      }

      sendIpc('startSpecifiedApp', injectLaunchPayload)
      return
    }

    const currentRuleInjectPayload = buildNexusExecutableLaunchPayload(
      currentRuleInjectDescriptor.value
    )
    if (currentRuleInjectPayload?.path) {
      sendIpc('startSpecifiedApp', currentRuleInjectPayload)
      return
    }

    const defaultExecutableMod = preferredDefaultExecutableNexusMod.value
    const defaultLaunchPayload = buildNexusExecutableLaunchPayload(defaultExecutableMod)
    if (defaultLaunchPayload?.path) {
      if (activeDefaultExecutableNexusMods.value.length > 1) {
        const preferredName = String(
          defaultExecutableMod?.displayName || defaultExecutableMod?.name || '当前模组'
        ).trim()
        $message.warning(uiMessage('ui.multipleDefaultExecutableModsDetectedUsingValueFirst', { value1: (preferredName) }))
      }

      sendIpc('startSpecifiedApp', defaultLaunchPayload)
      return
    }

    if (!detectedGameExecutablePath.value) {
      $message.warning(uiMessage('ui.theGameFolderWasDetectedButNoExecutablePathIs'))
      return
    }

    sendIpc('startSpecifiedApp', {
      path: detectedGameExecutablePath.value,
      steamAppId: resolveCurrentNexusSteamAppId() || null
    })
  }

  async function refreshInstalledNexusMods() {
    const sourceMeta = buildNexusSourceMeta()
    const querySourceMeta = {
      ...sourceMeta,
      repairUnscopedProfile: true
    }
    const activeProfile = String(
      sourceMeta?.profileName || sourceMeta?.targetProfileName || ''
    ).trim()
    const normalizeRecordProfileName = (value = '') =>
      String(value || nexusProfileState.DEFAULT_PROFILE_NAME || 'default')
        .trim()
        .toLowerCase()
    const normalizedActiveProfile = normalizeRecordProfileName(activeProfile)
    logNexusInstallDebug('刷新已安装列表请求', {
      appId: resolvedNexusAppId.value,
      endpointType: 0,
      activeProfile,
      sourceMeta: querySourceMeta
    })
    if (
      !String(sourceMeta?.sourceId || '').trim() &&
      !String(sourceMeta?.sourceSlug || '').trim()
    ) {
      installedNexusMods.value = []
      logNexusInstallDebug('刷新已安装列表跳过：缺少来源标识', { sourceMeta })
      return
    }

    try {
      const result = await getInstalledModsBySourceService({
        appId: resolvedNexusAppId.value,
        endpointType: 0,
        sourceMeta: querySourceMeta
      })
      const records = Array.isArray(result?.records) ? result.records : []
      const filteredRecords = activeProfile
        ? records.filter(
            (item) => normalizeRecordProfileName(item?.profile_name) === normalizedActiveProfile
          )
        : records
      const normalizedRecords = filteredRecords.map((item) => normalizeInstalledNexusRecord(item))
      const decoratedRecords = decorateInstalledNexusRecords(normalizedRecords)
      installedNexusMods.value = decoratedRecords
      logNexusInstallDebug('刷新已安装列表结果', {
        success: result?.success,
        message: result?.message || '',
        repairResult: result?.repairResult || null,
        activeProfile,
        recordCount: records.length,
        filteredCount: filteredRecords.length,
        installedCount: decoratedRecords.length,
        recordProfiles: [
          ...new Set(records.map((item) => String(item?.profile_name || '').trim()))
        ],
        rawSamples: records.slice(0, 10).map((item) => ({
          id: item?.id,
          name: item?.name,
          mod_id: item?.mod_id,
          option_id: item?.option_id,
          version: item?.version,
          profile_name: item?.profile_name,
          source_mod_key: item?.source_mod_key,
          metadata_json: item?.metadata_json
        })),
        installedSamples: decoratedRecords
          .slice(0, 10)
          .map((item) => buildInstalledNexusRecordDebugSnapshot(item))
      })
    } catch (error) {
      console.error('读取已安装模组失败', error)
      installedNexusMods.value = []
      $message.warning(uiMessage('ui.couldNotReadInstalledModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    }
  }

  function buildNexusInstallTaskGameKeys() {
    const nexusGameId = toSafeNumber(
      currentNexusRule.value?.nexusGameId || currentNexusRule.value?.gameId,
      0
    )
    return [
      nexusGameId ? `nexus:${nexusGameId}` : '',
      resolvedNexusAppId.value ? `nexus:${resolvedNexusAppId.value}` : '',
      route.params?.id ? `nexus:${route.params.id}` : ''
    ]
  }

  async function handleSourceInstallTaskUpdated(_event, data = {}) {
    if (
      !shouldRefreshInstalledModsAfterSourceTask(data, 'nexus', buildNexusInstallTaskGameKeys(), {
        allowSourceOnly: true
      })
    ) {
      return
    }
    installedNexusRefreshScheduler.schedule()
  }

  function buildNexusSourceModpackShareItems() {
    return (Array.isArray(installedNexusMods.value) ? installedNexusMods.value : [])
      .filter((item) => toSafeNumber(item?.isActive, 1) !== 0)
      .map((item, index) => {
        const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
        const rawSourceModKey = String(item?.sourceModKey || '').trim()
        const isDefaultDependency =
          item?.isDefaultDependency === true ||
          String(item?.dependencyRole || '').trim() === 'default_dependency' ||
          String(metadata?.category || '').trim() === 'default_dependency' ||
          rawSourceModKey.startsWith('dependency:')
        const modId = String(item?.modId || metadata?.modId || metadata?.sourceModId || '').trim()
        const fileId = String(
          item?.optionId || item?.fileId || metadata?.fileId || metadata?.sourceFileId || ''
        ).trim()
        const domainName = String(
          metadata?.sourceGameDomain || metadata?.domainName || gameBaseInfo.value.domainName || ''
        ).trim()
        const sourceModKey = rawSourceModKey || ['nexus', modId, fileId].filter(Boolean).join(':')
        const dependencyId = String(
          metadata?.dependencyId || metadata?.name || item?.displayName || item?.name || ''
        ).trim()
        const resolvedSourceModKey =
          sourceModKey ||
          (isDefaultDependency
            ? ['dependency', 'nexus', dependencyId || modId || index].filter(Boolean).join(':')
            : '')
        if ((!isDefaultDependency && (!modId || !fileId)) || !domainName || !resolvedSourceModKey) {
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
            item?.localPath ||
            item?.local_path ||
            metadata?.filePath ||
            metadata?.file_path ||
            metadata?.localPath ||
            metadata?.local_path ||
            ''
        ).trim()
        const installRule =
          item?.installRule ||
          metadata?.installRule ||
          metadata?.sourceInstallRule ||
          buildMainModInstallRule()

        return {
          sourcePlatform: 'nexus',
          role: isDefaultDependency ? 'default_dependency' : 'mod',
          sourceGameId: String(
            currentNexusRule.value?.nexusGameId || currentNexusRule.value?.gameId || ''
          ).trim(),
          sourceGameSlug: domainName,
          sourceModId: modId,
          sourceFileId: fileId,
          sourceModKey: resolvedSourceModKey,
          name: String(item?.displayName || item?.name || resolvedSourceModKey).trim(),
          displayName: String(item?.displayName || item?.name || resolvedSourceModKey).trim(),
          version: String(item?.version || '').trim(),
          cover: String(item?.cover || metadata?.cover || '').trim(),
          summary: String(item?.summary || item?.description || metadata?.description || '').trim(),
          author: String(item?.author || item?.uploadedBy || metadata?.author || '').trim(),
          isDefaultDependency,
          dependentCount: toSafeNumber(item?.dependentCount, 0),
          dependencies: Array.isArray(item?.dependencies)
            ? item.dependencies
            : Array.isArray(item?.dependencies_json)
              ? item.dependencies_json
              : [],
          sortIndex: toSafeNumber(item?.priorityOrder ?? item?.priority_order, index),
          sourcePath,
          archivePath,
          stagingPath,
          filePath: sourcePath,
          primaryInstallPath: String(
            item?.primaryInstallPath || metadata?.primaryInstallPath || ''
          ).trim(),
          targetPath: String(item?.targetPath || metadata?.targetPath || '').trim(),
          installRoot: String(
            nexusBinding.value?.detectedRootPath || metadata?.installRoot || ''
          ).trim(),
          installRule,
          sourceInstallRule: installRule,
      ruleSelection: ['local_override', 'player_profile', 'player', 'local'].includes(currentNexusRule.value?.sourceType) ? 'local_override' : 'public',
      sharedRuleDocument: currentNexusRule.value?.sharedRuleDocument || null,
          installPayload: item?.installPayload || metadata?.installPayload || null,
          metadata: {
            ...metadata,
            modId,
            fileId,
            dependencyId,
            category: isDefaultDependency ? 'default_dependency' : metadata?.category,
            dependencyRole: isDefaultDependency ? 'default_dependency' : metadata?.dependencyRole,
            domainName,
            sourceGameDomain: domainName,
            sourcePath,
            sourceRoot: sourcePath,
            archivePath,
            stagingPath,
            filePath: sourcePath,
            cover: String(item?.cover || '').trim(),
            description: String(item?.description || item?.summary || '').trim(),
            installModel: String(item?.installModel || '').trim(),
            sortIndex: toSafeNumber(item?.priorityOrder ?? item?.priority_order, index)
          }
        }
      })
      .filter(Boolean)
  }

  function buildNexusSourceModpackSnapshot(items = [], name = '') {
    const domainName = String(gameBaseInfo.value.domainName || '').trim()
    return buildSourceModpackCreatePayload({
      sourceType: 'nexus',
      sourceGameId: String(
        currentNexusRule.value?.nexusGameId || currentNexusRule.value?.gameId || ''
      ).trim(),
      sourceGameSlug: domainName,
      sourceGameName: gameDisplayName.value,
      name,
      cover: gameBaseInfo.value.coverImage,
      items
    })
  }

  async function prepareNexusSourceModpackSnapshot(name = '') {
    const domainName = String(gameBaseInfo.value.domainName || '').trim()
    if (!domainName) throw new Error(uiText('ui.thisGameHasNoNexusDomainIdentifier'))

    await refreshInstalledNexusMods()
    const items = buildNexusSourceModpackShareItems()
    if (!items.length) throw new Error(uiText('ui.noInstalledNexusModsAreAvailableToShare'))
    return buildNexusSourceModpackSnapshot(items, name)
  }

  async function shareNexusSourceModpack() {
    if (sourceModpackSharing.value) return

    sourceModpackSharing.value = true
    try {
      const domainName = String(gameBaseInfo.value.domainName || '').trim()
      if (!domainName) throw new Error(uiText('ui.thisGameHasNoNexusDomainIdentifier'))
      const snapshot = await prepareNexusSourceModpackSnapshot()
      const shareName = await requestSourceModpackShareName(
        uiText('ui.valueNexusModpack', { value1: (gameDisplayName.value || domainName) })
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
      console.error('生成 Nexus 分享码失败', error)
      $message.error(uiMessage('ui.couldNotCreateShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      sourceModpackSharing.value = false
    }
  }

  async function updateNexusSourceModpack() {
    if (sourceModpackSharing.value) return
    sourceModpackSharing.value = true
    try {
      const snapshot = await prepareNexusSourceModpackSnapshot()
      sourceModpackUpdateModal.value = { open: true, snapshot }
    } catch (error) {
      console.error('准备 Nexus 分享更新失败', error)
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

  function buildUnifiedNexusShareTargetContext() {
    const sourceMeta = buildNexusSourceMeta()
    return {
      localGameInstallationId: toSafeNumber(nexusBinding.value?.id, 0),
      sourcePlatform: 'nexus',
      sourceGameId: String(currentNexusRule.value?.nexusGameId || '').trim(),
      sourceGameSlug: String(gameBaseInfo.value?.domainName || route.params?.id || '').trim(),
      appId: resolvedNexusAppId.value,
      gameName: gameBaseInfo.value?.name,
      gameRoot: String(nexusBinding.value?.detectedRootPath || '').trim(),
      endpointType: 0,
      profileId: String(sourceMeta.profileId || '').trim(),
      profileName: String(sourceMeta.profileName || '').trim(),
      installRule: buildMainModInstallRule(),
      currentNexusRule: toPlainSourceModpackJson(currentNexusRule.value, {}),
      nexusApiConfig: getNexusApiConfig(),
      systemConfig: toPlainSourceModpackJson(systemConfig.value, {}),
      gameBaseInfo: toPlainSourceModpackJson(gameBaseInfo.value, {})
    }
  }

  async function confirmNexusSourceModpackImport() {
    const code = String(sourceModpackImportModal.value.code || '').trim()
    if (!code) {
      $message.warning(uiMessage('ui.enterAShareCode'))
      return
    }

    sourceModpackImportModal.value = { ...sourceModpackImportModal.value, loading: true }
    try {
      const inspection = await inspectShareImport({
        shareCode: code,
        entryPoint: 'nexus',
        targetContext: buildUnifiedNexusShareTargetContext()
      })
      if (inspection.mode === 'latest') {
        $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
        closeSourceModpackImportModal()
        return
      }
      if (!(await requestSourceModpackInspectionConfirmation(Modal, inspection))) return
      const profileName = inspection.profileTargets?.[0]?.profileName
      if (profileName) await prepareNexusImportProfile(profileName)
      const result = await applyShareImport({
        planToken: inspection.planToken,
        expectedPlanHash: inspection.planHash
      })
      sourceModpackImportModal.value = { open: false, code: '', loading: false }
      $message.success(result.message || '已加入安装任务')
    } catch (error) {
      console.error('导入 Nexus 分享码失败', error)
      $message.error(uiMessage('ui.couldNotImportShareCodeValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      sourceModpackImportModal.value = {
        ...sourceModpackImportModal.value,
        loading: false
      }
    }
  }

  function openInstalledManager(options = {}) {
    if (!canInstallByRule.value) {
      $message.warning(uiMessage('ui.detectTheGamePathBeforeManagingInstalledMods'))
      return
    }
    goToModManagement(options)
  }

  function openLocalBindingWithGameRootCheck() {
    if (detectStatus.value === 'scanning' || manualBindingLoading.value) {
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
        await handleManualBindGame()
        if (canInstallByRule.value) {
          openInstalledManager({ action: 'manage-local-mod' })
        }
      }
    })
  }

  function handleHeaderAction(actionKey = '') {
    const key = String(actionKey || '').trim()
    if (key === 'rule-imported') {
      lastResolvedBindingSignature.value = ''
      ensureNexusGameBinding({ forceDetect: true }).catch(error => {
        $message.warning(uiMessage('ui.rulesSavedButGameStatusRefreshFailedValue', { value1: (error?.message || uiText('ui.reopenThisPage')) }))
      })
      return
    }
    if (key === 'profile-scheme') {
      openProfileSchemeModal()
      return
    }
    if (key === 'manual-bind') {
      handleManualBindGame()
      return
    }
    if (key === 'scan') {
      ensureNexusGameBinding({ forceDetect: true }).then()
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
      openNexusRuleConfigDialog()
      return
    }
    if (key === 'share-source-modpack') {
      shareNexusSourceModpack().then()
      return
    }
    if (key === 'import-source-modpack') {
      openSourceModpackImportModal()
    }
  }

  function goToModManagement(options = {}) {
    const steamAppId = resolveCurrentNexusSteamAppId()
    const backendGameId = resolveCurrentNexusBackendGameId()
    const nexusGameId = resolveCurrentNexusGameId()
    const domainName = resolveCurrentNexusDomainName()
    const activeProfileName =
      String(
        nexusProfileState.activeProfileName.value || nexusProfileState.DEFAULT_PROFILE_NAME
      ).trim() || nexusProfileState.DEFAULT_PROFILE_NAME
    const installConfig = buildNexusInstallConfigPayload()
    const sourceId =
      String(nexusGameId || '').trim() ||
      String(domainName || '')
        .trim()
        .toLowerCase()

    if (!domainName) {
      $message.warning(uiMessage('ui.theGameHasNoNexusDomainIdentifierForModManagement'))
      return
    }
    if (!sourceId) {
      $message.warning(uiMessage('ui.theGameHasNoNexusSourceIdentifierForModManagement'))
      return
    }

    gameStore.setCurrentManagedGame({
      sourceId,
      steamAppId,
      chineseTitle: gameDisplayName.value,
      is_server_installed: 0,
      server_install_mod_type: 0,
      gId: backendGameId,
      sourceType: 'nexus',
      sourceGameId: backendGameId,
      sourceDomainName: domainName,
      sourceNexusGameId: nexusGameId,
      sourceProfile: activeProfileName
    })

    const query = Object.fromEntries(
      Object.entries({
        source: 'nexus',
        sourceId,
        name: gameDisplayName.value,
        profile: activeProfileName,
        gameId: String(backendGameId || ''),
        backendGameId: String(backendGameId || ''),
        domainName,
        nexusGameId: String(nexusGameId || ''),
        appId: String(steamAppId || ''),
        profileId: installConfig.profileId,
        ruleProfileId: String(installConfig.ruleProfileId || ''),
        profileScope: installConfig.profileScope,
        profileKey: installConfig.profileKey,
        configProfileId: installConfig.configProfileId,
        configProfileName: installConfig.configProfileName,
        installConfigProfileId: installConfig.installConfigProfileId,
        installConfigProfileName: installConfig.installConfigProfileName,
        installConfigProfileScope: installConfig.installConfigProfileScope,
        installConfigSourceType: installConfig.installConfigSourceType,
        ruleVersion: String(installConfig.ruleVersion || ''),
        action: options.action
      }).filter(([, value]) => String(value || '').trim() !== '')
    )

    router.push({
      name: 'GameModManagement',
      params: {
        source: 'nexus',
        id: sourceId
      },
      query
    })
  }

  function runInstalledExecutable(row) {
    const customLaunchPayload = row?.isManualExecutable
      ? buildNexusExecutableLaunchPayload(row)
      : null
    if (customLaunchPayload?.path) {
      sendIpc('startSpecifiedApp', customLaunchPayload)
      return
    }

    const executableType = toSafeNumber(row?.executableType, 0)
    const executablePath = String(row?.executablePath || '').trim()
    if (executableType === 1 && executablePath) {
      sendIpc('startSpecifiedApp', {
        path: executablePath,
        steamAppId: null
      })
      return
    }

    if (toSafeNumber(row?.hasMultipleExecutables ? 2 : executableType, 0) >= 2) {
      $message.warning(uiMessage('ui.multipleExecutablesWereFoundTheInstallationFolderHasBeenOpened'))
      openInstalledTargetPath(row)
      return
    }

    $message.warning(uiMessage('ui.noExecutablePathIsRecordedForThisMod'))
  }

  function openInstalledTargetPath(row) {
    const targetPath = String(row?.primaryInstallPath || row?.targetPath || '').trim()
    if (!targetPath) {
      $message.warning(uiMessage('ui.noInstallationPathIsAvailableForThisMod'))
      return
    }
    sendIpc('openSpecifyPath', targetPath)
  }

  function openModPage(item) {
    const domainName = String(item?.domainName || gameBaseInfo.value.domainName || '').trim()
    const modId = toSafeNumber(item?.modId, 0)
    if (!domainName || !modId) {
      $message.warning(uiMessage('ui.thisModHasNoDetailsLink'))
      return
    }

    router.push(
      buildGameSiteDetailRoute({
        url: `https://www.nexusmods.com/${encodeURIComponent(domainName)}/mods/${modId}`,
        title: String(item?.name || `Nexus Mod ${modId}`).trim(),
        subtitle: String(item?.author ? uiText('ui.authorValueVariant2', { value1: (item.author) }) : `Mod ID：${modId}`).trim(),
        source: 'Nexus',
        sourceKey: 'nexus',
        cover: String(item?.pictureUrl || '').trim(),
        backPath: route.fullPath,
        gameId: String(resolveCurrentNexusBackendGameId() || '').trim(),
        gameName: String(gameDisplayName.value || gameBaseInfo.value.name || domainName).trim(),
        sourceGameId: String(resolveCurrentNexusGameId() || '').trim(),
        sourceSlug: domainName,
        domainName,
        appId: String(resolvedNexusAppId.value || '').trim(),
        modId: String(modId),
        modName: String(item?.name || `Nexus Mod ${modId}`).trim(),
        author: String(item?.author || '').trim()
      })
    )
  }

  function handleOpenModDetail(card) {
    openModPage(card?.raw || card)
  }

  function handlePrimaryAction(card) {
    openNexusFileModal(card)
  }

  function handleSecondaryAction(card) {
    const actionKey = String(card?.secondaryActionKey || '').trim()
    if (actionKey === 'run-executable') {
      runInstalledExecutable(card?.installedRecord || {})
      return
    }
    handlePrimaryAction(card)
  }

  function handleCardAction(payload = {}) {
    const actionKey = String(payload?.action?.key || '').trim()
    const card = payload?.item || {}
    if (actionKey === 'run-executable') {
      runInstalledExecutable(card?.installedRecord || {})
    }
  }

  async function handleTranslateCurrentPage() {
    if (modPageTranslationLoading.value) {
      return
    }

    const requestItems = buildModTranslationRequestItems(pageMods.value, {
      unresolvedOnly: true
    })
    if (!requestItems.length) {
      $message.info(uiMessage('ui.modsOnThisPageTranslated'))
      return
    }

    const totalCount = countUntranslatedNexusMods(pageMods.value)
    updateModPageTranslationProgress(totalCount)
    modPageTranslationLoading.value = true
    try {
      // 先把悬浮按钮的加载态和进度文案渲染出来，再进入模型加载/翻译流程。
      await waitForUiRender()
      await translateVisibleNexusMods(pageMods.value, {
        onProgress: () => {
          updateModPageTranslationProgress(totalCount)
        }
      })
      const completedCount = Math.max(totalCount - countUntranslatedNexusMods(pageMods.value), 0)
      if (completedCount > 0) {
        $message.success(uiMessage('ui.translatedValueValueModsOnThisPage', { value1: (completedCount), value2: (totalCount) }))
        return
      }
      $message.info(uiMessage('ui.noNewTranslationsForThisPage'))
    } catch (error) {
      console.error('[NEXUS] 当前页模组翻译失败', error)
      $message.error(uiMessage('ui.couldNotTranslateThisPageValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      modPageTranslationLoading.value = false
      resetModPageTranslationProgress()
    }
  }

  async function handleTranslateSingleMod(card = {}) {
    const rawItem = card?.raw || card
    const modId = toSafeNumber(rawItem?.modId || rawItem?.id, 0)
    if (modId <= 0) {
      return
    }

    const requestItems = buildModTranslationRequestItems([rawItem], {
      unresolvedOnly: true
    })
    if (!requestItems.length) {
      return
    }

    modItemTranslationLoadingMap.value = {
      ...modItemTranslationLoadingMap.value,
      [modId]: true
    }

    try {
      const translatedMap = await translateTextBatchService({
        systemConfig: systemConfig.value,
        source: 'nexus',
        scene: 'mod_list_card',
        items: requestItems
      })

      const translatedCount = mergeTranslationResultMap(
        translatedMap,
        modTranslationMap,
        modTranslationResolvedMap
      )
      if (translatedCount > 0) {
        $message.success(uiMessage('ui.modTranslationComplete'))
      } else {
        $message.info(uiMessage('ui.noNewTranslationsForThisMod'))
      }
    } catch (error) {
      console.error('[NEXUS] 单模组翻译失败', error)
      $message.error(uiMessage('ui.couldNotTranslateModValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      modItemTranslationLoadingMap.value = {
        ...modItemTranslationLoadingMap.value,
        [modId]: false
      }
    }
  }

  function resolveNexusTranslateTargetFiles(payload = {}) {
    const hasScopedFiles = payload && typeof payload === 'object' && Array.isArray(payload.files)
    if (!hasScopedFiles) {
      return visibleNexusFiles.value
    }

    const scopedFileIds = new Set(
      payload.files.map((item) => String(item?.fileId || item?.id || '').trim()).filter(Boolean)
    )
    if (!scopedFileIds.size) {
      return []
    }

    return visibleNexusFiles.value.filter((item) => {
      return scopedFileIds.has(String(item?.fileId || item?.id || '').trim())
    })
  }

  async function handleTranslateNexusFiles(payload = {}) {
    if (nexusFileTranslationLoading.value) {
      return
    }

    const targetFiles = resolveNexusTranslateTargetFiles(payload)
    const groupLabel = toSafeText(payload?.groupLabel, '当前分类')
    const requestItems = buildNexusFileTranslationRequestItems(
      targetFiles,
      nexusFileModal.value.item,
      {
        unresolvedOnly: true
      }
    )
    if (!requestItems.length) {
      $message.info(uiMessage('ui.valueFileListTranslated', { value1: (groupLabel) }))
      return
    }

    nexusFileTranslationLoading.value = true
    try {
      const translatedCount = await translateNexusFileList(targetFiles, nexusFileModal.value.item)
      if (translatedCount > 0) {
        $message.success(uiMessage('ui.valueAddedValueTranslations', { value1: (groupLabel), value2: (translatedCount) }))
      } else {
        $message.info(uiMessage('ui.valueNoNewTranslations', { value1: (groupLabel) }))
      }
    } catch (error) {
      console.error('[NEXUS] 文件列表翻译失败', error)
      $message.error(uiMessage('ui.couldNotTranslateFileListValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      nexusFileTranslationLoading.value = false
    }
  }

  function handleFloatingAction(action = {}) {
    const actionKey = String(action?.key || '').trim()
    if (actionKey === 'translate-current-page') {
      handleTranslateCurrentPage().then()
    }
  }

  function handleConfigLoginSuccess() {
    userStore.upUserInfo().catch(() => {})
  }

  function toSettings() {
    router.push({ path: '/app/settings', query: { section: 'nexus' } })
  }

  const {
    loading,
    listType,
    query,
    keywordInput,
    remoteHasMorePage,
    remoteTotalCount,
    hasBootstrapped,
    typeOptions,
    total,
    pages,
    pageMods,
    changePage,
    handleSearch,
    loadModList,
    initPageData
  } = useNexusListQuery({
    applyRouteBaseInfo: (...args) => applyRouteBaseInfo(...args),
    buildCurrentPageSignature: (...args) => buildCurrentPageSignature(...args),
    gameBaseInfo,
    getNexusApiConfig: (...args) => getNexusApiConfig(...args),
    hasNexusApiKey,
    hydrateNexusGameBaseInfoFromApi: (...args) => hydrateNexusGameBaseInfoFromApi(...args),
    normalizeSystemConfig: (...args) => normalizeSystemConfig(...args),
    requestSystemConfig: (...args) => requestSystemConfig(...args),
    setPageMenuNameAfterFirstInit: (...args) => setPageMenuNameAfterFirstInit(...args),
    systemConfig,
    toSafeNumber: (...args) => toSafeNumber(...args)
  })

  const {
    nexusFileModal,
    nexusFileLoadErrorText,
    isHiddenNexusFile,
    logNexusInstallDebug,
    resolveInstalledNexusRecordFileId,
    buildInstalledNexusRecordDebugSnapshot,
    visibleNexusFiles,
    untranslatedNexusFileCount,
    formatNumber,
    nexusFileGroups,
    closeNexusFileModal,
    inspectNexusModRequirements,
    openNexusFileModal
  } = useNexusFiles({
    buildNexusFileTranslationKey: (...args) => buildNexusFileTranslationKey(...args),
    buildNexusFileTranslationRequestItems: (...args) =>
      buildNexusFileTranslationRequestItems(...args),
    canUseNexusAiTranslation,
    currentNexusRule,
    gameBaseInfo,
    getNexusApiConfig: (...args) => getNexusApiConfig(...args),
    hydrateNexusFileTranslations: (...args) => hydrateNexusFileTranslations(...args),
    installedNexusFileIdSetMap,
    installedNexusModIdSet,
    installedNexusModRecordMap,
    installedNexusMods,
    installedSourceModKeySet,
    nexusFileTranslationLoading,
    nexusFileTranslationMap,
    normalizeVersionText: (...args) => normalizeVersionText(...args),
    refreshInstalledNexusMods: (...args) => refreshInstalledNexusMods(...args),
    toSafeNumber: (...args) => toSafeNumber(...args),
    toSafeText: (...args) => toSafeText(...args)
  })

  const { buildMainModInstallRule, handleNexusFileAction } = useNexusInstallSubmission({
    beginNexusInstallState: (...args) => beginNexusInstallState(...args),
    buildNexusInstallConfigPayload: (...args) => buildNexusInstallConfigPayload(...args),
    buildNexusSourceMeta: (...args) => buildNexusSourceMeta(...args),
    canInstallByRule,
    closeNexusFileModal: (...args) => closeNexusFileModal(...args),
    currentNexusRule,
    finishNexusInstallState: (...args) => finishNexusInstallState(...args),
    gameBaseInfo,
    getNexusApiConfig: (...args) => getNexusApiConfig(...args),
    inspectNexusModRequirements: (...args) => inspectNexusModRequirements(...args),
    installSubmitting,
    installedNexusModRecordMap,
    installedSourceModKeySet,
    invokeIpc: (...args) => invokeIpc(...args),
    nexusBinding,
    nexusFileModal,
    refreshInstalledNexusMods: (...args) => refreshInstalledNexusMods(...args),
    resolvedNexusAppId,
    route,
    systemConfig,
    toSafeNumber: (...args) => toSafeNumber(...args),
    updateNexusInstallStateText: (...args) => updateNexusInstallStateText(...args)
  })

  watch(
    () => query.value.limit,
    async () => {
      query.value.page = 1
      await loadModList()
    }
  )

  watch(pages, (newValue) => {
    if (query.value.page > newValue) {
      query.value.page = newValue
    }
  })

  watch(listType, async () => {
    query.value.page = 1
    await loadModList()
  })

  watch(
    () =>
      [
        pageMods.value
          .map((item) => `${item?.modId || item?.id}:${item?.name || ''}:${item?.summary || ''}`)
          .join('|'),
        JSON.stringify([aiTranslationConfig.value, contentLocale.value])
      ].join('::'),
    async () => {
      modTranslationMap.value = {}
      modTranslationResolvedMap.value = {}
      modItemTranslationLoadingMap.value = {}
      await hydrateVisibleNexusModTranslations(pageMods.value)
      await autoTranslateVisibleNexusMods(pageMods.value)
    },
    { immediate: true }
  )

  watch(
    () =>
      [
        nexusFileModal.value.open ? '1' : '0',
        (Array.isArray(nexusFileModal.value.files) ? nexusFileModal.value.files : [])
          .map((item) => `${item?.fileId || item?.id}:${item?.name || ''}:${item?.description || ''}`)
          .join('|'),
        JSON.stringify([aiTranslationConfig.value, contentLocale.value])
      ].join('::'),
    async (_value, _oldValue, onCleanup) => {
      let cancelled = false
      onCleanup(() => { cancelled = true })
      nexusFileTranslationMap.value = {}
      nexusFileTranslationResolvedMap.value = {}
      nexusFileTranslationLoading.value = false
      nexusFileAutoTranslationInFlightSignature.value = ''
      nexusFileAutoTranslationCompletedSignature.value = ''
      nexusFileTranslationToken++
      if (!nexusFileModal.value.open) {
        return
      }
      await hydrateNexusFileTranslations(nexusFileModal.value.files, nexusFileModal.value.item)
      if (cancelled || !nexusFileModal.value.open) return
      await autoTranslateNexusFileList(nexusFileModal.value.files, nexusFileModal.value.item)
    },
    { immediate: true }
  )

  watch(
    () =>
      [
        query.value.keyword,
        query.value.page,
        query.value.limit,
        listType.value,
        gameBaseInfo.value.domainName,
        gameBaseInfo.value.name,
        nexusBinding.value?.detectedRootPath,
        nexusBinding.value?.detectedExePath,
        detectStatus.value,
        nexusProfileState.activeProfileName.value,
        currentNexusRule.value?.ruleVersion,
        hasNexusApiKey.value ? '1' : '0',
        nexusFileModal.value.open ? '1' : '0',
        nexusFileModal.value.item?.modId || nexusFileModal.value.item?.id,
        nexusFileModal.value.targetFileId,
        nexusFileModal.value.files.length,
        nexusFileModal.value.requirementSummary?.totalCount
      ].join('::'),
    () => {
      publishNexusAiPageContext()
    },
    { immediate: true }
  )

  const { activate: activateSourceTaskListeners, deactivate: deactivateSourceTaskListeners } =
    createSourceInstallTaskSubscriptions(ipcRenderer, {
      onTaskUpdated: handleSourceInstallTaskUpdated,
      refreshScheduler: installedNexusRefreshScheduler,
      listeners: []
    })

  onMounted(async () => {
    activateSourceTaskListeners()
    await initPageData()
    await ensureNexusGameBinding()
  })

  onActivated(async () => {
    activateSourceTaskListeners()
    if (!hasBootstrapped.value) {
      return
    }
    await initPageData()
    await ensureNexusGameBinding()
  })

  onDeactivated(() => {
    deactivateSourceTaskListeners()
  })

  onUnmounted(() => {
    deactivateSourceTaskListeners()
    aiPageContextProvider.clear()
  })

  return {
    userLoginRef,
    dlssContext,
    gameBaseInfo,
    gameDisplayName,
    headerTags,
    headerStats,
    canGenerateRulePrompt,
    nexusConfigGameContext,
    detectStatusText,
    detectStatusType,
    detectStatusSubText,
    headerActions,
    handleHeaderAction,
    profileConfigModal,
    nexusProfileState,
    installedNexusMods,
    profileSwitching,
    sharingProfile,
    importingProfile,
    createProfileModal,
    closeProfileSchemeModal,
    handleProfileSwitch,
    handleProfileRename,
    handleProfileDelete,
    openCreateProfileModal,
    handleInlineCreateProfile,
    shareNexusSourceModpack,
    updateNexusSourceModpack,
    openSourceModpackImportModal,
    handleExportToFile,
    handleImportFromFile,
    closeCreateProfileModal,
    confirmCreateProfileModal,
    keywordInput,
    loading,
    hasNexusApiKey,
    listType,
    typeOptions,
    listNotice,
    listItems,
    nexusModFloatingActions,
    query,
    pages,
    total,
    pageMods,
    handleSearch,
    toSettings,
    handleOpenModDetail,
    handleSecondaryAction,
    handleCardAction,
    handleTranslateSingleMod,
    handleFloatingAction,
    handlePrimaryAction,
    changePage,
    nexusFileModal,
    nexusFileLoadErrorText,
    getTranslatedModTitle,
    nexusFileGroups,
    visibleNexusFiles,
    canInstallByRule,
    installSubmitting,
    showAiOriginalText,
    canUseNexusAiTranslation,
    nexusFileTranslationLoading,
    untranslatedNexusFileCount,
    closeNexusFileModal,
    handleNexusFileAction,
    handleTranslateNexusFiles,
    sourceModpackImportModal,
    confirmNexusSourceModpackImport,
    closeSourceModpackImportModal,
    sourceModpackUpdateModal,
    profileSwitchProgress,
    handleConfigLoginSuccess
  }
}
import { nexusAccountState } from '@renderer/store/nexusAccount.js'
