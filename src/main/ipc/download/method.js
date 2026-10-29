import { assertUpdateUrl } from '../../security/updatePolicy.js'
import { deleteRecordedDownload } from './deleteRecord.js'
import { isWebUrl } from '../../security/windowPolicy.js'
import { getRetiredDownloadFailure } from '../../../shared/sources/retired-source-policy.js'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import { app } from 'electron'
import dbInstance from '../../db/dbInstance.js'
import store from '../../storage/store/index.js'
import { formatDate } from '../tool.js'
import { startProcess } from './handleDownloadComplete.js'
import { cleanLowVersion } from '../update/medhod.js'
import { getToken } from '../../utils/require.js'
import {
  clearAllDownloadRecordsDB,
  deleteDownloadRecordById,
  deleteDownloadRecordsByFilePath,
  getDownloadRecordFilePathBatchDB,
  iterateDownloadRecordFilePathsDB
} from '../../db/files/download.js'
import {
  deleteFileRecordById,
  getFileRecordBackupCleanupBatchDB,
  getFileRecordPathBatchDB,
  iterateFileRecordPathsDB
} from '../../db/files/files.js'
import { BrowserDownloadManager } from './browserDownloadManager.js'
import { Aria2DownloadManager } from './aria2DownloadManager.js'
import { getFlingTrainerDownloadHeaders } from '../../services/trainers/catalog.js'
import {
  DOWNLOAD_ENGINE_BROWSER,
  normalizeDownloadConcurrentCount,
  normalizeDownloadEngine
} from '../../../shared/downloads/download-config.js'
import { INSTALL_FLOW_CONFIG } from '../../../shared/installation/install-flow-config.js'
import { formatDownloadFailureMessage } from '../../../shared/installation/install-flow-message.js'
import {
  getSameDriveDownloadCacheRootMarkers,
  getSameDriveDownloadCacheScopeRoots,
  resolveStorageContextForTask
} from '../../services/downloads/storageContext.js'
import {
  buildDownloadOnlyFinalPath,
  isDownloadOnlyTask
} from './downloadOnlyResolver.js'
import { resolveDownloadFileName } from './fileNameResolver.js'
import { purgeAllStaleDeployBackups } from '../game/deployReconciler.js'
import { isThunderstoreStorageMigrationActive } from '../../services/profiles/thunderstoreStorage.js'
import { buildDownloadHistoryUrlProjection } from '../game/source-install-task/contracts.js'
import { sanitizeSourceInstallTaskDiagnostic } from '../game/source-install-task/taskSecurity.js'

const PROGRESS_UPDATE_INTERVAL = INSTALL_FLOW_CONFIG.download.progressIntervalMs
const CLEANUP_BATCH_SIZE = 200
const CLEANUP_YIELD_INTERVAL = 200
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0'
const TEMP_DOWNLOAD_FILE_SUFFIXES = ['.tmp', '.crdownload', '.downloading']
const DUPLICATE_FILE_NAME_SUFFIX_PATTERN = /\s\(\d+\)$/i

const FOLDER_MAP = {
  0: 'Image',
  1: 'File',
  2: 'Mod',
  3: 'App'
}

const DOWNLOAD_STATUS = {
  SUCCESS: 'success',
  CANCELED: 'canceled',
  FAILED: 'failed'
}

let downloadManagerInitialized = false

function yieldCleanupLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function resolveDownloadConcurrentCount(settings = null) {
  const source =
    settings && typeof settings === 'object'
      ? settings
      : { downloadConcurrentCount: store.getStore('systemConfig.settings.downloadConcurrentCount') }
  return normalizeDownloadConcurrentCount(source?.downloadConcurrentCount)
}

function safeUnlink(filePath) {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath || !fs.existsSync(safeFilePath)) {
    return false
  }

  try {
    fs.unlinkSync(safeFilePath)
    return true
  } catch (error) {
    console.error(`[文件清理错误] 无法删除文件: ${safeFilePath}`, error)
    return false
  }
}

function removeBrowserDownloadArtifacts(filePath) {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return
  }

  safeUnlink(safeFilePath)
  safeUnlink(`${safeFilePath}.crdownload`)
  safeUnlink(`${safeFilePath}.aria2`)
  safeUnlink(`${safeFilePath}.tmp`)
  safeUnlink(`${safeFilePath}.downloading`)
}

function ensureDirectoryExists(dirPath) {
  const safeDirPath = String(dirPath || '').trim()
  if (!safeDirPath) {
    return
  }

  if (!fs.existsSync(safeDirPath)) {
    fs.mkdirSync(safeDirPath, { recursive: true })
  }
}

function resolveDefaultDownloadRootPath(basePath = '') {
  const safeBasePath = String(basePath || '').trim()

  try {
    const resolvedBasePath = safeBasePath
      ? path.resolve(safeBasePath)
      : path.resolve(app.getPath('documents'))
    const driveRoot = String(path.parse(resolvedBasePath).root || '').trim()
    if (driveRoot) {
      return path.join(driveRoot, 'Vertex', 'dow')
    }
  } catch (error) {
    console.log('[下载路径解析] 默认根目录解析失败，回退到文档目录', error)
  }

  return path.join(app.getPath('documents'), 'Vertex', 'dow')
}

function resolveTaskGamePathCandidate(task = {}) {
  const taskData = task?.fun?.data && typeof task.fun.data === 'object' ? task.fun.data : {}
  const candidateList = [
    task.downloadBasePath,
    taskData.downloadBasePath,
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
  ]

  return candidateList.find((item) => String(item || '').trim()) || ''
}

function resolveTaskDownloadBasePath(task = {}, configuredDownloadPath = '') {
  const safeConfiguredDownloadPath = String(configuredDownloadPath || '').trim()
  if (Number(task?.saveType) !== 2) {
    return safeConfiguredDownloadPath
      ? path.resolve(safeConfiguredDownloadPath)
      : resolveDefaultDownloadRootPath()
  }

  const taskPathCandidate = resolveTaskGamePathCandidate(task)
  if (taskPathCandidate) {
    return resolveDefaultDownloadRootPath(taskPathCandidate)
  }

  return safeConfiguredDownloadPath
    ? path.resolve(safeConfiguredDownloadPath)
    : resolveDefaultDownloadRootPath()
}

function buildTaskDownloadUrl(task) {
  const rawUrl = String(task.download_url || '').trim()
  if (!rawUrl || task.fun?.type !== 3) {
    return rawUrl
  }

  try {
    const urlObj = new URL(rawUrl)
    urlObj.searchParams.set('key', getToken())
    return urlObj.toString()
  } catch (error) {
    console.log('[下载地址处理] token 追加失败，使用兜底拼接', error)
    const separator = rawUrl.includes('?') ? '&' : '?'
    return `${rawUrl}${separator}key=${getToken()}`
  }
}

function attachStorageContextToTask(task = {}, storageContext = {}) {
  const nextTask = {
    ...task,
    storageContext
  }
  const fun = task.fun && typeof task.fun === 'object' && !Array.isArray(task.fun) ? task.fun : null
  const data = fun?.data && typeof fun.data === 'object' && !Array.isArray(fun.data) ? fun.data : null

  if (!fun || !data) {
    return nextTask
  }

  return {
    ...nextTask,
    fun: {
      ...fun,
      data: {
        ...data,
        storageContext
      }
    }
  }
}

function resolveUniqueFilePath(filePath) {
  const targetPath = String(filePath || '').trim()
  if (!targetPath || !fs.existsSync(targetPath)) {
    return targetPath
  }

  const dirName = path.dirname(targetPath)
  const extName = path.extname(targetPath)
  const baseName = path.basename(targetPath, extName)

  for (let index = 1; index < 10000; index += 1) {
    const nextPath = path.join(dirName, `${baseName} (${index})${extName}`)
    if (!fs.existsSync(nextPath)) {
      return nextPath
    }
  }

  return path.join(dirName, `${baseName}_${Date.now()}${extName}`)
}

function notifyModDownloadFailed(task) {
  if (task.saveType !== 2) {
    return
  }

  const data = task.fun?.data
  if (!data || !task.eventRef) {
    return
  }

  task.eventRef.reply('download-mod-failed', {
    id: data.id,
    taskType: data.taskType || 0
  })
}

async function walkDirectoryFiles(dirPath, onFile) {
  const pendingDirs = [dirPath]
  let visitedEntryCount = 0

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()
    if (!currentDir) {
      continue
    }

    let dirHandle
    try {
      dirHandle = await fs.promises.opendir(currentDir)
    } catch (error) {
      console.warn(`[下载清理] 读取目录失败: ${currentDir}`, error)
      continue
    }

    for await (const entry of dirHandle) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        pendingDirs.push(fullPath)
      } else if (entry.isFile()) {
        await onFile(fullPath)
      }

      visitedEntryCount += 1
      if (visitedEntryCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
    }
  }
}

function normalizeFsPathKey(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return ''
  }

  try {
    return path.resolve(safeFilePath).toLowerCase()
  } catch {
    return safeFilePath.toLowerCase()
  }
}

function extractManagedDownloadRoot(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return ''
  }

  try {
    const normalizedPath = path.resolve(safeFilePath)
    const lowerPath = normalizedPath.toLowerCase()
    const markerList = [
      `${path.sep}vertex${path.sep}dow`,
      ...getSameDriveDownloadCacheRootMarkers()
    ]

    for (const marker of markerList) {
      const markerIndex = lowerPath.indexOf(marker)
      if (markerIndex !== -1) {
        return normalizedPath.slice(0, markerIndex + marker.length)
      }
    }

    return ''
  } catch {
    return ''
  }
}

function collectWindowsManagedRoots() {
  const roots = []
  for (let code = 67; code <= 90; code += 1) {
    const drive = String.fromCharCode(code)
    const candidateList = [
      `${drive}:\\Vertex\\dow`,
      ...getSameDriveDownloadCacheScopeRoots(`${drive}:\\`)
    ]

    for (const candidate of candidateList) {
      if (fs.existsSync(candidate)) {
        roots.push(candidate)
      }
    }
  }

  return roots
}

function collectManagedDownloadRoots(configuredDownloadPath = '') {
  const rootMap = new Map()
  const pushRoot = (rootPath = '') => {
    const safeRootPath = String(rootPath || '').trim()
    if (!safeRootPath) {
      return
    }

    try {
      const resolvedRoot = path.resolve(safeRootPath)
      const key = normalizeFsPathKey(resolvedRoot)
      if (key && !rootMap.has(key) && fs.existsSync(resolvedRoot)) {
        rootMap.set(key, resolvedRoot)
      }
    } catch {
      // ignore
    }
  }

  pushRoot(resolveTaskDownloadBasePath({ saveType: 2 }, configuredDownloadPath))

  for (const item of iterateFileRecordPathsDB()) {
    pushRoot(extractManagedDownloadRoot(item?.file_path))
  }

  for (const item of iterateDownloadRecordFilePathsDB()) {
    pushRoot(extractManagedDownloadRoot(item?.file_path))
  }

  collectWindowsManagedRoots().forEach(pushRoot)

  return Array.from(rootMap.values())
}

function isTemporaryDownloadArtifact(filePath = '') {
  const safeFilePath = String(filePath || '')
    .trim()
    .toLowerCase()
  if (!safeFilePath) {
    return false
  }

  return TEMP_DOWNLOAD_FILE_SUFFIXES.some((suffix) => safeFilePath.endsWith(suffix))
}

function parseSortTimestamp(value = '') {
  const safeValue = String(value || '').trim()
  if (!safeValue) {
    return 0
  }

  const timestamp = Date.parse(safeValue)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function hasDuplicateNameSuffix(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return false
  }

  const extName = path.extname(safeFilePath)
  const baseName = path.basename(safeFilePath, extName)
  return DUPLICATE_FILE_NAME_SUFFIX_PATTERN.test(baseName)
}

function normalizeBackupBaseName(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return ''
  }

  const extName = path.extname(safeFilePath)
  const baseName = path
    .basename(safeFilePath, extName)
    .replace(DUPLICATE_FILE_NAME_SUFFIX_PATTERN, '')
  return `${baseName}${extName}`.toLowerCase()
}

function getExistingFileSize(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath || !fs.existsSync(safeFilePath)) {
    return 0
  }

  try {
    return Number(fs.statSync(safeFilePath).size || 0)
  } catch {
    return 0
  }
}

function buildBackupDeduplicateKey(record = {}) {
  const module = String(record?.module ?? '').trim()
  const externalId = String(record?.external_id ?? '').trim()
  const version = String(record?.version ?? '').trim()
  const filePath = String(record?.file_path ?? '').trim()
  const md5 = String(record?.md5 ?? '')
    .trim()
    .toLowerCase()

  if (!module || !externalId || !version || !filePath) {
    return ''
  }

  const fingerprint =
    md5 ||
    `${normalizeBackupBaseName(filePath)}::${String(record?.type || '')
      .trim()
      .toLowerCase()}::${getExistingFileSize(filePath)}`

  return [module, externalId, version, fingerprint].join('::')
}

function compareBackupPriority(left = {}, right = {}) {
  const leftDuplicate = hasDuplicateNameSuffix(left?.file_path)
  const rightDuplicate = hasDuplicateNameSuffix(right?.file_path)
  if (leftDuplicate !== rightDuplicate) {
    return leftDuplicate ? 1 : -1
  }

  return parseSortTimestamp(right?.create_time) - parseSortTimestamp(left?.create_time)
}

async function cleanupTemporaryDownloadArtifacts(rootList = []) {
  let deletedCount = 0

  for (const rootPath of rootList) {
    await walkDirectoryFiles(rootPath, async (filePath) => {
      if (!isTemporaryDownloadArtifact(filePath)) {
        return
      }

      if (safeUnlink(filePath)) {
        deletedCount += 1
      }
    })

    await yieldCleanupLoop()
  }

  return deletedCount
}

async function cleanupMissingArchiveRecords() {
  let deletedFileRecordCount = 0
  let deletedDownloadRecordCount = 0
  let processedCount = 0

  await processCleanupBatch(getFileRecordPathBatchDB, async (item) => {
    const filePath = String(item?.file_path || '').trim()
    if (!filePath || fs.existsSync(filePath)) {
      processedCount += 1
      if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
      return
    }

    const result = deleteFileRecordById(item.id)
    deletedFileRecordCount += Number(result?.changes || 0)
    processedCount += 1
    if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
      await yieldCleanupLoop()
    }
  })

  await processCleanupBatch(getDownloadRecordFilePathBatchDB, async (item) => {
    const filePath = String(item?.file_path || '').trim()
    if (!filePath || fs.existsSync(filePath)) {
      processedCount += 1
      if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
      return
    }

    const result = deleteDownloadRecordById(item.id)
    deletedDownloadRecordCount += Number(result?.changes || 0)
    processedCount += 1
    if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
      await yieldCleanupLoop()
    }
  })

  return {
    deletedFileRecordCount,
    deletedDownloadRecordCount
  }
}

async function processCleanupBatch(loadBatch, onItem) {
  let lastId = 0

  while (true) {
    const batchList = loadBatch(lastId, CLEANUP_BATCH_SIZE)
    if (!Array.isArray(batchList) || batchList.length === 0) {
      return
    }

    for (const item of batchList) {
      await onItem(item)
      const itemId = Number(item?.id || 0)
      if (Number.isFinite(itemId) && itemId > lastId) {
        lastId = itemId
      }
    }

    await yieldCleanupLoop()
  }
}

async function cleanupDuplicateBackupFiles() {
  const keepItemMap = new Map()
  let deletedFileCount = 0
  let deletedFileRecordCount = 0
  let deletedDownloadRecordCount = 0
  let processedCount = 0

  await processCleanupBatch(getFileRecordBackupCleanupBatchDB, async (item) => {
    const filePath = String(item?.file_path || '').trim()
    if (!filePath || !fs.existsSync(filePath)) {
      processedCount += 1
      if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
      return
    }

    const groupKey = buildBackupDeduplicateKey(item)
    if (!groupKey) {
      processedCount += 1
      if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
      return
    }

    const keepItem = keepItemMap.get(groupKey)
    if (!keepItem) {
      keepItemMap.set(groupKey, item)
      processedCount += 1
      if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
        await yieldCleanupLoop()
      }
      return
    }

    const shouldReplaceKeepItem = compareBackupPriority(item, keepItem) < 0
    const nextKeepItem = shouldReplaceKeepItem ? item : keepItem
    const duplicateItem = shouldReplaceKeepItem ? keepItem : item
    if (shouldReplaceKeepItem) {
      keepItemMap.set(groupKey, item)
    }

    const duplicateFilePath = String(duplicateItem?.file_path || '').trim()
    const duplicatePathKey = normalizeFsPathKey(duplicateFilePath)
    const keepPathKey = normalizeFsPathKey(nextKeepItem?.file_path)

    if (duplicateFilePath && duplicatePathKey && duplicatePathKey !== keepPathKey) {
      if (safeUnlink(duplicateFilePath)) {
        deletedFileCount += 1
      }

      const result = deleteDownloadRecordsByFilePath(duplicateFilePath)
      deletedDownloadRecordCount += Number(result?.changes || 0)
    }

    const deleteResult = deleteFileRecordById(duplicateItem.id)
    deletedFileRecordCount += Number(deleteResult?.changes || 0)

    processedCount += 1
    if (processedCount % CLEANUP_YIELD_INTERVAL === 0) {
      await yieldCleanupLoop()
    }
  })

  return {
    deletedFileCount,
    deletedFileRecordCount,
    deletedDownloadRecordCount
  }
}

function prepareDownloadTask(task = {}) {
  const saveType = Number(task.saveType || 0)
  const downloadUrl = buildTaskDownloadUrl(task)
  const settings = store.getStore('systemConfig.settings') || {}
  const configuredDownloadPath = settings?.downloadPath || ''
  const storageContext = resolveStorageContextForTask(task, {
    settings,
    globalDownloadPath: configuredDownloadPath,
    preferSameDriveCache: settings?.preferSameDriveCache !== false,
    legacyDownloadPathResolver: resolveTaskDownloadBasePath
  })
  const downloadBasePath = storageContext.cacheRoot
  const existingFinalFilePath = String(task.finalFilePath || '').trim()
  const existingFileExt = String(task.fileExt || '').trim()
  const fileNameResolution = resolveDownloadFileName({ ...task, download_url: downloadUrl })
  const { fileName, fileExt } = fileNameResolution
  const legacySavePath = path.join(downloadBasePath, FOLDER_MAP[saveType] || 'Other')
  const isDownloadOnly = isDownloadOnlyTask(task)
  let savePath = storageContext.useLegacyStrategy ? legacySavePath : storageContext.downloadRoot
  let fallbackFileName = fileName
  let finalFilePath = existingFinalFilePath || path.join(savePath, fileName)
  let resolvedFileExt = existingFileExt || fileExt

  if (isDownloadOnly) {
    const downloadOnlyPath = buildDownloadOnlyFinalPath(task, configuredDownloadPath)
    const uniqueDownloadOnlyPath = resolveUniqueFilePath(downloadOnlyPath)
    savePath = path.dirname(uniqueDownloadOnlyPath)
    fallbackFileName = path.basename(uniqueDownloadOnlyPath)
    finalFilePath = existingFinalFilePath || uniqueDownloadOnlyPath
    resolvedFileExt = existingFileExt || path.extname(uniqueDownloadOnlyPath)
  }

  const taskWithStorageContext = attachStorageContextToTask(task, storageContext)

  ensureDirectoryExists(savePath)

  return {
    ...taskWithStorageContext,
    download_url: downloadUrl,
    downloadBasePath,
    saveDirectory: savePath,
    fallbackFileName,
    finalFilePath,
    fixedFinalFilePath:
      isDownloadOnly || existingFinalFilePath || fileNameResolution.isAuthoritative
        ? finalFilePath
        : '',
    allowRemoteFileName:
      !isDownloadOnly && !existingFinalFilePath && !fileNameResolution.isAuthoritative,
    fileExt: resolvedFileExt,
    saveType
  }
}

function resolveBrowserSavePath(task = {}, item) {
  const fixedFinalFilePath = String(task.fixedFinalFilePath || '').trim()
  if (fixedFinalFilePath) {
    const uniqueFixedPath = resolveUniqueFilePath(fixedFinalFilePath)
    task.finalFilePath = uniqueFixedPath
    task.saveDirectory = path.dirname(uniqueFixedPath)
    task.fileExt = task.fileExt || path.extname(uniqueFixedPath)
    return uniqueFixedPath
  }

  const preferredFileName = String(item?.getFilename?.() || '').trim() || task.fallbackFileName
  const desiredPath = path.join(String(task.saveDirectory || '').trim(), preferredFileName)
  const uniquePath = resolveUniqueFilePath(desiredPath)
  task.finalFilePath = uniquePath
  task.saveDirectory = path.dirname(uniquePath)
  task.fileExt = path.extname(uniquePath) || task.fileExt
  return uniquePath
}

function appendDownloadHeader(headers, key = '', value = '') {
  const safeKey = String(key || '').trim()
  const safeValue = String(value || '').trim()
  if (!safeKey || !safeValue) {
    return
  }
  headers[safeKey] = safeValue
}

function appendDownloadHeaderSource(headers, source) {
  if (!source) {
    return
  }
  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (typeof item === 'string') {
        const index = item.indexOf(':')
        if (index > 0) {
          appendDownloadHeader(headers, item.slice(0, index), item.slice(index + 1))
        }
        return
      }
      if (item && typeof item === 'object') {
        appendDownloadHeader(headers, item.key || item.name, item.value)
      }
    })
    return
  }
  if (source && typeof source === 'object') {
    Object.entries(source).forEach(([key, value]) => {
      appendDownloadHeader(headers, key, value)
    })
  }
}

function buildVamHubDownloadCookieHeader() {
  const savedCookie = String(store.get('systemConfig.settings.vamhubAuthCookie') || '')
    .replace(/[\r\n]+/g, '; ')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.toLowerCase().startsWith('vamhubconsent='))
  return ['vamhubconsent=yes', ...savedCookie].join('; ')
}

function resolveDownloadTaskSourcePlatform(task = {}) {
  const taskData = task?.fun?.data && typeof task.fun.data === 'object' ? task.fun.data : {}
  return String(
    task.sourcePlatform ||
      task.sourceType ||
      taskData.sourcePlatform ||
      taskData.sourceType ||
      taskData.source ||
      ''
  )
    .trim()
    .toLowerCase()
}

function isVamHubDownloadTask(task = {}) {
  return resolveDownloadTaskSourcePlatform(task) === 'vamhub'
}

function isThunderstoreDownloadTask(task = {}) {
  return resolveDownloadTaskSourcePlatform(task) === 'thunderstore'
}

function buildPublicDownloadUrl(task = {}, rawUrl = '') {
  return buildDownloadHistoryUrlProjection({
    ...task,
    sourcePlatform: resolveDownloadTaskSourcePlatform(task),
    download_url: String(rawUrl || '').trim()
  })
}

function buildPublicDownloadUrlChain(task = {}, urlChain = []) {
  if (!Array.isArray(urlChain)) return []
  return urlChain
    .map((url) => (typeof url === 'string' ? buildPublicDownloadUrl(task, url) : ''))
    .filter(Boolean)
}

function buildDownloadHeaders(task = {}) {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: '*/*',
    ...getFlingTrainerDownloadHeaders(task.download_url)
  }
  if (isVamHubDownloadTask(task)) {
    headers.Accept = 'application/octet-stream,application/zip,*/*'
    headers.Referer = 'https://hub.virtamate.com/'
    headers.Cookie = buildVamHubDownloadCookieHeader()
  }
  appendDownloadHeaderSource(headers, task.downloadHeaders)
  appendDownloadHeaderSource(headers, task.requestHeaders)
  appendDownloadHeaderSource(headers, task.headers)
  return headers
}

function emitDownloadProgress(task, payload = {}) {
  if (!task?.eventRef) {
    return
  }

  const progressPayload = {
    id: task.id,
    totalBytes: Number(payload.totalBytes || 0),
    speed: Number(payload.speed || 0),
    progress: Number(payload.progress || 0),
    fileType: String(payload.fileType || 'unknown'),
    fileName:
      String(payload.fileName || '').trim() ||
      path.basename(String(task.finalFilePath || '').trim()),
    supportsRange: !!payload.supportsRange,
    isPaused: !!payload.isPaused,
    attemptIndex: Number(payload.attemptIndex || 1),
    attemptCount: Number(payload.attemptCount || 1),
    currentUrl: buildPublicDownloadUrl(task, payload.currentUrl || task.download_url),
    networkImpact: payload.networkImpact || task.networkImpact || null
  }

  task.eventRef.reply('download-progress', progressPayload)
  task.eventRef.reply('download-progress-1', progressPayload)
}

function saveDownloadRecord(task, payload = {}) {
  try {
    const totalBytes = Number(payload.totalBytes || 0)
    const now = formatDate(new Date())
    const shouldShowOpen = task.saveType < 2 || !!task.showOpenInDownloadList
    const taskData = task?.fun?.data && typeof task.fun.data === 'object' ? task.fun.data : {}
    const sourcePlatform = String(
      task.sourcePlatform ||
        task.sourceType ||
        taskData.sourcePlatform ||
        taskData.sourceType ||
        taskData.source ||
        ''
    )
      .trim()
      .toLowerCase()

    dbInstance.run(
      `INSERT INTO download_records
       (task_id, task_name, module, source_platform, file_type, file_size, file_path, download_url, created_at, is_show_open)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.task_name,
        task.module,
        sourcePlatform,
        task.fileExt?.split('.').pop(),
        totalBytes,
        task.finalFilePath,
        buildDownloadHistoryUrlProjection({ ...task, sourcePlatform }),
        now,
        shouldShowOpen ? 1 : 0
      ]
    )
  } catch (error) {
    console.error('[数据库错误] 保存下载记录失败:', error)
  }
}

export function markDownloadRecordOpenable(_event, payload = {}) {
  try {
    const safePayload = payload && typeof payload === 'object' ? payload : {}
    const taskId = String(safePayload.taskId || '').trim()
    const filePath = String(safePayload.filePath || '').trim()

    if (!taskId && !filePath) {
      return {
        success: false,
        message: '缺少可更新的下载记录标识'
      }
    }

    let result = { changes: 0 }

    if (taskId) {
      const params = []
      let sql = 'UPDATE download_records SET is_show_open = 1'
      if (filePath) {
        sql += ', file_path = ?'
        params.push(filePath)
      }
      sql += ' WHERE task_id = ?'
      params.push(taskId)
      result = dbInstance.run(sql, params)
    }

    if ((!result?.changes || result.changes <= 0) && filePath) {
      result = dbInstance.run('UPDATE download_records SET is_show_open = 1 WHERE file_path = ?', [
        filePath
      ])
    }

    return {
      success: Number(result?.changes || 0) > 0,
      updatedCount: Number(result?.changes || 0)
    }
  } catch (error) {
    console.error('[数据库错误] 更新下载记录打开状态失败:', error)
    return {
      success: false,
      message: String(error?.message || '更新下载记录失败')
    }
  }
}

function getDefaultMessage(status) {
  const messages = {
    [DOWNLOAD_STATUS.SUCCESS]: '下载成功',
    [DOWNLOAD_STATUS.CANCELED]: '任务已取消',
    [DOWNLOAD_STATUS.FAILED]: '下载失败'
  }
  return messages[status] || '任务状态未知'
}

function buildDownloadStatusExtraPayload(task, payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  return {
    totalBytes: Number(safePayload.totalBytes || 0),
    receivedBytes: Number(safePayload.receivedBytes || 0),
    speed: Number(safePayload.speed || 0),
    progress: Number(safePayload.progress || 0),
    fileType: String(safePayload.fileType || task?.file_type || 'unknown'),
    fileName:
      String(safePayload.fileName || '').trim() ||
      path.basename(String(task?.finalFilePath || '').trim()),
    supportsRange: !!safePayload.supportsRange,
    isPaused: !!safePayload.isPaused,
    interruptedRetryCount: Number(safePayload.interruptedRetryCount || 0),
    attemptIndex: Number(safePayload.attemptIndex || 1),
    attemptCount: Number(safePayload.attemptCount || 1),
    currentUrl: buildPublicDownloadUrl(task, safePayload.currentUrl || task?.download_url),
    urlChain: buildPublicDownloadUrlChain(task, safePayload.urlChain),
    networkImpact: safePayload.networkImpact || task?.networkImpact || null
  }
}

function notifyDownloadStatus(task, status, message = '', payload = {}) {
  if (!task?.eventRef) {
    return
  }

  const eventMap = {
    [DOWNLOAD_STATUS.SUCCESS]: 'download-success',
    [DOWNLOAD_STATUS.CANCELED]: 'download-canceled',
    [DOWNLOAD_STATUS.FAILED]: 'download-failed'
  }
  const rawMessage = sanitizeSourceInstallTaskDiagnostic(String(message || getDefaultMessage(status)).trim())
  payload = sanitizeSourceInstallTaskDiagnostic(payload)
  const userMessage =
    status === DOWNLOAD_STATUS.FAILED
      ? formatDownloadFailureMessage(rawMessage, payload)
      : rawMessage || getDefaultMessage(status)

  if (status === DOWNLOAD_STATUS.FAILED) {
    console.warn('[下载失败详情]', {
      taskId: task.id,
      taskName: task.task_name,
      rawMessage,
      payload
    })
  }

  task.eventRef.reply(eventMap[status] || 'download-failed', {
    id: task.id,
    message: userMessage,
    rawMessage,
    ...buildDownloadStatusExtraPayload(task, payload),
    ...(status === DOWNLOAD_STATUS.SUCCESS && { filePath: task.finalFilePath })
  })
}

function buildDownloadManagerOptions(logPrefix = '下载') {
  return {
    maxConcurrentDownloads: resolveDownloadConcurrentCount(),
    progressInterval: PROGRESS_UPDATE_INTERVAL,
    launchTimeoutMs: INSTALL_FLOW_CONFIG.download.launchTimeoutMs,
    stallTimeoutMs: INSTALL_FLOW_CONFIG.download.stallTimeoutMs,
    prepareTask: prepareDownloadTask,
    resolveSavePath: resolveBrowserSavePath,
    getRequestHeaders: buildDownloadHeaders,
    onProgress(task, payload) {
      emitDownloadProgress(task, payload)
    },
    onSuccess(task, payload) {
      const payloadFilePath = String(payload?.filePath || '').trim()
      if (payloadFilePath) {
        const currentFilePath = String(task.finalFilePath || '').trim()
        task.finalFilePath =
          currentFilePath && path.resolve(currentFilePath) === path.resolve(payloadFilePath)
            ? currentFilePath
            : payloadFilePath
      }
      task.fileExt = path.extname(String(task.finalFilePath || '').trim()) || task.fileExt
      saveDownloadRecord(task, payload)
      notifyDownloadStatus(task, DOWNLOAD_STATUS.SUCCESS, '下载成功', payload)


      startProcess(task)
    },
    onFailed(task, message, payload) {
      notifyModDownloadFailed(task)
      removeBrowserDownloadArtifacts(task.finalFilePath)
      notifyDownloadStatus(task, DOWNLOAD_STATUS.FAILED, message || '下载失败', payload)
    },
    onCanceled(task, message, payload) {
      notifyModDownloadFailed(task)
      removeBrowserDownloadArtifacts(task.finalFilePath)
      notifyDownloadStatus(task, DOWNLOAD_STATUS.CANCELED, message || '任务已取消', payload)
    },
    onLog(level, message) {
      message = sanitizeSourceInstallTaskDiagnostic(message)
      if (level === 'warn') {
        console.warn(`[${logPrefix}] ${message}`)
        return
      }
      console.log(`[${logPrefix}] ${message}`)
    }
  }
}

const browserDownloadManager = new BrowserDownloadManager(buildDownloadManagerOptions('浏览器下载'))
let activeDownloadManager = null
let configuredDownloadEngine = ''

function activateBrowserDownloadManager(reason = '', pendingTasks = []) {
  activeDownloadManager = browserDownloadManager
  browserDownloadManager.init()
  browserDownloadManager.setMaxConcurrentDownloads(resolveDownloadConcurrentCount())

  const safeReason = String(reason || '').trim()
  if (safeReason) {
    console.warn(`[下载引擎] ${safeReason}`)
  }

  pendingTasks.forEach((task) => {
    browserDownloadManager.addTask(task)
  })
}

function createAria2DownloadManager(requestedEngine = normalizeDownloadEngine()) {
  return new Aria2DownloadManager({
    ...buildDownloadManagerOptions('aria2 下载'),
    onEngineFailed(error, pendingTasks = []) {
      configuredDownloadEngine = requestedEngine
      activateBrowserDownloadManager(
        `aria2 下载引擎不可用，已回退浏览器下载：${error?.message || error}`,
        pendingTasks
      )
    }
  })
}

function resolveConfiguredDownloadEngine(settings = null) {
  const source =
    settings && typeof settings === 'object'
      ? settings
      : store.getStore('systemConfig.settings') || {}
  return normalizeDownloadEngine(source?.downloadEngine)
}

function getActiveDownloadManagerTaskCount() {
  if (!activeDownloadManager) {
    return 0
  }

  const occupiedCount =
    typeof activeDownloadManager.getOccupiedSlotCount === 'function'
      ? activeDownloadManager.getOccupiedSlotCount()
      : 0
  const queuedCount = Array.isArray(activeDownloadManager.downloadQueue)
    ? activeDownloadManager.downloadQueue.length
    : 0

  return Number(occupiedCount || 0) + Number(queuedCount || 0)
}

export function hasActiveThunderstoreDownloadTasks() {
  if (!activeDownloadManager) return false
  const queuedTasks = Array.isArray(activeDownloadManager.downloadQueue)
    ? activeDownloadManager.downloadQueue
    : []
  const activeTasks =
    activeDownloadManager.activeDownloads instanceof Map
      ? Array.from(activeDownloadManager.activeDownloads.values()).map((item) => item?.task)
      : []
  if ([...queuedTasks, ...activeTasks].some((task) => isThunderstoreDownloadTask(task))) {
    return true
  }
  // preparingTaskIds 阶段暂时取不到完整任务；路径切换是全局操作，保守阻断该短暂窗口。
  return Number(activeDownloadManager.preparingTaskIds?.size || 0) > 0
}

function destroyActiveDownloadManager() {
  if (!activeDownloadManager || typeof activeDownloadManager.destroy !== 'function') {
    activeDownloadManager = null
    return
  }

  activeDownloadManager.destroy()
  activeDownloadManager = null
}

function activateDownloadManagerByEngine(downloadEngine = normalizeDownloadEngine()) {
  const safeDownloadEngine = normalizeDownloadEngine(downloadEngine)
  configuredDownloadEngine = safeDownloadEngine

  if (safeDownloadEngine === DOWNLOAD_ENGINE_BROWSER) {
    activateBrowserDownloadManager()
    return activeDownloadManager
  }

  try {
    activeDownloadManager = createAria2DownloadManager(safeDownloadEngine)
    activeDownloadManager.init()
  } catch (error) {
    activateBrowserDownloadManager(
      `aria2 下载引擎初始化失败，已回退浏览器下载：${error?.message || error}`
    )
  }

  return activeDownloadManager
}

function syncDownloadManagerEngine(settings = null) {
  const requestedEngine = resolveConfiguredDownloadEngine(settings)

  if (activeDownloadManager) {
    if (requestedEngine === configuredDownloadEngine) {
      return activeDownloadManager
    }

    const activeTaskCount = getActiveDownloadManagerTaskCount()
    if (activeTaskCount > 0) {
      console.warn(
        `[下载引擎] 当前有 ${activeTaskCount} 个下载任务，下载引擎将在任务结束后对新任务生效`
      )
      return activeDownloadManager
    }

    destroyActiveDownloadManager()
    return activateDownloadManagerByEngine(requestedEngine)
  }

  return activateDownloadManagerByEngine(requestedEngine)
}

function resolveDownloadManager() {
  if (activeDownloadManager) {
    const requestedEngine = resolveConfiguredDownloadEngine()
    if (
      requestedEngine !== configuredDownloadEngine &&
      getActiveDownloadManagerTaskCount() === 0
    ) {
      return syncDownloadManagerEngine()
    }
    return activeDownloadManager
  }

  return syncDownloadManagerEngine()
}

export function syncDownloadManagerConcurrency(settings = null) {
  if (settings && typeof settings === 'object') {
    syncDownloadManagerEngine(settings)
  }

  const concurrentCount = resolveDownloadConcurrentCount(settings)
  if (activeDownloadManager) {
    activeDownloadManager.setMaxConcurrentDownloads(concurrentCount)
  }
  browserDownloadManager.setMaxConcurrentDownloads(concurrentCount)
  return concurrentCount
}

export function initDownloadManager() {
  const downloadManager = resolveDownloadManager()
  syncDownloadManagerConcurrency()
  if (downloadManagerInitialized) {
    return
  }

  downloadManager.init()
  downloadManagerInitialized = true
}

export function getDownloadList(event, param) {
  console.log('[下载列表] 查询参数:', param)
  const allRecords = dbInstance.all(`SELECT *
                                     FROM download_records
                                     ORDER BY id DESC`)
  event.reply('getDownloadListSuccess', allRecords)
}

export function addTasksToQueue(event, task) {
  if (!isWebUrl(task?.download_url)) throw new Error('invalid_download_protocol')
  if (task?.fun?.method === 'installApp') assertUpdateUrl(task.download_url)
  const retiredFailure = getRetiredDownloadFailure(task)
  if (retiredFailure) {
    notifyDownloadStatus({ ...task, eventRef: event }, DOWNLOAD_STATUS.FAILED, retiredFailure.message)
    return retiredFailure
  }
  if (isThunderstoreDownloadTask(task) && isThunderstoreStorageMigrationActive()) {
    notifyDownloadStatus(task, DOWNLOAD_STATUS.FAILED, 'Thunderstore 文件正在迁移，请稍后重试')
    return
  }
  initDownloadManager()
  syncDownloadManagerConcurrency()
  const downloadManager = resolveDownloadManager()

  const newTask = {
    ...task,
    eventRef: event
  }

  if (!newTask.id) {
    newTask.id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  downloadManager.addTask(newTask)
}

export async function removeDownloadTask(event, id) {
  initDownloadManager()
  const downloadManager = resolveDownloadManager()

  const result = downloadManager.removeTask(id)
  if (!result.handled) {
    notifyDownloadStatus({ id, eventRef: event }, DOWNLOAD_STATUS.FAILED, '任务不存在')
    return
  }

  if (result.type === 'queued') {
    notifyModDownloadFailed(result.task)
    removeBrowserDownloadArtifacts(result.task.finalFilePath)
    notifyDownloadStatus(result.task, DOWNLOAD_STATUS.CANCELED, '任务已取消')
    return
  }

  if (result.type === 'completed') {
    notifyDownloadStatus({ id, eventRef: event }, DOWNLOAD_STATUS.CANCELED, '任务已取消')
  }
}

export async function deleteDownloadRecord(_event, data) {
  try {
    return await deleteRecordedDownload(data, {
      findRecord: (id) => dbInstance.get('SELECT * FROM download_records WHERE id = ?', [id]),
      deleteRecord: deleteDownloadRecordById
    })
  } catch (error) {
    return { success: false, message: error.message || '删除失败，下载记录已保留' }
  }
}

export async function clearTempFiles() {
  console.log('开始清理下载残留')
  const configuredDownloadPath = store.getStore('systemConfig.settings.downloadPath')
  const managedRoots = collectManagedDownloadRoots(configuredDownloadPath)
  cleanLowVersion(app.getVersion())

  try {
    const deletedTempFileCount = await cleanupTemporaryDownloadArtifacts(managedRoots)
    const missingRecordResult = await cleanupMissingArchiveRecords()
    const duplicateCleanupResult = await cleanupDuplicateBackupFiles()
    const deployBackupResult = await purgeAllStaleDeployBackups()

    console.log(
      [
        '下载残留清理完成',
        `受管目录: ${managedRoots.length}`,
        `临时文件: ${deletedTempFileCount}`,
        `失效文件记录: ${missingRecordResult.deletedFileRecordCount}`,
        `失效下载记录: ${missingRecordResult.deletedDownloadRecordCount}`,
        `重复备份文件: ${duplicateCleanupResult.deletedFileCount}`,
        `重复备份记录: ${duplicateCleanupResult.deletedFileRecordCount}`,
        `关联下载记录: ${duplicateCleanupResult.deletedDownloadRecordCount}`,
        `部署旧备份: ${deployBackupResult.purgedCount}`
      ].join(' | ')
    )
  } catch (error) {
    console.error('清理临时文件时出错:', error)
  }
}

export function clearAllDownloadRecords(event) {
  clearAllDownloadRecordsDB()
  event.reply('clearAllDownloadRecordsSuccess')
}
