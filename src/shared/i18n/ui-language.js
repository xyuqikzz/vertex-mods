export const DEFAULT_LANGUAGE = 'zh-CN'
export const SUPPORTED_LANGUAGES = Object.freeze([
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
])
export function normalizeLanguagePreference(value) {
  return value === 'system' || SUPPORTED_LANGUAGES.some(item => item.value === value) ? value : DEFAULT_LANGUAGE
}
export function resolveLanguage(preference, languages = []) {
  if (preference !== 'system') return normalizeLanguagePreference(preference)
  for (const language of languages) {
    const base = String(language).toLowerCase().split(/[-_]/)[0]
    if (base === 'en') return 'en-US'
    if (base === 'zh') return 'zh-CN'
  }
  return DEFAULT_LANGUAGE
}
