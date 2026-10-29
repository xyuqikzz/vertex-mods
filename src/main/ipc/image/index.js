import { ipcMain } from '../../security/ipc.js'

import { captureArea, closeOverlay, createOverlay } from './method.js'

export function imageIndex() {
  // 打开截图覆盖层
  ipcMain.handle('create-overlay', async () => {
    await createOverlay()
  })

  // 关闭覆盖窗口
  ipcMain.handle('close-overlay', () => {
    closeOverlay()
  })

  // 获取截图至粘贴板
  ipcMain.on('capture-area', async (event, rect) => {
    await captureArea(event, rect)
  })
}
