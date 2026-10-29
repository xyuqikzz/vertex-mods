<script setup>
import ToolIcon from './ToolIcon.vue'

// 工具栏里的图标按钮（刷新等），与「我的游戏」刷新按钮同规格；busy 时图标旋转并禁用。
defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  busy: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' }
})

const emit = defineEmits(['click'])
</script>

<template>
  <button
    type="button"
    class="tool-icon-button"
    :class="[`is-${size}`, { 'is-busy': busy }]"
    :aria-label="label"
    :title="label"
    :aria-busy="busy"
    :disabled="disabled || busy"
    @click="emit('click', $event)"
  >
    <ToolIcon :name="icon" :size="size === 'sm' ? 14 : 15" />
  </button>
</template>

<style scoped lang="scss">
.tool-icon-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--control-height-md);
  height: var(--control-height-md);
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &.is-sm {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
  }

  &:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--color-text-muted);
    cursor: not-allowed;
  }

  &.is-busy {
    cursor: progress;

    :deep(.tool-icon) {
      animation: tool-icon-spin 800ms linear infinite;
    }
  }
}

@keyframes tool-icon-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-icon-button {
    transition: none;
  }

  .tool-icon-button.is-busy :deep(.tool-icon) {
    animation-duration: 2s;
  }
}
</style>
