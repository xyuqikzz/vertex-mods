import ipcRenderer from '@renderer/common/ipcRenderer.js'

export async function requestConfigByKey(key, fallback = {}) {
  try {
    const result = await ipcRenderer.invoke('getConfigByKey', { key: String(key || '') })
    return result === null || result === undefined ? fallback : result
  } catch (error) {
    console.warn(`读取配置失败：${String(key || '')}`, error)
    return fallback
  }
}

export function requestSystemConfigSettings(fallback = {}) {
  return requestConfigByKey('systemConfig.settings', fallback)
}
