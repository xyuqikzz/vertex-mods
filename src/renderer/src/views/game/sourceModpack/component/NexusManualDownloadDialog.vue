<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CopyOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ReloadOutlined,
  SettingOutlined,
  StepForwardOutlined,
  StopOutlined
} from '@ant-design/icons-vue'
import { VxBadge, VxButton, VxModal } from '@renderer/component/vertex-ui'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import router from '@renderer/router/index.js'
import { getNextNexusAuthorizationItem } from '../../../../../../shared/sources/nexus-download-link.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  jobId: { type: String, default: '' },
  itemId: { type: String, default: '' }
})

const emit = defineEmits(['update:open', 'updated', 'cancel-task'])
const loading = ref(false)
const operatingItemId = ref('')
const detail = ref(null)
const selectedItemId = ref('')
const lastOpenedItemId = ref('')
let loadSerial = 0

function toText(value = '') {
  return String(value ?? '').trim()
}

function toPlainPayload(value = {}) {
  return JSON.parse(JSON.stringify(value || {}))
}

const authorization = computed(() => detail.value?.nexusAuthorization || {})
const items = computed(() =>
  Array.isArray(authorization.value?.items) ? authorization.value.items : []
)
const selectedItem = computed(
  () => items.value.find((item) => item.itemId === selectedItemId.value) || items.value[0] || null
)
const taskPaused = computed(() => authorization.value.state === 'paused')
const nextPendingItem = computed(() => taskPaused.value
  ? null
  : getNextNexusAuthorizationItem(items.value, lastOpenedItemId.value))
const description = computed(() => {
  const snapshot = authorization.value
  return [
    snapshot.title || 'Nexus 授权任务',
    uiText('ui.valueItemsAwaitingAuthorization', { value1: (Number(snapshot.waitingCount || 0)) }),
    '关闭面板不会取消任务'
  ].join(' · ')
})

function statusLabel(item = {}) {
  const status = item.status
  if (status === 'failed' && item.downloadReady) return uiText('ui.downloadedInstallationBlocked')
  return (
    {
      waiting_authorization: uiText('taskCenter.itemStates.waiting_authorization'),
      authenticating: uiText('ui.waitingForBrowserCallback'),
      created: uiText('ui.preparingDownload'),
      waiting_artifact: uiText('taskCenter.itemStates.waiting_artifact'),
      downloading: uiText('tools.downloading'),
      downloaded: uiText('ui.fileDownloaded'),
      file_ready: uiText('taskCenter.itemStates.file_ready'),
      inspecting_archive: uiText('taskCenter.itemStates.inspecting_archive'),
      previewing: uiText('taskCenter.itemStates.previewing'),
      installing: uiText('taskCenter.itemStates.installing'),
      installed: uiText('tools.completed'),
      skipped_installed: uiText('taskCenter.itemStates.skipped_installed'),
      skipped: uiText('taskCenter.itemStates.skipped'),
      failed: uiText('ui.processingFailed'),
      cancelled: uiText('taskCenter.views.cancelled')
    }[status] || status || uiText('taskCenter.states.unknown')
  )
}

function statusTone(status = '') {
  if (['file_ready', 'downloaded', 'installed', 'skipped_installed'].includes(status)) return 'success'
  if (status === 'failed') return 'danger'
  if (['waiting_authorization', 'authenticating', 'skipped'].includes(status)) return 'warning'
  return 'info'
}

function canAuthorize(item = {}) {
  return !taskPaused.value && ['waiting_authorization', 'authenticating'].includes(item.status)
}

async function loadSnapshot(options = {}) {
  const jobId = toText(props.jobId)
  if (!jobId) return
  const serial = ++loadSerial
  if (!options.silent) loading.value = true
  try {
    const result = await ipcRenderer.invoke(
      'source-install-task:detail',
      toPlainPayload({ jobId })
    )
    if (serial !== loadSerial) return
    if (result?.success === false || !result?.data) {
      throw new Error(result?.message || uiText('ui.couldNotReadAuthorizationTask'))
    }
    detail.value = result.data
    const snapshotItems = Array.isArray(result.data?.nexusAuthorization?.items)
      ? result.data.nexusAuthorization.items
      : []
    const preferredId = toText(props.itemId || selectedItemId.value)
    const preferred = snapshotItems.find((item) => item.itemId === preferredId)
    selectedItemId.value =
      preferred?.itemId ||
      snapshotItems.find((item) => canAuthorize(item))?.itemId ||
      snapshotItems[0]?.itemId ||
      ''
    emit('updated', result.data)
  } catch (error) {
    if (!options.silent) $message.error(toText(error?.message) || '读取授权任务失败')
  } finally {
    if (serial === loadSerial) loading.value = false
  }
}

async function performAction(item = {}, action = '', extra = {}) {
  if (!item?.itemId || operatingItemId.value) return null
  operatingItemId.value = item.itemId
  try {
    const result = await ipcRenderer.invoke(
      'source-install-task:authorization-action',
      toPlainPayload({ jobId: props.jobId, itemId: item.itemId, action, ...extra })
    )
    if (result?.success === false && !result?.canceled) {
      const error = new Error(result?.message || uiText('ui.nexusAuthorizationOperationFailed'))
      error.result = result
      throw error
    }
    await loadSnapshot({ silent: true })
    return result
  } catch (error) {
    $message.warning(toText(error?.message) || 'Nexus 授权操作失败')
    return error?.result || null
  } finally {
    operatingItemId.value = ''
  }
}

async function startSession(item = {}, mode = 'external') {
  const result = await performAction(item, 'open', { mode })
  if (!result?.success || !result.pageUrl || result.jobId !== props.jobId) return
  lastOpenedItemId.value = item.itemId
  if (mode === 'copy') {
    try {
      await navigator.clipboard.writeText(result.pageUrl)
      $message.success(uiMessage('ui.nexusFilePageLinkCopiedOpenItAndClickDownload'))
    } catch {
      $message.warning(uiMessage('ui.copyingFailedUseOpenInBrowser'))
    }
    return
  }
  if (mode === 'external' && !result.browserOpened) ipcRenderer.send('openBrowse', toPlainPayload({ url: result.pageUrl }))
  $message.info(mode === 'open'
    ? '辅助窗口登录独立；若已在浏览器登录，请使用“浏览器下载”'
    : '请点击 Mod Manager Download 返回 Vertex；若下载到浏览器，请选择对应的本地文件')
}

async function selectLocalFile(item = {}) {
  const result = await performAction(item, 'select_local_file')
  if (result?.success) $message.success(uiMessage('ui.localFileVerifiedTheTaskWillContinueAutomatically'))
}

async function retryItem(item = {}) {
  const result = await performAction(item, 'retry')
  if (result?.success) $message.success(uiMessage('ui.thisItemCanBeAuthorizedAgain'))
}

async function skipItem(item = {}) {
  const result = await performAction(item, 'skip')
  if (result?.success) $message.success(uiMessage('ui.optionalDependencySkipped'))
}

async function openNextPending() {
  const next = nextPendingItem.value
  if (!next) {
    $message.info(uiMessage('ui.noNexusFilesAreWaitingForAuthorization'))
    return
  }
  selectedItemId.value = next.itemId
  await startSession(next)
}

function closePanel() {
  // Authorization belongs to the task and remains valid while the browser is open.
  emit('update:open', false)
}

function openApiSettings() {
  emit('update:open', false)
  router.push('/app/settings')
}

function openTaskCenter() {
  emit('update:open', false)
  router.push({ path: '/app/game/install-tasks', query: { jobId: props.jobId } })
}

function handleTaskUpdated(_event, payload = {}) {
  const payloadJobId = toText(payload?.job_id || payload?.jobId || payload?.job?.job_id)
  if (props.open && payloadJobId === toText(props.jobId)) loadSnapshot({ silent: true })
}

watch(
  () => [props.open, props.jobId, props.itemId],
  ([open]) => {
    if (open) loadSnapshot()
  },
  { immediate: true }
)

watch(() => props.jobId, () => { lastOpenedItemId.value = '' })

onMounted(() => {
  ipcRenderer.on('source-install-task:updated', handleTaskUpdated)
})

onBeforeUnmount(() => {
  ipcRenderer.removeListener('source-install-task:updated', handleTaskUpdated)
})
</script>

<template>
  <VxModal
    :model-value="open"
    :title="$t('ui.nexusManualDownloadAssistant')"
    :description="description"
    :width="960"
    panel-class="nexus-authorization-task-modal"
    @close="closePanel"
  >
    <div class="nexus-authorization-task">
      <section class="nexus-authorization-task__notice" role="status">
        <GlobalOutlined aria-hidden="true" />
        <div>
          <strong>{{ $t('ui.continueDownloadingInYourSignedInBrowser') }}</strong>
          <span>{{ $t('ui.vertexAccountAuthorizationAndWebsiteSessionsAreStoredSeparatelyYour') }}</span>
          <span>{{ $t('ui.clickModManagerDownloadToReturnToVertexAfterA') }}</span>
        </div>
      </section>

      <p v-if="taskPaused" class="nexus-authorization-task__message" role="status">
        {{ $t('ui.thisTaskIsPausedResumeItInTheTaskCenter') }}
      </p>

      <section class="nexus-authorization-task__summary" :aria-label="$t('ui.authorizationTaskSummary')">
        <div><span>{{ $t('ui.totalFiles') }}</span><strong>{{ authorization.totalCount || 0 }}</strong></div>
        <div><span>{{ $t('taskCenter.states.waiting_user_action') }}</span><strong>{{ authorization.waitingCount || 0 }}</strong></div>
        <div><span>{{ $t('tools.downloaded') }}</span><strong>{{ authorization.downloadedCount || 0 }}</strong></div>
        <div><span>{{ $t('ui.taskComplete') }}</span><strong>{{ authorization.completedCount || 0 }}</strong></div>
        <div><span>{{ $t('tools.needsAttention') }}</span><strong>{{ authorization.failedCount || 0 }}</strong></div>
      </section>

      <div v-if="loading" class="nexus-authorization-task__empty">{{ $t('ui.loadingTaskSnapshot') }}</div>
      <div v-else-if="!items.length" class="nexus-authorization-task__empty">
        {{ $t('ui.thisTaskHasNoNexusAuthorizationItems') }}
      </div>
      <section v-else class="nexus-authorization-task__items vx-ui-scrollbar">
        <article
          v-for="item in items"
          :key="item.itemId"
          class="nexus-authorization-task__item"
          :class="{ 'is-selected': selectedItem?.itemId === item.itemId }"
          @click="selectedItemId = item.itemId"
        >
          <div class="nexus-authorization-task__item-main">
            <header>
              <strong>{{ item.title }}</strong>
              <VxBadge :tone="statusTone(item.status)">{{ statusLabel(item) }}</VxBadge>
            </header>
            <p>
              {{ item.target.gameDomain }} · Mod {{ item.target.modId }} · File
              {{ item.target.fileId }}
            </p>
            <span v-if="item.message" class="nexus-authorization-task__message">{{ item.message }}</span>
            <span v-if="item.userAction" class="nexus-authorization-task__message">{{ item.userAction }}</span>
          </div>

          <div v-if="canAuthorize(item)" class="nexus-authorization-task__actions">
            <VxButton
              variant="primary"
              size="sm"
              :disabled="Boolean(operatingItemId)"
              :loading="operatingItemId === item.itemId"
              @click.stop="startSession(item)"
            >
              <GlobalOutlined />{{ $t('ui.downloadInBrowser') }}
            </VxButton>
            <VxButton
              variant="secondary" size="sm" :disabled="Boolean(operatingItemId)"
              @click.stop="selectLocalFile(item)"><FolderOpenOutlined />{{ $t('ui.selectLocalFile') }}</VxButton>
            <VxButton
              variant="secondary"
              size="sm"
              :disabled="Boolean(operatingItemId)"
              @click.stop="startSession(item, 'copy')"
            >
              <CopyOutlined />{{ $t('siteDetail.copyLink') }}
            </VxButton>
            <VxButton variant="secondary" size="sm" :disabled="Boolean(operatingItemId)" @click.stop="startSession(item, 'open')">
              {{ $t('ui.helperWindow') }}
            </VxButton>
            <VxButton variant="secondary" size="sm" :disabled="Boolean(operatingItemId)" @click.stop="retryItem(item)">
              <ReloadOutlined />{{ $t('steamAccount.reauthorize') }}
            </VxButton>
            <VxButton v-if="item.optional" variant="secondary" size="sm" :disabled="Boolean(operatingItemId)" @click.stop="skipItem(item)">
              <StopOutlined />{{ $t('ui.skip') }}
            </VxButton>
          </div>
          <div v-else-if="item.status === 'failed'" class="nexus-authorization-task__actions">
            <VxButton variant="secondary" size="sm" @click.stop="openTaskCenter">{{ $t('ui.viewInstallationTask') }}</VxButton>
          </div>
        </article>
      </section>
    </div>

    <template #footer>
      <div class="nexus-authorization-task__footer">
        <VxButton variant="secondary" @click="openApiSettings"><SettingOutlined />{{ $t('ui.accountAndAPIKeySettings') }}</VxButton>
        <VxButton variant="secondary" :disabled="Boolean(operatingItemId) || !nextPendingItem" @click="openNextPending"><StepForwardOutlined />{{ $t('ui.downloadNext') }}</VxButton>
        <VxButton variant="secondary" @click="closePanel">{{ $t('ui.closeForNow') }}</VxButton>
        <VxButton
          variant="danger"
          @click="emit('cancel-task')"
        >
          {{ $t('ui.cancelThisTaskVariant2') }}
        </VxButton>
      </div>
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
:global(.base-dialog-panel.nexus-authorization-task-modal) {
  min-width: 0;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
}

.nexus-authorization-task {
  display: grid;
  min-height: 0;
  gap: var(--space-4);
}

.nexus-authorization-task__notice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.nexus-authorization-task__notice div,
.nexus-authorization-task__item-main {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.nexus-authorization-task__notice strong,
.nexus-authorization-task__item strong {
  color: var(--color-text);
}

.nexus-authorization-task__notice span,
.nexus-authorization-task__item p,
.nexus-authorization-task__message,
.nexus-authorization-task__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.nexus-authorization-task__summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
}

.nexus-authorization-task__summary > div {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.nexus-authorization-task__summary span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.nexus-authorization-task__summary strong {
  color: var(--color-text);
  font-size: var(--font-size-lg);
}

.nexus-authorization-task__items {
  display: grid;
  max-height: min(52vh, 520px);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.nexus-authorization-task__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.nexus-authorization-task__item:last-child {
  border-bottom: 0;
}

.nexus-authorization-task__item.is-selected {
  box-shadow: inset 3px 0 var(--color-accent);
}

.nexus-authorization-task__item header,
.nexus-authorization-task__actions,
.nexus-authorization-task__footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.nexus-authorization-task__item header {
  align-items: flex-start;
  flex-wrap: wrap;
  justify-content: space-between;
}

.nexus-authorization-task__item header strong {
  min-width: 0;
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}

.nexus-authorization-task__item header :deep(.vx-badge) {
  flex: 0 0 auto;
  white-space: nowrap;
}

.nexus-authorization-task__actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.nexus-authorization-task__actions :deep(.vx-button__content),
.nexus-authorization-task__footer :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.nexus-authorization-task__message,
.nexus-authorization-task__item p {
  overflow-wrap: anywhere;
}

.nexus-authorization-task__item code {
  width: fit-content;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.nexus-authorization-task__empty {
  display: grid;
  min-height: 240px;
  place-content: center;
}

.nexus-authorization-task__footer {
  width: 100%;
  justify-content: flex-end;
  flex-wrap: wrap;
}

@media (max-width: 480px) {
  .nexus-authorization-task__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nexus-authorization-task__item {
    grid-template-columns: 1fr;
  }

  .nexus-authorization-task__actions {
    justify-content: flex-start;
  }
}
</style>
