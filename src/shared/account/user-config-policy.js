// 只清理已退出的 Vertex 权益；平台授权、账号状态和用户自己填写的配置原样保留。
const retiredUserFields = [
  'level', 'experience', 'points', 'memberInfo', 'membershipLevel', 'vipExpire',
  'iconConfig', 'isMax', 'nextLevelExperience', 'maxPackLimit', 'modpackNum',
  'dailyDownloadTraffic', 'todayUsedDownloadTraffic', 'membershipExtraTraffic',
  'todayPurchasedTraffic', 'availableTrafficBytes', 'canDirectDownload',
  'downloadNum', 'downloadLimit', 'isUploadModule', 'isModReviewWhitelist'
]

const retiredConfigFields = [
  'proConfig', 'runtimeProConfig', 'proAiConfigMode', 'serverAiConfig', 'serverModioApi', 'encryptionKey', 'originalKey', 'devCode'
]

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function stripUserEntitlements(value = {}) {
  const result = { ...object(value) }
  for (const key of retiredUserFields) delete result[key]
  return result
}

export function isUserApiConfig(value = {}) {
  const source = String(value?.apiKeySource || value?.source || '').trim().toLowerCase()
  return source !== 'pro' && source !== 'server'
}

export function sanitizeUserApiConfig(value = {}) {
  const result = { ...object(value) }
  const originalConfigs = Array.isArray(result.apiConfigs) ? result.apiConfigs : null
  if (!isUserApiConfig(result)) {
    for (const key of ['apiKey', 'aiApiKey', 'key', 'apikey', 'apiKeys', 'apiConfigs', 'keys']) {
      delete result[key]
    }
    result.apiKey = ''
    delete result.source
    result.apiKeySource = ''
  }
  if (originalConfigs) {
    result.apiConfigs = originalConfigs.filter(isUserApiConfig).map((item) => ({ ...item }))
    // 旧快照可能把所选项密钥复制到顶层；删除来源项时不能让这个副本变成“本地配置”。
    const retiredKeys = originalConfigs.filter((item) => !isUserApiConfig(item)).map((item) => item.apiKey)
    if (result.apiKey && retiredKeys.includes(result.apiKey)) result.apiKey = ''
  }
  return result
}

export function sanitizeUserSystemConfig(value = {}) {
  const result = { ...object(value) }
  // 旧配置在启动迁移及保存时移除已下线的本地加速开关。
  delete result.sourceNetworkLocalAcceleration
  for (const key of retiredConfigFields) delete result[key]
  for (const key of ['nexusApi', 'modioApi', 'aiTranslation', 'aiAgent']) {
    if (result[key]) result[key] = sanitizeUserApiConfig(result[key])
  }
  if (result.nexusApi) {
    delete result.nexusApi.applicationName
    delete result.nexusApi.applicationVersion
  }
  return result
}

export function sanitizeUserState(value = {}) {
  const result = { ...object(value) }
  for (const key of retiredConfigFields) delete result[key]
  if (result.userInfo) result.userInfo = stripUserEntitlements(result.userInfo)
  if (Array.isArray(result.savedAccounts)) {
    result.savedAccounts = result.savedAccounts.map((account) => {
      const clean = stripUserEntitlements(account)
      for (const key of retiredConfigFields) delete clean[key]
      if (clean.userInfo) clean.userInfo = stripUserEntitlements(clean.userInfo)
      return clean
    })
  }
  return result
}

export function migrateUserLocalStorage(storage) {
  // 每次启动都执行幂等清理，避免旧窗口或旧版本留下的持久化状态再次被 hydrate。
  for (const key of [...retiredConfigFields, 'configStore']) storage.removeItem(key)
  for (const key of ['userStore', 'savedAccounts', 'systemConfig']) {
    const raw = storage.getItem(key)
    if (!raw) continue
    let value
    try { value = JSON.parse(raw) } catch { continue }
    const clean = key === 'savedAccounts'
      ? sanitizeUserState({ savedAccounts: value }).savedAccounts
      : key === 'systemConfig'
        ? (value?.settings ? { ...value, settings: sanitizeUserSystemConfig(value.settings) } : sanitizeUserSystemConfig(value))
        : sanitizeUserState(value)
    storage.setItem(key, JSON.stringify(clean))
  }
}

export function migrateUserMainStore(store) {
  const settings = store.get('systemConfig.settings')
  if (settings) store.set('systemConfig.settings', sanitizeUserSystemConfig(settings))
  for (const key of [...retiredConfigFields, 'config', 'dbData.config']) store.delete(key)
  const user = store.get('user')
  if (user) store.set('user', sanitizeUserState(stripUserEntitlements(user)))
  const dbUser = store.get('dbData.user')
  if (dbUser) store.set('dbData.user', sanitizeUserState(stripUserEntitlements(dbUser)))
}
