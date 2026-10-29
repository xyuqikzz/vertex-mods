import { BrowserWindow } from 'electron'
import {
  buildDownloadCenterLifecycleProjection,
  SOURCE_INSTALL_TASK_EVENTS,
  toPlainJson
} from './contracts.js'

const DOWNLOAD_LIFECYCLE_CHANNELS = new Set([
  'download-progress',
  'download-progress-1',
  'download-success',
  'download-failed',
  'download-canceled'
])

function sendToAllRenderer(channel = '', payload = {}) {
  const safeChannel = String(channel || '').trim()
  if (!safeChannel) {
    return
  }

  const safePayload = toPlainJson(payload, {})
  BrowserWindow.getAllWindows().forEach((window) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(safeChannel, safePayload)
    }
  })
}

export function emitJobUpdated(payload = {}) {
  sendToAllRenderer(SOURCE_INSTALL_TASK_EVENTS.JOB_UPDATED, payload)
}

export function emitItemUpdated(payload = {}) {
  sendToAllRenderer(SOURCE_INSTALL_TASK_EVENTS.ITEM_UPDATED, payload)
}

export function emitArtifactUpdated(payload = {}) {
  sendToAllRenderer(SOURCE_INSTALL_TASK_EVENTS.ARTIFACT_UPDATED, payload)
}

export function emitSourceInstallDownloadEnqueued(payload = {}) {
  sendToAllRenderer(SOURCE_INSTALL_TASK_EVENTS.DOWNLOAD_ENQUEUED, payload)
}

export function emitSourceInstallDownloadLifecycle(channel = '', payload = {}) {
  const safeChannel = String(channel || '').trim()
  if (!DOWNLOAD_LIFECYCLE_CHANNELS.has(safeChannel)) {
    return
  }
  sendToAllRenderer(safeChannel, buildDownloadCenterLifecycleProjection(payload))
}

export function emitTaskLog(payload = {}) {
  sendToAllRenderer(SOURCE_INSTALL_TASK_EVENTS.LOG, payload)
}
