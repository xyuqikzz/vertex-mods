<script setup>
import { computed, ref } from 'vue'

// 需处理提示条：列出目录缺失的游戏，超过 VISIBLE_LIMIT 个时折叠其余。
const VISIBLE_LIMIT = 3

const props = defineProps({
  // [{ key, title, path, tone, monogram, hasSources }]
  items: { type: Array, default: () => [] }
})

const emit = defineEmits(['relocate', 'remove', 'open', 'dismiss'])

const expanded = ref(false)
const visibleItems = computed(() =>
  expanded.value ? props.items : props.items.slice(0, VISIBLE_LIMIT)
)
const hiddenCount = computed(() => Math.max(0, props.items.length - VISIBLE_LIMIT))
</script>

<template>
  <section class="library-attention" aria-labelledby="library-attention-title">
    <div class="library-attention__header">
      <svg
        class="library-attention__icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M8 2 1.5 13.5h13z" />
        <path d="M8 6.5v3.2M8 11.6v.1" />
      </svg>
      <h2 id="library-attention-title">{{ items.length }} {{ $t('ui.gamesHaveMissingInstallationFolders') }}</h2>
      <button type="button" class="library-attention__text-button" @click="emit('dismiss')">
        {{ $t('tools.remindMeLater') }}
      </button>
    </div>

    <ul class="library-attention__list">
      <li v-for="item in visibleItems" :key="item.key" class="library-attention__row">
        <span
          class="library-attention__thumb"
          :style="{ '--cover-tone': item.tone }"
          aria-hidden="true"
        >
          {{ item.monogram }}
        </span>
        <span class="library-attention__text">
          <strong>{{ item.title }}</strong>
          <span :title="item.path">{{ $t('ui.notFound') }} {{ item.path || $t('ui.gameFolder') }}</span>
        </span>
        <button
          v-if="item.hasSources"
          type="button"
          class="library-attention__button"
          @click="emit('relocate', item.key)"
        >
          {{ $t('ui.locateAgain') }}
        </button>
        <button
          v-else
          type="button"
          class="library-attention__button"
          @click="emit('remove', item.key)"
        >
          {{ $t('tools.removeRecord') }}
        </button>
        <button
          type="button"
          class="library-attention__text-button"
          @click="emit('open', item.key)"
        >
          {{ $t('modBrowser.details') }}
        </button>
      </li>
    </ul>

    <div v-if="hiddenCount > 0" class="library-attention__footer">
      <button
        type="button"
        class="library-attention__text-button is-strong"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? $t('tools.collapse') : $t('ui.valueMoreShowAll', { value1: (hiddenCount) }) }}
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
// 浅色警示底上的文字需要更深，以满足 WCAG AA 对比度。
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

.library-attention {
  display: flex;
  flex-direction: column;
  color: $warning-text;
  background: $warning-bg;
  border: 1px solid $warning-border;
  border-radius: 10px;
}

.library-attention__header {
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

.library-attention__icon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  color: var(--color-warning-strong);
}

.library-attention__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-attention__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 14px;
  padding: 10px 14px 10px var(--space-4);
  border-top: 1px solid $warning-border;
}

.library-attention__thumb {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 32px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  background: var(--cover-tone, var(--color-surface-strong));
  border-radius: var(--radius-sm);
}

.library-attention__text {
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

.library-attention__button {
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

  &:hover {
    background: $warning-hover;
  }
}

.library-attention__text-button {
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

.library-attention__footer {
  padding: var(--space-1) 6px 6px;
  border-top: 1px solid $warning-border;
}

@media (prefers-reduced-motion: reduce) {
  .library-attention__button,
  .library-attention__text-button {
    transition: none;
  }
}
</style>
