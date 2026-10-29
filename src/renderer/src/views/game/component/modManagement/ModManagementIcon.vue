<script setup>
import AppImage from '@renderer/component/AppImage.vue'

defineProps({
  src: { type: String, default: '' },
  name: { type: String, default: '' },
  size: { type: Number, default: 24 }
})
</script>

<template>
  <span
    class="mm-icon-frame"
    :class="{ 'is-large': size >= 40 }"
    :style="{ '--mm-icon-size': `${size}px` }"
    aria-hidden="true"
  >
    <!-- 没有图片或加载失败时显示中性的包裹图标，不再用首字母占位。 -->
    <span class="mm-icon-fallback">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
      </svg>
    </span>
    <AppImage v-if="src" :src="src" alt="" />
  </span>
</template>

<style scoped lang="scss">
.mm-icon-frame {
  position: relative;
  display: block;
  flex: none;
  width: var(--mm-icon-size);
  height: var(--mm-icon-size);
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--color-surface-strong);
  &.is-large {
    border-radius: var(--radius-sm);
  }
  .mm-icon-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-text-tertiary);
  }
  .mm-icon-fallback svg {
    width: 58%;
    height: 58%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  &:has(.app-image__img.is-loaded) .mm-icon-fallback {
    visibility: hidden;
  }
  :deep(.app-image) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
  :deep(.app-image__img) {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    object-fit: cover;
    object-position: center;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  // AppImage 保持全局行为，当前页面失败时露出同一个固定外框里的图标占位。
  :deep(.app-image__error) {
    background: transparent;
  }
  :deep(.app-image__error .error-content) {
    display: none;
  }
}
</style>
