import { pathToFileURL } from 'node:url'
import { trustLocalWindow } from './security/windows.js'
import { openWebExternal } from './security/windows.js'
import { restrictWindowNavigation } from './security/windowPolicy.js'
import { app, BrowserWindow, screen } from 'electron'
import { ipcMain } from './security/ipc.js'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import store from './storage/store/index.js'
import { debounce } from './ipc/tool.js'
import { normalizeAiAgentConfig } from '../shared/ai/config/ai-agent-config.js'
import { acceptAssistantSnapshot } from '../shared/ai/conversation/ai-assistant-snapshot.js'
import { finalizeAiAgentStreamingAssistantMessage } from '../shared/ai/conversation/ai-agent-streaming-message.js'
import { conversationExecutions } from './services/ai/agent/conversationExecution.js'
import {
  isNxmProtocolUrl,
  routeNexusAuthorizationUrl
} from './services/nexusAuthorizationRouter.js'

const ASSISTANT_DEFAULT_WIDTH = 460
const ASSISTANT_MIN_WIDTH = 380
const ASSISTANT_MAX_WIDTH = 500
const ASSISTANT_GAP = 8
const ASSISTANT_MIN_HEIGHT = 560
const SIDECAR_WINDOW_QUERY = 'ai-assistant-sidecar'
const CONTEXT_REQUEST_TIMEOUT_MS = 1200

let assistantWindow = null
let mainWindowGetter = () => null
let boundMainWindow = null
let ipcRegistered = false
let assistantShouldBeOpen = false
let latestContextPayload = null
let latestUiState = createDefaultUiState()
let latestStoreSnapshot = null
let pendingContextTimer = 0
let applyingAssistantBounds = false
let pendingContextRequests = new Map()
// 由主进程计算的停靠布局；渲染进程上报的界面状态不能覆盖它。
let dockLayout = { dockMode: 'closed', dockInset: 0 }

const syncAssistantWindowBoundsDebounced = debounce(() => {
  syncAssistantWindowBounds()
}, 80)

function toPlainJson(data, fallback = {}) {
  try {
    const text = JSON.stringify(data ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch (error) {
    console.error('[AI 助手窗口] IPC 数据序列化失败', error)
    return fallback
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.min(Math.max(number, min), max)
}

function createDefaultUiState() {
  return {
    isProcessing: false,
    statusLabel: '已连接',
    statusTone: 'ready',
    pendingResultCount: 0,
    agentTaskSummary: {
      total: 0,
      active: 0,
      failed: 0
    },
    currentSessionTitle: '新对话'
  }
}

function getMainWindow() {
  const mainWindow = mainWindowGetter?.()
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function getAssistantWindowConfig() {
  const settings = store.get('systemConfig.settings') || {}
  return normalizeAiAgentConfig(settings.aiAgent).assistantWindow
}

function getSavedAssistantWidth() {
  return clampNumber(
    getAssistantWindowConfig().width,
    ASSISTANT_MIN_WIDTH,
    ASSISTANT_MAX_WIDTH,
    ASSISTANT_DEFAULT_WIDTH
  )
}

function setSavedAssistantWidth(width) {
  const nextWidth = clampNumber(
    width,
    ASSISTANT_MIN_WIDTH,
    ASSISTANT_MAX_WIDTH,
    getSavedAssistantWidth()
  )
  store.set('systemConfig.settings.aiAgent.assistantWindow.width', nextWidth)
}

function getWorkAreaForMainWindow(mainWindow) {
  return screen.getDisplayMatching(mainWindow.getBounds()).workArea
}

function clampHeight(height, workArea) {
  const maxHeight = Math.max(1, workArea.height)
  const preferredHeight = Math.min(Math.max(Number(height) || maxHeight, 1), maxHeight)
  return Math.min(Math.max(preferredHeight, Math.min(ASSISTANT_MIN_HEIGHT, maxHeight)), maxHeight)
}

function clampY(y, height, workArea) {
  const maxY = workArea.y + workArea.height - height
  return Math.min(Math.max(y, workArea.y), Math.max(workArea.y, maxY))
}

function buildAttachedBounds(mainBounds, assistantWidth, workArea) {
  const height = clampHeight(mainBounds.height, workArea)
  const y = clampY(mainBounds.y, height, workArea)
  return {
    x: mainBounds.x + mainBounds.width + ASSISTANT_GAP,
    y,
    width: assistantWidth,
    height,
    dockMode: 'attached'
  }
}

function isMainWindowFilling(mainWindow) {
  return mainWindow.isMaximized() || mainWindow.isFullScreen()
}

// 最大化、全屏或右侧空间不足时，助手悬浮在内容区内，
// 不改变主窗口尺寸、位置或主页面的布局宽度。
function buildInsideBounds(mainWindow) {
  const content = mainWindow.getContentBounds()
  const preferredWidth = getSavedAssistantWidth()
  const width = Math.max(1, Math.min(preferredWidth, content.width))
  return {
    x: content.x + content.width - width,
    y: content.y,
    width,
    height: content.height,
    dockMode: 'overlay',
    dockInset: 0
  }
}

function computeAssistantBounds() {
  const mainWindow = getMainWindow()
  if (!mainWindow) return null
  if (isMainWindowFilling(mainWindow)) return buildInsideBounds(mainWindow)

  const assistantWidth = getSavedAssistantWidth()
  const workArea = getWorkAreaForMainWindow(mainWindow)
  const mainBounds = mainWindow.getBounds()
  const rightEdge = workArea.x + workArea.width
  const attached = buildAttachedBounds(mainBounds, assistantWidth, workArea)

  if (attached.x + assistantWidth <= rightEdge) {
    return { ...attached, dockInset: 0 }
  }

  // 右侧放不下时直接悬浮，不为并排显示自动移动或缩窄主窗口。
  return buildInsideBounds(mainWindow)
}

function getAssistantWindowState() {
  const visible =
    assistantWindow && !assistantWindow.isDestroyed() ? assistantWindow.isVisible() : false
  const focused =
    assistantWindow && !assistantWindow.isDestroyed() ? assistantWindow.isFocused() : false
  const mainWindow = getMainWindow()
  // 主窗口最小化时助手随之隐藏，保留停靠模式以便还原。
  const docked = assistantShouldBeOpen && (visible || Boolean(mainWindow?.isMinimized()))
  return {
    open: assistantShouldBeOpen,
    visible,
    focused,
    ...latestUiState,
    dockMode: docked ? dockLayout.dockMode : 'closed',
    // 保留状态协议字段；悬浮和外侧停靠均不占用主页面宽度。
    dockInset: docked ? dockLayout.dockInset : 0,
    context: latestContextPayload?.context || null
  }
}

function normalizeAssistantStoreSnapshot(payload = {}) {
  const source = payload?.snapshot || payload?.storeSnapshot || payload
  const safeSnapshot = toPlainJson(source, null)
  return safeSnapshot && typeof safeSnapshot === 'object' ? safeSnapshot : null
}

function hasAssistantStoreSnapshotContent(snapshot = {}) {
  return Boolean(
    (Array.isArray(snapshot?.sessionHistory) && snapshot.sessionHistory.length > 0) ||
      (Array.isArray(snapshot?.messages) && snapshot.messages.length > 0) ||
      (Array.isArray(snapshot?.candidates) && snapshot.candidates.length > 0) ||
      snapshot?.installPlan
  )
}

function setAssistantStoreSnapshot(payload = {}) {
  const snapshot = normalizeAssistantStoreSnapshot(payload)
  if (!payload?.allowEmpty && !hasAssistantStoreSnapshotContent(snapshot)) {
    return { success: true, snapshot: latestStoreSnapshot }
  }
  const result = acceptAssistantSnapshot(latestStoreSnapshot, { ...payload, snapshot })
  if (result.success) latestStoreSnapshot = result.snapshot
  return result
}

export function commitAssistantChatResult(request = {}, result = {}) {
  if (!result.accepted || !request.sessionId || latestStoreSnapshot?.deletedSessionIds?.includes(request.sessionId)) return
  const snapshot = toPlainJson(latestStoreSnapshot || {}, {})
  const history = snapshot.sessionHistory || []
  let session = history.find((item) => item.id === request.sessionId)
  if (snapshot.currentSessionId === request.sessionId) session = {
    ...session, id: request.sessionId, title: snapshot.currentSessionTitle,
    context: snapshot.currentContextSnapshot, messages: snapshot.messages || []
  }
  session ||= { id: request.sessionId, title: '新对话', context: request.context, messages: [] }
  const messages = session.messages || []
  if (!messages.some((item) => item.id === request.userMessageId)) messages.push({
    id: request.userMessageId || `user-${result.executionId}`, role: 'user', content: request.message,
    type: 'text', createdAt: request.createdAt || Date.now()
  })
  const finalized = finalizeAiAgentStreamingAssistantMessage({ messages }, result.assistantMessage, {
    id: `reply-${result.executionId}`, executionId: result.executionId, sessionId: request.sessionId,
    type: result.outcome === 'failed' ? 'error' : ['partial', 'cancelled'].includes(result.outcome) ? 'warning' : 'text',
    outcome: result.outcome, error: result.error, stopReason: result.stopReason, canRetry: result.canRetry,
    toolCalls: result.toolCalls || [], confirmations: result.confirmations || [], createdAt: Date.now()
  })
  session = { ...session, messages: finalized.messages, candidates: result.candidates || [], installPlan: result.installPlan || null, updatedAt: Date.now() }
  snapshot.sessionHistory = [session, ...history.filter((item) => item.id !== session.id)].slice(0, 20)
  if (snapshot.currentSessionId === session.id || !snapshot.currentSessionId) {
    snapshot.currentSessionId = session.id
    snapshot.currentSessionTitle = session.title
    snapshot.currentContextSnapshot = session.context
    snapshot.messages = session.messages
    snapshot.candidates = session.candidates
    snapshot.installPlan = session.installPlan
  }
  snapshot.revision = Number(snapshot.revision || 0) + 1
  latestStoreSnapshot = snapshot
  broadcastAssistantStoreSnapshot()
}

function createContextRequestId() {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function resolvePendingContextRequest(requestId = '', response = {}) {
  const safeRequestId = String(requestId || '').trim()
  if (!safeRequestId || !pendingContextRequests.has(safeRequestId)) {
    return false
  }

  const pendingRequest = pendingContextRequests.get(safeRequestId)
  pendingContextRequests.delete(safeRequestId)
  clearTimeout(pendingRequest.timer)
  pendingRequest.resolve(response)
  return true
}

function requestContextFromMainWindow(payload = {}) {
  const mainWindow = getMainWindow()
  const requestId = String(payload?.requestId || createContextRequestId()).trim()
  if (!mainWindow) {
    return Promise.resolve({
      success: false,
      reason: 'main_window_unavailable',
      context: latestContextPayload?.context || null,
      state: getAssistantWindowState()
    })
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingContextRequests.delete(requestId)
      resolve({
        success: false,
        reason: 'context_request_timeout',
        context: latestContextPayload?.context || null,
        state: getAssistantWindowState()
      })
    }, CONTEXT_REQUEST_TIMEOUT_MS)

    pendingContextRequests.set(requestId, {
      timer,
      resolve
    })
    mainWindow.webContents.send('ai-assistant-window:request-context', {
      requestId,
      reason: String(payload?.reason || 'assistant-message').trim() || 'assistant-message'
    })
  })
}

function getAssistantStoreSnapshotState() {
  return {
    success: true,
    snapshot: latestStoreSnapshot ? toPlainJson(latestStoreSnapshot, null) : null
  }
}

function broadcastAssistantStoreSnapshot(sourceWebContents = null) {
  if (!latestStoreSnapshot) return
  const payload = {
    snapshot: toPlainJson(latestStoreSnapshot, null)
  }
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed() || window.webContents === sourceWebContents) return
    window.webContents.send('ai-assistant-window:store-snapshot-updated', payload)
  })
}

function requestNexusManualDownloadInMainWindow(payload = {}) {
  const mainWindow = getMainWindow()
  if (!mainWindow) {
    return {
      success: false,
      message: '主窗口未就绪'
    }
  }

  const safePayload = toPlainJson(payload, {})
  if (safePayload?.storeSnapshot || safePayload?.snapshot) {
    setAssistantStoreSnapshot({
      snapshot: safePayload.storeSnapshot || safePayload.snapshot,
      allowEmpty: true
    })
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('ai-assistant-window:open-nexus-manual-download', {
    ...safePayload,
    storeSnapshot: latestStoreSnapshot ? toPlainJson(latestStoreSnapshot, null) : null
  })
  return {
    success: true
  }
}

function broadcastAssistantWindowState() {
  const state = toPlainJson(getAssistantWindowState(), {})
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed()) return
    window.webContents.send('ai-assistant-window:state-changed', state)
  })
}

function setAssistantUiState(patch = {}) {
  latestUiState = {
    ...latestUiState,
    ...toPlainJson(patch, {}),
    agentTaskSummary: {
      ...latestUiState.agentTaskSummary,
      ...(patch?.agentTaskSummary && typeof patch.agentTaskSummary === 'object'
        ? patch.agentTaskSummary
        : {})
    }
  }
  broadcastAssistantWindowState()
}

function sendContextToAssistant(payload = latestContextPayload) {
  if (!payload || !assistantWindow || assistantWindow.isDestroyed()) return
  const safePayload = toPlainJson(payload, {})
  assistantWindow.webContents.send('ai-assistant-window:context', safePayload)

  if (pendingContextTimer) {
    clearTimeout(pendingContextTimer)
  }
  pendingContextTimer = setTimeout(() => {
    pendingContextTimer = 0
    if (!assistantWindow || assistantWindow.isDestroyed()) return
    assistantWindow.webContents.send('ai-assistant-window:context', safePayload)
  }, 250)
}

function resolveRendererBaseUrl() {
  const mainWindow = getMainWindow()
  const currentUrl = String(mainWindow?.webContents?.getURL?.() || '').trim()
  if (/^https?:\/\//i.test(currentUrl)) {
    try {
      return new URL(currentUrl).origin
    } catch {
      // 忽略异常，继续使用默认开发地址。
    }
  }

  return String(process.env['ELECTRON_RENDERER_URL'] || '').trim()
}

async function loadAssistantWindowContent(window) {
  const rendererUrl = resolveRendererBaseUrl()
  if (is.dev && rendererUrl) {
    const url = new URL(rendererUrl)
    url.searchParams.set('window', SIDECAR_WINDOW_QUERY)
    trustLocalWindow(window, url.toString())
    await window.loadURL(url.toString())
    return
  }

  trustLocalWindow(window, pathToFileURL(join(__dirname, '../renderer/index.html')).href + '?window=' + SIDECAR_WINDOW_QUERY)
  await window.loadFile(join(__dirname, '../renderer/index.html'), {
    query: {
      window: SIDECAR_WINDOW_QUERY
    }
  })
}

function createAssistantWindow() {
  const mainWindow = getMainWindow()
  if (!mainWindow) return null

  const mainBounds = mainWindow.getBounds()
  const workArea = getWorkAreaForMainWindow(mainWindow)
  const assistant = new BrowserWindow({
    // 作为主窗口的从属窗口：始终位于主窗口之上、随主窗口最小化，
    // 主窗口最大化或全屏时停靠在其内部也不会被盖住。
    parent: mainWindow,
    width: getSavedAssistantWidth(),
    minWidth: ASSISTANT_MIN_WIDTH,
    maxWidth: ASSISTANT_MAX_WIDTH,
    height: clampHeight(mainBounds.height, workArea),
    minHeight: Math.min(ASSISTANT_MIN_HEIGHT, workArea.height),
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    // 助手获得焦点时按 F11 不应把侧栏单独全屏。
    fullscreenable: false,
    backgroundColor: '#ffffff',
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: 'AI 助手',
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true
    }
  })

  assistant.webContents.setWindowOpenHandler(({ url }) => {
    if (isNxmProtocolUrl(url)) {
      routeNexusAuthorizationUrl(url)
      return { action: 'deny' }
    }

    openWebExternal(url).catch(() => console.warn('[安全] 外链被拒绝或打开失败'))
    return { action: 'deny' }
  })

  restrictWindowNavigation(assistant.webContents)

  assistant.once('ready-to-show', () => {
    syncAssistantWindowBounds()
    if (assistantShouldBeOpen && !mainWindow.isMinimized() && mainWindow.isVisible()) {
      assistant.show()
    }
    broadcastAssistantWindowState()
  })

  assistant.on('focus', () => {
    broadcastAssistantWindowState()
  })
  assistant.on('blur', () => {
    broadcastAssistantWindowState()
  })
  assistant.on(
    'resize',
    debounce(() => {
      if (!assistant || assistant.isDestroyed() || applyingAssistantBounds) return
      setSavedAssistantWidth(assistant.getBounds().width)
      // 内部悬浮时，拖动左边缘调整宽度后重新贴齐内容区右侧。
      if (dockLayout.dockMode === 'overlay') {
        syncAssistantWindowBounds()
        return
      }
      broadcastAssistantWindowState()
    }, 120)
  )
  assistant.on('closed', () => {
    assistantWindow = null
    assistantShouldBeOpen = false
    dockLayout = { dockMode: 'closed', dockInset: 0 }
    latestUiState = {
      ...createDefaultUiState(),
      dockMode: 'closed'
    }
    broadcastAssistantWindowState()
  })

  assistantWindow = assistant
  loadAssistantWindowContent(assistant).catch((error) => {
    console.error('[AI 助手窗口] 页面加载失败', error)
  })
  return assistant
}

export async function openAssistantWindow() {
  const mainWindow = getMainWindow()
  if (!mainWindow) {
    return {
      success: false,
      message: '主窗口未就绪'
    }
  }

  assistantShouldBeOpen = true
  const assistant =
    assistantWindow && !assistantWindow.isDestroyed() ? assistantWindow : createAssistantWindow()
  if (!assistant) {
    return {
      success: false,
      message: 'AI 助手窗口创建失败'
    }
  }

  syncAssistantWindowBounds()
  if (!mainWindow.isMinimized() && mainWindow.isVisible()) {
    assistant.show()
    assistant.focus()
  }
  broadcastAssistantWindowState()
  return {
    success: true,
    state: getAssistantWindowState()
  }
}

export function closeAssistantWindow(options = {}) {
  assistantShouldBeOpen = false
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    // Closing the panel during a request preserves its renderer and confirmation
    // ownership. Application shutdown still destroys the window normally.
    if (!options.force && !app.isQuiting && (conversationExecutions.state() || latestUiState.isProcessing)) assistantWindow.hide()
    else assistantWindow.close()
  } else {
    latestUiState = {
      ...createDefaultUiState(),
      dockMode: 'closed'
    }
    broadcastAssistantWindowState()
  }
  return getAssistantWindowState()
}

export function hideAssistantWindow() {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    assistantWindow.hide()
  }
  broadcastAssistantWindowState()
  return getAssistantWindowState()
}

export function restoreAssistantWindowIfOpen() {
  const mainWindow = getMainWindow()
  if (!assistantShouldBeOpen || !assistantWindow || assistantWindow.isDestroyed() || !mainWindow) {
    broadcastAssistantWindowState()
    return getAssistantWindowState()
  }

  syncAssistantWindowBounds()
  if (!mainWindow.isMinimized() && mainWindow.isVisible()) {
    assistantWindow.show()
  }
  broadcastAssistantWindowState()
  return getAssistantWindowState()
}

export function focusAssistantWindow() {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    assistantWindow.focus()
  }
  broadcastAssistantWindowState()
  return getAssistantWindowState()
}

export function syncAssistantWindowBounds() {
  if (!assistantWindow || assistantWindow.isDestroyed()) {
    broadcastAssistantWindowState()
    return null
  }

  const bounds = computeAssistantBounds()
  if (!bounds) return null
  const { dockMode, dockInset = 0, ...windowBounds } = bounds
  applyingAssistantBounds = true
  try {
    assistantWindow.setBounds(windowBounds)
  } finally {
    setTimeout(() => {
      applyingAssistantBounds = false
    }, 0)
  }
  dockLayout = { dockMode, dockInset: Math.max(0, Math.round(dockInset)) }
  broadcastAssistantWindowState()
  return bounds
}

// 最大化、还原、进入或退出全屏后，窗口尺寸要等系统动画结束才稳定，延后一帧再同步。
function handleMainWindowLayoutChange() {
  if (!assistantShouldBeOpen) return
  setTimeout(() => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isMinimized()) return
    restoreAssistantWindowIfOpen()
  }, 0)
  syncAssistantWindowBoundsDebounced()
}

export function bindAssistantWindowToMainWindow(nextMainWindowGetter = mainWindowGetter) {
  mainWindowGetter =
    typeof nextMainWindowGetter === 'function' ? nextMainWindowGetter : mainWindowGetter
  const mainWindow = getMainWindow()
  if (!mainWindow || boundMainWindow === mainWindow) return

  boundMainWindow = mainWindow
  mainWindow.on('move', syncAssistantWindowBoundsDebounced)
  mainWindow.on('resize', syncAssistantWindowBoundsDebounced)
  mainWindow.on('restore', restoreAssistantWindowIfOpen)
  mainWindow.on('show', restoreAssistantWindowIfOpen)
  mainWindow.on('minimize', hideAssistantWindow)
  mainWindow.on('hide', hideAssistantWindow)
  mainWindow.on('maximize', handleMainWindowLayoutChange)
  mainWindow.on('unmaximize', handleMainWindowLayoutChange)
  mainWindow.on('enter-full-screen', handleMainWindowLayoutChange)
  mainWindow.on('leave-full-screen', handleMainWindowLayoutChange)
  mainWindow.on('close', () => {
    const closeWindowType = store.get('systemConfig.settings.closeWindowType')
    if (closeWindowType === 'toTray' && !app.isQuiting) {
      hideAssistantWindow()
      return
    }
    closeAssistantWindow({ force: true })
  })
  mainWindow.on('closed', () => {
    closeAssistantWindow({ force: true })
    boundMainWindow = null
  })
}

export function registerAssistantWindowIpc(nextMainWindowGetter = mainWindowGetter) {
  mainWindowGetter =
    typeof nextMainWindowGetter === 'function' ? nextMainWindowGetter : mainWindowGetter
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('ai-assistant-window:open-settings', (_event, payload = {}) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('ai-assistant:configure', { section: payload.section === 'sources' ? 'sources' : 'aiTranslation' })
    return { success: true }
  })

  ipcMain.handle('ai-assistant-window:open', () => openAssistantWindow())
  ipcMain.handle('ai-assistant-window:close', () => closeAssistantWindow())
  ipcMain.handle('ai-assistant-window:focus', () => focusAssistantWindow())
  ipcMain.handle('ai-assistant-window:state', () => getAssistantWindowState())
  ipcMain.handle('ai-assistant-window:toggle', async () => {
    if (assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isVisible()) {
      return hideAssistantWindow()
    }
    return await openAssistantWindow()
  })
  ipcMain.handle('ai-assistant-window:get-store-snapshot', () => getAssistantStoreSnapshotState())
  ipcMain.handle('ai-assistant-window:sync-store-snapshot', (event, payload = {}) => {
    const result = setAssistantStoreSnapshot(payload)
    if (result.success) broadcastAssistantStoreSnapshot(event.sender)
    return result
  })
  ipcMain.handle('ai-assistant-window:request-nexus-manual-download', (_event, payload = {}) =>
    requestNexusManualDownloadInMainWindow(payload)
  )
  ipcMain.handle('ai-assistant-window:sync-context', async (_event, payload = {}) => {
    const safePayload = toPlainJson(payload, {})
    if (safePayload?.context) {
      latestContextPayload = {
        context: safePayload.context,
        source: safePayload.source || 'main-window',
        updatedAt: Date.now()
      }
      sendContextToAssistant()
      const response = {
        success: true,
        context: latestContextPayload.context,
        state: getAssistantWindowState()
      }
      resolvePendingContextRequest(safePayload.requestId, response)
      return response
    }

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      return await requestContextFromMainWindow(safePayload)
    }

    return {
      success: false,
      reason: 'main_window_unavailable',
      context: latestContextPayload?.context || null,
      state: getAssistantWindowState()
    }
  })
  ipcMain.on('ai-assistant-window:update-state', (_event, payload = {}) => {
    setAssistantUiState(payload)
  })
  ipcMain.on('ai-assistant-window:update-store-snapshot', (event, payload = {}) => {
    setAssistantStoreSnapshot(payload)
    broadcastAssistantStoreSnapshot(event.sender)
  })
}
