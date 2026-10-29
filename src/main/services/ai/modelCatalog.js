import OpenAI from 'openai'
import { normalizeAiTranslationConfig } from '../../../shared/translation/ai-translation-config.js'

const toSafeText = (value = '') => String(value || '').trim()

function normalizeAiTranslationModelRecord(record = {}) {
  const id = toSafeText(record?.id || record?.name || record?.model)
  if (!id) {
    return null
  }

  return {
    id,
    ownedBy: toSafeText(record?.owned_by || record?.ownedBy || record?.owner)
  }
}

export async function listAiModels(payload = {}) {
  const config = normalizeAiTranslationConfig(payload?.aiTranslation ?? payload)
  if (!config.baseURL || !config.apiKey) {
    throw new Error('Base URL and API Key are required.')
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 60000
  })
  const response = await client.models.list()
  const modelList = Array.isArray(response?.data)
    ? response.data
    : typeof response?.[Symbol.iterator] === 'function'
      ? [...response]
      : []
  const modelIdSet = new Set()
  const models = modelList
    .map((item) => normalizeAiTranslationModelRecord(item))
    .filter(Boolean)
    .filter((item) => {
      if (modelIdSet.has(item.id)) {
        return false
      }
      modelIdSet.add(item.id)
      return true
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    models
  }
}
