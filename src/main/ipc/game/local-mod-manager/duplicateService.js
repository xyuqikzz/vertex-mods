import path from 'path'
import { getModListByAppIdSql } from '../../../db/games/game.js'
import { findLocalModLibraryDuplicate, resolveGameRow } from '../../../db/mods/localModLibrary.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseJsonObject(value = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value = '') {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function samePath(left = '', right = '') {
  if (!left || !right) return false
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

export function findDuplicateLocalAsset(payload = {}) {
  const game = resolveGameRow(payload)
  const fingerprint = toSafeText(payload.fingerprint || payload.analysis?.fingerprint)
  if (!game?.id || !fingerprint) return null
  return findLocalModLibraryDuplicate({
    gameId: game.id,
    fingerprint
  })
}

export function findDuplicateLocalBindingPath(payload = {}) {
  const targetPath = toSafeText(payload.path || payload.originalPath)
  if (!targetPath) return null
  const sourceMeta =
    payload.sourceMeta && typeof payload.sourceMeta === 'object' ? payload.sourceMeta : {}
  const records = getModListByAppIdSql(
    toSafeNumber(payload.appId ?? payload.appid, 0),
    toSafeNumber(payload.endpointType ?? payload.type, 0),
    sourceMeta
  )
  for (const record of records || []) {
    const metadata = parseJsonObject(record.metadata_json)
    const flags = parseJsonArray(record.compat_flags)
    const isLocalBinding =
      record.install_model === 'bound' ||
      metadata.localBinding === true ||
      flags.includes('local_binding')
    if (!isLocalBinding) continue
    for (const item of parseJsonArray(metadata.items)) {
      if (samePath(targetPath, item?.originalPath) || samePath(targetPath, item?.disabledPath)) {
        return {
          recordId: record.id,
          name: record.name,
          path: targetPath
        }
      }
    }
  }
  return null
}
