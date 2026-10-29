import { toSafeText } from '../contracts.js'

export function isTextOrNumber(value) {
  return typeof value === 'string' || typeof value === 'number'
}

export function isValidTextList(value) {
  if (Array.isArray(value)) {
    return value.every(isTextOrNumber)
  }
  return isTextOrNumber(value)
}

export function hasTextValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => isTextOrNumber(item) && toSafeText(item))
  }
  return isTextOrNumber(value) && !!toSafeText(value)
}

export function isValidNumberLike(value) {
  if (value === undefined || value === null || value === '') return false
  return Number.isFinite(Number(value))
}

export function resolveFirstDefinedValue(...valueList) {
  for (const value of valueList) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}
