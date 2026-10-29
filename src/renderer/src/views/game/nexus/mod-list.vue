<script setup>
import NexusBrowseResults from './NexusBrowseResults.vue'
import PageBody from '@renderer/component/page-body.vue'
import UnifiedModHeader from '@views/game/component/unifiedModList/UnifiedModHeader.vue'
import UserLogin from '@renderer/component/auth/user-login.vue'
import SourceModpackShareCodeModal from '@renderer/views/game/component/source-modpack-share-code-modal.vue'
import SourceModpackUpdateModal from '@renderer/views/game/sourceModpack/component/SourceModpackUpdateModal.vue'
import NexusInstallFileDialog from './nexus-install-file-dialog.vue'
import ModSourceProfileModal from '@renderer/views/game/component/profile/mod-source-profile-modal.vue'
import ModSourceCreateProfileModal from '@renderer/views/game/component/profile/mod-source-create-profile-modal.vue'
import ProfileSwitchProgressDialog from '@renderer/views/game/component/profile/profile-switch-progress-dialog.vue'
import { useNexusPageController } from './useNexusPageController.js'

const {
  dlssContext,
  userLoginRef,
  gameBaseInfo,
  gameDisplayName,
  headerTags,
  headerStats,
  canGenerateRulePrompt,
  nexusConfigGameContext,
  detectStatusText,
  detectStatusType,
  detectStatusSubText,
  headerActions,
  handleHeaderAction,
  profileConfigModal,
  nexusProfileState,
  installedNexusMods,
  profileSwitching,
  sharingProfile,
  importingProfile,
  createProfileModal,
  closeProfileSchemeModal,
  handleProfileSwitch,
  handleProfileRename,
  handleProfileDelete,
  openCreateProfileModal,
  handleInlineCreateProfile,
  shareNexusSourceModpack,
  updateNexusSourceModpack,
  openSourceModpackImportModal,
  handleExportToFile,
  handleImportFromFile,
  closeCreateProfileModal,
  confirmCreateProfileModal,
  keywordInput,
  loading,
  hasNexusApiKey,
  listType,
  typeOptions,
  listNotice,
  listItems,
  nexusModFloatingActions,
  query,
  pages,
  total,
  pageMods,
  handleSearch,
  toSettings,
  handleOpenModDetail,
  handleSecondaryAction,
  handleCardAction,
  handleTranslateSingleMod,
  handleFloatingAction,
  handlePrimaryAction,
  changePage,
  nexusFileModal,
  nexusFileLoadErrorText,
  getTranslatedModTitle,
  nexusFileGroups,
  visibleNexusFiles,
  canInstallByRule,
  installSubmitting,
  showAiOriginalText,
  canUseNexusAiTranslation,
  nexusFileTranslationLoading,
  untranslatedNexusFileCount,
  closeNexusFileModal,
  handleNexusFileAction,
  handleTranslateNexusFiles,
  sourceModpackImportModal,
  confirmNexusSourceModpackImport,
  closeSourceModpackImportModal,
  sourceModpackUpdateModal,
  profileSwitchProgress,
  handleConfigLoginSuccess
} = useNexusPageController()
defineOptions({ name: 'GameNexusModList' })
</script>

<template>
  <div class="nexus-mod-list-page">
    <page-body>
      <div class="max_width">
        <unified-mod-header
          :rule-ai-context="nexusConfigGameContext"
          :rule-ai-missing="canGenerateRulePrompt"
          rule-ai-editor-action="rule-config"
          :dlss-context="dlssContext"
          :cover-image="gameBaseInfo.coverImage"
          :title="gameDisplayName"
          :subtitle="gameBaseInfo.domainName || $t('ui.nexusGame')"
          :tags="headerTags"
          :stats="headerStats"
          :status-text="detectStatusText"
          :status-type="detectStatusType"
          :status-sub-text="detectStatusSubText"
          :actions="headerActions"
          @action="handleHeaderAction"
          @rule-saved="handleHeaderAction('rule-imported')"
        />

        <mod-source-profile-modal
          :open="profileConfigModal.open"
          :active-profile-name="nexusProfileState.activeProfileName.value"
          :profile-options="nexusProfileState.profileOptions.value"
          :profile-mod-count="installedNexusMods.length"
          :profile-switching="profileSwitching"
          :profile-operation-locked="false"
          :sharing-profile="sharingProfile"
          :importing-profile="importingProfile"
          :show-namespace-hint="false"
          :create-profile-loading="createProfileModal.confirmLoading"
          :profile-name-max-length="nexusProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeProfileSchemeModal"
          @switch-profile="handleProfileSwitch"
          @rename-profile="handleProfileRename"
          @delete-profile="handleProfileDelete"
          @create-profile="openCreateProfileModal"
          @confirm-create-profile="handleInlineCreateProfile"
          @share-profile="shareNexusSourceModpack"
          @update-profile="updateNexusSourceModpack"
          @import-profile="openSourceModpackImportModal"
          @export-file="handleExportToFile"
          @import-file="handleImportFromFile"
        />

        <mod-source-create-profile-modal
          :open="createProfileModal.open"
          :confirm-loading="createProfileModal.confirmLoading"
          :name="createProfileModal.name"
          :max-length="nexusProfileState.PROFILE_NAME_MAX_LENGTH"
          @close="closeCreateProfileModal"
          @confirm="confirmCreateProfileModal"
          @update:name="(value) => (createProfileModal.name = value)"
        />

        <NexusBrowseResults
          :keyword-input="keywordInput"
          :loading="loading"
          :has-nexus-api-key="hasNexusApiKey"
          :list-type="listType"
          :type-options="typeOptions"
          :list-notice="listNotice"
          :list-items="listItems"
          :nexus-mod-floating-actions="nexusModFloatingActions"
          :query="query"
          :pages="pages"
          :total="total"
          :page-mods="pageMods"
          @update:keyword="(value) => (keywordInput = value)"
          @update:filter-value="(value) => (listType = value)"
          @search="handleSearch"
          @notice-action="toSettings"
          @open-detail="handleOpenModDetail"
          @secondary-action="handleSecondaryAction"
          @item-action="handleCardAction"
          @translate-item="handleTranslateSingleMod"
          @floating-action="handleFloatingAction"
          @install="handlePrimaryAction"
          @page-change="changePage"
        />

        <nexus-install-file-dialog
          :open="nexusFileModal.open"
          :loading="nexusFileModal.loading"
          :error-text="nexusFileLoadErrorText"
          :mod-name="nexusFileModal.item?.name || '--'"
          :translated-mod-name="
            getTranslatedModTitle(
              nexusFileModal.item?.modId || nexusFileModal.item?.id,
              nexusFileModal.item?.name || ''
            )
          "
          :game-name="gameDisplayName"
          :mod-id="nexusFileModal.item?.modId || '--'"
          :groups="nexusFileGroups"
          :files="visibleNexusFiles"
          :target-file-id="nexusFileModal.targetFileId"
          :dependency-summary="nexusFileModal.requirementSummary"
          :can-install-by-rule="canInstallByRule"
          :install-submitting="installSubmitting"
          :show-original-text="showAiOriginalText"
          :show-translate-button="canUseNexusAiTranslation"
          :translate-loading="nexusFileTranslationLoading"
          :translate-disabled="untranslatedNexusFileCount <= 0"
          :translate-button-text="
            untranslatedNexusFileCount > 0 ? $t('ui.translateCurrentFileList') : $t('ui.fileListTranslated')
          "
          @close="closeNexusFileModal"
          @action="handleNexusFileAction"
          @translate-list="handleTranslateNexusFiles"
        />

        <source-modpack-share-code-modal
          :open="sourceModpackImportModal.open"
          :code="sourceModpackImportModal.code"
          :loading="sourceModpackImportModal.loading"
          :title="$t('ui.importANexusShareCode')"
          :hint="$t('ui.createInstallationTasksForTheNexusModFilesInThis')"
          @update:code="(value) => (sourceModpackImportModal.code = value)"
          @confirm="confirmNexusSourceModpackImport"
          @cancel="closeSourceModpackImportModal"
        />

        <SourceModpackUpdateModal
          v-model="sourceModpackUpdateModal.open"
          :snapshot="sourceModpackUpdateModal.snapshot"
        />

        <profile-switch-progress-dialog
          :progress="profileSwitchProgress"
          @close="profileSwitchProgress.open = false"
        />

        <user-login ref="userLoginRef" @login-success="handleConfigLoginSuccess" />
      </div>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.max_width {
  min-width: 0;
  width: 100%;
  margin: 0;
}

.nexus-mod-list-page {
  width: 100%;
  height: 100%;
}









.nexus-manual-import-tip {
  align-items: center;
}

.nexus-manual-import-tip__content {
  flex: 1;
  min-width: 0;
}

.nexus-manual-import-tip__actions {
  display: flex;
  align-items: center;
  gap: 8px;

  button {
    min-height: 30px;
    padding: 0 12px;
    border: 1px solid rgba(37, 99, 235, 0.22);
    border-radius: 8px;
    background: #ffffff;
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;

    &.is-danger {
      border-color: rgba(220, 38, 38, 0.22);
      color: #dc2626;
    }
  }
}



.install-progress {
  margin-top: 14px;
  padding: 12px 12px 10px;
  border-radius: 10px;
  border: 1px solid #c7d2fe;
  background: #f8faff;
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.08);

  &.is-warning {
    border-color: #f8d38d;
    background: linear-gradient(180deg, #fffdf5 0%, #fff7db 100%);
    box-shadow: 0 10px 24px rgba(234, 179, 8, 0.12);

    .progress-head,
    .progress-meta {
      color: #92400e;
    }

    .progress-package-name,
    .progress-close-button {
      color: #a16207;
    }

    .progress-close-button {
      border-color: rgba(234, 179, 8, 0.28);
      background: rgba(255, 255, 255, 0.72);
    }

    .progress-close-button:hover {
      border-color: rgba(202, 138, 4, 0.45);
      background: #fff7cc;
      color: #854d0e;
    }
  }

  &.is-success {
    border-color: #b9e6c6;
    background: linear-gradient(180deg, #f7fef9 0%, #edfdf1 100%);
    box-shadow: 0 10px 22px rgba(22, 163, 74, 0.08);

    .progress-head,
    .progress-meta {
      color: #166534;
    }

    .progress-package-name,
    .progress-close-button {
      color: #15803d;
    }

    .progress-close-button:hover {
      border-color: rgba(22, 163, 74, 0.24);
      background: #eefcf1;
      color: #166534;
    }
  }

  .progress-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: #1e293b;
    font-size: 13px;
    gap: 10px;
  }

  .progress-head-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .progress-package-name {
    min-width: 0;
    color: #475569;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress-close-button {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.78);
    color: #64748b;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.2s ease,
      border-color 0.2s ease,
      background-color 0.2s ease,
      transform 0.2s ease;
  }

  .progress-close-button:hover {
    border-color: rgba(37, 99, 235, 0.22);
    background: #eff6ff;
    color: #1d4ed8;
  }

  .progress-close-button:active {
    transform: translateY(1px);
  }

  .progress-meta {
    margin-top: 8px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    color: #475569;
    font-size: 12px;
  }
}
</style>
