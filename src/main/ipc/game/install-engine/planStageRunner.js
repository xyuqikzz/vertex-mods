/**
 * planStageRunner.js — 计划组装阶段化执行 + 阶段级错误边界
 *
 * 把 assemblePlan 的串行步骤（changeSet → 冲突 → 校验 → 部署策略 → 依赖 → 事务）
 * 建模为有名阶段。任一阶段抛错时统一经 installEngineError 归一，并在 detail.stage
 * 标注失败阶段，便于精确定位；归一保留原 error.code，不改变上层可恢复性判定。
 */
import { normalizeInstallEngineError } from './installEngineError.js'

export const PLAN_STAGE = Object.freeze({
  CHANGE_SET: 'change_set',
  CONFLICT_ANALYSIS: 'conflict_analysis',
  VALIDATION: 'validation',
  DEPLOY_STRATEGY: 'deploy_strategy',
  DEPENDENCY: 'dependency',
  TRANSACTION: 'transaction'
})

export async function runPlanStage(stage, executor, onTiming = null) {
  const startedAt = Date.now()
  try {
    const result = await executor()
    // 阶段耗时埋点：仅在显式提供 onTiming 回调时记录（生产默认关闭，避免污染
    // explain.diagnostics 与 replay 快照；基准脚本通过 context.onStageTiming 采集）。
    if (typeof onTiming === 'function') {
      onTiming(stage, Date.now() - startedAt)
    }
    return result
  } catch (error) {
    const normalized = normalizeInstallEngineError(error)
    if (normalized && typeof normalized === 'object') {
      normalized.detail = { ...(normalized.detail || {}), stage, durationMs: Date.now() - startedAt }
    }
    throw normalized
  }
}
