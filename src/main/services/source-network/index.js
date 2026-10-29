import { app } from 'electron'
import path from 'node:path'
import axios from 'axios'
import { requestWithSystemNetwork } from '../../security/systemNetwork.js'
import { normalizeWorkshopPage } from '../../../shared/sources/steam-workshop-catalog.js'
import { normalizeGamebananaPage } from '../../../shared/sources/gamebanana-catalog.js'
import { communityImageSource, sourceNetworkMessage } from '../../../shared/sources/source-network.js'
import { createPublicSourceCache } from './cache.js'
import { assertSourceTarget, sourceError, verifiedImageMime } from './policy.js'
import { parseSteamCommunityProfile, parseSteamProfileItems } from '../workshop/profile.js'

const cache = createPublicSourceCache(() => path.join(app.getPath('userData'), 'source-network-v1'))

function listPage(response, source, url) {
  const page = source === 'steam-workshop'
    ? normalizeWorkshopPage(response.data, url.searchParams.get('appid'))
    : normalizeGamebananaPage(
          response.data,
          url.searchParams.get('_nPage'),
          url.searchParams.get('_nPerpage')
        )
  // Save normalized public fields, never the Steam HTML/bootstrap scripts or signed URLs.
  return { ...page, records: page.records.map(record => ({ ...record,
    image: communityImageSource(record.image) === source ? record.image : '' })) }
}

export async function requestSourceNetwork(input, context = {}) {
  const options = { ...input, method: String(input.method || 'GET').toUpperCase(),
    url: axios.getUri({ url: input.url, params: input.params }), params: undefined }
  const { source, purpose = 'metadata' } = context
  const url = assertSourceTarget(options.url, source, options.method, purpose)
  const isList = purpose !== 'image' && options.method === 'GET' &&
    (url.pathname === '/workshop/browse/' || /\/(?:Index|Search\/Results)$/.test(url.pathname))
  const key = `${source}|${url.href}`
  let publicPage
  const validate = response => {
    if (purpose === 'image') verifiedImageMime(response.data, response.headers['content-type'])
    else if (purpose === 'profile-items') parseSteamProfileItems(response.data)
    else if (purpose === 'profile') parseSteamCommunityProfile(response.data, url.pathname.split('/')[2])
    else if (isList) publicPage = listPage(response, source, url)
    else if (source === 'steam-workshop') {
      const record = response.data?.response?.publishedfiledetails?.[0]
      const id = new URLSearchParams(options.data).get('publishedfileids[0]')
      if (!record || String(record.publishedfileid) !== id || !Number.isFinite(Number(record.result))) throw sourceError('ERR_SOURCE_RESPONSE_INVALID')
    } else if (!response.data || typeof response.data !== 'object') throw sourceError('ERR_SOURCE_RESPONSE_INVALID')
  }
  if (context.cacheOnly) {
    const item = isList && await cache.get('lists', key)
    return item && Array.isArray(item.payload?.records)
      ? { status: 200, headers: {}, data: { __vertexCommunityPage: 1, page: item.payload }, sourceNetwork: { mode: 'cache', updatedAt: item.updatedAt } }
      : { status: 204, headers: {}, data: null }
  }
  if (purpose === 'image') {
    const item = await cache.get('images', key)
    if (item?.payload?.base64 && typeof item.payload.base64 === 'string') {
      try {
        const data = Buffer.from(item.payload.base64, 'base64')
        const mime = verifiedImageMime(data, item.payload.mime)
        return { status: 200, data, headers: { 'content-type': mime }, sourceNetwork: { mode: 'cache', updatedAt: item.updatedAt } }
      } catch { /* A corrupt image cache is not a successful response. */ }
    }
  }
  try {
    const response = await requestWithSystemNetwork(options)
    if (response.status === 200) {
      try { validate(response) } catch { throw sourceError('ERR_SOURCE_RESPONSE_INVALID') }
      if (isList) await cache.put('lists', key, publicPage)
      if (purpose === 'image') await cache.put('images', key, {
        mime: verifiedImageMime(response.data, response.headers['content-type']), base64: Buffer.from(response.data).toString('base64')
      })
    }
    return { ...response, sourceNetwork: { mode: 'system', updatedAt: Date.now() } }
  } catch (error) {
    if (isList && context.allowStale && error.code !== 'ERR_CANCELED') {
      const item = await cache.get('lists', key)
      if (item && Array.isArray(item.payload?.records)) return {
        status: 200, headers: {}, data: { __vertexCommunityPage: 1, page: item.payload },
        sourceNetwork: { mode: 'cache', updatedAt: item.updatedAt, refreshFailed: true,
          message: sourceNetworkMessage(error.code, source) || '当前无法刷新，请检查网络后重试。' }
      }
    }
    throw error
  }
}
