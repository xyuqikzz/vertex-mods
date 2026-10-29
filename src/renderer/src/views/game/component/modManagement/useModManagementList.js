import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { isLegacyManifestOnlyRecord } from '../../../../../../shared/sources/retired-source-policy.js'
import { computed, provide } from 'vue'
import common from '@renderer/common/index.js'
import { buildModManagementRelations } from './mod-management-relations.js'
import { getManagedModSourceUrl, withModDirectoryAction } from '../../../../../../shared/games/mod-management-location.js'

// 已安装记录投影、筛选和详情选择；只读取共享记录，不执行部署。
export function useModManagementList({
  SOURCE_TYPE,
  activeSource,
  activeTab,
  batchTargetCount,
  batchToggleType,
  buildListDisplayTitle,
  clientList,
  ficsitInstalledList,
  ficsitLoading,
  ficsitUpdatingMap,
  getLocalBindingItems,
  getLocalBindingMetadata,
  getLocalBoundRecordId,
  getLocalLibraryDisplayName,
  getLocalLibraryItemId,
  getLocalLibraryMetadata,
  getLocalLibraryNormalizedSource,
  getLocalLibraryProfileName,
  getLocalLibrarySourceLabel,
  getLocalLibrarySourcePlatform,
  getTranslatedDescriptionBySource,
  getTranslatedTitleBySource,
  getVisibleLocalLibraryItems,
  isBatchUninstalling,
  isFicsitOperationLoading,
  isLocalBoundMod,
  isLocalLibraryCard,
  isNexusOperationLoading,
  localLibraryTaskLoadingMap,
  modSearchKeyword,
  modioBatchLoading,
  modioOperationLoadingMap,
  modioProtocol,
  modioUpdatingMap,
  nexusBatchLoading,
  nexusInstalledList,
  nexusUpdatingMap,
  normalizeSourceType,
  resolvedModioGameId,
  resolvedNexusDomainName,
  resolvedSteamAppId,
  selectedModKey,
  serverList,
  thunderstoreCommunity,
  thunderstorePage = { value: 1 },
  thunderstorePageSize = 100,
  thunderstoreLocalBoundList,
  thunderstoreProfile,
  thunderstoreProtocol,
  thunderstoreUpdatingMap
}) {
  const activeList = computed(() =>
    activeTab.value === 'client' ? clientList.value : serverList.value
  )

  const activeListCount = computed(() => activeList.value.length)

  const activeTabLabel = computed(() => (activeTab.value === 'client' ? '客户端' : '服务端'))

  const uninstallProgressText = computed(() => {
    if (batchToggleType.value === 'enable')
      return uiText('ui.startingValueValueMods', { value1: (batchTargetCount.value), value2: (activeTabLabel.value) })
    if (batchToggleType.value === 'disable')
      return uiText('ui.disablingValueValueMods', { value1: (batchTargetCount.value), value2: (activeTabLabel.value) })
    return uiText('ui.deletingValueValueMods', { value1: (batchTargetCount.value), value2: (activeTabLabel.value) })
  })

  function resolveModDisplayName(item = {}, fallback = '--') {
    const translatedTitle = getTranslatedTitleBySource(item, activeSource.value)

    return toDisplayText(
      translatedTitle || item?.displayName || item?.name || item?.fullName,
      fallback
    )
  }

  function toDisplayText(value = '', fallback = '--') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }

    if (value && typeof value === 'object') {
      const source = Array.isArray(value) ? value[0] : value
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        return toDisplayText(
          source.path ||
            source.originalPath ||
            source.absolutePath ||
            source.targetPath ||
            source.value ||
            source.text ||
            source.label,
          fallback
        )
      }
    }

    const text = String(value ?? '').trim()
    return text || fallback
  }

  function buildMetaItem(label = '', value = '', title = '', action = null) {
    const text = toDisplayText(value, '').trim()
    if (!text) {
      return null
    }
    const actionConfig = action && typeof action === 'object' ? action : {}
    return {
      label: String(label || '').trim(),
      value: text,
      title: String(title || '').trim(),
      actionKey: String(actionConfig?.actionKey || '').trim(),
      actionPayload: actionConfig?.actionPayload ?? '',
      actionHint: String(actionConfig?.actionHint || '').trim()
    }
  }

  function buildMetaGroups(groups = []) {
    return (Array.isArray(groups) ? groups : [])
      .map((group) => (Array.isArray(group) ? group.filter(Boolean) : []))
      .filter((group) => group.length > 0)
  }

  function buildBadge(text = '', tone = 'default') {
    const label = String(text || '').trim()
    if (!label) {
      return null
    }
    return {
      text: label,
      tone: String(tone || 'default').trim() || 'default'
    }
  }

  function resolveDeployTypeText(card = {}, raw = {}) {
    const rawMethod = String(
      card?.deployMethod ||
        raw?.deployMethod ||
        raw?.deploy_method ||
        raw?.installMethod ||
        raw?.install_method ||
        ''
    )
      .trim()
      .toLowerCase()
    const installModel = String(card?.installModel || raw?.install_model || raw?.installModel || '')
      .trim()
      .toLowerCase()

    if (['hardlink', 'hard_link', 'hard-link', 'link'].includes(rawMethod)) return uiText('ui.hardLink')
    if (['symlink', 'softlink', 'soft_link', 'soft-link', 'symboliclink'].includes(rawMethod)) {
      return uiText('ui.symbolicLink')
    }
    if (['copy', 'filecopy', 'file_copy', 'fallback_copy'].includes(rawMethod)) return uiText('tools.copy')
    if (installModel === 'legacy') return uiText('ui.fileCopy')
    if (installModel === 'hybrid') return uiText('ui.smartDeployment')
    if (installModel === 'managed') return uiText('ui.managedDeployment')
    return uiText('ui.smartDeployment')
  }

  function buildDetailInfoGroup(title = '', rows = []) {
    const safeRows = (Array.isArray(rows) ? rows : []).filter((row) =>
      String(row?.label || '').trim()
    )
    if (!safeRows.length) return null
    return {
      title,
      rows: safeRows
    }
  }

  function joinCardNotes(list = [], separator = ' · ') {
    return (Array.isArray(list) ? list : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(separator)
  }

  function formatFicsitRelationName(item = {}) {
    const source = item && typeof item === 'object' ? item : {}
    const reference = String(
      source.modReference ||
        source.mod_reference ||
        source.sourceModKey ||
        source.source_mod_key ||
        ''
    ).trim()
    const name = String(source.name || source.modName || source.displayName || '').trim()
    const version = String(source.version || source.condition || '').trim()
    const base =
      name && reference && name !== reference ? `${name}（${reference}）` : name || reference
    return base && version ? `${base} ${version}` : base
  }

  function formatFicsitRelationNames(list = []) {
    return (Array.isArray(list) ? list : [])
      .map((item) => formatFicsitRelationName(item))
      .filter(Boolean)
  }

  function formatFicsitRelationSummary(list = [], limit = 2) {
    const names = formatFicsitRelationNames(list)
    if (names.length <= limit) {
      return names.join('、')
    }
    return uiText('ui.valueModsIncludingValue', { value1: (names.slice(0, limit).join('、')), value2: (names.length) })
  }

  function resolveFicsitDisableBlockedReason(item = {}) {
    const summary = formatFicsitRelationSummary(item?.activeDependents || [])
    return summary ? uiText('ui.enabledModsDependOnItValue', { value1: (summary) }) : ''
  }

  function resolveFicsitUninstallBlockedReason(item = {}) {
    const summary = formatFicsitRelationSummary(item?.dependents || [])
    return summary ? uiText('ui.modsDependOnItValue', { value1: (summary) }) : ''
  }

  function getLocalBindingSourceLabel(sourceType = activeSource.value, item = {}) {
    const source = normalizeSourceType(sourceType)
    if (source === SOURCE_TYPE.THUNDERSTORE) return 'Thunderstore'
    if (source === SOURCE_TYPE.FICSIT) return 'Ficsit'
    if (source === SOURCE_TYPE.NEXUS) return 'Nexus'
    if (source === SOURCE_TYPE.MODIO) return 'Mod.io'
    return String(item?.source || '').trim() === 'server' ? uiText('ui.vertexLocal') : 'Vertex'
  }

  function resolveLocalBindingStatus(item = {}) {
    const metadata = getLocalBindingMetadata(item)
    const state = String(metadata.state || '').trim()
    if (state === 'missing') return { get text() { return uiText('ui.pathMissing') }, tone: 'warning' }
    if (state === 'partial' || state === 'partial_failed')
      return { get text() { return uiText('ui.partiallyUnavailable') }, tone: 'warning' }
    const enabled = Number(item?.is_active ?? item?.isActive ?? 0) === 1
    return {
      text: enabled ? uiText('ui.enabled') : uiText('ui.disabled'),
      tone: enabled ? 'success' : 'default'
    }
  }

  function resolveSourceStatusInfo(mod) {
    const sourceStatus = String(mod?.source_status || 'normal').trim()
    const lockState = String(mod?.source_lock_state || 'unlocked').trim()
    const isEnabled = Number(mod?.is_active ?? mod?.isActive ?? 0) === 1
    const isMissing = sourceStatus === 'missing'
    const isLocked = isEnabled && lockState === 'locked'
    const isLockFailed = isEnabled && lockState === 'lock_failed'
    const isUnlockFailed = !isEnabled && lockState === 'unlock_failed'
    const badges = []
    if (isLocked) badges.push(buildBadge('已加锁', 'info'))
    if (isLockFailed) badges.push(buildBadge('加锁失败', 'warning'))
    if (isUnlockFailed) badges.push(buildBadge('解锁失败', 'warning'))
    if (isMissing) badges.push(buildBadge('源文件缺失', 'danger'))
    return {
      sourceStatus,
      lockState,
      isEnabled,
      isMissing,
      isLocked,
      isLockFailed,
      isUnlockFailed,
      badges,
      toggleDisabledReason: isMissing ? uiText('ui.sourceFilesMissingCannotEnable') : '',
      uninstallDisabledReason: isEnabled ? uiText('ui.disableBeforeUninstalling') : '',
      retryLockAvailable: isLockFailed
    }
  }

  function isManagedModEnabled(item = {}) {
    return Number(item?.is_active ?? item?.isActive ?? item?.installState ?? 0) === 1
  }

  function buildClearRecordAction(disabled = false) {
    return {
      key: 'clear-record',
      labelKey: 'ui.clearInvalidRecord', get label() { return uiText('ui.clearInvalidRecord') },
      tone: 'default',
      disabled
    }
  }

  function buildRetryLockAction(loading = false) {
    return {
      key: 'retry-lock',
      labelKey: 'ui.retryLocking', get label() { return uiText('ui.retryLocking') },
      tone: 'accent',
      disabled: loading,
      loading,
      get loadingText() { return uiText('ui.locking') },
      get title() { return uiText('ui.reapplySourceFileProtection') }
    }
  }

  function buildLocalBoundCard(item = {}, sourceType = activeSource.value) {
    const metadata = getLocalBindingMetadata(item)
    const items = getLocalBindingItems(item)
    const recordId = getLocalBoundRecordId(item)
    const enabled = Number(item?.is_active ?? item?.isActive ?? 0) === 1
    const sourceLabel = getLocalBindingSourceLabel(sourceType, item)
    const firstPath = items[0]?.originalPath || item?.target_path || item?.targetPath || ''
    const missingCount = items.filter((entry) => entry?.state === 'missing').length
    const failedCount = items.filter((entry) => entry?.state === 'failed').length
    const status = resolveLocalBindingStatus(item)
    const noteText = joinCardNotes([
      missingCount ? uiText('ui.valuePathsAreMissingRefreshOrResolveThemManually', { value1: (missingCount) }) : '',
      failedCount ? uiText('ui.valuePathOperationsFailed', { value1: (failedCount) }) : '',
      metadata.note
    ])

    return {
      key: `local-bound-${sourceType}-${recordId || item?.source_mod_key || item?.sourceModKey}`,
      source: sourceType,
      priorityOrder: Number(item?.priority_order || item?.priorityOrder || 0),
      deployDomain: String(item?.deploy_domain || item?.deployDomain || '').trim(),
      installModel: 'bound',
      lastReconcileAt: String(item?.updated_at || item?.updatedAt || '').trim(),
      title: toDisplayText(item?.name, uiText('ui.managedInPlaceMod')),
      listTitle: toDisplayText(item?.name, '原地接管模组'),
      subtitle: `${sourceLabel} / ${toDisplayText(item?.profile_name || item?.profileName, 'default')}`,
      coverUrl: String(item?.cover || '').trim(),
      fallbackText: getDisplayInitial(item?.name || '本'),
      status,
      badges: [
        buildBadge('原地接管', 'info'),
        buildBadge(sourceLabel, 'default'),
        missingCount ? buildBadge('路径缺失', 'warning') : null,
        failedCount ? buildBadge('部分异常', 'warning') : null
      ].filter(Boolean),
      metaGroups: buildMetaGroups([
        [
          buildMetaItem('路径数量', uiText('ui.valueItems', { value1: (items.length) })),
          buildMetaItem('首个路径', firstPath || '--'),
          buildMetaItem(
            '所属配置',
            toDisplayText(item?.profile_name || item?.profileName, 'default')
          )
        ],
        [
          buildMetaItem('来源', sourceLabel),
          buildMetaItem('绑定时间', formatDate(metadata.boundAt || item?.installed_at)),
          buildMetaItem('来源链接', metadata.sourceUrl || '--')
        ]
      ]),
      get description() { return uiText('ui.vertexManagesTheseLocalFilesOrFoldersInPlaceDisabling') },
      noteText,
      noteTone: missingCount || failedCount ? 'warning' : 'default',
      interactive: false,
      disabled: isBatchUninstalling.value,
      toggle: {
        visible: true,
        checked: enabled,
        disabled: isBatchUninstalling.value,
        loading: false,
        title: enabled ? uiText('ui.enabledClickToDisable') : uiText('ui.disabledClickToEnable')
      },
      actions: [
        {
          key: 'open-location',
          labelKey: 'taskCenter.downloads.openFolder', get label() { return uiText('taskCenter.downloads.openFolder') },
          tone: 'default',
          disabled: isBatchUninstalling.value || !firstPath
        },
        {
          key: 'refresh-local-binding',
          labelKey: 'tools.refreshStatus', get label() { return uiText('tools.refreshStatus') },
          tone: 'default',
          disabled: isBatchUninstalling.value
        },
        {
          key: 'unbind-local-binding',
          labelKey: 'ui.stopManaging', get label() { return uiText('ui.stopManaging') },
          tone: 'default',
          disabled: isBatchUninstalling.value
        },
        {
          key: 'delete',
          labelKey: 'ui.deleteFiles', get label() { return uiText('ui.deleteFiles') },
          tone: 'danger',
          disabled: isBatchUninstalling.value
        }
      ],
      raw: {
        ...item,
        id: recordId || item?.id
      }
    }
  }

  function buildVertexCards() {
    return activeList.value.map((mod) => {
      if (isLocalBoundMod(mod)) {
        return buildLocalBoundCard(mod, SOURCE_TYPE.VERTEX)
      }
      const isDependency = Number(mod?.type_id || 0) === 1
      const isEnabled = Number(mod?.is_active || 0) === 1
      const originalTitle = String(mod?.name || '').trim()
      const translatedTitle = getTranslatedTitleBySource(mod, SOURCE_TYPE.VERTEX)
      const translatedDescription = getTranslatedDescriptionBySource(mod, SOURCE_TYPE.VERTEX)
      const sourceInfo = resolveSourceStatusInfo(mod)
      const noteText = joinCardNotes([
        uiText('ui.theBuiltInOnlineSourceHasBeenRetiredTheseAre'),
        isDependency ? uiText('ui.thisItemIsADependencyCheckThatDeletingItWill') : '',
        sourceInfo.isMissing ? uiText('ui.sourceFilesAreMissingClearTheRecordOrDownloadAnd') : '',
        sourceInfo.isLockFailed ? uiText('ui.sourceFileLockingFailedWhichMayAffectDeletionProtection') : ''
      ])

      return {
        key: `vertex-${activeTab.value}-${mod.id}`,
        source: SOURCE_TYPE.VERTEX,
        priorityOrder: Number(mod?.priority_order || 0),
        deployDomain: String(mod?.deploy_domain || '').trim(),
        installModel: String(mod?.install_model || 'legacy').trim(),
        lastReconcileAt: String(mod?.last_reconcile_at || '').trim(),
        title: toDisplayText(translatedTitle || mod?.name),
        listTitle: buildListDisplayTitle(translatedTitle, originalTitle),
        subtitle: `Vertex / ${activeTabLabel.value} / ${toDisplayText(mod?.option_name, '默认方案')}`,
        coverUrl: String(mod?.cover || '').trim(),
        fallbackText: getDisplayInitial(translatedTitle || mod?.name),
        status: {
          text: sourceInfo.isMissing ? uiText('ui.sourceFilesMissing') : isEnabled ? uiText('ui.enabled') : uiText('ui.disabled'),
          tone: sourceInfo.isMissing ? 'danger' : isEnabled ? 'success' : 'default'
        },
        badges: [
          buildBadge(activeTabLabel.value, 'info'),
          translatedTitle || translatedDescription ? buildBadge('已翻译', 'default') : null,
          isDependency ? buildBadge('依赖', 'default') : null,
          ...sourceInfo.badges
        ].filter(Boolean),
        metaGroups: buildMetaGroups([
          [
            buildMetaItem('版本', toDisplayText(mod?.version)),
            buildMetaItem('安装方案', toDisplayText(mod?.option_name, '默认')),
            buildMetaItem('体积', formatFileSize(mod?.file_size))
          ],
          [
            buildMetaItem('安装时间', formatDate(mod?.created_at)),
            buildMetaItem('来源', 'Vertex 本地'),
            buildMetaItem('类型', isDependency ? '前置依赖' : '常规模组')
          ]
        ]),
        description:
          translatedDescription ||
          (isDependency
            ? uiText('ui.dependenciesAffectOtherItemsCheckDependencyRelationshipsBeforeDeleting')
            : uiText('ui.thisCardShowsALocallyRetainedRecordInspectItsStructure')),
        noteText,
        noteTone: sourceInfo.isMissing
          ? 'danger'
          : mod?.isUpdate
            ? 'warning'
            : isDependency
              ? 'info'
              : 'default',
        interactive: true,
        disabled: isBatchUninstalling.value,
        toggle: {
          visible: true,
          checked: isEnabled,
          disabled: isBatchUninstalling.value || sourceInfo.isMissing,
          loading: false,
          title: sourceInfo.toggleDisabledReason
        },
        actions: [
          {
            key: 'inspect-structure',
            labelKey: 'ui.viewStructure', get label() { return uiText('ui.viewStructure') },
            tone: 'default',
            disabled: isBatchUninstalling.value
          },
          Number(mod?.is_active || 0) === 0 || isLegacyManifestOnlyRecord(mod)
            ? {
                key: 'delete',
                labelKey: 'ui.deleteMod', get label() { return uiText('ui.deleteMod') },
                tone: 'danger',
                disabled: isBatchUninstalling.value,
                title: ''
              }
            : null,
          sourceInfo.retryLockAvailable ? buildRetryLockAction(isBatchUninstalling.value) : null,
          sourceInfo.isMissing ? buildClearRecordAction(isBatchUninstalling.value) : null
        ].filter(Boolean),
        raw: mod
      }
    })
  }

  function buildThunderstoreCards() {
    const localBoundFromProtocol = []
    const sourceCards = thunderstoreProtocol.value.rows.flatMap((row) => {
      if (isLocalBoundMod(row?.raw)) {
        localBoundFromProtocol.push(row.raw)
        return []
      }

      const metaMap = new Map(
        (Array.isArray(row?.meta) ? row.meta : []).map((item) => [
          String(item?.label || '').trim(),
          item
        ])
      )
      const fullName = String(row?.raw?.fullName || row?.key || '').trim()
      const isUpdating = !!thunderstoreUpdatingMap.value[fullName]
      const sourceInfo = resolveSourceStatusInfo(row?.raw || {})
      const noteText = joinCardNotes([
        row?.hints?.[0],
        row?.relations?.warning,
        sourceInfo.isMissing ? '源文件已缺失，可清除记录或重新下载安装。' : '',
        sourceInfo.isLockFailed ? '源文件加锁失败，可能影响防删保护。' : ''
      ])
      const originalTitle = String(row?.title || '').trim()
      const translatedTitle = getTranslatedTitleBySource(row?.raw || {}, SOURCE_TYPE.THUNDERSTORE)
      const translatedDescription = getTranslatedDescriptionBySource(
        row?.raw || {},
        SOURCE_TYPE.THUNDERSTORE
      )

      return [
        {
          key: `thunderstore-${row.key}`,
          source: SOURCE_TYPE.THUNDERSTORE,
          title: toDisplayText(translatedTitle || row?.title),
          listTitle: buildListDisplayTitle(translatedTitle, originalTitle),
          subtitle: fullName || uiText('ui.profileValue', { value1: (toDisplayText(thunderstoreProfile.value, 'default')) }),
          coverUrl: String(row?.iconUrl || '').trim(),
          fallbackText: row?.fallbackText || getDisplayInitial(translatedTitle || row?.title),
          status: {
            text: sourceInfo.isMissing ? uiText('ui.sourceFilesMissing') : toDisplayText(row?.status?.text, uiText('tools.installed')),
            tone: sourceInfo.isMissing ? 'danger' : row?.status?.tone || 'default'
          },
          badges: [
            buildBadge('Thunderstore', 'info'),
            translatedTitle || translatedDescription ? buildBadge('已翻译', 'default') : null,
            ...((Array.isArray(row?.badges) ? row.badges : []).map((badge) =>
              buildBadge(badge?.text, badge?.tone)
            ) || []),
            ...sourceInfo.badges
          ].filter(Boolean),
          metaGroups: buildMetaGroups([
            [
              buildMetaItem('作者', metaMap.get('作者')?.value || '--'),
              buildMetaItem('版本', metaMap.get('版本')?.value || '--'),
              buildMetaItem('安装时间', metaMap.get('安装时间')?.value || '--')
            ],
            [
              buildMetaItem('文件数', metaMap.get('文件数')?.value || '--'),
              buildMetaItem(
                '安装位置',
                metaMap.get('安装位置')?.value || '--',
                metaMap.get('安装位置')?.title || ''
              ),
              buildMetaItem('管理配置', toDisplayText(thunderstoreProfile.value, 'default'))
            ]
          ]),
          description: toDisplayText(translatedDescription || row?.desc, uiText('ui.noOnlineDescription')),
          noteText,
          noteTone: sourceInfo.isMissing
            ? 'danger'
            : row?.relations?.warning || row?.status?.tone === 'warning'
              ? 'warning'
              : noteText
                ? 'info'
                : 'default',
          interactive: false,
          disabled: !!row?.toggle?.loading || !!row?.uninstall?.loading,
          toggle: {
            visible: row?.toggle?.visible !== false,
            checked: !!row?.toggle?.checked,
            disabled: !!row?.toggle?.disabled || sourceInfo.isMissing,
            loading: !!row?.toggle?.loading,
            title: sourceInfo.toggleDisabledReason || row?.toggle?.disabledReason || ''
          },
          actions: [
            ...((Array.isArray(row?.actions) ? row.actions : [])
              .filter((action) => {
                if (action?.visible === false) return false
                if (action?.key === 'update-package') {
                  return row?.status?.tone === 'warning'
                }
                return true
              })
              .map((action) => ({
                key: action.key,
                label: action.key === 'update-package' ? uiText('ui.updateMod') : action.label,
                tone:
                  action.key === 'update-package'
                    ? 'accent'
                    : action.key === 'open-package-page'
                      ? 'info'
                      : 'default',
                disabled: !!action.disabled,
                loading: action.key === 'update-package' ? isUpdating : false,
                loadingText: action.key === 'update-package' ? uiText('ui.updating') : uiText('ui.processingVariant3'),
                title: ''
              })) || []),
            row?.uninstall?.visible === false || sourceInfo.isEnabled
              ? null
              : {
                  key: 'delete',
                  labelKey: 'ui.deleteMod', get label() { return uiText('ui.deleteMod') },
                  tone: 'danger',
                  disabled: !!row?.uninstall?.disabled,
                  loading: !!row?.uninstall?.loading,
                  get loadingText() { return uiText('ui.deletingVariant2') },
                  title: sourceInfo.uninstallDisabledReason || row?.uninstall?.disabledReason || ''
                },
            sourceInfo.retryLockAvailable ? buildRetryLockAction(!!row?.uninstall?.loading) : null,
            sourceInfo.isMissing ? buildClearRecordAction(!!row?.uninstall?.loading) : null
          ].filter(Boolean),
          raw: row.raw
        }
      ]
    })
    const localBoundMap = new Map()
    for (const item of [...localBoundFromProtocol, ...thunderstoreLocalBoundList.value]) {
      const key =
        getLocalBoundRecordId(item) ||
        String(item?.source_mod_key || item?.sourceModKey || item?.name || '').trim()
      if (key) {
        localBoundMap.set(String(key), item)
      }
    }
    return [
      ...sourceCards,
      ...Array.from(localBoundMap.values()).map((item) =>
        buildLocalBoundCard(item, SOURCE_TYPE.THUNDERSTORE)
      )
    ]
  }

  function buildFicsitCards() {
    return ficsitInstalledList.value.map((item) => {
      if (isLocalBoundMod(item)) {
        return buildLocalBoundCard(item, SOURCE_TYPE.FICSIT)
      }
      const enabled = Number(item?.installState || 0) === 1
      const loading =
        isFicsitOperationLoading(item.id) ||
        !!ficsitUpdatingMap.value[item.id] ||
        ficsitLoading.value
      const referenceText = String(item?.modReference || '').trim()
      const originalTitle = String(item?.name || '').trim()
      const translatedTitle = getTranslatedTitleBySource(item, SOURCE_TYPE.FICSIT)
      const translatedDescription = getTranslatedDescriptionBySource(item, SOURCE_TYPE.FICSIT)
      const hasUpdate = !!item?.hasUpdate
      const latestVersion = String(
        item?.latestVersion || item?.updateInfo?.latestVersion || ''
      ).trim()
      const dependencySummary = formatFicsitRelationSummary(item?.dependencies || [])
      const dependentSummary = formatFicsitRelationSummary(item?.dependents || [])
      const disableBlockedReason = resolveFicsitDisableBlockedReason(item)
      const uninstallBlockedReason = resolveFicsitUninstallBlockedReason(item)
      const sourceInfo = resolveSourceStatusInfo(item)
      const noteText = joinCardNotes([
        item.updateError ? uiText('ui.updateCheckFailedValue', { value1: (item.updateError) }) : item.updateHint,
        hasUpdate ? uiText('ui.updateAvailableTargetVersionValue', { value1: (latestVersion || '--') }) : '',
        disableBlockedReason || uninstallBlockedReason,
        sourceInfo.isMissing ? uiText('ui.sourceFilesAreMissingClearTheRecordOrDownloadAnd') : '',
        sourceInfo.isLockFailed ? uiText('ui.sourceFileLockingFailedWhichMayAffectDeletionProtection') : ''
      ])

      return {
        key: `ficsit-${item.id}`,
        source: SOURCE_TYPE.FICSIT,
        priorityOrder: Number(item?.priorityOrder || 0),
        deployDomain: String(item?.deployDomain || '').trim(),
        installModel: String(item?.installModel || 'legacy').trim(),
        lastReconcileAt: String(item?.lastReconcileAt || '').trim(),
        title: toDisplayText(translatedTitle || item?.name),
        listTitle: buildListDisplayTitle(translatedTitle, originalTitle),
        subtitle: referenceText ? `Ficsit / ${referenceText}` : uiText('ui.ficsitMod'),
        coverUrl: String(item?.logo || '').trim(),
        fallbackText: getDisplayInitial(translatedTitle || item?.name),
        status: {
          text: sourceInfo.isMissing
            ? uiText('ui.sourceFilesMissing')
            : hasUpdate
              ? uiText('ui.updateAvailableValue', { value1: (latestVersion || '--') })
              : enabled
                ? uiText('ui.enabled')
                : uiText('ui.disabled'),
          tone: sourceInfo.isMissing
            ? 'danger'
            : hasUpdate
              ? 'warning'
              : enabled
                ? 'success'
                : 'default'
        },
        badges: [
          buildBadge('Ficsit', 'info'),
          hasUpdate ? buildBadge('可更新', 'warning') : null,
          translatedTitle || translatedDescription ? buildBadge('已翻译', 'default') : null,
          dependencySummary
            ? buildBadge(uiText('ui.dependencyValue', { value1: ((item.dependencies || []).length) }), 'default')
            : null,
          dependentSummary
            ? buildBadge(uiText('ui.requiredByValueVariant2', { value1: ((item.dependents || []).length) }), 'warning')
            : null,
          ...sourceInfo.badges
        ].filter(Boolean),
        metaGroups: buildMetaGroups([
          [
            buildMetaItem('版本', toDisplayText(item?.version)),
            buildMetaItem('安装时间', formatLocalDateTime(item?.installedAt)),
            buildMetaItem('来源', 'Ficsit')
          ],
          [
            buildMetaItem('标识', referenceText || '--'),
            buildMetaItem(
              'SteamAppID',
              resolvedSteamAppId.value ? String(resolvedSteamAppId.value) : '--'
            )
          ],
          [
            buildMetaItem('规则', toDisplayText(item?.ruleId, '')),
            buildMetaItem('策略', toDisplayText(item?.strategy, '')),
            buildMetaItem('依赖', dependencySummary),
            buildMetaItem('被依赖', dependentSummary)
          ]
        ]),
        description:
          translatedDescription ||
          (referenceText ? uiText('ui.modIdentifierValue', { value1: (referenceText) }) : uiText('ui.aLocallyInstalledFicsitMod')),
        noteText,
        noteTone: sourceInfo.isMissing
          ? 'danger'
          : hasUpdate || disableBlockedReason || uninstallBlockedReason
            ? 'warning'
            : dependencySummary
              ? 'info'
              : 'default',
        interactive: false,
        disabled: loading,
        toggle: {
          visible: true,
          checked: enabled,
          disabled: loading || !!disableBlockedReason || sourceInfo.isMissing,
          loading,
          title: sourceInfo.toggleDisabledReason || disableBlockedReason
        },
        actions: [
          {
            key: 'open-source-page', labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') },
            disabled: loading || !getManagedModSourceUrl(item, SOURCE_TYPE.FICSIT)
          },
          hasUpdate
            ? {
                key: 'update-ficsit',
                labelKey: 'ui.updateMod', get label() { return uiText('ui.updateMod') },
                tone: 'accent',
                disabled: loading,
                loading: !!ficsitUpdatingMap.value[item.id],
                get loadingText() { return uiText('ui.updating') }
              }
            : null,
          sourceInfo.isEnabled
            ? null
            : {
                key: 'delete',
                labelKey: 'ui.deleteMod', get label() { return uiText('ui.deleteMod') },
                tone: 'danger',
                disabled: loading || !!uninstallBlockedReason,
                loading,
                get loadingText() { return uiText('ui.deletingVariant2') },
                title: uninstallBlockedReason
              },
          sourceInfo.retryLockAvailable ? buildRetryLockAction(loading) : null,
          sourceInfo.isMissing ? buildClearRecordAction(loading) : null
        ].filter(Boolean),
        raw: item
      }
    })
  }

  function buildNexusCards() {
    return nexusInstalledList.value.map((item) => {
      if (isLocalBoundMod(item)) {
        return buildLocalBoundCard(item, SOURCE_TYPE.NEXUS)
      }
      const loading =
        isNexusOperationLoading(item.id) ||
        !!nexusUpdatingMap.value[item.id] ||
        nexusBatchLoading.value
      const isEnabled = !!item?.isActive
      const sourceFilePath = String(item?.archivePath || item?.stagingPath || '').trim()
      const dangerText = String(
        item?.disableBlockedReason || item?.uninstallBlockedReason || ''
      ).trim()
      const dependencyHint = String(
        item?.dependencyHintText || item?.dependencyWarningText || ''
      ).trim()
      const sourceInfo = resolveSourceStatusInfo(item)
      const noteText = joinCardNotes([item.updateError ? uiText('ui.updateCheckFailedValue', { value1: (item.updateError) }) : item.updateHint,
        item?.isDefaultDependency ? '' : dangerText, item?.isDefaultDependency ? '' : dependencyHint])
      const originalTitle = String(item?.displayName || item?.name || '').trim()
      const translatedTitle = getTranslatedTitleBySource(item, SOURCE_TYPE.NEXUS)
      const translatedDescription = getTranslatedDescriptionBySource(item, SOURCE_TYPE.NEXUS)
      const hasUpdate = !!item?.hasUpdate
      const latestVersion = String(
        item?.latestVersion || item?.updateInfo?.latestVersion || ''
      ).trim()

      return {
        key: `nexus-${item.id}`,
        source: SOURCE_TYPE.NEXUS,
        priorityOrder: Number(item?.priorityOrder || 0),
        deployDomain: String(item?.deployDomain || '').trim(),
        installModel: String(item?.installModel || 'legacy').trim(),
        lastReconcileAt: String(item?.lastReconcileAt || '').trim(),
        title: toDisplayText(translatedTitle || item?.displayName),
        listTitle: buildListDisplayTitle(translatedTitle, originalTitle),
        subtitle: item?.optionName
          ? uiText('ui.nexusFileValue', { value1: (toDisplayText(item?.optionName)) })
          : uiText('ui.sourceValue', { value1: (toDisplayText(item?.sourceLabel, 'Nexus')) }),
        coverUrl: String(item?.cover || '').trim(),
        fallbackText: getDisplayInitial(translatedTitle || item?.displayName),
        status: {
          text: sourceInfo.isMissing
            ? uiText('ui.sourceFilesMissing')
            : hasUpdate
              ? uiText('ui.updateAvailableValue', { value1: (latestVersion || '--') })
              : isEnabled
                ? uiText('ui.enabled')
                : uiText('ui.disabled'),
          tone: sourceInfo.isMissing
            ? 'danger'
            : hasUpdate || dangerText
              ? 'warning'
              : isEnabled
                ? 'success'
                : 'default'
        },
        badges: [
          buildBadge(
            toDisplayText(item?.sourceLabel, 'Nexus'),
            item?.isDefaultDependency ? 'warning' : 'info'
          ),
          hasUpdate ? buildBadge('可更新', 'warning') : null,
          translatedTitle || translatedDescription ? buildBadge('已翻译', 'default') : null,
          item?.isRunnable ? buildBadge('可运行', 'success') : null,
          Number(item?.dependentCount || 0) > 0
            ? buildBadge(uiText('ui.requiredByValueVariant2', { value1: (Number(item?.dependentCount || 0)) }), 'default')
            : null,
          ...sourceInfo.badges
        ].filter(Boolean),
        metaGroups: buildMetaGroups([
          [
            buildMetaItem('版本', toDisplayText(item?.version)),
            buildMetaItem('安装时间', toDisplayText(item?.installedAt)),
            buildMetaItem('来源', toDisplayText(item?.sourceLabel, 'Nexus'))
          ],
          [
            item?.matchedRuleId
              ? buildMetaItem(
                  '命中规则',
                  toDisplayText(item?.matchedRuleId),
                  joinCardNotes(
                    [toDisplayText(item?.installRuleStrategy, ''), '点击复制规则 ID'],
                    ' · '
                  ),
                  {
                    actionKey: 'copy-text',
                    actionPayload: toDisplayText(item?.matchedRuleId),
                    actionHint: '点击复制'
                  }
                )
              : null,
            item?.isRunnable ? buildMetaItem('能力', '可运行') : null
          ]
        ]),
        description:
          translatedDescription ||
          toDisplayText(
            item?.description || item?.summary,
            item?.targetRelativePath
              ? uiText('ui.deploymentPathValue', { value1: (item.targetRelativePath) })
              : item?.downloadUrl
                ? uiText('ui.installedFromNexusIntoTheCurrentGameFolder')
                : uiText('ui.installedNexusMod')
          ),
        noteText: joinCardNotes([
          hasUpdate ? uiText('ui.updateAvailableTargetVersionValue', { value1: (latestVersion || '--') }) : '',
          noteText,
          sourceInfo.isMissing ? '源文件已缺失，可清除记录或重新下载安装。' : '',
          sourceInfo.isLockFailed ? '源文件加锁失败，可能影响防删保护。' : ''
        ]),
        noteTone: sourceInfo.isMissing
          ? 'danger'
          : hasUpdate || dependencyHint
            ? 'warning'
            : 'default',
        interactive: false,
        disabled: loading,
        toggle: {
          visible: true,
          checked: isEnabled,
          disabled: loading || !!item?.disableBlockedReason || sourceInfo.isMissing,
          loading,
          title: sourceInfo.toggleDisabledReason || item?.disableBlockedReason || ''
        },
        actions: [
          hasUpdate
            ? {
                key: 'update-nexus',
                labelKey: 'ui.updateMod', get label() { return uiText('ui.updateMod') },
                tone: 'accent',
                disabled: loading,
                loading,
                get loadingText() { return uiText('ui.updating') }
              }
            : null,
          item?.isRunnable
            ? {
                key: 'run',
                labelKey: 'ui.runTool', get label() { return uiText('ui.runTool') },
                tone: 'accent',
                disabled: loading
              }
            : null,
          sourceFilePath
            ? {
                key: 'archive',
                labelKey: 'ui.sourceFilePath', get label() { return uiText('ui.sourceFilePath') },
                tone: 'default',
                disabled: loading,
                title: sourceFilePath
              }
            : null,
          {
            key: 'source',
            labelKey: 'tools.details', get label() { return uiText('tools.details') },
            tone: 'info',
            disabled: loading
          },
          isEnabled
            ? {
                key: 'location',
                labelKey: 'taskCenter.downloads.openFolder', get label() { return uiText('taskCenter.downloads.openFolder') },
                tone: 'default',
                disabled: loading
              }
            : null,
          isEnabled && !item.canRemoveRecordOnly
            ? null
            : {
                key: 'delete',
                label: item.canRemoveRecordOnly ? uiText('tools.removeRecord') : uiText('ui.deleteMod'),
                tone: 'danger',
                disabled: loading || !!item?.uninstallBlockedReason,
                loading,
                get loadingText() { return uiText('ui.deletingVariant2') },
                title: item?.uninstallBlockedReason || ''
              },
          sourceInfo.retryLockAvailable ? buildRetryLockAction(loading) : null,
          sourceInfo.isMissing ? buildClearRecordAction(loading) : null
        ].filter(Boolean),
        raw: item
      }
    })
  }

  function buildModioCards() {
    return modioProtocol.value.rows.map((row) => {
      const raw = row.raw || {}
      if (isLocalBoundMod(raw)) {
        return buildLocalBoundCard(raw, SOURCE_TYPE.MODIO)
      }
      const rowId = Number(raw?.id || 0)
      const loading =
        !!modioOperationLoadingMap.value[rowId] ||
        !!modioUpdatingMap.value[rowId] ||
        modioBatchLoading.value
      const originalTitle = String(row?.title || raw?.name || '').trim()
      const translatedTitle = getTranslatedTitleBySource(raw, SOURCE_TYPE.MODIO)
      const translatedDescription = getTranslatedDescriptionBySource(raw, SOURCE_TYPE.MODIO)
      const sourceInfo = resolveSourceStatusInfo(raw)

      return {
        key: `modio-${row.key}`,
        source: SOURCE_TYPE.MODIO,
        priorityOrder: Number(raw?.priorityOrder || raw?.priority_order || 0),
        deployDomain: String(raw?.deployDomain || raw?.deploy_domain || '').trim(),
        installModel: String(raw?.installModel || raw?.install_model || 'legacy').trim(),
        lastReconcileAt: String(raw?.lastReconcileAt || raw?.last_reconcile_at || '').trim(),
        title: toDisplayText(translatedTitle || row?.title),
        listTitle: buildListDisplayTitle(translatedTitle, originalTitle),
        subtitle: row?.subtitle || uiText('ui.modIoMod'),
        coverUrl: String(row?.iconUrl || raw?.cover || '').trim(),
        fallbackText: row?.fallbackText || getDisplayInitial(translatedTitle || row?.title),
        status: {
          text: sourceInfo.isMissing ? uiText('ui.sourceFilesMissing') : row?.status?.text || uiText('tools.installed'),
          tone: sourceInfo.isMissing ? 'danger' : row?.status?.tone || 'default'
        },
        badges: [
          buildBadge('Mod.io', 'info'),
          translatedTitle || translatedDescription ? buildBadge('已翻译', 'default') : null,
          ...((Array.isArray(row?.badges) ? row.badges : []).map((badge) =>
            buildBadge(badge?.text, badge?.tone)
          ) || []),
          ...sourceInfo.badges
        ].filter(Boolean),
        metaGroups: buildMetaGroups([
          [
            buildMetaItem('版本', toDisplayText(raw?.version)),
            buildMetaItem('安装时间', toDisplayText(raw?.installedAt || raw?.installed_at)),
            buildMetaItem('来源', 'Mod.io')
          ],
          [
            buildMetaItem('模组 ID', toDisplayText(raw?.modId || raw?.mod_id)),
            buildMetaItem('文件 ID', toDisplayText(raw?.optionId || raw?.option_id))
          ]
        ]),
        description:
          translatedDescription ||
          toDisplayText(raw?.description || raw?.summary || row?.desc, uiText('ui.installedModIoMod')),
        noteText: joinCardNotes([
          raw.updateError ? uiText('ui.updateCheckFailedValue', { value1: (raw.updateError) }) : raw.updateHint,
          row?.hints?.[0] || '',
          sourceInfo.isMissing ? '源文件已缺失，可清除记录或重新下载安装。' : '',
          sourceInfo.isLockFailed ? '源文件加锁失败，可能影响防删保护。' : ''
        ]),
        noteTone: sourceInfo.isMissing
          ? 'danger'
          : row?.status?.tone === 'warning'
            ? 'warning'
            : 'default',
        interactive: false,
        disabled: loading,
        toggle: {
          visible: row?.toggle?.visible !== false,
          checked: !!row?.toggle?.checked,
          disabled: !!row?.toggle?.disabled || loading || sourceInfo.isMissing,
          loading,
          title: sourceInfo.toggleDisabledReason || row?.toggle?.disabledReason || ''
        },
        actions: [
          ...((Array.isArray(row?.actions) ? row.actions : [])
            .filter((action) => action?.visible !== false)
            .map((action) => ({
              key: action.key,
              label: action.key === 'update-modio' ? uiText('ui.updateMod') : action.label,
              tone:
                action.key === 'update-modio'
                  ? 'accent'
                  : action.key === 'run-executable'
                    ? 'accent'
                    : action.key === 'open-source-page'
                      ? 'info'
                      : 'default',
              disabled: !!action.disabled || loading,
              loading: action.key === 'update-modio' ? !!modioUpdatingMap.value[rowId] : false,
              loadingText: action.key === 'update-modio' ? uiText('ui.updating') : uiText('ui.processingVariant3'),
              title: ''
            })) || []),
          sourceInfo.isEnabled
            ? null
            : {
                key: 'delete',
                labelKey: 'ui.deleteMod', get label() { return uiText('ui.deleteMod') },
                tone: 'danger',
                disabled: loading,
                loading,
                get loadingText() { return uiText('ui.deletingVariant2') },
                title: sourceInfo.uninstallDisabledReason
              },
          sourceInfo.retryLockAvailable ? buildRetryLockAction(loading) : null,
          sourceInfo.isMissing ? buildClearRecordAction(loading) : null
        ].filter(Boolean),
        raw
      }
    })
  }

  function buildLocalLibraryCard(item = {}) {
    const metadata = getLocalLibraryMetadata(item)
    const itemId = getLocalLibraryItemId(item)
    const displayName = getLocalLibraryDisplayName(item)
    const sourceLabel = getLocalLibrarySourceLabel(item)
    const sourcePlatform = getLocalLibrarySourcePlatform(item)
    const sourceType = getLocalLibraryNormalizedSource(item) || activeSource.value
    const profileName = getLocalLibraryProfileName(item)
    const libraryRoot = String(item?.library_root_path || item?.libraryRootPath || '').trim()
    const sourceRoot = String(metadata.sourceRoot || '').trim()
    const archivedSourcePath = String(metadata.archivedSourcePath || '').trim()
    const importOriginPath = String(item?.import_origin_path || item?.importOriginPath || '').trim()
    const sourcePath = archivedSourcePath || sourceRoot || libraryRoot || importOriginPath
    const fileCount = Number(item?.file_count ?? metadata.fileCount ?? 0)
    const dirCount = Number(metadata.dirCount || 0)
    const sizeBytes = Number(metadata.sizeBytes || item?.sizeBytes || item?.file_size || 0)
    const importSourceType = String(item?.import_source_type || item?.importSourceType || '').trim()
    const loading = !!localLibraryTaskLoadingMap.value[String(itemId)]
    const hasCreatedTask = !!String(metadata.lastTaskId || item?.lastTaskId || '').trim()

    return {
      key: `local-library-${itemId}`,
      source: sourceType,
      priorityOrder: Number.MAX_SAFE_INTEGER,
      deployDomain: '',
      installModel: 'local-library',
      lastReconcileAt: String(item?.updated_at || item?.updatedAt || '').trim(),
      prioritySortable: false,
      title: displayName,
      listTitle: displayName,
      subtitle: `${sourceLabel} / ${toDisplayText(profileName, 'default')}`,
      coverUrl: String(item?.cover_path || item?.coverPath || '').trim(),
      fallbackText: getDisplayInitial(displayName),
      status: {
        get text() { return uiText('ui.assetLibrary') },
        tone: 'info'
      },
      badges: [
        buildBadge('资产库', 'info'),
        buildBadge(
          hasCreatedTask ? '已创建任务' : '未安装',
          hasCreatedTask ? 'success' : 'default'
        ),
        sourcePlatform && sourcePlatform !== 'local' ? buildBadge(sourceLabel, 'default') : null
      ].filter(Boolean),
      metaGroups: buildMetaGroups([
        [
          buildMetaItem('版本', toDisplayText(item?.version, '--')),
          buildMetaItem('体积', formatFileSize(sizeBytes)),
          buildMetaItem('文件数', fileCount ? uiText('ui.valueItems', { value1: (fileCount) }) : '')
        ],
        [
          buildMetaItem('导入时间', formatDate(item?.created_at || item?.createdAt)),
          buildMetaItem('来源', sourceLabel),
          buildMetaItem('管理配置', toDisplayText(profileName, 'default'))
        ],
        [
          buildMetaItem('资产类型', toDisplayText(importSourceType, '--')),
          buildMetaItem('目录数', dirCount ? uiText('ui.valueItems', { value1: (dirCount) }) : ''),
          buildMetaItem('原始路径', importOriginPath || '--')
        ],
        [buildMetaItem('资产路径', sourcePath || libraryRoot || '--')]
      ]),
      description:
        String(item?.description || '').trim() ||
        uiText('ui.thisItemIsAnInstallableAssetItIsDeployedTo'),
      noteText: hasCreatedTask
        ? '该资产已创建过安装任务，可按需再次加入任务。'
        : '资产库条目尚未安装到游戏目录，可先加入安装任务。',
      noteTone: hasCreatedTask ? 'success' : 'info',
      interactive: false,
      disabled: loading,
      toggle: {
        visible: false,
        checked: false,
        disabled: true,
        loading: false,
        title: ''
      },
      actions: [
        {
          key: 'install-local-library',
          labelKey: 'ui.addToInstallationTasks', get label() { return uiText('ui.addToInstallationTasks') },
          tone: 'accent',
          disabled: loading,
          loading,
          get loadingText() { return uiText('ui.creating') }
        },
        {
          key: 'open-local-library',
          labelKey: 'taskCenter.downloads.openFolder', get label() { return uiText('taskCenter.downloads.openFolder') },
          tone: 'default',
          disabled: loading || !itemId
        },
        {
          key: 'delete',
          labelKey: 'ui.removeAssetRecord', get label() { return uiText('ui.removeAssetRecord') },
          tone: 'danger',
          disabled: loading || !itemId
        }
      ],
      raw: {
        ...item,
        id: itemId,
        name: displayName,
        displayName,
        localLibrary: true,
        sourceKind: 'local_library',
        installModel: 'local-library',
        libraryItemId: itemId,
        sourcePlatform: item?.source_platform || item?.sourcePlatform || '',
        sourceProfile: profileName,
        sourcePath,
        archivePath: archivedSourcePath,
        stagingPath: sourceRoot,
        targetPath: libraryRoot,
        primaryInstallPath: sourceRoot || archivedSourcePath,
        installRoot: libraryRoot,
        fileSize: sizeBytes,
        file_size: sizeBytes,
        metadata: {
          ...metadata,
          sourcePath,
          sourceRoot,
          archivedSourcePath,
          libraryRoot,
          importOriginPath
        }
      }
    }
  }

  function buildLocalLibraryCards() {
    return getVisibleLocalLibraryItems().map((item) => buildLocalLibraryCard(item))
  }

  function withLocalLibraryCards(cards = []) {
    return [...(Array.isArray(cards) ? cards : []), ...buildLocalLibraryCards()]
  }

  const currentCards = computed(() => {
    if (activeSource.value === SOURCE_TYPE.THUNDERSTORE) {
      return withLocalLibraryCards(buildThunderstoreCards())
    }
    if (activeSource.value === SOURCE_TYPE.FICSIT) {
      return withLocalLibraryCards(buildFicsitCards())
    }
    if (activeSource.value === SOURCE_TYPE.NEXUS) {
      return withLocalLibraryCards(buildNexusCards())
    }
    if (activeSource.value === SOURCE_TYPE.MODIO) {
      return withLocalLibraryCards(buildModioCards())
    }
    return withLocalLibraryCards(buildVertexCards())
  })

  const normalizedModSearchKeyword = computed(() =>
    String(modSearchKeyword.value || '')
      .trim()
      .toLowerCase()
  )

  function buildCardSearchText(card = {}) {
    const metaText = (Array.isArray(card?.metaGroups) ? card.metaGroups : [])
      .flat()
      .map((item) => `${item?.label || ''} ${item?.value || ''} ${item?.title || ''}`)
      .join(' ')
    const badgeText = (Array.isArray(card?.badges) ? card.badges : [])
      .map((item) => item?.text || '')
      .join(' ')
    const actionText = (Array.isArray(card?.actions) ? card.actions : [])
      .map((item) => item?.label || '')
      .join(' ')

    return [
      card?.title,
      card?.listTitle,
      card?.subtitle,
      card?.description,
      card?.noteText,
      metaText,
      badgeText,
      actionText
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }

  const filteredCards = computed(() => {
    const keyword = normalizedModSearchKeyword.value
    if (!keyword) {
      return currentCards.value
    }
    return currentCards.value.filter((card) => buildCardSearchText(card).includes(keyword))
  })

  const listHeadCount = computed(() => filteredCards.value.length)
  const filteredEnabledCount = computed(() => filteredCards.value.filter((card) => card.toggle?.checked).length)
  const thunderstorePages = computed(() => Math.max(1, Math.ceil(filteredCards.value.length / thunderstorePageSize)))
  const displayCards = computed(() => {
    if (activeSource.value !== SOURCE_TYPE.THUNDERSTORE) return filteredCards.value
    const page = Math.min(Math.max(1, thunderstorePage.value), thunderstorePages.value)
    return filteredCards.value.slice((page - 1) * thunderstorePageSize, page * thunderstorePageSize)
  })

  const selectedCard = computed(() => {
    const key = selectedModKey.value
    if (!key) return null
    return currentCards.value.find((card) => card.key === key) || null
  })

  // 展示层使用完整投影进行筛选和多选，不从已分页的列表推算总量。
  provide('mod-management-list-projection', { cards: currentCards, searchText: buildCardSearchText })

  const selectedRelations = computed(() =>
    buildModManagementRelations(selectedCard.value, currentCards.value)
  )

  const selectedDetailInfo = computed(() => {
    const card = selectedCard.value
    if (!card) return null
    const raw = card.raw || {}
    const source = card.source || activeSource.value

    const stateRows = []
    const keyRows = []
    const installRows = []

    if (isLocalLibraryCard(card)) {
      const metadata = getLocalLibraryMetadata(raw)
      const sizeBytes = Number(metadata.sizeBytes || raw?.fileSize || raw?.file_size || 0)
      stateRows.push({ labelKey: 'ui.assetStatus', get label() { return uiText('ui.assetStatus') }, value: card?.status?.text || '本地资产' })
      keyRows.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: getLocalLibrarySourceLabel(raw) })
      keyRows.push({
        labelKey: 'ui.manageProfile', get label() { return uiText('ui.manageProfile') },
        value: toDisplayText(getLocalLibraryProfileName(raw), 'default')
      })
      keyRows.push({ labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: toDisplayText(raw?.version || raw?.currentVersion) })
      keyRows.push({
        labelKey: 'ui.fileCount', get label() { return uiText('ui.fileCount') },
        value: String(raw?.file_count ?? metadata.fileCount ?? '--')
      })
      installRows.push({
        labelKey: 'ui.importedOn', get label() { return uiText('ui.importedOn') },
        value:
          raw?.created_at || raw?.createdAt ? formatDate(raw?.created_at || raw?.createdAt) : '--'
      })
      installRows.push({
        labelKey: 'ui.assetType', get label() { return uiText('ui.assetType') },
        value: toDisplayText(raw?.import_source_type || raw?.importSourceType, '--')
      })
      installRows.push({
        labelKey: 'ui.assetPath', get label() { return uiText('ui.assetPath') },
        value: toDisplayText(raw?.sourcePath || raw?.installRoot || raw?.library_root_path, '--')
      })
      installRows.push({
        labelKey: 'ui.originalPath', get label() { return uiText('ui.originalPath') },
        value: toDisplayText(raw?.import_origin_path || raw?.importOriginPath, '--')
      })
      if (sizeBytes > 0) {
        installRows.push({ labelKey: 'ui.diskUsage', get label() { return uiText('ui.diskUsage') }, value: formatFileSize(sizeBytes) })
      }

      const infoGroups = [
        buildDetailInfoGroup('状态', stateRows),
        buildDetailInfoGroup('关键字段', keyRows),
        buildDetailInfoGroup('安装信息', installRows)
      ].filter(Boolean)

      return {
        card,
        raw,
        source,
        infoRows: [...stateRows, ...keyRows, ...installRows],
        infoGroups
      }
    }

    // 作者
    if (source === SOURCE_TYPE.THUNDERSTORE) {
      keyRows.push({ labelKey: 'localMod.author', get label() { return uiText('localMod.author') }, value: toDisplayText(raw?.ownerName || raw?.packageOwner) })
    } else if (source === SOURCE_TYPE.NEXUS) {
      keyRows.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: toDisplayText(raw?.sourceLabel, 'Nexus') })
    } else if (source === SOURCE_TYPE.FICSIT) {
      keyRows.push({ labelKey: 'ui.identifier', get label() { return uiText('ui.identifier') }, value: toDisplayText(raw?.modReference) })
    } else if (source === SOURCE_TYPE.MODIO) {
      keyRows.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: 'Mod.io' })
    } else {
      keyRows.push({ labelKey: 'ui.profile', get label() { return uiText('ui.profile') }, value: toDisplayText(raw?.option_name, '默认') })
    }

    // 版本
    keyRows.push({ labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: toDisplayText(raw?.version || raw?.currentVersion) })

    if (source !== SOURCE_TYPE.THUNDERSTORE) {
      stateRows.push({
        labelKey: 'ui.enabledState', get label() { return uiText('ui.enabledState') },
        value: card?.status?.text || '已安装'
      })
      stateRows.push({
        labelKey: 'ui.orderValue', get label() { return uiText('ui.orderValue') },
        value: String(card?.priorityOrder || raw?.priority_order || raw?.priorityOrder || 0)
      })
      stateRows.push({
        labelKey: 'ui.deploymentType', get label() { return uiText('ui.deploymentType') },
        value: resolveDeployTypeText(card, raw)
      })
      installRows.push({
        labelKey: 'ui.deploymentScope', get label() { return uiText('ui.deploymentScope') },
        value: toDisplayText(card?.deployDomain || raw?.deploy_domain || raw?.deployDomain, '--')
      })
      installRows.push({
        labelKey: 'ui.managementModel', get label() { return uiText('ui.managementModel') },
        value: toDisplayText(
          card?.installModel || raw?.install_model || raw?.installModel,
          'legacy'
        )
      })
      installRows.push({
        labelKey: 'ui.rebuildStatus', get label() { return uiText('ui.rebuildStatus') },
        value:
          card?.lastReconcileAt || raw?.last_reconcile_at || raw?.lastReconcileAt
            ? '已协调'
            : '待协调'
      })
    }

    // 安装时间
    const installTime = raw?.created_at || raw?.installedAt || raw?.updatedAt || ''
    installRows.push({ labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: installTime ? formatDate(installTime) : '--' })

    // 文件数
    if (source === SOURCE_TYPE.THUNDERSTORE) {
      keyRows.push({ labelKey: 'ui.fileCount', get label() { return uiText('ui.fileCount') }, value: String(raw?.fileCount ?? '--') })
    }

    // 来源 / 社区
    if (source === SOURCE_TYPE.THUNDERSTORE) {
      keyRows.push({ labelKey: 'ui.communityVariant2', get label() { return uiText('ui.communityVariant2') }, value: toDisplayText(thunderstoreCommunity.value) })
      installRows.push({
        labelKey: 'ui.manageProfile', get label() { return uiText('ui.manageProfile') },
        value: toDisplayText(thunderstoreProfile.value, 'default')
      })
    } else if (source === SOURCE_TYPE.FICSIT) {
      keyRows.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: 'Ficsit' })
      if (raw?.ruleId) {
        installRows.push({ labelKey: 'ui.matchedRule', get label() { return uiText('ui.matchedRule') }, value: toDisplayText(raw.ruleId) })
      }
      if (raw?.strategy) {
        installRows.push({ labelKey: 'ui.installationStrategy', get label() { return uiText('ui.installationStrategy') }, value: toDisplayText(raw.strategy) })
      }
    } else if (source === SOURCE_TYPE.NEXUS) {
      keyRows.push({ labelKey: 'ui.identifier', get label() { return uiText('ui.identifier') }, value: toDisplayText(resolvedNexusDomainName.value) })
    } else if (source === SOURCE_TYPE.MODIO) {
      keyRows.push({ labelKey: 'ui.gameID', get label() { return uiText('ui.gameID') }, value: String(resolvedModioGameId.value || '--') })
    } else {
      keyRows.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: 'Vertex 本地' })
    }

    // 安装位置
    if (source === SOURCE_TYPE.THUNDERSTORE && raw?.installLocationText) {
      installRows.push({
        labelKey: 'ui.installationLocation', get label() { return uiText('ui.installationLocation') },
        value: toDisplayText(raw?.installLocationText),
        title: raw?.installLocationTooltip || ''
      })
    }

    // 占用空间
    const fileSize = Number(raw?.file_size || raw?.fileSize || 0)
    if (fileSize > 0) {
      installRows.push({ labelKey: 'ui.diskUsage', get label() { return uiText('ui.diskUsage') }, value: formatFileSize(fileSize) })
    }

    // 类型
    if (source === SOURCE_TYPE.VERTEX) {
      const isDependency = Number(raw?.type_id || 0) === 1
      keyRows.push({ labelKey: 'tools.type', get label() { return uiText('tools.type') }, value: isDependency ? '前置依赖' : '常规模组' })
    }

    const infoGroups = [
      buildDetailInfoGroup('状态', stateRows),
      buildDetailInfoGroup('关键字段', keyRows),
      buildDetailInfoGroup('安装信息', installRows)
    ].filter(Boolean)

    return {
      card,
      raw,
      source,
      infoRows: [...stateRows, ...keyRows, ...installRows],
      infoGroups
    }
  })

  const selectedDetailActions = computed(() => {
    const card = selectedCard.value
    if (!card) return []
    // 复用已有卡片数据中构建的 actions，但排除 delete（详情区单独处理）
    return withModDirectoryAction(card, (Array.isArray(card.actions) ? card.actions : []).filter(
      (a) => a && a.key !== 'delete' && a.key !== 'switch-version'
    ))
  })

  function selectMod(key = '') {
    selectedModKey.value = String(key || '').trim()
  }

  function formatNumber(value) {
    const number = Number(value || 0)
    return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'
  }

  function parseDateValue(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value
    }

    const text = String(value || '').trim()
    if (!text) {
      return null
    }

    const direct = new Date(text)
    return Number.isNaN(direct.getTime()) ? null : direct
  }

  function getDateTimestamp(value) {
    const date = parseDateValue(value)
    return date ? date.getTime() : 0
  }

  function getDisplayInitial(text) {
    const raw = String(text || '').trim()
    if (!raw) {
      return '?'
    }
    return raw.charAt(0).toUpperCase()
  }

  function formatLocalDateTime(dateString = '') {
    if (!dateString) return '--'
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return '--'
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  function formatFileSize(bytes) {
    return common.formatBytes(bytes)
  }

  function formatDate(dateString) {
    if (!dateString) return '--'
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return '--'
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  }

  return {
    activeList,
    activeListCount,
    activeTabLabel,
    uninstallProgressText,
    resolveModDisplayName,
    toDisplayText,
    resolveFicsitDisableBlockedReason,
    resolveFicsitUninstallBlockedReason,
    getLocalBindingSourceLabel,
    isManagedModEnabled,
    currentCards,
    normalizedModSearchKeyword,
    displayCards,
    listHeadCount,
    filteredEnabledCount,
    thunderstorePages,
    selectedCard,
    selectedRelations,
    selectedDetailInfo,
    selectedDetailActions,
    selectMod,
    formatNumber,
    getDateTimestamp,
    getDisplayInitial,
    formatFileSize,
    formatDate
  }
}
