<script setup>
import { ref } from 'vue'

// 面板内的下划线标签栏：支持计数、禁用态与左右方向键切换。
const props = defineProps({
  modelValue: { type: String, default: '' },
  tabs: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])
const tabRefs = ref([])

function select(tab) {
  if (tab.disabled) return
  emit('update:modelValue', tab.value)
}

function handleKeydown(event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const enabled = props.tabs.map((tab, i) => (tab.disabled ? -1 : i)).filter((i) => i >= 0)
  if (!enabled.length) return
  const position = enabled.indexOf(index)
  let next = enabled[0]
  if (event.key === 'End') next = enabled[enabled.length - 1]
  if (event.key === 'ArrowRight') next = enabled[(position + 1) % enabled.length]
  if (event.key === 'ArrowLeft') next = enabled[(position - 1 + enabled.length) % enabled.length]
  select(props.tabs[next])
  tabRefs.value[next]?.focus()
}
</script>

<template>
  <div class="dev-tabs" role="tablist" :aria-label="ariaLabel || undefined">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.value"
      :ref="(el) => (tabRefs[index] = el)"
      type="button"
      role="tab"
      class="dev-tabs__tab"
      :class="{ 'is-active': tab.value === modelValue }"
      :aria-selected="tab.value === modelValue"
      :tabindex="tab.value === modelValue ? 0 : -1"
      :disabled="tab.disabled"
      :title="tab.disabled ? tab.disabledReason : undefined"
      @click="select(tab)"
      @keydown="handleKeydown($event, index)"
    >
      <span>{{ tab.label }}</span>
      <span v-if="tab.count" class="dev-tabs__count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.dev-tabs {
  display: flex;
  align-items: stretch;
  gap: var(--space-5);
  min-width: 0;
  height: 100%;
}

.dev-tabs__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0;
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  background: transparent;
  border: 0;
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    content: '';
    background: transparent;
    border-radius: 2px 2px 0 0;
    transition: background var(--duration-fast) var(--ease-standard);
  }

  &:hover:not(:disabled) {
    color: var(--color-text-secondary);
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);

    &::after {
      background: var(--color-accent);
    }

    .dev-tabs__count {
      color: var(--color-accent-strong);
      background: var(--color-accent-soft);
    }
  }

  &:focus-visible {
    border-radius: var(--radius-xs);
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--color-text-subtle);
    cursor: not-allowed;
  }
}

.dev-tabs__count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  line-height: 18px;
  text-align: center;
  background: var(--color-surface-strong);
  border-radius: var(--radius-pill);
}
</style>
