import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../../i18n/message.js'
import { $message } from '@renderer/common/message.js'
import { getModioModFile } from '@renderer/utils/modio-api.js'
import { installFicsitMod, setFicsitModEnabled } from '@views/game/ficsit/ficsit-service.js'
import {
  createLocalModInstallTask,
  selectLocalModInstallTargetFolder
} from '@views/game/local-mod-manager/local-mod-manager-service.js'
import {
  buildNexusFileBatchEntry as buildNexusFileBatchEntryService
} from '@views/game/nexus/nexus-service.js'

// 更新及本地库安装提交，复用既有下载和安装服务，不持有独立任务队列。
export function useModManagementInstall({
  FICSIT_STEAM_APP_ID,
  SOURCE_TYPE,
  activeSource,
  buildConfirmDetail,
  buildConfirmImpact,
  buildConfirmTag,
  current,
  ficsitInstalledList,
  ficsitLoading,
  getCurrentModioApiConfig,
  getLocalLibraryItemId,
  getLocalLibraryProfileName,
  getManagedSourceProfileValue,
  getNexusApiConfig,
  getRouteQueryText,
  invokeIpc,
  loadFicsitInstalledList,
  loadThunderstoreInstalledList,
  localLibraryTaskLoadingMap,
  localToolContext,
  modioBatchLoading,
  nexusBatchLoading,
  openClientConfirmDialog,
  refreshCurrentSource,
  resolveModDisplayName,
  resolvedGameId,
  resolvedModioAppId,
  resolvedModioGameId,
  resolvedNexusDomainName,
  resolvedNexusGameId,
  resolvedSteamAppId,
  setFicsitUpdating,
  setLocalLibraryTaskLoading,
  setModioUpdating,
  setNexusUpdating,
  setThunderstoreUpdating,
  thunderstoreCommunity,
  thunderstoreProfile,
  thunderstoreUpdateLookup,
  thunderstoreUpdateRecords,
  thunderstoreUpdatingMap,
  toSafeId
}) {
  function updateIdentity(item, source) {
    const profileName = String(item.profileName || item.profile_name ||
      getManagedSourceProfileValue(source) || '').trim()
    const updateTargetModId = toSafeId(item.id)
    if (!profileName || !updateTargetModId) throw new Error(uiText('ui.theUpdateIsMissingItsOriginalInstallationRecordOrProfile'))
    return {
      profileName, targetProfileName: profileName, updateTargetModId,
      updateExpectedFileId: String(item.optionId || item.option_id || item.fileId || ''),
      updateExpectedVersion: String(item.version || item.modVersion || ''),
      isUp: 1
    }
  }

  async function submitUpdateBatch(source, targetList, buildEntry, loading, setUpdating) {
    if (loading.value) return
    const records = (Array.isArray(targetList) ? targetList : []).filter((item) => item?.hasUpdate && !item?.updateError)
    if (!records.length) { $message.warning(uiMessage('ui.noModsAreAvailableToUpdate')); return }
    const ids = records.map((item) => toSafeId(item.id))
    const contextKey = () => JSON.stringify([
      resolvedGameId.value, resolvedSteamAppId.value,
      source === 'nexus' ? resolvedNexusGameId.value : resolvedModioGameId.value,
      getManagedSourceProfileValue(source), getRouteQueryText('rootPath'), getRouteQueryText('gameRootPath')
    ])
    const originalContext = contextKey()
    const gameRoot = String(getRouteQueryText('rootPath') || getRouteQueryText('gameRootPath') || '').trim()
    loading.value = true
    ids.forEach((id) => setUpdating(id, true))
    try {
      const entries = []
      for (const [index, item] of records.entries()) {
        entries.push(await buildEntry(item, index + 1))
        if (contextKey() !== originalContext) throw new Error(uiText('ui.theGameOrProfileChangedSubmitTheUpdateAgainFrom'))
      }
      const first = entries[0].meta.installPayload
      const result = await invokeIpc('source-install-task:create', JSON.parse(JSON.stringify({
        source, sourceAdapter: source,
        sourceGameId: first.gameSourceId,
        gameKey: `${source}:${first.gameSourceId}`,
        gameRoot,
        title: uiText('ui.updateValueValueMods', { value1: (entries.length), value2: (source === 'nexus' ? 'Nexus' : 'Mod.io') }),
        mainItem: first, items: entries,
        sourceMeta: { source, sourceId: first.gameSourceId, profileName: first.profileName },
        options: { autoStart: true, includeDependencies: false }
      })))
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotSubmitUpdateTask'))
      $message.success(uiMessage('modBrowser.queued'))
      return result
    } finally {
      ids.forEach((id) => setUpdating(id, false))
      loading.value = false
    }
  }

  async function createInstallTaskFromLocalLibrary(item = {}) {
    const itemId = getLocalLibraryItemId(item)
    if (!itemId) {
      $message.error(uiMessage('ui.theLocalAssetRecordHasNoIDRefreshTheList'))
      return
    }
    if (localLibraryTaskLoadingMap.value[String(itemId)]) {
      return
    }

    setLocalLibraryTaskLoading(itemId, true)
    try {
      const taskPayload = {
        id: itemId,
        libraryItemId: itemId,
        appId: resolvedSteamAppId.value,
        sourcePlatform:
          item?.source_platform ||
          item?.sourcePlatform ||
          (activeSource.value === SOURCE_TYPE.VERTEX ? 'server' : activeSource.value),
        profileName: getLocalLibraryProfileName(item),
        autoStart: false
      }
      let result = await createLocalModInstallTask(taskPayload)
      if (result?.code === 'local_mod_manual_target_required') {
        const selectedTarget = await selectLocalModInstallTargetFolder({
          ...taskPayload,
          gameRoot: localToolContext.value.gameRoot
        })
        if (selectedTarget?.success && selectedTarget.data?.installTarget) {
          result = await createLocalModInstallTask({
            ...taskPayload,
            installTarget: selectedTarget.data.installTarget
          })
        } else if (selectedTarget?.canceled) {
          return
        }
      }
      if (result?.success) {
        $message.success(result.message || '已加入安装任务')
        refreshCurrentSource()
        return
      }
      $message.error(result?.message || '创建本地 Mod 安装任务失败')
    } catch (error) {
      console.error('创建本地 Mod 安装任务失败', error)
      $message.error(String(error?.message || '创建本地 Mod 安装任务失败'))
    } finally {
      setLocalLibraryTaskLoading(itemId, false)
    }
  }

  async function updateThunderstorePackage(item = {}) {
    const fullName = String(item?.fullName || '').trim()
    if (!fullName || !thunderstoreCommunity.value || thunderstoreUpdatingMap.value[fullName]) {
      return
    }

    const updateInfo =
      thunderstoreUpdateLookup.value[
        String(fullName || '')
          .trim()
          .toLowerCase()
      ] || {}
    const targetVersion = String(updateInfo?.latestVersion || item?.latestVersion || '').trim()
    if (!targetVersion) {
      $message.warning(uiMessage('ui.thisModIsAlreadyUpToDate'))
      return
    }

    setThunderstoreUpdating(fullName, true)
    try {
      const result = await invokeIpc('thunderstoreUpdatePackage', {
        community: thunderstoreCommunity.value,
        profileName: thunderstoreProfile.value,
        packageFullName: fullName,
        versionNumber: targetVersion,
        appId: resolvedSteamAppId.value,
        packageLoader: ''
      })
      if (result?.success === false) throw new Error(result.message || uiText('ui.updateFailed'))
      await loadThunderstoreInstalledList()
      if (result?.code === 'NO_UPDATE') {
        $message.info(uiMessage('ui.skippedTheTargetVersionOfValueIsNotNewerThan', { value1: (fullName) }))
        return
      }
      $message.success(uiMessage('ui.updatedValueValue', { value1: (fullName), value2: (targetVersion) }))
    } catch (error) {
      console.error('更新 Thunderstore 模组失败', error)
      $message.error(uiMessage('ui.updateFailedValue', { value1: (String(error?.message || fullName)) }))
    } finally {
      setThunderstoreUpdating(fullName, false)
    }
  }

  async function updateThunderstoreAll() {
    if (!thunderstoreUpdateRecords.value.length) {
      $message.warning(uiMessage('ui.noModsAreAvailableToUpdate'))
      return
    }

    for (const item of thunderstoreUpdateRecords.value) {
      await updateThunderstorePackage({
        fullName: item?.fullName,
        latestVersion: item?.latestVersion
      })
    }
  }

  async function updateFicsitMod(item = {}) {
    const id = toSafeId(item?.id)
    const updateInfo = item?.updateInfo || {}
    const latestVersion = String(updateInfo?.latestVersion || item?.latestVersion || '').trim()
    const downloadUrl = String(updateInfo?.downloadUrl || '').trim()
    const modReference = String(item?.modReference || updateInfo?.modReference || '').trim()
    if (!id || !modReference || !latestVersion || !downloadUrl) {
      $message.warning(uiMessage('ui.thisFicsitModHasNoUpdateInformationCheckForUpdates'))
      return
    }

    openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Ficsit 更新',
      get title() { return uiText('ui.updateThisFicsitMod') },
      subtitle: resolveModDisplayName(item),
      get description() { return uiText('ui.theFicsitInstallationFlowWillDownloadTheLatestVersionAnd') },
      get confirmText() { return uiText('ui.updateMod') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [buildConfirmTag('Ficsit', 'default'), buildConfirmTag(`v${latestVersion}`, 'success')],
      details: [
        buildConfirmDetail('当前版本', item?.version),
        buildConfirmDetail('目标版本', latestVersion),
        buildConfirmDetail('模组标识', modReference)
      ],
      impacts: [buildConfirmImpact('更新成功后会刷新已安装列表。')],
      async onConfirm() {
        const wasEnabled = Number(item?.installState || 0) === 1
        setFicsitUpdating(id, true)
        try {
          const result = await installFicsitMod({
            appId: resolvedSteamAppId.value || FICSIT_STEAM_APP_ID,
            gameId: resolvedGameId.value,
            executableFile: getRouteQueryText('executableFile') || 'FactoryGameSteam.exe',
            modId: String(updateInfo?.remoteMod?.id || item?.modId || '').trim(),
            modReference,
            name: resolveModDisplayName(item, modReference),
            version: latestVersion,
            downloadUrl,
            logo: String(item?.logo || updateInfo?.remoteMod?.logo || '').trim()
          })
          if (!result?.success) {
            throw new Error(String(result?.message || uiText('ui.ficsitUpdateFailed')))
          }
          await loadFicsitInstalledList()
          if (!wasEnabled) {
            const updatedRecord = ficsitInstalledList.value.find(
              (record) =>
                String(record?.modReference || '')
                  .trim()
                  .toLowerCase() === modReference.toLowerCase()
            )
            if (updatedRecord?.id) {
              await setFicsitModEnabled({ id: updatedRecord.id, enabled: false })
              await loadFicsitInstalledList()
            }
          }
          $message.success(uiMessage('ui.updatedValueToValue', { value1: (resolveModDisplayName(item)), value2: (latestVersion) }))
        } finally {
          setFicsitUpdating(id, false)
        }
      }
    })
  }

  async function updateFicsitAll() {
    const targetList = ficsitInstalledList.value.filter((item) => !!item?.hasUpdate && !item?.updateError)
    if (!targetList.length) {
      $message.warning(uiMessage('ui.noFicsitModsAreAvailableToUpdate'))
      return
    }

    openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Ficsit 批量更新',
      title: uiText('ui.updateValueFicsitMods', { value1: (targetList.length) }),
      get subtitle() { return uiText('ui.batchUpdate') },
      get description() { return uiText('ui.ficsitModsWillBeUpdatedOneAtATimeFailed') },
      get confirmText() { return uiText('ui.updateAll') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Ficsit', 'default'),
        buildConfirmTag(uiText('ui.valueItems', { value1: (targetList.length) }), 'success')
      ],
      details: [buildConfirmDetail('可更新模组', uiText('ui.valueItems', { value1: (targetList.length) }))],
      impacts: [buildConfirmImpact('批量更新会串行执行，耗时取决于网络和文件大小。')],
      async onConfirm() {
        ficsitLoading.value = true
        let success = 0
        let failed = 0
        try {
          for (const item of targetList) {
            try {
              const updateInfo = item?.updateInfo || {}
              const result = await installFicsitMod({
                appId: resolvedSteamAppId.value || FICSIT_STEAM_APP_ID,
                gameId: resolvedGameId.value,
                executableFile: getRouteQueryText('executableFile') || 'FactoryGameSteam.exe',
                modId: String(updateInfo?.remoteMod?.id || item?.modId || '').trim(),
                modReference: item.modReference,
                name: resolveModDisplayName(item, item.modReference),
                version: updateInfo.latestVersion || item.latestVersion,
                downloadUrl: updateInfo.downloadUrl,
                logo: String(item?.logo || updateInfo?.remoteMod?.logo || '').trim()
              })
              if (!result?.success) {
                throw new Error(String(result?.message || uiText('ui.updateFailed')))
              }
              success += 1
            } catch (error) {
              failed += 1
              console.warn('批量更新 Ficsit 模组失败', item?.modReference, error)
            }
          }
          await loadFicsitInstalledList()
          if (failed > 0) {
            $message.warning(uiMessage('ui.ficsitBatchUpdateCompleteValueSucceededValueFailed', { value1: (success), value2: (failed) }))
          } else {
            $message.success(uiMessage('ui.ficsitBatchUpdateCompleteValueUpdated', { value1: (success) }))
          }
        } finally {
          ficsitLoading.value = false
        }
      }
    })
  }

  function buildNexusManagementRuleContext() {
    const gameName =
      String(current.value?.chineseTitle || getRouteQueryText('name') || '').trim() ||
      resolvedNexusDomainName.value ||
      'Nexus 游戏'
    const rootPath = String(
      getRouteQueryText('rootPath') || getRouteQueryText('gameRootPath')
    ).trim()
    return {
      gameId: resolvedGameId.value,
      nexusGameId: resolvedNexusGameId.value,
      gameName,
      rootPath,
      clientRootPath: rootPath
    }
  }

  function resolveNexusUpdateInstallRule(item = {}) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    return (
      (metadata?.nexusInstallRule && typeof metadata.nexusInstallRule === 'object'
        ? metadata.nexusInstallRule
        : null) ||
      (metadata?.sourceInstallRule && typeof metadata.sourceInstallRule === 'object'
        ? metadata.sourceInstallRule
        : null) ||
      {}
    )
  }

  async function buildNexusUpdateBatchEntry(item = {}, sortIndex = 0) {
    const updateInfo = item?.updateInfo || {}
    const file = updateInfo?.file || null
    const mod = updateInfo?.mod || null
    if (!file || !mod) {
      throw new Error(uiText('ui.thisNexusModHasNoUpdateFileInformation'))
    }

    const currentFileId = toSafeId(item?.optionId)
    const latestFileId = toSafeId(file?.fileId)
    const sourceModKey = String(
      item?.sourceModKey || `nexus:${toSafeId(item?.modId)}:${currentFileId || latestFileId}`
    ).trim()
    const identity = updateIdentity(item, SOURCE_TYPE.NEXUS)
    const profileName = identity.profileName
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const installConfig = {
      profileId: String(
        metadata?.profileId || metadata?.configProfileId || metadata?.installConfigProfileId || ''
      ).trim(),
      ruleProfileId: Number(metadata?.ruleProfileId || 0) || null,
      profileName,
      targetProfileName: profileName,
      profileScope: String(
        metadata?.profileScope || metadata?.installConfigProfileScope || ''
      ).trim(),
      profileKey: String(metadata?.profileKey || '').trim(),
      configProfileId: String(
        metadata?.configProfileId || metadata?.installConfigProfileId || metadata?.profileId || ''
      ).trim(),
      configProfileName: String(
        metadata?.configProfileName || metadata?.installConfigProfileName || ''
      ).trim(),
      installConfigProfileId: String(
        metadata?.installConfigProfileId || metadata?.configProfileId || metadata?.profileId || ''
      ).trim(),
      installConfigProfileName: String(
        metadata?.installConfigProfileName || metadata?.configProfileName || ''
      ).trim(),
      installConfigProfileScope: String(
        metadata?.installConfigProfileScope || metadata?.profileScope || ''
      ).trim(),
      installConfigSourceType: String(metadata?.installConfigSourceType || '').trim(),
      ruleVersion: Number(metadata?.ruleVersion || 0) || null
    }
    const entry = await buildNexusFileBatchEntryService({
      mod,
      file,
      fallbackDomainName: resolvedNexusDomainName.value,
      apiConfig: getNexusApiConfig(),
      currentNexusRule: buildNexusManagementRuleContext(),
      detectedRootPath: String(
        getRouteQueryText('rootPath') || getRouteQueryText('gameRootPath')
      ).trim(),
      resolvedNexusAppId: resolvedSteamAppId.value,
      gameBaseInfo: {
        domainName: resolvedNexusDomainName.value,
        name:
          current.value?.chineseTitle || getRouteQueryText('name') || resolvedNexusDomainName.value,
        coverImage: item?.cover
      },
      installRule: resolveNexusUpdateInstallRule(item),
      installConfig,
      dependencies: item?.dependencies || [],
      sortIndex
    })

    entry.meta = {
      ...(entry.meta || {}),
      oldRecordId: toSafeId(item?.id),
      oldSourceModKey: sourceModKey
    }
    entry.meta.installPayload = {
      ...(entry.meta.installPayload || {}),
      ...identity,
      ruleSelection: metadata.ruleSelection,
      sourceModKey,
      isActive: Number(item?.isActive ?? item?.is_active ?? 1),
      priorityOrder: Number(item?.priorityOrder || item?.priority_order || 0),
      installModel:
        String(item?.installModel || item?.install_model || 'managed').trim() || 'managed'
    }
    return entry
  }

  async function startNexusUpdateBatch(targetList = []) {
    return submitUpdateBatch('nexus', targetList, buildNexusUpdateBatchEntry, nexusBatchLoading, setNexusUpdating)
  }

  function getModioFileType(file = {}) {
    const filename = String(file?.name || '').trim()
    const ext = filename.includes('.') ? filename.split('.').pop() : ''
    return String(ext || 'zip')
      .trim()
      .toLowerCase()
  }

  function resolveModioUpdateInstallRule(item = {}) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    return (
      (metadata?.sourceInstallRule && typeof metadata.sourceInstallRule === 'object'
        ? metadata.sourceInstallRule
        : null) ||
      (metadata?.modioInstallRule && typeof metadata.modioInstallRule === 'object'
        ? metadata.modioInstallRule
        : null) ||
      {}
    )
  }

  async function buildModioUpdateBatchEntry(item = {}, sortIndex = 0) {
    const updateInfo = item?.updateInfo || {}
    const modId = toSafeId(updateInfo?.modId || item?.modId)
    const latestFileId = toSafeId(updateInfo?.latestFileId || updateInfo?.file?.fileId)
    const currentFileId = toSafeId(item?.optionId || item?.fileId)
    if (!resolvedModioGameId.value || !modId || !latestFileId) {
      throw new Error(uiText('ui.thisModIoModHasNoUpdateFileInformation'))
    }

    const refreshedFile = await getModioModFile(
      resolvedModioGameId.value,
      modId,
      latestFileId,
      getCurrentModioApiConfig()
    )
    const targetFile = refreshedFile || updateInfo?.file || {}
    const downloadUrl = String(targetFile?.downloadUrl || '').trim()
    if (!downloadUrl) {
      throw new Error(uiText('ui.noUsableDownloadLinkWasReturned'))
    }

    const modName = resolveModDisplayName(item)
    const fileName = String(targetFile?.name || item?.optionName || uiText('ui.fileValue', { value1: (latestFileId) })).trim()
    const version = String(targetFile?.version || item?.latestVersion || '').trim()
    const sourceSlug = String(
      getRouteQueryText('nameId') || item?.metadata?.sourceSlug || ''
    ).trim()
    const sourceModKey = String(
      item?.sourceModKey || `modio:${modId}:${currentFileId || latestFileId}`
    ).trim()
    const installRule = resolveModioUpdateInstallRule(item)
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const installPayload = {
      ...updateIdentity(item, SOURCE_TYPE.MODIO),
      ruleSelection: metadata.ruleSelection,
      profileId: metadata.profileId || metadata.configProfileId || '',
      ruleProfileId: metadata.ruleProfileId || null,
      appid: resolvedModioAppId.value,
      gameId: resolvedGameId.value,
      modioGameId: resolvedModioGameId.value,
      gameName:
        current.value?.chineseTitle || getRouteQueryText('name') || sourceSlug || 'Mod.io 游戏',
      clientInstallPath: '.',
      serverInstallPath: '',
      modId,
      id: latestFileId,
      modName,
      name: fileName,
      version,
      fileSize: Number(targetFile?.filesize || 0),
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: 0,
      cover: String(item?.cover || '').trim(),
      downloadUrl,
      sourceType: 'modio',
      gameSourceId: String(resolvedModioGameId.value),
      gameSourceSlug: sourceSlug,
      sourceId: String(modId),
      sourceSlug,
      sourceGameDomain: sourceSlug,
      sourceModKey,
      cleanupSourceArchiveAfterInstall: true,
      fileMd5: String(targetFile?.filehash || '').trim(),
      modVersion: version,
      dependencies: item?.dependencies || [],
      modioInstallRule: installRule,
      sourceInstallRule: installRule,
      isActive: Number(item?.isActive ?? 1),
      priorityOrder: Number(item?.priorityOrder || 0),
      installModel: String(item?.installModel || 'managed').trim() || 'managed',
      metadata: {
        category: 'modio',
        fileId: latestFileId,
        platforms: Array.isArray(targetFile?.platforms) ? targetFile.platforms : [],
        sourcePageUrl: String(item?.sourcePageUrl || '').trim()
      }
    }

    return {
      item: {
        task_name: uiText('ui.modIoModUpdateValueValue', { value1: (modName), value2: (version ? `@${version}` : '') }),
        module: '游戏',
        file_type: getModioFileType(targetFile),
        download_url: downloadUrl,
        file_size: Number(targetFile?.filesize || 0),
        saveType: 2,
        sourcePlatform: 'modio',
        sourceType: 'modio',
        gameId: resolvedModioGameId.value,
        sourceGameId: resolvedModioGameId.value,
        sourceModId: modId,
        sourceFileId: latestFileId,
        preferredFileName: fileName,
        showOpenInDownloadList: true,
        fun: {
          type: 0
        }
      },
      meta: {
        sortIndex,
        sourceType: 'modio',
        sourcePlatform: 'modio',
        displayName: modName,
        fileName,
        version,
        gameId: resolvedModioGameId.value,
        modId,
        fileId: latestFileId,
        oldRecordId: toSafeId(item?.id),
        oldSourceModKey: sourceModKey,
        filehash: String(targetFile?.filehash || '').trim(),
        platforms: Array.isArray(targetFile?.platforms) ? targetFile.platforms : [],
        sourcePageUrl: String(item?.sourcePageUrl || '').trim(),
        installPayload
      }
    }
  }

  async function startModioUpdateBatch(targetList = []) {
    return submitUpdateBatch('modio', targetList, buildModioUpdateBatchEntry, modioBatchLoading, setModioUpdating)
  }

  return {
    createInstallTaskFromLocalLibrary,
    updateThunderstorePackage,
    updateThunderstoreAll,
    updateFicsitMod,
    updateFicsitAll,
    startNexusUpdateBatch,
    startModioUpdateBatch
  }
}
