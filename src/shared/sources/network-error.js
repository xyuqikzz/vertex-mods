import { sourceNetworkMessage } from './source-network.js'
// Only fixed codes and messages may cross IPC; Axios errors can contain credentials.
const messages = new Map([
  ['ECONNABORTED', '网络请求超时'],
  ['ETIMEDOUT', '网络连接超时'],
  ['ENOTFOUND', '无法解析服务器地址'],
  ['EAI_AGAIN', '服务器地址解析暂时失败'],
  ['ECONNREFUSED', '服务器拒绝连接'],
  ['ECONNRESET', '网络连接被重置'],
  ['EPIPE', '网络连接已断开'],
  ['ENETUNREACH', '网络不可达'],
  ['EHOSTUNREACH', '服务器不可达'],
  ['CERT_HAS_EXPIRED', '服务器证书已过期'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', '服务器证书不受信任'],
  ['SELF_SIGNED_CERT_IN_CHAIN', '服务器证书链不受信任'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', '无法验证服务器证书'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', '服务器证书与地址不匹配'],
  ['ERR_BAD_RESPONSE', '服务器响应无效或超过大小限制'],
  ['ERR_CANCELED', '请求已取消'],
  ['ERR_NETWORK', '网络请求失败'],
  ['ERR_PROXY_CONNECTION_FAILED', '无法连接系统代理'],
  ['ERR_TUNNEL_CONNECTION_FAILED', '系统代理无法建立安全连接'],
  ['ERR_NETWORK_PROCESSING', '网络响应处理失败'],
  ['ERR_SOURCE_RESPONSE_INVALID', sourceNetworkMessage('ERR_SOURCE_RESPONSE_INVALID')],
  ['ERR_SOURCE_TARGET_REJECTED', '来源地址未通过安全校验']
])

export function getSafeNetworkErrorCode(error, isTransportError) {
  if (!isTransportError) return 'ERR_NETWORK_PROCESSING'
  return messages.has(error?.code) ? error.code : 'ERR_NETWORK'
}

export function parseNetworkError(message) {
  const match = /network_request_failed:([a-z][a-z0-9-]*):([A-Z_]+)\s*$/.exec(String(message || ''))
  if (!match || !messages.has(match[2])) return null
  return { code: match[2], message: sourceNetworkMessage(match[2], match[1]) || `${messages.get(match[2])}（${match[2]}）` }
}
