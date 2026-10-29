import { nativeText } from '../../uiLanguage.js'
import { readExecutionSnapshot, saveExecutionSnapshot } from './executionSnapshots.js'
import { buildAiAgentToolResultSummary } from '../../../../shared/ai/tools/ai-agent-tool-loop.js'

const NATIVE_CONFIRMATION_TOOLS = new Set([
  'vertex.script.run',
  'vertex.trainer.fling.run',
  'vertex.game.bind_root'
])

// 用户批准并执行后的真实结果，供智能体自动续跑时读取；渲染进程只能传确认 ID，
// 不能自行声明执行结果。只保存续跑需要的标识与状态摘要。
const CONFIRMATION_OUTCOME_TTL_MS = 30 * 60 * 1000
const MAX_CONFIRMATION_OUTCOMES = 64
const confirmationOutcomes = new Map()

function pruneConfirmationOutcomes() {
  const now = Date.now()
  for (const [id, entry] of confirmationOutcomes)
    if (entry.expiresAt <= now) confirmationOutcomes.delete(id)
  while (confirmationOutcomes.size > MAX_CONFIRMATION_OUTCOMES)
    confirmationOutcomes.delete(confirmationOutcomes.keys().next().value)
}

export function recordAgentConfirmationOutcome(confirmationId = '', snapshot = {}, result = {}) {
  const id = String(confirmationId || '').trim()
  if (!id || !snapshot?.name) return
  pruneConfirmationOutcomes()
  confirmationOutcomes.set(id, {
    expiresAt: Date.now() + CONFIRMATION_OUTCOME_TTL_MS,
    sessionId: String(snapshot.context?.sessionId || ''),
    outcome: {
      confirmationId: id,
      toolName: snapshot.name,
      title: String(snapshot.confirmation?.title || snapshot.name),
      success: result?.success === true,
      errorCode: String(result?.errorCode || ''),
      message: String(result?.message || '').slice(0, 600),
      resultSummary: buildAiAgentToolResultSummary(result)
    }
  })
}

export function readAgentConfirmationOutcome(confirmationId = '', ctx = {}) {
  pruneConfirmationOutcomes()
  const entry = confirmationOutcomes.get(String(confirmationId || '').trim())
  if (!entry || entry.sessionId !== String(ctx.sessionId || '')) return null
  return JSON.parse(JSON.stringify(entry.outcome))
}

export function saveAgentConfirmation(confirmation, args, ctx = {}) {
  return saveExecutionSnapshot(
    'confirmation',
    {
      confirmation,
      name: confirmation.toolName,
      args,
      context: {
        sessionId: ctx.sessionId || '',
        executionId: ctx.executionId || '',
        mode: confirmation.mode,
        pageContext: ctx.pageContext || {},
        confirmedOperationScope: ctx.operationScope || ''
      }
    },
    ctx
  )
}

export function attachInstallPlanConfirmation(plan, ctx = {}) {
  if (!plan?.sourceInstallTaskPayload?.items?.length || plan.canSubmit === false) return plan
  const confirmation = {
    toolName: 'vertex.install.execute_plan',
    title: '提交安装计划',
    mode: ctx.mode || 'safe',
    allowGrant: false
  }
  const confirmationId = saveAgentConfirmation(
    confirmation,
    { installPlan: plan, agentTaskId: plan.agentTaskId || plan.taskId },
    ctx
  )
  return { ...plan, confirmationId }
}

async function confirmNativeExecution(snapshot, event) {
  const { dialog, BrowserWindow } = await import('electron')
  if (!event?.sender || event.sender.isDestroyed?.()) return false
  const options = {
    type: 'warning',
    title: nativeText('confirmRun'),
    message: snapshot.confirmation.title,
    detail:
      snapshot.name === 'vertex.game.bind_root'
        ? nativeText('bindDetail', { directory: snapshot.args.detectedRootPath, executable: snapshot.args.detectedExePath })
        : snapshot.confirmation.scriptPreview?.scriptContent ||
          JSON.stringify(snapshot.confirmation.argsPreview || {}, null, 2),
    buttons: [nativeText('cancel'), snapshot.name === 'vertex.game.bind_root' ? nativeText('bindDirectory') : nativeText('run')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

export async function confirmAgentTool(payload = {}, options = {}) {
  const ctx = { sessionId: payload.sessionId || '', event: options.event || null }
  const snapshot = readExecutionSnapshot(payload.confirmationId, 'confirmation', ctx, true)
  if (!snapshot)
    return {
      success: false,
      errorCode: 'confirmation_expired',
      message: '确认已过期、已使用或不属于当前窗口与会话，请重新准备操作。'
    }
  if (payload.cancel === true)
    return { success: false, errorCode: 'cancelled', message: '操作已取消。' }
  if (
    NATIVE_CONFIRMATION_TOOLS.has(snapshot.name) &&
    !(await (options.confirmNative || confirmNativeExecution)(snapshot, options.event))
  ) {
    return { success: false, errorCode: 'cancelled', message: '操作已取消。' }
  }
  const invoke =
    options.invokeTool || (await import('./debugToolInvoker.js')).invokeConfirmedAgentTool
  const result = await invoke(snapshot.name, snapshot.args, {
    ...snapshot.context,
    executionId: payload.executionId || snapshot.context.executionId,
    event: options.event || null,
    userConfirmed: true,
    secretInput:
      snapshot.name === 'vertex.source_credential.configure' ? payload.secretInput || {} : {}
  })
  recordAgentConfirmationOutcome(payload.confirmationId, snapshot, result)
  if (result.success && snapshot.confirmation.allowGrant && payload.grantScope === 'game') {
    try {
      const createGrant =
        options.createGrant ||
        (await import('./permissionGrantStore.js')).createAgentPermissionGrantFromConfirmation
      result.grantResult = await createGrant({ confirmation: snapshot.confirmation, scope: 'game' })
    } catch {
      result.grantResult = {
        success: false,
        errorCode: 'grant_save_failed',
        message: '本次操作已执行，但自动授权保存失败。'
      }
    }
  }
  return result
}
