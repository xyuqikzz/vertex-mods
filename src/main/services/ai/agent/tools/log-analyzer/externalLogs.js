// 外部日志授权、真实路径检查与限量读取。
import path from 'node:path'
import {
  toSafeText,
  toSafeBoolean,
  toSafeNumber,
  truncateText,
  isProblemLog,
  inferLogLevelFromText
} from './values.js'
import os from 'node:os'
import fs from 'node:fs/promises'
import { resolveLogAccess } from '../../logAccess.js'
import { resolveAllowedLogPath } from '../../pathAccess.js'

const MAX_EXTERNAL_LOG_FILES = 5

const MAX_EXTERNAL_LOG_LINES_PER_FILE = 120

const MAX_EXTERNAL_LOG_SAMPLES = 80

const MAX_EXTERNAL_LOG_BYTES = 256 * 1024

const LOG_FILE_EXTENSIONS = Object.freeze(new Set(['.log', '.txt']))

const DEFAULT_APP_NAME = 'Vertex'

export function normalizePathList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set()
  const result = []
  for (const item of values) {
    const text = toSafeText(item)
    if (!text) continue
    const resolved = path.resolve(text)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}

export function getDefaultAppDataPath(overrides = {}) {
  const explicit = toSafeText(overrides.appDataPath || overrides.userPath)
  if (explicit) return path.resolve(explicit)
  const appName = toSafeText(process.env.VITE_LOCAL_NAME, DEFAULT_APP_NAME)
  const appId = toSafeText(process.env.VITE_LOCAL_ID)
  const localName = `${appName}${appId ? `_${appId}` : ''}`
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      localName
    )
  }
  return path.join(os.homedir(), '.local', 'share', localName)
}

function collectDefaultClientLogPaths(overrides = {}) {
  const appDataPath = getDefaultAppDataPath(overrides)
  return [
    path.join(appDataPath, 'logs', 'main.log'),
    path.join(appDataPath, 'logs', 'renderer.log'),
    path.join(appDataPath, 'logs', 'app.log'),
    path.join(appDataPath, 'log', 'main.log'),
    path.join(appDataPath, 'log', 'renderer.log'),
    path.join(appDataPath, 'Vertex.log')
  ]
}

function createLogCandidate(filePath = '', sourceType = 'explicit') {
  const resolved = path.resolve(filePath)
  return {
    filePath: resolved,
    sourceType: toSafeText(sourceType, 'explicit')
  }
}

function collectRequestedLogCandidates(args = {}, overrides = {}) {
  const includeClientLogs = toSafeBoolean(args.includeClientLogs ?? args.include_client_logs, true)
  const candidates = []
  for (const filePath of normalizePathList([
    ...normalizePathList(args.logPath || args.log_path),
    ...normalizePathList(args.logPaths || args.log_paths)
  ])) {
    candidates.push(createLogCandidate(filePath, 'explicit'))
  }
  for (const filePath of normalizePathList(args.clientLogPaths || args.client_log_paths)) {
    candidates.push(createLogCandidate(filePath, 'client'))
  }
  for (const filePath of normalizePathList(args.gameLogPaths || args.game_log_paths)) {
    candidates.push(createLogCandidate(filePath, 'game'))
  }
  if (includeClientLogs) {
    for (const filePath of collectDefaultClientLogPaths(overrides)) {
      candidates.push(createLogCandidate(filePath, 'client'))
    }
  }

  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = process.platform === 'win32' ? candidate.filePath.toLowerCase() : candidate.filePath
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readTailText(filePath = '', maxBytes = MAX_EXTERNAL_LOG_BYTES) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, maxBytes)
    const start = Math.max(0, stat.size - length)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    return {
      text: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > length
    }
  } finally {
    await handle.close()
  }
}

function parseExternalLogSamples(candidate = {}, text = '', options = {}) {
  const includeInfoLogs = toSafeBoolean(options.includeInfoLogs, false)
  const lineLimit = Math.max(
    1,
    Math.min(
      MAX_EXTERNAL_LOG_LINES_PER_FILE,
      toSafeNumber(options.lineLimit, MAX_EXTERNAL_LOG_LINES_PER_FILE)
    )
  )
  const lines = toSafeText(text)
    .split(/\r?\n/)
    .map((line, index) => ({
      line,
      lineNumber: index + 1
    }))
    .filter((item) => toSafeText(item.line))
  const tailLines = lines.slice(-lineLimit)
  const samples = []
  for (const item of tailLines) {
    const level = inferLogLevelFromText(item.line)
    const sample = {
      sourceType: candidate.sourceType,
      filePath: candidate.filePath,
      lineNumber: item.lineNumber,
      level,
      message: truncateText(item.line, 800)
    }
    if (includeInfoLogs || isProblemLog(sample)) {
      samples.push(sample)
    }
  }
  return {
    lineCount: lines.length,
    samples
  }
}

export async function collectExternalLogSamples(args = {}, dependencyOverrides = {}) {
  const warnings = []
  const sources = []
  const samples = []
  const candidates = collectRequestedLogCandidates(args, dependencyOverrides)
  const access =
    dependencyOverrides.logAccess ||
    (await resolveLogAccess(
      getDefaultAppDataPath(dependencyOverrides),
      {},
      {},
      dependencyOverrides
    ))
  const maxFiles = Math.max(1, Math.min(MAX_EXTERNAL_LOG_FILES, toSafeNumber(args.logFileLimit, 5)))
  const sampleLimit = Math.max(
    1,
    Math.min(
      MAX_EXTERNAL_LOG_SAMPLES,
      toSafeNumber(args.externalLogLimit || args.external_log_limit || args.logLimit, 50)
    )
  )
  let fileCount = 0

  for (const candidate of candidates) {
    if (fileCount >= maxFiles || samples.length >= sampleLimit) break
    const ext = path.extname(candidate.filePath).toLowerCase()
    if (!LOG_FILE_EXTENSIONS.has(ext)) {
      warnings.push({
        filePath: candidate.filePath,
        sourceType: candidate.sourceType,
        reason: 'unsupported_extension'
      })
      continue
    }

    let stat
    let authorizedPath
    try {
      authorizedPath = await resolveAllowedLogPath(candidate.filePath, access)
      stat = await fs.stat(authorizedPath)
    } catch (error) {
      if (candidate.sourceType !== 'client' || error?.code === 'log_path_not_authorized') {
        warnings.push({
          filePath: candidate.filePath,
          sourceType: candidate.sourceType,
          reason:
            error?.code === 'log_path_not_authorized' ? 'log_path_not_authorized' : 'not_found'
        })
      }
      continue
    }
    if (!stat.isFile()) {
      warnings.push({
        filePath: candidate.filePath,
        sourceType: candidate.sourceType,
        reason: 'not_file'
      })
      continue
    }

    try {
      const { text, size, truncated } = await readTailText(authorizedPath)
      const parsed = parseExternalLogSamples(candidate, text, {
        includeInfoLogs: args.includeInfoLogs || args.include_info_logs,
        lineLimit: args.externalLogLineLimit || args.external_log_line_limit
      })
      const nextSamples = parsed.samples.slice(0, sampleLimit - samples.length)
      samples.push(...nextSamples)
      sources.push({
        sourceType: candidate.sourceType,
        filePath: candidate.filePath,
        size,
        lineCount: parsed.lineCount,
        sampleCount: nextSamples.length,
        truncated
      })
      fileCount += 1
    } catch (error) {
      warnings.push({
        filePath: candidate.filePath,
        sourceType: candidate.sourceType,
        reason:
          error?.code === 'log_path_not_authorized' ? 'log_path_not_authorized' : 'read_failed',
        message: truncateText(error?.message, 200)
      })
    }
  }

  return {
    samples,
    sources,
    warnings
  }
}
