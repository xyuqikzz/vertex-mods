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
import { inspectOfflinePack, submitOfflinePackInstall } from './vxpack-service.js'
import { registerOfflinePackProfileTargets } from './offline-pack-profile-registry.js'
import { resolveSourcePlatformLabel as resolveRegistrySourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  packagePath: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'submitted', 'profile-created'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const loading = ref(false)
const submitting = ref(false)
const profileCreating = ref(false)
const inspectData = ref(null)
const errorText = ref('')
const targetProfileName = ref('')
const selectedItemIds = ref([])
const selectedGameId = ref('')
const reuseEmptyProfile = ref(false)

const isOfflinePack = computed(() => inspectData.value?.kind === 'offline-pack')
const manifest = computed(() => inspectData.value?.manifest || {})
const blockers = computed(() =>
  Array.isArray(inspectData.value?.blockers) ? inspectData.value.blockers : []
)
const itemBlockers = computed(() =>
  Array.isArray(inspectData.value?.itemBlockers) ? inspectData.value.itemBlockers : []
)
const installableItems = computed(() =>
  Array.isArray(inspectData.value?.installableItems) ? inspectData.value.installableItems : []
)
const manualItems = computed(() =>
  Array.isArray(inspectData.value?.manualItems) ? inspectData.value.manualItems : []
)
const selectedItemIdSet = computed(() => new Set(selectedItemIds.value))
const allInstallableSelected = computed(
  () =>
    installableItems.value.length > 0 &&
    installableItems.value.every((item) => selectedItemIdSet.value.has(resolveItemId(item)))
)
const canSubmit = computed(
  () =>
    isOfflinePack.value &&
    inspectData.value?.canSubmitInstall &&
    selectedItemIds.value.length > 0 &&
    !profileCreating.value &&
    !submitting.value
)
const canCreateProfileOnly = computed(
  () =>
    isOfflinePack.value &&
    inspectData.value?.canSubmitInstall &&
    selectedItemIds.value.length > 0 &&
    !submitting.value &&
    !profileCreating.value
)
const profileAdjusted = computed(() => inspectData.value?.profilePlan?.adjusted === true)
const reusableProfile = computed(() => inspectData.value?.profilePlan?.reusableProfile || null)
const canReuseEmptyProfile = computed(
  () =>
    isOfflinePack.value &&
    reusableProfile.value?.canReuse === true &&
    Boolean(reusableProfile.value?.profileName)
)
const validationChecks = computed(() => {
  if (!isOfflinePack.value) return []

  const checksum = inspectData.value?.checksum || {}
  const gameMatch = inspectData.value?.gameMatch || {}
  const profilePlan = inspectData.value?.profilePlan || {}
  const schemaVersion = manifest.value?.schemaVersion || ''
  const gameRoot =
    gameMatch.gameRoot ||
    gameMatch.clientRootPath ||
    gameMatch.game?.clientRootPath ||
    gameMatch.game?.client_root_path ||
    ''
  const checksumFailureCount = Array.isArray(checksum.failures) ? checksum.failures.length : 0
  const schemaPassed = Boolean(schemaVersion)
  const checksumPassed = checksum.valid === true
  const gameMatched = gameMatch.status === 'matched'
  const gameNeedsSelection = gameMatch.status === 'ambiguous'

  return [
    {
      key: 'schema',
      label: 'Schema',
      value: schemaPassed ? `v${schemaVersion}` : '未识别',
      detail: manifest.value?.format || manifest.value?.packageType || '未读取到 manifest',
      tone: schemaPassed ? 'success' : 'danger'
    },
    {
      key: 'checksum',
      label: 'Checksum',
      value: checksumPassed ? '已通过' : '失败',
      detail: checksumPassed
        ? uiText('ui.verifiedValueFiles', { value1: (Number(checksum.total || 0)) })
        : uiText('ui.valueItemsFailed', { value1: (checksumFailureCount) }),
      tone: checksumPassed ? 'success' : 'danger'
    },
    {
      key: 'game-match',
      get label() { return uiText('ui.gameMatch') },
      value: gameMatched ? '已匹配' : gameNeedsSelection ? '需选择' : '未通过',
      detail: gameMatch.reason || resolveGameLabel(),
      tone: gameMatched ? 'success' : gameNeedsSelection ? 'warning' : 'danger'
    },
    {
      key: 'game-root',
      get label() { return uiText('ui.folderBinding') },
      value: gameRoot ? '已绑定' : '未绑定',
      detail: gameRoot || '请先绑定该游戏目录',
      tone: gameRoot ? 'success' : 'danger'
    },
    {
      key: 'profile',
      get label() { return uiText('ui.targetProfile') },
      value:
        reuseEmptyProfile.value || profilePlan.reuseExistingEmptyProfile
          ? '复用空配置'
          : '创建独立配置',
      detail: targetProfileName.value || profilePlan.targetProfileName || '--',
      tone: 'info'
    }
  ]
})
const gameAmbiguousBlocker = computed(
  () => blockers.value.find((item) => item?.code === 'offline_pack_game_ambiguous') || null
)
const gameCandidates = computed(() =>
  Array.isArray(gameAmbiguousBlocker.value?.candidates) ? gameAmbiguousBlocker.value.candidates : []
)
const packageInfoRows = computed(() => {
  if (!isOfflinePack.value) return []
  return [
    { key: 'name', get label() { return uiText('ui.packageName') }, value: resolvePackageName() },
    { key: 'game', get label() { return uiText('taskCenter.table.game') }, value: resolveGameLabel() },
    { key: 'profile', label: 'Profile', value: resolveProfileLabel() },
    { key: 'created-at', get label() { return uiText('taskCenter.detail.facts.created') }, value: formatDateTime(manifest.value?.createdAt) },
    { key: 'source', get label() { return uiText('ui.sourcePlatform') }, value: resolveSourcePlatformLabel() },
    { key: 'size', get label() { return uiText('ui.packageSize') }, value: formatBytes(inspectData.value?.sizeBytes) }
  ]
})
const footerActions = computed(() =>
  isOfflinePack.value
    ? [
        {
          key: 'create-profile-only',
          get text() { return uiText('ui.registerAnEmptyProfileOnly') },
          disabled: !canCreateProfileOnly.value,
          loading: profileCreating.value
        }
      ]
    : []
)

watch(
  () => [visible.value, props.packagePath],
  ([open, packagePath], previous = []) => {
    if (!open) {
      resetState()
      return
    }
    if (packagePath && packagePath !== previous[1]) {
      resetState()
    }
    if (packagePath) {
      loadInspect()
    }
  },
  { immediate: true }
)

function resetState() {
  loading.value = false
  submitting.value = false
  profileCreating.value = false
  inspectData.value = null
  errorText.value = ''
  targetProfileName.value = ''
  selectedItemIds.value = []
  selectedGameId.value = ''
  reuseEmptyProfile.value = false
}

function closeDialog() {
  if (loading.value || submitting.value || profileCreating.value) return
  visible.value = false
}

function formatBytes(value = 0) {
  const size = Number(value) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function resolveGameLabel() {
  return manifest.value?.game?.displayName || manifest.value?.game?.gameName || uiText('modBrowser.unknownGame')
}

function resolvePackageName() {
  return manifest.value?.name || manifest.value?.id || '未命名离线安装包'
}

function resolveProfileLabel() {
  return (
    manifest.value?.profile?.name ||
    manifest.value?.profile?.profileName ||
    targetProfileName.value ||
    inspectData.value?.targetProfileName ||
    '--'
  )
}

function resolveSourcePlatformLabel() {
  const items = Array.isArray(manifest.value?.items) ? manifest.value.items : []
  return (
    manifest.value?.profile?.sourcePlatform ||
    manifest.value?.game?.sourceType ||
    manifest.value?.game?.sourcePlatform ||
    items[0]?.sourcePlatform ||
    '--'
  )
}

function formatDateTime(value = '') {
  const text = String(value || '').trim()
  if (!text) return uiText('ui.notRecorded')
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN', { hour12: false })
}

function resolveItemId(item = {}) {
  return String(item.itemId || item.item_id || item.artifactId || item.name || '').trim()
}

function resolveItemCover(item = {}) {
  return String(item.coverDataUrl || item.cover || item.cover_url || '').trim()
}

function resolveItemInitial(item = {}) {
  const text = String(item.name || item.displayName || item.sourceModKey || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : '?'
}

function resolveItemSourceLabel(item = {}) {
  const platform = String(item.sourcePlatform || item.source_platform || '').trim().toLowerCase()
  if (platform === 'local') return uiText('ui.local')
  return resolveRegistrySourcePlatformLabel(platform, item.sourcePlatform || uiText('ui.unknownSource'))
}

function resolveItemDependentCount(item = {}) {
  return Number(item.dependentCount ?? item.dependent_count ?? 0) || 0
}

function resolveItemIsDefaultDependency(item = {}) {
  return (
    item.isDefaultDependency === true ||
    String(item.role || '').trim() === 'default_dependency' ||
    String(item.sourceModKey || '')
      .trim()
      .startsWith('dependency:')
  )
}

function resolveManualItemTitle(item = {}) {
  return item.name || item.displayName || item.sourceModKey || item.itemId || uiText('ui.unnamedEntry')
}

function resolveManualItemMeta(item = {}) {
  return (
    [
      item.sourcePlatform || item.source_platform,
      item.version || item.versionName || item.version_number
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' · ') || '未标记来源'
  )
}

function resolveManualItemReason(item = {}) {
  const reason = String(item.reason || item.code || item.message || '').trim()
  const reasonMap = {
    missing_source_file: '缺少可打包的源文件',
    missing_install_rule: '缺少可复用的安装规则',
    offline_pack_artifact_missing: '包内缺少离线文件',
    offline_pack_rule_missing: '包内缺少安装规则快照'
  }
  return reasonMap[reason] || reason || uiText('ui.manualStepsRequired')
}

function buildSelectedProfileRegistrationData(data = {}) {
  const selectedSet = new Set(
    selectedItemIds.value.map((item) => String(item || '').trim()).filter(Boolean)
  )
  const sourceManifest = data?.manifest || {}
  const manifestItems = Array.isArray(sourceManifest?.items) ? sourceManifest.items : []
  const sourceInstallableItems = Array.isArray(data?.installableItems) ? data.installableItems : []
  const shouldKeepItem = (item = {}) => !selectedSet.size || selectedSet.has(resolveItemId(item))
  return {
    ...data,
    installableItems: sourceInstallableItems.filter(shouldKeepItem),
    manifest: {
      ...sourceManifest,
      items: manifestItems.filter(shouldKeepItem)
    }
  }
}

function syncSelectedItems(items = []) {
  selectedItemIds.value = items.map((item) => resolveItemId(item)).filter(Boolean)
}

function toggleAllInstallableItems() {
  selectedItemIds.value = allInstallableSelected.value
    ? []
    : installableItems.value.map((item) => resolveItemId(item)).filter(Boolean)
}

async function loadInspect() {
  if (loading.value || !props.packagePath) return
  loading.value = true
  errorText.value = ''
  try {
    const result = await inspectOfflinePack({
      packagePath: props.packagePath,
      selectedGameId: selectedGameId.value
    })
    if (!result?.success) {
      errorText.value = result?.message || uiText('ui.offlinePackagePreflightFailed')
      inspectData.value = null
      return
    }
    inspectData.value = result.data || null
    targetProfileName.value = result.data?.targetProfileName || ''
    reuseEmptyProfile.value = false
    syncSelectedItems(
      Array.isArray(result.data?.installableItems) ? result.data.installableItems : []
    )
    selectedGameId.value = result.data?.gameMatch?.selectedGameId || selectedGameId.value || ''
  } catch (error) {
    console.error('离线安装包预检失败', error)
    errorText.value = String(error?.message || uiText('ui.offlinePackagePreflightFailed'))
  } finally {
    loading.value = false
  }
}

async function selectGameCandidate(candidate = {}) {
  const gameId = String(candidate?.id || '').trim()
  if (!gameId || loading.value) return
  selectedGameId.value = gameId
  await loadInspect()
}

function toggleReuseEmptyProfile() {
  if (!canReuseEmptyProfile.value) return
  reuseEmptyProfile.value = !reuseEmptyProfile.value
  targetProfileName.value = reuseEmptyProfile.value
    ? reusableProfile.value.profileName
    : inspectData.value?.targetProfileName || ''
}

function handleTargetProfileInput() {
  if (reuseEmptyProfile.value) {
    reuseEmptyProfile.value = false
  }
}

function buildImportSubmitPayload() {
  return {
    packagePath: props.packagePath,
    selectedGameId: selectedGameId.value,
    targetProfileName: targetProfileName.value,
    profileMode: reuseEmptyProfile.value ? 'reuse-empty' : 'create-isolated',
    reuseProfileName: reusableProfile.value?.profileName || '',
    selectedItemIds: [...selectedItemIds.value],
    conflictPolicy: 'backup'
  }
}

function resolvePreflightBlockerMessage(preflightData = {}, fallback = '离线安装包预检未通过') {
  const blocker = Array.isArray(preflightData.blockers) ? preflightData.blockers[0] : null
  return blocker?.message || fallback
}

const BLOCKER_CODE_LABEL_MAP = {
  get offline_pack_invalid() { return uiText('ui.invalidPackageFormat') },
  get offline_pack_unsupported_version() { return uiText('ui.unsupportedVersion') },
  get offline_pack_checksum_failed() { return uiText('ui.integrityCheckFailed') },
  get offline_pack_game_unmatched() { return uiText('ui.gameMismatch') },
  get offline_pack_game_root_missing() { return uiText('ui.gameFolderMissing') },
  get offline_pack_game_not_registered() { return uiText('ui.gameNotBound') },
  get offline_pack_game_ambiguous() { return uiText('ui.chooseATargetGame') },
  get offline_pack_profile_create_failed() { return uiText('ui.couldNotCreateProfile') },
  get offline_pack_artifact_missing() { return uiText('ui.offlineFilesMissing') },
  get offline_pack_rule_missing() { return uiText('ui.installationRulesMissing') },
  get offline_pack_size_limit_exceeded() { return uiText('ui.sizeLimitExceeded') },
  get offline_pack_task_create_failed() { return uiText('ui.couldNotCreateTask') }
}

function resolveBlockerCodeLabel(code = '') {
  return BLOCKER_CODE_LABEL_MAP[String(code || '').trim()] || code || ''
}

async function submitInstall() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const submitPayload = buildImportSubmitPayload()
    const preflightResult = await inspectOfflinePack(submitPayload)
    if (!preflightResult?.success) {
      $message.error(preflightResult?.message || '离线安装包预检失败')
      return
    }

    const preflightData = preflightResult.data || {}
    if (!preflightData.canSubmitInstall) {
      $message.error(resolvePreflightBlockerMessage(preflightData))
      return
    }

    const resolvedTargetProfileName = preflightData.targetProfileName || targetProfileName.value

    inspectData.value = preflightData
    targetProfileName.value = resolvedTargetProfileName
    // 沿用 manifest 声明的冲突策略，缺省回退到 'backup'
    const manifestConflictPolicyRaw = String(
      preflightData.manifest?.offlinePolicy?.conflictPolicy || ''
    ).trim()
    const manifestConflictPolicy = ['backup', 'overwrite', 'skip'].includes(manifestConflictPolicyRaw)
      ? manifestConflictPolicyRaw
      : 'backup'
    const result = await submitOfflinePackInstall({
      ...submitPayload,
      targetProfileName: resolvedTargetProfileName,
      conflictPolicy: manifestConflictPolicy
    })
    if (!result?.success) {
      $message.error(result?.message || '创建离线安装任务失败')
      return
    }

    // 安装任务创建成功后再注册 profile，避免「任务失败但孤儿配置残留」问题
    const finalTargetProfileName = result.data?.targetProfileName || resolvedTargetProfileName
    const profileRegistration = registerOfflinePackProfileTargets(
      buildSelectedProfileRegistrationData(preflightData),
      finalTargetProfileName
    )
    if (!profileRegistration.success) {
      console.warn('[OfflinePackImport] profile 注册失败（任务已创建）', profileRegistration.message)
    }
    // deferActivation 路径只导入不启用，明确告知用户需切换到目标配置查看
    const successMessage = uiText('ui.installationTaskAddedSwitchToProfileValueToViewDisabled', { value1: (finalTargetProfileName) })
    $message.success(result.message || successMessage)
    emit('submitted', result.data)
    visible.value = false
  } catch (error) {
    console.error('创建离线安装任务失败', error)
    $message.error(String(error?.message || '创建离线安装任务失败'))
  } finally {
    submitting.value = false
  }
}

async function createProfileOnly() {
  if (!canCreateProfileOnly.value) return
  profileCreating.value = true
  try {
    const submitPayload = buildImportSubmitPayload()
    const preflightResult = await inspectOfflinePack(submitPayload)
    if (!preflightResult?.success) {
      $message.error(preflightResult?.message || '离线安装包预检失败')
      return
    }

    const preflightData = preflightResult.data || {}
    if (!preflightData.canSubmitInstall) {
      $message.error(resolvePreflightBlockerMessage(preflightData))
      return
    }

    const resolvedTargetProfileName = preflightData.targetProfileName || targetProfileName.value
    const profileRegistration = registerOfflinePackProfileTargets(
      buildSelectedProfileRegistrationData(preflightData),
      resolvedTargetProfileName
    )
    if (!profileRegistration.success) {
      $message.error(profileRegistration.message || '创建导入配置失败')
      return
    }

    inspectData.value = preflightData
    targetProfileName.value = resolvedTargetProfileName
    $message.success(uiMessage('ui.emptyProfileValueRegisteredNoModRecordsWereWrittenEnable', { value1: (resolvedTargetProfileName) }))
    emit('profile-created', {
      targetProfileName: resolvedTargetProfileName,
      selectedItemIds: [...selectedItemIds.value]
    })
    visible.value = false
  } catch (error) {
    console.error('创建离线安装包配置方案失败', error)
    $message.error(String(error?.message || '创建离线安装包配置方案失败'))
  } finally {
    profileCreating.value = false
  }
}

function handleFooterAction(action = {}) {
  if (action.key === 'create-profile-only') {
    createProfileOnly()
  }
}
</script>

<template>
  <VxModal
    v-model="visible"
    :title="$t('ui.importOfflinePackage')"
    :description="$t('ui.checkThePackageTargetGameAndOfflineFilesBeforeAdding')"
    :width="760"
    :close-on-overlay="false"
    @close="closeDialog"
  >
    <div class="offline-pack-import">
      <section class="offline-pack-import__file">
        <div>
          <h4>{{ props.packagePath ? $t('ui.fileSelected') : $t('ui.noFileSelected') }}</h4>
          <p>{{ props.packagePath || $t('ui.dropOrSelectAVxpackFile') }}</p>
        </div>
        <VxButton variant="secondary" :loading="loading" @click="loadInspect">{{ $t('ui.runPreflightAgain') }}</VxButton>
      </section>

      <section v-if="loading" class="offline-pack-import__empty">{{ $t('ui.checkingOfflinePackage') }}</section>
      <section v-else-if="errorText" class="offline-pack-import__error">{{ errorText }}</section>

      <section v-else-if="inspectData" class="offline-pack-import__content">
        <div class="offline-pack-import__stats">
          <VxBadge tone="success">{{ $t('ui.offlinePackage') }}</VxBadge>
          <span>{{ resolveGameLabel() }}</span>
          <span>{{ formatBytes(inspectData.sizeBytes) }}</span>
          <span v-if="isOfflinePack">{{ $t('ui.installable') }} {{ installableItems.length }} {{ $t('ui.itemsVariant2') }}</span>
          <span v-if="manualItems.length">{{ $t('ui.manualSteps') }} {{ manualItems.length }} {{ $t('ui.itemsVariant2') }}</span>
        </div>

        <div v-if="packageInfoRows.length" class="offline-pack-import__info">
          <div v-for="row in packageInfoRows" :key="row.key" class="offline-pack-import__info-row">
            <small>{{ row.label }}</small>
            <strong>{{ row.value }}</strong>
          </div>
        </div>

        <div v-if="validationChecks.length" class="offline-pack-import__checks">
          <div
            v-for="check in validationChecks"
            :key="check.key"
            class="offline-pack-import__check"
          >
            <span>
              <strong>{{ check.label }}</strong>
              <small>{{ check.detail }}</small>
            </span>
            <VxBadge :tone="check.tone">{{ check.value }}</VxBadge>
          </div>
        </div>

        <div v-if="isOfflinePack" class="offline-pack-import__profile">
          <label>{{ $t('ui.targetProfile') }}</label>
          <input
            v-model="targetProfileName"
            type="text"
            maxlength="32"
            :disabled="reuseEmptyProfile"
            @input="handleTargetProfileInput"
          />
          <label
            v-if="canReuseEmptyProfile"
            class="offline-pack-import__reuse"
            :class="{ 'is-selected': reuseEmptyProfile }"
          >
            <input type="checkbox" :checked="reuseEmptyProfile" @change="toggleReuseEmptyProfile" />
            <span>{{ $t('ui.importIntoAnEmptyProfile') }} {{ reusableProfile.profileName }}</span>
          </label>
          <small v-if="profileAdjusted && !reuseEmptyProfile"
            >{{ $t('ui.theProfileWithThisNameAlreadyContainsModsASeparate') }}</small
          >
          <small v-if="canReuseEmptyProfile && !reuseEmptyProfile"
            >{{ $t('ui.aSeparateProfileIsCreatedByDefaultEnableThisOption') }}</small
          >
        </div>

        <div v-if="blockers.length" class="offline-pack-import__blockers">
          <strong>{{ $t('ui.preflightBlocked') }}</strong>
          <div
            v-for="blocker in blockers"
            :key="`${blocker.code}:${blocker.itemId || blocker.message}`"
          >
            <VxBadge tone="danger">{{ resolveBlockerCodeLabel(blocker.code) }}</VxBadge>
            <span>
              {{ blocker.message || resolveBlockerCodeLabel(blocker.code) }}
              <small v-if="blocker.actionText">{{ blocker.actionText }}</small>
              <small v-if="Array.isArray(blocker.candidates) && blocker.candidates.length">
                {{ $t('ui.candidates') }}{{
                  blocker.candidates
                    .map((item) => item.name || item.sourceSlug || item.id)
                    .join('、')
                }}
              </small>
            </span>
          </div>
        </div>

        <div v-if="itemBlockers.length" class="offline-pack-import__item-blockers">
          <strong>{{ $t('ui.someItemsCannotBeInstalledAndWereSkippedOtherItems') }}</strong>
          <div
            v-for="blocker in itemBlockers"
            :key="`item:${blocker.code}:${blocker.itemId || blocker.message}`"
          >
            <VxBadge tone="warning">{{ resolveBlockerCodeLabel(blocker.code) }}</VxBadge>
            <span>{{ blocker.message || resolveBlockerCodeLabel(blocker.code) }}</span>
          </div>
        </div>

        <div v-if="manualItems.length" class="offline-pack-import__manual">
          <strong>{{ $t('ui.itemsRequiringManualSteps') }}</strong>
          <div
            v-for="(item, index) in manualItems"
            :key="`${item.itemId || item.name || 'manual'}:${index}`"
            class="offline-pack-import__manual-row"
          >
            <div>
              <strong>{{ resolveManualItemTitle(item) }}</strong>
              <small>{{ resolveManualItemMeta(item) }}</small>
            </div>
            <VxBadge tone="warning">{{ resolveManualItemReason(item) }}</VxBadge>
          </div>
        </div>

        <div v-if="gameCandidates.length" class="offline-pack-import__candidates">
          <strong>{{ $t('ui.chooseTheTargetGame') }}</strong>
          <button
            v-for="candidate in gameCandidates"
            :key="candidate.id"
            type="button"
            class="offline-pack-import__candidate"
            :class="{ 'is-selected': String(candidate.id) === String(selectedGameId) }"
            @click="selectGameCandidate(candidate)"
          >
            <span>{{ candidate.name || candidate.sourceSlug || $t('ui.gameValue', { value1: (candidate.id) }) }}</span>
            <small
              >{{ candidate.source }} ·
              {{
                candidate.sourceId || candidate.sourceSlug || candidate.appId || $t('ui.unknownIdentifier')
              }}</small
            >
            <small>{{ candidate.clientRootPath || $t('ui.noFolderBound') }}</small>
          </button>
        </div>

        <div v-if="installableItems.length" class="offline-pack-import__list vx-ui-scrollbar">
          <label class="offline-pack-import__select-all">
            <input
              type="checkbox"
              :checked="allInstallableSelected"
              @change="toggleAllInstallableItems"
            />
            <span>{{ $t('ui.selectAllInstallableItems') }}</span>
          </label>
          <div
            v-for="item in installableItems"
            :key="item.itemId || item.artifactId || item.name"
            class="offline-pack-import__row"
          >
            <input v-model="selectedItemIds" type="checkbox" :value="resolveItemId(item)" />
            <span class="offline-pack-import__cover">
              <img
                v-if="resolveItemCover(item)"
                :src="resolveItemCover(item)"
                :alt="item.name || $t('ui.modCover')"
                referrerpolicy="no-referrer"
              />
              <span v-else class="offline-pack-import__cover-fallback">{{
                resolveItemInitial(item)
              }}</span>
            </span>
            <div class="offline-pack-import__row-main">
              <strong>{{ item.name || $t('ui.unnamedEntry') }}</strong>
              <small
                >{{ resolveItemSourceLabel(item) }} · {{ item.version || $t('ui.noVersionSpecified') }}</small
              >
            </div>
            <div class="offline-pack-import__row-tags">
              <VxBadge v-if="resolveItemIsDefaultDependency(item)" tone="warning">{{ $t('ui.defaultDependency') }}</VxBadge>
              <VxBadge v-if="resolveItemDependentCount(item) > 0" tone="default"
                >{{ $t('ui.requiredByOtherMods') }} {{ resolveItemDependentCount(item) }}</VxBadge
              >
            </div>
          </div>
        </div>
      </section>

      <section v-else class="offline-pack-import__empty">{{ $t('ui.noOfflinePackageLoaded') }}</section>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="$t('ui.cancel')"
        :confirm-text="$t('ui.addToInstallationTasks')"
        :actions="footerActions"
        :confirm-disabled="!canSubmit"
        :confirm-loading="submitting"
        @cancel="closeDialog"
        @action="handleFooterAction"
        @confirm="submitInstall"
      />
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
.offline-pack-import {
  display: grid;
  gap: var(--space-4);
}

.offline-pack-import__file,
.offline-pack-import__stats,
.offline-pack-import__row,
.offline-pack-import__blockers > div {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.offline-pack-import__file,
.offline-pack-import__row {
  justify-content: space-between;
}

.offline-pack-import__file h4 {
  margin: 0 0 4px;
  color: var(--color-text);
  font-size: var(--font-size-lg);
}

.offline-pack-import__file p {
  max-width: 560px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__cover {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.offline-pack-import__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.offline-pack-import__cover-fallback {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.offline-pack-import__row-main {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.offline-pack-import__row-main strong,
.offline-pack-import__row-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__row-main small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__row-tags {
  display: inline-flex;
  flex-shrink: 0;
  gap: var(--space-2);
}

.offline-pack-import__content,
.offline-pack-import__blockers,
.offline-pack-import__manual,
.offline-pack-import__candidates {
  display: grid;
  gap: var(--space-3);
}

.offline-pack-import__stats {
  flex-wrap: wrap;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.offline-pack-import__info {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.offline-pack-import__info-row {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.offline-pack-import__info-row small,
.offline-pack-import__info-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__info-row small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__info-row strong {
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.offline-pack-import__checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.offline-pack-import__check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.offline-pack-import__check span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.offline-pack-import__check strong,
.offline-pack-import__check small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__check strong {
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.offline-pack-import__check small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__profile {
  display: grid;
  gap: 6px;
}

.offline-pack-import__profile label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__profile small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__profile input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}

.offline-pack-import__profile input:disabled {
  opacity: 0.72;
}

.offline-pack-import__reuse {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: fit-content;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.offline-pack-import__reuse.is-selected {
  border-color: var(--color-primary);
  background: rgba(24, 144, 255, 0.08);
  color: var(--color-text);
}

.offline-pack-import__blockers {
  padding: var(--space-3);
  border: 1px solid rgba(220, 53, 69, 0.28);
  border-radius: var(--radius-md);
  background: rgba(220, 53, 69, 0.06);
}

.offline-pack-import__blockers span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.offline-pack-import__blockers small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__manual {
  padding: var(--space-3);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius-md);
  background: rgba(245, 158, 11, 0.08);
}

.offline-pack-import__manual-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.offline-pack-import__manual-row > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.offline-pack-import__manual-row strong,
.offline-pack-import__manual-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__manual-row small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__candidates {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.offline-pack-import__candidate {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.offline-pack-import__candidate:hover,
.offline-pack-import__candidate.is-selected {
  border-color: var(--color-primary);
  background: rgba(24, 144, 255, 0.08);
}

.offline-pack-import__candidate span,
.offline-pack-import__candidate small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__candidate small {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.offline-pack-import__list {
  display: grid;
  gap: var(--space-2);
  max-height: 300px;
  overflow: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.offline-pack-import__select-all {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.offline-pack-import__row {
  justify-content: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.offline-pack-import__row div {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.offline-pack-import__row strong,
.offline-pack-import__row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-pack-import__row small {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.offline-pack-import__empty,
.offline-pack-import__error {
  display: grid;
  min-height: 160px;
  place-items: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
}

.offline-pack-import__error {
  color: var(--color-danger);
}
</style>
