import { bootstrapAccount } from './utils/account-bootstrap.js'
import { createApp } from 'vue'
import { clientI18n } from './i18n/index.js'
import App from './App.vue'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './assets/scss/main.scss'
import './assets/scss/flex.css'
import './component/vertex-ui/styles.scss'
import AppImage from './component/AppImage.vue'
import { initStatisticsTracker } from './utils/statistics-tracker.js'
import { installConfirmDialog } from './common/confirm-dialog.js'
import { waitForElectronBridge } from './utils/electron-ready.js'

// UI 框架按实际使用组件注册，避免整套 Ant Design Vue 进入首屏。
import { Modal } from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import { installAntDesignComponents } from './plugins/ant-design-components.js'
// 状态机Pinia
import { createPinia } from 'pinia'
// vue路由器
import router from './router'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

import imageViewer from './plugins/imageViewer'

async function startRenderer() {
  await waitForElectronBridge()
  await bootstrapAccount()
  const app = createApp(App)

  app.use(clientI18n)
  app.use(router)
  app.use(pinia)
  installAntDesignComponents(app)
  installConfirmDialog(Modal)
  // 注册插件
  app.use(imageViewer)
  app.component('AppImage', AppImage)
  initStatisticsTracker({ app, router })
  app.mount('#app')
}

startRenderer().catch((error) => {
  console.error('[Renderer startup]', error)
  const root = document.getElementById('app')
  if (!root) return
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = clientI18n.i18n.global.t('startup.failed')
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = clientI18n.i18n.global.t('common.reload')
  retry.onclick = () => window.location.reload()
  root.replaceChildren(message, retry)
})
