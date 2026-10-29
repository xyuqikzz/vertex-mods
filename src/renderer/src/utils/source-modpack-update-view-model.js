import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
const INACTIVE_INSTANCE_STATES = new Set(['detached', 'removed'])

function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function getPackUid(pack = {}) {
  return toText(pack.packUid || pack.pack_uid)
}

function getInstancePackUid(instance = {}) {
  return toText(instance.remotePackUid || instance.remote_pack_uid)
}

function resolveDeviceUpdateState(instance = null, currentRevision = 0) {
  if (!instance) return 'not_installed'
  const state = toText(instance.state).toLowerCase()
  if (['partial', 'repair_required', 'conflict', 'orphaned'].includes(state)) return state
  const installedRevision = toNumber(instance.installedRevision ?? instance.installed_revision, 0)
  return installedRevision < currentRevision ? 'update' : 'latest'
}

function buildRecord(item = {}, packUid = '', instance = null, hasUpdate = false) {
  const pack = item.modpack || {}
  const currentRevision = toNumber(
    item.currentRevision ?? pack.currentRevision ?? pack.current_revision,
    0
  )
  return {
    ...item,
    hasUpdate,
    localInstance: instance,
    installedRevision: toNumber(instance?.installedRevision ?? instance?.installed_revision, 0),
    deviceUpdateState: resolveDeviceUpdateState(instance, currentRevision),
    recordKey: `${packUid || 'unknown'}:${toText(instance?.instanceId || instance?.instance_id) || 'not_installed'}`
  }
}

export function buildSourceModpackSubscriptionUpdates({
  updates = [],
  subscriptions = [],
  instances = []
} = {}) {
  const activeInstances = (Array.isArray(instances) ? instances : []).filter(
    (instance) => !INACTIVE_INSTANCE_STATES.has(toText(instance?.state).toLowerCase())
  )
  const instanceGroups = new Map()
  for (const instance of activeInstances) {
    const packUid = getInstancePackUid(instance)
    if (!packUid) continue
    if (!instanceGroups.has(packUid)) instanceGroups.set(packUid, [])
    instanceGroups.get(packUid).push(instance)
  }

  const unreadUpdateMap = new Map(
    (Array.isArray(updates) ? updates : []).map((item) => [getPackUid(item.modpack || {}), item])
  )
  const candidateMap = new Map(unreadUpdateMap)
  for (const pack of Array.isArray(subscriptions) ? subscriptions : []) {
    const packUid = getPackUid(pack)
    if (packUid && !candidateMap.has(packUid)) {
      candidateMap.set(packUid, { modpack: pack, hasUpdate: false })
    }
  }

  const remotePackUids = new Set()
  const records = []
  for (const item of candidateMap.values()) {
    const packUid = getPackUid(item.modpack || {})
    if (packUid) remotePackUids.add(packUid)
    const packInstances = instanceGroups.get(packUid) || []
    const hasUpdate = unreadUpdateMap.has(packUid)
    if (!packInstances.length) {
      records.push(buildRecord(item, packUid, null, hasUpdate))
      continue
    }
    for (const instance of packInstances) {
      records.push(buildRecord(item, packUid, instance, hasUpdate))
    }
  }

  const visibleRecords = records.filter(
    (item) => item.hasUpdate || (item.localInstance && item.deviceUpdateState !== 'latest')
  )
  const orphanedRecords = activeInstances
    .filter(
      (instance) =>
        toText(instance.state).toLowerCase() === 'orphaned' &&
        !remotePackUids.has(getInstancePackUid(instance))
    )
    .map((instance) => {
      const packUid = getInstancePackUid(instance)
      const installedRevision = toNumber(instance.installedRevision ?? instance.installed_revision, 0)
      return {
        subscriptionId: `local:${instance.instanceId || instance.instance_id}`,
        currentRevision: installedRevision,
        installedRevision,
        deviceUpdateState: 'orphaned',
        localInstance: instance,
        recordKey: `${packUid || 'unknown'}:${instance.instanceId || instance.instance_id}`,
        modpack: {
          id: 0,
          packUid,
          shareCode: instance.shareCode || instance.share_code,
          sourceType: instance.targets?.[0]?.sourcePlatform || 'mixed',
          sourceGameId: instance.targets?.[0]?.sourceGameId || '',
          sourceGameName: instance.targets?.[0]?.metadata?.gameName || '本地游戏',
          name: `已失效的远程整合包 ${toText(instance.shareCode || instance.share_code)}`,
          get description() { return uiText('ui.theRemoteShareWasDeletedOrUnlistedLocalModsAre') },
          currentRevision: installedRevision,
          updatedAt: instance.updated_at,
          _localInstanceId: instance.instanceId || instance.instance_id
        }
      }
    })

  return [...visibleRecords, ...orphanedRecords]
}

export function buildSourceModpackInstanceTargetOverrides(instance = null) {
  if (!instance) return {}
  return {
    localGameInstallationId: toNumber(
      instance.localGameInstallationId ?? instance.local_game_installation_id,
      0
    ),
    endpointType: toNumber(instance.endpointType ?? instance.endpoint_type, 0),
    instanceSlot: toText(instance.instanceSlot || instance.instance_slot || 'default') || 'default'
  }
}

export function buildSourceModpackLocalRecords(instances = [], query = {}) {
  const keyword = toText(query.keyword).toLowerCase()
  return instances.filter((instance) => !INACTIVE_INSTANCE_STATES.has(toText(instance.state)))
    .map((instance) => {
      const snapshot = instance.remoteSnapshot || {}
      const target = instance.targets?.[0] || {}
      const sources = new Set((instance.targets || []).map((item) => item.sourcePlatform))
      return {
        id: instance.remotePackId, packUid: instance.remotePackUid, shareCode: instance.shareCode,
        name: snapshot.name || `本地整合包 ${instance.shareCode || ''}`,
        sourceType: snapshot.sourceType || (sources.size > 1 ? 'mixed' : target.sourcePlatform),
        sourceGameId: target.sourceGameId, sourceGameName: snapshot.sourceGameName || '本地游戏',
        version: snapshot.versionName, modNum: (instance.items || []).length,
        updatedAt: instance.updated_at, _localInstanceId: instance.instanceId,
        _subscriptionRecordKey: `local:${instance.instanceId}`,
        _subscriptionUpdate: { localInstance: instance,
          deviceUpdateState: instance.state === 'ready' ? 'installed' : instance.state }
      }
    }).filter((pack) =>
      (!query.sourceType || pack.sourceType === query.sourceType) &&
      (!query.sourceGameId || toText(pack.sourceGameId) === toText(query.sourceGameId)) &&
      (!keyword || [pack.name, pack.sourceGameName, pack.shareCode].some((text) => toText(text).toLowerCase().includes(keyword)))
    )
}
