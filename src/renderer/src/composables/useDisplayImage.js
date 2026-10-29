import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { onBeforeUnmount, ref, watch } from 'vue'
import { communityImageSource } from '../../../shared/sources/source-network.js'
import { loadSourceImage } from '../utils/source-image.js'
import { displayImageUrl } from '../utils/display-image.js'
import { useImageState } from './useImageState.js'

export function useDisplayImage(props) {
  const host = ref(null)
  const visible = ref(false)
  const resolvedSrc = ref('')
  const failureMessage = ref('图片加载失败')
  const state = useImageState(resolvedSrc)
  let observer
  let controller
  let ownedUrl
  let originalSrc = ''

  function clearRequest() {
    controller?.abort()
    if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    ownedUrl = undefined
  }

  watch([host, () => props.loading], ([element, loading]) => {
    observer?.disconnect()
    if (!element || visible.value) return
    if (loading === 'eager' || typeof IntersectionObserver === 'undefined') {
      visible.value = true
      return
    }
    // 在实际网络请求之前判断可见性，同时覆盖背景图片和主进程代理下载。
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        visible.value = true
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(element)
  }, { flush: 'post' })

  watch([() => props.src, visible], async ([src, ready]) => {
    clearRequest()
    resolvedSrc.value = ''
    originalSrc = src || ''
    state.reset()
    failureMessage.value = uiText('ui.couldNotLoadTheImage')
    if (!src || !ready) return
    if (!communityImageSource(src)) {
      const rect = host.value?.getBoundingClientRect()
      const pixels = Math.max(rect?.width || 0, rect?.height || 0) * (globalThis.devicePixelRatio || 1)
      resolvedSrc.value = displayImageUrl(src, pixels || 640)
      return
    }
    const request = new AbortController()
    controller = request
    try {
      const result = await loadSourceImage(src, request.signal)
      if (request.signal.aborted) {
        URL.revokeObjectURL(result.url)
        return
      }
      ownedUrl = result.url
      resolvedSrc.value = result.url
    } catch (error) {
      if (!request.signal.aborted) {
        failureMessage.value = error.message || uiText('ui.couldNotLoadTheImage')
        state.onError()
      }
    }
  }, { immediate: true })

  function isCurrentImage(event) {
    return !event?.currentTarget || event.currentTarget.getAttribute('src') === resolvedSrc.value
  }

  function onLoad(event) {
    if (isCurrentImage(event)) state.onLoad()
  }

  function onError(event) {
    if (!isCurrentImage(event)) return
    if (!ownedUrl && resolvedSrc.value && resolvedSrc.value !== originalSrc) {
      // 缩略图暂不可用时只回退一次原图，兼容尚未更新的后端与只读存储。
      resolvedSrc.value = originalSrc
    } else {
      state.onError()
    }
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    clearRequest()
  })
  return { ...state, host, resolvedSrc, failureMessage, onLoad, onError }
}
