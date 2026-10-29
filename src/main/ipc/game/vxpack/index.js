import { ipcMain } from '../../../security/ipc.js'
import {
  estimateVxpackExportSize,
  listRecentVxpackHistory,
  openVxpackExportFolder
} from './vxpackExportService.js'
import {
  cleanupOfflinePackCache,
  createOfflinePack,
  getOfflinePackStageMetrics,
  inspectOfflinePack,
  pickOfflinePackImportFile,
  submitOfflinePackInstall
} from './offlinePackService.js'

export function vxpackIndex() {
  ipcMain.handle('vxpack:estimateExportSize', async (_event, payload = {}) => {
    return estimateVxpackExportSize(payload)
  })

  ipcMain.handle('vxpack:listRecentHistory', async (_event, payload = {}) => {
    return listRecentVxpackHistory(payload)
  })

  ipcMain.handle('vxpack:openExportFolder', async (_event, payload = {}) => {
    return await openVxpackExportFolder(payload)
  })

  ipcMain.handle('offline-pack:inspectFile', async (_event, payload = {}) => {
    return inspectOfflinePack(payload)
  })

  ipcMain.handle('offline-pack:pickImportFile', async () => {
    return await pickOfflinePackImportFile()
  })

  ipcMain.handle('offline-pack:create', async (_event, payload = {}) => {
    return await createOfflinePack(payload)
  })

  ipcMain.handle('offline-pack:submitInstall', async (event, payload = {}) => {
    return await submitOfflinePackInstall(event, payload)
  })

  ipcMain.handle('offline-pack:cleanupCache', async (_event, payload = {}) => {
    return await cleanupOfflinePackCache(payload)
  })

  // 可观测性（审计 🟢#30）：暴露离线包导入各阶段指标供调试 / 监控查询
  ipcMain.handle('offline-pack:getStageMetrics', async () => {
    return { success: true, data: getOfflinePackStageMetrics() }
  })
}
