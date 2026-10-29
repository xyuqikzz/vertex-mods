<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import ipcRenderer from '@renderer/common/ipcRenderer.js'

const props = defineProps({
  task: { type: Object, required: true },
  detail: { type: Object, default: () => ({}) }
})
const { t, locale } = useI18n()

const failure = computed(() => {
  if (props.detail?.failure && typeof props.detail.failure === 'object') return props.detail.failure
  if (props.task?.raw?.failure && typeof props.task.raw.failure === 'object')
    return props.task.raw.failure
  const raw = String(props.task?.raw?.failure_json || '').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
})

const waitingAuthorization = computed(() =>
  Number(props.detail?.nexusAuthorization?.waitingCount || 0)
)

const summaryTone = computed(() => {
  if (failure.value.message || props.task?.stateGroup === 'failed') return 'danger'
  if (props.task?.stateGroup === 'attention') return 'warning'
  if (props.task?.state === 'completed_with_warning') return 'warning'
  if (props.task?.stateGroup === 'completed') return 'success'
  return 'info'
})

// 失败原因、用户操作提示和当前步骤来自主进程，按原文展示；其余说明走语言资源。
const summaryTitle = computed(() => {
  if (waitingAuthorization.value > 0) return t('taskCenter.detail.waitingAuthTitle')
  if (failure.value.message) return failure.value.message
  if (props.task?.kind === 'legacy') return t('taskCenter.states.legacy')
  if (props.task?.stateGroup === 'completed') return t('taskCenter.detail.completedTitle')
  if (props.task?.stateGroup === 'attention') {
    return props.task.stepText || t('taskCenter.detail.attentionFallback')
  }
  return props.task?.stepText || t(`taskCenter.states.${props.task?.stateKey || 'unknown'}`)
})

const summaryDescription = computed(() => {
  if (waitingAuthorization.value > 0) {
    return t('taskCenter.detail.waitingAuthText', { count: waitingAuthorization.value })
  }
  if (failure.value.userAction || failure.value.user_action) {
    return failure.value.userAction || failure.value.user_action
  }
  if (props.task?.raw?.error_message) return props.task.raw.error_message
  if (props.task?.kind === 'legacy') return t('taskCenter.detail.legacyText')
  if (props.task?.stateGroup === 'completed') {
    const items = props.detail?.items || []
    if (items.length && items.every((item) => item.state === 'file_ready')) {
      return t('taskCenter.detail.fileReady')
    }
    return t('taskCenter.detail.allDone')
  }
  if (props.task?.stateGroup === 'attention') return t('taskCenter.detail.attentionHint')
  if (props.task?.itemTotal > 0) {
    return t('taskCenter.detail.processed', {
      done: props.task.itemCompleted,
      total: props.task.itemTotal
    })
  }
  return t('taskCenter.detail.autoUpdate')
})

const summaryIcon = computed(
  () => ({ success: 'check', warning: 'warning', danger: 'error' })[summaryTone.value] || 'info'
)

const downloadedArtifacts = computed(() =>
  (props.detail?.artifacts || []).filter(
    (artifact) => artifact.state === 'downloaded' && artifact.file_path
  )
)

const checks = computed(() => {
  const precheckChecks = Array.isArray(props.detail?.precheck?.checks)
    ? props.detail.precheck.checks
    : []
  const healthChecks = Array.isArray(props.detail?.health?.checks) ? props.detail.health.checks : []
  return [...precheckChecks, ...healthChecks].slice(0, 6).map((check, index) => {
    const status = String(check?.status || '').toLowerCase()
    const tone = ['passed', 'success', 'ok', 'completed'].includes(status)
      ? 'success'
      : ['failed', 'error', 'blocked'].includes(status)
        ? 'danger'
        : ['warning', 'attention', 'pending'].includes(status)
          ? 'warning'
          : 'info'
    return {
      id: check?.key || check?.id || index,
      title:
        check?.title ||
        check?.name ||
        check?.key ||
        t('taskCenter.detail.checkFallback', { index: index + 1 }),
      message: check?.message || check?.summary || '',
      tone,
      statusLabel:
        tone === 'success'
          ? t('taskCenter.detail.checkPassed')
          : tone === 'danger'
            ? t('taskCenter.detail.checkFailed')
            : tone === 'warning'
              ? t('taskCenter.detail.checkWarning')
              : t('taskCenter.detail.checkDone')
    }
  })
})

const checkSectionTitle = computed(() =>
  Array.isArray(props.detail?.precheck?.checks) && props.detail.precheck.checks.length
    ? t('taskCenter.detail.checksPrecheck')
    : t('taskCenter.detail.checksHealth')
)

function checkIcon(tone = '') {
  return { success: 'check', warning: 'warning', danger: 'error' }[tone] || 'info'
}

function formatTime(value = '') {
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) || date.getTime() <= 0
    ? '—'
    : date.toLocaleString(locale.value, { hour12: false })
}
</script>

<template>
  <div class="task-center-overview">
    <section
      class="task-center-overview__summary"
      :class="`task-center-overview__summary--${summaryTone}`"
    >
      <ToolIcon :name="summaryIcon" :size="18" />
      <div>
        <strong>{{ summaryTitle }}</strong>
        <p>{{ summaryDescription }}</p>
        <code v-if="failure.code">{{ failure.code }}</code>
      </div>
    </section>

    <div v-if="downloadedArtifacts.length" class="task-center-overview__downloads">
      <VxButton
        v-for="artifact in downloadedArtifacts"
        :key="artifact.artifact_key"
        variant="secondary"
        @click="ipcRenderer.send('openSpecifyPath', String(artifact.file_path))"
      >
        {{
          downloadedArtifacts.length > 1
            ? t('taskCenter.detail.openDownloadNamed', { name: artifact.file_name })
            : t('taskCenter.detail.openDownload')
        }}
      </VxButton>
    </div>
    <dl class="task-center-overview__facts">
      <div>
        <dt>{{ t('taskCenter.detail.facts.game') }}</dt>
        <dd>{{ task.gameName || t('taskCenter.unknownGame') }}</dd>
      </div>
      <div>
        <dt>{{ t('taskCenter.detail.facts.source') }}</dt>
        <dd>{{ task.source?.label || task.source?.key }}</dd>
      </div>
      <div>
        <dt>{{ t('taskCenter.detail.facts.created') }}</dt>
        <dd>{{ formatTime(task.createdAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('taskCenter.detail.facts.updated') }}</dt>
        <dd>{{ formatTime(task.updatedAt) }}</dd>
      </div>
    </dl>

    <section v-if="checks.length" class="task-center-overview__checks">
      <header>
        <h3>{{ checkSectionTitle }}</h3>
        <span>{{ t('taskCenter.detail.checkCount', { count: checks.length }) }}</span>
      </header>
      <ul>
        <li v-for="check in checks" :key="check.id" :class="`is-${check.tone}`">
          <ToolIcon :name="checkIcon(check.tone)" :size="15" />
          <div>
            <strong>{{ check.title }}</strong>
            <span v-if="check.message">{{ check.message }}</span>
          </div>
          <em>{{ check.statusLabel }}</em>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
.task-center-overview {
  display: grid;
  gap: var(--space-5);
}

.task-center-overview__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--color-accent-strong);
  background: color-mix(in srgb, var(--color-accent-soft) 40%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
  border-radius: var(--radius-md);
}

.task-center-overview__summary > .tool-icon {
  margin-top: 2px;
}

.task-center-overview__summary > div {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.task-center-overview__summary strong {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.task-center-overview__summary p,
.task-center-overview__summary code,
.task-center-overview dl,
.task-center-overview dd,
.task-center-overview h3 {
  margin: 0;
}

.task-center-overview__summary p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

.task-center-overview__summary code {
  width: fit-content;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}

.task-center-overview__summary--success {
  color: var(--color-success-strong);
  background: color-mix(in srgb, var(--color-success-soft) 60%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-success) 22%, transparent);
}

.task-center-overview__summary--warning {
  color: var(--color-warning-strong);
  background: color-mix(in srgb, var(--color-warning-soft) 60%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
}

.task-center-overview__summary--danger {
  color: var(--color-danger-strong);
  background: color-mix(in srgb, var(--color-danger-soft) 60%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-danger) 22%, transparent);
}

.task-center-overview__downloads {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.task-center-overview__downloads :deep(.vx-button) {
  max-width: 100%;
  padding-block: var(--space-2);
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: var(--line-height-base);
}

.task-center-overview__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5) var(--space-6);
}

.task-center-overview__facts div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.task-center-overview dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.task-center-overview dd {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.task-center-overview__checks {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.task-center-overview__checks header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.task-center-overview__checks h3 {
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.task-center-overview__checks header span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.task-center-overview__checks ul {
  padding: 0;
  margin: 0;
  list-style: none;
}

.task-center-overview__checks li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  color: var(--color-info);
  border-bottom: 1px solid var(--color-border);
}

.task-center-overview__checks li:last-child {
  border-bottom: 0;
}

.task-center-overview__checks li.is-success {
  color: var(--color-success-strong);
}

.task-center-overview__checks li.is-warning {
  color: var(--color-warning-strong);
}

.task-center-overview__checks li.is-danger {
  color: var(--color-danger-strong);
}

.task-center-overview__checks li > div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.task-center-overview__checks li strong {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-center-overview__checks li span,
.task-center-overview__checks li em {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-style: normal;
}

.task-center-overview__checks li em {
  color: currentColor;
  white-space: nowrap;
}

@media (max-width: 520px) {
  .task-center-overview__facts {
    grid-template-columns: 1fr;
  }
}
</style>
