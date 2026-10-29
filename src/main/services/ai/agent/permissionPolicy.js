import { AI_AGENT_PERMISSION_LEVELS } from '../../../../shared/ai/tools/ai-agent-tool-schemas.js'
import {
  AI_AGENT_AUTHORIZATION_MODES,
  normalizeAiAgentAuthorizationMode
} from '../../../../shared/ai/config/ai-agent-config.js'
import { isAgentPermissionGrantActive } from '../../../../shared/ai/permissions/ai-agent-permission-grant.js'
import {
  formatAiAgentPermissionReason,
  resolveAiAgentPermissionErrorCode
} from '../../../../shared/ai/permissions/ai-agent-permission-reason.js'
import { getAiAgentFeatureFlags } from '../../../ipc/game/featureFlags.js'

/**
 * AgentPermissionPolicy
 *
 * 三种授权模式：
 * - SAFE：read/plan 自动放行；execute/destructive 一律需要确认。
 * - SEMI_AUTO：read/plan 自动放行；execute 自动放行；destructive 需要确认。
 * - FULL_AUTO：主进程已核对的同会话安装计划和单模组启停/卸载可自动执行。
 * - 同会话、同目标及操作复用显式确认；目标指纹变化需要重新裁决。
 * - 批量破坏性动作、脚本、外部程序运行、凭据配置及回滚仍遵循独立确认。
 * - Agent 写工具总开关仍是硬开关，关闭后不允许写操作。
 */

export const AGENT_PERMISSION_MODES = Object.freeze({
  SAFE: AI_AGENT_AUTHORIZATION_MODES.SAFE,
  SEMI_AUTO: AI_AGENT_AUTHORIZATION_MODES.SEMI_AUTO,
  FULL_AUTO: AI_AGENT_AUTHORIZATION_MODES.FULL_AUTO
})

const EXECUTABLE_LEVELS = new Set([
  AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE
])
const ACTION_TYPE_PATHS = Object.freeze([
  ['action', 'executionPayload', 'actionType'],
  ['action', 'actionType'],
  ['action', 'type'],
  ['executionPayload', 'actionType'],
  ['executionPayload', 'type'],
  ['actionType'],
  ['type']
])
const ALL_SCOPE_KEYS = new Set([
  'all',
  'allmods',
  'all_mods',
  'selectall',
  'select_all',
  'applytoall',
  'apply_to_all',
  'scope',
  'target',
  'targetscope',
  'target_scope',
  'selection',
  'range',
  'modscope',
  'mod_scope',
  'affectedscope',
  'affected_scope',
  'ids',
  'modids',
  'mod_ids',
  'installedmodids',
  'installed_mod_ids'
])
const ALL_SCOPE_VALUES = new Set(['all', '*', '全部', '全量', '所有', '所有模组'])
const ALL_ACTION_TEXT_WORDS = ['全部', '全量', '所有']
const DESTRUCTIVE_ALL_VERBS = ['disable', 'delete', 'remove', 'uninstall', 'purge', 'clear']

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isReadableLevel(level = '') {
  return level === AI_AGENT_PERMISSION_LEVELS.READ || level === AI_AGENT_PERMISSION_LEVELS.PLAN
}

function isExecutableLevel(level = '') {
  return EXECUTABLE_LEVELS.has(level)
}

function normalizeActionText(value = '') {
  return toSafeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function resolveWriteToolsFeatureFlag(ctx = {}) {
  return getAiAgentFeatureFlags().enableAgentWriteTools !== false &&
    ctx.enableAgentWriteTools !== false && ctx.featureFlags?.enableAgentWriteTools !== false
}

function resolveToolArgs(ctx = {}) {
  return isPlainObject(ctx.args) ? ctx.args : isPlainObject(ctx.toolArgs) ? ctx.toolArgs : {}
}

function getPathValue(source = {}, path = []) {
  let cursor = source
  for (const key of path) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) {
      return ''
    }
    cursor = cursor[key]
  }
  return cursor
}

function resolveActionType(args = {}) {
  for (const path of ACTION_TYPE_PATHS) {
    const actionType = normalizeActionText(getPathValue(args, path))
    if (actionType) return actionType
  }
  return ''
}

function isAllScopeValue(value) {
  if (value === true) return true
  if (typeof value === 'string') {
    return ALL_SCOPE_VALUES.has(normalizeActionText(value))
  }
  if (Array.isArray(value)) {
    return value.some((item) => isAllScopeValue(item))
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((item) => isAllScopeValue(item))
  }
  return false
}

function hasAllScopeMarker(value, depth = 0) {
  if (depth > 8 || !value) return false
  if (Array.isArray(value)) {
    return value.some((item) => hasAllScopeMarker(item, depth + 1))
  }
  if (!isPlainObject(value)) return false

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeActionText(key)
    if (ALL_SCOPE_KEYS.has(normalizedKey) && isAllScopeValue(entry)) {
      return true
    }
    if ((isPlainObject(entry) || Array.isArray(entry)) && hasAllScopeMarker(entry, depth + 1)) {
      return true
    }
  }
  return false
}

function containsDestructiveAllVerb(text = '') {
  const normalized = normalizeActionText(text)
  if (!normalized) return false
  const tokens = normalized.replace(/\./g, '_').split('_').filter(Boolean)
  const hasAllWord =
    tokens.includes('all') || ALL_ACTION_TEXT_WORDS.some((word) => normalized.includes(word))
  const hasDestructiveVerb = DESTRUCTIVE_ALL_VERBS.some((verb) => normalized.includes(verb))
  return hasAllWord && hasDestructiveVerb
}

function containsDeleteOrDisableVerb(text = '') {
  const normalized = normalizeActionText(text)
  if (!normalized) return false
  return DESTRUCTIVE_ALL_VERBS.some((verb) => normalized.includes(verb))
}

function requiresExplicitConfirmation(descriptor = {}, ctx = {}) {
  const args = resolveToolArgs(ctx)
  const toolName = normalizeActionText(descriptor.name)
  const actionType = resolveActionType(args)
  const operationText = [toolName, actionType].filter(Boolean).join('_')
  // Resolve actual target counts as well as the legacy “all” spelling.
  const payload = args.action?.executionPayload || args.action || args.executionPayload || args
  const ids = payload.ids || payload.modIdList || payload.modIds || payload.installedModIds
  if (descriptor.permissionLevel === AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE &&
      (Number(ctx.affectedTargetCount) > 1 || (Array.isArray(ids) && new Set(ids).size > 1))) return true

  if (containsDestructiveAllVerb(operationText)) {
    return true
  }

  if (!hasAllScopeMarker(args)) {
    return false
  }

  return containsDeleteOrDisableVerb(actionType) || containsDeleteOrDisableVerb(toolName)
}

function resolveActivePermissionGrant(ctx = {}) {
  const grant = isPlainObject(ctx.permissionGrant) ? ctx.permissionGrant : null
  if (!grant || !isAgentPermissionGrantActive(grant)) return null
  return grant
}

export function getAgentPermissionMode(settings = {}) {
  const aiAgent = settings && typeof settings === 'object' ? settings.aiAgent : null
  const sourceConfig = aiAgent && typeof aiAgent === 'object' ? aiAgent : settings
  return normalizeAiAgentAuthorizationMode(sourceConfig?.authorizationMode)
}

/**
 * 合并 payload.mode 与 settings.aiAgent.authorizationMode，payload 优先。
 * 用于 chat 主链路与确认后重调工具时统一解析“当前有效授权模式”。
 */
export function resolveEffectiveAgentPermissionMode(payload = {}, settings = {}) {
  const explicit = [payload?.mode, payload?.authorizationMode, payload?.permissionMode].find((value) => value !== undefined)
  const payloadMode = explicit === undefined ? '' : normalizeAiAgentAuthorizationMode(explicit)
  const mode = payloadMode || getAgentPermissionMode(settings)
  return mode === AGENT_PERMISSION_MODES.FULL_AUTO && !getAiAgentFeatureFlags().enableAgentFullAuto
    ? AGENT_PERMISSION_MODES.SEMI_AUTO : mode
}

export function formatAgentPermissionReasonMessage(reason = '') {
  return formatAiAgentPermissionReason(reason)
}

function createPermissionDecision(patch = {}) {
  const reason = toSafeText(patch.reason)
  const defaultErrorCode = resolveAiAgentPermissionErrorCode(reason, patch)
  return {
    ...patch,
    reason,
    errorCode: toSafeText(patch.errorCode, defaultErrorCode),
    reasonMessage: formatAgentPermissionReasonMessage(reason)
  }
}

/**
 * 裁决一次工具调用是否放行。
 * @param {object} descriptor 工具描述（来自 ai-agent-tool-schemas.js）
 * @param {object} ctx 调用上下文 { sessionId, executionId, mode, settings, userConfirmed }
 * @returns {{ allowed: boolean, reason: string, mode: string }}
 */
export function evaluateAgentToolPermission(descriptor = {}, ctx = {}) {
  const requestedMode = resolveEffectiveAgentPermissionMode(
    { mode: ctx?.mode, authorizationMode: ctx?.authorizationMode, permissionMode: ctx?.permissionMode },
    ctx?.settings || ctx?.featureFlags
  )
  const mode = requestedMode === AGENT_PERMISSION_MODES.FULL_AUTO &&
    (ctx.enableAgentFullAuto === false || ctx.featureFlags?.enableAgentFullAuto === false)
    ? AGENT_PERMISSION_MODES.SEMI_AUTO : requestedMode
  const level = String(descriptor?.permissionLevel || '')
  const userConfirmed = ctx?.userConfirmed === true || ctx?.confirmed === true
  const requiresConfirmation = toSafeText(descriptor?.requiresConfirmation).toLowerCase()
  const createAllowedExecutionDecision = (patch = {}) =>
    createPermissionDecision({
      ...patch,
      ...(mode === AI_AGENT_AUTHORIZATION_MODES.FULL_AUTO
        ? {
            fullAuto: true,
            enforcedBackupPolicy: 'session_backup'
          }
        : {})
    })

  if (descriptor?.enabled === false) {
    return createPermissionDecision({ allowed: false, reason: 'tool_disabled', mode })
  }

  if (isExecutableLevel(level) && !resolveWriteToolsFeatureFlag(ctx)) {
    return createPermissionDecision({ allowed: false, reason: 'write_tools_not_enabled', mode })
  }

  if (isReadableLevel(level)) {
    return createPermissionDecision({ allowed: true, reason: '', mode })
  }

  if (!isExecutableLevel(level)) {
    return createPermissionDecision({ allowed: false, reason: 'unknown_permission_level', mode })
  }

  if (userConfirmed) {
    return createAllowedExecutionDecision({
      allowed: true,
      reason: 'user_confirmed',
      mode,
      userConfirmed: true
    })
  }

  if (requiresExplicitConfirmation(descriptor, ctx)) {
    return createPermissionDecision({
      allowed: false,
      reason: 'all_destructive_confirmation_required',
      mode,
      confirmationRequired: true
    })
  }

  if (level === AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE && ctx.expandsAutomaticScope === true &&
      ctx.operationAuthorized !== true) {
    return createPermissionDecision({ allowed: false, reason: 'operation_scope_confirmation_required', mode, confirmationRequired: true })
  }

  if (ctx.boundedOperation === true && (ctx.operationAuthorized === true || mode === AGENT_PERMISSION_MODES.FULL_AUTO)) {
    return createAllowedExecutionDecision({ allowed: true,
      reason: ctx.operationAuthorized === true ? 'user_confirmed' : 'auto_allowed', mode })
  }

  const permissionGrant = descriptor.allowGrant === false || ctx.boundedOperation !== true
    ? null : resolveActivePermissionGrant(ctx)
  if (permissionGrant) {
    return createAllowedExecutionDecision({
      allowed: true,
      reason: 'permission_grant',
      mode,
      permissionGrant
    })
  }

  if (requiresConfirmation === 'always') {
    return createPermissionDecision({
      allowed: false,
      reason: 'always_confirmation_required',
      mode,
      confirmationRequired: true
    })
  }

  if (requiresConfirmation === 'never') {
    return createAllowedExecutionDecision({ allowed: true, reason: 'auto_allowed', mode })
  }

  if (mode === AI_AGENT_AUTHORIZATION_MODES.SAFE) {
    return createPermissionDecision({
      allowed: false,
      reason: 'safe_mode_confirmation_required',
      mode,
      confirmationRequired: true
    })
  }

  if (mode === AI_AGENT_AUTHORIZATION_MODES.SEMI_AUTO) {
    if (level === AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE) {
      return createPermissionDecision({
        allowed: false,
        reason: 'semi_auto_destructive_confirmation_required',
        mode,
        confirmationRequired: true
      })
    }
    return createAllowedExecutionDecision({ allowed: true, reason: 'auto_allowed', mode })
  }

  if (level === AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE) {
    return createPermissionDecision({ allowed: false, reason: 'semi_auto_destructive_confirmation_required', mode, confirmationRequired: true })
  }
  return createAllowedExecutionDecision({
    allowed: true,
    reason: 'auto_allowed',
    mode
  })
}
