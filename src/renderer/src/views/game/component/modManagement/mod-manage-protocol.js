import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
export const MOD_MANAGE_PROTOCOL_VERSION = 'v1'

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function toSafeObject(value) {
  return value && typeof value === 'object' ? value : {}
}

function toText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function normalizeBadge(item) {
  if (typeof item === 'string') {
    const text = toText(item)
    return text ? { text, tone: 'default', title: '' } : null
  }

  const source = toSafeObject(item)
  const text = toText(source.text || source.label || source.value)
  if (!text) {
    return null
  }

  return {
    text,
    tone: toText(source.tone || 'default') || 'default',
    title: toText(source.title)
  }
}

function normalizeMeta(item) {
  const source = toSafeObject(item)
  return {
    labelKey: toText(source.labelKey),
    label: toText(source.label),
    value: toText(source.value || '--') || '--',
    title: toText(source.title)
  }
}

function normalizeAction(item) {
  const source = toSafeObject(item)
  return {
    key: toText(source.key),
    label: toText(source.label || source.key),
    visible: source.visible !== false,
    disabled: !!source.disabled,
    danger: !!source.danger
  }
}

function normalizeToggle(item) {
  const source = toSafeObject(item)
  return {
    visible: source.visible !== false,
    checked: !!source.checked,
    loading: !!source.loading,
    disabled: !!source.disabled,
    disabledReason: toText(source.disabledReason),
    confirmText: toText(source.confirmText)
  }
}

function normalizeUninstall(item) {
  const source = toSafeObject(item)
  return {
    visible: source.visible !== false,
    loading: !!source.loading,
    disabled: !!source.disabled,
    disabledReason: toText(source.disabledReason),
    confirmText: toText(source.confirmText)
  }
}

function normalizeRelationList(input) {
  return toSafeArray(input)
    .map((item) => {
      if (typeof item === 'string') {
        return toText(item)
      }
      return toText(item?.text || item?.label || item?.value)
    })
    .filter(Boolean)
}

function normalizeRow(item) {
  const source = toSafeObject(item)
  const status = toSafeObject(source.status)
  const relations = toSafeObject(source.relations)

  return {
    key: source.key ?? '',
    title: toText(source.title || '--') || '--',
    subtitle: toText(source.subtitle || '--') || '--',
    desc: toText(source.desc),
    iconUrl: toText(source.iconUrl),
    fallbackText: toText(source.fallbackText || 'M') || 'M',
    meta: toSafeArray(source.meta).map(normalizeMeta),
    badges: toSafeArray(source.badges).map(normalizeBadge).filter(Boolean),
    status: {
      text: toText(status.text),
      tone: toText(status.tone || 'default') || 'default'
    },
    relations: {
      summary: toText(relations.summary),
      warning: toText(relations.warning),
      dependencies: normalizeRelationList(relations.dependencies),
      dependents: normalizeRelationList(relations.dependents)
    },
    hints: toSafeArray(source.hints)
      .map((entry) => toText(entry))
      .filter(Boolean),
    toggle: normalizeToggle(source.toggle),
    uninstall: normalizeUninstall(source.uninstall),
    actions: toSafeArray(source.actions)
      .map(normalizeAction)
      .filter((action) => !!action.key),
    raw: source.raw ?? item
  }
}

function normalizeGameStat(item) {
  const source = toSafeObject(item)
  const label = toText(source.label)
  const value = toText(source.value)
  if (!label && !value) {
    return null
  }

  return {
    label,
    value,
    accent: !!source.accent,
    tone: toText(source.tone || 'default') || 'default'
  }
}

function normalizeGameInfo(game) {
  const source = toSafeObject(game)
  return {
    name: toText(source.name),
    logoUrl: toText(source.logoUrl),
    platform: toText(source.platform),
    workspaceLabel: toText(source.workspaceLabel),
    workspaceValue: toText(source.workspaceValue),
    statusText: toText(source.statusText),
    statusTone: toText(source.statusTone || 'default') || 'default',
    pathLabel: toText(source.pathLabel),
    pathValue: toText(source.pathValue),
    pathHint: toText(source.pathHint),
    badges: toSafeArray(source.badges).map(normalizeBadge).filter(Boolean),
    stats: toSafeArray(source.stats).map(normalizeGameStat).filter(Boolean)
  }
}

export function createModManageProtocolV1(payload = {}) {
  const source = toSafeObject(payload)
  const batch = toSafeObject(source.batch)
  const pagination = toSafeObject(source.pagination)
  const scope = source.scope && typeof source.scope === 'object' ? source.scope : null

  return {
    version: MOD_MANAGE_PROTOCOL_VERSION,
    source: toText(source.source),
    title: toText(source.title || uiText('modBrowser.manage')) || uiText('modBrowser.manage'),
    summaryText: toText(source.summaryText),
    summaryExtraText: toText(source.summaryExtraText),
    loading: !!source.loading,
    emptyText: toText(source.emptyText || uiText('ui.noMods')) || uiText('ui.noMods'),
    modalWidth: source.modalWidth || 960,
    tabs: toSafeArray(source.tabs),
    activeTab: toText(source.activeTab),
    scope,
    game: normalizeGameInfo(source.game),
    rows: toSafeArray(source.rows).map(normalizeRow),
    batch: {
      refresh: {
        visible: batch.refresh?.visible !== false,
        label: toText(batch.refresh?.label || uiText('tools.refresh')) || uiText('tools.refresh'),
        loading: !!batch.refresh?.loading,
        disabled: !!batch.refresh?.disabled
      },
      toggleAll: {
        visible: !!batch.toggleAll?.visible,
        enableLabel: toText(batch.toggleAll?.enableLabel || '全部启用') || '全部启用',
        disableLabel: toText(batch.toggleAll?.disableLabel || '全部禁用') || '全部禁用',
        enableDisabled: !!batch.toggleAll?.enableDisabled,
        disableDisabled: !!batch.toggleAll?.disableDisabled
      },
      uninstallAll: {
        visible: !!batch.uninstallAll?.visible,
        label: toText(batch.uninstallAll?.label || uiText('ui.deleteAll')) || uiText('ui.deleteAll'),
        loading: !!batch.uninstallAll?.loading,
        disabled: !!batch.uninstallAll?.disabled,
        confirmText: toText(batch.uninstallAll?.confirmText)
      }
    },
    pagination: {
      visible: !!pagination.visible,
      current: Number(pagination.current || 1),
      pageSize: Number(pagination.pageSize || 10),
      total: Number(pagination.total || 0)
    }
  }
}
