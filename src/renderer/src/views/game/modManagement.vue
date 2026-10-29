<script setup>
import PageBody from '@renderer/component/page-body.vue'
import ClientConfirmDialog from '@views/game/component/modManagement/ClientConfirmDialog.vue'
import ModManagementWorkspace from '@views/game/component/modManagement/ModManagementWorkspace.vue'
import ShowInstallPath from '@views/game/component/modManagement/showInstallPath.vue'
import { provideModManagementController } from '@views/game/component/modManagement/mod-management-context.js'
import { useModManagementController } from '@views/game/component/modManagement/useModManagementController.js'
import LocalModManagerDialog from '@views/game/local-mod-manager/LocalModManagerDialog.vue'
import { useRoute } from 'vue-router'
import { VxConfirmModal } from '@renderer/component/vertex-ui'
import { useLocalSourceModManagement } from './component/modManagement/useLocalSourceModManagement.js'
import { LOCAL_MANAGEMENT_SOURCES } from './component/modManagement/adapters/local-source-adapter.js'

defineOptions({
  name: 'GameModManagement'
})

const localSource = LOCAL_MANAGEMENT_SOURCES.includes(String(useRoute().params.source))
const {
  workspaceController,
  showInstallPathRef,
  clientConfirmDialog,
  handleClientConfirm,
  handleClientCancel,
  confirmation
} = localSource ? useLocalSourceModManagement() : useModManagementController()

provideModManagementController(workspaceController)
</script>

<template>
  <div class="mod-management">
    <page-body :padding-num="18">
      <ModManagementWorkspace :confirmation="localSource ? confirmation : clientConfirmDialog" />
      <show-install-path v-if="!localSource" ref="showInstallPathRef" />
      <LocalModManagerDialog
        v-if="!localSource"
        v-model="workspaceController.localModManagerDialog"
        :context="workspaceController.localToolContext"
        @completed="workspaceController.handleToolbarAction('refresh')"
        @task-created="workspaceController.handleToolbarAction('refresh')"
      />
      <ClientConfirmDialog
        v-if="!localSource"
        :open="clientConfirmDialog.open"
        :title="clientConfirmDialog.title"
        :subtitle="clientConfirmDialog.subtitle"
        :description="clientConfirmDialog.description"
        :tone="clientConfirmDialog.tone"
        :tone-label="clientConfirmDialog.toneLabel"
        :confirm-text="clientConfirmDialog.confirmText"
        :cancel-text="clientConfirmDialog.cancelText"
        :show-cancel="clientConfirmDialog.showCancel"
        :loading="clientConfirmDialog.loading"
        :disabled="clientConfirmDialog.disabled"
        :close-on-mask="clientConfirmDialog.closeOnMask"
        :focus-action="clientConfirmDialog.focusAction"
        :details="clientConfirmDialog.details"
        :impacts="clientConfirmDialog.impacts"
        :tags="clientConfirmDialog.tags"
        :error="clientConfirmDialog.error"
        @confirm="handleClientConfirm"
        @cancel="handleClientCancel"
      />
      <VxConfirmModal
        v-if="localSource"
        v-model="confirmation.open"
        :title="confirmation.title"
        :description="confirmation.description"
        :danger="confirmation.danger"
        :confirm-action="confirmation.action"
      />
    </page-body>
  </div>
</template>

<style lang="scss" src="./component/modManagement/mod-management.scss"></style>
