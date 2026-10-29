import { normalizePublicGameKey } from '../games/game-rule-support.js'

export const SHARED_RULE_CONTRACT_VERSION = 1
export const SHARED_RULE_SOURCES = new Set([
  'nexus',
  'modio',
  'ficsit',
  'vamhub',
  'local_zip',
  'gamebanana',
  'curseforge',
  'steam-workshop'
])

export function sharedRuleError(state, message) {
  const error = new Error(message || '公共安装规则当前不可用')
  error.code = 'SHARED_RULE_' + state
  error.availability = state
  return error
}

export function describeSharedRuleFailure(error) {
  const state = String(error?.availability || error?.code || '').replace(/^SHARED_RULE_/, '')
  const labels = {
    NOT_CONFIGURED: '未配置规则',
    UNPUBLISHED: '规则未发布',
    WITHDRAWN: '规则已下架',
    MIGRATION_PENDING: '规则待迁移',
    MIGRATION_BLOCKED: '规则迁移受阻',
    CONTRACT_UNSUPPORTED: '规则接口版本不一致',
    SCHEMA_UNSUPPORTED: '规则格式不受支持',
    HASH_MISMATCH: '规则校验失败',
    INVALID_RESPONSE: '规则内容异常',
    IDENTITY_MISSING: '缺少游戏标识'
  }
  const label = labels[state] || '规则获取失败'
  const message = labels[state]
    ? String(error?.message || label)
    : '暂时无法获取公共规则，请检查服务连接后重试。'
  return { state: labels[state] ? state : 'REQUEST_FAILED', label, message }
}

export function sharedRuleIdentity(document = {}) {
  return {
    contractVersion: document.contractVersion,
    documentId: document.documentId,
    gameKey: document.gameKey || String(document.canonicalGameKey || '').replace(/^game:/, ''),
    canonicalGameKey: document.canonicalGameKey,
    revision: document.revision,
    contentHash: document.contentHash,
    schemaVersion: document.schemaVersion
  }
}

export async function verifySharedRuleDocument(document = {}) {
  if (document.contractVersion !== SHARED_RULE_CONTRACT_VERSION) {
    throw sharedRuleError('CONTRACT_UNSUPPORTED', '公共规则接口协议不一致，请更新客户端与后端')
  }
  if (document.availability !== 'PUBLISHED') {
    throw sharedRuleError(document.availability || 'INVALID_RESPONSE', document.message)
  }
  if (
    !Number.isSafeInteger(document.documentId) ||
    document.documentId <= 0 ||
    !Number.isSafeInteger(document.revision) ||
    document.revision <= 0 ||
    !normalizePublicGameKey(document.gameKey) ||
    document.gameKey !== normalizePublicGameKey(document.gameKey) ||
    document.canonicalGameKey !== `game:${document.gameKey}`
  ) {
    throw sharedRuleError('INVALID_RESPONSE', '公共规则身份或 Schema 无效')
  }
  if (document.schemaVersion !== 5) {
    throw sharedRuleError(
      'SCHEMA_UNSUPPORTED',
      '公共安装规则需使用 Schema v5，请在后台升级并发布规则'
    )
  }
  const text = String(document.ruleJsonText || '')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  if (hash !== document.contentHash) throw sharedRuleError('HASH_MISMATCH', '公共规则内容校验失败')
  let rule
  try {
    rule = JSON.parse(text)
  } catch {
    throw sharedRuleError('INVALID_RESPONSE', '规则正文不是有效 JSON')
  }
  if (!rule || typeof rule !== 'object' || Array.isArray(rule))
    throw sharedRuleError('INVALID_RESPONSE', '规则正文无效')
  if (
    rule.schema_version !== document.schemaVersion ||
    (rule.schemaVersion !== undefined && rule.schemaVersion !== document.schemaVersion)
  ) {
    throw sharedRuleError('SCHEMA_UNSUPPORTED', '规则正文版本与公共规则 Schema v5 不一致')
  }
  return { ...document, ruleJson: rule, sharedRuleDocument: sharedRuleIdentity(document) }
}

export function sharedRuleCacheKey(document) {
  return [
    'shared-install-rule',
    document.contractVersion,
    document.documentId,
    document.revision
  ].join(':')
}

export function sameSharedRule(left, right) {
  return (
    !!left &&
    !!right &&
    left.contractVersion === right.contractVersion &&
    left.documentId === right.documentId &&
    left.canonicalGameKey === right.canonicalGameKey &&
    left.revision === right.revision &&
    left.contentHash === right.contentHash
  )
}
