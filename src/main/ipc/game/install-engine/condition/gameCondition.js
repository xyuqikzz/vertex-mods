/**
 * condition/gameCondition.js — game 命名空间条件评估
 *
 * 检查游戏目录中是否存在指定文件/目录（边界安全校验，禁止越出 gameRoot）。
 */
import path from 'path'
import fs from 'fs-extra'
import { isPlainObject, normalizeTextList, toSafeText } from '../contracts.js'
import { ensureDirectory } from '../fsSnapshot.js'
import { isRealPathInside, normalizeSafeRelativePath } from '../pathSafety.js'
import { createCheck } from './conditionUtils.js'
import { matchGlobPattern } from '../globMatcher.js'
import { InstallEngineError, INSTALL_ENGINE_ERROR_CODES } from '../installEngineError.js'

async function matchGamePath(gameRoot, pattern, kind) {
  const normalized = normalizeSafeRelativePath(pattern, { allowDotSegment: true })
  const parts = normalized.split('/')
  const wildcardAt = parts.findIndex((part) => /[*?]/.test(part))
  const baseParts = wildcardAt < 0 ? parts : parts.slice(0, wildcardAt)
  const base = path.resolve(gameRoot, ...baseParts)
  const accepts = (stat) => kind === 'has_file' ? stat.isFile() : stat.isDirectory()
  const statSafe = async (target) => {
    if (!isRealPathInside(gameRoot, target)) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '游戏条件路径越界')
    return fs.stat(target).catch((error) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
      throw error
    })
  }
  const stat = await statSafe(base)
  if (!stat) return false
  if (wildcardAt < 0) return accepts(stat)
  if (matchGlobPattern(normalized, path.relative(gameRoot, base).replace(/\\/g, '/')) && accepts(stat)) return true
  if (!stat.isDirectory()) return false
  const pending = [{ dir: base, depth: 0 }]
  let visited = 0
  while (pending.length) {
    const { dir, depth } = pending.pop()
    if (depth > 32) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.SNAPSHOT_DEPTH_EXCEEDED, '游戏条件扫描超过深度预算')
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++visited > 20000) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.SNAPSHOT_DEPTH_EXCEEDED, '游戏条件扫描超过条目预算，请缩小查询目录')
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '游戏条件扫描遇到符号链接或目录联接，请使用明确路径')
      const relative = path.relative(gameRoot, full).replace(/\\/g, '/')
      if (matchGlobPattern(normalized, relative) && accepts(entry)) return true
      // 不含 ** 的 glob 只需要扫描模式所覆盖的层数。
      if (entry.isDirectory() && (normalized.includes('**') || depth < parts.length - wildcardAt - 1)) pending.push({ dir: full, depth: depth + 1 })
    }
  }
  return false
}

export async function evaluateGameCondition(kind = '', payload = {}, context = {}) {
  const gameRoot = toSafeText(context.gameRoot)
  const normalizedKind = toSafeText(kind).toLowerCase()
  if (!['has_file', 'has_dir'].includes(normalizedKind)) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.RULE_INVALID, `不支持的 game 条件 ${normalizedKind}`)
  }
  const target = isPlainObject(payload) ? payload : {}
  const paths = normalizeTextList(
    Array.isArray(payload)
      ? payload
      : isPlainObject(payload)
        ? target.path || target.paths || target.pattern || target.patterns || []
        : payload,
    { pathLike: true }
  )

  if (!paths.length) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.RULE_INVALID, 'game 条件缺少有效路径或模式')

  if (!gameRoot || !(await ensureDirectory(gameRoot))) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_MISSING, '游戏目录不存在或不可访问，无法判断环境条件')
  }

  let conditionMatched = false
  for (const relativePath of paths) {
    conditionMatched = await matchGamePath(gameRoot, relativePath, normalizedKind)
    if (conditionMatched) break
  }

  const message = conditionMatched ? '游戏目录条件已命中' : `游戏目录中缺少期望的${normalizedKind === 'has_dir' ? '目录' : '文件'}: ${paths.join(', ')}`
  const extra = {
    actual: conditionMatched ? '已存在' : '未找到',
    suggestion: conditionMatched ? '' : `未在游戏安装目录中找到依赖项 [${paths.join(', ')}]。请确保该前置模组或游戏核心库已正确安装。`
  }

  return createCheck(
    'game',
    normalizedKind,
    paths,
    conditionMatched,
    message,
    extra
  )
}
