const ALLOWED_AI_AGENT_MARKDOWN_LINK_PROTOCOLS = Object.freeze(new Set(['http:', 'https:']))

export function escapeAiAgentMarkdownHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeAiAgentMarkdownLinkHref(value = '') {
  const href = String(value || '').trim()
  if (!href) return ''
  try {
    const url = new URL(href)
    return ALLOWED_AI_AGENT_MARKDOWN_LINK_PROTOCOLS.has(url.protocol) ? href : ''
  } catch {
    return ''
  }
}

export function renderAiAgentMarkdownLink(tokenOrHref = {}, title = '', text = '') {
  const token =
    tokenOrHref && typeof tokenOrHref === 'object'
      ? tokenOrHref
      : { href: tokenOrHref, title, text }
  const safeHref = normalizeAiAgentMarkdownLinkHref(token.href)
  const safeText = escapeAiAgentMarkdownHtml(token.text || token.href || '')
  if (!safeHref) return safeText
  const titleAttr = token.title ? ` title="${escapeAiAgentMarkdownHtml(token.title)}"` : ''
  return `<a href="${escapeAiAgentMarkdownHtml(safeHref)}"${titleAttr} target="_blank" rel="noreferrer">${safeText}</a>`
}
