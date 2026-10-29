import { createHash } from 'node:crypto'
import { resolvePreparedRepairAction } from './repairAuthorization.js'
import { validateGameRoot } from './pathAccess.js'

const grants = new Map()
const OMIT = new Set([
  'agentTaskId',
  'agent_task_id',
  'taskId',
  'inspectToken',
  'stagingToken',
  'standardPreflightAuthorization',
  'createdAt',
  'updatedAt'
])
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !OMIT.has(key))
      .map((key) => [key, canonical(value[key])])
  )
}
export function createOperationScope(toolName, target) {
  return `${toolName}:${createHash('sha256')
    .update(JSON.stringify(canonical(target)))
    .digest('hex')}`
}
export function hasOperationAuthorization(sessionId, scope) {
  const now = Date.now()
  for (const [key, expires] of grants) if (expires <= now) grants.delete(key)
  return Boolean(sessionId && scope && grants.has(`${sessionId}:${scope}`))
}
export function rememberOperationAuthorization(sessionId, scope) {
  if (!sessionId || !scope) return
  while (grants.size >= 256) grants.delete(grants.keys().next().value)
  grants.set(`${sessionId}:${scope}`, Date.now() + 60 * 60 * 1000)
}

// All identities below are resolved from local records. Model-supplied confirmation
// flags and labels never constitute authority, and operation scope changes get a new hash.
export async function resolveOperationAuthorizationTarget(name, args, ctx, deps = {}) {
  if (name === 'vertex.conflict.execute_repair') return resolvePreparedRepairAction(args, ctx, { dependencies: deps })
  if (name === 'vertex.game.bind_root') {
    const { root, exe } = await validateGameRoot(args.detectedRootPath || args.rootPath || args.gameRootPath, args.detectedExePath || args.exePath || args.clientExePath)
    const resolved = { ...args, detectedRootPath: root, detectedExePath: exe }
    return { args: resolved, scope: createOperationScope(name, resolved) }
  }
  if (name === 'vertex.install.execute_plan' && args.agentTaskId) {
    const getTask = deps.getAgentTask || (await import('./taskCenter.js')).getAgentTask
    const task = await getTask(args.agentTaskId)
    if (!task || (task.sessionId && task.sessionId !== ctx.sessionId)) {
      return {
        error: {
          success: false,
          errorCode: 'install_plan_session_mismatch',
          message: '安装计划不属于当前会话或已经不存在，请重新预检。'
        }
      }
    }
    if (!task.sessionId || !ctx.sessionId) return { args }
    const plan = task.plan || task.result?.plan
    if (!plan?.sourceInstallTaskPayload?.items?.length) return { args }
    // An explicit payload must still be verified by the executor. Do not silently
    // replace it with a stored payload and accidentally approve different arguments.
    const scope = createOperationScope(name, plan.sourceInstallTaskPayload)
    const explicit =
      args.sourceInstallTaskPayload ||
      args.installPlan?.sourceInstallTaskPayload ||
      args.plan?.sourceInstallTaskPayload
    if (explicit && createOperationScope(name, explicit) !== scope) return { args }
    return {
      args: { ...args, installPlan: plan },
      scope,
      bounded: true,
      existingJobId: task.linkedJobId || ''
    }
  }
  if (name === 'vertex.install.control_task' && ['resume', 'retry'].includes(args.action)) {
    const store =
      deps.taskStore || (await import('../../../ipc/game/source-install-task/taskStore.js'))
    const job = store.getJob(args.jobId)
    if (!job?.agent_task_id) return { args }
    const getTask = deps.getAgentTask || (await import('./taskCenter.js')).getAgentTask
    const task = await getTask(job.agent_task_id)
    if (!task || (task.sessionId && task.sessionId !== ctx.sessionId)) return { args }
    const payload = task.plan?.sourceInstallTaskPayload
    if (payload?.items?.length)
      return {
        args,
        scope: createOperationScope('vertex.install.execute_plan', payload),
        bounded: true
      }
  }
  if (name === 'vertex.mod.lifecycle_execute') {
    const action = args.action || {}
    const payload = action.executionPayload || action
    const type = String(
      payload.actionType || payload.type || action.actionType || action.type || ''
    ).toLowerCase()
    const id = Number(payload.installedModId || payload.modId || payload.id)
    if (
      !['enable_mod', 'disable_mod', 'uninstall_mod'].includes(type) ||
      !Number.isInteger(id) ||
      id <= 0 ||
      payload.force
    )
      return { args }
    const getMod =
      deps.getMod ||
      (async (modId) =>
        (await import('../../../db/dbInstance.js')).default.get(
          'SELECT * FROM mods WHERE id = ? LIMIT 1',
          [modId]
        ))
    const row = await getMod(id)
    if (!row)
      return {
        error: {
          success: false,
          errorCode: 'installed_mod_not_found',
          message: '目标模组记录不存在，请刷新已安装列表。'
        }
      }
    return {
      args,
      scope: createOperationScope(name, {
        type,
        id,
        appId: row.appid,
        gameId: row.game_id,
        source: row.source,
        version: row.version || row.mod_version,
        path: row.target_path,
        stagingPath: row.staging_path,
        profileName: row.profile_name,
        endpointType: row.endpoint_type,
        deployDomain: row.deploy_domain,
        optionId: row.option_id,
        metadata: row.metadata_json
      }),
      bounded: true
    }
  }
  return { args }
}
