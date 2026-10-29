import { isPlainObject } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { isValidTextList, isValidNumberLike, hasTextValue } from './primitives.js'
import { TYPO_SUGGESTIONS } from './fieldGuards.js'
import { convertArchiveConditionToFlat } from '../condition/archiveCondition.js'

function validateNamespace(scope, kind, value, path, diagnostics, ruleId, schemaVersion) {
  if (schemaVersion < 5) return
  const gamePaths = isPlainObject(value) ? value.path || value.paths || value.pattern || value.patterns : value
  const supported = scope === 'game'
    ? ['has_file', 'has_dir'].includes(kind) && isValidTextList(gamePaths) && hasTextValue(gamePaths)
    : scope === 'archive' && Object.keys(convertArchiveConditionToFlat(kind, value)).length > 0
  if (!supported) pushDiagnostic(diagnostics, 'error', 'unsupported_match_condition', path, `不支持或缺少参数的 ${scope}.${kind} 条件`, { ruleId })
  if (isPlainObject(value)) {
    const allowed = scope === 'game' ? ['path', 'paths', 'pattern', 'patterns'] : ['path', 'paths', 'pattern', 'patterns', 'include', 'name', 'names', 'entry', 'entries', 'extension', 'extensions', 'ext', 'exts', 'min', 'max', 'gte', 'lte']
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) pushDiagnostic(diagnostics, 'error', 'unknown_match_field', `${path}.${key}`, `条件参数 ${key} 无法执行`, { ruleId })
    }
  }
}

const MATCH_FIELDS = new Set([
  'root_has_dirs',
  'any_root_dirs',
  'none_root_dirs',
  'root_has_files',
  'any_root_files',
  'none_root_files',
  'any_file_names',
  'all_file_names',
  'none_file_names',
  'any_file_basenames',
  'any_dir_basenames',
  'any_file_patterns',
  'all_file_patterns',
  'none_file_patterns',
  'any_dir_patterns',
  'all_dir_patterns',
  'none_dir_patterns',
  'any_file_extensions',
  'all_file_extensions',
  'none_file_extensions',
  'min_file_count',
  'max_file_count',
  'root_entry_count_min',
  'root_entry_count_max',
  'any_of',
  'all',
  'any',
  'not',
  'archive',
  'game'
])

const MATCH_ALIAS_FIELDS = new Set([
  'rootHasDirs',
  'allRootDirs',
  'all_root_dirs',
  'requiredDirs',
  'required_dirs',
  'anyRootDirs',
  'rootHasAnyDirs',
  'root_has_any_dirs',
  'noneRootDirs',
  'rootHasNoDirs',
  'root_has_no_dirs',
  'rootHasFiles',
  'allRootFiles',
  'all_root_files',
  'requiredFiles',
  'required_files',
  'anyRootFiles',
  'rootHasAnyFiles',
  'root_has_any_files',
  'noneRootFiles',
  'rootHasNoFiles',
  'root_has_no_files',
  'anyFileNames',
  'allFileNames',
  'noneFileNames',
  'anyFilePatterns',
  'hasFilePattern',
  'has_file_pattern',
  'allFilePatterns',
  'noneFilePatterns',
  'anyDirPatterns',
  'allDirPatterns',
  'noneDirPatterns',
  'anyFileExtensions',
  'allFileExtensions',
  'noneFileExtensions',
  'minFileCount',
  'maxFileCount',
  'rootEntryCountMin',
  'rootEntryCountMax'
])

const MATCH_LIST_FIELDS = new Set([
  'root_has_dirs',
  'any_root_dirs',
  'none_root_dirs',
  'root_has_files',
  'any_root_files',
  'none_root_files',
  'any_file_names',
  'all_file_names',
  'none_file_names',
  'any_file_basenames',
  'any_dir_basenames',
  'any_file_patterns',
  'all_file_patterns',
  'none_file_patterns',
  'any_dir_patterns',
  'all_dir_patterns',
  'none_dir_patterns',
  'any_file_extensions',
  'all_file_extensions',
  'none_file_extensions'
])

const MATCH_NUMBER_FIELDS = new Set([
  'min_file_count',
  'max_file_count',
  'root_entry_count_min',
  'root_entry_count_max'
])

export function validateMatch(
  match = {},
  pathPrefix = '',
  diagnostics = [],
  ruleId = '',
  schemaVersion = 4
) {
  if (!isPlainObject(match)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_match_type', pathPrefix, 'match 必须是对象', {
      ruleId
    })
    return
  }

  for (const [key, value] of Object.entries(match)) {
    if (key.includes('.')) {
      const [scope, ...parts] = key.split('.')
      validateNamespace(scope, parts.join('.'), value, `${pathPrefix}.${key}`, diagnostics, ruleId, schemaVersion)
      continue
    }
    if (MATCH_ALIAS_FIELDS.has(key)) {
      const isError = schemaVersion >= 5
      pushDiagnostic(
        diagnostics,
        isError ? 'error' : 'warning',
        'deprecated_match_alias',
        `${pathPrefix}.${key}`,
        isError
          ? `match 字段 ${key} 是已弃用的兼容别名，在 schema_version >= 5 时禁止使用，请使用 snake_case 标准字段`
          : `match 字段 ${key} 是兼容别名，推荐使用 snake_case 标准字段`,
        { ruleId }
      )
      continue
    }
    if (!MATCH_FIELDS.has(key)) {
      const suggestion = TYPO_SUGGESTIONS[key]
      pushDiagnostic(
        diagnostics,
        suggestion || schemaVersion >= 5 ? 'error' : 'warning',
        suggestion ? 'field_typo' : 'unknown_match_field',
        `${pathPrefix}.${key}`,
        suggestion
          ? `字段 ${key} 可能是拼写错误，推荐使用 ${suggestion}`
          : schemaVersion >= 5 ? `未知 match 字段 ${key} 无法执行` : `未知 match 字段 ${key} 将按兼容策略保留`,
        { ruleId, suggestion }
      )
      continue
    }

    if (MATCH_LIST_FIELDS.has(key) && !isValidTextList(value)) {
      pushDiagnostic(
        diagnostics,
        'error',
        'invalid_match_field_type',
        `${pathPrefix}.${key}`,
        `${key} 必须是字符串、数字或由字符串/数字组成的数组`,
        { ruleId }
      )
    }
    if (MATCH_NUMBER_FIELDS.has(key) && !isValidNumberLike(value)) {
      pushDiagnostic(
        diagnostics,
        'error',
        'invalid_match_field_type',
        `${pathPrefix}.${key}`,
        `${key} 必须是数字`,
        { ruleId }
      )
    }
    if (['any_of', 'all', 'any', 'not'].includes(key)) {
      const list = Array.isArray(value) ? value : [value]
      if (!list.every(isPlainObject)) {
        pushDiagnostic(
          diagnostics,
          'error',
          'invalid_match_group_type',
          `${pathPrefix}.${key}`,
          `${key} 必须是 match 对象或 match 对象数组`,
          { ruleId }
        )
        continue
      }
      list.forEach((item, index) =>
        validateMatch(item, `${pathPrefix}.${key}[${index}]`, diagnostics, ruleId, schemaVersion)
      )
    }
    if ((key === 'archive' || key === 'game') && !isPlainObject(value)) {
      pushDiagnostic(
        diagnostics,
        'error',
        'invalid_match_namespace_type',
        `${pathPrefix}.${key}`,
        `${key} 命名空间条件必须是对象`,
        { ruleId }
      )
    }
    if ((key === 'archive' || key === 'game') && isPlainObject(value)) {
      for (const [kind, payload] of Object.entries(value)) validateNamespace(key, kind, payload, `${pathPrefix}.${key}.${kind}`, diagnostics, ruleId, schemaVersion)
    }
  }
}
