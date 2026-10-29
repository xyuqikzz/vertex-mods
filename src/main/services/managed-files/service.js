import fs from 'fs-extra'
import path from 'path'
import {
  deleteDownloadRecordById,
  deleteDownloadRecordsByFilePath,
  getAllDownloadRecordsDB
} from '../../db/files/download.js'
import { deleteFileRecordById, getAllFileRecordsDB } from '../../db/files/files.js'
import {
  deleteManagedFileAssetOwnersByOwner,
  deleteManagedFileAssetById,
  ensureManagedFileAssetTables,
  getManagedFileAssetById,
  getManagedFileAssetByPath,
  linkManagedFileAssetOwner,
  listManagedFileAssetOwners,
  listManagedFileAssets,
  upsertManagedFileAsset,
  updateManagedFileAssetState
} from '../../db/files/managedFileAssets.js'
import store from '../../storage/store/index.js'
import { getSameDriveDownloadCacheScopeRoots } from '../downloads/storageContext.js'
import { buildManagedAssetDeleteSkipReasons } from './cleanupPolicy.js'
import { isProtectedThunderstoreProfilePath } from '../profiles/thunderstoreStorage.js'

const MANAGED_ROOT_NAME = 'VertexManaged'
const DEFAULT_DELETE_POLICY = 'keep_until_unused'
const DELETE_WITH_OWNER_POLICY = 'delete_with_owner'
const DELETABLE_MANAGED_MODES = new Set(['owned', 'copied'])
const ORPHAN_SCAN_EXCLUDED_DIRECTORY_NAMES = new Set([
  'backup',
  'deployment',
  'manifest',
  'runtime-backup',
  'staging'
])
const TEMP_FILE_SUFFIXES = ['.tmp', '.crdownload', '.downloading']
const ASSET_TYPE_LABELS = {
  download: '下载缓存',
  mod_source: '模组源文件',
  temp: '临时文件',
  orphaned: '孤儿文件'
}
const STATE_LABELS = {
  active: '正常',
  deleting: '删除中',
  deleted: '已删除',
  delete_failed: '删除失败',
  missing: '文件缺失',
  orphaned: '孤儿文件',
  ignored: '已忽略'
}

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeFsKey(filePath = '') {
  return path.normalize(toSafeText(filePath)).toLowerCase()
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

function uniqueTextList(list = []) {
  return Array.from(new Set(list.map(toSafeText).filter(Boolean)))
}

function getAssetTypeLabel(assetType = '') {
  const safeType = toSafeText(assetType) || 'download'
  return ASSET_TYPE_LABELS[safeType] || safeType
}

function getStateLabel(state = '') {
  const safeState = toSafeText(state) || 'active'
  return STATE_LABELS[safeState] || safeState
}

function isDangerousRootPath(targetPath = '') {
  const safePath = toSafeText(targetPath)
  if (!safePath) return true
  const resolved = path.resolve(safePath)
  const parsed = path.parse(resolved)
  return normalizeFsKey(resolved) === normalizeFsKey(parsed.root)
}

function isOrphanScanExcludedDirectory(dirPath = '') {
  const baseName = path.basename(toSafeText(dirPath)).toLowerCase()
  return ORPHAN_SCAN_EXCLUDED_DIRECTORY_NAMES.has(baseName)
}

function isTemporaryFile(filePath = '') {
  const lowerPath = toSafeText(filePath).toLowerCase()
  return TEMP_FILE_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))
}

function getDownloadRootFromStore() {
  return toSafeText(store.getStore('systemConfig.settings.downloadPath'))
}

export function getManagedFileRootPath(rootPath = '') {
  const downloadRoot = toSafeText(rootPath) || getDownloadRootFromStore()
  return downloadRoot ? path.join(downloadRoot, MANAGED_ROOT_NAME) : ''
}

export function getManagedModSourceRootPath(rootPath = '') {
  const managedRoot = getManagedFileRootPath(rootPath)
  return managedRoot ? path.join(managedRoot, 'mod-sources') : ''
}

function isPathInsideByText(targetPath = '', rootPath = '') {
  const safeTarget = normalizeFsKey(targetPath)
  const safeRoot = normalizeFsKey(rootPath)
  return !!safeTarget && !!safeRoot && (safeTarget === safeRoot || safeTarget.startsWith(`${safeRoot}${path.sep}`))
}

async function realpathOrResolved(targetPath = '') {
  const resolved = path.resolve(targetPath)
  try {
    return await fs.realpath(resolved)
  } catch {
    return resolved
  }
}

async function collectAllowedRoots(targetPath = '', options = {}) {
  const roots = []
  const append = (value = '') => {
    const safeValue = toSafeText(value)
    if (safeValue) roots.push(safeValue)
  }

  append(options.rootPath)
  append(options.storageRootPath)

  const downloadRoot = getDownloadRootFromStore()
  append(downloadRoot)
  append(getManagedFileRootPath(downloadRoot))

  const parsedRoot = path.parse(path.resolve(targetPath || downloadRoot || '.')).root
  getSameDriveDownloadCacheScopeRoots(parsedRoot).forEach(append)

  return uniqueTextList(roots)
}

async function assertSafeDeletePath(targetPath = '', options = {}) {
  const safeTarget = toSafeText(targetPath)
  if (!safeTarget) {
    return { allowed: false, reason: '文件路径为空' }
  }

  if (isDangerousRootPath(safeTarget)) {
    return { allowed: false, reason: '禁止删除磁盘根目录' }
  }

  const exists = await fs.pathExists(safeTarget)
  if (!exists) {
    return { allowed: false, missing: true, reason: '文件不存在' }
  }

  const targetRealPath = await realpathOrResolved(safeTarget)
  const allowedRoots = await collectAllowedRoots(targetRealPath, options)
  const rootRealPaths = []

  for (const root of allowedRoots) {
    if (!(await fs.pathExists(root))) {
      continue
    }
    rootRealPaths.push(await realpathOrResolved(root))
  }

  const matchedRoot = rootRealPaths.find((root) => isPathInsideByText(targetRealPath, root))
  if (!matchedRoot) {
    return {
      allowed: false,
      reason: '文件不在 Vertex 受控目录或下载缓存边界内'
    }
  }

  if (normalizeFsKey(targetRealPath) === normalizeFsKey(matchedRoot)) {
    return {
      allowed: false,
      reason: '禁止删除受控根目录本身'
    }
  }

  return {
    allowed: true,
    targetRealPath,
    matchedRoot
  }
}

function resolveStorageRootType(filePath = '', rootPath = '') {
  const managedRoot = getManagedFileRootPath(rootPath)
  if (managedRoot && isPathInsideByText(filePath, managedRoot)) return 'managed_root'
  const downloadRoot = toSafeText(rootPath) || getDownloadRootFromStore()
  if (downloadRoot && isPathInsideByText(filePath, downloadRoot)) return 'managed_root'

  const parsedRoot = path.parse(path.resolve(filePath || '.')).root
  const sameDriveRoot = getSameDriveDownloadCacheScopeRoots(parsedRoot).find((root) =>
    isPathInsideByText(filePath, root)
  )
  return sameDriveRoot ? 'same_drive_cache' : 'external_reference'
}

function resolveStorageRootPath(filePath = '', rootPath = '') {
  const managedRoot = getManagedFileRootPath(rootPath)
  if (managedRoot && isPathInsideByText(filePath, managedRoot)) return managedRoot

  const downloadRoot = toSafeText(rootPath) || getDownloadRootFromStore()
  if (downloadRoot && isPathInsideByText(filePath, downloadRoot)) return downloadRoot

  const parsedRoot = path.parse(path.resolve(filePath || '.')).root
  return (
    getSameDriveDownloadCacheScopeRoots(parsedRoot).find((root) => isPathInsideByText(filePath, root)) || ''
  )
}

function resolveManagedMode(filePath = '', rootPath = '', preferredMode = '') {
  const safePreferred = toSafeText(preferredMode)
  if (safePreferred) return safePreferred
  const storageRootType = resolveStorageRootType(filePath, rootPath)
  return storageRootType === 'external_reference' ? 'referenced' : 'owned'
}

async function getDirectorySize(dirPath = '', options = {}) {
  const maxEntries = Math.max(1, Number(options.maxEntries || 5000) || 5000)
  let entryCount = 0
  let totalSize = 0
  const stack = [dirPath]

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
      if (entryCount >= maxEntries) {
        return totalSize
      }
      entryCount += 1
      const fullPath = path.join(currentPath, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push(fullPath)
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath)
          totalSize += Number(stats.size || 0)
        }
      } catch {
        // ignore unreadable child entries
      }
    }
  }

  return totalSize
}

async function getPathStats(filePath = '', options = {}) {
  try {
    const stats = await fs.stat(filePath)
    const isDirectory = stats.isDirectory()
    return {
      exists: true,
      size:
        isDirectory && options.includeDirectorySize
          ? await getDirectorySize(filePath, options)
          : Number(stats.size || 0),
      isDirectory,
      isFile: stats.isFile()
    }
  } catch {
    return {
      exists: false,
      size: 0,
      isDirectory: false,
      isFile: false
    }
  }
}

function resolveLegacyAssetIdentity(item = {}) {
  const filePath = toSafeText(item.file_path || item.filePath)
  return {
    assetId: toSafeText(item.asset_id || item.assetId) || `legacy:${normalizeFsKey(filePath)}`,
    filePath,
    fileRecordIds: uniqueNumberList(item.file_record_ids),
    downloadRecordIds: uniqueNumberList(item.download_record_ids)
  }
}

function cleanupCompatRecords(item = {}) {
  let fileRecordIds = uniqueNumberList(item.file_record_ids)
  const downloadRecordIds = uniqueNumberList(item.download_record_ids)
  const filePath = toSafeText(item.filePath || item.file_path)

  if (!fileRecordIds.length && filePath) {
    const fileKey = normalizeFsKey(filePath)
    fileRecordIds = getAllFileRecordsDB()
      .filter((record) => normalizeFsKey(record?.file_path) === fileKey)
      .map((record) => record.id)
  }

  fileRecordIds.forEach((id) => {
    deleteFileRecordById(id)
  })
  downloadRecordIds.forEach((id) => {
    deleteDownloadRecordById(id)
  })

  if (!downloadRecordIds.length && filePath) {
    deleteDownloadRecordsByFilePath(filePath)
  }
}

async function buildPlanItemFromAsset(asset = {}, options = {}) {
  const filePath = toSafeText(asset.file_path || asset.filePath)
  const stats = await getPathStats(filePath, { includeDirectorySize: true })
  const ownerList = listManagedFileAssetOwners(asset.asset_id)
  const managedMode = toSafeText(asset.managed_mode || asset.managedMode) || 'referenced'
  const canDeleteByMode = DELETABLE_MANAGED_MODES.has(managedMode)
  const canDeleteByOwner = ownerList.length === 0 || options.force === true
  const canDeleteByPolicy =
    options.force === true ||
    [DELETE_WITH_OWNER_POLICY, DEFAULT_DELETE_POLICY, 'manual_only'].includes(
      toSafeText(asset.delete_policy || asset.deletePolicy)
    )
  const boundary = await assertSafeDeletePath(filePath, {
    rootPath: options.rootPath,
    storageRootPath: asset.storage_root_path
  })
  let hasRegisteredChildren = false
  if (stats.isDirectory) {
    const childAssets = listManagedFileAssets({ states: ['active', 'delete_failed', 'missing', 'orphaned'] })
      .filter((item) => {
        const childPath = toSafeText(item.file_path)
        return (
          toSafeText(item.asset_id) !== toSafeText(asset.asset_id) &&
          isPathInsideByText(childPath, filePath)
        )
      })
      .slice(0, 3)
    hasRegisteredChildren = childAssets.length > 0
  }
  const skipReasons = buildManagedAssetDeleteSkipReasons({
    missing: !stats.exists,
    ignored: toSafeText(asset.state) === 'ignored',
    canDeleteByMode,
    canDeleteByOwner,
    canDeleteByPolicy,
    boundaryAllowed: boundary.allowed,
    boundaryMissing: boundary.missing,
    boundaryReason: boundary.reason,
    hasRegisteredChildren
  })
  if (isProtectedThunderstoreProfilePath(filePath)) {
    skipReasons.push('Thunderstore Profile 目录只能在模组管理中操作')
  }

  return {
    assetId: toSafeText(asset.asset_id || asset.assetId),
    filePath,
    assetType: toSafeText(asset.asset_type || asset.assetType),
    assetTypeLabel: getAssetTypeLabel(asset.asset_type || asset.assetType),
    sourcePlatform: toSafeText(asset.source_platform || asset.sourcePlatform),
    gameId: toSafeText(asset.game_id || asset.gameId),
    steamAppId: toSafeText(asset.steam_app_id || asset.steamAppId),
    profileName: toSafeText(asset.profile_name || asset.profileName),
    storageRootType: toSafeText(asset.storage_root_type || asset.storageRootType),
    storageRootPath: toSafeText(asset.storage_root_path || asset.storageRootPath),
    managedMode,
    state: toSafeText(asset.state) || 'active',
    stateLabel: getStateLabel(asset.state),
    deletePolicy: toSafeText(asset.delete_policy || asset.deletePolicy),
    deleteError: toSafeText(asset.delete_error || asset.deleteError),
    updatedAt: toSafeText(asset.updated_at || asset.updatedAt),
    createdAt: toSafeText(asset.created_at || asset.createdAt),
    deletedAt: toSafeText(asset.deleted_at || asset.deletedAt),
    sizeBytes: stats.size || toSafeNumber(asset.size_bytes),
    ownerCount: ownerList.length,
    owners: ownerList,
    canDelete: skipReasons.length === 0,
    missing: !stats.exists,
    isDirectory: stats.isDirectory,
    isFile: stats.isFile,
    displayName: path.basename(filePath) || filePath,
    skipReasons
  }
}

async function buildPlanItemFromLegacy(item = {}, options = {}) {
  const identity = resolveLegacyAssetIdentity(item)
  const stats = await getPathStats(identity.filePath)
  const existingAsset = getManagedFileAssetByPath(identity.filePath)
  if (existingAsset) {
    return {
      ...(await buildPlanItemFromAsset(existingAsset, options)),
      file_record_ids: identity.fileRecordIds,
      download_record_ids: identity.downloadRecordIds,
      legacyItem: item
    }
  }

  const storageRootPath = resolveStorageRootPath(identity.filePath, options.rootPath)
  const managedMode = resolveManagedMode(identity.filePath, options.rootPath)
  const boundary = await assertSafeDeletePath(identity.filePath, {
    rootPath: options.rootPath,
    storageRootPath
  })
  const hasCompatRecord = identity.fileRecordIds.length > 0 || identity.downloadRecordIds.length > 0
  const skipReasons = []

  if (!stats.exists) skipReasons.push('文件不存在')
  if (!hasCompatRecord && managedMode === 'referenced') skipReasons.push('未登记的外部扫描文件不会删除')
  if (!boundary.allowed && !boundary.missing) skipReasons.push(boundary.reason)
  if (isProtectedThunderstoreProfilePath(identity.filePath)) {
    skipReasons.push('Thunderstore Profile 目录只能在模组管理中操作')
  }

  return {
    assetId: identity.assetId,
    filePath: identity.filePath,
    assetType: hasCompatRecord ? 'download' : 'orphaned',
    assetTypeLabel: getAssetTypeLabel(hasCompatRecord ? 'download' : 'orphaned'),
    managedMode,
    state: stats.exists ? 'active' : 'missing',
    stateLabel: getStateLabel(stats.exists ? 'active' : 'missing'),
    sizeBytes: stats.size,
    ownerCount: 0,
    owners: [],
    canDelete: skipReasons.length === 0,
    missing: !stats.exists,
    isDirectory: stats.isDirectory,
    isFile: stats.isFile,
    displayName: path.basename(identity.filePath) || identity.filePath,
    skipReasons,
    file_record_ids: identity.fileRecordIds,
    download_record_ids: identity.downloadRecordIds,
    legacyItem: item
  }
}

function summarizeDeletePlan(items = []) {
  const deletableItems = items.filter((item) => item.canDelete)
  const skippedItems = items.filter((item) => !item.canDelete)
  return {
    totalCount: items.length,
    deletableCount: deletableItems.length,
    skippedCount: skippedItems.length,
    releasableBytes: deletableItems.reduce((sum, item) => sum + toSafeNumber(item.sizeBytes), 0)
  }
}

async function removePlannedPath(item = {}) {
  const filePath = toSafeText(item.filePath)
  if (isProtectedThunderstoreProfilePath(filePath)) {
    throw new Error('Thunderstore Profile 目录只能在模组管理中操作')
  }
  const stats = await getPathStats(filePath)
  if (!stats.exists) {
    return { success: true, missing: true, type: 'missing' }
  }
  if (stats.isDirectory) {
    const childAssets = listManagedFileAssets({ states: ['active', 'delete_failed', 'missing', 'orphaned'] })
      .filter((asset) => {
        const assetPath = toSafeText(asset.file_path)
        return toSafeText(asset.asset_id) !== toSafeText(item.assetId) && isPathInsideByText(assetPath, filePath)
      })
      .slice(0, 1)
    if (childAssets.length) {
      throw new Error('目录下仍有其他登记资产，已阻止删除父目录')
    }
  }
  if (stats.isDirectory) {
    await fs.remove(filePath)
    return { success: true, type: 'directory' }
  }
  await fs.unlink(filePath)
  return { success: true, type: 'file' }
}

export async function registerAsset(asset = {}, owner = null) {
  ensureManagedFileAssetTables()
  const filePath = toSafeText(asset.file_path || asset.filePath)
  if (!filePath) {
    throw new Error('缺少资产文件路径')
  }

  const stats = await getPathStats(filePath)
  const rootPath = toSafeText(asset.rootPath || asset.storage_root_path || asset.storageRootPath)
  const managedMode = resolveManagedMode(filePath, rootPath, asset.managed_mode || asset.managedMode)
  const savedAsset = upsertManagedFileAsset({
    ...asset,
    file_path: filePath,
    size_bytes: asset.size_bytes ?? asset.sizeBytes ?? stats.size,
    storage_root_type: asset.storage_root_type || asset.storageRootType || resolveStorageRootType(filePath, rootPath),
    storage_root_path: asset.storage_root_path || asset.storageRootPath || resolveStorageRootPath(filePath, rootPath),
    managed_mode: managedMode,
    delete_policy:
      asset.delete_policy ||
      asset.deletePolicy ||
      (managedMode === 'referenced' ? 'manual_only' : DEFAULT_DELETE_POLICY),
    state: stats.exists ? 'active' : 'missing'
  })

  if (owner && typeof owner === 'object') {
    linkManagedFileAssetOwner(savedAsset.asset_id, owner)
  }
  return getManagedFileAssetById(savedAsset.asset_id)
}

export async function registerModSourceAssetForInstalledMod(mod = {}, source = {}) {
  const modId = toSafeText(mod.id || source.ownerId)
  const filePath = toSafeText(source.filePath || source.file_path)
  if (!modId || !filePath) {
    return null
  }

  return await registerAsset(
    {
      asset_type: 'mod_source',
      source_platform: toSafeText(mod.source || source.sourcePlatform) || 'vertex',
      game_id: toSafeText(mod.game_id || source.gameId),
      steam_app_id: toSafeText(source.steamAppId || source.appid),
      profile_name: toSafeText(mod.profile_name || source.profileName),
      file_path: filePath,
      size_bytes: source.sizeBytes ?? source.fileSize,
      hash_md5: source.md5 || source.fileMd5 || mod.file_md5,
      rootPath: source.rootPath,
      delete_policy: DELETE_WITH_OWNER_POLICY
    },
    {
      ownerType: 'mod',
      ownerId: modId,
      relationType: 'source'
    }
  )
}

export async function previewDeleteAssets(query = {}, options = {}) {
  ensureManagedFileAssetTables()
  const targetOptions = {
    ...options,
    rootPath: toSafeText(options.rootPath || query.rootPath)
  }
  const planItems = []
  const assetIds = uniqueTextList(query.assetIds || query.asset_ids || [])
  const legacyItems = Array.isArray(query.legacyItems) ? query.legacyItems : []

  for (const assetId of assetIds) {
    const asset = getManagedFileAssetById(assetId)
    if (asset) {
      planItems.push(await buildPlanItemFromAsset(asset, targetOptions))
    }
  }

  for (const item of legacyItems) {
    planItems.push(await buildPlanItemFromLegacy(item, targetOptions))
  }

  if (query.includeAllLegacy === true) {
    const fileRecords = getAllFileRecordsDB()
    const downloadRecords = getAllDownloadRecordsDB()
    const recordMap = new Map()
    const upsertLegacy = (record = {}, recordType = '') => {
      const filePath = toSafeText(record.file_path || record.filePath)
      if (!filePath) return
      const key = normalizeFsKey(filePath)
      const existing = recordMap.get(key) || { file_path: filePath }
      if (recordType === 'files') {
        existing.file_record_ids = uniqueNumberList([...(existing.file_record_ids || []), record.id])
      }
      if (recordType === 'download') {
        existing.download_record_ids = uniqueNumberList([
          ...(existing.download_record_ids || []),
          record.id
        ])
      }
      recordMap.set(key, existing)
    }
    fileRecords.forEach((item) => upsertLegacy(item, 'files'))
    downloadRecords.forEach((item) => upsertLegacy(item, 'download'))
    for (const item of recordMap.values()) {
      planItems.push(await buildPlanItemFromLegacy(item, targetOptions))
    }
  }

  const planId = `plan:${Date.now()}:${Math.random().toString(16).slice(2)}`
  return {
    success: true,
    planId,
    items: planItems,
    ...summarizeDeletePlan(planItems)
  }
}

export async function deleteAssets(query = {}, options = {}) {
  const plan = query.items ? { items: query.items } : await previewDeleteAssets(query, options)
  const results = []

  for (const item of plan.items || []) {
    if (!item.canDelete) {
      results.push({
        ...item,
        success: false,
        skipped: true,
        message: item.skipReasons?.join('；') || '已跳过'
      })
      continue
    }

    const realAsset = getManagedFileAssetById(item.assetId)
    if (realAsset) {
      updateManagedFileAssetState(realAsset.asset_id, 'deleting')
    }

    try {
      const removeResult = await removePlannedPath(item)
      cleanupCompatRecords(item)
      const missingAtDelete = item.missing || removeResult?.missing === true
      if (realAsset) {
        if (missingAtDelete) {
          deleteManagedFileAssetById(realAsset.asset_id)
        } else {
          updateManagedFileAssetState(realAsset.asset_id, 'deleted')
        }
      }
      results.push({
        ...item,
        success: true,
        message: missingAtDelete ? '文件已不存在，记录已清理' : '删除成功'
      })
    } catch (error) {
      if (realAsset) {
        updateManagedFileAssetState(realAsset.asset_id, 'delete_failed', error?.message || '删除失败')
      }
      results.push({
        ...item,
        success: false,
        message: error?.message || '删除失败'
      })
    }
  }

  const deletedItems = results.filter((item) => item.success)
  const failedItems = results.filter((item) => !item.success && !item.skipped)
  const skippedItems = results.filter((item) => item.skipped)
  return {
    success: failedItems.length === 0,
    results,
    deletedCount: deletedItems.length,
    failedCount: failedItems.length,
    skippedCount: skippedItems.length,
    releasedBytes: deletedItems.reduce((sum, item) => sum + toSafeNumber(item.sizeBytes), 0)
  }
}

export async function releaseOwner(owner = {}, options = {}) {
  const ownerRows = deleteManagedFileAssetOwnersByOwner(owner)
  const assetIds = uniqueTextList(ownerRows.map((row) => row.asset_id))
  const releasedAssets = []

  for (const assetId of assetIds) {
    const asset = getManagedFileAssetById(assetId)
    if (!asset) continue
    const owners = listManagedFileAssetOwners(assetId)
    if (owners.length > 0) {
      releasedAssets.push({ assetId, deleted: false, reason: '仍被其他 owner 引用' })
      continue
    }

    const policy = toSafeText(asset.delete_policy)
    if (policy !== DELETE_WITH_OWNER_POLICY && options.deleteUnused !== true) {
      releasedAssets.push({ assetId, deleted: false, reason: '清理策略未要求随 owner 删除' })
      continue
    }

    const result = await deleteAssets(
      {
        assetIds: [assetId]
      },
      {
        ...options,
        force: false
      }
    )
    releasedAssets.push({
      assetId,
      deleted: result.deletedCount > 0,
      result
    })
  }

  return {
    success: true,
    releasedOwnerCount: ownerRows.length,
    releasedAssets
  }
}

export async function listAssets(query = {}) {
  ensureManagedFileAssetTables()
  const assets = listManagedFileAssets(query)
  const items = []

  for (const asset of assets) {
    items.push(await buildPlanItemFromAsset(asset, { rootPath: query.rootPath }))
  }

  return {
    success: true,
    items,
    totalCount: items.length
  }
}

function createEmptyCategory(key = '', label = '') {
  return {
    key,
    label: label || getAssetTypeLabel(key),
    count: 0,
    totalBytes: 0,
    reclaimableBytes: 0
  }
}

export async function getStats(query = {}) {
  const { items } = await listAssets(query)
  const categories = {
    all: createEmptyCategory('all', '总占用'),
    reclaimable: createEmptyCategory('reclaimable', '可清理'),
    download: createEmptyCategory('download'),
    mod_source: createEmptyCategory('mod_source'),
    temp: createEmptyCategory('temp'),
    orphaned: createEmptyCategory('orphaned')
  }
  const states = {}

  for (const item of items) {
    const sizeBytes = toSafeNumber(item.sizeBytes)
    const assetType = toSafeText(item.assetType) || 'download'
    const state = toSafeText(item.state) || 'active'

    categories.all.count += 1
    categories.all.totalBytes += sizeBytes
    if (item.canDelete) {
      categories.reclaimable.count += 1
      categories.reclaimable.totalBytes += sizeBytes
      categories.reclaimable.reclaimableBytes += sizeBytes
    }

    if (!categories[assetType]) {
      categories[assetType] = createEmptyCategory(assetType)
    }
    categories[assetType].count += 1
    categories[assetType].totalBytes += sizeBytes
    if (item.canDelete) {
      categories[assetType].reclaimableBytes += sizeBytes
    }

    if (!states[state]) {
      states[state] = {
        key: state,
        label: getStateLabel(state),
        count: 0,
        totalBytes: 0
      }
    }
    states[state].count += 1
    states[state].totalBytes += sizeBytes
  }

  return {
    success: true,
    totalCount: items.length,
    totalBytes: categories.all.totalBytes,
    reclaimableBytes: categories.reclaimable.reclaimableBytes,
    categories: Object.values(categories),
    states: Object.values(states)
  }
}

async function collectOrphanScanRoots(options = {}) {
  const roots = []
  const append = (value = '') => {
    const safeValue = toSafeText(value)
    if (!safeValue || isDangerousRootPath(safeValue) || isOrphanScanExcludedDirectory(safeValue)) return
    roots.push(safeValue)
  }

  const downloadRoot = toSafeText(options.rootPath || getDownloadRootFromStore())
  append(downloadRoot)
  append(getManagedFileRootPath(downloadRoot))
  append(getManagedModSourceRootPath(downloadRoot))

  if (downloadRoot) {
    const parsedRoot = path.parse(path.resolve(downloadRoot)).root
    getSameDriveDownloadCacheScopeRoots(parsedRoot).forEach(append)
  }

  const existingRoots = listManagedFileAssets({
    states: ['active', 'delete_failed', 'missing', 'orphaned']
  }).map((asset) => asset.storage_root_path)
  existingRoots.forEach(append)

  const result = []
  for (const root of uniqueTextList(roots)) {
    try {
      if (await fs.pathExists(root)) {
        result.push(await realpathOrResolved(root))
      }
    } catch {
      // ignore unreadable roots
    }
  }
  return uniqueTextList(result)
}

async function scanFilesUnderRoot(rootPath = '', options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles || 3000) || 3000)
  const result = []
  const stack = [rootPath]

  while (stack.length && result.length < maxFiles) {
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
        if (
          !isOrphanScanExcludedDirectory(fullPath) &&
          !isProtectedThunderstoreProfilePath(fullPath)
        ) {
          stack.push(fullPath)
        }
        continue
      }
      if (!entry.isFile()) continue

      try {
        const stats = await fs.stat(fullPath)
        result.push({
          filePath: fullPath,
          rootPath,
          sizeBytes: Number(stats.size || 0),
          updatedAt: stats.mtime.toISOString(),
          assetType: isTemporaryFile(fullPath) ? 'temp' : 'orphaned'
        })
      } catch {
        // ignore unreadable files
      }

      if (result.length >= maxFiles) break
    }
  }

  return result
}

export async function scanOrphans(options = {}) {
  ensureManagedFileAssetTables()
  const roots = await collectOrphanScanRoots(options)
  const knownPathSet = new Set(
    [
      ...listManagedFileAssets({ states: ['active', 'delete_failed', 'missing', 'orphaned', 'ignored'] }).map(
        (item) => item.file_path
      ),
      ...getAllFileRecordsDB().map((item) => item.file_path),
      ...getAllDownloadRecordsDB().map((item) => item.file_path)
    ]
      .map(normalizeFsKey)
      .filter(Boolean)
  )
  const foundItems = []

  for (const root of roots) {
    const files = await scanFilesUnderRoot(root, options)
    for (const file of files) {
      const key = normalizeFsKey(file.filePath)
      if (!key || knownPathSet.has(key)) continue
      knownPathSet.add(key)
      foundItems.push(file)
    }
  }

  const registeredItems = []
  if (options.register !== false) {
    for (const item of foundItems) {
      const asset = await registerAsset({
        asset_type: item.assetType,
        source_platform: 'vertex',
        file_path: item.filePath,
        size_bytes: item.sizeBytes,
        storage_root_path: item.rootPath,
        managed_mode: resolveManagedMode(item.filePath, item.rootPath),
        delete_policy: DEFAULT_DELETE_POLICY,
        state: 'orphaned'
      })
      registeredItems.push(asset)
    }
  }

  return {
    success: true,
    roots,
    foundCount: foundItems.length,
    registeredCount: registeredItems.length,
    items: registeredItems.length ? (await listAssets({ states: ['orphaned', 'delete_failed'] })).items : foundItems
  }
}

export async function reconcileAssets(query = {}) {
  ensureManagedFileAssetTables()
  const assets = listManagedFileAssets({
    ...query,
    states: query.states || ['active', 'delete_failed', 'missing', 'orphaned', 'ignored']
  })
  const results = []

  for (const asset of assets) {
    const stats = await getPathStats(asset.file_path, { includeDirectorySize: true })
    const owners = listManagedFileAssetOwners(asset.asset_id)
    let nextState = toSafeText(asset.state) || 'active'
    let deleteError = toSafeText(asset.delete_error)

    if (!stats.exists) {
      nextState = 'missing'
      deleteError = ''
    } else if (nextState === 'missing') {
      nextState = owners.length ? 'active' : 'orphaned'
    } else if (
      owners.length === 0 &&
      nextState === 'active' &&
      toSafeText(asset.managed_mode) !== 'referenced' &&
      toSafeText(asset.delete_policy) !== 'manual_only'
    ) {
      nextState = 'orphaned'
    }

    const updated = upsertManagedFileAsset({
      ...asset,
      size_bytes: stats.exists ? stats.size : 0,
      state: nextState,
      delete_error: deleteError
    })

    results.push({
      assetId: asset.asset_id,
      previousState: asset.state,
      state: updated?.state || nextState,
      exists: stats.exists,
      ownerCount: owners.length
    })
  }

  return {
    success: true,
    reconciledCount: results.length,
    results
  }
}

export async function markAssets(payload = {}) {
  const assetIds = uniqueTextList(payload.assetIds || payload.asset_ids || [])
  const state = toSafeText(payload.state)
  const allowedStates = new Set(['active', 'missing', 'orphaned', 'ignored'])
  if (!assetIds.length || !allowedStates.has(state)) {
    return {
      success: false,
      message: '缺少资产或状态不允许'
    }
  }

  const results = assetIds.map((assetId) => updateManagedFileAssetState(assetId, state, ''))
  return {
    success: true,
    updatedCount: results.filter(Boolean).length,
    results
  }
}

export async function cleanupTaskResiduals(payload = {}) {
  const residualPaths = uniqueTextList(payload.paths || payload.residualPaths || [])
  const results = []

  for (const residualPath of residualPaths) {
    if (isProtectedThunderstoreProfilePath(residualPath)) {
      results.push({
        path: residualPath,
        success: false,
        skipped: true,
        message: 'Thunderstore Profile 目录只能在模组管理中操作'
      })
      continue
    }
    const boundary = await assertSafeDeletePath(residualPath, {
      rootPath: payload.rootPath,
      storageRootPath: payload.storageRootPath
    })

    if (!boundary.allowed) {
      results.push({
        path: residualPath,
        success: false,
        skipped: true,
        message: boundary.reason || '路径不在允许清理范围'
      })
      continue
    }

    try {
      await fs.remove(residualPath)
      results.push({ path: residualPath, success: true, message: '清理成功' })
    } catch (error) {
      results.push({
        path: residualPath,
        success: false,
        message: error?.message || '清理失败'
      })
    }
  }

  return {
    success: results.every((item) => item.success || item.skipped),
    results,
    cleanedCount: results.filter((item) => item.success).length,
    skippedCount: results.filter((item) => item.skipped).length
  }
}

export async function retryDeleteFailed(options = {}) {
  const failedAssets = listManagedFileAssets({ states: ['delete_failed'] })
  return await deleteAssets(
    {
      assetIds: failedAssets.map((item) => item.asset_id)
    },
    options
  )
}
