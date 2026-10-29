import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'fs-extra'
import si from 'systeminformation'
import userPath from '../../initPath.js'
import dbInstance from '../../db/dbInstance.js'
import store, { getDefaultDownloadRootPath } from '../../storage/store/index.js'
import {
  isPathInsideRoot,
  matchRunningThunderstoreProfiles,
  normalizePathMappings,
  rebaseThunderstorePath,
  resolveThunderstoreStoragePaths,
  rewriteThunderstoreDatabasePaths
} from './thunderstoreStorageCore.js'
import { inspectThunderstoreMigrationTarget } from './thunderstoreMigrationFilePolicy.js'

const MIGRATION_STATE_KEY = 'maintenance.thunderstoreStorageMigration'
const LEGACY_THUNDERSTORE_ROOT = path.join(userPath, 'thunderstore')
let activeStorageOperations = 0
let migrationActive = false
let protectedProfileRootsCache = { expiresAt: 0, roots: [] }

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function normalizePathKey(value = '') {
  const safeValue = toSafeText(value)
  return safeValue ? path.resolve(safeValue).replace(/\//g, '\\').toLowerCase() : ''
}

function createStorageError(code, message, extra = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

export function getConfiguredThunderstoreStoragePaths(downloadPath = '') {
  const configuredPath =
    toSafeText(downloadPath) ||
    toSafeText(store.get('systemConfig.settings.downloadPath')) ||
    getDefaultDownloadRootPath()
  return resolveThunderstoreStoragePaths(configuredPath)
}

export function getLegacyThunderstoreStoragePaths() {
  return {
    root: LEGACY_THUNDERSTORE_ROOT,
    cacheRoot: path.join(LEGACY_THUNDERSTORE_ROOT, 'cache'),
    profileRoot: path.join(LEGACY_THUNDERSTORE_ROOT, 'profiles'),
    ecosystemRoot: path.join(LEGACY_THUNDERSTORE_ROOT, 'ecosystem')
  }
}

export function isThunderstoreStorageBusy() {
  return migrationActive || activeStorageOperations > 0
}

export function isThunderstoreStorageMigrationActive() {
  return migrationActive
}

export async function runThunderstoreStorageOperation(operation, options = {}) {
  if (migrationActive) {
    throw createStorageError(
      'thunderstore_storage_busy',
      options.busyMessage || 'Thunderstore 文件正在迁移，请稍后重试'
    )
  }
  activeStorageOperations += 1
  try {
    return await operation()
  } finally {
    activeStorageOperations = Math.max(0, activeStorageOperations - 1)
  }
}

function listThunderstoreProfiles() {
  if (!dbInstance.tableExists('thunderstore_profiles')) return []
  const hasGames = dbInstance.tableExists('games')
  return dbInstance.all(
    hasGames
      ? `SELECT profile.id,
                profile.game_id,
                profile.community,
                profile.profile_name,
                profile.profile_root,
                COALESCE(NULLIF(profile.game_exe_path, ''), game.client_exe_path, '') AS game_exe_path,
                COALESCE(NULLIF(game.name, ''), NULLIF(game.english_name, ''), profile.community) AS game_name
         FROM thunderstore_profiles profile
         LEFT JOIN games game ON game.id = profile.game_id`
      : `SELECT id, game_id, community, profile_name, profile_root, game_exe_path,
                community AS game_name
         FROM thunderstore_profiles`
  )
}

function hasActiveThunderstoreSourceInstallJobs() {
  if (!dbInstance.tableExists('source_install_job')) return false
  const activeStates = [
    'created',
    'resolving',
    'prechecking',
    'queued',
    'downloading',
    'downloaded',
    'previewing',
    'waiting',
    'installing',
    'health_checking'
  ]
  const placeholders = activeStates.map(() => '?').join(', ')
  return Boolean(
    dbInstance.get(
      `SELECT id FROM source_install_job
       WHERE lower(COALESCE(source, '')) = 'thunderstore'
         AND lower(COALESCE(state, '')) IN (${placeholders})
       LIMIT 1`,
      activeStates
    )
  )
}

export async function listRunningThunderstoreGames(options = {}) {
  const profiles = listThunderstoreProfiles()
  const processData = options.processData || (await si.processes())
  return matchRunningThunderstoreProfiles(profiles, processData)
}

function listThunderstoreArchivePaths(previousDownloadRoot = '') {
  const paths = []
  const append = (value = '') => {
    const safeValue = toSafeText(value)
    if (
      safeValue &&
      path.isAbsolute(safeValue) &&
      isPathInsideRoot(safeValue, previousDownloadRoot)
    ) {
      paths.push(path.resolve(safeValue))
    }
  }

  if (dbInstance.tableExists('download_records')) {
    const columns = new Set(dbInstance.all(`PRAGMA table_info(download_records)`).map((item) => item.name))
    const where = columns.has('source_platform')
      ? `lower(COALESCE(source_platform, '')) = 'thunderstore'`
      : `lower(COALESCE(task_name, '')) LIKE 'thunderstore%'
         OR lower(COALESCE(download_url, '')) LIKE '%thunderstore.io/%'`
    for (const row of dbInstance.all(`SELECT file_path FROM download_records WHERE ${where}`)) {
      append(row.file_path)
    }
  }
  if (dbInstance.tableExists('source_install_artifact')) {
    for (const row of dbInstance.all(
      `SELECT file_path FROM source_install_artifact
       WHERE lower(COALESCE(source, '')) = 'thunderstore'`
    )) {
      append(row.file_path)
    }
  }
  if (dbInstance.tableExists('mods')) {
    for (const row of dbInstance.all(
      `SELECT archive_path FROM mods WHERE lower(COALESCE(source, '')) = 'thunderstore'`
    )) {
      append(row.archive_path)
    }
  }
  return Array.from(new Set(paths.map(normalizePathKey))).map(
    (key) => paths.find((item) => normalizePathKey(item) === key) || ''
  )
}

async function pathExists(targetPath = '') {
  return !!targetPath && (await fs.pathExists(targetPath))
}

async function buildMigrationMappings(previousDownloadPath, nextDownloadPath) {
  const previousPaths = getConfiguredThunderstoreStoragePaths(previousDownloadPath)
  const nextPaths = getConfiguredThunderstoreStoragePaths(nextDownloadPath)
  const mappings = []
  const appendRoot = async (from, to) => {
    if (normalizePathKey(from) === normalizePathKey(to)) return
    if (await pathExists(from)) mappings.push({ from, to, kind: 'root' })
  }

  await appendRoot(LEGACY_THUNDERSTORE_ROOT, nextPaths.root)
  await appendRoot(previousPaths.root, nextPaths.root)

  for (const profile of listThunderstoreProfiles()) {
    const sourceRoot = toSafeText(profile.profile_root)
    if (!sourceRoot) continue
    const community = toSafeText(profile.community).toLowerCase() || 'unknown'
    const pathId = path.basename(path.resolve(sourceRoot)) || `profile-${profile.id}`
    const targetRoot = path.join(nextPaths.profileRoot, community, pathId)
    if (normalizePathKey(sourceRoot) === normalizePathKey(targetRoot)) continue
    if (!(await pathExists(sourceRoot))) {
      if (await pathExists(targetRoot)) {
        mappings.push({ from: sourceRoot, to: targetRoot, kind: 'root' })
        continue
      }
      throw createStorageError(
        'thunderstore_profile_missing',
        `配置“${toSafeText(profile.profile_name) || 'default'}”的文件目录不存在：${sourceRoot}`
      )
    }
    const covered = mappings.some(
      (mapping) =>
        mapping.kind === 'root' &&
        isPathInsideRoot(sourceRoot, mapping.from) &&
        normalizePathKey(rebaseThunderstorePath(sourceRoot, [mapping])) === normalizePathKey(targetRoot)
    )
    if (!covered) mappings.push({ from: sourceRoot, to: targetRoot, kind: 'root' })
  }

  for (const archivePath of listThunderstoreArchivePaths(previousPaths.downloadRoot)) {
    if (!(await pathExists(archivePath))) continue
    const targetPath = path.join(
      nextPaths.downloadRoot,
      path.relative(previousPaths.downloadRoot, archivePath)
    )
    const covered = mappings.some(
      (mapping) => mapping.kind === 'root' && isPathInsideRoot(archivePath, mapping.from)
    )
    if (!covered && normalizePathKey(archivePath) !== normalizePathKey(targetPath)) {
      mappings.push({ from: archivePath, to: targetPath, kind: 'file' })
    }
  }

  return {
    previousPaths,
    nextPaths,
    mappings: normalizePathMappings(mappings)
  }
}

async function collectFilesUnderRoot(rootPath, targetRoot, output) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(rootPath, entry.name)
    const targetPath = path.join(targetRoot, entry.name)
    if (entry.isDirectory()) {
      await collectFilesUnderRoot(sourcePath, targetPath, output)
    } else if (entry.isFile()) {
      const stat = await fs.stat(sourcePath)
      output.push({ sourcePath, targetPath, size: Number(stat.size || 0) })
    }
  }
}

async function buildFileCopyPlan(mappings) {
  const files = []
  for (const mapping of mappings) {
    if (!(await pathExists(mapping.from))) continue
    const stat = await fs.stat(mapping.from)
    if (mapping.kind === 'file' || stat.isFile()) {
      files.push({ sourcePath: mapping.from, targetPath: mapping.to, size: Number(stat.size || 0) })
    } else if (stat.isDirectory()) {
      await collectFilesUnderRoot(mapping.from, mapping.to, files)
    }
  }

  const result = []
  const seenSources = new Set()
  const targets = new Map()
  for (const file of files) {
    const sourceKey = normalizePathKey(file.sourcePath)
    const targetKey = normalizePathKey(file.targetPath)
    if (seenSources.has(sourceKey)) continue
    const existingSource = targets.get(targetKey)
    if (existingSource && existingSource !== sourceKey) {
      throw createStorageError(
        'thunderstore_path_conflict',
        `多个 Thunderstore 文件将迁移到同一目标：${file.targetPath}`
      )
    }
    seenSources.add(sourceKey)
    targets.set(targetKey, sourceKey)
    result.push(file)
  }
  return result
}

async function assertEnoughFreeSpace(targetRoot, requiredBytes) {
  await fs.ensureDir(targetRoot)
  if (typeof fs.statfs !== 'function') return
  try {
    const stats = await fs.statfs(targetRoot)
    const availableBytes = Number(stats?.bavail || stats?.bfree || 0) * Number(stats?.bsize || 0)
    if (availableBytes > 0 && requiredBytes > availableBytes) {
      throw createStorageError(
        'thunderstore_storage_space_insufficient',
        '目标磁盘可用空间不足，无法迁移 Thunderstore 文件'
      )
    }
  } catch (error) {
    if (error?.code === 'thunderstore_storage_space_insufficient') throw error
    console.warn('[thunderstore-storage] 无法读取目标磁盘空间，继续执行逐文件校验', error)
  }
}

function emitProgress(onProgress, payload = {}) {
  if (typeof onProgress === 'function') onProgress(payload)
}

async function cleanMigrationSources(mappings) {
  const warnings = []
  const roots = mappings
    .filter((item) => item.kind === 'root')
    .sort((left, right) => right.from.length - left.from.length)
  const files = mappings.filter((item) => item.kind === 'file')

  for (const mapping of files) {
    try {
      if (await pathExists(mapping.from)) await fs.remove(mapping.from)
    } catch (error) {
      warnings.push(`${mapping.from}: ${error?.message || '清理失败'}`)
    }
  }
  for (const mapping of roots) {
    if (roots.some((parent) => parent !== mapping && isPathInsideRoot(mapping.from, parent.from))) continue
    try {
      if (await pathExists(mapping.from)) await fs.remove(mapping.from)
    } catch (error) {
      warnings.push(`${mapping.from}: ${error?.message || '清理失败'}`)
    }
  }
  return warnings
}

export async function migrateThunderstoreStorage(nextDownloadPath = '', options = {}) {
  const targetDownloadPath = toSafeText(nextDownloadPath)
  if (!targetDownloadPath) {
    throw createStorageError('invalid_download_path', '下载路径不能为空')
  }
  if (migrationActive || activeStorageOperations > 0) {
    throw createStorageError('thunderstore_storage_busy', 'Thunderstore 正在安装、启动或迁移文件，请稍后重试')
  }

  migrationActive = true
  const previousDownloadPath =
    toSafeText(options.previousDownloadPath) ||
    toSafeText(store.get('systemConfig.settings.downloadPath')) ||
    getDefaultDownloadRootPath()
  const migrationId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  let stagingRoot = ''
  const promotedPaths = []
  let databaseCommitted = false

  try {
    const { nextPaths, mappings } = await buildMigrationMappings(
      previousDownloadPath,
      targetDownloadPath
    )
    const previousKey = normalizePathKey(previousDownloadPath)
    const targetKey = normalizePathKey(targetDownloadPath)
    if (previousKey === targetKey && mappings.length === 0) {
      store.delete(MIGRATION_STATE_KEY)
      return {
        success: true,
        canceled: false,
        code: '',
        message: '下载路径未变化',
        downloadPath: path.resolve(targetDownloadPath),
        migratedProfileCount: 0,
        migratedFileCount: 0,
        copiedFileCount: 0,
        updatedDatabaseRows: 0,
        cleanupWarning: '',
        blockingGames: []
      }
    }
    if (hasActiveThunderstoreSourceInstallJobs()) {
      throw createStorageError(
        'thunderstore_storage_busy',
        '存在未完成的 Thunderstore 安装任务，请先完成或取消任务后再修改下载路径'
      )
    }
    const blockingGames = options.skipRunningGameCheck
      ? []
      : await listRunningThunderstoreGames(options)
    if (blockingGames.length) {
      throw createStorageError(
        'thunderstore_game_running',
        `检测到游戏正在运行：${blockingGames.map((item) => item.gameName).join('、')}，请退出游戏后再修改下载路径`,
        { blockingGames }
      )
    }

    for (const mapping of mappings) {
      if (isPathInsideRoot(mapping.to, mapping.from) || isPathInsideRoot(mapping.from, mapping.to)) {
        throw createStorageError(
          'thunderstore_invalid_migration_target',
          `目标目录与现有 Thunderstore 目录互相包含，无法安全迁移：${mapping.to}`
        )
      }
    }

    const copyPlan = await buildFileCopyPlan(mappings)
    for (const file of copyPlan) {
      const targetInspection = await inspectThunderstoreMigrationTarget(
        file.sourcePath,
        file.targetPath
      )
      if (targetInspection.conflict) {
        throw createStorageError(
          'thunderstore_path_conflict',
          `目标位置已存在不同内容的文件：${file.targetPath}`
        )
      }
      file.reuseExisting = targetInspection.reuseExisting
    }
    const requiredBytes = copyPlan
      .filter((item) => !item.reuseExisting)
      .reduce((total, item) => total + item.size, 0)
    await assertEnoughFreeSpace(nextPaths.downloadRoot, requiredBytes)
    stagingRoot = path.join(nextPaths.downloadRoot, '.thunderstore-migration', migrationId)
    await fs.ensureDir(stagingRoot)
    store.set(MIGRATION_STATE_KEY, {
      id: migrationId,
      phase: 'copying',
      previousDownloadPath,
      targetDownloadPath,
      stagingRoot,
      mappings,
      updatedAt: new Date().toISOString()
    })

    let copiedCount = 0
    for (const [index, file] of copyPlan.entries()) {
      if (!file.reuseExisting) {
        const relativeTarget = path.relative(nextPaths.downloadRoot, file.targetPath)
        if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
          throw createStorageError('thunderstore_invalid_target', `迁移目标超出下载目录：${file.targetPath}`)
        }
        const stagedPath = path.join(stagingRoot, relativeTarget)
        await fs.ensureDir(path.dirname(stagedPath))
        await fs.copyFile(file.sourcePath, stagedPath)
        const stagedStat = await fs.stat(stagedPath)
        if (Number(stagedStat.size || 0) !== file.size) {
          throw createStorageError('thunderstore_copy_verify_failed', `文件复制校验失败：${file.sourcePath}`)
        }
        file.stagedPath = stagedPath
        copiedCount += 1
      }
      emitProgress(options.onProgress, {
        stage: 'copying',
        current: index + 1,
        total: copyPlan.length,
        percent: copyPlan.length ? Math.round(((index + 1) / copyPlan.length) * 75) : 75,
        message: `正在迁移 Thunderstore 文件（${index + 1}/${copyPlan.length}）`
      })
    }

    store.set(`${MIGRATION_STATE_KEY}.phase`, 'promoting')
    for (const file of copyPlan) {
      if (!file.stagedPath) continue
      await fs.ensureDir(path.dirname(file.targetPath))
      await fs.move(file.stagedPath, file.targetPath, { overwrite: false })
      promotedPaths.push(file.targetPath)
    }
    for (const mapping of mappings.filter((item) => item.kind === 'root')) {
      await fs.ensureDir(mapping.to)
    }

    emitProgress(options.onProgress, {
      stage: 'database',
      current: copyPlan.length,
      total: copyPlan.length,
      percent: 85,
      message: '正在更新 Thunderstore 文件路径记录'
    })
    const databaseSummary = rewriteThunderstoreDatabasePaths(dbInstance, mappings)
    databaseCommitted = true
    store.set(`${MIGRATION_STATE_KEY}.phase`, 'database_committed')
    store.set('systemConfig.settings.downloadPath', path.resolve(targetDownloadPath))
    store.set(`${MIGRATION_STATE_KEY}.phase`, 'settings_committed')

    const cleanupWarnings = await cleanMigrationSources(mappings)
    await fs.remove(stagingRoot).catch(() => {})
    store.delete(MIGRATION_STATE_KEY)
    emitProgress(options.onProgress, {
      stage: 'done',
      current: copyPlan.length,
      total: copyPlan.length,
      percent: 100,
      message: 'Thunderstore 文件迁移完成'
    })

    return {
      success: true,
      canceled: false,
      code: '',
      message:
        previousKey === targetKey && mappings.length === 0
          ? '下载路径未变化'
          : '下载路径与 Thunderstore 文件迁移完成',
      downloadPath: path.resolve(targetDownloadPath),
      migratedProfileCount: listThunderstoreProfiles().filter((profile) =>
        mappings.some((mapping) => isPathInsideRoot(profile.profile_root, mapping.to))
      ).length,
      migratedFileCount: copyPlan.length,
      copiedFileCount: copiedCount,
      updatedDatabaseRows: databaseSummary.updatedRows,
      cleanupWarning: cleanupWarnings.length ? cleanupWarnings.join('\n') : '',
      blockingGames: []
    }
  } catch (error) {
    if (!databaseCommitted) {
      for (const promotedPath of promotedPaths.reverse()) {
        await fs.remove(promotedPath).catch(() => {})
      }
    }
    if (stagingRoot) await fs.remove(stagingRoot).catch(() => {})
    if (!databaseCommitted) store.delete(MIGRATION_STATE_KEY)
    throw error
  } finally {
    migrationActive = false
  }
}

export async function reconcileThunderstoreStorageOnStartup(options = {}) {
  const staleState = store.get(MIGRATION_STATE_KEY)
  const configuredDownloadPath =
    toSafeText(store.get('systemConfig.settings.downloadPath')) || getDefaultDownloadRootPath()
  const targetDownloadPath = toSafeText(staleState?.targetDownloadPath) || configuredDownloadPath
  if (staleState?.stagingRoot) {
    await fs.remove(staleState.stagingRoot).catch(() => {})
  }
  if (
    staleState &&
    ['database_committed', 'settings_committed'].includes(toSafeText(staleState.phase))
  ) {
    const blockingGames = await listRunningThunderstoreGames(options)
    if (blockingGames.length) {
      return {
        success: false,
        deferred: true,
        code: 'thunderstore_game_running',
        message: `检测到游戏正在运行：${blockingGames.map((item) => item.gameName).join('、')}，已延后完成 Thunderstore 路径迁移`,
        blockingGames
      }
    }
    store.set('systemConfig.settings.downloadPath', path.resolve(targetDownloadPath))
    const cleanupWarnings = await cleanMigrationSources(
      normalizePathMappings(staleState.mappings || [])
    )
    store.delete(MIGRATION_STATE_KEY)
    return {
      success: true,
      recovered: true,
      downloadPath: path.resolve(targetDownloadPath),
      cleanupWarning: cleanupWarnings.join('\n')
    }
  }
  try {
    return await migrateThunderstoreStorage(targetDownloadPath, {
      ...options,
      previousDownloadPath:
        toSafeText(staleState?.previousDownloadPath) || configuredDownloadPath
    })
  } catch (error) {
    if (error?.code === 'thunderstore_game_running' || error?.code === 'thunderstore_storage_busy') {
      return {
        success: false,
        deferred: true,
        code: error.code,
        message: error.message,
        blockingGames: error.blockingGames || []
      }
    }
    throw error
  }
}

export function isProtectedThunderstoreProfilePath(targetPath = '') {
  const safeTarget = toSafeText(targetPath)
  if (!safeTarget) return false
  const now = Date.now()
  if (protectedProfileRootsCache.expiresAt <= now) {
    const configuredPaths = getConfiguredThunderstoreStoragePaths()
    const migrationState = store.get(MIGRATION_STATE_KEY)
    const migrationTargetPath = toSafeText(migrationState?.targetDownloadPath)
    protectedProfileRootsCache = {
      expiresAt: now + 1000,
      roots: [
        configuredPaths.profileRoot,
        ...(migrationTargetPath
          ? [getConfiguredThunderstoreStoragePaths(migrationTargetPath).profileRoot]
          : []),
        path.join(LEGACY_THUNDERSTORE_ROOT, 'profiles'),
        ...listThunderstoreProfiles().map((item) => item.profile_root)
      ].filter(Boolean)
    }
  }
  const roots = protectedProfileRootsCache.roots
  return roots.some((root) => root && isPathInsideRoot(safeTarget, root))
}
