import path from 'path'

import {
  getSourceDefaultExtension,
  normalizeSourcePlatform
} from '../../../shared/sources/source-platform-registry.js'

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

const WINDOWS_ILLEGAL_CHAR_PATTERN = /[<>:"/\\|?*]/g
const WHITESPACE_RUN_PATTERN = /\s+/g
const MAX_FILE_NAME_LENGTH = 200
const SAFE_EXTENSION_PATTERN = /^\.(?:[a-z][a-z0-9]{0,9}|7z)$/i
const SAFE_FILE_TYPE_PATTERN = /^[a-z0-9]{1,10}$/i
const UNKNOWN_FILE_TYPES = new Set(['', 'unknown', 'undefined', 'null', '未知', '其他'])
const KNOWN_DOWNLOAD_EXTENSIONS = new Set([
  '.zip',
  '.smod',
  '.var',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.exe',
  '.msi',
  '.msix',
  '.appx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.ico',
  '.pdf',
  '.txt',
  '.json',
  '.xml',
  '.mp3',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.mkv'
])

const FILE_TYPE_EXTENSION_MAP = Object.freeze({
  zip: '.zip',
  smod: '.smod',
  var: '.var',
  rar: '.rar',
  '7z': '.7z',
  exe: '.exe',
  msi: '.msi',
  msix: '.msix',
  appx: '.appx',
  png: '.png',
  jpg: '.jpg',
  jpeg: '.jpeg',
  webp: '.webp',
  gif: '.gif',
  bmp: '.bmp',
  svg: '.svg',
  ico: '.ico'
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function resolveUrlBasename(url = '') {
  const safeUrl = toSafeText(url)
  if (!safeUrl) return ''

  try {
    const basename = path.basename(new URL(safeUrl).pathname) || ''
    try {
      return decodeURIComponent(basename)
    } catch {
      return basename
    }
  } catch {
    return ''
  }
}

function resolveFallbackName(task = {}) {
  const identity =
    toSafeText(task?.sourceModId) ||
    toSafeText(task?.modReference) ||
    toSafeText(task?.packageFullName) ||
    toSafeText(task?.name) ||
    toSafeText(task?.displayName) ||
    toSafeText(task?.modName) ||
    toSafeText(task?.task_name)
  const version = toSafeText(task?.version)

  if (!identity) return ''
  return version ? `${identity}-${version}` : identity
}

function resolveExplicitFileName(task = {}) {
  const candidates = [
    task?.preferredFileName,
    task?.fileName,
    task?.filename,
    task?.archiveName,
    task?.sourceFileName,
    task?.downloadFileName
  ]
  return candidates.map(toSafeText).find(Boolean) || ''
}

export function sanitizeWindowsFileName(name = '') {
  let text = toSafeText(name)
  if (!text) return ''

  text = text.replace(WINDOWS_ILLEGAL_CHAR_PATTERN, '')
  text = [...text].filter((character) => character.charCodeAt(0) > 31).join('')
  text = text.replace(WHITESPACE_RUN_PATTERN, ' ').trim()
  text = text.replace(/[. ]+$/g, '')
  if (!text) return ''

  const extension = path.extname(text)
  const baseName = extension ? text.slice(0, -extension.length) : text
  if (WINDOWS_RESERVED_NAMES.has(baseName.toUpperCase())) {
    text = `${baseName}_${extension}`
  }

  if (text.length > MAX_FILE_NAME_LENGTH) {
    const safeExtension = path.extname(text)
    const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - safeExtension.length)
    text = `${text.slice(0, -safeExtension.length || undefined).slice(0, maxBaseLength)}${safeExtension}`
  }

  return text.replace(/[. ]+$/g, '')
}

export function resolveFileTypeExtension(task = {}) {
  const rawFileType = toSafeText(task?.file_type || task?.fileType)
    .replace(/^\./, '')
    .toLowerCase()
  if (!UNKNOWN_FILE_TYPES.has(rawFileType)) {
    const mappedExtension = FILE_TYPE_EXTENSION_MAP[rawFileType]
    if (mappedExtension) return mappedExtension
    if (SAFE_FILE_TYPE_PATTERN.test(rawFileType)) return `.${rawFileType}`
  }

  const sourcePlatform = normalizeSourcePlatform(task?.sourcePlatform)
  return getSourceDefaultExtension(sourcePlatform) || ''
}

export function ensureFileExtension(fileName = '', task = {}) {
  const safeFileName = toSafeText(fileName)
  if (!safeFileName) return ''

  const existingExtension = path.extname(safeFileName)
  if (SAFE_EXTENSION_PATTERN.test(existingExtension)) return safeFileName

  const desiredExtension = resolveFileTypeExtension(task)
  if (desiredExtension) return `${safeFileName}${desiredExtension}`

  return safeFileName
}

export function resolveDownloadFileName(task = {}, options = {}) {
  const explicitFileName = resolveExplicitFileName(task)
  const itemFileName = toSafeText(options?.downloadItem?.getFilename?.())
  const urlFileName = resolveUrlBasename(task?.download_url)
  const fallbackName = resolveFallbackName(task)
  const rawFileName =
    explicitFileName ||
    itemFileName ||
    urlFileName ||
    fallbackName ||
    `download_${options.now || Date.now()}`
  const source = explicitFileName
    ? 'explicit'
    : itemFileName
      ? 'remote'
      : urlFileName
        ? 'url'
        : 'fallback'
  const sanitizedFileName = sanitizeWindowsFileName(rawFileName)
  const fileName =
    ensureFileExtension(sanitizedFileName, task) || `download_${options.now || Date.now()}`
  const fileExt = SAFE_EXTENSION_PATTERN.test(path.extname(fileName)) ? path.extname(fileName) : ''
  const isAuthoritative =
    source === 'explicit' ||
    source === 'remote' ||
    !!resolveFileTypeExtension(task) ||
    KNOWN_DOWNLOAD_EXTENSIONS.has(fileExt.toLowerCase())

  return {
    fileName,
    fileExt,
    isAuthoritative,
    source
  }
}

export function buildAria2FileNameOptions(task = {}) {
  const allowRemoteFileName = task?.allowRemoteFileName === true
  return {
    ...(allowRemoteFileName ? {} : { out: path.basename(toSafeText(task?.finalFilePath)) }),
    'auto-file-renaming': allowRemoteFileName ? 'true' : 'false',
    'content-disposition': 'true'
  }
}
