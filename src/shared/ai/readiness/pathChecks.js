// 日志和安装目录的路径验收条件。
import { parseEnvListText, readEnvText } from './inputs.js'

function resolveExternalLogPathTexts(env = {}) {
  return [
    ...parseEnvListText(env?.VERTEX_REAL_EXTERNAL_LOG_PATHS),
    ...parseEnvListText(env?.VERTEX_REAL_EXTERNAL_LOG_PATH)
  ]
}

export function hasAllowedExternalLogExtensions(env = {}) {
  const paths = resolveExternalLogPathTexts(env)
  if (!paths.length) return false
  return paths.every((item) => /\.(log|txt)$/i.test(item))
}

export function hasAbsoluteExternalLogPaths(env = {}) {
  const paths = resolveExternalLogPathTexts(env)
  if (!paths.length) return false
  return paths.every((item) => isAbsolutePathText(item))
}

export function hasSafeExternalLogPaths(env = {}) {
  const paths = resolveExternalLogPathTexts(env)
  if (!paths.length) return false
  return paths.every(
    (item) => isAbsolutePathText(item) && !isPathRootText(item) && !isUserHomePathText(env, item)
  )
}

function findExternalLogFileStatus(externalLogFileStatus = [], pathText = '') {
  const normalizedPath = normalizePathForComparison(pathText)
  if (!normalizedPath) return null
  const statusList = Array.isArray(externalLogFileStatus)
    ? externalLogFileStatus
    : Object.entries(externalLogFileStatus || {}).map(([filePath, status]) => ({
        ...(status && typeof status === 'object' ? status : {}),
        filePath
      }))
  return (
    statusList.find((item) => normalizePathForComparison(item?.filePath) === normalizedPath) || null
  )
}

export function hasExistingExternalLogFiles(env = {}, externalLogFileStatus = []) {
  const paths = resolveExternalLogPathTexts(env)
  if (!paths.length) return false
  return paths.every((item) => {
    const status = findExternalLogFileStatus(externalLogFileStatus, item)
    return status?.exists === true && status?.isFile === true
  })
}

export function hasInstallExpectedPathsWhenWildcard(
  env = {},
  patternKey = '',
  expectedPathsKey = '',
  defaultPattern = ''
) {
  const pattern = readEnvText(env, patternKey) || defaultPattern
  if (!pattern) return false
  if (!/[*?[\]{}]/.test(pattern)) return true
  return parseEnvListText(env?.[expectedPathsKey]).length > 0
}

export function hasSafeInstallPattern(env = {}, key = '', defaultPattern = '') {
  const pattern = readEnvText(env, key) || defaultPattern
  return isSafeRelativePathText(pattern)
}

function normalizePathForComparison(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
  if (/^\/+$/.test(normalized)) return '/'
  if (/^[A-Za-z]:\/+$/.test(normalized)) return normalized.slice(0, 2).toLowerCase()
  return normalized.replace(/\/+$/g, '').toLowerCase()
}

function isAbsolutePathText(value = '') {
  const text = String(value || '').trim()
  return (
    /^[A-Za-z]:[\\/]/.test(text) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(text) || text.startsWith('/')
  )
}

function isPathRootText(value = '') {
  const text = String(value || '')
    .trim()
    .replace(/\\/g, '/')
  if (/^\/+$/.test(text)) return true
  if (/^[A-Za-z]:\/*$/.test(text)) return true
  if (text.startsWith('//')) {
    return text.replace(/\/+$/g, '').split('/').filter(Boolean).length === 2
  }
  return false
}

function resolveHomePathTexts(env = {}) {
  const candidates = [readEnvText(env, 'USERPROFILE'), readEnvText(env, 'HOME')]
  const homeDrive = readEnvText(env, 'HOMEDRIVE')
  const homePath = readEnvText(env, 'HOMEPATH')
  if (homeDrive && homePath) candidates.push(`${homeDrive}${homePath}`)
  return candidates.filter(Boolean)
}

function isUserHomePathText(env = {}, value = '') {
  const normalizedValue = normalizePathForComparison(value)
  if (!normalizedValue) return false
  return resolveHomePathTexts(env).some(
    (homePath) => normalizePathForComparison(homePath) === normalizedValue
  )
}

export function isDirectoryRootAbsolute(env = {}, key = '') {
  const value = readEnvText(env, key)
  return !!value && isAbsolutePathText(value)
}

export function isDirectoryRootSafe(env = {}, key = '') {
  const value = readEnvText(env, key)
  return (
    !!value &&
    isAbsolutePathText(value) &&
    !isPathRootText(value) &&
    !isUserHomePathText(env, value)
  )
}

function findDirectoryRootStatus(directoryRootStatus = [], pathText = '') {
  const normalizedPath = normalizePathForComparison(pathText)
  if (!normalizedPath) return null
  const statusList = Array.isArray(directoryRootStatus)
    ? directoryRootStatus
    : Object.entries(directoryRootStatus || {}).map(([filePath, status]) => ({
        ...(status && typeof status === 'object' ? status : {}),
        filePath
      }))
  return (
    statusList.find((item) => normalizePathForComparison(item?.filePath) === normalizedPath) || null
  )
}

export function hasExistingDirectoryRoot(env = {}, key = '', directoryRootStatus = []) {
  const value = readEnvText(env, key)
  if (!value) return false
  const status = findDirectoryRootStatus(directoryRootStatus, value)
  return status?.exists === true && status?.isDirectory === true
}

export function hasDirectoryRootSmokeMarker(env = {}, key = '', directoryRootStatus = []) {
  const value = readEnvText(env, key)
  if (!value) return false
  const status = findDirectoryRootStatus(directoryRootStatus, value)
  return status?.markerExists === true && status?.markerIsFile === true
}

function isSafeRelativePathText(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (isAbsolutePathText(text) || /^[A-Za-z]:/.test(text)) return false
  return !text
    .split(/[\\/]+/)
    .filter(Boolean)
    .includes('..')
}

function isSafePathSegmentText(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (text === '.' || text === '..') return false
  if (/[\\/]/.test(text)) return false
  if (text.includes('..')) return false
  if (isAbsolutePathText(text) || /^[A-Za-z]:/.test(text)) return false
  return true
}

export function hasSafeOptionalRelativePath(env = {}, key = '') {
  const value = readEnvText(env, key)
  return !value || isSafeRelativePathText(value)
}

export function hasSafeOptionalPathSegment(env = {}, key = '') {
  const value = readEnvText(env, key)
  return !value || isSafePathSegmentText(value)
}

export function hasSafeInstallExpectedPaths(env = {}, key = '') {
  const paths = parseEnvListText(env?.[key])
  return paths.every((item) => isSafeRelativePathText(item))
}
