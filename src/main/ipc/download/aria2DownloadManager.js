import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import net from 'net'
import { spawn } from 'child_process'
import { app } from 'electron'
import { assertAria2Executable } from './aria2Path.js'
import { Aria2RpcClient } from './aria2RpcClient.js'
import { buildAria2FileNameOptions } from './fileNameResolver.js'

const ARIA2_RPC_HOST = '127.0.0.1'
const ARIA2_START_TIMEOUT_MS = 10000
const ARIA2_RPC_TIMEOUT_MS = 5000
const ARIA2_SHUTDOWN_KILL_DELAY_MS = 1500
const ARIA2_STATUS_KEYS = [
  'gid',
  'status',
  'totalLength',
  'completedLength',
  'downloadSpeed',
  'errorCode',
  'errorMessage',
  'files'
]
const DEFAULT_ARIA2_OPTIONS = Object.freeze({
  split: '8',
  maxConnectionPerServer: '8',
  minSplitSize: '1M',
  connectTimeoutSec: '30',
  timeoutSec: '60',
  retryWaitSec: '3',
  maxTries: '5'
})

function noop() {}

function toSafeText(value = '') {
  return String(value || '').trim()
}

function toPositiveInteger(value, fallbackValue = 1) {
  const result = Math.floor(Number(value || 0))
  if (!Number.isFinite(result) || result <= 0) {
    return fallbackValue
  }
  return result
}

function ensureDirectoryExists(dirPath = '') {
  const safeDirPath = toSafeText(dirPath)
  if (!safeDirPath || fs.existsSync(safeDirPath)) {
    return
  }
  fs.mkdirSync(safeDirPath, { recursive: true })
}

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, ARIA2_RPC_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? Number(address.port || 0) : 0
      server.close(() => {
        if (port > 0) {
          resolve(port)
        } else {
          reject(new Error('无法分配 aria2 RPC 端口'))
        }
      })
    })
  })
}

function normalizeUriList(task = {}) {
  const sourceCandidates = Array.isArray(task?.download_url_candidates)
    ? task.download_url_candidates
    : []
  const rawList = sourceCandidates.length ? sourceCandidates : [task?.download_url]
  const seen = new Set()

  return rawList
    .map((item) => toSafeText(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function appendHeaderLine(headerLines, key = '', value = '') {
  const safeKey = toSafeText(key)
  const safeValue = toSafeText(value)
  if (!safeKey || !safeValue) {
    return
  }
  headerLines.push(`${safeKey}: ${safeValue}`)
}

function appendHeaderSource(headerLines, source) {
  if (!source) {
    return
  }

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (typeof item === 'string') {
        const safeLine = toSafeText(item)
        if (safeLine) {
          headerLines.push(safeLine)
        }
        return
      }

      if (item && typeof item === 'object') {
        appendHeaderLine(headerLines, item.key || item.name, item.value)
      }
    })
    return
  }

  if (typeof source === 'object') {
    Object.entries(source).forEach(([key, value]) => {
      appendHeaderLine(headerLines, key, value)
    })
  }
}

function normalizeHeaderLines(...sources) {
  const headerLines = []
  sources.forEach((source) => appendHeaderSource(headerLines, source))
  return headerLines
}

function getStatusNumber(value = 0) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? result : 0
}

function getStatusUriList(status = {}, fallbackUriList = []) {
  const files = Array.isArray(status?.files) ? status.files : []
  const uriList = []

  files.forEach((file) => {
    const uris = Array.isArray(file?.uris) ? file.uris : []
    uris.forEach((item) => {
      const uri = toSafeText(item?.uri)
      if (uri) {
        uriList.push({
          uri,
          status: toSafeText(item?.status)
        })
      }
    })
  })

  if (!uriList.length) {
    return fallbackUriList.map((uri) => ({
      uri,
      status: ''
    }))
  }

  return uriList
}

function getStatusFilePath(status = {}, fallbackPath = '') {
  const files = Array.isArray(status?.files) ? status.files : []
  const matchedFile = files.find((file) => toSafeText(file?.path))
  return toSafeText(matchedFile?.path) || toSafeText(fallbackPath)
}

function formatAria2FailureMessage(status = {}, fallbackMessage = '下载失败') {
  const errorCode = toSafeText(status?.errorCode)
  const errorMessage = toSafeText(status?.errorMessage)
  if (errorCode && errorMessage) {
    return `${fallbackMessage}（aria2 ${errorCode}: ${errorMessage}）`
  }
  if (errorMessage) {
    return `${fallbackMessage}（${errorMessage}）`
  }
  if (errorCode) {
    return `${fallbackMessage}（aria2 ${errorCode}）`
  }
  return fallbackMessage
}

export class Aria2DownloadManager {
  constructor(options = {}) {
    this.maxConcurrentDownloads = Math.max(1, toPositiveInteger(options.maxConcurrentDownloads, 1))
    this.progressInterval = Math.max(200, Number(options.progressInterval || 800))
    this.prepareTask =
      typeof options.prepareTask === 'function' ? options.prepareTask : (task) => task
    this.resolveSavePath =
      typeof options.resolveSavePath === 'function'
        ? options.resolveSavePath
        : (task) => task.finalFilePath
    this.getRequestHeaders =
      typeof options.getRequestHeaders === 'function' ? options.getRequestHeaders : () => ({})
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : noop
    this.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : noop
    this.onFailed = typeof options.onFailed === 'function' ? options.onFailed : noop
    this.onCanceled = typeof options.onCanceled === 'function' ? options.onCanceled : noop
    this.onLog = typeof options.onLog === 'function' ? options.onLog : noop
    this.onEngineFailed =
      typeof options.onEngineFailed === 'function' ? options.onEngineFailed : null

    this.initialized = false
    this.fallbackRequested = false
    this.shuttingDown = false
    this.downloadQueue = []
    this.preparingTaskIds = new Set()
    this.pendingCancelTaskIds = new Set()
    this.completedTaskIds = new Set()
    this.activeDownloads = new Map()
    this.taskIdToGid = new Map()
    this.gidToTaskId = new Map()
    this.aria2Process = null
    this.rpcClient = null
    this.ensureReadyPromise = null
    this.pollTimer = null
    this.executablePath = ''
    this.rpcPort = 0
    this.rpcSecret = ''
    this.handleBeforeQuit = () => {
      this.destroy()
    }
  }

  init() {
    if (this.initialized) {
      return
    }

    this.executablePath = assertAria2Executable()
    app.once('before-quit', this.handleBeforeQuit)
    this.initialized = true
    this.processNext()
  }

  destroy() {
    if (!this.initialized && !this.aria2Process) {
      return
    }

    this.initialized = false
    this.shuttingDown = true
    app.removeListener('before-quit', this.handleBeforeQuit)
    this.clearPollTimer()
    this.shutdownAria2Process()
  }

  setMaxConcurrentDownloads(count = 1) {
    this.maxConcurrentDownloads = Math.max(1, toPositiveInteger(count, 1))
    if (this.rpcClient) {
      this.rpcClient
        .changeGlobalOption({
          'max-concurrent-downloads': String(this.maxConcurrentDownloads)
        })
        .catch((error) => {
          this.onLog('warn', `更新 aria2 并发数失败：${error?.message || error}`)
        })
    }
    this.processNext()
  }

  getOccupiedSlotCount() {
    return this.activeDownloads.size + this.preparingTaskIds.size
  }

  addTask(task = {}) {
    try {
      this.init()
    } catch (error) {
      this.requestFallback(error, [task])
      return
    }

    this.downloadQueue.push(task)
    this.completedTaskIds.delete(toSafeText(task?.id))
    this.processNext()
  }

  removeTask(taskId = '') {
    const safeTaskId = toSafeText(taskId)
    if (!safeTaskId) {
      return {
        handled: false,
        type: 'invalid'
      }
    }

    const queueIndex = this.downloadQueue.findIndex((task) => toSafeText(task?.id) === safeTaskId)
    if (queueIndex !== -1) {
      const task = this.downloadQueue.splice(queueIndex, 1)[0]
      this.completedTaskIds.add(safeTaskId)
      return {
        handled: true,
        type: 'queued',
        task
      }
    }

    if (this.preparingTaskIds.has(safeTaskId)) {
      this.pendingCancelTaskIds.add(safeTaskId)
      return {
        handled: true,
        type: 'preparing'
      }
    }

    const activeInfo = this.activeDownloads.get(safeTaskId)
    if (activeInfo) {
      activeInfo.isCancelling = true
      this.pendingCancelTaskIds.add(safeTaskId)
      this.cancelActiveTask(safeTaskId, activeInfo)
      return {
        handled: true,
        type: 'active',
        task: activeInfo.task
      }
    }

    if (this.completedTaskIds.has(safeTaskId)) {
      return {
        handled: true,
        type: 'completed'
      }
    }

    return {
      handled: false,
      type: 'missing'
    }
  }

  processNext = () => {
    if (!this.initialized || this.fallbackRequested) {
      return
    }

    if (!this.downloadQueue.length && !this.activeDownloads.size && !this.preparingTaskIds.size) {
      this.clearPollTimer()
      return
    }

    if (!this.rpcClient) {
      this.ensureAria2Ready()
        .then(() => this.processNext())
        .catch((error) => this.handleEngineStartupFailed(error))
      return
    }

    while (this.activeDownloads.size + this.preparingTaskIds.size < this.maxConcurrentDownloads) {
      const nextTask = this.downloadQueue.shift()
      if (!nextTask) {
        break
      }
      this.prepareQueuedTask(nextTask)
    }

    this.refreshPollTimer()
  }

  prepareQueuedTask(nextTask = {}) {
    const safeTaskId = toSafeText(nextTask?.id)
    if (!safeTaskId || this.completedTaskIds.has(safeTaskId)) {
      this.processNext()
      return
    }

    this.preparingTaskIds.add(safeTaskId)

    Promise.resolve()
      .then(() => this.prepareTask(nextTask) || nextTask)
      .then(async (preparedTask) => {
        this.preparingTaskIds.delete(safeTaskId)

        if (this.pendingCancelTaskIds.has(safeTaskId)) {
          this.pendingCancelTaskIds.delete(safeTaskId)
          this.completedTaskIds.add(safeTaskId)
          this.onCanceled(preparedTask, '任务已取消', null)
          this.processNext()
          return
        }

        await this.startPreparedTask(preparedTask)
      })
      .catch((error) => {
        this.preparingTaskIds.delete(safeTaskId)
        this.completedTaskIds.add(safeTaskId)
        this.onFailed(nextTask, `下载任务准备失败：${error?.message || error}`, null)
        this.processNext()
      })
  }

  async startPreparedTask(task = {}) {
    const safeTaskId = toSafeText(task?.id)
    const uriList = normalizeUriList(task)

    if (!safeTaskId || this.completedTaskIds.has(safeTaskId)) {
      this.processNext()
      return
    }

    if (!uriList.length) {
      this.completedTaskIds.add(safeTaskId)
      this.onFailed(task, '下载地址为空', null)
      this.processNext()
      return
    }

    const savePath = this.resolveSavePath(task, null)
    if (savePath) {
      task.finalFilePath = savePath
    }
    const finalFilePath = toSafeText(task.finalFilePath)
    const saveDirectory = toSafeText(task.saveDirectory) || path.dirname(finalFilePath)
    ensureDirectoryExists(saveDirectory)
    task.saveDirectory = saveDirectory

    if (!finalFilePath || !path.basename(finalFilePath)) {
      this.completedTaskIds.add(safeTaskId)
      this.onFailed(task, '下载保存路径为空', null)
      this.processNext()
      return
    }

    const options = this.buildAddUriOptions(task)
    const gid = await this.rpcClient.addUri(uriList, options)

    if (this.pendingCancelTaskIds.has(safeTaskId)) {
      this.pendingCancelTaskIds.delete(safeTaskId)
      this.completedTaskIds.add(safeTaskId)
      await this.removeAria2Task(gid)
      this.onCanceled(task, '任务已取消', null)
      this.processNext()
      return
    }

    const activeInfo = {
      task,
      gid,
      uriList,
      lastStatus: null,
      lastPayload: null,
      isCancelling: false,
      pollErrorCount: 0
    }
    this.activeDownloads.set(safeTaskId, activeInfo)
    this.taskIdToGid.set(safeTaskId, gid)
    this.gidToTaskId.set(gid, safeTaskId)
    this.onProgress(task, this.buildPayload(activeInfo, null))
    this.refreshPollTimer()
    this.processNext()
  }

  buildAddUriOptions(task = {}) {
    const finalFilePath = toSafeText(task.finalFilePath)
    const headers = normalizeHeaderLines(
      this.getRequestHeaders(task),
      task.downloadHeaders,
      task.requestHeaders,
      task.headers
    )
    const options = {
      dir: toSafeText(task.saveDirectory) || path.dirname(finalFilePath),
      continue: 'true',
      'allow-overwrite': 'false',
      ...buildAria2FileNameOptions(task),
      split: DEFAULT_ARIA2_OPTIONS.split,
      'max-connection-per-server': DEFAULT_ARIA2_OPTIONS.maxConnectionPerServer,
      'min-split-size': DEFAULT_ARIA2_OPTIONS.minSplitSize,
      'connect-timeout': DEFAULT_ARIA2_OPTIONS.connectTimeoutSec,
      timeout: DEFAULT_ARIA2_OPTIONS.timeoutSec,
      'retry-wait': DEFAULT_ARIA2_OPTIONS.retryWaitSec,
      'max-tries': DEFAULT_ARIA2_OPTIONS.maxTries
    }

    if (headers.length) {
      options.header = headers
    }

    const checksum = toSafeText(task.checksum || task.integrity)
    if (checksum) {
      options.checksum = checksum
      options['check-integrity'] = 'true'
    }

    return options
  }

  async ensureAria2Ready() {
    if (this.rpcClient) {
      return this.rpcClient
    }

    if (!this.ensureReadyPromise) {
      this.ensureReadyPromise = this.startAria2Process().finally(() => {
        this.ensureReadyPromise = null
      })
    }

    return this.ensureReadyPromise
  }

  async startAria2Process() {
    this.executablePath = assertAria2Executable()
    const runtimeDir = path.join(app.getPath('userData'), 'aria2')
    ensureDirectoryExists(runtimeDir)

    this.rpcPort = await getFreeLocalPort()
    this.rpcSecret = crypto.randomBytes(24).toString('hex')

    const args = [
      '--enable-rpc=true',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${this.rpcPort}`,
      `--rpc-secret=${this.rpcSecret}`,
      '--console-log-level=warn',
      // Windows 下 c-ares 可能反复选择无路由的 IPv6 地址，耗尽重试却未连接 IPv4。
      // 使用系统解析器的地址排序，保留系统实际可用的 IPv4 / IPv6 路径。
      ...(process.platform === 'win32' ? ['--async-dns=false'] : []),
      '--summary-interval=0',
      '--continue=true',
      '--allow-overwrite=false',
      '--auto-file-renaming=false',
      `--max-concurrent-downloads=${this.maxConcurrentDownloads}`,
      `--max-connection-per-server=${DEFAULT_ARIA2_OPTIONS.maxConnectionPerServer}`,
      `--split=${DEFAULT_ARIA2_OPTIONS.split}`,
      `--min-split-size=${DEFAULT_ARIA2_OPTIONS.minSplitSize}`,
      `--connect-timeout=${DEFAULT_ARIA2_OPTIONS.connectTimeoutSec}`,
      `--timeout=${DEFAULT_ARIA2_OPTIONS.timeoutSec}`,
      `--retry-wait=${DEFAULT_ARIA2_OPTIONS.retryWaitSec}`,
      `--max-tries=${DEFAULT_ARIA2_OPTIONS.maxTries}`,
      `--log=${path.join(runtimeDir, 'aria2.log')}`
    ]

    this.onLog('info', `启动 aria2 下载引擎：${this.executablePath}`)
    const childProcess = spawn(this.executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.aria2Process = childProcess
    childProcess.stdout.on('data', (chunk) => {
      const text = toSafeText(chunk.toString())
      if (text) {
        this.onLog('info', text.slice(0, 500))
      }
    })
    childProcess.stderr.on('data', (chunk) => {
      const text = toSafeText(chunk.toString())
      if (text) {
        this.onLog('warn', text.slice(0, 500))
      }
    })
    childProcess.once('error', (error) => this.handleProcessError(childProcess, error))
    childProcess.once('exit', (code, signal) => this.handleProcessExit(childProcess, code, signal))

    this.rpcClient = new Aria2RpcClient({
      host: ARIA2_RPC_HOST,
      port: this.rpcPort,
      secret: this.rpcSecret,
      timeoutMs: ARIA2_RPC_TIMEOUT_MS
    })

    await this.rpcClient.waitForReady({
      timeoutMs: ARIA2_START_TIMEOUT_MS,
      intervalMs: 200
    })

    this.onLog('info', `aria2 下载引擎已就绪，PID=${childProcess.pid || 0}`)
    return this.rpcClient
  }

  handleProcessError(childProcess, error) {
    if (this.aria2Process !== childProcess || this.shuttingDown) {
      return
    }
    this.onLog('warn', `aria2 进程错误：${error?.message || error}`)
  }

  handleProcessExit(childProcess, code, signal) {
    if (this.aria2Process !== childProcess) {
      return
    }

    this.aria2Process = null
    this.rpcClient = null
    this.rpcPort = 0
    this.rpcSecret = ''

    if (this.shuttingDown) {
      return
    }

    const message = `aria2 下载引擎异常退出：code=${code ?? 'null'}, signal=${signal || 'null'}`
    this.onLog('warn', message)

    const queuedTasks = this.drainPendingTasks()
    if (queuedTasks.length) {
      this.requestFallback(new Error(message), queuedTasks)
    }

    for (const taskId of Array.from(this.activeDownloads.keys())) {
      const info = this.activeDownloads.get(taskId)
      if (!info) {
        continue
      }
      const payload = info.lastPayload || this.buildPayload(info, info.lastStatus)
      this.finishTask(taskId, 'failed', message, payload)
    }
  }

  handleEngineStartupFailed(error) {
    const pendingTasks = this.drainPendingTasks()
    this.requestFallback(error, pendingTasks)
  }

  drainPendingTasks() {
    const pendingTasks = this.downloadQueue.slice()
    this.downloadQueue = []
    this.preparingTaskIds.clear()
    this.pendingCancelTaskIds.clear()
    return pendingTasks
  }

  requestFallback(error, pendingTasks = []) {
    if (this.fallbackRequested) {
      return
    }

    this.fallbackRequested = true
    this.clearPollTimer()
    this.shutdownAria2Process()

    if (this.onEngineFailed) {
      this.onEngineFailed(error, pendingTasks)
      return
    }

    pendingTasks.forEach((task) => {
      this.onFailed(task, `aria2 下载引擎不可用：${error?.message || error}`, null)
    })
  }

  refreshPollTimer() {
    if (!this.activeDownloads.size) {
      this.clearPollTimer()
      return
    }

    if (this.pollTimer) {
      return
    }

    this.pollTimer = setInterval(() => {
      this.pollActiveDownloads().catch((error) => {
        this.onLog('warn', `aria2 进度轮询失败：${error?.message || error}`)
      })
    }, this.progressInterval)
  }

  clearPollTimer() {
    if (!this.pollTimer) {
      return
    }
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async pollActiveDownloads() {
    if (!this.rpcClient || !this.activeDownloads.size) {
      this.clearPollTimer()
      return
    }

    const activeEntries = Array.from(this.activeDownloads.entries())
    for (const [taskId, info] of activeEntries) {
      if (!this.activeDownloads.has(taskId)) {
        continue
      }

      try {
        const status = await this.rpcClient.tellStatus(info.gid, ARIA2_STATUS_KEYS)
        info.lastStatus = status
        info.pollErrorCount = 0
        const payload = this.buildPayload(info, status)
        info.lastPayload = payload

        if (status.status === 'complete') {
          this.onProgress(info.task, {
            ...payload,
            progress: 100,
            receivedBytes: payload.totalBytes || payload.receivedBytes
          })
          this.finishTask(taskId, 'success', '下载成功', {
            ...payload,
            progress: 100,
            receivedBytes: payload.totalBytes || payload.receivedBytes
          })
          continue
        }

        if (status.status === 'error') {
          this.finishTask(taskId, 'failed', formatAria2FailureMessage(status), payload)
          continue
        }

        if (status.status === 'removed') {
          this.finishTask(taskId, 'canceled', '任务已取消', payload)
          continue
        }

        this.onProgress(info.task, payload)
      } catch (error) {
        const currentInfo = this.activeDownloads.get(taskId)
        if (!currentInfo) {
          continue
        }

        if (currentInfo.isCancelling) {
          this.finishTask(taskId, 'canceled', '任务已取消', currentInfo.lastPayload)
          continue
        }

        currentInfo.pollErrorCount += 1
        if (currentInfo.pollErrorCount >= 3) {
          const payload =
            currentInfo.lastPayload || this.buildPayload(currentInfo, currentInfo.lastStatus)
          this.finishTask(taskId, 'failed', `下载状态查询失败：${error?.message || error}`, payload)
        }
      }
    }

    if (!this.activeDownloads.size) {
      this.clearPollTimer()
    }
  }

  buildPayload(info = {}, status = null) {
    const task = info.task || {}
    const safeStatus = status && typeof status === 'object' ? status : {}
    const totalBytes = getStatusNumber(safeStatus.totalLength)
    const receivedBytes = getStatusNumber(safeStatus.completedLength)
    const statusUriList = getStatusUriList(safeStatus, info.uriList || [])
    const urlChain = statusUriList.map((item) => item.uri).filter(Boolean)
    const currentUrl =
      statusUriList.find((item) => item.status === 'used')?.uri ||
      urlChain[0] ||
      toSafeText(task.download_url)
    const attemptIndex = Math.max(1, urlChain.findIndex((url) => url === currentUrl) + 1)
    const filePath = getStatusFilePath(safeStatus, task.finalFilePath)
    const fileName = path.basename(filePath || toSafeText(task.finalFilePath))

    return {
      id: task.id,
      totalBytes,
      receivedBytes,
      speed: getStatusNumber(safeStatus.downloadSpeed),
      progress: totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0,
      filePath,
      fileType: toSafeText(task.file_type) || 'unknown',
      fileName,
      supportsRange: true,
      isPaused: safeStatus.status === 'paused',
      urlChain,
      interruptedRetryCount: 0,
      attemptIndex,
      attemptCount: Math.max(1, urlChain.length || (info.uriList || []).length),
      currentUrl,
      networkImpact: task.networkImpact || null,
      aria2Gid: info.gid || ''
    }
  }

  async cancelActiveTask(taskId = '', info = null) {
    const activeInfo = info || this.activeDownloads.get(taskId)
    if (!activeInfo) {
      return
    }

    try {
      await this.removeAria2Task(activeInfo.gid)
    } catch (error) {
      this.onLog('warn', `取消 aria2 任务失败：${error?.message || error}`)
    }

    const currentInfo = this.activeDownloads.get(taskId)
    if (currentInfo?.isCancelling) {
      this.finishTask(taskId, 'canceled', '任务已取消', currentInfo.lastPayload)
    }
  }

  async removeAria2Task(gid = '') {
    const safeGid = toSafeText(gid)
    if (!safeGid || !this.rpcClient) {
      return
    }

    try {
      await this.rpcClient.remove(safeGid)
    } catch {
      await this.rpcClient.forceRemove(safeGid)
    }

    this.removeAria2DownloadResult(safeGid)
  }

  removeAria2DownloadResult(gid = '') {
    const safeGid = toSafeText(gid)
    if (!safeGid || !this.rpcClient) {
      return
    }

    this.rpcClient.removeDownloadResult(safeGid).catch(() => {
      // aria2 只允许清理 stopped 结果，活动任务会在后续状态变化时再清理。
    })
  }

  finishTask(taskId = '', resultType = '', message = '', payload = null) {
    const safeTaskId = toSafeText(taskId)
    const info = this.activeDownloads.get(safeTaskId)
    if (!info) {
      return
    }

    this.activeDownloads.delete(safeTaskId)
    this.taskIdToGid.delete(safeTaskId)
    this.gidToTaskId.delete(info.gid)
    this.pendingCancelTaskIds.delete(safeTaskId)
    this.completedTaskIds.add(safeTaskId)
    this.removeAria2DownloadResult(info.gid)

    const finalPayload = payload || info.lastPayload || this.buildPayload(info, info.lastStatus)
    const payloadFilePath = toSafeText(finalPayload?.filePath)
    if (payloadFilePath) {
      info.task.finalFilePath = payloadFilePath
      info.task.saveDirectory = path.dirname(payloadFilePath)
      info.task.fileExt = path.extname(payloadFilePath) || info.task.fileExt
    }
    if (resultType === 'success') {
      this.onSuccess(info.task, finalPayload)
    } else if (resultType === 'canceled') {
      this.onCanceled(info.task, message || '任务已取消', finalPayload)
    } else {
      this.onFailed(info.task, message || '下载失败', finalPayload)
    }

    this.processNext()
  }

  shutdownAria2Process() {
    const rpcClient = this.rpcClient
    const childProcess = this.aria2Process
    this.rpcClient = null
    this.aria2Process = null
    this.rpcPort = 0
    this.rpcSecret = ''

    if (rpcClient) {
      rpcClient.shutdown().catch(() => {
        // 进程可能已经退出，忽略 shutdown 失败。
      })
    }

    if (!childProcess || childProcess.killed) {
      return
    }

    const killTimer = setTimeout(() => {
      try {
        if (!childProcess.killed) {
          childProcess.kill()
        }
      } catch {
        // ignore
      }
    }, ARIA2_SHUTDOWN_KILL_DELAY_MS)
    killTimer.unref?.()
  }
}
