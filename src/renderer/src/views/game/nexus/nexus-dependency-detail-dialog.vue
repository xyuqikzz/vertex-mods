<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { canTranslateModContent } from '@renderer/i18n/content.js'
import { computed, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  actionMode: {
    type: String,
    default: 'install'
  },
  modName: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    default: ''
  },
  summaryText: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: ''
  },
  entries: {
    type: Array,
    default: () => []
  },
  dlcRequirements: {
    type: Array,
    default: () => []
  },
  stats: {
    type: Object,
    default: () => ({
      totalCount: 0,
      visibleCount: 0,
      pendingCount: 0,
      manualCount: 0,
      installedCount: 0,
      hiddenDefaultCount: 0
    })
  },
  showOriginalText: {
    type: Boolean,
    default: true
  },
  translateLoading: {
    type: Boolean,
    default: false
  },
  translateDisabled: {
    type: Boolean,
    default: false
  },
  translateButtonText: {
    type: String,
    default: undefined
  },
  showTranslateButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'open-reference', 'submit', 'translate-list'])

const isDownloadMode = computed(
  () =>
    String(props.actionMode || '')
      .trim()
      .toLowerCase() === 'download'
)
const safeEntries = computed(() => (Array.isArray(props.entries) ? props.entries : []))
const safeDlcRequirements = computed(() =>
  Array.isArray(props.dlcRequirements) ? props.dlcRequirements : []
)
const safeStats = computed(() => {
  const source = props.stats && typeof props.stats === 'object' ? props.stats : {}
  return {
    totalCount: Number(source.totalCount || 0),
    visibleCount: Number(source.visibleCount || 0),
    pendingCount: Number(source.pendingCount || 0),
    manualCount: Number(source.manualCount || 0),
    installedCount: Number(source.installedCount || 0),
    hiddenDefaultCount: Number(source.hiddenDefaultCount || 0)
  }
})

const dialogTitle = computed(() => (isDownloadMode.value ? '下载依赖确认' : '安装依赖确认'))
const fileLabel = computed(() => (isDownloadMode.value ? '下载文件' : '安装文件'))
const currentOnlyActionText = computed(() =>
  isDownloadMode.value ? '仅下载当前文件' : '仅安装当前文件'
)
const withDependenciesActionText = computed(() =>
  isDownloadMode.value ? '下载当前文件和依赖' : '安装当前文件和依赖'
)
const strategyDescription = computed(() => {
  if (isDownloadMode.value) {
    return '你可以只处理当前文件，也可以把默认依赖与可自动下载的 Nexus 依赖一起加入本次下载队列。'
  }
  return '你可以只处理当前文件，也可以把默认依赖与 Nexus 依赖一起纳入本次安装计划。'
})
const defaultDependencyNoticeText = computed(() => {
  const hiddenDefaultCount = safeStats.value.hiddenDefaultCount
  if (hiddenDefaultCount <= 0) {
    return ''
  }
  if (isDownloadMode.value) {
    return uiText('ui.foundValueDefaultDependenciesDownloadCurrentFileAndDependenciesIncludes', { value1: (hiddenDefaultCount) })
  }
  return uiText('ui.foundValueDefaultDependenciesInstallCurrentFileAndDependenciesIncludes', { value1: (hiddenDefaultCount) })
})
const resolvedEmptyText = computed(() => {
  if (safeEntries.value.length > 0) {
    return ''
  }
  if (defaultDependencyNoticeText.value) {
    return defaultDependencyNoticeText.value
  }
  return String(props.emptyText || '').trim() || uiText('ui.noDependenciesRequireAdditionalHandling')
})

const statCards = computed(() => {
  const hiddenDefaultLabel = isDownloadMode.value ? '默认依赖映射' : '默认依赖'
  const pendingLabel = isDownloadMode.value ? '待下载依赖' : '待安装依赖'

  return [
    {
      label: pendingLabel,
      value: String(safeStats.value.pendingCount || 0),
      tone: 'pending'
    },
    {
      get label() { return uiText('ui.manualHandlingRequired') },
      value: String(safeStats.value.manualCount || 0),
      tone: 'manual'
    },
    {
      get label() { return uiText('tools.installed') },
      value: String(safeStats.value.installedCount || 0),
      tone: 'installed'
    },
    {
      label: hiddenDefaultLabel,
      value: String(safeStats.value.hiddenDefaultCount || 0),
      tone: 'muted'
    },
    {
      get label() { return uiText('ui.dLCRequirements') },
      value: String(safeDlcRequirements.value.length || 0),
      tone: 'muted'
    }
  ]
})

function emitClose() {
  emit('close')
}

function emitSubmit(strategy = 'with_dependencies') {
  emit('submit', strategy)
}

function emitTranslateList() {
  if (props.translateLoading || props.translateDisabled) {
    return
  }
  emit('translate-list')
}

function resolveEntryDisplayName(entry = {}) {
  const translated = canTranslateModContent() ? String(entry?.translatedName || '').trim() : ''
  return translated || String(entry?.name || '').trim() || '--'
}

function shouldShowOriginalName(entry = {}) {
  if (!canTranslateModContent()) return false
  const original = String(entry?.name || '').trim()
  const translated = String(entry?.translatedName || '').trim()
  return !!(props.showOriginalText && translated && original && translated !== original)
}

function handleWindowKeydown(event) {
  if (event.key === 'Escape') {
    emitClose()
  }
}

watch(
  () => props.open,
  (value) => {
    if (value) {
      window.addEventListener('keydown', handleWindowKeydown)
      return
    }
    window.removeEventListener('keydown', handleWindowKeydown)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <teleport to="body">
    <transition name="nexus-dependency-dialog-fade">
      <div v-if="open" class="nexus-dependency-dialog">
        <div class="nexus-dependency-dialog__backdrop" @click="emitClose"></div>

        <section
          class="nexus-dependency-dialog__panel"
          role="dialog"
          aria-modal="true"
          :aria-label="dialogTitle"
          @click.stop
        >
          <header class="nexus-dependency-dialog__header">
            <div class="dependency-dialog-header__top">
              <div class="dependency-dialog-header__title-block">
                <h2 class="dependency-dialog-header__title">{{ dialogTitle }}</h2>
                <div class="dependency-dialog-header__mod-name">{{ modName || '--' }}</div>
                <div class="dependency-dialog-header__file-name">
                  {{ fileLabel }}：{{ fileName || '--' }}
                </div>
              </div>

              <div class="dependency-dialog-header__actions">
                <button
                  v-if="showTranslateButton"
                  type="button"
                  class="dependency-translate-button"
                  :disabled="translateLoading || translateDisabled"
                  @click="emitTranslateList"
                >
                  {{ translateLoading ? $t('ui.translating') : (translateButtonText ?? $t('ui.translateDependencies')) }}
                </button>

                <button
                  type="button"
                  class="dependency-dialog-close-button"
                  :aria-label="$t('ui.closeDialog')"
                  @click="emitClose"
                >
                  <span></span>
                  <span></span>
                </button>
              </div>
            </div>

            <p class="dependency-dialog-header__summary">
              {{ summaryText || $t('ui.noDependenciesNeedAttention') }}
            </p>

            <div class="dependency-dialog-stat-grid">
              <div
                v-for="item in statCards"
                :key="item.label"
                class="dependency-dialog-stat-card"
                :class="`is-${item.tone}`"
              >
                <div class="dependency-dialog-stat-card__label">{{ item.label }}</div>
                <div class="dependency-dialog-stat-card__value">{{ item.value }}</div>
              </div>
            </div>
          </header>

          <div class="nexus-dependency-dialog__body">
            <div class="dependency-dialog-scroll-area">
              <section class="dependency-strategy-panel">
                <div class="dependency-strategy-panel__main">
                  <div class="dependency-strategy-panel__title">{{ $t('ui.chooseHowToHandleDependencies') }}</div>
                  <div class="dependency-strategy-panel__desc">
                    {{ strategyDescription }}
                  </div>
                </div>
                <div class="dependency-strategy-panel__chips">
                  <span class="dependency-strategy-chip">{{ currentOnlyActionText }}</span>
                  <span class="dependency-strategy-chip is-primary">
                    {{ withDependenciesActionText }}
                  </span>
                </div>
              </section>

              <div v-if="defaultDependencyNoticeText" class="dependency-default-notice">
                {{ defaultDependencyNoticeText }}
              </div>

              <section class="dependency-entry-section">
                <div class="dependency-entry-section__head">
                  <div class="dependency-entry-section__title">{{ $t('ui.dependenciesVariant2') }}</div>
                  <div class="dependency-entry-section__count">
                    {{ safeEntries.length }} {{ $t('ui.visibleDependencies') }}
                  </div>
                </div>

                <div v-if="safeEntries.length" class="dependency-entry-list">
                  <article
                    v-for="entry in safeEntries"
                    :key="entry.key"
                    class="dependency-entry-card"
                    :class="`is-${entry.status}`"
                  >
                    <div class="dependency-entry-card__cover">
                      <img v-if="entry.coverUrl" :src="entry.coverUrl" :alt="entry.name" />
                      <div v-else class="dependency-entry-card__cover-placeholder">
                        {{
                          String(entry.name || '?')
                            .trim()
                            .slice(0, 1) || '?'
                        }}
                      </div>
                    </div>

                    <div class="dependency-entry-card__main">
                      <div class="dependency-entry-card__title-row">
                        <div class="dependency-entry-card__title-shell">
                          <div class="dependency-entry-card__title">
                            {{ resolveEntryDisplayName(entry) }}
                          </div>
                          <div
                            v-if="shouldShowOriginalName(entry)"
                            class="dependency-entry-card__title-original"
                          >
                            {{ entry.name }}
                          </div>
                        </div>
                        <span class="dependency-entry-card__badge" :class="`is-${entry.status}`">
                          {{ entry.statusText }}
                        </span>
                      </div>

                      <div class="dependency-entry-card__meta">
                        <span>{{ entry.sourceText }}</span>
                        <span v-if="entry.modIdText">{{ entry.modIdText }}</span>
                      </div>

                      <div v-if="entry.noteText" class="dependency-entry-card__note">
                        {{ entry.noteText }}
                      </div>
                    </div>

                    <div class="dependency-entry-card__side">
                      <button
                        v-if="entry.url"
                        type="button"
                        class="dependency-link-button"
                        @click="emit('open-reference', entry)"
                      >
                        {{ $t('modBrowser.details') }}
                      </button>
                    </div>
                  </article>
                </div>

                <div v-else class="dependency-entry-empty">
                  {{ resolvedEmptyText }}
                </div>
              </section>

              <section v-if="safeDlcRequirements.length" class="dependency-dlc-panel">
                <div class="dependency-dlc-panel__title">{{ $t('ui.dLCRequirements') }}</div>
                <div class="dependency-dlc-panel__list">
                  <div
                    v-for="item in safeDlcRequirements"
                    :key="item.id || item.name"
                    class="dependency-dlc-panel__item"
                  >
                    <span>{{ item.name || '--' }}</span>
                    <span v-if="item.notes">{{ item.notes }}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <footer class="nexus-dependency-dialog__footer">
            <button type="button" class="dependency-action-button is-secondary" @click="emitClose">
              {{ $t('ui.cancel') }}
            </button>
            <button
              type="button"
              class="dependency-action-button is-ghost"
              @click="emitSubmit('current_only')"
            >
              {{ currentOnlyActionText }}
            </button>
            <button
              type="button"
              class="dependency-action-button is-primary"
              @click="emitSubmit('with_dependencies')"
            >
              {{ withDependenciesActionText }}
            </button>
          </footer>
        </section>
      </div>
    </transition>
  </teleport>
</template>

<style scoped lang="scss">
.nexus-dependency-dialog {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.nexus-dependency-dialog__backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent 26%),
    radial-gradient(circle at right center, rgba(14, 165, 233, 0.05), transparent 24%),
    rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(12px);
}

.nexus-dependency-dialog__panel {
  --dependency-radius: 11px;
  position: relative;
  width: min(980px, calc(100vw - 40px));
  height: min(82vh, 860px);
  max-height: calc(100vh - 40px);
  min-height: 580px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--dependency-radius);
  background: linear-gradient(180deg, rgba(247, 249, 252, 0.98) 0%, rgba(236, 240, 245, 0.96) 100%);
}

.nexus-dependency-dialog__header {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px 14px;
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.98) 0%,
    rgba(24, 32, 48, 0.97) 58%,
    rgba(31, 41, 55, 0.96) 100%
  );
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  color: #e2e8f0;
}

.dependency-dialog-header__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dependency-dialog-header__actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.dependency-dialog-header__title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dependency-dialog-header__title {
  margin: 0;
  color: #f8fafc;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
}

.dependency-dialog-header__mod-name {
  color: #cbd5e1;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.dependency-dialog-header__file-name {
  color: rgba(226, 232, 240, 0.78);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.dependency-dialog-close-button,
.dependency-translate-button,
.dependency-link-button,
.dependency-action-button {
  appearance: none;
  border: none;
  outline: none;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;
}

.dependency-dialog-close-button {
  position: relative;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.06);
}

.dependency-translate-button {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  background: rgba(37, 99, 235, 0.18);
  color: #dbeafe;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.dependency-translate-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.34);
  background: rgba(59, 130, 246, 0.24);
  box-shadow: 0 12px 22px rgba(2, 132, 199, 0.14);
}

.dependency-dialog-close-button span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 15px;
  height: 1.6px;
  border-radius: 999px;
  background: #cbd5e1;
}

.dependency-dialog-close-button span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.dependency-dialog-close-button span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.dependency-dialog-close-button:hover {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.32);
  background: rgba(14, 165, 233, 0.12);
  box-shadow: 0 10px 20px rgba(2, 132, 199, 0.14);
}

.dependency-dialog-header__summary {
  margin: 0;
  color: rgba(226, 232, 240, 0.78);
  font-size: 12px;
  line-height: 1.65;
}

.dependency-dialog-stat-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.dependency-dialog-stat-card {
  min-height: 74px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.22);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.dependency-dialog-stat-card.is-pending {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.24), rgba(14, 165, 233, 0.12));
  border-color: rgba(96, 165, 250, 0.3);
}

.dependency-dialog-stat-card.is-manual {
  background: linear-gradient(180deg, rgba(249, 115, 22, 0.2), rgba(194, 65, 12, 0.08));
  border-color: rgba(251, 146, 60, 0.26);
}

.dependency-dialog-stat-card.is-installed {
  background: linear-gradient(180deg, rgba(22, 163, 74, 0.22), rgba(21, 128, 61, 0.08));
  border-color: rgba(74, 222, 128, 0.22);
}

.dependency-dialog-stat-card__label {
  color: rgba(226, 232, 240, 0.66);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dependency-dialog-stat-card__value {
  margin-top: 6px;
  color: #f8fafc;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.nexus-dependency-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.06), transparent 20%),
    linear-gradient(180deg, rgba(245, 247, 250, 0.94) 0%, rgba(235, 240, 244, 0.96) 100%);
}

.dependency-dialog-scroll-area {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px 18px;
  scrollbar-gutter: stable;
}

.dependency-dialog-scroll-area::-webkit-scrollbar {
  width: 8px;
}

.dependency-dialog-scroll-area::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.42);
  border: 1px solid transparent;
  background-clip: padding-box;
}

.dependency-strategy-panel {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(191, 219, 254, 0.88);
  background: linear-gradient(180deg, rgba(239, 246, 255, 0.98), rgba(248, 250, 252, 0.94));
}

.dependency-strategy-panel__main {
  min-width: 0;
}

.dependency-strategy-panel__title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.dependency-strategy-panel__desc {
  margin-top: 6px;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.dependency-strategy-panel__chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dependency-strategy-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.92);
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.dependency-strategy-chip.is-primary {
  border-color: rgba(96, 165, 250, 0.32);
  background: rgba(219, 234, 254, 0.96);
  color: #1d4ed8;
}

.dependency-default-notice {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(255, 255, 255, 0.84);
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.dependency-entry-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dependency-entry-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dependency-entry-section__title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.dependency-entry-section__count {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.dependency-entry-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dependency-entry-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 108px;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(203, 213, 225, 0.88);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
}

.dependency-entry-card.is-pending {
  border-color: rgba(96, 165, 250, 0.34);
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(255, 255, 255, 0.94));
}

.dependency-entry-card.is-manual {
  border-color: rgba(251, 146, 60, 0.26);
  background: linear-gradient(180deg, rgba(255, 251, 235, 0.98), rgba(255, 255, 255, 0.94));
}

.dependency-entry-card.is-installed {
  border-color: rgba(74, 222, 128, 0.24);
  background: linear-gradient(180deg, rgba(240, 253, 244, 0.98), rgba(255, 255, 255, 0.94));
}

.dependency-entry-card__cover {
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(226, 232, 240, 0.92));
}

.dependency-entry-card__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dependency-entry-card__cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 24px;
  font-weight: 700;
}

.dependency-entry-card__main {
  min-width: 0;
}

.dependency-entry-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dependency-entry-card__title-shell {
  min-width: 0;
  flex: 1;
}

.dependency-entry-card__title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  word-break: break-word;
}

.dependency-entry-card__title-original {
  margin-top: 4px;
  color: #7b8da8;
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dependency-entry-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.dependency-entry-card__badge.is-pending {
  background: rgba(219, 234, 254, 0.96);
  color: #1d4ed8;
}

.dependency-entry-card__badge.is-manual {
  background: rgba(255, 237, 213, 0.96);
  color: #c2410c;
}

.dependency-entry-card__badge.is-installed {
  background: rgba(220, 252, 231, 0.96);
  color: #15803d;
}

.dependency-entry-card__meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.dependency-entry-card__note {
  margin-top: 8px;
  color: #334155;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.dependency-entry-card__side {
  display: flex;
  justify-content: flex-end;
}

.dependency-link-button {
  min-width: 92px;
  height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.dependency-link-button:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.34);
  background: rgba(239, 246, 255, 0.98);
  color: #1d4ed8;
}

.dependency-entry-empty {
  padding: 32px 18px;
  border-radius: 12px;
  border: 1px dashed rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.8);
  color: #64748b;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
}

.dependency-dlc-panel {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(248, 250, 252, 0.96);
}

.dependency-dlc-panel__title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.dependency-dlc-panel__list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dependency-dlc-panel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

.nexus-dependency-dialog__footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px 18px;
  border-top: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(255, 255, 255, 0.84);
}

.dependency-action-button {
  min-width: 124px;
  height: 40px;
  padding: 0 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
}

.dependency-action-button.is-secondary,
.dependency-action-button.is-ghost {
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
}

.dependency-action-button.is-secondary:hover,
.dependency-action-button.is-ghost:hover {
  transform: translateY(-1px);
  border-color: rgba(148, 163, 184, 0.96);
  background: rgba(248, 250, 252, 0.98);
}

.dependency-action-button.is-primary {
  border: 1px solid #2563eb;
  background: linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.18);
}

.dependency-action-button.is-primary:hover {
  transform: translateY(-1px);
}

.nexus-dependency-dialog-fade-enter-active,
.nexus-dependency-dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.nexus-dependency-dialog-fade-enter-from,
.nexus-dependency-dialog-fade-leave-to {
  opacity: 0;
}
@media (max-height: 760px) {
  .nexus-dependency-dialog__header {
    padding: 14px 16px 12px;
  }

  .dependency-dialog-header__title {
    font-size: 20px;
  }

  .dependency-dialog-header__mod-name {
    font-size: 15px;
  }
}
</style>
