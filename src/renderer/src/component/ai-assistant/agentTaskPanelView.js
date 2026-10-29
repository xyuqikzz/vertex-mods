import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
const FAILURE_STAGE_LABELS = Object.freeze({
  get download_failed() { return uiText('ui.downloadFailed') },
  get archive_inspect_failed() { return uiText('ui.archiveInspectionFailed') },
  get rule_compile_failed() { return uiText('ui.ruleCompilationFailed') },
  get rule_missed() { return uiText('ui.noInstallationRuleMatched') },
  get unsupported_package() { return uiText('ui.thisFileDoesNotSupportAutomaticInstallation') },
  get path_unsafe() { return uiText('ui.unsafePath') },
  get target_invalid() { return uiText('ui.invalidInstallationTarget') },
  get dependency_failed() { return uiText('ui.dependencyInstallationFailed') },
  get dependency_missing() { return uiText('ui.missingDependencies') },
  get conflict_detected() { return uiText('ui.conflictDetected') },
  get record_failed() { return uiText('ui.couldNotWriteRecord') },
  get health_check_failed() { return uiText('ui.postInstallationVerificationFailed') },
  get deploy_failed() { return uiText('ui.deploymentFailed') },
  get task_recovery_required() { return uiText('ui.taskRecoveryRequired') },
  get unknown_failed() { return uiText('ui.unknownFailure') }
})

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function firstText(...values) {
  const matchedValue = values.find((value) => toSafeText(value))
  return toSafeText(matchedValue)
}

function toPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function hasObjectValue(value = {}) {
  return Object.keys(toPlainObject(value)).length > 0
}

function toArray(value = []) {
  return Array.isArray(value) ? value : []
}

function pickNumber(source = {}, keys = []) {
  const target = toPlainObject(source)
  const key = keys.find((item) => {
    const value = target[item]
    return value !== undefined && value !== null && String(value).trim() !== ''
  })
  return key ? toSafeNumber(target[key], 0) : null
}

function hasSummaryValue(summary = {}) {
  return [
    'totalCount',
    'itemCount',
    'successCount',
    'installedCount',
    'completedCount',
    'skippedCount',
    'skipCount',
    'failedCount'
  ].some((key) => pickNumber(summary, [key]) !== null)
}

function aggregateInstallItems(items = []) {
  const summary = {
    totalCount: 0,
    successCount: 0,
    skippedCount: 0,
    failedCount: 0
  }
  toArray(items).forEach((item) => {
    const state = toSafeText(item?.state)
    if (!state) return
    summary.totalCount += 1
    if (['installed', 'completed', 'completed_with_warning'].includes(state)) {
      summary.successCount += 1
      return
    }
    if (['skipped_installed', 'skipped', 'already_installed', 'reused'].includes(state)) {
      summary.skippedCount += 1
      return
    }
    if (['failed', 'precheck_blocked', 'cancelled'].includes(state)) {
      summary.failedCount += 1
    }
  })
  return summary
}

function resolveSourceInstallJob(task = {}) {
  return (
    [task.sourceInstallJob, task?.result?.sourceInstallJob, task?.plan?.sourceInstallJob]
      .map((item) => toPlainObject(item))
      .find((item) => hasObjectValue(item)) || {}
  )
}

function resolveInstallSummarySource(task = {}) {
  return [
    task?.result?.installSummary,
    task?.result?.summary,
    task?.result?.sourceInstallJob?.installSummary,
    task?.sourceInstallJob?.installSummary,
    task?.plan?.installSummary
  ]
    .map((item) => toPlainObject(item))
    .find((item) => hasSummaryValue(item))
}

function resolveInstallItems(task = {}) {
  return [
    task?.result?.sourceInstallJob?.items,
    task?.sourceInstallJob?.items,
    task?.result?.items,
    task?.plan?.items
  ].find((items) => Array.isArray(items)) || []
}

function resolveWinnerChangeInfo(task = {}) {
  const sources = [
    task?.result,
    task?.plan,
    task?.result?.installSummary,
    task?.result?.summary,
    task?.result?.conflictAnalysis,
    task?.result?.conflictResult,
    task?.result?.conflict,
    task?.plan?.conflictAnalysis,
    task?.plan?.conflictResult,
    task?.plan?.conflict
  ].map((item) => toPlainObject(item))

  const numberSource = sources.find(
    (item) =>
      pickNumber(item, [
        'candidateWinnerChangeCount',
        'winnerChangeCount',
        'winnerChangesCount',
        'reconcileWinnerChangeCount',
        'reconcileWinnerChangesCount'
      ]) !== null
  )
  if (numberSource) {
    return {
      available: true,
      count: pickNumber(numberSource, [
        'candidateWinnerChangeCount',
        'winnerChangeCount',
        'winnerChangesCount',
        'reconcileWinnerChangeCount',
        'reconcileWinnerChangesCount'
      ])
    }
  }

  const arraySource = sources.find(
    (item) =>
      Array.isArray(item.candidateWinnerChanges) ||
      Array.isArray(item.winnerChanges) ||
      Array.isArray(item.reconcileWinnerChanges)
  )
  if (arraySource) {
    return {
      available: true,
      count: toArray(
        arraySource.candidateWinnerChanges ||
          arraySource.winnerChanges ||
          arraySource.reconcileWinnerChanges
      ).length
    }
  }

  return {
    available: false,
    count: 0
  }
}

function resolvePostRollbackSource(task = {}) {
  return (
    [
      task?.result?.rollbackResult?.postRollback,
      task?.result?.postRollback,
      task?.rollbackResult?.postRollback,
      task?.plan?.postRollback
    ]
      .map((item) => toPlainObject(item))
      .find((item) => hasObjectValue(item)) || {}
  )
}

function flattenPostRollbackRepairActions(actions = [], key = '') {
  return toArray(actions)
    .flatMap((action) => toArray(toPlainObject(action)[key]))
    .filter((action) => hasObjectValue(action))
}

function resolveRepairActionType(action = {}) {
  const safeAction = toPlainObject(action)
  const executionPayload = toPlainObject(safeAction.executionPayload)
  return firstText(executionPayload.actionType, safeAction.actionType, safeAction.type)
}

function getPostRollbackActionLabel(action = {}) {
  const safeAction = toPlainObject(action)
  const actionType = resolveRepairActionType(safeAction)
  const labelMap = {
    get domain_rebuild() { return uiText('ui.rebuildLedger') },
    get uninstall_mod() { return uiText('ui.uninstallRecord') },
    get disable_mod() { return uiText('ui.disableRecord') }
  }
  return firstText(safeAction.shortTitle, safeAction.label, labelMap[actionType], safeAction.title, actionType)
}

function normalizePostRollbackActionItem(action = {}, index = 0, group = '') {
  const safeAction = toPlainObject(action)
  const actionType = resolveRepairActionType(safeAction)
  if (!actionType) return null
  const label = getPostRollbackActionLabel(safeAction)
  return {
    id: firstText(safeAction.id, `post-rollback-${group || 'action'}-${index}-${actionType}`),
    group,
    actionType,
    label,
    title: firstText(safeAction.title, label),
    message: firstText(safeAction.message, safeAction.reason),
    action: safeAction
  }
}

export function resolveTaskPostRollbackFollowup(task = {}) {
  const postRollback = resolvePostRollbackSource(task)
  if (!hasObjectValue(postRollback)) {
    return {
      available: false,
      requiresLedgerRebuild: false,
      requiresInstalledModCleanup: false,
      scopeCount: 0,
      repairActions: [],
      cleanupOptions: [],
      pendingActionCount: 0
    }
  }

  const actions = toArray(postRollback.actions)
  const repairActions = flattenPostRollbackRepairActions(actions, 'repairActions')
  const cleanupOptions = flattenPostRollbackRepairActions(actions, 'repairOptions')
  const scopes = toArray(postRollback.scopes)
  const requiresLedgerRebuild =
    postRollback.requiresLedgerRebuild === true ||
    actions.some((action) => toSafeText(action?.type) === 'rebuild_deploy_ledger')
  const requiresInstalledModCleanup =
    postRollback.requiresInstalledModCleanup === true ||
    actions.some((action) => toSafeText(action?.type) === 'cleanup_installed_mod')

  return {
    available: true,
    requiresLedgerRebuild,
    requiresInstalledModCleanup,
    scopeCount: scopes.length || repairActions.length,
    repairActions,
    cleanupOptions,
    pendingActionCount: repairActions.length + cleanupOptions.length
  }
}

export function resolveTaskPostRollbackSummary(task = {}) {
  const followup = resolveTaskPostRollbackFollowup(task)
  if (!followup.available) return ''

  const parts = []
  if (followup.requiresInstalledModCleanup) {
    parts.push(
      followup.cleanupOptions.length
        ? uiText('ui.modRecordsNeedAttentionValueOptions', { value1: (followup.cleanupOptions.length) })
        : '模组记录待处理'
    )
  }
  if (followup.requiresLedgerRebuild) {
    parts.push(
      followup.scopeCount > 0
        ? uiText('ui.ledgerRebuildPendingValueDeploymentScopes', { value1: (followup.scopeCount) })
        : '账本待重建（缺少部署域）'
    )
  }
  if (followup.pendingActionCount > 0) {
    parts.push(uiText('ui.actionsAvailableForConfirmationValue', { value1: (followup.pendingActionCount) }))
  }

  return parts.length ? uiText('ui.afterRollbackValue', { value1: (parts.join('，')) }) : ''
}

export function resolveTaskPostRollbackActionItems(task = {}) {
  const followup = resolveTaskPostRollbackFollowup(task)
  if (!followup.available) return []
  return [
    ...followup.cleanupOptions.map((action, index) =>
      normalizePostRollbackActionItem(action, index, 'cleanup')
    ),
    ...followup.repairActions.map((action, index) =>
      normalizePostRollbackActionItem(action, index, 'repair')
    )
  ].filter(Boolean)
}

const CONVERSATION_ONLY_TASK_TYPES = Object.freeze(new Set(['analyze']))

const INSTALL_FLOW_TASK_TYPES = Object.freeze(
  new Set(['install_preflight', 'conflict_repair', 'rollback'])
)

const TERMINAL_TASK_STAGES = Object.freeze(
  new Set(['completed', 'failed', 'cancelled', 'rolled_back'])
)

function isTerminalTaskStage(stage = '') {
  return TERMINAL_TASK_STAGES.has(toSafeText(stage))
}

export function isInstallRelatedAgentTask(task = {}) {
  const type = toSafeText(task.type)

  if (CONVERSATION_ONLY_TASK_TYPES.has(type)) {
    return false
  }

  if (resolveTaskLinkedJobId(task)) {
    return true
  }

  if (INSTALL_FLOW_TASK_TYPES.has(type)) {
    return !isTerminalTaskStage(task.stage)
  }

  const sourceJob = resolveSourceInstallJob(task)
  return Boolean(toSafeText(sourceJob.jobId || sourceJob.job_id))
}

export function filterInstallRelatedAgentTasks(tasks = []) {
  return toArray(tasks).filter((task) => isInstallRelatedAgentTask(task))
}

export function resolveTaskId(task = {}) {
  return firstText(task.taskId, task.task_id, task.agentTaskId, task.agent_task_id)
}

export function resolveTaskLinkedJobId(task = {}) {
  return firstText(
    task.linkedJobId,
    task.linked_job_id,
    task.jobId,
    task.job_id,
    task?.sourceInstallJob?.jobId,
    task?.sourceInstallJob?.job_id,
    task?.result?.linkedJobId,
    task?.result?.linked_job_id,
    task?.result?.jobId,
    task?.result?.job_id,
    task?.result?.sourceInstallJob?.jobId,
    task?.plan?.linkedJobId,
    task?.plan?.linked_job_id,
    task?.plan?.jobId,
    task?.plan?.job_id
  )
}

export function resolveTaskFailureStage(task = {}) {
  return firstText(
    task.errorCode,
    task.error_code,
    task.failureStage,
    task.failure_stage,
    task?.sourceInstallJob?.failureStage,
    task?.sourceInstallJob?.failure_stage,
    task?.result?.failureStage,
    task?.result?.failure_stage,
    task?.result?.failure?.stage,
    task?.plan?.failureStage,
    task?.plan?.failure_stage
  )
}

export function resolveTaskErrorMessage(task = {}) {
  return firstText(
    task.errorMessage,
    task.error_message,
    task?.sourceInstallJob?.errorMessage,
    task?.sourceInstallJob?.error_message,
    task?.result?.errorMessage,
    task?.result?.error_message,
    task?.result?.failure?.message,
    task?.plan?.errorMessage,
    task?.plan?.error_message
  )
}

export function formatTaskFailureStage(stage = '') {
  const safeStage = toSafeText(stage)
  return FAILURE_STAGE_LABELS[safeStage] || safeStage
}

export function resolveTaskFailureSummary(task = {}) {
  const stage = resolveTaskFailureStage(task)
  const label = formatTaskFailureStage(stage)
  const userAction = firstText(task?.result?.failure?.userAction, task?.sourceInstallJob?.userAction)
  if (!label && !userAction) {
    return ''
  }
  return ['失败分类：' + (label || '未分类'), userAction ? uiText('ui.suggestionValue', { value1: (userAction) }) : '']
    .filter(Boolean)
    .join('；')
}

export function resolveTaskInstallSummary(task = {}) {
  const explicitSummary = resolveInstallSummarySource(task)
  const itemSummary = aggregateInstallItems(resolveInstallItems(task))
  const sourceJob = resolveSourceInstallJob(task)
  const sourceItemCount = pickNumber(sourceJob, ['itemCount'])

  return {
    totalCount:
      pickNumber(explicitSummary, ['totalCount', 'itemCount']) ?? sourceItemCount ?? itemSummary.totalCount,
    successCount:
      pickNumber(explicitSummary, ['successCount', 'installedCount', 'completedCount']) ??
      itemSummary.successCount,
    skippedCount:
      pickNumber(explicitSummary, ['skippedCount', 'skipCount']) ?? itemSummary.skippedCount,
    failedCount: pickNumber(explicitSummary, ['failedCount']) ?? itemSummary.failedCount,
    winnerChange: resolveWinnerChangeInfo(task)
  }
}

export function resolveTaskCompletionSummary(task = {}) {
  const stage = toSafeText(task?.stage)
  const sourceState = toSafeText(resolveSourceInstallJob(task)?.state)
  const isCompleted =
    ['completed', 'rolled_back'].includes(stage) ||
    ['completed', 'completed_with_warning'].includes(sourceState)
  if (!isCompleted) return ''

  const summary = resolveTaskInstallSummary(task)
  const hasInstallCount =
    summary.totalCount > 0 ||
    summary.successCount > 0 ||
    summary.skippedCount > 0 ||
    summary.failedCount > 0
  if (!hasInstallCount && !summary.winnerChange.available) return ''

  const parts = []
  if (hasInstallCount) {
    parts.push(uiText('ui.succeededValue', { value1: (summary.successCount) }))
    parts.push(uiText('ui.skippedValue', { value1: (summary.skippedCount) }))
    if (summary.failedCount > 0) {
      parts.push(uiText('ui.failedValue', { value1: (summary.failedCount) }))
    }
  }
  if (summary.winnerChange.available) {
    parts.push(uiText('ui.winnerChangesValue', { value1: (summary.winnerChange.count) }))
  }

  return parts.length ? uiText('ui.installationResultValue', { value1: (parts.join('，')) }) : ''
}

export function canAnalyzeTaskLogs(task = {}) {
  return Boolean(
    String(task?.stage || '').trim() === 'failed' && resolveTaskLinkedJobId(task)
  )
}

export function createTaskLogAnalysisPrompt(task = {}) {
  const taskId = resolveTaskId(task)
  const jobId = resolveTaskLinkedJobId(task)
  const failureStage = resolveTaskFailureStage(task)
  const failureStageLabel = formatTaskFailureStage(failureStage)
  const failureStageText =
    failureStageLabel && failureStageLabel !== failureStage
      ? `${failureStageLabel}（${failureStage}）`
      : failureStage
  const errorMessage = resolveTaskErrorMessage(task)
  const currentTarget = firstText(task.currentTarget, task.current_target, task.type)

  return [
    '请分析这个失败的 Agent 安装任务日志。',
    jobId ? uiText('ui.installationJobIdValue', { value1: (jobId) }) : '',
    taskId ? uiText('ui.agentTaskIdValue', { value1: (taskId) }) : '',
    currentTarget ? uiText('ui.taskValue', { value1: (currentTarget) }) : '',
    failureStage ? uiText('ui.failureCategoryValue', { value1: (failureStageText) }) : '',
    errorMessage ? uiText('ui.errorValue', { value1: (errorMessage) }) : '',
    '请优先调用 vertex.log.analyze 工具读取 source_install_step_log 与 failureClassifier 结果，给出失败原因、疑似模组、关键日志和下一步处理建议。',
    '不要执行重试、回滚或文件修改；如需要回滚，请只说明应使用的一键回滚入口。'
  ]
    .filter(Boolean)
    .join('\n')
}
