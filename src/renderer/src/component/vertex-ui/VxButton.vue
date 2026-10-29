<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  block: { type: Boolean, default: false }
})

const emit = defineEmits(['click'])
const buttonRef = ref(null)

const classes = computed(() => [
  'vx-button',
  `vx-button-${props.variant}`,
  `vx-button-${props.size}`,
  {
    'is-loading': props.loading,
    'is-block': props.block
  }
])

function handleClick(event) {
  if (props.disabled || props.loading) return
  emit('click', event)
}

function focus() {
  buttonRef.value?.focus?.()
}

defineExpose({ focus })
</script>

<template>
  <button
    ref="buttonRef"
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-busy="loading"
    @click="handleClick"
  >
    <span v-if="loading" class="vx-button__spinner" aria-hidden="true"></span>
    <span class="vx-button__content">
      <slot></slot>
    </span>
  </button>
</template>

<style scoped lang="scss">
.vx-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-height-md);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  font-family: var(--font-family-base);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1;
  white-space: nowrap;
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    cursor: not-allowed;
    color: var(--control-text-disabled);
    background: var(--control-bg-disabled);
    border-color: var(--color-border);
    transform: none;
  }
}

.vx-button-sm {
  min-height: var(--control-height-sm);
  padding: 0 var(--space-3);
  font-size: var(--font-size-sm);
  // 小按钮常成组出现在工具栏和表格旁，600 字重会显得拥挤。
  font-weight: var(--font-weight-medium);
}

.vx-button-md {
  min-height: var(--control-height-md);
  padding: 0 var(--space-4);
  font-size: var(--font-size-md);
}

.vx-button-lg {
  min-height: var(--control-height-lg);
  padding: 0 var(--space-5);
  font-size: var(--font-size-md);
}

.vx-button-primary {
  color: var(--color-text-inverse);
  background: var(--color-accent);
  border-color: var(--color-accent);

  &:hover:not(:disabled) {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }
}

.vx-button-secondary {
  background: var(--vx-ui-surface);
  border-color: var(--color-border);
  color: var(--color-text-secondary);

  &:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-border-strong);
    background: var(--color-surface-hover);
  }
}

.vx-button-soft {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
  border-color: transparent;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 16%, var(--color-accent-soft));
  }
}

.vx-button-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--color-text-secondary);

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
    color: var(--color-accent);
  }
}

.vx-button-danger {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-text-inverse);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger) 88%, var(--color-black));
    border-color: color-mix(in srgb, var(--color-danger) 88%, var(--color-black));
  }
}

.is-block {
  width: 100%;
}

.vx-button__spinner {
  position: absolute;
  width: var(--control-icon-size);
  height: var(--control-icon-size);
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: vx-button-spin 700ms linear infinite;
}

// 保留内容占位与可访问名称，加载图标不参与宽度计算。
.vx-button.is-loading > .vx-button__content {
  opacity: 0;
}

@keyframes vx-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
