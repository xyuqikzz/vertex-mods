import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import axios from 'axios'
import { parseNetworkError } from '../../../shared/sources/network-error.js'

export function createMainAdapter(service) {
  return async (config) => {
    const headers = config.headers?.toJSON?.() || config.headers || {}
    const payload = JSON.parse(JSON.stringify({
      id: crypto.randomUUID(),
      service, session: config.accountToken, url: axios.getUri({ ...config, params: undefined }), method: config.method,
      headers, params: config.params, data: config.data,
      responseType: config.responseType, timeout: config.timeout, sourceCacheOnly: config.sourceCacheOnly === true,
      sourceAllowStale: config.sourceAllowStale === true
    }))
    if (config.signal?.aborted) throw new axios.CanceledError('请求已取消')
    const cancel = () => window.api.network.cancel(payload.id).catch(() => {})
    config.signal?.addEventListener('abort', cancel, { once: true })
    let result
    try { result = await window.api.network.request(payload) }
    catch (error) {
      const failure = parseNetworkError(error?.message)
      if (config.signal?.aborted || failure?.code === 'ERR_CANCELED') {
        throw new axios.CanceledError('请求已取消', config)
      }
      if (failure) throw new axios.AxiosError(failure.message, failure.code, config)
      throw error
    }
    finally { config.signal?.removeEventListener('abort', cancel) }
    if (config.signal?.aborted) throw new axios.CanceledError('请求已取消')
    let data = result.data
    if (config.responseType === 'arraybuffer') {
      data = Uint8Array.from(atob(data.base64), (char) => char.charCodeAt(0)).buffer
    }
    const response = { status: result.status, data, headers: result.headers || {}, config, sourceNetwork: result.sourceNetwork }
    if (config.validateStatus && !config.validateStatus(result.status)) {
      throw new axios.AxiosError(uiText('ui.requestFailedHTTPValue', { value1: (result.status) }), 'ERR_BAD_RESPONSE', config, null, response)
    }
    return response
  }
}

export function createMainHttp(service) {
  return axios.create({ adapter: createMainAdapter(service) })
}
