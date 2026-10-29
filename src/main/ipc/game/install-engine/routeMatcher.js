/**
 * routeMatcher.js — 路由匹配与过滤模块
 *
 * 负责解析和决定哪些源文件/目录应该被特定的 route 选中。
 * 支持大小写敏感度判定、包含/排除模式过滤，以及 stripPrefix 根目录判定。
 */

import { isPlainObject, normalizeRelativeRulePath } from './contracts.js'
import {
  collectRouteExcludePatterns,
  collectRouteIncludePatterns,
  isRouteSourcePathMatched
} from './pathMapper.js'

/**
 * 判定当前路由匹配是否大小写敏感
 * @param {object} route - 路由配置
 * @returns {boolean} 是否大小写敏感
 */
export function isRouteCaseSensitive(route = {}) {
  const mapping = isPlainObject(route.mapping) ? route.mapping : {}
  const source = isPlainObject(route.source) ? route.source : {}
  return (
    mapping.case_sensitive === true ||
    mapping.caseSensitive === true ||
    source.case_sensitive === true ||
    source.caseSensitive === true
  )
}

/**
 * 判定当前目录项是否属于需要被裁剪（strip_prefix）的源根目录
 * @param {object} entry - 快照目录/文件条目
 * @param {object} mapping - 路由映射配置
 * @param {object} route - 路由配置
 * @returns {boolean} 是否为需要被裁剪的根目录项
 */
export function isStripPrefixRootDirectory(entry = {}, mapping = {}, route = {}) {
  if (entry.type !== 'dir') return false
  const stripPrefix = normalizeRelativeRulePath(mapping.strip_prefix || mapping.stripPrefix || '')
  if (!stripPrefix) return false
  const sourcePath = normalizeRelativeRulePath(entry.relativePath)
  if (isRouteCaseSensitive(route)) {
    return sourcePath === stripPrefix
  }
  return sourcePath.toLowerCase() === stripPrefix.toLowerCase()
}

/**
 * 判定当前条目是否被路由 include 规则包含
 * @param {object} entry - 快照条目
 * @param {object} route - 路由配置
 * @returns {boolean} 是否包含
 */
export function isEntryIncludedByRoute(entry = {}, route = {}) {
  const source = isPlainObject(route.source) ? route.source : {}
  if (Array.isArray(source.paths)) {
    return source.paths.some((value) => String(value).toLowerCase() === entry.relativePath.toLowerCase())
  }
  const includePatterns = collectRouteIncludePatterns(source)
  if (!includePatterns.length) {
    return entry.type === 'file'
  }
  return isRouteSourcePathMatched(entry.relativePath, includePatterns, {
    caseSensitive: isRouteCaseSensitive(route)
  })
}

/**
 * 判定当前条目是否被路由 exclude 规则排除
 * @param {object} entry - 快照条目
 * @param {object} route - 路由配置
 * @returns {boolean} 是否排除
 */
export function isEntryExcludedByRoute(entry = {}, route = {}) {
  const source = isPlainObject(route.source) ? route.source : {}
  const excludePatterns = collectRouteExcludePatterns(source)
  if (!excludePatterns.length) return false
  return isRouteSourcePathMatched(entry.relativePath, excludePatterns, {
    caseSensitive: isRouteCaseSensitive(route)
  })
}
