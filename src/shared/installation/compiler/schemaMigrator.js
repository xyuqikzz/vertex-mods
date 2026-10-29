/**
 * compiler/schemaMigrator.js — install_rules schema_version 迁移器（显式、可逆向工具化）
 *
 * 把旧版规则升级到当前 schema：将 match 中的 camelCase 兼容别名重命名为 snake_case
 * 标准字段，并标注 schema_version。该迁移会「激活」标准字段语义，属于显式升级动作，
 * 因此仅供规则编辑/AI 规则写入等工具显式调用，不在运行期编译链中自动应用，避免悄悄
 * 改变历史规则的匹配行为。迁移是幂等的：已是标准字段的规则重复迁移结果不变。
 */
import { isPlainObject } from './compilerUtils.js'

export const CURRENT_RULE_SCHEMA_VERSION = 5

// camelCase / 历史别名 → snake_case 标准字段（与 schema/matchSchema 的别名集对应）。
const MATCH_ALIAS_CANONICAL = Object.freeze({
  rootHasDirs: 'root_has_dirs',
  allRootDirs: 'root_has_dirs',
  all_root_dirs: 'root_has_dirs',
  requiredDirs: 'root_has_dirs',
  required_dirs: 'root_has_dirs',
  anyRootDirs: 'any_root_dirs',
  rootHasAnyDirs: 'any_root_dirs',
  root_has_any_dirs: 'any_root_dirs',
  noneRootDirs: 'none_root_dirs',
  rootHasNoDirs: 'none_root_dirs',
  root_has_no_dirs: 'none_root_dirs',
  rootHasFiles: 'root_has_files',
  allRootFiles: 'root_has_files',
  all_root_files: 'root_has_files',
  requiredFiles: 'root_has_files',
  required_files: 'root_has_files',
  anyRootFiles: 'any_root_files',
  rootHasAnyFiles: 'any_root_files',
  root_has_any_files: 'any_root_files',
  noneRootFiles: 'none_root_files',
  rootHasNoFiles: 'none_root_files',
  root_has_no_files: 'none_root_files',
  anyFileNames: 'any_file_names',
  allFileNames: 'all_file_names',
  noneFileNames: 'none_file_names',
  anyFilePatterns: 'any_file_patterns',
  hasFilePattern: 'any_file_patterns',
  has_file_pattern: 'any_file_patterns',
  allFilePatterns: 'all_file_patterns',
  noneFilePatterns: 'none_file_patterns',
  anyDirPatterns: 'any_dir_patterns',
  allDirPatterns: 'all_dir_patterns',
  noneDirPatterns: 'none_dir_patterns',
  anyFileExtensions: 'any_file_extensions',
  allFileExtensions: 'all_file_extensions',
  noneFileExtensions: 'none_file_extensions',
  minFileCount: 'min_file_count',
  maxFileCount: 'max_file_count',
  rootEntryCountMin: 'root_entry_count_min',
  rootEntryCountMax: 'root_entry_count_max'
})

export function detectRuleSchemaVersion(ruleObject = {}) {
  const source = isPlainObject(ruleObject) ? ruleObject : {}
  const raw = source.schema_version ?? source.schemaVersion
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

function renameMatchAliases(match) {
  if (Array.isArray(match)) {
    return match.map((item) => renameMatchAliases(item))
  }
  if (!isPlainObject(match)) {
    return match
  }

  const result = {}
  for (const [key, value] of Object.entries(match)) {
    const canonical = MATCH_ALIAS_CANONICAL[key] || key
    // 组合条件递归处理
    const nextValue = ['any_of', 'all', 'any', 'not'].includes(canonical)
      ? renameMatchAliases(value)
      : value
    // 与旧版运行期一致：列表合并，数量限制取更严格值，不能丢弃别名约束。
    if (Object.prototype.hasOwnProperty.call(result, canonical)) {
      if (canonical === 'all') {
        result.all = [result.all, nextValue].flat()
      } else if (['min_file_count', 'max_file_count', 'root_entry_count_min', 'root_entry_count_max'].includes(canonical)) {
        const values = [result[canonical], nextValue]
        if (values.every((item) => item !== null && item !== '' && Number.isFinite(Number(item)))) {
          result[canonical] = canonical.startsWith('min_') || canonical.endsWith('_min')
            ? Math.max(...values.map(Number))
            : Math.min(...values.map(Number))
        } else {
          // 变量尚未展开时保留独立约束，交给编译器展开后再求值。
          result.all = [...(Array.isArray(result.all) ? result.all : result.all ? [result.all] : []), { [canonical]: nextValue }]
        }
      } else if (Object.values(MATCH_ALIAS_CANONICAL).includes(canonical)) {
        result[canonical] = [...new Set([result[canonical], nextValue].flat())]
      }
      continue
    }
    result[canonical] = nextValue
  }
  return result
}

function migrateRuleEntry(rule = {}) {
  if (!isPlainObject(rule)) return rule
  const next = { ...rule }
  if (next.match !== undefined) next.match = renameMatchAliases(next.match)
  if (next.when !== undefined) next.when = renameMatchAliases(next.when)
  if (Array.isArray(next.routes)) {
    next.routes = next.routes.map((route) => {
      if (!isPlainObject(route)) return route
      const nextRoute = { ...route }
      if (nextRoute.match !== undefined) nextRoute.match = renameMatchAliases(nextRoute.match)
      if (nextRoute.when !== undefined) nextRoute.when = renameMatchAliases(nextRoute.when)
      return nextRoute
    })
  }
  return next
}

function migrateContainer(source) {
  if (!isPlainObject(source)) return source
  const next = { ...source }
  for (const key of ['install_rules', 'installRules']) {
    if (Array.isArray(next[key])) next[key] = next[key].map(migrateRuleEntry)
  }
  for (const key of ['default_dependencies', 'defaultDependencies']) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].map((dependency) => {
        if (!isPlainObject(dependency)) return dependency
        return dependency.install === undefined
          ? { ...dependency }
          : { ...dependency, install: migrateContainer(dependency.install) }
      })
    }
  }
  if (isPlainObject(next.setup)) next.setup = migrateContainer(next.setup)
  return next
}

/**
 * 将规则对象迁移到目标 schema 版本（默认当前版本）。幂等。
 * @param {object} ruleObject 规则 JSON（建议先经 normalizeInstallRuleJsonShape）
 * @param {{ targetVersion?: number }} options
 * @returns {object} 迁移后的规则对象（新对象，不改原引用）
 */
export function migrateInstallRuleSchema(ruleObject = {}, options = {}) {
  const source = isPlainObject(ruleObject) ? ruleObject : {}
  const targetVersion = Number.isFinite(Number(options.targetVersion))
    ? Math.floor(Number(options.targetVersion))
    : CURRENT_RULE_SCHEMA_VERSION
  const currentVersion = detectRuleSchemaVersion(source)
  if (currentVersion > targetVersion) {
    // 已达目标版本：仅确保标注存在，保持幂等
    return { ...source, schema_version: Math.max(currentVersion, targetVersion) }
  }

  const installRules = Array.isArray(source.install_rules)
    ? source.install_rules
    : Array.isArray(source.installRules)
      ? source.installRules
      : null

  const migrated = { ...migrateContainer(source), schema_version: targetVersion }
  if (installRules) {
    const nextRules = installRules.map((rule) => migrateRuleEntry(rule))
    migrated.install_rules = nextRules
    if (Array.isArray(source.installRules)) {
      migrated.installRules = nextRules
    }
  }
  delete migrated.schemaVersion
  return migrated
}
