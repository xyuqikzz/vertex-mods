<script setup>
import { matchesModMetadataLabel } from './mod-metadata-label.js'
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import AppImage from '@renderer/component/AppImage.vue'
import { createModManageProtocolV1 } from './mod-manage-protocol.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  protocol: { type: Object, default: () => ({}) }
})

const emit = defineEmits([
  'update:open',
  'refresh',
  'tab-change',
  'scope-change',
  'toggle-row',
  'uninstall-row',
  'toggle-all',
  'uninstall-all',
  'page-change',
  'row-action'
])

const safeProtocol = computed(() => createModManageProtocolV1(props.protocol || {}))
const selectedRowKey = ref('')
const confirmDialog = ref({
  open: false,
  type: '',
  row: null,
  title: '',
  message: '',
  confirmLabel: '确认',
  details: []
})

function toText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function normalizeKey(value) {
  return toText(value)
}

function uniqueTextList(list = []) {
  const result = []
  const seen = new Set()
  for (const item of list) {
    const text = toText(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function resolvePanelWidth(value) {
  const numericWidth = Number(value)
  if (Number.isFinite(numericWidth) && numericWidth > 0) return `${numericWidth}px`
  return toText(value) || '1120px'
}

const panelStyle = computed(() => ({
  '--cm-panel-width': resolvePanelWidth(safeProtocol.value.modalWidth)
}))

const gameInfo = computed(() => safeProtocol.value.game || {})
const activeRowsRaw = computed(() =>
  (safeProtocol.value.rows || []).map((item) => item?.raw || item)
)

function syncSelectedRow() {
  const rows = safeProtocol.value.rows || []
  if (!rows.length) {
    selectedRowKey.value = ''
    return
  }
  const exists = rows.some((item) => normalizeKey(item?.key) === normalizeKey(selectedRowKey.value))
  if (!exists) selectedRowKey.value = normalizeKey(rows[0]?.key)
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      selectedRowKey.value = ''
      confirmDialog.value = {
        open: false,
        type: '',
        row: null,
        title: '',
        message: '',
        confirmLabel: '确认',
        details: []
      }
      return
    }
    syncSelectedRow()
  },
  { immediate: true }
)

watch(
  () => safeProtocol.value.rows,
  () => {
    if (props.open) syncSelectedRow()
  },
  { deep: true }
)

const selectedRow = computed(() => {
  const rows = safeProtocol.value.rows || []
  if (!rows.length) return null
  return (
    rows.find((item) => normalizeKey(item?.key) === normalizeKey(selectedRowKey.value)) || rows[0]
  )
})

const selectedRowActions = computed(() =>
  (selectedRow.value?.actions || []).filter((action) => action.visible !== false)
)

const selectedRowHints = computed(() => {
  const row = selectedRow.value
  if (!row) return []
  return uniqueTextList([
    ...(row.hints || []),
    row.relations?.warning,
    row.toggle?.disabledReason,
    row.uninstall?.disabledReason
  ])
})

const paginationInfo = computed(() => {
  const p = safeProtocol.value.pagination
  if (!p || p.visible === false) return null
  const current = p.current || 1
  const pageSize = p.pageSize || 10
  const total = p.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { current, totalPages }
})

const visiblePages = computed(() => {
  const info = paginationInfo.value
  if (!info) return []
  const pages = []
  const delta = 2
  const start = Math.max(1, info.current - delta)
  const end = Math.min(info.totalPages, info.current + delta)
  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push('...')
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < info.totalPages) {
    if (end < info.totalPages - 1) pages.push('...')
    pages.push(info.totalPages)
  }
  return pages
})

function getMetaList(row, limit = 3) {
  return (row?.meta || []).filter((item) => toText(item?.value)).slice(0, limit)
}

function getMetaValue(row, label) {
  return (
    toText((row?.meta || []).find((item) => matchesModMetadataLabel(item, [label]))?.value || '--') || '--'
  )
}

function getPrimaryStatusText(row) {
  return toText(row?.status?.text).split(' / ')[0] || uiText('modBrowser.unknownStatus')
}

function getRowFootText(row) {
  return (
    toText(row?.relations?.summary) ||
    toText(row?.relations?.warning) ||
    uniqueTextList(row?.hints || [])[0] ||
    ''
  )
}

function getQuickActions(row) {
  return (row?.actions || [])
    .filter((action) => action.visible !== false && !action.disabled)
    .slice(0, 2)
}

function selectRow(row) {
  selectedRowKey.value = normalizeKey(row?.key)
}

function onOpenChange(value) {
  if (confirmDialog.value.open) {
    confirmDialog.value.open = false
    return
  }
  emit('update:open', !!value)
}

function onTabChange(value) {
  emit('tab-change', toText(value))
}

function onScopeChange(value) {
  emit('scope-change', value)
}

function getPopupContainer(trigger) {
  return trigger?.closest?.('.cm-overlay') || document.querySelector('.cm-overlay') || document.body
}

function buildRowConfirmDetails(row) {
  if (!row) return []
  return [
    { labelKey: 'ui.mod', get label() { return uiText('ui.mod') }, value: toText(row.title || '--') || '--' },
    toText(row.subtitle) && toText(row.subtitle) !== '--'
      ? { labelKey: 'ui.identifier', get label() { return uiText('ui.identifier') }, value: row.subtitle }
      : null,
    { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: getMetaValue(row, '版本') },
    { labelKey: 'ui.installationLocation', get label() { return uiText('ui.installationLocation') }, value: getMetaValue(row, '安装位置') }
  ].filter(Boolean)
}

function buildBatchConfirmDetails() {
  return [
    gameInfo.value.name ? { labelKey: 'taskCenter.table.game', get label() { return uiText('taskCenter.table.game') }, value: gameInfo.value.name } : null,
    gameInfo.value.platform ? { labelKey: 'ui.platform', get label() { return uiText('ui.platform') }, value: gameInfo.value.platform } : null,
    gameInfo.value.workspaceValue
      ? {
          label: toText(gameInfo.value.workspaceLabel || uiText('ui.workspace')) || uiText('ui.workspace'),
          value: gameInfo.value.workspaceValue
        }
      : null,
    { labelKey: 'modBrowser.count', get label() { return uiText('modBrowser.count') }, value: String((safeProtocol.value.rows || []).length) }
  ].filter(Boolean)
}

function openConfirmDialog(payload = {}) {
  confirmDialog.value = {
    open: true,
    type: toText(payload.type),
    row: payload.row || null,
    title: toText(payload.title || uiText('ui.confirmAction')) || uiText('ui.confirmAction'),
    message: toText(payload.message || uiText('ui.continueWithThisOperation')) || uiText('ui.continueWithThisOperation'),
    confirmLabel: toText(payload.confirmLabel || '确认') || '确认',
    details: Array.isArray(payload.details) ? payload.details.filter(Boolean) : []
  }
}

function onToggleRow(row, checked) {
  const confirmText = toText(row?.toggle?.confirmText)
  if (!checked && confirmText) {
    openConfirmDialog({
      type: 'toggle-row',
      row,
      get title() { return uiText('ui.confirmDisablingMod') },
      message: confirmText,
      confirmLabel: '继续禁用',
      details: buildRowConfirmDetails(row)
    })
    return
  }
  emit('toggle-row', { mod: row?.raw || row, checked: !!checked })
}

function onUninstallRowClick(row) {
  openConfirmDialog({
    type: 'uninstall-row',
    row,
    get title() { return uiText('ui.confirmUninstallingMod') },
    message: toText(row?.uninstall?.confirmText || uiText('ui.uninstallThisMod')),
    confirmLabel: '确认卸载',
    details: buildRowConfirmDetails(row)
  })
}

function onToggleAll(checked) {
  emit('toggle-all', { list: activeRowsRaw.value, checked: !!checked })
}

function onUninstallAllClick() {
  openConfirmDialog({
    type: 'uninstall-all',
    get title() { return uiText('ui.confirmUninstallingAllMods') },
    message: toText(
      safeProtocol.value.batch?.uninstallAll?.confirmText || uiText('ui.uninstallAllModsInTheCurrentWorkspace')
    ),
    confirmLabel: '确认卸载',
    details: buildBatchConfirmDetails()
  })
}

function confirmDangerAction() {
  if (confirmDialog.value.type === 'toggle-row' && confirmDialog.value.row) {
    emit('toggle-row', {
      mod: confirmDialog.value.row?.raw || confirmDialog.value.row,
      checked: false
    })
  } else if (confirmDialog.value.type === 'uninstall-row' && confirmDialog.value.row) {
    emit('uninstall-row', confirmDialog.value.row?.raw || confirmDialog.value.row)
  } else if (confirmDialog.value.type === 'uninstall-all') {
    emit('uninstall-all', activeRowsRaw.value)
  }
  confirmDialog.value.open = false
}

function cancelDangerAction() {
  confirmDialog.value.open = false
}

function onPageChange(page) {
  emit('page-change', Number(page || 1))
}

function onRowAction(row, actionKey) {
  selectRow(row)
  emit('row-action', { actionKey: toText(actionKey), row: row?.raw || row })
}

function isRowDisabled(row) {
  return row?.toggle && row.toggle.visible !== false && row.toggle.checked === false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cm-fade">
      <div v-if="open" class="cm-overlay" @click.self="onOpenChange(false)">
        <div class="cm-panel" :style="panelStyle">
          <div class="cm-panel-header">
            <div class="cm-header-main">
              <div class="cm-logo">
                <AppImage
                  v-if="gameInfo.logoUrl"
                  :src="gameInfo.logoUrl"
                  :alt="gameInfo.name || safeProtocol.title"
                />
                <div v-else class="cm-logo-fallback">
                  {{ (gameInfo.name || safeProtocol.title || 'M').charAt(0).toUpperCase() }}
                </div>
              </div>
              <div class="cm-head-copy">
                <div class="cm-head-top">
                  <span class="cm-window-title">{{ safeProtocol.title }}</span>
                  <span v-if="gameInfo.platform" class="cm-badge">{{ gameInfo.platform }}</span>
                  <span
                    v-for="badge in gameInfo.badges"
                    :key="badge.text"
                    class="cm-badge"
                    :class="badge.tone || 'default'"
                    >{{ badge.text }}</span
                  >
                </div>
                <div class="cm-head-title">
                  <span class="cm-game-name">{{ gameInfo.name || safeProtocol.title }}</span>
                  <span v-if="gameInfo.workspaceValue" class="cm-workspace-chip"
                    >{{ gameInfo.workspaceLabel || $t('ui.currentWorkspace') }}：{{
                      gameInfo.workspaceValue
                    }}</span
                  >
                </div>
                <div v-if="gameInfo.statusText" class="cm-head-status">
                  <span class="cm-status-dot" :class="gameInfo.statusTone || 'default'"></span>
                  <span>{{ gameInfo.statusText }}</span>
                </div>
              </div>
            </div>
            <div class="cm-header-actions">
              <button
                v-if="safeProtocol.batch.refresh.visible"
                class="cm-icon-btn"
                :disabled="
                  safeProtocol.batch.refresh.disabled || safeProtocol.batch.refresh.loading
                "
                @click="emit('refresh')"
              >
                <span v-if="safeProtocol.batch.refresh.loading" class="cm-spinner-small"></span>
                <svg
                  v-else
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
                  <polyline points="12 1 13 3.5 10.5 4.5" />
                  <polyline points="4 15 3 12.5 5.5 11.5" />
                </svg>
              </button>
              <button
                v-if="safeProtocol.batch.uninstallAll.visible"
                class="cm-icon-btn danger"
                :disabled="
                  safeProtocol.batch.uninstallAll.disabled ||
                  safeProtocol.batch.uninstallAll.loading
                "
                @click="onUninstallAllClick"
              >
                <span
                  v-if="safeProtocol.batch.uninstallAll.loading"
                  class="cm-spinner-small"
                ></span>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  ></path>
                </svg>
              </button>
              <div class="cm-divider"></div>
              <button class="cm-icon-btn cm-close" @click="onOpenChange(false)">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  stroke="currentColor"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div v-if="gameInfo.pathValue || gameInfo.stats.length" class="cm-context">
            <div v-if="gameInfo.pathValue" class="cm-path-card">
              <span class="cm-path-label">{{ gameInfo.pathLabel || $t('ui.currentPath') }}</span>
              <span class="cm-path-value" :title="gameInfo.pathValue">{{
                gameInfo.pathValue
              }}</span>
              <span v-if="gameInfo.pathHint" class="cm-path-hint">{{ gameInfo.pathHint }}</span>
            </div>
            <div v-if="gameInfo.stats.length" class="cm-stats">
              <div
                v-for="item in gameInfo.stats"
                :key="`${item.label}-${item.value}`"
                class="cm-stat"
                :class="{ accent: item.accent }"
              >
                <span class="cm-stat-value">{{ item.value }}</span>
                <span class="cm-stat-label">{{ item.label }}</span>
              </div>
            </div>
          </div>

          <div class="cm-workspace">
            <div class="cm-left">
              <div
                v-if="
                  (safeProtocol.tabs && safeProtocol.tabs.length > 0) ||
                  safeProtocol.scope ||
                  safeProtocol.batch.toggleAll.visible
                "
                class="cm-toolbar"
              >
                <div class="cm-toolbar-left">
                  <div
                    v-if="safeProtocol.tabs && safeProtocol.tabs.length > 0"
                    class="cm-segmented"
                  >
                    <button
                      v-for="tab in safeProtocol.tabs"
                      :key="tab.key"
                      class="cm-seg-btn"
                      :class="{ active: safeProtocol.activeTab === tab.key }"
                      @click="onTabChange(tab.key)"
                    >
                      {{ tab.label }}
                      <span v-if="tab.count || tab.count === 0" class="cm-seg-count">{{
                        tab.count
                      }}</span>
                    </button>
                  </div>
                  <div v-if="safeProtocol.scope" class="cm-scope">
                    <span class="cm-scope-label">{{ safeProtocol.scope.label }}</span>
                    <a-select
                      class="cm-scope-select"
                      :value="safeProtocol.scope.value"
                      :options="safeProtocol.scope.options || []"
                      :disabled="safeProtocol.scope.disabled"
                      :get-popup-container="getPopupContainer"
                      dropdown-class-name="cm-dark-dropdown"
                      @change="onScopeChange"
                    />
                    <span v-if="safeProtocol.scope.extraText" class="cm-scope-extra">{{
                      safeProtocol.scope.extraText
                    }}</span>
                  </div>
                </div>
                <div class="cm-toolbar-right">
                  <button
                    v-if="safeProtocol.batch.toggleAll.visible"
                    class="cm-ghost-btn"
                    :disabled="safeProtocol.batch.toggleAll.enableDisabled"
                    @click="onToggleAll(true)"
                  >
                    {{ safeProtocol.batch.toggleAll.enableLabel }}
                  </button>
                  <button
                    v-if="safeProtocol.batch.toggleAll.visible"
                    class="cm-ghost-btn"
                    :disabled="safeProtocol.batch.toggleAll.disableDisabled"
                    @click="onToggleAll(false)"
                  >
                    {{ safeProtocol.batch.toggleAll.disableLabel }}
                  </button>
                </div>
              </div>

              <div
                v-if="safeProtocol.summaryText || safeProtocol.summaryExtraText"
                class="cm-summary"
              >
                <span v-if="safeProtocol.summaryText">{{ safeProtocol.summaryText }}</span>
                <span v-if="safeProtocol.summaryExtraText">{{
                  safeProtocol.summaryExtraText
                }}</span>
              </div>

              <div class="cm-list-head">
                <span class="cm-section-title">{{ $t('modBrowser.listLabel') }}</span>
                <span class="cm-count">{{ safeProtocol.rows.length }}</span>
              </div>

              <div class="cm-content">
                <div v-if="safeProtocol.loading" class="cm-placeholder">
                  <div class="cm-spinner"></div>
                  <span>{{ $t('ui.loadingModData') }}</span>
                </div>

                <div
                  v-else-if="!safeProtocol.rows || !safeProtocol.rows.length"
                  class="cm-placeholder"
                >
                  <div class="cm-placeholder-icon">□</div>
                  <span>{{ safeProtocol.emptyText || $t('ui.noAvailableModsDetected') }}</span>
                </div>

                <div v-else class="cm-list">
                  <div
                    v-for="row in safeProtocol.rows"
                    :key="row.key"
                    class="cm-row"
                    :class="{
                      selected: normalizeKey(row.key) === normalizeKey(selectedRowKey),
                      disabled: isRowDisabled(row)
                    }"
                    tabindex="0"
                    @click="selectRow(row)"
                    @keydown.enter.prevent="selectRow(row)"
                  >
                    <div class="cm-row-accent" :class="row.status?.tone || 'default'"></div>
                    <div class="cm-row-icon">
                      <AppImage v-if="row.iconUrl" :src="row.iconUrl" :alt="row.title" />
                      <div v-else class="cm-logo-fallback">{{ row.fallbackText || 'M' }}</div>
                    </div>
                    <div class="cm-row-main">
                      <div class="cm-row-top">
                        <div class="cm-row-title-box">
                          <span class="cm-row-title">{{ row.title }}</span>
                          <span v-if="row.subtitle && row.subtitle !== '--'" class="cm-row-sub">{{
                            row.subtitle
                          }}</span>
                        </div>
                        <span
                          v-if="row.status && row.status.text"
                          class="cm-status-pill"
                          :class="row.status.tone || 'default'"
                        >
                          {{ getPrimaryStatusText(row) }}
                        </span>
                      </div>
                      <div class="cm-row-meta">
                        <span
                          v-for="item in getMetaList(row)"
                          :key="`${row.key}-${item.label}`"
                          class="cm-meta"
                        >
                          <span class="cm-meta-label">{{ item.label }}</span>
                          <span class="cm-meta-value">{{ item.value }}</span>
                        </span>
                      </div>
                      <div class="cm-row-bottom">
                        <div class="cm-row-badges">
                          <span
                            v-for="badge in row.badges.slice(0, 3)"
                            :key="`${row.key}-${badge.text}`"
                            class="cm-badge"
                            :class="badge.tone || 'default'"
                          >
                            {{ badge.text }}
                          </span>
                        </div>
                        <span v-if="getRowFootText(row)" class="cm-row-note">{{
                          getRowFootText(row)
                        }}</span>
                      </div>
                    </div>
                    <div class="cm-row-side">
                      <div class="cm-row-actions">
                        <button
                          v-for="action in getQuickActions(row)"
                          :key="action.key"
                          class="cm-ghost-btn sm"
                          @click.stop="onRowAction(row, action.key)"
                        >
                          {{ action.label }}
                        </button>
                        <button
                          v-if="row.uninstall && row.uninstall.visible !== false"
                          class="cm-icon-btn danger"
                          :disabled="row.uninstall.disabled || row.uninstall.loading"
                          @click.stop="onUninstallRowClick(row)"
                        >
                          <span v-if="row.uninstall.loading" class="cm-spinner-small"></span>
                          <svg
                            v-else
                            viewBox="0 0 24 24"
                            width="15"
                            height="15"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path
                              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                            ></path>
                          </svg>
                        </button>
                      </div>
                      <div @click.stop>
                        <a-switch
                          v-if="row.toggle && row.toggle.visible !== false"
                          size="small"
                          :checked="row.toggle.checked"
                          :loading="row.toggle.loading"
                          :disabled="row.toggle.disabled"
                          @change="(checked) => onToggleRow(row, checked)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="paginationInfo" class="cm-pager">
                <button
                  class="cm-page-btn"
                  :disabled="paginationInfo.current <= 1"
                  @click="onPageChange(paginationInfo.current - 1)"
                >
                  ‹
                </button>
                <template v-for="(page, index) in visiblePages" :key="index">
                  <span v-if="page === '...'" class="cm-page-dots">...</span>
                  <button
                    v-else
                    class="cm-page-btn"
                    :class="{ active: page === paginationInfo.current }"
                    @click="onPageChange(page)"
                  >
                    {{ page }}
                  </button>
                </template>
                <button
                  class="cm-page-btn"
                  :disabled="paginationInfo.current >= paginationInfo.totalPages"
                  @click="onPageChange(paginationInfo.current + 1)"
                >
                  ›
                </button>
              </div>
            </div>

            <div class="cm-right">
              <template v-if="selectedRow">
                <div class="cm-detail-head">
                  <div class="cm-row-icon lg">
                    <AppImage
                      v-if="selectedRow.iconUrl"
                      :src="selectedRow.iconUrl"
                      :alt="selectedRow.title"
                    />
                    <div v-else class="cm-logo-fallback">{{ selectedRow.fallbackText || 'M' }}</div>
                  </div>
                  <div class="cm-detail-main">
                    <div class="cm-row-top">
                      <span class="cm-detail-title">{{ selectedRow.title }}</span>
                      <span
                        v-if="selectedRow.status && selectedRow.status.text"
                        class="cm-status-pill"
                        :class="selectedRow.status.tone || 'default'"
                      >
                        {{ getPrimaryStatusText(selectedRow) }}
                      </span>
                    </div>
                    <div
                      v-if="selectedRow.subtitle && selectedRow.subtitle !== '--'"
                      class="cm-row-sub"
                    >
                      {{ selectedRow.subtitle }}
                    </div>
                    <div class="cm-row-badges">
                      <span
                        v-for="badge in selectedRow.badges"
                        :key="`${selectedRow.key}-${badge.text}`"
                        class="cm-badge"
                        :class="badge.tone || 'default'"
                      >
                        {{ badge.text }}
                      </span>
                    </div>
                  </div>
                  <div class="cm-detail-toggle">
                    <span>{{ selectedRow.toggle?.checked ? $t('ui.enabled') : $t('ui.disabled') }}</span>
                    <a-switch
                      v-if="selectedRow.toggle && selectedRow.toggle.visible !== false"
                      size="small"
                      :checked="selectedRow.toggle.checked"
                      :loading="selectedRow.toggle.loading"
                      :disabled="selectedRow.toggle.disabled"
                      @change="(checked) => onToggleRow(selectedRow, checked)"
                    />
                  </div>
                </div>

                <div class="cm-detail-scroll">
                  <section v-if="selectedRow.meta.length" class="cm-card">
                    <span class="cm-section-title">{{ $t('ui.basicInformation') }}</span>
                    <div class="cm-kv-grid">
                      <div
                        v-for="item in selectedRow.meta"
                        :key="`${selectedRow.key}-${item.label}`"
                        class="cm-kv"
                      >
                        <span class="cm-kv-label">{{ item.label }}</span>
                        <span class="cm-kv-value" :title="item.title || item.value">{{
                          item.value
                        }}</span>
                      </div>
                    </div>
                  </section>

                  <section
                    v-if="
                      selectedRow.relations?.summary ||
                      selectedRow.relations?.warning ||
                      selectedRowHints.length
                    "
                    class="cm-card"
                  >
                    <span class="cm-section-title">{{ $t('ui.dependenciesAndRisks') }}</span>
                    <div v-if="selectedRow.relations?.summary" class="cm-note info">
                      {{ selectedRow.relations.summary }}
                    </div>
                    <div v-if="selectedRow.relations?.warning" class="cm-note warn">
                      {{ selectedRow.relations.warning }}
                    </div>
                    <div v-if="selectedRowHints.length" class="cm-risk-list">
                      <div v-for="item in selectedRowHints" :key="item" class="cm-risk-item">
                        {{ item }}
                      </div>
                    </div>
                  </section>

                  <section
                    v-if="
                      selectedRowActions.length ||
                      (selectedRow.uninstall && selectedRow.uninstall.visible !== false)
                    "
                    class="cm-card"
                  >
                    <span class="cm-section-title">{{ $t('ui.availableActions') }}</span>
                    <div class="cm-detail-actions">
                      <button
                        v-for="action in selectedRowActions"
                        :key="action.key"
                        class="cm-ghost-btn"
                        :disabled="action.disabled"
                        @click="onRowAction(selectedRow, action.key)"
                      >
                        {{ action.label }}
                      </button>
                      <button
                        v-if="selectedRow.uninstall && selectedRow.uninstall.visible !== false"
                        class="cm-ghost-btn danger"
                        :disabled="selectedRow.uninstall.disabled || selectedRow.uninstall.loading"
                        @click="onUninstallRowClick(selectedRow)"
                      >
                        {{ selectedRow.uninstall.loading ? $t('ui.uninstalling') : $t('ui.uninstallMod') }}
                      </button>
                    </div>
                  </section>
                </div>
              </template>

              <div v-else class="cm-placeholder">
                <div class="cm-placeholder-icon">□</div>
                <span>{{ $t('ui.selectAModOnTheLeftToViewItsDetails') }}</span>
              </div>
            </div>
          </div>

          <Transition name="cm-modal-fade">
            <div v-if="confirmDialog.open" class="cm-backdrop" @click.self="cancelDangerAction">
              <div class="cm-dialog">
                <div class="cm-dialog-icon">!</div>
                <div class="cm-dialog-title">{{ confirmDialog.title }}</div>
                <div class="cm-dialog-text">{{ confirmDialog.message }}</div>
                <div v-if="confirmDialog.details.length" class="cm-dialog-details">
                  <div
                    v-for="item in confirmDialog.details"
                    :key="`${item.label}-${item.value}`"
                    class="cm-dialog-row"
                  >
                    <span>{{ item.label }}</span>
                    <span>{{ item.value }}</span>
                  </div>
                </div>
                <div class="cm-dialog-actions">
                  <button class="cm-ghost-btn" @click="cancelDangerAction">{{ $t('ui.cancel') }}</button>
                  <button class="cm-ghost-btn danger" @click="confirmDangerAction">
                    {{ confirmDialog.confirmLabel }}
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
$ease: cubic-bezier(0.22, 0.68, 0, 1);

.cm-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(7, 11, 17, 0.58);
  backdrop-filter: blur(10px);
}
.cm-panel {
  width: min(var(--cm-panel-width, 1120px), calc(100vw - 40px));
  height: min(760px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(118, 137, 165, 0.18);
  background: linear-gradient(180deg, rgba(23, 30, 43, 0.97), rgba(14, 18, 27, 0.98));
  box-shadow: 0 28px 60px rgba(0, 0, 0, 0.46);
  color: #e7edf7;
}
.cm-panel-header,
.cm-context,
.cm-toolbar,
.cm-list-head,
.cm-pager,
.cm-detail-head,
.cm-dialog-actions {
  display: flex;
  align-items: center;
}
.cm-panel-header {
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(118, 137, 165, 0.12);
}
.cm-header-main,
.cm-head-copy,
.cm-row-title-box,
.cm-detail-main,
.cm-card,
.cm-placeholder,
.cm-dialog {
  display: flex;
  flex-direction: column;
}
.cm-header-main {
  min-width: 0;
  align-items: center;
  flex-direction: row;
  gap: 14px;
}
.cm-logo,
.cm-row-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.cm-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
}
.cm-row-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
}
.cm-row-icon.lg {
  width: 60px;
  height: 60px;
  border-radius: 16px;
}
.cm-logo img,
.cm-row-icon img,
:deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cm-logo-fallback {
  font-size: 20px;
  font-weight: 700;
  color: #9bb8ff;
}
.cm-head-copy {
  min-width: 0;
  gap: 4px;
}
.cm-head-top,
.cm-head-title,
.cm-head-status,
.cm-row-top,
.cm-row-bottom,
.cm-row-meta,
.cm-row-badges,
.cm-row-side,
.cm-row-actions,
.cm-stats,
.cm-toolbar-left,
.cm-toolbar-right,
.cm-scope,
.cm-dialog-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cm-head-title {
  min-width: 0;
}
.cm-window-title,
.cm-section-title,
.cm-path-label,
.cm-kv-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #8c9bb1;
}
.cm-game-name,
.cm-detail-title {
  font-size: 20px;
  font-weight: 700;
  color: #f5f8fd;
  line-height: 1.15;
}
.cm-detail-title {
  font-size: 18px;
}
.cm-workspace-chip,
.cm-status-pill,
.cm-badge,
.cm-count,
.cm-page-btn {
  border-radius: 999px;
}
.cm-workspace-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  min-height: 24px;
  white-space: nowrap;
  border: 1px solid rgba(70, 199, 183, 0.28);
  background: rgba(70, 199, 183, 0.12);
  color: #7ee4d7;
  font-size: 12px;
  line-height: 1;
}
.cm-head-status,
.cm-row-sub,
.cm-row-note,
.cm-desc,
.cm-dialog-text {
  font-size: 12px;
  color: #96a6bc;
  line-height: 1.6;
}
.cm-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #677284;
}
.cm-status-dot.success {
  background: #35c985;
  box-shadow: 0 0 8px rgba(53, 201, 133, 0.45);
}
.cm-status-dot.warning {
  background: #f4b74a;
  box-shadow: 0 0 8px rgba(244, 183, 74, 0.4);
}
.cm-status-dot.info {
  background: #5aa7ff;
  box-shadow: 0 0 8px rgba(90, 167, 255, 0.45);
}
.cm-status-dot.danger,
.cm-status-dot.error {
  background: #e45d6b;
  box-shadow: 0 0 8px rgba(228, 93, 107, 0.4);
}
.cm-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.cm-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.08);
}
.cm-icon-btn,
.cm-ghost-btn,
.cm-page-btn {
  border: 1px solid rgba(118, 137, 165, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #dfe7f5;
  cursor: pointer;
  transition: all 0.2s $ease;
}
.cm-icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cm-ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.cm-ghost-btn.sm {
  min-height: 28px;
  padding: 0 10px;
}
.cm-page-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cm-icon-btn:hover:not(:disabled),
.cm-ghost-btn:hover:not(:disabled),
.cm-page-btn:hover:not(:disabled) {
  background: rgba(90, 167, 255, 0.14);
  border-color: rgba(90, 167, 255, 0.24);
  color: #fff;
}
.cm-icon-btn.danger:hover:not(:disabled),
.cm-ghost-btn.danger:hover:not(:disabled) {
  background: rgba(228, 93, 107, 0.18);
  border-color: rgba(228, 93, 107, 0.24);
  color: #ffcad2;
}
.cm-close:hover:not(:disabled) {
  background: rgba(228, 93, 107, 0.86);
  color: #fff;
}
.cm-icon-btn:disabled,
.cm-ghost-btn:disabled,
.cm-page-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.cm-context {
  justify-content: space-between;
  gap: 14px;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(118, 137, 165, 0.08);
  background: rgba(10, 15, 24, 0.48);
}
.cm-path-card,
.cm-stat,
.cm-summary,
.cm-row,
.cm-card,
.cm-dialog-details,
.cm-note,
.cm-risk-item {
  border: 1px solid rgba(118, 137, 165, 0.1);
  background: rgba(255, 255, 255, 0.03);
}
.cm-path-card {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
}
.cm-path-label {
  display: block;
  line-height: 1.2;
}
.cm-path-value,
.cm-meta-value,
.cm-kv-value {
  color: #eef4fc;
}
.cm-path-value,
.cm-kv-value {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cm-path-value,
.cm-path-hint {
  display: block;
  line-height: 1.4;
  font-family: 'Cascadia Mono', 'JetBrains Mono', monospace;
}
.cm-path-hint {
  font-size: 12px;
  color: #8fa2be;
}
.cm-stats {
  gap: 10px;
}
.cm-stat {
  min-width: 86px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 14px;
}
.cm-stat.accent {
  background: rgba(90, 167, 255, 0.16);
  border-color: rgba(90, 167, 255, 0.24);
}
.cm-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #f4f8ff;
}
.cm-stat-label {
  font-size: 11px;
  color: #92a3ba;
}
.cm-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.92fr);
}
.cm-left,
.cm-right,
.cm-content,
.cm-detail-scroll {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cm-left {
  border-right: 1px solid rgba(118, 137, 165, 0.08);
}
.cm-toolbar {
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(118, 137, 165, 0.08);
}
.cm-segmented {
  display: inline-flex;
  padding: 4px;
  gap: 4px;
  border-radius: 12px;
  border: 1px solid rgba(118, 137, 165, 0.12);
  background: rgba(255, 255, 255, 0.03);
}
.cm-seg-btn {
  border: none;
  border-radius: 9px;
  padding: 7px 12px;
  background: transparent;
  color: #9ba8ba;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cm-seg-btn.active {
  background: rgba(90, 167, 255, 0.18);
  color: #fff;
}
.cm-seg-count {
  margin-left: 6px;
  color: #bfd4ff;
}
.cm-scope-label,
.cm-scope-extra {
  font-size: 12px;
}
.cm-scope-label {
  color: #94a4ba;
}
.cm-scope-extra {
  color: #71c6d8;
}
.cm-scope-select {
  width: 178px;
}
.cm-summary {
  margin: 0 18px 12px;
  padding: 10px 12px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #c8dafe;
  font-size: 12px;
}
.cm-list-head {
  justify-content: flex-start;
  gap: 8px;
  padding: 0 18px 12px;
}
.cm-section-title {
  font-size: 12px;
  color: #f0f4fb;
}
.cm-count {
  min-width: 24px;
  height: 22px;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.06);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #98aabd;
  font-size: 12px;
}
.cm-content,
.cm-detail-scroll {
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 18px 18px;
}
.cm-content::-webkit-scrollbar,
.cm-detail-scroll::-webkit-scrollbar {
  width: 6px;
}
.cm-content::-webkit-scrollbar-thumb,
.cm-detail-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}
.cm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cm-row {
  display: grid;
  grid-template-columns: 4px 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 88px;
  padding: 14px 14px 14px 0;
  border-radius: 14px;
  transition: all 0.22s $ease;
}
.cm-row:hover,
.cm-row:focus-visible,
.cm-row.selected {
  border-color: rgba(90, 167, 255, 0.22);
  background: rgba(90, 167, 255, 0.08);
  outline: none;
}
.cm-row.disabled {
  opacity: 0.72;
}
.cm-row-accent {
  width: 4px;
  align-self: stretch;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.cm-row-accent.success {
  background: #35c985;
}
.cm-row-accent.warning {
  background: #f4b74a;
}
.cm-row-accent.info {
  background: #5aa7ff;
}
.cm-row-accent.danger,
.cm-row-accent.error {
  background: #e45d6b;
}
.cm-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cm-row-title {
  font-size: 14px;
  font-weight: 700;
  color: #f3f7fd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cm-row-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cm-row-top {
  justify-content: space-between;
}
.cm-row-title-box {
  min-width: 0;
}
.cm-row-meta {
  gap: 10px;
}
.cm-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.cm-meta-label {
  color: #7d8da4;
}
.cm-row-bottom {
  justify-content: space-between;
}
.cm-row-note {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cm-row-side {
  justify-content: flex-end;
  padding-right: 14px;
}
.cm-row-actions {
  opacity: 0;
  transform: translateX(8px);
  transition: all 0.18s $ease;
}
.cm-row:hover .cm-row-actions,
.cm-row.selected .cm-row-actions {
  opacity: 1;
  transform: translateX(0);
}
.cm-status-pill,
.cm-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  font-size: 11px;
  font-weight: 600;
  color: #d0ddf0;
  line-height: 1;
  white-space: nowrap;
}
.cm-status-pill {
  min-height: 24px;
  padding: 0 10px;
  font-size: 12px;
}
.cm-status-pill.success,
.cm-badge.success {
  background: rgba(53, 201, 133, 0.1);
  border-color: rgba(53, 201, 133, 0.22);
  color: #7fe1a8;
}
.cm-status-pill.warning,
.cm-badge.warning {
  background: rgba(244, 183, 74, 0.1);
  border-color: rgba(244, 183, 74, 0.22);
  color: #ffd07b;
}
.cm-status-pill.info,
.cm-badge.info {
  background: rgba(90, 167, 255, 0.1);
  border-color: rgba(90, 167, 255, 0.22);
  color: #bcd8ff;
}
.cm-status-pill.danger,
.cm-status-pill.error,
.cm-badge.danger,
.cm-badge.error {
  background: rgba(228, 93, 107, 0.1);
  border-color: rgba(228, 93, 107, 0.22);
  color: #ffbdc7;
}
.cm-right {
  background: linear-gradient(180deg, rgba(12, 17, 25, 0.9), rgba(9, 14, 22, 0.94));
}
.cm-detail-head {
  justify-content: space-between;
  gap: 14px;
  padding: 18px;
  border-bottom: 1px solid rgba(118, 137, 165, 0.08);
}
.cm-detail-main {
  min-width: 0;
  flex: 1;
  gap: 8px;
}
.cm-detail-toggle {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-size: 12px;
  color: #98a8bc;
}
.cm-card {
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
}
.cm-card + .cm-card {
  margin-top: 14px;
}
.cm-desc {
  margin: 0;
  font-size: 13px;
  color: #dae3f0;
}
.cm-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cm-kv {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(118, 137, 165, 0.1);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}
.cm-note {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.6;
}
.cm-note.info {
  background: rgba(90, 167, 255, 0.09);
  border-color: rgba(90, 167, 255, 0.18);
  color: #d9e8ff;
}
.cm-note.warn {
  background: rgba(244, 183, 74, 0.09);
  border-color: rgba(244, 183, 74, 0.18);
  color: #ffe1a6;
}
.cm-risk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cm-risk-item {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(228, 93, 107, 0.08);
  border-color: rgba(228, 93, 107, 0.14);
  color: #ffd0d7;
}
.cm-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.cm-placeholder {
  justify-content: center;
  align-items: center;
  gap: 12px;
  color: #7e8ea5;
}
.cm-placeholder-icon {
  font-size: 28px;
  color: rgba(255, 255, 255, 0.12);
}
.cm-pager {
  justify-content: center;
  gap: 6px;
  padding: 12px 18px 18px;
  border-top: 1px solid rgba(118, 137, 165, 0.06);
}
.cm-page-dots {
  color: #76859a;
}
.cm-page-btn.active {
  background: rgba(90, 167, 255, 0.16);
  border-color: rgba(90, 167, 255, 0.24);
}
.cm-backdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 10, 16, 0.62);
  backdrop-filter: blur(8px);
}
.cm-dialog {
  width: min(480px, calc(100vw - 80px));
  padding: 24px;
  border-radius: 18px;
  border: 1px solid rgba(228, 93, 107, 0.22);
  background: rgba(20, 24, 33, 0.98);
  box-shadow: 0 28px 60px rgba(0, 0, 0, 0.48);
  gap: 14px;
}
.cm-dialog-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(228, 93, 107, 0.12);
  color: #ffb7c1;
  font-size: 22px;
  font-weight: 700;
}
.cm-dialog-title {
  font-size: 18px;
  font-weight: 700;
  color: #f6f8fc;
}
.cm-dialog-text {
  font-size: 13px;
  color: #cdd8e8;
  white-space: pre-wrap;
}
.cm-dialog-details {
  padding: 14px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cm-dialog-row {
  justify-content: space-between;
  align-items: flex-start;
  font-size: 12px;
  color: #eef4fc;
}
.cm-fade-enter-active,
.cm-fade-leave-active,
.cm-modal-fade-enter-active,
.cm-modal-fade-leave-active {
  transition: opacity 0.2s $ease;
}
.cm-fade-enter-from,
.cm-fade-leave-to,
.cm-modal-fade-enter-from,
.cm-modal-fade-leave-to {
  opacity: 0;
}
.cm-spinner,
.cm-spinner-small {
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.cm-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #5aa7ff;
}
.cm-spinner-small {
  width: 13px;
  height: 13px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
:deep(.ant-switch) {
  background-color: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(0, 0, 0, 0.16);
}
:deep(.ant-switch.ant-switch-small) {
  min-width: 36px;
  height: 20px;
  line-height: 20px;
  padding: 0;
}
:deep(.ant-switch.ant-switch-checked) {
  background-color: #35c985;
  border-color: transparent;
}
:deep(.ant-switch.ant-switch-small .ant-switch-handle) {
  top: 50%;
  inset-inline-start: 2px;
  width: 14px;
  height: 14px;
  transform: translateY(-50%);
}
:deep(.ant-switch.ant-switch-small.ant-switch-checked .ant-switch-handle) {
  inset-inline-start: calc(100% - 16px);
}
:deep(.ant-switch:disabled) {
  opacity: 0.45;
}
:deep(.ant-switch .ant-switch-handle::before) {
  background-color: #fff;
  border-radius: 999px;
}
:deep(.ant-select .ant-select-selector) {
  min-height: 32px;
  border-radius: 10px !important;
  border-color: rgba(118, 137, 165, 0.14) !important;
  background: rgba(255, 255, 255, 0.04) !important;
  box-shadow: none !important;
}
:deep(.ant-select .ant-select-selection-item),
:deep(.ant-select .ant-select-selection-placeholder) {
  color: #e8eef8 !important;
  font-size: 12px;
}
:deep(.ant-select-arrow) {
  color: #93a3b9 !important;
}
:deep(.cm-dark-dropdown) {
  padding: 4px;
  border-radius: 12px;
  border: 1px solid rgba(118, 137, 165, 0.16);
  background: rgba(18, 23, 32, 0.98);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.35);
}
:deep(.cm-dark-dropdown .ant-select-item) {
  border-radius: 8px;
  color: #dbe6f5;
}
:deep(.cm-dark-dropdown .ant-select-item-option-active),
:deep(.cm-dark-dropdown .ant-select-item-option-selected) {
  background: rgba(90, 167, 255, 0.12);
}
</style>
