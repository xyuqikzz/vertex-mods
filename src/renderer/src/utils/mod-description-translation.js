// 只翻译文本节点，保留链接、格式、代码和原始内容；长描述按段分批请求。
export function createDescriptionTranslationPlan({
  id,
  text = '',
  format = 'text',
  kind = 'mod_description',
  context = ''
}) {
  const original = String(text || '')
  const items = []
  const records = []
  let container = null
  if (format === 'html' && typeof DOMParser !== 'undefined') {
    container = new DOMParser().parseFromString(original, 'text/html').body
    const walker = container.ownerDocument.createTreeWalker(container, 4)
    let node
    while ((node = walker.nextNode())) {
      if (
        !node.parentElement?.closest('script,style,code,pre,textarea,[translate="no"],.notranslate')
      ) {
        records.push({ node, text: node.nodeValue })
      }
    }
  } else {
    records.push({ text: original })
  }
  for (const [index, record] of records.entries()) {
    record.parts = []
    let remaining = record.text
    while (remaining) {
      let end = Math.min(remaining.length, 1800)
      if (end < remaining.length) {
        const boundary = remaining.slice(0, end).search(/\s+\S*$/)
        if (boundary > end / 2) end = boundary
        if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
      }
      const part = remaining.slice(0, end)
      remaining = remaining.slice(end)
      const key = `${id}:${index}:${record.parts.length}`
      // 空白和单独的 URL 无需发送给翻译服务。
      const translatable = part.trim() && !/^https?:\/\/\S+$/i.test(part.trim())
      record.parts.push({ key, text: part, translatable })
      if (translatable) items.push({ id: key, text: part.trim(), kind, context })
    }
  }
  const read = (results, key) => (results instanceof Map ? results.get(key) : results?.[key])
  const isComplete = (results) => items.every((item) => String(read(results, item.id) || '').trim())
  return {
    items,
    isComplete,
    apply(results) {
      if (!items.length || !isComplete(results)) return ''
      for (const record of records) {
        record.translated = record.parts
          .map((part) => {
            if (!part.translatable) return part.text
            const translated = String(read(results, part.key)).trim()
            return part.text.match(/^\s*/)[0] + translated + part.text.match(/\s*$/)[0]
          })
          .join('')
        if (record.node) record.node.nodeValue = record.translated
      }
      return container ? container.innerHTML : records[0]?.translated || ''
    }
  }
}
