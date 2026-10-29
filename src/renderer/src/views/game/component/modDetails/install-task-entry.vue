<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { VxModal, VxButton } from '@renderer/component/vertex-ui'
import { useInstallStore } from '@renderer/store/installStore.js'
import { getRetiredSourceFailure } from '../../../../../../shared/sources/retired-source-policy.js'
defineProps({ hideEntry: { type: Boolean, default: false } })
const installStore = useInstallStore()
const activeTaskId = ref('')
const activeTask = computed(() => installStore.peekTaskById(activeTaskId.value))
const visible = computed({
  get: () => Boolean(activeTask.value),
  set: (value) => {
    if (!value) activeTaskId.value = ''
  }
})
const message = getRetiredSourceFailure().message
function openHistory(event) {
  activeTaskId.value = String(event?.detail?.taskId || '')
}
onMounted(() => window.addEventListener('vertex:open-install-task-detail', openHistory))
onUnmounted(() => window.removeEventListener('vertex:open-install-task-detail', openHistory))
</script>

<template>
  <VxModal v-model="visible" :title="$t('ui.legacyInstallationTask')">
    <p>{{ message }}</p>
    <p>{{ activeTask?.gameName || $t('ui.legacyGame') }} · {{ activeTask?.sourceName || $t('ui.retiredSourceTask') }}</p>
    <p>{{ $t('ui.theOriginalTaskRecordIsRetainedDownloadsDeploymentManifestsAnd') }}</p>
    <ul>
      <li v-for="(mod, index) in activeTask?.mods || []" :key="index">
        {{ mod.modName || mod.name || $t('ui.legacyMod') }}
      </li>
    </ul>
    <VxButton @click="visible = false">{{ $t('ui.close') }}</VxButton>
  </VxModal>
</template>
