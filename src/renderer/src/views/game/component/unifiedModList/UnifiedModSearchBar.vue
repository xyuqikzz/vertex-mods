<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { localizeModUiText } from '@renderer/i18n/mod-browser-ui.js'
import { VxButton, VxSelect } from '@renderer/component/vertex-ui'

const props = defineProps({
  keyword: {
    type: String,
    default: ''
  },
  keywordPlaceholder: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  disableSearch: {
    type: Boolean,
    default: false
  },
  filterValue: {
    type: [String, Number],
    default: ''
  },
  filterOptions: {
    type: Array,
    default: () => []
  },
  showFilter: {
    type: Boolean,
    default: false
  },
  sort: {
    type: [String, Number],
    default: ''
  },
  sortOptions: {
    type: Array,
    default: () => []
  },
  showSort: {
    type: Boolean,
    default: true
  },
  searchButtonText: {
    type: String,
    default: ''
  },
  // 来源站点提供的模组分类：[{ value, label }]，空值代表「全部」。
  category: {
    type: [String, Number],
    default: ''
  },
  categoryOptions: {
    type: Array,
    default: () => []
  },
  categoryVisibleCount: {
    type: Number,
    default: 8
  }
})

const emit = defineEmits([
  'update:keyword',
  'update:filterValue',
  'update:sort',
  'update:category',
  'search',
  'reset'
])
const { t } = useI18n()

const controlDisabled = () => props.loading || props.disableSearch

// 吸顶后加一层浅阴影，和下方滚动的内容分开。
// top 设为 -1px：吸顶时顶部有 1px 被裁掉，交叉比例小于 1 即视为已吸顶。
const barRef = ref(null)
const isStuck = ref(false)
let stickyObserver = null

onMounted(() => {
  const el = barRef.value
  if (!el || typeof IntersectionObserver === 'undefined') return
  stickyObserver = new IntersectionObserver(
    ([entry]) => {
      const rootTop = entry.rootBounds?.top ?? 0
      isStuck.value = entry.intersectionRatio < 1 && entry.boundingClientRect.top <= rootTop + 1
    },
    { root: el.closest('.page-body'), threshold: [1] }
  )
  stickyObserver.observe(el)
})

onBeforeUnmount(() => stickyObserver?.disconnect())

// ---------- 分类 ----------
const normalizedCategories = computed(() =>
  (Array.isArray(props.categoryOptions) ? props.categoryOptions : [])
    .map((option) => ({
      value: String(option?.value ?? '').trim(),
      label: String(option?.label || '').trim()
    }))
    .filter((option) => option.value && option.label)
)
const visibleCategories = computed(() =>
  normalizedCategories.value.slice(0, Math.max(props.categoryVisibleCount, 0))
)
const overflowCategories = computed(() =>
  normalizedCategories.value.slice(Math.max(props.categoryVisibleCount, 0))
)
const currentCategory = computed(() => String(props.category ?? '').trim())
const overflowValue = computed(() =>
  overflowCategories.value.some((option) => option.value === currentCategory.value)
    ? currentCategory.value
    : ''
)

function selectCategory(value) {
  const next = String(value ?? '').trim()
  if (next === currentCategory.value) return
  emit('update:category', next)
}

// ---------- Ctrl+F 聚焦搜索框 ----------
// 只在当前页面可见时响应；KeepAlive 缓存的其他列表页不抢焦点，弹窗打开时也不处理。
const inputRef = ref(null)
const inputFocused = ref(false)
let pageActive = true

function handleShortcut(event) {
  if (!pageActive || event.defaultPrevented || event.altKey || event.shiftKey) return
  if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== 'f') return
  const input = inputRef.value
  if (!input || input.disabled || !input.isConnected || input.offsetParent === null) return
  if (document.querySelector('.base-dialog, [role="dialog"][aria-modal="true"]')) return
  event.preventDefault()
  input.focus()
  input.select()
}

onMounted(() => window.addEventListener('keydown', handleShortcut))
onActivated(() => {
  pageActive = true
})
onDeactivated(() => {
  pageActive = false
})
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))

function onKeywordInput(value) {
  emit('update:keyword', String(value || ''))
}

function onFilterChange(value) {
  emit('update:filterValue', value)
}

function onSortChange(value) {
  emit('update:sort', value)
}

function onSearch() {
  emit('search')
}

function onReset() {
  emit('update:keyword', '')
  emit('reset')
}
</script>

<template>
  <div ref="barRef" class="unified-search-bar" :class="{ 'is-stuck': isStuck }" role="search">
    <div class="search-field-group">
      <label class="search-field" :class="{ 'is-disabled': controlDisabled() }">
        <svg class="search-field__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          ref="inputRef"
          :value="keyword"
          type="text"
          class="search-field__input"
          :placeholder="localizeModUiText(keywordPlaceholder) || t('modBrowser.searchPlaceholder')"
          :aria-label="localizeModUiText(keywordPlaceholder) || t('modBrowser.searchPlaceholder')"
          :disabled="controlDisabled()"
          :aria-keyshortcuts="'Control+F'"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
          @input="onKeywordInput($event.target.value)"
          @keydown.enter.prevent="onSearch"
          @keydown.esc="keyword && onReset()"
        />
        <kbd v-if="!keyword && !inputFocused" class="search-field__shortcut" aria-hidden="true">{{
          t('modBrowser.searchShortcut')
        }}</kbd>
        <button
          v-if="keyword && !controlDisabled()"
          type="button"
          class="search-field__clear"
          :aria-label="t('modBrowser.clearSearch')"
          @click="onReset"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
        </button>
      </label>
      <VxButton
        variant="secondary"
        class="search-submit"
        :loading="loading"
        :disabled="disableSearch"
        @click="onSearch"
      >
        {{ localizeModUiText(searchButtonText) || t('modBrowser.search') }}
      </VxButton>
    </div>

    <div class="search-right">
      <slot name="right-before"></slot>

      <div v-if="showFilter" class="search-select search-select--filter">
        <VxSelect
          :model-value="filterValue"
          :options="filterOptions"
          :disabled="controlDisabled()"
          :aria-label="t('modBrowser.filter')"
          @update:model-value="onFilterChange"
        />
      </div>

      <div v-if="showSort" class="search-select search-select--sort">
        <span class="search-select__label" aria-hidden="true">{{ t('modBrowser.sort') }}</span>
        <VxSelect
          :model-value="sort"
          :options="sortOptions"
          :disabled="controlDisabled()"
          :aria-label="t('modBrowser.sortBy')"
          @update:model-value="onSortChange"
        />
      </div>

      <slot name="right"></slot>
    </div>

    <div
      v-if="normalizedCategories.length"
      class="search-categories"
      role="group"
      :aria-label="t('modBrowser.categoryFilter')"
    >
      <button
        type="button"
        class="category-pill"
        :class="{ 'is-active': !currentCategory }"
        :aria-pressed="!currentCategory"
        :disabled="controlDisabled()"
        @click="selectCategory('')"
      >
        {{ t('modBrowser.allCategories') }}
      </button>
      <button
        v-for="option in visibleCategories"
        :key="option.value"
        type="button"
        class="category-pill"
        :class="{ 'is-active': currentCategory === option.value }"
        :aria-pressed="currentCategory === option.value"
        :title="option.label"
        :disabled="controlDisabled()"
        @click="selectCategory(option.value)"
      >
        {{ option.label }}
      </button>
      <div
        v-if="overflowCategories.length"
        class="category-more"
        :class="{ 'is-active': !!overflowValue }"
      >
        <VxSelect
          :model-value="overflowValue"
          :options="overflowCategories"
          :placeholder="t('modBrowser.moreCategories')"
          :disabled="controlDisabled()"
          :aria-label="t('modBrowser.moreCategories')"
          @update:model-value="selectCategory"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.unified-search-bar {
  --search-bar-gutter: var(--page-body-padding, 24px);

  position: sticky;
  top: -1px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  // 不再是一张卡片：平时与页面底色融为一体，只有输入框和下拉框自带边框；
  // 左右延伸到页面内边距，吸顶后成为一条通栏工具栏。
  margin: var(--space-2) calc(-1 * var(--search-bar-gutter)) 0;
  padding: var(--space-2) var(--search-bar-gutter);
  background: var(--app-view-bc, var(--color-bg));
  transition: box-shadow var(--duration-base) var(--ease-standard);

  &.is-stuck {
    box-shadow:
      0 1px 0 var(--color-border),
      var(--shadow-sm);
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
}

.search-field-group {
  display: flex;
  flex: 1 1 360px;
  min-width: 0;
  max-width: 640px;
}

.search-field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-height-md);
  padding: 0 6px 0 var(--space-3);
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  cursor: text;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-disabled) {
    border-color: var(--color-border-strong);
  }

  // Windows 11 输入框焦点：底部主色强调线，不再整圈外发光。
  &:focus-within {
    position: relative;
    z-index: 1;
    border-color: var(--color-border-strong);
    border-right: 1px solid var(--color-border-strong);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }

  &.is-disabled {
    background: var(--control-bg-disabled);
    cursor: not-allowed;
  }
}

.search-field__icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
}

.search-field__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-md);
  background: transparent;
  border: 0;
  outline: none;

  &::placeholder {
    color: var(--color-placeholder);
  }

  &:disabled {
    color: var(--control-text-disabled);
    cursor: not-allowed;
  }
}

.search-field__clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 0;
  }
}

.search-submit {
  flex: none;
  min-width: 72px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--color-surface-soft);
}

.search-right {
  display: flex;
  flex: 0 1 auto;
  margin-left: auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.search-select {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.search-select :deep(.vx-select-field) {
  width: 148px;
}

.search-field__shortcut {
  flex: none;
  padding: 0 5px;
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: 11px;
  line-height: 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}

// ---------- 分类 ----------
.search-categories {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.category-pill {
  max-width: 200px;
  height: 30px;
  padding: 0 14px;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled):not(.is-active) {
    color: var(--color-text);
    border-color: var(--color-border-strong);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &.is-active {
    color: var(--color-text-inverse);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.category-more {
  :deep(.vx-select-field) {
    width: 148px;
  }

  // 与分类胶囊同高同形，选中溢出分类时用主色描边提示。
  :deep(.vx-select) {
    min-height: 30px;
    height: 30px;
    border-radius: var(--radius-pill);
    font-size: var(--font-size-sm);
  }

  &.is-active :deep(.vx-select) {
    color: var(--color-accent-strong);
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }
}

.search-select__label {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
