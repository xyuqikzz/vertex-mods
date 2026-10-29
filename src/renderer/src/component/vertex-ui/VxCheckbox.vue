<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'change'])

function updateValue(event) {
  const value = event.target.checked
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <label class="vx-check" :class="{ 'is-disabled': disabled }">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="updateValue" />
    <i aria-hidden="true"></i>
    <span>{{ label }}</span>
  </label>
</template>

<style scoped lang="scss">
.vx-check {
  box-sizing: border-box;
  max-width: 100%;
  padding-block: calc((var(--control-height-md) - 1.5em) / 2);
  line-height: var(--line-height-base);
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: fit-content;
  min-height: var(--control-height-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  user-select: none;
}

.vx-check input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.vx-check i {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--choice-size);
  height: var(--choice-size);
  margin-top: calc((1.5em - var(--choice-size)) / 2);
  flex: 0 0 auto;
  background: var(--control-bg);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  box-shadow: var(--control-shadow);
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.vx-check i::after {
  width: 7px;
  height: 4px;
  content: '';
  border-bottom: 2px solid var(--color-accent);
  border-left: 2px solid var(--color-accent);
  opacity: 0;
  transform: rotate(-45deg) translate(1px, -1px) scale(0.7);
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.vx-check:not(.is-disabled):hover i,
.vx-check input:focus-visible + i {
  border-color: color-mix(in srgb, var(--color-accent) 58%, var(--color-border) 42%);
  box-shadow: var(--control-shadow), var(--focus-ring);
}

.vx-check input:checked + i {
  background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--control-bg) 42%);
  border-color: var(--color-accent);
}

.vx-check input:checked + i::after {
  opacity: 1;
  transform: rotate(-45deg) translate(1px, -1px) scale(1);
}

.vx-check.is-disabled {
  cursor: not-allowed;
  color: var(--control-text-disabled);
  i {
    background: var(--control-bg-disabled);
  }
}
.vx-check > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
