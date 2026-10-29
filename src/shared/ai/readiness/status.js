// 就绪门槛、状态优先级与结果展示。
import { hasRuntimeText, isEnvEnabled } from './inputs.js'
import { AI_AGENT_READINESS_STATUSES, STATUS_VIEW, BATCH_LABELS } from './constants.js'

export function createGate(label = '', passed = false) {
  return {
    label,
    passed: passed === true
  }
}

export function createModelRuntimeGates(runtimeStatus = {}) {
  return [
    createGate('模型运行时已配置', runtimeStatus?.configured === true),
    createGate(
      '模型配置来源有效',
      ['aiAgent', 'aiTranslation'].includes(String(runtimeStatus?.configSource || ''))
    ),
    createGate('模型 baseURL 已配置', runtimeStatus?.baseURLConfigured === true),
    createGate('模型 providerType 已配置', hasRuntimeText(runtimeStatus, 'providerType')),
    createGate('模型名称已配置', hasRuntimeText(runtimeStatus, 'model')),
    createGate(
      'Agent 工具列表已暴露',
      Array.isArray(runtimeStatus?.tools) && runtimeStatus.tools.length > 0
    )
  ]
}

function resolveStatusView(status = '') {
  return STATUS_VIEW[status] || STATUS_VIEW[AI_AGENT_READINESS_STATUSES.NEEDS_INPUT]
}

export function buildReadinessItem(definition = {}, context = {}) {
  const gates = typeof definition.gates === 'function' ? definition.gates(context) : []
  const status =
    typeof definition.status === 'function'
      ? definition.status(context, gates)
      : gates.every((item) => item.passed)
        ? AI_AGENT_READINESS_STATUSES.READY
        : AI_AGENT_READINESS_STATUSES.NEEDS_INPUT
  const statusView = resolveStatusView(status)

  return {
    key: definition.key,
    title: definition.title,
    batch: definition.batch,
    batchLabel: BATCH_LABELS[definition.batch] || definition.batch || '',
    status,
    statusLabel: statusView.label,
    statusTone: statusView.tone,
    gates,
    requiredInputs: Array.isArray(definition.requiredInputs) ? [...definition.requiredInputs] : [],
    evidence: definition.evidence || ''
  }
}

export function statusFromGatePriority(gates = []) {
  const missingModelConfig = gates.some((item) => item.label === '模型运行时已配置' && !item.passed)
  if (missingModelConfig) return AI_AGENT_READINESS_STATUSES.NEEDS_INPUT
  const missingRequiredInput = gates.some(
    (item) => /^(已提供|已确认)/.test(item.label) && !item.passed
  )
  if (missingRequiredInput) return AI_AGENT_READINESS_STATUSES.NEEDS_INPUT
  return gates.every((item) => item.passed)
    ? AI_AGENT_READINESS_STATUSES.READY
    : AI_AGENT_READINESS_STATUSES.PROTECTED
}

export function statusFromRealUiGates(context = {}, gates = []) {
  if (gates.some((item) => item.passed)) return AI_AGENT_READINESS_STATUSES.READY
  const env = context?.env || {}
  if (
    isEnvEnabled(env, 'VERTEX_ENABLE_REAL_NEXUS_AUTH_INSTALL') ||
    isEnvEnabled(env, 'VERTEX_ENABLE_REAL_USER_DIRECTORY_INSTALL')
  ) {
    return AI_AGENT_READINESS_STATUSES.PROTECTED
  }
  return AI_AGENT_READINESS_STATUSES.NEEDS_INPUT
}
