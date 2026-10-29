import crypto from 'crypto'
import { INSTALL_FLOW_CONFIG } from '../../../shared/installation/install-flow-config.js'

const taskMap = new Map()

function toSafeText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function createTaskId(type = 'task') {
  return `${toSafeText(type, 'task')}:${crypto.randomUUID()}`
}

function emitTaskProgress(event, task = {}) {
  if (!event || typeof event.reply !== 'function') {
    return
  }
  event.reply('mod-task-progress', {
    taskId: task.taskId,
    type: task.type,
    stage: task.stage,
    progress: task.progress,
    currentTarget: task.currentTarget,
    errorCode: task.errorCode,
    cancelable: task.cancelable
  })
}

export async function runModTask(options = {}) {
  const task = {
    taskId: toSafeText(options.taskId) || createTaskId(options.type),
    type: toSafeText(options.type || 'task'),
    stage: 'queued',
    progress: 0,
    currentTarget: '',
    errorCode: '',
    cancelable: options.cancelable !== false,
    cancelled: false
  }
  taskMap.set(task.taskId, task)

  const update = (patch = {}) => {
    Object.assign(task, patch)
    emitTaskProgress(options.event, task)
  }

  try {
    update({ stage: 'preflight', progress: 5 })
    const result = await options.execute({
      task,
      update,
      isCancelled: () => task.cancelled
    })
    const normalizedResult =
      result && typeof result === 'object' && !Array.isArray(result)
        ? result
        : {
            result
          }

    if (normalizedResult.success === false) {
      update({
        stage: 'failed',
        errorCode: toSafeText(normalizedResult.errorCode || 'TASK_RESULT_FAILED')
      })
      return {
        ...normalizedResult,
        success: false,
        taskId: task.taskId,
        result: normalizedResult,
        message: toSafeText(normalizedResult.message || '任务执行失败')
      }
    }

    update({ stage: 'completed', progress: 100 })
    return {
      ...normalizedResult,
      success: true,
      taskId: task.taskId,
      result: normalizedResult,
      message: toSafeText(normalizedResult.message || '任务执行完成')
    }
  } catch (error) {
    update({
      stage: task.cancelled ? 'cancelled' : 'failed',
      errorCode: toSafeText(error?.code || 'TASK_FAILED')
    })
    return {
      success: false,
      taskId: task.taskId,
      message: toSafeText(error?.message || '任务执行失败')
    }
  } finally {
    setTimeout(() => {
      taskMap.delete(task.taskId)
    }, INSTALL_FLOW_CONFIG.install.taskSchedulerRetainMs)
  }
}
