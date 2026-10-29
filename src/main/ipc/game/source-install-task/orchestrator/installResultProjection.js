/**
 * orchestrator/installResultProjection.js — 安装结果投影（纯函数）
 *
 * 从执行结果中解析 installPlan / reconcileResult，把实际部署方式合并回计划快照，
 * 并对 changeSet / candidatePlans 做截断压缩，便于持久化与前端展示。
 */
import { toPlainJson, toSafeText } from '../contracts.js'

export function resolveInstallPlanFromResult(result = {}) {
  const previewResult =
    result.previewResult && typeof result.previewResult === 'object' ? result.previewResult : {}
  const installResult =
    result.installResult && typeof result.installResult === 'object' ? result.installResult : {}
  if (previewResult.installPlan && typeof previewResult.installPlan === 'object') {
    return previewResult.installPlan
  }
  if (installResult.installPlan && typeof installResult.installPlan === 'object') {
    return installResult.installPlan
  }
  if (result.installPlan && typeof result.installPlan === 'object') {
    return result.installPlan
  }
  return {}
}

export function resolveReconcileResultFromResult(result = {}) {
  const installResult =
    result.installResult && typeof result.installResult === 'object' ? result.installResult : {}
  if (installResult.reconcileResult && typeof installResult.reconcileResult === 'object') {
    return installResult.reconcileResult
  }
  if (
    installResult.deployReconcileResult &&
    typeof installResult.deployReconcileResult === 'object'
  ) {
    return installResult.deployReconcileResult
  }
  if (result.reconcileResult && typeof result.reconcileResult === 'object') {
    return result.reconcileResult
  }
  return {}
}

function normalizeDeployFallbackReasons(value = []) {
  return Array.isArray(value)
    ? value
        .map((item) => ({
          from: toSafeText(item?.from),
          to: toSafeText(item?.to),
          reason: toSafeText(item?.reason)
        }))
        .filter((item) => item.from || item.to || item.reason)
    : []
}

export function mergeDeployExecutionIntoPlan(plan = {}, reconcileResult = {}) {
  const safePlan = toPlainJson(plan, {})
  const deployMethods = Array.isArray(reconcileResult.deployMethods)
    ? reconcileResult.deployMethods
    : []
  const firstMethod = deployMethods.find((item) => toSafeText(item?.method))
  if (!firstMethod) {
    return safePlan
  }

  const method = toSafeText(firstMethod.method)
  const currentStrategy =
    safePlan.deployStrategy && typeof safePlan.deployStrategy === 'object'
      ? safePlan.deployStrategy
      : {}
  const currentFallbackReasons = normalizeDeployFallbackReasons(currentStrategy.fallbackReasons)
  const actualFallbackReasons = deployMethods.flatMap((entry) => normalizeDeployFallbackReasons(entry.fallbackReasons))
  const hasExecutionEvidence = deployMethods.every((entry) => Array.isArray(entry.fallbackReasons))

  return {
    ...safePlan,
    deployStrategy: {
      ...currentStrategy,
      strategy: method,
      actual: method,
      fallbackReasons: hasExecutionEvidence || actualFallbackReasons.length
        ? actualFallbackReasons
        : currentFallbackReasons,
      fallback: hasExecutionEvidence || actualFallbackReasons.length
        ? actualFallbackReasons.map((item) => item.to).filter(Boolean)
        : Array.isArray(currentStrategy.fallback)
          ? currentStrategy.fallback
          : [],
      executionMethods: deployMethods
    }
  }
}

export function compactChangeSet(changeSet = {}) {
  const entries = Array.isArray(changeSet.entries)
    ? changeSet.entries
    : Array.isArray(changeSet.items)
      ? changeSet.items
      : []
  return {
    ...toPlainJson(changeSet, {}),
    entries: entries.slice(0, 50),
    items: entries.slice(0, 50),
    truncated: entries.length > 50,
    totalCount: entries.length
  }
}

export function compactInstallPlan(plan = {}) {
  const safePlan = toPlainJson(plan, {})
  if (!safePlan || typeof safePlan !== 'object') {
    return {}
  }
  return {
    ...safePlan,
    changeSet: compactChangeSet(safePlan.changeSet || {}),
    candidatePlans: Array.isArray(safePlan.candidatePlans)
      ? safePlan.candidatePlans.slice(0, 20)
      : []
  }
}
