import fs from 'fs-extra'
import path from 'path'
import {
  buildEncryptedArchiveMessage,
  buildLegacyStructure,
  emitProgressEvent,
  formatExtractErrorMessage,
  getVertexFileNodeApi,
  isArchiveEncrypted,
  normalizeFileOptions,
  resolveExecutableRun,
  resolveFileOptionsAndEvent
} from '../shared/index.js'

export { getVertexFileNodeApi } from '../shared/index.js'

function inspectArchive(fileApi, safeFilePath, options = {}) {
  const normalizedOptions = normalizeFileOptions(options)
  const nativeOptions = normalizedOptions.password
    ? { password: normalizedOptions.password }
    : undefined

  return nativeOptions
    ? fileApi.inspectArchive(safeFilePath, nativeOptions)
    : fileApi.inspectArchive(safeFilePath)
}

function inspectArchiveAsync(fileApi, safeFilePath, options = {}) {
  if (!fileApi || typeof fileApi.inspectArchiveAsync !== 'function') {
    return Promise.resolve(inspectArchive(fileApi, safeFilePath, options))
  }

  const normalizedOptions = normalizeFileOptions(options)
  const nativeOptions = normalizedOptions.password
    ? { password: normalizedOptions.password }
    : undefined

  return new Promise((resolve, reject) => {
    try {
      const callback = (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result)
      }

      if (nativeOptions) {
        fileApi.inspectArchiveAsync(safeFilePath, callback, nativeOptions)
      } else {
        fileApi.inspectArchiveAsync(safeFilePath, callback)
      }
    } catch (error) {
      reject(error)
    }
  })
}

function extractArchiveAsync(fileApi, safeFilePath, safeExtractPath, options = {}) {
  if (!fileApi || typeof fileApi.extractArchiveAsync !== 'function') {
    return Promise.resolve(fileApi.extractArchive(safeFilePath, safeExtractPath, options))
  }

  return new Promise((resolve, reject) => {
    try {
      fileApi.extractArchiveAsync(safeFilePath, safeExtractPath, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result)
      }, options)
    } catch (error) {
      reject(error)
    }
  })
}

function resolveArchiveTypeLabel(filePath, inspectResult = null) {
  const archiveType = String(inspectResult?.archiveType || '')
    .trim()
    .toLowerCase()

  if (archiveType) {
    return archiveType
  }

  return String(path.extname(filePath || ''))
    .replace('.', '')
    .trim()
    .toLowerCase()
}

function emitExtractLog({ success, sourcePath, targetPath, startedAt, archiveType, error }) {
  const durationMs = Math.max(0, Date.now() - Number(startedAt || Date.now()))
  const payload = {
    success: !!success,
    sourcePath,
    targetPath,
    durationMs,
    archiveType: archiveType || 'unknown'
  }

  if (error) {
    console.error('[解压结果]', {
      ...payload,
      error: String(error?.message || error || '未知错误')
    })
    return
  }

  console.info('[解压结果]', payload)
}

function callFileApiCallbackMethod(methodName, ...args) {
  const fileApi = getVertexFileNodeApi()
  if (!fileApi || typeof fileApi[methodName] !== 'function') {
    throw new Error(`Vertex file_api 未提供原生方法：${methodName}`)
  }

  return new Promise((resolve, reject) => {
    try {
      fileApi[methodName](...args, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result)
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function inspectArchiveByNodeApi(filePath, options = {}) {
  const safeFilePath = path.resolve(String(filePath || ''))
  if (!(await fs.pathExists(safeFilePath))) {
    throw new Error(`压缩包不存在: ${safeFilePath}`)
  }
  const fileApi = getVertexFileNodeApi()
  return await inspectArchiveAsync(fileApi, safeFilePath, options)
}

export async function extractArchiveByNodeApi(filePath, extractPath, thirdArg, fourthArg) {
  const safeFilePath = path.resolve(String(filePath || ''))
  const safeExtractPath = path.resolve(String(extractPath || ''))
  const fileApi = getVertexFileNodeApi()
  const { options: rawOptions, event } = resolveFileOptionsAndEvent(thirdArg, fourthArg)
  const options = normalizeFileOptions(rawOptions)
  const startedAt = Date.now()
  let inspectResult = null

  if (!(await fs.pathExists(safeFilePath))) {
    const error = new Error(`压缩包不存在: ${safeFilePath}`)
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath),
      error
    })
    throw error
  }

  await fs.ensureDir(safeExtractPath)

  const nativeOptions = {
    overwrite: options.overwrite
  }
  if (options.password) {
    nativeOptions.password = options.password
  }

  try {
    try {
      inspectResult = await inspectArchiveAsync(fileApi, safeFilePath, options)
    } catch {
      inspectResult = null
    }

    const result = await extractArchiveAsync(fileApi, safeFilePath, safeExtractPath, nativeOptions)
    if (options.progressChannel) {
      emitProgressEvent(event, options.progressChannel, { percent: 100 })
    }
    emitExtractLog({
      success: true,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath, inspectResult)
    })
    return result
  } catch (error) {
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath, inspectResult),
      error
    })
    throw error
  }
}

export async function parseAndExtractFileByNodeApi(filePath, extractPath, thirdArg, fourthArg) {
  const safeFilePath = path.resolve(String(filePath || ''))
  const safeExtractPath = path.resolve(String(extractPath || ''))
  const fileApi = getVertexFileNodeApi()
  const { options: rawOptions, event } = resolveFileOptionsAndEvent(thirdArg, fourthArg)
  const options = normalizeFileOptions(rawOptions)
  const startedAt = Date.now()

  if (!(await fs.pathExists(safeFilePath))) {
    const error = new Error(`源文件不存在: ${safeFilePath}`)
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath),
      error
    })
    throw error
  }

  await fs.ensureDir(safeExtractPath)

  let inspectResult = null
  try {
    inspectResult = await inspectArchiveAsync(fileApi, safeFilePath, options)
  } catch (error) {
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath),
      error
    })
    return {
      type: 0,
      msg: formatExtractErrorMessage(error),
      data: {
        structure: [],
        isEncrypted: false,
        backup: []
      }
    }
  }

  const structure = buildLegacyStructure(inspectResult?.tree || [], safeExtractPath)
  const encrypted = isArchiveEncrypted(inspectResult)

  if (encrypted && !options.password) {
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath, inspectResult),
      error: buildEncryptedArchiveMessage(inspectResult?.archiveType)
    })
    return {
      type: 0,
      msg: buildEncryptedArchiveMessage(inspectResult?.archiveType),
      data: {
        structure,
        isEncrypted: true,
        backup: []
      }
    }
  }

  try {
    const nativeOptions = { overwrite: true }
    if (options.password) {
      nativeOptions.password = options.password
    }
    await extractArchiveAsync(fileApi, safeFilePath, safeExtractPath, nativeOptions)
    emitProgressEvent(event, 'install-task-extract-progress', { percent: 100 })
    emitExtractLog({
      success: true,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath, inspectResult)
    })

    return {
      type: 1,
      msg: '解压成功',
      data: {
        structure,
        isEncrypted: encrypted,
        backup: []
      }
    }
  } catch (error) {
    emitExtractLog({
      success: false,
      sourcePath: safeFilePath,
      targetPath: safeExtractPath,
      startedAt,
      archiveType: resolveArchiveTypeLabel(safeFilePath, inspectResult),
      error
    })
    return {
      type: 0,
      msg: formatExtractErrorMessage(error),
      data: {
        structure,
        isEncrypted: encrypted,
        backup: []
      }
    }
  }
}

export async function extractAndGetStructureByNodeApi(
  filePath,
  extractPath,
  usageType = 1,
  thirdArg,
  fourthArg
) {
  const result = await parseAndExtractFileByNodeApi(filePath, extractPath, thirdArg, fourthArg)

  if (Number(result?.type) === 1 && (Number(usageType) === 2 || Number(usageType) === 4)) {
    result.data.run = resolveExecutableRun(result?.data?.structure || [])
  }

  return result
}

export async function generateFileMD5ByNodeApi(filePath, onProgress) {
  const safeFilePath = path.resolve(String(filePath || ''))
  const fileApi = getVertexFileNodeApi()
  const digest = String(fileApi.generateFileMD5(safeFilePath) || '').toLowerCase()

  if (typeof onProgress === 'function') {
    try {
      const stats = await fs.stat(safeFilePath)
      const totalSize = Number(stats?.size || 0)
      onProgress(100, totalSize, totalSize)
    } catch {
      onProgress(100, 0, 0)
    }
  }

  return digest
}

export async function verifyFileMD5ByNodeApi(filePath, expectedMD5, onProgress) {
  const safeFilePath = path.resolve(String(filePath || ''))
  const fileApi = getVertexFileNodeApi()
  const matched = !!fileApi.verifyFileMD5(
    safeFilePath,
    String(expectedMD5 || '')
      .trim()
      .toLowerCase()
  )

  if (typeof onProgress === 'function') {
    try {
      const stats = await fs.stat(safeFilePath)
      const totalSize = Number(stats?.size || 0)
      onProgress(100, totalSize, totalSize)
    } catch {
      onProgress(100, 0, 0)
    }
  }

  return matched
}

export async function generateFileSHA256ByNodeApi(filePath) {
  const safeFilePath = path.resolve(String(filePath || ''))
  const fileApi = getVertexFileNodeApi()

  if (fileApi && typeof fileApi.generateFileSHA256Async === 'function') {
    return String(await callFileApiCallbackMethod('generateFileSHA256Async', safeFilePath)).toLowerCase()
  }

  if (fileApi && typeof fileApi.generateFileSHA256 === 'function') {
    return String(fileApi.generateFileSHA256(safeFilePath) || '').toLowerCase()
  }

  throw new Error('Vertex file_api 未提供原生方法：generateFileSHA256')
}

export async function deployFileByNodeApi(sourcePath, targetPath, options = {}) {
  const safeSourcePath = path.resolve(String(sourcePath || ''))
  const safeTargetPath = path.resolve(String(targetPath || ''))
  const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  return await callFileApiCallbackMethod('deployFile', safeSourcePath, safeTargetPath, {
    allowLink: safeOptions.allowLink !== false,
    allowSymlink: safeOptions.allowSymlink !== false,
    forceCopy: safeOptions.forceCopy === true
  })
}

export async function copyPathByNodeApi(sourcePath, targetPath) {
  const safeSourcePath = path.resolve(String(sourcePath || ''))
  const safeTargetPath = path.resolve(String(targetPath || ''))
  return await callFileApiCallbackMethod('copyPath', safeSourcePath, safeTargetPath)
}

export async function removePathByNodeApi(targetPath) {
  const safeTargetPath = path.resolve(String(targetPath || ''))
  return await callFileApiCallbackMethod('removePath', safeTargetPath)
}

export async function scanDriveByFilenameByNodeApi(fileName) {
  const safeFileName = String(fileName || '').trim()
  if (!safeFileName) {
    return ''
  }

  const fileApi = getVertexFileNodeApi()
  if (!fileApi || typeof fileApi.scanDriveByFilename !== 'function') {
    throw new Error('Vertex file_api 未提供原生方法：scanDriveByFilename')
  }

  return new Promise((resolve, reject) => {
    try {
      fileApi.scanDriveByFilename(safeFileName, (err, result) => {
        if (err) {
          reject(err)
          return
        }

        const found = !!result?.found
        const resolvedPath = String(result?.path || '').trim()
        resolve(found ? resolvedPath : '')
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function detectGameRootByRuleByNodeApi(payload = {}) {
  const fileApi = getVertexFileNodeApi()
  if (!fileApi || typeof fileApi.detectGameRootByRule !== 'function') {
    throw new Error('Vertex file_api 未提供原生方法：detectGameRootByRule')
  }

  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}

  return new Promise((resolve, reject) => {
    try {
      fileApi.detectGameRootByRule(safePayload, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result && typeof result === 'object' ? result : {})
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function scanExecutablesInDirectoryByNodeApi(dirPath = '') {
  const safeDirPath = path.resolve(String(dirPath || ''))
  const fileApi = getVertexFileNodeApi()
  if (!fileApi || typeof fileApi.scanExecutablesInDirectory !== 'function') {
    throw new Error('Vertex file_api 未提供原生方法：scanExecutablesInDirectory')
  }

  return new Promise((resolve, reject) => {
    try {
      fileApi.scanExecutablesInDirectory(safeDirPath, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(result && typeof result === 'object' ? result : { type: 0, path: '', paths: [] })
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function listPackageRootCandidatesByNodeApi(
  stagingPath = '',
  maxDepth = Number.POSITIVE_INFINITY
) {
  const safeStagingPath = path.resolve(String(stagingPath || ''))
  const fileApi = getVertexFileNodeApi()
  if (!fileApi || typeof fileApi.listPackageRootCandidates !== 'function') {
    throw new Error('Vertex file_api 未提供原生方法：listPackageRootCandidates')
  }

  const safeMaxDepth = Number.isFinite(Number(maxDepth)) ? Math.max(Number(maxDepth), 0) : -1

  return new Promise((resolve, reject) => {
    try {
      fileApi.listPackageRootCandidates(safeStagingPath, safeMaxDepth, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve(Array.isArray(result) ? result : [])
      })
    } catch (error) {
      reject(error)
    }
  })
}
