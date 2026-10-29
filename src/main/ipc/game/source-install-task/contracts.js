import crypto from 'crypto'

export const SOURCE_INSTALL_TASK_CHANNELS = Object.freeze({
  CREATE: 'source-install-task:create',
  LIST: 'source-install-task:list',
  SUMMARY: 'source-install-task:summary',
  DETAIL: 'source-install-task:detail',
  PAUSE: 'source-install-task:pause',
  RESUME: 'source-install-task:resume',
  CANCEL: 'source-install-task:cancel',
  AUTHORIZATION_ACTION: 'source-install-task:authorization-action',
  RETRY: 'source-install-task:retry',
  CLEAR_COMPLETED: 'source-install-task:clear-completed',
  DELETE: 'source-install-task:delete'
})

export const SOURCE_INSTALL_TASK_EVENTS = Object.freeze({
  JOB_UPDATED: 'source-install-task:updated',
  ITEM_UPDATED: 'source-install-task:item-updated',
  ARTIFACT_UPDATED: 'source-install-task:artifact-updated',
  DOWNLOAD_ENQUEUED: 'source-install-task:download-enqueued',
  LOG: 'source-install-task:log'
})

export const JOB_STATE = Object.freeze({
  CREATED: 'created',
  PRECHECKING: 'prechecking',
  PRECHECK_BLOCKED: 'precheck_blocked',
  RESOLVING: 'resolving',
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  PREVIEWING: 'previewing',
  INSTALLING: 'installing',
  HEALTH_CHECKING: 'health_checking',
  COMPLETED: 'completed',
  COMPLETED_WITH_WARNING: 'completed_with_warning',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  WAITING_USER_ACTION: 'waiting_user_action',
  WAITING: 'waiting',
  RECOVERABLE: 'recoverable'
})

export const ITEM_STATE = Object.freeze({
  CREATED: 'created',
  PRECHECKING: 'prechecking',
  PRECHECK_BLOCKED: 'precheck_blocked',
  WAITING_DEPENDENCY: 'waiting_dependency',
  WAITING_AUTHORIZATION: 'waiting_authorization',
  AUTHENTICATING: 'authenticating',
  WAITING_ARTIFACT: 'waiting_artifact',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  INSPECTING_ARCHIVE: 'inspecting_archive',
  PREVIEWING: 'previewing',
  WAITING_INSTALL: 'waiting_install',
  INSTALLING: 'installing',
  DEPLOYING: 'deploying',
  RECORDING: 'recording',
  HEALTH_CHECKING: 'health_checking',
  INSTALLED: 'installed',
  FILE_READY: 'file_ready',
  SKIPPED_INSTALLED: 'skipped_installed',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
})

export const ARTIFACT_STATE = Object.freeze({
  CREATED: 'created',
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  MISSING: 'missing'
})

export const TERMINAL_JOB_STATES = new Set([
  JOB_STATE.COMPLETED,
  JOB_STATE.COMPLETED_WITH_WARNING,
  JOB_STATE.PARTIAL_FAILED,
  JOB_STATE.FAILED,
  JOB_STATE.CANCELLED
])

export const TERMINAL_ITEM_STATES = new Set([
  ITEM_STATE.INSTALLED,
  ITEM_STATE.FILE_READY,
  ITEM_STATE.SKIPPED_INSTALLED,
  ITEM_STATE.SKIPPED,
  ITEM_STATE.PRECHECK_BLOCKED,
  ITEM_STATE.FAILED,
  ITEM_STATE.CANCELLED
])

export const PRECHECK_STATUS = Object.freeze({
  PASSED: 'passed',
  WARNING: 'warning',
  BLOCKED: 'blocked'
})

export const HEALTH_STATUS = Object.freeze({
  PASSED: 'passed',
  WARNING: 'warning',
  FAILED: 'failed'
})

export const FAILURE_STAGE = Object.freeze({
  DOWNLOAD_FAILED: 'download_failed',
  ARCHIVE_INSPECT_FAILED: 'archive_inspect_failed',
  RULE_COMPILE_FAILED: 'rule_compile_failed',
  RULE_MISSED: 'rule_missed',
  UNSUPPORTED_PACKAGE: 'unsupported_package',
  TARGET_INVALID: 'target_invalid',
  PATH_UNSAFE: 'path_unsafe',
  DEPENDENCY_MISSING: 'dependency_missing',
  DEPENDENCY_FAILED: 'dependency_failed',
  CONFLICT_DETECTED: 'conflict_detected',
  DEPLOY_FAILED: 'deploy_failed',
  RECORD_FAILED: 'record_failed',
  HEALTH_CHECK_FAILED: 'health_check_failed',
  TASK_RECOVERY_REQUIRED: 'task_recovery_required',
  UNKNOWN_FAILED: 'unknown_failed'
})

export const SOURCE_INSTALL_TASK_ERROR_CODE = Object.freeze({
  CANCELLED: 'SOURCE_INSTALL_TASK_CANCELLED',
  PAUSED: 'SOURCE_INSTALL_TASK_PAUSED',
  LOCK_RETRY_EXHAUSTED: 'SOURCE_INSTALL_TASK_LOCK_RETRY_EXHAUSTED'
})

export function nowIso() {
  return new Date().toISOString()
}

export function createId(prefix = 'id') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

export function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toPlainJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? fallback))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function buildDownloadCenterTaskProjection(task = {}) {
  return {
    managedByInstallTask: true,
    id: toSafeText(task.id),
    task_name: toSafeText(task.task_name || task.taskName, '模组下载'),
    module: toSafeText(task.module, '游戏'),
    file_type: toSafeText(task.file_type || task.fileType, 'unknown'),
    file_size: toSafeNumber(task.file_size || task.fileSize, 0),
    speed: toSafeNumber(task.speed, 0),
    percentage: toSafeNumber(task.percentage || task.progress, 0),
    sourcePlatform: toSafeText(task.sourcePlatform || task.sourceType || task.source)
  }
}

export function buildDownloadCenterLifecycleProjection(payload = {}) {
  return {
    id: toSafeText(payload.id),
    message: toSafeText(payload.message),
    totalBytes: toSafeNumber(payload.totalBytes, 0),
    receivedBytes: toSafeNumber(payload.receivedBytes, 0),
    speed: toSafeNumber(payload.speed, 0),
    progress: toSafeNumber(payload.progress, 0),
    fileType: toSafeText(payload.fileType, 'unknown'),
    fileName: toSafeText(payload.fileName),
    filePath: toSafeText(payload.filePath),
    supportsRange: !!payload.supportsRange,
    isPaused: !!payload.isPaused
  }
}

export function buildDownloadHistoryUrlProjection(task = {}) {
  const downloadUrl = toSafeText(task.download_url || task.downloadUrl)
  if (!downloadUrl) return ''
  const source = toSafeText(
    task.sourcePlatform || task.sourceType || task.source
  ).toLowerCase()
  if (source === 'nexus' || /^nxm:\/\//i.test(downloadUrl)) return ''
  try {
    const url = new URL(downloadUrl)
    const sensitiveNames = new Set([
      'auth',
      'authorization',
      'expires',
      'jwt',
      'key',
      'signature',
      'token',
      'user_id',
      'userid'
    ])
    if ([...url.searchParams.keys()].some((key) => sensitiveNames.has(key.toLowerCase()))) {
      return ''
    }
  } catch {
    return ''
  }
  return downloadUrl
}

export function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  const text = toSafeText(value)
  if (!text) {
    return fallback
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
  }
  const text = toSafeText(value)
  if (!text) {
    return fallback
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function stringifyJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return fallback
  }
}

export function normalizeSource(value = '') {
  return toSafeText(value, 'nexus').toLowerCase()
}

export function normalizeSourceAdapter(value = '', fallback = 'nexus') {
  return toSafeText(value, fallback).toLowerCase()
}

export function hashText(value = '') {
  return crypto
    .createHash('sha1')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16)
}

function compactKeyPart(value = '') {
  return toSafeText(value, 'unknown').replace(/\s+/g, '-').replace(/[|]+/g, '-')
}

function resolveGameKey(payload = {}) {
  return (
    toSafeText(payload.gameKey) ||
    [
      normalizeSource(payload.source || payload.sourceType || payload.sourcePlatform),
      toSafeText(payload.sourceGameId || payload.gameSourceId || payload.gameId || payload.appid)
    ]
      .filter(Boolean)
      .join(':') ||
    'unknown'
  )
}

function resolveEntryObject(entry = {}) {
  const source = entry && typeof entry === 'object' ? entry : {}
  const item = source.item && typeof source.item === 'object' ? source.item : source
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {}
  return { item, meta }
}

export function normalizeCreatePayload(payload = {}) {
  const sourcePayload = payload && typeof payload === 'object' ? payload : {}
  const source = normalizeSource(
    sourcePayload.source ||
      sourcePayload.sourceType ||
      sourcePayload.sourcePlatform ||
      sourcePayload.sourceMeta?.source
  )
  const sourceAdapter = normalizeSourceAdapter(
    sourcePayload.sourceAdapter || sourcePayload.source_adapter || source,
    source
  )
  const itemList = Array.isArray(sourcePayload.items)
    ? sourcePayload.items
    : Array.isArray(sourcePayload.batchEntries)
      ? sourcePayload.batchEntries
      : Array.isArray(sourcePayload.entries)
        ? sourcePayload.entries
        : sourcePayload.mainItem
          ? [{ item: sourcePayload.mainItem, meta: sourcePayload.mainMeta || {} }]
          : []

  return {
    ...toPlainJson(sourcePayload, {}),
    source,
    sourceAdapter,
    gameKey: resolveGameKey({ ...sourcePayload, source }),
    gameRoot: toSafeText(
      sourcePayload.gameRoot ||
        sourcePayload.gameRootPath ||
        sourcePayload.detectedRootPath ||
        sourcePayload.clientRootPath ||
        sourcePayload.client_root_path
    ),
    items: itemList.map((entry) => toPlainJson(entry, {}))
  }
}

export function resolveEntryDownloadTask(entry = {}) {
  return resolveEntryObject(entry).item || {}
}

export function resolveEntryMeta(entry = {}) {
  return resolveEntryObject(entry).meta || {}
}

export function resolveInstallPayload(entry = {}) {
  const { meta, item } = resolveEntryObject(entry)
  const payload =
    meta.installPayload && typeof meta.installPayload === 'object'
      ? meta.installPayload
      : entry.installPayload && typeof entry.installPayload === 'object'
        ? entry.installPayload
        : item.installPayload && typeof item.installPayload === 'object'
          ? item.installPayload
          : {}
  return payload
}

export function resolveItemTitle(entry = {}) {
  const { item, meta } = resolveEntryObject(entry)
  const installPayload = resolveInstallPayload(entry)
  return (
    toSafeText(meta.displayName) ||
    toSafeText(installPayload.modName) ||
    toSafeText(installPayload.name) ||
    toSafeText(item.task_name) ||
    toSafeText(item.name) ||
    '安装项'
  )
}

export function resolveItemVersion(entry = {}) {
  const installPayload = resolveInstallPayload(entry)
  return (
    toSafeText(installPayload.version) ||
    toSafeText(installPayload.modVersion) ||
    toSafeText(resolveEntryDownloadTask(entry).version)
  )
}

export function resolveSourceModKey(entry = {}) {
  const { item, meta } = resolveEntryObject(entry)
  const installPayload = resolveInstallPayload(entry)
  const dependencyRef =
    meta.dependencyRef && typeof meta.dependencyRef === 'object' ? meta.dependencyRef : {}
  return (
    toSafeText(installPayload.sourceModKey || installPayload.source_mod_key) ||
    toSafeText(dependencyRef.sourceModKey || dependencyRef.source_mod_key) ||
    toSafeText(item.sourceModKey || item.source_mod_key) ||
    [
      normalizeSource(item.sourceType || item.sourcePlatform || installPayload.sourceType),
      toSafeText(installPayload.modId || item.sourceModId || item.modId),
      toSafeText(installPayload.id || item.sourceFileId || item.fileId)
    ]
      .filter(Boolean)
      .join(':')
  )
}

export function resolveItemType(entry = {}) {
  const meta = resolveEntryMeta(entry)
  const installPayload = resolveInstallPayload(entry)
  const dependencyRef =
    meta.dependencyRef && typeof meta.dependencyRef === 'object' ? meta.dependencyRef : {}
  const metadata =
    installPayload.metadata && typeof installPayload.metadata === 'object'
      ? installPayload.metadata
      : {}
  const role = toSafeText(
    dependencyRef.dependencyRole || dependencyRef.dependency_role
  ).toLowerCase()
  const category = toSafeText(metadata.category).toLowerCase()

  if (
    dependencyRef.isDefaultDependency ||
    role === 'default_dependency' ||
    category === 'default_dependency' ||
    toSafeNumber(installPayload.typeId, 0) === 1
  ) {
    return 'default_dependency'
  }
  if (role || category.includes('requirement') || category.includes('dependency')) {
    return 'dependency'
  }
  return 'main'
}

export function buildArtifactKey(payload = {}, entry = {}) {
  const { item, meta } = resolveEntryObject(entry)
  const installPayload = resolveInstallPayload(entry)
  const explicitKey = toSafeText(meta.artifactKey || item.artifactKey || installPayload.artifactKey)
  if (explicitKey) {
    return explicitKey.startsWith('artifact:') ? explicitKey : `artifact:${explicitKey}`
  }

  const source = normalizeSource(payload.source || item.sourceType || item.sourcePlatform)
  const gameKey = compactKeyPart(resolveGameKey({ ...payload, source }))
  const dedupeKey = toSafeText(item.dedupeKey || item.taskDedupeKey || item.conflictKey)
  if (dedupeKey) {
    return `artifact:${source}:${gameKey}:${compactKeyPart(dedupeKey)}`
  }

  const provider =
    toSafeText(item.sourceType || item.sourcePlatform || installPayload.sourceType || source) ||
    source
  const providerId =
    toSafeText(item.sourceModKey || installPayload.sourceModKey) ||
    [item.sourceModId || installPayload.modId, item.sourceFileId || installPayload.id]
      .filter(Boolean)
      .join('-') ||
    hashText(item.download_url || installPayload.downloadUrl)
  const versionOrHash =
    toSafeText(installPayload.fileMd5 || installPayload.file_md5) ||
    toSafeText(installPayload.sha256 || item.sha256) ||
    resolveItemVersion(entry) ||
    hashText(item.download_url || installPayload.downloadUrl)

  return [
    'artifact',
    source,
    gameKey,
    compactKeyPart(provider),
    compactKeyPart(providerId),
    compactKeyPart(versionOrHash)
  ].join(':')
}

export function buildDependencyKey(payload = {}, entry = {}) {
  const meta = resolveEntryMeta(entry)
  const dependencyRef =
    meta.dependencyRef && typeof meta.dependencyRef === 'object' ? meta.dependencyRef : {}
  const installPayload = resolveInstallPayload(entry)
  const metadata =
    installPayload.metadata && typeof installPayload.metadata === 'object'
      ? installPayload.metadata
      : {}
  const source = normalizeSource(payload.source || installPayload.sourceType)
  const gameKey = compactKeyPart(resolveGameKey({ ...payload, source }))
  const role =
    toSafeText(dependencyRef.dependencyRole || dependencyRef.dependency_role) ||
    toSafeText(metadata.category) ||
    resolveItemType(entry)
  const dependencyId =
    toSafeText(metadata.dependencyId) ||
    toSafeText(dependencyRef.sourceModKey || dependencyRef.source_mod_key) ||
    resolveSourceModKey(entry)
  const version = resolveItemVersion(entry) || 'latest'

  return [
    'dependency',
    source,
    gameKey,
    compactKeyPart(role),
    compactKeyPart(dependencyId),
    compactKeyPart(version)
  ].join(':')
}

export function buildInstallKey(payload = {}, entry = {}) {
  const installPayload = resolveInstallPayload(entry)
  const source = normalizeSource(payload.source || installPayload.sourceType)
  const gameRoot = toSafeText(
    payload.gameRoot ||
      payload.gameRootPath ||
      installPayload.gameRootPath ||
      installPayload.clientRootPath ||
      installPayload.client_root_path
  )
  const sourceModKey = resolveSourceModKey(entry) || hashText(resolveItemTitle(entry))
  const version = resolveItemVersion(entry) || 'unknown'
  const targetHash = hashText(
    [
      installPayload.clientInstallPath,
      installPayload.serverInstallPath,
      installPayload.targetPath,
      installPayload.profileName
    ]
      .filter(Boolean)
      .join('|') || gameRoot
  )

  return [
    'install',
    source,
    `gamehash-${hashText(gameRoot || payload.gameKey || '')}`,
    compactKeyPart(sourceModKey),
    compactKeyPart(version),
    `targethash-${targetHash}`
  ].join(':')
}

export function buildDownloadTaskPayload(entry = {}, artifact = {}) {
  const task = {
    ...resolveEntryDownloadTask(entry)
  }
  return {
    ...task,
    id: toSafeText(artifact.download_task_id) || createId('download'),
    fun: task.fun && typeof task.fun === 'object' ? task.fun : { type: 0 },
    showOpenInDownloadList: task.showOpenInDownloadList === true,
    downloadPurpose: task.downloadPurpose === 'download_only' ? 'download_only' : 'install_source'
  }
}

export function buildArtifactRecord(payload = {}, entry = {}) {
  const task = resolveEntryDownloadTask(entry)
  const installPayload = resolveInstallPayload(entry)
  const artifactKey = buildArtifactKey(payload, entry)
  const source = normalizeSource(payload.source || task.sourceType || task.sourcePlatform)
  const provider = toSafeText(
    task.sourceType || task.sourcePlatform || installPayload.sourceType || source
  )
  const providerId =
    toSafeText(task.sourceModKey || installPayload.sourceModKey) ||
    [task.sourceModId || installPayload.modId, task.sourceFileId || installPayload.id]
      .filter(Boolean)
      .join(':')

  return {
    artifact_key: artifactKey,
    source,
    game_key: resolveGameKey({ ...payload, source }),
    provider,
    provider_id: providerId,
    version: resolveItemVersion(entry),
    file_name: toSafeText(task.fileName || task.task_name || installPayload.name),
    file_path: toSafeText(task.filePath || task.finalFilePath),
    download_task_id: toSafeText(task.id),
    download_url: toSafeText(task.download_url || installPayload.downloadUrl),
    file_size: toSafeNumber(task.file_size || installPayload.fileSize, 0),
    md5: toSafeText(installPayload.fileMd5 || installPayload.file_md5 || task.md5),
    sha256: toSafeText(installPayload.sha256 || task.sha256),
    state: ARTIFACT_STATE.CREATED
  }
}
