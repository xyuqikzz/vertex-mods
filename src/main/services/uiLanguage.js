import { app } from 'electron'
import { createCoreContext, translate, registerMessageCompiler, compile } from '@intlify/core-base'
import store from '../storage/store/index.js'
import { nativeUiMessages } from '../../shared/i18n/native-ui-messages.js'
import { normalizeLanguagePreference, resolveLanguage } from '../../shared/i18n/ui-language.js'

registerMessageCompiler(compile)
const translator = createCoreContext({ locale: 'zh-CN', fallbackLocale: 'zh-CN', messages: nativeUiMessages })
const listeners = new Set()
export function getNativeLanguage() {
  let languages = []
  try { languages = app.getPreferredSystemLanguages() } catch { /* Startup may precede app readiness. */ }
  return resolveLanguage(normalizeLanguagePreference(store.get('uiLanguagePreference')), languages)
}
export function nativeText(key, params = {}) {
  translator.locale = getNativeLanguage()
  return translate(translator, key, params)
}
export function setNativeLanguagePreference(value) {
  if (!['zh-CN', 'en-US', 'system'].includes(value)) throw new Error('invalid_ui_language')
  store.set('uiLanguagePreference', value)
  listeners.forEach(listener => listener())
  return { success: true, locale: getNativeLanguage() }
}
export function onNativeLanguageChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
