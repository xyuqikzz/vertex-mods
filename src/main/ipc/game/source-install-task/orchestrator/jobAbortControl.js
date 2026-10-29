/**
 * orchestrator/jobAbortControl.js — 任务控制错误工厂（纯函数）
 *
 * 取消/暂停的错误工厂与判定。AbortController 运行期相关的
 * abortRunningJob / getJobAbortSignal / waitWithAbort / createAbortError
 * 仍由编排入口持有（与 abortControllerMap 运行期状态强耦合）。
 */
import { SOURCE_INSTALL_TASK_ERROR_CODE } from '../contracts.js'

export function createTaskControlError(code = '', message = '') {
  const error = new Error(message)
  error.code = code
  return error
}

export function createTaskCancelledError(message = '安装任务已取消') {
  return createTaskControlError(SOURCE_INSTALL_TASK_ERROR_CODE.CANCELLED, message)
}

export function createTaskPausedError(message = '安装任务已暂停') {
  return createTaskControlError(SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED, message)
}

export function isTaskControlError(error = null) {
  return [
    SOURCE_INSTALL_TASK_ERROR_CODE.CANCELLED,
    SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED
  ].includes(error?.code)
}
