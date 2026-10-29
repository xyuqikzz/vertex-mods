<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  logs: { type: Array, default: () => [] }
})
const { t, locale } = useI18n()

const LEVEL_TONE = Object.freeze({
  error: 'is-error',
  fatal: 'is-error',
  warn: 'is-warning',
  warning: 'is-warning'
})

// 日志正文、级别名称是主进程写入的原始内容，按原样展示。
const rows = computed(() =>
  props.logs.map((log, index) => {
    const level = String(log?.level || 'info').toLowerCase()
    return {
      key: log?.id || `${log?.created_at || ''}:${index}`,
      time: formatTime(log?.created_at),
      level,
      tone: LEVEL_TONE[level] || '',
      message: String(log?.message || '')
    }
  })
)

function formatTime(value = '') {
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return String(value || '')
  return date.toLocaleTimeString(locale.value, { hour12: false })
}
</script>

<template>
  <div class="task-center-logs">
    <p v-if="!rows.length" class="task-center-logs__empty">
      {{ t('taskCenter.detail.logsEmpty') }}
    </p>
    <template v-else>
      <p class="task-center-logs__count">
        {{ t('taskCenter.detail.logsCount', { count: rows.length }) }}
      </p>
      <ol
        class="task-center-logs__list vx-ui-scrollbar"
        tabindex="0"
        :aria-label="t('taskCenter.detail.tabs.logs')"
      >
        <li v-for="row in rows" :key="row.key" :class="row.tone">
          <time>{{ row.time }}</time>
          <span class="task-center-logs__level">{{ row.level }}</span>
          <span class="task-center-logs__message">{{ row.message }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped lang="scss">
.task-center-logs {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.task-center-logs__empty,
.task-center-logs__count {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.task-center-logs__empty {
  padding: var(--space-8) 0;
  font-size: var(--font-size-sm);
  text-align: center;
}

.task-center-logs__list {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

.task-center-logs__list li {
  display: grid;
  grid-template-columns: 72px 52px minmax(0, 1fr);
  gap: var(--space-2);
  padding: 6px var(--space-3);
  font-family: var(--font-family-mono);
  font-size: 11.5px;
  line-height: var(--line-height-base);
  border-bottom: 1px solid var(--color-surface-hover);

  &:last-child {
    border-bottom: 0;
  }

  &.is-warning {
    background: color-mix(in srgb, var(--color-warning-soft) 45%, var(--color-surface));
  }

  &.is-error {
    background: color-mix(in srgb, var(--color-danger-soft) 55%, var(--color-surface));
  }
}

.task-center-logs__list time {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.task-center-logs__level {
  color: var(--color-text-muted);

  .is-warning & {
    color: var(--color-warning-strong);
    font-weight: var(--font-weight-semibold);
  }

  .is-error & {
    color: var(--color-danger-strong);
    font-weight: var(--font-weight-semibold);
  }
}

.task-center-logs__message {
  min-width: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
