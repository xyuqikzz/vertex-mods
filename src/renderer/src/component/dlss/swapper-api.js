import { dlssApi } from './api.js'
import { S } from '../../../../shared/dlss-swapper/i18n.js'
import featureText from '../../../../shared/dlss-swapper/feature-i18n.js'
import { contentLocale } from '../../i18n/content.js'
import { toolText as tt } from '../../i18n/tool-text.js'

export const swapperApi = (action, input = {}) =>
  dlssApi('manage', { action, input, locale: contentLocale.value })
export function t(key, ...args) {
  const lang = contentLocale.value.startsWith('en') ? 'en' : 'zh'
  if (Object.hasOwn(featureText.catalog.en, key)) return featureText.t(lang, key, ...args)
  const entry = S[lang][key] ?? S.en[key]
  return entry === undefined ? String(key) : typeof entry === 'function' ? entry(...args) : entry
}
export const logText = (item) => {
  if (item.code === 'componentPreparing')
    return tt('正在准备 {0} {1}…', [item.params.name, item.params.version])
  if (item.code === 'componentVerifying') return tt('正在校验本地 DLSS5 配套组件…')
  if (item.code === 'componentDownloading')
    return tt('正在下载 DLSS5-Swapper {0} 配套组件…', [item.params.version])
  if (item.code === 'componentDownloadProgress') {
    const { received, total, percent } = item.params
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)
    return tt('正在下载配套组件：{0}%（{1} / {2} MB）', [percent, mb(received), mb(total)])
  }
  if (item.code === 'componentExtracting') return tt('正在解压并校验配套组件…')
  if (item.code === 'motionProviderDownloading')
    return tt('正在检查可选运动估计组件，网络不可用时将使用内置组件…')
  if (item.code === 'componentReady') return tt('配套组件已准备完成。')
  const text = t(item.code, ...Object.values(item.params || {}))
  return text === item.code ? item.code + ' ' + JSON.stringify(item.params || {}) : text
}
