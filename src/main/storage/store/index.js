import userPath from '../../initPath.js'
import Store from 'electron-store'
import { safeStorage } from 'electron'
import { createSettingsCredentialStore } from '../../security/settingsCredentials.js'
import fs from 'fs/promises'
import path from 'path'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../shared/translation/ai-translation-config.js'
import { DEFAULT_AI_AGENT_CONFIG, normalizeAiAgentConfig } from '../../../shared/ai/config/ai-agent-config.js'
import { normalizeDownloadConcurrentCount } from '../../../shared/downloads/download-config.js'
import { normalizeModioApiConfig } from '../../../shared/sources/modio-api-config.js'
import { migrateUserMainStore } from '../../../shared/account/user-config-policy.js'

// 自定义存储路径
const cwd = `${userPath}/store`

await fs.mkdir(cwd, { recursive: true }) // 异步创建文件夹

const rawStore = new Store({
  cwd,
  name: 'index',
  // A malformed file must not silently erase the encrypted account vault or legacy migration source.
  clearInvalidConfig: false
})

const store = createSettingsCredentialStore(rawStore, safeStorage)

const legacyDefaultDownloadPath = path.join(userPath, 'download')

export function getDefaultDownloadRootPath(basePath = userPath) {
  const safeBasePath = String(basePath || '').trim()

  try {
    const resolvedBasePath = safeBasePath ? path.resolve(safeBasePath) : path.resolve(userPath)
    const driveRoot = String(path.parse(resolvedBasePath).root || '').trim()
    if (driveRoot) {
      return path.join(driveRoot, 'Vertex', 'dow')
    }
  } catch (error) {
    console.log('默认下载路径解析失败，回退到用户目录', error)
  }

  return path.join(userPath, 'download')
}

function getDefaultCachePath(basePath = userPath) {
  const safeBasePath = String(basePath || '').trim()
  if (!safeBasePath) {
    return path.join(userPath, 'cache')
  }

  try {
    return path.resolve(safeBasePath, 'cache')
  } catch (error) {
    console.log('默认缓存路径解析失败，回退到用户目录', error)
    return path.join(userPath, 'cache')
  }
}

const defaultNexusApiConfig = { apiKey: '', apiKeySource: '' }

const defaultModioApiConfig = {
  baseUrl: 'https://api.mod.io/v1',
  apiKey: ''
}

function normalizeNexusApiConfig(config = {}) {
  const apiKey = String(config?.apiKey || '').trim()
  return { apiKey, apiKeySource: apiKey ? 'local' : '' }
}

export function initializeSecureSettings() {
  migrateUserMainStore(store)
  const hasSystemConfig = store.has('systemConfig')
  if (!hasSystemConfig) {
    const cachePath = getDefaultCachePath()
    const downloadPath = getDefaultDownloadRootPath()
    fs.mkdir(cachePath).then()
    fs.mkdir(downloadPath).then()

    store.set('systemConfig', {
      window: {
        isMax: false,
        currentWidth: 0,
        currentHeight: 0
      },
      settings: {
        // ============== 系统行为设置 ==============
        // 是否开机自启 ('': 关闭 | 'auto_startup': 开机自启)
        autoStartOnBoot: '',

        // 窗口关闭行为控制
        // - 'exitApp': 直接退出应用程序
        // - 'toTray': 最小化到系统托盘（需确保已启用托盘功能）
        closeWindowType: 'exitApp', // 可选值: 'exitApp' | 'toTray'

        // ============== 缓存与路径设置 ==============
        // 应用缓存目录路径（需确保目录可写）
        cachePath,

        // ============== 下载控制设置 ==============
        downloadSpeed: {
          // 限速模式 (noLimit: 不限速 | limit: 限速)
          type: 'noLimit',
          // 限速值（单位: Mb/s，范围: 1-100，仅当type=1时生效）
          speed: 1
        },

        // 下载文件保存路径
        downloadPath,

        // 模组下载时优先使用游戏所在盘符的统一缓存目录
        preferSameDriveCache: true,

        // 同时下载任务数
        downloadConcurrentCount: normalizeDownloadConcurrentCount(),

        // Nexus API 配置
        nexusApi: normalizeNexusApiConfig(defaultNexusApiConfig),

        // Mod.io API 配置
        modioApi: normalizeModioApiConfig(defaultModioApiConfig),

        // AI 翻译配置
        aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG),

        // AI Agent 独立模型配置
        aiAgent: normalizeAiAgentConfig(DEFAULT_AI_AGENT_CONFIG),

        // 安装任务完成后是否自动备份（全局）
        installTaskAutoBackup: false
      }
    })
  }

  const currentDownloadPath = String(store.get('systemConfig.settings.downloadPath') || '').trim()
  const nextDefaultDownloadPath = getDefaultDownloadRootPath()
  if (
    (!currentDownloadPath || currentDownloadPath === legacyDefaultDownloadPath) &&
    currentDownloadPath !== nextDefaultDownloadPath
  ) {
    fs.mkdir(nextDefaultDownloadPath, { recursive: true }).then()
    store.set('systemConfig.settings.downloadPath', nextDefaultDownloadPath)
  }

  const currentCachePath = String(store.get('systemConfig.settings.cachePath') || '').trim()
  const nextDefaultCachePath = getDefaultCachePath()
  if (!currentCachePath) {
    fs.mkdir(nextDefaultCachePath, { recursive: true }).then()
    store.set('systemConfig.settings.cachePath', nextDefaultCachePath)
  } else {
    fs.mkdir(currentCachePath, { recursive: true }).then()
  }

  const currentNexusApiConfig = store.get('systemConfig.settings.nexusApi')
  const normalizedNexusApiConfig = normalizeNexusApiConfig(currentNexusApiConfig)
  const needUpdateNexusApiConfig =
    !currentNexusApiConfig ||
    typeof currentNexusApiConfig !== 'object' ||
    Object.keys(normalizedNexusApiConfig).some(
      (key) => normalizedNexusApiConfig[key] !== currentNexusApiConfig[key]
    ) ||
    Object.keys(currentNexusApiConfig).some((key) => !(key in normalizedNexusApiConfig))

  if (needUpdateNexusApiConfig) {
    store.set('systemConfig.settings.nexusApi', normalizedNexusApiConfig)
  }

  const currentModioApiConfig = store.get('systemConfig.settings.modioApi')
  const normalizedModioApiConfig = normalizeModioApiConfig(currentModioApiConfig)
  const needUpdateModioApiConfig =
    !currentModioApiConfig ||
    typeof currentModioApiConfig !== 'object' ||
    Object.keys(normalizedModioApiConfig).some(
      (key) => normalizedModioApiConfig[key] !== currentModioApiConfig[key]
    ) ||
    Object.keys(currentModioApiConfig).some((key) => !(key in normalizedModioApiConfig))

  if (needUpdateModioApiConfig) {
    store.set('systemConfig.settings.modioApi', normalizedModioApiConfig)
  }

  const currentAiTranslationConfig = store.get('systemConfig.settings.aiTranslation')
  const normalizedAiTranslationConfig = normalizeAiTranslationConfig(currentAiTranslationConfig)
  const needUpdateAiTranslationConfig =
    !currentAiTranslationConfig ||
    typeof currentAiTranslationConfig !== 'object' ||
    JSON.stringify(currentAiTranslationConfig) !== JSON.stringify(normalizedAiTranslationConfig)

  if (needUpdateAiTranslationConfig) {
    store.set('systemConfig.settings.aiTranslation', normalizedAiTranslationConfig)
  }

  const currentAiAgentConfig = store.get('systemConfig.settings.aiAgent')
  const normalizedAiAgentConfig = normalizeAiAgentConfig(currentAiAgentConfig)
  const needUpdateAiAgentConfig =
    !currentAiAgentConfig ||
    typeof currentAiAgentConfig !== 'object' ||
    JSON.stringify(currentAiAgentConfig) !== JSON.stringify(normalizedAiAgentConfig)

  if (needUpdateAiAgentConfig) {
    store.set('systemConfig.settings.aiAgent', normalizedAiAgentConfig)
  }

  if (store.has('systemConfig.settings.githubDownload')) {
    store.delete('systemConfig.settings.githubDownload')
  }

  const currentDownloadConcurrentCount = store.get('systemConfig.settings.downloadConcurrentCount')
  const normalizedDownloadConcurrentCount = normalizeDownloadConcurrentCount(
    currentDownloadConcurrentCount
  )

  if (currentDownloadConcurrentCount !== normalizedDownloadConcurrentCount) {
    store.set('systemConfig.settings.downloadConcurrentCount', normalizedDownloadConcurrentCount)
  }

  if (!store.has('systemConfig.settings.preferSameDriveCache')) {
    store.set('systemConfig.settings.preferSameDriveCache', true)
  }

  if (!store.has('systemConfig.settings.statisticsEnabled'))
    store.set('systemConfig.settings.statisticsEnabled', false)
  store.secureSettings()
}

console.log('store初始化成功', store.path)

store.getStore = (key) => {
  if (!store.has(key)) {
    store.set(key, null) // 如果不存在，则设置为 null
  }
  return store.get(key) // 返回 null
}

store.setStore = (key, data) => {
  store.set(key, data) // 如果不存在，则设置为 null
}

export default store
