import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import {
  compileInstallRuleJson as compileNexusRuleJson,
  parseInstallRuleJsonText as parseNexusRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import common from '@renderer/common/index.js'

export { parseNexusRuleJsonText }

export const INSTALL_CONFIG_SCOPE = Object.freeze({
  OFFICIAL: 'official',
  PLAYER: 'player'
})

export function createDefaultInstallConfigRuleJson() {
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

export function formatInstallConfigTime(value = '') {
  const text = String(value || '').trim()
  if (!text) {
    return '--'
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return text
  }

  return date.toLocaleString('zh-CN')
}

export function resolveInstallConfigScopeLabel(scope = '') {
  return String(scope || '').trim() === INSTALL_CONFIG_SCOPE.PLAYER ? uiText('dialogs.configDetail.player') : uiText('dialogs.configDetail.official')
}

export function resolveInstallConfigOwnerLabel(profile = {}) {
  if (String(profile?.configScope || '').trim() === INSTALL_CONFIG_SCOPE.OFFICIAL) {
    return uiText('ui.vertexOfficial')
  }

  return String(profile?.ownerDisplayName || '').trim() || uiText('ui.anonymousPlayer')
}

export function normalizeInstallConfigProfile(profile = {}) {
  const source = profile && typeof profile === 'object' ? profile : {}
  return {
    ...source,
    modTypeTags: Array.isArray(source?.modTypeTags) ? source.modTypeTags : [],
    targetPathTags: Array.isArray(source?.targetPathTags) ? source.targetPathTags : [],
    useCount: Number(source?.useCount || 0),
    installRuleCount: Number(source?.installRuleCount || 0),
    dependencyCount: Number(source?.dependencyCount || 0),
    isMine: !!source?.isMine,
    canEdit: !!source?.canEdit,
    canDelete: !!source?.canDelete
  }
}

export function resolveInstallConfigMinClientVersion(profile = {}) {
  return String(profile?.minClientVersion || profile?.min_version || profile?.minVersion || '').trim()
}

export function shouldWarnInstallConfigVersion(profile = {}, currentVersion = '') {
  const minClientVersion = resolveInstallConfigMinClientVersion(profile)
  const normalizedCurrentVersion = String(currentVersion || '').trim()
  if (!minClientVersion || !normalizedCurrentVersion) {
    return false
  }
  return common.compareVersions(normalizedCurrentVersion, minClientVersion) < 0
}

export function buildInstallConfigVersionWarningText(profile = {}, currentVersion = '') {
  const minClientVersion = resolveInstallConfigMinClientVersion(profile)
  const normalizedCurrentVersion = String(currentVersion || '').trim() || '未知'
  if (!minClientVersion) {
    return uiText('ui.yourVertexVersionIsValueSomeRulesMayBeUnsupported', { value1: (normalizedCurrentVersion) })
  }
  return uiText('ui.thisConfigurationRequiresVertexValueOrLaterYourVersionIs', { value1: (minClientVersion), value2: (normalizedCurrentVersion) })
}

export function normalizeInstallConfigPage(pageData = {}) {
  const source = pageData && typeof pageData === 'object' ? pageData : {}
  return {
    records: Array.isArray(source?.records)
      ? source.records.map((item) => normalizeInstallConfigProfile(item))
      : [],
    current: Number(source?.current || 1),
    size: Number(source?.size || 10),
    total: Number(source?.total || 0)
  }
}

export function buildInstallConfigQueryParams(context = {}, extra = {}) {
  const source = context && typeof context === 'object' ? context : {}
  const params = {
    sourcePlatform: String(source?.sourcePlatform || 'nexus').trim() || 'nexus'
  }
  const gameKey = String(source?.gameKey || '').trim()
  const domainName = String(source?.domainName || '').trim().toLowerCase()
  const nexusGameId = Number(source?.nexusGameId || 0)
  const gameId = Number(source?.gameId || 0)
  const appId = Number(source?.appId || 0)

  if (gameKey) {
    params.gameKey = gameKey
  }
  if (domainName) {
    params.domainName = domainName
  }
  if (nexusGameId > 0) {
    params.nexusGameId = nexusGameId
  }
  if (gameId > 0) {
    params.gameId = gameId
  }
  if (appId > 0) {
    params.appId = appId
  }

  return {
    ...params,
    ...(extra && typeof extra === 'object' ? extra : {})
  }
}

export function hasUsableInstallConfigContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {}
  return !!(
    String(source?.gameKey || '').trim() ||
    String(source?.domainName || '').trim() ||
    Number(source?.nexusGameId || 0) > 0 ||
    Number(source?.gameId || 0) > 0 ||
    Number(source?.appId || 0) > 0
  )
}

export function buildDefaultPlayerConfigRuleText(ruleJsonText = '') {
  const sourceText = String(ruleJsonText || '').trim()
  if (!sourceText) {
    return JSON.stringify(createDefaultInstallConfigRuleJson(), null, 2)
  }

  try {
    return JSON.stringify(JSON.parse(sourceText), null, 2)
  } catch {
    try {
      return JSON.stringify(parseNexusRuleJsonText(sourceText), null, 2)
    } catch {
      return JSON.stringify(createDefaultInstallConfigRuleJson(), null, 2)
    }
  }
}

const RULE_LIST_FIELD_ALIASES = Object.freeze([
  ['install_rules', 'installRules']
])

const INSTALL_CONFIG_PATH_FIELD_NAMES = new Set([
  'path',
  'relative_path',
  'relativePath',
  'source_path',
  'sourcePath',
  'target_path',
  'targetPath',
  'dir',
  'directory',
  'launch_target',
  'launchTarget',
  'inject_target',
  'injectTarget',
  'enable_target',
  'enableTarget',
  'enable_exe',
  'enableExe',
  'launch_exe',
  'launchExe',
  'inject_exe',
  'injectExe'
])

function resolveArrayByAliases(source = {}, aliases = []) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return []
  }

  for (const key of aliases) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function hasSchemaVersionField(source = {}) {
  return Object.prototype.hasOwnProperty.call(source, 'schema_version') ||
    Object.prototype.hasOwnProperty.call(source, 'schemaVersion')
}

function hasUsableRuleList(source = {}) {
  return RULE_LIST_FIELD_ALIASES.some((aliases) => resolveArrayByAliases(source, aliases).length > 0)
}

function isUnsafeRelativePath(value = '') {
  const text = String(value || '').trim()
  if (!text) {
    return false
  }

  const normalized = text.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')) {
    return true
  }

  return normalized.split('/').some((segment) => segment === '..')
}

function collectUnsafePathFields(node, pathList = [], result = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectUnsafePathFields(item, [...pathList, index], result))
    return result
  }

  if (!node || typeof node !== 'object') {
    return result
  }

  Object.entries(node).forEach(([key, value]) => {
    const fieldPath = [...pathList, key]
    if (INSTALL_CONFIG_PATH_FIELD_NAMES.has(key)) {
      const values = Array.isArray(value) ? value : [value]
      values.forEach((item) => {
        if (typeof item === 'string' && isUnsafeRelativePath(item)) {
          result.push(`${fieldPath.join('.')}: ${item}`)
        }
      })
    }
    collectUnsafePathFields(value, fieldPath, result)
  })

  return result
}

export function validateInstallConfigRuleObject(ruleJson = {}) {
  if (!ruleJson || typeof ruleJson !== 'object' || Array.isArray(ruleJson)) {
    return {
      valid: false,
      message: uiText('ui.theRuleRootMustBeAJSONObject')
    }
  }

  if (!hasSchemaVersionField(ruleJson)) {
    return {
      valid: false,
      message: uiText('ui.configurationIsMissingSchemaVersionOrSchemaVersion')
    }
  }

  if (!hasUsableRuleList(ruleJson) && !ruleJson.use_templates?.length) {
    return {
      valid: false,
      message: uiText('ui.configurationMustIncludeInstallRulesInstallRulesWithAtLeastOne')
    }
  }

  try {
    const compiled = compileNexusRuleJson(ruleJson)
    const unsafePaths = collectUnsafePathFields(compiled).slice(0, 3)
    if (unsafePaths.length) {
      return {
        valid: false,
        message: uiText('ui.pathFieldsCannotUseAbsolutePathsOrEscapeWithValue', { value1: (unsafePaths.join('；')) })
      }
    }

    return {
      valid: true,
      parsed: compiled,
      formattedText: JSON.stringify(compiled, null, 2)
    }
  } catch (error) {
    return {
      valid: false,
      message: uiText('ui.ruleCompilationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
    }
  }
}

export function createEmptyPlayerConfigDraft(context = {}, ruleJsonText = '') {
  const source = context && typeof context === 'object' ? context : {}
  const gameName =
    String(source?.gameName || source?.domainName || source?.gameKey || '当前游戏').trim() ||
    '当前游戏'

  return {
    id: null,
    configName: `${gameName} 玩家配置`,
    configDesc: '',
    ruleJsonText: buildDefaultPlayerConfigRuleText(ruleJsonText)
  }
}

export function validateInstallConfigRuleJsonText(text = '') {
  const rawText = String(text || '').trim()
  if (!rawText) {
    return {
      valid: false,
      message: uiText('ui.ruleJSONCannotBeEmpty')
    }
  }

  let parsed = null
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return {
      valid: false,
      message: uiText('ui.couldNotParseJSONValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
    }
  }

  return validateInstallConfigRuleObject(parsed)
}

export function buildPlayerInstallConfigPayload(draft = {}, context = {}) {
  const sourceDraft = draft && typeof draft === 'object' ? draft : {}
  const sourceContext = context && typeof context === 'object' ? context : {}
  const validation = validateInstallConfigRuleJsonText(sourceDraft?.ruleJsonText)

  if (!validation.valid) {
    throw new Error(validation.message || uiText('ui.invalidRuleJSON'))
  }

  const configName = String(sourceDraft?.configName || '').trim()
  if (!configName) {
    throw new Error(uiText('ui.configurationNameIsRequired'))
  }

  return {
    sourcePlatform: String(sourceContext?.sourcePlatform || 'nexus').trim() || 'nexus',
    gameKey: String(sourceContext?.gameKey || '').trim(),
    gameId: Number(sourceContext?.gameId || 0) || null,
    nexusGameId: Number(sourceContext?.nexusGameId || 0) || null,
    domainName: String(sourceContext?.domainName || '').trim().toLowerCase(),
    appId: Number(sourceContext?.appId || 0) || null,
    gameName: String(sourceContext?.gameName || '').trim(),
    configName,
    configDesc: String(sourceDraft?.configDesc || '').trim(),
    ruleJsonText: validation.formattedText
  }
}
