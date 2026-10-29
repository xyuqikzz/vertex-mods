<script setup>
import { uiMessage } from '../../../i18n/message.js'

import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { $message } from '@renderer/common/message.js'
import VxBadge from '@renderer/component/vertex-ui/VxBadge.vue'
import VxButton from '@renderer/component/vertex-ui/VxButton.vue'
import VxDialogActions from '@renderer/component/vertex-ui/VxDialogActions.vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import { listLocalModLibrary } from '@views/game/local-mod-import/local-mod-import-service.js'
import {
  createOfflinePack,
  estimateVxpackExportSize,
  openVxpackExportFolder
} from './vxpack-service.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  context: { type: Object, default: () => ({}) },
  payload: { type: Object, default: () => ({}) },
  items: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'exported'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const loading = ref(false)
const exporting = ref(false)
const opening = ref(false)
const libraryItems = ref([])
const selectedIds = ref([])
const itemSourceMode = ref('library')
const estimate = ref({ modCount: 0, sizeBytes: 0 })
const lastPackagePath = ref('')
const includeDependencies = ref(true)
const conflictPolicy = ref('backup')
const openFolderAfterExport = ref(true)

const selectedItems = computed(() =>
  libraryItems.value.filter((item) => selectedIds.value.includes(getItemKey(item)))
)
const selectedExportItems = computed(() => {
  if (!includeDependencies.value) {
    return selectedItems.value.filter((item) => !isDependencyItem(item))
  }
  // 包含依赖时自动补齐所有默认依赖，保证「分享什么就能完整安装什么」，
  // 即使用户单独取消勾选了某个依赖条目也不会漏装。
  const result = [...selectedItems.value]
  const seen = new Set(result.map((item) => getItemKey(item)))
  for (const item of libraryItems.value) {
    const key = getItemKey(item)
    if (isDependencyItem(item) && key && !seen.has(key)) {
      result.push(item)
      seen.add(key)
    }
  }
  return result
})
const selectedCount = computed(() => selectedExportItems.value.length)
const allSelected = computed(
  () => libraryItems.value.length > 0 && selectedIds.value.length === libraryItems.value.length
)
const skippedDependencyCount = computed(() =>
  includeDependencies.value
    ? 0
    : selectedItems.value.filter((item) => isDependencyItem(item)).length
)
const directInstallCount = computed(
  () => selectedExportItems.value.filter((item) => getItemStatus(item).type === 'ready').length
)
const manualCount = computed(() => Math.max(selectedExportItems.value.length - directInstallCount.value, 0))
const canExport = computed(() => selectedCount.value > 0 && directInstallCount.value > 0 && !exporting.value)
const exportBlockedReason = computed(() =>
  selectedCount.value > 0 && directInstallCount.value === 0
    ? '至少需要选择 1 个可直接安装条目，缺少文件或安装规则的条目只会记录为手动处理。'
    : ''
)

watch(visible, (open) => {
  if (open) {
    loadLibrary()
    return
  }
  resetState()
})

watch(selectedIds, () => {
  refreshEstimate()
})

watch([includeDependencies, conflictPolicy], () => {
  refreshEstimate()
})

watch(
  () => [props.items, props.payload],
  () => {
    if (visible.value) {
      loadLibrary()
    }
  },
  { deep: true }
)

function resetState() {
  loading.value = false
  exporting.value = false
  opening.value = false
  libraryItems.value = []
  selectedIds.value = []
  itemSourceMode.value = 'library'
  estimate.value = { modCount: 0, sizeBytes: 0 }
  lastPackagePath.value = ''
  includeDependencies.value = true
  conflictPolicy.value = 'backup'
  openFolderAfterExport.value = true
}

function closeDialog() {
  if (loading.value || exporting.value) return
  visible.value = false
}

function formatBytes(value = 0) {
  const size = Number(value) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function buildPayload(extra = {}) {
  return {
    ...(props.payload || {}),
    gameId: props.context?.gameId || props.payload?.gameId,
    gameName: props.context?.gameName || props.payload?.gameName,
    sourcePlatform: props.context?.sourcePlatform || props.payload?.sourcePlatform,
    profileName: props.context?.profileName || props.payload?.profileName,
    includeDependencies: includeDependencies.value,
    conflictPolicy: conflictPolicy.value,
    ...extra
  }
}

function getItemKey(item = {}) {
  return String(item.exportKey || item.exportId || item.id || item.libraryItemId || '')
}

function normalizeExternalItem(item = {}, index = 0) {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw : {}
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  const installRulePlan =
    metadata.installRulePlan && typeof metadata.installRulePlan === 'object' ? metadata.installRulePlan : {}
  const exportKey = String(item.exportKey || item.exportId || item.key || item.id || index + 1)
  const archivePath =
    item.archivePath ||
    item.archive_path ||
    raw.archivePath ||
    raw.archive_path ||
    metadata.archivePath ||
    metadata.archive_path ||
    item.archivedSourcePath ||
    item.archived_source_path ||
    metadata.archivedSourcePath ||
    metadata.archived_source_path ||
    ''
  const stagingPath =
    item.stagingPath ||
    item.staging_path ||
    raw.stagingPath ||
    raw.staging_path ||
    metadata.stagingPath ||
    metadata.staging_path ||
    installRulePlan.sourceRoot ||
    installRulePlan.source_root ||
    installRulePlan.lifecycleStagingRoot ||
    installRulePlan.lifecycle_staging_root ||
    ''
  const sourcePath =
    archivePath ||
    stagingPath ||
    item.sourcePath ||
    item.source_path ||
    raw.sourcePath ||
    raw.source_path ||
    metadata.sourcePath ||
    metadata.source_path ||
    metadata.sourceRoot ||
    metadata.source_root ||
    item.filePath ||
    item.file_path ||
    raw.filePath ||
    raw.file_path ||
    metadata.filePath ||
    metadata.file_path ||
    ''
  return {
    ...item,
    exportKey,
    exportId: item.exportId || exportKey,
    displayName:
      item.displayName ||
      item.display_name ||
      item.title ||
      item.name ||
      raw.displayName ||
      raw.name ||
      'Mod',
    fileName: item.fileName || item.file_name || raw.fileName || raw.optionName || '',
    sourcePlatform: item.sourcePlatform || item.source || raw.sourceType || props.context?.sourcePlatform || 'local',
    sourceLabel: item.sourceLabel || item.sourcePlatform || item.source || props.context?.sourcePlatform || '本地',
    sourcePath,
    archivePath,
    stagingPath,
    archivedSourcePath: item.archivedSourcePath || item.archived_source_path || metadata.archivedSourcePath || '',
    sizeBytes: item.sizeBytes || raw.fileSize || raw.file_size || metadata.sizeBytes || metadata.fileSize || 0,
    role: item.role || metadata.role || '',
    cover: item.cover || metadata.cover || raw.cover || raw.pictureUrl || '',
    summary: item.summary || item.description || metadata.summary || metadata.description || '',
    author: item.author || metadata.author || metadata.uploader || raw.author || '',
    isDefaultDependency:
      item.isDefaultDependency === true ||
      String(item.role || metadata.role || '').trim() === 'default_dependency' ||
      String(item.sourceModKey || metadata.sourceModKey || '')
        .trim()
        .startsWith('dependency:'),
    dependentCount: Number(item.dependentCount ?? item.dependent_count ?? 0) || 0,
    dependencies: Array.isArray(item.dependencies)
      ? item.dependencies
      : Array.isArray(item.dependencies_json)
        ? item.dependencies_json
        : [],
    installRule: item.installRule || item.sourceInstallRule || metadata.installRule || metadata.sourceInstallRule || null,
    metadata: {
      ...metadata,
      ...(item.metadata || {}),
      sourceModKey: item.sourceModKey || raw.sourceModKey || raw.source_mod_key || ''
    }
  }
}

function normalizeLibraryItem(item = {}, index = 0) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  return {
    ...item,
    exportKey: String(item.id || `library-${index + 1}`),
    libraryItemId: item.id,
    displayName: item.display_name || item.displayName || item.file_name || '本地资产',
    fileName: item.file_name || item.fileName || '',
    sourcePlatform: item.source_platform || item.sourcePlatform || 'local',
    sourceLabel: '本地资产库',
    sourcePath: metadata.sourceRoot || item.library_root_path || '',
    sizeBytes: metadata.sizeBytes || item.size_bytes || 0,
    metadata
  }
}

function normalizeIdentityValue(value) {
  return String(value || '').trim()
}

function pickIdentityValue(item = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeIdentityValue(item?.[key])
    if (value) return value
  }
  return ''
}

function hasSameIdentityValue(exportItem = {}, profileItem = {}, keys = []) {
  const exportValue = pickIdentityValue(exportItem, keys)
  return !!exportValue && exportValue === pickIdentityValue(profileItem, keys)
}

function isSameProfileItem(exportItem = {}, profileItem = {}) {
  if (hasSameIdentityValue(exportItem, profileItem, ['sourceModKey', 'source_mod_key'])) {
    return true
  }
  if (hasSameIdentityValue(exportItem, profileItem, ['exportId', 'export_id'])) {
    return true
  }

  const exportModId = pickIdentityValue(exportItem, ['sourceModId', 'source_mod_id'])
  const exportFileId = pickIdentityValue(exportItem, ['sourceFileId', 'source_file_id'])
  const profileModId = pickIdentityValue(profileItem, ['sourceModId', 'source_mod_id'])
  const profileFileId = pickIdentityValue(profileItem, ['sourceFileId', 'source_file_id'])
  if (exportModId && exportFileId && exportModId === profileModId && exportFileId === profileFileId) {
    return true
  }

  return hasSameIdentityValue(exportItem, profileItem, ['fileName', 'file_name', 'name'])
}

function buildSelectedPayload() {
  if (itemSourceMode.value === 'library') {
    return {
      libraryItemIds: selectedExportItems.value.map((item) => item.libraryItemId || item.id).filter(Boolean)
    }
  }

  const exportItems = selectedExportItems.value.map((item) => ({
    exportId: item.exportId,
    name: item.name || item.displayName,
    displayName: item.displayName,
    fileName: item.fileName,
    version: item.version,
    author: item.author,
    cover: item.cover || item.metadata?.cover || '',
    summary: item.summary || item.metadata?.summary || item.metadata?.description || '',
    isDefaultDependency: item.isDefaultDependency === true,
    dependentCount: Number(item.dependentCount || 0) || 0,
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
    sourcePlatform: item.sourcePlatform,
    sourceModKey: item.sourceModKey || item.metadata?.sourceModKey || '',
    sourceModId: item.sourceModId || item.metadata?.sourceModId || '',
    sourceFileId: item.sourceFileId || item.metadata?.sourceFileId || '',
    sourceGameId: item.sourceGameId || item.metadata?.sourceGameId || '',
    sourceGameSlug: item.sourceGameSlug || item.metadata?.sourceGameSlug || '',
    sourcePath: item.sourcePath,
    archivePath: item.archivePath || item.metadata?.archivePath || '',
    archivedSourcePath: item.archivedSourcePath || item.metadata?.archivedSourcePath || '',
    stagingPath: item.stagingPath || item.metadata?.stagingPath || '',
    filePath: item.filePath || item.sourcePath,
    fingerprint: item.fingerprint,
    modType: item.modType,
    role: item.role || item.metadata?.role || '',
    sizeBytes: item.sizeBytes,
    installRule:
      item.installRule || item.metadata?.installRule || item.metadata?.sourceInstallRule || null,
    sourceInstallRule:
      item.sourceInstallRule || item.installRule || item.metadata?.sourceInstallRule || null,
    installPayload: item.installPayload || item.metadata?.installPayload || null,
    metadata: item.metadata || {}
  }))
  const baseProfilePayload = props.payload?.profilePayload || props.payload?.profile_payload
  const profilePayload = baseProfilePayload
    ? {
        ...baseProfilePayload,
        checksum: null,
        signature: null,
        items: Array.isArray(baseProfilePayload.items)
          ? baseProfilePayload.items.filter((item) =>
              exportItems.some((exportItem) => isSameProfileItem(exportItem, item))
            )
          : baseProfilePayload.items
      }
    : null

  return {
    exportItems,
    profilePayload
  }
}

async function loadLibrary() {
  if (loading.value) return
  loading.value = true
  try {
    const payloadItems = Array.isArray(props.payload?.exportItems || props.payload?.export_items)
      ? (props.payload.exportItems || props.payload.export_items)
      : []
    const externalItems = Array.isArray(props.items) && props.items.length ? props.items : payloadItems
    if (externalItems.length) {
      itemSourceMode.value = 'context'
      libraryItems.value = externalItems.map((item, index) => normalizeExternalItem(item, index))
      selectedIds.value = libraryItems.value.map((item) => getItemKey(item)).filter(Boolean)
      return
    }

    itemSourceMode.value = 'library'
    const result = await listLocalModLibrary(buildPayload({ state: 'active' }))
    if (!result?.success) {
      $message.error(result?.message || '读取本地资产库失败')
      return
    }
    libraryItems.value = (Array.isArray(result.data) ? result.data : []).map((item, index) =>
      normalizeLibraryItem(item, index)
    )
    selectedIds.value = libraryItems.value.map((item) => getItemKey(item)).filter(Boolean)
  } catch (error) {
    console.error('读取本地资产库失败', error)
    $message.error(String(error?.message || '读取本地资产库失败'))
  } finally {
    loading.value = false
  }
}

async function refreshEstimate() {
  if (!selectedIds.value.length) {
    estimate.value = { modCount: 0, sizeBytes: 0 }
    return
  }
  try {
    const result = await estimateVxpackExportSize(buildPayload(buildSelectedPayload()))
    if (result?.success) {
      estimate.value = result.data || { modCount: 0, sizeBytes: 0 }
    }
  } catch (error) {
    console.error('估算离线安装包大小失败', error)
  }
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : libraryItems.value.map((item) => getItemKey(item))
}

function toggleItem(id) {
  const key = String(id || '')
  selectedIds.value = selectedIds.value.includes(key)
    ? selectedIds.value.filter((item) => item !== key)
    : [...selectedIds.value, key]
}

function isDependencyItem(item = {}) {
  if (item.isDefaultDependency === true) return true
  const role = String(item.role || item.metadata?.role || item.metadata?.dependencyRole || item.metadata?.category || '')
    .trim()
    .toLowerCase()
  if (role.includes('dependency')) return true
  return String(item.sourceModKey || item.metadata?.sourceModKey || '')
    .trim()
    .startsWith('dependency:')
}

function hasInstallRule(item = {}) {
  const rule = item.installRule || item.sourceInstallRule || item.metadata?.installRule || item.metadata?.sourceInstallRule
  return !!rule && typeof rule === 'object' && !Array.isArray(rule) && Object.keys(rule).length > 0
}

function getItemStatus(item = {}) {
  if (!String(item.sourcePath || '').trim()) {
    return { get text() { return uiText('ui.missingFiles') }, tone: 'danger', type: 'missing-file' }
  }
  if (!hasInstallRule(item)) {
    return { get text() { return uiText('ui.recordConfigurationOnly') }, tone: 'warning', type: 'profile-only' }
  }
  return { get text() { return uiText('ui.readyToInstall') }, tone: 'success', type: 'ready' }
}

async function exportPackage() {
  if (!canExport.value) return
  exporting.value = true
  try {
    const result = await createOfflinePack(buildPayload(buildSelectedPayload()))
    if (!result?.success) {
      if (!result?.canceled) {
        $message.error(result?.message || '导出离线安装包失败')
      }
      return
    }
    lastPackagePath.value = result.data?.packagePath || ''
    const sourceWarnings = Array.isArray(result.data?.sourceWarnings)
      ? result.data.sourceWarnings
      : []
    $message.success(result.message || '离线安装包已导出')
    if (sourceWarnings.length > 0) {
      $message.warning(uiMessage('ui.originalArchivesWereMissingForValueItemsStagingFoldersWere', { value1: (sourceWarnings.length) }))
    }
    if (openFolderAfterExport.value && lastPackagePath.value) {
      await openExportFolder({ packagePath: lastPackagePath.value, showSuccess: false })
    }
    emit('exported', result.data)
    visible.value = false
  } catch (error) {
    console.error('导出离线安装包失败', error)
    $message.error(String(error?.message || '导出离线安装包失败'))
  } finally {
    exporting.value = false
  }
}

async function openExportFolder(options = {}) {
  const packagePath = String(options.packagePath || lastPackagePath.value || '').trim()
  if (!packagePath || opening.value) return
  opening.value = true
  try {
    const result = await openVxpackExportFolder({ packagePath })
    if (!result?.success) {
      $message.error(result?.message || '打开导出目录失败')
      return
    }
    if (options.showSuccess !== false) {
      $message.success(result.message || '已打开导出目录')
    }
  } catch (error) {
    console.error('打开导出目录失败', error)
    $message.error(String(error?.message || '打开导出目录失败'))
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <VxModal
    v-model="visible"
    :title="$t('ui.offlinePackageExport')"
    :description="$t('ui.bundleTheProfileInstallationRulesAndOfflineFilesIntoOne')"
    :width="720"
    :close-on-overlay="false"
    @close="closeDialog"
  >
    <div class="vxpack-export">
      <section class="vxpack-export__summary">
        <div>
          <h4>{{ props.context?.gameName || props.payload?.gameName || $t('ui.currentGame') }}</h4>
          <p>
            {{ $t('ui.readyToInstall') }} {{ directInstallCount }} {{ $t('ui.itemsManualStepsRequiredFor') }} {{ manualCount }} {{ $t('ui.itemsEstimatedSize') }}
            {{ formatBytes(estimate.sizeBytes) }}
          </p>
          <p v-if="exportBlockedReason" class="vxpack-export__warning">
            {{ exportBlockedReason }}
          </p>
        </div>
        <div class="vxpack-export__summary-actions">
          <VxButton variant="secondary" :disabled="loading || !libraryItems.length" @click="toggleAll">
            {{ allSelected ? $t('ui.deselectAll') : $t('ui.selectAllVariant2') }}
          </VxButton>
          <VxButton variant="secondary" :loading="loading" @click="loadLibrary">{{ $t('tools.refresh') }}</VxButton>
        </div>
      </section>

      <section class="vxpack-export__options">
        <label class="vxpack-export__option is-disabled">
          <input type="checkbox" checked disabled />
          <span>{{ $t('ui.includeProfileSettings') }}</span>
        </label>
        <label class="vxpack-export__option">
          <input v-model="includeDependencies" type="checkbox" />
          <span>{{ $t('ui.includeDependencyFiles') }}</span>
          <small v-if="skippedDependencyCount > 0">{{ $t('ui.willSkip') }} {{ skippedDependencyCount }} {{ $t('ui.dependencyItems') }}</small>
        </label>
        <label class="vxpack-export__option is-disabled">
          <input type="checkbox" checked disabled />
          <span>{{ $t('ui.includeInstallationRuleSnapshots') }}</span>
        </label>
        <label class="vxpack-export__option">
          <span>{{ $t('ui.conflictPolicy') }}</span>
          <select v-model="conflictPolicy">
            <option value="backup">{{ $t('ui.backUpAndOverwrite') }}</option>
            <option value="skip">{{ $t('ui.skipConflicts') }}</option>
            <option value="overwrite">{{ $t('ui.overwriteDirectly') }}</option>
          </select>
        </label>
        <label class="vxpack-export__option">
          <input v-model="openFolderAfterExport" type="checkbox" />
          <span>{{ $t('ui.openFolderAfterExport') }}</span>
        </label>
      </section>

      <section v-if="libraryItems.length" class="vxpack-export__list vx-ui-scrollbar">
        <label
          v-for="item in libraryItems"
          :key="getItemKey(item)"
          class="vxpack-export__row"
          :class="{ 'is-selected': selectedIds.includes(getItemKey(item)) }"
        >
          <input
            type="checkbox"
            :checked="selectedIds.includes(getItemKey(item))"
            @change="toggleItem(getItemKey(item))"
          />
          <span class="vxpack-export__row-main">
            <strong>{{ item.displayName || item.display_name }}</strong>
            <small>
              {{ item.sourcePath || item.fileName || item.file_name || $t('ui.exportableAssets') }}
            </small>
          </span>
          <span class="vxpack-export__row-meta">
            <VxBadge :tone="getItemStatus(item).tone">{{ getItemStatus(item).text }}</VxBadge>
            <VxBadge tone="info">{{ item.sourceLabel || item.sourcePlatform || $t('ui.local') }}</VxBadge>
            <VxBadge v-if="isDependencyItem(item)" tone="warning">{{ $t('taskCenter.detail.dependency') }}</VxBadge>
            <span>{{ formatBytes(item.sizeBytes || item.metadata?.sizeBytes) }}</span>
          </span>
        </label>
      </section>

      <section v-else class="vxpack-export__empty">
        {{ loading ? $t('ui.loadingExportableMods') : $t('ui.thisGameHasNoModFilesToExport') }}
      </section>

      <section v-if="lastPackagePath" class="vxpack-export__result">
        <span>{{ lastPackagePath }}</span>
        <VxButton variant="secondary" size="sm" :loading="opening" @click="openExportFolder">
          {{ $t('ui.openFolder') }}
        </VxButton>
      </section>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="$t('ui.close')"
        :confirm-text="$t('ui.exportOfflinePackage')"
        :confirm-disabled="!canExport"
        :confirm-loading="exporting"
        @cancel="closeDialog"
        @confirm="exportPackage"
      />
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
.vxpack-export {
  display: grid;
  gap: var(--space-4);
}

.vxpack-export__summary,
.vxpack-export__result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.vxpack-export__summary h4 {
  margin: 0 0 4px;
  color: var(--color-text);
  font-size: var(--font-size-lg);
}

.vxpack-export__summary p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.vxpack-export__summary-actions,
.vxpack-export__row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.vxpack-export__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.vxpack-export__option {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 32px;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.vxpack-export__option small {
  overflow: hidden;
  color: var(--color-warning);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vxpack-export__option select {
  min-width: 120px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
}

.vxpack-export__option.is-disabled {
  opacity: 0.7;
}

.vxpack-export__list {
  display: grid;
  gap: var(--space-2);
  max-height: 420px;
  overflow: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.vxpack-export__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
}

.vxpack-export__row:hover,
.vxpack-export__row.is-selected {
  background: var(--color-surface-hover);
  border-color: var(--color-border);
}

.vxpack-export__row-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.vxpack-export__row-main strong,
.vxpack-export__row-main small,
.vxpack-export__result span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vxpack-export__row-main strong {
  color: var(--color-text);
}

.vxpack-export__row-main small,
.vxpack-export__row-meta,
.vxpack-export__result {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.vxpack-export__empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
}

.vxpack-export__result {
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}
</style>
