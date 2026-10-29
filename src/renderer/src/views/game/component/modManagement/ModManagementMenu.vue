<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

// 模组管理页的行菜单 / 详情菜单。逃离滚动容器的裁切，键盘行为与页头「更多操作」一致。
const props = defineProps({
  open: { type: Boolean, default: false },
  // { x, y }：按鼠标位置出现；{ rect }：贴着触发按钮右下对齐。
  anchor: { type: Object, default: null },
  items: { type: Array, default: () => [] },
  label: { type: String, default: undefined },
  width: { type: Number, default: 236 },
  menuClass: { type: String, default: '' }
})
const emit = defineEmits(['close', 'select'])
const menu = ref(null)
const position = ref({})
let returnFocus = null

function place() {
  const el = menu.value
  if (!el || !props.anchor) return
  const gap = 4
  const edge = 8
  const width = el.offsetWidth || props.width
  const height = el.offsetHeight
  let left
  let top
  if (props.anchor.rect) {
    const rect = props.anchor.rect
    left = rect.right - width
    top = rect.bottom + gap
    if (top + height > window.innerHeight - edge) top = rect.top - gap - height
  } else {
    left = props.anchor.x
    top = props.anchor.y
    if (left + width > window.innerWidth - edge) left -= width
    if (top + height > window.innerHeight - edge) top -= height
  }
  position.value = {
    left: `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`,
    top: `${Math.max(edge, top)}px`,
    width: `${props.width}px`
  }
}
function buttons() {
  return [...(menu.value?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
}
function close(restore = true) {
  emit('close')
  if (restore) returnFocus?.focus?.()
}
function select(item) {
  if (item.disabled) return
  close(true)
  emit('select', item)
}
function keydown(event) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = buttons()
  if (!items.length) return
  const index = items.indexOf(document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next].focus()
}
function outside(event) {
  if (props.open && !menu.value?.contains(event.target)) close(false)
}
function dismiss() {
  if (props.open) close(false)
}
function listen(on) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside, true)
  window[method]('resize', dismiss)
  window[method]('scroll', dismiss, true)
}
watch(
  () => props.open,
  async (value) => {
    if (!value) {
      listen(false)
      return
    }
    returnFocus = document.activeElement
    position.value = { left: '-9999px', top: '0px', width: `${props.width}px` }
    await nextTick()
    place()
    buttons()[0]?.focus()
    // 打开菜单的同一次点击不应立刻触发外部关闭。
    setTimeout(() => props.open && listen(true))
  }
)
onBeforeUnmount(() => listen(false))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="mm-context-menu"
      :class="menuClass"
      role="menu"
      :aria-label="(label ?? $t('ui.actions'))"
      :style="position"
      @keydown="keydown"
      @contextmenu.prevent
    >
      <template v-for="(item, index) in items" :key="item.key || `separator-${index}`">
        <div v-if="item.separator" class="mm-menu-divider" role="separator"></div>
        <div v-else-if="item.heading" class="mm-menu-heading">{{ item.label }}</div>
        <button
          v-else
          type="button"
          role="menuitem"
          class="mm-menu-item"
          :class="[item.className, { 'is-danger': item.danger }]"
          :disabled="item.disabled"
          :title="item.title || undefined"
          @click="select(item)"
        >
          <span class="mm-menu-label">{{ item.label }}</span
          ><span v-if="item.hint" class="mm-menu-hint">{{ item.hint }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
