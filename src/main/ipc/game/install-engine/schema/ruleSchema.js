import { isPlainObject, toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { isValidNumberLike, resolveFirstDefinedValue } from './primitives.js'
import { validateUnknownFields } from './fieldGuards.js'
import { validateMatch } from './matchSchema.js'
import { validateSource } from './sourceSchema.js'
import { validateTarget } from './targetSchema.js'
import { validateRoute, validateGroup } from './routeSchema.js'
import { validateLifecycleStepList } from './lifecycleSchema.js'
import { validateConflictPolicy } from './conflictPolicySchema.js'
import { validateDeclarativeRule } from '../../../../../shared/installation/install-rule-declarations.js'

const RULE_FIELDS = new Set([
  'id',
  'name',
  'description',
  'priority',
  'confidence',
  'weight',
  'match',
  'when',
  'source',
  'target',
  'routes',
  'conflict_policy',
  'conflictPolicy',
  'dependencies',
  'default_dependencies',
  'defaultDependencies',
  'post_install',
  'postInstall',
  'on_enable',
  'onEnable',
  'on_disable',
  'onDisable',
  'on_uninstall',
  'onUninstall',
  'health_expectations',
  'healthExpectations',
  'declarative'
])

export function validateRule(rule = {}, index = 0, diagnostics = [], schemaVersion = 4) {
  const pathPrefix = `install_rules[${index}]`
  if (!isPlainObject(rule)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_rule_type',
      pathPrefix,
      'install_rules 项必须是对象'
    )
    return
  }

  const ruleId = toSafeText(rule.id || rule.name || `rule_${index}`)
  validateUnknownFields(rule, RULE_FIELDS, pathPrefix, diagnostics, ruleId)
  if (rule.declarative !== undefined) {
    try {
      validateDeclarativeRule(rule.declarative, `${pathPrefix}.declarative`)
      if (rule.declarative.fomod) validateTarget(rule.declarative.fomod.target, `${pathPrefix}.declarative.fomod.target`, diagnostics, ruleId, { route: true })
      for (const [i, unit] of (rule.declarative.units || []).entries()) {
        validateTarget(unit.target, `${pathPrefix}.declarative.units[${i}].target`, diagnostics, ruleId, { route: true })
        validateConflictPolicy(unit.conflict_policy, `${pathPrefix}.declarative.units[${i}].conflict_policy`, diagnostics, ruleId)
        validateGroup(unit.group, `${pathPrefix}.declarative.units[${i}].group`, diagnostics, ruleId)
      }
    } catch (error) {
      pushDiagnostic(diagnostics, 'error', 'declaration_invalid', error.detail?.path || pathPrefix, error.message, { ruleId })
    }
  }

  if (rule.priority !== undefined && !isValidNumberLike(rule.priority)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_priority_type',
      `${pathPrefix}.priority`,
      'priority 必须是数字',
      { ruleId }
    )
  }
  if (rule.confidence !== undefined && !isValidNumberLike(rule.confidence)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_confidence_type',
      `${pathPrefix}.confidence`,
      'confidence 必须是数字',
      { ruleId }
    )
  }
  if (rule.match !== undefined)
    validateMatch(rule.match, `${pathPrefix}.match`, diagnostics, ruleId, schemaVersion)
  if (rule.source !== undefined)
    validateSource(rule.source, `${pathPrefix}.source`, diagnostics, ruleId)
  if (rule.source?.paths !== undefined) pushDiagnostic(diagnostics, 'error', 'source_paths_requires_routes', `${pathPrefix}.source.paths`, '精确 paths 集合必须写在 routes[*].source 中', { ruleId })
  if (rule.target !== undefined)
    validateTarget(rule.target, `${pathPrefix}.target`, diagnostics, ruleId)
  validateConflictPolicy(
    rule.conflict_policy ?? rule.conflictPolicy,
    `${pathPrefix}.conflict_policy`,
    diagnostics,
    ruleId
  )
  if (rule.routes !== undefined) {
    if (!Array.isArray(rule.routes)) {
      pushDiagnostic(
        diagnostics,
        'error',
        'invalid_routes_type',
        `${pathPrefix}.routes`,
        'routes 必须是数组',
        { ruleId }
      )
    } else {
      rule.routes.forEach((route, routeIndex) =>
        validateRoute(route, `${pathPrefix}.routes[${routeIndex}]`, diagnostics, ruleId, schemaVersion)
      )
    }
  }

  // E4 / B1：深入校验生命周期阶段步骤结构（动作枚举、参数类型）。
  validateLifecycleStepList(
    resolveFirstDefinedValue(rule.post_install, rule.postInstall),
    `${pathPrefix}.post_install`,
    diagnostics,
    ruleId
  )
  validateLifecycleStepList(
    resolveFirstDefinedValue(rule.on_enable, rule.onEnable),
    `${pathPrefix}.on_enable`,
    diagnostics,
    ruleId
  )
  validateLifecycleStepList(
    resolveFirstDefinedValue(rule.on_disable, rule.onDisable),
    `${pathPrefix}.on_disable`,
    diagnostics,
    ruleId
  )
  validateLifecycleStepList(
    resolveFirstDefinedValue(rule.on_uninstall, rule.onUninstall),
    `${pathPrefix}.on_uninstall`,
    diagnostics,
    ruleId
  )
}
