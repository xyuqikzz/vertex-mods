import { all, buildUpdateSql, run } from './db.js'
import {
  ITEM_STATE,
  nowIso,
  parseJsonObject,
  stringifyJson,
  toSafeNumber,
  toSafeText
} from '../contracts.js'
import { parseItemDependencyRefs, parseItemMetadata } from '../itemMetadata.js'
import { sanitizeSourceInstallTaskPayloadForPersistence } from '../taskSecurity.js'
import { inspectSourceModpackActualItem } from '../../../../db/mods/sourceModpackInstances.js'

// 纯元数据解析已下沉 itemMetadata.js（无 DB 依赖），此处再导出以保持 taskStore 公共 API 不变。
export { parseItemDependencyRefs, parseItemMetadata }

export function insertItem(item = {}) {
  const now = nowIso()
  run(
    `
      INSERT INTO source_install_job_item
        (job_id, item_id, item_type, source_mod_key, dependency_key, install_key, artifact_key,
         title, version, state, progress, error_message, failure_stage, failure_json,
         health_status, health_json, conflict_json, install_plan_json, transaction_id,
         transaction_status, rollback_status, rollback_error, change_set_json, metadata_json,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      toSafeText(item.job_id || item.jobId),
      toSafeText(item.item_id || item.itemId),
      toSafeText(item.item_type || item.itemType, 'main'),
      toSafeText(item.source_mod_key || item.sourceModKey),
      toSafeText(item.dependency_key || item.dependencyKey),
      toSafeText(item.install_key || item.installKey),
      toSafeText(item.artifact_key || item.artifactKey),
      toSafeText(item.title, '安装项'),
      toSafeText(item.version),
      toSafeText(item.state, ITEM_STATE.CREATED),
      toSafeNumber(item.progress, 0),
      toSafeText(item.error_message || item.errorMessage),
      toSafeText(item.failure_stage || item.failureStage),
      stringifyJson(item.failure_json ?? item.failure ?? {}, '{}'),
      toSafeText(item.health_status || item.healthStatus),
      stringifyJson(item.health_json ?? item.health ?? {}, '{}'),
      stringifyJson(item.conflict_json ?? item.conflict ?? {}, '{}'),
      stringifyJson(item.install_plan_json ?? item.installPlan ?? {}, '{}'),
      toSafeText(item.transaction_id || item.transactionId),
      toSafeText(item.transaction_status || item.transactionStatus || 'none'),
      toSafeText(item.rollback_status || item.rollbackStatus || 'none'),
      toSafeText(item.rollback_error || item.rollbackError),
      stringifyJson(item.change_set_json ?? item.changeSet ?? {}, '{}'),
      stringifyJson(
        sanitizeSourceInstallTaskPayloadForPersistence(item.metadata_json ?? item.metadata ?? {}),
        '{}'
      ),
      toSafeText(item.created_at, now),
      toSafeText(item.updated_at, now)
    ]
  )
}

export function updateItem(itemId = '', patch = {}) {
  const safeItemId = toSafeText(itemId)
  if (!safeItemId) return
  const { sql, params } = buildUpdateSql('source_install_job_item', 'item_id', safeItemId, patch)
  run(sql, params)
}

export function getJobItems(jobId = '') {
  return all(`SELECT * FROM source_install_job_item WHERE job_id = ? ORDER BY id ASC`, [
    toSafeText(jobId)
  ])
}

export function getItemsByArtifactKey(artifactKey = '') {
  return all(`SELECT * FROM source_install_job_item WHERE artifact_key = ? ORDER BY id ASC`, [
    toSafeText(artifactKey)
  ])
}

function normalizeVersionText(value = '') {
  return toSafeText(value).toLowerCase()
}

function buildSourceModKeyCandidates(source = '', sourceModKey = '', installPayload = {}) {
  const candidates = new Set()
  const safeKey = toSafeText(sourceModKey)
  if (safeKey) {
    candidates.add(safeKey)
  }

  const modId = toSafeText(installPayload.modId || installPayload.sourceModId)
  const fileId = toSafeText(installPayload.id || installPayload.fileId || installPayload.sourceFileId)
  if ((source === 'nexus' || source === 'modio') && modId && fileId) {
    candidates.add(`${source}:${modId}:${fileId}`)
    candidates.add(`${modId}:${fileId}`)
  }
  if (source === 'ficsit') {
    const modReference = toSafeText(
      installPayload.modReference || installPayload.sourceModKey || installPayload.source_mod_key
    )
    if (modReference) {
      candidates.add(`ficsit:${modReference}`)
      candidates.add(modReference)
    }
  }
  if (source === 'thunderstore') {
    const community = toSafeText(installPayload.community)
    const fullName = toSafeText(
      installPayload.packageFullName || installPayload.fullName || installPayload.sourceModId
    )
    const version = toSafeText(installPayload.version)
    if (community && fullName) {
      candidates.add(`thunderstore:${community}:${fullName}`)
      if (version) {
        candidates.add(`thunderstore:${community}:${fullName}:${version}`)
      }
    }
    if (fullName) {
      candidates.add(fullName)
    }
  }

  if (safeKey.startsWith('nexus:') || safeKey.startsWith('modio:')) {
    const keyParts = safeKey.split(':')
    if (keyParts.length >= 3) {
      candidates.add(`${keyParts[1]}:${keyParts[2]}`)
    }
  }
  if (safeKey.startsWith('ficsit:')) {
    candidates.add(safeKey.slice('ficsit:'.length))
  }
  if (safeKey.startsWith('thunderstore:')) {
    const keyParts = safeKey.split(':')
    if (keyParts.length >= 3) {
      candidates.add(keyParts[2])
      candidates.add(keyParts.slice(0, 3).join(':'))
      if (keyParts.length >= 4) {
        candidates.add(keyParts.slice(0, 4).join(':'))
      }
    }
  }

  return [...candidates].filter(Boolean)
}

export function findInstalledModByItem(item = {}) {
  const metadata = parseJsonObject(item.metadata_json, {})
  const installPayload = metadata.installPayload || {}
  if (installPayload.updateTargetModId) {
    const row = all('SELECT * FROM mods WHERE id = ?', [Number(installPayload.updateTargetModId)])[0]
    const profile = toSafeText(installPayload.profileName || installPayload.targetProfileName).toLowerCase()
    const source = toSafeText(installPayload.sourceType || metadata.source).toLowerCase()
    if (!row || !profile || toSafeText(row.profile_name || 'default').toLowerCase() !== profile ||
        toSafeText(row.source).toLowerCase() !== source || String(row.mod_id) !== String(installPayload.modId)) return null
    const version = normalizeVersionText(row.version || row.mod_version)
    // 更新前的记录不能被当成已安装；提交后重启/重试则可复用同一条记录，包括禁用模组。
    if (String(row.option_id) === String(installPayload.updateExpectedFileId) &&
        version === normalizeVersionText(installPayload.updateExpectedVersion)) return null
    return String(row.option_id) === String(installPayload.id) &&
      version === normalizeVersionText(installPayload.version || installPayload.modVersion) ? row : null
  }
  // 同版本也可能因规则变化需要替换；只允许已完成的替换任务查询其落盘记录。
  if (installPayload.sourceModpackInstanceId && installPayload.sourceModpackOperation === 'replace' &&
      ![ITEM_STATE.INSTALLED, ITEM_STATE.SKIPPED_INSTALLED].includes(item.state)) return null
  const source = toSafeText(metadata.source || installPayload.sourceType || 'nexus').toLowerCase()
  const sourceModKey = toSafeText(item.source_mod_key || installPayload.sourceModKey)
  const gameId = toSafeNumber(
    installPayload.localGameInstallationId || installPayload.gameId || metadata.gameId, 0
  )
  const version = normalizeVersionText(item.version || installPayload.version || installPayload.modVersion)
  const profileName = toSafeText(installPayload.profileName || installPayload.targetProfileName)
  const keyCandidates = buildSourceModKeyCandidates(source, sourceModKey, installPayload)
  if (!keyCandidates.length) {
    return null
  }

  const placeholders = keyCandidates.map(() => '?').join(', ')
  const profileClause = profileName ? ' AND lower(profile_name) = ?' : ''
  const rows = all(
    gameId > 0
      ? `
          SELECT *
          FROM mods
          WHERE game_id = ?
            AND lower(source) = ?
            AND source_mod_key IN (${placeholders})
            AND is_active = 1
            ${profileClause}
          ORDER BY datetime(updated_at) DESC, id DESC
        `
      : `
          SELECT *
          FROM mods
          WHERE lower(source) = ?
            AND source_mod_key IN (${placeholders})
            AND is_active = 1
            ${profileClause}
          ORDER BY datetime(updated_at) DESC, id DESC
        `,
    gameId > 0
      ? [gameId, source, ...keyCandidates, ...(profileName ? [profileName.toLowerCase()] : [])]
      : [source, ...keyCandidates, ...(profileName ? [profileName.toLowerCase()] : [])]
  )
  if (!rows.length) {
    return null
  }
  return rows.find((row) => {
    if (version && normalizeVersionText(row.version || row.mod_version) !== version) return false
    // 整合包修复不能因为数据库记录尚在而跳过缺失/被改动的实际文件。
    if (installPayload.sourceModpackInstanceId) {
      const actual = inspectSourceModpackActualItem(row.id)
      return actual.exists && !actual.contentMissing && actual.contentIntact
    }
    return true
  }) || null
}
