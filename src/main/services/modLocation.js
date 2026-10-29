import fs from 'node:fs/promises'
import path from 'node:path'
import { assertLocalPath } from '../security/ipcPolicy.js'
import { getModFileInfo } from '../../shared/games/mod-management-location.js'

export async function openInstalledModLocation(payload = {}, deps = {}) {
  const id = Number(payload.id)
  if (!Number.isSafeInteger(id) || id <= 0)
    return { success: false, message: '模组记录无效，请刷新列表后重试' }
  try {
    const db = deps.db || (await import('../db/dbInstance.js')).default
    const record = db.get('SELECT * FROM mods WHERE id = ?', [id])
    if (!record) return { success: false, message: '模组记录已不存在，请刷新列表' }
    const { locationPaths } = getModFileInfo(record)
    if (!locationPaths.length) return { success: false, message: '此安装记录没有可定位的本地路径' }
    const shell = deps.shell || (await import('electron')).shell
    for (const candidate of locationPaths) {
      assertLocalPath(candidate)
      let stat
      try {
        stat = await fs.stat(candidate)
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
        throw error
      }
      if (!stat.isDirectory() && !stat.isFile()) continue
      // 只打开目录，文件路径定位到其父目录，绝不执行模组中的文件。
      const directory = stat.isDirectory() ? candidate : path.dirname(candidate)
      assertLocalPath(directory)
      const error = await shell.openPath(directory)
      return error
        ? { success: false, message: `无法打开模组目录：${error}` }
        : { success: true, path: directory }
    }
    return { success: false, message: '模组的安装目录和托管文件均已不存在，请刷新列表或重新安装' }
  } catch {
    return { success: false, message: '无法访问模组目录，请检查路径和文件夹权限' }
  }
}
