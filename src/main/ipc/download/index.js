import { ipcMain } from '../../security/ipc.js'
import {
  addTasksToQueue,
  clearAllDownloadRecords,
  deleteDownloadRecord,
  getDownloadList,
  initDownloadManager,
  markDownloadRecordOpenable,
  removeDownloadTask
} from './method'

export function downloadIndex() {
  initDownloadManager()

  ipcMain.on('getDownloadList', (event, param) => {
    getDownloadList(event, param)
  })

  ipcMain.on('addTasksToQueue', (event, item) => {
    addTasksToQueue(event, item)
  })

  ipcMain.on('removeDownloadTask', async (event, id) => {
    await removeDownloadTask(event, id)
  })

  ipcMain.handle('deleteDownloadRecord', deleteDownloadRecord)

  ipcMain.on('clearAllDownloadRecords', async (event) => {
    clearAllDownloadRecords(event)
  })

  ipcMain.handle('markDownloadRecordOpenable', async (event, payload = {}) => {
    return markDownloadRecordOpenable(event, payload)
  })
}
