function getIpcRenderer() {
  const ipcRenderer = globalThis.window?.electron?.ipcRenderer
  if (!ipcRenderer) {
    throw new Error('Electron ipcRenderer bridge unavailable')
  }
  return ipcRenderer
}

const ipcRenderer = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === 'invoke' || property === 'send') return (channel, ...args) => {
        const methods = window.api?.capabilities?.[property === 'invoke' ? 'commands' : 'notifications']
        if (!methods?.[channel]) throw new Error('ipc_channel_disabled')
        return methods[channel](...args.map(value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))))
      }
      const target = getIpcRenderer()
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_target, property, value) {
      const target = getIpcRenderer()
      target[property] = value
      return true
    },
    has(_target, property) {
      return property in getIpcRenderer()
    }
  }
)

export default ipcRenderer
