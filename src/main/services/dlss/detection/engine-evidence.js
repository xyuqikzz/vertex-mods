import fs from 'node:fs'
import path from 'node:path'
import { ownedPath, pathKey } from './executables.js'
import { isCurrentSession } from './session.js'

const LIMIT = 1024 * 1024
const MAX_AGE = 7 * 24 * 3600000
const apiName = (value) =>
  ({
    dx11: 'd3d11',
    dx12: 'd3d12',
    d3d11: 'd3d11',
    d3d12: 'd3d12',
    vulkan: 'vulkan',
    opengl: 'opengl',
    openglcore: 'opengl'
  })[String(value).toLowerCase()] || null

export function requestedApi(argumentsList, engine) {
  const aliases =
    engine === 'unity'
      ? {
          '-force-d3d11': 'd3d11',
          '-force-d3d12': 'd3d12',
          '-force-vulkan': 'vulkan',
          '-force-glcore': 'opengl',
          '-force-opengl': 'opengl'
        }
      : engine === 'unreal'
        ? {
            '-dx11': 'd3d11',
            '-d3d11': 'd3d11',
            '-dx12': 'd3d12',
            '-d3d12': 'd3d12',
            '-vulkan': 'vulkan',
            '-opengl': 'opengl',
            '-opengl4': 'opengl'
          }
        : {}
  const apis = [
    ...new Set(
      (argumentsList || []).map((arg) => aliases[String(arg).toLowerCase()]).filter(Boolean)
    )
  ]
  return { api: apis.length === 1 ? apis[0] : null, conflict: apis.length > 1, apis }
}

function readBounded(file, root) {
  if (!ownedPath(root, file)) return null
  let fd
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return null
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(Math.min(stat.size, LIMIT))
    fs.readSync(fd, head, 0, head.length, 0)
    let tail = Buffer.alloc(0)
    if (stat.size > LIMIT) {
      tail = Buffer.alloc(Math.min(stat.size - LIMIT, LIMIT))
      fs.readSync(fd, tail, 0, tail.length, stat.size - tail.length)
    }
    const utf16 = head[0] === 0xff && head[1] === 0xfe
    const bigEndian = head[0] === 0xfe && head[1] === 0xff
    const decode = (bytes) => {
      const complete = bytes.subarray(0, bytes.length - (bytes.length % 2))
      return (
        bigEndian
          ? Buffer.from(complete).swap16().toString('utf16le')
          : utf16
            ? complete.toString('utf16le')
            : bytes.toString('utf8')
      ).replace(/^\uFEFF/, '')
    }
    return {
      text: decode(head),
      tail: decode(tail),
      partial: stat.size > LIMIT * 2,
      modifiedAt: stat.mtimeMs
    }
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function unrealSession(text) {
  const headers = [
    ...text.matchAll(/^Log file open,\s*(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})/gm)
  ]
  const header = headers.at(-1)
  if (!header) return null
  const [, month, day, year, hour, minute, second] = header
  const time = new Date(
    Number(year) < 100 ? 2000 + Number(year) : Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime()
  const session = text.slice(header.index)
  const base = session.match(/^.*LogInit:\s*Base Directory:\s*(.+)\r?$/m)?.[1]?.trim()
  return { time, base, text: session }
}

export function parseUnrealApi(text) {
  let api = null
  for (const line of text.split(/\r?\n/)) {
    const selected = line.match(
      /LogRHI:.*(?:Using (?:Default )?RHI|RHI Selected|Selected RHI)\s*[:=]\s*(D3D11|D3D12|Vulkan|OpenGL)\b/i
    )
    const adapter = line.match(/Log(D3D11|D3D12)RHI:\s*Chosen \1 Adapter\b/i)
    if (selected || adapter) api = apiName((selected || adapter)[1])
    // 初始化失败后，必须等到新的成功选择才能恢复结论。
    if (
      /Log(?:D3D\d+|Vulkan|OpenGL|)RHI:.*(?:Failed to initialize|Failed to create.*device|initialization failed)/i.test(
        line
      )
    )
      api = null
  }
  return api
}

function configurations(root, exe, localAppData) {
  if (exe.engine?.kind !== 'unreal') return []
  const engine = exe.engine
  const locations = [
    { root, file: path.join(engine.directory, 'Config/DefaultEngine.ini'), level: 0 },
    ...['Windows', 'WindowsNoEditor'].map((platform) => ({
      root,
      file: path.join(engine.directory, 'Saved/Config', platform, 'Engine.ini'),
      level: 1
    }))
  ]
  // 用户目录配置只有在日志明确对应当前安装实例时才可参与决策。
  if (localAppData)
    for (const platform of ['Windows', 'WindowsNoEditor'])
      locations.push({
        root: localAppData,
        file: path.join(localAppData, engine.project, 'Saved/Config', platform, 'Engine.ini'),
        level: 2,
        shared: true
      })
  return locations
}

function configApi(text) {
  let section = '',
    result
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]/)
    if (heading) {
      section = heading[1].toLowerCase()
      continue
    }
    if (section !== '/script/windowstargetplatform.windowstargetsettings') continue
    if (/^\s*DefaultGraphicsRHI\s*=/i.test(line)) result = null
    const match = line.match(
      /^\s*DefaultGraphicsRHI\s*=\s*DefaultGraphicsRHI_(DX11|DX12|Vulkan|OpenGL)\s*(?:[;#].*)?$/i
    )
    if (match) result = apiName(match[1])
  }
  return result
}

export function collectEngineEvidence(
  root,
  exe,
  rows,
  { now = Date.now(), localAppData = process.env.LOCALAPPDATA, peers = [] } = {}
) {
  const evidence = [],
    issues = []
  const engine = exe.engine
  if (!engine) return { evidence, issues }
  const related = [
    ...new Set(
      [
        exe.path,
        exe.evidenceFile,
        ...(exe.staticApiCandidates || []).flatMap((item) =>
          (item.sources || []).map((source) => source.file)
        )
      ].filter(Boolean)
    )
  ]
  const binaryModifiedAt = Math.max(
    exe.fingerprint?.modifiedAt || 0,
    ...related.map((file) => {
      try {
        return fs.statSync(file).mtimeMs
      } catch {
        return Infinity
      }
    })
  )
  const sharedExecutableDirectory =
    peers.filter((peer) => pathKey(path.dirname(peer.path)) === pathKey(path.dirname(exe.path)))
      .length > 1
  const running = (rows || []).filter((row) => row.exe && pathKey(row.exe) === pathKey(exe.path))
  const process = running.length === 1 ? running[0] : null
  const locations = []
  if (engine.kind === 'unreal') {
    locations.push({
      root,
      file: path.join(engine.directory, 'Saved/Logs', engine.project + '.log')
    })
    if (localAppData)
      locations.push({
        root: localAppData,
        file: path.join(localAppData, engine.project, 'Saved/Logs', engine.project + '.log'),
        shared: true
      })
  } else if (engine.kind === 'unity') {
    locations.push({ root, file: path.join(path.dirname(exe.path), 'Player.log') })
    const info = readBounded(path.join(engine.directory, 'app.info'), root)
      ?.text.trim()
      .split(/\r?\n/)
    if (
      localAppData &&
      info?.length === 2 &&
      info.every(
        (value) =>
          value && !/[\\/:.]/.test(value) && [...value].every((char) => char.charCodeAt(0) >= 32)
      )
    ) {
      const low = path.join(path.dirname(localAppData), 'LocalLow')
      locations.push({
        root: low,
        file: path.join(low, info[0], info[1], 'Player.log'),
        shared: true
      })
    }
  }
  let sharedOwned = false
  for (const location of locations) {
    const log = readBounded(location.file, location.root)
    if (!log) continue
    if (log.partial) issues.push('log_partial')
    if (engine.kind === 'unreal') {
      if (sharedExecutableDirectory) {
        issues.push('log_identity_unconfirmed')
        continue
      }
      const session = unrealSession(log.text)
      if (!session || !session.base || pathKey(session.base) !== pathKey(path.dirname(exe.path))) {
        issues.push('log_identity_unconfirmed')
        continue
      }
      if (log.tail && /Log file open,/.test(log.tail)) {
        issues.push('log_session_truncated')
        continue
      }
      if (
        !Number.isFinite(session.time) ||
        session.time < binaryModifiedAt - 2000 ||
        session.time > now + 60000 ||
        now - session.time > MAX_AGE
      ) {
        issues.push('log_stale')
        continue
      }
      sharedOwned = true
      const api = parseUnrealApi(session.text + (log.partial ? '' : '\n' + log.tail))
      if (!api) continue
      const start = process && Date.parse(process.startedAt)
      const current =
        !log.partial &&
        !!process?.readable &&
        isCurrentSession(session.time, start, log.modifiedAt, now)
      evidence.push({
        api,
        claim: 'initialized',
        scope: current ? 'current' : 'historical',
        source: 'engine-log',
        file: path.relative(location.root, location.file),
        observedAt: session.time,
        pid: current ? process.pid : null
      })
    } else {
      // Unity 日志的启动时间不统一；只在明确写有当前 EXE 和带日期的启动标记时提升为会话证据。
      const target = log.text
        .match(/(?:Executable|Player path)\s*:\s*["']?([^\r\n"']+)/i)?.[1]
        ?.trim()
      const stamp = log.text.match(
        /(?:Started|Startup time)\s*:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))/i
      )?.[1]
      const time = Date.parse(stamp || '')
      const managed = log.text.match(/^Mono path\[\d+\]\s*=\s*['"]([^'"\r\n]+)['"]/im)?.[1]
      const owned = target
        ? pathKey(target) === pathKey(exe.path)
        : managed && pathKey(path.dirname(managed)) === pathKey(engine.directory)
      const context = log.text.slice(Math.max(0, log.text.lastIndexOf('GfxDevice:')))
      const renderer = [
        ...context.matchAll(/(?:^\s*Version:\s*Direct3D\s*(11|12)\b|^(Vulkan|OpenGL)(?:\s|:))/gim)
      ].at(-1)
      const hintedApi = renderer?.[1] ? 'd3d' + renderer[1] : apiName(renderer?.[2])
      if (owned && (now - log.modifiedAt > MAX_AGE || log.modifiedAt < binaryModifiedAt))
        issues.push('log_stale')
      if (
        owned &&
        hintedApi &&
        !Number.isFinite(time) &&
        /Initialize engine version:/.test(log.text) &&
        log.text.includes('GfxDevice:') &&
        log.modifiedAt >= binaryModifiedAt &&
        now - log.modifiedAt <= MAX_AGE &&
        log.modifiedAt <= now + 60000
      ) {
        // 标准 Player.log 常无启动日期；记录来源明确的线索，不伪造会话时间或当前运行。
        evidence.push({
          api: hintedApi,
          claim: 'log-hint',
          scope: 'undated',
          source: 'engine-log',
          file: path.relative(location.root, location.file)
        })
      }
      if (
        !target ||
        pathKey(target) !== pathKey(exe.path) ||
        !Number.isFinite(time) ||
        time < binaryModifiedAt - 2000 ||
        now - time > MAX_AGE ||
        time > now + 60000 ||
        log.partial
      )
        continue
      const sessionText = log.text + '\n' + log.tail
      const api = [
        ...sessionText.matchAll(
          /(?:GfxDevice:.*?\b(Direct3D\s*11|Direct3D\s*12|Vulkan|OpenGL)|^(Direct3D\s*11|Direct3D\s*12|Vulkan|OpenGL):)/gim
        )
      ].at(-1)
      const value =
        hintedApi || apiName((api?.[1] || api?.[2] || '').replace(/Direct3D\s*/i, 'd3d'))
      if (!value) continue
      const current =
        !!process?.readable &&
        isCurrentSession(time, Date.parse(process.startedAt), log.modifiedAt, now)
      evidence.push({
        api: value,
        claim: 'initialized',
        scope: current ? 'current' : 'historical',
        source: 'engine-log',
        file: path.relative(location.root, location.file),
        observedAt: time
      })
    }
  }
  const configs = configurations(root, exe, localAppData)
    .filter((location) => !location.shared || sharedOwned)
    .map((location) => ({
      ...location,
      api: configApi(readBounded(location.file, location.root)?.text || '')
    }))
    .filter((item) => item.api !== undefined)
  const highest = Math.max(-1, ...configs.map((item) => item.level))
  for (const config of configs.filter((item) => item.level === highest)) {
    if (!config.api) {
      issues.push('configuration_unresolved')
      continue
    }
    evidence.push({
      api: config.api,
      claim: 'requested',
      scope: 'configuration',
      source: 'engine-config',
      file: path.relative(config.root, config.file)
    })
  }
  const requested = requestedApi(process?.renderArguments, engine.kind)
  if (requested.apis.length) {
    // 当前进程参数明确覆盖配置，但参数相互冲突时不猜测解析顺序。
    for (let i = evidence.length - 1; i >= 0; i--)
      if (evidence[i].claim === 'requested') evidence.splice(i, 1)
    for (const api of requested.apis)
      evidence.push({
        api,
        claim: 'requested',
        scope: 'current',
        source: 'process-arguments',
        pid: process.pid
      })
  }
  if (!rows) issues.push('process_unavailable')
  if (running.length > 1) issues.push('multiple_processes')
  return { evidence, issues }
}
