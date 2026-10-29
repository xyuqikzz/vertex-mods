import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'

const DEFAULT_MAX_DEPTH = 3
const VAMHUB_SOURCE_LABEL = resolveSourcePlatformLabel('vamhub', 'VAM-Hub')
const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i
const PRIVATE_URL_KEY_PATTERN =
  /(^|_)(url|download.?url|latest.?url|url.?hosted|request.?url|page.?url)$/i
const PRIVATE_PATH_KEY_PATTERN =
  /(^|_)(path|paths|file.?path|folder.?path|game.?root|root.?path|install.?root)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
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

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeVamFileName(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

function redactText(value = '') {
  return toSafeText(value)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function hasConfiguredValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function sanitizeVamHubRawValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return {
      configured: hasConfiguredValue(value)
    }
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    return {
      configured: hasConfiguredValue(value)
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeVamHubRawValue(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeVamHubRawValue(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}

function parseVamPackage(value = '', fallbackVersion = 1) {
  const base = toSafeText(value).replace(/\.var$/i, '')
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 2) {
    return {
      creator: '',
      name: base,
      version: Number(fallbackVersion || 1),
      sourceModKey: base,
      id: base
    }
  }
  const creator = parts[0]
  const last = parts[parts.length - 1]
  const hasVersion = /^\d+$/.test(last) || last.toLowerCase() === 'latest'
  const version = /^\d+$/.test(last) ? Number(last) : Number(fallbackVersion || 1)
  const name = (hasVersion ? parts.slice(1, -1) : parts.slice(1)).join('.')
  const sourceModKey = [creator, name || parts.slice(1).join('.')].filter(Boolean).join('.')
  return {
    creator,
    name: name || parts.slice(1).join('.'),
    version: version || 1,
    sourceModKey,
    id: [sourceModKey, version || 1].filter(Boolean).join('.')
  }
}

function normalizeInstallState(status = '') {
  const text = toSafeText(status).toLowerCase()
  if (text === 'installed') return 'reused_installed'
  if (text === 'queued') return 'queued'
  if (text === 'need_download' || text === 'upgraded') return 'pending'
  if (text === 'no_source') return 'unresolved'
  return text || 'metadata_only'
}

function normalizeErrorMessage(error = null) {
  const message = toSafeText(error?.message, 'VAM-Hub 依赖解析失败')
  if (/api.?key|token|cookie|secret|password|authorization|auth.?header|session/i.test(message)) {
    return 'VAM-Hub 授权或请求失败，请检查 Cookie 配置。'
  }
  return message
}

function flattenDependencyGroups(dependencies = {}) {
  if (Array.isArray(dependencies)) {
    return dependencies
  }
  if (!dependencies || typeof dependencies !== 'object') {
    return []
  }
  return Object.entries(dependencies).flatMap(([key, value]) => {
    const list = Array.isArray(value) ? value : value ? [value] : []
    return list.map((item) => ({
      ...toPlainJson(item, {}),
      dependencyType: pickFirstText(item?.dependencyType, item?.dependency_type, key)
    }))
  })
}

function resolvePackageIdentifier(candidate = {}, context = {}) {
  return pickFirstText(
    candidate.packageName,
    candidate.package_name,
    candidate.modId,
    candidate.mod_id,
    candidate.resourceId,
    candidate.resource_id,
    candidate.id,
    context?.mod?.packageName,
    context?.mod?.resourceId,
    context?.mod?.modId
  )
}

function resolveGameRoot(candidate = {}, context = {}) {
  return pickFirstText(
    candidate.gameRoot,
    candidate.gameRootPath,
    context?.game?.gameRoot,
    context?.game?.gameRootPath,
    context?.game?.installRoot,
    context?.install?.installRoot
  )
}

function normalizeVamHubNode(record = {}, options = {}) {
  if (!record || typeof record !== 'object') return null
  const downloadUrl = pickFirstText(record.downloadUrl, record.download_url, record.latestUrl)
  const fileName = normalizeVamFileName(
    record.filename || record.fileName || record.file_name || record.packageName || record.id
  )
  const parsed = parseVamPackage(fileName || record.packageName || record.id, record.version)
  const packageName = pickFirstText(
    record.packageName,
    record.package_name,
    fileName.replace(/\.var$/i, ''),
    parsed.sourceModKey,
    record.id
  )
  const id = pickFirstText(record.id, parsed.id, packageName)
  if (!id && !packageName) return null

  const dependencies = flattenDependencyGroups(record.dependencies).map((item) =>
    normalizeVamHubNode(item, {
      dependencyRole: pickFirstText(item?.dependencyType, item?.dependency_type, 'direct'),
      installState: 'metadata_only'
    })
  ).filter(Boolean)

  return {
    source: 'vamhub',
    sourceType: 'vamhub',
    id,
    modId: pickFirstText(record.modId, record.mod_id, packageName, id),
    resourceId: pickFirstText(record.resourceId, record.resource_id),
    packageName,
    filename: fileName,
    fileName,
    creator: pickFirstText(record.creator, parsed.creator),
    name: pickFirstText(record.name, parsed.name, packageName),
    version: pickFirstText(record.version, parsed.version),
    downloadUrlConfigured: Boolean(downloadUrl),
    fileSize: toSafeNumber(record.file_size_bytes ?? record.fileSize, 0),
    licenseType: pickFirstText(record.licenseType, record.license_type),
    dependencyRole: pickFirstText(
      record.dependencyRole,
      record.dependency_role,
      record.dependencyType,
      record.dependency_type,
      options.dependencyRole
    ),
    installState: options.installState || normalizeInstallState(record.status),
    installedVersion: record.installed_version ?? null,
    queuedVersion: record.queued_version ?? null,
    dependencies,
    dependencyCount: dependencies.length,
    isRoot: options.isRoot === true,
    depth: toSafeNumber(options.depth, 0),
    sortIndex: toSafeNumber(options.sortIndex, 0),
    raw: sanitizeVamHubRawValue(record)
  }
}

async function resolveVamHubResolver(ctx = {}, options = {}) {
  if (typeof ctx.resolveVamHubDependencies === 'function') {
    return ctx.resolveVamHubDependencies
  }
  if (options.allowDynamicImport !== true) {
    return null
  }
  const module = await import('../../../../../ipc/game/vamhub.js')
  return module.resolveVamHubDependencies
}

export async function resolveVamHubDependencies(args = {}, ctx = {}) {
  const candidate = toPlainJson(args.candidate, {})
  const context = toPlainJson(args.context || ctx?.pageContext, {})
  const packageName = resolvePackageIdentifier(candidate, context)
  if (!packageName) {
    return {
      success: false,
      source: 'vamhub',
      sourceLabel: VAMHUB_SOURCE_LABEL,
      errorCode: 'missing_vamhub_context',
      message: 'VAM-Hub 依赖解析缺少 packageName、resourceId 或 modId。'
    }
  }

  const maxDepth = Math.max(0, Math.min(6, toSafeNumber(args.maxDepth, DEFAULT_MAX_DEPTH)))
  const includeSubDependencies = args.includeSubDependencies !== false
  const gameRoot = resolveGameRoot(candidate, context)
  const resolver = await resolveVamHubResolver(ctx, {
    allowDynamicImport: true
  })
  let resolved = null

  if (typeof resolver === 'function') {
    try {
      resolved = await resolver({
        packageName,
        resourceId: pickFirstText(candidate.resourceId, candidate.resource_id),
        maxDepth,
        includeSubDependencies,
        gameRoot
      })
    } catch (error) {
      return {
        success: false,
        source: 'vamhub',
        sourceLabel: VAMHUB_SOURCE_LABEL,
        errorCode: 'vamhub_dependency_resolve_failed',
        message: normalizeErrorMessage(error)
      }
    }
  }

  const rawDependencies = Array.isArray(resolved?.dependencies)
    ? resolved.dependencies
    : flattenDependencyGroups(candidate.dependencies)
  const dependencies = rawDependencies
    .map((item, index) =>
      normalizeVamHubNode(item, {
        depth: 1,
        sortIndex: index + 1
      })
    )
    .filter(Boolean)
  const root = normalizeVamHubNode(
    {
      ...candidate,
      id: resolved?.main_package_id || candidate.id || packageName,
      filename: resolved?.main_package_filename || candidate.fileName || candidate.filename
    },
    {
      isRoot: true,
      depth: 0,
      sortIndex: 0,
      installState: 'root'
    }
  )
  const installPlan = [root, ...dependencies].filter(Boolean)
  const pendingInstallCount = dependencies.filter((item) =>
    ['pending', 'queued', 'metadata_only'].includes(item.installState)
  ).length
  const reusedInstalledDependencies = dependencies.filter(
    (item) => item.installState === 'reused_installed'
  )

  return {
    success: true,
    source: 'vamhub',
    sourceLabel: VAMHUB_SOURCE_LABEL,
    resolverStatus: resolved ? 'resolved' : dependencies.length ? 'metadata_only' : 'empty',
    recursive: Boolean(resolved),
    request: {
      packageName,
      gameRootConfigured: Boolean(gameRoot),
      maxDepth,
      includeSubDependencies
    },
    root,
    dependencies,
    dependencyCount: dependencies.length,
    pendingInstallCount,
    reusedInstalledDependencies,
    reusedInstalledDependencyCount: reusedInstalledDependencies.length,
    installPlan,
    totalSizeBytes: toSafeNumber(resolved?.total_size_bytes, 0),
    canSubmitInstallTask: false,
    message: resolved
      ? 'VAM-Hub 依赖已解析为只读计划，当前不会提交安装任务。'
      : 'VAM-Hub 仅返回候选中的依赖元数据，当前不会提交安装任务。'
  }
}
