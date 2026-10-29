import { usesChineseContent } from './content-policy.js'

export function trainerGameName(item = {}, locale = 'zh-CN') {
  const original = item.rawGameName || item.gameName || item.title || ''
  return String(
    usesChineseContent(locale)
      ? item.translatedGameName || item.displayGameName || original
      : original || item.displayGameName || item.translatedGameName || ''
  ).trim()
}
