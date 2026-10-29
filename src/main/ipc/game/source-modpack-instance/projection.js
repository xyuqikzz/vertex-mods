import dbInstance from '../../../db/dbInstance.js'
import {
  getSourceModpackInstance,
  getSourceModpackInspectionPlan,
  getSourceModpackOwnershipReferences,
  inspectSourceModpackActualItem,
  listSourceModpackPlanJobs,
  replaceSourceModpackInstanceItems,
  reconcileSourceModpackOwnershipModes,
  updateSourceModpackInspectionPlanState,
  updateSourceModpackInstance,
  updateSourceModpackInstanceJob
} from '../../../db/mods/sourceModpackInstances.js'
import { getJobDetail, findInstalledModByItem } from '../source-install-task/taskStore.js'
import { JOB_STATE } from '../source-install-task/contracts.js'
import { mutateSourceModpackMod } from './modOperations.js'
import { applySourceModpackRemovalOperations } from './removalOperations.js'
import { resolveSourceModpackCommittedOwnershipMode } from './lifecycle.js'

const SUCCESS_STATES = new Set([JOB_STATE.COMPLETED, JOB_STATE.COMPLETED_WITH_WARNING])
const TERMINAL_STATES = new Set([
  ...SUCCESS_STATES,
  JOB_STATE.PARTIAL_FAILED,
  JOB_STATE.FAILED,
  JOB_STATE.CANCELLED,
  JOB_STATE.RECOVERABLE,
  JOB_STATE.PRECHECK_BLOCKED
])
const finalizingPlanTokens = new Set()

function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function itemIdentity(item = {}) {
  return [item.itemKey, item.dependencyRole || 'main', item.originItemKey || item.itemKey]
    .map(toText)
    .join('|')
}

function findJobBinding(detail = {}) {
  const payload = detail.payload || detail.job?.payload || {}
  const sourceMeta = payload.sourceMeta || {}
  const instanceId = toText(sourceMeta.sourceModpackInstanceId)
  const planToken = toText(sourceMeta.sourceModpackPlanToken)
  return { instanceId, planToken }
}

function collectInstalledModMap(planToken = '') {
  const result = new Map()
  for (const job of listSourceModpackPlanJobs(planToken)) {
    const detail = getJobDetail(job.job_id)
    for (const item of detail?.items || []) {
      if (!['installed', 'skipped_installed'].includes(item.state)) continue
      const canonicalItem = item.metadata?.canonicalItem
      if (!canonicalItem?.itemKey) continue
      const installed = findInstalledModByItem(item)
      if (installed?.id) {
        result.set(canonicalItem.itemKey, {
          localModId: toNumber(installed.id, 0),
          reused: item.state === 'skipped_installed'
        })
      }
    }
  }
  return result
}

async function applyRemovalOperations(plan = {}) {
  const silentEvent = { reply() {}, sender: { send() {} } }
  return await applySourceModpackRemovalOperations(plan, {
    getOwnershipReferences: getSourceModpackOwnershipReferences,
    getMod: (localModId) => dbInstance.get('SELECT * FROM mods WHERE id = ?', [localModId]),
    inspectModContent: (localModId) => inspectSourceModpackActualItem(localModId),
    disableMod: async (localModId) =>
      await mutateSourceModpackMod(silentEvent, localModId, 'disable'),
    uninstallMod: async (localModId) =>
      await mutateSourceModpackMod(silentEvent, localModId, 'uninstall')
  })
}

function applyMetadataOperations(plan = {}) {
  for (const operation of plan.diff?.operations || []) {
    if (operation.action !== 'refresh_metadata' || !toNumber(operation.localModId, 0)) continue
    dbInstance.run(
      `UPDATE mods SET name = ?, description = ?, cover = ?, updated_at = ? WHERE id = ?`,
      [
        toText(operation.entry?.name),
        toText(operation.entry?.description),
        toText(operation.entry?.cover),
        new Date().toISOString(),
        toNumber(operation.localModId, 0)
      ]
    )
  }
}

function buildCommittedItem(item = {}, previousItem = null, installed = null, options = {}) {
  const localModId = installed?.localModId || previousItem?.localModId || 0
  const ownershipMode = resolveSourceModpackCommittedOwnershipMode({
    previousItem,
    installed,
    resetPreviousOwnership: options.resetPreviousOwnership === true
  })
  return {
    ...item,
    localModId,
    ownershipMode,
    installedItemHash: item.canonicalItemHash,
    installedPayload: item.installPayload,
    state: localModId ? 'installed' : 'missing'
  }
}

function commitPartialInstalledItems(record = {}) {
  const plan = record.plan || {}
  const canonicalItems = plan.canonicalPlan?.items || []
  const installedModMap = collectInstalledModMap(record.plan_token)
  if (!installedModMap.size) return []

  const previous = getSourceModpackInstance(plan.instanceId)
  const resetPreviousOwnership = plan.reactivation?.resetPreviousOwnership === true
  const previousItemList = resetPreviousOwnership ? [] : previous?.items || []
  const previousItems = new Map(previousItemList.map((item) => [itemIdentity(item), item]))
  const remoteItems = new Map(canonicalItems.map((item) => [itemIdentity(item), item]))
  const committedItems = []

  for (const previousItem of previousItemList) {
    const installed = installedModMap.get(previousItem.itemKey)
    const remoteItem = remoteItems.get(itemIdentity(previousItem))
    if (installed && remoteItem) {
      committedItems.push(buildCommittedItem(remoteItem, previousItem, installed, { resetPreviousOwnership }))
    } else {
      committedItems.push(previousItem)
    }
  }
  for (const item of canonicalItems) {
    if (previousItems.has(itemIdentity(item))) continue
    const installed = installedModMap.get(item.itemKey)
    if (installed) committedItems.push(buildCommittedItem(item, null, installed, { resetPreviousOwnership }))
  }

  replaceSourceModpackInstanceItems(plan.instanceId, committedItems)
  reconcileSourceModpackOwnershipModes(committedItems.map((item) => item.localModId))
  return committedItems
}

async function finalizeSuccessfulPlan(record = {}) {
  const plan = record.plan || {}
  const canonicalPlan = plan.canonicalPlan || {}
  const installedModMap = collectInstalledModMap(record.plan_token)
  const previous = getSourceModpackInstance(plan.instanceId)
  const resetPreviousOwnership = plan.reactivation?.resetPreviousOwnership === true
  const previousItems = new Map(
    (resetPreviousOwnership ? [] : previous?.items || []).map((item) => [itemIdentity(item), item])
  )
  const requiredInstallKeys = new Set((plan.diff?.operations || [])
    .filter((operation) => ['install', 'replace'].includes(operation.action))
    .map((operation) => operation.itemKey))
  const missingInstalledItems = (canonicalPlan.items || []).filter((item) =>
    !installedModMap.get(item.itemKey)?.localModId &&
    (requiredInstallKeys.has(item.itemKey) || !previousItems.get(itemIdentity(item))?.localModId))
  if (missingInstalledItems.length) {
    commitPartialInstalledItems(record)
    throw new Error(`安装任务结束但缺少本地模组记录：${missingInstalledItems.map((item) => item.name || item.itemKey).join('、')}`)
  }
  applyMetadataOperations(plan)
  const removalFailures = await applyRemovalOperations(plan)
  if (removalFailures.length) {
    commitPartialInstalledItems(record)
    const firstFailure = removalFailures[0]
    const failureTarget = toText(firstFailure?.name || firstFailure?.itemKey) || '模组'
    const failureReason = toText(firstFailure?.message) || '未能安全移除'
    updateSourceModpackInspectionPlanState(record.plan_token, 'partial')
    updateSourceModpackInstance(plan.instanceId, {
      state: 'partial',
      lastErrorCode: 'partial_update',
      lastErrorMessage:
        removalFailures.length === 1
          ? `${failureTarget}：${failureReason}`
          : `${failureTarget}：${failureReason}，另有 ${removalFailures.length - 1} 个移除项失败`
    })
    return { success: false, code: 'partial_update', failures: removalFailures }
  }

  const committedItems = (canonicalPlan.items || []).map((item) =>
    buildCommittedItem(
      item,
      previousItems.get(itemIdentity(item)),
      installedModMap.get(item.itemKey),
      { resetPreviousOwnership }
    )
  )
  replaceSourceModpackInstanceItems(plan.instanceId, committedItems)
  reconcileSourceModpackOwnershipModes(committedItems.map((item) => item.localModId))
  updateSourceModpackInstance(plan.instanceId, {
    state: committedItems.some((item) => !item.localModId) ? 'repair_required' : 'ready',
    installedRevision: canonicalPlan.remote?.revision,
    installedManifestHash: canonicalPlan.remote?.manifestHash,
    desiredRevision: canonicalPlan.remote?.revision,
    desiredManifestHash: canonicalPlan.remote?.manifestHash,
    lastErrorCode: '',
    lastErrorMessage: '',
    installedAt: previous?.installed_at || new Date().toISOString(),
    lastCheckedAt: new Date().toISOString()
  })
  updateSourceModpackInspectionPlanState(record.plan_token, 'completed')
  return { success: true, instanceId: plan.instanceId }
}

async function runSourceModpackPlanFinalization(planToken = '', operation) {
  const safePlanToken = toText(planToken)
  if (!safePlanToken || finalizingPlanTokens.has(safePlanToken)) return null
  finalizingPlanTokens.add(safePlanToken)
  try {
    return await operation()
  } finally {
    finalizingPlanTokens.delete(safePlanToken)
  }
}

async function finalizePlanIfReady(planToken = '') {
  const jobs = listSourceModpackPlanJobs(planToken)
  const record = getSourceModpackInspectionPlan(planToken)
  const expectedJobCount = toNumber(record?.plan?.expectedJobCount, 0)
  if (!jobs.length || jobs.length < expectedJobCount) return null
  if (jobs.some((job) => !TERMINAL_STATES.has(job.state))) return null
  if (!record || !['applying', 'partial'].includes(record.state)) return null
  return await runSourceModpackPlanFinalization(planToken, async () => {
    const currentRecord = getSourceModpackInspectionPlan(planToken)
    if (!currentRecord || !['applying', 'partial'].includes(currentRecord.state)) return null
    const instance = getSourceModpackInstance(currentRecord.instance_id)
    if (!instance || ['detached', 'removed', 'orphaned'].includes(instance.state)) return null
    try {
      if (jobs.every((job) => SUCCESS_STATES.has(job.state))) {
        if (currentRecord.state === 'partial') {
          updateSourceModpackInspectionPlanState(planToken, 'applying')
          updateSourceModpackInstance(currentRecord.instance_id, { state: 'updating' })
        }
        return await finalizeSuccessfulPlan(currentRecord)
      }
      commitPartialInstalledItems(currentRecord)
      updateSourceModpackInspectionPlanState(planToken, 'partial')
      updateSourceModpackInstance(currentRecord.instance_id, {
        state: 'partial',
        lastErrorCode: 'partial_update',
        lastErrorMessage: '一个或多个来源安装任务未成功完成'
      })
      return { success: false, code: 'partial_update' }
    } catch (error) {
      updateSourceModpackInspectionPlanState(planToken, 'partial')
      updateSourceModpackInstance(currentRecord.instance_id, {
        state: 'partial',
        lastErrorCode: 'partial_update',
        lastErrorMessage: toText(error?.message || error) || '整合包计划终结失败'
      })
      return { success: false, code: 'partial_update', message: toText(error?.message || error) }
    }
  })
}

export async function projectSourceModpackInstallJobUpdate(detail = {}) {
  const { instanceId, planToken } = findJobBinding(detail)
  if (!instanceId || !planToken) return null
  updateSourceModpackInstanceJob(detail.job_id || detail.job?.job_id, detail.state, {
    state: detail.state,
    health: detail.health,
    failure: detail.failure,
    completedAt: detail.completed_at
  })
  const record = getSourceModpackInspectionPlan(planToken)
  const instance = getSourceModpackInstance(instanceId)
  if (!record || !['applying', 'partial'].includes(record.state) ||
      !instance || ['detached', 'removed', 'orphaned'].includes(instance.state)) return null
  if (record.state === 'partial' && !TERMINAL_STATES.has(detail.state)) {
    updateSourceModpackInspectionPlanState(planToken, 'applying')
    const mode = record.plan?.diff?.mode
    updateSourceModpackInstance(instanceId, {
      state: mode === 'install' ? 'installing' : mode === 'repair' ? 'repairing' : 'updating',
      lastErrorCode: '',
      lastErrorMessage: ''
    })
  }
  return await finalizePlanIfReady(planToken)
}

export async function finalizeSourceModpackPlanWithoutInstallJobs(planToken = '') {
  const record = getSourceModpackInspectionPlan(planToken)
  if (!record || ['completed', 'partial'].includes(record.state)) return null
  return await runSourceModpackPlanFinalization(planToken, async () => {
    const currentRecord = getSourceModpackInspectionPlan(planToken)
    if (!currentRecord || currentRecord.state !== 'applying') return null
    try {
      return await finalizeSuccessfulPlan(currentRecord)
    } catch (error) {
      updateSourceModpackInspectionPlanState(planToken, 'partial')
      updateSourceModpackInstance(currentRecord.instance_id, {
        state: 'partial',
        lastErrorCode: 'partial_update',
        lastErrorMessage: toText(error?.message || error) || '整合包计划终结失败'
      })
      return { success: false, code: 'partial_update', message: toText(error?.message || error) }
    }
  })
}
