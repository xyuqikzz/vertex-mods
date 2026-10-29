import { nativeText } from '../../services/uiLanguage.js'
import { openWebExternal } from '../../security/windows.js'
import { setWindowsWallpaper } from '../../services/wallpaper.js'
import store from '../../storage/store/index.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import { getMainWindow } from '../../windows/mainWindow.js'
import AutoStartManager from '../autoStartManager.js'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs-extra'
import path from 'path'
import si from 'systeminformation'
import {
  getFullSystemInfo,
  getLogicalDrives,
  getPcBaseboardInfo,
  getPcCpuInfo,
  getPcDiskInfo,
  getPcGpuInfo,
  getPcMemoryInfo,
  finalizeDataMigration,
  migrateData,
  openPath,
  rollbackDataMigration
} from '../tool.js'

import { createInstalledAppOperations } from '../../services/installedAppOperations.js'
import userPath from '../../initPath.js'
import {
  cleanupUninstallResiduals,
  getAppIconData,
  listInstalledApps,
  runUninstallAndWait,
  scanUninstallResiduals
} from '../../utils/appUninstall.js'
import {
  hasActiveThunderstoreDownloadTasks,
  syncDownloadManagerConcurrency
} from '../download/method.js'
import { migrateThunderstoreStorage } from '../../services/profiles/thunderstoreStorage.js'

function getDefaultDownloadRootPath(basePath = userPath) {
  const safeBasePath = String(basePath || '').trim()

  try {
    const resolvedBasePath = safeBasePath ? path.resolve(safeBasePath) : path.resolve(userPath)
    const driveRoot = String(path.parse(resolvedBasePath).root || '').trim()
    if (driveRoot) {
      return path.join(driveRoot, 'Vertex', 'dow')
    }
  } catch (error) {
    console.log('默认下载路径解析失败，回退到文档目录', error)
  }

  return path.join(app.getPath('documents'), 'Vertex', 'dow')
}
import { isProtocolTarget, launchTargetByNodeApi } from '../../api/index.js'

const execAsync = promisify(exec)

// 窗口操作
export function windowOperation(_event, data) {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return

  const type = store.get('systemConfig.settings.closeWindowType')

  switch (data) {
    case 0:
      if (!mainWindow.isMinimized()) {
        mainWindow.minimize()
      }
      break
    case 1:
      if (!mainWindow.isMaximized()) {
        mainWindow.maximize()
      } else {
        mainWindow.unmaximize()
      }
      break
    case 2:
      if (type === 'toTray') {
        mainWindow.setSkipTaskbar(true)
        mainWindow.hide()
        return
      }
      mainWindow.close()
      break
  }
}

// 扫描所有硬盘信息
export async function scanDisk(event, data) {
  const replyName = data
  try {
    const [logicalDrives] = await Promise.all([getLogicalDrives()])
    event.reply(`scanDiskSuccess-${replyName}`, logicalDrives)
  } catch (e) {
    event.reply(`scanDiskFail-${replyName}`, e)
  }
}

// 打开系统指定路径（如果是文件就高亮显示）
export function openSpecifyPath(event, data) {
  openPath(event, data).then()
}

// 扫描设备信息
function cleanData(data) {
  try {
    return JSON.parse(JSON.stringify(data))
  } catch (e) {
    console.log(e)
    return null
  }
}

async function getDeviceInfo(event, options = {}) {
  const silent = options?.silent === true
  const reply = (channel, payload) => {
    if (silent) return
    if (event && typeof event.reply === 'function') {
      event.reply(channel, payload)
    }
  }
  const fetchEvent = silent ? { reply: () => {} } : event

  const dataList = [
    { name: '操作系统', field: 'system', fetch: getFullSystemInfo },
    { name: '处理器', field: 'cpu', fetch: getPcCpuInfo },
    { name: '显卡', field: 'gpu', fetch: getPcGpuInfo },
    { name: '主板', field: 'baseboard', fetch: getPcBaseboardInfo },
    { name: '硬盘', field: 'disks', fetch: getPcDiskInfo },
    { name: '内存', field: 'memory', fetch: getPcMemoryInfo }
    // { name: '显示器', field: 'monitor', fetch: getPcMonitorInfo }
  ]

  const dataObj = {}
  const totalSteps = dataList.length
  const progressStart = 14
  const progressEnd = 96
  const progressStep = Math.floor((progressEnd - progressStart) / totalSteps)
  let timeoutTriggered = false

  // 超时控制
  const timeout = setTimeout(() => {
    timeoutTriggered = true
    reply('scanDeviceInfoFail', { error: '查询超时' })
  }, 60000) // 60s

  // 初始进度
  reply('deviceScanning', { name: '', num: 0 })

  for (let i = 0; i < totalSteps; i++) {
    if (timeoutTriggered) break

    const { name, field, fetch } = dataList[i]
    try {
      const rawData = await fetch(fetchEvent)
      const safeData = cleanData(rawData)

      dataObj[field] = safeData
      dataList[i].data = safeData

      reply('deviceScanning', {
        name,
        num: progressStart + i * progressStep
      })
    } catch (err) {
      console.error(`Error fetching ${name}:`, err)
    }
  }

  if (!timeoutTriggered) {
    clearTimeout(timeout)

    const safeDataList = dataList.map(({ name, field, data }) => ({
      name,
      field,
      data
    }))

    reply('scanDeviceInfoSuccess', safeDataList)
    store.set('deviceInfo', safeDataList)
    return safeDataList
  }

  return null
}

export async function scanDeviceInfo(event, data) {
  if (data) {
    await getDeviceInfo(event)
  } else {
    const deviceInfo = store.get('deviceInfo')
    if (deviceInfo) {
      event.reply('scanDeviceInfoSuccess', deviceInfo)
    } else {
      await getDeviceInfo(event)
      const deviceInfo = store.get('deviceInfo')
      event.reply('scanDeviceInfoSuccess', deviceInfo)
    }
  }
}

function getNetworkTypeByInterface(network = {}) {
  const text =
    `${network.type || ''} ${network.iface || ''} ${network.ifaceName || ''}`.toLowerCase()
  if (
    text.includes('wireless') ||
    text.includes('wifi') ||
    text.includes('wi-fi') ||
    text.includes('wlan')
  ) {
    return 'wifi'
  }
  if (text.includes('ethernet') || text.includes('eth') || text.includes('lan')) {
    return 'ethernet'
  }
  return 'unknown'
}

function pickActiveNetworkInterface(interfaceList = [], preferredName = '') {
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
  const safeList = Array.isArray(interfaceList) ? interfaceList : []
  const availableList = safeList.filter(
    (item) => !item?.internal && !item?.virtual && (item?.operstate === 'up' || item?.ip4)
  )

  if (!availableList.length) {
    return null
  }

  const preferred = normalize(preferredName)
  if (!preferred) {
    return availableList[0]
  }

  const exactMatch = availableList.find((item) => {
    const keys = [item?.iface, item?.ifaceName, item?.name]
    return keys.some((key) => normalize(key) === preferred)
  })

  return exactMatch || availableList[0]
}

export async function getNetworkConnectionStatus(event) {
  try {
    const [interfaceList, defaultInterfaceName] = await Promise.all([
      si.networkInterfaces(),
      si.networkInterfaceDefault()
    ])
    const activeInterface = pickActiveNetworkInterface(interfaceList, defaultInterfaceName)

    if (!activeInterface) {
      event.reply('getNetworkConnectionStatusSuccess', {
        connected: false,
        type: 'offline',
        name: '未连接网络'
      })
      return
    }

    const ifaceName =
      activeInterface.ifaceName || activeInterface.iface || activeInterface.name || '--'
    event.reply('getNetworkConnectionStatusSuccess', {
      connected: true,
      type: getNetworkTypeByInterface(activeInterface),
      name: ifaceName
    })
  } catch (error) {
    console.error('获取网络状态失败:', error)
    event.reply('getNetworkConnectionStatusSuccess', {
      connected: false,
      type: 'offline',
      name: '未连接网络'
    })
  }
}

export function getConfigByKey(event, data) {
  const { key, replyName } = data
  const db = store.get(key)
  event.reply(replyName, db)
}

export function readConfigByKey(data = {}) {
  return store.get(String(data?.key || ''))
}

function createAiRuntimeConfigFingerprint(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {}
  return JSON.stringify({
    aiTranslation: source.aiTranslation || null,
    aiAgent: source.aiAgent || null
  })
}

function broadcastAiRuntimeConfigUpdated() {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed()) return
    window.webContents.send('system-config:updated', { scope: 'ai-runtime' })
  })
}

async function toggleBootRule(type) {
  const autoStartManager = new AutoStartManager()
  try {
    type ? await autoStartManager.enable() : await autoStartManager.disable()
  } catch (error) {
    console.error('设置自启动失败:', error)
  }
}

export function updateSystemSettings(event, data) {
  const settings = sanitizeUserSystemConfig(data)
  const previousSettings = store.get('systemConfig.settings') || {}
  // 下载路径涉及 Thunderstore 文件迁移，只允许通过 changeDownloadPath 专用流程修改。
  settings.downloadPath = previousSettings.downloadPath
  const aiRuntimeConfigChanged =
    createAiRuntimeConfigFingerprint(previousSettings) !==
    createAiRuntimeConfigFingerprint(settings)
  const autoStartEnabled = settings.autoStartOnBoot === 'auto_startup'
  const autoStartChanged =
    (previousSettings.autoStartOnBoot === 'auto_startup') !== autoStartEnabled
  store.setStore('systemConfig.settings', settings)
  if (autoStartChanged) toggleBootRule(autoStartEnabled).then()
  if ((previousSettings.statisticsEnabled === true) !== (settings.statisticsEnabled === true)) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('statistics:consent-changed', { enabled: settings.statisticsEnabled === true })
    })
  }
  syncDownloadManagerConcurrency(settings)
  if (aiRuntimeConfigChanged) {
    broadcastAiRuntimeConfigUpdated()
  }
}

export async function changeDownloadPath(event) {
  const data = store.getStore('systemConfig.settings')
  const { downloadPath = '' } = data
  const result = await dialog.showOpenDialog({
    title: nativeText('selectFolder'),
    defaultPath: downloadPath || getDefaultDownloadRootPath(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths?.[0]) {
    return {
      success: false,
      canceled: true,
      code: '',
      message: '已取消更改下载路径',
      downloadPath
    }
  }

  if (hasActiveThunderstoreDownloadTasks()) {
    return {
      success: false,
      canceled: false,
      code: 'thunderstore_storage_busy',
      message: '存在进行中或排队中的 Thunderstore 下载任务，请先完成或取消任务',
      downloadPath,
      blockingGames: []
    }
  }

  try {
    const migrationResult = await migrateThunderstoreStorage(result.filePaths[0], {
      previousDownloadPath: downloadPath,
      onProgress(payload) {
        if (!event?.sender || event.sender.isDestroyed?.()) return
        event.sender.send('thunderstore-storage-migration-progress', payload)
      }
    })
    if (event?.sender && !event.sender.isDestroyed?.()) {
      event.sender.send('update-system-config')
    }
    return migrationResult
  } catch (error) {
    return {
      success: false,
      canceled: false,
      code: String(error?.code || 'thunderstore_storage_migration_failed'),
      message: String(error?.message || '迁移 Thunderstore 文件失败'),
      downloadPath,
      migratedProfileCount: 0,
      migratedFileCount: 0,
      blockingGames: Array.isArray(error?.blockingGames) ? error.blockingGames : [],
      cleanupWarning: ''
    }
  }
}

export async function changeCachePath(event) {
  const data = store.getStore('systemConfig.settings')
  const { cachePath = '' } = data
  const result = await dialog.showOpenDialog({
    title: nativeText('selectFolder'),
    defaultPath: cachePath || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths?.[0]) {
    return {
      success: false,
      canceled: true,
      code: '',
      message: '已取消更改缓存路径',
      cachePath
    }
  }

  const selectedDirectory = path.resolve(result.filePaths[0])
  const newPath = path.join(selectedDirectory, 'cache')
  let migration = null

  try {
    migration = await migrateData(cachePath, selectedDirectory, {
      targetName: 'cache',
      concurrency: 16,
      onProgress(payload) {
        if (!event?.sender || event.sender.isDestroyed?.()) return
        event.sender.send('cache-path-migration-progress', {
          fileCount: payload.fileCount,
          sizeMB: (Number(payload.size || 0) / (1024 * 1024)).toFixed(2)
        })
      }
    })

    store.setStore('systemConfig.settings.cachePath', newPath)
    const cleanupResult = await finalizeDataMigration(migration)
    if (event?.sender && !event.sender.isDestroyed?.()) {
      event.sender.send('update-system-config')
    }
    return {
      success: true,
      canceled: false,
      code: '',
      message: '缓存路径已更新',
      cachePath: newPath,
      migratedFileCount: Number(migration?.fileCount || 0),
      migratedSizeMB: String(migration?.sizeMB || '0.00'),
      skippedLinkCount: Number(migration?.skippedLinkCount || 0),
      cleanupWarning: cleanupResult.cleanupWarning
    }
  } catch (error) {
    if (migration) {
      try {
        await rollbackDataMigration(migration)
      } catch (rollbackError) {
        error.rollbackError = rollbackError
      }
    }
    return {
      success: false,
      canceled: false,
      code: String(error?.code || 'cache_path_migration_failed'),
      message: String(error?.message || '缓存迁移失败'),
      cachePath,
      cleanupWarning: String(error?.rollbackError?.message || '')
    }
  }
}

export async function openBrowse(data) {
  const { url = '' } = data
  await openWebExternal(url)
}

export async function downloadSpecifiedLink(event, data) {
  void event
  void data
}
/**
 * 设置壁纸并最小化所有窗口
 */
export async function setImageAsWallpaper(event, imagePath) {
  try {
    const absolutePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(app.getPath('userData'), imagePath)
    if (!(await fs.stat(absolutePath)).isFile()) {
      event.reply('node-notify', {
        type: 'warning',
        message: '壁纸不存在,设置失败'
      })
      return
    }
    await setWindowsWallpaper(absolutePath)
    event.reply('node-notify', { type: 'success', message: '壁纸设置成功' })
    setTimeout(() => { minimizeAllWindows() }, 1500)
  } catch (e) {
    console.log('setImageAsWallpaper', e)
    event.reply('node-notify', {
      type: 'warning',
      message: '设置壁纸失败，请检查图片是否可用后重试'
    })
  }
}
/**
 * 最小化所有窗口（Windows专用）
 */
async function minimizeAllWindows() {
  try {
    await execAsync('powershell -command "(New-Object -ComObject Shell.Application).MinimizeAll()"')
  } catch (error) {
    console.error('最小化窗口失败', error)
  }
}

// 错误代码映射（包含暂时性错误标记）
const ERROR_CODE_MAP = {
  53: {
    message: '游戏正在启动中，请稍候...',
    isTransient: true // 标记为暂时性错误
  },
  0xc0000135: {
    message: '游戏启动失败，请安装必要运行库'
  },
  0xc0000142: {
    message: '游戏启动失败，请尝试以管理员身份运行启动器'
  },
  default: {
    message: '游戏启动失败，请尝试手动启动'
  }
}

// 获取进程名对应的所有PID（使用WMIC更可靠）
async function getProcessIdsByName(processName) {
  return new Promise((resolve) => {
    exec(`wmic process where "name='${processName}'" get processid`, (err, stdout) => {
      if (err) return resolve([])
      const pids = stdout
        .split('\n')
        .slice(1) // 跳过标题行
        .map((line) => parseInt(line.trim()))
        .filter((pid) => !isNaN(pid))
      resolve(pids)
    })
  })
}

function normalizeLaunchArgumentList(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()
  return text ? [text] : []
}

function isWindowsCmdScriptTarget(target = '') {
  const ext = String(path.extname(String(target || '').trim()) || '')
    .trim()
    .toLowerCase()
  return ext === '.bat' || ext === '.cmd'
}

function isWindowsPowerShellScriptTarget(target = '') {
  const ext = String(path.extname(String(target || '').trim()) || '')
    .trim()
    .toLowerCase()
  return ext === '.ps1'
}

function buildWindowsCmdInvocationArgs(target = '', args = []) {
  const safeTarget = String(target || '').trim()
  const safeArgs = normalizeLaunchArgumentList(args)
  return ['/d', '/c', 'call', safeTarget, ...safeArgs]
}

export async function startSpecifiedApp(event, data) {
  const appTarget = String(data?.target || data?.path || '').trim()
  const launchArgs = normalizeLaunchArgumentList(data?.args)
  const steamAppId = String(data?.steamAppId || '').trim()
  const isProtocolLaunch = isProtocolTarget(appTarget)
  const isSteamGame = !!steamAppId || appTarget.toLowerCase().startsWith('steam://')
  const isCmdScriptLaunch = isWindowsCmdScriptTarget(appTarget)
  const isPowerShellScriptLaunch = isWindowsPowerShellScriptTarget(appTarget)
  const isScriptLaunch = isCmdScriptLaunch || isPowerShellScriptLaunch
  const cmdShellPath =
    process.env.ComSpec || path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe')
  const powerShellPath = path.join(
    process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const processName = isProtocolLaunch
    ? ''
    : path.basename(
        isCmdScriptLaunch ? cmdShellPath : isPowerShellScriptLaunch ? powerShellPath : appTarget
      )
  const shouldBlockDuplicateProcess = !!processName && !isProtocolLaunch && !isScriptLaunch

  if (!appTarget) {
    event.reply('app-status', {
      success: false,
      message: '错误：未提供可用启动目标'
    })
    return
  }

  console.log(
    `正在启动应用: ${appTarget}`,
    launchArgs.length ? `参数: ${launchArgs.join(' ')}` : '',
    isSteamGame ? `(Steam游戏ID: ${steamAppId})` : ''
  )

  if (!isProtocolLaunch) {
    try {
      await fs.promises.access(
        appTarget,
        isScriptLaunch ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK
      )
    } catch {
      event.reply('app-status', {
        success: false,
        message: '错误：程序文件不存在或不可执行'
      })
      return
    }
  }

  try {
    const existingPids = shouldBlockDuplicateProcess ? await getProcessIdsByName(processName) : []
    if (shouldBlockDuplicateProcess && existingPids.length > 0) {
      event.reply('app-status', {
        success: false,
        message: '程序已在运行中'
      })
      return
    }

    let isRunning = false
    let reportedTransientError = false
    let finalStatusReported = false
    const startTime = Date.now()
    let startedPid = 0
    let checkInterval = null

    const clearCheckInterval = () => {
      if (checkInterval) {
        clearInterval(checkInterval)
        checkInterval = null
      }
    }

    const replyFinalStatus = (payload = {}) => {
      if (finalStatusReported) return
      finalStatusReported = true
      clearCheckInterval()
      event.reply('app-status', payload)
    }

    const checkProcessActive = async () => {
      if (!processName || !shouldBlockDuplicateProcess) return { running: false, newPids: [] }

      try {
        const currentPids = await getProcessIdsByName(processName)
        const newPids = currentPids.filter((pid) => !existingPids.includes(pid))
        return {
          running: newPids.length > 0,
          newPids
        }
      } catch (error) {
        console.error('进程检测异常:', error)
        return { running: false, newPids: [] }
      }
    }

    const handleNativeEvent = (nativeEvent = {}) => {
      const eventName = String(nativeEvent?.event || '').trim()
      const nativePid = Number(nativeEvent?.pid || 0)

      if (nativePid > 0) {
        startedPid = nativePid
      }

      if (eventName === 'start_failed') {
        console.error('Node-API 启动失败:', nativeEvent?.message)
        replyFinalStatus({
          success: false,
          message: nativeEvent?.message || '程序启动失败'
        })
        return
      }

      if (eventName === 'started') {
        isRunning = true
        replyFinalStatus({
          success: true,
          message: '程序启动成功'
        })
        return
      }

      if (eventName !== 'closed') {
        return
      }

      if (isRunning || finalStatusReported) {
        return
      }

      const exitCode = Number(nativeEvent?.exitCode)
      if (exitCode === 0 && !isProtocolLaunch) {
        return
      }

      const errorInfo = ERROR_CODE_MAP[exitCode] || ERROR_CODE_MAP.default
      if (errorInfo.isTransient && !reportedTransientError) {
        reportedTransientError = true
        event.reply('app-status', {
          success: false,
          message: errorInfo.message,
          isTransient: true
        })
        return
      }

      replyFinalStatus({
        success: false,
        message: errorInfo.message
      })
    }

    if (!isProtocolLaunch && shouldBlockDuplicateProcess && processName) {
      checkInterval = setInterval(async () => {
        if (finalStatusReported || isRunning) {
          clearCheckInterval()
          return
        }

        try {
          const { running, newPids } = await checkProcessActive()

          if (running && newPids.length && startedPid <= 0) {
            if (newPids.length) {
              startedPid = Number(newPids[0] || startedPid || 0)
            }
          }

          if (Date.now() - startTime > 90000) {
            replyFinalStatus({
              success: false,
              message: '程序启动超时，请检查程序是否正常运行'
            })
          }
        } catch (error) {
          console.error('检测异常:', error)
        }
      }, 1000)
    }

    const launchTarget = isCmdScriptLaunch
      ? cmdShellPath
      : isPowerShellScriptLaunch
        ? powerShellPath
        : appTarget
    const launchTargetArgs = isCmdScriptLaunch
      ? buildWindowsCmdInvocationArgs(appTarget, launchArgs)
      : isPowerShellScriptLaunch
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appTarget, ...launchArgs]
        : launchArgs
    const launchResult = launchTargetByNodeApi(launchTarget, launchTargetArgs, handleNativeEvent)
    if (launchResult?.ok === false) {
      replyFinalStatus({
        success: false,
        message: launchResult?.error || '程序启动失败'
      })
      return
    }

    if (Number(launchResult?.pid || 0) > 0) {
      startedPid = Number(launchResult.pid)
    }
  } catch (error) {
    console.error('启动异常:', error)
    event.reply('app-status', {
      success: false,
      message: `程序启动失败: ${error.message}`
    })
  }
}

export function exitApp() {
  app.quit()
}

export function openDevTools() {
  const mainWindow = getMainWindow()
  mainWindow.webContents.openDevTools({ mode: 'undocked' })
}

export function showWindow() {
  const mainWindow = getMainWindow()
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  mainWindow.focus()
}

export function restartApp() {
  app.relaunch()
  app.exit(0)
}


/**
 * 扫描系统已安装应用（Windows）
 */
const installedAppOperations = createInstalledAppOperations({
  list: () => listInstalledApps({ metadata: false }), run: runUninstallAndWait,
  scan: scanUninstallResiduals, cleanup: cleanupUninstallResiduals
})

export async function scanInstalledApps(event, data = {}) {
  try {
    const list = await listInstalledApps()
    if (!event.sender.isDestroyed()) event.reply('scanInstalledAppsSuccess', {
      requestId: data.requestId, list,
      operation: installedAppOperations.snapshot(event.sender.id)
    })
  } catch (error) {
    if (!event.sender.isDestroyed()) event.reply('scanInstalledAppsFail', {
      requestId: data.requestId, message: error?.message || '扫描失败'
    })
  }
}

export async function uninstallInstalledApp(event, data = {}) {
  return installedAppOperations.start(event, data, 'uninstall')
}

export async function scanInstalledAppResiduals(event, data = {}) {
  return installedAppOperations.start(event, data, 'directCleanup')
}

/**
 * 读取应用图标（DataURL）
 */
export async function getInstalledAppIcon(event, data = {}) {
  const {
    cacheKey = '',
    id = '',
    iconSource = '',
    displayIcon = '',
    installLocation = '',
    uninstallString = '',
    quietUninstallString = '',
    displayName = ''
  } = data
  try {
    const iconDataUrl = await getAppIconData({
      id,
      iconSource,
      displayIcon,
      installLocation,
      uninstallString,
      quietUninstallString,
      displayName
    })
    event.reply('getInstalledAppIconResult', { cacheKey, iconDataUrl })
  } catch {
    event.reply('getInstalledAppIconResult', { cacheKey, iconDataUrl: '' })
  }
}

export async function resolveInstalledAppIcon(data = {}) {
  try {
    return await getAppIconData(data)
  } catch {
    return ''
  }
}

/**
 * 清理卸载残留
 */
export async function cleanupInstalledAppResiduals(event, data = {}) {
  return installedAppOperations.clean(event, data)
}

/**
 * 打开应用相关目录
 * @param {string} type - 目录类型: 'root' | 'database' | 'cache'
 */
export async function openAppDirectory(type) {
  let targetPath = ''

  switch (type) {
    case 'root':
      // 打开应用安装目录（exe所在目录）
      targetPath = path.dirname(app.getPath('exe'))
      break
    case 'database':
      // 打开用户数据目录（存储数据库等）
      targetPath = userPath
      break
    case 'cache': {
      // 打开缓存目录
      const settings = store.get('systemConfig.settings') || {}
      targetPath = settings.cachePath || app.getPath('temp')
      break
    }
    default:
      console.error('未知目录类型:', type)
      return
  }

  try {
    // 检查目录是否存在，如果不存在则创建
    if (!fs.existsSync(targetPath)) {
      await fs.ensureDir(targetPath)
    }
    // 打开目录
    await shell.openPath(targetPath)
  } catch (error) {
    console.error('打开目录失败:', error)
  }
}
