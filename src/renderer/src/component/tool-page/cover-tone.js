// 没有封面图时的占位底色，与「我的游戏」COVER_PLACEHOLDER_TONES 相同，白色缩写在上面可读。
const COVER_PLACEHOLDER_TONES = Object.freeze([
  '#4a4f7a',
  '#6b5a2e',
  '#5a3a32',
  '#2d3f5c',
  '#3f4a3a',
  '#4b3a5e',
  '#3a5258',
  '#44484e',
  '#5a4632',
  '#2f4a4a'
])

export function coverPlaceholderTone(key = '') {
  let hash = 0
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COVER_PLACEHOLDER_TONES[hash % COVER_PLACEHOLDER_TONES.length]
}

export function coverMonogram(name = '') {
  const text = String(name || '').trim()
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (/^[\x20-\x7e]+$/.test(text) && words.length > 1) {
    return words
      .slice(0, 3)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  }
  if (/^[\x20-\x7e]+$/.test(text) && words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return [...(text || '?')].slice(0, 2).join('')
}
