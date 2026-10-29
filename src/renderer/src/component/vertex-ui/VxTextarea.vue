<script setup>
import { useId } from 'vue'
defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  rows: { type: Number, default: 4 },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false }
})

const fieldId = useId()
const emit = defineEmits(['update:modelValue'])

function updateValue(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <label
    class="vx-field"
    :class="{ 'has-error': error, 'is-disabled': disabled, 'is-readonly': readonly }"
  >
    <span v-if="label" :id="`${fieldId}-label`" class="vx-field__label">{{ label }}</span>
    <textarea
      class="vx-textarea vx-ui-scrollbar"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
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
      @input="updateValue"
    ></textarea>
    <span
      v-if="error || hint"
      :id="`${fieldId}-message`"
      class="vx-field__message"
      :role="error ? 'alert' : undefined"
      >{{ error || hint }}</span
    >
  </label>
</template>
