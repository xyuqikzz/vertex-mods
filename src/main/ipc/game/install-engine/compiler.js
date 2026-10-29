/**
 * compiler.js — 统一规则编译模块
 *
 * 职责：
 * 1. 调用 install-rule-compiler 做变量展开
 * 2. 对 install_rules[*].match 做别名规范化（编译阶段完成）
 * 3. 对 install_rules[*].routes 做变量展开（已由 install-rule-compiler 处理）
 * 4. 追加 auto_root_dir_match 规则（已由 install-rule-compiler 处理）
 */

import { expandInstallRuleTemplates } from '../../../../shared/installation/install-rule-declarations.js'
import {
  isPlainObject,
  normalizeTextList,
  normalizeExtensionList,
  toSafeNumber
} from './contracts.js'
import { validateInstallRuleSchema } from './ruleSchemaValidator.js'
import { compileInstallRuleObject } from '../../../../shared/installation/install-rule-compiler.js'
import { InstallEngineError, INSTALL_ENGINE_ERROR_CODES } from './installEngineError.js'

/**
 * match 别名规范化映射表
 * 将所有 camelCase 和其他别名统一到 snake_case 标准字段名
 */
const MATCH_ALIAS_MAP = {
  // root_has_dirs 别名
  rootHasDirs: 'root_has_dirs',
  allRootDirs: 'root_has_dirs',
  all_root_dirs: 'root_has_dirs',
  requiredDirs: 'root_has_dirs',
  required_dirs: 'root_has_dirs',

  // any_root_dirs 别名
  anyRootDirs: 'any_root_dirs',
  rootHasAnyDirs: 'any_root_dirs',
  root_has_any_dirs: 'any_root_dirs',

  // none_root_dirs 别名
  noneRootDirs: 'none_root_dirs',
  rootHasNoDirs: 'none_root_dirs',
  root_has_no_dirs: 'none_root_dirs',

  // root_has_files 别名
  rootHasFiles: 'root_has_files',
  allRootFiles: 'root_has_files',
  all_root_files: 'root_has_files',
  requiredFiles: 'root_has_files',
  required_files: 'root_has_files',

  // any_root_files 别名
  anyRootFiles: 'any_root_files',
  rootHasAnyFiles: 'any_root_files',
  root_has_any_files: 'any_root_files',

  // none_root_files 别名
  noneRootFiles: 'none_root_files',
  rootHasNoFiles: 'none_root_files',
  root_has_no_files: 'none_root_files',

  // any_file_names 别名
  anyFileNames: 'any_file_names',

  // all_file_names 别名
  allFileNames: 'all_file_names',

  // none_file_names 别名
  noneFileNames: 'none_file_names',

  // any_file_patterns 别名
  anyFilePatterns: 'any_file_patterns',
  hasFilePattern: 'any_file_patterns',
  has_file_pattern: 'any_file_patterns',

  // all_file_patterns 别名
  allFilePatterns: 'all_file_patterns',

  // none_file_patterns 别名
  noneFilePatterns: 'none_file_patterns',

  // any_dir_patterns 别名
  anyDirPatterns: 'any_dir_patterns',

  // all_dir_patterns 别名
  allDirPatterns: 'all_dir_patterns',

  // none_dir_patterns 别名
  noneDirPatterns: 'none_dir_patterns',

  // any_file_extensions 别名
  anyFileExtensions: 'any_file_extensions',

  // all_file_extensions 别名
  allFileExtensions: 'all_file_extensions',

  // none_file_extensions 别名
  noneFileExtensions: 'none_file_extensions',

  // min_file_count 别名
  minFileCount: 'min_file_count',

  // max_file_count 别名
  maxFileCount: 'max_file_count',

  // root_entry_count_min 别名
  rootEntryCountMin: 'root_entry_count_min',

  // root_entry_count_max 别名
  rootEntryCountMax: 'root_entry_count_max'
}

/**
 * 需要做路径规范化的列表字段
 */
const PATH_LIST_FIELDS = new Set([
  'any_file_patterns',
  'all_file_patterns',
  'none_file_patterns',
  'any_dir_patterns',
  'all_dir_patterns',
  'none_dir_patterns'
])

/**
 * 需要做扩展名规范化的列表字段
 */
const EXTENSION_LIST_FIELDS = new Set([
  'any_file_extensions',
  'all_file_extensions',
  'none_file_extensions'
])

/**
 * 需要做小写规范化的列表字段
 */
const LOWERCASE_LIST_FIELDS = new Set([
  'root_has_dirs',
  'any_root_dirs',
  'none_root_dirs',
  'root_has_files',
  'any_root_files',
  'none_root_files',
  'any_file_names',
  'all_file_names',
  'none_file_names'
])

/**
 * 数值字段
 */
const NUMERIC_FIELDS = new Set([
  'min_file_count',
  'max_file_count',
  'root_entry_count_min',
  'root_entry_count_max'
])

function mergeIntoListField(target, fieldName, value) {
  if (!value) return
  const valueList = Array.isArray(value) ? value : [value]
  if (!valueList.length) return

  let normalized
  if (PATH_LIST_FIELDS.has(fieldName)) {
    normalized = normalizeTextList(valueList, { pathLike: true })
  } else if (EXTENSION_LIST_FIELDS.has(fieldName)) {
    normalized = normalizeExtensionList(valueList)
  } else if (LOWERCASE_LIST_FIELDS.has(fieldName)) {
    normalized = normalizeTextList(valueList, { lowerCase: true })
  } else {
    normalized = normalizeTextList(valueList)
  }

  if (!normalized.length) return

  if (!Array.isArray(target[fieldName])) {
    target[fieldName] = normalized
  } else {
    const existing = new Set(target[fieldName].map((v) => v.toLowerCase()))
    for (const item of normalized) {
      if (!existing.has(item.toLowerCase())) {
        target[fieldName].push(item)
        existing.add(item.toLowerCase())
      }
    }
  }
}

function normalizeCompositeConditionValue(value, options = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => (isPlainObject(item) ? normalizeMatchAliases(item, options) : item))
  }
  return isPlainObject(value) ? normalizeMatchAliases(value, options) : value
}

/**
 * 将 match 对象中的所有别名字段规范化为标准字段名
 * 编译阶段完成，conditionMatcher 只需处理标准字段
 *
 * @param {object} match - match 对象
 * @param {object} options - 选项
 * @param {Array} options.deprecationWarnings - 如传入则收集弃用警告
 * @param {string} options.fieldPath - 当前字段路径前缀，用于定位
 * @returns {object} 规范化后的 match 对象
 */
export function normalizeMatchAliases(match = {}, options = {}) {
  if (!isPlainObject(match)) return {}

  const result = {}
  const deprecationWarnings = Array.isArray(options.deprecationWarnings) ? options.deprecationWarnings : null
  const fieldPathPrefix = options.fieldPath || 'match'

  for (const [key, value] of Object.entries(match)) {
    if (value === undefined || value === null) continue

    // 组合条件递归规范化
    if (['any_of', 'all', 'any', 'not'].includes(key)) {
      result[key] = normalizeCompositeConditionValue(value, options)
      continue
    }

    // 查找别名映射
    const canonicalName = MATCH_ALIAS_MAP[key] || key

    // 收集弃用警告
    if (deprecationWarnings && MATCH_ALIAS_MAP[key] && key !== canonicalName) {
      deprecationWarnings.push({
        type: 'deprecated_alias',
        field: key,
        canonical: canonicalName,
        path: `${fieldPathPrefix}.${key}`,
        message: `字段 "${key}" 已弃用，请使用标准字段名 "${canonicalName}"`
      })
    }

    if (NUMERIC_FIELDS.has(canonicalName)) {
      // 数值字段：取更严格的值
      const numValue = toSafeNumber(value, null)
      if (numValue === null || !Number.isFinite(numValue)) continue
      if (result[canonicalName] === undefined) {
        result[canonicalName] = numValue
      } else if (canonicalName.endsWith('_min') || canonicalName.startsWith('min_')) {
        result[canonicalName] = Math.max(result[canonicalName], numValue)
      } else {
        result[canonicalName] = Math.min(result[canonicalName], numValue)
      }
    } else if (
      PATH_LIST_FIELDS.has(canonicalName) ||
      EXTENSION_LIST_FIELDS.has(canonicalName) ||
      LOWERCASE_LIST_FIELDS.has(canonicalName)
    ) {
      // 列表字段：合并去重
      mergeIntoListField(result, canonicalName, value)
    } else {
      // 未知字段直接保留（向前兼容）
      if (result[canonicalName] === undefined) {
        result[canonicalName] = value
      }
    }
  }

  return result
}

function normalizeRouteMatch(route = {}, options = {}) {
  if (!isPlainObject(route)) return route

  return {
    ...route,
    match: isPlainObject(route.match) ? normalizeMatchAliases(route.match, options) : route.match,
    when: isPlainObject(route.when) ? normalizeMatchAliases(route.when, options) : route.when
  }
}

/**
 * 对单条规则及其 route 条件做别名规范化
 */
function normalizeRuleMatch(rule = {}, options = {}) {
  if (!isPlainObject(rule)) return rule

  return {
    ...rule,
    match: isPlainObject(rule.match) ? normalizeMatchAliases(rule.match, options) : rule.match,
    when: isPlainObject(rule.when) ? normalizeMatchAliases(rule.when, options) : rule.when,
    routes: Array.isArray(rule.routes) ? rule.routes.map((r) => normalizeRouteMatch(r, options)) : rule.routes
  }
}

/**
 * 编译安装规则 — 统一入口
 *
 * 1. 调用 install-rule-compiler 做变量展开 + auto_root_dir_match
 * 2. 对每条规则的 match 做别名规范化
 *
 * @param {object} rawInstallRule - 原始规则 JSON
 * @returns {object} 编译后的规则对象，install_rules 已规范化
 */
export function compileInstallRule(rawInstallRule = {}) {
  rawInstallRule = expandInstallRuleTemplates(rawInstallRule)
  const schemaDiagnostics = validateInstallRuleSchema(rawInstallRule)
  const schemaVersionVal = rawInstallRule && (rawInstallRule.schema_version ?? rawInstallRule.schemaVersion)
  const schemaVersion = (schemaVersionVal !== undefined && schemaVersionVal !== null && !isNaN(Number(schemaVersionVal))) ? Number(schemaVersionVal) : 4

  if (schemaVersion >= 5 && schemaDiagnostics.errors.length > 0) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_INVALID,
      `规则编译失败: 存在 ${schemaDiagnostics.errors.length} 项严重 Schema 校验错误。${schemaDiagnostics.errors[0].message}`,
      { errors: schemaDiagnostics.errors }
    )
  }
  const compiled = compileInstallRuleObject(
    isPlainObject(rawInstallRule) ? rawInstallRule : {}
  )

  const installRules = Array.isArray(compiled.install_rules)
    ? [...compiled.install_rules]
    : Array.isArray(compiled.installRules)
      ? [...compiled.installRules]
      : []

  const deprecationWarnings = []
  const normalizedRules = installRules.map((rule, index) =>
    normalizeRuleMatch(rule, {
      deprecationWarnings,
      fieldPath: `install_rules[${index}].match`
    })
  )

  // 将别名弃用警告合入 schemaDiagnostics.warnings
  if (deprecationWarnings.length > 0) {
    if (!Array.isArray(schemaDiagnostics.warnings)) {
      schemaDiagnostics.warnings = []
    }
    for (const dw of deprecationWarnings) {
      schemaDiagnostics.warnings.push({
        code: 'deprecated_match_alias',
        path: dw.path,
        message: dw.message,
        suggestion: dw.canonical,
        level: 'warning'
      })
    }
  }

  return {
    ...compiled,
    install_rules: normalizedRules,
    schemaDiagnostics
  }
}
