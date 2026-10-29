import { createMainAdapter } from './main-network.js'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { useAppStore } from '@renderer/store/appStore.js'
import { TtlLruCache } from '../../../shared/utils/ttl-lru-cache.js'

const { VITE_REQUEST_API, VITE_APP_VERSION } = import.meta.env

const CLIENT_ID_KEY = 'vertex_statistics_client_id'
const QUEUE_KEY = 'vertex_statistics_event_queue'
const LAST_ACTIVE_AT_KEY = 'vertex_statistics_last_active_at'
const BATCH_SIZE = 20
const MAX_BATCH_SIZE = 50
const MAX_QUEUE_SIZE = 200
const FLUSH_INTERVAL = 30000
const ACTIVE_INTERVAL = 30 * 60 * 1000
const PAGE_DEBOUNCE = 3000
const MOD_VIEW_DEBOUNCE = 5000
const ERROR_FULL_INTERVAL = 60000
const API_PATH = '/api/statistics/events/batch'
const SENSITIVE_KEY_PATTERN = /token|cookie|authorization|password|secret|apikey|api_key/i
const INSTALL_START_CHANNELS = new Set([
  'source-install-task:create',
  'source-install:execute',
  'installModsExecuteV2',
  'ficsitInstallMod',
  'ficsitInstallDownloadedMods',
  'thunderstoreInstallDownloadedPackages'
])
const DOWNLOAD_START_CHANNELS = new Set(['addTasksToQueue'])
const DOWNLOAD_DONE_CHANNELS = new Set(['download-success', 'mod-download-success'])
const DOWNLOAD_FAIL_CHANNELS = new Set(['download-failed', 'download-mod-failed'])
const DOWNLOAD_RESULT_CHANNELS = new Set([...DOWNLOAD_DONE_CHANNELS, ...DOWNLOAD_FAIL_CHANNELS])
const SOURCE_INSTALL_TASK_CREATE_CHANNEL = 'source-install-task:create'
const SOURCE_INSTALL_TASK_JOB_UPDATED_CHANNEL = 'source-install-task:updated'
const SOURCE_INSTALL_TASK_ARTIFACT_UPDATED_CHANNEL = 'source-install-task:artifact-updated'
const SOURCE_INSTALL_TASK_RESULT_CHANNELS = new Set([
  SOURCE_INSTALL_TASK_JOB_UPDATED_CHANNEL,
  SOURCE_INSTALL_TASK_ARTIFACT_UPDATED_CHANNEL
])
const SOURCE_INSTALL_TASK_INSTALL_DONE_STATES = new Set(['completed', 'completed_with_warning'])
const SOURCE_INSTALL_TASK_INSTALL_FAIL_STATES = new Set([
  'failed',
  'partial_failed',
  'precheck_blocked',
  'cancelled',
  'recoverable'
])
const SOURCE_INSTALL_TASK_DOWNLOAD_START_STATES = new Set(['queued', 'downloading'])
const SOURCE_INSTALL_TASK_DOWNLOAD_DONE_STATES = new Set(['downloaded'])
const SOURCE_INSTALL_TASK_DOWNLOAD_FAIL_STATES = new Set(['failed', 'cancelled', 'missing'])
const DOWNLOAD_CONTEXT_TTL = 24 * 60 * 60 * 1000
const MAX_DOWNLOAD_CONTEXT_SIZE = 500

let queue = []
let timer = null
let flushing = false
let installed = false
let enabled = null
let generation = 0
let requestController = null
let clientId = ''
let lastPageViewMap = new TtlLruCache({ max: 300, ttl: 60 * 60 * 1000 })
let lastModViewMap = new TtlLruCache({ max: 5000, ttl: 24 * 60 * 60 * 1000 })
let lastErrorMap = new TtlLruCache({ max: 2000, ttl: 24 * 60 * 60 * 1000 })
let ipcInvokeWrapped = false
let ipcSendWrapped = false
let ipcRemoveAllWrapped = false
let downloadResultListenerMap = new Map()
let downloadContextMap = new Map()
let sourceInstallTaskListenerMap = new Map()
let sourceInstallTaskResultMap = new Map()
let sourceInstallArtifactResultMap = new Map()

const silentAxios = axios.create({
  adapter: createMainAdapter('account'),
  timeout: 10000,
  withCredentials: true
})

export async function initStatisticsTracker({ app, router } = {}) {
  if (installed) return
  installed = true
  let configRevision = 0
  window.addEventListener('vertex-system-config-change', event => {
    configRevision++
    setStatisticsEnabled(event.detail?.statisticsEnabled === true)
  })
  window.electron?.ipcRenderer?.on('statistics:consent-changed', (_event, state) => {
    configRevision++
    setStatisticsEnabled(state?.enabled === true)
  })

  registerAppActiveListeners()
  registerErrorListeners(app)
  registerRouterTracker(router)
  registerIpcInstallTracker()
  const initialGeneration = configRevision
  try {
    const settings = await window.electron.ipcRenderer.invoke('getConfigByKey', { key: 'systemConfig.settings' })
    if (initialGeneration === configRevision) setStatisticsEnabled(settings?.statisticsEnabled === true, { restorePending: true })
  } catch {
    if (initialGeneration === configRevision) setStatisticsEnabled(false)
  }
}

export function setStatisticsEnabled(value, { restorePending = false } = {}) {
  if (enabled === (value === true)) return
  enabled = value === true
  generation++
  requestController?.abort()
  requestController = null
  flushing = false
  if (!enabled) {
    if (timer) window.clearInterval(timer)
    timer = null
    queue = []
    clientId = ''
    for (const key of [QUEUE_KEY, CLIENT_ID_KEY, LAST_ACTIVE_AT_KEY]) localStorage.removeItem(key)
    lastPageViewMap.clear()
    lastModViewMap.clear()
    lastErrorMap.clear()
    downloadContextMap.clear()
    sourceInstallTaskResultMap.clear()
    sourceInstallArtifactResultMap.clear()
    return
  }
  clientId = getOrCreateClientId()
  queue = restorePending ? loadQueue() : []
  if (!restorePending) localStorage.removeItem(QUEUE_KEY)
  startFlushTimer()
  trackAppActive(true)
}

export function trackAppActive(force = false) {
  if (!enabled) return
  const now = Date.now()
  const lastActiveAt = Number(localStorage.getItem(LAST_ACTIVE_AT_KEY) || 0)
  if (!force && lastActiveAt > 0 && now - lastActiveAt < ACTIVE_INTERVAL) {
    return
  }
  localStorage.setItem(LAST_ACTIVE_AT_KEY, String(now))
  trackEvent('app_active')
}

export function trackPageView(route) {
  if (!enabled) return
  const pagePath = resolvePagePath(route)
  if (!pagePath) return
  const now = Date.now()
  const lastAt = lastPageViewMap.get(pagePath) || 0
  if (now - lastAt < PAGE_DEBOUNCE) return
  lastPageViewMap.set(pagePath, now)
  trackEvent('page_view', {
    source: 'vertex',
    targetType: 'page',
    pagePath,
    pageName: route?.meta?.title || route?.name || pagePath,
    properties: {
      routeName: route?.name || '',
      params: route?.params || {},
      query: route?.query || {}
    }
  })
}

function resolvePagePath(route) {
  const matched = Array.isArray(route?.matched) ? route.matched : []
  const record = matched.length > 0 ? matched[matched.length - 1] : null
  return String(record?.path || route?.path || '').trim()
}

export function trackGameView({ gameId, targetName, source = 'vertex', properties = {} } = {}) {
  if (!gameId) return
  trackEvent('game_view', {
    source,
    targetType: 'game',
    targetId: String(gameId),
    targetName,
    gameId: String(gameId),
    properties
  })
}

export function trackModView(data = {}) {
  if (!enabled) return
  const normalized = normalizeModPayload(data)
  if (!normalized.gameId || !normalized.targetId) return
  const key = `${normalized.source}:${normalized.gameId}:${normalized.targetId}`
  const now = Date.now()
  const lastAt = lastModViewMap.get(key) || 0
  if (now - lastAt < MOD_VIEW_DEBOUNCE) return
  lastModViewMap.set(key, now)
  trackEvent('mod_view', normalized)
}

export function trackModDownloadStart(data = {}) {
  trackModAction('mod_download_start', data)
}

export function trackModDownloadDone(data = {}) {
  trackModAction('mod_download_done', data)
}

export function trackModDownloadFail(data = {}) {
  trackModAction('mod_download_fail', data)
}

export function trackModInstallStart(data = {}) {
  trackModAction('mod_install_start', data)
}

export function trackModInstallDone(data = {}) {
  trackModAction('mod_install_done', data)
}

export function trackModInstallFail(data = {}) {
  trackModAction('mod_install_fail', data)
}

export function reportClientError(error, options = {}) {
  if (!enabled) return
  const errorType = options.errorType || 'client_error'
  const message = sanitizeText(resolveErrorMessage(error), 1024)
  const stack = sanitizeStack(resolveErrorStack(error))
  const errorHash = createErrorHash(errorType, message, stack)
  const now = Date.now()
  const lastAt = lastErrorMap.get(errorHash) || 0
  const includeStack = now - lastAt >= ERROR_FULL_INTERVAL
  lastErrorMap.set(errorHash, now)

  trackEvent('client_error', {
    source: 'vertex',
    targetType: 'error',
    status: 'fail',
    errorType,
    errorHash,
    errorMessage: message,
    errorStack: includeStack ? stack : '',
    properties: {
      ...safePlainObject(options.properties),
      stackOmitted: !includeStack
    }
  })
}

export function trackEvent(eventType, payload = {}) {
  if (!enabled || !eventType) return
  const event = buildEvent(eventType, payload)
  queue.push(event)
  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(queue.length - MAX_QUEUE_SIZE)
  }
  persistQueue()
  if (queue.length >= BATCH_SIZE) {
    flushStatisticsQueue()
  }
}

export async function flushStatisticsQueue({ keepalive = false } = {}) {
  if (!enabled || flushing || queue.length === 0) return
  const batchGeneration = generation
  const controller = requestController = new AbortController()
  flushing = true
  const batch = queue.splice(0, MAX_BATCH_SIZE)
  persistQueue()
  try {
    await sendBatch(batch, keepalive, controller.signal)
  } catch {
    if (enabled && batchGeneration === generation) {
      queue = [...batch, ...queue].slice(0, MAX_QUEUE_SIZE)
      persistQueue()
    }
  } finally {
    if (batchGeneration === generation) flushing = false
    if (requestController === controller) requestController = null
  }
}

function trackModAction(eventType, data) {
  const normalized = normalizeModPayload(data)
  if (!normalized.gameId || !normalized.targetId) return
  trackEvent(eventType, normalized)
}

function normalizeModPayload(data = {}) {
  const source = normalizeSource(data.source || data.sourcePlatform || data.sourceType)
  const gameId = data.gameId || data.sourceGameId || data.steamAppId || data.appId
  const targetId = data.targetId || data.modId || data.id || data.sourceModId || data.packageName
  const targetName = data.targetName || data.modName || data.name || data.packageName
  return {
    source,
    targetType: 'mod',
    targetId: targetId == null ? '' : String(targetId),
    targetName: targetName == null ? '' : String(targetName),
    gameId: gameId == null ? '' : String(gameId),
    errorMessage: data.errorMessage || data.message || '',
    properties: data.properties || {}
  }
}

function buildEvent(eventType, payload = {}) {
  const appData = getAppData()
  const userData = getUserData()
  const plainPayload = safePlainObject(payload)
  return {
    eventId: uuidv4(),
    eventType,
    userId: userData.userId,
    clientId,
    source: normalizeSource(plainPayload.source),
    targetType: plainPayload.targetType || '',
    targetId: trimText(plainPayload.targetId, 128),
    targetName: trimText(plainPayload.targetName, 255),
    gameId: trimText(plainPayload.gameId, 128),
    pagePath: trimText(plainPayload.pagePath, 255),
    pageName: trimText(plainPayload.pageName, 128),
    status: normalizeStatus(plainPayload.status, eventType),
    clientVersion: appData.version,
    os: 'windows',
    errorType: trimText(plainPayload.errorType, 64),
    errorHash: trimText(plainPayload.errorHash, 128),
    errorMessage: sanitizeText(plainPayload.errorMessage, 1024),
    errorStack: sanitizeText(plainPayload.errorStack, 8192),
    properties: sanitizeProperties(plainPayload.properties),
    createdAt: new Date().toISOString()
  }
}

function buildBatchPayload(events) {
  const appData = getAppData()
  const userData = getUserData()
  return toPlainJson({
    clientId,
    userId: userData.userId,
    clientVersion: appData.version,
    events
  })
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json'
  }
}

function sendBatch(batch, keepalive, signal) {
  const payload = buildBatchPayload(batch)
  void keepalive
  return silentAxios.post(resolveReportUrl(), payload, {
    headers: buildHeaders(),
    signal
  })
}

function registerAppActiveListeners() {
  window.addEventListener('focus', () => trackAppActive())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      trackAppActive()
    }
  })
  window.addEventListener('beforeunload', () => {
    flushStatisticsQueue({ keepalive: true })
  })
}

function registerErrorListeners(app) {
  if (app?.config) {
    app.config.errorHandler = (error, instance, info) => {
      reportClientError(error, {
        errorType: 'vue_error',
        properties: {
          info,
          component: instance?.type?.name || instance?.type?.__name || ''
        }
      })
      console.error('[渲染进程] Vue异常:', error, info)
    }
  }

  window.onerror = (message, source, lineno, colno, error) => {
    reportClientError(error || message, {
      errorType: 'window_error',
      properties: { source, lineno, colno }
    })
    console.error('[渲染进程] 未捕获异常:', message, { source, lineno, colno, error })
    return true
  }

  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, {
      errorType: 'promise_error'
    })
    console.error('[渲染进程] 未处理的 Promise 拒绝:', event.reason)
    event.preventDefault()
  })
}

function registerRouterTracker(router) {
  if (!router?.afterEach) return
  router.afterEach((to) => {
    trackPageView(to)
    trackRouteEntityViews(to)
  })
}

function trackRouteEntityViews(route) {
  const routeName = String(route?.name || '')
  const params = route?.params || {}
  const query = route?.query || {}
  const source = resolveRouteSource(route)
  const gameId = params.id || query.gameId || query.steamAppId || query.appId || ''

  if (
    [
      'GameDetails',
      'GameModList',
      'GameModManagement',
      'GameThunderStoreModList',
      'GameFicsitModList',
      'GameNexusModList',
      'GameModioModList',
      'GameSourceInstallConfig',
      'GameThunderStoreConfigEditor',
      'GameModioConfigEditor',
      'GameNexusConfigEditor'
    ].includes(routeName)
  ) {
    trackGameView({
      gameId,
      source,
      targetName: query.gameName || query.name || '',
      properties: {
        routeName
      }
    })
  }

  if (routeName === 'GameModDetails') {
    trackModView({
      source,
      gameId: query.gameId || query.steamAppId || query.appId || '',
      targetId: params.id,
      targetName: query.modName || query.name || '',
      properties: {
        routeName
      }
    })
  }
}

function resolveRouteSource(route) {
  const routeName = String(route?.name || '').toLowerCase()
  const path = String(route?.path || route?.fullPath || '').toLowerCase()
  const params = route?.params || {}
  const meta = route?.meta || {}
  return normalizeSource(
    params.source ||
      params.sourcePlatform ||
      meta.sourcePlatform ||
      (routeName.includes('thunderstore') || path.includes('/thunderstore/')
        ? 'thunderstore'
        : routeName.includes('ficsit') || path.includes('/ficsit/')
          ? 'ficsit'
          : routeName.includes('modio') || path.includes('/modio/')
            ? 'modio'
            : routeName.includes('nexus') || path.includes('/nexus/')
              ? 'nexus'
              : 'vertex')
  )
}

function registerIpcInstallTracker() {
  const ipcRenderer = window.electron?.ipcRenderer
  if (!ipcRenderer) return
  registerIpcInvokeTracker(ipcRenderer)
  registerIpcSendTracker(ipcRenderer)
  registerIpcDownloadResultTracker(ipcRenderer)
  registerSourceInstallTaskEventTracker(ipcRenderer)
}

function registerIpcInvokeTracker(ipcRenderer) {
  if (ipcInvokeWrapped || !ipcRenderer?.invoke) return
  const rawInvoke = ipcRenderer.invoke.bind(ipcRenderer)
  try {
    ipcRenderer.invoke = (channel, ...args) => {
      if (!enabled) return rawInvoke(channel, ...args)
      const installEvents = INSTALL_START_CHANNELS.has(channel)
        ? safeBuildIpcEvents(() => resolveInstallEventsFromIpc(channel, args[0]))
        : []
      if (INSTALL_START_CHANNELS.has(channel)) {
        trackIpcInstallEvents('start', installEvents)
      }

      let invokeResult
      try {
        invokeResult = rawInvoke(channel, ...args)
      } catch (error) {
        trackIpcInstallEvents('fail', installEvents, error)
        throw error
      }

      if (!INSTALL_START_CHANNELS.has(channel)) {
        return invokeResult
      }

      return Promise.resolve(invokeResult)
        .then((result) => {
          if (channel === SOURCE_INSTALL_TASK_CREATE_CHANNEL) {
            if (isIpcResultFailed(result)) {
              trackIpcInstallEvents('fail', installEvents, result)
            }
            return result
          }
          trackIpcInstallEvents(isIpcResultFailed(result) ? 'fail' : 'done', installEvents, result)
          return result
        })
        .catch((error) => {
          trackIpcInstallEvents('fail', installEvents, error)
          throw error
        })
    }
    ipcInvokeWrapped = true
  } catch {
    ipcInvokeWrapped = false
  }
}

function registerIpcSendTracker(ipcRenderer) {
  if (ipcSendWrapped || !ipcRenderer?.send) return
  const rawSend = ipcRenderer.send.bind(ipcRenderer)
  try {
    ipcRenderer.send = (channel, ...args) => {
      if (DOWNLOAD_START_CHANNELS.has(channel)) {
        const downloadEvents = safeBuildIpcEvents(() =>
          resolveDownloadEventsFromIpc(channel, args[0])
        )
        trackIpcDownloadEvents('start', downloadEvents)
      }
      return rawSend(channel, ...args)
    }
    ipcSendWrapped = true
  } catch {
    ipcSendWrapped = false
  }
}

function registerIpcDownloadResultTracker(ipcRenderer) {
  if (!ipcRenderer?.on) return
  wrapIpcRemoveAllListeners(ipcRenderer)
  DOWNLOAD_RESULT_CHANNELS.forEach((channel) => ensureDownloadResultListener(ipcRenderer, channel))
}

function wrapIpcRemoveAllListeners(ipcRenderer) {
  if (ipcRemoveAllWrapped || !ipcRenderer?.removeAllListeners) return
  const rawRemoveAllListeners = ipcRenderer.removeAllListeners.bind(ipcRenderer)
  try {
    ipcRenderer.removeAllListeners = (channel, ...args) => {
      const result = rawRemoveAllListeners(channel, ...args)
      const channels =
        channel && isProtectedIpcListenerChannel(channel)
          ? [channel]
          : channel
            ? []
            : [...DOWNLOAD_RESULT_CHANNELS, ...SOURCE_INSTALL_TASK_RESULT_CHANNELS]
      channels.forEach((item) => {
        restoreProtectedIpcListener(ipcRenderer, item)
      })
      return result
    }
    ipcRemoveAllWrapped = true
  } catch {
    ipcRemoveAllWrapped = false
  }
}

function ensureDownloadResultListener(ipcRenderer, channel) {
  if (downloadResultListenerMap.has(channel) || !ipcRenderer?.on) return
  const handler = (_event, payload) => {
    trackIpcDownloadResult(channel, payload)
  }
  ipcRenderer.on(channel, handler)
  downloadResultListenerMap.set(channel, handler)
}

function registerSourceInstallTaskEventTracker(ipcRenderer) {
  if (!ipcRenderer?.on) return
  wrapIpcRemoveAllListeners(ipcRenderer)
  SOURCE_INSTALL_TASK_RESULT_CHANNELS.forEach((channel) =>
    ensureSourceInstallTaskListener(ipcRenderer, channel)
  )
}

function ensureSourceInstallTaskListener(ipcRenderer, channel) {
  if (sourceInstallTaskListenerMap.has(channel) || !ipcRenderer?.on) return
  const handler = (_event, payload) => {
    trackSourceInstallTaskEvent(channel, payload)
  }
  ipcRenderer.on(channel, handler)
  sourceInstallTaskListenerMap.set(channel, handler)
}

function isProtectedIpcListenerChannel(channel) {
  return DOWNLOAD_RESULT_CHANNELS.has(channel) || SOURCE_INSTALL_TASK_RESULT_CHANNELS.has(channel)
}

function restoreProtectedIpcListener(ipcRenderer, channel) {
  if (DOWNLOAD_RESULT_CHANNELS.has(channel)) {
    downloadResultListenerMap.delete(channel)
    ensureDownloadResultListener(ipcRenderer, channel)
  }
  if (SOURCE_INSTALL_TASK_RESULT_CHANNELS.has(channel)) {
    sourceInstallTaskListenerMap.delete(channel)
    ensureSourceInstallTaskListener(ipcRenderer, channel)
  }
}

function safeBuildIpcEvents(builder) {
  try {
    const events = builder()
    return Array.isArray(events) ? events : []
  } catch {
    return []
  }
}

function resolveInstallEventsFromIpc(channel, payload) {
  const plainPayload = safePlainObject(payload)
  const source = normalizeSource(
    plainPayload.source ||
      plainPayload.sourcePlatform ||
      plainPayload.sourceType ||
      resolveSourceByChannel(channel)
  )
  const gameId = resolvePayloadGameId(plainPayload)
  const items = collectInstallItems(plainPayload)
  const targets = items.length > 0 ? items : [plainPayload]

  return targets
    .slice(0, 20)
    .map((item) => {
      const targetId = resolvePayloadTargetId(item)
      const itemGameId = resolvePayloadGameId(item) || gameId
      if (!targetId || !itemGameId) return null
      return {
        source: normalizeSource(item?.source || item?.sourcePlatform || item?.sourceType || source),
        gameId: itemGameId,
        targetId,
        targetName: resolvePayloadTargetName(item),
        properties: {
          channel
        }
      }
    })
    .filter(Boolean)
}

function resolveDownloadEventsFromIpc(channel, payload) {
  const plainPayload = safePlainObject(payload)
  const source = normalizeSource(
    plainPayload.source ||
      plainPayload.sourcePlatform ||
      plainPayload.sourceType ||
      resolveSourceByChannel(channel)
  )
  const gameId = resolvePayloadGameId(plainPayload)
  const items = collectDownloadItems(plainPayload)
  const targets = items.length > 0 ? items : [plainPayload]

  return targets
    .slice(0, 20)
    .map((item) => {
      const targetId = resolvePayloadTargetId(item)
      const itemGameId = resolvePayloadGameId(item) || gameId
      if (!targetId || !itemGameId) return null
      return {
        source: normalizeSource(item?.source || item?.sourcePlatform || item?.sourceType || source),
        gameId: itemGameId,
        targetId,
        targetName: resolvePayloadTargetName(item),
        properties: {
          channel,
          taskId: String(item?.id || plainPayload?.id || ''),
          saveType: item?.saveType ?? plainPayload?.saveType ?? ''
        }
      }
    })
    .filter(Boolean)
}

function trackIpcInstallEvents(status, events, result) {
  try {
    const resultProperties = status === 'start' ? {} : resolveIpcResultProperties(result)
    events.forEach((event) => {
      const payload = {
        ...event,
        properties: {
          ...(event.properties || {}),
          ...resultProperties
        }
      }
      if (status === 'done') {
        trackModInstallDone(payload)
        return
      }
      if (status === 'fail') {
        trackModInstallFail({
          ...payload,
          errorMessage: resolveIpcFailureMessage(result)
        })
        return
      }
      trackModInstallStart(payload)
    })
  } catch {
    // 统计埋点失败不能影响安装流程
  }
}

function trackIpcDownloadEvents(status, events) {
  try {
    if (status === 'start') {
      rememberDownloadEvents(events)
    }

    events.forEach((event) => {
      const payload = {
        ...event,
        properties: {
          ...(event.properties || {})
        }
      }
      if (status === 'start') {
        trackModDownloadStart(payload)
        return
      }
      if (status === 'done') {
        trackModDownloadDone(payload)
        return
      }
      if (status === 'fail') {
        trackModDownloadFail(payload)
      }
    })
  } catch {
    // 统计埋点失败不能影响下载流程
  }
}

function trackIpcDownloadResult(channel, payload) {
  const status = DOWNLOAD_DONE_CHANNELS.has(channel) ? 'done' : 'fail'
  const events = resolveDownloadResultEvents(channel, payload)
  trackIpcDownloadEvents(status, events)
}

function trackSourceInstallTaskEvent(channel, payload) {
  if (channel === SOURCE_INSTALL_TASK_JOB_UPDATED_CHANNEL) {
    trackSourceInstallTaskJobUpdated(payload)
    return
  }
  if (channel === SOURCE_INSTALL_TASK_ARTIFACT_UPDATED_CHANNEL) {
    trackSourceInstallTaskArtifactUpdated(payload)
  }
}

function trackSourceInstallTaskJobUpdated(payload) {
  const plainPayload = safePlainObject(payload)
  const jobState = String(plainPayload.state || plainPayload.job?.state || '')
    .trim()
    .toLowerCase()
  const jobId = resolveSourceInstallTaskJobId(plainPayload)
  if (!jobId || !jobState) return

  const status = SOURCE_INSTALL_TASK_INSTALL_DONE_STATES.has(jobState)
    ? 'done'
    : SOURCE_INSTALL_TASK_INSTALL_FAIL_STATES.has(jobState)
      ? 'fail'
      : ''
  if (!status || sourceInstallTaskResultMap.get(jobId) === status) return

  const events = safeBuildIpcEvents(() =>
    resolveInstallEventsFromIpc(SOURCE_INSTALL_TASK_JOB_UPDATED_CHANNEL, plainPayload)
  )
  if (!events.length) return

  sourceInstallTaskResultMap.set(jobId, status)
  trackIpcInstallEvents(status, events, plainPayload)
}

function trackSourceInstallTaskArtifactUpdated(payload) {
  const plainPayload = safePlainObject(payload)
  const artifactState = String(plainPayload.state || '')
    .trim()
    .toLowerCase()
  const artifactKey = resolveSourceInstallArtifactKey(plainPayload)
  if (!artifactKey || !artifactState) return

  const status = SOURCE_INSTALL_TASK_DOWNLOAD_START_STATES.has(artifactState)
    ? 'start'
    : SOURCE_INSTALL_TASK_DOWNLOAD_DONE_STATES.has(artifactState)
      ? 'done'
      : SOURCE_INSTALL_TASK_DOWNLOAD_FAIL_STATES.has(artifactState)
        ? 'fail'
        : ''
  if (!status) return

  const resultState = sourceInstallArtifactResultMap.get(artifactKey) || {}
  if (status === 'start' && resultState.started) return
  if (status !== 'start' && resultState.result === status) return

  const event = resolveSourceInstallArtifactDownloadEvent(plainPayload)
  if (!event) return

  sourceInstallArtifactResultMap.set(artifactKey, {
    ...resultState,
    started: resultState.started || status === 'start',
    result: status === 'start' ? resultState.result : status
  })
  trackIpcDownloadEvents(status, [event])
}

function rememberDownloadEvents(events) {
  cleanupDownloadContextMap()
  events.forEach((event) => {
    const taskId = String(event?.properties?.taskId || '').trim()
    if (!taskId) return
    downloadContextMap.set(taskId, {
      event: toPlainJson(event),
      createdAt: Date.now()
    })
  })
  if (downloadContextMap.size <= MAX_DOWNLOAD_CONTEXT_SIZE) return
  const overflow = downloadContextMap.size - MAX_DOWNLOAD_CONTEXT_SIZE
  Array.from(downloadContextMap.keys())
    .slice(0, overflow)
    .forEach((key) => downloadContextMap.delete(key))
}

function cleanupDownloadContextMap() {
  const now = Date.now()
  downloadContextMap.forEach((value, key) => {
    if (now - Number(value?.createdAt || 0) > DOWNLOAD_CONTEXT_TTL) {
      downloadContextMap.delete(key)
    }
  })
}

function resolveDownloadResultEvents(channel, payload) {
  const plainPayload = safePlainObject(payload)
  const taskId = String(plainPayload.id || plainPayload.taskId || '').trim()
  const cached = taskId ? downloadContextMap.get(taskId)?.event : null
  if (taskId) {
    downloadContextMap.delete(taskId)
  }

  const baseEvents = cached ? [cached] : resolveDownloadEventsFromIpc(channel, plainPayload)
  return baseEvents.map((event) => ({
    ...event,
    errorMessage: DOWNLOAD_FAIL_CHANNELS.has(channel) ? resolveIpcFailureMessage(plainPayload) : '',
    properties: {
      ...(event.properties || {}),
      ...resolveDownloadResultProperties(plainPayload)
    }
  }))
}

function resolveDownloadResultProperties(payload) {
  const plain = safePlainObject(payload)
  return {
    taskId: String(plain.id || plain.taskId || ''),
    fileName: String(plain.fileName || ''),
    fileType: String(plain.fileType || ''),
    totalBytes: Number(plain.totalBytes || 0),
    receivedBytes: Number(plain.receivedBytes || 0),
    progress: Number(plain.progress || 0)
  }
}

function collectInstallItems(payload) {
  const itemKeys = [
    'items',
    'mods',
    'packages',
    'files',
    'installItems',
    'planItems',
    'tasks',
    'dependencies'
  ]
  const result = []
  itemKeys.forEach((key) => {
    const value = payload?.[key]
    if (Array.isArray(value)) {
      result.push(...value)
    }
  })
  if (payload?.mod && typeof payload.mod === 'object') {
    result.push(payload.mod)
  }
  if (payload?.package && typeof payload.package === 'object') {
    result.push(payload.package)
  }
  if (payload?.data && typeof payload.data === 'object') {
    result.push(payload.data)
  }
  if (payload?.installPayload && typeof payload.installPayload === 'object') {
    result.push(payload.installPayload)
  }
  if (payload?.payload && typeof payload.payload === 'object') {
    result.push(...collectInstallItems(payload.payload))
  }
  return result
}

function collectDownloadItems(payload) {
  const itemKeys = ['items', 'tasks', 'files', 'downloads']
  const result = []
  itemKeys.forEach((key) => {
    const value = payload?.[key]
    if (Array.isArray(value)) {
      result.push(...value)
    }
  })
  if (payload?.item && typeof payload.item === 'object') {
    result.push(payload.item)
  }
  if (payload?.payload && typeof payload.payload === 'object') {
    result.push(...collectDownloadItems(payload.payload))
  }
  return result
}

function resolvePayloadGameId(payload) {
  return String(
    payload?.gameId ||
      payload?.sourceGameId ||
      payload?.source_game_id ||
      payload?.gameSourceId ||
      payload?.game_source_id ||
      payload?.steamAppId ||
      payload?.appId ||
      payload?.appid ||
      payload?.app_id ||
      payload?.targetGameId ||
      resolveGameIdFromGameKey(payload?.gameKey || payload?.game_key) ||
      payload?.game?.id ||
      payload?.game?.steamAppId ||
      payload?.sourceMeta?.sourceGameId ||
      payload?.sourceMeta?.gameId ||
      payload?.meta?.gameId ||
      payload?.meta?.sourceGameId ||
      payload?.meta?.installPayload?.gameId ||
      payload?.meta?.installPayload?.sourceGameId ||
      payload?.metadata?.gameId ||
      payload?.metadata?.sourceGameId ||
      payload?.metadata?.installPayload?.gameId ||
      payload?.metadata?.installPayload?.sourceGameId ||
      payload?.data?.gameId ||
      payload?.data?.sourceGameId ||
      payload?.data?.steamAppId ||
      payload?.data?.appId ||
      payload?.data?.appid ||
      payload?.installPayload?.gameId ||
      payload?.installPayload?.sourceGameId ||
      payload?.item?.gameId ||
      payload?.item?.sourceGameId ||
      payload?.item?.steamAppId ||
      payload?.item?.appId ||
      ''
  )
}

function resolvePayloadTargetId(payload) {
  return String(
    payload?.targetId ||
      payload?.modId ||
      payload?.sourceModId ||
      payload?.source_mod_id ||
      payload?.packageName ||
      payload?.packageFullName ||
      payload?.fullName ||
      payload?.modReference ||
      payload?.sourceModKey ||
      payload?.source_mod_key ||
      payload?.sourceId ||
      payload?.businessId ||
      payload?.provider_id ||
      payload?.id ||
      payload?.fileId ||
      payload?.sourceFileId ||
      payload?.source_file_id ||
      payload?.item_id ||
      payload?.artifact_key ||
      payload?.meta?.modId ||
      payload?.meta?.sourceModId ||
      payload?.meta?.sourceModKey ||
      payload?.meta?.installPayload?.targetId ||
      payload?.meta?.installPayload?.modId ||
      payload?.meta?.installPayload?.sourceModId ||
      payload?.meta?.installPayload?.sourceModKey ||
      payload?.metadata?.modId ||
      payload?.metadata?.sourceModId ||
      payload?.metadata?.sourceModKey ||
      payload?.metadata?.installPayload?.targetId ||
      payload?.metadata?.installPayload?.modId ||
      payload?.metadata?.installPayload?.sourceModId ||
      payload?.metadata?.installPayload?.sourceModKey ||
      payload?.data?.targetId ||
      payload?.data?.modId ||
      payload?.data?.sourceModId ||
      payload?.data?.sourceModKey ||
      payload?.data?.modReference ||
      payload?.data?.id ||
      payload?.installPayload?.targetId ||
      payload?.installPayload?.modId ||
      payload?.installPayload?.sourceModId ||
      payload?.installPayload?.sourceModKey ||
      payload?.item?.targetId ||
      payload?.item?.modId ||
      payload?.item?.sourceModId ||
      payload?.item?.sourceModKey ||
      payload?.item?.packageFullName ||
      payload?.item?.fullName ||
      payload?.item?.modReference ||
      payload?.item?.businessId ||
      payload?.item?.id ||
      payload?.item?.fileId ||
      payload?.item?.sourceFileId ||
      ''
  )
}

function resolvePayloadTargetName(payload) {
  return String(
    payload?.targetName ||
      payload?.modName ||
      payload?.displayName ||
      payload?.task_name ||
      payload?.title ||
      payload?.sourceModName ||
      payload?.packageFullName ||
      payload?.file_name ||
      payload?.provider_id ||
      payload?.name ||
      payload?.fileName ||
      payload?.packageName ||
      payload?.fullName ||
      payload?.metadata?.displayName ||
      payload?.metadata?.installPayload?.targetName ||
      payload?.metadata?.installPayload?.modName ||
      payload?.metadata?.installPayload?.name ||
      payload?.meta?.displayName ||
      payload?.meta?.installPayload?.targetName ||
      payload?.meta?.installPayload?.modName ||
      payload?.meta?.installPayload?.name ||
      payload?.data?.targetName ||
      payload?.data?.modName ||
      payload?.data?.displayName ||
      payload?.data?.name ||
      payload?.installPayload?.targetName ||
      payload?.installPayload?.modName ||
      payload?.installPayload?.name ||
      payload?.item?.targetName ||
      payload?.item?.modName ||
      payload?.item?.displayName ||
      payload?.item?.task_name ||
      payload?.item?.name ||
      payload?.item?.packageFullName ||
      payload?.item?.fullName ||
      ''
  )
}

function resolveSourceByChannel(channel) {
  if (channel.startsWith('ficsit')) return 'ficsit'
  if (channel.startsWith('thunderstore')) return 'thunderstore'
  if (channel.startsWith('modio')) return 'modio'
  if (channel.startsWith('nexus')) return 'nexus'
  return 'vertex'
}

function resolveSourceFromGameKey(gameKey) {
  return String(gameKey || '')
    .split(':')[0]
    ?.trim()
}

function resolveGameIdFromGameKey(gameKey) {
  const text = String(gameKey || '').trim()
  if (!text.includes(':')) return ''
  return text.split(':').slice(1).join(':').trim()
}

function resolveSourceInstallTaskJobId(payload) {
  return String(
    payload?.jobId || payload?.job_id || payload?.job?.jobId || payload?.job?.job_id || ''
  ).trim()
}

function resolveSourceInstallArtifactKey(payload) {
  return String(
    payload?.artifactKey ||
      payload?.artifact_key ||
      payload?.downloadTaskId ||
      payload?.download_task_id ||
      ''
  ).trim()
}

function resolveSourceInstallArtifactDownloadEvent(payload) {
  const source = normalizeSource(
    payload.source || resolveSourceFromGameKey(payload.gameKey || payload.game_key)
  )
  const gameId = resolvePayloadGameId(payload)
  const targetId = resolvePayloadTargetId(payload)
  if (!gameId || !targetId) return null
  return {
    source,
    gameId,
    targetId,
    targetName: resolvePayloadTargetName(payload),
    errorMessage: payload.errorMessage || payload.error_message || payload.message || '',
    properties: {
      channel: SOURCE_INSTALL_TASK_ARTIFACT_UPDATED_CHANNEL,
      artifactKey: String(payload.artifactKey || payload.artifact_key || ''),
      taskId: String(payload.downloadTaskId || payload.download_task_id || ''),
      provider: String(payload.provider || ''),
      version: String(payload.version || ''),
      artifactState: String(payload.state || ''),
      fileSize: Number(payload.file_size || payload.fileSize || 0)
    }
  }
}

function isIpcResultFailed(result) {
  if (result === false) return true
  if (!result || typeof result !== 'object') return false
  if (result.success === false) return true

  const code = result.code ?? result.statusCode
  if (code != null && code !== '' && !['0', '200'].includes(String(code))) {
    return true
  }

  const status = String(result.status || result.state || '')
    .trim()
    .toLowerCase()
  if (['fail', 'failed', 'failure', 'error', 'rejected'].includes(status)) {
    return true
  }

  return !!result.error && result.success !== true
}

function resolveIpcResultProperties(result) {
  const plain = safePlainObject(result)
  const status =
    plain.status ||
    plain.state ||
    (plain.success === true ? 'success' : plain.success === false ? 'fail' : '')
  return {
    resultCode: plain.code ?? plain.statusCode ?? '',
    resultStatus: status
  }
}

function resolveIpcFailureMessage(result) {
  if (result instanceof Error) return result.message
  const plain = safePlainObject(result)
  return (
    plain.errorMessage ||
    plain.error ||
    plain.message ||
    plain.rawMessage ||
    resolveErrorMessage(result)
  )
}

function startFlushTimer() {
  if (timer) return
  timer = window.setInterval(() => {
    flushStatisticsQueue()
  }, FLUSH_INTERVAL)
}

function resolveReportUrl() {
  const baseUrl = getAppData().requestUrl || VITE_REQUEST_API || ''
  return `${resolveApiRoot(baseUrl)}${API_PATH}`
}

function resolveApiRoot(baseUrl) {
  const fallback = String(VITE_REQUEST_API || '').replace(/\/client\/?$/, '')
  try {
    const url = new URL(baseUrl || fallback)
    url.pathname = url.pathname.replace(/\/client\/?$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback.replace(/\/$/, '')
  }
}

function getAppData() {
  try {
    const appStore = useAppStore()
    const appData = appStore.AppData || {}
    return {
      version: appData.version || VITE_APP_VERSION || '1.0.0',
      requestUrl: appData.requestUrl || VITE_REQUEST_API || ''
    }
  } catch {
    return {
      version: VITE_APP_VERSION || '1.0.0',
      requestUrl: VITE_REQUEST_API || ''
    }
  }
}

function getUserData() {
  try {
    const userStore = JSON.parse(localStorage.getItem('userStore') || '{}')
    return {
      userId: userStore?.userInfo?.id ? String(userStore.userInfo.id) : ''
    }
  } catch {
    return {
      userId: ''
    }
  }
}

function getOrCreateClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY)
  if (existing) return existing
  const value = uuidv4()
  localStorage.setItem(CLIENT_ID_KEY, value)
  return value
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, MAX_QUEUE_SIZE) : []
  } catch {
    return []
  }
}

function persistQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE_SIZE)))
  } catch {
    queue = queue.slice(-BATCH_SIZE)
  }
}

function normalizeSource(source) {
  const normalized = String(source || 'vertex')
    .trim()
    .toLowerCase()
  if (!normalized || normalized === 'server') return 'vertex'
  if (normalized === 'mod.io') return 'modio'
  return ['vertex', 'nexus', 'modio', 'ficsit', 'thunderstore', 'unknown'].includes(normalized)
    ? normalized
    : 'unknown'
}

function normalizeStatus(status, eventType) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
  if (['start', 'success', 'fail'].includes(normalized)) return normalized
  if (eventType.endsWith('_start')) return 'start'
  if (eventType.endsWith('_fail') || eventType === 'client_error') return 'fail'
  return 'success'
}

function resolveErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return error?.message || JSON.stringify(toPlainJson(error)) || 'unknown error'
}

function resolveErrorStack(error) {
  if (error instanceof Error) return error.stack || ''
  return error?.stack || ''
}

function sanitizeStack(stack) {
  return sanitizeText(
    String(stack || '')
      .split('\n')
      .slice(0, 12)
      .join('\n'),
    8192
  )
}

function sanitizeProperties(properties) {
  const plain = safePlainObject(properties)
  const json = JSON.stringify(plain)
  if (json.length > 3500) {
    return {
      truncated: true
    }
  }
  return plain
}

function safePlainObject(value) {
  const plain = toPlainJson(value || {})
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return {}
  return removeSensitiveFields(plain)
}

function removeSensitiveFields(value, depth = 0) {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => removeSensitiveFields(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((result, [key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[redacted]'
      } else {
        result[key] = removeSensitiveFields(item, depth + 1)
      }
      return result
    }, {})
  }
  if (typeof value === 'string') {
    return sanitizeText(value, 512)
  }
  return value
}

function toPlainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return {}
  }
}

function sanitizeText(value, maxLength) {
  const text = trimText(value, maxLength)
  return text
    .replace(/(authorization|cookie|token)\s*[:=]\s*[^;\s]+/gi, '$1=[redacted]')
    .replace(/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\***')
    .replace(/\/Users\/[^/\s]+/g, '/Users/***')
}

function trimText(value, maxLength) {
  const text = value == null ? '' : String(value).trim()
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function createErrorHash(errorType, message, stack) {
  const keyFrame =
    String(stack || '')
      .split('\n')
      .find((line) => line.trim()) || ''
  const text = `${errorType}|${message}|${keyFrame}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return `client_${Math.abs(hash).toString(16)}`
}
