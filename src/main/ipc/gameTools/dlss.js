import path from 'node:path'
import fs from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell } from 'electron'
import si from 'systeminformation'
import { ipcMain } from '../../security/ipc.js'
import { assertLocalPath } from '../../security/ipcPolicy.js'
import dbInstance from '../../db/dbInstance.js'
import userPath from '../../initPath.js'
import catalog from '../../services/dlss/catalog.json'
import { createDlssRepository } from '../../services/dlss/repository.js'
import { createAssetManager } from '../../services/dlss/assets.js'
import { createDlssService } from '../../services/dlss/service.js'
import { snapshotProcesses } from '../../services/dlss/processes.js'
import { createDlssManager } from '../../services/dlss/manager.js'
import { createSwapperPayload } from '../../services/dlss/swapper-payload.js'
import createAnalysisWorker from '../../services/dlss/analysis-worker.js?nodeWorker'
import { createAnalysisClient } from '../../services/dlss/analysis-client.js'
import { createDropEnvironmentReader } from '../../services/desktop-drop.js'
import { registerLocalGameProvider } from '../../services/localGameLibrary.js'

const errorMessages = {
  ENOENT: '文件或目录不存在，请重新定位',
  EACCES: '权限不足，未改变系统权限',
  EPERM: '文件被占用或权限不足，请退出游戏后重试',
  ENOSPC: '磁盘空间不足',
  EBUSY: '文件仍被占用，请稍后重试'
}
let instance
function manualLaunchOnly() {
  throw Object.assign(new Error('已改为文件安装，请安装后自行启动游戏'), { code: 'manual_launch' })
}
function getService() {
  instance ||= (async () => {
    const root = path.join(userPath, 'dlss')
    let hardware = []
    try {
      hardware = (await si.graphics()).controllers.map(
        (g) =>
          `${g.vendor || ''} ${g.model || ''}${g.driverVersion ? ` · 驱动 ${g.driverVersion}` : ''}`
      )
    } catch {
      /* Unknown hardware remains unverified. */
    }
    const service = createDlssService({
      root,
      repository: createDlssRepository(dbInstance.db),
      assets: createAssetManager(path.join(root, 'components'), catalog),
      processes: snapshotProcesses,
      spawn: manualLaunchOnly,
      hardware
    })
    await service.initialize()
    app.once('before-quit', () => service.dispose())
    return service
  })()
  return instance
}
let managerInstance
let analysis
// 页面与智能体共享管理器及操作锁，不能各自创建安装实例。
export function getDlssManager() {
  if (managerInstance) return managerInstance
  analysis = createAnalysisClient(() => createAnalysisWorker({ name: 'vertex-dlss-analysis' }))
  app.once('before-quit', () => analysis.dispose())
  const managerRoot = path.join(userPath, 'dlss', 'swapper')
  const repository = createDlssRepository(dbInstance.db)
  registerLocalGameProvider('dlss', repository.list)
  managerInstance = createDlssManager({
    repository,
    root: managerRoot,
    dialog,
    shell,
    legacy: getService,
    scan: analysis.scan,
    runtimeCheck: analysis.check,
    snapshot: analysis.snapshot,
    observe: analysis.observe,
    payload: createSwapperPayload({
      root: managerRoot,
      bundledDirectory: app.isPackaged
        ? path.join(process.resourcesPath, 'dlss/payload')
        : undefined,
      sevenZip: path.join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        'resources/node/7z.exe'
      )
    })
  })
  return managerInstance
}

export function registerDlssIpc() {
  const readDropEnvironment = createDropEnvironmentReader()
  const pendingAnalysis = new Map()
  const manager = getDlssManager()
  ipcMain.handle('dlss:manage', async (event, payload = {}) => {
    let analysisKey
    let analysisController
    let abortOnClose
    try {
      const allowed = [
        'details',
        'saveOptions',
        'autoDetect',
        'list',
        'state',
        'progress',
        'checkLocation',
        'install',
        'restore',
        'scanLibrary',
        'dropEnvironment',
        'openClientLocation',
        'artwork',
        'diagnostics',
        'checkRuntime',
        'cancelAnalysis',
        'saveDiagnostics',
        'remove'
      ]
      if (!allowed.includes(payload.action)) throw new Error('未知 DLSS 操作')
      if (payload.action === 'dropEnvironment')
        return { ok: true, value: await readDropEnvironment() }
      if (payload.action === 'openClientLocation') {
        shell.showItemInFolder(app.getPath('exe'))
        return { ok: true, value: true }
      }
      const input = payload.input || {}
      if (
        input.requestId !== undefined &&
        (typeof input.requestId !== 'string' || input.requestId.length > 100)
      )
        throw new Error('操作请求标识无效')
      if (payload.action === 'autoDetect' && typeof input.requestId !== 'string')
        throw new Error('缺少检测请求标识')
      if (payload.action === 'cancelAnalysis') {
        pendingAnalysis.get(`${event.sender.id}:${input.requestId}`)?.abort()
        return { ok: true, value: true }
      }
      if (
        ['details', 'checkRuntime', 'autoDetect'].includes(payload.action) &&
        typeof input.requestId === 'string'
      ) {
        if (input.requestId.length > 100 || pendingAnalysis.size >= 16)
          throw new Error('检查请求过多，请稍后重试')
        analysisKey = `${event.sender.id}:${input.requestId}`
        pendingAnalysis.get(analysisKey)?.abort()
        const controller = new AbortController()
        analysisController = controller
        pendingAnalysis.set(analysisKey, controller)
        input.signal = controller.signal
        abortOnClose = () => controller.abort()
        event.sender.once('destroyed', abortOnClose)
      }
      for (const key of ['gameRoot', 'exePath']) if (input[key]) assertLocalPath(input[key])
      if (payload.action === 'saveDiagnostics') {
        const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
          title: payload.locale === 'en-US' ? 'Save DLSS5 diagnostics' : '保存 DLSS5 诊断',
          defaultPath: 'DLSS5-diagnostics.txt',
          filters: [{ name: payload.locale === 'en-US' ? 'Diagnostic text' : '诊断文本', extensions: ['txt'] }]
        })
        if (result.canceled) return { ok: true, value: { canceled: true } }
        const report = manager.diagnostics(input)
        await fs.writeFile(result.filePath, report.text, 'utf8')
        return { ok: true, value: { saved: true } }
      }
      const value = ['install', 'restore'].includes(payload.action)
        ? await manager[payload.action](input.id, {
            window: BrowserWindow.fromWebContents(event.sender),
            locale: payload.locale === 'en-US' ? 'en-US' : 'zh-CN',
            requestId: input.requestId
          })
        : payload.action === 'state'
          ? manager.state(input.id)
          : await manager[payload.action](input)
      return { ok: true, value }
    } catch (error) {
      if (analysisController?.signal.aborted)
        return { ok: false, code: 'analysis_cancelled', message: '检测已停止' }
      return {
        ok: false,
        code: error.code || 'dlss_failed',
        message: errorMessages[error.code] || error.message || 'DLSS 操作失败'
      }
    } finally {
      if (analysisKey && pendingAnalysis.get(analysisKey) === analysisController)
        pendingAnalysis.delete(analysisKey)
      if (abortOnClose) event.sender.removeListener('destroyed', abortOnClose)
    }
  })
  const operations = {
    source: async (_s, p) => {
      const component = catalog.find((c) => c.id === p.component)
      if (!component) throw Object.assign(new Error('未知组件'), { code: 'unknown_component' })
      await shell.openExternal(
        p.runtime && component.runtimeSource ? component.runtimeSource : component.upstream
      )
      return { opened: true }
    },
    bindings: (s) => s.list(),
    catalog: (s) => s.catalog(),
    status: (s, p) => s.get(p.id),
    inspect: (s, p) => s.inspect(p),
    resolve: (s, p) => s.resolve(p),
    bind: (s, p) => s.bind(p),
    redetect: (s, p) => s.redetect(p.id),
    configure: (s, p) => s.configure(p.id, p.config),
    prepare: (s, p) => s.prepare(p.id, p.sourceRoot),
    preview: (s, p) => s.preview(p.id),
    apply: () => {
      throw Object.assign(new Error('安装流程已更新，请重新打开 DLSS5 配置'), {
        code: 'installer_updated'
      })
    },
    launch: manualLaunchOnly,
    cancel: (s, p) => s.cancelPrepare(p.id),
    restore: (s, p) => s.restore(p.id),
    unbind: (s, p) => s.unbind(p.id),
    log: (s, p) => s.diagnostics(p.id)
  }
  for (const [method, operation] of Object.entries(operations)) {
    ipcMain.handle(`dlss:${method}`, async (_event, payload = {}) => {
      try {
        if (
          manager.isBusy() &&
          !['bindings', 'catalog', 'status', 'inspect', 'log', 'source'].includes(method)
        )
          throw Object.assign(new Error('DLSS 安装或还原正在进行，请稍后重试'), {
            code: 'binding_busy'
          })
        for (const key of ['exePath', 'gameRoot', 'cwd', 'sourceRoot'])
          if (payload[key]) assertLocalPath(payload[key])
        return { ok: true, value: await operation(await getService(), payload) }
      } catch (error) {
        return {
          ok: false,
          code: error.code || 'dlss_failed',
          message:
            errorMessages[error.code] ||
            (/^[a-z_]+$/.test(error.code || '') ? error.message : 'DLSS 操作失败，请检查诊断与路径')
        }
      }
    })
  }
  ipcMain.handle('dlss:pick', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '选择游戏文件夹',
      properties: ['openDirectory']
    })
    return { ok: true, value: { canceled: result.canceled, path: result.filePaths[0] || '' } }
  })
  // The retired service is needed for old active sessions, not every startup.
  if (
    manager
      .list()
      .some((record) => record.sessions?.some((session) => session.state !== 'restored'))
  )
    getService().catch(() => console.warn('[DLSS] 旧版会话初始化失败，待用户打开诊断'))
}
