<script setup>
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const { t } = useI18n()
const props = defineProps({
  keyword: {
    type: String,
    default: ''
  },
  totalCount: {
    type: Number,
    default: 0
  },
  layoutMode: {
    type: String,
    default: 'horizontal'
  }
})

const emit = defineEmits(['update:keyword', 'update:layout-mode'])

const LAYOUT_OPTIONS = computed(() => [
  { value: 'vertical', label: t('quickLaunch.vertical') },
  { value: 'horizontal', label: t('quickLaunch.horizontal') }
])

function updateKeyword(event) {
  emit('update:keyword', event.target.value)
}

function clearKeyword() {
  emit('update:keyword', '')
}

function updateLayoutMode(value) {
  if (value !== props.layoutMode) emit('update:layout-mode', value)
}

function handleKeydown(event) {
  if (event.key === 'Escape' && props.keyword) {
    event.preventDefault()
    clearKeyword()
  }
}

defineOptions({
  name: 'QuickLaunchToolbar'
})
</script>

<template>
  <header class="ql-toolbar">
    <div class="ql-toolbar__copy">
      <h2 class="ql-toolbar__title">{{ t('quickLaunch.title') }}</h2>
    </div>

    <div v-if="totalCount > 0 || keyword" class="ql-toolbar__tools">
      <div class="ql-toolbar__layout" role="group" :aria-label="t('quickLaunch.layout')">
        <button
          v-for="option in LAYOUT_OPTIONS"
          :key="option.value"
          type="button"
          class="ql-toolbar__layout-btn"
          :data-active="layoutMode === option.value"
          :aria-pressed="layoutMode === option.value ? 'true' : 'false'"
          :aria-label="option.label"
          :title="option.label"
          @click="updateLayoutMode(option.value)"
        >
          <svg v-if="option.value === 'vertical'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="7" height="14" rx="1.5" />
            <rect x="14" y="5" width="7" height="14" rx="1.5" />
          </svg>
        </button>
      </div>

      <label class="ql-toolbar__search">
        <svg class="ql-toolbar__search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span class="ql-visually-hidden">{{ t('quickLaunch.search') }}</span>
        <input
          :value="keyword"
          type="search"
          :placeholder="t('quickLaunch.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @input="updateKeyword"
          @keydown="handleKeydown"
        />
        <button
          v-if="keyword"
          type="button"
          class="ql-toolbar__clear"
          :aria-label="t('quickLaunch.clear')"
          @click="clearKeyword"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
        </button>
      </label>
    </div>
  </header>
</template>

<style scoped lang="scss">
.ql-toolbar {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.ql-toolbar__copy {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ql-toolbar__title {
  margin: 0;
  color: #1a2233;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.ql-toolbar__tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

// 排列方式切换：沿用原快捷启动工具栏样式
.ql-toolbar__layout {
  flex: none;
  height: 40px;
  box-sizing: border-box;
  padding: 3px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
}

.ql-toolbar__layout-btn {
  width: 36px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8b99ab;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover {
    color: #1a2233;
  }

  &[data-active='true'] {
    background: #ffffff;
    color: #0a96ff;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 1px;
  }
}

.ql-toolbar__search {
  position: relative;
  width: 260px;
  max-width: 100%;
  height: 40px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  background: #ffffff;
  color: #8b99ab;
  transition: border-color var(--duration-base) var(--ease-standard);

  &:focus-within {
    border-color: rgba(10, 150, 255, 0.5);
    box-shadow: 0 0 0 3px rgba(10, 150, 255, 0.1);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: #1a2233;
    font: inherit;
    font-size: 13px;

    &::placeholder {
      color: #8b99ab;
    }

    &::-webkit-search-cancel-button {
      display: none;
    }
  }
}

.ql-toolbar__search-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.ql-toolbar__clear {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  &:hover {
    background: rgba(148, 163, 184, 0.14);
    color: #1a2233;
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 1px;
  }
}

.ql-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
