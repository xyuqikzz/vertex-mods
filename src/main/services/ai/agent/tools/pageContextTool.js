import {
  formatAiPageContextTitle,
  getAiPageQuickSuggestions,
  normalizeAiPageContextPatch,
  refreshAiPageContextCapabilities
} from '../../../../../shared/ai/conversation/ai-agent-page-context.js'

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function normalizeSections(sections = []) {
  if (!Array.isArray(sections) || !sections.length) return []
  return sections.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function pickSections(context = {}, sections = []) {
  const selected = normalizeSections(sections)
  if (!selected.length) return context
  return selected.reduce((result, section) => {
    if (Object.prototype.hasOwnProperty.call(context, section)) {
      result[section] = context[section]
    }
    return result
  }, {})
}

export function getPageContextTool(args = {}, ctx = {}) {
  const baseContext = normalizeAiPageContextPatch(ctx?.pageContext || {})
  const snapshot = refreshAiPageContextCapabilities(baseContext)
  const selectedSnapshot = pickSections(snapshot, args.sections)
  const title = formatAiPageContextTitle(snapshot)
  const quickSuggestions = args.includeQuickSuggestions === false ? [] : getAiPageQuickSuggestions(snapshot)

  return toPlainJson(
    {
      success: true,
      title,
      quickSuggestions,
      snapshot: selectedSnapshot,
      fullSnapshotAvailable: normalizeSections(args.sections).length > 0,
      message: title ? `当前页面上下文：${title}` : '当前页面上下文已读取。'
    },
    {
      success: false,
      errorCode: 'invalid_page_context',
      message: '页面上下文无法序列化。'
    }
  )
}
