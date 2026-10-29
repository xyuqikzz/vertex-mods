import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

function invokeIpc(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

export function analyzeLocalModSources(payload = {}) {
  return invokeIpc('localModImport:analyze', payload)
}

export function listLocalModLibrary(payload = {}) {
  return invokeIpc('localModImport:listLibrary', payload)
}
