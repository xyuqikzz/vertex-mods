<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { VxTag } from '@renderer/component/vertex-ui'
import {
  getSourceModpackDetailPack,
  getSourceModpackPlatformLabel
} from '@renderer/utils/source-modpack-share.js'
import SourceModpackItemRow from './SourceModpackItemRow.vue'

const props = defineProps({
  inspection: { type: Object, default: () => ({}) },
  // 冲突模式：只说明为什么没加入安装任务，冲突项排在最前。
  conflictMode: { type: Boolean, default: false }
})

const coverFailed = ref(false)

function normalizeText(value = '') {
  return String(value ?? '').trim()
}

function count(value) {
  return Array.isArray(value) ? value.length : Number(value || 0)
}

const pack = computed(() => getSourceModpackDetailPack(props.inspection.detail || {}))
const remote = computed(
  () => props.inspection.remote || props.inspection.canonicalPlan?.remote || {}
)
const canonicalItems = computed(() => {
  return Array.isArray(props.inspection.canonicalPlan?.items)
    ? props.inspection.canonicalPlan.items
    : []
})
const packName = computed(
  () => normalizeText(pack.value.name || remote.value.name) || '未命名分享整合包'
)
const packVersion = computed(
  () => normalizeText(remote.value.versionName || pack.value.version) || '--'
)
const shareCode = computed(
  () =>
    normalizeText(remote.value.shareCode || pack.value.shareCode || pack.value.share_code) || '--'
)
const packCover = computed(() => normalizeText(pack.value.cover))
const packDescription = computed(
  () => normalizeText(pack.value.description) || '此分享没有填写整合包简介'
)
const revision = computed(() => Number(remote.value.revision || 0))
const sourceLabels = computed(() => {
  const sourceSet = new Set(
    canonicalItems.value.map((item) => normalizeText(item.sourcePlatform)).filter(Boolean)
  )
  if (!sourceSet.size) {
    const fallback = normalizeText(pack.value.sourceType || pack.value.source_type)
    if (fallback) sourceSet.add(fallback)
  }
  return [...sourceSet].map((source) => getSourceModpackPlatformLabel(source))
})
const targetProfileText = computed(() => {
  const targets = Array.isArray(props.inspection.profileTargets)
    ? props.inspection.profileTargets
    : []
  const names = targets
    .map((target) => normalizeText(target.profileName || target.profile_name))
    .filter(Boolean)
  const fallback = normalizeText(props.inspection.canonicalPlan?.targetContext?.profileName)
  return [...new Set(names.length ? names : fallback ? [fallback] : [])].join('、') || uiText('ui.currentProfile')
})

const summaryStats = computed(() => {
  const summary = props.inspection.summary || {}
  const definitions = [
    ['added', '新增', 'success'],
    ['changed', '更新', 'info'],
    ['removed', '移除', 'danger'],
    ['metadataOnly', '信息刷新', 'default'],
    ['repairMissing', '修复缺失', 'warning'],
    ['retained', '保留', 'default'],
    ['conflicts', '冲突', 'danger']
  ]
  return definitions
    .map(([key, label, tone]) => ({ key, label, tone, count: count(summary[key]) }))
    .filter((item) => item.count > 0)
})

const conflictCount = computed(() => count(props.inspection.summary?.conflicts))

const actionDefinitions = Object.freeze([
  ['added', '新增', 'success'],
  ['changed', '更新', 'info'],
  ['removed', '移除', 'danger'],
  ['metadataOnly', '信息刷新', 'default'],
  ['repairMissing', '修复缺失', 'warning'],
  ['conflicts', '冲突', 'danger'],
  ['retained', '保留', 'default']
])

function unwrapSummaryItem(value = {}) {
  const candidate = value && typeof value === 'object' ? value : {}
  return candidate.entry || candidate.next || candidate.current || candidate.previous || candidate
}

const displayRows = computed(() => {
  const summary = props.inspection.summary || {}
  const rows = []
  const seen = new Set()
  const definitions = props.conflictMode
    ? [
        ...actionDefinitions.filter(([key]) => key === 'conflicts'),
        ...actionDefinitions.filter(([key]) => key !== 'conflicts')
      ]
    : actionDefinitions
  for (const [key, label, tone] of definitions) {
    for (const [index, rawItem] of (Array.isArray(summary[key]) ? summary[key] : []).entries()) {
      const item = unwrapSummaryItem(rawItem)
      const identity = normalizeText(
        item.itemKey || item.sourceModKey || item.sourceModId || `${key}:${index}`
      )
      const dedupeKey = `${key}:${identity}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      rows.push({ key: dedupeKey, item, actionLabel: label, actionTone: tone })
    }
  }

  if (rows.length) return rows
  return canonicalItems.value.map((item, index) => ({
    key: normalizeText(item.itemKey) || `item:${index}`,
    item,
    get actionLabel() { return uiText('ui.willInstall') },
    actionTone: 'success'
  }))
})

const warningMessages = computed(() => {
  return (Array.isArray(props.inspection.warnings) ? props.inspection.warnings : [])
    .map((warning) => normalizeText(warning?.message || warning?.code || warning))
    .filter(Boolean)
})
const fallbackText = computed(() => packName.value.slice(0, 1).toUpperCase() || '?')

watch(packCover, () => {
  coverFailed.value = false
})
</script>

<template>
  <div class="source-modpack-inspection-confirm">
    <div v-if="conflictMode" class="source-modpack-inspection-confirm__conflict" role="alert">
      <strong>{{ $t('ui.noInstallationTaskWasAdded') }}</strong>
      <span>
        {{
          conflictCount > 0
            ? $t('ui.valueModsConflictWithYourLocallyInstalledVersions', { value1: (conflictCount) })
            : $t('ui.someModsConflictWithYourLocallyInstalledVersions')
        }}{{ $t('ui.resolveTheseIssuesInModManagementThenReadTheShare') }}
      </span>
    </div>

    <section class="source-modpack-inspection-confirm__pack">
      <div class="source-modpack-inspection-confirm__cover" aria-hidden="true">
        <img v-if="packCover && !coverFailed" :src="packCover" alt="" @error="coverFailed = true" />
        <span v-else>{{ fallbackText }}</span>
      </div>

      <div class="source-modpack-inspection-confirm__identity">
        <div class="source-modpack-inspection-confirm__title-line">
          <strong :title="packName">{{ packName }}</strong>
          <VxTag v-for="label in sourceLabels" :key="label" size="sm">{{ label }}</VxTag>
        </div>
        <p :title="packDescription">{{ packDescription }}</p>
        <div class="source-modpack-inspection-confirm__meta">
          <span>{{ $t('tools.version') }} {{ packVersion }}</span>
          <span v-if="revision">{{ $t('ui.revision') }} {{ revision }}</span>
          <span>{{ $t('ui.shareCode') }} {{ shareCode }}</span>
        </div>
      </div>
    </section>

    <div class="source-modpack-inspection-confirm__target">
      <span>{{ $t('dialogs.configDetail.ruleTarget') }}</span>
      <strong>{{ targetProfileText }}</strong>
      <span>{{ canonicalItems.length }} {{ $t('ui.manifestEntries') }}</span>
    </div>

    <div class="source-modpack-inspection-confirm__stats" :aria-label="$t('ui.installationChangeSummary')">
      <span
        v-for="item in summaryStats"
        :key="item.key"
        class="source-modpack-inspection-confirm__stat"
        :class="`is-${item.tone}`"
      >
        {{ item.label }} <strong>{{ item.count }}</strong>
      </span>
    </div>

    <div v-if="warningMessages.length" class="source-modpack-inspection-confirm__warnings">
      <strong>{{ $t('ui.needsAttention') }}</strong>
      <span v-for="message in warningMessages" :key="message">{{ message }}</span>
    </div>

    <section class="source-modpack-inspection-confirm__items">
      <header>
        <strong>{{ conflictMode ? $t('ui.conflictsAndChanges') : $t('ui.modsInThisOperation') }}</strong>
        <span>{{
          conflictMode
            ? $t('ui.valueItemsNoInstallationTaskAdded', { value1: (displayRows.length) })
            : $t('ui.valueItemsInstallationTasksWillBeAddedAfterConfirmation', { value1: (displayRows.length) })
        }}</span>
      </header>
      <div class="source-modpack-inspection-confirm__list">
        <SourceModpackItemRow
          v-for="row in displayRows"
          :key="row.key"
          :item="row.item"
          :action-label="row.actionLabel"
          :action-tone="row.actionTone"
          compact
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.source-modpack-inspection-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  max-height: min(590px, calc(100vh - 220px));
  color: var(--color-text);
}

.source-modpack-inspection-confirm__conflict {
  display: grid;
  gap: 2px;
  padding: var(--space-3) 14px;
  border: 1px solid #f3b9b9;
  border-radius: 10px;
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.source-modpack-inspection-confirm__conflict strong {
  font-weight: var(--font-weight-semibold);
}

.source-modpack-inspection-confirm__pack {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.source-modpack-inspection-confirm__cover {
  display: grid;
  width: 64px;
  height: 64px;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-inspection-confirm__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-modpack-inspection-confirm__identity {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.source-modpack-inspection-confirm__title-line,
.source-modpack-inspection-confirm__meta,
.source-modpack-inspection-confirm__target,
.source-modpack-inspection-confirm__stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.source-modpack-inspection-confirm__title-line {
  gap: var(--space-2);
}

.source-modpack-inspection-confirm__title-line strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-lg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-inspection-confirm__identity p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.source-modpack-inspection-confirm__meta {
  gap: var(--space-2) var(--space-4);
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
}

.source-modpack-inspection-confirm__target {
  gap: var(--space-2);
  min-height: 36px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.source-modpack-inspection-confirm__target strong {
  color: var(--color-text);
}

.source-modpack-inspection-confirm__target span:last-child {
  margin-left: auto;
}

.source-modpack-inspection-confirm__stats {
  gap: var(--space-2) var(--space-5);
  min-height: 34px;
  padding: 0 var(--space-1);
}

.source-modpack-inspection-confirm__stat {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.source-modpack-inspection-confirm__stat strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.source-modpack-inspection-confirm__stat.is-success strong {
  color: var(--color-success);
}

.source-modpack-inspection-confirm__stat.is-info strong {
  color: var(--color-info);
}

.source-modpack-inspection-confirm__stat.is-warning strong {
  color: var(--color-warning);
}

.source-modpack-inspection-confirm__stat.is-danger strong {
  color: var(--color-danger);
}

.source-modpack-inspection-confirm__warnings {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-warning) 26%, var(--color-border));
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.source-modpack-inspection-confirm__warnings strong {
  color: var(--color-warning);
}

.source-modpack-inspection-confirm__items {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 160px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.source-modpack-inspection-confirm__items > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex: 0 0 auto;
  min-height: 42px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-soft);
}

.source-modpack-inspection-confirm__items > header strong {
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.source-modpack-inspection-confirm__items > header span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-modpack-inspection-confirm__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.source-modpack-inspection-confirm__list::-webkit-scrollbar {
  width: 7px;
}

.source-modpack-inspection-confirm__list::-webkit-scrollbar-track {
  margin: 16px 0;
  border-radius: var(--default-border-radius);
  background: var(--scrollbar-track-color);
}

.source-modpack-inspection-confirm__list::-webkit-scrollbar-thumb {
  min-height: 40px;
  border-radius: 4px;
  background: var(--scrollbar-thumb-color);
}

.source-modpack-inspection-confirm__list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

@media (max-width: 700px) {
  .source-modpack-inspection-confirm {
    max-height: calc(100vh - 180px);
  }

  .source-modpack-inspection-confirm__pack {
    grid-template-columns: 52px minmax(0, 1fr);
  }

  .source-modpack-inspection-confirm__cover {
    width: 52px;
    height: 52px;
  }

  .source-modpack-inspection-confirm__target span:last-child {
    width: 100%;
    margin-left: 0;
  }

  .source-modpack-inspection-confirm__items > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
}
</style>
