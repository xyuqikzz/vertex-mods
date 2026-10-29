export function installedAppKey(item = {}) {
  return String(item.registryPath || '').trim().toLowerCase()
}

export function isSameInstalledApp(left = {}, right = {}) {
  const key = installedAppKey(left)
  return !!key && key === installedAppKey(right)
}

export function canUninstallApp(item = {}) {
  return Number(item.noRemove) !== 1 &&
    !!String(item.uninstallString || item.quietUninstallString || '').trim()
}

export function classifyUninstallResult(result = {}) {
  if (result.timeout) return 'timeout'
  if (result.launchOnly) return 'external'
  if (result.exitCode === null || result.exitCode === undefined) return 'unknown'
  const code = Number(result.exitCode)
  // MSI codes have meaning only for Windows Installer, not arbitrary EXE exit codes.
  if (result.isMsi && code === 1602) return 'cancelled'
  if (result.isMsi && (code === 1641 || code === 3010)) return 'rebootRequired'
  return code === 0 ? 'closed' : 'failed'
}
