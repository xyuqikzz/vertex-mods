<script setup>
import { uiMessage } from './i18n/message.js'

import { computed, onMounted, onUnmounted, ref } from 'vue'
import I18nProvider from './i18n/I18nProvider.vue'
import router from './router'
import storage from '@renderer/common/storage.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'
import AiAgentMascot from '@renderer/component/ai-agent-mascot.vue'
import GlobalConfirmDialogHost from '@renderer/component/global-confirm-dialog-host.vue'
import GlobalMessageTipHost from '@renderer/component/global-message-tip-host.vue'
import LifecycleAuthorizationDialogHost from '@renderer/component/lifecycle-authorization-dialog-host.vue'
import NexusManualDownloadDialog from '@renderer/views/game/sourceModpack/component/NexusManualDownloadDialog.vue'
import { VxConfirmModal } from '@renderer/component/vertex-ui'
import VxpackExportDialog from '@renderer/views/game/vxpack/VxpackExportDialog.vue'
import OfflinePackImportDialog from '@renderer/views/game/vxpack/OfflinePackImportDialog.vue'
import {
  OFFLINE_PACK_EXPORT_EVENT,
  OFFLINE_PACK_IMPORT_EVENT
} from '@renderer/views/game/vxpack/vxpack-service.js'
import { useAiAssistantStore } from '@renderer/store/aiAssistantStore.js'
import {
  closeNexusAuthorizationPanel,
  openNexusAuthorizationPanel,
  useNexusAuthorizationPanel
} from '@renderer/store/nexusAuthorizationPanel.js'
import { useAiPageContext } from '@renderer/composables/useAiPageContext.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

const { VITE_APP_NAME } = import.meta.env
const aiAssistantStore = useAiAssistantStore()
const nexusAuthorizationPanel = useNexusAuthorizationPanel()
const nexusAuthorizationCancelConfirmOpen = ref(false)
const { getSnapshot } = useAiPageContext()
const windowMode = new URLSearchParams(window.location.search).get('window')
const isAssistantSidecarWindow = windowMode === 'ai-assistant-sidecar'
const shouldShowAiAgentMascot = computed(() => !isAssistantSidecarWindow)
const offlinePackImportOpen = ref(false)
const offlinePackPackagePath = ref('')
const offlinePackExportOpen = ref(false)
const offlinePackExportPayload = ref({})
const offlinePackDragActive = ref(false)
const offlinePackDragInvalid = ref(false)
let offlinePackDragDepth = 0
let internalFileDrag = false

onMounted(async () => {
  if (isAssistantSidecarWindow) {
    router.replace('/app/ai-assistant-sidecar')
    return
  }
  ipcRenderer
    .invoke('ai-assistant-window:state')
    .then((state) => aiAssistantStore.applyAssistantWindowState(state))
    .catch(() => {})
  await router.isReady()
  const currentPath = router.currentRoute.value?.path || window.location.pathname || ''
  if (!currentPath || currentPath === '/' || currentPath === '/app') {
    router.replace('/app/home')
  }
})

onMounted(() => {
  if (isAssistantSidecarWindow) return
  window.addEventListener('dragstart', handleInternalDragStart, true)
  window.addEventListener('dragend', handleInternalDragEnd, true)
  window.addEventListener('dragenter', handleOfflinePackDragEnter)
  window.addEventListener('dragover', handleOfflinePackDragOver)
  window.addEventListener('dragleave', handleOfflinePackDragLeave)
  window.addEventListener('drop', handleOfflinePackDrop)
  window.addEventListener(OFFLINE_PACK_IMPORT_EVENT, handleOfflinePackOpenEvent)
  window.addEventListener(OFFLINE_PACK_EXPORT_EVENT, handleOfflinePackExportEvent)
})

onUnmounted(() => {
  window.removeEventListener('dragstart', handleInternalDragStart, true)
  window.removeEventListener('dragend', handleInternalDragEnd, true)
  window.removeEventListener('dragenter', handleOfflinePackDragEnter)
  window.removeEventListener('dragover', handleOfflinePackDragOver)
  window.removeEventListener('dragleave', handleOfflinePackDragLeave)
  window.removeEventListener('drop', handleOfflinePackDrop)
  window.removeEventListener(OFFLINE_PACK_IMPORT_EVENT, handleOfflinePackOpenEvent)
  window.removeEventListener(OFFLINE_PACK_EXPORT_EVENT, handleOfflinePackExportEvent)
})

window.onload = function () {
  changeTitle()
}

function changeTitle() {
  document.title = VITE_APP_NAME
}

function isVxpackPath(value = '') {
  return String(value || '').trim().toLowerCase().endsWith('.vxpack')
}

function getPathForDroppedFile(file) {
  return String(window.api?.getPathForFile?.(file) || file?.path || '').trim()
}

function getNameForDroppedFile(file) {
  return String(file?.name ?? '').trim()
}

function resolveTransferFilePaths(event) {
  return Array.from(event?.dataTransfer?.files || [])
    .map((file) => getPathForDroppedFile(file))
    .filter(Boolean)
}

function resolveTransferFileNames(event) {
  return Array.from(event?.dataTransfer?.files || [])
    .map((file) => getNameForDroppedFile(file))
    .filter(Boolean)
}

function hasFileTransfer(event) {
  return Array.from(event?.dataTransfer?.types || []).includes('Files')
}

function resetOfflinePackDragState() {
  offlinePackDragDepth = 0
  offlinePackDragActive.value = false
  offlinePackDragInvalid.value = false
}

function handleInternalDragStart(event) {
  // Chromium 拖动页面内的 Blob 图片时也可能带 Files，不能据此当作外部安装包。
  internalFileDrag = true
  resetOfflinePackDragState()
  queueMicrotask(() => {
    // 被组件取消的 dragstart 不保证随后有 dragend，避免阻挡下一次外部文件拖入。
    if (event.defaultPrevented) internalFileDrag = false
  })
}

function handleInternalDragEnd() {
  internalFileDrag = false
  resetOfflinePackDragState()
}

function updateOfflinePackDragState(event) {
  // Feature drop zones own their visible surface, rather than being covered by
  // the app-wide offline-package drop overlay.
  if (document.querySelector('[data-file-drop-active="true"]')) {
    offlinePackDragActive.value = false
    offlinePackDragInvalid.value = false
    return false
  }
  const paths = resolveTransferFilePaths(event)
  const names = resolveTransferFileNames(event)
  const hasFiles = paths.length > 0 || names.length > 0 || hasFileTransfer(event)
  if (!hasFiles) {
    offlinePackDragActive.value = false
    offlinePackDragInvalid.value = false
    return false
  }
  offlinePackDragActive.value = true
  offlinePackDragInvalid.value = paths.length > 0
    ? !paths.some((item) => isVxpackPath(item))
    : names.length > 0 && !names.some((item) => isVxpackPath(item))
  return true
}

function handleOfflinePackDragEnter(event) {
  if (internalFileDrag || !hasFileTransfer(event)) return
  offlinePackDragDepth += 1
  event.preventDefault()
  updateOfflinePackDragState(event)
}

function handleOfflinePackDragOver(event) {
  if (!hasFileTransfer(event)) return
  event.preventDefault()
  if (internalFileDrag) return
  updateOfflinePackDragState(event)
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = offlinePackDragInvalid.value ? 'none' : 'copy'
  }
}

function handleOfflinePackDragLeave(event) {
  if (internalFileDrag || !hasFileTransfer(event)) return
  offlinePackDragDepth = Math.max(offlinePackDragDepth - 1, 0)
  if (offlinePackDragDepth === 0) {
    offlinePackDragActive.value = false
    offlinePackDragInvalid.value = false
  }
}

function openOfflinePackImport(packagePath = '') {
  const safePath = String(packagePath || '').trim()
  if (!safePath || !isVxpackPath(safePath)) {
    $message.warning(uiMessage('ui.thisFileIsNotAVertexOfflinePackage'))
    return
  }
  offlinePackPackagePath.value = safePath
  offlinePackImportOpen.value = true
}

function handleOfflinePackOpenEvent(event) {
  const detail = sanitizeIpcPayload(event?.detail || {}, {})
  openOfflinePackImport(detail.packagePath || detail.filePath || '')
}

function handleOfflinePackExportEvent(event) {
  const detail = sanitizeIpcPayload(event?.detail || {}, {})
  const items = Array.isArray(detail.exportItems || detail.items) ? (detail.exportItems || detail.items) : []
  if (!items.length) {
    $message.warning(uiMessage('ui.noOfflinePackageEntriesAreAvailableToExport'))
    return
  }
  offlinePackExportPayload.value = detail
  offlinePackExportOpen.value = true
}

function handleOfflinePackDrop(event) {
  const internal = internalFileDrag
  handleInternalDragEnd()
  if (!hasFileTransfer(event)) return
  event.preventDefault()
  if (internal) return
  if (document.querySelector('[data-file-drop-active="true"]')) return

  const packagePath = resolveTransferFilePaths(event).find((item) => isVxpackPath(item))
  if (!packagePath) {
    const hasVxpackName = resolveTransferFileNames(event).some((item) => isVxpackPath(item))
    if (hasVxpackName) {
      $message.warning(uiMessage('ui.couldNotReadTheDroppedFilePathUseTheFile'))
      return
    }
    $message.warning(uiMessage('ui.thisFileIsNotAVertexOfflinePackage'))
    return
  }
  openOfflinePackImport(packagePath)
}

useIpc('app-out-clear-data', () => {
  storage.local.remove('pageScrollTop')
})

useIpc('ai-assistant-window:request-context', (payload = {}) => {
  if (isAssistantSidecarWindow) return
  const safePayload = sanitizeIpcPayload(payload, {})
  ipcRenderer.invoke(
    'ai-assistant-window:sync-context',
    sanitizeIpcPayload(
      {
        requestId: safePayload.requestId || '',
        context: getSnapshot(),
        source: 'main-window'
      },
      {}
    )
  )
})

function applyAssistantStoreSnapshotPayload(payload = {}) {
  const safePayload = sanitizeIpcPayload(payload, {})
  const snapshot = safePayload?.storeSnapshot || safePayload?.snapshot || null
  if (snapshot) {
    aiAssistantStore.applyAssistantStoreSnapshot(snapshot, { persist: false })
  }
}

useIpc('ai-assistant-window:open-nexus-manual-download', (payload = {}) => {
  if (isAssistantSidecarWindow) return
  const safePayload = sanitizeIpcPayload(payload, {})
  applyAssistantStoreSnapshotPayload(safePayload)
  const targetPlan =
    safePayload.plan ||
    safePayload.installPlan ||
    safePayload.storeSnapshot?.installPlan ||
    aiAssistantStore.installPlan
  const jobId = String(
    safePayload.jobId ||
      targetPlan?.linkedJobId ||
      targetPlan?.sourceInstallJob?.jobId ||
      targetPlan?.installTaskResult?.jobId ||
      ''
  ).trim()
  if (jobId) {
    openNexusAuthorizationPanel(jobId, safePayload.itemId || '')
    return
  }
  $message.info(uiMessage('ui.submitTheInstallationPlanAgainNexusFilesThatNeedAuthorization'))
})

async function confirmCancelNexusAuthorizationTask() {
  const jobId = String(nexusAuthorizationPanel.state.jobId || '').trim()
  nexusAuthorizationCancelConfirmOpen.value = false
  if (!jobId) return
  const result = await ipcRenderer.invoke(
    'source-install-task:cancel',
    sanitizeIpcPayload({ jobId }, {})
  )
  if (result?.success === false) {
    $message.error(result?.message || '取消任务失败')
    return
  }
  closeNexusAuthorizationPanel()
  $message.success(uiMessage('ui.taskCancelled'))
}

useIpc('offline-pack:open', (payload = {}) => {
  if (isAssistantSidecarWindow) return
  const safePayload = sanitizeIpcPayload(payload, {})
  openOfflinePackImport(safePayload.packagePath || safePayload.filePath || '')
})

</script>

<template>
  <I18nProvider>
    <div class="app-view">
      <router-view></router-view>
      <AiAgentMascot v-if="shouldShowAiAgentMascot" />
      <GlobalConfirmDialogHost />
      <GlobalMessageTipHost />
      <LifecycleAuthorizationDialogHost
        v-if="!isAssistantSidecarWindow"
      />
      <OfflinePackImportDialog
        v-if="!isAssistantSidecarWindow"
        v-model="offlinePackImportOpen"
        :package-path="offlinePackPackagePath"
      />
      <VxpackExportDialog
        v-if="!isAssistantSidecarWindow"
        v-model="offlinePackExportOpen"
        :payload="offlinePackExportPayload"
        :items="offlinePackExportPayload.exportItems || offlinePackExportPayload.items || []"
        :context="offlinePackExportPayload"
      />
      <NexusManualDownloadDialog
        v-if="!isAssistantSidecarWindow"
        :open="nexusAuthorizationPanel.state.open"
        :job-id="nexusAuthorizationPanel.state.jobId"
        :item-id="nexusAuthorizationPanel.state.itemId"
        @update:open="nexusAuthorizationPanel.setOpen"
        @cancel-task="nexusAuthorizationCancelConfirmOpen = true"
      />
      <VxConfirmModal
        v-model="nexusAuthorizationCancelConfirmOpen"
        :title="$t('ui.cancelThisTask')"
        :description="$t('ui.thisWillEndActiveAuthorizationSessionsAndCancelUnfinishedDownloads')"
        :confirm-text="$t('taskCenter.confirm.confirmCancel')"
        :cancel-text="$t('ui.continueProcessing')"
        danger
        @confirm="confirmCancelNexusAuthorizationTask"
      />
      <div
        v-if="offlinePackDragActive && !isAssistantSidecarWindow"
        class="offline-pack-drop-mask"
        :class="{ 'is-invalid': offlinePackDragInvalid }"
      >
        <div class="offline-pack-drop-mask__panel">
          {{ offlinePackDragInvalid ? $t('ui.thisFileIsNotAVertexOfflinePackage') : $t('ui.dropToImportTheOfflinePackage') }}
        </div>
      </div>
    </div>
  </I18nProvider>
</template>

<style scoped lang="scss">
@font-face {
  font-family: 'FangYuan';
  src: url('./assets/font/AlimamaFangYuanTiVF-Thin.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}

.app-view {
  width: 100vw;
  height: 100vh;
  color: var(--default-text-color);
  font-family: 'FangYuan', sans-serif;
  font-weight: 500;
  font-size: var(--default-font-size);
  position: relative;
  overflow: hidden;
  border-radius: 6px;
}

.offline-pack-drop-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(3px);
  pointer-events: none;
}

.offline-pack-drop-mask__panel {
  min-width: min(420px, calc(100vw - 48px));
  padding: 22px 28px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  color: #152033;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
}

.offline-pack-drop-mask.is-invalid .offline-pack-drop-mask__panel {
  color: #b42318;
}

body,
p,
h1,
h2,
h3,
h4,
h5,
h6 {
  margin: 0;
  line-height: 1;
}

img {
  object-fit: contain;
  object-position: center;
}
</style>
