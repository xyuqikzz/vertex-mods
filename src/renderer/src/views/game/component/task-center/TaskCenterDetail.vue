<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxProgress } from '@renderer/component/vertex-ui'
import { ToolIcon, coverMonogram, coverPlaceholderTone } from '@renderer/component/tool-page'
import TaskCenterDiagnostics from './TaskCenterDiagnostics.vue'
import TaskCenterItems from './TaskCenterItems.vue'
import TaskCenterLogs from './TaskCenterLogs.vue'
import TaskCenterOverview from './TaskCenterOverview.vue'
import TaskCenterComponents from './TaskCenterComponents.vue'
import TaskCenterStatePill from './TaskCenterStatePill.vue'
import {
  deriveTaskStages,
  getPendingComponentItems,
  resolveTaskStateKey,
  resolveTaskTone
} from './task-center-stages.js'
import { canDiagnoseSourceInstallTask } from '../../../../../../shared/installation/install-failure-recovery.js'

const props = defineProps({
  task: { type: Object, required: true },
  detail: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  copying: { type: Boolean, default: false },
  operating: { type: Boolean, default: false }
})

const emit = defineEmits(['action', 'close'])
const { t } = useI18n()
const pendingComponents = computed(() => getPendingComponentItems(props.detail))
const activeTab = ref('overview')
const tabIdPrefix = `task-center-detail-${Math.random().toString(36).slice(2, 8)}`

const itemCount = computed(() =>
  props.task?.kind === 'legacy'
    ? (props.task?.raw?.mods || []).length
    : (props.detail?.items || []).length || Number(props.task?.itemTotal || 0)
)
const logCount = computed(() => (Array.isArray(props.detail?.logs) ? props.detail.logs.length : 0))
const tabs = computed(() => [
  { value: 'overview', label: t('taskCenter.detail.tabs.overview'), count: null },
  { value: 'items', label: t('taskCenter.detail.tabs.items'), count: itemCount.value },
  { value: 'logs', label: t('taskCenter.detail.tabs.logs'), count: logCount.value },
  { value: 'diagnostics', label: t('taskCenter.detail.tabs.diagnostics'), count: null }
])

const stateKey = computed(() => resolveTaskStateKey(props.task, props.detail))
const tone = computed(() => resolveTaskTone(props.task))
const stages = computed(() => deriveTaskStages(props.task, props.detail))
const showProgress = computed(() => props.task?.stateGroup === 'active')
const gameLabel = computed(() => props.task?.gameName || t('taskCenter.unknownGame'))

const progressTone = computed(() => {
  if (props.task?.stateGroup === 'failed') return 'danger'
  if (props.task?.stateGroup === 'attention') return 'warning'
  if (props.task?.stateGroup === 'completed') return 'success'
  return 'primary'
})

const primaryActions = computed(() => {
  const actions = Array.isArray(props.task?.actions) ? props.task.actions : []
  const controlAction = ['authorize', 'legacy_open', 'retry', 'resume', 'pause'].find((action) =>
    actions.includes(action)
  )
  return [
    canDiagnoseSourceInstallTask(props.task) ? 'diagnose' : '',
    pendingComponents.value.length && controlAction === 'retry' ? '' : controlAction,
    actions.includes('view_download') ? 'view_download' : ''
  ].filter(Boolean)
})

const destructiveActions = computed(() => {
  const actions = Array.isArray(props.task?.actions) ? props.task.actions : []
  const result = ['cancel', 'delete'].filter((action) => actions.includes(action))
  if (
    actions.includes('legacy_delete') ||
    (actions.includes('cancel') && !actions.includes('delete'))
  ) {
    result.push('remove')
  }
  return result
})

const stepText = computed(() =>
  props.task?.stepKey
    ? t(props.task.stepKey)
    : props.task?.stepText || t(`taskCenter.states.${stateKey.value}`)
)

function stageStatusText(status = '') {
  return t(`taskCenter.stages.${status}`)
}

function selectTab(value) {
  activeTab.value = value
}

function handleTabKeydown(event, index) {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }
  if (!(event.key in keys)) return
  event.preventDefault()
  const list = tabs.value
  const step = keys[event.key]
  const nextIndex =
    step === 'first'
      ? 0
      : step === 'last'
        ? list.length - 1
        : (index + step + list.length) % list.length
  activeTab.value = list[nextIndex].value
  event.currentTarget.parentElement?.children?.[nextIndex]?.focus()
}

watch(
  () => `${props.task?.kind}:${props.task?.id}`,
  () => {
    activeTab.value = 'overview'
  }
)
</script>

<template>
  <section class="task-center-detail" :aria-busy="loading">
    <header class="task-center-detail__header">
      <div class="task-center-detail__identity">
        <span
          class="task-center-detail__tile"
          :style="{ background: coverPlaceholderTone(task.gameKey || task.gameName || task.title) }"
          aria-hidden="true"
          >{{ coverMonogram(task.gameName || task.title) }}</span
        >
        <div class="task-center-detail__titles">
          <h2>{{ task.title }}</h2>
          <span>{{ gameLabel }} · {{ task.source?.label || task.source?.key }}</span>
        </div>
        <TaskCenterStatePill :tone="tone">{{
          t(`taskCenter.states.${stateKey}`)
        }}</TaskCenterStatePill>
        <VxButton
          class="task-center-detail__close"
          variant="ghost"
          size="sm"
          :aria-label="t('taskCenter.actions.close')"
          :title="t('taskCenter.actions.close')"
          @click="emit('close')"
        >
          <ToolIcon name="close" :size="14" />
        </VxButton>
      </div>

      <ol class="task-center-detail__stages" :aria-label="t('taskCenter.stages.label')">
        <li
          v-for="stage in stages"
          :key="stage.key"
          :class="`is-${stage.status}`"
          :aria-current="
            ['current', 'waiting', 'error'].includes(stage.status) ? 'step' : undefined
          "
        >
          <i aria-hidden="true"></i>
          <span>{{ t(`taskCenter.stages.${stage.key}`) }}</span>
          <span class="task-center-detail__sr">{{ stageStatusText(stage.status) }}</span>
        </li>
      </ol>

      <div v-if="showProgress" class="task-center-detail__progress">
        <div class="task-center-detail__progress-heading">
          <span>{{ stepText }}</span>
          <strong>{{ task.progress }}%</strong>
        </div>
        <VxProgress
          :value="task.progress"
          :tone="progressTone"
          role="progressbar"
          :aria-label="
            t('taskCenter.detail.overallProgress', { title: task.title, progress: task.progress })
          "
        />
      </div>

      <nav
        class="task-center-detail__tabs"
        :aria-label="t('taskCenter.detail.tabsLabel')"
        role="tablist"
      >
        <button
          v-for="(tab, index) in tabs"
          :id="`${tabIdPrefix}-tab-${tab.value}`"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.value"
          :aria-controls="`${tabIdPrefix}-panel`"
          :tabindex="activeTab === tab.value ? 0 : -1"
          :class="{ 'is-active': activeTab === tab.value }"
          @click="selectTab(tab.value)"
          @keydown="handleTabKeydown($event, index)"
        >
          {{ tab.label
          }}<span v-if="tab.count" class="task-center-detail__tab-count">{{ tab.count }}</span>
        </button>
      </nav>
    </header>

    <div
      :id="`${tabIdPrefix}-panel`"
      class="task-center-detail__body vx-ui-scrollbar"
      role="tabpanel"
      :aria-labelledby="`${tabIdPrefix}-tab-${activeTab}`"
    >
      <div v-if="loading" class="task-center-detail__loading" role="status">
        {{ t('taskCenter.detail.loading') }}
      </div>
      <template v-else-if="activeTab === 'overview'">
        <TaskCenterComponents
          v-if="pendingComponents.length"
          :items="pendingComponents"
          :operating="operating"
          @submit="emit('action', 'retry', task, { componentSelections: $event })"
        />
        <TaskCenterOverview v-else :task="task" :detail="detail" />
      </template>
      <TaskCenterItems v-else-if="activeTab === 'items'" :task="task" :detail="detail" />
      <TaskCenterLogs v-else-if="activeTab === 'logs'" :logs="detail.logs || []" />
      <TaskCenterDiagnostics
        v-else-if="activeTab === 'diagnostics'"
        :task="task"
        :detail="detail"
        :copying="copying"
        @action="emit('action', $event, task)"
      />
    </div>

    <footer class="task-center-detail__footer" :aria-label="t('taskCenter.detail.actionsLabel')">
      <div v-if="primaryActions.length" class="task-center-detail__primary-actions">
        <VxButton
          v-for="(action, index) in primaryActions"
          :key="action"
          :variant="index === 0 ? 'primary' : 'secondary'"
          :loading="operating"
          @click="emit('action', action, task)"
        >
          {{ t(`taskCenter.actions.${action}`) }}
        </VxButton>
      </div>
      <VxButton
        v-if="task.kind === 'source'"
        variant="ghost"
        :loading="copying"
        @click="emit('action', 'copy_diagnostics', task)"
      >
        {{ t('taskCenter.actions.copy_diagnostics') }}
      </VxButton>
      <span class="task-center-detail__spacer"></span>
      <div v-if="destructiveActions.length" class="task-center-detail__destructive-actions">
        <VxButton
          v-for="action in destructiveActions"
          :key="action"
          variant="ghost"
          class="task-center-detail__danger-action"
          :loading="operating"
          @click="emit('action', action, task)"
        >
          {{ t(`taskCenter.actions.${action}`) }}
        </VxButton>
      </div>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.task-center-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  color: var(--color-text);
  font-family: var(--font-family-base);
  background: var(--color-surface);
}

.task-center-detail__header {
  display: grid;
  flex: 0 0 auto;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-4) 0 var(--space-6);
  border-bottom: 1px solid var(--color-surface-strong);
}

.task-center-detail__identity {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

.task-center-detail__tile {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--color-white);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-md);
}

.task-center-detail__titles {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.task-center-detail__titles h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.task-center-detail__titles span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.task-center-detail__identity :deep(.task-state-pill) {
  margin-top: 2px;
}

.task-center-detail__close {
  flex: 0 0 auto;
  width: 32px;
  padding: 0;
}

.task-center-detail__stages {
  display: flex;
  gap: 6px;
  padding: 0;
  margin: 0 var(--space-2) 0 0;
  list-style: none;
}

.task-center-detail__stages li {
  display: grid;
  flex: 1;
  gap: 6px;
  justify-items: center;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 11.5px;
  text-align: center;
}

.task-center-detail__stages li > span {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.task-center-detail__stages i {
  display: block;
  width: 100%;
  height: 4px;
  background: var(--color-surface-strong);
  border-radius: 2px;
}

.task-center-detail__stages .is-done {
  color: var(--color-text-secondary);

  i {
    background: var(--color-success);
  }
}

.task-center-detail__stages .is-current {
  color: var(--color-accent-strong);
  font-weight: var(--font-weight-semibold);

  i {
    background: var(--color-accent);
  }
}

.task-center-detail__stages .is-waiting {
  color: var(--color-warning-strong);
  font-weight: var(--font-weight-semibold);

  i {
    background: var(--color-warning);
  }
}

.task-center-detail__stages .is-error {
  color: var(--color-danger-strong);
  font-weight: var(--font-weight-semibold);

  i {
    background: var(--color-danger);
  }
}

.task-center-detail__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.task-center-detail__progress {
  display: grid;
  gap: var(--space-2);
  margin-right: var(--space-2);
}

.task-center-detail__progress-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.task-center-detail__progress-heading strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
}

.task-center-detail__header :deep(.vx-progress) {
  width: 100%;
  height: 6px;
}

.task-center-detail__tabs {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  min-height: 40px;
}

.task-center-detail__tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: stretch;
  padding: 0 2px;
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background: transparent;
  border: 0;
  outline: none;
  cursor: pointer;
}

.task-center-detail__tabs button::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: transparent;
  border-radius: 2px;
  content: '';
}

.task-center-detail__tabs button:hover {
  color: var(--color-text);
}

.task-center-detail__tabs button.is-active {
  color: var(--color-accent-strong);
  font-weight: var(--font-weight-semibold);
}

.task-center-detail__tabs button.is-active::after {
  background: var(--color-accent);
}

.task-center-detail__tabs button:focus-visible {
  box-shadow: var(--focus-ring);
}

.task-center-detail__tab-count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}

.task-center-detail__body {
  flex: 1;
  min-height: 0;
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
}

.task-center-detail__footer {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
  background: var(--color-surface);
  border-top: 1px solid var(--color-surface-strong);
}

.task-center-detail__primary-actions,
.task-center-detail__destructive-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.task-center-detail__spacer {
  flex: 1;
}

.task-center-detail__danger-action {
  color: var(--color-danger-strong);
}

.task-center-detail__danger-action:hover:not(:disabled) {
  color: var(--color-danger-strong);
  background: var(--color-danger-soft);
}

.task-center-detail__loading {
  display: grid;
  min-height: 240px;
  place-content: center;
  color: var(--color-text-muted);
}
</style>
