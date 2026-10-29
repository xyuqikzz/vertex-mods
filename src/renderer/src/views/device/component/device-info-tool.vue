<script setup>
import { toolText as tt, toolMessage as tm } from '@renderer/i18n/tool-text.js'

import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import common from '@renderer/common/index.js'
import { $message } from '@renderer/common/message.js'
import { contentLocale } from '@renderer/i18n/content.js'
import { VxButton, VxProgress } from '@renderer/component/vertex-ui/index.js'
import { ToolEmpty, ToolIcon, ToolNotice } from '@renderer/component/tool-page/index.js'

const diskList = ref([])
const deviceInfo = ref([])
const showPop = ref(false)
const active = ref(true)
const progress = ref(0)
const scanError = ref('')
const diskError = ref('')
const diskLoaded = ref(false)
const lastScanAt = ref(null)
const querying = ref({
  text: '',
  maxNum: 0
})
let animationId
let closeTimer
function stopProgressBar() {
  cancelAnimationFrame(animationId)
  animationId = null
}
onActivated(() => {
  active.value = true
  if (showPop.value) startProgressBar()
})
onDeactivated(() => {
  active.value = false
  stopProgressBar()
})
onBeforeUnmount(() => {
  active.value = false
  stopProgressBar()
  clearTimeout(closeTimer)
})

function scanDisk() {
  ipcRenderer.send('scanDisk', 'deviceInfoTool')
}

function scanDeviceInfo(force = 0) {
  ipcRenderer.send('scanDeviceInfo', force)
}

function parseUsagePercent(percentage) {
  const value = parseFloat(String(percentage || '0').replace('%', ''))
  return Number.isFinite(value) ? value : 0
}

function openDisk(drive) {
  ipcRenderer.send('openSpecifyPath', drive)
}

function refresh() {
  if (showPop.value) return
  scanError.value = ''
  diskError.value = ''
  deviceInfo.value = []
  progress.value = 0
  stopProgressBar()
  clearTimeout(closeTimer)
  scanDisk()
  scanDeviceInfo(1)
}

async function copyDeviceInfo() {
  if (deviceInfo.value.length === 0) {
    $message.warning(tt('暂无设备信息可复制'))
    return
  }

  const deviceInfoJson = JSON.stringify(common.convertToRaw(deviceInfo.value), null, 2)
  const copied = await common.copyToClipboard(deviceInfoJson)

  if (!copied) {
    $message.warning(tt('复制失败，请稍后重试'))
    return
  }
  $message.success(tt('已复制到剪贴板'))
}

function startProgressBar() {
  stopProgressBar()
  if (!active.value) return
  let lastTime = 0
  const animate = (timestamp) => {
    if (!active.value || !showPop.value) return
    if (timestamp - lastTime >= 300) {
      const maxNum = querying.value.maxNum
      const current = progress.value
      if (current < maxNum) {
        // 让扫描进度弹窗在真实查询间隔中保持可见反馈
        const remaining = maxNum - current
        const increment = Math.floor(Math.random() * remaining) + 1
        progress.value = Math.min(current + increment, maxNum)
      }
      lastTime = timestamp
    }
    animationId = requestAnimationFrame(animate)
  }
  animationId = requestAnimationFrame(animate)
}

function findSection(field) {
  return deviceInfo.value.find((item) => item.field === field)
}

function getFirstItem(field) {
  const section = findSection(field)
  const data = Array.isArray(section?.data) ? section.data : []
  return data[0] || null
}

function getItemInfo(item, names = []) {
  const infoList = Array.isArray(item?.infoList) ? item.infoList : []
  const target = infoList.find((info) => names.includes(info.name))
  return target?.data ? String(target.data) : ''
}

function getSectionNames(field) {
  const section = findSection(field)
  const data = Array.isArray(section?.data) ? section.data : []
  return data.map((item) => item.name).filter(Boolean)
}

function isVirtualGpu(item) {
  const name = String(item?.name || '').toLowerCase()
  return name.includes('virtual display adapter') || name.includes('gameviewer virtual')
}

function parseSizeToBytes(text) {
  const match = String(text || '').match(/([\d.]+)\s*(B|KB|MB|GB|TB|PB)/i)
  if (!match) return 0
  const value = Number(match[1])
  if (!Number.isFinite(value)) return 0
  const unitMap = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    PB: 1024 ** 5
  }
  return value * (unitMap[match[2].toUpperCase()] || 1)
}

function formatSize(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const numberText = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${numberText.replace(/\.0$/, '')}${units[index]}`
}

function getDiskName(drive) {
  const letter = String(drive || '')
    .replace(':', '')
    .trim()
  return letter ? tt('{0} 盘', [letter.toUpperCase()]) : tt('未知磁盘')
}

function getDiskRole(drive, index) {
  const letter = String(drive || '')
    .replace(':', '')
    .trim()
  return letter.toUpperCase() === 'C' || index === 0 ? tt('系统盘') : tt('数据盘')
}

// 80% 以下正常；80%–89% 提醒空间偏少；90% 及以上提示空间不足。
function getDiskLevel(percentage) {
  const value = parseUsagePercent(percentage)
  if (value >= 90) return 'danger'
  if (value >= 80) return 'warning'
  return 'normal'
}

const systemItem = computed(() => getFirstItem('system'))
const cpuItem = computed(() => getFirstItem('cpu'))
const physicalGpuItems = computed(() => {
  const section = findSection('gpu')
  const data = Array.isArray(section?.data) ? section.data : []
  return data.filter((item) => !isVirtualGpu(item))
})
const gpuItem = computed(() => physicalGpuItems.value[0] || null)
const memoryItems = computed(() => {
  const section = findSection('memory')
  return Array.isArray(section?.data) ? section.data : []
})

const memoryTotal = computed(() => {
  const total = memoryItems.value.reduce((sum, item) => sum + parseSizeToBytes(item?.name), 0)
  return formatSize(total)
})

const overviewCards = computed(() => {
  const cpuCores = getItemInfo(cpuItem.value, ['核心数'])
  const cpuThreads = getItemInfo(cpuItem.value, ['线程数'])
  const memoryMeta = [
    getItemInfo(memoryItems.value[0], ['内存类型']),
    getItemInfo(memoryItems.value[0], ['内存频率'])
  ]
    .filter(Boolean)
    .join(' ')

  return [
    {
      key: 'system',
      label: tt('系统'),
      icon: 'monitor',
      value: systemItem.value?.name || '--',
      meta: getItemInfo(systemItem.value, ['处理器架构'])
    },
    {
      key: 'cpu',
      label: tt('处理器'),
      icon: 'chip',
      value: cpuItem.value?.name || '--',
      meta: [cpuCores && tt('{0} 核', [cpuCores]), cpuThreads && tt('{0} 线程', [cpuThreads])]
        .filter(Boolean)
        .join(' / ')
    },
    {
      key: 'memory',
      label: tt('内存'),
      icon: 'memory',
      value: memoryTotal.value || '--',
      meta: memoryMeta
    },
    {
      key: 'gpu',
      label: tt('显卡'),
      icon: 'gpu',
      value: gpuItem.value?.name || '--',
      meta: getItemInfo(gpuItem.value, ['显存'])
    }
  ]
})

// 内存、显卡、硬盘每条一行显示，不再用分号拼成一行。
const hardwareDetailRows = computed(() => {
  const baseboardItem = getFirstItem('baseboard')
  const systemVersion = [
    systemItem.value?.name,
    getItemInfo(systemItem.value, ['版本号']),
    getItemInfo(systemItem.value, ['处理器架构'])
  ]
    .filter(Boolean)
    .join(' · ')
  const rows = [
    { key: 'cpu', label: tt('处理器'), values: [cpuItem.value?.name] },
    {
      key: 'memory',
      label: tt('内存'),
      values: memoryItems.value.map((item) =>
        [item.name, getItemInfo(item, ['内存类型']), getItemInfo(item, ['内存频率'])]
          .filter(Boolean)
          .join(' ')
      )
    },
    {
      key: 'gpu',
      label: tt('显卡'),
      values: physicalGpuItems.value.map((item) =>
        [item.name, getItemInfo(item, ['显存'])].filter(Boolean).join(' · ')
      )
    },
    {
      key: 'baseboard',
      label: tt('主板'),
      values: [
        [baseboardItem?.name, getItemInfo(baseboardItem, ['制造商'])].filter(Boolean).join(' · ')
      ]
    },
    { key: 'disks', label: tt('硬盘'), values: getSectionNames('disks') },
    { key: 'system', label: tt('系统版本'), values: [systemVersion] }
  ]
  return rows
    .map((row) => ({ ...row, values: row.values.filter(Boolean) }))
    .filter((row) => row.values.length)
})
const hardwareColumns = computed(() => {
  const rows = hardwareDetailRows.value
  const middle = Math.ceil(rows.length / 2)
  return [rows.slice(0, middle), rows.slice(middle)].filter((column) => column.length)
})
const diskCards = computed(() =>
  diskList.value.map((disk, index) => ({
    key: disk.drive || index,
    drive: disk.drive,
    name: getDiskName(disk.drive),
    role: getDiskRole(disk.drive, index),
    usage: disk.usage,
    usageValue: parseUsagePercent(disk.usage),
    level: getDiskLevel(disk.usage),
    total: disk.total,
    used: disk.used,
    free: disk.free
  }))
)
const hasDeviceInfo = computed(() => deviceInfo.value.length > 0)
const isScanning = computed(() => showPop.value || (!hasDeviceInfo.value && !scanError.value))
const scanStep = computed(() => (progress.value >= 70 ? 3 : progress.value >= 35 ? 2 : 1))
const scanSteps = computed(() =>
  [tt('系统'), tt('硬件'), tt('磁盘')].map((label, index) => ({
    label,
    state: index + 1 < scanStep.value ? 'done' : index + 1 === scanStep.value ? 'current' : ''
  }))
)
const scanTimeText = computed(() => {
  if (isScanning.value) return tt('正在扫描…')
  if (!lastScanAt.value) return ''
  const time = lastScanAt.value.toLocaleTimeString(contentLocale.value, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return scanError.value ? tt('上次成功扫描 {0}', [time]) : tt('上次扫描 {0}', [time])
})

onMounted(() => {
  scanDisk()
  scanDeviceInfo()
})

useIpc('scanDiskSuccess-deviceInfoTool', (data) => {
  diskError.value = ''
  diskLoaded.value = true
  diskList.value = Array.isArray(data) ? data : []
})

useIpc('scanDiskFail-deviceInfoTool', (data) => {
  console.log(data)
  diskLoaded.value = true
  diskError.value = String(data?.error || data?.message || '')
})

useIpc('scanDeviceInfoSuccess', (data) => {
  scanError.value = ''
  querying.value.maxNum = 100
  progress.value = 100
  stopProgressBar()
  deviceInfo.value = Array.isArray(data) ? data : []
  lastScanAt.value = new Date()
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    showPop.value = false
  }, 400)
})

useIpc('scanDeviceInfoFail', (data) => {
  showPop.value = false
  stopProgressBar()
  clearTimeout(closeTimer)
  progress.value = 0
  // 失败原因在页面顶部的错误提示条里显示，不再额外弹出消息。
  scanError.value = String(data?.error || '设备信息扫描失败')
})

useIpc('deviceScanning', (data) => {
  if (!showPop.value) {
    showPop.value = true
    startProgressBar()
  }
  const { name, num } = data || {}
  querying.value.text = name ? tm('正在查询{0}', [tm(name)]) : tm('正在初始化')
  querying.value.maxNum = Number.isFinite(Number(num)) ? Number(num) : 0
})

defineOptions({
  name: 'DeviceInfoTool'
})
</script>

<template>
  <div class="device-info-tool tool-section">
    <header class="tool-toolbar">
      <h2 class="tool-section-title">
        {{ tt('本机配置') }}<small v-if="scanTimeText">{{ scanTimeText }}</small>
      </h2>
      <div class="tool-toolbar__tools">
        <VxButton variant="secondary" :disabled="!hasDeviceInfo" @click="copyDeviceInfo">
          <span class="device-button-content">
            <ToolIcon name="copy" :size="14" />
            {{ tt('复制信息') }}
          </span>
        </VxButton>
        <VxButton variant="secondary" :disabled="isScanning" @click="refresh">
          <span class="device-button-content">
            <ToolIcon name="refresh" :size="14" />
            {{ tt('重新扫描') }}
          </span>
        </VxButton>
      </div>
    </header>

    <ToolNotice v-if="scanError" tone="danger" :title="tt('设备信息扫描失败')">
      {{ tt(scanError) }}
      <template #actions>
        <VxButton variant="secondary" size="sm" @click="refresh">{{ tt('重新扫描') }}</VxButton>
      </template>
    </ToolNotice>
    <ToolNotice v-else-if="isScanning" tone="progress" class="scan-notice">
      <strong>{{ tt('正在扫描设备') }}</strong>
      <span class="scan-notice__step"> · {{ tt(querying.text) || tt('正在初始化检测任务') }}</span>
      <template #detail>
        <VxProgress class="scan-notice__progress" :value="progress" />
      </template>
      <template #actions>
        <ol class="scan-steps" :aria-label="tt('扫描步骤')">
          <li
            v-for="(step, index) in scanSteps"
            :key="step.label"
            :class="step.state ? `is-${step.state}` : ''"
            :aria-current="step.state === 'current' ? 'step' : undefined"
          >
            <span class="scan-steps__mark" aria-hidden="true">
              <ToolIcon v-if="step.state === 'done'" name="check" :size="10" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            {{ step.label }}
          </li>
        </ol>
      </template>
    </ToolNotice>

    <div class="overview-grid">
      <article v-for="card in overviewCards" :key="card.key" class="overview-card tool-card-panel">
        <span class="overview-icon" aria-hidden="true">
          <ToolIcon :name="card.icon" :size="18" />
        </span>
        <div class="overview-content">
          <span class="overview-label">{{ card.label }}</span>
          <template v-if="hasDeviceInfo">
            <strong class="overview-value" :title="card.value">{{ card.value }}</strong>
            <span class="overview-meta">{{ card.meta || '--' }}</span>
          </template>
          <template v-else-if="scanError">
            <strong class="overview-value is-muted">{{ tt('未获取') }}</strong>
            <span class="overview-meta">{{ tt('重新扫描后显示') }}</span>
          </template>
          <template v-else>
            <span class="tool-skeleton overview-skeleton is-wide" aria-hidden="true"></span>
            <span class="tool-skeleton overview-skeleton" aria-hidden="true"></span>
          </template>
        </div>
      </article>
    </div>

    <section class="device-section" aria-labelledby="device-disk-title">
      <div class="tool-section-head">
        <h2 id="device-disk-title" class="tool-section-title">
          {{ tt('磁盘')
          }}<small v-if="diskCards.length">{{ tt('{0} 个', [diskCards.length]) }}</small>
        </h2>
        <p v-if="diskCards.length" class="tool-section-hint">
          {{ tt('点击磁盘在资源管理器中打开') }}
        </p>
      </div>
      <div v-if="diskCards.length" class="disk-grid">
        <button
          v-for="disk in diskCards"
          :key="disk.key"
          type="button"
          class="disk-card"
          :aria-label="tt('打开 {0}，已使用 {1}', [disk.name, disk.usage])"
          @click="openDisk(disk.drive)"
        >
          <span class="disk-card__head">
            <ToolIcon name="disk" :size="17" class="disk-card__icon" />
            <strong>{{ disk.name }}</strong>
            <span class="tool-tag">{{ disk.role }}</span>
            <span class="disk-card__spacer"></span>
            <span v-if="disk.level === 'warning'" class="tool-status is-warning">
              {{ tt('空间偏少') }}
            </span>
            <span v-else-if="disk.level === 'danger'" class="tool-status is-danger">
              {{ tt('空间不足') }}
            </span>
            <span class="disk-card__usage">{{ disk.usage }}</span>
          </span>
          <span class="disk-card__bar" aria-hidden="true">
            <span
              :class="`is-${disk.level}`"
              :style="{ width: `${Math.min(100, Math.max(0, disk.usageValue))}%` }"
            ></span>
          </span>
          <span class="disk-card__meta">
            {{ tt('已用 {0} / 共 {1} · 可用 {2}', [disk.used, disk.total, disk.free]) }}
          </span>
        </button>
      </div>
      <div v-else-if="!diskLoaded && !diskError" class="disk-grid" aria-hidden="true">
        <span v-for="index in 2" :key="index" class="tool-skeleton disk-skeleton"></span>
      </div>
      <ToolEmpty
        v-else
        compact
        icon="disk"
        :title="tt('暂时读不到磁盘信息')"
        :description="diskError ? tt(diskError) : ''"
      >
        <VxButton variant="secondary" @click="scanDisk">{{ tt('重试') }}</VxButton>
      </ToolEmpty>
    </section>

    <section class="device-section" aria-labelledby="device-detail-title">
      <div class="tool-section-head">
        <h2 id="device-detail-title" class="tool-section-title">{{ tt('硬件详情') }}</h2>
      </div>
      <div v-if="hardwareDetailRows.length" class="detail-panel tool-card-panel">
        <dl v-for="(column, index) in hardwareColumns" :key="index" class="detail-list">
          <template v-for="row in column" :key="row.key">
            <dt>{{ row.label }}</dt>
            <dd>
              <span v-for="value in row.values" :key="value">{{ value }}</span>
            </dd>
          </template>
        </dl>
      </div>
      <div v-else-if="isScanning" class="detail-panel tool-card-panel" aria-hidden="true">
        <div v-for="index in 2" :key="index" class="detail-list">
          <template v-for="row in 3" :key="row">
            <span class="tool-skeleton detail-skeleton is-label"></span>
            <span class="tool-skeleton detail-skeleton"></span>
          </template>
        </div>
      </div>
      <ToolEmpty v-else compact icon="chip" :title="tt('暂无硬件详情')" />
    </section>
  </div>
</template>

<style scoped lang="scss">
.device-button-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scan-notice__step {
  color: var(--color-text-secondary);
}

.scan-notice__progress {
  width: 100%;
  height: 6px;
}

.scan-steps {
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

.scan-steps__mark {
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

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
}

.overview-card {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
}

.overview-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.overview-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.overview-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.overview-value {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text);
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.35;
  word-break: break-word;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;

  &.is-muted {
    color: var(--color-text-muted);
  }
}

.overview-meta {
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.overview-skeleton {
  width: 90px;
  height: 10px;
  margin-top: 6px;

  &.is-wide {
    width: min(150px, 100%);
    height: 14px;
  }
}

.device-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.disk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
  gap: var(--space-3);
}

.disk-skeleton {
  height: 90px;
  border-radius: 10px;
}

.disk-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px var(--space-4);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.disk-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;

  strong {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
  }
}

.disk-card__icon {
  color: var(--color-text-tertiary);
}

.disk-card__spacer {
  flex: 1;
}

.disk-card__usage {
  min-width: 40px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.disk-card__bar {
  display: block;
  width: 100%;
  height: 8px;
  overflow: hidden;
  background: var(--color-surface-strong);
  border-radius: var(--radius-pill);

  span {
    display: block;
    height: 100%;
    background: var(--color-accent);
    border-radius: inherit;
    transition: width var(--duration-base) var(--ease-standard);

    &.is-warning {
      background: var(--color-warning);
    }

    &.is-danger {
      background: var(--color-danger);
    }
  }
}

.disk-card__meta {
  color: var(--color-text-muted);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.detail-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-8);
  padding: var(--space-1) var(--space-5);
}

.detail-list {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-content: start;
  margin: 0;

  dt,
  dd {
    margin: 0;
    padding: 11px 0;
    font-size: var(--font-size-sm);
    border-bottom: 1px solid var(--color-surface-strong);
  }

  dt {
    color: var(--color-text-muted);
  }

  dd {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }

  > :nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}

.detail-skeleton {
  height: 10px;
  margin: 15px 0;

  &.is-label {
    width: 48px;
  }
}

@media (max-width: 1100px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .detail-panel {
    grid-template-columns: minmax(0, 1fr);

    .detail-list + .detail-list {
      border-top: 1px solid var(--color-surface-strong);
    }
  }
}

@media (max-width: 640px) {
  .overview-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .disk-card,
  .disk-card__bar span {
    transition: none;
  }
}
</style>
