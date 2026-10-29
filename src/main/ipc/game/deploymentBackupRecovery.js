import fs from 'fs-extra'
import path from 'node:path'
import { isRealPathInside } from './install-engine/pathSafety.js'

function toText(value = '') {
  return String(value || '').trim()
}

function toId(value = 0) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function buildBackupEntrySummary(backupEntry = {}, payload = {}) {
  const backupPathText = toText(backupEntry.backup_path || backupEntry.backupPath)
  const targetPathText = toText(backupEntry.target_path || backupEntry.targetPath)
  return {
    status: toText(payload.status),
    code: toText(payload.code),
    message: toText(payload.message),
    id: toId(backupEntry.id),
    targetPath: targetPathText ? path.resolve(targetPathText) : '',
    backupPath: backupPathText ? path.resolve(backupPathText) : '',
    modId: toId(backupEntry.mod_id ?? backupEntry.modId),
    fileHash: toText(payload.fileHash)
  }
}

export async function purgeUnreferencedDeploymentBackupSessions(
  backupRoot = '',
  preservedDirectoryNames = []
) {
  const backupRootText = toText(backupRoot)
  if (!backupRootText) return { purgedCount: 0, failures: [] }
  const safeBackupRoot = path.resolve(backupRootText)
  const preservedNames = new Set(
    (Array.isArray(preservedDirectoryNames) ? preservedDirectoryNames : [])
      .map((name) => path.basename(toText(name)).toLowerCase())
      .filter(Boolean)
  )
  if (!(await fs.pathExists(safeBackupRoot))) {
    return { purgedCount: 0, failures: [] }
  }

  const failures = []
  let purgedCount = 0
  const entries = await fs.readdir(safeBackupRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || preservedNames.has(entry.name.toLowerCase())) continue
    const entryPath = path.join(safeBackupRoot, entry.name)
    try {
      await fs.remove(entryPath)
      purgedCount += 1
    } catch (error) {
      failures.push({ path: entryPath, error: String(error?.message || error) })
    }
  }

  return { purgedCount, failures }
}

export async function restoreDeploymentBackupEntry(backupEntry = {}, options = {}) {
  const backupPathText = toText(backupEntry.backup_path || backupEntry.backupPath)
  const targetPathText = toText(backupEntry.target_path || backupEntry.targetPath)
  const backupPath = backupPathText ? path.resolve(backupPathText) : ''
  const targetPath = targetPathText ? path.resolve(targetPathText) : ''
  const boundaryRoot = toText(
    options.boundaryRoot || backupEntry.boundaryRoot || backupEntry.targetBoundaryRoot
  )

  if (boundaryRoot && targetPath && !isRealPathInside(path.resolve(boundaryRoot), targetPath)) {
    throw new Error(`部署目标越界，已阻止恢复：${targetPath}`)
  }
  if (!backupPath || !targetPath || !(await fs.pathExists(backupPath))) {
    return {
      status: 'missing',
      code: 'deploy_backup_missing',
      message: `覆盖备份不存在，已跳过恢复: ${backupPath}`,
      id: toId(backupEntry.id),
      targetPath,
      backupPath,
      targetBoundaryRoot: boundaryRoot,
      modId: toId(backupEntry.mod_id ?? backupEntry.modId)
    }
  }

  await fs.ensureDir(path.dirname(targetPath))
  const removeTarget =
    typeof options.removeTarget === 'function'
      ? options.removeTarget
      : async (currentTargetPath) => fs.remove(currentTargetPath)
  const copyBackup =
    typeof options.copyBackup === 'function'
      ? options.copyBackup
      : async (sourcePath, currentTargetPath) =>
          fs.copy(sourcePath, currentTargetPath, {
            overwrite: true,
            errorOnExist: false,
            dereference: false
          })

  await removeTarget(targetPath, { boundaryRoot })
  await copyBackup(backupPath, targetPath, {
    targetType: toText(backupEntry.targetType || 'file'),
    boundaryRoot
  })

  return {
    status: 'restored',
    id: toId(backupEntry.id),
    targetPath,
    backupPath,
    targetBoundaryRoot: boundaryRoot,
    modId: toId(backupEntry.mod_id ?? backupEntry.modId)
  }
}

export async function restoreLatestAvailableDeploymentBackup(backupEntries = [], options = {}) {
  const missingEntries = []
  const skippedEntries = []
  const restoreEntry =
    typeof options.restoreEntry === 'function'
      ? options.restoreEntry
      : (entry) => restoreDeploymentBackupEntry(entry, options)
  const removedOwnerModId = toId(options.removedOwnerModId)
  const removedOwnerFileHash = toText(options.removedOwnerFileHash).toLowerCase()
  const getBackupFileHash =
    typeof options.getBackupFileHash === 'function' ? options.getBackupFileHash : null

  for (const backupEntry of Array.isArray(backupEntries) ? backupEntries : []) {
    if (
      toText(backupEntry.restorePolicy).toLowerCase() !== 'restore_preexisting' &&
      removedOwnerModId &&
      toId(backupEntry.mod_id ?? backupEntry.modId) === removedOwnerModId &&
      removedOwnerFileHash &&
      getBackupFileHash &&
      toText(backupEntry.targetType || 'file').toLowerCase() === 'file'
    ) {
      let backupFileHash = ''
      try {
        backupFileHash = toText(await getBackupFileHash(backupEntry)).toLowerCase()
      } catch {
        // 无法读取时交给正式恢复路径返回缺失或权限错误，不能静默跳过。
      }
      if (backupFileHash && backupFileHash === removedOwnerFileHash) {
        skippedEntries.push(
          buildBackupEntrySummary(backupEntry, {
            status: 'skipped',
            code: 'deploy_backup_legacy_adopted_target',
            message: '旧版覆盖备份属于当前模组接管的同内容目标，已跳过恢复',
            fileHash: backupFileHash
          })
        )
        continue
      }
    }

    const result = await restoreEntry(backupEntry)
    if (result?.status === 'missing') {
      missingEntries.push(result)
      continue
    }
    return { status: 'restored', restoredEntry: result, missingEntries, skippedEntries }
  }

  return {
    status: skippedEntries.length ? 'skipped' : 'missing',
    restoredEntry: null,
    missingEntries,
    skippedEntries
  }
}
