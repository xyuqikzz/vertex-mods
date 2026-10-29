import { ipcMain } from '../../security/ipc.js'
import { getFlingTrainerDetail, getFlingTrainerList } from '../../services/trainers/catalog.js'
import { shell } from 'electron'
import { createTrainerFileService } from '../../services/trainers/files.js'
import { getTrainerDownloadRecordsDB, updateDownloadRecordFilePathDB } from '../../db/files/download.js'
import { nativeText } from '../../services/uiLanguage.js'
import { registerDlssIpc } from './dlss.js'

export function gameToolsIndex() {
  registerDlssIpc()
  const files = createTrainerFileService({
    getRecords: getTrainerDownloadRecordsDB, updateRecordPath: updateDownloadRecordFilePathDB,
    openPath: filePath => shell.openPath(filePath)
  })
  const fileOperation = async (operation, payload) => {
    const result = await files[operation](payload?.filePath)
    return result.messageKey ? { ...result, message: nativeText(result.messageKey, result.messageParams) } : result
  }

  ipcMain.handle('flingTrainer:list', async (_event, payload = {}) => {
    return getFlingTrainerList(payload)
  })

  ipcMain.handle('flingTrainer:detail', async (_event, payload = {}) => {
    return getFlingTrainerDetail(payload)
  })

  ipcMain.handle('flingTrainer:remove-file-if-unlocked', async (_event, payload = {}) => {
    return fileOperation('removeFileIfUnlocked', payload)
  })

  ipcMain.handle('flingTrainer:check-file-unlocked', async (_event, payload = {}) => {
    return fileOperation('checkFileUnlocked', payload)
  })

  ipcMain.handle('flingTrainer:run-file', async (_event, payload = {}) => {
    return fileOperation('runFile', payload)
  })
}
