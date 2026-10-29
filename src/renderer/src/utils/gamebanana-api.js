import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
import { sourceNetworkMessage } from '../../../shared/sources/source-network.js'
import {
  buildGamebananaListRequest,
  normalizeGamebananaPage,
  normalizeGamebananaDetail,
  requireGamebananaId,
  GAMEBANANA_DETAIL_PROPERTIES
} from '../../../shared/sources/gamebanana-catalog.js'

// 支持筛选必须先汇总远程分页，不能只筛第一页或沿用全部游戏的页数。
export function createGamebananaCatalogLoader(client) {
  let cached = null
  return {
    clear() { cached = null },
    async load(keyword, signal) {
      signal.throwIfAborted()
      if (cached?.keyword === keyword) return cached.page
      const first = await client.list({ page: 1, keyword }, signal)
      const records = [...first.records]
      for (let page = 2; page <= first.pages; page += 4) {
        const pages = await Promise.all(
          Array.from({ length: Math.min(4, first.pages - page + 1) }, (_, offset) =>
            client.list({ page: page + offset, keyword }, signal)
          )
        )
        signal.throwIfAborted()
        records.push(...pages.flatMap((result) => result.records))
      }
      signal.throwIfAborted()
      const result = { ...first, records: [...new Map(records.map((game) => [game.id, game])).values()] }
      cached = { keyword, page: result }
      return result
    }
  }
}

export function createGamebananaClient(http = createMainHttp('gamebanana')) {
  async function request(url, params, signal, includeNetwork = false) {
    let response
    try {
      response = await http.get(url, { params, signal, timeout: 30000, sourceAllowStale: includeNetwork })
    } catch (error) {
      if (signal?.aborted) throw error
      if (error.response) response = error.response
      else throw new Error(sourceNetworkMessage(error.code, 'gamebanana') || uiText('ui.couldNotConnectToGameBananaCheckYourNetworkOrProxy'))
    }
    if (response.status !== 200 || response.data?._sErrorCode) {
      throw new Error(
        response.status === 429
          ? uiText('ui.tooManyGameBananaRequestsTryAgainLater')
          : uiText('ui.gameBananaRequestFailedHTTPValue', { value1: (response.status) })
      )
    }
    return includeNetwork ? response : response.data
  }
  return {
    async cachedList(options = {}, signal) {
      const { url, params } = buildGamebananaListRequest(options)
      const response = await http.get(url, { params, signal, sourceCacheOnly: true })
      return response.data?.__vertexCommunityPage === 1 ? { ...response.data.page, network: response.sourceNetwork } : null
    },
    async list(options = {}, signal) {
      const { url, params } = buildGamebananaListRequest(options)
      const response = await request(url, params, signal, true)
      const page = response.data?.__vertexCommunityPage === 1 ? response.data.page : normalizeGamebananaPage(response.data, params._nPage, params._nPerpage)
      return { ...page, network: response.sourceNetwork }
    },
    async detail(id, signal) {
      return normalizeGamebananaDetail(
        await request(
          `https://gamebanana.com/apiv11/Mod/${requireGamebananaId(id)}`,
          { _csvProperties: GAMEBANANA_DETAIL_PROPERTIES },
          signal
        )
      )
    }
  }
}
