import { applySafeLifecycleAction, SAFE_LIFECYCLE_ACTIONS } from '../lifecycleActions.js'
import {
  assertLifecycleCommandPolicy,
  isLifecycleCommandAction,
  LifecyclePolicyError,
  LIFECYCLE_POLICY_ERROR_CODES
} from '../lifecyclePolicy.js'
import { normalizeInstallPostInstallSteps } from './stepNormalizer.js'
import { resolveInstallLifecycleStepRuntime } from './pathBaseResolver.js'
import { executeLifecycleCommandStep } from './commandRunner.js'
import { captureLifecycleActionReceipt } from './actionReceipt.js'

// H3：执行回滚计划。reverseSteps 中的安全动作通过 applySafeLifecycleAction 执行；
// 命令动作（run_command/run_script/execute）不自动逆向，跳过。
// 回滚失败不抛出，继续尝试后续 reverse 步骤，最终汇总到 manual 清单记日志。
async function rollbackLifecycleSteps(executedSteps = []) {
  const failures = []
  for (const step of [...executedSteps].reverse()) {
    try {
      if (!step.receipt) throw new Error(`命令动作 ${step.action} 的副作用不能自动恢复`)
      await step.receipt.rollback()
    } catch (rollbackError) {
      failures.push(rollbackError.message)
    }
  }
  if (failures.length) throw Object.assign(new Error(`生命周期恢复未完成：${failures.join('；')}`), { needRecovery: true })
}

function normalizeLifecycleLabel(value = '', fallback = 'unknown') {
  const label = String(value || '')
    .trim()
    .replace(/[^a-z0-9_.-]/gi, '_')
    .slice(0, 80)
  return label || fallback
}

// 安装/禁用/卸载阶段执行生命周期动作；未知动作必须失败，不能部分执行后静默成功。
// H3：收集已成功执行的步骤，失败时按 LIFO 顺序触发回滚（buildLifecycleRollbackPlan）。
export async function applyInstallRuleLifecycleSteps(payload = {}, dependencies = {}) {
  const lifecycleSteps = normalizeInstallPostInstallSteps(
    payload?.steps || payload?.postInstallSteps || []
  )
  if (!lifecycleSteps.length) {
    return
  }

  const executedSteps = []
  const directoryOwners = new Map()
  for (const step of lifecycleSteps) {
    try {
      const action = normalizeLifecycleLabel(step?.action)
      if (!SAFE_LIFECYCLE_ACTIONS.includes(action) && !isLifecycleCommandAction(action)) {
        const lifecycleName = normalizeLifecycleLabel(
          payload?.lifecycleName || payload?.phase
        )
        throw new LifecyclePolicyError(
          LIFECYCLE_POLICY_ERROR_CODES.UNSUPPORTED_ACTION,
          `不支持的生命周期动作 ${action}，生命周期阶段 ${lifecycleName} 已阻断执行`
        )
      }

      const stepRuntime = resolveInstallLifecycleStepRuntime(step, payload, dependencies)
      if (SAFE_LIFECYCLE_ACTIONS.includes(stepRuntime.action)) {
        const receipt = await captureLifecycleActionReceipt(step, { ...stepRuntime, directoryOwners })
        executedSteps.push({ action, receipt })
        try {
          await applySafeLifecycleAction(step, { ...stepRuntime, directoryReceipt: receipt })
        } finally {
          await receipt.seal?.()
        }
        continue
      }
      if (isLifecycleCommandAction(stepRuntime.action)) {
        // B1：命令动作必须先通过安全策略裁决（白名单 + 参数安全 + 信任/授权双闸门）。
        assertLifecycleCommandPolicy(stepRuntime, payload?.lifecycleCommandContext || {})
        await executeLifecycleCommandStep(stepRuntime, payload, dependencies)
        // 命令动作无 backup，不可自动逆向；记入 executedSteps 仅供 manual 清单汇总。
        executedSteps.push({ ...step, ...stepRuntime })
        continue
      }
    } catch (error) {
      // H3：失败时触发回滚（LIFO 顺序，只回滚 executedSteps 中已成功执行的步骤）。
      // 当前步骤即使 runtime 解析失败也未产生副作用，不进 executedSteps，不会被回滚。
      // 回滚失败不抛出，最终仍抛出原始错误。
      try { await rollbackLifecycleSteps(executedSteps) } catch (recoveryError) {
        error.needRecovery = true
        error.message += `；${recoveryError.message}`
      }
      throw error
    }
  }
  const receipt = {
    rollback: () => rollbackLifecycleSteps(executedSteps),
    commit: async () => { for (const step of executedSteps) await step.receipt?.commit() }
  }
  if (Array.isArray(payload.receipts)) payload.receipts.push(receipt)
  else await receipt.commit()
  return receipt
}

export async function applyInstallRulePostInstallSteps(payload = {}, dependencies = {}) {
  return await applyInstallRuleLifecycleSteps(
    {
      ...payload,
      lifecycleName: 'post_install',
      steps: payload?.postInstallSteps || []
    },
    dependencies
  )
}
