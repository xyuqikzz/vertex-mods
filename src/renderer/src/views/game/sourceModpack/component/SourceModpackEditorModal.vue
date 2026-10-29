<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import {
  VxButton,
  VxDialogActions,
  VxInput,
  VxModal,
  VxSwitch,
  VxTag,
  VxTextarea
} from '@renderer/component/vertex-ui'
import {
  buildSourceModpackUpdatePayload,
  getSourceModpackDetailPack,
  getSourceModpackPlatformLabel,
  normalizeSourceModpackEditorDraft
} from '@renderer/utils/source-modpack-share.js'
import SourceModpackItemRow from './SourceModpackItemRow.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  detail: { type: Object, default: () => ({}) },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'save'])
const draft = ref(normalizeSourceModpackEditorDraft())
const formError = ref('')
const itemFeedback = ref('')
const itemKeyword = ref('')
const coverFailed = ref(false)

const pack = computed(() => getSourceModpackDetailPack(props.detail))
const canSubmit = computed(() => {
  return (
    !props.saving &&
    String(draft.value.name || '').trim().length > 0 &&
    String(draft.value.version || '').trim().length > 0 &&
    draft.value.items.length > 0
  )
})
const filteredItems = computed(() => {
  const keyword = String(itemKeyword.value || '')
    .trim()
    .toLowerCase()
  return draft.value.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!keyword) return true
      return [
        item.name,
        item.description,
        item.sourcePlatform,
        item.sourceModId,
        item.sourceFileId,
        item.sourceModKey
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
})

watch(
  [() => props.modelValue, () => props.detail],
  ([visible]) => {
    if (!visible) return
    draft.value = normalizeSourceModpackEditorDraft(props.detail)
    formError.value = ''
    itemFeedback.value = ''
    itemKeyword.value = ''
    coverFailed.value = false
  },
  { immediate: true }
)

watch(
  () => draft.value.cover,
  () => {
    coverFailed.value = false
  }
)

function requestClose() {
  if (props.saving) return
  emit('update:modelValue', false)
}

function reindexItems() {
  draft.value.items = draft.value.items.map((item, index) => ({
    ...item,
    sortIndex: index
  }))
}

function moveItem(index, offset) {
  if (props.saving) return
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= draft.value.items.length) return
  const items = [...draft.value.items]
  const [item] = items.splice(index, 1)
  items.splice(targetIndex, 0, item)
  draft.value.items = items
  reindexItems()
  formError.value = ''
  itemFeedback.value = uiText('ui.movedValueToPositionValue', { value1: (item.name || item.sourceModKey || item.sourceModId), value2: (targetIndex + 1) })
}

function removeItem(index) {
  if (props.saving) return
  const [removed] = draft.value.items.splice(index, 1)
  if (!removed) return
  reindexItems()
  itemFeedback.value = uiText('ui.removedValueSaveToApply', { value1: (removed.name || removed.sourceModKey || removed.sourceModId) })
  formError.value = draft.value.items.length ? '' : uiText('ui.keepAtLeastOneValidModEntry')
}

function submit() {
  if (!canSubmit.value) {
    formError.value = draft.value.items.length
      ? '请填写整合包名称和版本'
      : uiText('ui.keepAtLeastOneValidModEntry')
    return
  }

  try {
    const payload = buildSourceModpackUpdatePayload(props.detail, draft.value)
    formError.value = ''
    emit('save', payload)
  } catch (error) {
    formError.value = String(error?.message || '编辑内容无效').trim()
  }
}
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="$t('ui.editOnlineModpack')"
    :description="$t('ui.keepSourceIdentitiesAndFullMetadataEditSharingDetailsAnd')"
    :width="920"
    panel-class="source-modpack-editor-panel"
    :close-on-overlay="!saving"
    :close-on-esc="!saving"
    @update:model-value="requestClose"
    @close="requestClose"
  >
    <div class="source-modpack-editor">
      <div class="source-modpack-editor__overview">
        <div class="source-modpack-editor__cover-preview">
          <img
            v-if="draft.cover && !coverFailed"
            :src="draft.cover"
            :alt="$t('ui.modpackCoverPreview')"
            @error="coverFailed = true"
          />
          <span v-else>{{ getSourceModpackPlatformLabel(draft.sourceType).slice(0, 1) }}</span>
        </div>

        <div class="source-modpack-editor__overview-identity">
          <strong :title="draft.name">{{ draft.name || $t('ui.unnamedModpack') }}</strong>
          <VxTag size="sm">{{ getSourceModpackPlatformLabel(draft.sourceType) }}</VxTag>
        </div>

        <div class="source-modpack-editor__summary">
          <div>
            <span>{{ $t('ui.shareCode') }}</span>
            <strong>{{ pack.shareCode || pack.share_code || '--' }}</strong>
          </div>
          <div>
            <span>{{ $t('taskCenter.table.game') }}</span>
            <strong>{{
              draft.sourceGameName || draft.sourceGameSlug || draft.sourceGameId || '--'
            }}</strong>
          </div>
          <div>
            <span>{{ $t('taskCenter.toolbar.sourceLabel') }}</span>
            <strong>{{ getSourceModpackPlatformLabel(draft.sourceType) }}</strong>
          </div>
        </div>

        <div class="source-modpack-editor__visibility">
          <VxSwitch v-model="draft.isPublic" :label="$t('ui.allowPublicListing')" :disabled="saving" />
          <span>{{ draft.isPublic ? $t('ui.publiclyVisible') : $t('ui.onlyVisibleToYou') }}</span>
        </div>
      </div>

      <section class="source-modpack-editor__share-settings">
        <header class="source-modpack-editor__section-heading">
          <h4>{{ $t('ui.sharingSettings') }}</h4>
        </header>

        <div class="source-modpack-editor__share-grid">
          <div class="source-modpack-editor__share-fields">
            <div class="source-modpack-editor__form-grid">
              <VxInput
                v-model="draft.name"
                :label="$t('modelSettings.name')"
                :placeholder="$t('ui.enterAModpackName')"
                :disabled="saving"
              />
              <VxInput
                v-model="draft.version"
                :label="$t('tools.version')"
                :placeholder="$t('ui.forExample100')"
                :disabled="saving"
              />
            </div>

            <VxInput
              v-model="draft.cover"
              :label="$t('ui.cover')"
              :placeholder="$t('ui.coverImageURLOptional')"
              :disabled="saving"
            />
          </div>

          <VxTextarea
            v-model="draft.description"
            class="source-modpack-editor__description"
            :label="$t('ui.description')"
            :placeholder="$t('ui.describeTheContentsCompatibleVersionsOrPrecautions')"
            :rows="3"
            :disabled="saving"
          />
        </div>
      </section>

      <section class="source-modpack-editor__item-section">
        <div class="source-modpack-editor__item-toolbar">
          <header class="source-modpack-editor__item-header">
            <div>
              <h4>{{ $t('ui.modEntries') }}</h4>
              <p>{{ $t('ui.sourceIdentitiesAreReadOnlyYouCanReorderOrRemove') }}</p>
            </div>
          </header>
          <div class="source-modpack-editor__item-controls">
            <VxTag tone="info">{{ draft.items.length }} {{ $t('ui.items') }}</VxTag>
            <VxInput
              v-model="itemKeyword"
              :aria-label="$t('ui.filterMods')"
              :placeholder="$t('ui.searchNamesDescriptionsOrSourceIDs')"
              clearable
            />
          </div>
        </div>

        <div class="source-modpack-editor__items vx-ui-scrollbar">
          <div v-if="!draft.items.length" class="source-modpack-editor__empty">
            {{ $t('ui.allEntriesHaveBeenRemovedKeepAtLeastOneValid') }}
          </div>
          <SourceModpackItemRow
            v-for="entry in filteredItems"
            v-else
            :key="`${entry.item.sourcePlatform}:${entry.item.sourceModKey || entry.item.sourceModId}:${entry.item.sourceFileId}:${entry.index}`"
            :item="entry.item"
            :action-label="$t('ui.itemValue', { value1: (entry.index + 1) })"
            compact
            show-identity
          >
            <template #actions>
              <VxButton
                variant="ghost"
                size="sm"
                :disabled="saving || entry.index === 0"
                @click="moveItem(entry.index, -1)"
              >
                {{ $t('ui.moveUp') }}
              </VxButton>
              <VxButton
                variant="ghost"
                size="sm"
                :disabled="saving || entry.index === draft.items.length - 1"
                @click="moveItem(entry.index, 1)"
              >
                {{ $t('ui.moveDown') }}
              </VxButton>
              <VxButton
                class="source-modpack-editor__remove-action"
                variant="ghost"
                size="sm"
                :disabled="saving"
                @click="removeItem(entry.index)"
              >
                {{ $t('modelSettings.remove') }}
              </VxButton>
            </template>
          </SourceModpackItemRow>
          <div
            v-if="draft.items.length && !filteredItems.length"
            class="source-modpack-editor__empty"
          >
            {{ $t('ui.noModEntriesMatchYourSearch') }}
          </div>
        </div>
      </section>

      <p v-if="itemFeedback" class="source-modpack-editor__feedback" aria-live="polite">
        {{ itemFeedback }}
      </p>
      <p v-if="formError" class="source-modpack-editor__error" role="alert">{{ formError }}</p>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="$t('ui.cancel')"
        :confirm-text="saving ? $t('ui.saving') : $t('modelSettings.saveChanges')"
        :cancel-disabled="saving"
        :confirm-disabled="!canSubmit"
        :confirm-loading="saving"
        @cancel="requestClose"
        @confirm="submit"
      />
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
:global(.source-modpack-editor-panel) {
  width: min(980px, calc(100vw - 48px)) !important;
  max-width: min(980px, calc(100vw - 48px)) !important;
  height: min(880px, calc(100vh - 48px));
  max-height: min(880px, calc(100vh - 48px)) !important;
  gap: var(--space-4);
}

:global(.source-modpack-editor-panel .base-dialog-body) {
  --vx-dialog-scroll-offset: 0px;

  display: flex;
  flex: 1 1 auto;
  width: 100%;
  padding-right: 0;
  overflow: hidden;
  scrollbar-gutter: auto;
}

.source-modpack-editor {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-height: 0;
}

.source-modpack-editor__overview {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 96px minmax(190px, 1.2fr) minmax(300px, 1.7fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.source-modpack-editor__overview-identity {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
  min-width: 0;
}

.source-modpack-editor__overview-identity strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-lg);
}

.source-modpack-editor__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-width: 0;
}

.source-modpack-editor__summary > div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: 0 var(--space-3);
  border-left: 1px solid var(--color-border);
}

.source-modpack-editor__summary span,
.source-modpack-editor__item-header p,
.source-modpack-editor__visibility > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-editor__summary strong {
  overflow: hidden;
  color: var(--color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
}

.source-modpack-editor__visibility {
  display: grid;
  gap: 0;
  min-width: 138px;
  padding-left: var(--space-4);
  border-left: 1px solid var(--color-border);
}

.source-modpack-editor__visibility > span {
  padding-left: 48px;
  line-height: var(--line-height-tight);
}

.source-modpack-editor__share-settings {
  display: grid;
  flex: 0 0 auto;
  gap: var(--space-2);
}

.source-modpack-editor__section-heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.source-modpack-editor__section-heading::after {
  height: 1px;
  flex: 1 1 auto;
  content: '';
  background: var(--color-border);
}

.source-modpack-editor__section-heading h4 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.source-modpack-editor__share-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.9fr);
  align-items: stretch;
  gap: var(--space-3);
}

.source-modpack-editor__share-fields {
  display: grid;
  align-content: start;
  gap: var(--space-2);
}

.source-modpack-editor__form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: var(--space-2);
}

.source-modpack-editor__cover-preview {
  display: grid;
  place-items: center;
  width: 96px;
  height: 68px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-editor__cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-modpack-editor__share-grid :deep(.vx-field) {
  gap: 6px;
}

.source-modpack-editor__description :deep(.vx-textarea) {
  height: 100%;
  min-height: 88px;
  resize: none;
}

.source-modpack-editor__item-section {
  display: flex;
  flex: 1 1 300px;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding-top: var(--space-1);
  border-top: 1px solid var(--color-border);
}

.source-modpack-editor__item-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  align-items: center;
  gap: var(--space-4);
}

.source-modpack-editor__item-controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.source-modpack-editor__item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.source-modpack-editor__item-header h4,
.source-modpack-editor__item-header p {
  margin: 0;
}

.source-modpack-editor__item-header h4 {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.source-modpack-editor__item-header p {
  margin-top: var(--space-1);
  line-height: var(--line-height-relaxed);
}

.source-modpack-editor__items {
  min-height: 0;
  max-height: none;
  flex: 1 1 auto;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  scrollbar-gutter: stable;
}

.source-modpack-editor__items :deep(.source-modpack-item-row__trailing) {
  flex-wrap: nowrap;
  max-width: none;
}

.source-modpack-editor__remove-action {
  padding: 0 var(--space-2);
  color: var(--color-danger);
  border-color: transparent;
  background: transparent;
}

.source-modpack-editor__remove-action:hover:not(:disabled) {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.source-modpack-editor__items::-webkit-scrollbar {
  width: 7px;
}

.source-modpack-editor__items::-webkit-scrollbar-track {
  background: var(--scrollbar-track-color);
  border-radius: var(--default-border-radius);
}

.source-modpack-editor__items::-webkit-scrollbar-thumb {
  min-height: 40px;
  border-radius: 4px;
  background: var(--scrollbar-thumb-color);
}

.source-modpack-editor__items::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.source-modpack-editor__empty {
  padding: 32px var(--space-4);
  color: var(--color-text-muted);
  text-align: center;
  font-size: var(--font-size-sm);
}

.source-modpack-editor__feedback,
.source-modpack-editor__error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}

.source-modpack-editor__feedback {
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
}

.source-modpack-editor__error {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

@media (max-width: 760px) {
  :global(.source-modpack-editor-panel .base-dialog-body) {
    padding-right: var(--space-3);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .source-modpack-editor {
    height: auto;
  }

  .source-modpack-editor__overview {
    grid-template-columns: 80px minmax(0, 1fr) auto;
  }

  .source-modpack-editor__cover-preview {
    width: 80px;
    height: 64px;
  }

  .source-modpack-editor__summary {
    grid-column: 1 / -1;
  }

  .source-modpack-editor__share-grid,
  .source-modpack-editor__form-grid,
  .source-modpack-editor__item-toolbar {
    grid-template-columns: 1fr;
  }

  .source-modpack-editor__items {
    min-height: 280px;
    max-height: 360px;
  }
}

@media (max-height: 560px) {
  :global(.source-modpack-editor-panel .base-dialog-body) {
    padding-right: var(--space-3);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .source-modpack-editor {
    height: auto;
  }

  .source-modpack-editor__items {
    min-height: 240px;
    max-height: 320px;
  }
}
</style>
