import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { resolveSourcePlatformLabel } from '../../../../shared/sources/source-platform-registry.js'
import { getRemoteItems, taskEntryToCanonical } from './common.js'
import {
  getVamHubPackageDetail,
  resolveVamHubDownloadUrl
} from '../../views/game/vamhub/vamhub-service.js'

export const VAMHUB_SOURCE_MODPACK_ERROR_CODES = Object.freeze({
  MISSING_IDENTITY: 'vamhub_missing_identity',
  RESOURCE_UNAVAILABLE: 'vamhub_resource_unavailable',
  VERSION_NOT_FOUND: 'vamhub_version_not_found',
  DOWNLOAD_UNAVAILABLE: 'vamhub_download_unavailable',
  DOWNLOAD_RESOLUTION_FAILED: 'vamhub_download_resolution_failed'
})

function toText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  const text = toText(value)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function firstText(...values) {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ''
}

function normalizeVarFileName(value = '') {
  const text = toText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

function parseVamPackage(value = '', fallbackVersion = '') {
  const base = toText(value).replace(/\.var$/i, '')
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 2) {
    return {
      creator: '',
      name: base,
      version: toText(fallbackVersion),
      sourceModKey: base,
      id: base
    }
  }
  const creator = parts[0]
  const last = parts.at(-1)
  const hasVersion = /^\d+$/.test(last) || last.toLowerCase() === 'latest'
  const version = hasVersion ? last : toText(fallbackVersion)
  const name = (hasVersion ? parts.slice(1, -1) : parts.slice(1)).join('.')
  const sourceModKey = [creator, name || parts.slice(1).join('.')].filter(Boolean).join('.')
  return {
    creator,
    name: name || parts.slice(1).join('.'),
    version,
    sourceModKey,
    id: [sourceModKey, version].filter(Boolean).join('.')
  }
}

function createVamHubError(code, message) {
  return Object.assign(new Error(message), { code })
}

function readRecordMetadata(record = {}) {
  return {
    ...toObject(record.metadata_json),
    ...toObject(record.metadataJson),
    ...toObject(record.metadata)
  }
}

function resolveSourcePath(record = {}, metadata = {}) {
  const installRulePlan = toObject(metadata.installRulePlan || metadata.install_rule_plan)
  const archivePath = firstText(
    record.archivePath,
    record.archive_path,
    metadata.archivePath,
    metadata.archive_path,
    record.archivedSourcePath,
    record.archived_source_path,
    metadata.archivedSourcePath,
    metadata.archived_source_path
  )
  const stagingPath = firstText(
    record.stagingPath,
    record.staging_path,
    metadata.stagingPath,
    metadata.staging_path,
    installRulePlan.sourceRoot,
    installRulePlan.source_root,
    installRulePlan.lifecycleStagingRoot,
    installRulePlan.lifecycle_staging_root
  )
  const sourcePath = firstText(
    archivePath,
    stagingPath,
    record.sourcePath,
    record.source_path,
    metadata.sourcePath,
    metadata.source_path,
    metadata.sourceRoot,
    metadata.source_root,
    record.filePath,
    record.file_path,
    record.localPath,
    record.local_path,
    metadata.filePath,
    metadata.file_path,
    metadata.localPath,
    metadata.local_path
  )
  return { archivePath, stagingPath, sourcePath }
}

function buildSourcePageInfo(record = {}, metadata = {}, resourceId = '') {
  const sourceMeta = toObject(metadata.sourceMeta || metadata.source_meta)
  const sourcePageUrl = firstText(
    record.sourcePageUrl,
    record.source_page_url,
    record.profileUrl,
    metadata.sourcePageUrl,
    metadata.source_page_url,
    metadata.profileUrl,
    sourceMeta.sourcePageUrl,
    resourceId ? `https://hub.virtamate.com/resources/${encodeURIComponent(resourceId)}/` : ''
  )
  return {
    url: sourcePageUrl,
    title: firstText(record.title, record.name, metadata.title, metadata.name),
    resourceId
  }
}

export function normalizeVamHubShareItem(record = {}, context = {}, options = {}) {
  const metadata = readRecordMetadata(record)
  const sourceMeta = toObject(metadata.sourceMeta || metadata.source_meta)
  const installPayload = toObject(record.installPayload || metadata.installPayload)
  const rawFileName = firstText(
    record.fileName,
    record.file_name,
    record.option_name,
    metadata.fileName,
    metadata.file_name,
    installPayload.fileName,
    installPayload.archiveName,
    record.package_name
  )
  const parsed = parseVamPackage(rawFileName, record.version || metadata.version)
  const version = firstText(record.version, metadata.version, parsed.version)
  const sourceModKey = firstText(
    record.sourceModKey,
    metadata.sourceModKey,
    metadata.source_mod_key,
    metadata.packageName,
    metadata.package_name,
    sourceMeta.packageName,
    parsed.sourceModKey,
    record.source_mod_key
  )
  const packageName = firstText(
    record.packageName,
    record.package_name,
    metadata.packageName,
    metadata.package_name,
    sourceMeta.packageName,
    parsed.id,
    sourceModKey
  )
  const resourceId = firstText(
    record.resourceId,
    record.resource_id,
    record.modId,
    record.mod_id,
    metadata.resourceId,
    metadata.resource_id,
    sourceMeta.resourceId
  )
  const fileName = normalizeVarFileName(
    rawFileName || [sourceModKey, version].filter(Boolean).join('.')
  )
  if ((!resourceId && !packageName && !sourceModKey) || !fileName || !/\.var$/i.test(fileName)) {
    return null
  }

  const creator = firstText(
    record.creator,
    record.author,
    record.packageOwner,
    record.package_owner,
    metadata.creator,
    metadata.author,
    parsed.creator
  )
  const sourcePage = buildSourcePageInfo(record, metadata, resourceId)
  const identityMetadata = {
    resourceId,
    packageName,
    creator,
    version,
    fileName,
    resourceType: firstText(
      record.resourceType,
      record.resource_type,
      record.category,
      metadata.resourceType,
      metadata.resource_type,
      metadata.category
    ),
    sourcePageUrl: sourcePage.url,
    originalSourcePage: sourcePage,
    sourceGameId: firstText(context.sourceGameId, metadata.sourceGameId),
    sourceGameSlug: firstText(context.sourceGameSlug, metadata.sourceGameSlug),
    steamAppId: firstText(context.steamAppId, metadata.steamAppId),
    profileName: firstText(context.profileName, record.profile_name, metadata.profileName)
  }
  const local = resolveSourcePath(record, metadata)
  const includeLocalPaths = options.includeLocalPaths === true
  const installRule = toObject(
    record.installRule ||
      metadata.installRule ||
      metadata.sourceInstallRule ||
      installPayload.installRule ||
      installPayload.sourceInstallRule ||
      context.installRule
  )
  const offlineInstallPayload = {
    ...installPayload,
    source: 'vamhub',
    sourceType: 'vamhub',
    sourcePlatform: 'vamhub',
    sourceAdapter: 'vamhub',
    sourceGameId: identityMetadata.sourceGameId,
    sourceGameSlug: identityMetadata.sourceGameSlug,
    sourceModId: resourceId || packageName || sourceModKey,
    sourceModKey: sourceModKey || packageName,
    sourceFileId: firstText(record.option_id, record.sourceFileId, metadata.sourceFileId, fileName),
    modId: resourceId || packageName || sourceModKey,
    id: firstText(record.option_id, record.sourceFileId, metadata.sourceFileId, fileName),
    name: fileName,
    fileName,
    archiveName: fileName,
    version,
    packageName,
    resourceId,
    downloadUrl: '',
    profileName: identityMetadata.profileName,
    targetProfileName: identityMetadata.profileName,
    installRule,
    sourceInstallRule: installRule,
    metadata: {
      ...toObject(installPayload.metadata),
      ...identityMetadata
    }
  }

  return {
    sourcePlatform: 'vamhub',
    sourceGameId: identityMetadata.sourceGameId,
    sourceGameSlug: identityMetadata.sourceGameSlug,
    sourceModId: resourceId || packageName || sourceModKey,
    sourceFileId: firstText(record.option_id, record.sourceFileId, metadata.sourceFileId, fileName),
    sourceModKey: sourceModKey || packageName,
    name: firstText(
      record.displayName,
      record.display_name,
      record.name,
      metadata.modName,
      fileName
    ),
    displayName: firstText(
      record.displayName,
      record.display_name,
      record.name,
      metadata.modName,
      fileName
    ),
    version,
    fileName,
    packageName,
    resourceId,
    resourceType: identityMetadata.resourceType,
    downloadUrl: '',
    author: creator,
    sortIndex: toNumber(record.priority_order ?? record.priorityOrder, 0),
    ...(includeLocalPaths
      ? {
          sourcePath: local.sourcePath,
          archivePath: local.archivePath,
          stagingPath: local.stagingPath,
          filePath: local.sourcePath,
          installRoot: firstText(context.gameRoot, metadata.installRoot),
          installRule,
          sourceInstallRule: installRule,
          installPayload: offlineInstallPayload
        }
      : {}),
    metadata: {
      ...(includeLocalPaths ? metadata : {}),
      ...identityMetadata,
      ...(includeLocalPaths
        ? {
            sourcePath: local.sourcePath,
            sourceRoot: local.sourcePath,
            archivePath: local.archivePath,
            stagingPath: local.stagingPath,
            filePath: local.sourcePath,
            installRule,
            sourceInstallRule: installRule,
            installPayload: offlineInstallPayload
          }
        : {})
    }
  }
}

export function buildVamHubPreviewItem() {
  return {
    downloadUrl: '',
    status: 'pending',
    reason: uiText('ui.refreshingResourcesAndVersionsUsingStableVAMHubIdentities'),
    errorCode: '',
    canImport: false
  }
}

function resolveVamHubItemIdentity(item = {}) {
  const metadata = toObject(item.metadata)
  return {
    resourceId: firstText(metadata.resourceId, metadata.resource_id),
    packageName: firstText(
      metadata.packageName,
      metadata.package_name,
      item.sourceModKey,
      item.sourceModId
    ),
    fileName: normalizeVarFileName(
      firstText(metadata.fileName, metadata.file_name, item.sourceFileId)
    ),
    version: firstText(item.version, metadata.version)
  }
}

function resolveVamHubFiles(detail = {}) {
  return (Array.isArray(detail.hubFiles) ? detail.hubFiles : [])
    .map((file) => {
      const fileName = normalizeVarFileName(file.filename || file.fileName || file.name)
      const parsed = parseVamPackage(fileName, file.version)
      return {
        ...file,
        fileName,
        parsed,
        downloadUrl: firstText(file.downloadUrl, file.download_url, file.urlHosted)
      }
    })
    .filter((file) => file.fileName && /\.var$/i.test(file.fileName))
}

function loadDefaultVamHubApi() {
  return { getVamHubPackageDetail, resolveVamHubDownloadUrl }
}

export async function resolveVamHubPreviewItem(item = {}, _detail = {}, options = {}) {
  void _detail
  const identity = resolveVamHubItemIdentity(item)
  const packageIdentifier = firstText(identity.resourceId, identity.packageName)
  if (!packageIdentifier) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.MISSING_IDENTITY,
      '缺少 VAM-Hub resourceId 或 packageName'
    )
  }

  const api = options.vamhubApi || loadDefaultVamHubApi()
  let detail
  try {
    detail = await api.getVamHubPackageDetail({ packageName: packageIdentifier })
  } catch (error) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.RESOURCE_UNAVAILABLE,
      uiText('ui.vAMHubResourceWasRemovedOrIsInaccessibleValue', { value1: (toText(error?.message, packageIdentifier)) })
    )
  }

  const files = resolveVamHubFiles(detail)
  let selectedFile = identity.fileName
    ? files.find((file) => file.fileName.toLowerCase() === identity.fileName.toLowerCase())
    : null
  if (!selectedFile && identity.version) {
    selectedFile = files.find((file) => String(file.parsed.version) === String(identity.version))
  }
  if (!selectedFile && identity.version) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.VERSION_NOT_FOUND,
      uiText('ui.vAMHubVersionDoesNotExistValue', { value1: (identity.version) })
    )
  }
  selectedFile ||= files.find((file) => file.downloadUrl) || files[0]
  if (!selectedFile?.downloadUrl) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.DOWNLOAD_UNAVAILABLE,
      'VAM-Hub 当前资源没有可用的 .var 下载文件'
    )
  }

  const resolved = await api.resolveVamHubDownloadUrl({ downloadUrl: selectedFile.downloadUrl })
  const downloadUrl = toText(resolved?.downloadUrl)
  if (resolved?.success === false || !downloadUrl) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.DOWNLOAD_RESOLUTION_FAILED,
      toText(resolved?.message, 'VAM-Hub 下载地址解析失败，可能需要登录或资源已下架')
    )
  }

  const metadata = {
    ...toObject(item.metadata),
    resourceId: firstText(detail.resource_id, detail.resourceId, identity.resourceId),
    packageName: firstText(detail.packageName, identity.packageName, selectedFile.parsed.id),
    creator: firstText(detail.username, detail.author, selectedFile.parsed.creator),
    version: firstText(selectedFile.parsed.version, identity.version, detail.version_string),
    fileName: selectedFile.fileName,
    resourceType: firstText(detail.category, item.metadata?.resourceType),
    sourcePageUrl: firstText(
      item.metadata?.sourcePageUrl,
      detail.resource_id
        ? `https://hub.virtamate.com/resources/${encodeURIComponent(detail.resource_id)}/`
        : ''
    ),
    fileSize: toNumber(selectedFile.file_size_bytes ?? selectedFile.fileSize, 0)
  }

  return {
    downloadUrl,
    sourceModId: metadata.resourceId || item.sourceModId,
    sourceFileId: selectedFile.fileName,
    sourceModKey: firstText(selectedFile.parsed.sourceModKey, item.sourceModKey),
    name: firstText(item.name, detail.title, selectedFile.fileName),
    version: metadata.version,
    errorCode: '',
    metadata
  }
}

export function buildVamHubInstallEntry(item = {}, detail = {}, options = {}) {
  const metadata = toObject(item.metadata)
  const pack = detail?.modpack && typeof detail.modpack === 'object' ? detail.modpack : detail
  const sourceGameId = firstText(
    options.sourceGameId,
    metadata.sourceGameId,
    pack.sourceGameId,
    pack.source_game_id,
    'vam'
  )
  const sourceGameSlug = firstText(
    options.sourceGameSlug,
    metadata.sourceGameSlug,
    pack.sourceGameSlug,
    pack.source_game_slug,
    sourceGameId
  )
  const sourceModKey = firstText(item.sourceModKey, metadata.packageName, item.sourceModId)
  const sourceModId = firstText(item.sourceModId, metadata.resourceId, sourceModKey)
  const sourceFileId = firstText(item.sourceFileId, metadata.fileName, item.version)
  const fileName = normalizeVarFileName(firstText(metadata.fileName, sourceFileId, sourceModKey))
  const displayName = firstText(item.name, metadata.packageName, fileName, sourceModKey)
  const downloadUrl = toText(item.downloadUrl)
  if (!downloadUrl) {
    throw createVamHubError(
      VAMHUB_SOURCE_MODPACK_ERROR_CODES.DOWNLOAD_UNAVAILABLE,
      uiText('ui.vAMHubEntryHasNoRefreshedDownloadURLValue', { value1: (displayName) })
    )
  }
  const profileName = firstText(options.profileName, options.targetProfileName)
  const dependencyRole = firstText(options.dependencyRole, item.dependencyRole, 'main')
  const dependencyType = firstText(options.dependencyType, metadata.dependencyType)
  const installRule = toObject(options.installRule)
  const sourceMeta = {
    source: 'vamhub',
    sourceId: sourceGameId,
    sourceSlug: sourceGameSlug,
    sourceGameId,
    appId: toNumber(options.appId, 0),
    gameId: toNumber(options.gameId, 0),
    platformLabel: resolveSourcePlatformLabel('vamhub', 'VAM-Hub'),
    resourceId: firstText(metadata.resourceId, sourceModId),
    packageName: firstText(metadata.packageName, sourceModKey),
    fileName
  }
  const installPayload = {
    source: 'vamhub',
    sourceType: 'vamhub',
    sourcePlatform: 'vamhub',
    sourceAdapter: 'vamhub',
    sourceGameId,
    gameSourceId: sourceGameId,
    sourceGameSlug,
    gameSourceSlug: sourceGameSlug,
    sourceSlug: sourceGameSlug,
    sourceGameDomain: sourceGameSlug,
    gameSourceDomain: sourceGameSlug,
    appId: toNumber(options.appId, 0),
    appid: toNumber(options.appId, 0),
    gameId: toNumber(options.gameId, 0),
    gameName: toText(options.gameName),
    gameRoot: toText(options.gameRoot),
    gameRootPath: toText(options.gameRoot),
    clientRootPath: toText(options.gameRoot),
    sourceModKey,
    sourceModId,
    sourceFileId,
    modId: sourceModId,
    fileId: sourceFileId,
    modName: displayName,
    name: fileName,
    packageFolderName: sourceModKey || displayName,
    version: firstText(item.version, metadata.version),
    fileName,
    archiveName: fileName,
    fileSize: toNumber(metadata.fileSize, 0),
    downloadUrl,
    installType: 0,
    taskType: 0,
    usageType: 1,
    typeId: 0,
    cleanupSourceArchiveAfterInstall: true,
    dependencyRole,
    dependencyType,
    installRule,
    vamhubInstallRule: installRule,
    sourceInstallRule: installRule,
    sourceMeta,
    metadata: {
      ...metadata,
      source: 'vamhub',
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceMeta,
      fileName,
      packageName: sourceMeta.packageName,
      resourceId: sourceMeta.resourceId,
      dependencyRole,
      dependencyType,
      originItemKey: firstText(options.originItemKey, item.originItemKey),
      ...(profileName ? { profileName } : {})
    },
    ...(profileName ? { profileName, targetProfileName: profileName } : {})
  }

  return {
    item: {
      id: `vamhub:${sourceFileId}`,
      task_name: uiText('ui.vAMHubDownloadValue', { value1: (displayName) }),
      module: '游戏',
      file_type: 'var',
      file_size: toNumber(metadata.fileSize, 0),
      download_url: downloadUrl,
      saveType: 2,
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceGameId,
      sourceModKey,
      sourceModId,
      sourceFileId,
      name: displayName,
      version: firstText(item.version, metadata.version),
      fileName,
      dedupeKey: ['vamhub', sourceGameId, sourceModKey, item.version].filter(Boolean).join(':'),
      showOpenInDownloadList: true,
      fun: { type: 0 }
    },
    meta: {
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceGameId,
      sourceGameSlug,
      displayName,
      fileName,
      version: firstText(item.version, metadata.version),
      sortIndex: toNumber(item.sortIndex, 0),
      sourceMeta,
      dependencyRef: {
        dependencyRole,
        dependencyType,
        originItemKey: firstText(options.originItemKey, item.originItemKey)
      },
      artifactKey: ['vamhub', sourceGameId, sourceModKey, item.version].filter(Boolean).join(':'),
      installPayload
    }
  }
}

async function resolveVamHubDependencyItem(dependency = {}, detail = {}, context = {}) {
  const metadata = toObject(dependency.metadata)
  const fileName = normalizeVarFileName(
    firstText(dependency.filename, dependency.fileName, metadata.fileName)
  )
  const parsed = parseVamPackage(
    firstText(fileName, dependency.packageName, dependency.id),
    dependency.version
  )
  const item = {
    sourcePlatform: 'vamhub',
    sourceGameId: context.targetContext.sourceGameId,
    sourceGameSlug: context.targetContext.sourceGameSlug,
    sourceModId: firstText(
      dependency.resource_id,
      dependency.resourceId,
      dependency.modId,
      dependency.packageName,
      parsed.sourceModKey
    ),
    sourceFileId: firstText(fileName, dependency.sourceFileId, parsed.id),
    sourceModKey: firstText(dependency.sourceModKey, dependency.packageName, parsed.sourceModKey),
    name: firstText(dependency.displayName, dependency.title, dependency.packageName, fileName),
    version: firstText(dependency.version, parsed.version),
    dependencyRole: 'dependency',
    originItemKey: context.originItemKey,
    metadata: {
      ...metadata,
      resourceId: firstText(dependency.resource_id, dependency.resourceId, metadata.resourceId),
      packageName: firstText(dependency.packageName, parsed.id, metadata.packageName),
      fileName,
      version: firstText(dependency.version, parsed.version),
      dependencyType: firstText(dependency.dependencyType, dependency.licenseType),
      tier: toNumber(dependency.tier, 0),
      parentPackageId: firstText(dependency.parentPackageId, dependency.parent_package_id)
    }
  }
  const rawDownloadUrl = firstText(
    dependency.download_url,
    dependency.downloadUrl,
    dependency.urlHosted,
    dependency.latestUrl
  )
  let resolvedItem
  if (rawDownloadUrl) {
    const resolved = await context.vamhubApi.resolveVamHubDownloadUrl({
      downloadUrl: rawDownloadUrl
    })
    if (resolved?.success === false || !firstText(resolved?.downloadUrl, rawDownloadUrl)) {
      throw createVamHubError(
        VAMHUB_SOURCE_MODPACK_ERROR_CODES.DOWNLOAD_RESOLUTION_FAILED,
        uiText('ui.vAMHubDependencyDownloadURLIsUnavailableValue', { value1: (item.name || item.sourceModKey) })
      )
    }
    resolvedItem = {
      ...item,
      downloadUrl: firstText(resolved?.downloadUrl, rawDownloadUrl),
      metadata: {
        ...item.metadata,
        fileSize: toNumber(
          dependency.file_size_bytes ?? dependency.fileSize ?? metadata.fileSize,
          0
        )
      }
    }
  } else {
    const preview = await resolveVamHubPreviewItem(item, detail, {
      vamhubApi: context.vamhubApi
    })
    resolvedItem = {
      ...item,
      ...preview,
      dependencyRole: 'dependency',
      originItemKey: context.originItemKey,
      metadata: { ...item.metadata, ...toObject(preview.metadata) }
    }
  }
  const taskEntry = buildVamHubInstallEntry(resolvedItem, detail, {
    ...context.targetContext,
    dependencyRole: 'dependency',
    dependencyType: resolvedItem.metadata?.dependencyType,
    originItemKey: context.originItemKey
  })
  return taskEntryToCanonical(resolvedItem, taskEntry, context.targetContext, {
    dependencyRole: 'dependency',
    originItemKey: context.originItemKey
  })
}

export const vamhubSourceModpackAdapter = Object.freeze({
  sourcePlatform: 'vamhub',
  normalizeShareItem: normalizeVamHubShareItem,
  resolvePreviewItem: resolveVamHubPreviewItem,
  buildPreviewItem: buildVamHubPreviewItem,
  buildInstallEntry: buildVamHubInstallEntry,
  async resolveManifest({ detail, targetContext = {} } = {}) {
    const resolved = []
    const warnings = []
    const vamhubApi = targetContext.vamhubApi || {}
    if (typeof vamhubApi.getVamHubPackageDetail !== 'function' ||
        typeof vamhubApi.resolveVamHubDownloadUrl !== 'function' ||
        typeof vamhubApi.resolveVamHubDependencies !== 'function') {
      throw createVamHubError(
        VAMHUB_SOURCE_MODPACK_ERROR_CODES.DOWNLOAD_RESOLUTION_FAILED,
        'VAM-Hub 来源解析器未就绪'
      )
    }
    for (const item of getRemoteItems(detail, 'vamhub')) {
      const preview = await resolveVamHubPreviewItem(item, detail, {
        vamhubApi
      })
      const resolvedItem = {
        ...item,
        ...preview,
        metadata: { ...toObject(item.metadata), ...toObject(preview?.metadata) },
        downloadUrl: preview?.downloadUrl,
        canImport: true
      }
      const taskEntry = buildVamHubInstallEntry(resolvedItem, detail, targetContext)
      const mainItem = taskEntryToCanonical(resolvedItem, taskEntry, targetContext)
      resolved.push(mainItem)
      const dependencyResult = await vamhubApi.resolveVamHubDependencies({
        packageName: firstText(
          resolvedItem.metadata?.resourceId,
          resolvedItem.metadata?.packageName,
          resolvedItem.sourceModId,
          resolvedItem.sourceModKey
        ),
        gameRoot: targetContext.gameRoot,
        maxDepth: 3,
        includeSubDependencies: true
      })
      if (Array.isArray(dependencyResult?.warnings)) {
        warnings.push(...dependencyResult.warnings)
      }
      for (const dependency of Array.isArray(dependencyResult?.dependencies)
        ? dependencyResult.dependencies
        : []) {
        resolved.push(await resolveVamHubDependencyItem(dependency, detail, {
          vamhubApi,
          targetContext,
          originItemKey: mainItem.itemKey
        }))
      }
    }
    return { items: resolved, warnings }
  }
})

export const VamHubShareAdapter = vamhubSourceModpackAdapter
