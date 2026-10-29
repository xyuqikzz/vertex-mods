// app-builder-lib 26.18.1 的污染输出回退逐字符重复 JSON.parse，遇到 chcp 前缀会长时间阻塞。
// 只裁出第一个完整 JSON 对象，再解析一次；损坏或截断的 JSON 仍然失败。
export function parseDependencyTreeOutput(output) {
  const text = String(output).trim()
  try {
    return JSON.parse(text)
  } catch {
    /* 检查 Windows 命令启动时的额外输出。 */
  }
  const start = text.indexOf('{')
  if (start < 0) throw new SyntaxError('Dependency tree output does not contain JSON')
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{' || character === '[') depth++
    else if (character === '}' || character === ']') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, index + 1))
    }
  }
  throw new SyntaxError('Dependency tree JSON is incomplete')
}
