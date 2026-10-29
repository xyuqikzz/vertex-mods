export function normalizePathLike(input = '') {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

export function toPathParts(relativePath = '') {
  const text = normalizePathLike(relativePath)
  return text ? text.split('/') : []
}

export function normalizeLaunchArgumentList(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()
  return text ? [text] : []
}
