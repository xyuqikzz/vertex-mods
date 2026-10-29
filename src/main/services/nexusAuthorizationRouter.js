import { createHash, randomUUID } from 'node:crypto'

import {
  matchNexusDownloadAuthorizationTarget,
  parseNexusDownloadAuthorization
} from '../../shared/sources/nexus-download-link.js'

export const NEXUS_AUTHORIZATION_CHANNELS = {
  registerWaiting: 'nexus-authorization:register-waiting',
  unregister: 'nexus-authorization:unregister',
  captured: 'nexus-authorization:captured',
  getWaiting: 'nexus-authorization:get-waiting'
}

const DEFAULT_TTL_MS = 10 * 60 * 1000
const MAX_TTL_MS = 30 * 60 * 1000
const sessions = new Map()
const consumedCallbacks = new Map()
let ipcRegistered = false

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function toPlainJson(data, fallback = {}) {
  try {
    const text = JSON.stringify(data ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

export function normalizeProtocolUrlArg(value = '') {
  return toSafeText(value).replace(/^['"]+|['"]+$/g, '')
}

export function isNxmProtocolUrl(value = '') {
  return /^nxm:\/\//i.test(normalizeProtocolUrlArg(value))
}

export function redactNexusAuthorizationUrl(value = '') {
  const urlText = normalizeProtocolUrlArg(value)
  if (!urlText) return ''
  return urlText.replace(/([?&](?:key|expires|user_id|userId)=)[^&]*/gi, '$1<redacted>')
}

function normalizeOwner(value = '') {
  const owner = toSafeText(value)
  return ['source-install-task', 'ai-agent'].includes(owner) ? owner : ''
}

function normalizeTarget(input = {}) {
  const target = parseNexusDownloadAuthorization(input)
  return {
    gameDomain: toSafeText(target.gameDomain),
    modId: toSafeNumber(target.modId),
    fileId: toSafeNumber(target.fileId),
    itemKey: toSafeText(input?.itemKey || input?.key)
  }
}

function normalizeTtlMs(value = DEFAULT_TTL_MS) {
  const ttlMs = Number(value)
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return DEFAULT_TTL_MS
  }
  return Math.min(ttlMs, MAX_TTL_MS)
}

function toSessionSnapshot(session = {}) {
  return {
    sessionId: session.sessionId,
    owner: session.owner,
    source: session.source,
    target: { ...session.target },
    context: { ...session.context },
    webContentsId: session.webContentsId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    status: session.status
  }
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now || session.status !== 'waiting') {
      sessions.delete(sessionId)
      if (session?.expireTimer) clearTimeout(session.expireTimer)
      if (session?.status === 'waiting' && session.expiresAt <= now) {
        notifySessionRejected(session, {
          reason: 'authorization_expired',
          message: 'Nexus 下载授权会话已过期，请重新打开文件页。'
        })
      }
    }
  }
}

export function getNexusAuthorizationWaitingSessions() {
  cleanupExpiredSessions()
  return Array.from(sessions.values()).map(toSessionSnapshot)
}

export function unregisterNexusAuthorizationSession(input = {}) {
  const sessionId = toSafeText(typeof input === 'string' ? input : input?.sessionId)
  if (!sessionId) {
    return {
      success: false,
      message: '缺少 Nexus 授权会话 ID'
    }
  }
  const session = sessions.get(sessionId)
  const existed = sessions.delete(sessionId)
  if (session?.expireTimer) clearTimeout(session.expireTimer)
  return {
    success: existed,
    sessionId
  }
}

export function registerNexusAuthorizationWaitingSession(payload = {}, options = {}) {
  cleanupExpiredSessions()

  const safePayload = toPlainJson(payload, {})
  const owner = normalizeOwner(safePayload.owner)
  if (!owner) {
    return {
      success: false,
      message: '不支持的 Nexus 授权会话所有者'
    }
  }

  const target = normalizeTarget({
    ...(safePayload.target || {}),
    itemKey: safePayload.itemKey
  })
  if (!target.gameDomain || !target.modId || !target.fileId) {
    return {
      success: false,
      message: '缺少 Nexus 授权目标信息'
    }
  }

  const webContents = options.webContents || null
  if (
    owner !== 'source-install-task' &&
    (!webContents || webContents.isDestroyed?.())
  ) {
    return {
      success: false,
      message: '授权目标窗口不可用'
    }
  }

  const now = Date.now()
  const sessionId = `nexus-auth-session-${randomUUID()}`
  const session = {
    sessionId,
    owner,
    source: 'nexus',
    target,
    context: {
      jobId: toSafeText(safePayload.jobId || safePayload.context?.jobId),
      itemId: toSafeText(safePayload.itemId || safePayload.context?.itemId),
      artifactKey: toSafeText(safePayload.artifactKey || safePayload.context?.artifactKey),
      planId: toSafeText(safePayload.planId || safePayload.context?.planId),
      agentTaskId: toSafeText(safePayload.agentTaskId || safePayload.context?.agentTaskId),
      windowRole: toSafeText(safePayload.windowRole || safePayload.context?.windowRole || 'main')
    },
    webContentsId: toSafeNumber(webContents?.id),
    webContents,
    onCaptured: typeof options.onCaptured === 'function' ? options.onCaptured : null,
    onRejected: typeof options.onRejected === 'function' ? options.onRejected : null,
    createdAt: now,
    expiresAt: now + normalizeTtlMs(safePayload.ttlMs),
    status: 'waiting'
  }

  sessions.set(sessionId, session)
  session.expireTimer = setTimeout(() => {
    const current = sessions.get(sessionId)
    if (!current || current.status !== 'waiting') return
    sessions.delete(sessionId)
    notifySessionRejected(current, {
      reason: 'authorization_expired',
      message: 'Nexus 下载授权会话已过期，请重新打开文件页。'
    })
  }, Math.max(1, session.expiresAt - Date.now()))
  if (typeof webContents?.once === 'function') {
    webContents.once('destroyed', () => {
      unregisterNexusAuthorizationSession({ sessionId })
    })
  }

  return {
    success: true,
    sessionId,
    expiresAt: session.expiresAt
  }
}

function buildCapturedPayload(session = {}, authorization = {}) {
  return {
    sessionId: session.sessionId,
    owner: session.owner,
    itemKey: session.target.itemKey,
    target: {
      ...session.target
    },
    context: { ...session.context },
    authorization: {
      gameDomain: authorization.gameDomain,
      modId: authorization.modId,
      fileId: authorization.fileId,
      key: authorization.key,
      expires: authorization.expires,
      userId: authorization.userId
    }
  }
}

function notifySessionCaptured(session = {}, authorization = {}) {
  if (typeof session.onCaptured !== 'function') return false
  try {
    Promise.resolve(session.onCaptured(buildCapturedPayload(session, authorization))).catch(() => {})
    return true
  } catch {
    return false
  }
}

function notifySessionRejected(session = {}, rejection = {}) {
  if (typeof session.onRejected !== 'function') return false
  const payload = {
    sessionId: session.sessionId,
    owner: session.owner,
    itemKey: session.target?.itemKey || '',
    target: { ...(session.target || {}) },
    context: { ...(session.context || {}) },
    reason: toSafeText(rejection.reason),
    message: toSafeText(rejection.message)
  }
  try {
    Promise.resolve(session.onRejected(payload)).catch(() => {})
    return true
  } catch {
    return false
  }
}

function findMatchingSession(authorization = {}) {
  const waitingSessions = Array.from(sessions.values())
    .filter((session) => session?.status === 'waiting')
    .sort((a, b) => a.createdAt - b.createdAt)

  return waitingSessions.find((session) => {
    return matchNexusDownloadAuthorizationTarget(authorization, session.target).matched
  })
}

export function routeNexusAuthorizationUrl(rawUrl = '', options = {}) {
  const protocolUrl = normalizeProtocolUrlArg(rawUrl)
  if (!isNxmProtocolUrl(protocolUrl)) {
    return {
      handled: false,
      reason: 'not_nxm_url'
    }
  }

  const authorization = parseNexusDownloadAuthorization(protocolUrl)
  cleanupExpiredSessions()
  for (const [key, expiresAt] of consumedCallbacks) {
    if (expiresAt <= Date.now()) consumedCallbacks.delete(key)
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(authorization)).digest('hex')
  if (consumedCallbacks.has(fingerprint)) return { handled: true, accepted: false, reason: 'duplicate_callback' }
  const scopedSession = options.sessionId ? sessions.get(options.sessionId) : null
  if (options.sessionId && !scopedSession) return { handled: true, accepted: false, reason: 'session_closed' }
  const candidates = Array.from(sessions.values()).filter((entry) =>
    matchNexusDownloadAuthorizationTarget(authorization, entry.target).matched)
  if (!scopedSession && candidates.length > 1) return { handled: true, accepted: false, reason: 'ambiguous_target' }
  const session = scopedSession || findMatchingSession(authorization)
  if (scopedSession) {
    const match = matchNexusDownloadAuthorizationTarget(authorization, scopedSession.target)
    if (!match.matched) {
      notifySessionRejected(scopedSession, match)
      return { handled: true, accepted: false, reason: match.reason }
    }
  }
  if (!session) {
    // An unrelated NXM link must never invalidate another file's authorization.
    const activeSession = Array.from(sessions.values()).find((entry) =>
      entry.target.gameDomain.toLowerCase() === authorization.gameDomain.toLowerCase() &&
      entry.target.modId === authorization.modId && entry.target.fileId === authorization.fileId)
    if (activeSession) {
      const mismatch = matchNexusDownloadAuthorizationTarget(authorization, activeSession.target)
      notifySessionRejected(activeSession, mismatch)
      return {
        handled: true,
        accepted: false,
        owner: activeSession.owner,
        sessionId: activeSession.sessionId,
        reason: mismatch.reason || 'target_mismatch'
      }
    }
    return {
      handled: true,
      accepted: false,
      reason: 'no_matching_session'
    }
  }

  sessions.delete(session.sessionId)
  consumedCallbacks.set(fingerprint, Math.min(Date.now() + MAX_TTL_MS,
    Number(authorization.expires) * (Number(authorization.expires) > 100000000000 ? 1 : 1000)))
  if (session.expireTimer) clearTimeout(session.expireTimer)
  session.status = 'captured'
  const captured = notifySessionCaptured(session, authorization)
  return {
    handled: true,
    accepted: captured,
    owner: session.owner,
    sessionId: session.sessionId,
    reason: captured ? 'matched_waiting_session' : 'captured_handler_missing'
  }
}

export function registerNexusAuthorizationRouterIpc(ipcMain) {
  if (!ipcMain || ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle(NEXUS_AUTHORIZATION_CHANNELS.getWaiting, async () => {
    return {
      success: true,
      sessions: getNexusAuthorizationWaitingSessions()
    }
  })
}

export function clearNexusAuthorizationRouterForTest() {
  sessions.forEach((session) => {
    if (session?.expireTimer) clearTimeout(session.expireTimer)
  })
  sessions.clear()
  consumedCallbacks.clear()
}
