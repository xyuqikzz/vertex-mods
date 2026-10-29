// Presentation policy only: never overwrite source names, translation caches or install identities.
const text = (value) => (typeof value === 'string' ? value.trim() : '')
const first = (...values) => values.map(text).find(Boolean) || ''

export function resolveGamePresentation(game = {}, locale = 'zh-CN') {
  game = game && typeof game === 'object' ? game : {}
  const english = first(
    game.englishTitle,
    game.englishName,
    game.english_name,
    game.rawName,
    game.rawDisplayName,
    game.originalName
  )
  const chinese = first(game.chineseTitle, game.chineseName, game.chinese_name)
  const fallback = first(game.displayName, game.name, english, chinese)
  const title = locale.startsWith('en')
    ? first(english, fallback, chinese)
    : first(chinese, fallback, english)
  const subtitle =
    !locale.startsWith('en') && english && english.toLowerCase() !== title.toLowerCase()
      ? english
      : ''
  return { title, subtitle }
}

export function usesChineseContent(locale = 'zh-CN') {
  return !locale.startsWith('en')
}

const contentScenes = new Set(['mod_list_card', 'mod_description', 'file_list', 'dependency_list'])
export function shouldTranslateContent(payload = {}, locale = 'zh-CN') {
  // Keyword translation and explicit website translation have their own target language.
  return !contentScenes.has(payload.scene) || usesChineseContent(locale)
}
