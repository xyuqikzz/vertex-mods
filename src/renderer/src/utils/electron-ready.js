import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// ESM preload 与缓存的 renderer 可能以不同顺序就绪；挂载前确认桥可用。
export async function waitForElectronBridge({ timeout = 10000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout
  while (!globalThis.window?.electron?.ipcRenderer?.invoke) {
    if (Date.now() >= deadline) throw new Error(uiText('ui.clientConnectionInitializationTimedOutPleaseTryAgain'))
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
