<script setup>
import ToolIcon from './ToolIcon.vue'

// 工具页空状态 / 失败状态：56 圆形图标 + 标题 + 说明 + 操作。
defineProps({
  icon: { type: String, default: 'search' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  compact: { type: Boolean, default: false }
})
</script>

<template>
  <div class="tool-empty" :class="{ 'is-compact': compact }">
    <span class="tool-empty__icon" aria-hidden="true">
      <ToolIcon :name="icon" :size="22" />
    </span>
    <h2 class="tool-empty__title">{{ title }}</h2>
    <p v-if="description" class="tool-empty__description">{{ description }}</p>
    <div v-if="$slots.default" class="tool-empty__actions">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: 72px var(--space-6);
  text-align: center;

  &.is-compact {
    padding: var(--space-8) var(--space-6);
  }
}

.tool-empty__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 6px;
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: 50%;
}

.tool-empty__title {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
}

.tool-empty__description {
  max-width: 440px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.tool-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: 10px;
}
</style>
