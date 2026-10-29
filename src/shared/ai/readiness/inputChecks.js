// 模型预期、授权与可选参数验收条件。
import { readEnvText, parseEnvListText, hasAnyEnv } from './inputs.js'
import {
  MIN_REAL_MODEL_EXPECTED_TEXT_LENGTH,
  REAL_MODEL_PLAN_CARD_SOURCE_VALUES,
  NEXUS_AUTHORIZATION_ENV_KEYS,
  NEXUS_API_KEY_ENV_KEYS
} from './constants.js'
import {
  parseNexusDownloadAuthorization,
  isCompleteNexusDownloadAuthorization,
  isCompleteFreshNexusDownloadAuthorization
} from '../../sources/nexus-download-link.js'

export function hasValidOptionalForbiddenText(env = {}) {
  const rawText = readEnvText(env, 'VERTEX_REAL_EXTERNAL_LOG_FORBIDDEN_OUTPUT_TEXT')
  const rawTexts = readEnvText(env, 'VERTEX_REAL_EXTERNAL_LOG_FORBIDDEN_OUTPUT_TEXTS')
  if (!rawText && !rawTexts) return true
  const forbiddenTexts = parseEnvListText(`${rawText}\n${rawTexts}`)
  return forbiddenTexts.length > 0 && forbiddenTexts.every((item) => item.length >= 6)
}

export function hasValidOptionalPositiveInteger(
  env = {},
  key = '',
  maxValue = Number.MAX_SAFE_INTEGER
) {
  const value = readEnvText(env, key)
  if (!value) return true
  if (!/^\d+$/.test(value)) return false
  const parsed = Number.parseInt(value, 10)
  return parsed > 0 && parsed <= maxValue
}

export function hasValidOptionalBooleanFlag(env = {}, key = '') {
  const value = readEnvText(env, key)
  return !value || value === '0' || value === '1'
}

export function hasSafeOptionalHttpsUrl(env = {}, key = '') {
  const value = readEnvText(env, key)
  if (!value) return true
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function hasExpectedTextForCustomMessage(env = {}, messageKey = '', expectedTextKey = '') {
  return (
    hasRequiredEnvForCustomMessage(env, messageKey, [expectedTextKey]) &&
    hasValidOptionalMinLengthText(env, expectedTextKey, MIN_REAL_MODEL_EXPECTED_TEXT_LENGTH)
  )
}

export function hasRequiredEnvForCustomMessage(env = {}, messageKey = '', requiredKeys = []) {
  return !readEnvText(env, messageKey) || requiredKeys.every((key) => !!readEnvText(env, key))
}

export function hasValidOptionalMinLengthText(env = {}, key = '', minLength = 1) {
  const value = readEnvText(env, key)
  return !value || value.length >= minLength
}

export function hasValidOptionalPlanCardExpectedSource(env = {}) {
  const source = readEnvText(env, 'VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_SOURCE').toLowerCase()
  return !source || REAL_MODEL_PLAN_CARD_SOURCE_VALUES.includes(source)
}

function resolveNexusAuthorizationText(env = {}) {
  for (const key of NEXUS_AUTHORIZATION_ENV_KEYS) {
    const value = readEnvText(env, key)
    if (value) return value
  }
  return ''
}

function resolveNexusAuthorization(env = {}) {
  return parseNexusDownloadAuthorization(resolveNexusAuthorizationText(env))
}

export function hasCompleteNexusAuthorization(env = {}) {
  return isCompleteNexusDownloadAuthorization(resolveNexusAuthorization(env))
}

export function hasFreshNexusAuthorization(env = {}) {
  return isCompleteFreshNexusDownloadAuthorization(resolveNexusAuthorization(env))
}

export function hasNexusApiKey(context = {}) {
  const apiKeyStatus =
    context?.nexusApiKeyStatus && typeof context.nexusApiKeyStatus === 'object'
      ? context.nexusApiKeyStatus
      : null
  if (apiKeyStatus) {
    if (apiKeyStatus.hasApiKey === true || apiKeyStatus.configured === true) return true
    if (apiKeyStatus.hasApiKey === false || apiKeyStatus.configured === false) return false
  }
  return hasAnyEnv(context?.env || {}, NEXUS_API_KEY_ENV_KEYS)
}
