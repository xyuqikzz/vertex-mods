import { accountVault } from '../security/accounts.js'
import { assertActiveSourceApiPath } from '../../shared/sources/retired-source-policy.js'
import axios from 'axios'
import { app } from 'electron'
import { INSTALL_RULE_CAPABILITIES } from '../../shared/installation/install-rule-declarations.js'

const { VITE_REQUEST_API } = import.meta.env

const api = axios.create({
  baseURL: VITE_REQUEST_API, // 设置基础域名
  timeout: 10000, // 设置请求超时时间
  headers: {
    'vertex-version': app.getVersion(),
    'Content-Type': 'application/json'
  }
})

export function getToken() {
  return accountVault.token()
}

export async function requestBackendApi(config = {}, options = {}) {
    assertActiveSourceApiPath(config?.url)
  const useAuth = options?.useAuth !== false
  const headers = {
    ...(config?.headers || {}),
    'X-Vertex-Install-Capabilities': Object.keys(INSTALL_RULE_CAPABILITIES).join(',')
  }

  if (useAuth) {
    const token = getToken()
    if (token) {
      headers['vertex-token'] = `Bearer ${token}`
    }
  }

  return await api.request({
    ...config,
    headers
  })
}

