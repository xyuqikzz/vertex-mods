import { ipcMain } from '../../security/ipc.js'
import { searchLocalInstallFiles } from './medhod.js'

export function updateIndex() {
  ipcMain.on('searchLocalInstallFiles', async (event, data) => {
    await searchLocalInstallFiles(event, data)
  })
}
