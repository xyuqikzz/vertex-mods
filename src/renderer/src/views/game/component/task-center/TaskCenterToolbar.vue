<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxSelect } from '@renderer/component/vertex-ui'
import { ToolIcon, ToolNotice, ToolSearchField } from '@renderer/component/tool-page'

const props = defineProps({
  title: { type: String, default: '' },
  count: { type: Number, default: 0 },
  search: { type: String, default: '' },
  source: { type: String, default: '' },
  sourceOptions: { type: Array, default: () => [] },
  sort: { type: String, default: 'priority' },
  loading: { type: Boolean, default: false },
  operationLoading: { type: Boolean, default: false },
  errorText: { type: String, default: '' },
  selectedCount: { type: Number, default: 0 },
  // [{ action, count }]：选中任务里可以执行该操作的数量，为 0 的不显示。
  bulkActions: { type: Array, default: () => [] },
  canClearHistory: { type: Boolean, default: false }
})
const emit = defineEmits([
  'update:search',
  'update:source',
  'update:sort',
  'refresh',
  'bulk',
  'clear-selection',
  'clear-history'
])
const { t } = useI18n()

const sourceSelectOptions = computed(() => [
  { value: '', label: t('taskCenter.toolbar.allSources') },
  ...props.sourceOptions
])
const sortOptions = computed(() => [
  { value: 'priority', label: t('taskCenter.toolbar.sortPriority') },
  { value: 'updated', label: t('taskCenter.toolbar.sortUpdated') },
  { value: 'name', label: t('taskCenter.toolbar.sortName') }
])
const visibleBulkActions = computed(() => props.bulkActions.filter((item) => item.count > 0))
</script>

<template>
  <header class="task-center-toolbar">
    <div class="task-center-toolbar__row">
      <div class="task-center-toolbar__heading">
        <h2>{{ title }}</h2>
        <span role="status" aria-live="polite">{{ t('taskCenter.toolbar.count', { count }) }}</span>
      </div>
      <div class="task-center-toolbar__filters">
        <ToolSearchField
          class="task-center-toolbar__search"
          :model-value="search"
          :label="t('taskCenter.toolbar.search')"
          :placeholder="t('taskCenter.toolbar.searchPlaceholder')"
          @update:model-value="emit('update:search', $event)"
        />
        <VxSelect
          class="task-center-toolbar__select"
          :model-value="source"
          :options="sourceSelectOptions"
          :aria-label="t('taskCenter.toolbar.sourceLabel')"
          @update:model-value="emit('update:source', String($event || ''))"
        />
        <VxSelect
          class="task-center-toolbar__select"
          :model-value="sort"
          :options="sortOptions"
          :aria-label="t('taskCenter.toolbar.sortLabel')"
          @update:model-value="emit('update:sort', String($event || 'priority'))"
        />
        <VxButton
          v-if="canClearHistory"
          variant="secondary"
          size="sm"
          :loading="operationLoading"
          @click="emit('clear-history')"
          >{{ t('taskCenter.toolbar.clearHistory') }}</VxButton
        >
        <VxButton
          class="task-center-toolbar__refresh"
          variant="secondary"
          size="sm"
          :loading="loading"
          :aria-label="t('taskCenter.toolbar.refresh')"
          :title="t('taskCenter.toolbar.refresh')"
          @click="emit('refresh')"
        >
          <ToolIcon name="refresh" :size="15" />
          <span>{{ t('taskCenter.toolbar.refreshText') }}</span>
        </VxButton>
      </div>
    </div>

    <div
      v-if="selectedCount > 0"
      class="task-center-toolbar__bulk"
      role="toolbar"
      :aria-label="t('taskCenter.bulk.label')"
    >
      <strong>{{ t('taskCenter.bulk.selected', { count: selectedCount }) }}</strong>
      <VxButton
        v-for="item in visibleBulkActions"
        :key="item.action"
        variant="ghost"
        size="sm"
        :class="{ 'is-danger': item.action === 'delete' }"
        :loading="operationLoading"
        @click="emit('bulk', item.action)"
        >{{ t(`taskCenter.bulk.${item.action}`) }}</VxButton
      >
      <span class="task-center-toolbar__spacer"></span>
      <VxButton variant="ghost" size="sm" @click="emit('clear-selection')">{{
        t('taskCenter.bulk.clear')
      }}</VxButton>
    </div>

    <ToolNotice v-if="errorText" tone="danger" class="task-center-toolbar__error">
      {{ t('taskCenter.toolbar.loadFailed', { reason: errorText }) }}
      <template #actions>
        <VxButton variant="secondary" size="sm" @click="emit('refresh')">{{
          t('taskCenter.toolbar.retry')
        }}</VxButton>
      </template>
    </ToolNotice>
  </header>
</template>

<style scoped lang="scss">
.task-center-toolbar {
  display: grid;
  flex-shrink: 0;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-6) var(--space-3);
  box-sizing: border-box;
}

.task-center-toolbar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.task-center-toolbar__heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.task-center-toolbar__heading h2 {
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.task-center-toolbar__heading > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-center-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.task-center-toolbar__search {
  width: 220px;
}

.task-center-toolbar__select {
  width: 148px;
}

.task-center-toolbar__refresh :deep(.vx-button__content),
.task-center-toolbar__bulk :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.task-center-toolbar__bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-height: 40px;
  padding: var(--space-1) var(--space-2) var(--space-1) 14px;
  background: color-mix(in srgb, var(--color-accent-soft) 35%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-accent) 25%, var(--color-surface));
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.task-center-toolbar__bulk strong {
  margin-right: var(--space-2);
  color: var(--color-accent-strong);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.task-center-toolbar__bulk .is-danger {
  color: var(--color-danger-strong);
}

.task-center-toolbar__spacer {
  flex: 1;
}

@media (max-width: 899px) {
  .task-center-toolbar {
    padding-inline: var(--space-4);
  }

  .task-center-toolbar__filters {
    width: 100%;
  }

  .task-center-toolbar__search {
    flex: 1 1 180px;
    width: auto;
  }
}
</style>
