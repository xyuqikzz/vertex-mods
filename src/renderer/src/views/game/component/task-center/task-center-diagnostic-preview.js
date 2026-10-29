import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
const DEFAULT_OPTIONS = Object.freeze({
  maxDepth: 5,
  maxArrayItems: 40,
  maxObjectKeys: 60,
  maxStringLength: 2_000,
  maxNodes: 1_500,
  maxOutputChars: 120_000
})

function normalizeValue(value, depth, context) {
  if (context.remainingNodes <= 0) return '[已省略：达到预览节点上限]'
  context.remainingNodes -= 1

  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') {
    if (value.length <= context.options.maxStringLength) return value
    return uiText('ui.valueValueCharactersTruncated', { value1: (value.slice(0, context.options.maxStringLength)), value2: (value.length - context.options.maxStringLength) })
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value !== 'object') return String(value)
  if (depth >= context.options.maxDepth) return '[已省略：达到预览深度上限]'
  if (context.ancestors.has(value)) return '[已省略：循环引用]'

  context.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, context.options.maxArrayItems)
      const result = []
      for (let index = 0; index < limit; index += 1) {
        result.push(normalizeValue(value[index], depth + 1, context))
      }
      if (value.length > limit) result.push(uiText('ui.valueItemsOmitted', { value1: (value.length - limit) }))
      return result
    }

    const result = {}
    let keyCount = 0
    let truncated = false
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      if (keyCount >= context.options.maxObjectKeys) {
        truncated = true
        break
      }
      try {
        result[key] = normalizeValue(value[key], depth + 1, context)
      } catch (error) {
        result[key] = uiText('ui.couldNotReadValue', { value1: (error?.message || String(error)) })
      }
      keyCount += 1
    }
    if (truncated) result.__preview_notice__ = '[已省略其余字段]'
    return result
  } finally {
    context.ancestors.delete(value)
  }
}

export function formatTaskCenterDiagnosticPreview(value, options = {}) {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options }
  const normalized = normalizeValue(value, 0, {
    options: resolvedOptions,
    remainingNodes: resolvedOptions.maxNodes,
    ancestors: new WeakSet()
  })
  const json = JSON.stringify(normalized, null, 2)
  if (json.length <= resolvedOptions.maxOutputChars) return json
  return uiText('ui.valueValueCharactersTruncatedVariant2', { value1: (json.slice(0, resolvedOptions.maxOutputChars)), value2: (json.length - resolvedOptions.maxOutputChars) })
}
