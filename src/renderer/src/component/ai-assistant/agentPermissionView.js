import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { formatAiAgentPermissionReason } from '../../../../shared/ai/permissions/ai-agent-permission-reason.js'

const permissionLevelTextMap = Object.freeze({
  get read() { return uiText('ui.readOnly') },
  get plan() { return uiText('ui.planVariant2') },
  get execute() { return uiText('ui.execute') },
  get destructive() { return uiText('ui.highRisk') }
})

const requiresConfirmationTextMap = Object.freeze({
  get true() { return uiText('ui.confirmationRequired') },
  get false() { return uiText('ui.noConfirmationRequired') },
  get never() { return uiText('ui.noConfirmationRequired') },
  get by_policy() { return uiText('ui.confirmAccordingToPolicy') },
  get always() { return uiText('ui.alwaysRequireConfirmation') }
})

function safeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function isPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function pickFirstDefined(...values) {
  return values.find((value) => typeof value !== 'undefined' && value !== null)
}

function pickPermissionDecision(source = {}, permission = {}) {
  if (isPlainObject(source.permissionDecision)) return source.permissionDecision
  if (isPlainObject(source.decision)) return source.decision
  if (isPlainObject(permission.decision)) return permission.decision
  return {}
}

export function formatAgentPermissionReason(reason = '') {
  return formatAiAgentPermissionReason(reason)
}

export function formatAgentPermissionLevel(permissionLevel = '') {
  const key = safeText(permissionLevel)
  return permissionLevelTextMap[key] || key
}

export function formatAgentRequiresConfirmation(requiresConfirmation = '') {
  const key = safeText(requiresConfirmation)
  return requiresConfirmationTextMap[key] || key
}

export function resolveAgentPermission(source = {}) {
  const permission = isPlainObject(source.permission) ? source.permission : {}
  const decision = pickPermissionDecision(source, permission)
  return {
    permissionLevel: safeText(
      pickFirstDefined(source.permissionLevel, permission.permissionLevel, decision.permissionLevel)
    ),
    requiresConfirmation: safeText(
      pickFirstDefined(
        source.requiresConfirmation,
        permission.requiresConfirmation,
        decision.requiresConfirmation,
        source.confirmationRequired,
        permission.confirmationRequired,
        decision.confirmationRequired
      )
    ),
    mode: safeText(pickFirstDefined(source.mode, permission.mode, decision.mode)),
    reason: safeText(
      pickFirstDefined(source.permissionReason, source.reason, permission.reason, decision.reason)
    ),
    reasonMessage: safeText(
      pickFirstDefined(
        source.permissionReasonMessage,
        source.reasonMessage,
        permission.reasonMessage,
        decision.reasonMessage
      )
    ),
    errorCode: safeText(
      pickFirstDefined(source.permissionErrorCode, permission.errorCode, decision.errorCode)
    )
  }
}

export function formatAgentPermissionLine(source = {}) {
  const permission = resolveAgentPermission(source)
  return [
    permission.permissionLevel
      ? uiText('ui.permissionValue', { value1: (formatAgentPermissionLevel(permission.permissionLevel)) })
      : '',
    permission.requiresConfirmation
      ? uiText('ui.confirmationValue', { value1: (formatAgentRequiresConfirmation(permission.requiresConfirmation)) })
      : '',
    permission.mode ? uiText('ui.modeValue', { value1: (permission.mode) }) : '',
    permission.reasonMessage || (permission.reason ? formatAgentPermissionReason(permission.reason) : ''),
    permission.errorCode ? uiText('ui.errorCodeValue', { value1: (permission.errorCode) }) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}
