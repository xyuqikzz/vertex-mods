import { nativeText } from '../../services/uiLanguage.js'
import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ipcMain } from '../../security/ipc.js'
import { requestSourceNetwork } from '../../services/source-network/index.js'
import { withNetworkRequest } from '../../security/networkRequests.js'
import { sourceNetworkMessage } from '../../../shared/sources/source-network.js'
import { createCommunityModService } from '../../services/communityMods.js'
import { fetchSharedRule } from './sharedRuleClient.js'
import { findGameRecord } from '../../db/games/gameRecord.js'
import { nexusUpsertDetectedGamePath } from './method.js'
import {
  installDetectGameRootByRule,
  installDetectGameRootByRuleFromDirectory
} from './installRuleDetect.js'
import { createSourceInstallTask } from './source-install-task/orchestrator.js'
import {
  normalizeWorkshopTarget,
  normalizeWorkshopDetails
} from '../../../shared/sources/steam-workshop.js'
import {
  requireGamebananaId,
  normalizeGamebananaDetail,
  GAMEBANANA_DETAIL_PROPERTIES
} from '../../../shared/sources/gamebanana-catalog.js'

async function request(options, source) {
  const response = await requestSourceNetwork({
    timeout: 30000,
    maxContentLength: 4 * 1024 * 1024,
    responseType: 'json',
    ...options
  }, { source })
  if (response.status !== 200) throw new Error(`来源请求失败（HTTP ${response.status}）`)
  return response.data
}

export async function readCommunityModDetail(identity, modId, { signal } = {}) {
  if (identity.source === 'gamebanana') {
    const detail = normalizeGamebananaDetail(
      await request({
        method: 'GET',
        url: `https://gamebanana.com/apiv11/Mod/${requireGamebananaId(modId)}`,
        params: { _csvProperties: GAMEBANANA_DETAIL_PROPERTIES }, signal
      }, 'gamebanana')
    )
    if (detail.gameId !== identity.sourceGameId) throw new Error('模组与当前游戏不匹配')
    return detail
  }
  const target = normalizeWorkshopTarget({
    steamAppId: identity.sourceGameId,
    publishedFileId: modId
  })
  const raw = await request({
    method: 'POST',
    signal,
    url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      itemcount: '1',
      'publishedfileids[0]': target.publishedFileId
    }).toString()
  }, 'steam-workshop')
  const detail = normalizeWorkshopDetails(raw, target)
  return {
    id: target.publishedFileId,
    name: detail.title,
    version: detail.version,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${target.publishedFileId}`,
    image: String(raw.response.publishedfiledetails[0].preview_url || ''),
    workshopDetail: detail,
    files: [
      {
        id: target.publishedFileId,
        name: detail.fileName,
        size: detail.size,
        version: detail.version
      }
    ]
  }
}

const service = createCommunityModService({
  fetchRule: fetchSharedRule,
  findGame: findGameRecord,
  async readLocalGame(record) {
    const rootPath = String(record.client_root_path || '')
    const exePath = String(record.client_exe_path || '')
    try {
      if (!path.isAbsolute(rootPath) || !(await fs.stat(rootPath)).isDirectory()) return null
      const executableExists = path.isAbsolute(exePath) && await fs.stat(exePath).then(stat => stat.isFile(), () => false)
      return { rootPath, exePath: executableExists ? exePath : '' }
    } catch { return null }
  },
  saveGame: nexusUpsertDetectedGamePath,
  detect: installDetectGameRootByRule,
  detectDirectory: installDetectGameRootByRuleFromDirectory,
  readDetail: readCommunityModDetail,
  createTask: createSourceInstallTask
})

export function registerCommunityModIpc() {
  for (const [channel, handler] of Object.entries({
    'community:context': (_event, payload) => service.context(payload),
    'community:detail': (event, payload) => withNetworkRequest(event, payload.networkRequestId || randomUUID(), signal => service.detail(payload, { signal })),
    'community:submit': (event, payload) => withNetworkRequest(event, payload.networkRequestId || randomUUID(), signal => service.submit(event, payload, { signal })),
    'community:select-directory': async (_event, payload) => {
      const selection = await dialog.showOpenDialog({
        title: nativeText('selectGameDirectory'),
        properties: ['openDirectory']
      })
      if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
      return service.context(payload, selection.filePaths[0])
    }
  })) {
    ipcMain.handle(channel, async (event, payload = {}) => {
      try {
        return { success: true, data: await handler(event, payload) }
      } catch (error) {
        return { success: false, code: error.isSourceNetworkError ? error.code : undefined,
          message: sourceNetworkMessage(error.code, payload.source) || (error.isSourceNetworkError ? '来源连接失败，请稍后重试。' : error.message) || '社区模组操作失败' }
      }
    })
  }
}
