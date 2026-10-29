<script setup>
import { useId } from 'vue'
const groupName = useId()
defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'change'])

function selectValue(value) {
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <div
    class="vx-radio-group"
    role="radiogroup"
    :aria-invalid="Boolean(error)"
    :aria-readonly="readonly"
    :aria-busy="loading"
    :aria-describedby="error ? `${groupName}-error` : undefined"
  >
    <label
      v-for="option in options"
      :key="String(option.value)"
      class="vx-radio"
      :class="{ 'is-disabled': disabled || readonly || loading || option.disabled }"
    >
      <input
        type="radio"
        :name="groupName"
        :checked="
          Object.is(option.value, modelValue) || String(option.value) === String(modelValue)
        "
        :disabled="disabled || readonly || loading || option.disabled"
        @change="selectValue(option.value)"
      />
      <i aria-hidden="true"></i>
      <span>{{ option.label }}</span>
    </label>
    <span v-if="loading" role="status">{{ $t('ui.loadingOptions') }}</span>
    <span v-if="error" :id="`${groupName}-error`" class="vx-radio-error" role="alert">{{
      error
    }}</span>
  </div>
</template>

<style scoped lang="scss">
.vx-radio-error {
  flex-basis: 100%;
  color: var(--color-danger);
}
.vx-radio-group {
  display: flex;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  flex-wrap: wrap;
}

.vx-radio {
  box-sizing: border-box;
  max-width: 100%;
  padding-block: calc((var(--control-height-md) - 1.5em) / 2);
  line-height: var(--line-height-base);
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: var(--control-height-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  user-select: none;
}

.vx-radio input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.vx-radio i {
  position: relative;
  box-sizing: border-box;
  display: block;
  width: var(--choice-size);
  height: var(--choice-size);
  margin-top: calc((1.5em - var(--choice-size)) / 2);
  flex: 0 0 auto;
  background: var(--control-bg);
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  box-shadow: var(--control-shadow);
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.vx-radio i::after {
  position: absolute;
  inset: 0;
  margin: auto;
  width: var(--space-2);
  height: var(--space-2);
  content: '';
  background: var(--color-accent);
  border-radius: 50%;
  opacity: 0;
  transform: scale(0.5);
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.vx-radio:not(.is-disabled):hover i,
.vx-radio input:focus-visible + i {
  border-color: color-mix(in srgb, var(--color-accent) 58%, var(--color-border) 42%);
  box-shadow: var(--control-shadow), var(--focus-ring);
}

.vx-radio input:checked + i {
  background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--control-bg) 42%);
  border-color: var(--color-accent);
}

.vx-radio input:checked + i::after {
  opacity: 1;
  transform: scale(1);
}

.vx-radio.is-disabled {
  cursor: not-allowed;
  color: var(--control-text-disabled);
  i {
    background: var(--control-bg-disabled);
  }
}
.vx-radio > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
