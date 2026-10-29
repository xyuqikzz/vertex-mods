<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getVxModalZIndex,
  isTopVxModal,
  registerVxModal,
  unregisterVxModal,
  VX_MODAL_LAYER
} from './modalStack'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  subtitle: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    default: ''
  },
  // 兼容普通弹窗原有的头部说明；新增调用使用 subtitle 区分正文。
  description: {
    type: String,
    default: ''
  },
  width: {
    type: Number,
    default: 560
  },
  closeOnOverlay: {
    type: Boolean,
    default: false
  },
  closeOnEsc: {
    type: Boolean,
    default: true
  },
  showClose: {
    type: Boolean,
    default: true
  },
  plain: {
    type: Boolean,
    default: false
  },
  ariaLabel: {
    type: String,
    default: ''
  },
  panelClass: {
    type: [String, Array, Object],
    default: ''
  },
  // 弹窗层级：base（通用弹窗）/ confirm（确认弹窗）。默认 base。
  layer: {
    type: String,
    default: VX_MODAL_LAYER.BASE,
    validator: (value) => value === VX_MODAL_LAYER.BASE || value === VX_MODAL_LAYER.CONFIRM
  }
})

const emit = defineEmits(['update:modelValue', 'close'])
const modalId = `vx-modal-${Math.random().toString(36).slice(2, 10)}`
const panelRef = ref(null)
const closeButtonRef = ref(null)
const modalZIndex = ref(getVxModalZIndex(modalId))
let previousFocusedElement = null
let isRegistered = false

const titleId = computed(() => (props.title ? `${modalId}-title` : undefined))
const subtitleText = computed(() => props.subtitle || props.description)
const descriptionId = computed(
  () =>
    [subtitleText.value ? `${modalId}-description` : '', props.content ? `${modalId}-content` : '']
      .filter(Boolean)
      .join(' ') || undefined
)

const overlayStyle = computed(() => ({
  '--vx-modal-z-index': String(modalZIndex.value)
}))

const dialogStyle = computed(() => ({
  ...(props.plain ? {} : { width: `${props.width}px` })
}))

const shouldShowClose = computed(() => props.showClose && !props.plain)

function getFocusableElements() {
  if (!panelRef.value) return []
  return Array.from(
    panelRef.value.querySelectorAll(
      [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',')
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
}

function focusDialog() {
  nextTick(() => {
    if (!isRegistered || !isTopVxModal(modalId)) return

    const focusableElements = getFocusableElements()
    const target = closeButtonRef.value || focusableElements[0] || panelRef.value
    target?.focus()
  })
}

function closeDialog() {
  if (!isRegistered || !isTopVxModal(modalId)) return
  emit('update:modelValue', false)
  emit('close')
}

function handleOverlayClick(event) {
  if (props.closeOnOverlay && event.target === event.currentTarget && isTopVxModal(modalId)) {
    closeDialog()
  }
}

function handleKeydown(event) {
  if (!props.modelValue || !isRegistered || !isTopVxModal(modalId)) return

  if (props.closeOnEsc && event.key === 'Escape') {
    closeDialog()
    return
  }

  if (event.key !== 'Tab') return

  const focusableElements = getFocusableElements()
  if (!focusableElements.length) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }

  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}

function openModal() {
  if (isRegistered) return

  previousFocusedElement = typeof document === 'undefined' ? null : document.activeElement
  modalZIndex.value = registerVxModal(modalId, props.layer)
  isRegistered = true
  focusDialog()
}

function closeModal() {
  if (!isRegistered) return

  const shouldRestoreFocus = isTopVxModal(modalId)
  unregisterVxModal(modalId)
  isRegistered = false

  if (
    shouldRestoreFocus &&
    previousFocusedElement &&
    typeof previousFocusedElement.focus === 'function'
  ) {
    previousFocusedElement.focus()
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      openModal()
      return
    }

    closeModal()
  },
  { immediate: true }
)

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  closeModal()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="base-dialog"
      :style="overlayStyle"
      role="presentation"
      @click="handleOverlayClick"
    >
      <section
        ref="panelRef"
        class="base-dialog-panel"
        :class="[{ 'base-dialog-panel--plain': plain }, panelClass]"
        :style="dialogStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="title ? undefined : ariaLabel || $t('ui.dialog')"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
      >
        <header v-if="title || subtitleText || shouldShowClose" class="base-dialog-header">
          <div class="base-dialog-heading">
            <h3 v-if="title" :id="titleId">{{ title }}</h3>
            <p v-if="subtitleText" :id="`${modalId}-description`">{{ subtitleText }}</p>
          </div>

          <button
            v-if="shouldShowClose"
            ref="closeButtonRef"
            class="base-dialog-close"
            type="button"
            :aria-label="$t('ui.closeDialog')"
            @click="closeDialog"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M3 3l10 10M13 3L3 13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>

        <div class="base-dialog-body vx-ui-scrollbar" :class="{ 'base-dialog-body--plain': plain }">
          <p v-if="content" :id="`${modalId}-content`" class="base-dialog-content">{{ content }}</p>
          <slot></slot>
        </div>

        <footer v-if="$slots.footer" class="base-dialog-footer">
          <slot name="footer"></slot>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
