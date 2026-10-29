import { clientI18n } from './index.js'
import { modBrowserMessages } from './mod-browser-messages.js'

// Compatibility for source adapters still passing Chinese UI labels. Only call for
// application-owned controls/status labels, never game names, mod names or source content.
const labelKeys = new Map(
  Object.entries(modBrowserMessages['zh-CN'])
    .filter(([, text]) => !text.includes('{'))
    .map(([key, text]) => [text, `modBrowser.${key}`])
)
labelKeys.set('搜索模组...', 'modBrowser.searchPlaceholder')
labelKeys.set('搜索模组名称...', 'modBrowser.searchPlaceholder')
labelKeys.set('详情', 'modBrowser.details')

export function localizeModUiText(value = '') {
  const key = labelKeys.get(String(value).trim())
  return key ? clientI18n.i18n.global.t(key) : value
}
