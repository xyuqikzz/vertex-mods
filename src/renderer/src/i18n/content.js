import { clientI18n } from './index.js'
import { resolveGamePresentation, usesChineseContent } from './content-policy.js'

export const contentLocale = clientI18n.i18n.global.locale
export const canTranslateModContent = () => usesChineseContent(contentLocale.value)
export const gamePresentation = (game) => resolveGamePresentation(game, contentLocale.value)
