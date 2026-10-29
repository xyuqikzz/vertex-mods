import { normalizeSourcePlatform } from '../../../../shared/sources/source-platform-registry.js'
import crypto from 'crypto'
import fs from 'fs'
import { STANDARD_ERROR_CODE, STANDARD_SOURCE } from './constants.js'
import { createStandardError } from './errors.js'
import { sanitizeSourceInstallTaskPayloadForPersistence } from '../source-install-task/taskSecurity.js'

const TOKEN_FIELD_SET = new Set([
  'standardPreflightAuthorization',
  'agentAuthorization',
  'sourceInstallJobId',
  'sourceInstallItemId',
  'inspectToken',
  'standardInspectToken',
  'payloadHash',
  'stagingToken',
  'legacyStagingToken',
  'nexusPreviewToken',
  'previewToken',
  'nexus_preview_token'
])

export function toPlainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch (error) {
    throw createStandardError(
      STANDARD_ERROR_CODE.IPC_CLONE_FAILED,
      '安装请求包含不可结构化克隆的数据',
      { cause: error, recoverable: false }
    )
  }
}

export function ensurePlainObject(value, message = '安装请求参数必须是对象') {
  const target = toPlainJson(value)
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw createStandardError(STANDARD_ERROR_CODE.IPC_INVALID_PAYLOAD, message, {
      recoverable: false
    })
  }
  return target
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item))
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (TOKEN_FIELD_SET.has(key)) {
          return result
        }
        const normalized = stableClone(value[key])
        if (normalized !== undefined) {
          result[key] = normalized
        }
        return result
      }, {})
  }
  if (value === undefined) return undefined
  return value
}

export function createPayloadHash(payload = {}) {
  const normalized = stableClone(toPlainJson(payload))
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function buildLegacySourceHashRequest(request = {}) {
  // Tasks discard temporary download credentials before execution. Bind preflight
  // approval to that same persisted representation, while keeping install identity,
  // paths and rules in the hash.
  const source = resolveSourceFromPayload(request)
  const data = sanitizeSourceInstallTaskPayloadForPersistence({ source, data: request?.data }).data
  return {
    filePath: String(request?.filePath || '')
      .trim()
      .replace(/\\/g, '/'),
    data,
    type: Number(request?.type || 1)
  }
}

export function normalizeSourceKey(value = '') {
  const source = normalizeSourcePlatform(value)
  if (source === 'nexusmods') return STANDARD_SOURCE.NEXUS
  if (source === 'mod.io') return STANDARD_SOURCE.MODIO
  return source || STANDARD_SOURCE.UNKNOWN
}

export function resolveSourceFromPayload(payload = {}, fallback = STANDARD_SOURCE.NEXUS) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const data = target.data && typeof target.data === 'object' ? target.data : {}
  return normalizeSourceKey(
    target.source ||
      target.sourceType ||
      target.sourcePlatform ||
      data.source ||
      data.sourceType ||
      data.sourcePlatform ||
      data.sourceMeta?.source ||
      fallback
  )
}

export function normalizeLegacySourceInspectRequest(payload = {}) {
  const target = ensurePlainObject(payload)
  const data = target.data && typeof target.data === 'object' ? target.data : {}
  return {
    filePath: String(target.filePath || '').trim(),
    data,
    type: Number(target.type || data.type || 1)
  }
}

export function normalizeLegacySourceInstallRequest(payload = {}) {
  const target = ensurePlainObject(payload)
  const data = target.data && typeof target.data === 'object' ? target.data : {}
  return {
    filePath: String(target.filePath || '').trim(),
    data,
    type: Number(target.type || 1)
  }
}

export function normalizeFicsitRequest(payload = {}) {
  return ensurePlainObject(payload)
}

export function validateArchiveFilePath(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    throw createStandardError(STANDARD_ERROR_CODE.PACKAGE_NOT_FOUND, '缺少压缩包路径', {
      recoverable: false
    })
  }
  if (!fs.existsSync(safeFilePath)) {
    throw createStandardError(STANDARD_ERROR_CODE.PACKAGE_NOT_FOUND, '压缩包不存在', {
      recoverable: true,
      details: {
        filePath: safeFilePath
      }
    })
  }
}

export function pickInspectToken(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const data = target.data && typeof target.data === 'object' ? target.data : {}
  return String(
    target.inspectToken ||
      target.standardInspectToken ||
      data.inspectToken ||
      data.standardInspectToken ||
      data.nexusPreviewToken ||
      target.nexusPreviewToken ||
      ''
  ).trim()
}
