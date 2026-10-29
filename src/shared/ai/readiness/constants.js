// 就绪状态与共享约束。

export const AI_AGENT_READINESS_STATUSES = Object.freeze({
  READY: 'ready',
  PROTECTED: 'protected',
  NEEDS_INPUT: 'needs_input',
  BLOCKED: 'blocked'
})

export const STATUS_VIEW = Object.freeze({
  [AI_AGENT_READINESS_STATUSES.READY]: Object.freeze({
    label: '可执行',
    tone: 'success'
  }),
  [AI_AGENT_READINESS_STATUSES.PROTECTED]: Object.freeze({
    label: '保护中',
    tone: 'warning'
  }),
  [AI_AGENT_READINESS_STATUSES.NEEDS_INPUT]: Object.freeze({
    label: '待补充',
    tone: 'warning'
  }),
  [AI_AGENT_READINESS_STATUSES.BLOCKED]: Object.freeze({
    label: '需确认',
    tone: 'muted'
  })
})

export const BATCH_LABELS = Object.freeze({
  chat: 'UI / 聊天真机批次',
  install: '安装端到端批次',
  ui: '真实 UI 验收批次',
  nexus: 'Nexus 真实授权批次',
  destructive: '高风险能力批次',
  log: '真实日志诊断批次'
})

export const MIN_REAL_MODEL_EXPECTED_TEXT_LENGTH = 6

export const MIN_REAL_EXTERNAL_LOG_EXPECTED_MOD_LENGTH = 3

export const MIN_REAL_EXTERNAL_LOG_EXPECTED_ERROR_TEXT_LENGTH = 6

export const REAL_MODEL_PLAN_CARD_SOURCE_VALUES = Object.freeze([
  'vertex',
  'nexus',
  'modio',
  'ficsit',
  'thunderstore'
])

export const REAL_MODEL_PLAN_CARD_SOURCE_LABEL = REAL_MODEL_PLAN_CARD_SOURCE_VALUES.join('/')

export const NEXUS_AUTHORIZATION_ENV_KEYS = Object.freeze([
  'VERTEX_REAL_NEXUS_AUTHORIZATION',
  'VERTEX_NEXUS_AUTHORIZATION',
  'VERTEX_NEXUS_NXM_URL',
  'NEXUS_NXM_URL'
])

export const NEXUS_API_KEY_ENV_KEYS = Object.freeze(['NEXUS_API_KEY', 'VITE_NEXUS_API_KEY'])

export const REAL_DIRECTORY_SMOKE_MARKER_FILE = '.vertex-real-smoke-ok'
