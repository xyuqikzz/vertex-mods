import { createHash, randomUUID } from 'node:crypto'
import { validateAgentScript, runAgentScript } from './scriptRunner.js'

const preparedScripts = new Map()
const PREPARE_TTL_MS = 30 * 60 * 1000
const MAX_PREPARED_SCRIPTS = 32

function removeExpiredScripts() {
  for (const [id, script] of preparedScripts) {
    if (script.expiresAt <= Date.now()) preparedScripts.delete(id)
  }
}

export async function prepareAgentScriptTool(args = {}, ctx = {}) {
  const script = await validateAgentScript(args)
  removeExpiredScripts()
  if (preparedScripts.size >= MAX_PREPARED_SCRIPTS) {
    return { success: false, errorCode: 'script_queue_full', message: '待执行脚本过多，请先处理已有脚本。' }
  }
  const scriptId = randomUUID()
  const prepared = {
    ...script,
    scriptId,
    reason: String(args.reason || '').trim(),
    sessionId: String(ctx.sessionId || ''),
    expiresAt: Date.now() + PREPARE_TTL_MS,
    sha256: createHash('sha256').update(script.scriptContent).digest('hex')
  }
  preparedScripts.set(scriptId, prepared)
  return {
    success: true,
    scriptId,
    type: script.type,
    sha256: prepared.sha256,
    timeoutMs: script.timeoutMs,
    expiresAt: prepared.expiresAt,
    message: '脚本已准备，尚未执行。请发起运行确认，用户可查看完整脚本。'
  }
}

export function getAgentScriptPreview(scriptId, ctx = {}) {
  removeExpiredScripts()
  const script = preparedScripts.get(scriptId)
  if (!script || script.sessionId !== String(ctx.sessionId || '')) return null
  return {
    type: script.type,
    scriptContent: script.scriptContent,
    workingDirectory: script.workingDirectory,
    timeoutMs: script.timeoutMs,
    reason: script.reason,
    sha256: script.sha256
  }
}

export async function runAgentScriptTool(args = {}, ctx = {}) {
  const script = getAgentScriptPreview(args.scriptId, ctx)
  if (!script) return { success: false, errorCode: 'script_expired', message: '脚本已执行、已过期或不属于当前会话，请重新准备。' }
  if (ctx.userConfirmed !== true && ctx.confirmed !== true) {
    return { success: false, errorCode: 'confirmation_required', message: '请先确认脚本内容。' }
  }
  // 在启动前消费一次性快照，阻止双击或同一个确认卡重复执行。
  preparedScripts.delete(args.scriptId)
  return runAgentScript(script, ctx)
}
