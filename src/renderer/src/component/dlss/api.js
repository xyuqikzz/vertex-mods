import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'

export async function dlssApi(method, payload = {}) {
  const response = await ipcRenderer.invoke(`dlss:${method}`, JSON.parse(JSON.stringify(payload)))
  if (!response?.ok)
    throw Object.assign(new Error(response?.message || uiText('tools.dlssServiceUnavailable')), {
      code: response?.code
    })
  return response.value
}
