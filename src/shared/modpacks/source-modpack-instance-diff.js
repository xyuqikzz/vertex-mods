function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function entryIdentity(item = {}) {
  return [item.itemKey, item.dependencyRole || 'main', item.originItemKey || item.itemKey]
    .map(toText)
    .join('|')
}

function emptySummary() {
  return {
    added: [],
    changed: [],
    removed: [],
    metadataOnly: [],
    unchanged: [],
    repairMissing: [],
    localVersionConflict: [],
    localContentConflict: [],
    retained: [],
    conflicts: []
  }
}

function buildActualLookup(actualItems = []) {
  const byIdentity = new Map()
  const byItemKey = new Map()
  const byLocalModId = new Map()
  for (const item of Array.isArray(actualItems) ? actualItems : []) {
    const identity = entryIdentity(item)
    if (item.itemKey && !byIdentity.has(identity)) byIdentity.set(identity, item)
    if (item.itemKey && !byItemKey.has(item.itemKey)) byItemKey.set(item.itemKey, item)
    const localModId = toNumber(item.localModId, 0)
    if (localModId && !byLocalModId.has(localModId)) byLocalModId.set(localModId, item)
  }
  return { byIdentity, byItemKey, byLocalModId }
}

function getActualItem(snapshot = {}, lookup = {}) {
  return (
    lookup.byIdentity?.get(entryIdentity(snapshot)) ||
    lookup.byLocalModId?.get(toNumber(snapshot.localModId, 0)) ||
    lookup.byItemKey?.get(snapshot.itemKey) ||
    null
  )
}

function addLocalDrift(summary, snapshotItems, actualLookup) {
  for (const snapshot of Array.isArray(snapshotItems) ? snapshotItems : []) {
    const actual = getActualItem(snapshot, actualLookup)
    if (!actual || actual.exists === false || actual.contentMissing === true) {
      summary.repairMissing.push({
        type: 'repair_missing',
        itemKey: snapshot.itemKey,
        snapshot,
        actual
      })
      continue
    }
    const snapshotVersion = toText(snapshot.version)
    const actualVersion = toText(actual.version)
    if (snapshotVersion && actualVersion && snapshotVersion !== actualVersion) {
      summary.localVersionConflict.push({
        type: 'local_version_conflict',
        itemKey: snapshot.itemKey,
        snapshot,
        actual
      })
    }
    if (actual.contentIntact === false) {
      summary.localContentConflict.push({
        type: 'local_content_conflict',
        itemKey: snapshot.itemKey,
        snapshot,
        actual
      })
    }
  }
}

function getOwnershipReference(ownershipReferences = {}, localModId = 0) {
  if (ownershipReferences instanceof Map) {
    return ownershipReferences.get(localModId) || {}
  }
  return ownershipReferences?.[localModId] || ownershipReferences?.[String(localModId)] || {}
}

function buildRemovalOperation(entry = {}, summary, ownershipReferences = {}, actualLookup = {}) {
  const localModId = toNumber(entry.localModId, 0)
  const ownershipMode = toText(entry.ownershipMode || entry.ownership_mode || 'referenced')
    .toLowerCase()
  const reference = getOwnershipReference(ownershipReferences, localModId)
  const actual = getActualItem(entry, actualLookup)
  const contentIntact = !actual || actual.contentIntact !== false
  const safeToUninstall =
    localModId > 0 &&
    ownershipMode === 'managed' &&
    toNumber(reference.otherInstanceCount, 0) === 0 &&
    reference.userOwned !== true &&
    contentIntact

  if (safeToUninstall) {
    return {
      action: 'uninstall',
      itemKey: entry.itemKey,
      localModId,
      reason: 'instance_exclusive_managed',
      entry
    }
  }

  const reason =
    !contentIntact
      ? 'local_content_conflict'
      : ownershipMode !== 'managed'
        ? `ownership_${ownershipMode || 'unknown'}`
        : toNumber(reference.otherInstanceCount, 0) > 0
          ? 'shared_mod_retained'
          : reference.userOwned === true
            ? 'user_owned_retained'
            : 'unsafe_uninstall'

  const retained = {
    type: reason,
    itemKey: entry.itemKey,
    localModId,
    ownershipMode,
    entry
  }
  if (reason === 'local_content_conflict' || reason === 'unsafe_uninstall') {
    summary.conflicts.push(retained)
  } else {
    summary.retained.push(retained)
  }
  return {
    action: reason === 'local_content_conflict' ? 'conflict' : 'retain',
    itemKey: entry.itemKey,
    localModId,
    reason,
    entry
  }
}

function deriveMode({ instance, canonicalPlan, summary }) {
  if (!instance?.instanceId && !instance?.instance_id) return 'install'
  if (summary.conflicts.length || summary.localContentConflict.length) return 'conflict'
  const hasRemoteChanges =
    summary.added.length ||
    summary.changed.length ||
    summary.removed.length ||
    summary.metadataOnly.length
  const revisionChanged =
    toNumber(canonicalPlan?.remote?.revision, 0) !==
    toNumber(instance.installedRevision ?? instance.installed_revision, 0)
  const manifestChanged =
    toText(canonicalPlan?.remote?.manifestHash) !==
    toText(instance.installedManifestHash ?? instance.installed_manifest_hash)
  if (hasRemoteChanges || revisionChanged || manifestChanged) return 'update'
  if (summary.repairMissing.length || summary.localVersionConflict.length) return 'repair'
  return 'latest'
}

export function inspectSourceModpackInstanceDiff({
  canonicalPlan = {},
  instance = null,
  snapshotItems = [],
  actualItems = [],
  ownershipReferences = {}
} = {}) {
  const summary = emptySummary()
  const remoteItems = Array.isArray(canonicalPlan?.items) ? canonicalPlan.items : []
  const snapshots = Array.isArray(snapshotItems) ? snapshotItems : []
  const remoteMap = new Map(remoteItems.map((item) => [entryIdentity(item), item]))
  const snapshotMap = new Map(snapshots.map((item) => [entryIdentity(item), item]))
  const actualLookup = buildActualLookup(actualItems)
  const operations = []

  for (const remoteItem of remoteItems) {
    const identity = entryIdentity(remoteItem)
    const snapshot = snapshotMap.get(identity)
    if (!snapshot) {
      summary.added.push(remoteItem)
      operations.push({ action: 'install', itemKey: remoteItem.itemKey, entry: remoteItem })
      continue
    }
    const remoteHash = toText(remoteItem.canonicalItemHash)
    const installedHash = toText(snapshot.installedItemHash || snapshot.canonicalItemHash)
    const actual = getActualItem(snapshot, actualLookup)
    if (remoteHash !== installedHash) {
      const reference = getOwnershipReference(ownershipReferences, toNumber(snapshot.localModId, 0))
      if (reference.userOwned === true || toNumber(reference.otherInstanceCount, 0) > 0 ||
          ['referenced', 'detached'].includes(snapshot.ownershipMode)) {
        const conflict = { type: 'shared_mod_update_conflict', itemKey: remoteItem.itemKey, snapshot, entry: remoteItem }
        summary.conflicts.push(conflict)
        operations.push({ action: 'conflict', itemKey: remoteItem.itemKey, localModId: snapshot.localModId, reason: conflict.type, entry: remoteItem })
        continue
      }
      summary.changed.push({ ...remoteItem, previous: snapshot })
      operations.push({
        action: actual?.exists === false ? 'install' : 'replace',
        itemKey: remoteItem.itemKey,
        localModId: toNumber(snapshot.localModId, 0),
        entry: remoteItem,
        previous: snapshot
      })
      continue
    }
    const presentationChanged =
      toText(remoteItem.name) !== toText(snapshot.name) ||
      toText(remoteItem.cover) !== toText(snapshot.cover) ||
      toText(remoteItem.description) !== toText(snapshot.description)
    if (presentationChanged) {
      summary.metadataOnly.push({ ...remoteItem, previous: snapshot })
      operations.push({
        action: 'refresh_metadata',
        itemKey: remoteItem.itemKey,
        localModId: toNumber(snapshot.localModId, 0),
        entry: remoteItem
      })
    } else {
      summary.unchanged.push(remoteItem)
    }
  }

  for (const snapshot of snapshots) {
    if (remoteMap.has(entryIdentity(snapshot))) continue
    summary.removed.push(snapshot)
    operations.push(
      buildRemovalOperation(snapshot, summary, ownershipReferences, actualLookup)
    )
  }

  addLocalDrift(summary, snapshots, actualLookup)
  for (const drift of summary.repairMissing) {
    const remoteItem = remoteMap.get(entryIdentity(drift.snapshot))
    if (remoteItem && !operations.some((item) => item.itemKey === remoteItem.itemKey && ['install', 'replace', 'conflict'].includes(item.action))) {
      operations.push({ action: drift.actual?.exists === true ? 'replace' : 'install',
        localModId: toNumber(drift.snapshot.localModId, 0), previous: drift.snapshot,
        itemKey: remoteItem.itemKey, entry: remoteItem, reason: 'repair_missing' })
    }
  }
  for (const drift of summary.localVersionConflict) {
    const remoteItem = remoteMap.get(entryIdentity(drift.snapshot))
    if (remoteItem && !operations.some((item) => item.itemKey === remoteItem.itemKey && ['install', 'replace', 'conflict'].includes(item.action))) {
      operations.push({
        action: 'replace',
        itemKey: remoteItem.itemKey,
        localModId: toNumber(drift.snapshot.localModId, 0),
        entry: remoteItem,
        previous: drift.snapshot,
        reason: 'local_version_conflict'
      })
    }
  }
  // 修复本地版本/缺失文件也会改写原记录，必须沿用更新时的共享保护。
  for (const operation of operations) {
    if (operation.action !== 'replace') continue
    const reference = getOwnershipReference(ownershipReferences, operation.localModId)
    if (reference.userOwned !== true && toNumber(reference.otherInstanceCount, 0) === 0 &&
        !['referenced', 'detached'].includes(operation.previous?.ownershipMode)) continue
    operation.action = 'conflict'
    operation.reason = 'shared_mod_update_conflict'
    summary.conflicts.push({ type: operation.reason, itemKey: operation.itemKey, snapshot: operation.previous, entry: operation.entry })
  }
  for (const drift of summary.localContentConflict) {
    if (!summary.conflicts.some((item) => item.itemKey === drift.itemKey)) {
      summary.conflicts.push(drift)
    }
  }

  const mode = deriveMode({ instance, canonicalPlan, summary })
  return {
    mode,
    fromRevision: toNumber(instance?.installedRevision ?? instance?.installed_revision, 0),
    toRevision: toNumber(canonicalPlan?.remote?.revision, 0),
    planHash: toText(canonicalPlan?.canonicalPlanHash),
    summary,
    operations: mode === 'latest' ? [] : operations,
    warnings: [
      ...(summary.retained.length
        ? [{ code: 'shared_mod_retained', count: summary.retained.length }]
        : []),
      ...(summary.conflicts.length
        ? [{ code: 'local_drift_detected', count: summary.conflicts.length }]
        : [])
    ]
  }
}
