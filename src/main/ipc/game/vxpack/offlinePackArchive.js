import crypto from 'crypto'
import fs from 'fs-extra'
import { openOfflinePackArchive } from './offlinePackStreaming.js'
import {
  OFFLINE_PACK_ERROR_CODE,
  createOfflinePackError,
  isOfflinePackFilePath,
  isSafeOfflinePackRelativePath,
  normalizeOfflinePackPath,
  validateOfflinePackManifest,
  validateOfflinePackPackageLimits
} from '../../../../shared/modpacks/offline-pack-contract.js'

export const CHECKSUMS_PATH = 'checksums.json'

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function sha256OfflinePackBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export async function parseOfflinePackJsonEntry(zip, entryName = '', fallback = null) {
  const safeEntryName = normalizeOfflinePackPath(entryName)
  if (!isSafeOfflinePackRelativePath(safeEntryName)) {
    throw new Error('离线安装包包含不安全路径')
  }
  const entry = zip.getEntry(safeEntryName)
  if (!entry) {
    if (fallback !== null) return fallback
    throw new Error(`离线安装包缺少 ${safeEntryName}`)
  }
  return JSON.parse(await zip.readAsText(entry))
}

export function readOfflinePackManifestFromZip(zip) {
  return parseOfflinePackJsonEntry(zip, 'manifest.json')
}

export function addOfflinePackZipBuffer(zip, checksums, entryName = '', buffer) {
  const safeEntryName = normalizeOfflinePackPath(entryName)
  if (!isSafeOfflinePackRelativePath(safeEntryName)) {
    throw new Error(`离线安装包写入路径不安全：${entryName}`)
  }
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  zip.addFile(safeEntryName, safeBuffer)
  checksums[safeEntryName] = sha256OfflinePackBuffer(safeBuffer)
}

export function addOfflinePackZipJson(zip, checksums, entryName = '', data = {}) {
  addOfflinePackZipBuffer(
    zip,
    checksums,
    entryName,
    Buffer.from(JSON.stringify(data, null, 2), 'utf-8')
  )
}

export function writeOfflinePackChecksums(zip, checksums = {}) {
  zip.addFile(CHECKSUMS_PATH, Buffer.from(JSON.stringify(checksums, null, 2), 'utf-8'))
}

export async function getOfflinePackZipEntryBuffer(zip, entryName = '', maxBytes) {
  const safeEntryName = normalizeOfflinePackPath(entryName)
  if (!isSafeOfflinePackRelativePath(safeEntryName)) {
    throw new Error('离线安装包包含不安全路径')
  }
  const entry = zip.getEntry(safeEntryName)
  if (!entry || entry.isDirectory) return null
  if (zip.readEntryBuffer) return zip.readEntryBuffer(safeEntryName, maxBytes)
  if (maxBytes && getZipEntrySize(entry) > maxBytes) return null
  return entry.getData()
}

async function hashEntry(zip, name) {
  if (zip.hashEntry) return zip.hashEntry(name)
  const buffer = await getOfflinePackZipEntryBuffer(zip, name)
  return buffer ? sha256OfflinePackBuffer(buffer) : null
}

const OFFLINE_PACK_COVER_EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif'
}
const OFFLINE_PACK_COVER_MAX_DATA_URL_BYTES = 1.5 * 1024 * 1024

// 将内嵌封面（covers/<itemId>.<ext>）转为 data URL，供导入预览离线渲染。
export async function buildOfflinePackItemCoverDataUrl(zip, item = {}) {
  const coverPath = normalizeOfflinePackPath(item.coverPath || item.cover_path || '')
  if (!coverPath || !isSafeOfflinePackRelativePath(coverPath)) return ''
  let buffer = null
  try {
    buffer = await getOfflinePackZipEntryBuffer(zip, coverPath, OFFLINE_PACK_COVER_MAX_DATA_URL_BYTES)
  } catch {
    return ''
  }
  if (!buffer || !buffer.length || buffer.length > OFFLINE_PACK_COVER_MAX_DATA_URL_BYTES) return ''
  const ext = String(coverPath.split('.').pop() || 'png').toLowerCase()
  const mime = OFFLINE_PACK_COVER_EXT_MIME[ext] || 'image/png'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function getZipEntrySize(entry = {}) {
  return Math.max(
    0,
    toSafeNumber(entry.header?.size ?? entry.header?.uncompressedSize ?? entry.uncompressedSize, 0)
  )
}

export function buildOfflinePackZipLimitPayload(zip, packageBytes = 0) {
  const entrySizes = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      path: normalizeOfflinePackPath(entry.entryName),
      sizeBytes: getZipEntrySize(entry)
    }))
  const totalEntryBytes = entrySizes.reduce(
    (total, entry) => total + toSafeNumber(entry.sizeBytes, 0),
    0
  )
  return {
    packageBytes: toSafeNumber(packageBytes, totalEntryBytes) || totalEntryBytes,
    entryCount: entrySizes.length,
    entrySizes
  }
}

export function toOfflinePackLimitError(validation = {}) {
  return createOfflinePackError(
    validation.code || OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED,
    validation.message || '离线安装包超过安全限制',
    validation.details || {}
  )
}

export async function verifyOfflinePackChecksums(zip) {
  if (!zip.getEntry(CHECKSUMS_PATH)) {
    return {
      valid: false,
      total: 0,
      failures: [{ path: CHECKSUMS_PATH, reason: 'missing' }]
    }
  }
  const checksums = await parseOfflinePackJsonEntry(zip, CHECKSUMS_PATH, {})
  const failures = []
  for (const [entryName, expectedHash] of Object.entries(checksums || {})) {
    const safeEntryName = normalizeOfflinePackPath(entryName)
    if (!isSafeOfflinePackRelativePath(safeEntryName)) {
      failures.push({ path: entryName, reason: 'unsafe_path' })
      continue
    }
    const actualHash = await hashEntry(zip, safeEntryName)
    if (!actualHash) {
      failures.push({ path: safeEntryName, reason: 'missing' })
      continue
    }
    if (actualHash !== expectedHash) {
      failures.push({ path: safeEntryName, reason: 'mismatch' })
    }
  }
  return {
    valid: failures.length === 0,
    total: Object.keys(checksums || {}).length,
    failures
  }
}

export async function inspectOfflinePackManifestItems(zip, manifest = {}) {
  const installableItems = []
  let remainingCoverBytes = 8 * 1024 * 1024
  const manualItems = Array.isArray(manifest.manualItems) ? manifest.manualItems : []
  // 区分「单条坏条目」（仅阻断该条目本身）与「全局 blocker」（阻断整包）。
  // 单条 checksum/artifact/rule 失败时只把对应条目从 installableItems 中剔除，
  // 不再阻塞其余可安装条目（审计 🟡#10）。
  const itemBlockers = []

  for (const item of manifest.items || []) {
    const artifactPath = normalizeOfflinePackPath(item.artifactPath || item.artifact_path)
    const artifactHash = await hashEntry(zip, artifactPath)
    if (!artifactHash) {
      itemBlockers.push({
        code: OFFLINE_PACK_ERROR_CODE.ARTIFACT_MISSING,
        itemId: item.itemId,
        artifactId: item.artifactId,
        message: `包内缺少离线文件：${item.name || item.itemId}`,
        scope: 'item'
      })
      continue
    }
    if (item.sha256 && artifactHash !== item.sha256) {
      itemBlockers.push({
        code: OFFLINE_PACK_ERROR_CODE.CHECKSUM_FAILED,
        itemId: item.itemId,
        artifactId: item.artifactId,
        message: `离线文件校验失败：${item.name || item.itemId}`,
        scope: 'item'
      })
      continue
    }
    const rulePath = normalizeOfflinePackPath(item.installRulePath || item.install_rule_path)
    if (rulePath && !(await getOfflinePackZipEntryBuffer(zip, rulePath))) {
      itemBlockers.push({
        code: OFFLINE_PACK_ERROR_CODE.RULE_MISSING,
        itemId: item.itemId,
        artifactId: item.artifactId,
        message: `包内缺少安装规则快照：${item.name || item.itemId}`,
        scope: 'item'
      })
      continue
    }
    if (!rulePath) {
      itemBlockers.push({
        code: OFFLINE_PACK_ERROR_CODE.RULE_MISSING,
        itemId: item.itemId,
        artifactId: item.artifactId,
        message: `条目缺少安装规则快照：${item.name || item.itemId}`,
        scope: 'item'
      })
      continue
    }
    const coverPath = normalizeOfflinePackPath(item.coverPath || item.cover_path || '')
    const coverSize = coverPath && isSafeOfflinePackRelativePath(coverPath)
      ? getZipEntrySize(zip.getEntry(coverPath) || {}) : 0
    const coverDataUrl = coverSize > 0 && coverSize <= remainingCoverBytes
      ? await buildOfflinePackItemCoverDataUrl(zip, item) : ''
    if (coverDataUrl) remainingCoverBytes -= coverSize
    installableItems.push(coverDataUrl ? { ...item, coverDataUrl } : item)
  }

  return { installableItems, manualItems, itemBlockers }
}

export async function inspectOfflinePackArchiveZip(zip, manifest = {}, packageBytes = 0) {
  const validation = validateOfflinePackManifest(manifest)
  if (!validation.valid) {
    return createOfflinePackError(validation.code, validation.message)
  }

  const limitValidation = validateOfflinePackPackageLimits(
    buildOfflinePackZipLimitPayload(zip, packageBytes)
  )
  if (!limitValidation.valid) {
    return toOfflinePackLimitError(limitValidation)
  }

  const checksum = await verifyOfflinePackChecksums(zip)
  const itemInspect = await inspectOfflinePackManifestItems(zip, manifest)
  await zip.assertUnchanged?.()
  // 全局 blocker：仅包含跨条目的完整性失败（checksums.json 缺失或全局校验失败）
  const blockers = []
  if (!checksum.valid) {
    blockers.push({
      code: OFFLINE_PACK_ERROR_CODE.CHECKSUM_FAILED,
      message: '离线安装包完整性校验失败',
      failures: checksum.failures,
      scope: 'global'
    })
  }
  // 单条 blocker 仅作为 UI 提示，不阻断 canSubmitInstall
  const itemBlockers = Array.isArray(itemInspect.itemBlockers) ? itemInspect.itemBlockers : []

  return {
    success: true,
    data: {
      checksum,
      itemInspect,
      blockers,
      itemBlockers
    }
  }
}

export async function inspectOfflinePackArchiveFile(packagePath = '') {
  let zip
  try {
    if (!packagePath || !(await fs.pathExists(packagePath))) {
      return createOfflinePackError(OFFLINE_PACK_ERROR_CODE.INVALID, '离线安装包文件不存在')
    }
    if (!isOfflinePackFilePath(packagePath)) {
      return createOfflinePackError(
        OFFLINE_PACK_ERROR_CODE.INVALID,
        '当前文件不是 .vxpack 离线安装包'
      )
    }
    zip = await openOfflinePackArchive(packagePath)
    const manifest = await readOfflinePackManifestFromZip(zip)
    const archiveInspect = await inspectOfflinePackArchiveZip(zip, manifest, zip.sizeBytes)
    if (!archiveInspect.success) return archiveInspect
    const { checksum, itemInspect, blockers, itemBlockers } = archiveInspect.data
    return {
      success: true,
      data: {
        kind: 'offline-pack',
        packagePath,
        sizeBytes: zip.sizeBytes,
        manifest,
        checksum,
        installableItems: itemInspect.installableItems,
        manualItems: itemInspect.manualItems,
        blockers,
        itemBlockers,
        canSubmitInstall: blockers.length === 0 && itemInspect.installableItems.length > 0
      }
    }
  } catch (error) {
    return createOfflinePackError(
      error.code || OFFLINE_PACK_ERROR_CODE.INVALID,
      String(error?.message || '读取离线安装包失败')
    )
  } finally {
    zip?.close()
  }
}
