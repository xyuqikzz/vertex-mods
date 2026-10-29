<template>
  <VxModal v-model="visible" plain :show-close="false" :width="960">
    <div class="pop">
      <div class="pop_header">
        <h3>{{ $t('ui.viewImage') }}</h3>
        <button class="close-btn" @click="close">
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
      </div>
      <div class="pop_buttons d-flex">
        <button class="pop_button" :disabled="isLoading || isError" @click="downloadImage">
          <svg width="18" height="18" viewBox="0 0 24 24" class="button-icon">
            <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
          {{ $t('ui.downloadImage') }}
        </button>
        <button
          class="pop_button"
          :disabled="isLoading || isError"
          @click="downloadAndSetWallpaper"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" class="button-icon">
            <path
              fill="currentColor"
              d="M4 4h7V2H4c-1.1 0-2 .9-2 2v7h2V4zm6 9l-4 5h12l-3-4-2.03 2.71L10 13zm7-4.5c0-.83-.67-1.5-1.5-1.5S14 7.67 14 8.5s.67 1.5 1.5 1.5S17 9.33 17 8.5zM20 2h-7v2h7v7h2V4c0-1.1-.9-2-2-2zm0 18h-7v2h7c1.1 0 2-.9 2-2v-7h-2v7zM4 13H2v7c0 1.1.9 2 2 2h7v-2H4v-7z"
            />
          </svg>
          {{ $t('ui.downloadAndSetAsWallpaper') }}
        </button>
      </div>
      <div class="pop_content">
        <!-- 图片容器 - 固定大小 -->
        <div ref="imageContainer" class="image-container">
          <!-- 加载状态遮罩 - 完全遮挡 -->
          <div v-if="isLoading && !isError" class="loading-mask"></div>

          <!-- 加载状态内容 -->
          <div v-if="isLoading && !isError" class="image-loader">
            <div class="loader-spinner">
              <div class="spinner-inner"></div>
            </div>
            <div class="loader-progress">
              <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
            </div>
          </div>

          <!-- 加载失败状态 -->
          <div v-if="isError" class="error-loader">
            <div class="error-icon">
              <svg width="48" height="48" viewBox="0 0 24 24">
                <path
                  fill="#ef4444"
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                />
              </svg>
            </div>
            <div class="error-text">{{ $t('ui.couldNotLoadTheImage') }}</div>
            <div class="error-countdown">{{ $t('ui.thisWindowClosesIn') }} {{ countdown }} {{ $t('ui.seconds') }}</div>
          </div>

          <!-- 画布效果 - 加载成功后永久显示 -->
          <div v-if="!isLoading && !isError" class="canvas-effect"></div>

          <!-- 图片 -->
          <img
            ref="imageElement"
            class="pop_img"
            :src="imageUrl"
            :alt="$t('ui.gameScreenshot')"
            @load="handleImageLoad"
            @error="handleImageError"
          />
        </div>
      </div>
    </div>
  </VxModal>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import { useDownloadStore } from '@renderer/store/downloadStore.js'

const downloadStore = useDownloadStore()
const visible = ref(false)
const imageUrl = ref('')
const isLoading = ref(false)
const isError = ref(false)
const progress = ref(0)
const countdown = ref(1.5)
const imageContainer = ref(null)
const imageElement = ref(null)

let loadStartTime = 0
let minLoadTime = 0 // 最小加载时间1秒
let progressInterval = null
let countdownInterval = null
let resizeObserver = null

// 确保组件卸载时清理所有资源
onBeforeUnmount(() => {
  cleanup()
})

const cleanup = () => {
  clearInterval(progressInterval)
  clearInterval(countdownInterval)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  progressInterval = null
  countdownInterval = null
}

const open = async (url) => {
  // 清理之前的资源
  cleanup()

  // 重置状态
  isLoading.value = true
  isError.value = false
  progress.value = 0
  countdown.value = 1.5
  imageUrl.value = url.replace(/\.\d+x\d+(?=\.\w+$)/, '')

  // 显示弹窗
  visible.value = true

  // 等待DOM更新
  await nextTick()

  // 设置容器固定大小
  if (imageContainer.value) {
    // 设置固定高度，防止加载时窗口大小变化
    const containerHeight = imageContainer.value.offsetHeight
    imageContainer.value.style.minHeight = `${containerHeight}px`
  }

  // 开始加载
  startLoading()
}

const close = () => {
  visible.value = false
  resetState()
}

const resetState = () => {
  cleanup()
  isLoading.value = false
  isError.value = false
  progress.value = 0
  countdown.value = 1.5

  // 重置容器大小
  if (imageContainer.value) {
    imageContainer.value.style.minHeight = ''
  }
}

const startLoading = () => {
  loadStartTime = Date.now()

  // 模拟进度条
  progressInterval = setInterval(() => {
    if (progress.value < 95) {
      progress.value += Math.random() * 10
    }
  }, 100)
}

const completeLoading = () => {
  const elapsed = Date.now() - loadStartTime
  const remainingTime = minLoadTime - elapsed

  if (remainingTime > 0) {
    // 如果加载太快，确保至少显示1秒
    setTimeout(() => {
      finishLoading()
    }, remainingTime)
  } else {
    finishLoading()
  }
}

const finishLoading = () => {
  progress.value = 100
  clearInterval(progressInterval)
  setTimeout(() => {
    isLoading.value = false
  }, 300)
}

const startErrorCountdown = () => {
  isError.value = true
  countdown.value = 1.5
  countdownInterval = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 0.1)
    if (countdown.value <= 0) {
      clearInterval(countdownInterval)
      close()
    }
  }, 100)
}

const getImageFileType = (downloadUrl = '') => {
  try {
    const extension = new URL(String(downloadUrl || '')).pathname.match(
      /\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i
    )?.[1]
    return extension ? extension.toLowerCase() : '未知'
  } catch {
    return '未知'
  }
}

const downloadImage = () => {
  const download_url = imageUrl.value
  const file_type = getImageFileType(download_url)
  const item = {
    task_name: '图片下载',
    module: '通用',
    file_type,
    download_url,
    speed: 0,
    file_size: 0,
    percentage: 0,
    saveType: 0,
    fun: {
      type: 1
    }
  }
  downloadStore.addDownloadItem(item)
  close()
}

const downloadAndSetWallpaper = () => {
  const download_url = imageUrl.value
  const file_type = getImageFileType(download_url)
  const item = {
    task_name: '图片下载',
    module: '通用',
    file_type,
    download_url,
    speed: 0,
    file_size: 0,
    percentage: 0,
    saveType: 0,
    fun: {
      type: 2,
      method: 'setImageAsWallpaper'
    }
  }
  downloadStore.addDownloadItem(item)
  close()
}

const handleImageLoad = () => {
  completeLoading()
}

const handleImageError = () => {
  startErrorCountdown()
}

// 暴露方法给外部调用
defineExpose({
  open,
  close
})
</script>

<style scoped lang="scss">
.pop {
  width: min(60vw, calc(100vw - 24px));
  min-width: 0;
  background: var(--color-bg-card);
  border-radius: 12px;
  padding: 0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  position: relative;

  .pop_header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid var(--color-border);

    h3 {
      margin: 0;
      font-size: 1.2rem;
      color: var(--color-text-primary);
    }

    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s;

      &:hover {
        background-color: var(--color-bg-hover);
      }

      svg {
        color: var(--color-text-muted);
      }
    }
  }

  .pop_buttons {
    padding: 16px 24px;
    gap: 16px;
    border-bottom: 1px solid var(--color-border);

    .pop_button {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background-color: var(--color-bg-hover);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      &:hover:not(:disabled) {
        background-color: var(--color-surface-active, #e8edf3);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .button-icon {
        flex-shrink: 0;
      }
    }
  }

  .pop_content {
    position: relative;
    padding: 10px 0;
    background-color: var(--color-bg-page);

    /* 图片容器 - 固定大小 */
    .image-container {
      position: relative;
      width: 100%;
      height: 70vh; /* 固定高度 */
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;

      /* 加载遮罩 - 完全遮挡 */
      .loading-mask {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: var(--color-bg-card);
        z-index: 5;
      }

      /* 加载状态内容 */
      .image-loader {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10;

        .loader-spinner {
          width: 60px;
          height: 60px;
          position: relative;
          margin-bottom: 20px;

          .spinner-inner {
            position: absolute;
            width: 100%;
            height: 100%;
            border: 4px solid transparent;
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: spin 1.2s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;

            &::before,
            &::after {
              content: '';
              position: absolute;
              border-radius: 50%;
              border: 4px solid transparent;
            }

            &::before {
              top: 5px;
              left: 5px;
              right: 5px;
              bottom: 5px;
              border-top-color: #7dd3fc;
              animation: spin 2s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
            }

            &::after {
              top: 15px;
              left: 15px;
              right: 15px;
              bottom: 15px;
              border-top-color: #bae6fd;
              animation: spin 1.5s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
            }
          }
        }

        .loader-progress {
          width: 80%;
          max-width: 400px;
          height: 6px;
          background-color: #e6f0fa;
          border-radius: 3px;
          overflow: hidden;

          .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #7dd3fc 0%, #38bdf8 100%);
            border-radius: 3px;
            transition: width 0.3s ease-out;
          }
        }
      }

      /* 错误状态 */
      .error-loader {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background-color: var(--color-bg-card);
        z-index: 20;

        .error-icon {
          margin-bottom: 16px;
        }

        .error-text {
          font-size: 1.2rem;
          color: #ef4444;
          margin-bottom: 8px;
        }

        .error-countdown {
          font-size: 0.9rem;
          color: #6b7280;
        }
      }

      /* 画布效果 - 增强版 */
      .canvas-effect {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image:
          linear-gradient(45deg, #c1cbd8 25%, transparent 25%),
          linear-gradient(-45deg, #c1cbd8 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #c1cbd8 75%),
          linear-gradient(-45deg, transparent 75%, #c1cbd8 75%);
        background-size: 16px 16px;
        background-position:
          0 0,
          0 8px,
          8px -8px,
          -8px 0px;
        pointer-events: none;
        z-index: 1;
      }

      /* 图片 */
      .pop_img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
          display: block;
        position: relative;
        z-index: 2;
      }
    }
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
