import { createHash, randomUUID } from 'node:crypto'
import { assertToolExecutionActive } from './toolAbortUtils.js'

const references = new Map()
const plans = new Map()
const TTL = 15 * 60 * 1000
const session = (ctx) => String(ctx.sessionId || '')
const throwIfToolAborted = (ctx) => assertToolExecutionActive(ctx.signal)
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const denied = (errorCode, message) => ({ success: false, errorCode, message })
function cleanup() {
  for (const map of [references, plans])
    for (const [id, item] of map) if (item.expiresAt <= Date.now()) map.delete(id)
}
async function managerFor(deps) {
  return deps.manager || (await import('../../../../ipc/gameTools/dlss.js')).getDlssManager()
}
function targetSignature(detail) {
  return digest({
    id: detail.record.id,
    gameRoot: detail.record.gameRoot,
    options: detail.record.swapperOptions || null,
    chosen: detail.chosen?.path,
    recommendedRoute: detail.recommendedRoute,
    exes: detail.exes.map((e) => ({
      path: e.path,
      fingerprint: e.fingerprint,
      api: e.api,
      installIssue: e.installIssue,
      antiCheatWarning: e.antiCheatWarning
    })),
    installedRoute: detail.installedRoute,
    installedExe: detail.installedExe,
    recoveryPending: detail.recoveryPending,
    legacyActive: detail.legacyActive,
    installedComponents: detail.installedComponents
  })
}
const executableId = (exe) => digest({ path: exe.path, fingerprint: exe.fingerprint }).slice(0, 24)
function summary(detail) {
  return {
    reference: detail.record.id,
    name: detail.record.name,
    selection: detail.selection?.state || '',
    executables: detail.exes.slice(0, 40).map((exe) => ({
      executableId: executableId(exe),
      name: exe.rel,
      selected: exe.path === detail.chosen?.path,
      recommended: exe.recommended,
      api: exe.api,
      installIssue: exe.installIssue,
      antiCheatWarning: exe.antiCheatWarning
    })),
    recommendedRoute: detail.recommendedRoute,
    installedRoute: detail.installedRoute,
    hasBackup: detail.hasBackup,
    recoveryPending: detail.recoveryPending,
    legacyActive: !!detail.legacyActive,
    installedComponents: detail.installedComponents,
    runtimeStatus: detail.runtimeStatus,
    lastRuntimeCheck: detail.lastRuntimeCheck,
    busy: !!detail.operation,
    reason: detail.reason
  }
}

export async function listDlssGamesTool(args = {}, ctx = {}, deps = {}) {
  cleanup()
  throwIfToolAborted(ctx)
  const manager = await managerFor(deps)
  const keyword = String(args.keyword || '')
    .trim()
    .toLowerCase()
  const registered = manager.list()
  const roots = new Set(registered.map((r) => r.gameRoot.toLowerCase()))
  const games = registered.map((r) => ({ reference: r.id, name: r.name, registered: true }))
  if (args.discover !== false) {
    for (const candidate of await manager.scanLibrary()) {
      if (
        roots.has(candidate.gameRoot.toLowerCase()) ||
        (keyword && !candidate.name.toLowerCase().includes(keyword))
      )
        continue
      const reference = `library:${digest({ session: session(ctx), root: candidate.gameRoot.toLowerCase() }).slice(0, 32)}`
      if (references.size >= 500 && !references.has(reference))
        return denied('dlss_reference_limit', '游戏线索过多，请缩小游戏名称关键词后重试。')
      references.set(reference, {
        context: candidate,
        sessionId: session(ctx),
        expiresAt: Date.now() + TTL
      })
      games.push({
        reference,
        name: candidate.name,
        sourcePlatform: candidate.sourcePlatform,
        registered: false
      })
    }
  }
  throwIfToolAborted(ctx)
  const filtered = games.filter((r) => !keyword || r.name.toLowerCase().includes(keyword))
  const limit = Math.max(1, Math.min(Number(args.limit) || 30, 50))
  return {
    success: true,
    games: filtered.slice(0, limit),
    total: filtered.length,
    truncated: filtered.length > limit
  }
}

export async function inspectDlssGameTool(args = {}, ctx = {}, deps = {}) {
  cleanup()
  const manager = await managerFor(deps)
  let input = { id: args.reference }
  if (String(args.reference).startsWith('library:')) {
    const ref = references.get(args.reference)
    if (!ref || ref.sessionId !== session(ctx))
      return denied(
        'dlss_reference_expired',
        '游戏线索已过期或不属于当前会话，请重新查询游戏列表。'
      )
    input = ref.context
  }
  throwIfToolAborted(ctx)
  const detail = await manager.details({ ...input, signal: ctx.signal })
  return { success: true, ...summary(detail) }
}

export async function prepareDlssTool(args = {}, ctx = {}, deps = {}) {
  cleanup()
  if (!session(ctx)) return denied('session_required', '请在当前助手会话中准备方案。')
  if (!['install', 'restore'].includes(args.operation))
    return denied('invalid_operation', '请选择安装或还原。')
  if (plans.size >= 50) return denied('dlss_plan_limit', '待确认方案过多，请先处理已有方案。')
  const manager = await managerFor(deps)
  throwIfToolAborted(ctx)
  const detail = await manager.details({ id: args.reference, signal: ctx.signal })
  if (detail.operation) return denied('binding_busy', '请等待当前安装或还原结束。')
  const selected = args.executableId
    ? detail.exes.find((e) => executableId(e) === args.executableId)
    : detail.chosen
  if (args.operation === 'install') {
    if (!selected) return denied('choose_executable', '请先检查游戏并选择实际游戏程序。')
    if (selected.installIssue)
      return denied('dlss_target_blocked', '目标存在兼容性限制，请在游戏工具中检查检测说明。')
    if (detail.recoveryPending || detail.legacyActive)
      return denied('restore_required', '请先还原已有安装或处理未完成事务。')
    // 智能体不提供手动 API 覆盖，检测不确定时交给用户在游戏工具中明确选择。
    if (selected.path !== detail.chosen?.path)
      return denied(
        'choose_in_game_tools',
        '请先在 DLSS5 游戏工具中选择该程序并检查安装方案，再重新准备。'
      )
    if (!detail.recommendedRoute)
      return denied('route_unverified', '尚未确定兼容安装方案，请在游戏工具中检查。')
  } else if (!detail.hasBackup) return denied('backup_not_found', '没有可还原的安装备份。')
  const planId = randomUUID()
  const preview = {
    game: detail.record.name,
    operation: args.operation === 'install' ? '安装 DLSS5 组件' : '还原 DLSS5 安装',
    executable: selected?.rel || detail.installedExe || '',
    route:
      detail.record.swapperOptions?.route || detail.recommendedRoute || detail.installedRoute || '',
    hasBackup: detail.hasBackup,
    antiCheatWarning: selected?.antiCheatWarning === true,
    notice: '沿用游戏工具的兼容性检查、文件备份和安装确认。安装完成后需自行启动游戏核验效果。'
  }
  plans.set(planId, {
    id: detail.record.id,
    operation: args.operation,
    sessionId: session(ctx),
    expiresAt: Date.now() + TTL,
    signature: targetSignature(detail),
    preview
  })
  return {
    success: true,
    planId,
    expiresAt: Date.now() + TTL,
    preview,
    message: '方案已准备，尚未修改游戏文件。'
  }
}

export function getDlssPlanPreview(planId, ctx = {}) {
  cleanup()
  const plan = plans.get(planId)
  return plan && plan.sessionId === session(ctx) ? { ...plan.preview } : null
}

export async function executeDlssTool(args = {}, ctx = {}, deps = {}) {
  if (!getDlssPlanPreview(args.planId, ctx))
    return denied('dlss_plan_expired', '方案已过期、已执行或不属于当前会话，请重新准备。')
  if (ctx.userConfirmed !== true && ctx.confirmed !== true)
    return denied('confirmation_required', '请先确认安装或还原方案。')
  const plan = plans.get(args.planId)
  // 首个执行者消费快照，阻止重复确认和并发执行。
  plans.delete(args.planId)
  throwIfToolAborted(ctx)
  const manager = await managerFor(deps)
  const before = await manager.details({ id: plan.id, signal: ctx.signal })
  if (targetSignature(before) !== plan.signature)
    return denied('dlss_plan_changed', '游戏程序或安装选项已变化，请重新检查并准备方案。')
  throwIfToolAborted(ctx)
  let window = deps.window
  if (!deps.manager && ctx.event?.sender) {
    const { BrowserWindow } = await import('electron')
    window = BrowserWindow.fromWebContents(ctx.event.sender)
  }
  const result = await manager[plan.operation](plan.id, { window })
  if (result.cancelled) return denied('cancelled', '用户已取消操作，未完成安装或还原。')
  if (!result.ok)
    return denied(
      result.code || 'dlss_operation_failed',
      result.message || '操作失败，请检查游戏工具中的诊断。'
    )
  const after = await manager.details({ id: plan.id })
  return {
    success: true,
    ...summary(after),
    message:
      plan.operation === 'install'
        ? '安装流程已完成；尚未验证游戏运行效果，请自行启动游戏后检查。'
        : '还原流程已完成。'
  }
}

export async function checkDlssRuntimeTool(args = {}, ctx = {}, deps = {}) {
  const manager = await managerFor(deps)
  throwIfToolAborted(ctx)
  return {
    success: true,
    runtime: await manager.checkRuntime({ id: args.reference, signal: ctx.signal })
  }
}
