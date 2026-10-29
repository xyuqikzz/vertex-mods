import { nativeText } from '../../../services/uiLanguage.js'
import { dialog } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import { createOfflinePackWriter, listOfflinePackSourceFiles, openOfflinePackArchive } from './offlinePackStreaming.js'
import dbInstance from '../../../db/dbInstance.js'
import {
  getGameRowById,
  getLocalModLibraryItem,
  insertVxpackHistory,
  listLocalModLibrary
} from '../../../db/mods/localModLibrary.js'
import { reportMainProcessError } from '../../../statistics/statistics-error-reporter.js'
import {
  createSourceInstallTask,
  cancelSourceInstallTask
} from '../source-install-task/orchestrator.js'
import {
  OFFLINE_PACK_ERROR_CODE,
  OFFLINE_PACK_FORMAT,
  OFFLINE_PACK_CACHE_RETENTION_DAYS,
  OFFLINE_PACK_PACKAGE_TYPE,
  OFFLINE_PACK_SCHEMA_VERSION,
  createOfflinePackError,
  createUniqueOfflinePackProfileName,
  isOfflinePackFilePath,
  normalizeOfflinePackPath,
  isOfflinePackProfileOccupied,
  resolveOfflinePackSelectedGameCandidate,
  resolveOfflinePackGameKey,
  resolveOfflinePackReusableProfileName,
  sanitizeOfflinePackProfileName,
  validateOfflinePackPackageLimits
} from '../../../../shared/modpacks/offline-pack-contract.js'
import {
  cleanupOfflinePackCache as cleanupOfflinePackCacheEntries,
  getOfflinePackCacheRoot
} from './offlinePackCache.js'
import {
  addOfflinePackZipBuffer as addZipBuffer,
  addOfflinePackZipJson as addZipJson,
  buildOfflinePackZipLimitPayload as buildZipLimitPayload,
  inspectOfflinePackArchiveZip,
  parseOfflinePackJsonEntry as parseJsonEntry,
  readOfflinePackManifestFromZip as readManifest,
  toOfflinePackLimitError,
  writeOfflinePackChecksums
} from './offlinePackArchive.js'
import {
  buildOfflinePackInstallEntry,
  buildOfflinePackSourceTaskPayload
} from './offlinePackTaskPayload.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toPlainJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}


// 离线封面内嵌：保证「分享人看到的封面」在安装人离线时也能在导入预览中显示。
const OFFLINE_PACK_COVER_MAX_BYTES = 1.5 * 1024 * 1024
const OFFLINE_PACK_COVER_FETCH_TIMEOUT_MS = 6000
const OFFLINE_PACK_COVER_EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif'
}
const OFFLINE_PACK_COVER_CONTENT_TYPE_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif'
}

function resolveCoverExtensionFromUrl(url = '') {
  const match = String(url || '')
    .split('?')[0]
    .match(/\.([a-z0-9]{2,5})$/i)
  const ext = match ? match[1].toLowerCase() : ''
  return OFFLINE_PACK_COVER_EXT_MIME[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : ''
}

// 读取封面字节：本地文件直接读，远程封面限时 + 限大小抓取，任何失败都静默退回 URL。
// 安全加固（审计 🟢#28）：禁止 file:// 与本地路径（防止导出端 SSRF / 敏感文件读取）；
// 仅允许 http(s) 远程封面，且域名需在白名单内（Nexus / Modio / Ficsit / Thunderstore CDN）。
const OFFLINE_PACK_COVER_REMOTE_DOMAIN_ALLOWLIST = [
  'nexusmods.com',
  'mod.io',
  'ficsit.me',
  'ficsit.app',
  'thunderstore.io',
  'cdn.thunderstore.io',
  'githubusercontent.com',
  'github.com'
]

function isOfflinePackCoverRemoteAllowed(url = '') {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) return false
    const host = String(parsed.hostname || '').toLowerCase()
    if (!host) return false
    return OFFLINE_PACK_COVER_REMOTE_DOMAIN_ALLOWLIST.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

async function loadOfflinePackCoverBuffer(coverUrl = '') {
  const url = toSafeText(coverUrl)
  if (!url) return null
  // 显式拒绝 file:// 与本地路径：导出端不应读取本地敏感文件作为封面
  if (/^file:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url) || url.startsWith('/')) {
    return null
  }
  if (!/^https?:\/\//i.test(url)) {
    // 非 URL、非本地路径：可能是 mod 自身嵌入的相对路径，由调用方处理；此处返回 null
    return null
  }
  if (!isOfflinePackCoverRemoteAllowed(url)) {
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OFFLINE_PACK_COVER_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const contentType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > OFFLINE_PACK_COVER_MAX_BYTES) { controller.abort(); return null }
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)
    if (!buffer.length || buffer.length > OFFLINE_PACK_COVER_MAX_BYTES) return null
    const ext =
      OFFLINE_PACK_COVER_CONTENT_TYPE_EXT[contentType] || resolveCoverExtensionFromUrl(url) || 'png'
    return { buffer, ext }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function embedOfflinePackCover(zip, checksums, itemId, coverUrl) {
  const loaded = await loadOfflinePackCoverBuffer(coverUrl)
  if (!loaded) return ''
  const coverPath = `covers/${itemId}.${loaded.ext}`
  addZipBuffer(zip, checksums, coverPath, loaded.buffer)
  return coverPath
}


function createId(prefix = 'item') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  }
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function sanitizeFileName(value = '', fallback = 'vertex-offline-pack') {
  return (
    toSafeText(value, fallback)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 90) || fallback
  )
}

function sanitizeZipSegment(value = '', fallback = 'item') {
  const text = toSafeText(value, fallback)
    .replace(/[\\/:*?"<>|#\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  return text || fallback
}

function normalizeSource(value = '') {
  return toSafeText(value).toLowerCase()
}

export async function pickOfflinePackImportFile() {
  try {
    const result = await dialog.showOpenDialog({
      title: nativeText('importOffline'),
      filters: [
        { name: nativeText('offlinePackage'), extensions: ['vxpack'] },
        { name: nativeText('allFiles'), extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths?.length) {
      return { success: false, canceled: true }
    }

    const filePath = result.filePaths[0]
    if (isOfflinePackFilePath(filePath)) {
      return {
        success: true,
        kind: 'offline-pack',
        filePath,
        packagePath: filePath
      }
    }

    return {
      success: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: '不支持的导入文件类型'
    }
  } catch (error) {
    return {
      success: false,
      code: OFFLINE_PACK_ERROR_CODE.INVALID,
      message: String(error?.message || '导入文件读取失败')
    }
  }
}

function normalizeOfflinePackFailure(result = {}, fallbackMessage = '离线安装包导入失败') {
  const details = toSafeObject(result.details)
  const blockers = Array.isArray(details.blockers) ? details.blockers : []
  const code = toSafeText(
    result.code ||
      result.errorCode ||
      details.code ||
      blockers[0]?.code ||
      OFFLINE_PACK_ERROR_CODE.INVALID
  )
  return {
    code,
    message: toSafeText(result.message || details.message, fallbackMessage),
    blockerCodes: blockers.map((item) => toSafeText(item?.code)).filter(Boolean)
  }
}

function recordOfflinePackImportFailure(result = {}, context = {}) {
  const failure = normalizeOfflinePackFailure(result)
  try {
    insertVxpackHistory({
      gameId: context.gameId,
      operationType: 'offline_import',
      packagePath: context.packagePath,
      manifestVersion: context.manifestVersion || OFFLINE_PACK_SCHEMA_VERSION,
      modCount: context.modCount,
      profileCount: context.profileCount || 1,
      sizeBytes: context.sizeBytes,
      state: 'failed'
    })
  } catch (error) {
    console.warn('[offline-pack] 记录导入失败历史失败', error)
    // 上报到错误统计，避免静默丢失（审计 🟢#30）
    reportMainProcessError(error, {
      errorType: 'offline_pack_history_record_failed',
      properties: {
        stage: context.stage || 'submit',
        operationType: 'offline_import',
        gameKey: context.gameKey || ''
      }
    })
  }

  reportMainProcessError(new Error(failure.message), {
    errorType: 'offline_pack_import_failed',
    properties: {
      code: failure.code,
      blockerCodes: failure.blockerCodes,
      stage: context.stage || 'submit',
      packageType: context.packageType || OFFLINE_PACK_PACKAGE_TYPE,
      manifestVersion: context.manifestVersion || OFFLINE_PACK_SCHEMA_VERSION,
      itemCount: context.modCount || 0,
      gameKey: context.gameKey || ''
    }
  })
}

function failOfflinePackSubmit(result = {}, context = {}) {
  recordOfflinePackImportFailure(result, context)
  return result
}

// 可观测性（审计 🟢#30）：离线包导入关键阶段耗时与计数
const offlinePackStageCounters = {
  inspect: { count: 0, failureCount: 0, totalMs: 0 },
  extract: { count: 0, failureCount: 0, totalMs: 0 },
  task_create: { count: 0, failureCount: 0, totalMs: 0 },
  profile_register: { count: 0, failureCount: 0, totalMs: 0 }
}

export function getOfflinePackStageMetrics() {
  return JSON.parse(JSON.stringify(offlinePackStageCounters))
}

function recordOfflinePackStage(stage = '', durationMs = 0, success = true) {
  const key = String(stage || '').trim()
  if (!offlinePackStageCounters[key]) return
  offlinePackStageCounters[key].count += 1
  if (!success) offlinePackStageCounters[key].failureCount += 1
  offlinePackStageCounters[key].totalMs += Math.max(0, Number(durationMs) || 0)
}

async function createDirectoryArchive(sourcePath, outputPath) {
  const { files } = await listOfflinePackSourceFiles(sourcePath)
  const zip = await createOfflinePackWriter(outputPath)
  try {
    for (const file of files) await zip.addPath(file.name, file.path)
    await zip.finish()
  } finally { await zip.abort() }
  return outputPath
}

async function inspectSourcePath(sourcePath = '') {
  if (!sourcePath || !(await fs.pathExists(sourcePath))) {
    return { exists: false, isFile: false, isDirectory: false, sizeBytes: 0 }
  }
  const stat = await fs.lstat(sourcePath)
  if (stat.isSymbolicLink()) throw new Error('离线导出源不能是符号链接或目录联接')
  if (stat.isFile()) {
    return { exists: true, isFile: true, isDirectory: false, sizeBytes: stat.size }
  }
  if (!stat.isDirectory()) {
    return { exists: false, isFile: false, isDirectory: false, sizeBytes: 0 }
  }
  const { sizeBytes } = await listOfflinePackSourceFiles(sourcePath)
  return { exists: true, isFile: false, isDirectory: true, sizeBytes }
}

function resolveExportSourcePath(item = {}) {
  const metadata = toSafeObject(item.metadata)
  const installRulePlan = toSafeObject(metadata.installRulePlan)
  return (
    toSafeText(item.archivePath ?? item.archive_path) ||
    toSafeText(metadata.archivePath ?? metadata.archive_path) ||
    toSafeText(item.archivedSourcePath ?? item.archived_source_path) ||
    toSafeText(metadata.archivedSourcePath ?? metadata.archived_source_path) ||
    toSafeText(item.stagingPath ?? item.staging_path) ||
    toSafeText(metadata.stagingPath ?? metadata.staging_path) ||
    toSafeText(installRulePlan.sourceRoot ?? installRulePlan.source_root) ||
    toSafeText(installRulePlan.lifecycleStagingRoot ?? installRulePlan.lifecycle_staging_root) ||
    toSafeText(item.sourcePath ?? item.source_path) ||
    toSafeText(metadata.sourcePath ?? metadata.source_path) ||
    toSafeText(metadata.sourceRoot ?? metadata.source_root) ||
    toSafeText(item.filePath ?? item.file_path) ||
    toSafeText(metadata.filePath ?? metadata.file_path) ||
    toSafeText(item.localPath ?? item.local_path) ||
    toSafeText(metadata.localPath ?? metadata.local_path) ||
    toSafeText(item.library_root_path ? path.join(item.library_root_path, 'source') : '')
  )
}

function hasArchivePathAvailable(item = {}) {
  const metadata = toSafeObject(item.metadata)
  return Boolean(
    toSafeText(item.archivePath ?? item.archive_path) ||
      toSafeText(metadata.archivePath ?? metadata.archive_path) ||
      toSafeText(item.archivedSourcePath ?? item.archived_source_path) ||
      toSafeText(metadata.archivedSourcePath ?? metadata.archived_source_path)
  )
}

function normalizePayloadExportItem(item = {}, index = 0) {
  const metadata = toSafeObject(item.metadata)
  const sourcePath = resolveExportSourcePath(item)
  const sourcePlatform = normalizeSource(item.sourcePlatform ?? item.source_platform ?? 'local')
  const exportId = sanitizeZipSegment(
    item.exportId ??
      item.export_id ??
      item.sourceModKey ??
      item.source_mod_key ??
      item.id ??
      item.displayName ??
      item.display_name,
    `item-${index + 1}`
  )
  return {
    ...item,
    id: toSafeNumber(item.id ?? item.libraryItemId, 0),
    exportId,
    displayName: toSafeText(item.displayName ?? item.display_name ?? item.name, `Mod ${index + 1}`),
    fileName: toSafeText(item.fileName ?? item.file_name),
    version: toSafeText(item.version),
    author: toSafeText(item.author),
    cover: toSafeText(item.cover ?? metadata.cover),
    summary: toSafeText(
      item.summary ?? item.description ?? metadata.summary ?? metadata.description
    ),
    isDefaultDependency:
      item.isDefaultDependency === true ||
      toSafeText(item.role ?? metadata.role) === 'default_dependency' ||
      toSafeText(item.sourceModKey ?? item.source_mod_key ?? metadata.sourceModKey).startsWith(
        'dependency:'
      ),
    dependentCount: toSafeNumber(item.dependentCount ?? item.dependent_count, 0),
    dependencies: Array.isArray(item.dependencies)
      ? item.dependencies
      : Array.isArray(item.dependencies_json)
        ? item.dependencies_json
        : [],
    sourcePlatform,
    sourceModKey: toSafeText(item.sourceModKey ?? item.source_mod_key ?? metadata.sourceModKey),
    sourceFileId: toSafeText(item.sourceFileId ?? item.source_file_id ?? metadata.sourceFileId),
    sourceModId: toSafeText(item.sourceModId ?? item.source_mod_id ?? metadata.sourceModId),
    sourceGameId: toSafeText(item.sourceGameId ?? item.source_game_id ?? metadata.sourceGameId),
    sourceGameSlug: toSafeText(
      item.sourceGameSlug ?? item.source_game_slug ?? metadata.sourceGameSlug
    ),
    role: toSafeText(item.role ?? metadata.role, 'mod'),
    fingerprint: toSafeText(item.fingerprint ?? metadata.fingerprint),
    modType: toSafeText(item.modType ?? item.mod_type),
    sourcePath,
    installRule: toSafeObject(
      item.installRule || metadata.installRule || metadata.sourceInstallRule
    ),
    installPayload: toSafeObject(item.installPayload || metadata.installPayload),
    metadata: {
      ...metadata,
      sourcePath,
      sourceModKey: toSafeText(item.sourceModKey ?? item.source_mod_key ?? metadata.sourceModKey),
      exportSource: toSafeText(item.exportSource, 'offline_pack')
    }
  }
}

function normalizeLibraryExportItem(item = {}, index = 0) {
  const metadata = toSafeObject(item.metadata)
  return normalizePayloadExportItem(
    {
      ...item,
      exportId: item.id ? `library-${item.id}` : `library-${index + 1}`,
      displayName: item.display_name,
      fileName: item.file_name,
      sourcePlatform: item.source_platform,
      modType: item.mod_type,
      sourcePath: resolveExportSourcePath(item),
      metadata: {
        ...metadata,
        sourceRoot: resolveExportSourcePath(item)
      },
      exportSource: 'local_library'
    },
    index
  )
}

function resolveExportItems(payload = {}) {
  const payloadItems = Array.isArray(payload.exportItems ?? payload.export_items)
    ? (payload.exportItems ?? payload.export_items)
    : Array.isArray(payload.items)
      ? payload.items
      : []

  if (payloadItems.length) {
    return payloadItems.map((item, index) => normalizePayloadExportItem(item, index))
  }

  const ids = Array.isArray(payload.libraryItemIds)
    ? payload.libraryItemIds.map((item) => toSafeNumber(item, 0)).filter(Boolean)
    : []
  if (ids.length) {
    return ids
      .map((id) => getLocalModLibraryItem(id))
      .filter(Boolean)
      .map((item, index) => normalizeLibraryExportItem(item, index))
  }

  return listLocalModLibrary({
    gameId: payload.gameId ?? payload.game_id,
    state: 'active'
  }).map((item, index) => normalizeLibraryExportItem(item, index))
}

function resolveGameContext(payload = {}, exportItems = []) {
  const gameId = toSafeNumber(payload.gameId ?? payload.game_id ?? exportItems[0]?.game_id, 0)
  const game = getGameRowById(gameId) || {}
  const sourcePlatform = normalizeSource(
    payload.sourcePlatform ||
      payload.sourceType ||
      payload.sourceMeta?.source ||
      exportItems[0]?.sourcePlatform ||
      game.source
  )
  const sourceGameId = toSafeText(
    payload.sourceGameId ||
      payload.sourceMeta?.sourceId ||
      payload.sourceId ||
      exportItems[0]?.sourceGameId ||
      game.source_id ||
      game.app_id
  )
  const sourceGameSlug = toSafeText(
    payload.sourceGameSlug ||
      payload.sourceMeta?.sourceSlug ||
      payload.sourceSlug ||
      exportItems[0]?.sourceGameSlug ||
      game.source_slug
  )
  const displayName =
    toSafeText(payload.gameName ?? payload.game_name) ||
    toSafeText(game.name || game.english_name) ||
    'Vertex'
  const gameKey =
    toSafeText(payload.gameKey ?? payload.game_key) ||
    (sourcePlatform && (sourceGameId || sourceGameSlug)
      ? `${sourcePlatform}:${sourceGameId || sourceGameSlug}`
      : '')

  return {
    gameId,
    gameKey,
    sourceType: sourcePlatform,
    sourceGameId,
    sourceGameSlug,
    displayName
  }
}

function buildFallbackProfilePayload(payload = {}, game = {}, items = []) {
  const profileName = toSafeText(payload.profileName ?? payload.profile_name, 'default')
  const distinctSources = new Set(
    items.map((item) => toSafeText(item.sourcePlatform).toLowerCase()).filter(Boolean)
  )
  const isCrossSource = distinctSources.size > 1
  const warnings = []
  if (isCrossSource) {
    warnings.push({
      code: 'fallback_profile_cross_source',
      message: `回退配置方案包含跨源条目（${Array.from(distinctSources).join('、')}），format 标记为 cross-source`
    })
  }
  // format 与 primaryGame 对齐：跨源时 primaryGame.sourceType 取导出 game 的主导来源，
  // 与 manifest.game / primaryGame 字段语义一致
  return {
    schemaVersion: 2,
    kind: 'vertex.install-profile',
    format: isCrossSource ? 'cross-source' : 'single-source',
    id: createId('profile'),
    name: `${game.displayName}-${profileName}`,
    createdAt: new Date().toISOString(),
    profile: {
      name: profileName,
      sourcePlatform: game.sourceType,
      exportedAt: new Date().toISOString()
    },
    game: {
      gameKey: game.gameKey,
      sourceGameId: game.sourceGameId,
      sourceGameSlug: game.sourceGameSlug,
      displayName: game.displayName
    },
    primaryGame: {
      gameKey: game.gameKey,
      sourceType: game.sourceType,
      sourceGameId: game.sourceGameId,
      sourceGameSlug: game.sourceGameSlug,
      sourceGameName: game.displayName
    },
    items: items.map((item, index) => ({
      sortIndex: index,
      sourcePlatform: item.sourcePlatform,
      sourceGameId: item.sourceGameId || game.sourceGameId,
      sourceGameSlug: item.sourceGameSlug || game.sourceGameSlug,
      sourceModId: item.sourceModId,
      sourceFileId: item.sourceFileId,
      sourceModKey: item.sourceModKey,
      name: item.displayName,
      version: item.version,
      downloadUrl: '',
      role: item.role || 'mod',
      enabled: true,
      metadata: item.metadata || {},
      installRule: item.installRule || null
    })),
    manualItems: [],
    warnings,
    checksum: null
  }
}

function resolveInstallRuleSnapshot(item = {}) {
  const metadata = toSafeObject(item.metadata)
  const direct = toSafeObject(
    item.installRule ||
      item.sourceInstallRule ||
      metadata.installRule ||
      metadata.sourceInstallRule ||
      metadata.nexusInstallRule ||
      metadata.modioInstallRule ||
      metadata.ficsitInstallRule
  )
  if (Object.keys(direct).length) return direct

  const installPayload = toSafeObject(item.installPayload || metadata.installPayload)
  const payloadRule = toSafeObject(
    installPayload.installRule ||
      installPayload.sourceInstallRule ||
      installPayload.nexusInstallRule ||
      installPayload.modioInstallRule ||
      installPayload.ficsitInstallRule
  )
  if (Object.keys(payloadRule).length) return payloadRule

  const lastInstallResult = toSafeObject(metadata.lastInstallResult)
  const installPlan = toSafeObject(lastInstallResult.previewResult?.installPlan)
  if (Object.keys(installPlan).length) {
    return {
      generatedFrom: 'lastInstallResult.previewResult.installPlan',
      installPlan
    }
  }
  return null
}

function buildTaskEntry(item = {}, manifestItem = {}, artifactPath = '') {
  const installRule = resolveInstallRuleSnapshot(item) || {}
  const artifactSize = toSafeNumber(manifestItem.sizeBytes, item.sizeBytes || 0)
  const installPayload = {
    ...toSafeObject(item.installPayload),
    ...toSafeObject(item.metadata?.installPayload),
    sourceType: item.sourcePlatform,
    sourcePlatform: item.sourcePlatform,
    sourceModKey: item.sourceModKey,
    sourceModId: item.sourceModId,
    sourceFileId: item.sourceFileId,
    sourceGameId: item.sourceGameId,
    sourceGameSlug: item.sourceGameSlug,
    name: item.fileName || item.displayName,
    modName: item.displayName,
    version: item.version,
    cover: toSafeText(item.cover ?? item.metadata?.cover),
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
    typeId: item.isDefaultDependency === true ? 1 : 0,
    downloadUrl: '',
    fileSize: artifactSize,
    installRule,
    sourceInstallRule: installRule,
    metadata: {
      ...toSafeObject(item.metadata),
      cover: toSafeText(item.cover ?? item.metadata?.cover),
      offlineArtifactPath: artifactPath
    }
  }

  return {
    item: {
      task_name: `离线安装:${item.displayName}`,
      name: item.fileName || item.displayName,
      fileName: item.fileName || item.displayName,
      download_url: '',
      file_size: artifactSize,
      sourcePlatform: item.sourcePlatform,
      sourceType: item.sourcePlatform,
      sourceModKey: item.sourceModKey,
      sourceModId: item.sourceModId,
      sourceFileId: item.sourceFileId,
      version: item.version,
      sha256: manifestItem.sha256 || '',
      artifactKey: manifestItem.artifactKey || manifestItem.artifactId
    },
    meta: {
      sortIndex: toSafeNumber(item.sortIndex, 0),
      sourceType: item.sourcePlatform,
      sourcePlatform: item.sourcePlatform,
      displayName: item.displayName,
      fileName: item.fileName || item.displayName,
      version: item.version,
      offlinePackItemId: manifestItem.itemId,
      offlinePackArtifactId: manifestItem.artifactId,
      installPayload
    }
  }
}

function listGameCandidatesForCriterion(criterion = {}) {
  const source = normalizeSource(criterion.source)
  const value = toSafeText(criterion.value)
  if (!source || !value) return []
  if (criterion.field === 'source_id') {
    return (
      dbInstance.all(
        `SELECT * FROM games WHERE lower(COALESCE(source, '')) = ? AND COALESCE(source_id, '') = ?`,
        [source, value]
      ) || []
    )
  }
  if (criterion.field === 'source_slug') {
    return (
      dbInstance.all(
        `SELECT * FROM games WHERE lower(COALESCE(source, '')) = ? AND COALESCE(source_slug, '') = ?`,
        [source, value]
      ) || []
    )
  }
  if (criterion.field === 'app_id') {
    return (
      dbInstance.all(
        `SELECT * FROM games WHERE lower(COALESCE(source, '')) = ? AND COALESCE(app_id, '') = ?`,
        [source, value]
      ) || []
    )
  }
  return []
}

function formatGameCandidate(row = {}) {
  return {
    id: row.id,
    name: row.name || row.english_name || '',
    source: row.source || '',
    sourceId: row.source_id || '',
    sourceSlug: row.source_slug || '',
    appId: row.app_id || '',
    clientRootPath: row.client_root_path || ''
  }
}

function isExistingDirectoryPath(value = '') {
  const rootPath = toSafeText(value)
  if (!rootPath) return false
  try {
    return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory()
  } catch {
    return false
  }
}

function buildMatchedGameResult(row = {}, reason = 'selected') {
  const rootPath = toSafeText(row.client_root_path)
  return {
    status: isExistingDirectoryPath(rootPath) ? 'matched' : 'root_missing',
    reason,
    candidates: [row],
    selectedGameId: row.id,
    gameId: row.id,
    gameRoot: rootPath,
    game: row
  }
}

function resolveSelectedGameCandidate(candidates = [], selectedGameId = 0) {
  return resolveOfflinePackSelectedGameCandidate(candidates, selectedGameId)
}

function resolveGameMatch(manifest = {}, payload = {}) {
  const game = toSafeObject(manifest.game)
  const gameKey = resolveOfflinePackGameKey(game)
  const [keySource, keyValue] = gameKey.includes(':') ? gameKey.split(/:(.*)/s).filter(Boolean) : []
  const source = normalizeSource(
    game.sourceType || game.sourcePlatform || keySource || manifest.profile?.sourcePlatform
  )
  const selectedGameId = toSafeNumber(payload.selectedGameId || payload.selected_game_id, 0)
  const criteria = [
    { field: 'source_id', source: keySource || source, value: keyValue, reason: 'gameKey' },
    {
      field: 'source_id',
      source,
      value: game.sourceGameId || game.source_game_id,
      reason: 'sourceGameId'
    },
    {
      field: 'source_slug',
      source,
      value: game.sourceGameSlug || game.source_game_slug || game.sourceSlug,
      reason: 'sourceGameSlug'
    },
    { field: 'app_id', source, value: game.appId || game.steamAppId, reason: 'appId' }
  ]

  for (const criterion of criteria) {
    const rows = listGameCandidatesForCriterion(criterion)
    const selectedRow = resolveSelectedGameCandidate(rows, selectedGameId)
    if (selectedRow) {
      return buildMatchedGameResult(selectedRow, `selected:${criterion.reason}`)
    }
    if (rows.length === 1) {
      return buildMatchedGameResult(rows[0], criterion.reason)
    }
    if (rows.length > 1) {
      return {
        status: 'ambiguous',
        reason: criterion.reason,
        candidates: rows,
        selectedGameId,
        gameId: 0,
        gameRoot: '',
        game: null
      }
    }
  }

  return {
    status: 'not_registered',
    reason: '',
    candidates: [],
    gameId: 0,
    gameRoot: '',
    game: null
  }
}

function createProfileNameSuggestion(manifest = {}) {
  const base = sanitizeOfflinePackProfileName(
    `${manifest.name || manifest.game?.displayName || nativeText('offlinePackage')}-导入-${
      String(manifest.id || '')
        .replace(/^pack_/i, '')
        .slice(0, 4) || Date.now().toString(36).slice(-4)
    }`,
    '离线安装包导入'
  )
  return base
}

function listOfflinePackProfileStats(gameId = 0, sources = []) {
  const safeGameId = toSafeNumber(gameId, 0)
  if (!safeGameId) return []
  const sourceList = [
    ...new Set((Array.isArray(sources) ? sources : []).map(normalizeSource).filter(Boolean))
  ]
  const sourceClause = sourceList.length
    ? ` AND lower(COALESCE(source, '')) IN (${sourceList.map(() => '?').join(',')})`
    : ''
  const rows =
    dbInstance.all(
      `SELECT lower(COALESCE(source, '')) as source,
              COALESCE(NULLIF(profile_name, ''), 'default') as profile_name,
              COUNT(*) as count,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
       FROM mods
       WHERE game_id = ?
         AND endpoint_type = 0
         ${sourceClause}
       GROUP BY lower(COALESCE(source, '')), COALESCE(NULLIF(profile_name, ''), 'default')
       ORDER BY profile_name ASC`,
      [safeGameId, ...sourceList]
    ) || []
  return rows.map((row) => ({
    source: row.source || '',
    profileName: row.profile_name || 'default',
    totalCount: Number(row.count || 0),
    activeCount: Number(row.active_count || 0)
  }))
}

function resolveOfflineImportProfilePlan(
  manifest = {},
  gameMatch = {},
  requestedName = '',
  options = {}
) {
  const itemSources = (Array.isArray(manifest.items) ? manifest.items : [])
    .map((item) => item?.sourcePlatform || item?.source_platform)
    .filter(Boolean)
  const profileStats = listOfflinePackProfileStats(gameMatch.gameId, itemSources)
  const reusableProfileName = resolveOfflinePackReusableProfileName(
    {
      ...manifest,
      profile: {
        ...(manifest.profile || {}),
        name: options.reuseProfileName || manifest.profile?.name
      }
    },
    'default'
  )
  // 按 (source, profileName) 维度判定占用，避免跨源误判（与 listOfflinePackProfileStats 分组一致）
  const itemSourcesForReuse = (Array.isArray(manifest.items) ? manifest.items : [])
    .map((item) => item?.sourcePlatform || item?.source_platform)
    .filter(Boolean)
  const reuseSource = itemSourcesForReuse.length === 1 ? itemSourcesForReuse[0] : ''
  const reusableProfileOccupied = isOfflinePackProfileOccupied(profileStats, reusableProfileName, {
    source: reuseSource
  })
  const canReuseProfile = !!reusableProfileName && !reusableProfileOccupied
  const requestedMode = toSafeText(options.profileMode || options.targetProfileMode)
  if (requestedMode === 'reuse-empty' && canReuseProfile) {
    return {
      requestedProfileName: reusableProfileName,
      targetProfileName: reusableProfileName,
      isolated: false,
      reuseExistingEmptyProfile: true,
      adjusted: false,
      existingProfiles: profileStats,
      reusableProfile: {
        profileName: reusableProfileName,
        canReuse: true,
        occupied: false
      }
    }
  }
  const requestedProfileName = sanitizeOfflinePackProfileName(
    requestedName || createProfileNameSuggestion(manifest)
  )
  const targetProfileName = createUniqueOfflinePackProfileName(requestedProfileName, profileStats)
  return {
    requestedProfileName,
    targetProfileName,
    isolated: true,
    reuseExistingEmptyProfile: false,
    adjusted: requestedProfileName.toLowerCase() !== targetProfileName.toLowerCase(),
    existingProfiles: profileStats,
    reusableProfile: {
      profileName: reusableProfileName,
      canReuse: canReuseProfile,
      occupied: reusableProfileOccupied
    }
  }
}

export async function createOfflinePack(payload = {}) {
  const exportItems = resolveExportItems(payload)
  if (!exportItems.length) {
    return { success: false, message: '没有可导出的 Mod 文件' }
  }
  const includeDependencies =
    payload.includeDependencies !== false && payload.include_dependencies !== false

  const exportableItems = []
  const skippedItems = []
  const sourceWarnings = []
  for (const item of exportItems) {
    const sourcePath = resolveExportSourcePath(item)
    const sourceStat = await inspectSourcePath(sourcePath)
    const installRule = resolveInstallRuleSnapshot(item)
    if (!sourceStat.exists) {
      skippedItems.push({ item, reason: 'missing_source_file' })
      continue
    }
    if (!installRule) {
      skippedItems.push({ item, reason: 'missing_install_rule' })
      continue
    }
    // 区分 archive 可用 / 仅 staging 回退；仅 staging 时接收方 install rule 匹配可能异常
    const archiveAvailable = hasArchivePathAvailable(item)
    const usingStagingFallback = !archiveAvailable
    if (usingStagingFallback) {
      sourceWarnings.push({
        itemId: item.itemId || item.sourceModKey || '',
        message: `条目「${item.displayName || item.name || item.sourceModKey || ''}」缺少原始下载压缩包，已使用 staging 目录回退打包，接收方安装规则匹配可能异常`
      })
    }
    exportableItems.push({
      ...item,
      sourcePath,
      sizeBytes: sourceStat.sizeBytes,
      sourceIsDirectory: sourceStat.isDirectory,
      archiveAvailable,
      usingStagingFallback,
      installRule
    })
  }

  if (!exportableItems.length) {
    return { success: false, message: '没有可直接离线安装的条目' }
  }

  const exportLimitValidation = validateOfflinePackPackageLimits({
    packageBytes: exportableItems.reduce(
      (total, item) => total + toSafeNumber(item.sizeBytes, 0),
      0
    ),
    entryCount: exportableItems.length * 3 + 4,
    entrySizes: exportableItems.map((item) => ({
      path: item.sourcePath,
      sizeBytes: item.sizeBytes
    }))
  })
  if (!exportLimitValidation.valid) {
    return toOfflinePackLimitError(exportLimitValidation)
  }

  const game = resolveGameContext(payload, exportableItems)
  const profilePayload = toSafeObject(payload.profilePayload || payload.profile_payload).kind
    ? toPlainJson(payload.profilePayload || payload.profile_payload, {})
    : buildFallbackProfilePayload(payload, game, exportableItems)

  const defaultName = `${sanitizeFileName(profilePayload.name || game.displayName)}-${new Date()
    .toISOString()
    .slice(0, 10)}.vxpack`
  let outputPath = toSafeText(payload.outputPath ?? payload.output_path)
  if (!outputPath) {
    const result = await dialog.showSaveDialog({
      title: nativeText('exportOffline'),
      defaultPath: defaultName,
      filters: [
        { name: nativeText('vertexOfflinePackage'), extensions: ['vxpack'] },
        { name: nativeText('allFiles'), extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true, message: '已取消导出' }
    }
    outputPath = result.filePath
  }
  if (path.extname(outputPath).toLowerCase() !== '.vxpack') {
    outputPath = `${outputPath}.vxpack`
  }

  const checksums = {}
  for (const item of exportableItems) {
    const relative = path.relative(path.resolve(item.sourcePath), path.resolve(outputPath))
    if (!relative || (item.sourceIsDirectory && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      return createOfflinePackError(OFFLINE_PACK_ERROR_CODE.INVALID, '导出文件不能覆盖源文件或放在待打包的源目录内')
    }
  }
  await fs.ensureDir(path.dirname(outputPath))
  const workDir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.vxpack-export-'))
  let zip
  try {
  zip = await createOfflinePackWriter(outputPath)
  const packId = createId('pack')
  const manifestItems = []
  const taskEntries = []

  for (const [index, item] of exportableItems.entries()) {
    const itemId = createId('item')
    const artifactId = createId('artifact')
    const sourceStat = await inspectSourcePath(item.sourcePath)
    const artifactFileName = sourceStat.isDirectory
      ? 'package.zip'
      : sanitizeFileName(path.basename(item.sourcePath), `package-${index + 1}.zip`)
    const artifactPath = `artifacts/${artifactId}/${artifactFileName}`
    const artifactSource = sourceStat.isDirectory
      ? await createDirectoryArchive(item.sourcePath, path.join(workDir, `${artifactId}.zip`))
      : item.sourcePath
    const { hash: artifactHash, sizeBytes: artifactSize } = await zip.addPath(artifactPath, artifactSource)
    checksums[artifactPath] = artifactHash
    const rulePath = `rules/${itemId}.install-rule.json`
    const artifactJsonPath = `artifacts/${artifactId}/artifact.json`
    const embeddedCoverPath = await embedOfflinePackCover(zip, checksums, itemId, item.cover)
    const manifestItem = {
      itemId,
      artifactId,
      artifactKey: `offline:${packId}:${artifactId}`,
      sourcePlatform: item.sourcePlatform,
      sourceModKey: item.sourceModKey,
      sourceModId: item.sourceModId,
      sourceFileId: item.sourceFileId,
      sourceGameId: item.sourceGameId || game.sourceGameId,
      sourceGameSlug: item.sourceGameSlug || game.sourceGameSlug,
      version: item.version,
      name: item.displayName,
      role: item.role || 'mod',
      cover: toSafeText(item.cover),
      coverPath: embeddedCoverPath,
      summary: toSafeText(item.summary),
      author: toSafeText(item.author),
      isDefaultDependency:
        item.isDefaultDependency === true || (item.role || 'mod') === 'default_dependency',
      dependentCount: toSafeNumber(item.dependentCount, 0),
      dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
      installRulePath: rulePath,
      artifactPath,
      sha256: artifactHash,
      sizeBytes: artifactSize,
      repackedFromDirectory: sourceStat.isDirectory === true
    }
    manifestItems.push(manifestItem)
    addZipJson(zip, checksums, artifactJsonPath, {
      artifactId,
      itemId,
      fileName: artifactFileName,
      sizeBytes: artifactSize,
      sha256: artifactHash,
      sourcePlatform: item.sourcePlatform,
      sourceModKey: item.sourceModKey,
      exportSourcePath: item.sourcePath,
      repackedFromDirectory: sourceStat.isDirectory === true
    })
    addZipJson(zip, checksums, rulePath, item.installRule)
    taskEntries.push(buildTaskEntry(item, manifestItem, artifactPath))
  }

  const manifest = {
    schemaVersion: OFFLINE_PACK_SCHEMA_VERSION,
    packageType: OFFLINE_PACK_PACKAGE_TYPE,
    format: OFFLINE_PACK_FORMAT,
    id: packId,
    name: profilePayload.name || `${game.displayName} - ${payload.profileName || 'default'}`,
    createdAt: new Date().toISOString(),
    createdBy: 'Vertex 2.0.0',
    game,
    profile: {
      name: toSafeText(profilePayload.profile?.name || payload.profileName, 'default'),
      sourcePlatform: game.sourceType
    },
    offlinePolicy: {
      network: 'disabled',
      missingArtifact: 'block',
      conflictPolicy: toSafeText(payload.conflictPolicy || payload.conflict_policy, 'backup')
    },
    items: manifestItems,
    manualItems: skippedItems.map((entry) => ({
      name: entry.item?.displayName || entry.item?.sourceModKey || '未命名条目',
      reason: entry.reason
    })),
    dependencies: {
      mode: includeDependencies ? 'embedded' : 'ignore',
      missing: skippedItems
    }
  }

  const taskPayload = buildOfflinePackSourceTaskPayload(
    {
      ...payload,
      targetProfileName: createProfileNameSuggestion(manifest),
      packagePath: outputPath
    },
    game,
    manifest,
    taskEntries
  )

  addZipJson(zip, checksums, 'profile/install-profile.json', profilePayload)
  addZipJson(zip, checksums, 'tasks/source-install-task.payload.json', taskPayload)
  addZipJson(zip, checksums, 'manifest.json', manifest)
  writeOfflinePackChecksums(zip, checksums)

  const zipLimitValidation = validateOfflinePackPackageLimits(buildZipLimitPayload(zip))
  if (!zipLimitValidation.valid) {
    return toOfflinePackLimitError(zipLimitValidation)
  }

  await zip.finish()
  const stat = await fs.stat(outputPath)
  insertVxpackHistory({
    gameId: game.gameId,
    operationType: 'offline_export',
    packagePath: outputPath,
    manifestVersion: manifest.schemaVersion,
    modCount: manifest.items.length,
    profileCount: 1,
    sizeBytes: stat.size
  })

  return {
    success: true,
    message: `离线安装包已导出：可直接安装 ${manifest.items.length} 个，跳过 ${skippedItems.length} 个，手动处理 ${manifest.manualItems.length} 个，依赖文件${includeDependencies ? '已包含' : '未包含'}，大小 ${stat.size} B`,
    data: {
      packagePath: outputPath,
      manifest,
      sizeBytes: stat.size,
      installableCount: manifest.items.length,
      manualCount: manifest.manualItems.length,
      skippedCount: skippedItems.length,
      includeDependencies,
      dependencyMode: manifest.dependencies.mode,
      skippedItems,
      sourceWarnings
    }
  }
  } finally {
    await zip?.abort()
    await fs.remove(workDir)
  }
}

export async function inspectOfflinePack(payload = {}) {
  const __inspectStart = Date.now()
  let zip
  try {
    const packagePath = toSafeText(payload.packagePath ?? payload.package_path ?? payload.filePath)
    if (!packagePath || !(await fs.pathExists(packagePath))) {
      recordOfflinePackStage('inspect', Date.now() - __inspectStart, false)
      return createOfflinePackError(OFFLINE_PACK_ERROR_CODE.INVALID, '离线安装包文件不存在')
    }
    if (!isOfflinePackFilePath(packagePath)) {
      recordOfflinePackStage('inspect', Date.now() - __inspectStart, false)
      return createOfflinePackError(
        OFFLINE_PACK_ERROR_CODE.INVALID,
        '当前文件不是 .vxpack 离线安装包'
      )
    }

    zip = await openOfflinePackArchive(packagePath)
    const manifest = await readManifest(zip)

    const archiveInspect = await inspectOfflinePackArchiveZip(zip, manifest, zip.sizeBytes)
    if (!archiveInspect.success) {
      return archiveInspect
    }
    const { checksum, itemInspect, blockers: archiveBlockers, itemBlockers = [] } = archiveInspect.data
    const gameMatch = resolveGameMatch(manifest, payload)
    const blockers = [...archiveBlockers]

    if (gameMatch.status === 'not_registered') {
      blockers.push({
        code: OFFLINE_PACK_ERROR_CODE.GAME_NOT_REGISTERED,
        message: '本机尚未识别或绑定包对应游戏',
        actionText: '请先在游戏库中添加并绑定该游戏目录，然后重新导入。'
      })
    } else if (gameMatch.status === 'ambiguous') {
      blockers.push({
        code: OFFLINE_PACK_ERROR_CODE.GAME_AMBIGUOUS,
        message: '本机匹配到多个候选游戏，需要用户确认',
        actionText: '请在下方选择本次离线安装的目标游戏。',
        candidates: (gameMatch.candidates || []).map(formatGameCandidate)
      })
    } else if (gameMatch.status === 'root_missing') {
      blockers.push({
        code: OFFLINE_PACK_ERROR_CODE.GAME_ROOT_MISSING,
        message: '本机缺少可用游戏目录',
        actionText: '请重新定位该游戏目录后再导入，离线包不会使用导出机器上的路径。'
      })
    }
    const profilePlan =
      gameMatch.status === 'matched'
        ? resolveOfflineImportProfilePlan(manifest, gameMatch, payload.targetProfileName, {
            profileMode: payload.profileMode || payload.profile_mode || payload.targetProfileMode,
            reuseProfileName: payload.reuseProfileName || payload.reuse_profile_name
          })
        : {
            requestedProfileName: createProfileNameSuggestion(manifest),
            targetProfileName: createProfileNameSuggestion(manifest),
            isolated: true,
            reuseExistingEmptyProfile: false,
            adjusted: false,
            existingProfiles: [],
            reusableProfile: {
              profileName: resolveOfflinePackReusableProfileName(manifest, 'default'),
              canReuse: false,
              occupied: false
            }
          }

    recordOfflinePackStage('inspect', Date.now() - __inspectStart, true)
    return {
      success: true,
      data: {
        kind: 'offline-pack',
        packagePath,
        sizeBytes: zip.sizeBytes,
        archiveSignature: zip.signature,
        manifest,
        checksum,
        gameMatch,
        profilePlan,
        targetProfileName: profilePlan.targetProfileName,
        installableItems: itemInspect.installableItems,
        manualItems: itemInspect.manualItems,
        blockers,
        itemBlockers,
        canSubmitInstall: blockers.length === 0 && itemInspect.installableItems.length > 0
      }
    }
  } catch (error) {
    recordOfflinePackStage('inspect', Date.now() - __inspectStart, false)
    return createOfflinePackError(
      error.code || OFFLINE_PACK_ERROR_CODE.INVALID,
      String(error?.message || '读取离线安装包失败')
    )
  } finally {
    zip?.close()
  }
}

// extractArtifact 进程内互斥锁：以 (packageSha256, artifactId) 为键，
// 防止同一 vxpack 并发 / 重复 submit 时同时写同一 cache 文件导致 zip 损坏（审计 🔴#2）
const extractArtifactLockMap = new Map()
function acquireExtractArtifactLock(lockKey = '') {
  if (!lockKey) {
    return Promise.resolve(() => Promise.resolve())
  }
  const prev = extractArtifactLockMap.get(lockKey) || Promise.resolve()
  let releaseNext
  const next = new Promise((resolve) => {
    releaseNext = resolve
  })
  const tail = prev.then(() => next)
  extractArtifactLockMap.set(lockKey, tail)
  const release = () => {
    releaseNext()
    if (extractArtifactLockMap.get(lockKey) === tail) extractArtifactLockMap.delete(lockKey)
  }
  return prev.then(() => release)
}

async function extractArtifact(zip, packageSha256 = '', item = {}) {
  const artifactPath = normalizeOfflinePackPath(item.artifactPath || item.artifact_path)
  if (!zip.getEntry(artifactPath)) {
    throw new Error(`包内缺少离线文件：${item.name || item.itemId}`)
  }
  const targetDir = path.join(
    getOfflinePackCacheRoot(),
    packageSha256,
    sanitizeZipSegment(item.artifactId, 'artifact')
  )
  const fileName = sanitizeFileName(path.basename(artifactPath), 'package.zip')
  const targetPath = path.join(targetDir, fileName)
  const lockKey = `${packageSha256}:${item.artifactId || artifactPath}`

  // 互斥写 + 原子 rename：避免并发写覆盖半成品 zip
  const release = await acquireExtractArtifactLock(lockKey)
  try {
    await zip.extract(artifactPath, targetPath, item.sha256)
    return targetPath
  } finally {
    release()
  }
}

export async function cleanupOfflinePackCache(payload = {}) {
  return cleanupOfflinePackCacheEntries(payload)
}

function loadTaskPayload(zip) {
  return parseJsonEntry(zip, 'tasks/source-install-task.payload.json', {})
}

function loadRuleSnapshot(zip, item = {}) {
  const rulePath = normalizeOfflinePackPath(item.installRulePath || item.install_rule_path)
  if (!rulePath) return {}
  return parseJsonEntry(zip, rulePath, {})
}

function groupEntriesBySource(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    const source = normalizeSource(
      entry?.item?.sourcePlatform || entry?.meta?.sourcePlatform || entry?.meta?.sourceType
    )
    if (!source) continue
    if (!map.has(source)) map.set(source, [])
    map.get(source).push(entry)
  }
  return map
}

function filterSelectedInstallableItems(items = [], selectedItemIds = []) {
  const selectedSet = new Set(
    (Array.isArray(selectedItemIds) ? selectedItemIds : [])
      .map((item) => toSafeText(item))
      .filter(Boolean)
  )
  if (!selectedSet.size) return items
  return items.filter((item) => selectedSet.has(toSafeText(item.itemId || item.item_id)))
}

// submit 入口幂等保护：同一 (packagePath, targetProfileName) 短时间内重复提交直接返回进行中状态
const submitInflightMap = new Map()
const SUBMIT_INFLIGHT_TTL_MS = 5000

function acquireSubmitInflightToken(payload = {}) {
  const packagePath = toSafeText(payload.packagePath || payload.package_path)
  const profileName = toSafeText(payload.targetProfileName || payload.target_profile_name)
  if (!packagePath) return { ok: true, token: null }
  const token = `${packagePath}::${profileName}`
  const now = Date.now()
  // 清理过期 token
  for (const [key, ts] of submitInflightMap.entries()) {
    if (now - ts > SUBMIT_INFLIGHT_TTL_MS) submitInflightMap.delete(key)
  }
  if (submitInflightMap.has(token)) {
    return { ok: false, token }
  }
  submitInflightMap.set(token, now)
  return { ok: true, token }
}

function releaseSubmitInflightToken(token) {
  if (!token) return
  submitInflightMap.delete(token)
}

export async function submitOfflinePackInstall(event, payload = {}) {
  const inflightGuard = acquireSubmitInflightToken(payload)
  if (!inflightGuard.ok) {
    return failOfflinePackSubmit(
      createOfflinePackError(
        OFFLINE_PACK_ERROR_CODE.TASK_CREATE_FAILED,
        '离线安装包正在处理中，请勿重复提交'
      ),
      {
        packagePath: payload.packagePath || payload.package_path || payload.filePath,
        stage: 'submit_inflight'
      }
    )
  }
  const inflightToken = inflightGuard.token

  const inspectResult = await inspectOfflinePack(payload)
  if (!inspectResult.success) {
    releaseSubmitInflightToken(inflightToken)
    return failOfflinePackSubmit(inspectResult, {
      packagePath: payload.packagePath || payload.package_path || payload.filePath,
      stage: 'inspect'
    })
  }
  const inspectData = inspectResult.data
  if (inspectData.kind !== 'offline-pack') {
    releaseSubmitInflightToken(inflightToken)
    return failOfflinePackSubmit(
      createOfflinePackError(
        OFFLINE_PACK_ERROR_CODE.INVALID,
        '当前文件不是 v2 离线安装包，无法创建安装任务'
      ),
      {
        packagePath: inspectData.packagePath,
        sizeBytes: inspectData.sizeBytes,
        stage: 'format'
      }
    )
  }
  if (!inspectData.canSubmitInstall) {
    releaseSubmitInflightToken(inflightToken)
    return failOfflinePackSubmit(
      createOfflinePackError(
        inspectData.blockers?.[0]?.code || OFFLINE_PACK_ERROR_CODE.INVALID,
        inspectData.blockers?.[0]?.message || '离线安装包预检未通过',
        { blockers: inspectData.blockers || [] }
      ),
      {
        packagePath: inspectData.packagePath,
        sizeBytes: inspectData.sizeBytes,
        manifestVersion: inspectData.manifest?.schemaVersion,
        modCount: inspectData.installableItems?.length || 0,
        gameKey: resolveOfflinePackGameKey(inspectData.manifest?.game),
        stage: 'precheck'
      }
    )
  }

  let zip
  try {
    const packagePath = inspectData.packagePath
    zip = await openOfflinePackArchive(packagePath)
    if (zip.signature !== inspectData.archiveSignature) throw new Error('离线安装包已发生变化，请重新导入')
    const manifest = inspectData.manifest
    const packageSha256 = await zip.hashFile()
    // cleanupOfflinePackCache 延迟到所有 job 创建之后执行，避免与刚 extract 的 cache 产生竞态
    const taskPayload = await loadTaskPayload(zip)
    const gameMatch = inspectData.gameMatch || {}
    const gameRow = gameMatch.game || {}
    const game = {
      ...manifest.game,
      gameRoot: gameMatch.gameRoot,
      clientRootPath: gameMatch.gameRoot
    }
    const profilePlan = resolveOfflineImportProfilePlan(
      manifest,
      gameMatch,
      toSafeText(
        payload.targetProfileName || payload.target_profile_name,
        inspectData.targetProfileName
      ),
      {
        profileMode: payload.profileMode || payload.profile_mode || payload.targetProfileMode,
        reuseProfileName: payload.reuseProfileName || payload.reuse_profile_name
      }
    )
    const targetProfileName = profilePlan.targetProfileName
    const sourceTaskEntries = Array.isArray(taskPayload.items) ? taskPayload.items : []
    const sourceEntryMap = new Map(
      sourceTaskEntries.map((entry) => [toSafeText(entry?.meta?.offlinePackItemId), entry])
    )
    const entries = []
    const selectedInstallableItems = filterSelectedInstallableItems(
      inspectData.installableItems || [],
      payload.selectedItemIds || payload.selected_item_ids
    )
    if (!selectedInstallableItems.length) {
      return failOfflinePackSubmit(
        createOfflinePackError(OFFLINE_PACK_ERROR_CODE.INVALID, '没有选择可安装条目'),
        {
          packagePath,
          sizeBytes: inspectData.sizeBytes,
          manifestVersion: manifest.schemaVersion,
          gameId: gameRow.id || gameMatch.gameId || 0,
          gameKey: resolveOfflinePackGameKey(manifest.game),
          stage: 'selection'
        }
      )
    }

    for (const item of selectedInstallableItems) {
      let filePath = ''
      const __extractStart = Date.now()
      try {
        filePath = await extractArtifact(zip, packageSha256, item)
        recordOfflinePackStage('extract', Date.now() - __extractStart, true)
      } catch (error) {
        recordOfflinePackStage('extract', Date.now() - __extractStart, false)
        const message = String(error?.message || '离线文件解包失败')
        const code = message.includes('校验失败')
          ? OFFLINE_PACK_ERROR_CODE.CHECKSUM_FAILED
          : OFFLINE_PACK_ERROR_CODE.ARTIFACT_MISSING
        return failOfflinePackSubmit(
          createOfflinePackError(code, message, {
            itemId: item.itemId || item.item_id || '',
            artifactId: item.artifactId || item.artifact_id || '',
            artifactPath: item.artifactPath || item.artifact_path || ''
          }),
          {
            packagePath,
            sizeBytes: inspectData.sizeBytes,
            manifestVersion: manifest.schemaVersion,
            gameId: gameRow.id || gameMatch.gameId || 0,
            modCount: selectedInstallableItems.length,
            gameKey: resolveOfflinePackGameKey(manifest.game),
            stage: 'artifact_extract'
          }
        )
      }
      const sourceEntry = toPlainJson(sourceEntryMap.get(item.itemId) || {}, {})
      const ruleSnapshot = await loadRuleSnapshot(zip, item)
      const fallbackEntry = buildTaskEntry(
        {
          displayName: item.name,
          fileName: path.basename(filePath),
          sourcePlatform: item.sourcePlatform,
          sourceModKey: item.sourceModKey,
          sourceModId: item.sourceModId,
          sourceFileId: item.sourceFileId,
          sourceGameId: item.sourceGameId,
          sourceGameSlug: item.sourceGameSlug,
          version: item.version,
          cover: item.cover,
          dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
          isDefaultDependency: item.isDefaultDependency === true,
          installRule: ruleSnapshot,
          sizeBytes: item.sizeBytes
        },
        item,
        item.artifactPath
      )
      const entry = buildOfflinePackInstallEntry({
        sourceEntry,
        fallbackEntry,
        item,
        filePath,
        ruleSnapshot,
        manifest,
        packagePath,
        packageSha256,
        targetProfileName,
        profilePlan,
        // installModsExecuteV2 用 appid 当作 games.id 反查；
        // 这里把已解析到的本机游戏 id 透传过去，避免 staging 落到 staging\\0\\、反查模组失败。
        gameId: gameRow.id || gameMatch.gameId || 0
      })
      entries.push(entry)
    }

    const grouped = groupEntriesBySource(entries)
    const jobs = []
    // 两阶段提交：所有 job 创建成功后才写 history；中途失败则 cancel 已创建的 job 并清理 cache
    for (const [source, items] of grouped.entries()) {
      const createPayload = buildOfflinePackSourceTaskPayload(
        {
          ...payload,
          packagePath,
          source,
          targetProfileName,
          profilePlan,
          packageSha256
        },
        game,
        manifest,
        items
      )
      createPayload.gameRoot = gameMatch.gameRoot
      createPayload.gameId = gameRow.id || gameMatch.gameId || 0
      const __taskCreateStart = Date.now()
      const result = await createSourceInstallTask(event, createPayload)
      recordOfflinePackStage('task_create', Date.now() - __taskCreateStart, !!result?.success)
      if (!result?.success) {
        // 回滚已创建的 job：避免一半任务已入库 / 进行中，另一半失败
        for (const createdJob of jobs) {
          const createdJobId = createdJob?.jobId || createdJob?.data?.jobId
          if (!createdJobId) continue
          try {
            await cancelSourceInstallTask({ jobId: createdJobId })
          } catch (cancelErr) {
            console.warn('[offlinePack] 回滚已创建任务失败', {
              jobId: createdJobId,
              error: cancelErr?.message
            })
          }
        }
        return failOfflinePackSubmit(
          createOfflinePackError(
            OFFLINE_PACK_ERROR_CODE.TASK_CREATE_FAILED,
            result?.message || '创建离线安装任务失败',
            { source, result }
          ),
          {
            packagePath,
            sizeBytes: inspectData.sizeBytes,
            manifestVersion: manifest.schemaVersion,
            gameId: gameRow.id || gameMatch.gameId || 0,
            modCount: entries.length,
            gameKey: resolveOfflinePackGameKey(manifest.game),
            stage: 'task_create'
          }
        )
      }
      jobs.push({ source, ...result })
    }

    insertVxpackHistory({
      gameId: gameRow.id || gameMatch.gameId || 0,
      operationType: 'offline_import',
      packagePath,
      manifestVersion: manifest.schemaVersion,
      modCount: entries.length,
      profileCount: 1,
      sizeBytes: inspectData.sizeBytes,
      state: 'completed'
    })

    // 所有 job 创建成功后再执行 cache 清理；当前 packageSha256 不在 retention 范围内
    // （由 extractArtifact 刚写入或即将写入），不会被误删
    try {
      await cleanupOfflinePackCache({
        retentionDays: OFFLINE_PACK_CACHE_RETENTION_DAYS,
        protectedKeys: [packageSha256]
      })
    } catch (cleanupErr) {
      console.warn('[offlinePack] 任务创建后清理 cache 失败', cleanupErr?.message)
    }

    return {
      success: true,
      message: `已加入安装任务：${jobs.length} 个来源，${entries.length} 个条目`,
      data: {
        jobs,
        targetProfileName,
        profilePlan,
        packageSha256,
        itemCount: entries.length
      }
    }
  } catch (error) {
    return failOfflinePackSubmit(
      createOfflinePackError(
        OFFLINE_PACK_ERROR_CODE.INVALID,
        String(error?.message || '离线安装包导入失败')
      ),
      {
        packagePath: inspectData?.packagePath || payload.packagePath || payload.package_path,
        sizeBytes: inspectData?.sizeBytes || 0,
        manifestVersion: inspectData?.manifest?.schemaVersion,
        modCount: inspectData?.installableItems?.length || 0,
        gameKey: resolveOfflinePackGameKey(inspectData?.manifest?.game),
        stage: 'exception'
      }
    )
  } finally {
    zip?.close()
    releaseSubmitInflightToken(inflightToken)
  }
}
