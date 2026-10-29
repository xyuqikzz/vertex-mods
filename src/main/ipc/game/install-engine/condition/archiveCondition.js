/**
 * condition/archiveCondition.js — archive 命名空间条件转换
 *
 * 将 archive.* 命名空间条件转换为扁平 match 字段，交由统一条件评估处理。
 */
import {
  isPlainObject,
  normalizeExtensionList,
  normalizeTextList,
  toSafeNumber,
  toSafeText
} from '../contracts.js'

export function convertArchiveConditionToFlat(kind = '', payload = {}) {
  const normalizedKind = toSafeText(kind).toLowerCase()
  const target = isPlainObject(payload) ? payload : {}
  const paths = normalizeTextList(
    Array.isArray(payload)
      ? payload
      : isPlainObject(payload)
        ? target.path || target.paths || target.pattern || target.patterns || target.include || []
        : payload,
    { pathLike: true }
  )
  const names = normalizeTextList(
    target.name || target.names || target.entry || target.entries || [],
    { lowerCase: true }
  )
  const extensions = normalizeExtensionList(
    target.extension || target.extensions || target.ext || target.exts || []
  )

  if (
    ['has_file', 'file', 'has_files', 'any_files', 'any_file_patterns'].includes(normalizedKind)
  ) {
    if (paths.length) return { any_file_patterns: paths }
    if (names.length) return { any_file_basenames: names }
    return {}
  }
  if (['has_dir', 'dir', 'has_dirs', 'any_dirs', 'any_dir_patterns'].includes(normalizedKind)) {
    if (paths.length) return { any_dir_patterns: paths }
    if (names.length) return { any_dir_basenames: names }
    return {}
  }
  if (['root_has_file', 'root_has_files'].includes(normalizedKind)) {
    if (names.length) return { root_has_files: names }
    if (paths.length) return { root_has_files: paths }
    return {}
  }
  if (['root_has_dir', 'root_has_dirs'].includes(normalizedKind)) {
    if (names.length) return { root_has_dirs: names }
    if (paths.length) return { root_has_dirs: paths }
    return {}
  }
  if (['has_extension', 'extension', 'extensions'].includes(normalizedKind)) {
    return { any_file_extensions: extensions }
  }
  if (normalizedKind === 'file_count') {
    const result = {}
    if (target.min !== undefined || target.gte !== undefined) {
      result.min_file_count = toSafeNumber(target.min ?? target.gte, 0)
    }
    if (target.max !== undefined || target.lte !== undefined) {
      result.max_file_count = toSafeNumber(target.max ?? target.lte, 0)
    }
    return result
  }
  if (normalizedKind === 'root_entry_count') {
    const result = {}
    if (target.min !== undefined || target.gte !== undefined) {
      result.root_entry_count_min = toSafeNumber(target.min ?? target.gte, 0)
    }
    if (target.max !== undefined || target.lte !== undefined) {
      result.root_entry_count_max = toSafeNumber(target.max ?? target.lte, 0)
    }
    return result
  }
  if (['all_file_patterns', 'all_files'].includes(normalizedKind)) {
    return { all_file_patterns: paths }
  }

  return {}
}
