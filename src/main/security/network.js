import { app } from 'electron'
import { ipcMain } from './ipc.js'
import axios from 'axios'
import { validateNetworkRequest } from './networkPolicy.js'
import { assertTrustedSender } from './windows.js'
import { assertActiveSourceApiPath } from '../../shared/sources/retired-source-policy.js'
import { accountVault } from './accounts.js'
import { INSTALL_RULE_CAPABILITIES } from '../../shared/installation/install-rule-declarations.js'
import { resolveUserAvatar } from '../../shared/account/user-avatar.js'
import { nexusAccount } from '../services/nexus/account.js'
import { getSafeNetworkErrorCode } from '../../shared/sources/network-error.js'
import { requestSourceNetwork } from '../services/source-network/index.js'
import { requestWithSystemNetwork } from './systemNetwork.js'
import { cancelNetworkRequest, withNetworkRequest } from './networkRequests.js'
import { isStatisticsEndpoint } from '../../shared/app/statistics-policy.js'
import { statisticsEnabled, withStatisticsConsent } from '../statistics/consent.js'
import store from '../storage/store/index.js'

export function registerNetworkIpc() {
  ipcMain.handle('network:cancel', (event, id) => {
    assertTrustedSender(event, 'network:cancel')
    cancelNetworkRequest(event, id)
  })
  ipcMain.handle('network:request', async (event, input) => {
    assertTrustedSender(event, 'network:request')
    const request = validateNetworkRequest(
      input,
      (!app.isPackaged && process.env.VERTEX_TEST_BACKEND_URL) || import.meta.env.VITE_REQUEST_API,
      input?.service === 'modio' ? store.get('systemConfig.settings.modioApi') : undefined
    )
    if (isStatisticsEndpoint(request.url) && !statisticsEnabled()) {
      return { status: 200, headers: {}, data: { code: 200, data: null } }
    }
    if (input.service === 'account') {
      request.headers['X-Vertex-Install-Capabilities'] = Object.keys(INSTALL_RULE_CAPABILITIES).join(',')
      delete request.headers['vertex-token']
      if (input.session && input.session !== accountVault.snapshot().token)
        throw new Error('stale_account_session')
      const token = accountVault.token()
      if (token && input.auth !== false) request.headers['vertex-token'] = `Bearer ${token}`
    }
    if (input.service === 'account') assertActiveSourceApiPath(new URL(request.url).pathname)
    const size = JSON.stringify(input.data ?? null).length
    if (size > 4 * 1024 * 1024) throw new Error('network_body_too_large')
    return withNetworkRequest(event, input.id, async (signal) => {
    try {
      const requestOptions = {
        ...request,
        params: input.params,
        data: input.data,
        signal,
        timeout: Math.min(Math.max(Number(input.timeout) || 30000, 1000), 60000),
        responseType: input.responseType === 'arraybuffer' ? 'arraybuffer' : 'json',
        maxRedirects: 0,
        maxContentLength: 32 * 1024 * 1024,
        maxBodyLength: 4 * 1024 * 1024,
        validateStatus: () => true
      }
      const response = input.service === 'nexus'
        ? await nexusAccount.request(requestOptions).catch((error) => ({
          status: error.status || (['nexus_api_key_invalid', 'nexus_auth_expired'].includes(error.code) ? 401 : 503),
          headers: {}, data: { message: error.message, code: error.code }
        }))
        : ['steam-workshop', 'gamebanana', 'steam-workshop-image', 'gamebanana-image'].includes(input.service)
          ? await requestSourceNetwork(requestOptions, {
              source: input.service.replace(/-image$/, ''),
              purpose: input.service.endsWith('-image') ? 'image' : 'metadata',
              cacheOnly: input.sourceCacheOnly === true,
              allowStale: input.sourceAllowStale === true
            })
           : isStatisticsEndpoint(request.url)
             ? (await withStatisticsConsent(consentSignal => axios({ ...requestOptions, signal: consentSignal }), signal)) || {
                 status: 200, headers: {}, data: { code: 200, data: null }
               }
             // Thunderstore 与页面共用系统/PAC 代理，Node Axios 不会读取系统代理。
             : input.service === 'thunderstore'
               ? await requestWithSystemNetwork(requestOptions)
               : await axios(requestOptions)
      if (input.service === 'nexus' && new URL(request.url).pathname === '/v1/users/validate.json') {
        const profile = { ...response.data }
        delete profile.key
        response.data = profile
      }
      const pathname = new URL(request.url).pathname
      if (input.service === 'account' && response.data?.code === 200) {
        if (pathname.endsWith('/user/login')) {
          response.data.data = accountVault.login(response.data.data).token
        } else if (
          pathname.endsWith('/user/info') &&
          input.session === accountVault.snapshot().token
        ) {
          const profile = response.data.data
          if (profile) profile.avatar = resolveUserAvatar(profile.avatar, profile.id, request.url.replace(/\/user\/info(?:\?.*)?$/, ''))
        }
      }
      return {
        status: response.status,
        headers: Object.fromEntries(['content-type', 'retry-after'].map(name => [name, response.headers[name] || ''])),
        ...(response.sourceNetwork ? { sourceNetwork: response.sourceNetwork } : {}),
        data:
          input.responseType === 'arraybuffer'
            ? { base64: Buffer.from(response.data).toString('base64') }
            : response.data
      }
    } catch (error) {
      // Axios errors contain request headers (including API keys); never relay them.
      const code = getSafeNetworkErrorCode(error, axios.isAxiosError(error) || error?.isSourceNetworkError)
      throw new Error(`network_request_failed:${input.service}:${code}`)
    }
    })
  })
}
