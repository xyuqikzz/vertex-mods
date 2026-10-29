import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'

import { getRemoteItems, taskEntryToCanonical, toNumber } from './common.js'

async function resolveThunderstoreManifest({ detail, targetContext }) {
  const roots = getRemoteItems(detail, 'thunderstore')
  const result = new Map()
  const pinnedVersions = new Map(roots.map((root) => [
    String(root.sourceModId || root.sourceModKey || '').split(':').at(-1).toLowerCase(),
    String(root.sourceFileId || root.version || '').trim()
  ]))

  for (const root of roots) {
    const packageFullName = String(root.sourceModId || root.sourceModKey || '').split(':').at(-1).trim()
    const response = await ipcRenderer.invoke('thunderstoreBuildSourceInstallTaskPlan', {
        community: targetContext.sourceGameId || root.sourceGameId,
        packageFullName,
        versionNumber: root.sourceFileId || root.version,
        profileName: targetContext.profileName,
        packageLoader: targetContext.packageLoader,
        appId: toNumber(targetContext.appId, 0)
      })
    if (!response?.success) {
      throw new Error(response?.message || uiText('ui.couldNotCreateThunderstoreInstallationPlan'))
    }

    for (const planItem of response.installPlan || []) {
      const fullName = planItem.fullName
      const pinnedVersion = pinnedVersions.get(String(fullName).toLowerCase())
      if (pinnedVersion && pinnedVersion !== String(planItem.version)) {
        throw new Error(uiText('ui.thunderstoreDependencyVersionConflictsWithTheShareManifestValueRequires', { value1: (fullName), value2: (pinnedVersion), value3: (planItem.version) }))
      }
      const existing = result.get(`thunderstore:${response.community}:${fullName}`.toLowerCase())
      if (existing && existing.version !== String(planItem.version)) {
        throw new Error(uiText('ui.thunderstoreDependenciesRequireDifferentVersionsValue', { value1: (fullName) }))
      }
      const sourceModKey = ['thunderstore', response.community, fullName].filter(Boolean).join(':')
      const installPayload = {
        source: 'thunderstore', sourceType: 'thunderstore', sourcePlatform: 'thunderstore',
        sourceAdapter: 'thunderstore', sourceGameId: response.community, community: response.community,
        appId: toNumber(targetContext.appId, 0), gameId: targetContext.localGameInstallationId,
        gameRoot: targetContext.gameRoot, gameExePath: targetContext.gameRoot,
        packageLoader: response.packageLoader || targetContext.packageLoader,
        profileId: targetContext.profileId, profileName: targetContext.profileName,
        targetProfileName: targetContext.profileName, fullName, packageFullName: fullName,
        packageOwner: planItem.packageOwner, packageName: planItem.packageName,
        modName: planItem.displayName, name: planItem.displayName, version: planItem.version,
        downloadUrl: planItem.downloadUrl, fileSize: planItem.fileSize,
        icon: planItem.icon, cover: planItem.icon, description: planItem.description,
        dependencies: planItem.dependencies || [], sourceModKey, cleanupSourceArchiveAfterInstall: false,
        installRule: targetContext.installRule || {}, metadata: {
          category: 'thunderstore', community: response.community,
          profileId: targetContext.profileId, profileName: targetContext.profileName
        }
      }
      const canonical = taskEntryToCanonical(root, {
        item: {
          sourcePlatform: 'thunderstore', sourceGameId: response.community,
          sourceModId: fullName, sourceFileId: planItem.version, sourceModKey,
          packageFullName: fullName, version: planItem.version,
          download_url: planItem.downloadUrl, file_size: planItem.fileSize,
          preferredFileName: `${fullName}-${planItem.version}.zip`
        },
        meta: { sourcePlatform: 'thunderstore', displayName: planItem.displayName, installPayload }
      }, targetContext, {
        sourceModId: fullName, sourceFileId: planItem.version, sourceModKey,
        dependencyRole: pinnedVersions.has(String(fullName).toLowerCase()) ? 'main' : 'required',
        originItemKey: `thunderstore:${response.community}:${pinnedVersions.has(String(fullName).toLowerCase()) ? fullName : packageFullName}`,
        name: planItem.displayName, version: planItem.version, cover: planItem.icon,
        description: planItem.description, dependencies: planItem.dependencies,
        downloadUrl: planItem.downloadUrl, fileSize: planItem.fileSize
      })
      result.set(canonical.itemKey, canonical)
    }
  }

  return {
    items: [...result.values()],
    warnings: []
  }
}

export const ThunderstoreShareAdapter = Object.freeze({
  sourcePlatform: 'thunderstore',
  resolveManifest: resolveThunderstoreManifest
})
