<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxCheckbox, VxProgress } from '@renderer/component/vertex-ui'
import { ToolEmpty, coverMonogram, coverPlaceholderTone } from '@renderer/component/tool-page'
import TaskCenterStatePill from './TaskCenterStatePill.vue'
import { resolveTaskRowAction, resolveTaskStateKey, resolveTaskTone } from './task-center-stages.js'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  activeId: { type: [String, Number], default: '' },
  selectedIds: { type: Array, default: () => [] },
  operatingIds: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  filtered: { type: Boolean, default: false },
  emptyTitle: { type: String, default: '' },
  emptyText: { type: String, default: '' }
})

const emit = defineEmits(['open', 'action', 'toggle-selection', 'toggle-all', 'clear-filters'])
const { t, locale } = useI18n()
const selectedSet = computed(() => new Set(props.selectedIds.map(String)))
const operatingSet = computed(() => new Set(props.operatingIds.map(String)))
const selectableTasks = computed(() => props.tasks.filter(isSelectable))
const allSelected = computed(
  () =>
    selectableTasks.value.length > 0 &&
    selectableTasks.value.every((task) => selectedSet.value.has(String(task.id)))
)

function isSelectable(task = {}) {
  return task.kind === 'source' && Boolean(task.id)
}

function gameLabel(task = {}) {
  return task.gameName || t('taskCenter.unknownGame')
}

function tileStyle(task = {}) {
  return { background: coverPlaceholderTone(task.gameKey || task.gameName || task.title) }
}

function tileText(task = {}) {
  return coverMonogram(task.gameName || task.title)
}

function stateText(task = {}) {
  return t(`taskCenter.states.${resolveTaskStateKey(task)}`)
}

function subline(task = {}) {
  if (task.stepKey) return t(task.stepKey)
  const deps = Math.max(0, Number(task.itemTotal || 0) - 1)
  if (task.stateGroup === 'active' && task.itemTotal > 1) {
    return [
      deps > 0 ? t('taskCenter.table.deps', { count: deps }) : '',
      t('taskCenter.table.itemProgress', { done: task.itemCompleted, total: task.itemTotal })
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (task.attention && task.stepText) return task.stepText
  if (deps > 0) return t('taskCenter.table.deps', { count: deps })
  return task.stepText || ''
}

function sublineTone(task = {}) {
  if (task.stateGroup === 'failed') return 'is-danger'
  if (task.stateGroup === 'attention') return 'is-warning'
  return ''
}

function rowAction(task = {}) {
  return resolveTaskRowAction(task)
}

function runRowAction(task = {}) {
  const action = rowAction(task)
  if (action === 'handle') emit('open', task)
  else emit('action', action, task)
}

function formatUpdated(value = '') {
  const timestamp = new Date(value || 0).getTime()
  if (!Number.isFinite(timestamp) || timestamp <= 0) return t('taskCenter.table.none')
  const diff = Math.max(0, Date.now() - timestamp)
  if (diff < 60_000) return t('taskCenter.table.justNow')
  if (diff < 3_600_000)
    return t('taskCenter.table.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) {
    return t('taskCenter.table.hoursAgo', { count: Math.floor(diff / 3_600_000) })
  }
  return new Date(timestamp).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
}

function formatFullTime(value = '') {
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale.value, { hour12: false })
}
</script>

<template>
  <div class="task-center-table vx-ui-scrollbar">
    <div v-if="loading && !tasks.length" class="task-center-table__loading" role="status">
      {{ t('taskCenter.table.loading') }}
    </div>
    <div v-else-if="!tasks.length" class="task-center-table__empty" role="status">
      <ToolEmpty
        :icon="filtered ? 'search' : 'list'"
        :title="filtered ? t('taskCenter.table.filtered') : emptyTitle"
        :description="filtered ? t('taskCenter.table.filteredHint') : emptyText"
        compact
      >
        <VxButton v-if="filtered" variant="secondary" size="sm" @click="emit('clear-filters')">{{
          t('taskCenter.table.clearFilters')
        }}</VxButton>
      </ToolEmpty>
    </div>
    <table v-else class="task-center-table__grid" :aria-label="t('taskCenter.table.label')">
      <thead>
        <tr>
          <th scope="col" class="task-center-table__select-cell task-center-table__col-select">
            <VxCheckbox
              v-if="selectableTasks.length"
              class="task-center-table__selection"
              :model-value="allSelected"
              :label="t('taskCenter.table.selectAll')"
              @update:model-value="emit('toggle-all', $event)"
            />
          </th>
          <th scope="col" class="task-center-table__col-task">{{ t('taskCenter.table.task') }}</th>
          <th scope="col" class="task-center-table__game task-center-table__col-game">
            {{ t('taskCenter.table.game') }}
          </th>
          <th scope="col" class="task-center-table__source task-center-table__col-source">
            {{ t('taskCenter.table.source') }}
          </th>
          <th scope="col" class="task-center-table__col-state">
            {{ t('taskCenter.table.state') }}
          </th>
          <th scope="col" class="task-center-table__progress task-center-table__col-progress">
            {{ t('taskCenter.table.progress') }}
          </th>
          <th scope="col" class="task-center-table__updated task-center-table__col-updated">
            {{ t('taskCenter.table.updated') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="task in tasks"
          :key="`${task.kind}:${task.id}`"
          class="task-center-table__row"
          :class="{
            'is-active': String(activeId) === String(task.id),
            'is-selected': selectedSet.has(String(task.id))
          }"
        >
          <td class="task-center-table__select-cell">
            <VxCheckbox
              v-if="isSelectable(task)"
              class="task-center-table__selection"
              :model-value="selectedSet.has(String(task.id))"
              :label="t('taskCenter.table.select', { title: task.title })"
              @update:model-value="emit('toggle-selection', task, $event)"
            />
          </td>
          <td class="task-center-table__task">
            <button
              type="button"
              class="task-center-table__open"
              :aria-label="t('taskCenter.table.open', { title: task.title })"
              :aria-pressed="String(activeId) === String(task.id)"
              @click="emit('open', task)"
            >
              <span class="task-center-table__tile" :style="tileStyle(task)" aria-hidden="true">{{
                tileText(task)
              }}</span>
              <span class="task-center-table__identity">
                <strong :title="task.title">{{ task.title }}</strong>
                <span
                  v-if="subline(task)"
                  class="task-center-table__step"
                  :class="sublineTone(task)"
                  >{{ subline(task) }}</span
                >
              </span>
            </button>
          </td>
          <td class="task-center-table__game" :title="gameLabel(task)">{{ gameLabel(task) }}</td>
          <td class="task-center-table__source">
            {{ task.source?.label || task.source?.key }}
          </td>
          <td>
            <TaskCenterStatePill :tone="resolveTaskTone(task)">{{
              stateText(task)
            }}</TaskCenterStatePill>
          </td>
          <td class="task-center-table__progress">
            <VxButton
              v-if="rowAction(task)"
              :variant="
                ['authorize', 'resume', 'handle'].includes(rowAction(task))
                  ? 'primary'
                  : 'secondary'
              "
              size="sm"
              :loading="operatingSet.has(String(task.id))"
              :aria-label="
                t('taskCenter.table.actionLabel', {
                  action: t(`taskCenter.actions.${rowAction(task)}`),
                  title: task.title
                })
              "
              @click="runRowAction(task)"
              >{{ t(`taskCenter.actions.${rowAction(task)}`) }}</VxButton
            >
            <span v-else-if="task.stateGroup === 'active'" class="task-center-table__meter">
              <VxProgress
                :value="task.progress"
                role="progressbar"
                :aria-label="
                  t('taskCenter.table.progressLabel', {
                    title: task.title,
                    progress: task.progress
                  })
                "
              />
              <b>{{
                task.state === 'queued' ? t('taskCenter.table.none') : `${task.progress}%`
              }}</b>
            </span>
            <span
              v-else-if="task.stateGroup === 'completed' && task.itemTotal > 0"
              class="is-muted"
            >
              {{ t('taskCenter.table.items', { count: task.itemTotal }) }}
            </span>
            <span v-else class="is-muted">{{ t('taskCenter.table.none') }}</span>
          </td>
          <td class="task-center-table__updated is-muted" :title="formatFullTime(task.updatedAt)">
            {{ formatUpdated(task.updatedAt) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped lang="scss">
.task-center-table {
  container-type: inline-size;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  margin: 0 var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-surface-strong);
  border-radius: 10px;
}

.task-center-table__loading {
  display: grid;
  place-items: center;
  min-height: 240px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.task-center-table__grid {
  width: 100%;
  min-width: 300px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.task-center-table__col-select {
  width: 44px;
}

.task-center-table__col-game {
  width: 150px;
}

.task-center-table__col-source {
  width: 112px;
}

.task-center-table__col-state {
  width: 124px;
}

.task-center-table__col-progress {
  width: 176px;
}

.task-center-table__col-updated {
  width: 96px;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 36px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-align: left;
  white-space: nowrap;
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-surface-strong);
}

td {
  height: 56px;
  padding: 0 var(--space-2);
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: middle;
  border-bottom: 1px solid var(--color-surface-hover);
}

.task-center-table__select-cell {
  padding-left: var(--space-3);
  padding-right: 0;
}

.task-center-table__row:hover td {
  background: var(--color-surface-hover);
}

.task-center-table__row.is-selected td {
  background: color-mix(in srgb, var(--color-accent-soft) 30%, var(--color-surface));
}

.task-center-table__row.is-active td {
  background: color-mix(in srgb, var(--color-accent-soft) 50%, var(--color-surface));
}

.task-center-table__row.is-active td:first-child {
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.task-center-table__row:last-child td {
  border-bottom: 0;
}

.task-center-table__open {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  padding: var(--space-2) 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
}

.task-center-table__tile {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--color-white);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-sm);
}

.task-center-table__identity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.task-center-table__identity strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
}

.task-center-table__step {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
  text-overflow: ellipsis;

  &.is-warning {
    color: var(--color-warning-strong);
  }

  &.is-danger {
    color: var(--color-danger-strong);
  }
}

.task-center-table__meter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.task-center-table__meter :deep(.vx-progress) {
  flex: 1;
  min-width: 0;
}

.task-center-table__meter b {
  width: 36px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.is-muted {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.task-center-table__selection {
  min-height: auto;
  padding-block: 0;
}

.task-center-table__selection :deep(span) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.task-center-table__empty {
  display: grid;
  place-items: center;
  min-height: 280px;
}

@media (max-width: 899px) {
  .task-center-table {
    margin-inline: var(--space-4);
  }
}

// 按表格自身宽度逐级收起次要列：来源、更新 → 游戏 → 进度。行内主操作在详情抽屉里同样可用。
@container (max-width: 980px) {
  .task-center-table__source,
  .task-center-table__updated {
    display: none;
  }
}

@container (max-width: 720px) {
  .task-center-table__game {
    display: none;
  }

  .task-center-table__col-progress {
    width: 148px;
  }
}

@container (max-width: 520px) {
  .task-center-table__progress {
    display: none;
  }
}
</style>
