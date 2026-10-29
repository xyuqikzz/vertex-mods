import { safeStorage } from 'electron'
import store from '../storage/store/index.js'
import { ipcMain } from './ipc.js'
import { AccountVault } from './accountVault.js'
import { broadcastAccountState } from './windows.js'

export const accountVault = new AccountVault({ storage: store, encryption: safeStorage })

export function registerAccountIpc() {
  const publish = (snapshot) => {
    broadcastAccountState(snapshot)
    return snapshot
  }
  ipcMain.handle('account:bootstrap', (_event, legacy) => accountVault.migrate(legacy))
  ipcMain.handle('account:snapshot', () => accountVault.snapshot())
  ipcMain.handle('account:adopt', (_event, session) => {
    if (session !== accountVault.snapshot().token) throw new Error('invalid_account_session')
    return publish(accountVault.snapshot())
  })
  ipcMain.handle('account:logout', (_event, { session } = {}) => {
    if (session !== accountVault.snapshot().token) throw new Error('stale_account_session')
    return publish(accountVault.logout())
  })
}
