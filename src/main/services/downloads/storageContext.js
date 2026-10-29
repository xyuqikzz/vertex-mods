import fs from 'fs'
import path from 'path'

const THUNDERSTORE_SOURCE = 'thunderstore'
const VERTEX_SOURCE = 'vertex'
export const SAME_DRIVE_CACHE_ROOT_NAME = 'ModManagerData'
export const SAME_DRIVE_DOWNLOAD_CACHE_SCOPE_NAMES = Object.freeze(['downloads', 'temp', 'staging'])
const MIN_SAME_DRIVE_FREE_BYTES = 200 * 1024 * 1024
const LEGACY_FOLDER_MAP = {
  0: 'Image',
  1: 'File',
  2: 'Mod',
  3: 'App'
}

const SUPPORTED_VERTEX_TASK_TYPES = new Set([
  '0',
  '1',
  'client',
  'server',
  'download',
  'mod-download',
  'mod_download',
  'install',
  'installmods',
  'install-mods',
  'install_mods',
  'mod-install',
  'mod_install',
  'install-task',
  'install_task'
])

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function pickFirstText(...valueList) {
  for (const value of valueList) {
    const text = toSafeText(value)
    if (text) {
      return text
    }
  }
  return ''
}

export function getSameDriveDownloadCacheScopeRoots(driveRoot = '') {
  const safeDriveRoot = toSafeText(driveRoot)
  if (!safeDriveRoot) {
    return []
  }

  return SAME_DRIVE_DOWNLOAD_CACHE_SCOPE_NAMES.map((scopeName) =>
    path.join(safeDriveRoot, SAME_DRIVE_CACHE_ROOT_NAME, scopeName)
  )
}

export function getSameDriveDownloadCacheRootMarkers() {
  const rootName = SAME_DRIVE_CACHE_ROOT_NAME.toLowerCase()
  return SAME_DRIVE_DOWNLOAD_CACHE_SCOPE_NAMES.map(
    (scopeName) => `${path.sep}${rootName}${path.sep}${scopeName.toLowerCase()}`
  )
}

function pickFirstNonZeroText(...valueList) {
  for (const value of valueList) {
    const text = toSafeText(value)
    if (!text) {
      continue
    }

    const number = Number(text)
    if (Number.isFinite(number) && number <= 0) {
      continue
    }

    return text
  }
  return ''
}

function normalizeSourcePlatform(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (!text || text === 'server') {
    return VERTEX_SOURCE
  }
  return text
}

function normalizeTaskType(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (!text) {
    return ''
  }
  return text.replace(/\s+/g, '-')
}

function normalizeGameIdSegment(value = '') {
  const text = Array.from(toSafeText(value))
    .map((char) => {
      const charCode = char.charCodeAt(0)
      return charCode < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char
    })
    .join('')
    .replace(/\.+$/g, '')
    .trim()

  if (!text) {
    throw new Error('缺少可用于缓存目录的游戏标识')
  }

  return text.slice(0, 120)
}

function getTaskData(task = {}) {
  return toSafeObject(toSafeObject(task).fun?.data)
}

function getTaskSourceMeta(task = {}, taskData = {}) {
  return toSafeObject(taskData.sourceMeta || task.sourceMeta)
}

function resolveSourcePlatform(task = {}, taskData = {}) {
  const sourceMeta = getTaskSourceMeta(task, taskData)
  const metadata = toSafeObject(taskData.metadata || task.metadata)
  const explicitSource = pickFirstText(
    task.sourcePlatform,
    task.sourceType,
    task.source,
    sourceMeta.source,
    taskData.sourcePlatform,
    taskData.sourceType,
    taskData.source,
    metadata.sourcePlatform,
    metadata.sourceType,
    metadata.source
  )

  if (explicitSource) {
    return normalizeSourcePlatform(explicitSource)
  }

  const taskName = pickFirstText(task.task_name, task.taskName)
  if (taskName.toLowerCase().includes(THUNDERSTORE_SOURCE)) {
    return THUNDERSTORE_SOURCE
  }

  return VERTEX_SOURCE
}

function resolveGameId(task = {}, taskData = {}) {
  return pickFirstNonZeroText(
    task.gameId,
    task.game_id,
    taskData.gameId,
    taskData.game_id,
    task.gameSteamAppId,
    taskData.gameSteamAppId,
    task.appid,
    taskData.appid,
    task.appId,
    taskData.appId,
    task.steamAppId,
    taskData.steamAppId,
    task.nexusGameId,
    taskData.nexusGameId
  )
}

function resolveGameInstallPath(task = {}, taskData = {}) {
  return pickFirstText(
    task.gameInstallPath,
    taskData.gameInstallPath,
    task.gameRootPath,
    taskData.gameRootPath,
    task.clientRootPath,
    taskData.clientRootPath,
    task.client_root_path,
    taskData.client_root_path,
    task.targetPath,
    taskData.targetPath,
    task.target_path,
    taskData.target_path,
    task.gameExePath,
    taskData.gameExePath,
    task.clientExePath,
    taskData.clientExePath,
    task.client_exe_path,
    taskData.client_exe_path
  )
}

function resolveTaskType(task = {}, taskData = {}) {
  return pickFirstText(
    task.taskType,
    taskData.taskType,
    task.task_type,
    taskData.task_type,
    task.installTaskType,
    taskData.installTaskType,
    task.taskKind,
    taskData.taskKind,
    task.fun?.method,
    taskData.method
  )
}

function resolvePreferSameDriveCache(options = {}) {
  if (typeof options.preferSameDriveCache === 'boolean') {
    return options.preferSameDriveCache
  }

  const settings = toSafeObject(options.settings)
  return settings.preferSameDriveCache !== false
}

function isWritableDirectory(dirPath = '') {
  const safeDirPath = path.resolve(String(dirPath || ''))
  const probePath = path.join(
    safeDirPath,
    `.vertex-storage-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )

  fs.writeFileSync(probePath, 'vertex-storage-probe')
  fs.unlinkSync(probePath)
  return true
}

function getAvailableBytes(targetPath = '') {
  if (typeof fs.statfsSync !== 'function') {
    throw new Error('当前运行环境不支持磁盘空间检测')
  }

  const stat = fs.statfsSync(targetPath)
  return Number(stat.bavail || 0) * Number(stat.bsize || stat.frsize || 0)
}

function assertEnoughSpace(targetPath = '', fileSize = 0) {
  const safeFileSize = Math.max(0, toSafeNumber(fileSize, 0))
  const requiredBytes =
    safeFileSize > 0 ? Math.max(MIN_SAME_DRIVE_FREE_BYTES, safeFileSize * 2) : MIN_SAME_DRIVE_FREE_BYTES
  const availableBytes = getAvailableBytes(targetPath)

  if (availableBytes < requiredBytes) {
    throw new Error(
      `同盘缓存空间不足，剩余 ${availableBytes} 字节，至少需要 ${requiredBytes} 字节`
    )
  }
}

function resolveGameDirectory(gameInstallPath = '') {
  const resolvedGamePath = path.resolve(gameInstallPath)
  const stat = fs.statSync(resolvedGamePath)
  return stat.isFile() ? path.dirname(resolvedGamePath) : resolvedGamePath
}

function assertCacheRootOutsideGame(cacheRoot = '', gameInstallPath = '') {
  const gameDirectory = resolveGameDirectory(gameInstallPath)
  const relativePath = path.relative(gameDirectory, cacheRoot)
  if (!relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    throw new Error('同盘缓存目录不能位于游戏目录内')
  }
}

function buildStorageContext(cacheRoot = '', gameId = '', useLegacyStrategy = false, reason = '') {
  const safeCacheRoot = path.resolve(cacheRoot)
  const safeGameId = normalizeGameIdSegment(gameId)
  const scopedPath = (name) => path.join(safeCacheRoot, name, safeGameId)

  return {
    cacheRoot: safeCacheRoot,
    downloadRoot: scopedPath('downloads'),
    tempRoot: scopedPath('temp'),
    stagingRoot: scopedPath('staging'),
    backupRoot: scopedPath('backup'),
    manifestRoot: scopedPath('manifest'),
    deploymentRoot: scopedPath('deployment'),
    useLegacyStrategy,
    reason
  }
}

function ensureStorageDirectories(storageContext = {}) {
  const directories = [
    storageContext.cacheRoot,
    storageContext.downloadRoot,
    storageContext.tempRoot,
    storageContext.stagingRoot,
    storageContext.backupRoot,
    storageContext.manifestRoot,
    storageContext.deploymentRoot
  ]

  for (const dirPath of directories) {
    fs.mkdirSync(dirPath, { recursive: true })
  }

  isWritableDirectory(storageContext.downloadRoot)
}

function buildLegacyStorageContext(cacheRoot = '', saveType = 0, reason = '使用旧下载路径策略') {
  const safeCacheRoot = path.resolve(cacheRoot)
  const folderName = LEGACY_FOLDER_MAP[Number(saveType)] || 'Other'

  return {
    cacheRoot: safeCacheRoot,
    downloadRoot: path.join(safeCacheRoot, folderName),
    tempRoot: path.join(safeCacheRoot, 'temp'),
    stagingRoot: path.join(safeCacheRoot, 'staging'),
    backupRoot: path.join(safeCacheRoot, 'backup'),
    manifestRoot: path.join(safeCacheRoot, 'manifest'),
    deploymentRoot: path.join(safeCacheRoot, 'deployment'),
    useLegacyStrategy: true,
    reason
  }
}

function logStorageContext(task = {}, input = {}, context = {}) {
  console.log('[下载存储上下文]', {
    taskId: toSafeText(task.id || task.taskId),
    sourcePlatform: input.sourcePlatform,
    taskType: input.taskType,
    gameId: input.gameId,
    gameInstallPath: input.gameInstallPath,
    useLegacyStrategy: !!context.useLegacyStrategy,
    resolvedCacheRoot: context.cacheRoot,
    resolvedDownloadRoot: context.downloadRoot,
    resolvedTempRoot: context.tempRoot,
    reason: context.reason
  })
}

export function adaptTaskToStorageResolutionInput(task = {}, options = {}) {
  const safeTask = toSafeObject(task)
  const taskData = getTaskData(safeTask)
  const settings = toSafeObject(options.settings)

  return {
    gameId: resolveGameId(safeTask, taskData),
    gameInstallPath: resolveGameInstallPath(safeTask, taskData),
    sourcePlatform: resolveSourcePlatform(safeTask, taskData),
    taskType: normalizeTaskType(resolveTaskType(safeTask, taskData)),
    globalDownloadPath: pickFirstText(options.globalDownloadPath, settings.downloadPath),
    preferSameDriveCache: resolvePreferSameDriveCache({
      ...options,
      settings
    }),
    saveType: Number(safeTask.saveType || 0),
    downloadPurpose: toSafeText(safeTask.downloadPurpose || taskData.downloadPurpose),
    fileSize: toSafeNumber(safeTask.file_size || safeTask.fileSize || taskData.fileSize, 0),
    legacyDownloadPathResolver: options.legacyDownloadPathResolver
  }
}

export function resolveLegacyDownloadPath(task = {}, input = {}) {
  const resolver =
    typeof input.legacyDownloadPathResolver === 'function' ? input.legacyDownloadPathResolver : null
  const fallbackRoot = input.globalDownloadPath || process.cwd()
  const cacheRoot = resolver ? resolver(task, input.globalDownloadPath) : fallbackRoot

  return buildLegacyStorageContext(
    cacheRoot,
    input.saveType,
    input.reason || '使用旧下载路径策略'
  )
}

export function resolveSameDriveStorageContext(input = {}) {
  const gameId = normalizeGameIdSegment(input.gameId)
  const gameInstallPath = toSafeText(input.gameInstallPath)

  if (!gameInstallPath) {
    throw new Error('缺少游戏安装路径')
  }

  if (!fs.existsSync(gameInstallPath)) {
    throw new Error(`游戏安装路径不存在: ${gameInstallPath}`)
  }

  const resolvedGamePath = path.resolve(gameInstallPath)
  const driveRoot = toSafeText(path.parse(resolvedGamePath).root)
  if (!driveRoot || !fs.existsSync(driveRoot)) {
    throw new Error('无法识别可用的游戏盘符')
  }

  const cacheRoot = path.join(driveRoot, SAME_DRIVE_CACHE_ROOT_NAME)
  assertCacheRootOutsideGame(cacheRoot, resolvedGamePath)

  const storageContext = buildStorageContext(
    cacheRoot,
    gameId,
    false,
    '已启用游戏同盘缓存策略'
  )
  ensureStorageDirectories(storageContext)
  assertEnoughSpace(storageContext.downloadRoot, input.fileSize)
  return storageContext
}

export function isVertexTask(task = {}, input = null) {
  const resolvedInput = input || adaptTaskToStorageResolutionInput(task)
  return normalizeSourcePlatform(resolvedInput.sourcePlatform) === VERTEX_SOURCE
}

export function isSupportedVertexTaskType(task = {}, input = null) {
  const resolvedInput = input || adaptTaskToStorageResolutionInput(task)
  if (!isVertexTask(task, resolvedInput)) {
    return true
  }

  const taskType = normalizeTaskType(resolvedInput.taskType)
  return !!taskType && SUPPORTED_VERTEX_TASK_TYPES.has(taskType)
}

export function resolveStorageContextForTask(task = {}, options = {}) {
  const input = adaptTaskToStorageResolutionInput(task, options)
  const legacy = (reason) => {
    const context = resolveLegacyDownloadPath(task, {
      ...input,
      reason
    })
    logStorageContext(task, input, context)
    return context
  }

  if (Number(input.saveType) !== 2) {
    return legacy('非模组下载任务，使用旧下载路径策略')
  }

  if (input.downloadPurpose === 'download_only') {
    return legacy('单纯下载任务，使用统一目录策略')
  }

  if (input.sourcePlatform === THUNDERSTORE_SOURCE) {
    return legacy('Thunderstore 来源排除，使用旧下载路径策略')
  }

  if (!input.preferSameDriveCache) {
    return legacy('全局同盘缓存策略未启用，使用旧下载路径策略')
  }

  if (isVertexTask(task, input) && !isSupportedVertexTaskType(task, input)) {
    return legacy('Vertex 任务类型无法识别，使用旧下载路径策略')
  }

  try {
    const context = resolveSameDriveStorageContext(input)
    logStorageContext(task, input, context)
    return context
  } catch (error) {
    console.warn('[下载存储上下文] 同盘缓存解析失败，已回退旧逻辑', {
      taskId: toSafeText(task?.id || task?.taskId),
      reason: String(error?.message || error || '未知错误')
    })
    return legacy(`同盘缓存解析失败，使用旧下载路径策略：${String(error?.message || '未知错误')}`)
  }
}
