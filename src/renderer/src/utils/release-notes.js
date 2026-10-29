import { Marked } from 'marked'
import { escapeAiAgentMarkdownHtml } from '../../../shared/ai/conversation/ai-agent-markdown-link.js'

export function normalizeReleaseNotes(source) {
  const values = Array.isArray(source) ? source : [source]
  return values
    .map((item) => typeof item === 'string' ? item : item?.note || item?.description || '')
    .filter((item) => typeof item === 'string')
    .join('\n\n')
    .trim()
    .slice(0, 100000)
}

export function releaseNoteLink(value) {
  try {
    if (typeof value !== 'string' || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return ''
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : ''
  } catch { return '' }
}

// 独立实例避免与助手消息的全局 marked 配置相互影响。远程图片只显示替代文字。
const parser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeAiAgentMarkdownHtml(text),
    image: ({ text }) => escapeAiAgentMarkdownHtml(text),
    link(token) {
      const text = this.parser.parseInline(token.tokens)
      const href = releaseNoteLink(token.href)
      return href
        ? `<a href="${escapeAiAgentMarkdownHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text
    }
  }
})

export function renderReleaseNotes(source) {
  const text = normalizeReleaseNotes(source)
  if (!text) return ''
  try { return parser.parse(text) }
  catch { return `<p>${escapeAiAgentMarkdownHtml(text)}</p>` }
}
