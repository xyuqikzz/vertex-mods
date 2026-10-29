import { normalizeRelativeRulePath } from './contracts.js'
import { InstallEngineError } from './installEngineError.js'

const cache = new Map()
let cachedStateCount = 0
function compile(pattern, caseSensitive) {
  const key = `${caseSensitive}:${pattern}`
  if (cache.has(key)) return cache.get(key)
  const states = []
  const state = () => { states.push({ epsilon: [], edges: [] }); return states.length - 1 }
  let current = state()
  const edge = (from, to, kind, literal) => states[from].edges.push({ to, kind, literal,
    // A single-character regexp preserves the old /i folding without backtracking.
    asciiFold: kind === 'literal' && !caseSensitive && literal.charCodeAt(0) < 128 ? literal.toLowerCase() : null,
    folded: kind === 'literal' && !caseSensitive && literal.charCodeAt(0) >= 128 ? new RegExp(`^${literal.replace(/[|\\{}()[\]^$+?.*]/g, '\\$&')}$`, 'i') : null })
  for (let i = 0; i < pattern.length; i++) {
    const next = state()
    if (i === 0 && pattern.startsWith('**/')) {
      const loop = state()
      states[current].epsilon.push(next, loop)
      edge(loop, loop, 'any')
      edge(loop, next, 'literal', '/')
      i += 2
    } else if (pattern.slice(i, i + 4) === '/**/') {
      const afterSlash = state(), loop = state()
      edge(current, afterSlash, 'literal', '/')
      states[afterSlash].epsilon.push(next, loop)
      edge(loop, loop, 'any')
      edge(loop, next, 'literal', '/')
      i += 3
    } else if (pattern.slice(i) === '/**') {
      const loop = state()
      states[current].epsilon.push(next)
      edge(current, loop, 'literal', '/')
      states[loop].epsilon.push(next)
      edge(loop, loop, 'any')
      i += 2
    } else if (pattern[i] === '*') {
      const globstar = pattern[i + 1] === '*'
      states[current].epsilon.push(next)
      edge(current, current, globstar ? 'any' : 'segment')
      if (globstar) i++
    } else edge(current, next, pattern[i] === '?' ? 'segment' : 'literal', pattern[i])
    current = next
  }
  const closures = states.map((_, index) => {
    const visited = new Set([index]), pending = [index]
    while (pending.length) for (const next of states[pending.pop()].epsilon) if (!visited.has(next)) { visited.add(next); pending.push(next) }
    return [...visited]
  })
  const weight = states.length + closures.reduce((sum, entries) => sum + entries.length, 0)
  const machine = { states, closures, end: current, weight }
  while (cache.size && (cache.size >= 500 || cachedStateCount + weight > 200000)) {
    const oldest = cache.keys().next().value
    cachedStateCount -= cache.get(oldest).weight
    cache.delete(oldest)
  }
  cache.set(key, machine)
  cachedStateCount += weight
  return machine
}

export function matchGlobPattern(pattern = '', value = '', options = {}) {
  const caseSensitive = options.caseSensitive === true
  const normalizedPattern = normalizeRelativeRulePath(pattern)
  const normalizedValue = normalizeRelativeRulePath(value)
  if (!normalizedPattern) return false

  if (normalizedPattern.length > 1024 || normalizedValue.length > 32768 || normalizedPattern.length * normalizedValue.length > 2000000) {
    throw new InstallEngineError('install_engine.pattern_budget', 'glob 模式或路径超过匹配预算')
  }
  const machine = compile(normalizedPattern, caseSensitive)
  let active = new Set(machine.closures[0])
  for (let i = 0; i < normalizedValue.length; i++) {
    const character = normalizedValue[i]
    const asciiCharacter = character.charCodeAt(0) < 128 ? character.toLowerCase() : null
    const next = new Set()
    for (const index of active) for (const edge of machine.states[index].edges) {
      const matched = edge.kind === 'any' ? character !== '\n' && character !== '\r' && character !== '\u2028' && character !== '\u2029'
        : edge.kind === 'segment' ? character !== '/'
          : edge.asciiFold !== null ? asciiCharacter === edge.asciiFold
            : edge.folded ? edge.folded.test(character) : character === edge.literal
      if (matched) for (const closure of machine.closures[edge.to]) next.add(closure)
    }
    if (!next.size) return false
    active = next
  }
  return active.has(machine.end)
}
