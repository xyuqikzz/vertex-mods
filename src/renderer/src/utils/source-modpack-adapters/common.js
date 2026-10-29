import { normalizeCanonicalInstallEntry } from '../../../../shared/modpacks/source-modpack-contract.js'

export function toText(value = '') {
  return String(value ?? '').trim()
}

export function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toObject(value) {
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

export function firstText(...values) {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ''
}

export function getRemotePack(detail = {}) {
  const source = toObject(detail)
  return toObject(source.pack || source.modpack || source.sourceModpack || source.data || source)
}

export function getRemoteItems(detail = {}, sourcePlatform = '') {
  const source = toObject(detail)
  const pack = getRemotePack(detail)
  const fallbackSource = toText(pack.sourceType || pack.source_type).toLowerCase()
  return (Array.isArray(source.items) ? source.items : [])
    .map((item, index) => {
      const metadata = toObject(item.metadata || item.metadata_json || item.metadataJson)
      const source = firstText(
        item.sourcePlatform,
        item.source_platform,
        item.sourceType,
        item.source_type,
        metadata.sourcePlatform,
        fallbackSource === 'mixed' ? '' : fallbackSource
      ).toLowerCase()
      return {
        ...item,
        sourcePlatform: source === 'mod.io' ? 'modio' : source,
        sourceGameId: firstText(
          item.sourceGameId,
          item.source_game_id,
          metadata.sourceGameId,
          pack.sourceGameId,
          pack.source_game_id
        ),
        sourceGameSlug: firstText(
          item.sourceGameSlug,
          item.source_game_slug,
          metadata.sourceGameSlug,
          metadata.sourceGameDomain,
          pack.sourceGameSlug,
          pack.source_game_slug
        ),
        sourceModId: firstText(item.sourceModId, item.source_mod_id, metadata.sourceModId),
        sourceFileId: firstText(item.sourceFileId, item.source_file_id, metadata.sourceFileId),
        sourceModKey: firstText(item.sourceModKey, item.source_mod_key, metadata.sourceModKey),
        metadata,
        sortIndex: toNumber(item.sortIndex ?? item.sort_index ?? metadata.sortIndex, index)
      }
    })
    .filter((item) => !sourcePlatform || item.sourcePlatform === sourcePlatform)
}

export function taskEntryToCanonical(manifestItem = {}, taskEntry = {}, targetContext = {}, extra = {}) {
  const item = toObject(taskEntry.item)
  const meta = toObject(taskEntry.meta)
  const installPayload = toObject(meta.installPayload || taskEntry.installPayload)
  const sourcePlatform = firstText(extra.sourcePlatform, manifestItem.sourcePlatform, meta.sourcePlatform)
  const receiverRule = {
    nexus: targetContext.currentNexusRule,
    modio: targetContext.currentModioRule,
    ficsit: targetContext.currentFicsitRule
  }[sourcePlatform] || {}
  const ruleSelection = firstText(targetContext.ruleSelection, receiverRule.sourceType)
  const metadata = {
    ...toObject(manifestItem.metadata),
    ...toObject(installPayload.metadata)
  }
  return normalizeCanonicalInstallEntry(
    {
      ...manifestItem,
      ...extra,
      sourcePlatform,
      sourceGameId: firstText(
        extra.sourceGameId,
        manifestItem.sourceGameId,
        meta.sourceGameId,
        item.sourceGameId,
        installPayload.sourceGameId
      ),
      sourceGameSlug: firstText(
        extra.sourceGameSlug,
        manifestItem.sourceGameSlug,
        meta.sourceGameSlug,
        installPayload.sourceGameSlug,
        installPayload.sourceGameDomain
      ),
      sourceModId: firstText(
        extra.sourceModId,
        manifestItem.sourceModId,
        item.sourceModId,
        installPayload.sourceModId,
        installPayload.modId
      ),
      sourceFileId: firstText(
        extra.sourceFileId,
        manifestItem.sourceFileId,
        item.sourceFileId,
        installPayload.sourceFileId,
        installPayload.fileId,
        installPayload.id
      ),
      sourceModKey: firstText(
        extra.sourceModKey,
        manifestItem.sourceModKey,
        installPayload.sourceModKey,
        item.sourceModKey
      ),
      name: firstText(extra.name, manifestItem.name, meta.displayName, installPayload.modName),
      version: firstText(extra.version, manifestItem.version, meta.version, item.version, installPayload.version),
      cover: firstText(extra.cover, installPayload.cover, manifestItem.cover, metadata.cover),
      description: firstText(
        extra.description,
        installPayload.description,
        manifestItem.description,
        metadata.description
      ),
      dependencies: extra.dependencies || installPayload.dependencies || manifestItem.dependencies || [],
      download: {
        url: firstText(extra.downloadUrl, item.download_url, installPayload.downloadUrl),
        fileName: firstText(extra.fileName, item.preferredFileName, item.file_name, meta.fileName),
        fileSize: toNumber(extra.fileSize ?? item.file_size ?? installPayload.fileSize, 0),
        checksum: firstText(extra.checksum, installPayload.sha256, installPayload.fileMd5)
      },
      dependencyRole: firstText(extra.dependencyRole, installPayload.dependencyRole, 'main'),
      originItemKey: firstText(extra.originItemKey, manifestItem.originItemKey),
      metadata,
      installRule: targetContext.installRule,
      installPayload: {
        ...installPayload,
        // 安装规则选择属于下载者的环境，不能由分享元数据指定。
        ruleSelection: ['local_override', 'player_profile', 'local', 'player'].includes(ruleSelection)
          ? 'local_override' : 'public',
        sharedRuleDocument: targetContext.sharedRuleDocument || receiverRule.sharedRuleDocument || null,
        cover: firstText(extra.cover, installPayload.cover, manifestItem.cover, metadata.cover),
        description: firstText(
          extra.description,
          installPayload.description,
          manifestItem.description,
          metadata.description
        )
      }
    },
    targetContext
  )
}

