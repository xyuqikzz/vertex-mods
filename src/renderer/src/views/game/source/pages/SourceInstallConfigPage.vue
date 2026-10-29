<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { ToolIcon, ToolNotice } from '@renderer/component/tool-page'
import {
  getRuleEditorDraft,
  setRuleEditorDraft,
  clearRuleEditorDraft
} from '@renderer/utils/rule-editor-drafts.js'
import { $message } from '@renderer/common/message.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useUserStore } from '@renderer/store/userStore.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import SourceInstallConfigCenter from '../component/SourceInstallConfigCenter.vue'
import SourceRuleEditorWorkspace from '../component/SourceRuleEditorWorkspace.vue'
import { summarizeInstallRuleText } from '../install-rule-outline.js'
import {
  buildInstallConfigVersionWarningText,
  shouldWarnInstallConfigVersion
} from '@views/game/nexus/nexus-config-profile-utils.js'
import {
  resolveSourceInstallConfigPlatform,
  useSourceInstallConfigPage,
  validateSourceInstallConfigEditorText
} from '../useSourceInstallConfigPage.js'

// 安装配置页（方案 B）：页头显示当前生效配置，「选择配置 / 编辑规则」两个页签，
// 页签记在地址参数 ?tab= 里。规格见 Vertex 项目文档《安装配置页 UI 重设计方案》。
const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const userStore = useUserStore()
const { setMenuName: setPageMenuName } = useMenuName()
const aiPageContextProvider = useAiPageContextProvider(route)
const pagePath = route.path

const sourcePlatform = resolveSourceInstallConfigPlatform(route)
const pageState = useSourceInstallConfigPage({
  sourcePlatform,
  routeId: route.params.id,
  routeQuery: route.query
})
const draftKey = `${sourcePlatform}:${route.params.id}`
const editorBaseline = ref('')
const editorInitialized = ref(false)
const hasDraft = computed(
  () => editorInitialized.value && pageState.editorText.value !== editorBaseline.value
)
watch(
  pageState.editorText,
  (text) => {
    if (editorInitialized.value) setRuleEditorDraft(draftKey, text, editorBaseline.value)
  },
  { flush: 'sync' }
)
function acceptEditorState() {
  editorBaseline.value = pageState.editorText.value
  clearRuleEditorDraft(draftKey)
}

// ===== 确认弹窗（VxConfirmModal 的 Promise 封装） =====
const confirmDialog = ref(createConfirmDialogState())
let confirmResolver = null

function createConfirmDialogState() {
  return {
    open: false,
    title: '',
    content: '',
    get confirmText() { return uiText('ui.confirm') },
    get cancelText() { return uiText('ui.cancel') },
    danger: false
  }
}

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

async function confirmReplaceDraft() {
  if (!hasDraft.value) return true
  return askConfirm({
    get title() { return uiText('ui.replaceUnsavedChanges') },
    content:
      '切换配置会覆盖「编辑规则」里还没保存的修改。想留着这些修改，请先回到编辑规则保存到本地。',
    get confirmText() { return uiText('ui.discardChangesAndSwitch') },
    get cancelText() { return uiText('ui.keepEditing') },
    danger: true
  })
}

function publishMenuName() {
  setPageMenuName(`安装配置 - ${pageState.gameBaseInfo.value.name}`)
}

// ===== 页签 =====
const TABS = Object.freeze([
  {
    key: 'configs',
    name: '选择配置',
    icon: 'list',
    get hint() { return uiText('ui.chooseAConfigurationToUseDirectlyOpenEditRulesTo') }
  },
  {
    key: 'editor',
    name: '编辑规则',
    icon: 'code',
    get hint() { return uiText('ui.savedRulesApplyOnlyOnThisComputerUseUploadMy') }
  }
])
const tabRefs = ref([])
const editorWorkspaceRef = ref(null)
const configCenterRef = ref(null)
const guideOpen = ref(true)

function resolveTabKey(value) {
  return TABS.some((tab) => tab.key === value) ? value : 'configs'
}

const activeTab = ref(resolveTabKey(route.query.tab))
const activeTabMeta = computed(() => TABS.find((tab) => tab.key === activeTab.value) || TABS[0])

function selectTab(key) {
  const nextKey = resolveTabKey(key)
  if (nextKey === activeTab.value) return
  activeTab.value = nextKey
  // 菜单页签按去掉 tab 参数的地址识别（utils/menu-route-key.js），这里只同步菜单记住的完整地址。
  router
    .replace({ query: { ...route.query, tab: nextKey } })
    .then(() => publishMenuName())
    .catch(() => {})
  if (nextKey === 'editor') editorWorkspaceRef.value?.refresh()
}

// 页签按 WAI-ARIA tabs 模式：左右方向键、Home、End 切换并移动焦点。
function handleTabKeydown(event, index) {
  const count = TABS.length
  const next = {
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index - 1 + count) % count,
    Home: 0,
    End: count - 1
  }[event.key]
  if (next === undefined) return
  event.preventDefault()
  selectTab(TABS[next].key)
  nextTick(() => tabRefs.value[next]?.focus())
}

watch(
  () => route.query.tab,
  (value) => {
    if (route.path !== pagePath || !value) return
    const nextKey = resolveTabKey(value)
    if (nextKey !== activeTab.value) {
      activeTab.value = nextKey
      if (nextKey === 'editor') editorWorkspaceRef.value?.refresh()
    }
  }
)

// ===== 当前生效配置 =====
const SCOPE_META = Object.freeze({
  official: { get label() { return uiText('ui.official') }, tone: 'is-accent' },
  player: { get label() { return uiText('ui.community') }, tone: '' },
  local: { get label() { return uiText('ui.localChanges') }, tone: 'is-warning' },
  none: { get label() { return uiText('dialogs.vamCookie.notSet') }, tone: 'is-warning' }
})

const effectiveScope = computed(() => {
  const snapshot = pageState.activeProfileSnapshot.value || null
  const scope = String(snapshot?.configScope || snapshot?.sourceType || '').trim()
  if (scope === 'player' || scope === 'player_profile') return 'player'
  if (scope === 'official' || scope === 'official_profile') return 'official'
  if (scope === 'local_override') return 'local'
  if (pageState.hasLocalOverride.value) return 'local'
  if (pageState.currentRule.value) return 'official'
  return 'none'
})

const effectiveScopeMeta = computed(() => SCOPE_META[effectiveScope.value] || SCOPE_META.none)

const effectiveName = computed(() => {
  if (effectiveScope.value === 'local') return '本地规则'
  const snapshotName = String(pageState.activeProfileSnapshot.value?.configName || '').trim()
  if (snapshotName && effectiveScope.value !== 'none') return snapshotName
  const officialName = String(pageState.fallbackOfficialProfile?.value?.configName || '').trim()
  if (effectiveScope.value === 'official' && officialName) return officialName
  const sourceText = String(pageState.currentRuleSourceText.value || '').trim()
  return sourceText.replace(/^(官方配置|玩家配置)：/, '') || '未配置规则'
})

const effectiveSummary = computed(() => {
  const summary = summarizeInstallRuleText(pageState.currentRuleJsonText.value)
  const parts = []
  if (summary.ruleCount) parts.push(uiText('ui.valueRules', { value1: (summary.ruleCount) }))
  if (summary.schemaVersion) parts.push(uiText('ui.ruleVersionValue', { value1: (summary.schemaVersion) }))
  return parts.join(' · ')
})

const canRestoreOfficial = computed(() => {
  if (effectiveScope.value !== 'local') return false
  const hasCloud = pageState.hasCloudRule?.value
  if (typeof hasCloud === 'boolean') return hasCloud
  return !!(pageState.cloudRule?.value || pageState.fallbackOfficialProfile?.value)
})

const restoring = ref(false)
const uploadActionText = computed(() => configCenterRef.value?.uploadActionText || '上传我的配置')
const uploadLoading = computed(() => !!configCenterRef.value?.myStatusLoading)

function openUpload() {
  configCenterRef.value?.openCreateWorkspace()
}

const validationError = computed(() => {
  const validation = validateSourceInstallConfigEditorText(
    sourcePlatform,
    pageState.editorText.value
  )
  return validation.valid ? '' : validation.message
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function pickFirstSafeText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveConfigSourceGameId(gameBaseInfo = {}, gameContext = {}) {
  return toSafeText(
    gameBaseInfo.nexusGameId ||
      gameBaseInfo.modioGameId ||
      gameBaseInfo.backendGameId ||
      gameContext.gameId ||
      route.params.id
  )
}

function resolveConfigSourceSlug(gameBaseInfo = {}, gameContext = {}) {
  return toSafeText(
    gameContext.domainName || gameBaseInfo.domainName || gameBaseInfo.nameId || route.params.id
  )
}

function resolveConfigInstallRoot(gameBaseInfo = {}, gameContext = {}, activeProfile = {}) {
  return pickFirstSafeText(
    activeProfile?.installRoot,
    activeProfile?.gameRoot,
    activeProfile?.gameRootPath,
    activeProfile?.clientRootPath,
    gameContext.installRoot,
    gameContext.gameRoot,
    gameContext.gameRootPath,
    gameContext.clientRootPath,
    gameBaseInfo.installRoot,
    gameBaseInfo.gameRoot,
    gameBaseInfo.gameRootPath,
    gameBaseInfo.clientRootPath
  )
}

function resolveConfigRuleVersion(currentRule = {}, activeProfile = {}) {
  return pickFirstSafeText(
    currentRule?.schema_version,
    currentRule?.schemaVersion,
    currentRule?.ruleVersion,
    activeProfile?.schema_version,
    activeProfile?.schemaVersion,
    activeProfile?.ruleVersion
  )
}

function publishSourceInstallConfigAiPageContext() {
  const gameBaseInfo = pageState.gameBaseInfo.value || {}
  const gameContext = pageState.gameContext.value || {}
  const currentRule = pageState.currentRule.value || null
  const activeProfile = pageState.activeProfileSnapshot.value || null
  const sourceGameId = resolveConfigSourceGameId(gameBaseInfo, gameContext)
  const sourceSlug = resolveConfigSourceSlug(gameBaseInfo, gameContext)
  const ruleConfigured = Boolean(currentRule)
  const profileName = pickFirstSafeText(
    activeProfile?.configName,
    pageState.currentRuleSourceText.value
  )
  const ruleSource = pickFirstSafeText(
    activeProfile?.sourceType,
    currentRule?.sourceType,
    currentRule?.source,
    ruleConfigured ? 'official' : 'missing'
  )
  const ruleVersion = resolveConfigRuleVersion(currentRule || {}, activeProfile || {})
  const installRoot = resolveConfigInstallRoot(gameBaseInfo, gameContext, activeProfile || {})
  const bindingConfigured = Boolean(
    installRoot ||
      gameContext.bindingConfigured ||
      gameContext.gameRootConfigured ||
      gameBaseInfo.bindingConfigured ||
      gameBaseInfo.gameRootConfigured
  )

  return aiPageContextProvider.update({
    displaySource: sourcePlatform,
    businessSource: sourcePlatform,
    sourceLabel: pageState.platformLabel,
    businessSourceLabel: pageState.platformLabel,
    page: {
      type: 'source_install_config',
      title: uiText('ui.valueInstallationConfiguration', { value1: (pageState.platformLabel) }),
      source: sourcePlatform,
      displaySource: sourcePlatform,
      businessSource: sourcePlatform,
      sourceLabel: pageState.platformLabel,
      businessSourceLabel: pageState.platformLabel
    },
    game: {
      source: sourcePlatform,
      name: toSafeText(gameBaseInfo.name || gameContext.gameName),
      sourceGameId,
      sourceSlug,
      gameId: toSafeText(gameContext.gameId || gameBaseInfo.backendGameId),
      steamAppId: toSafeText(gameContext.appId || gameBaseInfo.appId),
      domainName: sourceSlug,
      installRoot,
      gameRootConfigured: bindingConfigured,
      bindingConfigured,
      profileName
    },
    install: {
      ruleConfigured,
      bindingConfigured,
      installRoot,
      ruleStatus: {
        configured: ruleConfigured,
        source: ruleSource,
        ruleVersion,
        profileName
      },
      bindingStatus: {
        configured: bindingConfigured,
        source: sourcePlatform,
        installRoot,
        profileName
      },
      installDirectory: {
        installRoot
      },
      profileName,
      profile: {
        name: profileName,
        source: ruleSource,
        key: toSafeText(activeProfile?.profileKey)
      }
    },
    sourceState: {
      source: sourcePlatform,
      status: ruleConfigured ? 'active' : 'rule_missing',
      label: pageState.platformLabel,
      configured: ruleConfigured,
      summary: ruleConfigured
        ? uiText('ui.valueInstallationRulesConfigured', { value1: (pageState.platformLabel) })
        : uiText('ui.valueInstallationRulesNotConfigured', { value1: (pageState.platformLabel) })
    }
  })
}

async function handleSave() {
  if (!hasDraft.value || pageState.saveLoading.value) return
  try {
    await pageState.saveEditorRule()
    acceptEditorState()
    $message.success(uiMessage('ui.localConfigurationSaved'))
  } catch (error) {
    $message.warning(String(error?.message || '保存失败'))
  }
}

function handleDiscard() {
  pageState.editorText.value = editorBaseline.value
  clearRuleEditorDraft(draftKey)
}

async function handleUseOfficialRule() {
  if (restoring.value) return
  if (!(await confirmReplaceDraft())) return
  const currentVersion = String(appStore.AppData?.version || '').trim()
  const compatibilityTarget =
    pageState.fallbackOfficialProfile.value || pageState.cloudRule.value || {}
  if (shouldWarnInstallConfigVersion(compatibilityTarget, currentVersion)) {
    const shouldContinue = await askConfirm({
      get title() { return uiText('ui.thisConfigurationRequiresANewerVertexVersion') },
      content: buildInstallConfigVersionWarningText(compatibilityTarget, currentVersion),
      get confirmText() { return uiText('ui.useAnyway') }
    })
    if (!shouldContinue) return
  }
  restoring.value = true
  try {
    await pageState.useOfficialRule()
    acceptEditorState()
    $message.success(uiMessage('ui.switchedToOfficialConfiguration'))
  } catch (error) {
    $message.warning(String(error?.message || '切换失败'))
  } finally {
    restoring.value = false
  }
}

async function handleApplyProfile(payload = {}) {
  if (!(await confirmReplaceDraft())) return
  try {
    await pageState.applyInstallConfigProfile(payload)
    acceptEditorState()
    $message.success(uiMessage('ui.configurationSwitched'))
  } catch (error) {
    $message.warning(String(error?.message || '切换失败'))
  }
}

function handleRequireLogin() {
  $message.warning(uiMessage('ui.signInBeforeUsingACommunityConfiguration'))
}

watch(
  () =>
    [
      sourcePlatform,
      pageState.gameBaseInfo.value?.name,
      pageState.gameBaseInfo.value?.nexusGameId,
      pageState.gameBaseInfo.value?.modioGameId,
      pageState.gameBaseInfo.value?.backendGameId,
      pageState.gameBaseInfo.value?.domainName,
      pageState.gameBaseInfo.value?.nameId,
      pageState.currentRule.value?.ruleVersion,
      pageState.currentRuleSourceText.value,
      pageState.activeProfileSnapshot.value?.configName,
      validationError.value
    ].join('::'),
  () => {
    publishSourceInstallConfigAiPageContext()
  },
  { immediate: true }
)

onMounted(async () => {
  publishMenuName()
  await pageState.initializePage()
  editorBaseline.value = pageState.editorText.value
  const draft = getRuleEditorDraft(draftKey)
  if (draft !== undefined) {
    pageState.editorText.value = draft
    // 有暂存的草稿且没有指定页签时，直接回到编辑规则。
    if (!route.query.tab && draft !== editorBaseline.value) selectTab('editor')
  }
  editorInitialized.value = true
})

onActivated(() => {
  if (activeTab.value === 'editor') editorWorkspaceRef.value?.refresh()
})

onBeforeUnmount(() => {
  settleConfirm(false)
  aiPageContextProvider.clear()
})
</script>

<template>
  <PageBody :is-scroll-enabled="false">
    <section class="source-install-config-page" :aria-busy="pageState.pageLoading.value">
      <header class="source-install-config-page__head">
        <div class="source-install-config-page__heading">
          <div class="source-install-config-page__title-row">
            <h1 class="source-install-config-page__title">{{ $t('tools.installation') }}</h1>
            <span class="source-install-config-page__game">
              {{ pageState.platformLabel }} ·
              {{ pageState.gameBaseInfo.value?.name || route.params.id }}
            </span>
          </div>
          <div class="source-install-config-page__current" role="status">
            <span>{{ $t('ui.currentlyActive') }}</span>
            <span class="tool-tag" :class="effectiveScopeMeta.tone">{{
              effectiveScopeMeta.label
            }}</span>
            <strong class="source-install-config-page__current-name">{{ effectiveName }}</strong>
            <span v-if="effectiveSummary">· {{ effectiveSummary }}</span>
          </div>
        </div>
        <VxButton
          variant="secondary"
          size="sm"
          class="source-install-config-page__upload"
          :loading="uploadLoading"
          @click="openUpload"
        >
          <ToolIcon name="upload" :size="14" />
          {{ uploadActionText }}
        </VxButton>
      </header>

      <div class="source-install-config-page__bar">
        <div class="source-install-config-page__tabs" role="tablist" :aria-label="$t('tools.installation')">
          <button
            v-for="(tab, index) in TABS"
            :id="`source-install-config-tab-${tab.key}`"
            :key="tab.key"
            ref="tabRefs"
            type="button"
            role="tab"
            class="source-install-config-page__tab"
            :class="{ 'is-active': tab.key === activeTab }"
            :aria-selected="tab.key === activeTab"
            :aria-controls="`source-install-config-panel-${tab.key}`"
            :tabindex="tab.key === activeTab ? 0 : -1"
            @click="selectTab(tab.key)"
            @keydown="handleTabKeydown($event, index)"
          >
            <ToolIcon :name="tab.icon" />
            {{ tab.name }}
            <span
              v-if="tab.key === 'editor' && hasDraft"
              class="source-install-config-page__tab-dot"
              :title="$t('ui.unsavedChangesVariant2')"
            ></span>
            <span v-if="tab.key === 'editor' && hasDraft" class="tool-visually-hidden">
              {{ $t('ui.unsavedChangesVariant3') }}
            </span>
          </button>
        </div>
        <p class="source-install-config-page__hint">{{ activeTabMeta.hint }}</p>
      </div>

      <div
        v-show="activeTab === 'configs'"
        id="source-install-config-panel-configs"
        class="source-install-config-page__panel is-configs"
        role="tabpanel"
        aria-labelledby="source-install-config-tab-configs"
      >
        <ToolNotice v-if="pageState.pageLoading.value" tone="progress">
          {{ $t('tools.loadingInstallationConfiguration') }}
        </ToolNotice>
        <ToolNotice
          v-else-if="effectiveScope === 'local'"
          tone="warning"
          :title="$t('ui.yourLocallyModifiedRulesAreCurrentlyActive')"
        >
          {{ $t('ui.switchingToAnyConfigurationBelowWillReplaceYourLocalChanges') }}
          <template #actions>
            <VxButton variant="secondary" size="sm" @click="selectTab('editor')">{{ $t('ui.viewRules') }}</VxButton>
            <VxButton
              v-if="canRestoreOfficial"
              variant="secondary"
              size="sm"
              :loading="restoring"
              @click="handleUseOfficialRule"
            >
              {{ $t('ui.restoreOfficialRules') }}
            </VxButton>
          </template>
        </ToolNotice>

        <source-install-config-center
          ref="configCenterRef"
          embedded
          :show-header="false"
          :show-upload-action="false"
          :game-context="pageState.gameContext.value"
          :current-rule-json-text="pageState.currentRuleJsonText.value"
          :current-rule-source-text="pageState.currentRuleSourceText.value"
          :user-logged-in="userStore.isLogin"
          :active-profile-snapshot="pageState.activeProfileSnapshot.value"
          :fallback-official-profile="pageState.fallbackOfficialProfile.value"
          :has-local-override="pageState.hasLocalOverride.value"
          @require-login="handleRequireLogin"
          @apply-profile="handleApplyProfile"
          @edit-rules="selectTab('editor')"
        />
      </div>

      <div
        v-show="activeTab === 'editor'"
        id="source-install-config-panel-editor"
        class="source-install-config-page__panel is-editor"
        role="tabpanel"
        aria-labelledby="source-install-config-tab-editor"
      >
        <ToolNotice v-if="pageState.pageLoading.value" tone="progress"> {{ $t('ui.loadingRules') }} </ToolNotice>
        <source-rule-editor-workspace
          ref="editorWorkspaceRef"
          v-model="pageState.editorText.value"
          v-model:guide-open="guideOpen"
          :current-source-text="pageState.currentRuleSourceText.value"
          :validation-error="validationError"
          :save-loading="pageState.saveLoading.value || restoring"
          :dirty="hasDraft"
          :can-restore-official="canRestoreOfficial"
          @save="handleSave"
          @discard="handleDiscard"
          @use-official="handleUseOfficialRule"
        />
      </div>
    </section>

    <VxConfirmModal
      v-model="confirmDialog.open"
      :title="confirmDialog.title"
      :content="confirmDialog.content"
      :confirm-text="confirmDialog.confirmText"
      :cancel-text="confirmDialog.cancelText"
      :danger="confirmDialog.danger"
      @confirm="settleConfirm(true)"
      @close="settleConfirm(false)"
    />
  </PageBody>
</template>

<style scoped lang="scss">
.source-install-config-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

// ===== 页头 =====
.source-install-config-page__head {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-5) var(--space-7) var(--space-1);
}

.source-install-config-page__heading {
  display: flex;
  flex: 1 1 420px;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.source-install-config-page__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.source-install-config-page__title {
  margin: 0;
  color: var(--color-text);
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
}

.source-install-config-page__game {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.source-install-config-page__current {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);

  .tool-tag.is-warning {
    color: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
    background: var(--color-warning-soft);
  }
}

.source-install-config-page__current-name {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.source-install-config-page__upload :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

// ===== 页签 =====
.source-install-config-page__bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0 var(--space-6);
  padding: 0 var(--space-7);
  border-bottom: 1px solid var(--color-border);
}

.source-install-config-page__tabs {
  display: flex;
  gap: 0 var(--space-7);
}

.source-install-config-page__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: 0;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  :deep(.tool-icon) {
    color: var(--color-text-muted);
  }

  &::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    background: transparent;
    border-radius: 2px;
    content: '';
  }

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &.is-active {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);

    :deep(.tool-icon) {
      color: var(--color-accent-active);
    }

    &::after {
      background: var(--color-accent);
    }
  }
}

.source-install-config-page__tab-dot {
  width: 6px;
  height: 6px;
  background: var(--color-warning);
  border-radius: 50%;
}

.source-install-config-page__hint {
  display: flex;
  align-items: center;
  margin: 0 0 0 auto;
  padding: var(--space-2) 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
}

// ===== 内容区 =====
.source-install-config-page__panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;

  &.is-configs {
    padding: var(--space-5) var(--space-7) var(--space-8);
    overflow-x: hidden;
    overflow-y: auto;

    &::-webkit-scrollbar {
      width: 7px;
    }

    &::-webkit-scrollbar-track {
      background: var(--scrollbar-track-color);
      border-radius: var(--radius-sm);
      margin: var(--space-4) 0;
    }

    &::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb-color);
      border-radius: 4px;
      min-height: 40px;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover);
    }
  }

  &.is-editor {
    gap: var(--space-3);
    padding: var(--space-4) var(--space-7) var(--space-6);
    overflow: hidden;
  }
}

@media (max-width: 960px) {
  .source-install-config-page__head,
  .source-install-config-page__bar {
    padding-right: var(--space-5);
    padding-left: var(--space-5);
  }

  .source-install-config-page__panel.is-configs,
  .source-install-config-page__panel.is-editor {
    padding-right: var(--space-5);
    padding-left: var(--space-5);
  }

  .source-install-config-page__hint {
    display: none;
  }
}
</style>
