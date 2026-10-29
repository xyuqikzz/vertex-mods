import fs from 'fs-extra'
import crypto from 'crypto'
import path from 'path'
import { open as openFile } from 'node:fs/promises'
import dbInstance from '../../db/dbInstance.js'
import {
  copyPathByNodeApi,
  deployFileByNodeApi,
  generateFileSHA256ByNodeApi,
  removePathByNodeApi
} from '../../api/file/index.js'
import { StagingManager } from '../../utils/stagingManager.js'
import {
  createModDeployTransaction,
  getModDeployScopeById,
  isUnifiedDeploySource,
  listModRecordsByDeployScope,
  markDeployScopeReconciled,
  updateModDeployTransaction
} from '../../db/mods/modDeployment.js'
import { normalizeStoredInstallRulePlan } from './installRulePlatform.js'
import { isRealPathInside } from './install-engine/pathSafety.js'
import {
  createSourceStagingUnreadableError,
  resolveDeploymentManifestEntries
} from './deploymentManifestResolver.js'
import {
  restoreLatestAvailableDeploymentBackup,
  restoreDeploymentBackupEntry
} from './deploymentBackupRecovery.js'
import {
  resolveExistingTargetDisposition,
  shouldRemoveTargetDuringRollback
} from './deploymentTargetOwnership.js'
import { withDeploymentScopeMutationLocks } from './deploymentScopeMutationLock.js'
import { normalizeDeploymentPath } from '../../utils/deploymentPathIdentity.js'
import { requiresIndependentDeployment } from './deploymentFilePolicy.js'
import { assertManagedConfigDeploymentAllowed } from './install-engine/managedConfigJournal.js'
import { lockModSource, unlockModSource } from '../../services/modSourceFileLock.js'
import {
  createDeploymentJournal, checkpointDeploymentJournal, listPendingDeploymentJournals, readDeploymentJournalSession,
  DEPLOYMENT_BACKUP_RETENTION_MS
} from './deploymentJournal.js'

const DEPLOY_METHODS = ['hardlink', 'symlink', 'copy']

function toSafeText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function parseJsonObject(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  const text = toSafeText(value)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringifyJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

function normalizeRelativePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

function normalizeRelativeKey(value = '') {
  return normalizeRelativePath(value).toLowerCase()
}

function normalizePathKey(value = '') {
  return normalizeDeploymentPath(value)
}

function isPathInsideOrEqual(parentPath = '', childPath = '') {
  const safeParentPath = path.resolve(toSafeText(parentPath))
  const safeChildPath = path.resolve(toSafeText(childPath))
  if (!safeParentPath || !safeChildPath) return false

  const relativePath = path.relative(safeParentPath, safeChildPath)
  return !relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function assertPathInsideBoundary(
  targetPath = '',
  boundaryRoot = '',
  message = '部署目标越界，已阻止操作'
) {
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const safeBoundaryRoot = toSafeText(boundaryRoot) ? path.resolve(toSafeText(boundaryRoot)) : ''
  if (safeBoundaryRoot && !isRealPathInside(safeBoundaryRoot, safeTargetPath)) {
    throw new Error(`${message}：${safeTargetPath}`)
  }
  return safeTargetPath
}

function assertTargetInsideRoot(targetPath = '', boundaryRoot = '') {
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (!toSafeText(boundaryRoot)) throw new Error('部署目标缺少可信边界，已停止操作')
  const targetRoot = path.resolve(boundaryRoot)
  assertPathInsideBoundary(safeTargetPath, targetRoot)
  return targetRoot
}

function normalizeDeployScope(scope = {}) {
  const target = scope && typeof scope === 'object' ? scope : {}
  return {
    gameId: toSafeNumber(target.gameId ?? target.game_id, 0),
    source: toSafeText(target.source).toLowerCase(),
    endpointType: toSafeNumber(target.endpointType ?? target.endpoint_type, 0),
    deployDomain: toSafeText(target.deployDomain ?? target.deploy_domain)
  }
}

function getInstalledAtValue(record = {}) {
  const installedAt = Date.parse(toSafeText(record.installed_at))
  if (Number.isFinite(installedAt)) return installedAt
  const createdAt = Date.parse(toSafeText(record.created_at))
  return Number.isFinite(createdAt) ? createdAt : toSafeNumber(record.id, 0)
}

function compareModPriority(a = {}, b = {}) {
  if (!!a.enabled !== !!b.enabled) return a.enabled ? 1 : -1
  const sortDiff = toSafeNumber(a.sort, 0) - toSafeNumber(b.sort, 0)
  if (sortDiff !== 0) return sortDiff
  const installedAtDiff = toSafeNumber(a.installedAt, 0) - toSafeNumber(b.installedAt, 0)
  if (installedAtDiff !== 0) return installedAtDiff
  return toSafeNumber(a.modId, 0) - toSafeNumber(b.modId, 0)
}

function createTaskId(prefix = 'deploy') {
  if (typeof crypto.randomUUID === 'function') return `${prefix}:${crypto.randomUUID()}`
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

function formatInstallMethodLabel(method = '') {
  const normalizedMethod = toSafeText(method).toLowerCase()
  if (normalizedMethod === 'hardlink') return '硬链接'
  if (normalizedMethod === 'symlink') return '符号链接'
  if (normalizedMethod === 'copy') return '复制'
  return normalizedMethod || ''
}

function logDeployment(level = 'info', message = '', detail = {}) {
  const payload = {
    gameId: detail.gameId,
    modId: detail.modId,
    sourcePlatform: detail.sourcePlatform || detail.source,
    taskType: detail.taskType,
    sort: detail.sort,
    enabled: detail.enabled,
    targetPath: detail.targetPath,
    installMethod: detail.installMethod,
    installMethodLabel: detail.installMethodLabel || formatInstallMethodLabel(detail.installMethod),
    fallbackReason: detail.fallbackReason,
    backupPath: detail.backupPath,
    sessionId: detail.sessionId
  }
  const compactPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== '')
  )
  const logArgs = ['[安全部署]', message, compactPayload]
  if (level === 'error') console.error(...logArgs)
  else if (level === 'warn') console.warn(...logArgs)
  else console.log(...logArgs)
}

function resolveRecordDeployPaths(record = {}) {
  const metadata = parseJsonObject(record.metadata_json)
  return {
    stagingPath: toSafeText(metadata.stagingPath || record.staging_path),
    targetPath: toSafeText(metadata.targetPath || record.target_path),
    storageContext:
      metadata.storageContext && typeof metadata.storageContext === 'object'
        ? metadata.storageContext
        : {}
  }
}

function loadPersistedManifestRows(scope = {}, modId = 0) {
  const safeModId = toSafeNumber(modId, 0)
  if (!safeModId || !dbInstance.tableExists('mod_file_manifest')) return []

  return dbInstance.all(
    `SELECT mod_id, game_id, source, endpoint_type, deploy_domain, source_path,
            target_relative_path, target_path, file_hash, file_size, deploy_method,
            source_type, metadata_json
     FROM mod_file_manifest
     WHERE mod_id = ?
       AND game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
     ORDER BY target_relative_path ASC, id ASC`,
    [safeModId, scope.gameId, scope.endpointType, scope.deployDomain]
  )
}

function serializeSourceStagingError(error) {
  if (toSafeText(error?.code) !== 'source_staging_unreadable') return {}
  return {
    code: 'source_staging_unreadable',
    stage: toSafeText(error?.stage),
    modId: toSafeNumber(error?.modId, 0),
    modName: toSafeText(error?.modName),
    sourcePath: toSafeText(error?.sourcePath),
    systemError:
      error?.systemError && typeof error.systemError === 'object' ? error.systemError : {}
  }
}

async function assertDeploymentSourceReadable(entry = {}, records = []) {
  if (toSafeText(entry.targetType || 'file').toLowerCase() === 'dir') return
  const sourcePath = path.resolve(toSafeText(entry.sourcePath))
  let fileHandle = null
  try {
    fileHandle = await openFile(sourcePath, 'r')
  } catch (error) {
    const record = records.find(
      (item) => toSafeNumber(item?.id, 0) === toSafeNumber(entry?.winnerModId, 0)
    )
    throw createSourceStagingUnreadableError({
      record: record || { id: entry?.winnerModId, name: entry?.modName },
      sourcePath,
      stage: 'source_deploy_read',
      error
    })
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}

function sanitizePathSegment(value = '') {
  const safeValue = Array.from(toSafeText(value))
    .map((char) => {
      const charCode = char.charCodeAt(0)
      return charCode < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char
    })
    .join('')
    .replace(/\.+$/g, '')
  return safeValue || '_'
}

function resolveStorageRoot(records = [], fieldName = '', fallbackFactory = null) {
  for (const record of records) {
    const { storageContext } = resolveRecordDeployPaths(record)
    const targetRoot = toSafeText(storageContext?.[fieldName])
    if (targetRoot) return path.resolve(targetRoot)
  }
  return typeof fallbackFactory === 'function' ? fallbackFactory() : ''
}

function resolveSessionRoot(scope = {}, records = [], plan = [], type = 'backup') {
  const fieldName = type === 'deployment' ? 'deploymentRoot' : 'backupRoot'
  const fallback = () => {
    const firstTarget =
      toSafeText(plan?.[0]?.targetPath) ||
      toSafeText(resolveRecordDeployPaths(records?.[0] || {}).targetPath) ||
      process.cwd()
    return path.join(
      StagingManager.getWorkspaceRootPath(firstTarget),
      type === 'deployment' ? 'deployment' : 'backup',
      String(scope.gameId || 'unknown')
    )
  }
  return resolveStorageRoot(records, fieldName, fallback)
}

async function calculateFileHash(filePath = '') {
  try {
    return await generateFileSHA256ByNodeApi(filePath)
  } catch (error) {
    console.warn('[安全部署] 原生 SHA256 计算失败，回退到 JS 流式计算', {
      filePath,
      error: String(error?.message || error)
    })
  }

  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function collectStagingFileEntries(stagingPath, targetPath) {
  const entries = []
  const safeStagingPath = path.resolve(toSafeText(stagingPath))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (!safeStagingPath || !safeTargetPath) return entries

  try {
    const nativeManifest = await StagingManager.buildManifest(safeStagingPath, {
      targetPath: safeTargetPath
    })
    if (nativeManifest?.success !== false && Array.isArray(nativeManifest?.entries)) {
      return nativeManifest.entries
        .map((entry) => ({
          sourcePath: toSafeText(entry?.sourcePath),
          targetRelativePath: normalizeRelativePath(entry?.targetRelativePath),
          targetPath: toSafeText(entry?.targetPath),
          fileSize: toSafeNumber(entry?.fileSize, 0)
        }))
        .filter((entry) => entry.sourcePath && entry.targetRelativePath && entry.targetPath)
    }
  } catch (error) {
    console.warn('[安全部署] 原生 manifest 构建失败，回退到 JS 扫描', error)
  }

  async function walkDirectory(currentPath) {
    const children = await fs.readdir(currentPath, { withFileTypes: true })
    for (const child of children) {
      const childPath = path.join(currentPath, child.name)
      if (child.isDirectory()) {
        await walkDirectory(childPath)
        continue
      }
      if (!child.isFile()) continue

      const stat = await fs.stat(childPath)
      const relativePath = normalizeRelativePath(path.relative(safeStagingPath, childPath))
      if (!relativePath) continue

      entries.push({
        sourcePath: childPath,
        targetRelativePath: relativePath,
        targetPath: path.join(safeTargetPath, relativePath),
        fileSize: toSafeNumber(stat?.size, 0)
      })
    }
  }

  await walkDirectory(safeStagingPath)
  return entries
}

function normalizePlanOperationKind(operation = {}) {
  const kind = toSafeText(operation.kind).toLowerCase()
  const type = toSafeText(operation.type || operation.action).toLowerCase()
  return kind === 'dir' || type === 'mkdir' ? 'dir' : 'file'
}

function resolvePlanOperationRelativePath(operation = {}, targetPath = '', targetRoot = '') {
  const declaredRelativePath = normalizeRelativePath(
    operation.relativeTargetPath || operation.relativePath || operation.relative || ''
  )
  if (declaredRelativePath) return declaredRelativePath

  const safeTargetRoot = path.resolve(toSafeText(targetRoot))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (safeTargetRoot && isPathInsideOrEqual(safeTargetRoot, safeTargetPath)) {
    return normalizeRelativePath(path.relative(safeTargetRoot, safeTargetPath))
  }
  return normalizeRelativePath(path.basename(safeTargetPath))
}

async function collectPlannedOperationEntries(record = {}, stagingPath = '', targetPath = '') {
  const metadata = parseJsonObject(record.metadata_json)
  const plan = normalizeStoredInstallRulePlan(metadata)
  const operations = Array.isArray(plan.operations) ? plan.operations : []
  if (!operations.length) return []

  const safeStagingPath = path.resolve(toSafeText(stagingPath))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const entries = []

  for (const operation of operations) {
    const sourcePath = path.resolve(toSafeText(operation?.sourcePath || operation?.source))
    const operationTargetPath = path.resolve(toSafeText(operation?.targetPath || operation?.target))
    const targetRelativePath = resolvePlanOperationRelativePath(
      operation,
      operationTargetPath,
      safeTargetPath
    )
    const targetType = normalizePlanOperationKind(operation)

    if (!sourcePath || !operationTargetPath || !targetRelativePath) continue
    if (!isPathInsideOrEqual(safeStagingPath, sourcePath)) continue
    if (!isPathInsideOrEqual(safeTargetPath, operationTargetPath)) continue

    const sourceStat = await fs.stat(sourcePath).catch(() => null)
    if (targetType === 'dir') {
      if (!sourceStat?.isDirectory()) continue
      entries.push({
        sourcePath,
        targetRelativePath,
        targetPath: operationTargetPath,
        fileSize: 0,
        fileHash: '',
        targetType
      })
      continue
    }

    if (!sourceStat?.isFile()) continue
    entries.push({
      sourcePath,
      targetRelativePath,
      targetPath: operationTargetPath,
      fileSize: toSafeNumber(sourceStat.size, 0),
      fileHash: await calculateFileHash(sourcePath),
      targetType
    })
  }

  return entries
}

async function buildManifestRowsForRecord(scope = {}, record = {}, options = {}) {
  const { stagingPath, targetPath } = resolveRecordDeployPaths(record)
  const recordId = toSafeNumber(record.id, 0)
  if (!recordId || !stagingPath || !targetPath) {
    return { record, entries: [], skippedReason: 'missing_deploy_path' }
  }

  const source = toSafeText(record.source)
  const sort = toSafeNumber(record.priority_order, 0)
  const installedAt = getInstalledAtValue(record)
  const enabled = toSafeNumber(record.is_active ?? record.install_state, 1) === 1
  const entries = []
  const definitionHash = crypto.createHash('sha256').update(stringifyJson(
    normalizeStoredInstallRulePlan(parseJsonObject(record.metadata_json))
  )).digest('hex')
  const persistedRows = loadPersistedManifestRows(scope, recordId)
  const definitionMatches = persistedRows.every((row) =>
    parseJsonObject(row.metadata_json).definitionHash === definitionHash)
  const manifestResult = await resolveDeploymentManifestEntries({
    scope,
    record,
    stagingPath,
    targetPath,
    persistedRows: !options.full && definitionMatches ? persistedRows : [],
    scanManifest: async () => {
      if (!(await fs.pathExists(stagingPath))) {
        throw createSourceStagingUnreadableError({ record, sourcePath: stagingPath,
          stage: 'source_manifest_scan', error: Object.assign(new Error('暂存源目录不存在'), { code: 'ENOENT' }) })
      }
      const plannedEntries = await collectPlannedOperationEntries(record, stagingPath, targetPath)
      return plannedEntries.length
        ? plannedEntries
        : await collectStagingFileEntries(stagingPath, targetPath)
    }
  })
  const stagingEntries = manifestResult.entries

  for (const entry of stagingEntries) {
    const sourcePath = path.resolve(entry.sourcePath)
    const targetRelativePath = normalizeRelativePath(entry.targetRelativePath)
    if (
      !targetRelativePath ||
      (manifestResult.reused !== true && !(await fs.pathExists(sourcePath)))
    ) {
      continue
    }

    const targetType =
      toSafeText(entry.targetType || 'file').toLowerCase() === 'dir' ? 'dir' : 'file'
    const fileHash =
      targetType === 'dir'
        ? toSafeText(entry.fileHash)
        : toSafeText(entry.fileHash) || (await calculateFileHash(sourcePath))
    entries.push({
      modId: recordId,
      gameId: scope.gameId,
      source,
      endpointType: scope.endpointType,
      deployDomain: scope.deployDomain,
      sourcePath,
      targetRelativePath,
      targetRelativeKey: normalizeRelativeKey(targetRelativePath),
      targetPath: path.resolve(entry.targetPath),
      targetBoundaryRoot: path.resolve(targetPath),
      fileSize: toSafeNumber(entry.fileSize, 0),
      fileHash,
      definitionHash,
      targetType,
      enabled,
      sort,
      installedAt,
      record
    })
  }

  return { record, entries }
}

export async function buildFileOwnerIndex(scope = {}, options = {}) {
  const normalizedScope = normalizeDeployScope(scope)
  const activeRecords = listModRecordsByDeployScope(normalizedScope, {
    activeOnly: true,
    order: 'deploy'
  })
  const ownerIndex = new Map()
  const manifestRows = []
  const skipped = []

  for (const record of activeRecords) {
    const result = await buildManifestRowsForRecord(normalizedScope, record, options)
    if (result.skippedReason) {
      skipped.push({
        id: toSafeNumber(record.id, 0),
        reason: result.skippedReason,
        stagingPath: resolveRecordDeployPaths(record).stagingPath
      })
      continue
    }

    for (const entry of result.entries) {
      manifestRows.push(entry)
      // 关键：按归一化后的绝对 target_path 建索引。
      // 单纯按 targetRelativeKey 去重会漏一种情况：两个 mod 的 target_root 不同
      // （比如 A 装到 `…\Win64`、相对路径 `ue4ss/Mods/X/main.lua`；
      // B 装到 `…\Win64\ue4ss\Mods`、相对路径 `X/main.lua`），
      // JS Map 视作两个 key，但它们落到同一物理文件，
      // 后续 rebuildDeployLedger 会 INSERT 两次 mod_file_owners 触发 UNIQUE 冲突，
      // 整个 reconcile 事务回滚 → 当前安装项整体失败。
      const ownerKey = normalizePathKey(entry.targetPath)
      if (!ownerIndex.has(ownerKey)) ownerIndex.set(ownerKey, [])
      ownerIndex.get(ownerKey).push(entry)
    }
  }

  return { scope: normalizedScope, records: activeRecords, ownerIndex, manifestRows, skipped }
}

export async function buildDeploymentPlan(scope = {}, options = {}) {
  const indexResult = await buildFileOwnerIndex(scope, options)
  const plan = []

  for (const candidates of indexResult.ownerIndex.values()) {
    const winner = [...candidates].sort(compareModPriority).at(-1)
    if (!winner) continue
    plan.push({
      targetRelativePath: winner.targetRelativePath,
      targetRelativeKey: winner.targetRelativeKey,
      targetPath: winner.targetPath,
      targetBoundaryRoot: winner.targetBoundaryRoot,
      winnerModId: winner.modId,
      sourcePath: winner.sourcePath,
      sourcePlatform: winner.source,
      installMethod: 'copy',
      fileHash: winner.fileHash,
      fileSize: winner.fileSize,
      targetType: winner.targetType || 'file',
      sort: winner.sort,
      enabled: winner.enabled,
      installedAt: winner.installedAt
    })
  }

  plan.sort((left, right) => left.targetRelativeKey.localeCompare(right.targetRelativeKey))
  return { ...indexResult, plan }
}

function isSameVolume(sourcePath = '', targetPath = '') {
  const sourceRoot = toSafeText(path.parse(path.resolve(sourcePath)).root).toLowerCase()
  const targetRoot = toSafeText(path.parse(path.resolve(targetPath)).root).toLowerCase()
  return !!sourceRoot && sourceRoot === targetRoot
}

async function removeProbePath(probePath = '') {
  try {
    if (probePath && (await fs.pathExists(probePath))) await fs.remove(probePath)
  } catch {
    // 探测文件清理失败不影响后续部署，下一轮会使用新随机路径。
  }
}

export async function canUseHardlink(sourcePath, targetPath, env = {}) {
  if (env.allowLink === false || env.forceCopy === true) return false
  const safeSourcePath = path.resolve(toSafeText(sourcePath))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (!isSameVolume(safeSourcePath, safeTargetPath)) return false

  const sourceStat = await fs.stat(safeSourcePath).catch(() => null)
  if (!sourceStat?.isFile()) return false

  const targetParent = path.dirname(safeTargetPath)
  await fs.ensureDir(targetParent)
  const probePath = path.join(
    targetParent,
    `.vertex-hardlink-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )

  try {
    await fs.link(safeSourcePath, probePath)
    return true
  } catch (error) {
    logDeployment('warn', '硬链接能力探测失败，准备降级', {
      targetPath: safeTargetPath,
      fallbackReason: String(error?.message || error)
    })
    return false
  } finally {
    await removeProbePath(probePath)
  }
}

export async function canUseSymlink(sourcePath, targetPath, env = {}) {
  if (env.allowLink === false || env.allowSymlink === false || env.forceCopy === true) {
    return false
  }
  const safeSourcePath = path.resolve(toSafeText(sourcePath))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const sourceStat = await fs.stat(safeSourcePath).catch(() => null)
  if (!sourceStat?.isFile()) return false

  const targetParent = path.dirname(safeTargetPath)
  await fs.ensureDir(targetParent)
  const probePath = path.join(
    targetParent,
    `.vertex-symlink-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )

  try {
    await fs.symlink(safeSourcePath, probePath, 'file')
    return true
  } catch (error) {
    logDeployment('warn', '符号链接能力探测失败，准备降级', {
      targetPath: safeTargetPath,
      fallbackReason: String(error?.message || error)
    })
    return false
  } finally {
    await removeProbePath(probePath)
  }
}

export async function resolveInstallMethod(sourcePath, targetPath, env = {}) {
  if (await canUseHardlink(sourcePath, targetPath, env)) return 'hardlink'
  if (await canUseSymlink(sourcePath, targetPath, env)) return 'symlink'
  return 'copy'
}

function resolveInstallMethodUnavailableReason(
  method = '',
  sourcePath = '',
  targetPath = '',
  env = {}
) {
  if (method === 'hardlink') {
    if (env.allowLink === false || env.forceCopy === true) return '链接部署已被配置禁用'
    if (!isSameVolume(sourcePath, targetPath)) return '源文件与目标文件不在同一盘符，不能使用硬链接'
    return '硬链接能力不可用'
  }
  if (method === 'symlink') {
    if (env.allowLink === false || env.allowSymlink === false || env.forceCopy === true) {
      return '符号链接部署已被配置禁用'
    }
    return '符号链接能力不可用'
  }
  if (method === 'copy') return '复制部署能力不可用'
  return '部署能力不可用'
}

function normalizeDeployFallbackReasons(value = [], fallbackReason = '') {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        from: toSafeText(item?.from),
        to: toSafeText(item?.to),
        reason: toSafeText(item?.reason)
      }))
      .filter((item) => item.from || item.to || item.reason)
  }

  const safeFallbackReason = toSafeText(fallbackReason)
  return safeFallbackReason
    ? [
        {
          from: '',
          to: '',
          reason: safeFallbackReason
        }
      ]
    : []
}

function buildSkippedDeployFallbackReasons(actualMethod = '', sourcePath = '', targetPath = '', env = {}) {
  const actualIndex = DEPLOY_METHODS.indexOf(toSafeText(actualMethod))
  if (actualIndex <= 0) return []
  return DEPLOY_METHODS.slice(0, actualIndex).map((method, index) => ({
    from: method,
    to: DEPLOY_METHODS[index + 1] || actualMethod,
    reason: resolveInstallMethodUnavailableReason(method, sourcePath, targetPath, env)
  }))
}

function summarizeDeployMethods(plan = []) {
  return (Array.isArray(plan) ? plan : [])
    .filter((entry) => toSafeText(entry.installMethod))
    .map((entry) => ({
      targetRelativePath: toSafeText(entry.targetRelativePath),
      targetPath: toSafeText(entry.targetPath),
      method: toSafeText(entry.installMethod),
      policy: toSafeText(entry.deploymentPolicy),
      fallbackReason: toSafeText(entry.installMethodFallbackReason),
      fallbackReasons: Array.isArray(entry.installMethodFallbackReasons)
        ? entry.installMethodFallbackReasons
        : []
    }))
}

async function applyInstallMethod(method, sourcePath, targetPath) {
  if (method === 'hardlink') {
    await fs.link(sourcePath, targetPath)
    return
  }
  if (method === 'symlink') {
    await fs.symlink(sourcePath, targetPath, 'file')
    return
  }
  await fs.copyFile(sourcePath, targetPath)
}

async function writeDeploymentEntry(entry = {}, session = {}, env = {}) {
  const sourcePath = path.resolve(toSafeText(entry.sourcePath))
  const targetPath = path.resolve(toSafeText(entry.targetPath))
  entry.deploymentPolicy = requiresIndependentDeployment(targetPath) ? 'independent_copy' : ''
  env = { ...env, forceCopy: env.forceCopy === true || requiresIndependentDeployment(targetPath) }
  const targetBoundaryRoot = toSafeText(entry.targetBoundaryRoot || entry.boundaryRoot)
  assertPathInsideBoundary(targetPath, targetBoundaryRoot, '部署目标越界，已阻止写入')
  await fs.ensureDir(path.dirname(targetPath))

  if (toSafeText(entry.targetType || 'file').toLowerCase() === 'dir') {
    await fs.ensureDir(targetPath)
    logDeployment('info', '目录部署完成', {
      gameId: session.gameId,
      modId: entry.winnerModId,
      sourcePlatform: entry.sourcePlatform,
      sort: entry.sort,
      enabled: entry.enabled,
      targetPath,
      installMethod: 'mkdir',
      sessionId: session.sessionId
    })
    return 'mkdir'
  }

  if (env.nativeDeploy !== false) {
    try {
      const nativeResult = await deployFileByNodeApi(sourcePath, targetPath, {
        allowLink: env.allowLink !== false,
        allowSymlink: env.allowSymlink !== false,
        forceCopy: env.forceCopy === true
      })
      const method = toSafeText(nativeResult?.method || 'copy')
      if (entry.deploymentPolicy && method !== 'copy') throw new Error('配置文件必须独立复制')
      const nativeReasons = normalizeDeployFallbackReasons(nativeResult?.fallbackReasons, nativeResult?.fallbackReason)
      const fallbackReasons = entry.deploymentPolicy ? [] : nativeReasons.length
        ? nativeReasons : buildSkippedDeployFallbackReasons(method, sourcePath, targetPath, env)
      entry.installMethodFallbackReasons = fallbackReasons
      entry.installMethodFallbackReason = fallbackReasons[0]?.reason || ''
      logDeployment('info', `原生文件部署完成（${formatInstallMethodLabel(method)}）`, {
        gameId: session.gameId,
        modId: entry.winnerModId,
        sourcePlatform: entry.sourcePlatform,
        sort: entry.sort,
        enabled: entry.enabled,
        targetPath,
        installMethod: method,
        fallbackReason: nativeResult?.fallbackReason,
        sessionId: session.sessionId
      })
      return method
    } catch (error) {
      logDeployment('warn', '原生文件部署失败，回退到 JS 部署链路', {
        gameId: session.gameId,
        modId: entry.winnerModId,
        sourcePlatform: entry.sourcePlatform,
        sort: entry.sort,
        enabled: entry.enabled,
        targetPath,
        fallbackReason: String(error?.message || error),
        sessionId: session.sessionId
      })
      await removeTargetIfExists(targetPath, { boundaryRoot: targetBoundaryRoot })
    }
  }

  // 直接尝试实际部署，不为每个文件再创建一次探测链接。
  const methodList = env.forceCopy || env.allowLink === false
    ? ['copy']
    : [...(isSameVolume(sourcePath, targetPath) ? ['hardlink'] : []),
      ...(env.allowSymlink !== false ? ['symlink'] : []), 'copy']
  const preferredMethod = methodList[0]
  let lastError = null
  const fallbackReasons = entry.deploymentPolicy ? [] : buildSkippedDeployFallbackReasons(preferredMethod, sourcePath, targetPath, env)

  for (let index = 0; index < methodList.length; index += 1) {
    const method = methodList[index]
    try {
      await applyInstallMethod(method, sourcePath, targetPath)
      entry.installMethodFallbackReasons = fallbackReasons
      entry.installMethodFallbackReason = fallbackReasons[0]?.reason || ''
      logDeployment('info', `文件部署完成（${formatInstallMethodLabel(method)}）`, {
        gameId: session.gameId,
        modId: entry.winnerModId,
        sourcePlatform: entry.sourcePlatform,
        sort: entry.sort,
        enabled: entry.enabled,
        targetPath,
        installMethod: method,
        fallbackReason: entry.installMethodFallbackReason,
        sessionId: session.sessionId
      })
      return method
    } catch (error) {
      lastError = error
      const fallbackReason = String(error?.message || error)
      fallbackReasons.push({
        from: method,
        to: methodList[index + 1] || 'failed',
        reason: fallbackReason
      })
      logDeployment('warn', '部署方式失败，准备尝试下一种方式', {
        gameId: session.gameId,
        modId: entry.winnerModId,
        sourcePlatform: entry.sourcePlatform,
        sort: entry.sort,
        enabled: entry.enabled,
        targetPath,
        installMethod: method,
        fallbackReason,
        sessionId: session.sessionId
      })
      if (await fs.pathExists(targetPath)) {
        await removeTargetIfExists(targetPath, { boundaryRoot: targetBoundaryRoot }).catch(() => {})
      }
    }
  }

  throw lastError || new Error('所有部署方式均失败')
}

function buildBackupPath(backupRoot = '', sessionId = '', targetPath = '', relativePath = '') {
  const relativeSegments = normalizeRelativePath(relativePath || path.basename(targetPath))
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizePathSegment(segment))
  if (!relativeSegments.length) {
    relativeSegments.push(sanitizePathSegment(path.basename(targetPath) || 'target'))
  }
  const targetKey = crypto.createHash('sha256').update(normalizePathKey(targetPath)).digest('hex')
  return path.join(backupRoot, sanitizePathSegment(sessionId), targetKey, ...relativeSegments)
}

async function getPathType(targetPath = '') {
  const stat = await fs.lstat(targetPath).catch(() => null)
  if (!stat) return ''
  if (stat.isSymbolicLink()) return 'symlink'
  if (stat.isDirectory()) return 'directory'
  if (stat.isFile()) return 'file'
  return 'other'
}

export async function backupTargetBeforeReplace(gameId, targetPath, sessionId, options = {}) {
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const boundaryRoot = toSafeText(options.boundaryRoot || options.targetBoundaryRoot)
  assertPathInsideBoundary(safeTargetPath, boundaryRoot, '部署目标越界，已阻止备份')
  if (!(await fs.pathExists(safeTargetPath))) return null

  const backupRoot = path.resolve(toSafeText(options.backupRoot || process.cwd()))
  const backupPath = buildBackupPath(
    backupRoot,
    sessionId,
    safeTargetPath,
    options.relativePath || ''
  )
  await fs.ensureDir(path.dirname(backupPath))
  const targetType = await getPathType(safeTargetPath)
  try {
    if (targetType !== 'file') {
      throw new Error(`非普通文件备份继续使用 JS 复制链路: ${targetType || 'unknown'}`)
    }
    await copyPathByNodeApi(safeTargetPath, backupPath)
  } catch (error) {
    logDeployment('warn', '原生备份复制失败，回退到 JS 复制链路', {
      gameId,
      targetPath: safeTargetPath,
      backupPath,
      fallbackReason: String(error?.message || error),
      sessionId
    })
    await fs.copy(safeTargetPath, backupPath, {
      overwrite: true,
      errorOnExist: false,
      dereference: false
    })
  }

  const backupEntry = {
    gameId: toSafeNumber(gameId, 0),
    agentTaskId: toSafeText(options.agentTaskId || options.agent_task_id),
    endpointType: toSafeNumber(options.endpointType, 0),
    deployDomain: toSafeText(options.deployDomain),
    modId: toSafeNumber(options.modId, 0),
    targetPath: safeTargetPath,
    backupPath,
    boundaryRoot: boundaryRoot ? path.resolve(boundaryRoot) : '',
    reason: toSafeText(options.reason || 'replace'),
    restorePolicy: toSafeText(options.restorePolicy),
    targetType,
    createdAt: Date.now(),
    sessionId
  }
  if (targetType === 'file') {
    const handle = await openFile(backupPath, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    backupEntry.fileHash = await calculateFileHash(backupPath)
  }

  logDeployment('info', '已完成覆盖前备份', {
    gameId: backupEntry.gameId,
    modId: backupEntry.modId,
    targetPath: safeTargetPath,
    backupPath,
    sessionId,
    fallbackReason: backupEntry.reason
  })
  return backupEntry
}

function loadCurrentOwnerRows(scope = {}) {
  if (!dbInstance.tableExists('mod_file_owners')) return []
  return dbInstance.all(
    `SELECT *
     FROM mod_file_owners
     WHERE game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
     ORDER BY target_relative_path ASC`,
    [scope.gameId, scope.endpointType, scope.deployDomain]
  )
}

async function targetFingerprint(targetPath) {
  const stat = await fs.lstat(targetPath).catch(() => null)
  // Never treat a redirected path as a previously verified regular file.
  if (!stat?.isFile()) return ''
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.nlink].join(':')
}

async function detachLegacyConfiguration(entry, owner, session, records, backupRoot, checkpoint) {
  if (!owner || !requiresIndependentDeployment(entry.targetPath)) return false
  const metadata = parseJsonObject(owner.metadata_json)
  const sourcePath = toSafeText(metadata.sourcePath)
  if (!sourcePath || Number(owner.owner_mod_id) !== Number(entry.winnerModId) ||
      normalizePathKey(sourcePath) !== normalizePathKey(entry.sourcePath)) return false
  const link = await fs.lstat(entry.targetPath).catch(() => null)
  if (!link || (!link.isSymbolicLink() && link.nlink <= 1)) return false
  const [target, source] = await Promise.all([
    fs.stat(entry.targetPath).catch(() => null), fs.stat(sourcePath).catch(() => null)
  ])
  if (!target?.isFile() || !source?.isFile() || !source.ino || source.dev !== target.dev || source.ino !== target.ino ||
      !(target.nlink > 1 || link?.isSymbolicLink())) return false
  const record = records.find((item) => Number(item.id) === Number(entry.winnerModId))
  const root = toSafeText(entry.targetBoundaryRoot)
  if (!root || !isPathInsideOrEqual(root, entry.targetPath)) throw new Error('配置文件迁移缺少可信边界')
  // The final link is known to point at this mod's staging file; all parent directories must stay in the target root.
  assertPathInsideBoundary(path.dirname(entry.targetPath), root)
  const protectedSource = ['locked', 'repair_required', 'lock_failed'].includes(record?.source_lock_state)
  if (protectedSource) {
    const unlocked = await unlockModSource(record)
    if (!unlocked?.success) throw new Error('无法解除旧配置硬链接的源文件保护，请修复源文件权限后重试')
  }
  const temporary = `${entry.targetPath}.${crypto.randomUUID()}.detach`
  let failure = null
  try {
    const hash = await calculateFileHash(entry.targetPath)
    const backupPath = buildBackupPath(backupRoot, session.sessionId, entry.targetPath, entry.targetRelativePath)
    await fs.ensureDir(path.dirname(backupPath))
    await fs.copyFile(entry.targetPath, backupPath)
    const handle = await openFile(backupPath, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    if (await calculateFileHash(backupPath) !== hash) throw new Error('配置文件在迁移期间发生变化')
    session.backupEntries.push({ gameId: session.gameId, endpointType: record.endpoint_type,
      deployDomain: record.deploy_domain, modId: entry.winnerModId, sessionId: session.sessionId,
      agentTaskId: session.agentTaskId, targetPath: entry.targetPath, backupPath,
      boundaryRoot: root, reason: 'detach_configuration', restorePolicy: 'rollback_only',
      targetType: 'file', fileHash: hash, createdAt: Date.now() })
    session.appliedEntries.push({ ...entry, fileHash: hash, action: 'replace' })
    checkpoint()
    await fs.copyFile(backupPath, temporary)
    await fs.chmod(temporary, 0o666)
    await fs.rename(temporary, entry.targetPath)
    entry.installMethod = 'copy'
    entry.deploymentPolicy = 'independent_copy'
    entry.installMethodFallbackReasons = []
    entry.installMethodFallbackReason = ''
    entry.targetFingerprint = await targetFingerprint(entry.targetPath)
    checkpoint()
  } catch (error) {
    failure = error
  } finally {
    try { await fs.remove(temporary) } catch (error) { failure ||= error }
    if (protectedSource) {
      try {
        const locked = await lockModSource(record)
        if (!locked?.success) {
          failure ||= new Error('旧配置已拆分，但源文件保护恢复失败，请修复源文件权限')
          failure.needRecovery = true
          if (dbInstance.tableExists('mods')) dbInstance.run("UPDATE mods SET source_lock_state = 'repair_required' WHERE id = ?", [record.id])
        }
      } catch (error) {
        failure ||= error
        failure.needRecovery = true
      }
    }
  }
  if (failure) throw failure
  return true
}

async function isCurrentTargetSame(entry = {}, currentOwner = null, options = {}) {
  if (!currentOwner) return false
  if (toSafeNumber(currentOwner.owner_mod_id, 0) !== toSafeNumber(entry.winnerModId, 0)) {
    return false
  }

  const metadata = parseJsonObject(currentOwner.metadata_json)
  if (normalizePathKey(metadata.sourcePath) !== normalizePathKey(entry.sourcePath)) return false
  if (toSafeText(currentOwner.file_hash) !== toSafeText(entry.fileHash)) return false
  if (!(await fs.pathExists(entry.targetPath))) return false

  if (toSafeText(entry.targetType || 'file').toLowerCase() === 'dir') {
    const targetStat = await fs.stat(entry.targetPath).catch(() => null)
    return targetStat?.isDirectory() === true
  }

  try {
    const before = await targetFingerprint(entry.targetPath)
    entry.targetFingerprint = before
    if (before && requiresIndependentDeployment(entry.targetPath) &&
        (await fs.lstat(entry.targetPath)).nlink === 1) return true
    if (options.incremental && before && metadata.targetFingerprint === before) return true
    const targetHash = await calculateFileHash(entry.targetPath)
    const after = await targetFingerprint(entry.targetPath)
    entry.targetFingerprint = after
    if (before !== after) throw new Error('部署目标在校验期间发生变化')
    return targetHash === entry.fileHash
  } catch {
    return false
  }
}

async function removeTargetIfExists(targetPath = '', options = {}) {
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const boundaryRoot = toSafeText(options.boundaryRoot || options.targetBoundaryRoot)
  assertPathInsideBoundary(safeTargetPath, boundaryRoot, '部署目标越界，已阻止删除')
  if (!(await fs.pathExists(safeTargetPath))) return

  try {
    await removePathByNodeApi(safeTargetPath)
  } catch (error) {
    logDeployment('warn', '原生路径删除失败，回退到 JS 删除链路', {
      targetPath: safeTargetPath,
      fallbackReason: String(error?.message || error)
    })
    await fs.remove(safeTargetPath)
  }
}

async function cleanupEmptyParentDirs(targetPath = '', stopRoot = '') {
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const safeStopRoot = path.resolve(toSafeText(stopRoot || path.parse(safeTargetPath).root))
  const removedDirectories = []
  let currentPath = path.dirname(safeTargetPath)

  while (
    currentPath &&
    normalizePathKey(currentPath) !== normalizePathKey(safeStopRoot) &&
    isPathInsideOrEqual(safeStopRoot, currentPath)
  ) {
    if (!isRealPathInside(safeStopRoot, currentPath)) break
    const stat = await fs.stat(currentPath).catch(() => null)
    if (!stat || !stat.isDirectory()) break

    const childList = await fs.readdir(currentPath).catch(() => null)
    if (!Array.isArray(childList) || childList.length > 0) break

    await fs.rmdir(currentPath)
    removedDirectories.push(currentPath)

    const parentPath = path.dirname(currentPath)
    if (!parentPath || parentPath === currentPath) break
    currentPath = parentPath
  }

  return removedDirectories
}

function loadRestoreBackupsForTarget(scope = {}, targetPath = '') {
  if (!dbInstance.tableExists('mod_deploy_backup_entries')) return []

  const safeTargetPath = path.resolve(toSafeText(targetPath))
  const rows = dbInstance.all(
    `SELECT *
     FROM mod_deploy_backup_entries
     WHERE game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
       AND target_path = ?
       AND state = 'active'
       AND reason = 'overwrite'
     ORDER BY id DESC`,
    [scope.gameId, scope.endpointType, scope.deployDomain, safeTargetPath]
  )
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const metadata = parseJsonObject(row.metadata_json)
    return {
      ...row,
      targetType: toSafeText(metadata.targetType || 'file'),
      restorePolicy: toSafeText(metadata.restorePolicy)
    }
  })
}

async function restoreBackupEntryToTarget(scope = {}, backupEntry = {}, session = {}, options = {}) {
  const restoredEntry = await restoreDeploymentBackupEntry(backupEntry, {
    boundaryRoot: options.boundaryRoot,
    removeTarget: removeTargetIfExists,
    copyBackup: async (backupPath, targetPath, copyOptions = {}) => {
      try {
        if (copyOptions.targetType !== 'file') {
          throw new Error(`非普通文件恢复继续使用 JS 复制链路: ${copyOptions.targetType}`)
        }
        await copyPathByNodeApi(backupPath, targetPath)
      } catch (error) {
        logDeployment('warn', '原生覆盖备份恢复失败，回退到 JS 复制链路', {
          gameId: scope.gameId,
          modId: backupEntry.mod_id,
          targetPath,
          backupPath,
          sessionId: session.sessionId,
          fallbackReason: String(error?.message || error)
        })
        await fs.copy(backupPath, targetPath, {
          overwrite: true,
          errorOnExist: false,
          dereference: false
        })
      }
    }
  })

  if (restoredEntry.status === 'missing') return restoredEntry

  logDeployment('info', '已恢复覆盖前文件', {
    gameId: scope.gameId,
    modId: backupEntry.mod_id,
    targetPath: restoredEntry.targetPath,
    backupPath: restoredEntry.backupPath,
    sessionId: session.sessionId
  })

  return restoredEntry
}

export async function rollbackDeploymentSession(scope = {}, session = {}, options = {}) {
  const appliedEntries = Array.isArray(session.appliedEntries) ? session.appliedEntries : []
  const backupEntries = Array.isArray(session.backupEntries) ? session.backupEntries : []
  const completedBackupEntryIds = new Set(
    (Array.isArray(options.completedBackupEntryIds) ? options.completedBackupEntryIds : [])
      .map((id) => Number(id || 0))
      .filter((id) => id > 0)
  )
  const completedBackupTargetKeys = new Set(
    backupEntries
      .filter((entry) => completedBackupEntryIds.has(Number(entry.id || 0)))
      .map((entry) => normalizePathKey(entry.targetPath))
      .filter(Boolean)
  )
  const failures = []
  const protectedTargets = new Set()
  const alreadyRestored = new Set(completedBackupTargetKeys)
  for (const entry of backupEntries) {
    const key = normalizePathKey(entry.targetPath)
    if (alreadyRestored.has(key)) continue
    try {
      if (!await fs.pathExists(entry.backupPath)) throw new Error('恢复备份缺失，已保留当前目标')
      if (entry.fileHash && await calculateFileHash(entry.backupPath) !== entry.fileHash) {
        throw new Error('恢复备份内容已变化，已保留当前目标')
      }
    } catch (error) {
      protectedTargets.add(key)
      failures.push({ stage: 'validate_backup', targetPath: entry.targetPath, message: error.message })
    }
  }
  if (options.protectChanges) {
    for (const entry of appliedEntries) {
      const key = normalizePathKey(entry.targetPath)
      if (protectedTargets.has(key) || alreadyRestored.has(key) || ['adopt', 'ensure_dir'].includes(entry.action)) continue
      try {
        assertTargetInsideRoot(entry.targetPath, entry.targetBoundaryRoot || entry.boundaryRoot)
        const stat = await fs.lstat(entry.targetPath).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (!stat) continue
        const backup = backupEntries.find((item) => normalizePathKey(item.targetPath) === key)
        if (stat.isFile() && !stat.isSymbolicLink()) {
          const hash = await calculateFileHash(entry.targetPath)
          if (backup?.fileHash && hash === backup.fileHash) { alreadyRestored.add(key); continue }
          if (entry.fileHash && hash === entry.fileHash) continue
        } else if (entry.action === 'create' && stat.isDirectory() && !stat.isSymbolicLink() &&
          (await fs.readdir(entry.targetPath)).length === 0) continue
        throw new Error('目标内容与中断时的记录不同，已保留当前文件，需要人工核对')
      } catch (error) {
        protectedTargets.add(key)
        failures.push({ stage: 'target_changed', targetPath: entry.targetPath, message: error.message })
      }
    }
  }

  for (const entry of [...appliedEntries].reverse()) {
    if (!shouldRemoveTargetDuringRollback(entry.action)) continue
    if (alreadyRestored.has(normalizePathKey(entry.targetPath)) || protectedTargets.has(normalizePathKey(entry.targetPath))) continue
    try {
      await removeTargetIfExists(entry.targetPath, {
        boundaryRoot: entry.targetBoundaryRoot || entry.boundaryRoot
      })
    } catch (error) {
      failures.push({
        stage: 'remove_applied_target',
        targetPath: entry.targetPath,
        message: String(error?.message || error)
      })
      logDeployment('error', '回滚时清理新部署文件失败', {
        gameId: scope.gameId,
        modId: entry.winnerModId,
        targetPath: entry.targetPath,
        sessionId: session.sessionId,
        fallbackReason: String(error?.message || error)
      })
    }
  }

  for (const backupEntry of [...backupEntries].reverse()) {
    const backupEntryId = Number(backupEntry.id || 0)
    if (backupEntryId > 0 && completedBackupEntryIds.has(backupEntryId)) continue
    if (alreadyRestored.has(normalizePathKey(backupEntry.targetPath)) || protectedTargets.has(normalizePathKey(backupEntry.targetPath))) continue
    try {
      await fs.ensureDir(path.dirname(backupEntry.targetPath))
      await removeTargetIfExists(backupEntry.targetPath, {
        boundaryRoot: backupEntry.boundaryRoot || backupEntry.targetBoundaryRoot
      })
      try {
        if (backupEntry.targetType !== 'file') {
          throw new Error(
            `非普通文件恢复继续使用 JS 复制链路: ${backupEntry.targetType || 'unknown'}`
          )
        }
        await copyPathByNodeApi(backupEntry.backupPath, backupEntry.targetPath)
      } catch (error) {
        logDeployment('warn', '原生备份恢复失败，回退到 JS 复制链路', {
          gameId: scope.gameId,
          modId: backupEntry.modId,
          targetPath: backupEntry.targetPath,
          backupPath: backupEntry.backupPath,
          sessionId: session.sessionId,
          fallbackReason: String(error?.message || error)
        })
        await fs.copy(backupEntry.backupPath, backupEntry.targetPath, {
          overwrite: true,
          errorOnExist: false,
          dereference: false
        })
      }
      if (typeof options.onBackupEntryRestored === 'function') {
        await options.onBackupEntryRestored(backupEntry)
      }
    } catch (error) {
      failures.push({
        stage: 'restore_backup',
        targetPath: backupEntry.targetPath,
        backupPath: backupEntry.backupPath,
        message: String(error?.message || error)
      })
      logDeployment('error', '回滚时恢复备份失败', {
        gameId: scope.gameId,
        modId: backupEntry.modId,
        targetPath: backupEntry.targetPath,
        backupPath: backupEntry.backupPath,
        sessionId: session.sessionId,
        fallbackReason: String(error?.message || error)
      })
    }
  }
  const result = {
    success: failures.length === 0,
    sessionId: toSafeText(session.sessionId),
    appliedEntryCount: appliedEntries.length,
    backupEntryCount: backupEntries.length,
    failures
  }
  if (failures.length && options.throwOnFailure === true) {
    const error = new Error(`部署 session 回滚存在 ${failures.length} 个文件恢复失败`)
    error.code = 'rollback_file_restore_failed'
    error.stage = 'files_restored'
    error.failures = failures
    throw error
  }
  return result
}

function ensureDeployBackupEntriesTable() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS mod_deploy_backup_entries
    (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT    NOT NULL DEFAULT '',
      game_id        INTEGER NOT NULL DEFAULT 0,
      endpoint_type  INTEGER NOT NULL DEFAULT 0,
      deploy_domain  TEXT    NOT NULL DEFAULT '',
      mod_id         INTEGER NOT NULL DEFAULT 0,
      target_path    TEXT    NOT NULL DEFAULT '',
      backup_path    TEXT    NOT NULL DEFAULT '',
      reason         TEXT    NOT NULL DEFAULT '',
      state          TEXT    NOT NULL DEFAULT 'active',
      metadata_json  TEXT    NOT NULL DEFAULT '{}',
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_session
    ON mod_deploy_backup_entries (session_id, game_id, endpoint_type, deploy_domain);
  `)
}

function rebuildDeployLedger(
  scope = {},
  manifestRows = [],
  plan = [],
  backupEntries = [],
  session = {},
  finalize = () => {}
) {
  if (!dbInstance.tableExists('mod_file_manifest') || !dbInstance.tableExists('mod_file_owners')) {
    throw new Error('部署账本尚未就绪')
  }
  ensureDeployBackupEntriesTable()
  const restoredBackupEntries = Array.isArray(session.restoredBackupEntries)
    ? session.restoredBackupEntries
    : []
  const missingBackupEntries = Array.isArray(session.missingBackupEntries)
    ? session.missingBackupEntries
    : []
  const discardedBackupEntries = Array.isArray(session.discardedBackupEntries)
    ? session.discardedBackupEntries
    : []

  // Diff by physical target identity; stable rows retain their ids and original session metadata.
  const manifestKey = (row) => `${row.mod_id ?? row.modId}:${normalizePathKey(row.target_path ?? row.targetPath)}`
  const oldManifests = dbInstance.all('SELECT * FROM mod_file_manifest WHERE game_id = ? AND endpoint_type = ? AND deploy_domain = ?',
    [scope.gameId, scope.endpointType, scope.deployDomain])
  const oldManifestMap = new Map(oldManifests.map((row) => [manifestKey(row), row]))
  const oldOwners = loadCurrentOwnerRows(scope)
  const oldOwnerMap = new Map(oldOwners.map((row) => [normalizePathKey(row.target_path), row]))
  const manifestKeys = new Set(manifestRows.map(manifestKey))
  const ownerKeys = new Set(plan.map((row) => normalizePathKey(row.targetPath)))
  const comparableMetadata = (value) => {
    const metadata = { ...parseJsonObject(value) }
    delete metadata.sessionId
    delete metadata.sourceLockState
    return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b))))
  }
  const unchanged = (old, columns, values) => old && columns.every((column, index) =>
    column === 'metadata_json' ? comparableMetadata(old[column]) === comparableMetadata(values[index]) :
      String(old[column] ?? '') === String(values[index] ?? ''))
  let manifestWrites = 0
  let ownerWrites = 0

  dbInstance.transaction(() => {
    for (const row of oldManifests) if (!manifestKeys.has(manifestKey(row))) dbInstance.run('DELETE FROM mod_file_manifest WHERE id = ?', [row.id])
    for (const row of oldOwners) if (!ownerKeys.has(normalizePathKey(row.target_path))) dbInstance.run('DELETE FROM mod_file_owners WHERE id = ?', [row.id])

    manifestRows.forEach((row) => {
      const values = [
          row.modId,
          row.gameId,
          row.source,
          row.endpointType,
          row.deployDomain,
          row.sourcePath,
          row.targetRelativePath,
          row.targetPath,
          row.fileHash,
          row.fileSize,
          row.installMethod || 'planned',
          stringifyJson({
            sessionId: session.sessionId,
            manifestVersion: 2,
            manifestComplete: true,
            definitionHash: row.definitionHash,
            stagingRoot: resolveRecordDeployPaths(row.record).stagingPath,
            targetRoot: resolveRecordDeployPaths(row.record).targetPath,
            sourceLockState: toSafeText(row.record?.source_lock_state),
            enabled: row.enabled,
            sort: row.sort,
            installMethodFallbackReason: row.installMethodFallbackReason,
            installMethodFallbackReasons: row.installMethodFallbackReasons,
            installedAt: row.installedAt,
            targetType: row.targetType || 'file'
          })
        ]
      const old = oldManifestMap.get(manifestKey(row))
      const columns = ['mod_id', 'game_id', 'source', 'endpoint_type', 'deploy_domain', 'source_path', 'target_relative_path', 'target_path', 'file_hash', 'file_size', 'deploy_method', 'metadata_json']
      if (unchanged(old, columns, values)) return
      if (old) dbInstance.run('DELETE FROM mod_file_manifest WHERE id = ?', [old.id])
      dbInstance.run(`INSERT INTO mod_file_manifest (${columns.join(',')}, source_type) VALUES (${columns.map(() => '?').join(',')}, 'staging')`, values)
      manifestWrites++
    })

    plan.forEach((row) => {
      const values = [
          scope.gameId,
          scope.endpointType,
          scope.deployDomain,
          row.targetRelativePath,
          row.targetPath,
          normalizePathKey(row.targetPath),
          row.winnerModId,
          row.sort,
          row.fileHash,
          stringifyJson({
            sessionId: session.sessionId,
            sourcePath: row.sourcePath,
            installMethod: row.installMethod,
            deploymentPolicy: row.deploymentPolicy || '',
            installMethodFallbackReason: row.installMethodFallbackReason,
            installMethodFallbackReasons: row.installMethodFallbackReasons,
            sourcePlatform: row.sourcePlatform,
            installedAt: row.installedAt,
            targetType: row.targetType || 'file',
            targetBoundaryRoot: row.targetBoundaryRoot,
            targetFingerprint: row.targetFingerprint || ''
          })
        ]
      const old = oldOwnerMap.get(normalizePathKey(row.targetPath))
      const columns = ['game_id', 'endpoint_type', 'deploy_domain', 'target_relative_path', 'target_path', 'target_path_key', 'owner_mod_id', 'owner_priority_order', 'file_hash', 'metadata_json']
      if (unchanged(old, columns, values)) return
      if (old) dbInstance.run('DELETE FROM mod_file_owners WHERE id = ?', [old.id])
      dbInstance.run(`INSERT INTO mod_file_owners (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values)
      ownerWrites++
    })

    backupEntries.forEach((entry) => {
      dbInstance.run(
        `INSERT INTO mod_deploy_backup_entries (
           session_id, agent_task_id, game_id, endpoint_type, deploy_domain, mod_id,
           target_path, backup_path, reason, state, metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          entry.sessionId,
          entry.agentTaskId,
          entry.gameId,
          entry.endpointType,
          entry.deployDomain,
          entry.modId,
          entry.targetPath,
          entry.backupPath,
          entry.reason,
          stringifyJson({
            targetType: entry.targetType,
            restorePolicy: entry.restorePolicy,
            createdAt: entry.createdAt
          })
        ]
      )
    })

    restoredBackupEntries.forEach((entry) => {
      if (!toSafeNumber(entry.id, 0)) return
      dbInstance.run(
        `UPDATE mod_deploy_backup_entries
         SET state = 'restored',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [toSafeNumber(entry.id, 0)]
      )
    })

    missingBackupEntries.forEach((entry) => {
      if (!toSafeNumber(entry.id, 0)) return
      dbInstance.run(
        `UPDATE mod_deploy_backup_entries
         SET state = 'missing',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [toSafeNumber(entry.id, 0)]
      )
    })

    discardedBackupEntries.forEach((entry) => {
      if (!toSafeNumber(entry.id, 0)) return
      dbInstance.run(
        `UPDATE mod_deploy_backup_entries
         SET state = 'discarded_adopted_target',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [toSafeNumber(entry.id, 0)]
      )
    })
    finalize()
  })

  return {
    success: true,
    manifestCount: manifestRows.length,
    ownerCount: plan.length,
    manifestWrites,
    ownerWrites,
    backupCount: backupEntries.length,
    restoredBackupCount: restoredBackupEntries.length,
    missingBackupCount: missingBackupEntries.length,
    discardedBackupCount: discardedBackupEntries.length
  }
}

async function writeDeploymentSessionFile(
  scope = {},
  records = [],
  plan = [],
  session = {},
  result = {}
) {
  const deploymentRoot = resolveSessionRoot(scope, records, plan, 'deployment')
  await fs.ensureDir(deploymentRoot)
  const deploymentPath = path.join(deploymentRoot, `${sanitizePathSegment(session.sessionId)}.json`)
  await fs.writeJson(
    deploymentPath,
    {
      sessionId: session.sessionId,
      agentTaskId: session.agentTaskId,
      gameId: scope.gameId,
      endpointType: scope.endpointType,
      deployDomain: scope.deployDomain,
      createdAt: session.createdAt,
      status: result.success === false ? 'failed' : 'applied',
      plan,
      backupEntries: session.backupEntries,
      missingBackupEntries: session.missingBackupEntries,
      discardedBackupEntries: session.discardedBackupEntries,
      appliedEntries: session.appliedEntries,
      result
    },
    { spaces: 2 }
  )
  return deploymentPath
}

export async function applyDeploymentPlan(scope = {}, plan = [], context = {}) {
  const normalizedScope = normalizeDeployScope(scope)
  const journalRoot = context.managedConfigJournalRoot ||
    path.join(path.dirname(dbInstance.dbPath), 'install-config-journals')
  const records = Array.isArray(context.records) ? context.records : []
  const session = {
    sessionId: toSafeText(context.sessionId) || createTaskId('deploy'),
    agentTaskId: toSafeText(context.agentTaskId || context.agent_task_id),
    gameId: normalizedScope.gameId,
    transactionId: context.transactionId,
    createdAt: Date.now(),
    backupEntries: [],
    restoredBackupEntries: [],
    missingBackupEntries: [],
    discardedBackupEntries: [],
    appliedEntries: []
  }
  const backupRoot = resolveSessionRoot(normalizedScope, records, plan, 'backup')
  const checkpoint = () => {
    if (context.persistJournal) checkpointDeploymentJournal(dbInstance, session)
  }
  if (context.persistJournal) createDeploymentJournal(dbInstance, normalizedScope, session, backupRoot)
  const boundaryRecords = listModRecordsByDeployScope(normalizedScope, { activeOnly: false })
  const resolveBoundary = (modId) => resolveRecordDeployPaths(
    [...records, ...boundaryRecords].find((record) => Number(record.id) === Number(modId)) || {}
  ).targetPath
  const currentOwnerRows = loadCurrentOwnerRows(normalizedScope)
  const currentOwnerMap = new Map(
    currentOwnerRows.map((row) => [normalizePathKey(row.target_path), row])
  )
  const planMap = new Map(plan.map((entry) => [normalizePathKey(entry.targetPath), entry]))
  let deletedCount = 0
  let replacedCount = 0
  let skippedCount = 0
  let restoredCount = 0
  let missingBackupCount = 0
  let discardedBackupCount = 0
  let cleanupEmptyDirCount = 0

  try {
    for (const ownerRow of currentOwnerRows) {
      if (planMap.has(normalizePathKey(ownerRow.target_path))) continue

      const targetPath = path.resolve(toSafeText(ownerRow.target_path))
      const targetRoot = assertTargetInsideRoot(targetPath,
        parseJsonObject(ownerRow.metadata_json).targetBoundaryRoot || resolveBoundary(ownerRow.owner_mod_id))
      await assertManagedConfigDeploymentAllowed({ journalRoot, target: targetPath, boundary: targetRoot })
      const restoreBackupEntries = loadRestoreBackupsForTarget(normalizedScope, targetPath)
      const backupEntry = await backupTargetBeforeReplace(
        normalizedScope.gameId,
        targetPath,
        session.sessionId,
        {
          backupRoot,
          relativePath: ownerRow.target_relative_path,
          reason: 'delete',
          endpointType: normalizedScope.endpointType,
          deployDomain: normalizedScope.deployDomain,
          agentTaskId: session.agentTaskId,
          modId: toSafeNumber(ownerRow.owner_mod_id, 0),
          boundaryRoot: targetRoot
        }
      )
      if (backupEntry) session.backupEntries.push(backupEntry)
      session.appliedEntries.push({
        targetPath,
        targetBoundaryRoot: targetRoot,
        winnerModId: 0,
        action: 'delete'
      })
      checkpoint()
      await removeTargetIfExists(targetPath, { boundaryRoot: targetRoot })

      let shouldCleanupTargetParents = restoreBackupEntries.length === 0
      if (restoreBackupEntries.length) {
        const recovery = await restoreLatestAvailableDeploymentBackup(restoreBackupEntries, {
          removedOwnerModId: toSafeNumber(ownerRow.owner_mod_id, 0),
          removedOwnerFileHash: toSafeText(ownerRow.file_hash),
          getBackupFileHash: (entry) => calculateFileHash(entry.backup_path || entry.backupPath),
          restoreEntry: async (entry) => {
            const intent = session.appliedEntries.at(-1)
            if (entry.targetType === 'file' && await fs.pathExists(entry.backup_path || entry.backupPath)) {
              intent.fileHash = await calculateFileHash(entry.backup_path || entry.backupPath)
              checkpoint()
            }
            return restoreBackupEntryToTarget(normalizedScope, entry, session, {
              boundaryRoot: targetRoot
            })
          }
        })
        recovery.skippedEntries.forEach((skippedEntry) => {
          session.discardedBackupEntries.push(skippedEntry)
          discardedBackupCount += 1
          logDeployment('info', '旧版同内容目标已由当前模组接管，跳过历史备份恢复', {
            gameId: normalizedScope.gameId,
            modId: skippedEntry.modId,
            targetPath: skippedEntry.targetPath,
            backupPath: skippedEntry.backupPath,
            sessionId: session.sessionId,
            fallbackReason: skippedEntry.code
          })
        })
        recovery.missingEntries.forEach((missingEntry) => {
          session.missingBackupEntries.push(missingEntry)
          missingBackupCount += 1
          logDeployment('warn', '历史覆盖备份已缺失，跳过恢复并继续协调', {
            gameId: normalizedScope.gameId,
            modId: missingEntry.modId,
            targetPath: missingEntry.targetPath,
            backupPath: missingEntry.backupPath,
            sessionId: session.sessionId,
            fallbackReason: missingEntry.code
          })
        })

        if (recovery.restoredEntry) {
          const restoredEntry = recovery.restoredEntry
          session.restoredBackupEntries.push(restoredEntry)
          session.appliedEntries.push({
            targetPath: restoredEntry.targetPath,
            targetBoundaryRoot: restoredEntry.targetBoundaryRoot,
            winnerModId: 0,
            action: 'restore',
            backupEntryId: restoredEntry.id
          })
          restoredCount += 1
        } else {
          shouldCleanupTargetParents = true
        }
      }

      if (shouldCleanupTargetParents) {
        const removedDirectories = await cleanupEmptyParentDirs(targetPath, targetRoot)
        cleanupEmptyDirCount += removedDirectories.length
        removedDirectories.forEach((dirPath) => {
          logDeployment('info', '已清理空目录', {
            gameId: normalizedScope.gameId,
            targetPath: dirPath,
            sessionId: session.sessionId
          })
        })
      }

      deletedCount += 1
    }

    for (const entry of plan) {
      const currentOwner = currentOwnerMap.get(normalizePathKey(entry.targetPath))
      entry.targetBoundaryRoot ||= resolveBoundary(entry.winnerModId)
      if (await detachLegacyConfiguration(entry, currentOwner, session, records, backupRoot, checkpoint)) {
        replacedCount++
        continue
      }
      const targetRoot = assertTargetInsideRoot(entry.targetPath,
        entry.targetBoundaryRoot || resolveBoundary(entry.winnerModId))
      entry.targetBoundaryRoot = targetRoot
      if (await isCurrentTargetSame(entry, currentOwner, { incremental: context.incremental })) {
        const currentMetadata = parseJsonObject(currentOwner.metadata_json)
        entry.installMethod = toSafeText(currentMetadata.installMethod || 'copy')
        entry.deploymentPolicy = toSafeText(currentMetadata.deploymentPolicy)
        entry.installMethodFallbackReason = currentMetadata.installMethodFallbackReason
        entry.installMethodFallbackReasons = currentMetadata.installMethodFallbackReasons
        skippedCount += 1
        continue
      }

      await assertManagedConfigDeploymentAllowed({ journalRoot, target: entry.targetPath, boundary: targetRoot })

      if (currentOwner && !requiresIndependentDeployment(entry.targetPath)) {
        const [targetStat, sourceStat] = await Promise.all([
          fs.stat(entry.targetPath).catch(() => null), fs.stat(entry.sourcePath).catch(() => null)
        ])
        if (targetStat?.nlink > 1 && sourceStat?.ino && sourceStat.ino === targetStat.ino && sourceStat.dev === targetStat.dev &&
            await calculateFileHash(entry.targetPath) !== currentOwner.file_hash) {
          throw Object.assign(new Error('已部署的硬链接资源发生修改，暂存源也可能改变。文件已保留，请重新下载该模组后更新。'), {
            code: 'deployment_link_content_changed'
          })
        }
      }
      await assertDeploymentSourceReadable(entry, records)

      const targetExists = await fs.pathExists(entry.targetPath)
      const isDirEntry = toSafeText(entry.targetType || 'file').toLowerCase() === 'dir'
      const targetStat = targetExists ? await fs.stat(entry.targetPath).catch(() => null) : null
      const targetAlreadyDirectory = isDirEntry && targetStat?.isDirectory() === true
      let targetFileHash = ''
      if (targetExists && !currentOwner && !isDirEntry && targetStat?.isFile()) {
        targetFileHash = await calculateFileHash(entry.targetPath).catch(() => '')
      }
      const targetDisposition = resolveExistingTargetDisposition({
        targetExists,
        targetType: targetStat?.isFile() ? 'file' : targetStat?.isDirectory() ? 'dir' : 'other',
        currentOwnerModId: toSafeNumber(currentOwner?.owner_mod_id, 0),
        targetFileHash,
        incomingFileHash: entry.fileHash
      })
      if (targetDisposition.action === 'adopt_identical') {
        entry.installMethod = 'adopted'
        entry.targetFingerprint = await targetFingerprint(entry.targetPath)
        session.appliedEntries.push({
          ...entry,
          action: 'adopt'
        })
        logDeployment('info', '已接管内容相同的现有目标文件', {
          gameId: normalizedScope.gameId,
          modId: entry.winnerModId,
          targetPath: entry.targetPath,
          installMethod: entry.installMethod,
          sessionId: session.sessionId
        })
        continue
      }
      if (targetExists && !targetAlreadyDirectory) {
        const backupEntry = await backupTargetBeforeReplace(
          normalizedScope.gameId,
          entry.targetPath,
          session.sessionId,
          {
            backupRoot,
            relativePath: entry.targetRelativePath,
            reason: currentOwner ? 'replace' : 'overwrite',
            restorePolicy: targetDisposition.restorePolicy,
            endpointType: normalizedScope.endpointType,
            deployDomain: normalizedScope.deployDomain,
            agentTaskId: session.agentTaskId,
            modId: entry.winnerModId,
            boundaryRoot: targetRoot
          }
        )
        if (backupEntry) session.backupEntries.push(backupEntry)
        session.appliedEntries.push({ ...entry, action: 'replace' })
        checkpoint()
        await removeTargetIfExists(entry.targetPath, { boundaryRoot: targetRoot })
        replacedCount += 1
      }

      assertPathInsideBoundary(entry.targetPath, targetRoot, '部署目标越界，已阻止写入')

      if (!targetExists || targetAlreadyDirectory) {
        session.appliedEntries.push({ ...entry, action: targetAlreadyDirectory ? 'ensure_dir' : 'create' })
        checkpoint()
      }
      entry.installMethod = await writeDeploymentEntry(entry, session, context.env || {})
      entry.targetFingerprint = await targetFingerprint(entry.targetPath)
      Object.assign(session.appliedEntries.at(-1), entry)
      checkpoint()
    }

    return {
      success: true,
      session,
      appliedCount: session.appliedEntries.length,
      backupCount: session.backupEntries.length,
      deletedCount,
      replacedCount,
      skippedCount,
      restoredCount,
      missingBackupCount,
      discardedBackupCount,
      cleanupEmptyDirCount
    }
  } catch (error) {
    const rollback = await rollbackDeploymentSession(normalizedScope, session)
    if (context.persistJournal) {
      try { checkpointDeploymentJournal(dbInstance, session, rollback.success ? 'rolled_back' : 'needs_repair') }
      catch (journalError) { rollback.success = false; rollback.failures.push({ stage: 'journal', message: journalError.message }) }
    }
    return {
      success: false,
      session,
      appliedCount: session.appliedEntries.length,
      backupCount: session.backupEntries.length,
      deletedCount,
      replacedCount,
      skippedCount,
      restoredCount,
      missingBackupCount,
      discardedBackupCount,
      cleanupEmptyDirCount,
      code: toSafeText(error.code),
      ...serializeSourceStagingError(error),
      rollbackComplete: rollback.success,
      rollbackFailures: rollback.failures,
      needRecovery: !rollback.success || error.needRecovery === true,
      message: `${String(error?.message || '部署失败')}${rollback.success ? '' : '；部分文件未能恢复，已保留备份，请重试修复部署'}`
    }
  }
}

async function reconcileDeployUnlocked(payload = {}) {
  const mode = toSafeText(payload.mode || payload.reconcileType || 'incremental')
  const scope = normalizeDeployScope(payload.scope || getModDeployScopeById(payload.modId))

  if (!scope || !scope.gameId || !isUnifiedDeploySource(scope.source)) {
    return {
      success: true,
      skipped: true,
      message: '当前来源不进入统一部署协调'
    }
  }

  const taskId = toSafeText(payload.taskId) || createTaskId(mode)
  const transactionId = createModDeployTransaction({
    taskId,
    agentTaskId: payload.agentTaskId || payload.agent_task_id,
    taskType: 'reconcile',
    status: 'running',
    reconcileType: mode,
    gameId: scope.gameId,
    source: scope.source,
    endpointType: scope.endpointType,
    deployDomain: scope.deployDomain,
    modId: payload.modId,
    payload
  })

  let applyResult = null
  let committed = false
  try {
    if (!dbInstance.all('PRAGMA table_info(mod_file_owners)').some((column) => column.name === 'target_path_key')) {
      throw new Error('部署账本迁移未完成，请重启后重试')
    }
    const planResult = await buildDeploymentPlan(scope, { full: mode !== 'incremental' })
    applyResult = await applyDeploymentPlan(scope, planResult.plan, {
      records: planResult.records,
      sessionId: createTaskId('session'),
      transactionId,
      persistJournal: true,
      incremental: mode === 'incremental',
      agentTaskId: payload.agentTaskId || payload.agent_task_id,
      env: payload.env || {}
    })

    if (!applyResult.success) {
      const failedResult = {
        success: false,
        mode,
        taskId,
        transactionId,
        rollbackComplete: applyResult.rollbackComplete,
        rollbackFailures: applyResult.rollbackFailures,
        needRecovery: applyResult.needRecovery,
        sessionId: applyResult.session?.sessionId || taskId,
        skipped: planResult.skipped,
        deployMethods: summarizeDeployMethods(planResult.plan),
        code: toSafeText(applyResult.code),
        stage: toSafeText(applyResult.stage),
        modId: toSafeNumber(applyResult.modId, 0),
        modName: toSafeText(applyResult.modName),
        sourcePath: toSafeText(applyResult.sourcePath),
        systemError:
          applyResult.systemError && typeof applyResult.systemError === 'object'
            ? applyResult.systemError
            : {},
        message: applyResult.message || '部署失败，已回滚'
      }
      updateModDeployTransaction(transactionId, {
        status: failedResult.needRecovery ? 'needs_repair' : 'rolled_back',
        errorCode: failedResult.code || 'DEPLOY_ROLLED_BACK',
        errorMessage: failedResult.message,
        result: failedResult
      })
      return failedResult
    }

    const winnerMethodMap = new Map(
      planResult.plan.map((entry) => [
        `${entry.winnerModId}:${entry.targetRelativeKey}`,
        entry.installMethod || 'copy'
      ])
    )
    planResult.manifestRows.forEach((row) => {
      row.installMethod =
        winnerMethodMap.get(`${row.modId}:${row.targetRelativeKey}`) || 'candidate'
    })

    const result = {
      success: true,
      mode,
      taskId,
      transactionId,
      sessionId: applyResult.session.sessionId,
      deployedCount: planResult.plan.length,
      skippedCount: planResult.skipped.length + applyResult.skippedCount,
      skipped: planResult.skipped,
      appliedCount: applyResult.appliedCount,
      backupCount: applyResult.backupCount,
      deletedCount: applyResult.deletedCount,
      replacedCount: applyResult.replacedCount,
      restoredCount: applyResult.restoredCount,
      missingBackupCount: applyResult.missingBackupCount,
      discardedBackupCount: applyResult.discardedBackupCount,
      cleanupEmptyDirCount: applyResult.cleanupEmptyDirCount,
      deployMethods: summarizeDeployMethods(planResult.plan)
    }
    result.deploymentPath = await writeDeploymentSessionFile(
      scope,
      planResult.records,
      planResult.plan,
      applyResult.session,
      result
    )
    result.ledger = rebuildDeployLedger(
      scope,
      planResult.manifestRows,
      planResult.plan,
      applyResult.session.backupEntries,
      applyResult.session,
      () => {
        markDeployScopeReconciled(scope)
        checkpointDeploymentJournal(dbInstance, applyResult.session, 'committed')
        updateModDeployTransaction(transactionId, { status: 'completed', result })
      }
    )
    committed = true

    // 清理仍在同一写锁内完成，且只处理无活跃引用的过期终态会话。
    const backupRoot = resolveSessionRoot(scope, planResult.records, planResult.plan, 'backup')
    await purgeStaleDeployBackupSessions(backupRoot, applyResult.session.sessionId, {
      scope, scopeLockToken: payload.scopeLockToken
    }).catch((error) => {
      logDeployment('warn', '部署后自动清理旧备份失败', {
        backupRoot,
        sessionId: taskId,
        error: String(error?.message || error)
      })
    })

    return result
  } catch (error) {
    const sourceError = serializeSourceStagingError(error)
    let rollback = null
    if (applyResult?.success && !committed) {
      rollback = await rollbackDeploymentSession(scope, applyResult.session)
      try {
        checkpointDeploymentJournal(dbInstance, applyResult.session, rollback.success ? 'rolled_back' : 'needs_repair')
      } catch (journalError) {
        rollback.success = false
        rollback.failures.push({ stage: 'journal', message: journalError.message })
      }
    }
    const result = {
      success: false,
      mode,
      taskId,
      transactionId,
      sessionId: applyResult?.session?.sessionId || '',
      rollbackComplete: rollback?.success ?? applyResult?.rollbackComplete ?? false,
      rollbackFailures: rollback?.failures || applyResult?.rollbackFailures || [],
      needRecovery: rollback ? !rollback.success : applyResult?.needRecovery === true,
      ...sourceError,
      message: String(error?.message || '部署协调失败')
    }
    if (result.needRecovery) result.message += '；恢复未完成，已保留备份，请重试修复部署'
    updateModDeployTransaction(transactionId, {
      status: result.needRecovery ? 'needs_repair' : result.rollbackComplete ? 'rolled_back' : 'failed',
      errorCode: result.code || 'RECONCILE_FAILED',
      errorMessage: result.message,
      result
    })
    return result
  }
}

export async function reconcileDeploy(payload = {}) {
  const scope = normalizeDeployScope(payload.scope || getModDeployScopeById(payload.modId))
  if (!scope || !scope.gameId || !isUnifiedDeploySource(scope.source)) {
    return await reconcileDeployUnlocked(payload)
  }

  try {
    return await withDeploymentScopeMutationLocks(
      [scope],
      async (scopeLockToken) => {
        const recovery = await recoverPendingDeploymentSessions({ scope, scopeLockToken })
        if (!recovery.success) return recovery
        return await reconcileDeployUnlocked({
          ...payload,
          scope,
          scopeLockToken
        })
      },
      {
        token: payload.scopeLockToken,
        ownerId: toSafeText(payload.taskId || payload.agentTaskId || payload.reason, 'reconcile'),
        operation: 'reconcile',
        signal: payload.signal,
        timeoutMs: payload.timeoutMs,
        onWait: payload.onWait,
        errorCode: 'deployment_scope_busy'
      }
    )
  } catch (error) {
    if (!['deployment_scope_busy', 'deployment_scope_timeout'].includes(toSafeText(error?.code))) throw error
    return {
      success: false,
      code: error.code,
      stage: 'scope_lock',
      scope,
      message: String(error?.message || '同一部署域存在正在执行的写入')
    }
  }
}

/** 中断恢复与正常部署共用写锁；遇到用户修改时保留现场并阻止继续部署。 */
export async function recoverPendingDeploymentSessions(options = {}) {
  const rows = listPendingDeploymentJournals(dbInstance, options.scope || null)
  const failures = []
  let recoveredCount = 0
  for (const row of rows) {
    const scope = normalizeDeployScope(row)
    await withDeploymentScopeMutationLocks([scope], async () => {
      const current = dbInstance.get('SELECT * FROM mod_deploy_journal WHERE session_id = ?', [row.session_id])
      if (!current || !['applying', 'needs_repair'].includes(current.state)) return
      try {
        const session = readDeploymentJournalSession(dbInstance, current)
        if (session.sessionId !== row.session_id) throw new Error('部署恢复日志会话不一致')
        const backupDirectory = path.join(row.backup_root, sanitizePathSegment(row.session_id))
        for (const entry of session.backupEntries) {
          if (!isPathInsideOrEqual(backupDirectory, entry.backupPath) || !isRealPathInside(backupDirectory, entry.backupPath)) {
            throw new Error('部署恢复备份路径越界')
          }
        }
        const rollback = await rollbackDeploymentSession(scope, session, { protectChanges: true })
        checkpointDeploymentJournal(dbInstance, session, rollback.success ? 'rolled_back' : 'needs_repair')
        if (session.transactionId) updateModDeployTransaction(session.transactionId, {
          status: rollback.success ? 'rolled_back' : 'needs_repair',
          result: { ...rollback, rollbackComplete: rollback.success, needRecovery: !rollback.success },
          errorCode: rollback.success ? 'INTERRUPTED_RECOVERED' : 'deployment_recovery_required',
          errorMessage: rollback.success ? '中断部署已恢复' : '中断部署恢复未完成，已保留当前文件和备份'
        })
        if (rollback.success) recoveredCount++
        else failures.push({ sessionId: session.sessionId, failures: rollback.failures })
      } catch (error) {
        dbInstance.run("UPDATE mod_deploy_journal SET state = 'needs_repair' WHERE session_id = ?", [row.session_id])
        failures.push({ sessionId: row.session_id, message: String(error?.message || error) })
      }
    }, { token: options.scopeLockToken, operation: 'recover', ownerId: 'deployment-recovery' })
  }
  return {
    success: failures.length === 0, recoveredCount, failures,
    needRecovery: failures.length > 0,
    code: failures.length ? 'deployment_recovery_required' : '',
    message: failures.length ? '此前部署尚未恢复，已保留文件和备份；请核对文件占用或修改后重试修复部署' : '中断部署恢复完成'
  }
}

async function purgeStaleDeployBackupSessions(backupRoot = '', currentSessionId = '', options = {}) {
  return purgeCompletedDeployBackups({ ...options, backupRoot, currentSessionId })
}

async function purgeCompletedDeployBackups(options = {}) {
  if (!dbInstance.tableExists('mod_deploy_journal')) return { purgedCount: 0, scannedRoots: 0 }
  const cutoff = Date.now() - DEPLOYMENT_BACKUP_RETENTION_MS
  const rows = dbInstance.all("SELECT * FROM mod_deploy_journal WHERE state IN ('committed', 'rolled_back') AND updated_at < ?", [cutoff])
  const roots = new Set()
  let purgedCount = 0
  for (const row of rows) {
    if (row.session_id === options.currentSessionId) continue
    if (options.backupRoot && normalizePathKey(row.backup_root) !== normalizePathKey(options.backupRoot)) continue
    const scope = normalizeDeployScope(row)
    if (options.scope && (scope.gameId !== options.scope.gameId || scope.endpointType !== options.scope.endpointType || scope.deployDomain !== options.scope.deployDomain)) continue
    await withDeploymentScopeMutationLocks([scope], async () => {
      const current = dbInstance.get('SELECT state, updated_at FROM mod_deploy_journal WHERE session_id = ?', [row.session_id])
      if (!current || !['committed', 'rolled_back'].includes(current.state) || current.updated_at >= cutoff) return
      // Replacement/deletion snapshots only support the retained transaction history.
      // Original overwritten game files must survive until their owners are removed and restoration completes.
      dbInstance.run("UPDATE mod_deploy_backup_entries SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND state = 'active' AND reason IN ('replace', 'delete', 'detach_configuration')", [row.session_id])
      const active = dbInstance.get("SELECT 1 FROM mod_deploy_backup_entries WHERE session_id = ? AND state = 'active' LIMIT 1", [row.session_id])
      if (active) return
      const directory = path.join(row.backup_root, sanitizePathSegment(row.session_id))
      if (!row.backup_root || !isRealPathInside(row.backup_root, directory)) return
      roots.add(row.backup_root)
      if (await fs.pathExists(directory)) { await fs.remove(directory); purgedCount++ }
      dbInstance.transaction(() => {
        dbInstance.run("DELETE FROM mod_deploy_backup_entries WHERE session_id = ? AND state != 'active'", [row.session_id])
        dbInstance.run('DELETE FROM mod_deploy_journal_entries WHERE session_id = ?', [row.session_id])
        dbInstance.run("UPDATE mod_deploy_journal SET state = 'purged' WHERE session_id = ?", [row.session_id])
      })
    }, { token: options.scopeLockToken, ownerId: 'deployment-cleanup', operation: 'cleanup' })
  }
  return { purgedCount, scannedRoots: roots.size }
}

/** 无日志的旧目录可能包含尚未恢复的原文件，不能按“未入账”直接删除。 */
export async function purgeAllStaleDeployBackups() {
  return purgeCompletedDeployBackups()
}

export const rebuildDeployment = reconcileDeploy

export function getDeployReconcilePreview(scope = {}) {
  const normalizedScope = normalizeDeployScope(scope)
  if (!normalizedScope || !isUnifiedDeploySource(normalizedScope.source)) {
    return { success: false, message: '当前来源不进入统一部署协调', records: [] }
  }
  return {
    success: true,
    records: listModRecordsByDeployScope(normalizedScope, {
      activeOnly: true,
      order: 'deploy'
    })
  }
}

export function clearStaleDeployTransactions() {
  return dbInstance.run(
    `UPDATE mod_deploy_transactions
     SET status = 'failed',
         error_code = 'STALE_TASK',
         error_message = '应用重启前任务未完成'
     WHERE status IN ('queued', 'running', 'preflight', 'scanning', 'planning', 'applying', 'verifying')`
  )
}
