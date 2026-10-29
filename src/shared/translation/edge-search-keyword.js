export const HAS_CJK_RE = /[\u3400-\u9fff]/

function stripPairedQuotes(value = '') {
  const safeValue = String(value || '').trim()
  const quotePairs = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’']
  ]
  for (const [left, right] of quotePairs) {
    if (safeValue.startsWith(left) && safeValue.endsWith(right) && safeValue.length >= 2) {
      return safeValue.slice(left.length, safeValue.length - right.length).trim()
    }
  }
  return safeValue
}

export function normalizeEdgeSearchKeywordResult(value = '') {
  return stripPairedQuotes(value).replace(/\s+/g, ' ').trim()
}

export async function resolveEdgeSearchKeywordWithProvider(payload = {}, provider = {}) {
  const originalKeyword = String(payload?.keyword || '').trim()
  const fallbackResult = {
    originalKeyword,
    effectiveKeyword: originalKeyword,
    translated: false,
    edgeAvailable: false
  }

  if (!originalKeyword || !HAS_CJK_RE.test(originalKeyword)) {
    return fallbackResult
  }

  const ensureEdgeReady =
    typeof provider?.ensureEdgeReady === 'function' ? provider.ensureEdgeReady : async () => false
  const translateKeyword =
    typeof provider?.translateKeyword === 'function' ? provider.translateKeyword : async () => ''
  const warn = typeof provider?.warn === 'function' ? provider.warn : () => {}

  const edgeAvailable = await ensureEdgeReady()
  if (!edgeAvailable) {
    return fallbackResult
  }

  try {
    const translatedKeyword = normalizeEdgeSearchKeywordResult(await translateKeyword(originalKeyword))
    if (!translatedKeyword || HAS_CJK_RE.test(translatedKeyword)) {
      warn('[Edge翻译] 搜索关键词译文无效，回退原关键词', {
        source: String(payload?.source || '').trim(),
        originalKeyword,
        translatedKeyword
      })
      return {
        ...fallbackResult,
        edgeAvailable: true
      }
    }

    return {
      originalKeyword,
      effectiveKeyword: translatedKeyword,
      translated: true,
      edgeAvailable: true
    }
  } catch (error) {
    warn('[Edge翻译] 搜索关键词翻译失败，回退原关键词', {
      source: String(payload?.source || '').trim(),
      originalKeyword,
      error: String(error?.message || '未知错误')
    })
    return {
      ...fallbackResult,
      edgeAvailable: true
    }
  }
}
