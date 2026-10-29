import { createHash, randomUUID } from 'node:crypto'
import { readExecutionSnapshot, saveExecutionSnapshot } from './executionSnapshots.js'

async function repairState(action, ctx, deps = {}) {
  const payload = action.executionPayload || action
  if (payload.actionType === 'install_missing') {
    const getTask = deps.getAgentTask || (await import('./taskCenter.js')).getAgentTask
    const task = await getTask(payload.agentTaskId)
    if (
      !task ||
      !ctx.sessionId ||
      task.sessionId !== ctx.sessionId ||
      !task.plan?.sourceInstallTaskPayload?.items?.length ||
      task.plan.canSubmit === false
    ) {
      throw new Error('缺失依赖需要当前会话中有效的安装预检计划。')
    }
    return JSON.stringify(task.plan.sourceInstallTaskPayload)
  }
  const db = deps.db || (await import('../../../db/dbInstance.js')).default
  let rows
  if (payload.actionType === 'domain_rebuild') {
    const scope = payload.scope || {}
    rows = db.all('SELECT * FROM mods WHERE game_id = ? ORDER BY id', [scope.gameId])
  } else {
    const ids = payload.ids || [payload.installedModId || payload.modId || payload.id]
    rows = ids.map((id) => db.get('SELECT * FROM mods WHERE id = ? LIMIT 1', [id]))
    if (rows.some((row) => !row)) throw new Error('修复目标已不存在，请重新检测冲突。')
  }
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key]])
      )
    )
  )
}

async function fingerprint(action, ctx, deps) {
  return createHash('sha256')
    .update(JSON.stringify(action))
    .update(await repairState(action, ctx, deps))
    .digest('hex')
}

export async function saveRepairPlan(plan, ctx = {}, deps = {}) {
  const repairPlanId = randomUUID()
  const actions = []
  for (const action of plan.actions || []) {
    const scope = await fingerprint(action, ctx, deps)
    const actionId = saveExecutionSnapshot('repair-action', { repairPlanId, action, scope }, ctx)
    actions.push({ ...action, actionId, repairPlanId, requiresConfirmation: true })
  }
  return { ...plan, repairPlanId, actions }
}

export async function resolvePreparedRepairAction(args, ctx = {}, options = {}) {
  const saved = readExecutionSnapshot(args.actionId, 'repair-action', ctx)
  if (!saved || saved.repairPlanId !== args.repairPlanId) {
    return {
      error: {
        success: false,
        errorCode: 'repair_plan_expired',
        message: '修复计划已过期、已使用或不属于当前会话，请重新检测并生成计划。'
      }
    }
  }
  try {
    if ((await fingerprint(saved.action, ctx, options.dependencies || {})) !== saved.scope)
      throw new Error('修复目标已变化，请重新检测并确认。')
  } catch (error) {
    return { error: { success: false, errorCode: 'repair_target_changed', message: error.message } }
  }
  if (options.consume && !readExecutionSnapshot(args.actionId, 'repair-action', ctx, true)) {
    return {
      error: {
        success: false,
        errorCode: 'repair_already_started',
        message: '该修复动作已经开始。'
      }
    }
  }
  return {
    args: { repairPlanId: args.repairPlanId, actionId: args.actionId, action: saved.action },
    scope: `repair:${saved.scope}`
  }
}
