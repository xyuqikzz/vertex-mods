// 安装计划内部的值归一化。
import { resolveSourcePlatformLabel } from '../../../../shared/sources/source-platform-registry.js'

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

export function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object') {
    return toPlainJson(value, fallback)
  }

  const text = toSafeText(value)
  if (!text) {
    return fallback
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? toPlainJson(parsed, fallback) : fallback
  } catch {
    return fallback
  }
}

export function resolveSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source, 'Vertex')
}

export function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

export function normalizeTextKey(value = '') {
  return toSafeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
}
