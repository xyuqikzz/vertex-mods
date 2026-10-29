import { clientI18n } from '../../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createModManageProtocolV1 } from '../mod-manage-protocol.js'
import { resolveSourcePlatformLabel } from '../../../../../../../shared/sources/source-platform-registry.js'

const THUNDERSTORE_SOURCE_LABEL = resolveSourcePlatformLabel('thunderstore', 'Thunderstore')

function toSafeList(value) {
  return Array.isArray(value) ? value : []
}

function toText(value, fallback = '') {
  if (value && typeof value === 'object') {
    const source = Array.isArray(value) ? value[0] : value
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      return toText(
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
  return String(value ?? fallback).trim()
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value)
  }

  const text = toText(value)
  if (!text) {
    return null
  }

  if (/^\d+$/.test(text)) {
    const timestamp = Number(text)
    if (Number.isFinite(timestamp)) {
      return new Date(text.length === 10 ? timestamp * 1000 : timestamp)
    }
  }

  const directDate = new Date(text)
  if (!Number.isNaN(directDate.getTime())) {
    return directDate
  }

  const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) {
    return null
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

function formatDateTime(value) {
  const date = parseDateValue(value)
  if (!date) {
    return '--'
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })
}

function getDisplayInitial(text) {
  const raw = toText(text)
  if (!raw) {
    return '?'
  }
  return raw.charAt(0).toUpperCase()
}

function toOperationMap(value) {
  return value && typeof value === 'object' ? value : {}
}

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function buildThunderstoreModManageProtocol(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const rowsSource = toSafeList(source.rows)
  const uninstallingMap = toOperationMap(source.uninstallingMap)
  const togglingMap = toOperationMap(source.togglingMap)
  const updatingMap = toOperationMap(source.updatingMap)
  const versionDialogLoadingMap = toOperationMap(source.versionDialogLoadingMap)

  const rows = rowsSource.map((item) => {
    const fullName = toText(item?.fullName)
    const isUninstalling = !!uninstallingMap[fullName]
    const isToggling = !!togglingMap[fullName]
    const isUpdating = !!updatingMap[fullName]
    const isVersionDialogLoading = !!versionDialogLoadingMap[String(fullName || '').toLowerCase()]
    const hasInstallRoot = !!toText(item?.installRoot)
    const hasPackageUrl = !!toText(item?.packageUrl)
    const enabled = Number(item?.installState ?? item?.isActive ?? 0) === 1
    const hasUpdate = !!item?.hasUpdate
    const dependencyCount = toCount(item?.dependencyCount)
    const disabledDependencyPackageNames = toSafeList(item?.disabledDependencyPackageNames)
      .map((name) => toText(name))
      .filter(Boolean)
    const hasDisabledDependencies = enabled && disabledDependencyPackageNames.length > 0
    const fileCount = toCount(item?.fileCount)
    const latestVersion = toText(item?.latestVersion || '--') || '--'
    const installLocationText =
      toText(item?.installLocationText || 'BepInEx\\plugins') || 'BepInEx\\plugins'
    const relationSummary = dependencyCount > 0 ? uiText('ui.valueDependencies', { value1: (dependencyCount) }) : ''
    const hints = []

    if (hasUpdate) {
      hints.push(uiText('ui.updateAvailableTargetVersionValue', { value1: (latestVersion) }))
    }
    return {
      key: fullName || toText(item?.displayName),
      title: toText(item?.displayName || item?.fullName || '--') || '--',
      subtitle: fullName || '--',
      desc: toText(item?.description || '暂无在线描述，模组已安装到当前配置。'),
      iconUrl: toText(item?.iconUrl),
      fallbackText: toText(
        item?.displayInitial || getDisplayInitial(item?.displayName || item?.fullName)
      ),
      meta: [
        { labelKey: 'localMod.author', get label() { return uiText('localMod.author') }, value: toText(item?.ownerName || '--') || '--' },
        { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: toText(item?.version || '--') || '--' },
        { labelKey: 'ui.fileCount', get label() { return uiText('ui.fileCount') }, value: String(fileCount) },
        {
          labelKey: 'ui.installationLocation', get label() { return uiText('ui.installationLocation') },
          value: installLocationText,
          title: toText(item?.installLocationTooltip || item?.primaryInstallPath)
        },
        { labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: formatDateTime(item?.installedAt) }
      ],
      badges: [
        hasDisabledDependencies ? { get text() { return uiText('ui.someDependenciesAreDisabled') }, tone: 'warning' } : null,
        hasUpdate ? { get text() { return uiText('modBrowser.updateAvailable') }, tone: 'warning' } : null,
        dependencyCount > 0 ? { text: uiText('ui.dependencyValue', { value1: (dependencyCount) }), tone: 'info' } : null,
        fileCount > 0 ? { text: uiText('ui.fileValue', { value1: (fileCount) }), tone: 'default' } : null
      ].filter(Boolean),
      status: {
        text: hasUpdate ? uiText('ui.updateAvailableValue', { value1: (latestVersion) }) : enabled ? uiText('ui.enabled') : uiText('ui.disabled'),
        tone: hasUpdate ? 'warning' : enabled ? 'success' : 'default'
      },
      relations: {
        summary: relationSummary,
        warning: hasDisabledDependencies
          ? uiText('ui.disabledDependenciesValue', { value1: (disabledDependencyPackageNames.join('、')) })
          : ''
      },
      hints,
      toggle: {
        visible: true,
        checked: enabled,
        loading: isToggling,
        disabled: !!source.uninstallAllLoading || isUpdating || isUninstalling,
        disabledReason: ''
      },
      uninstall: {
        visible: true,
        loading: isUninstalling,
        disabled: !!source.uninstallAllLoading || isToggling || isUpdating,
        disabledReason: '',
        get confirmText() { return uiText('ui.uninstallThisMod') }
      },
      actions: [
        {
          key: 'switch-version',
          label: isVersionDialogLoading ? uiText('ui.loadingVersions') : uiText('tools.switchVersion'),
          visible: true,
          disabled:
            !!source.uninstallAllLoading ||
            isToggling ||
            isUpdating ||
            isUninstalling ||
            isVersionDialogLoading
        },
        {
          key: 'update-package',
          label: hasUpdate ? uiText('ui.updateMod') : uiText('ui.upToDate'),
          visible: true,
          disabled: !hasUpdate || !!source.uninstallAllLoading || isToggling || isUpdating
        },
        {
          key: 'open-config-files',
          labelKey: 'ui.configurationFile', get label() { return uiText('ui.configurationFile') },
          visible: true,
          disabled: !!source.uninstallAllLoading
        },
        {
          key: 'open-install-root',
          labelKey: 'ui.openFolder', get label() { return uiText('ui.openFolder') },
          visible: enabled && hasInstallRoot,
          disabled: !!source.uninstallAllLoading || !hasInstallRoot
        },
        {
          key: 'open-package-page',
          labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') },
          visible: hasPackageUrl,
          disabled: !!source.uninstallAllLoading
        }
      ],
      raw: item
    }
  })

  const scopeOptions = toSafeList(source.scopeOptions).map((item) => ({
    label: toText(item?.label || item?.value),
    value: item?.value
  }))

  const enabledCount = toCount(source.enabledCount)
  const disabledCount = toCount(source.disabledCount)
  const totalCount = toCount(source.total || rows.length)
  const pathValue = toText(source.profilePath || source.gamePath)

  return createModManageProtocolV1({
    source: 'thunderstore',
    get title() { return uiText('ui.installedModManagement') },
    summaryText: toText(source.summaryText),
    summaryExtraText: toText(source.summaryExtraText),
    loading: !!source.loading,
    get emptyText() { return uiText('ui.noInstalledMods') },
    modalWidth: source.modalWidth || 1180,
    activeTab: 'client',
    scope: {
      label: toText(source.scopeLabel || uiText('ui.manageProfile')) || uiText('ui.manageProfile'),
      value: source.scopeValue,
      options: scopeOptions,
      disabled: !!source.scopeDisabled,
      extraText: toText(source.scopeExtraText)
    },
    game: {
      name: toText(source.gameName || source.communityName || 'Thunderstore 游戏'),
      logoUrl: toText(source.gameLogoUrl),
      platform:
        toText(source.platformLabel || THUNDERSTORE_SOURCE_LABEL) || THUNDERSTORE_SOURCE_LABEL,
      workspaceLabel: toText(source.workspaceLabel || '当前配置') || '当前配置',
      workspaceValue: toText(source.scopeValue || '--') || '--',
      statusText: toText(source.gameStatusText || (pathValue ? uiText('ui.profileDetected') : uiText('ui.profilePathNotDetected'))),
      statusTone: toText(source.gameStatusTone || (pathValue ? 'success' : 'warning')) || 'default',
      pathLabel: toText(source.pathLabel || '配置目录') || '配置目录',
      pathValue,
      pathHint: toText(source.pathHint),
      badges: [
        source.scopeExtraText ? { text: toText(source.scopeExtraText), tone: 'info' } : null
      ].filter(Boolean),
      stats: [
        { labelKey: 'tools.installed', get label() { return uiText('tools.installed') }, value: String(totalCount), accent: true },
        { labelKey: 'ui.enabled', get label() { return uiText('ui.enabled') }, value: String(enabledCount), tone: 'success' },
        { labelKey: 'ui.disabled', get label() { return uiText('ui.disabled') }, value: String(disabledCount), tone: 'default' }
      ]
    },
    rows,
    batch: {
      refresh: {
        visible: !!source.showRefresh,
        labelKey: 'tools.refresh', get label() { return uiText('tools.refresh') },
        loading: !!source.loading,
        disabled: !!source.scopeDisabled
      },
      toggleAll: {
        visible: true,
        enableDisabled:
          !!source.scopeDisabled || !!source.toggleAllLoading || !toCount(source.disabledCount),
        disableDisabled:
          !!source.scopeDisabled || !!source.toggleAllLoading || !toCount(source.enabledCount)
      },
      uninstallAll: {
        visible: true,
        labelKey: 'ui.uninstallAllMods', get label() { return uiText('ui.uninstallAllMods') },
        loading: !!source.uninstallAllLoading,
        disabled: !!source.uninstallAllDisabled,
        confirmText: toText(source.uninstallAllConfirmText || uiText('ui.uninstallAllModsInTheCurrentProfile'))
      }
    },
    pagination: {
      visible: !!source.paginationVisible,
      current: Number(source.currentPage || 1),
      pageSize: Number(source.pageSize || 8),
      total: Number(source.total || 0)
    }
  })
}
