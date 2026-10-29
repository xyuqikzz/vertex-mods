import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../i18n/message.js'
import { computed, onScopeDispose, ref } from 'vue'
import { $message } from '@renderer/common/message.js'
import { resolveGameNameFromDict } from '@renderer/utils/game-name-dict.js'
import { getNexusModList, NEXUS_MOD_LIST_TYPE } from '@renderer/utils/nexus-api.js'
import { applyEffectiveNexusApiConfig } from '@renderer/utils/nexus-api-config.js'
import { resolveEdgeSearchKeyword } from '@renderer/utils/ai-translation.js'
import { normalizeNexusModList as normalizeNexusModListService } from './nexus-service.js'

// Nexus 查询、分页缓存及返回恢复。授权配置与游戏身份由页面协调层传入。
export function useNexusListQuery({
  applyRouteBaseInfo,
  buildCurrentPageSignature,
  gameBaseInfo,
  getNexusApiConfig,
  hasNexusApiKey,
  hydrateNexusGameBaseInfoFromApi,
  normalizeSystemConfig,
  requestSystemConfig,
  setPageMenuNameAfterFirstInit,
  systemConfig,
  toSafeNumber
}) {
  const pendingRemotePageRequestMap = new Map()
  let queryGeneration = 0
  let navigationGeneration = 0
  let disposed = false
  const isCurrent = (generation) => !disposed && generation === queryGeneration
  onScopeDispose(() => {
    disposed = true
    queryGeneration++
    nexusSearchResolveToken++
    pendingRemotePageRequestMap.clear()
  })

  const loading = ref(false)

  const listType = ref(NEXUS_MOD_LIST_TYPE.TRENDING)

  const query = ref({
    page: 1,
    limit: 40,
    keyword: '',
    effectiveKeyword: ''
  })

  const keywordInput = ref(String(query.value.keyword || ''))

  const modList = ref([])

  const remotePageCache = ref({})

  const remoteHasMorePage = ref(false)

  const remoteTotalCount = ref(0)

  const currentViewTotalCount = ref(0)

  let nexusSearchResolveToken = 0

  const hasBootstrapped = ref(false)

  const initInProgress = ref(false)

  const lastLoadedPageSignature = ref('')

  const lastLoadedApiKey = ref('')

  const typeOptions = [
    { get label() { return uiText('tools.recentlyUpdated') }, value: NEXUS_MOD_LIST_TYPE.LATEST_UPDATED },
    { get label() { return uiText('ui.newestReleases') }, value: NEXUS_MOD_LIST_TYPE.LATEST_ADDED },
    { get label() { return uiText('ui.mostPopular') }, value: NEXUS_MOD_LIST_TYPE.TRENDING }
  ]

  function normalizeNexusModList(list = []) {
    return normalizeNexusModListService(list, gameBaseInfo.value.domainName)
  }

  function clearRemoteModPagination() {
    queryGeneration++
    remotePageCache.value = {}
    remoteHasMorePage.value = false
    currentViewTotalCount.value = 0
    modList.value = []
    pendingRemotePageRequestMap.clear()
  }

  function rebuildModListByRemotePages() {
    const pageNumbers = Object.keys(remotePageCache.value)
      .map((item) => toSafeNumber(item, 0))
      .filter((item) => item > 0)
      .sort((a, b) => a - b)

    const merged = []
    const keySet = new Set()
    for (const pageNumber of pageNumbers) {
      const pageRecords = Array.isArray(remotePageCache.value[pageNumber])
        ? remotePageCache.value[pageNumber]
        : []
      for (const record of pageRecords) {
        const modId = toSafeNumber(record?.modId, 0)
        const key = modId || String(record?.id || '')
        if (!key || keySet.has(key)) continue
        keySet.add(key)
        merged.push(record)
      }
    }

    modList.value = merged
  }

  async function loadRemoteModPage(page = 1, force = false) {
    const generation = queryGeneration
    const safePage = Math.max(toSafeNumber(page, 1), 1)
    if (!force && Array.isArray(remotePageCache.value[safePage])) {
      return remotePageCache.value[safePage]
    }

    if (pendingRemotePageRequestMap.has(safePage)) {
      return await pendingRemotePageRequestMap.get(safePage)
    }

    const domainName = String(gameBaseInfo.value.domainName || '').trim()
    const requestPromise = (async () => {
      const listResponse = await getNexusModList(domainName, getNexusApiConfig(), listType.value, {
        page: safePage,
        limit: query.value.limit,
        keyword: query.value.effectiveKeyword || query.value.keyword
      })
      if (!isCurrent(generation)) return null

      const rawList = Array.isArray(listResponse?.list) ? listResponse.list : []
      const count = toSafeNumber(listResponse?.totalCount, 0)
      await hydrateNexusGameBaseInfoFromApi(listResponse?.game, count)
      if (!isCurrent(generation)) return null

      // 只有在非搜索加载时才维持最大记录，如果正在搜索则直接把 totalCount 等调为当前真实数目
      const currentKeyword = String(query.value.keyword || '').trim()
      currentViewTotalCount.value = count

      if (!currentKeyword) {
        remoteTotalCount.value = count
      } else if (count > remoteTotalCount.value) {
        remoteTotalCount.value = count
      }

      const normalized = normalizeNexusModList(rawList)

      const nextCache = {
        ...remotePageCache.value,
        [safePage]: normalized
      }
      remotePageCache.value = nextCache

      const lastPageRecords = Array.isArray(normalized) ? normalized : []
      remoteHasMorePage.value = lastPageRecords.length >= query.value.limit

      rebuildModListByRemotePages()
      return normalized
    })()

    pendingRemotePageRequestMap.set(safePage, requestPromise)
    try {
      return await requestPromise
    } finally {
      if (pendingRemotePageRequestMap.get(safePage) === requestPromise) {
        pendingRemotePageRequestMap.delete(safePage)
      }
    }
  }

  async function ensureRemotePagesUntil(targetPage = 1) {
    const records = await loadRemoteModPage(targetPage)
    if (records && records.length === 0) {
      remoteHasMorePage.value = false
    }
  }

  const total = computed(() => {
    return currentViewTotalCount.value
  })

  const pages = computed(() => {
    if (!hasNexusApiKey.value) return 1
    return Math.max(Math.ceil(total.value / query.value.limit), 1)
  })

  const pageMods = computed(() => {
    const currentPageData = remotePageCache.value[query.value.page]
    if (Array.isArray(currentPageData)) {
      return currentPageData
    }

    return []
  })

  async function changePage(targetPage) {
    const generation = queryGeneration
    const navigation = ++navigationGeneration
    loading.value = true
    try {
      await ensureRemotePagesUntil(targetPage)
      if (!isCurrent(generation) || navigation !== navigationGeneration) return
      query.value.page = targetPage
    } catch (error) {
      if (!isCurrent(generation) || navigation !== navigationGeneration) return
      console.error('加载更多 Nexus 模组失败', error)
      $message.warning(uiMessage('ui.couldNotLoadMoreModsPleaseTryAgainLater'))
    } finally {
      if (isCurrent(generation) && navigation === navigationGeneration) loading.value = false
    }
  }

  async function handleSearch() {
    const currentToken = ++nexusSearchResolveToken
    const keyword = String(keywordInput.value || '').trim()
    if (keyword && keyword.length < 3) {
      $message.warning(uiMessage('ui.enterAtLeast3CharactersToSearch'))
      return
    }
    const resolvedKeyword = await resolveEdgeSearchKeyword({
      keyword,
      source: 'nexus',
      scene: 'mod_search_keyword',
      systemConfig: systemConfig.value,
      context: 'Nexus 模组搜索'
    })
    if (
      disposed ||
      currentToken !== nexusSearchResolveToken ||
      String(keywordInput.value || '').trim() !== keyword
    ) {
      return
    }
    query.value.keyword = keyword
    query.value.effectiveKeyword = resolvedKeyword.effectiveKeyword
    query.value.page = 1
    await loadModList()
  }

  async function loadModList() {
    if (disposed) return
    const domainName = String(gameBaseInfo.value.domainName || '').trim()
    if (!domainName) {
      $message.warning(uiMessage('ui.gameIdentifierMissingCannotLoadMods'))
      return
    }

    if (!hasNexusApiKey.value) {
      clearRemoteModPagination()
      return
    }

    loading.value = true
    clearRemoteModPagination()
    const generation = queryGeneration
    try {
      await ensureRemotePagesUntil(1)
      if (!isCurrent(generation)) return
      query.value.page = 1
    } catch (error) {
      if (!isCurrent(generation)) return
      console.error('加载 Nexus 模组列表失败', error)
      $message.warning(uiMessage('ui.couldNotLoadNexusModsCheckYourAPIKeyOr'))
    } finally {
      if (isCurrent(generation)) loading.value = false
    }
  }

  async function resolveNexusGameDisplayName() {
    const rawName = String(gameBaseInfo.value?.name || gameBaseInfo.value?.domainName || '').trim()
    if (!rawName) {
      return
    }

    try {
      const resolved = await resolveGameNameFromDict({
        sourcePlatform: 'nexus',
        rawName,
        fallbackName: gameBaseInfo.value?.name || gameBaseInfo.value?.domainName
      })
      const displayName = String(resolved?.displayName || '').trim()
      if (displayName && !disposed) {
        gameBaseInfo.value = {
          ...gameBaseInfo.value,
          englishTitle: gameBaseInfo.value.englishTitle || resolved?.rawName || rawName,
          name: displayName
        }
      }
    } catch (error) {
      console.warn('[Nexus] 游戏中文名字典解析失败', error)
    }
  }

  async function initPageData(force = false) {
    if (disposed) return
    if (initInProgress.value && !force) return

    initInProgress.value = true
    applyRouteBaseInfo()
    try {
      await resolveNexusGameDisplayName()
      const config = await applyEffectiveNexusApiConfig(
        normalizeSystemConfig(await requestSystemConfig())
      )
      if (disposed) return
      systemConfig.value = config
      const currentPageSignature = buildCurrentPageSignature()
      const currentApiKey = `${nexusAccountState.revision}:${String(systemConfig.value?.nexusApi?.apiKey || '').trim()}`
      const shouldReload =
        force ||
        !hasBootstrapped.value ||
        currentPageSignature !== lastLoadedPageSignature.value ||
        currentApiKey !== lastLoadedApiKey.value
      if (!shouldReload) {
        return
      }

      query.value.page = 1
      await loadModList()
      if (disposed) return
      lastLoadedPageSignature.value = currentPageSignature
      lastLoadedApiKey.value = currentApiKey
      setPageMenuNameAfterFirstInit()
      hasBootstrapped.value = true
    } finally {
      initInProgress.value = false
    }
  }

  return {
    loading,
    listType,
    query,
    keywordInput,
    modList,
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
  }
}
import { nexusAccountState } from '@renderer/store/nexusAccount.js'
