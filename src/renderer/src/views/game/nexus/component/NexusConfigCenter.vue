<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, ref } from 'vue'
import { $message } from '@renderer/common/message.js'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
// 从 index 引入，确保 tool-page.scss（区块标题、状态胶囊、骨架等共用类）已加载。
import {
  ToolEmpty,
  ToolIcon,
  ToolIconButton,
  coverMonogram,
  coverPlaceholderTone
} from '@renderer/component/tool-page'
import { useAppStore } from '@renderer/store/appStore.js'
import NexusConfigUploadDialog from './NexusConfigUploadDialog.vue'
import NexusConfigDetailDrawer from './NexusConfigDetailDrawer.vue'
import { useNexusConfigProfiles } from '../useNexusConfigProfiles.js'
import {
  INSTALL_CONFIG_SCOPE,
  buildInstallConfigVersionWarningText,
  createEmptyPlayerConfigDraft,
  formatInstallConfigTime,
  parseNexusRuleJsonText,
  normalizeInstallConfigProfile,
  shouldWarnInstallConfigVersion,
  resolveInstallConfigOwnerLabel
} from '../nexus-config-profile-utils.js'

const WORKSPACE_MODE = Object.freeze({
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit'
})

const props = defineProps({
  gameContext: {
    type: Object,
    default: () => ({})
  },
  currentRuleJsonText: {
    type: String,
    default: ''
  },
  currentRuleSourceText: {
    type: String,
    default: undefined
  },
  userLoggedIn: {
    type: Boolean,
    default: false
  },
  embedded: {
    type: Boolean,
    default: false
  },
  activeProfileSnapshot: {
    type: Object,
    default: () => null
  },
  fallbackOfficialProfile: {
    type: Object,
    default: () => null
  },
  hasLocalOverride: {
    type: Boolean,
    default: false
  },
  // 是否显示组件内置的标题栏（当前生效 + 上传按钮）
  // 外层页面已自带 header 时可传 false，避免重复
  showHeader: {
    type: Boolean,
    default: true
  },
  // 外层页面在页头放了「上传我的配置」时传 false，并通过 expose 的 openCreateWorkspace 打开。
  showUploadAction: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['require-login', 'apply-profile', 'edit-rules'])
const appStore = useAppStore()

const {
  officialLoading,
  officialList,
  playerLoading,
  playerPageData,
  supportInfo,
  myStatusLoading,
  myStatus,
  loadPlayerList,
  loadProfileDetail,
  savePlayerProfile,
  clonePlayerProfile,
  deletePlayerProfile,
  useProfile,
  loadMyProfileDetail
} = useNexusConfigProfiles({
  getGameContext: () => props.gameContext,
  isLoggedIn: () => props.userLoggedIn
})

const workspace = ref(createWorkspaceState())
// 正在提交「使用」的配置，防止重复点击。
const usingProfileKey = ref('')

const playerTotal = computed(() => Number(playerPageData.value?.total || 0))
const playerPageSize = computed(() => Number(playerPageData.value?.size || 10))
const playerCurrentPage = computed(() => Number(playerPageData.value?.current || 1))
const playerPageCount = computed(() =>
  Math.max(1, Math.ceil(playerTotal.value / Math.max(playerPageSize.value, 1)))
)
const playerRangeText = computed(() => {
  const count = playerPageData.value?.records?.length || 0
  if (!count) return ''
  const start = (playerCurrentPage.value - 1) * playerPageSize.value + 1
  return uiText('ui.valueValueOfValue', { value1: (start), value2: (start + count - 1), value3: (playerTotal.value.toLocaleString('zh-CN')) })
})
// 页码最多显示 5 个，当前页尽量居中。
const playerPageNumbers = computed(() => {
  const total = playerPageCount.value
  const current = playerCurrentPage.value
  const start = Math.max(1, Math.min(current - 2, total - 4))
  return Array.from({ length: Math.min(5, total) }, (_, index) => start + index)
})

const confirmDialog = ref(createConfirmDialogState())
let confirmResolver = null

function createConfirmDialogState() {
  return {
    open: false,
    title: '',
    content: '',
    get confirmText() { return uiText('ui.confirm') },
    get cancelText() { return uiText('ui.cancel') },
    danger: false,
    action: null
  }
}

// VxConfirmModal 的 Promise 封装：确认 resolve(true)，取消、关闭 resolve(false)。
function askConfirm(options = {}) {
  settleConfirm(false)
  return new Promise((resolve) => {
    confirmResolver = resolve
    confirmDialog.value = { ...createConfirmDialogState(), ...options, open: true }
  })
}

function settleConfirm(result) {
  const resolve = confirmResolver
  confirmResolver = null
  resolve?.(result)
}

function changePlayerPage(page) {
  const target = Math.max(1, Math.min(Number(page || 1), playerPageCount.value))
  if (target === playerCurrentPage.value || playerLoading.value) return
  loadPlayerList(target, playerPageSize.value)
}

function formatShortDate(value = '') {
  const date = new Date(String(value || '').trim())
  if (!value || Number.isNaN(date.getTime())) return '--'
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function ownerInitial(profile = {}) {
  return coverMonogram(resolveInstallConfigOwnerLabel(profile)).slice(0, 1)
}

function ownerTone(profile = {}) {
  return coverPlaceholderTone(resolveInstallConfigOwnerLabel(profile))
}

const normalizedActiveProfileSnapshot = computed(() => {
  const source = props.activeProfileSnapshot
  if (!source || typeof source !== 'object') {
    return null
  }

  return {
    id: Number(source?.id || 0) || null,
    profileKey: String(source?.profileKey || '').trim(),
    configName: String(source?.configName || '').trim(),
    configScope: String(source?.configScope || '').trim(),
    sourceType: String(source?.sourceType || '').trim()
  }
})

const normalizedFallbackOfficialProfile = computed(() => {
  const source = props.fallbackOfficialProfile
  if (!source || typeof source !== 'object') {
    return null
  }

  return normalizeInstallConfigProfile({
    ...source,
    configScope: INSTALL_CONFIG_SCOPE.OFFICIAL,
    legacyFallback: true
  })
})

const displayOfficialList = computed(() => {
  if (officialList.value.length) {
    return officialList.value
  }
  return normalizedFallbackOfficialProfile.value ? [normalizedFallbackOfficialProfile.value] : []
})

const defaultOfficialProfile = computed(() => {
  const defaultProfileId = Number(supportInfo.value?.defaultOfficialProfileId || 0) || null
  if (defaultProfileId) {
    const matchedProfile = displayOfficialList.value.find(
      (item) => Number(item?.id || 0) === defaultProfileId
    )
    if (matchedProfile) {
      return matchedProfile
    }
  }

  const defaultFlagProfile = displayOfficialList.value.find((item) => !!item?.isDefault)
  if (defaultFlagProfile) {
    return defaultFlagProfile
  }

  return displayOfficialList.value[0] || null
})

const playerRankStart = computed(() => {
  const current = Number(playerPageData.value?.current || 1)
  const size = Number(playerPageData.value?.size || 10)
  return (current - 1) * size
})

const resolvedActiveProfileKey = computed(() => {
  const snapshot = normalizedActiveProfileSnapshot.value
  if (snapshot?.profileKey) {
    if (
      snapshot.configScope === INSTALL_CONFIG_SCOPE.OFFICIAL &&
      !snapshot.id &&
      snapshot.profileKey.startsWith('legacy:official:') &&
      defaultOfficialProfile.value
    ) {
      return resolveProfileKey(defaultOfficialProfile.value)
    }
    return snapshot.profileKey
  }
  if (snapshot?.id) {
    return `profile:${snapshot.id}`
  }
  if (props.hasLocalOverride) {
    return ''
  }
  return defaultOfficialProfile.value ? resolveProfileKey(defaultOfficialProfile.value) : ''
})

const uploadActionText = computed(() => {
  return myStatus.value?.uploaded ? uiText('dialogs.configUpload.editTitle') : uiText('dialogs.configUpload.createTitle')
})

const isDetailOpen = computed(
  () => workspace.value.visible && workspace.value.mode === WORKSPACE_MODE.VIEW
)
const isUploadOpen = computed(
  () => workspace.value.visible && workspace.value.mode !== WORKSPACE_MODE.VIEW
)

function createWorkspaceState() {
  return {
    visible: false,
    mode: WORKSPACE_MODE.VIEW,
    loading: false,
    saving: false,
    profile: createEmptyPlayerConfigDraft(props.gameContext, props.currentRuleJsonText)
  }
}

function emitRequireLogin() {
  emit('require-login')
}

function resolveProfileKey(profile = {}) {
  const profileId = Number(profile?.id || 0)
  if (profileId > 0) {
    return `profile:${profileId}`
  }

  const profileKey = String(profile?.profileKey || '').trim()
  if (profileKey) {
    return profileKey
  }

  const gameKey =
    String(
      profile?.gameKey || props.gameContext?.gameKey || props.gameContext?.domainName || ''
    ).trim() || 'unknown'
  const configScope =
    String(profile?.configScope || INSTALL_CONFIG_SCOPE.OFFICIAL).trim() ||
    INSTALL_CONFIG_SCOPE.OFFICIAL
  const configName = String(profile?.configName || '').trim() || 'default'
  return `virtual:${configScope}:${gameKey}:${configName}`
}

function resolvePlayerRank(index = 0) {
  return playerRankStart.value + index + 1
}

function isProfileActive(profile = {}) {
  const currentProfileKey = String(resolvedActiveProfileKey.value || '').trim()
  if (!currentProfileKey) {
    return false
  }
  return currentProfileKey === resolveProfileKey(profile)
}

function buildProfileWorkspacePayload(profile = {}) {
  const rawRuleJsonText = String(profile?.ruleJsonText || '').trim()
  const fallbackRuleJsonText = (() => {
    try {
      if (
        profile?.ruleJson &&
        typeof profile.ruleJson === 'object' &&
        !Array.isArray(profile.ruleJson)
      ) {
        return JSON.stringify(profile.ruleJson, null, 2)
      }
    } catch {
      return ''
    }
    return ''
  })()
  const formattedRuleJsonText = (() => {
    const text = rawRuleJsonText || fallbackRuleJsonText
    if (!text) {
      return ''
    }
    try {
      return JSON.stringify(parseNexusRuleJsonText(text), null, 2)
    } catch {
      return text
    }
  })()

  const normalizedProfile = normalizeInstallConfigProfile({
    ...profile,
    profileKey: resolveProfileKey(profile),
    configScope:
      String(profile?.configScope || INSTALL_CONFIG_SCOPE.OFFICIAL).trim() ||
      INSTALL_CONFIG_SCOPE.OFFICIAL,
    ruleJsonText: formattedRuleJsonText
  })

  return {
    ...normalizedProfile,
    useCount: Number(normalizedProfile?.useCount || 0),
    canEdit: !!normalizedProfile?.canEdit,
    canDelete: !!normalizedProfile?.canDelete
  }
}

function openWorkspace(mode = WORKSPACE_MODE.VIEW, profile = {}, loading = false) {
  workspace.value = {
    visible: true,
    mode,
    loading,
    saving: false,
    profile
  }
}

function closeWorkspace() {
  if (workspace.value.saving) return
  workspace.value = createWorkspaceState()
}

function handleWorkspaceOpenChange(value) {
  if (!value) closeWorkspace()
}

// 「去编辑规则」：关掉弹窗，由页面切到「编辑规则」页签。
function handleEditRules() {
  closeWorkspace()
  emit('edit-rules')
}

function openCreateWorkspace() {
  if (!props.userLoggedIn) {
    emitRequireLogin()
    return
  }

  if (myStatus.value?.uploaded && myStatus.value?.profileId) {
    openEditWorkspace(myStatus.value.profileId).then()
    return
  }

  openWorkspace(
    WORKSPACE_MODE.CREATE,
    createEmptyPlayerConfigDraft(props.gameContext, props.currentRuleJsonText),
    false
  )
}

async function openEditWorkspace(profileId) {
  if (!props.userLoggedIn) {
    emitRequireLogin()
    return
  }

  openWorkspace(WORKSPACE_MODE.EDIT, {}, true)

  try {
    const detail = await loadMyProfileDetail(profileId)
    openWorkspace(
      WORKSPACE_MODE.EDIT,
      buildProfileWorkspacePayload({
        ...detail,
        profileKey: resolveProfileKey(detail)
      }),
      false
    )
  } catch (error) {
    closeWorkspace()
    $message.error(uiMessage('ui.couldNotLoadMyConfigurationsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  }
}

async function openDetail(profile = {}) {
  const profileId = Number(profile?.id || 0)
  if (profileId <= 0) {
    openWorkspace(WORKSPACE_MODE.VIEW, buildProfileWorkspacePayload(profile), false)
    return
  }

  openWorkspace(WORKSPACE_MODE.VIEW, {}, true)

  try {
    const detail = await loadProfileDetail(profileId)
    openWorkspace(
      WORKSPACE_MODE.VIEW,
      buildProfileWorkspacePayload({
        ...detail,
        profileKey: resolveProfileKey(profile)
      }),
      false
    )
  } catch (error) {
    closeWorkspace()
    $message.error(uiMessage('ui.couldNotReadConfigurationValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  }
}

async function handleSubmitWorkspace(draft = {}) {
  const currentMode = workspace.value.mode
  workspace.value = {
    ...workspace.value,
    saving: true
  }

  try {
    await savePlayerProfile(draft)
    workspace.value = createWorkspaceState()
    $message.success(currentMode === WORKSPACE_MODE.EDIT ? '配置已更新' : '配置已上传')
  } catch (error) {
    workspace.value = {
      ...workspace.value,
      saving: false
    }
    $message.error(uiMessage('ui.couldNotSaveConfigurationValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  }
}

async function handleCloneProfile(profile = {}) {
  if (!props.userLoggedIn) {
    emitRequireLogin()
    return
  }

  const profileId = Number(profile?.id || 0)
  if (profileId <= 0) {
    // 没有线上 id 的配置（本地兜底的官方配置）：带着它的规则新建。
    openWorkspace(
      WORKSPACE_MODE.CREATE,
      createEmptyPlayerConfigDraft(
        props.gameContext,
        profile?.ruleJsonText || props.currentRuleJsonText
      ),
      false
    )
    return
  }

  try {
    const savedProfile = await clonePlayerProfile(profileId)
    $message.success(uiMessage('ui.copiedAsMyConfiguration'))
    openEditWorkspace(savedProfile.id).then()
  } catch (error) {
    $message.error(uiMessage('ui.couldNotCopyConfigurationValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  }
}

function confirmUseProfileWithVersion(profile = {}) {
  const currentVersion = String(appStore.AppData?.version || '').trim()
  if (!shouldWarnInstallConfigVersion(profile, currentVersion)) {
    return Promise.resolve(true)
  }
  return askConfirm({
    get title() { return uiText('ui.thisConfigurationRequiresANewerVertexVersion') },
    content: buildInstallConfigVersionWarningText(profile, currentVersion),
    get confirmText() { return uiText('ui.useAnyway') }
  })
}

async function handleUseProfile(profile = {}) {
  if (isProfileActive(profile)) {
    $message.info(uiMessage('ui.thisConfigurationIsAlreadyActive'))
    return
  }

  const isPlayerProfile = String(profile?.configScope || '').trim() === INSTALL_CONFIG_SCOPE.PLAYER
  if (isPlayerProfile && !props.userLoggedIn) {
    emitRequireLogin()
    return
  }

  if (usingProfileKey.value) {
    return
  }

  const shouldContinue = await confirmUseProfileWithVersion(profile)
  if (!shouldContinue) {
    return
  }

  const profileId = Number(profile?.id || 0)
  usingProfileKey.value = resolveProfileKey(profile)
  try {
    if (profileId > 0) {
      const result = await useProfile(profileId)
      emit('apply-profile', {
        profile: {
          ...profile,
          profileKey: resolveProfileKey(profile)
        },
        detail: result?.detail || null,
        useResult: result?.useResult || null
      })
      return
    }

    const detail = buildProfileWorkspacePayload(profile)
    emit('apply-profile', {
      profile: {
        ...profile,
        profileKey: resolveProfileKey(profile)
      },
      detail,
      useResult: {
        profileId: null,
        configScope: INSTALL_CONFIG_SCOPE.OFFICIAL,
        counted: false,
        useCount: Number(profile?.useCount || 0)
      }
    })
  } catch (error) {
    $message.error(uiMessage('ui.couldNotSwitchProfileValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    usingProfileKey.value = ''
  }
}

function confirmDeleteProfile(profile = {}) {
  askConfirm({
    get title() { return uiText('ui.deleteProfile') },
    content: uiText('ui.deleteValueOtherPlayersWillNoLongerBeAbleTo', { value1: (String(profile?.configName || '未命名配置').trim()) }),
    get confirmText() { return uiText('modelSettings.remove') },
    danger: true,
    // 删除失败时弹窗保持打开并显示原因。
    action: async () => {
      await deletePlayerProfile(profile?.id)
      if (Number(workspace.value?.profile?.id || 0) === Number(profile?.id || 0)) {
        closeWorkspace()
      }
      $message.success(uiMessage('ui.configurationDeleted'))
    }
  })
}

defineExpose({
  openCreateWorkspace,
  uploadActionText,
  myStatusLoading,
  officialCount: computed(() => displayOfficialList.value.length),
  playerTotal
})
</script>

<template>
  <div class="nexus-config-center" :class="{ 'is-embedded': embedded }">
    <!-- 组件自带的精简 header（外层页面已有 header 时可传 :show-header="false" 隐藏） -->
    <header v-if="showHeader" class="nexus-config-center__header">
      <span class="nexus-config-center__header-label">{{ $t('ui.currentlyActive') }}</span>
      <span class="nexus-config-center__header-value">{{ (currentRuleSourceText ?? $t('ui.noActiveRules')) }}</span>
      <VxButton
        v-if="showUploadAction"
        variant="secondary"
        size="sm"
        :loading="myStatusLoading"
        @click="openCreateWorkspace"
      >
        <ToolIcon name="upload" :size="14" />
        {{ uploadActionText }}
      </VxButton>
    </header>

    <!-- 官方配置 -->
    <section class="nexus-config-center__section" aria-labelledby="nexus-config-official-title">
      <div class="tool-section-head">
        <h2 id="nexus-config-official-title" class="tool-section-title">
          {{ $t('dialogs.configDetail.official') }}<small>{{ displayOfficialList.length.toLocaleString('zh-CN') }}</small>
        </h2>
        <p class="tool-section-hint">
          <span v-if="officialLoading" class="tool-inline-spinner" aria-hidden="true"></span>
          {{ officialLoading ? $t('ui.loadingVariant3') : $t('ui.maintainedByVertexReadyToUse') }}
        </p>
      </div>

      <div
        v-if="officialLoading && !displayOfficialList.length"
        class="nexus-config-center__skeleton"
        aria-hidden="true"
      >
        <span class="tool-skeleton is-icon"></span>
        <span class="tool-skeleton is-line"></span>
      </div>

      <ul v-else-if="displayOfficialList.length" class="nexus-config-center__official-list">
        <li
          v-for="profile in displayOfficialList"
          :key="resolveProfileKey(profile)"
          class="nexus-config-center__official"
          :class="{ 'is-active': isProfileActive(profile) }"
        >
          <span class="nexus-config-center__official-icon" aria-hidden="true">
            <ToolIcon name="shield" :size="20" />
          </span>
          <div class="nexus-config-center__main">
            <div class="nexus-config-center__title-line">
              <span class="nexus-config-center__title">{{ profile.configName }}</span>
              <span v-if="profile.isDefault" class="nexus-config-center__tag is-recommend"
                >{{ $t('tools.recommended') }}</span
              >
            </div>
            <div class="nexus-config-center__meta">
              <span
                >{{ Number(profile.installRuleCount || 0).toLocaleString('zh-CN') }} {{ $t('ui.rules') }}</span
              >
              <span
                >{{ $t('ui.updatedVariant2') }}
                {{ formatInstallConfigTime(profile.updatedAt || profile.publishedAt) }}</span
              >
            </div>
            <p v-if="profile.configDesc" class="nexus-config-center__desc">
              {{ profile.configDesc }}
            </p>
          </div>
          <div class="nexus-config-center__actions">
            <span v-if="isProfileActive(profile)" class="tool-status is-success">{{ $t('dialogs.configDetail.inUse') }}</span>
            <VxButton
              v-else
              variant="secondary"
              size="sm"
              class="nexus-config-center__use-btn"
              :loading="usingProfileKey === resolveProfileKey(profile)"
              :disabled="!!usingProfileKey && usingProfileKey !== resolveProfileKey(profile)"
              @click="handleUseProfile(profile)"
            >
              {{ hasLocalOverride ? $t('ui.useThisInstead') : $t('ui.use') }}
            </VxButton>
            <VxButton variant="ghost" size="sm" @click="openDetail(profile)">{{ $t('modBrowser.details') }}</VxButton>
            <ToolIconButton
              icon="copy"
              :label="$t('dialogs.configDetail.clone')"
              size="sm"
              @click="handleCloneProfile(profile)"
            />
          </div>
        </li>
      </ul>

      <ToolEmpty
        v-else
        compact
        icon="shield"
        :title="$t('ui.thisGameHasNoOfficialConfigurationYet')"
        :description="$t('ui.youCanWriteLocalRulesInEditRulesOrUpload')"
      />
    </section>

    <!-- 玩家配置 -->
    <section class="nexus-config-center__section" aria-labelledby="nexus-config-player-title">
      <div class="tool-section-head">
        <h2 id="nexus-config-player-title" class="tool-section-title">
          {{ $t('dialogs.configDetail.player') }}<small>{{ playerTotal.toLocaleString('zh-CN') }}</small>
        </h2>
        <p class="tool-section-hint">
          <span v-if="playerLoading" class="tool-inline-spinner" aria-hidden="true"></span>
          {{ playerLoading ? $t('ui.loadingVariant3') : $t('ui.sortedByUsageReviewDetailsBeforeUsing') }}
        </p>
      </div>

      <div
        v-if="playerPageData.records.length || playerLoading"
        class="nexus-config-center__table"
        role="table"
        :aria-label="$t('dialogs.configDetail.player')"
        :aria-busy="playerLoading"
      >
        <div class="nexus-config-center__tr is-head" role="row">
          <span role="columnheader">{{ $t('ui.rank') }}</span>
          <span role="columnheader">{{ $t('ui.configuration') }}</span>
          <span role="columnheader">{{ $t('localMod.author') }}</span>
          <span role="columnheader" class="is-num">{{ $t('ui.uses') }}</span>
          <span role="columnheader">{{ $t('taskCenter.table.updated') }}</span>
          <span role="columnheader" class="is-ops">{{ $t('ui.actions') }}</span>
        </div>

        <template v-if="!playerPageData.records.length">
          <div v-for="index in 3" :key="index" class="nexus-config-center__tr" aria-hidden="true">
            <span class="tool-skeleton is-short"></span>
            <span class="tool-skeleton is-line"></span>
            <span class="tool-skeleton is-short"></span>
          </div>
        </template>

        <div
          v-for="(profile, index) in playerPageData.records"
          :key="profile.id"
          class="nexus-config-center__tr"
          :class="{ 'is-active': isProfileActive(profile), 'is-loading': playerLoading }"
          role="row"
        >
          <span role="cell" class="nexus-config-center__rank">#{{ resolvePlayerRank(index) }}</span>
          <div role="cell" class="nexus-config-center__main">
            <div class="nexus-config-center__title-line">
              <span class="nexus-config-center__title">{{ profile.configName }}</span>
              <span v-if="profile.isMine" class="nexus-config-center__tag is-mine">{{ $t('ui.mine') }}</span>
            </div>
            <p
              v-if="profile.configDesc"
              class="nexus-config-center__desc"
              :title="profile.configDesc"
            >
              {{ profile.configDesc }}
            </p>
          </div>
          <span role="cell" class="nexus-config-center__owner">
            <span
              class="nexus-config-center__avatar"
              :style="{ background: ownerTone(profile) }"
              aria-hidden="true"
              >{{ ownerInitial(profile) }}</span
            >
            <span class="nexus-config-center__owner-name">{{
              resolveInstallConfigOwnerLabel(profile)
            }}</span>
          </span>
          <span role="cell" class="nexus-config-center__num">{{
            Number(profile.useCount || 0).toLocaleString('zh-CN')
          }}</span>
          <span
            role="cell"
            class="nexus-config-center__time"
            :title="formatInstallConfigTime(profile.updatedAt)"
            >{{ formatShortDate(profile.updatedAt) }}</span
          >
          <span role="cell" class="nexus-config-center__actions is-ops">
            <span v-if="isProfileActive(profile)" class="tool-status is-success">{{ $t('dialogs.configDetail.inUse') }}</span>
            <VxButton
              v-else
              variant="secondary"
              size="sm"
              class="nexus-config-center__use-btn"
              :loading="usingProfileKey === resolveProfileKey(profile)"
              :disabled="!!usingProfileKey && usingProfileKey !== resolveProfileKey(profile)"
              @click="handleUseProfile(profile)"
            >
              {{ $t('ui.use') }}
            </VxButton>
            <ToolIconButton
              icon="eye"
              size="sm"
              :label="$t('ui.viewDetailsOfValue', { value1: (profile.configName) })"
              @click="openDetail(profile)"
            />
            <ToolIconButton
              v-if="profile.canEdit"
              icon="edit"
              size="sm"
              :label="$t('ui.editValue', { value1: (profile.configName) })"
              @click="openEditWorkspace(profile.id)"
            />
            <ToolIconButton
              v-if="profile.canDelete"
              icon="trash"
              size="sm"
              class="nexus-config-center__delete"
              :label="$t('ui.deleteValue', { value1: (profile.configName) })"
              @click="confirmDeleteProfile(profile)"
            />
          </span>
        </div>

        <div v-if="playerRangeText" class="nexus-config-center__tfoot">
          <span>{{ playerRangeText }}</span>
          <nav
            v-if="playerPageCount > 1"
            class="nexus-config-center__pager"
            :aria-label="$t('ui.communityConfigurationPages')"
          >
            <button
              type="button"
              class="nexus-config-center__page"
              :disabled="playerCurrentPage <= 1 || playerLoading"
              @click="changePlayerPage(playerCurrentPage - 1)"
            >
              {{ $t('modBrowser.previous') }}
            </button>
            <button
              v-for="page in playerPageNumbers"
              :key="page"
              type="button"
              class="nexus-config-center__page is-number"
              :class="{ 'is-current': page === playerCurrentPage }"
              :aria-current="page === playerCurrentPage ? 'page' : undefined"
              :disabled="playerLoading"
              @click="changePlayerPage(page)"
            >
              {{ page }}
            </button>
            <button
              type="button"
              class="nexus-config-center__page"
              :disabled="playerCurrentPage >= playerPageCount || playerLoading"
              @click="changePlayerPage(playerCurrentPage + 1)"
            >
              {{ $t('modBrowser.next') }}
            </button>
          </nav>
        </div>
      </div>

      <ToolEmpty
        v-else
        compact
        icon="upload"
        :title="$t('ui.noCommunityConfigurationsYet')"
        :description="$t('ui.uploadTheRulesYouHaveConfiguredSoOtherPlayersCan')"
      >
        <VxButton
          variant="secondary"
          size="sm"
          class="nexus-config-center__empty-btn"
          :loading="myStatusLoading"
          @click="openCreateWorkspace"
        >
          {{ uploadActionText }}
        </VxButton>
      </ToolEmpty>
    </section>

    <NexusConfigDetailDrawer
      :open="isDetailOpen"
      :loading="workspace.loading"
      :profile="workspace.profile"
      :active="!workspace.loading && isProfileActive(workspace.profile)"
      :using="!!usingProfileKey && usingProfileKey === resolveProfileKey(workspace.profile)"
      :use-disabled="!!usingProfileKey && usingProfileKey !== resolveProfileKey(workspace.profile)"
      @update:open="handleWorkspaceOpenChange"
      @use="handleUseProfile"
      @clone="handleCloneProfile"
    />

    <NexusConfigUploadDialog
      :open="isUploadOpen"
      :mode="workspace.mode === WORKSPACE_MODE.EDIT ? 'edit' : 'create'"
      :loading="workspace.loading"
      :saving="workspace.saving"
      :profile="workspace.profile"
      :editor-rule-json-text="currentRuleJsonText"
      :game-context="gameContext"
      @update:open="handleWorkspaceOpenChange"
      @submit="handleSubmitWorkspace"
      @edit-rules="handleEditRules"
    />

    <VxConfirmModal
      v-model="confirmDialog.open"
      :title="confirmDialog.title"
      :content="confirmDialog.content"
      :confirm-text="confirmDialog.confirmText"
      :cancel-text="confirmDialog.cancelText"
      :danger="confirmDialog.danger"
      :confirm-action="confirmDialog.action"
      @confirm="settleConfirm(true)"
      @close="settleConfirm(false)"
    />
  </div>
</template>

<style scoped lang="scss">
.nexus-config-center {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
}

.nexus-config-center__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.nexus-config-center__header-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.nexus-config-center__header-value {
  flex: 1;
  min-width: 0;
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.nexus-config-center__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

// ===== 官方配置 =====
.nexus-config-center__official-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.nexus-config-center__official {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) 14px;
  padding: 14px var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &.is-active {
    background: color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white));
    border-color: color-mix(in srgb, var(--color-accent) 36%, var(--color-white));
  }
}

.nexus-config-center__official-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
  border-radius: 10px;
}

.nexus-config-center__main {
  display: flex;
  flex: 1 1 260px;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.nexus-config-center__title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px var(--space-2);
  min-width: 0;
}

.nexus-config-center__title {
  min-width: 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-base);
  overflow-wrap: anywhere;
}

.nexus-config-center__tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  border-radius: var(--radius-sm);

  &.is-recommend {
    color: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
    background: var(--color-warning-soft);
  }

  &.is-mine {
    color: var(--color-accent-strong);
    background: var(--color-accent-soft);
  }
}

.nexus-config-center__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-3);
  color: var(--color-text-muted);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;

  span + span::before {
    margin-right: var(--space-3);
    content: '·';
  }
}

.nexus-config-center__desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  line-height: var(--line-height-base);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.nexus-config-center__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.nexus-config-center__use-btn {
  min-width: 60px;
}

// ===== 玩家配置表格 =====
.nexus-config-center__table {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.nexus-config-center__tr {
  display: grid;
  grid-template-columns: 48px minmax(0, 2fr) minmax(100px, 0.8fr) 84px 96px 168px;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--color-border);
  transition: background var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-head) {
    background: var(--color-surface-soft);
  }

  &.is-head {
    min-height: 36px;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    background: var(--color-surface-soft);
    border-top: 0;
  }

  &.is-active {
    background: color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white));
  }

  &.is-loading {
    opacity: 0.6;
  }

  .is-num {
    text-align: right;
  }

  .is-ops {
    justify-content: flex-end;
    text-align: right;
  }

  .tool-skeleton.is-line {
    height: 12px;
  }

  .tool-skeleton.is-short {
    width: 60%;
    height: 10px;
  }
}

.nexus-config-center__rank {
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.nexus-config-center__owner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.nexus-config-center__avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--color-white);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  border-radius: 50%;
}

.nexus-config-center__owner-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nexus-config-center__num,
.nexus-config-center__time {
  font-variant-numeric: tabular-nums;
}

.nexus-config-center__num {
  text-align: right;
}

.nexus-config-center__time {
  color: var(--color-text-tertiary);
}

.nexus-config-center__delete:hover:not(:disabled) {
  color: var(--color-danger-strong);
}

.nexus-config-center__tfoot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 44px;
  padding: 6px var(--space-4);
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-border);
}

.nexus-config-center__pager {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nexus-config-center__page {
  min-width: 28px;
  height: 28px;
  padding: 0 var(--space-2);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--color-text-subtle);
    cursor: not-allowed;
  }

  &.is-current {
    color: var(--color-white);
    font-weight: var(--font-weight-semibold);
    background: var(--color-text);
  }
}

.nexus-config-center__skeleton {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 10px;

  .tool-skeleton.is-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }

  .tool-skeleton.is-line {
    width: 40%;
    height: 14px;
  }
}

// ===== 窄窗口：表格改为两行卡片 =====
@media (max-width: 1100px) {
  .nexus-config-center__tr:not(.is-head) {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    grid-template-areas:
      'rank main ops'
      'rank owner ops';
    row-gap: 4px;

    .nexus-config-center__rank {
      grid-area: rank;
    }

    .nexus-config-center__main {
      grid-area: main;
    }

    .nexus-config-center__owner {
      grid-area: owner;
    }

    .nexus-config-center__num,
    .nexus-config-center__time {
      display: none;
    }

    .is-ops {
      grid-area: ops;
    }
  }

  .nexus-config-center__tr.is-head {
    display: none;
  }
}
</style>
