import { onUnmounted } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'

export function useIpc(channel, callback) {
  // 创建具名回调函数
  const handler = (event, ...args) => callback(...args)
  ipcRenderer.on(channel, handler)

  // 组件卸载时自动清理
  onUnmounted(() => {
    ipcRenderer.removeListener(channel, handler)
  })
}
