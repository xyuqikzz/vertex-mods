<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import { ToolPageShell } from '@renderer/component/tool-page/index.js'
import FlingTrainerTool from '@views/game-tools/component/fling-trainer-tool.vue'
import DlssTool from '@views/game-tools/component/dlss-tool.vue'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'

const route = useRoute()
const router = useRouter()
const aiPageContextProvider = useAiPageContextProvider(route)
const { setMenuName: setPageMenuName } = useMenuName()

const toolList = [
  {
    key: 'fling-trainer',
    name: '风灵月影',
    get summary() { return uiText('tools.officialFLiNGTrainersReadyToRunAfterDownload') },
    icon: 'wrench',
    component: FlingTrainerTool
  },
  {
    key: 'dlss',
    name: 'DLSS5 安装',
    get summary() { return uiText('tools.installTheComponentsThenLaunchTheGameAsUsual') },
    icon: 'chip',
    component: DlssTool
  }
]

function resolveToolKey(tool) {
  const queryTool = String(tool || '').trim()
  return toolList.find((item) => item.key === queryTool)?.key || toolList[0].key
}

const activeToolKey = ref(resolveToolKey(route.query?.tool))
watch(
  () => route.query?.tool,
  (value) => {
    if (route.path === '/app/game-tools') activeToolKey.value = resolveToolKey(value)
  }
)
const activeTool = computed(
  () => toolList.find((item) => item.key === activeToolKey.value) || toolList[0]
)
const shellTools = computed(() =>
  toolList.map((tool) => ({
    key: tool.key,
    name: tt(tool.name),
    summary: tt(tool.summary),
    icon: tool.icon
  }))
)

watch(
  [() => route.path, activeToolKey],
  () => {
    if (route.path !== '/app/game-tools') return
    aiPageContextProvider.update({
      page: { type: activeToolKey.value, scene: activeToolKey.value, title: activeTool.value.name }
    })
  },
  { immediate: true }
)

function selectTool(key) {
  if (key === activeToolKey.value) return
  router.replace({ path: route.path, query: { ...route.query, tool: key } })
}

watch(
  () => route.fullPath,
  () => {
    setPageMenuName('游戏工具', {
      path: route.path,
      fullPath: route.fullPath
    })
  },
  { immediate: true }
)

defineOptions({
  name: 'GameTools'
})
</script>

<template>
  <div class="game-tools-page">
    <page-body :is-scroll-enabled="false">
      <ToolPageShell
        :model-value="activeToolKey"
        :tools="shellTools"
        :label="tt('游戏工具')"
        @update:model-value="selectTool"
      >
        <keep-alive>
          <component :is="activeTool.component" :key="activeTool.key" />
        </keep-alive>
      </ToolPageShell>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.game-tools-page {
  width: 100%;
  height: 100%;
}
</style>
