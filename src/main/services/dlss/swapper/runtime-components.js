// Adapted to Vertex ES modules from DLSS5-Swapper v2.2.7 (MIT).
// Copyright (c) 2026 Rakan Alkhaldi. See resources/licenses/DLSS5-Swapper-LICENSE.txt.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { extractZip } from '../../../utils/extractZip.js'
import pe from './pe.js'
// LumeniteFX's licence requires redistribution through the author's official
// links. It is therefore fetched directly from the upstream GitHub repository
// on first use, verified, cached locally, and never bundled in our release.

const DGVOODOO = {
  version: '2.87.5',
  url: 'https://github.com/dege-diosg/dgVoodoo2/releases/download/v2.87.5/dgVoodoo2_87_5.zip',
  sha256: '5ffde6927f7355ca3fdd5d785b581256a8e6539fa13e395a891ade6ba1040850'
}

async function ensureDgVoodoo(cacheRoot, onProgress = () => {}) {
  const progress = (value) => onProgress({ name: 'dgVoodoo2', version: DGVOODOO.version, ...value })
  const base = path.join(path.resolve(cacheRoot), 'components', `dgVoodoo2-${DGVOODOO.version}`)
  const archive = base + '.zip'
  progress({ phase: 'checking' })
  if (!cached(archive, DGVOODOO.sha256))
    await fetchVerified(DGVOODOO.url, DGVOODOO.sha256, archive, { onProgress: progress })
  else progress({ phase: 'cached', source: 'cache' })
  // Re-extract the verified archive, never trust previously cached loose DLLs.
  progress({ phase: 'extracting' })
  await extractZip(archive, { dir: base })
  return base
}

function missingVCRuntime(bitness, exeDir, systemRoot = process.env.SystemRoot, extra = []) {
  if (!systemRoot) return []
  const systemDir = path.join(systemRoot, bitness === 32 ? 'SysWOW64' : 'System32')
  const names = [
    'msvcp140.dll',
    'vcruntime140.dll',
    ...(bitness === 64 ? ['vcruntime140_1.dll'] : []),
    ...extra
  ]
  return names.filter((name) => {
    const local = exeDir && path.join(exeDir, name)
    const file = local && fs.existsSync(local) ? local : path.join(systemDir, name)
    return pe.getBitness(file) !== bitness
  })
}

const LUMENITE = {
  commit: 'f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9',
  url: 'https://codeload.github.com/umar-afzaal/LumeniteFX/zip/f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9',
  sha256: '43220f99fc0ffa0216e01ebd657180f8c9d043c939f760283b896ea257f1b6a2'
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// A cached component counts only when it is still on disk and still the pinned
// bytes; an unreadable or removed file simply means "download it again".
function cached(file, expected) {
  try {
    return digest(file) === expected
  } catch {
    return false
  }
}

async function fetchBytes(url, { timeoutMs = 600000, onProgress = () => {} } = {}) {
  onProgress({ phase: 'downloading', received: 0, total: 0 })
  const response = await fetch(url, {
    headers: { 'User-Agent': 'DLSS5-Swapper/2.1' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok)
    throw Object.assign(new Error(`Download failed (${response.status})`), {
      status: response.status
    })
  // Compressed HTTP bodies report the wire size, not the decoded stream size.
  const total = response.headers.get('content-encoding')
    ? 0
    : Math.max(0, Number(response.headers.get('content-length')) || 0)
  const chunks = []
  let received = 0
  for await (const chunk of response.body) {
    received += chunk.length
    chunks.push(chunk)
    onProgress({ phase: 'downloading', received, total })
  }
  return Buffer.concat(chunks)
}

async function download(url, file) {
  const data = await fetchBytes(url)
  const temp = file + '.part'
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.writeFile(temp, data)
  await fs.promises.rename(temp, file)
}

function componentError(code, message) {
  return Object.assign(new Error(message), { code })
}

// Three different failures used to arrive as one message about the network.
// The bytes are checked in memory first, so a bad transfer is told apart
// from a file that was verified and then taken away - which is what a
// security tool quarantining dgVoodoo2's wrapper DLLs looks like from here,
// and no amount of retrying the connection fixes it.
// The two steps are injectable so the quarantine case - bytes that verify and
// then are not there - can be exercised without a real antivirus.
async function fetchVerified(url, expected, file, deps = {}) {
  const fetcher = deps.fetchBytes || fetchBytes
  const read = deps.digest || digest
  const onProgress = deps.onProgress || (() => {})
  let data
  const attempts = Math.max(1, Math.min(3, deps.attempts ?? 3))
  for (let attempt = 1; ; attempt++) {
    try {
      data = await fetcher(url, { onProgress, timeoutMs: deps.timeoutMs })
      break
    } catch (cause) {
      if (
        attempt >= attempts ||
        (cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429)
      )
        throw componentError('componentNetwork', cause.message)
      onProgress({
        phase: 'downloading',
        received: 0,
        total: 0,
        message: '下载中断，正在重试（' + (attempt + 1) + '/' + attempts + '）'
      })
      await new Promise((resolve) => setTimeout(resolve, attempt * 400))
    }
  }
  onProgress({ phase: 'verifying', received: data.length, total: data.length })
  const received = crypto.createHash('sha256').update(data).digest('hex')
  if (received !== expected) {
    throw componentError('componentChecksum', `expected ${expected}, received ${received}`)
  }
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.part'
  await fs.promises.writeFile(temp, data)
  await fs.promises.rename(temp, file)
  let stored = null
  try {
    stored = read(file)
  } catch {
    stored = null
  }
  if (stored !== expected) throw componentError('componentRemoved', path.dirname(file))
  onProgress({ phase: 'saved', received: data.length, total: data.length })
}

async function ensureLumenite(cacheRoot, onProgress = () => {}) {
  const progress = (value) => onProgress({ name: 'LumeniteFX', version: 'Kernel 2.0', ...value })
  progress({ phase: 'checking' })
  const base = path.join(cacheRoot, 'components', `LumeniteFX-${LUMENITE.commit.slice(0, 8)}`)
  const archive = base + '.zip'
  const marker = path.join(base, '.verified')
  if (fs.existsSync(marker)) {
    const folders = fs.readdirSync(base).filter((name) => name !== '.verified')
    const root = folders
      .map((name) => path.join(base, name))
      .find((item) => fs.existsSync(path.join(item, 'Shaders')))
    if (root) {
      progress({ phase: 'cached', source: 'cache' })
      return root
    }
  }

  if (!cached(archive, LUMENITE.sha256)) {
    try {
      await fs.promises.unlink(archive)
    } catch {
      /* Preserve upstream optional-file / best-effort fallback semantics. */
    }
    // This provider is optional; VORT is already bundled. An unreachable host
    // must not hold every first Feeder installation for two minutes.
    await fetchVerified(LUMENITE.url, LUMENITE.sha256, archive, {
      attempts: 1,
      timeoutMs: 10000,
      onProgress: progress
    })
  } else progress({ phase: 'cached', source: 'cache' })

  progress({ phase: 'extracting' })
  await fs.promises.rm(base, { recursive: true, force: true })
  await extractZip(archive, { dir: base })
  const folders = fs.readdirSync(base)
  const root = folders
    .map((name) => path.join(base, name))
    .find((item) => fs.existsSync(path.join(item, 'Shaders')))
  if (!root) throw new Error('LumeniteFX archive layout is invalid')
  await fs.promises.writeFile(marker, LUMENITE.sha256, 'utf8')
  return root
}

export {
  LUMENITE,
  DGVOODOO,
  ensureLumenite,
  ensureDgVoodoo,
  missingVCRuntime,
  digest,
  download,
  fetchBytes,
  fetchVerified,
  cached
}
export default {
  LUMENITE,
  DGVOODOO,
  ensureLumenite,
  ensureDgVoodoo,
  missingVCRuntime,
  digest,
  download,
  fetchBytes,
  fetchVerified,
  cached
}
