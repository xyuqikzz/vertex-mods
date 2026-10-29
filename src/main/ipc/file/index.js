import { ipcMain } from '../../security/ipc.js'
import {
  cleanupManagedFileTaskResiduals,
  deleteAllFileRecords,
  deleteInstallerBackupRecords,
  deleteManagedFileAssets,
  deleteFileRecord,
  getAllFileRecords,
  getManagedFileStats,
  listManagedFileAssets,
  markManagedFileAssets,
  openFileSelector,
  previewManagedFileDelete,
  reconcileManagedFileAssets,
  releaseManagedFileOwner,
  retryManagedFileDeleteFailed,
  scanManagedFileOrphans
} from './method'

export function fileIndex() {
  ipcMain.on('openFileSelector', (event, param) => {
    openFileSelector(event, param)
  })


  ipcMain.on('getAllFileRecords', (event, payload) => {
    getAllFileRecords(event, payload)
  })

  ipcMain.on('deleteAllFileRecords', (event, payload) => {
    deleteAllFileRecords(event, payload)
  })

  ipcMain.handle('deleteInstallerBackupRecords', deleteInstallerBackupRecords)

  ipcMain.on('deleteFileRecord', (event, item) => {
    deleteFileRecord(event, item)
  })

  ipcMain.handle('managedFile:previewDeleteAssets', async (_event, payload = {}) => {
    return await previewManagedFileDelete(payload)
  })

  ipcMain.handle('managedFile:deleteAssets', async (_event, payload = {}) => {
    return await deleteManagedFileAssets(payload)
  })

  ipcMain.handle('managedFile:releaseOwner', async (_event, payload = {}) => {
    return await releaseManagedFileOwner(payload)
  })

  ipcMain.handle('managedFile:retryDeleteFailed', async (_event, payload = {}) => {
    return await retryManagedFileDeleteFailed(payload)
  })

  ipcMain.handle('managedFile:listAssets', async (_event, payload = {}) => {
    return await listManagedFileAssets(payload)
  })

  ipcMain.handle('managedFile:getStats', async (_event, payload = {}) => {
    return await getManagedFileStats(payload)
  })

  ipcMain.handle('managedFile:scanOrphans', async (_event, payload = {}) => {
    return await scanManagedFileOrphans(payload)
  })

  ipcMain.handle('managedFile:reconcileAssets', async (_event, payload = {}) => {
    return await reconcileManagedFileAssets(payload)
  })

  ipcMain.handle('managedFile:markAssets', async (_event, payload = {}) => {
    return await markManagedFileAssets(payload)
  })

  ipcMain.handle('managedFile:cleanupTaskResiduals', async (_event, payload = {}) => {
    return await cleanupManagedFileTaskResiduals(payload)
  })
}
