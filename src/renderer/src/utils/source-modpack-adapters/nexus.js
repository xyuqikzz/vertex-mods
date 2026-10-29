import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { getNexusModFiles, getNexusModInfo } from '@renderer/utils/nexus-api.js'
import {
  buildDefaultDependencyBatchEntries,
  buildNexusFileBatchEntry,
  normalizeNexusModFiles
} from '@views/game/nexus/nexus-service.js'
import { firstText, getRemoteItems, taskEntryToCanonical, toNumber, toObject } from './common.js'

function identifiers(item = {}, target = {}) {
  const metadata = toObject(item.metadata)
  const parts = String(item.sourceModKey || '').split(':')
  const nexusIndex = parts.findIndex((part) => part === 'nexus')
  return {
    modId: toNumber(item.sourceModId || metadata.modId || parts[nexusIndex >= 0 ? nexusIndex + 1 : 0], 0),
    fileId: toNumber(item.sourceFileId || metadata.fileId || parts[nexusIndex >= 0 ? nexusIndex + 2 : 1], 0),
    domainName: firstText(
      item.sourceGameSlug,
      metadata.sourceGameDomain,
      metadata.domainName,
      target.sourceGameSlug,
      target.gameBaseInfo?.domainName
    )
  }
}

function getManualArtifact(targetContext = {}, identity = {}) {
  const domainName = firstText(identity.domainName).toLowerCase()
  return (Array.isArray(targetContext.manualResolvedItems)
    ? targetContext.manualResolvedItems
    : []
  ).find((item) => {
    const metadata = toObject(item.metadata)
    return (
      toNumber(item.sourceModId || metadata.modId, 0) === toNumber(identity.modId, 0) &&
      toNumber(item.sourceFileId || metadata.fileId, 0) === toNumber(identity.fileId, 0) &&
      firstText(
        item.sourceGameSlug,
        metadata.domainName,
        metadata.gameDomain,
        metadata.sourceGameDomain
      ).toLowerCase() === domainName
    )
  })
}

function getManualArtifactLocation(artifact = {}) {
  const metadata = toObject(artifact.metadata)
  return {
    downloadUrl: firstText(artifact.downloadUrl, artifact.download_url, metadata.downloadUrl),
    localFilePath: firstText(
      artifact.localFilePath,
      artifact.localPath,
      artifact.filePath,
      metadata.localPath,
      metadata.filePath
    )
  }
}

async function resolveNexusManifestItem({ manifestItem, targetContext }) {
  const identity = identifiers(manifestItem, targetContext)
  const { modId, fileId, domainName } = identity
  if (!modId || !fileId || !domainName) throw new Error(uiText('ui.nexusGameModOrFileIdentifierIsMissing'))
  const [modInfo, filesResult] = await Promise.all([
    getNexusModInfo(domainName, modId, targetContext.nexusApiConfig || {}).catch(() => ({
      modId,
      domainName,
      name: manifestItem.name || `Nexus 模组-${modId}`,
      pictureUrl: manifestItem.cover || manifestItem.metadata?.cover || '',
      summary: manifestItem.description || manifestItem.metadata?.description || ''
    })),
    getNexusModFiles(domainName, modId, targetContext.nexusApiConfig || {})
  ])
  const targetFile = normalizeNexusModFiles(filesResult?.files || []).find(
    (file) => toNumber(file?.fileId || file?.id, 0) === fileId
  )
  if (!targetFile) throw new Error(uiText('ui.nexusFileNotFoundValue', { value1: (fileId) }))
  const manualArtifact = getManualArtifact(targetContext, identity)
  const manualLocation = getManualArtifactLocation(manualArtifact)
  const entryInput = {
    mod: { ...modInfo, modId, domainName },
    file: targetFile,
    fallbackDomainName: domainName,
    apiConfig: targetContext.nexusApiConfig || {},
    currentNexusRule: targetContext.currentNexusRule || {},
    detectedRootPath: targetContext.gameRoot,
    resolvedNexusAppId: targetContext.appId || targetContext.resolvedNexusAppId,
    gameBaseInfo: targetContext.gameBaseInfo || { domainName },
    installRule: targetContext.installRule || {},
    sortIndex: 10000 + toNumber(manifestItem.sortIndex, 0),
    profileId: targetContext.profileId,
    profileName: targetContext.profileName,
    downloadUrl: manualLocation.downloadUrl,
    localFilePath: manualLocation.localFilePath,
    manualDownload: !!manualArtifact
  }
  const entry = await buildNexusFileBatchEntry(entryInput)
  return { item: taskEntryToCanonical(manifestItem, entry, targetContext), manualAction: null }
}

async function resolveNexusManifest({ detail, targetContext }) {
  const manifestItems = getRemoteItems(detail, 'nexus')
  const resolved = []
  const manualActions = []
  const defaultEntries = await buildDefaultDependencyBatchEntries({
    currentNexusRule: targetContext.currentNexusRule || {},
    gameBaseInfo: targetContext.gameBaseInfo || {},
    detectedRootPath: targetContext.gameRoot,
    resolvedNexusAppId: targetContext.appId || targetContext.resolvedNexusAppId,
    systemConfig: targetContext.systemConfig || {},
    apiConfig: targetContext.nexusApiConfig || {},
    installedSourceModKeys: new Set(),
    startSortIndex: 0,
    profileId: targetContext.profileId,
    profileName: targetContext.profileName,
    installRule: targetContext.installRule || {},
    allowManualDownload: true,
    manualResolvedDependencies: targetContext.manualResolvedItems || []
  })
  for (const entry of defaultEntries) {
    const canonicalItem = taskEntryToCanonical({}, entry, targetContext, {
        dependencyRole: 'default_dependency',
        originItemKey: entry.meta?.dependencyRef?.sourceModKey || 'nexus:default-dependency'
      })
    resolved.push(canonicalItem)
  }
  for (const manifestItem of manifestItems) {
    const result = await resolveNexusManifestItem({ manifestItem, targetContext })
    resolved.push(result.item)
    if (result.manualAction) manualActions.push(result.manualAction)
  }
  return { items: resolved, manualActions }
}

export const NexusShareAdapter = Object.freeze({
  sourcePlatform: 'nexus',
  resolveManifestItem: resolveNexusManifestItem,
  resolveManifest: resolveNexusManifest
})
