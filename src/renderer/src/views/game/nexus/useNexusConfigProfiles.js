import { computed, ref, watch } from 'vue'
import {
  CLONE_PLAYER_INSTALL_CONFIG,
  CREATE_PLAYER_INSTALL_CONFIG,
  DELETE_PLAYER_INSTALL_CONFIG,
  GET_INSTALL_CONFIG_DETAIL,
  GET_INSTALL_CONFIG_OFFICIAL_LIST,
  GET_INSTALL_CONFIG_PLAYER_LIST,
  GET_INSTALL_CONFIG_SUPPORT_RULES,
  GET_MY_INSTALL_CONFIG_DETAIL,
  GET_MY_INSTALL_CONFIG_STATUS,
  UPDATE_PLAYER_INSTALL_CONFIG,
  USE_INSTALL_CONFIG_PROFILE
} from '@renderer/api/modules/game.js'
import {
  buildInstallConfigQueryParams,
  buildPlayerInstallConfigPayload,
  hasUsableInstallConfigContext,
  normalizeInstallConfigPage,
  normalizeInstallConfigProfile
} from './nexus-config-profile-utils.js'

function normalizeMyStatus(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  return {
    uploaded: !!source?.uploaded,
    profileId: Number(source?.profileId || 0) || null,
    sourcePlatform: String(source?.sourcePlatform || 'nexus').trim() || 'nexus',
    gameKey: String(source?.gameKey || '').trim()
  }
}

function createEmptySupportInfo(sourcePlatform = 'nexus') {
  return {
    sourcePlatform,
    gameKey: '',
    nexusGameId: null,
    officialCount: 0,
    playerCount: 0,
    defaultOfficialProfileId: null
  }
}

export function useNexusConfigProfiles(options = {}) {
  const officialLoading = ref(false)
  const officialList = ref([])
  const playerLoading = ref(false)
  const playerPageData = ref(normalizeInstallConfigPage())
  const supportLoading = ref(false)
  const supportInfo = ref(createEmptySupportInfo())
  const myStatusLoading = ref(false)
  const myStatus = ref(normalizeMyStatus())

  const gameContext = computed(() => {
    const source =
      typeof options?.getGameContext === 'function' ? options.getGameContext() : options?.gameContext
    return source && typeof source === 'object' ? source : {}
  })

  const isLoggedIn = computed(() => {
    if (typeof options?.isLoggedIn === 'function') {
      return !!options.isLoggedIn()
    }
    return !!options?.loggedIn
  })

  const queryParams = computed(() => buildInstallConfigQueryParams(gameContext.value))
  const querySignature = computed(() => JSON.stringify(queryParams.value))

  async function loadOfficialList() {
    if (!hasUsableInstallConfigContext(gameContext.value)) {
      officialList.value = []
      return []
    }

    officialLoading.value = true
    try {
      const response = await GET_INSTALL_CONFIG_OFFICIAL_LIST(queryParams.value)
      officialList.value = Array.isArray(response)
        ? response.map((item) => normalizeInstallConfigProfile(item))
        : []
      return officialList.value
    } finally {
      officialLoading.value = false
    }
  }

  async function loadPlayerList(page = 1, size = playerPageData.value.size || 10) {
    if (!hasUsableInstallConfigContext(gameContext.value)) {
      playerPageData.value = normalizeInstallConfigPage({
        current: page,
        size,
        total: 0,
        records: []
      })
      return playerPageData.value
    }

    playerLoading.value = true
    try {
      const response = await GET_INSTALL_CONFIG_PLAYER_LIST({
        ...queryParams.value,
        page,
        size
      })
      playerPageData.value = normalizeInstallConfigPage(response)
      return playerPageData.value
    } finally {
      playerLoading.value = false
    }
  }

  async function loadSupportInfo() {
    if (!hasUsableInstallConfigContext(gameContext.value)) {
      supportInfo.value = createEmptySupportInfo(queryParams.value?.sourcePlatform)
      return supportInfo.value
    }

    supportLoading.value = true
    try {
      const response = await GET_INSTALL_CONFIG_SUPPORT_RULES(queryParams.value)
      supportInfo.value = {
        ...createEmptySupportInfo(queryParams.value?.sourcePlatform),
        ...(response && typeof response === 'object' ? response : {})
      }
      return supportInfo.value
    } finally {
      supportLoading.value = false
    }
  }

  async function loadMyStatus() {
    if (!isLoggedIn.value || !hasUsableInstallConfigContext(gameContext.value)) {
      myStatus.value = normalizeMyStatus({
        sourcePlatform: queryParams.value?.sourcePlatform
      })
      return myStatus.value
    }

    myStatusLoading.value = true
    try {
      const response = await GET_MY_INSTALL_CONFIG_STATUS(queryParams.value)
      myStatus.value = normalizeMyStatus(response)
      return myStatus.value
    } finally {
      myStatusLoading.value = false
    }
  }

  async function reloadAll(options = {}) {
    const resetPlayerPage = options?.resetPlayerPage !== false
    const targetPage = resetPlayerPage ? 1 : playerPageData.value.current || 1
    const targetSize = playerPageData.value.size || 10
    if (resetPlayerPage) {
      playerPageData.value = {
        ...playerPageData.value,
        current: 1
      }
    }

    await Promise.all([loadOfficialList(), loadPlayerList(targetPage, targetSize), loadSupportInfo()])
    await loadMyStatus()
  }

  async function loadProfileDetail(profileId, includeMine = false) {
    const response = includeMine
      ? await GET_MY_INSTALL_CONFIG_DETAIL(profileId)
      : await GET_INSTALL_CONFIG_DETAIL(profileId, true)
    return normalizeInstallConfigProfile(response)
  }

  async function useProfile(profileId) {
    const useResult = await USE_INSTALL_CONFIG_PROFILE(profileId)
    const detail = await GET_INSTALL_CONFIG_DETAIL(profileId, true)
    return {
      useResult,
      detail: normalizeInstallConfigProfile(detail)
    }
  }

  async function savePlayerProfile(draft = {}) {
    const payload = buildPlayerInstallConfigPayload(draft, gameContext.value)
    const profileId = Number(draft?.id || 0)
    const response =
      profileId > 0
        ? await UPDATE_PLAYER_INSTALL_CONFIG(profileId, payload)
        : await CREATE_PLAYER_INSTALL_CONFIG(payload)
    await reloadAll({
      resetPlayerPage: false
    })
    return normalizeInstallConfigProfile(response)
  }

  async function clonePlayerProfile(profileId, draft = {}) {
    const payload = draft && Object.keys(draft).length ? buildPlayerInstallConfigPayload(draft, gameContext.value) : {}
    const response = await CLONE_PLAYER_INSTALL_CONFIG(profileId, payload)
    await reloadAll({
      resetPlayerPage: false
    })
    return normalizeInstallConfigProfile(response)
  }

  async function deletePlayerProfile(profileId) {
    await DELETE_PLAYER_INSTALL_CONFIG(profileId)
    await reloadAll({
      resetPlayerPage: false
    })
  }

  watch(
    querySignature,
    async () => {
      await reloadAll()
    },
    {
      immediate: true
    }
  )

  watch(
    () => isLoggedIn.value,
    async () => {
      await loadMyStatus()
    }
  )

  return {
    officialLoading,
    officialList,
    playerLoading,
    playerPageData,
    supportLoading,
    supportInfo,
    myStatusLoading,
    myStatus,
    loadPlayerList,
    loadProfileDetail,
    loadMyStatus,
    reloadAll,
    savePlayerProfile,
    clonePlayerProfile,
    deletePlayerProfile,
    useProfile,
    loadMyProfileDetail: async (profileId) => loadProfileDetail(profileId, true)
  }
}
