import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

export const OFFLINE_PACK_IMPORT_EVENT = 'vertex:open-offline-pack'
export const OFFLINE_PACK_EXPORT_EVENT = 'vertex:export-offline-pack'

function invokeIpc(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

export function estimateVxpackExportSize(payload = {}) {
  return invokeIpc('vxpack:estimateExportSize', payload)
}

export function openVxpackExportFolder(payload = {}) {
  return invokeIpc('vxpack:openExportFolder', payload)
}

export function inspectOfflinePack(payload = {}) {
  return invokeIpc('offline-pack:inspectFile', payload)
}

export function pickOfflinePackImportFile() {
  return invokeIpc('offline-pack:pickImportFile', {})
}

export function createOfflinePack(payload = {}) {
  return invokeIpc('offline-pack:create', payload)
}

export function submitOfflinePackInstall(payload = {}) {
  return invokeIpc('offline-pack:submitInstall', payload)
}

export function cleanupOfflinePackCache(payload = {}) {
  return invokeIpc('offline-pack:cleanupCache', payload)
}

export function openOfflinePackImportDialog(packagePath = '') {
  const safePath = String(packagePath || '').trim()
  if (!safePath) return
  window.dispatchEvent(
    new CustomEvent(OFFLINE_PACK_IMPORT_EVENT, {
      detail: {
        packagePath: safePath
      }
    })
  )
}

export function openOfflinePackExportDialog(payload = {}) {
  if (!payload || typeof payload !== 'object') return
  window.dispatchEvent(
    new CustomEvent(OFFLINE_PACK_EXPORT_EVENT, {
      detail: payload
    })
  )
}
