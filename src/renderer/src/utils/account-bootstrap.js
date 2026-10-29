let accountState = { token: '', isLogin: false }
export const getAccountState = () => accountState
export const setAccountState = (state) => { accountState = state }

export async function bootstrapAccount() {
  const read = (key, fallback) => {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    try { return JSON.parse(raw) } catch { return raw }
  }
  const persisted = read('userStore', {})
  accountState = await window.api.account.bootstrap(JSON.parse(JSON.stringify({
    token: read('token', ''), accounts: read('savedAccounts', []), persisted
  })))
  // Never clear the only recoverable copy when encryption or IPC fails.
  localStorage.removeItem('token')
  localStorage.removeItem('savedAccounts')
  if (persisted && typeof persisted === 'object') {
    delete persisted.token
    delete persisted.savedAccounts
    delete persisted.isLogin
    localStorage.setItem('userStore', JSON.stringify(persisted))
  }
  const legacySettings = localStorage.getItem('systemConfig')
  if (legacySettings) {
    try {
      const archived = await window.electron.ipcRenderer.invoke('archiveLegacySettings', JSON.parse(legacySettings))
      if (archived?.success && localStorage.getItem('systemConfig') === legacySettings) localStorage.removeItem('systemConfig')
    } catch { console.warn('旧设置安全归档未完成，原数据已保留') }
  }
  return accountState
}
