<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import { ToolPageShell } from '@renderer/component/tool-page/index.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import DeviceInfoTool from '@views/device/component/device-info-tool.vue'
import UninstallTab from './component/UninstallTab.vue'
import OptimizeScriptTab from './component/OptimizeScriptTab.vue'

const SYSTEM_PATH = '/app/system'
const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()
const router = useRouter()

const tabList = [
  {
    key: 'device-info',
    get label() { return uiText('tools.deviceInformation') },
    get summary() { return uiText('tools.viewHardwareAndDiskSpace') },
    icon: 'monitor',
    component: DeviceInfoTool
  },
  {
    key: 'uninstall',
    get label() { return uiText('tools.uninstallApps') },
    get summary() { return uiText('tools.uninstallAppsAndCleanUpLeftoverFilesAndRegistry') },
    icon: 'package',
    component: UninstallTab
  },
  {
    key: 'optimize',
    get label() { return uiText('tools.systemOptimization') },
    get summary() { return uiText('tools.runCommonSystemOptimizationScripts') },
    icon: 'bolt',
    component: OptimizeScriptTab
  }
]

function resolveTabKey(value) {
  const key = String(value || '').trim()
  return tabList.find((tab) => tab.key === key)?.key || tabList[0].key
}

const activeTab = ref(resolveTabKey(route.query?.tool))
watch(
  () => route.query?.tool,
  (value) => {
    if (route.path === SYSTEM_PATH) activeTab.value = resolveTabKey(value)
  }
)

const activeTabItem = computed(() => {
  return tabList.find((tab) => tab.key === activeTab.value) || tabList[0]
})
const shellTools = computed(() =>
  tabList.map((tab) => ({
    key: tab.key,
    name: tt(tab.label),
    summary: tt(tab.summary),
    icon: tab.icon
  }))
)

function selectTab(key) {
  if (key === activeTab.value) return
  // 与游戏工具一致，用地址参数记住当前模块；菜单页签按路径识别，不会因参数变化新开页签。
  router.replace({ path: route.path, query: { ...route.query, tool: key } })
}

defineOptions({
  name: 'System'
})

// 菜单页签记住带 ?tool= 的完整地址，切回页签时回到原来的模块。
watch(
  () => route.fullPath,
  () => {
    if (route.path !== SYSTEM_PATH) return
    setPageMenuName('系统工具', { path: route.path, fullPath: route.fullPath })
  },
  { immediate: true }
)
</script>

<template>
  <div class="system-index">
    <page-body :is-scroll-enabled="false">
      <ToolPageShell
        :model-value="activeTab"
        :tools="shellTools"
        :label="tt('系统工具')"
        @update:model-value="selectTab"
      >
        <keep-alive>
          <component :is="activeTabItem.component" :key="activeTabItem.key" />
        </keep-alive>
      </ToolPageShell>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.system-index {
  width: 100%;
  height: 100%;
}
</style>
