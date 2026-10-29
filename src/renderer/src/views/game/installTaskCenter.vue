<script setup>
const { t: uiText } = useI18n()

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import DownloadTasksPanel from './component/task-center/DownloadTasksPanel.vue'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { standaloneDownloads } from '../../../../shared/tasks/task-center-counts.js'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal, VxModal } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { useInstallStore } from '@renderer/store/installStore.js'
import { useAiAssistantStore } from '@renderer/store/aiAssistantStore.js'
import {
  buildInstallFailureRecoveryPrompt,
  canDiagnoseSourceInstallTask
} from '../../../../shared/installation/install-failure-recovery.js'
import InstallTaskEntry from '@renderer/views/game/component/modDetails/install-task-entry.vue'
import TaskCenterDetail from './component/task-center/TaskCenterDetail.vue'
import TaskCenterTable from './component/task-center/TaskCenterTable.vue'
import TaskCenterToolbar from './component/task-center/TaskCenterToolbar.vue'
import { openNexusAuthorizationPanel } from '@renderer/store/nexusAuthorizationPanel.js'
import {
  TASK_CENTER_VIEWS,
  adaptSourceInstallTask,
  buildTaskCenterViewModels,
  getTaskCenterViewCount,
  mergeInstallTaskSummary,
  normalizeTaskCenterView,
  resolveTaskCenterStateGroup
} from './component/task-center/task-center-view-model.js'
import { resolveSourcePlatformLabel } from '../../../../shared/sources/source-platform-registry.js'

const DEFAULT_SUMMARY = Object.freeze({
  total: 0,
  activeCount: 0,
  attentionCount: 0,
  failedCount: 0,
  historyCount: 0,
  badgeCount: 0,
  byState: {}
})
const DOWNLOAD_VIEWS = Object.freeze(['downloading', 'downloaded'])
const SIDEBAR_GAME_LIMIT = 4
const GAME_INDEX_PAGE_SIZE = 100
const SORT_VALUES = new Set(['priority', 'updated', 'name'])
const BULK_ACTIONS = Object.freeze(['pause', 'resume', 'retry', 'cancel', 'delete'])

const route = useRoute()
const router = useRouter()
const pagePath = route.path
const { t } = useI18n()
const installStore = useInstallStore()
const aiAssistantStore = useAiAssistantStore()
const { setMenuName: setPageMenuName } = useMenuName()
const aiPageContextProvider = useAiPageContextProvider(route)
const sourceLabel = resolveSourcePlatformLabel('vertex', 'Vertex')

const loading = ref(false)
const refreshing = ref(false)
const hasLoaded = ref(false)
const loadError = ref('')
const operationFeedback = ref('')
const copyingDiagnostics = ref(false)
const sourceSummary = ref({ ...DEFAULT_SUMMARY })
const sourceRecords = ref([])
const sourceTotal = ref(0)
const gameIndexRecords = ref([])
const downloadStore = useDownloadStore()
const completedDownloadCount = ref(0)

const taskTab = ref(route.query.tab === 'downloads' ? 'downloads' : 'install')
const downloadView = ref(DOWNLOAD_VIEWS.includes(route.query.dl) ? route.query.dl : 'downloading')
const activeView = ref(normalizeTaskCenterView(route.query.view))
const gameFilter = ref(String(route.query.game || ''))
const sourceFilter = ref('')
const searchText = ref('')
const sortMode = ref('priority')
const gamesExpanded = ref(false)
const page = ref(1)
const pageSize = 100
const selectedTask = ref(null)
const selectedDetail = ref({})
const detailOpen = ref(false)
const detailLoading = ref(false)
const selectedJobIds = ref(new Set())
const operatingTaskIds = ref(new Set())
const confirmOpen = ref(false)
const confirmIntent = ref(null)

let listRequestSerial = 0
let detailRequestSerial = 0
let summaryRefreshTimer = null
let autoRefreshTimer = null

const legacyTasks = computed(() => installStore.waitingInstallList || [])
const summary = computed(() => mergeInstallTaskSummary(sourceSummary.value, legacyTasks.value))
const downloadingCount = computed(() => standaloneDownloads(downloadStore.downloadList).length)

const statusOptions = computed(() =>
  TASK_CENTER_VIEWS.map((option) => ({
    ...option,
    label: t(`taskCenter.views.${option.value}`),
    count: getTaskCenterViewCount(summary.value, option.value)
  }))
)
const downloadOptions = computed(() => [
  {
    value: 'downloading',
    icon: 'download',
    label: t('taskCenter.views.downloading'),
    count: downloadingCount.value
  },
  {
    value: 'downloaded',
    icon: 'folder',
    label: t('taskCenter.views.downloaded'),
    count: completedDownloadCount.value
  }
])

// 「按游戏」与来源下拉：取最近 100 个任务汇总，不随 2.5 秒轮询刷新。
const gameIndex = computed(() => {
  const games = new Map()
  for (const record of gameIndexRecords.value) {
    const task = adaptSourceInstallTask(record)
    if (!task.gameKey) continue
    const entry = games.get(task.gameKey) || { key: task.gameKey, name: task.gameName, count: 0 }
    entry.count += 1
    if (!entry.name && task.gameName) entry.name = task.gameName
    games.set(task.gameKey, entry)
  }
  return [...games.values()].sort((left, right) => right.count - left.count)
})
const visibleGames = computed(() =>
  gamesExpanded.value ? gameIndex.value : gameIndex.value.slice(0, SIDEBAR_GAME_LIMIT)
)
const hiddenGameCount = computed(() => Math.max(0, gameIndex.value.length - SIDEBAR_GAME_LIMIT))
const sourceOptions = computed(() => {
  const sources = new Map()
  for (const record of gameIndexRecords.value) {
    const task = adaptSourceInstallTask(record)
    if (task.source?.key) sources.set(task.source.key, task.source.label || task.source.key)
  }
  if (sourceFilter.value && !sources.has(sourceFilter.value)) {
    sources.set(
      sourceFilter.value,
      resolveSourcePlatformLabel(sourceFilter.value, sourceFilter.value)
    )
  }
  return [...sources.entries()].map(([value, label]) => ({ value, label }))
})

const visibleLegacyTasks = computed(() => {
  if (gameFilter.value) return []
  if (!sourceFilter.value) return legacyTasks.value
  return legacyTasks.value.filter(
    (task) => String(task?.sourceType || '').toLowerCase() === sourceFilter.value.toLowerCase()
  )
})
const baseTasks = computed(() =>
  buildTaskCenterViewModels(sourceRecords.value, visibleLegacyTasks.value, activeView.value)
)
const tasks = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  const filtered = keyword
    ? baseTasks.value.filter((task) =>
        [task.title, task.gameName, task.source?.label, task.source?.key]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword))
      )
    : baseTasks.value
  if (sortMode.value === 'updated') {
    return [...filtered].sort(
      (left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0)
    )
  }
  if (sortMode.value === 'name') {
    return [...filtered].sort((left, right) =>
      String(left.title).localeCompare(String(right.title))
    )
  }
  return filtered
})
const hasListFilters = computed(() => Boolean(searchText.value.trim() || sourceFilter.value))
const listCount = computed(() => {
  if (searchText.value.trim()) return tasks.value.length
  if (gameFilter.value || sourceFilter.value) {
    return sourceTotal.value + baseTasks.value.filter((task) => task.kind === 'legacy').length
  }
  return getTaskCenterViewCount(summary.value, activeView.value)
})
const listTitle = computed(() => {
  if (gameFilter.value) {
    return (
      gameIndex.value.find((game) => game.key === gameFilter.value)?.name ||
      t('taskCenter.unknownGame')
    )
  }
  return t(`taskCenter.viewTitles.${activeView.value}`)
})
const emptyTitle = computed(() => t(`taskCenter.empty.${activeView.value}`))
const emptyText = computed(() =>
  activeView.value === 'all' && !gameFilter.value
    ? t('taskCenter.empty.allHint')
    : t('taskCenter.table.newTasks')
)
const canClearHistory = computed(
  () =>
    ['completed', 'cancelled'].includes(activeView.value) &&
    !gameFilter.value &&
    Number(summary.value.historyCount || 0) > 0 &&
    selectedJobIds.value.size === 0
)

const selectedIds = computed(() => [...selectedJobIds.value])
const operatingIds = computed(() => [...operatingTaskIds.value])
const selectedCount = computed(() => selectedJobIds.value.size)
const selectedTasks = computed(() =>
  tasks.value.filter((task) => task.kind === 'source' && selectedJobIds.value.has(String(task.id)))
)
const bulkActions = computed(() =>
  BULK_ACTIONS.map((action) => ({
    action,
    count: selectedTasks.value.filter((task) => task.actions?.includes(action)).length
  }))
)
const totalPages = computed(() => Math.max(1, Math.ceil(sourceTotal.value / pageSize)))
const selectedOperating = computed(() =>
  selectedTask.value ? operatingTaskIds.value.has(String(selectedTask.value.id)) : false
)
const selectedTaskId = computed(() => (detailOpen.value ? selectedTask.value?.id || '' : ''))
const drawerLabel = computed(() =>
  t('taskCenter.detail.label', { title: selectedTask.value?.title || '' })
)
const toolbarOperationLoading = computed(
  () =>
    operatingTaskIds.value.has('bulk') ||
    operatingTaskIds.value.has('bulk-delete') ||
    operatingTaskIds.value.has('clear-history')
)

const confirmTitle = computed(() => {
  const intent = confirmIntent.value
  if (intent?.type === 'bulk-delete') return t('taskCenter.confirm.bulkDeleteTitle')
  if (intent?.type === 'bulk-cancel') return t('taskCenter.confirm.bulkCancelTitle')
  if (intent?.type === 'clear-history') return t('taskCenter.confirm.clearHistoryTitle')
  if (intent?.action === 'cancel') return t('taskCenter.confirm.cancelTitle')
  if (intent?.action === 'remove') return t('taskCenter.confirm.removeTitle')
  return t('taskCenter.confirm.deleteTitle')
})

const confirmDescription = computed(() => {
  const intent = confirmIntent.value
  if (intent?.type === 'bulk-delete') {
    return t('taskCenter.confirm.bulkDeleteText', { count: intent.tasks?.length || 0 })
  }
  if (intent?.type === 'bulk-cancel') {
    return t('taskCenter.confirm.bulkCancelText', { count: intent.tasks?.length || 0 })
  }
  if (intent?.type === 'clear-history') {
    return t('taskCenter.confirm.clearHistoryText', {
      count: Number(summary.value.historyCount || 0)
    })
  }
  if (intent?.action === 'cancel') return t('taskCenter.confirm.cancelText')
  if (intent?.action === 'remove') {
    const task = intent?.task
    if (task?.kind === 'legacy') return t('taskCenter.confirm.removeLegacyText')
    if (!task?.actions?.includes('delete') && task?.actions?.includes('cancel')) {
      return t('taskCenter.confirm.removeRunningText')
    }
  }
  return t('taskCenter.confirm.deleteText')
})

const confirmText = computed(() => {
  const intent = confirmIntent.value
  if (intent?.action === 'cancel' || intent?.type === 'bulk-cancel') {
    return t('taskCenter.confirm.confirmCancel')
  }
  if (intent?.type === 'clear-history') return t('taskCenter.confirm.confirmClear')
  if (intent?.action === 'remove') return t('taskCenter.confirm.confirmRemove')
  return t('taskCenter.confirm.confirmDelete')
})

function toPlainIpcPayload(payload = {}) {
  return JSON.parse(JSON.stringify(sanitizeIpcPayload(payload, {})))
}

function invokeTaskIpc(channel, payload = {}) {
  return ipcRenderer.invoke(channel, toPlainIpcPayload(payload))
}

function syncRouteQuery() {
  const query = { ...route.query, tab: taskTab.value }
  if (taskTab.value === 'downloads') {
    query.dl = downloadView.value
  } else {
    query.view = activeView.value
    if (gameFilter.value) query.game = gameFilter.value
    else delete query.game
    delete query.dl
  }
  delete query.jobId
  delete query.job_id
  delete query.legacyTaskId
  delete query.legacy_task_id
  router.replace({ path: route.path, query })
}

function selectStatus(value) {
  taskTab.value = 'install'
  gameFilter.value = ''
  activeView.value = normalizeTaskCenterView(value)
  syncRouteQuery()
}

function selectGame(key) {
  taskTab.value = 'install'
  activeView.value = 'all'
  gameFilter.value = String(key || '')
  syncRouteQuery()
}

function selectDownloads(value) {
  taskTab.value = 'downloads'
  downloadView.value = DOWNLOAD_VIEWS.includes(value) ? value : 'downloading'
  closeDetail()
  syncRouteQuery()
}

function setOperation(taskId, active) {
  const next = new Set(operatingTaskIds.value)
  if (active) next.add(String(taskId))
  else next.delete(String(taskId))
  operatingTaskIds.value = next
}

function describeError(error, fallbackKey = 'taskCenter.feedback.failed') {
  // 主进程返回的说明按原文展示；错误代码只出现在诊断信息里，不拼进提示。
  return String(error?.message || '').trim() || t(fallbackKey)
}

function publishAiPageContext() {
  const currentSummary = summary.value
  return aiPageContextProvider.update({
    displaySource: 'vertex',
    businessSource: 'vertex',
    sourceLabel,
    businessSourceLabel: sourceLabel,
    page: {
      type: 'install_task_center',
      get title() { return uiText('taskCenter.title') },
      source: 'vertex',
      displaySource: 'vertex',
      businessSource: 'vertex',
      sourceLabel,
      businessSourceLabel: sourceLabel
    },
    search: {
      keyword: searchText.value.trim(),
      sort: activeView.value,
      page: page.value,
      pageSize,
      selectedIds: selectedIds.value,
      filters: {
        stateGroup: activeView.value,
        gameKey: gameFilter.value,
        source: sourceFilter.value,
        selectedJobId: String(selectedTask.value?.id || ''),
        total: Number(currentSummary.total || 0),
        detailOpen: detailOpen.value
      }
    },
    installTask: {
      activeCount: Number(currentSummary.activeCount || 0),
      attentionCount: Number(currentSummary.attentionCount || 0),
      failedCount: Number(currentSummary.failedCount || 0),
      historyCount: Number(currentSummary.historyCount || 0),
      badgeCount: Number(currentSummary.badgeCount || 0),
      visibleCount: Number(currentSummary.badgeCount || 0)
    },
    sourceState: {
      source: 'vertex',
      status: currentSummary.failedCount > 0 ? 'warning' : 'active',
      get label() { return uiText('taskCenter.title') },
      configured: true,
      summary: uiText('ui.valuePendingValueNeedAction', { value1: (currentSummary.badgeCount), value2: (Number(currentSummary.attentionCount || 0) + Number(currentSummary.failedCount || 0)) })
    }
  })
}

async function refreshSelectedTaskDetail(options = {}) {
  const task = selectedTask.value
  if (!detailOpen.value || task?.kind !== 'source' || !task.id) return false

  const selectedId = String(task.id)
  const requestSerial = ++detailRequestSerial
  try {
    const result = await invokeTaskIpc('source-install-task:detail', { jobId: selectedId })
    if (
      requestSerial !== detailRequestSerial ||
      !detailOpen.value ||
      String(selectedTask.value?.id || '') !== selectedId
    ) {
      return false
    }
    if (result?.success === false || !result?.data) {
      throw new Error(result?.message || '')
    }

    const nextTask = adaptSourceInstallTask(result.data.job || result.data)
    if (nextTask?.id) selectedTask.value = nextTask
    selectedDetail.value = result.data
    return true
  } catch (error) {
    if (requestSerial === detailRequestSerial && options.reportError) {
      operationFeedback.value = t('taskCenter.detail.loadFailed', {
        reason: describeError(error)
      })
      $message.error(operationFeedback.value)
    }
    return false
  } finally {
    if (
      requestSerial === detailRequestSerial &&
      String(selectedTask.value?.id || '') === selectedId
    ) {
      detailLoading.value = false
    }
  }
}

async function loadTasks(options = {}) {
  const requestSerial = ++listRequestSerial
  const manual = options.manual === true
  if (manual || hasLoaded.value) refreshing.value = true
  else loading.value = true
  loadError.value = ''

  try {
    const [nextSummary, listResult] = await Promise.all([
      invokeTaskIpc('source-install-task:summary', {}),
      invokeTaskIpc('source-install-task:list', {
        stateGroup: resolveTaskCenterStateGroup(activeView.value),
        gameKey: gameFilter.value,
        source: sourceFilter.value,
        page: page.value,
        pageSize
      }),
      options.withIndex ? loadGameIndex() : null
    ])
    if (requestSerial !== listRequestSerial) return
    sourceSummary.value = { ...DEFAULT_SUMMARY, ...(nextSummary || {}) }
    sourceRecords.value = Array.isArray(listResult?.records) ? listResult.records : []
    sourceTotal.value = Number(listResult?.total || 0)
    if (detailOpen.value && selectedTask.value?.kind === 'source') {
      const updatedTask = tasks.value.find(
        (task) => task.kind === 'source' && String(task.id) === String(selectedTask.value?.id || '')
      )
      if (updatedTask) selectedTask.value = updatedTask
      await refreshSelectedTaskDetail()
      if (requestSerial !== listRequestSerial) return
    }
    pruneSelection()
    hasLoaded.value = true
    publishAiPageContext()
  } catch (error) {
    if (requestSerial !== listRequestSerial) return
    loadError.value = describeError(error)
  } finally {
    if (requestSerial === listRequestSerial) {
      loading.value = false
      refreshing.value = false
    }
  }
}

async function openTask(task = {}) {
  if (!task?.id) return
  ++detailRequestSerial
  selectedTask.value = task
  selectedDetail.value = {}
  detailOpen.value = true
  operationFeedback.value = ''

  if (task.kind === 'legacy') {
    selectedDetail.value = task.raw || {}
    detailLoading.value = false
  } else {
    detailLoading.value = true
    await refreshSelectedTaskDetail({ reportError: true })
  }

  publishAiPageContext()
}

function closeDetail() {
  ++detailRequestSerial
  detailLoading.value = false
  detailOpen.value = false
  selectedTask.value = null
  selectedDetail.value = {}
  publishAiPageContext()
}

function openLegacyTask(task = {}) {
  window.dispatchEvent(
    new CustomEvent('vertex:open-install-task-detail', {
      detail: { taskId: String(task?.id || task?.raw?.taskId || '') }
    })
  )
}

async function loadGameIndex() {
  try {
    const result = await invokeTaskIpc('source-install-task:list', {
      page: 1,
      pageSize: GAME_INDEX_PAGE_SIZE
    })
    gameIndexRecords.value = Array.isArray(result?.records) ? result.records : []
  } catch {
    // 只影响侧栏「按游戏」和来源下拉，列表本身照常显示。
  }
}

function pruneSelection() {
  if (!selectedJobIds.value.size) return
  const visible = new Set(
    tasks.value.filter((task) => task.kind === 'source').map((task) => String(task.id))
  )
  const next = new Set([...selectedJobIds.value].filter((id) => visible.has(id)))
  if (next.size !== selectedJobIds.value.size) selectedJobIds.value = next
}

async function copyDiagnostics(task = selectedTask.value) {
  if (copyingDiagnostics.value) return
  copyingDiagnostics.value = true
  try {
    const result =
      task?.kind === 'source'
        ? await invokeTaskIpc('source-install-task:detail', {
            jobId: String(task.id),
            format: 'diagnostic-json'
          })
        : null
    if (task?.kind === 'source' && (result?.success !== true || typeof result?.data !== 'string')) {
      throw new Error(result?.message || t('taskCenter.feedback.diagnosticsFailed'))
    }
    const content = result
      ? result.data
      : JSON.stringify(
          {
            task: selectedDetail.value?.job || task?.raw || {},
            precheck: selectedDetail.value?.precheck || {},
            failure: selectedDetail.value?.failure || {},
            health: selectedDetail.value?.health || {},
            items: selectedDetail.value?.items || [],
            artifacts: selectedDetail.value?.artifacts || [],
            logs: selectedDetail.value?.logs || []
          },
          null,
          2
        )
    await navigator.clipboard.writeText(content)
    operationFeedback.value = t('taskCenter.feedback.copied')
    $message.success(operationFeedback.value)
  } catch (error) {
    operationFeedback.value = t('taskCenter.feedback.copyFailed', { reason: describeError(error) })
    $message.error(operationFeedback.value)
  } finally {
    copyingDiagnostics.value = false
  }
}

function requestDangerAction(action, task = selectedTask.value) {
  confirmIntent.value = { type: 'single', action, task }
  confirmOpen.value = true
}

function requestClearHistory() {
  confirmIntent.value = { type: 'clear-history' }
  confirmOpen.value = true
}

async function invokeSourceAction(action, task, options = {}) {
  const channelMap = {
    pause: 'source-install-task:pause',
    resume: 'source-install-task:resume',
    cancel: 'source-install-task:cancel',
    retry: 'source-install-task:retry',
    delete: 'source-install-task:delete'
  }
  const channel = channelMap[action]
  if (!channel) throw new Error(t('taskCenter.feedback.failed'))
  const payload =
    action === 'delete'
      ? { jobIds: [task.id], expectedStates: { [task.id]: task.state } }
      : {
          jobId: task.id,
          expectedState: task.state,
          ...(action === 'retry' && options.componentSelections
            ? { componentSelections: options.componentSelections }
            : {})
        }
  const result = await invokeTaskIpc(channel, payload)
  if (result?.success === false) {
    const error = new Error(result.message || '')
    error.code = result.code || result.reasonCode || 'task_action_not_allowed'
    throw error
  }
  return result
}

async function executeSourceAction(action, task = selectedTask.value, options = {}) {
  if (!task?.id || operatingTaskIds.value.has(String(task.id))) return
  setOperation(task.id, true)
  operationFeedback.value = ''
  try {
    const result = await invokeSourceAction(action, task, options)
    operationFeedback.value = result?.message || t('taskCenter.feedback.done')
    $message.success(operationFeedback.value)
    if (action === 'delete') closeDetail()
    await loadTasks({ manual: true })
  } catch (error) {
    operationFeedback.value = describeError(error)
    $message.error(operationFeedback.value)
    return { success: false, message: operationFeedback.value }
  } finally {
    setOperation(task.id, false)
  }
}

async function removeTask(task = selectedTask.value) {
  if (!task?.id || operatingTaskIds.value.has(String(task.id))) return
  setOperation(task.id, true)
  operationFeedback.value = ''

  try {
    if (task.kind === 'legacy') {
      if (!task.actions?.includes('legacy_delete')) {
        throw Object.assign(new Error(t('taskCenter.feedback.legacyBusy')), {
          code: 'task_operation_in_progress'
        })
      }
      installStore.removeTask(task.id)
      operationFeedback.value = t('taskCenter.feedback.legacyRemoved')
      $message.success(operationFeedback.value)
      if (String(selectedTask.value?.id || '') === String(task.id)) closeDetail()
      publishAiPageContext()
      return
    }

    let expectedState = task.state
    if (!task.actions?.includes('delete') && task.actions?.includes('cancel')) {
      const cancelResult = await invokeTaskIpc('source-install-task:cancel', {
        jobId: task.id,
        expectedState: task.state,
        awaitStopped: true
      })
      if (cancelResult?.success === false) {
        const error = new Error(cancelResult.message || '')
        error.code = cancelResult.code || cancelResult.reasonCode || 'task_action_not_allowed'
        throw error
      }
      expectedState = 'cancelled'
    }

    const result = await invokeTaskIpc('source-install-task:delete', {
      jobIds: [task.id],
      expectedStates: { [task.id]: expectedState }
    })
    if (result?.success === false) {
      const error = new Error(result.message || '')
      error.code = result.code || result.reasonCode || 'task_delete_not_terminal'
      throw error
    }
    operationFeedback.value = result?.message || t('taskCenter.feedback.deleted', { count: 1 })
    $message.success(operationFeedback.value)
    const nextSelectedIds = new Set(selectedJobIds.value)
    nextSelectedIds.delete(String(task.id))
    selectedJobIds.value = nextSelectedIds
    if (String(selectedTask.value?.id || '') === String(task.id)) closeDetail()
    await loadTasks({ manual: true })
  } catch (error) {
    operationFeedback.value = describeError(error)
    $message.error(operationFeedback.value)
    if (task.kind === 'source') await loadTasks({ manual: true })
    return { success: false, message: operationFeedback.value }
  } finally {
    setOperation(task.id, false)
  }
}

function bulkTargets(action) {
  return selectedTasks.value.filter((task) => task.actions?.includes(action))
}

function requestBulkAction(action) {
  const targets = bulkTargets(action)
  if (!targets.length) return
  if (action === 'delete') {
    confirmIntent.value = { type: 'bulk-delete', tasks: targets }
    confirmOpen.value = true
    return
  }
  if (action === 'cancel') {
    confirmIntent.value = { type: 'bulk-cancel', tasks: targets }
    confirmOpen.value = true
    return
  }
  return runBulkAction(action, targets)
}

function reportBulkResult(done, failures = [], skipped = 0) {
  if (failures.length) {
    operationFeedback.value = t('taskCenter.feedback.bulkPartial', {
      done,
      failed: failures.length,
      reason: describeError(failures[0])
    })
    $message.error(operationFeedback.value)
  } else {
    operationFeedback.value = t('taskCenter.feedback.bulkDone', { count: done })
    $message.success(operationFeedback.value)
  }
  if (skipped > 0) $message.warning(t('taskCenter.feedback.bulkSkipped', { count: skipped }))
}

async function runBulkAction(action, targets = bulkTargets(action)) {
  if (!targets.length || operatingTaskIds.value.has('bulk')) return
  const skipped = selectedTasks.value.length - targets.length
  setOperation('bulk', true)
  let done = 0
  const failures = []
  try {
    for (const task of targets) {
      try {
        await invokeSourceAction(action, task)
        done += 1
      } catch (error) {
        failures.push(error)
      }
    }
    reportBulkResult(done, failures, skipped)
    if (action === 'cancel') selectedJobIds.value = new Set()
    await loadTasks({ manual: true })
  } finally {
    setOperation('bulk', false)
  }
  return failures.length && !done ? { success: false, message: operationFeedback.value } : undefined
}

async function deleteSelectedTasks(targets = bulkTargets('delete')) {
  if (!targets.length) return
  const lockId = 'bulk-delete'
  setOperation(lockId, true)
  try {
    const result = await invokeTaskIpc('source-install-task:delete', {
      jobIds: targets.map((task) => task.id),
      expectedStates: Object.fromEntries(targets.map((task) => [task.id, task.state]))
    })
    if (result?.success === false) {
      const error = new Error(result.message || '')
      error.code = result.code || result.reasonCode || 'task_delete_not_terminal'
      throw error
    }
    operationFeedback.value = t('taskCenter.feedback.deleted', {
      count: Number(result?.deletedCount || 0)
    })
    $message.success(operationFeedback.value)
    selectedJobIds.value = new Set()
    if (targets.some((task) => String(task.id) === String(selectedTask.value?.id))) closeDetail()
    await loadTasks({ manual: true, withIndex: true })
  } catch (error) {
    operationFeedback.value = describeError(error)
    $message.error(operationFeedback.value)
    return { success: false, message: operationFeedback.value }
  } finally {
    setOperation(lockId, false)
  }
}

async function clearHistory() {
  const lockId = 'clear-history'
  setOperation(lockId, true)
  try {
    const result = await invokeTaskIpc('source-install-task:clear-completed', {})
    if (result?.success === false) {
      const error = new Error(result.message || '')
      error.code = result.code || result.reasonCode || 'task_state_changed'
      throw error
    }
    operationFeedback.value = t('taskCenter.feedback.cleared', {
      count: Number(result?.clearedCount || 0)
    })
    $message.success(operationFeedback.value)
    selectedJobIds.value = new Set()
    closeDetail()
    await loadTasks({ manual: true, withIndex: true })
  } catch (error) {
    operationFeedback.value = describeError(error)
    $message.error(operationFeedback.value)
    return { success: false, message: operationFeedback.value }
  } finally {
    setOperation(lockId, false)
  }
}

async function confirmDangerAction() {
  const intent = confirmIntent.value
  if (!intent) return { success: false, message: t('taskCenter.feedback.failed') }
  if (intent.type === 'bulk-delete') return deleteSelectedTasks(intent.tasks)
  if (intent.type === 'bulk-cancel') return runBulkAction('cancel', intent.tasks)
  if (intent.type === 'clear-history') return clearHistory()
  if (intent.action === 'remove') return removeTask(intent.task)
  return executeSourceAction(intent.action, intent.task)
}

function handleTaskAction(action, task, options = {}) {
  if (action === 'diagnose') return diagnoseFailedTask(task)
  if (action === 'legacy_open') return openLegacyTask(task)
  if (action === 'handle') return openTask(task)
  if (action === 'authorize') {
    const authorizationItems = Array.isArray(selectedDetail.value?.nexusAuthorization?.items)
      ? selectedDetail.value.nexusAuthorization.items
      : []
    openNexusAuthorizationPanel(
      String(task?.id || ''),
      authorizationItems.find((item) =>
        ['waiting_authorization', 'authenticating'].includes(item.status)
      )?.itemId || ''
    )
    return
  }
  if (action === 'view_download') return selectDownloads('downloading')
  if (action === 'copy_diagnostics') return copyDiagnostics(task)
  if (['cancel', 'delete', 'remove'].includes(action)) return requestDangerAction(action, task)
  return executeSourceAction(action, task, options)
}

async function diagnoseFailedTask(task) {
  if (!canDiagnoseSourceInstallTask(task) || operatingTaskIds.value.has(task.id)) return
  if (aiAssistantStore.isProcessing) {
    $message.warning(t('taskCenter.feedback.aiBusy'))
    return
  }
  operatingTaskIds.value = new Set([...operatingTaskIds.value, task.id])
  try {
    publishAiPageContext()
    await ipcRenderer.invoke(
      'ai-assistant-window:open',
      sanitizeIpcPayload({ source: 'failed-install-task' }, {})
    )
    const result = await aiAssistantStore.sendMessage(buildInstallFailureRecoveryPrompt(task))
    if (result?.accepted === false) $message.warning(t('taskCenter.feedback.aiNotStarted'))
  } catch (error) {
    $message.error(error?.message || t('taskCenter.feedback.aiOpenFailed'))
  } finally {
    const pending = new Set(operatingTaskIds.value)
    pending.delete(task.id)
    operatingTaskIds.value = pending
  }
}

function toggleSelection(task = {}, checked = false) {
  if (task.kind !== 'source' || !task.id) return
  const next = new Set(selectedJobIds.value)
  if (checked) next.add(String(task.id))
  else next.delete(String(task.id))
  selectedJobIds.value = next
  publishAiPageContext()
}

function toggleAllSelection(checked = false) {
  const ids = tasks.value.filter((task) => task.kind === 'source').map((task) => String(task.id))
  const next = new Set(selectedJobIds.value)
  ids.forEach((id) => (checked ? next.add(id) : next.delete(id)))
  selectedJobIds.value = next
  publishAiPageContext()
}

function clearSelection() {
  selectedJobIds.value = new Set()
  publishAiPageContext()
}

function clearListFilters() {
  searchText.value = ''
  sourceFilter.value = ''
}

async function openTaskById(jobId = '') {
  const targetId = String(jobId || '').trim()
  if (!targetId) return
  const localTask = tasks.value.find((task) => String(task.id) === targetId)
  if (localTask) return openTask(localTask)
  const result = await invokeTaskIpc('source-install-task:detail', { jobId: targetId })
  if (result?.success === false || !result?.data) return
  const detailJob = result.data.job || result.data
  const task = adaptSourceInstallTask(detailJob)
  if (task) {
    selectedTask.value = task
    selectedDetail.value = result.data
    detailOpen.value = true
  }
}

async function openLegacyTaskById(taskId = '') {
  const targetId = String(taskId || '').trim()
  if (!targetId) return
  const task = tasks.value.find((item) => item.kind === 'legacy' && String(item.id) === targetId)
  if (task) await openTask(task)
}

function scheduleRefresh() {
  if (summaryRefreshTimer) return
  summaryRefreshTimer = window.setTimeout(() => {
    summaryRefreshTimer = null
    if (operatingTaskIds.value.size > 0) {
      scheduleRefresh()
      return
    }
    loadTasks({ withIndex: true })
  }, 250)
}

function previousPage() {
  if (page.value <= 1) return
  page.value -= 1
}

function nextPage() {
  if (page.value >= totalPages.value) return
  page.value += 1
}

useIpc('source-install-task:updated', scheduleRefresh)
useIpc('source-install-task:item-updated', scheduleRefresh)
useIpc('source-install-task:artifact-updated', scheduleRefresh)

watch([activeView, gameFilter, sourceFilter], async () => {
  page.value = 1
  selectedJobIds.value = new Set()
  closeDetail()
  await loadTasks()
})

// 页面被缓存时，从其他入口带参数跳回（如 /app/download → ?tab=downloads、?jobId=）也要切到对应视图。
watch(
  () => route.query,
  (query = {}) => {
    if (route.path !== pagePath) return
    const nextTab = query.tab === 'downloads' ? 'downloads' : 'install'
    if (taskTab.value !== nextTab) taskTab.value = nextTab
    if (DOWNLOAD_VIEWS.includes(query.dl) && downloadView.value !== query.dl) {
      downloadView.value = query.dl
    }
    if (nextTab === 'install' && query.view !== undefined) {
      const nextView = normalizeTaskCenterView(query.view)
      if (activeView.value !== nextView) activeView.value = nextView
      const nextGame = String(query.game || '')
      if (gameFilter.value !== nextGame) gameFilter.value = nextGame
    }
    const jobId = query.jobId || query.job_id
    if (jobId && String(selectedTask.value?.id || '') !== String(jobId)) void openTaskById(jobId)
  }
)

watch(page, async () => {
  selectedJobIds.value = new Set()
  closeDetail()
  await loadTasks()
})

watch(searchText, () => {
  pruneSelection()
  publishAiPageContext()
})

watch(sortMode, (value) => {
  if (!SORT_VALUES.has(value)) sortMode.value = 'priority'
})

watch(
  () => summary.value,
  () => publishAiPageContext(),
  { deep: true }
)

onMounted(async () => {
  setPageMenuName('任务中心')
  installStore.cleanupInstallTasks()
  await loadTasks({ withIndex: true })
  await openTaskById(route.query?.jobId || route.query?.job_id)
  await openLegacyTaskById(route.query?.legacyTaskId || route.query?.legacy_task_id)
  autoRefreshTimer = window.setInterval(() => {
    if (document.hidden || loading.value || refreshing.value || operatingTaskIds.value.size > 0)
      return
    loadTasks()
  }, 2500)
})

onBeforeUnmount(() => {
  ++detailRequestSerial
  ++listRequestSerial
  if (summaryRefreshTimer) window.clearTimeout(summaryRefreshTimer)
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer)
})
</script>

<template>
  <PageBody :is-scroll-enabled="false" :padding-num="0">
    <div class="unified-task-center">
      <div class="task-center-shell">
        <nav class="task-center-sidebar" :aria-label="t('taskCenter.nav.label')">
          <div class="task-center-sidebar__title">{{ t('taskCenter.title') }}</div>
          <div class="task-center-sidebar__list vx-ui-scrollbar">
            <div class="task-center-sidebar__group">{{ t('taskCenter.nav.install') }}</div>
            <div
              class="task-center-sidebar__statuses"
              role="group"
              :aria-label="t('taskCenter.nav.install')"
            >
              <button
                v-for="option in statusOptions"
                :key="option.value"
                type="button"
                class="task-center-sidebar__item"
                :class="{
                  'is-active': taskTab === 'install' && !gameFilter && activeView === option.value
                }"
                :aria-pressed="taskTab === 'install' && !gameFilter && activeView === option.value"
                :aria-label="
                  t('taskCenter.nav.count', { label: option.label, count: option.count })
                "
                @click="selectStatus(option.value)"
              >
                <ToolIcon :name="option.icon" :size="16" />
                <span class="task-center-sidebar__name">{{ option.label }}</span>
                <span
                  v-if="option.value === 'needs_action' && option.count > 0"
                  class="task-center-sidebar__dot"
                  aria-hidden="true"
                ></span>
                <span class="task-center-sidebar__count">{{ option.count }}</span>
              </button>
            </div>

            <div class="task-center-sidebar__group">{{ t('taskCenter.nav.downloads') }}</div>
            <div
              class="unified-task-center__tabs"
              role="group"
              :aria-label="t('taskCenter.nav.downloads')"
            >
              <button
                v-for="option in downloadOptions"
                :key="option.value"
                type="button"
                class="task-center-sidebar__item"
                :class="{ 'is-active': taskTab === 'downloads' && downloadView === option.value }"
                :aria-pressed="taskTab === 'downloads' && downloadView === option.value"
                :aria-label="
                  t('taskCenter.nav.count', { label: option.label, count: option.count })
                "
                @click="selectDownloads(option.value)"
              >
                <ToolIcon :name="option.icon" :size="16" />
                <span class="task-center-sidebar__name">{{ option.label }}</span>
                <span class="task-center-sidebar__count">{{ option.count }}</span>
              </button>
            </div>

            <template v-if="gameIndex.length">
              <div class="task-center-sidebar__group">{{ t('taskCenter.nav.games') }}</div>
              <div
                class="task-center-sidebar__games"
                role="group"
                :aria-label="t('taskCenter.nav.games')"
              >
                <button
                  v-for="game in visibleGames"
                  :key="game.key"
                  type="button"
                  class="task-center-sidebar__item"
                  :class="{ 'is-active': taskTab === 'install' && gameFilter === game.key }"
                  :aria-pressed="taskTab === 'install' && gameFilter === game.key"
                  :title="game.name || t('taskCenter.unknownGame')"
                  @click="selectGame(game.key)"
                >
                  <span class="task-center-sidebar__name">{{
                    game.name || t('taskCenter.unknownGame')
                  }}</span>
                  <span class="task-center-sidebar__count">{{ game.count }}</span>
                </button>
                <button
                  v-if="hiddenGameCount > 0"
                  type="button"
                  class="task-center-sidebar__item is-more"
                  :aria-expanded="gamesExpanded"
                  @click="gamesExpanded = !gamesExpanded"
                >
                  <span class="task-center-sidebar__name">{{
                    gamesExpanded
                      ? t('taskCenter.nav.lessGames')
                      : t('taskCenter.nav.moreGames', { count: hiddenGameCount })
                  }}</span>
                </button>
              </div>
            </template>
          </div>
          <p class="task-center-sidebar__hint">
            <span
              class="task-center-sidebar__sync"
              :class="{ 'is-busy': refreshing || loading }"
              aria-hidden="true"
            ></span>
            {{ refreshing || loading ? t('taskCenter.nav.syncing') : t('taskCenter.nav.synced') }}
          </p>
        </nav>

        <DownloadTasksPanel
          v-show="taskTab === 'downloads'"
          class="task-center-content"
          :view="downloadView"
          @completed-count="completedDownloadCount = $event"
        />
        <main v-show="taskTab === 'install'" class="task-center-page task-center-content">
          <TaskCenterToolbar
            v-model:search="searchText"
            v-model:source="sourceFilter"
            v-model:sort="sortMode"
            :title="listTitle"
            :count="listCount"
            :source-options="sourceOptions"
            :loading="loading || refreshing"
            :operation-loading="toolbarOperationLoading"
            :error-text="loadError"
            :selected-count="selectedCount"
            :bulk-actions="bulkActions"
            :can-clear-history="canClearHistory"
            @refresh="loadTasks({ manual: true, withIndex: true })"
            @bulk="requestBulkAction"
            @clear-selection="clearSelection"
            @clear-history="requestClearHistory"
          />
          <TaskCenterTable
            :tasks="tasks"
            :active-id="selectedTaskId"
            :selected-ids="selectedIds"
            :operating-ids="operatingIds"
            :loading="loading && !hasLoaded"
            :filtered="hasListFilters"
            :empty-title="emptyTitle"
            :empty-text="emptyText"
            @open="openTask"
            @action="handleTaskAction"
            @toggle-selection="toggleSelection"
            @toggle-all="toggleAllSelection"
            @clear-filters="clearListFilters"
          />

          <footer class="task-center-page__footer">
            <span>{{ t('taskCenter.table.total', { count: listCount }) }}</span>
            <span v-if="totalPages > 1" class="task-center-page__pager">
              <span>{{ t('taskCenter.table.page', { page, total: totalPages }) }}</span>
              <VxButton variant="secondary" size="sm" :disabled="page <= 1" @click="previousPage">
                {{ t('taskCenter.table.prev') }}
              </VxButton>
              <VxButton
                variant="secondary"
                size="sm"
                :disabled="page >= totalPages"
                @click="nextPage"
              >
                {{ t('taskCenter.table.next') }}
              </VxButton>
            </span>
            <span v-else>{{ t('taskCenter.table.priorityHint') }}</span>
          </footer>
        </main>
      </div>
    </div>

    <VxModal
      :model-value="detailOpen && Boolean(selectedTask)"
      plain
      close-on-overlay
      :aria-label="drawerLabel"
      panel-class="task-center-drawer"
      @update:model-value="$event || closeDetail()"
    >
      <TaskCenterDetail
        v-if="selectedTask"
        :task="selectedTask"
        :detail="selectedDetail"
        :loading="detailLoading"
        :copying="copyingDiagnostics"
        :operating="selectedOperating"
        @action="handleTaskAction"
        @close="closeDetail"
      />
    </VxModal>

    <VxConfirmModal
      v-model="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-text="confirmText"
      :cancel-text="t('taskCenter.confirm.keep')"
      danger
      :confirm-action="confirmDangerAction"
    />

    <InstallTaskEntry hide-entry />
  </PageBody>
</template>

<style scoped lang="scss">
.unified-task-center {
  width: 100%;
  height: 100%;
  padding: var(--space-5) var(--space-6) var(--space-6);
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  background: var(--color-bg);
  box-sizing: border-box;
}

.task-center-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

// ==================== 侧栏 ====================
.task-center-sidebar {
  display: flex;
  flex: 0 0 232px;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-soft);
  border-right: 1px solid var(--color-surface-strong);
}

.task-center-sidebar__title {
  padding: var(--space-5) var(--space-5) var(--space-1);
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.task-center-sidebar__list {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
  overflow-y: auto;
}

.task-center-sidebar__group {
  padding: 18px 10px 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.task-center-sidebar__statuses,
.unified-task-center__tabs,
.task-center-sidebar__games {
  display: grid;
  gap: 2px;
}

.task-center-sidebar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 13.5px;
  font-weight: var(--font-weight-medium);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  &.is-active {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-semibold);
    background: var(--color-accent-soft);
  }

  &.is-more {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
}

.task-center-sidebar__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.task-center-sidebar__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: var(--color-warning);
  border-radius: 50%;
}

.task-center-sidebar__count {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;

  .is-active & {
    color: var(--color-accent-strong);
  }
}

.task-center-sidebar__hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: var(--space-3) 22px var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  border-top: 1px solid var(--color-surface-strong);
}

.task-center-sidebar__sync {
  width: 6px;
  height: 6px;
  background: var(--color-success);
  border-radius: 50%;

  &.is-busy {
    background: var(--color-accent);
  }
}

// ==================== 内容 ====================
.task-center-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.task-center-page > .task-center-table {
  flex: 1;
}

.task-center-page__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.task-center-page__pager {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

:deep(.vx-ui-scrollbar::-webkit-scrollbar) {
  width: 7px;
  height: 7px;
}

:deep(.vx-ui-scrollbar::-webkit-scrollbar-button) {
  display: none;
  width: 0;
  height: 0;
}

// ==================== 详情抽屉（VxModal plain + 右侧面板） ====================
:global(.base-dialog:has(> .task-center-drawer)) {
  padding: 0;
  background: rgba(15, 23, 42, 0.18);
}

:global(.base-dialog-panel.task-center-drawer) {
  position: fixed;
  top: 0;
  right: var(--assistant-dock-inset, 0px);
  bottom: 0;
  width: min(520px, 100vw);
  max-width: 100vw;
  height: 100vh;
  max-height: 100vh;
  padding: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 0;
  border-left: 1px solid var(--color-border);
  border-radius: 0;
  box-shadow: var(--shadow-lg);
}

:global(.base-dialog-panel.task-center-drawer > .base-dialog-body) {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

:global(.base-dialog-panel.task-center-drawer .task-center-detail) {
  flex: 1;
}

:global(.base-dialog-panel.task-center-drawer .vx-ui-scrollbar::-webkit-scrollbar) {
  width: 7px;
  height: 7px;
}

:global(.base-dialog-panel.task-center-drawer .vx-ui-scrollbar::-webkit-scrollbar-thumb) {
  background: var(--scrollbar-thumb-color);
  border-radius: 4px;
}

:global(.base-dialog-panel.task-center-drawer .vx-ui-scrollbar::-webkit-scrollbar-button) {
  display: none;
  width: 0;
  height: 0;
}

@media (max-width: 899px) {
  .unified-task-center {
    padding: var(--space-3);
  }

  .task-center-sidebar {
    flex-basis: 196px;
  }

  .task-center-page__footer {
    padding-inline: var(--space-4);
  }
}

@media (max-width: 759px) {
  .task-center-shell {
    flex-direction: column;
  }

  .task-center-sidebar {
    flex: 0 0 auto;
    border-right: 0;
    border-bottom: 1px solid var(--color-surface-strong);
  }

  .task-center-sidebar__title,
  .task-center-sidebar__hint,
  .task-center-sidebar__group,
  .task-center-sidebar__games {
    display: none;
  }

  .task-center-sidebar__list {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .task-center-sidebar__statuses,
  .unified-task-center__tabs {
    display: flex;
  }

  .task-center-sidebar__item {
    width: auto;
    flex-shrink: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .unified-task-center *,
  .unified-task-center *::before,
  .unified-task-center *::after {
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
</style>
