<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  // sm 用于表格行内等高密度场景：30 × 18，关闭态边框更清晰，开启态不加外晕。
  size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue', 'change'])

function updateValue(event) {
  const value = event.target.checked
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <label class="vx-switch" :class="{ 'is-disabled': disabled, 'vx-switch--sm': size === 'sm' }">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="updateValue" />
    <span aria-hidden="true"></span>
    <strong v-if="label">{{ label }}</strong>
  </label>
</template>

<style scoped lang="scss">
.vx-switch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  min-height: var(--control-height-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  user-select: none;
}

.vx-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.vx-switch > span {
  position: relative;
  width: 38px;
  height: 22px;
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--control-shadow);
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.vx-switch > span::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  content: '';
  background: var(--color-text-subtle);
  border-radius: 50%;
  transition:
    background var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.vx-switch input:checked + span {
  background: color-mix(in srgb, var(--color-accent-soft) 70%, var(--control-bg) 30%);
  border-color: color-mix(in srgb, var(--color-accent) 48%, var(--color-border) 52%);
  box-shadow:
    var(--control-shadow),
    0 0 0 3px color-mix(in srgb, var(--color-accent-soft) 52%, transparent);
}

.vx-switch input:checked + span::after {
  background: var(--color-accent);
  transform: translateX(16px);
}

.vx-switch input:focus-visible + span {
  box-shadow: var(--control-shadow), var(--focus-ring);
}

.vx-switch.is-disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.vx-switch--sm {
  gap: var(--space-2);
  min-height: var(--space-6);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);

  > span {
    box-sizing: border-box;
    width: 30px;
    height: 18px;
    border-color: var(--color-border-strong);
    box-shadow: none;
  }

  > span::after {
    top: 3px;
    left: 3px;
    width: 10px;
    height: 10px;
  }

  &:not(.is-disabled):hover > span {
    border-color: var(--color-text-subtle);
  }

  input:checked + span {
    box-shadow: none;
  }

  &:not(.is-disabled):hover input:checked + span {
    border-color: var(--color-accent);
  }

  input:checked + span::after {
    transform: translateX(12px);
  }

  input:focus-visible + span {
    box-shadow: none;
    outline: 2px solid var(--color-accent-active);
    outline-offset: 2px;
  }

  &.is-disabled {
    opacity: 0.5;
  }
}
</style>
