/**
 * install-engine/index.js — 统一安装引擎入口
 *
 * install_rules 是唯一运行时规则入口，运行时不再回退旧引擎。
 */

import { createInstallPlan, isPlainObject } from './contracts.js'
import {
  resolveCachedSourceInstallPreviewPlan as resolveCachedPreviewPlan,
  resolveSourceInstallPreviewPlanPayload
} from './planPreviewAdapter.js'
import {
  hasUnifiedInstallRuleCapability,
  resolveUnifiedInstallPlan
} from './unifiedPlanner.js'

export function hasSourceInstallRuleCapability(installRule = {}) {
  return hasUnifiedInstallRuleCapability(installRule)
}

async function dispatchSourceInstallPlan(payload = {}, phase = 'install') {
  return await resolveUnifiedInstallPlan({ ...payload, phase })
}

export async function inspectSourceInstallPlanByEngine(payload = {}) {
  return await dispatchSourceInstallPlan(payload, 'inspect')
}

export async function resolveSourceInstallPlanByEngine(payload = {}) {
  return await dispatchSourceInstallPlan(payload, 'install')
}

export async function resolveCachedSourceInstallPreviewPlan(entry = {}, gameRoot = '', runtimeContext = {}) {
  const resolvedPlan = await resolveCachedPreviewPlan(entry, gameRoot, runtimeContext)
  const rawPlan = resolveSourceInstallPreviewPlanPayload(entry)
  return createInstallPlan({
    ...rawPlan,
    ...resolvedPlan,
    planSchemaVersion: rawPlan.planSchemaVersion || resolvedPlan?.planSchemaVersion,
    engineVersion: rawPlan.engineVersion || resolvedPlan?.engineVersion,
    source: rawPlan.source || resolvedPlan?.source,
    sourceAdapter: rawPlan.sourceAdapter || resolvedPlan?.sourceAdapter,
    confidence: rawPlan.confidence ?? resolvedPlan?.confidence,
    explain: isPlainObject(rawPlan.explain) ? rawPlan.explain : resolvedPlan?.explain || {}
  })
}

export { resolveUnifiedInstallPlan }
export { assertSourceInstallPlanCurrent } from './planPreviewAdapter.js'
