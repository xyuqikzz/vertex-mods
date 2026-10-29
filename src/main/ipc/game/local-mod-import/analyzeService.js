import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'

export const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeSlash(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function isSafeRelativePath(value = '') {
  const normalized = normalizeSlash(value)
  return !!normalized && !normalized.startsWith('../') && !path.isAbsolute(normalized)
}

export function isArchivePath(filePath = '') {
  return ARCHIVE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase())
}

export async function hashFile(filePath = '') {
  const hash = crypto.createHash('sha1')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function scanDirectoryEntries(rootPath = '', options = {}) {
  const limit = Math.max(1, toSafeNumber(options.limit, 1200))
  const root = path.resolve(rootPath)
  const entries = []
  let truncated = false

  async function walk(currentPath) {
    if (entries.length >= limit) {
      truncated = true
      return
    }

    const names = await fs.readdir(currentPath)
    for (const name of names) {
      if (entries.length >= limit) {
        truncated = true
        return
      }
      const absolutePath = path.join(currentPath, name)
      const stat = await fs.stat(absolutePath)
      const relativePath = normalizeSlash(path.relative(root, absolutePath))
      entries.push({
        relativePath,
        entryType: stat.isDirectory() ? 'dir' : 'file',
        sizeBytes: stat.isFile() ? stat.size : 0,
        fileHash: ''
      })
      if (stat.isDirectory()) {
        await walk(absolutePath)
      }
    }
  }

  await walk(root)
  return {
    entries,
    truncated
  }
}

function scanZipEntries(filePath = '') {
  const zip = new AdmZip(filePath)
  const entries = zip
    .getEntries()
    .map((entry) => ({
      relativePath: normalizeSlash(entry.entryName),
      entryType: entry.isDirectory ? 'dir' : 'file',
      sizeBytes: entry.header?.size || 0,
      fileHash: ''
    }))
    .filter((entry) => isSafeRelativePath(entry.relativePath))

  return {
    entries,
    truncated: false
  }
}

export async function scanPathEntries(targetPath = '', options = {}) {
  const stat = await fs.stat(targetPath)
  if (stat.isDirectory()) {
    return await scanDirectoryEntries(targetPath, options)
  }

  if (isArchivePath(targetPath) && path.extname(targetPath).toLowerCase() === '.zip') {
    return scanZipEntries(targetPath)
  }

  return {
    entries: [
      {
        relativePath: path.basename(targetPath),
        entryType: 'file',
        sizeBytes: stat.size,
        fileHash: ''
      }
    ],
    truncated: false
  }
}

function detectSignals(entries = []) {
  const normalized = entries.map((entry) => normalizeSlash(entry.relativePath).toLowerCase())
  const hasPath = (pattern) => normalized.some((item) => item.includes(pattern))
  const hasFile = (name) => normalized.some((item) => item.endsWith(name))
  const signals = []

  if (hasFile('manifest.json') && hasPath('plugins/')) signals.push('thunderstore')
  if (hasPath('bepinex/') || hasPath('bepinex/plugins/')) signals.push('bepinex')
  if (hasPath('melonloader/') || hasPath('mods/')) signals.push('melonloader')
  if (hasPath('ue4ss/') || hasFile('ue4ss.dll')) signals.push('ue4ss')
  if (hasFile('.pak') || hasPath('paks/')) signals.push('unrealpak')
  if (hasPath('plugins/') || hasPath('config/')) signals.push('generic')

  return [...new Set(signals)]
}

export function detectModType(entries = []) {
  const signals = detectSignals(entries)
  if (signals.includes('thunderstore')) return 'thunderstore'
  if (signals.includes('bepinex')) return 'bepinex'
  if (signals.includes('melonloader')) return 'melonloader'
  if (signals.includes('ue4ss')) return 'ue4ss'
  if (signals.includes('unrealpak')) return 'unrealpak'
  if (signals.includes('generic')) return 'generic'
  return ''
}

export async function createPathFingerprint(targetPath = '') {
  const stat = await fs.stat(targetPath)
  const hash = crypto.createHash('sha1')
  const absolutePath = path.resolve(targetPath)

  if (stat.isFile()) {
    hash.update('file:')
    hash.update(path.basename(absolutePath).toLowerCase())
    hash.update(':')
    hash.update(await hashFile(absolutePath))
    return hash.digest('hex')
  }

  const scanned = await scanDirectoryEntries(absolutePath, { limit: 5000 })
  const fileEntries = scanned.entries
    .filter((entry) => entry.entryType === 'file')
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  for (const entry of fileEntries) {
    const filePath = path.join(absolutePath, entry.relativePath)
    hash.update(entry.relativePath.toLowerCase())
    hash.update(':')
    hash.update(String(entry.sizeBytes || 0))
    hash.update(':')
    hash.update(await hashFile(filePath))
    hash.update('\n')
  }

  return hash.digest('hex')
}

export async function analyzeSourcePath(targetPath = '') {
  const safePath = toSafeText(targetPath)
  if (!safePath) {
    return { success: false, message: '路径为空' }
  }
  const exists = await fs.pathExists(safePath)
  if (!exists) {
    return { success: false, message: '路径不存在', path: safePath }
  }

  const absolutePath = path.resolve(safePath)
  const stat = await fs.stat(absolutePath)
  const sourceType = stat.isDirectory() ? 'folder' : isArchivePath(absolutePath) ? 'archive' : 'file'
  const scanResult = await scanPathEntries(absolutePath)
  const entries = scanResult.entries
  const fileCount = entries.filter((entry) => entry.entryType === 'file').length
  const dirCount = entries.filter((entry) => entry.entryType === 'dir').length
  const sizeBytes = stat.isDirectory()
    ? entries.reduce((sum, entry) => sum + toSafeNumber(entry.sizeBytes, 0), 0)
    : stat.size
  const fingerprint = await createPathFingerprint(absolutePath)
  const displayName = path.basename(absolutePath, stat.isFile() ? path.extname(absolutePath) : '')

  return {
    success: true,
    path: absolutePath,
    sourceType,
    fileName: path.basename(absolutePath),
    displayName,
    ext: stat.isFile() ? path.extname(absolutePath).toLowerCase() : '',
    fileCount,
    dirCount,
    sizeBytes,
    fingerprint,
    modType: detectModType(entries),
    signals: detectSignals(entries),
    entries: entries.slice(0, 300),
    truncated: scanResult.truncated || entries.length > 300
  }
}

export async function analyzeSourcePaths(payload = {}) {
  const paths = Array.isArray(payload.paths) ? payload.paths : []
  const results = []
  for (const itemPath of paths) {
    results.push(await analyzeSourcePath(itemPath))
  }
  return {
    success: true,
    data: {
      items: results,
      successCount: results.filter((item) => item.success).length,
      failedCount: results.filter((item) => !item.success).length
    }
  }
}
