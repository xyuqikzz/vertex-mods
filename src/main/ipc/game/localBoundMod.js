import { nativeText } from '../../services/uiLanguage.js'
import { dialog } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import userPath from '../../initPath.js'
import {
  dbUninstallMod,
  getModDataByRowId,
  insertMod,
  updateLocalBoundModRecord
} from '../../db/mods/mods.js'
import { getGameDataByAppId, getModListByAppIdSql } from '../../db/games/game.js'
import { formatChinaTime } from '../tool.js'

const LOCAL_BINDING_SCHEMA_VERSION = 2
const LOCAL_BINDING_FLAG = 'local_binding'
const LOCAL_BINDING_INSTALL_MODEL = 'bound'

function toSafeText(value) {
  return String(value ?? '').trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
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

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex')
}

function normalizeSource(value = '') {
  const source = toSafeText(value).toLowerCase()
  return source === 'vertex' ? 'server' : source || 'server'
}

function normalizeProfileName(value = '') {
  return toSafeText(value) || 'default'
}

function normalizeSourceMeta(payload = {}) {
  const source = toSafeObject(payload)
  const sourceMeta = toSafeObject(source.sourceMeta)
  const normalizedSource = normalizeSource(
    source.source || source.sourceType || source.sourcePlatform || sourceMeta.source
  )
  const profileName = normalizeProfileName(
    source.profileName || source.profile_name || sourceMeta.profileName || sourceMeta.targetProfileName
  )
  return {
    ...sourceMeta,
    source: normalizedSource,
    sourceId: toSafeText(
      source.sourceId ?? source.source_id ?? sourceMeta.sourceId ?? sourceMeta.source_id
    ),
    sourceSlug: toSafeText(
      source.sourceSlug ??
        source.source_slug ??
        source.deployDomain ??
        sourceMeta.sourceSlug ??
        sourceMeta.source_slug ??
        sourceMeta.domainName ??
        sourceMeta.community
    ),
    community: toSafeText(source.community || sourceMeta.community),
    appId: toSafeText(source.appId ?? source.appid ?? sourceMeta.appId ?? sourceMeta.app_id),
    profileName,
    targetProfileName: profileName
  }
}

function normalizeEndpointType(payload = {}) {
  return toSafeNumber(payload.endpointType ?? payload.type ?? payload.endpoint_type, 0)
}

function normalizeBoundPath(item = {}) {
  if (typeof item === 'string') {
    return { path: toSafeText(item), type: '' }
  }
  const source = toSafeObject(item)
  return {
    path: toSafeText(source.path || source.originalPath),
    type: toSafeText(source.type).toLowerCase()
  }
}

async function inspectBoundPath(item = {}) {
  const target = normalizeBoundPath(item)
  if (!target.path) return null
  const exists = await fs.pathExists(target.path)
  let stat = null
  if (exists) {
    stat = await fs.stat(target.path)
  }
  const type = exists ? (stat.isDirectory() ? 'folder' : 'file') : target.type || 'file'
  return {
    id: hashText(path.resolve(target.path).toLowerCase()).slice(0, 16),
    type,
    originalPath: path.resolve(target.path),
    disabledPath: '',
    state: exists ? 'enabled' : 'missing',
    size: exists && stat.isFile() ? stat.size : 0,
    mtime: exists && stat ? stat.mtimeMs : 0,
    error: exists ? '' : '路径不存在'
  }
}

function isSamePath(left = '', right = '') {
  if (!left || !right) return false
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function collectBlockedRoots(payload = {}) {
  const roots = new Set()
  const home = os.homedir()
  if (home) roots.add(path.resolve(home).toLowerCase())
  const downloads = home ? path.join(home, 'Downloads') : ''
  if (downloads) roots.add(path.resolve(downloads).toLowerCase())
  const gameRoot = toSafeText(payload.gameRoot || payload.rootPath || payload.gamePath)
  if (gameRoot) roots.add(path.resolve(gameRoot).toLowerCase())
  for (const value of [process.env.SystemRoot, process.env.WINDIR, process.env.ProgramFiles]) {
    if (value) roots.add(path.resolve(value).toLowerCase())
  }
  return roots
}

function validateSafePaths(items = [], payload = {}) {
  const blockedRoots = collectBlockedRoots(payload)
  const seen = new Set()
  const duplicates = []
  const unsafe = []

  for (const item of items) {
    const targetPath = toSafeText(item?.originalPath)
    if (!targetPath) continue
    const resolved = path.resolve(targetPath)
    const normalized = resolved.toLowerCase()
    if (seen.has(normalized)) {
      duplicates.push(resolved)
    }
    seen.add(normalized)

    const parsed = path.parse(resolved)
    if (isSamePath(resolved, parsed.root) || blockedRoots.has(normalized)) {
      unsafe.push(resolved)
      continue
    }

  }

  return { duplicates, unsafe }
}

function findExistingLocalBindingPath(items = [], payload = {}) {
  const sourceMeta = normalizeSourceMeta(payload)
  const records = getModListByAppIdSql(
    toSafeNumber(payload.appId ?? payload.appid ?? sourceMeta.appId, 0),
    normalizeEndpointType(payload),
    sourceMeta
  )
  for (const record of records || []) {
    const metadata = parseJsonObject(record.metadata_json)
    const flags = parseJsonArray(record.compat_flags)
    const isLocalBinding =
      record.install_model === LOCAL_BINDING_INSTALL_MODEL ||
      metadata.localBinding === true ||
      flags.includes(LOCAL_BINDING_FLAG)
    if (!isLocalBinding) continue
    for (const existed of parseJsonArray(metadata.items)) {
      for (const item of items) {
        if (isSamePath(item.originalPath, existed?.originalPath) || isSamePath(item.originalPath, existed?.disabledPath)) {
          return {
            recordId: record.id,
            name: record.name,
            path: item.originalPath
          }
        }
      }
    }
  }
  return null
}

function ensureLocalBindingRecord(record = {}) {
  const metadata = parseJsonObject(record.metadata_json)
  if (
    record.install_model !== LOCAL_BINDING_INSTALL_MODEL &&
    metadata.localBinding !== true &&
    !parseJsonArray(record.compat_flags).includes(LOCAL_BINDING_FLAG)
  ) {
    throw new Error('当前记录不是本地绑定模组')
  }
  return metadata
}

function buildDisabledRoot(record = {}, metadata = {}) {
  return (
    toSafeText(metadata.disabledRoot) ||
    path.join(
      userPath,
      'managed-local-mods',
      String(record.game_id || 'unknown'),
      normalizeSource(record.source),
      normalizeProfileName(record.profile_name),
      String(record.id || 'record'),
      'disabled'
    )
  )
}

function buildDisabledPath(root = '', item = {}) {
  const baseName = path.basename(item.originalPath)
  const safeName = `${item.id || hashText(item.originalPath).slice(0, 16)}-${baseName}`
  return path.join(root, safeName)
}

function buildFilesJson(items = []) {
  return items.map((item) => ({
    type: item.type,
    path: item.originalPath
  }))
}

function resolveRecordState(items = []) {
  const failedCount = items.filter((item) => item.state === 'failed').length
  const missingCount = items.filter((item) => item.state === 'missing').length
  const disabledCount = items.filter((item) => item.state === 'disabled').length
  const enabledCount = items.filter((item) => item.state === 'enabled').length
  if (failedCount > 0) return { installState: 0, isActive: 0, state: 'partial_failed' }
  if (enabledCount > 0 && disabledCount > 0) return { installState: 0, isActive: 0, state: 'partial' }
  if (enabledCount > 0) return { installState: 1, isActive: 1, state: 'enabled' }
  if (disabledCount > 0) return { installState: 0, isActive: 0, state: 'disabled' }
  if (missingCount > 0) return { installState: 0, isActive: 0, state: 'missing' }
  return { installState: 0, isActive: 0, state: 'unknown' }
}

function saveLocalBindingRecord(record = {}, metadata = {}, items = []) {
  const state = resolveRecordState(items)
  const nextMetadata = {
    ...metadata,
    localBinding: true,
    schemaVersion: LOCAL_BINDING_SCHEMA_VERSION,
    items,
    state: state.state,
    updatedAt: formatChinaTime()
  }
  updateLocalBoundModRecord(record.id, {
    files: buildFilesJson(items),
    metadata: nextMetadata,
    targetPath: items[0]?.originalPath || record.target_path || '',
    installState: state.installState,
    isActive: state.isActive
  })
  return {
    success: state.state !== 'partial_failed',
    id: record.id,
    state: state.state,
    metadata: nextMetadata,
    items
  }
}

export async function selectLocalBoundModFiles() {
  const result = await dialog.showOpenDialog({
    title: nativeText('selectModFiles'),
    properties: ['openFile', 'multiSelections', 'dontAddToRecent']
  })
  return {
    success: !result.canceled,
    canceled: result.canceled,
    paths: Array.isArray(result.filePaths) ? result.filePaths : []
  }
}

export async function selectLocalBoundModFolders() {
  const result = await dialog.showOpenDialog({
    title: nativeText('selectModFolders'),
    properties: ['openDirectory', 'multiSelections', 'dontAddToRecent']
  })
  return {
    success: !result.canceled,
    canceled: result.canceled,
    paths: Array.isArray(result.filePaths) ? result.filePaths : []
  }
}

export async function createLocalBoundMod(payload = {}) {
  const target = toSafeObject(payload)
  const sourceMeta = normalizeSourceMeta(target)
  const appId = toSafeNumber(target.appId ?? target.appid ?? sourceMeta.appId, 0)
  const game = getGameDataByAppId(appId, sourceMeta)
  if (!game) {
    return { success: false, message: '未找到当前游戏记录，无法接管本地模组' }
  }

  const rawPaths = [
    ...parseJsonArray(target.folders).map((item) => ({ path: item, type: 'folder' })),
    ...parseJsonArray(target.files).map((item) => ({ path: item, type: 'file' })),
    ...parseJsonArray(target.paths)
  ]
  const inspected = (await Promise.all(rawPaths.map((item) => inspectBoundPath(item)))).filter(Boolean)
  if (!inspected.length) {
    return { success: false, message: '请选择需要绑定的本地文件或文件夹' }
  }

  const validation = validateSafePaths(inspected, target)
  if (validation.unsafe.length) {
    return {
      success: false,
      message: '选择路径包含高风险目录，已阻止绑定',
      unsafePaths: validation.unsafe
    }
  }
  if (validation.duplicates.length) {
    return {
      success: false,
      message: '选择路径存在重复，请移除重复项后重试',
      duplicatePaths: validation.duplicates
    }
  }
  const existedBinding = findExistingLocalBindingPath(inspected, target)
  if (existedBinding) {
    return {
      success: false,
      code: 'local_mod_duplicate_path',
      message: '该路径已被其他原地接管记录管理，请刷新列表后处理',
      duplicate: existedBinding
    }
  }

  const now = formatChinaTime()
  const name =
    toSafeText(target.name) ||
    path.basename(inspected[0]?.originalPath || '') ||
    `本地绑定模组-${now}`
  const extraMetadata = toSafeObject(target.metadata ?? target.metadata_json)
  const metadata = {
    ...extraMetadata,
    localBinding: true,
    schemaVersion: LOCAL_BINDING_SCHEMA_VERSION,
    createdBy: toSafeText(extraMetadata.createdBy) || 'local-mod-manager',
    managementMode: toSafeText(extraMetadata.managementMode) || 'bind_existing',
    sourceUrl: toSafeText(target.sourceUrl),
    note: toSafeText(target.note),
    boundAt: now,
    disabledRoot: '',
    state: 'enabled',
    sourceMeta,
    relatedLibraryItemId: toSafeNumber(extraMetadata.relatedLibraryItemId, 0),
    riskLevel: toSafeText(extraMetadata.riskLevel) || 'safe',
    riskReasons: parseJsonArray(extraMetadata.riskReasons),
    installTarget: toSafeObject(extraMetadata.installTarget),
    items: inspected
  }
  const sourceHash = hashText(
    `${game.id}:${sourceMeta.source}:${sourceMeta.profileName}:${inspected
      .map((item) => item.originalPath)
      .join('|')}`
  )
  const insertResult = await insertMod({
    appId,
    gameRowId: game.id,
    source: sourceMeta.source,
    sourceMeta,
    modId: sourceHash.slice(0, 24),
    optionId: 'local-binding',
    sourceModKey: `bound:${sourceHash}`,
    name,
    option_name: '本地绑定',
    profileName: sourceMeta.profileName,
    targetPath: inspected[0]?.originalPath || '',
    files: buildFilesJson(inspected),
    metadata,
    endpoint_type: normalizeEndpointType(target),
    installModel: LOCAL_BINDING_INSTALL_MODEL,
    installState: 1,
    isActive: 1,
    compatFlags: [LOCAL_BINDING_FLAG],
    created_at: now,
    installed_at: now,
    updated_at: now
  })

  return {
    success: true,
    id: Number(insertResult?.lastInsertRowid || 0),
    message: `已绑定 ${inspected.length} 个本地路径`,
    items: inspected
  }
}

async function moveItemsToDisabled(record = {}, metadata = {}) {
  const disabledRoot = buildDisabledRoot(record, metadata)
  await fs.ensureDir(disabledRoot)
  const items = parseJsonArray(metadata.items).map((item) => ({ ...item }))

  for (const item of items) {
    if (item.state === 'disabled') continue
    const originalPath = toSafeText(item.originalPath)
    if (!originalPath || !(await fs.pathExists(originalPath))) {
      item.state = 'missing'
      item.error = '原路径不存在'
      continue
    }
    const disabledPath = toSafeText(item.disabledPath) || buildDisabledPath(disabledRoot, item)
    if (await fs.pathExists(disabledPath)) {
      item.state = 'failed'
      item.error = '禁用区已存在同名路径'
      continue
    }
    try {
      await fs.ensureDir(path.dirname(disabledPath))
      await fs.move(originalPath, disabledPath, { overwrite: false })
      item.disabledPath = disabledPath
      item.state = 'disabled'
      item.error = ''
    } catch (error) {
      item.state = 'failed'
      item.error = toSafeText(error?.message) || '移动到禁用区失败'
    }
  }

  return {
    ...metadata,
    disabledRoot,
    items
  }
}

async function restoreDisabledItems(metadata = {}) {
  const items = parseJsonArray(metadata.items).map((item) => ({ ...item }))

  for (const item of items) {
    if (item.state === 'enabled') continue
    const originalPath = toSafeText(item.originalPath)
    const disabledPath = toSafeText(item.disabledPath)
    if (!disabledPath || !(await fs.pathExists(disabledPath))) {
      item.state = 'missing'
      item.error = '禁用区路径不存在'
      continue
    }
    if (await fs.pathExists(originalPath)) {
      item.state = 'failed'
      item.error = '原路径已存在，已阻止覆盖'
      continue
    }
    try {
      await fs.ensureDir(path.dirname(originalPath))
      await fs.move(disabledPath, originalPath, { overwrite: false })
      item.state = 'enabled'
      item.error = ''
    } catch (error) {
      item.state = 'failed'
      item.error = toSafeText(error?.message) || '恢复到原路径失败'
    }
  }

  return {
    ...metadata,
    items
  }
}

export async function disableLocalBoundMod(payload = {}) {
  const record = getModDataByRowId(payload?.id)
  if (!record) return { success: false, message: '未找到本地绑定记录' }
  const metadata = ensureLocalBindingRecord(record)
  const nextMetadata = await moveItemsToDisabled(record, metadata)
  const result = saveLocalBindingRecord(record, nextMetadata, nextMetadata.items)
  return {
    ...result,
    message: result.success ? '本地绑定模组已禁用' : '部分路径禁用失败，请检查详情'
  }
}

export async function enableLocalBoundMod(payload = {}) {
  const record = getModDataByRowId(payload?.id)
  if (!record) return { success: false, message: '未找到本地绑定记录' }
  const metadata = ensureLocalBindingRecord(record)
  const nextMetadata = await restoreDisabledItems(metadata)
  const result = saveLocalBindingRecord(record, nextMetadata, nextMetadata.items)
  return {
    ...result,
    message: result.success ? '本地绑定模组已启用' : '部分路径启用失败，请检查冲突'
  }
}

export async function deleteLocalBoundMod(payload = {}) {
  const record = getModDataByRowId(payload?.id)
  if (!record) return { success: false, message: '未找到本地绑定记录' }
  const metadata = ensureLocalBindingRecord(record)
  const items = parseJsonArray(metadata.items).map((item) => ({ ...item }))
  const failed = []

  for (const item of items) {
    const targetPath = item.state === 'disabled' ? item.disabledPath : item.originalPath
    if (!targetPath || !(await fs.pathExists(targetPath))) continue
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
    } catch (error) {
      item.state = 'failed'
      item.error = toSafeText(error?.message) || '删除文件失败'
      failed.push(item)
    }
  }

  if (failed.length) {
    saveLocalBindingRecord(record, metadata, items)
    return {
      success: false,
      message: `有 ${failed.length} 个路径删除失败，记录已保留`,
      failed
    }
  }

  dbUninstallMod(record.id)
  return { success: true, message: '本地绑定模组文件和记录已删除', id: record.id }
}

export async function unbindLocalBoundMod(payload = {}) {
  const record = getModDataByRowId(payload?.id)
  if (!record) return { success: false, message: '未找到本地绑定记录' }
  let metadata = ensureLocalBindingRecord(record)
  const restore = payload?.restore !== false
  if (restore && Number(record.is_active || 0) !== 1) {
    metadata = await restoreDisabledItems(metadata)
    const failed = parseJsonArray(metadata.items).filter((item) => item.state === 'failed')
    if (failed.length) {
      saveLocalBindingRecord(record, metadata, metadata.items)
      return {
        success: false,
        message: '恢复到原路径失败，已保留绑定记录',
        failed
      }
    }
  }
  dbUninstallMod(record.id)
  return {
    success: true,
    message: restore ? '已恢复路径并解除绑定' : '已解除绑定，文件保留在当前位置',
    id: record.id
  }
}

export async function refreshLocalBoundMods(payload = {}) {
  const target = toSafeObject(payload)
  const recordId = toSafeNumber(target.id, 0)
  const records = recordId
    ? [getModDataByRowId(recordId)].filter(Boolean)
    : getModListByAppIdSql(
        toSafeNumber(target.appId ?? target.appid, 0),
        normalizeEndpointType(target),
        normalizeSourceMeta(target)
      ).filter((record) => record.install_model === LOCAL_BINDING_INSTALL_MODEL)

  const refreshed = []
  for (const record of records) {
    const metadata = ensureLocalBindingRecord(record)
    const items = parseJsonArray(metadata.items).map((item) => {
      const enabledExists = item.originalPath && fs.pathExistsSync(item.originalPath)
      const disabledExists = item.disabledPath && fs.pathExistsSync(item.disabledPath)
      return {
        ...item,
        state: enabledExists ? 'enabled' : disabledExists ? 'disabled' : 'missing',
        error: enabledExists || disabledExists ? '' : '路径不存在'
      }
    })
    refreshed.push(saveLocalBindingRecord(record, metadata, items))
  }

  return {
    success: true,
    records: refreshed
  }
}
