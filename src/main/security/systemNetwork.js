import { net } from 'electron'
import axios from 'axios'

const chromiumErrorCodes = {
  ERR_NAME_NOT_RESOLVED: 'ENOTFOUND',
  ERR_CONNECTION_TIMED_OUT: 'ETIMEDOUT',
  ERR_TIMED_OUT: 'ETIMEDOUT',
  ERR_CONNECTION_REFUSED: 'ECONNREFUSED',
  ERR_CONNECTION_RESET: 'ECONNRESET',
  ERR_INTERNET_DISCONNECTED: 'ENETUNREACH',
  ERR_PROXY_CONNECTION_FAILED: 'ERR_PROXY_CONNECTION_FAILED',
  ERR_TUNNEL_CONNECTION_FAILED: 'ERR_TUNNEL_CONNECTION_FAILED',
  ERR_CERT_DATE_INVALID: 'CERT_HAS_EXPIRED',
  ERR_CERT_AUTHORITY_INVALID: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ERR_CERT_COMMON_NAME_INVALID: 'ERR_TLS_CERT_ALTNAME_INVALID'
}

// Only receives options already approved by networkPolicy. Chromium inherits the
// system/PAC proxy used by the app's web pages; Node's HTTP stack does not.
export async function requestWithSystemNetwork(options) {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  if (options.signal?.aborted) throw new axios.CanceledError()
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeout)
  let reader
  try {
    const response = await net.fetch(axios.getUri({ url: options.url, params: options.params }), {
      method: options.method,
      headers: options.headers,
      body: options.data,
      signal: controller.signal,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store'
    })
    const limit = options.maxContentLength
    if (Number(response.headers.get('content-length')) > limit)
      throw new axios.AxiosError('Response exceeds size limit', 'ERR_BAD_RESPONSE')
    reader = response.body?.getReader()
    const chunks = []
    let size = 0
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) throw new axios.AxiosError('Response exceeds size limit', 'ERR_BAD_RESPONSE')
        chunks.push(Buffer.from(value))
      }
    }
    const bytes = Buffer.concat(chunks, size)
    let data = options.responseType === 'arraybuffer' ? bytes : bytes.toString('utf8')
    if (options.responseType === 'json') {
      try { data = JSON.parse(data) } catch { /* HTML lists are returned as text, like Axios. */ }
    }
    const headers = Object.fromEntries(['content-type', 'content-length', 'content-range', 'retry-after', 'location']
      .map(name => [name, response.headers.get(name) || '']))
    return { status: response.status, headers, data }
  } catch (error) {
    if (options.signal?.aborted) throw new axios.CanceledError()
    if (timedOut) throw new axios.AxiosError('Network request timed out', 'ECONNABORTED')
    if (axios.isAxiosError(error)) throw error
    const chromiumCode = /net::(ERR_[A-Z_]+)/.exec(String(error?.message || ''))?.[1]
    throw new axios.AxiosError('Network request failed', chromiumErrorCodes[chromiumCode] || 'ERR_NETWORK')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
    await reader?.cancel().catch(() => {})
  }
}
