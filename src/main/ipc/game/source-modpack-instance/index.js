import crypto from 'crypto'
import { ipcMain } from '../../../security/ipc.js'

import {
  hashSourceModpackValue,
  rebuildSourceModpackSnapshotHashes
} from '../../../../shared/modpacks/source-modpack-contract.js'
import { inspectSourceModpackInstanceDiff } from '../../../../shared/modpacks/source-modpack-instance-diff.js'
import dbInstance from '../../../db/dbInstance.js'
import {
  attachSourceModpackInstanceJob,
  getSourceModpackInstance,
  getSourceModpackInstanceByIdentity,
  getSourceModpackInspectionPlan,
  getSourceModpackOwnershipReferences,
  inspectSourceModpackActualItem,
  inspectSourceModpackActualItems,
  markSourceModpackInstanceItemsRemoved,
  reconcileAllSourceModpackOwnershipModes,
  replaceSourceModpackInstanceItems,
  saveSourceModpackInspectionPlan,
  updateSourceModpackInstance,
  updateSourceModpackInspectionPlanState,
  upsertSourceModpackInstance,
  upsertSourceModpackInstanceTarget,
  reconcileSourceModpackOwnershipModes
} from '../../../db/mods/sourceModpackInstances.js'
import {
  cancelSourceInstallTask,
  createSourceInstallTask,
  startPreparedSourceInstallTask
} from '../source-install-task/orchestrator.js'
import { getJobDetail } from '../source-install-task/taskStore.js'
import { mutateSourceModpackMod } from './modOperations.js'
import { createSourceModpackJobBatch } from './jobBatch.js'
import { removeManagedSourceModpackItems } from './instanceRemoval.js'
import { resolveSourceModpackInspectionLifecycle } from './lifecycle.js'

export const SOURCE_MODPACK_INSTANCE_CHANNELS = Object.freeze({
  INSPECT: 'source-modpack-instance:inspect',
  APPLY: 'source-modpack-instance:apply',
  GET: 'source-modpack-instance:get',
  LIST: 'source-modpack-instance:list',
  DETACH: 'source-modpack-instance:detach',
  REMOVE: 'source-modpack-instance:remove',
  RETRY: 'source-modpack-instance:retry',
  ORPHAN: 'source-modpack-instance:orphan',
  RESOLVE_TARGET: 'source-modpack-instance:resolve-target'
})

const ACTIVE_INSTANCE_STATES = new Set(['installing', 'updating', 'repairing', 'removing'])

function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlain(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function createError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail })
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`
}

function assertCanonicalPlan(canonicalPlan = {}) {
  const target = canonicalPlan?.targetContext || {}
  const remote = canonicalPlan?.remote || {}
  if (!toText(remote.packUid)) {
    throw createError('share_not_found', '远程分享缺少稳定 packUid')
  }
  if (!toNumber(target.localGameInstallationId, 0)) {
    throw createError('target_game_not_found', '未找到目标游戏安装记录')
  }
  const game = dbInstance.get(`SELECT id FROM games WHERE id = ? LIMIT 1`, [
    toNumber(target.localGameInstallationId, 0)
  ])
  if (!game) {
    throw createError('target_game_not_found', '目标游戏安装记录不存在')
  }
  if (!Array.isArray(canonicalPlan.items) || !canonicalPlan.items.length) {
    throw createError('source_resolution_failed', '分享整合包没有可安装条目')
  }
}

function summarizeForRenderer(summary = {}) {
  return {
    added: Array.isArray(summary.added) ? summary.added : [],
    changed: Array.isArray(summary.changed) ? summary.changed : [],
    removed: Array.isArray(summary.removed) ? summary.removed : [],
    metadataOnly: Array.isArray(summary.metadataOnly) ? summary.metadataOnly : [],
    unchanged: Array.isArray(summary.unchanged) ? summary.unchanged : [],
    repairMissing: Array.isArray(summary.repairMissing) ? summary.repairMissing : [],
    localVersionConflict: Array.isArray(summary.localVersionConflict)
      ? summary.localVersionConflict
      : [],
    localContentConflict: Array.isArray(summary.localContentConflict)
      ? summary.localContentConflict
      : [],
    retained: Array.isArray(summary.retained) ? summary.retained : [],
    conflicts: Array.isArray(summary.conflicts) ? summary.conflicts : []
  }
}

function buildProfileTargets(canonicalPlan = {}, existingTargets = []) {
  const targetMap = new Map()
  for (const item of canonicalPlan.items || []) {
    const sourcePlatform = toText(item.sourcePlatform)
    const sourceGameId = toText(item.sourceGameId)
    const profileId = toText(item.profileId || canonicalPlan.targetContext?.profileId)
    const key = [sourcePlatform, sourceGameId, profileId].join('|')
    if (!targetMap.has(key)) {
      targetMap.set(key, {
        sourcePlatform,
        sourceGameId,
        profileId,
        profileName: toText(item.profileName || canonicalPlan.targetContext?.profileName),
        gameRoot: toText(item.gameRoot || canonicalPlan.targetContext?.gameRoot)
      })
    }
  }
  for (const target of Array.isArray(existingTargets) ? existingTargets : []) {
    const key = [target.sourcePlatform, target.sourceGameId, target.profileId].join('|')
    if (targetMap.has(key)) {
      targetMap.set(key, {
        ...targetMap.get(key),
        profileName: target.profileName,
        profileId: target.profileId,
        gameRoot: target.gameRoot || targetMap.get(key).gameRoot
      })
    }
  }
  return [...targetMap.values()]
}

export function inspectSourceModpackImport(payload = {}) {
  const canonicalPlan = toPlain(payload.canonicalPlan, {})
  assertCanonicalPlan(canonicalPlan)
  const remote = canonicalPlan.remote
  const target = canonicalPlan.targetContext
  const identity = {
    remotePackUid: remote.packUid,
    localGameInstallationId: target.localGameInstallationId,
    endpointType: target.endpointType,
    instanceSlot: target.instanceSlot || 'default'
  }
  const existingIdentity = getSourceModpackInstanceByIdentity(identity)
  const storedInstance = existingIdentity
    ? getSourceModpackInstance(existingIdentity.instanceId)
    : null
  if (storedInstance && ACTIVE_INSTANCE_STATES.has(storedInstance.state)) {
    throw createError('instance_update_in_progress', '该整合包实例已有安装或更新任务')
  }
  const lifecycle = resolveSourceModpackInspectionLifecycle(storedInstance)
  const instance = lifecycle.comparisonInstance
  const actualItems = storedInstance ? inspectSourceModpackActualItems(storedInstance.instanceId) : []
  const ownershipReferences = instance
    ? getSourceModpackOwnershipReferences(storedInstance.instanceId)
    : {}
  const historicalPlans = instance ? dbInstance.all(
    `SELECT plan_json FROM source_modpack_instance_plans
      WHERE instance_id = ? AND state IN ('completed', 'partial', 'superseded')
      ORDER BY created_at DESC`, [instance.instanceId]
  ).map((row) => {
    try { return JSON.parse(row.plan_json) } catch { return {} }
  }) : []
  const diff = inspectSourceModpackInstanceDiff({
    canonicalPlan,
    instance,
    snapshotItems: rebuildSourceModpackSnapshotHashes(lifecycle.snapshotItems, historicalPlans),
    actualItems: instance ? actualItems : [],
    ownershipReferences
  })
  const instanceId = storedInstance?.instanceId || createId('instance')
  const planToken = createId('share_plan')
  const baseStateHash = hashSourceModpackValue({
    instance: storedInstance
      ? {
          instanceId: storedInstance.instanceId,
          state: storedInstance.state,
          installedRevision: storedInstance.installedRevision,
          installedManifestHash: storedInstance.installedManifestHash,
          updatedAt: storedInstance.updated_at
        }
      : null,
    actualItems
  })
  const profileTargets = buildProfileTargets(canonicalPlan, storedInstance?.targets || [])
  const persistedPlan = {
    canonicalPlan,
    diff,
    instanceId,
    baseStateHash,
    entryPoint: toText(payload.entryPoint || 'external'),
    profileTargets,
    reactivation: lifecycle.reactivation,
    inspectedAt: new Date().toISOString()
  }
  saveSourceModpackInspectionPlan({
    planToken,
    planHash: canonicalPlan.canonicalPlanHash,
    instanceId,
    remotePackUid: remote.packUid,
    remoteRevision: remote.revision,
    baseStateHash,
    mode: diff.mode,
    plan: persistedPlan
  })
  const actualItemMap = new Map(
    actualItems.map((item) => [toNumber(item.localModId, 0), item])
  )
  const rendererOperations = diff.operations.map((operation) => {
    const actual = actualItemMap.get(toNumber(operation.localModId, 0)) || null
    return {
      ...operation,
      requiresDisable: operation.action === 'uninstall' && actual?.active === true,
      localState: actual
        ? {
            active: actual.active === true,
            exists: actual.exists === true,
            sourceLockState: toText(actual.sourceLockState),
            contentIntact: actual.contentIntact !== false
          }
        : null
    }
  })
  return {
    mode: diff.mode,
    instanceId,
    packUid: remote.packUid,
    fromRevision: diff.fromRevision,
    toRevision: diff.toRevision,
    planToken,
    planHash: canonicalPlan.canonicalPlanHash,
    remote,
    local: instance
      ? {
          installedRevision: instance.installedRevision,
          installedManifestHash: instance.installedManifestHash,
          state: instance.state,
          lastErrorCode: instance.lastErrorCode,
          lastErrorMessage: instance.lastErrorMessage,
          profileTargets: instance.targets
        }
      : {
          installedRevision: 0,
          installedManifestHash: '',
          state: 'uninstalled',
          profileTargets
        },
    profileTargets,
    summary: summarizeForRenderer(diff.summary),
    operations: rendererOperations,
    warnings: diff.warnings
  }
}

function resolveFileType(entry = {}) {
  const fileName = toText(entry.download?.fileName)
  const match = fileName.match(/\.([a-z0-9]{2,8})$/i)
  return match?.[1]?.toLowerCase() || (entry.sourcePlatform === 'vamhub' ? 'var' : 'zip')
}

function buildTaskEntry(entry = {}, instanceId = '', planToken = '', operation = {}) {
  const installPayload = {
    ...toPlain(entry.installPayload, {}),
    cover: toText(entry.cover),
    description: toText(entry.description),
    sourceModpackInstanceId: instanceId,
    sourceModpackPlanToken: planToken,
    sourceModpackItemKey: entry.itemKey,
    canonicalItemHash: entry.canonicalItemHash,
    sourceModpackOperation: toText(operation.action || 'install'),
    sourceModpackOperationReason: toText(operation.reason),
    sourceModpackPreviousLocalModId: operation.action === 'replace' ? toNumber(operation.localModId, 0) : 0,
    sourceModpackPreviousVersion: toText(operation.previous?.version)
  }
  const nexusAuthorization =
    entry.sourcePlatform === 'nexus'
      ? {
          gameDomain: toText(
            entry.sourceGameSlug ||
              installPayload.sourceGameDomain ||
              installPayload.gameSourceSlug
          ),
          modId: toNumber(entry.sourceModId || installPayload.modId, 0),
          fileId: toNumber(entry.sourceFileId || installPayload.id || installPayload.fileId, 0),
          fileName: toText(entry.download?.fileName || installPayload.name || entry.name),
          fileSize: toNumber(entry.download?.fileSize || installPayload.fileSize, 0)
        }
      : null
  return {
    item: {
      task_name: `${entry.sourcePlatform}模组下载:${entry.name}${entry.version ? `@${entry.version}` : ''}`,
      module: '游戏',
      file_type: resolveFileType(entry),
      download_url: toText(entry.download?.url || installPayload.downloadUrl),
      filePath: toText(installPayload.filePath || installPayload.localPath),
      file_size: toNumber(entry.download?.fileSize || installPayload.fileSize, 0),
      saveType: 2,
      sourcePlatform: entry.sourcePlatform,
      sourceType: entry.sourcePlatform,
      sourceGameId: entry.sourceGameId,
      sourceModId: entry.sourceModId,
      sourceFileId: entry.sourceFileId,
      sourceGameSlug: entry.sourceGameSlug,
      sourceModKey: toText(installPayload.sourceModKey || entry.sourceModKey),
      version: entry.version,
      dedupeKey: [
        entry.sourcePlatform,
        entry.sourceGameId,
        entry.itemKey,
        entry.sourceFileId || entry.version
      ]
        .filter(Boolean)
        .join(':'),
      showOpenInDownloadList: true,
      fun: { type: 0 }
    },
    meta: {
      sourcePlatform: entry.sourcePlatform,
      sourceType: entry.sourcePlatform,
      sourceGameId: entry.sourceGameId,
      sourceGameSlug: entry.sourceGameSlug,
      displayName: entry.name,
      sortIndex: toNumber(entry.installPayload?.priorityOrder, 0),
      canonicalItem: entry,
      ...(nexusAuthorization?.gameDomain && nexusAuthorization.modId && nexusAuthorization.fileId
        ? { nexusAuthorization }
        : {}),
      installPayload
    }
  }
}

function buildTaskPayloads(plan = {}) {
  const canonicalPlan = plan.canonicalPlan || {}
  const operations = Array.isArray(plan.diff?.operations) ? plan.diff.operations : []
  const installItemKeys = new Set(
    operations
      .filter((operation) => ['install', 'replace'].includes(operation.action))
      .map((operation) => operation.itemKey)
  )
  const operationMap = new Map(
    operations.map((operation) => [operation.itemKey, operation])
  )
  const grouped = new Map()
  const queuedItemKeys = new Set()
  for (const entry of canonicalPlan.items || []) {
    if (!installItemKeys.has(entry.itemKey) || queuedItemKeys.has(entry.itemKey)) continue
    queuedItemKeys.add(entry.itemKey)
    const key = entry.sourcePlatform
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(
      buildTaskEntry(entry, plan.instanceId, plan.planToken, operationMap.get(entry.itemKey))
    )
  }
  const operationCounts = operations.reduce((counts, operation) => {
    const action = toText(operation.action || 'unknown')
    counts[action] = toNumber(counts[action], 0) + 1
    return counts
  }, {})
  return [...grouped.entries()].map(([source, items]) => {
    const sourceProfileId = toText(
      items[0]?.meta?.installPayload?.profileId || canonicalPlan.targetContext?.profileId
    )
    const sourceProfileName = toText(
      items[0]?.meta?.installPayload?.profileName ||
      items[0]?.meta?.installPayload?.targetProfileName ||
      canonicalPlan.targetContext?.profileName
    )
    const sourceCanonicalItem = items[0]?.meta?.canonicalItem || {}
    return {
      source,
      sourceAdapter: source,
      sourceGameId: toText(items[0]?.meta?.sourceGameId),
      gameKey: `${source}:${toText(items[0]?.meta?.sourceGameId) || 'unknown'}`,
      gameRoot: toText(sourceCanonicalItem.gameRoot || canonicalPlan.targetContext?.gameRoot),
      title: `${toText(canonicalPlan.remote?.name) || '分享整合包'} ${plan.diff?.mode === 'install' ? '安装' : '更新'}`,
      mainItem: items[0]?.meta?.installPayload || {},
      items,
      installRule: toPlain(sourceCanonicalItem.installRule || canonicalPlan.targetContext?.installRule, {}),
      sourceMeta: {
        source,
        sourceModpackInstanceId: plan.instanceId,
        sourceModpackPlanToken: plan.planToken,
        sourceModpackPackUid: canonicalPlan.remote?.packUid,
        sourceModpackRevision: canonicalPlan.remote?.revision,
        sourceModpackFromRevision: plan.diff?.fromRevision,
        sourceModpackToRevision: plan.diff?.toRevision,
        sourceModpackPlanHash: canonicalPlan.canonicalPlanHash,
        sourceModpackEntryPoint: plan.entryPoint,
        sourceModpackOperationCounts: operationCounts,
        sourceModpackOperationSummary: operations.map((operation) => ({
          action: operation.action,
          itemKey: operation.itemKey,
          reason: operation.reason,
          localModId: operation.localModId
        })),
        profileId: sourceProfileId,
        profileName: sourceProfileName,
        targetProfileName: sourceProfileName
      },
      options: {
        autoStart: true,
        includeDependencies: true,
        profileId: sourceProfileId,
        profileName: sourceProfileName,
        targetProfileName: sourceProfileName
      }
    }
  })
}

function assertPlanCanApply(record = {}, payload = {}) {
  if (!record) throw createError('manifest_revision_changed', '安装计划不存在或已失效')
  if (record.state !== 'inspected') {
    throw createError('instance_update_in_progress', '安装计划已提交，不能重复执行')
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    throw createError('manifest_revision_changed', '安装计划已过期，请重新预检')
  }
  const expectedPlanHash = toText(payload.expectedPlanHash || payload.expected_plan_hash)
  if (expectedPlanHash && expectedPlanHash !== record.plan_hash) {
    throw createError('manifest_revision_changed', '安装计划哈希已变化，请重新预检')
  }
  if (record.mode === 'latest') {
    throw createError('already_latest', '当前整合包已是最新版本')
  }
  if (record.mode === 'conflict') {
    throw createError('local_drift_detected', '本地配置存在冲突，请先选择处理方式')
  }
}

export async function applySourceModpackImport(event, payload = {}) {
  const planToken = toText(payload.planToken || payload.plan_token)
  const record = getSourceModpackInspectionPlan(planToken)
  assertPlanCanApply(record, payload)
  const plan = { ...toPlain(record.plan, {}), planToken }
  const canonicalPlan = plan.canonicalPlan || {}
  const remote = canonicalPlan.remote || {}
  const target = canonicalPlan.targetContext || {}
  const current = getSourceModpackInstance(plan.instanceId)
  if (current && ACTIVE_INSTANCE_STATES.has(current.state)) {
    throw createError('instance_update_in_progress', '该整合包实例已有安装或更新任务')
  }
  const currentActualItems = current ? inspectSourceModpackActualItems(current.instanceId) : []
  const currentBaseStateHash = hashSourceModpackValue({
    instance: current
      ? {
          instanceId: current.instanceId,
          state: current.state,
          installedRevision: current.installedRevision,
          installedManifestHash: current.installedManifestHash,
          updatedAt: current.updated_at
        }
      : null,
    actualItems: currentActualItems
  })
  if (record.base_state_hash && currentBaseStateHash !== record.base_state_hash) {
    throw createError('local_drift_detected', '预检后本地实例状态已变化，请重新预检')
  }
  if (plan.reactivation?.resetPreviousOwnership === true) {
    replaceSourceModpackInstanceItems(plan.instanceId, [])
  }
  upsertSourceModpackInstance({
    instanceId: plan.instanceId,
    remotePackUid: remote.packUid,
    remotePackId: remote.id,
    shareCode: remote.shareCode,
    localGameInstallationId: target.localGameInstallationId,
    endpointType: target.endpointType,
    instanceSlot: target.instanceSlot || 'default',
    installedRevision: plan.reactivation ? 0 : current?.installedRevision || 0,
    installedManifestHash: plan.reactivation ? '' : current?.installedManifestHash || '',
    desiredRevision: remote.revision,
    desiredManifestHash: remote.manifestHash,
    state: record.mode === 'install' ? 'installing' : record.mode === 'repair' ? 'repairing' : 'updating'
  })
  for (const profileTarget of plan.profileTargets || []) {
    upsertSourceModpackInstanceTarget({ instanceId: plan.instanceId, ...profileTarget })
  }
  const taskPayloads = buildTaskPayloads(plan)
  plan.expectedJobCount = taskPayloads.length
  saveSourceModpackInspectionPlan({
    planToken,
    planHash: record.plan_hash,
    instanceId: plan.instanceId,
    remotePackUid: remote.packUid,
    remoteRevision: remote.revision,
    baseStateHash: record.base_state_hash,
    mode: record.mode,
    plan
  })
  // 新计划接管后，旧失败任务的迟到通知不得回写当前安装版本。
  dbInstance.run(`UPDATE source_modpack_instance_plans SET state = 'superseded'
    WHERE instance_id = ? AND plan_token <> ? AND state IN ('inspected', 'partial')`,
  [plan.instanceId, planToken])
  const jobs = []
  updateSourceModpackInspectionPlanState(planToken, 'applying')
  try {
    const { projectSourceModpackInstallJobUpdate } = await import('./projection.js')
    jobs.push(...await createSourceModpackJobBatch({
      event,
      instanceId: plan.instanceId,
      planToken,
      taskPayloads
    }, {
      createTask: createSourceInstallTask,
      attachJob: attachSourceModpackInstanceJob,
      getTaskDetail: getJobDetail,
      projectTask: projectSourceModpackInstallJobUpdate,
      startTask: startPreparedSourceInstallTask,
      cancelTask: cancelSourceInstallTask
    }))
    if (!taskPayloads.length) {
      const { finalizeSourceModpackPlanWithoutInstallJobs } = await import('./projection.js')
      const finalization = await finalizeSourceModpackPlanWithoutInstallJobs(planToken)
      if (finalization?.success === false) {
        throw createError(
          finalization.code || 'partial_update',
          finalization.message || '整合包变更未能安全完成',
          { failures: finalization.failures || [] }
        )
      }
    }
    return {
      success: true,
      instanceId: plan.instanceId,
      planToken,
      mode: record.mode,
      jobIds: jobs.map((job) => job.jobId),
      jobs,
      message: jobs.length ? '已加入安装任务' : '整合包变更已处理'
    }
  } catch (error) {
    const createdJobs = Array.isArray(error?.createdJobs) ? error.createdJobs : jobs
    plan.expectedJobCount = createdJobs.length
    saveSourceModpackInspectionPlan({
      planToken,
      planHash: record.plan_hash,
      instanceId: plan.instanceId,
      remotePackUid: remote.packUid,
      remoteRevision: remote.revision,
      baseStateHash: record.base_state_hash,
      mode: record.mode,
      plan
    })
    updateSourceModpackInspectionPlanState(planToken, 'partial')
    updateSourceModpackInstance(plan.instanceId, {
      state: 'partial',
      lastErrorCode: 'partial_update',
      lastErrorMessage: toText(error?.message || error)
    })
    throw createError('partial_update', toText(error?.message) || '整合包更新部分失败')
  }
}

export function listSourceModpackInstances(payload = {}) {
  const where = []
  const params = []
  if (toText(payload.remotePackUid)) {
    where.push('remote_pack_uid = ?')
    params.push(toText(payload.remotePackUid))
  }
  if (toNumber(payload.localGameInstallationId, 0)) {
    where.push('local_game_installation_id = ?')
    params.push(toNumber(payload.localGameInstallationId, 0))
  }
  return dbInstance
    .all(`SELECT * FROM source_modpack_instances ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY datetime(updated_at) DESC`, params)
    .map((row) => {
      const instance = getSourceModpackInstance(row.instance_id)
      const latest = dbInstance.get(`SELECT plan_json FROM source_modpack_instance_plans
        WHERE instance_id = ? ORDER BY created_at DESC LIMIT 1`, [row.instance_id])
      let remote = {}
      try { remote = JSON.parse(latest?.plan_json || '{}').canonicalPlan?.remote || {} } catch { /* 旧计划损坏时仍保留本地管理入口。 */ }
      const game = dbInstance.get('SELECT name FROM games WHERE id = ?', [row.local_game_installation_id])
      return { ...instance, remoteSnapshot: {
        name: toText(remote.name), versionName: toText(remote.versionName), sourceType: toText(remote.sourceType),
        sourceGameName: toText(game?.name)
      } }
    })
}

export function detachSourceModpackInstance(instanceId = '') {
  const instance = getSourceModpackInstance(instanceId)
  if (!instance) throw createError('instance_conflict', '本地整合包实例不存在')
  if (ACTIVE_INSTANCE_STATES.has(instance.state)) {
    throw createError('instance_update_in_progress', '实例正在更新，不能解除绑定')
  }
  const now = new Date().toISOString()
  dbInstance.transaction(() => {
    dbInstance.run(`UPDATE source_modpack_instance_items
      SET ownership_mode = 'detached', state = 'detached', updated_at = ? WHERE instance_id = ?`,
      [now, instance.instanceId])
    dbInstance.run(`UPDATE source_modpack_instances SET state = 'detached', updated_at = ?
      WHERE instance_id = ?`, [now, instance.instanceId])
  })
  reconcileSourceModpackOwnershipModes((instance.items || []).map((item) => item.localModId))
  return { success: true, instanceId: instance.instanceId, message: '已保留模组并解除绑定' }
}

export async function removeSourceModpackInstance(event, instanceId = '') {
  const instance = getSourceModpackInstance(instanceId)
  if (!instance) throw createError('instance_conflict', '本地整合包实例不存在')
  if (ACTIVE_INSTANCE_STATES.has(instance.state)) {
    throw createError('instance_update_in_progress', '实例正在更新，不能卸载')
  }
  const ownership = getSourceModpackOwnershipReferences(instance.instanceId)
  updateSourceModpackInstance(instance.instanceId, { state: 'removing' })
  let outcome
  try {
    outcome = await removeManagedSourceModpackItems({ instance, ownership }, {
      inspectActualItem: (localModId) => inspectSourceModpackActualItem(localModId),
      disableMod: async (localModId) => await mutateSourceModpackMod(event, localModId, 'disable'),
      uninstallMod: async (localModId) => await mutateSourceModpackMod(event, localModId, 'uninstall'),
      markItemsRemoved: markSourceModpackInstanceItemsRemoved
    })
  } catch (error) {
    updateSourceModpackInstance(instance.instanceId, {
      state: 'partial', lastErrorCode: 'unsafe_uninstall', lastErrorMessage: toText(error?.message || error)
    })
    throw error
  }
  const { failures, removedCount } = outcome
  reconcileSourceModpackOwnershipModes((instance.items || []).map((item) => item.localModId))
  if (failures.length) {
    updateSourceModpackInstance(instance.instanceId, {
      state: 'partial',
      lastErrorCode: 'unsafe_uninstall',
      lastErrorMessage: `有 ${failures.length} 个模组未能安全卸载`
    })
    return { success: false, code: 'partial_update', removedCount, failures,
      message: `已卸载 ${removedCount} 个模组，${failures.length} 个失败` }
  }
  const now = new Date().toISOString()
  dbInstance.transaction(() => {
    dbInstance.run(`UPDATE source_modpack_instance_items SET ownership_mode='detached',
      state=CASE WHEN state='removed' THEN 'removed' ELSE 'detached' END,
      updated_at=? WHERE instance_id=?`, [now, instance.instanceId])
    dbInstance.run(`UPDATE source_modpack_instances SET state='removed', updated_at=? WHERE instance_id=?`,
      [now, instance.instanceId])
  })
  return { success: true, instanceId: instance.instanceId, removedCount,
    message: `已卸载该实例独占管理的 ${removedCount} 个模组` }
}

export function orphanSourceModpackInstances(payload = {}) {
  const shareCode = toText(payload.shareCode || payload.share_code)
  const remotePackUid = toText(payload.remotePackUid || payload.remote_pack_uid)
  if (!shareCode && !remotePackUid) {
    throw createError('instance_conflict', '缺少远程整合包身份')
  }
  const where = []
  const params = []
  if (shareCode) {
    where.push('share_code = ?')
    params.push(shareCode)
  }
  if (remotePackUid) {
    where.push('remote_pack_uid = ?')
    params.push(remotePackUid)
  }
  const now = new Date().toISOString()
  dbInstance.run(`UPDATE source_modpack_instances
    SET state = 'orphaned', last_error_code = ?, last_error_message = ?,
        last_checked_at = ?, updated_at = ?
    WHERE (${where.join(' OR ')}) AND state NOT IN ('detached', 'removed', 'installing', 'updating', 'repairing', 'removing')`, [
    toText(payload.reasonCode || payload.reason_code || 'share_removed'),
    toText(payload.message || '远程分享已删除或下架，本地内容保持不变'),
    now,
    now,
    ...params
  ])
  return {
    success: true,
    data: listSourceModpackInstances(
      remotePackUid ? { remotePackUid } : {}
    ).filter((item) => !shareCode || item.shareCode === shareCode)
  }
}

async function retrySourceModpackImport(event, payload = {}) {
  const oldRecord = getSourceModpackInspectionPlan(payload.planToken || payload.plan_token)
  if (!oldRecord?.plan?.canonicalPlan) {
    throw createError('manifest_revision_changed', '没有可重试的安装计划')
  }
  const inspection = inspectSourceModpackImport({
    canonicalPlan: oldRecord.plan.canonicalPlan,
    entryPoint: oldRecord.plan.entryPoint || 'external'
  })
  return await applySourceModpackImport(event, {
    planToken: inspection.planToken,
    expectedPlanHash: inspection.planHash,
    conflictDecisions: payload.conflictDecisions
  })
}

export function resolveSourceModpackTarget(payload = {}) {
  const sourcePlatform = toText(payload.sourcePlatform || payload.source).toLowerCase()
  const sourceGameId = toText(payload.sourceGameId)
  const appId = toText(payload.appId)
  const gameRoot = toText(payload.gameRoot).toLowerCase()
  const requestedId = toNumber(payload.localGameInstallationId, 0)
  const where = []
  const params = []
  if (requestedId) {
    where.push('id = ?')
    params.push(requestedId)
  } else {
    if (sourcePlatform && sourceGameId) {
      where.push('(lower(source) = ? AND source_id = ?)')
      params.push(sourcePlatform, sourceGameId)
    }
    if (appId) {
      where.push('app_id = ?')
      params.push(appId)
    }
    if (gameRoot) {
      where.push("lower(rtrim(client_root_path, '\\\\/')) = lower(rtrim(?, '\\\\/'))")
      params.push(gameRoot)
    }
  }
  if (!where.length) throw createError('target_game_not_found', '缺少目标游戏识别信息')
  const rows = dbInstance.all(
    `SELECT * FROM games WHERE ${where.join(' OR ')} ORDER BY datetime(updated_at) DESC, id DESC`,
    params
  )
  if (!rows.length) throw createError('target_game_not_found', '未找到目标游戏安装记录')
  const exactRootRows = gameRoot
    ? rows.filter((row) => toText(row.client_root_path).replace(/[\\/]+$/g, '').toLowerCase() === gameRoot.replace(/[\\/]+$/g, ''))
    : rows
  const candidates = exactRootRows.length ? exactRootRows : rows
  if (candidates.length > 1 && !requestedId && !gameRoot) {
    throw createError('target_game_ambiguous', '存在多个目标游戏安装，请选择具体目录', {
      candidates: candidates.map((row) => ({ id: row.id, name: row.name, gameRoot: row.client_root_path }))
    })
  }
  const row = candidates[0]
  return {
    localGameInstallationId: toNumber(row.id, 0),
    sourcePlatform: row.source,
    sourceGameId: row.source_id,
    sourceGameSlug: row.source_slug,
    appId: row.app_id,
    gameName: row.name,
    gameRoot: row.client_root_path,
    gameExePath: row.client_exe_path
  }
}

function wrapIpc(handler) {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (error) {
      return {
        success: false,
        code: toText(error?.code || 'source_modpack_instance_error'),
        message: toText(error?.message || error),
        detail: toPlain(error?.detail, {})
      }
    }
  }
}

export function sourceModpackInstanceIndex() {
  reconcileAllSourceModpackOwnershipModes()
  // 卸载不属于持久化下载任务；进程中断后释放忙碌状态，保留逐项卸载记录以供重试。
  dbInstance.run(`UPDATE source_modpack_instances SET state = 'partial',
    last_error_code = 'uninstall_interrupted', last_error_message = '上次卸载被中断，可重新执行卸载', updated_at = ?
    WHERE state = 'removing'`, [new Date().toISOString()])
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.INSPECT,
    wrapIpc(async (_event, payload) => ({ success: true, ...inspectSourceModpackImport(payload) }))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.APPLY,
    wrapIpc(async (event, payload) => await applySourceModpackImport(event, payload))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.GET,
    wrapIpc(async (_event, payload) => ({
      success: true,
      data: getSourceModpackInstance(payload?.instanceId || payload?.instance_id)
    }))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.LIST,
    wrapIpc(async (_event, payload) => ({ success: true, data: listSourceModpackInstances(payload) }))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.RETRY,
    wrapIpc(async (event, payload) => await retrySourceModpackImport(event, payload))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.DETACH,
    wrapIpc(async (_event, payload) => detachSourceModpackInstance(payload?.instanceId || payload?.instance_id))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.REMOVE,
    wrapIpc(async (event, payload) => await removeSourceModpackInstance(event, payload?.instanceId || payload?.instance_id))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.ORPHAN,
    wrapIpc(async (_event, payload) => orphanSourceModpackInstances(payload))
  )
  ipcMain.handle(
    SOURCE_MODPACK_INSTANCE_CHANNELS.RESOLVE_TARGET,
    wrapIpc(async (_event, payload) => ({ success: true, data: resolveSourceModpackTarget(payload) }))
  )
}
