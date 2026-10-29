<script setup>
import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { contentLocale } from '@renderer/i18n/content.js'
import { toolServiceText as serviceText } from '@renderer/i18n/tool-service-text.js'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { VxButton, VxModal, VxConfirmModal } from '@renderer/component/vertex-ui'
import {
  ToolEmpty,
  ToolFilterPills,
  ToolIcon,
  ToolIconButton,
  ToolNotice,
  ToolSearchField
} from '@renderer/component/tool-page/index.js'
import {
  canUninstallApp,
  isSameInstalledApp,
  installedAppKey
} from '../../../../../shared/system/installed-app.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'
import storage from '@renderer/common/storage.js'

const keyword = ref('')
const kindFilter = ref('all')
const loading = ref(false)
const appList = ref([])
const iconMap = ref({})
const iconDbMap = ref({})
const requestedIconKeys = new Set()
const iconRequestQueue = []
const MAX_ICON_REQUEST_CONCURRENCY = 4
let activeIconRequestCount = 0
let disposed = false
let iconSaveTimer = null
let iconObserver = null
const iconRows = new WeakMap()
const failedIconKeys = new Set()
const activeTaskId = ref('')
const busy = computed(() => !!activeTaskId.value)
const scanToken = ref('')
const cleanupFailures = ref([])
let listRequestId = ''

const sortKey = ref('installDate')
const sortOrder = ref('desc')
const INSTALLED_APP_CACHE_KEY = 'system_installed_apps_cache_v1'
const INSTALLED_APP_ICON_DB_KEY = 'system_installed_app_icon_db_v1'
const INSTALLED_APP_ICON_DB_MAX = 800

const confirmVisible = ref(false)
const pendingUninstallApp = ref(null)
const confirmMode = ref('uninstall')
const uninstallingName = ref('')
const uninstallingStatus = ref('')
const uninstallingPhase = ref('')
const operatingAppPayload = ref(null)
const residualScanMode = ref('')
// 前端安全超时定时器 ID，防止后端通信异常导致状态永久卡住
let uninstallSafetyTimer = null

const residualDialogVisible = ref(false)
const residualDisplayName = ref('')
const residualFileItems = ref([])
const residualRegistryItems = ref([])
const selectedResidualIds = ref([])
const cleaningResidual = ref(false)

// 按可操作性分组：可卸载 / 仅可清理（没有卸载程序，但能定位残留）/ 不可卸载。
function getAppKind(item) {
  if (canUninstall(item)) return 'uninstall'
  if (canDirectCleanup(item)) return 'cleanup'
  return 'locked'
}

const kindCounts = computed(() =>
  appList.value.reduce(
    (counts, item) => {
      counts[getAppKind(item)] += 1
      return counts
    },
    { uninstall: 0, cleanup: 0, locked: 0 }
  )
)

const filterOptions = computed(() => {
  const ready = appList.value.length > 0
  const count = (value) => (ready ? value : null)
  return [
    { value: 'all', label: tt('全部'), count: count(appList.value.length) },
    { value: 'uninstall', label: tt('可卸载'), count: count(kindCounts.value.uninstall) },
    { value: 'cleanup', label: tt('仅可清理'), count: count(kindCounts.value.cleanup) },
    { value: 'locked', label: tt('不可卸载'), count: count(kindCounts.value.locked) }
  ]
})

const filteredList = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  const list =
    kindFilter.value === 'all'
      ? appList.value
      : appList.value.filter((item) => getAppKind(item) === kindFilter.value)
  if (!value) return list
  return list.filter((item) => {
    const name = String(item.displayName || '').toLowerCase()
    const publisher = String(item.publisher || '').toLowerCase()
    const version = String(item.displayVersion || '').toLowerCase()
    return name.includes(value) || publisher.includes(value) || version.includes(value)
  })
})

const sortedList = computed(() => {
  const list = [...filteredList.value]

  list.sort((a, b) => {
    if (sortKey.value === 'displayName') {
      const aName = String(a.displayName || '')
      const bName = String(b.displayName || '')
      return aName.localeCompare(bName, contentLocale.value)
    }

    if (sortKey.value === 'estimatedSize') {
      const aSize = Number(a.estimatedSize)
      const bSize = Number(b.estimatedSize)
      const safeA = Number.isFinite(aSize) ? aSize : -1
      const safeB = Number.isFinite(bSize) ? bSize : -1
      return safeA - safeB
    }

    const aDate = getInstallTimestamp(a.installDate)
    const bDate = getInstallTimestamp(b.installDate)
    return aDate - bDate
  })

  if (sortOrder.value === 'desc') {
    list.reverse()
  }

  return list
})

const residualFlatItems = computed(() => {
  return [...residualFileItems.value, ...residualRegistryItems.value]
})

const selectedResidualItems = computed(() => {
  const set = new Set(selectedResidualIds.value)
  return residualFlatItems.value.filter((item) => set.has(item.id))
})

const residualGroups = computed(() =>
  [
    { key: 'file', label: tt('文件和文件夹'), items: residualFileItems.value },
    { key: 'registry', label: tt('注册表'), items: residualRegistryItems.value }
  ].filter((group) => group.items.length)
)

function getGroupCheckState(items = []) {
  const selected = new Set(selectedResidualIds.value)
  const count = items.filter((item) => selected.has(item.id)).length
  return {
    checked: count > 0 && count === items.length,
    indeterminate: count > 0 && count < items.length
  }
}

function toggleResidualGroup(items = [], checked) {
  const set = new Set(selectedResidualIds.value)
  items.forEach((item) => (checked ? set.add(item.id) : set.delete(item.id)))
  selectedResidualIds.value = Array.from(set)
}

function getCleanupFailure(itemId) {
  return cleanupFailures.value.find((failure) => failure.id === itemId)
}

// 任务提示条的步骤：卸载为四步，直接清理只有扫描和选择两步。
const taskSteps = computed(() => {
  const phase = uninstallingPhase.value
  if (residualScanMode.value === 'directCleanup') {
    const current = phase === 'review' ? 2 : 1
    return [tt('扫描可清理项'), tt('选择清理')].map((label, index) => ({
      label,
      state: index + 1 < current ? 'done' : index + 1 === current ? 'current' : ''
    }))
  }
  const current = ['starting', 'running', 'external'].includes(phase)
    ? 1
    : phase === 'scanning'
      ? 3
      : phase === 'review'
        ? 4
        : 2
  return [tt('运行卸载程序'), tt('确认结果'), tt('扫描残留'), tt('选择清理')].map(
    (label, index) => ({
      label,
      state: index + 1 < current ? 'done' : index + 1 === current ? 'current' : ''
    })
  )
})

const taskTitle = computed(() =>
  residualScanMode.value === 'directCleanup'
    ? tt('正在处理 {0}', [uninstallingName.value])
    : tt('正在卸载 {0}', [uninstallingName.value])
)

const skeletonRows = 8

function clearFilters() {
  keyword.value = ''
  kindFilter.value = 'all'
}

function getSortState(targetKey) {
  if (sortKey.value !== targetKey) return 'none'
  return sortOrder.value === 'asc' ? 'ascending' : 'descending'
}

function isOperatingApp(item) {
  return !!operatingAppPayload.value && isSameInstalledApp(item, operatingAppPayload.value)
}

function loadInstalledAppsCache() {
  try {
    const cached = storage.local.get(INSTALLED_APP_CACHE_KEY)
    if (!cached || typeof cached !== 'object') return []
    const list = Array.isArray(cached.data) ? cached.data : []
    return list
  } catch {
    return []
  }
}

function saveInstalledAppsCache(list = []) {
  try {
    storage.local.set(INSTALLED_APP_CACHE_KEY, {
      updatedAt: Date.now(),
      data: Array.isArray(list) ? list : []
    })
  } catch {
    // 忽略缓存写入失败
  }
}

function loadInstalledAppIconDb() {
  try {
    const cached = storage.local.get(INSTALLED_APP_ICON_DB_KEY)
    if (!cached || typeof cached !== 'object') return {}
    const data = cached.data
    if (!data || typeof data !== 'object') return {}
    return data
  } catch {
    return {}
  }
}

function saveInstalledAppIconDb(map = {}) {
  try {
    const entries = Object.entries(map || {})
    const trimmedEntries =
      entries.length > INSTALLED_APP_ICON_DB_MAX
        ? entries.slice(entries.length - INSTALLED_APP_ICON_DB_MAX)
        : entries

    storage.local.set(INSTALLED_APP_ICON_DB_KEY, {
      updatedAt: Date.now(),
      data: Object.fromEntries(trimmedEntries)
    })
  } catch {
    // 忽略图标数据库写入失败
  }
}

function getInstallTimestamp(rawValue) {
  const text = String(rawValue || '').trim()
  if (/^\d{8}$/.test(text)) {
    const year = Number(text.slice(0, 4))
    const month = Number(text.slice(4, 6)) - 1
    const day = Number(text.slice(6, 8))
    return new Date(year, month, day).getTime() || 0
  }

  const ts = new Date(text).getTime()
  return Number.isNaN(ts) ? 0 : ts
}

function formatInstallDate(rawValue) {
  const text = String(rawValue || '').trim()
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }
  if (!text) return '--'
  return text
}

function formatSize(kb) {
  const num = Number(kb)
  if (!num || Number.isNaN(num)) return '--'
  if (num < 1024) return `${Math.round(num)} KB`
  const mb = num / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function canUninstall(item) {
  return canUninstallApp(item)
}

function canDirectCleanup(item) {
  return Number(item?.noRemove) !== 1 && !!installedAppKey(item)
}

function canOperate(item) {
  return canUninstall(item) || canDirectCleanup(item)
}

function getActionText(item) {
  if (isSameInstalledApp(item, operatingAppPayload.value || {})) {
    return uninstallingPhase.value === 'running' ? tt('进行中...') : tt('处理中...')
  }
  if (canUninstall(item)) return tt('卸载')
  if (canDirectCleanup(item)) return tt('清理')
  return tt('不可用')
}

function buildIconKey(item) {
  return [
    String(item?.id || '')
      .trim()
      .toLowerCase(),
    String(item?.displayName || '')
      .trim()
      .toLowerCase(),
    String(item?.publisher || '')
      .trim()
      .toLowerCase()
  ].join('::')
}

function getItemIcon(item) {
  return iconMap.value[buildIconKey(item)] || ''
}

function getFallbackText(item) {
  const name = String(item?.displayName || '').trim()
  return name ? name[0].toUpperCase() : 'A'
}

async function runIconRequest(request) {
  activeIconRequestCount += 1
  try {
    const iconDataUrl = await ipcRenderer.invoke('resolveInstalledAppIcon', request.payload)
    if (iconDataUrl && !disposed) {
      iconMap.value[request.cacheKey] = iconDataUrl
      iconDbMap.value[request.cacheKey] = iconDataUrl
      clearTimeout(iconSaveTimer)
      iconSaveTimer = setTimeout(() => saveInstalledAppIconDb(iconDbMap.value), 250)
    } else if (!iconDataUrl) {
      failedIconKeys.add(request.cacheKey)
    }
  } catch {
    failedIconKeys.add(request.cacheKey)
  } finally {
    requestedIconKeys.delete(request.cacheKey)
    activeIconRequestCount -= 1
    drainIconRequestQueue()
  }
}

function drainIconRequestQueue() {
  while (
    !disposed &&
    activeIconRequestCount < MAX_ICON_REQUEST_CONCURRENCY &&
    iconRequestQueue.length
  ) {
    runIconRequest(iconRequestQueue.shift()).catch(() => {})
  }
}

function requestIcon(item) {
  const cacheKey = buildIconKey(item)
  if (disposed || iconMap.value[cacheKey] || failedIconKeys.has(cacheKey)) return

  const cachedIcon = String(iconDbMap.value?.[cacheKey] || '')
  if (cachedIcon) {
    iconMap.value[cacheKey] = cachedIcon
    return
  }

  if (requestedIconKeys.has(cacheKey)) return
  requestedIconKeys.add(cacheKey)
  iconRequestQueue.push({
    cacheKey,
    payload: {
      id: String(item.id || ''),
      iconSource: String(item.iconSource || ''),
      displayIcon: String(item.displayIcon || ''),
      installLocation: String(item.installLocation || ''),
      uninstallString: String(item.uninstallString || ''),
      quietUninstallString: String(item.quietUninstallString || ''),
      displayName: String(item.displayName || '')
    }
  })
  drainIconRequestQueue()
}

function preloadVisibleIcons(list = []) {
  list.slice(0, 20).forEach((item) => requestIcon(item))
}

const vAppIcon = {
  mounted(element, binding) {
    iconRows.set(element, binding.value)
    if (!iconObserver) {
      iconObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) requestIcon(iconRows.get(entry.target))
          }
        },
        { rootMargin: '200px' }
      )
    }
    iconObserver.observe(element)
  },
  updated(element, binding) {
    iconRows.set(element, binding.value)
    if (binding.value !== binding.oldValue) {
      iconObserver?.unobserve(element)
      iconObserver?.observe(element)
    }
  },
  unmounted(element) {
    iconObserver?.unobserve(element)
  }
}

function fetchInstalledApps() {
  loading.value = true
  failedIconKeys.clear()
  listRequestId = crypto.randomUUID()
  ipcRenderer.send('scanInstalledApps', { requestId: listRequestId })
}

function toggleSort(targetKey) {
  if (sortKey.value === targetKey) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortKey.value = targetKey
  // 名称默认升序，大小与安装时间默认降序
  sortOrder.value = targetKey === 'displayName' ? 'asc' : 'desc'
}

function openUninstallConfirm(item) {
  if (busy.value || Number(item?.noRemove) === 1) return
  if (canUninstall(item)) {
    confirmMode.value = 'uninstall'
  } else if (canDirectCleanup(item)) {
    confirmMode.value = 'directCleanup'
  } else {
    $message.warning(tt('该应用既无有效卸载程序，也缺少可定位的清理路径'))
    return
  }
  pendingUninstallApp.value = item
  confirmVisible.value = true
}

function closeUninstallConfirm() {
  confirmVisible.value = false
  pendingUninstallApp.value = null
  confirmMode.value = 'uninstall'
}

function resetUninstallState() {
  activeTaskId.value = ''
  scanToken.value = ''
  uninstallingName.value = ''
  uninstallingStatus.value = ''
  uninstallingPhase.value = ''
  operatingAppPayload.value = null
  residualScanMode.value = ''
  // 清除前端安全超时定时器
  if (uninstallSafetyTimer) {
    clearTimeout(uninstallSafetyTimer)
    uninstallSafetyTimer = null
  }
}

function getConfirmDescription() {
  const name = pendingUninstallApp.value?.displayName || tt('该应用')
  if (confirmMode.value === 'directCleanup') {
    return tt('此应用没有卸载程序。是否扫描{0}的登记项和相关目录？扫描后可逐项确认清理。', [name])
  }
  return tt('确认卸载{0}吗？', [name])
}

function getConfirmActionText() {
  return confirmMode.value === 'directCleanup' ? tt('扫描可清理项') : tt('确认卸载')
}

function getResidualDialogTitle() {
  const name = residualDisplayName.value || tt('未知应用')
  if (residualScanMode.value === 'directCleanup') {
    return tt('发现可清理项：{0}', [name])
  }
  return tt('发现卸载残留：{0}', [name])
}

function buildAppPayload(item = {}) {
  return {
    taskId: crypto.randomUUID(),
    registryPath: String(item.registryPath || ''),
    displayName: String(item.displayName || '')
  }
}

function acceptsTask(result) {
  return !!activeTaskId.value && result.taskId === activeTaskId.value
}

function removeOperatingAppFromList() {
  const target = operatingAppPayload.value
  if (!target) return
  const nextList = appList.value.filter((item) => !isSameInstalledApp(item, target))
  if (nextList.length === appList.value.length) return
  appList.value = nextList
  saveInstalledAppsCache(nextList)
}

function confirmUninstall() {
  const item = pendingUninstallApp.value
  if (!item || busy.value) return
  const payload = buildAppPayload(item)
  operatingAppPayload.value = payload
  activeTaskId.value = payload.taskId
  const mode = confirmMode.value
  closeUninstallConfirm()
  uninstallingName.value = payload.displayName
  uninstallingPhase.value = mode === 'directCleanup' ? 'scanning' : 'starting'
  uninstallingStatus.value =
    mode === 'directCleanup' ? '正在扫描可清理项...' : '正在启动卸载程序...'
  residualScanMode.value = mode
  ipcRenderer.send(
    mode === 'directCleanup' ? 'scanInstalledAppResiduals' : 'uninstallInstalledApp',
    payload
  )
  // Resynchronise instead of unlocking a task that may still be running in another process.
  clearTimeout(uninstallSafetyTimer)
  uninstallSafetyTimer = setTimeout(() => fetchInstalledApps(), 60 * 1000)
}

function openResidualDialog(payload = {}) {
  residualDisplayName.value = String(payload.displayName || '')
  residualFileItems.value = Array.isArray(payload.fileItems) ? payload.fileItems : []
  residualRegistryItems.value = Array.isArray(payload.registryItems) ? payload.registryItems : []
  selectedResidualIds.value = []
  scanToken.value = payload.scanToken || scanToken.value
  cleanupFailures.value = []
  uninstallingPhase.value = 'review'
  residualDialogVisible.value = true
}

function closeResidualDialog() {
  residualDialogVisible.value = false
  residualDisplayName.value = ''
  residualFileItems.value = []
  residualRegistryItems.value = []
  selectedResidualIds.value = []
  cleaningResidual.value = false
}

function toggleResidualItem(itemId, checked) {
  const set = new Set(selectedResidualIds.value)
  if (checked) {
    set.add(itemId)
  } else {
    set.delete(itemId)
  }
  selectedResidualIds.value = Array.from(set)
}

function skipResidualCleanup() {
  if (cleaningResidual.value) return
  cleaningResidual.value = true
  ipcRenderer.send('cleanupInstalledAppResiduals', { taskId: activeTaskId.value, action: 'skip' })
}

function stopWaiting() {
  ipcRenderer.send('cleanupInstalledAppResiduals', {
    taskId: activeTaskId.value,
    action: 'stopWaiting'
  })
  uninstallingStatus.value = '正在结束等待，外部卸载程序会继续运行'
}

function confirmResidualCleanup() {
  if (cleaningResidual.value || !activeTaskId.value) return
  const itemIds = selectedResidualItems.value.map((item) => String(item.id))
  if (!itemIds.length) return
  cleaningResidual.value = true
  cleanupFailures.value = []
  ipcRenderer.send('cleanupInstalledAppResiduals', {
    taskId: activeTaskId.value,
    scanToken: scanToken.value,
    itemIds
  })
}

function restoreOperation(operation) {
  if (!operation) {
    closeResidualDialog()
    resetUninstallState()
    return
  }
  if (activeTaskId.value && activeTaskId.value !== operation.taskId) return
  if (operation.phase === 'finished') {
    if (activeTaskId.value === operation.taskId) {
      closeResidualDialog()
      resetUninstallState()
      if (operation.message) $message.info(serviceText(operation.message))
    }
    return
  }
  activeTaskId.value = operation.taskId
  operatingAppPayload.value = operation.app
  uninstallingName.value = operation.app?.displayName || tt('应用')
  uninstallingPhase.value = operation.phase
  residualScanMode.value = operation.mode
  uninstallingStatus.value =
    operation.phase === 'external'
      ? '请在外部程序中完成卸载，正在等待安装登记更新...'
      : operation.phase === 'review'
        ? '请选择需要清理的项目'
        : '操作正在进行中...'
  if (operation.phase === 'review' && !residualDialogVisible.value) {
    openResidualDialog({ ...operation, displayName: operation.app?.displayName })
  }
}

useIpc('scanInstalledAppsSuccess', (result = {}) => {
  if (result.requestId !== listRequestId) return
  loading.value = false
  appList.value = Array.isArray(result.list) ? result.list : []
  saveInstalledAppsCache(appList.value)
  preloadVisibleIcons(sortedList.value)
  restoreOperation(result.operation)
})

useIpc('scanInstalledAppsFail', (error = {}) => {
  if (error.requestId !== listRequestId) return
  loading.value = false
  $message.error(serviceText(error.message) || tt('读取已安装应用失败'))
})

useIpc('uninstallInstalledAppStart', (result = {}) => {
  if (!acceptsTask(result)) return
  uninstallingPhase.value = 'running'
  uninstallingStatus.value = '卸载程序运行中，等待完成...'
})

useIpc('uninstallInstalledAppProgress', (result = {}) => {
  if (!acceptsTask(result)) return
  uninstallingPhase.value = result.phase
  uninstallingStatus.value =
    result.phase === 'external'
      ? '请在外部程序中完成卸载，正在等待安装登记更新...'
      : '正在确认卸载结果...'
})

useIpc('uninstallInstalledAppClosed', (result = {}) => {
  if (!acceptsTask(result)) return
  if (!result.success || !result.uninstalled || !result.willScanResidual) {
    if (result.message) $message.warning(serviceText(result.message))
    resetUninstallState()
    fetchInstalledApps()
    return
  }
  removeOperatingAppFromList()
  uninstallingPhase.value = 'scanning'
  uninstallingStatus.value = '正在扫描残留...'
})

useIpc('scanInstalledAppResidualsResult', (result = {}) => {
  if (!acceptsTask(result)) return
  if (result.success === false) {
    $message.warning(serviceText(result.message) || tt('扫描失败'))
  } else if (result.totalCount > 0) {
    uninstallingStatus.value = '请选择需要清理的项目'
    openResidualDialog(result)
    return
  } else {
    $message.info(tt('未发现符合安全清理范围的残留项'))
  }
  resetUninstallState()
  fetchInstalledApps()
})

useIpc('cleanupInstalledAppResidualsResult', (result = {}) => {
  if (!acceptsTask(result)) return
  cleaningResidual.value = false
  if (result.remaining) {
    residualFileItems.value = result.remaining.fileItems
    residualRegistryItems.value = result.remaining.registryItems
    selectedResidualIds.value = selectedResidualIds.value.filter((id) =>
      residualFlatItems.value.some((item) => item.id === id)
    )
  }
  cleanupFailures.value = result.failedItems || []
  if (!result.success) {
    $message.warning(serviceText(result.message) || tt('清理失败'))
    return
  }
  if (!result.skipped) $message.success(tt('已清理 {0} 项', [result.successCount || 0]))
  if (!result.skipped && result.remaining?.totalCount) return
  closeResidualDialog()
  resetUninstallState()
  fetchInstalledApps()
})

useIpc('ipc:request-failed', ({ channel } = {}) => {
  if (channel === 'scanInstalledApps') loading.value = false
  if (
    ['uninstallInstalledApp', 'scanInstalledAppResiduals', 'cleanupInstalledAppResiduals'].includes(
      channel
    )
  ) {
    cleaningResidual.value = false
    $message.error(tt('操作请求失败，正在重新确认任务状态'))
    fetchInstalledApps()
  }
})

onUnmounted(() => {
  disposed = true
  iconObserver?.disconnect()
  iconRequestQueue.length = 0
  clearTimeout(iconSaveTimer)
  clearTimeout(uninstallSafetyTimer)
  saveInstalledAppIconDb(iconDbMap.value)
})

watch(
  () => sortedList.value,
  (list) => {
    preloadVisibleIcons(list)
  }
)

onMounted(() => {
  iconDbMap.value = loadInstalledAppIconDb()
  iconMap.value = { ...iconDbMap.value }

  const cachedList = loadInstalledAppsCache()
  if (cachedList.length) {
    appList.value = cachedList
    preloadVisibleIcons(sortedList.value)
  }
  fetchInstalledApps()
})
</script>

<template>
  <div class="uninstall-tab tool-section">
    <ToolNotice v-if="uninstallingName" tone="progress" class="uninstall-status">
      <strong>{{ taskTitle }}</strong> · {{ tt(uninstallingStatus) }}
      <template #actions>
        <ol class="task-steps" :aria-label="tt('处理步骤')">
          <li
            v-for="(step, index) in taskSteps"
            :key="step.label"
            :class="step.state ? `is-${step.state}` : ''"
            :aria-current="step.state === 'current' ? 'step' : undefined"
          >
            <span class="task-steps__mark" aria-hidden="true">
              <ToolIcon v-if="step.state === 'done'" name="check" :size="10" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            {{ step.label }}
          </li>
        </ol>
        <VxButton
          v-if="uninstallingPhase === 'external'"
          variant="secondary"
          size="sm"
          @click="stopWaiting"
        >
          {{ tt('结束等待') }}
        </VxButton>
      </template>
    </ToolNotice>

    <header class="tool-toolbar">
      <ToolFilterPills
        v-model="kindFilter"
        :options="filterOptions"
        :label="tt('按可操作性筛选')"
      />
      <div class="tool-toolbar__tools">
        <ToolSearchField
          v-model="keyword"
          wide
          :placeholder="tt('搜索名称、发布商或版本')"
          :label="tt('搜索已安装应用')"
        />
        <ToolIconButton
          icon="refresh"
          :label="tt('刷新应用列表')"
          :busy="loading"
          @click="fetchInstalledApps"
        />
      </div>
    </header>

    <div v-if="loading && sortedList.length === 0" class="list-table" aria-hidden="true">
      <div class="table-head">
        <span>{{ tt('应用') }}</span
        ><span>{{ tt('版本') }}</span> <span class="is-right">{{ tt('大小') }}</span
        ><span>{{ tt('安装日期') }}</span>
        <span class="is-right">{{ tt('操作') }}</span>
      </div>
      <div v-for="index in skeletonRows" :key="index" class="table-row is-skeleton">
        <span class="app-cell">
          <span class="tool-skeleton skeleton-icon"></span>
          <span class="tool-skeleton skeleton-line is-wide"></span>
        </span>
        <span class="tool-skeleton skeleton-line"></span>
        <span class="tool-skeleton skeleton-line is-short is-right"></span>
        <span class="tool-skeleton skeleton-line"></span>
        <span></span>
      </div>
    </div>

    <ToolEmpty
      v-else-if="sortedList.length === 0"
      :icon="appList.length ? 'search' : 'package'"
      :title="appList.length ? tt('没有匹配的应用') : tt('没有读取到已安装应用')"
      :description="appList.length ? tt('换个筛选条件或关键词试试。') : ''"
    >
      <VxButton v-if="appList.length" variant="secondary" @click="clearFilters">
        {{ tt('清除筛选') }}
      </VxButton>
      <VxButton v-else variant="secondary" :loading="loading" @click="fetchInstalledApps">
        {{ tt('刷新') }}
      </VxButton>
    </ToolEmpty>

    <div v-else class="list-table" role="table" :aria-label="tt('已安装应用')">
      <div class="table-head" role="row">
        <span role="columnheader" :aria-sort="getSortState('displayName')">
          <button
            class="head-btn"
            :class="{ 'is-active': sortKey === 'displayName' }"
            type="button"
            @click="toggleSort('displayName')"
          >
            {{ tt('应用') }}
            <ToolIcon
              v-if="sortKey === 'displayName'"
              :name="sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'"
              :size="12"
            />
          </button>
        </span>
        <span role="columnheader">{{ tt('版本') }}</span>
        <span role="columnheader" class="is-right" :aria-sort="getSortState('estimatedSize')">
          <button
            class="head-btn"
            :class="{ 'is-active': sortKey === 'estimatedSize' }"
            type="button"
            @click="toggleSort('estimatedSize')"
          >
            {{ tt('大小') }}
            <ToolIcon
              v-if="sortKey === 'estimatedSize'"
              :name="sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'"
              :size="12"
            />
          </button>
        </span>
        <span role="columnheader" :aria-sort="getSortState('installDate')">
          <button
            class="head-btn"
            :class="{ 'is-active': sortKey === 'installDate' }"
            type="button"
            @click="toggleSort('installDate')"
          >
            {{ tt('安装日期') }}
            <ToolIcon
              v-if="sortKey === 'installDate'"
              :name="sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'"
              :size="12"
            />
          </button>
        </span>
        <span role="columnheader" class="is-right">{{ tt('操作') }}</span>
      </div>

      <div
        v-for="item in sortedList"
        :key="installedAppKey(item)"
        v-app-icon="item"
        class="table-row"
        :class="{ disabled: !canOperate(item), 'is-busy': isOperatingApp(item) }"
        role="row"
      >
        <span class="app-cell" role="cell">
          <span class="app-icon" :class="{ 'has-icon': !!getItemIcon(item) }">
            <img v-if="getItemIcon(item)" :src="getItemIcon(item)" alt="" class="app-icon-img" />
            <span v-else class="app-icon-fallback" aria-hidden="true">
              {{ getFallbackText(item) }}
            </span>
          </span>
          <span class="app-info">
            <span class="app-name" :title="item.displayName">
              {{ item.displayName || tt('未命名应用') }}
            </span>
            <span class="app-publisher" :title="item.publisher">{{ item.publisher || '--' }}</span>
          </span>
        </span>
        <span class="version-col" role="cell" :title="item.displayVersion">
          {{ item.displayVersion || '--' }}
        </span>
        <span class="is-right number-col" role="cell">{{ formatSize(item.estimatedSize) }}</span>
        <span class="number-col" role="cell">{{ formatInstallDate(item.installDate) }}</span>
        <span class="action-col is-right" role="cell">
          <span v-if="isOperatingApp(item)" class="row-busy" role="status">
            <span class="tool-inline-spinner" aria-hidden="true"></span>
            {{ getActionText(item) }}
          </span>
          <VxButton
            v-else-if="canOperate(item)"
            variant="secondary"
            size="sm"
            type="button"
            :disabled="busy || loading"
            :aria-label="`${getActionText(item)} ${item.displayName || ''}`"
            @click="openUninstallConfirm(item)"
          >
            {{ canUninstall(item) ? getActionText(item) : getActionText(item) + '…' }}
          </VxButton>
          <span
            v-else
            class="row-locked"
            :title="tt('该应用既无有效卸载程序，也缺少可定位的清理路径')"
          >
            {{ tt('不可卸载') }}
          </span>
        </span>
      </div>

      <div class="table-foot">
        <span role="status">
          {{ tt('共 {0} 个应用 · 当前显示 {1} 个', [appList.length, filteredList.length]) }}
        </span>
        <span>{{ tt('大小来自应用的安装登记信息，可能与实际占用不同') }}</span>
      </div>
    </div>

    <VxConfirmModal
      v-model="confirmVisible"
      :title="tt('卸载应用')"
      :description="getConfirmDescription()"
      :confirm-text="getConfirmActionText()"
      :cancel-text="tt('取消')"
      danger
      @confirm="confirmUninstall"
      @close="closeUninstallConfirm"
    />
    <VxModal
      :model-value="residualDialogVisible"
      :title="getResidualDialogTitle()"
      :subtitle="
        residualScanMode === 'directCleanup'
          ? tt('下面只列出属于 {0} 的候选项，请逐项确认要清理哪些。', [residualDisplayName])
          : tt('{0} 已卸载。下面只列出属于它的残留项，请逐项确认要清理哪些。', [
              residualDisplayName
            ])
      "
      :width="760"
      panel-class="residual-dialog"
      :show-close="!cleaningResidual"
      :close-on-esc="!cleaningResidual"
      @close="skipResidualCleanup"
    >
      <ToolNotice
        v-if="cleanupFailures.length"
        tone="danger"
        :title="tt('{0} 项清理失败', [cleanupFailures.length])"
      >
        {{ tt('失败的项目还在下面，可以处理后重试。') }}
      </ToolNotice>
      <ToolNotice tone="warning">
        {{ tt('目录可能包含存档或个人配置，清理后无法恢复。没有勾选的项目会保留。') }}
      </ToolNotice>
      <section
        v-for="group in residualGroups"
        :key="group.key"
        class="residual-group"
        :aria-label="group.label"
      >
        <label class="residual-group__head">
          <input
            type="checkbox"
            :checked="getGroupCheckState(group.items).checked"
            :indeterminate="getGroupCheckState(group.items).indeterminate"
            :disabled="cleaningResidual"
            :aria-label="tt('全选{0}', [group.label])"
            @change="toggleResidualGroup(group.items, $event.target.checked)"
          />
          <span>{{ group.label }}</span>
          <span class="residual-group__count">{{ tt('{0} 项', [group.items.length]) }}</span>
        </label>
        <label
          v-for="item in group.items"
          :key="item.id"
          class="residual-item"
          :class="{ 'is-checked': selectedResidualIds.includes(item.id) }"
        >
          <input
            type="checkbox"
            :checked="selectedResidualIds.includes(item.id)"
            :disabled="cleaningResidual"
            @change="toggleResidualItem(item.id, $event.target.checked)"
          />
          <span class="residual-item-content">
            <span class="path-text">{{ item.path }}</span>
            <small>{{ serviceText(item.reason) }}</small>
            <span v-if="getCleanupFailure(item.id)" class="cleanup-error" role="alert">
              {{ serviceText(getCleanupFailure(item.id).message) }}
            </span>
          </span>
        </label>
      </section>
      <template #footer>
        <span class="residual-selected">
          {{ tt('已选择 {0} 项', [selectedResidualIds.length]) }}
        </span>
        <VxButton variant="secondary" :disabled="cleaningResidual" @click="skipResidualCleanup">
          {{ tt('跳过清理') }}
        </VxButton>
        <VxButton
          variant="danger"
          :loading="cleaningResidual"
          :disabled="!selectedResidualIds.length"
          @click="confirmResidualCleanup"
        >
          {{
            selectedResidualIds.length
              ? tt('清理所选 {0} 项', [selectedResidualIds.length])
              : tt('清理所选')
          }}
        </VxButton>
      </template>
    </VxModal>
  </div>
</template>

<style scoped lang="scss">
$table-columns: minmax(240px, 2.4fr) minmax(110px, 1fr) 88px 104px 104px;

.task-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 14px;
  margin: 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  li.is-done {
    color: var(--color-text-secondary);
  }

  li.is-current {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-semibold);
  }
}

.task-steps__mark {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  border: 1.5px solid var(--color-border-strong);
  border-radius: 50%;
  box-sizing: border-box;

  .is-done & {
    color: var(--color-text-inverse);
    background: var(--color-accent-active);
    border-color: var(--color-accent-active);
  }

  .is-current & {
    border-color: var(--color-accent);
  }
}

.list-table {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: $table-columns;
  gap: var(--space-4);
  align-items: center;
  padding: 0 var(--space-4);
}

.table-head {
  height: 36px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: inherit;
  font: inherit;
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  outline: none;
  cursor: pointer;

  &:hover,
  &.is-active {
    color: var(--color-text);
  }

  &.is-active {
    font-weight: var(--font-weight-semibold);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.is-right {
  justify-self: end;
  text-align: right;
}

.table-row {
  min-height: 52px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  transition: background var(--duration-fast) var(--ease-standard);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  &.is-busy {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
  }

  &.disabled .app-name {
    color: var(--color-text-muted);
  }

  &.is-skeleton:hover {
    background: transparent;
  }
}

.app-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.app-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  background: var(--color-surface-hover);
  border-radius: var(--radius-md);

  &.has-icon {
    background: transparent;
  }
}

.app-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.app-icon-fallback {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}

.app-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-name,
.app-publisher,
.version-col {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.app-name {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
}

.app-publisher {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.version-col {
  min-width: 0;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}

.number-col {
  font-variant-numeric: tabular-nums;
}

.row-busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-accent-strong);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.row-locked {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.table-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  border-top: 1px solid var(--color-border);
}

.skeleton-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
}

.skeleton-line {
  width: 70px;
  height: 10px;

  &.is-wide {
    width: min(200px, 60%);
    height: 12px;
  }

  &.is-short {
    width: 44px;
  }
}

.residual-group {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.residual-group__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 14px;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}

.residual-group__count {
  color: var(--color-text-muted);
  font-weight: var(--font-weight-medium);
}

.residual-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  &.is-checked {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
  }

  input {
    margin-top: 2px;
  }
}

.residual-group input[type='checkbox'] {
  flex: 0 0 auto;
  width: var(--choice-size);
  height: var(--choice-size);
  margin: 0;
  accent-color: var(--color-accent-active);
}

.residual-item input[type='checkbox'] {
  margin-top: 2px;
}

.residual-item-content {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.path-text {
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.residual-item-content small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.cleanup-error {
  color: var(--color-danger-strong);
  font-size: var(--font-size-xs);
}

.residual-selected {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

@media (max-width: 860px) {
  .table-head,
  .table-row {
    grid-template-columns: minmax(180px, 1fr) 88px 96px;

    > :nth-child(2),
    > :nth-child(4) {
      display: none;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .table-row {
    transition: none;
  }
}
</style>
