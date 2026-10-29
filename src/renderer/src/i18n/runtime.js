import { readonly, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from './messages.js'

export const LANGUAGE_STORAGE_KEY = 'vertex.ui-language'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, normalizeLanguagePreference, resolveLanguage } from '../../../shared/i18n/ui-language.js'
export { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, normalizeLanguagePreference, resolveLanguage }

export function createClientI18n({ storage, eventTarget, navigator, document, onLanguageChanged } = {}) {
  function readPreference() {
    try {
      return normalizeLanguagePreference(storage?.getItem(LANGUAGE_STORAGE_KEY))
    } catch {
      return DEFAULT_LANGUAGE
    }
  }

  const preference = ref(readPreference())
  const systemLanguages = () =>
    navigator?.languages?.length ? navigator.languages : [navigator?.language || DEFAULT_LANGUAGE]
  const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: resolveLanguage(preference.value, systemLanguages()),
    fallbackLocale: DEFAULT_LANGUAGE,
    messages
  })

  function applyLanguage(value) {
    preference.value = normalizeLanguagePreference(value)
    const locale = resolveLanguage(preference.value, systemLanguages())
    i18n.global.locale.value = locale
    if (document?.documentElement) document.documentElement.lang = locale
    onLanguageChanged?.(preference.value)
  }

  function setLanguage(value) {
    if (normalizeLanguagePreference(value) !== value) return false
    // Commit the preference only after persistence succeeds, so the UI never claims it saved.
    try {
      if (!storage) return false
      storage.setItem(LANGUAGE_STORAGE_KEY, value)
    } catch {
      return false
    }
    applyLanguage(value)
    return true
  }

  function onStorage(event) {
    if (event.storageArea && event.storageArea !== storage) return
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) applyLanguage(readPreference())
  }

  function onSystemLanguageChange() {
    if (preference.value === 'system') applyLanguage('system')
  }

  let listening = false
  function start() {
    applyLanguage(readPreference())
    if (listening) return
    eventTarget?.addEventListener('storage', onStorage)
    eventTarget?.addEventListener('languagechange', onSystemLanguageChange)
    listening = true
  }

  function stop() {
    eventTarget?.removeEventListener('storage', onStorage)
    eventTarget?.removeEventListener('languagechange', onSystemLanguageChange)
    listening = false
  }

  return {
    i18n,
    preference: readonly(preference),
    setLanguage,
    start,
    stop,
    install(app) {
      start()
      app.use(i18n)
      app.onUnmount(stop)
    }
  }
}
