<script setup>
import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import router from '../router/index.js'
import storage from '@renderer/common/storage.js'
import PageLoadingOverlay from '@renderer/component/PageLoadingOverlay.vue'

const props = defineProps({
  isScrollEnabled: { type: Boolean, default: true },
  paddingNum: { type: Number, default: 24 }
})

const emit = defineEmits(['scroll'])

const scrollPosition = ref(0)
const showBackToTop = ref(false)
const pageBodyRef = ref()
const pagePath = router.currentRoute.value.path
let isActive = true

function setScrollTop(top) {
  const url = pagePath
  const scrollPositions = storage.local.get('pageScrollTop') || []
  const existingIndex = scrollPositions.findIndex((item) => item.url === url)
  if (existingIndex !== -1) {
    scrollPositions[existingIndex].top = top
  } else {
    scrollPositions.push({ url: url, top: top })
  }
  storage.local.set('pageScrollTop', scrollPositions)
}

const handleScroll = () => {
  if (!isActive || router.currentRoute.value.path !== pagePath || !pageBodyRef.value) return
  scrollPosition.value = pageBodyRef.value.scrollTop
  setScrollTop(pageBodyRef.value.scrollTop)
  emit('scroll', scrollPosition.value)
  if (pageBodyRef.value.scrollTop > 300) {
    showBackToTop.value = true
  } else {
    showBackToTop.value = false
  }
}

const scrollToTop = () => {
  if (!pageBodyRef.value) return
  pageBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}

const scrollToElement = (id, offset = 0, options = { behavior: 'smooth' }) => {
  nextTick(() => {
    if (!pageBodyRef.value) return
    const element = document.getElementById(id)
    if (!element) return
    const container = pageBodyRef.value
    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const targetPosition = elementRect.top - containerRect.top + container.scrollTop + offset
    const clampedPosition = Math.max(
      0,
      Math.min(targetPosition, container.scrollHeight - container.clientHeight)
    )
    container.scrollTo({ top: clampedPosition, ...options })
  })
}

function saveScrollPosition() {
  if (!isActive || !props.isScrollEnabled || !pageBodyRef.value) return
  scrollPosition.value = pageBodyRef.value.scrollTop
  setScrollTop(scrollPosition.value)
}

// 在 KeepAlive 移走 DOM 之前保存，避免延迟的 scroll 事件丢失或写入下一页。
onBeforeRouteLeave(saveScrollPosition)
onBeforeRouteUpdate((to) => {
  if (to.path !== pagePath) saveScrollPosition()
})

onActivated(async () => {
  isActive = true
  const item = (storage.local.get('pageScrollTop') || []).find((item) => item.url === pagePath)
  const top = item?.top ?? scrollPosition.value
  await nextTick()
  if (!isActive || router.currentRoute.value.path !== pagePath || !pageBodyRef.value) return
  pageBodyRef.value.scrollTo({ top })
  scrollPosition.value = pageBodyRef.value.scrollTop
  showBackToTop.value = scrollPosition.value > 300
})

onDeactivated(() => {
  isActive = false
})

onMounted(() => {
  if (pageBodyRef.value && props.isScrollEnabled) {
    pageBodyRef.value.addEventListener('scroll', handleScroll)
  }
})

onUnmounted(() => {
  if (pageBodyRef.value) {
    pageBodyRef.value.removeEventListener('scroll', handleScroll)
  }
})

defineExpose({ scrollToElement, getScrollPosition: () => scrollPosition.value })
</script>

<template>
  <div class="page-container">
    <!-- 顶部页签栏由 views/index.vue 全局渲染一份，这里只负责页面内容区域。 -->
    <div
      ref="pageBodyRef"
      class="page-body"
      :class="{ 'page-body-overflow-y': isScrollEnabled }"
      :style="{ '--page-body-padding': `${props.paddingNum}px` }"
    >
      <div class="page-body-content">
        <slot></slot>
      </div>
    </div>

    <transition name="fade">
      <div
        v-show="showBackToTop && isScrollEnabled"
        class="back-to-top"
        :title="$t('ui.backToTop')"
        @click="scrollToTop"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 19V5M12 5L5 12M12 5L19 12"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </transition>

    <PageLoadingOverlay />
  </div>
</template>

<style scoped lang="scss">
// 基础布局保持不变
.page-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.page-body {
  --page-body-padding: 24px;

  width: 100%;
  height: 100%;
  border-radius: var(--secondary-border-radius);
  background-color: var(--app-view-bc);
  box-sizing: border-box;
  overflow: hidden;
}

.page-body-content {
  width: 100%;
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: var(--page-body-padding);
}

.page-body-overflow-y {
  overflow-y: overlay;
  scrollbar-gutter: stable;
}

.back-to-top {
  position: absolute;
  right: 32px;
  bottom: 32px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: var(--app-view-bc, #ffffff);
  border: 1px solid rgba(128, 128, 128, 0.15);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  z-index: 900;
  color: var(--text-color, #606266);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);

  svg {
    width: 24px;
    height: 24px;
    transition: transform 0.3s ease;
  }
  &:hover {
    color: #0a96ff;
    border-color: rgba(10, 150, 255, 0.3);
    box-shadow: 0 6px 16px rgba(10, 150, 255, 0.15);
  }
}

// 滚动条样式
.page-body::-webkit-scrollbar {
  width: 7px;
}
.page-body::-webkit-scrollbar-track {
  background: var(--scrollbar-track-color);
  border-radius: var(--default-border-radius);
  margin: 24px 0;
}
.page-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb-color);
  border-radius: 4px;
  min-height: 40px;
}
.page-body::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

// 过渡动画 (Fade In/Out)
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
