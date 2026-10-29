import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'
import userPath from '../../../initPath.js'
import {
  deleteLocalModLibraryRecord,
  findLocalModLibraryDuplicate,
  getLocalModLibraryItem,
  insertLocalModLibraryItem,
  listLocalModLibrary,
  markLocalModLibraryDeleted,
  replaceLocalModLibraryEntries,
  resolveGameRow,
  updateLocalModLibraryMeta
} from '../../../db/mods/localModLibrary.js'
import { createSourceInstallTask } from '../source-install-task/orchestrator.js'
import {
  normalizeLocalModInstallTarget,
  resolveLocalModInstallTarget
} from '../local-mod-manager/installTargetService.js'
import {
  analyzeSourcePath,
  createPathFingerprint,
  isArchivePath,
  scanPathEntries
} from './analyzeService.js'

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

function parseJsonArray(value = []) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeSlash(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function isSafeZipEntry(entryName = '') {
  const normalized = normalizeSlash(entryName)
  return !!normalized && !normalized.startsWith('../') && !path.isAbsolute(normalized)
}

function createLibraryFolderName() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
}

function getLibraryRoot(gameId = 0, folderName = '') {
  return path.join(userPath, 'local-mod-library', String(gameId || 'unknown'), folderName)
}

function ensureZipEntriesSafe(archivePath = '') {
  if (path.extname(archivePath).toLowerCase() !== '.zip') {
    return
  }
  const zip = new AdmZip(archivePath)
  for (const entry of zip.getEntries()) {
    if (!isSafeZipEntry(entry.entryName)) {
      throw new Error(`压缩包包含不安全路径：${entry.entryName}`)
    }
  }
}

async function copySourceIntoLibrary(sourcePath = '', sourceType = '', libraryRoot = '') {
  const sourceRoot = path.join(libraryRoot, 'source')
  const extractedRoot = path.join(libraryRoot, 'extracted')
  const metaRoot = path.join(libraryRoot, 'meta')
  await fs.ensureDir(sourceRoot)
  await fs.ensureDir(metaRoot)

  const fileName = path.basename(sourcePath)
  if (sourceType === 'folder') {
    await fs.copy(sourcePath, sourceRoot, {
      overwrite: true,
      errorOnExist: false,
      dereference: false
    })
    return {
      sourceRoot,
      extractedRoot: '',
      archivedSourcePath: ''
    }
  }

  const targetFile = path.join(sourceRoot, fileName)
  await fs.copy(sourcePath, targetFile, {
    overwrite: true,
    errorOnExist: false,
    dereference: false
  })

  if (sourceType === 'archive' && path.extname(targetFile).toLowerCase() === '.zip') {
    ensureZipEntriesSafe(targetFile)
    await fs.ensureDir(extractedRoot)
    const zip = new AdmZip(targetFile)
    zip.extractAllTo(extractedRoot, true)
  }

  if (sourceType === 'archive') {
    await fs.copy(targetFile, path.join(metaRoot, `original-archive${path.extname(targetFile)}`), {
      overwrite: true
    })
  }

  return {
    sourceRoot,
    extractedRoot: sourceType === 'archive' && path.extname(targetFile).toLowerCase() === '.zip'
      ? extractedRoot
      : '',
    archivedSourcePath: targetFile
  }
}

async function collectLibraryEntries(sourceRoot = '') {
  const scan = await scanPathEntries(sourceRoot, { limit: 5000 })
  return scan.entries.map((entry) => ({
    relativePath: normalizeSlash(entry.relativePath),
    entryType: entry.entryType,
    sizeBytes: entry.sizeBytes,
    fileHash: entry.fileHash || ''
  }))
}

function resolveCommitSource(payload = {}) {
  const sourcePath =
    toSafeText(payload.sourcePath) ||
    toSafeText(payload.path) ||
    toSafeText(payload.analysis?.path) ||
    toSafeText(payload.item?.path)
  const analysis = toSafeObject(payload.analysis)
  const sourceType =
    toSafeText(payload.importSourceType) ||
    toSafeText(payload.import_source_type) ||
    toSafeText(analysis.sourceType)
  return {
    sourcePath,
    analysis,
    sourceType
  }
}

function normalizeCommitMeta(payload = {}, analysis = {}) {
  return {
    displayName:
      toSafeText(payload.displayName ?? payload.display_name) ||
      toSafeText(analysis.displayName) ||
      toSafeText(analysis.fileName) ||
      '本地 Mod',
    version: toSafeText(payload.version),
    author: toSafeText(payload.author),
    website: toSafeText(payload.website),
    description: toSafeText(payload.description),
    sourcePlatform: toSafeText(payload.sourcePlatform ?? payload.source_platform, 'local'),
    sourceProfile: toSafeText(payload.sourceProfile ?? payload.source_profile, 'default'),
    modType: toSafeText(payload.modType ?? payload.mod_type) || toSafeText(analysis.modType),
    tags: parseJsonArray(payload.tags ?? payload.tags_json),
    metadata: {
      ...(toSafeObject(payload.metadata ?? payload.metadata_json)),
      analyzeSignals: Array.isArray(analysis.signals) ? analysis.signals : [],
      analyzedAt: new Date().toISOString()
    }
  }
}

export async function commitLocalModImport(payload = {}) {
  const game = resolveGameRow(payload)
  if (!game?.id) {
    return { success: false, message: '未找到当前游戏记录，无法导入本地 Mod' }
  }

  const { sourcePath, analysis: providedAnalysis, sourceType: providedSourceType } =
    resolveCommitSource(payload)
  if (!sourcePath || !(await fs.pathExists(sourcePath))) {
    return { success: false, message: '导入来源不存在' }
  }

  const analysis = providedAnalysis?.path ? providedAnalysis : await analyzeSourcePath(sourcePath)
  if (!analysis?.success) {
    return { success: false, message: analysis?.message || '导入来源分析失败' }
  }

  const importSourceType = providedSourceType || analysis.sourceType
  const fingerprint = toSafeText(payload.fingerprint) || analysis.fingerprint || await createPathFingerprint(sourcePath)
  const duplicate = findLocalModLibraryDuplicate({ gameId: game.id, fingerprint })
  const conflictStrategy = toSafeText(payload.conflictStrategy ?? payload.conflict_strategy, 'skip')

  if (duplicate && conflictStrategy === 'skip') {
    return {
      success: false,
      code: 'DUPLICATE_LOCAL_MOD',
      message: '本地模组库中已存在相同指纹的资产',
      data: {
        duplicate
      }
    }
  }

  if (duplicate && conflictStrategy === 'overwrite') {
    if (duplicate.library_root_path) {
      await fs.remove(duplicate.library_root_path)
    }
    deleteLocalModLibraryRecord(duplicate.id)
  }

  const folderName = createLibraryFolderName()
  const libraryRoot = getLibraryRoot(game.id, folderName)
  await fs.ensureDir(libraryRoot)

  try {
    const copied = await copySourceIntoLibrary(sourcePath, importSourceType, libraryRoot)
    const entries = await collectLibraryEntries(copied.sourceRoot)
    const meta = normalizeCommitMeta(payload, analysis)
    const libraryId = insertLocalModLibraryItem({
      gameId: game.id,
      sourcePlatform: meta.sourcePlatform,
      sourceProfile: meta.sourceProfile,
      displayName: meta.displayName,
      fileName: analysis.fileName || path.basename(sourcePath),
      version: meta.version,
      author: meta.author,
      website: meta.website,
      description: meta.description,
      coverPath: toSafeText(payload.coverPath ?? payload.cover_path),
      importSourceType,
      importOriginPath: sourcePath,
      libraryRootPath: libraryRoot,
      fingerprint,
      modType: meta.modType,
      tags: meta.tags,
      metadata: {
        ...meta.metadata,
        sourceRoot: copied.sourceRoot,
        extractedRoot: copied.extractedRoot,
        archivedSourcePath: copied.archivedSourcePath,
        fileCount: entries.filter((entry) => entry.entryType === 'file').length,
        dirCount: entries.filter((entry) => entry.entryType === 'dir').length,
        sizeBytes: analysis.sizeBytes || entries.reduce((sum, entry) => sum + toSafeNumber(entry.sizeBytes, 0), 0)
      }
    })
    replaceLocalModLibraryEntries(libraryId, entries)

    return {
      success: true,
      message: '本地 Mod 已导入资产库',
      data: getLocalModLibraryItem(libraryId)
    }
  } catch (error) {
    await fs.remove(libraryRoot)
    return {
      success: false,
      message: String(error?.message || '本地 Mod 导入失败')
    }
  }
}

export function listLibrary(payload = {}) {
  return {
    success: true,
    data: listLocalModLibrary(payload)
  }
}

export function getLibraryItem(payload = {}) {
  const item = getLocalModLibraryItem(payload?.id)
  if (!item) {
    return { success: false, message: '本地模组库记录不存在' }
  }
  return { success: true, data: item }
}

export function updateLibraryMeta(payload = {}) {
  const item = getLocalModLibraryItem(payload?.id)
  if (!item) {
    return { success: false, message: '本地模组库记录不存在' }
  }
  updateLocalModLibraryMeta(item.id, {
    ...item,
    ...payload
  })
  return {
    success: true,
    message: '本地模组元数据已更新',
    data: getLocalModLibraryItem(item.id)
  }
}

export async function deleteLibraryItem(payload = {}) {
  const item = getLocalModLibraryItem(payload?.id)
  if (!item) {
    return { success: false, message: '本地模组库记录不存在' }
  }

  if (payload?.deleteFiles === true && item.library_root_path) {
    await fs.remove(item.library_root_path)
    deleteLocalModLibraryRecord(item.id)
  } else {
    markLocalModLibraryDeleted(item.id)
  }

  return {
    success: true,
    message: payload?.deleteFiles === true ? '本地模组资产和记录已删除' : '本地模组记录已移除'
  }
}

function addFolderToZip(zip, folderPath = '', rootPath = folderPath, prefix = '') {
  if (!fs.existsSync(folderPath)) return
  const names = fs.readdirSync(folderPath)
  for (const name of names) {
    const absolutePath = path.join(folderPath, name)
    const stat = fs.statSync(absolutePath)
    const relativePath = normalizeSlash(path.relative(rootPath, absolutePath))
    const zipPath = normalizeSlash(path.posix.join(prefix, relativePath))
    if (stat.isDirectory()) {
      addFolderToZip(zip, absolutePath, rootPath, prefix)
    } else {
      zip.addLocalFile(absolutePath, path.posix.dirname(zipPath))
    }
  }
}

async function createArchiveForInstall(item = {}) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  const archivedSourcePath = toSafeText(metadata.archivedSourcePath)
  if (archivedSourcePath && await fs.pathExists(archivedSourcePath) && isArchivePath(archivedSourcePath)) {
    return archivedSourcePath
  }

  const sourceRoot = toSafeText(metadata.sourceRoot) || path.join(item.library_root_path, 'source')
  if (!(await fs.pathExists(sourceRoot))) {
    throw new Error('本地模组源文件不存在')
  }

  const metaRoot = path.join(item.library_root_path, 'meta')
  await fs.ensureDir(metaRoot)
  const archivePath = path.join(metaRoot, `install-task-${Date.now()}.zip`)
  const zip = new AdmZip()
  addFolderToZip(zip, sourceRoot, sourceRoot)
  zip.writeZip(archivePath)
  return archivePath
}

export async function createLibraryInstallTask(event, payload = {}) {
  const item = getLocalModLibraryItem(payload?.id ?? payload?.libraryItemId)
  if (!item) {
    return { success: false, message: '本地模组库记录不存在' }
  }

  const archivePath = await createArchiveForInstall(item)
  const explicitInstallTarget = payload?.installTarget && typeof payload.installTarget === 'object'
    ? payload.installTarget
    : item.metadata?.installTarget
  const targetResult = explicitInstallTarget
    ? await normalizeLocalModInstallTarget(
        {
          ...payload,
          installTarget: explicitInstallTarget
        },
        item
      )
    : await resolveLocalModInstallTarget(event, {
        ...payload,
        id: item.id,
        libraryItemId: item.id,
        sourcePath: archivePath,
        gameId: item.game_id,
        sourcePlatform: payload.sourcePlatform ?? item.source_platform,
        profileName: payload.profileName ?? item.source_profile
      })

  if (!targetResult?.success) {
    return {
      success: false,
      code: targetResult?.code || 'local_mod_manual_target_required',
      message: targetResult?.message || '没有匹配到明确安装目标，请选择安装文件夹',
      data: targetResult?.data || {}
    }
  }

  const installTarget = targetResult.data?.installTarget || {}
  const sourcePlatform = toSafeText(payload.sourcePlatform ?? item.source_platform, 'local')
  const profileName = toSafeText(payload.profileName ?? item.source_profile, 'default')
  const sourceModKey = `local:${item.id}:${item.fingerprint || item.display_name}`
  const installPayload = {
    appid: toSafeText(payload.appId ?? payload.appid),
    gameId: item.game_id,
    modId: item.id,
    id: item.id,
    modName: item.display_name,
    name: item.file_name || item.display_name,
    version: item.version,
    fileSize: item.metadata?.sizeBytes || 0,
    sourceType: sourcePlatform,
    sourcePlatform,
    profileName,
    targetProfileName: profileName,
    sourceModKey,
    filePath: archivePath,
    localPath: archivePath,
    manualDownload: true,
    installTarget,
    targetPath: installTarget.targetPath || '',
    targetRelativePath: installTarget.targetRelativePath || '',
    targetBaseType: installTarget.targetBaseType || '',
    metadata: {
      localLibraryItemId: item.id,
      fingerprint: item.fingerprint,
      modType: item.mod_type,
      sourceRoot: item.metadata?.sourceRoot || '',
      extractedRoot: item.metadata?.extractedRoot || '',
      installTarget
    }
  }

  const taskResult = await createSourceInstallTask(event, {
    source: sourcePlatform,
    sourceAdapter: sourcePlatform,
    gameKey: `${sourcePlatform}:${item.game_id}`,
    title: `本地 Mod 安装：${item.display_name}`,
    items: [
      {
        item: {
          id: `local-${item.id}-${Date.now()}`,
          task_name: item.display_name,
          module: '游戏',
          file_type: path.extname(archivePath).replace('.', '') || 'zip',
          filePath: archivePath,
          finalFilePath: archivePath,
          file_size: item.metadata?.sizeBytes || 0,
          sourceType: sourcePlatform,
          sourcePlatform,
          sourceModKey,
          sourceModId: String(item.id),
          sourceFileId: String(item.id),
          gameId: item.game_id,
          targetPath: installTarget.targetPath || '',
          targetRelativePath: installTarget.targetRelativePath || '',
          fun: { type: 0 }
        },
        meta: {
          displayName: item.display_name,
          installPayload,
          installTarget
        }
      }
    ],
    options: {
      autoStart: payload.autoStart === true
    }
  })
  if (taskResult?.success) {
    updateLocalModLibraryMeta(item.id, {
      ...item,
      metadata: {
        ...(item.metadata || {}),
        schemaVersion: 2,
        createdBy: item.metadata?.createdBy || 'local-mod-manager',
        managementMode: 'library_install_task',
        installTarget,
        lastTaskId: taskResult.jobId || '',
        lastTaskCreatedAt: new Date().toISOString()
      }
    })
  }
  return taskResult
}
