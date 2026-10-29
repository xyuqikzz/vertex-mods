import { INSTALL_RULE_TARGET_BASES } from '../../../../../shared/installation/install-rule-declarations.js'
import { isPlainObject, toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'

const TARGET_TYPES = new Set(['game_root', 'game_relative', 'download_relative', 'user_relative'])
const TARGET_BASE_TYPES = new Set(Object.values(INSTALL_RULE_TARGET_BASES).flat())

export function resolveTargetType(target = {}) {
  return toSafeText(target.type || target.target_type || target.targetType).toLowerCase()
}

export function validateTarget(
  target = {},
  pathPrefix = '',
  diagnostics = [],
  ruleId = '',
  options = {}
) {
  if (target === undefined || target === null) return
  if (!isPlainObject(target)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_target_type', pathPrefix, 'target 必须是对象', {
      ruleId
    })
    return
  }

  const targetType = resolveTargetType(target)
  if (targetType && !TARGET_TYPES.has(targetType)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'unsupported_target_type',
      `${pathPrefix}.type`,
      `target.type 不支持 ${targetType}`,
      { ruleId, suggestion: 'game_relative' }
    )
  }

  const baseType = toSafeText(
    target.base ||
      target.base_type ||
      target.baseType ||
      target.scope ||
      target.scope_type ||
      target.scopeType ||
      target.user_scope ||
      target.userScope
  ).toLowerCase()
  if (baseType && !TARGET_BASE_TYPES.has(baseType)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'unsupported_target_base',
      `${pathPrefix}.base_type`,
      `target base/scope 不支持 ${baseType}，请使用受支持的目标基准`,
      { ruleId, suggestion: 'base_type' }
    )
  }

  const pathValue = toSafeText(target.path || target.target_path || target.targetPath)
  const effectiveType = targetType || (options.route ? 'game_relative' : 'game_root')
  if (effectiveType === 'user_relative' && (!pathValue || pathValue === '.')) {
    pushDiagnostic(
      diagnostics,
      'error',
      'missing_target_path',
      `${pathPrefix}.path`,
      'user_relative 类型必须提供非空 target.path',
      { ruleId }
    )
  }
}
