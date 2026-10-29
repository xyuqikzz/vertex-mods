import { app, safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import axios from 'axios'
import store from '../../storage/store/index.js'
import { AccountVault } from '../../security/accountVault.js'
import { ipcMain } from '../../security/ipc.js'
import { createNexusAccountService } from './accountService.js'
import { openNexusOAuthWindow, clearNexusHelperBrowsingData } from './windows.js'
import registeredConfig from './oauth-config.json'

export const nexusAccountEvents = new EventEmitter()
// Reuse the verified safeStorage envelope with a separate namespace from Vertex login.
const envelope = new AccountVault({
  encryption: safeStorage,
  storage: {
    get: () => store.get('nexusAccountVault'),
    set: (_key, value) => store.set('nexusAccountVault', value),
    delete: () => store.delete('nexusAccountVault')
  }
})
export const nexusAccount = createNexusAccountService({
  vault: {
    read: () => JSON.parse(envelope.token() || 'null'),
    write: (value) => envelope.login(JSON.stringify(value)),
    clear: () => envelope.logout(true)
  },
  config: {
    ...registeredConfig,
    clientId: process.env.VERTEX_NEXUS_OAUTH_CLIENT_ID || registeredConfig.clientId,
    redirectUri: process.env.VERTEX_NEXUS_OAUTH_REDIRECT_URI || registeredConfig.redirectUri
  },
  appVersion: app.getVersion(),
  transport: (request) => axios(request),
  getApiKey: () => store.get('systemConfig.settings.nexusApi.apiKey') || '',
  getAuthMode: () => store.get('nexusCredentialMode') || '',
  saveAuthMode: (mode) => store.set('nexusCredentialMode', mode),
  openAuthorization: openNexusOAuthWindow,
  onIdentityChanged: () => {
    void clearNexusHelperBrowsingData()
    nexusAccountEvents.emit('changed')
  }
})

export function registerNexusAccountIpc() {
  for (const [name, method] of Object.entries({
    status: 'snapshot',
    login: 'login',
    cancel: 'cancelLogin',
    logout: 'logout',
    'set-mode': 'setMode'
  })) {
    ipcMain.handle(`nexus-account:${name}`, async (_event, payload) => {
      try {
        return {
          success: true,
          data: await nexusAccount[method](name === 'set-mode' ? payload?.mode : undefined)
        }
      } catch (error) {
        return {
          success: false,
          code: error.code || 'nexus_account_storage_failed',
          message: error.code ? error.message : '无法读取或保存 Nexus 安全凭据，请检查系统凭据存储'
        }
      }
    })
  }
}
