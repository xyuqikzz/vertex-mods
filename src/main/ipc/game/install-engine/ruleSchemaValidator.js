import { isPlainObject } from './contracts.js'
import { pushDiagnostic } from './schema/diagnostics.js'
import { isValidNumberLike, resolveFirstDefinedValue } from './schema/primitives.js'
import { validateUnknownFields } from './schema/fieldGuards.js'
import { validateRule } from './schema/ruleSchema.js'
import { validateDependencyProvider } from './schema/dependencyProviderSchema.js'
import { expandInstallRuleTemplates } from '../../../../shared/installation/install-rule-declarations.js'

const TOP_LEVEL_FIELDS = new Set([
  'schema_version',
  'schemaVersion',
  'variables',
  'vars',
  'install_rules',
  'installRules',
  'engine',
  'game',
  'game_detect',
  'gameDetect',
  'default_dependencies',
  'defaultDependencies',
  'setup',
  'requires',
  'templates',
  'use_templates'
  , 'template_versions'
])

function resolveInstallRules(ruleObject = {}) {
  if (Array.isArray(ruleObject.install_rules)) return ruleObject.install_rules
  if (Array.isArray(ruleObject.installRules)) return ruleObject.installRules
  return []
}

function collectInstallRulesTypeError(ruleObject = {}, diagnostics = []) {
  if (
    ruleObject.install_rules !== undefined &&
    ruleObject.install_rules !== null &&
    !Array.isArray(ruleObject.install_rules)
  ) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_install_rules_type',
      'install_rules',
      'install_rules 必须是数组'
    )
  }
  if (
    ruleObject.installRules !== undefined &&
    ruleObject.installRules !== null &&
    !Array.isArray(ruleObject.installRules)
  ) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_install_rules_type',
      'installRules',
      'installRules 必须是数组，推荐使用 install_rules'
    )
  }
}

export function validateInstallRuleSchema(ruleObject = {}) {
  const diagnostics = []
  let safeRuleObject = isPlainObject(ruleObject) ? ruleObject : {}
  try { safeRuleObject = expandInstallRuleTemplates(safeRuleObject) } catch (error) {
    pushDiagnostic(diagnostics, 'error', 'declaration_invalid', error.detail?.path || 'install_rule', error.message)
  }

  if (!isPlainObject(ruleObject)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_rule_object',
      'install_rule',
      '安装规则必须是对象'
    )
  }

  validateUnknownFields(safeRuleObject, TOP_LEVEL_FIELDS, '', diagnostics)
  collectInstallRulesTypeError(safeRuleObject, diagnostics)

  if (
    safeRuleObject.schema_version !== undefined &&
    safeRuleObject.schema_version !== null &&
    !isValidNumberLike(safeRuleObject.schema_version)
  ) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_schema_version_type',
      'schema_version',
      'schema_version 必须是数字'
    )
  }
  if (
    safeRuleObject.schemaVersion !== undefined &&
    safeRuleObject.schemaVersion !== null &&
    !isValidNumberLike(safeRuleObject.schemaVersion)
  ) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_schema_version_type',
      'schemaVersion',
      'schemaVersion 必须是数字，推荐使用 schema_version'
    )
  }
  if (
    safeRuleObject.variables !== undefined &&
    safeRuleObject.variables !== null &&
    !isPlainObject(safeRuleObject.variables)
  ) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_variables_type',
      'variables',
      'variables 必须是对象'
    )
  }
  if (
    safeRuleObject.vars !== undefined &&
    safeRuleObject.vars !== null &&
    !isPlainObject(safeRuleObject.vars)
  ) {
    pushDiagnostic(diagnostics, 'error', 'invalid_variables_type', 'vars', 'vars 必须是对象')
  }

  const schemaVersionVal = resolveFirstDefinedValue(safeRuleObject.schema_version, safeRuleObject.schemaVersion)
  const schemaVersion = isValidNumberLike(schemaVersionVal) ? Number(schemaVersionVal) : 4

  resolveInstallRules(safeRuleObject).forEach((rule, index) =>
    validateRule(rule, index, diagnostics, schemaVersion)
  )

  // H12/O8：递归校验 default_dependencies[*].provider 字段名 +
  // default_dependencies[*].install.install_rules[*]（结构与顶层 install_rules 一致）。
  const defaultDeps = Array.isArray(safeRuleObject.default_dependencies)
    ? safeRuleObject.default_dependencies
    : Array.isArray(safeRuleObject.defaultDependencies)
      ? safeRuleObject.defaultDependencies
      : []
  defaultDeps.forEach((dep, index) => {
    validateDependencyProvider(dep, `default_dependencies[${index}]`, diagnostics, '')
    const depInstall = dep?.install
    if (isPlainObject(depInstall)) {
      const depInstallRules = Array.isArray(depInstall.install_rules)
        ? depInstall.install_rules
        : Array.isArray(depInstall.installRules)
          ? depInstall.installRules
          : []
      depInstallRules.forEach((rule, ruleIndex) =>
        validateRule(rule, ruleIndex, diagnostics, schemaVersion)
      )
    }
  })

  // H12/O8：同样处理 setup.default_dependencies
  const setupObj = isPlainObject(safeRuleObject.setup) ? safeRuleObject.setup : {}
  const setupDeps = Array.isArray(setupObj.default_dependencies)
    ? setupObj.default_dependencies
    : Array.isArray(setupObj.defaultDependencies)
      ? setupObj.defaultDependencies
      : []
  setupDeps.forEach((dep, index) => {
    validateDependencyProvider(dep, `setup.default_dependencies[${index}]`, diagnostics, '')
    const depInstall = dep?.install
    if (isPlainObject(depInstall)) {
      const depInstallRules = Array.isArray(depInstall.install_rules)
        ? depInstall.install_rules
        : Array.isArray(depInstall.installRules)
          ? depInstall.installRules
          : []
      depInstallRules.forEach((rule, ruleIndex) =>
        validateRule(rule, ruleIndex, diagnostics, schemaVersion)
      )
    }
  })

  const warnings = diagnostics.filter((item) => item.level === 'warning')
  const errors = diagnostics.filter((item) => item.level === 'error')
  return {
    warnings,
    errors,
    ruleDiagnostics: diagnostics
  }
}
