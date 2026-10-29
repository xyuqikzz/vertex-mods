import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import {
  GET_SHARED_INSTALL_RULE,
} from '@renderer/api/modules/game.js'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import { validateInstallConfigRuleObject } from '@views/game/nexus/nexus-config-profile-utils.js'

const MODIO_SOURCE_PLATFORM = 'modio'
const ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'active-install-config-profile'
const LEGACY_MODIO_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'modio-active-install-config-profile'

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

function createDefaultModioRuleJson() {
  return {
    schema_version: 5,
    variables: {},
    game: {},
    setup: {
      default_dependencies: []
    },
    default_dependencies: [],
    game_detect: {
      select: {
        strategy: 'highest_confidence'
      },
      candidates: []
    },
    install_rules: []
  }
}

function toSerializableJsonValue(value, fallbackValue = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallbackValue))
  } catch {
    return fallbackValue
  }
}

function stringifyRuleJson(ruleJson = {}, defaultValue = '') {
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

function buildRuleSignature(ruleJson = '') {
  return stringifyRuleJson(ruleJson)
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

function buildModioRuleEditorText(rule = null) {
  const ruleJson =
    rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
      ? rule.ruleJson
      : createDefaultModioRuleJson()
  return JSON.stringify(ruleJson, null, 2)
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

function normalizeInstallConfigProfileSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }

  const id = Number(snapshot?.id || 0) || null
  const profileKey = String(snapshot?.profileKey || '').trim()
  const configName = String(snapshot?.configName || '').trim()
  const configScope = String(snapshot?.configScope || '').trim()
  const sourceType = String(snapshot?.sourceType || '').trim()

  if (!id && !profileKey && !configName) {
    return null
  }

  return {
    id,
    profileKey,
    configName,
    configScope,
    ownerDisplayName: String(snapshot?.ownerDisplayName || '').trim(),
    ruleVersion: toSafeNumber(snapshot?.ruleVersion, 0),
    sourceType
  }
}

function buildInstallConfigProfileSnapshot(snapshot = {}) {
  return normalizeInstallConfigProfileSnapshot(snapshot)
}

function resolveInstallConfigProfileStorageKey(context = {}) {
  const source = context && typeof context === 'object' ? context : {}
  const sourcePlatform =
    String(source?.sourcePlatform || MODIO_SOURCE_PLATFORM).trim() || MODIO_SOURCE_PLATFORM
  const gameKey =
    String(source?.gameKey || '').trim() ||
    (source?.appId ? `${sourcePlatform}:${source.appId}` : '') ||
    (source?.domainName ? `${sourcePlatform}:${source.domainName}` : '')

  if (!gameKey) {
    return ''
  }

  return `${ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX}:${sourcePlatform}:${gameKey}`
}

function resolveLegacyInstallConfigProfileStorageKey(context = {}) {
  const storageKey = resolveInstallConfigProfileStorageKey(context)
  return storageKey
    ? storageKey.replace(
        ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX,
        LEGACY_MODIO_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX
      )
    : ''
}

function loadStoredInstallConfigProfileSnapshot(context = {}) {
  const storageKey = resolveInstallConfigProfileStorageKey(context)
  if (!storageKey || typeof window === 'undefined') {
    return null
  }

  try {
    return (
      normalizeInstallConfigProfileSnapshot(JSON.parse(window.localStorage.getItem(storageKey) || 'null')) ||
      normalizeInstallConfigProfileSnapshot(
        JSON.parse(window.localStorage.getItem(resolveLegacyInstallConfigProfileStorageKey(context)) || 'null')
      )
    )
  } catch {
    return null
  }
}

function persistInstallConfigProfileSnapshot(snapshot = null, context = {}) {
  const normalizedSnapshot = normalizeInstallConfigProfileSnapshot(snapshot)
  const storageKey = resolveInstallConfigProfileStorageKey(context)
  if (!storageKey || typeof window === 'undefined') {
    return normalizedSnapshot
  }

  if (normalizedSnapshot) {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizedSnapshot))
  } else {
    window.localStorage.removeItem(storageKey)
  }

  return normalizedSnapshot
}

function isLocalRuleSourceType(sourceType = '') {
  const safeSourceType = String(sourceType || '').trim()
  return !!safeSourceType && safeSourceType !== 'server'
}

function getJsonLineColumnByPosition(sourceText = '', position = 0) {
  const safeText = String(sourceText || '')
  const safePosition = Math.max(0, Math.min(Number(position || 0), safeText.length))
  const beforeText = safeText.slice(0, safePosition)
  const lines = beforeText.split(/\r?\n/)
  const currentLine = lines[lines.length - 1] || ''

  return {
    lineNumber: lines.length,
    columnNumber: currentLine.length + 1
  }
}

function buildJsonValidationMessage(error, sourceText = '') {
  const rawMessage = String(error?.message || 'JSON 解析失败')
  const lineColumnMatch = rawMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  const positionMatch = rawMessage.match(/position\s+(\d+)/i)
  let lineNumber = Number(lineColumnMatch?.[1] || 0) || 0
  let columnNumber = Number(lineColumnMatch?.[2] || 0) || 0

  if ((!lineNumber || !columnNumber) && positionMatch) {
    const lineColumn = getJsonLineColumnByPosition(sourceText, Number(positionMatch[1] || 0) || 0)
    lineNumber = lineColumn.lineNumber
    columnNumber = lineColumn.columnNumber
  }

  const positionText = lineNumber && columnNumber ? uiText('ui.lineValueColumnValue', { value1: (lineNumber), value2: (columnNumber) }) : ''
  return uiText('ui.invalidJSONValue', { value1: (positionText) })
}

export function validateModioRuleEditorText(text = '') {
  const rawText = String(text || '').trim()
  if (!rawText) {
    return {
      valid: false,
      message: uiText('ui.configurationCannotBeEmpty')
    }
  }

  let parsed = null
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return {
      valid: false,
      message: buildJsonValidationMessage(error, rawText)
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      message: uiText('ui.theRuleRootMustBeAJSONObject')
    }
  }

  const validation = validateInstallConfigRuleObject(parsed)
  if (!validation.valid) {
    return {
      valid: false,
      message: validation.message || uiText('ui.ruleValidationFailed')
    }
  }

  return {
    valid: true,
    parsed: validation.parsed || parsed,
    formattedText: validation.formattedText
  }
}

function normalizeModioGameRulePayload(rawPayload = {}, gameBaseInfo = {}) {
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
    target.ruleBody ??
    target.rule_body ??
    source.ruleJsonText ??
    source.rule_json_text ??
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
      target.modioGameId || target.modio_game_id || source.modioGameId || gameBaseInfo.modioGameId,
      0
    ),
    gameId: toSafeNumber(
      target.gameId || target.game_id || source.gameId || source.game_id || gameBaseInfo.backendGameId,
      0
    ),
    nameId: String(
      target.nameId ||
        target.name_id ||
        source.nameId ||
        source.name_id ||
        gameBaseInfo.nameId ||
        ''
    ).trim(),
    ruleVersion: toSafeNumber(
      target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version,
      0
    ),
    minVersion: String(target.minVersion || target.min_version || source.minVersion || source.min_version || '').trim(),
    createdAt: String(target.createdAt || target.created_at || source.createdAt || source.created_at || '').trim(),
    updatedAt: String(target.updatedAt || target.updated_at || source.updatedAt || source.updated_at || '').trim(),
    sourceType: String(
      target.sourceType || target.source_type || source.sourceType || source.source_type || 'server'
    ).trim(),
    ruleJson
  }
}

export function useModioRuleConfigPage(options = {}) {
  const routeId = computed(() => normalizeRouteId(options?.routeId))
  const routeQuery = computed(() => {
    return options?.routeQuery && typeof options.routeQuery === 'object' ? options.routeQuery : {}
  })

  const pageLoading = ref(false)
  const saveLoading = ref(false)
  const cloudRule = ref(null)
  const localRuleOverride = ref(null)
  const currentRule = ref(null)
  const activeProfileSnapshot = ref(null)
  const editorText = ref('')

  const gameBaseInfo = computed(() => {
    const modioGameId = toSafeNumber(routeId.value, 0)
    const nameId = String(routeQuery.value?.nameId || '').trim()
    return {
      modioGameId,
      name: String(routeQuery.value?.name || '').trim() || nameId || routeId.value || 'mod.io 游戏',
      nameId,
      coverImage: String(routeQuery.value?.cover || '').trim(),
      description: String(routeQuery.value?.desc || '').trim(),
      modCount: toSafeNumber(routeQuery.value?.mods, 0),
      profileUrl: String(routeQuery.value?.profileUrl || '').trim(),
      appId: toSafeNumber(routeQuery.value?.appId || routeQuery.value?.steamAppId, 0),
      backendGameId: toSafeNumber(routeQuery.value?.backendGameId || routeQuery.value?.gameId, 0)
    }
  })

  const gameContext = computed(() => {
    const modioGameId = gameBaseInfo.value.modioGameId
    const nameId = gameBaseInfo.value.nameId
    return {
      sourcePlatform: MODIO_SOURCE_PLATFORM,
      gameKey: modioGameId
        ? `${MODIO_SOURCE_PLATFORM}:${modioGameId}`
        : nameId
          ? `${MODIO_SOURCE_PLATFORM}:${nameId}`
          : '',
      gameId:
        toSafeNumber(currentRule.value?.gameId || gameBaseInfo.value.backendGameId, 0) || null,
      nexusGameId: null,
      appId: gameBaseInfo.value.appId || null,
      domainName: nameId,
      gameName: gameBaseInfo.value.name
    }
  })

  const currentRuleSourceText = computed(() => {
    const snapshot = activeProfileSnapshot.value
    if (snapshot?.configName) {
      const configScope = String(snapshot?.configScope || '').trim()
      if (configScope === 'player') {
        return uiText('ui.communityConfigurationValue', { value1: (snapshot.configName) })
      }
      if (configScope === 'official') {
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
    if (!hasModioInstallRuleContent(cloudRule.value)) {
      return null
    }

    const cloudRuleJson =
      cloudRule.value?.ruleJson &&
      typeof cloudRule.value.ruleJson === 'object' &&
      !Array.isArray(cloudRule.value.ruleJson)
        ? cloudRule.value.ruleJson
        : {}
    const installRules = Array.isArray(cloudRuleJson.install_rules)
      ? cloudRuleJson.install_rules
      : Array.isArray(cloudRuleJson.installRules)
        ? cloudRuleJson.installRules
        : []
    const rootDependencies = Array.isArray(cloudRuleJson.default_dependencies)
      ? cloudRuleJson.default_dependencies
      : Array.isArray(cloudRuleJson.defaultDependencies)
        ? cloudRuleJson.defaultDependencies
        : []
    const setupDependencies = Array.isArray(cloudRuleJson?.setup?.default_dependencies)
      ? cloudRuleJson.setup.default_dependencies
      : Array.isArray(cloudRuleJson?.setup?.defaultDependencies)
        ? cloudRuleJson.setup.defaultDependencies
        : []

    return {
      id: null,
      profileKey: `legacy:official:${gameContext.value.gameKey || 'modio:unknown'}`,
      legacyFallback: true,
      configScope: 'official',
      isDefault: true,
      configName: `${gameBaseInfo.value.name} 官方配置`,
      configDesc: '这是当前可用的 mod.io 官方规则配置，你可以直接使用。',
      ownerDisplayName: 'Vertex 官方',
      sourcePlatform: MODIO_SOURCE_PLATFORM,
      gameKey: gameContext.value.gameKey,
      gameId: gameContext.value.gameId,
      nexusGameId: null,
      appId: gameContext.value.appId,
      domainName: gameContext.value.domainName,
      gameName: gameBaseInfo.value.name,
      ruleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0) || null,
      minClientVersion: String(cloudRule.value?.minVersion || '').trim(),
      installRuleCount: installRules.length,
      dependencyCount: rootDependencies.length + setupDependencies.length,
      updatedAt: String(cloudRule.value?.updatedAt || '').trim(),
      publishedAt: String(cloudRule.value?.createdAt || '').trim(),
      ruleJsonText: buildModioRuleEditorText(cloudRule.value),
      modTypeTags: [],
      targetPathTags: []
    }
  })

  function applyEffectiveRule() {
    currentRule.value = localRuleOverride.value || cloudRule.value || null
  }

  function buildInstallConfigMatchParams() {
    const modioGameId = gameBaseInfo.value.modioGameId
    return {
      sourcePlatform: MODIO_SOURCE_PLATFORM,
      gameKey: routeQuery.value?.gameKey ||  modioGameId ? `${MODIO_SOURCE_PLATFORM}:${modioGameId}` : '',
      gameId: gameBaseInfo.value.backendGameId || null,
      nexusGameId: null,
      domainName: gameBaseInfo.value.nameId,
      appId: gameBaseInfo.value.appId || null
    }
  }

  function hasInstallConfigMatchIdentifier(params = {}) {
    return !!(
      String(params?.gameKey || '').trim() ||
      String(params?.domainName || '').trim() ||
      toSafeNumber(params?.gameId, 0) > 0 ||
      toSafeNumber(params?.appId, 0) > 0
    )
  }

  async function loadLocalRuleCache() {
    const modioGameId = gameBaseInfo.value.modioGameId
    if (!modioGameId) {
      return null
    }

    try {
      const localRule = await ipcRenderer.invoke('modioGetLatestGameRule', {
        modioGameId
      })
      return localRule ? normalizeModioGameRulePayload(localRule, gameBaseInfo.value) : null
    } catch (error) {
      console.warn('[MODIO] 读取本地安装规则缓存失败', error)
      return null
    }
  }

  async function loadMatchedInstallConfigRule() {
    const modioGameId = gameBaseInfo.value.modioGameId
    const params = buildInstallConfigMatchParams()
    if (!hasInstallConfigMatchIdentifier(params)) {
      return null
    }

    try {
      const response = await GET_SHARED_INSTALL_RULE(params)
      const ruleJsonText = String(response?.ruleJsonText || '').trim()
      if (!ruleJsonText) {
        return null
      }

      const normalizedRule = normalizeModioGameRulePayload(
        {
          ...response,
          ruleJsonText,
          modioGameId,
          nameId: gameBaseInfo.value.nameId,
          sourceType: 'server'
        },
        gameBaseInfo.value
      )

      if (!hasModioInstallRuleContent(normalizedRule)) {
        return null
      }



      return normalizedRule
    } catch (error) {
      console.warn('[MODIO] 统一安装配置匹配失败，公共规则当前不可用', error)
      return null
    }
  }



  async function loadCloudRule() { return loadMatchedInstallConfigRule() }

  async function saveLocalRuleOverride(payload = {}) {
    const ruleJson =
      payload?.ruleJson && typeof payload.ruleJson === 'object' && !Array.isArray(payload.ruleJson)
        ? payload.ruleJson
        : createDefaultModioRuleJson()
    const currentRuleVersion = toSafeNumber(currentRule.value?.ruleVersion, 0)
    const nextRuleVersion = Math.max(toSafeNumber(payload?.ruleVersion, 0), currentRuleVersion + 1, 1)
    const sourceType = String(payload?.sourceType || 'local_override').trim() || 'local_override'
    const result = await ipcRenderer.invoke('modioSaveGameRuleIfNewer', {
      modioGameId: gameBaseInfo.value.modioGameId,
      gameId: toSafeNumber(currentRule.value?.gameId || payload?.gameId || gameBaseInfo.value.backendGameId, 0),
      nameId: gameBaseInfo.value.nameId,
      ruleVersion: nextRuleVersion,
      ruleJson: toSerializableJsonValue(ruleJson, {}),
      sourceType
    })

    if (!result?.success) {
      throw new Error(String(result?.reason || uiText('ui.couldNotSaveModIoRules')))
    }

    const savedRule = normalizeModioGameRulePayload(
      result?.latest || {
        modioGameId: gameBaseInfo.value.modioGameId,
        gameId: toSafeNumber(payload?.gameId || gameBaseInfo.value.backendGameId, 0),
        nameId: gameBaseInfo.value.nameId,
        ruleVersion: nextRuleVersion,
        ruleJson,
        sourceType
      },
      gameBaseInfo.value
    )

    localRuleOverride.value = isLocalRuleSourceType(savedRule.sourceType) ? savedRule : null
    currentRule.value = savedRule
    editorText.value = buildModioRuleEditorText(currentRule.value)
    return savedRule
  }

  async function initializePage() {
    pageLoading.value = true
    try {
      activeProfileSnapshot.value = loadStoredInstallConfigProfileSnapshot(gameContext.value)
      const remoteRule = await loadCloudRule()
      const cachedRule = await loadLocalRuleCache()
      cloudRule.value = remoteRule
      localRuleOverride.value =
        cachedRule && isLocalRuleSourceType(cachedRule.sourceType) ? cachedRule : null
      applyEffectiveRule(cachedRule)
      editorText.value = buildModioRuleEditorText(currentRule.value)
    } finally {
      pageLoading.value = false
    }
  }

  async function saveEditorRule() {
    if (saveLoading.value) {
      return null
    }

    const validation = validateModioRuleEditorText(editorText.value)
    if (!validation.valid) {
      throw new Error(validation.message || uiText('ui.fixTheConfigurationFirst'))
    }

    const cloudRuleSignature = buildRuleSignature(cloudRule.value?.ruleJson)
    const editorSignature = buildRuleSignature(validation.parsed)
    const isSameAsCloudRule = !!cloudRuleSignature && cloudRuleSignature === editorSignature

    saveLoading.value = true
    try {
      const savedRule = await saveLocalRuleOverride({
        ruleVersion: isSameAsCloudRule
          ? toSafeNumber(cloudRule.value?.ruleVersion, 0)
          : toSafeNumber(currentRule.value?.ruleVersion, 0),
        ruleJson: validation.parsed,
        sourceType: 'local_override'
      })

      activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
        buildInstallConfigProfileSnapshot({
          id: null,
          profileKey: '',
          configName: '本地配置',
          configScope: 'local_override',
          ownerDisplayName: '',
          ruleVersion: toSafeNumber(savedRule?.ruleVersion, 0),
          sourceType: 'local_override'
        }),
        gameContext.value
      )
      return savedRule
    } finally {
      saveLoading.value = false
    }
  }

  async function applyInstallConfigProfile(payload = {}) {
    const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : {}
    const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : {}
    const ruleJsonText = String(detail?.ruleJsonText || '').trim()
    if (!ruleJsonText) {
      throw new Error(uiText('ui.theConfigurationIsEmptyAndCannotBeUsed'))
    }

    const compiledRule = compileInstallRuleJson(parseInstallRuleJsonText(ruleJsonText))
    const ruleVersion = toSafeNumber(detail?.ruleVersion || profile?.ruleVersion, 0)
    const configScope = String(profile?.configScope || detail?.configScope || '').trim()
    await saveLocalRuleOverride({
      ruleVersion,
      ruleJson: compiledRule,
      gameId: toSafeNumber(detail?.gameId || profile?.gameId || gameBaseInfo.value.backendGameId, 0),
      sourceType: configScope === 'player' ? 'player_profile' : 'official_profile'
    })

    activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
      buildInstallConfigProfileSnapshot({
        id: Number(profile?.id || detail?.id || 0) || null,
        profileKey: String(profile?.profileKey || '').trim(),
        configName: String(profile?.configName || detail?.configName || '').trim(),
        configScope,
        ownerDisplayName: String(profile?.ownerDisplayName || detail?.ownerDisplayName || '').trim(),
        ruleVersion,
        sourceType: configScope === 'player' ? 'player_profile' : 'official_profile'
      }),
      gameContext.value
    )
    editorText.value = buildModioRuleEditorText(currentRule.value)
  }

  async function useOfficialRule() {
    if (!cloudRule.value) {
      throw new Error(uiText('ui.noOfficialConfigurationIsAvailable'))
    }

    const savedRule = await saveLocalRuleOverride({
      ruleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0),
      ruleJson: cloudRule.value?.ruleJson || {},
      gameId: toSafeNumber(cloudRule.value?.gameId || gameBaseInfo.value.backendGameId, 0),
      sourceType: 'official_profile'
    })

    activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
      buildInstallConfigProfileSnapshot({
        id: null,
        profileKey: `legacy:official:${gameContext.value.gameKey}`,
        configName: `${gameBaseInfo.value.name} 官方配置`,
        configScope: 'official',
        ownerDisplayName: 'Vertex 官方',
        ruleVersion: toSafeNumber(savedRule?.ruleVersion, 0),
        sourceType: 'official_profile'
      }),
      gameContext.value
    )
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
    hasCloudRule: computed(() => hasModioInstallRuleContent(cloudRule.value)),
    hasLocalOverride: computed(() => {
      return String(activeProfileSnapshot.value?.sourceType || '').trim() === 'local_override'
    }),
    currentRuleJsonText: computed(() => buildModioRuleEditorText(currentRule.value)),
    initializePage,
    saveEditorRule,
    applyInstallConfigProfile,
    useOfficialRule
  }
}
