/**
 * condition/conditionUtils.js — 条件评估纯工具
 *
 * createCheck / buildMissedReason / 命名空间键解析 / 条件值归一 等无状态工具，
 * 供条件分派器与各条件族模块共享。
 */
import path from 'path'
import {
  normalizeExtensionList,
  normalizeRelativeRulePath,
  normalizeTextList,
  toArrayValue,
  toSafeText
} from '../contracts.js'

export function createCheck(scope = '', kind = '', expected = null, matched = false, message = '', extra = {}) {
  let fieldPath = extra.path
  if (!fieldPath) {
    if (scope === 'game') {
      fieldPath = `match.game.${kind}`
    } else if (scope === 'archive') {
      const flatFields = [
        'root_has_dirs', 'any_root_dirs', 'none_root_dirs',
        'root_has_files', 'any_root_files', 'none_root_files',
        'any_file_names', 'all_file_names', 'none_file_names',
        'any_file_basenames', 'any_dir_basenames',
        'any_file_patterns', 'all_file_patterns', 'none_file_patterns',
        'any_dir_patterns', 'all_dir_patterns', 'none_dir_patterns',
        'any_file_extensions', 'all_file_extensions', 'none_file_extensions',
        'min_file_count', 'max_file_count',
        'root_entry_count_min', 'root_entry_count_max',
        'any_of', 'all', 'any', 'not'
      ]
      if (flatFields.includes(kind)) {
        fieldPath = `match.${kind}`
      } else {
        fieldPath = `match.archive.${kind}`
      }
    } else {
      fieldPath = `match.${kind}`
    }
  }

  return {
    scope,
    kind,
    expected,
    matched,
    message,
    path: fieldPath,
    keyword: kind,
    actual: extra.actual ?? null,
    ...(Array.isArray(extra.matchedPaths) ? { matchedPaths: extra.matchedPaths } : {}),
    suggestion: extra.suggestion ?? ''
  }
}

export function buildMissedReason(checks = [], ruleId = '') {
  const failedChecks = checks.filter((item) => item.matched !== true)
  if (!failedChecks.length) return null
  return {
    ruleId,
    code: 'condition_not_met',
    message: toSafeText(failedChecks[0]?.message || '规则条件未命中'),
    details: {
      failedChecks: failedChecks.slice(0, 5)
    }
  }
}

export function extractNamespacedConditionKey(key = '') {
  const safeKey = toSafeText(key).toLowerCase()
  if (!safeKey.includes('.')) return null

  const [scope, ...rest] = safeKey.split('.')
  const normalizedScope = scope.trim()
  const kind = rest.join('.').trim()
  if (!['archive', 'game'].includes(normalizedScope) || !kind) return null

  return {
    scope: normalizedScope,
    kind
  }
}

export function normalizeConditionTextList(value = [], options = {}) {
  const textValues = toArrayValue(value).filter((item) => {
    const type = typeof item
    return type === 'string' || type === 'number'
  })
  return normalizeTextList(textValues, options)
}

export function normalizeConditionExtensionList(value = []) {
  return normalizeExtensionList(normalizeConditionTextList(value))
}

export function normalizeConditionNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

export function getEntryName(entry = {}) {
  return toSafeText(
    entry.name ||
      entry.lowerName ||
      path.posix.basename(normalizeRelativeRulePath(entry.relativePath || ''))
  ).toLowerCase()
}
