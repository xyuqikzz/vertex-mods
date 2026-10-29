import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { getFicsitModVersions } from '@renderer/utils/ficsit-api.js'
import { prepareFicsitInstallPlan } from '@views/game/ficsit/ficsit-service.js'

import { firstText, getRemoteItems, taskEntryToCanonical, toNumber, toObject } from './common.js'

function normalizeDownloadUrl(value = '') {
  try {
    return new URL(String(value || ''), 'https://api.ficsit.app').toString()
  } catch {
    return ''
  }
}

async function resolveFicsitManifest({ detail, targetContext }) {
  const roots = getRemoteItems(detail, 'ficsit')
  const pinnedRoots = new Map(roots.map((root) => [firstText(root.sourceModKey, root.sourceModId).toLowerCase(), root]))
  const result = new Map()
  for (const root of roots) {
    const metadata = toObject(root.metadata)
    const modReference = firstText(root.sourceModKey, root.sourceModId, metadata.modReference)
    const mod = await getFicsitModVersions(modReference)
    const versions = Array.isArray(mod?.versions) ? mod.versions : []
    const fileId = firstText(root.sourceFileId)
    const versionName = firstText(root.version)
    const targetVersion = fileId && fileId !== versionName
      ? versions.find((version) => fileId === firstText(version?.id))
      : versionName ? versions.find((version) => versionName === firstText(version?.version)) : null
    if (!targetVersion?.link) throw new Error(uiText('ui.theSharedVersionOfValueIsUnavailableValue', { value1: (modReference), value2: (versionName || fileId || uiText('ui.noVersionSpecifiedVariant2')) }))
    const planResult = await prepareFicsitInstallPlan({
      appId: toNumber(targetContext.appId || targetContext.sourceGameId, 526870),
      gameId: toNumber(targetContext.backendGameId || targetContext.localGameInstallationId, 0),
      executableFile: firstText(targetContext.executableFile, 'FactoryGame.exe'),
      modId: toNumber(mod?.id || metadata.modId, 0), modReference,
      name: firstText(mod?.name, root.name, modReference),
      version: firstText(targetVersion?.version, root.version),
      downloadUrl: normalizeDownloadUrl(targetVersion?.link),
      logo: firstText(mod?.logo, root.cover, metadata.logo),
      sourceInstallRule: targetContext.installRule || {}
    })
    if (!planResult?.success) throw new Error(planResult?.message || uiText('ui.couldNotCreateAnInstallationPlanForValue', { value1: (modReference) }))
    for (const planItem of planResult.installPlan || []) {
      const reference = firstText(planItem?.modReference, modReference)
      const version = firstText(planItem?.version)
      const versionId = firstText(planItem?.versionId, version)
      const dependencies = Array.isArray(planItem?.dependencies) ? planItem.dependencies : []
      const pinnedRoot = pinnedRoots.get(reference.toLowerCase())
      if ((reference === modReference && version !== firstText(targetVersion.version)) ||
          (pinnedRoot?.version && version !== firstText(pinnedRoot.version))) {
        throw new Error(uiText('ui.ficsitDependencyVersionConflictsWithTheShareManifestValue', { value1: (reference) }))
      }
      const installPayload = {
        source: 'ficsit', sourceType: 'ficsit', sourcePlatform: 'ficsit', sourceAdapter: 'ficsit',
        sourceGameId: String(targetContext.sourceGameId || targetContext.appId || 526870),
        sourceGameSlug: firstText(targetContext.sourceGameSlug, 'satisfactory'),
        appId: toNumber(targetContext.appId || targetContext.sourceGameId, 526870),
        gameId: targetContext.localGameInstallationId, gameName: targetContext.gameName,
        gameRoot: targetContext.gameRoot, modId: reference, fileId: versionId,
        modReference: reference, modName: firstText(planItem?.name, reference),
        name: firstText(planItem?.name, reference), version,
        fileSize: toNumber(planItem?.fileSize, 0), cover: firstText(planItem?.logo, root.cover),
        downloadUrl: firstText(planItem?.downloadUrl), sourceModKey: reference,
        profileId: targetContext.profileId, profileName: targetContext.profileName,
        targetProfileName: targetContext.profileName, endpointType: targetContext.endpointType,
        cleanupSourceArchiveAfterInstall: true, dependencies,
        dependencyRole: pinnedRoot ? 'main' : 'required',
        installRule: targetContext.installRule || {}, ficsitInstallRule: targetContext.installRule || {},
        sourceInstallRule: targetContext.installRule || {},
        metadata: { modReference: reference, versionId, dependencies, logo: firstText(planItem?.logo, root.cover) }
      }
      const canonical = taskEntryToCanonical(root, {
        item: {
          sourcePlatform: 'ficsit', sourceGameId: installPayload.sourceGameId,
          sourceModId: reference, sourceFileId: versionId, sourceModKey: reference,
          download_url: installPayload.downloadUrl, file_size: installPayload.fileSize,
          preferredFileName: `${reference}-${version}.zip`, version
        },
        meta: { sourcePlatform: 'ficsit', displayName: installPayload.modName, version, installPayload }
      }, targetContext, {
        sourceModId: reference, sourceFileId: versionId, sourceModKey: reference,
        dependencyRole: installPayload.dependencyRole,
        originItemKey: `ficsit:${installPayload.sourceGameId}:${pinnedRoot ? reference : modReference}`,
        name: installPayload.modName, version, cover: installPayload.cover,
        downloadUrl: installPayload.downloadUrl, fileSize: installPayload.fileSize,
        dependencies
      })
      const previous = result.get(canonical.itemKey)
      if (previous && previous.version !== canonical.version) {
        throw new Error(uiText('ui.ficsitDependenciesRequireDifferentVersionsValue', { value1: (reference) }))
      }
      result.set(canonical.itemKey, canonical)
    }
  }
  return [...result.values()]
}

export const FicsitShareAdapter = Object.freeze({
  sourcePlatform: 'ficsit',
  resolveManifest: resolveFicsitManifest
})

