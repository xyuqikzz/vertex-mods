import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../../shared/installation/install-rule-compiler.js'
import {
  SOURCE_PLATFORM_ERROR_CODES,
  assertSourceCapability,
  normalizeSourcePlatform
} from '../../../../../shared/sources/source-platform-registry.js'
import { validateInstallRuleSchema } from '../../../../ipc/game/install-engine/ruleSchemaValidator.js'

const PATH_FIELD_NAMES = new Set([
  'path',
  'relative_path',
  'relativePath',
  'source_path',
  'sourcePath',
  'target_path',
  'targetPath',
  'exe_globs',
  'exeGlobs',
  'any_paths',
  'anyPaths',
  'all_paths',
  'allPaths',
  'any_files',
  'anyFiles',
  'all_files',
  'allFiles',
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
const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential/i
const PRIVATE_URL_KEY_PATTERN = /(?:^|[_-])(?:url|uri)$|(?:url|uri)$/i
const PRIVATE_PATH_KEY_PATTERN =
  /(^|_)(private.?paths?|path.?list|paths?|file.?path|folder.?path|target.?path|backup.?path|game.?root|root.?path|staging.?path|install.?root)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function hasConfiguredOutputValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function redactUrlText(value = '') {
  return toSafeText(value).replace(URL_PATTERN, '[url]')
}

function redactInstallRuleText(value = '') {
  return redactUrlText(value)
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeInstallRuleOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return hasConfiguredOutputValue(value) ? '[url]' : ''
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    if (typeof value === 'string') {
      return redactInstallRuleText(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeInstallRuleOutput(item, key))
    }
    return hasConfiguredOutputValue(value) ? '[path]' : ''
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInstallRuleOutput(item))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactInstallRuleText(value) : value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeInstallRuleOutput(entryValue, entryKey)
  }
  return result
}

function parseRuleJsonText(text = '') {
  const sourceText = toSafeText(text)
  if (!sourceText) return null
  return parseInstallRuleJsonText(sourceText)
}

function resolveRawRuleJson(args = {}) {
  if (args?.ruleJson && typeof args.ruleJson === 'object' && !Array.isArray(args.ruleJson)) {
    return args.ruleJson
  }
  if (toSafeText(args?.ruleJsonText)) {
    return parseRuleJsonText(args.ruleJsonText)
  }
  return null
}

function hasSchemaVersionField(source = {}) {
  return Object.prototype.hasOwnProperty.call(source, 'schema_version') ||
    Object.prototype.hasOwnProperty.call(source, 'schemaVersion')
}

function resolveInstallRules(ruleJson = {}) {
  if (Array.isArray(ruleJson?.install_rules)) return ruleJson.install_rules
  if (Array.isArray(ruleJson?.installRules)) return ruleJson.installRules
  return []
}

function resolveGameDetect(ruleJson = {}) {
  if (ruleJson?.game_detect && typeof ruleJson.game_detect === 'object') return ruleJson.game_detect
  if (ruleJson?.gameDetect && typeof ruleJson.gameDetect === 'object') return ruleJson.gameDetect
  return null
}

function hasGameDetectCandidates(ruleJson = {}) {
  const gameDetect = resolveGameDetect(ruleJson)
  const candidates = Array.isArray(gameDetect?.candidates)
    ? gameDetect.candidates
    : Array.isArray(gameDetect?.candidate_list)
      ? gameDetect.candidate_list
      : Array.isArray(gameDetect?.candidateList)
        ? gameDetect.candidateList
        : []
  return candidates.length > 0
}

function resolveMergeStrategy(args = {}) {
  return toSafeText(args?.mergeStrategy || args?.merge_strategy).toLowerCase()
}

function isGameDetectOnlyMerge(args = {}) {
  return resolveMergeStrategy(args) === 'game_detect_only'
}

function isUnsafeRelativePath(value = '') {
  const text = toSafeText(value)
  if (!text) return false

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
    if (PATH_FIELD_NAMES.has(key)) {
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

function parseStoredRuleJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return toPlainJson(value, {})
  }
  const text = toSafeText(value)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function mergeGameDetectOnlyRuleJson(compiledRuleJson = {}, existingRuleJson = {}) {
  const existing =
    existingRuleJson && typeof existingRuleJson === 'object' && !Array.isArray(existingRuleJson)
      ? toPlainJson(existingRuleJson, {})
      : {}
  const gameDetect = resolveGameDetect(compiledRuleJson)
  const existingInstallRules = resolveInstallRules(existing)
  const variables = {
    ...(existing.variables && typeof existing.variables === 'object' ? existing.variables : {}),
    ...(compiledRuleJson.variables && typeof compiledRuleJson.variables === 'object'
      ? compiledRuleJson.variables
      : {})
  }
  const merged = {
    ...existing,
    schema_version:
      toSafeNumber(compiledRuleJson.schema_version || compiledRuleJson.schemaVersion, 0) ||
      toSafeNumber(existing.schema_version || existing.schemaVersion, 0) ||
      4,
    ...(Object.keys(variables).length ? { variables } : {}),
    game_detect: gameDetect,
    install_rules: existingInstallRules
  }
  delete merged.gameDetect
  delete merged.installRules
  return merged
}

async function resolveNexusDbDeps(deps = {}) {
  if (
    typeof deps.getNexusGameRuleOverride === 'function' &&
    typeof deps.upsertNexusGameRuleOverride === 'function'
  ) {
    return deps
  }

  const dbModule = await import('../../../../db/sources/nexus/nexusRuleOverride.js')
  return {
    getNexusGameRuleOverride: deps.getNexusGameRuleOverride || dbModule.getNexusGameRuleOverride,
    upsertNexusGameRuleOverride:
      deps.upsertNexusGameRuleOverride || dbModule.upsertNexusGameRuleOverride
  }
}

async function resolveModioDbDeps(deps = {}) {
  if (
    typeof deps.getLatestModioGameRuleByModioGameId === 'function' &&
    typeof deps.saveModioGameRuleIfNewer === 'function'
  ) {
    return deps
  }

  const dbModule = await import('../../../../db/sources/modio/modioRule.js')
  return {
    getLatestModioGameRuleByModioGameId:
      deps.getLatestModioGameRuleByModioGameId || dbModule.getLatestModioGameRuleByModioGameId,
    saveModioGameRuleIfNewer: deps.saveModioGameRuleIfNewer || dbModule.saveModioGameRuleIfNewer
  }
}

function normalizeSavedRecord(record = null) {
  if (!record || typeof record !== 'object') {
    return null
  }
  return {
    ...record,
    ruleJson: parseStoredRuleJson(record.ruleJson)
  }
}

export function validateInstallRuleConfig(args = {}) {
  const gameDetectOnly = isGameDetectOnlyMerge(args)
  let rawRuleJson = null
  try {
    rawRuleJson = resolveRawRuleJson(args)
  } catch (error) {
    return {
      valid: false,
      message: `规则 JSON 解析失败：${toSafeText(error?.message, '未知错误')}`
    }
  }

  if (!rawRuleJson || typeof rawRuleJson !== 'object' || Array.isArray(rawRuleJson)) {
    return {
      valid: false,
      message: '规则根节点必须是 JSON 对象'
    }
  }

  if (!hasSchemaVersionField(rawRuleJson)) {
    return {
      valid: false,
      message: '配置缺少 schema_version 或 schemaVersion'
    }
  }

  if (gameDetectOnly && !hasGameDetectCandidates(rawRuleJson)) {
    return {
      valid: false,
      message: '检测型配置缺少 game_detect.candidates，无法保存游戏目录识别规则'
    }
  }

  let compiled = null
  try {
    compiled = compileInstallRuleJson(rawRuleJson)
  } catch (error) {
    return {
      valid: false,
      message: `规则编译失败：${toSafeText(error?.message, '未知错误')}`
    }
  }

  const schemaValidation = validateInstallRuleSchema(compiled)
  if (!resolveInstallRules(compiled).length && !gameDetectOnly) {
    return { valid: false, message: '配置缺少 install_rules / installRules 或模板展开结果，且至少需要一条规则' }
  }
  if (schemaValidation.errors.length) {
    const messages = schemaValidation.errors
      .slice(0, 6)
      .map((item) => `${item.path || item.code}: ${item.message || item.code}`)
    return {
      valid: false,
      message: `规则结构校验失败：${messages.join('；')}`,
      diagnostics: schemaValidation.ruleDiagnostics
    }
  }

  const unsafePaths = collectUnsafePathFields(compiled).slice(0, 3)
  if (unsafePaths.length) {
    return {
      valid: false,
      message: `路径字段不能使用绝对路径或 .. 越界：${unsafePaths
        .map((item) => redactInstallRuleText(item))
        .join('；')}`
    }
  }

  return {
    valid: true,
    compiled,
    warnings: schemaValidation.warnings,
    configType: gameDetectOnly ? 'game_detect_only' : 'install_rule'
  }
}

function assertInstallRuleConfigSourceCapability(sourcePlatform = '') {
  if (sourcePlatform === 'aggregate') {
    return {
      success: false,
      ok: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.INVALID_AGGREGATE_SOURCE,
      source: 'aggregate',
      message: 'aggregate 只是展示来源，不能作为 AI 工具真实业务来源。请先解析 businessSource 或 targetSourcePlatform。'
    }
  }

  return assertSourceCapability(sourcePlatform, 'installRuleConfig')
}

function resolveNexusRuleVersion(args = {}, existing = null) {
  return Math.max(
    toSafeNumber(args?.ruleVersion, 0),
    toSafeNumber(existing?.ruleVersion, 0) + 1,
    1
  )
}

function resolveModioRuleVersion(args = {}, latest = null) {
  return Math.max(
    toSafeNumber(args?.ruleVersion, 0),
    toSafeNumber(latest?.ruleVersion, 0) + 1,
    1
  )
}

async function saveNexusInstallRuleConfig(args = {}, compiledRuleJson = {}, deps = {}) {
  const domainName = toSafeText(args.domainName).toLowerCase()
  if (!domainName) {
    return {
      success: false,
      errorCode: 'missing_nexus_domain_name',
      message: '保存 Nexus 本地安装配置需要 domainName。'
    }
  }

  const dbDeps = await resolveNexusDbDeps(deps)
  const getOverride = dbDeps.getNexusGameRuleOverride
  const upsertOverride = dbDeps.upsertNexusGameRuleOverride
  const existing = await getOverride({
    domainName,
    nexusGameId: toSafeNumber(args.nexusGameId, 0)
  })
  const finalRuleJson = isGameDetectOnlyMerge(args)
    ? mergeGameDetectOnlyRuleJson(compiledRuleJson, parseStoredRuleJson(existing?.ruleJson))
    : compiledRuleJson
  const ruleVersion = resolveNexusRuleVersion(args, existing)
  const result = await upsertOverride({
    nexusGameId: toSafeNumber(args.nexusGameId, 0),
    gameId: toSafeNumber(args.gameId, 0),
    appId: toSafeNumber(args.appId, 0),
    domainName,
    ruleVersion,
    ruleJson: finalRuleJson,
    baseRuleVersion: toSafeNumber(args.baseRuleVersion, existing?.baseRuleVersion || 0),
    baseRuleJson: args.baseRuleJson || existing?.baseRuleJson || '',
    dismissedRuleVersion: 0,
    dismissedRuleJson: '',
    sourceType: 'local_override'
  })

  if (!result?.success) {
    return sanitizeInstallRuleOutput({
      success: false,
      errorCode: result?.reason || 'save_nexus_rule_config_failed',
      message: '保存 Nexus 本地安装配置失败。',
      result
    })
  }

  return sanitizeInstallRuleOutput({
    success: true,
    saved: true,
    sourcePlatform: 'nexus',
    configScope: 'local_override',
    sourceType: 'local_override',
    domainName,
    nexusGameId: toSafeNumber(args.nexusGameId, 0),
    gameId: toSafeNumber(args.gameId, 0),
    appId: toSafeNumber(args.appId, 0),
    ruleVersion,
    configType: isGameDetectOnlyMerge(args) ? 'game_detect_only' : 'install_rule',
    record: normalizeSavedRecord(result.override),
    ruleJson: finalRuleJson,
    message: `已保存为 Nexus 本地安装配置：${domainName}。`
  })
}

async function saveModioInstallRuleConfig(args = {}, compiledRuleJson = {}, deps = {}) {
  const modioGameId = toSafeNumber(args.modioGameId || args.gameKey, 0)
  if (!modioGameId) {
    return {
      success: false,
      errorCode: 'missing_modio_game_id',
      message: '保存 Mod.io 本地安装配置需要 modioGameId。'
    }
  }

  const dbDeps = await resolveModioDbDeps(deps)
  const getLatest = dbDeps.getLatestModioGameRuleByModioGameId
  const saveRule = dbDeps.saveModioGameRuleIfNewer
  const latest = await getLatest(modioGameId)
  const finalRuleJson = isGameDetectOnlyMerge(args)
    ? mergeGameDetectOnlyRuleJson(compiledRuleJson, parseStoredRuleJson(latest?.ruleJson))
    : compiledRuleJson
  const ruleVersion = resolveModioRuleVersion(args, latest)
  const result = await saveRule({
    modioGameId,
    gameId: toSafeNumber(args.gameId, 0),
    nameId: toSafeText(args.nameId),
    ruleVersion,
    ruleJson: finalRuleJson,
    sourceType: 'local_override'
  })

  if (!result?.success) {
    return sanitizeInstallRuleOutput({
      success: false,
      errorCode: result?.reason || 'save_modio_rule_config_failed',
      message: '保存 Mod.io 本地安装配置失败。',
      result
    })
  }

  return sanitizeInstallRuleOutput({
    success: true,
    saved: result.saved !== false,
    sourcePlatform: 'modio',
    configScope: 'local_override',
    sourceType: 'local_override',
    modioGameId,
    gameId: toSafeNumber(args.gameId, 0),
    nameId: toSafeText(args.nameId),
    ruleVersion,
    configType: isGameDetectOnlyMerge(args) ? 'game_detect_only' : 'install_rule',
    record: normalizeSavedRecord(result.latest),
    ruleJson: finalRuleJson,
    message: `已保存为 Mod.io 本地安装配置：${modioGameId}。`
  })
}

export async function saveInstallRuleConfigTool(args = {}, deps = {}) {
  const sourcePlatform = normalizeSourcePlatform(args.sourcePlatform || args.source)
  const sourceCapability = assertInstallRuleConfigSourceCapability(sourcePlatform)
  if (!sourceCapability.ok) {
    return {
      success: false,
      errorCode:
        sourceCapability.errorCode || SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source: sourceCapability.source || sourcePlatform,
      message:
        sourceCapability.message ||
        '当前来源未开启 AI 保存本地安装规则配置能力；当前工具仅支持 Nexus / Mod.io。'
    }
  }

  const validation = validateInstallRuleConfig(args)
  if (!validation.valid) {
    return sanitizeInstallRuleOutput({
      success: false,
      errorCode: 'invalid_install_rule_config',
      message: validation.message,
      diagnostics: validation.diagnostics || []
    })
  }

  const result =
    sourcePlatform === 'nexus'
      ? await saveNexusInstallRuleConfig(args, validation.compiled, deps)
      : await saveModioInstallRuleConfig(args, validation.compiled, deps)

  if (!result.success) {
    return result
  }

  return sanitizeInstallRuleOutput({
    ...result,
    warnings: validation.warnings || [],
    ruleJson: result.ruleJson || validation.compiled,
    configType: validation.configType,
    note:
      '该工具写入的是本地安装规则覆盖配置，效果等同于在规则配置页保存自定义规则；不会上传到云端玩家配置。'
  })
}
