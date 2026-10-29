<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { VxButton, VxConfirmModal, VxSwitch } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import CachePathSetting from './CachePathSetting.vue'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import { computed, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'
import DownloadFileManagement from '@views/settings/component/downloadFileManagement.vue'
import {
  DOWNLOAD_ENGINE_OPTIONS,
  normalizeDownloadEngine,
  MAX_DOWNLOAD_CONCURRENT_COUNT,
  normalizeDownloadConcurrentCount
} from '../../../../../shared/downloads/download-config.js'

const props = defineProps({
  // download：引擎与并发；storage：路径与缓存；packages：安装包
  section: { type: String, default: 'download' },
  modelValue: {
    type: Object,
    default: () => ({
      autoStartOnBoot: 0,
      closeWindowType: 'exitApp',
      cachePath: '',
      downloadSpeed: { type: 'noLimit', speed: 1 },
      downloadPath: '',
      downloadEngine: normalizeDownloadEngine(),
      downloadConcurrentCount: normalizeDownloadConcurrentCount(),
      preferSameDriveCache: true,
      installTaskAutoBackup: false
    })
  }
})

const downloadFileManagementRef = ref()
const clearConfirmOpen = ref(false)
const isChangingDownloadPath = ref(false)
const migrationProgress = ref(null)
const emit = defineEmits(['update:modelValue'])

// 使用 computed 计算属性，确保双向绑定
const config = computed({
  get: () => props.modelValue,
  set: (newValue) => {
    emit('update:modelValue', newValue)
  }
})

const keepInstallArchives = computed({
  get: () => config.value.installTaskAutoBackup === true,
  set: (value) => {
    config.value.installTaskAutoBackup = value === true
  }
})
const preferSameDriveCache = computed({
  get: () => config.value.preferSameDriveCache !== false,
  set: (value) => {
    config.value.preferSameDriveCache = value === true
  }
})

async function changePath() {
  if (isChangingDownloadPath.value) return
  isChangingDownloadPath.value = true
  migrationProgress.value = null
  try {
    const result = await ipcRenderer.invoke('changeDownloadPath')
    if (result?.canceled) return
    if (!result?.success) {
      $message.error(String(result?.message || '更改下载路径失败'))
      return
    }
    if (result?.cleanupWarning) {
      $message.warning(uiMessage('ui.downloadFolderUpdatedButSomeOldFilesCouldNotBe'))
    } else {
      $message.success(String(result?.message || '下载路径已更新'))
    }
  } catch (error) {
    $message.error(String(error?.message || '更改下载路径失败'))
  } finally {
    isChangingDownloadPath.value = false
    migrationProgress.value = null
  }
}

function openDownloadFolder() {
  const target = String(config.value.downloadPath || '').trim()
  if (target) ipcRenderer.send('openSpecifyPath', target)
}

function openFileManage() {
  downloadFileManagementRef.value.open()
}

async function clearInstallerBackups() {
  const result = await ipcRenderer.invoke('deleteInstallerBackupRecords')
  if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotClearCachedInstallationArchives'))
  const message = '已清理 ' + (result.deletedFileCount || 0) + ' 个安装包'
  if (result.skippedCount) $message.warning(uiMessage('ui.valueValueItemsAreProtectedOrNeedNoCleanup', { value1: (message), value2: (result.skippedCount) }))
  else $message.success(message)
}

const downloadConcurrentCountValue = computed({
  get: () => normalizeDownloadConcurrentCount(config.value.downloadConcurrentCount),
  set: (value) => {
    config.value.downloadConcurrentCount = normalizeDownloadConcurrentCount(value)
  }
})

function stepConcurrentCount(delta) {
  downloadConcurrentCountValue.value = downloadConcurrentCountValue.value + delta
}

const engineOptions = DOWNLOAD_ENGINE_OPTIONS.map((option) => ({
  ...option,
  isDefault: option.value === normalizeDownloadEngine()
}))

const downloadEngineValue = computed({
  get: () => normalizeDownloadEngine(config.value.downloadEngine),
  set: (value) => {
    config.value.downloadEngine = normalizeDownloadEngine(value)
  }
})

useIpc('thunderstore-storage-migration-progress', (payload = {}) => {
  migrationProgress.value = {
    percent: Math.max(0, Math.min(100, Number(payload?.percent || 0))),
    message: String(payload?.message || uiText('ui.movingThunderstoreFiles'))
  }
})
</script>

<template>
  <div class="download-setting">
    <template v-if="section === 'download'">
      <SettingGroup :title="$t('ui.downloadEngine')">
        <div class="engine-options" role="radiogroup" :aria-label="$t('ui.downloadEngine')">
          <label v-for="option in engineOptions" :key="option.value" class="engine-option">
            <input
              v-model="downloadEngineValue"
              type="radio"
              name="download-engine"
              :value="option.value"
            />
            <span class="engine-option__radio" aria-hidden="true"></span>
            <span class="engine-option__label">{{ option.label }}</span>
            <span v-if="option.isDefault" class="tool-tag">{{ $t('ui.default') }}</span>
          </label>
        </div>
      </SettingGroup>
      <SettingGroup :title="$t('taskCenter.table.task')">
        <SettingRow
          :label="$t('ui.concurrentDownloads')"
          :description="$t('ui.1ValueTasks', { value1: (MAX_DOWNLOAD_CONCURRENT_COUNT) })"
        >
          <div class="stepper" role="group" :aria-label="$t('ui.concurrentDownloads')">
            <button
              type="button"
              :aria-label="$t('ui.decrease')"
              :disabled="downloadConcurrentCountValue <= 1"
              @click="stepConcurrentCount(-1)"
            >
              −
            </button>
            <output class="stepper__value" aria-live="polite">{{
              downloadConcurrentCountValue
            }}</output>
            <button
              type="button"
              :aria-label="$t('ui.increase')"
              :disabled="downloadConcurrentCountValue >= MAX_DOWNLOAD_CONCURRENT_COUNT"
              @click="stepConcurrentCount(1)"
            >
              +
            </button>
          </div>
        </SettingRow>
      </SettingGroup>
    </template>

    <template v-else-if="section === 'storage'">
      <SettingGroup :title="$t('ui.downloadFolder')">
        <SettingRow
          :label="$t('ui.downloadFolder')"
          :description="$t('ui.thunderstoreDownloadsProfilesAndImportedModpacksAreStoredHereExisting')"
          stack
        >
          <span
            class="setting-path"
            :class="{ 'is-empty': !config.downloadPath }"
            :title="config.downloadPath || undefined"
            >{{ config.downloadPath || $t('ui.notSet') }}</span
          >
          <VxButton
            variant="secondary"
            size="sm"
            :loading="isChangingDownloadPath"
            @click="changePath"
          >
            {{ isChangingDownloadPath ? $t('ui.migratingVariant2') : $t('ui.change') }}
          </VxButton>
          <VxButton
            variant="ghost"
            size="sm"
            :disabled="!config.downloadPath || isChangingDownloadPath"
            @click="openDownloadFolder"
          >
            <ToolIcon name="folder" :size="14" />
            {{ $t('ui.open') }}
          </VxButton>
        </SettingRow>
        <div v-if="migrationProgress" class="migration-progress" role="status">
          <div class="migration-progress__text">
            <span class="tool-inline-spinner" aria-hidden="true"></span>
            {{ migrationProgress.message }}
            <span class="migration-progress__percent">{{ migrationProgress.percent }}%</span>
          </div>
          <div
            class="migration-progress__bar"
            role="progressbar"
            :aria-label="$t('ui.migrationProgress')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="migrationProgress.percent"
          >
            <span :style="{ width: `${migrationProgress.percent}%` }"></span>
          </div>
        </div>
        <SettingRow :label="$t('ui.fileManagement')" :description="$t('ui.reviewDownloadedFilesAndBackupsAndFreeUpUnusedDisk')">
          <VxButton variant="secondary" size="sm" @click="openFileManage">{{ $t('ui.openFileManagement') }}</VxButton>
        </SettingRow>
      </SettingGroup>
      <SettingGroup :title="$t('ui.applicationCache')">
        <CachePathSetting :path="config.cachePath" />
        <SettingRow
          :label="$t('ui.preferTheGameDriveForTheDownloadCache')"
          :description="$t('ui.storeTheDownloadCacheOnTheSameDriveAsThe')"
        >
          <VxSwitch
            v-model="preferSameDriveCache"
            class="setting-switch"
            :label="$t('ui.preferTheGameDriveForDownloadCaching')"
          />
        </SettingRow>
      </SettingGroup>
      <downloadFileManagement ref="downloadFileManagementRef" :cache-path="config.downloadPath" />
    </template>

    <template v-else>
      <SettingGroup :title="$t('settings.sections.packages')">
        <SettingRow
          :label="$t('ui.keepArchivesAfterInstallation')"
          :description="$t('ui.keepDownloadedArchivesForReinstallationThisSettingDoesNotAffect')"
        >
          <VxSwitch v-model="keepInstallArchives" class="setting-switch" :label="$t('ui.keepArchivesAfterInstallation')" />
        </SettingRow>
        <SettingRow
          :label="$t('ui.clearCachedArchives')"
          :description="$t('ui.deleteRetainedInstallationArchivesInstalledModsAndRollbackDataAre')"
        >
          <VxButton
            variant="secondary"
            size="sm"
            class="setting-danger-button"
            @click="clearConfirmOpen = true"
            >{{ $t('ui.cleanUp') }}</VxButton
          >
        </SettingRow>
      </SettingGroup>
      <VxConfirmModal
        v-model="clearConfirmOpen"
        :title="$t('ui.clearCachedArchives')"
        :confirm-text="$t('tools.cleanUp')"
        danger
        :description="$t('ui.deleteCachedInstallationArchivesInstalledModsAndRollbackDataAre')"
        :confirm-action="clearInstallerBackups"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.download-setting > * + * {
  margin-top: 28px;
}

.engine-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 14px var(--space-5);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  cursor: pointer;

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  &:first-child {
    border-radius: 10px 10px 0 0;
  }

  &:last-child {
    border-radius: 0 0 10px 10px;
  }

  &:hover {
    background: var(--color-surface-soft);
  }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
}

.engine-option__radio {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--choice-size);
  height: var(--choice-size);
  border: 1.5px solid var(--color-text-subtle);
  border-radius: 50%;
  box-sizing: border-box;

  input:checked + & {
    border-color: var(--color-accent);

    &::after {
      width: 8px;
      height: 8px;
      background: var(--color-accent);
      border-radius: 50%;
      content: '';
    }
  }

  input:focus-visible + & {
    box-shadow: var(--focus-ring);
  }
}

.stepper {
  display: inline-flex;
  align-items: stretch;
  height: 34px;
  overflow: hidden;
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-sizing: border-box;

  button {
    width: 34px;
    padding: 0;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 16px;
    background: transparent;
    border: 0;
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--color-text);
      background: var(--color-surface-hover);
    }

    &:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: -2px;
    }

    &:disabled {
      color: var(--color-text-subtle);
      cursor: not-allowed;
    }
  }
}

.stepper__value {
  min-width: 44px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 32px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  border-right: 1px solid var(--color-surface-strong);
  border-left: 1px solid var(--color-surface-strong);
}

.migration-progress + .setting-row {
  border-top: 1px solid var(--color-surface-strong);
}

.migration-progress {
  display: grid;
  gap: var(--space-2);
  margin: 0 var(--space-5) var(--space-4);
}

.migration-progress__text {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-accent-strong);
  font-size: 12.5px;
}

.migration-progress__percent {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.migration-progress__bar {
  height: 6px;
  overflow: hidden;
  background: var(--color-surface-strong);
  border-radius: 3px;

  span {
    display: block;
    height: 100%;
    background: var(--color-accent);
    border-radius: 3px;
    transition: width var(--duration-base) var(--ease-standard);
  }
}
</style>
