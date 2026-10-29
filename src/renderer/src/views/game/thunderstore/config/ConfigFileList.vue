<script setup>
import { ref } from 'vue'
import { ToolSearchField } from '@renderer/component/tool-page'

// 左栏文件列表：匹配「包名」/ 模组 / 加载器 / 其他文件（默认收起）。
const props = defineProps({
  // [{ key, label, items: [{ relativePath, displayName, subtitle, dirty }], collapsible }]
  groups: { type: Array, default: () => [] },
  selectedPath: { type: String, default: '' },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  // 从模组管理带包名进来但没匹配到文件时的提示。
  notice: { type: Object, default: null }
})

const emit = defineEmits(['update:keyword', 'select'])

const collapsedKeys = ref(new Set(['other']))

function isCollapsed(group) {
  return group.collapsible && !props.keyword && collapsedKeys.value.has(group.key)
}

function toggleGroup(group) {
  const next = new Set(collapsedKeys.value)
  if (next.has(group.key)) next.delete(group.key)
  else next.add(group.key)
  collapsedKeys.value = next
}
</script>

<template>
  <nav class="config-files" :aria-label="$t('ui.configurationFile')">
    <div class="config-files__search">
      <ToolSearchField
        :model-value="keyword"
        :placeholder="$t('ui.searchFilesOrMods')"
        @update:model-value="emit('update:keyword', $event)"
      />
    </div>

    <div class="config-files__body vx-ui-scrollbar">
      <div v-if="notice" class="config-files__notice" role="status">
        <strong>{{ notice.title }}</strong>
        <span>{{ notice.text }}</span>
      </div>

      <template v-if="loading && !groups.length">
        <div v-for="index in 6" :key="index" class="config-files__skeleton" aria-hidden="true">
          <span class="tool-skeleton is-name"></span>
          <span class="tool-skeleton is-path"></span>
        </div>
      </template>

      <p v-else-if="!groups.length && keyword" class="config-files__empty">
        {{ $t('ui.noFilesMatch') }}{{ keyword }}{{ $t('ui.undefinedVariant2') }}
      </p>

      <section v-for="group in groups" :key="group.key" class="config-files__group">
        <h3 class="config-files__group-head">
          <button
            v-if="group.collapsible && !keyword"
            type="button"
            class="config-files__toggle"
            :aria-expanded="!isCollapsed(group)"
            @click="toggleGroup(group)"
          >
            <svg
              class="config-files__chevron"
              :class="{ 'is-collapsed': isCollapsed(group) }"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
            {{ group.label }}
          </button>
          <span v-else>{{ group.label }}</span>
          <span class="config-files__count">{{ group.items.length }}</span>
        </h3>
        <ul v-if="!isCollapsed(group)" class="config-files__list">
          <li v-for="item in group.items" :key="item.relativePath">
            <button
              type="button"
              class="config-files__item"
              :class="{ 'is-active': item.relativePath === selectedPath }"
              :aria-current="item.relativePath === selectedPath ? 'page' : undefined"
              :title="item.relativePath"
              @click="emit('select', item.relativePath)"
            >
              <span class="config-files__name">
                <span class="config-files__name-text">{{ item.displayName }}</span>
                <span
                  v-if="item.dirty"
                  class="config-files__dot"
                  :aria-label="$t('ui.unsavedChangesVariant2')"
                ></span>
              </span>
              <span class="config-files__path">{{ item.subtitle }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.config-files {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface-soft);
  border-right: 1px solid var(--color-surface-strong);
}

.config-files__search {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-3) var(--space-1);

  :deep(.tool-search) {
    width: 100%;
  }
}

.config-files__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 var(--space-2) var(--space-3);
  overflow-x: hidden;
  overflow-y: auto;
}

.config-files__notice {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--space-2) var(--space-1) 0;
  padding: 10px var(--space-3);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--color-surface-hover);
  border-radius: var(--radius-md);

  strong {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
  }
}

.config-files__empty {
  margin: var(--space-6) var(--space-3);
  color: var(--color-text-muted);
  font-size: 12.5px;
  text-align: center;
}

.config-files__skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px var(--space-3);

  .is-name {
    width: 60%;
    height: 12px;
  }

  .is-path {
    width: 82%;
    height: 10px;
  }
}

.config-files__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 14px 10px 4px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.config-files__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: inherit;
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

.config-files__chevron {
  transition: transform var(--duration-fast) var(--ease-standard);

  &.is-collapsed {
    transform: rotate(-90deg);
  }
}

.config-files__count {
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-regular);
}

.config-files__list {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    min-width: 0;
  }
}

// 用单列 grid 而不是 flex 纵排：minmax(0, 1fr) 让长文件名一定能收缩并显示省略号。
// 新版 Chromium 里 <button> 的最小宽度可能按内容计算，所以同时写明 min-width: 0。
.config-files__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 44px;
  overflow: hidden;
  padding: 6px 10px 6px var(--space-3);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &.is-active {
    background: color-mix(in srgb, var(--color-accent-soft) 45%, var(--color-white));

    .config-files__name {
      color: var(--color-accent-strong);
      font-weight: var(--font-weight-semibold);
    }
  }
}

.config-files__name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  font-size: 13.5px;
  font-weight: var(--font-weight-medium);
}

.config-files__name-text,
.config-files__path {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-files__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  background: var(--color-warning);
  border-radius: 50%;
}

.config-files__path {
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
  font-size: 11.5px;
}
</style>
