function hasUninstallPathEntries(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0

  const text = String(value || '').trim()
  if (!text) return false
  try {
    return hasUninstallPathEntries(JSON.parse(text))
  } catch {
    return false
  }
}

export function resolveModUninstallPathPayload(mod = {}) {
  for (const candidate of [mod?.install_paths_json, mod?.files_json]) {
    if (hasUninstallPathEntries(candidate)) return candidate
  }
  return ''
}
