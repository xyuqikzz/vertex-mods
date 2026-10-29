import { ref, watch } from 'vue'

/**
 * 图片加载状态管理 composable
 * 提供统一的加载中/成功/失败三态管理，AppImage 和 ImageViewer 共享逻辑
 * @param {import('vue').Ref<string>} srcRef - 图片地址的响应式引用
 */
export function useImageState(srcRef) {
  const isLoaded = ref(false)
  const isError = ref(false)
  const isLoading = ref(true)

  function onLoad() {
    isLoaded.value = true
    isLoading.value = false
    isError.value = false
  }

  function onError() {
    isError.value = true
    isLoaded.value = false
    isLoading.value = false
  }

  function reset() {
    isLoaded.value = false
    isError.value = false
    isLoading.value = true
  }

  watch(
    srcRef,
    () => {
      reset()
    },
    { immediate: true }
  )

  return { isLoaded, isError, isLoading, onLoad, onError, reset }
}
