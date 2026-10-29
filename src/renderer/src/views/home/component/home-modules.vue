<script setup>
defineProps({
  moduleList: {
    type: Array,
    default: () => []
  },
  iconMap: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['use-module'])

function useModule(data) {
  emit('use-module', data)
}
</script>

<template>
  <nav class="modules-section" :aria-label="$t('home.modules')">
    <button
      v-for="item in moduleList"
      :key="item.path || item.name"
      type="button"
      class="module-card"
      :class="{ disabled: item.isNotEnabled }"
      :aria-disabled="item.isNotEnabled ? 'true' : undefined"
      @click="useModule(item)"
    >
      <span class="module-icon" aria-hidden="true">
        <component :is="iconMap[item.svgName]" />
      </span>
      <span class="module-content">
        <span class="module-title">{{ item.name }}</span>
        <span class="module-desc">{{ item.description }}</span>
      </span>
      <svg class="module-arrow" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  </nav>
</template>

<style scoped lang="scss">
$color-primary: #0a96ff;
$color-text-primary: #1a2233;
$color-text-secondary: #5c6b7f;
$color-text-tertiary: #8b99ab;

.modules-section {
  min-width: 0;
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.module-card {
  min-width: 0;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 22px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    box-shadow var(--duration-base) var(--ease-standard),
    border-color var(--duration-base) var(--ease-standard);

  &:hover {
    border-color: rgba(10, 150, 255, 0.16);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);

    .module-arrow {
      color: $color-primary;
      transform: translateX(2px);
    }
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }

  &.disabled {
    opacity: 0.6;
    cursor: not-allowed;
    filter: grayscale(1);
  }
}

.module-icon {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(10, 150, 255, 0.08);
  color: $color-primary;

  :deep(svg) {
    width: 22px;
    height: 22px;

    path:not([fill='none']),
    circle:not([fill='none']),
    rect:not([fill='none']) {
      fill: currentColor;
    }

    [stroke]:not([stroke='none']) {
      stroke: currentColor;
    }
  }
}

.module-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.module-title {
  color: $color-text-primary;
  font-size: 15px;
  font-weight: 600;
}

.module-desc {
  overflow: hidden;
  color: $color-text-secondary;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.module-arrow {
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: $color-text-tertiary;
  transition:
    color var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);
}

@media (max-width: 1280px) {
  .modules-section {
    grid-template-rows: none;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .module-card,
  .module-arrow {
    transition: none;
  }
}
</style>
