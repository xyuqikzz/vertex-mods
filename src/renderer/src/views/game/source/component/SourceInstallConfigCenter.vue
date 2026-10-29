<script setup>
import { computed, ref } from 'vue'
import NexusConfigCenter from '@views/game/nexus/component/NexusConfigCenter.vue'

defineOptions({
  inheritAttrs: false
})

// 转发内部配置中心的上传入口，页头的「上传我的配置」按钮通过 ref 调用。
const centerRef = ref(null)

defineExpose({
  openCreateWorkspace: () => centerRef.value?.openCreateWorkspace(),
  uploadActionText: computed(() => centerRef.value?.uploadActionText || '上传我的配置'),
  myStatusLoading: computed(() => !!centerRef.value?.myStatusLoading)
})
</script>

<template>
  <nexus-config-center ref="centerRef" v-bind="$attrs" />
</template>
