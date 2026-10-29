import { scanDriveByFilenameByNodeApi } from '../../api/file/index.js'

const pendingScanDriveTaskMap = new Map()

// O4：扫描结果缓存（5 分钟 TTL），避免同一 exe 名重复全盘扫描。
const scanResultCache = new Map()
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000

export async function scanDriveByFilename(executableFile) {
  const safeExecutableFile = String(executableFile || '').trim()
  if (!safeExecutableFile) return ''

  const taskKey = safeExecutableFile.toLowerCase()

  // O4：命中缓存且未过期直接返回
  const cached = scanResultCache.get(taskKey)
  if (cached && cached.expireAt > Date.now()) {
    return cached.result
  }

  const existingTask = pendingScanDriveTaskMap.get(taskKey)
  if (existingTask) {
    console.log(`复用进行中的扫描任务: ${safeExecutableFile}`)
    return existingTask
  }

  const taskPromise = executeScanDriveByFilename(safeExecutableFile)
    .then((result) => {
      // O4：扫描完成后写入结果缓存
      scanResultCache.set(taskKey, { result, expireAt: Date.now() + SCAN_CACHE_TTL_MS })
      return result
    })
    .finally(() => {
      if (pendingScanDriveTaskMap.get(taskKey) === taskPromise) {
        pendingScanDriveTaskMap.delete(taskKey)
      }
    })

  pendingScanDriveTaskMap.set(taskKey, taskPromise)
  return taskPromise
}

async function executeScanDriveByFilename(executableFile) {
  console.log(`正在搜索文件: ${executableFile}`)
  const startTime = Date.now()

  try {
    const nativeFoundPath = await scanDriveByFilenameByNodeApi(executableFile)
    if (nativeFoundPath) {
      console.log(`原生扫描找到文件，总耗时 ${((Date.now() - startTime) / 1000).toFixed(2)} 秒`)
      return nativeFoundPath
    }

    console.log(`原生扫描未找到文件，总耗时 ${((Date.now() - startTime) / 1000).toFixed(2)} 秒`)
  } catch (error) {
    console.warn('原生扫描失败', error)
  }

  return ''
}
