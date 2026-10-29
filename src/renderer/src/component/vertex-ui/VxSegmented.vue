<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'change'])

const activeIndex = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue)
  )
)

function selectOption(option) {
  emit('update:modelValue', option.value)
  emit('change', option.value)
}
</script>

<template>
  <div
    class="vx-segmented"
    :style="{ '--vx-active-index': activeIndex, '--vx-option-count': Math.max(options.length, 1) }"
  >
    <span class="vx-segmented__indicator" aria-hidden="true"></span>
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      @click="selectOption(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.vx-segmented {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--vx-option-count), minmax(0, 1fr));
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 2px;
  background: color-mix(in srgb, var(--color-surface-soft) 82%, var(--color-border) 18%);
  border: 1px solid color-mix(in srgb, var(--color-border) 86%, var(--color-text-subtle) 14%);
  border-radius: var(--radius-md);
  box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}

.vx-segmented__indicator {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc((100% - 4px) / var(--vx-option-count));
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-border) 78%, var(--color-white) 22%);
  border-radius: var(--radius-sm);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.72);
  transform: translateX(calc(var(--vx-active-index) * 100%));
  transition:
    transform var(--duration-base) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.vx-segmented button {
  position: relative;
  z-index: 1;
  height: 28px;
  padding: 0 var(--space-3);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  transition:
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.vx-segmented button:hover,
.vx-segmented button.is-active {
  color: var(--color-text-secondary);
}
.vx-segmented button:focus-visible {
  outline: 2px solid var(--color-accent-active);
  outline-offset: -2px;
}
</style>
