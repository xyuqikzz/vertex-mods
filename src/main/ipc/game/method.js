import * as operations from '../../services/gameOperations.js'
import {
  readGameAppIds,
  readGameListSnapshot,
  readLegacyModLists,
  readLegacyModInstallRecords,
  readRecentInstalledMods
} from '../../services/gameCatalog.js'
import { createGameOperationContext } from './operationContext.js'
export { resolveLifecycleAuthorization } from './install-engine/lifecycleAuthorization.js'

// 保留外部调用签名；sender/路径/能力校验仍在统一 IPC 注册边界执行。
export { nexusUpsertDetectedGamePath } from '../../services/gameOperations.js'

export async function getGameLocalByAppId(event, data) {
  return await operations.getGameLocalByAppId(createGameOperationContext(event), data)
}

export async function scanNowGameById(event, data) {
  return await operations.scanNowGameById(createGameOperationContext(event), data)
}

export async function manuallyAddGame(event, data) {
  return await operations.manuallyAddGame(createGameOperationContext(event), data)
}

export async function getModInstallRecord(event, steamAppId) {
  createGameOperationContext(event).reply(
    'getModInstallRecordSuccess',
    readLegacyModInstallRecords(steamAppId)
  )
}

export async function installModsV2(event, filePath, data, type = 1) {
  return await operations.installModsV2(createGameOperationContext(event), filePath, data, type)
}

export async function previewArchiveStructure(event, payload = {}) {
  return await operations.previewArchiveStructure(createGameOperationContext(event), payload)
}

export async function inspectSourceInstallPlan(event, payload = {}) {
  return await operations.inspectSourceInstallPlan(createGameOperationContext(event), payload)
}

export async function inspectNexusInstallPlan(event, payload = {}) {
  return await operations.inspectNexusInstallPlan(createGameOperationContext(event), payload)
}

export { getInstalledModsBySource } from '../../services/gameOperations.js'

export { checkModFileOccupancy } from '../../services/gameOperations.js'

export async function uninstallMod(event, id) {
  return await operations.uninstallMod(createGameOperationContext(event), id)
}

export async function uninstallModById(event, payload = {}) {
  return await operations.uninstallModById(createGameOperationContext(event), payload)
}

export async function uninstallAllMods(event, id) {
  return await operations.uninstallAllMods(createGameOperationContext(event), id)
}

export async function uninstallServerMod(event, data) {
  return await operations.uninstallServerMod(createGameOperationContext(event), data)
}

export function switchGameServerModType(event, data) {
  return operations.switchGameServerModType(createGameOperationContext(event), data)
}

export function getGameAppIdList(event) {
  createGameOperationContext(event).reply('getGameAppIdListSuccess', readGameAppIds())
}

export function getGameListData(event, replyChannel = 'getGameListDataSuccess') {
  createGameOperationContext(event).reply(replyChannel, readGameListSnapshot())
}

export function getRecentInstalledMods(payload = {}) {
  return readRecentInstalledMods(payload)
}

export function getModListByAppId(event, payload) {
  createGameOperationContext(event).reply('getModListByAppIdSuccess', readLegacyModLists(payload))
}

export async function saveModPriorityOrder(event, payload = {}) {
  return await operations.saveModPriorityOrder(createGameOperationContext(event), payload)
}

export async function executeToggleModState(event, data, taskContext = {}) {
  return await operations.executeToggleModState(
    createGameOperationContext(event),
    data,
    taskContext
  )
}

export async function setModActiveStateForDeploymentRollback(event, data = {}, taskContext = {}) {
  return await operations.setModActiveStateForDeploymentRollback(
    createGameOperationContext(event),
    data,
    taskContext
  )
}

export async function toggleModState(event, data = {}) {
  return await operations.toggleModState(createGameOperationContext(event), data)
}

export async function executeBulkModAction(event, payload = {}) {
  return await operations.executeBulkModAction(createGameOperationContext(event), payload)
}

export async function removeGame(event, id) {
  return await operations.removeGame(createGameOperationContext(event), id)
}
