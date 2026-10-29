<script setup>
import { matchesModMetadataLabel } from './mod-metadata-label.js'
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import {
  computed,
  inject,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  reactive,
  ref,
  watch
} from 'vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { $message } from '@renderer/common/message.js'
import {
  buildMissingDependencyIndex,
  buildModManagementRelations
} from './mod-management-relations.js'
import { useModManagementControllerContext } from './mod-management-context.js'
import ModManagementCompactList from './ModManagementCompactList.vue'
import ModManagementDetailPanel from './ModManagementDetailPanel.vue'
import ModManagementToolbar from './ModManagementToolbar.vue'

const props = defineProps({ confirmation: { type: Object, default: () => ({}) } })
const controller = useModManagementControllerContext()
const projection = inject('mod-management-list-projection', null)
const cards = computed(() => projection?.cards.value || controller.displayCards || [])
const root = ref(null)
const selected = ref(new Set())
const anchorKey = ref('')
const filter = ref('all')
const keyword = ref('')
// 'default' 保持来源给出的顺序（支持加载顺序的来源即加载顺序）；点表头切换升序 → 降序 → 默认。
const sort = ref('default')
const sortDir = ref(1)
const page = ref(1)
const pageSize = 100
const batchRunning = ref(false)
const batchProgress = ref('')
const actionPending = ref(false)
const narrow = ref(false)
const drawerOpen = ref(false)
const confirm = reactive({
  open: false,
  title: '',
  description: '',
  danger: false,
  get confirmText() { return uiText('ui.confirm') },
  items: [],
  more: 0,
  action: null
})
const pendingWaits = new Set()
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
let active = true
let resizeObserver

function meta(card, labels) {
  return String(
    (card?.metaGroups || [])
      .flat()
      .find((row) => matchesModMetadataLabel(row, labels) && row.value && row.value !== '--')?.value || ''
  ).trim()
}
function title(card) {
  return card?.listTitle || card?.title || '--'
}
function version(card) {
  return (
    meta(card, ['版本', '当前版本']) ||
    String(card?.raw?.currentVersion || card?.raw?.version || '--')
  )
}
function latestVersion(card) {
  return String(card?.raw?.latestVersion || card?.raw?.updateInfo?.latestVersion || '').trim()
}
function hasUpdate(card) {
  return Boolean(card?.raw?.hasUpdate || card?.raw?.isUpdate)
}
function updateAction(card) {
  return (card?.actions || []).find((action) =>
    ['update', 'update-package', 'update-ficsit', 'update-nexus', 'update-modio'].includes(
      action.key
    )
  )
}
function isUpdating(card) {
  return Boolean(updateAction(card)?.loading)
}
function isLocal(card) {
  return card?.installModel === 'bound' || card?.installModel === 'local-library'
}
function source(card) {
  return meta(card, ['来源', '来源平台']) || card?.source || '--'
}
function author(card) {
  return (
    meta(card, ['作者', '开发者', '上传者']) ||
    String(
      card?.raw?.ownerName ||
        card?.raw?.packageOwner ||
        card?.raw?.author ||
        card?.raw?.authorName ||
        (card?.source === 'thunderstore'
          ? String(card?.raw?.fullName || card?.subtitle || '').split('-')[0]
          : '') ||
        '--'
    )
  )
}
function pad(value) {
  return String(value).padStart(2, '0')
}
function parseTime(card) {
  const raw = card?.raw || {}
  for (const value of [raw.installedAt, raw.installed_at, raw.created_at, raw.createdAt]) {
    if (!value) continue
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}
// 列表只显示日期；详情显示到分钟。没有可解析的时间戳时退回 metaGroups 里的原文。
function installDate(card) {
  const date = parseTime(card)
  if (date) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const text = meta(card, ['安装时间', '导入时间'])
  return text ? text.slice(0, 10).replace(/\//g, '-') : ''
}
function installTime(card) {
  const date = parseTime(card)
  if (date) return `${installDate(card)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return meta(card, ['安装时间', '导入时间'])
}
function canDelete(card) {
  if (!card || card.disabled) return false
  if (
    card.toggle?.checked &&
    !card.raw?.canRemoveRecordOnly &&
    card.installModel !== 'local-library'
  )
    return false
  const action = card.actions?.find((item) => item.key === 'delete')
  return !action?.disabled && !action?.loading
}
function canToggle(card, checked) {
  return (
    card &&
    card.toggle?.visible !== false &&
    !card.disabled &&
    !card.toggle?.disabled &&
    !card.toggle?.loading &&
    Boolean(card.toggle?.checked) !== checked
  )
}
function operationBusy() {
  return Boolean(
    controller.currentListLoading ||
      controller.isBatchUninstalling ||
      props.confirmation?.open ||
      cards.value.some(
        (card) =>
          card.disabled || card.toggle?.loading || card.actions?.some((action) => action.loading)
      )
  )
}
const busy = computed(() => batchRunning.value || actionPending.value || operationBusy())

// ===== 列表刷新：首次读取（或切换来源 / 配置）显示骨架；之后的刷新保留现有行，只更新变化的行 =====
const listContextKey = computed(() =>
  [
    controller.activeSource,
    controller.activeTab,
    controller.thunderstoreProfile,
    controller.activeManagedProfile
  ]
    .map((value) => String(value ?? ''))
    .join('|')
)
const loadedContextKey = ref('')
watch(
  [() => Boolean(controller.currentListLoading), listContextKey],
  ([loading, key], previous) => {
    const contextChanged = Boolean(previous) && key !== previous[1]
    if (contextChanged) {
      // 换了来源或配置：旧数据不能代表新内容，下一次读取完成前显示骨架。
      loadedContextKey.value = ''
      if (!loading) {
        // 没有触发读取（数据已缓存）时，下一拍仍未读取就视为已就绪。
        nextTick(() => {
          if (!controller.currentListLoading && listContextKey.value === key) {
            loadedContextKey.value = key
          }
        })
      }
      return
    }
    if (!loading) loadedContextKey.value = key
  },
  { immediate: true }
)
const listRefreshing = computed(
  () =>
    Boolean(controller.currentListLoading) &&
    loadedContextKey.value === listContextKey.value &&
    cards.value.length > 0
)
const showSkeleton = computed(() => Boolean(controller.currentListLoading) && !listRefreshing.value)

// 行内开关、勾选框只在会改变整张列表的操作期间禁用；单个模组切换和后台刷新不再让整列变灰。
const rowLocked = computed(() =>
  Boolean(
    batchRunning.value ||
      controller.isBatchUninstalling ||
      props.confirmation?.open ||
      confirm.open ||
      showSkeleton.value ||
      cards.value.some((card) => card.disabled || card.actions?.some((action) => action.loading))
  )
)

// ===== 开关的即时反馈 =====
// pendingSwitch：开关先切到目标状态，等来源返回后以真实状态为准（失败会自动弹回）。
// queuedToggles：上一个切换还没结束时，新的切换按点击顺序排队，避免并发调用来源接口。
const pendingSwitch = reactive(new Map())
const queuedToggles = new Map()
// 开关被拒绝时递增，让原生 checkbox 重新挂载、回到真实状态。
const switchRevs = reactive({})
// 刚发生变化的行，短暂高亮。
const changedKeys = reactive(new Set())
const changedTimers = new Map()
const CHANGED_HIGHLIGHT_MS = 1200
// 行的进出 / 位移动画只在切换完成后的短时间内开启，筛选、排序、搜索仍然即时切换。
const animateRows = ref(false)
let animateRowsTimer = null
const ROW_ANIMATION_WINDOW_MS = 600

function switchValue(card) {
  const key = card?.key
  return pendingSwitch.has(key) ? pendingSwitch.get(key) : Boolean(card?.toggle?.checked)
}
function isSwitchPending(card) {
  return pendingSwitch.has(card?.key)
}
function switchRev(card) {
  return switchRevs[card?.key] || 0
}
function resetSwitch(card) {
  if (!card?.key) return
  switchRevs[card.key] = switchRev(card) + 1
}
function isRowChanged(card) {
  return changedKeys.has(card?.key)
}
function markRowChanged(key) {
  clearTimeout(changedTimers.get(key))
  changedKeys.delete(key)
  // 下一帧再加，保证连续切换同一行时动画能重新播放。
  requestAnimationFrame(() => {
    changedKeys.add(key)
    changedTimers.set(
      key,
      setTimeout(() => {
        changedKeys.delete(key)
        changedTimers.delete(key)
      }, CHANGED_HIGHLIGHT_MS)
    )
  })
}
function openRowAnimationWindow() {
  animateRows.value = true
  clearTimeout(animateRowsTimer)
  animateRowsTimer = setTimeout(() => {
    animateRows.value = false
  }, ROW_ANIMATION_WINDOW_MS)
}
function clearPendingToggles() {
  queuedToggles.clear()
  pendingSwitch.clear()
}
function drainToggleQueue() {
  if (busy.value || rowLocked.value) return
  const next = queuedToggles.entries().next().value
  if (!next) return
  const [key, request] = next
  queuedToggles.delete(key)
  pendingSwitch.delete(key)
  const card = cards.value.find((item) => item.key === key)
  if (card) toggle(card, request.checked, request.detail)
}
const counts = computed(() => ({
  all: cards.value.length,
  enabled: cards.value.filter((card) => card.toggle?.checked).length,
  disabled: cards.value.filter((card) => !card.toggle?.checked).length,
  update: cards.value.filter(hasUpdate).length
}))
const updatingCount = computed(() => cards.value.filter(isUpdating).length)
const missingIndex = computed(() => buildMissingDependencyIndex(cards.value))
// 只提示已启用模组的缺失依赖；禁用的模组不会加载，提示没有意义。
function missingDependencies(card) {
  return card?.toggle?.checked ? missingIndex.value.get(String(card.key)) || [] : []
}
function sortValue(card) {
  if (sort.value === 'author') {
    const value = author(card)
    return value === '--' ? '' : value
  }
  if (sort.value === 'date') return parseTime(card)?.getTime() || installDate(card)
  return title(card)
}
const filtered = computed(() => {
  const rows = cards.value.filter((card) => {
    if (filter.value === 'enabled' && !card.toggle?.checked) return false
    if (filter.value === 'disabled' && card.toggle?.checked) return false
    if (filter.value === 'update' && !hasUpdate(card)) return false
    const text =
      projection?.searchText(card) ||
      [
        card.title,
        card.subtitle,
        card.description,
        card.noteText,
        ...(card.metaGroups || []).flat().map((row) => row.value)
      ]
        .join(' ')
        .toLowerCase()
    return text.includes(keyword.value.trim().toLowerCase())
  })
  if (sort.value === 'default') return rows
  return rows
    .map((card, index) => ({ card, index, value: sortValue(card) }))
    .sort((a, b) => {
      // 缺值始终排在最后，不随升降序翻转。
      if (!a.value !== !b.value) return a.value ? -1 : 1
      const result =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value))
      return (
        result * sortDir.value ||
        collator.compare(title(a.card), title(b.card)) ||
        a.index - b.index
      )
    })
    .map((item) => item.card)
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visibleCards = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize)
)
const selectedCards = computed(() => cards.value.filter((card) => selected.value.has(card.key)))
const allChecked = computed(
  () =>
    visibleCards.value.length > 0 &&
    visibleCards.value.every((card) => selected.value.has(card.key))
)
const indeterminate = computed(
  () => !allChecked.value && visibleCards.value.some((card) => selected.value.has(card.key))
)
const canSelectAllFiltered = computed(
  () =>
    allChecked.value &&
    filtered.value.length > visibleCards.value.length &&
    filtered.value.some((card) => !selected.value.has(card.key))
)
const filters = computed(() => [
  { value: 'all', label: uiText('ui.allValue', { value1: (counts.value.all) }) },
  { value: 'enabled', label: uiText('ui.enabledValue', { value1: (counts.value.enabled) }) },
  { value: 'disabled', label: uiText('ui.disabledValue', { value1: (counts.value.disabled) }) },
  { value: 'update', label: uiText('ui.updatesValue', { value1: (counts.value.update) }) }
])
const sortLabel = computed(() =>
  sort.value === 'default'
    ? controller.prioritySortSupported
      ? '按加载顺序'
      : '默认顺序'
    : uiText('ui.sortValueValue', { value1: ({ name: '名称', author: '作者', date: '安装日期' }[sort.value]), value2: (sortDir.value > 0 ? uiText('ui.ascending') : uiText('ui.descending')) })
)
const busyText = computed(() => {
  if (batchRunning.value) return batchProgress.value
  if (controller.isBatchUninstalling) return controller.uninstallProgressText || uiText('ui.deleting')
  // 后台刷新保留现有行，不在底栏闪“正在读取”。
  if (showSkeleton.value) return uiText('tools.loading')
  if (updatingCount.value) return uiText('ui.updatingValueMods', { value1: (updatingCount.value) })
  const checking = (controller.toolbarPrimaryActions || []).some(
    (action) => action.key === 'check-updates' && Boolean(action.loading)
  )
  return checking ? uiText('ui.checkingUpdatesForValueMods', { value1: (counts.value.all) }) : ''
})
watch([filter, keyword, sort, sortDir], () => {
  page.value = 1
})
watch(pages, (value) => {
  page.value = Math.min(page.value, value)
})
watch(cards, (rows) => {
  if (controller.currentListLoading) return
  const keys = new Set(rows.map((card) => card.key))
  selected.value = new Set([...selected.value].filter((key) => keys.has(key)))
})
watch(
  () => [
    controller.activeSource,
    controller.activeTab,
    controller.thunderstoreProfile,
    controller.activeManagedProfile
  ],
  () => {
    selected.value = new Set()
    keyword.value = ''
    filter.value = 'all'
    page.value = 1
    clearPendingToggles()
  }
)
// 当前操作结束后继续执行排队的切换。
watch(busy, (value) => {
  if (!value) drainToggleQueue()
})
watch(narrow, (value) => {
  if (!value) drawerOpen.value = false
})
function setSort(key) {
  const initial = key === 'date' ? -1 : 1
  if (sort.value !== key) {
    sort.value = key
    sortDir.value = initial
  } else if (sortDir.value === initial) sortDir.value = -initial
  else {
    sort.value = 'default'
    sortDir.value = 1
  }
}
function select(key, checked, extend = false) {
  const next = new Set(selected.value)
  const keys = visibleCards.value.map((card) => card.key)
  const from = keys.indexOf(anchorKey.value)
  const to = keys.indexOf(key)
  // Shift + 点击：把上次点击的行到当前行之间都设为同一状态。
  const range =
    extend && from >= 0 && to >= 0 ? keys.slice(Math.min(from, to), Math.max(from, to) + 1) : [key]
  range.forEach((item) => (checked ? next.add(item) : next.delete(item)))
  anchorKey.value = key
  selected.value = next
}
function selectVisible(checked) {
  const next = new Set(selected.value)
  visibleCards.value.forEach((card) => (checked ? next.add(card.key) : next.delete(card.key)))
  selected.value = next
}
function selectAllFiltered() {
  selected.value = new Set([...selected.value, ...filtered.value.map((card) => card.key)])
}
function clearSelection() {
  if (!batchRunning.value) selected.value = new Set()
}
function clearFilters() {
  keyword.value = ''
  filter.value = 'all'
}
function dependentCards(card) {
  return buildModManagementRelations(card, cards.value)
    .dependents.map((relation) => cards.value.find((item) => item.key === relation.key))
    .filter((item) => item?.toggle?.checked)
}
function listItems(rows) {
  return rows.slice(0, 6).map((card) => ({
    key: card.key,
    name: title(card),
    version: version(card) === '--' ? '' : version(card)
  }))
}
function ask({ title: titleText, description, action, danger = false, confirmText, rows = [] }) {
  Object.assign(confirm, {
    open: true,
    title: titleText,
    description,
    action,
    danger,
    confirmText: confirmText || (danger ? uiText('modelSettings.remove') : uiText('ui.confirm')),
    items: listItems(rows),
    more: Math.max(0, rows.length - 6)
  })
}
// 旧 controller 的分发函数不返回 Promise。观察它现有的 loading/确认状态串行调度，
// 不绕过每个来源的确认、依赖检查或实际 IPC。
async function invokeExisting(action) {
  actionPending.value = true
  try {
    await action()
    await nextTick()
    if (!active) return false
    if (!operationBusy()) return true
    return await new Promise((resolve) => {
      const finish = (value) => {
        stop()
        clearTimeout(timer)
        pendingWaits.delete(cancel)
        resolve(value)
      }
      const cancel = () => finish(false)
      const stop = watch(
        operationBusy,
        (value) => {
          if (!value) finish(true)
        },
        { flush: 'post' }
      )
      const timer = setTimeout(() => {
        $message.warning(uiMessage('ui.anOperationIsStillRunningFurtherBatchOperationsHaveBeen'))
        finish(false)
      }, 120000)
      pendingWaits.add(cancel)
    })
  } finally {
    actionPending.value = false
  }
}
async function toggle(card, checked, detail = false) {
  if (!card) return
  const key = card.key
  if (
    rowLocked.value ||
    card.disabled ||
    card.toggle?.visible === false ||
    card.toggle?.disabled ||
    isUpdating(card)
  ) {
    resetSwitch(card)
    return
  }
  // 正在处理其它切换（或这一行自己还没结束）：排队，开关先显示目标状态。
  if (busy.value || card.toggle?.loading) {
    if (Boolean(card.toggle?.checked) === checked && !card.toggle?.loading) {
      queuedToggles.delete(key)
      pendingSwitch.delete(key)
    } else {
      queuedToggles.set(key, { checked, detail })
      pendingSwitch.set(key, checked)
    }
    return
  }
  if (!canToggle(card, checked)) {
    pendingSwitch.delete(key)
    resetSwitch(card)
    return
  }
  const run = async () => {
    const before = Boolean(card.toggle?.checked)
    pendingSwitch.set(key, checked)
    // 来源返回、列表更新时行可能离开当前筛选：动画要在列表更新之前打开。
    clearTimeout(animateRowsTimer)
    animateRows.value = true
    try {
      await invokeExisting(() =>
        detail
          ? controller.handleDetailToggle(card, checked)
          : controller.handleListItemToggle(card, checked)
      )
    } finally {
      if (queuedToggles.has(key)) pendingSwitch.set(key, queuedToggles.get(key).checked)
      else pendingSwitch.delete(key)
      const current = cards.value.find((item) => item.key === key)
      openRowAnimationWindow()
      if (current && Boolean(current.toggle?.checked) !== before) markRowChanged(key)
      drainToggleQueue()
    }
  }
  const dependents = checked ? [] : dependentCards(card)
  if (dependents.length) {
    // 确认前开关保持原状态；点击已经改变了原生 checkbox，这里让它回到真实状态。
    resetSwitch(card)
    ask({
      title: uiText('ui.disableValue', { value1: (title(card)) }),
      description: uiText('ui.theFollowingValueEnabledModsWillNoLongerLoad', { value1: (dependents.length) }),
      action: run,
      get confirmText() { return uiText('ui.disableAnyway') },
      rows: dependents
    })
  } else await run()
}
function runUpdate(card) {
  const action = updateAction(card)
  if (busy.value || !action || action.disabled || action.loading) return
  return controller.handleDetailAction(card, action.key)
}
async function runBatch(kind) {
  if (busy.value) return
  const targets = selectedCards.value.filter((card) =>
    kind === 'enable'
      ? canToggle(card, true)
      : kind === 'disable'
        ? canToggle(card, false)
        : kind === 'update'
          ? hasUpdate(card) &&
            updateAction(card) &&
            !updateAction(card).disabled &&
            !updateAction(card).loading
          : canDelete(card)
  )
  if (!targets.length) return
  const verb = { enable: '启用', disable: '禁用', update: '更新', delete: '删除' }[kind]
  const run = async () => {
    batchRunning.value = true
    let done = 0
    let stoppedAt = ''
    try {
      for (const [index, target] of targets.entries()) {
        if (!active) break
        const card = cards.value.find((item) => item.key === target.key)
        if (!card) continue
        batchProgress.value = uiText('ui.valueValueValueValue', { value1: (verb), value2: (index + 1), value3: (targets.length), value4: (title(card)) })
        const ok = await invokeExisting(() =>
          kind === 'delete'
            ? controller.handleListItemDelete(card)
            : kind === 'update'
              ? controller.handleDetailAction(card, updateAction(card).key)
              : controller.handleListItemToggle(card, kind === 'enable')
        )
        const current = cards.value.find((item) => item.key === card.key)
        if (
          !ok ||
          (kind === 'delete' && current) ||
          (kind === 'enable' && !current?.toggle?.checked) ||
          (kind === 'disable' && current?.toggle?.checked)
        ) {
          stoppedAt = title(card)
          break
        }
        done++
        if (kind === 'delete') select(card.key, false)
      }
    } finally {
      batchRunning.value = false
      batchProgress.value = ''
    }
    if (stoppedAt && done)
      $message.warning(uiMessage('ui.completedValueValueValueCouldNotCompleteValue', { value1: (done), value2: (targets.length), value3: (stoppedAt), value4: (verb) }))
    else if (!stoppedAt && targets.length > 1 && ['enable', 'disable'].includes(kind))
      $message.success(uiMessage('ui.valueValueModsCompleted', { value1: (verb), value2: (done) }))
  }
  if (kind === 'delete')
    ask({
      title: uiText('ui.deleteValueMods', { value1: (targets.length) }),
      description: uiText('ui.filesForTheseModsWillBeDeletedFromTheCurrent', { value1: (targets.length < selectedCards.value.length ? uiText('ui.enabledItemsAndItemsThatCannotBeDeletedWillBe') : '') }),
      action: run,
      danger: true,
      rows: targets
    })
  else if (kind === 'disable') {
    const affected = [
      ...new Map(
        targets
          .flatMap(dependentCards)
          .filter((card) => !targets.some((target) => target.key === card.key))
          .map((card) => [card.key, card])
      ).values()
    ]
    if (affected.length)
      ask({
        title: uiText('ui.disableValueMods', { value1: (targets.length) }),
        description: uiText('ui.theFollowingValueEnabledModsWillNoLongerLoad', { value1: (affected.length) }),
        action: run,
        get confirmText() { return uiText('ui.disableAnyway') },
        rows: affected
      })
    else await run()
  } else await run()
}
function toolbarAction(action) {
  if (busy.value || action.disabled) return
  // 摘要确认补齐数量与名称；最终执行仍由原有“全部删除”确认弹窗负责。
  if (action.key === 'delete-all')
    ask({
      get title() { return uiText('ui.deleteAllVariant2') },
      description: uiText('ui.thisListContainsValueModsTheSourceSDeleteAll', { value1: (cards.value.length) }),
      action: () => controller.handleToolbarAction(action.key),
      danger: true,
      get confirmText() { return uiText('taskCenter.bulk.resume') },
      rows: cards.value
    })
  else controller.handleToolbarAction(action.key)
}
function focusCard(key, { open = true } = {}) {
  const index = filtered.value.findIndex((card) => card.key === key)
  if (index >= 0) page.value = Math.floor(index / pageSize) + 1
  controller.selectMod(key)
  if (open && narrow.value) drawerOpen.value = true
}
async function copyText(value, label) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    $message.success(uiMessage('ui.copiedValue', { value1: (label) }))
    return true
  } catch {
    $message.error(uiMessage('ui.copyingFailedPleaseTryAgain'))
    return false
  }
}
function overlayOpen() {
  return document.querySelector(
    '[role="dialog"], .mm-more-menu, .mm-profile-popover, .mm-context-menu, .vx-select-menu'
  )
}
function keydown(event) {
  if (!active || event.defaultPrevented || !root.value?.isConnected) return
  if (!root.value.offsetParent && !root.value.getClientRects().length) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !overlayOpen()) {
    const input = root.value.querySelector('.mm-search input')
    if (input) {
      event.preventDefault()
      input.focus()
      input.select()
    }
    return
  }
  if (event.key !== 'Escape' || overlayOpen()) return
  if (drawerOpen.value) drawerOpen.value = false
  else clearSelection()
}
// 补齐现有基础控件尚未透传到原生 input 的无障碍属性，不改变通用组件行为。
function controlAttributes(el, binding) {
  const input = el.querySelector('input')
  if (!input) return
  const { label, mixed = false, switch: isSwitch = false } = binding.value
  input.setAttribute('aria-label', label)
  input.indeterminate = mixed
  if (isSwitch) {
    input.checked = Boolean(binding.value.checked)
    // 原生 checkbox 会先自行翻转；确认取消或操作失败时，仍以 controller 状态为准。
    el.mmChecked = input.checked
    input.setAttribute('role', 'switch')
    input.setAttribute('aria-checked', String(input.checked))
  }
}
const controlDirective = {
  mounted(el, binding) {
    controlAttributes(el, binding)
    if (binding.value.switch) {
      el.mmChange = () => {
        const input = el.querySelector('input')
        input.checked = el.mmChecked
        input.setAttribute('aria-checked', String(input.checked))
      }
      el.addEventListener('change', el.mmChange)
    }
  },
  updated: controlAttributes,
  unmounted(el) {
    if (el.mmChange) el.removeEventListener('change', el.mmChange)
  }
}
const ui = reactive({
  cards,
  visibleCards,
  filtered,
  selected,
  selectedCards,
  counts,
  filters,
  filter,
  keyword,
  sort,
  sortDir,
  sortLabel,
  page,
  pages,
  allChecked,
  indeterminate,
  canSelectAllFiltered,
  busy,
  rowLocked,
  showSkeleton,
  listRefreshing,
  animateRows,
  switchValue,
  isSwitchPending,
  switchRev,
  isRowChanged,
  busyText,
  updatingCount,
  batchRunning,
  batchProgress,
  narrow,
  drawerOpen,
  controlDirective,
  meta,
  title,
  author,
  version,
  latestVersion,
  hasUpdate,
  updateAction,
  isUpdating,
  isLocal,
  source,
  installDate,
  installTime,
  missingDependencies,
  canDelete,
  canToggle,
  setSort,
  select,
  selectVisible,
  selectAllFiltered,
  clearSelection,
  clearFilters,
  dependentCards,
  toggle,
  runUpdate,
  runBatch,
  toolbarAction,
  focusCard,
  copyText
})
provide('mod-management-ui', ui)
function stopPending() {
  active = false
  confirm.open = false
  confirm.action = null
  pendingWaits.forEach((cancel) => cancel())
  // 离开页面时丢弃还没开始的排队切换；正在执行的那一个由来源自己完成。
  queuedToggles.clear()
  changedTimers.forEach((timer) => clearTimeout(timer))
  changedTimers.clear()
  changedKeys.clear()
  clearTimeout(animateRowsTimer)
  animateRows.value = false
}
onDeactivated(stopPending)
onMounted(() => {
  document.addEventListener('keydown', keydown)
  if (typeof ResizeObserver === 'function' && root.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      narrow.value = entry.contentRect.width <= 900
    })
    resizeObserver.observe(root.value)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', keydown)
  resizeObserver?.disconnect()
})
onActivated(() => {
  active = true
})
onBeforeUnmount(stopPending)
</script>

<template>
  <div ref="root" class="mm-page" :class="{ 'is-narrow': narrow, 'has-drawer': drawerOpen }">
    <div class="mm-shell">
      <ModManagementToolbar />
      <section class="mm-split-view" :aria-label="$t('ui.modWorkspace')">
        <ModManagementCompactList />
        <ModManagementDetailPanel />
      </section>
      <footer class="mm-list-foot">
        <span v-if="busyText" class="mm-foot-busy" role="status"
          ><span class="mm-spin" aria-hidden="true"></span>{{ busyText }}</span
        >
        <span>{{ counts.all }} {{ $t('ui.mods') }}</span><span>{{ $t('ui.enabled') }} {{ counts.enabled }}</span
        ><span>{{ $t('ui.disabled') }} {{ counts.disabled }}</span
        ><span :class="{ 'is-accent': counts.update > 0 }">{{ $t('modBrowser.updateAvailable') }} {{ counts.update }}</span>
        <span class="mm-visible-count" aria-live="polite"
          >{{ $t('modelSettings.show') }} {{ filtered.length }} {{ $t('ui.itemsVariant3') }} {{ sortLabel }}</span
        >
        <nav v-if="pages > 1" class="mm-pagination" :aria-label="$t('ui.modListPages')">
          <VxButton variant="ghost" size="sm" :disabled="page <= 1" @click="page--"
            >{{ $t('modBrowser.previous') }}</VxButton
          >
          <span>{{ page }} / {{ pages }}</span
          ><VxButton variant="ghost" size="sm" :disabled="page >= pages" @click="page++"
            >{{ $t('modBrowser.next') }}</VxButton
          >
        </nav>
      </footer>
    </div>
    <VxConfirmModal
      v-model="confirm.open"
      :title="confirm.title"
      :description="confirm.description"
      :danger="confirm.danger"
      :confirm-text="confirm.confirmText"
      @confirm="confirm.action?.()"
    >
      <ul v-if="confirm.items.length" class="mm-confirm-list">
        <li v-for="item in confirm.items" :key="item.key">
          <span>{{ item.name }}</span
          ><span v-if="item.version" class="mm-mono">{{ item.version }}</span>
        </li>
        <li v-if="confirm.more" class="mm-confirm-more">{{ $t('ui.andAnother') }} {{ confirm.more }} {{ $t('ui.itemsVariant2') }}</li>
      </ul>
    </VxConfirmModal>
  </div>
</template>
