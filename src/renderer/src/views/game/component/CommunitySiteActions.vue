<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import { formatInstallSize } from '@views/game/component/install-confirm/install-confirm-format.js'
import { parseCommunityModUrl } from '../../../../../shared/sources/community-source.js'
import { buildGamebananaDownloadTask } from '../../../../../shared/sources/gamebanana-catalog.js'
import { createGamebananaClient } from '@renderer/utils/gamebanana-api.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'

// 站点详情页工具栏里的「下载模组」（GameBanana、Steam 创意工坊）。只下载，不写入游戏。
// GameBanana 用统一的安装确认弹窗选文件；Steam 直接提交。提交失败的原因通过 error 事件交给页面。
const props = defineProps({
  url: String,
  source: String,
  gameId: String,
  gameName: String,
  sourceLabel: String,
  webContentsId: Number,
  active: { type: Boolean, default: true }
})
const emit = defineEmits(['error'])
const { t } = useI18n()
const target = computed(() => {
  const parsed = parseCommunityModUrl(props.url)
  return parsed?.source === props.source ? parsed : null
})
const busy = ref(false)
const dialog = ref({ open: false, loading: false, error: '', retryable: true, submitting: false })
const detail = ref(null)
const selectedId = ref('')
const api = createGamebananaClient()
let generation = 0

watch(
  () => props.url,
  () => {
    generation += 1
    dialog.value = { open: false, loading: false, error: '', retryable: true, submitting: false }
    detail.value = null
    selectedId.value = ''
  }
)

const files = computed(() => (Array.isArray(detail.value?.files) ? detail.value.files : []))
const hasVersion = computed(() => files.value.some((file) => String(file?.version || '').trim()))
const columns = computed(() =>
  [
    hasVersion.value
      ? { key: 'version', label: t('siteDetail.download.columnVersion'), width: '88px' }
      : null,
    { key: 'size', label: t('siteDetail.download.columnSize'), width: '80px', align: 'right' }
  ].filter(Boolean)
)
const items = computed(() =>
  files.value.map((file) => {
    const size = Number(file?.size) || 0
    return {
      key: String(file.id),
      title: String(file?.name || '--'),
      history: !!file?.archived,
      tags: file?.archived ? [{ text: t('siteDetail.download.archived'), tone: 'warning' }] : [],
      disabled: !!file?.blocked,
      disabledReason: file?.blocked ? t('siteDetail.download.blocked') : '',
      sizeBytes: size,
      sizeText: formatInstallSize(size),
      values: {
        version: String(file?.version || '').trim(),
        size: formatInstallSize(size)
      }
    }
  })
)
const selectedFile = computed(
  () => files.value.find((file) => String(file.id) === selectedId.value && !file.blocked) || null
)
const meta = computed(() => [
  props.gameName,
  detail.value?.id
    ? { text: t('siteDetail.download.modId', { id: detail.value.id }), mono: true }
    : ''
])
const planTarget = computed(() => [
  { label: t('siteDetail.download.game'), value: props.gameName || detail.value?.gameName || '--' },
  {
    label: t('siteDetail.download.writeTo'),
    value: t('siteDetail.download.downloadDir'),
    small: true
  }
])
const total = computed(() => {
  if (!selectedFile.value) return { value: '—', note: t('siteDetail.download.noFile') }
  return {
    value: formatInstallSize(selectedFile.value.size) || t('siteDetail.download.sizeUnknown'),
    note: t('siteDetail.download.oneFile')
  }
})
const actions = computed(() => [
  {
    key: 'download',
    label: t('siteDetail.download.submit'),
    variant: 'primary',
    disabled: !selectedFile.value,
    loading: dialog.value.submitting
  }
])
const footerHint = computed(() =>
  files.value.length && !selectedFile.value ? t('siteDetail.download.pick') : ''
)

function preselect() {
  const first =
    files.value.find((file) => !file.blocked && !file.archived) ||
    files.value.find((file) => !file.blocked)
  selectedId.value = first ? String(first.id) : ''
}

async function loadGamebananaFiles() {
  const current = generation
  dialog.value = { ...dialog.value, open: true, loading: true, error: '', retryable: true }
  try {
    const data = await api.detail(target.value.modId)
    if (current !== generation) return
    if (data.gameId !== props.gameId) {
      // 换个游戏重开才能解决，重试没有意义。
      dialog.value.retryable = false
      throw new Error(t('siteDetail.download.otherGameId', { id: data.gameId || '--' }))
    }
    detail.value = data
    preselect()
  } catch (failure) {
    if (current === generation)
      dialog.value.error = failure?.message || t('siteDetail.download.submitFailed')
  } finally {
    if (current === generation) dialog.value.loading = false
  }
}

async function download() {
  if (!target.value || busy.value) return
  emit('error', '')
  if (target.value.source === 'gamebanana') {
    await loadGamebananaFiles()
    return
  }
  const current = generation
  busy.value = true
  try {
    const response = await ipcRenderer.invoke(
      'workshop:download',
      JSON.parse(
        JSON.stringify({
          webContentsId: props.webContentsId,
          steamAppId: props.gameId,
          gameName: props.gameName
        })
      )
    )
    if (!response?.success)
      throw new Error(response?.message || t('siteDetail.download.submitFailed'))
    $message.success(t('siteDetail.download.queued'))
  } catch (failure) {
    if (current === generation)
      emit('error', failure?.message || t('siteDetail.download.submitFailed'))
  } finally {
    busy.value = false
  }
}

function selectFile(keys = []) {
  const id = String(keys[0] || '')
  if (files.value.some((file) => String(file.id) === id && !file.blocked)) selectedId.value = id
}

async function submitFile() {
  const file = selectedFile.value
  if (!file || dialog.value.submitting) return
  dialog.value.submitting = true
  try {
    const payload = buildGamebananaDownloadTask(detail.value, file.id)
    const result = await ipcRenderer.invoke(
      'source-install-task:create',
      JSON.parse(JSON.stringify(payload))
    )
    if (!result?.success) throw new Error(result?.message || t('siteDetail.download.submitFailed'))
    dialog.value = { ...dialog.value, open: false }
    $message.success(t('siteDetail.download.queued'))
  } catch (failure) {
    $message.error(failure?.message || t('siteDetail.download.submitFailed'))
  } finally {
    dialog.value.submitting = false
  }
}

function closeDialog() {
  if (dialog.value.submitting) return
  generation += 1
  dialog.value = { open: false, loading: false, error: '', retryable: true, submitting: false }
}
</script>

<template>
  <VxButton
    v-if="target"
    variant="primary"
    size="sm"
    class="site-download-button"
    :loading="busy"
    :disabled="!webContentsId"
    :aria-label="t('siteDetail.download.label')"
    :title="webContentsId ? t('siteDetail.download.label') : t('siteDetail.download.waitHint')"
    @click="download()"
  >
    <ToolIcon name="download" :size="14" />
    <span class="site-button__text">{{ t('siteDetail.download.label') }}</span>
  </VxButton>
  <InstallConfirmDialog
    :open="dialog.open && active"
    mode="download"
    :title="detail?.name || t('siteDetail.download.dialogTitle')"
    :icon-url="detail?.image || ''"
    :fallback-initial="detail?.name || sourceLabel"
    :source-label="sourceLabel"
    :meta="meta"
    :loading="dialog.loading"
    :loading-text="t('siteDetail.download.loadingFiles')"
    :error-text="dialog.error"
    :error-title="
      dialog.retryable
        ? t('siteDetail.download.filesFailed')
        : t('siteDetail.download.otherGameTitle')
    "
    :error-description="
      dialog.retryable
        ? t('siteDetail.download.filesFailedHint')
        : t('siteDetail.download.otherGame')
    "
    :retryable="dialog.retryable"
    :plan-title="t('siteDetail.download.planTitle')"
    :busy="dialog.submitting"
    :empty-text="t('siteDetail.download.empty')"
    selection-type="single"
    :selection-title="t('siteDetail.download.selectionTitle')"
    :history-label="t('siteDetail.download.history')"
    :columns="columns"
    :items="items"
    :selected-keys="selectedId ? [selectedId] : []"
    :target="planTarget"
    :show-selected="false"
    :dependencies="{
      state: 'ready',
      items: [],
      emptyText: t('siteDetail.download.noDependencies')
    }"
    :total="total"
    :footer-hint="footerHint"
    :actions="actions"
    :cancel-label="t('siteDetail.download.cancel')"
    @update:selected-keys="selectFile"
    @action="submitFile"
    @retry="loadGamebananaFiles"
    @close="closeDialog"
  />
</template>

<style scoped>
.site-download-button :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@container site-toolbar (max-width: 760px) {
  .site-button__text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .site-download-button {
    padding: 0 var(--space-2);
  }
}
</style>
