<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import DevIcon from './DevIcon.vue'

const emit = defineEmits(['openDirectory', 'openDevTools', 'generateUuid'])

const quickActions = [
  { key: 'root', get title() { return uiText('ui.applicationFolder') }, desc: '查看应用安装位置', icon: 'folder' },
  { key: 'database', get title() { return uiText('ui.databaseFolder') }, desc: '定位本地数据存储', icon: 'database' },
  { key: 'cache', get title() { return uiText('ui.cacheFolder') }, desc: '管理临时文件目录', icon: 'archive' },
  { key: 'uuid', get title() { return uiText('ui.generateUUID') }, desc: '生成 V4 UUID 并复制', icon: 'hash' },
  { key: 'devtools', get title() { return uiText('ui.developerTools') }, desc: '打开 DevTools 调试窗口', icon: 'code' }
]

function handleAction(action) {
  if (action.key === 'uuid') {
    emit('generateUuid')
    return
  }

  if (action.key === 'devtools') {
    emit('openDevTools')
    return
  }

  emit('openDirectory', action.key)
}
</script>

<template>
  <section class="quick-panel" aria-labelledby="dev-quick-title">
    <h2 id="dev-quick-title" class="quick-panel__title">{{ $t('ui.quickCommands') }}</h2>

    <div class="quick-panel__grid">
      <button
        v-for="action in quickActions"
        :key="action.key"
        type="button"
        class="command-tile"
        :title="action.desc"
        @click="handleAction(action)"
      >
        <span class="command-tile__icon">
          <DevIcon :name="action.icon" :size="16" />
        </span>
        <span class="command-tile__text">
          <span class="command-tile__title">{{ action.title }}</span>
          <span class="command-tile__desc">{{ action.desc }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.quick-panel {
  display: grid;
  gap: var(--space-2);
}

.quick-panel__title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-base);
}

.quick-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(188px, 1fr));
  gap: var(--space-2);
}

.command-tile {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 52px;
  padding: var(--space-2) var(--space-3) var(--space-2) 10px;
  color: var(--color-text);
  font-family: var(--font-family-base);
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);

    .command-tile__icon {
      color: var(--color-accent-active);
      background: var(--color-accent-soft);
    }
  }

  &:active {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }
}

.command-tile__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border-radius: var(--radius-sm);
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.command-tile__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.command-tile__title,
.command-tile__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-tile__title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}

.command-tile__desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
}
</style>
