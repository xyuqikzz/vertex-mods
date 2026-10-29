<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import { formatTaskCenterDiagnosticPreview } from './task-center-diagnostic-preview'

const props = defineProps({
  task: { type: Object, required: true },
  detail: { type: Object, default: () => ({}) },
  copying: { type: Boolean, default: false }
})

const emit = defineEmits(['action'])
const { t } = useI18n()

const logs = computed(() => (Array.isArray(props.detail?.logs) ? props.detail.logs : []))
const openSections = ref(new Set())
const precheckPreview = computed(() =>
  formatTaskCenterDiagnosticPreview({
    precheck: props.detail?.precheck,
    failure: props.detail?.failure
  })
)
const planPreview = computed(() =>
  formatTaskCenterDiagnosticPreview({
    items: props.detail?.items,
    health: props.detail?.health
  })
)
const artifactsPreview = computed(() =>
  formatTaskCenterDiagnosticPreview(props.detail?.artifacts || [])
)
const diagnosticPreview = computed(() =>
  formatTaskCenterDiagnosticPreview({
    task: props.detail?.job || props.task?.raw || {},
    precheck: props.detail?.precheck || {},
    failure: props.detail?.failure || {},
    health: props.detail?.health || {},
    items: props.detail?.items || [],
    artifacts: props.detail?.artifacts || [],
    logs: logs.value
  })
)

watch(
  () => props.task?.id,
  () => {
    openSections.value = new Set()
  }
)

function isSectionOpen(section) {
  return openSections.value.has(section)
}

function handleSectionToggle(section, event) {
  const nextSections = new Set(openSections.value)
  if (event.currentTarget?.open) nextSections.add(section)
  else nextSections.delete(section)
  openSections.value = nextSections
}
</script>

<template>
  <div class="task-center-diagnostics">
    <div class="task-center-diagnostics__intro">
      <ToolIcon name="info" :size="15" />
      <p>{{ t('taskCenter.diagnostics.intro') }}</p>
      <VxButton
        class="task-center-diagnostics__copy"
        variant="secondary"
        size="sm"
        :loading="copying"
        @click="emit('action', 'copy_diagnostics', task)"
      >
        <ToolIcon name="copy" :size="14" />
        <span>{{ t('taskCenter.diagnostics.copy') }}</span>
      </VxButton>
    </div>

    <details :open="isSectionOpen('precheck')" @toggle="handleSectionToggle('precheck', $event)">
      <summary>
        <span>{{ t('taskCenter.diagnostics.precheck') }}</span>
      </summary>
      <pre
        v-if="isSectionOpen('precheck')"
        class="vx-ui-scrollbar"
        tabindex="0"
        :aria-label="t('taskCenter.diagnostics.precheck')"
        >{{ precheckPreview }}</pre
      >
    </details>
    <details :open="isSectionOpen('plan')" @toggle="handleSectionToggle('plan', $event)">
      <summary>
        <span>{{ t('taskCenter.diagnostics.plan') }}</span>
      </summary>
      <pre
        v-if="isSectionOpen('plan')"
        class="vx-ui-scrollbar"
        tabindex="0"
        :aria-label="t('taskCenter.diagnostics.plan')"
        >{{ planPreview }}</pre
      >
    </details>
    <details :open="isSectionOpen('artifacts')" @toggle="handleSectionToggle('artifacts', $event)">
      <summary>
        <span>{{ t('taskCenter.diagnostics.artifacts') }}</span>
      </summary>
      <pre
        v-if="isSectionOpen('artifacts')"
        class="vx-ui-scrollbar"
        tabindex="0"
        :aria-label="t('taskCenter.diagnostics.artifacts')"
        >{{ artifactsPreview }}</pre
      >
    </details>
    <details :open="isSectionOpen('debug')" @toggle="handleSectionToggle('debug', $event)">
      <summary>
        <span>{{ t('taskCenter.diagnostics.debug') }}</span>
      </summary>
      <pre
        v-if="isSectionOpen('debug')"
        class="vx-ui-scrollbar"
        tabindex="0"
        :aria-label="t('taskCenter.diagnostics.debug')"
        >{{ diagnosticPreview }}</pre
      >
    </details>
  </div>
</template>

<style scoped lang="scss">
.task-center-diagnostics {
  display: grid;
  min-width: 0;
  gap: var(--space-3);
}

.task-center-diagnostics__intro,
.task-center-diagnostics details {
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.task-center-diagnostics__intro {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
  color: var(--color-info);
  background: var(--color-surface-soft);
}

.task-center-diagnostics__intro p {
  max-width: 68ch;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.task-center-diagnostics__copy {
  grid-column: 2;
  justify-self: start;
}

.task-center-diagnostics__copy :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.task-center-diagnostics summary {
  padding-block: var(--space-1);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-base);
  cursor: pointer;
  outline: none;
}

.task-center-diagnostics summary > span {
  margin-inline-start: var(--space-2);
}

.task-center-diagnostics details[open] > summary {
  margin-bottom: var(--space-3);
}

.task-center-diagnostics details[open] {
  background: var(--color-surface-soft);
}

.task-center-diagnostics summary:focus-visible,
.task-center-diagnostics pre:focus-visible {
  box-shadow: var(--focus-ring);
}

.task-center-diagnostics pre {
  min-width: 0;
  max-height: 320px;
  margin: 0;
  padding: var(--space-3);
  overflow: auto;
  box-sizing: border-box;
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-relaxed);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}
</style>
