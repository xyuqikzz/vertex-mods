import fs from 'node:fs'
import path from 'node:path'
import { parentPort } from 'node:worker_threads'

const shortcutIndexCache = { builtAt: 0, entries: [] }
const executableCache = new Map()
const SHORTCUT_TTL = 5 * 60 * 1000

function cleanPath(value = '') {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/,\s*-?\d+\s*$/, '')
}

function extractExecutablePath(value = '') {
  const source = String(value || '').trim()
  if (!source) return ''
  const quoted = source.match(/^['"]([^'"]+)['"]/)
  if (quoted?.[1]) return cleanPath(quoted[1])
  const executable = source.match(/^(.+?\.(?:exe|dll|ico|png|jpg|jpeg|bmp|webp|lnk))(?=\s|,|$)/i)
  return cleanPath(executable?.[1] || source)
}

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function getShortcutRoots() {
  return [
    path.join(process.env.USERPROFILE || '', 'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter((dir) => dir && fs.existsSync(dir))
}

function buildShortcutIndex() {
  const now = Date.now()
  if (shortcutIndexCache.entries.length && now - shortcutIndexCache.builtAt < SHORTCUT_TTL) {
    return shortcutIndexCache.entries
  }

  const queue = getShortcutRoots().map((dir) => ({ dir, depth: 0 }))
  const result = []
  let scanned = 0
  while (queue.length && scanned < 20000) {
    const current = queue.shift()
    let entries = []
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      scanned += 1
      if (scanned > 20000) break
      const fullPath = path.join(current.dir, entry.name)
      if (entry.isFile() && /\.lnk$/i.test(entry.name)) {
        const shortcutName = path.basename(entry.name, '.lnk')
        if (!/uninstall|remove|卸载/i.test(shortcutName)) {
          result.push({ path: fullPath, name: normalizeName(shortcutName) })
        }
      } else if (entry.isDirectory() && current.depth < 6) {
        queue.push({ dir: fullPath, depth: current.depth + 1 })
      }
    }
  }
  shortcutIndexCache.entries = result
  shortcutIndexCache.builtAt = now
  return result
}

function findShortcutCandidates(displayName = '') {
  const target = normalizeName(displayName)
  if (!target) return []
  return buildShortcutIndex()
    .filter((entry) => entry.name === target || entry.name.includes(target) || target.includes(entry.name))
    .slice(0, 12)
    .map((entry) => entry.path)
}

function guessExecutable(installLocation = '', displayName = '') {
  const installDir = cleanPath(installLocation)
  if (!installDir || !fs.existsSync(installDir)) return ''
  const cacheKey = `${installDir.toLowerCase()}::${normalizeName(displayName)}`
  if (executableCache.has(cacheKey)) return executableCache.get(cacheKey)

  const queue = [{ dir: installDir, depth: 0 }]
  const candidates = []
  let scanned = 0
  while (queue.length && scanned < 3000) {
    const current = queue.shift()
    let entries = []
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      scanned += 1
      if (scanned > 3000) break
      const fullPath = path.join(current.dir, entry.name)
      if (entry.isFile() && /\.exe$/i.test(entry.name) && !/unins|uninstall|remove/i.test(entry.name)) {
        candidates.push(fullPath)
      } else if (entry.isDirectory() && current.depth < 4) {
        queue.push({ dir: fullPath, depth: current.depth + 1 })
      }
    }
  }

  const target = normalizeName(displayName)
  const score = (filePath) => {
    const name = normalizeName(path.basename(filePath, '.exe'))
    if (name === target) return 3
    if (name.includes(target) || target.includes(name)) return 2
    return 1
  }
  const best = candidates.sort((left, right) => score(right) - score(left))[0] || ''
  executableCache.set(cacheKey, best)
  if (executableCache.size > 1000) executableCache.delete(executableCache.keys().next().value)
  return best
}

function resolveCandidates(payload = {}) {
  const result = new Set()
  const push = (value) => {
    const candidate = extractExecutablePath(value)
    if (candidate && fs.existsSync(candidate)) result.add(path.resolve(candidate))
  }

  findShortcutCandidates(payload.displayName).forEach(push)
  push(payload.displayIcon)
  push(guessExecutable(payload.installLocation, payload.displayName))
  return Array.from(result)
}

parentPort.on('message', ({ requestId, payload }) => {
  try {
    parentPort.postMessage({ requestId, candidates: resolveCandidates(payload) })
  } catch (error) {
    parentPort.postMessage({ requestId, error: String(error?.message || error), candidates: [] })
  }
})
