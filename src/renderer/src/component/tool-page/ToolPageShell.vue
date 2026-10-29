<script setup>
import { computed, ref, useId } from 'vue'
import ToolIcon from './ToolIcon.vue'

// 游戏工具 / 系统工具共用外壳：白色容器 + 顶部模块页签 + 内部滚动区。
const props = defineProps({
  // [{ key, name, summary, icon }]，文案由调用方翻译后传入。
  tools: { type: Array, required: true },
  modelValue: { type: String, required: true },
  label: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])
const baseId = useId()
const tabRefs = ref([])
const panelRef = ref(null)

const activeTool = computed(
  () => props.tools.find((tool) => tool.key === props.modelValue) || props.tools[0]
)
const tabId = (key) => `${baseId}-tab-${key}`
const panelId = `${baseId}-panel`

function select(tool) {
  if (tool.key !== props.modelValue) emit('update:modelValue', tool.key)
}

// 页签按 WAI-ARIA tabs 模式：左右方向键、Home、End 切换并移动焦点。
function handleKeydown(event, index) {
  const count = props.tools.length
  const next = {
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index - 1 + count) % count,
    Home: 0,
    End: count - 1
  }[event.key]
  if (next === undefined) return
  event.preventDefault()
  select(props.tools[next])
  tabRefs.value[next]?.focus()
}

defineExpose({ panel: panelRef })
</script>

<template>
  <section class="tool-page" :aria-label="label || undefined">
    <div class="tool-page__bar">
      <div class="tool-page__tabs" role="tablist" :aria-label="label || undefined">
        <button
          v-for="(tool, index) in tools"
          :id="tabId(tool.key)"
          :key="tool.key"
          ref="tabRefs"
          type="button"
          role="tab"
          class="tool-page__tab"
          :class="{ 'is-active': tool.key === activeTool.key }"
          :aria-selected="tool.key === activeTool.key"
          :aria-controls="panelId"
          :tabindex="tool.key === activeTool.key ? 0 : -1"
          :title="tool.summary || undefined"
          @click="select(tool)"
          @keydown="handleKeydown($event, index)"
        >
          <ToolIcon v-if="tool.icon" :name="tool.icon" />
          {{ tool.name }}
        </button>
      </div>
      <p v-if="activeTool?.summary" class="tool-page__summary">{{ activeTool.summary }}</p>
    </div>

    <div
      :id="panelId"
      ref="panelRef"
      class="tool-page__panel"
      role="tabpanel"
      :aria-labelledby="activeTool ? tabId(activeTool.key) : undefined"
    >
      <slot></slot>
    </div>
  </section>
</template>

<style scoped lang="scss">
.tool-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.tool-page__bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0 var(--space-6);
  padding: 0 var(--space-7);
  border-bottom: 1px solid var(--color-border);
}

.tool-page__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-7);
  min-width: 0;
}

.tool-page__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 52px;
  padding: 0;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  :deep(.tool-icon) {
    color: var(--color-text-muted);
  }

  &::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    background: transparent;
    border-radius: 2px;
    content: '';
  }

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);

    :deep(.tool-icon) {
      color: var(--color-accent-active);
    }

    &::after {
      background: var(--color-accent);
    }
  }
}

.tool-page__summary {
  display: flex;
  align-items: center;
  margin: 0 0 0 auto;
  padding: var(--space-2) 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.tool-page__panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-5) var(--space-7) var(--space-8);
  overflow-x: hidden;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--radius-sm);
  }

  &::-webkit-scrollbar-thumb {
    min-height: 40px;
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

@media (max-width: 720px) {
  .tool-page__bar,
  .tool-page__panel {
    padding-right: var(--space-4);
    padding-left: var(--space-4);
  }

  .tool-page__summary {
    width: 100%;
    margin-left: 0;
    padding-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-page__tab {
    transition: none;
  }
}
</style>
