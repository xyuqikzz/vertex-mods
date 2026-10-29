<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getVxModalZIndex,
  isTopVxModal,
  registerVxModal,
  unregisterVxModal,
  VX_MODAL_LAYER
} from './modalStack'

// 右侧抽屉：只读详情、长列表等不需要打断主流程的内容。和 VxModal 共用层级栈。
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  width: { type: Number, default: 600 },
  closeOnOverlay: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: true },
  showClose: { type: Boolean, default: true },
  closeLabel: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  panelClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' }
})

const emit = defineEmits(['update:modelValue', 'close'])
const slots = defineSlots()

const drawerId = `vx-drawer-${Math.random().toString(36).slice(2, 10)}`
const panelRef = ref(null)
const zIndex = ref(getVxModalZIndex(drawerId))
let previousFocusedElement = null
let isRegistered = false

const titleId = computed(() => (props.title || slots.header ? `${drawerId}-title` : undefined))
const panelStyle = computed(() => ({ width: `min(${props.width}px, 100vw)` }))
const overlayStyle = computed(() => ({ '--vx-drawer-z-index': String(zIndex.value) }))

function getFocusableElements() {
  if (!panelRef.value) return []
  return Array.from(
    panelRef.value.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null)
}

function closeDrawer() {
  if (!isRegistered || !isTopVxModal(drawerId)) return
  emit('update:modelValue', false)
  emit('close')
}

function handleOverlayClick(event) {
  if (props.closeOnOverlay && event.target === event.currentTarget) closeDrawer()
}

function handleKeydown(event) {
  if (!props.modelValue || !isRegistered || !isTopVxModal(drawerId)) return
  if (props.closeOnEsc && event.key === 'Escape') {
    closeDrawer()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = getFocusableElements()
  if (!focusable.length) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function openDrawer() {
  if (isRegistered) return
  previousFocusedElement = typeof document === 'undefined' ? null : document.activeElement
  zIndex.value = registerVxModal(drawerId, VX_MODAL_LAYER.BASE)
  isRegistered = true
  nextTick(() => {
    if (isRegistered && isTopVxModal(drawerId)) panelRef.value?.focus()
  })
}

function releaseDrawer() {
  if (!isRegistered) return
  const shouldRestoreFocus = isTopVxModal(drawerId)
  unregisterVxModal(drawerId)
  isRegistered = false
  if (shouldRestoreFocus && typeof previousFocusedElement?.focus === 'function') {
    previousFocusedElement.focus()
  }
}

watch(
  () => props.modelValue,
  (visible) => (visible ? openDrawer() : releaseDrawer()),
  { immediate: true }
)

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  releaseDrawer()
})

defineExpose({ close: closeDrawer })
</script>

<template>
  <Teleport to="body">
    <Transition name="vx-drawer">
      <div
        v-if="modelValue"
        class="vx-drawer"
        :style="overlayStyle"
        role="presentation"
        @click="handleOverlayClick"
      >
        <aside
          ref="panelRef"
          class="vx-drawer__panel"
          :class="panelClass"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-label="titleId ? undefined : ariaLabel || undefined"
          tabindex="-1"
        >
          <header class="vx-drawer__header">
            <div :id="titleId" class="vx-drawer__heading">
              <slot name="header">
                <h2 v-if="title" class="vx-drawer__title">{{ title }}</h2>
                <p v-if="subtitle" class="vx-drawer__subtitle">{{ subtitle }}</p>
              </slot>
            </div>
            <button
              v-if="showClose"
              type="button"
              class="vx-drawer__close"
              :aria-label="closeLabel || $t('ui.close')"
              :title="closeLabel"
              @click="closeDrawer"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M3 3l10 10M13 3L3 13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          <div class="vx-drawer__body vx-ui-scrollbar" :class="bodyClass">
            <slot></slot>
          </div>

          <footer v-if="$slots.footer" class="vx-drawer__footer">
            <slot name="footer"></slot>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vx-drawer {
  position: fixed;
  inset: 0;
  z-index: var(--vx-drawer-z-index, 2000);
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.42);
}

.vx-drawer__panel {
  height: 100%;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--color-surface, #ffffff);
  border-left: 1px solid var(--color-border, #d9e0e8);
  box-shadow: -10px 0 24px rgba(15, 23, 42, 0.08);
  color: var(--color-text, #151922);
  font-size: 14px;
  outline: none;
}

.vx-drawer__header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border, #d9e0e8);
}

.vx-drawer__heading {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vx-drawer__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
}

.vx-drawer__subtitle {
  margin: 0;
  color: var(--color-text-muted, #667085);
  font-size: 13px;
}

.vx-drawer__close {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  margin: -4px -6px 0 0;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary, #344054);
  cursor: pointer;
}

.vx-drawer__close:hover {
  background: var(--color-surface-hover, #f1f4f8);
  color: var(--color-text, #151922);
}

.vx-drawer__close:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
}

.vx-drawer__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 20px;
}

.vx-drawer__footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border, #d9e0e8);
}

.vx-drawer-enter-active,
.vx-drawer-leave-active {
  transition: background-color 0.2s ease;
}

.vx-drawer-enter-active .vx-drawer__panel,
.vx-drawer-leave-active .vx-drawer__panel {
  transition:
    transform 0.22s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease;
}

.vx-drawer-enter-from,
.vx-drawer-leave-to {
  background-color: rgba(15, 23, 42, 0);
}

.vx-drawer-enter-from .vx-drawer__panel,
.vx-drawer-leave-to .vx-drawer__panel {
  opacity: 0;
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .vx-drawer-enter-active .vx-drawer__panel,
  .vx-drawer-leave-active .vx-drawer__panel {
    transition: none;
  }
}
</style>
