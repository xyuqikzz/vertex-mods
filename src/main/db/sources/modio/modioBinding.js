import dbInstance from '../../dbInstance.js'
import { findGameRecord, upsertGameRecord } from '../../games/gameRecord.js'

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function normalizeBindingRecord(row = null) {
  if (!row || typeof row !== 'object') return null
  const metadata = (() => {
    try {
      return JSON.parse(String(row.metadata_json || '{}'))
    } catch {
      return {}
    }
  })()
  return {
    id: toSafeNumber(row.id, 0),
    appId: toSafeNumber(row.app_id, 0),
    modioGameId: toSafeNumber(row.source_id, 0),
    backendGameId: toSafeNumber(row.game_id, 0),
    nameId: toSafeText(row.source_slug),
    gameName: toSafeText(row.name),
    coverImage: toSafeText(row.cover_image || row.background_image),
    ruleVersion: toSafeNumber(metadata.ruleVersion, 0),
    detectedRootPath: toSafeText(row.client_root_path),
    detectedExePath: toSafeText(row.client_exe_path),
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

export function upsertModioGameBinding(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const modioGameId = toSafeNumber(target.modioGameId, 0)
  const nameId = toSafeText(target.nameId)
  const appId = toSafeNumber(target.appId || modioGameId, 0)

  if (!modioGameId) {
    return {
      success: false,
      reason: 'invalid_payload'
    }
  }

  upsertGameRecord(
    String(appId || modioGameId),
    toSafeText(target.detectedExePath),
    toSafeNumber(target.backendGameId, 0),
    toSafeText(target.detectedRootPath),
    {
      source: 'modio',
      sourceId: String(modioGameId),
      sourceSlug: nameId,
      appId: String(appId || modioGameId),
      gameId: toSafeNumber(target.backendGameId, 0),
      name: toSafeText(target.gameName),
      coverImage: toSafeText(target.coverImage),
      backgroundImage: toSafeText(target.coverImage),
      metadata: {
        ruleVersion: toSafeNumber(target.ruleVersion, 0)
      }
    }
  )

  const record = findGameRecord({
    source: 'modio',
    sourceId: String(modioGameId),
    sourceSlug: nameId,
    appId: String(appId || modioGameId)
  })
  return {
    success: true,
    reason: 'upserted',
    binding: normalizeBindingRecord(record)
  }
}

export function getModioGameBinding(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const modioGameId = toSafeNumber(target.modioGameId, 0)
  const nameId = toSafeText(target.nameId)
  const appId = toSafeText(target.appId || modioGameId)

  const record = findGameRecord({
    source: 'modio',
    sourceId: String(modioGameId || ''),
    sourceSlug: nameId,
    appId
  })

  return normalizeBindingRecord(record)
}

export function getModioGameBindingsByGameIds(modioGameIds = []) {
  const source = Array.isArray(modioGameIds) ? modioGameIds : []
  const safeGameIds = Array.from(new Set(source.map((item) => toSafeText(item)).filter(Boolean)))
  if (!safeGameIds.length) {
    return []
  }

  const placeholders = safeGameIds.map(() => '?').join(', ')
  const rows = dbInstance.all(
    `
      SELECT *
      FROM games
      WHERE source = 'modio'
        AND source_id IN (${placeholders})
      ORDER BY datetime(updated_at) DESC, id DESC
    `,
    safeGameIds
  )
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeBindingRecord(row)).filter(Boolean)
}
