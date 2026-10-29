<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, inject, nextTick, reactive } from 'vue'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  HolderOutlined,
  MoreOutlined,
  SearchOutlined,
  WarningOutlined
} from '@ant-design/icons-vue'
import ModManagementIcon from './ModManagementIcon.vue'
import ModManagementMenu from './ModManagementMenu.vue'
import {
  VxButton,
  VxCheckbox,
  VxInput,
  VxSegmented,
  VxSwitch,
  VxTag
} from '@renderer/component/vertex-ui'
import { useModManagementControllerContext } from './mod-management-context.js'

const controller = useModManagementControllerContext()
const ui = inject('mod-management-ui')
const vControl = ui.controlDirective
const skeletonRows = [132, 96, 168, 112, 144, 88, 124]
const rowMenu = reactive({ open: false, anchor: null, key: '' })
let shiftClick = false

const orderColumn = computed(() => Boolean(controller.prioritySortSupported))
const dragEnabled = computed(
  () => orderColumn.value && ui.sort === 'default' && ui.filter === 'all' && !ui.keyword && !ui.busy
)
const batchDisabled = computed(() => ({
  enable: ui.busy || !ui.selectedCards.some((card) => ui.canToggle(card, true)),
  disable: ui.busy || !ui.selectedCards.some((card) => ui.canToggle(card, false)),
  update:
    ui.busy ||
    !ui.selectedCards.some(
      (card) =>
        ui.hasUpdate(card) &&
        ui.updateAction(card) &&
        !ui.updateAction(card).disabled &&
        !ui.updateAction(card).loading
    ),
  delete: ui.busy || !ui.selectedCards.some(ui.canDelete)
}))
const sortColumns = [
  { key: 'name', labelKey: 'ui.mod', get label() { return uiText('ui.mod') } },
  { key: 'author', labelKey: 'localMod.author', get label() { return uiText('localMod.author') } },
  { key: 'date', labelKey: 'tools.installDate', get label() { return uiText('tools.installDate') } }
]
const filterName = computed(
  () => ({ enabled: '已启用', disabled: '已禁用', update: '可更新' })[ui.filter] || ''
)
const noResultText = computed(() => {
  const kw = ui.keyword.trim()
  const scope = filterName.value ? uiText('ui.inValue', { value1: (filterName.value) }) : ''
  return kw ? uiText('ui.valueNoModsMatchValue', { value1: (scope), value2: (kw) }) : uiText('ui.valueNoMods', { value1: (scope || uiText('ui.inTheCurrentList')) })
})
// # 列始终显示加载顺序（完整列表中的位置），筛选或换排序时不重新编号。
const rowIndex = computed(() => new Map(ui.cards.map((card, index) => [card.key, index + 1])))
function sortState(key) {
  return ui.sort === key ? (ui.sortDir > 0 ? 'ascending' : 'descending') : 'none'
}
function nameParts(card) {
  const text = ui.title(card)
  const kw = ui.keyword.trim().toLowerCase()
  const index = kw ? text.toLowerCase().indexOf(kw) : -1
  if (index < 0) return { pre: text, hit: '', post: '' }
  return {
    pre: text.slice(0, index),
    hit: text.slice(index, index + kw.length),
    post: text.slice(index + kw.length)
  }
}
function versionText(card) {
  const value = ui.version(card)
  if (value && value !== '--') return value
  return ui.isLocal(card) ? uiText('ui.unspecified') : '—'
}
function hasAuthor(card) {
  const value = ui.author(card)
  return Boolean(value && value !== '--')
}
function authorText(card) {
  if (hasAuthor(card)) return ui.author(card)
  return ui.isLocal(card) ? uiText('ui.localImport') : '—'
}
function issue(card) {
  if (card.raw?.source_status === 'missing') return { tone: 'danger', get text() { return uiText('ui.sourceFilesMissing') } }
  const missing = ui.missingDependencies(card)
  if (missing.length)
    return {
      tone: 'warning',
      get text() { return uiText('ui.missingDependencies') },
      title: uiText('ui.notInstalledValue', { value1: (missing.map((item) => item.title).join('、')) })
    }
  return null
}
function switchTitle(card) {
  if (ui.isUpdating(card)) return uiText('ui.cannotToggleWhileUpdating')
  return card.toggle?.loading
    ? uiText('ui.changingState')
    : card.toggle?.title || `${card.toggle?.checked ? uiText('ui.disable') : uiText('ui.enable')} ${ui.title(card)}`
}
function rowLabel(card) {
  const parts = [ui.title(card)]
  const author = ui.author(card)
  if (author && author !== '--') parts.push(uiText('ui.authorValue', { value1: (author) }))
  parts.push(uiText('ui.versionValue', { value1: (versionText(card)) }))
  if (ui.hasUpdate(card)) parts.push(uiText('ui.updateAvailableValue', { value1: (ui.latestVersion(card) || uiText('ui.newVersion')) }))
  const problem = issue(card)
  if (problem) parts.push(problem.text)
  if (card.toggle?.visible !== false) parts.push(card.toggle?.checked ? '已启用' : '已禁用')
  return parts.join('，')
}
function viewCard(card, event) {
  // 选中文字后的点击不切换详情；键盘触发（目标是按钮本身）不受影响。
  if (event.target !== event.currentTarget && window.getSelection()?.toString()) return
  ui.focusCard(card.key)
}
function handleRowClick(card, event) {
  if (
    event.target.closest(
      'input, button, a, label, select, textarea, [role="switch"], [role="checkbox"]'
    )
  )
    return
  if (window.getSelection()?.toString()) return
  ui.focusCard(card.key)
}
function rememberShift(event) {
  shiftClick = event.shiftKey
}
function check(card, checked) {
  ui.select(card.key, checked, shiftClick)
  shiftClick = false
}
function focusRow(index) {
  const card = ui.visibleCards[index]
  if (!card) return
  ui.focusCard(card.key, { open: false })
  nextTick(() =>
    document
      .querySelector(
        `.mm-compact-item[data-key="${CSS.escape(String(card.key))}"] .mm-mod-name-button`
      )
      ?.focus()
  )
}
function rowKeydown(card, event) {
  const index = ui.visibleCards.findIndex((item) => item.key === card.key)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const next = index + (event.key === 'ArrowDown' ? 1 : -1)
    if (event.shiftKey) {
      const target = ui.visibleCards[next]
      if (target) ui.select(target.key, true, true)
    }
    focusRow(next)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    focusRow(event.key === 'Home' ? 0 : ui.visibleCards.length - 1)
  } else if (event.key === ' ') {
    event.preventDefault()
    ui.select(card.key, !ui.selected.has(card.key))
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    ui.selectVisible(true)
  } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    openRowMenu(card, { rect: event.currentTarget.getBoundingClientRect() })
  } else if (event.key === 'Delete' && ui.canDelete(card)) {
    event.preventDefault()
    controller.handleListItemDelete(card)
  }
}
function preventSpaceClick(event) {
  if (event.key === ' ') event.preventDefault()
}
function openRowMenu(card, anchor) {
  const multi = ui.selected.has(card.key) && ui.selected.size > 1
  if (!multi) ui.focusCard(card.key, { open: false })
  rowMenu.key = card.key
  rowMenu.anchor = anchor
  rowMenu.open = true
}
function openFromPointer(card, event) {
  openRowMenu(card, { x: event.clientX, y: event.clientY })
}
function openFromButton(card, event) {
  openRowMenu(card, { rect: event.currentTarget.getBoundingClientRect() })
}
function directoryAction(card) {
  return (card.actions || []).find((action) =>
    ['open-install-root', 'location', 'open-location', 'open-local-library'].includes(action.key)
  )
}
function pathOf(card) {
  const raw = card.raw || {}
  return String(
    raw.primaryInstallPath || raw.installRoot || raw.installLocationTooltip || raw.sourcePath || ''
  )
}
const menuCard = computed(() => ui.cards.find((card) => card.key === rowMenu.key) || null)
const menuItems = computed(() => {
  const card = menuCard.value
  if (!card) return []
  if (ui.selected.has(card.key) && ui.selected.size > 1) {
    const rows = ui.selectedCards
    const count = (test) => rows.filter(test).length
    const enable = count((item) => ui.canToggle(item, true))
    const disable = count((item) => ui.canToggle(item, false))
    const update = count(
      (item) => ui.hasUpdate(item) && ui.updateAction(item) && !ui.updateAction(item).disabled
    )
    const remove = count(ui.canDelete)
    return [
      { key: 'heading', heading: true, label: uiText('ui.valueItemsSelected', { value1: (ui.selected.size) }) },
      {
        key: 'enable',
        labelKey: 'ui.enable', get label() { return uiText('ui.enable') },
        hint: enable ? String(enable) : '',
        disabled: ui.busy || !enable
      },
      {
        key: 'disable',
        labelKey: 'ui.disable', get label() { return uiText('ui.disable') },
        hint: disable ? String(disable) : '',
        disabled: ui.busy || !disable
      },
      {
        key: 'update',
        labelKey: 'taskCenter.table.updated', get label() { return uiText('taskCenter.table.updated') },
        hint: update ? String(update) : '',
        disabled: ui.busy || !update
      },
      { separator: true },
      {
        key: 'delete',
        labelKey: 'ui.delete', get label() { return uiText('ui.delete') },
        danger: true,
        hint: remove ? uiText('ui.valueItemsCanBeDeleted', { value1: (remove) }) : uiText('ui.disableFirst'),
        disabled: ui.busy || !remove
      }
    ]
  }
  const checked = Boolean(card.toggle?.checked)
  const update = ui.updateAction(card)
  const directory = directoryAction(card)
  const sourceAction = (card.actions || []).find((action) =>
    ['open-source-page', 'open-package-page', 'source'].includes(action.key)
  )
  const configAction = (card.actions || []).find((action) => action.key === 'open-config-files')
  const items = []
  if (card.toggle?.visible !== false)
    items.push({
      key: 'toggle',
      label: checked ? uiText('ui.disable') : uiText('ui.enable'),
      disabled: ui.busy || !ui.canToggle(card, !checked),
      title: card.toggle?.title || ''
    })
  if (ui.hasUpdate(card) && update)
    items.push({
      key: 'update-one',
      label: ui.isUpdating(card) ? uiText('ui.updatingVariant3') : uiText('ui.updateToValue', { value1: (ui.latestVersion(card) || uiText('ui.newVersion')) }),
      disabled: ui.busy || update.disabled || update.loading
    })
  if (items.length) items.push({ separator: true })
  if (directory)
    items.push({
      key: directory.key,
      labelKey: 'ui.openFolder', get label() { return uiText('ui.openFolder') },
      disabled: ui.busy || directory.disabled,
      title: directory.title
    })
  if (configAction)
    items.push({
      key: configAction.key,
      labelKey: 'ui.configurationFile', get label() { return uiText('ui.configurationFile') },
      disabled: ui.busy || configAction.disabled
    })
  if (sourceAction)
    items.push({
      key: sourceAction.key,
      labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') },
      disabled:
        ui.busy ||
        sourceAction.disabled ||
        (ui.isLocal(card) && !card.raw?.packageUrl && !card.raw?.sourceUrl),
      title: ui.isLocal(card) ? uiText('ui.locallyImportedModsHaveNoSourcePage') : ''
    })
  if (directory || configAction || sourceAction) items.push({ separator: true })
  items.push({ key: 'copy-name', labelKey: 'ui.copyName', get label() { return uiText('ui.copyName') } })
  if (pathOf(card)) items.push({ key: 'copy-path', labelKey: 'ui.copyInstallationLocation', get label() { return uiText('ui.copyInstallationLocation') } })
  items.push({ separator: true })
  const deletable = ui.canDelete(card)
  items.push({
    key: 'delete-one',
    label: `${card.raw?.canRemoveRecordOnly || card.installModel === 'local-library' ? '移除记录' : card.installModel === 'bound' ? '删除文件' : '删除'}…`,
    danger: true,
    disabled: ui.busy || !deletable,
    hint: !deletable && checked ? uiText('ui.disableFirst') : deletable ? 'Del' : '',
    title: !deletable && checked ? uiText('ui.disableBeforeDeleting') : ''
  })
  return items
})
function runMenu(item) {
  const card = menuCard.value
  if (!card) return
  if (['enable', 'disable', 'update', 'delete'].includes(item.key)) return ui.runBatch(item.key)
  if (item.key === 'toggle') return ui.toggle(card, !card.toggle?.checked)
  if (item.key === 'update-one') return ui.runUpdate(card)
  if (item.key === 'copy-name') return ui.copyText(ui.title(card), '名称')
  if (item.key === 'copy-path') return ui.copyText(pathOf(card), '安装位置')
  if (item.key === 'delete-one') return controller.handleListItemDelete(card)
  return controller.handleDetailAction(card, item.key)
}
</script>

<template>
  <section class="mm-split-left" :aria-label="$t('modBrowser.listLabel')">
    <div class="mm-filter-bar">
      <template v-if="!ui.selected.size">
        <VxSegmented
          v-model="ui.filter"
          class="mm-filters"
          :class="{ 'has-updates': ui.counts.update > 0 }"
          :options="ui.filters"
          role="group"
          :aria-label="$t('ui.filterByModStatus')"
        />
        <div class="mm-search" :class="{ 'has-value': Boolean(ui.keyword) }">
          <VxInput
            v-model="ui.keyword"
            type="search"
            :placeholder="$t('ui.searchNamesOrAuthors')"
            :aria-label="$t('ui.searchNamesOrAuthors')"
            clearable
          />
          <!-- 图标和按键提示放在输入框之后，靠文档顺序叠在上面，不需要 z-index。 -->
          <SearchOutlined class="mm-search-icon" aria-hidden="true" />
          <kbd v-if="!ui.keyword" class="mm-kbd" aria-hidden="true">Ctrl F</kbd>
        </div>
      </template>
      <div v-else class="mm-batch-bar" role="group" :aria-label="$t('taskCenter.bulk.label')">
        <strong aria-live="polite">{{ $t('tools.selected2') }} {{ ui.selected.size }} {{ $t('ui.items') }}</strong>
        <VxButton
          variant="secondary"
          size="sm"
          :disabled="batchDisabled.enable"
          @click="ui.runBatch('enable')"
          >{{ $t('modelSettings.enable') }}</VxButton
        >
        <VxButton
          variant="secondary"
          size="sm"
          :disabled="batchDisabled.disable"
          @click="ui.runBatch('disable')"
          >{{ $t('ui.disable') }}</VxButton
        >
        <VxButton
          variant="secondary"
          size="sm"
          :disabled="batchDisabled.update"
          @click="ui.runBatch('update')"
          >{{ $t('taskCenter.table.updated') }}</VxButton
        >
        <span class="mm-batch-divider" aria-hidden="true"></span>
        <VxButton
          variant="secondary"
          size="sm"
          class="mm-danger-text"
          :disabled="batchDisabled.delete"
          :title="batchDisabled.delete && !ui.busy ? $t('ui.allSelectedModsAreEnabledDisableThemFirst') : ''"
          @click="ui.runBatch('delete')"
          ><DeleteOutlined />{{ $t('ui.delete') }}</VxButton
        >
        <VxButton
          v-if="ui.canSelectAllFiltered"
          variant="ghost"
          size="sm"
          class="mm-select-all-filtered"
          @click="ui.selectAllFiltered"
          >{{ $t('ui.selectAll') }} {{ ui.filtered.length }} {{ $t('ui.items') }}</VxButton
        >
        <span class="mm-batch-end">
          <VxButton
            variant="ghost"
            size="sm"
            class="mm-clear-selection"
            :disabled="ui.batchRunning"
            @click="ui.clearSelection"
            >{{ $t('taskCenter.bulk.clear') }}</VxButton
          >
          <kbd class="mm-kbd" aria-hidden="true">Esc</kbd>
        </span>
      </div>
    </div>
    <div v-if="controller.priorityOrderDirty" class="mm-priority-tools" role="status">
      <WarningOutlined aria-hidden="true" />
      <strong>{{ $t('ui.orderChangedButNotSaved') }}</strong>
      <span class="mm-priority-actions">
        <VxButton
          variant="secondary"
          size="sm"
          :disabled="controller.priorityOrderSaving"
          @click="controller.resetPriorityOrder"
          >{{ $t('ui.undo') }}</VxButton
        >
        <VxButton
          variant="secondary"
          size="sm"
          :loading="controller.priorityOrderSaving"
          @click="controller.savePriorityOrder"
          >{{ $t('ui.saveOrder') }}</VxButton
        >
      </span>
    </div>
    <div class="mm-table-viewport">
      <div class="mm-table" :class="{ 'has-order': orderColumn }">
        <div class="mm-list-columns">
          <div class="mm-cell-check">
            <VxCheckbox
              v-control="{ label: '全选当前列表', mixed: ui.indeterminate }"
              class="mm-checkbox"
              :model-value="ui.allChecked"
              :disabled="!ui.visibleCards.length || ui.rowLocked"
              @update:model-value="ui.selectVisible"
            />
          </div>
          <span
            v-if="orderColumn"
            class="mm-col-order"
            :title="dragEnabled ? '' : $t('ui.dragToReorderWhenSortedByWithNoFilters')"
            >#</span
          >
          <template v-for="column in sortColumns" :key="column.key">
            <span v-if="column.key === 'date'" class="mm-col-version">{{ $t('tools.version') }}</span>
            <button
              type="button"
              class="mm-sort-button"
              :class="[{ 'is-active': ui.sort === column.key }, `mm-col-${column.key}`]"
              :aria-sort="sortState(column.key)"
              @click="ui.setSort(column.key)"
            >
              {{ column.label
              }}<ArrowUpOutlined
                v-if="ui.sort === column.key && ui.sortDir > 0"
                aria-hidden="true"
              /><ArrowDownOutlined v-else-if="ui.sort === column.key" aria-hidden="true" />
            </button>
          </template>
          <span class="mm-align-end">{{ $t('modelSettings.enable') }}</span>
        </div>
        <div
          :ref="controller.assignCompactListScrollRef"
          class="mm-compact-list-scroll mm-scrollbar"
          role="list"
          :aria-label="$t('ui.installedMods')"
          :aria-busy="Boolean(controller.currentListLoading)"
        >
          <template v-if="ui.showSkeleton">
            <div
              v-for="width in skeletonRows"
              :key="width"
              class="mm-skeleton-row"
              aria-hidden="true"
            >
              <span class="mm-skeleton is-box"></span><span class="mm-skeleton is-icon"></span
              ><span class="mm-skeleton" :style="{ width: `${width}px` }"></span
              ><span class="mm-skeleton-gap"></span><span class="mm-skeleton is-soft"></span
              ><span class="mm-skeleton is-soft is-switch"></span>
            </div>
            <span class="mm-sr-only" role="status">{{ $t('ui.loadingInstalledMods') }}</span>
          </template>
          <div v-else-if="!ui.visibleCards.length" class="mm-state">
            <SearchOutlined v-if="ui.keyword || ui.filter !== 'all'" aria-hidden="true" />
            <svg v-else class="mm-state-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
            </svg>
            <h3>
              {{
                ui.keyword || ui.filter !== 'all'
                  ? $t('ui.noModsMatchTheCurrentFiltersVariant2')
                  : controller.currentDisplayEmptyState?.title || $t('ui.noMods')
              }}
            </h3>
            <p>
              {{
                ui.keyword || ui.filter !== 'all'
                  ? $t('ui.valueTryAnotherKeywordOrClearTheFiltersToView', { value1: (noResultText), value2: (ui.counts.all) })
                  : controller.currentDisplayEmptyState?.desc
              }}
            </p>
            <VxButton
              v-if="ui.keyword || ui.filter !== 'all'"
              variant="secondary"
              size="sm"
              @click="ui.clearFilters"
              >{{ $t('tools.clearFilters') }}</VxButton
            >
            <VxButton
              v-else
              variant="secondary"
              size="sm"
              @click="controller.handleToolbarAction('refresh')"
              >{{ $t('tools.refreshList') }}</VxButton
            >
          </div>
          <!-- 切换完成后的短时间内开启行的进出 / 位移动画；筛选、排序、搜索仍然即时切换。 -->
          <TransitionGroup
            tag="div"
            class="mm-compact-rows"
            role="none"
            :name="ui.animateRows ? 'mm-row' : 'mm-row-static'"
          >
            <div
              v-for="card in ui.showSkeleton ? [] : ui.visibleCards"
              :key="card.key"
              class="mm-compact-item"
              role="listitem"
              :data-key="card.key"
              :class="{
                'is-viewing': controller.selectedModKey === card.key,
                'is-checked': ui.selected.has(card.key),
                'is-off': !ui.switchValue(card),
                'is-changed': ui.isRowChanged(card),
                'is-busy': ui.isUpdating(card) || card.toggle?.loading,
                'is-source-missing': card.raw?.source_status === 'missing',
                'is-menu-open': rowMenu.open && rowMenu.key === card.key,
                'is-dragging': controller.priorityDragKey === card.key
              }"
              :draggable="dragEnabled && !card.disabled && card.prioritySortable !== false"
              @dragstart="controller.handlePriorityDragStart?.(card, $event)"
              @dragover="controller.handlePriorityDragOver?.(card, $event)"
              @drop="controller.handlePriorityDrop?.(card, $event)"
              @dragend="controller.handlePriorityDragEnd?.()"
              @click="handleRowClick(card, $event)"
              @contextmenu.prevent="openFromPointer(card, $event)"
            >
              <div class="mm-cell-check" @click.capture="rememberShift">
                <VxCheckbox
                  v-control="{ label: `选择 ${ui.title(card)}` }"
                  class="mm-checkbox"
                  :model-value="ui.selected.has(card.key)"
                  :disabled="ui.rowLocked"
                  @update:model-value="check(card, $event)"
                />
              </div>
              <span v-if="orderColumn" class="mm-order" :class="{ 'can-drag': dragEnabled }"
                ><span class="mm-order-number">{{ rowIndex.get(card.key) }}</span
                ><HolderOutlined v-if="dragEnabled" class="mm-order-grip" aria-hidden="true"
              /></span>
              <button
                type="button"
                class="mm-mod-name-button"
                :aria-label="rowLabel(card)"
                :aria-current="controller.selectedModKey === card.key ? 'true' : undefined"
                @click.stop="viewCard(card, $event)"
                @keydown="rowKeydown(card, $event)"
                @keyup="preventSpaceClick"
              >
                <span class="mm-mod-cell">
                  <ModManagementIcon
                    :src="card.coverUrl || ''"
                    :name="ui.title(card)"
                    :size="24"
                    class="mm-compact-cover"
                  />
                  <span class="mm-mod-name" :title="ui.title(card)"
                    >{{ nameParts(card).pre
                    }}<mark v-if="nameParts(card).hit">{{ nameParts(card).hit }}</mark
                    >{{ nameParts(card).post }}</span
                  >
                  <VxTag
                    v-if="issue(card)"
                    size="sm"
                    class="mm-issue-tag"
                    :class="`is-${issue(card).tone}`"
                    :title="issue(card).title || undefined"
                    ><WarningOutlined aria-hidden="true" />{{ issue(card).text }}</VxTag
                  >
                </span>
                <span
                  class="mm-author"
                  :class="{ 'is-muted': !hasAuthor(card) }"
                  :title="authorText(card)"
                  >{{ authorText(card) }}</span
                >
                <span class="mm-version">
                  <span
                    :class="{
                      'is-muted': versionText(card) === '未标注' || versionText(card) === '—'
                    }"
                    >{{ versionText(card) }}</span
                  >
                  <span v-if="ui.isUpdating(card)" class="mm-version-chip is-busy"
                    ><span class="mm-spin" aria-hidden="true"></span>{{ $t('quickLaunch.updating') }}</span
                  >
                  <span
                    v-else-if="ui.hasUpdate(card)"
                    class="mm-version-chip"
                    :title="$t('ui.newVersionValue', { value1: (ui.latestVersion(card) || '') })"
                    ><ArrowUpOutlined class="mm-version-arrow" aria-hidden="true" />{{
                      ui.latestVersion(card) || $t('ui.newVersion')
                    }}</span
                  >
                </span>
                <span
                  class="mm-date"
                  :title="ui.installTime(card) ? $t('ui.installedOnValue', { value1: (ui.installTime(card)) }) : undefined"
                  >{{ ui.installDate(card) || '—' }}</span
                >
              </button>
              <div class="mm-row-end">
                <button
                  type="button"
                  class="mm-row-more"
                  :aria-label="$t('ui.moreActionsForValue', { value1: (ui.title(card)) })"
                  aria-haspopup="menu"
                  :aria-expanded="rowMenu.open && rowMenu.key === card.key"
                  @click.stop="openFromButton(card, $event)"
                >
                  <MoreOutlined />
                </button>
                <VxSwitch
                  v-if="card.toggle?.visible !== false"
                  :key="`${card.key}:${ui.switchRev(card)}`"
                  v-control="{
                    label: `${ui.switchValue(card) ? '禁用' : '启用'} ${ui.title(card)}`,
                    switch: true,
                    checked: ui.switchValue(card)
                  }"
                  size="sm"
                  class="mm-row-switch"
                  :class="{ 'is-pending': ui.isSwitchPending(card) }"
                  :model-value="ui.switchValue(card)"
                  :disabled="ui.rowLocked || card.toggle?.disabled || ui.isUpdating(card)"
                  :aria-busy="ui.isSwitchPending(card) || Boolean(card.toggle?.loading)"
                  :title="switchTitle(card)"
                  @update:model-value="ui.toggle(card, $event)"
                />
                <span v-else class="mm-muted" :aria-label="$t('ui.cannotToggle')">—</span>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </div>
    <ModManagementMenu
      :open="rowMenu.open"
      :anchor="rowMenu.anchor"
      :items="menuItems"
      :label="menuCard ? $t('ui.actionsForValue', { value1: (ui.title(menuCard)) }) : $t('ui.actions')"
      @close="rowMenu.open = false"
      @select="runMenu"
    />
  </section>
</template>
