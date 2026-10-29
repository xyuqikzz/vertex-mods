import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed } from 'vue'
import { useSourceDescriptionTranslation } from '@renderer/composables/source-description-translation.js'
import {
  formatInstallCount,
  formatInstallDate,
  formatInstallDateTime,
  formatInstallSize
} from './install-confirm-format.js'

// 依赖预览最多显示 4 条，其余在执行时自动解析。
export const VERSION_DEPENDENCY_PREVIEW_LIMIT = 4

function pickLatestVersion(item = {}) {
  const itemVersions = Array.isArray(item?.versions) ? item.versions : []
  return itemVersions.find((version) => version?.is_active !== false) || itemVersions[0] || {}
}

export function resolveVersionDescription(item = {}) {
  return String(
    item?.description ||
      item?.changelog ||
      item?.short_description ||
      item?.shortDescription ||
      item?.full_description ||
      item?.fullDescription ||
      ''
  ).trim()
}

/**
 * Thunderstore 与 ficsit.app 共用的「单选版本」安装确认弹窗视图模型。
 * 对外事件保持原样：version-change(versionNumber)、confirm(mode?)、close。
 *
 * options:
 * - source: 翻译来源标识（thunderstore / ficsit）
 * - sourceLabel: 头部来源标签
 * - buildDependencies(list): 把版本依赖解析成 [{ key, packageName, namespace, requiredVersion }]
 * - resolveName(item, fullName) / resolveOwner(item, fullName)
 * - profileLabel: 目标区「配置」行的标签；返回空时不显示该行
 */
export function useVersionInstallDialog(props, emit, options) {
  const modal = computed(() => props.modalState || {})
  const versions = computed(() => (Array.isArray(modal.value.versions) ? modal.value.versions : []))
  const versionDescriptions = useSourceDescriptionTranslation({
    source: options.source,
    systemConfig: () => props.systemConfig,
    active: () => props.open,
    entries: computed(() =>
      versions.value.map((version, index) => ({
        id: `version:${index}`,
        text: resolveVersionDescription(version),
        kind: 'file_description',
        context: uiText('ui.modValue', { value1: (modal.value.item?.name || modal.value.item?.full_name || '--') })
      }))
    )
  })

  const selectedVersionInfo = computed(() => {
    const targetVersion = String(modal.value.versionNumber || '')
    return (
      versions.value.find((item) => String(item?.version_number || '') === targetVersion) || null
    )
  })
  const displayFullName = computed(() => String(modal.value.item?.full_name || '').trim())
  const displayName = computed(() =>
    String(options.resolveName(modal.value.item || {}, displayFullName.value) || '--').trim()
  )
  const displayOwner = computed(() =>
    String(options.resolveOwner(modal.value.item || {}, displayFullName.value) || '').trim()
  )
  const displayIcon = computed(() =>
    String(
      selectedVersionInfo.value?.icon ||
        modal.value.selectedVersionDetail?.icon ||
        pickLatestVersion(modal.value.item || {})?.icon ||
        ''
    ).trim()
  )
  const latestVersionNumber = computed(() =>
    String(pickLatestVersion({ versions: versions.value })?.version_number || '')
  )

  const dependencyItems = computed(() => {
    const modalItems = options.buildDependencies(modal.value.dependencyItems)
    if (modalItems.length) return modalItems
    const detailItems = options.buildDependencies(modal.value.selectedVersionDetail?.dependencies)
    if (detailItems.length) return detailItems
    return options.buildDependencies(selectedVersionInfo.value?.dependencies)
  })
  const selectedDependencyCount = computed(() => {
    const detailCount = Number(modal.value.selectedVersionDetail?.dependencyCount || 0)
    if (Number.isFinite(detailCount) && detailCount > 0) return detailCount
    return dependencyItems.value.length
  })
  const isDependencyResolving = computed(
    () => !!modal.value.versionDetailLoading || !!modal.value.dependencyItemsLoading
  )
  const isSwitch = computed(() => modal.value.mode === 'switch')
  const isDownload = computed(() => modal.value.mode === 'download')
  const showDownloadOnlyAction = computed(() => modal.value.mode === 'install')
  const selectionUnchanged = computed(() => {
    const targetVersion = String(modal.value.versionNumber || '').trim()
    const currentVersion = String(modal.value.currentVersion || '').trim()
    return isSwitch.value && !!targetVersion && !!currentVersion && targetVersion === currentVersion
  })
  const actionDisabled = computed(() => {
    if (!modal.value.versionNumber) return true
    if (
      modal.value.versionListLoading ||
      modal.value.versionDetailLoading ||
      modal.value.confirmLoading
    ) {
      return true
    }
    return selectionUnchanged.value
  })

  const translatedDescriptions = computed(() =>
    versions.value.map((version, index) =>
      versionDescriptions.getText(`version:${index}`, resolveVersionDescription(version))
    )
  )
  const sharedDescription = computed(() => {
    const texts = translatedDescriptions.value
    if (!texts.length || !texts[0]) return ''
    return texts.every((text) => text === texts[0]) ? texts[0] : ''
  })
  const hasSizes = computed(() => versions.value.some((version) => Number(version?.file_size) > 0))
  const columns = computed(() =>
    [
      hasSizes.value ? { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' } : null,
      { key: 'date', get label() { return uiText('ui.releaseDate') }, width: '96px', muted: true },
      { key: 'downloads', get label() { return uiText('ui.downloads') }, width: '112px', align: 'right' }
    ].filter(Boolean)
  )
  const items = computed(() =>
    versions.value.map((version, index) => {
      const versionNumber = String(version?.version_number || '').trim()
      const current =
        !!versionNumber && versionNumber === String(modal.value.currentVersion || '').trim()
      return {
        key: versionNumber || `version-${index}`,
        title: versionNumber || '--',
        monoTitle: true,
        description: sharedDescription.value ? '' : translatedDescriptions.value[index] || '',
        tags: [
          versionNumber && versionNumber === latestVersionNumber.value
            ? { get text() { return uiText('tools.latest') }, tone: 'info' }
            : null,
          current ? { get text() { return uiText('ui.currentlyInstalled') }, tone: 'success' } : null,
          version?.is_active === false ? { get text() { return uiText('modelSettings.disabled') }, tone: 'warning' } : null
        ].filter(Boolean),
        sizeBytes: Number(version?.file_size) || 0,
        sizeText: formatInstallSize(version?.file_size),
        values: {
          size: formatInstallSize(version?.file_size),
          date: version?.date_created ? formatInstallDate(version.date_created) : '',
          dateTitle: version?.date_created ? formatInstallDateTime(version.date_created) : '',
          downloads: formatInstallCount(version?.downloads)
        }
      }
    })
  )
  const selectedKeys = computed(() =>
    modal.value.versionNumber ? [String(modal.value.versionNumber)] : []
  )

  const versionSummary = computed(() => {
    const target = String(modal.value.versionNumber || '').trim()
    if (!target) return null
    if (isSwitch.value) {
      const current = String(modal.value.currentVersion || '').trim()
      const older =
        !!current &&
        target !== current &&
        versions.value.findIndex((v) => String(v?.version_number) === target) >
          versions.value.findIndex((v) => String(v?.version_number) === current)
      return {
        current: current || '--',
        target,
        note: selectionUnchanged.value
          ? uiText('ui.theTargetVersionIsTheSameAsTheInstalledVersion')
          : older
            ? uiText('ui.thisWillDowngradeAndReplaceTheCurrentlyInstalledVersion')
            : uiText('ui.thisWillReplaceTheCurrentlyInstalledVersion'),
        noteTone: older ? 'warning' : ''
      }
    }
    return {
      target,
      tag: target === latestVersionNumber.value ? { get text() { return uiText('tools.latest') }, tone: 'info' } : null
    }
  })

  const dependencies = computed(() => {
    const preview = dependencyItems.value.slice(0, VERSION_DEPENDENCY_PREVIEW_LIMIT)
    const more = Math.max(selectedDependencyCount.value - preview.length, 0)
    const statusText = isDownload.value ? '安装时解析' : '自动安装'
    return {
      state: isDependencyResolving.value ? 'resolving' : 'ready',
      count: selectedDependencyCount.value,
      progressText: preview.length ? '正在补充依赖详情…' : '正在解析依赖…',
      summary:
        !isDependencyResolving.value && selectedDependencyCount.value
          ? {
              text: isDownload.value
                ? uiText('ui.resolveAutomaticallyDuringInstallation')
                : uiText('ui.valueItemsHandledAutomatically', { value1: (selectedDependencyCount.value) }),
              tone: 'muted'
            }
          : null,
      items: preview.map((dependency) => ({
        key: dependency.key,
        name: dependency.packageName,
        meta: [dependency.requiredVersion || '自动匹配版本', dependency.namespace]
          .filter(Boolean)
          .join(' · '),
        status: 'install',
        statusText
      })),
      get emptyText() { return uiText('ui.thisVersionHasNoDependencies') },
      moreText: more > 0 ? uiText('ui.anotherValueDependenciesWillBeResolvedAutomaticallyDuringExecution', { value1: (more) }) : ''
    }
  })

  const target = computed(() => {
    const profileName = String(modal.value.profileName || props.activeProfileName || '').trim()
    const rows = []
    if (props.gameName) rows.push({ get label() { return uiText('taskCenter.table.game') }, value: props.gameName })
    if (options.profileLabel && profileName) {
      rows.push({ label: options.profileLabel, value: profileName })
      rows.push({
        get label() { return uiText('siteDetail.download.writeTo') },
        value: isDownload.value
          ? '下载目录（不写入游戏）'
          : `${options.profileLabel} ${profileName} 的独立目录`,
        small: true
      })
    }
    return rows
  })

  const footerHint = computed(() => {
    if (modal.value.versionListLoading) return ''
    if (!versions.value.length) return ''
    if (!modal.value.versionNumber) return '请选择一个版本'
    if (selectionUnchanged.value) return '已是当前版本，请选择其他版本'
    return ''
  })

  const actions = computed(() => {
    const version = String(modal.value.versionNumber || '').trim()
    const loading = !!modal.value.confirmLoading
    if (isSwitch.value) {
      return [
        {
          key: 'primary',
          label: version && !selectionUnchanged.value ? uiText('ui.switchToValue', { value1: (version) }) : uiText('tools.switchVersion'),
          variant: 'primary',
          disabled: actionDisabled.value,
          loading
        }
      ]
    }
    if (isDownload.value) {
      return [
        {
          key: 'primary',
          label: version ? uiText('ui.downloadValue', { value1: (version) }) : uiText('tools.download'),
          variant: 'primary',
          disabled: actionDisabled.value,
          loading
        }
      ]
    }
    return [
      { key: 'download', get label() { return uiText('ui.downloadOnly') }, variant: 'secondary', disabled: actionDisabled.value },
      {
        key: 'primary',
        label: version ? uiText('ui.installValue', { value1: (version) }) : uiText('modBrowser.install'),
        variant: 'primary',
        disabled: actionDisabled.value,
        loading
      }
    ]
  })

  const dialogProps = computed(() => ({
    open: props.open,
    mode: isSwitch.value ? 'switch' : isDownload.value ? 'download' : 'install',
    title: displayName.value,
    subtitle: displayFullName.value,
    subtitleMono: true,
    iconUrl: displayIcon.value,
    fallbackInitial: displayName.value,
    sourceLabel: options.sourceLabel,
    meta: [props.gameName || '', displayOwner.value ? uiText('ui.authorValue', { value1: (displayOwner.value) }) : ''],
    loading: !!modal.value.versionListLoading,
    get loadingText() { return uiText('ui.loadingAvailableVersions') },
    get emptyText() { return uiText('ui.noVersionsAvailable') },
    busy: !!modal.value.confirmLoading,
    selectionType: 'single',
    selectionTitle: '选择版本',
    selectionCaption: '最新版本在前',
    nameLabel: '版本',
    columns: columns.value,
    items: items.value,
    selectedKeys: selectedKeys.value,
    sharedDescription: sharedDescription.value,
    planTitle: isSwitch.value ? '切换计划' : isDownload.value ? '下载计划' : '安装计划',
    target: target.value,
    showSelected: false,
    versionSummary: versionSummary.value,
    dependencies: dependencies.value,
    footerHint: footerHint.value,
    actions: actions.value
  }))

  function handleSelect(keys = []) {
    const versionNumber = String(keys[0] || '').trim()
    if (!versionNumber || modal.value.versionListLoading || modal.value.confirmLoading) return
    emit('version-change', versionNumber)
  }

  function handleAction(key) {
    if (actionDisabled.value) return
    if (key === 'download') {
      emit('confirm', 'download')
      return
    }
    emit('confirm', showDownloadOnlyAction.value ? 'install' : undefined)
  }

  function handleClose() {
    emit('close')
  }

  return {
    dialogProps,
    handleSelect,
    handleAction,
    handleClose
  }
}
