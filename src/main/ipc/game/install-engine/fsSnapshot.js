import fs from 'fs-extra'
import path from 'path'
import { normalizeRelativeRulePath, toSafeText } from './contracts.js'
import { resolveAdaptiveConcurrency, runWithConcurrencyLimit } from './concurrency.js'
import { INSTALL_ENGINE_ERROR_CODES, InstallEngineError } from './installEngineError.js'
import { createPlanningPathChecker } from './pathSafety.js'

const DEFAULT_SNAPSHOT_MAX_DEPTH = 80
const MISSING_PATH_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR'])

function normalizeSnapshotOptions(options = {}) {
  const maxDepthValue = Number(options.maxDepth)
  const currentDepthValue = Number(options.currentDepth)
  const boundaryRoot = toSafeText(options.boundaryRoot)
  return {
    excludeInstallInternal: options.excludeInstallInternal === true,
    maxDepth: Number.isFinite(maxDepthValue)
      ? Math.max(0, Math.floor(maxDepthValue))
      : DEFAULT_SNAPSHOT_MAX_DEPTH,
    currentDepth: Number.isFinite(currentDepthValue)
      ? Math.max(0, Math.floor(currentDepthValue))
      : 0,
    boundaryRoot: boundaryRoot ? path.resolve(boundaryRoot) : ''
  }
}

function createSnapshotCacheKey(dirPath = '', options = {}) {
  return `${dirPath}::root=${options.boundaryRoot || dirPath}::depth=${Math.max(0, options.maxDepth - options.currentDepth)}::internal=${!!options.excludeInstallInternal}`
}

function createTopLevelSnapshotCacheKey(dirPath = '', options = {}) {
  return `${dirPath}::root=${options.boundaryRoot || dirPath}::top_level::internal=${!!options.excludeInstallInternal}`
}

function isMissingPathError(error) {
  return MISSING_PATH_ERROR_CODES.has(toSafeText(error?.code))
}

function createSnapshotAccessError(action = '', targetPath = '', error = null) {
  const errorCode = toSafeText(error?.code)
  const code = isMissingPathError(error)
    ? INSTALL_ENGINE_ERROR_CODES.PATH_MISSING
    : INSTALL_ENGINE_ERROR_CODES.FILE_OPERATION_FAILED
  return new InstallEngineError(
    code,
    `${action}失败：${toSafeText(error?.message || errorCode || '未知文件系统错误')}`,
    {
      path: targetPath,
      errorCode
    }
  )
}

async function statPath(pathValue = '', action = '检查路径') {
  try {
    return await fs.stat(pathValue)
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw createSnapshotAccessError(action, pathValue, error)
  }
}

async function statEntry(pathValue = '', action = '读取目录项') {
  try {
    return await fs.lstat(pathValue)
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw createSnapshotAccessError(action, pathValue, error)
  }
}

function isLinkEntry(stat = null) {
  // lstat 在 Windows 上同样识别 junction，普通文件不需要再触发一次失败的 readlink。
  return stat?.isSymbolicLink?.() === true
}

function throwUnsafeLinkError(fullPath = '') {
  throw new InstallEngineError(
    INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
    `检测到符号链接 / junction，已阻止安装：${fullPath}`,
    { path: fullPath }
  )
}

async function assertRealPathInsideBoundary(boundaryRoot = '', targetPath = '', checkPath = createPlanningPathChecker()) {
  const safeBoundaryRoot = path.resolve(toSafeText(boundaryRoot))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (safeBoundaryRoot && !(await checkPath(safeBoundaryRoot, safeTargetPath))) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
      `安装源真实路径越界，已阻止安装：${safeTargetPath}`,
      { path: safeTargetPath, boundaryRoot: safeBoundaryRoot }
    )
  }
}

async function assertSnapshotDirectorySafe(dirPath = '', boundaryRoot = '') {
  const stat = await statEntry(dirPath, '读取目录快照')
  if (!stat) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
      '安装快照目录不存在，无法继续规划',
      { path: dirPath }
    )
  }
  if (isLinkEntry(stat)) {
    throwUnsafeLinkError(dirPath)
  }
  if (!stat.isDirectory()) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
      '安装快照路径不是目录，无法继续规划',
      { path: dirPath }
    )
  }
  await assertRealPathInsideBoundary(boundaryRoot || dirPath, dirPath)
  return stat
}

async function listTopLevelEntries(dirPath = '', boundaryRoot = '', excludeInstallInternal = false) {
  const checkPath = createPlanningPathChecker()
  let names = []
  try {
    names = await fs.readdir(dirPath)
    if (names.length > 100000) throw new InstallEngineError('install_engine.snapshot_entry_budget', '安装包单层目录超过 100000 项扫描预算')
    if (excludeInstallInternal && path.resolve(dirPath).toLowerCase() === path.resolve(boundaryRoot).toLowerCase()) {
      for (const name of names.filter((value) => /^__(?:vertex_install_plan_v3|vertex_install_rule|vertex_nexus_rule)__$/i.test(value))) {
        const fullPath = path.join(dirPath, name)
        const stat = await statEntry(fullPath, '检查引擎私有目录')
        if (!stat?.isDirectory() || isLinkEntry(stat)) throwUnsafeLinkError(fullPath)
        await assertRealPathInsideBoundary(boundaryRoot, fullPath, checkPath)
      }
      names = names.filter((name) => !/^__(?:vertex_install_plan_v3|vertex_install_rule|vertex_nexus_rule)__$/i.test(name))
    }
  } catch (error) {
    throw createSnapshotAccessError('读取目录', dirPath, error)
  }

  const entryResults = await runWithConcurrencyLimit(
    names,
    resolveAdaptiveConcurrency(names.length, { base: 8, max: 32 }),
    async (name) => {
      try {
        const fullPath = path.join(dirPath, name)
        const stat = await statEntry(fullPath, '读取目录项')
        if (!stat) {
          throw new InstallEngineError(
            INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
            '目录项在快照读取过程中消失，已停止安装规划',
            { path: fullPath }
          )
        }
        if (isLinkEntry(stat)) {
          throwUnsafeLinkError(fullPath)
        }
        await assertRealPathInsideBoundary(boundaryRoot || dirPath, fullPath, checkPath)
        return {
          entry: {
            name,
            lowerName: toSafeText(name).toLowerCase(),
            fullPath,
            isDirectory: stat?.isDirectory() === true,
            size: Number(stat?.isFile() ? stat.size : 0)
          }
        }
      } catch (error) {
        return { error }
      }
    }
  )
  const failedResult = entryResults.find((item) => item?.error)
  if (failedResult) throw failedResult.error
  return entryResults.map((item) => item.entry)
}

export async function ensureDirectory(pathValue = '') {
  if (!pathValue) return false
  const stat = await statPath(pathValue, '检查目录')
  return stat?.isDirectory() === true
}

export async function collectTopLevelSnapshot(dirPath = '', cache = new Map(), options = {}) {
  const safeDirPath = path.resolve(toSafeText(dirPath))
  const safeCache = cache instanceof Map ? cache : new Map()
  const snapshotOptions = normalizeSnapshotOptions(options)
  const boundaryRoot = snapshotOptions.boundaryRoot || safeDirPath
  const cacheKey = createTopLevelSnapshotCacheKey(safeDirPath, {
    ...snapshotOptions,
    boundaryRoot
  })
  if (safeCache.has(cacheKey)) {
    return safeCache.get(cacheKey)
  }

  await assertSnapshotDirectorySafe(safeDirPath, boundaryRoot)

  const directEntries = await listTopLevelEntries(safeDirPath, boundaryRoot, snapshotOptions.excludeInstallInternal)
  const directDirs = []
  const directFiles = []

  for (const entry of directEntries) {
    if (entry.isDirectory) {
      directDirs.push({
        ...entry,
        relativePath: normalizeRelativeRulePath(entry.name),
        type: 'dir',
        size: 0
      })
      continue
    }

    directFiles.push({
      ...entry,
      relativePath: normalizeRelativeRulePath(entry.name),
      type: 'file',
      size: Number(entry.size || 0),
      ext: path.extname(entry.name || '').toLowerCase()
    })
  }

  const snapshot = {
    dirPath: safeDirPath,
    directEntries,
    directDirs,
    directFiles,
    allDirs: [],
    allFiles: [],
    boundaryRoot,
    maxDepth: snapshotOptions.maxDepth,
    truncatedByDepthLimit: false,
    recursiveLoaded: false,
    excludeInstallInternal: snapshotOptions.excludeInstallInternal
  }
  safeCache.set(cacheKey, snapshot)
  return snapshot
}

export async function collectDirectorySnapshot(dirPath = '', cache = new Map(), options = {}) {
  const safeDirPath = path.resolve(toSafeText(dirPath))
  const safeCache = cache instanceof Map ? cache : new Map()
  const snapshotOptions = normalizeSnapshotOptions(options)
  const boundaryRoot = snapshotOptions.boundaryRoot || safeDirPath
  const effectiveOptions = {
    ...snapshotOptions,
    boundaryRoot
  }
  const cacheKey = createSnapshotCacheKey(safeDirPath, effectiveOptions)
  if (safeCache.has(cacheKey)) {
    return safeCache.get(cacheKey)
  }

  const { directEntries } = await collectTopLevelSnapshot(safeDirPath, safeCache, effectiveOptions)
  const directDirs = []
  const directFiles = []
  const allDirs = []
  const allFiles = []

  for (const entry of directEntries) {
    if (allDirs.length + allFiles.length >= 100000) throw new InstallEngineError('install_engine.snapshot_entry_budget', '安装包超过 100000 项扫描预算')
    if (entry.isDirectory) {
      const dirRecord = {
        ...entry,
        relativePath: normalizeRelativeRulePath(entry.name),
        type: 'dir',
        size: 0
      }
      directDirs.push(dirRecord)
      allDirs.push(dirRecord)

      if (snapshotOptions.currentDepth >= snapshotOptions.maxDepth) {
        throw new InstallEngineError(
          INSTALL_ENGINE_ERROR_CODES.SNAPSHOT_DEPTH_EXCEEDED,
          `安装包目录层级超过扫描上限（${snapshotOptions.maxDepth}），已中止安装，请减少嵌套层级`,
          { maxDepth: snapshotOptions.maxDepth, path: entry.fullPath }
        )
      }

      const childSnapshot = await collectDirectorySnapshot(entry.fullPath, safeCache, {
        ...effectiveOptions,
        currentDepth: snapshotOptions.currentDepth + 1
      })
      if (allDirs.length + allFiles.length + childSnapshot.allDirs.length + childSnapshot.allFiles.length > 100000) throw new InstallEngineError('install_engine.snapshot_entry_budget', '安装包超过 100000 项扫描预算')
      for (const childDir of childSnapshot.allDirs) {
        allDirs.push({
          ...childDir,
          relativePath: normalizeRelativeRulePath(`${entry.name}/${childDir.relativePath}`)
        })
      }
      for (const childFile of childSnapshot.allFiles) {
        allFiles.push({
          ...childFile,
          relativePath: normalizeRelativeRulePath(`${entry.name}/${childFile.relativePath}`)
        })
      }
      continue
    }

    const fileRecord = {
      ...entry,
      relativePath: normalizeRelativeRulePath(entry.name),
      type: 'file',
      size: Number(entry.size || 0),
      ext: path.extname(entry.name || '').toLowerCase()
    }
    directFiles.push(fileRecord)
    allFiles.push(fileRecord)
  }

  const snapshot = {
    dirPath: safeDirPath,
    directEntries,
    directDirs,
    directFiles,
    allDirs,
    allFiles,
    boundaryRoot,
    maxDepth: snapshotOptions.maxDepth,
    truncatedByDepthLimit: false,
    recursiveLoaded: true,
    excludeInstallInternal: snapshotOptions.excludeInstallInternal
  }
  safeCache.set(cacheKey, snapshot)
  return snapshot
}

export async function ensureRecursiveSnapshot(snapshot = {}, cache = new Map(), options = {}) {
  if (snapshot?.recursiveLoaded === true) {
    return snapshot
  }

  const dirPath = toSafeText(snapshot?.dirPath)
  if (!dirPath) {
    return snapshot
  }

  return await collectDirectorySnapshot(dirPath, cache, {
    excludeInstallInternal: snapshot.excludeInstallInternal === true,
    ...options,
    boundaryRoot: options.boundaryRoot || snapshot.boundaryRoot || dirPath
  })
}
