export const INSTALL_TASK_STATE_GROUP = Object.freeze({
  ACTIVE: 'active',
  ATTENTION: 'attention',
  FAILED: 'failed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
})

export const INSTALL_TASK_ACTION = Object.freeze({
  PAUSE: 'pause',
  RESUME: 'resume',
  CANCEL: 'cancel',
  RETRY: 'retry',
  AUTHORIZE: 'authorize',
  DELETE: 'delete',
  VIEW_DOWNLOAD: 'view_download',
  COPY_DIAGNOSTICS: 'copy_diagnostics'
})

const STATE_POLICY = Object.freeze({
  created: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '准备中', tone: 'info' },
  prechecking: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '正在预检', tone: 'info' },
  resolving: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '正在解析', tone: 'info' },
  queued: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '等待执行', tone: 'info' },
  downloading: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '正在下载', tone: 'info' },
  downloaded: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '下载完成', tone: 'info' },
  previewing: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '生成安装预案', tone: 'info' },
  installing: { group: INSTALL_TASK_STATE_GROUP.ACTIVE, label: '正在安装', tone: 'info' },
  health_checking: {
    group: INSTALL_TASK_STATE_GROUP.ACTIVE,
    label: '安装后校验',
    tone: 'info'
  },
  waiting: { group: INSTALL_TASK_STATE_GROUP.ATTENTION, label: '等待操作', tone: 'warning' },
  waiting_user_action: {
    group: INSTALL_TASK_STATE_GROUP.ATTENTION,
    label: '等待用户操作',
    tone: 'warning'
  },
  paused: { group: INSTALL_TASK_STATE_GROUP.ATTENTION, label: '已暂停', tone: 'warning' },
  recoverable: {
    group: INSTALL_TASK_STATE_GROUP.ATTENTION,
    label: '可恢复',
    tone: 'warning'
  },
  precheck_blocked: {
    group: INSTALL_TASK_STATE_GROUP.ATTENTION,
    label: '预检阻断',
    tone: 'warning'
  },
  failed: { group: INSTALL_TASK_STATE_GROUP.FAILED, label: '失败', tone: 'danger' },
  partial_failed: {
    group: INSTALL_TASK_STATE_GROUP.FAILED,
    label: '部分失败',
    tone: 'danger'
  },
  completed: { group: INSTALL_TASK_STATE_GROUP.COMPLETED, label: '已完成', tone: 'success' },
  completed_with_warning: {
    group: INSTALL_TASK_STATE_GROUP.COMPLETED,
    label: '完成但有警告',
    tone: 'warning'
  },
  cancelled: { group: INSTALL_TASK_STATE_GROUP.CANCELLED, label: '已取消', tone: 'muted' }
})

const PAUSABLE_STATES = new Set(
  Object.entries(STATE_POLICY)
    .filter(([, policy]) => policy.group === INSTALL_TASK_STATE_GROUP.ACTIVE)
    .map(([state]) => state)
)
const RESUMABLE_STATES = new Set(['paused', 'recoverable'])
const RETRYABLE_STATES = new Set(['failed', 'partial_failed', 'recoverable', 'precheck_blocked'])
const CANCELLABLE_GROUPS = new Set([
  INSTALL_TASK_STATE_GROUP.ACTIVE,
  INSTALL_TASK_STATE_GROUP.ATTENTION
])
const DELETE_ALWAYS_STATES = new Set([
  'completed',
  'completed_with_warning',
  'cancelled',
  'failed',
  'partial_failed'
])

function normalizeState(state = '') {
  return String(state ?? '').trim().toLowerCase()
}

function createPolicyError(code, message, detail = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, detail)
  return error
}

function hasDownloadContext(task = {}) {
  if (task?.hasDownload === true || task?.downloadTaskId || task?.download_task_id) return true
  if (Array.isArray(task?.artifacts)) {
    return task.artifacts.some((artifact) => artifact?.download_task_id || artifact?.file_path)
  }
  return false
}

export function classifyInstallTaskState(state = '') {
  const normalized = normalizeState(state)
  const policy = STATE_POLICY[normalized]
  if (!policy) {
    throw createPolicyError(
      'unknown_install_task_state',
      `未覆盖的安装任务状态：${normalized || '(empty)'}`,
      { state: normalized }
    )
  }
  return policy.group
}

export function getInstallTaskStatePresentation(state = '') {
  const normalized = normalizeState(state)
  const policy = STATE_POLICY[normalized]
  if (!policy) {
    classifyInstallTaskState(normalized)
  }
  return Object.freeze({
    state: normalized,
    group: policy.group,
    label: policy.label,
    tone: policy.tone,
    attention: [INSTALL_TASK_STATE_GROUP.ATTENTION, INSTALL_TASK_STATE_GROUP.FAILED].includes(
      policy.group
    )
  })
}

export function getInstallTaskStatesForGroup(group = '') {
  const normalizedGroup = String(group ?? '').trim().toLowerCase()
  if (!Object.values(INSTALL_TASK_STATE_GROUP).includes(normalizedGroup)) {
    throw createPolicyError(
      'unknown_install_task_state_group',
      `未知的安装任务分组：${normalizedGroup || '(empty)'}`,
      { group: normalizedGroup }
    )
  }
  return Object.entries(STATE_POLICY)
    .filter(([, policy]) => policy.group === normalizedGroup)
    .map(([state]) => state)
}

export function getAllowedInstallTaskActions(task = {}) {
  const state = normalizeState(task?.state)
  const group = classifyInstallTaskState(state)
  const actions = [INSTALL_TASK_ACTION.COPY_DIAGNOSTICS]

  if (PAUSABLE_STATES.has(state) && task?.canPause !== false) {
    actions.push(INSTALL_TASK_ACTION.PAUSE)
  }
  if (RESUMABLE_STATES.has(state)) {
    actions.push(INSTALL_TASK_ACTION.RESUME)
  }
  if (CANCELLABLE_GROUPS.has(group)) {
    actions.push(INSTALL_TASK_ACTION.CANCEL)
  }
  if (state === 'waiting_user_action') {
    actions.push(INSTALL_TASK_ACTION.AUTHORIZE)
  }
  const failureStage = task.failure_stage || task.failureStage || task.failure?.stage
  if (RETRYABLE_STATES.has(state) && failureStage !== 'unsupported_package') {
    actions.push(INSTALL_TASK_ACTION.RETRY)
  }
  if (DELETE_ALWAYS_STATES.has(state)) {
    actions.push(INSTALL_TASK_ACTION.DELETE)
  }
  if (hasDownloadContext(task)) {
    actions.push(INSTALL_TASK_ACTION.VIEW_DOWNLOAD)
  }

  return actions
}

export function assertInstallTaskActionAllowed(task = {}, action = '') {
  const normalizedAction = String(action ?? '').trim().toLowerCase()
  if (!Object.values(INSTALL_TASK_ACTION).includes(normalizedAction)) {
    throw createPolicyError('task_action_not_allowed', `未知的任务操作：${normalizedAction}`, {
      action: normalizedAction,
      state: normalizeState(task?.state)
    })
  }
  const actions = getAllowedInstallTaskActions(task)
  if (!actions.includes(normalizedAction)) {
    throw createPolicyError('task_action_not_allowed', '当前任务状态不允许执行此操作', {
      action: normalizedAction,
      state: normalizeState(task?.state),
      allowedActions: actions
    })
  }
  return true
}

function normalizeStateCounts(tasksOrCounts) {
  const counts = {}
  if (Array.isArray(tasksOrCounts)) {
    tasksOrCounts.forEach((item) => {
      const state = normalizeState(typeof item === 'string' ? item : item?.state)
      classifyInstallTaskState(state)
      counts[state] = Number(counts[state] || 0) + 1
    })
    return counts
  }

  const source =
    tasksOrCounts?.byState && typeof tasksOrCounts.byState === 'object'
      ? tasksOrCounts.byState
      : tasksOrCounts && typeof tasksOrCounts === 'object'
        ? tasksOrCounts
        : {}
  Object.entries(source).forEach(([state, count]) => {
    const normalized = normalizeState(state)
    classifyInstallTaskState(normalized)
    counts[normalized] = Math.max(0, Number(count || 0))
  })
  return counts
}

export function summarizeInstallTaskStates(tasksOrCounts = []) {
  const byState = normalizeStateCounts(tasksOrCounts)
  const summary = {
    total: 0,
    activeCount: 0,
    attentionCount: 0,
    failedCount: 0,
    historyCount: 0,
    badgeCount: 0,
    byState
  }

  Object.entries(byState).forEach(([state, count]) => {
    const group = classifyInstallTaskState(state)
    const safeCount = Math.max(0, Number(count || 0))
    summary.total += safeCount
    if (group === INSTALL_TASK_STATE_GROUP.ACTIVE) summary.activeCount += safeCount
    if (group === INSTALL_TASK_STATE_GROUP.ATTENTION) summary.attentionCount += safeCount
    if (group === INSTALL_TASK_STATE_GROUP.FAILED) summary.failedCount += safeCount
    if ([INSTALL_TASK_STATE_GROUP.COMPLETED, INSTALL_TASK_STATE_GROUP.CANCELLED].includes(group)) {
      summary.historyCount += safeCount
    }
  })
  summary.badgeCount = summary.activeCount + summary.attentionCount + summary.failedCount
  return summary
}
