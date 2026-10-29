<script setup>
import { computed } from 'vue'
import { resolveUiMessage } from '@renderer/i18n/message.js'
import { messageTip, messageTipStack } from '@renderer/common/message-tip.js'

const MAX_VISIBLE_TIPS = 3

function getPanelStyle(item, index) {
  return {
    width: item.width,
    zIndex: MAX_VISIBLE_TIPS - index,
    '--stack-offset': `${index * 9}px`,
    '--stack-scale': `${Math.max(0.92, 1 - index * 0.015)}`,
    '--stack-opacity': `${Math.max(0.68, 1 - index * 0.08)}`
  }
}

function getRole(type) {
  return type === 'error' || type === 'warning' ? 'alert' : 'status'
}

const hasTips = computed(() => messageTipStack.length > 0)
const visibleTips = computed(() => messageTipStack.slice(0, MAX_VISIBLE_TIPS))

function handleClose(id) {
  messageTip.close(id)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="hasTips" class="global-message-tip" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="global-message-tip-stack" tag="div" class="global-message-tip__stack">
        <article
          v-for="(item, index) in visibleTips"
          :key="item.id"
          class="global-message-tip__panel"
          :class="[`is-${item.type}`, { 'is-top': index === 0 }]"
          :style="getPanelStyle(item, index)"
          :role="getRole(item.type)"
        >
          <button
            v-if="item.showClose"
            type="button"
            class="global-message-tip__close"
            :aria-label="$t('ui.dismissNotification')"
            @click="handleClose(item.id)"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6 6 18" />
            </svg>
          </button>

          <div class="global-message-tip__header">
            <div v-if="item.showIcon" class="global-message-tip__icon" :class="`is-${item.type}`">
              <svg
                v-if="item.type === 'success'"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m7.5 12.5 3 3 6-7" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              <svg
                v-else-if="item.type === 'error'"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 8v5" />
                <path d="M12 17h.01" />
                <path
                  d="M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"
                />
              </svg>
              <svg
                v-else-if="item.type === 'warning'"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>

            <div class="global-message-tip__content">
              <h3 class="global-message-tip__title">{{ resolveUiMessage(item.title) }}</h3>
              <p v-if="item.content" class="global-message-tip__description">
                {{ resolveUiMessage(item.content) }}
              </p>
            </div>
          </div>
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.global-message-tip {
  position: fixed;
  top: 22px;
  left: 0;
  right: var(--assistant-dock-inset, 0px);
  /* 消息提示位于最高层级，始终在通用弹窗与确认弹窗之上 */
  z-index: var(--z-index-toast, 5000);
  display: flex;
  justify-content: center;
  pointer-events: none;
  padding: 0 16px;
}

.global-message-tip__stack {
  position: relative;
  width: min(520px, calc(100vw - 32px));
  min-height: 1px;
}

.global-message-tip__panel {
  position: absolute;
  top: 0;
  left: 50%;
  pointer-events: auto;
  width: min(520px, calc(100vw - 32px));
  transform: translateX(-50%) translateY(var(--stack-offset, 0px)) scale(var(--stack-scale, 1));
  transform-origin: top center;
  /* 卡片之间不再互相覆盖层级，依赖容器统一 z-index，仅做视觉错位 */
  opacity: var(--stack-opacity, 1);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%);
  box-shadow:
    0 20px 50px rgba(15, 23, 42, 0.16),
    0 2px 8px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  padding: 10px 14px;
  color: var(--color-text-primary);
  transition:
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.18s ease,
    filter 0.18s ease,
    box-shadow 0.18s ease;
}

.global-message-tip__panel.is-success {
  border-color: rgba(52, 199, 89, 0.16);
}

.global-message-tip__panel.is-error {
  border-color: rgba(255, 59, 48, 0.16);
}

.global-message-tip__panel.is-warning {
  border-color: rgba(255, 149, 0, 0.16);
}

.global-message-tip__panel.is-top {
  box-shadow:
    0 24px 56px rgba(15, 23, 42, 0.18),
    0 4px 12px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.74);
}

.global-message-tip__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.global-message-tip__icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(0, 122, 255, 0.08);
  border: 1px solid rgba(0, 122, 255, 0.08);
  color: #007aff;
}

.global-message-tip__icon.is-success {
  background: rgba(52, 199, 89, 0.08);
  border-color: rgba(52, 199, 89, 0.1);
  color: #34c759;
}

.global-message-tip__icon.is-error {
  background: rgba(255, 59, 48, 0.08);
  border-color: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.global-message-tip__icon.is-warning {
  background: rgba(255, 149, 0, 0.08);
  border-color: rgba(255, 149, 0, 0.1);
  color: #ff9500;
}

.global-message-tip__content {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}

.global-message-tip__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  line-height: 1.3;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}

.global-message-tip__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.global-message-tip__close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.1s ease;
}

.global-message-tip__close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--color-text-primary);
}

.global-message-tip__close:active {
  transform: scale(0.96);
}

.global-message-tip-stack-enter-active,
.global-message-tip-stack-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 0.18s ease;
}

.global-message-tip-stack-enter-from {
  opacity: 0;
  filter: blur(2px);
  transform: translateX(-50%) translateY(calc(var(--stack-offset, 0px) - 12px)) scale(0.96);
}

.global-message-tip-stack-enter-to {
  opacity: var(--stack-opacity, 1);
  filter: none;
}

.global-message-tip-stack-leave-from {
  opacity: var(--stack-opacity, 1);
}

.global-message-tip-stack-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translateX(-50%) translateY(calc(var(--stack-offset, 0px) - 8px)) scale(0.96);
}

.global-message-tip-stack-move {
  transition:
    transform 0.22s cubibic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.18s ease,
    filter 0.18s ease;
}
</style>
