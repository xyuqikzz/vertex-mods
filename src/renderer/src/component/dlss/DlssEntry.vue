<script setup>
import { computed, ref, watch } from 'vue'
import { VxButton } from '@renderer/component/vertex-ui'
import DlssPanel from './DlssPanel.vue'
const props = defineProps({ context: { type: Object, required: true } })
const open = ref(false)
const canScan = computed(() =>
  [props.context.gameRoot, props.context.exePath].some(
    (path) => typeof path === 'string' && path.trim()
  )
)
function scanGame() {
  if (canScan.value) open.value = true
}
watch(canScan, (ready) => {
  if (!ready) open.value = false
})
</script>
<template>
  <VxButton
    class="dlss-entry-button"
    variant="secondary"
    :disabled="!canScan"
    :title="canScan ? $t('ui.scanDetectedGameFolders') : $t('ui.noLocalGameDetected')"
    @click="scanGame"
    >DLSS5</VxButton
  >
  <DlssPanel
    v-model="open"
    :context="{ ...context, source: 'mod-center' }"
    :allow-directory-selection="false"
  />
</template>
