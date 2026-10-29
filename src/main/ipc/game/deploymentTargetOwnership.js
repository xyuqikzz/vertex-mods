function toPositiveId(value = 0) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function normalizeSha256(value = '') {
  const hash = String(value || '')
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(hash) ? hash : ''
}

export function resolveExistingTargetDisposition(input = {}) {
  if (input.targetExists !== true) {
    return {
      action: 'create',
      backupRequired: false,
      writeRequired: true,
      restorePolicy: ''
    }
  }

  if (toPositiveId(input.currentOwnerModId)) {
    return {
      action: 'replace_managed',
      backupRequired: true,
      writeRequired: true,
      restorePolicy: ''
    }
  }

  const targetFileHash = normalizeSha256(input.targetFileHash)
  const incomingFileHash = normalizeSha256(input.incomingFileHash)
  if (
    String(input.targetType || 'file')
      .trim()
      .toLowerCase() === 'file' &&
    targetFileHash &&
    targetFileHash === incomingFileHash
  ) {
    return {
      action: 'adopt_identical',
      backupRequired: false,
      writeRequired: false,
      restorePolicy: ''
    }
  }

  return {
    action: 'replace_preexisting',
    backupRequired: true,
    writeRequired: true,
    restorePolicy: 'restore_preexisting'
  }
}

export function shouldRemoveTargetDuringRollback(action = '') {
  const normalizedAction = String(action || '')
    .trim()
    .toLowerCase()
  return normalizedAction !== 'adopt' && normalizedAction !== 'ensure_dir'
}
