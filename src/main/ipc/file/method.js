import { nativeText } from '../../services/uiLanguage.js'
import { dialog } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import { getAllFileRecordsDB } from '../../db/files/files.js'
import { getAllDownloadRecordsDB } from '../../db/files/download.js'
import {
  getSameDriveDownloadCacheRootMarkers,
  getSameDriveDownloadCacheScopeRoots
} from '../../services/downloads/storageContext.js'
import {
  cleanupTaskResiduals,
  deleteAssets,
  getStats,
  listAssets,
  markAssets,
  previewDeleteAssets,
  reconcileAssets,
  releaseOwner,
  retryDeleteFailed,
  scanOrphans
} from '../../services/managed-files/service.js'

export function openFileSelector(event) {
  dialog
    .showOpenDialog({
      title: nativeText('selectFile'),
      filters: [{ name: nativeText('images'), extensions: ['png', 'jpg'] }],
      properties: ['openFile', 'multiSelections']
    })
    .then((result) => {
      if (!result.canceled) {
        console.log('选中的文件路径:', result.filePaths)
        event.reply('openFileSelectorS', result)
      }
    })
    .catch((err) => {
      console.error('对话框错误:', err)
    })
}

// 删除指定路径文件或者文件夹
export function deleteTarget(event, path) {
  return fs.pathExists(path).then(async (exists) => {
    console.log('打开的路径是否存在：', exists)
    if (exists) {
      try {
        const stats = await fs.stat(path)
        if (stats.isFile()) {
          // 如果是文件，直接删除
          await fs.unlink(path)
          console.log('文件删除成功:', path)
          if (event && event.reply) {
            event.reply('delete-success', { path, type: 'file' })
          }
          return { success: true, type: 'file' }
        } else if (stats.isDirectory()) {
          // 如果是文件夹，递归删除
          await fs.remove(path)
          console.log('文件夹删除成功:', path)
          if (event && event.reply) {
            event.reply('delete-success', { path, type: 'directory' })
          }
          return { success: true, type: 'directory' }
        }
      } catch (error) {
        console.error('删除失败:', error)
        if (event && event.reply) {
          event.reply('delete-error', { path, error: error.message })
        }
        return { success: false, error: error.message }
      }
    } else {
      console.log('路径不存在:', path)
      if (event && event.reply) {
        event.reply('delete-error', { path, error: 'Path does not exist' })
      }
      return { success: false, error: 'Path does not exist' }
    }
  })
}

const ARCHIVE_EXTENSIONS = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tgz',
  '.tbz2',
  '.txz',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.bz2',
  '.xz'
]
const INSTALL_DATA_JSON_FILE_PATTERNS = [
  /^incremental_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i,
  /^save_mod_priority_order_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_\d+)?\.json$/i,
  /^install_rebuild_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_\d+)?\.json$/i
]
const MANAGED_SCAN_EXCLUDED_DIRECTORY_NAMES = new Set([
  'backup',
  'deployment',
  'manifest',
  'runtime-backup',
  'staging',
  'temp'
])
const SAME_DRIVE_FILE_MANAGEMENT_SCOPE_NAME = 'downloads'
const TEMP_DOWNLOAD_FILE_SUFFIXES = ['.tmp', '.crdownload', '.downloading']

function normalizeManagePayload(payload = '') {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      rootPath: String(payload.rootPath || payload.cachePath || '').trim()
    }
  }

  return {
    rootPath: String(payload || '').trim()
  }
}

function normalizeFsKey(filePath = '') {
  return path.normalize(String(filePath || '').trim()).toLowerCase()
}

function getPathBaseNameLower(targetPath = '') {
  return path.basename(String(targetPath || '').trim()).toLowerCase()
}

function isManagedScanExcludedDirectory(dirPath = '') {
  return MANAGED_SCAN_EXCLUDED_DIRECTORY_NAMES.has(getPathBaseNameLower(dirPath))
}

function isInstallDataJsonFile(filePath = '') {
  const baseName = path.basename(String(filePath || '').trim())
  return INSTALL_DATA_JSON_FILE_PATTERNS.some((pattern) => pattern.test(baseName))
}

function isTemporaryDownloadArtifact(filePath = '') {
  const safeFilePath = String(filePath || '').trim().toLowerCase()
  return TEMP_DOWNLOAD_FILE_SUFFIXES.some((suffix) => safeFilePath.endsWith(suffix))
}

function isPathInManagedScanExcludedDirectory(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) return false

  return path
    .normalize(safeFilePath)
    .split(/[\\/]+/)
    .some((segment) => MANAGED_SCAN_EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase()))
}

function shouldExcludeManagedScanFile(filePath = '') {
  return (
    isPathInManagedScanExcludedDirectory(filePath) ||
    isInstallDataJsonFile(filePath) ||
    isTemporaryDownloadArtifact(filePath)
  )
}

function uniqueNumberList(list = []) {
  return Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  )
}

function resolveArchiveExtension(filePath = '') {
  const baseName = path.basename(String(filePath || '').trim()).toLowerCase()
  if (!baseName) return ''

  const matched = ARCHIVE_EXTENSIONS.find((ext) => baseName.endsWith(ext))
  return matched || ''
}

function getArchiveTypeLabel(filePath = '') {
  const ext = resolveArchiveExtension(filePath)
  return ext ? ext.replace(/^\./, '') : ''
}

function getFileTypeLabel(filePath = '', fallbackType = '') {
  const safeFallbackType = String(fallbackType || '')
    .replace(/^\./, '')
    .trim()
  if (safeFallbackType) return safeFallbackType

  const archiveType = getArchiveTypeLabel(filePath)
  if (archiveType) return archiveType

  const extName = path.extname(String(filePath || '').trim()).replace(/^\./, '')
  return extName || 'file'
}

function getFileIconType(filePath = '', fallbackType = '') {
  const typeLabel = getFileTypeLabel(filePath, fallbackType)
  const parts = typeLabel.split('.')
  return parts[parts.length - 1] || 'file'
}

function resolveDisplayName(raw = {}) {
  const taskName = String(raw.task_name || raw.taskName || '').trim()
  if (taskName) return taskName
  return path.basename(String(raw.file_path || raw.filePath || '').trim()) || '未命名文件'
}

function resolveDisplayTime(raw = {}) {
  const candidates = [raw.create_time, raw.created_at, raw.finished_at, raw.updated_at, raw.mtime]

  for (const item of candidates) {
    const text = String(item || '').trim()
    if (text) return text
  }

  return '--'
}

function resolveSortTime(raw = {}) {
  const candidates = [
    raw.create_time,
    raw.created_at,
    raw.finished_at,
    raw.updated_at,
    raw.mtime,
    raw.mtimeMs,
    raw.ctimeMs
  ]

  for (const item of candidates) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      return item
    }

    const text = String(item || '').trim()
    if (!text) continue

    const timestamp = Date.parse(text)
    if (Number.isFinite(timestamp)) {
      return timestamp
    }
  }

  return 0
}

function extractManagedDownloadRoot(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) return ''

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

async function collectWindowsManagedRoots() {
  const roots = []
  for (let code = 67; code <= 90; code += 1) {
    const drive = String.fromCharCode(code)
    const sameDriveDownloadRoots = getSameDriveDownloadCacheScopeRoots(`${drive}:\\`).filter(
      (candidate) => getPathBaseNameLower(candidate) === SAME_DRIVE_FILE_MANAGEMENT_SCOPE_NAME
    )
    const candidateList = [
      `${drive}:\\Vertex\\dow`,
      ...sameDriveDownloadRoots
    ]

    for (const candidate of candidateList) {
      if (await fs.pathExists(candidate)) {
        roots.push(candidate)
      }
    }
  }
  return roots
}

async function getManagedScanRoots(rootPath = '', existingRecords = []) {
  const rootSet = new Set()

  const pushRoot = (value = '') => {
    const safeValue = String(value || '').trim()
    if (!safeValue) return

    try {
      const resolvedValue = path.resolve(safeValue)
      if (isManagedScanExcludedDirectory(resolvedValue)) {
        return
      }
      rootSet.add(resolvedValue)
    } catch {
      // ignore
    }
  }

  pushRoot(rootPath)

  for (const record of existingRecords) {
    pushRoot(extractManagedDownloadRoot(record.file_path))
  }

  const windowsRoots = await collectWindowsManagedRoots()
  windowsRoots.forEach(pushRoot)

  return Array.from(rootSet)
}

async function scanManagedFiles(rootPath = '') {
  const safeRootPath = String(rootPath || '').trim()
  if (!safeRootPath || !(await fs.pathExists(safeRootPath))) {
    return []
  }

  const resolvedRootPath = path.resolve(safeRootPath)
  if (isManagedScanExcludedDirectory(resolvedRootPath)) {
    return []
  }

  const result = []
  const stack = [resolvedRootPath]

  while (stack.length) {
    const currentPath = stack.pop()
    if (!currentPath) continue

    let entries = []
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        if (isManagedScanExcludedDirectory(fullPath)) {
          continue
        }
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (shouldExcludeManagedScanFile(fullPath)) {
        continue
      }

      try {
        const stats = await fs.stat(fullPath)
        const fileType = getFileTypeLabel(fullPath)
        result.push({
          file_path: fullPath,
          file_size: Number(stats.size || 0),
          type: getFileIconType(fullPath),
          archive_type: fileType,
          file_type: fileType,
          mtime: stats.mtime.toISOString(),
          mtimeMs: Number(stats.mtimeMs || 0),
          source_label: '磁盘扫描',
          source_type: 'scan'
        })
      } catch {
        // ignore
      }
    }
  }

  return result
}

function createUnifiedFileRecord(raw = {}) {
  const filePath = String(raw.file_path || raw.filePath || '').trim()
  const fileType = getFileTypeLabel(filePath, raw.file_type || raw.archive_type || raw.type)
  const iconType = getFileIconType(filePath, raw.type || raw.file_type || raw.archive_type)

  return {
    id: String(raw.id || ''),
    key: normalizeFsKey(filePath),
    task_name: String(raw.task_name || raw.taskName || '').trim(),
    display_name: resolveDisplayName(raw),
    module: String(raw.module || '').trim() || '--',
    type: iconType || 'file',
    archive_type: fileType,
    file_type: fileType,
    file_path: filePath,
    md5: String(raw.md5 || '').trim(),
    size: Number(raw.size ?? raw.file_size ?? 0) || 0,
    create_time: resolveDisplayTime(raw),
    sort_time: resolveSortTime(raw),
    source_label: String(raw.source_label || '文件记录').trim(),
    source_type: String(raw.source_type || 'unknown').trim(),
    file_record_ids: uniqueNumberList(raw.file_record_ids),
    download_record_ids: uniqueNumberList(raw.download_record_ids),
    exists: raw.exists !== false
  }
}

function mergeUnifiedFileRecord(target = {}, incoming = {}) {
  const next = {
    ...target,
    ...incoming
  }

  next.display_name =
    String(target.display_name || '').trim() || String(incoming.display_name || '').trim()
  next.task_name = String(target.task_name || '').trim() || String(incoming.task_name || '').trim()
  next.module = String(target.module || '').trim() || String(incoming.module || '').trim() || '--'
  next.md5 = String(target.md5 || '').trim() || String(incoming.md5 || '').trim()
  next.type = String(target.type || '').trim() || String(incoming.type || '').trim() || 'file'
  next.archive_type =
    String(target.archive_type || '').trim() ||
    String(incoming.archive_type || '').trim() ||
    next.type
  next.file_type =
    String(target.file_type || '').trim() || String(incoming.file_type || '').trim() || next.type
  next.size = Math.max(Number(target.size || 0), Number(incoming.size || 0))
  next.create_time =
    resolveDisplayTime(target) !== '--' ? resolveDisplayTime(target) : resolveDisplayTime(incoming)
  next.sort_time = Math.max(Number(target.sort_time || 0), Number(incoming.sort_time || 0))
  next.file_record_ids = uniqueNumberList([
    ...(target.file_record_ids || []),
    ...(incoming.file_record_ids || [])
  ])
  next.download_record_ids = uniqueNumberList([
    ...(target.download_record_ids || []),
    ...(incoming.download_record_ids || [])
  ])

  const sourceLabelSet = new Set(
    [target.source_label, incoming.source_label]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )
  next.source_label = Array.from(sourceLabelSet).join(' / ') || '文件记录'

  const sourceTypeSet = new Set(
    [target.source_type, incoming.source_type]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )
  next.source_type = Array.from(sourceTypeSet).join(',')

  next.exists = target.exists !== false || incoming.exists !== false

  return next
}

async function buildManagedFileAssetList(rootPath = '') {
  const fileRecords = getAllFileRecordsDB()
  const downloadRecords = getAllDownloadRecordsDB()
  const scanRoots = await getManagedScanRoots(rootPath, [...fileRecords, ...downloadRecords])
  const scannedRecords = (await Promise.all(scanRoots.map((item) => scanManagedFiles(item)))).flat()

  const assetMap = new Map()
  const upsertAsset = (record = {}) => {
    if (shouldExcludeManagedScanFile(record?.file_path || record?.filePath)) return

    const unified = createUnifiedFileRecord(record)
    if (!unified.file_path || !unified.key) return

    const existing = assetMap.get(unified.key)
    assetMap.set(unified.key, existing ? mergeUnifiedFileRecord(existing, unified) : unified)
  }

  for (const item of fileRecords) {
    upsertAsset({
      ...item,
      size: Number(item.size || 0),
      source_label: '安装包缓存',
      source_type: 'files_db',
      file_record_ids: [item.id]
    })
  }

  for (const item of downloadRecords) {
    upsertAsset({
      ...item,
      size: Number(item.file_size || 0),
      source_label: '下载记录',
      source_type: 'download_db',
      download_record_ids: [item.id]
    })
  }

  for (const item of scannedRecords) {
    upsertAsset(item)
  }

  const list = Array.from(assetMap.values())
  for (const item of list) {
    try {
      const stats = await fs.stat(item.file_path)
      item.exists = true
      item.size = Number(stats.size || 0)
      if (!item.sort_time) {
        item.sort_time = Number(stats.mtimeMs || 0)
      }
      if (item.create_time === '--') {
        item.create_time = stats.mtime.toISOString().replace('T', ' ').slice(0, 19)
      }
    } catch {
      item.exists = false
    }
  }

  return list
    .filter((item) => item.exists)
    .sort((a, b) => Number(b.sort_time || 0) - Number(a.sort_time || 0))
    .map((item, index) => ({
      ...item,
      id: item.id || `${item.key}-${index}`
    }))
}

export async function getAllFileRecords(event, cachePath) {
  const { rootPath } = normalizeManagePayload(cachePath)
  const allList = await buildManagedFileAssetList(rootPath)
  const cacheSize = allList.reduce((sum, item) => sum + Number(item.size || 0), 0)

  event.reply('getAllFileRecordsSuccess', {
    list: allList,
    cacheSize,
    totalSize: 0,
    archiveCount: allList.length
  })
}

export async function deleteAllFileRecords(event, payload) {
  const { rootPath } = normalizeManagePayload(payload)
  const allList = await buildManagedFileAssetList(rootPath)
  const result = await deleteAssets(
    {
      legacyItems: allList,
      rootPath
    },
    {
      rootPath
    }
  )
  event.reply('deleteAllFileRecordsSuccess', result)
}

export async function deleteInstallerBackupRecords() {
  try {
    const fileRecords = getAllFileRecordsDB().filter((item) => Number(item?.module || 0) === 0)
    const downloadRecordMap = new Map()

    getAllDownloadRecordsDB().forEach((item) => {
      const key = normalizeFsKey(item?.file_path)
      if (!key) return
      const list = downloadRecordMap.get(key) || []
      list.push(item)
      downloadRecordMap.set(key, list)
    })

    const legacyItems = fileRecords.map((item) => {
      const relatedDownloadRecords = downloadRecordMap.get(normalizeFsKey(item?.file_path)) || []
      return {
        ...item,
        file_record_ids: [item.id],
        download_record_ids: relatedDownloadRecords.map((record) => record.id)
      }
    })

    const result = await deleteAssets({ legacyItems })

    return {
      success: Number(result.failedCount || 0) === 0,
      message: result.failedCount ? `已清理 ${result.deletedCount} 个安装包，${result.failedCount} 项失败，请重试` : '',
      skippedCount: Number(result.skippedCount || 0),
      deletedFileCount: result.deletedCount,
      deletedFileRecordCount: result.results.filter((item) => item.success).length,
      deletedDownloadRecordCount: result.results
        .filter((item) => item.success)
        .reduce((sum, item) => sum + uniqueNumberList(item.download_record_ids).length, 0),
      result
    }
  } catch (error) {
    console.error('清理安装包缓存失败:', error)
    return { success: false, message: String(error?.message || '清理安装包缓存失败') }
  }
}

export async function deleteFileRecord(event, item) {
  const result = await deleteAssets({
    legacyItems: [item]
  })
  event.reply('deleteFileRecordSuccess', result)
}

export async function previewManagedFileDelete(payload = {}) {
  return await previewDeleteAssets(payload, {
    rootPath: payload?.rootPath || payload?.cachePath || ''
  })
}

export async function deleteManagedFileAssets(payload = {}) {
  return await deleteAssets(payload, {
    rootPath: payload?.rootPath || payload?.cachePath || ''
  })
}

export async function releaseManagedFileOwner(payload = {}) {
  return await releaseOwner(payload?.owner || payload, payload?.options || {})
}

export async function retryManagedFileDeleteFailed(payload = {}) {
  return await retryDeleteFailed(payload)
}

export async function listManagedFileAssets(payload = {}) {
  return await listAssets(payload)
}

export async function getManagedFileStats(payload = {}) {
  return await getStats(payload)
}

export async function scanManagedFileOrphans(payload = {}) {
  return await scanOrphans(payload)
}

export async function reconcileManagedFileAssets(payload = {}) {
  return await reconcileAssets(payload)
}

export async function markManagedFileAssets(payload = {}) {
  return await markAssets(payload)
}

export async function cleanupManagedFileTaskResiduals(payload = {}) {
  return await cleanupTaskResiduals(payload)
}
