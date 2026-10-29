import { getVertexFileNodeApi } from '../api/shared/index.js'
import { getBackupDataByPath, markNoRecovery } from '../db/mods/mods.js'

const fileApi = getVertexFileNodeApi()

function ensureNativeMethod(methodName) {
  if (!fileApi || typeof fileApi[methodName] !== 'function') {
    throw new Error(`Vertex file_api 未提供原生方法：${methodName}`)
  }
}

function normalizePrepareResult(result) {
  return {
    filePaths: Array.isArray(result?.filePaths) ? result.filePaths : [],
    dirPaths: Array.isArray(result?.dirPaths) ? result.dirPaths : [],
    occupiedFiles: Array.isArray(result?.occupiedFiles) ? result.occupiedFiles : []
  }
}

function normalizeExecuteResult(result) {
  return {
    removedFiles: Array.isArray(result?.removedFiles) ? result.removedFiles : [],
    missingFiles: Array.isArray(result?.missingFiles) ? result.missingFiles : [],
    removedDirectories: Array.isArray(result?.removedDirectories) ? result.removedDirectories : []
  }
}

export function uninstallFileByJson(json, mod) {
  const { option_id, endpoint_type } = mod || {}

  if (typeof json === 'string') {
    try {
      json = JSON.parse(json)
    } catch (error) {
      console.error(error)
      return false
    }
  }

  try {
    ensureNativeMethod('prepareModUninstall')
    ensureNativeMethod('executeModUninstall')

    const prepareResult = normalizePrepareResult(fileApi.prepareModUninstall(json))
    const filePaths = prepareResult.filePaths

    if (filePaths.length === 0) {
      console.log('没有找到需要删除的文件')
      return true
    }

    console.log(`检查 ${filePaths.length} 个文件的占用状态...`)

    if (prepareResult.occupiedFiles.length > 0) {
      prepareResult.occupiedFiles.forEach((filePath) => {
        console.log(`文件被占用: ${filePath}`)
      })
      console.log(`发现 ${prepareResult.occupiedFiles.length} 个文件被占用，取消卸载操作`)
      return false
    }

    console.log('所有文件未被占用，开始卸载...')

    const filePathsToDelete = []
    filePaths.forEach((filePath) => {
      const list = getBackupDataByPath(filePath, endpoint_type)
      if (list.length) {
        console.log(list, '检测到路径有备份数据')

        let matchedSelfBackup = false
        list.forEach((item) => {
          const { mod_id } = item
          if (String(mod_id) === String(option_id)) {
            matchedSelfBackup = true
            console.log('匹配为自己的备份 正常进行卸载')
            return
          }

          console.log('非自己的备份 不进行卸载 并且进行标记')
          markNoRecovery(item.id)
        })

        if (matchedSelfBackup) {
          filePathsToDelete.push(filePath)
        }
        return
      }

      filePathsToDelete.push(filePath)
    })

    const executeResult = normalizeExecuteResult(
      fileApi.executeModUninstall(filePathsToDelete, prepareResult.dirPaths)
    )
    const removedFileSet = new Set(executeResult.removedFiles)
    const missingFileSet = new Set(executeResult.missingFiles)

    filePathsToDelete.forEach((filePath) => {
      if (removedFileSet.has(filePath)) {
        console.log(`文件已删除: ${filePath}`)
        return
      }

      if (missingFileSet.has(filePath)) {
        console.warn(`文件不存在(视为已卸载): ${filePath}`)
      }
    })

    executeResult.removedDirectories.forEach((dirPath) => {
      console.log(`空文件夹已删除: ${dirPath}`)
    })

    return true
  } catch (error) {
    console.error(`卸载失败: ${error?.message || error}`)
    return false
  }
}
