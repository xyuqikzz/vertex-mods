<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { ref } from 'vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import SettingRow from './SettingRow.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'
defineProps({ path: { type: String, default: '' } })
const changing = ref(false)
const progress = ref({ fileCount: 0, sizeMB: '0.00' })
useIpc('cache-path-migration-progress', (payload) => {
  progress.value = payload || {}
})
function openCacheFolder() {
  ipcRenderer.send('open-app-directory', 'cache')
}

async function changePath() {
  if (changing.value) return
  changing.value = true
  try {
    const result = await ipcRenderer.invoke('changeCachePath')
    if (result?.canceled) return
    if (!result?.success) throw new Error(result?.message || uiText('ui.cacheFolderMigrationFailed'))
    if (result.cleanupWarning)
      $message.warning(uiMessage('ui.cacheFolderUpdatedButOldFolderCleanupFailedValue', { value1: (result.cleanupWarning) }))
    else if (result.skippedLinkCount)
      $message.warning(uiMessage('ui.cacheFolderUpdatedValueDirectoryLinksWereSkipped', { value1: (result.skippedLinkCount) }))
    else $message.success(uiMessage('ui.cacheFolderUpdated'))
  } catch (error) {
    $message.error(error.message || '缓存路径迁移失败')
  } finally {
    changing.value = false
  }
}
</script>
<template>
  <SettingRow :label="$t('ui.applicationCacheFolder')" stack>
    <span class="setting-path" :class="{ 'is-empty': !path }" :title="path || undefined">{{
      path || $t('ui.notSet')
    }}</span>
    <VxButton variant="secondary" size="sm" :loading="changing" @click="changePath">{{ $t('ui.change') }}</VxButton>
    <VxButton variant="ghost" size="sm" :disabled="changing" @click="openCacheFolder">
      <ToolIcon name="folder" :size="14" />
      {{ $t('ui.open') }}
    </VxButton>
    <template v-if="changing" #description>
      <span role="status" class="cache-path-progress">
        <span class="tool-inline-spinner" aria-hidden="true"></span>
        {{ $t('ui.migrating') }} {{ progress.fileCount || 0 }} {{ $t('ui.files') }} {{ progress.sizeMB || '0.00' }} MB
      </span>
    </template>
  </SettingRow>
</template>

<style scoped>
.cache-path-progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-accent-strong);
}
</style>
