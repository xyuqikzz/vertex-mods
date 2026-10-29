import { EventEmitter } from 'events'
import { addTasksToQueue, removeDownloadTask } from '../../download/method.js'
import { buildDownloadCenterTaskProjection, toPlainJson, toSafeText } from './contracts.js'
import {
  emitSourceInstallDownloadEnqueued,
  emitSourceInstallDownloadLifecycle
} from './taskEvents.js'

export const sourceInstallDownloadBridgeEvents = new EventEmitter()

function buildEventRef(artifactKey = '') {
  return {
    reply(channel = '', payload = {}) {
      const safeChannel = String(channel || '').trim()
      const safePayload = toPlainJson(payload, {})
      if (!safeChannel) {
        return
      }

      emitSourceInstallDownloadLifecycle(safeChannel, safePayload)

      if (safeChannel === 'download-progress' || safeChannel === 'download-progress-1') {
        sourceInstallDownloadBridgeEvents.emit('progress', {
          artifactKey,
          payload: safePayload
        })
        return
      }

      if (safeChannel === 'download-success') {
        sourceInstallDownloadBridgeEvents.emit('success', {
          artifactKey,
          payload: safePayload
        })
        return
      }

      if (safeChannel === 'download-failed') {
        sourceInstallDownloadBridgeEvents.emit('failed', {
          artifactKey,
          payload: safePayload
        })
        return
      }

      if (safeChannel === 'download-canceled') {
        sourceInstallDownloadBridgeEvents.emit('cancelled', {
          artifactKey,
          payload: safePayload
        })
      }
    }
  }
}

export function createSourceInstallDownloadTask(artifactKey = '', task = {}) {
  const safeArtifactKey = toSafeText(artifactKey)
  if (!safeArtifactKey) {
    throw new Error('缺少下载产物唯一键')
  }
  const safeTask = toPlainJson(task, {})
  if (!toSafeText(safeTask.download_url)) {
    throw new Error('缺少下载地址')
  }

  addTasksToQueue(buildEventRef(safeArtifactKey), safeTask)
  emitSourceInstallDownloadEnqueued(buildDownloadCenterTaskProjection(safeTask))
  return safeTask
}

export async function cancelSourceInstallDownloadTask(downloadTaskId = '') {
  const safeTaskId = toSafeText(downloadTaskId)
  if (!safeTaskId) {
    return
  }
  await removeDownloadTask(buildEventRef(''), safeTaskId)
}
