import { ipcMain } from '../../security/ipc.js'
import { requestInitLocalData } from './medthod.js'

export function dataIndex() {
  ipcMain.on('requestInitLocalData', (event) => {
    requestInitLocalData(event)
  })
}
