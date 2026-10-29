<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref } from 'vue'
import { RightOutlined } from '@ant-design/icons-vue'
import { formatAgentPermissionLine } from './agentPermissionView.js'

const props = defineProps({
  toolCalls: { type: Array, default: () => [] },
  // 进行中的步骤：始终展开，不显示折叠按钮。
  live: { type: Boolean, default: false }
})

const expanded = ref(false)

const failedCount = computed(() => props.toolCalls.filter((item) => resolveStatus(item) === 'failed').length)
const runningCount = computed(() => props.toolCalls.filter((item) => resolveStatus(item) === 'running').length)
const showList = computed(() => props.live || expanded.value)

function formatArguments(call = {}) {
  try {
    const text = JSON.stringify(call.arguments || {})
    return text.length > 200 ? `${text.slice(0, 200)}...` : text
  } catch {
    return '{}'
  }
}

function resolveStatus(call = {}) {
  if (['running', 'waiting', 'failed', 'success'].includes(call.status)) return call.status
  if (call.confirmationRequired === true) return 'waiting'
  return call.success === false ? 'failed' : 'success'
}

function resolveTitle(call = {}) {
  return String(call.title || call.name || uiText('ui.toolCall'))
}

// 新记录带可读的步骤说明；旧记录没有标题时仍显示原始参数，便于排查。
function resolveDetail(call = {}) {
  if (call.detail) return String(call.detail)
  return call.title ? '' : formatArguments(call)
}

function resolveStatusText(call = {}) {
  const status = resolveStatus(call)
  if (status === 'running') return uiText('taskCenter.views.active')
  if (status === 'waiting') return uiText('tools.unconfirmed')
  if (status === 'failed') return call.errorCode || uiText('ui.failed')
  return uiText('localMod.done')
}
</script>

<template>
  <!-- 根节点使用 display: contents，切换按钮与结果状态排在同一行，展开的步骤列表另起一行。 -->
  <div v-if="toolCalls.length" class="agent-tool-trace" :class="{ 'is-live': live }">
    <button
      v-if="!live"
      type="button"
      class="agent-tool-trace__toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span>{{ $t('ui.used') }} {{ toolCalls.length }} {{ $t('ui.tools') }}</span>
      <span v-if="runningCount" class="agent-tool-trace__running">{{ runningCount }} {{ $t('ui.running') }}</span>
      <span v-if="failedCount" class="agent-tool-trace__failed">{{ failedCount }} {{ $t('ui.failedVariant2') }}</span>
      <RightOutlined class="agent-tool-trace__icon" :class="{ 'is-expanded': expanded }" />
    </button>

    <ol v-if="showList" class="agent-tool-trace__list" :aria-live="live ? 'polite' : undefined">
      <li
        v-for="(call, index) in toolCalls"
        :key="call.id || `${call.name}-${index}`"
        class="agent-tool-trace__item"
        :class="`is-${resolveStatus(call)}`"
      >
        <div class="agent-tool-trace__line">
          <span class="agent-tool-trace__name" :title="call.name">{{ resolveTitle(call) }}</span>
          <span class="agent-tool-trace__status">{{ resolveStatusText(call) }}</span>
        </div>
        <div
          v-if="resolveDetail(call)"
          class="agent-tool-trace__args"
          :class="{ 'is-raw': !call.detail }"
          :title="formatArguments(call)"
        >
          {{ resolveDetail(call) }}
        </div>
        <div v-if="formatAgentPermissionLine(call)" class="agent-tool-trace__permission">
          {{ formatAgentPermissionLine(call) }}
        </div>
        <div v-if="resolveStatus(call) === 'failed' && call.message" class="agent-tool-trace__message">
          {{ call.message }}
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped lang="scss">
.agent-tool-trace {
  display: contents;
}

// 行首没有结果状态时，按钮文字与正文左缘对齐。
.agent-tool-trace:first-child > .agent-tool-trace__toggle {
  margin-left: -6px;
}

.agent-tool-trace__toggle {
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text-secondary);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 1px;
  }
}

.agent-tool-trace__failed {
  color: var(--color-warning-strong);
}

.agent-tool-trace__running {
  color: var(--color-accent-active);
}

.agent-tool-trace__icon {
  font-size: 9px;
  transition: transform var(--duration-fast) var(--ease-standard);

  &.is-expanded {
    transform: rotate(90deg);
  }
}

// 步骤列表：左侧细线串起每次调用，成功为绿色节点，失败为橙色节点，进行中为闪烁的主色节点。
.agent-tool-trace__list {
  flex: 1 0 100%;
  margin: 2px 0 4px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-tool-trace__item {
  position: relative;
  min-width: 0;
  padding-left: 18px;

  &::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 6px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 0 2px var(--color-surface);
  }

  &:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 15px;
    bottom: -10px;
    width: 1px;
    background: var(--color-border);
  }

  &.is-failed::before {
    background: var(--color-warning);
  }

  &.is-waiting::before {
    background: var(--color-accent);
  }

  &.is-running::before {
    background: var(--color-accent);
    animation: agent-step-pulse 1.2s ease-in-out infinite;
  }
}

.agent-tool-trace__line {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--font-size-xs);
  line-height: 18px;
}

.agent-tool-trace__name {
  min-width: 0;
  color: var(--color-text-secondary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-tool-trace__status {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 11px;

  .is-failed & {
    color: var(--color-warning-strong);
  }

  .is-running &,
  .is-waiting & {
    color: var(--color-accent-active);
  }
}

.agent-tool-trace__args {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;

  &.is-raw {
    font-family: Consolas, 'Courier New', monospace;
  }
}

.agent-tool-trace__permission {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.agent-tool-trace__message {
  margin-top: 3px;
  color: var(--color-warning-strong);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

@keyframes agent-step-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-tool-trace__toggle,
  .agent-tool-trace__icon {
    transition: none;
  }

  .agent-tool-trace__item.is-running::before {
    animation: none;
  }
}
</style>
