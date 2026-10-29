import { ipcMain } from '../../../security/ipc.js'
import {
  pickLocalModSources,
  selectLocalModInstallTargetFolder,
  openLocalModPath
} from './sourcePicker.js'
import { analyzeLocalModSources } from './analyzer.js'
import { commitLocalModManagement } from './commitService.js'
import {
  createLocalModInstallTask,
  deleteLocalModAsset,
  getLocalModAsset,
  listLocalModAssets,
  updateLocalModAssetMeta
} from './libraryService.js'
import {
  resolveLocalModInstallTarget,
  validateInstallTargetFolder
} from './installTargetService.js'
import {
  deleteLocalManagedMod,
  disableLocalManagedMod,
  enableLocalManagedMod,
  refreshLocalManagedMods,
  unbindLocalManagedMod
} from './bindingService.js'

function createInvokeEvent(event = null) {
  return {
    ...(event || {}),
    reply(channel, ...args) {
      try {
        if (event?.sender && !event.sender.isDestroyed?.()) {
          event.sender.send(channel, ...args)
        }
      } catch {
        // 忽略事件桥接失败，IPC 返回值仍是权威结果。
      }
    }
  }
}

export function localModManagerIndex() {
  ipcMain.handle('localModManager:pickSources', async (_event, payload = {}) => {
    return await pickLocalModSources(payload)
  })

  ipcMain.handle('localModManager:analyze', async (_event, payload = {}) => {
    return await analyzeLocalModSources(payload)
  })

  ipcMain.handle('localModManager:commit', async (event, payload = {}) => {
    return await commitLocalModManagement(createInvokeEvent(event), payload)
  })

  ipcMain.handle('localModManager:listAssets', async (_event, payload = {}) => {
    return listLocalModAssets(payload)
  })

  ipcMain.handle('localModManager:getAsset', async (_event, payload = {}) => {
    return getLocalModAsset(payload)
  })

  ipcMain.handle('localModManager:updateAssetMeta', async (_event, payload = {}) => {
    return updateLocalModAssetMeta(payload)
  })

  ipcMain.handle('localModManager:deleteAsset', async (_event, payload = {}) => {
    return await deleteLocalModAsset(payload)
  })

  ipcMain.handle('localModManager:resolveInstallTarget', async (event, payload = {}) => {
    return await resolveLocalModInstallTarget(createInvokeEvent(event), payload)
  })

  ipcMain.handle('localModManager:selectInstallTargetFolder', async (_event, payload = {}) => {
    const selected = await selectLocalModInstallTargetFolder(payload)
    if (!selected?.success) return selected
    const validated = await validateInstallTargetFolder({
      ...payload,
      targetPath: selected.path
    })
    return {
      ...selected,
      ...validated,
      path: selected.path
    }
  })

  ipcMain.handle('localModManager:createInstallTask', async (event, payload = {}) => {
    return await createLocalModInstallTask(createInvokeEvent(event), payload)
  })

  ipcMain.handle('localModManager:openPath', async (_event, payload = {}) => {
    return await openLocalModPath(payload)
  })

  ipcMain.handle('localModManager:refresh', async (_event, payload = {}) => {
    return await refreshLocalManagedMods(payload)
  })

  ipcMain.handle('localModManager:enable', async (_event, payload = {}) => {
    return await enableLocalManagedMod(payload)
  })

  ipcMain.handle('localModManager:disable', async (_event, payload = {}) => {
    return await disableLocalManagedMod(payload)
  })

  ipcMain.handle('localModManager:unbind', async (_event, payload = {}) => {
    return await unbindLocalManagedMod(payload)
  })

  ipcMain.handle('localModManager:delete', async (_event, payload = {}) => {
    return await deleteLocalManagedMod(payload)
  })
}
