import crypto from 'crypto'
import { INSPECT_TOKEN_TTL_MS, STANDARD_ERROR_CODE } from './constants.js'
import { createStandardError } from './errors.js'

const inspectTokenStore = new Map()

function createInspectToken(source = 'standard') {
  if (typeof crypto.randomUUID === 'function') {
    return `${source}_inspect_${crypto.randomUUID()}`
  }
  return `${source}_inspect_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function cleanupExpiredInspectTokens(now = Date.now()) {
  for (const [token, entry] of inspectTokenStore.entries()) {
    if (Number(entry?.expiresAt || 0) <= now) {
      inspectTokenStore.delete(token)
    }
  }
}

export function putInspectPreview(entry = {}) {
  cleanupExpiredInspectTokens()
  const source = String(entry.source || 'standard').trim() || 'standard'
  const token = createInspectToken(source)
  const now = Date.now()
  inspectTokenStore.set(token, {
    ...entry,
    source,
    inspectToken: token,
    createdAt: now,
    expiresAt: now + Number(entry.ttlMs || INSPECT_TOKEN_TTL_MS)
  })
  return token
}

export function peekInspectPreview(token = '') {
  cleanupExpiredInspectTokens()
  const safeToken = String(token || '').trim()
  if (!safeToken) return null
  const entry = inspectTokenStore.get(safeToken)
  if (!entry) return null
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    inspectTokenStore.delete(safeToken)
    return null
  }
  return entry
}

export function consumeInspectPreview(token = '', options = {}) {
  const entry = peekInspectPreview(token)
  if (!entry) {
    throw createStandardError(STANDARD_ERROR_CODE.PLAN_EXPIRED, '安装预检结果不存在或已过期', {
      recoverable: true
    })
  }
  if (options.consume !== false) {
    inspectTokenStore.delete(String(token || '').trim())
  }
  return entry
}
