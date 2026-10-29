import { shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import {
  getLocalModLibraryItem,
  listLocalModLibrary,
  listVxpackHistory
} from '../../../db/mods/localModLibrary.js'
import {
  validateOfflinePackPackageLimits,
  OFFLINE_PACK_ERROR_CODE
} from '../../../../shared/modpacks/offline-pack-contract.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sanitizeZipSegment(value = '', fallback = 'item') {
  const text = toSafeText(value, fallback)
    .replace(/[\\/:*?"<>|#\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  return text || fallback
}

async function inspectSourcePath(sourcePath = '') {
  if (!sourcePath || !(await fs.pathExists(sourcePath))) {
    return {
      exists: false,
      fileCount: 0,
      dirCount: 0,
      sizeBytes: 0
    }
  }

  const stat = await fs.stat(sourcePath)
  if (stat.isFile()) {
    return {
      exists: true,
      fileCount: 1,
      dirCount: 0,
      sizeBytes: stat.size
    }
  }

  let fileCount = 0
  let dirCount = 0
  let sizeBytes = 0
  async function walk(currentPath) {
    const names = await fs.readdir(currentPath)
    for (const name of names) {
      const absolutePath = path.join(currentPath, name)
      const childStat = await fs.stat(absolutePath)
      if (childStat.isDirectory()) {
        dirCount += 1
        await walk(absolutePath)
      } else if (childStat.isFile()) {
        fileCount += 1
        sizeBytes += childStat.size
      }
    }
  }

  await walk(sourcePath)
  return {
    exists: true,
    fileCount,
    dirCount,
    sizeBytes
  }
}

function buildFingerprint(item = {}, sourcePath = '') {
  const direct = toSafeText(item.fingerprint)
  if (direct) return direct
  return crypto
    .createHash('sha1')
    .update(
      [
        item.sourcePlatform,
        item.sourceModKey,
        item.displayName,
        item.version,
        sourcePath
      ].map((value) => toSafeText(value)).join('|')
    )
    .digest('hex')
}

function resolveExportSourcePath(item = {}) {
  const metadata = toSafeObject(item.metadata)
  const installRulePlan = toSafeObject(metadata.installRulePlan)
  return (
    toSafeText(item.archivePath ?? item.archive_path) ||
    toSafeText(metadata.archivePath ?? metadata.archive_path) ||
    toSafeText(item.archivedSourcePath ?? item.archived_source_path) ||
    toSafeText(metadata.archivedSourcePath ?? metadata.archived_source_path) ||
    toSafeText(item.stagingPath ?? item.staging_path) ||
    toSafeText(metadata.stagingPath ?? metadata.staging_path) ||
    toSafeText(installRulePlan.sourceRoot ?? installRulePlan.source_root) ||
    toSafeText(installRulePlan.lifecycleStagingRoot ?? installRulePlan.lifecycle_staging_root) ||
    toSafeText(item.sourcePath ?? item.source_path) ||
    toSafeText(metadata.sourcePath ?? metadata.source_path) ||
    toSafeText(metadata.sourceRoot ?? metadata.source_root) ||
    toSafeText(item.filePath ?? item.file_path) ||
    toSafeText(metadata.filePath ?? metadata.file_path) ||
    toSafeText(item.localPath ?? item.local_path) ||
    toSafeText(metadata.localPath ?? metadata.local_path) ||
    toSafeText(item.library_root_path ? path.join(item.library_root_path, 'source') : '')
  )
}

function normalizePayloadExportItem(item = {}, index = 0) {
  const metadata = toSafeObject(item.metadata)
  const sourcePath = resolveExportSourcePath(item)
  const exportId = sanitizeZipSegment(
    item.exportId ??
      item.export_id ??
      item.sourceModKey ??
      item.source_mod_key ??
      item.id ??
      item.displayName ??
      item.display_name,
    `item-${index + 1}`
  )
  return {
    ...item,
    id: toSafeNumber(item.id ?? item.libraryItemId, 0),
    exportId,
    displayName: toSafeText(item.displayName ?? item.display_name, `Mod ${index + 1}`),
    file_name: toSafeText(item.file_name ?? item.fileName),
    version: toSafeText(item.version),
    author: toSafeText(item.author),
    source_platform: toSafeText(item.sourcePlatform ?? item.source_platform, 'local'),
    fingerprint: buildFingerprint(item, sourcePath),
    mod_type: toSafeText(item.modType ?? item.mod_type),
    sourcePath,
    metadata: {
      ...metadata,
      sourcePath,
      sourceModKey: toSafeText(item.sourceModKey ?? item.source_mod_key),
      exportSource: toSafeText(item.exportSource, 'installed')
    }
  }
}

function normalizeLibraryExportItem(item = {}, index = 0) {
  const metadata = toSafeObject(item.metadata)
  const sourcePath = resolveExportSourcePath(item)
  return normalizePayloadExportItem(
    {
      ...item,
      exportId: item.id ? `library-${item.id}` : `library-${index + 1}`,
      displayName: item.display_name,
      sourcePlatform: item.source_platform,
      modType: item.mod_type,
      sourcePath,
      metadata: {
        ...metadata,
        sourceRoot: sourcePath
      },
      exportSource: 'local_library'
    },
    index
  )
}

function resolveLibraryExportItems(payload = {}) {
  const ids = Array.isArray(payload.libraryItemIds)
    ? payload.libraryItemIds.map((item) => toSafeNumber(item, 0)).filter(Boolean)
    : []

  if (ids.length) {
    return ids
      .map((id) => getLocalModLibraryItem(id))
      .filter(Boolean)
      .map((item, index) => normalizeLibraryExportItem(item, index))
  }

  return listLocalModLibrary({
    gameId: payload.gameId ?? payload.game_id,
    state: 'active'
  }).map((item, index) => normalizeLibraryExportItem(item, index))
}

function resolveExportItems(payload = {}) {
  const payloadItems = Array.isArray(payload.exportItems ?? payload.export_items)
    ? payload.exportItems ?? payload.export_items
    : []

  if (payloadItems.length) {
    return payloadItems.map((item, index) => normalizePayloadExportItem(item, index))
  }

  return resolveLibraryExportItems(payload)
}

export async function estimateVxpackExportSize(payload = {}) {
  const items = resolveExportItems(payload)
  let sizeBytes = 0
  let modCount = 0
  const entrySizes = []
  for (const item of items) {
    const sourcePath = resolveExportSourcePath(item)
    const stat = await inspectSourcePath(sourcePath)
    if (!stat.exists) continue
    modCount += 1
    const itemBytes = stat.sizeBytes || toSafeNumber(item.metadata?.sizeBytes, 0)
    sizeBytes += itemBytes
    entrySizes.push({
      path: sourcePath,
      sizeBytes: itemBytes
    })
  }
  // 与导出阶段使用同一 validateOfflinePackPackageLimits 校验，避免估算通过但写 zip 超限失败
  const limitValidation = validateOfflinePackPackageLimits({
    packageBytes: sizeBytes,
    entryCount: modCount,
    entrySizes
  })
  if (!limitValidation.valid) {
    return {
      success: false,
      code: limitValidation.code || OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED,
      message: limitValidation.message || '离线安装包超过安全限制',
      data: {
        modCount,
        sizeBytes,
        limits: limitValidation.details?.limits
      }
    }
  }
  return {
    success: true,
    data: {
      modCount,
      sizeBytes
    }
  }
}

export function listRecentVxpackHistory(payload = {}) {
  return {
    success: true,
    data: listVxpackHistory(payload)
  }
}

export async function openVxpackExportFolder(payload = {}) {
  const packagePath = toSafeText(payload.packagePath ?? payload.package_path)
  if (packagePath && (await fs.pathExists(packagePath))) {
    const stat = await fs.stat(packagePath)
    if (stat.isFile()) {
      shell.showItemInFolder(packagePath)
      return { success: true, message: '已打开导出目录并选中文件' }
    }
  }

  const targetPath = packagePath ? path.dirname(packagePath) : toSafeText(payload.folderPath)
  if (!targetPath || !(await fs.pathExists(targetPath))) {
    return { success: false, message: '导出目录不存在' }
  }
  const message = await shell.openPath(targetPath)
  return {
    success: !message,
    message: message || '已打开导出目录'
  }
}
