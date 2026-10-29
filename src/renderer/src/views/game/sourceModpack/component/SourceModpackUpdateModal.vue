<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, ref, watch } from 'vue'
import { $message } from '@renderer/common/message.js'
import { VxButton, VxInput, VxModal, VxTag } from '@renderer/component/vertex-ui'
import { getSourceModpackPlatformLabel } from '@renderer/utils/source-modpack-share.js'
import { sourceModpackUpdateCoordinator } from '@renderer/utils/source-modpack-update-runtime.js'
import SourceModpackItemRow from './SourceModpackItemRow.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  snapshot: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'updated'])

const stage = ref('select')
const targets = ref([])
const selectedTargetId = ref('')
const keyword = ref('')
const loadingTargets = ref(false)
const previewing = ref(false)
const saving = ref(false)
const errorText = ref('')
const inspection = ref(null)
const version = ref('')
const failedCoverIds = ref(new Set())
let loadSerial = 0

function normalizeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function getPackId(pack = {}) {
  return normalizeText(pack.id || pack.sourceModpackId || pack.source_modpack_id)
}

function getPackName(pack = {}) {
  return normalizeText(pack.name) || '未命名整合包'
}

function getPackShareCode(pack = {}) {
  return normalizeText(pack.shareCode || pack.share_code || pack.code) || '--'
}

function getPackVersion(pack = {}) {
  return normalizeText(pack.version) || '1.0.0'
}

function getPackRevision(pack = {}) {
  return toSafeNumber(pack.currentRevision ?? pack.current_revision, 0)
}

function getPackModCount(pack = {}) {
  return toSafeNumber(pack.modNum ?? pack.mod_num, 0)
}

function getPackSourceType(pack = {}) {
  return normalizeText(pack.sourceType || pack.source_type)
}

function getPackCover(pack = {}) {
  return normalizeText(pack.cover || pack.icon)
}

function isPackPublic(pack = {}) {
  const value = pack.isPublic ?? pack.is_public
  return value === true || value === 1 || normalizeText(value).toLowerCase() === 'true'
}

function getPackDate(pack = {}) {
  const raw = pack.updatedAt || pack.updated_at || pack.createdAt || pack.created_at
  const date = raw ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) return '暂无更新时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function getTargetFallback(pack = {}) {
  return getPackName(pack).slice(0, 1).toUpperCase() || '?'
}

function hasFailedCover(pack = {}) {
  return failedCoverIds.value.has(getPackId(pack))
}

function markCoverFailed(pack = {}) {
  const next = new Set(failedCoverIds.value)
  next.add(getPackId(pack))
  failedCoverIds.value = next
}

const filteredTargets = computed(() => {
  const search = normalizeText(keyword.value).toLowerCase()
  if (!search) return targets.value
  return targets.value.filter((pack) => {
    return [
      getPackName(pack),
      getPackShareCode(pack),
      getPackSourceType(pack),
      pack.sourceGameName,
      pack.source_game_name
    ]
      .map((value) => normalizeText(value).toLowerCase())
      .some((value) => value.includes(search))
  })
})

const selectedTarget = computed(() => {
  return targets.value.find((pack) => getPackId(pack) === selectedTargetId.value) || null
})

const sourceLabel = computed(() => {
  return getSourceModpackPlatformLabel(props.snapshot?.sourceType || props.snapshot?.source_type)
})

const snapshotItemCount = computed(() => {
  return Array.isArray(props.snapshot?.items) ? props.snapshot.items.length : 0
})

const diff = computed(() => inspection.value?.diff || null)
const changedEntries = computed(() => {
  return (diff.value?.entries || []).filter((entry) => entry.changeType !== 'retained')
})

function getEntryLabel(entry = {}) {
  if (entry.changeType === 'added') return uiText('ui.added')
  if (entry.changeType === 'updated') return uiText('taskCenter.table.updated')
  return uiText('taskCenter.downloads.keep')
}

function getEntryTone(entry = {}) {
  if (entry.changeType === 'added') return 'success'
  if (entry.changeType === 'updated') return 'warning'
  return 'default'
}

function getEntryStatus(entry = {}) {
  if (entry.changeType !== 'updated') return ''
  const previousVersion = normalizeText(
    entry.previousItem?.version ||
      entry.previousItem?.sourceFileId ||
      entry.previousItem?.source_file_id
  )
  const nextVersion = normalizeText(
    entry.item?.version || entry.item?.sourceFileId || entry.item?.source_file_id
  )
  if (!previousVersion || !nextVersion || previousVersion === nextVersion) return uiText('ui.contentChanged')
  return `${previousVersion} → ${nextVersion}`
}

function resetState() {
  stage.value = 'select'
  targets.value = []
  selectedTargetId.value = ''
  keyword.value = ''
  errorText.value = ''
  inspection.value = null
  version.value = ''
  failedCoverIds.value = new Set()
  loadingTargets.value = false
  previewing.value = false
}

async function loadTargets() {
  const serial = ++loadSerial
  resetState()
  loadingTargets.value = true
  try {
    const result = await sourceModpackUpdateCoordinator.listTargets(props.snapshot || {})
    if (serial !== loadSerial) return
    targets.value = result
    selectedTargetId.value = result.length ? getPackId(result[0]) : ''
  } catch (error) {
    if (serial !== loadSerial) return
    console.error('加载可更新分享失败', error)
    errorText.value = normalizeText(error?.message) || '加载可更新分享失败'
  } finally {
    if (serial === loadSerial) loadingTargets.value = false
  }
}

function handleVisibleChange(visible) {
  if (!visible && !saving.value) {
    loadSerial += 1
    emit('update:modelValue', false)
  }
}

function selectTarget(pack = {}) {
  if (previewing.value || saving.value) return
  selectedTargetId.value = getPackId(pack)
  errorText.value = ''
}

async function previewUpdate() {
  if (!selectedTargetId.value || previewing.value) return
  previewing.value = true
  errorText.value = ''
  try {
    const result = await sourceModpackUpdateCoordinator.inspect({
      targetId: selectedTargetId.value,
      snapshot: props.snapshot
    })
    if (!props.modelValue) return
    inspection.value = result
    version.value = getPackVersion(result.pack)
    stage.value = 'preview'
  } catch (error) {
    console.error('生成分享更新预览失败', error)
    errorText.value = normalizeText(error?.message) || '生成更新预览失败'
  } finally {
    previewing.value = false
  }
}

function backToSelect() {
  if (saving.value) return
  stage.value = 'select'
  inspection.value = null
  version.value = ''
  errorText.value = ''
}

async function confirmUpdate() {
  if (saving.value || !diff.value?.hasChanges) return
  if (!normalizeText(version.value)) {
    errorText.value = uiText('ui.enterAModpackVersion')
    return
  }

  saving.value = true
  errorText.value = ''
  try {
    const result = await sourceModpackUpdateCoordinator.apply({
      inspection: inspection.value,
      version: version.value
    })
    $message.success(uiMessage('ui.modpackUpdatedSuccessfully'))
    emit('updated', result)
    emit('update:modelValue', false)
  } catch (error) {
    console.error('更新已有分享失败', error)
    const message = normalizeText(error?.message) || '更新已有分享失败'
    errorText.value = message.includes('manifest_revision_conflict')
      ? '这个分享已在其他位置更新，请返回重新选择并预览后再试'
      : message
  } finally {
    saving.value = false
  }
}

watch([() => props.modelValue, () => props.snapshot], ([visible]) => {
  if (visible) {
    loadTargets().then()
  } else {
    loadSerial += 1
    resetState()
  }
})
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :width="880"
    :close-on-esc="!saving"
    :title="$t('ui.updateExistingShare')"
    :description="$t('ui.addNewModsAndVersionsFromTheCurrentProfileTo')"
    panel-class="source-modpack-update-dialog"
    @update:model-value="handleVisibleChange"
  >
    <div class="source-modpack-update-modal">
      <template v-if="stage === 'select'">
        <div class="source-modpack-update-modal__source-summary">
          <div>
            <span>{{ $t('ui.currentSource') }}</span>
            <strong>{{ sourceLabel }}</strong>
          </div>
          <div>
            <span>{{ $t('ui.currentProfileVariant2') }}</span>
            <strong>{{ snapshotItemCount }} {{ $t('ui.shareableMods') }}</strong>
          </div>
          <div>
            <span>{{ $t('ui.availableTargets') }}</span>
            <strong>{{ targets.length }} {{ $t('ui.existingShares') }}</strong>
          </div>
        </div>

        <VxInput
          v-if="targets.length > 5"
          v-model="keyword"
          :label="$t('ui.searchExistingShares')"
          :placeholder="$t('ui.searchByNameShareCodeOrGame')"
          clearable
        />

        <div v-if="loadingTargets" class="source-modpack-update-modal__state" aria-live="polite">
          {{ $t('ui.loadingYourExistingShares') }}
        </div>
        <div v-else-if="errorText" class="source-modpack-update-modal__state is-error">
          {{ errorText }}
        </div>
        <div v-else-if="!targets.length" class="source-modpack-update-modal__state">
          <strong>{{ $t('ui.noSharesAvailableToUpdate') }}</strong>
          <span>{{ $t('ui.useShareCurrentProfileFirstToCreateAShareFor') }}</span>
        </div>
        <div v-else-if="!filteredTargets.length" class="source-modpack-update-modal__state">
          {{ $t('ui.noSharesMatchYourSearch') }}
        </div>
        <div v-else class="source-modpack-update-modal__target-list" role="listbox">
          <button
            v-for="pack in filteredTargets"
            :key="getPackId(pack)"
            type="button"
            class="source-modpack-update-target"
            :class="{ 'is-selected': getPackId(pack) === selectedTargetId }"
            role="option"
            :aria-selected="getPackId(pack) === selectedTargetId"
            @click="selectTarget(pack)"
          >
            <span class="source-modpack-update-target__cover" aria-hidden="true">
              <img
                v-if="getPackCover(pack) && !hasFailedCover(pack)"
                :src="getPackCover(pack)"
                alt=""
                loading="lazy"
                @error="markCoverFailed(pack)"
              />
              <span v-else>{{ getTargetFallback(pack) }}</span>
            </span>
            <span class="source-modpack-update-target__body">
              <span class="source-modpack-update-target__title-line">
                <strong>{{ getPackName(pack) }}</strong>
                <VxTag tone="accent" size="sm">
                  {{ getSourceModpackPlatformLabel(getPackSourceType(pack)) }}
                </VxTag>
                <VxTag :tone="isPackPublic(pack) ? 'success' : 'default'" size="sm">
                  {{ isPackPublic(pack) ? $t('ui.public') : $t('ui.private') }}
                </VxTag>
              </span>
              <span class="source-modpack-update-target__meta">
                <span>{{ $t('ui.shareCode') }} {{ getPackShareCode(pack) }}</span>
                <span>{{ $t('tools.version') }} {{ getPackVersion(pack) }}</span>
                <span>{{ $t('ui.revision') }} {{ getPackRevision(pack) }}</span>
                <span>{{ getPackModCount(pack) }} {{ $t('ui.mods') }}</span>
                <span>{{ getPackDate(pack) }}</span>
              </span>
            </span>
            <span class="source-modpack-update-target__selector" aria-hidden="true"></span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="source-modpack-update-modal__preview-head">
          <div class="source-modpack-update-modal__preview-title">
            <span>{{ $t('ui.aboutToUpdate') }}</span>
            <strong>{{ getPackName(inspection?.pack) }}</strong>
            <small>{{ $t('ui.shareCode') }} {{ getPackShareCode(inspection?.pack) }}</small>
          </div>
          <VxInput
            v-model="version"
            class="source-modpack-update-modal__version"
            :label="$t('ui.modpackVersion')"
            :hint="$t('ui.theContentRevisionIncrementsAutomaticallyYouCanAlsoUpdateThe')"
            :placeholder="$t('ui.forExample110')"
          />
        </div>

        <div class="source-modpack-update-modal__diff-stats" :aria-label="$t('ui.updateSummary')">
          <span class="source-modpack-update-modal__diff-stat is-added">
            {{ $t('ui.added') }} <strong>{{ diff?.addedCount || 0 }}</strong>
          </span>
          <span class="source-modpack-update-modal__diff-stat is-updated">
            {{ $t('taskCenter.table.updated') }} <strong>{{ diff?.updatedCount || 0 }}</strong>
          </span>
          <span class="source-modpack-update-modal__diff-stat">
            {{ $t('taskCenter.downloads.keep') }} <strong>{{ diff?.retainedCount || 0 }}</strong>
          </span>
          <span class="source-modpack-update-modal__diff-stat">
            {{ $t('ui.totalAfterUpdate') }} <strong>{{ diff?.entries?.length || 0 }}</strong>
          </span>
        </div>

        <div v-if="!diff?.hasChanges" class="source-modpack-update-modal__state">
          <strong>{{ $t('ui.thisShareIsAlreadyUpToDate') }}</strong>
          <span>{{ $t('ui.noNewModsToAddOrNewerVersionsToReplace') }}</span>
        </div>
        <div
          v-else-if="diff?.exceedsItemLimit"
          class="source-modpack-update-modal__limit-warning"
          role="alert"
        >
          {{ $t('ui.afterUpdatingThereWillBe') }} {{ diff.entries.length }} {{ $t('ui.modsExceedingThePerShareLimitOf') }}
          {{ diff.itemLimit }} {{ $t('ui.modsVariant2') }}
        </div>
        <div v-if="diff?.hasChanges" class="source-modpack-update-modal__diff-list">
          <SourceModpackItemRow
            v-for="(entry, index) in changedEntries"
            :key="`${entry.item?.sourcePlatform}-${entry.item?.sourceModId || entry.item?.sourceModKey}-${index}`"
            :item="entry.item"
            :action-label="getEntryLabel(entry)"
            :action-tone="getEntryTone(entry)"
            :status-text="getEntryStatus(entry)"
            compact
          />
        </div>

        <div v-if="errorText" class="source-modpack-update-modal__inline-error" role="alert">
          {{ errorText }}
        </div>
      </template>
    </div>

    <template #footer>
      <div class="source-modpack-update-modal__actions">
        <VxButton
          variant="secondary"
          :disabled="saving"
          @click="stage === 'preview' ? backToSelect() : handleVisibleChange(false)"
        >
          {{ stage === 'preview' ? $t('ui.backToSelection') : $t('ui.cancel') }}
        </VxButton>
        <VxButton
          v-if="stage === 'select'"
          :loading="previewing"
          :disabled="loadingTargets || !selectedTarget"
          @click="previewUpdate"
        >
          {{ $t('ui.previewUpdate') }}
        </VxButton>
        <VxButton
          v-else
          :loading="saving"
          :disabled="!diff?.hasChanges || diff?.exceedsItemLimit || !normalizeText(version)"
          @click="confirmUpdate"
        >
          {{ $t('ui.confirmUpdate') }}
        </VxButton>
      </div>
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
:global(.source-modpack-update-dialog) {
  height: min(720px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  gap: var(--space-4);
}

:global(.source-modpack-update-dialog .base-dialog-header) {
  flex: 0 0 auto;
}

:global(.source-modpack-update-dialog .base-dialog-body) {
  --vx-dialog-scroll-offset: 0px;

  display: block;
  flex: 1 1 auto;
  min-height: 0;
  padding-right: 0;
  overflow: hidden;
  scrollbar-gutter: auto;
}

.source-modpack-update-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}

.source-modpack-update-modal__source-summary,
.source-modpack-update-modal__diff-stats {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.source-modpack-update-modal__source-summary > div {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
}

.source-modpack-update-modal__source-summary > div + div {
  border-left: 1px solid var(--color-border);
}

.source-modpack-update-modal__source-summary span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-update-modal__source-summary strong {
  color: var(--color-text);
  font-size: var(--font-size-lg);
}

.source-modpack-update-modal__target-list,
.source-modpack-update-modal__diff-list {
  flex: 1 1 auto;
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.source-modpack-update-modal__diff-list {
  flex: 1 1 auto;
}

.source-modpack-update-modal__target-list::-webkit-scrollbar,
.source-modpack-update-modal__diff-list::-webkit-scrollbar {
  width: 7px;
}

.source-modpack-update-modal__target-list::-webkit-scrollbar-track,
.source-modpack-update-modal__diff-list::-webkit-scrollbar-track {
  margin: 24px 0;
  border-radius: var(--default-border-radius);
  background: var(--scrollbar-track-color);
}

.source-modpack-update-modal__target-list::-webkit-scrollbar-thumb,
.source-modpack-update-modal__diff-list::-webkit-scrollbar-thumb {
  min-height: 40px;
  border-radius: 4px;
  background: var(--scrollbar-thumb-color);
}

.source-modpack-update-modal__target-list::-webkit-scrollbar-thumb:hover,
.source-modpack-update-modal__diff-list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.source-modpack-update-target {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 20px;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 80px;
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.source-modpack-update-target:last-child {
  border-bottom: 0;
}

.source-modpack-update-target:hover,
.source-modpack-update-target.is-selected {
  background: var(--color-surface-hover);
}

.source-modpack-update-target.is-selected {
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.source-modpack-update-target:focus-visible {
  position: relative;
  z-index: 1;
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent);
}

.source-modpack-update-target__cover {
  display: grid;
  width: 52px;
  height: 52px;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-update-target__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-modpack-update-target__body,
.source-modpack-update-target__title-line,
.source-modpack-update-target__meta {
  display: flex;
  min-width: 0;
}

.source-modpack-update-target__body {
  flex-direction: column;
  gap: var(--space-2);
}

.source-modpack-update-target__title-line,
.source-modpack-update-target__meta {
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.source-modpack-update-target__title-line strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-update-target__meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-update-target__selector {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border-strong);
  border-radius: 50%;
  box-shadow: inset 0 0 0 4px var(--color-surface);
  background: var(--color-surface);
}

.is-selected .source-modpack-update-target__selector {
  border-color: var(--color-accent);
  background: var(--color-accent);
}

.source-modpack-update-modal__state {
  display: grid;
  min-height: 180px;
  place-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  text-align: center;
}

.source-modpack-update-modal__state strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.source-modpack-update-modal__state.is-error,
.source-modpack-update-modal__inline-error,
.source-modpack-update-modal__limit-warning {
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border));
  background: var(--color-danger-soft);
}

.source-modpack-update-modal__preview-head {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  align-items: end;
  gap: var(--space-5);
}

.source-modpack-update-modal__preview-title {
  display: grid;
  gap: var(--space-1);
}

.source-modpack-update-modal__preview-title span,
.source-modpack-update-modal__preview-title small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-update-modal__preview-title strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-update-modal__diff-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-soft);
}

.source-modpack-update-modal__diff-stat {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.source-modpack-update-modal__diff-stat strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
  line-height: 1.2;
}

.source-modpack-update-modal__diff-stat.is-added strong {
  color: var(--color-success);
}

.source-modpack-update-modal__diff-stat.is-updated strong {
  color: var(--color-warning);
}

.source-modpack-update-modal__inline-error {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-4);
  border: 1px solid;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.source-modpack-update-modal__limit-warning {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-4);
  border: 1px solid;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.source-modpack-update-modal__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
}

@media (max-width: 760px) {
  .source-modpack-update-modal__source-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-modpack-update-modal__source-summary > div + div {
    border-left: 0;
  }
  .source-modpack-update-modal__preview-head {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .source-modpack-update-target {
    grid-template-columns: 44px minmax(0, 1fr) 18px;
    padding-inline: var(--space-3);
  }

  .source-modpack-update-target__cover {
    width: 44px;
    height: 44px;
  }
}

@media (max-height: 640px) {
  :global(.source-modpack-update-dialog) {
    height: calc(100vh - 24px);
    max-height: calc(100vh - 24px);
    gap: var(--space-3);
    padding: var(--space-4);
  }

  :global(.source-modpack-update-dialog .base-dialog-footer) {
    margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1);
    padding: var(--space-3) var(--space-4);
  }

  .source-modpack-update-modal {
    gap: var(--space-3);
  }

  .source-modpack-update-modal__preview-head {
    gap: var(--space-3);
  }

  .source-modpack-update-modal__diff-stats {
    min-height: 36px;
  }

  .source-modpack-update-modal__source-summary > div {
    padding: var(--space-2) var(--space-3);
  }

  .source-modpack-update-modal__target-list,
  .source-modpack-update-modal__diff-list {
    min-height: 88px;
  }
}
</style>
