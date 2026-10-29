import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, ref } from 'vue'
import storage from '@renderer/common/storage.js'
import { GET_SHARED_INSTALL_RULE } from '@renderer/api/modules/game.js'
import { validateInstallConfigRuleJsonText } from '@views/game/nexus/nexus-config-profile-utils.js'
import { compileInstallRuleJson } from '../../../../../shared/installation/install-rule-compiler.js'

const VAMHUB_SOURCE_PLATFORM = 'vamhub'
const VAMHUB_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'active-install-config-profile'
const VAMHUB_DEFAULT_SOURCE_ID = 'vam'

function toSafeNumber(value, defaultValue = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : defaultValue
}

function normalizeRouteId(routeId = '') {
  const raw = String(routeId || '').trim()
  if (!raw) {
    return ''
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function resolveSourceId(routeId = '', routeQuery = {}) {
  const rawId = String(
    routeId ||
      routeQuery?.sourceGameId ||
      routeQuery?.sourceSlug ||
      routeQuery?.sourceGameSlug ||
      routeQuery?.sourceGameDomain ||
      ''
  )
    .trim()
    .toLowerCase()
  if (['game:vam', 'vamhub:vam', 'virt-a-mate', 'virtamate'].includes(rawId)) return VAMHUB_DEFAULT_SOURCE_ID
  return rawId || VAMHUB_DEFAULT_SOURCE_ID
}

function createDefaultVamhubRuleJson() {
  const compiled = compileInstallRuleJson({
    schema_version: 5,
    game_detect: {
      select: {
        strategy: 'highest_confidence'
      },
      candidates: [
        {
          id: 'vam_root',
          confidence: 90,
          exe_globs: ['VaM.exe', 'VaM_Updater.exe'],
          root_from: {
            up: 0
          },
          markers: {
            any_dirs: ['AddonPackages']
          }
        }
      ]
    },
    install_rules: [
      {
        id: 'vamhub_var_archive_file',
        name: 'VAM .var 原包安装',
        priority: 900,
        confidence: 95,
        match: {
          min_file_count: 1
        },
        source: {
          type: 'archive_file'
        },
        target: {
          type: 'game_relative',
          path: 'AddonPackages'
        }
      }
    ]
  })
  return compiled || { schema_version: 5, game_detect: { candidates: [] }, install_rules: [] }
}

function buildVamhubRuleEditorText(rule = null) {
  const ruleJson =
    rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
      ? rule.ruleJson
      : createDefaultVamhubRuleJson()
  return JSON.stringify(ruleJson, null, 2)
}

function hasVamhubRuleContent(rule = null) {
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

function normalizeStoredSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }

  const configName = String(snapshot?.configName || '').trim()
  const ruleJsonText = String(snapshot?.ruleJsonText || '').trim()
  if (!configName && !ruleJsonText) {
    return null
  }

  return {
    id: Number(snapshot?.id || 0) || null,
    profileKey: String(snapshot?.profileKey || '').trim(),
    configName,
    configScope: String(snapshot?.configScope || '').trim(),
    ownerDisplayName: String(snapshot?.ownerDisplayName || '').trim(),
    ruleVersion: toSafeNumber(snapshot?.ruleVersion, 0),
    sourceType: String(snapshot?.sourceType || '').trim(),
    ruleJsonText
  }
}

function resolveStorageKey(context = {}) {
  const gameKey = String(context?.gameKey || '').trim()
  return gameKey
    ? `${VAMHUB_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX}:${VAMHUB_SOURCE_PLATFORM}:${gameKey}`
    : ''
}

function loadStoredSnapshot(context = {}) {
  const storageKey = resolveStorageKey(context)
  if (!storageKey) {
    return null
  }
  return normalizeStoredSnapshot(storage.local.get(storageKey))
}

function persistSnapshot(snapshot = null, context = {}) {
  const storageKey = resolveStorageKey(context)
  const normalizedSnapshot = normalizeStoredSnapshot(snapshot)
  if (!storageKey) {
    return normalizedSnapshot
  }
  if (normalizedSnapshot) {
    storage.local.set(storageKey, normalizedSnapshot)
  } else {
    storage.local.remove(storageKey)
  }
  return normalizedSnapshot
}

function normalizeVamhubProfile(profile = {}) {
  const source = profile && typeof profile === 'object' ? profile : {}
  const rawRuleJsonText = String(source?.ruleJsonText || '').trim()
  const validation = rawRuleJsonText ? validateInstallConfigRuleJsonText(rawRuleJsonText) : null
  const ruleJson =
    validation?.valid && validation.parsed
      ? validation.parsed
      : source?.ruleJson && typeof source.ruleJson === 'object' && !Array.isArray(source.ruleJson)
        ? source.ruleJson
        : {}

  return {
    ...source,
    sourcePlatform: VAMHUB_SOURCE_PLATFORM,
    sourceType: String(source?.sourceType || 'server').trim() || 'server',
    gameId: toSafeNumber(source?.gameId, 0),
    appId: toSafeNumber(source?.appId, 0),
    ruleVersion: toSafeNumber(source?.ruleVersion, 0),
    ruleJson,
    ruleJsonText: rawRuleJsonText || (ruleJson ? JSON.stringify(ruleJson, null, 2) : '')
  }
}

export function validateVamhubRuleEditorText(text = '') {
  return validateInstallConfigRuleJsonText(text)
}

export function loadPrivateVamhubRule(sourceId) {
  const snapshot = loadStoredSnapshot({ gameKey: `vamhub:${sourceId}` })
  if (!['local_override', 'player', 'player_profile', 'local'].includes(snapshot?.sourceType || snapshot?.configScope)) return null
  const validation = validateInstallConfigRuleJsonText(snapshot.ruleJsonText)
  return validation.valid ? normalizeVamhubProfile({
    ...snapshot,
    sourceType: snapshot.sourceType || 'local_override',
    ruleJsonText: validation.formattedText
  }) : null
}

export function useVamhubRuleConfigPage(options = {}) {
  const routeId = computed(() => normalizeRouteId(options?.routeId))
  const routeQuery = computed(() => {
    return options?.routeQuery && typeof options.routeQuery === 'object' ? options.routeQuery : {}
  })

  const sourceId = computed(() => resolveSourceId(routeId.value, routeQuery.value))

  const pageLoading = ref(false)
  const saveLoading = ref(false)
  const cloudRule = ref(null)
  const localRuleOverride = ref(null)
  const currentRule = ref(null)
  const activeProfileSnapshot = ref(null)
  const editorText = ref('')

  const gameBaseInfo = computed(() => {
    return {
      appId: toSafeNumber(routeQuery.value?.appId, 0),
      backendGameId: toSafeNumber(routeQuery.value?.gameId || routeQuery.value?.backendGameId, 0),
      name: String(routeQuery.value?.name || '').trim() || 'Virt a Mate',
      coverImage: String(routeQuery.value?.cover || '').trim()
    }
  })

  const gameContext = computed(() => {
    const id = sourceId.value || VAMHUB_DEFAULT_SOURCE_ID
    return {
      sourcePlatform: VAMHUB_SOURCE_PLATFORM,
      gameKey: `${VAMHUB_SOURCE_PLATFORM}:${id}`,
      gameId: gameBaseInfo.value.backendGameId || null,
      nexusGameId: null,
      appId: gameBaseInfo.value.appId || null,
      domainName: id,
      gameName: gameBaseInfo.value.name
    }
  })

  const currentRuleSourceText = computed(() => {
    const snapshot = activeProfileSnapshot.value
    if (snapshot?.configName) {
      if (snapshot.configScope === 'player') {
        return uiText('ui.communityConfigurationValue', { value1: (snapshot.configName) })
      }
      if (snapshot.configScope === 'official') {
        return uiText('ui.officialConfigurationValue', { value1: (snapshot.configName) })
      }
      return snapshot.configName
    }
    if (localRuleOverride.value) {
      return uiText('ui.localConfiguration')
    }
    if (cloudRule.value) {
      return uiText('dialogs.configDetail.official')
    }
    return uiText('ui.noConfiguration')
  })

  const fallbackOfficialProfile = computed(() => {
    if (!hasVamhubRuleContent(cloudRule.value)) {
      return null
    }
    const cloudRuleJson = cloudRule.value.ruleJson || {}
    const installRules = Array.isArray(cloudRuleJson.install_rules)
      ? cloudRuleJson.install_rules
      : Array.isArray(cloudRuleJson.installRules)
        ? cloudRuleJson.installRules
        : []
    return {
      ...cloudRule.value,
      profileKey: `legacy:official:${gameContext.value.gameKey}`,
      configScope: 'official',
      isDefault: true,
      configName: cloudRule.value.configName || `${gameBaseInfo.value.name} 官方配置`,
      configDesc: cloudRule.value.configDesc || '这是当前可用的 VAM-Hub 官方规则配置，你可以直接使用。',
      ownerDisplayName: 'Vertex 官方',
      installRuleCount: Number(cloudRule.value.installRuleCount || installRules.length || 0),
      ruleJsonText: buildVamhubRuleEditorText(cloudRule.value)
    }
  })

  async function loadCloudRule() {
    const profile = await GET_SHARED_INSTALL_RULE({
      sourcePlatform: VAMHUB_SOURCE_PLATFORM,
      gameKey: routeQuery.value?.gameKey || gameContext.value.gameKey,
      gameId: gameContext.value.gameId,
      domainName: gameContext.value.domainName,
      appId: gameContext.value.appId
    })
    const normalizedProfile = normalizeVamhubProfile(profile)
    if (hasVamhubRuleContent(normalizedProfile)) {
      return normalizedProfile
    }
    return null
  }

  async function initializePage() {
    pageLoading.value = true
    try {
      activeProfileSnapshot.value = loadStoredSnapshot(gameContext.value)
      const storedValidation = validateInstallConfigRuleJsonText(
        activeProfileSnapshot.value?.ruleJsonText || ''
      )
      const privateSnapshot = ['local_override', 'player', 'player_profile', 'local'].includes(
        activeProfileSnapshot.value?.sourceType || activeProfileSnapshot.value?.configScope
      )
      localRuleOverride.value = storedValidation.valid && privateSnapshot
        ? normalizeVamhubProfile({
            ...activeProfileSnapshot.value,
            sourceType: activeProfileSnapshot.value?.sourceType || 'local_override',
            ruleJsonText: activeProfileSnapshot.value.ruleJsonText
          })
        : null
      cloudRule.value = null
      try {
        cloudRule.value = await loadCloudRule()
      } catch (error) {
        console.warn('[VAM-Hub] 公共规则暂不可用，保留私人配置', error)
      }
      currentRule.value = localRuleOverride.value || cloudRule.value || null
      editorText.value = buildVamhubRuleEditorText(currentRule.value)
    } finally {
      pageLoading.value = false
    }
  }

  async function saveEditorRule() {
    if (saveLoading.value) {
      return null
    }

    const validation = validateInstallConfigRuleJsonText(editorText.value)
    if (!validation.valid) {
      throw new Error(validation.message || uiText('ui.fixTheConfigurationFirst'))
    }

    saveLoading.value = true
    try {
      localRuleOverride.value = normalizeVamhubProfile({
        configName: '本地配置',
        configScope: 'local_override',
        sourceType: 'local_override',
        ruleVersion: Number(currentRule.value?.ruleVersion || 0),
        ruleJsonText: validation.formattedText
      })
      currentRule.value = localRuleOverride.value
      activeProfileSnapshot.value = persistSnapshot(
        {
          id: null,
          profileKey: '',
          configName: '本地配置',
          configScope: 'local_override',
          ruleVersion: localRuleOverride.value.ruleVersion,
          sourceType: 'local_override',
          ruleJsonText: validation.formattedText
        },
        gameContext.value
      )
      editorText.value = validation.formattedText
      return localRuleOverride.value
    } finally {
      saveLoading.value = false
    }
  }

  async function applyInstallConfigProfile(payload = {}) {
    const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : {}
    const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : {}
    const ruleJsonText = String(detail?.ruleJsonText || '').trim()
    const validation = validateInstallConfigRuleJsonText(ruleJsonText)
    if (!validation.valid) {
      throw new Error(validation.message || uiText('ui.theConfigurationIsEmptyAndCannotBeUsed'))
    }

    const configScope = String(profile?.configScope || detail?.configScope || '').trim()
    const ruleVersion = toSafeNumber(detail?.ruleVersion || profile?.ruleVersion, 0)
    currentRule.value = normalizeVamhubProfile({
      ...detail,
      ...profile,
      ruleVersion,
      sourceType: configScope === 'player' ? 'player_profile' : 'official_profile',
      ruleJsonText: validation.formattedText
    })
    localRuleOverride.value = currentRule.value
    activeProfileSnapshot.value = persistSnapshot(
      {
        id: Number(profile?.id || detail?.id || 0) || null,
        profileKey: String(profile?.profileKey || '').trim(),
        configName: String(profile?.configName || detail?.configName || '').trim(),
        configScope,
        ownerDisplayName: String(profile?.ownerDisplayName || detail?.ownerDisplayName || '').trim(),
        ruleVersion,
        sourceType: configScope === 'player' ? 'player_profile' : 'official_profile',
        ruleJsonText: validation.formattedText
      },
      gameContext.value
    )
    editorText.value = validation.formattedText
  }

  async function useOfficialRule() {
    if (!cloudRule.value) {
      throw new Error(uiText('ui.noOfficialConfigurationIsAvailable'))
    }
    await applyInstallConfigProfile({
      profile: {
        ...cloudRule.value,
        profileKey: `legacy:official:${gameContext.value.gameKey}`,
        configScope: 'official',
        configName: cloudRule.value.configName || `${gameBaseInfo.value.name} 官方配置`
      },
      detail: {
        ...cloudRule.value,
        ruleJsonText: buildVamhubRuleEditorText(cloudRule.value)
      }
    })
  }

  return {
    pageLoading,
    saveLoading,
    cloudRule,
    localRuleOverride,
    currentRule,
    activeProfileSnapshot,
    editorText,
    gameBaseInfo,
    gameContext,
    currentRuleSourceText,
    fallbackOfficialProfile,
    hasCloudRule: computed(() => hasVamhubRuleContent(cloudRule.value)),
    hasLocalOverride: computed(() => !!localRuleOverride.value),
    currentRuleJsonText: computed(() => buildVamhubRuleEditorText(currentRule.value)),
    initializePage,
    saveEditorRule,
    applyInstallConfigProfile,
    useOfficialRule
  }
}
