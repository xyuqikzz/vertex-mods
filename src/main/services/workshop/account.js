import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import store from '../../storage/store/index.js'
import userPath from '../../initPath.js'
import { AccountVault } from '../../security/accountVault.js'
import { ipcMain } from '../../security/ipc.js'
import { createSteamAccountService } from './accountService.js'
import { createWorkshopAuthSession } from './authState.js'
import { runWorkshopDownload } from './downloader.js'
import { fetchSteamProfile } from './profile.js'
import { requestSourceNetwork } from '../source-network/index.js'

const envelope = new AccountVault({
  encryption: safeStorage,
  storage: {
    get: () => store.get('steamAccountVault'),
    set: (_key, value) => store.set('steamAccountVault', value),
    delete: () => store.delete('steamAccountVault')
  }
})
export const steamAccount = createSteamAccountService({
  fetchProfile: (steamId, signal) => fetchSteamProfile(steamId, signal, requestSourceNetwork),
  vault: {
    read: () => JSON.parse(envelope.token() || 'null'),
    write: (value) => envelope.login(JSON.stringify(value)),
    clear: () => envelope.logout()
  }
})

export function registerSteamAccountIpc() {
  const methods = {
    status: () => {
      // 状态轮询立即返回缓存，公开资料的慢请求不阻塞登录与退出。
      const state = steamAccount.snapshot()
      void steamAccount.refreshProfile().catch(() => {})
      return state
    },
    cancel: (event) => steamAccount.cancelLogin(event.sender.id),
    logout: () => steamAccount.logout(),
    login: (event) =>
      steamAccount.login(event.sender.id, async (signal) => {
        const jobId = `steam-settings:${randomUUID()}`
        const auth = createWorkshopAuthSession(event, jobId, signal, {
          purpose: 'settings',
          remember: true
        })
        if (!auth) throw Object.assign(new Error('Steam 授权窗口已关闭'), { code: 'steam_login_cancelled' })
        const destroyed = () => {
          void steamAccount.cancelLogin(event.sender.id).catch(() => {})
        }
        event.sender.once('destroyed', destroyed)
        auth.update({ phase: 'connecting', message: '正在准备 Steam 授权…' })
        try {
          await runWorkshopDownload(
            { authOnly: true, jobId, signal, auth, cacheRoot: `${userPath}/tools` },
            { account: steamAccount }
          )
        } finally {
          auth.close()
          event.sender.removeListener('destroyed', destroyed)
        }
      })
  }
  for (const [name, action] of Object.entries(methods)) {
    ipcMain.handle(`steam-account:${name}`, async (event) => {
      try {
        return { success: true, data: await action(event) }
      } catch (error) {
        return {
          success: false,
          code: error.code || 'steam_account_failed',
          message: error.code
            ? error.message
            : '无法读取或保存 Steam 登录状态，请检查系统凭据存储后重试。'
        }
      }
    })
  }
}
