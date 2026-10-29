<script setup>
import { computed, ref, useId } from 'vue'
import { toolText as tt } from '@renderer/i18n/tool-text.js'
import ToolIcon from './ToolIcon.vue'

// 需处理提示条：结构和配色与「我的游戏」LibraryAttention 相同，超过 3 个时折叠其余。
const VISIBLE_LIMIT = 3

const props = defineProps({
  title: { type: String, required: true },
  // [{ key, name, detail, detailTitle, monogram, tone, portrait, actionLabel }]
  items: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['action', 'dismiss'])
const titleId = useId()
const expanded = ref(false)
const visibleItems = computed(() =>
  expanded.value ? props.items : props.items.slice(0, VISIBLE_LIMIT)
)
const hiddenCount = computed(() => Math.max(0, props.items.length - VISIBLE_LIMIT))
</script>

<template>
  <section class="tool-attention" :aria-labelledby="titleId">
    <div class="tool-attention__header">
      <ToolIcon name="warning" :size="15" class="tool-attention__icon" />
      <h2 :id="titleId">{{ title }}</h2>
      <button type="button" class="tool-attention__text-button" @click="emit('dismiss')">
        {{ tt('稍后提醒') }}
      </button>
    </div>

    <ul class="tool-attention__list">
      <li v-for="item in visibleItems" :key="item.key" class="tool-attention__row">
        <span
          class="tool-attention__thumb"
          :class="{ 'is-portrait': item.portrait }"
          :style="{ '--cover-tone': item.tone }"
          aria-hidden="true"
        >
          {{ item.monogram }}
        </span>
        <span class="tool-attention__text">
          <strong>{{ item.name }}</strong>
          <span :title="item.detailTitle || item.detail">{{ item.detail }}</span>
        </span>
        <button
          type="button"
          class="tool-attention__button"
          :disabled="disabled"
          @click="emit('action', item.key)"
        >
          {{ item.actionLabel }}
        </button>
      </li>
    </ul>

    <div v-if="hiddenCount > 0" class="tool-attention__footer">
      <button
        type="button"
        class="tool-attention__text-button is-strong"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? tt('收起') : tt('还有 {0} 个 · 展开全部', [hiddenCount]) }}
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
// 浅色警示底上的文字需要更深，以满足 WCAG AA 对比度（与 LibraryAttention 相同）。
$warning-text: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
$warning-title: color-mix(in srgb, var(--color-warning) 35%, var(--color-black));
$warning-bg: color-mix(in srgb, var(--color-warning-soft) 45%, var(--color-white));
$warning-border: color-mix(in srgb, var(--color-warning) 28%, var(--color-white));
$warning-hover: color-mix(in srgb, var(--color-warning-soft) 80%, var(--color-white));

@mixin focus-ring {
  outline: none;

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.tool-attention {
  display: flex;
  flex-direction: column;
  color: $warning-text;
  background: $warning-bg;
  border: 1px solid $warning-border;
  border-radius: 10px;
}

.tool-attention__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 10px var(--space-1) var(--space-4);

  h2 {
    flex: 1;
    margin: 0;
    color: $warning-title;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
}

.tool-attention__icon {
  color: var(--color-warning-strong);
}

.tool-attention__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tool-attention__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 14px;
  padding: 10px 14px 10px var(--space-4);
  border-top: 1px solid $warning-border;
}

.tool-attention__thumb {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 32px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  background: var(--cover-tone, var(--color-surface-strong));
  border-radius: var(--radius-sm);

  &.is-portrait {
    width: 24px;
    height: 36px;
    font-size: 9px;
  }
}

.tool-attention__text {
  display: flex;
  flex: 1 1 300px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  strong {
    color: $warning-title;
    font-size: 13.5px;
    font-weight: var(--font-weight-semibold);
  }

  span {
    overflow: hidden;
    font-size: 12.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.tool-attention__button {
  @include focus-ring;

  height: var(--control-height-sm);
  padding: 0 14px;
  color: $warning-title;
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  background: var(--color-surface);
  border: 1px solid $warning-border;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: $warning-hover;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.tool-attention__text-button {
  @include focus-ring;

  height: 28px;
  padding: 0 10px;
  color: $warning-text;
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-medium);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &:hover {
    background: $warning-hover;
  }

  &.is-strong {
    font-weight: var(--font-weight-semibold);
  }
}

.tool-attention__footer {
  padding: var(--space-1) 6px 6px;
  border-top: 1px solid $warning-border;
}

@media (prefers-reduced-motion: reduce) {
  .tool-attention__button,
  .tool-attention__text-button {
    transition: none;
  }
}
</style>
