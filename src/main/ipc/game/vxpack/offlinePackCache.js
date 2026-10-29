import fs from 'fs-extra'
import path from 'path'
import userPath from '../../../initPath.js'
import dbInstance from '../../../db/dbInstance.js'
import {
  OFFLINE_PACK_CACHE_RETENTION_DAYS,
  resolveOfflinePackCacheKeyFromPayload,
  shouldCleanupOfflinePackCacheEntry
} from '../../../../shared/modpacks/offline-pack-contract.js'
import { parseJsonObject, TERMINAL_JOB_STATES, toSafeNumber, toSafeText } from '../source-install-task/contracts.js'

const OFFLINE_PACK_CACHE_DIR_NAME = 'offline-pack-cache'

export function getOfflinePackCacheRoot() {
  return path.join(userPath, OFFLINE_PACK_CACHE_DIR_NAME)
}

function isPathInside(parentPath = '', childPath = '') {
  const relative = path.relative(parentPath, childPath)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function normalizePackageSha256List(value = []) {
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => toSafeText(item)).filter(Boolean)
}

export function listActiveOfflinePackCacheKeys(extraKeys = []) {
  const keys = new Set(normalizePackageSha256List(extraKeys))
  const terminalStates = [...TERMINAL_JOB_STATES]
  try {
    const rows =
      dbInstance.all(
        `SELECT payload_json
         FROM source_install_job
         WHERE state NOT IN (${terminalStates.map(() => '?').join(',')})`,
        terminalStates
      ) || []
    for (const row of rows) {
      const payload = parseJsonObject(row?.payload_json, {})
      const cacheKey = resolveOfflinePackCacheKeyFromPayload(payload)
      if (cacheKey) keys.add(cacheKey)
    }
  } catch {
    // 任务表尚未初始化时，只使用调用方传入的保护列表。
  }
  return keys
}

export async function cleanupOfflinePackCache(payload = {}) {
  const retentionDays = Math.max(
    0,
    toSafeNumber(payload.retentionDays ?? payload.retention_days, OFFLINE_PACK_CACHE_RETENTION_DAYS)
  )
  const dryRun = payload.dryRun === true
  const force = payload.force === true
  const respectActiveTasks = payload.respectActiveTasks !== false
  const targetKeys = new Set([
    ...normalizePackageSha256List(payload.packageSha256s),
    ...normalizePackageSha256List(payload.packageSha256),
    ...normalizePackageSha256List(payload.targetPackageSha256s),
    ...normalizePackageSha256List(payload.targetPackageSha256)
  ])
  const cacheRoot = getOfflinePackCacheRoot()
  const nowMs = Number(payload.nowMs || Date.now())
  const protectedKeys = respectActiveTasks
    ? listActiveOfflinePackCacheKeys([
        ...normalizePackageSha256List(payload.protectedPackageSha256s),
        ...normalizePackageSha256List(payload.protectedPackageSha256),
        ...normalizePackageSha256List(payload.protectedKeys)
      ])
    : new Set()

  if (!(await fs.pathExists(cacheRoot))) {
    return {
      success: true,
      data: {
        cacheRoot,
        retentionDays,
        dryRun,
        force,
        removed: [],
        kept: []
      }
    }
  }

  const entries = await fs.readdir(cacheRoot, { withFileTypes: true })
  const removed = []
  const kept = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const targetPath = path.join(cacheRoot, entry.name)
    if (!isPathInside(cacheRoot, targetPath)) continue
    const stat = await fs.stat(targetPath)
    const ageMs = Math.max(0, nowMs - stat.mtimeMs)
    const item = {
      packageSha256: entry.name,
      path: targetPath,
      ageMs
    }

    if (targetKeys.size && !targetKeys.has(entry.name)) {
      kept.push({ ...item, reason: 'outside_scope' })
      continue
    }

    if (protectedKeys.has(entry.name)) {
      kept.push({ ...item, reason: 'active_task' })
      continue
    }

    if (
      force ||
      shouldCleanupOfflinePackCacheEntry({
        mtimeMs: stat.mtimeMs,
        nowMs,
        retentionDays
      })
    ) {
      removed.push(item)
      if (!dryRun) {
        await fs.remove(targetPath)
      }
    } else {
      kept.push({ ...item, reason: 'retained' })
    }
  }

  return {
    success: true,
    data: {
      cacheRoot,
      retentionDays,
      dryRun,
      force,
      removed,
      kept
    }
  }
}
