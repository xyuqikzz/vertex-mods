import path from 'node:path'

// Windows 盘符和 UNC 路径在非 Windows 的契约测试中也使用相同身份。
export function normalizeDeploymentPath(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\)/i.test(text)
  const resolved = (windowsPath ? path.win32 : path).resolve(text)
  return windowsPath || process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
