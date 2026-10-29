import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { openWebExternal } from '../../security/windows.js'
import {
  isNexusWindowPage,
  isNexusWindowResource,
  NEXUS_WINDOW_PREFERENCES
} from './windowPolicy.js'

function createRestrictedSession() {
  const isolatedSession = session.fromPartition(`vertex-nexus-${randomUUID()}`)
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isNexusWindowResource(details.url) })
  })
  // All downloads must pass through the task center's target/session validation.
  isolatedSession.on('will-download', (event) => event.preventDefault())
  return isolatedSession
}

async function clearBrowsingData(browsingSession) {
  await Promise.allSettled([
    browsingSession.clearStorageData(), browsingSession.clearCache(),
    browsingSession.closeAllConnections()
  ])
}

let helperBrowsingSession = null
function createWindow({ title, onUrl, onClosed, browsingSession = null }) {
  const isolatedSession = browsingSession || createRestrictedSession()
  const window = new BrowserWindow({
    title,
    width: 1040,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    show: false,
    webPreferences: { ...NEXUS_WINDOW_PREFERENCES, session: isolatedSession }
  })
  const navigate = (event, url) => {
    if (onUrl?.(url) || !isNexusWindowPage(url)) event.preventDefault()
  }
  window.webContents.on('will-navigate', navigate)
  window.webContents.on('will-redirect', navigate)
  window.webContents.on('will-frame-navigate', (event, details) => {
    const url = typeof details === 'string' ? details : event.url
    if (onUrl?.(url) || !isNexusWindowResource(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!onUrl?.(url) && isNexusWindowPage(url)) window.loadURL(url).catch(() => {})
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    Promise.resolve(onClosed?.()).catch(() => {})
    if (!browsingSession) void clearBrowsingData(isolatedSession)
  })
  return window
}

export async function openNexusOAuthWindow({
  buildAuthorizeUrl,
  redirectUri,
  embedded,
  onCallback,
  onClosed,
  signal
}) {
  const callback = new URL(redirectUri)
  let window = null
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy', "default-src 'none'")
    if (
      request.method !== 'GET' ||
      request.headers.host !== callback.host ||
      request.headers.origin
    ) {
      response.writeHead(400).end('请求无效')
      return
    }
    const incoming = new URL(request.url, callback.origin)
    if (incoming.pathname !== callback.pathname) {
      response.writeHead(404).end()
      return
    }
    Promise.resolve(onCallback(incoming.href))
      .then((accepted) => {
        response
          .writeHead(accepted ? 200 : 400)
          .end(accepted ? '授权完成，可以返回 Vertex。' : '授权未完成，请返回 Vertex 重试。')
      })
      .catch(() => response.writeHead(400).end('授权未完成，请返回 Vertex 重试。'))
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 1000
  server.maxConnections = 8
  const close = () => {
    signal?.removeEventListener('abort', close)
    server.close()
    if (window && !window.isDestroyed()) window.close()
  }
  if (signal?.aborted) throw new Error('nexus_login_cancelled')
  signal?.addEventListener('abort', close, { once: true })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(Number(callback.port), '127.0.0.1', resolve)
    })
    if (signal?.aborted) throw new Error('nexus_login_cancelled')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('nexus_callback_unavailable')
    callback.port = String(address.port)
    // Preserve the reference client's root redirect without an extra trailing slash.
    const actualRedirectUri =
      callback.pathname === '/' ? callback.origin : `${callback.origin}${callback.pathname}`
    const url = buildAuthorizeUrl(actualRedirectUri)
    if (embedded) {
      window = createWindow({
        title: '连接 Nexus 账号 · Vertex',
        onClosed,
        onUrl(value) {
          try {
            const target = new URL(value)
            if (target.origin !== callback.origin || target.pathname !== callback.pathname)
              return false
            void onCallback(value)
            return true
          } catch {
            return false
          }
        }
      })
      await window.loadURL(url)
    } else await openWebExternal(url)
  } catch (error) {
    close()
    throw error
  }
  return { close }
}

const helpers = new Map()
export async function openNexusDownloadHelper({
  sessionId,
  target,
  pageUrl,
  onCallback,
  onClosed
}) {
  if (!isNexusWindowPage(pageUrl)) throw new Error('invalid_nexus_helper_page')
  const window = createWindow({
    browsingSession: helperBrowsingSession ||= createRestrictedSession(),
    title: `Nexus 文件 ${target.fileId} 下载授权 · 请使用 Vertex 中的同一账号`,
    onUrl(url) {
      if (!/^nxm:\/\//i.test(url || '')) return false
      onCallback(url, sessionId)
      return true
    },
    onClosed() {
      helpers.delete(sessionId)
      onClosed?.()
    }
  })
  helpers.set(sessionId, window)
  window.show()
  window.loadURL(pageUrl).catch(() => closeNexusDownloadHelper(sessionId))
  return { success: true }
}

export function closeNexusDownloadHelper(sessionId) {
  const window = helpers.get(sessionId)
  helpers.delete(sessionId)
  if (window && !window.isDestroyed()) window.close()
}

export async function clearNexusHelperBrowsingData() {
  const previous = helperBrowsingSession
  helperBrowsingSession = null
  for (const sessionId of [...helpers.keys()]) closeNexusDownloadHelper(sessionId)
  if (previous) await clearBrowsingData(previous)
}
