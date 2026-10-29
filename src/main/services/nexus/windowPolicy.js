const PAGE_HOSTS = new Set([
  'www.nexusmods.com',
  'nexusmods.com',
  'next.nexusmods.com',
  'users.nexusmods.com'
])

export function isNexusWindowPage(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      PAGE_HOSTS.has(url.hostname)
    )
  } catch {
    return false
  }
}

export function isNexusWindowResource(value) {
  try {
    const url = new URL(value)
    if (['data:', 'blob:'].includes(url.protocol)) return true
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'nexusmods.com' ||
        url.hostname.endsWith('.nexusmods.com') ||
        url.hostname === 'challenges.cloudflare.com')
    )
  } catch {
    return false
  }
}

export const NEXUS_WINDOW_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  devTools: false
})
