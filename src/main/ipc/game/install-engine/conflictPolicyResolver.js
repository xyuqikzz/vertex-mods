/**
 * conflictPolicyResolver.js — per-route 冲突策略解析（单一来源）
 *
 * 统一归一冲突策略枚举、rule 默认 + route 覆盖的继承关系，以及「目标文件已存在」
 * 情形下按策略推导的动作/备份/风险。默认策略为 backup（覆盖并备份 + 提示确认），
 * 与历史默认行为完全等价，因此未声明 conflict_policy 时行为零变更。
 */
import { toSafeText } from './contracts.js'
import { InstallEngineError } from './installEngineError.js'

export const CONFLICT_POLICY = Object.freeze({
  OVERWRITE: 'overwrite',
  SKIP: 'skip',
  FAIL: 'fail',
  BACKUP: 'backup',
  MERGE: 'merge'
})

export const DEFAULT_CONFLICT_POLICY = CONFLICT_POLICY.BACKUP
export const MERGE_POLICY_NOT_SUPPORTED_CODE = 'merge_policy_not_supported'
export const MERGE_POLICY_NOT_SUPPORTED_MESSAGE =
  '当前版本不支持通用 merge，不能按 backup 或 overwrite 降级执行；请改用 overwrite、skip、fail 或 backup。'

const VALID_POLICIES = new Set(Object.values(CONFLICT_POLICY))

export function normalizeConflictPolicy(value) {
  const text = toSafeText(value).toLowerCase()
  return VALID_POLICIES.has(text) ? text : null
}

export function assertExecutableConflictPolicy(value) {
  const policy = normalizeConflictPolicy(value)
  if (policy === CONFLICT_POLICY.MERGE) {
    throw new InstallEngineError(
      MERGE_POLICY_NOT_SUPPORTED_CODE,
      MERGE_POLICY_NOT_SUPPORTED_MESSAGE
    )
  }
  return policy
}

export function resolveRuleConflictPolicy(rule = {}) {
  const policy =
    normalizeConflictPolicy(rule?.conflict_policy ?? rule?.conflictPolicy) || DEFAULT_CONFLICT_POLICY
  return assertExecutableConflictPolicy(policy) || DEFAULT_CONFLICT_POLICY
}

export function resolveRouteConflictPolicy(route = {}, ruleDefault = DEFAULT_CONFLICT_POLICY) {
  const policy =
    normalizeConflictPolicy(route?.conflict_policy ?? route?.conflictPolicy) ||
    normalizeConflictPolicy(ruleDefault) ||
    DEFAULT_CONFLICT_POLICY
  return assertExecutableConflictPolicy(policy) || DEFAULT_CONFLICT_POLICY
}

/**
 * 目标文件已存在时，按冲突策略推导变更动作。
 * @returns {{ action: string, backupRequired: boolean, riskLevel: string }}
 */
export function resolveExistingFileOutcome(policy = DEFAULT_CONFLICT_POLICY) {
  const executablePolicy = assertExecutableConflictPolicy(policy) || DEFAULT_CONFLICT_POLICY
  switch (executablePolicy) {
    case CONFLICT_POLICY.OVERWRITE:
      return { action: 'overwrite', backupRequired: false, riskLevel: 'warning' }
    case CONFLICT_POLICY.SKIP:
      return { action: 'skip', backupRequired: false, riskLevel: 'none' }
    case CONFLICT_POLICY.FAIL:
      return { action: 'fail', backupRequired: false, riskLevel: 'blocker' }
    case CONFLICT_POLICY.BACKUP:
    default:
      return { action: 'overwrite', backupRequired: true, riskLevel: 'warning' }
  }
}

/**
 * 给一组操作打上冲突策略标记（单一来源，供 single/multi 规划共用）。
 */
export function stampOperationsConflictPolicy(operations = [], policy = DEFAULT_CONFLICT_POLICY) {
  const safePolicy = assertExecutableConflictPolicy(policy) || DEFAULT_CONFLICT_POLICY
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (operation && typeof operation === 'object') {
      operation.conflictPolicy = safePolicy
    }
  }
  return operations
}

/**
 * 执行复用计划前的最后兜底：兼容扫描旧计划中的 operation、route 与 changeSet 字段。
 */
export function assertInstallPlanConflictPoliciesSupported(plan = {}) {
  const routeOperations = Array.isArray(plan?.routeOperations)
    ? plan.routeOperations.flatMap((item) =>
        Array.isArray(item?.operations) ? item.operations : []
      )
    : []
  const candidates = [
    plan,
    ...(Array.isArray(plan?.operations) ? plan.operations : []),
    ...(Array.isArray(plan?.routes) ? plan.routes : []),
    ...routeOperations,
    ...(Array.isArray(plan?.changeSet?.entries) ? plan.changeSet.entries : []),
    ...(Array.isArray(plan?.changeSet?.items) ? plan.changeSet.items : [])
  ]

  for (const item of candidates) {
    const action = toSafeText(item?.action).toLowerCase()
    const policy = normalizeConflictPolicy(
      item?.conflict_policy ?? item?.conflictPolicy ?? item?.appliedPolicy
    )
    if (action === CONFLICT_POLICY.MERGE || policy === CONFLICT_POLICY.MERGE) {
      assertExecutableConflictPolicy(CONFLICT_POLICY.MERGE)
    }
  }
  return plan
}
