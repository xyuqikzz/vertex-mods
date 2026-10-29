import { app } from 'electron'
import path from 'path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PROTOCOL_TARGET_REGEXP = /^[a-z][a-z0-9+.-]*:\/\//i

const addonCache = {
  process: null,
  file: null,
  system: null
}

function getNodeApiPath(apiName) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'node', `${apiName}.node`)
  }
  return path.join(__dirname, '..', '..', 'resources', 'node', `${apiName}.node`)
}

function getFallbackNodeApiPath(apiName) {
  return path.join(__dirname, '..', '..', '..', 'resources', 'node', `${apiName}.node`)
}

function loadNodeApi(domain, apiName, cacheKey) {
  if (addonCache[cacheKey]) {
    return addonCache[cacheKey]
  }

  const apiNameList = Array.isArray(apiName) ? apiName : [apiName]
  const loadErrors = []

  for (const currentApiName of apiNameList) {
    const primaryPath = getNodeApiPath(currentApiName)
    try {
      addonCache[cacheKey] = require(primaryPath)
      return addonCache[cacheKey]
    } catch (error) {
      loadErrors.push(`主路径 ${currentApiName}: ${error?.message || error}`)
    }

    try {
      addonCache[cacheKey] = require(getFallbackNodeApiPath(currentApiName))
      return addonCache[cacheKey]
    } catch (fallbackError) {
      loadErrors.push(`备用路径 ${currentApiName}: ${fallbackError?.message || fallbackError}`)
    }
  }

  throw new Error(
    `无法加载 Vertex ${apiNameList.join(' / ')} Node-API：${loadErrors.join('；')}`
  )
}

function pickWindowsPathFromText(text = '') {
  const matchList = String(text || '').match(/[A-Za-z]:\\[^\r\n"'<>|?*]+/g)
  if (!matchList || !matchList.length) return ''
  return String(matchList[matchList.length - 1] || '').trim()
}

function normalizeLegacyPath(targetPath = '') {
  return String(targetPath || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/\\$/, '')
}

function createLegacyNode(node, parentPath) {
  const currentPath = normalizeLegacyPath(path.join(parentPath, String(node?.name || '')))
  const isDirectory = String(node?.type || '') === 'directory'
  const childList = Array.isArray(node?.children)
    ? node.children.map((child) => createLegacyNode(child, currentPath))
    : []

  return {
    path: currentPath,
    type: isDirectory ? 0 : 1,
    name: String(node?.name || ''),
    sub: isDirectory ? childList : undefined
  }
}

function isEventLike(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    ((value.sender && typeof value.sender.send === 'function') || typeof value.reply === 'function')
  )
}

export function isProtocolTarget(target = '') {
  return PROTOCOL_TARGET_REGEXP.test(String(target || '').trim())
}

export function getVertexProcessNodeApi() {
  return loadNodeApi('process', 'process_api', 'process')
}

export function getVertexFileNodeApi() {
  return loadNodeApi('file', ['file_api_v3', 'file_api_v2', 'file_api'], 'file')
}

export function emitProgressEvent(event, channel, payload) {
  if (!event || !channel) {
    return
  }

  try {
    const sender = event.sender || event
    if (sender && typeof sender.send === 'function') {
      sender.send(channel, payload)
      return
    }

    if (typeof event.reply === 'function') {
      event.reply(channel, payload)
    }
  } catch {
    // 忽略进度发送失败，避免影响主流程。
  }
}

export function formatExtractErrorMessage(error) {
  const message = String(error?.message || '')
  const stderr = String(error?.stderr || '')
  const fullText = `${message}\n${stderr}`

  if (/Cannot delete output file/i.test(fullText)) {
    const lockedPath = pickWindowsPathFromText(fullText)
    if (lockedPath) {
      return `解压失败：无法覆盖文件 ${lockedPath}，该文件可能被占用。请先关闭游戏和相关进程后重试。`
    }
    return '解压失败：目标文件正在被占用，无法覆盖。请先关闭游戏和相关进程后重试。'
  }

  if (/Access is denied|EACCES|EPERM/i.test(fullText)) {
    const deniedPath = pickWindowsPathFromText(fullText)
    if (deniedPath) {
      return `解压失败：没有权限写入 ${deniedPath}，请以管理员权限运行或检查目录权限。`
    }
    return '解压失败：没有权限写入目标目录，请以管理员权限运行或检查目录权限。'
  }

  if (/wrong password|password is incorrect|can not open encrypted archive/i.test(fullText)) {
    return '压缩包已加密，需要正确密码'
  }

  return `解压失败: ${message || '未知错误'}`
}

export function buildLegacyStructure(tree = [], rootPath = '') {
  const normalizedRootPath = normalizeLegacyPath(path.resolve(String(rootPath || '')))
  return [
    {
      path: normalizedRootPath,
      type: 0,
      name: path.basename(normalizedRootPath),
      sub: Array.isArray(tree) ? tree.map((item) => createLegacyNode(item, normalizedRootPath)) : []
    }
  ]
}

export function resolveExecutableRun(structure = []) {
  const runnablePaths = []
  const runnableExtSet = new Set(['.exe', '.bat'])

  function walk(nodes) {
    nodes.forEach((item) => {
      const ext = path.extname(String(item?.name || '')).toLowerCase()
      if (Number(item?.type) === 1 && runnableExtSet.has(ext)) {
        runnablePaths.push(String(item.path || ''))
      }
      if (Array.isArray(item?.sub) && item.sub.length > 0) {
        walk(item.sub)
      }
    })
  }

  walk(Array.isArray(structure) ? structure : [])

  if (runnablePaths.length === 0) {
    return { type: 0, path: '', paths: [] }
  }

  if (runnablePaths.length === 1) {
    return { type: 1, path: runnablePaths[0], paths: [] }
  }

  return { type: 2, path: '', paths: runnablePaths }
}

export function normalizeFileOptions(options = {}) {
  const target = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const password = String(target.password || '').trim()
  return {
    overwrite: target.overwrite === true,
    password,
    progressChannel: String(target.progressChannel || '').trim()
  }
}

export function resolveFileOptionsAndEvent(thirdArg, fourthArg) {
  if (isEventLike(thirdArg)) {
    return {
      options: {},
      event: thirdArg
    }
  }

  return {
    options: thirdArg && typeof thirdArg === 'object' && !Array.isArray(thirdArg) ? thirdArg : {},
    event: isEventLike(fourthArg) ? fourthArg : null
  }
}

export function isArchiveEncrypted(inspectResult) {
  return Array.isArray(inspectResult?.entries)
    ? inspectResult.entries.some((entry) => entry?.encrypted === true)
    : false
}

export function buildEncryptedArchiveMessage(archiveType = '') {
  const normalizedType = String(archiveType || '')
    .trim()
    .toLowerCase()
  if (normalizedType === 'zip') return 'ZIP文件已加密，需要密码'
  if (normalizedType === 'rar' || normalizedType === 'rar5') return 'RAR文件已加密，需要密码'
  if (normalizedType === '7z') return '7Z文件已加密，需要密码'
  return '压缩包已加密，需要密码'
}
