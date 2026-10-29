<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { VxButton, VxInput, VxModal, VxSegmented, VxTag } from '@renderer/component/vertex-ui'
import {
  getSourceModpackDetailPack,
  getSourceModpackPlatformLabel
} from '@renderer/utils/source-modpack-share.js'
import SourceModpackItemRow from './SourceModpackItemRow.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  installing: { type: Boolean, default: false },
  detail: { type: Object, default: () => ({}) },
  items: { type: Array, default: () => [] },
  selectedKeys: { type: Object, default: () => ({}) },
  inspection: { type: Object, default: null },
  intent: { type: String, default: 'auto' },
  pendingManualCount: { type: Number, default: 0 },
  failedItemCount: { type: Number, default: 0 },
  canSubmit: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'toggle-interaction',
  'manual-download',
  'install-new-copy',
  'confirm'
])

const keyword = ref('')
const activeFilter = ref('all')
const coverFailed = ref(false)

const pack = computed(() => getSourceModpackDetailPack(props.detail))
const sourceType = computed(() => pack.value.sourceType || pack.value.source_type || '')
const sourceLabel = computed(() => getSourceModpackPlatformLabel(sourceType.value))
const gameName = computed(
  () =>
    pack.value.sourceGameName ||
    pack.value.source_game_name ||
    pack.value.sourceGameSlug ||
    pack.value.source_game_slug ||
    '未标记游戏'
)
const shareCode = computed(() => pack.value.shareCode || pack.value.share_code || '--')
const packName = computed(() => pack.value.name || '未命名整合包')
const packDescription = computed(() => pack.value.description || '暂无整合包简介')
const packCover = computed(() => pack.value.cover || '')
const isPublicVisible = computed(() => {
  const isPublic = pack.value.isPublic ?? pack.value.is_public
  const isPublished = pack.value.isPublished ?? pack.value.is_published
  return [true, 1, '1'].includes(isPublic) && [true, 1, '1'].includes(isPublished)
})

const modeText = computed(() => {
  const labels = {
    get install() { return uiText('ui.firstInstallation') },
    get update() { return uiText('ui.updateInstance') },
    get repair() { return uiText('ui.repairInstance') },
    get latest() { return uiText('ui.noChangesNeeded') },
    get conflict() { return uiText('ui.conflictsNeedAttention') }
  }
  return labels[String(props.inspection?.mode || '')] || uiText('ui.installationPreflight')
})
const submitText = computed(() => {
  if (props.inspection?.mode === 'update') return uiText('ui.startUpdate')
  if (props.inspection?.mode === 'repair') return uiText('ui.startRepair')
  return uiText('ui.startInstallation')
})
const canInstallNewCopy = computed(() => {
  const state = String(props.inspection?.local?.state || '')
  return (
    props.intent !== 'install_new_copy' && state && state !== 'uninstalled' && !props.installing
  )
})

const summaryItems = computed(() => {
  const summary = props.inspection?.summary || {}
  const definitions = [
    ['added', '新增', 'success'],
    ['changed', '更新', 'info'],
    ['removed', '移除', 'danger'],
    ['repairMissing', '修复', 'warning'],
    ['metadataOnly', '信息更新', 'default'],
    ['retained', '保留', 'warning']
  ]
  return definitions
    .map(([key, label, tone]) => ({
      key,
      label,
      tone,
      count: Array.isArray(summary[key]) ? summary[key].length : 0
    }))
    .filter((item) => item.count > 0)
})

const actionMeta = Object.freeze({
  install: { get label() { return uiText('ui.willInstall') }, tone: 'success', changed: true },
  replace: { get label() { return uiText('ui.willUpdate') }, tone: 'info', changed: true },
  uninstall: { get label() { return uiText('ui.willRemove') }, tone: 'danger', changed: true },
  refresh_metadata: { get label() { return uiText('ui.metadataUpdate') }, tone: 'default', changed: true },
  retain: { get label() { return uiText('ui.keepLocal') }, tone: 'warning', changed: true },
  conflict: { get label() { return uiText('taskCenter.views.needs_action') }, tone: 'danger', changed: true, issue: true },
  unchanged: { get label() { return uiText('ui.alreadyIncluded') }, tone: 'default', changed: false }
})

const displayItems = computed(() => {
  const operations = Array.isArray(props.inspection?.operations) ? props.inspection.operations : []
  const operationMap = new Map(
    operations.map((operation) => [String(operation.itemKey || ''), operation])
  )
  const rows = props.items.map((item, index) => {
    const itemKey = String(item.itemKey || '')
    const operation = operationMap.get(itemKey) || null
    const action = operation?.action || 'unchanged'
    const meta = actionMeta[action] || actionMeta.unchanged
    const manualIssue = item.canImport === false
    return {
      key: item.previewKey || `${itemKey}:${index}`,
      item,
      operation,
      action,
      ...meta,
      issue: meta.issue === true || manualIssue,
      statusText:
        item.reason && item.reason !== '已生成规范化安装计划'
          ? item.reason
          : operation?.requiresDisable
            ? uiText('ui.currentlyEnabledItWillBeDisabledBeforeRemovalDuringThe')
            : ''
    }
  })

  const existingKeys = new Set(
    rows.map((row) => String(row.operation?.itemKey || row.item.itemKey || ''))
  )
  for (const operation of operations) {
    const itemKey = String(operation.itemKey || '')
    if (!itemKey || existingKeys.has(itemKey)) continue
    const action = operation.action || 'unchanged'
    const meta = actionMeta[action] || actionMeta.unchanged
    rows.push({
      key: `operation:${itemKey}`,
      item: operation.entry || operation.previous || { itemKey },
      operation,
      action,
      ...meta,
      issue: meta.issue === true,
      statusText: operation.requiresDisable
        ? uiText('ui.currentlyEnabledItWillBeDisabledBeforeRemovalDuringThe')
        : operation.reason === 'shared_mod_retained'
          ? uiText('ui.stillReferencedByOtherInstancesWillBeKept')
          : ''
    })
  }
  return rows
})

const filteredItems = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  return displayItems.value.filter((row) => {
    if (activeFilter.value === 'changes' && !row.changed) return false
    if (activeFilter.value === 'issues' && !row.issue) return false
    if (!normalizedKeyword) return true
    const item = row.item || {}
    return [item.name, item.description, item.summary, item.sourceModId, item.sourceModKey]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedKeyword))
  })
})

const filterOptions = computed(() => [
  { value: 'all', label: uiText('ui.allValue', { value1: (displayItems.value.length) }) },
  {
    value: 'changes',
    label: uiText('ui.changesValue', { value1: (displayItems.value.filter((item) => item.changed).length) })
  },
  { value: 'issues', label: uiText('ui.needsAttentionValue', { value1: (displayItems.value.filter((item) => item.issue).length) }) }
])
const autoDisableCount = computed(
  () =>
    (props.inspection?.operations || []).filter((operation) => operation.requiresDisable === true)
      .length
)
const previousError = computed(() => props.inspection?.local?.lastErrorMessage || '')
const importableCount = computed(
  () => props.items.filter((item) => item.canImport && props.selectedKeys[item.previewKey]).length
)

function interactionCount(key) {
  const value =
    pack.value[key] ?? pack.value[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '0'
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    keyword.value = ''
    activeFilter.value = 'all'
    coverFailed.value = false
  }
)
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="$t('ui.previewImport')"
    :description="$t('ui.reviewTheModpackAndChangesBeforeCreatingInstallationTasks')"
    :width="980"
    panel-class="source-modpack-preview-panel"
    :close-on-overlay="!installing"
    :close-on-esc="!installing"
    @update:model-value="emit('close')"
    @close="emit('close')"
  >
    <div v-if="loading" class="source-modpack-preview__loading" aria-live="polite">
      <span class="source-modpack-preview__spinner" aria-hidden="true"></span>
      <strong>{{ $t('ui.readingSharedContent') }}</strong>
      <p>{{ $t('ui.fetchingRemoteConfigurationModMetadataAndLocalChanges') }}</p>
    </div>

    <div v-else class="source-modpack-preview">
      <section class="source-modpack-preview__hero">
        <div class="source-modpack-preview__cover" aria-hidden="true">
          <img
            v-if="packCover && !coverFailed"
            :src="packCover"
            alt=""
            @error="coverFailed = true"
          />
          <span v-else>{{ sourceLabel.slice(0, 1) }}</span>
        </div>
        <div class="source-modpack-preview__heading">
          <div class="source-modpack-preview__title-line">
            <h4>{{ packName }}</h4>
            <VxTag tone="info" size="sm">{{ sourceLabel }}</VxTag>
            <VxTag size="sm">{{ pack.version || '1.0.0' }}</VxTag>
          </div>
          <p>{{ packDescription }}</p>
          <div class="source-modpack-preview__pack-meta">
            <span>{{ gameName }}</span>
            <span>{{ $t('ui.shareCode') }} {{ shareCode }}</span>
            <span>{{ $t('ui.total') }} {{ items.length }} {{ $t('ui.remoteEntries') }}</span>
          </div>
        </div>
      </section>

      <section class="source-modpack-preview__summary" :aria-label="$t('ui.changeSummary')">
        <div>
          <span>{{ $t('ui.actions') }}</span>
          <strong>{{ modeText }}</strong>
        </div>
        <div>
          <span>{{ $t('ui.revision') }}</span>
          <strong>{{ inspection?.fromRevision || 0 }} → {{ inspection?.toRevision || 0 }}</strong>
        </div>
        <div>
          <span>{{ $t('ui.actionableEntries') }}</span>
          <strong>{{ importableCount }}</strong>
        </div>
        <div class="source-modpack-preview__summary-tags">
          <VxTag v-for="item in summaryItems" :key="item.key" :tone="item.tone" size="sm">
            {{ item.label }} {{ item.count }}
          </VxTag>
          <span v-if="!summaryItems.length">{{ $t('ui.noContentChangesDetected') }}</span>
        </div>
      </section>

      <div v-if="previousError" class="source-modpack-preview__notice is-danger" role="alert">
        <div>
          <strong>{{ $t('ui.thePreviousUpdateDidNotComplete') }}</strong>
          <span>{{ previousError }}</span>
        </div>
      </div>
      <div v-if="autoDisableCount" class="source-modpack-preview__notice is-warning">
        <div>
          <strong>{{ $t('ui.enabledStatesWillBeHandledAutomaticallyBeforeUpdating') }}</strong>
          <span>{{ autoDisableCount }} {{ $t('ui.modsExclusiveToThisInstanceWillBeSafelyDisabledBefore') }}</span>
        </div>
      </div>
      <div v-if="pendingManualCount" class="source-modpack-preview__notice is-info">
        <div>
          <strong>{{ $t('ui.manualDownloadAuthorizationRequired') }}</strong>
          <span>{{ pendingManualCount }} {{ $t('ui.nexusFilesNeedBrowserAuthorizationFirst') }}</span>
        </div>
        <VxButton variant="secondary" size="sm" @click="emit('manual-download')"
          >{{ $t('ui.handleManualDownloads') }}</VxButton
        >
      </div>
      <div v-if="failedItemCount" class="source-modpack-preview__notice is-warning" role="alert">
        <div>
          <strong>{{ $t('ui.someEntriesCouldNotBeIdentified') }}</strong>
          <span>{{ failedItemCount }} {{ $t('ui.entriesCannotBeIncludedInTheInstallationPlanCheckTheir') }}</span>
        </div>
      </div>

      <div
        v-if="isPublicVisible"
        class="source-modpack-preview__interactions"
        :aria-label="$t('ui.publicModpackEngagement')"
      >
        <VxButton variant="ghost" size="sm" @click="emit('toggle-interaction', 'like')">
          {{ detail?.liked ? $t('ui.liked') : $t('ui.like') }} {{ interactionCount('likeCount') }}
        </VxButton>
        <VxButton variant="ghost" size="sm" @click="emit('toggle-interaction', 'favorite')">
          {{ detail?.favorited ? $t('ui.favorited') : $t('ui.favorite') }} {{ interactionCount('favoriteCount') }}
        </VxButton>
        <VxButton variant="ghost" size="sm" @click="emit('toggle-interaction', 'subscribe')">
          {{ detail?.subscribed ? $t('ui.subscribed') : $t('ui.subscribe') }} {{ interactionCount('subscribeCount') }}
        </VxButton>
      </div>

      <div class="source-modpack-preview__toolbar">
        <VxInput
          v-model="keyword"
          :label="$t('ui.filterMods')"
          :placeholder="$t('ui.searchNamesDescriptionsOrSourceIDs')"
          clearable
        />
        <div class="source-modpack-preview__filter-field">
          <span>{{ $t('ui.displayScope') }}</span>
          <VxSegmented v-model="activeFilter" :options="filterOptions" />
        </div>
      </div>

      <section class="source-modpack-preview__list" :aria-label="$t('ui.modEntries')">
        <SourceModpackItemRow
          v-for="row in filteredItems"
          :key="row.key"
          :item="row.item"
          :action-label="row.label"
          :action-tone="row.tone"
          :status-text="row.statusText"
          :disabled="row.issue"
        />
        <div v-if="!filteredItems.length" class="source-modpack-preview__empty">
          {{ $t('ui.noModEntriesMatchTheCurrentFilters') }}
        </div>
      </section>
    </div>

    <template #footer>
      <div class="source-modpack-preview__footer">
        <VxButton
          v-if="canInstallNewCopy"
          variant="ghost"
          :disabled="installing"
          @click="emit('install-new-copy')"
        >
          {{ $t('ui.installAsANewCopy') }}
        </VxButton>
        <span class="source-modpack-preview__footer-spacer"></span>
        <VxButton variant="secondary" :disabled="installing" @click="emit('close')">{{ $t('ui.cancel') }}</VxButton>
        <VxButton
          variant="primary"
          :disabled="!canSubmit"
          :loading="installing"
          @click="emit('confirm')"
        >
          {{ installing ? $t('ui.creatingTasks') : submitText }}
        </VxButton>
      </div>
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
:global(.source-modpack-preview-panel) {
  width: min(980px, calc(100vw - 48px)) !important;
  max-width: min(980px, calc(100vw - 48px)) !important;
  max-height: min(86vh, 820px) !important;
}

.source-modpack-preview {
  display: grid;
  gap: var(--space-4);
}

.source-modpack-preview__hero {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.source-modpack-preview__cover {
  display: grid;
  place-items: center;
  flex: 0 0 76px;
  width: 76px;
  height: 76px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-preview__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-modpack-preview__heading {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.source-modpack-preview__title-line,
.source-modpack-preview__pack-meta,
.source-modpack-preview__interactions,
.source-modpack-preview__footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.source-modpack-preview__title-line h4 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  text-wrap: balance;
}

.source-modpack-preview__heading > p {
  display: -webkit-box;
  max-width: 72ch;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.source-modpack-preview__pack-meta {
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
}

.source-modpack-preview__pack-meta span + span::before {
  margin-right: var(--space-2);
  color: var(--color-border-strong);
  content: '·';
}

.source-modpack-preview__summary {
  display: grid;
  grid-template-columns: 140px 140px 120px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.source-modpack-preview__summary > div:not(.source-modpack-preview__summary-tags) {
  display: grid;
  gap: var(--space-1);
}

.source-modpack-preview__summary span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-preview__summary strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.source-modpack-preview__summary-tags {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.source-modpack-preview__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.source-modpack-preview__notice > div {
  display: grid;
  gap: var(--space-1);
}

.source-modpack-preview__notice strong,
.source-modpack-preview__notice span {
  font-size: var(--font-size-sm);
}

.source-modpack-preview__notice.is-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: color-mix(in srgb, var(--color-danger) 24%, var(--color-border) 76%);
}

.source-modpack-preview__notice.is-warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-color: color-mix(in srgb, var(--color-warning) 24%, var(--color-border) 76%);
}

.source-modpack-preview__notice.is-info {
  color: var(--color-info);
  background: var(--color-info-soft);
  border-color: color-mix(in srgb, var(--color-info) 22%, var(--color-border) 78%);
}

.source-modpack-preview__interactions {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.source-modpack-preview__toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(360px, 0.8fr);
  align-items: end;
  gap: var(--space-3);
}

.source-modpack-preview__filter-field {
  display: grid;
  gap: var(--space-2);
}

.source-modpack-preview__filter-field > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-preview__list {
  min-height: 120px;
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  scrollbar-gutter: stable;
}

.source-modpack-preview__list::-webkit-scrollbar {
  width: 7px;
}

.source-modpack-preview__list::-webkit-scrollbar-track {
  background: var(--scrollbar-track-color);
  border-radius: var(--default-border-radius);
}

.source-modpack-preview__list::-webkit-scrollbar-thumb {
  min-height: 40px;
  border-radius: 4px;
  background: var(--scrollbar-thumb-color);
}

.source-modpack-preview__list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.source-modpack-preview__empty {
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-muted);
  text-align: center;
  font-size: var(--font-size-sm);
}

.source-modpack-preview__footer {
  width: 100%;
}

.source-modpack-preview__footer-spacer {
  flex: 1 1 auto;
}

.source-modpack-preview__loading {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  color: var(--color-text);
  text-align: center;
}

.source-modpack-preview__loading p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.source-modpack-preview__spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--color-border);
  border-right-color: var(--color-accent);
  border-radius: 50%;
  animation: source-modpack-preview-spin 700ms linear infinite;
}

@keyframes source-modpack-preview-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
  .source-modpack-preview__summary,
  .source-modpack-preview__toolbar {
    grid-template-columns: 1fr;
  }

  .source-modpack-preview__summary-tags {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .source-modpack-preview__spinner {
    animation-duration: 1.4s;
  }
}
</style>
