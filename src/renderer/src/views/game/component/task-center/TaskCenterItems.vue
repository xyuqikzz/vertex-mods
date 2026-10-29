<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxProgress } from '@renderer/component/vertex-ui'
import TaskCenterStatePill from './TaskCenterStatePill.vue'

const props = defineProps({
  task: { type: Object, required: true },
  detail: { type: Object, default: () => ({}) }
})
const { t, te } = useI18n()

// 任务项标题、版本和失败原因来自来源平台与主进程，按原文展示。
const items = computed(() => {
  if (props.task?.kind === 'legacy') {
    return (Array.isArray(props.task?.raw?.mods) ? props.task.raw.mods : []).map((item, index) => ({
      id: item.id || index,
      title: item.modName || item.name || `#${index + 1}`,
      version: item.version || item.modVersion || '',
      type: 'main',
      state: 'cancelled',
      progress: props.task.progress,
      error: props.task.raw?.errorMsg || ''
    }))
  }
  return (Array.isArray(props.detail?.items) ? props.detail.items : []).map((item, index) => ({
    id: item.item_id || index,
    title: item.title || `#${index + 1}`,
    version: item.version || '',
    type: item.item_type || 'main',
    state: item.state || '',
    progress: Math.max(0, Math.min(100, Number(item.progress || 0))),
    error: item.error_message || item.failure?.message || ''
  }))
})

function stateLabel(state = '') {
  const key = `taskCenter.itemStates.${state}`
  return state && te(key) ? t(key) : state || t('taskCenter.states.unknown')
}

function stateTone(state = '') {
  if (['installed', 'file_ready', 'skipped_installed', 'completed'].includes(state))
    return 'success'
  if (['failed', 'precheck_blocked'].includes(state)) return 'danger'
  if (
    ['waiting_dependency', 'waiting_authorization', 'authenticating', 'waiting'].includes(state)
  ) {
    return 'warning'
  }
  if (['waiting_artifact', 'waiting_install', 'skipped', 'cancelled'].includes(state))
    return 'muted'
  return 'info'
}

function showProgress(item = {}) {
  return item.progress > 0 && item.progress < 100 && stateTone(item.state) === 'info'
}
</script>

<template>
  <div class="task-center-items">
    <div v-if="!items.length" class="task-center-items__empty">
      {{ t('taskCenter.detail.noItems') }}
    </div>
    <template v-else>
      <article v-for="item in items" :key="item.id" class="task-center-items__item">
        <div class="task-center-items__heading">
          <div>
            <strong>{{ item.title }}</strong>
            <span v-if="item.version">{{
              t('taskCenter.detail.version', { version: item.version })
            }}</span>
          </div>
          <div class="task-center-items__badges">
            <TaskCenterStatePill v-if="item.type !== 'main'" tone="muted">{{
              t('taskCenter.detail.dependency')
            }}</TaskCenterStatePill>
            <TaskCenterStatePill :tone="stateTone(item.state)">{{
              stateLabel(item.state)
            }}</TaskCenterStatePill>
          </div>
        </div>
        <div v-if="showProgress(item)" class="task-center-items__progress">
          <VxProgress
            :value="item.progress"
            role="progressbar"
            :aria-label="
              t('taskCenter.table.progressLabel', { title: item.title, progress: item.progress })
            "
          />
        </div>
        <p v-if="item.error">{{ item.error }}</p>
      </article>
    </template>
  </div>
</template>

<style scoped lang="scss">
.task-center-items {
  display: grid;
  gap: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.task-center-items__item {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-surface-hover);
}

.task-center-items__item:last-child {
  border-bottom: 0;
}

.task-center-items__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.task-center-items__badges {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.task-center-items__heading > div:first-child {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.task-center-items__heading strong {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.task-center-items__heading > div:first-child > span,
.task-center-items__item p,
.task-center-items__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.task-center-items__item p {
  color: var(--color-danger-strong);
  overflow-wrap: anywhere;
}

.task-center-items__progress {
  width: 100%;
}

.task-center-items__progress :deep(.vx-progress) {
  width: 100%;
  height: 6px;
}

.task-center-items__empty {
  padding: var(--space-8);
  text-align: center;
}
</style>
