import { setNativeLanguagePreference } from '../../services/uiLanguage.js'
import { listAiModels } from '../../services/ai/modelCatalog.js'
import { ipcMain } from '../../security/ipc.js'
import store from '../../storage/store/index.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'

import {
  cleanupInstalledAppResiduals,
  changeCachePath,
  changeDownloadPath,
  downloadSpecifiedLink,
  exitApp,
  getConfigByKey,
  getInstalledAppIcon,
  getNetworkConnectionStatus,
  readConfigByKey,
  openAppDirectory,
  openBrowse,
  openDevTools,
  openSpecifyPath,
  restartApp,
  resolveInstalledAppIcon,
  scanDeviceInfo,
  scanDisk,
  scanInstalledAppResiduals,
  scanInstalledApps,
  showWindow,
  startSpecifiedApp,
  uninstallInstalledApp,
  updateSystemSettings,
  windowOperation
} from './medhod.js'
import {
  queryTranslationCacheBatch,
  translateTextBatch
} from './aiTranslation.js'
import {
  getTranslationRuntimeStatus,
  runTranslationRuntimeProbe
} from '../../services/translation/translationRuntime.js'
import {
  deleteAiTranslationData,
  getAiTranslationDataManagerState
} from './aiTranslationDataManager.js'
import { registerAiAgentIpc } from './aiAgent.js'
import { importAiMascotPetZip, listCustomAiMascotPets } from './aiMascotPets.js'
import { registerNexusAuthorizationRouterIpc } from '../../services/nexusAuthorizationRouter.js'

export function systemIndex() {
  ipcMain.handle('ui-language:set', (_event, preference) => setNativeLanguagePreference(preference))
  ipcMain.on('windowOperation', (event, data) => {
    windowOperation(event, data)
  })

  ipcMain.on('scanDisk', (event, data) => {
    scanDisk(event, data).then()
  })

  ipcMain.on('openSpecifyPath', (event, data) => {
    openSpecifyPath(event, data)
  })

  ipcMain.on('scanDeviceInfo', (event, data) => {
    scanDeviceInfo(event, data).then()
  })

  ipcMain.on('getNetworkConnectionStatus', (event) => {
    getNetworkConnectionStatus(event).then()
  })

  ipcMain.on('getConfigByKey', (event, data) => {
    getConfigByKey(event, data)
  })

  ipcMain.handle('getConfigByKey', (_event, data) => {
    return readConfigByKey(data)
  })

  ipcMain.on('updateSystemSettings', (event, data) => {
    updateSystemSettings(event, data)
  })
  ipcMain.handle('updateSystemSettings', (event, data) => {
    updateSystemSettings(event, data)
    return { success: true }
  })
  ipcMain.handle('archiveLegacySettings', (_event, data) => {
    store.archiveLegacySettings(sanitizeUserSystemConfig(data?.settings || data || {}))
    return { success: true }
  })





  ipcMain.handle('changeDownloadPath', async (event) => {
    return await changeDownloadPath(event)
  })

  ipcMain.handle('changeCachePath', async (event) => {
    return await changeCachePath(event)
  })

  ipcMain.on('openBrowse', async (event, data) => {
    await openBrowse(data)
  })

  ipcMain.on('downloadSpecifiedLink', async (event, data) => {
    await downloadSpecifiedLink(event, data)
  })

  ipcMain.on('startSpecifiedApp', async (event, data) => {
    await startSpecifiedApp(event, data)
  })

  ipcMain.on('exitApp', async () => {
    exitApp()
  })

  ipcMain.on('openDevTools', async () => {
    openDevTools()
  })

  ipcMain.on('showWindow', async () => {
    showWindow()
  })

  ipcMain.on('restartApp', () => {
    restartApp()
  })


  // 扫描系统已安装应用
  ipcMain.on('scanInstalledApps', async (event, data) => {
    await scanInstalledApps(event, data)
  })

  // 不启动卸载器，直接扫描可清理项
  ipcMain.on('scanInstalledAppResiduals', async (event, data) => {
    await scanInstalledAppResiduals(event, data)
  })

  // 执行应用卸载
  ipcMain.on('uninstallInstalledApp', async (event, data) => {
    await uninstallInstalledApp(event, data)
  })

  // 清理卸载残留
  ipcMain.on('cleanupInstalledAppResiduals', async (event, data) => {
    await cleanupInstalledAppResiduals(event, data)
  })

  // 读取应用图标
  ipcMain.on('getInstalledAppIcon', async (event, data) => {
    await getInstalledAppIcon(event, data)
  })

  ipcMain.handle('resolveInstalledAppIcon', async (_event, data) => {
    return await resolveInstalledAppIcon(data)
  })

  // 打开应用相关目录（根目录、数据库目录、缓存目录）
  ipcMain.on('open-app-directory', async (event, type) => {
    await openAppDirectory(type)
  })

  ipcMain.handle('aiTranslateTextBatch', async (_event, payload = {}) => {
    return await translateTextBatch(payload, {
      event: _event
    })
  })

  ipcMain.handle('queryAiTranslationCacheBatch', async (_event, payload = {}) => {
    return await queryTranslationCacheBatch(payload)
  })

  ipcMain.handle('listAiTranslationModels', async (_event, payload = {}) => {
    return await listAiModels(payload)
  })

  ipcMain.handle('translationRuntime:getStatus', async () => {
    return getTranslationRuntimeStatus()
  })

  ipcMain.handle('translationRuntime:probe', async (_event, payload = {}) => {
    return await runTranslationRuntimeProbe(payload)
  })

  ipcMain.handle('getAiTranslationDataManagerState', async (_event, payload = {}) => {
    return await getAiTranslationDataManagerState(payload)
  })

  ipcMain.handle('deleteAiTranslationData', async (_event, payload = {}) => {
    return await deleteAiTranslationData(payload)
  })

  ipcMain.handle('aiMascot:listCustomPets', async () => {
    return await listCustomAiMascotPets()
  })

  ipcMain.handle('aiMascot:importPetZip', async () => {
    return await importAiMascotPetZip()
  })

  registerAiAgentIpc()
  registerNexusAuthorizationRouterIpc(ipcMain)
}
