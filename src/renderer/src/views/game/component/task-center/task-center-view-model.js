import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import {
  classifyInstallTaskState,
  getAllowedInstallTaskActions,
  getInstallTaskStatePresentation,
  INSTALL_TASK_STATE_GROUP
} from '../../../../../../shared/tasks/install-task-center-policy.js'

function safeText(value = '', fallback = '') {
  return String(value ?? '').trim() || fallback
}

function safeNumber(value = 0, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  const text = safeText(value)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function clampProgress(value = 0) {
  return Math.max(0, Math.min(100, Math.round(safeNumber(value, 0))))
}

function resolveSourceTaskGame(job = {}, payload = {}) {
  return safeText(
    payload.gameName ||
      payload.game_name ||
      payload.sourceGameName ||
      payload.source_game_name ||
      job.game_name ||
      job.game_key,
    '未知游戏'
  )
}

function resolveSourceTaskSource(job = {}, payload = {}) {
  const source = safeText(payload.businessSource || payload.source || job.source, 'vertex')
  return {
    key: source,
    label: resolveSourcePlatformLabel(source.toLowerCase(), source)
  }
}

export function adaptSourceInstallTask(job = {}) {
  const payload = parseObject(job.payload || job.payload_json)
  const failure = parseObject(job.failure || job.failure_json)
  const state = safeText(job.state)
  const presentation = getInstallTaskStatePresentation(state)
  const source = resolveSourceTaskSource(job, payload)
  const itemTotal = safeNumber(job.item_count || job.itemCount || job.items?.length, 0)
  const itemCompleted = safeNumber(job.completed_item_count || job.completedItemCount, 0)

  const gameName = safeText(
    payload.gameName ||
      payload.game_name ||
      payload.sourceGameName ||
      payload.source_game_name ||
      job.game_name
  )
  return Object.freeze({
    id: safeText(job.job_id || job.jobId),
    kind: 'source',
    title: safeText(job.title, uiText('ui.sourceInstallationTask')),
    game: resolveSourceTaskGame(job, payload),
    source,
    state,
    stateGroup: presentation.group,
    stateLabel: presentation.label,
    stateTone: presentation.tone,
    currentStep: safeText(job.current_step || job.currentStep, presentation.label),
    // 展示层用这些原始值按当前语言拼文案；stateLabel / progressText 保留给 AI 上下文和旧调用方。
    stateKey: presentation.state,
    stepText: safeText(job.current_step || job.currentStep),
    gameName,
    gameKey: safeText(job.game_key || job.gameKey),
    itemTotal,
    itemCompleted,
    failureStage: safeText(job.failure_stage || job.failureStage || failure.stage),
    progress: clampProgress(job.progress),
    progressText: itemTotal > 0 ? uiText('ui.valueValueItems', { value1: (itemCompleted), value2: (itemTotal) }) : '',
    attention: presentation.attention,
    createdAt: safeText(job.created_at || job.createdAt),
    updatedAt: safeText(job.updated_at || job.updatedAt || job.created_at || job.createdAt),
    actions: getAllowedInstallTaskActions({ ...job, payload, failure }).filter(
      (action) =>
        !(
          action === 'view_download' && payload.items?.some((entry) => entry.item?.workshopDownload)
        )
    ),
    raw: job
  })
}

export function adaptLegacyEnableTask(task = {}) {
  const legacyStatus = safeText(task.status, 'WAIT_DOWNLOAD')
  const state = legacyStatus === 'SUCCESS' ? 'completed' : 'cancelled'
  const presentation = getInstallTaskStatePresentation(state)
  const requiredCount = Math.max(0, safeNumber(task.requiredCount || task.mods?.length, 0))
  const installedCount = Math.max(0, safeNumber(task.installedCount, 0))
  const selectedCount = Math.max(0, safeNumber(task.selectedFiles?.length, 0))
  const progress =
    legacyStatus === 'INSTALLING' && requiredCount > 0
      ? (installedCount / requiredCount) * 100
      : requiredCount > 0
        ? (selectedCount / requiredCount) * 100
        : 0
  const sourceKey = safeText(task.sourceType, 'vertex')
  const actions = ['legacy_open', 'legacy_delete']

  return Object.freeze({
    id: safeText(task.taskId),
    kind: 'legacy',
    title: safeText(
      task.sourceName || task.mods?.[0]?.modName || task.mods?.[0]?.name,
      uiText('ui.pendingEnablementTask')
    ),
    game: safeText(task.gameName, '未知游戏'),
    source: {
      key: sourceKey,
      label: resolveSourcePlatformLabel(sourceKey.toLowerCase(), sourceKey)
    },
    state,
    stateGroup: presentation.group,
    stateLabel: '来源已下线',
    stateTone: presentation.tone,
    currentStep: '历史记录仅供查看，不再下载或安装',
    stateKey: 'legacy',
    stepText: '',
    stepKey: 'taskCenter.legacy.step',
    gameName: safeText(task.gameName),
    gameKey: '',
    itemTotal: requiredCount,
    itemCompleted: Math.max(installedCount, selectedCount),
    failureStage: '',
    progress: clampProgress(progress),
    progressText:
      requiredCount > 0 ? uiText('ui.valueValueItems', { value1: (Math.max(installedCount, selectedCount)), value2: (requiredCount) }) : '',
    attention: [INSTALL_TASK_STATE_GROUP.ATTENTION, INSTALL_TASK_STATE_GROUP.FAILED].includes(
      presentation.group
    ),
    createdAt: safeText(task.createdAt),
    updatedAt: safeText(task.updatedAt || task.createdAt),
    actions,
    raw: task
  })
}

function isLegacyTaskVisible(task = {}) {
  return Boolean(task?.taskId)
}

export function mergeInstallTaskSummary(sourceSummary = {}, legacyTasks = []) {
  const safeLegacyTasks = (Array.isArray(legacyTasks) ? legacyTasks : []).filter((task) =>
    isLegacyTaskVisible(task)
  )
  const legacyCounts = {
    activeCount: 0,
    attentionCount: 0,
    failedCount: 0,
    historyCount: 0,
    completedCount: 0,
    cancelledCount: 0
  }
  safeLegacyTasks.map(adaptLegacyEnableTask).forEach((task) => {
    if (task.stateGroup === INSTALL_TASK_STATE_GROUP.ACTIVE) legacyCounts.activeCount += 1
    if (task.stateGroup === INSTALL_TASK_STATE_GROUP.ATTENTION) legacyCounts.attentionCount += 1
    if (task.stateGroup === INSTALL_TASK_STATE_GROUP.FAILED) legacyCounts.failedCount += 1
    if (
      [INSTALL_TASK_STATE_GROUP.COMPLETED, INSTALL_TASK_STATE_GROUP.CANCELLED].includes(
        task.stateGroup
      )
    ) {
      legacyCounts.historyCount += 1
    }
    if (task.stateGroup === INSTALL_TASK_STATE_GROUP.COMPLETED) legacyCounts.completedCount += 1
    if (task.stateGroup === INSTALL_TASK_STATE_GROUP.CANCELLED) legacyCounts.cancelledCount += 1
  })
  const sourceGroupCounts = countStatesByGroup(parseObject(sourceSummary.byState))

  const summary = {
    total: Math.max(0, safeNumber(sourceSummary.total, 0)) + safeLegacyTasks.length,
    activeCount: Math.max(0, safeNumber(sourceSummary.activeCount, 0)) + legacyCounts.activeCount,
    attentionCount:
      Math.max(0, safeNumber(sourceSummary.attentionCount, 0)) + legacyCounts.attentionCount,
    failedCount: Math.max(0, safeNumber(sourceSummary.failedCount, 0)) + legacyCounts.failedCount,
    historyCount:
      Math.max(0, safeNumber(sourceSummary.historyCount, 0)) + legacyCounts.historyCount,
    completedCount: sourceGroupCounts.completed + legacyCounts.completedCount,
    cancelledCount: sourceGroupCounts.cancelled + legacyCounts.cancelledCount,
    sourceBadgeCount: Math.max(0, safeNumber(sourceSummary.badgeCount, 0)),
    legacyCount: safeLegacyTasks.length,
    byState: parseObject(sourceSummary.byState)
  }
  summary.badgeCount = summary.activeCount + summary.attentionCount + summary.failedCount
  return summary
}

function countStatesByGroup(byState = {}) {
  const counts = { completed: 0, cancelled: 0 }
  Object.entries(byState).forEach(([state, count]) => {
    try {
      const group = classifyInstallTaskState(state)
      if (group in counts) counts[group] += Math.max(0, safeNumber(count, 0))
    } catch {
      // 未知状态不计入分组，避免整个摘要失败。
    }
  })
  return counts
}

// 侧栏的状态视图。value 对应主进程 source-install-task:list 的 stateGroup（all 不传）。
export const TASK_CENTER_VIEWS = Object.freeze([
  { value: 'all', stateGroup: '', icon: 'list' },
  { value: 'needs_action', stateGroup: 'needs_action', icon: 'warning' },
  { value: 'active', stateGroup: 'active', icon: 'clock' },
  { value: 'completed', stateGroup: 'completed', icon: 'check' },
  { value: 'cancelled', stateGroup: 'cancelled', icon: 'minus-circle' }
])
// 旧地址参数：pending（待处理）→ all，history（历史记录）→ completed。
const LEGACY_VIEW_ALIASES = Object.freeze({ pending: 'all', history: 'completed' })

export function normalizeTaskCenterView(value = '') {
  const view = safeText(value)
  const aliased = LEGACY_VIEW_ALIASES[view] || view
  return TASK_CENTER_VIEWS.some((item) => item.value === aliased) ? aliased : 'all'
}

export function resolveTaskCenterStateGroup(view = 'all') {
  return TASK_CENTER_VIEWS.find((item) => item.value === view)?.stateGroup || ''
}

export function matchesTaskCenterView(task = {}, view = 'pending') {
  if (view === 'all') return true
  if (view === 'completed') return task.stateGroup === INSTALL_TASK_STATE_GROUP.COMPLETED
  if (view === 'cancelled') return task.stateGroup === INSTALL_TASK_STATE_GROUP.CANCELLED
  if (view === 'active') return task.stateGroup === INSTALL_TASK_STATE_GROUP.ACTIVE
  if (view === 'needs_action') {
    return [INSTALL_TASK_STATE_GROUP.ATTENTION, INSTALL_TASK_STATE_GROUP.FAILED].includes(
      task.stateGroup
    )
  }
  if (view === 'history') {
    return [INSTALL_TASK_STATE_GROUP.COMPLETED, INSTALL_TASK_STATE_GROUP.CANCELLED].includes(
      task.stateGroup
    )
  }
  return ![INSTALL_TASK_STATE_GROUP.COMPLETED, INSTALL_TASK_STATE_GROUP.CANCELLED].includes(
    task.stateGroup
  )
}

export function buildTaskCenterViewModels(sourceJobs = [], legacyTasks = [], view = 'pending') {
  const sourceModels = (Array.isArray(sourceJobs) ? sourceJobs : []).map(adaptSourceInstallTask)
  const legacyModels = (Array.isArray(legacyTasks) ? legacyTasks : [])
    .filter((task) => isLegacyTaskVisible(task))
    .map(adaptLegacyEnableTask)
  return [...legacyModels, ...sourceModels]
    .filter((task) => matchesTaskCenterView(task, view))
    .sort((left, right) => {
      const priority = {
        // 需要用户处理的（等待操作、失败）排在进行中之前。
        [INSTALL_TASK_STATE_GROUP.ATTENTION]: 0,
        [INSTALL_TASK_STATE_GROUP.FAILED]: 1,
        [INSTALL_TASK_STATE_GROUP.ACTIVE]: 2,
        [INSTALL_TASK_STATE_GROUP.COMPLETED]: 3,
        [INSTALL_TASK_STATE_GROUP.CANCELLED]: 4
      }
      const groupDiff =
        safeNumber(priority[left.stateGroup], 9) - safeNumber(priority[right.stateGroup], 9)
      if (groupDiff) return groupDiff
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    })
}

export function getTaskCenterViewCount(summary = {}, view = 'pending') {
  if (view === 'all') return safeNumber(summary.total, 0)
  if (view === 'completed') return safeNumber(summary.completedCount, 0)
  if (view === 'cancelled') return safeNumber(summary.cancelledCount, 0)
  if (view === 'active') return safeNumber(summary.activeCount, 0)
  if (view === 'needs_action') {
    return safeNumber(summary.attentionCount, 0) + safeNumber(summary.failedCount, 0)
  }
  if (view === 'history') return safeNumber(summary.historyCount, 0)
  return safeNumber(summary.badgeCount, 0)
}
