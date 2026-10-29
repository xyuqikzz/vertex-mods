import { app } from 'electron'
import { ipcMain } from '../../security/ipc.js'
import { join } from 'path'
import fs from 'fs'

/**
 * 获取 resources 目录路径（兼容开发和打包环境）
 */
function getResourcesDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources')
  }
  return join(__dirname, '..', '..', 'resources')
}

/**
 * 读取模组浏览器站点配置
 */
function readSitesConfig() {
  try {
    const configPath = join(getResourcesDir(), 'data', 'mod-browser-sites.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch (error) {
    console.error('[ModBrowser] 读取站点配置失败', error.message)
    return []
  }
}

/**
 * 保存模组浏览器站点配置
 */
function writeSitesConfig(list = []) {
  try {
    const configPath = join(getResourcesDir(), 'data', 'mod-browser-sites.json')
    fs.writeFileSync(configPath, JSON.stringify(list, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('[ModBrowser] 保存站点配置失败', error.message)
    return { success: false, message: error.message }
  }
}

/**
 * 模组浏览器 IPC 注册入口
 */
export function modBrowserIndex() {
  // 获取站点配置列表
  ipcMain.handle('mod-browser:get-sites', async () => {
    return readSitesConfig()
  })

  // 保存站点配置列表
  ipcMain.handle('mod-browser:save-sites', async (_event, payload = {}) => {
    const list = Array.isArray(payload.sites) ? payload.sites : []
    return writeSitesConfig(list)
  })
}
