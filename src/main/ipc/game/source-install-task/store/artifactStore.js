import fs from 'fs'
import { buildUpdateSql, get, run } from './db.js'
import { ARTIFACT_STATE, nowIso, toSafeNumber, toSafeText } from '../contracts.js'

export function getArtifactByKey(artifactKey = '') {
  return get(`SELECT * FROM source_install_artifact WHERE artifact_key = ? LIMIT 1`, [
    toSafeText(artifactKey)
  ])
}

export function getArtifactByDownloadTaskId(downloadTaskId = '') {
  return get(`SELECT * FROM source_install_artifact WHERE download_task_id = ? LIMIT 1`, [
    toSafeText(downloadTaskId)
  ])
}

export function upsertArtifact(artifact = {}) {
  const now = nowIso()
  const source = toSafeText(artifact.source, 'nexus').toLowerCase()
  const persistedDownloadUrl =
    source === 'nexus' ? '' : toSafeText(artifact.download_url || artifact.downloadUrl)
  run(
    `
      INSERT INTO source_install_artifact
        (artifact_key, source, game_key, provider, provider_id, version, file_name, file_path,
         download_task_id, download_url, file_size, md5, sha256, state, error_message,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_key) DO UPDATE SET
        source = excluded.source,
        game_key = excluded.game_key,
        provider = excluded.provider,
        provider_id = excluded.provider_id,
        version = CASE
          WHEN trim(excluded.version) <> '' THEN excluded.version
          ELSE source_install_artifact.version
        END,
        file_name = CASE
          WHEN trim(excluded.file_name) <> '' THEN excluded.file_name
          ELSE source_install_artifact.file_name
        END,
        download_url = CASE
          WHEN trim(excluded.download_url) <> '' THEN excluded.download_url
          ELSE source_install_artifact.download_url
        END,
        file_size = CASE
          WHEN excluded.file_size > 0 THEN excluded.file_size
          ELSE source_install_artifact.file_size
        END,
        md5 = CASE
          WHEN trim(excluded.md5) <> '' THEN excluded.md5
          ELSE source_install_artifact.md5
        END,
        sha256 = CASE
          WHEN trim(excluded.sha256) <> '' THEN excluded.sha256
          ELSE source_install_artifact.sha256
        END,
        state = CASE
          WHEN source_install_artifact.state IN ('downloaded', 'downloading', 'queued') THEN source_install_artifact.state
          ELSE excluded.state
        END,
        updated_at = excluded.updated_at
    `,
    [
      toSafeText(artifact.artifact_key || artifact.artifactKey),
      source,
      toSafeText(artifact.game_key || artifact.gameKey),
      toSafeText(artifact.provider),
      toSafeText(artifact.provider_id || artifact.providerId),
      toSafeText(artifact.version),
      toSafeText(artifact.file_name || artifact.fileName),
      toSafeText(artifact.file_path || artifact.filePath),
      toSafeText(artifact.download_task_id || artifact.downloadTaskId),
      persistedDownloadUrl,
      toSafeNumber(artifact.file_size || artifact.fileSize, 0),
      toSafeText(artifact.md5),
      toSafeText(artifact.sha256),
      toSafeText(artifact.state, ARTIFACT_STATE.CREATED),
      toSafeText(artifact.error_message || artifact.errorMessage),
      toSafeText(artifact.created_at, now),
      toSafeText(artifact.updated_at, now)
    ]
  )
  return getArtifactByKey(artifact.artifact_key || artifact.artifactKey)
}

export function updateArtifact(artifactKey = '', patch = {}) {
  const safeArtifactKey = toSafeText(artifactKey)
  if (!safeArtifactKey) return
  const existing = getArtifactByKey(safeArtifactKey)
  const nextPatch = { ...patch }
  if (toSafeText(existing?.source).toLowerCase() === 'nexus' && 'download_url' in nextPatch) {
    nextPatch.download_url = ''
  }
  const { sql, params } = buildUpdateSql(
    'source_install_artifact',
    'artifact_key',
    safeArtifactKey,
    nextPatch
  )
  run(sql, params)
}

export function isArtifactFileAvailable(artifact = {}) {
  const filePath = toSafeText(artifact.file_path || artifact.filePath)
  return !!filePath && fs.existsSync(filePath)
}
