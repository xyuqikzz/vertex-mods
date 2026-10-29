import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { reactive, readonly } from 'vue'
import ipcRenderer from '../common/ipcRenderer.js'

const state = reactive({
  connected: false,
  configured: false,
  mode: 'oauth',
  available: false,
  phase: 'idle',
  user: null,
  credentialSource: 'none',
  hasApiKey: false,
  revision: '',
  message: '',
  browserMode: 'external'
})
export const nexusAccountState = readonly(state)
let statusSerial = 0
export async function refreshNexusAccount() {
  const serial = ++statusSerial
  const result = await ipcRenderer.invoke('nexus-account:status')
  if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotReadNexusAccountStatus'))
  if (serial === statusSerial) Object.assign(state, result.data)
  return state
}
export async function performNexusAccountAction(action, payload) {
  const result = await ipcRenderer.invoke(`nexus-account:${action}`, payload)
  await refreshNexusAccount()
  if (!result?.success) throw Object.assign(new Error(result?.message || uiText('ui.nexusAccountOperationFailed')), { code: result?.code })
  return result.data
}
