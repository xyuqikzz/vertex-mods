<script setup>
const { t: uiText } = useI18n()

import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { gamePresentation } from '@renderer/i18n/content.js'
import PageBody from '@renderer/component/page-body.vue'
import UnifiedModHeader from '../component/unifiedModList/UnifiedModHeader.vue'
import UnifiedModSearchBar from '../component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '../component/unifiedModList/UnifiedModListGrid.vue'
import { useSourceDescriptionTranslation } from '@renderer/composables/source-description-translation.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { createGamebananaClient } from '@renderer/utils/gamebanana-api.js'
import { createWorkshopClient } from '@renderer/utils/steam-workshop-api.js'
import { getCommunityGameUrl } from '../../../../../shared/sources/community-source.js'
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'
import { buildGameSiteDetailRoute, normalizeSiteDetailQueryValue } from '../site-detail-route.js'
import { publicGameKey } from '../../../../../shared/games/game-rule-support.js'
import { useCommunityInstall } from './useCommunityInstall.js'
import { VxConfirmModal } from '@renderer/component/vertex-ui'
import CommunityInstallDialog from './CommunityInstallDialog.vue'
import ModSourceProfileModal from '../component/profile/mod-source-profile-modal.vue'

// KeepAlive 中的其他列表不应跟随全局路由切换游戏。
const { t, locale } = useI18n()
const currentRoute = useRoute()
const route = {
  ...currentRoute,
  params: { ...currentRoute.params },
  query: { ...currentRoute.query }
}
const router = useRouter()
const { setMenuName } = useMenuName()
const source = String(route.params.source)
const gameId = String(route.params.id)
const sourceLabel = resolveSourcePlatformLabel(source)
const gameName = normalizeSiteDetailQueryValue(route.query.gameName) || gameId
const gameCover = normalizeSiteDetailQueryValue(route.query.cover)
const gameSubtitle =
  normalizeSiteDetailQueryValue(route.query.englishTitle) || uiText('ui.valueGame', { value1: (sourceLabel) })
const gameIdentity = { name: gameName, englishTitle: normalizeSiteDetailQueryValue(route.query.englishTitle) }
const gameDisplay = computed(() => gamePresentation(gameIdentity))
const install = reactive(
  useCommunityInstall({
    source,
    sourceGameId: gameId,
    gameName,
    cover: gameCover,
    publicGameKey:
      normalizeSiteDetailQueryValue(route.query.publicGameKey) ||
      publicGameKey({ englishTitle: gameSubtitle })
  })
)
const profileDelete = ref({ open: false, name: '' })
const client = source === 'gamebanana' ? createGamebananaClient() : createWorkshopClient()
const keywordInput = ref('')
const keyword = ref('')
const loading = ref(false)
const errorText = ref('')
const page = ref({ records: [], total: 0, pages: 1, current: 1, size: 20 })
const systemConfig = ref({})
let controller
let requestedPage = 1
let disposed = false
let skippedInitialActivation = false

const modTranslations = useSourceDescriptionTranslation({
  source,
  systemConfig,
  entries: computed(() =>
    page.value.records.flatMap((record) => [
      {
        id: `${record.id}:title`,
        text: record.name,
        kind: 'mod_name',
        context: uiText('ui.gameValueVariant3', { value1: (gameName) })
      },
      {
        id: `${record.id}:description`,
        text: record.description,
        kind: 'mod_summary',
        context: uiText('ui.gameValueModValue', { value1: (gameName), value2: (record.name) })
      }
    ])
  )
})

const headerStats = computed(() => [
  {
    label: keyword.value ? t('modBrowser.searchResults') : t('modBrowser.count'),
    value: loading.value || errorText.value ? '--' : page.value.total.toLocaleString(locale.value),
    accent: true
  }
])
const listNotice = computed(() => ({
  show: Boolean(errorText.value) || page.value.network?.mode === 'cache',
  title: errorText.value ? t('modBrowser.listFailed') : t('modBrowser.cached'),
  text: errorText.value || [
    t('modBrowser.updatedAt', { time: new Date(page.value.network?.updatedAt).toLocaleString(locale.value) }),
    page.value.network?.message || (loading.value ? t('modBrowser.refreshHint') : t('modBrowser.verifyHint'))
  ].join('。'),
  actionText: t('modBrowser.retry')
}))

const items = computed(() =>
  page.value.records.map((record) => ({
    ...record,
    title: record.name,
    translatedTitle: modTranslations.getText(`${record.id}:title`),
    translatedDescription: modTranslations.getText(`${record.id}:description`),
    translationTag:
      modTranslations.getText(`${record.id}:title`) ||
      modTranslations.getText(`${record.id}:description`)
        ? '译'
        : '',
    cover: record.image,
    subtitle: record.author ? t('modBrowser.author', { name: record.author }) : '',
    tags: record.tags || [record.category, record.version && `v${record.version}`].filter(Boolean),
    installable: true,
    installedText: install.installedFor(record.id).length
      ? t('modBrowser.installedFiles', { count: install.installedFor(record.id).length })
      : '',
    installText: install.hasRule
      ? install.installedFor(record.id).length
        ? t('modBrowser.reinstall')
        : t('modBrowser.install')
      : t('modBrowser.download'),
    installDisabled:
      install.contextBusy || install.operationBusy || (install.hasRule && !install.canInstall),
    installing: Boolean(install.busy[record.id]),
    installingText: t('modBrowser.submitting'),
    secondaryText: install.hasRule ? t('modBrowser.download') : '',
    secondaryDisabled: Boolean(install.busy[record.id])
  }))
)

async function loadPage(number = 1) {
  controller?.abort()
  const request = new AbortController()
  controller = request
  requestedPage = number
  loading.value = true
  errorText.value = ''
  try {
    const options = { gameId, keyword: keyword.value, page: number }
    const cached = await client.cachedList?.(options, request.signal).catch(() => null)
    if (request.signal.aborted) return
    if (cached) page.value = cached
    const result = await client.list(
      options,
      request.signal
    )
    if (!request.signal.aborted) page.value = result
  } catch (error) {
    if (!request.signal.aborted) errorText.value = error.message || t('modBrowser.listFailed')
  } finally {
    if (controller === request) loading.value = false
  }
}

function search() {
  keyword.value = keywordInput.value.trim()
  loadPage(1)
}

function handleKeywordChange(value) {
  keywordInput.value = value
  if (!value && keyword.value) search()
}

function openPage(item) {
  router.push(
    buildGameSiteDetailRoute({
      url: item?.url || getCommunityGameUrl(source, gameId),
      title: item?.name || gameName,
      source: sourceLabel,
      sourceKey: source,
      sourceGameId: gameId,
      gameName,
      appId: source === 'steam-workshop' ? gameId : '',
      modId: item?.id || '',
      backPath: route.fullPath
    })
  )
}

function handleHeaderAction(key) {
  if (key === 'manage') {
    router.push({ name: 'GameModManagement', params: { source, id: gameId }, query: {
      name: gameName, englishTitle: gameIdentity.englishTitle, cover: gameCover, appId: String(install.context.appId || ''),
      sourceSlug: install.context.sourceMeta?.sourceSlug || '', profile: install.profiles.activeProfileName,
      rootPath: install.context.game?.rootPath || ''
    } })
    return
  }
  if (key === 'back') router.push('/app/game')
  if (key === 'source') openPage()
  install.headerAction(key)
}

onMounted(async () => {
  setMenuName(() => `${sourceLabel} - ${gameDisplay.value.title}`)
  install.loadContext()
  try {
    systemConfig.value = await requestSystemConfigSettings({})
  } catch (failure) {
    console.warn('[社区模组] 读取翻译设置失败，使用默认语言', failure?.message || failure)
  }
  if (!disposed) loadPage()
})
onActivated(() => {
  if (!skippedInitialActivation) {
    skippedInitialActivation = true
    return
  }
  // 返回列表只更新安装状态，保留当前搜索、分页和已加载的卡片。
  install.refreshInstalled()
})
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
})

defineOptions({ name: 'GameCommunityModList' })
</script>

<template>
  <PageBody class="community-mod-list">
    <UnifiedModHeader
      :rule-ai-context="{ sourcePlatform: source, gameName, sourceGameId: gameId, appId: source === 'steam-workshop' ? gameId : install.context.appId, publicGameKey: install.context.document?.gameKey || normalizeSiteDetailQueryValue(route.query.publicGameKey) || publicGameKey({ englishTitle: gameSubtitle }) }"
      :rule-ai-missing="!install.contextBusy && install.context.state === 'no_rule' && !install.hasRule"
      :cover-image="gameCover"
      :title="gameDisplay.title"
      :subtitle="gameDisplay.subtitle"
      :stats="headerStats"
      :status-text="install.statusText"
      :status-type="install.canInstall ? 'success' : 'warning'"
      :status-sub-text="install.context.message || ''"
      :actions="install.headerActions"
      :dlss-context="install.dlssContext"
      @action="handleHeaderAction"
    />
    <UnifiedModSearchBar
      :keyword="keywordInput"
      :keyword-placeholder="t('modBrowser.searchPlaceholder')"
      :show-sort="false"
      :loading="loading"
      @update:keyword="handleKeywordChange"
      @search="search"
    />
    <UnifiedModListGrid
      :notice="listNotice"
      :items="items"
      :loading="loading"
      :current="page.current"
      :pages="page.pages"
      :total="page.total"
      :size="page.size || 20"
      :show-pagination="!loading && !errorText && page.pages > 1"
      @notice-action="loadPage(requestedPage)"
      @open-detail="openPage"
      @install="install.primary"
      @secondary-action="(item) => install.primary(item, 'download')"
      @page-change="loadPage"
    />
    <ModSourceProfileModal
      :open="install.profileOpen"
      :active-profile-name="install.profiles.activeProfileName"
      :profile-options="install.profiles.profileOptions"
      :profile-mod-count="install.installed.length"
      :profile-switching="install.operationBusy"
      :profile-operation-locked="install.operationBusy"
      :show-transfer-actions="false"
      @close="install.profileOpen = false"
      @switch-profile="install.switchProfile"
      @confirm-create-profile="install.createProfile"
      @rename-profile="install.renameProfile"
      @delete-profile="(name) => (profileDelete = { open: true, name })"
    />
    <VxConfirmModal
      v-model="profileDelete.open"
      :title="t('modBrowser.deleteProfile')"
      danger
      :description="t('modBrowser.deleteProfileDescription', { name: profileDelete.name })"
      :confirm-action="() => install.deleteProfile(profileDelete.name)"
      :confirm-text="t('modBrowser.confirm')"
      :cancel-text="t('modBrowser.cancel')"
    />
    <CommunityInstallDialog
      :open="install.files.open"
      :mode="install.files.mode"
      :detail="install.files.detail"
      :busy="install.files.busy"
      :error="install.files.error"
      :source="source"
      :source-label="sourceLabel"
      :game-name="gameDisplay.title"
      :has-rule="install.hasRule"
      :can-install="install.canInstall"
      :profile-name="install.profiles.activeProfileName"
      @submit="(file, mode) => install.submit(install.files.detail, file, mode)"
      @close="install.closeFiles"
    />
  </PageBody>
</template>
