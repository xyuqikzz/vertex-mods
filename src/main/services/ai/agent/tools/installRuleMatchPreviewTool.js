import crypto from 'node:crypto'
import path from 'node:path'
import { resolveArchiveEvidence } from './archiveEvidence.js'

const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const WINDOWS_ABSOLUTE_PATH_DETECT_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/
const UNIX_ABSOLUTE_PATH_PATTERN = /(^|\s)(\/(?:Users|home|var|tmp|mnt|Volumes)\/[^\s"'<>]+)/g
const PRIVATE_PATH_KEY_PATTERN =
  /file.?path|archive.?path|staging.?path|root.?path|game.?root|target.?root|source.?root|candidate.?root/i
const RULE_EVIDENCE_PATH_KEY_PATTERN =
  /relative.?paths?|recursive.?file.?paths?|actual.?file.?paths?|missing.?files?|blocked.?paths?|candidate.?paths?/i
const RULE_RELATIVE_PATH_ANCHORS = Object.freeze(
  new Set([
    'bepinex',
    'plugins',
    'mods',
    'paks',
    'content',
    'manifest.json',
    'thunderstore.toml',
    'icon.png',
    'readme.md'
  ])
)

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

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)
}

function createPathSummary(value = '') {
  const text = toSafeText(value)
  if (!text) {
    return {
      configured: false
    }
  }
  return {
    configured: true,
    basename: path.basename(text),
    pathHash: hashText(path.resolve(text).toLowerCase())
  }
}

function redactText(value = '') {
  return toSafeText(value)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, '[path]')
    .replace(UNIX_ABSOLUTE_PATH_PATTERN, '$1[path]')
}

function normalizeRuleEvidencePath(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  const normalized = text.replace(/\\/g, '/')
  if (WINDOWS_ABSOLUTE_PATH_DETECT_PATTERN.test(text) || normalized.startsWith('/')) {
    const segments = normalized.split('/').filter(Boolean)
    const anchorIndex = segments.findIndex((segment) =>
      RULE_RELATIVE_PATH_ANCHORS.has(segment.toLowerCase())
    )
    if (anchorIndex >= 0) {
      return segments.slice(anchorIndex).join('/')
    }
    return path.basename(text)
  }
  return redactText(text)
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (RULE_EVIDENCE_PATH_KEY_PATTERN.test(key)) {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === 'string' ? normalizeRuleEvidencePath(item) : sanitizeValue(item, key)
        )
        .filter((item) => typeof item !== 'undefined')
    }
    if (typeof value === 'string') {
      return normalizeRuleEvidencePath(value)
    }
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    return createPathSummary(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, key))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      const text = redactText(value)
      return text.length > 500 ? `${text.slice(0, 500)}...` : text
    }
    return value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (['value', 'expected', 'before', 'after', 'current'].includes(entryKey) &&
      SENSITIVE_KEY_PATTERN.test(String(value.pointer || value.key || value.field || ''))) {
      result[entryKey] = '[redacted]'
      continue
    }
    if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
      continue
    }
    const sanitized = sanitizeValue(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}

function normalizeRuleJson(args = {}) {
  const value = args.ruleJson || args.rule_json || args.installRule || args.install_rule
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function createNextActions(result = {}) {
  if (result.success !== true) {
    return [
      {
        type: 'fix_preview_inputs',
        label: '补齐预演输入',
        message: result.message || '请先补齐规则 JSON、stagingPath 和 gameRoot。'
      }
    ]
  }
  if (result.matched === true) {
    return [
      {
        type: 'create_install_plan',
        label: '生成安装预检计划',
        message: '规则已经命中，可继续生成安装预检计划并让用户确认。'
      },
      {
        type: 'inspect_archive_structure',
        label: '复核压缩包结构',
        message: '如目标或源目录仍不符合预期，可回到压缩包结构检查确认文件层级。'
      }
    ]
  }
  return [
    {
      type: 'review_install_rule',
      label: '调整安装规则',
      message: '当前 staging 结构未命中任何规则，请根据 missing/blocked 证据调整 match 条件。'
    },
    {
      type: 'inspect_archive_structure',
      label: '检查压缩包结构',
      message: '先确认压缩包顶层目录和文件信号，再修改规则。'
    }
  ]
}

async function resolvePreviewInstallRuleMatches(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.previewInstallRuleMatches === 'function') {
    return dependencyOverrides.previewInstallRuleMatches
  }
  const module = await import('./installRuleEnginePreview.js')
  return module.previewInstallRuleWithEngine
}

export async function matchInstallRulePreviewTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  const ruleJson = normalizeRuleJson(args)
  if (!ruleJson) {
    return {
      success: false,
      matched: false,
      errorCode: 'missing_rule_json',
      message: '缺少 ruleJson，无法预演安装规则匹配。'
    }
  }

  let evidence = {}
  if (args.archiveRef || args.jobId) {
    try { evidence = await resolveArchiveEvidence(args, ctx) }
    catch (error) { return { success: false, errorCode: error.code, message: error.message } }
  }
  let planningContext = {}
  if (evidence.installData) {
    try {
      const { getInstallRulePlanningContext } = await import('../../../gameOperations.js')
      planningContext = getInstallRulePlanningContext(evidence.installData, ruleJson)
    } catch (error) { return { success: false, errorCode: 'install_context_unavailable', message: redactText(error.message) } }
  }
  const stagingPath = toSafeText(args.stagingPath || args.staging_path)
  const gameRoot = toSafeText(planningContext.gameRoot || args.gameRoot || args.game_root || args.rootPath || args.gamePath || evidence.gameRoot || ctx.pageContext?.game?.installRoot)
  const packageFolderName = toSafeText(
    args.packageFolderName || args.package_folder_name || args.archiveName || args.packageName
  )
  const previewInstallRuleMatches = await resolvePreviewInstallRuleMatches(dependencyOverrides)
  const result = await previewInstallRuleMatches({
    ruleJson,
    stagingPath,
    archivePath: evidence.archivePath,
    gameRoot,
    packageFolderName,
    source: args.source || evidence.source,
    installChoices: args.installChoices,
    offset: args.offset,
    installedCapabilities: planningContext.installedCapabilities || args.installedCapabilities,
    managedConfigContext: planningContext.managedConfigContext,
    data: planningContext.data,
    maxResults: args.maxResults || args.limit,
    maxCandidates: args.maxCandidates
  }, ctx)

  return toPlainJson(
    sanitizeValue({
      ...result,
      inputs: {
        stagingPath,
        gameRoot,
        packageFolderName,
        ruleCount: Array.isArray(ruleJson.install_rules) ? ruleJson.install_rules.length : 0,
        maxResults: toSafeNumber(args.maxResults || args.limit, 20),
        maxCandidates: toSafeNumber(args.maxCandidates, 50)
      },
      nextActions: createNextActions(result)
    }),
    {}
  )
}
