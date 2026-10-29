import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, ref } from 'vue'
import { readSourceProfiles, writeSourceProfiles } from '@renderer/utils/source-profile-registry.js'

// 配置档案的读取、选择和持久化；来源身份与加载动作由协调入口提供。
export function useModManagementProfiles({
  SOURCE_TYPE,
  activeSource,
  current,
  ficsitLoading,
  ficsitOperationLoadingMap,
  ficsitSourceMeta,
  getRouteQueryText,
  getRouteSourceIdText,
  invokeIpc,
  loadActiveSourceData,
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
  normalizeSourceType,
  priorityOrderDirty,
  resolvedModioAppId,
  resolvedModioGameId,
  resolvedNexusDomainName,
  resolvedSteamAppId,
  selectedModKey,
  syncSourceStateToStore,
  thunderstoreBatchLoading,
  thunderstoreCommunity,
  thunderstoreOperationLoadingMap,
  thunderstoreProfileSummary,
  thunderstoreTogglingMap,
  thunderstoreUninstallAllLoading,
  thunderstoreUpdatingMap
}) {
  const THUNDERSTORE_PROFILE_STORAGE_KEY = 'vertex_thunderstore_profile_registry_v1'

  const thunderstoreProfile = ref('default')

  const thunderstoreProfileMenuOpen = ref(false)

  const thunderstoreProfileMenuRef = ref(null)

  const thunderstoreProfileRegistryVersion = ref(0)

  const ficsitProfile = ref('default')

  const ficsitProfileStats = ref([])

  const nexusProfile = ref('default')

  const nexusProfileStats = ref([])

  const modioProfile = ref('default')

  const modioProfileStats = ref([])

  const thunderstoreProfileOptions = computed(() => {
    void thunderstoreProfileRegistryVersion.value
    const community = String(thunderstoreCommunity.value || '')
      .trim()
      .toLowerCase()
    if (!community) return ['default']

    try {
      const raw = localStorage.getItem(THUNDERSTORE_PROFILE_STORAGE_KEY)
      if (!raw) return ['default']
      const parsed = JSON.parse(raw)
      const data = parsed && typeof parsed === 'object' ? parsed[community] : null
      const list = Array.isArray(data?.list) ? data.list : []
      const defaultProfile = String(data?.defaultProfile || 'default').trim() || 'default'
      const normalized = Array.from(
        new Set([defaultProfile, ...list].map((item) => String(item || '').trim()).filter(Boolean))
      )
      return normalized.length ? normalized : [defaultProfile]
    } catch {
      return ['default']
    }
  })

  const nexusLocalProfileRecord = computed(() =>
    readManagedSourceProfileRegistryRecord(
      SOURCE_TYPE.NEXUS,
      resolvedNexusDomainName.value || getRouteSourceIdText()
    )
  )

  const ficsitLocalProfileRecord = computed(() =>
    readManagedSourceProfileRegistryRecord(SOURCE_TYPE.FICSIT, resolvedSteamAppId.value)
  )

  const modioLocalProfileRecord = computed(() =>
    readManagedSourceProfileRegistryRecord(SOURCE_TYPE.MODIO, resolvedModioGameId.value)
  )

  const ficsitProfileOptions = computed(() =>
    buildManagedSourceProfileOptions(
      ficsitProfileStats.value,
      ficsitProfile.value,
      ficsitLocalProfileRecord.value.list,
      ficsitLocalProfileRecord.value.defaultProfile
    )
  )

  const nexusProfileOptions = computed(() =>
    buildManagedSourceProfileOptions(
      nexusProfileStats.value,
      nexusProfile.value,
      nexusLocalProfileRecord.value.list,
      nexusLocalProfileRecord.value.defaultProfile
    )
  )

  const modioProfileOptions = computed(() =>
    buildManagedSourceProfileOptions(
      modioProfileStats.value,
      modioProfile.value,
      modioLocalProfileRecord.value.list,
      modioLocalProfileRecord.value.defaultProfile
    )
  )

  const activeManagedProfileVisible = computed(() =>
    isManagedSourceProfileSource(activeSource.value)
  )

  const activeManagedProfile = computed(() => getManagedSourceProfileValue(activeSource.value))

  const activeManagedProfileOptions = computed(() =>
    getManagedSourceProfileOptions(activeSource.value)
  )

  const isManagedSourceProfileBusy = computed(() => {
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return (
        ficsitLoading.value || Object.values(ficsitOperationLoadingMap.value || {}).some(Boolean)
      )
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return (
        nexusLoading.value ||
        nexusBatchLoading.value ||
        Object.values(nexusOperationLoadingMap.value || {}).some(Boolean) ||
        Object.values(nexusUpdatingMap.value || {}).some(Boolean)
      )
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return (
        modioLoading.value ||
        modioBatchLoading.value ||
        Object.values(modioOperationLoadingMap.value || {}).some(Boolean) ||
        Object.values(modioUpdatingMap.value || {}).some(Boolean)
      )
    }
    return false
  })

  function normalizeManagedProfileName(profileName = '') {
    return String(profileName || 'default').trim() || 'default'
  }

  function normalizeManagedProfileRegistryKey(value = '') {
    return String(value || '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase()
  }

  function sanitizeManagedSourceProfileList(list = [], defaultProfileName = 'default') {
    const result = []
    const seen = new Set()
    const pushProfile = (value = '') => {
      const profileName = normalizeManagedProfileName(value)
      const normalized = profileName.toLowerCase() === 'default' ? 'default' : profileName
      const key = normalized.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      result.push(normalized)
    }
    pushProfile(defaultProfileName)
    for (const item of Array.isArray(list) ? list : []) {
      pushProfile(item)
    }
    return result
  }

  function readManagedSourceProfileRegistryRecord(sourceType = '', identifier = '') {
    const sourceKey = normalizeManagedProfileRegistryKey(sourceType)
    const identifierKey = normalizeManagedProfileRegistryKey(identifier)
    if (!sourceKey || !identifierKey) {
      return { list: ['default'], selected: 'default', defaultProfile: 'default' }
    }
    try {
      return readSourceProfiles(sourceKey, identifierKey)
    } catch {
      return { list: ['default'], selected: 'default', defaultProfile: 'default' }
    }
  }

  function isManagedSourceProfileSource(sourceType = '') {
    return [SOURCE_TYPE.FICSIT, SOURCE_TYPE.NEXUS, SOURCE_TYPE.MODIO].includes(
      normalizeSourceType(sourceType)
    )
  }

  function getManagedSourceProfileRef(sourceType = activeSource.value) {
    const normalizedSource = normalizeSourceType(sourceType)
    if (normalizedSource === SOURCE_TYPE.FICSIT) return ficsitProfile
    if (normalizedSource === SOURCE_TYPE.NEXUS) return nexusProfile
    if (normalizedSource === SOURCE_TYPE.MODIO) return modioProfile
    return null
  }

  function getManagedSourceProfileStatsRef(sourceType = activeSource.value) {
    const normalizedSource = normalizeSourceType(sourceType)
    if (normalizedSource === SOURCE_TYPE.FICSIT) return ficsitProfileStats
    if (normalizedSource === SOURCE_TYPE.NEXUS) return nexusProfileStats
    if (normalizedSource === SOURCE_TYPE.MODIO) return modioProfileStats
    return null
  }

  function getManagedSourceProfileValue(sourceType = activeSource.value) {
    const profileRef = getManagedSourceProfileRef(sourceType)
    return normalizeManagedProfileName(profileRef?.value)
  }

  function buildManagedSourceProfileOptions(
    stats = [],
    currentProfile = '',
    extraProfiles = [],
    defaultProfileName = 'default'
  ) {
    const current = normalizeManagedProfileName(currentProfile)
    const safeDefaultProfile = normalizeManagedProfileName(defaultProfileName)
    const profileMap = new Map()
    profileMap.set(safeDefaultProfile.toLowerCase(), {
      profileName: safeDefaultProfile,
      totalCount: 0,
      activeCount: 0
    })
    profileMap.set(current.toLowerCase(), { profileName: current, totalCount: 0, activeCount: 0 })

    for (const item of sanitizeManagedSourceProfileList(extraProfiles, safeDefaultProfile)) {
      const profileName = normalizeManagedProfileName(item)
      if (!profileMap.has(profileName.toLowerCase())) {
        profileMap.set(profileName.toLowerCase(), { profileName, totalCount: 0, activeCount: 0 })
      }
    }

    for (const item of Array.isArray(stats) ? stats : []) {
      const profileName = normalizeManagedProfileName(item?.profileName)
      profileMap.set(profileName.toLowerCase(), {
        profileName,
        totalCount: Number(item?.totalCount || 0),
        activeCount: Number(item?.activeCount || 0)
      })
    }

    return Array.from(profileMap.values()).map((item) => {
      const isDefault = item.profileName.toLowerCase() === safeDefaultProfile.toLowerCase()
      return {
        label: uiText('ui.valueValueItemsVariant2', { value1: (isDefault ? uiText('ui.valueDefault', { value1: (item.profileName) }) : item.profileName), value2: (Number(
          item.totalCount || 0
        )) }),
        value: item.profileName,
        totalCount: Number(item.totalCount || 0),
        activeCount: Number(item.activeCount || 0)
      }
    })
  }

  function getManagedSourceProfileOptions(sourceType = activeSource.value) {
    const normalizedSource = normalizeSourceType(sourceType)
    if (normalizedSource === SOURCE_TYPE.FICSIT) return ficsitProfileOptions.value
    if (normalizedSource === SOURCE_TYPE.NEXUS) return nexusProfileOptions.value
    if (normalizedSource === SOURCE_TYPE.MODIO) return modioProfileOptions.value
    return []
  }

  function getManagedSourceProfileStats(sourceType = activeSource.value) {
    const statsRef = getManagedSourceProfileStatsRef(sourceType)
    return Array.isArray(statsRef?.value) ? statsRef.value : []
  }

  function getManagedSourceProfileCount(sourceType = activeSource.value, profileName = '') {
    const targetProfile = normalizeManagedProfileName(profileName).toLowerCase()
    const matched = getManagedSourceProfileStats(sourceType).find(
      (item) => normalizeManagedProfileName(item?.profileName).toLowerCase() === targetProfile
    )
    return Number(matched?.totalCount || 0)
  }

  function withManagedSourceProfile(sourceMeta = {}, profileName = '') {
    const safeProfileName = normalizeManagedProfileName(profileName)
    return {
      ...(sourceMeta && typeof sourceMeta === 'object' ? sourceMeta : {}),
      profileName: safeProfileName,
      targetProfileName: safeProfileName
    }
  }

  function buildManagedSourceProfileStatsPayload(sourceType = activeSource.value) {
    const normalizedSource = normalizeSourceType(sourceType)
    if (normalizedSource === SOURCE_TYPE.FICSIT) {
      return {
        ...ficsitSourceMeta.value,
        appId: resolvedSteamAppId.value,
        endpointType: 0
      }
    }
    if (normalizedSource === SOURCE_TYPE.NEXUS) {
      return {
        ...nexusSourceMeta.value,
        domainName: resolvedNexusDomainName.value,
        appId: resolvedSteamAppId.value,
        endpointType: 0
      }
    }
    if (normalizedSource === SOURCE_TYPE.MODIO) {
      return {
        ...modioSourceMeta.value,
        appId: resolvedModioAppId.value,
        endpointType: 0
      }
    }
    return null
  }

  async function loadManagedSourceProfileStats(sourceType = activeSource.value) {
    if (!isManagedSourceProfileSource(sourceType)) return
    const statsRef = getManagedSourceProfileStatsRef(sourceType)
    const payload = buildManagedSourceProfileStatsPayload(sourceType)
    if (!statsRef || !payload) return

    try {
      const result = await invokeIpc('sourceProfile:stats', payload, { profiles: [] })
      statsRef.value = Array.isArray(result?.profiles) ? result.profiles : []
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] 读取来源配置统计失败', error)
      statsRef.value = []
    }
  }

  function resolveActiveSourceRegistryIdentifier(sourceType = activeSource.value) {
    const normalized = normalizeSourceType(sourceType)
    if (normalized === SOURCE_TYPE.NEXUS) {
      return String(resolvedNexusDomainName.value || '').trim()
    }
    if (normalized === SOURCE_TYPE.FICSIT) {
      return String(resolvedSteamAppId.value || '').trim()
    }
    if (normalized === SOURCE_TYPE.MODIO) {
      return String(resolvedModioGameId.value || '').trim()
    }
    if (normalized === SOURCE_TYPE.THUNDERSTORE) {
      return String(thunderstoreCommunity.value || '').trim()
    }
    return ''
  }

  function readActiveSourceRegistryProfile(sourceType = activeSource.value) {
    if (!isManagedSourceProfileSource(sourceType)) return ''
    const identifier = resolveActiveSourceRegistryIdentifier(sourceType)
    if (!identifier) return ''
    try {
      const record = readSourceProfiles(sourceType, identifier)
      return String(record?.selected || '').trim()
    } catch {
      return ''
    }
  }

  function resolveManagedSourceProfileContext() {
    if (!isManagedSourceProfileSource(activeSource.value)) return
    const profileRef = getManagedSourceProfileRef(activeSource.value)
    if (!profileRef) return
    // 优先级：来源 profile 注册表 > 路由 ?profile= > store > 'default'。
    // 注册表是 mod-list 切换 / 离线包导入新建配置后唯一可靠的最新状态；
    // 路由和 store 只在跨页面跳转时携带值，无法响应同窗口内的注册表变化。
    const registryProfile = readActiveSourceRegistryProfile()
    const routeProfile = getRouteQueryText('profile')
    const storeProfile = String(current.value?.sourceProfile || '').trim()
    profileRef.value = normalizeManagedProfileName(
      registryProfile || routeProfile || storeProfile || 'default'
    )
  }

  function handleManagedSourceProfileSelect(profileName = '') {
    if (!isManagedSourceProfileSource(activeSource.value) || isManagedSourceProfileBusy.value) {
      return
    }
    const profileRef = getManagedSourceProfileRef(activeSource.value)
    const nextProfile = normalizeManagedProfileName(profileName)
    if (!profileRef || nextProfile === normalizeManagedProfileName(profileRef.value)) {
      return
    }
    profileRef.value = nextProfile
    modSearchKeyword.value = ''
    selectedModKey.value = ''
    priorityOrderDirty.value = false
    syncSourceStateToStore()
    loadActiveSourceData().then()
  }

  function readThunderstorePreferredProfile(community = '') {
    const safeCommunity = String(community || '')
      .trim()
      .toLowerCase()
    if (!safeCommunity) {
      return 'default'
    }

    try {
      const raw = localStorage.getItem(THUNDERSTORE_PROFILE_STORAGE_KEY)
      if (!raw) return 'default'
      const parsed = JSON.parse(raw)
      const data = parsed && typeof parsed === 'object' ? parsed[safeCommunity] : null
      const selected = String(data?.selected || '').trim()
      const defaultProfile = String(data?.defaultProfile || 'default').trim() || 'default'
      return selected || defaultProfile
    } catch {
      return 'default'
    }
  }

  function toggleThunderstoreProfileMenu() {
    if (activeSource.value !== SOURCE_TYPE.THUNDERSTORE || isThunderstoreProfileBusy.value) {
      return
    }
    thunderstoreProfileMenuOpen.value = !thunderstoreProfileMenuOpen.value
  }

  function closeThunderstoreProfileMenu() {
    thunderstoreProfileMenuOpen.value = false
  }

  function handleThunderstoreProfileSelect(profileName = '') {
    const nextProfile = String(profileName || '').trim()
    if (
      !nextProfile ||
      nextProfile === thunderstoreProfile.value ||
      isThunderstoreProfileBusy.value
    ) {
      closeThunderstoreProfileMenu()
      return
    }
    thunderstoreProfile.value = nextProfile
    closeThunderstoreProfileMenu()
  }

  function handleThunderstoreProfileMenuPointerDown(event) {
    const root = thunderstoreProfileMenuRef.value
    if (!root) {
      return
    }
    if (event?.target instanceof Node && !root.contains(event.target)) {
      closeThunderstoreProfileMenu()
    }
  }

  function writeThunderstoreProfileRegistry(community = '', payload = {}) {
    const safeCommunity = String(community || '')
      .trim()
      .toLowerCase()
    if (!safeCommunity) {
      return
    }

    try {
      const raw = localStorage.getItem(THUNDERSTORE_PROFILE_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const storage = parsed && typeof parsed === 'object' ? parsed : {}
      const currentRecord =
        storage[safeCommunity] && typeof storage[safeCommunity] === 'object'
          ? storage[safeCommunity]
          : {}
      const defaultProfile =
        String(payload?.defaultProfile || currentRecord?.defaultProfile || 'default').trim() ||
        'default'
      const list = Array.from(
        new Set(
          [defaultProfile, ...(Array.isArray(payload?.list) ? payload.list : [])]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      )
      const selected = String(payload?.selected || '').trim()
      writeSourceProfiles(
        'thunderstore',
        safeCommunity,
        list,
        selected && list.includes(selected) ? selected : list[0] || defaultProfile,
        { defaultProfileName: defaultProfile }
      )
      thunderstoreProfileRegistryVersion.value += 1
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] 写入 Thunderstore 配置注册表失败', error)
    }
  }

  function removeThunderstoreProfileFromRegistry(community = '', profileName = '') {
    const safeCommunity = String(community || '')
      .trim()
      .toLowerCase()
    const safeProfileName = String(profileName || '').trim()
    if (!safeCommunity || !safeProfileName) {
      return ['default']
    }

    try {
      const raw = localStorage.getItem(THUNDERSTORE_PROFILE_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const storage = parsed && typeof parsed === 'object' ? parsed : {}
      const currentRecord =
        storage[safeCommunity] && typeof storage[safeCommunity] === 'object'
          ? storage[safeCommunity]
          : {}
      const defaultProfile = String(currentRecord?.defaultProfile || 'default').trim() || 'default'
      const nextList = Array.from(
        new Set(
          [defaultProfile, ...(Array.isArray(currentRecord?.list) ? currentRecord.list : [])]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      ).filter((item) => item.toLowerCase() !== safeProfileName.toLowerCase())
      const safeNextList = nextList.length ? nextList : [defaultProfile]
      const selected = String(currentRecord?.selected || '').trim()
      const nextSelected =
        selected && selected.toLowerCase() !== safeProfileName.toLowerCase()
          ? safeNextList.includes(selected)
            ? selected
            : safeNextList[0]
          : safeNextList[0]
      writeSourceProfiles('thunderstore', safeCommunity, safeNextList, nextSelected, {
        defaultProfileName: defaultProfile
      })
      thunderstoreProfileRegistryVersion.value += 1
      return safeNextList
    } catch (error) {
      console.warn('[MOD_MANAGEMENT] 删除 Thunderstore 配置注册表项失败', error)
      return thunderstoreProfileOptions.value
    }
  }

  function syncThunderstorePreferredProfile(profileName = '') {
    const community = String(thunderstoreCommunity.value || '')
      .trim()
      .toLowerCase()
    if (!community) {
      return
    }
    writeThunderstoreProfileRegistry(community, {
      list: thunderstoreProfileOptions.value,
      selected: profileName || 'default'
    })
  }

  function getThunderstoreInstalledCountByProfile(profileName = '') {
    const targetProfile = String(profileName || '')
      .trim()
      .toLowerCase()
    if (!targetProfile) {
      return 0
    }

    const stats = Array.isArray(thunderstoreProfileSummary.value?.stats)
      ? thunderstoreProfileSummary.value.stats
      : []
    const matched = stats.find(
      (item) =>
        String(item?.profileName || '')
          .trim()
          .toLowerCase() === targetProfile
    )
    return Number(matched?.count || 0)
  }

  const isThunderstoreProfileBusy = computed(() => {
    if (activeSource.value !== SOURCE_TYPE.THUNDERSTORE) {
      return false
    }
    if (thunderstoreBatchLoading.value || thunderstoreUninstallAllLoading.value) {
      return true
    }
    if (Object.values(thunderstoreOperationLoadingMap.value || {}).some(Boolean)) {
      return true
    }
    if (Object.values(thunderstoreTogglingMap.value || {}).some(Boolean)) {
      return true
    }
    if (Object.values(thunderstoreUpdatingMap.value || {}).some(Boolean)) {
      return true
    }
    return false
  })

  return {
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
  }
}
