import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

function invokeIpc(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

export function pickLocalModSources(payload = {}) {
  return invokeIpc('localModManager:pickSources', payload)
}

export function analyzeLocalModSources(payload = {}) {
  return invokeIpc('localModManager:analyze', payload)
}

export function commitLocalModManagement(payload = {}) {
  return invokeIpc('localModManager:commit', payload)
}

export function listLocalModAssets(payload = {}) {
  return invokeIpc('localModManager:listAssets', payload)
}

export function deleteLocalModAsset(payload = {}) {
  return invokeIpc('localModManager:deleteAsset', payload)
}

export function resolveLocalModInstallTarget(payload = {}) {
  return invokeIpc('localModManager:resolveInstallTarget', payload)
}

export function selectLocalModInstallTargetFolder(payload = {}) {
  return invokeIpc('localModManager:selectInstallTargetFolder', payload)
}

export function createLocalModInstallTask(payload = {}) {
  return invokeIpc('localModManager:createInstallTask', payload)
}

export function openLocalModPath(payload = {}) {
  return invokeIpc('localModManager:openPath', payload)
}
