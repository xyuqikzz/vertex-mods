import electron from 'electron'
import dbInstance from '../../../db/dbInstance.js'
import {
  appendAgentTaskLogToDatabase,
  createAgentTaskInDatabase,
  ensureAgentTaskSchemaForDatabase,
  getAgentTaskFromDatabase,
  listAgentTasksFromDatabase,
  updateAgentTaskInDatabase
} from './taskCenterStore.js'
export {
  AGENT_TASK_STAGE,
  createAgentTaskId,
  normalizeAgentTaskRow
} from './taskCenterStore.js'

export const AGENT_TASK_EVENTS = Object.freeze({
  UPDATED: 'agent-task:updated',
  LOG: 'agent-task:log'
})

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function getBrowserWindow() {
  const browserWindow = electron && typeof electron === 'object' ? electron.BrowserWindow : null
  return browserWindow && typeof browserWindow.getAllWindows === 'function' ? browserWindow : null
}

function sendToAllRenderer(channel = '', payload = {}) {
  const safeChannel = toSafeText(channel)
  if (!safeChannel) return

  const BrowserWindow = getBrowserWindow()
  if (!BrowserWindow) return

  const safePayload = toPlainJson(payload, {})
  BrowserWindow.getAllWindows().forEach((window) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(safeChannel, safePayload)
    }
  })
}

export async function ensureAgentTaskSchema() {
  ensureAgentTaskSchemaForDatabase(dbInstance)
}

export async function createAgentTask(options = {}) {
  const createdTask = await createAgentTaskInDatabase(dbInstance, options)
  sendToAllRenderer(AGENT_TASK_EVENTS.UPDATED, createdTask)
  return createdTask
}

export async function getAgentTask(taskId = '') {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  return await getAgentTaskFromDatabase(dbInstance, safeTaskId)
}

export async function listAgentTasks(options = {}) {
  return await listAgentTasksFromDatabase(dbInstance, options)
}

export async function updateAgentTask(taskId = '', patch = {}) {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  const updatedTask = await updateAgentTaskInDatabase(dbInstance, safeTaskId, patch)
  sendToAllRenderer(AGENT_TASK_EVENTS.UPDATED, updatedTask)
  return updatedTask
}

export async function appendAgentTaskLog(taskId = '', level = 'info', message = '', detail = {}) {
  const safeTaskId = toSafeText(taskId)
  if (!safeTaskId) return null

  const log = await appendAgentTaskLogToDatabase(dbInstance, safeTaskId, level, message, detail)
  sendToAllRenderer(AGENT_TASK_EVENTS.LOG, log)
  return log
}
