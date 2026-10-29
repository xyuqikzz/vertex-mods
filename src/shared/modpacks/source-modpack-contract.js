import SHA256 from 'crypto-js/sha256.js'
import Hex from 'crypto-js/enc-hex.js'

const PRESENTATION_ONLY_KEYS = new Set([
  'cover',
  'coverImage',
  'description',
  'icon',
  'iconUrl',
  'imageUrl',
  'logo',
  'logoUrl',
  'name',
  'pictureUrl',
  'profileName',
  'targetProfileName',
  'title'
])

function toText(value = '') {
  return String(value ?? '').trim()
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

function normalizeSource(value = '') {
  const source = toText(value).toLowerCase()
  return source === 'mod.io' ? 'modio' : source
}

function normalizePath(value = '') {
  const path = toText(value).replace(/\//g, '\\')
  if (!path) return ''
  const rootMatch = path.match(/^[a-z]:\\$/i)
  return rootMatch ? path.toLowerCase() : path.replace(/\\+$/g, '').toLowerCase()
}

function normalizeForJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForJson)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      const item = value[key]
      if (item !== undefined) result[key] = normalizeForJson(item)
      return result
    }, {})
}

export function stableSourceModpackStringify(value) {
  return JSON.stringify(normalizeForJson(value))
}

export function hashSourceModpackValue(value) {
  return SHA256(stableSourceModpackStringify(value)).toString(Hex)
}

function stripPresentationFields(value) {
  if (Array.isArray(value)) return value.map(stripPresentationFields)
  if (!value || typeof value !== 'object') return value
  return Object.entries(value).reduce((result, [key, item]) => {
    if (PRESENTATION_ONLY_KEYS.has(key)) return result
    result[key] = stripPresentationFields(item)
    return result
  }, {})
}

function stripDownloadLocations(value) {
  if (Array.isArray(value)) return value.map(stripDownloadLocations)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['downloadUrl', 'download_url', 'localFilePath', 'localPath', 'filePath'].includes(key))
    .map(([key, item]) => [key, stripDownloadLocations(item)]))
}

export function resolveCanonicalCover(item = {}) {
  const metadata = toObject(item.metadata || item.metadataJson || item.metadata_json)
  return firstText(
    item.cover,
    item.pictureUrl,
    item.picture_url,
    item.imageUrl,
    item.image_url,
    item.logo,
    item.icon,
    metadata.cover,
    metadata.coverImage,
    metadata.cover_image,
    metadata.pictureUrl,
    metadata.picture_url,
    metadata.imageUrl,
    metadata.image_url,
    metadata.logo,
    metadata.logoUrl,
    metadata.logo_url,
    metadata.icon,
    metadata.iconUrl,
    metadata.icon_url
  )
}

function stripKnownPrefix(value = '', source = '') {
  const text = toText(value)
  const prefix = `${source}:`
  return text.toLowerCase().startsWith(prefix) ? text.slice(prefix.length) : text
}

function resolveThunderstoreFullName(item = {}, metadata = {}) {
  const candidate = firstText(
    item.packageFullName,
    item.fullName,
    metadata.packageFullName,
    metadata.fullName,
    item.sourceModKey,
    item.sourceModId
  )
  const parts = candidate.split(':').filter(Boolean)
  return parts.at(-1) || candidate
}

export function buildCanonicalItemKey(item = {}) {
  const metadata = toObject(item.metadata || item.metadataJson || item.metadata_json)
  const source = normalizeSource(item.sourcePlatform || item.sourceType || item.source)
  const sourceGameId = firstText(
    item.sourceGameId,
    item.source_game_id,
    item.sourceGameSlug,
    item.source_game_slug,
    metadata.sourceGameId,
    metadata.sourceGameSlug,
    metadata.community
  ).toLowerCase()
  const sourceModId = firstText(
    item.sourceModId,
    item.source_mod_id,
    item.sourceModKey,
    item.source_mod_key,
    metadata.sourceModId,
    metadata.sourceModKey,
    metadata.modReference,
    metadata.resourceId,
    metadata.packageName
  )

  if (source === 'thunderstore') {
    return [source, sourceGameId, resolveThunderstoreFullName(item, metadata).toLowerCase()]
      .filter(Boolean)
      .join(':')
  }
  if (source === 'vamhub') {
    const identity = firstText(
      metadata.resourceId,
      item.resourceId,
      metadata.packageName,
      stripKnownPrefix(sourceModId, source)
    )
    return [source, sourceGameId, identity.toLowerCase()].filter(Boolean).join(':')
  }
  if (source === 'ficsit') {
    return [source, sourceGameId, stripKnownPrefix(sourceModId, source).toLowerCase()]
      .filter(Boolean)
      .join(':')
  }
  return [source, sourceGameId, stripKnownPrefix(sourceModId, source).toLowerCase()]
    .filter(Boolean)
    .join(':')
}

export function normalizeCanonicalTargetContext(targetContext = {}) {
  const target = toObject(targetContext)
  return {
    localGameInstallationId: toNumber(
      target.localGameInstallationId ?? target.localGameId ?? target.gameRecordId,
      0
    ),
    gameRoot: toText(target.gameRoot || target.gameRootPath || target.clientRootPath),
    endpointType: toNumber(target.endpointType ?? target.endpoint_type, 0),
    profileId: firstText(target.profileId, target.profile_id, target.configProfileId),
    profileName: firstText(target.profileName, target.profile_name, target.targetProfileName),
    installRule: toObject(target.installRule || target.sourceInstallRule),
    sourcePlatform: normalizeSource(target.sourcePlatform || target.source),
    sourceGameId: firstText(target.sourceGameId, target.source_game_id),
    sourceGameSlug: firstText(target.sourceGameSlug, target.source_game_slug),
    instanceSlot: firstText(target.instanceSlot, target.instance_slot, 'default')
  }
}

function normalizeDependencies(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return toText(item)
      if (!item || typeof item !== 'object') return ''
      return firstText(item.itemKey, item.sourceModKey, item.sourceModId, item.dependencyKey)
    })
    .filter(Boolean)
    .sort()
}

function normalizeDownload(item = {}, metadata = {}) {
  const download = toObject(item.download)
  return {
    url: firstText(download.url, item.downloadUrl, item.download_url, metadata.downloadUrl),
    fileName: firstText(download.fileName, item.fileName, item.file_name, metadata.fileName),
    fileSize: toNumber(download.fileSize ?? item.fileSize ?? item.file_size ?? metadata.fileSize, 0),
    checksum: firstText(
      download.checksum,
      item.checksum,
      item.sha256,
      item.fileMd5,
      item.file_md5,
      metadata.sha256,
      metadata.fileMd5
    )
  }
}

export function normalizeCanonicalInstallEntry(item = {}, targetContext = {}) {
  const metadata = toObject(item.metadata || item.metadataJson || item.metadata_json)
  const target = normalizeCanonicalTargetContext({
    ...targetContext,
    ...(item.targetContext && typeof item.targetContext === 'object' ? item.targetContext : {})
  })
  const sourcePlatform = normalizeSource(
    item.sourcePlatform || item.sourceType || item.source || metadata.sourcePlatform
  )
  const sourceGameId = firstText(
    item.sourceGameId,
    item.source_game_id,
    metadata.sourceGameId,
    target.sourceGameId
  )
  const sourceGameSlug = firstText(
    item.sourceGameSlug,
    item.source_game_slug,
    item.sourceGameDomain,
    metadata.sourceGameSlug,
    metadata.sourceGameDomain,
    target.sourceGameSlug
  )
  const sourceModId = firstText(
    item.sourceModId,
    item.source_mod_id,
    metadata.sourceModId,
    metadata.modId,
    item.sourceModKey
  )
  const sourceFileId = firstText(
    item.sourceFileId,
    item.source_file_id,
    metadata.sourceFileId,
    metadata.fileId,
    item.version
  )
  const sourceModKey = firstText(
    item.sourceModKey,
    item.source_mod_key,
    metadata.sourceModKey,
    sourceModId
  )
  const cover = resolveCanonicalCover(item)
  const description = firstText(
    item.description,
    item.summary,
    metadata.description,
    metadata.summary,
    metadata.shortDescription,
    metadata.fullDescription
  )
  const dependencyRole = firstText(
    item.dependencyRole,
    item.dependency_role,
    metadata.dependencyRole,
    'main'
  ).toLowerCase()
  const itemKey = buildCanonicalItemKey({
    ...item,
    metadata,
    sourcePlatform,
    sourceGameId,
    sourceGameSlug,
    sourceModId,
    sourceModKey
  })
  const installRule = toObject(item.installRule || item.sourceInstallRule || target.installRule)
  const installPayloadSource = toObject(item.installPayload || metadata.installPayload)
  const installPayload = {
    ...installPayloadSource,
    ruleSelection: firstText(installPayloadSource.ruleSelection, 'public'),
    sharedRuleDocument: installPayloadSource.sharedRuleDocument || null,
    sourcePlatform,
    sourceType: sourcePlatform,
    sourceGameId,
    sourceGameSlug,
    sourceModId,
    sourceFileId,
    sourceModKey,
    cover,
    description,
    localGameInstallationId: target.localGameInstallationId,
    gameRoot: target.gameRoot,
    endpointType: target.endpointType,
    profileId: target.profileId,
    profileName: target.profileName,
    targetProfileName: target.profileName,
    installRule,
    metadata: {
      ...toObject(installPayloadSource.metadata),
      ...metadata,
      cover,
      description,
      profileId: target.profileId,
      profileName: target.profileName
    }
  }
  const normalized = {
    itemKey,
    originItemKey: firstText(item.originItemKey, item.origin_item_key, itemKey),
    dependencyRole,
    sourcePlatform,
    sourceGameId,
    sourceGameSlug,
    sourceModId,
    sourceFileId,
    sourceModKey,
    name: firstText(item.name, item.modName, metadata.name, sourceModKey),
    version: firstText(item.version, metadata.version, sourceFileId),
    cover,
    description,
    dependencies: normalizeDependencies(item.dependencies || metadata.dependencies),
    download: normalizeDownload(item, metadata),
    localGameInstallationId: target.localGameInstallationId,
    gameRoot: target.gameRoot,
    endpointType: target.endpointType,
    profileId: target.profileId,
    profileName: target.profileName,
    installRule,
    installPayload
  }
  normalized.canonicalItemHash = hashSourceModpackValue({
    itemKey: normalized.itemKey,
    originItemKey: normalized.originItemKey,
    dependencyRole: normalized.dependencyRole,
    sourcePlatform: normalized.sourcePlatform,
    sourceGameId: normalized.sourceGameId,
    sourceGameSlug: normalized.sourceGameSlug,
    sourceModId: normalized.sourceModId,
    sourceFileId: normalized.sourceFileId,
    sourceModKey: normalized.sourceModKey,
    version: normalized.version,
    dependencies: normalized.dependencies,
    // 固定来源文件的临时下载地址不代表内容版本；文件标识、校验和仍参与比较。
    download: { ...normalized.download, url: sourceFileId ? '' : normalized.download.url },
    localGameInstallationId: normalized.localGameInstallationId,
    gameRoot: normalizePath(normalized.gameRoot),
    endpointType: normalized.endpointType,
    profileId: normalized.profileId,
    installRule: normalized.installRule,
    installPayload: stripPresentationFields(sourceFileId
      ? stripDownloadLocations(normalized.installPayload)
      : normalized.installPayload)
  })
  return normalized
}

export function normalizeRemoteSourceModpack(detail = {}) {
  const data = toObject(detail)
  const pack = toObject(data.pack || data.modpack || data.sourceModpack || data.data || data)
  return {
    id: toNumber(pack.id || pack.sourceModpackId || pack.source_modpack_id, 0),
    packUid: firstText(pack.packUid, pack.pack_uid, pack.uid),
    shareCode: firstText(pack.shareCode, pack.share_code, pack.code),
    name: firstText(pack.name, pack.title),
    versionName: firstText(pack.versionName, pack.version_name, pack.version),
    revision: Math.max(1, toNumber(pack.currentRevision ?? pack.current_revision ?? pack.revision, 1)),
    manifestHash: firstText(
      pack.installManifestHash,
      pack.install_manifest_hash,
      pack.manifestHash,
      pack.manifest_hash
    ),
    presentationHash: firstText(pack.presentationHash, pack.presentation_hash),
    sourceType: normalizeSource(pack.sourceType || pack.source_type),
    sourceGameId: firstText(pack.sourceGameId, pack.source_game_id),
    sourceGameSlug: firstText(pack.sourceGameSlug, pack.source_game_slug),
    published: pack.isPublished ?? pack.is_published ?? pack.published ?? true,
    deleted: pack.isDeleted ?? pack.is_deleted ?? pack.deleted ?? false
  }
}

export function buildCanonicalInstallPlan({ remote = {}, targetContext = {}, resolvedItems = [] } = {}) {
  const normalizedRemote = normalizeRemoteSourceModpack(remote)
  const target = normalizeCanonicalTargetContext(targetContext)
  const items = (Array.isArray(resolvedItems) ? resolvedItems : [])
    .map((item) => normalizeCanonicalInstallEntry(item, {
      ...target,
      ...(item.localGameInstallationId ? {
        localGameInstallationId: item.localGameInstallationId,
        gameRoot: item.gameRoot,
        endpointType: item.endpointType,
        profileId: item.profileId,
        profileName: item.profileName,
        installRule: item.installRule
      } : {})
    }))
  const hashInput = {
    packUid: normalizedRemote.packUid,
    revision: normalizedRemote.revision,
    manifestHash: normalizedRemote.manifestHash,
    target: {
      localGameInstallationId: target.localGameInstallationId,
      gameRoot: normalizePath(target.gameRoot),
      endpointType: target.endpointType,
      profileId: target.profileId,
      instanceSlot: target.instanceSlot
    },
    // 执行顺序保留依赖解析结果，只有哈希输入按稳定身份排序。
    items: [...items].sort((left, right) =>
      [left.itemKey, left.dependencyRole, left.originItemKey].join('|')
        .localeCompare([right.itemKey, right.dependencyRole, right.originItemKey].join('|'))
    ).map((item) => ({
      itemKey: item.itemKey,
      originItemKey: item.originItemKey,
      dependencyRole: item.dependencyRole,
      canonicalItemHash: item.canonicalItemHash
    }))
  }
  return {
    remote: normalizedRemote,
    targetContext: target,
    items,
    canonicalPlanHash: hashSourceModpackValue(hashInput)
  }
}

export function rebuildSourceModpackSnapshotHashes(snapshots = [], historicalPlans = []) {
  const historicalItems = new Map()
  for (const plan of historicalPlans) {
    for (const item of plan?.canonicalPlan?.items || []) {
      if (item.canonicalItemHash && !historicalItems.has(item.canonicalItemHash)) {
        historicalItems.set(item.canonicalItemHash, item)
      }
    }
  }
  return snapshots.map((snapshot) => {
    const historical = historicalItems.get(snapshot.installedItemHash || snapshot.canonicalItemHash)
    if (!historical || historical.itemKey !== snapshot.itemKey) return snapshot
    // 只重算与已安装哈希完全匹配的历史快照，不能用远程新数据替代本地安装证据。
    const normalized = normalizeCanonicalInstallEntry(historical, historical)
    if (normalized.itemKey !== snapshot.itemKey) return snapshot
    return { ...snapshot, installedItemHash: normalized.canonicalItemHash }
  })
}

