export const AI_AGENT_PERMISSION_REASON_MESSAGES = Object.freeze({
  user_confirmed: '用户已确认，本次允许执行',
  permission_grant: '已使用当前会话授权',
  write_tools_not_enabled: '写入类工具未开启，已阻止执行',
  always_confirmation_required: '该工具始终需要确认',
  all_destructive_confirmation_required: '检测到批量删除、禁用、卸载或移除等高风险动作，需要确认',
  safe_mode_confirmation_required: '安全模式下执行类工具需要确认',
  semi_auto_destructive_confirmation_required: '确认执行模式下破坏性动作需要确认',
  tool_disabled: '工具当前不可用',
  unknown_permission_level: '工具权限级别异常，已阻止执行',
  auto_allowed: '当前策略自动允许执行',
  operation_scope_confirmation_required: '操作将扩展到新的目标，需要确认'
})

export const AI_AGENT_PERMISSION_ERROR_CODES = Object.freeze({
  tool_disabled: 'tool_disabled',
  write_tools_not_enabled: 'write_tools_not_enabled',
  unknown_permission_level: 'unknown_permission_level',
  always_confirmation_required: 'confirmation_required',
  all_destructive_confirmation_required: 'confirmation_required',
  safe_mode_confirmation_required: 'confirmation_required',
  semi_auto_destructive_confirmation_required: 'confirmation_required',
  operation_scope_confirmation_required: 'confirmation_required'
})

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

export function formatAiAgentPermissionReason(reason = '') {
  const key = toSafeText(reason)
  return AI_AGENT_PERMISSION_REASON_MESSAGES[key] || key
}

export function resolveAiAgentPermissionErrorCode(reason = '', decision = {}) {
  const key = toSafeText(reason)
  if (!key) return ''
  if (decision?.allowed === false || decision?.confirmationRequired === true) {
    return AI_AGENT_PERMISSION_ERROR_CODES[key] || key
  }
  return ''
}
