function toModId(mod) {
  const id = Number(mod && typeof mod === 'object' ? (mod?.id ?? mod?.mod_id ?? 0) : mod)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function isDefaultDependency(mod) {
  if (mod?.isDefaultDependency === true || Number(mod?.type_id || 0) === 1) return true
  try {
    const metadata =
      typeof mod?.metadata_json === 'string'
        ? JSON.parse(mod.metadata_json || '{}')
        : mod?.metadata_json
    return metadata?.isDefaultDependency === true || metadata?.dependency?.isDefault === true
  } catch {
    return false
  }
}

function uniqueMods(mods = []) {
  const seen = new Set()
  return (Array.isArray(mods) ? mods : []).filter((mod) => {
    const id = toModId(mod)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function sortModsForBulkMutation(mods = []) {
  const sorted = uniqueMods(mods).sort((left, right) => {
    const dependencyOrder = Number(isDefaultDependency(left)) - Number(isDefaultDependency(right))
    if (dependencyOrder !== 0) return dependencyOrder
    return toModId(left) - toModId(right)
  })
  const byId = new Map(sorted.map((mod) => [toModId(mod), mod]))
  const waiting = new Map()
  const unblocks = new Map()
  for (const mod of sorted) {
    const id = toModId(mod)
    const dependents = [...new Set((mod.activeDependents || []).map(toModId))].filter(
      (dependentId) => dependentId !== id && byId.has(dependentId)
    )
    waiting.set(id, dependents.length)
    for (const dependentId of dependents) {
      if (!unblocks.has(dependentId)) unblocks.set(dependentId, [])
      unblocks.get(dependentId).push(id)
    }
  }
  const ready = sorted.filter((mod) => waiting.get(toModId(mod)) === 0)
  const ordered = []
  const seen = new Set()
  for (let index = 0; index < ready.length; index++) {
    const mod = ready[index]
    const id = toModId(mod)
    seen.add(id)
    ordered.push(mod)
    for (const targetId of unblocks.get(id) || []) {
      waiting.set(targetId, waiting.get(targetId) - 1)
      if (waiting.get(targetId) === 0) ready.push(byId.get(targetId))
    }
  }
  // Cycles stay in the result so execution can report them; never force-disable them.
  return [...ordered, ...sorted.filter((mod) => !seen.has(toModId(mod)))]
}

async function resolveDependencies(options = {}) {
  const hasAllDependencies =
    options.unlockModSource &&
    options.lockModSource &&
    options.requestElevatedRepair &&
    options.updateLockState
  const runtime = hasAllDependencies
    ? null
    : (await import('./modSourceMutationRuntime.js')).getModSourceMutationRuntimeDependencies()
  return {
    unlockModSource: options.unlockModSource || runtime.unlockModSource,
    lockModSource: options.lockModSource || runtime.lockModSource,
    requestElevatedRepair:
      options.requestElevatedRepair || runtime.requestElevatedModSourceRepair,
    updateLockState: options.updateLockState || runtime.updateModSourceLockState
  }
}

async function rollbackUnlockedMods(mods, dependencies) {
  const rollback = []
  for (const mod of [...mods].reverse()) {
    const id = toModId(mod)
    try {
      const result = await dependencies.lockModSource(mod)
      dependencies.updateLockState(id, result?.success ? 'locked' : 'repair_required')
      rollback.push({ id, success: result?.success === true, result })
    } catch (error) {
      dependencies.updateLockState(id, 'repair_required')
      rollback.push({ id, success: false, error: String(error?.message || error) })
    }
  }
  return rollback
}

export async function ensureModSourcesWritableForMutation(mods = [], options = {}) {
  const targetMods = sortModsForBulkMutation(mods)
  if (!targetMods.length) {
    return { success: true, mods: [], unlockedIds: [], elevated: false }
  }

  const dependencies = await resolveDependencies(options)
  const unlockedMods = []
  const failed = []
  for (const mod of targetMods) {
    const result = await dependencies.unlockModSource(mod)
    if (result?.success) {
      unlockedMods.push(mod)
      dependencies.updateLockState(toModId(mod), 'unlocked')
    } else {
      failed.push({ mod, result })
    }
  }

  if (!failed.length) {
    return {
      success: true,
      mods: targetMods,
      unlockedIds: unlockedMods.map(toModId),
      elevated: false
    }
  }

  const elevation = await dependencies.requestElevatedRepair(failed.map((item) => item.mod))
  if (!elevation?.success) {
    const repairedIdSet = new Set(
      (Array.isArray(elevation?.repairedIds) ? elevation.repairedIds : [])
        .map(toModId)
        .filter(Boolean)
    )
    const elevatedUnlockedMods = failed
      .map((item) => item.mod)
      .filter((mod) => repairedIdSet.has(toModId(mod)))
    const rollback = await rollbackUnlockedMods(
      [...unlockedMods, ...elevatedUnlockedMods],
      dependencies
    )
    for (const { mod } of failed) {
      dependencies.updateLockState(toModId(mod), 'repair_required')
    }
    return {
      success: false,
      code: String(elevation?.code || 'source_protection_repair_failed'),
      message: String(elevation?.message || '无法修复模组源文件保护状态，批量操作未执行'),
      failedIds: failed.map((item) => toModId(item.mod)),
      failures: failed.map((item) => item.result),
      elevation,
      rollback
    }
  }

  const retryUnlocked = []
  const retryFailures = []
  for (const { mod } of failed) {
    const result = await dependencies.unlockModSource(mod)
    if (result?.success) {
      retryUnlocked.push(mod)
      dependencies.updateLockState(toModId(mod), 'unlocked')
    } else {
      retryFailures.push({ mod, result })
      dependencies.updateLockState(toModId(mod), 'repair_required')
    }
  }

  if (retryFailures.length) {
    const rollback = await rollbackUnlockedMods([...unlockedMods, ...retryUnlocked], dependencies)
    return {
      success: false,
      code: 'source_protection_repair_validation_failed',
      message: '源文件保护修复后仍无法由普通权限修改，批量操作未执行',
      failedIds: retryFailures.map((item) => toModId(item.mod)),
      failures: retryFailures.map((item) => item.result),
      elevation,
      rollback
    }
  }

  return {
    success: true,
    mods: targetMods,
    unlockedIds: [...unlockedMods, ...retryUnlocked].map(toModId),
    elevated: true,
    elevation
  }
}

function needsBulkAclRepair(mod) {
  const state = String(mod?.source_lock_state || '')
    .trim()
    .toLowerCase()
  return state === 'repair_required' || state === 'lock_failed'
}

export async function prepareModSourcesForBulkMutation(mods = [], options = {}) {
  const repairMods = sortModsForBulkMutation(mods).filter(needsBulkAclRepair)
  if (!repairMods.length) {
    return { success: true, repairedIds: [], elevated: false, relock: [] }
  }

  const writable = await ensureModSourcesWritableForMutation(repairMods, options)
  if (!writable.success) return writable

  const dependencies = await resolveDependencies(options)
  const relock = await rollbackUnlockedMods(repairMods, dependencies)
  const relockFailures = relock.filter((item) => !item.success)
  if (relockFailures.length) {
    return {
      success: false,
      code: 'source_protection_repair_relock_failed',
      message: '旧源文件保护已修复，但无法恢复新保护状态，批量操作未执行',
      failedIds: relockFailures.map((item) => item.id),
      failures: relockFailures,
      elevation: writable.elevation || null,
      relock
    }
  }

  return {
    success: true,
    repairedIds: repairMods.map(toModId),
    elevated: writable.elevated === true,
    elevation: writable.elevation || null,
    relock
  }
}
