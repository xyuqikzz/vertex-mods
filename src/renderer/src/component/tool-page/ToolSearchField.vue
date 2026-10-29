<script setup>
import { ref } from 'vue'
import { toolText as tt } from '@renderer/i18n/tool-text.js'
import ToolIcon from './ToolIcon.vue'

// 工具栏搜索框：与「我的游戏」同规格；Esc 清空，回车触发 submit。
defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'submit', 'clear'])
const inputRef = ref(null)

function clear() {
  emit('update:modelValue', '')
  emit('clear')
  inputRef.value?.focus()
}

function handleKeydown(event, value) {
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('submit', value)
    return
  }
  if (event.key === 'Escape' && value) {
    // 搜索框里的 Esc 只清空内容，不关闭外层弹窗或面板。
    event.stopPropagation()
    clear()
  }
}
</script>

<template>
  <label class="tool-search" :class="{ 'is-wide': wide, 'is-disabled': disabled }">
    <ToolIcon name="search" :size="15" class="tool-search__icon" />
    <input
      ref="inputRef"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label || placeholder"
      :disabled="disabled"
      @input="emit('update:modelValue', $event.target.value)"
      @keydown="handleKeydown($event, modelValue)"
    />
    <button
      v-if="modelValue"
      type="button"
      class="tool-search__clear"
      :aria-label="tt('清除搜索')"
      :title="tt('清除搜索')"
      @click="clear"
    >
      <ToolIcon name="close" :size="10" />
    </button>
  </label>
</template>

<style scoped lang="scss">
.tool-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 220px;
  max-width: 100%;
  height: var(--control-height-md);
  padding: 0 6px 0 var(--space-3);
  color: var(--color-text-muted);
  background: var(--color-surface-hover);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  box-sizing: border-box;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &.is-wide {
    width: 280px;
  }

  &:focus-within {
    background: var(--color-surface);
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  &.is-disabled {
    opacity: 0.6;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 0;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    background: transparent;
    border: 0;
    outline: none;

    &::placeholder {
      color: var(--color-placeholder);
    }
  }
}

.tool-search__clear {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--color-text-muted);
  background: var(--color-surface-strong);
  border: 0;
  border-radius: 50%;
  outline: none;
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-search {
    transition: none;
  }
}
</style>
