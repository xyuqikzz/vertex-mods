import path from 'node:path'

function toText(value) {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(toText(value) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeRelativePath(value) {
  return toText(value).replace(/\\/g, '/').replace(/^\/+/, '')
}

function isSafeRelativePath(value) {
  const normalized = normalizeRelativePath(value)
  if (!normalized || path.isAbsolute(normalized)) return false
  return normalized.split('/').every((segment) => segment && segment !== '..')
}

function isPathInsideOrEqual(rootPath, candidatePath) {
  const safeRootPath = toText(rootPath)
  const safeCandidatePath = toText(candidatePath)
  if (!safeRootPath || !safeCandidatePath) return false
  const relativePath = path.relative(path.resolve(safeRootPath), path.resolve(safeCandidatePath))
  return !relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function isSamePath(leftPath, rightPath) {
  return path.resolve(toText(leftPath)).toLowerCase() === path.resolve(toText(rightPath)).toLowerCase()
}

function isSourceAccessError(error) {
  const code = toText(error?.code).toUpperCase()
  const message = toText(error?.message)
  return (
    code === 'EPERM' ||
    code === 'EACCES' ||
    /\b(?:EPERM|EACCES)\b|access is denied|permission denied|拒绝访问/i.test(message)
  )
}

export function createSourceStagingUnreadableError(options = {}) {
  const record = options?.record && typeof options.record === 'object' ? options.record : {}
  const originalError = options?.error
  const sourcePath = toText(originalError?.path || options?.sourcePath || options?.stagingPath)
  const modId = toNumber(record.id ?? record.mod_id, 0)
  const modName = toText(record.name || record.mod_name)
  const error = new Error(
    `无法读取已安装模组的暂存源文件${modName ? `：${modName}` : ''}${sourcePath ? `（${sourcePath}）` : ''}`,
    originalError ? { cause: originalError } : undefined
  )
  error.code = 'source_staging_unreadable'
  error.stage = toText(options?.stage) || 'source_manifest_scan'
  error.modId = modId
  error.modName = modName
  error.sourcePath = sourcePath
  error.systemError = {
    code: toText(originalError?.code),
    errno: Number(originalError?.errno || 0),
    syscall: toText(originalError?.syscall),
    path: toText(originalError?.path) || sourcePath,
    message: toText(originalError?.message || originalError)
  }
  return error
}

function normalizePersistedManifestRows(options = {}) {
  const record = options?.record && typeof options.record === 'object' ? options.record : {}
  const stagingPath = toText(options?.stagingPath)
  const targetPath = toText(options?.targetPath)
  const rows = Array.isArray(options?.persistedRows) ? options.persistedRows : []
  const recordId = toNumber(record.id ?? record.mod_id, 0)

  if (!['locked', 'repair_required'].includes(toText(record.source_lock_state).toLowerCase())) {
    return { valid: false, reason: 'source_not_locked', entries: [] }
  }
  if (!recordId || !stagingPath || !targetPath || !rows.length) {
    return { valid: false, reason: 'manifest_missing', entries: [] }
  }

  const entries = []
  const targetPathKeySet = new Set()
  for (const row of rows) {
    const sourcePath = toText(row?.source_path ?? row?.sourcePath)
    const targetRelativePath = normalizeRelativePath(
      row?.target_relative_path ?? row?.targetRelativePath
    )
    const persistedTargetPath = toText(row?.target_path ?? row?.targetPath)
    const fileHash = toText(row?.file_hash ?? row?.fileHash).toLowerCase()
    const rowModId = toNumber(row?.mod_id ?? row?.modId, 0)
    const metadata = parseJsonObject(row?.metadata_json ?? row?.metadata)
    const targetType = toText(metadata.targetType || row?.target_type || 'file').toLowerCase()

    if (rowModId !== recordId) {
      return { valid: false, reason: 'manifest_mod_mismatch', entries: [] }
    }
    if (!sourcePath || !persistedTargetPath || !isSafeRelativePath(targetRelativePath)) {
      return { valid: false, reason: 'manifest_path_missing', entries: [] }
    }
    if (!/^[a-f0-9]{64}$/.test(fileHash) || targetType !== 'file') {
      return { valid: false, reason: 'manifest_hash_invalid', entries: [] }
    }
    if (metadata.manifestComplete === false) {
      return { valid: false, reason: 'manifest_incomplete', entries: [] }
    }
    if (metadata.stagingRoot && !isSamePath(metadata.stagingRoot, stagingPath)) {
      return { valid: false, reason: 'manifest_staging_root_mismatch', entries: [] }
    }
    if (metadata.targetRoot && !isSamePath(metadata.targetRoot, targetPath)) {
      return { valid: false, reason: 'manifest_target_root_mismatch', entries: [] }
    }
    if (!isPathInsideOrEqual(stagingPath, sourcePath)) {
      return { valid: false, reason: 'manifest_source_outside_staging', entries: [] }
    }
    if (!isPathInsideOrEqual(targetPath, persistedTargetPath)) {
      return { valid: false, reason: 'manifest_target_outside_root', entries: [] }
    }

    const expectedTargetPath = path.resolve(targetPath, ...targetRelativePath.split('/'))
    if (!isSamePath(expectedTargetPath, persistedTargetPath)) {
      return { valid: false, reason: 'manifest_target_mismatch', entries: [] }
    }
    const targetPathKey = path.resolve(persistedTargetPath).toLowerCase()
    if (targetPathKeySet.has(targetPathKey)) {
      return { valid: false, reason: 'manifest_target_duplicate', entries: [] }
    }
    targetPathKeySet.add(targetPathKey)

    entries.push({
      sourcePath: path.resolve(sourcePath),
      targetRelativePath,
      targetPath: path.resolve(persistedTargetPath),
      fileSize: toNumber(row?.file_size ?? row?.fileSize, 0),
      fileHash,
      targetType: 'file',
      metadata
    })
  }

  return { valid: true, reason: '', entries }
}

export async function resolveDeploymentManifestEntries(options = {}) {
  const persisted = normalizePersistedManifestRows(options)
  if (persisted.valid) {
    return {
      entries: persisted.entries,
      source: 'persisted_manifest',
      reused: true,
      fallbackReason: ''
    }
  }

  const scanManifest = options?.scanManifest
  if (typeof scanManifest !== 'function') {
    throw new TypeError('scanManifest 必须是函数')
  }

  try {
    return {
      entries: await scanManifest(),
      source: 'staging_scan',
      reused: false,
      fallbackReason: persisted.reason
    }
  } catch (error) {
    if (error?.code === 'source_staging_unreadable') throw error
    if (!isSourceAccessError(error)) throw error
    throw createSourceStagingUnreadableError({
      record: options?.record,
      stagingPath: options?.stagingPath,
      sourcePath: error?.path,
      stage: 'source_manifest_scan',
      error
    })
  }
}
