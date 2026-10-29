// src/plugins/imageViewer.js
import { createApp, h, ref } from 'vue'
import ImageViewer from '@renderer/component/ImageViewer.vue'

let instance = null

export default {
  install(app) {
    if (instance) return // 防止重复安装

    // 创建挂载点
    const mountPoint = document.createElement('div')
    document.body.appendChild(mountPoint)

    // 创建独立的应用实例
    const imageViewerApp = createApp({
      setup() {
        // 使用markRaw避免响应式转换
        const viewerRef = ref(null)

        const show = (url) => {
          if (viewerRef.value) {
            viewerRef.value.open(url)
          }
        }

        const hide = () => {
          if (viewerRef.value) {
            viewerRef.value.close()
          }
        }

        // 暴露方法给全局
        instance = { show, hide }

        return () =>
          h(ImageViewer, {
            ref: viewerRef
          })
      }
    })

    // 挂载组件
    imageViewerApp.mount(mountPoint)

    // 添加全局方法
    app.config.globalProperties.$imageViewer = instance
    window.$imageViewer = instance
  }
}
