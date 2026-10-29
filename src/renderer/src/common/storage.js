const StorageType = {
  LOCAL: 'local',
  SESSION: 'session'
}

class StorageUtil {
  constructor(type = StorageType.LOCAL) {
    this.storage = type === StorageType.LOCAL ? localStorage : sessionStorage
  }

  set(key, value) {
    if (typeof value === 'object') {
      this.storage.setItem(key, JSON.stringify(value))
    } else {
      this.storage.setItem(key, value)
    }
  }

  get(key) {
    const value = this.storage.getItem(key)
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  remove(key) {
    this.storage.removeItem(key)
  }

  clear() {
    this.storage.clear()
  }

  keys() {
    return Object.keys(this.storage)
  }

  has(key) {
    return this.get(key) !== null
  }

  size() {
    return this.storage.length
  }
}

// 创建实例
const localStore = new StorageUtil(StorageType.LOCAL)
const sessionStore = new StorageUtil(StorageType.SESSION)

// 导出常用方法
export const useStorage = () => {
  return {
    local: {
      set: (key, value) => localStore.set(key, value),
      get: (key) => localStore.get(key),
      remove: (key) => localStore.remove(key),
      clear: () => localStore.clear(),
      keys: () => localStore.keys(),
      has: (key) => localStore.has(key),
      size: () => localStore.size()
    },
    session: {
      set: (key, value) => sessionStore.set(key, value),
      get: (key) => sessionStore.get(key),
      remove: (key) => sessionStore.remove(key),
      clear: () => sessionStore.clear(),
      keys: () => sessionStore.keys(),
      has: (key) => sessionStore.has(key),
      size: () => sessionStore.size()
    }
  }
}

// 默认导出
export default {
  local: localStore,
  session: sessionStore,
  useStorage
}
