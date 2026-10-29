// 任务阶段与列表主操作：纯前端推导，不读写主进程。阶段规则见 Vertex 项目文档《安装任务中心 UI 重设计方案》5.2。

export const TASK_STAGE_KEYS = Object.freeze([
  'precheck',
  'download',
  'inspect',
  'plan',
  'deploy',
  'verify'
])

const FINISHED_STAGE = TASK_STAGE_KEYS.length

const ITEM_STATE_STAGE = Object.freeze({
  created: 0,
  prechecking: 0,
  precheck_blocked: 0,
  waiting_dependency: 1,
  waiting_authorization: 1,
  authenticating: 1,
  waiting_artifact: 1,
  downloading: 1,
  downloaded: 1,
  inspecting_archive: 2,
  previewing: 3,
  waiting: 3,
  waiting_install: 4,
  installing: 4,
  deploying: 4,
  recording: 4,
  health_checking: 5,
  installed: FINISHED_STAGE,
  skipped_installed: FINISHED_STAGE,
  skipped: FINISHED_STAGE,
  completed: FINISHED_STAGE
})

const JOB_STATE_STAGE = Object.freeze({
  created: 0,
  prechecking: 0,
  precheck_blocked: 0,
  resolving: 1,
  queued: 1,
  downloading: 1,
  downloaded: 2,
  waiting_user_action: 1,
  previewing: 3,
  installing: 4,
  health_checking: 5,
  completed: FINISHED_STAGE,
  completed_with_warning: FINISHED_STAGE
})

const FAILURE_STAGE_INDEX = Object.freeze({
  download_failed: 1,
  archive_inspect_failed: 2,
  rule_compile_failed: 3,
  rule_missed: 3,
  unsupported_package: 3,
  target_invalid: 3,
  path_unsafe: 3,
  dependency_missing: 3,
  dependency_failed: 3,
  conflict_detected: 3,
  deploy_failed: 4,
  record_failed: 4,
  health_check_failed: 5
})

const RULE_FAILURE_STAGES = new Set(['rule_missed', 'rule_compile_failed', 'unsupported_package'])

function text(value = '') {
  return String(value ?? '').trim()
}

export function getPendingComponentItems(detail = {}) {
  return (Array.isArray(detail?.items) ? detail.items : []).filter(
    (item) => item?.metadata?.selectionRequest
  )
}

function isDownloadOnly(items = []) {
  return items.length > 0 && items.every((item) => text(item?.state) === 'file_ready')
}

function resolveCurrentIndex(task = {}, items = []) {
  const failureStage = text(task.failureStage || task.raw?.failure_stage || task.raw?.failureStage)
  if (task.stateGroup === 'failed' && failureStage in FAILURE_STAGE_INDEX) {
    return FAILURE_STAGE_INDEX[failureStage]
  }
  const itemIndexes = items
    .map((item) => ITEM_STATE_STAGE[text(item?.state)])
    .filter((index) => Number.isInteger(index))
  const unfinished = itemIndexes.filter((index) => index < FINISHED_STAGE)
  if (unfinished.length) return Math.min(...unfinished)
  const jobIndex = JOB_STATE_STAGE[text(task.state)]
  if (Number.isInteger(jobIndex)) return jobIndex
  if (itemIndexes.length) return Math.min(...itemIndexes)
  return 0
}

/**
 * 返回 [{ key, status }]，status 为 done / current / waiting / error / todo。
 * 只下载不安装的任务（全部任务项为 file_ready）只返回前两个阶段。
 */
export function deriveTaskStages(task = {}, detail = {}) {
  const items = Array.isArray(detail?.items) ? detail.items : []
  const keys = isDownloadOnly(items) ? TASK_STAGE_KEYS.slice(0, 2) : TASK_STAGE_KEYS
  if (task.kind === 'legacy') return keys.map((key) => ({ key, status: 'todo' }))

  const group = text(task.stateGroup)
  if (group === 'completed' || isDownloadOnly(items)) {
    return keys.map((key) => ({ key, status: 'done' }))
  }

  const currentIndex = Math.min(resolveCurrentIndex(task, items), keys.length - 1)
  const currentStatus =
    group === 'failed'
      ? 'error'
      : group === 'attention'
        ? 'waiting'
        : group === 'cancelled'
          ? 'todo'
          : 'current'
  return keys.map((key, index) => ({
    key,
    status: index < currentIndex ? 'done' : index === currentIndex ? currentStatus : 'todo'
  }))
}

/** 列表行的唯一主操作。返回 view 表示打开详情处理。 */
export function resolveTaskRowAction(task = {}) {
  const actions = Array.isArray(task.actions) ? task.actions : []
  if (task.kind === 'source' && RULE_FAILURE_STAGES.has(text(task.failureStage))) return 'handle'
  const control = ['authorize', 'legacy_open', 'resume', 'retry'].find((action) =>
    actions.includes(action)
  )
  if (control) return control
  if (task.stateGroup === 'attention' || task.stateGroup === 'failed') return 'handle'
  return ''
}

/** 列表和详情使用的状态文案键：等待授权、选择组件等按详情细分。 */
export function resolveTaskStateKey(task = {}, detail = {}) {
  if (task.kind === 'legacy') return 'legacy'
  const state = text(task.stateKey || task.state)
  if (getPendingComponentItems(detail).length) return 'selecting'
  return state || 'unknown'
}

export function resolveTaskTone(task = {}) {
  if (task.kind === 'legacy') return 'muted'
  if (task.state === 'queued') return 'muted'
  if (task.state === 'completed_with_warning') return 'warning'
  return (
    {
      active: 'info',
      attention: 'warning',
      failed: 'danger',
      completed: 'success',
      cancelled: 'muted'
    }[task.stateGroup] || 'info'
  )
}
