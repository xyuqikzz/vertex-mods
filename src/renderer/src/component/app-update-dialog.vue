<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText, locale } = useI18n()

import { computed } from 'vue'
import { VxButton, VxModal, VxProgress } from '@renderer/component/vertex-ui'
import { releaseNoteLink, renderReleaseNotes } from '@renderer/utils/release-notes.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dialogStage: { type: String, default: 'available' },
  currentVersion: { type: [String, Number], default: '' },
  latestVersion: { type: [String, Number], default: '' },
  publishTime: { type: String, default: '' },
  releaseNotes: { type: [String, Array, Object], default: '' },
  releaseSource: { type: String, default: 'github' },
  message: { type: String, default: '' },
  messageKey: { type: String, default: '' },
  primaryText: { type: String, default: '' },
  secondaryText: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  speedText: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'close', 'primary', 'secondary'])
const checking = computed(() => props.dialogStage === 'checking')
const downloading = computed(() => props.dialogStage === 'downloading')
const title = computed(
  () =>
    ({
      get checking() { return uiText('ui.checkingForUpdatesVariant2') },
      get available() { return uiText('ui.newVersionAvailable') },
      get current() { return uiText('ui.yourVersionIsUpToDate') },
      get unavailable() { return uiText('ui.noUpdateInformationAvailable') },
      get error() { return uiText('ui.couldNotCheckForUpdates') },
      get downloading() { return uiText('ui.downloadingUpdate') },
      get downloaded() { return uiText('ui.updateReady') },
      get installing() { return uiText('updates.installing') }
    })[props.dialogStage] || uiText('settings.update.title')
)
const description = computed(() => {
  if (props.messageKey) return uiText(props.messageKey)
  if (checking.value) return uiText('updates.checking')
  if (downloading.value) return uiText('updates.downloading')
  if (props.dialogStage === 'downloaded') return uiText('updates.ready')
  if (props.dialogStage === 'installing') return uiText('updates.installingDescription')
  return props.message || uiText('updates.description')
})
const publishedAt = computed(() => {
  const date = new Date(props.publishTime)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale.value) : ''
})
const showNotes = computed(() =>
  ['available', 'downloading', 'downloaded', 'installing'].includes(props.dialogStage)
)
const notesHtml = computed(() => renderReleaseNotes(props.releaseNotes))
function openNoteLink(event) {
  const anchor = event.target?.closest?.('a[href]')
  if (!anchor) return
  event.preventDefault()
  const href = releaseNoteLink(anchor.getAttribute('href'))
  if (href) window.open(href, '_blank', 'noopener,noreferrer')
}
const progressText = computed(
  () => `${Math.round(Math.max(0, Math.min(100, Number(props.progress) || 0)))}%`
)

function close() {
  emit('update:modelValue', false)
  emit('close')
}
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="title"
    :description="description"
    :width="620"
    panel-class="app-update-modal"
    close-on-overlay
    close-on-esc
    @update:model-value="close"
  >
    <div class="update-dialog" :data-stage="dialogStage" aria-live="polite">
      <dl class="update-dialog__versions">
        <div>
          <dt>{{ $t('ui.currentVersion') }}</dt>
          <dd>{{ currentVersion || $t('ui.loadingVariant4') }}</dd>
        </div>
        <div v-if="latestVersion">
          <dt>{{ $t('ui.latestStableRelease') }}</dt>
          <dd>{{ latestVersion }}</dd>
        </div>
        <div v-if="publishedAt">
          <dt>{{ $t('ui.releasedOn') }}</dt>
          <dd>{{ publishedAt }}</dd>
        </div>
      </dl>
      <section v-if="showNotes" class="update-dialog__notes">
        <h4>{{ $t('ui.releaseNotes') }}</h4>
        <div class="update-dialog__notes-scroll" tabindex="0" role="region" :aria-label="$t('ui.releaseNotes')">
          <!-- 原始 HTML 已转义，链接协议受限，图片不会触发远程加载。 -->
          <div v-if="notesHtml" class="update-dialog__markdown" @click.capture="openNoteLink" v-html="notesHtml"></div>
          <p v-else>{{ $t('ui.noReleaseNotesWereProvidedForThisVersion') }}</p>
        </div>
      </section>
      <div v-if="downloading || dialogStage === 'downloaded'" class="update-dialog__progress">
        <div>
          <span>{{ $t('ui.downloadProgress') }}</span><strong>{{ progressText }}</strong>
        </div>
        <VxProgress :value="progress" />
        <span v-if="speedText">{{ speedText }}</span>
      </div>
      <p class="update-dialog__source">
        {{
          releaseSource === 'github'
            ? $t('ui.updateSourceGitHubXyuqikzzVertexMods')
            : $t('ui.updateSourceTheServiceConfiguredForThisDistribution')
        }}
      </p>
    </div>
    <template #footer>
      <div class="update-dialog__actions">
        <VxButton v-if="dialogStage !== 'current'" :disabled="dialogStage === 'installing'" variant="secondary" @click="emit('secondary')">
          {{ secondaryText || $t('ui.close') }}
        </VxButton>
        <VxButton :loading="checking || downloading || dialogStage === 'installing'" @click="emit('primary')">
          {{ checking ? $t('ui.checking') : downloading ? $t('tools.downloading') : primaryText || $t('ui.gotItVariant2') }}
        </VxButton>
      </div>
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
:global(.app-update-modal .base-dialog-body) {
  display: flex;
  margin-right: 0;
  padding-right: 0;
  overflow: hidden;
  scrollbar-gutter: auto;
}
.update-dialog {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-5);
  min-width: 0;
  min-height: 0;
}
.update-dialog__versions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: var(--space-5) var(--space-8);
  margin: 0;
  dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  dd {
    margin: var(--space-1) 0 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    overflow-wrap: anywhere;
  }
}
.update-dialog__notes {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  h4 {
    flex-shrink: 0;
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }
}
.update-dialog__notes-scroll {
  min-height: 0;
  max-height: min(280px, 32vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  &:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
  }
  > p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: var(--line-height-relaxed);
    color: var(--color-text-secondary);
  }
  &::-webkit-scrollbar {
    width: 7px;
  }
  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--radius-md);
  }
  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: var(--radius-xs);
    min-height: 40px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}
.update-dialog__markdown {
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
  overflow-wrap: anywhere;
  :deep(> :first-child) { margin-top: 0; }
  :deep(> :last-child) { margin-bottom: 0; }
  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-semibold);
    line-height: 1.4;
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--font-size-md);
  }
  :deep(h1) { font-size: var(--font-size-lg); }
  :deep(p), :deep(ul), :deep(ol), :deep(pre), :deep(blockquote) { margin: var(--space-2) 0; }
  :deep(ul), :deep(ol) { padding-left: var(--space-5); }
  :deep(li + li) { margin-top: var(--space-1); }
  :deep(a) { color: var(--color-primary); text-decoration: underline; }
  :deep(a:focus-visible) { outline: 2px solid var(--color-border-focus); outline-offset: 2px; }
  :deep(code) { background: var(--color-surface-soft); border-radius: var(--radius-xs); padding: 0 var(--space-1); }
  :deep(pre) { padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow-x: auto; }
  :deep(pre code) { padding: 0; white-space: pre; }
  :deep(blockquote) { border-left: 3px solid var(--color-border); padding-left: var(--space-3); }
  :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
  :deep(th), :deep(td) { padding: var(--space-2); border: 1px solid var(--color-border); }
  :deep(hr) { border: 0; border-top: 1px solid var(--color-border); }
}
.update-dialog__progress {
  flex-shrink: 0;
  display: grid;
  gap: var(--space-2);
  div:first-child {
    display: flex;
    justify-content: space-between;
  }
  :deep(.vx-progress) {
    width: 100%;
  }
}
.update-dialog__source {
  flex-shrink: 0;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.update-dialog__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
}
</style>
