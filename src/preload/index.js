import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { INVOKE_CHANNELS, SEND_CHANNELS } from '../shared/ipc/ipc-capabilities.js'
const invokeChannels = new Set(INVOKE_CHANNELS)
const sendChannels = new Set(SEND_CHANNELS)
const listeners = new Map()
const jsonArgs = (args) => args.map(value => value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const assertChannel = (allowed, channel) => { if (!allowed.has(channel)) throw new Error('ipc_channel_disabled') }
const subscribe = (channel, callback, once = false) => {
  if (!/^[\w:.-]{1,120}$/.test(channel) || typeof callback !== 'function') throw new Error('invalid_ipc_subscription')
  const wrapped = (_event, ...args) => { if (once) remove(channel, callback); callback({}, ...args) }
  if (!listeners.has(channel)) listeners.set(channel, new Map())
  remove(channel, callback)
  listeners.get(channel).set(callback, wrapped)
  ipcRenderer.on(channel, wrapped)
  return () => remove(channel, callback)
}
const remove = (channel, callback) => {
  const wrapped = listeners.get(channel)?.get(callback)
  if (wrapped) ipcRenderer.removeListener(channel, wrapped)
  listeners.get(channel)?.delete(callback)
}
const bridge = {
  invoke(channel, ...args) { assertChannel(invokeChannels, channel); return ipcRenderer.invoke(channel, ...jsonArgs(args)) },
  send(channel, ...args) { assertChannel(sendChannels, channel); ipcRenderer.send(channel, ...jsonArgs(args)) },
  on: (channel, callback) => subscribe(channel, callback),
  once: (channel, callback) => subscribe(channel, callback, true),
  removeListener: remove,
  removeAllListeners(channel) {
    for (const callback of listeners.get(channel)?.keys() || []) remove(channel, callback)
  }
}
// Fixed business methods do not accept a caller-selected channel name.
const capabilities = { commands: {}, notifications: {} }
for (const channel of INVOKE_CHANNELS) capabilities.commands[channel] = (...args) => bridge.invoke(channel, ...args)
for (const channel of SEND_CHANNELS) capabilities.notifications[channel] = (...args) => bridge.send(channel, ...args)
const electronAPI = { ipcRenderer: bridge }


const api = {
  dlss: Object.fromEntries(INVOKE_CHANNELS.filter(channel => channel.startsWith('dlss:')).map(channel =>
    [channel.slice('dlss:'.length), (payload) => bridge.invoke(channel, payload)])),
  capabilities,
  nexusAccount: Object.fromEntries(['status', 'login', 'cancel', 'logout', 'set-mode'].map(method =>
    [method, (payload) => bridge.invoke(`nexus-account:${method}`, payload)])),
  installTasks: Object.fromEntries(INVOKE_CHANNELS.filter(channel => channel.startsWith('source-install-task:')).map(channel =>
    [channel.slice('source-install-task:'.length), (payload) => bridge.invoke(channel, payload)])),
  ai: Object.fromEntries(INVOKE_CHANNELS.filter(channel => channel.startsWith('ai-agent:')).map(channel =>
    [channel.slice('ai-agent:'.length), (payload) => bridge.invoke(channel, payload)])),
  account: Object.fromEntries(['bootstrap', 'snapshot', 'adopt', 'logout'].map(method =>
    [method, (payload) => ipcRenderer.invoke(`account:${method}`, ...jsonArgs([payload]))])),
  network: {
    request: (payload) => ipcRenderer.invoke('network:request', JSON.parse(JSON.stringify(payload))),
    cancel: (id) => ipcRenderer.invoke('network:cancel', id)
  },
  /**
   * 从拖拽等场景拿到的 File 解析本地绝对路径（Electron 高版本已移除 File.path）
   */
  getPathForFile(file) {
    try {
      if (file && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file) || ''
      }
    } catch {
      /* 非文件对象或环境异常时忽略 */
    }
    return ''
  }
}
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('screenshotAPI', {
      // 暴露新增的IPC方法
      createOverlay: () => ipcRenderer.invoke('create-overlay'),
      closeOverlay: () => ipcRenderer.invoke('close-overlay')
    })
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
