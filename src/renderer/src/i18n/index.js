import { createClientI18n } from './runtime.js'

let storage
try {
  storage = globalThis.window?.localStorage
} catch {
  /* Storage may be unavailable. */
}

export const clientI18n = createClientI18n({
  storage,
  eventTarget: globalThis.window,
  navigator: globalThis.navigator,
  document: globalThis.document,
  onLanguageChanged(preference) {
    const sync = globalThis.window?.api?.capabilities?.commands?.['ui-language:set']
    if (sync) Promise.resolve(sync(preference)).catch(() => console.warn('[i18n] Native language sync failed'))
  }
})

export const languagePreference = clientI18n.preference
export const setLanguage = clientI18n.setLanguage
export { SUPPORTED_LANGUAGES } from './runtime.js'

if (import.meta.hot) import.meta.hot.dispose(() => clientI18n.stop())
