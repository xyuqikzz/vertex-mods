import { clientI18n } from '../../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createModManageProtocolV1 } from '../mod-manage-protocol.js'

function toSafeList(value) {
  return Array.isArray(value) ? value : []
}

function toSafeMap(value) {
  return value && typeof value === 'object' ? value : {}
}

function toText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function getDisplayInitial(text) {
  const raw = toText(text)
  if (!raw) {
    return '?'
  }
  return raw.charAt(0).toUpperCase()
}

export function buildModioModManageProtocol(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const rowsSource = toSafeList(source.rows)
  const operationMap = toSafeMap(source.operationMap)
  const batchBusy = !!source.batchLoading || !!source.loading

  const rows = rowsSource.map((item) => {
    const rowId = Number(item?.id || 0)
    const isBusy = !!operationMap[rowId] || batchBusy
    const isEnabled = Number(item?.isActive ?? item?.is_active ?? 1) === 1
    const hasInstallRoot = !!toText(
      item?.stagingPath || item?.targetPath || item?.primaryInstallPath
    )
    const hasSourcePage = !!toText(item?.sourcePageUrl || item?.profileUrl || item?.downloadUrl)
    const hasUpdate = !!item?.hasUpdate
    const isRunnable = !!item?.isRunnable
    const latestVersion = toText(item?.latestVersion || item?.updateInfo?.latestVersion || '--')
    const runLabel = item?.isInjectable || item?.canInjectLaunch ? '注入启动' : '运行'

    return {
      key: rowId || toText(item?.sourceModKey || item?.modId || item?.name),
      title: toText(item?.displayName || item?.name || item?.optionName || '--') || '--',
      subtitle: toText(item?.optionName || item?.version || item?.sourceModKey || '--') || '--',
      desc: toText(item?.description || item?.summary || '已通过 Mod.io 安装到当前游戏目录'),
      iconUrl: toText(item?.cover || item?.iconUrl),
      fallbackText: getDisplayInitial(item?.displayName || item?.name || item?.optionName),
      meta: [
        { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: toText(item?.version || '--') || '--' },
        { labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: 'Mod.io' },
        {
          labelKey: 'ui.installationLocation', get label() { return uiText('ui.installationLocation') },
          value: toText(item?.installLocationText || item?.targetRelativePath || '--') || '--',
          title: toText(item?.targetPath || item?.primaryInstallPath)
        },
        { labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: toText(item?.installedAt || '--') || '--' }
      ],
      badges: [
        hasUpdate ? { get text() { return uiText('modBrowser.updateAvailable') }, tone: 'warning' } : null,
        isRunnable ? { get text() { return uiText('ui.runnable') }, tone: 'success' } : null
      ].filter(Boolean),
      status: {
        text: hasUpdate ? uiText('ui.updateAvailableValue', { value1: (latestVersion) }) : isEnabled ? uiText('ui.enabled') : uiText('ui.disabled'),
        tone: hasUpdate ? 'warning' : isEnabled ? 'success' : 'default'
      },
      relations: {
        summary: '',
        warning: ''
      },
      hints: hasUpdate ? [uiText('ui.updateAvailableTargetVersionValue', { value1: (latestVersion) })] : [],
      toggle: {
        visible: true,
        checked: isEnabled,
        loading: isBusy,
        disabled: isBusy,
        disabledReason: ''
      },
      uninstall: {
        visible: true,
        loading: isBusy,
        disabled: isBusy,
        disabledReason: '',
        get confirmText() { return uiText('ui.uninstallThisModIoMod') }
      },
      actions: [
        {
          key: 'run-executable',
          label: runLabel,
          visible: isRunnable,
          disabled: isBusy
        },
        {
          key: 'update-modio',
          label: hasUpdate ? uiText('ui.updateMod') : uiText('ui.upToDate'),
          visible: true,
          disabled: !hasUpdate || isBusy
        },
        {
          key: 'open-install-root',
          labelKey: 'ui.openFolder', get label() { return uiText('ui.openFolder') },
          visible: hasInstallRoot,
          disabled: isBusy
        },
        {
          key: 'open-source-page',
          labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') },
          visible: hasSourcePage,
          disabled: isBusy
        }
      ],
      raw: item
    }
  })

  const enabledCount = rows.filter((item) => item.toggle.checked).length
  const disabledCount = rows.length - enabledCount
  const gamePath = toText(source.gamePath)

  return createModManageProtocolV1({
    source: 'modio',
    get title() { return uiText('ui.installedModManagement') },
    summaryText: toText(source.summaryText),
    summaryExtraText: toText(source.summaryExtraText),
    loading: !!source.loading,
    get emptyText() { return uiText('ui.noModIoModsInstalledYet') },
    modalWidth: source.modalWidth || 1120,
    activeTab: 'client',
    scope: source.scopeLabel
      ? {
          label: toText(source.scopeLabel),
          value: toText(source.scopeValue),
          options: toSafeList(source.scopeOptions),
          disabled: !!source.scopeDisabled,
          extraText: toText(source.scopeExtraText)
        }
      : null,
    game: {
      name: toText(source.gameName || 'Mod.io 游戏'),
      logoUrl: toText(source.gameLogoUrl),
      platform: 'Mod.io',
      workspaceLabel: '游戏 ID',
      workspaceValue: toText(source.workspaceValue || '--') || '--',
      statusText: toText(
        source.gameStatusText || (gamePath ? uiText('ui.gameFolderDetected') : uiText('ui.gameFolderNotDetectedYet'))
      ),
      statusTone: toText(source.gameStatusTone || (gamePath ? 'success' : 'warning')) || 'default',
      pathLabel: '游戏目录',
      pathValue: gamePath,
      pathHint: toText(source.pathHint),
      stats: [
        { labelKey: 'tools.installed', get label() { return uiText('tools.installed') }, value: String(rows.length), accent: true },
        { labelKey: 'ui.enabled', get label() { return uiText('ui.enabled') }, value: String(enabledCount), tone: 'success' },
        { labelKey: 'ui.disabled', get label() { return uiText('ui.disabled') }, value: String(disabledCount), tone: 'default' }
      ]
    },
    rows,
    batch: {
      refresh: {
        visible: true,
        labelKey: 'tools.refresh', get label() { return uiText('tools.refresh') },
        loading: !!source.loading,
        disabled: batchBusy
      },
      toggleAll: {
        visible: true,
        enableLabel: '全部启用',
        disableLabel: '全部禁用',
        enableDisabled: batchBusy || disabledCount <= 0,
        disableDisabled: batchBusy || enabledCount <= 0
      },
      uninstallAll: {
        visible: true,
        labelKey: 'ui.uninstallAll', get label() { return uiText('ui.uninstallAll') },
        loading: batchBusy,
        disabled: batchBusy || rows.length <= 0,
        get confirmText() { return uiText('ui.uninstallAllModIoModsForThisGameThisCannot') }
      }
    },
    pagination: {
      visible: false,
      current: 1,
      pageSize: rows.length || 10,
      total: rows.length
    }
  })
}
