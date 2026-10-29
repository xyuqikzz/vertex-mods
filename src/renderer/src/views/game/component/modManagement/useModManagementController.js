import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../../i18n/message.js'
import { useModManagementDialogs } from './useModManagementDialogs.js'
import { useModManagementProfiles } from './useModManagementProfiles.js'
import { useModManagementUpdates } from './useModManagementUpdates.js'
import { useModManagementInstall } from './useModManagementInstall.js'
import { useModManagementList } from './useModManagementList.js'
import { openManagedModLocation } from './open-mod-location.js'
import { getManagedModSourceUrl } from '../../../../../../shared/games/mod-management-location.js'

import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useRoute } from 'vue-router'
import { useGameStore } from '@renderer/store/gameStore.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import common from '@renderer/common/index.js'
import { $message } from '@renderer/common/message.js'
import router from '@renderer/router/index.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { isAiTranslationAvailable, queryCachedTextBatch as queryCachedTextBatchService } from '@renderer/utils/ai-translation.js'
import { canTranslateModContent, gamePresentation } from '@renderer/i18n/content.js'
import { localizeModUiText } from '@renderer/i18n/mod-browser-ui.js'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { increaseQuickLaunchWeight } from '@renderer/utils/quick-launch-weight.js'

import { extractInstallRuleMatchedRuleId, normalizeInstallRuleLaunchAction, normalizeInstallRuleLaunchArgs, normalizeInstallRuleOptionalBoolean, resolveInstallRulePlanFromMetadata } from '@renderer/utils/install-rule-plan.js'
import { getR2modmanCommunityMetaBySteamAppId } from '@renderer/utils/community-api.js'


import { applyEffectiveNexusApiConfig, normalizeNexusApiConfig } from '@renderer/utils/nexus-api-config.js'
import { getModioApiConfig, resolveEffectiveModioApiConfig } from '@renderer/utils/modio-api.js'
import { getFicsitInstalledMods, saveFicsitModPriorityOrder, setFicsitModEnabled, uninstallFicsitMod } from '@views/game/ficsit/ficsit-service.js'
import { deleteLocalModAsset as deleteLocalModLibraryItem, listLocalModAssets as listLocalModLibrary, openLocalModPath as openLocalModLibraryPath } from '@views/game/local-mod-manager/local-mod-manager-service.js'
import { buildNexusSourceMeta as buildNexusSourceMetaService, decorateInstalledNexusRecords as decorateInstalledNexusRecordsService, getInstalledModsBySource as getInstalledModsBySourceService, normalizeInstalledNexusRecord as normalizeInstalledNexusRecordService, saveNexusModPriorityOrder, toggleModState as toggleNexusModStateService, uninstallModById as uninstallNexusModByIdService } from '@views/game/nexus/nexus-service.js'
import { buildThunderstoreModManageProtocol } from '@views/game/component/modManagement/adapters/thunderstore-adapter.js'
import { SOURCE_PROFILE_REGISTRY_UPDATED_EVENT } from '@renderer/utils/source-profile-registry.js'

const MODIO_SOURCE_LABEL = resolveSourcePlatformLabel('modio', 'Mod.io')
import { buildModioModManageProtocol } from '@views/game/component/modManagement/adapters/modio-adapter.js'
import { DEFAULT_AI_TRANSLATION_CONFIG, normalizeAiTranslationConfig } from '../../../../../../shared/translation/ai-translation-config.js'

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

export function useModManagementController() {
  const route = useRoute()
  const downloadStore = useDownloadStore()
  const gameStore = useGameStore()
  const { setMenuName: setPageMenuName } = useMenuName()
  const showInstallPathRef = ref()
  const boundManagementPath = ref(String(route.path || '').trim())
  const boundManagementFullPath = ref(String(route.fullPath || '').trim())
  const boundManagementParamsSource = ref(String(route.params?.source || '').trim())
  const boundManagementParamsId = ref(String(route.params?.id || '').trim())
  const boundManagementQuery = ref({ ...(route.query || {}) })
  const queriedData = ref([])
  const activeTab = ref('client')
  const lastComparedTab = ref('client')
  const clientList = ref([])
  const serverList = ref([])
  const isShowAllUpdateClient = ref(false)
  const isShowAllUpdateServer = ref(false)
  const isDisabledUpAll = ref(false)
  const updateCount = ref(0)
  const isBatchUninstalling = ref(false)
  const batchTargetCount = ref(0)
  const modSearchKeyword = ref('')
  const compactListScrollRef = ref(null)
  let refreshTimer = null
  let sourceStatusPeriodicTimer = null
  const SOURCE_STATUS_PERIODIC_INTERVAL = 30 * 60 * 1000

  const SOURCE_TYPE = Object.freeze({
    VERTEX: 'vertex',
    THUNDERSTORE: 'thunderstore',
    FICSIT: 'ficsit',
    NEXUS: 'nexus',
    MODIO: 'modio'
  })

  const THUNDERSTORE_MANAGER_PAGE_SIZE = 100
  const FICSIT_STEAM_APP_ID = 526870
  const FICSIT_DOWNLOAD_BASE_URL = 'https://api.ficsit.app'

  const activeSource = ref(SOURCE_TYPE.VERTEX)
  const sourceLoading = ref(false)
  const sourceErrorText = ref('')
  const vertexLoading = ref(false)
  const thunderstoreCommunity = ref('')

  const thunderstoreInstalledList = ref([])
  const thunderstoreLocalBoundList = ref([])
  const thunderstoreProfileSummary = ref(createEmptyThunderstoreProfileSummary())
  const thunderstoreOperationLoadingMap = ref({})
  const thunderstoreTogglingMap = ref({})
  const thunderstoreUpdatingMap = ref({})

  const thunderstoreBatchLoading = ref(false)
  const thunderstoreUninstallAllLoading = ref(false)
  const thunderstorePage = ref(1)

  const ficsitInstalledList = ref([])
  const ficsitLoading = ref(false)
  const ficsitOperationLoadingMap = ref({})
  const ficsitUpdatingMap = ref({})

  const nexusInstalledList = ref([])
  const nexusLoading = ref(false)
  const nexusOperationLoadingMap = ref({})
  const nexusUpdatingMap = ref({})
  const nexusBatchLoading = ref(false)

  const modioInstalledList = ref([])
  const modioLoading = ref(false)
  const modioOperationLoadingMap = ref({})
  const modioUpdatingMap = ref({})
  const modioBatchLoading = ref(false)
  const localLibraryList = ref([])
  const localLibraryLoading = ref(false)
  const localLibraryTaskLoadingMap = ref({})

  const priorityOrderDirty = ref(false)
  const priorityOrderSaving = ref(false)
  const priorityDragKey = ref('')

  function buildManageKeyByRoute() {
    const sourceType = getRouteSourceType()
    const sourceId = getRouteSourceIdText()
    const sourceGameId = Number(
      boundManagementQuery.value?.backendGameId || boundManagementQuery.value?.gameId || 0
    )
    const sourceCommunity =
      sourceType === SOURCE_TYPE.THUNDERSTORE ? resolveThunderstoreCommunityFromRoute() : ''
    const sourceDomainName = sourceType === SOURCE_TYPE.NEXUS ? resolveNexusDomainName() : ''
    const sourceProfile = getRouteQueryText('profile') || 'default'
    return [
      sourceType,
      sourceId || '',
      sourceGameId || '',
      sourceCommunity || '',
      sourceDomainName || '',
      sourceProfile
    ]
      .join(':')
      .replace(/:+$/g, '')
  }

  const current = computed(() =>
    gameStore.currentManagedGameList.find(
      (item) =>
        item.manageKey === buildManageKeyByRoute() ||
        (normalizeSourceType(item.sourceType) === getRouteSourceType() &&
          normalizeRouteSourceId(
            normalizeSourceType(item.sourceType),
            item.sourceId || item.steamAppId
          ) === getRouteSourceIdText() &&
          (getRouteSourceType() !== SOURCE_TYPE.NEXUS ||
            String(item?.sourceDomainName || '')
              .trim()
              .toLowerCase() === resolveNexusDomainName()))
    )
  )

  const isCurrentManagementRoute = computed(
    () => String(route.fullPath || '').trim() === boundManagementFullPath.value
  )

  const resolvedSteamAppId = computed(() => {
    const storeAppId = Number(current.value?.steamAppId || 0)
    if (storeAppId > 0) {
      return storeAppId
    }

    const queryAppId = Number(
      boundManagementQuery.value?.appId || boundManagementQuery.value?.steamAppId || 0
    )
    if (queryAppId > 0) {
      return queryAppId
    }

    if (
      getRouteSourceType() === SOURCE_TYPE.VERTEX ||
      getRouteSourceType() === SOURCE_TYPE.FICSIT
    ) {
      const routeAppId = Number(boundManagementParamsId.value || 0)
      if (Number.isFinite(routeAppId) && routeAppId > 0) {
        return routeAppId
      }
    }

    return 0
  })
  const resolvedGameId = computed(() =>
    Number(current.value?.gId || current.value?.sourceGameId || 0)
  )
  const routeSourceType = computed(() =>
    normalizeSourceType(
      boundManagementParamsSource.value ||
        boundManagementQuery.value?.source ||
        current.value?.sourceType ||
        SOURCE_TYPE.VERTEX
    )
  )
  const resolvedNexusDomainName = computed(() => resolveNexusDomainName())
  const resolvedNexusGameId = computed(() => resolveNexusGameId())
  const resolvedModioGameId = computed(() => {
    const routeValue = Number(boundManagementParamsId.value || 0)
    if (Number.isFinite(routeValue) && routeValue > 0) {
      return routeValue
    }
    const queryValue = Number(
      boundManagementQuery.value?.modioGameId || boundManagementQuery.value?.gameId || 0
    )
    return Number.isFinite(queryValue) && queryValue > 0 ? queryValue : 0
  })
  const resolvedModioAppId = computed(() => {
    const queryValue = Number(
      boundManagementQuery.value?.appId || boundManagementQuery.value?.steamAppId || 0
    )
    if (Number.isFinite(queryValue) && queryValue > 0) {
      return queryValue
    }
    return resolvedModioGameId.value
  })
  const nexusSourceMeta = computed(() => {
    const baseMeta = buildNexusSourceMetaService({
      currentNexusRule: {
        nexusGameId: resolvedNexusGameId.value
      },
      routeQuery: {
        nexusGameId: resolvedNexusGameId.value
      },
      gameBaseInfo: {
        domainName: resolvedNexusDomainName.value
      },
      resolvedNexusAppId: resolvedSteamAppId.value
    })
    return {
      ...baseMeta,
      profileId: getRouteQueryText('profileId') || null,
      ruleProfileId: Number(getRouteQueryText('ruleProfileId') || 0) || null,
      profileScope: getRouteQueryText('profileScope'),
      profileKey: getRouteQueryText('profileKey'),
      configProfileId: getRouteQueryText('configProfileId'),
      configProfileName: getRouteQueryText('configProfileName'),
      installConfigProfileId: getRouteQueryText('installConfigProfileId'),
      installConfigProfileName: getRouteQueryText('installConfigProfileName'),
      installConfigProfileScope: getRouteQueryText('installConfigProfileScope'),
      installConfigSourceType: getRouteQueryText('installConfigSourceType'),
      ruleVersion: Number(getRouteQueryText('ruleVersion') || 0) || null
    }
  })
  const ficsitSourceMeta = computed(() => ({
    source: 'ficsit',
    sourceId: String(resolvedSteamAppId.value || '').trim(),
    appId: String(resolvedSteamAppId.value || '').trim()
  }))
  const modioSourceMeta = computed(() => ({
    source: 'modio',
    sourceId: String(resolvedModioGameId.value || '').trim(),
    sourceSlug: getRouteQueryText('nameId'),
    appId: String(resolvedModioAppId.value || '').trim()
  }))

  const thunderstoreEnabledCount = computed(
    () =>
      thunderstoreInstalledList.value.filter(
        (item) => Number(item?.installState ?? item?.isActive ?? 0) === 1
      ).length
  )
  const thunderstoreDisabledCount = computed(
    () =>
      thunderstoreInstalledList.value.filter(
        (item) => Number(item?.installState ?? item?.isActive ?? 0) !== 1
      ).length
  )
  const thunderstoreProfileSize = computed(() => {
    const current = (thunderstoreProfileSummary.value?.stats || []).find(
      (item) =>
        String(item?.profileName || '').toLowerCase() ===
        String(thunderstoreProfile.value || '').toLowerCase()
    )
    if (current) {
      return Number(current?.sizeBytes || 0)
    }
    return getInstalledSizeBytesByList(thunderstoreInstalledList.value)
  })
  const thunderstoreSummaryText = computed(() => {
    const stats = thunderstoreProfileSummary.value?.stats || []
    const totalProfiles = stats.length || thunderstoreProfileOptions.value.length
    const activeProfiles = stats.filter((item) => Number(item?.count || 0) > 0).length
    return uiText('ui.profilesValueProfilesWithModsValueTotalModsValueTotal', { value1: (formatNumber(totalProfiles)), value2: (formatNumber(activeProfiles)), value3: (formatNumber(thunderstoreProfileSummary.value?.totalCount || 0)), value4: (formatFileSize(thunderstoreProfileSummary.value?.totalSize || 0)) })
  })
  const thunderstoreSummaryExtraText = computed(
    () =>
      uiText('ui.currentProfileValueEnabledValueDisabledValue', { value1: (thunderstoreProfile.value), value2: (thunderstoreEnabledCount.value), value3: (thunderstoreDisabledCount.value) })
  )
  const thunderstoreProtocol = computed(() =>
    buildThunderstoreModManageProtocol({
      loading: thunderstoreBatchLoading.value || thunderstoreUninstallAllLoading.value,
      rows: thunderstoreInstalledList.value,
      uninstallingMap: thunderstoreOperationLoadingMap.value,
      togglingMap: thunderstoreTogglingMap.value,
      updatingMap: thunderstoreUpdatingMap.value,
      summaryText: thunderstoreSummaryText.value,
      summaryExtraText: thunderstoreSummaryExtraText.value,
      scopeLabel: '管理配置',
      scopeValue: thunderstoreProfile.value,
      scopeOptions: thunderstoreProfileOptions.value.map((item) => ({
        label: item === 'default' ? uiText('ui.valueDefault', { value1: (item) }) : item,
        value: item
      })),
      scopeDisabled:
        thunderstoreBatchLoading.value ||
        thunderstoreUninstallAllLoading.value ||
        Object.values(thunderstoreOperationLoadingMap.value || {}).some(Boolean) ||
        Object.values(thunderstoreTogglingMap.value || {}).some(Boolean) ||
        Object.values(thunderstoreUpdatingMap.value || {}).some(Boolean),
      scopeExtraText: uiText('ui.currentProfileSizeValue', { value1: (formatFileSize(thunderstoreProfileSize.value)) }),
      uninstallAllLoading: thunderstoreUninstallAllLoading.value,
      uninstallAllDisabled:
        thunderstoreUninstallAllLoading.value || thunderstoreInstalledList.value.length <= 0,
      toggleAllLoading: Object.values(thunderstoreTogglingMap.value || {}).some(Boolean),
      enabledCount: thunderstoreEnabledCount.value,
      disabledCount: thunderstoreDisabledCount.value,
      showRefresh: true
    })
  )
  const modioProtocol = computed(() =>
    buildModioModManageProtocol({
      loading: modioLoading.value || modioBatchLoading.value,
      rows: modioInstalledList.value,
      operationMap: {
        ...modioOperationLoadingMap.value,
        ...modioUpdatingMap.value
      },
      batchLoading: modioBatchLoading.value,
      gameName: getRouteQueryText('name') || current.value?.chineseTitle || 'Mod.io 游戏',
      gameLogoUrl: getRouteQueryText('cover'),
      workspaceValue: String(resolvedModioGameId.value || '--'),
      gamePath: getRouteQueryText('gamePath') || getRouteQueryText('rootPath'),
      gameStatusText: resolvedModioGameId.value ? '已识别 Mod.io 游戏' : '缺少 Mod.io 游戏 ID',
      gameStatusTone: resolvedModioGameId.value ? 'success' : 'warning',
      summaryText: uiText('ui.currentProfileContainsValueModIoMods', { value1: (modioInstalledList.value.length) }),
      scopeLabel: '管理配置',
      scopeValue: modioProfile.value,
      scopeOptions: modioProfileOptions.value,
      scopeDisabled: isManagedSourceProfileBusy.value,
      scopeExtraText: uiText('ui.currentProfileValue', { value1: (modioProfile.value) })
    })
  )

  const batchToggleType = ref('')
  const focusedCardKey = ref('')
  const selectedModKey = ref('')
  const systemConfig = ref({
    nexusApi: {
      apiKey: '',
      apiKeySource: '',
    },
    modioApi: {
      baseUrl: 'https://api.mod.io/v1',
      apiKey: ''
    },
    aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
  })
  const thunderstoreTranslationMap = ref({})
  const ficsitTranslationMap = ref({})
  const nexusTranslationMap = ref({})
  const modioTranslationMap = ref({})
  let thunderstoreTranslationToken = 0
  let ficsitTranslationToken = 0
  let nexusTranslationToken = 0
  let modioTranslationToken = 0
  let thunderstoreLoadToken = 0
  // 上一次成功读取的社区 + 配置；同一列表刷新时保留“可更新”记录，避免标签先消失再出现。
  let thunderstoreLoadedListKey = ''
  let routeActionHandled = false

  function normalizeSystemConfig(data) {
    const target = data && typeof data === 'object' ? data : {}
    const nexusApi = target.nexusApi && typeof target.nexusApi === 'object' ? target.nexusApi : {}
    const modioApi = target.modioApi && typeof target.modioApi === 'object' ? target.modioApi : {}
    return {
      ...target,
      nexusApi: normalizeNexusApiConfig(nexusApi),
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
    systemConfig.value = await applyEffectiveNexusApiConfig(
      normalizeSystemConfig(await requestSystemConfig())
    )
  }

  function normalizeTranslationKey(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
  }

  function createEmptyThunderstoreProfileSummary() {
    return {
      stats: [],
      totalCount: 0,
      totalSize: 0
    }
  }

  function safeParseObject(value = null) {
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

  function getLocalBindingMetadata(item = {}) {
    return safeParseObject(item?.metadata_json || item?.metadataJson || item?.metadata || {})
  }

  function isLocalBoundMod(item = {}) {
    const metadata = getLocalBindingMetadata(item)
    const flags = safeParseArray(item?.compat_flags || item?.compatFlags)
    return (
      String(item?.install_model || item?.installModel || '').trim() === 'bound' ||
      metadata.localBinding === true ||
      flags.includes('local_binding')
    )
  }

  function getLocalBindingItems(item = {}) {
    const metadata = getLocalBindingMetadata(item)
    return safeParseArray(metadata.items)
  }

  function getLocalBoundRecordId(item = {}) {
    return toSafeId(
      item?.id || item?.rowId || item?.recordId || item?.modRowId || item?.localBoundId
    )
  }

  function isLocalLibraryCard(cardOrRaw = {}) {
    const raw = cardOrRaw?.raw && typeof cardOrRaw.raw === 'object' ? cardOrRaw.raw : cardOrRaw
    return (
      String(cardOrRaw?.installModel || raw?.installModel || raw?.install_model || '').trim() ===
        'local-library' ||
      raw?.localLibrary === true ||
      String(raw?.sourceKind || raw?.source_kind || '').trim() === 'local_library'
    )
  }

  function getLocalLibraryItemId(item = {}) {
    return toSafeId(item?.id || item?.libraryItemId || item?.localLibraryItemId)
  }

  function getLocalLibraryMetadata(item = {}) {
    return safeParseObject(item?.metadata_json || item?.metadata || {})
  }

  function getLocalLibraryDisplayName(item = {}) {
    return toDisplayText(item?.display_name || item?.displayName || item?.name, '本地 Mod')
  }

  function getLocalLibrarySourcePlatform(item = {}) {
    return String(item?.source_platform || item?.sourcePlatform || '')
      .trim()
      .toLowerCase()
  }

  function getLocalLibraryNormalizedSource(item = {}) {
    const sourcePlatform = getLocalLibrarySourcePlatform(item)
    if (!sourcePlatform || sourcePlatform === 'local') {
      return ''
    }
    return normalizeSourceType(sourcePlatform)
  }

  function getLocalLibrarySourceLabel(item = {}) {
    const sourcePlatform = getLocalLibrarySourcePlatform(item)
    if (!sourcePlatform || sourcePlatform === 'local') {
      return uiText('ui.localAsset')
    }
    return getLocalBindingSourceLabel(normalizeSourceType(sourcePlatform), {
      source: sourcePlatform
    })
  }

  function getLocalLibraryProfileName(item = {}) {
    return normalizeManagedProfileName(item?.source_profile || item?.sourceProfile || 'default')
  }

  function getLocalLibraryGameId() {
    return Number(
      resolvedGameId.value ||
        boundManagementQuery.value?.backendGameId ||
        boundManagementQuery.value?.gameId ||
        current.value?.gId ||
        current.value?.id ||
        0
    )
  }

  function isLocalLibraryItemVisible(item = {}) {
    const source = getLocalLibraryNormalizedSource(item)
    if (source && source !== activeSource.value) {
      return false
    }

    const sourcePlatform = getLocalLibrarySourcePlatform(item)
    if (!sourcePlatform || sourcePlatform === 'local') {
      return true
    }

    return (
      getLocalLibraryProfileName(item) === normalizeManagedProfileName(getLocalBindingProfileName())
    )
  }

  function getVisibleLocalLibraryItems() {
    return localLibraryList.value.filter((item) => isLocalLibraryItemVisible(item))
  }

  function setLocalLibraryTaskLoading(itemId = 0, loading = false) {
    const id = String(itemId || '').trim()
    if (!id) return
    const nextMap = { ...(localLibraryTaskLoadingMap.value || {}) }
    if (loading) {
      nextMap[id] = true
    } else {
      delete nextMap[id]
    }
    localLibraryTaskLoadingMap.value = nextMap
  }

  async function loadLocalLibraryList() {
    const gameId = getLocalLibraryGameId()
    if (!gameId) {
      localLibraryList.value = []
      return
    }

    localLibraryLoading.value = true
    try {
      const result = await listLocalModLibrary({
        gameId,
        state: 'active'
      })
      localLibraryList.value = result?.success && Array.isArray(result.data) ? result.data : []
      if (result && result.success === false) {
        console.warn('[MOD_MANAGEMENT] 本地模组资产库读取失败', result.message)
      }
    } catch (error) {
      console.error('[MOD_MANAGEMENT] 本地模组资产库读取失败', error)
      localLibraryList.value = []
    } finally {
      localLibraryLoading.value = false
    }
  }

  const canUseModManagementAiTranslation = computed(() =>
    isAiTranslationAvailable(systemConfig.value)
  )

  function mergeTranslationResultMap(targetRef, resultMap = new Map()) {
    if (!(resultMap instanceof Map) || resultMap.size <= 0) {
      return
    }

    const nextMap = {
      ...(targetRef?.value || {})
    }

    resultMap.forEach((text, key) => {
      const safeKey = String(key || '').trim()
      if (!safeKey) return
      nextMap[safeKey] = String(text || '').trim()
    })

    targetRef.value = nextMap
  }

  async function queryInstalledTranslationCache(payload) {
    const translatedMap = await queryCachedTextBatchService(payload)
    const missingItems = payload.items.filter((item) => !translatedMap.has(item.id))
    if (!missingItems.length) return translatedMap

    // 列表自动翻译使用独立的 Edge 缓存键，保留手动翻译优先级并补读自动译文。
    try {
      const edgeMap = await queryCachedTextBatchService({
        ...payload,
        edgeOnly: true,
        items: missingItems
      })
      return new Map([...edgeMap, ...translatedMap])
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] 自动翻译缓存读取失败', error)
      return translatedMap
    }
  }

  function buildThunderstoreTitleTranslationKey(item = {}) {
    return `mod:${normalizeTranslationKey(item?.fullName || item?.id || item?.displayName || item?.name)}:title`
  }

  function buildThunderstoreSummaryTranslationKey(item = {}) {
    return `mod:${normalizeTranslationKey(item?.fullName || item?.id || item?.displayName || item?.name)}:summary`
  }

  function getThunderstoreDisplayTitle(item = {}) {
    return String(item?.displayName || item?.name || item?.fullName || '').trim()
  }

  function getThunderstoreTranslatableTitleText(item = {}) {
    return getThunderstoreDisplayTitle(item)
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function normalizeThunderstoreTranslatedTitleComparableText(text = '') {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '')
  }

  function buildFicsitTitleTranslationKey(item = {}) {
    return `mod:${normalizeTranslationKey(item?.modReference || item?.id || item?.name)}:title`
  }

  function buildFicsitSummaryTranslationKey(item = {}) {
    return `mod:${normalizeTranslationKey(item?.modReference || item?.id || item?.name)}:summary`
  }

  function buildNexusTitleTranslationKey(item = {}) {
    return `mod:${Number(item?.modId || item?.id || 0)}:title`
  }

  function buildNexusSummaryTranslationKey(item = {}) {
    return `mod:${Number(item?.modId || item?.id || 0)}:summary`
  }

  function getThunderstoreTranslatedTitle(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = getThunderstoreDisplayTitle(item)
    const translated = String(
      thunderstoreTranslationMap.value[buildThunderstoreTitleTranslationKey(item)] || ''
    ).trim()
    return translated &&
      normalizeThunderstoreTranslatedTitleComparableText(translated) !==
        normalizeThunderstoreTranslatedTitleComparableText(original)
      ? translated
      : ''
  }

  function getThunderstoreTranslatedDescription(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.description || '').trim()
    const translated = String(
      thunderstoreTranslationMap.value[buildThunderstoreSummaryTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function getFicsitTranslatedTitle(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.name || '').trim()
    const translated = String(
      ficsitTranslationMap.value[buildFicsitTitleTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function getFicsitTranslatedDescription(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.shortDescription || item?.fullDescription || '').trim()
    const translated = String(
      ficsitTranslationMap.value[buildFicsitSummaryTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function getNexusTranslatedTitle(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.displayName || item?.name || '').trim()
    const translated = String(
      nexusTranslationMap.value[buildNexusTitleTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function getNexusTranslatedDescription(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.description || item?.summary || '').trim()
    const translated = String(
      nexusTranslationMap.value[buildNexusSummaryTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function buildModioTitleTranslationKey(item = {}) {
    return `mod:${Number(item?.modId || 0)}:title`
  }

  function getModioTranslatedTitle(item = {}) {
    if (!canUseModManagementAiTranslation.value) return ''
    const original = String(item?.displayName || item?.name || '').trim()
    const translated = String(
      modioTranslationMap.value[buildModioTitleTranslationKey(item)] || ''
    ).trim()
    return translated && translated !== original ? translated : ''
  }

  function getModMetadata(item = {}) {
    return safeParseObject(item?.metadata_json || item?.metadata)
  }

  function getEmbeddedTranslatedTitle(item = {}) {
    const metadata = getModMetadata(item)
    const original = String(item?.displayName || item?.name || item?.fullName || '').trim()
    const translated = [
      item?.translatedTitle,
      item?.translatedName,
      item?.nameZh,
      item?.nameCn,
      item?.titleZh,
      item?.titleCn,
      item?.chineseName,
      metadata?.translatedTitle,
      metadata?.translatedName,
      metadata?.nameZh,
      metadata?.nameCn,
      metadata?.titleZh,
      metadata?.titleCn,
      metadata?.chineseName
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean)

    return translated && normalizeTranslationKey(translated) !== normalizeTranslationKey(original)
      ? translated
      : ''
  }

  function getEmbeddedTranslatedDescription(item = {}) {
    const metadata = getModMetadata(item)
    const original = String(
      item?.description || item?.summary || item?.shortDescription || item?.fullDescription || ''
    ).trim()
    const translated = [
      item?.translatedDescription,
      item?.translatedSummary,
      item?.descriptionZh,
      item?.descriptionCn,
      item?.summaryZh,
      item?.summaryCn,
      metadata?.translatedDescription,
      metadata?.translatedSummary,
      metadata?.descriptionZh,
      metadata?.descriptionCn,
      metadata?.summaryZh,
      metadata?.summaryCn
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean)

    return translated && translated !== original ? translated : ''
  }

  function getTranslatedTitleBySource(item = {}, sourceType = activeSource.value) {
    if (!canTranslateModContent()) return ''
    const embeddedTranslatedTitle = getEmbeddedTranslatedTitle(item)
    if (embeddedTranslatedTitle) {
      return embeddedTranslatedTitle
    }

    if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
      return getThunderstoreTranslatedTitle(item)
    }
    if (sourceType === SOURCE_TYPE.FICSIT) {
      return getFicsitTranslatedTitle(item)
    }
    if (sourceType === SOURCE_TYPE.NEXUS) {
      return getNexusTranslatedTitle(item)
    }
    if (sourceType === SOURCE_TYPE.MODIO) {
      return getModioTranslatedTitle(item)
    }
    return ''
  }

  function getTranslatedDescriptionBySource(item = {}, sourceType = activeSource.value) {
    if (!canTranslateModContent()) return ''
    const embeddedTranslatedDescription = getEmbeddedTranslatedDescription(item)
    if (embeddedTranslatedDescription) {
      return embeddedTranslatedDescription
    }

    if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
      return getThunderstoreTranslatedDescription(item)
    }
    if (sourceType === SOURCE_TYPE.FICSIT) {
      return getFicsitTranslatedDescription(item)
    }
    if (sourceType === SOURCE_TYPE.NEXUS) {
      return getNexusTranslatedDescription(item)
    }
    return ''
  }

  function buildListDisplayTitle(translatedTitle = '', originalTitle = '', fallback = '--') {
    const safeTranslatedTitle = String(translatedTitle || '').trim()
    const safeOriginalTitle = String(originalTitle || '').trim()

    if (
      safeTranslatedTitle &&
      safeOriginalTitle &&
      normalizeTranslationKey(safeTranslatedTitle).includes(
        normalizeTranslationKey(safeOriginalTitle)
      )
    ) {
      return safeTranslatedTitle
    }

    if (
      safeTranslatedTitle &&
      safeOriginalTitle &&
      normalizeTranslationKey(safeTranslatedTitle) !== normalizeTranslationKey(safeOriginalTitle)
    ) {
      return `${safeTranslatedTitle}（${safeOriginalTitle}）`
    }

    return toDisplayText(safeTranslatedTitle || safeOriginalTitle, fallback)
  }

  async function hydrateThunderstoreInstalledTranslations(list = thunderstoreInstalledList.value) {
    const safeList = Array.isArray(list) ? list : []
    thunderstoreTranslationToken += 1
    const currentToken = thunderstoreTranslationToken

    if (!canUseModManagementAiTranslation.value || !safeList.length) {
      return
    }

    const requestItems = safeList.flatMap((item) => {
      const displayTitle = getThunderstoreDisplayTitle(item)
      const title = getThunderstoreTranslatableTitleText(item) || displayTitle
      const description = String(item?.description || '').trim()
      const items = []

      if (title) {
        items.push({
          id: buildThunderstoreTitleTranslationKey(item),
          text: title,
          kind: 'mod_name',
          context: uiText('ui.communityValueOriginalTitleValue', { value1: (thunderstoreCommunity.value || 'Thunderstore'), value2: (displayTitle || '--') })
        })
      }

      if (description) {
        items.push({
          id: buildThunderstoreSummaryTranslationKey(item),
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.communityValueModValue', { value1: (thunderstoreCommunity.value || 'Thunderstore'), value2: (displayTitle || '--') })
        })
      }

      return items
    })

    if (!requestItems.length) {
      return
    }

    try {
      const translatedMap = await queryInstalledTranslationCache({
        systemConfig: systemConfig.value,
        source: 'thunderstore',
        scene: 'mod_list_card',
        items: requestItems
      })

      if (currentToken !== thunderstoreTranslationToken || !translatedMap.size) {
        return
      }

      mergeTranslationResultMap(thunderstoreTranslationMap, translatedMap)
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] Thunderstore 翻译缓存读取失败', error)
    }
  }

  async function hydrateFicsitInstalledTranslations(list = ficsitInstalledList.value) {
    const safeList = Array.isArray(list) ? list : []
    ficsitTranslationToken += 1
    const currentToken = ficsitTranslationToken

    if (!canUseModManagementAiTranslation.value || !safeList.length) {
      return
    }

    const requestItems = safeList.flatMap((item) => {
      const title = String(item?.name || '').trim()
      const description = String(item?.shortDescription || item?.fullDescription || '').trim()
      const items = []

      if (title) {
        items.push({
          id: buildFicsitTitleTranslationKey(item),
          text: title,
          kind: 'mod_name',
          context: uiText('ui.gameValueVariant3', { value1: (current.value?.chineseTitle || 'Ficsit') })
        })
      }

      if (description) {
        items.push({
          id: buildFicsitSummaryTranslationKey(item),
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.gameValueModValue', { value1: (current.value?.chineseTitle || 'Ficsit'), value2: (title || '--') })
        })
      }

      return items
    })

    if (!requestItems.length) {
      return
    }

    try {
      const translatedMap = await queryInstalledTranslationCache({
        systemConfig: systemConfig.value,
        source: 'ficsit',
        scene: 'mod_list_card',
        items: requestItems
      })

      if (currentToken !== ficsitTranslationToken || !translatedMap.size) {
        return
      }

      mergeTranslationResultMap(ficsitTranslationMap, translatedMap)
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] Ficsit 翻译缓存读取失败', error)
    }
  }

  async function hydrateNexusInstalledTranslations(list = nexusInstalledList.value) {
    const safeList = Array.isArray(list) ? list : []
    nexusTranslationToken += 1
    const currentToken = nexusTranslationToken

    if (!canUseModManagementAiTranslation.value || !safeList.length) {
      return
    }

    const requestItems = safeList.flatMap((item) => {
      const modId = Number(item?.modId || item?.id || 0)
      const title = String(item?.displayName || item?.name || '').trim()
      const description = String(item?.description || item?.summary || '').trim()
      const items = []

      if (modId <= 0) {
        return items
      }

      if (title) {
        items.push({
          id: buildNexusTitleTranslationKey(item),
          text: title,
          kind: 'mod_name',
          context: uiText('ui.gameValueVariant3', { value1: (current.value?.chineseTitle || resolvedNexusDomainName.value || 'Nexus') })
        })
      }

      if (description) {
        items.push({
          id: buildNexusSummaryTranslationKey(item),
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.gameValueModValue', { value1: (current.value?.chineseTitle || resolvedNexusDomainName.value || 'Nexus'), value2: (title || '--') })
        })
      }

      return items
    })

    if (!requestItems.length) {
      return
    }

    try {
      const translatedMap = await queryInstalledTranslationCache({
        systemConfig: systemConfig.value,
        source: 'nexus',
        scene: 'mod_list_card',
        items: requestItems
      })

      if (currentToken !== nexusTranslationToken || !translatedMap.size) {
        return
      }

      mergeTranslationResultMap(nexusTranslationMap, translatedMap)
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] Nexus 翻译缓存读取失败', error)
    }
  }

  function hydrateActiveSourceTranslations() {
    if (!canUseModManagementAiTranslation.value) {
      return Promise.resolve()
    }

    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return hydrateThunderstoreInstalledTranslations()
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return hydrateFicsitInstalledTranslations()
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return hydrateNexusInstalledTranslations()
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return hydrateModioInstalledTranslations()
    }
    return Promise.resolve()
  }

  async function hydrateModioInstalledTranslations(list = modioInstalledList.value) {
    const currentToken = ++modioTranslationToken
    if (!canUseModManagementAiTranslation.value) return
    const items = (Array.isArray(list) ? list : [])
      .filter((item) => Number(item?.modId || 0) > 0 && !isLocalBoundMod(item))
      .map((item) => ({
        id: buildModioTitleTranslationKey(item),
        text: String(item?.name || item?.displayName || '').trim(),
        kind: 'mod_name',
        context: uiText('ui.gameValueVariant3', { value1: (getRouteQueryText('name') || current.value?.chineseTitle || 'Mod.io') })
      }))
      .filter((item) => item.text)
    if (!items.length) return

    try {
      const translatedMap = await queryInstalledTranslationCache({
        systemConfig: systemConfig.value,
        source: 'modio',
        scene: 'mod_list_card',
        items
      })
      if (currentToken !== modioTranslationToken) return
      mergeTranslationResultMap(modioTranslationMap, translatedMap)
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] Mod.io 翻译缓存读取失败', error)
    }
  }

  watch(canUseModManagementAiTranslation, (available) => {
    if (available) void hydrateActiveSourceTranslations()
  })

  const currentInstalledCount = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return thunderstoreInstalledList.value.length + thunderstoreLocalBoundList.value.length
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return ficsitInstalledList.value.length
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return nexusInstalledList.value.length
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return modioInstalledList.value.length
    }
    return activeListCount.value
  })

  const currentHasMods = computed(() => currentInstalledCount.value > 0)

  const currentEnabledCount = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return (
        thunderstoreEnabledCount.value +
        thunderstoreLocalBoundList.value.filter((item) => Number(item?.is_active || 0) === 1).length
      )
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return ficsitInstalledList.value.filter((item) => Number(item?.installState || 0) === 1)
        .length
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return nexusInstalledList.value.filter((item) => !!item?.isActive).length
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return modioInstalledList.value.filter((item) => !!item?.isActive).length
    }
    return activeList.value.filter((item) => Number(item?.is_active || 0) === 1).length
  })

  const currentDisabledCount = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return (
        thunderstoreDisabledCount.value +
        thunderstoreLocalBoundList.value.filter((item) => Number(item?.is_active || 0) !== 1).length
      )
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return ficsitInstalledList.value.filter((item) => Number(item?.installState || 0) !== 1)
        .length
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return nexusInstalledList.value.filter((item) => !item?.isActive).length
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return modioInstalledList.value.filter((item) => !item?.isActive).length
    }
    return activeList.value.filter((item) => Number(item?.is_active || 0) !== 1).length
  })

  const currentUpdatableCount = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return thunderstoreUpdateRecords.value.length
    }
    if (activeSource.value === SOURCE_TYPE.VERTEX) {
      return activeList.value.filter((item) => !!item?.isUpdate).length
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return ficsitInstalledList.value.filter((item) => !!item?.hasUpdate).length
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return nexusInstalledList.value.filter((item) => !!item?.hasUpdate).length
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return modioInstalledList.value.filter((item) => !!item?.hasUpdate).length
    }
    return 0
  })

  function filterToolbarPrimaryActions(actions = []) {
    return (Array.isArray(actions) ? actions : []).filter((item) => {
      const key = String(item?.key || '').trim()
      if (key === 'enable-all') {
        return currentDisabledCount.value > 0
      }
      if (key === 'disable-all') {
        return currentEnabledCount.value > 0
      }
      if (key === 'update-all') {
        return currentUpdatableCount.value > 0
      }
      return true
    })
  }

  function buildManagedOfflinePackToolbarActions() {
    return []
  }

  const workspaceTabs = computed(() => {
    if (activeSource.value !== SOURCE_TYPE.VERTEX) {
      return []
    }

    const tabs = [
      {
        key: 'client',
        labelKey: 'ui.client', get label() { return uiText('ui.client') },
        desc: '本地运行目录',
        count: clientList.value.length
      }
    ]

    if (current.value?.is_server_installed) {
      tabs.push({
        key: 'server',
        labelKey: 'ui.server', get label() { return uiText('ui.server') },
        desc: '服务器部署目录',
        count: serverList.value.length
      })
    }

    return tabs
  })

  const currentListLoading = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return (
        sourceLoading.value ||
        localLibraryLoading.value ||
        thunderstoreBatchLoading.value ||
        thunderstoreUninstallAllLoading.value
      )
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return sourceLoading.value || localLibraryLoading.value || ficsitLoading.value
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return (
        sourceLoading.value ||
        localLibraryLoading.value ||
        nexusLoading.value ||
        nexusBatchLoading.value
      )
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return (
        sourceLoading.value ||
        localLibraryLoading.value ||
        modioLoading.value ||
        modioBatchLoading.value
      )
    }
    return sourceLoading.value || localLibraryLoading.value || vertexLoading.value
  })

  const toolbarPrimaryActions = computed(() => {
    const localManagerAction = {
      key: 'manage-local-mod',
      labelKey: 'localMod.title', get label() { return uiText('localMod.title') },
      tone: 'accent',
      disabled: currentListLoading.value || isBatchUninstalling.value
    }
    const localAssetActions = [localManagerAction]
    const emptyActionKeys = new Set([
      'refresh',
      'manage-local-mod',
      'bind-local',
      'import-local-mod',
      'import-offline-pack'
    ])
    const offlineFileActions = buildManagedOfflinePackToolbarActions()

    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      const actions = [
        ...localAssetActions,
        ...offlineFileActions,
        {
          key: 'enable-all',
          labelKey: 'ui.enableAll', get label() { return uiText('ui.enableAll') },
          tone: 'accent',
          disabled: thunderstoreProtocol.value.batch.toggleAll.enableDisabled
        },
        {
          key: 'disable-all',
          labelKey: 'ui.disableAll', get label() { return uiText('ui.disableAll') },
          tone: 'default',
          disabled: thunderstoreProtocol.value.batch.toggleAll.disableDisabled
        },
        {
          key: 'update-all',
          labelKey: 'ui.updateAll', get label() { return uiText('ui.updateAll') },
          tone: 'accent',
          disabled:
            thunderstoreBatchLoading.value ||
            thunderstoreUninstallAllLoading.value ||
            !thunderstoreUpdateRecords.value.length
        },
        {
          key: 'check-updates',
          loading: updateCheckLoading.value,
          label: updateCheckLoading.value ? uiText('ui.checkingForUpdates') : uiText('ui.checkModUpdates'),
          tone: 'default',
          disabled:
            updateCheckLoading.value ||
            thunderstoreBatchLoading.value ||
            thunderstoreUninstallAllLoading.value
        },
        {
          key: 'refresh',
          labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') },
          tone: 'default',
          disabled: thunderstoreBatchLoading.value || thunderstoreUninstallAllLoading.value
        }
      ]
      return currentHasMods.value
        ? filterToolbarPrimaryActions(actions)
        : actions.filter((item) => emptyActionKeys.has(item.key))
    }

    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      const actions = [
        ...localAssetActions,
        ...offlineFileActions,
        {
          key: 'enable-all',
          labelKey: 'ui.enableAll', get label() { return uiText('ui.enableAll') },
          tone: 'accent',
          disabled: ficsitLoading.value || !ficsitInstalledList.value.length
        },
        {
          key: 'disable-all',
          labelKey: 'ui.disableAll', get label() { return uiText('ui.disableAll') },
          tone: 'default',
          disabled: ficsitLoading.value || !ficsitInstalledList.value.length
        },
        {
          key: 'check-updates',
          loading: updateCheckLoading.value,
          label: updateCheckLoading.value ? uiText('ui.checkingForUpdates') : uiText('ui.checkModUpdates'),
          tone: 'default',
          disabled:
            updateCheckLoading.value || ficsitLoading.value || !ficsitInstalledList.value.length
        },
        {
          key: 'update-all',
          labelKey: 'ui.updateAll', get label() { return uiText('ui.updateAll') },
          tone: 'accent',
          disabled:
            ficsitLoading.value ||
            updateCheckLoading.value ||
            !ficsitInstalledList.value.some((item) => !!item?.hasUpdate)
        },
        {
          key: 'refresh',
          labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') },
          tone: 'default',
          disabled: ficsitLoading.value
        }
      ]
      return currentHasMods.value
        ? filterToolbarPrimaryActions(actions)
        : actions.filter((item) => emptyActionKeys.has(item.key))
    }

    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      const actions = [
        ...localAssetActions,
        ...offlineFileActions,
        {
          key: 'enable-all',
          labelKey: 'ui.enableAll', get label() { return uiText('ui.enableAll') },
          tone: 'accent',
          disabled:
            nexusLoading.value || nexusBatchLoading.value || !nexusInstalledList.value.length
        },
        {
          key: 'disable-all',
          labelKey: 'ui.disableAll', get label() { return uiText('ui.disableAll') },
          tone: 'default',
          disabled:
            nexusLoading.value || nexusBatchLoading.value || !nexusInstalledList.value.length
        },
        {
          key: 'check-updates',
          loading: updateCheckLoading.value,
          label: updateCheckLoading.value ? uiText('ui.checkingForUpdates') : uiText('ui.checkModUpdates'),
          tone: 'default',
          disabled:
            updateCheckLoading.value ||
            nexusLoading.value ||
            nexusBatchLoading.value ||
            !nexusInstalledList.value.length
        },
        {
          key: 'update-all',
          labelKey: 'ui.updateAll', get label() { return uiText('ui.updateAll') },
          tone: 'accent',
          disabled:
            nexusLoading.value ||
            nexusBatchLoading.value ||
            updateCheckLoading.value ||
            !nexusInstalledList.value.some((item) => !!item?.hasUpdate)
        },
        {
          key: 'refresh',
          labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') },
          tone: 'default',
          disabled: nexusLoading.value || nexusBatchLoading.value
        }
      ]
      return currentHasMods.value
        ? filterToolbarPrimaryActions(actions)
        : actions.filter((item) => emptyActionKeys.has(item.key))
    }

    if (activeSource.value === SOURCE_TYPE.MODIO) {
      const actions = [
        ...localAssetActions,
        ...offlineFileActions,
        {
          key: 'enable-all',
          labelKey: 'ui.enableAll', get label() { return uiText('ui.enableAll') },
          tone: 'accent',
          disabled:
            modioLoading.value || modioBatchLoading.value || !modioInstalledList.value.length
        },
        {
          key: 'disable-all',
          labelKey: 'ui.disableAll', get label() { return uiText('ui.disableAll') },
          tone: 'default',
          disabled:
            modioLoading.value || modioBatchLoading.value || !modioInstalledList.value.length
        },
        {
          key: 'check-updates',
          loading: updateCheckLoading.value,
          label: updateCheckLoading.value ? uiText('ui.checkingForUpdates') : uiText('ui.checkModUpdates'),
          tone: 'default',
          disabled:
            updateCheckLoading.value ||
            modioLoading.value ||
            modioBatchLoading.value ||
            !modioInstalledList.value.length
        },
        {
          key: 'update-all',
          labelKey: 'ui.updateAll', get label() { return uiText('ui.updateAll') },
          tone: 'accent',
          disabled:
            modioLoading.value ||
            modioBatchLoading.value ||
            updateCheckLoading.value ||
            !modioInstalledList.value.some((item) => !!item?.hasUpdate)
        },
        {
          key: 'refresh',
          labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') },
          tone: 'default',
          disabled: modioLoading.value || modioBatchLoading.value
        }
      ]
      return currentHasMods.value
        ? filterToolbarPrimaryActions(actions)
        : actions.filter((item) => emptyActionKeys.has(item.key))
    }

    const actions = [
      ...localAssetActions,
      {
        key: 'enable-all',
        labelKey: 'ui.enableAll', get label() { return uiText('ui.enableAll') },
        tone: 'accent',
        disabled: isBatchUninstalling.value || vertexLoading.value || !activeListCount.value
      },
      {
        key: 'disable-all',
        labelKey: 'ui.disableAll', get label() { return uiText('ui.disableAll') },
        tone: 'default',
        disabled: isBatchUninstalling.value || vertexLoading.value || !activeListCount.value
      },
      {
        key: 'export-legacy-records',
        labelKey: 'ui.exportLegacyRecords', get label() { return uiText('ui.exportLegacyRecords') },
        tone: 'default',
        disabled: vertexLoading.value || !activeListCount.value
      },
      {
        key: 'refresh',
        labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') },
        tone: 'default',
        disabled: isBatchUninstalling.value || vertexLoading.value
      }
    ]
    return currentHasMods.value
      ? filterToolbarPrimaryActions(actions)
      : actions.filter((item) => emptyActionKeys.has(item.key))
  })

  const toolbarDangerActions = computed(() => {
    if (!currentHasMods.value) {
      return []
    }

    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return [
        {
          key: 'delete-all',
          labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
          tone: 'danger',
          disabled:
            thunderstoreBatchLoading.value ||
            thunderstoreUninstallAllLoading.value ||
            !thunderstoreInstalledList.value.length
        }
      ]
    }

    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return [
        {
          key: 'delete-all',
          labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
          tone: 'danger',
          disabled: ficsitLoading.value || !ficsitInstalledList.value.length
        }
      ]
    }

    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return [
        {
          key: 'delete-all',
          labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
          tone: 'danger',
          disabled:
            nexusLoading.value || nexusBatchLoading.value || !nexusInstalledList.value.length
        }
      ]
    }

    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return [
        {
          key: 'delete-all',
          labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
          tone: 'danger',
          disabled:
            modioLoading.value || modioBatchLoading.value || !modioInstalledList.value.length
        }
      ]
    }

    return [
      {
        key: 'delete-all',
        labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
        tone: 'danger',
        disabled: isBatchUninstalling.value || vertexLoading.value || !activeListCount.value
      }
    ]
  })

  const toolbarScopeText = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return uiText('ui.currentProfileUsesValue', { value1: (formatFileSize(thunderstoreProfileSize.value)) })
    }
    if (isManagedSourceProfileSource(activeSource.value)) {
      return uiText('ui.currentProfileValueValueMods', { value1: (getManagedSourceProfileValue(activeSource.value)), value2: (formatNumber(
        getManagedSourceProfileCount(
          activeSource.value,
          getManagedSourceProfileValue(activeSource.value)
        )
      )) })
    }
    return ''
  })

  const currentEmptyState = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return {
        get title() { return uiText('ui.noModsInstalledInTheCurrentProfile') },
        desc: '可以先从 Thunderstore 模组页安装内容，再回到这里统一管理。'
      }
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return {
        get title() { return uiText('ui.noFicsitModsInstalled') },
        desc: '当前游戏下还没有可管理的 Ficsit 模组。'
      }
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return {
        get title() { return uiText('ui.noNexusModsInstalled') },
        desc: '可前往 Nexus 预览页安装模组后再来管理。'
      }
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return {
        get title() { return uiText('ui.noModIoModsInstalled') },
        desc: '可前往 Mod.io 模组页安装内容，再回到这里统一管理。'
      }
    }
    return {
      title: uiText('ui.noValueModsInstalledYet', { value1: (activeTabLabel.value) }),
      desc: '当前工作区没有可管理的模组，安装完成后会出现在这里。'
    }
  })

  const sideOverviewPills = computed(() =>
    [
      {
        labelKey: 'tools.installed', get label() { return uiText('tools.installed') },
        value: formatNumber(currentInstalledCount.value)
      },
      {
        labelKey: 'ui.enabled', get label() { return uiText('ui.enabled') },
        value: formatNumber(currentEnabledCount.value)
      },
      {
        labelKey: 'ui.disabled', get label() { return uiText('ui.disabled') },
        value: formatNumber(currentDisabledCount.value)
      },
      currentUpdatableCount.value > 0
        ? {
            labelKey: 'modBrowser.updateAvailable', get label() { return uiText('modBrowser.updateAvailable') },
            value: formatNumber(currentUpdatableCount.value)
          }
        : null
    ].filter(Boolean)
  )

  const prioritySortSupported = computed(
    () =>
      activeSource.value !== SOURCE_TYPE.THUNDERSTORE &&
      !normalizedModSearchKeyword.value &&
      !currentListLoading.value &&
      !isBatchUninstalling.value &&
      !priorityOrderSaving.value
  )

  const prioritySortHintText = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return ''
    }
    if (normalizedModSearchKeyword.value) {
      return uiText('ui.clearSearchToDragAndReorder')
    }
    return priorityOrderDirty.value
      ? uiText('ui.orderChangedSaveToApply')
      : uiText('ui.orderDeterminesFileOverwritePriorityLowerValuesHaveHigherPriority')
  })

  const currentDisplayEmptyState = computed(() => {
    if (normalizedModSearchKeyword.value && currentCards.value.length > 0) {
      return {
        get title() { return uiText('ui.noMatchingModsFound') },
        desc: '尝试更换关键词，或清空搜索后查看当前来源的全部模组。'
      }
    }
    return currentEmptyState.value
  })

  function getActivePriorityList() {
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return ficsitInstalledList.value
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return nexusInstalledList.value
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return modioInstalledList.value
    }
    return activeTab.value === 'client' ? clientList.value : serverList.value
  }

  function setActivePriorityList(nextList = []) {
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      ficsitInstalledList.value = nextList
      return
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      nexusInstalledList.value = nextList
      return
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      modioInstalledList.value = nextList
      return
    }
    if (activeTab.value === 'client') {
      clientList.value = nextList
    } else {
      serverList.value = nextList
    }
  }

  function applyDisplayPriorityOrder(list = []) {
    return (Array.isArray(list) ? list : []).map((item, index) => ({
      ...item,
      priorityOrder: index,
      priority_order: index
    }))
  }

  function getCardRecordId(card = {}) {
    return Number(card?.raw?.id || 0)
  }

  function movePriorityRecord(fromCard = {}, toCard = {}) {
    if (!prioritySortSupported.value) {
      return
    }

    const fromId = getCardRecordId(fromCard)
    const toId = getCardRecordId(toCard)
    if (!fromId || !toId || fromId === toId) {
      return
    }

    const currentList = getActivePriorityList()
    const fromIndex = currentList.findIndex((item) => Number(item?.id || 0) === fromId)
    const toIndex = currentList.findIndex((item) => Number(item?.id || 0) === toId)
    if (fromIndex < 0 || toIndex < 0) {
      return
    }

    const nextList = [...currentList]
    const [moved] = nextList.splice(fromIndex, 1)
    nextList.splice(toIndex, 0, moved)
    setActivePriorityList(applyDisplayPriorityOrder(nextList))
    priorityOrderDirty.value = true
  }

  function handlePriorityDragStart(card = {}, event = null) {
    if (!prioritySortSupported.value) {
      event?.preventDefault?.()
      return
    }
    priorityDragKey.value = String(card?.key || '').trim()
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', priorityDragKey.value)
    }
  }

  function handlePriorityDragOver(card = {}, event = null) {
    if (!prioritySortSupported.value || !priorityDragKey.value) {
      return
    }
    if (String(card?.key || '') !== priorityDragKey.value) {
      event?.preventDefault?.()
    }
  }

  function handlePriorityDrop(card = {}, event = null) {
    if (!prioritySortSupported.value || !priorityDragKey.value) {
      priorityDragKey.value = ''
      return
    }
    event?.preventDefault?.()
    const fromCard = currentCards.value.find((item) => item.key === priorityDragKey.value)
    priorityDragKey.value = ''
    if (!fromCard) {
      return
    }
    movePriorityRecord(fromCard, card)
  }

  function handlePriorityDragEnd() {
    priorityDragKey.value = ''
  }

  async function savePriorityOrder() {
    if (!priorityOrderDirty.value || priorityOrderSaving.value) {
      return
    }

    const ids = getActivePriorityList()
      .map((item) => Number(item?.id || 0))
      .filter((id) => id > 0)
    if (!ids.length) {
      $message.warning(uiMessage('ui.noOrderRecordsAvailableToSave'))
      return
    }

    priorityOrderSaving.value = true
    try {
      const payload = sanitizeIpcPayload({
        ids,
        source: activeSource.value,
        endpointType: activeTab.value === 'server' ? 1 : 0
      })

      const result =
        activeSource.value === SOURCE_TYPE.FICSIT
          ? await saveFicsitModPriorityOrder(payload)
          : activeSource.value === SOURCE_TYPE.NEXUS
            ? await saveNexusModPriorityOrder(payload)
            : await invokeIpc('saveModPriorityOrder', payload)
      const taskResult = result?.result || result
      if (result?.success === false || taskResult?.success === false) {
        $message.error(result?.message || taskResult?.message || '排序保存失败')
        return
      }

      priorityOrderDirty.value = false
      $message.success(taskResult?.message || '排序已保存')
      await loadActiveSourceData({ preserveError: true })
    } catch (error) {
      console.error('保存模组排序失败', error)
      $message.error(String(error?.message || '排序保存失败'))
    } finally {
      priorityOrderSaving.value = false
    }
  }

  function resetPriorityOrder() {
    if (!priorityOrderDirty.value || priorityOrderSaving.value) {
      return
    }
    priorityOrderDirty.value = false
    refreshCurrentSource()
  }

  // === 选中模组状态管理 ===

  // 构建右侧详情面板数据

  // 构建右侧详情的操作按钮

  // 选择模组

  // 列表项点击启用/禁用
  function handleListItemToggle(card, checked) {
    handleCardToggle({ card, checked })
  }

  // 列表项点击删除
  function handleListItemDelete(card) {
    handleCardAction({ card, key: 'delete' })
  }

  // 详情区操作按钮
  function handleDetailAction(card, actionKey) {
    if (actionKey === 'open-install-root') return openManagedModLocation(card.raw)
    return handleCardAction({ card, key: actionKey })
  }

  // 详情区删除
  function handleDetailDelete(card) {
    handleCardAction({ card, key: 'delete' })
  }

  // 详情区启用/禁用
  function handleDetailToggle(card, checked) {
    handleCardToggle({ card, checked })
  }

  function setFocusedCard(payload = '') {
    if (typeof payload === 'string') {
      focusedCardKey.value = payload.trim()
      return
    }
    focusedCardKey.value = String(payload?.key || '').trim()
  }

  function refreshCurrentSource(forceSourceStatusCheck = false) {
    loadActiveSourceData({ preserveError: true, forceSourceStatusCheck }).then()
  }

  function handleToolbarAction(actionKey = '') {
    const key = String(actionKey || '').trim()
    if (!key) {
      return
    }

    if (key === 'refresh') {
      refreshCurrentSource(true)
      return
    }
    if (key === 'manage-local-mod' || key === 'bind-local' || key === 'import-local-mod') {
      localModManagerDialog.value = true
      return
    }
    if (key === 'export-legacy-records') {
      invokeIpc('legacy-mod:export-records', { appId: resolvedSteamAppId.value, gameRowId: route.query.legacyGameRowId }).then((result) => {
        if (result?.success) $message.success(result.message)
        else if (!result?.canceled) $message.warning(result?.message || '导出失败')
      }).catch((error) => $message.error(error.message || '导出失败'))
      return
    }
    if (key === 'check-updates') {
      checkCurrentSourceUpdates()
      return
    }

    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      if (key === 'enable-all') {
        toggleThunderstoreAll(true)
        return
      }
      if (key === 'disable-all') {
        toggleThunderstoreAll(false)
        return
      }
      if (key === 'update-all') {
        updateThunderstoreAll()
        return
      }
      if (key === 'delete-all') {
        uninstallThunderstoreAll()
      }
      return
    }

    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      if (key === 'enable-all') {
        toggleFicsitAll(true)
        return
      }
      if (key === 'disable-all') {
        toggleFicsitAll(false)
        return
      }
      if (key === 'update-all') {
        updateFicsitAll()
        return
      }
      if (key === 'delete-all') {
        uninstallFicsitAll()
      }
      return
    }

    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      if (key === 'enable-all') {
        toggleNexusAll(true)
        return
      }
      if (key === 'disable-all') {
        toggleNexusAll(false)
        return
      }
      if (key === 'update-all') {
        updateNexusAll()
        return
      }
      if (key === 'delete-all') {
        uninstallNexusAll()
      }
      return
    }

    if (activeSource.value === SOURCE_TYPE.MODIO) {
      if (key === 'enable-all') {
        toggleModioAll(true)
        return
      }
      if (key === 'disable-all') {
        toggleModioAll(false)
        return
      }
      if (key === 'update-all') {
        updateModioAll()
        return
      }
      if (key === 'delete-all') {
        uninstallModioAll()
      }
      return
    }

    if (key === 'enable-all') {
      batchToggleAll(true)
      return
    }
    if (key === 'disable-all') {
      batchToggleAll(false)
      return
    }
    if (key === 'delete-all') {
      batchUninstallAll()
      return
    }
    if (key === 'update-all') {
      updateVertexAll()
    }
  }

  async function toggleLocalBoundMod(item = {}, checked = false) {
    const channel = checked ? 'local-bound-mod:enable' : 'local-bound-mod:disable'
    const recordId = getLocalBoundRecordId(item)
    if (!recordId) {
      $message.error(uiMessage('ui.theManagedInPlaceRecordHasNoDatabaseRowID'))
      return
    }

    try {
      const result = await invokeIpc(channel, { id: recordId })
      if (result?.success) {
        $message.success(result.message || (checked ? '原地接管模组已启用' : '原地接管模组已禁用'))
        refreshCurrentSource()
        return
      }
      $message.error(result?.message || '原地接管模组状态切换失败')
    } catch (error) {
      console.error('原地接管模组状态切换失败', error)
      $message.error(String(error?.message || '原地接管模组状态切换失败'))
    }
  }

  function getLocalBindingOpenPath(item = {}) {
    const items = getLocalBindingItems(item)
    const first = items[0] || {}
    return String(first.state === 'disabled' ? first.disabledPath : first.originalPath || '').trim()
  }

  function openLocalBoundLocation(item = {}) {
    const targetPath = getLocalBindingOpenPath(item)
    if (!targetPath) {
      $message.warning(uiMessage('ui.thisManagedInPlaceRecordHasNoPathToOpen'))
      return
    }
    sendIpc('openSpecifyPath', targetPath)
  }

  async function refreshLocalBoundRecord(item = {}) {
    const recordId = getLocalBoundRecordId(item)
    if (!recordId) {
      $message.error(uiMessage('ui.theManagedInPlaceRecordHasNoDatabaseRowID'))
      return
    }

    try {
      const result = await invokeIpc('local-bound-mod:refresh', { id: recordId })
      if (result?.success) {
        $message.success(uiMessage('ui.managedInPlacePathStatusRefreshed'))
        refreshCurrentSource()
        return
      }
      $message.error(result?.message || '刷新原地接管状态失败')
    } catch (error) {
      console.error('刷新原地接管状态失败', error)
      $message.error(String(error?.message || '刷新原地接管状态失败'))
    }
  }

  function unbindLocalBoundModConfirm(item = {}) {
    const isEnabled = Number(item?.is_active ?? item?.isActive ?? 0) === 1
    const name = toDisplayText(item?.name || item?.displayName)
    openClientConfirmDialog({
      tone: 'warning',
      toneLabel: '解除接管',
      get title() { return uiText('ui.stopManagingThisLocalMod') },
      subtitle: name,
      description: isEnabled
        ? uiText('ui.thisOnlyRemovesTheVertexManagementRecordLocalFilesWill')
        : uiText('ui.thisRecordIsDisabledByDefaultItsFilesWillBe'),
      get confirmText() { return uiText('ui.stopManaging') },
      get cancelText() { return uiText('ui.cancel') },
      details: [
        buildConfirmDetail('模组名称', name),
        buildConfirmDetail('路径数量', uiText('ui.valueItems', { value1: (getLocalBindingItems(item).length) }))
      ],
      impacts: [
        buildConfirmImpact('Vertex 将不再管理这些路径。'),
        isEnabled
          ? buildConfirmImpact('本地文件会保留在原位置。')
          : buildConfirmImpact('禁用区文件会先恢复到原路径。', 'warning')
      ],
      onConfirm: async () => {
        const recordId = getLocalBoundRecordId(item)
        if (!recordId) {
          $message.error(uiMessage('ui.theManagedInPlaceRecordHasNoDatabaseRowID'))
          return
        }
        const result = await invokeIpc('local-bound-mod:unbind', {
          id: recordId,
          restore: true
        })
        if (result?.success) {
          $message.success(result.message || '已解除接管')
          refreshCurrentSource()
          return
        }
        $message.error(result?.message || '解除接管失败')
      }
    })
  }

  function deleteLocalBoundModConfirm(item = {}) {
    const name = toDisplayText(item?.name || item?.displayName)
    const items = getLocalBindingItems(item)
    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除文件',
      get title() { return uiText('ui.deleteTheManagedInPlaceFiles') },
      subtitle: name,
      get description() { return uiText('ui.thisDeletesTheLocalFilesOrFoldersYouPlacedUnder') },
      get confirmText() { return uiText('ui.deleteFiles') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      details: [
        buildConfirmDetail('模组名称', name),
        buildConfirmDetail('路径数量', uiText('ui.valueItems', { value1: (items.length) })),
        buildConfirmDetail('首个路径', items[0]?.originalPath || '--')
      ],
      impacts: [
        buildConfirmImpact('本地文件或文件夹会被删除。', 'danger'),
        buildConfirmImpact('该操作不可自动恢复。', 'danger')
      ],
      onConfirm: async () => {
        const recordId = getLocalBoundRecordId(item)
        if (!recordId) {
          $message.error(uiMessage('ui.theManagedInPlaceRecordHasNoDatabaseRowID'))
          return
        }
        const result = await invokeIpc('local-bound-mod:delete', { id: recordId })
        if (result?.success) {
          $message.success(result.message || '原地接管文件已删除')
          refreshCurrentSource()
          return
        }
        $message.error(result?.message || '删除原地接管文件失败')
      }
    })
  }

  async function openLocalLibraryLocation(item = {}) {
    const itemId = getLocalLibraryItemId(item)
    if (!itemId) {
      $message.error(uiMessage('ui.theLocalAssetRecordHasNoIDRefreshTheList'))
      return
    }
    try {
      const result = await openLocalModLibraryPath({ id: itemId })
      if (result?.success === false) {
        $message.error(result?.message || '打开本地资产位置失败')
      }
    } catch (error) {
      console.error('打开本地资产位置失败', error)
      $message.error(String(error?.message || '打开本地资产位置失败'))
    }
  }

  function deleteLocalLibraryItemConfirm(item = {}) {
    const itemId = getLocalLibraryItemId(item)
    const name = getLocalLibraryDisplayName(item)
    openClientConfirmDialog({
      tone: 'warning',
      toneLabel: '移除记录',
      get title() { return uiText('ui.removeThisLocalAssetRecord') },
      subtitle: name,
      get description() { return uiText('ui.thisOnlyRemovesTheAssetRecordFromThisListInstalled') },
      get confirmText() { return uiText('tools.removeRecord') },
      get cancelText() { return uiText('ui.cancel') },
      details: [
        buildConfirmDetail('模组名称', name),
        buildConfirmDetail('来源', getLocalLibrarySourceLabel(item)),
        buildConfirmDetail('资产路径', item?.sourcePath || item?.library_root_path || '--')
      ],
      impacts: [
        buildConfirmImpact('本地资产不会再出现在当前模组管理列表。', 'warning'),
        buildConfirmImpact('不会执行已安装模组卸载。')
      ],
      onConfirm: async () => {
        if (!itemId) {
          $message.error(uiMessage('ui.theLocalAssetRecordHasNoIDRefreshTheList'))
          return
        }
        const result = await deleteLocalModLibraryItem({ id: itemId })
        if (result?.success) {
          $message.success(result.message || '本地资产记录已移除')
          refreshCurrentSource()
          return
        }
        $message.error(result?.message || '移除本地资产记录失败')
      }
    })
  }

  function handleLocalLibraryAction(item = {}, actionKey = '') {
    if (actionKey === 'install-local-library') {
      createInstallTaskFromLocalLibrary(item)
      return
    }
    if (
      actionKey === 'open-local-library' ||
      actionKey === 'open-location' ||
      actionKey === 'location'
    ) {
      openLocalLibraryLocation(item)
      return
    }
    if (actionKey === 'delete') {
      deleteLocalLibraryItemConfirm(item)
    }
  }

  function handleLocalBoundAction(item = {}, actionKey = '') {
    if (actionKey === 'open-location' || actionKey === 'location') {
      openLocalBoundLocation(item)
      return
    }
    if (actionKey === 'refresh-local-binding') {
      refreshLocalBoundRecord(item)
      return
    }
    if (actionKey === 'unbind-local-binding') {
      unbindLocalBoundModConfirm(item)
      return
    }
    if (actionKey === 'delete') {
      deleteLocalBoundModConfirm(item)
    }
  }

  function handleCardToggle(payload = {}) {
    const card = payload?.card || {}
    setFocusedCard(card)
    const checked = !!payload?.checked

    if (isLocalLibraryCard(card)) {
      return
    }

    if (isLocalBoundMod(card.raw)) {
      toggleLocalBoundMod(card.raw, checked)
      return
    }

    if (card?.source === SOURCE_TYPE.THUNDERSTORE) {
      handleThunderstoreToggleRow({
        mod: card.raw,
        checked
      })
      return
    }

    if (card?.source === SOURCE_TYPE.FICSIT) {
      toggleFicsitMod(card.raw, checked)
      return
    }

    if (card?.source === SOURCE_TYPE.NEXUS) {
      toggleNexusMod(card.raw, checked)
      return
    }

    if (card?.source === SOURCE_TYPE.MODIO) {
      toggleModioMod(card.raw, checked)
      return
    }

    toggleModState(card.raw, checked)
  }

  function handleCardAction(payload = {}) {
    const card = payload?.card || {}
    const actionKey = String(payload?.key || '').trim()
    setFocusedCard(card)

    if (!actionKey) {
      return
    }

    if (isLocalLibraryCard(card)) {
      handleLocalLibraryAction(card.raw, actionKey)
      return
    }

    if (isLocalBoundMod(card.raw)) {
      handleLocalBoundAction(card.raw, actionKey)
      return
    }

    if (actionKey === 'clear-record') {
      clearInvalidModRecord(card.raw)
      return
    }

    if (actionKey === 'retry-lock') {
      retryLockMod(card.raw)
      return
    }

    if (card?.source === SOURCE_TYPE.THUNDERSTORE) {
      if (actionKey === 'delete') {
        uninstallThunderstoreModConfirm(card.raw)
        return
      }
      handleThunderstoreRowAction({
        actionKey,
        row: card.raw
      })
      return
    }

    if (card?.source === SOURCE_TYPE.FICSIT) {
      if (actionKey === 'open-source-page') {
        const url = getManagedModSourceUrl(card.raw, SOURCE_TYPE.FICSIT)
        if (url) sendIpc('openBrowse', { url })
        return
      }
      if (actionKey === 'update-ficsit') {
        updateFicsitMod(card.raw)
        return
      }
      if (actionKey === 'delete') {
        uninstallFicsitModConfirm(card.raw)
      }
      return
    }

    if (card?.source === SOURCE_TYPE.NEXUS) {
      if (actionKey === 'update-nexus') {
        updateNexusMod(card.raw)
        return
      }
      if (actionKey === 'run' || actionKey === 'run-executable') {
        runNexusExecutable(card.raw)
        return
      }
      if (actionKey === 'archive') {
        openNexusSourceArchivePath(card.raw)
        return
      }
      if (actionKey === 'source' || actionKey === 'open-source-page') {
        openNexusSourcePage(card.raw)
        return
      }
      if (actionKey === 'location' || actionKey === 'open-install-root') {
        openNexusInstallPath(card.raw)
        return
      }
      if (actionKey === 'delete') {
        uninstallNexusModConfirm(card.raw)
      }
      return
    }

    if (card?.source === SOURCE_TYPE.MODIO) {
      if (actionKey === 'update-modio') {
        updateModioMod(card.raw)
        return
      }
      if (actionKey === 'run-executable') {
        runRuleManagedExecutable(card.raw)
        return
      }
      if (actionKey === 'open-install-root') {
        openRuleManagedInstallPath(card.raw)
        return
      }
      if (actionKey === 'open-source-page') {
        openModioSourcePage(card.raw)
        return
      }
      if (actionKey === 'delete') {
        uninstallModioModConfirm(card.raw)
      }
      return
    }

    if (actionKey === 'inspect-structure') {
      checkInstallPath(card.raw)
      return
    }
    if (actionKey === 'update') {
      updateMod(card.raw)
      return
    }
    if (actionKey === 'delete') {
      uninstallMod(card.raw)
    }
  }

  function scheduleRefresh(delay = 120) {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      initPage()
    }, delay)
  }

  function setMenuName(name = '') {
    if (!isCurrentManagementRoute.value) {
      return
    }
    const resolvedName =
      String(name || '').trim() ||
      getRouteQueryText('name') ||
      String(current.value?.chineseTitle || '').trim()
    if (!resolvedName) {
      return
    }
    setPageMenuName(() => `${localizeModUiText('模组管理')} - ${gamePresentation({
      ...current.value, name: resolvedName, englishTitle: current.value?.englishTitle || getRouteQueryText('englishTitle')
    }).title}`, boundManagementPath.value)
  }

  function normalizeSourceType(value = '') {
    const text = String(value || '')
      .trim()
      .toLowerCase()
    if (text === 'server') return SOURCE_TYPE.VERTEX
    if (text === SOURCE_TYPE.THUNDERSTORE) return SOURCE_TYPE.THUNDERSTORE
    if (text === SOURCE_TYPE.FICSIT) return SOURCE_TYPE.FICSIT
    if (text === SOURCE_TYPE.NEXUS) return SOURCE_TYPE.NEXUS
    if (text === SOURCE_TYPE.MODIO || text === 'mod.io') return SOURCE_TYPE.MODIO
    return text || SOURCE_TYPE.VERTEX
  }

  function normalizeRouteSourceId(sourceType = SOURCE_TYPE.VERTEX, value = '') {
    const text = String(value || '').trim()
    if (!text) {
      return ''
    }

    if (
      sourceType === SOURCE_TYPE.THUNDERSTORE ||
      sourceType === SOURCE_TYPE.NEXUS ||
      sourceType === SOURCE_TYPE.MODIO
    ) {
      return text.toLowerCase()
    }

    return text
  }

  function getRouteSourceType() {
    return normalizeSourceType(
      boundManagementParamsSource.value || boundManagementQuery.value?.source || SOURCE_TYPE.VERTEX
    )
  }

  function getRouteQueryText(key = '') {
    return String(boundManagementQuery.value?.[key] || '').trim()
  }

  function getRouteSourceIdText() {
    const sourceType = getRouteSourceType()
    const explicitSourceId = getRouteQueryText('sourceId')
    if (explicitSourceId) {
      return normalizeRouteSourceId(sourceType, explicitSourceId)
    }

    if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
      return normalizeRouteSourceId(
        sourceType,
        getRouteQueryText('community') || boundManagementParamsId.value
      )
    }

    if (sourceType === SOURCE_TYPE.NEXUS) {
      return normalizeRouteSourceId(
        sourceType,
        getRouteQueryText('nexusGameId') ||
          getRouteQueryText('domainName') ||
          boundManagementParamsId.value
      )
    }

    if (sourceType === SOURCE_TYPE.FICSIT) {
      return normalizeRouteSourceId(
        sourceType,
        getRouteQueryText('gameId') || boundManagementParamsId.value
      )
    }

    if (sourceType === SOURCE_TYPE.MODIO) {
      return normalizeRouteSourceId(
        sourceType,
        getRouteQueryText('modioGameId') ||
          getRouteQueryText('gameId') ||
          boundManagementParamsId.value
      )
    }

    return normalizeRouteSourceId(sourceType, boundManagementParamsId.value)
  }

  function resolveThunderstoreCommunityFromRoute() {
    const routeCommunity = getRouteQueryText('community').toLowerCase()
    if (routeCommunity) {
      return routeCommunity
    }
    if (getRouteSourceType() === SOURCE_TYPE.THUNDERSTORE) {
      return getRouteSourceIdText()
    }
    return ''
  }

  function resolveNexusDomainName() {
    return String(boundManagementQuery.value?.domainName || current.value?.sourceDomainName || '')
      .trim()
      .toLowerCase()
  }

  function resolveNexusGameId() {
    const routeNexusGameId = Number(
      boundManagementQuery.value?.nexusGameId || current.value?.sourceNexusGameId || 0
    )
    if (routeNexusGameId > 0) {
      return routeNexusGameId
    }

    if (getRouteSourceType() === SOURCE_TYPE.NEXUS) {
      const sourceId = Number(getRouteSourceIdText() || 0)
      if (Number.isFinite(sourceId) && sourceId > 0) {
        return sourceId
      }
    }

    return 0
  }

  function ensureCurrentManagedGameFromRoute() {
    if (current.value?.manageKey === buildManageKeyByRoute()) {
      return
    }

    const sourceType = getRouteSourceType()
    const sourceId = getRouteSourceIdText()
    if (!sourceId) {
      return
    }

    const routeAppId = Number(
      boundManagementQuery.value?.appId || boundManagementQuery.value?.steamAppId || 0
    )
    const steamAppId =
      routeAppId > 0
        ? routeAppId
        : sourceType === SOURCE_TYPE.VERTEX || sourceType === SOURCE_TYPE.FICSIT
          ? Number(boundManagementParamsId.value || 0)
          : 0

    gameStore.setCurrentManagedGame({
      manageKey: buildManageKeyByRoute(),
      sourceId,
      steamAppId,
      chineseTitle: getRouteQueryText('name'),
      englishTitle: getRouteQueryText('englishTitle'),
      is_server_installed: 0,
      server_install_mod_type: 0,
      gId: Number(
        boundManagementQuery.value?.backendGameId || boundManagementQuery.value?.gameId || 0
      ),
      sourceType,
      sourceCommunity: resolveThunderstoreCommunityFromRoute(),
      sourceProfile: getRouteQueryText('profile') || 'default',
      sourceGameId: Number(
        boundManagementQuery.value?.backendGameId || boundManagementQuery.value?.gameId || 0
      ),
      sourceDomainName: resolveNexusDomainName(),
      sourceNexusGameId: resolveNexusGameId(),
      sourceModioGameId: resolvedModioGameId.value
    })
  }

  function getLocalBindingProfileName() {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return normalizeManagedProfileName(thunderstoreProfile.value)
    }
    if (isManagedSourceProfileSource(activeSource.value)) {
      return getManagedSourceProfileValue(activeSource.value)
    }
    return 'default'
  }

  function buildLocalBindingSourceMeta(profileName = getLocalBindingProfileName()) {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return {
        source: 'thunderstore',
        sourceId: thunderstoreCommunity.value,
        sourceSlug: thunderstoreCommunity.value,
        community: thunderstoreCommunity.value,
        appId: String(resolvedSteamAppId.value || ''),
        profileName,
        targetProfileName: profileName
      }
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return withManagedSourceProfile(ficsitSourceMeta.value, profileName)
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return withManagedSourceProfile(nexusSourceMeta.value, profileName)
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return withManagedSourceProfile(modioSourceMeta.value, profileName)
    }
    return {
      source: 'server',
      appId: String(resolvedSteamAppId.value || ''),
      profileName,
      targetProfileName: profileName
    }
  }

  function buildLocalBindingPayload(extra = {}) {
    const profileName = getLocalBindingProfileName()
    return {
      appId: resolvedSteamAppId.value,
      endpointType: 0,
      source: activeSource.value === SOURCE_TYPE.VERTEX ? 'server' : activeSource.value,
      profileName,
      gameRoot: getRouteQueryText('gamePath') || getRouteQueryText('rootPath'),
      sourceMeta: buildLocalBindingSourceMeta(profileName),
      ...extra
    }
  }

  const localToolContext = computed(() => {
    const profileName = getLocalBindingProfileName()
    const sourcePayload = buildLocalBindingPayload()
    return {
      gameId: resolvedGameId.value,
      appId: resolvedSteamAppId.value,
      gameName:
        String(
          current.value?.chineseTitle || current.value?.name || getRouteQueryText('name') || ''
        ).trim() || uiText('ui.currentGame'),
      sourcePlatform: sourcePayload.source,
      sourceProfile: profileName,
      profileName,
      sourceId: getRouteSourceIdText(),
      sourceSlug:
        activeSource.value === SOURCE_TYPE.THUNDERSTORE
          ? thunderstoreCommunity.value
          : activeSource.value === SOURCE_TYPE.NEXUS
            ? resolvedNexusDomainName.value
            : getRouteQueryText('nameId'),
      sourceMeta: sourcePayload.sourceMeta,
      gameRoot: sourcePayload.gameRoot
    }
  })

  function syncSourceStateToStore() {
    if (!current.value) return

    const nextSourceType = normalizeSourceType(activeSource.value)
    const nextSourceId = normalizeRouteSourceId(
      nextSourceType,
      current.value?.sourceId ||
        getRouteSourceIdText() ||
        (nextSourceType === SOURCE_TYPE.VERTEX || nextSourceType === SOURCE_TYPE.FICSIT
          ? String(current.value?.steamAppId || resolvedSteamAppId.value || '').trim()
          : '')
    )
    const nextSourceCommunity = String(thunderstoreCommunity.value || '')
      .trim()
      .toLowerCase()
    const nextSourceProfile =
      nextSourceType === SOURCE_TYPE.THUNDERSTORE
        ? normalizeManagedProfileName(thunderstoreProfile.value)
        : isManagedSourceProfileSource(nextSourceType)
          ? getManagedSourceProfileValue(nextSourceType)
          : 'default'
    const nextSourceGameId =
      nextSourceType === SOURCE_TYPE.MODIO
        ? Number(resolvedModioGameId.value || 0)
        : Number(resolvedGameId.value || 0)
    const currentSourceType = normalizeSourceType(current.value?.sourceType)
    const currentSourceId = normalizeRouteSourceId(currentSourceType, current.value?.sourceId || '')
    const currentSourceDomainName = String(current.value?.sourceDomainName || '')
      .trim()
      .toLowerCase()
    const nextSourceDomainName =
      nextSourceType === SOURCE_TYPE.NEXUS ? resolvedNexusDomainName.value : currentSourceDomainName
    const currentSourceCommunity = String(current.value?.sourceCommunity || '')
      .trim()
      .toLowerCase()
    const currentSourceProfile =
      String(current.value?.sourceProfile || 'default').trim() || 'default'
    const currentSourceGameId = Number(current.value?.sourceGameId || 0)

    // 状态未变化时不回写 store，避免 watch(current) 递归触发
    if (
      currentSourceType === nextSourceType &&
      currentSourceId === nextSourceId &&
      currentSourceDomainName === nextSourceDomainName &&
      currentSourceCommunity === nextSourceCommunity &&
      currentSourceProfile === nextSourceProfile &&
      currentSourceGameId === nextSourceGameId
    ) {
      return
    }

    gameStore.setCurrentManagedGame({
      ...current.value,
      sourceId: nextSourceId,
      manageKey:
        current.value?.manageKey ||
        [
          nextSourceType,
          nextSourceId || '',
          nextSourceGameId || '',
          nextSourceCommunity || '',
          nextSourceDomainName || '',
          nextSourceProfile || 'default'
        ].join(':'),
      sourceType: nextSourceType,
      sourceCommunity: nextSourceCommunity,
      sourceProfile: nextSourceProfile,
      sourceGameId: nextSourceGameId,
      sourceDomainName: nextSourceDomainName,
      sourceNexusGameId:
        nextSourceType === SOURCE_TYPE.NEXUS
          ? resolvedNexusGameId.value
          : current.value?.sourceNexusGameId,
      sourceModioGameId:
        nextSourceType === SOURCE_TYPE.MODIO
          ? resolvedModioGameId.value
          : current.value?.sourceModioGameId
    })
  }

  async function resolveThunderstoreContext() {
    const routeCommunity = resolveThunderstoreCommunityFromRoute()
    if (routeCommunity) {
      thunderstoreCommunity.value = routeCommunity
    } else {
      const storeCommunity = String(current.value?.sourceCommunity || '')
        .trim()
        .toLowerCase()
      thunderstoreCommunity.value = storeCommunity
    }

    if (!thunderstoreCommunity.value) {
      const appId = resolvedSteamAppId.value
      if (appId > 0) {
        const meta = await getR2modmanCommunityMetaBySteamAppId(appId)
        thunderstoreCommunity.value = String(meta?.community || '')
          .trim()
          .toLowerCase()
      }
    }

    const routeProfile = getRouteQueryText('profile')
    const storeProfile = String(current.value?.sourceProfile || '').trim()
    const preferredProfile = readThunderstorePreferredProfile(thunderstoreCommunity.value)
    thunderstoreProfile.value = routeProfile || storeProfile || preferredProfile || 'default'

    if (!thunderstoreProfileOptions.value.includes(thunderstoreProfile.value)) {
      thunderstoreProfile.value = thunderstoreProfileOptions.value[0] || 'default'
    }
  }

  function setThunderstoreOperationLoading(fullName = '', loading = false) {
    const key = String(fullName || '').trim()
    if (!key) return
    const next = {
      ...thunderstoreOperationLoadingMap.value
    }
    if (loading) {
      next[key] = true
    } else {
      delete next[key]
    }
    thunderstoreOperationLoadingMap.value = next
  }

  function setThunderstoreToggling(fullName = '', loading = false) {
    const key = String(fullName || '').trim()
    if (!key) return
    const next = {
      ...thunderstoreTogglingMap.value
    }
    if (loading) {
      next[key] = true
    } else {
      delete next[key]
    }
    thunderstoreTogglingMap.value = next
  }

  function setThunderstoreUpdating(fullName = '', loading = false) {
    const key = String(fullName || '').trim()
    if (!key) return
    const next = {
      ...thunderstoreUpdatingMap.value
    }
    if (loading) {
      next[key] = true
    } else {
      delete next[key]
    }
    thunderstoreUpdatingMap.value = next
  }

  function buildInstallLocationInfo(files = [], installRoot = '') {
    const list = Array.isArray(files) ? files : []
    const root = String(installRoot || '').trim()
    const firstEntry = list[0]
    const firstPath =
      typeof firstEntry === 'string'
        ? firstEntry.trim()
        : String(
            firstEntry?.path ||
              firstEntry?.originalPath ||
              firstEntry?.absolutePath ||
              firstEntry?.targetPath ||
              firstEntry?.disabledPath ||
              ''
          ).trim()
    if (root) {
      const normalizedRoot = root.replace(/\//g, '\\')
      const segments = normalizedRoot.split('\\').filter(Boolean)
      const tail = segments.slice(-2).join('\\') || normalizedRoot
      return {
        installLocationText: tail,
        installLocationTooltip: normalizedRoot,
        primaryInstallPath: normalizedRoot
      }
    }
    if (firstPath) {
      const normalizedPath = firstPath.replace(/\//g, '\\')
      const segments = normalizedPath.split('\\').filter(Boolean)
      const fileName = segments[segments.length - 1] || normalizedPath
      return {
        installLocationText: fileName,
        installLocationTooltip: normalizedPath,
        primaryInstallPath: normalizedPath
      }
    }
    return {
      installLocationText: 'BepInEx\\plugins',
      installLocationTooltip: '',
      primaryInstallPath: ''
    }
  }

  function getInstalledSizeBytesByList(sourceList = []) {
    return (Array.isArray(sourceList) ? sourceList : []).reduce((total, item) => {
      const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
      const size = Number(metadata?.fileSize || 0)
      return Number.isFinite(size) && size > 0 ? total + size : total
    }, 0)
  }

  function normalizeThunderstoreRecord(fullName = '', item = {}) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const localBoundRecordId = isLocalBoundMod(item) ? getLocalBoundRecordId(item) : 0
    const updateInfo =
      thunderstoreUpdateLookup.value[
        String(fullName || '')
          .trim()
          .toLowerCase()
      ] || {}
    const displayName = String(
      item?.packageName ||
        metadata?.name ||
        updateInfo?.packageName ||
        String(fullName || '')
          .split('-')
          .slice(1)
          .join('-') ||
        fullName
    ).trim()
    const installRoot = String(metadata?.installRoot || item?.installRoot || '').trim()
    const installLocationInfo = buildInstallLocationInfo(item?.files, installRoot)
    const latestVersion = String(updateInfo?.latestVersion || '').trim()
    const currentVersion = String(item?.version || '').trim()

    return {
      fullName,
      ...(item || {}),
      id: localBoundRecordId || fullName,
      rowId: localBoundRecordId || toSafeId(item?.id || item?.rowId || item?.recordId),
      displayName: displayName || fullName,
      displayInitial: getDisplayInitial(displayName || fullName),
      iconUrl: String(metadata?.icon || metadata?.iconUrl || updateInfo?.icon || '').trim(),
      description: String(
        metadata?.description || updateInfo?.description || uiText('ui.noOnlineDescriptionThisModIsInstalledInTheCurrent')
      ).trim(),
      packageUrl: String(metadata?.packageUrl || updateInfo?.packageUrl || '').trim(),
      ownerName: String(item?.packageOwner || updateInfo?.packageOwner || '').trim(),
      installRoot,
      installLocationText: installLocationInfo.installLocationText,
      installLocationTooltip: installLocationInfo.installLocationTooltip,
      primaryInstallPath: installLocationInfo.primaryInstallPath,
      dependencyCount: Array.isArray(item?.dependencies) ? item.dependencies.length : 0,
      fileCount: Array.isArray(item?.files) ? item.files.length : 0,
      enabled: Number(item?.installState ?? item?.isActive ?? 0) === 1,
      hasUpdate: !!latestVersion && !!currentVersion && latestVersion !== currentVersion,
      latestVersion,
      currentVersion
    }
  }

  async function loadThunderstoreProfileSummary(options = {}) {
    const requestToken = Number(options?.requestToken || 0)
    const community = String(options?.community || thunderstoreCommunity.value || '')
      .trim()
      .toLowerCase()
    const profiles = Array.isArray(options?.profiles)
      ? options.profiles.map((item) => String(item || '').trim()).filter(Boolean)
      : thunderstoreProfileOptions.value

    if (!community || !profiles.length) {
      if (!requestToken || requestToken === thunderstoreLoadToken) {
        thunderstoreProfileSummary.value = createEmptyThunderstoreProfileSummary()
      }
      return
    }

    const stats = await Promise.all(
      profiles.map(async (profileName) => {
        try {
          const result = await invokeIpc('thunderstoreGetInstallState', {
            community,
            profileName
          })
          const installedMap =
            result?.installed && typeof result.installed === 'object' ? result.installed : {}
          const list = Object.values(installedMap)
          return {
            profileName,
            count: Object.keys(installedMap).length,
            sizeBytes: getInstalledSizeBytesByList(list)
          }
        } catch (error) {
          console.error(`读取 Thunderstore 配置汇总失败：${profileName}`, error)
          return {
            profileName,
            count: 0,
            sizeBytes: 0
          }
        }
      })
    )

    if (requestToken && requestToken !== thunderstoreLoadToken) {
      return
    }

    thunderstoreProfileSummary.value = {
      stats,
      totalCount: stats.reduce((sum, item) => sum + Number(item?.count || 0), 0),
      totalSize: stats.reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0)
    }
  }

  async function loadThunderstoreInstalledList() {
    if (!thunderstoreCommunity.value) {
      sourceErrorText.value = '未匹配到 Thunderstore 社区标识，无法读取已安装模组'
      thunderstoreInstalledList.value = []
      thunderstoreLocalBoundList.value = []
      thunderstoreUpdateRecords.value = []
      thunderstoreProfileSummary.value = createEmptyThunderstoreProfileSummary()
      return
    }

    const requestToken = ++thunderstoreLoadToken
    const community = String(thunderstoreCommunity.value || '')
      .trim()
      .toLowerCase()
    const profileName = String(thunderstoreProfile.value || 'default').trim() || 'default'
    const appId = resolvedSteamAppId.value
    const profileOptionsSnapshot = [...thunderstoreProfileOptions.value]

    const listKey = `${community}|${profileName}`
    sourceErrorText.value = ''
    thunderstoreBatchLoading.value = true
    if (listKey !== thunderstoreLoadedListKey) {
      thunderstoreUpdateRecords.value = []
    }
    try {
      const installStateResult = await invokeIpc('thunderstoreGetInstallState', {
        community,
        profileName
      })

      if (requestToken !== thunderstoreLoadToken) {
        return
      }

      const installedMap =
        installStateResult?.installed && typeof installStateResult.installed === 'object'
          ? installStateResult.installed
          : {}

      thunderstoreLoadedListKey = listKey
      thunderstoreInstalledList.value = Object.entries(installedMap)
        .map(([fullName, item]) => normalizeThunderstoreRecord(fullName, item))
        .sort(
          (a, b) =>
            getDateTimestamp(b?.updatedAt || b?.installedAt) -
            getDateTimestamp(a?.updatedAt || a?.installedAt)
        )
      const localBoundResult = await getInstalledModsBySourceService({
        appId,
        endpointType: 0,
        profileName,
        sourceMeta: {
          source: 'thunderstore',
          sourceId: community,
          sourceSlug: community,
          community,
          appId: String(appId || ''),
          profileName,
          targetProfileName: profileName
        }
      })
      thunderstoreLocalBoundList.value = (
        Array.isArray(localBoundResult?.records) ? localBoundResult.records : []
      ).filter((item) => isLocalBoundMod(item))
      hydrateThunderstoreInstalledTranslations(thunderstoreInstalledList.value).catch((error) => {
        console.warn('[MOD_MANAGEMENT] Thunderstore 管理页翻译同步失败', error)
      })

      Promise.all([
        invokeIpc('thunderstoreGetUpdates', {
          community,
          profileName,
          appId
        }),
        loadThunderstoreProfileSummary({
          requestToken,
          community,
          profiles: profileOptionsSnapshot
        })
      ])
        .then(([updateResult]) => {
          if (requestToken !== thunderstoreLoadToken) {
            return
          }
          thunderstoreUpdateRecords.value = Array.isArray(updateResult?.updates)
            ? updateResult.updates
            : []
        })
        .catch((error) => {
          if (requestToken !== thunderstoreLoadToken) {
            return
          }
          console.error('读取 Thunderstore 更新信息失败', error)
          thunderstoreUpdateRecords.value = []
        })
    } catch (error) {
      console.error('读取 Thunderstore 已安装模组失败', error)
      sourceErrorText.value = uiText('ui.couldNotReadInstalledThunderstoreModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
      thunderstoreLoadedListKey = ''
      thunderstoreInstalledList.value = []
      thunderstoreLocalBoundList.value = []
      thunderstoreUpdateRecords.value = []
      if (requestToken === thunderstoreLoadToken) {
        thunderstoreProfileSummary.value = createEmptyThunderstoreProfileSummary()
      }
    } finally {
      if (requestToken === thunderstoreLoadToken) {
        thunderstoreBatchLoading.value = false
      }
    }
  }

  async function uninstallThunderstoreMod(item, force = false) {
    const fullName = String(item?.fullName || '').trim()
    if (!fullName || !thunderstoreCommunity.value) return

    setThunderstoreOperationLoading(fullName, true)
    try {
      const result = await invokeIpc('thunderstoreUninstallPackage', {
        community: thunderstoreCommunity.value,
        profileName: thunderstoreProfile.value,
        packageFullName: fullName,
        force
      })

      if (result?.success) {
        $message.success(result?.message || uiText('ui.uninstalledValue', { value1: (item?.displayName || fullName) }))
        await loadThunderstoreInstalledList()
        return
      }

      if (result?.code === 'DEPENDENCIES_REQUIRED' && !force) {
        const dependent = Array.isArray(result?.dependentPackageNames)
          ? result.dependentPackageNames.join('、')
          : ''
        await openClientConfirmDialog({
          tone: 'danger',
          toneLabel: '风险操作',
          get title() { return uiText('ui.forceDeleteThisMod') },
          subtitle: resolveModDisplayName(item, fullName),
          get description() { return uiText('ui.otherInstalledModsDependOnThisModDeletingItMay') },
          get confirmText() { return uiText('ui.deleteAnyway') },
          get cancelText() { return uiText('ui.cancel') },
          focusAction: 'cancel',
          tags: [buildConfirmTag('Thunderstore', 'default'), buildConfirmTag('存在依赖', 'danger')],
          details: [
            buildConfirmDetail('配置', thunderstoreProfile.value),
            buildConfirmDetail('模组标识', fullName),
            dependent ? buildConfirmDetail('受影响模组', dependent) : null
          ],
          impacts: [
            buildConfirmImpact('当前模组将从这个配置中移除。', 'danger'),
            buildConfirmImpact(
              dependent
                ? uiText('ui.modsThatDependOnItValue', { value1: (dependent) })
                : '依赖当前模组的项目可能失效或需要重新处理。',
              'warning'
            ),
            buildConfirmImpact('该删除不会自动恢复，请确认后再继续。', 'danger')
          ],
          onConfirm: () => uninstallThunderstoreMod(item, true)
        })
        return
      }

      throw new Error(String(result?.message || uiText('ui.uninstallFailed')))
    } catch (error) {
      console.error('卸载 Thunderstore 模组失败', error)
      $message.error(uiMessage('ui.couldNotUninstallThunderstoreModValue', { value1: (String(error?.message || fullName)) }))
    } finally {
      setThunderstoreOperationLoading(fullName, false)
    }
  }

  function deleteThunderstoreProfileConfirm(profileName = '') {
    const targetProfile = String(profileName || '').trim()
    if (
      !targetProfile ||
      targetProfile.toLowerCase() === 'default' ||
      isThunderstoreProfileBusy.value
    ) {
      return
    }

    const installedCount = getThunderstoreInstalledCountByProfile(targetProfile)
    const isCurrentProfile =
      String(thunderstoreProfile.value || '')
        .trim()
        .toLowerCase() === targetProfile.toLowerCase()

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '配置删除',
      title: installedCount > 0 ? uiText('ui.deleteTheProfileAndItsMods') : uiText('ui.deleteThisProfile'),
      subtitle: uiText('ui.valueProfile', { value1: (targetProfile) }),
      description:
        installedCount > 0
          ? uiText('ui.thisProfileStillHasInstalledModsDeletingItAlsoDeletes')
          : uiText('ui.thisProfileWillBeRemovedFromTheProfileList'),
      confirmText: installedCount > 0 ? uiText('ui.deleteProfileAndMods') : uiText('ui.deleteProfile'),
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag('Thunderstore', 'default'),
        buildConfirmTag(isCurrentProfile ? '当前配置' : '其他配置', 'warning'),
        installedCount > 0 ? buildConfirmTag(uiText('ui.valueMods', { value1: (installedCount) }), 'danger') : null
      ],
      details: [
        buildConfirmDetail('配置', targetProfile),
        buildConfirmDetail('包含模组', uiText('ui.valueItems', { value1: (installedCount) })),
        buildConfirmDetail('删除当前配置', isCurrentProfile ? '是' : '否')
      ],
      impacts: [
        buildConfirmImpact('这个配置会从下拉列表中移除。', 'danger'),
        installedCount > 0
          ? buildConfirmImpact('当前配置内的模组和配置文件会一并删除。', 'danger')
          : buildConfirmImpact('当前配置没有已安装模组，仅删除配置记录。'),
        isCurrentProfile ? buildConfirmImpact('删除后会自动切换到 default 配置。', 'warning') : null
      ],
      onConfirm: async () => {
        const result = await invokeIpc('thunderstoreDeleteProfile', {
          community: thunderstoreCommunity.value,
          profileName: targetProfile,
          removeMods: true,
          appId: resolvedSteamAppId.value
        })

        if (!result?.success) {
          throw new Error(String(result?.message || uiText('ui.couldNotDeleteProfile')))
        }

        const nextProfiles = removeThunderstoreProfileFromRegistry(
          thunderstoreCommunity.value,
          targetProfile
        )
        const fallbackProfile = nextProfiles[0] || 'default'
        closeThunderstoreProfileMenu()

        if (isCurrentProfile) {
          thunderstoreProfile.value = fallbackProfile
        } else {
          syncThunderstorePreferredProfile(thunderstoreProfile.value)
          await loadThunderstoreInstalledList()
        }

        $message.success(
          installedCount > 0
            ? uiText('ui.deletedProfileValueAndRemovedValueMods', { value1: (targetProfile), value2: (installedCount) })
            : uiText('ui.profileDeletedValue', { value1: (targetProfile) })
        )
      }
    })
  }

  function uninstallThunderstoreModConfirm(item) {
    const fullName = String(item?.fullName || '').trim()
    if (!fullName) return
    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除确认',
      get title() { return uiText('ui.deleteThisMod') },
      subtitle: resolveModDisplayName(item, fullName),
      get description() { return uiText('ui.thisModWillBeRemovedFromTheCurrentProfile') },
      get confirmText() { return uiText('ui.confirmDeletion') },
      get cancelText() { return uiText('ui.keepMod') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('Thunderstore', 'default')],
      details: [
        buildConfirmDetail('配置', thunderstoreProfile.value),
        buildConfirmDetail('模组标识', fullName)
      ],
      impacts: [
        buildConfirmImpact('当前配置将不再加载这个模组。'),
        buildConfirmImpact('如需恢复，需要重新安装或重新导入。', 'danger')
      ],
      onConfirm() {
        return uninstallThunderstoreMod(item)
      }
    })
  }

  function uninstallThunderstoreAll() {
    if (!thunderstoreInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsToUninstall'))
      return
    }

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '批量删除',
      get title() { return uiText('ui.deleteAllModsInTheCurrentProfile') },
      subtitle: uiText('ui.valueProfile', { value1: (thunderstoreProfile.value) }),
      get description() { return uiText('ui.thisBatchOperationRemovesEveryThunderstoreModInTheCurrent') },
      get confirmText() { return uiText('ui.deleteAll') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag('Thunderstore', 'default'),
        buildConfirmTag(uiText('ui.valueMods', { value1: (thunderstoreInstalledList.value.length) }), 'danger')
      ],
      details: [
        buildConfirmDetail('配置', thunderstoreProfile.value),
        buildConfirmDetail('模组数量', uiText('ui.valueItems', { value1: (thunderstoreInstalledList.value.length) }))
      ],
      impacts: [
        buildConfirmImpact('当前配置中的全部模组都会被移除。', 'danger'),
        buildConfirmImpact('此操作不会自动恢复，请确认后再继续。', 'danger')
      ],
      onConfirm: async () => {
        thunderstoreUninstallAllLoading.value = true
        try {
          for (const item of thunderstoreInstalledList.value) {
            await uninstallThunderstoreMod(item, true)
          }
          await loadThunderstoreInstalledList()
        } finally {
          thunderstoreUninstallAllLoading.value = false
        }
      }
    })
  }

  async function toggleThunderstoreMod(item, enabled, force = false) {
    const fullName = String(item?.fullName || '').trim()
    if (
      !fullName ||
      !thunderstoreCommunity.value ||
      (thunderstoreTogglingMap.value[fullName] && !force)
    ) {
      return
    }

    setThunderstoreToggling(fullName, true)
    try {
      const result = await invokeIpc('thunderstoreSetModEnabled', {
        community: thunderstoreCommunity.value,
        profileName: thunderstoreProfile.value,
        packageFullName: fullName,
        enabled,
        force,
        appId: resolvedSteamAppId.value
      })

      if (result?.success === false && result?.code === 'DEPENDANTS_ENABLED') {
        const dependantPackageNames = Array.isArray(result?.dependantPackageNames)
          ? result.dependantPackageNames
          : []
        await openClientConfirmDialog({
          tone: 'warning',
          toneLabel: '依赖联动',
          get title() { return uiText('ui.disableThisMod') },
          subtitle: resolveModDisplayName(item, fullName),
          get description() { return uiText('ui.otherEnabledModsDependOnThisModOnlyThisMod') },
          get confirmText() { return uiText('ui.continueDisabling') },
          get cancelText() { return uiText('ui.back') },
          focusAction: 'cancel',
          tags: [
            buildConfirmTag('Thunderstore', 'default'),
            buildConfirmTag('会影响其他模组', 'warning')
          ],
          details: [
            buildConfirmDetail('配置', thunderstoreProfile.value),
            dependantPackageNames.length > 0
              ? buildConfirmDetail('受影响模组', dependantPackageNames.join('、'))
              : null
          ],
          impacts: [
            buildConfirmImpact('当前模组会被禁用。', 'warning'),
            buildConfirmImpact(
              dependantPackageNames.length > 0
                ? uiText('ui.theseModsRemainEnabledAndWillBeMarkedAsHaving', { value1: (dependantPackageNames.join('、')) })
                : '依赖当前模组的项目会保持启用，并显示依赖警告。',
              'warning'
            )
          ],
          onConfirm: async () => {
            await toggleThunderstoreMod(item, false, true)
          }
        })
        return
      }

      if (result?.success === false && result?.code === 'DEPENDENCIES_DISABLED') {
        const dependencyPackageNames = Array.isArray(result?.dependencyPackageNames)
          ? result.dependencyPackageNames
          : []
        await openClientConfirmDialog({
          tone: 'default',
          toneLabel: '依赖准备',
          get title() { return uiText('ui.dependenciesAreRequiredBeforeEnablingThisMod') },
          subtitle: resolveModDisplayName(item, fullName),
          get description() { return uiText('ui.missingOrDisabledDependenciesWillBeHandledFirstThenThis') },
          get confirmText() { return uiText('ui.continueEnabling') },
          get cancelText() { return uiText('ui.cancel') },
          tags: [
            buildConfirmTag('Thunderstore', 'default'),
            buildConfirmTag('自动补齐依赖', 'success')
          ],
          details: [
            buildConfirmDetail('配置', thunderstoreProfile.value),
            dependencyPackageNames.length > 0
              ? buildConfirmDetail('待处理依赖', dependencyPackageNames.join('、'))
              : null
          ],
          impacts: [
            buildConfirmImpact('当前模组会在依赖处理完成后启用。'),
            buildConfirmImpact(
              dependencyPackageNames.length > 0
                ? uiText('ui.theseDependenciesWillBeEnabledAutomaticallyValue', { value1: (dependencyPackageNames.join('、')) })
                : '检测到的依赖会自动处理。',
              'success'
            )
          ],
          onConfirm: async () => {
            await toggleThunderstoreMod(item, true, true)
          }
        })
        return
      }

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotChangeModState')))
      }

      await loadThunderstoreInstalledList()
      $message.success(String(result?.message || (enabled ? '模组已启用' : '模组已禁用')))
    } catch (error) {
      console.error('切换 Thunderstore 模组状态失败', error)
      $message.error(uiMessage('ui.couldNotChangeThunderstoreModStateValue', { value1: (String(error?.message || fullName)) }))
    } finally {
      setThunderstoreToggling(fullName, false)
    }
  }

  function toggleThunderstoreAll(enable = true) {
    if (!thunderstoreInstalledList.value.length || !thunderstoreCommunity.value) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsAvailableForThisAction'))
      return
    }

    const actionText = enable ? '启用' : '禁用'
    openClientConfirmDialog({
      tone: enable ? 'default' : 'warning',
      toneLabel: uiText('ui.batchActionValue', { value1: (actionText) }),
      title: uiText('ui.applyValueToModsInTheCurrentProfile', { value1: (actionText) }),
      subtitle: uiText('ui.valueProfile', { value1: (thunderstoreProfile.value) }),
      description: uiText('ui.applyValueToTheModsInThisProfileAsA', { value1: (actionText) }),
      confirmText: uiText('ui.confirmValue', { value1: (actionText) }),
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Thunderstore', 'default'),
        buildConfirmTag(
          uiText('ui.valueMods', { value1: (thunderstoreInstalledList.value.length) }),
          enable ? 'success' : 'warning'
        )
      ],
      details: [
        buildConfirmDetail('配置', thunderstoreProfile.value),
        buildConfirmDetail('目标操作', uiText('ui.batchActionValue', { value1: (actionText) }))
      ],
      impacts: [
        buildConfirmImpact(
          enable ? '未启用的模组会被批量启用。' : '已启用的模组会被批量禁用。',
          enable ? 'success' : 'warning'
        ),
        buildConfirmImpact('已处于目标状态的模组会被自动跳过。')
      ],
      async onConfirm() {
        try {
          const result = await invokeIpc('thunderstoreSetAllModsEnabled', {
            community: thunderstoreCommunity.value,
            profileName: thunderstoreProfile.value,
            enabled: enable,
            appId: resolvedSteamAppId.value
          })
          if (!result?.success) {
            throw new Error(String(result?.message || uiText('ui.batchActionFailedValue', { value1: (actionText) })))
          }
          await loadThunderstoreInstalledList()
          $message.success(
            uiMessage('ui.batchActionValueCompleteProcessedValueMods', { value1: (actionText), value2: (Number(result?.changedCount || 0)) })
          )
        } catch (error) {
          console.error(`批量${actionText} Thunderstore 模组失败`, error)
          $message.error(uiMessage('ui.batchActionValueFailedValue', { value1: (actionText), value2: (String(error?.message || uiText('ui.tryAgainLater'))) }))
        }
      }
    })
  }

  function openThunderstoreInstallRoot(item = {}) {
    const targetPath = String(item?.primaryInstallPath || item?.installRoot || '').trim()
    if (!targetPath) {
      $message.warning(uiMessage('ui.noInstallationPathIsAvailableForThisMod'))
      return
    }
    sendIpc('openSpecifyPath', targetPath)
  }

  function openThunderstorePackagePage(item = {}) {
    const url = String(item?.packageUrl || '').trim()
    if (!url) {
      $message.warning(uiMessage('ui.thisModHasNoDetailsURLToOpen'))
      return
    }
    sendIpc('openBrowse', { url })
  }

  function buildThunderstoreConfigFilterKeyword(item = {}) {
    return String(item?.packageName || item?.displayName || '').trim()
  }

  function openThunderstoreConfigEditor(item = {}) {
    if (!thunderstoreCommunity.value) {
      return
    }

    const preferredPackageName = buildThunderstoreConfigFilterKeyword(item)
    router.push({
      name: 'GameThunderStoreConfigEditor',
      params: {
        id: thunderstoreCommunity.value
      },
      query: {
        profile: thunderstoreProfile.value,
        package: preferredPackageName || undefined
      }
    })
  }

  function handleThunderstoreRowAction(payload = {}) {
    const actionKey = String(payload?.actionKey || '').trim()
    const row = payload?.row || null
    if (!row) {
      return
    }

    if (actionKey === 'open-install-root') {
      openThunderstoreInstallRoot(row)
      return
    }
    if (actionKey === 'open-package-page') {
      openThunderstorePackagePage(row)
      return
    }
    if (actionKey === 'update-package') {
      updateThunderstorePackage(row)
      return
    }
    if (actionKey === 'open-config-files') {
      openThunderstoreConfigEditor(row)
    }
  }

  function handleThunderstoreToggleRow(payload = {}) {
    const row = payload?.mod || null
    if (!row) {
      return
    }
    toggleThunderstoreMod(row, !!payload?.checked, false)
  }

  function changeThunderstorePage(page = 1) {
    const nextPage = Math.min(Math.max(Number(page || 1), 1), thunderstorePages.value)
    thunderstorePage.value = nextPage
    nextTick(() => {
      compactListScrollRef.value?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  function normalizeFicsitRecord(item = {}) {
    if (isLocalBoundMod(item)) {
      return item
    }
    return {
      id: Number(item?.id || 0),
      name: String(item?.name || '').trim(),
      shortDescription: String(item?.shortDescription || item?.short_description || '').trim(),
      fullDescription: String(item?.fullDescription || item?.full_description || '').trim(),
      version: String(item?.version || '').trim(),
      installState: Number(item?.installState || 0),
      targetPath: String(item?.targetPath || item?.target_path || '').trim(),
      stagingPath: String(item?.stagingPath || item?.staging_path || '').trim(),
      sourceRootPath: String(item?.sourceRootPath || item?.source_root_path || '').trim(),
      files: safeParseArray(item?.files || item?.files_json),
      installPaths: safeParseArray(item?.installPaths || item?.install_paths_json),
      fileCount: item?.fileCount,
      priorityOrder: Number(item?.priorityOrder || item?.priority_order || 0),
      deployDomain: String(item?.deployDomain || item?.deploy_domain || '').trim(),
      installModel: String(item?.installModel || item?.install_model || 'legacy').trim(),
      profileName: normalizeManagedProfileName(item?.profileName || item?.profile_name),
      compatFlags: String(item?.compatFlags || item?.compat_flags || '[]').trim(),
      lastReconcileAt: String(item?.lastReconcileAt || item?.last_reconcile_at || '').trim(),
      installedAt: String(item?.installedAt || '').trim(),
      updatedAt: String(item?.updatedAt || '').trim(),
      logo: String(item?.logo || '').trim(),
      modReference: String(item?.modReference || '').trim(),
      dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
      dependents: Array.isArray(item?.dependents) ? item.dependents : [],
      activeDependents: Array.isArray(item?.activeDependents) ? item.activeDependents : [],
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
      source: String(item?.source || 'ficsit').trim() || 'ficsit',
      sourceAdapter: String(item?.sourceAdapter || item?.source_adapter || 'ficsit').trim(),
      ruleId: String(item?.ruleId || item?.rule_id || '').trim(),
      strategy: String(item?.strategy || '').trim()
    }
  }

  function isFicsitOperationLoading(id = 0) {
    return !!ficsitOperationLoadingMap.value[Number(id || 0)]
  }

  function setFicsitOperationLoading(id = 0, loading = false) {
    const safeId = Number(id || 0)
    if (!safeId) return
    const next = {
      ...ficsitOperationLoadingMap.value
    }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    ficsitOperationLoadingMap.value = next
  }

  async function loadFicsitInstalledList() {
    if (!resolvedSteamAppId.value) {
      ficsitInstalledList.value = []
      return
    }

    sourceErrorText.value = ''
    ficsitLoading.value = true
    try {
      await loadManagedSourceProfileStats(SOURCE_TYPE.FICSIT)
      const profileName = getManagedSourceProfileValue(SOURCE_TYPE.FICSIT)
      const result = await getFicsitInstalledMods({
        appId: resolvedSteamAppId.value,
        profileName,
        sourceMeta: withManagedSourceProfile(ficsitSourceMeta.value, profileName)
      })
      if (!result?.success) {
        ficsitInstalledList.value = []
        sourceErrorText.value = String(result?.message || '读取 Ficsit 模组失败')
        return
      }
      ficsitInstalledList.value = (result?.records || []).map((item) => normalizeFicsitRecord(item))
      priorityOrderDirty.value = false
      hydrateFicsitInstalledTranslations(ficsitInstalledList.value).catch((error) => {
        console.warn('[MOD_MANAGEMENT] Ficsit 管理页翻译同步失败', error)
      })
    } catch (error) {
      console.error('读取 Ficsit 已安装模组失败', error)
      sourceErrorText.value = uiText('ui.couldNotReadInstalledFicsitModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
      ficsitInstalledList.value = []
    } finally {
      ficsitLoading.value = false
    }
  }

  async function toggleFicsitMod(item, checked) {
    const id = Number(item?.id || 0)
    if (!id) return
    const blockedReason = !checked ? resolveFicsitDisableBlockedReason(item) : ''
    if (blockedReason) {
      $message.warning(blockedReason)
      return
    }

    setFicsitOperationLoading(id, true)
    try {
      const result = await setFicsitModEnabled({ id, enabled: !!checked })
      if (result?.success) {
        $message.success(result?.message || '状态已更新')
        await loadFicsitInstalledList()
      } else {
        $message.warning(result?.message || '状态更新失败')
      }
    } catch (error) {
      console.error('切换 Ficsit 模组状态失败', error)
      $message.error(uiMessage('ui.couldNotChangeFicsitModState'))
    } finally {
      setFicsitOperationLoading(id, false)
    }
  }

  function setFicsitUpdating(id = 0, loading = false) {
    const safeId = toSafeId(id)
    if (!safeId) return
    const next = { ...ficsitUpdatingMap.value }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    ficsitUpdatingMap.value = next
  }

  async function uninstallFicsitModItem(item) {
    const id = Number(item?.id || 0)
    if (!id) return
    const blockedReason = resolveFicsitUninstallBlockedReason(item)
    if (blockedReason) {
      $message.warning(blockedReason)
      return
    }

    setFicsitOperationLoading(id, true)
    try {
      const result = await uninstallFicsitMod({ id })
      if (result?.success) {
        $message.success(result?.message || '已卸载模组')
        await loadFicsitInstalledList()
      } else {
        $message.warning(result?.message || '卸载失败')
      }
    } catch (error) {
      console.error('卸载 Ficsit 模组失败', error)
      $message.error(uiMessage('ui.couldNotUninstallFicsitMod'))
    } finally {
      setFicsitOperationLoading(id, false)
    }
  }

  function uninstallFicsitModConfirm(item) {
    const blockedReason = resolveFicsitUninstallBlockedReason(item)
    if (blockedReason) {
      $message.warning(blockedReason)
      return
    }

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除确认',
      get title() { return uiText('ui.deleteThisMod') },
      subtitle: resolveModDisplayName(item),
      get description() { return uiText('ui.thisFicsitModWillBeRemovedFromTheCurrentGame') },
      get confirmText() { return uiText('ui.confirmDeletion') },
      get cancelText() { return uiText('ui.keepMod') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('Ficsit', 'default')],
      details: [buildConfirmDetail('模组名称', resolveModDisplayName(item))],
      impacts: [
        buildConfirmImpact('当前游戏将不再加载这个模组。'),
        buildConfirmImpact('如需恢复，需要重新安装该模组。', 'danger')
      ],
      onConfirm() {
        return uninstallFicsitModItem(item)
      }
    })
  }

  function toggleFicsitAll(enable = true) {
    if (!ficsitInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsAvailableForThisAction'))
      return
    }
    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.FICSIT)

    openClientConfirmDialog({
      tone: enable ? 'default' : 'warning',
      toneLabel: uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      title: uiText('ui.applyValueToAllFicsitModsInProfileValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')), value2: (profileName) }),
      subtitle: uiText('ui.valueMods', { value1: (ficsitInstalledList.value.length) }),
      description: uiText('ui.applyValueToAllFicsitModsInTheCurrentProfile', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      confirmText: uiText('ui.confirmValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Ficsit', 'default'),
        buildConfirmTag(
          uiText('ui.valueMods', { value1: (ficsitInstalledList.value.length) }),
          enable ? 'success' : 'warning'
        )
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('目标操作', uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
      ],
      impacts: [
        buildConfirmImpact(
          enable ? '未启用的模组会被统一启用。' : '已启用的模组会被统一禁用。',
          enable ? 'success' : 'warning'
        ),
        buildConfirmImpact('已经处于目标状态的模组会被自动跳过。')
      ],
      async onConfirm() {
        ficsitLoading.value = true
        try {
          if (!enable) {
            const result = await runProtectedBulkModAction(ficsitInstalledList.value, 'disable')
            await loadFicsitInstalledList()
            showBulkModActionResult(result, '禁用')
            return
          }
          let failed = 0
          for (const item of ficsitInstalledList.value) {
            if (enable && item.installState === 1) continue
            if (!enable && item.installState === 0) continue
            const result = await setFicsitModEnabled({ id: item.id, enabled: enable })
            if (!result?.success) {
              failed += 1
            }
          }
          await loadFicsitInstalledList()
          if (failed > 0) {
            $message.warning(uiMessage('ui.batchActionValueCompleteValueModsWereNotProcessed', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')), value2: (failed) }))
          } else {
            $message.success(uiMessage('ui.batchActionValueComplete', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
          }
        } finally {
          ficsitLoading.value = false
        }
      }
    })
  }

  function uninstallFicsitAll() {
    if (!ficsitInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsToUninstall'))
      return
    }
    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.FICSIT)

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '批量删除',
      title: uiText('ui.deleteAllFicsitModsInProfileValue', { value1: (profileName) }),
      subtitle: uiText('ui.valueMods', { value1: (ficsitInstalledList.value.length) }),
      get description() { return uiText('ui.thisBatchOperationRemovesEveryFicsitModInTheCurrent') },
      get confirmText() { return uiText('ui.deleteAll') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag('Ficsit', 'default'),
        buildConfirmTag(uiText('ui.valueMods', { value1: (ficsitInstalledList.value.length) }), 'danger')
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('模组数量', uiText('ui.valueItems', { value1: (ficsitInstalledList.value.length) }))
      ],
      impacts: [
        buildConfirmImpact(uiText('ui.allFicsitModsInProfileValueWillBeRemoved', { value1: (profileName) }), 'danger'),
        buildConfirmImpact('删除完成后不会自动恢复。', 'danger')
      ],
      async onConfirm() {
        ficsitLoading.value = true
        try {
          const result = await runProtectedBulkModAction(ficsitInstalledList.value, 'delete')
          await loadFicsitInstalledList()
          showBulkModActionResult(result, '删除')
        } finally {
          ficsitLoading.value = false
        }
      }
    })
  }

  function normalizeNexusRecord(item = {}) {
    if (isLocalBoundMod(item)) {
      return item
    }
    const normalized = normalizeInstalledNexusRecordService(item, {
      gameDomainName: resolvedNexusDomainName.value
    })
    return {
      ...normalized,
      profileName: normalizeManagedProfileName(item?.profileName || item?.profile_name)
    }
  }

  function decorateNexusRecords(records = []) {
    const localRecords = []
    const sourceRecords = []
    for (const record of Array.isArray(records) ? records : []) {
      if (isLocalBoundMod(record)) {
        localRecords.push(record)
      } else {
        sourceRecords.push(record)
      }
    }
    return [...decorateInstalledNexusRecordsService(sourceRecords), ...localRecords]
  }

  function confirmNexusDependencyAction(item = {}, actionText = '禁用') {
    const warningText = String(item?.dependencyWarningText || '').trim()
    const blockedReason = String(
      actionText === '卸载' ? item?.uninstallBlockedReason : item?.disableBlockedReason
    ).trim()

    if (blockedReason) {
      return openClientConfirmDialog({
        tone: 'warning',
        toneLabel: uiText('ui.actionRestrictedValue', { value1: (actionText) }),
        title: uiText('ui.thisModCannotCurrentlyPerformTheActionValue', { value1: (actionText) }),
        subtitle: resolveModDisplayName(item),
        description: blockedReason,
        get confirmText() { return uiText('ui.gotItVariant2') },
        showCancel: false,
        closeOnMask: false,
        tags: [buildConfirmTag('Nexus', 'default'), buildConfirmTag('受保护依赖', 'warning')],
        details: [buildConfirmDetail('当前状态', uiText('ui.actionRestrictedValue', { value1: (actionText) }))],
        impacts: [buildConfirmImpact('请先处理相关依赖或使用中的关联模组。', 'warning')]
      }).then(() => false)
    }

    if (!warningText) {
      return Promise.resolve(true)
    }

    return openClientConfirmDialog({
      tone: actionText === '卸载' ? 'danger' : 'warning',
      toneLabel: uiText('ui.confirmValue', { value1: (actionText) }),
      title: uiText('ui.reviewTheImpactBeforePerformingThisActionOnTheMod', { value1: (actionText) }),
      subtitle: resolveModDisplayName(item),
      description: warningText,
      confirmText: uiText('ui.continueValue', { value1: (actionText) }),
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('Nexus', 'default')],
      details: [buildConfirmDetail('操作对象', resolveModDisplayName(item))],
      impacts: [
        buildConfirmImpact(
          actionText === '卸载'
            ? '继续后会执行卸载，并处理与该模组关联的依赖影响。'
            : '继续后会执行禁用，并处理与该模组关联的依赖影响。',
          actionText === '卸载' ? 'danger' : 'warning'
        )
      ]
    })
  }

  function isNexusOperationLoading(id = 0) {
    return !!nexusOperationLoadingMap.value[Number(id || 0)]
  }

  function setNexusOperationLoading(id = 0, loading = false) {
    const safeId = Number(id || 0)
    if (!safeId) return
    const next = {
      ...nexusOperationLoadingMap.value
    }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    nexusOperationLoadingMap.value = next
  }

  async function loadNexusInstalledList() {
    if (!resolvedNexusDomainName.value) {
      sourceErrorText.value = '当前 Nexus 游戏缺少域名标识，无法读取已安装模组'
      nexusInstalledList.value = []
      return
    }

    sourceErrorText.value = ''
    nexusLoading.value = true
    try {
      await loadManagedSourceProfileStats(SOURCE_TYPE.NEXUS)
      const profileName = getManagedSourceProfileValue(SOURCE_TYPE.NEXUS)
      const result = await getInstalledModsBySourceService({
        appId: resolvedSteamAppId.value,
        endpointType: 0,
        profileName,
        sourceMeta: {
          ...withManagedSourceProfile(nexusSourceMeta.value, profileName),
          repairUnscopedProfile: true
        }
      })
      if (Number(result?.repairResult?.changes || 0) > 0) {
        await loadManagedSourceProfileStats(SOURCE_TYPE.NEXUS)
      }
      const records = Array.isArray(result?.records) ? result.records : []
      nexusInstalledList.value = decorateNexusRecords(
        records.map((item) => normalizeNexusRecord(item))
      )
      priorityOrderDirty.value = false
      hydrateNexusInstalledTranslations(nexusInstalledList.value).catch((error) => {
        console.warn('[MOD_MANAGEMENT] Nexus 管理页翻译同步失败', error)
      })
    } catch (error) {
      console.error('读取 Nexus 已安装模组失败', error)
      sourceErrorText.value = uiText('ui.couldNotReadInstalledNexusModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
      nexusInstalledList.value = []
    } finally {
      nexusLoading.value = false
    }
  }

  function openRuleManagedInstallPath(item = {}) {
    const targetPath = String(item?.primaryInstallPath || item?.targetPath || '').trim()
    if (!targetPath) {
      $message.warning(uiMessage('ui.noInstallationPathIsAvailableForThisMod'))
      return
    }
    sendIpc('openSpecifyPath', targetPath)
  }

  function openNexusInstallPath(item = {}) {
    openRuleManagedInstallPath(item)
  }

  function resolveNexusSourceFileEntry(item = {}) {
    const archivePath = String(item?.archivePath || '').trim()
    if (archivePath) {
      return {
        path: archivePath,
        type: 'archive'
      }
    }

    const stagingPath = String(item?.stagingPath || '').trim()
    if (stagingPath) {
      return {
        path: stagingPath,
        type: 'staging'
      }
    }

    return {
      path: '',
      type: ''
    }
  }

  function openNexusSourceArchivePath(item = {}) {
    const sourceFileEntry = resolveNexusSourceFileEntry(item)
    if (!sourceFileEntry.path) {
      $message.warning(uiMessage('ui.noSourceFilePathIsRecordedForThisMod'))
      return
    }
    sendIpc('openSpecifyPath', sourceFileEntry.path)
  }

  function openNexusSourcePage(item = {}) {
    const url = String(item?.sourcePageUrl || item?.downloadUrl || '').trim()
    if (!url) {
      $message.warning(uiMessage('ui.thisModHasNoSourceURLToOpen'))
      return
    }
    sendIpc('openBrowse', { url })
  }

  function buildRuleManagedExecutableLaunchPayload(item = {}) {
    const launchPath = String(item?.enableExecutablePath || '').trim()
    if (!launchPath) {
      return null
    }

    return {
      path: launchPath,
      args: Array.isArray(item?.launchArgs)
        ? item.launchArgs.map((entry) => String(entry ?? '').trim()).filter(Boolean)
        : [],
      steamAppId: null
    }
  }

  function runRuleManagedExecutable(item = {}) {
    const hasRuleLaunchTarget = !!String(item?.enableExecutablePath || '').trim()
    const customLaunchPayload =
      hasRuleLaunchTarget &&
      (item?.isManualExecutable ||
        item?.canInjectLaunch ||
        item?.isDefaultExecutable ||
        item?.isRunnable)
        ? buildRuleManagedExecutableLaunchPayload(item)
        : null
    if (customLaunchPayload?.path) {
      sendIpc('startSpecifiedApp', customLaunchPayload)
      return
    }

    const executableType = Number(item?.executableType || 0)
    const executablePath = String(item?.executablePath || '').trim()
    if (executableType === 1 && executablePath) {
      sendIpc('startSpecifiedApp', {
        path: executablePath,
        steamAppId: null
      })
      return
    }

    if (item?.hasMultipleExecutables || executableType >= 2) {
      $message.warning(uiMessage('ui.multipleExecutablesWereFoundTheInstallationFolderHasBeenOpened'))
      openRuleManagedInstallPath(item)
      return
    }

    $message.warning(uiMessage('ui.noExecutablePathIsRecordedForThisMod'))
  }

  function runNexusExecutable(item = {}) {
    runRuleManagedExecutable(item)
  }

  async function toggleNexusMod(item = {}, checked = false) {
    const id = Number(item?.id || 0)
    if (!id) return
    if (!checked) {
      const confirmed = await confirmNexusDependencyAction(item, '禁用')
      if (!confirmed) {
        return
      }
    }

    setNexusOperationLoading(id, true)
    try {
      const result = await toggleNexusModStateService({
        id,
        isActive: !!checked
      })
      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotChangeState')))
      }
      $message.success(String(result?.message || '状态已更新'))
      await loadNexusInstalledList()
    } catch (error) {
      console.error('切换 Nexus 模组状态失败', error)
      $message.error(String(error?.message || '状态切换失败'))
    } finally {
      setNexusOperationLoading(id, false)
    }
  }

  async function uninstallNexusModItem(item = {}) {
    const id = Number(item?.id || 0)
    if (!id) return
    if (String(item?.uninstallBlockedReason || '').trim()) {
      $message.warning(String(item?.uninstallBlockedReason || '').trim())
      return
    }

    setNexusOperationLoading(id, true)
    try {
      const result = await uninstallNexusModByIdService({ id, recordOnly: item.canRemoveRecordOnly === true })
      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.uninstallFailed')))
      }
      const messageText = String(result?.message || '已卸载模组')
      if (result?.warning) {
        $message.warning(messageText)
      } else {
        $message.success(messageText)
      }
      await loadNexusInstalledList()
    } catch (error) {
      console.error('卸载 Nexus 模组失败', error)
      $message.error(String(error?.message || '卸载失败'))
    } finally {
      setNexusOperationLoading(id, false)
    }
  }

  function uninstallNexusModConfirm(item = {}) {
    const recordOnly = item.canRemoveRecordOnly === true
    const blockedReason = String(item?.uninstallBlockedReason || '').trim()
    if (blockedReason) {
      openClientConfirmDialog({
        tone: 'warning',
        toneLabel: '删除受限',
        get title() { return uiText('ui.thisModCannotBeDeletedRightNow') },
        subtitle: resolveModDisplayName(item),
        description: blockedReason,
        get confirmText() { return uiText('ui.gotItVariant2') },
        showCancel: false,
        closeOnMask: false,
        tags: [buildConfirmTag('Nexus', 'default'), buildConfirmTag('受保护依赖', 'warning')],
        details: [buildConfirmDetail('当前状态', '删除受限')],
        impacts: [buildConfirmImpact('请先处理关联依赖后再尝试删除。', 'warning')]
      })
      return
    }

    const confirmContent = String(item?.uninstallConfirmText || '').trim()
    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除确认',
      title: recordOnly ? uiText('ui.removeThisModInstallationRecord') : uiText('ui.deleteThisMod'),
      subtitle: resolveModDisplayName(item),
      description: recordOnly ? uiText('ui.theGameFolderIsMissingOnlyTheInstallationRecordWill') : confirmContent || uiText('ui.thisNexusModWillBeRemovedFromTheInstalledList'),
      confirmText: recordOnly ? uiText('tools.removeRecord') : uiText('ui.confirmDeletion'),
      get cancelText() { return uiText('ui.keepMod') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('Nexus', 'default')],
      details: [
        buildConfirmDetail('模组名称', resolveModDisplayName(item)),
        buildConfirmDetail('域名', resolvedNexusDomainName.value)
      ],
      impacts: [
        buildConfirmImpact('当前模组会从已安装列表中移除。', 'danger'),
        buildConfirmImpact(recordOnly ? '源文件、下载缓存和备份不会删除，也不会重新创建游戏目录。' : '删除完成后不会自动恢复，需要重新安装。', 'danger')
      ],
      onConfirm() {
        return uninstallNexusModItem(item)
      }
    })
  }

  function toggleNexusAll(enable = true) {
    if (!nexusInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsAvailableForThisAction'))
      return
    }
    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.NEXUS)

    const sourceList = nexusInstalledList.value.filter((item) =>
      enable ? !item.isActive : !!item.isActive
    )
    if (!sourceList.length) {
      $message.warning(uiMessage('ui.noNexusModsInThisProfileAreAvailableForValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
      return
    }

    // 批量禁用时：先禁用普通模组，再禁用默认依赖，避免后端因“默认依赖仍被使用”拦截。
    const targetList = enable
      ? sourceList
      : [...sourceList].sort((left, right) => {
          const leftDefault = left?.isDefaultDependency ? 1 : 0
          const rightDefault = right?.isDefaultDependency ? 1 : 0
          return leftDefault - rightDefault
        })
    const defaultDependencyCount = targetList.filter((item) => !!item?.isDefaultDependency).length

    openClientConfirmDialog({
      tone: enable ? 'default' : 'warning',
      toneLabel: uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      title: uiText('ui.applyValueToNexusModsInProfileValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')), value2: (profileName) }),
      subtitle: uiText('ui.valueModsValue', { value1: (targetList.length), value2: (defaultDependencyCount > 0 ? `，含 ${defaultDependencyCount} 个默认依赖` : '') }),
      description: enable
        ? uiText('ui.thisEnablesAllNexusModsInTheCurrentProfile')
        : uiText('ui.thisDisablesAllNexusModsInTheCurrentProfileIncluding'),
      confirmText: uiText('ui.confirmValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Nexus', 'default'),
        buildConfirmTag(uiText('ui.valueMods', { value1: (targetList.length) }), enable ? 'success' : 'warning'),
        defaultDependencyCount > 0
          ? buildConfirmTag(uiText('ui.valueDefaultDependencies', { value1: (defaultDependencyCount) }), 'warning')
          : null
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('目标操作', uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) })),
        buildConfirmDetail('处理模组', uiText('ui.valueItems', { value1: (targetList.length) })),
        defaultDependencyCount > 0
          ? buildConfirmDetail('包含默认依赖', uiText('ui.valueItems', { value1: (defaultDependencyCount) }))
          : null
      ],
      impacts: [
        buildConfirmImpact(
          enable
            ? '未启用的模组会被批量启用。'
            : '已启用的模组会被批量禁用，包括默认依赖和受保护模组。',
          enable ? 'success' : 'warning'
        ),
        !enable && defaultDependencyCount > 0
          ? buildConfirmImpact(
              '默认依赖会在普通模组之后处理，避免仍被引用导致禁用失败。',
              'warning'
            )
          : null
      ],
      async onConfirm() {
        nexusBatchLoading.value = true
        const failedItems = []
        try {
          if (!enable) {
            const result = await runProtectedBulkModAction(targetList, 'disable')
            await loadNexusInstalledList()
            showBulkModActionResult(result, '禁用')
            return
          }
          for (const item of targetList) {
            const result = await toggleNexusModStateService({
              id: Number(item?.id || 0),
              isActive: enable
            })
            if (!result?.success) {
              failedItems.push({
                name: resolveModDisplayName(item),
                message: String(result?.message || uiText('ui.operationFailedVariant2'))
              })
            }
          }
          await loadNexusInstalledList()
          if (failedItems.length > 0) {
            $message.warning(
              uiMessage('ui.batchActionValueCompleteValueFailedValueValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')), value2: (failedItems.length), value3: (failedItems[0]?.name || ''), value4: (failedItems.length > 1 ? uiText('ui.andValueOthers', { value1: (failedItems.length) }) : '') })
            )
          } else {
            $message.success(uiMessage('ui.batchActionValueComplete', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
          }
        } finally {
          nexusBatchLoading.value = false
        }
      }
    })
  }

  function uninstallNexusAll() {
    if (!nexusInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsToUninstall'))
      return
    }
    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.NEXUS)

    const targetList = [...nexusInstalledList.value]
    const defaultDependencyList = targetList.filter((item) => !!item?.isDefaultDependency)
    const recordOnlyCount = targetList.filter((item) => item.canRemoveRecordOnly === true).length

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '批量删除',
      title: uiText('ui.deleteAllNexusModsInProfileValue', { value1: (profileName) }),
      subtitle:
        defaultDependencyList.length > 0
          ? uiText('ui.valueModsIncludingValueDefaultDependencies', { value1: (targetList.length), value2: (defaultDependencyList.length) })
          : uiText('ui.valueMods', { value1: (targetList.length) }),
      description: recordOnlyCount > 0
        ? uiText('ui.theGameFoldersForValueModsAreMissingOnlyTheir', { value1: (recordOnlyCount) })
        : uiText('ui.thisBatchOperationRemovesAllNexusModsAndDefaultDependencies'),
      get confirmText() { return uiText('ui.deleteAll') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag('Nexus', 'default'),
        buildConfirmTag(uiText('ui.valueMods', { value1: (targetList.length) }), 'danger'),
        defaultDependencyList.length > 0
          ? buildConfirmTag(uiText('ui.valueDefaultDependencies', { value1: (defaultDependencyList.length) }), 'warning')
          : null
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('删除模组', uiText('ui.valueItems', { value1: (targetList.length) })),
        defaultDependencyList.length > 0
          ? buildConfirmDetail('包含默认依赖', uiText('ui.valueItems', { value1: (defaultDependencyList.length) }))
          : null
      ],
      impacts: [
        buildConfirmImpact(uiText('ui.allNexusModsInProfileValueWillBeRemoved', { value1: (profileName) }), 'danger'),
        defaultDependencyList.length > 0
          ? buildConfirmImpact('默认依赖也会被一起移除，不会自动保留。', 'warning')
          : null,
        buildConfirmImpact('删除完成后不会自动恢复。', 'danger')
      ],
      async onConfirm() {
        nexusBatchLoading.value = true
        try {
          const result = await runProtectedBulkModAction(targetList, 'delete')
          await loadNexusInstalledList()
          showBulkModActionResult(result, '删除')
        } finally {
          nexusBatchLoading.value = false
        }
      }
    })
  }

  function getNexusApiConfig() {
    const nexusApi =
      systemConfig.value?.nexusApi && typeof systemConfig.value.nexusApi === 'object'
        ? systemConfig.value.nexusApi
        : {}
    return normalizeNexusApiConfig({
      ...nexusApi
    })
  }

  function setNexusUpdating(id = 0, loading = false) {
    const safeId = toSafeId(id)
    if (!safeId) return
    const next = { ...nexusUpdatingMap.value }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    nexusUpdatingMap.value = next
  }

  function safeParseArray(value = null) {
    if (Array.isArray(value)) {
      return value
    }
    const text = String(value || '').trim()
    if (!text) {
      return []
    }
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function normalizeModioRecord(item = {}) {
    if (isLocalBoundMod(item)) {
      return item
    }
    const metadata = safeParseObject(item?.metadata_json || item?.metadata || {})
    const installPlan = resolveInstallRulePlanFromMetadata(metadata, 'modio')
    const modId = toSafeId(item?.mod_id || item?.modId || metadata?.modId || metadata?.sourceId)
    const optionId = toSafeId(item?.option_id || item?.optionId || metadata?.fileId)
    const sourceSlug = String(
      metadata?.sourceGameDomain || metadata?.sourceSlug || getRouteQueryText('nameId') || ''
    ).trim()
    const targetPath = String(
      item?.target_path || item?.targetPath || metadata?.targetPath || ''
    ).trim()
    const installPathInfo = buildInstallLocationInfo(
      safeParseArray(item?.install_paths_json || item?.installPaths || []),
      targetPath
    )
    const executableInfo =
      metadata?.executablePath && typeof metadata.executablePath === 'object'
        ? metadata.executablePath
        : {}
    const executableType = Number(executableInfo?.type || 0)
    const executablePath = String(executableInfo?.path || '').trim()
    const executablePaths = (Array.isArray(executableInfo?.paths) ? executableInfo.paths : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    const launchAction = normalizeInstallRuleLaunchAction(
      installPlan?.launchAction || installPlan?.launch_action,
      ''
    )
    const enableExecutablePath = String(
      installPlan?.enableExecutablePath ||
        installPlan?.enable_executable_path ||
        installPlan?.launchTarget ||
        installPlan?.launch_target ||
        ''
    ).trim()
    const enableExecutableBaseType = String(
      installPlan?.enableExecutableBaseType ||
        installPlan?.enable_executable_base_type ||
        installPlan?.launchTargetBaseType ||
        installPlan?.launch_target_base_type ||
        ''
    ).trim()
    const launchArgs = normalizeInstallRuleLaunchArgs(
      installPlan?.launchArgs || installPlan?.launch_args
    )
    const showInjectButton =
      normalizeInstallRuleOptionalBoolean(installPlan?.showInjectButton) === true ||
      normalizeInstallRuleOptionalBoolean(installPlan?.show_inject_button) === true
    const hasLaunchTarget = !!enableExecutablePath
    const isManualExecutable = launchAction === 'manual_execute' && hasLaunchTarget
    const isDefaultExecutable = launchAction === 'default_execute' && hasLaunchTarget
    const canInjectLaunch = launchAction === 'inject_mod' && hasLaunchTarget
    const isInjectable = canInjectLaunch && showInjectButton
    const isRunnable =
      isManualExecutable ||
      isDefaultExecutable ||
      isInjectable ||
      (!canInjectLaunch &&
        (executableType > 0 ||
          !!executablePath ||
          executablePaths.length > 0 ||
          (!!installPlan?.isRunnable && hasLaunchTarget)))

    return {
      id: toSafeId(item?.id),
      modId,
      optionId,
      fileId: optionId,
      sourceModKey: String(item?.source_mod_key || item?.sourceModKey || '').trim(),
      name: String(item?.name || metadata?.modName || '--').trim(),
      optionName: String(item?.option_name || item?.optionName || '').trim(),
      displayName: String(item?.name || item?.option_name || metadata?.modName || '--').trim(),
      description: String(
        item?.description || metadata?.description || metadata?.summary || ''
      ).trim(),
      version: String(item?.version || metadata?.version || '--').trim(),
      cover: String(item?.cover || metadata?.cover || '').trim(),
      installedAt: formatDate(item?.installed_at || item?.installedAt),
      isActive: Number(item?.is_active ?? item?.isActive ?? 1),
      priorityOrder: Number(item?.priority_order || item?.priorityOrder || 0),
      deployDomain: String(item?.deploy_domain || item?.deployDomain || '').trim(),
      installModel: String(item?.install_model || item?.installModel || 'managed').trim(),
      profileName: normalizeManagedProfileName(item?.profileName || item?.profile_name),
      archivePath: String(
        item?.archive_path || item?.archivePath || metadata?.archivePath || ''
      ).trim(),
      stagingPath: String(
        item?.staging_path || item?.stagingPath || metadata?.stagingPath || ''
      ).trim(),
      targetPath,
      sourceRootPath: String(item?.source_root_path || item?.sourceRootPath || '').trim(),
      files: safeParseArray(item?.files_json || item?.files),
      installPaths: safeParseArray(item?.install_paths_json || item?.installPaths),
      targetRelativePath: String(
        installPlan?.targetRelativePath || installPlan?.target_relative_path || ''
      ).trim(),
      targetBaseType: String(
        installPlan?.targetBaseType || installPlan?.target_base_type || 'game'
      ).trim(),
      installLocationText: installPathInfo.installLocationText,
      installLocationTooltip: installPathInfo.installLocationTooltip,
      primaryInstallPath: installPathInfo.primaryInstallPath,
      matchedRuleId: extractInstallRuleMatchedRuleId(installPlan),
      installRuleStrategy: String(installPlan?.strategy || '').trim(),
      executableInfo,
      executableType,
      executablePath,
      executablePaths,
      hasMultipleExecutables: executableType === 2 || executablePaths.length > 1,
      isRunnable,
      launchAction,
      showInjectButton,
      enableExecutablePath,
      enableExecutableBaseType,
      launchArgs,
      isManualExecutable,
      isDefaultExecutable,
      canInjectLaunch,
      isInjectable,
      sourcePageUrl: String(
        metadata?.sourcePageUrl ||
          metadata?.profileUrl ||
          (sourceSlug && modId
            ? `https://mod.io/g/${encodeURIComponent(sourceSlug)}/m/${encodeURIComponent(modId)}`
            : '')
      ).trim(),
      downloadUrl: String(item?.download_url || item?.downloadUrl || '').trim(),
      sourceType: 'modio',
      sourceLabel: MODIO_SOURCE_LABEL,
      metadata,
      dependencies: safeParseArray(item?.dependencies_json || item?.dependencies || []),
      raw: item
    }
  }

  function setModioOperationLoading(id = 0, loading = false) {
    const safeId = toSafeId(id)
    if (!safeId) return
    const next = { ...modioOperationLoadingMap.value }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    modioOperationLoadingMap.value = next
  }

  function setModioUpdating(id = 0, loading = false) {
    const safeId = toSafeId(id)
    if (!safeId) return
    const next = { ...modioUpdatingMap.value }
    if (loading) {
      next[safeId] = true
    } else {
      delete next[safeId]
    }
    modioUpdatingMap.value = next
  }

  async function loadModioInstalledList() {
    if (!resolvedModioGameId.value && !resolvedModioAppId.value) {
      modioInstalledList.value = []
      return
    }

    sourceErrorText.value = ''
    modioLoading.value = true
    try {
      await loadManagedSourceProfileStats(SOURCE_TYPE.MODIO)
      const profileName = getManagedSourceProfileValue(SOURCE_TYPE.MODIO)
      const result = await getInstalledModsBySourceService({
        appId: resolvedModioAppId.value,
        endpointType: 0,
        profileName,
        sourceMeta: withManagedSourceProfile(modioSourceMeta.value, profileName)
      })
      const records = Array.isArray(result?.records) ? result.records : []
      modioInstalledList.value = records.map((item) => normalizeModioRecord(item))
      priorityOrderDirty.value = false
      void hydrateModioInstalledTranslations(modioInstalledList.value)
    } catch (error) {
      console.error('读取 Mod.io 已安装模组失败', error)
      sourceErrorText.value = uiText('ui.couldNotReadInstalledModIoModsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
      modioInstalledList.value = []
    } finally {
      modioLoading.value = false
    }
  }

  async function toggleModioMod(item = {}, checked = false) {
    const id = toSafeId(item?.id)
    if (!id) return

    setModioOperationLoading(id, true)
    try {
      const result = await toggleNexusModStateService({
        id,
        isActive: !!checked
      })
      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotChangeState')))
      }
      $message.success(String(result?.message || '状态已更新'))
      await loadModioInstalledList()
    } catch (error) {
      console.error('切换 Mod.io 模组状态失败', error)
      $message.error(String(error?.message || '状态切换失败'))
    } finally {
      setModioOperationLoading(id, false)
    }
  }

  function toggleModioAll(enable = true) {
    if (!modioInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsAvailableForThisAction'))
      return
    }
    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.MODIO)

    const targetList = modioInstalledList.value.filter((item) =>
      enable ? !item.isActive : !!item.isActive
    )
    if (!targetList.length) {
      $message.warning(uiMessage('ui.noModIoModsCurrentlyRequireValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
      return
    }

    return openClientConfirmDialog({
      tone: enable ? 'default' : 'warning',
      toneLabel: uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      title: uiText('ui.applyValueToAllModIoModsInProfileValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')), value2: (profileName) }),
      subtitle: uiText('ui.valueMods', { value1: (targetList.length) }),
      description: uiText('ui.applyValueToAllModIoModsInTheCurrent', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      confirmText: uiText('ui.confirmValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }),
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Mod.io', 'default'),
        buildConfirmTag(uiText('ui.valueItems', { value1: (targetList.length) }), enable ? 'success' : 'warning')
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('目标操作', uiText('ui.batchActionValue', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
      ],
      impacts: [buildConfirmImpact('已经处于目标状态的模组会被自动跳过。')],
      async onConfirm() {
        modioBatchLoading.value = true
        try {
          if (!enable) {
            const result = await runProtectedBulkModAction(targetList, 'disable')
            await loadModioInstalledList()
            showBulkModActionResult(result, '禁用')
            return
          }
          for (const item of targetList) {
            await toggleNexusModStateService({
              id: toSafeId(item?.id),
              isActive: enable
            })
          }
          await loadModioInstalledList()
          $message.success(uiMessage('ui.batchActionValueComplete', { value1: (enable ? uiText('ui.enable') : uiText('ui.disable')) }))
        } finally {
          modioBatchLoading.value = false
        }
      }
    })
  }

  async function uninstallModioModItem(item = {}) {
    const id = toSafeId(item?.id)
    if (!id) return

    setModioOperationLoading(id, true)
    try {
      const result = await uninstallNexusModByIdService({ id })
      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.uninstallFailed')))
      }
      $message.success(String(result?.message || '已卸载模组'))
      await loadModioInstalledList()
    } catch (error) {
      console.error('卸载 Mod.io 模组失败', error)
      $message.error(String(error?.message || '卸载失败'))
    } finally {
      setModioOperationLoading(id, false)
    }
  }

  function uninstallModioModConfirm(item = {}) {
    return openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除确认',
      get title() { return uiText('ui.deleteThisModIoMod') },
      subtitle: resolveModDisplayName(item),
      get description() { return uiText('ui.thisModIoModWillBeRemovedFromTheCurrent') },
      get confirmText() { return uiText('ui.confirmDeletion') },
      get cancelText() { return uiText('ui.keepMod') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('Mod.io', 'default')],
      details: [buildConfirmDetail('模组名称', resolveModDisplayName(item))],
      impacts: [
        buildConfirmImpact('当前游戏将不再加载这个模组。', 'danger'),
        buildConfirmImpact('如需恢复，需要重新安装该模组。', 'danger')
      ],
      onConfirm() {
        return uninstallModioModItem(item)
      }
    })
  }

  function uninstallModioAll() {
    if (!modioInstalledList.value.length) {
      $message.warning(uiMessage('ui.thisSourceHasNoModsToUninstall'))
      return
    }

    const profileName = getManagedSourceProfileValue(SOURCE_TYPE.MODIO)
    const targetList = [...modioInstalledList.value]
    return openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '批量删除',
      title: uiText('ui.deleteAllModIoModsInProfileValue', { value1: (profileName) }),
      subtitle: uiText('ui.valueMods', { value1: (targetList.length) }),
      get description() { return uiText('ui.thisBatchOperationRemovesEveryModIoModInThe') },
      get confirmText() { return uiText('ui.deleteAll') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag('Mod.io', 'default'),
        buildConfirmTag(uiText('ui.valueItems', { value1: (targetList.length) }), 'danger')
      ],
      details: [
        buildConfirmDetail('管理配置', profileName),
        buildConfirmDetail('模组数量', uiText('ui.valueItems', { value1: (targetList.length) }))
      ],
      impacts: [
        buildConfirmImpact(uiText('ui.allModIoModsInProfileValueWillBeRemoved', { value1: (profileName) }), 'danger'),
        buildConfirmImpact('删除完成后不会自动恢复。', 'danger')
      ],
      async onConfirm() {
        modioBatchLoading.value = true
        try {
          const result = await runProtectedBulkModAction(targetList, 'delete')
          await loadModioInstalledList()
          showBulkModActionResult(result, '删除')
        } finally {
          modioBatchLoading.value = false
        }
      }
    })
  }

  function openModioSourcePage(item = {}) {
    const url = String(item?.sourcePageUrl || item?.downloadUrl || '').trim()
    if (!url) {
      $message.warning(uiMessage('ui.thisModHasNoSourceURLToOpen'))
      return
    }
    sendIpc('openBrowse', { url })
  }

  async function loadActiveSourceData({
    preserveError = false,
    forceSourceStatusCheck = false
  } = {}) {
    try {
      if (activeSource.value === SOURCE_TYPE.VERTEX) {
        if (!preserveError) {
          sourceErrorText.value = ''
        }
        initPage()
        await loadLocalLibraryList()
        return
      }
      if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
        await loadThunderstoreInstalledList()
        await loadLocalLibraryList()
        return
      }
      if (activeSource.value === SOURCE_TYPE.FICSIT) {
        await loadFicsitInstalledList()
        await loadLocalLibraryList()
        return
      }
      if (activeSource.value === SOURCE_TYPE.NEXUS) {
        await loadNexusInstalledList()
        await loadLocalLibraryList()
        return
      }
      if (activeSource.value === SOURCE_TYPE.MODIO) {
        await loadModioInstalledList()
        await loadLocalLibraryList()
      }
    } finally {
      triggerSourceStatusCheck({ force: forceSourceStatusCheck }).catch((error) => {
        console.warn('[模组源文件校验] 触发失败', error)
      })
    }
  }

  async function triggerSourceStatusCheck({ force = false } = {}) {
    const appId = String(resolvedSteamAppId.value || '').trim()
    if (!appId) return
    const ids = collectInactiveModIds()
    if (!ids.length) return
    const result = await invokeIpc('mod:checkSourceStatus', { appId, ids, force })
    if (!result?.success) return
    mergeSourceStatusResults(result.results || [])
  }

  function collectInactiveModIds() {
    const ids = []
    const lists = [
      clientList,
      nexusInstalledList,
      ficsitInstalledList,
      thunderstoreInstalledList,
      modioInstalledList
    ]
    for (const listRef of lists) {
      const items = listRef?.value
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (Number(item?.is_active ?? 0) === 1) continue
        const id = Number(item?.id || 0)
        if (id) ids.push(id)
      }
    }
    return ids
  }

  function mergeSourceStatusResults(results) {
    if (!Array.isArray(results) || !results.length) return
    const map = new Map()
    for (const r of results) {
      if (r && r.id !== undefined) map.set(Number(r.id), r)
    }
    const lists = [
      clientList,
      nexusInstalledList,
      ficsitInstalledList,
      thunderstoreInstalledList,
      modioInstalledList
    ]
    for (const listRef of lists) {
      const items = listRef?.value
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const r = map.get(Number(item?.id))
        if (r) item.source_status = r.status
      }
    }
  }

  async function initSourceContext() {
    sourceLoading.value = true
    try {
      activeSource.value = routeSourceType.value
      localLibraryList.value = []

      if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
        await resolveThunderstoreContext()
        if (!String(thunderstoreCommunity.value || '').trim()) {
          sourceErrorText.value = '当前 Thunderstore 游戏缺少社区标识，无法读取已安装模组'
          thunderstoreInstalledList.value = []
          return
        }
      } else if (activeSource.value === SOURCE_TYPE.FICSIT) {
        if (resolvedSteamAppId.value !== FICSIT_STEAM_APP_ID) {
          sourceErrorText.value = '当前记录不是 Ficsit 游戏，无法读取 Ficsit 模组'
          ficsitInstalledList.value = []
          return
        }
      } else if (activeSource.value === SOURCE_TYPE.NEXUS) {
        if (!resolvedNexusDomainName.value) {
          sourceErrorText.value = '当前 Nexus 游戏缺少域名标识，无法读取已安装模组'
          nexusInstalledList.value = []
          return
        }
      } else if (activeSource.value === SOURCE_TYPE.MODIO) {
        if (!resolvedModioGameId.value) {
          sourceErrorText.value = '当前 Mod.io 游戏缺少游戏 ID，无法读取已安装模组'
          modioInstalledList.value = []
          return
        }
      } else if (!resolvedGameId.value && !resolvedSteamAppId.value) {
        sourceErrorText.value = '当前游戏记录缺少必要标识，无法读取模组数据'
        clientList.value = []
        serverList.value = []
        return
      }

      sourceErrorText.value = ''
      resolveManagedSourceProfileContext()
      syncSourceStateToStore()
      await loadActiveSourceData()
    } finally {
      sourceLoading.value = false
    }
  }

  function initPage() {
    if (!isCurrentManagementRoute.value) {
      vertexLoading.value = false
      return
    }
    if (activeSource.value !== SOURCE_TYPE.VERTEX) {
      vertexLoading.value = false
      return
    }
    if (!current.value?.steamAppId) {
      vertexLoading.value = false
      return
    }
    vertexLoading.value = true
    sendIpc('getModListByAppId', { appId: current.value.steamAppId, gameRowId: String(route.query.legacyGameRowId || '') })
  }

  function compareVersions(res, type = 0, tab = lastComparedTab.value) {
    const isClientTab = tab === 'client'
    const list = isClientTab ? clientList.value : serverList.value

    if (!res?.length) {
      const clearedList = list.map((mod) => ({ ...mod, isUpdate: false }))
      if (isClientTab) {
        clientList.value = clearedList
        isShowAllUpdateClient.value = false
      } else {
        serverList.value = clearedList
        isShowAllUpdateServer.value = false
      }
      if (type === 1) {
        $message.success(uiMessage('ui.noNewerVersionFound'))
      }
      return
    }

    const updatedList = list.map((mod) => {
      const updateInfo = res.find((item) => item.id === mod.option_id)
      if (updateInfo) {
        return {
          ...mod,
          isUpdate: common.compareVersions(mod.version, updateInfo.version) !== 0
        }
      }
      return {
        ...mod,
        isUpdate: false
      }
    })
    const count = updatedList.filter((mod) => mod.isUpdate).length

    if (isClientTab) {
      clientList.value = updatedList
      isShowAllUpdateClient.value = count > 0
    } else {
      serverList.value = updatedList
      isShowAllUpdateServer.value = count > 0
    }

    if (type === 1) {
      const msg = count > 0 ? uiText('ui.valueModsHaveUpdatesAvailable', { value1: (count) }) : '未查询到可更新版本'
      $message.success(msg)
    }
  }

  function clearInvalidModRecord(item) {
    const id = Number(item?.id || 0)
    if (!id) {
      $message.warning(uiMessage('ui.modRecordNotFound'))
      return
    }
    const sourceStatus = String(item?.source_status || '').trim()
    if (sourceStatus !== 'missing') {
      $message.warning(uiMessage('ui.onlyInvalidModRecordsCanBeCleared'))
      return
    }
    openClientConfirmDialog({
      tone: 'warning',
      toneLabel: '清除确认',
      get title() { return uiText('ui.clearThisInvalidRecord') },
      subtitle: resolveModDisplayName(item),
      get description() { return uiText('ui.thisModSSourceFilesAreMissingClearingOnlyRemoves') },
      get confirmText() { return uiText('ui.clearRecord') },
      get cancelText() { return uiText('ui.keepRecord') },
      focusAction: 'cancel',
      tags: [buildConfirmTag('源文件缺失', 'danger')],
      details: [
        buildConfirmDetail('模组名称', resolveModDisplayName(item)),
        buildConfirmDetail('当前状态', '源文件缺失')
      ],
      impacts: [
        buildConfirmImpact('本地管理记录会被移除。', 'warning'),
        buildConfirmImpact('不会自动删除或下载任何文件。', 'default')
      ],
      onConfirm() {
        return invokeIpc('mod:clearInvalidRecord', { id })
          .then((res) => {
            if (res?.success) {
              $message.success(uiMessage('ui.invalidRecordCleared'))
              removeModFromInstalledLists(id)
            } else {
              $message.error(res?.message || '清除失败')
            }
          })
          .catch((err) => {
            console.error('[清除失效记录] 异常', err)
            $message.error(uiMessage('ui.couldNotClearRecord'))
          })
      }
    })
  }

  function removeModFromInstalledLists(id) {
    const numericId = Number(id || 0)
    if (!numericId) return
    const lists = [
      clientList,
      nexusInstalledList,
      ficsitInstalledList,
      thunderstoreInstalledList,
      modioInstalledList
    ]
    for (const listRef of lists) {
      if (!Array.isArray(listRef?.value)) continue
      listRef.value = listRef.value.filter((item) => Number(item?.id || 0) !== numericId)
    }
  }

  function updateModLockStateInInstalledLists(id, state) {
    const numericId = Number(id || 0)
    if (!numericId) return
    const lockState = String(state || '').trim()
    if (!lockState) return
    const lists = [
      clientList,
      nexusInstalledList,
      ficsitInstalledList,
      thunderstoreInstalledList,
      modioInstalledList
    ]
    for (const listRef of lists) {
      if (!Array.isArray(listRef?.value)) continue
      listRef.value = listRef.value.map((entry) => {
        if (Number(entry?.id || 0) !== numericId) return entry
        return {
          ...entry,
          source_lock_state: lockState,
          sourceLockState: lockState
        }
      })
    }
    if (Number(selectedCard.value?.raw?.id || 0) === numericId) {
      selectedCard.value.raw = {
        ...selectedCard.value.raw,
        source_lock_state: lockState,
        sourceLockState: lockState
      }
    }
  }

  function retryLockMod(item) {
    const id = Number(item?.id || 0)
    if (!id) {
      $message.warning(uiMessage('ui.modRecordNotFound'))
      return
    }
    if (!isManagedModEnabled(item)) {
      $message.info(uiMessage('ui.onlyEnabledModsNeedSourceFileLocking'))
      return
    }
    return invokeIpc('mod:retryLock', { id })
      .then((res) => {
        if (res?.state) updateModLockStateInInstalledLists(id, res.state)
        if (res?.success) {
          $message.success(res?.message || '已重新加锁')
          return
        }
        $message.error(res?.message || '重试加锁失败')
      })
      .catch((err) => {
        console.error('[重试加锁] 异常', err)
        $message.error(uiMessage('ui.couldNotRetryFileLocking'))
      })
  }

  function uninstallMod(item) {
    if (isBatchUninstalling.value) return
    const { name, type_id } = item
    if (type_id === 1) {
      openClientConfirmDialog({
        tone: 'danger',
        toneLabel: '前置依赖',
        get title() { return uiText('ui.deleteThisPrerequisiteMod') },
        subtitle: toDisplayText(name),
        get description() { return uiText('ui.thisIsAPrerequisiteModDeletingItMayPreventDependent') },
        get confirmText() { return uiText('ui.deleteAnyway') },
        get cancelText() { return uiText('ui.keepMod') },
        focusAction: 'cancel',
        tags: [
          buildConfirmTag(activeTabLabel.value, 'default'),
          buildConfirmTag('前置依赖', 'danger')
        ],
        details: [
          buildConfirmDetail('游戏', current.value?.chineseTitle),
          buildConfirmDetail('模组名称', name)
        ],
        impacts: [
          buildConfirmImpact('这个模组会从当前列表和安装目录中移除。', 'danger'),
          buildConfirmImpact('依赖它的部分模组可能无法正常工作。', 'warning')
        ],
        onConfirm() {
          cUninstallMod(item.id)
        }
      })
      return
    }

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '删除确认',
      get title() { return uiText('ui.deleteThisMod') },
      subtitle: toDisplayText(name),
      get description() { return uiText('ui.thisModWillBeRemovedFromTheInstalledList') },
      get confirmText() { return uiText('ui.confirmDeletion') },
      get cancelText() { return uiText('ui.keepMod') },
      focusAction: 'cancel',
      tags: [buildConfirmTag(activeTabLabel.value, 'default')],
      details: [
        buildConfirmDetail('游戏', current.value?.chineseTitle),
        buildConfirmDetail('模组名称', name)
      ],
      impacts: [
        buildConfirmImpact('当前环境将不再加载这个模组。'),
        buildConfirmImpact('如需恢复，需要重新下载安装。', 'danger')
      ],
      onConfirm() {
        cUninstallMod(item.id)
      }
    })
  }

  function cUninstallMod(id) {
    if (isBatchUninstalling.value) return
    sendIpc('uninstallMod', id)
  }

  function toggleModState(mod, checked) {
    if (isBatchUninstalling.value) return
    const targetState = checked ? 1 : 0

    // 先做前端乐观更新
    const previousState = mod.is_active
    mod.is_active = targetState

    invokeIpc('toggleModState', { id: mod.id, isActive: checked })
      .then((res) => {
        if (res.success) {
          $message.success(res.message)
          initPage()
        } else {
          $message.error(res.message)
          mod.is_active = previousState // 后端失败时恢复原状态
        }
      })
      .catch((err) => {
        console.error(err)
        $message.error(uiMessage('ui.couldNotChangeState'))
        mod.is_active = previousState
      })
  }

  function checkInstallPath(mod) {
    if (isBatchUninstalling.value) return
    const { install_paths_json, name } = mod
    showInstallPathRef.value.openFileBrowser(install_paths_json, name)
  }

  async function runProtectedBulkModAction(list = [], action = 'disable') {
    const ids = [
      ...new Set(
        (Array.isArray(list) ? list : [])
          .map((item) => Number(item?.id || 0))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    ]
    if (!ids.length) {
      return { success: true, total: 0, successCount: 0, failedCount: 0 }
    }
    try {
      const recordOnlyIds = action === 'delete'
        ? list.filter((item) => item.canRemoveRecordOnly === true).map((item) => Number(item.id))
        : []
      const result = await invokeIpc('mod:bulkAction', { action, ids, recordOnlyIds })
      return (
        result || {
          success: false,
          partial: false,
          message: uiText('ui.batchActionValueReturnedNoResult', { value1: (action === 'delete' ? uiText('modelSettings.remove') : uiText('ui.disable')) })
        }
      )
    } catch (error) {
      return {
        success: false,
        partial: false,
        message: String(error?.message || uiText('ui.batchActionFailedValue', { value1: (action === 'delete' ? uiText('modelSettings.remove') : uiText('ui.disable')) }))
      }
    }
  }

  function showBulkModActionResult(result = {}, actionName = '处理') {
    if (!result?.success && !result?.partial) {
      $message.error(String(result?.message || uiText('ui.batchActionFailedValue', { value1: (actionName) })))
      return
    }
    if (Number(result?.failedCount || 0) > 0 || result?.partial) {
      $message.warning(String(result?.message || uiText('ui.batchActionValueHadFailures', { value1: (actionName) })))
      return
    }
    $message.success(String(result?.message || uiText('ui.batchActionValueComplete', { value1: (actionName) })))
  }

  function batchToggleAll(enable) {
    if (isBatchUninstalling.value || !current.value?.steamAppId) return
    const total = activeListCount.value

    if (!total) {
      $message.warning(uiMessage('ui.noModsInTheCurrentValue', { value1: (activeTabLabel.value) }))
      return
    }

    const actionName = enable ? '启用' : '禁用'
    const actionType = enable ? 'enable' : 'disable'

    openClientConfirmDialog({
      tone: enable ? 'default' : 'warning',
      toneLabel: uiText('ui.batchActionValue', { value1: (actionName) }),
      title: uiText('ui.applyValueToTheCurrentValueMods', { value1: (actionName), value2: (activeTabLabel.value) }),
      subtitle: current.value?.chineseTitle || '--',
      description: uiText('ui.applyValueToValueModsInTheCurrentValue', { value1: (activeTabLabel.value), value2: (total), value3: (actionName) }),
      confirmText: uiText('ui.confirmValue', { value1: (actionName) }),
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag(activeTabLabel.value, 'default'),
        buildConfirmTag(uiText('ui.valueModsVariant2', { value1: (total) }), enable ? 'success' : 'warning')
      ],
      details: [
        buildConfirmDetail('游戏', current.value?.chineseTitle),
        buildConfirmDetail('目标范围', activeTabLabel.value),
        buildConfirmDetail('模组数量', uiText('ui.valueItems', { value1: (total) }))
      ],
      impacts: [
        buildConfirmImpact(
          enable ? '未启用的模组会被批量启用。' : '已启用的模组会被批量禁用。',
          enable ? 'success' : 'warning'
        ),
        buildConfirmImpact('已经处于目标状态的模组会被自动跳过。')
      ],
      onConfirm: async () => {
        isBatchUninstalling.value = true
        batchToggleType.value = actionType
        batchTargetCount.value = total

        let successCount = 0
        let failedCount = 0
        const list = activeTab.value === 'client' ? clientList.value : serverList.value

        if (!enable) {
          try {
            const result = await runProtectedBulkModAction(list, 'disable')
            showBulkModActionResult(result, actionName)
          } catch (error) {
            $message.error(String(error?.message || '批量禁用失败'))
          } finally {
            isBatchUninstalling.value = false
            batchToggleType.value = ''
            batchTargetCount.value = 0
            initPage()
          }
          return
        }

        for (const mod of list) {
          if ((enable && mod.is_active === 1) || (!enable && mod.is_active === 0)) {
            // 已经是目标状态时直接跳过
            continue
          }

          try {
            const res = await invokeIpc('toggleModState', { id: mod.id, isActive: enable })
            if (res.success) {
              successCount++
              mod.is_active = enable ? 1 : 0
            } else {
              failedCount++
            }
          } catch {
            failedCount++
          }
        }

        isBatchUninstalling.value = false
        batchToggleType.value = ''
        batchTargetCount.value = 0

        if (failedCount > 0) {
          $message.warning(
            uiMessage('ui.batchActionValueFinishedValueChangesSucceededAndValueFailed', { value1: (actionName), value2: (successCount), value3: (failedCount) })
          )
        } else {
          $message.success(uiMessage('ui.batchActionValueFinishedValueModsProcessedSuccessfully', { value1: (actionName), value2: (successCount) }))
        }

        initPage()
      }
    })
  }

  function batchUninstallAll() {
    if (isBatchUninstalling.value || !current.value?.steamAppId) return
    const type = activeTab.value === 'client' ? 0 : 1
    const total = activeListCount.value

    if (!total) {
      $message.warning(uiMessage('ui.noModsToUninstallInTheCurrentValue', { value1: (activeTabLabel.value) }))
      return
    }

    openClientConfirmDialog({
      tone: 'danger',
      toneLabel: '批量删除',
      title: uiText('ui.deleteAllModsInTheCurrentValue', { value1: (activeTabLabel.value) }),
      subtitle: current.value?.chineseTitle || '--',
      get description() { return uiText('ui.thisBatchOperationDisablesEachCurrentlyEnabledModBeforeDeleting') },
      get confirmText() { return uiText('ui.confirmDeletion') },
      get cancelText() { return uiText('ui.cancel') },
      focusAction: 'cancel',
      tags: [
        buildConfirmTag(activeTabLabel.value, 'default'),
        buildConfirmTag(uiText('ui.valueModsVariant2', { value1: (total) }), 'danger')
      ],
      details: [
        buildConfirmDetail('游戏', current.value?.chineseTitle),
        buildConfirmDetail('目标范围', activeTabLabel.value),
        buildConfirmDetail('模组数量', uiText('ui.valueItems', { value1: (total) }))
      ],
      impacts: [
        buildConfirmImpact('当前范围内的全部模组都会被删除。', 'danger'),
        buildConfirmImpact('系统会先处理仍在启用的模组，整个过程可能持续较长时间。', 'warning'),
        buildConfirmImpact('该操作不可自动恢复。', 'danger')
      ],
      onConfirm: async () => {
        isBatchUninstalling.value = true
        batchToggleType.value = 'uninstall'
        batchTargetCount.value = total

        const list = type === 0 ? clientList.value : serverList.value
        try {
          const result = await runProtectedBulkModAction(list, 'delete')
          showBulkModActionResult(result, '删除')
        } catch (error) {
          $message.error(String(error?.message || '批量删除失败'))
        } finally {
          isBatchUninstalling.value = false
          batchToggleType.value = ''
          batchTargetCount.value = 0
          initPage()
        }
      }
    })
  }

    const {
    clientConfirmDialog,
    localModManagerDialog,
    buildConfirmTag,
    buildConfirmImpact,
    buildConfirmDetail,
    openClientConfirmDialog,
    handleClientConfirm,
    handleClientCancel
  } = useModManagementDialogs({
    toDisplayText: (...args) => toDisplayText(...args)
  })

  const {
    thunderstoreProfile,
    thunderstoreProfileMenuOpen,
    thunderstoreProfileMenuRef,
    modioProfile,
    thunderstoreProfileOptions,
    modioProfileOptions,
    activeManagedProfileVisible,
    activeManagedProfile,
    activeManagedProfileOptions,
    isManagedSourceProfileBusy,
    normalizeManagedProfileName,
    isManagedSourceProfileSource,
    getManagedSourceProfileValue,
    getManagedSourceProfileCount,
    withManagedSourceProfile,
    loadManagedSourceProfileStats,
    resolveActiveSourceRegistryIdentifier,
    readActiveSourceRegistryProfile,
    resolveManagedSourceProfileContext,
    handleManagedSourceProfileSelect,
    readThunderstorePreferredProfile,
    toggleThunderstoreProfileMenu,
    closeThunderstoreProfileMenu,
    handleThunderstoreProfileSelect,
    handleThunderstoreProfileMenuPointerDown,
    removeThunderstoreProfileFromRegistry,
    syncThunderstorePreferredProfile,
    getThunderstoreInstalledCountByProfile,
    isThunderstoreProfileBusy
  } = useModManagementProfiles({
    SOURCE_TYPE,
    activeSource,
    current,
    ficsitLoading,
    ficsitOperationLoadingMap,
    ficsitSourceMeta,
    getRouteQueryText: (...args) => getRouteQueryText(...args),
    getRouteSourceIdText: (...args) => getRouteSourceIdText(...args),
    invokeIpc,
    loadActiveSourceData: (...args) => loadActiveSourceData(...args),
    modSearchKeyword,
    modioBatchLoading,
    modioLoading,
    modioOperationLoadingMap,
    modioSourceMeta,
    modioUpdatingMap,
    nexusBatchLoading,
    nexusLoading,
    nexusOperationLoadingMap,
    nexusSourceMeta,
    nexusUpdatingMap,
    normalizeSourceType: (...args) => normalizeSourceType(...args),
    priorityOrderDirty,
    resolvedModioAppId,
    resolvedModioGameId,
    resolvedNexusDomainName,
    resolvedSteamAppId,
    selectedModKey,
    syncSourceStateToStore: (...args) => syncSourceStateToStore(...args),
    thunderstoreBatchLoading,
    thunderstoreCommunity,
    thunderstoreOperationLoadingMap,
    thunderstoreProfileSummary,
    thunderstoreTogglingMap,
    thunderstoreUninstallAllLoading,
    thunderstoreUpdatingMap
  })

  const {
    thunderstoreUpdateRecords,
    updateCheckLoading,
    thunderstoreUpdateLookup,
    toSafeId,
    checkCurrentSourceUpdates,
    updateVertexAll,
    updateMod,
    updateNexusMod,
    updateNexusAll,
    updateModioMod,
    updateModioAll
  } = useModManagementUpdates({
    FICSIT_DOWNLOAD_BASE_URL,
    SOURCE_TYPE,
    activeSource,
    buildConfirmDetail: (...args) => buildConfirmDetail(...args),
    buildConfirmImpact: (...args) => buildConfirmImpact(...args),
    buildConfirmTag: (...args) => buildConfirmTag(...args),
    decorateNexusRecords: (...args) => decorateNexusRecords(...args),
    ficsitInstalledList,
    getCurrentModioApiConfig: (...args) => getCurrentModioApiConfig(...args),
    getNexusApiConfig: (...args) => getNexusApiConfig(...args),
    getUpdateContextKey: () => [
      boundManagementFullPath.value, isCurrentManagementRoute.value, activeSource.value,
      getManagedSourceProfileValue(activeSource.value), thunderstoreProfile.value
    ].join('|'),
    invokeIpc,
    modioInstalledList,
    nexusInstalledList,
    openClientConfirmDialog: (...args) => openClientConfirmDialog(...args),
    resolveModDisplayName: (...args) => resolveModDisplayName(...args),
    resolvedModioGameId,
    resolvedNexusDomainName,
    resolvedSteamAppId,
    startModioUpdateBatch: (...args) => startModioUpdateBatch(...args),
    startNexusUpdateBatch: (...args) => startNexusUpdateBatch(...args),
    thunderstoreCommunity,
    thunderstoreInstalledList,
    thunderstoreProfile
  })

  const {
    createInstallTaskFromLocalLibrary,
    updateThunderstorePackage,
    updateThunderstoreAll,
    updateFicsitMod,
    updateFicsitAll,
    startNexusUpdateBatch,
    startModioUpdateBatch
  } = useModManagementInstall({
    FICSIT_STEAM_APP_ID,
    SOURCE_TYPE,
    activeSource,
    buildConfirmDetail: (...args) => buildConfirmDetail(...args),
    buildConfirmImpact: (...args) => buildConfirmImpact(...args),
    buildConfirmTag: (...args) => buildConfirmTag(...args),
    current,
    downloadStore,
    ficsitInstalledList,
    ficsitLoading,
    getCurrentModioApiConfig: (...args) => getCurrentModioApiConfig(...args),
    getLocalLibraryItemId: (...args) => getLocalLibraryItemId(...args),
    getLocalLibraryProfileName: (...args) => getLocalLibraryProfileName(...args),
    getManagedSourceProfileValue: (...args) => getManagedSourceProfileValue(...args),
    getNexusApiConfig: (...args) => getNexusApiConfig(...args),
    getRouteQueryText: (...args) => getRouteQueryText(...args),
    invokeIpc,
    loadFicsitInstalledList: (...args) => loadFicsitInstalledList(...args),
    loadModioInstalledList: (...args) => loadModioInstalledList(...args),
    loadNexusInstalledList: (...args) => loadNexusInstalledList(...args),
    loadThunderstoreInstalledList: (...args) => loadThunderstoreInstalledList(...args),
    localLibraryTaskLoadingMap,
    localToolContext,
    modioBatchLoading,
    nexusBatchLoading,
    openClientConfirmDialog: (...args) => openClientConfirmDialog(...args),
    refreshCurrentSource: (...args) => refreshCurrentSource(...args),
    resolveModDisplayName: (...args) => resolveModDisplayName(...args),
    resolvedGameId,
    resolvedModioAppId,
    resolvedModioGameId,
    resolvedNexusDomainName,
    resolvedNexusGameId,
    resolvedSteamAppId,
    setFicsitUpdating: (...args) => setFicsitUpdating(...args),
    setLocalLibraryTaskLoading: (...args) => setLocalLibraryTaskLoading(...args),
    setModioUpdating: (...args) => setModioUpdating(...args),
    setNexusUpdating: (...args) => setNexusUpdating(...args),
    setThunderstoreUpdating: (...args) => setThunderstoreUpdating(...args),
    thunderstoreCommunity,
    thunderstoreProfile,
    thunderstoreUpdateLookup,
    thunderstoreUpdateRecords,
    thunderstoreUpdatingMap,
    toSafeId: (...args) => toSafeId(...args)
  })

  const {
    activeList,
    activeListCount,
    activeTabLabel,
    uninstallProgressText,
    resolveModDisplayName,
    toDisplayText,
    resolveFicsitDisableBlockedReason,
    resolveFicsitUninstallBlockedReason,
    getLocalBindingSourceLabel,
    isManagedModEnabled,
    currentCards,
    normalizedModSearchKeyword,
    displayCards,
    listHeadCount,
    filteredEnabledCount,
    thunderstorePages,
    selectedCard,
    selectedRelations,
    selectedDetailInfo,
    selectedDetailActions,
    selectMod,
    formatNumber,
    getDateTimestamp,
    getDisplayInitial,
    formatFileSize,
    formatDate
  } = useModManagementList({
    SOURCE_TYPE,
    activeSource,
    activeTab,
    batchTargetCount,
    batchToggleType,
    buildListDisplayTitle: (...args) => buildListDisplayTitle(...args),
    clientList,
    ficsitInstalledList,
    ficsitLoading,
    ficsitUpdatingMap,
    getLocalBindingItems: (...args) => getLocalBindingItems(...args),
    getLocalBindingMetadata: (...args) => getLocalBindingMetadata(...args),
    getLocalBoundRecordId: (...args) => getLocalBoundRecordId(...args),
    getLocalLibraryDisplayName: (...args) => getLocalLibraryDisplayName(...args),
    getLocalLibraryItemId: (...args) => getLocalLibraryItemId(...args),
    getLocalLibraryMetadata: (...args) => getLocalLibraryMetadata(...args),
    getLocalLibraryNormalizedSource: (...args) => getLocalLibraryNormalizedSource(...args),
    getLocalLibraryProfileName: (...args) => getLocalLibraryProfileName(...args),
    getLocalLibrarySourceLabel: (...args) => getLocalLibrarySourceLabel(...args),
    getLocalLibrarySourcePlatform: (...args) => getLocalLibrarySourcePlatform(...args),
    getTranslatedDescriptionBySource: (...args) => getTranslatedDescriptionBySource(...args),
    getTranslatedTitleBySource: (...args) => getTranslatedTitleBySource(...args),
    getVisibleLocalLibraryItems: (...args) => getVisibleLocalLibraryItems(...args),
    isBatchUninstalling,
    isFicsitOperationLoading: (...args) => isFicsitOperationLoading(...args),
    isLocalBoundMod: (...args) => isLocalBoundMod(...args),
    isLocalLibraryCard: (...args) => isLocalLibraryCard(...args),
    isNexusOperationLoading: (...args) => isNexusOperationLoading(...args),
    localLibraryTaskLoadingMap,
    modSearchKeyword,
    modioBatchLoading,
    modioOperationLoadingMap,
    modioProtocol,
    modioUpdatingMap,
    nexusBatchLoading,
    nexusInstalledList,
    nexusUpdatingMap,
    normalizeSourceType: (...args) => normalizeSourceType(...args),
    resolvedModioGameId,
    resolvedNexusDomainName,
    resolvedSteamAppId,
    selectedModKey,
    serverList,
    thunderstoreCommunity,
    thunderstorePage,
    thunderstorePageSize: THUNDERSTORE_MANAGER_PAGE_SIZE,
    thunderstoreLocalBoundList,
    thunderstoreProfile,
    thunderstoreProtocol,
    thunderstoreUpdatingMap
  })

  useIpc('getModListByAppIdSuccess', (data) => {
    if (!isCurrentManagementRoute.value || activeSource.value !== SOURCE_TYPE.VERTEX) return
    vertexLoading.value = false
    if (data?.success === false) $message.warning(data.message || '历史记录读取失败')
    const processModList = (targetList, sourceList) => {
      if (!sourceList.length) return []
      const targetMap = new Map(targetList.value.map((item) => [item.id, item]))
      return sourceList.map((item) => {
        const existing = targetMap.get(item.id)
        return existing ? { ...existing, ...item } : { ...item }
      })
    }

    clientList.value = processModList(clientList, data.clientList)
    serverList.value = processModList(serverList, data.serverList)
    priorityOrderDirty.value = false
    compareVersions(queriedData.value)
  })

  useIpc('uninstallModSuccess-modM', () => {
    if (!isCurrentManagementRoute.value || activeSource.value !== SOURCE_TYPE.VERTEX) return
    if (!isBatchUninstalling.value) {
      scheduleRefresh()
    }
  })

  useIpc('uninstallBatchDone', (data = {}) => {
    if (!isCurrentManagementRoute.value || activeSource.value !== SOURCE_TYPE.VERTEX) return
    const { total = 0, success = 0, failed = 0 } = data
    isBatchUninstalling.value = false
    batchTargetCount.value = 0
    batchToggleType.value = ''
    initPage()

    if (total === 0) {
      $message.info(uiMessage('ui.noInstalledModsFound'))
      return
    }

    if (failed > 0) {
      $message.warning(uiMessage('ui.batchUninstallCompleteValueSucceededValueFailed', { value1: (success), value2: (failed) }))
    } else {
      $message.success(uiMessage('ui.batchUninstallCompleteValueModsUninstalled', { value1: (success) }))
    }
  })

  useIpc('noInstalledFound', () => {
    if (!isCurrentManagementRoute.value || activeSource.value !== SOURCE_TYPE.VERTEX) return
    vertexLoading.value = false
    if (!isBatchUninstalling.value) {
      $message.info(uiMessage('ui.noInstalledModsFound'))
    }
  })

  useIpc('installModsSuccess-modM', () => {
    if (!isCurrentManagementRoute.value || activeSource.value !== SOURCE_TYPE.VERTEX) return
    if (updateCount.value > 0) {
      updateCount.value -= 1
    }
    if (current.value?.steamAppId) {
      increaseQuickLaunchWeight(current.value.steamAppId)
    }
    scheduleRefresh()
  })

  watch(
    current,
    (nv) => {
      if (!isCurrentManagementRoute.value) {
        return
      }
      setMenuName(nv?.chineseTitle)
      if (!nv?.steamAppId) return
    },
    { immediate: true }
  )

  watch(updateCount, (nv) => {
    if (nv === 0) isDisabledUpAll.value = false
  })

  watch([activeSource, activeTab], () => {
    modSearchKeyword.value = ''
    selectedModKey.value = ''
    priorityOrderDirty.value = false
    priorityDragKey.value = ''
  })

  // 当 displayCards 变化时，维护选中状态
  watch(
    () => displayCards.value,
    (cards) => {
      if (!cards.length) {
        selectedModKey.value = ''
        return
      }
      // 如果没有选中或选中项不在列表中，自动选中第一个
      if (!selectedModKey.value || !cards.find((c) => c.key === selectedModKey.value)) {
        selectedModKey.value = cards[0].key
      }
    },
    { immediate: false }
  )

  watch(modSearchKeyword, () => { thunderstorePage.value = 1 }, { flush: 'sync' })

  watch(thunderstoreProfile, () => {
    if (activeSource.value !== SOURCE_TYPE.THUNDERSTORE) return
    syncThunderstorePreferredProfile(thunderstoreProfile.value)
    syncSourceStateToStore()
    closeThunderstoreProfileMenu()
    thunderstorePage.value = 1
    loadThunderstoreInstalledList().then()
  })

  watch(
    () => thunderstorePages.value,
    (value) => {
      if (thunderstorePage.value > value) {
        thunderstorePage.value = value
      }
    }
  )

  watch(
    () => route.fullPath,
    async (newFullPath) => {
      if (String(newFullPath || '').trim() !== boundManagementFullPath.value) {
        return
      }
      ensureCurrentManagedGameFromRoute()
      await initSourceContext()
      await handleRouteInitialAction()
    }
  )

  // 监听全局配置方案注册表事件：mod-list 切换 / 离线包导入新建配置时，
  // 模组管理页需要立即重新解析当前生效 profile 并刷新对应来源的列表。
  // 模组管理页本身已不提供切换 UI（只展示当前 active profile），全靠外部事件驱动。
  function handleProfileRegistryUpdated(event) {
    const detail = event?.detail || {}
    const source = String(detail.source || '')
      .trim()
      .toLowerCase()
    if (source && source !== normalizeSourceType(activeSource.value)) return
    const detailIdentifier = String(detail.identifier || '')
      .trim()
      .toLowerCase()
    const currentIdentifier = String(
      resolveActiveSourceRegistryIdentifier(activeSource.value) || ''
    )
      .trim()
      .toLowerCase()
    if (detailIdentifier && currentIdentifier && detailIdentifier !== currentIdentifier) return
    resolveManagedSourceProfileContext()
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      thunderstoreProfile.value = normalizeManagedProfileName(
        readActiveSourceRegistryProfile(SOURCE_TYPE.THUNDERSTORE) || thunderstoreProfile.value
      )
    }
    syncSourceStateToStore()
    loadActiveSourceData({ preserveError: true }).catch((error) => {
      console.warn('[MOD_MANAGEMENT] 响应配置方案更新事件刷新失败', error)
    })
  }

  onMounted(() => {
    if (String(route.fullPath || '').trim() !== boundManagementFullPath.value) {
      return
    }
    ensureCurrentManagedGameFromRoute()
    loadAiSystemConfig()
      .then(() => hydrateActiveSourceTranslations())
      .catch((error) => {
        console.warn('[MOD_MANAGEMENT] 读取翻译配置失败', error)
      })
    initSourceContext().then(() => handleRouteInitialAction())
    document.addEventListener('pointerdown', handleThunderstoreProfileMenuPointerDown)
    if (typeof window !== 'undefined') {
      window.addEventListener(SOURCE_PROFILE_REGISTRY_UPDATED_EVENT, handleProfileRegistryUpdated)
    }
    if (sourceStatusPeriodicTimer === null) {
      sourceStatusPeriodicTimer = setInterval(() => {
        triggerSourceStatusCheck().catch((error) => {
          console.warn('[模组源文件校验] 定期校验失败', error)
        })
      }, SOURCE_STATUS_PERIODIC_INTERVAL)
    }
  })

  onUnmounted(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    if (sourceStatusPeriodicTimer !== null) {
      clearInterval(sourceStatusPeriodicTimer)
      sourceStatusPeriodicTimer = null
    }
    document.removeEventListener('pointerdown', handleThunderstoreProfileMenuPointerDown)
    if (typeof window !== 'undefined') {
      window.removeEventListener(
        SOURCE_PROFILE_REGISTRY_UPDATED_EVENT,
        handleProfileRegistryUpdated
      )
    }
  })

  function assignThunderstoreProfileMenuRef(element = null) {
    thunderstoreProfileMenuRef.value = element || null
  }

  function assignCompactListScrollRef(element = null) {
    compactListScrollRef.value = element || null
  }

  async function handleRouteInitialAction() {
    if (routeActionHandled) return
    const action = String(boundManagementQuery.value?.action || '').trim()
    if (!['manage-local-mod', 'bind-local', 'import-local-mod'].includes(action)) {
      return
    }
    routeActionHandled = true
    await nextTick()
    if (action === 'manage-local-mod' || action === 'bind-local' || action === 'import-local-mod') {
      localModManagerDialog.value = true
    }
  }

  const workspaceController = reactive({
    SOURCE_TYPE,
    sourceErrorText,
    workspaceTabs,
    activeSource,
    activeTab,
    isBatchUninstalling,
    thunderstoreProfileMenuOpen,
    isThunderstoreProfileBusy,
    thunderstoreProfile,
    thunderstoreProfileOptions,
    activeManagedProfileVisible,
    activeManagedProfile,
    activeManagedProfileOptions,
    isManagedSourceProfileBusy,
    toolbarScopeText,
    toolbarPrimaryActions,
    toolbarDangerActions,
    sideOverviewPills,
    uninstallProgressText,
    modSearchKeyword,
    localModManagerDialog,
    localToolContext,
    listHeadCount,
    filteredEnabledCount,
    prioritySortSupported,
    prioritySortHintText,
    priorityOrderDirty,
    priorityOrderSaving,
    priorityDragKey,
    currentListLoading,
    displayCards,
    currentDisplayEmptyState,
    selectedModKey,
    thunderstorePages,
    thunderstorePage,
    selectedCard,
    selectedRelations,
    selectedDetailInfo,
    selectedDetailActions,
    assignThunderstoreProfileMenuRef,
    toggleThunderstoreProfileMenu,
    handleThunderstoreProfileSelect,
    handleManagedSourceProfileSelect,
    deleteThunderstoreProfileConfirm,
    handleToolbarAction,
    savePriorityOrder,
    resetPriorityOrder,
    selectMod,
    handleListItemToggle,
    handleListItemDelete,
    handlePriorityDragStart,
    handlePriorityDragOver,
    handlePriorityDrop,
    handlePriorityDragEnd,
    assignCompactListScrollRef,
    changeThunderstorePage,
    handleDetailToggle,
    handleDetailAction,
    handleDetailDelete
  })

  return {
    workspaceController,
    showInstallPathRef,
    clientConfirmDialog,
    handleClientConfirm,
    handleClientCancel
  }
}
