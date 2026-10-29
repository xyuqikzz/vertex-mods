import fs from 'fs'
import path from 'path'
import { INSTALL_ENGINE_ERROR_CODES, InstallEngineError } from './installEngineError.js'

// Windows 保留设备名：作为任意路径段（忽略大小写与扩展名）都不允许出现。
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

function normalizePathLike(input = '') {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

// NUL 与控制字符（U+0000 ~ U+001F）在文件路径中均不合法，常被用于绕过校验。
function hasControlOrNullChar(text = '') {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(String(text || ''))
}

// 判断某个路径段是否命中 Windows 保留设备名（CON / NUL / COM1 等，含 CON.txt 形式）。
function isWindowsReservedSegment(segment = '') {
  const baseName = String(segment || '')
    .split('.')[0]
    .trim()
    .toUpperCase()
  return WINDOWS_RESERVED_NAMES.has(baseName)
}

export function isPathInside(parentPath = '', childPath = '') {
  const safeParent = path.resolve(String(parentPath || ''))
  const safeChild = path.resolve(String(childPath || ''))
  const compareParent = safeParent.toLowerCase()
  const compareChild = safeChild.toLowerCase()
  return compareChild === compareParent || compareChild.startsWith(`${compareParent}${path.sep}`)
}

/**
 * 解析路径的真实物理位置：对存在的路径用 fs.realpath 解析符号链接 / junction / 8.3 短名；
 * 对尚不存在的路径（如待写入的目标文件），回退到「最近存在祖先的真实路径 + 剩余段」。
 *
 * @param {string} targetPath 待解析路径
 * @returns {string} 真实物理路径（尽力解析）
 */
function realpathNearestExisting(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''))
  if (!resolved) return resolved

  let current = resolved
  const tailSegments = []
  for (let guard = 0; guard < 4096; guard += 1) {
    try {
      const realCurrent =
        typeof fs.realpathSync.native === 'function'
          ? fs.realpathSync.native(current)
          : fs.realpathSync(current)
      return tailSegments.length ? path.resolve(realCurrent, ...tailSegments) : realCurrent
    } catch {
      const parent = path.dirname(current)
      if (!parent || parent === current) {
        return resolved
      }
      tailSegments.unshift(path.basename(current))
      current = parent
    }
  }
  return resolved
}

/**
 * 在解析符号链接 / junction / 8.3 短名后再判断 child 是否仍位于 parent 边界内。
 * 用于关键落盘点的二次校验，防止 symlink/junction 逃逸（B2）。
 *
 * @param {string} parentPath 边界根目录
 * @param {string} childPath 子路径
 * @returns {boolean} 解析真实路径后 child 是否仍在 parent 内
 */
export function isRealPathInside(parentPath = '', childPath = '') {
  try {
    const safeParent = realpathNearestExisting(parentPath)
    const safeChild = realpathNearestExisting(childPath)
    return isPathInside(safeParent, safeChild)
  } catch {
    // realpath 出现意外错误时退回基于字符串的保守判断，避免误放行
    return isPathInside(parentPath, childPath)
  }
}

/** 一次规划批次内共享解析结果；禁止用于实际写入校验或跨请求缓存。 */
export function createPlanningPathChecker() {
  const resolvedPaths = new Map()
  const resolveExisting = (input) => {
    const absolute = path.resolve(input)
    if (!resolvedPaths.has(absolute)) {
      const resolving = new Promise((resolve, reject) => {
        const realpath = fs.realpath.native || fs.realpath
        realpath(absolute, (error, value) => error ? reject(error) : resolve(value))
      }).catch(async (error) => {
        // 只有尚不存在的目标可回溯父目录；权限、IO、循环链接错误必须阻止规划。
        if (error.code !== 'ENOENT') throw error
        const parent = path.dirname(absolute)
        if (parent === absolute) throw error
        return path.join(await resolveExisting(parent), path.basename(absolute))
      })
      resolvedPaths.set(absolute, resolving)
    }
    return resolvedPaths.get(absolute)
  }
  return async (parent, child) => {
    if (!isPathInside(parent, child)) return false
    const [realParent, realChild] = await Promise.all([resolveExisting(parent), resolveExisting(child)])
    return isPathInside(realParent, realChild)
  }
}

export function normalizeSafeRelativePath(input = '', options = {}) {
  // 先做 Unicode NFC 归一，抵御同形/不同编码绕过；再裁剪首尾空白。
  const rawText = String(input ?? '')
    .normalize('NFC')
    .trim()
  const normalizedPath = normalizePathLike(rawText)
  const pathParts = normalizedPath.split('/').filter(Boolean)
  const allowDotSegment = options?.allowDotSegment === true
  const hasUnsafeBoundary =
    !normalizedPath ||
    path.isAbsolute(rawText) ||
    /^[A-Za-z]:/.test(rawText) ||
    rawText.startsWith('\\\\') ||
    rawText.startsWith('//') ||
    hasControlOrNullChar(rawText) ||
    pathParts.some(
      (item) =>
        item === '..' ||
        (!allowDotSegment && item === '.') ||
        isWindowsReservedSegment(item)
    )

  if (hasUnsafeBoundary) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
      String(options?.errorMessage || '规则路径不安全，已阻止安装')
    )
  }

  return normalizedPath
}

export function resolveSafeRelativeChildPath(baseRoot = '', relativePath = '', options = {}) {
  const safeBaseRoot = path.resolve(String(baseRoot || ''))
  const normalizedPath = normalizeSafeRelativePath(relativePath, options)
  const childPath = path.resolve(
    safeBaseRoot,
    ...normalizedPath.split('/').filter((item) => item && item !== '.')
  )

  if (!isPathInside(safeBaseRoot, childPath)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      String(options?.boundaryErrorMessage || '规则路径越界，已阻止安装')
    )
  }

  return {
    relativePath: normalizedPath,
    fullPath: childPath
  }
}
