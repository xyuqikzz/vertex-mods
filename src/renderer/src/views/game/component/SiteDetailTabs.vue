<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@renderer/store/appStore.js'
import { getMenuRouteKey } from '@renderer/utils/menu-route-key.js'

const SiteDetail = defineAsyncComponent(() => import('../site-detail.vue'))
const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const activeKey = computed(() => getMenuRouteKey(route.fullPath))
const tabs = computed(() => {
  const entries = new Map()
  for (const item of appStore.menuList) {
    const resolved = router.resolve(item.fullPath || item.path)
    if (resolved.name !== 'GameSiteDetail') continue
    const key = getMenuRouteKey(resolved.fullPath)
    entries.set(key, {
      key,
      route: {
        name: resolved.name,
        path: resolved.path,
        fullPath: resolved.fullPath,
        query: { ...resolved.query }
      }
    })
  }
  return [...entries.values()]
})
</script>

<template>
  <!-- webview 不能随 KeepAlive 移出 DOM，否则 Electron 会重建其中的网页。 -->
  <div v-show="route.name === 'GameSiteDetail'" class="site-detail-tabs">
    <SiteDetail
      v-for="tab in tabs"
      v-show="tab.key === activeKey"
      :key="tab.key"
      :page-route="tab.route"
      :active="tab.key === activeKey"
    />
  </div>
</template>

<style scoped>
.site-detail-tabs {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
