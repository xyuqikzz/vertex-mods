// Keep URL decisions pure so navigation and IPC use the same trust boundary.
export function isWebUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

export function sameDocument(value, entry) {
  try {
    const url = new URL(value)
    const expected = new URL(entry)
    return url.protocol === expected.protocol && url.host === expected.host &&
      url.pathname === expected.pathname && url.search === expected.search &&
      !url.username && !url.password
  } catch { return false }
}

export function isTrustedFrame(event, record) {
  return Boolean(record && record.contents === event?.sender && !event.sender.isDestroyed() &&
    event.senderFrame && event.senderFrame === event.sender.mainFrame && sameDocument(event.senderFrame.url, record.entry))
}

export function restrictWindowNavigation(contents, { remote = false } = {}) {
  const guard = (event, url) => {
    if (remote ? !isWebUrl(url) : !sameDocument(url, contents.getURL())) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (event, preferences, params) => {
    if (!isWebUrl(params.src) || params.partition !== 'persist:vertex-mod-site-detail') {
      event.preventDefault()
      return
    }
    delete preferences.preload
    delete preferences.preloadURL
    Object.assign(preferences, {
      nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false
    })
  })
}
