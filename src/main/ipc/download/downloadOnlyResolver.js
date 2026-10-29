import path from 'path'

import { normalizeSourcePlatform } from '../../../shared/sources/source-platform-registry.js'
import {
  ensureFileExtension,
  resolveDownloadFileName,
  sanitizeWindowsFileName
} from './fileNameResolver.js'

const DOWNLOAD_ONLY_PURPOSE = 'download_only'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function isDownloadOnlyTask(task = {}) {
  if (!task || typeof task !== 'object') return false
  if (Number(task.saveType) !== 2) return false
  if (task.downloadPurpose !== DOWNLOAD_ONLY_PURPOSE) return false
  const sourcePlatform = toSafeText(task.sourcePlatform)
  if (!sourcePlatform) return false
  return true
}

export function resolveDownloadOnlyGameSegment(task = {}) {
  const candidates = [
    task?.sourceGameId,
    task?.sourceGameSlug,
    task?.gameId,
    task?.gameSourceId,
    task?.sourceSlug,
    task?.nexusGameId,
    task?.modioGameId
  ]

  for (const candidate of candidates) {
    const value = toSafeText(candidate)
    if (value) return sanitizeWindowsFileName(value)
  }

  return 'unknown'
}

export function resolveDownloadOnlyFileName(task = {}, downloadItem = null) {
  return resolveDownloadFileName(task, { downloadItem }).fileName
}

export function resolveDownloadOnlySaveDirectory(task = {}, configuredDownloadPath = '') {
  const basePath = toSafeText(configuredDownloadPath)
  const resolvedBase = basePath ? path.resolve(basePath) : ''

  const sourcePlatform =
    normalizeSourcePlatform(task?.sourcePlatform) || toSafeText(task?.sourcePlatform) || 'unknown'
  const gameSegment = resolveDownloadOnlyGameSegment(task)

  const segments = ['Mod', sourcePlatform, gameSegment].map(
    (segment) => sanitizeWindowsFileName(segment) || 'unknown'
  )

  return path.join(resolvedBase, ...segments)
}

export function buildDownloadOnlyFinalPath(task = {}, configuredDownloadPath = '') {
  const rawFileName = resolveDownloadOnlyFileName(task)
  const sanitizedFileName = sanitizeWindowsFileName(rawFileName)
  const finalFileName = ensureFileExtension(sanitizedFileName, task) || `download_${Date.now()}`
  const directory = resolveDownloadOnlySaveDirectory(task, configuredDownloadPath)
  return path.join(directory, finalFileName)
}
