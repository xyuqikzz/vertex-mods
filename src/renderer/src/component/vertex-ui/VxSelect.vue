<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  placeholder: { type: String, default: null },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  allowCreate: { type: Boolean, default: false },
  createPlaceholder: { type: String, default: null },
  createButtonText: { type: String, default: null }
})

const emit = defineEmits(['update:modelValue', 'change', 'create'])
const rootRef = ref(null)
const triggerRef = ref(null)
const menuRef = ref(null)
const createInputRef = ref(null)
const optionRefs = ref([])
const isOpen = ref(false)
const highlightedIndex = ref(-1)
const createValue = ref('')
const selectId = useId()
const listboxId = `${selectId}-listbox`
const menuPosition = ref({
  top: 0,
  bottom: null,
  left: 0,
  width: 0,
  maxHeight: 240
})

const enabledOptions = computed(() => props.options.filter((option) => !option.disabled))

const selectedOption = computed(() =>
  props.options.find((option) => isSameValue(option.value, props.modelValue))
)

const createText = computed(() => String(createValue.value || '').trim())

function getMenuLayerStyle() {
  const modalOverlay = rootRef.value?.closest('.base-dialog')
  if (!modalOverlay) return {}

  const modalZIndex = Number.parseInt(
    getComputedStyle(modalOverlay).getPropertyValue('--vx-modal-z-index'),
    10
  )
  if (!Number.isFinite(modalZIndex)) return {}

  return { zIndex: String(modalZIndex + 1) }
}

const menuStyle = computed(() => ({
  top: menuPosition.value.bottom === null ? `${menuPosition.value.top}px` : 'auto',
  bottom: menuPosition.value.bottom === null ? 'auto' : `${menuPosition.value.bottom}px`,
  left: `${menuPosition.value.left}px`,
  width: `${menuPosition.value.width}px`,
  maxHeight: `${menuPosition.value.maxHeight}px`,
  ...getMenuLayerStyle()
}))

function isSameValue(left, right) {
  return Object.is(left, right) || String(left) === String(right)
}

function closeMenu() {
  isOpen.value = false
  highlightedIndex.value = -1
  createValue.value = ''
}

function focusHighlightedOption() {
  nextTick(() => {
    if (!isOpen.value) return
    const option = optionRefs.value[highlightedIndex.value]
    ;(option || menuRef.value)?.focus({ preventScroll: true })
    option?.scrollIntoView({ block: 'nearest' })
  })
}

function focusCreateInput() {
  nextTick(() => {
    if (isOpen.value) createInputRef.value?.focus({ preventScroll: true })
  })
}

function updateMenuPosition() {
  if (!isOpen.value || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const viewportPadding = 12
  const gap = 4
  const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap)
  const availableAbove = Math.max(0, rect.top - viewportPadding - gap)
  const openAbove = availableBelow < 180 && availableAbove > availableBelow
  const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2)
  menuPosition.value = {
    top: rect.bottom + gap,
    bottom: openAbove ? window.innerHeight - rect.top + gap : null,
    left: Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - width - viewportPadding)
    ),
    width,
    maxHeight: Math.min(240, openAbove ? availableAbove : availableBelow)
  }
}

function openMenu() {
  if (props.disabled || props.readonly || props.loading) {
    return
  }
  const selectedIndex = props.options.findIndex((option) =>
    isSameValue(option.value, props.modelValue)
  )
  isOpen.value = true
  highlightedIndex.value =
    selectedIndex >= 0 && !props.options[selectedIndex].disabled
      ? selectedIndex
      : props.options.findIndex((option) => !option.disabled)
  nextTick(() => {
    updateMenuPosition()
    if (props.allowCreate) {
      focusCreateInput()
    } else {
      focusHighlightedOption()
    }
  })
}

function toggleOpen() {
  if (isOpen.value) {
    closeMenu()
    triggerRef.value?.focus()
    return
  }
  openMenu()
}

function selectOption(option) {
  if (option.disabled || props.disabled || props.readonly || props.loading) return
  emit('update:modelValue', option.value)
  emit('change', option)
  closeMenu()
  triggerRef.value?.focus()
}

function createOption() {
  if (!props.allowCreate || props.disabled || props.readonly || props.loading) return
  const label = createText.value
  if (!label) return

  const normalizedLabel = label.toLowerCase()
  const matchedOption = props.options.find((option) => {
    const optionLabel = String(option?.label ?? option?.value ?? '')
      .trim()
      .toLowerCase()
    const optionValue = String(option?.value ?? '')
      .trim()
      .toLowerCase()
    return optionLabel === normalizedLabel || optionValue === normalizedLabel
  })

  if (matchedOption) {
    if (!matchedOption.disabled) {
      emit('update:modelValue', matchedOption.value)
      emit('change', matchedOption)
      closeMenu()
      triggerRef.value?.focus()
    }
    return
  }

  const createdOption = {
    label,
    value: label
  }
  emit('create', createdOption)
  emit('update:modelValue', createdOption.value)
  emit('change', createdOption)
  closeMenu()
  triggerRef.value?.focus()
}

function moveHighlight(step) {
  if (!props.options.length) return
  if (!isOpen.value) {
    openMenu()
    return
  }
  let nextIndex = highlightedIndex.value
  for (let index = 0; index < props.options.length; index++) {
    nextIndex = (nextIndex + step + props.options.length) % props.options.length
    if (!props.options[nextIndex]?.disabled) break
  }
  highlightedIndex.value = nextIndex
  focusHighlightedOption()
}

function handleTriggerKeydown(event) {
  if (props.disabled || props.readonly || props.loading) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-1)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleOpen()
  } else if (event.key === 'Escape' && isOpen.value) {
    event.stopPropagation()
    closeMenu()
  }
}

function handleCreateKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    createOption()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    triggerRef.value?.focus()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (enabledOptions.value.length) {
      highlightedIndex.value = props.options.findIndex((option) => !option.disabled)
      focusHighlightedOption()
    }
  }
}

function handleOptionKeydown(event, option, index) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlightedIndex.value = index
    moveHighlight(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlightedIndex.value = index
    moveHighlight(-1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    highlightedIndex.value =
      event.key === 'Home'
        ? props.options.findIndex((item) => !item.disabled)
        : props.options.findLastIndex((item) => !item.disabled)
    focusHighlightedOption()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectOption(option)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    triggerRef.value?.focus()
  }
}

function handleMenuKeydown(event) {
  if (event.target === menuRef.value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
  }
  if (event.key === 'Tab' || event.key === 'Escape') {
    if (event.key === 'Tab' && props.allowCreate) {
      const fromInput = event.target === createInputRef.value
      const fromAction = event.target.matches('.vx-select-menu__create-action')
      if ((!event.shiftKey && fromInput && createText.value) || (event.shiftKey && fromAction))
        return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
    }
    closeMenu()
    // 回到触发器后让 Tab 的默认行为继续，保持页面及弹窗原有焦点顺序。
    triggerRef.value?.focus({ preventScroll: true })
  }
}

watch(
  () => [props.disabled, props.readonly, props.loading],
  () => {
    if (props.disabled || props.readonly || props.loading) closeMenu()
  }
)
watch(
  () => props.options,
  () => {
    if (!isOpen.value) return
    highlightedIndex.value = props.options.findIndex(
      (option) => !option.disabled && isSameValue(option.value, props.modelValue)
    )
    if (highlightedIndex.value < 0)
      highlightedIndex.value = props.options.findIndex((option) => !option.disabled)
    nextTick(() => {
      updateMenuPosition()
      if (!props.allowCreate) focusHighlightedOption()
    })
  },
  { deep: true }
)

function handleDocumentClick(event) {
  if (!rootRef.value?.contains(event.target) && !menuRef.value?.contains(event.target)) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentClick)
  document.addEventListener('focusin', handleDocumentClick)
  window.addEventListener('resize', updateMenuPosition)
  document.addEventListener('scroll', updateMenuPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentClick)
  document.removeEventListener('focusin', handleDocumentClick)
  window.removeEventListener('resize', updateMenuPosition)
  document.removeEventListener('scroll', updateMenuPosition, true)
})
</script>

<template>
  <div
    ref="rootRef"
    class="vx-select-field"
    :class="{
      'has-error': error,
      'is-disabled': disabled,
      'is-readonly': readonly,
      'is-loading': loading,
      'is-open': isOpen
    }"
  >
    <label v-if="label" :id="`${selectId}-label`" :for="selectId" class="vx-select-field__label">{{
      label
    }}</label>
    <button
      :id="selectId"
      ref="triggerRef"
      class="vx-select"
      type="button"
      :disabled="disabled || loading"
      :aria-disabled="readonly || disabled || loading"
      :aria-label="$attrs['aria-label']"
      :aria-labelledby="label ? `${selectId}-label ${selectId}-value` : $attrs['aria-labelledby']"
      :aria-describedby="
        [error || hint ? `${selectId}-message` : null, $attrs['aria-describedby']]
          .filter(Boolean)
          .join(' ') || undefined
      "
      :aria-invalid="Boolean(error)"
      :aria-busy="loading"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      @click="toggleOpen"
      @keydown="handleTriggerKeydown"
    >
      <span
        :id="`${selectId}-value`"
        class="vx-select__value"
        :class="{ 'is-placeholder': !selectedOption }"
        :title="selectedOption?.label || (placeholder ?? $t('ui.selectPlaceholder'))"
      >
        {{ selectedOption?.label || (placeholder ?? $t('ui.selectPlaceholder')) }}
      </span>
      <span v-if="loading" class="vx-select__spinner" aria-hidden="true"></span>
      <span v-else class="vx-select__arrow" aria-hidden="true"></span>
    </button>
    <Teleport to="body">
      <transition name="vx-select-fade">
        <div
          v-if="isOpen"
          ref="menuRef"
          class="vx-select-menu"
          :style="menuStyle"
          tabindex="-1"
          @keydown="handleMenuKeydown"
        >
          <div v-if="allowCreate" class="vx-select-menu__create">
            <input
              ref="createInputRef"
              v-model="createValue"
              class="vx-select-menu__input"
              type="text"
              :placeholder="createPlaceholder ?? $t('ui.createOptionPlaceholder')"
              :aria-label="createPlaceholder ?? $t('ui.createOptionPlaceholder')"
              @keydown="handleCreateKeydown"
            />
            <button
              class="vx-select-menu__create-action"
              type="button"
              :disabled="!createText"
              @click="createOption"
            >
              {{ createButtonText ?? $t('ui.addOption') }}
            </button>
          </div>
          <div
            :id="listboxId"
            class="vx-select-menu__options vx-ui-scrollbar"
            role="listbox"
            :aria-label="label || placeholder || $t('ui.selectPlaceholder')"
          >
            <button
              v-for="(option, index) in options"
              :key="String(option.value)"
              :ref="
                (element) => {
                  optionRefs[index] = element
                }
              "
              type="button"
              class="vx-select-option"
              :class="{
                'is-selected': isSameValue(option.value, modelValue),
                'is-highlighted': index === highlightedIndex
              }"
              :disabled="option.disabled"
              role="option"
              tabindex="-1"
              :aria-selected="isSameValue(option.value, modelValue)"
              @click="selectOption(option)"
              @keydown="handleOptionKeydown($event, option, index)"
            >
              <span class="vx-select-option__label">{{ option.label }}</span>
              <span v-if="option.description" class="vx-select-option__desc">
                {{ option.description }}
              </span>
            </button>
            <span v-if="!options.length" class="vx-select-menu__empty" role="status"
              >{{ $t('ui.noOptions') }}</span
            >
          </div>
        </div>
      </transition>
    </Teleport>
    <span
      v-if="error || hint"
      :id="`${selectId}-message`"
      class="vx-select-field__message"
      :role="error ? 'alert' : undefined"
      >{{ error || hint }}</span
    >
  </div>
</template>

<style scoped lang="scss">
.vx-select-field {
  position: relative;
}
.vx-select {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-align: left;
  cursor: pointer;
}
.vx-select__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.is-placeholder {
  color: var(--color-placeholder);
}
.vx-select:disabled .is-placeholder {
  color: var(--control-text-disabled);
}
.vx-select__arrow,
.vx-select__spinner {
  width: var(--control-icon-size);
  height: var(--control-icon-size);
  flex: 0 0 auto;
}
.vx-select__arrow {
  display: grid;
  place-items: center;
  &::after {
    content: '';
    width: 7px;
    height: 7px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
  }
}
.is-open .vx-select__arrow::after {
  transform: translateY(2px) rotate(-135deg);
}
.vx-select__spinner {
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: vx-control-spin 700ms linear infinite;
}
.vx-select-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-family-base);
  box-shadow: var(--shadow-md);
  outline: none;
}
.vx-select-menu__create {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-1);
  margin-bottom: var(--space-1);
  border-bottom: 1px solid var(--color-border);
}
.vx-select-menu__input,
.vx-select-menu__create-action {
  box-sizing: border-box;
  min-height: var(--control-height-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--control-bg);
  color: var(--color-text);
  padding: 0 var(--space-2);
  font: inherit;
  font-size: var(--font-size-sm);
  &:focus-visible {
    outline: 2px solid var(--color-accent-active);
    outline-offset: -2px;
  }
}
.vx-select-menu__input {
  flex: 1;
  min-width: 0;
}
.vx-select-menu__create-action {
  flex: 0 0 auto;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }
  &:disabled {
    color: var(--control-text-disabled);
    background: var(--control-bg-disabled);
    cursor: not-allowed;
  }
}
.vx-select-menu__options {
  display: grid;
  gap: var(--space-1);
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.vx-select-option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: var(--control-height-sm);
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text);
  text-align: left;
  line-height: var(--line-height-base);
  overflow-wrap: anywhere;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }
  &.is-selected {
    background: var(--color-accent-soft);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-active);
    outline-offset: -2px;
  }
  &:disabled {
    color: var(--control-text-disabled);
    cursor: not-allowed;
  }
}
.vx-select-option__label {
  max-width: 100%;
  font-size: var(--font-size-sm);
}
.vx-select-option.is-selected .vx-select-option__label {
  font-weight: var(--font-weight-semibold);
}
.vx-select-option__desc,
.vx-select-menu__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.vx-select-option__desc {
  max-width: 100%;
}
.vx-select-menu__empty {
  padding: var(--space-2);
}
.vx-select-fade-enter-active,
.vx-select-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.vx-select-fade-enter-from,
.vx-select-fade-leave-to {
  opacity: 0;
}
</style>
