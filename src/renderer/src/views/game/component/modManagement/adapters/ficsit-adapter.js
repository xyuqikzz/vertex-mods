import { clientI18n } from '../../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createModManageProtocolV1 } from '../mod-manage-protocol.js'
import { resolveSourcePlatformLabel } from '../../../../../../../shared/sources/source-platform-registry.js'

const FICSIT_SOURCE_LABEL = resolveSourcePlatformLabel('ficsit', 'Ficsit')

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function toText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function isSmlMod(mod) {
  return normalizeText(mod?.modReference) === 'sml'
}

function getDisplayInitial(text) {
  const raw = toText(text)
  if (!raw) {
    return '?'
  }
  return raw.charAt(0).toUpperCase()
}

function formatDateTime(value) {
  const text = toText(value)
  if (!text) {
    return '--'
  }
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }
  return date.toLocaleString('zh-CN')
}

function toSafeList(value) {
  return Array.isArray(value) ? value : []
}

function formatRelationName(item = {}) {
  return toText(item?.name || item?.modReference || item?.sourceModKey)
}

function formatRelationList(list = []) {
  return toSafeList(list).map(formatRelationName).filter(Boolean)
}

export function buildFicsitModManageProtocol(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const clientList = toSafeList(source.clientList)
  const serverList = toSafeList(source.serverList)
  const allMods = [...clientList, ...serverList]

  const hasOtherInstalledMods = allMods.some((mod) => !isSmlMod(mod))
  const hasOtherEnabledMods = allMods.some(
    (mod) => !isSmlMod(mod) && Number(mod?.installState || 0) === 1
  )

  const activeTab = String(source.activeTab || 'client') === 'server' ? 'server' : 'client'
  const activeList = activeTab === 'server' ? serverList : clientList
  const operationMap =
    source.operationMap && typeof source.operationMap === 'object' ? source.operationMap : {}

  const rows = activeList.map((mod) => {
    const id = Number(mod?.id || 0)
    const installState = Number(mod?.installState || 0)
    const isEnabled = installState === 1
    const smlLocked = isSmlMod(mod) && hasOtherInstalledMods
    const smlDisableLocked = isSmlMod(mod) && isEnabled && hasOtherEnabledMods
    const dependencyNames = formatRelationList(mod?.dependencies)
    const dependentNames = formatRelationList(mod?.dependents)
    const activeDependentNames = formatRelationList(mod?.activeDependents)
    const dependencyDisableLocked = activeDependentNames.length > 0
    const dependencyUninstallLocked = dependentNames.length > 0
    const toggleDisabled = smlDisableLocked || dependencyDisableLocked
    const uninstallDisabled = isEnabled || smlLocked || dependencyUninstallLocked

    let toggleDisableReason = ''
    if (smlDisableLocked) {
      toggleDisableReason = '存在其他已启用模组时，SML 不能禁用'
    } else if (dependencyDisableLocked) {
      toggleDisableReason = uiText('ui.enabledModsDependOnThisModValue', { value1: (activeDependentNames.join('、')) })
    }

    let uninstallDisableReason = ''
    if (isEnabled) {
      uninstallDisableReason = '请先禁用该模组再删除'
    } else if (smlLocked) {
      uninstallDisableReason = '存在其他已安装模组时不能删除 SML'
    } else if (dependencyUninstallLocked) {
      uninstallDisableReason = uiText('ui.otherModsDependOnThisModValue', { value1: (dependentNames.join('、')) })
    }

    const hints = [toggleDisableReason, uninstallDisableReason].filter(Boolean)

    return {
      key: id || normalizeText(mod?.modReference) || normalizeText(mod?.name),
      title: toText(mod?.name || '--') || '--',
      subtitle: toText(mod?.modReference || '--') || '--',
      desc: isSmlMod(mod) ? 'SML 是 Ficsit 模组生态的核心加载器，部分操作会受到保护规则限制。' : '',
      iconUrl: toText(mod?.logo),
      fallbackText: getDisplayInitial(mod?.name),
      meta: [
        { labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: 'Ficsit' },
        { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: toText(mod?.version || '--') || '--' },
        { labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: formatDateTime(mod?.installedAt) },
        { labelKey: 'taskCenter.detail.facts.updated', get label() { return uiText('taskCenter.detail.facts.updated') }, value: formatDateTime(mod?.updatedAt) }
      ],
      badges: [
        isSmlMod(mod) ? { get text() { return uiText('ui.coreLoader') }, tone: 'info' } : null,
        isEnabled ? { get text() { return uiText('ui.enabled') }, tone: 'success' } : null
      ].filter(Boolean),
      status: {
        text: isEnabled ? uiText('ui.enabled') : uiText('ui.disabled'),
        tone: isEnabled ? 'success' : 'default'
      },
      relations: {
        summary: dependencyNames.length
          ? uiText('ui.dependenciesValue', { value1: (dependencyNames.join('、')) })
          : isSmlMod(mod)
            ? uiText('ui.sMLDependencyProtectionEnabled')
            : '',
        warning: toggleDisableReason || uninstallDisableReason,
        dependencies: dependencyNames,
        dependents: dependentNames
      },
      hints,
      toggle: {
        visible: true,
        checked: isEnabled,
        loading: !!operationMap[id],
        disabled: toggleDisabled,
        disabledReason: toggleDisableReason
      },
      uninstall: {
        visible: true,
        loading: !!operationMap[id],
        disabled: uninstallDisabled,
        disabledReason: uninstallDisableReason,
        get confirmText() { return uiText('ui.deleteThisModVariant2') }
      },
      actions: [],
      raw: mod
    }
  })

  const enabledCount = rows.filter((item) => item.toggle.checked).length
  const disabledCount = rows.length - enabledCount
  const gamePath = toText(source.gamePath)

  return createModManageProtocolV1({
    source: 'ficsit',
    get title() { return uiText('ui.installedModManagement') },
    summaryText: uiText('ui.currentGroupValueValueModsTotal', { value1: (activeTab === 'server' ? uiText('ui.server') : uiText('ui.client')), value2: (rows.length) }),
    summaryExtraText: toText(source.summaryExtraText),
    loading: !!source.loading,
    get emptyText() { return uiText('ui.noModsInstalled') },
    modalWidth: source.modalWidth || 1120,
    scope: source.scopeLabel
      ? {
          label: toText(source.scopeLabel),
          value: toText(source.scopeValue),
          options: toSafeList(source.scopeOptions),
          disabled: !!source.scopeDisabled,
          extraText: toText(source.scopeExtraText)
        }
      : null,
    tabs: source.showServerTab
      ? [
          {
            key: 'client',
            labelKey: 'ui.client', get label() { return uiText('ui.client') },
            count: clientList.length
          },
          {
            key: 'server',
            labelKey: 'ui.server', get label() { return uiText('ui.server') },
            count: serverList.length
          }
        ]
      : [
          {
            key: 'client',
            labelKey: 'ui.client', get label() { return uiText('ui.client') },
            count: clientList.length
          }
        ],
    activeTab,
    game: {
      name: toText(source.gameName || '幸福工厂') || '幸福工厂',
      logoUrl: toText(source.gameLogoUrl),
      platform: toText(source.platformLabel || FICSIT_SOURCE_LABEL) || FICSIT_SOURCE_LABEL,
      workspaceLabel: toText(source.workspaceLabel || '当前分组') || '当前分组',
      workspaceValue: activeTab === 'server' ? '服务端' : '客户端',
      statusText: toText(
        source.gameStatusText || (gamePath ? uiText('ui.gamePathDetected') : uiText('ui.gamePathNotDetectedYet'))
      ),
      statusTone: toText(source.gameStatusTone || (gamePath ? 'success' : 'warning')) || 'default',
      pathLabel: toText(source.pathLabel || '安装路径') || '安装路径',
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
        disabled: false
      },
      toggleAll: {
        visible: true,
        enableLabel: '全部启用',
        disableLabel: '全部禁用',
        enableDisabled: !!source.loading || disabledCount <= 0,
        disableDisabled: !!source.loading || enabledCount <= 0
      },
      uninstallAll: {
        visible: true,
        labelKey: 'ui.deleteAll', get label() { return uiText('ui.deleteAll') },
        loading: !!source.loading,
        disabled: !!source.loading || rows.length <= 0,
        get confirmText() { return uiText('ui.deleteAllModsThisCannotBeUndone') }
      }
    }
  })
}
