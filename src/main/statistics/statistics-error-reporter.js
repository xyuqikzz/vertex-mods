import { accountVault } from '../security/accounts.js'
import axios from 'axios'
import crypto from 'crypto'
import { app } from 'electron'
import store from '../storage/store/index.js'
import { TtlLruCache } from '../../shared/utils/ttl-lru-cache.js'
import { statisticsEnabled, withStatisticsConsent } from './consent.js'

const { VITE_REQUEST_API, VITE_APP_VERSION } = import.meta.env

const CLIENT_ID_KEY = 'statistics.mainClientId'
const API_PATH = '/api/statistics/events/batch'
const ERROR_FULL_INTERVAL = 60000
const SENSITIVE_KEY_PATTERN = /token|cookie|authorization|password|secret|apikey|api_key/i

const silentAxios = axios.create({
  timeout: 10000,
  withCredentials: true
})

const lastErrorMap = new TtlLruCache({ max: 2000, ttl: 24 * 60 * 60 * 1000 })

export function reportMainProcessError(error, options = {}) {
  if (!statisticsEnabled()) return
  queueMicrotask(() => {
    sendMainProcessError(error, options).catch(() => {})
  })
}

export function reportProcessGone(errorType, details = {}) {
  const reason = details?.reason || details?.type || 'unknown'
  reportMainProcessError(reason, {
    errorType,
    properties: details
  })
}

async function sendMainProcessError(error, options = {}) {
  if (!statisticsEnabled()) return
  const errorType = options.errorType || 'main_process_error'
  const message = sanitizeText(resolveErrorMessage(error), 1024)
  const stack = sanitizeStack(resolveErrorStack(error))
  const errorHash = createErrorHash(errorType, message, stack)
  const now = Date.now()
  const lastAt = lastErrorMap.get(errorHash) || 0
  const includeStack = now - lastAt >= ERROR_FULL_INTERVAL
  lastErrorMap.set(errorHash, now)

  const clientId = getOrCreateClientId()
  const userData = getUserData()
  const event = {
    eventId: crypto.randomUUID(),
    eventType: 'client_error',
    userId: userData.userId,
    clientId,
    source: 'vertex',
    targetType: 'error',
    status: 'fail',
    clientVersion: getClientVersion(),
    os: 'windows',
    errorType,
    errorHash,
    errorMessage: message,
    errorStack: includeStack ? stack : '',
    properties: sanitizeProperties({
      ...safePlainObject(options.properties),
      processType: 'main',
      stackOmitted: !includeStack
    }),
    createdAt: new Date().toISOString()
  }

  await withStatisticsConsent(signal => silentAxios.post(
    resolveReportUrl(),
    {
      clientId,
      userId: userData.userId,
      clientVersion: getClientVersion(),
      events: [event]
    },
    {
      headers: buildHeaders(userData.token),
      signal
    }
  ))
}

function buildHeaders(token) {
  const headers = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['vertex-token'] = `Bearer ${token}`
  }
  return headers
}

function resolveReportUrl() {
  const baseUrl = String(VITE_REQUEST_API || '').trim()
  return `${resolveApiRoot(baseUrl)}${API_PATH}`
}

function resolveApiRoot(baseUrl) {
  try {
    const url = new URL(baseUrl)
    url.pathname = url.pathname.replace(/\/client\/?$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl.replace(/\/client\/?$/, '').replace(/\/$/, '')
  }
}

function getClientVersion() {
  try {
    return app.getVersion() || VITE_APP_VERSION || '1.0.0'
  } catch {
    return VITE_APP_VERSION || '1.0.0'
  }
}

function getOrCreateClientId() {
  const existing = String(store.get(CLIENT_ID_KEY) || '').trim()
  if (existing) return existing
  const value = crypto.randomUUID()
  store.set(CLIENT_ID_KEY, value)
  return value
}

function getUserData() {
  const token = String(accountVault.token() || '').trim()
  return {
    userId: '',
    token
  }
}

function resolveErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return error?.message || JSON.stringify(toPlainJson(error)) || 'unknown error'
  } catch {
    return 'unknown error'
  }
}

function resolveErrorStack(error) {
  if (error instanceof Error) return error.stack || ''
  return error?.stack || ''
}

function sanitizeStack(stack) {
  return sanitizeText(
    String(stack || '')
      .split('\n')
      .slice(0, 12)
      .join('\n'),
    8192
  )
}

function sanitizeProperties(properties) {
  const plain = safePlainObject(properties)
  const json = JSON.stringify(plain)
  if (json.length > 3500) {
    return {
      truncated: true
    }
  }
  return plain
}

function safePlainObject(value) {
  const plain = toPlainJson(value || {})
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return {}
  return removeSensitiveFields(plain)
}

function removeSensitiveFields(value, depth = 0) {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => removeSensitiveFields(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((result, [key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[redacted]'
      } else {
        result[key] = removeSensitiveFields(item, depth + 1)
      }
      return result
    }, {})
  }
  if (typeof value === 'string') {
    return sanitizeText(value, 512)
  }
  return value
}

function toPlainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return {}
  }
}

function sanitizeText(value, maxLength) {
  const text = trimText(value, maxLength)
  return text
    .replace(/(authorization|cookie|token)\s*[:=]\s*[^;\s]+/gi, '$1=[redacted]')
    .replace(/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\***')
    .replace(/\/Users\/[^/\s]+/g, '/Users/***')
}

function trimText(value, maxLength) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function createErrorHash(errorType, message, stack) {
  const keyFrame =
    String(stack || '')
      .split('\n')
      .find((line) => line.trim()) || ''
  const text = `${errorType}|${message}|${keyFrame}`
  return `main_${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`
}
