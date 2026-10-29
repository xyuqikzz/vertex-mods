import { ipcMain } from '../../security/ipc.js'
import { executeSystemScript } from './method.js'

export function scriptIndex() {
  // 执行系统优化脚本
  ipcMain.on('executeSystemScript', async (event, data) => {
    await executeSystemScript(event, data)
  })
}
