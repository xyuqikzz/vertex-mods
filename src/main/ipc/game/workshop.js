import { requestSourceNetwork } from '../../services/source-network/index.js'
import { sourceNetworkMessage } from '../../../shared/sources/source-network.js'
import { webContents } from 'electron'
import { ipcMain } from '../../security/ipc.js'
import { parseCommunityModUrl } from '../../../shared/sources/community-source.js'
import {
  normalizeWorkshopTarget,
  normalizeWorkshopDetails,
  buildWorkshopDownloadTask
} from '../../../shared/sources/steam-workshop.js'
import { createSourceInstallTask } from './source-install-task/orchestrator.js'
import { getWorkshopQrStates, submitWorkshopAuth, rememberWorkshopAuth } from '../../services/workshop/authState.js'
import { registerSteamAccountIpc } from '../../services/workshop/account.js'
import { registerCommunityModIpc } from './communityMods.js'

export function workshopIndex() {
  registerSteamAccountIpc()
  registerCommunityModIpc()
  ipcMain.handle('workshop:auth-state', (event) => getWorkshopQrStates(event.sender.id))
  ipcMain.handle('workshop:auth-submit', (event, payload) => submitWorkshopAuth(event.sender.id, payload))
  ipcMain.handle('workshop:auth-remember', (event, payload) => rememberWorkshopAuth(event.sender.id, payload))
  ipcMain.handle('workshop:download', async (event, payload = {}) => {
    try {
      const view = webContents.fromId(Number(payload.webContentsId))
      if (!view || view.getType() !== 'webview' || view.hostWebContents?.id !== event.sender.id)
        throw new Error('请从当前内嵌Steam页面发起下载')
      const parsed = parseCommunityModUrl(view.getURL())
      if (parsed?.source !== 'steam-workshop') throw new Error('请先打开单个Steam模组详情')
      const target = normalizeWorkshopTarget({ ...payload, publishedFileId: parsed.modId })
      let response
      try {
        response = await requestSourceNetwork({
          url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
          method: 'POST', responseType: 'json',
          data: new URLSearchParams({
            itemcount: '1',
            'publishedfileids[0]': target.publishedFileId
          }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000,
            maxRedirects: 0,
            maxContentLength: 2 * 1024 * 1024
        }, { source: 'steam-workshop' })
        if (response.status !== 200) throw new Error('来源请求失败')
      } catch (error) {
        throw new Error(sourceNetworkMessage(error.code) || '无法读取 Steam 模组信息，请检查网络后重试')
      }
      const details = normalizeWorkshopDetails(response.data, target)
      details.gameName = String(payload.gameName || target.steamAppId).slice(0, 200)
      return await createSourceInstallTask(event, buildWorkshopDownloadTask(details))
    } catch (error) {
      return { success: false, message: error.message || 'Steam下载失败' }
    }
  })
}
