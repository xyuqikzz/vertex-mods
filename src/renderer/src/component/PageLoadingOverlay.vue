<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { requestManager } from '@renderer/api/index.js'

const isLoading = ref(false)
const activeRequests = ref([])

const hasUnreachableServer = computed(() =>
  activeRequests.value.some((req) => req.isServerUnreachable)
)

function handleLoadingChange(loading, requests) {
  isLoading.value = loading
  activeRequests.value = requests
}

onMounted(() => {
  requestManager.onLoadingChange(handleLoadingChange)
})

onUnmounted(() => {
  requestManager.removeLoadingListener(handleLoadingChange)
})
</script>

<template>
  <transition name="fade">
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-content">
        <div v-if="!hasUnreachableServer" class="spinner-box">
          <div class="minimal-ring"></div>
        </div>

        <div v-else class="error-box">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
              stroke="var(--color-danger)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M12 8V12"
              stroke="var(--color-danger)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M12 16H12.01"
              stroke="var(--color-danger)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <div class="loading-text" :class="{ 'text-error': hasUnreachableServer }">
          {{ hasUnreachableServer ? $t('ui.connectionProblem') : $t('ui.loading') }}
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped lang="scss">
/* 深色透明 Loading 样式 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: var(--secondary-border-radius);
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.spinner-box {
  width: 32px;
  height: 32px;
  position: relative;
}

.minimal-ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #ffffff;
  animation: spin 0.8s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
}

.error-box {
  animation: shake 0.4s ease-in-out;
  display: flex;
  justify-content: center;
  align-items: center;
}

.loading-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 1px;
  font-weight: 400;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.text-error {
  color: var(--color-danger);
  font-weight: 500;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-3px);
  }
  40% {
    transform: translateX(3px);
  }
  60% {
    transform: translateX(-2px);
  }
  80% {
    transform: translateX(2px);
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
</style>
