import {
  SOURCE_PLATFORM_ERROR_CODES,
  assertSourceCapability,
  getSourcePlatformCapabilityFlags,
  getSourcePlatformDefinition,
  normalizeSourceGameIdentity,
  normalizeSourcePlatform,
  resolveBusinessSource
} from '../../../../../shared/sources/source-platform-registry.js'
import { listAgentSourceCredentialSources } from '../../../../../shared/ai/installation/ai-agent-source-credential.js'
import { getSourceCredentialStatusTool } from './sourceCredentialTool.js'

const AUDIT_SECTIONS = Object.freeze(['source', 'binding', 'rule', 'file', 'auth', 'dependencies'])
const SENSITIVE_KEY_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session)/i
const PRIVATE_PATH_LIST_KEY_PATTERN = /(private.?paths?|path.?list|paths?)/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi
const PATH_VALUE_ALLOWLIST = new Set(['installRoot'])
const SENSITIVE_URL_PARAM_PATTERN =
  /^(api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization|auth|session|signature|key|expires)$/i

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeUrlText(value = '') {
  return toSafeText(value).replace(URL_PATTERN, (urlText) => {
    try {
      const url = new URL(urlText)
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
          url.searchParams.set(key, '[redacted]')
        }
      }
      if (url.hash) {
        const hashText = url.hash.slice(1)
        const queryIndex = hashText.indexOf('?')
        const hashQueryText = queryIndex >= 0 ? hashText.slice(queryIndex + 1) : hashText
        const hashPrefix = queryIndex >= 0 ? `${hashText.slice(0, queryIndex)}?` : ''
        const hashParams = new URLSearchParams(hashQueryText)
        let changed = false
        for (const key of Array.from(hashParams.keys())) {
          if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
            hashParams.set(key, '[redacted]')
            changed = true
          }
        }
        if (changed) {
          url.hash = `${hashPrefix}${hashParams.toString()}`
        }
      }
      return url.toString()
    } catch {
      return urlText
    }
  })
}

function sanitizeTextValue(value = '', key = '') {
  const keyText = toSafeText(key)
  const shouldKeepPath = PATH_VALUE_ALLOWLIST.has(keyText)
  let text = sanitizeUrlText(value)
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')

  if (!shouldKeepPath) {
    text = text.replace(WINDOWS_PATH_PATTERN, '[path]').replace(UNIX_PATH_PATTERN, '$1[path]')
  }

  return text
}

function sanitizeObject(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, key))
  }
  if (!isPlainObject(value)) {
    return typeof value === 'string' ? sanitizeTextValue(value, key) : value
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (SENSITIVE_KEY_PATTERN.test(key) || PRIVATE_PATH_LIST_KEY_PATTERN.test(key)) {
      return result
    }
    result[key] = sanitizeObject(item, key)
    return result
  }, {})
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeSections(sections = []) {
  if (!Array.isArray(sections) || !sections.length) {
    return [...AUDIT_SECTIONS]
  }
  const selected = sections
    .map((item) => toSafeText(item).toLowerCase())
    .filter(Boolean)
  const normalized = AUDIT_SECTIONS.filter((section) => selected.includes(section))
  return normalized.length ? normalized : [...AUDIT_SECTIONS]
}

function appendIssue(target = [], issue = {}) {
  const code = toSafeText(issue.code)
  const section = toSafeText(issue.section)
  if (!code || !section) return
  const exists = target.some((item) => item.code === code && item.section === section)
  if (exists) return
  target.push({
    code,
    section,
    message: toSafeText(issue.message, code)
  })
}

function appendNextAction(target = [], action = {}) {
  const type = toSafeText(action.type)
  if (!type) return
  if (target.some((item) => item.type === type)) return
  target.push({
    type,
    label: toSafeText(action.label, type),
    section: toSafeText(action.section)
  })
}

function resolveContext(args = {}, ctx = {}) {
  return toPlainJson(args.context || ctx?.pageContext, {})
}

function resolveCandidate(args = {}, context = {}) {
  return toPlainJson(args.candidate || context.mod || {}, {})
}

function resolveSourceRecord(args = {}, context = {}, candidate = {}) {
  return {
    displaySource: pickFirstText(
      args.displaySource,
      args.display_source,
      args.sourcePlatform,
      args.source_platform,
      args.source,
      candidate.displaySource,
      candidate.display_source,
      candidate.sourcePlatform,
      candidate.source_platform,
      candidate.source,
      context.displaySource,
      context.display_source,
      context.sourcePlatform,
      context.source_platform,
      context.page?.displaySource,
      context.page?.display_source,
      context.page?.sourcePlatform,
      context.page?.source_platform,
      context.page?.source
    ),
    sourcePlatform: pickFirstText(
      args.sourcePlatform,
      args.source_platform,
      args.source,
      candidate.sourcePlatform,
      candidate.source_platform,
      candidate.source,
      context.sourcePlatform,
      context.source_platform,
      context.page?.sourcePlatform,
      context.page?.source_platform,
      context.page?.source
    ),
    source: pickFirstText(args.source, candidate.source, context.source, context.page?.source),
    businessSource: pickFirstText(
      args.businessSource,
      args.business_source,
      candidate.businessSource,
      candidate.business_source,
      context.businessSource,
      context.business_source,
      context.page?.businessSource,
      context.page?.business_source
    ),
    targetSourcePlatform: pickFirstText(
      args.targetSourcePlatform,
      args.target_source_platform,
      candidate.targetSourcePlatform,
      candidate.target_source_platform,
      context.targetSourcePlatform,
      context.target_source_platform,
      context.page?.targetSourcePlatform,
      context.page?.target_source_platform
    )
  }
}

function resolveSource(args = {}, context = {}, candidate = {}) {
  const explicitSource = normalizeSourcePlatform(args.source)
  if (explicitSource && explicitSource !== 'aggregate') {
    return explicitSource
  }

  const sourceRecord = resolveSourceRecord(args, context, candidate)

  return (
    resolveBusinessSource(sourceRecord) ||
    normalizeSourcePlatform(
      pickFirstText(
        explicitSource,
        candidate.source,
        candidate.businessSource,
        candidate.sourceType,
        context.businessSource,
        context.page?.businessSource,
        context.page?.source
      )
    )
  )
}

function resolveSourceState(source = '', sourceRecord = {}) {
  const displaySource = normalizeSourcePlatform(
    pickFirstText(
      sourceRecord.displaySource,
      sourceRecord.sourcePlatform,
      sourceRecord.source,
      source
    )
  )
  const businessSource = source && source !== 'aggregate' ? source : resolveBusinessSource(sourceRecord)
  const displayDefinition = getSourcePlatformDefinition(displaySource)
  const businessDefinition = getSourcePlatformDefinition(businessSource)

  return {
    source,
    displaySource,
    businessSource: businessSource || '',
    displaySourceLabel: displaySource ? displayDefinition?.label || displaySource : '',
    businessSourceLabel: businessSource ? businessDefinition?.label || businessSource : ''
  }
}

function resolveIdentitySource(source = '', args = {}, context = {}, candidate = {}) {
  return {
    source,
    sourceGameId: pickFirstText(
      args.sourceGameId,
      args.gameId,
      candidate.sourceGameId,
      candidate.source_game_id,
      context.sourceGameId,
      context.game?.sourceGameId,
      context.game?.source_game_id,
      context.game?.gameId,
      context.game?.id
    ),
    sourceSlug: pickFirstText(
      args.sourceSlug,
      candidate.sourceSlug,
      candidate.source_slug,
      candidate.domainName,
      candidate.community,
      context.sourceSlug,
      context.game?.sourceSlug,
      context.game?.source_slug,
      context.game?.domainName,
      context.game?.community
    ),
    steamAppId: pickFirstText(
      args.steamAppId,
      candidate.steamAppId,
      candidate.steam_app_id,
      context.game?.steamAppId,
      context.game?.steam_app_id,
      context.game?.appId,
      context.game?.app_id
    )
  }
}

function resolveCandidateId(candidate = {}) {
  return pickFirstText(
    candidate.modId,
    candidate.mod_id,
    candidate.id,
    candidate.packageFullName,
    candidate.fullName,
    candidate.slug
  )
}

function buildSourceSection(source = '', definition = null, sourceState = {}) {
  const capabilities = getSourcePlatformCapabilityFlags(source)
  return {
    source,
    displaySource: sourceState.displaySource || source,
    businessSource: sourceState.businessSource || (source === 'aggregate' ? '' : source),
    label: definition?.label || source,
    displaySourceLabel: sourceState.displaySourceLabel || definition?.label || source,
    businessSourceLabel: sourceState.businessSourceLabel || (source === 'aggregate' ? '' : definition?.label || source),
    status: definition?.status || '',
    capabilities
  }
}

function auditSource({ source, definition, sourceState, identity, sections, blockers, warnings, nextActions }) {
  if (!sections.includes('source')) return {}
  const sourceSection = buildSourceSection(source, definition, sourceState)

  if (!source) {
    appendIssue(blockers, {
      section: 'source',
      code: SOURCE_PLATFORM_ERROR_CODES.UNSUPPORTED_SOURCE,
      message: '缺少来源平台，无法判断是否能生成安装预检。'
    })
    appendNextAction(nextActions, {
      section: 'source',
      type: 'select_source',
      label: '选择真实业务来源'
    })
    return sourceSection
  }

  if (!definition) {
    appendIssue(blockers, {
      section: 'source',
      code: SOURCE_PLATFORM_ERROR_CODES.UNSUPPORTED_SOURCE,
      message: `来源 ${source} 未接入 Vertex 来源平台注册表。`
    })
    return sourceSection
  }

  if (source === 'aggregate') {
    appendIssue(blockers, {
      section: 'source',
      code: SOURCE_PLATFORM_ERROR_CODES.INVALID_AGGREGATE_SOURCE,
      message: 'aggregate 只是展示来源，不能作为 AI 工具真实业务来源。'
    })
    appendNextAction(nextActions, {
      section: 'source',
      type: 'resolve_business_source',
      label: '解析真实业务来源'
    })
    return sourceSection
  }

  const capability = assertSourceCapability(source, 'ai.installPlan')
  if (!capability.ok) {
    appendIssue(blockers, {
      section: 'source',
      code: capability.errorCode || SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      message: capability.message
    })
  }

  if (!identity.hasIdentity) {
    appendIssue(blockers, {
      section: 'source',
      code: SOURCE_PLATFORM_ERROR_CODES.MISSING_SOURCE_IDENTITY,
      message: '缺少 sourceGameId、sourceSlug 或 steamAppId，无法稳定定位来源游戏。'
    })
    appendNextAction(nextActions, {
      section: 'source',
      type: 'select_game',
      label: '选择来源游戏'
    })
  }

  if (definition.status === 'active-pending-ai') {
    appendIssue(warnings, {
      section: 'source',
      code: 'source_pending_ai',
      message: `${definition.label || source} 仍处于 AI 能力待接入状态。`
    })
  }

  return {
    ...sourceSection,
    identity
  }
}

function auditBinding({ context, sections, blockers, nextActions }) {
  if (!sections.includes('binding')) return {}
  const game = isPlainObject(context.game) ? context.game : {}
  const installContext = isPlainObject(context.install) ? context.install : {}
  const bindingStatus = isPlainObject(installContext.bindingStatus) ? installContext.bindingStatus : {}
  const installDirectory = isPlainObject(installContext.installDirectory)
    ? installContext.installDirectory
    : {}
  const installRoot = pickFirstText(
    game.installRoot,
    game.gameRoot,
    game.gameRootPath,
    game.clientRootPath,
    installContext.installRoot,
    bindingStatus.installRoot,
    installDirectory.installRoot
  )
  const executableFile = pickFirstText(game.executableFile, game.clientExePath, game.gameExePath)
  const bindingConfigured = Boolean(
    game.bindingConfigured === true ||
      game.gameRootConfigured === true ||
      installContext.bindingConfigured === true ||
      bindingStatus.configured === true ||
      installRoot
  )

  if (!bindingConfigured) {
    appendIssue(blockers, {
      section: 'binding',
      code: 'missing_game_binding',
      message: '当前上下文没有可用的游戏目录或绑定状态。'
    })
    appendNextAction(nextActions, {
      section: 'binding',
      type: 'bind_game_root',
      label: '绑定或选择游戏目录'
    })
  }

  return {
    bindingConfigured,
    gameId: pickFirstText(game.gameId, game.id),
    sourceGameId: pickFirstText(
      game.sourceGameId,
      game.source_game_id,
      bindingStatus.sourceGameId,
      bindingStatus.source_game_id
    ),
    sourceSlug: pickFirstText(
      game.sourceSlug,
      game.source_slug,
      game.domainName,
      bindingStatus.sourceSlug,
      bindingStatus.source_slug
    ),
    steamAppId: pickFirstText(game.steamAppId, game.steam_app_id, game.appId, bindingStatus.appId),
    gameName: pickFirstText(game.name),
    installRoot,
    installRootConfigured: Boolean(installRoot),
    executableFile,
    executableConfigured: Boolean(executableFile),
    profileName: pickFirstText(
      game.profileName,
      game.profile,
      installContext.profileName,
      bindingStatus.profileName,
      installContext.profile?.name
    )
  }
}

function auditRule({ context, candidate, sections, warnings, nextActions }) {
  if (!sections.includes('rule')) return {}
  const ruleContext = isPlainObject(context.rule) ? context.rule : {}
  const installContext = isPlainObject(context.install) ? context.install : {}
  const ruleStatus = isPlainObject(installContext.ruleStatus) ? installContext.ruleStatus : {}
  const ruleConfigured = Boolean(
    ruleContext.configured === true ||
      ruleContext.ruleConfigured === true ||
      ruleStatus.configured === true ||
      installContext.ruleConfigured === true ||
      candidate.ruleConfigured === true ||
      candidate.installRule ||
      candidate.rule
  )

  if (!ruleConfigured) {
    appendIssue(warnings, {
      section: 'rule',
      code: 'missing_rule_signal',
      message: '当前上下文没有安装规则已配置的明确信号。'
    })
    appendNextAction(nextActions, {
      section: 'rule',
      type: 'open_rule_config',
      label: '检查安装规则配置'
    })
  }

  return {
    ruleConfigured,
    ruleVersion: pickFirstText(
      ruleContext.version,
      ruleContext.ruleVersion,
      ruleStatus.version,
      ruleStatus.ruleVersion,
      candidate.ruleVersion
    ),
    ruleSource: pickFirstText(ruleContext.source, ruleStatus.source, candidate.ruleSource),
    appliesToCurrentGame:
      ruleContext.appliesToCurrentGame === true ||
      ruleStatus.appliesToCurrentGame === true ||
      installContext.ruleAppliesToCurrentGame === true
  }
}

function auditFile({ candidate, sections, blockers, warnings, nextActions }) {
  if (!sections.includes('file')) return {}
  const selectedFile = isPlainObject(candidate.selectedFile) ? candidate.selectedFile : {}
  const selectedVersion = isPlainObject(candidate.selectedVersion) ? candidate.selectedVersion : {}
  const modId = resolveCandidateId(candidate)
  const fileId = pickFirstText(
    candidate.fileId,
    candidate.file_id,
    selectedFile.fileId,
    selectedFile.file_id,
    selectedFile.id,
    selectedVersion.fileId,
    selectedVersion.file_id,
    selectedVersion.id
  )
  const downloadUrl = pickFirstText(
    candidate.downloadUrl,
    candidate.download_url,
    selectedFile.downloadUrl,
    selectedFile.download_url,
    selectedVersion.downloadUrl,
    selectedVersion.download_url
  )
  const fileName = pickFirstText(
    candidate.fileName,
    candidate.file_name,
    selectedFile.fileName,
    selectedFile.file_name,
    selectedFile.name,
    selectedVersion.fileName,
    selectedVersion.file_name,
    selectedVersion.name
  )

  if (!modId) {
    appendIssue(blockers, {
      section: 'file',
      code: 'missing_candidate',
      message: '缺少候选模组标识，无法继续体检安装文件。'
    })
    appendNextAction(nextActions, {
      section: 'file',
      type: 'select_candidate',
      label: '选择候选模组'
    })
  } else if (!fileId && !downloadUrl) {
    appendIssue(warnings, {
      section: 'file',
      code: 'missing_file_selection',
      message: '当前候选还没有明确 fileId 或 downloadUrl，可能需要读取详情或选择文件。'
    })
    appendNextAction(nextActions, {
      section: 'file',
      type: 'resolve_mod_detail',
      label: '读取模组详情或选择文件'
    })
  }

  return {
    modId,
    name: pickFirstText(candidate.name, candidate.modName, candidate.title),
    version: pickFirstText(
      candidate.version,
      candidate.modVersion,
      selectedVersion.version,
      selectedVersion.versionNumber,
      selectedVersion.version_number,
      selectedFile.version,
      selectedFile.versionNumber,
      selectedFile.version_number
    ),
    fileId,
    fileName,
    loader: pickFirstText(
      candidate.loader,
      candidate.packageLoader,
      selectedFile.loader,
      selectedFile.packageLoader,
      selectedVersion.loader,
      selectedVersion.packageLoader
    ),
    downloadAvailable: Boolean(downloadUrl),
    hasDownloadUrl: Boolean(downloadUrl)
  }
}

async function auditAuth({ source, sections, warnings, nextActions, ctx, deps }) {
  if (!sections.includes('auth')) return {}
  const credentialSources = listAgentSourceCredentialSources()
  if (!credentialSources.includes(source)) {
    return {
      source,
      required: false,
      configured: true,
      status: 'not_required'
    }
  }

  const credentialResult = await getSourceCredentialStatusTool({ source }, ctx, deps)
  const status = isPlainObject(credentialResult.status) ? credentialResult.status : {}
  const required = status.required !== false
  if (required && (credentialResult.success === false || status.configured !== true)) {
    appendIssue(warnings, {
      section: 'auth',
      code: 'missing_source_credential',
      message: `${status.label || source} 尚未配置来源授权。`
    })
    if (status.configurable === true) {
      appendNextAction(nextActions, {
        section: 'auth',
        type: 'configure_source_credential',
        label: `配置 ${status.label || source} 授权`
      })
    } else {
      appendNextAction(nextActions, {
        section: 'auth',
        type: 'open_source_credential_page',
        label: `打开 ${status.label || source} 页面配置授权`
      })
    }
  }

  return {
    source,
    required,
    configurable: status.configurable === true,
    configured: status.configured === true,
    localConfigured: status.localConfigured === true,
    serverConfigured: status.serverConfigured === true,
    credentialType: pickFirstText(status.credentialType),
    status: pickFirstText(status.status),
    apiKeySource: pickFirstText(status.apiKeySource),
    helpUrl: pickFirstText(status.helpUrl),
    helpText: pickFirstText(status.helpText)
  }
}

function auditDependencies({ source, candidate, sections, warnings, nextActions }) {
  if (!sections.includes('dependencies')) return {}
  const capabilities = getSourcePlatformCapabilityFlags(source)
  const dependencyCount = Number(candidate.dependencyCount || candidate.dependencies?.length || 0)
  if (!capabilities.dependencies) {
    appendIssue(warnings, {
      section: 'dependencies',
      code: SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      message: '当前来源尚未开启统一依赖解析能力。'
    })
  } else if (dependencyCount > 0) {
    appendNextAction(nextActions, {
      section: 'dependencies',
      type: 'resolve_dependencies',
      label: '解析候选依赖'
    })
  }

  return {
    supported: capabilities.dependencies === true,
    dependencyCount: Number.isFinite(dependencyCount) ? dependencyCount : 0,
    hasDependencyMetadata:
      Array.isArray(candidate.dependencies) ||
      Array.isArray(candidate.requiredDependencies) ||
      dependencyCount > 0
  }
}

export async function auditInstallContextTool(args = {}, ctx = {}, deps = {}) {
  const context = resolveContext(args, ctx)
  const candidate = resolveCandidate(args, context)
  const sourceRecord = resolveSourceRecord(args, context, candidate)
  const source = resolveSource(args, context, candidate)
  const definition = getSourcePlatformDefinition(source)
  const sourceState = resolveSourceState(source, sourceRecord)
  const sections = normalizeSections(args.sections)
  const blockers = []
  const warnings = []
  const nextActions = []
  const identityInput = resolveIdentitySource(source, args, context, candidate)
  const identity = normalizeSourceGameIdentity(source, identityInput)

  const sectionResults = {
    source: auditSource({
      source,
      definition,
      sourceState,
      identity,
      sections,
      blockers,
      warnings,
      nextActions
    }),
    binding: auditBinding({
      context,
      sections,
      blockers,
      nextActions
    }),
    rule: auditRule({
      context,
      candidate,
      sections,
      warnings,
      nextActions
    }),
    file: auditFile({
      candidate,
      sections,
      blockers,
      warnings,
      nextActions
    }),
    auth: await auditAuth({
      source,
      sections,
      warnings,
      nextActions,
      ctx,
      deps
    }),
    dependencies: auditDependencies({
      source,
      candidate,
      sections,
      warnings,
      nextActions
    })
  }

  return sanitizeObject({
    success: true,
    source,
    displaySource: sourceState.displaySource,
    businessSource: sourceState.businessSource,
    sourceLabel: definition?.label || source,
    displaySourceLabel: sourceState.displaySourceLabel,
    businessSourceLabel: sourceState.businessSourceLabel,
    ready: blockers.length === 0,
    blockers,
    warnings,
    nextActions,
    sections: sections.reduce((result, section) => {
      result[section] = sectionResults[section] || {}
      return result
    }, {})
  })
}
