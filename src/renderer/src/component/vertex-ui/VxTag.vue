<script setup>
defineProps({
  tone: { type: String, default: 'default' },
  size: { type: String, default: 'md' },
  closable: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])
</script>

<template>
  <span class="vx-tag" :class="[`vx-tag-${tone}`, `vx-tag-${size}`]">
    <span class="vx-tag__content">
      <slot></slot>
    </span>
    <button
      v-if="closable"
      class="vx-tag__close"
      type="button"
      :aria-label="$t('ui.removeTag')"
      @click.stop="emit('close')"
    >
      ×
    </button>
  </span>
</template>

<style scoped lang="scss">
.vx-tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  vertical-align: middle;
}

.vx-tag-sm {
  min-height: 22px;
  padding: 0 8px;
  font-size: var(--font-size-xs);
}

.vx-tag-md {
  min-height: 26px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
}

.vx-tag__content {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vx-tag__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: -4px;
  margin-left: 6px;
  padding: 0;
  color: currentColor;
  font-size: 14px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;
  opacity: 0.68;
}

.vx-tag__close:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
  opacity: 1;
}

.vx-tag-default {
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border-color: var(--color-border);
}

.vx-tag-accent {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: color-mix(in srgb, var(--color-accent) 22%, var(--color-border) 78%);
}

.vx-tag-info {
  color: var(--color-info);
  background: var(--color-info-soft);
  border-color: color-mix(in srgb, var(--color-info) 22%, var(--color-border) 78%);
}

.vx-tag-success {
  color: var(--color-success);
  background: var(--color-success-soft);
  border-color: color-mix(in srgb, var(--color-success) 22%, var(--color-border) 78%);
}

.vx-tag-warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-color: color-mix(in srgb, var(--color-warning) 24%, var(--color-border) 76%);
}

.vx-tag-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: color-mix(in srgb, var(--color-danger) 22%, var(--color-border) 78%);
}
</style>
