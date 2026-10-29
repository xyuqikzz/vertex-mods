import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../i18n/message.js'
import { onScopeDispose } from 'vue'
import { $message } from '@renderer/common/message.js'

import {
  buildDefaultDependencyReference as buildDefaultDependencyReferenceService,
  buildDefaultDependencyBatchEntries as buildDefaultDependencyBatchEntriesService,
  buildInstalledModDependencyReference as buildInstalledModDependencyReferenceService,
  buildMainModInstallRule as buildMainModInstallRuleService,
  buildNexusFileBatchEntry as buildNexusFileBatchEntryService,
  buildNexusRequirementBatchEntries as buildNexusRequirementBatchEntriesService,
  getDefaultDependencyList as getDefaultDependencyListService
} from './nexus-service.js'
import { buildInstallFailureNotice } from '../../../../../shared/installation/install-flow-message.js'

// Nexus 安装参数准备和提交，平台授权保持原契约；部署交由既有任务中心及安装引擎。
export function useNexusInstallSubmission({
  beginNexusInstallState,
  buildNexusInstallConfigPayload,
  buildNexusSourceMeta,
  canInstallByRule,
  closeNexusFileModal,
  currentNexusRule,
  finishNexusInstallState,
  gameBaseInfo,
  getNexusApiConfig,
  inspectNexusModRequirements,
  installSubmitting,
  installedNexusModRecordMap,
  installedSourceModKeySet,
  invokeIpc,
  nexusBinding,
  nexusFileModal,
  refreshInstalledNexusMods,
  resolvedNexusAppId,
  route,
  systemConfig,
  toSafeNumber,
  updateNexusInstallStateText
}) {
  let disposed = false
  let submissionItem = null
  const isPreparationCurrent = () => !disposed && submissionItem === nexusFileModal.value.item
  onScopeDispose(() => {
    disposed = true
  })

  async function submitNexusSourceInstallTask(payload = {}) {
    if (!isPreparationCurrent())
      throw Object.assign(new Error(uiText('ui.installationPreparationCancelled')), { code: 'preparation_cancelled' })
    return await invokeIpc('source-install-task:create', payload)
  }

  function buildDefaultInstallDependencyRefs() {
    return getDefaultDependencyListService(currentNexusRule.value)
      .map((item) => buildDefaultDependencyReferenceService(item))
      .filter(Boolean)
  }

  function buildInstalledRequirementDependencyRefs(requirementSummary = {}) {
    const excludedDependencies = Array.isArray(requirementSummary?.excludedDependencies)
      ? requirementSummary.excludedDependencies
      : []
    const refs = []

    for (const item of excludedDependencies) {
      if (String(item?.excludeReason || '').trim() !== 'same_nexus_mod_already_installed') {
        continue
      }

      const installedRecord = installedNexusModRecordMap.value.get(toSafeNumber(item?.modId, 0))
      const dependencyRef = buildInstalledModDependencyReferenceService(installedRecord || {})
      if (dependencyRef?.sourceModKey) {
        refs.push(dependencyRef)
      }
    }

    return refs
  }

  function dedupeDependencyRefs(list = []) {
    const map = new Map()

    for (const item of Array.isArray(list) ? list : []) {
      const sourceModKey = String(item?.sourceModKey || '').trim()
      if (!sourceModKey) {
        continue
      }
      map.set(sourceModKey, item)
    }

    return [...map.values()]
  }

  function buildCurrentInstallDependencyRefs(requirementSummary = {}, requirementEntries = []) {
    const pendingRequirementRefs = (Array.isArray(requirementEntries) ? requirementEntries : [])
      .map((item) => item?.meta?.dependencyRef || null)
      .filter(Boolean)

    return dedupeDependencyRefs([
      ...buildDefaultInstallDependencyRefs(),
      ...pendingRequirementRefs,
      ...buildInstalledRequirementDependencyRefs(requirementSummary)
    ])
  }

  function buildMainModInstallRule() {
    return buildMainModInstallRuleService(currentNexusRule.value)
  }

  async function buildDefaultDependencyBatchEntries(startSortIndex = 0) {
    return await buildDefaultDependencyBatchEntriesService({
      currentNexusRule: currentNexusRule.value,
      gameBaseInfo: gameBaseInfo.value,
      detectedRootPath: String(nexusBinding.value?.detectedRootPath || '').trim(),
      resolvedNexusAppId: resolvedNexusAppId.value,
      systemConfig: systemConfig.value,
      apiConfig: getNexusApiConfig(),
      installedSourceModKeys: installedSourceModKeySet.value,
      installConfig: buildNexusInstallConfigPayload(),
      startSortIndex
    })
  }

  async function buildNexusRequirementBatchEntries(
    pendingDependencies = [],
    startSortIndex = 0,
    options = {}
  ) {
    return await buildNexusRequirementBatchEntriesService({
      pendingDependencies,
      fallbackDomainName: gameBaseInfo.value.domainName,
      apiConfig: getNexusApiConfig(),
      currentNexusRule: currentNexusRule.value,
      detectedRootPath: String(nexusBinding.value?.detectedRootPath || '').trim(),
      resolvedNexusAppId: resolvedNexusAppId.value,
      gameBaseInfo: gameBaseInfo.value,
      installRule: buildMainModInstallRule(),
      installConfig: buildNexusInstallConfigPayload(),
      startSortIndex,
      manualResolvedDependencies: Array.isArray(options.manualResolvedDependencies)
        ? options.manualResolvedDependencies
        : [],
      skippedManualDependencyKeys: Array.isArray(options.skippedManualDependencyKeys)
        ? options.skippedManualDependencyKeys
        : []
    })
  }

  async function buildNexusFileBatchEntry(file, sortIndex = 10000, options = {}) {
    const metadata = file?.metadata && typeof file.metadata === 'object' ? file.metadata : {}
    const downloadUrl = String(
      options?.downloadUrl ||
        file?.downloadUrl ||
        file?.download_url ||
        metadata.downloadUrl ||
        metadata.download_url ||
        ''
    ).trim()
    const localFilePath = String(
      options?.localFilePath ||
        options?.filePath ||
        file?.localFilePath ||
        file?.localPath ||
        file?.filePath ||
        metadata.localPath ||
        metadata.filePath ||
        ''
    ).trim()
    const payload = {
      mod: nexusFileModal.value.item || {},
      file,
      fallbackDomainName: gameBaseInfo.value.domainName,
      apiConfig: getNexusApiConfig(),
      currentNexusRule: currentNexusRule.value,
      detectedRootPath: String(nexusBinding.value?.detectedRootPath || '').trim(),
      resolvedNexusAppId: resolvedNexusAppId.value,
      gameBaseInfo: gameBaseInfo.value,
      installRule: buildMainModInstallRule(),
      installConfig: buildNexusInstallConfigPayload(),
      sortIndex,
      downloadUrl,
      localFilePath,
      manualDownload:
        options?.manualDownload === true ||
        file?.manualDownload === true ||
        metadata.manualDownload === true,
      downloadAuthorization: options?.downloadAuthorization || {}
    }
    return await buildNexusFileBatchEntryService(payload)
  }

  function resolveSelectedNexusFileKey(file = {}) {
    return String(file?.fileId || file?.id || file?.file_id || file?.name || '').trim()
  }

  function normalizeSelectedNexusFiles(files = []) {
    const sourceList = Array.isArray(files) ? files : files ? [files] : []
    const seen = new Set()
    const result = []

    for (const file of sourceList) {
      const key = resolveSelectedNexusFileKey(file)
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      result.push(file)
    }

    return result
  }

  function normalizeNexusFileActionPayload(payload = {}) {
    const resolveActionMode = (raw) =>
      String(raw || '')
        .trim()
        .toLowerCase() === 'download'
        ? 'download'
        : 'install'
    if (Array.isArray(payload?.files)) {
      return {
        files: normalizeSelectedNexusFiles(payload.files),
        actionMode: resolveActionMode(payload.actionMode),
        includeDependencies: payload.includeDependencies === true,
        manualResolvedDependencies: Array.isArray(payload.manualResolvedDependencies)
          ? payload.manualResolvedDependencies
          : [],
        skippedManualDependencyKeys: Array.isArray(payload.skippedManualDependencyKeys)
          ? payload.skippedManualDependencyKeys
          : [],
        downloadAuthorization:
          payload.downloadAuthorization && typeof payload.downloadAuthorization === 'object'
            ? payload.downloadAuthorization
            : {}
      }
    }

    return {
      files: normalizeSelectedNexusFiles([payload]),
      actionMode: resolveActionMode(payload.actionMode),
      includeDependencies: true,
      manualResolvedDependencies: Array.isArray(payload.manualResolvedDependencies)
        ? payload.manualResolvedDependencies
        : [],
      skippedManualDependencyKeys: Array.isArray(payload.skippedManualDependencyKeys)
        ? payload.skippedManualDependencyKeys
        : [],
      downloadAuthorization:
        payload.downloadAuthorization && typeof payload.downloadAuthorization === 'object'
          ? payload.downloadAuthorization
          : {}
    }
  }

  function resolveSelectedNexusFileBatchName(files = []) {
    const safeFiles = normalizeSelectedNexusFiles(files)
    const firstName = String(safeFiles[0]?.name || '').trim()
    if (safeFiles.length <= 1) {
      return firstName || '当前文件'
    }
    return uiText('ui.valueFilesIncludingValue', { value1: (firstName || uiText('ui.currentFile')), value2: (safeFiles.length) })
  }

  function buildSelectedNexusFileDisplayPayload(files = []) {
    const safeFiles = normalizeSelectedNexusFiles(files)
    return {
      ...(safeFiles[0] || {}),
      name: resolveSelectedNexusFileBatchName(safeFiles),
      modId: toSafeNumber(nexusFileModal.value?.item?.modId || nexusFileModal.value?.item?.id, 0)
    }
  }

  async function buildSelectedNexusFileBatchEntries(
    files = [],
    startSortIndex = 10000,
    options = {}
  ) {
    const safeFiles = normalizeSelectedNexusFiles(files)
    return await Promise.all(
      safeFiles.map((file, index) =>
        buildNexusFileBatchEntry(file, startSortIndex + index, options)
      )
    )
  }

  function attachDependenciesToNexusFileEntries(fileEntries = [], dependencyRefs = []) {
    const safeDependencyRefs = dedupeDependencyRefs(dependencyRefs)
    return (Array.isArray(fileEntries) ? fileEntries : []).map((entry) => {
      const installPayload =
        entry?.meta?.installPayload && typeof entry.meta.installPayload === 'object'
          ? entry.meta.installPayload
          : null
      if (!installPayload) {
        return entry
      }

      return {
        ...entry,
        meta: {
          ...(entry.meta || {}),
          installPayload: {
            ...installPayload,
            dependencies: safeDependencyRefs
          }
        }
      }
    })
  }

  async function handleNexusFileDownloadWithoutRule(files = [], options = {}) {
    if (disposed) return
    if (installSubmitting.value) {
      $message.warning(uiMessage('ui.aDownloadTaskIsAlreadyBeingPrepared'))
      return
    }

    const selectedFiles = normalizeSelectedNexusFiles(files)
    if (!selectedFiles.length) {
      $message.warning(uiMessage('ui.selectFilesToDownloadFirst'))
      return
    }

    installSubmitting.value = true
    submissionItem = nexusFileModal.value.item
    const includeDependencies = options?.includeDependencies === true
    const manualResolvedDependencies = Array.isArray(options?.manualResolvedDependencies)
      ? options.manualResolvedDependencies
      : []
    const skippedManualDependencyKeys = Array.isArray(options?.skippedManualDependencyKeys)
      ? options.skippedManualDependencyKeys
      : []
    const effectiveIncludeDependencies = includeDependencies
    let requirementSummary = null
    try {
      const downloadAuthorization =
        options?.downloadAuthorization && typeof options.downloadAuthorization === 'object'
          ? options.downloadAuthorization
          : {}
      requirementSummary = includeDependencies ? await inspectNexusModRequirements() : null
      const [defaultDependencyEntries, requirementEntries, fileEntries] = await Promise.all([
        effectiveIncludeDependencies ? buildDefaultDependencyBatchEntries(0) : [],
        effectiveIncludeDependencies
          ? buildNexusRequirementBatchEntries(requirementSummary?.pendingDependencies || [], 5000, {
              manualResolvedDependencies,
              skippedManualDependencyKeys
            })
          : [],
        buildSelectedNexusFileBatchEntries(selectedFiles, 10000, { downloadAuthorization })
      ])
      const batchEntries = [...defaultDependencyEntries, ...requirementEntries, ...fileEntries].map(
        (entry) => {
          const preferredFileName = String(
            entry?.meta?.installPayload?.name || entry?.meta?.displayName || ''
          ).trim()
          return {
            ...entry,
            item: {
              ...(entry?.item || {}),
              showOpenInDownloadList: true,
              downloadPurpose: 'download_only',
              ...(preferredFileName ? { preferredFileName } : {})
            }
          }
        }
      )
      const nexusGameId = toSafeNumber(
        currentNexusRule.value?.nexusGameId || currentNexusRule.value?.gameId,
        0
      )
      const result = await submitNexusSourceInstallTask({
        source: 'nexus',
        sourceAdapter: 'nexus',
        sourceGameId: nexusGameId,
        gameKey: `nexus:${nexusGameId || resolvedNexusAppId.value || route.params?.id || 'unknown'}`,
        gameRoot: String(nexusBinding.value?.detectedRootPath || '').trim(),
        title: uiText('ui.downloadValue', { value1: (resolveSelectedNexusFileBatchName(selectedFiles)) }),
        mainItem: fileEntries[0]?.meta?.installPayload || {},
        items: batchEntries,
        sourceMeta: buildNexusSourceMeta(),
        purpose: 'download_only',
        options: {
          autoStart: true,
          includeDependencies: effectiveIncludeDependencies
        }
      })

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotSubmitDownloadTask')))
      }

      if (!isPreparationCurrent()) return
      closeNexusFileModal()
      $message.success(
        result.state === 'waiting_user_action'
          ? '已加入任务，需在任务中心完成 Nexus 授权'
          : '已加入任务，可在任务中心查看业务状态和下载中心查看传输进度'
      )
    } catch (error) {
      if (disposed || error?.code === 'preparation_cancelled') return
      console.error('创建下载任务失败', error)
      $message.error(uiMessage('ui.downloadPreparationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    } finally {
      installSubmitting.value = false
    }
  }

  async function handleNexusFileAction(payload) {
    if (disposed) return
    const actionPayload = normalizeNexusFileActionPayload(payload)
    const selectedFiles = actionPayload.files
    const actionMode = actionPayload.actionMode
    const includeDependencies = actionPayload.includeDependencies
    const manualResolvedDependencies = actionPayload.manualResolvedDependencies || []
    const skippedManualDependencyKeys = actionPayload.skippedManualDependencyKeys || []
    const downloadAuthorization = actionPayload.downloadAuthorization || {}
    if (!selectedFiles.length) {
      $message.warning(uiMessage('ui.selectFilesToProcessFirst'))
      return
    }

    if (actionMode === 'download') {
      await handleNexusFileDownloadWithoutRule(selectedFiles, {
        includeDependencies,
        manualResolvedDependencies,
        skippedManualDependencyKeys,
        downloadAuthorization
      })
      return
    }

    if (canInstallByRule.value) {
      const batchFile = buildSelectedNexusFileDisplayPayload(selectedFiles)
      const batchName = resolveSelectedNexusFileBatchName(selectedFiles)
      const targetModId = beginNexusInstallState(batchFile, '正在提交任务...')
      const effectiveIncludeDependencies = includeDependencies
      let requirementSummary = null
      if (installSubmitting.value) {
        finishNexusInstallState(targetModId)
        $message.warning(uiMessage('ui.anInstallationTaskIsBeingCreatedPleaseTryAgainLater'))
        return
      }

      installSubmitting.value = true
      submissionItem = nexusFileModal.value.item

      try {
        await refreshInstalledNexusMods().catch((error) => {
          console.warn('刷新已安装前置列表失败，继续使用本地缓存判断', error)
          return null
        })

        requirementSummary = includeDependencies ? await inspectNexusModRequirements() : null
        if (requirementSummary?.requirementError) {
          $message.warning(uiMessage('ui.nexusDependencyQueryFailedValue', { value1: (requirementSummary.requirementError) }))
        }

        const [defaultDependencyEntries, requirementEntries, rawFileEntries] = await Promise.all([
          effectiveIncludeDependencies ? buildDefaultDependencyBatchEntries(0) : [],
          effectiveIncludeDependencies
            ? buildNexusRequirementBatchEntries(
                requirementSummary?.pendingDependencies || [],
                5000,
                {
                  manualResolvedDependencies,
                  skippedManualDependencyKeys
                }
              )
            : [],
          buildSelectedNexusFileBatchEntries(selectedFiles, 10000, { downloadAuthorization })
        ])
        const fileEntries = attachDependenciesToNexusFileEntries(
          rawFileEntries,
          effectiveIncludeDependencies
            ? buildCurrentInstallDependencyRefs(requirementSummary || {}, requirementEntries)
            : []
        )
        const batchEntries = [...defaultDependencyEntries, ...requirementEntries, ...fileEntries]

        if (!batchEntries.length) {
          throw new Error(uiText('ui.noInstallationItemsToSubmit'))
        }

        const nexusGameId = toSafeNumber(
          currentNexusRule.value?.nexusGameId || currentNexusRule.value?.gameId,
          0
        )
        const result = await submitNexusSourceInstallTask({
          source: 'nexus',
          sourceAdapter: 'nexus',
          sourceGameId: nexusGameId,
          gameKey: `nexus:${nexusGameId || resolvedNexusAppId.value || route.params?.id || 'unknown'}`,
          gameRoot: String(nexusBinding.value?.detectedRootPath || '').trim(),
          title: uiText('ui.installValue', { value1: (batchName) }),
          mainItem: fileEntries[0]?.meta?.installPayload || {},
          items: batchEntries,
          sourceMeta: buildNexusSourceMeta(),
          options: {
            autoStart: true,
            includeDependencies: effectiveIncludeDependencies
          }
        })

        if (!result?.success) {
          throw new Error(String(result?.message || uiText('ui.couldNotSubmitInstallationTask')))
        }

        if (!isPreparationCurrent()) return
        closeNexusFileModal()
        updateNexusInstallStateText(targetModId, '已加入安装任务')
        $message.success(result.message || '已加入安装任务')
      } catch (error) {
        if (disposed || error?.code === 'preparation_cancelled') return
        const installError = buildInstallFailureNotice(error?.message, {
          modName: batchName,
          fallback: '提交安装任务失败，请稍后重试'
        })
        console.error('提交安装任务失败', error)
        $message.error(installError)
      } finally {
        installSubmitting.value = false
        finishNexusInstallState(targetModId)
      }
      return
    }

    await handleNexusFileDownloadWithoutRule(selectedFiles, {
      includeDependencies,
      downloadAuthorization
    })
  }

  return {
    buildMainModInstallRule,
    handleNexusFileAction
  }
}
