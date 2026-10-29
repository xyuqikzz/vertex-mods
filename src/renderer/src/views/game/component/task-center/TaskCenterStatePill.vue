<script setup>
// 任务状态胶囊：圆点 + 文字，不只靠颜色表达状态。
defineProps({
  tone: { type: String, default: 'info' }
})
</script>

<template>
  <span class="task-state-pill" :class="`is-${tone}`">
    <span class="task-state-pill__dot" aria-hidden="true"></span>
    <slot></slot>
  </span>
</template>

<style scoped lang="scss">
.task-state-pill {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 22px;
  padding: 0 var(--space-2);
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--color-surface-hover);
  border-radius: var(--radius-pill);

  &.is-info {
    color: var(--color-accent-strong);
    background: color-mix(in srgb, var(--color-accent-soft) 60%, var(--color-surface));
  }

  &.is-warning {
    color: var(--color-warning-strong);
    background: var(--color-warning-soft);
  }

  &.is-danger {
    color: var(--color-danger-strong);
    background: var(--color-danger-soft);
  }

  &.is-success {
    color: var(--color-success-strong);
    background: var(--color-success-soft);
  }

  &.is-muted {
    color: var(--color-text-tertiary);
    background: var(--color-surface-hover);
  }
}

.task-state-pill__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: 50%;
}
</style>
