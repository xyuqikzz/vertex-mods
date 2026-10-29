<script setup>
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue'
import { getRetiredSourceFailure } from '../../../../../../shared/sources/retired-source-policy.js'
import { gameLibraryKey as getGameKey } from '../../../../../../shared/games/game-library.js'
import { hasQuickLaunchModSource } from '@renderer/utils/quick-launch-game-info.js'
import QuickLaunchRailItem from './quick-launch-rail-item.vue'

// 快捷启动卡片轨道：横列横向滚动、竖列双列网格；加载骨架、搜索无结果、没有本地游戏三种空状态；
// 卡片「⋯」和右键共用一个菜单。

const { t } = useI18n()
const props = defineProps({
  games: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  isSearching: {
    type: Boolean,
    default: false
  },
  keyword: {
    type: String,
    default: ''
  },
  selectedKey: {
    type: String,
    default: ''
  },
  // horizontal：横列卡片，横向滚动；vertical：竖列，每个游戏一整行
  layoutMode: {
    type: String,
    default: 'horizontal'
  }
})

const emit = defineEmits([
  'select',
  'start-game',
  'manage-mod',
  'preview-mod',
  'open-game-dir',
  'clear-search'
])

const SKELETON_COUNT = 6
const MENU_WIDTH = 180

const trackRef = ref(null)
const menuRef = ref(null)
const menu = ref({ open: false, item: null, top: 0, left: 0 })
let menuTrigger = null

// 本机扫描游戏（没有模组来源）只有「打开游戏目录」
const menuItems = computed(() => {
  const item = menu.value.item
  if (!item) return []
  const list = []
  if (hasQuickLaunchModSource(item)) {
    list.push({ key: 'manage', label: t('quickLaunch.manage') })
    if (!getRetiredSourceFailure(item.currentSource || item.source)) {
      list.push({ key: 'preview', label: t('quickLaunch.browse') })
    }
  }
  list.push({ key: 'open-dir', label: t('quickLaunch.openDirectory') })
  return list
})

// 鼠标滚轮在轨道上时横向滚动；已经滚到头时交还给页面纵向滚动
function handleWheel(event) {
  const track = trackRef.value
  if (props.layoutMode !== 'horizontal') return
  if (!track || track.scrollWidth <= track.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  const previous = track.scrollLeft
  track.scrollLeft += delta
  if (track.scrollLeft !== previous) {
    event.preventDefault()
    closeMenu(false)
  }
}

function getMenuButtons() {
  return Array.from(menuRef.value?.querySelectorAll('[role="menuitem"]') || [])
}

// point：右键位置；没有时（「⋯」按钮或键盘菜单键）贴着触发元素显示
function openMenu(item, trigger, point = null) {
  if (!point && menu.value.open && menu.value.item === item) {
    closeMenu()
    return
  }
  if (menu.value.open) closeMenu(false)
  const rect = point
    ? { top: point.y, bottom: point.y, right: point.x + MENU_WIDTH }
    : trigger.getBoundingClientRect()
  const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
  const gap = point ? 2 : 6
  menuTrigger = trigger
  menu.value = { open: true, item, top: rect.bottom + gap, left }
  nextTick(() => {
    const menuEl = menuRef.value
    if (menuEl) {
      const menuHeight = menuEl.offsetHeight
      if (rect.bottom + gap + menuHeight > window.innerHeight - 8) {
        menu.value = { ...menu.value, top: Math.max(8, rect.top - menuHeight - gap) }
      }
    }
    getMenuButtons()[0]?.focus()
  })
  window.addEventListener('pointerdown', handleOutsidePointer, true)
  window.addEventListener('resize', closeMenuSilently)
  window.addEventListener('scroll', closeMenuSilently, true)
}

function closeMenu(restoreFocus = true) {
  if (!menu.value.open) return
  menu.value = { open: false, item: null, top: 0, left: 0 }
  window.removeEventListener('pointerdown', handleOutsidePointer, true)
  window.removeEventListener('resize', closeMenuSilently)
  window.removeEventListener('scroll', closeMenuSilently, true)
  if (restoreFocus) menuTrigger?.focus()
  menuTrigger = null
}

function closeMenuSilently(event) {
  if (event?.type === 'scroll' && menuRef.value?.contains(event.target)) return
  closeMenu(false)
}

function handleOutsidePointer(event) {
  if (menuRef.value?.contains(event.target) || menuTrigger?.contains(event.target)) return
  closeMenu(false)
}

function handleMenuKeydown(event) {
  const buttons = getMenuButtons()
  const index = buttons.indexOf(document.activeElement)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    buttons[(index + 1) % buttons.length]?.focus()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
  } else if (event.key === 'Home') {
    event.preventDefault()
    buttons[0]?.focus()
  } else if (event.key === 'End') {
    event.preventDefault()
    buttons[buttons.length - 1]?.focus()
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    closeMenu()
  }
}

function runMenuAction(key) {
  const item = menu.value.item
  closeMenu(false)
  if (!item) return
  if (key === 'manage') emit('manage-mod', item)
  if (key === 'preview') emit('preview-mod', item)
  if (key === 'open-dir') emit('open-game-dir', item)
}

onDeactivated(() => closeMenu(false))
onBeforeUnmount(() => closeMenu(false))

defineOptions({
  name: 'QuickLaunchRail'
})
</script>

<template>
  <div class="ql-rail">
    <div
      v-if="props.loading && !props.games.length && !props.isSearching"
      class="ql-rail__track"
      :data-layout="props.layoutMode"
      aria-busy="true"
    >
      <span class="ql-visually-hidden" role="status">{{ t('quickLaunch.reading') }}</span>
      <div v-for="index in SKELETON_COUNT" :key="index" class="ql-skeleton" aria-hidden="true">
        <span class="ql-skeleton__cover"></span>
        <span class="ql-skeleton__body">
          <span class="ql-skeleton__text">
            <span class="ql-skeleton__line is-title"></span>
            <span class="ql-skeleton__line"></span>
          </span>
          <span class="ql-skeleton__actions">
            <span class="ql-skeleton__btn is-primary"></span>
            <span class="ql-skeleton__btn"></span>
          </span>
        </span>
      </div>
    </div>

    <div
      v-else-if="props.games.length"
      ref="trackRef"
      class="ql-rail__track"
      :data-layout="props.layoutMode"
      @wheel="handleWheel"
    >
      <quick-launch-rail-item
        v-for="item in props.games"
        :key="getGameKey(item)"
        :item="item"
        :selected="props.selectedKey === getGameKey(item)"
        :menu-open="menu.open && menu.item === item"
        :layout-mode="props.layoutMode"
        @select="emit('select', item)"
        @start-game="emit('start-game', item)"
        @manage-mod="emit('manage-mod', item)"
        @preview-mod="emit('preview-mod', item)"
        @open-game-dir="emit('open-game-dir', item)"
        @open-menu="(trigger) => openMenu(item, trigger)"
        @context-menu="({ trigger, point }) => openMenu(item, trigger, point)"
      />
    </div>

    <div v-else class="ql-empty" role="status">
      <span class="ql-empty__icon" aria-hidden="true">
        <svg v-if="props.isSearching" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24">
          <rect x="2" y="6" width="20" height="12" rx="4" />
          <path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" />
        </svg>
      </span>
      <template v-if="props.isSearching">
        <h3 class="ql-empty__title">{{ t('quickLaunch.noMatches', { keyword: props.keyword }) }}</h3>
        <button type="button" class="ql-empty__action" @click="emit('clear-search')">
          {{ t('quickLaunch.clear') }}
        </button>
      </template>
      <template v-else>
        <h3 class="ql-empty__title">{{ t('quickLaunch.empty') }}</h3>
        <p class="ql-empty__hint">{{ t('quickLaunch.emptyHint') }}</p>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-if="menu.open"
        ref="menuRef"
        class="ql-menu"
        role="menu"
        :aria-label="t('quickLaunch.more', { name: menu.item?.displayName || '' })"
        :style="{ top: `${menu.top}px`, left: `${menu.left}px`, width: `${MENU_WIDTH}px` }"
        @keydown="handleMenuKeydown"
      >
        <button
          v-for="entry in menuItems"
          :key="entry.key"
          type="button"
          role="menuitem"
          class="ql-menu__item"
          @click="runMenuAction(entry.key)"
        >
          <svg v-if="entry.key === 'manage'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="9" cy="17" r="2" />
          </svg>
          <svg v-else-if="entry.key === 'preview'" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="m15.5 8.5-2 5-5 2 2-5z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
            />
          </svg>
          {{ entry.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.ql-rail {
  min-width: 0;
}

// 卡片轨道横向滚动；上下留白给悬停上浮和选中外圈，避免被裁切
.ql-rail__track {
  --ql-card-width: 272px;

  display: flex;
  gap: 16px;
  min-width: 0;
  margin: -6px -6px 0;
  padding: 6px 6px 12px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;

  &::-webkit-scrollbar {
    height: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
    margin: 0 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  // 竖列：双列卡片网格（宽度不够时一列），随页面纵向滚动
  &[data-layout='vertical'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr));
    gap: 12px 16px;
    margin: -6px;
    padding: 6px;
    overflow: visible;
  }
}

.ql-skeleton {
  flex: 0 0 var(--ql-card-width);
  height: 190px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(226, 232, 240, 0.86);
  border-radius: 14px;
  background: #ffffff;
  overflow: hidden;
  animation: ql-skeleton-pulse 1.4s ease-in-out infinite;
}

.ql-skeleton__cover {
  flex: 0 0 128px;
  background: #e2e8f0;
}

// 横列：名称两行 + 右侧圆形启动按钮
.ql-skeleton__body {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 14px;
}

.ql-skeleton__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ql-rail__track[data-layout='horizontal'] {
  .ql-skeleton__btn:not(.is-primary) {
    display: none;
  }

  .ql-skeleton__btn.is-primary {
    width: 38px;
    height: 38px;
    border-radius: 50%;
  }
}

.ql-rail__track[data-layout='vertical'] {
  .ql-skeleton {
    height: 120px;
    flex-direction: row;
  }

  .ql-skeleton__cover {
    flex: 0 0 236px;
  }

  .ql-skeleton__body {
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    padding: 14px 16px 13px 18px;
  }
}

.ql-skeleton__line {
  width: 40%;
  height: 10px;
  border-radius: 999px;
  background: #eef2f6;

  &.is-title {
    width: 60%;
    height: 14px;
    background: #e2e8f0;
  }
}

.ql-skeleton__actions {
  display: flex;
  gap: 8px;
}

.ql-skeleton__btn {
  width: 84px;
  height: 34px;
  border-radius: 9px;
  background: #eef2f6;

  &.is-primary {
    width: 112px;
    background: #e2e8f0;
  }
}

.ql-empty {
  min-height: 236px;
  box-sizing: border-box;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}

.ql-empty__icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: rgba(10, 150, 255, 0.08);
  color: #0a96ff;

  svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.ql-empty__title {
  margin: 0;
  color: #1e293b;
  font-size: 16px;
  font-weight: 700;
}

.ql-empty__hint {
  margin: 0;
  color: #607086;
  font-size: 13px;
}

.ql-empty__action {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #0a7fd9;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: rgba(10, 150, 255, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }
}

.ql-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  box-sizing: border-box;
  padding: 4px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}

.ql-menu__item {
  height: 34px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1e293b;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;

  svg {
    width: 15px;
    height: 15px;
    flex: none;
    fill: none;
    stroke: #64748b;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover,
  &:focus-visible {
    background: rgba(10, 150, 255, 0.08);
    outline: none;
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

@keyframes ql-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ql-skeleton {
    animation: none;
  }
}
</style>
