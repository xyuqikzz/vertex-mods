<script setup>
import { CloseSquareOutlined, GlobalOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import { translateMenuTitle } from '@renderer/i18n/navigation.js'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import storage from '@renderer/common/storage.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useRoute, useRouter } from 'vue-router'
import { resolveContextMenuPosition } from '@renderer/utils/context-menu-position.js'
import { getMenuRouteKey, normalizeMenuPath } from '@renderer/utils/menu-route-key.js'
import { resolveGameSiteDetailExternalUrl } from '@views/game/site-detail-route.js'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const appStore = useAppStore()

// 响应式状态
const menuIndex = ref(-1)
const menuContainer = ref()
const menuItemsWrapper = ref()
const showScrollHint = ref(false)
const showLeftFade = ref(false)
const showRightFade = ref(false)
const scrollAnimationId = ref(null)
const contextMenuPanel = ref(null)
const SCROLL_EDGE_SIZE = 24
const SCROLL_TOLERANCE = 1

// 右键菜单状态
const contextMenu = ref({
  visible: false,
  positioned: false,
  anchorX: 0,
  anchorY: 0,
  x: 0,
  y: 0,
  targetIndex: -1
})

// 计算属性
const menuList = computed(() => {
  return (appStore.menuList || []).map((item) => ({
    ...item,
    path: item.path || '',
    fullPath: item.fullPath || item.path || ''
  }))
})

// 安全获取菜单项名称，防止显示 undefined
const getMenuItemName = (item) => {
  let name = translateMenuTitle(item, t)
  const hasExplicitLoadingName = typeof item.content === 'string' && item.content.trim() === ''

  // 从路径中提取名称作为回退
  if (!hasExplicitLoadingName && (name === undefined || name === null)) {
    const menuPath = getMenuNavPath(item)
    const segments = menuPath.split('?')[0].split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1] || ''
    // 首字母大写
    name = lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1)
  }

  // 显式传空字符串表示“加载中”，不使用路径回退
  if (hasExplicitLoadingName) {
    return t('common.loading')
  }

  // 检查空值或异常字符串
  if (!name || name === 'undefined' || name === 'unddefine' || String(name).trim() === '') {
    return t('common.loading')
  }

  return name
}

const getMenuNavPath = (item) => {
  return String(item?.fullPath || item?.path || '').trim()
}

const getMenuExternalUrl = (item) => {
  const targetRoute = getMenuNavPath(item)
  if (!targetRoute) return ''

  try {
    return resolveGameSiteDetailExternalUrl(router.resolve(targetRoute))
  } catch {
    return ''
  }
}

const contextMenuExternalUrl = computed(() => {
  const targetIndex = contextMenu.value.targetIndex
  if (targetIndex < 0 || targetIndex >= menuList.value.length) return ''
  return getMenuExternalUrl(menuList.value[targetIndex])
})

const contextMenuStyle = computed(() => ({
  left: `${contextMenu.value.x}px`,
  top: `${contextMenu.value.y}px`
}))

const HOME_MENU_PATH = '/app/home'

const isHomeMenuItem = (item) => {
  const menuName = String(item?.content ?? item?.name ?? '').trim()
  if (menuName === '首页') return true

  return normalizeMenuPath(item?.path || item?.fullPath) === HOME_MENU_PATH && !menuName
}

const isMenuClosable = (item) => {
  return !isHomeMenuItem(item)
}

const isSameMenuRoute = (item, routeValue) => {
  return getMenuRouteKey(getMenuNavPath(item)) === getMenuRouteKey(routeValue)
}

// 方法
const switchMenu = (index) => {
  const item = menuList.value[index]
  const targetRoute = getMenuNavPath(item)
  if (targetRoute && targetRoute !== route.fullPath) {
    router.push(targetRoute)
  }
  scrollToItem(index, true)
}

const closeMenu = async (index) => {
  const newList = [...menuList.value]
  if (!isMenuClosable(newList[index])) return

  // 先让当前页面的未保存修改守卫生效，再删除标签和组件缓存。
  if (isSameMenuRoute(newList[index], route.fullPath)) {
    const remaining = newList.filter((_item, itemIndex) => itemIndex !== index)
    const target = remaining[Math.min(index, remaining.length - 1)]
    if (await router.push(target ? getMenuNavPath(target) : '/app/home')) return
  }

  appStore.removeCachedPage(newList[index]?.path)
  newList.splice(index, 1)

  appStore.menuList = newList

  if (menuIndex.value === index) {
    if (newList.length > 0) {
      const newIndex = Math.min(index, newList.length - 1)
      router.push(getMenuNavPath(newList[newIndex]) || newList[newIndex].path)
    } else {
      router.push('/app/home')
    }
  } else if (menuIndex.value > index) {
    menuIndex.value--
  }
}

// 关闭所有可关闭的页面
const closeAllMenus = async () => {
  const kept = menuList.value.filter((item) => !isMenuClosable(item))
  if (!kept.some((item) => isSameMenuRoute(item, route.fullPath))) {
    if (await router.push(getMenuNavPath(kept.at(-1) || {}) || '/app/home')) return
  }
  const closableIndexes = []
  menuList.value.forEach((item, index) => {
    if (isMenuClosable(item)) {
      closableIndexes.push(index)
    }
  })

  // 从后往前删除，避免索引偏移
  for (let i = closableIndexes.length - 1; i >= 0; i--) {
    const idx = closableIndexes[i]
    appStore.removeCachedPage(menuList.value[idx]?.path)
  }

  const newList = menuList.value.filter((item) => !isMenuClosable(item))
  appStore.menuList = newList

  // 如果当前激活的页面被关闭了，跳转到剩余列表最后一项或首页
  const currentFullPath = route.fullPath
  const stillExists = newList.some((item) => isSameMenuRoute(item, currentFullPath))
  if (!stillExists) {
    if (newList.length > 0) {
      const targetItem = newList[newList.length - 1]
      router.push(getMenuNavPath(targetItem) || targetItem.path)
    } else {
      router.push('/app/home')
    }
  }
}

// 右键菜单处理
const updateContextMenuPosition = () => {
  const panel = contextMenuPanel.value
  if (!panel || !contextMenu.value.visible) return

  const position = resolveContextMenuPosition({
    anchorX: contextMenu.value.anchorX,
    anchorY: contextMenu.value.anchorY,
    menuWidth: panel.offsetWidth,
    menuHeight: panel.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  })

  contextMenu.value = {
    ...contextMenu.value,
    positioned: true,
    x: position.left,
    y: position.top
  }

  nextTick(() => {
    contextMenuPanel.value?.querySelector('.context-menu-item')?.focus({ preventScroll: true })
  })
}

const handleContextMenu = async (e, index) => {
  const item = menuList.value[index]
  // 不可关闭的菜单项不弹出右键面板
  if (!isMenuClosable(item)) return

  e.preventDefault()
  e.stopPropagation()

  contextMenu.value = {
    visible: true,
    positioned: false,
    anchorX: e.clientX,
    anchorY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    targetIndex: index
  }

  await nextTick()
  updateContextMenuPosition()
}

// 关闭右键菜单
const closeContextMenu = () => {
  contextMenu.value = {
    ...contextMenu.value,
    visible: false,
    positioned: false
  }
}

// 右键菜单操作：在系统默认浏览器中打开站点详情地址
const contextOpenInBrowser = () => {
  const url = contextMenuExternalUrl.value
  closeContextMenu()
  if (!url) return

  ipcRenderer.send('openBrowse', JSON.parse(JSON.stringify({ url })))
}

// 右键菜单操作：关闭当前页面
const contextCloseCurrent = () => {
  const idx = contextMenu.value.targetIndex
  closeContextMenu()
  if (idx >= 0 && idx < menuList.value.length) {
    closeMenu(idx)
  }
}

// 右键菜单操作：关闭全部页面
const contextCloseAll = () => {
  closeContextMenu()
  closeAllMenus()
}

const cancelScrollAnimation = () => {
  if (scrollAnimationId.value) {
    cancelAnimationFrame(scrollAnimationId.value)
    scrollAnimationId.value = null
  }
}

const scrollToPosition = (targetScroll, smooth = false) => {
  cancelScrollAnimation()
  const container = menuContainer.value
  if (!container) return

  const currentScroll = container.scrollLeft
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!smooth || reducedMotion || Math.abs(currentScroll - targetScroll) < SCROLL_TOLERANCE) {
    container.scrollLeft = targetScroll
    handleScroll()
    return
  }

  const startTime = performance.now()
  const animateScroll = (timestamp) => {
    const progress = Math.min((timestamp - startTime) / 200, 1)
    const easedProgress = easeInOutCubic(progress)
    container.scrollLeft = currentScroll + (targetScroll - currentScroll) * easedProgress
    handleScroll()
    scrollAnimationId.value = progress < 1 ? requestAnimationFrame(animateScroll) : null
  }
  scrollAnimationId.value = requestAnimationFrame(animateScroll)
}

const scrollToItem = (index, smooth = false) => {
  nextTick(() => {
    if (!menuContainer.value || !menuList.value[index]) return

    const container = menuContainer.value
    const item = menuItemsWrapper.value?.querySelectorAll('.menu-item:not(.menu-close-leave-active)')[index]
    if (!item) return
    const containerWidth = container.clientWidth
    // 标签按内容展开，定位必须使用布局尺寸；offsetLeft 不包含进出场动画的位移。
    const itemLeft = item.offsetLeft
    const itemWidth = item.getBoundingClientRect().width
    const currentScroll = container.scrollLeft
    const maxScroll = Math.max(0, container.scrollWidth - containerWidth)
    const visibleLeft = currentScroll + (currentScroll > SCROLL_TOLERANCE ? SCROLL_EDGE_SIZE : 0)
    const visibleRight = currentScroll + containerWidth -
      (currentScroll < maxScroll - SCROLL_TOLERANCE ? SCROLL_EDGE_SIZE : 0)

    // 内部参数和标题更新不应移动已经完整可见的页签。
    if (itemLeft >= visibleLeft && itemLeft + itemWidth <= visibleRight) {
      return
    }

    // 单个标题比视口还宽时先显示标题开头，其余内容仍可横向滚动查看。
    const targetScroll = itemWidth > containerWidth - SCROLL_EDGE_SIZE * 2
      ? itemLeft - SCROLL_EDGE_SIZE
      : itemLeft - containerWidth / 2 + itemWidth / 2
    scrollToPosition(targetScroll, smooth)
  })
}

const prepareMenuLeave = (element) => {
  // 退场标签脱离 flex 排列，但保留退出前的实际位置和宽度，避免挤压剩余标签。
  const left = element.offsetLeft
  const width = element.getBoundingClientRect().width
  element.style.left = `${left}px`
  element.style.top = '0px'
  element.style.width = `${width}px`
}

const cancelMenuLeave = (element) => {
  element.style.removeProperty('left')
  element.style.removeProperty('top')
  element.style.removeProperty('width')
  checkOverflow()
}

// 缓动函数
const easeInOutCubic = (t) => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const handleWheelScroll = (e) => {
  if (!menuContainer.value) return

  const container = menuContainer.value
  const canScroll = container.scrollWidth - container.clientWidth > SCROLL_TOLERANCE

  if (!canScroll) return

  e.preventDefault()
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientWidth : 1
  const delta = (horizontal ? e.deltaX : e.deltaY * 1.5) * unit
  // 触控板横向输入直接跟随手势，鼠标纵向滚轮保持平滑横移。
  scrollToPosition(container.scrollLeft + delta, !horizontal)

  if (showScrollHint.value) {
    showScrollHint.value = false
    clearTimeout(hintTimeout)
  }
}

const handleScroll = () => {
  const container = menuContainer.value
  if (!container) return false

  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
  const hasOverflow = maxScroll > SCROLL_TOLERANCE
  const scrollLeft = Math.max(0, Math.min(container.scrollLeft, maxScroll))
  showLeftFade.value = hasOverflow && scrollLeft > SCROLL_TOLERANCE
  showRightFade.value = hasOverflow && maxScroll - scrollLeft > SCROLL_TOLERANCE
  if (!hasOverflow) {
    cancelScrollAnimation()
    container.scrollLeft = 0
    showScrollHint.value = false
    clearTimeout(hintTimeout)
  }
  return hasOverflow
}

const checkOverflow = () => {
  if (handleScroll()) {
    const lastHintTime = storage.local.get('lastHintTime') || 0
    const now = Date.now()

    if (now - lastHintTime > 28800000) {
      showScrollHint.value = true
      storage.local.set('lastHintTime', now)
      hintTimeout = setTimeout(() => {
        showScrollHint.value = false
      }, 3000)
    }
  }
}

// 定时器引用
let hintTimeout = null
let resizeObserver = null

// 监听器
watch(
  () => getMenuRouteKey(route.fullPath),
  (routeKey) => {
    const index = menuList.value.findIndex((item) => isSameMenuRoute(item, routeKey))
    if (index >= 0) {
      menuIndex.value = index
      scrollToItem(index, true)
    } else {
      menuIndex.value = -1
    }
  },
  { immediate: true }
)

watch(
  menuList,
  (newList) => {
    const currentFullPath = route.fullPath
    const index = newList.findIndex((item) => isSameMenuRoute(item, currentFullPath))

    if (index >= 0) {
      menuIndex.value = index
    } else {
      menuIndex.value = -1
    }

    cancelScrollAnimation()
    checkOverflow()
    if (index >= 0) {
      scrollToItem(index, true)
    }
  },
  { deep: true, flush: 'post' }
)

// 生命周期
watch(locale, () => {
  closeContextMenu()
  checkOverflow()
  if (menuIndex.value >= 0) scrollToItem(menuIndex.value, true)
}, { flush: 'post' })

onMounted(() => {
  checkOverflow()
  resizeObserver = new ResizeObserver(checkOverflow)
  resizeObserver.observe(menuContainer.value)
  resizeObserver.observe(menuItemsWrapper.value)
  window.addEventListener('resize', closeContextMenu)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', closeContextMenu)
  clearTimeout(hintTimeout)
  cancelScrollAnimation()
})
</script>

<template>
  <div class="page-body-menu">
    <div class="menu-scroll-wrapper">
      <div
        ref="menuContainer"
        class="menu-container"
        :class="{ 'has-left-overflow': showLeftFade, 'has-right-overflow': showRightFade }"
        @wheel="handleWheelScroll"
        @scroll="handleScroll"
      >
        <div ref="menuItemsWrapper" class="menu-items-wrapper">
          <transition-group
            name="menu-close"
            tag="div"
            class="menu-items"
            @before-leave="prepareMenuLeave"
            @leave-cancelled="cancelMenuLeave"
            @after-enter="checkOverflow"
            @after-leave="checkOverflow"
          >
            <!-- 内部工具和任务类型共用同一页签，不能用变化的查询参数重建节点。 -->
            <div
              v-for="(d, i) in menuList"
              :key="getMenuRouteKey(getMenuNavPath(d)) || i"
              class="menu-item"
              :class="{
                'menu-item-active': menuIndex === i,
                'menu-item-off': menuIndex !== i
              }"
              @click="switchMenu(i)"
              @contextmenu="handleContextMenu($event, i)"
            >
              <div class="elip">
                {{ getMenuItemName(d) }}
              </div>
              <div v-if="isMenuClosable(d)" class="item-close flex-c-c" @click.stop="closeMenu(i)">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 1L1 9M1 1L9 9"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
            </div>
          </transition-group>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <transition name="context-menu-fade">
        <div
          v-if="contextMenu.visible"
          class="context-menu-layer"
          @pointerdown.self="closeContextMenu"
          @contextmenu.self.prevent="closeContextMenu"
        >
          <div
            ref="contextMenuPanel"
            class="context-menu-panel"
            :class="{ 'context-menu-panel--pending': !contextMenu.positioned }"
            :style="contextMenuStyle"
            role="menu"
            :aria-label="t('tabs.actions')"
            @pointerdown.stop
            @contextmenu.prevent.stop
            @keydown.esc.stop.prevent="closeContextMenu"
          >
            <button
              v-if="contextMenuExternalUrl"
              type="button"
              class="context-menu-item"
              role="menuitem"
              @click="contextOpenInBrowser"
            >
              <GlobalOutlined class="context-menu-icon" aria-hidden="true" />
              <span>{{ t('tabs.openBrowser') }}</span>
            </button>
            <button
              type="button"
              class="context-menu-item"
              role="menuitem"
              @click="contextCloseCurrent"
            >
              <CloseSquareOutlined class="context-menu-icon" aria-hidden="true" />
              <span>{{ t('tabs.closeCurrent') }}</span>
            </button>
            <div class="context-menu-divider" role="separator"></div>
            <button
              type="button"
              class="context-menu-item"
              role="menuitem"
              @click="contextCloseAll"
            >
              <CloseSquareOutlined class="context-menu-icon" aria-hidden="true" />
              <span>{{ t('tabs.closeAll') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>

    <transition name="fade">
      <div v-if="showScrollHint" class="scroll-hint">
        <div class="hint-content">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 8V12M12 16H12.01M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ t('tabs.scrollHint') }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
.page-body-menu {
  height: 42px;
  width: 100%;
  padding: 0 9px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  position: relative;

  .menu-scroll-wrapper {
    position: relative;
    width: 100%;
    min-width: 0;
    display: flex;
  }

  .menu-container {
    --fade-left-width: 0px;
    --fade-right-width: 0px;
    display: flex;
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      display: none;
    }

    &.has-left-overflow {
      --fade-left-width: 24px;
    }

    &.has-right-overflow {
      --fade-right-width: 24px;
    }

    &.has-left-overflow,
    &.has-right-overflow {
      mask-image: linear-gradient(
        to right,
        transparent,
        #000 var(--fade-left-width),
        #000 calc(100% - var(--fade-right-width)),
        transparent
      );
    }
  }

  .menu-items-wrapper {
    position: relative;
    height: 42px;
    width: max-content;
    min-width: 100%;
    flex-shrink: 0;
    // 退场节点仍在 DOM 中，但不能继续撑大存活标签的滚动范围。
    overflow: clip;
  }

  .menu-items {
    display: flex;
    width: max-content;
    min-width: 100%;
    height: 100%;
  }

  .menu-item {
    position: relative;
    height: 42px;
    min-width: 190px;
    width: max-content;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    background: var(--right-view-bottom-bc);
    cursor: pointer;
    box-sizing: border-box;
    color: #888080;
    font-size: 14px;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
    padding: 0 32px 0 8px;
    // 只过渡颜色：页签栏现在是常驻单实例，切换时不应带出尺寸、层级等属性的动画。
    transition:
      background-color var(--duration-base, 180ms) var(--ease-standard, ease),
      color var(--duration-base, 180ms) var(--ease-standard, ease);
    user-select: none;

    .elip {
      width: auto;
      white-space: nowrap;
      overflow: visible;
      text-overflow: clip;
    }

    &.menu-item-off {
      &:hover {
        background: #e4e4e7;
        color: #666;
      }
    }

    &.menu-item-active {
      height: 42px;
      background: var(--app-view-bc);
      color: #000;
      z-index: 1;
      font-weight: 500;
    }

    .item-close {
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      cursor: pointer;
      z-index: 2;

      &:hover {
        background: rgba(0, 0, 0, 0.1);
      }
    }
  }

  /* 关闭动画优化 */
  .menu-close-move {
    transition: all 0.3s ease;
  }

  .menu-close-enter-active,
  .menu-close-leave-active {
    transition: all 0.3s cubic-bezier(0.65, 0, 0.35, 1);
  }

  .menu-close-enter-from {
    opacity: 0;
    transform: translateX(30px);
  }

  .menu-close-leave-to {
    opacity: 0;
    transform: translate(-30px, 10px);
  }

  .menu-close-leave-active {
    position: absolute;
    z-index: 2;
  }

  /* 现代化提示 */
  .scroll-hint {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;

    .hint-content {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #fff;
      color: #333;
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      font-size: 12px;
      font-weight: 500;
      border: 1px solid #eee;

      svg {
        color: #666;
      }
    }
  }

  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.3s ease;
  }

  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }

}

.context-menu-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-dropdown, 120);
}

.context-menu-panel {
  position: fixed;
  width: 146px;
  padding: 3px;
  overflow: hidden;
  color: var(--color-text, #151922);
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-sm, 6px);
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.11);
  transform-origin: top left;

  &.context-menu-panel--pending {
    visibility: hidden;
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 29px;
  gap: 8px;
  padding: 0 8px;
  color: var(--color-text-secondary, #344054);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  text-align: left;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs, 4px);
  cursor: default;
  user-select: none;
  transition:
    color var(--duration-fast, 120ms) ease,
    background-color var(--duration-fast, 120ms) ease;

  &:hover,
  &:focus-visible {
    color: var(--color-text, #151922);
    background: var(--color-surface-hover, #f1f4f8);
    outline: none;
  }

  &:active {
    background: var(--color-surface-active, #e8edf3);
  }
}

.context-menu-icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  color: var(--color-text-muted, #667085);
  font-size: 14px;
}

.context-menu-divider {
  height: 1px;
  margin: 3px 7px;
  background: color-mix(in srgb, var(--color-border, #d9e0e8) 72%, transparent);
}

.context-menu-fade-enter-active .context-menu-panel {
  transition:
    opacity var(--duration-fast, 120ms) cubic-bezier(0.16, 1, 0.3, 1),
    transform var(--duration-fast, 120ms) cubic-bezier(0.16, 1, 0.3, 1);
}

.context-menu-fade-leave-active .context-menu-panel {
  transition:
    opacity 80ms ease-in,
    transform 80ms ease-in;
}

.context-menu-fade-enter-from .context-menu-panel,
.context-menu-fade-leave-to .context-menu-panel {
  opacity: 0;
  transform: scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .page-body-menu .menu-item,
  .page-body-menu .menu-close-move,
  .page-body-menu .menu-close-enter-active,
  .page-body-menu .menu-close-leave-active,
  .page-body-menu .fade-enter-active,
  .page-body-menu .fade-leave-active,
  .context-menu-fade-enter-active .context-menu-panel,
  .context-menu-fade-leave-active .context-menu-panel {
    transition-duration: 1ms;
  }
}
</style>
