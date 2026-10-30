<script setup>
// 工具页使用 accent 方圆角主题色样式；其他调用保留默认胶囊样式。
defineProps({
  // [{ value, label, count }]，count 为 null / undefined 时不显示数量。
  options: { type: Array, required: true },
  modelValue: { type: [String, Number], required: true },
  label: { type: String, default: '' },
  variant: { type: String, default: 'neutral' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'change'])

function select(value, current) {
  if (value === current) return
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <div class="tool-pills" :class="{ 'is-accent': variant === 'accent' }" role="group" :aria-label="label || undefined">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="tool-pills__item"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :disabled="disabled"
      @click="select(option.value, modelValue)"
    >
      <span class="tool-pills__label">{{ option.label }}</span>
      <span v-if="option.count !== null && option.count !== undefined" class="tool-pills__count">
        {{ option.count }}
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.tool-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.tool-pills__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height-sm);
  padding: 0 14px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  background: var(--color-surface-hover);
  border: 0;
  border-radius: var(--radius-pill);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-active):not(:disabled) {
    background: var(--color-surface-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.is-active {
    color: var(--color-text-inverse);
    background: var(--color-text);

    .tool-pills__count {
      color: color-mix(in srgb, var(--color-text-inverse) 78%, var(--color-text));
    }
  }
}

.tool-pills__count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

.tool-pills.is-accent .tool-pills__item {
  min-width: 0;
  max-width: 100%;
  min-height: var(--control-height-sm);
  height: auto;
  padding: var(--space-1) 14px;
  border-radius: var(--radius-md);

  .tool-pills__label {
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .tool-pills__count {
    flex-shrink: 0;
  }

  &:hover:not(.is-active):not(:disabled) {
    color: var(--color-accent-strong);
    background: var(--color-accent-soft);
  }

  &.is-active {
    background: var(--color-accent);

    .tool-pills__count {
      color: inherit;
    }

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }
  }

  &:active:not(:disabled) {
    color: var(--color-text-inverse);
    background: var(--color-accent-active);

    .tool-pills__count {
      color: inherit;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-pills__item {
    transition: none;
  }
}
</style>
