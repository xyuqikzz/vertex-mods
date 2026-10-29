import Registry from 'winreg'
import fs from 'fs-extra'
import path from 'path'
import { pathExistsSync } from '../tool.js'
import { findGameRecord, normalizeGameSourceMeta, upsertGameRecord } from '../../db/games/gameRecord.js'

/**
 * 获取注册表键的所有值
 * @param {Registry} regKey
 * @returns {Promise<Object>}
 */
const getRegistryValues = (regKey) => {
  return new Promise((resolve) => {
    regKey.values((err, values) => {
      if (err) return resolve({})

      const appInfo = {}
      values.forEach((value) => {
        // 转换数据类型
        appInfo[value.name] = convertRegistryValue(value.type, value.value)
      })

      resolve(appInfo)
    })
  })
}

/**
 * 转换注册表值到合适的JavaScript类型
 * @param {string} type - 注册表类型 (REG_SZ, REG_DWORD等)
 * @param {string} value - 原始值
 * @returns {any} 转换后的值
 */
const convertRegistryValue = (type, value) => {
  switch (type) {
    case 'REG_DWORD':
      return parseInt(value, 16) // 16进制转10进制
    case 'REG_BINARY':
      return value // 保持二进制数据不变
    case 'REG_SZ':
    case 'REG_EXPAND_SZ':
    case 'REG_MULTI_SZ':
    default:
      return value
  }
}

/**
 * 获取指定 Steam App 的注册表信息
 * @param {string} steamAppId - Steam 应用ID (如 "1307550")
 * @returns {Promise<Object>} 包含应用信息的对象
 */
export async function getSteamAppInfo(steamAppId) {
  try {
    // Steam 应用的注册表路径模式
    const steamRegPath = `\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${steamAppId}`

    const regKey = new Registry({
      hive: Registry.HKLM,
      key: steamRegPath
    })

    // 检查32位注册表位置
    const regKey32 = new Registry({
      hive: Registry.HKLM,
      key: `\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${steamAppId}`
    })

    // 尝试从两个位置获取信息
    const [appInfo, appInfo32] = await Promise.all([
      getRegistryValues(regKey),
      getRegistryValues(regKey32)
    ])

    // 合并结果，优先使用64位位置的信息
    return { ...appInfo32, ...appInfo }
  } catch (error) {
    console.error('Error getting Steam app info:', error)
    return null
  }
}

export async function findFileParallel(rootPath, fileName) {
  if (!rootPath || !fileName) {
    return { status: false, path: null }
  }
  // 检查根路径是否存在
  try {
    await fs.promises.access(rootPath)
  } catch (err) {
    console.log(err)
    return { status: false, path: null }
  }

  // 1. 先在根路径直接查找
  const directPath = path.join(rootPath, fileName)
  try {
    await fs.promises.access(directPath)
    return { status: true, path: directPath }
  } catch (err) {
    console.log(err)
  }

  // 2. 并行递归查找子目录
  const dirsToSearch = [rootPath]

  while (dirsToSearch.length > 0) {
    const currentDirs = dirsToSearch.splice(0, Math.min(10, dirsToSearch.length)) // 每次处理最多10个目录
    const promises = currentDirs.map(async (currentDir) => {
      try {
        const files = await fs.promises.readdir(currentDir, { withFileTypes: true })

        for (const file of files) {
          const fullPath = path.join(currentDir, file.name)

          if (file.isDirectory()) {
            dirsToSearch.push(fullPath)
          } else if (file.name === fileName) {
            return fullPath // 找到文件
          }
        }
      } catch (err) {
        // 忽略无法读取的目录
        console.log(err)
      }
      return null
    })

    const results = await Promise.all(promises)
    const foundPath = results.find((path) => path !== null)

    if (foundPath) {
      return { status: true, path: foundPath }
    }
  }
  return { status: false, path: null }
}

export async function getGameByAppId(appId, executableFile, gameId, sourceMeta = {}) {
  const appIdStr = String(appId)
  const normalizedSourceMeta = normalizeGameSourceMeta({
    ...sourceMeta,
    appId: sourceMeta?.appId || appIdStr,
    gameId
  })
  let result = findGameRecord(normalizedSourceMeta)

  if (!result) {
    const steamApp = await getSteamAppInfo(appIdStr)
    const { InstallLocation = '' } = steamApp
    const { status, path: exePath = '' } = await findFileParallel(InstallLocation, executableFile)
    if (status) {
      await upsertGameRecord(appIdStr, exePath, gameId, InstallLocation, normalizedSourceMeta)
      return findGameRecord(normalizedSourceMeta)
    } else {
      return false
    }
  } else {
    const { client_root_path = '', client_exe_path = '' } = result
    if (!client_exe_path || !pathExistsSync(client_exe_path)) {
      if (!pathExistsSync(client_root_path)) {
        return false
      }
      const steamApp = await getSteamAppInfo(appIdStr)
      const { InstallLocation = '' } = steamApp
      const { status, path: newExePath = '' } = await findFileParallel(
        InstallLocation,
        executableFile
      )
      if (!status) return false
      await upsertGameRecord(appIdStr, newExePath, gameId, InstallLocation, normalizedSourceMeta)
      return findGameRecord(normalizedSourceMeta)
    } else {
      if (
        normalizedSourceMeta.source ||
        normalizedSourceMeta.sourceId ||
        normalizedSourceMeta.name ||
        normalizedSourceMeta.backgroundImage
      ) {
        await upsertGameRecord(
          appIdStr,
          client_exe_path,
          gameId || result?.game_id || 0,
          client_root_path,
          normalizedSourceMeta
        )
        return findGameRecord(normalizedSourceMeta)
      }
      return result
    }
  }
}
