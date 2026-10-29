const INACTIVE_INSTANCE_STATES = new Set(['detached', 'removed'])

function toText(value = '') {
  return String(value ?? '').trim().toLowerCase()
}

export function resolveSourceModpackInspectionLifecycle(instance = null) {
  const inactive = !!instance && INACTIVE_INSTANCE_STATES.has(toText(instance.state))
  return {
    storedInstance: instance,
    comparisonInstance: inactive ? null : instance,
    snapshotItems: inactive ? [] : Array.isArray(instance?.items) ? instance.items : [],
    reactivation: inactive
      ? {
          fromState: toText(instance.state),
          resetPreviousOwnership: true
        }
      : null
  }
}

export function resolveSourceModpackCommittedOwnershipMode({
  previousItem = null,
  installed = null,
  resetPreviousOwnership = false
} = {}) {
  const previousMode = resetPreviousOwnership
    ? ''
    : String(previousItem?.ownershipMode || previousItem?.ownership_mode || '').trim()
  return previousMode || (installed?.reused ? 'referenced' : 'managed')
}
