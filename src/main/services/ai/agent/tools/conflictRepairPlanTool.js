import { createConflictRepairPlan } from '../../../../../shared/ai/installation/ai-agent-conflict-repair-plan.js'
import { detectModConflictsTool } from './conflictDetectorTool.js'
import { saveRepairPlan } from '../repairAuthorization.js'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export async function createConflictRepairPlanTool(args = {}, ctx = {}, deps = {}) {
  const gameId = toSafeNumber(args.gameId, 0)
  if (gameId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_game_id',
      message: 'gameId 无效，请先调用 vertex.game.list 获取本地游戏列表。'
    }
  }

  const detectResult = await (deps.detectModConflictsTool || detectModConflictsTool)({
    gameId,
    endpointType: args.endpointType,
    deployDomain: args.deployDomain
  })

  if (detectResult?.success === false) {
    return detectResult
  }

  let installPayload
  if (args.includeInstallMissing) {
    const getTask = deps.getAgentTask || (await import('../taskCenter.js')).getAgentTask
    const task = args.agentTaskId ? await getTask(args.agentTaskId) : null
    if (!task || !ctx.sessionId || task.sessionId !== ctx.sessionId || task.plan?.canSubmit === false || !task.plan?.sourceInstallTaskPayload?.items?.length) {
      return { success: false, errorCode: 'missing_install_plan', message: '请先通过 vertex.install.inspect_plan 生成当前会话的依赖安装预检，再提供 agentTaskId。' }
    }
    installPayload = task.plan.sourceInstallTaskPayload
  }
  const repairPlan = createConflictRepairPlan(detectResult, {
    gameId,
    endpointType: args.endpointType,
    deployDomain: args.deployDomain,
    targetRelativePath: toSafeText(args.targetRelativePath),
    preferredWinnerModId: args.preferredWinnerModId,
    includeDomainRebuild: args.includeDomainRebuild,
    includeDisableMod: args.includeDisableMod,
    includeUninstallMod: args.includeUninstallMod,
    includeInstallMissing: args.includeInstallMissing,
    sourceInstallTaskPayload: installPayload,
    maxActions: args.maxActions
  })
  for (const action of repairPlan.actions || []) {
    if (action.type === 'install_missing') {
      delete action.sourceInstallTaskPayload
      const { createOperationScope } = await import('../operationAuthorization.js')
      action.executionPayload = { actionType: 'install_missing', agentTaskId: args.agentTaskId,
        operationScope: createOperationScope('vertex.install.execute_plan', installPayload) }
    }
  }

  return {
    success: true,
    ...await saveRepairPlan(repairPlan, ctx, deps),
    readonly: true,
    executable: false,
    note: '当前工具只生成冲突修复计划，不保存 priority_order，不执行部署域重建，不提交安装任务，也不卸载模组。'
  }
}
