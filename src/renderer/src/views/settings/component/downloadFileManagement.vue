<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import VxButton from '@renderer/component/vertex-ui/VxButton.vue'
import VxConfirmModal from '@renderer/component/vertex-ui/VxConfirmModal.vue'
import VxInput from '@renderer/component/vertex-ui/VxInput.vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxSegmented from '@renderer/component/vertex-ui/VxSegmented.vue'
import {
  CloseOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons-vue'
import { computed, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import FileIcons from 'file-icons-vue'

const showModal = ref(false)
const pageList = ref([])
const archiveCount = ref(0)
const sourceFilter = ref('all')
const searchKeyword = ref('')
const loading = ref(false)
const actionLoading = ref(false)
const deleteConfirmVisible = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmItems = ref([])
const deleteConfirmPlan = ref({})
const managedStats = ref({
  totalBytes: 0,
  reclaimableBytes: 0,
  categories: [],
  states: []
})

const props = defineProps({
  cachePath: {
    type: String,
    default: ''
  }
})

const sourceFilterMetaMap = {
  all: { get label() { return uiText('ui.allFiles') } },
  download: { get label() { return uiText('ui.downloadCache') } },
  mod_source: { get label() { return uiText('ui.modFiles') } },
  temp: { get label() { return uiText('ui.temporaryFiles') } },
  orphaned: { get label() { return uiText('ui.otherFiles') } }
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function buildManagePayload() {
  return toPlainJson({
    rootPath: props.cachePath,
    includeSameDriveCache: true,
    states: ['active', 'delete_failed', 'missing', 'orphaned', 'ignored']
  })
}

async function open() {
  showModal.value = true
  await refreshManagedFiles()
}

function closeModal() {
  showModal.value = false
}

function buildDeletePreviewPayload(items = []) {
  const assetIds = items.map((item) => item.assetId).filter(Boolean)
  if (assetIds.length) {
    return toPlainJson({
      rootPath: props.cachePath,
      assetIds
    })
  }

  return toPlainJson({
    rootPath: props.cachePath,
    legacyItems: items
  })
}

function buildSkippedSamples(plan = {}) {
  return (Array.isArray(plan.items) ? plan.items : [])
    .filter((item) => !item.canDelete)
    .slice(0, 3)
    .map((item) => ({
      path: item.filePath || '未知文件',
      reason: (item.skipReasons || []).join('；') || uiText('taskCenter.itemStates.skipped')
    }))
}

function openDeleteConfirm(title, items = [], plan = {}) {
  deleteConfirmTitle.value = title
  deleteConfirmItems.value = toPlainJson(items)
  deleteConfirmPlan.value = toPlainJson(plan)
  deleteConfirmVisible.value = true
}

async function refreshManagedFiles() {
  loading.value = true
  try {
    const payload = buildManagePayload()
    const [listResult, statsResult] = await Promise.all([
      ipcRenderer.invoke('managedFile:listAssets', payload),
      ipcRenderer.invoke('managedFile:getStats', payload)
    ])
    pageList.value = Array.isArray(listResult?.items) ? listResult.items : []
    managedStats.value = {
      totalBytes: Number(statsResult?.totalBytes || 0),
      reclaimableBytes: Number(statsResult?.reclaimableBytes || 0),
      categories: Array.isArray(statsResult?.categories) ? statsResult.categories : [],
      states: Array.isArray(statsResult?.states) ? statsResult.states : []
    }
    archiveCount.value = Number(listResult?.totalCount || pageList.value.length || 0)
  } catch (error) {
    $message.error(error?.message || '加载文件空间数据失败')
  } finally {
    loading.value = false
  }
}

async function previewDelete(items = []) {
  return await ipcRenderer.invoke(
    'managedFile:previewDeleteAssets',
    buildDeletePreviewPayload(items)
  )
}

async function executeDelete(items = []) {
  const result = await ipcRenderer.invoke(
    'managedFile:deleteAssets',
    buildDeletePreviewPayload(items)
  )
  await refreshManagedFiles()
  const failedCount = Number(result?.failedCount || 0)
  const skippedCount = Number(result?.skippedCount || 0)
  if (failedCount > 0) {
    $message.warning(
      uiMessage('ui.deletedValueItemsValueFailedAndValueSkipped', { value1: (result.deletedCount || 0), value2: (failedCount), value3: (skippedCount) })
    )
  } else {
    $message.success(uiMessage('ui.deletedValueItemsValueSkipped', { value1: (result.deletedCount || 0), value2: (skippedCount) }))
  }
  return result
}

async function deleteFile(item) {
  const items = [toPlainJson(item)]
  const plan = await previewDelete(items)
  openDeleteConfirm('删除文件和记录', items, plan)
}

async function deleteAllFiles() {
  const targetList = toPlainJson(pageList.value)
  const plan = await previewDelete(targetList)
  openDeleteConfirm('清空文件空间', targetList, plan)
}

async function confirmDeleteAssets() {
  const targetList = toPlainJson(deleteConfirmItems.value)
  const result = await executeDelete(targetList)
  if (result?.failedCount) throw new Error(uiText('ui.couldNotDeleteValueItemsRecordsWereKeptForRetry', { value1: (result.failedCount) }))
}

async function scanOrphans() {
  actionLoading.value = true
  try {
    const result = await ipcRenderer.invoke(
      'managedFile:scanOrphans',
      toPlainJson({
        ...buildManagePayload(),
        register: true
      })
    )
    $message.success(uiMessage('ui.scanCompleteFoundValueFilesThatCanBeManaged', { value1: (result?.foundCount || 0) }))
    await refreshManagedFiles()
  } catch (error) {
    $message.error(error?.message || '扫描文件失败')
  } finally {
    actionLoading.value = false
  }
}

async function retryFailedDeletes() {
  actionLoading.value = true
  try {
    const result = await ipcRenderer.invoke('managedFile:retryDeleteFailed', buildManagePayload())
    const failedCount = Number(result?.failedCount || 0)
    if (failedCount > 0) {
      $message.warning(uiMessage('ui.retryCompleteValueItemsStillFailed', { value1: (failedCount) }))
    } else {
      $message.success(uiMessage('ui.retryCompleteCleanedUpValueItems', { value1: (result?.deletedCount || 0) }))
    }
    await refreshManagedFiles()
  } catch (error) {
    $message.error(error?.message || '重试失败删除失败')
  } finally {
    actionLoading.value = false
  }
}

async function ignoreAsset(item = {}) {
  if (!item?.assetId) return
  actionLoading.value = true
  try {
    await ipcRenderer.invoke(
      'managedFile:markAssets',
      toPlainJson({
        assetIds: [item.assetId],
        state: 'ignored'
      })
    )
    $message.success(uiMessage('ui.markedAsIgnored'))
    await refreshManagedFiles()
  } catch (error) {
    $message.error(error?.message || '标记忽略失败')
  } finally {
    actionLoading.value = false
  }
}

function openFile(item) {
  const filePath = item?.filePath || item?.file_path
  if (!filePath) return
  ipcRenderer.send('openSpecifyPath', filePath)
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getSourceGroup(item = {}) {
  const assetType = String(item.assetType || item.asset_type || '').trim()
  if (sourceFilterMetaMap[assetType]) return assetType
  return 'all'
}

function getFileTitle(item = {}) {
  return (
    String(item.displayName || item.display_name || item.task_name || uiText('ui.unnamedFile')).trim() ||
    uiText('ui.unnamedFile')
  )
}

function getFileIconName(item = {}) {
  const filePath = String(item.filePath || item.file_path || '')
  const ext = String(pathExt(filePath) || item.type || item.file_type || '')
    .replace(/^\./, '')
    .trim()
  const safeExt = /^[a-z0-9.+-]+$/i.test(ext) && ext !== 'file' ? ext : ''
  return `1.${safeExt || 'txt'}`
}

function pathExt(filePath = '') {
  const text = String(filePath || '').trim()
  const fileName = text.split(/[\\/]/).pop() || ''
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index + 1) : ''
}

function getIssueText(item = {}) {
  const reasons = Array.isArray(item.skipReasons) ? item.skipReasons.filter(Boolean) : []
  const deleteError = String(item.deleteError || '').trim()
  if (deleteError) return deleteError
  if (reasons.length) return reasons.join('；')
  if (item.state === 'missing') return uiText('ui.theFileDoesNotExistItMayHaveBeenMoved')
  if (item.state === 'delete_failed') return uiText('ui.thePreviousCleanupFailedUseRetryCleanupAboveToTry')
  return ''
}

const filteredList = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase()

  return pageList.value.filter((item) => {
    if (sourceFilter.value !== 'all' && getSourceGroup(item) !== sourceFilter.value) {
      return false
    }

    if (keyword) {
      const searchableText = [
        getFileTitle(item),
        item.filePath,
        item.file_path,
        item.source_label,
        item.profileName
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
      if (!searchableText.includes(keyword)) return false
    }

    return true
  })
})

const totalArchiveCount = computed(() => {
  const total = Number(archiveCount.value || 0)
  return total > 0 ? total : pageList.value.length
})

const hasActiveFilters = computed(() => {
  return sourceFilter.value !== 'all' || Boolean(searchKeyword.value.trim())
})

const sourceFilterOptions = computed(() => {
  return [
    { value: 'all', get label() { return uiText('ui.allFiles') } },
    { value: 'download', get label() { return uiText('ui.downloadCache') } },
    { value: 'mod_source', get label() { return uiText('ui.modFiles') } },
    { value: 'temp', get label() { return uiText('ui.temporaryFiles') } }
  ]
})

const summaryStats = computed(() => {
  const categoryMap = new Map((managedStats.value.categories || []).map((item) => [item.key, item]))
  const getCategory = (key) => categoryMap.get(key) || {}
  return [
    {
      get label() { return uiText('ui.totalSpaceUsed') },
      value: formatBytes(managedStats.value.totalBytes),
      helper: uiText('ui.valueFiles', { value1: (totalArchiveCount.value) })
    },
    {
      get label() { return uiText('ui.reclaimableSpace') },
      value: formatBytes(managedStats.value.reclaimableBytes),
      helper: uiText('ui.valueFilesCanBeCleanedUp', { value1: (getCategory('reclaimable').count || 0) }),
      highlight: true
    },
    {
      get label() { return uiText('ui.downloadCache') },
      value: formatBytes(getCategory('download').totalBytes || 0),
      helper: uiText('ui.valueFiles', { value1: (getCategory('download').count || 0) })
    }
  ]
})

const deletePreviewStats = computed(() => {
  const plan = deleteConfirmPlan.value || {}
  return [
    { get label() { return uiText('ui.checkFiles') }, value: Number(plan.totalCount || 0) },
    { get label() { return uiText('ui.canBeDeleted') }, value: Number(plan.deletableCount || 0) },
    { get label() { return uiText('ui.skip') }, value: Number(plan.skippedCount || 0) },
    { get label() { return uiText('ui.estimatedSpaceFreed') }, value: formatBytes(Number(plan.releasableBytes || 0)) }
  ]
})

const deleteSkippedSamples = computed(() => buildSkippedSamples(deleteConfirmPlan.value))

const listSummaryText = computed(() => {
  if (!totalArchiveCount.value) {
    return loading.value ? uiText('ui.loadingVariant6') : uiText('ui.noFiles')
  }

  if (!hasActiveFilters.value) {
    return uiText('ui.valueItemsTotal', { value1: (totalArchiveCount.value) })
  }

  const activeSourceFilter = sourceFilterOptions.value.find(
    (item) => item.value === sourceFilter.value
  )
  const keyword = searchKeyword.value.trim()

  if (keyword && sourceFilter.value !== 'all')
    return `${activeSourceFilter?.label || uiText('ui.currentType')} · “${keyword}”`
  if (keyword) return uiText('ui.searchResultsForValue', { value1: (keyword) })

  return activeSourceFilter?.label || uiText('ui.currentType')
})

const emptyStateCopy = computed(() => {
  if (pageList.value.length) {
    return {
      get title() { return uiText('ui.noMatchingFiles') },
      get description() { return uiText('ui.noResultsMatchTheCurrentFilters') },
      tip: '试试清空搜索内容，或切换其他文件类型。'
    }
  }

  return {
    get title() { return uiText('ui.noDownloadedFilesYet') },
    get description() { return uiText('ui.completedDownloadsWillAppearHere') },
    tip: '点击“扫描文件”可以查找已有文件。'
  }
})

useIpc('getAllFileRecordsSuccess', (data) => {
  if (Array.isArray(data?.list) && data.list.length && !pageList.value.length) {
    pageList.value = data.list || []
    archiveCount.value = Number(data.archiveCount || 0)
  }
})

useIpc('deleteFileRecordSuccess', () => {
  refreshManagedFiles()
})

useIpc('deleteAllFileRecordsSuccess', () => {
  refreshManagedFiles()
})

defineExpose({
  open
})
</script>

<template>
  <VxModal v-model="showModal" plain :aria-label="$t('ui.fileManagement')" @close="closeModal">
    <section class="download-manager-panel">
      <header class="manager-header">
        <div class="manager-heading">
          <h2>{{ $t('ui.fileManagement') }}</h2>
          <p>{{ $t('ui.reviewDownloadedFilesAndBackupsAndFreeUpUnusedDisk') }}</p>
        </div>

        <div class="manager-actions">
          <VxButton variant="secondary" size="sm" :loading="actionLoading" @click="scanOrphans">
            <SearchOutlined />
            {{ $t('ui.scanFiles') }}
          </VxButton>
          <VxButton
            variant="secondary"
            size="sm"
            :loading="actionLoading"
            @click="retryFailedDeletes"
          >
            <ReloadOutlined />
            {{ $t('ui.retryCleanup') }}
          </VxButton>
          <VxButton variant="danger" size="sm" :disabled="!pageList.length" @click="deleteAllFiles">
            <DeleteOutlined />
            {{ $t('ui.cleanUpFiles') }}
          </VxButton>
          <button class="manager-close" type="button" :aria-label="$t('ui.closeFileManagement')" @click="closeModal">
            <CloseOutlined />
          </button>
        </div>
      </header>

      <section class="summary-panel" :aria-label="$t('ui.storageOverview')">
        <div
          v-for="item in summaryStats"
          :key="item.label"
          class="summary-item"
          :class="{ 'summary-item--highlight': item.highlight }"
        >
          <span class="summary-label">{{ item.label }}</span>
          <strong class="summary-value">{{ item.value }}</strong>
          <span class="summary-helper">{{ item.helper }}</span>
        </div>
      </section>

      <section class="content-panel" :aria-busy="loading">
        <div class="content-toolbar">
          <div class="type-filter">
            <span class="toolbar-label">{{ $t('ui.fileType') }}</span>
            <VxSegmented v-model="sourceFilter" :options="sourceFilterOptions" />
          </div>
          <div class="file-search">
            <VxInput v-model="searchKeyword" :placeholder="$t('ui.searchFileNamesOrPaths')" clearable />
          </div>
        </div>

        <div class="content-head">
          <div>
            <strong>{{ $t('ui.fileList') }}</strong>
            <span>{{ filteredList.length }} {{ $t('ui.items') }}</span>
          </div>
          <p>{{ listSummaryText }}</p>
        </div>

        <div v-if="filteredList.length" class="file-list-head" aria-hidden="true">
          <span>{{ $t('tools.file') }}</span>
          <span>{{ $t('taskCenter.detail.facts.updated') }}</span>
          <span>{{ $t('tools.size') }}</span>
          <span>{{ $t('ui.actions') }}</span>
        </div>

        <div v-if="filteredList.length" class="file-list">
          <article
            v-for="d in filteredList"
            :key="d.id"
            class="file-item"
            :class="{ 'file-item--warning': getIssueText(d) }"
          >
            <div class="item-icon">
              <FileIcons
                :name="getFileIconName(d)"
                :width="26"
                :height="26"
                :item-style="{ display: 'flex', alignItems: 'center', justifyContent: 'center' }"
              />
            </div>

            <div class="item-body">
              <div class="item-title">{{ getFileTitle(d) }}</div>
              <div class="item-path" :title="d.filePath || d.file_path || ''">
                {{ d.filePath || d.file_path || '--' }}
              </div>
              <p v-if="getIssueText(d)" class="item-warning">
                <ExclamationCircleOutlined />
                <span>{{ getIssueText(d) }}</span>
              </p>
            </div>

            <time class="item-time">{{ formatDateTime(d.updatedAt || d.create_time) }}</time>
            <strong class="item-size">{{ formatBytes(d.sizeBytes || d.size) }}</strong>

            <div class="item-actions">
              <VxButton variant="ghost" size="sm" @click="openFile(d)">
                <FolderOpenOutlined />
                {{ $t('ui.open') }}
              </VxButton>
              <VxButton
                v-if="d.state === 'orphaned' || d.state === 'missing'"
                variant="ghost"
                size="sm"
                @click="ignoreAsset(d)"
              >
                {{ $t('ui.skipped') }}
              </VxButton>
              <VxButton variant="ghost" size="sm" class="delete-file-button" @click="deleteFile(d)">
                <DeleteOutlined />
                {{ $t('modelSettings.remove') }}
              </VxButton>
            </div>
          </article>
        </div>

        <div v-else class="simple-empty-state">
          <strong>{{ emptyStateCopy.title }}</strong>
          <span>{{ emptyStateCopy.description }}</span>
          <small>{{ emptyStateCopy.tip }}</small>
        </div>
      </section>
    </section>
  </VxModal>

  <VxConfirmModal
    v-model="deleteConfirmVisible"
    :title="deleteConfirmTitle"
    :description="$t('ui.onlyEligibleFilesAndTheirRecordsWillBeDeletedReasons')"
    :confirm-text="$t('ui.confirmDeletion')"
    :cancel-text="$t('ui.cancel')"
    danger
    :confirm-action="confirmDeleteAssets"
  >
    <div class="delete-confirm-content">
      <div class="delete-preview-grid">
        <div v-for="item in deletePreviewStats" :key="item.label" class="delete-preview-card">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <div v-if="deleteSkippedSamples.length" class="delete-skip-box">
        <strong>{{ $t('ui.examplesOfSkippedFiles') }}</strong>
        <p v-for="item in deleteSkippedSamples" :key="item.path">
          <span>{{ item.reason }}</span>
          <small>{{ item.path }}</small>
        </p>
      </div>

      <p class="delete-confirm-note">{{ $t('ui.youCanRetryFailedDeletionsInFileManagementLater') }}</p>
    </div>
  </VxConfirmModal>
</template>

<style scoped lang="scss">
.download-manager-panel {
  width: min(1120px, calc(100vw - 72px));
  height: min(700px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--color-text);
}

.manager-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  min-height: 76px;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}

.manager-heading {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.manager-heading h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  line-height: 1.3;
}

.manager-heading p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.manager-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.manager-actions :deep(.vx-button__content),
.item-actions :deep(.vx-button__content) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.manager-close {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);
}

.manager-close:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
}

.manager-close:focus-visible {
  box-shadow: var(--focus-ring);
}

.summary-panel {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: var(--space-4) var(--space-5) 0;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.summary-item {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label helper'
    'value helper';
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-right: 1px solid var(--color-border);
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  grid-area: label;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.summary-value {
  grid-area: value;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 22px;
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-helper {
  grid-area: helper;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: right;
  white-space: nowrap;
}

.summary-item--highlight .summary-value {
  color: var(--color-accent);
}

.content-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: var(--space-4) var(--space-5) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.content-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.type-filter {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.toolbar-label {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.type-filter :deep(.vx-segmented) {
  width: 520px;
}

.file-search {
  width: min(280px, 32vw);
}

.file-search :deep(.vx-input) {
  min-height: var(--control-height-sm);
  font-size: var(--font-size-sm);
}

.content-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 48px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.content-head div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.content-head strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}

.content-head span {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.content-head p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: right;
}

.file-list-head,
.file-item {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) 164px 90px 180px;
  align-items: center;
  column-gap: var(--space-4);
}

.file-list-head {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 var(--space-4) 0 70px;
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.file-list-head span:nth-child(3),
.file-list-head span:nth-child(4) {
  text-align: right;
}

.file-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.file-list::-webkit-scrollbar {
  width: 7px;
}

.file-list::-webkit-scrollbar-track {
  background: var(--scrollbar-track-color);
  border-radius: var(--default-border-radius);
  margin: 24px 0;
}

.file-list::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb-color);
  border-radius: 4px;
  min-height: 40px;
}

.file-list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.file-item {
  position: relative;
  min-height: 74px;
  padding: var(--space-3) var(--space-4) var(--space-3) 70px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: background var(--duration-fast) var(--ease-standard);
}

.file-item:last-child {
  border-bottom: 0;
}

.file-item:hover {
  background: var(--color-surface-hover);
}

.file-item--warning {
  min-height: 94px;
}

.item-icon {
  position: absolute;
  left: var(--space-4);
  top: 50%;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.item-body {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.item-title,
.item-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-title {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.item-path,
.item-time {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.item-time {
  white-space: nowrap;
}

.item-size {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  text-align: right;
  white-space: nowrap;
}

.item-warning {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--color-warning);
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.item-warning span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-path {
  font-family: 'Cascadia Mono', 'JetBrains Mono', monospace;
}

.item-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
}

.item-actions :deep(.vx-button) {
  padding: 0 var(--space-2);
}

.item-actions :deep(.delete-file-button) {
  color: var(--color-danger);
}

.item-actions :deep(.delete-file-button:hover:not(:disabled)) {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.simple-empty-state {
  flex: 1 1 auto;
  min-height: 180px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-6);
  color: var(--color-text-muted);
  text-align: center;
}

.simple-empty-state strong {
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.simple-empty-state span,
.simple-empty-state small {
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.delete-confirm-content {
  display: grid;
  gap: 14px;
}

.delete-preview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.delete-preview-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.delete-preview-card span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.delete-preview-card strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-skip-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-warning-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-warning-soft) 70%, var(--color-surface) 30%);
}

.delete-skip-box strong {
  color: var(--color-warning);
  font-size: var(--font-size-sm);
}

.delete-skip-box p {
  min-width: 0;
  display: grid;
  gap: 3px;
  margin: 0;
}

.delete-skip-box span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.delete-skip-box small {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: 'Cascadia Mono', 'JetBrains Mono', monospace;
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-confirm-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

@media (max-width: 960px) {
  .download-manager-panel {
    width: calc(100vw - 40px);
  }

  .manager-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .manager-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .manager-close {
    margin-left: auto;
  }

  .content-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .type-filter {
    align-items: flex-start;
    flex-direction: column;
  }

  .type-filter :deep(.vx-segmented),
  .file-search {
    width: 100%;
  }

  .file-list-head {
    display: none;
  }

  .file-item {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'body size'
      'time actions';
    row-gap: var(--space-2);
  }

  .item-body {
    grid-area: body;
  }

  .item-time {
    grid-area: time;
  }

  .item-size {
    grid-area: size;
  }

  .item-actions {
    grid-area: actions;
    flex-wrap: wrap;
  }

  .delete-preview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-height: 760px) {
  .download-manager-panel {
    height: calc(100vh - 56px);
  }

  .manager-header {
    min-height: 66px;
  }

  .summary-item {
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }
}
</style>
