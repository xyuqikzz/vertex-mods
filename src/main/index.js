import { nativeText } from './services/uiLanguage.js'
import { mainWindow, getMainWindow, setMainWindow } from './windows/mainWindow.js'
import { pathToFileURL } from 'node:url'
import { trustLocalWindow } from './security/windows.js'
import { openWebExternal, installWindowSecurity } from './security/windows.js'
import { restrictWindowNavigation } from './security/windowPolicy.js'
// 导入 Electron 核心模块和工具库
import { app, BrowserWindow, dialog, screen } from 'electron'
import { ipcMain } from './security/ipc.js' // 主进程核心模块
import { join } from 'path' // 路径处理工具
import { electronApp, is, optimizer } from '@electron-toolkit/utils' // Electron 工具库
import { startRegistration } from './ipc' // 自定义 IPC 通信模块
import { bindAssistantWindowToMainWindow, registerAssistantWindowIpc } from './assistantWindow.js'
import {
  normalizeLaunchArg,
  normalizeLaunchIntent,
  resolveLaunchIntent
} from './launchIntent.js'
import {
  reportMainProcessError,
  reportProcessGone
} from './statistics/statistics-error-reporter.js'

// ========== 全局异常捕获：阻止 JS 报错弹窗 ==========
// 覆盖默认错误弹窗行为，防止未捕获异常弹出系统对话框
dialog.showErrorBox = (title, content) => {
  console.error(`[全局错误拦截] ${title}: ${content}`)
}

// 捕获主进程未捕获异常
process.on('uncaughtException', (error) => {
  console.error('[主进程] 未捕获异常:', error?.message || error)
  console.error(error?.stack || '')
  reportMainProcessError(error, {
    errorType: 'main_uncaught_exception'
  })
})

// 捕获主进程未处理的 Promise 拒绝
process.on('unhandledRejection', (reason) => {
  console.error('[主进程] 未处理的 Promise 拒绝:', reason)
  reportMainProcessError(reason, {
    errorType: 'main_unhandled_rejection'
  })
})
// 初始化应用基础配置模块
import './initPath'
import './storage/store/index'
import store, { initializeSecureSettings } from './storage/store/index.js'
import { debounce } from './ipc/tool.js'
import { createTray, registerAgreement } from './system/index.js'
import './db/index.js'
import './utils/require.js'
import { initUpdater } from './update/index.js'
import { clearTempFiles } from './ipc/download/method.js'
import { cleanUselessData } from './db/mods/maintenance.js'
import { syncGameNameDictOnce } from './ipc/game/gameNameDict.js'
import { reconcileThunderstoreStorageOnStartup } from './services/profiles/thunderstoreStorage.js'
import { recoverInstalledConfigState } from './services/gameOperations.js'
import { recoverPendingDeploymentSessions } from './ipc/game/deployReconciler.js'
import {
  runTranslationRuntimeProbe,
  setTranslationRuntimeStatusNotifier
} from './services/translation/translationRuntime.js'
import {
  isNxmProtocolUrl,
  routeNexusAuthorizationUrl
} from './services/nexusAuthorizationRouter.js'
import {
  getAllActiveLockableMods,
  getAllInactiveLockedMods,
  updateModSourceLockState
} from './db/mods/mods.js'
import {
  inspectModSourceLock,
  lockModSource,
  repairModSourceLock,
  unlockModSource
} from './services/modSourceFileLock.js'
import {
  getElevatedModSourceRepairRequestPath,
  runElevatedModSourceRepairHelper
} from './services/modSourceProtectionElevation.js'

installWindowSecurity()

const { VITE_APP_ID, VITE_APP_NAME } = import.meta.env

// 声明主窗口变量和应用状态
let startupMaintenanceScheduled = false
let updaterInitialized = false

setTranslationRuntimeStatusNotifier((status) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed()) {
      return
    }
    window.webContents.send('translationRuntime:statusChanged', status)
  })
})

function dispatchSupportedProtocolUrl(rawUrl = '', targetWindow = mainWindow) {
  const protocolUrl = normalizeLaunchArg(rawUrl)
  if (!protocolUrl || !targetWindow || targetWindow.isDestroyed()) {
    return
  }

  if (isNxmProtocolUrl(protocolUrl)) {
    routeNexusAuthorizationUrl(protocolUrl)
    return
  }

  try {
    const u = new URL(protocolUrl)
    let pagePath = u.pathname
    if (!pagePath.startsWith('/')) {
      pagePath = '/' + pagePath
    }
    pagePath = pagePath.replace(/\/+/g, '/')
    const searchParams = u.searchParams
    const data = searchParams.size > 0 ? Object.fromEntries(searchParams) : null
    targetWindow.webContents.send('openSpecifiedLink', {
      page: pagePath || '/',
      data
    })
  } catch (error) {
    console.log('链接解析失败:', error)
  }
}

const defaultWidth = 1520 // 应用窗口默认宽度，适配 1080p 主流桌面
const defaultHeight = 730 // 应用窗口默认高度，保留更多垂直内容
const minWidth = 1520 // 应用窗口最小宽度，兼容 Windows 原生半屏吸附
const minHeight = 730 // 应用窗口最小高度
const CHROMIUM_FEATURES = {
  parallelDownloading: 'ParallelDownloading'
}

function enableChromiumFeature(featureName = '') {
  const safeFeatureName = String(featureName || '').trim()
  if (!safeFeatureName) {
    return false
  }

  const currentFeatures = String(app.commandLine.getSwitchValue('enable-features') || '')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean)

  if (currentFeatures.includes(safeFeatureName)) {
    return true
  }

  currentFeatures.push(safeFeatureName)
  app.commandLine.removeSwitch('enable-features')
  app.commandLine.appendSwitch('enable-features', currentFeatures.join(','))
  return app.commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .map((feature) => feature.trim())
    .includes(safeFeatureName)
}

if (enableChromiumFeature(CHROMIUM_FEATURES.parallelDownloading)) {
  console.log('[浏览器下载] 多线程下载已支持')
}

function wait(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildRendererDevUrlCandidates(rendererUrl = '') {
  const base = String(rendererUrl || '').trim()
  if (!base) return []

  const list = [base]
  try {
    const url = new URL(base)
    const host = String(url.hostname || '').toLowerCase()
    const port = Number(url.port || 0)
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (!isLocalHost || !Number.isFinite(port) || port <= 0) {
      return list
    }

    for (let i = 1; i <= 4; i += 1) {
      const next = new URL(base)
      next.port = String(port + i)
      list.push(next.toString())
    }
  } catch (error) {
    console.error('[主窗口加载] 解析开发地址失败', error)
  }

  return Array.from(new Set(list))
}

async function loadRendererContent(mainWindow) {
  const rendererUrl = String(process.env['ELECTRON_RENDERER_URL'] || '').trim()

  if (is.dev && rendererUrl) {
    const candidates = buildRendererDevUrlCandidates(rendererUrl)
    for (const candidate of candidates) {
      try {
        trustLocalWindow(mainWindow, candidate)
        await mainWindow.loadURL(candidate)
        if (candidate !== rendererUrl) {
          console.warn(`[主窗口加载] 已切换开发地址: ${candidate}`)
        }
        return
      } catch (error) {
        console.error(`[主窗口加载] 开发地址加载失败: ${candidate}`, error?.message || error)
        await wait(250)
      }
    }
    console.warn('[主窗口加载] 开发地址均不可用，回退到本地文件')
  }

  trustLocalWindow(mainWindow, pathToFileURL(join(__dirname, '../renderer/index.html')).href)
  await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function scheduleStartupMaintenance() {
  if (startupMaintenanceScheduled) {
    return
  }

  startupMaintenanceScheduled = true
  setTimeout(() => {
    clearTempFiles().catch((error) => {
      console.error('[启动清理] 下载残留清理失败', error)
    })

    try {
      cleanUselessData()
    } catch (error) {
      console.error('[启动清理] 无效数据清理失败', error)
    }

    syncGameNameDictOnce({ reason: 'startup' }).catch((error) => {
      console.error('[游戏名称字典] 启动同步异常', error)
    })

    runTranslationRuntimeProbe({ reason: 'startup' }).catch((error) => {
      console.error('[翻译自检] Edge 翻译启动自检失败', error?.message || error)
    })

    reconcileThunderstoreStorageOnStartup({
      onProgress(payload) {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send('thunderstore-storage-migration-progress', payload)
      }
    })
      .then((result) => {
        if (result?.deferred) {
          console.warn('[thunderstore-storage] 启动迁移已延后', result.message)
        }
      })
      .catch((error) => {
        console.error('[thunderstore-storage] 启动迁移失败', error)
      })
      .finally(() => {
        syncModSourceLocksOnStartup().catch((error) => {
          console.error('[模组源文件锁] 启动同步异常', error)
        })
      })
  }, 0)
}

async function syncModSourceLocksOnStartup() {
  try {
    const activeMods = getAllActiveLockableMods()
    for (const mod of activeMods) {
      const id = Number(mod?.id || 0)
      if (!id) continue
      try {
        const storedState = String(mod?.source_lock_state || '').trim().toLowerCase()
        let lockRes
        if (storedState === 'locked') {
          const inspection = await inspectModSourceLock(mod)
          if (inspection.success) {
            continue
          }
          lockRes = await repairModSourceLock(mod)
        } else if (storedState === 'repair_required') {
          lockRes = await repairModSourceLock(mod)
        } else {
          lockRes = await lockModSource(mod)
        }
        const state = lockRes.success ? 'locked' : 'repair_required'
        try {
          updateModSourceLockState(id, state)
        } catch (err) {
          console.warn('[模组源文件锁] 启动加锁状态写回失败', id, err)
        }
        if (!lockRes.success) {
          console.warn('[模组源文件锁] 启动修复失败，需处理旧 ACL', id, lockRes)
        }
      } catch (err) {
        console.warn('[模组源文件锁] 启动加锁异常', id, err)
      }
    }

    const inactiveLockedMods = getAllInactiveLockedMods()
    for (const mod of inactiveLockedMods) {
      const id = Number(mod?.id || 0)
      if (!id) continue
      try {
        const unlockRes = await unlockModSource(mod)
        const state = unlockRes.success ? 'unlocked' : 'repair_required'
        try {
          updateModSourceLockState(id, state)
        } catch (err) {
          console.warn('[模组源文件锁] 启动解锁状态写回失败', id, err)
        }
        if (!unlockRes.success) {
          console.warn('[模组源文件锁] 启动解锁失败', id, unlockRes)
        }
      } catch (err) {
        console.warn('[模组源文件锁] 启动解锁异常', id, err)
      }
    }
  } catch (error) {
    console.error('[模组源文件锁] 启动同步执行异常', error)
  }
}

function normalizeWindowDimension(value, fallback, min, max) {
  const number = Number(value)
  const target = Number.isFinite(number) && number > 0 ? number : fallback
  return Math.round(Math.min(Math.max(target, min), max))
}

/**
 * 创建主应用窗口函数
 * 处理窗口尺寸计算、窗口配置和内容加载
 */
function createWindow() {
  // 获取主显示器的工作区域尺寸
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const effectiveMinWidth = Math.min(screenWidth, minWidth)
  const effectiveMinHeight = Math.min(screenHeight, minHeight)

  const savedWindow = store.get('systemConfig.window') || {}
  const savedWidth = savedWindow.currentWidth
  const savedHeight = savedWindow.currentHeight
  const currentWidth = normalizeWindowDimension(
    savedWidth,
    defaultWidth,
    effectiveMinWidth,
    screenWidth
  )
  const currentHeight = normalizeWindowDimension(
    savedHeight,
    defaultHeight,
    effectiveMinHeight,
    screenHeight
  )

  if (currentWidth !== savedWidth) {
    store.set('systemConfig.window.currentWidth', currentWidth)
  }
  if (currentHeight !== savedHeight) {
    store.set('systemConfig.window.currentHeight', currentHeight)
  }

  // 创建主窗口实例并进行详细配置
  setMainWindow(new BrowserWindow({
    width: currentWidth, // 初始宽度
    height: currentHeight, // 初始高度
    minWidth: effectiveMinWidth, // 动态最小宽度（考虑屏幕尺寸）
    minHeight: effectiveMinHeight, // 动态最小高度（考虑屏幕尺寸）
    center: true, // 窗口在屏幕居中显示
    show: false, // 初始隐藏窗口（避免空白闪烁）
    title: VITE_APP_NAME || 'Vertex', // 原生标题栏标题
    frame: true, // 使用系统原生窗口框架，支持原生吸附和 Snap Layout
    autoHideMenuBar: true, // 自动隐藏菜单栏
    transparent: false, // 原生窗口不使用透明无边框
    icon: join(__dirname, '../../resources/icon.ico'), // Windows 平台应用图标
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'), // 预加载脚本路径
      sandbox: true,
      contextIsolation: true, // 上下文隔离（安全必须）
      nodeIntegration: false, // 禁用 Node 集成（安全必须）
      webviewTag: true, // 允许渲染层在受控页面内嵌站点详情
      webSecurity: true
    }
  }))

  createTray(mainWindow)
  mainWindow.on('close', (event) => {
    const closeWindowType = store.get('systemConfig.settings.closeWindowType')
    if (closeWindowType === 'toTray' && !app.isQuiting) {
      event.preventDefault()
      mainWindow.setSkipTaskbar(true)
      mainWindow.hide()
      return
    }
  })

  const syncWindowMaxState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const isMax = mainWindow.isMaximized()
    store.set('systemConfig.window.isMax', isMax)
    mainWindow.webContents.send('windowIsMaxChange', isMax)
  }

  // 窗口准备就绪事件处理
  mainWindow.once('ready-to-show', () => {
    mainWindow.show() // 完全初始化后显示窗口
    // 开发环境下自动打开开发者工具
    if (is.dev) mainWindow.webContents.openDevTools({ mode: 'undocked' })
    mainWindow.webContents.send('app-out-clear-data')
    syncWindowMaxState()
    scheduleStartupMaintenance()
  })

  // 处理外部链接打开请求
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isNxmProtocolUrl(url)) {
      const routeResult = routeNexusAuthorizationUrl(url)
      if (!routeResult.handled) {
        dispatchSupportedProtocolUrl(url)
      }
      return { action: 'deny' }
    }

    openWebExternal(url).catch(() => console.warn('[安全] 外链被拒绝或打开失败')) // 使用系统默认浏览器打开外部链接
    return { action: 'deny' } // 阻止在应用内创建新窗口
  })

  // 阻止将文件拖入窗口时触发 file:// 导航（否则表现成禁用拖放或白屏）
  restrictWindowNavigation(mainWindow.webContents)

  // 加载应用内容（区分开发环境与生产环境）
  // 开发环境优先加载热更新地址，失败时自动回退
  loadRendererContent(mainWindow).catch((error) => {
    console.error('[主窗口加载] 资源加载失败', error)
  })

  // 监听窗口最大化状态变化，始终以窗口真实状态为准
  mainWindow.on('maximize', syncWindowMaxState)
  mainWindow.on('unmaximize', syncWindowMaxState)
  mainWindow.on('restore', syncWindowMaxState)

  // 防抖处理 resize 事件
  mainWindow.on(
    'resize',
    debounce(() => {
      const isFullScreen = mainWindow.isFullScreen()
      const isMaximized = mainWindow.isMaximized()
      if (!isFullScreen && !isMaximized) {
        const [width, height] = mainWindow.getSize()
        store.set('systemConfig.window.currentWidth', width)
        store.set('systemConfig.window.currentHeight', height)
      }
    }, 100)
  )
}

function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  createWindow()
  bindAssistantWindowToMainWindow(getMainWindow)

  if (!updaterInitialized) {
    initUpdater(mainWindow)
    updaterInitialized = true
  }

  return mainWindow
}

function focusMainWindow(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return
  if (targetWindow.isMinimized()) targetWindow.restore()
  targetWindow.show()
  targetWindow.focus()
}

function dispatchProtocolWhenMainReady(protocolUrl = '') {
  const targetWindow = ensureMainWindow()
  if (!targetWindow || targetWindow.isDestroyed()) return

  const dispatch = () => {
    if (!targetWindow.isDestroyed()) {
      dispatchSupportedProtocolUrl(protocolUrl, targetWindow)
    }
  }

  if (targetWindow.webContents.getURL() && !targetWindow.webContents.isLoadingMainFrame()) {
    dispatch()
    focusMainWindow(targetWindow)
    return
  }

  targetWindow.webContents.once('did-finish-load', () => {
    dispatch()
    focusMainWindow(targetWindow)
  })
}

function dispatchOfflinePackWhenMainReady(packagePath = '') {
  const targetWindow = ensureMainWindow()
  if (!targetWindow || targetWindow.isDestroyed()) return

  const dispatch = () => {
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send('offline-pack:open', { packagePath })
    }
  }

  if (targetWindow.webContents.getURL() && !targetWindow.webContents.isLoadingMainFrame()) {
    dispatch()
    focusMainWindow(targetWindow)
    return
  }

  targetWindow.webContents.once('did-finish-load', () => {
    dispatch()
    focusMainWindow(targetWindow)
  })
}

function handleLaunchIntent(intent = { type: 'main' }) {
  if (intent?.type === 'offline-pack' && intent.filePath) {
    dispatchOfflinePackWhenMainReady(intent.filePath)
    return {
      success: true
    }
  }

  if (intent?.type === 'protocol' && intent.url) {
    dispatchProtocolWhenMainReady(intent.url)
    return {
      success: true
    }
  }

  focusMainWindow(ensureMainWindow())
  return {
    success: true
  }
}

const elevatedModSourceRepairRequestPath = getElevatedModSourceRepairRequestPath(process.argv)

if (elevatedModSourceRepairRequestPath) {
  app
    .whenReady()
    .then(async () => {
      const result = await runElevatedModSourceRepairHelper(elevatedModSourceRepairRequestPath)
      app.exit(result?.success ? 0 : 1)
    })
    .catch((error) => {
      console.error('[mod lock] 提权修复进程执行失败', error)
      app.exit(1)
    })
} else {
  const initialLaunchIntent = resolveLaunchIntent(process.argv, {
    skipInitialArgs: is.dev ? 2 : 1
  })
  const gotSingleInstanceLock = app.requestSingleInstanceLock({
    launchIntent: initialLaunchIntent
  })

  if (!gotSingleInstanceLock) {
    app.quit()
  }

  // 应用启动初始化流程
  if (gotSingleInstanceLock) {
    app.whenReady().then(async () => {
    try {
      initializeSecureSettings()
    } catch (error) {
      const reason = /^[a-z_]{1,80}$/.test(String(error?.message || ''))
        ? error.message : 'secure_settings_initialization_failed'
      console.error('[安全配置] 初始化失败:', reason)
      dialog.showMessageBoxSync({ type: 'error', title: nativeText('secureConfigTitle'), message: nativeText('secureConfigBody') })
      app.quit()
      return
    }
    // 设置 Windows 应用模型 ID
    electronApp.setAppUserModelId(VITE_APP_ID)
    if (!(is.dev && process.env['ELECTRON_RENDERER_URL'])) {
      app.commandLine.appendSwitch('enable-unsafe-webgpu')
    }

    ipcMain.once('getAppVersion', (event) => {
      const version = app.getVersion()
      // Runtime details for the About page's "copy version info" (no user or path data).
      event.reply('getAppVersionSuccess', {
        version,
        runtime: {
          platform: process.platform,
          arch: process.arch,
          osVersion: process.getSystemVersion?.() || '',
          electron: process.versions.electron || '',
          chrome: process.versions.chrome || '',
          node: process.versions.node || ''
        }
      })
    })

    registerAgreement()
    try {
      const recovery = await recoverPendingDeploymentSessions()
      if (!recovery.success) dialog.showMessageBoxSync({ type: 'warning', title: nativeText('deploymentRepairTitle'), message: nativeText('deploymentRepairBody') })
    } catch (error) {
      console.error('模组部署启动恢复失败', error?.message)
    }
    try {
      const recovery = await recoverInstalledConfigState()
      if (!recovery.success) dialog.showMessageBoxSync({ type: 'warning', title: nativeText('configRecoveryTitle'), message: nativeText('configRecoveryCount', { count: recovery.failures.length }) })
    } catch (error) {
      console.error('安装配置启动恢复失败', error?.code || error?.name)
      dialog.showMessageBoxSync({ type: 'warning', title: nativeText('configRecoveryTitle'), message: nativeText('configRecoveryFailed') })
    }
    // 初始化 IPC 通信
    await startRegistration()
    registerAssistantWindowIpc(getMainWindow)

    // 全局窗口快捷键配置
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window) // 启用窗口快捷键监听
    })

    app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
      const intent = normalizeLaunchIntent(additionalData?.launchIntent, commandLine, {
        skipInitialArgs: 1
      })
      if (intent.type === 'protocol') {
        console.log(
          '[协议启动] 已接收外部协议链接',
          isNxmProtocolUrl(intent.url) ? 'nxm' : 'vertex'
        )
      }
      handleLaunchIntent(intent)
    })

    handleLaunchIntent(initialLaunchIntent)
    })
  }
}

// 处理所有窗口关闭事件
app.on('window-all-closed', () => {
  app.quit()
})

// 渲染进程崩溃处理：仅记录日志，不弹窗
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error('[主进程] 渲染进程异常退出:', details?.reason || 'unknown', details)
  reportProcessGone('render_process_gone', details)
})

app.on('child-process-gone', (_event, details) => {
  console.error('[主进程] 子进程异常退出:', details?.type || 'unknown', details)
  reportProcessGone('child_process_gone', details)
})

app.on('before-quit', () => {
  app.isQuiting = true
})
