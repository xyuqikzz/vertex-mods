import { ipcMain as electronIpcMain } from 'electron'
import { assertTrustedSender } from './windows.js'
import { validateIpcArguments } from './ipcPolicy.js'

function check(event, channel, args) {
  assertTrustedSender(event, channel)
  validateIpcArguments(channel, args)
}

// Every registration (including late-loaded modules) passes through this boundary.
export const ipcMain = {
  handle(channel, listener) {
    return electronIpcMain.handle(channel, (event, ...args) => {
      check(event, channel, args)
      return listener(event, ...args)
    })
  },
  on(channel, listener) {
    return electronIpcMain.on(channel, async (event, ...args) => {
      try {
        check(event, channel, args)
        await listener(event, ...args)
      } catch (error) {
        // No request bodies, paths or credentials in diagnostics.
        console.warn('[IPC] 请求失败', channel)
        if (!event.sender.isDestroyed()) event.reply('ipc:request-failed', { channel, code: error?.code || 'ipc_request_rejected' })
      }
    })
  },
  once(channel, listener) {
    const handler = async (event, ...args) => {
      try { check(event, channel, args) } catch { return }
      electronIpcMain.removeListener(channel, handler)
      try { await listener(event, ...args) }
      catch { event.reply('ipc:request-failed', { channel, code: 'ipc_request_failed' }) }
    }
    return electronIpcMain.on(channel, handler)
  },
  removeHandler: (channel) => electronIpcMain.removeHandler(channel)
}
