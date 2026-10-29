import dbInstance from '../../dbInstance.js'
import { statSync } from 'node:fs'
import { findGameRecord, upsertGameRecord } from '../../games/gameRecord.js'

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function isBindingPathAvailable(rootPath, exePath) {
  if (!rootPath) return false
  try {
    return statSync(rootPath).isDirectory() && (!exePath || statSync(exePath).isFile())
  } catch {
    return false
  }
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
  const detectedRootPath = toSafeText(row.client_root_path)
  const detectedExePath = toSafeText(row.client_exe_path)
  return {
    id: toSafeNumber(row.id, 0),
    appId: toSafeNumber(row.app_id, 0),
    nexusGameId: toSafeNumber(row.source_id, 0),
    backendGameId: toSafeNumber(row.game_id, 0),
    domainName: toSafeText(row.source_slug),
    gameName: toSafeText(row.name),
    coverImage: toSafeText(row.cover_image || row.background_image),
    ruleVersion: toSafeNumber(metadata.ruleVersion, 0),
    detectedRootPath,
    detectedExePath,
    isAvailable: isBindingPathAvailable(detectedRootPath, detectedExePath),
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

export function upsertNexusGameBinding(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const appId = toSafeNumber(target.appId, 0)
  const nexusGameId = toSafeNumber(target.nexusGameId, 0)
  const domainName = toSafeText(target.domainName)

  if (!nexusGameId || !domainName) {
    return {
      success: false,
      reason: 'invalid_payload'
    }
  }

  upsertGameRecord(
    String(appId || ''),
    toSafeText(target.detectedExePath),
    toSafeNumber(target.backendGameId, 0),
    toSafeText(target.detectedRootPath),
    {
      source: 'nexus',
      sourceId: String(nexusGameId),
      sourceSlug: domainName,
      appId: String(appId || ''),
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
    source: 'nexus',
    sourceId: String(nexusGameId),
    sourceSlug: domainName,
    appId: String(appId || '')
  })
  return {
    success: true,
    reason: 'upserted',
    binding: normalizeBindingRecord(record)
  }
}

export function getNexusGameBindingsByAppIds(appIds = []) {
  const source = Array.isArray(appIds) ? appIds : []
  const safeAppIds = Array.from(new Set(source.map((item) => toSafeText(item)).filter(Boolean)))
  if (!safeAppIds.length) {
    return []
  }

  const placeholders = safeAppIds.map(() => '?').join(', ')
  const rows = dbInstance.all(
    `
      SELECT *
      FROM games
      WHERE source = 'nexus'
        AND app_id IN (${placeholders})
      ORDER BY datetime(updated_at) DESC, id DESC
    `,
    safeAppIds
  )
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeBindingRecord(row)).filter(Boolean)
}

export function getNexusGameBinding(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const nexusGameId = toSafeNumber(target.nexusGameId, 0)
  const domainName = toSafeText(target.domainName)
  const appId = toSafeText(target.appId)

  const record = findGameRecord({
    source: 'nexus',
    sourceId: String(nexusGameId || ''),
    sourceSlug: domainName,
    appId
  })

  return normalizeBindingRecord(record)
}
