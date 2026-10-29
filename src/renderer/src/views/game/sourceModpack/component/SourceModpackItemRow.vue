<script setup>
import { computed, ref, watch } from 'vue'
import { VxTag } from '@renderer/component/vertex-ui'
import { getSourceModpackPlatformLabel } from '@renderer/utils/source-modpack-share.js'

const props = defineProps({
  item: { type: Object, default: () => ({}) },
  actionLabel: { type: String, default: '' },
  actionTone: { type: String, default: 'default' },
  statusText: { type: String, default: '' },
  showIdentity: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})

const imageFailed = ref(false)

function parseMetadata(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || ''))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const metadata = computed(() => ({
  ...parseMetadata(props.item.metadata_json),
  ...parseMetadata(props.item.metadataJson),
  ...parseMetadata(props.item.metadata)
}))
const title = computed(
  () =>
    props.item.name ||
    props.item.sourceModKey ||
    props.item.source_mod_key ||
    props.item.sourceModId ||
    '未命名模组'
)
const cover = computed(
  () => props.item.cover || props.item.icon || metadata.value.cover || metadata.value.icon || ''
)
const description = computed(
  () =>
    props.item.description ||
    props.item.summary ||
    metadata.value.description ||
    metadata.value.summary ||
    '暂无简介'
)
const sourcePlatform = computed(
  () =>
    props.item.sourcePlatform ||
    props.item.source_platform ||
    metadata.value.sourcePlatform ||
    metadata.value.source
)
const version = computed(
  () => props.item.version || props.item.sourceFileId || props.item.source_file_id || '--'
)
const dependencyRole = computed(() => props.item.dependencyRole || props.item.dependency_role || '')
const sourceModId = computed(() => props.item.sourceModId || props.item.source_mod_id || '--')
const sourceFileId = computed(() => props.item.sourceFileId || props.item.source_file_id || '--')
const sourceModKey = computed(() => props.item.sourceModKey || props.item.source_mod_key || '--')
const fallbackText = computed(
  () =>
    String(title.value || '?')
      .trim()
      .slice(0, 1)
      .toUpperCase() || '?'
)

watch(cover, () => {
  imageFailed.value = false
})
</script>

<template>
  <article
    class="source-modpack-item-row"
    :class="{ 'is-compact': compact, 'is-disabled': disabled }"
  >
    <div class="source-modpack-item-row__icon" aria-hidden="true">
      <img
        v-if="cover && !imageFailed"
        :src="cover"
        alt=""
        loading="lazy"
        @error="imageFailed = true"
      />
      <span v-else>{{ fallbackText }}</span>
    </div>

    <div class="source-modpack-item-row__main">
      <div class="source-modpack-item-row__title-line">
        <strong :title="title">{{ title }}</strong>
        <VxTag size="sm">{{ getSourceModpackPlatformLabel(sourcePlatform) }}</VxTag>
        <VxTag v-if="dependencyRole && dependencyRole !== 'main'" tone="info" size="sm">
          {{ $t('ui.dependencies') }}
        </VxTag>
      </div>
      <p :title="description">{{ description }}</p>
      <div class="source-modpack-item-row__meta">
        <span>{{ $t('tools.version') }} {{ version }}</span>
        <span v-if="compact" :title="sourceModKey">{{ $t('ui.sourceID') }}{{ sourceModKey }}</span>
        <span v-if="statusText">{{ statusText }}</span>
      </div>
      <div v-if="showIdentity && !compact" class="source-modpack-item-row__identity">
        <span>{{ $t('ui.modID') }}{{ sourceModId }}</span>
        <span>{{ $t('ui.fileID') }}{{ sourceFileId }}</span>
        <span :title="sourceModKey">{{ $t('ui.sourceKey') }}{{ sourceModKey }}</span>
      </div>
    </div>

    <div class="source-modpack-item-row__trailing">
      <VxTag v-if="actionLabel" :tone="actionTone" size="sm">{{ actionLabel }}</VxTag>
      <slot name="actions"></slot>
    </div>
  </article>
</template>

<style scoped lang="scss">
.source-modpack-item-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 76px;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: background var(--duration-fast) var(--ease-standard);
}

.source-modpack-item-row:last-child {
  border-bottom: 0;
}

.source-modpack-item-row:hover {
  background: var(--color-surface-hover);
}

.source-modpack-item-row.is-disabled {
  background: var(--color-surface-soft);
}

.source-modpack-item-row.is-compact {
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  min-height: 62px;
  padding: 6px 10px;
}

.source-modpack-item-row.is-compact .source-modpack-item-row__icon {
  width: 36px;
  height: 36px;
}

.source-modpack-item-row.is-compact .source-modpack-item-row__main {
  gap: 2px;
}

.source-modpack-item-row.is-compact .source-modpack-item-row__main p {
  overflow: hidden;
  font-size: var(--font-size-xs);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-line-clamp: 1;
}

.source-modpack-item-row.is-compact .source-modpack-item-row__meta {
  flex-wrap: nowrap;
  min-width: 0;
  font-size: 11px;
  line-height: 1.3;
}

.source-modpack-item-row.is-compact .source-modpack-item-row__meta span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-item-row__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.source-modpack-item-row__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-modpack-item-row__main {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.source-modpack-item-row__title-line,
.source-modpack-item-row__meta,
.source-modpack-item-row__identity,
.source-modpack-item-row__trailing {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.source-modpack-item-row__title-line strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-item-row__main p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.source-modpack-item-row__meta,
.source-modpack-item-row__identity {
  flex-wrap: wrap;
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
}

.source-modpack-item-row__identity span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-modpack-item-row__trailing {
  justify-content: flex-end;
  flex-wrap: wrap;
  max-width: 230px;
}

@media (max-width: 760px) {
  .source-modpack-item-row {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .source-modpack-item-row__icon {
    width: 42px;
    height: 42px;
  }

  .source-modpack-item-row__trailing {
    grid-column: 2;
    justify-content: flex-start;
    max-width: none;
  }
}
</style>
