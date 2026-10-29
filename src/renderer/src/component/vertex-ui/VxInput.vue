<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  type: { type: String, default: 'text' },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  clearable: { type: Boolean, default: false }
})

const fieldId = useId()
const emit = defineEmits(['update:modelValue', 'clear'])

const hasValue = computed(() => String(props.modelValue ?? '').length > 0)

function updateValue(event) {
  emit('update:modelValue', event.target.value)
}

function clearValue() {
  emit('update:modelValue', '')
  emit('clear')
}
</script>

<template>
  <label
    class="vx-field"
    :class="{ 'has-error': error, 'is-disabled': disabled, 'is-readonly': readonly }"
  >
    <span v-if="label" :id="`${fieldId}-label`" class="vx-field__label">{{ label }}</span>
    <span class="vx-input-wrap">
      <input
        class="vx-input"
        :class="{ 'has-trailing-control': clearable || loading }"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :readonly="readonly"
        :aria-label="$attrs['aria-label']"
        :aria-labelledby="label ? `${fieldId}-label` : $attrs['aria-labelledby']"
        :aria-describedby="
          [error || hint ? `${fieldId}-message` : null, $attrs['aria-describedby']]
            .filter(Boolean)
            .join(' ') || undefined
        "
        :aria-invalid="Boolean(error)"
        :aria-readonly="readonly"
        :aria-busy="loading"
        @input="updateValue"
      />
      <button
        v-if="clearable && hasValue && !disabled && !readonly && !loading"
        class="vx-input__clear"
        type="button"
        :aria-label="$t('ui.clearInput')"
        @click="clearValue"
      >
        ×
      </button>
      <span v-if="loading" class="vx-input__spinner" aria-hidden="true"></span>
    </span>
    <span
      v-if="error || hint"
      :id="`${fieldId}-message`"
      class="vx-field__message"
      :role="error ? 'alert' : undefined"
      >{{ error || hint }}</span
    >
  </label>
</template>

<style scoped lang="scss">
.vx-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.vx-input.has-trailing-control {
  padding-right: var(--control-height-md);
}
.vx-input__clear {
  position: absolute;
  right: var(--space-2);
  width: var(--space-6);
  height: var(--space-6);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}
.vx-input__spinner {
  position: absolute;
  right: var(--control-padding-x);
  width: var(--control-icon-size);
  height: var(--control-icon-size);
  border: 2px solid var(--color-text-muted);
  border-right-color: transparent;
  border-radius: 50%;
  animation: vx-control-spin 700ms linear infinite;
}
</style>
