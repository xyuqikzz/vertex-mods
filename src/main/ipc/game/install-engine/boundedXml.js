import { InstallEngineError } from './installEngineError.js'

const fail = () => {
  throw new InstallEngineError(
    'install_engine.fomod_invalid',
    'FOMOD XML 格式无效或超出受限解析能力'
  )
}
function decode(value) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(value)) fail()
  return value.replace(/&([^;]+);/g, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.hasOwn(named, entity)) return named[entity]
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    if (
      !Number.isInteger(code) ||
      (code < 32 && ![9, 10, 13].includes(code)) ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      fail()
    return String.fromCodePoint(code)
  })
}

// No DTD, custom entities, external resolution, executable extensions or recovery from malformed XML.
export function parseBoundedXml(text) {
  if (Buffer.byteLength(text) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) fail()
  const root = { name: '#document', attributes: {}, children: [], text: '' }
  const stack = [root]
  const tokens =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[A-Za-z_][\w:.-]*\s*>|<[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/gy
  let cursor = 0
  let count = 0
  let prologue = false
  while (cursor < text.length) {
    tokens.lastIndex = cursor
    const match = tokens.exec(text)
    if (!match || match.index !== cursor) fail()
    cursor = tokens.lastIndex
    const token = match[0]
    const current = stack.at(-1)
    if (token.startsWith('<!--')) {
      if (token.slice(4, -3).includes('--')) fail()
      continue
    }
    if (token.startsWith('<?')) {
      if (
        prologue ||
        !token.startsWith('<?xml ') ||
        root.children.length ||
        stack.length !== 1 ||
        /encoding\s*=\s*['"](?!utf-(?:8|16(?:le|be)?)['"])/i.test(token)
      )
        fail()
      prologue = true
      continue
    }
    if (token.startsWith('<![CDATA[')) {
      current.text += token.slice(9, -3)
      continue
    }
    if (token.startsWith('</')) {
      if (stack.length === 1 || current.name !== token.slice(2, -1).trim()) fail()
      stack.pop()
    } else if (token.startsWith('<')) {
      if (++count > 20000) fail()
      const name = token.match(/^<([^\s/>]+)/)[1]
      const node = { name, attributes: Object.create(null), children: [], text: '' }
      for (const attribute of token.matchAll(
        /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      )) {
        if (Object.hasOwn(node.attributes, attribute[1])) fail()
        node.attributes[attribute[1]] = decode(attribute[2] ?? attribute[3])
      }
      current.children.push(node)
      if (!token.endsWith('/>')) stack.push(node)
      if (stack.length > 32) fail()
    } else current.text += decode(token)
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail()
  return root.children[0]
}
