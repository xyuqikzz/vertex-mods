import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { describeSharedRuleFailure, sharedRuleError } from '../../../../../shared/installation/shared-install-rule.js'
import { computed, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import storage from '@renderer/common/storage.js'
import {
  GET_SHARED_INSTALL_RULE,
} from '@renderer/api/modules/game.js'
import {
  compileInstallRuleJson as compileNexusRuleJson,
  parseInstallRuleJsonText as parseNexusRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import { validateInstallConfigRuleObject } from './nexus-config-profile-utils.js'

const ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'active-install-config-profile'
const LEGACY_NEXUS_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX = 'nexus-active-install-config-profile'

function toSafeNumber(value, defaultValue = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : defaultValue
}

function normalizeRouteDomainName(routeId = '') {
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

function createDefaultNexusRuleJson() {
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

function toSerializableJsonValue(value, fallbackValue = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallbackValue))
  } catch {
    return fallbackValue
  }
}

function buildNexusRuleSignature(ruleVersion = 0, ruleJson = '') {
  const text = stringifyNexusRuleJson(ruleJson)
  if (!text) {
    return ''
  }
  return `${toSafeNumber(ruleVersion, 0)}::${text}`
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

function buildInstallConfigProfileSnapshot(snapshot = {}) {
  return normalizeInstallConfigProfileSnapshot(snapshot)
}

function resolveInstallConfigProfileStorageKey(context = {}) {
  const source = context && typeof context === 'object' ? context : {}
  const sourcePlatform = String(source?.sourcePlatform || 'nexus').trim() || 'nexus'
  const gameKey =
    String(source?.gameKey || '').trim() ||
    String(source?.domainName || '').trim().toLowerCase() ||
    (toSafeNumber(source?.nexusGameId, 0) > 0 ? `nexusGameId:${toSafeNumber(source?.nexusGameId, 0)}` : '') ||
    (toSafeNumber(source?.gameId, 0) > 0 ? `gameId:${toSafeNumber(source?.gameId, 0)}` : '')

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
        LEGACY_NEXUS_ACTIVE_INSTALL_CONFIG_PROFILE_STORAGE_PREFIX
      )
    : ''
}

function loadStoredInstallConfigProfileSnapshot(context = {}) {
  const storageKey = resolveInstallConfigProfileStorageKey(context)
  if (!storageKey) {
    return null
  }
  return (
    normalizeInstallConfigProfileSnapshot(storage.local.get(storageKey)) ||
    normalizeInstallConfigProfileSnapshot(storage.local.get(resolveLegacyInstallConfigProfileStorageKey(context)))
  )
}

function persistInstallConfigProfileSnapshot(snapshot = null, context = {}) {
  const storageKey = resolveInstallConfigProfileStorageKey(context)
  const normalizedSnapshot = normalizeInstallConfigProfileSnapshot(snapshot)
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

function hasNexusRuleContent(rule = null) {
  const ruleJson =
    rule?.ruleJson && typeof rule.ruleJson === 'object' && !Array.isArray(rule.ruleJson)
      ? rule.ruleJson
      : null
  return !!ruleJson && Object.keys(ruleJson).length > 0
}

function buildNexusRuleEditorText(targetRule = null) {
  const ruleJson =
    targetRule?.ruleJson && typeof targetRule.ruleJson === 'object' && !Array.isArray(targetRule.ruleJson)
      ? targetRule.ruleJson
      : createDefaultNexusRuleJson()
  return JSON.stringify(ruleJson, null, 2)
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

function translateJsonErrorReason(message = '') {
  const sourceMessage = String(message || '').trim()
  if (!sourceMessage) {
    return uiText('ui.jSONSyntaxError')
  }

  if (/Expected double-quoted property name in JSON/i.test(sourceMessage)) {
    return uiText('ui.objectPropertyNamesMustUseDoubleQuotes')
  }
  if (/Expected ',' or '}' after property value in JSON/i.test(sourceMessage)) {
    return uiText('ui.aCommaOrClosingBraceIsMissingAfterAnObject')
  }
  if (/Expected ',' or '\]' after array element in JSON/i.test(sourceMessage)) {
    return uiText('ui.aCommaOrClosingBracketIsMissingAfterAnArray')
  }
  if (/Expected ':' after property name in JSON/i.test(sourceMessage)) {
    return uiText('ui.aColonIsMissingAfterAnObjectPropertyName')
  }
  if (/Unexpected end of JSON input/i.test(sourceMessage)) {
    return uiText('ui.jSONInputIsIncomplete')
  }
  if (/Unexpected non-whitespace character after JSON/i.test(sourceMessage)) {
    return uiText('ui.extraContentAfterTheEndOfJSON')
  }
  if (/No number after minus sign in JSON/i.test(sourceMessage)) {
    return uiText('ui.aDigitIsMissingAfterTheMinusSign')
  }
  if (/Unterminated string in JSON/i.test(sourceMessage)) {
    return uiText('ui.aClosingQuoteIsMissingFromAString')
  }
  if (/Bad control character in string literal in JSON/i.test(sourceMessage)) {
    return uiText('ui.aStringContainsAnInvalidControlCharacter')
  }
  if (/Bad escaped character in JSON/i.test(sourceMessage)) {
    return uiText('ui.invalidEscapeCharacter')
  }
  if (/Bad Unicode escape in JSON/i.test(sourceMessage)) {
    return uiText('ui.invalidUnicodeEscape')
  }
  if (/Unexpected token/i.test(sourceMessage)) {
    return uiText('ui.aCharacterIsNotValidJSONSyntax')
  }

  return uiText('ui.jSONSyntaxError')
}

function buildJsonValidationMessage(error, sourceText = '') {
  const rawMessage = String(error?.message || 'JSON 解析失败')
  const reasonText = translateJsonErrorReason(rawMessage)
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
  return uiText('ui.invalidJSONValueValue', { value1: (positionText), value2: (reasonText) })
}

export function validateNexusRuleEditorText(text = '') {
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

function normalizeNexusGameRulePayload(rawPayload = {}, gameBaseInfo = {}) {
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

  return {
      ...target,
    id: toSafeNumber(target.id || source.id, 0),
    nexusGameId: toSafeNumber(target.nexusGameId || target.nexus_game_id || source.nexusGameId || source.nexus_game_id, 0),
    gameId: toSafeNumber(target.gameId || target.game_id || source.gameId || source.game_id, 0),
    steamAppId: toSafeNumber(
      target.appId ||
        target.app_id ||
        target.steamAppId ||
        target.steam_app_id ||
        source.appId ||
        source.app_id ||
        source.steamAppId ||
        source.steam_app_id,
      0
    ),
    ruleVersion: toSafeNumber(target.ruleVersion || target.rule_version || source.ruleVersion || source.rule_version, 0),
    minVersion: String(target.minVersion || target.min_version || source.minVersion || source.min_version || '').trim(),
    createdAt: String(target.createdAt || target.created_at || source.createdAt || source.created_at || '').trim(),
    updatedAt: String(target.updatedAt || target.updated_at || source.updatedAt || source.updated_at || '').trim(),
    gameName: String(target.gameName || target.game_name || target.name || source.gameName || gameBaseInfo.name || '').trim(),
    coverImage: String(target.coverImage || target.cover_image || source.coverImage || gameBaseInfo.coverImage || '').trim(),
    domainName: String(target.domainName || target.domain_name || source.domainName || gameBaseInfo.domainName || '').trim(),
    sourceType: String(target.sourceType || source.sourceType || 'local').trim() || 'local',
    baseRuleVersion: toSafeNumber(target.baseRuleVersion || target.base_rule_version || 0, 0),
    baseRuleJson: target.baseRuleJson || target.base_rule_json || {},
    dismissedRuleVersion: toSafeNumber(target.dismissedRuleVersion || target.dismissed_rule_version || 0, 0),
    dismissedRuleJson: target.dismissedRuleJson || target.dismissed_rule_json || {},
    ruleJson
  }
}

export function useNexusRuleConfigPage(options = {}) {
  const routeId = computed(() => normalizeRouteDomainName(options?.routeId))
  const routeQuery = computed(() => {
    return options?.routeQuery && typeof options.routeQuery === 'object' ? options.routeQuery : {}
  })

  const pageLoading = ref(false)
  const saveLoading = ref(false)
  const cloudRule = ref(null)
  const cloudRuleFailure = ref(null)
  const localRuleOverride = ref(null)
  const currentRule = ref(null)
  const activeProfileSnapshot = ref(null)
  const editorText = ref('')

  const gameBaseInfo = computed(() => {
    return {
      domainName: routeId.value,
      name: String(routeQuery.value?.name || '').trim() || routeId.value || 'Nexus 游戏',
      coverImage: String(routeQuery.value?.cover || '').trim(),
      nexusGameId: toSafeNumber(routeQuery.value?.nexusGameId, 0),
      backendGameId: toSafeNumber(routeQuery.value?.backendGameId || routeQuery.value?.gameId, 0),
      appId: toSafeNumber(routeQuery.value?.appId || routeQuery.value?.steamAppId, 0)
    }
  })

  const gameContext = computed(() => {
    return {
      sourcePlatform: 'nexus',
      gameKey: routeId.value ? `nexus:${routeId.value}` : '',
      gameId: gameBaseInfo.value.backendGameId || null,
      nexusGameId: gameBaseInfo.value.nexusGameId || null,
      appId: gameBaseInfo.value.appId || null,
      domainName: routeId.value,
      gameName: gameBaseInfo.value.name
    }
  })

  const currentRuleSourceText = computed(() => {
    if (!localRuleOverride.value && !cloudRule.value && cloudRuleFailure.value) {
      return cloudRuleFailure.value.label
    }
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
      return uiText('ui.localRules')
    }

    if (cloudRule.value) {
      return uiText('ui.officialRules')
    }

    return cloudRuleFailure.value?.label || uiText('ui.noRulesConfigured')
  })

  const fallbackOfficialProfile = computed(() => {
    if (!hasNexusRuleContent(cloudRule.value)) {
      return null
    }

    const cloudRuleJson =
      cloudRule.value?.ruleJson &&
      typeof cloudRule.value.ruleJson === 'object' &&
      !Array.isArray(cloudRule.value.ruleJson)
        ? cloudRule.value.ruleJson
        : {}
    const installRules = Array.isArray(cloudRuleJson?.install_rules) ? cloudRuleJson.install_rules : []

    return {
      id: null,
      profileKey: `legacy:official:${gameContext.value.gameKey}`,
      legacyFallback: true,
      configScope: 'official',
      isDefault: true,
      configName: `${gameBaseInfo.value.name} 官方配置`,
      configDesc: '这是当前可用的官方规则配置，你可以直接使用。',
      ownerDisplayName: 'Vertex 官方',
      sourcePlatform: 'nexus',
      gameKey: gameContext.value.gameKey,
      gameId: gameBaseInfo.value.backendGameId || null,
      nexusGameId: gameBaseInfo.value.nexusGameId || null,
      appId: gameBaseInfo.value.appId || null,
      domainName: routeId.value,
      gameName: gameBaseInfo.value.name,
      ruleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0) || null,
      minClientVersion: String(cloudRule.value?.minVersion || '').trim(),
      installRuleCount: installRules.length,
      updatedAt: String(cloudRule.value?.updatedAt || '').trim(),
      publishedAt: String(cloudRule.value?.createdAt || '').trim(),
      ruleJsonText: buildNexusRuleEditorText(cloudRule.value)
    }
  })

  function applyEffectiveRule() {
    currentRule.value = localRuleOverride.value || cloudRule.value || null
  }

  function buildInstallConfigMatchParams() {
    const nexusGameId = gameBaseInfo.value.nexusGameId
    return {
      sourcePlatform: 'nexus',
      gameKey: routeQuery.value?.gameKey ||  nexusGameId > 0 ? `nexus:${nexusGameId}` : '',
      gameId: gameBaseInfo.value.backendGameId || null,
      nexusGameId: nexusGameId || null,
      domainName: routeId.value,
      appId: gameBaseInfo.value.appId || null
    }
  }

  function hasInstallConfigMatchIdentifier(params = {}) {
    return !!(
      String(params?.gameKey || '').trim() ||
      String(params?.domainName || '').trim() ||
      toSafeNumber(params?.nexusGameId, 0) > 0 ||
      toSafeNumber(params?.gameId, 0) > 0 ||
      toSafeNumber(params?.appId, 0) > 0
    )
  }

  async function loadLocalRuleOverride() {
    if (!routeId.value && !gameBaseInfo.value.nexusGameId) {
      return null
    }

    try {
      const localRule = await ipcRenderer.invoke('nexusGetGameRuleOverride', {
        domainName: routeId.value,
        nexusGameId: gameBaseInfo.value.nexusGameId
      })
      return localRule ? normalizeNexusGameRulePayload(localRule, gameBaseInfo.value) : null
    } catch (error) {
      console.error('[NEXUS] 读取本地规则配置失败', error)
      return null
    }
  }

  async function loadMatchedInstallConfigRule() {
    cloudRuleFailure.value = null
    const params = buildInstallConfigMatchParams()
    if (!hasInstallConfigMatchIdentifier(params)) {
      cloudRuleFailure.value = describeSharedRuleFailure(sharedRuleError('IDENTITY_MISSING', '当前页面缺少来源游戏标识'))
      return null
    }

    try {
      const response = await GET_SHARED_INSTALL_RULE(params)
      const ruleJsonText = String(response?.ruleJsonText || '').trim()
      if (!ruleJsonText) {
        throw sharedRuleError('INVALID_RESPONSE', '公共规则响应缺少正文')
      }

      const normalizedRule = normalizeNexusGameRulePayload(
        {
          ...response,
          ruleJsonText,
          minVersion: response?.minClientVersion,
          sourceType: 'server'
        },
        gameBaseInfo.value
      )

      if (!hasNexusRuleContent(normalizedRule)) {
        throw sharedRuleError('INVALID_RESPONSE', '公共文档没有可用的安装规则')
      }



      return normalizedRule
    } catch (error) {
      cloudRuleFailure.value = describeSharedRuleFailure(error)
      console.warn('[NEXUS] 统一安装配置匹配失败，公共规则当前不可用', error)
      return null
    }
  }



  async function loadCloudRule() { return loadMatchedInstallConfigRule() }

  async function saveLocalRuleOverride(payload = {}) {
    const serializedPayload = {
      domainName: routeId.value,
      nexusGameId: gameBaseInfo.value.nexusGameId,
      gameId: gameBaseInfo.value.backendGameId,
      appId: gameBaseInfo.value.appId,
      sourceType: 'local_override',
      ...payload,
      ruleJson: toSerializableJsonValue(payload?.ruleJson, {}),
      baseRuleJson: toSerializableJsonValue(payload?.baseRuleJson, {}),
      dismissedRuleJson: toSerializableJsonValue(payload?.dismissedRuleJson, {})
    }

    const result = await ipcRenderer.invoke('nexusUpsertGameRuleOverride', serializedPayload)

    if (!result?.success || !result?.override) {
      throw new Error(String(result?.reason || uiText('ui.saveFailed')))
    }

    localRuleOverride.value = normalizeNexusGameRulePayload(result.override, gameBaseInfo.value)
    applyEffectiveRule()
    editorText.value = buildNexusRuleEditorText(currentRule.value)
    return localRuleOverride.value
  }

  async function initializePage() {
    pageLoading.value = true
    try {
      activeProfileSnapshot.value = loadStoredInstallConfigProfileSnapshot(gameContext.value)
      const [localRule, remoteRule] = await Promise.all([loadLocalRuleOverride(), loadCloudRule()])
      localRuleOverride.value = localRule
      cloudRule.value = remoteRule
      applyEffectiveRule()
      editorText.value = buildNexusRuleEditorText(currentRule.value)
    } finally {
      pageLoading.value = false
    }
  }

  async function saveEditorRule() {
    if (saveLoading.value) {
      return
    }

    const validation = validateNexusRuleEditorText(editorText.value)
    if (!validation.valid) {
      throw new Error(validation.message || uiText('ui.fixTheConfigurationFirst'))
    }

    const cloudRuleSignature = buildNexusRuleSignature(0, cloudRule.value?.ruleJson)
    const editorSignature = buildNexusRuleSignature(0, validation.parsed)
    const existingLocalRule = localRuleOverride.value
    const isSameAsCloudRule = !!cloudRuleSignature && cloudRuleSignature === editorSignature

    saveLoading.value = true
    try {
      const savedRule = await saveLocalRuleOverride({
        ruleVersion: isSameAsCloudRule
          ? toSafeNumber(cloudRule.value?.ruleVersion, 0)
          : existingLocalRule
            ? toSafeNumber(existingLocalRule.ruleVersion, 0)
            : toSafeNumber(cloudRule.value?.ruleVersion, 0),
        ruleJson: validation.parsed,
        baseRuleVersion: isSameAsCloudRule
          ? toSafeNumber(cloudRule.value?.ruleVersion, 0)
          : existingLocalRule
            ? toSafeNumber(existingLocalRule.baseRuleVersion, 0)
            : toSafeNumber(cloudRule.value?.ruleVersion, 0),
        baseRuleJson: isSameAsCloudRule
          ? cloudRule.value?.ruleJson || {}
          : existingLocalRule
            ? existingLocalRule.baseRuleJson || ''
            : cloudRule.value?.ruleJson || {},
        dismissedRuleVersion: isSameAsCloudRule
          ? toSafeNumber(cloudRule.value?.ruleVersion, 0)
          : existingLocalRule
            ? toSafeNumber(existingLocalRule.dismissedRuleVersion, 0)
            : toSafeNumber(cloudRule.value?.ruleVersion, 0),
        dismissedRuleJson: isSameAsCloudRule
          ? cloudRule.value?.ruleJson || {}
          : existingLocalRule
            ? existingLocalRule.dismissedRuleJson || ''
            : cloudRule.value?.ruleJson || {}
      })

      activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
        buildInstallConfigProfileSnapshot({
          id: null,
          profileKey: '',
          configName: '本地规则',
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

    const compiledRule = compileNexusRuleJson(parseNexusRuleJsonText(ruleJsonText))
    const ruleVersion = toSafeNumber(detail?.ruleVersion || profile?.ruleVersion, 0)
    await saveLocalRuleOverride({
      ruleVersion,
      ruleJson: compiledRule,
      baseRuleVersion: ruleVersion,
      baseRuleJson: compiledRule,
      dismissedRuleVersion: ruleVersion,
      dismissedRuleJson: compiledRule
    })

    activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
      buildInstallConfigProfileSnapshot({
        id: Number(profile?.id || detail?.id || 0) || null,
        profileKey: String(profile?.profileKey || '').trim(),
        configName: String(profile?.configName || detail?.configName || '').trim(),
        configScope: String(profile?.configScope || detail?.configScope || '').trim(),
        ownerDisplayName: String(profile?.ownerDisplayName || detail?.ownerDisplayName || '').trim(),
        ruleVersion,
        sourceType:
          String(profile?.configScope || detail?.configScope || '').trim() === 'player'
            ? 'player_profile'
            : 'official_profile'
      }),
      gameContext.value
    )
    editorText.value = buildNexusRuleEditorText(currentRule.value)
  }

  async function useOfficialRule() {
    if (!cloudRule.value) {
      throw new Error(uiText('ui.noOfficialRulesAreAvailable'))
    }

    await saveLocalRuleOverride({
      ruleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0),
      ruleJson: cloudRule.value?.ruleJson || {},
      baseRuleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0),
      baseRuleJson: cloudRule.value?.ruleJson || {},
      dismissedRuleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0),
      dismissedRuleJson: cloudRule.value?.ruleJson || {}
    })

    activeProfileSnapshot.value = persistInstallConfigProfileSnapshot(
      buildInstallConfigProfileSnapshot({
        id: null,
        profileKey: `legacy:official:${gameContext.value.gameKey}`,
        configName: `${gameBaseInfo.value.name} 官方配置`,
        configScope: 'official',
        ownerDisplayName: 'Vertex 官方',
        ruleVersion: toSafeNumber(cloudRule.value?.ruleVersion, 0),
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
    hasCloudRule: computed(() => hasNexusRuleContent(cloudRule.value)),
    hasLocalOverride: computed(() => !!localRuleOverride.value),
    currentRuleJsonText: computed(() => buildNexusRuleEditorText(currentRule.value)),
    initializePage,
    saveEditorRule,
    applyInstallConfigProfile,
    useOfficialRule
  }
}
