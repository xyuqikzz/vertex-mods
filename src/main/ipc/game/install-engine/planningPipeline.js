/**
 * planningPipeline.js — single / multi 规划共享管线基元
 *
 * single 与 multi 两条规划路径在「规则身份解析」「依赖装配」上完全一致，
 * 此模块沉淀为单一来源，消除两处与 assemblePlan 内联的重复实现。
 *
 * 说明：operations 的构建本身是来源类型相关的（single 直接 copy；multi 物化 +
 * 覆盖账本），两者在 assemblePlan 处汇入同一后处理管线（changeSet → 冲突 →
 * 校验 → 部署策略 → 依赖 → 事务），故此处只统一 operations 前后的共享步骤。
 */
import { toArrayValue, toSafeNumber, toSafeText } from './contracts.js'

export function resolveRuleIdentity(rule = {}) {
  return {
    ruleId: toSafeText(rule.id || rule.name || 'unknown_rule'),
    confidence: toSafeNumber(rule.confidence ?? rule.weight, 80)
  }
}

export function buildRuleDependencies(rule = {}, packageProfile = {}) {
  return [
    ...toArrayValue(rule.dependencies || rule.default_dependencies || rule.defaultDependencies),
    ...toArrayValue(packageProfile.dependencies)
  ]
}
