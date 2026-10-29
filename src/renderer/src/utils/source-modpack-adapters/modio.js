import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import {
  getModioModDependencies,
  getModioModFile,
  getModioModFiles,
  resolveEffectiveModioApiConfig
} from '@renderer/utils/modio-api.js'

import { firstText, getRemoteItems, taskEntryToCanonical, toNumber, toObject } from './common.js'

function preferredFile(files = []) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => toNumber(file?.fileId || file?.id, 0) > 0)
    .sort((a, b) => toNumber(b?.dateAdded, 0) - toNumber(a?.dateAdded, 0))[0]
}

function identifiers(item = {}) {
  const metadata = toObject(item.metadata)
  const parts = String(item.sourceModKey || '').split(':')
  return {
    modId: toNumber(item.sourceModId || metadata.modId || parts[1], 0),
    fileId: toNumber(item.sourceFileId || metadata.fileId || parts[2], 0)
  }
}

async function resolveFile(gameId, modId, fileId, apiConfig) {
  if (fileId) return await getModioModFile(gameId, modId, fileId, apiConfig)
  const result = await getModioModFiles(gameId, modId, apiConfig, { limit: 20 })
  return preferredFile(result?.records || [])
}

function buildEntry(manifestItem, file, targetContext, extra = {}) {
  const gameId = toNumber(targetContext.sourceGameId || manifestItem.sourceGameId, 0)
  const modId = toNumber(extra.modId || manifestItem.sourceModId, 0)
  const fileId = toNumber(file?.fileId || file?.id, 0)
  const version = firstText(file?.version, manifestItem.version)
  const name = firstText(extra.name, manifestItem.name, uiText('ui.modIoModValue', { value1: (modId) }))
  const cover = firstText(extra.cover, manifestItem.cover, manifestItem.metadata?.cover)
  const installPayload = {
    source: 'modio', sourceType: 'modio', sourcePlatform: 'modio', sourceAdapter: 'modio',
    sourceGameId: String(gameId), modioGameId: gameId, appId: toNumber(targetContext.appId, 0),
    gameId: targetContext.localGameInstallationId, gameName: targetContext.gameName,
    gameRoot: targetContext.gameRoot, modId, fileId, id: fileId, modName: name,
    name: firstText(file?.name, name), version, fileSize: toNumber(file?.filesize, 0),
    cover, downloadUrl: firstText(file?.downloadUrl), sourceGameSlug: targetContext.sourceGameSlug,
    sourceModKey: `modio:${modId}:${fileId}`, profileId: targetContext.profileId,
    profileName: targetContext.profileName, targetProfileName: targetContext.profileName,
    endpointType: targetContext.endpointType, cleanupSourceArchiveAfterInstall: true,
    fileMd5: firstText(file?.filehash), dependencies: extra.dependencies || [],
    dependencyRole: extra.dependencyRole || 'main', installRule: targetContext.installRule || {},
    modioInstallRule: targetContext.installRule || {}, sourceInstallRule: targetContext.installRule || {},
    metadata: { ...toObject(manifestItem.metadata), cover, dependencyRole: extra.dependencyRole || 'main' }
  }
  return taskEntryToCanonical(manifestItem, {
    item: {
      sourcePlatform: 'modio', sourceGameId: String(gameId), sourceModId: String(modId),
      sourceFileId: String(fileId), sourceModKey: installPayload.sourceModKey,
      download_url: installPayload.downloadUrl, file_size: installPayload.fileSize,
      preferredFileName: firstText(file?.name), version
    },
    meta: { sourcePlatform: 'modio', displayName: name, version, installPayload }
  }, targetContext, extra)
}

async function resolveModioManifest({ detail, targetContext }) {
  const roots = getRemoteItems(detail, 'modio')
  const gameId = toNumber(targetContext.sourceGameId || roots[0]?.sourceGameId, 0)
  if (!gameId) throw new Error(uiText('ui.modIoGameIdentifierIsMissing'))
  const apiConfig = resolveEffectiveModioApiConfig(targetContext.modioApiConfig || {})
  const resolved = new Map()
  const visiting = new Set()
  const pinnedRoots = new Map(roots.map((item) => [identifiers(item).modId, item]))

  async function visit(manifestItem, originItemKey = '', role = 'main') {
    const pinned = pinnedRoots.get(identifiers(manifestItem).modId)
    if (pinned) {
      manifestItem = pinned
      role = 'main'
      originItemKey = ''
    }
    const { modId, fileId } = identifiers(manifestItem)
    if (!modId || visiting.has(modId)) return
    const key = String(modId)
    if (resolved.has(key)) return
    visiting.add(modId)
    const file = await resolveFile(gameId, modId, fileId, apiConfig)
    if (!file?.downloadUrl) throw new Error(uiText('ui.noModIoDownloadURLWasReturnedValue', { value1: (modId) }))
    const dependencyResult = await getModioModDependencies(gameId, modId, apiConfig)
    const dependencyRefs = []
    for (const dependency of dependencyResult?.records || []) {
      const dependencyModId = toNumber(dependency?.modId, 0)
      if (!dependencyModId) continue
      dependencyRefs.push({
        source: 'modio', sourceModKey: `modio:${dependencyModId}`,
        modId: dependencyModId, fileId: toNumber(dependency?.fileId || dependency?.file_id, 0),
        name: firstText(dependency?.name, `Mod.io 依赖-${dependencyModId}`),
        version: firstText(dependency?.version), dependencyRole: 'required'
      })
      await visit({
        sourcePlatform: 'modio', sourceGameId: String(gameId), sourceModId: String(dependencyModId),
        sourceFileId: String(dependency?.fileId || dependency?.file_id || ''),
        sourceModKey: `modio:${dependencyModId}`, name: dependency?.name,
        version: dependency?.version, cover: dependency?.pictureUrl, metadata: {}
      }, originItemKey || `modio:${gameId}:${modId}`, 'required')
    }
    resolved.set(key, buildEntry(manifestItem, file, targetContext, {
      modId, dependencies: dependencyRefs, dependencyRole: role,
      originItemKey: originItemKey || `modio:${gameId}:${modId}`
    }))
    visiting.delete(modId)
  }
  for (const root of roots) await visit(root)
  return [...resolved.values()]
}

export const ModioShareAdapter = Object.freeze({
  sourcePlatform: 'modio',
  resolveManifest: resolveModioManifest
})

