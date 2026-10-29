import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
import { buildWorkshopListRequest, normalizeWorkshopPage } from '../../../shared/sources/steam-workshop-catalog.js'
import { parseNetworkError } from '../../../shared/sources/network-error.js'
import { sourceNetworkMessage } from '../../../shared/sources/source-network.js'

export function createWorkshopClient(http = createMainHttp('steam-workshop')) {
  return {
    async cachedList(options, signal) {
      const { url, params } = buildWorkshopListRequest(options)
      const response = await http.get(url, { params, signal, sourceCacheOnly: true })
      return response.data?.__vertexCommunityPage === 1 ? { ...response.data.page, network: response.sourceNetwork } : null
    },
    async list(options, signal) {
      const { url, params } = buildWorkshopListRequest(options)
      let response
      try {
        response = await http.get(url, { params, signal, timeout: 30000, sourceAllowStale: true })
      } catch (error) {
        if (signal?.aborted) throw error
        if (error.response) response = error.response
        else {
          const advice = sourceNetworkMessage(error.code)
          if (advice) throw new Error(advice)
          const failure = parseNetworkError(`network_request_failed:steam-workshop:${error.code}`)
          throw new Error(failure
            ? uiText('ui.couldNotConnectToSteamValueCheckYourNetworkOr', { value1: (failure.message) })
            : uiText('ui.couldNotConnectToSteamCheckYourNetworkOrProxy'))
        }
      }
      if (response.status !== 200) {
        throw new Error(response.status === 429
          ? uiText('ui.tooManySteamRequestsTryAgainLater')
          : uiText('ui.steamRequestFailedHTTPValue', { value1: (response.status) }))
      }
      const page = response.data?.__vertexCommunityPage === 1 ? response.data.page : normalizeWorkshopPage(response.data, params.appid)
      return { ...page, network: response.sourceNetwork }
    }
  }
}
