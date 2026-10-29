/**
 * lifecyclePolicy.js — 生命周期命令执行安全策略（B1）
 *
 * 统一裁决 run_command / run_script / execute 这类会拉起本地脚本/可执行文件的高危动作：
 *  1. 可执行扩展名白名单（仅 .bat/.cmd/.ps1/.exe 可执行）；
 *  2. 命令参数/stdin 安全校验（禁止 NUL 与控制字符）；
 *  3. 信任 + 授权双闸门：仅「官方可信规则」或「用户显式逐次授权」才允许执行；
 *  4. 全局熔断开关（VERTEX_DISABLE_LIFECYCLE_COMMANDS）可一键禁用全部命令动作。
 *
 * 注意：纯文件操作类安全动作（copy_path 等）不在本策略管辖范围，由 lifecycleActions.js 处理。
 */
import path from 'path'

export const LIFECYCLE_COMMAND_ACTIONS = Object.freeze(['run_command', 'run_script', 'execute'])

// 允许作为生命周期命令执行的可执行/脚本扩展名白名单。
export const ALLOWED_LIFECYCLE_EXECUTABLE_EXTENSIONS = Object.freeze([
  '.bat',
  '.cmd',
  '.ps1',
  '.exe'
])

export const LIFECYCLE_POLICY_ERROR_CODES = Object.freeze({
  UNSUPPORTED_ACTION: 'unsupported_lifecycle_action',
  COMMAND_DISABLED: 'lifecycle_command_disabled',
  EXECUTABLE_NOT_ALLOWED: 'lifecycle_executable_not_allowed',
  ARGS_UNSAFE: 'lifecycle_command_args_unsafe',
  NOT_AUTHORIZED: 'lifecycle_command_not_authorized'
})

export class LifecyclePolicyError extends Error {
  constructor(code = '', message = '') {
    super(message || code)
    this.name = 'LifecyclePolicyError'
    this.code = code
  }
}

export function isLifecycleCommandAction(action = '') {
  return LIFECYCLE_COMMAND_ACTIONS.includes(
    String(action || '')
      .trim()
      .toLowerCase()
  )
}

// 全局熔断：设置 VERTEX_DISABLE_LIFECYCLE_COMMANDS=1/true/yes/on 即彻底禁用命令动作。
function isLifecycleCommandGloballyDisabled() {
  const value = process.env.VERTEX_DISABLE_LIFECYCLE_COMMANDS
  if (value === undefined || value === null || value === '') return false
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function hasControlOrNullChar(text = '') {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(String(text || ''))
}

export function isAllowedLifecycleExecutable(targetPath = '') {
  const ext = String(path.extname(String(targetPath || '').trim()) || '')
    .trim()
    .toLowerCase()
  return ALLOWED_LIFECYCLE_EXECUTABLE_EXTENSIONS.includes(ext)
}

// 归一信任级别：official（官方可信/签名）/ user（用户本地自定义）/ community（社区/服务器下发，默认）。
export function normalizeLifecycleTrustLevel(value = '') {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (['official', 'trusted', 'signed', 'verified'].includes(text)) return 'official'
  if (['user', 'local', 'local_override', 'self'].includes(text)) return 'user'
  return 'community'
}

/**
 * 裁决某个生命周期命令步骤是否允许执行。
 * @param {object} stepRuntime 已解析的运行时步骤（含 action / resolvedTargetPath / args / stdin）
 * @param {object} context 授权上下文 { trustLevel, authorized }
 * @returns {{ allowed: boolean, code?: string, message?: string, trustLevel?: string, authorized?: boolean }}
 */
export function evaluateLifecycleCommandPolicy(stepRuntime = {}, context = {}) {
  const action = String(stepRuntime?.action || '')
    .trim()
    .toLowerCase()
  // 非命令动作不归本策略管辖，直接放行（由安全动作白名单/其它逻辑处理）。
  if (!isLifecycleCommandAction(action)) {
    return { allowed: true }
  }

  if (isLifecycleCommandGloballyDisabled()) {
    return {
      allowed: false,
      code: LIFECYCLE_POLICY_ERROR_CODES.COMMAND_DISABLED,
      message: '生命周期命令执行已被全局禁用（VERTEX_DISABLE_LIFECYCLE_COMMANDS）'
    }
  }

  const targetPath = String(
    stepRuntime?.resolvedTargetPath || stepRuntime?.launchTargetPath || ''
  ).trim()
  if (!isAllowedLifecycleExecutable(targetPath)) {
    const ext = path.extname(targetPath) || '(无扩展名)'
    return {
      allowed: false,
      code: LIFECYCLE_POLICY_ERROR_CODES.EXECUTABLE_NOT_ALLOWED,
      message: `生命周期命令可执行类型不在白名单：${ext}`
    }
  }

  const args = Array.isArray(stepRuntime?.args) ? stepRuntime.args : []
  const stdin = Array.isArray(stepRuntime?.stdin) ? stepRuntime.stdin : []
  if ([...args, ...stdin].some((item) => hasControlOrNullChar(item))) {
    return {
      allowed: false,
      code: LIFECYCLE_POLICY_ERROR_CODES.ARGS_UNSAFE,
      message: '生命周期命令参数/输入包含非法控制字符，已拒绝执行'
    }
  }
  // cmd 会再次解释批处理参数；仅允许字面参数，不能把授权范围扩展成额外命令。
  if (/\.(?:bat|cmd)$/i.test(targetPath) && [targetPath, ...args].some((item) => /[&|<>^%!"\r\n]/.test(String(item)))) {
    return {
      allowed: false,
      code: LIFECYCLE_POLICY_ERROR_CODES.ARGS_UNSAFE,
      message: '批处理路径或参数包含 cmd 特殊字符，请使用字面参数或独立可执行程序'
    }
  }

  const trustLevel = normalizeLifecycleTrustLevel(context.trustLevel)
  const authorized = context.authorized === true
  if (trustLevel === 'official' || authorized) {
    return { allowed: true, trustLevel, authorized }
  }

  return {
    allowed: false,
    code: LIFECYCLE_POLICY_ERROR_CODES.NOT_AUTHORIZED,
    message: '生命周期命令需要官方可信规则或用户显式授权后才能执行'
  }
}

export function assertLifecycleCommandPolicy(stepRuntime = {}, context = {}) {
  const result = evaluateLifecycleCommandPolicy(stepRuntime, context)
  if (!result.allowed) {
    throw new LifecyclePolicyError(result.code, result.message)
  }
  return result
}
