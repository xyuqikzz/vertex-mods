<script setup>
const { t: uiText } = useI18n()

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolEmpty, ToolIcon, ToolIconButton, ToolNotice } from '@renderer/component/tool-page'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { usesChineseContent } from '@renderer/i18n/content-policy.js'
import { normalizeSiteDetailQueryValue } from './site-detail-route.js'
import {
  isActiveSourcePlatform,
  resolveSourcePlatformLabel
} from '../../../../shared/sources/source-platform-registry.js'
import CommunitySiteActions from './component/CommunitySiteActions.vue'
import SiteTranslationControl from './component/SiteTranslationControl.vue'

// 规格见 Vertex 项目文档《站点详情页 UI 重设计方案》（2026-10-25）。
const props = defineProps({ pageRoute: Object, active: { type: Boolean, default: true } })
// 标签身份一经创建即固定，不能随着其他标签的全局路由改变网址和标题。
const initialRoute = props.pageRoute || useRoute()
const route = { ...initialRoute, query: { ...initialRoute.query } }
const router = useRouter()
const appStore = useAppStore()
const { t, locale } = useI18n()
const aiPageContextProvider = useAiPageContextProvider(route)

const COMMUNITY_SOURCES = ['gamebanana', 'steam-workshop']

const webviewRef = ref(null)
const stageRef = ref(null)
const translationRef = ref(null)
const errorText = ref('')
const errorUrl = ref('')
const currentUrl = ref('')
const remoteWebContentsId = ref(0)
const webviewSize = ref({ width: 0, height: 0 })
const loading = ref(false)
const opening = ref(true)
const canGoBack = ref(false)
const canGoForward = ref(false)
const livePageTitle = ref('')
const translationError = ref('')
const downloadError = ref('')
const cleanupList = []
let stageResizeObserver = null

const pageInfo = computed(() => {
  return {
    url: normalizeSiteDetailQueryValue(route.query?.url),
    title: normalizeSiteDetailQueryValue(route.query?.title),
    subtitle: normalizeSiteDetailQueryValue(route.query?.subtitle),
    source: normalizeSiteDetailQueryValue(route.query?.source),
    sourceKey: normalizeSiteDetailQueryValue(route.query?.sourceKey),
    displaySource: normalizeSiteDetailQueryValue(route.query?.displaySource),
    businessSource: normalizeSiteDetailQueryValue(route.query?.businessSource),
    sourceLabel: normalizeSiteDetailQueryValue(route.query?.sourceLabel),
    businessSourceLabel: normalizeSiteDetailQueryValue(route.query?.businessSourceLabel),
    cover: normalizeSiteDetailQueryValue(route.query?.cover),
    backPath: normalizeSiteDetailQueryValue(route.query?.backPath)
  }
})

const isCommunitySource = computed(() => COMMUNITY_SOURCES.includes(pageInfo.value.sourceKey))
const pageReady = computed(() => remoteWebContentsId.value > 0)
// 内嵌网页翻译固定译成中文；英文界面不自动翻译，按钮写明「译成中文」。
const autoTranslate = computed(
  () =>
    usesChineseContent(locale.value) &&
    isActiveSourcePlatform(pageInfo.value.sourceKey) &&
    /^https:/i.test(pageInfo.value.url)
)

function parseUrl(value) {
  try {
    return new URL(String(value || ''))
  } catch {
    return null
  }
}

function pageKey(value) {
  const parsed = parseUrl(value)
  return parsed ? `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` : String(value || '')
}

const address = computed(() => {
  const url = currentUrl.value || pageInfo.value.url
  const parsed = parseUrl(url)
  if (!parsed) return { host: '', path: '', full: url, secure: false }
  const path = `${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  return {
    host: parsed.host.replace(/^www\./, ''),
    path: path === '/' ? '' : path,
    full: url,
    secure: parsed.protocol === 'https:'
  }
})

// 打开时的模组名比网页标题干净；只有跳到另一个页面（路径变化）后才改用网页标题。
const navigatedAway = computed(
  () => Boolean(currentUrl.value) && pageKey(currentUrl.value) !== pageKey(pageInfo.value.url)
)
const displayTitle = computed(() => {
  if (navigatedAway.value) return livePageTitle.value || address.value.host
  return pageInfo.value.title || livePageTitle.value || t('siteDetail.defaultTitle')
})
const sourceBadge = computed(() => pageInfo.value.source || pageInfo.value.sourceLabel || '')

const webviewStyle = computed(() => {
  return {
    width: webviewSize.value.width ? `${webviewSize.value.width}px` : '100%',
    height: webviewSize.value.height ? `${webviewSize.value.height}px` : '100%'
  }
})

function clearWebviewListeners() {
  while (cleanupList.length) {
    const dispose = cleanupList.pop()
    dispose?.()
  }
}

function normalizeSiteSource(value = '') {
  const source = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
  if (source === 'nexus' || source === 'nexusmods') return 'nexus'
  if (source === 'modio') return 'modio'
  if (source === 'ficsit') return 'ficsit'
  if (source === 'thunderstore') return 'thunderstore'
  if (source === 'vamhub') return 'vamhub'
  if (source === 'aggregate') return 'aggregate'
  if (source === 'vertex' || source === 'server') return 'vertex'
  return source
}

// 这里的文字只给 AI 助手读，不是界面文案。
function publishSiteDetailAiPageContext() {
  const displaySource =
    normalizeSiteSource(
      pageInfo.value.displaySource || pageInfo.value.sourceKey || pageInfo.value.source
    ) || 'vertex'
  const businessSource =
    normalizeSiteSource(pageInfo.value.businessSource || pageInfo.value.sourceKey) ||
    (displaySource === 'aggregate' ? '' : displaySource)
  const sourceLabel =
    pageInfo.value.sourceLabel ||
    resolveSourcePlatformLabel(displaySource, pageInfo.value.source || displaySource)
  const businessSourceLabel =
    pageInfo.value.businessSourceLabel || resolveSourcePlatformLabel(businessSource, sourceLabel)
  const sourceGameId = normalizeSiteDetailQueryValue(
    route.query?.sourceGameId || route.query?.gameId
  )
  const sourceSlug = normalizeSiteDetailQueryValue(
    route.query?.sourceSlug || route.query?.domainName || route.query?.community
  )
  const modId = normalizeSiteDetailQueryValue(route.query?.modId)
  const title = pageInfo.value.title || '站点详情'

  return aiPageContextProvider.update({
    displaySource,
    businessSource,
    sourceLabel,
    businessSourceLabel,
    page: {
      type: 'source_site_detail',
      title,
      source: businessSource || displaySource,
      displaySource,
      businessSource,
      sourceLabel,
      businessSourceLabel
    },
    game: {
      source: businessSource || displaySource,
      name: normalizeSiteDetailQueryValue(route.query?.gameName),
      sourceGameId,
      sourceSlug,
      domainName: normalizeSiteDetailQueryValue(route.query?.domainName),
      community: normalizeSiteDetailQueryValue(route.query?.community),
      steamAppId: normalizeSiteDetailQueryValue(route.query?.appId)
    },
    mod: modId
      ? {
          source: businessSource || displaySource,
          modId,
          id: modId,
          name: normalizeSiteDetailQueryValue(route.query?.modName || title),
          title: normalizeSiteDetailQueryValue(route.query?.modName || title),
          author: normalizeSiteDetailQueryValue(route.query?.author),
          version: normalizeSiteDetailQueryValue(route.query?.version)
        }
      : {},
    sourceState: {
      source: businessSource || displaySource,
      status: currentUrl.value ? 'active' : 'missing_source_identity',
      label: businessSourceLabel || sourceLabel,
      configured: Boolean(currentUrl.value),
      summary: currentUrl.value ? uiText('ui.sourcePageLoaded') : uiText('ui.sourcePageHasNoURL')
    }
  })
}

function updateMenuTitle() {
  const sourceLabel = String(pageInfo.value.source || t('siteDetail.defaultSource')).trim()
  const title = String(pageInfo.value.title || t('siteDetail.defaultTitle')).trim()
  appStore.setMenuName({
    name: `${sourceLabel} - ${title}`,
    path: route.path,
    fullPath: route.fullPath
  })
}

function syncPageState() {
  currentUrl.value = String(pageInfo.value.url || '').trim()
  errorText.value = ''
  opening.value = Boolean(currentUrl.value)
}

function syncHistoryState() {
  const webview = webviewRef.value
  if (!webview || !pageReady.value) return
  try {
    canGoBack.value = Boolean(webview.canGoBack?.())
    canGoForward.value = Boolean(webview.canGoForward?.())
  } catch {
    // webview 还没挂到页面时调用会抛错，下次导航再同步。
  }
}

function bindWebviewEvents() {
  clearWebviewListeners()

  const webview = webviewRef.value
  if (!webview) {
    return
  }

  const bindEvent = (eventName, handler) => {
    webview.addEventListener(eventName, handler)
    cleanupList.push(() => {
      webview.removeEventListener(eventName, handler)
    })
  }

  bindEvent('did-start-loading', () => {
    loading.value = true
    errorText.value = ''
  })
  bindEvent('did-stop-loading', () => {
    loading.value = false
    opening.value = false
    syncHistoryState()
  })
  bindEvent('dom-ready', () => {
    remoteWebContentsId.value = webview.getWebContentsId()
    opening.value = false
    syncHistoryState()
  })

  bindEvent('did-fail-load', (event) => {
    if (event?.isMainFrame === false || Number(event?.errorCode) === -3) {
      return
    }
    opening.value = false
    loading.value = false
    errorUrl.value = String(event?.validatedURL || currentUrl.value || '').trim()
    errorText.value = String(event?.errorDescription || '').trim() || String(event?.errorCode || '')
    if (!errorText.value) errorText.value = 'ERR_FAILED'
  })

  bindEvent('page-title-updated', (event) => {
    livePageTitle.value = String(event?.title || '').trim()
  })

  bindEvent('did-navigate', (event) => {
    const nextUrl = String(event?.url || '').trim()
    if (nextUrl) {
      if (pageKey(nextUrl) !== pageKey(currentUrl.value)) livePageTitle.value = ''
      currentUrl.value = nextUrl
    }
    syncHistoryState()
  })

  bindEvent('did-navigate-in-page', (event) => {
    if (event?.isMainFrame === false) return
    const nextUrl = String(event?.url || '').trim()
    if (nextUrl) {
      currentUrl.value = nextUrl
    }
    syncHistoryState()
  })
}

function goBackToList() {
  const backPath = String(pageInfo.value.backPath || '').trim()
  if (backPath) {
    router.push(backPath)
    return
  }

  if (window.history.length > 1) {
    router.back()
    return
  }

  router.push('/app/game')
}

function goBack() {
  if (canGoBack.value) webviewRef.value?.goBack?.()
}

function goForward() {
  if (canGoForward.value) webviewRef.value?.goForward?.()
}

function reloadCurrentPage() {
  const webview = webviewRef.value
  if (!webview) return
  errorText.value = ''
  // 第一次就没打开时 webview 里没有可重新加载的页面，改为重新打开地址。
  if (!pageReady.value && errorUrl.value) {
    opening.value = true
    webview.loadURL?.(errorUrl.value)
    return
  }
  webview.reload?.()
}

function stopLoading() {
  webviewRef.value?.stop?.()
  loading.value = false
  opening.value = false
}

function openInExternalBrowser() {
  const url = String(currentUrl.value || pageInfo.value.url).trim()
  if (!url) {
    $message.warning(t('siteDetail.noLink'))
    return
  }

  ipcRenderer.send('openBrowse', { url })
}

async function copyCurrentLink() {
  const url = String(currentUrl.value || pageInfo.value.url).trim()
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    $message.success(t('siteDetail.copied'))
  } catch {
    $message.error(t('siteDetail.copyFailed'))
  }
}

function retryTranslation() {
  translationError.value = ''
  translationRef.value?.retry?.()
}

function syncWebviewSize() {
  const stage = stageRef.value
  if (!stage || !props.active) {
    return
  }

  const { width, height } = stage.getBoundingClientRect()
  if (!width || !height) return
  const nextWidth = Math.max(1, Math.floor(width))
  const nextHeight = Math.max(1, Math.floor(height))
  if (webviewSize.value.width === nextWidth && webviewSize.value.height === nextHeight) {
    return
  }
  webviewSize.value = {
    width: nextWidth,
    height: nextHeight
  }
}

function bindStageResize() {
  stageResizeObserver?.disconnect()
  stageResizeObserver = null

  const stage = stageRef.value
  if (!stage) {
    return
  }

  syncWebviewSize()
  stageResizeObserver = new ResizeObserver(syncWebviewSize)
  stageResizeObserver.observe(stage)
}

watch(
  () => currentUrl.value,
  () => {
    downloadError.value = ''
  }
)

syncPageState()
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    publishSiteDetailAiPageContext()
    await nextTick()
    syncWebviewSize()
  }
)

onMounted(async () => {
  updateMenuTitle()
  if (props.active) publishSiteDetailAiPageContext()
  await nextTick()
  bindStageResize()
  bindWebviewEvents()
})

onBeforeUnmount(() => {
  clearWebviewListeners()
  stageResizeObserver?.disconnect()
  aiPageContextProvider.clear()
})

defineOptions({
  name: 'GameSiteDetail'
})
</script>

<template>
  <div class="game-site-detail-page" :data-active="active">
    <page-body :is-scroll-enabled="false" :padding-num="0">
      <div class="site-shell">
        <header class="site-toolbar" role="toolbar" :aria-label="t('siteDetail.toolbar')">
          <div class="site-toolbar__nav" role="group" :aria-label="t('siteDetail.navigation')">
            <VxButton
              variant="ghost"
              size="sm"
              class="site-button site-back"
              :aria-label="t('siteDetail.backToList')"
              :title="t('siteDetail.backToList')"
              @click="goBackToList"
            >
              <ToolIcon name="arrow-left" :size="15" />
              <span class="site-button__text">{{ t('siteDetail.backToList') }}</span>
            </VxButton>
            <span class="site-toolbar__divider" aria-hidden="true"></span>
            <ToolIconButton
              icon="chevron-left"
              size="sm"
              :label="t('siteDetail.back')"
              :disabled="!canGoBack"
              @click="goBack"
            />
            <ToolIconButton
              icon="chevron-right"
              size="sm"
              :label="t('siteDetail.forward')"
              :disabled="!canGoForward"
              @click="goForward"
            />
            <ToolIconButton
              v-if="loading"
              icon="close"
              size="sm"
              :label="t('siteDetail.stop')"
              @click="stopLoading"
            />
            <ToolIconButton
              v-else
              icon="refresh"
              size="sm"
              :label="t('siteDetail.reload')"
              :disabled="!pageInfo.url"
              @click="reloadCurrentPage"
            />
          </div>

          <div class="site-address" :title="address.full">
            <span
              v-if="address.host"
              class="site-address__security"
              :class="{ 'is-insecure': !address.secure }"
              role="img"
              :aria-label="address.secure ? t('siteDetail.secure') : t('siteDetail.insecure')"
              :title="address.secure ? t('siteDetail.secure') : t('siteDetail.insecure')"
            >
              <ToolIcon :name="address.secure ? 'lock' : 'warning'" :size="13" />
            </span>
            <span v-if="sourceBadge" class="site-address__source">{{ sourceBadge }}</span>
            <span class="site-address__title">{{ displayTitle }}</span>
            <span v-if="address.host" class="site-address__url">
              <span class="site-address__host">{{ address.host }}</span
              ><span class="site-address__path">{{ address.path }}</span>
            </span>
            <ToolIconButton
              v-if="address.full"
              icon="copy"
              size="sm"
              class="site-address__copy"
              :label="t('siteDetail.copyLink')"
              @click="copyCurrentLink"
            />
          </div>

          <div v-if="pageInfo.url" class="site-toolbar__actions">
            <SiteTranslationControl
              ref="translationRef"
              :webview="webviewRef"
              :url="currentUrl"
              :ready="pageReady"
              :active="active"
              :auto="autoTranslate"
              @error="translationError = $event"
            />
            <CommunitySiteActions
              v-if="isCommunitySource"
              :url="currentUrl"
              :source="pageInfo.sourceKey"
              :game-id="normalizeSiteDetailQueryValue(route.query.sourceGameId)"
              :game-name="normalizeSiteDetailQueryValue(route.query.gameName)"
              :source-label="sourceBadge"
              :web-contents-id="remoteWebContentsId"
              :active="active"
              @error="downloadError = $event"
            />
            <VxButton
              variant="secondary"
              size="sm"
              class="site-button"
              :aria-label="t('siteDetail.openExternal')"
              :title="t('siteDetail.openExternalHint')"
              @click="openInExternalBrowser"
            >
              <ToolIcon name="external" :size="14" />
              <span class="site-button__text">{{ t('siteDetail.openExternal') }}</span>
            </VxButton>
          </div>

          <div
            v-if="loading"
            class="site-progress"
            role="progressbar"
            :aria-label="t('siteDetail.loadingLabel')"
          >
            <span class="site-progress__bar"></span>
          </div>
        </header>

        <div v-if="translationError || downloadError" class="site-notices">
          <ToolNotice
            v-if="translationError"
            tone="danger"
            :title="t('siteDetail.translate.failed')"
          >
            {{ translationError }}
            <template #actions>
              <VxButton size="sm" variant="secondary" @click="retryTranslation">
                {{ t('siteDetail.translate.retry') }}
              </VxButton>
              <ToolIconButton
                icon="close"
                size="sm"
                :label="t('siteDetail.dismiss')"
                @click="translationError = ''"
              />
            </template>
          </ToolNotice>
          <ToolNotice v-if="downloadError" tone="danger" :title="t('siteDetail.download.failed')">
            {{ downloadError }}
            <template #actions>
              <ToolIconButton
                icon="close"
                size="sm"
                :label="t('siteDetail.dismiss')"
                @click="downloadError = ''"
              />
            </template>
          </ToolNotice>
        </div>

        <div ref="stageRef" class="site-stage">
          <template v-if="pageInfo.url">
            <webview
              ref="webviewRef"
              class="site-webview"
              :src="pageInfo.url"
              :style="webviewStyle"
              partition="persist:vertex-mod-site-detail"
            />

            <div v-if="opening && !errorText" class="site-state is-opening" role="status">
              <span class="site-state__spinner" aria-hidden="true"></span>
              <span>{{ t('siteDetail.opening', { host: address.host || address.full }) }}</span>
            </div>

            <div v-if="errorText" class="site-state">
              <ToolEmpty
                icon="warning"
                compact
                :title="t('siteDetail.failedTitle')"
                :description="t('siteDetail.failedHint')"
              >
                <VxButton variant="primary" @click="reloadCurrentPage">
                  {{ t('siteDetail.retry') }}
                </VxButton>
                <VxButton variant="secondary" @click="openInExternalBrowser">
                  {{ t('siteDetail.openExternal') }}
                </VxButton>
                <VxButton variant="ghost" @click="goBackToList">
                  {{ t('siteDetail.backToList') }}
                </VxButton>
              </ToolEmpty>
              <p class="site-state__detail" role="alert">
                <code>{{ errorText }}</code>
                <span v-if="errorUrl" class="site-state__url">{{ errorUrl }}</span>
              </p>
            </div>
          </template>

          <div v-else class="site-state">
            <ToolEmpty
              icon="link"
              :title="t('siteDetail.missingTitle')"
              :description="t('siteDetail.missingHint')"
            >
              <VxButton variant="primary" @click="goBackToList">
                {{ t('siteDetail.backToList') }}
              </VxButton>
            </ToolEmpty>
          </div>
        </div>
      </div>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.game-site-detail-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.game-site-detail-page :deep(.page-body) {
  position: relative;
  overflow: hidden;
}

.site-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
}

// 工具栏：返回 + 前进后退刷新 | 标题和地址 | 页面操作。窄窗口时按钮只留图标。
.site-toolbar {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  container-type: inline-size;
  container-name: site-toolbar;
}

.site-toolbar__nav,
.site-toolbar__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}

.site-toolbar__actions {
  gap: var(--space-2);
}

.site-toolbar__divider {
  width: 1px;
  height: 20px;
  margin: 0 var(--space-1);
  background: var(--color-border);
}

.site-button :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.site-back {
  padding-left: var(--space-2);
  color: var(--color-text-secondary);
}

.site-address {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-height-sm);
  padding: 0 2px 0 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: 1;
}

.site-address__security {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--color-text-muted);

  &.is-insecure {
    color: var(--color-warning-strong);
  }
}

.site-address__source {
  flex: 0 0 auto;
  padding: 3px 6px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.site-address__title {
  flex: 0 1 auto;
  // 标题再长也给网址留出位置，用户要能看到当前在哪个网站。
  max-width: 60%;
  min-width: 48px;
  overflow: hidden;
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.site-address__url {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.site-address__path {
  color: var(--color-text-muted);
}

.site-address__copy {
  margin-left: auto;
}

// 加载条贴在工具栏底边，只表示「正在加载」，不伪造进度。
.site-progress {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
}

.site-progress__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 30%;
  background: var(--color-accent);
  animation: site-progress 1.2s var(--ease-standard) infinite;
}

@keyframes site-progress {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(340%);
  }
}

.site-notices {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.site-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
}

.site-webview {
  position: absolute;
  inset: 0;
  display: flex;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-surface);
}

.site-state {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  overflow: auto;
  background: var(--color-surface);

  &.is-opening {
    flex-direction: row;
    gap: 10px;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
}

.site-state__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: site-spin 700ms linear infinite;
}

@keyframes site-spin {
  to {
    transform: rotate(360deg);
  }
}

.site-state__detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  max-width: min(560px, 100%);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: center;

  code {
    padding: 2px 6px;
    color: var(--color-text-secondary);
    background: var(--color-surface-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs);
    font-family: var(--font-family-mono);
    overflow-wrap: anywhere;
  }
}

.site-state__url {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
}

@container site-toolbar (max-width: 900px) {
  .site-address__url {
    display: none;
  }
}

@container site-toolbar (max-width: 760px) {
  .site-button__text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .site-button {
    padding: 0 var(--space-2);
  }

  .site-address__source {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-progress__bar {
    width: 100%;
    opacity: 0.6;
    animation: none;
  }

  .site-state__spinner {
    animation-duration: 2s;
  }
}
</style>
