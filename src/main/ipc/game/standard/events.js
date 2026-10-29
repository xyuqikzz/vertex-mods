import crypto from 'crypto'
import {
  INSTALL_STATES,
  STANDARD_INSTALL_EVENT,
  STANDARD_TASK_CHANNEL
} from './constants.js'
import { toPublicErrorPayload } from './errors.js'

export function createStandardTaskId(prefix = 'standard_install') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

function sendIpcEvent(event, channel, payload) {
  if (!event || !channel) return

  try {
    const sender = event.sender || event
    if (sender && typeof sender.send === 'function') {
      sender.send(channel, payload)
      return
    }
    if (typeof event.reply === 'function') {
      event.reply(channel, payload)
    }
  } catch {
    // 标准事件是观测通道，发送失败不应影响安装主流程。
  }
}

export function emitStandardInstallEvent(event, eventName, payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const taskEvent = {
    event: eventName,
    name: eventName,
    state: safePayload.state || '',
    taskId: safePayload.taskId || '',
    source: safePayload.source || '',
    progress: Number(safePayload.progress || 0),
    message: String(safePayload.message || ''),
    createdAt: new Date().toISOString(),
    ...safePayload
  }

  sendIpcEvent(event, STANDARD_TASK_CHANNEL, taskEvent)
  sendIpcEvent(event, eventName, taskEvent)
}

export class StandardInstallStateMachine {
  constructor(options = {}) {
    this.event = options.event || null
    this.taskId = options.taskId || createStandardTaskId()
    this.source = options.source || ''
    this.state = INSTALL_STATES.CREATED
    this.history = []
    this.emit(STANDARD_INSTALL_EVENT.TASK_CREATED, {
      state: this.state,
      progress: 0,
      message: '标准安装任务已创建'
    })
  }

  transition(state, payload = {}) {
    this.state = state
    this.history.push({
      state,
      at: new Date().toISOString()
    })
    this.emit(payload.eventName || state.toLowerCase(), {
      ...payload,
      state
    })
  }

  emit(eventName, payload = {}) {
    emitStandardInstallEvent(this.event, eventName, {
      ...payload,
      taskId: this.taskId,
      source: this.source,
      state: payload.state || this.state
    })
  }

  fail(error, options = {}) {
    const recoverable = options.recoverable !== false && error?.recoverable !== false
    const state = recoverable ? INSTALL_STATES.FAILED_RETRYABLE : INSTALL_STATES.FAILED_FATAL
    this.transition(state, {
      eventName: STANDARD_INSTALL_EVENT.TASK_FAILED,
      progress: Number(options.progress || 100),
      message: String(error?.message || '标准安装任务失败'),
      error: toPublicErrorPayload(error)
    })
  }
}
