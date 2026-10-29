import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../../i18n/message.js'
import { getRetiredSourceFailure } from '../../../../../../shared/sources/retired-source-policy.js'
import { computed, ref, watch, getCurrentScope, onScopeDispose } from 'vue'
import { resolveNexusUpdateFile, summarizeUpdateCheck } from './mod-management-update-policy.js'
import common from '@renderer/common/index.js'
import { $message } from '@renderer/common/message.js'
import { getFicsitModByReference } from '@renderer/utils/ficsit-api.js'
import {
  getNexusModFiles,
  getNexusModInfo,
  NEXUS_MOD_FILE_CATEGORY_ID
} from '@renderer/utils/nexus-api.js'
import { getModioModFiles, hasModioEnvApiKey } from '@renderer/utils/modio-api.js'
import { normalizeNexusModFiles as normalizeNexusModFilesService } from '@views/game/nexus/nexus-service.js'

// 各来源更新检测和更新确认；提交动作留在安装提交模块。
export function useModManagementUpdates({
  FICSIT_DOWNLOAD_BASE_URL,
  SOURCE_TYPE,
  activeSource,
  buildConfirmDetail,
  buildConfirmImpact,
  buildConfirmTag,
  decorateNexusRecords,
  ficsitInstalledList,
  getCurrentModioApiConfig,
  getNexusApiConfig,
  getUpdateContextKey = () => activeSource.value,
  invokeIpc,
  modioInstalledList,
  nexusInstalledList,
  openClientConfirmDialog,
  resolveModDisplayName,
  resolvedModioGameId,
  resolvedNexusDomainName,
  resolvedSteamAppId,
  startModioUpdateBatch,
  startNexusUpdateBatch,
  thunderstoreCommunity,
  thunderstoreInstalledList,
  thunderstoreProfile
}) {
  const thunderstoreUpdateRecords = ref([])

  const updateCheckLoading = ref(false)
  let requestVersion = 0
  let disposed = false
  const stopContextWatch = watch(getUpdateContextKey, () => {
    requestVersion += 1
    updateCheckLoading.value = false
    thunderstoreUpdateRecords.value = []
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => {
    disposed = true
    requestVersion += 1
    stopContextWatch()
  })

  function beginCheck(listRef) {
    const version = ++requestVersion
    const context = getUpdateContextKey()
    const records = listRef.value
    const identity = (item) => [item.id, item.modId, item.optionId, item.fileId, item.fullName, item.version].join('|')
    const versions = records.map(identity)
    updateCheckLoading.value = true
    return {
      records,
      current: () => !disposed && version === requestVersion &&
        context === getUpdateContextKey() && records === listRef.value &&
        records.every((item, index) => identity(item) === versions[index]),
      finish: () => { if (version === requestVersion) updateCheckLoading.value = false }
    }
  }

  function reportCheck(records, source) {
    const { failed, available, checked, total } = summarizeUpdateCheck(records)
    if (failed === total && failed > 0) {
      $message.error(uiMessage('ui.valueUpdateCheckFailedForValueModsPleaseTryAgain', { value1: (source), value2: (failed) }))
    } else if (failed > 0) {
      $message.warning(uiMessage('ui.valueCheckedValueUpdatesAvailableForValueFailedToCheck', { value1: (source), value2: (checked), value3: (available), value4: (failed) }))
    } else {
      $message.success(available > 0 ? uiText('ui.valueValueModsHaveUpdatesAvailable', { value1: (available), value2: (source) }) : '已完成检测，未查询到可更新版本')
    }
  }

  function mergeUpdateFields(current, result) {
    // A detection result must never restore old activation, priority or filesystem state.
    const fields = ['hasUpdate', 'latestVersion', 'updateInfo', 'updateError', 'updateHint']
    const patch = Object.fromEntries(fields.filter((key) => key in result).map((key) => [key, result[key]]))
    return { ...current, ...patch }
  }


  const thunderstoreUpdateLookup = computed(() => {
    const map = {}
    for (const item of thunderstoreUpdateRecords.value || []) {
      const key = String(item?.fullName || '')
        .trim()
        .toLowerCase()
      if (!key) {
        continue
      }
      map[key] = item
    }
    return map
  })

  function getCompareResult(currentVersion = '', latestVersion = '') {
    const currentText = String(currentVersion || '').trim()
    const latestText = String(latestVersion || '').trim()
    if (!currentText || !latestText || currentText === latestText) {
      return 0
    }

    try {
      const result = common.compareVersions(currentText, latestText)
      if (Number.isFinite(result) && result !== 0) {
        return result
      }
    } catch {
      // 兼容非纯数字语义化版本，下面使用字符串兜底。
    }

    return currentText.localeCompare(latestText, 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    })
  }

  function isRemoteVersionNewer(currentVersion = '', latestVersion = '') {
    return getCompareResult(currentVersion, latestVersion) < 0
  }

  function toSafeId(value = 0) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 0
  }

  async function checkCurrentSourceUpdates() {
    if (updateCheckLoading.value) {
      return
    }

    if (activeSource.value === SOURCE_TYPE.VERTEX) {
      await checkVertexUpdates(true)
      return
    }
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      await checkThunderstoreUpdates(true)
      return
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      await checkFicsitUpdates(true)
      return
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      await checkNexusUpdates(true)
      return
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      await checkModioUpdates(true)
    }
  }

  async function checkThunderstoreUpdates(showMessage = false) {
    if (!thunderstoreCommunity.value) {
      $message.warning(uiMessage('ui.thunderstoreCommunityIdentifierMissing'))
      return
    }

    const check = beginCheck(thunderstoreInstalledList)
    try {
      const result = await invokeIpc('thunderstoreGetUpdates', {
        community: thunderstoreCommunity.value,
        profileName: thunderstoreProfile.value,
        appId: resolvedSteamAppId.value
      })
      if (!check.current()) return
      if (result?.success === false) throw new Error(result.message || uiText('ui.queryFailed'))
      thunderstoreUpdateRecords.value = Array.isArray(result?.updates) ? result.updates : []
      thunderstoreInstalledList.value = thunderstoreInstalledList.value.map((item) => {
        const key = String(item?.fullName || '')
          .trim()
          .toLowerCase()
        const updateInfo =
          thunderstoreUpdateRecords.value.find(
            (entry) =>
              String(entry?.fullName || '')
                .trim()
                .toLowerCase() === key
          ) || null
        return {
          ...item,
          hasUpdate: !!updateInfo,
          latestVersion: String(updateInfo?.latestVersion || item?.latestVersion || '').trim()
        }
      })
      if (showMessage) {
        const count = thunderstoreUpdateRecords.value.length
        $message.success(count > 0 ? uiText('ui.valueModsHaveUpdatesAvailable', { value1: (count) }) : '未查询到可更新版本')
      }
    } catch (error) {
      if (!check.current()) return
      console.error('查询 Thunderstore 更新失败', error)
      $message.error(uiMessage('ui.couldNotCheckUpdatesValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      check.finish()
    }
  }

  function checkVertexUpdates(showMessage = false) {
    if (showMessage) $message.info(getRetiredSourceFailure().message)
  }

  function updateVertexAll() {
    $message.info(getRetiredSourceFailure().message)
  }

  function updateMod() {
    $message.info(getRetiredSourceFailure().message)
  }

  function resolveFicsitLatestVersionNode(remoteMod = {}) {
    const latestVersions = remoteMod?.latestVersions || {}
    return latestVersions.release || latestVersions.beta || latestVersions.alpha || null
  }

  async function checkFicsitUpdates(showMessage = false) {
    if (!ficsitInstalledList.value.length) {
      if (showMessage) $message.warning(uiMessage('ui.noFicsitModsAreAvailableToCheck'))
      return
    }

    const check = beginCheck(ficsitInstalledList)
    try {
      const nextList = []
      for (const item of check.records) {
        if (!check.current()) return
        const modReference = String(item?.modReference || '').trim()
        if (!modReference) {
          nextList.push({ ...item, hasUpdate: false, updateError: '缺少模组标识' })
          continue
        }

        try {
          const remoteMod = await getFicsitModByReference(modReference)
          const latestNode = resolveFicsitLatestVersionNode(remoteMod)
          const latestVersion = String(latestNode?.version || '').trim()
          const hasUpdate = latestVersion && isRemoteVersionNewer(item?.version, latestVersion)
          nextList.push({
            ...item,
            name: String(remoteMod?.name || item?.name || '').trim(),
            logo: String(remoteMod?.logo || item?.logo || '').trim(),
            hasUpdate,
            latestVersion,
            updateInfo: hasUpdate
              ? {
                  latestVersion,
                  downloadUrl: latestNode?.link
                    ? `${FICSIT_DOWNLOAD_BASE_URL}${latestNode.link}`
                    : '',
                  modReference,
                  remoteMod
                }
              : null,
            updateError: ''
          })
        } catch (error) {
          console.warn('查询 Ficsit 模组更新失败', modReference, error)
          nextList.push({
            ...item,
            hasUpdate: false,
            updateError: String(error?.message || '查询失败')
          })
        }
      }

      if (!check.current()) return
      const merged = check.records.map((item, index) => mergeUpdateFields(item, nextList[index]))
      ficsitInstalledList.value = merged
      if (showMessage) reportCheck(merged, 'Ficsit')
    } finally {
      check.finish()
    }
  }

  function isUsableNexusUpdateFile(file = {}) {
    const categoryName = String(file?.rawCategoryName || file?.raw?.category_name || '')
      .trim()
      .toUpperCase()
    const categoryId = toSafeId(file?.raw?.category_id || file?.raw?.categoryId)
    return (
      !!toSafeId(file?.fileId) &&
      categoryName !== 'DELETED' &&
      categoryName !== 'OLD_VERSION' &&
      categoryName !== 'ARCHIVED' &&
      categoryId !== 7 &&
      categoryId !== NEXUS_MOD_FILE_CATEGORY_ID.DELETED &&
      categoryId !== NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION
    )
  }

  async function checkNexusUpdates(showMessage = false) {
    if (!resolvedNexusDomainName.value) {
      $message.warning(uiMessage('ui.nexusDomainIdentifierMissing'))
      return
    }
    if (!nexusInstalledList.value.length) {
      if (showMessage) $message.warning(uiMessage('ui.noNexusModsAreAvailableToCheck'))
      return
    }

    const apiConfig = getNexusApiConfig()
    if (!apiConfig.apiKey) {
      $message.warning(uiMessage('ui.configureANexusAPIKeyInSettingsFirst'))
      return
    }

    const check = beginCheck(nexusInstalledList)
    try {
      const nextList = []
      for (const item of check.records) {
        if (!check.current()) return
        const modId = toSafeId(item?.modId)
        const currentFileId = toSafeId(item?.optionId)
        if (!modId || !currentFileId) {
          nextList.push({ ...item, hasUpdate: false, updateError: '缺少模组或文件标识' })
          continue
        }

        try {
          const [remoteMod, fileResult] = await Promise.all([
            getNexusModInfo(resolvedNexusDomainName.value, modId, apiConfig),
            getNexusModFiles(resolvedNexusDomainName.value, modId, apiConfig)
          ])
          const normalizedFiles = normalizeNexusModFilesService(fileResult?.files || [])
          const selection = resolveNexusUpdateFile(
            normalizedFiles, fileResult?.file_updates, currentFileId, isUsableNexusUpdateFile
          )
          const latestFile = selection.file
          const latestFileId = toSafeId(latestFile?.fileId)
          const latestVersion = String(
            latestFile?.version || remoteMod?.version || item?.latestVersion || ''
          ).trim()
          const hasUpdate =
            !!latestFileId &&
            (latestFileId !== currentFileId || isRemoteVersionNewer(item?.version, latestVersion)) &&
            !(item?.version && latestVersion && getCompareResult(item.version, latestVersion) > 0)

          nextList.push({
            ...item,
            name: String(remoteMod?.name || item?.name || '').trim(),
            cover: String(remoteMod?.pictureUrl || item?.cover || '').trim(),
            updateHint: selection.reason,
            hasUpdate,
            latestVersion,
            updateInfo: hasUpdate
              ? {
                  latestVersion,
                  latestFileId,
                  file: latestFile,
                  mod: {
                    ...remoteMod,
                    modId,
                    domainName: resolvedNexusDomainName.value
                  }
                }
              : null,
            updateError: ''
          })
        } catch (error) {
          console.warn('查询 Nexus 模组更新失败', modId, error)
          nextList.push({
            ...item,
            hasUpdate: false,
            updateError: String(error?.message || '查询失败')
          })
        }
      }

      if (!check.current()) return
      const merged = check.records.map((item, index) => mergeUpdateFields(item, nextList[index]))
      nexusInstalledList.value = decorateNexusRecords(merged)
      if (showMessage) reportCheck(merged, 'Nexus')
    } finally {
      check.finish()
    }
  }

  async function resolveNexusUpdateTarget(item = {}) {
    if (item?.hasUpdate && item?.updateInfo && !item?.updateError) {
      return item
    }
    await checkNexusUpdates(false)
    return (
      nexusInstalledList.value.find((record) => toSafeId(record?.id) === toSafeId(item?.id)) || item
    )
  }

  async function updateNexusMod(item = {}) {
    const target = await resolveNexusUpdateTarget(item)
    if (!target?.hasUpdate || !target?.updateInfo) {
      $message.warning(uiMessage('ui.noNewerVersionIsAvailableForThisNexusMod'))
      return
    }

    return openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Nexus 更新',
      get title() { return uiText('ui.updateThisNexusMod') },
      subtitle: resolveModDisplayName(target),
      get description() { return uiText('ui.theNexusDownloadAndInstallationRuleFlowWillUpdateThe') },
      get confirmText() { return uiText('ui.updateMod') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Nexus', 'default'),
        buildConfirmTag(`v${target.latestVersion}`, 'success')
      ],
      details: [
        buildConfirmDetail('当前版本', target?.version),
        buildConfirmDetail('目标版本', target?.latestVersion),
        buildConfirmDetail('目标文件', target?.updateInfo?.latestFileId)
      ],
      impacts: [
        buildConfirmImpact('未命中安装规则时，会保留下载记录并保持旧版本不变。', 'warning')
      ],
      onConfirm() {
        return startNexusUpdateBatch([target])
      }
    })
  }

  function updateNexusAll() {
    const targetList = nexusInstalledList.value.filter((item) => !!item?.hasUpdate && !item?.updateError)
    if (!targetList.length) {
      $message.warning(uiMessage('ui.noNexusModsAreAvailableToUpdate'))
      return
    }

    return openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Nexus 批量更新',
      title: uiText('ui.updateValueNexusMods', { value1: (targetList.length) }),
      get subtitle() { return uiText('ui.batchUpdate') },
      get description() { return uiText('ui.nexusDownloadTasksWillBeCreatedInBulkEachCompleted') },
      get confirmText() { return uiText('ui.updateAll') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Nexus', 'default'),
        buildConfirmTag(uiText('ui.valueItems', { value1: (targetList.length) }), 'success')
      ],
      details: [buildConfirmDetail('可更新模组', uiText('ui.valueItems', { value1: (targetList.length) }))],
      impacts: [buildConfirmImpact('批量更新会在下载完成后串行安装。')],
      onConfirm() {
        return startNexusUpdateBatch(targetList)
      }
    })
  }

  function selectPreferredModioUpdateFile(files = []) {
    const usableFiles = (Array.isArray(files) ? files : []).filter((file) => toSafeId(file?.fileId))
    if (!usableFiles.length) {
      return null
    }

    return [...usableFiles].sort((left, right) => {
      const dateDiff = Number(right?.dateAdded || 0) - Number(left?.dateAdded || 0)
      if (dateDiff !== 0) return dateDiff
      return toSafeId(right?.fileId) - toSafeId(left?.fileId)
    })[0]
  }

  async function checkModioUpdates(showMessage = false) {
    if (!resolvedModioGameId.value) {
      $message.warning(uiMessage('ui.modIoGameIDMissing'))
      return
    }
    if (!modioInstalledList.value.length) {
      if (showMessage) $message.warning(uiMessage('ui.noModIoModsAreAvailableToCheck'))
      return
    }
    if (!hasModioEnvApiKey(getCurrentModioApiConfig())) {
      $message.warning(uiMessage('ui.configureAModIoAPIKeyFirst'))
      return
    }

    const check = beginCheck(modioInstalledList)
    try {
      const apiConfig = getCurrentModioApiConfig()
      const nextList = []
      for (const item of check.records) {
        if (!check.current()) return
        const modId = toSafeId(item?.modId)
        const currentFileId = toSafeId(item?.optionId || item?.fileId)
        if (!modId || !currentFileId) {
          nextList.push({ ...item, hasUpdate: false, updateError: '缺少模组或文件标识' })
          continue
        }

        try {
          const fileResult = await getModioModFiles(resolvedModioGameId.value, modId, apiConfig)
          const latestFile = selectPreferredModioUpdateFile(fileResult?.records || [])
          const latestFileId = toSafeId(latestFile?.fileId)
          const latestVersion = String(latestFile?.version || '').trim()
          const currentHash = String(item?.raw?.file_md5 || item?.metadata?.fileMd5 || '').trim()
          const latestHash = String(latestFile?.filehash || '').trim()
          const hasUpdate =
            !!latestFileId &&
            (latestFileId !== currentFileId ||
              isRemoteVersionNewer(item?.version, latestVersion) ||
              (!!currentHash && !!latestHash && currentHash !== latestHash))

          nextList.push({
            ...item,
            hasUpdate,
            latestVersion,
            updateInfo: hasUpdate
              ? {
                  latestVersion,
                  latestFileId,
                  file: latestFile,
                  modId,
                  gameId: resolvedModioGameId.value
                }
              : null,
            updateError: ''
          })
        } catch (error) {
          console.warn('查询 Mod.io 模组更新失败', modId, error)
          nextList.push({
            ...item,
            hasUpdate: false,
            updateError: String(error?.message || '查询失败')
          })
        }
      }

      if (!check.current()) return
      const merged = check.records.map((item, index) => mergeUpdateFields(item, nextList[index]))
      modioInstalledList.value = merged
      if (showMessage) reportCheck(merged, 'Mod.io')
    } finally {
      check.finish()
    }
  }

  async function resolveModioUpdateTarget(item = {}) {
    if (item?.hasUpdate && item?.updateInfo && !item?.updateError) {
      return item
    }
    await checkModioUpdates(false)
    return (
      modioInstalledList.value.find((record) => toSafeId(record?.id) === toSafeId(item?.id)) || item
    )
  }

  async function updateModioMod(item = {}) {
    const target = await resolveModioUpdateTarget(item)
    if (!target?.hasUpdate || !target?.updateInfo) {
      $message.warning(uiMessage('ui.noNewerVersionIsAvailableForThisModIoMod'))
      return
    }

    return openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Mod.io 更新',
      get title() { return uiText('ui.updateThisModIoMod') },
      subtitle: resolveModDisplayName(target),
      get description() { return uiText('ui.theModIoDownloadAndInstallationRuleFlowWillUpdate') },
      get confirmText() { return uiText('ui.updateMod') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Mod.io', 'default'),
        buildConfirmTag(`v${target.latestVersion}`, 'success')
      ],
      details: [
        buildConfirmDetail('当前版本', target?.version),
        buildConfirmDetail('目标版本', target?.latestVersion),
        buildConfirmDetail('目标文件', target?.updateInfo?.latestFileId)
      ],
      impacts: [
        buildConfirmImpact('未命中安装规则时，会保留下载记录并保持旧版本不变。', 'warning')
      ],
      onConfirm() {
        return startModioUpdateBatch([target])
      }
    })
  }

  function updateModioAll() {
    const targetList = modioInstalledList.value.filter((item) => !!item?.hasUpdate && !item?.updateError)
    if (!targetList.length) {
      $message.warning(uiMessage('ui.noModIoModsAreAvailableToUpdate'))
      return
    }

    return openClientConfirmDialog({
      tone: 'default',
      toneLabel: 'Mod.io 批量更新',
      title: uiText('ui.updateValueModIoMods', { value1: (targetList.length) }),
      get subtitle() { return uiText('ui.batchUpdate') },
      get description() { return uiText('ui.modIoDownloadTasksWillBeCreatedInBulkEach') },
      get confirmText() { return uiText('ui.updateAll') },
      get cancelText() { return uiText('ui.cancel') },
      tags: [
        buildConfirmTag('Mod.io', 'default'),
        buildConfirmTag(uiText('ui.valueItems', { value1: (targetList.length) }), 'success')
      ],
      details: [buildConfirmDetail('可更新模组', uiText('ui.valueItems', { value1: (targetList.length) }))],
      impacts: [buildConfirmImpact('批量更新会在下载完成后串行安装。')],
      onConfirm() {
        return startModioUpdateBatch(targetList)
      }
    })
  }

  return {
    thunderstoreUpdateRecords,
    updateCheckLoading,
    thunderstoreUpdateLookup,
    toSafeId,
    checkCurrentSourceUpdates,
    updateVertexAll,
    updateMod,
    updateNexusMod,
    updateNexusAll,
    updateModioMod,
    updateModioAll
  }
}
