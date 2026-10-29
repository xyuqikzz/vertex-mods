import { nativeText } from '../../../services/uiLanguage.js'
import { getRetiredSourceFailure } from '../../../../shared/sources/retired-source-policy.js'
import { assertInstallSourceAvailable } from '../retiredSourceInstallGuard.js'
import fs from 'fs'
import { dialog } from 'electron'
import {
  ARTIFACT_STATE,
  ITEM_STATE,
  JOB_STATE,
  FAILURE_STAGE,
  SOURCE_INSTALL_TASK_ERROR_CODE,
  TERMINAL_ITEM_STATES,
  buildArtifactRecord,
  buildDownloadTaskPayload,
  createId,
  HEALTH_STATUS,
  normalizeCreatePayload,
  PRECHECK_STATUS,
  parseJsonObject,
  toPlainJson,
  toSafeText,
  stringifyJson
} from './contracts.js'
import {
  getArtifactByDownloadTaskId,
  getArtifactByKey,
  getItemsByArtifactKey,
  getJob,
  getJobDetail,
  getPublicJobDetail,
  getJobItems,
  insertItem,
  insertJob,
  listPublicJobs,
  findInstalledModByItem,
  isArtifactFileAvailable,
  parseItemMetadata,
  resetJobForRetry,
  runInTransaction,
  updateArtifact,
  updateItem,
  updateJob,
  upsertArtifact,
  clearCompletedJobs,
  deleteJobsByIds,
  summarizeJobs
} from './taskStore.js'
import { sanitizeSourceInstallTaskPayloadForPersistence } from './taskSecurity.js'
import {
  hasActiveArtifactDownload,
  registerArtifactDownload,
  rejectArtifactDownload,
  resolveArtifactDownload,
  waitForArtifactDownload
} from './artifactRegistry.js'
import {
  cancelSourceInstallDownloadTask,
  createSourceInstallDownloadTask,
  sourceInstallDownloadBridgeEvents
} from './downloadBridge.js'
import { executeInstallItem } from './installExecutor.js'
import { classifyInstallFailure } from './failureClassifier.js'
import { runInstallHealthCheck } from './installHealthCheck.js'
import { runInstallPrecheck } from './precheckRunner.js'
import { reportRuleIssueForFailure } from './ruleIssueReporter.js'
import {
  isItemTransitionIgnorable,
  isJobStopped,
  summarizeJobState
} from './taskStateMachine.js'
import {
  createTaskCancelledError,
  createTaskPausedError,
  isTaskControlError
} from './orchestrator/jobAbortControl.js'
import { sortItems } from './orchestrator/itemOrdering.js'
import { evaluateItemDependencies } from './orchestrator/itemDependencyResolver.js'
import {
  compactChangeSet,
  compactInstallPlan,
  mergeDeployExecutionIntoPlan,
  resolveInstallPlanFromResult,
  resolveReconcileResultFromResult
} from './orchestrator/installResultProjection.js'
import { emitArtifact, emitItem, emitJob, emitLog } from './orchestrator/jobEvents.js'
import {
  assertItemCanProceed,
  assertJobCanProceed,
  assertSourceModpackTaskCanProceed,
  getCurrentItem
} from './orchestrator/jobStateGuards.js'
import {
  buildItemRecord,
  collectReusedInfo,
  normalizeJobTitle
} from './orchestrator/itemRecordFactory.js'
import { cleanupOfflinePackCache } from '../vxpack/offlinePackCache.js'
import { resolveOfflinePackCacheKeyFromPayload } from '../../../../shared/modpacks/offline-pack-contract.js'
import {
  assertInstallTaskActionAllowed,
  INSTALL_TASK_ACTION
} from '../../../../shared/tasks/install-task-center-policy.js'
import { lockModSource } from '../../../services/modSourceFileLock.js'
import { updateModSourceLockState } from '../../../db/mods/mods.js'
import { getSourceModpackInspectionPlan } from '../../../db/mods/sourceModpackInstances.js'
import {
  NEXUS_AUTHORIZATION_ERROR_CODE,
  createNexusAuthorizationTaskService,
  resolveNexusAuthorizationTarget
} from './nexusAuthorizationTask.js'
import {
  registerNexusAuthorizationWaitingSession,
  unregisterNexusAuthorizationSession,
  routeNexusAuthorizationUrl
} from '../../../services/nexusAuthorizationRouter.js'
import { exchangeNexusDownloadLink } from '../../../services/mod-source/runtime.js'
import { nexusAccount, nexusAccountEvents } from '../../../services/nexus/account.js'
import { openNexusDownloadHelper, closeNexusDownloadHelper } from '../../../services/nexus/windows.js'
import { createNexusTaskResumer } from './nexusTaskResumer.js'
import { openWebExternal } from '../../../security/windows.js'

const runningJobMap = new Map()
// PR5/A2：每个正在执行的 job 对应一个 AbortController，取消/暂停时 abort()，
// 让在途阶段（执行安装、等待下载就绪）能在阶段边界尽快停止。
const abortControllerMap = new Map()
const installLockMap = new Map()
const DOWNLOAD_FILE_READY_TIMEOUT_MS = 5000
const DOWNLOAD_FILE_READY_INTERVAL_MS = 50
const transientNexusDownloadUrlMap = new Map()
const resumeNexusJob = createNexusTaskResumer({
  getRunning: (jobId) => runningJobMap.get(jobId),
  canResume: (jobId) => {
    const job = getJob(jobId)
    return job && ![JOB_STATE.CANCELLED, JOB_STATE.PAUSED].includes(job.state) &&
      getJobItems(jobId).some((item) => !TERMINAL_ITEM_STATES.has(item.state) &&
        ![ITEM_STATE.WAITING_AUTHORIZATION, ITEM_STATE.AUTHENTICATING].includes(item.state))
  },
  schedule: (jobId, message) => scheduleRunJob(null, jobId, { source: 'nexus' }, message)
})

const nexusAuthorizationTaskService = createNexusAuthorizationTaskService({
  getJobDetail,
  updateItem,
  updateJob,
  emitLog,
  emitJob,
  registerSession: registerNexusAuthorizationWaitingSession,
  unregisterSession: unregisterNexusAuthorizationSession,
  getCredentialRevision: () => nexusAccount.revision(),
  openHelper: (options) => openNexusDownloadHelper({ ...options,
    onCallback: (url, sessionId) => routeNexusAuthorizationUrl(url, { sessionId }) }),
  closeHelper: closeNexusDownloadHelper,
  openExternal: openWebExternal,
  exchangeDownloadLink: exchangeNexusDownloadLink,
  validateTarget: validateNexusAuthorizationPlanTarget,
  onAuthorized: handleNexusAuthorizedDownload,
  selectLocalFile: selectNexusAuthorizationLocalFile,
  confirmLocalFile: confirmNexusAuthorizationLocalFile,
  onLocalFile: handleNexusAuthorizationLocalFile,
  onSkipped({ job }) {
    const jobId = toSafeText(job?.job_id || job?.jobId)
    if (!jobId) return
    refreshJobSummary(jobId)
    resumeNexusJob(jobId)
  }
})

nexusAccountEvents.on('changed', () => {
  transientNexusDownloadUrlMap.clear()
  void nexusAuthorizationTaskService.closeAllSessions(true)
})

async function protectInstalledModSources(items = []) {
  const protectedModIdSet = new Set()
  const results = []

  for (const item of Array.isArray(items) ? items : []) {
    if (toSafeText(item?.state) === ITEM_STATE.SKIPPED_INSTALLED) continue
    const mod = findInstalledModByItem(item)
    const modId = Number(mod?.id || 0)
    if (!modId || protectedModIdSet.has(modId) || Number(mod?.is_active ?? 0) !== 1) continue
    protectedModIdSet.add(modId)

    try {
      const lockResult = await lockModSource(mod)
      const state = lockResult.success ? 'locked' : 'lock_failed'
      updateModSourceLockState(modId, state)
      results.push({ modId, name: toSafeText(mod?.name), state, lockResult })
    } catch (error) {
      updateModSourceLockState(modId, 'lock_failed')
      results.push({
        modId,
        name: toSafeText(mod?.name),
        state: 'lock_failed',
        lockResult: {
          success: false,
          failures: [
            {
              code: toSafeText(error?.code, 'native_acl_failed'),
              message: toSafeText(error?.message || error)
            }
          ]
        }
      })
    }
  }

  return results
}

function buildTaskControlFailure(code, message, detail = {}) {
  return {
    success: false,
    code,
    reasonCode: code,
    message,
    detail: toPlainJson(detail, {})
  }
}

function getTaskForAction(payload = {}, action = '') {
  const requestedIds =
    action === INSTALL_TASK_ACTION.DELETE && Array.isArray(payload?.jobIds)
      ? payload.jobIds
      : [payload?.jobId || payload?.job_id]
  const jobIds = [...new Set(requestedIds.map((jobId) => toSafeText(jobId)).filter(Boolean))]
  if (!jobIds.length) {
    return {
      error: buildTaskControlFailure('task_not_found', '未指定安装任务')
    }
  }

  const jobs = jobIds.map((jobId) => getJob(jobId))
  const missingIds = jobIds.filter((_jobId, index) => !jobs[index])
  if (missingIds.length) {
    return {
      error: buildTaskControlFailure('task_not_found', '安装任务不存在', { jobIds: missingIds })
    }
  }

  const expectedStates =
    payload?.expectedStates && typeof payload.expectedStates === 'object'
      ? payload.expectedStates
      : {}
  const expectedState = toSafeText(payload?.expectedState || payload?.expected_state)
  const changedJobs = jobs.filter((job) => {
    const expected = toSafeText(expectedStates[job.job_id] || expectedState)
    return expected && expected !== job.state
  })
  if (changedJobs.length) {
    return {
      error: buildTaskControlFailure('task_state_changed', '任务状态已变化，请刷新后重试', {
        jobs: changedJobs.map((job) => ({ jobId: job.job_id, state: job.state }))
      })
    }
  }

  for (const job of jobs) {
    try {
      assertInstallTaskActionAllowed(job, action)
      if ([INSTALL_TASK_ACTION.RETRY, INSTALL_TASK_ACTION.RESUME].includes(action)) {
        assertSourceModpackTaskCanProceed(job)
      }
    } catch (error) {
      const code =
        action === INSTALL_TASK_ACTION.DELETE
          ? 'task_delete_not_terminal'
          : toSafeText(error?.code, 'task_action_not_allowed')
      return {
        error: buildTaskControlFailure(code, toSafeText(error?.message, '当前状态不允许此操作'), {
          jobId: job.job_id,
          state: job.state,
          action,
          allowedActions: error?.allowedActions || []
        })
      }
    }
  }

  return { jobId: jobIds[0], job: jobs[0], jobIds, jobs }
}

// PR5/A2：取消/暂停时中断对应 job 的在途阶段。
function abortRunningJob(jobId, reason) {
  const controller = abortControllerMap.get(toSafeText(jobId))
  if (controller && !controller.signal.aborted) {
    try {
      controller.abort(reason)
    } catch {
      // 忽略 abort 失败，DB 状态仍为权威来源
    }
  }
}

function getJobAbortSignal(jobId = '') {
  const controller = abortControllerMap.get(toSafeText(jobId))
  return controller ? controller.signal : null
}

function createAbortError(reason = null) {
  // 控制原因使用稳定错误码；语言切换不能改变任务状态。
  return reason?.code === SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED
    ? createTaskPausedError(nativeText('installTaskPaused'))
    : createTaskCancelledError(nativeText('installTaskCancelled'))
}

function waitWithAbort(promise, signal = null) {
  if (!promise) return Promise.resolve(null)
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError(signal.reason))

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function markItemSkippedInstalled(item = {}, message = '') {
  updateItemState(item, {
    state: ITEM_STATE.SKIPPED_INSTALLED,
    progress: 100,
    error_message: ''
  })
  if (message) {
    emitLog(item.job_id, item.item_id, 'info', message)
  }
  refreshJobSummary(item.job_id)
}

function updateItemState(item = {}, patch = {}) {
  const nextState = patch?.state
  // PR5/A3：终态保护——已取消的安装项不得被 INSTALLED 等非取消状态覆盖，
  // 避免「执行期间用户取消、执行完成后又写回 INSTALLED」的竞态。
  if (nextState && nextState !== ITEM_STATE.CANCELLED && item.item_id && item.job_id) {
    const current = getCurrentItem(item.job_id, item.item_id, null)
    if (current?.state === ITEM_STATE.CANCELLED) {
      return
    }
  }
  updateItem(item.item_id, patch)
  emitItem(item.item_id)
}

function mergeItemMetadata(item = {}, patch = {}) {
  const metadata = {
    ...parseItemMetadata(item),
    ...toPlainJson(patch, {})
  }
  updateItem(item.item_id, {
    metadata_json: stringifyJson(metadata, '{}')
  })
  emitItem(item.item_id)
}

function buildNexusAuthorizationFailure(error = {}, requiresAuthorization = false) {
  const status = Number(error?.status || error?.response?.status || 0)
  let code = toSafeText(error?.code)
  let message = toSafeText(error?.message)
  if (requiresAuthorization || status === 403) {
    code = NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED
    message = '需要在 Nexus 网页完成下载授权'
  } else if (status === 400) {
    code = NEXUS_AUTHORIZATION_ERROR_CODE.ACCOUNT_MISMATCH
    message = 'Nexus 账号与 API Key 可能不一致，请检查后重新授权'
  } else if (status === 410) {
    code = NEXUS_AUTHORIZATION_ERROR_CODE.EXPIRED
    message = 'Nexus 下载授权已过期，请重新打开文件页'
  } else if (status === 401 || code === NEXUS_AUTHORIZATION_ERROR_CODE.API_KEY_INVALID) {
    code = NEXUS_AUTHORIZATION_ERROR_CODE.API_KEY_INVALID
    message = message || 'Nexus API Key 无效或未配置'
  } else {
    code = NEXUS_AUTHORIZATION_ERROR_CODE.EXCHANGE_FAILED
    message = message || 'Nexus 下载地址获取失败，请稍后重试'
  }
  return {
    code,
    stage: 'nexus_authorization',
    message,
    userAction: '请在任务中心点击“继续授权”',
    recoverable: true
  }
}

function validateNexusAuthorizationPlanTarget({ item = {}, target = {} } = {}) {
  const metadata = parseItemMetadata(item)
  const installPayload = metadata.installPayload || {}
  const planToken = toSafeText(installPayload.sourceModpackPlanToken)
  if (!planToken) return true
  const record = getSourceModpackInspectionPlan(planToken)
  const itemKey = toSafeText(installPayload.sourceModpackItemKey)
  const expectedHash = toSafeText(installPayload.canonicalItemHash)
  const canonicalItems = Array.isArray(record?.plan?.canonicalPlan?.items)
    ? record.plan.canonicalPlan.items
    : []
  const canonicalItem = canonicalItems.find((entry) => toSafeText(entry?.itemKey) === itemKey)
  const revisionExpired = !record || Date.parse(record.expires_at || '') <= Date.now()
  const identityChanged =
    !canonicalItem ||
    (expectedHash && toSafeText(canonicalItem.canonicalItemHash) !== expectedHash) ||
    toSafeText(canonicalItem.sourceGameSlug).toLowerCase() !==
      toSafeText(target.gameDomain).toLowerCase() ||
    Number(canonicalItem.sourceModId || 0) !== Number(target.modId || 0) ||
    Number(canonicalItem.sourceFileId || 0) !== Number(target.fileId || 0)
  if (revisionExpired || identityChanged) {
    const error = new Error('整合包远程修订或 Nexus 文件身份已变化，请重新预检并确认安装计划。')
    error.code = 'manifest_revision_changed'
    throw error
  }
  return true
}

function markItemWaitingNexusAuthorization(item = {}, error = null, options = {}) {
  const target = resolveNexusAuthorizationTarget(item)
  if (!target) return null
  const failure = buildNexusAuthorizationFailure(
    error || { code: NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED },
    options.requiresAuthorization !== false
  )
  updateItemState(item, {
    state: ITEM_STATE.WAITING_AUTHORIZATION,
    progress: Math.max(0, Number(item.progress || 0)),
    error_message: failure.message,
    failure_stage: failure.code,
    failure_json: stringifyJson(failure, '{}')
  })
  const metadata = parseItemMetadata(item)
  mergeItemMetadata(item, {
    nexusAuthorization: target,
    nexusAuthorizationState: {
      ...(metadata.nexusAuthorizationState || {}),
      message: failure.message,
      lastAttemptAt: new Date().toISOString()
    }
  })
  emitLog(item.job_id, item.item_id, 'info', failure.message, {
    stage: 'nexus_authorization',
    code: failure.code,
    target
  })
  return failure
}

async function prepareNexusDownloadSources(jobId = '') {
  const items = getJobItems(jobId)
  for (const item of items) {
    if (
      [
        ITEM_STATE.WAITING_AUTHORIZATION,
        ITEM_STATE.AUTHENTICATING,
        ITEM_STATE.FILE_READY,
        ITEM_STATE.INSTALLED,
        ITEM_STATE.SKIPPED_INSTALLED,
        ITEM_STATE.SKIPPED,
        ITEM_STATE.CANCELLED
      ].includes(item.state)
    ) {
      continue
    }
    const target = resolveNexusAuthorizationTarget(item)
    const artifact = getArtifactByKey(item.artifact_key)
    if (!target || !artifact || isArtifactFileAvailable(artifact)) continue
    if (transientNexusDownloadUrlMap.has(item.artifact_key)) continue
    try {
      const result = await exchangeNexusDownloadLink({ target })
      assertItemCanProceed(jobId, item.item_id, item)
      const downloadUrl = toSafeText(result?.downloadUrl)
      if (!downloadUrl) throw new Error('Nexus 未返回可用下载地址')
      transientNexusDownloadUrlMap.set(item.artifact_key, downloadUrl)
    } catch (error) {
      if (getJob(jobId)?.state === JOB_STATE.CANCELLED) continue
      markItemWaitingNexusAuthorization(item, error, {
        requiresAuthorization: Number(error?.status || error?.response?.status || 0) === 403
      })
    }
  }
  return refreshJobSummary(jobId)
}

async function handleNexusAuthorizedDownload({ job = {}, item = {}, downloadUrl = '' } = {}) {
  const jobId = toSafeText(job?.job_id || item?.job_id)
  const itemId = toSafeText(item?.item_id)
  const artifactKey = toSafeText(item?.artifact_key)
  const safeDownloadUrl = toSafeText(downloadUrl)
  if (!jobId || !itemId || !artifactKey || !safeDownloadUrl) {
    throw new Error('Nexus 授权下载缺少任务上下文')
  }
  const currentJob = getJob(jobId)
  if (!currentJob || currentJob.state === JOB_STATE.CANCELLED) {
    throw createTaskCancelledError('安装任务已取消')
  }
  const paused = currentJob.state === JOB_STATE.PAUSED
  const artifact = getArtifactByKey(artifactKey)
  const reuseArtifact = artifact && (hasActiveArtifactDownload(artifactKey) || isArtifactFileAvailable(artifact))
  if (!reuseArtifact) {
    transientNexusDownloadUrlMap.set(artifactKey, safeDownloadUrl)
    updateArtifactState(artifactKey, {
      state: ARTIFACT_STATE.CREATED,
      download_url: '',
      error_message: ''
    })
  }
  updateItemState(item, {
    state: ITEM_STATE.CREATED,
    progress: Math.max(0, Number(item.progress || 0)),
    error_message: '',
    failure_stage: '',
    failure_json: '{}'
  })
  updateJob(jobId, {
    state: paused ? JOB_STATE.PAUSED : JOB_STATE.QUEUED,
    current_step: paused ? '已暂停，授权已接收' : '授权完成，准备下载',
    error_message: '',
    failure_stage: '',
    failure_json: '{}'
  })
  emitJob(jobId)
  resumeNexusJob(jobId)
  return { success: true, duplicated: Boolean(reuseArtifact), paused }
}

async function selectNexusAuthorizationLocalFile() {
  const result = await dialog.showOpenDialog({
    title: nativeText('selectNexusFile'),
    properties: ['openFile'],
    filters: [
      { name: nativeText('modArchives'), extensions: ['zip', '7z', 'rar'] },
      { name: nativeText('allFiles'), extensions: ['*'] }
    ]
  })
  const filePath = toSafeText(result?.filePaths?.[0])
  if (result?.canceled || !filePath) return { canceled: true }
  const stats = fs.statSync(filePath)
  if (!stats.isFile() || stats.size <= 0) throw new Error('请选择非空的模组压缩包文件')
  return {
    canceled: false,
    file: {
      path: filePath,
      name: filePath.split(/[\\/]/).pop() || '',
      size: Number(stats.size || 0),
      mtimeMs: stats.mtimeMs
    }
  }
}

async function confirmNexusAuthorizationLocalFile({ file, target }) {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: nativeText('confirmNexusFile'),
    message: nativeText('partialMatch'),
    detail: nativeText('nexusFileDetail', { target: target.fileName, version: target.fileVersion || nativeText('notProvided'), modId: target.modId, fileId: target.fileId, targetSize: target.fileSize || nativeText('unknown'), approximate: target.fileSizeExact === false ? nativeText('approximate') : '', file: file.name, size: file.size }),
    buttons: [nativeText('cancel'), nativeText('useFile')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return result.response === 1
}

async function handleNexusAuthorizationLocalFile({ job = {}, item = {}, file = {}, validation = {} } = {}) {
  const jobId = toSafeText(job?.job_id || item?.job_id)
  const filePath = toSafeText(file?.path)
  if (!jobId || !item?.item_id || !item?.artifact_key || !filePath || !fs.existsSync(filePath)) {
    throw new Error('选择的 Nexus 本地文件不存在')
  }
  const currentJob = getJob(jobId)
  if (!currentJob || currentJob.state === JOB_STATE.CANCELLED) throw createTaskCancelledError()
  if (currentJob.state === JOB_STATE.PAUSED) throw createTaskPausedError()
  const stats = fs.statSync(filePath)
  if (!stats.isFile() || stats.size !== file.size ||
    (file.mtimeMs !== undefined && stats.mtimeMs !== file.mtimeMs)) {
    throw new Error('所选文件在确认期间发生变化，请重新选择')
  }
  transientNexusDownloadUrlMap.delete(item.artifact_key)
  updateArtifactState(item.artifact_key, {
    state: ARTIFACT_STATE.DOWNLOADED,
    file_path: filePath,
    file_size: Number(file?.size || 0),
    download_url: '',
    error_message: ''
  })
  mergeItemMetadata(item, {
    nexusManualFile: {
      path: filePath,
      name: toSafeText(file?.name),
      size: Number(file?.size || 0),
      validation: toPlainJson(validation, {})
    }
  })
  updateItemState(item, {
    state: ITEM_STATE.CREATED,
    progress: Math.max(65, Number(item.progress || 0)),
    error_message: '',
    failure_stage: '',
    failure_json: '{}'
  })
  updateJob(jobId, {
    state: JOB_STATE.QUEUED,
    current_step: '本地文件已确认，准备继续',
    error_message: '',
    failure_stage: '',
    failure_json: '{}'
  })
  emitLog(jobId, item.item_id, 'info', '已选择并校验 Nexus 本地文件', {
    stage: 'nexus_authorization',
    target: resolveNexusAuthorizationTarget(item),
    validation: toPlainJson(validation, {})
  })
  emitJob(jobId)
  resumeNexusJob(jobId, '选择本地文件后继续任务失败')
  return { success: true }
}

function isNexusAuthorizationWaitingError(error = {}) {
  return toSafeText(error?.code) === NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED
}

function isDownloadOnlyItem(item = {}) {
  const metadata = parseItemMetadata(item)
  const entry = metadata?.entry || {}
  const task = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  return toSafeText(
    metadata.purpose || metadata.downloadPurpose || task.downloadPurpose
  ).toLowerCase() === 'download_only'
}

function persistInstallPlanSnapshot(item = {}, installResult = {}) {
  const plan = resolveInstallPlanFromResult(installResult)
  if (!plan || typeof plan !== 'object' || !Object.keys(plan).length) {
    return
  }
  const transaction = plan.transactionPlan || plan.transaction || {}
  const reconcileResult = resolveReconcileResultFromResult(installResult)
  const planSnapshot = mergeDeployExecutionIntoPlan(plan, reconcileResult)
  const transactionId = toSafeText(
    reconcileResult.transactionId ||
      reconcileResult.deployTransactionId ||
      transaction.transactionId
  )
  const transactionStatus = toSafeText(
    reconcileResult.success === false
      ? reconcileResult.status || 'rolled_back'
      : reconcileResult.success === true
        ? reconcileResult.status || 'completed'
        : transaction.state || 'prepared'
  )
  const rollbackStatus = toSafeText(
    reconcileResult.success === false
      ? 'rolled_back'
      : reconcileResult.status === 'rolled_back'
        ? 'rolled_back'
        : transaction.rollbackPolicy
          ? 'available'
          : 'none'
  )
  updateItem(item.item_id, {
    install_plan_json: stringifyJson(compactInstallPlan(planSnapshot), '{}'),
    conflict_json: stringifyJson(planSnapshot.conflictResult || {}, '{}'),
    change_set_json: stringifyJson(compactChangeSet(planSnapshot.changeSet || {}), '{}'),
    transaction_id: transactionId,
    transaction_status: transactionStatus,
    rollback_status: rollbackStatus,
    rollback_error:
      reconcileResult.success === false
        ? toSafeText(reconcileResult.message || '部署失败，已回滚')
        : ''
  })
  emitItem(item.item_id)
}

function updateArtifactState(artifactKey = '', patch = {}) {
  updateArtifact(artifactKey, patch)
  emitArtifact(artifactKey)
}

function refreshJobSummary(jobId = '') {
  const items = getJobItems(jobId)
  const summary = summarizeJobState(items)
  const currentJob = getJob(jobId)
  if (currentJob?.state === JOB_STATE.PAUSED) {
    updateJob(jobId, {
      state: JOB_STATE.PAUSED,
      progress: summary.progress,
      current_step: '已暂停'
    })
    return emitJob(jobId)
  }
  if (currentJob?.state === JOB_STATE.CANCELLED && summary.state !== JOB_STATE.COMPLETED) {
    updateJob(jobId, {
      state: JOB_STATE.CANCELLED,
      progress: summary.progress,
      current_step: '任务已取消'
    })
    return emitJob(jobId)
  }
  updateJob(jobId, {
    state: summary.state,
    progress: summary.progress,
    current_step: summary.currentStep
  })
  if (summary.state === JOB_STATE.COMPLETED) {
    return getJobDetail(jobId)
  }
  return emitJob(jobId)
}

function updateJobFailure(job = {}, failure = {}, currentStep = '安装任务失败') {
  updateJob(job.job_id || job.jobId, {
    state: failure.recoverable ? JOB_STATE.RECOVERABLE : JOB_STATE.FAILED,
    current_step: currentStep,
    error_message: failure.message,
    failure_stage: failure.stage,
    failure_json: stringifyJson(failure, '{}')
  })
}

function updateItemFailure(item = {}, failure = {}) {
  updateItemState(item, {
    state: ITEM_STATE.FAILED,
    progress: 100,
    error_message: failure.message,
    failure_stage: failure.stage,
    failure_json: stringifyJson(failure, '{}')
  })
}

function buildPrecheckBlockedFailure(precheck = {}, context = {}) {
  const firstBlocker = Array.isArray(precheck.blockers) ? precheck.blockers[0] : null
  return classifyInstallFailure(new Error(firstBlocker?.message || '预检发现阻断问题'), {
    ...context,
    stage: firstBlocker?.key?.includes('path_safe') ? 'path_unsafe' : 'target_invalid',
    recoverable: true
  })
}

function attachRuleIssueToFailure(failure = {}, ruleIssue = {}) {
  if (!ruleIssue || ruleIssue.reason === 'not_reportable') {
    return failure
  }
  return {
    ...failure,
    detail: {
      ...(failure.detail || {}),
      ruleIssue: toPlainJson(ruleIssue, {})
    }
  }
}

function updatePrecheckResult(jobId = '', precheck = {}) {
  updateJob(jobId, {
    precheck_status: precheck.status,
    precheck_json: stringifyJson(precheck, '{}'),
    warning_count: Array.isArray(precheck.warnings) ? precheck.warnings.length : 0,
    blocker_count: Array.isArray(precheck.blockers) ? precheck.blockers.length : 0
  })
}

function runPrecheckForJob(jobId = '') {
  const job = getJob(jobId)
  if (!job) {
    throw new Error('安装任务不存在')
  }

  updateJob(jobId, {
    state: JOB_STATE.PRECHECKING,
    current_step: '执行安装前预检',
    error_message: ''
  })
  emitJob(jobId)

  const detail = getJobDetail(jobId)
  const precheck = runInstallPrecheck({
    job: detail || {},
    items: Array.isArray(detail?.items) ? detail.items : [],
    artifacts: Array.isArray(detail?.artifacts) ? detail.artifacts : []
  })
  updatePrecheckResult(jobId, precheck)
  emitLog(
    jobId,
    '',
    precheck.status === PRECHECK_STATUS.BLOCKED ? 'warn' : 'info',
    precheck.summary,
    {
      stage: 'prechecking',
      recoverable: precheck.status === PRECHECK_STATUS.BLOCKED,
      context: {
        status: precheck.status,
        warningCount: precheck.warnings?.length || 0,
        blockerCount: precheck.blockers?.length || 0
      }
    }
  )

  if (precheck.status !== PRECHECK_STATUS.BLOCKED) {
    updateJob(jobId, {
      state: JOB_STATE.QUEUED,
      current_step: precheck.status === PRECHECK_STATUS.WARNING ? '预检通过但存在警告' : '预检通过',
      error_message: '',
      failure_stage: '',
      failure_json: '{}'
    })
    emitJob(jobId)
    return precheck
  }

  const failure = buildPrecheckBlockedFailure(precheck, {
    source: job.source,
    jobId
  })
  const items = getJobItems(jobId)
  for (const item of items) {
    if ([ITEM_STATE.INSTALLED, ITEM_STATE.SKIPPED_INSTALLED].includes(item.state)) {
      continue
    }
    updateItemState(item, {
      state: ITEM_STATE.PRECHECK_BLOCKED,
      progress: 100,
      error_message: failure.message,
      failure_stage: failure.stage,
      failure_json: stringifyJson(failure, '{}')
    })
  }
  updateJob(jobId, {
    state: JOB_STATE.PRECHECK_BLOCKED,
    current_step: '预检阻断',
    error_message: failure.message,
    failure_stage: failure.stage,
    failure_json: stringifyJson(failure, '{}')
  })
  const reportItem = items.find((item) => item.state === ITEM_STATE.PRECHECK_BLOCKED) || items[0]
  if (reportItem) {
    reportRuleIssueForFailure({
      job,
      item: reportItem,
      failure,
      artifact: getArtifactByKey(reportItem.artifact_key)
    }).then((ruleIssue) => {
      const enrichedFailure = attachRuleIssueToFailure(failure, ruleIssue)
      for (const item of items) {
        if (![ITEM_STATE.INSTALLED, ITEM_STATE.SKIPPED_INSTALLED].includes(item.state)) {
          updateItem(item.item_id, {
            failure_json: stringifyJson(enrichedFailure, '{}')
          })
        }
      }
      updateJob(jobId, {
        failure_json: stringifyJson(enrichedFailure, '{}')
      })
      emitJob(jobId)
    })
  }
  emitJob(jobId)
  return precheck
}

function markItemWaitingDependency(item = {}, dependencyResult = {}) {
  const waitingTitle = dependencyResult.waitingDependencies
    ?.map((entry) => entry.title)
    .filter(Boolean)
    .join('、')
  updateItemState(item, {
    state: ITEM_STATE.WAITING_DEPENDENCY,
    progress: Math.max(1, Number(item.progress || 0)),
    error_message: waitingTitle ? `等待依赖完成：${waitingTitle}` : ''
  })
  refreshJobSummary(item.job_id)
}

function markItemDependencyFailed(item = {}, dependencyResult = {}) {
  const failedTitle = dependencyResult.failedDependencies
    ?.map((entry) => entry.title)
    .filter(Boolean)
    .join('、')
  const failure = classifyInstallFailure(new Error(failedTitle ? `依赖失败：${failedTitle}` : '依赖失败'), {
    source: parseItemMetadata(item).source || 'nexus',
    jobId: item.job_id,
    itemId: item.item_id,
    title: item.title,
    artifactKey: item.artifact_key,
    stage: FAILURE_STAGE.DEPENDENCY_FAILED,
    recoverable: true
  })
  updateItemFailure(item, failure)
  emitLog(item.job_id, item.item_id, 'error', failure.message, {
    stage: failure.stage,
    recoverable: failure.recoverable,
    context: {
      ...failure.detail,
      dependencies: dependencyResult.failedDependencies || []
    }
  })
  refreshJobSummary(item.job_id)
  updateJob(item.job_id, {
    failure_stage: failure.stage,
    failure_json: stringifyJson(failure, '{}'),
    error_message: failure.message
  })
}

async function runWithInstallLock(item = {}, task) {
  const installKey = toSafeText(item.install_key)
  if (!installKey) return await task(item)

  const signal = getJobAbortSignal(item.job_id)
  while (installLockMap.has(installKey)) {
    updateItemState(item, {
      state: ITEM_STATE.WAITING_INSTALL,
      progress: Math.max(65, Number(item.progress || 0)),
      error_message: ''
    })
    refreshJobSummary(item.job_id)
    // 锁仅表示前序执行已结束；其失败不应使后续独立任务失败。
    await waitWithAbort(installLockMap.get(installKey), signal)
    assertItemCanProceed(item.job_id, item.item_id, item)
  }

  let releaseLock
  const lockPromise = new Promise((resolve) => { releaseLock = resolve })
  installLockMap.set(installKey, lockPromise)
  try {
    const latestContext = assertItemCanProceed(item.job_id, item.item_id, item)
    return await task(latestContext.item)
  } finally {
    installLockMap.delete(installKey)
    releaseLock()
  }
}

function scheduleRunJob(event, jobId = '', context = {}, currentStep = '安装任务失败') {
  Promise.resolve()
    .then(() => runJob(event, jobId))
    .catch((error) => {
      const failure = classifyInstallFailure(error, {
        jobId,
        ...context
      })
      updateJobFailure({ job_id: jobId }, failure, currentStep)
      emitLog(jobId, '', 'error', failure.message, {
        stage: failure.stage,
        recoverable: failure.recoverable,
        context: failure.detail
      })
      emitJob(jobId)
    })
}

async function waitForDownloadedArtifactFile(filePath = '', artifactKey = '', signal = null) {
  const safeFilePath = toSafeText(filePath)
  if (!safeFilePath) {
    return ''
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt <= DOWNLOAD_FILE_READY_TIMEOUT_MS) {
    // PR5/A2：等待下载就绪期间若任务被取消/暂停，提前结束轮询，
    // 由调用方的下一个检查点抛出控制错误。
    if (signal && signal.aborted) {
      return safeFilePath
    }
    if (fs.existsSync(safeFilePath)) {
      return safeFilePath
    }
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_FILE_READY_INTERVAL_MS))
  }

  const latestArtifact = artifactKey ? getArtifactByKey(artifactKey) : null
  const latestFilePath = toSafeText(latestArtifact?.file_path)
  if (latestFilePath && latestFilePath !== safeFilePath && fs.existsSync(latestFilePath)) {
    return latestFilePath
  }
  return safeFilePath
}

async function ensureArtifactReady(event, item = {}, renewed = false) {
  assertItemCanProceed(item.job_id, item.item_id, item)
  const artifactKey = toSafeText(item.artifact_key)
  if (!artifactKey) {
    throw new Error('安装项缺少下载产物唯一键')
  }

  let artifact = getArtifactByKey(artifactKey)
  if (!artifact) {
    throw new Error('下载产物记录不存在')
  }

  if (toSafeText(artifact.file_path) && isArtifactFileAvailable(artifact)) {
    if (artifact.state !== ARTIFACT_STATE.DOWNLOADED) {
      updateArtifactState(artifactKey, {
        state: ARTIFACT_STATE.DOWNLOADED,
        error_message: ''
      })
    }
    return artifact.file_path
  }

  if (artifact.state === ARTIFACT_STATE.DOWNLOADED) {
    if (isArtifactFileAvailable(artifact)) {
      return artifact.file_path
    }
    updateArtifactState(artifactKey, {
      state: ARTIFACT_STATE.MISSING,
      error_message: '下载文件不存在，需要重新下载'
    })
    artifact = getArtifactByKey(artifactKey)
  }

  if (
    [ARTIFACT_STATE.QUEUED, ARTIFACT_STATE.DOWNLOADING].includes(artifact.state) &&
    hasActiveArtifactDownload(artifactKey)
  ) {
    updateItemState(item, {
      state: ITEM_STATE.WAITING_ARTIFACT,
      progress: Math.max(5, Number(item.progress || 0))
    })
    refreshJobSummary(item.job_id)
    emitLog(item.job_id, item.item_id, 'info', `复用下载任务：${artifact.download_task_id}`)
    const signal = getJobAbortSignal(item.job_id)
    const result = await waitWithAbort(waitForArtifactDownload(artifactKey), signal)
    assertItemCanProceed(item.job_id, item.item_id, item)
    return await waitForDownloadedArtifactFile(
      toSafeText(
        result?.filePath || result?.file_path || getArtifactByKey(artifactKey)?.file_path
      ),
      artifactKey,
      signal
    )
  }

  const metadata = parseItemMetadata(item)
  const entry = metadata.entry || {}
  if (metadata.source === 'steam-workshop' && entry.item?.workshopDownload) {
    const [{ runWorkshopDownload }, { createWorkshopAuthSession }, { default: store }, { default: userPath }, { steamAccount }] = await Promise.all([
      import('../../../services/workshop/downloader.js'),
      import('../../../services/workshop/authState.js'),
      import('../../../storage/store/index.js'),
      import('../../../initPath.js'),
      import('../../../services/workshop/account.js')
    ])
    const signal = getJobAbortSignal(item.job_id)
    const auth = createWorkshopAuthSession(event, item.job_id, signal, { remember: steamAccount.snapshot().remembered })
    updateArtifactState(artifactKey, { state: ARTIFACT_STATE.DOWNLOADING, error_message: '' })
    updateItemState(item, { state: ITEM_STATE.DOWNLOADING, progress: 5 })
    refreshJobSummary(item.job_id)
    try {
      const filePath = await runWorkshopDownload({
        target: entry.item.workshopDownload, jobId: item.job_id, signal, auth,
        cacheRoot: `${userPath}/tools`, downloadRoot: store.getStore('systemConfig.settings.downloadPath'),
        onProgress(progress, message) {
          if (signal?.aborted) return
          updateItemState(item, { state: ITEM_STATE.DOWNLOADING, progress: Math.max(5, Math.round(progress * 0.9)) })
          updateJob(item.job_id, { current_step: message })
          emitJob(item.job_id)
        }
      }, { account: steamAccount })
      assertItemCanProceed(item.job_id, item.item_id, item)
      updateArtifactState(artifactKey, { state: ARTIFACT_STATE.DOWNLOADED, file_path: filePath, error_message: '' })
      return filePath
    } catch (error) {
      if (signal?.aborted) {
        const controlError = createAbortError(signal.reason)
        updateArtifactState(artifactKey, { state: controlError.code === SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED ? ARTIFACT_STATE.CREATED : ARTIFACT_STATE.CANCELLED, error_message: controlError.message })
        throw controlError
      }
      updateArtifactState(artifactKey, { state: ARTIFACT_STATE.FAILED, error_message: error.message })
      throw error
    } finally { auth?.close() }
  }
  const downloadTask = buildDownloadTaskPayload(entry, artifact)
  let downloadUrl = toSafeText(
    transientNexusDownloadUrlMap.get(artifactKey) ||
      downloadTask.download_url ||
      artifact.download_url
  )
  if (!downloadUrl) {
    const target = resolveNexusAuthorizationTarget({ ...item, metadata })
    if (target) {
      try {
        const result = await exchangeNexusDownloadLink({ target })
        downloadUrl = toSafeText(result?.downloadUrl)
      } catch (error) {
        markItemWaitingNexusAuthorization(item, error, {
          requiresAuthorization: Number(error?.status || error?.response?.status || 0) === 403
        })
        refreshJobSummary(item.job_id)
        const waitingError = new Error('等待 Nexus 授权')
        waitingError.code = NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED
        throw waitingError
      }
    }
  }
  if (!downloadUrl) {
    throw new Error('缺少下载地址')
  }
  assertItemCanProceed(item.job_id, item.item_id, item)
  updateArtifactState(artifactKey, {
    state: ARTIFACT_STATE.QUEUED,
    download_task_id: downloadTask.id,
    download_url: '',
    error_message: ''
  })
  updateItemState(item, {
    state: ITEM_STATE.DOWNLOADING,
    progress: Math.max(5, Number(item.progress || 0)),
    error_message: ''
  })
  refreshJobSummary(item.job_id)

  const waitPromise = registerArtifactDownload(artifactKey)
  try {
    createSourceInstallDownloadTask(artifactKey, {
      ...downloadTask,
      download_url: downloadUrl
    })
    transientNexusDownloadUrlMap.delete(artifactKey)
  } catch (error) {
    rejectArtifactDownload(artifactKey, error)
    throw error
  }
  emitLog(item.job_id, item.item_id, 'info', `创建下载中心任务：${downloadTask.id}`)
  const signal = getJobAbortSignal(item.job_id)
  let result
  try { result = await waitWithAbort(waitPromise, signal) }
  catch (error) {
    if (error.code !== 'nexus_download_url_expired') throw error
    assertItemCanProceed(item.job_id, item.item_id, item)
    if (!renewed) return await ensureArtifactReady(event, item, true)
    markItemWaitingNexusAuthorization(item, error)
    refreshJobSummary(item.job_id)
    throw Object.assign(new Error('下载地址已失效，请重新授权'), { code: NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED })
  }
  assertItemCanProceed(item.job_id, item.item_id, item)
  return await waitForDownloadedArtifactFile(
    toSafeText(result?.filePath || result?.file_path || getArtifactByKey(artifactKey)?.file_path),
    artifactKey,
    signal
  )
}

async function processItem(event, item = {}, job = {}) {
  assertItemCanProceed(job.job_id, item.item_id, item)
  await runWithInstallLock(item, async (lockedItem) => {
    const latestBeforeInstall = assertItemCanProceed(lockedItem.job_id, lockedItem.item_id, lockedItem)
    const installed = findInstalledModByItem(latestBeforeInstall.item)
    if (installed) {
      markItemSkippedInstalled(
        latestBeforeInstall.item,
        `已安装，复用记录：${latestBeforeInstall.item.title}`
      )
      return {
        installed,
        reusedInstalled: true
      }
    }

    const filePath = await ensureArtifactReady(event, latestBeforeInstall.item)
    const latestAfterDownload = assertItemCanProceed(
      latestBeforeInstall.item.job_id,
      latestBeforeInstall.item.item_id,
      latestBeforeInstall.item
    )
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('下载文件不存在，无法安装')
    }

    if (isDownloadOnlyItem(latestAfterDownload.item)) {
      updateItemState(latestAfterDownload.item, {
        state: ITEM_STATE.FILE_READY,
        progress: 100,
        error_message: ''
      })
      emitLog(
        latestAfterDownload.item.job_id,
        latestAfterDownload.item.item_id,
        'info',
        `下载完成：${latestAfterDownload.item.title}`
      )
      refreshJobSummary(latestAfterDownload.item.job_id)
      return {
        filePath,
        downloadOnly: true
      }
    }

    const metadata = parseItemMetadata(latestAfterDownload.item)
    const installPayload = {
      ...(metadata.installPayload || {}),
      sourceInstallJobId: latestAfterDownload.item.job_id,
      sourceInstallItemId: latestAfterDownload.item.item_id
    }
    updateItemState(latestAfterDownload.item, {
      state: ITEM_STATE.INSPECTING_ARCHIVE,
      progress: 68,
      error_message: ''
    })
    refreshJobSummary(latestAfterDownload.item.job_id)
    emitLog(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      'info',
      `解析压缩包：${latestAfterDownload.item.title}`
    )

    updateItemState(latestAfterDownload.item, {
      state: ITEM_STATE.PREVIEWING,
      progress: 70,
      error_message: ''
    })
    refreshJobSummary(latestAfterDownload.item.job_id)
    emitLog(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      'info',
      `生成安装预案：${latestAfterDownload.item.title}`
    )

    assertItemCanProceed(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      latestAfterDownload.item
    )
    updateItemState(latestAfterDownload.item, {
      state: ITEM_STATE.DEPLOYING,
      progress: 85,
      error_message: ''
    })
    refreshJobSummary(latestAfterDownload.item.job_id)
    emitLog(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      'info',
      `执行安装：${latestAfterDownload.item.title}`
    )

    const installResult = await executeInstallItem(event, {
      filePath,
      installPayload,
      source: metadata.source || job.source || 'nexus',
      type: Number(metadata.type || 1),
      signal: getJobAbortSignal(latestAfterDownload.item.job_id),
      onDeploymentWait: () => {
        assertItemCanProceed(latestAfterDownload.item.job_id, latestAfterDownload.item.item_id)
        updateItemState(latestAfterDownload.item, { state: ITEM_STATE.WAITING_INSTALL })
        refreshJobSummary(latestAfterDownload.item.job_id)
      },
      onDeploymentAcquire: () => {
        assertItemCanProceed(latestAfterDownload.item.job_id, latestAfterDownload.item.item_id)
        updateItemState(latestAfterDownload.item, { state: ITEM_STATE.INSTALLING })
        refreshJobSummary(latestAfterDownload.item.job_id)
      }
    })
    persistInstallPlanSnapshot(latestAfterDownload.item, installResult)
    mergeItemMetadata(latestAfterDownload.item, {
      lastInstallResult: toPlainJson(installResult, {})
    })

    // PR5/A3：写入 INSTALLED 之前再次检查点——执行安装期间若任务被取消/暂停，
    // 在此抛出控制错误，避免把已取消的安装项错误标记为已安装。
    assertItemCanProceed(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      latestAfterDownload.item
    )
    updateItemState(latestAfterDownload.item, {
      state: ITEM_STATE.INSTALLED,
      progress: 100,
      error_message: ''
    })
    emitLog(
      latestAfterDownload.item.job_id,
      latestAfterDownload.item.item_id,
      'info',
      `安装完成：${latestAfterDownload.item.title}`
    )
    refreshJobSummary(latestAfterDownload.item.job_id)
    assertJobCanProceed(latestAfterDownload.item.job_id)
  })
}

async function runJob(event, jobId = '') {
  const safeJobId = toSafeText(jobId)
  if (!safeJobId) {
    throw new Error('缺少安装任务 ID')
  }
  if (runningJobMap.has(safeJobId)) {
    return await runningJobMap.get(safeJobId)
  }

  // PR5/A2：在创建 runner 之前注册 AbortController，确保 processItem 能取到对应 signal。
  abortControllerMap.set(safeJobId, new AbortController())

  const runner = (async () => {
    const job = getJob(safeJobId)
    if (!job) {
      throw new Error('安装任务不存在')
    }

    assertSourceModpackTaskCanProceed(job)
    await assertInstallSourceAvailable({ ...parseJsonObject(job.payload_json, {}), source: job.source })
    if (isJobStopped(getJob(safeJobId))) return getJobDetail(safeJobId)
    const precheck = runPrecheckForJob(safeJobId)
    if (precheck.status === PRECHECK_STATUS.BLOCKED) {
      return getJobDetail(safeJobId)
    }

    updateJob(safeJobId, {
      state: JOB_STATE.RESOLVING,
      current_step: '准备安装任务',
      error_message: ''
    })
    emitJob(safeJobId)

    const remainingItems = sortItems(getJobItems(safeJobId)).filter(
      (item) => !TERMINAL_ITEM_STATES.has(item.state)
    )
    const remainingMap = new Map(remainingItems.map((item) => [item.item_id, item]))
    while (remainingMap.size > 0) {
      let progressed = false
      for (const [itemId, queuedItem] of [...remainingMap.entries()]) {
        const latestItem = getCurrentItem(safeJobId, itemId, queuedItem)
        if (!latestItem?.item_id) {
          remainingMap.delete(itemId)
          progressed = true
          continue
        }
        if (TERMINAL_ITEM_STATES.has(latestItem.state)) {
          remainingMap.delete(itemId)
          progressed = true
          continue
        }
        if (
          [ITEM_STATE.WAITING_AUTHORIZATION, ITEM_STATE.AUTHENTICATING].includes(latestItem.state)
        ) {
          remainingMap.delete(itemId)
          progressed = true
          continue
        }

        const dependencyResult = evaluateItemDependencies(latestItem, getJobItems(safeJobId))
        if (dependencyResult.blocked) {
          markItemDependencyFailed(latestItem, dependencyResult)
          remainingMap.delete(itemId)
          progressed = true
          continue
        }
        if (dependencyResult.waiting) {
          markItemWaitingDependency(latestItem, dependencyResult)
          continue
        }
        if (dependencyResult.warningDependencies.length > 0) {
          emitLog(
            latestItem.job_id,
            latestItem.item_id,
            'warn',
            `可选依赖异常：${dependencyResult.warningDependencies
              .map((entry) => entry.title)
              .filter(Boolean)
              .join('、')}`,
            {
              stage: FAILURE_STAGE.DEPENDENCY_FAILED,
              recoverable: true,
              context: {
                dependencies: dependencyResult.warningDependencies
              }
            }
          )
        }

        try {
          await processItem(event, latestItem, job)
          assertJobCanProceed(safeJobId)
          remainingMap.delete(itemId)
          progressed = true
        } catch (error) {
          if (isTaskControlError(error)) {
            throw error
          }
          if (isNexusAuthorizationWaitingError(error)) {
            remainingMap.delete(itemId)
            progressed = true
            continue
          }
          if (error?.selectionRequest) {
            mergeItemMetadata(latestItem, { selectionRequest: toPlainJson(error.selectionRequest, {}) })
            updateItemState(latestItem, {
              state: ITEM_STATE.PRECHECK_BLOCKED,
              error_message: '请选择安装组件后继续'
            })
            refreshJobSummary(latestItem.job_id)
            emitLog(latestItem.job_id, latestItem.item_id, 'info', '安装包需要选择组件')
            remainingMap.delete(itemId)
            progressed = true
            continue
          }
          if (error?.previewResult || error?.installResult) {
            const failedInstallResult = {
              previewResult: error.previewResult || null,
              installResult: error.installResult || null,
              inspectToken: error.inspectToken || ''
            }
            persistInstallPlanSnapshot(latestItem, failedInstallResult)
            mergeItemMetadata(latestItem, {
              lastInstallResult: toPlainJson(failedInstallResult, {})
            })
          }
          const failure = classifyInstallFailure(error, {
            source: job.source,
            jobId: latestItem.job_id,
            itemId: latestItem.item_id,
            title: latestItem.title,
            artifactKey: latestItem.artifact_key
          })
          const ruleIssue = await reportRuleIssueForFailure({
            job,
            item: latestItem,
            failure,
            artifact: getArtifactByKey(latestItem.artifact_key)
          })
          const enrichedFailure = attachRuleIssueToFailure(failure, ruleIssue)
          updateItemFailure(latestItem, enrichedFailure)
          emitLog(latestItem.job_id, latestItem.item_id, 'error', enrichedFailure.message, {
            stage: enrichedFailure.stage,
            recoverable: enrichedFailure.recoverable,
            context: enrichedFailure.detail
          })
          refreshJobSummary(latestItem.job_id)
          updateJob(latestItem.job_id, {
            failure_stage: enrichedFailure.stage,
            failure_json: stringifyJson(enrichedFailure, '{}'),
            error_message: enrichedFailure.message
          })
          remainingMap.delete(itemId)
          progressed = true
        }
      }

      if (!progressed) {
        const hasWaitingAuthorization = getJobItems(safeJobId).some((item) =>
          [ITEM_STATE.WAITING_AUTHORIZATION, ITEM_STATE.AUTHENTICATING].includes(item.state)
        )
        if (hasWaitingAuthorization) {
          break
        }
        for (const [itemId, queuedItem] of [...remainingMap.entries()]) {
          const latestItem = getCurrentItem(safeJobId, itemId, queuedItem)
          if (!latestItem?.item_id || TERMINAL_ITEM_STATES.has(latestItem.state)) {
            remainingMap.delete(itemId)
            continue
          }
          markItemDependencyFailed(latestItem, {
            failedDependencies: [
              {
                title: '依赖未满足或存在循环依赖'
              }
            ]
          })
          remainingMap.delete(itemId)
        }
      }
    }

    const summary = refreshJobSummary(safeJobId)
    if (summary?.state !== JOB_STATE.COMPLETED) {
      return summary
    }

    const completedItems = getJobItems(safeJobId)
    if (
      completedItems.length > 0 &&
      completedItems.every((item) =>
        [ITEM_STATE.FILE_READY, ITEM_STATE.SKIPPED].includes(item.state)
      )
    ) {
      updateJob(safeJobId, {
        state: JOB_STATE.COMPLETED,
        progress: 100,
        current_step: '下载完成',
        error_message: ''
      })
      emitLog(safeJobId, '', 'info', '全部文件已下载完成')
      return emitJob(safeJobId)
    }

    updateJob(safeJobId, {
      state: JOB_STATE.HEALTH_CHECKING,
      current_step: '安装后校验'
    })
    emitJob(safeJobId)
    const healthDetail = getJobDetail(safeJobId)
    const health = runInstallHealthCheck(healthDetail || {})
    updateJob(safeJobId, {
      health_status: health.status,
      health_json: stringifyJson(health, '{}')
    })

    for (const item of healthDetail?.items || []) {
      updateItem(item.item_id, {
        health_status: health.status,
        health_json: stringifyJson(
          {
            status: health.status,
            checks: health.checks.filter((check) => String(check.key || '').includes(item.item_id))
          },
          '{}'
        )
      })
    }

    if (health.status === HEALTH_STATUS.FAILED) {
      const failure = classifyInstallFailure(new Error(health.summary), {
        source: job.source,
        jobId: safeJobId,
        stage: 'health_check_failed',
        recoverable: true
      })
      const firstItem = Array.isArray(healthDetail?.items) ? healthDetail.items[0] : null
      const ruleIssue = await reportRuleIssueForFailure({
        job,
        item: firstItem || {},
        failure,
        artifact: firstItem ? getArtifactByKey(firstItem.artifact_key) : {}
      })
      assertJobCanProceed(safeJobId)
      const enrichedFailure = attachRuleIssueToFailure(failure, ruleIssue)
      updateJob(safeJobId, {
        state: JOB_STATE.RECOVERABLE,
        current_step: '健康检查异常',
        error_message: enrichedFailure.message,
        failure_stage: enrichedFailure.stage,
        failure_json: stringifyJson(enrichedFailure, '{}')
      })
      emitLog(safeJobId, '', 'error', health.summary, {
        stage: enrichedFailure.stage,
        recoverable: true,
        context: {
          ...health,
          ruleIssue: enrichedFailure.detail?.ruleIssue
        }
      })
      return emitJob(safeJobId)
    }

    const sourceProtection = await protectInstalledModSources(healthDetail?.items || [])
    assertJobCanProceed(safeJobId)
    const sourceProtectionFailures = sourceProtection.filter(
      (entry) => entry?.lockResult?.success !== true
    )
    const skippedOptionalCount = (healthDetail?.items || []).filter(
      (item) => item.state === ITEM_STATE.SKIPPED
    ).length
    const finalHealth = {
      ...health,
      sourceProtection: {
        status: sourceProtectionFailures.length > 0 ? 'warning' : 'passed',
        results: sourceProtection
      }
    }
    updateJob(safeJobId, {
      health_json: stringifyJson(finalHealth, '{}')
    })

    updateJob(safeJobId, {
      state:
        health.status === HEALTH_STATUS.WARNING ||
        sourceProtectionFailures.length > 0 ||
        skippedOptionalCount > 0
          ? JOB_STATE.COMPLETED_WITH_WARNING
          : JOB_STATE.COMPLETED,
      progress: 100,
      current_step:
        health.status === HEALTH_STATUS.WARNING ||
        sourceProtectionFailures.length > 0 ||
        skippedOptionalCount > 0
          ? '安装完成但存在警告'
          : '安装完成',
      error_message: '',
      warning_count: Math.max(
        Number(job.warning_count || 0),
        skippedOptionalCount
      )
    })
    emitLog(
      safeJobId,
      '',
      health.status === HEALTH_STATUS.WARNING ||
        sourceProtectionFailures.length > 0 ||
        skippedOptionalCount > 0
        ? 'warn'
        : 'info',
      skippedOptionalCount > 0
        ? `${health.summary}；已跳过 ${skippedOptionalCount} 个可选依赖`
        : sourceProtectionFailures.length > 0
        ? `${health.summary}；${sourceProtectionFailures.length} 个模组源文件保护失败`
        : health.summary,
      {
        stage: 'health_checking',
        recoverable: false,
        context: finalHealth
      }
    )
    return emitJob(safeJobId)
  })()

  runningJobMap.set(safeJobId, runner)
  try {
    return await runner
  } catch (error) {
    if (isTaskControlError(error)) return emitJob(safeJobId) || getJobDetail(safeJobId)
    throw error
  } finally {
    runningJobMap.delete(safeJobId)
    abortControllerMap.delete(safeJobId)
  }
}

function createJobItems(payload = {}, jobId = '') {
  const createdItems = []
  for (const entry of payload.items) {
    const artifact = upsertArtifact(buildArtifactRecord(payload, entry))
    const item = buildItemRecord(jobId, payload, entry)
    const artifactState = toSafeText(artifact?.state)
    item.reusedArtifact = [
      ARTIFACT_STATE.QUEUED,
      ARTIFACT_STATE.DOWNLOADING,
      ARTIFACT_STATE.DOWNLOADED
    ].includes(artifactState)
    insertItem(item)
    const insertedItem = getJobItems(jobId).find((row) => row.item_id === item.item_id) || item
    item.reusedInstalled = !!findInstalledModByItem(insertedItem)
    createdItems.push(item)
  }
  return createdItems
}

function collectArtifactJobItems(artifactKey = '') {
  return getItemsByArtifactKey(artifactKey).map((item) => ({
    item,
    job: getJob(item.job_id)
  }))
}

function getMutableArtifactJobItems(artifactKey = '') {
  return collectArtifactJobItems(artifactKey).filter(({ item, job }) => {
    if (!item?.item_id || !job) {
      return false
    }
    if (isJobStopped(job)) {
      return false
    }
    return !isItemTransitionIgnorable(item)
  })
}

function registerDownloadEventHandlers() {
  if (sourceInstallDownloadBridgeEvents.__sourceInstallTaskRegistered) {
    return
  }
  sourceInstallDownloadBridgeEvents.__sourceInstallTaskRegistered = true

  sourceInstallDownloadBridgeEvents.on('progress', ({ artifactKey, payload }) => {
    const safeArtifactKey = toSafeText(artifactKey)
    if (!safeArtifactKey) return
    const mutableEntries = getMutableArtifactJobItems(safeArtifactKey)
    if (!mutableEntries.length) {
      return
    }
    const progress = Math.max(0, Math.min(100, Number(payload?.progress || 0)))
    updateArtifactState(safeArtifactKey, {
      state: ARTIFACT_STATE.DOWNLOADING,
      file_size: Number(payload?.totalBytes || 0)
    })
    mutableEntries.forEach(({ item }) => {
      updateItemState(item, {
        state: ITEM_STATE.DOWNLOADING,
        progress: Math.max(5, Math.min(60, Math.round(progress * 0.6)))
      })
      refreshJobSummary(item.job_id)
    })
  })

  sourceInstallDownloadBridgeEvents.on('success', ({ artifactKey, payload }) => {
    const safeArtifactKey = toSafeText(artifactKey)
    const taskId = toSafeText(payload?.id)
    const artifact = safeArtifactKey
      ? getArtifactByKey(safeArtifactKey)
      : getArtifactByDownloadTaskId(taskId)
    if (!artifact) return
    const filePath = toSafeText(payload?.filePath || artifact.file_path)
    const mutableEntries = getMutableArtifactJobItems(artifact.artifact_key)
    updateArtifactState(artifact.artifact_key, {
      state: ARTIFACT_STATE.DOWNLOADED,
      file_path: filePath,
      file_size: Number(payload?.totalBytes || artifact.file_size || 0),
      error_message: ''
    })
    mutableEntries.forEach(({ item }) => {
      updateItemState(item, {
        state: ITEM_STATE.DOWNLOADED,
        progress: Math.max(65, Number(item.progress || 0)),
        error_message: ''
      })
      refreshJobSummary(item.job_id)
    })
    resolveArtifactDownload(artifact.artifact_key, {
      ...payload,
      filePath
    })
  })

  sourceInstallDownloadBridgeEvents.on('failed', ({ artifactKey, payload }) => {
    const safeArtifactKey = toSafeText(artifactKey)
    const taskId = toSafeText(payload?.id)
    const artifact = safeArtifactKey
      ? getArtifactByKey(safeArtifactKey)
      : getArtifactByDownloadTaskId(taskId)
    if (!artifact) return
    const message = toSafeText(payload?.rawMessage || payload?.message, '下载失败')
    const relatedEntries = collectArtifactJobItems(artifact.artifact_key)
    const mutableEntries = getMutableArtifactJobItems(artifact.artifact_key)
    if (!mutableEntries.length) {
      const stoppedError = relatedEntries.some(({ item, job }) => {
        return item?.state === ITEM_STATE.CANCELLED || job?.state === JOB_STATE.CANCELLED
      })
        ? createTaskCancelledError(message)
        : createTaskPausedError(message)
      rejectArtifactDownload(artifact.artifact_key, stoppedError)
      return
    }
    const failure = classifyInstallFailure(new Error(message), {
      stage: 'download_failed',
      artifactKey: artifact.artifact_key
    })
    if (mutableEntries.some(({ item }) => resolveNexusAuthorizationTarget(item)) &&
      /\b(?:401|403|410)\b|URL_EXPIRED|ACCESS_DENIED/i.test(`${payload?.errorCode || ''} ${message}`)) {
      transientNexusDownloadUrlMap.delete(artifact.artifact_key)
      updateArtifactState(artifact.artifact_key, { state: ARTIFACT_STATE.FAILED, download_url: '', error_message: 'Nexus 下载地址失效，正在重新获取' })
      rejectArtifactDownload(artifact.artifact_key, Object.assign(new Error('Nexus 下载地址失效'), { code: 'nexus_download_url_expired' }))
      return
    }
    updateArtifactState(artifact.artifact_key, {
      state: ARTIFACT_STATE.FAILED,
      error_message: message
    })
    mutableEntries.forEach(({ item }) => {
      updateItemFailure(item, {
        ...failure,
        detail: {
          ...failure.detail,
          jobId: item.job_id,
          itemId: item.item_id,
          title: item.title
        }
      })
      emitLog(item.job_id, item.item_id, 'error', message, {
        stage: failure.stage,
        recoverable: failure.recoverable,
        context: failure.detail
      })
      refreshJobSummary(item.job_id)
      updateJob(item.job_id, {
        failure_stage: failure.stage,
        failure_json: stringifyJson(failure, '{}'),
        error_message: failure.message
      })
      emitJob(item.job_id)
    })
    rejectArtifactDownload(artifact.artifact_key, new Error(message))
  })

  sourceInstallDownloadBridgeEvents.on('cancelled', ({ artifactKey, payload }) => {
    const safeArtifactKey = toSafeText(artifactKey)
    const taskId = toSafeText(payload?.id)
    const artifact = safeArtifactKey
      ? getArtifactByKey(safeArtifactKey)
      : getArtifactByDownloadTaskId(taskId)
    if (!artifact) return
    const message = toSafeText(payload?.message, '下载已取消')
    const mutableEntries = getMutableArtifactJobItems(artifact.artifact_key)
    if (!mutableEntries.length) {
      rejectArtifactDownload(artifact.artifact_key, createTaskCancelledError(message))
      return
    }
    updateArtifactState(artifact.artifact_key, {
      state: ARTIFACT_STATE.CANCELLED,
      error_message: message
    })
    mutableEntries.forEach(({ item }) => {
      updateItemState(item, {
        state: ITEM_STATE.CANCELLED,
        progress: 100,
        error_message: message
      })
      refreshJobSummary(item.job_id)
    })
    rejectArtifactDownload(artifact.artifact_key, new Error(message))
  })
}

export function initSourceInstallTaskOrchestrator() {
  registerDownloadEventHandlers()
}

export async function createSourceInstallTask(event, rawPayload = {}, internalHooks = {}) {
  const payload = normalizeCreatePayload(rawPayload)
  try { await assertInstallSourceAvailable(payload) } catch (error) { return { success: false, code: error.code, errorCode: error.code, message: error.message } }
  if (!payload.items.length) {
    return {
      success: false,
      message: '没有可安装项'
    }
  }

  const jobId = createId('job')
  // A4：job + N items + artifacts 必须原子写入，任一步失败整体回滚，避免留下脏任务记录。
  // 注意 createJobItems / insertJob 内部均为同步 better-sqlite3 调用，可安全置于事务内。
  let createdItems = []
  const persistedPayload = sanitizeSourceInstallTaskPayloadForPersistence(payload)
  runInTransaction(() => {
    insertJob({
      job_id: jobId,
      agent_task_id: payload.agentTaskId || payload.agent_task_id,
      source: payload.source,
      source_adapter: payload.sourceAdapter,
      game_key: payload.gameKey,
      game_root: payload.gameRoot,
      title: normalizeJobTitle(payload),
      state: JOB_STATE.CREATED,
      progress: 0,
      current_step: '已创建',
      payload_json: persistedPayload
    })
    createdItems = createJobItems(persistedPayload, jobId)
    if (typeof internalHooks?.onCreated === 'function') {
      const hookResult = internalHooks.onCreated({
        jobId,
        source: payload.source,
        state: JOB_STATE.CREATED
      })
      if (hookResult && typeof hookResult.then === 'function') {
        throw new TypeError('安装任务创建钩子必须是同步函数')
      }
    }
  })
  const reusedInfo = collectReusedInfo(createdItems)
  const precheck = runPrecheckForJob(jobId)
  emitLog(jobId, '', 'info', '安装任务已创建', {
    itemCount: createdItems.length,
    precheckStatus: precheck.status
  })

  if (precheck.status !== PRECHECK_STATUS.BLOCKED) {
    await prepareNexusDownloadSources(jobId)
  }
  const preparedJob = getJob(jobId)
  const waitingForAuthorization = preparedJob?.state === JOB_STATE.WAITING_USER_ACTION

  if (precheck.status !== PRECHECK_STATUS.BLOCKED && !waitingForAuthorization) {
    updateJob(jobId, {
      state: JOB_STATE.QUEUED,
      current_step: '已加入安装任务'
    })
    emitJob(jobId)
  }

  const hasRunnableItems = getJobItems(jobId).some(
    (item) =>
      !TERMINAL_ITEM_STATES.has(item.state) &&
      ![ITEM_STATE.WAITING_AUTHORIZATION, ITEM_STATE.AUTHENTICATING].includes(item.state)
  )
  const firstWaiting = getJobItems(jobId).find((item) => item.state === ITEM_STATE.WAITING_AUTHORIZATION)
  if (firstWaiting?.failure_stage === NEXUS_AUTHORIZATION_ERROR_CODE.REQUIRED &&
    payload.options?.autoStart !== false && precheck.status !== PRECHECK_STATUS.BLOCKED) {
    void nexusAuthorizationTaskService.performAction(null, { action: 'open', jobId,
      itemId: firstWaiting.item_id }).catch(() => {})
  }
  if (
    precheck.status !== PRECHECK_STATUS.BLOCKED &&
    payload.options?.autoStart !== false &&
    hasRunnableItems
  ) {
    scheduleRunJob(event, jobId, {
      source: payload.source
    })
  }

  return {
    success: true,
    jobId,
    agentTaskId: payload.agentTaskId || payload.agent_task_id || '',
    state:
      precheck.status === PRECHECK_STATUS.BLOCKED
        ? JOB_STATE.PRECHECK_BLOCKED
        : waitingForAuthorization
          ? JOB_STATE.WAITING_USER_ACTION
          : JOB_STATE.QUEUED,
    precheck,
    ...reusedInfo,
    message:
      precheck.status === PRECHECK_STATUS.BLOCKED
        ? '安装任务预检被阻断，请在任务中心查看详情'
        : waitingForAuthorization
          ? '已加入任务，需在任务中心完成 Nexus 授权'
        : '已加入安装任务'
  }
}

export function startPreparedSourceInstallTask(event, payload = {}) {
  const jobId = toSafeText(payload?.jobId || payload?.job_id)
  const job = getJob(jobId)
  if (!job) {
    return {
      success: false,
      code: 'task_not_found',
      message: '安装任务不存在'
    }
  }
  const retiredFailure = getRetiredSourceFailure(job.source)
  if (retiredFailure) return retiredFailure
  if (job.state === JOB_STATE.PRECHECK_BLOCKED) {
    return {
      success: true,
      jobId,
      started: false,
      state: job.state,
      message: '安装任务预检被阻断'
    }
  }
  if (job.state !== JOB_STATE.QUEUED) {
    return {
      success: false,
      code: 'task_state_changed',
      jobId,
      state: job.state,
      message: '安装任务状态已变化，无法启动'
    }
  }
  scheduleRunJob(event, jobId, { source: job.source })
  return {
    success: true,
    jobId,
    started: true,
    state: job.state,
    message: '安装任务已启动'
  }
}

export function listSourceInstallTasks(payload = {}) {
  return listPublicJobs(payload)
}

export function getSourceInstallTaskSummary() {
  return summarizeJobs()
}

export async function getSourceInstallTaskDetail(payload = {}) {
  const detail = await getPublicJobDetail(payload?.jobId || payload?.job_id, {
    format: payload?.format === 'diagnostic-json' ? 'diagnostic-json' : ''
  })
  if (!detail) {
    return {
      success: false,
      message: '安装任务不存在'
    }
  }
  return {
    success: true,
    data: detail
  }
}

export async function retrySourceInstallTask(event, payload = {}) {
  const control = getTaskForAction(payload, INSTALL_TASK_ACTION.RETRY)
  if (control.error) return control.error
  const { jobId } = control
  await runningJobMap.get(jobId)?.catch(() => {})
  const existingJob = getJob(jobId)
  try { await assertInstallSourceAvailable({ ...parseJsonObject(existingJob?.payload_json, {}), source: existingJob?.source }) } catch (error) { return { success: false, code: error.code, errorCode: error.code, message: error.message } }
  const latestControl = getTaskForAction(payload, INSTALL_TASK_ACTION.RETRY)
  if (latestControl.error) return latestControl.error
  const choiceUpdates = []
  for (const item of getJobItems(jobId)) {
    const metadata = parseItemMetadata(item)
    const request = metadata.selectionRequest
    if (!request) continue
    const choices = payload.componentSelections?.[item.item_id]
    if (!choices || choices.binding !== request.binding || !Array.isArray(choices.selected)) {
      return { success: false, code: 'install_engine.selection_required', message: '请完成所有待处理安装项的组件选择' }
    }
    const ids = new Set(request.groups.flatMap((group) => group.options.map((option) => option.id)))
    const selected = new Set(choices.selected)
    if (selected.size !== choices.selected.length || choices.selected.some((id) => !ids.has(id))) {
      return { success: false, message: '组件选择包含重复或未知选项' }
    }
    for (const group of request.groups) {
      const count = group.options.filter((option) => selected.has(option.id)).length
      if (count < group.min || count > group.max || group.options.some((option) => (selected.has(option.id) && !option.available) || (option.required && option.available && !selected.has(option.id)))) {
        return { success: false, message: `组件组 ${group.label || group.id} 不符合选择要求` }
      }
    }
    choiceUpdates.push({ item, metadata, choices })
  }
  runInTransaction(() => {
    for (const { item, metadata, choices } of choiceUpdates) {
      mergeItemMetadata(item, {
        selectionRequest: null,
        installPayload: { ...metadata.installPayload, installChoices: toPlainJson(choices, {}) }
      })
    }
  })
  const detail = resetJobForRetry(jobId)
  if (!detail) {
    return {
      success: false,
      message: '安装任务不存在'
    }
  }
  emitLog(jobId, '', 'info', '用户重试安装任务')
  emitJob(jobId)
  scheduleRunJob(
    event,
    jobId,
    {
      message: '安装任务重试失败'
    },
    '重试失败'
  )
  return {
    success: true,
    jobId,
    message: '已重新加入安装队列'
  }
}

export async function cancelSourceInstallTask(payload = {}, internalOptions = {}) {
  const control = getTaskForAction(payload, INSTALL_TASK_ACTION.CANCEL)
  if (control.error) return control.error
  const { jobId } = control
  await nexusAuthorizationTaskService.cancelJob(jobId)
  const runningJob = runningJobMap.get(jobId)
  const detail = getJobDetail(jobId)
  if (!detail) {
    return {
      success: false,
      message: '安装任务不存在'
    }
  }

  updateJob(jobId, {
    state: JOB_STATE.CANCELLED,
    current_step: '任务已取消'
  })
  // PR5/A2：中断在途阶段，让正在执行的安装尽快在阶段边界停止。
  abortRunningJob(jobId, createTaskCancelledError(nativeText('installTaskCancelled')))
  detail.items.forEach((item) => {
    if (!TERMINAL_ITEM_STATES.has(item.state)) {
      updateItemState(item, {
        state: ITEM_STATE.CANCELLED,
        error_message: '任务已取消',
        progress: 100
      })
    }
  })
  if (internalOptions.preserveArtifacts !== true) {
    for (const artifact of detail.artifacts || []) {
      const stillNeeded = collectArtifactJobItems(artifact.artifact_key).some(({ item, job }) =>
        job && job.job_id !== jobId && job.state !== JOB_STATE.CANCELLED &&
        !TERMINAL_ITEM_STATES.has(item.state)
      )
      if (stillNeeded) continue
      transientNexusDownloadUrlMap.delete(artifact.artifact_key)
      if ([ARTIFACT_STATE.QUEUED, ARTIFACT_STATE.DOWNLOADING].includes(artifact.state)) {
        await cancelSourceInstallDownloadTask(artifact.download_task_id)
        updateArtifactState(artifact.artifact_key, {
          state: ARTIFACT_STATE.CANCELLED,
          error_message: '任务已取消'
        })
        rejectArtifactDownload(artifact.artifact_key, createTaskCancelledError('安装任务已取消'))
      }
    }
  }
  if (payload?.awaitStopped === true && runningJob) {
    await Promise.resolve(runningJob).catch(() => {})
  }
  emitLog(jobId, '', 'info', '用户取消安装任务')
  emitJob(jobId)
  return {
    success: true,
    message: '任务已取消'
  }
}

export async function performNexusAuthorizationTaskAction(event, payload = {}) {
  return await nexusAuthorizationTaskService.performAction(event, payload)
}

export function pauseSourceInstallTask(payload = {}) {
  const control = getTaskForAction(payload, INSTALL_TASK_ACTION.PAUSE)
  if (control.error) return control.error
  const { jobId } = control
  updateJob(jobId, {
    state: JOB_STATE.PAUSED,
    current_step: '已暂停'
  })
  // PR5/A2：暂停同样中断在途阶段，恢复时由 runJob 重新处理剩余安装项。
  abortRunningJob(jobId, createTaskPausedError(nativeText('installTaskPaused')))
  emitLog(jobId, '', 'info', '用户暂停安装任务')
  emitJob(jobId)
  return {
    success: true,
    message: '任务已暂停'
  }
}

export async function resumeSourceInstallTask(event, payload = {}) {
  const control = getTaskForAction(payload, INSTALL_TASK_ACTION.RESUME)
  if (control.error) return control.error
  const { jobId } = control
  await runningJobMap.get(jobId)?.catch(() => {})
  const existingJob = getJob(jobId)
  try { await assertInstallSourceAvailable({ ...parseJsonObject(existingJob?.payload_json, {}), source: existingJob?.source }) } catch (error) { return { success: false, code: error.code, errorCode: error.code, message: error.message } }
  const latestControl = getTaskForAction(payload, INSTALL_TASK_ACTION.RESUME)
  if (latestControl.error) return latestControl.error
  updateJob(jobId, {
    state: JOB_STATE.QUEUED,
    current_step: '继续执行'
  })
  emitLog(jobId, '', 'info', '用户继续安装任务')
  emitJob(jobId)
  scheduleRunJob(
    event,
    jobId,
    {
      message: '继续任务失败'
    },
    '继续任务失败'
  )
  return {
    success: true,
    message: '任务已继续'
  }
}

export async function clearCompletedSourceInstallTasks() {
  const result = clearCompletedJobs()
  if (result?.success === false) {
    return buildTaskControlFailure(
      result.reasonCode || 'task_state_changed',
      result.message || '清理历史任务失败',
      { rejected: result.rejected || [] }
    )
  }
  const cacheCleanup = await cleanupOfflinePackCache({
    retentionDays: 0,
    force: true
  })
  return {
    success: true,
    clearedCount: Number(result?.changes || 0),
    cacheCleanup: cacheCleanup?.data || null,
    message: '已清除完成任务'
  }
}

export async function deleteSourceInstallTasksByIds(payload = {}) {
  const control = getTaskForAction(payload, INSTALL_TASK_ACTION.DELETE)
  if (control.error) return control.error
  const { jobIds, jobs } = control
  const cacheKeys = jobs
    .map((job) => resolveOfflinePackCacheKeyFromPayload(parseJsonObject(job?.payload_json, {})))
    .filter(Boolean)
  const expectedStates = Object.fromEntries(jobs.map((job) => [job.job_id, job.state]))
  const result = deleteJobsByIds(jobIds, { expectedStates })
  if (result?.success === false) {
    return buildTaskControlFailure(
      result.reasonCode || 'task_delete_not_terminal',
      result.message || '删除任务失败',
      { rejected: result.rejected || [] }
    )
  }
  const cacheCleanup = cacheKeys.length
    ? await cleanupOfflinePackCache({
        retentionDays: 0,
        force: true,
        packageSha256s: cacheKeys
      })
    : null
  return {
    success: true,
    deletedCount: Number(result?.changes || 0),
    deletedIds: result?.deletedIds || [],
    cacheCleanup: cacheCleanup?.data || null,
    message: `已删除 ${Number(result?.changes || 0)} 个任务`
  }
}
