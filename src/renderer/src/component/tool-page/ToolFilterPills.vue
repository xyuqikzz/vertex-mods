<script setup>
// 与「我的游戏」来源胶囊同规格：选中为深色底白字，数量用等宽数字。
defineProps({
  // [{ value, label, count }]，count 为 null / undefined 时不显示数量。
  options: { type: Array, required: true },
  modelValue: { type: [String, Number], required: true },
  label: { type: String, default: '' },
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
  <div class="tool-pills" role="group" :aria-label="label || undefined">
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

@media (prefers-reduced-motion: reduce) {
  .tool-pills__item {
    transition: none;
  }
}
</style>
