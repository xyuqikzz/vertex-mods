import { app, shell, session } from 'electron'
import { isWebUrl, restrictWindowNavigation } from './windowPolicy.js'
import { sameDocument, isTrustedFrame } from './windowPolicy.js'

const trusted = new Map()
export function broadcastAccountState(snapshot) {
  for (const { contents, entry, role } of trusted.values()) {
    if (
      !role &&
      !contents.isDestroyed() &&
      sameDocument(contents.getURL(), entry)
    )
      contents.send('account:changed', snapshot)
  }
}
export function trustLocalWindow(window, entry, role = '') {
  const contents = window.webContents
  const contentsId = contents.id
  trusted.set(contentsId, { contents, entry, role })
  // closed 触发时原生窗口已销毁，清理时只能使用登记阶段保存的 ID。
  window.once('closed', () => trusted.delete(contentsId))
}

export function assertTrustedSender(event, channel = '') {
  const record = trusted.get(event?.sender?.id)
  if (!isTrustedFrame(event, record)) throw new Error('untrusted_ipc_sender')
  const mode = new URL(record.entry).searchParams.get('window')
  if (record.role === 'overlay' && !['capture-area', 'close-overlay'].includes(channel))
    throw new Error('window_capability_disabled')
  return record.role || mode || 'main'
}

export async function openWebExternal(url) {
  if (!isWebUrl(url)) throw new Error('external_protocol_disabled')
  await shell.openExternal(url)
}

export function installWindowSecurity() {
  const configure = (targetSession) => {
    const allowed = (contents, permission) => {
      const record = trusted.get(contents?.id)
      return Boolean(
        permission === 'clipboard-sanitized-write' &&
          record &&
          record.contents === contents &&
          sameDocument(contents.getURL(), record.entry)
      )
    }
    targetSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(allowed(contents, permission))
    )
    targetSession.setPermissionCheckHandler(allowed)
  }
  app.on('session-created', configure)
  app.whenReady().then(() => configure(session.defaultSession))
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    restrictWindowNavigation(contents, { remote: true })
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) openWebExternal(url).catch(() => console.warn('[安全] 外链打开失败'))
      return { action: 'deny' }
    })
  })
}
