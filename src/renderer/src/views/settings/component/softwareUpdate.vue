<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import appLogo from '@resources/logo.png'
import { VxButton, VxProgress } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import { useAppStore } from '@renderer/store/appStore.js'
import { releaseConfig } from '../../../../../shared/app/release-config.js'
import {
  APP_ISSUES_URL,
  APP_RELEASES_URL,
  APP_REPOSITORY_URL,
  getAppReleaseUrl
} from '../../../../../shared/app/app-release.js'
import { appUpdate } from '@renderer/store/appUpdateStore.js'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import ThirdPartyProjects from './ThirdPartyProjects.vue'

const NOTE_PREVIEW_LINES = 3
const PLATFORM_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
const STATUS_TONES = {
  idle: '',
  checking: 'is-progress',
  available: 'is-progress',
  current: 'is-success',
  unavailable: '',
  error: 'is-danger',
  downloading: 'is-progress',
  downloaded: 'is-success',
  installing: 'is-progress'
}

const appStore = useAppStore()
const { t, locale } = useI18n()
const state = appUpdate.state

// ==================== 应用信息 ====================
const version = computed(() => appStore.AppData.version || '')
const runtime = computed(() => appStore.AppData.runtime || {})
const channelLabel = computed(() =>
  t(`settings.update.channel.${releaseConfig.channel || 'community'}`)
)
const platformText = computed(() => {
  const info = runtime.value
  if (!info.platform) return ''
  return [PLATFORM_NAMES[info.platform] || info.platform, info.arch].filter(Boolean).join(' · ')
})

const copyState = ref('')
let copyTimer = null

function buildVersionInfo() {
  const info = runtime.value
  const lines = [
    t('settings.update.copyTemplate', {
      version: version.value || '—',
      channel: channelLabel.value
    })
  ]
  if (info.platform) {
    lines.push(
      t('settings.update.copyOs', {
        platform: PLATFORM_NAMES[info.platform] || info.platform,
        osVersion: info.osVersion || '',
        arch: info.arch || ''
      })
    )
  }
  if (info.electron) {
    lines.push(
      t('settings.update.copyRuntime', {
        electron: info.electron,
        chrome: info.chrome || '—',
        node: info.node || '—'
      })
    )
  }
  return lines.join('\n')
}

function copyWithSelection(text) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('copy_failed')
}

async function copyVersionInfo() {
  const text = buildVersionInfo()
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else copyWithSelection(text)
    copyState.value = 'copied'
  } catch {
    try {
      copyWithSelection(text)
      copyState.value = 'copied'
    } catch {
      copyState.value = 'failed'
    }
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = ''
  }, 2400)
}

onBeforeUnmount(() => clearTimeout(copyTimer))

// ==================== 软件更新 ====================
const statusKey = computed(() =>
  state.checking ? 'checking' : STATUS_TONES[state.status] !== undefined ? state.status : 'idle'
)
const releaseVersion = computed(() => {
  const release = state.release || {}
  return String(release.version || release.versionName || release.tag || '').replace(/^v/i, '')
})
const statusText = computed(() =>
  statusKey.value === 'available' && releaseVersion.value
    ? t('settings.update.status.availableVersion', { version: releaseVersion.value })
    : t(`settings.update.status.${statusKey.value}`)
)
const statusTone = computed(() => STATUS_TONES[statusKey.value])

const formatDateTime = (value, options) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale.value, options)
}
const lastCheckedText = computed(() =>
  state.lastCheckedAt
    ? formatDateTime(state.lastCheckedAt, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : ''
)
const updateDescription = computed(() => {
  if (state.messageKey) return t(state.messageKey)
  switch (statusKey.value) {
    case 'checking':
      return t(
        releaseConfig.updatesEnabled
          ? 'settings.update.checkingService'
          : 'settings.update.checkingGithub'
      )
    case 'downloading':
      return t('settings.update.downloadingHint')
    case 'downloaded':
      return t('settings.update.downloadedHint')
    case 'installing':
      return t('updates.installingDescription')
    case 'error':
      return t('settings.update.errorHint')
    case 'unavailable':
      return t('settings.update.unavailableHint')
    default:
      return lastCheckedText.value
        ? t('settings.update.descriptionWithLastCheck', { time: lastCheckedText.value })
        : t('settings.update.description')
  }
})
const checkLabel = computed(() =>
  statusKey.value === 'error' ? t('settings.update.retry') : t('settings.update.check')
)
const installerBusy = computed(() => ['downloading', 'downloaded', 'installing'].includes(state.status))

function checkForUpdates() {
  actionError.value = ''
  appUpdate.check({ inline: true })
}

// ==================== 新版本信息 ====================
const isGithubRelease = computed(
  () => state.release?.source === 'github' || !releaseConfig.updatesEnabled
)
const requiresReleasePage = computed(() => isGithubRelease.value && state.release?.canDownload !== true)
const currentVersion = computed(() => state.currentVersion || version.value || '—')
const releaseDate = computed(() =>
  formatDateTime(state.release?.publishTime || state.release?.releaseDate, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
)
const releaseMeta = computed(() =>
  releaseDate.value
    ? t('settings.update.releaseMeta', { date: releaseDate.value, current: currentVersion.value })
    : t('settings.update.releaseMetaNoDate', { current: currentVersion.value })
)

// 发布说明只取纯文本摘要：去掉 Markdown 标记和 HTML，完整内容在更新弹窗里查看。
function noteLines(source) {
  const raw = Array.isArray(source)
    ? source.map((item) => (typeof item === 'string' ? item : item?.note || '')).join('\n')
    : typeof source === 'string'
      ? source
      : ''
  return raw
    .replace(/<[^>]*>/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^([-*_])\1{2,}$/.test(line))
    .map((line) =>
      line
        .replace(/^([-*+]|\d+[.)])\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim()
    )
    .filter(Boolean)
}
const allNotes = computed(() => noteLines(state.release?.releaseNotes))
const previewNotes = computed(() => allNotes.value.slice(0, NOTE_PREVIEW_LINES))
const moreNotes = computed(() => Math.max(0, allNotes.value.length - NOTE_PREVIEW_LINES))

const actionError = ref('')
const actionBusy = ref(false)

async function runUpdateAction() {
  actionError.value = ''
  if (requiresReleasePage.value) {
    window.open(getAppReleaseUrl(state.release?.tag), '_blank')
    return
  }
  actionBusy.value = true
  try {
    await appUpdate.download()
  } catch (error) {
    actionError.value = error.messageKey || 'updates.errors.update_download_failed'
  } finally {
    actionBusy.value = false
  }
}

async function installUpdate() {
  actionError.value = ''
  actionBusy.value = true
  try {
    await appUpdate.install()
  } catch (error) {
    actionError.value = error.messageKey || 'updates.errors.update_install_failed'
  } finally {
    actionBusy.value = false
  }
}

// ==================== 下载进度 ====================
const formatSize = (bytes) => {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte']
  let value = Number(bytes) || 0
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return new Intl.NumberFormat(locale.value, {
    style: 'unit',
    unit: units[index],
    unitDisplay: 'short',
    maximumFractionDigits: index ? 1 : 0
  }).format(value)
}
const progressPercent = computed(() =>
  new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
    (Number(state.progress) || 0) / 100
  )
)
const progressDetail = computed(() =>
  [
    state.total
      ? t('settings.update.downloadSize', {
          transferred: formatSize(state.transferred),
          total: formatSize(state.total)
        })
      : '',
    state.bytesPerSecond
      ? t('settings.update.downloadSpeed', { speed: formatSize(state.bytesPerSecond) })
      : '',
    progressPercent.value
  ]
    .filter(Boolean)
    .join(' · ')
)

// ==================== 项目链接 ====================
const projectLinks = computed(() => [
  {
    id: 'source',
    url: APP_REPOSITORY_URL,
    label: t('settings.aboutLinks.source'),
    hint: t('settings.aboutLinks.sourceHint'),
    action: t('settings.aboutLinks.sourceAction')
  },
  {
    id: 'releases',
    url: releaseConfig.downloadPage || APP_RELEASES_URL,
    label: t('settings.aboutLinks.releases'),
    hint: t('settings.aboutLinks.releasesHint'),
    action: t('settings.aboutLinks.releasesAction')
  },
  {
    id: 'feedback',
    url: APP_ISSUES_URL,
    label: t('settings.aboutLinks.feedback'),
    hint: t('settings.aboutLinks.feedbackHint'),
    action: t('settings.aboutLinks.feedbackAction')
  }
])

function openExternal(url) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="software-update">
    <SettingGroup class="about-app-group">
      <div class="about-app" role="group" :aria-label="t('settings.update.groupLabel')">
        <div class="about-app__logo" aria-hidden="true">
          <img class="about-app__icon" :src="appLogo" alt="" />
        </div>
        <div class="about-app__identity">
          <div class="about-app__title">
            <p class="about-app__name">Vertex</p>
            <span class="tool-status about-app__channel">{{ channelLabel }}</span>
          </div>
          <p class="about-app__version">
            <span v-if="version">{{ t('settings.update.version', { version }) }}</span>
            <span v-else class="about-app__muted">{{ t('settings.update.versionLoading') }}</span>
            <template v-if="platformText">
              <span class="about-app__sep" aria-hidden="true">·</span>
              <span class="about-app__muted">{{ platformText }}</span>
            </template>
          </p>
        </div>
        <VxButton variant="ghost" size="sm" class="about-app__copy" @click="copyVersionInfo">
          <ToolIcon :name="copyState === 'copied' ? 'check' : 'copy'" :size="14" />
          {{ copyState === 'copied' ? t('settings.update.copied') : t('settings.update.copy') }}
        </VxButton>
        <span class="about-app__live" role="status">{{
          copyState === 'copied'
            ? t('settings.update.copied')
            : copyState === 'failed'
              ? t('settings.update.copyFailed')
              : ''
        }}</span>
      </div>

      <SettingRow class="about-update" :data-update-status="statusKey">
        <template #label>
          {{ t('settings.update.title') }}
          <span class="tool-status about-update__status" :class="statusTone" role="status">{{
            statusText
          }}</span>
        </template>
        <template #description>{{ updateDescription }}</template>
        <div class="update-actions">
          <VxButton
            variant="secondary"
            size="sm"
            :loading="state.checking"
            :disabled="installerBusy"
            @click="checkForUpdates"
            >{{ state.checking ? t('settings.update.checkingAction') : checkLabel }}</VxButton
          >
        </div>
      </SettingRow>

      <div
        v-if="statusKey === 'available'"
        class="about-release"
        :aria-label="t('settings.update.status.availableVersion', { version: releaseVersion })"
        role="region"
      >
        <div class="about-release__head">
          <span class="about-release__version">{{ releaseVersion }}</span>
          <span class="about-release__meta">{{ releaseMeta }}</span>
          <VxButton
            variant="ghost"
            size="sm"
            class="about-release__notes-link"
            @click="appUpdate.open()"
            >{{ t('settings.update.fullNotes') }}</VxButton
          >
        </div>
        <ul v-if="previewNotes.length" class="about-release__notes">
          <li v-for="(line, index) in previewNotes" :key="index">{{ line }}</li>
        </ul>
        <p v-else class="about-release__empty">{{ t('settings.update.noNotes') }}</p>
        <p v-if="moreNotes" class="about-release__more">
          {{ t('settings.update.moreNotes', { count: moreNotes }) }}
        </p>
        <div class="about-release__actions">
          <VxButton size="sm" :loading="actionBusy" @click="runUpdateAction">
            {{ requiresReleasePage ? t('settings.update.goDownload') : t('updates.downloadAndInstall') }}
            <ToolIcon v-if="requiresReleasePage" name="external" :size="12" />
          </VxButton>
          <span class="about-release__hint">{{
            requiresReleasePage ? t('updates.manualOnly') : t('updates.downloading')
          }}</span>
        </div>
        <p v-if="actionError" class="about-release__error" role="alert">{{ t(actionError) }}</p>
      </div>

      <div v-else-if="statusKey === 'downloading'" class="about-release">
        <div class="about-release__progress-head">
          <span>{{ t('settings.update.downloadingVersion', { version: releaseVersion }) }}</span>
          <span class="about-release__meta about-release__numbers">{{ progressDetail }}</span>
        </div>
        <VxProgress
          class="about-release__bar"
          :value="state.progress"
          :aria-label="t('settings.update.progressLabel')"
        />
        <p class="about-release__hint">{{ t('updates.downloading') }}</p>
        <VxButton size="sm" variant="secondary" @click="appUpdate.close()">{{ t('updates.postpone') }}</VxButton>
      </div>

      <div v-else-if="statusKey === 'downloaded'" class="about-release about-release--ready">
        <ToolIcon name="check" :size="18" class="about-release__ready-icon" />
        <div class="about-release__ready-text">
          <p>{{ t('settings.update.readyTitle', { version: releaseVersion }) }}</p>
          <p class="about-release__hint">{{ t('settings.update.readyHint') }}</p>
        </div>
        <VxButton size="sm" :loading="actionBusy" @click="installUpdate">{{
          t('settings.update.install')
        }}</VxButton>
        <p v-if="actionError" class="about-release__error" role="alert">{{ t(actionError) }}</p>
      </div>
      <p v-else-if="statusKey === 'installing'" role="status">{{ t('updates.installingDescription') }}</p>
    </SettingGroup>

    <SettingGroup class="about-links" :title="t('settings.aboutLinks.title')">
      <SettingRow
        v-for="link in projectLinks"
        :key="link.id"
        :label="link.label"
        :description="link.hint"
      >
        <VxButton
          variant="ghost"
          size="sm"
          :aria-label="t('settings.aboutLinks.external', { name: link.action })"
          @click="openExternal(link.url)"
        >
          {{ link.action }}
          <ToolIcon name="external" :size="12" />
        </VxButton>
      </SettingRow>
    </SettingGroup>

    <ThirdPartyProjects />
  </div>
</template>

<style scoped lang="scss">
.software-update > * + * {
  margin-top: var(--space-7);
}

// ---------- 应用信息 ----------
.about-app {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-5);
}

.about-app__logo {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 52px;
  height: 52px;
  background: var(--color-accent-soft);
  border-radius: var(--radius-lg);
}

.about-app__icon {
  display: block;
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.about-app__identity {
  flex: 1 1 220px;
  min-width: 0;
}

.about-app__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.about-app__name {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}

.about-app__channel {
  height: 20px;
}

.about-app__version {
  display: flex;
  flex-wrap: wrap;
  gap: 0 6px;
  margin: 5px 0 0;
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.about-app__muted {
  color: var(--color-text-muted);
}

.about-app__sep {
  color: var(--color-text-subtle);
}

.about-app__copy :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.about-app__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

// ---------- 软件更新 ----------
.about-update {
  border-top: 1px solid var(--color-surface-strong);
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.about-release {
  margin: 0 var(--space-5) var(--space-5);
  padding: var(--space-4);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.about-release__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.about-release__version {
  font-family: var(--font-family-mono);
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
}

.about-release__meta,
.about-release__hint,
.about-release__more,
.about-release__empty {
  color: var(--color-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.about-release__notes-link {
  margin-left: auto;
}

.about-release__notes {
  margin: var(--space-2) 0 0;
  padding-left: 18px;
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
  overflow-wrap: anywhere;
}

.about-release__empty,
.about-release__more {
  margin: var(--space-2) 0 0;
}

.about-release__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-4);

  :deep(.vx-button__content) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
}

.about-release__hint {
  margin: 0;
}

.about-release__error {
  flex-basis: 100%;
  margin: var(--space-2) 0 0;
  color: var(--color-danger-strong);
  font-size: 12.5px;
}

.about-release__progress-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

.about-release__numbers {
  font-family: var(--font-family-mono);
  font-variant-numeric: tabular-nums;
}

.about-release__bar {
  width: 100%;
  margin: var(--space-3) 0 var(--space-2);
}

.about-release--ready {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.about-release__ready-icon {
  color: var(--color-success-strong);
}

.about-release__ready-text {
  flex: 1 1 240px;
  min-width: 0;

  p {
    margin: 0;
  }
}

// ---------- 项目链接 ----------
.about-links :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
