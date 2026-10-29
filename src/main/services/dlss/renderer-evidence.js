import fs from 'node:fs'
import path from 'node:path'
import { isCurrentSession } from './detection/session.js'
import pe from './swapper/pe.js'
import { safePath } from './swapper/file-journal.js'
import { snapshotGameProcesses } from './processes.js'

export const LOG_LIMIT = 256 * 1024
export const LOG_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export function logTime(line, reference) {
  const iso = line.match(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:\d{2})?/)
  if (iso) return Date.parse(iso[0])
  const clock = line.match(/\b(\d{2}):(\d{2}):(\d{2})(?:[.:](\d{3}))?/)
  if (!clock) return NaN
  const date = new Date(reference)
  date.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3]), Number(clock[4] || 0))
  // A session can cross midnight. Pick the nearest clock occurrence, rather
  // than moving yesterday's header into the future when reading its last write.
  if (date.getTime() - reference > 12 * 3600000) date.setDate(date.getDate() - 1)
  if (reference - date.getTime() > 12 * 3600000) date.setDate(date.getDate() + 1)
  return date.getTime()
}
export function apiFromRuntimeLog(text) {
  // Device creation (including ReShade's redirected D3D12CreateDevice) also
  // happens for Feeder's private compute device. Only presentation evidence
  // belongs here; a DXGI swapchain alone cannot distinguish DX11 from DX12.
  const patterns = [
    ['opengl', 'OpenGL', /Initialized OpenGL|Redirecting wglSwapBuffers/i],
    ['dxgi', 'DirectX (DXGI)', /Redirecting IDXGIFactory\d*::CreateSwapChain/],
    ['vulkan', 'Vulkan', /Redirecting vkCreateSwapchainKHR/]
  ]
  const hasRuntime =
    /(?:Created|Recreated|Initialized) runtime environment|Initialized OpenGL/i.test(text)
  return hasRuntime
    ? apiSummary(
        patterns
          .filter(([, , pattern]) => pattern.test(text))
          .map(([api, label]) => ({ api, label }))
      )
    : null
}

const pathKey = (value) => path.resolve(value).toLowerCase()

export function reShadeSession(log, { exe, bitness, since = 0, startedAt, now = Date.now() }) {
  if (!log?.text || log.error || log.modifiedAt < since) return null
  const header = [...log.text.matchAll(/^.*Initializing (?:crosire's )?ReShade version.*$/gim)].at(
    -1
  )
  const target = header?.[0].match(/\b(?:into|for) ['"]([^'"\r\n]+)['"]/i)?.[1]
  const bits = header?.[0].match(/\((32|64)-bit\)/)?.[1]
  if (!target || pathKey(target) !== pathKey(exe) || (bits && bitness && Number(bits) !== bitness))
    return null
  const time = logTime(header[0], startedAt ?? log.modifiedAt)
  if (!Number.isFinite(time) || time < since || time > now + 60000 || now - time > LOG_MAX_AGE)
    return null
  if (startedAt != null && !isCurrentSession(time, startedAt, log.modifiedAt, now)) return null
  return { text: log.text.slice(header.index), time }
}

export function feederSession(log, exe, startedAt, version, now = Date.now()) {
  if (!log?.text || log.error || !Number.isFinite(startedAt)) return ''
  const header = [...log.text.matchAll(/^.*dlss5-feed ([\d.]+).*attached\..*$/gim)].at(-1)
  if (!header || (version && header[1] !== version)) return ''
  const text = log.text.slice(header.index)
  const host = text.match(/^.*?\bhost:\s*(.+?)\s*$/im)?.[1]
  if (
    !host ||
    pathKey(host) !== pathKey(exe) ||
    !isCurrentSession(logTime(header[0], startedAt), startedAt, log.modifiedAt, now)
  )
    return ''
  return text
}

export function apiFromFeederLog(text) {
  // This names the game-side transport, unlike "opening D3D12 session" or
  // "private device adapter". Unknown log formats remain unconfirmed.
  const labels = {
    D3D11: ['dxgi', 'DirectX 11'],
    D3D12: ['dxgi', 'DirectX 12'],
    OpenGL: ['opengl', 'OpenGL'],
    Vulkan: ['vulkan', 'Vulkan']
  }
  return apiSummary(
    [
      ...text.matchAll(
        /\[feed\] NGX init: transport (?:same-device )?(D3D11|D3D12|OpenGL|Vulkan)\b/g
      )
    ].map((match) => {
      const [api, label] = labels[match[1]]
      return { api, label }
    })
  )
}

function reshadeObservation(root, exe, rows, now) {
  const running = rows.filter((row) => row.exe && pathKey(row.exe) === pathKey(exe.path))
  if (
    running.length > 1 ||
    running.some((row) => !row.readable || !Number.isFinite(Date.parse(row.startedAt)))
  )
    return
  if (rows.some((row) => !row.exe && !row.readable)) return
  const startedAt = running.length ? Date.parse(running[0].startedAt) : undefined
  let since =
    Math.max(
      ...[
        exe.path,
        exe.evidenceFile,
        ...(exe.apiCandidates || []).flatMap((item) => (item.sources || []).map((s) => s.file))
      ]
        .filter(Boolean)
        .map((file) => fs.statSync(file).mtimeMs)
    ) - 2000
  let version
  try {
    const file = safePath(root, '_DLSS5_Backup/manifest.json')
    if (fs.statSync(file).size < 2 * 1024 * 1024) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (pathKey(safePath(root, manifest.game.exe)) === pathKey(exe.path)) {
        since = Math.max(since, Date.parse(manifest.date) || 0)
        version = manifest.feeder?.version
      }
    }
  } catch {
    /* A missing installation is normal during pre-install scanning. */
  }
  const observations = []
  for (const dir of [...new Set([root, path.dirname(exe.path)])]) {
    let names = []
    try {
      names = fs
        .readdirSync(dir)
        .filter((name) => /^ReShade\d*\.log$/i.test(name))
        .slice(0, 8)
    } catch {
      continue
    }
    for (const name of names) {
      const log = readTechnicalLog(root, path.relative(root, path.join(dir, name)), { since, now })
      const session = reShadeSession(log, {
        exe: exe.path,
        bitness: exe.bitness,
        since,
        startedAt,
        now
      })
      if (!session) continue
      const feed = readTechnicalLog(
        root,
        path.relative(root, path.join(path.dirname(exe.path), 'dlss5-feed.log')),
        { since, now }
      )
      const feedText = feederSession(feed, exe.path, session.time, version)
      const api = apiSummary([
        ...(apiFromRuntimeLog(session.text)?.candidates || []),
        ...(apiFromFeederLog(feedText)?.candidates || [])
      ])
      if (api) observations.push({ api, time: session.time, file: log.rel })
    }
  }
  if (!observations.length) return
  const latest = Math.max(...observations.map((item) => item.time))
  if (exe.apiEvidence?.observedAt > latest) return
  const current = observations.filter((item) => latest - item.time <= 15000)
  const api = apiSummary(current.flatMap((item) => item.api.candidates))
  Object.assign(exe, {
    api: api.api,
    apiLabel: api.label,
    dx12: api.label === 'DirectX 12',
    apiEvidence: {
      source: 'runtime-log',
      confidence: api.api ? 'observed' : 'ambiguous',
      file: current.map((x) => x.file).join(', '),
      observedAt: latest,
      scope: running.length === 1 ? 'current' : 'historical',
      candidates: api.candidates
    }
  })
  exe.apiCandidates = apiSummary([...exe.apiCandidates, ...api.candidates]).candidates
}

// Only technical logs in the selected instance are read. Never follow junctions
// into another game or parse dialogue/history files such as game.log.
export function readTechnicalLog(root, rel, { since = 0, now = Date.now() } = {}) {
  let fd
  try {
    const file = safePath(root, rel)
    const stat = fs.statSync(file)
    if (
      !stat.isFile() ||
      stat.mtimeMs < since ||
      stat.mtimeMs > now + 60000 ||
      now - stat.mtimeMs > LOG_MAX_AGE
    )
      return null
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(Math.min(stat.size, LOG_LIMIT))
    fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length))
    return {
      rel,
      text: buffer.toString('utf8'),
      modifiedAt: stat.mtimeMs,
      truncated: stat.size > LOG_LIMIT
    }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null
    return { rel, error: error.code || 'unreadable' }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export function apiSummary(candidates) {
  const byLabel = new Map()
  for (const item of candidates.filter((item) => item.api && item.label)) {
    const existing = byLabel.get(item.label)
    const sources = [...(existing?.sources || []), ...(item.sources || [])]
    byLabel.set(item.label, {
      ...item,
      ...(sources.length
        ? { sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()] }
        : {})
    })
  }
  const unique = [...byLabel.values()]
  const specific = unique.some((item) => item.api === 'dxgi' && item.label !== 'DirectX (DXGI)')
    ? unique.filter((item) => item.label !== 'DirectX (DXGI)')
    : unique
  const list = specific.length ? specific : unique
  if (!list.length) return null
  return {
    api: list.length === 1 ? list[0].api : null,
    label: list.length === 1 ? list[0].label : null,
    candidates: list,
    confidence: list.length === 1 ? 'static' : 'ambiguous'
  }
}

// An engine-level entry profile, not a game-name allowlist. The interpreter
// and launcher can share a renderer library without sharing a deployment dir.
function engineEntry(root, exe) {
  if (path.dirname(exe.path) !== path.resolve(root)) return false
  const stem = path.basename(exe.path).replace(/(?:-32)?\.exe$/i, '')
  try {
    return (
      fs.statSync(safePath(root, 'renpy')).isDirectory() &&
      fs.statSync(safePath(root, stem + '.py')).isFile() &&
      pe.findMarkers(exe.path, ['librenpython.dll']).has('librenpython.dll')
    )
  } catch {
    return false
  }
}

export async function refineCandidates(
  root,
  candidates,
  { processes = snapshotGameProcesses, now = Date.now(), processRows } = {}
) {
  const entries = candidates.filter((exe) => engineEntry(root, exe))
  const hasLogs = [...new Set([root, ...candidates.map((exe) => path.dirname(exe.path))])].some(
    (dir) => {
      try {
        return fs.readdirSync(dir).some((name) => /^ReShade\d*\.log$/i.test(name))
      } catch {
        return false
      }
    }
  )
  let rows = processRows === undefined ? null : processRows
  if (processRows === undefined && (hasLogs || entries.length)) {
    try {
      rows = await processes(root, candidates[0]?.path)
    } catch {
      /* Without process identity, retain candidates rather than reuse an old launch. */
    }
  }
  for (const exe of candidates) {
    exe.role = entries.includes(exe)
      ? 'engine-entry'
      : /^(?:pythonw?|javaw?|node)\.exe$/i.test(exe.name)
        ? 'interpreter'
        : exe.role || 'unknown'
    exe.apiCandidates ||= exe.api ? [{ api: exe.api, label: exe.apiLabel }] : []
    exe.apiEvidence = {
      source: exe.via || 'undetected',
      confidence: exe.apiCandidates.length > 1 ? 'ambiguous' : exe.api ? 'static' : 'unknown'
    }
    if (!entries.includes(exe)) continue
    const libraries = candidates
      .filter((item) => item.role === 'interpreter' || /pythonw?\.exe$/i.test(item.name))
      .filter((item) => item.bitness === exe.bitness)
    exe.apiCandidates = [
      ...new Map(
        libraries.flatMap((item) => item.apiCandidates || []).map((item) => [item.label, item])
      ).values()
    ]
    exe.api = null
    exe.apiLabel = null
    exe.dx12 = false
    exe.apiEvidence = {
      source: 'engine-entry',
      confidence: exe.apiCandidates.length > 1 ? 'ambiguous' : 'unknown'
    }
    // The engine supports several backends. Only this instance's recent log
    // can select one automatically; simply finding libEGL is insufficient.
    const stat = fs.statSync(exe.path)
    const since =
      Math.max(
        stat.mtimeMs,
        ...libraries
          .flatMap((item) => [item.path, item.evidenceFile].filter(Boolean))
          .map((file) => fs.statSync(file).mtimeMs)
      ) - 2000
    // Ren'Py's shared root log does not identify the EXE/bitness. If several
    // launchers share it, it cannot select a backend for each of them.
    if (!rows || entries.length !== 1 || rows.some((row) => !row.exe && !row.readable)) continue
    const running = rows.filter((row) => row.exe && pathKey(row.exe) === pathKey(exe.path))
    if (
      running.length > 1 ||
      running.some((row) => !row.readable || !Number.isFinite(Date.parse(row.startedAt)))
    )
      continue
    const log = readTechnicalLog(root, 'log.txt', { since, now })
    if (!log?.text || !/^Ren'Py [\d.]+/m.test(log.text)) continue
    const stamp = log.text.match(/^(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z| UTC))/m)?.[1]
    const time = Date.parse(stamp?.replace(' UTC', 'Z').replace(' ', 'T') || '')
    if (
      !Number.isFinite(time) ||
      time < since ||
      time > now + 60000 ||
      now - time > LOG_MAX_AGE ||
      (running.length &&
        !isCurrentSession(time, Date.parse(running[0].startedAt), log.modifiedAt, now))
    )
      continue
    const initialization = [...log.text.matchAll(/^Initializing (\w+) renderer:/gm)].at(-1)
    const renderer = initialization?.[1]
    // ANGLE may choose DX9 or DX11 at runtime: its name alone is ambiguous.
    const session = initialization ? log.text.slice(initialization.index) : ''
    const angleApi = /^Renderer:.*ANGLE.*Direct3D(9|11)/im.exec(session)?.[1]
    if (['gl', 'gl2'].includes(renderer)) {
      exe.api = 'opengl'
      exe.apiLabel = 'OpenGL'
    } else if (['angle', 'angle2'].includes(renderer) && angleApi) {
      exe.api = angleApi === '11' ? 'dxgi' : 'd3d9'
      exe.apiLabel = angleApi === '11' ? 'DirectX 11' : 'DirectX 9'
    } else continue
    exe.dx12 = false
    exe.apiEvidence = {
      source: 'engine-log',
      confidence: 'observed',
      file: log.rel,
      observedAt: time,
      scope: running.length === 1 ? 'current' : 'historical'
    }
  }
  if (hasLogs && rows)
    for (const exe of candidates) {
      try {
        reshadeObservation(root, exe, rows, now)
      } catch {
        /* A concurrently updated executable invalidates only its observation. */
      }
    }
  // Interpreter binaries can provide engine evidence but are not deployment targets.
  candidates.splice(0, candidates.length, ...candidates.filter((exe) => exe.role !== 'interpreter'))
  if (entries.length)
    candidates.sort(
      (a, b) =>
        Number(entries.includes(b)) - Number(entries.includes(a)) ||
        (entries.includes(a) && entries.includes(b) ? b.bitness - a.bitness : 0)
    )
  return candidates
}
