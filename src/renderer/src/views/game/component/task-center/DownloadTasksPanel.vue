<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FileIcons from 'file-icons-vue'
import {
  VxButton,
  VxCheckbox,
  VxConfirmModal,
  VxDialogActions,
  VxInput,
  VxModal,
  VxProgress
} from '@renderer/component/vertex-ui'
import { ToolEmpty, ToolIcon } from '@renderer/component/tool-page'
import { standaloneDownloads } from '../../../../../../shared/tasks/task-center-counts.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'

defineOptions({ name: 'DownloadTasksPanel' })

const props = defineProps({
  // downloading：下载中；downloaded：已下载。由任务中心侧栏切换。
  view: { type: String, default: 'downloading' }
})
const emit = defineEmits(['completed-count'])
const { t } = useI18n()

const downloadStore = useDownloadStore()
const dowList = computed(() => standaloneDownloads(downloadStore.downloadList))
const completedRecords = ref([])
const linkText = ref('')
const hasDownloadingTasks = computed(() => dowList.value.length > 0)
const isDownloading = computed(() => props.view !== 'downloaded')

const confirmOpen = ref(false)
const confirmIntent = ref(null)
const deleteOpen = ref(false)
const deleteLocalFile = ref(false)
const deleting = ref(false)
const deleteTarget = ref({})

const confirmTitle = computed(() => {
  if (confirmIntent.value?.type === 'cancel-all') return t('taskCenter.downloads.cancelAllTitle')
  if (confirmIntent.value?.type === 'clear-all') return t('taskCenter.downloads.clearTitle')
  return t('taskCenter.downloads.removeTitle')
})
const confirmDescription = computed(() => {
  if (confirmIntent.value?.type === 'cancel-all') {
    return t('taskCenter.downloads.cancelAllText', { count: dowList.value.length })
  }
  if (confirmIntent.value?.type === 'clear-all') return t('taskCenter.downloads.clearText')
  return t('taskCenter.downloads.removeText', { name: confirmIntent.value?.item?.task_name || '' })
})
const confirmText = computed(() => {
  if (confirmIntent.value?.type === 'cancel-all') return t('taskCenter.downloads.cancelAllConfirm')
  if (confirmIntent.value?.type === 'clear-all') return t('taskCenter.downloads.clearConfirm')
  return t('taskCenter.downloads.removeConfirm')
})

function formatFileSize(bytes) {
  const value = Number(bytes || 0)
  if (!value) return '0 MB'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(sizes.length - 1, Math.floor(Math.log(value) / Math.log(k)))
  return `${parseFloat((value / Math.pow(k, index)).toFixed(2))} ${sizes[index]}`
}

function remainingTime(item = {}) {
  if (!item.speed || item.speed <= 0 || item.percentage >= 100) {
    return t('taskCenter.downloads.remainingUnknown')
  }
  const seconds = (item.file_size * (100 - item.percentage)) / 100 / item.speed
  const time =
    seconds > 86400
      ? t('taskCenter.downloads.days', { count: Math.floor(seconds / 86400) })
      : seconds > 3600
        ? t('taskCenter.downloads.hours', { count: Math.floor(seconds / 3600) })
        : seconds > 60
          ? t('taskCenter.downloads.minutes', { count: Math.floor(seconds / 60) })
          : t('taskCenter.downloads.seconds', { count: Math.max(0, Math.floor(seconds)) })
  return t('taskCenter.downloads.remaining', { time })
}

function isValidUrl(url) {
  return /^https?:\/\/[^\s"']+$/i.test(url)
}

function getDownloadList() {
  ipcRenderer.send('getDownloadList', {})
}

function startDownloading() {
  const downloadUrl = linkText.value.trim()
  if (!isValidUrl(downloadUrl)) {
    $message.warning(t('taskCenter.downloads.invalidLink'))
    return
  }
  downloadStore.addDownloadItem({
    task_name: t('taskCenter.downloads.linkTaskName'),
    module: '下载',
    file_type: '未知',
    download_url: downloadUrl,
    speed: 0,
    file_size: 0,
    percentage: 0,
    funType: 2,
    saveType: 1
  })
  linkText.value = ''
}

function openFile(filePath) {
  ipcRenderer.send('openSpecifyPath', filePath)
}

function requestRemove(item) {
  confirmIntent.value = { type: 'remove', item }
  confirmOpen.value = true
}

function requestCancelAll() {
  if (!hasDownloadingTasks.value) return
  confirmIntent.value = { type: 'cancel-all' }
  confirmOpen.value = true
}

function requestClearAll() {
  confirmIntent.value = { type: 'clear-all' }
  confirmOpen.value = true
}

function confirmAction() {
  const intent = confirmIntent.value
  if (intent?.type === 'cancel-all') {
    const tasks = [...dowList.value]
    tasks.forEach((task) => downloadStore.cancelDownloadTaskById(task.id))
    if (tasks.length) {
      $message.success(t('taskCenter.downloads.cancelAllDone', { count: tasks.length }))
    }
  } else if (intent?.type === 'clear-all') {
    ipcRenderer.send('clearAllDownloadRecords')
  } else if (intent?.item) {
    downloadStore.cancelDownloadTaskById(intent.item.id)
  }
}

function requestDelete(item = {}) {
  deleteTarget.value = item
  deleteLocalFile.value = false
  deleteOpen.value = true
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  try {
    const result = await ipcRenderer.invoke('deleteDownloadRecord', {
      id: deleteTarget.value.id,
      deleteLocalFile: Boolean(deleteTarget.value.is_show_open) && deleteLocalFile.value === true
    })
    if (!result?.success) throw new Error(result?.message || t('taskCenter.downloads.deleteFailed'))
    deleteOpen.value = false
    getDownloadList()
  } catch (error) {
    $message.error(error.message || t('taskCenter.downloads.deleteFailed'))
  } finally {
    deleting.value = false
  }
}

useIpc('getDownloadListSuccess', (data) => {
  completedRecords.value = Array.isArray(data) ? data : []
})
useIpc('download-success', getDownloadList)
useIpc('clearAllDownloadRecordsSuccess', getDownloadList)

watch(
  () => completedRecords.value.length,
  (count) => emit('completed-count', count),
  { immediate: true }
)
watch(
  () => props.view,
  (view) => {
    if (view === 'downloaded') getDownloadList()
  }
)

onMounted(getDownloadList)
</script>

<template>
  <section class="download-index">
    <header class="download-header">
      <div class="download-header__heading">
        <h2>
          {{
            isDownloading
              ? t('taskCenter.downloads.downloadingTitle')
              : t('taskCenter.downloads.downloadedTitle')
          }}
        </h2>
        <span role="status" aria-live="polite">{{
          t('taskCenter.downloads.count', {
            count: isDownloading ? dowList.length : completedRecords.length
          })
        }}</span>
      </div>
      <VxButton
        v-if="isDownloading && hasDownloadingTasks"
        variant="ghost"
        size="sm"
        class="download-header__danger"
        @click="requestCancelAll"
        >{{ t('taskCenter.downloads.cancelAll') }}</VxButton
      >
      <VxButton
        v-if="!isDownloading && completedRecords.length"
        variant="secondary"
        size="sm"
        @click="requestClearAll"
        >{{ t('taskCenter.downloads.clearAll') }}</VxButton
      >
    </header>

    <div v-if="isDownloading" class="download-controls">
      <div class="input-group">
        <VxInput
          v-model="linkText"
          :aria-label="t('taskCenter.downloads.linkLabel')"
          :placeholder="t('taskCenter.downloads.linkPlaceholder')"
          class="download-input"
          @keyup.enter="startDownloading"
        />
        <VxButton
          variant="secondary"
          :disabled="!isValidUrl(linkText.trim())"
          @click="startDownloading"
        >
          <ToolIcon name="download" :size="15" />
          <span>{{ t('taskCenter.downloads.start') }}</span>
        </VxButton>
      </div>
      <p class="download-controls__hint">{{ t('taskCenter.downloads.hint') }}</p>
    </div>

    <div class="content-area vx-ui-scrollbar">
      <template v-if="isDownloading">
        <ToolEmpty
          v-if="!dowList.length"
          icon="download"
          :title="t('taskCenter.downloads.emptyDownloading')"
          :description="t('taskCenter.downloads.emptyDownloadingHint')"
          compact
        />
        <ul v-else class="download-list" :aria-label="t('taskCenter.downloads.listLabel')">
          <li v-for="item in dowList" :key="item.id" class="download-item">
            <span class="file-icon"
              ><FileIcons :name="`1.${item.file_type}`" :width="24" :height="24"
            /></span>
            <div class="file-details">
              <strong>{{ item.task_name }}</strong>
              <span>{{ item.module }} · {{ formatFileSize(item.file_size) }}</span>
            </div>
            <div class="download-progress">
              <div class="progress-header">
                <span
                  >{{
                    item.isPaused
                      ? t('taskCenter.downloads.paused')
                      : t('taskCenter.downloads.speed', {
                          speed: formatFileSize(Number(item.speed || 0))
                        })
                  }}
                  · {{ remainingTime(item) }}</span
                >
                <b>{{ Math.floor(item.percentage || 0) }}%</b>
              </div>
              <VxProgress
                :value="Number(item.percentage || 0)"
                role="progressbar"
                :aria-label="
                  t('taskCenter.downloads.progressLabel', {
                    name: item.task_name,
                    progress: Math.floor(item.percentage || 0)
                  })
                "
              />
            </div>
            <VxButton
              variant="ghost"
              size="sm"
              class="download-icon-button"
              :aria-label="t('taskCenter.downloads.remove', { name: item.task_name })"
              :title="t('taskCenter.downloads.remove', { name: item.task_name })"
              @click="requestRemove(item)"
            >
              <ToolIcon name="close" :size="14" />
            </VxButton>
          </li>
        </ul>
      </template>
      <template v-else>
        <ToolEmpty
          v-if="!completedRecords.length"
          icon="folder"
          :title="t('taskCenter.downloads.emptyDownloaded')"
          :description="t('taskCenter.downloads.emptyDownloadedHint')"
          compact
        />
        <ul v-else class="download-list" :aria-label="t('taskCenter.downloads.listLabel')">
          <li v-for="item in completedRecords" :key="item.id" class="completed-item">
            <span class="file-icon"
              ><FileIcons :name="`1.${item.file_type}`" :width="24" :height="24"
            /></span>
            <div class="file-details">
              <strong>{{ item.task_name }}</strong>
              <span
                >{{ item.module }} · {{ formatFileSize(item.file_size) }} ·
                {{ item.created_at }}</span
              >
            </div>
            <VxButton
              v-if="item.is_show_open"
              variant="secondary"
              size="sm"
              @click="openFile(item.file_path)"
              >{{ t('taskCenter.downloads.openFolder') }}</VxButton
            >
            <VxButton
              variant="ghost"
              size="sm"
              class="download-icon-button"
              :aria-label="t('taskCenter.downloads.deleteRecord', { name: item.task_name })"
              :title="t('taskCenter.downloads.deleteRecord', { name: item.task_name })"
              :disabled="deleting"
              @click="requestDelete(item)"
            >
              <ToolIcon name="trash" :size="14" />
            </VxButton>
          </li>
        </ul>
      </template>
    </div>

    <VxConfirmModal
      v-model="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-text="confirmText"
      :cancel-text="t('taskCenter.downloads.keep')"
      danger
      @confirm="confirmAction"
    />

    <VxModal
      v-model="deleteOpen"
      :title="t('taskCenter.downloads.deleteTitle')"
      :close-on-esc="!deleting"
      :show-close="!deleting"
      :close-on-overlay="false"
    >
      <p class="download-delete-text">
        {{ t('taskCenter.downloads.deleteText', { name: deleteTarget.task_name || '' }) }}
      </p>
      <VxCheckbox
        v-if="deleteTarget.is_show_open"
        v-model="deleteLocalFile"
        :disabled="deleting"
        :label="t('taskCenter.downloads.deleteLocal')"
      />
      <template #footer
        ><VxDialogActions
          :confirm-text="t('taskCenter.downloads.deleteConfirm')"
          :cancel-text="t('common.close')"
          confirm-variant="danger"
          :confirm-loading="deleting"
          :cancel-disabled="deleting"
          @cancel="deleteOpen = false"
          @confirm="confirmDelete()"
      /></template>
    </VxModal>
  </section>
</template>

<style scoped lang="scss">
.download-index {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}

.download-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-6) var(--space-3);
}

.download-header__heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.download-header h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.download-header__heading > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.download-header__danger {
  color: var(--color-danger-strong);
}

.download-controls {
  padding: 0 var(--space-6) var(--space-3);
}

.input-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 860px;
}

.input-group :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.download-input {
  flex: 1;
  min-width: 0;
}

.download-controls__hint {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.content-area {
  flex: 1;
  min-height: 0;
  margin: 0 var(--space-6) var(--space-5);
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-surface-strong);
  border-radius: 10px;
}

.download-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.download-item,
.completed-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-surface-hover);

  &:last-child {
    border-bottom: 0;
  }
}

.file-icon {
  display: grid;
  flex-shrink: 0;
  place-content: center;
  width: 36px;
  height: 40px;
  background: var(--color-surface-soft);
  border-radius: var(--radius-sm);
}

.file-details {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.file-details strong {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.file-details > span {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.download-progress {
  display: grid;
  gap: 6px;
  width: min(34%, 320px);
}

.download-progress :deep(.vx-progress) {
  width: 100%;
  height: 6px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.progress-header b {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}

.download-icon-button {
  width: 32px;
  padding: 0;
}

.download-delete-text {
  margin: 0;
}

@media (max-width: 899px) {
  .download-header,
  .download-controls {
    padding-inline: var(--space-4);
  }

  .content-area {
    margin-inline: var(--space-4);
  }

  .download-item,
  .completed-item {
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .file-details {
    flex-basis: calc(100% - 52px);
  }

  .download-progress {
    flex: 1;
    width: auto;
  }

  .input-group {
    flex-wrap: wrap;
  }
}
</style>
