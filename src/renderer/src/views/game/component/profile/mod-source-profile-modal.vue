<script setup>
// "配置方案"弹窗容器
import { nextTick } from 'vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import ModSourceProfilePanel from './mod-source-profile-panel.vue'

defineProps({
  showTransferActions: { type: Boolean, default: true },
  open: {
    type: Boolean,
    default: false
  },
  activeProfileName: {
    type: String,
    default: ''
  },
  profileOptions: {
    type: Array,
    default: () => []
  },
  profileModCount: {
    type: Number,
    default: 0
  },
  profileSwitching: {
    type: Boolean,
    default: false
  },
  profileOperationLocked: {
    type: Boolean,
    default: false
  },
  sharingProfile: {
    type: Boolean,
    default: false
  },
  importingProfile: {
    type: Boolean,
    default: false
  },
  batchInstallingFromProfile: {
    type: Boolean,
    default: false
  },
  showNamespaceHint: {
    type: Boolean,
    default: false
  },
  extraActions: {
    type: Array,
    default: () => []
  },
  createProfileLoading: {
    type: Boolean,
    default: false
  },
  profileNameMaxLength: {
    type: Number,
    default: 32
  }
})

const emit = defineEmits([
  'close',
  'switch-profile',
  'rename-profile',
  'delete-profile',
  'create-profile',
  'confirm-create-profile',
  'share-profile',
  'update-profile',
  'import-profile',
  'export-file',
  'import-file',
  'extra-action'
])

function handleVisibleChange(visible) {
  if (!visible) {
    emit('close')
  }
}

async function handleImportProfile() {
  emit('close')
  await nextTick()
  emit('import-profile')
}

async function handleUpdateProfile() {
  emit('close')
  await nextTick()
  emit('update-profile')
}
</script>

<template>
  <VxModal
    :model-value="open"
    :width="920"
    :show-close="false"
    plain
    :aria-label="$t('modBrowser.profiles')"
    @update:model-value="handleVisibleChange"
  >
    <mod-source-profile-panel
      :active-profile-name="activeProfileName"
      :profile-options="profileOptions"
      :profile-mod-count="profileModCount"
      :profile-switching="profileSwitching"
      :profile-operation-locked="profileOperationLocked"
      :sharing-profile="sharingProfile"
      :importing-profile="importingProfile"
      :batch-installing-from-profile="batchInstallingFromProfile"
      :show-namespace-hint="showNamespaceHint"
      :extra-actions="extraActions"
      :create-profile-loading="createProfileLoading"
      :profile-name-max-length="profileNameMaxLength"
      :show-transfer-actions="showTransferActions"
      @close="emit('close')"
      @switch-profile="(value) => emit('switch-profile', value)"
      @rename-profile="(value) => emit('rename-profile', value)"
      @delete-profile="(value) => emit('delete-profile', value)"
      @create-profile="emit('create-profile')"
      @confirm-create-profile="(name) => emit('confirm-create-profile', name)"
      @share-profile="emit('share-profile')"
      @update-profile="handleUpdateProfile"
      @import-profile="handleImportProfile"
      @export-file="emit('export-file')"
      @import-file="emit('import-file')"
      @extra-action="(key) => emit('extra-action', key)"
    />
  </VxModal>
</template>
