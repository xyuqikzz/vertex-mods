<script setup>
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageBody from '@renderer/component/page-body.vue'
import { ToolIcon, ToolNotice, ToolSearchField } from '@renderer/component/tool-page'
import { VxButton } from '@renderer/component/vertex-ui'
import PreferenceSetting from '@views/settings/component/preferenceSetting.vue'
import PrivacySetting from './component/privacySetting.vue'
import ApiSetting from '@views/settings/component/apiSetting.vue'
import AiTranslationSetting from '@views/settings/component/aiTranslationSetting.vue'
import DownloadSetting from '@views/settings/component/downloadSetting.vue'
import SoftwareUpdate from '@views/settings/component/softwareUpdate.vue'
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  searchSettings
} from '@renderer/utils/settings-sections.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import common from '@renderer/common/index.js'
import { useUserStore } from '@renderer/store/userStore.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { nexusAccountState, refreshNexusAccount } from '@renderer/store/nexusAccount.js'
import { appUpdate } from '@renderer/store/appUpdateStore.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../shared/translation/ai-translation-config.js'
import {
  DEFAULT_AI_AGENT_CONFIG,
  normalizeAiAgentConfig
} from '../../../../shared/ai/config/ai-agent-config.js'
import {
  DEFAULT_DOWNLOAD_ENGINE,
  normalizeDownloadConcurrentCount,
  normalizeDownloadEngine
} from '../../../../shared/downloads/download-config.js'
import {
  AI_MASCOT_DEFAULT_CONFIG,
  normalizeAiMascotConfig
} from '@renderer/component/ai-mascot-pets.js'
import { sanitizeUserSystemConfig } from '../../../../shared/account/user-config-policy.js'
import { resolveTranslationConfig } from '../../../../shared/translation/translation-config.js'
import './settings.scss'

const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()

const createDefaultSystemConfig = () => ({
  autoStartOnBoot: 0,
  closeWindowType: 'exitApp',
  cachePath: '',
  downloadSpeed: {
    type: 'noLimit',
    speed: 1
  },
  downloadPath: '',
  downloadEngine: DEFAULT_DOWNLOAD_ENGINE,
  preferSameDriveCache: true,
  downloadConcurrentCount: normalizeDownloadConcurrentCount(),
  installTaskAutoBackup: false,
  statisticsEnabled: false,
  nexusApi: {
    apiKey: '',
    apiKeySource: ''
  },
  modioApi: {
    baseUrl: 'https://api.mod.io/v1',
    apiKey: ''
  },
  aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG),
  translation: resolveTranslationConfig(),
  aiAgent: normalizeAiAgentConfig(DEFAULT_AI_AGENT_CONFIG),
  aiMascot: normalizeAiMascotConfig(AI_MASCOT_DEFAULT_CONFIG),
  isAdult: 'adult'
})

function normalizeSystemConfig(data) {
  const base = createDefaultSystemConfig()
  const target = sanitizeUserSystemConfig(data)
  const restTarget = { ...target }
  delete restTarget.githubDownload
  delete restTarget.offlinePack
  return {
    ...base,
    ...restTarget,
    downloadSpeed: {
      ...base.downloadSpeed,
      ...(target.downloadSpeed && typeof target.downloadSpeed === 'object'
        ? target.downloadSpeed
        : {})
    },
    nexusApi: {
      ...base.nexusApi,
      ...(target.nexusApi && typeof target.nexusApi === 'object' ? target.nexusApi : {})
    },
    modioApi: {
      ...base.modioApi,
      ...(target.modioApi && typeof target.modioApi === 'object' ? target.modioApi : {})
    },
    aiTranslation: normalizeAiTranslationConfig(target.aiTranslation),
    translation: resolveTranslationConfig(target),
    aiAgent: normalizeAiAgentConfig(target.aiAgent),
    aiMascot: normalizeAiMascotConfig(target.aiMascot),
    downloadEngine: normalizeDownloadEngine(target.downloadEngine),
    downloadConcurrentCount: normalizeDownloadConcurrentCount(target.downloadConcurrentCount),
    preferSameDriveCache: target.preferSameDriveCache !== false,
    isAdult: 'adult'
  }
}

function toPlainJson(data, fallback = {}) {
  try {
    const text = JSON.stringify(data ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

const systemConfig = ref(createDefaultSystemConfig())

// ==================== 自动保存 ====================
// 第一次载入不保存；保存失败时界面回到上一次保存成功的值，并保留失败的配置供「重试」。
let skipNextSave = true
let lastSavedConfig = null
let failedConfig = null
const saveError = ref('')

watch(
  () => systemConfig.value,
  async (nv) => {
    const safeConfig = toPlainJson(common.convertToRaw(nv))
    if (skipNextSave) {
      skipNextSave = false
      lastSavedConfig = safeConfig
      return
    }
    let failureMessage = ''
    try {
      const result = await ipcRenderer.invoke('updateSystemSettings', safeConfig)
      if (result && result.success === false) failureMessage = String(result.message || '')
    } catch {
      failureMessage = '系统凭据存储暂时不可用'
    }
    if (failureMessage) {
      failedConfig = safeConfig
      saveError.value = failureMessage
      if (lastSavedConfig) {
        skipNextSave = true
        systemConfig.value = normalizeSystemConfig(lastSavedConfig)
      }
      return
    }
    saveError.value = ''
    failedConfig = null
    lastSavedConfig = safeConfig
    window.dispatchEvent(
      new CustomEvent('vertex-ai-mascot-config-change', {
        detail: normalizeAiMascotConfig(nv.aiMascot)
      })
    )
    window.dispatchEvent(
      new CustomEvent('vertex-system-config-change', {
        detail: safeConfig
      })
    )
    userStore.isAdult = nv.isAdult
  },
  { deep: true }
)

function retrySave() {
  if (!failedConfig) return
  systemConfig.value = normalizeSystemConfig(failedConfig)
}

function getSystemConfig() {
  ipcRenderer.send('getConfigByKey', {
    key: 'systemConfig.settings',
    replyName: 'get-systemConfig'
  })
}

useIpc('get-systemConfig', (data) => {
  systemConfig.value = normalizeSystemConfig(data)
})

useIpc('update-system-config', () => {
  getSystemConfig()
})

// ==================== 分类与导航 ====================
const activeSection = ref(resolveSettingsSection(route.query.section))
const contentRef = ref(null)
const headingRef = ref(null)
const navListRef = ref(null)
const searchQuery = ref('')

const navGroups = computed(() =>
  SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  }))
)
const activeMeta = computed(
  () =>
    SETTINGS_SECTIONS.find((section) => section.id === activeSection.value) || SETTINGS_SECTIONS[0]
)
const isSection = (...ids) => ids.includes(activeSection.value)

const searchResults = computed(() =>
  searchSettings(searchQuery.value).map((item) => {
    const section = SETTINGS_SECTIONS.find((entry) => entry.id === item.section)
    return {
      ...item,
      title: item.titleKey ? t(item.titleKey) : item.title,
      sectionName: t(`settings.sections.${item.section}`),
      groupName: t(`settings.groups.${section?.group || 'general'}`)
    }
  })
)
const isSearching = computed(() => Boolean(searchQuery.value.trim()))

function resetContentScroll() {
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function focusHeading() {
  await nextTick()
  headingRef.value?.focus?.({ preventScroll: true })
}

function goSection(id, { focus = true } = {}) {
  const next = resolveSettingsSection(id)
  searchQuery.value = ''
  if (next !== activeSection.value) {
    activeSection.value = next
    resetContentScroll()
  }
  if (route.path === '/app/settings' && route.query.section !== next) {
    router.replace({ path: route.path, query: { ...route.query, section: next } }).catch(() => {})
  }
  if (focus) focusHeading()
}

watch(
  () => route.query.section,
  (section) => {
    if (route.path !== '/app/settings' || !section) return
    const next = resolveSettingsSection(section)
    if (next !== activeSection.value) {
      activeSection.value = next
      searchQuery.value = ''
      resetContentScroll()
    }
  }
)

watch(activeSection, () => refreshNavStatus())

function handleNavKeydown(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = Array.from(navListRef.value?.querySelectorAll('.settings-nav__item') || [])
  const index = items.indexOf(document.activeElement)
  if (index === -1) return
  event.preventDefault()
  const target =
    event.key === 'Home'
      ? items[0]
      : event.key === 'End'
        ? items[items.length - 1]
        : items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
  target?.focus()
}

function submitSearch() {
  if (searchResults.value.length) goSection(searchResults.value[0].section)
}

// ==================== 侧栏状态 ====================
const steamAccount = ref(null)

async function refreshNavStatus() {
  refreshNexusAccount().catch(() => {})
  try {
    const result = await ipcRenderer.invoke('steam-account:status')
    steamAccount.value = result?.success ? result.data : null
  } catch {
    steamAccount.value = null
  }
}

function isAiConfigReady(config = {}) {
  return Boolean(config?.baseURL && config?.apiKey && config?.model)
}

const navStatus = computed(() => {
  const config = systemConfig.value
  const on = t('settings.status.on')
  const off = t('settings.status.off')
  const mascot = normalizeAiMascotConfig(config.aiMascot)
  const services = Array.isArray(config.aiTranslation?.apiConfigs)
    ? config.aiTranslation.apiConfigs
    : []
  const readyServices = services.filter((item) => isAiConfigReady(item)).length
  const nexus =
    nexusAccountState.mode === 'api_key'
      ? config.nexusApi?.apiKey || nexusAccountState.hasApiKey
        ? { text: 'API Key', tone: 'ok' }
        : { text: t('settings.status.notConfigured'), tone: 'warn' }
      : nexusAccountState.connected && nexusAccountState.user
        ? { text: t('settings.status.signedIn'), tone: 'ok' }
        : nexusAccountState.revision
          ? { text: t('settings.status.signedOut'), tone: 'warn' }
          : null
  return {
    pet: { text: mascot.enabled ? mascot.selectedPetId : off },
    nexus,
    steam: steamAccount.value
      ? steamAccount.value.connected
        ? { text: t('settings.status.signedIn'), tone: 'ok' }
        : { text: t('settings.status.signedOut') }
      : null,
    modio: config.modioApi?.apiKey
      ? null
      : { text: t('settings.status.notConfigured'), tone: 'warn' },
    services: readyServices
      ? { text: t('settings.status.count', { count: readyServices }) }
      : { text: t('settings.status.notConfigured'), tone: 'warn' },
    translate: null,
    assistant: { text: config.aiAgent?.enabled ? on : off },
    privacy: { text: config.statisticsEnabled ? on : off },
    about: ['available', 'downloaded'].includes(appUpdate.state.status)
      ? { text: t('settings.status.updateAvailable'), tone: 'info' }
      : null
  }
})

// ==================== 生命周期 ====================
onMounted(() => {
  setPageMenuName('设置', route.path)
  getSystemConfig()
  refreshNavStatus()
})

onActivated(() => {
  setPageMenuName('设置', route.path)
  if (route.query.section) activeSection.value = resolveSettingsSection(route.query.section)
  refreshNavStatus()
})

defineOptions({
  name: 'Settings'
})
</script>

<template>
  <page-body :is-scroll-enabled="false" :padding-num="0">
    <div class="settings-index">
      <div class="settings-shell">
        <nav class="settings-nav" :aria-label="t('settings.navLabel')">
          <div class="settings-nav__head">
            <div class="settings-nav__title">{{ t('nav.settings') }}</div>
            <ToolSearchField
              v-model="searchQuery"
              class="settings-nav__search"
              :label="t('settings.search')"
              :placeholder="t('settings.searchPlaceholder')"
              @submit="submitSearch"
            />
          </div>
          <div ref="navListRef" class="settings-nav__list left-list" @keydown="handleNavKeydown">
            <template v-for="group in navGroups" :key="group.id">
              <div class="settings-nav__group">{{ t(`settings.groups.${group.id}`) }}</div>
              <button
                v-for="section in group.sections"
                :key="section.id"
                type="button"
                class="settings-nav__item list-item"
                :class="{ 'is-active active-item': !isSearching && activeSection === section.id }"
                :aria-current="!isSearching && activeSection === section.id ? 'page' : undefined"
                @click="goSection(section.id)"
              >
                <ToolIcon :name="section.icon" :size="16" />
                <span class="settings-nav__name list-item__text">{{
                  t(`settings.sections.${section.id}`)
                }}</span>
                <span v-if="navStatus[section.id]" class="settings-nav__meta">
                  <span
                    v-if="navStatus[section.id].tone"
                    class="settings-nav__dot"
                    :class="`is-${navStatus[section.id].tone}`"
                    aria-hidden="true"
                  ></span>
                  {{ navStatus[section.id].text }}
                </span>
              </button>
            </template>
          </div>
        </nav>

        <main ref="contentRef" class="settings-content">
          <div class="settings-page">
            <ToolNotice v-if="saveError" tone="danger" class="settings-page__notice">
              {{ t('settings.saveFailed', { reason: saveError }) }}
              <template #actions>
                <VxButton variant="secondary" size="sm" @click="retrySave">{{
                  t('settings.retry')
                }}</VxButton>
              </template>
            </ToolNotice>

            <template v-if="isSearching">
              <header class="settings-page__head">
                <div class="settings-page__heading">
                  <div class="settings-page__crumb">{{ t('settings.search') }}</div>
                  <h1 ref="headingRef" tabindex="-1">
                    {{ t('settings.searchTitle', { keyword: searchQuery.trim() }) }}
                  </h1>
                  <p>{{ t('settings.searchCount', { count: searchResults.length }) }}</p>
                </div>
              </header>
              <div class="settings-page__body">
                <div v-if="searchResults.length" class="setting-group__panel settings-results">
                  <button
                    v-for="item in searchResults"
                    :key="`${item.section}-${item.title}`"
                    type="button"
                    class="settings-result"
                    @click="goSection(item.section)"
                  >
                    <span class="settings-result__text">
                      <span class="settings-result__title">{{ item.title }}</span>
                      <span class="settings-result__path"
                        >{{ item.groupName }} › {{ item.sectionName }}</span
                      >
                    </span>
                    <ToolIcon name="arrow-up" :size="14" class="settings-result__arrow" />
                  </button>
                </div>
                <div v-else class="setting-group__panel settings-results__empty" role="status">
                  <strong>{{ t('settings.noResults') }}</strong>
                  <span>{{ t('settings.noResultsHint') }}</span>
                </div>
              </div>
            </template>

            <template v-else>
              <header class="settings-page__head">
                <div class="settings-page__heading">
                  <div class="settings-page__crumb">
                    {{ t(`settings.groups.${activeMeta.group}`) }}
                  </div>
                  <h1 ref="headingRef" tabindex="-1">
                    {{ t(`settings.sections.${activeMeta.id}`) }}
                  </h1>
                  <p>{{ t(`settings.descriptions.${activeMeta.id}`) }}</p>
                </div>
                <div id="settings-page-actions" class="settings-page__actions"></div>
              </header>

              <div class="settings-page__body">
                <PreferenceSetting
                  v-if="isSection('general', 'pet')"
                  v-model="systemConfig"
                  :section="activeSection"
                />
                <ApiSetting
                  v-else-if="isSection('nexus', 'steam', 'modio')"
                  id="apiSetting"
                  v-model="systemConfig"
                  :section="activeSection"
                />
                <DownloadSetting
                  v-else-if="isSection('download', 'storage', 'packages')"
                  v-model="systemConfig"
                  :section="activeSection"
                />
                <AiTranslationSetting
                  v-else-if="isSection('services', 'translate', 'assistant')"
                  v-model="systemConfig"
                  :section="activeSection"
                  @navigate="goSection"
                />
                <PrivacySetting v-else-if="isSection('privacy')" v-model="systemConfig" />
                <SoftwareUpdate v-else-if="isSection('about')" id="appUpdate" />
              </div>
            </template>
          </div>
        </main>
      </div>
    </div>
  </page-body>
</template>

<style scoped lang="scss">
.settings-index {
  width: 100%;
  height: 100%;
  padding: var(--space-5) var(--space-6) var(--space-6);
  color: var(--color-text);
  font-family: var(--font-family-base);
  background: var(--color-bg);
  box-sizing: border-box;
}

.settings-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

// ==================== 侧栏 ====================
.settings-nav {
  display: flex;
  flex: 0 0 256px;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-soft);
  border-right: 1px solid var(--color-surface-strong);
}

.settings-nav__head {
  padding: var(--space-5) var(--space-4) var(--space-1);
}

.settings-nav__title {
  margin: 0 2px 14px;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.settings-nav__search {
  width: 100%;
}

.settings-nav__list {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
    margin: var(--space-3) 0;
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

.settings-nav__group {
  padding: 18px 10px 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.settings-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 13.5px;
  font-weight: var(--font-weight-medium);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  &.is-active {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-semibold);
    background: var(--color-accent-soft);
  }
}

.settings-nav__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.settings-nav__meta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  max-width: 96px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
  text-overflow: ellipsis;

  .is-active & {
    color: var(--color-accent-strong);
  }
}

.settings-nav__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: var(--color-text-subtle);
  border-radius: 50%;

  &.is-ok {
    background: var(--color-success);
  }

  &.is-warn {
    background: var(--color-warning);
  }

  &.is-info {
    background: var(--color-accent);
  }
}

// ==================== 内容 ====================
.settings-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
    margin: var(--space-6) 0;
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

.settings-page {
  max-width: 820px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-10) 56px;
  box-sizing: border-box;
}

.settings-page__notice {
  margin-bottom: var(--space-6);
}

.settings-page__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3) var(--space-4);
}

.settings-page__heading {
  flex: 1 1 320px;
  min-width: 0;

  h1 {
    margin: 0;
    color: var(--color-text);
    font-size: 20px;
    font-weight: var(--font-weight-semibold);
    line-height: 1.3;
    outline: none;
  }

  p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.55;
  }
}

.settings-page__crumb {
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.settings-page__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-2);

  &:empty {
    display: none;
  }
}

.settings-page__body {
  margin-top: 28px;
}

// ==================== 搜索结果 ====================
.settings-result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-5);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  box-sizing: border-box;

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

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
}

.settings-result__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-result__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
}

.settings-result__path {
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.settings-result__arrow {
  color: var(--color-text-muted);
  transform: rotate(90deg);
}

.settings-results__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px var(--space-5);
  text-align: center;

  strong {
    font-size: 15px;
    font-weight: var(--font-weight-semibold);
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
}

@media (max-width: 1100px) {
  .settings-nav {
    flex-basis: 224px;
  }

  .settings-page {
    padding: var(--space-7) var(--space-6) var(--space-12);
  }
}

@media (max-width: 760px) {
  .settings-index {
    padding: var(--space-3);
  }

  .settings-nav {
    flex-basis: 196px;
  }

  .settings-nav__meta {
    display: none;
  }

  .settings-page {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-nav__item {
    transition: none;
  }
}
</style>
