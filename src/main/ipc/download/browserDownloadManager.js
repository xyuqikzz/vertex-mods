import fs from 'fs'
import os from 'os'
import axios from 'axios'
import { session, WebContentsView } from 'electron'
import { INSTALL_FLOW_CONFIG } from '../../../shared/installation/install-flow-config.js'

const DEFAULT_PARTITION = ''
const MAX_INTERRUPTED_RESUME_RETRIES = INSTALL_FLOW_CONFIG.download.maxInterruptedResumeRetries
const BASE_RESUME_DELAY = INSTALL_FLOW_CONFIG.download.resumeBaseDelayMs
const DEFAULT_PROBE_TIMEOUT_MS = INSTALL_FLOW_CONFIG.download.probeTimeoutMs
const DEFAULT_PROBE_SAMPLE_BYTES = 64 * 1024
const DEFAULT_PROBE_CACHE_TTL_MS = INSTALL_FLOW_CONFIG.download.probeCacheTtlMs
const VPN_INTERFACE_NAME_PATTERN =
  /(vpn|tun|tap|wintun|wireguard|tailscale|zerotier|openvpn|clash|sing-box|v2ray|sstap|nekoray|netbird|hamachi|radmin)/i
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy'
]

function noop() {}

function safeUnlink(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath || !fs.existsSync(safeFilePath)) {
    return
  }

  try {
    fs.unlinkSync(safeFilePath)
  } catch (error) {
    console.warn(`[浏览器下载] 清理残留文件失败: ${safeFilePath}`, error)
  }
}

function clearDownloadArtifacts(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath) {
    return
  }

  safeUnlink(safeFilePath)
  safeUnlink(`${safeFilePath}.crdownload`)
}

function toSafeUrlText(value = '') {
  return String(value || '').trim()
}

function normalizeUrlCompareKey(value = '') {
  return toSafeUrlText(value)
}

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function normalizeProbeConfig(probeConfig = {}) {
  const source = probeConfig && typeof probeConfig === 'object' ? probeConfig : {}
  return {
    enabled: source.enabled !== false,
    timeoutMs: Math.max(1000, toSafeNumber(source.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS)),
    sampleBytes: Math.max(8 * 1024, toSafeNumber(source.sampleBytes, DEFAULT_PROBE_SAMPLE_BYTES)),
    cacheTtlMs: Math.max(0, toSafeNumber(source.cacheTtlMs, DEFAULT_PROBE_CACHE_TTL_MS)),
    directSpeedKeepRatio: Math.min(
      1,
      Math.max(0.1, toSafeNumber(source.directSpeedKeepRatio, 0.72))
    )
  }
}

function destroyProbeStream(stream) {
  if (!stream || typeof stream.destroy !== 'function' || stream.destroyed) {
    return
  }

  try {
    stream.destroy()
  } catch {
    // ignore
  }
}

function formatProbeSpeed(bytesPerSecond = 0) {
  const safeValue = Math.max(0, Number(bytesPerSecond || 0))
  if (safeValue >= 1024 * 1024) {
    return `${(safeValue / 1024 / 1024).toFixed(2)} MB/s`
  }
  if (safeValue >= 1024) {
    return `${(safeValue / 1024).toFixed(1)} KB/s`
  }
  return `${safeValue.toFixed(0)} B/s`
}

function sanitizeProxyRules(value = '') {
  return String(value || '')
    .trim()
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@')
    .slice(0, 300)
}

function hasProxyRoute(proxyRules = '') {
  const safeProxyRules = sanitizeProxyRules(proxyRules)
  if (!safeProxyRules) {
    return false
  }

  return safeProxyRules
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => !/^direct$/i.test(item))
}

function getProxyEnvKeys() {
  return PROXY_ENV_KEYS.filter((key) => String(process.env?.[key] || '').trim())
}

function getPossibleVpnInterfaceNames() {
  try {
    const networkInterfaces = os.networkInterfaces()
    return Object.keys(networkInterfaces || {})
      .filter((name) => VPN_INTERFACE_NAME_PATTERN.test(name))
      .slice(0, 12)
  } catch {
    return []
  }
}

function buildNetworkImpactSummary(diagnosis = {}) {
  const reasonList = []

  if (diagnosis.proxyDetected) {
    reasonList.push(`下载代理=${diagnosis.proxyRules || '未知'}`)
  }

  if (diagnosis.vpnInterfaceDetected) {
    reasonList.push(`疑似 VPN 网卡=${diagnosis.vpnInterfaceNames.join(', ')}`)
  }

  if (diagnosis.proxyEnvDetected) {
    reasonList.push(`代理环境变量=${diagnosis.proxyEnvKeys.join(', ')}`)
  }

  if (reasonList.length) {
    return `可能受 VPN/代理影响（${reasonList.join('；')}）`
  }

  if (diagnosis.proxyErrorMessage) {
    return `代理解析失败，无法判断是否受 VPN/代理影响（${diagnosis.proxyErrorMessage}）`
  }

  return `未检测到明显 VPN/代理影响（代理解析=${diagnosis.proxyRules || 'DIRECT'}）`
}

function buildNetworkImpactDiagnosis(url = '', proxyRules = '', proxyErrorMessage = '') {
  const safeProxyRules = sanitizeProxyRules(proxyRules || 'DIRECT')
  const vpnInterfaceNames = getPossibleVpnInterfaceNames()
  const proxyEnvKeys = getProxyEnvKeys()
  const proxyDetected = hasProxyRoute(safeProxyRules)
  const vpnInterfaceDetected = vpnInterfaceNames.length > 0
  const proxyEnvDetected = proxyEnvKeys.length > 0
  const diagnosis = {
    checkedAt: new Date().toISOString(),
    url: toSafeUrlText(url),
    proxyRules: safeProxyRules,
    proxyDetected,
    vpnInterfaceNames,
    vpnInterfaceDetected,
    proxyEnvKeys,
    proxyEnvDetected,
    proxyErrorMessage: String(proxyErrorMessage || '').trim(),
    possiblyAffected: proxyDetected || vpnInterfaceDetected || proxyEnvDetected
  }

  return {
    ...diagnosis,
    summary: buildNetworkImpactSummary(diagnosis)
  }
}

export class BrowserDownloadManager {
  constructor(options = {}) {
    this.partition = String(options.partition ?? DEFAULT_PARTITION)
    this.maxConcurrentDownloads = Math.max(1, Number(options.maxConcurrentDownloads || 1))
    this.progressInterval = Math.max(200, Number(options.progressInterval || 1200))
    this.launchTimeoutMs = Math.max(
      1000,
      Number(options.launchTimeoutMs || INSTALL_FLOW_CONFIG.download.launchTimeoutMs)
    )
    this.stallTimeoutMs = Math.max(
      10000,
      Number(options.stallTimeoutMs || INSTALL_FLOW_CONFIG.download.stallTimeoutMs)
    )
    this.prepareTask =
      typeof options.prepareTask === 'function' ? options.prepareTask : (task) => task
    this.resolveSavePath =
      typeof options.resolveSavePath === 'function'
        ? options.resolveSavePath
        : (_task, item) => item.getSavePath()
    this.getRequestHeaders =
      typeof options.getRequestHeaders === 'function' ? options.getRequestHeaders : () => ({})
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : noop
    this.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : noop
    this.onFailed = typeof options.onFailed === 'function' ? options.onFailed : noop
    this.onCanceled = typeof options.onCanceled === 'function' ? options.onCanceled : noop
    this.onLog = typeof options.onLog === 'function' ? options.onLog : noop

    this.initialized = false
    this.downloadSession = null
    this.downloadQueue = []
    this.readyTaskQueue = []
    this.activeDownloads = new Map()
    this.completedTaskIds = new Set()
    this.launchingTasks = []
    this.preparingTaskIds = new Set()
    this.pendingCancelTaskIds = new Set()
    this.downloadProbeCache = new Map()
    this.downloadNavigations = new Map()
    this.downloadNavigationOwners = new WeakMap()
  }

  init() {
    if (this.initialized) {
      return
    }

    this.downloadSession = this.partition
      ? session.fromPartition(this.partition)
      : session.defaultSession

    this.downloadSession.on('will-download', this.handleWillDownload)
    this.initialized = true
  }

  destroy() {
    if (!this.initialized || !this.downloadSession) {
      return
    }

    this.downloadSession.removeListener('will-download', this.handleWillDownload)
    this.launchingTasks.forEach((task) => this.clearTaskLaunchTimeout(task))
    this.initialized = false
    this.downloadSession = null
  }

  setMaxConcurrentDownloads(count = 1) {
    this.maxConcurrentDownloads = Math.max(1, Number(count || 1))
    this.processNext()
  }

  addTask(task = {}) {
    this.init()
    this.downloadQueue.push(task)
    this.completedTaskIds.delete(String(task?.id || '').trim())
    this.processNext()
  }

  removeTask(taskId = '') {
    const safeTaskId = String(taskId || '').trim()
    if (!safeTaskId) {
      return {
        handled: false,
        type: 'invalid'
      }
    }

    const queueIndex = this.downloadQueue.findIndex(
      (task) => String(task?.id || '').trim() === safeTaskId
    )
    if (queueIndex !== -1) {
      const task = this.downloadQueue.splice(queueIndex, 1)[0]
      this.completedTaskIds.add(safeTaskId)
      return {
        handled: true,
        type: 'queued',
        task
      }
    }

    const readyQueueIndex = this.readyTaskQueue.findIndex(
      (task) => String(task?.id || '').trim() === safeTaskId
    )
    if (readyQueueIndex !== -1) {
      const task = this.readyTaskQueue.splice(readyQueueIndex, 1)[0]
      this.completedTaskIds.add(safeTaskId)
      return {
        handled: true,
        type: 'ready',
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

    const launchingTaskIndex = this.launchingTasks.findIndex(
      (task) => String(task?.id || '').trim() === safeTaskId
    )
    if (launchingTaskIndex !== -1) {
      this.pendingCancelTaskIds.add(safeTaskId)
      if (this.downloadNavigations.has(safeTaskId)) {
        const task = this.launchingTasks.splice(launchingTaskIndex, 1)[0]
        this.clearTaskLaunchTimeout(task)
        this.pendingCancelTaskIds.delete(safeTaskId)
        this.completedTaskIds.add(safeTaskId)
        this.onCanceled(task, '任务已取消', null)
        this.processNext()
        return { handled: true, type: 'launching', task }
      }
      return {
        handled: true,
        type: 'launching',
        task: this.launchingTasks[launchingTaskIndex]
      }
    }

    const activeInfo = this.activeDownloads.get(safeTaskId)
    if (activeInfo) {
      activeInfo.isCancelling = true
      this.pendingCancelTaskIds.add(safeTaskId)
      activeInfo.item.cancel()
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

  markTaskFinished(taskId = '') {
    const safeTaskId = String(taskId || '').trim()
    if (!safeTaskId) {
      return
    }
    this.completedTaskIds.add(safeTaskId)
  }

  getTaskDownloadCandidates(task = {}) {
    const cachedCandidates = Array.isArray(task?._downloadUrlCandidates)
      ? task._downloadUrlCandidates
      : []
    if (cachedCandidates.length) {
      return cachedCandidates
    }

    const sourceCandidates = Array.isArray(task?.download_url_candidates)
      ? task.download_url_candidates
      : []
    const candidates = []

    sourceCandidates.forEach((item) => {
      const safeItem = String(item || '').trim()
      if (safeItem && !candidates.includes(safeItem)) {
        candidates.push(safeItem)
      }
    })

    const currentUrl = String(task?.download_url || '').trim()
    if (currentUrl && !candidates.includes(currentUrl)) {
      candidates.push(currentUrl)
    }

    task._downloadUrlCandidates = candidates
    return candidates
  }

  prepareTaskDownloadUrl(task = {}) {
    const candidates = this.getTaskDownloadCandidates(task)
    if (!candidates.length) {
      return ''
    }

    let currentIndex = Number(task?._downloadUrlIndex)
    if (!Number.isFinite(currentIndex) || currentIndex < 0) {
      currentIndex = 0
    }
    if (currentIndex >= candidates.length) {
      currentIndex = candidates.length - 1
    }

    task._downloadUrlIndex = currentIndex
    task.download_url = candidates[currentIndex]
    return String(task.download_url || '').trim()
  }

  buildProbeCacheKey(url = '', probeConfig = {}) {
    const safeUrl = toSafeUrlText(url)
    const normalizedProbeConfig = normalizeProbeConfig(probeConfig)
    return [
      safeUrl,
      normalizedProbeConfig.timeoutMs,
      normalizedProbeConfig.sampleBytes,
      normalizedProbeConfig.directSpeedKeepRatio
    ].join('::')
  }

  getCachedProbeResult(url = '', probeConfig = {}) {
    const cacheKey = this.buildProbeCacheKey(url, probeConfig)
    const cached = this.downloadProbeCache.get(cacheKey)
    if (!cached) {
      return null
    }

    const normalizedProbeConfig = normalizeProbeConfig(probeConfig)
    if (
      normalizedProbeConfig.cacheTtlMs > 0 &&
      Date.now() - Number(cached.cachedAt || 0) > normalizedProbeConfig.cacheTtlMs
    ) {
      this.downloadProbeCache.delete(cacheKey)
      return null
    }

    return {
      ...cached.result
    }
  }

  setCachedProbeResult(url = '', probeConfig = {}, result = {}) {
    const normalizedProbeConfig = normalizeProbeConfig(probeConfig)
    if (normalizedProbeConfig.cacheTtlMs <= 0) {
      return
    }

    this.downloadProbeCache.set(this.buildProbeCacheKey(url, normalizedProbeConfig), {
      cachedAt: Date.now(),
      result: {
        ...result
      }
    })
  }

  async probeDownloadCandidate(task = {}, url = '', index = 0) {
    const safeUrl = toSafeUrlText(url)
    const probeConfig = normalizeProbeConfig(task?.downloadProbe)
    if (!safeUrl) {
      return {
        url: safeUrl,
        index,
        ok: false,
        latencyMs: 0,
        bytesPerSecond: 0,
        status: 0,
        errorMessage: '下载地址为空'
      }
    }

    const cachedResult = this.getCachedProbeResult(safeUrl, probeConfig)
    if (cachedResult) {
      return {
        ...cachedResult,
        index,
        cached: true
      }
    }

    const startedAt = Date.now()

    try {
      const response = await axios({
        url: safeUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: probeConfig.timeoutMs,
        maxRedirects: 5,
        headers: {
          ...this.getRequestHeaders(task),
          Range: `bytes=0-${Math.max(probeConfig.sampleBytes - 1, 0)}`
        },
        validateStatus: (status) => status >= 200 && status < 400
      })

      const stream = response?.data
      const sampledBytes = await new Promise((resolve, reject) => {
        if (!stream || typeof stream.on !== 'function') {
          resolve(0)
          return
        }

        let settled = false
        let receivedBytes = 0

        const cleanup = () => {
          stream.removeListener('data', handleData)
          stream.removeListener('end', handleEnd)
          stream.removeListener('error', handleError)
        }

        const finalizeResolve = () => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          resolve(receivedBytes)
        }

        const finalizeReject = (error) => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          reject(error)
        }

        const handleData = (chunk) => {
          receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
          if (receivedBytes >= probeConfig.sampleBytes) {
            finalizeResolve()
            destroyProbeStream(stream)
          }
        }

        const handleEnd = () => {
          finalizeResolve()
        }

        const handleError = (error) => {
          finalizeReject(error)
        }

        stream.on('data', handleData)
        stream.once('end', handleEnd)
        stream.once('error', handleError)
      })

      const latencyMs = Math.max(Date.now() - startedAt, 1)
      const result = {
        url: safeUrl,
        index,
        ok: true,
        status: Number(response?.status || 0),
        latencyMs,
        bytesPerSecond:
          sampledBytes > 0 ? Math.round((sampledBytes * 1000) / Math.max(latencyMs, 1)) : 0,
        sampledBytes
      }

      this.setCachedProbeResult(safeUrl, probeConfig, result)
      return result
    } catch (error) {
      const result = {
        url: safeUrl,
        index,
        ok: false,
        status: Number(error?.response?.status || 0),
        latencyMs: Math.max(Date.now() - startedAt, 1),
        bytesPerSecond: 0,
        sampledBytes: 0,
        errorMessage: String(error?.message || '探测失败')
      }

      this.setCachedProbeResult(safeUrl, probeConfig, result)
      return result
    }
  }

  buildRankedProbeResults(task = {}, probeResults = []) {
    const safeResults = Array.isArray(probeResults) ? probeResults : []
    if (safeResults.length <= 1) {
      return safeResults
    }

    const normalizedProbeConfig = normalizeProbeConfig(task?.downloadProbe)
    const rankedResults = [...safeResults].sort((left, right) => {
      if (!!left?.ok !== !!right?.ok) {
        return left?.ok ? -1 : 1
      }

      const speedDiff = Number(right?.bytesPerSecond || 0) - Number(left?.bytesPerSecond || 0)
      if (Math.abs(speedDiff) > 1024) {
        return speedDiff
      }

      const latencyDiff = Number(left?.latencyMs || 0) - Number(right?.latencyMs || 0)
      if (latencyDiff !== 0) {
        return latencyDiff
      }

      return Number(left?.index || 0) - Number(right?.index || 0)
    })

    const firstCandidateResult = safeResults.find((item) => Number(item?.index || 0) === 0)
    const bestCandidateResult = rankedResults.find((item) => !!item?.ok)
    const firstSpeed = Number(firstCandidateResult?.bytesPerSecond || 0)
    const bestSpeed = Number(bestCandidateResult?.bytesPerSecond || 0)

    if (
      firstCandidateResult?.ok &&
      bestCandidateResult?.ok &&
      rankedResults[0]?.url !== firstCandidateResult.url &&
      (bestSpeed <= 0 || firstSpeed >= bestSpeed * normalizedProbeConfig.directSpeedKeepRatio)
    ) {
      return [
        firstCandidateResult,
        ...rankedResults.filter((item) => item?.url !== firstCandidateResult.url)
      ]
    }

    return rankedResults
  }

  async reorderTaskDownloadCandidates(task = {}) {
    const candidates = this.getTaskDownloadCandidates(task)
    const probeConfig = normalizeProbeConfig(task?.downloadProbe)
    if (!probeConfig.enabled || candidates.length <= 1) {
      return candidates
    }

    const probeResults = await Promise.all(
      candidates.map((candidate, index) => this.probeDownloadCandidate(task, candidate, index))
    )
    const rankedResults = this.buildRankedProbeResults(task, probeResults)
    const successCount = rankedResults.filter((item) => !!item?.ok).length
    if (!successCount) {
      this.onLog(
        'warn',
        `任务 ${String(task?.id || '').trim() || 'unknown'} 下载地址探测失败，沿用原始候选顺序`
      )
      return candidates
    }

    task._downloadUrlCandidates = rankedResults.map((item) => String(item?.url || '').trim())
    task._downloadUrlIndex = 0
    task.download_url = task._downloadUrlCandidates[0]

    const preferredResult = rankedResults[0]
    this.onLog(
      'info',
      `任务 ${String(task?.id || '').trim() || 'unknown'} 下载地址探测完成，优先使用 ${preferredResult?.index + 1}/${rankedResults.length} 个候选地址（${formatProbeSpeed(preferredResult?.bytesPerSecond || 0)}）`
    )

    return task._downloadUrlCandidates
  }

  switchTaskToNextDownloadUrl(task = {}, reason = '') {
    const candidates = this.getTaskDownloadCandidates(task)
    if (candidates.length <= 1) {
      return false
    }

    const currentIndex = Number.isFinite(Number(task?._downloadUrlIndex))
      ? Number(task._downloadUrlIndex)
      : 0
    const nextIndex = currentIndex + 1
    if (nextIndex >= candidates.length) {
      return false
    }

    task._downloadUrlIndex = nextIndex
    task.download_url = candidates[nextIndex]

    this.onLog(
      'warn',
      `任务 ${String(task?.id || '').trim() || 'unknown'} ${String(reason || '').trim() || '下载失败'}，切换到备用下载地址 ${nextIndex + 1}/${candidates.length}`
    )

    return true
  }

  async resolveNetworkImpactDiagnosis(url = '') {
    const safeUrl = toSafeUrlText(url)
    if (
      !safeUrl ||
      !this.downloadSession ||
      typeof this.downloadSession.resolveProxy !== 'function'
    ) {
      return buildNetworkImpactDiagnosis(safeUrl, 'DIRECT', '')
    }

    try {
      const proxyRules = await this.downloadSession.resolveProxy(safeUrl)
      return buildNetworkImpactDiagnosis(safeUrl, proxyRules || 'DIRECT', '')
    } catch (error) {
      return buildNetworkImpactDiagnosis(
        safeUrl,
        'DIRECT',
        String(error?.message || error || '未知错误')
      )
    }
  }

  async attachNetworkImpactDiagnosis(task = {}, url = '') {
    const diagnosis = await this.resolveNetworkImpactDiagnosis(url || task?.download_url)
    task.networkImpact = diagnosis

    const safeTaskId = String(task?.id || '').trim() || 'unknown'
    this.onLog(
      diagnosis.possiblyAffected || diagnosis.proxyErrorMessage ? 'warn' : 'info',
      `任务 ${safeTaskId} VPN/代理影响检测：${diagnosis.summary}`
    )

    return diagnosis
  }

  requeueTask(task = {}) {
    if (!task || typeof task !== 'object') {
      return
    }

    this.downloadQueue.unshift(task)
  }

  clearTaskLaunchTimeout(task = null) {
    const taskId = String(task?.id || '').trim()
    const view = this.downloadNavigations.get(taskId)
    if (view) {
      this.downloadNavigations.delete(taskId)
      // 等 will-download 完成绑定后再释放导航，避免打断已交给下载引擎的文件。
      setImmediate(() => {
        if (!view.webContents.isDestroyed()) view.webContents.close()
      })
    }
    if (!task || !task._launchTimeoutId) {
      return
    }

    clearTimeout(task._launchTimeoutId)
    task._launchTimeoutId = null
  }

  startLaunchTimeout(task = {}) {
    const safeTaskId = String(task?.id || '').trim()
    if (!safeTaskId || this.launchTimeoutMs <= 0) {
      return
    }

    this.clearTaskLaunchTimeout(task)
    const timeoutId = setTimeout(() => {
      this.handleLaunchTimeout(safeTaskId)
    }, this.launchTimeoutMs)
    timeoutId.unref?.()
    task._launchTimeoutId = timeoutId
  }

  handleLaunchTimeout(taskId = '') {
    const safeTaskId = String(taskId || '').trim()
    const taskIndex = this.launchingTasks.findIndex(
      (task) => String(task?.id || '').trim() === safeTaskId
    )
    if (taskIndex === -1) {
      return
    }

    const task = this.launchingTasks.splice(taskIndex, 1)[0]
    this.clearTaskLaunchTimeout(task)

    if (this.pendingCancelTaskIds.has(safeTaskId) || this.completedTaskIds.has(safeTaskId)) {
      this.processNext()
      return
    }

    this.completedTaskIds.add(safeTaskId)
    this.onFailed(task, this.buildFailureMessage(task, '下载启动超时'), null)
    this.processNext()
  }

  clearStallTimeout(info = null) {
    if (!info?.stallTimer) {
      return
    }

    clearTimeout(info.stallTimer)
    info.stallTimer = null
  }

  refreshStallTimeout(taskId = '') {
    const safeTaskId = String(taskId || '').trim()
    const info = this.activeDownloads.get(safeTaskId)
    if (!info || info.isCancelling || this.stallTimeoutMs <= 0) {
      return
    }

    this.clearStallTimeout(info)
    const timeoutId = setTimeout(() => {
      this.handleStallTimeout(safeTaskId)
    }, this.stallTimeoutMs)
    timeoutId.unref?.()
    info.stallTimer = timeoutId
  }

  handleStallTimeout(taskId = '') {
    const safeTaskId = String(taskId || '').trim()
    const info = this.activeDownloads.get(safeTaskId)
    if (!info || info.isCancelling) {
      return
    }

    info.isTimedOut = true
    info.timeoutMessage = '下载超时：长时间没有下载进度'
    this.clearStallTimeout(info)

    try {
      info.item.cancel()
    } catch (error) {
      const payload = this.buildPayload(safeTaskId)
      this.activeDownloads.delete(safeTaskId)
      this.pendingCancelTaskIds.delete(safeTaskId)
      this.completedTaskIds.add(safeTaskId)
      this.onLog('warn', `任务 ${safeTaskId} 超时取消失败：${String(error?.message || error)}`)
      this.onFailed(info.task, this.buildFailureMessage(info.task, info.timeoutMessage, payload), payload)
      this.processNext()
    }
  }

  getDownloadItemUrlCandidates(item = null) {
    const urlList = []
    const pushUrl = (value = '') => {
      const safeValue = normalizeUrlCompareKey(value)
      if (safeValue && !urlList.includes(safeValue)) {
        urlList.push(safeValue)
      }
    }

    try {
      if (item && typeof item.getURLChain === 'function') {
        const urlChain = item.getURLChain()
        if (Array.isArray(urlChain)) {
          urlChain.forEach(pushUrl)
        }
      }
    } catch {
      // ignore
    }

    try {
      if (item && typeof item.getURL === 'function') {
        pushUrl(item.getURL())
      }
    } catch {
      // ignore
    }

    return urlList
  }

  consumeLaunchingTaskForItem(item = null) {
    if (!this.launchingTasks.length) {
      return null
    }

    const itemUrlList = this.getDownloadItemUrlCandidates(item)
    if (itemUrlList.length) {
      const taskIndex = this.launchingTasks.findIndex((task) => {
        const candidateList = this.getTaskDownloadCandidates(task).map((value) =>
          normalizeUrlCompareKey(value)
        )
        const currentUrl = normalizeUrlCompareKey(task?.download_url || '')
        if (currentUrl && !candidateList.includes(currentUrl)) {
          candidateList.push(currentUrl)
        }

        return itemUrlList.some((url) => candidateList.includes(url))
      })

      if (taskIndex !== -1) {
        const task = this.launchingTasks.splice(taskIndex, 1)[0]
        this.clearTaskLaunchTimeout(task)
        return task
      }
    }

    const task = this.launchingTasks.shift() || null
    this.clearTaskLaunchTimeout(task)
    return task
  }

  cleanupTaskArtifacts(task = {}, item = null) {
    const filePath = String(task?.finalFilePath || item?.getSavePath?.() || '').trim()
    clearDownloadArtifacts(filePath)
  }

  resolveTaskAttemptInfo(task = {}, payload = null) {
    const candidates = this.getTaskDownloadCandidates(task)
    const attemptCount = Math.max(candidates.length, 1)
    const rawIndex = Number(task?._downloadUrlIndex)
    const attemptIndex = Number.isFinite(rawIndex)
      ? Math.min(Math.max(rawIndex + 1, 1), attemptCount)
      : 1
    const payloadUrlChain = Array.isArray(payload?.urlChain) ? payload.urlChain : []
    const currentUrl =
      toSafeUrlText(payloadUrlChain[payloadUrlChain.length - 1]) ||
      toSafeUrlText(task?.download_url) ||
      toSafeUrlText(candidates[attemptIndex - 1] || '')

    return {
      attemptIndex,
      attemptCount,
      currentUrl
    }
  }

  buildFailureMessage(task = {}, fallbackMessage = '下载失败', payload = null) {
    const safeFallbackMessage = String(fallbackMessage || '下载失败').trim() || '下载失败'
    const attemptInfo = this.resolveTaskAttemptInfo(task, payload)

    if (attemptInfo.attemptCount > 1) {
      return `${safeFallbackMessage}，已尝试 ${attemptInfo.attemptIndex}/${attemptInfo.attemptCount} 个下载地址`
    }

    return safeFallbackMessage
  }

  getOccupiedSlotCount() {
    return (
      this.activeDownloads.size +
      this.readyTaskQueue.length +
      this.preparingTaskIds.size +
      this.launchingTasks.length
    )
  }

  prepareQueuedTask(nextTask = {}) {
    const safeTaskId = String(nextTask?.id || '').trim()
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

        const launchUrl = this.prepareTaskDownloadUrl(preparedTask)
        if (!launchUrl) {
          this.completedTaskIds.add(safeTaskId)
          this.onFailed(preparedTask, this.buildFailureMessage(preparedTask, '下载地址为空'), null)
          this.processNext()
          return
        }

        await this.attachNetworkImpactDiagnosis(preparedTask, launchUrl)
        this.readyTaskQueue.push(preparedTask)
        this.processNext()
      })
      .catch((error) => {
        this.preparingTaskIds.delete(safeTaskId)
        this.completedTaskIds.add(safeTaskId)
        this.onFailed(
          nextTask,
          this.buildFailureMessage(nextTask, String(error?.message || '下载任务准备失败')),
          null
        )
        this.processNext()
      })
  }

  launchReadyTask() {
    if (!this.initialized || !this.downloadSession) {
      return
    }

    while (this.activeDownloads.size + this.launchingTasks.length < this.maxConcurrentDownloads) {
      const preparedTask = this.readyTaskQueue.shift()
      if (!preparedTask) {
        return
      }

      const safeTaskId = String(preparedTask?.id || '').trim()
      if (!safeTaskId || this.completedTaskIds.has(safeTaskId)) {
        continue
      }

      if (this.pendingCancelTaskIds.has(safeTaskId)) {
        this.pendingCancelTaskIds.delete(safeTaskId)
        this.completedTaskIds.add(safeTaskId)
        this.onCanceled(preparedTask, '任务已取消', null)
        continue
      }

      const launchUrl = this.prepareTaskDownloadUrl(preparedTask)
      if (!launchUrl) {
        this.completedTaskIds.add(safeTaskId)
        this.onFailed(preparedTask, this.buildFailureMessage(preparedTask, '下载地址为空'), null)
        continue
      }

      this.launchingTasks.push(preparedTask)

      try {
        const headers = this.getRequestHeaders(preparedTask)
        this.startLaunchTimeout(preparedTask)
        this.launchDownloadRequest(preparedTask, launchUrl, headers)
      } catch (error) {
        this.handleLaunchFailure(preparedTask, error)
      }
    }
  }

  launchDownloadRequest(task, url, headers = {}) {
    const entries = Object.entries(headers)
    const referrer = entries.find(([key]) => key.toLowerCase() === 'referer')?.[1]
    if (!referrer) {
      this.downloadSession.downloadURL(url, { headers })
      return
    }

    // downloadURL 会移除 Referer；使用原生 httpReferrer 保留来源及重定向语义。
    // 此视图只负责触发下载，不挂载到窗口，也不执行远程页面脚本。
    const view = new WebContentsView({
      webPreferences: {
        session: this.downloadSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false
      }
    })
    this.downloadNavigations.set(String(task.id).trim(), view)
    this.downloadNavigationOwners.set(view.webContents, task)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const userAgent = entries.find(([key]) => key.toLowerCase() === 'user-agent')?.[1]
    view.webContents.loadURL(url, {
      httpReferrer: referrer,
      ...(userAgent ? { userAgent } : {}),
      extraHeaders: entries
        .filter(([key]) => !['referer', 'user-agent'].includes(key.toLowerCase()))
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
    }).then(
      () => this.handleLaunchFailure(task, new Error('下载地址返回了网页，未获取到文件')),
      (error) => {
        // Chromium 可能先结束导航，再派发附件下载事件；由启动超时兜底无事件的失败。
        if (error?.code === 'ERR_ABORTED' || error?.code === 'ERR_FAILED') return
        this.handleLaunchFailure(task, error)
      }
    )
  }

  handleLaunchFailure(task, error) {
    if (!this.initialized) return
    const index = this.launchingTasks.indexOf(task)
    // 附件下载会使 loadURL 拒绝；已经进入 will-download 的任务继续正常下载。
    if (index === -1) return
    this.launchingTasks.splice(index, 1)
    this.clearTaskLaunchTimeout(task)
    if (this.switchTaskToNextDownloadUrl(task, '下载启动失败')) {
      this.readyTaskQueue.unshift(task)
    } else {
      this.completedTaskIds.add(String(task.id || '').trim())
      this.onFailed(task, this.buildFailureMessage(task, String(error?.message || '下载启动失败')), null)
    }
    queueMicrotask(this.processNext)
  }

  processNext = () => {
    if (!this.initialized || !this.downloadSession) {
      return
    }

    while (this.getOccupiedSlotCount() < this.maxConcurrentDownloads) {
      const nextTask = this.downloadQueue.shift()
      if (!nextTask) {
        break
      }
      this.prepareQueuedTask(nextTask)
    }

    this.launchReadyTask()
  }

  handleWillDownload = (event, item, contents) => {
    const navigationTask = contents && this.downloadNavigationOwners.get(contents)
    if (navigationTask && !this.launchingTasks.includes(navigationTask)) {
      // 取消或超时后的迟到事件不能被绑定到下一项任务。
      event.preventDefault()
      return
    }
    const task = navigationTask || this.consumeLaunchingTaskForItem(item)
    if (navigationTask) {
      this.launchingTasks.splice(this.launchingTasks.indexOf(navigationTask), 1)
      this.clearTaskLaunchTimeout(navigationTask)
    }

    if (!task) {
      this.onLog('warn', '检测到未绑定任务的 will-download 事件，已忽略')
      return
    }

    const taskId = String(task.id || '').trim()
    const savePath = this.resolveSavePath(task, item)
    if (savePath) {
      item.setSavePath(savePath)
      task.finalFilePath = savePath
    }

    const activeInfo = {
      task,
      item,
      lastProgressAt: 0,
      interruptedRetryCount: 0,
      resumeTimer: null,
      stallTimer: null,
      isTimedOut: false,
      timeoutMessage: '',
      isCancelling: this.pendingCancelTaskIds.has(taskId)
    }

    this.activeDownloads.set(taskId, activeInfo)
    this.refreshStallTimeout(taskId)

    item.on('updated', (_downloadEvent, state) => {
      const currentInfo = this.activeDownloads.get(taskId)
      if (!currentInfo) {
        return
      }

      if (state === 'interrupted') {
        this.handleInterrupted(taskId)
        this.refreshStallTimeout(taskId)
        this.emitProgress(taskId, true)
        return
      }

      if (currentInfo.resumeTimer) {
        clearTimeout(currentInfo.resumeTimer)
        currentInfo.resumeTimer = null
      }

      this.refreshStallTimeout(taskId)
      this.emitProgress(taskId)
    })

    item.once('done', (_downloadEvent, state) => {
      const currentInfo = this.activeDownloads.get(taskId)
      if (!currentInfo) {
        this.processNext()
        return
      }

      if (currentInfo.resumeTimer) {
        clearTimeout(currentInfo.resumeTimer)
      }
      this.clearStallTimeout(currentInfo)

      const payload = this.buildPayload(taskId)
      this.activeDownloads.delete(taskId)
      this.pendingCancelTaskIds.delete(taskId)

      if (
        state !== 'completed' &&
        state !== 'cancelled' &&
        !currentInfo.isCancelling &&
        !currentInfo.isTimedOut &&
        this.switchTaskToNextDownloadUrl(task, '当前地址下载失败')
      ) {
        this.cleanupTaskArtifacts(task, currentInfo.item)
        this.requeueTask(task)
        this.processNext()
        return
      }

      this.completedTaskIds.add(taskId)

      if (state === 'completed') {
        this.onSuccess(task, payload)
      } else if (currentInfo.isTimedOut) {
        this.onFailed(
          task,
          this.buildFailureMessage(task, currentInfo.timeoutMessage || '下载超时', payload),
          payload
        )
      } else if (state === 'cancelled') {
        this.onCanceled(task, '任务已取消', payload)
      } else {
        this.onFailed(task, this.buildFailureMessage(task, '下载中断', payload), payload)
      }

      this.processNext()
    })

    if (activeInfo.isCancelling) {
      item.cancel()
      return
    }

    this.emitProgress(taskId, true)
    this.processNext()
  }

  handleInterrupted(taskId = '') {
    const info = this.activeDownloads.get(String(taskId || '').trim())
    if (!info) {
      return
    }

    if (info.isCancelling) {
      return
    }

    if (!info.item.canResume()) {
      return
    }

    if (info.resumeTimer || info.interruptedRetryCount >= MAX_INTERRUPTED_RESUME_RETRIES) {
      return
    }

    info.interruptedRetryCount += 1
    const delay = BASE_RESUME_DELAY * info.interruptedRetryCount

    info.resumeTimer = setTimeout(() => {
      const currentInfo = this.activeDownloads.get(String(taskId || '').trim())
      if (!currentInfo || currentInfo.isCancelling) {
        return
      }

      currentInfo.resumeTimer = null
      try {
        currentInfo.item.resume()
      } catch (error) {
        this.onLog(
          'warn',
          `任务 ${taskId} 自动恢复失败：${String(error?.message || error || '未知错误')}`
        )
      }
    }, delay)
  }

  emitProgress(taskId = '', force = false) {
    const info = this.activeDownloads.get(String(taskId || '').trim())
    if (!info) {
      return
    }

    const now = Date.now()
    if (!force && now - info.lastProgressAt < this.progressInterval) {
      return
    }

    info.lastProgressAt = now
    this.onProgress(info.task, this.buildPayload(taskId))
  }

  buildPayload(taskId = '') {
    const info = this.activeDownloads.get(String(taskId || '').trim())
    if (!info) {
      return null
    }

    const { item, task, interruptedRetryCount } = info
    const totalBytes = Number(item.getTotalBytes() || 0)
    const receivedBytes = Number(item.getReceivedBytes() || 0)
    const urlChain =
      typeof item.getURLChain === 'function' ? item.getURLChain() : [task.download_url]
    const attemptInfo = this.resolveTaskAttemptInfo(task, {
      urlChain
    })

    return {
      id: task.id,
      totalBytes,
      receivedBytes,
      speed: Number(item.getCurrentBytesPerSecond() || 0),
      progress: totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0,
      fileType: String(item.getMimeType() || task.file_type || 'unknown'),
      fileName: String(item.getFilename() || ''),
      supportsRange: item.canResume(),
      isPaused: item.isPaused(),
      urlChain,
      eTag: typeof item.getETag === 'function' ? item.getETag() : '',
      lastModified:
        typeof item.getLastModifiedTime === 'function' ? item.getLastModifiedTime() : '',
      interruptedRetryCount,
      attemptIndex: attemptInfo.attemptIndex,
      attemptCount: attemptInfo.attemptCount,
      currentUrl: attemptInfo.currentUrl,
      networkImpact: task.networkImpact || null
    }
  }
}
