<script setup>
// 游戏库封面卡片：封面按钮负责选中 / 展开详情，启动按钮是独立的兄弟按钮，避免按钮嵌套。
defineProps({
  // 由页面计算好的纯展示数据，见 gameRepository.vue 的 getCardView。
  view: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  launching: { type: Boolean, default: false },
  detailId: { type: String, default: '' }
})

const emit = defineEmits(['select', 'launch', 'cover-error'])
</script>

<template>
  <div class="library-card" :class="{ 'is-selected': selected, 'is-launching': launching }">
    <div class="library-card__media">
      <button
        type="button"
        class="library-card__cover"
        :style="{ '--cover-tone': view.tone }"
        :data-library-key="view.key"
        :aria-expanded="selected"
        :aria-controls="selected && detailId ? detailId : undefined"
        :aria-label="`${view.title}，${view.meta}，${selected ? $t('ui.collapseDetails') : $t('ui.expandDetails')}`"
        @click="emit('select')"
      >
        <img
          v-if="view.cover"
          :src="view.cover"
          alt=""
          loading="lazy"
          @error="emit('cover-error')"
        />
        <span v-else class="library-card__monogram" aria-hidden="true">{{ view.monogram }}</span>

        <span v-if="view.badges.length" class="library-card__badges" aria-hidden="true">
          <span v-for="badge in view.badges" :key="badge" class="library-card__badge">{{
            badge
          }}</span>
        </span>

        <span v-if="view.status === 'missing'" class="library-card__flag is-missing">
          <span class="library-card__dot" aria-hidden="true"></span>
          {{ $t('ui.missingFolder') }}
        </span>
        <span v-else-if="view.status === 'unbound'" class="library-card__flag is-unbound">
          <span class="library-card__dot" aria-hidden="true"></span>
          {{ $t('ui.noFolderBound') }}
        </span>
      </button>

      <button
        v-if="view.canLaunch"
        type="button"
        class="library-card__launch"
        :disabled="launching"
        :aria-busy="launching"
        :aria-label="`${view.launchLabel} ${view.title}`"
        :title="`${view.launchLabel} ${view.title}`"
        @click="emit('launch')"
      >
        <span v-if="launching" class="library-card__spinner" aria-hidden="true"></span>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
        </svg>
        {{ launching ? $t('ui.launching') : view.launchShort }}
      </button>
    </div>

    <div class="library-card__body">
      <span class="library-card__title" :title="view.title">{{ view.title }}</span>
      <span class="library-card__meta" :class="{ 'is-warning': view.status === 'missing' }">
        {{ view.meta }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
$warning-text: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
$warning-bg: color-mix(in srgb, var(--color-warning-soft) 45%, var(--color-white));

.library-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;

  &:hover {
    .library-card__cover {
      box-shadow: 0 14px 28px -14px rgba(15, 23, 42, 0.45);
      transform: translateY(-3px);
    }

    .library-card__title {
      color: var(--color-accent-active);
    }
  }

  // 启动按钮默认隐藏；悬停、键盘聚焦到卡片内、选中或启动中时显示。
  &:hover,
  &:focus-within,
  &.is-selected,
  &.is-launching {
    .library-card__launch {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
  }

  &.is-selected {
    .library-card__cover {
      outline: 2px solid var(--color-accent);
      outline-offset: 3px;
    }

    .library-card__title {
      color: var(--color-accent-active);
    }
  }
}

.library-card__media {
  position: relative;
}

.library-card__cover {
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

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.library-card__monogram {
  color: rgba(255, 255, 255, 0.5);
  font-size: 32px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 2px;
  line-height: 1;
}

.library-card__badges {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  display: flex;
  gap: var(--space-1);
  max-width: calc(100% - 16px);
}

// 封面图颜色不可控，徽标用深色半透明底保证白字可读。
.library-card__badge {
  height: 20px;
  padding: 0 7px;
  overflow: hidden;
  color: var(--color-text-inverse);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: rgba(21, 25, 34, 0.72);
  border-radius: var(--radius-sm);
}

.library-card__flag {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 var(--space-2);
  font-size: 11.5px;
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-pill);

  &.is-missing {
    color: $warning-text;
    background: rgba(255, 248, 236, 0.96);

    .library-card__dot {
      background: var(--color-warning);
    }
  }

  &.is-unbound {
    color: var(--color-text-secondary);
    background: rgba(255, 255, 255, 0.94);

    .library-card__dot {
      background: var(--color-text-subtle);
    }
  }
}

.library-card__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.library-card__launch {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px 0 12px;
  color: var(--color-text-inverse);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  background: var(--color-accent);
  border: 0;
  border-radius: var(--radius-pill);
  outline: none;
  box-shadow: 0 6px 16px -6px rgba(10, 150, 255, 0.6);
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  &:focus-visible {
    box-shadow:
      0 0 0 2px var(--color-white),
      0 0 0 5px var(--color-accent-soft);
  }

  &:disabled {
    cursor: progress;
  }
}

.library-card__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: library-card-spin 700ms linear infinite;
}

@keyframes library-card-spin {
  to {
    transform: rotate(360deg);
  }
}

.library-card__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 0 2px;
}

.library-card__title,
.library-card__meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.library-card__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  transition: color var(--duration-fast) var(--ease-standard);
}

.library-card__meta {
  color: var(--color-text-muted);
  font-size: 12.5px;

  &.is-warning {
    color: $warning-text;
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-card__cover,
  .library-card__launch,
  .library-card__title {
    transition: none;
  }

  .library-card:hover .library-card__cover {
    transform: none;
  }

  .library-card__launch {
    transform: none;
  }
}
</style>
