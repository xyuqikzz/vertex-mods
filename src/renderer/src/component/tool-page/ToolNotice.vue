<script setup>
import { computed } from 'vue'
import ToolIcon from './ToolIcon.vue'

// 工具页提示条：说明 / 进行中 / 警告 / 错误四种；颜色与「我的游戏」需处理提示条一致。
const props = defineProps({
  tone: {
    type: String,
    default: 'info',
    validator: (value) => ['info', 'progress', 'warning', 'danger'].includes(value)
  },
  title: { type: String, default: '' }
})

const role = computed(() => ({ progress: 'status', danger: 'alert' })[props.tone])
const icon = computed(() => ({ info: 'info', warning: 'warning', danger: 'error' })[props.tone])
</script>

<template>
  <div class="tool-notice" :class="`is-${tone}`" :role="role">
    <span v-if="tone === 'progress'" class="tool-notice__spinner" aria-hidden="true"></span>
    <ToolIcon v-else :name="icon" :size="15" class="tool-notice__icon" />
    <div class="tool-notice__body">
      <div class="tool-notice__text">
        <strong v-if="title">{{ title }}</strong>
        <span v-if="title && $slots.default" class="tool-notice__sep" aria-hidden="true">·</span>
        <slot></slot>
      </div>
      <slot name="detail"></slot>
    </div>
    <div v-if="$slots.actions" class="tool-notice__actions">
      <slot name="actions"></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 浅色警示底上的文字需要更深，以满足 WCAG AA 对比度（与 LibraryAttention 相同的混色）。
$warning-text: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
$warning-bg: color-mix(in srgb, var(--color-warning-soft) 45%, var(--color-white));
$warning-border: color-mix(in srgb, var(--color-warning) 28%, var(--color-white));
$accent-bg: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
$accent-border: color-mix(in srgb, var(--color-accent) 22%, var(--color-white));
$danger-border: color-mix(in srgb, var(--color-danger) 24%, var(--color-white));

.tool-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: 10px var(--space-3) 10px 14px;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  border: 1px solid;
  border-radius: 10px;

  &.is-info {
    color: var(--color-text-secondary);
    background: var(--color-surface-soft);
    border-color: var(--color-border);

    .tool-notice__icon {
      color: var(--color-text-muted);
    }
  }

  &.is-progress {
    color: var(--color-accent-strong);
    background: $accent-bg;
    border-color: $accent-border;
  }

  &.is-warning {
    color: $warning-text;
    background: $warning-bg;
    border-color: $warning-border;

    .tool-notice__icon {
      color: var(--color-warning-strong);
    }
  }

  &.is-danger {
    color: var(--color-danger-strong);
    background: var(--color-danger-soft);
    border-color: $danger-border;
  }
}

.tool-notice__body {
  display: flex;
  flex: 1 1 260px;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.tool-notice__text {
  overflow-wrap: anywhere;

  strong {
    font-weight: var(--font-weight-semibold);
  }
}

.tool-notice__sep {
  margin: 0 6px;
}

.tool-notice__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.tool-notice__spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: tool-notice-spin 700ms linear infinite;
}

@keyframes tool-notice-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-notice__spinner {
    animation-duration: 2s;
  }
}
</style>
