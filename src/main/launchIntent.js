import fs from 'fs'
import path from 'path'
import { isOfflinePackFilePath } from '../shared/modpacks/offline-pack-contract.js'

export function normalizeLaunchArg(value = '') {
  return String(value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
}

export function findSupportedProtocolUrl(commandLine = []) {
  for (const arg of commandLine) {
    const protocolUrl = normalizeLaunchArg(arg)
    if (/^vertex:\/\//i.test(protocolUrl) || /^nxm:\/\//i.test(protocolUrl)) {
      return protocolUrl
    }
  }
  return ''
}

function isExistingFilePath(value = '') {
  const candidate = normalizeLaunchArg(value)
  if (!candidate || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false
  if (!path.isAbsolute(candidate)) return false

  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function normalizeExistingFilePath(value = '') {
  return path.resolve(normalizeLaunchArg(value))
}

export function resolveLaunchIntent(argv = [], options = {}) {
  const commandLine = Array.isArray(argv) ? argv : []
  const protocolUrl = findSupportedProtocolUrl(commandLine)
  if (protocolUrl) {
    return {
      type: 'protocol',
      url: protocolUrl
    }
  }

  for (let index = 0; index < commandLine.length; index += 1) {
    const arg = normalizeLaunchArg(commandLine[index])
    if (!arg) continue

    if (arg === '--install-pack') {
      const nextArg = commandLine[index + 1]
      if (isExistingFilePath(nextArg) && isOfflinePackFilePath(normalizeLaunchArg(nextArg))) {
        return {
          type: 'offline-pack',
          filePath: normalizeExistingFilePath(nextArg)
        }
      }
      continue
    }

    const installPackInlineMatch = arg.match(/^--install-pack=(.+)$/i)
    if (
      installPackInlineMatch?.[1] &&
      isExistingFilePath(installPackInlineMatch[1]) &&
      isOfflinePackFilePath(normalizeLaunchArg(installPackInlineMatch[1]))
    ) {
      return {
        type: 'offline-pack',
        filePath: normalizeExistingFilePath(installPackInlineMatch[1])
      }
    }
  }

  const skipInitialArgs = Math.max(0, Number(options.skipInitialArgs ?? 1) || 0)
  for (let index = skipInitialArgs; index < commandLine.length; index += 1) {
    const arg = normalizeLaunchArg(commandLine[index])
    if (!arg || arg.startsWith('-')) continue
    if (isExistingFilePath(arg)) {
      if (isOfflinePackFilePath(arg)) {
        return {
          type: 'offline-pack',
          filePath: normalizeExistingFilePath(arg)
        }
      }
    }
  }

  return {
    type: 'main'
  }
}

export function normalizeLaunchIntent(input = null, argv = [], options = {}) {
  if (input?.type === 'protocol' && input.url) {
    return {
      type: 'protocol',
      url: normalizeLaunchArg(input.url)
    }
  }
  if (
    input?.type === 'offline-pack' &&
    input.filePath &&
    isExistingFilePath(input.filePath) &&
    isOfflinePackFilePath(input.filePath)
  ) {
    return {
      type: 'offline-pack',
      filePath: normalizeExistingFilePath(input.filePath)
    }
  }
  return resolveLaunchIntent(argv, options)
}
