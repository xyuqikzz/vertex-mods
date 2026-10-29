import {
  createAiTranslationTextFingerprint,
  buildAiTranslationCacheKey
} from './ai-translation-config.js'

export const TRANSLATION_BATCH_SIZE_OPTIONS = Object.freeze([10, 20, 40, 60])
export const TRANSLATION_TARGET_LANGUAGES = Object.freeze([
  'zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'vi', 'th'
])
export const DEFAULT_TRANSLATION_CONFIG = Object.freeze({
  targetLanguage: 'zh-Hans',
  batchSize: 20,
  showOriginalText: false
})

export function normalizeTranslationLanguage(value = '') {
  const language = String(value || '').trim()
  return (
    { 简体中文: 'zh-Hans', 繁体中文: 'zh-Hant', 繁體中文: 'zh-Hant' }[language] ||
    language ||
    'zh-Hans'
  )
}

// 只迁移翻译偏好；历史 aiTranslation 中的模型与密钥继续由助手配置管理。
export function resolveTranslationConfig(settings = {}) {
  return normalizeTranslationConfig(settings.translation ?? settings.aiTranslation ?? settings)
}

export function normalizeTranslationConfig(config = {}) {
  const batchSize = Number(config?.batchSize)
  return {
    targetLanguage: normalizeTranslationLanguage(config?.targetLanguage),
    batchSize: TRANSLATION_BATCH_SIZE_OPTIONS.includes(batchSize) ? batchSize : 20,
    showOriginalText: false
  }
}

export function buildTranslationCacheDescriptor(item = {}, options = {}) {
  const textHash = createAiTranslationTextFingerprint(item.text || '')
  // 微软翻译与模型、提示词无关；源语言必须参与键，避免自动检测与指定语言串用。
  const promptHash = createAiTranslationTextFingerprint(
    `microsoft:${options.sourceLanguage || 'auto'}`
  )
  return {
    textHash,
    promptHash,
    cacheKey: buildAiTranslationCacheKey({
      ...options,
      targetLanguage: normalizeTranslationLanguage(options.targetLanguage),
      kind: item.kind,
      textHash,
      promptHash
    })
  }
}
