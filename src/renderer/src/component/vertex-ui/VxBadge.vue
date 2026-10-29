<script setup>
defineProps({
  tone: { type: String, default: 'info' }
})
</script>

<template>
  <span class="vx-badge" :class="`vx-badge-${tone}`">
    <slot></slot>
  </span>
</template>

<style scoped lang="scss">
.vx-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  border-radius: var(--radius-sm);
}

.vx-badge-info {
  color: var(--color-info);
  background: var(--color-info-soft);
}

.vx-badge-success {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.vx-badge-warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

.vx-badge-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}
</style>
