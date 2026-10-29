import { contentLocale } from './content.js'
import { toolText } from './tool-text.js'
import { toolMessageCatalog } from './tool-message-catalog.js'
import { S } from '../../../shared/dlss-swapper/i18n.js'
import featureText from '../../../shared/dlss-swapper/feature-i18n.js'
import { clientI18n } from './index.js'

const sharedText = new Map()
for (const catalog of [S, featureText.catalog]) {
  for (const [key, zh] of Object.entries(catalog.zh || {})) {
    const en = catalog.en[key]
    if (typeof zh === 'string' && typeof en === 'string' && !zh.includes('{'))
      sharedText.set(zh, en)
  }
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = toolMessageCatalog
  .filter(([, zh]) => /\{\d+\}/.test(zh))
  .map(([, zh]) => ({
    source: zh,
    pattern: new RegExp(
      '^' +
        zh
          .split(/\{\d+\}/)
          .map(escape)
          .join('([\\s\\S]*?)') +
        '$'
    )
  }))

// Legacy IPC diagnostics are still Chinese strings. Match only declared full
// messages; never translate executable/script content or modify IPC payloads.
export function toolServiceText(value) {
  if (value?.messageKey?.startsWith('trainer.')) return clientI18n.i18n.global.t(value.messageKey, value.messageParams || {})
  if (value && typeof value === 'object' && typeof value.message === 'string') return toolServiceText(value.message)
  if (value?.toolMessage) return toolText(value)
  if (typeof value !== 'string' || !contentLocale.value.startsWith('en')) return value
  const exact = toolText(value)
  if (exact !== value) return exact
  if (sharedText.has(value)) return sharedText.get(value)
  const observedExe = value.match(/^(.*) 检测来自 (.+)，当前程序选择未改变。$/s)
  if (observedExe)
    return (
      toolServiceText(observedExe[1]) +
      toolText(' 检测来自 {0}，当前程序选择未改变。', [observedExe[2]])
    )
  const verified = value.match(
    /^(本次游戏进程已加载组件，日志记录了神经渲染成功(?:与近期连续画面交付)?；实际效果仍需游戏内对比。)(?:游戏呈现：(.+?)。)?(DX11\/DX12 共用 DXGI 加载入口，手动部署选择不改变实际 API。)?$/s
  )
  if (verified)
    return [
      toolText(verified[1]),
      verified[2] ? toolText('游戏呈现：{0}。', [verified[2]]) : '',
      verified[3] ? toolText(verified[3]) : ''
    ]
      .filter(Boolean)
      .join(' ')
  for (const { source, pattern } of templates) {
    const match = value.match(pattern)
    if (match) {
      const args = match.slice(1)
      if (source === '游戏已运行，推荐 {0}（依据{1}，实际 API 未确认）。')
        args[1] = toolText(args[1])
      return toolText(source, args)
    }
  }
  return value
}

export function toolLogText(log) {
  if (log.content?.toolMessage) return toolText(log.content)
  return log.type === 'output' || log.type === 'error' ? log.content : toolServiceText(log.content)
}
