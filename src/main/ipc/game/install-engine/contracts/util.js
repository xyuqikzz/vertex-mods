/**
 * contracts/util.js — 安装引擎纯工具
 *
 * 无领域语义的纯函数：类型判定、文本/数字归一、路径与列表归一、JSON 克隆、ID 生成。
 * 领域模型工厂见 contracts/model.js；两者经 contracts.js 门面统一对外导出。
 */
import crypto from 'crypto'

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function toSafeNumber(value, defaultValue = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : defaultValue
}

export function toArrayValue(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === undefined || value === null) {
    return []
  }

  return [value]
}

export function resolveFirstDefinedValue(...valueList) {
  for (const value of valueList) {
    if (value !== undefined && value !== null) {
      return value
    }
  }

  return undefined
}

export function normalizeRelativeRulePath(value = '') {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

export function normalizeTextList(value = [], options = {}) {
  const lowerCase = options?.lowerCase === true
  const pathLike = options?.pathLike === true
  const result = []
  const seen = new Set()

  for (const item of toArrayValue(value)) {
    let text = pathLike ? normalizeRelativeRulePath(item) : toSafeText(item)
    if (!text) {
      continue
    }

    if (lowerCase) {
      text = text.toLowerCase()
    }

    const key = text.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(text)
  }

  return result
}

export function normalizeExtensionList(value = []) {
  return normalizeTextList(value, { lowerCase: true })
    .map((item) => (item.startsWith('.') ? item : `.${item}`))
    .filter(Boolean)
}

export function toPlainJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? fallback))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function createInstallPlanId(prefix = 'plan') {
  const randomText =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${randomText}`
}
