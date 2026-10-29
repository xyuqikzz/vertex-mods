import dbInstance from '../dbInstance.js'
import fs from 'fs'
import crypto from 'crypto'
import path from 'path'

function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback))
  } catch {
    return fallback
  }
}

function parse(value, fallback) {
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(toText(value) || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

function nowIso() {
  return new Date().toISOString()
}

function hashFileSync(filePath = '', algorithm = 'sha256') {
  const fd = fs.openSync(filePath, 'r')
  const hash = crypto.createHash(algorithm)
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let read = 0
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (read > 0) hash.update(buffer.subarray(0, read))
    } while (read > 0)
    return hash.digest('hex')
  } finally {
    fs.closeSync(fd)
  }
}

function inspectManifestContent(localModId = 0, database = dbInstance) {
  let manifests = all(database, 'SELECT * FROM mod_file_manifest WHERE mod_id = ?', [localModId])
  const mod = get(database, 'SELECT * FROM mods WHERE id = ?', [localModId])
  const native = !manifests.length && mod?.source === 'thunderstore'
  if (native) {
    const metadata = parse(mod.metadata_json, {})
    const integrity = metadata.sourceModpackIntegrity
    if (Array.isArray(integrity?.files)) {
      const root = toText(mod.target_path || metadata.installRoot)
      const relativeRoot = Number(mod.is_active) === 1 ? '' : toText(integrity.disabledRelativeRoot)
      const inside = (relative) => !path.isAbsolute(relative) && !path.relative(path.resolve(root), path.resolve(root, relative)).startsWith('..')
      if (!root || !inside(relativeRoot) || integrity.files.some((file) => !file.relativePath || !inside(file.relativePath))) {
        return { contentMissing: false, contentIntact: false, manifestCount: integrity.files.length }
      }
      manifests = integrity.files.map((file) => ({
        target_path: path.resolve(root, relativeRoot, file.relativePath),
        file_hash: file.md5, file_size: file.fileSize
      }))
    }
  }
  const result = (contentIntact, contentMissing = false) => ({ contentMissing, contentIntact, manifestCount: manifests.length })
  if (!manifests.length) return result(true)
  const hasOwners = !native && !!get(database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mod_file_owners'")
  for (const manifest of manifests) {
    const source = toText(manifest.source_path)
    const target = toText(manifest.target_path)
    const paths = []
    if (native) paths.push(target)
    else {
      // 暂存是每个模组自身内容的证据；禁用或被其他优先级覆盖不等于损坏。
      paths.push(source || (Number(mod?.is_active) === 1 ? target : ''))
      if (Number(mod?.is_active) === 1 && target) {
        const owner = hasOwners ? get(database,
          'SELECT owner_mod_id FROM mod_file_owners WHERE game_id = ? AND endpoint_type = ? AND deploy_domain = ? AND target_path = ? COLLATE NOCASE',
          [manifest.game_id ?? mod.game_id, manifest.endpoint_type ?? mod.endpoint_type,
            manifest.deploy_domain ?? mod.deploy_domain, target]) : null
        if (!owner || Number(owner.owner_mod_id) === Number(localModId)) paths.push(target)
      }
    }
    for (const filePath of new Set(paths)) {
      if (!filePath || !fs.existsSync(filePath)) return result(false, true)
      try {
        const stat = fs.statSync(filePath)
        if (parse(manifest.metadata_json, {}).targetType === 'dir') {
          if (!stat.isDirectory()) return result(false)
          continue
        }
        if (!stat.isFile()) return result(false)
        const expectedSize = toNumber(manifest.file_size, 0)
        if (expectedSize > 0 && stat.size !== expectedSize) return result(false)
        const expectedHash = toText(manifest.file_hash).toLowerCase()
        if (expectedHash && hashFileSync(filePath, expectedHash.length === 32 ? 'md5' : 'sha256') !== expectedHash)
          return result(false)
      } catch { return result(false) }
    }
  }
  return result(true)
}

function run(database, sql, params = []) {
  return database.run(sql, params)
}

function all(database, sql, params = []) {
  return database.all(sql, params)
}

function get(database, sql, params = []) {
  return database.get(sql, params)
}

export function ensureSourceModpackInstanceTables(database = dbInstance) {
  run(database, `CREATE TABLE IF NOT EXISTS source_modpack_instances
    (
      instance_id TEXT PRIMARY KEY,
      remote_pack_uid TEXT NOT NULL,
      remote_pack_id INTEGER NOT NULL DEFAULT 0,
      share_code TEXT NOT NULL DEFAULT '',
      local_game_installation_id INTEGER NOT NULL,
      endpoint_type INTEGER NOT NULL DEFAULT 0,
      instance_slot TEXT NOT NULL DEFAULT 'default',
      installed_revision INTEGER NOT NULL DEFAULT 0,
      installed_manifest_hash TEXT NOT NULL DEFAULT '',
      desired_revision INTEGER NOT NULL DEFAULT 0,
      desired_manifest_hash TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'installing',
      last_error_code TEXT NOT NULL DEFAULT '',
      last_error_message TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT NOT NULL DEFAULT '',
      installed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (remote_pack_uid, local_game_installation_id, endpoint_type, instance_slot)
    )`)
  run(database, `CREATE TABLE IF NOT EXISTS source_modpack_instance_targets
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      source_platform TEXT NOT NULL,
      source_game_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL,
      profile_name TEXT NOT NULL DEFAULT '',
      game_root TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (instance_id, source_platform, source_game_id, profile_id)
    )`)
  run(database, `CREATE TABLE IF NOT EXISTS source_modpack_instance_items
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      origin_item_key TEXT NOT NULL DEFAULT '',
      source_platform TEXT NOT NULL,
      source_game_id TEXT NOT NULL DEFAULT '',
      source_mod_id TEXT NOT NULL DEFAULT '',
      source_file_id TEXT NOT NULL DEFAULT '',
      source_mod_key TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      local_mod_id INTEGER,
      dependency_role TEXT NOT NULL DEFAULT 'main',
      ownership_mode TEXT NOT NULL DEFAULT 'referenced',
      installed_item_hash TEXT NOT NULL DEFAULT '',
      installed_payload_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'installed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (instance_id, item_key, dependency_role, origin_item_key)
    )`)
  run(database, `CREATE TABLE IF NOT EXISTS source_modpack_instance_plans
    (
      plan_token TEXT PRIMARY KEY,
      plan_hash TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      remote_pack_uid TEXT NOT NULL,
      remote_revision INTEGER NOT NULL DEFAULT 0,
      base_state_hash TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'inspected',
      plan_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )`)
  run(database, `CREATE TABLE IF NOT EXISTS source_modpack_instance_jobs
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      plan_token TEXT NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      source_platform TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
  run(database, `CREATE INDEX IF NOT EXISTS idx_source_modpack_instances_remote
    ON source_modpack_instances (remote_pack_uid, local_game_installation_id, endpoint_type)`)
  run(database, `CREATE INDEX IF NOT EXISTS idx_source_modpack_instance_items_mod
    ON source_modpack_instance_items (local_mod_id, ownership_mode, state)`)
  run(database, `CREATE INDEX IF NOT EXISTS idx_source_modpack_instance_jobs_instance
    ON source_modpack_instance_jobs (instance_id, plan_token, state)`)
}

function normalizeInstance(row) {
  if (!row) return null
  return {
    ...row,
    instanceId: row.instance_id,
    remotePackUid: row.remote_pack_uid,
    remotePackId: toNumber(row.remote_pack_id, 0),
    shareCode: row.share_code,
    localGameInstallationId: toNumber(row.local_game_installation_id, 0),
    endpointType: toNumber(row.endpoint_type, 0),
    instanceSlot: row.instance_slot,
    installedRevision: toNumber(row.installed_revision, 0),
    installedManifestHash: row.installed_manifest_hash,
    desiredRevision: toNumber(row.desired_revision, 0),
    desiredManifestHash: row.desired_manifest_hash,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message
  }
}

function normalizeTarget(row) {
  return {
    ...row,
    instanceId: row.instance_id,
    sourcePlatform: row.source_platform,
    sourceGameId: row.source_game_id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    gameRoot: row.game_root,
    metadata: parse(row.metadata_json, {})
  }
}

function normalizeItem(row) {
  return {
    ...row,
    instanceId: row.instance_id,
    itemKey: row.item_key,
    originItemKey: row.origin_item_key,
    sourcePlatform: row.source_platform,
    sourceGameId: row.source_game_id,
    sourceModId: row.source_mod_id,
    sourceFileId: row.source_file_id,
    sourceModKey: row.source_mod_key,
    localModId: toNumber(row.local_mod_id, 0),
    dependencyRole: row.dependency_role,
    ownershipMode: row.ownership_mode,
    installedItemHash: row.installed_item_hash,
    installedPayload: parse(row.installed_payload_json, {})
  }
}

export function getSourceModpackInstanceByIdentity(identity = {}, database = dbInstance) {
  ensureSourceModpackInstanceTables(database)
  return normalizeInstance(get(database, `SELECT * FROM source_modpack_instances
    WHERE remote_pack_uid = ? AND local_game_installation_id = ? AND endpoint_type = ?
      AND instance_slot = ? LIMIT 1`, [
    toText(identity.remotePackUid || identity.packUid),
    toNumber(identity.localGameInstallationId, 0),
    toNumber(identity.endpointType, 0),
    toText(identity.instanceSlot || 'default') || 'default'
  ]))
}

export function getSourceModpackInstance(instanceId = '', database = dbInstance) {
  ensureSourceModpackInstanceTables(database)
  const instance = normalizeInstance(get(database,
    `SELECT * FROM source_modpack_instances WHERE instance_id = ? LIMIT 1`, [toText(instanceId)]))
  if (!instance) return null
  instance.targets = all(database,
    `SELECT * FROM source_modpack_instance_targets WHERE instance_id = ? ORDER BY id ASC`,
    [instance.instanceId]).map(normalizeTarget)
  instance.items = all(database,
    `SELECT * FROM source_modpack_instance_items WHERE instance_id = ? ORDER BY id ASC`,
    [instance.instanceId]).map(normalizeItem)
  instance.jobs = all(database,
    `SELECT * FROM source_modpack_instance_jobs WHERE instance_id = ? ORDER BY id ASC`,
    [instance.instanceId]).map((row) => ({ ...row, result: parse(row.result_json, {}) }))
  return instance
}

export function upsertSourceModpackInstance(data = {}, database = dbInstance) {
  ensureSourceModpackInstanceTables(database)
  const now = nowIso()
  run(database, `INSERT INTO source_modpack_instances
    (instance_id, remote_pack_uid, remote_pack_id, share_code, local_game_installation_id,
     endpoint_type, instance_slot, installed_revision, installed_manifest_hash,
     desired_revision, desired_manifest_hash, state, last_error_code, last_error_message,
     last_checked_at, installed_at, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      remote_pack_uid=excluded.remote_pack_uid, remote_pack_id=excluded.remote_pack_id,
      share_code=excluded.share_code, local_game_installation_id=excluded.local_game_installation_id,
      endpoint_type=excluded.endpoint_type, instance_slot=excluded.instance_slot,
      installed_revision=excluded.installed_revision,
      installed_manifest_hash=excluded.installed_manifest_hash,
      desired_revision=excluded.desired_revision, desired_manifest_hash=excluded.desired_manifest_hash,
      state=excluded.state, last_error_code=excluded.last_error_code,
      last_error_message=excluded.last_error_message, last_checked_at=excluded.last_checked_at,
      installed_at=excluded.installed_at, updated_at=excluded.updated_at`, [
    toText(data.instanceId || data.instance_id),
    toText(data.remotePackUid || data.remote_pack_uid || data.packUid),
    toNumber(data.remotePackId ?? data.remote_pack_id, 0),
    toText(data.shareCode || data.share_code),
    toNumber(data.localGameInstallationId ?? data.local_game_installation_id, 0),
    toNumber(data.endpointType ?? data.endpoint_type, 0),
    toText(data.instanceSlot || data.instance_slot || 'default') || 'default',
    toNumber(data.installedRevision ?? data.installed_revision, 0),
    toText(data.installedManifestHash || data.installed_manifest_hash),
    toNumber(data.desiredRevision ?? data.desired_revision, 0),
    toText(data.desiredManifestHash || data.desired_manifest_hash),
    toText(data.state || 'installing'),
    toText(data.lastErrorCode || data.last_error_code),
    toText(data.lastErrorMessage || data.last_error_message),
    toText(data.lastCheckedAt || data.last_checked_at || now),
    toText(data.installedAt || data.installed_at), now,
    toText(data.createdAt || data.created_at || now)
  ])
  return getSourceModpackInstance(data.instanceId || data.instance_id, database)
}

export function updateSourceModpackInstance(instanceId = '', patch = {}, database = dbInstance) {
  const columns = {
    state: patch.state,
    installed_revision: patch.installedRevision ?? patch.installed_revision,
    installed_manifest_hash: patch.installedManifestHash ?? patch.installed_manifest_hash,
    desired_revision: patch.desiredRevision ?? patch.desired_revision,
    desired_manifest_hash: patch.desiredManifestHash ?? patch.desired_manifest_hash,
    last_error_code: patch.lastErrorCode ?? patch.last_error_code,
    last_error_message: patch.lastErrorMessage ?? patch.last_error_message,
    last_checked_at: patch.lastCheckedAt ?? patch.last_checked_at,
    installed_at: patch.installedAt ?? patch.installed_at
  }
  const entries = Object.entries(columns).filter(([, value]) => value !== undefined)
  entries.push(['updated_at', nowIso()])
  run(database, `UPDATE source_modpack_instances SET ${entries.map(([key]) => `${key} = ?`).join(', ')}
    WHERE instance_id = ?`, [...entries.map(([, value]) => value), toText(instanceId)])
  return getSourceModpackInstance(instanceId, database)
}

export function upsertSourceModpackInstanceTarget(data = {}, database = dbInstance) {
  const now = nowIso()
  run(database, `INSERT INTO source_modpack_instance_targets
    (instance_id, source_platform, source_game_id, profile_id, profile_name, game_root,
     metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id, source_platform, source_game_id, profile_id) DO UPDATE SET
      profile_name=excluded.profile_name, game_root=excluded.game_root,
      metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`, [
    toText(data.instanceId), toText(data.sourcePlatform), toText(data.sourceGameId),
    toText(data.profileId), toText(data.profileName), toText(data.gameRoot),
    stringify(data.metadata || {}), now, now
  ])
}

export function replaceSourceModpackInstanceItems(instanceId = '', items = [], database = dbInstance) {
  const safeInstanceId = toText(instanceId)
  const now = nowIso()
  const identities = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const originItemKey = toText(item.originItemKey || item.itemKey)
    const dependencyRole = toText(item.dependencyRole || 'main')
    identities.add([toText(item.itemKey), dependencyRole, originItemKey].join('|'))
    run(database, `INSERT INTO source_modpack_instance_items
      (instance_id, item_key, origin_item_key, source_platform, source_game_id, source_mod_id,
       source_file_id, source_mod_key, version, name, cover, description, local_mod_id,
       dependency_role, ownership_mode, installed_item_hash, installed_payload_json, state,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, item_key, dependency_role, origin_item_key) DO UPDATE SET
       source_platform=excluded.source_platform, source_game_id=excluded.source_game_id,
       source_mod_id=excluded.source_mod_id, source_file_id=excluded.source_file_id,
       source_mod_key=excluded.source_mod_key, version=excluded.version, name=excluded.name,
       cover=excluded.cover, description=excluded.description, local_mod_id=excluded.local_mod_id,
       ownership_mode=excluded.ownership_mode, installed_item_hash=excluded.installed_item_hash,
       installed_payload_json=excluded.installed_payload_json, state=excluded.state,
       updated_at=excluded.updated_at`, [
      safeInstanceId, toText(item.itemKey), originItemKey, toText(item.sourcePlatform),
      toText(item.sourceGameId), toText(item.sourceModId), toText(item.sourceFileId),
      toText(item.sourceModKey), toText(item.version), toText(item.name), toText(item.cover),
      toText(item.description), toNumber(item.localModId, 0) || null, dependencyRole,
      toText(item.ownershipMode || 'referenced'),
      toText(item.installedItemHash || item.canonicalItemHash),
      stringify(item.installedPayload || item.installPayload || {}),
      toText(item.state || 'installed'), now, now
    ])
  }
  const existing = all(database, `SELECT id, item_key, dependency_role, origin_item_key
    FROM source_modpack_instance_items WHERE instance_id = ?`, [safeInstanceId])
  for (const row of existing) {
    if (!identities.has([row.item_key, row.dependency_role, row.origin_item_key].join('|'))) {
      run(database, `DELETE FROM source_modpack_instance_items WHERE id = ?`, [row.id])
    }
  }
}

export function saveSourceModpackInspectionPlan(plan = {}, database = dbInstance) {
  const now = Date.now()
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString()
  run(database, `INSERT INTO source_modpack_instance_plans
    (plan_token, plan_hash, instance_id, remote_pack_uid, remote_revision, base_state_hash,
     mode, state, plan_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'inspected', ?, ?, ?)
    ON CONFLICT(plan_token) DO UPDATE SET plan_hash=excluded.plan_hash,
     instance_id=excluded.instance_id, remote_pack_uid=excluded.remote_pack_uid,
     remote_revision=excluded.remote_revision, base_state_hash=excluded.base_state_hash,
     mode=excluded.mode, state='inspected', plan_json=excluded.plan_json,
     created_at=excluded.created_at, expires_at=excluded.expires_at`, [
    toText(plan.planToken), toText(plan.planHash), toText(plan.instanceId),
    toText(plan.remotePackUid), toNumber(plan.remoteRevision, 0), toText(plan.baseStateHash),
    toText(plan.mode), stringify(plan.plan || plan), new Date(now).toISOString(), expiresAt
  ])
  return getSourceModpackInspectionPlan(plan.planToken, database)
}

export function getSourceModpackInspectionPlan(planToken = '', database = dbInstance) {
  const row = get(database,
    `SELECT * FROM source_modpack_instance_plans WHERE plan_token = ? LIMIT 1`, [toText(planToken)])
  return row ? { ...row, plan: parse(row.plan_json, {}) } : null
}

export function updateSourceModpackInspectionPlanState(planToken = '', state = '', database = dbInstance) {
  run(database, `UPDATE source_modpack_instance_plans SET state = ? WHERE plan_token = ?`,
    [toText(state), toText(planToken)])
}

export function attachSourceModpackInstanceJob(data = {}, database = dbInstance) {
  const now = nowIso()
  run(database, `INSERT INTO source_modpack_instance_jobs
    (instance_id, plan_token, job_id, source_platform, state, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,
      result_json=excluded.result_json, updated_at=excluded.updated_at`, [
    toText(data.instanceId), toText(data.planToken), toText(data.jobId),
    toText(data.sourcePlatform), toText(data.state || 'queued'), stringify(data.result || {}), now, now
  ])
}

export function updateSourceModpackInstanceJob(jobId = '', state = '', result = {}, database = dbInstance) {
  run(database, `UPDATE source_modpack_instance_jobs SET state = ?, result_json = ?, updated_at = ?
    WHERE job_id = ?`, [toText(state), stringify(result), nowIso(), toText(jobId)])
  return get(database, `SELECT * FROM source_modpack_instance_jobs WHERE job_id = ? LIMIT 1`,
    [toText(jobId)])
}

export function listSourceModpackPlanJobs(planToken = '', database = dbInstance) {
  return all(database, `SELECT * FROM source_modpack_instance_jobs WHERE plan_token = ? ORDER BY id ASC`,
    [toText(planToken)]).map((row) => ({ ...row, result: parse(row.result_json, {}) }))
}

export function updateSourceModpackTargetProfileName(data = {}, database = dbInstance) {
  return run(database, `UPDATE source_modpack_instance_targets SET profile_name = ?, updated_at = ?
    WHERE source_platform = ? AND profile_name = ? AND instance_id IN (
      SELECT instance_id FROM source_modpack_instances
      WHERE local_game_installation_id = ? AND endpoint_type = ?)`, [
    toText(data.nextProfileName), nowIso(), toText(data.sourcePlatform).toLowerCase(),
    toText(data.profileName), toNumber(data.localGameInstallationId, 0),
    toNumber(data.endpointType, 0)
  ])
}

export function inspectSourceModpackActualItems(instanceId = '', database = dbInstance) {
  return all(database, `SELECT sii.*, m.id AS actual_mod_id, m.version AS actual_version,
      m.mod_version AS actual_mod_version, m.source_lock_state, m.is_active
    FROM source_modpack_instance_items sii LEFT JOIN mods m ON m.id = sii.local_mod_id
    WHERE sii.instance_id = ?`, [toText(instanceId)]).map((row) => ({
    itemKey: row.item_key, originItemKey: row.origin_item_key,
    dependencyRole: row.dependency_role, localModId: toNumber(row.local_mod_id, 0),
    version: toText(row.actual_version || row.actual_mod_version),
    canonicalItemHash: row.installed_item_hash, exists: toNumber(row.actual_mod_id, 0) > 0,
    sourceLockState: toText(row.source_lock_state),
    active: toNumber(row.is_active, 0) === 1,
    ...inspectManifestContent(toNumber(row.local_mod_id, 0), database)
  })).map((item) => ({
    ...item,
    contentIntact: item.contentIntact &&
      !['repair_required', 'lock_failed', 'unlock_failed'].includes(item.sourceLockState)
  }))
}

export function inspectSourceModpackActualItem(localModId = 0, database = dbInstance) {
  const safeLocalModId = toNumber(localModId, 0)
  const mod = safeLocalModId
    ? get(database, `SELECT id, version, mod_version, source_lock_state, is_active
      FROM mods WHERE id = ? LIMIT 1`, [safeLocalModId])
    : null
  const content = inspectManifestContent(safeLocalModId, database)
  return {
    localModId: safeLocalModId,
    version: toText(mod?.version || mod?.mod_version),
    exists: toNumber(mod?.id, 0) > 0,
    sourceLockState: toText(mod?.source_lock_state),
    active: toNumber(mod?.is_active, 0) === 1,
    ...content,
    contentIntact: content.contentIntact &&
      !['repair_required', 'lock_failed', 'unlock_failed'].includes(toText(mod?.source_lock_state))
  }
}

export function markSourceModpackInstanceItemsRemoved(
  instanceId = '',
  localModId = 0,
  database = dbInstance
) {
  return run(database, `UPDATE source_modpack_instance_items
    SET ownership_mode = 'detached', state = 'removed', updated_at = ?
    WHERE instance_id = ? AND local_mod_id = ? AND state NOT IN ('detached', 'removed')`,
  [nowIso(), toText(instanceId), toNumber(localModId, 0)])
}

export function getSourceModpackOwnershipReferences(instanceId = '', database = dbInstance) {
  const rows = all(database, `SELECT current.local_mod_id,
      sum(CASE WHEN other.instance_id <> current.instance_id
        AND other.state NOT IN ('detached', 'removed') THEN 1 ELSE 0 END) AS other_instance_count,
      max(CASE WHEN current.ownership_mode = 'referenced' THEN 1 ELSE 0 END) AS user_owned
    FROM source_modpack_instance_items current
    LEFT JOIN source_modpack_instance_items other ON other.local_mod_id = current.local_mod_id
    WHERE current.instance_id = ? AND current.local_mod_id IS NOT NULL
    GROUP BY current.local_mod_id`, [toText(instanceId)])
  return Object.fromEntries(rows.map((row) => [toNumber(row.local_mod_id, 0), {
    otherInstanceCount: toNumber(row.other_instance_count, 0),
    userOwned: toNumber(row.user_owned, 0) === 1
  }]))
}

export function reconcileSourceModpackOwnershipModes(localModIds = [], database = dbInstance) {
  const ids = [...new Set((Array.isArray(localModIds) ? localModIds : [])
    .map((id) => toNumber(id, 0)).filter((id) => id > 0))]
  for (const localModId of ids) {
    const row = get(database, `SELECT count(DISTINCT instance_id) AS total FROM source_modpack_instance_items
      WHERE local_mod_id = ? AND state NOT IN ('detached', 'removed')
        AND ownership_mode IN ('managed', 'shared')`, [localModId])
    const mode = toNumber(row?.total, 0) > 1 ? 'shared' : 'managed'
    run(database, `UPDATE source_modpack_instance_items SET ownership_mode = ?, updated_at = ?
      WHERE local_mod_id = ? AND state NOT IN ('detached', 'removed')
        AND ownership_mode IN ('managed', 'shared')`, [mode, nowIso(), localModId])
  }
}

export function reconcileAllSourceModpackOwnershipModes(database = dbInstance) {
  ensureSourceModpackInstanceTables(database)
  const localModIds = all(database, `SELECT DISTINCT local_mod_id
    FROM source_modpack_instance_items
    WHERE local_mod_id IS NOT NULL AND local_mod_id > 0
      AND state NOT IN ('detached', 'removed')
      AND ownership_mode IN ('managed', 'shared')`)
    .map((row) => toNumber(row.local_mod_id, 0))
  reconcileSourceModpackOwnershipModes(localModIds, database)
  return localModIds.length
}
