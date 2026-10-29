/**
 * routeMaterializer.js — 路由文件物化与清理调度模块
 *
 * 负责在安装前，将匹配到的源文件物理拷贝或调度到临时的物化执行目录中，
 * 并负责扫描和安全清理过期的历史安装计划物化残留目录。
 */

import fs from 'fs-extra'
import path from 'path'
import { toSafeText } from './contracts.js'
import { resolveAdaptiveConcurrency } from './concurrency.js'
import { INSTALL_ENGINE_ERROR_CODES, InstallEngineError } from './installEngineError.js'
import { isPathInside, isRealPathInside } from './pathSafety.js'

const DEFAULT_MATERIALIZE_CONCURRENCY = 5
const DEFAULT_MATERIALIZED_ROOT_TTL_MS = 60 * 60 * 1000

/**
 * 物理复制或创建目录以物化对应的操作
 * @param {object} operation - 拷贝/创建目录操作描述
 * @returns {Promise<void>}
 */
export async function materializeOperation(operation = {}) {
  const stagingBoundary = toSafeText(operation.sourceBoundaryRoot)
  if (stagingBoundary && !isRealPathInside(stagingBoundary, operation.sourcePath)) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '物化目标真实路径越界')
  }
  if (operation.kind === 'dir') {
    await fs.ensureDir(operation.sourcePath)
    return
  }
  const copySource = operation.originalSourcePath || operation.sourcePath
  const sourceBoundaryRoot = toSafeText(
    operation.sourceBoundaryRoot || operation.boundaryRoot || operation.sourceRoot
  )
  // B2：物化前拒绝符号链接源，避免把指向 staging/解压边界外的链接带入安装链路。
  const sourceStat = await fs.lstat(copySource).catch(() => null)
  if (sourceStat && sourceStat.isSymbolicLink()) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
      `物化源为符号链接，已阻止安装：${copySource}`
    )
  }
  if (sourceBoundaryRoot && !isRealPathInside(sourceBoundaryRoot, copySource)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      `物化源真实路径越界，已阻止安装：${copySource}`
    )
  }
  await fs.ensureDir(path.dirname(operation.sourcePath))
  if (stagingBoundary && !isRealPathInside(stagingBoundary, operation.sourcePath)) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '物化目标路径在写入前发生变化')
  }
  await fs.copy(copySource, operation.sourcePath, {
    overwrite: true,
    errorOnExist: false,
    dereference: false
  })
}

/**
 * 解析物化并发限制
 * @param {object} context - 规划上下文
 * @returns {number} 并发度
 */
export function resolveMaterializeConcurrency(context = {}, itemCount = null) {
  const concurrency = Number(context.materializeConcurrency || context.v3MaterializeConcurrency)
  if (Number.isFinite(concurrency) && concurrency > 0) {
    return Math.max(1, Math.floor(concurrency))
  }
  // 未显式配置时：提供条目数则按规模自适应（上限 16），否则回退固定默认值。
  if (context.adaptiveConcurrency === false || itemCount === null) {
    return DEFAULT_MATERIALIZE_CONCURRENCY
  }
  return resolveAdaptiveConcurrency(itemCount, { base: DEFAULT_MATERIALIZE_CONCURRENCY, max: 16 })
}

/**
 * 解析物化目录的存活 TTL (毫秒)
 * @param {object} context - 规划上下文
 * @returns {number} TTL 毫秒数
 */
export function resolveMaterializedRootTtlMs(context = {}) {
  const value = Number(context.materializedRootTtlMs || context.v3MaterializedRootTtlMs)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MATERIALIZED_ROOT_TTL_MS
  return Math.max(1, Math.floor(value))
}

/**
 * 清理过期的历史安装计划物化临时目录
 * @param {string} containerRoot - 存放物化目录的容器根路径
 * @param {object} context - 规划上下文
 * @returns {Promise<void>}
 */
export async function cleanupExpiredMaterializedRoots(containerRoot = '', context = {}) {
  const safeContainerRoot = path.resolve(toSafeText(containerRoot))
  const maxAgeMs = resolveMaterializedRootTtlMs(context)
  const expiredBefore = Date.now() - maxAgeMs
  const entries = await fs.readdir(safeContainerRoot, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const childRoot = path.resolve(safeContainerRoot, entry.name)
    if (!isPathInside(safeContainerRoot, childRoot)) continue

    try {
      const stat = await fs.stat(childRoot)
      const lastTouchedAt = Number(stat.mtimeMs || stat.ctimeMs || 0)
      if (!lastTouchedAt || lastTouchedAt > expiredBefore) continue
      await fs.remove(childRoot)
    } catch (error) {
      console.debug('清理过期安装计划物化目录失败', {
        path: childRoot,
        message: toSafeText(error?.message || error)
      })
    }
  }
}
