import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

function invokeIpc(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

export async function resolveFicsitGamePath(payload = {}) {
  return await invokeIpc('ficsitResolveGamePath', payload)
}

export async function getFicsitInstalledMods(payload = {}) {
  return await invokeIpc('ficsitGetInstalledMods', payload)
}

export async function ficsitCheckModFileOccupancy(payload = {}) {
  return await invokeIpc('ficsitCheckModFileOccupancy', payload)
}

export async function installFicsitMod(payload = {}) {
  return await invokeIpc('ficsitInstallMod', payload)
}

export async function prepareFicsitInstallPlan(payload = {}) {
  return await invokeIpc('ficsitPrepareInstallPlan', payload)
}

export async function previewSourceInstall(payload = {}) {
  return await invokeIpc('source-install:preview', payload)
}

export async function executeSourceInstall(payload = {}) {
  return await invokeIpc('source-install:execute', payload)
}

export async function submitSourceInstallTask(payload = {}) {
  return await invokeIpc('source-install-task:create', payload)
}

export async function setFicsitModEnabled(payload = {}) {
  return await invokeIpc('ficsitSetModEnabled', payload)
}

export async function uninstallFicsitMod(payload = {}) {
  return await invokeIpc('ficsitUninstallMod', payload)
}

export async function saveFicsitModPriorityOrder(payload = {}) {
  return await invokeIpc('saveModPriorityOrder', {
    ...payload,
    source: 'ficsit',
    endpointType: 0
  })
}
