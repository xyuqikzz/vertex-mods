<script setup>
import { useDisplayImage } from '@renderer/composables/useDisplayImage.js'

const props = defineProps({
  src: { type: String, required: true },
  alt: { type: String, default: '' },
  loading: { type: String, default: 'lazy' }
})

const { host, resolvedSrc, failureMessage, isLoaded, isError, onLoad, onError } = useDisplayImage(props)
</script>

<template>
  <div ref="host" class="app-image">
    <!-- 图片 -->
    <img
      v-if="resolvedSrc"
      v-show="!isError"
      :key="resolvedSrc"
      :src="resolvedSrc"
      :alt="alt"
      decoding="async"
      class="app-image__img"
      :class="{ 'is-loaded': isLoaded }"
      @load="onLoad"
      @error="onError"
    />

    <!-- 加载中：蓝色进度条 -->
    <div v-if="!isLoaded && !isError" class="app-image__loading">
      <div class="progress-bar">
        <div class="progress"></div>
      </div>
    </div>

    <!-- 加载失败 -->
    <div v-if="isError" class="app-image__error" :title="failureMessage" :aria-label="failureMessage">
      <div class="error-content">
        <svg class="error-icon" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12,2C6.47,2,2,6.47,2,12s4.47,10,10,10s10-4.47,10-10S17.53,2,12,2z M17,15.59L15.59,17L12,13.41L8.41,17L7,15.59L10.59,12L7,8.41L8.41,7L12,10.59L15.59,7L17,8.41L13.41,12L17,15.59z"
          />
        </svg>
        <p class="error-text">{{ $t('ui.imageFailed') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-image {
  position: relative;
  display: inline-block;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

/* 图片淡入 */
.app-image__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.app-image__img.is-loaded {
  opacity: 1;
}

/* 加载中：无独立背景，继承父容器 */
.app-image__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 错误状态：需要遮罩盖住 broken img */
.app-image__error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 24, 36, 0.9);
}

/* ====== 线性进度条（橙色系） ====== */
.progress-bar {
  position: relative;
  width: 60%;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}
.progress {
  position: absolute;
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, #ea8e2e, #f59e0b);
  border-radius: 2px;
  animation: progress-move 1.2s ease-in-out infinite;
}

@keyframes progress-move {
  0% {
    left: -40%;
  }
  50% {
    left: 30%;
  }
  100% {
    left: 100%;
  }
}

/* ====== 错误状态 ====== */
.error-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.error-icon {
  width: 36px;
  height: 36px;
  color: #ff5252;
  animation: pulse 1.5s infinite;
}

.error-text {
  margin: 0;
  font-size: 14px;
  color: #666;
  font-weight: 500;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}
</style>
