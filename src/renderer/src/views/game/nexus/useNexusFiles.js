import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../../../i18n/message.js'
import { computed, onScopeDispose, ref } from 'vue'
import { createDescriptionTranslationPlan } from '@renderer/utils/mod-description-translation.js'
import { $message } from '@renderer/common/message.js'
import { getNexusModFiles, getNexusModFileDetailBatch } from '@renderer/utils/nexus-api.js'
import {
  formatNumber as formatNumberService,
  groupNexusFiles,
  inspectNexusModRequirements as inspectNexusModRequirementsService,
  normalizeNexusModFiles as normalizeNexusModFilesService
} from './nexus-service.js'

// Nexus 详情、文件选择和依赖检查；依赖策略在文件选择弹窗里确认，由提交模块创建统一安装任务。
export function useNexusFiles({
  buildNexusFileTranslationKey,
  buildNexusFileTranslationRequestItems,
  canUseNexusAiTranslation,
  currentNexusRule,
  gameBaseInfo,
  getNexusApiConfig,
  hydrateNexusFileTranslations,
  installedNexusFileIdSetMap,
  installedNexusModIdSet,
  installedNexusModRecordMap,
  installedNexusMods,
  installedSourceModKeySet,
  nexusFileTranslationLoading,
  nexusFileTranslationMap,
  normalizeVersionText,
  refreshInstalledNexusMods,
  toSafeNumber,
  toSafeText
}) {
  let fileGeneration = 0
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    fileGeneration++
  })
  const nexusFileModal = ref({
    open: false,
    loading: false,
    item: null,
    files: [],
    targetFileId: '',
    requirementSummary: null
  })

  const nexusFileLoadErrorText = ref('')

  function isHiddenNexusFile(item = {}) {
    const categoryKey = String(
      item?.rawCategoryName || item?.categoryName || item?.category_name || ''
    )
      .trim()
      .toUpperCase()
    const categoryLabel = String(item?.categoryLabel || '').trim()
    return (
      categoryKey === 'DELETED' ||
      categoryKey === 'OLD_VERSION' ||
      categoryKey === 'ARCHIVED' ||
      categoryLabel === '已删除' ||
      categoryLabel === '旧版本' ||
      categoryLabel === '已归档文件'
    )
  }

  function logNexusInstallDebug(label, payload = {}) {
    console.info('[NEXUS][安装识别调试]', label, payload)
  }

  function getInstalledNexusRecordFileIdCandidates(item = {}) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const raw = item?.raw && typeof item.raw === 'object' ? item.raw : {}
    return [
      ['item.optionId', item?.optionId],
      ['item.option_id', item?.option_id],
      ['item.fileId', item?.fileId],
      ['item.file_id', item?.file_id],
      ['item.sourceFileId', item?.sourceFileId],
      ['metadata.fileId', metadata?.fileId],
      ['metadata.sourceFileId', metadata?.sourceFileId],
      ['raw.option_id', raw?.option_id],
      ['raw.file_id', raw?.file_id],
      ['raw.source_file_id', raw?.source_file_id]
    ].map(([field, value]) => ({
      field,
      value,
      parsed: toSafeNumber(value, 0)
    }))
  }

  function resolveInstalledNexusRecordFileId(item = {}) {
    const candidates = getInstalledNexusRecordFileIdCandidates(item)

    for (const candidate of candidates) {
      if (candidate.parsed > 0) {
        return candidate.parsed
      }
    }

    return 0
  }

  function buildInstalledNexusRecordDebugSnapshot(item = {}) {
    const raw = item?.raw && typeof item.raw === 'object' ? item.raw : {}
    return {
      id: item?.id,
      name: item?.name || raw?.name,
      modId: item?.modId || raw?.mod_id,
      optionId: item?.optionId || raw?.option_id,
      version: item?.version || raw?.version,
      profileName: item?.profileName || raw?.profile_name,
      sourceModKey: item?.sourceModKey || raw?.source_mod_key,
      resolvedFileId: resolveInstalledNexusRecordFileId(item),
      fileIdCandidates: getInstalledNexusRecordFileIdCandidates(item)
    }
  }

  function logNexusFileInstalledMatchDebug(reason, payload = {}) {
    if (!nexusFileModal.value.open) {
      return
    }
    logNexusInstallDebug(uiText('ui.fileMatchValue', { value1: (reason) }), payload)
  }

  function buildNexusFileMatchDebugPayload({
    file = {},
    fileList = [],
    modId = 0,
    fileId = 0,
    installedFileIdSet = new Set(),
    installedRecord = null,
    matched = false,
    reason = ''
  } = {}) {
    const visibleFiles = (Array.isArray(fileList) ? fileList : []).filter(
      (item) => !isHiddenNexusFile(item)
    )
    return {
      matched,
      reason,
      modalOpen: nexusFileModal.value.open,
      modId,
      file: {
        id: file?.id,
        fileId,
        name: file?.name,
        version: file?.version,
        rawCategoryName: file?.rawCategoryName,
        categoryLabel: file?.categoryLabel
      },
      installedFileIds: [...installedFileIdSet],
      installedRecord: installedRecord
        ? buildInstalledNexusRecordDebugSnapshot(installedRecord)
        : null,
      installedRecordModIds: installedNexusMods.value
        .slice(0, 20)
        .map((item) => item?.modId || item?.raw?.mod_id),
      visibleFileCount: visibleFiles.length,
      visibleFiles: visibleFiles.map((item) => ({
        id: item?.id,
        fileId: item?.fileId,
        name: item?.name,
        version: item?.version,
        rawCategoryName: item?.rawCategoryName,
        categoryLabel: item?.categoryLabel
      }))
    }
  }

  function shouldMarkNexusFileInstalled(
    file = {},
    fileList = [],
    modId = 0,
    installedFileIdSet = new Set()
  ) {
    const fileId = toSafeNumber(file?.fileId || file?.id, 0)
    const installedRecord = installedNexusModRecordMap.value.get(modId) || null
    if (fileId > 0 && installedFileIdSet.has(fileId)) {
      logNexusFileInstalledMatchDebug(
        '命中文件ID',
        buildNexusFileMatchDebugPayload({
          file,
          fileList,
          modId,
          fileId,
          installedFileIdSet,
          installedRecord,
          matched: true,
          reason: uiText('ui.installedFileIdSetContainsTheCurrentFileId')
        })
      )
      return true
    }

    if (!installedRecord) {
      logNexusFileInstalledMatchDebug(
        '未找到已安装记录',
        buildNexusFileMatchDebugPayload({
          file,
          fileList,
          modId,
          fileId,
          installedFileIdSet,
          installedRecord,
          matched: false,
          reason: uiText('ui.installedNexusModRecordMapHasNoEntryForTheCurrentModId')
        })
      )
      return false
    }

    const fileVersion = normalizeVersionText(file?.version)
    const installedVersion = normalizeVersionText(installedRecord?.version)
    if (fileVersion && installedVersion && fileVersion === installedVersion) {
      logNexusFileInstalledMatchDebug(
        '命中版本',
        buildNexusFileMatchDebugPayload({
          file,
          fileList,
          modId,
          fileId,
          installedFileIdSet,
          installedRecord,
          matched: true,
          reason: uiText('ui.fileVersionValueMatchesTheInstalledVersion', { value1: (fileVersion) })
        })
      )
      return true
    }

    const visibleFiles = (Array.isArray(fileList) ? fileList : []).filter(
      (item) => !isHiddenNexusFile(item)
    )
    const singleVisibleMatch =
      visibleFiles.length === 1 &&
      String(visibleFiles[0]?.fileId || visibleFiles[0]?.id || '') === String(fileId || '')
    logNexusFileInstalledMatchDebug(
      singleVisibleMatch ? '命中单文件兜底' : '未命中',
      buildNexusFileMatchDebugPayload({
        file,
        fileList,
        modId,
        fileId,
        installedFileIdSet,
        installedRecord,
        matched: singleVisibleMatch,
        reason: singleVisibleMatch
          ? uiText('ui.thisModHasOnlyOneVisibleFileAndAnInstallation')
          : uiText('ui.noFileIDVersionOrSingleFileFallbackMatchFileVersion', { value1: (fileVersion || ''), value2: (installedVersion || '') })
      })
    )
    return singleVisibleMatch
  }

  const translatedNexusFiles = computed(() => {
    const fileList = Array.isArray(nexusFileModal.value.files) ? nexusFileModal.value.files : []
    const modId = toSafeNumber(nexusFileModal.value.item?.modId || nexusFileModal.value.item?.id, 0)
    const installedFileIdSet = installedNexusFileIdSetMap.value.get(modId) || new Set()
    return fileList.map((item) => ({
      ...item,
      isInstalled: shouldMarkNexusFileInstalled(item, fileList, modId, installedFileIdSet),
      translatedDescription: canUseNexusAiTranslation.value ? createDescriptionTranslationPlan({
        id: buildNexusFileTranslationKey(item?.fileId).replace(/:name$/, ':description'),
        text: item?.description,
        format: 'html'
      }).apply(nexusFileTranslationMap.value) : '',
      translatedName:
        canUseNexusAiTranslation.value &&
        toSafeText(nexusFileTranslationMap.value[buildNexusFileTranslationKey(item?.fileId)]) !==
          toSafeText(item?.name)
          ? toSafeText(nexusFileTranslationMap.value[buildNexusFileTranslationKey(item?.fileId)])
          : ''
    }))
  })

  const visibleNexusFiles = computed(() => {
    return translatedNexusFiles.value.filter((item) => !isHiddenNexusFile(item))
  })

  const untranslatedNexusFileCount = computed(() => {
    return buildNexusFileTranslationRequestItems(
      visibleNexusFiles.value,
      nexusFileModal.value.item,
      {
        unresolvedOnly: true
      }
    ).length
  })

  function formatNumber(value) {
    return formatNumberService(value)
  }

  function normalizeNexusModFiles(list = []) {
    return normalizeNexusModFilesService(list)
  }

  const nexusFileGroups = computed(() => {
    return groupNexusFiles(visibleNexusFiles.value)
  })

  function closeNexusFileModal() {
    if (nexusFileModal.value.loading) {
      return
    }
    fileGeneration++
    nexusFileTranslationLoading.value = false
    nexusFileLoadErrorText.value = ''
    nexusFileModal.value = {
      open: false,
      loading: false,
      item: null,
      files: [],
      targetFileId: '',
      requirementSummary: null
    }
  }

  async function inspectNexusModRequirements() {
    const summaryPayload = await inspectNexusModRequirementsService({
      mod: nexusFileModal.value.item || {},
      gameBaseInfo: gameBaseInfo.value,
      fallbackDomainName: gameBaseInfo.value.domainName,
      apiConfig: getNexusApiConfig(),
      currentNexusRule: currentNexusRule.value,
      installedSourceModKeys: installedSourceModKeySet.value,
      installedNexusModIds: installedNexusModIdSet.value
    })

    if (!summaryPayload) {
      return null
    }

    return summaryPayload
  }

  async function openNexusFileModal(item, options = {}) {
    if (disposed) return
    const generation = ++fileGeneration
    const rawItem = item?.raw || item
    const domainName = String(rawItem?.domainName || gameBaseInfo.value.domainName || '').trim()
    const modId = toSafeNumber(rawItem?.modId, 0)
    const targetFileId = toSafeNumber(options?.targetFileId || rawItem?.targetFileId, 0)

    if (!domainName || !modId) {
      $message.warning(uiMessage('ui.modIdentifierMissingCannotGetTheFileList'))
      return
    }

    nexusFileLoadErrorText.value = ''
    nexusFileModal.value = {
      open: true,
      loading: true,
      item: rawItem,
      files: [],
      targetFileId: targetFileId > 0 ? String(targetFileId) : '',
      requirementSummary: null
    }

    try {
      const installedRefreshTask = refreshInstalledNexusMods().catch((error) => {
        console.warn('[NEXUS] 打开下载弹窗时刷新已安装列表失败', error)
      })
      const [fileResponse, requirementSummary] = await Promise.all([
        getNexusModFiles(domainName, modId, getNexusApiConfig()),
        inspectNexusModRequirements().catch((error) => {
          console.warn('[NEXUS] 打开下载弹窗时查询依赖失败', error)
          return null
        }),
        installedRefreshTask
      ])
      if (disposed || generation !== fileGeneration) return
      const fileList = normalizeNexusModFiles(fileResponse?.files || [])
      nexusFileLoadErrorText.value = ''
      nexusFileModal.value = {
        ...nexusFileModal.value,
        loading: false,
        files: fileList,
        requirementSummary
      }

      hydrateNexusFileTranslations(fileList, rawItem).catch((error) => {
        console.warn('[NEXUS] 异步读取文件翻译缓存失败', error)
      })

      // 异步获取主文件和可选文件的描述
      fetchNexusFileDescriptions(domainName, modId, fileList, generation).catch((error) => {
        console.warn('[NEXUS] 异步获取文件描述失败', error)
      })

      if (!fileList.length) {
        $message.warning(uiMessage('ui.thisModHasNoAvailableFiles'))
      } else if (
        targetFileId > 0 &&
        !fileList.some(
          (file) => toSafeNumber(file?.fileId || file?.id || file?.file_id, 0) === targetFileId
        )
      ) {
        $message.warning(uiMessage('ui.nexusFileValueFromTheLinkWasNotFoundSelect', { value1: (targetFileId) }))
      }
    } catch (error) {
      if (disposed || generation !== fileGeneration) return
      console.error('获取模组文件列表失败', error)
      nexusFileLoadErrorText.value = String(error?.message || '未知错误')
      nexusFileModal.value = {
        ...nexusFileModal.value,
        loading: false,
        files: [],
        targetFileId: targetFileId > 0 ? String(targetFileId) : '',
        requirementSummary: null
      }
      $message.warning(uiMessage('ui.couldNotGetFileListValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    }
  }

  async function fetchNexusFileDescriptions(domainName, modId, fileList, generation) {
    if (!domainName || !modId || !Array.isArray(fileList) || !fileList.length) {
      return
    }

    // 筛选出主文件和可选文件的 fileId
    const targetFiles = fileList.filter((file) => {
      const category = String(file?.rawCategoryName || '').toUpperCase()
      return category === 'MAIN' || category === 'OPTIONAL'
    })
    const targetFileIds = targetFiles
      .map((file) => file.fileId)
      .filter((id) => Number.isFinite(id) && id > 0)

    if (!targetFileIds.length) {
      return
    }

    try {
      const detailMap = await getNexusModFileDetailBatch(
        domainName,
        modId,
        targetFileIds,
        getNexusApiConfig(),
        3
      )
      if (disposed || generation !== fileGeneration) return

      if (!detailMap || detailMap.size === 0) {
        return
      }

      // 更新文件列表中的描述字段
      const updatedFiles = nexusFileModal.value.files.map((file) => {
        const detail = detailMap.get(file.fileId)
        if (!detail) {
          return file
        }
        const description = String(detail?.description || detail?.changelog || '').trim()
        if (!description) {
          return file
        }
        return { ...file, description }
      })

      nexusFileModal.value = {
        ...nexusFileModal.value,
        files: updatedFiles
      }
    } catch (error) {
      console.warn('[NEXUS] 获取文件描述详情失败', error)
    }
  }

  return {
    nexusFileModal,
    nexusFileLoadErrorText,
    isHiddenNexusFile,
    logNexusInstallDebug,
    resolveInstalledNexusRecordFileId,
    buildInstalledNexusRecordDebugSnapshot,
    visibleNexusFiles,
    untranslatedNexusFileCount,
    formatNumber,
    nexusFileGroups,
    closeNexusFileModal,
    inspectNexusModRequirements,
    openNexusFileModal
  }
}
