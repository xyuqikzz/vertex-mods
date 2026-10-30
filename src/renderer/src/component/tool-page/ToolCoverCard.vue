<script setup>
import ToolIcon from './ToolIcon.vue'

// 封面卡片：规格与「我的游戏」LibraryCard 一致。封面按钮和快捷按钮是兄弟按钮，避免嵌套。
defineProps({
  title: { type: String, required: true },
  // 封面下方的说明行（已翻译的字符串数组）。
  meta: { type: Array, default: () => [] },
  metaTone: { type: String, default: '' },
  image: { type: String, default: '' },
  monogram: { type: String, default: '' },
  tone: { type: String, default: '' },
  portrait: { type: Boolean, default: false },
  // { tone: 'success' | 'progress' | 'warning' | 'danger' | 'neutral', label }
  flag: { type: Object, default: null },
  coverLabel: { type: String, default: '' },
  coverDisabled: { type: Boolean, default: false },
  // 额外挂到封面按钮上的属性（如 data-binding-id、title）。
  coverAttrs: { type: Object, default: () => ({}) },
  // { label, ariaLabel, icon, disabled, busy }
  quick: { type: Object, default: null }
})

const emit = defineEmits(['select', 'quick', 'image-error'])
</script>

<template>
  <div class="tool-cover-card" :class="{ 'is-portrait': portrait }">
    <div class="tool-cover-card__media">
      <button
        type="button"
        class="tool-cover-card__cover"
        :style="{ '--cover-tone': tone || undefined }"
        :aria-label="coverLabel || title"
        :disabled="coverDisabled"
        v-bind="coverAttrs"
        @click="emit('select')"
      >
        <slot name="media">
          <img
            v-if="image"
            :src="image"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="emit('image-error')"
          />
          <span v-else class="tool-cover-card__monogram" aria-hidden="true">{{ monogram }}</span>
        </slot>
        <span v-if="flag" class="tool-cover-card__flag" :class="`is-${flag.tone || 'neutral'}`">
          <span class="tool-cover-card__dot" aria-hidden="true"></span>
          <span class="tool-cover-card__flag-label">{{ flag.label }}</span>
        </span>
      </button>

      <button
        v-if="quick"
        type="button"
        class="tool-cover-card__quick"
        :class="{ 'is-busy': quick.busy }"
        :disabled="quick.disabled || quick.busy"
        :aria-busy="!!quick.busy"
        :aria-label="quick.ariaLabel || quick.label"
        :title="quick.ariaLabel || quick.label"
        @click="emit('quick')"
      >
        <span v-if="quick.busy" class="tool-cover-card__spinner" aria-hidden="true"></span>
        <ToolIcon v-else-if="quick.icon" :name="quick.icon" :size="12" />
        {{ quick.label }}
      </button>
    </div>

    <div class="tool-cover-card__body">
      <span class="tool-cover-card__title" :title="title">{{ title }}</span>
      <span
        v-for="(line, index) in meta"
        :key="index"
        class="tool-cover-card__meta"
        :class="metaTone ? `is-${metaTone}` : ''"
        :title="line"
      >
        {{ line }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
$warning-text: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));

.tool-cover-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;

  &:hover {
    .tool-cover-card__cover:not(:disabled) {
      box-shadow: 0 14px 28px -14px rgba(15, 23, 42, 0.45);
      transform: translateY(-3px);
    }

    .tool-cover-card__title {
      color: var(--color-accent-active);
    }
  }

  // 快捷按钮默认隐藏；悬停、键盘聚焦到卡片内或处理中时显示。
  &:hover,
  &:focus-within {
    .tool-cover-card__quick {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
  }
}

.tool-cover-card__media {
  position: relative;
}

.tool-cover-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 0;
  overflow: hidden;
  color: inherit;
  font: inherit;
  background: var(--cover-tone, var(--color-surface-strong));
  border: 0;
  border-radius: 10px;
  outline: none;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-standard),
    box-shadow var(--duration-base) var(--ease-standard);

  .is-portrait & {
    aspect-ratio: 2 / 3;
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: not-allowed;
  }

  img,
  :deep(.dlss-art) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 0;
  }
}

.tool-cover-card__monogram {
  color: rgba(255, 255, 255, 0.5);
  font-size: 30px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 2px;
  line-height: 1;

  .is-portrait & {
    font-size: 24px;
  }
}

.tool-cover-card__flag {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 16px);
  height: 22px;
  padding: 0 var(--space-2);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: var(--font-weight-semibold);
  background: rgba(255, 255, 255, 0.94);
  border-radius: var(--radius-pill);

  &.is-success {
    color: var(--color-success-strong);

    .tool-cover-card__dot {
      background: var(--color-success);
    }
  }

  &.is-progress {
    color: var(--color-accent-strong);

    .tool-cover-card__dot {
      background: var(--color-accent);
    }
  }

  &.is-warning {
    color: $warning-text;
    background: rgba(255, 248, 236, 0.96);

    .tool-cover-card__dot {
      background: var(--color-warning);
    }
  }

  &.is-danger {
    color: var(--color-danger-strong);

    .tool-cover-card__dot {
      background: var(--color-danger);
    }
  }
}

.tool-cover-card__flag-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tool-cover-card__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  background: var(--color-text-subtle);
  border-radius: 50%;
}

.tool-cover-card__quick {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 20px);
  height: 34px;
  padding: 0 14px 0 12px;
  overflow: hidden;
  color: var(--color-text-inverse);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  background: var(--color-accent);
  border: 0;
  border-radius: var(--radius-md);
  outline: none;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  &:active:not(:disabled) {
    background: var(--color-accent-active);
  }

  &:focus-visible {
    box-shadow:
      0 0 0 2px var(--color-white),
      0 0 0 5px var(--color-accent-soft);
  }

  &:disabled {
    cursor: progress;
  }

  &.is-busy {
    opacity: 1;
    transform: none;
  }
}

.tool-cover-card__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: tool-cover-card-spin 700ms linear infinite;
}

@keyframes tool-cover-card-spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-cover-card__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 0 2px;
}

.tool-cover-card__title,
.tool-cover-card__meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tool-cover-card__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  transition: color var(--duration-fast) var(--ease-standard);
}

.tool-cover-card__meta {
  color: var(--color-text-muted);
  font-size: 12.5px;

  &.is-warning {
    color: $warning-text;
  }

  &.is-danger {
    color: var(--color-danger-strong);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-cover-card__cover,
  .tool-cover-card__quick,
  .tool-cover-card__title {
    transition: none;
  }

  .tool-cover-card:hover .tool-cover-card__cover {
    transform: none;
  }

  .tool-cover-card__quick {
    transform: none;
  }
}
</style>
