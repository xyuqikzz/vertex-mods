import path from 'path'
import fs from 'fs-extra'
import { getVertexFileNodeApi } from '../api/shared/index.js'

const fileApi = getVertexFileNodeApi()

function ensureNativeMethod(methodName) {
  if (!fileApi || typeof fileApi[methodName] !== 'function') {
    throw new Error(`Vertex file_api 未提供原生方法：${methodName}`)
  }
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeComparablePath(filePath = '') {
  const text = String(filePath || '').trim()
  if (!text) {
    return ''
  }

  return path.resolve(text).replace(/\//g, '\\').toLowerCase()
}

function normalizeLegacyPath(targetPath = '') {
  return String(targetPath || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/\\$/, '')
}

function isExistingFile(filePath = '') {
  const safePath = String(filePath || '').trim()
  if (!safePath) {
    return false
  }

  try {
    return fs.existsSync(safePath) && fs.statSync(safePath).isFile()
  } catch {
    return false
  }
}

export function collectStructureFilePaths(structure = []) {
  const result = []
  const stack = [...toSafeArray(structure)]

  while (stack.length > 0) {
    const current = stack.pop()
    const node = current && typeof current === 'object' ? current : {}
    const nodePath = String(node?.path || '').trim()
    const nodeType = Number(node?.type || 0)

    if (nodeType === 1 && nodePath) {
      result.push(nodePath)
    }

    const children = Array.isArray(node?.sub) ? node.sub : []
    for (const child of children) {
      stack.push(child)
    }
  }

  return result
}

export function normalizeExistingFilePathList(filePaths = []) {
  const safeList = toSafeArray(filePaths)
  const seen = new Set()
  const result = []

  for (const item of safeList) {
    const filePath = String(item || '').trim()
    if (!filePath || !isExistingFile(filePath)) {
      continue
    }

    const resolvedPath = path.resolve(filePath)
    const compareKey = normalizeComparablePath(resolvedPath)
    if (!compareKey || seen.has(compareKey)) {
      continue
    }

    seen.add(compareKey)
    result.push(normalizeLegacyPath(resolvedPath))
  }

  return result
}

export function inspectFileOccupancy(filePaths = []) {
  ensureNativeMethod('prepareModUninstall')

  const normalizedFiles = normalizeExistingFilePathList(filePaths)
  if (!normalizedFiles.length) {
    return {
      totalCount: 0,
      scannedFiles: [],
      occupiedFiles: [],
      hasOccupiedFiles: false
    }
  }

  const payload = normalizedFiles.map((filePath) => {
    const parentPath = normalizeLegacyPath(path.dirname(filePath))
    return {
      path: parentPath,
      type: 0,
      name: path.basename(parentPath) || parentPath,
      sub: [
        {
          path: filePath,
          type: 1,
          name: path.basename(filePath) || filePath
        }
      ]
    }
  })

  const result = fileApi.prepareModUninstall(payload) || {}
  const occupiedFiles = normalizeExistingFilePathList(result?.occupiedFiles || [])

  return {
    totalCount: normalizedFiles.length,
    scannedFiles: normalizedFiles,
    occupiedFiles,
    hasOccupiedFiles: occupiedFiles.length > 0
  }
}

export function buildOccupiedFilesMessage(occupiedFiles = []) {
  const count = normalizeExistingFilePathList(occupiedFiles).length
  if (count <= 0) {
    return ''
  }

  return `检测到 ${count} 个模组文件被占用，请关闭游戏后重试`
}
