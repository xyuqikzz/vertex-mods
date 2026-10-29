import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
import { communityImageSource } from '../../../shared/sources/source-network.js'

const clients = new Map()
const queue = []
let active = 0
function drain() {
  while (active < 4 && queue.length) {
    const item = queue.shift()
    item.signal?.removeEventListener('abort', item.cancel)
    if (item.signal?.aborted) { item.reject(new Error(uiText('ui.imageRequestCancelled'))); continue }
    active++
    item.run().then(item.resolve, item.reject).finally(() => { active--; drain() })
  }
}

export function loadSourceImage(url, signal) {
  const source = communityImageSource(url)
  if (!source) return Promise.reject(new Error(uiText('ui.unsupportedSourceImage')))
  if (!clients.has(source)) clients.set(source, createMainHttp(`${source}-image`))
  return new Promise((resolve, reject) => {
    const item = { signal, resolve, reject, run: async () => {
      const response = await clients.get(source).get(url, { signal, responseType: 'arraybuffer', timeout: 25000 })
      if (response.status !== 200) throw new Error(uiText('ui.theSourceImageIsTemporarilyUnavailable'))
      if (signal?.aborted) throw new Error(uiText('ui.imageRequestCancelled'))
      return { url: URL.createObjectURL(new Blob([response.data], { type: response.headers['content-type'] })), network: response.sourceNetwork }
    } }
    item.cancel = () => {
      const index = queue.indexOf(item)
      if (index >= 0) queue.splice(index, 1)
      reject(new Error(uiText('ui.imageRequestCancelled')))
    }
    if (signal?.aborted) return item.cancel()
    signal?.addEventListener('abort', item.cancel, { once: true })
    queue.push(item)
    drain()
  })
}
