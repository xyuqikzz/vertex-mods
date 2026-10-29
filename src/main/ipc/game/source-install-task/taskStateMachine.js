import {
  ITEM_STATE,
  JOB_STATE,
  TERMINAL_ITEM_STATES,
  toSafeNumber
} from './contracts.js'
import {
  assertInstallTaskActionAllowed,
  INSTALL_TASK_ACTION
} from '../../../../shared/tasks/install-task-center-policy.js'

// 任务是否处于停止态（取消/暂停），用于在阶段边界中止后续执行。
export function isJobStopped(job = {}) {
  return [JOB_STATE.CANCELLED, JOB_STATE.PAUSED].includes(job?.state)
}

// 安装项是否已处于终态（终态项的状态流转应被忽略，避免回写覆盖）。
export function isItemTransitionIgnorable(item = {}) {
  return TERMINAL_ITEM_STATES.has(item?.state)
}

// ── 事件驱动状态裁决（单一来源；纯函数，可表驱动单测） ──
//
// 编排核心目前仍以行为护栏（终态保护、取消/暂停断言）保证运行期一致性；本表把
// 「(当前态, 事件) -> {allowed, nextState}」沉淀为权威规格，供裁决/单测复用，
// 后续 runner/bridge 可逐步以此替换散落的内联状态判断。

export const ITEM_EVENT = Object.freeze({
  PRECHECK_START: 'precheck_start',
  PRECHECK_BLOCK: 'precheck_block',
  WAIT_DEPENDENCY: 'wait_dependency',
  WAIT_AUTHORIZATION: 'wait_authorization',
  AUTHENTICATE: 'authenticate',
  WAIT_ARTIFACT: 'wait_artifact',
  DOWNLOAD_START: 'download_start',
  DOWNLOAD_DONE: 'download_done',
  INSPECT: 'inspect',
  PREVIEW: 'preview',
  WAIT_INSTALL: 'wait_install',
  INSTALL_START: 'install_start',
  DEPLOY: 'deploy',
  RECORD: 'record',
  HEALTH_CHECK: 'health_check',
  INSTALL_DONE: 'install_done',
  FILE_READY: 'file_ready',
  SKIP_INSTALLED: 'skip_installed',
  SKIP: 'skip',
  FAIL: 'fail',
  CANCEL: 'cancel',
  RETRY: 'retry'
})

const ITEM_EVENT_TARGET = Object.freeze({
  [ITEM_EVENT.PRECHECK_START]: ITEM_STATE.PRECHECKING,
  [ITEM_EVENT.PRECHECK_BLOCK]: ITEM_STATE.PRECHECK_BLOCKED,
  [ITEM_EVENT.WAIT_DEPENDENCY]: ITEM_STATE.WAITING_DEPENDENCY,
  [ITEM_EVENT.WAIT_AUTHORIZATION]: ITEM_STATE.WAITING_AUTHORIZATION,
  [ITEM_EVENT.AUTHENTICATE]: ITEM_STATE.AUTHENTICATING,
  [ITEM_EVENT.WAIT_ARTIFACT]: ITEM_STATE.WAITING_ARTIFACT,
  [ITEM_EVENT.DOWNLOAD_START]: ITEM_STATE.DOWNLOADING,
  [ITEM_EVENT.DOWNLOAD_DONE]: ITEM_STATE.DOWNLOADED,
  [ITEM_EVENT.INSPECT]: ITEM_STATE.INSPECTING_ARCHIVE,
  [ITEM_EVENT.PREVIEW]: ITEM_STATE.PREVIEWING,
  [ITEM_EVENT.WAIT_INSTALL]: ITEM_STATE.WAITING_INSTALL,
  [ITEM_EVENT.INSTALL_START]: ITEM_STATE.INSTALLING,
  [ITEM_EVENT.DEPLOY]: ITEM_STATE.DEPLOYING,
  [ITEM_EVENT.RECORD]: ITEM_STATE.RECORDING,
  [ITEM_EVENT.HEALTH_CHECK]: ITEM_STATE.HEALTH_CHECKING,
  [ITEM_EVENT.INSTALL_DONE]: ITEM_STATE.INSTALLED,
  [ITEM_EVENT.FILE_READY]: ITEM_STATE.FILE_READY,
  [ITEM_EVENT.SKIP_INSTALLED]: ITEM_STATE.SKIPPED_INSTALLED,
  [ITEM_EVENT.SKIP]: ITEM_STATE.SKIPPED,
  [ITEM_EVENT.FAIL]: ITEM_STATE.FAILED,
  [ITEM_EVENT.CANCEL]: ITEM_STATE.CANCELLED,
  [ITEM_EVENT.RETRY]: ITEM_STATE.CREATED
})

/**
 * 裁决安装项状态转移。
 * 终态保护：终态项除 RETRY（重试复位）外拒绝任何事件，杜绝「取消后又被写回 INSTALLED」竞态。
 * @returns {{ allowed: boolean, nextState: string, reason: string }}
 */
export function decideItemTransition(currentState = '', event = '') {
  const target = ITEM_EVENT_TARGET[event]
  if (!target) {
    return { allowed: false, nextState: currentState, reason: 'unknown_event' }
  }

  const isTerminal = TERMINAL_ITEM_STATES.has(currentState)
  if (event === ITEM_EVENT.RETRY) {
    return isTerminal
      ? { allowed: true, nextState: ITEM_STATE.CREATED, reason: 'retry_reset' }
      : { allowed: false, nextState: currentState, reason: 'retry_only_terminal' }
  }

  if (isTerminal) {
    return { allowed: false, nextState: currentState, reason: 'terminal_locked' }
  }

  return { allowed: true, nextState: target, reason: 'ok' }
}

export const JOB_CONTROL_EVENT = Object.freeze({
  CANCEL: INSTALL_TASK_ACTION.CANCEL,
  PAUSE: INSTALL_TASK_ACTION.PAUSE,
  RESUME: INSTALL_TASK_ACTION.RESUME,
  RETRY: INSTALL_TASK_ACTION.RETRY
})

const JOB_CONTROL_TARGET = Object.freeze({
  [JOB_CONTROL_EVENT.CANCEL]: JOB_STATE.CANCELLED,
  [JOB_CONTROL_EVENT.PAUSE]: JOB_STATE.PAUSED,
  [JOB_CONTROL_EVENT.RESUME]: JOB_STATE.QUEUED,
  [JOB_CONTROL_EVENT.RETRY]: JOB_STATE.QUEUED
})

/**
 * 裁决任务级控制事件（取消/暂停/恢复/重试）。
 * @returns {{ allowed: boolean, nextState: string, reason: string }}
 */
export function decideJobControlTransition(currentState = '', event = '') {
  const nextState = JOB_CONTROL_TARGET[event]
  if (!nextState) {
    return { allowed: false, nextState: currentState, reason: 'unknown_event' }
  }
  try {
    assertInstallTaskActionAllowed({ state: currentState }, event)
    return { allowed: true, nextState, reason: 'ok' }
  } catch (error) {
    return {
      allowed: false,
      nextState: currentState,
      reason: error?.code || 'task_action_not_allowed'
    }
  }
}

export function summarizeJobState(items = []) {
  const safeItems = Array.isArray(items) ? items : []
  if (!safeItems.length) {
    return {
      state: JOB_STATE.FAILED,
      progress: 0,
      currentStep: '没有可安装项'
    }
  }

  const installedCount = safeItems.filter((item) =>
    [ITEM_STATE.INSTALLED, ITEM_STATE.FILE_READY, ITEM_STATE.SKIPPED_INSTALLED].includes(item.state)
  ).length
  const failedCount = safeItems.filter((item) => item.state === ITEM_STATE.FAILED).length
  const blockedCount = safeItems.filter((item) => item.state === ITEM_STATE.PRECHECK_BLOCKED).length
  const cancelledCount = safeItems.filter((item) => item.state === ITEM_STATE.CANCELLED).length
  const progress = Math.round(
    safeItems.reduce((sum, item) => sum + toSafeNumber(item.progress, 0), 0) / safeItems.length
  )
  const unfinished = safeItems.find((item) => !TERMINAL_ITEM_STATES.has(item.state))

  if (installedCount === safeItems.length) {
    const downloadOnly = safeItems.every((item) => item.state === ITEM_STATE.FILE_READY)
    return {
      state: JOB_STATE.COMPLETED,
      progress: 100,
      currentStep: downloadOnly ? '下载完成' : '安装完成'
    }
  }
  if (blockedCount === safeItems.length) {
    return {
      state: JOB_STATE.PRECHECK_BLOCKED,
      progress,
      currentStep: '预检阻断'
    }
  }
  if (cancelledCount === safeItems.length) {
    return {
      state: JOB_STATE.CANCELLED,
      progress,
      currentStep: '任务已取消'
    }
  }
  if (!unfinished) {
    if (cancelledCount > 0) {
      return {
        state: JOB_STATE.CANCELLED,
        progress,
        currentStep: '任务已取消'
      }
    }
    if ((failedCount > 0 || blockedCount > 0) && installedCount > 0) {
      return {
        state: JOB_STATE.PARTIAL_FAILED,
        progress,
        currentStep: '部分安装项失败'
      }
    }
    if (failedCount > 0 || blockedCount > 0) {
      return {
        state: blockedCount > 0 && failedCount === 0 ? JOB_STATE.PRECHECK_BLOCKED : JOB_STATE.FAILED,
        progress,
        currentStep: blockedCount > 0 && failedCount === 0 ? '预检阻断' : '安装失败'
      }
    }
    return {
      state: JOB_STATE.COMPLETED,
      progress,
      currentStep: '安装完成'
    }
  }

  const activeStateMap = {
    [ITEM_STATE.PRECHECKING]: [JOB_STATE.PRECHECKING, '预检中'],
    [ITEM_STATE.PRECHECK_BLOCKED]: [JOB_STATE.PRECHECK_BLOCKED, '预检阻断'],
    [ITEM_STATE.WAITING_DEPENDENCY]: [JOB_STATE.WAITING, '等待依赖'],
    [ITEM_STATE.WAITING_AUTHORIZATION]: [
      JOB_STATE.WAITING_USER_ACTION,
      '等待 Nexus 授权'
    ],
    [ITEM_STATE.AUTHENTICATING]: [JOB_STATE.WAITING_USER_ACTION, '正在处理 Nexus 授权'],
    [ITEM_STATE.WAITING_ARTIFACT]: [JOB_STATE.WAITING, '等待下载产物'],
    [ITEM_STATE.DOWNLOADING]: [JOB_STATE.DOWNLOADING, '下载中'],
    [ITEM_STATE.DOWNLOADED]: [JOB_STATE.DOWNLOADED, '下载完成'],
    [ITEM_STATE.INSPECTING_ARCHIVE]: [JOB_STATE.PREVIEWING, '解析压缩包中'],
    [ITEM_STATE.PREVIEWING]: [JOB_STATE.PREVIEWING, '生成安装预案中'],
    [ITEM_STATE.WAITING_INSTALL]: [JOB_STATE.WAITING, '等待安装锁'],
    [ITEM_STATE.INSTALLING]: [JOB_STATE.INSTALLING, '安装中'],
    [ITEM_STATE.DEPLOYING]: [JOB_STATE.INSTALLING, '部署文件中'],
    [ITEM_STATE.RECORDING]: [JOB_STATE.INSTALLING, '写入安装记录中'],
    [ITEM_STATE.HEALTH_CHECKING]: [JOB_STATE.HEALTH_CHECKING, '安装后校验中'],
    [ITEM_STATE.CREATED]: [JOB_STATE.QUEUED, '已排队']
  }
  const [state, currentStep] = activeStateMap[unfinished.state] || [JOB_STATE.QUEUED, '已排队']
  return {
    state,
    progress,
    currentStep
  }
}
