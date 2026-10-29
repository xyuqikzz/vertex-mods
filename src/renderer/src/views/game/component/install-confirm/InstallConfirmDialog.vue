<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, ref, watch } from 'vue'
import { VxButton, VxModal, VxSegmented } from '@renderer/component/vertex-ui'
import InstallSelectionList from './InstallSelectionList.vue'
import InstallPlanPanel from './InstallPlanPanel.vue'

// 统一的模组安装确认弹窗。各来源只负责把自己的数据整理成这里的 props，
// 选择、计划栏、按钮文案的展示规则都在这里，见 design/2026-10-21_模组安装确认弹窗UI重设计方案.md。
const props = defineProps({
  open: { type: Boolean, default: false },
  // install / download / switch，决定头部标签。
  mode: { type: String, default: 'install' },
  title: { type: String, default: '' },
  originalTitle: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  subtitleMono: { type: Boolean, default: false },
  iconUrl: { type: String, default: '' },
  fallbackInitial: { type: String, default: '' },
  sourceLabel: { type: String, default: '' },
  // 头部第二行：[{ text, mono }] 或字符串。
  meta: { type: Array, default: () => [] },

  loading: { type: Boolean, default: false },
  loadingText: { type: String, default: undefined },
  errorText: { type: String, default: '' },
  errorTitle: { type: String, default: undefined },
  errorDescription: {
    type: String,
    default: undefined
  },
  retryable: { type: Boolean, default: false },
  emptyText: { type: String, default: undefined },
  busy: { type: Boolean, default: false },

  selectionType: { type: String, default: 'multi' },
  selectionTitle: { type: String, default: '' },
  selectionCaption: { type: String, default: '' },
  nameLabel: { type: String, default: undefined },
  groups: { type: Array, default: () => [] },
  activeGroup: { type: String, default: '' },
  columns: { type: Array, default: () => [] },
  items: { type: Array, default: () => [] },
  selectedKeys: { type: Array, default: () => [] },
  sharedDescription: { type: String, default: '' },
  listHint: { type: String, default: '' },
  historyLabel: { type: String, default: undefined },
  countUnit: { type: String, default: undefined },

  planTitle: { type: String, default: undefined },
  target: { type: Array, default: () => [] },
  notice: { type: Object, default: null },
  showSelected: { type: Boolean, default: undefined },
  versionSummary: { type: Object, default: null },
  dependencies: { type: Object, default: null },
  total: { type: Object, default: null },

  // 底部左侧工具按钮（如翻译）：{ label, loading, disabled, pressed }。
  tool: { type: Object, default: null },
  toolNote: { type: String, default: '' },
  footerHint: { type: String, default: '' },
  // 底部右侧按钮，从左到右：[{ key, label, variant, disabled, loading }]。
  actions: { type: Array, default: () => [] },
  cancelLabel: { type: String, default: undefined }
})

const emit = defineEmits([
  'close',
  'update:selectedKeys',
  'update:activeGroup',
  'action',
  'tool',
  'retry',
  'dependency-toggle',
  'dependency-action',
  'notice-action'
])

const dialogId = `icd-${Math.random().toString(36).slice(2, 10)}`
const bodyRef = ref(null)
const localGroup = ref('')
const showHistory = ref(false)
const iconFailed = ref(false)

const isMulti = computed(() => props.selectionType === 'multi')
const hasGroups = computed(() => props.groups.length > 1)
const currentGroup = computed(() => {
  const keys = props.groups.map((group) => String(group.key))
  const preferred = String(props.activeGroup || localGroup.value || '')
  return keys.includes(preferred) ? preferred : keys[0] || ''
})
const regularItems = computed(() => props.items.filter((item) => !item.history))
const historyItems = computed(() => props.items.filter((item) => item.history))
const visibleItems = computed(() => {
  const current = hasGroups.value
    ? regularItems.value.filter((item) => String(item.group || '') === currentGroup.value)
    : regularItems.value
  return showHistory.value ? [...current, ...historyItems.value] : current
})
const groupOptions = computed(() =>
  props.groups.map((group) => {
    const count = regularItems.value.filter(
      (item) => String(item.group || '') === String(group.key)
    ).length
    return { value: String(group.key), label: `${group.label} ${count}` }
  })
)
const selectedSet = computed(() => new Set(props.selectedKeys.map((key) => String(key))))
const selectedItems = computed(() =>
  props.items.filter((item) => selectedSet.value.has(String(item.key)))
)
const selectedFiles = computed(() =>
  selectedItems.value.map((item) => ({ key: item.key, title: item.title, sizeText: item.sizeText }))
)
const shouldShowSelected = computed(() =>
  props.showSelected === undefined ? isMulti.value : props.showSelected
)
const isError = computed(() => !props.loading && Boolean(String(props.errorText || '').trim()))
const isEmpty = computed(() => !props.loading && !isError.value && props.items.length === 0)
const showPlan = computed(() => !isError.value && !isEmpty.value)
const headerInitial = computed(() => {
  // 跳过开头的括号等标点，例如「（不适合工作场合）角色视觉替换」取「不」。
  const text = String(props.fallbackInitial || props.title || '')
  const match = text.match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : '?'
})
const modeTag = computed(() => {
  if (props.mode === 'switch') return { get text() { return uiText('ui.switchVersion') }, tone: 'accent' }
  if (props.mode === 'download') return { get text() { return uiText('ui.downloadOnly') }, tone: 'neutral' }
  return { get text() { return uiText('modBrowser.install') }, tone: 'accent' }
})
const metaItems = computed(() =>
  props.meta
    .map((item) => (typeof item === 'string' ? { text: item } : item))
    .filter((item) => item && String(item.text || '').trim())
)
const countText = computed(() => {
  if (!isMulti.value || props.loading) return ''
  return `${selectedItems.value.length} / ${props.items.length}`
})

function close() {
  if (props.busy) return
  emit('close')
}

function handleModelValue(value) {
  if (!value) close()
}

function setGroup(value) {
  localGroup.value = String(value)
  emit('update:activeGroup', String(value))
}

function toggleKey(key, checked) {
  if (props.busy) return
  const next = new Set(props.selectedKeys.map((item) => String(item)))
  if (checked) next.add(String(key))
  else next.delete(String(key))
  emit('update:selectedKeys', [...next])
}

function selectKey(key) {
  if (props.busy) return
  emit('update:selectedKeys', [String(key)])
}

function toggleAll(checked) {
  if (props.busy) return
  const next = new Set(props.selectedKeys.map((item) => String(item)))
  for (const item of visibleItems.value) {
    if (item.disabled) continue
    if (checked) next.add(String(item.key))
    else next.delete(String(item.key))
  }
  emit('update:selectedKeys', [...next])
}

function focusFirstChoice() {
  const root = bodyRef.value
  if (!root) return
  const target =
    root.querySelector('.icd-row input:checked:not(:disabled)') ||
    root.querySelector('.icd-row input:not(:disabled)')
  target?.focus()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    showHistory.value = false
    iconFailed.value = false
    localGroup.value = ''
    // VxModal 先把焦点放到第一个可聚焦元素（关闭按钮），这里再移到列表里的选择框。
    nextTick(() => requestAnimationFrame(focusFirstChoice))
  },
  { immediate: true }
)

watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (props.open && wasLoading && !loading) nextTick(focusFirstChoice)
  }
)

watch(
  () => props.iconUrl,
  () => {
    iconFailed.value = false
  }
)
</script>

<template>
  <VxModal
    :model-value="open"
    plain
    :aria-label="title || $t('hero.install')"
    :close-on-esc="!busy"
    :close-on-overlay="!busy && !loading"
    panel-class="icd-modal-panel"
    @update:model-value="handleModelValue"
  >
    <div class="icd-dialog" :aria-busy="loading || busy">
      <header class="icd-header">
        <div class="icd-header__icon" aria-hidden="true">
          <img v-if="iconUrl && !iconFailed" :src="iconUrl" alt="" @error="iconFailed = true" />
          <span v-else>{{ headerInitial }}</span>
        </div>
        <div class="icd-header__text">
          <div class="icd-header__title-line">
            <h2 :id="`${dialogId}-title`" class="icd-header__title" :title="title">
              {{ title || '--' }}
            </h2>
            <span
              v-if="originalTitle || subtitle"
              class="icd-header__sub"
              :class="{ 'icd-mono': subtitleMono && !originalTitle }"
            >
              {{ originalTitle || subtitle }}
            </span>
            <span class="icd-tag" :class="`is-${modeTag.tone}`">{{ modeTag.text }}</span>
          </div>
          <p class="icd-header__meta">
            <span v-if="sourceLabel" class="icd-tag is-outline">{{ sourceLabel }}</span>
            <template v-for="(item, index) in metaItems" :key="`${index}-${item.text}`">
              <span v-if="index > 0 || sourceLabel" class="icd-header__dot" aria-hidden="true"
                >·</span
              >
              <span :class="{ 'icd-mono': item.mono }">{{ item.text }}</span>
            </template>
          </p>
        </div>
        <button
          type="button"
          class="icd-icon-button icd-header__close"
          :aria-label="$t('ui.close')"
          :disabled="busy"
          @click="close"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
      </header>

      <div v-if="isError" class="icd-state" role="alert">
        <span class="icd-state__icon is-danger" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5a7 7 0 0 1 11-5.7" />
            <path d="M19 11.5a7 7 0 0 1-11 5.7" />
            <path d="M3 3l18 18" />
          </svg>
        </span>
        <h3>{{ (errorTitle ?? $t('ui.fileListFailed')) }}</h3>
        <p>{{ (errorDescription ?? $t('ui.fileListFailedHint')) }}</p>
        <code class="icd-mono">{{ errorText }}</code>
        <VxButton
          v-if="retryable"
          variant="primary"
          class="icd-state__action"
          @click="emit('retry')"
        >
          {{ $t('tools.retry') }}
        </VxButton>
      </div>

      <div v-else-if="isEmpty" class="icd-state">
        <span class="icd-state__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
            <path d="M4 7.5l2-3.5h12l2 3.5" />
            <path d="M9.5 12h5" />
          </svg>
        </span>
        <h3>{{ $t('ui.noFilesAvailable') }}</h3>
        <p>{{ (emptyText ?? $t('ui.theAuthorHasNotProvidedADirectlyDownloadableFileCheck')) }}</p>
      </div>

      <div v-else class="icd-body">
        <section
          ref="bodyRef"
          class="icd-select"
          :aria-label="selectionTitle || (isMulti ? $t('modBrowser.selectFile') : $t('tools.chooseVersion'))"
          :aria-busy="loading"
        >
          <div class="icd-toolbar">
            <div v-if="hasGroups && !loading" class="icd-toolbar__groups">
              <VxSegmented
                :model-value="currentGroup"
                :options="groupOptions"
                @update:model-value="setGroup"
              />
            </div>
            <h3 v-else-if="selectionTitle" class="icd-toolbar__title">{{ selectionTitle }}</h3>
            <span v-else class="icd-skeleton is-tabs" aria-hidden="true"></span>
            <span v-if="loading" class="icd-toolbar__caption" role="status">
              <span class="icd-spinner" aria-hidden="true"></span>
              {{ (loadingText ?? $t('ui.loadingFileList')) }}
            </span>
            <span v-else-if="countText" class="icd-toolbar__caption" role="status">
              {{ $t('tools.selected2') }} <strong class="icd-mono">{{ selectedItems.length }}</strong> / {{ items.length }}
              {{ (countUnit ?? $t('ui.filesVariant2')) }}
            </span>
            <span v-else-if="selectionCaption" class="icd-toolbar__caption">
              {{ selectionCaption }}
            </span>
          </div>

          <p v-if="sharedDescription && !loading" class="icd-shared">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" />
              <path d="M8 7.2v4" />
              <path d="M8 4.8v.2" />
            </svg>
            <span>{{ sharedDescription }}</span>
          </p>

          <div v-if="loading" class="icd-skeleton-list" aria-hidden="true">
            <div class="icd-skeleton-list__head"></div>
            <div v-for="index in 3" :key="index" class="icd-skeleton-list__row">
              <span class="icd-skeleton is-box"></span>
              <span class="icd-skeleton-list__text">
                <span class="icd-skeleton" :style="{ width: `${[58, 44, 52][index - 1]}%` }"></span>
                <span
                  class="icd-skeleton is-soft"
                  :style="{ width: `${[84, 70, 78][index - 1]}%` }"
                ></span>
              </span>
            </div>
          </div>
          <InstallSelectionList
            v-else
            :type="selectionType"
            :name="dialogId"
            :columns="columns"
            :items="visibleItems"
            :selected-keys="selectedKeys"
            :disabled="busy"
            :name-label="(nameLabel ?? $t('tools.file'))"
            :aria-label="selectionTitle || undefined"
            @toggle="toggleKey"
            @select="selectKey"
            @toggle-all="toggleAll"
          />

          <button
            v-if="historyItems.length && !loading"
            type="button"
            class="icd-link-button"
            :aria-expanded="showHistory"
            @click="showHistory = !showHistory"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" :class="{ 'is-open': showHistory }">
              <path d="M4 6l4 4 4-4" />
            </svg>
            {{ showHistory ? $t('ui.hideHistoricalFiles') : (historyLabel ?? $t('ui.showHistoricalFiles')) }}
          </button>

          <p v-if="listHint && !loading" class="icd-hint">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" />
              <path d="M8 7.2v4" />
              <path d="M8 4.8v.2" />
            </svg>
            {{ listHint }}
          </p>
        </section>

        <InstallPlanPanel
          v-if="showPlan"
          :title="planTitle"
          :target="target"
          :notice="notice"
          :show-selected="shouldShowSelected && !loading"
          :selected-files="selectedFiles"
          :selected-empty-text="
            mode === 'download' ? $t('ui.selectFilesToDownloadOnTheLeft') : $t('ui.selectFilesToInstallOnTheLeft')
          "
          :version-summary="loading ? null : versionSummary"
          :dependencies="dependencies"
          :total="loading ? null : total"
          :disabled="busy"
          @remove="(key) => toggleKey(key, false)"
          @dependency-toggle="(key, checked) => emit('dependency-toggle', key, checked)"
          @dependency-action="(key) => emit('dependency-action', key)"
          @notice-action="emit('notice-action')"
        />
      </div>

      <footer class="icd-footer">
        <template v-if="tool && showPlan">
          <VxButton
            variant="ghost"
            size="sm"
            class="icd-footer__tool"
            :disabled="tool.disabled || tool.loading || loading"
            :aria-pressed="tool.pressed === undefined ? undefined : Boolean(tool.pressed)"
            @click="emit('tool')"
          >
            <span v-if="tool.loading" class="icd-spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 16 16" aria-hidden="true" class="icd-footer__tool-icon">
              <path d="M2 3.5h6" />
              <path d="M5 2v1.5" />
              <path d="M7 3.5c-.4 2.8-2 4.8-4.5 5.8" />
              <path d="M4 6c.8 1.4 2 2.4 3.5 3" />
              <path d="M8.5 14l3-7 3 7" />
              <path d="M9.6 11.6h3.8" />
            </svg>
            {{ tool.label }}
          </VxButton>
          <span v-if="toolNote" class="icd-footer__note">{{ toolNote }}</span>
        </template>
        <span class="icd-footer__spacer"></span>
        <span v-if="footerHint && showPlan && !loading" class="icd-footer__hint" role="status">
          {{ footerHint }}
        </span>
        <VxButton variant="secondary" class="icd-cancel" :disabled="busy" @click="close">
          {{ isError || isEmpty ? $t('ui.close') : (cancelLabel ?? $t('ui.cancel')) }}
        </VxButton>
        <template v-if="showPlan">
          <VxButton
            v-for="action in actions"
            :key="action.key"
            :variant="action.variant || 'secondary'"
            :class="[
              'icd-action',
              `icd-action--${action.key}`,
              { 'is-main': action.variant === 'primary' }
            ]"
            :disabled="loading || action.disabled"
            :loading="action.loading"
            @click="emit('action', action.key)"
          >
            {{ action.label }}
          </VxButton>
        </template>
      </footer>
    </div>
  </VxModal>
</template>

<style lang="scss">
@use './install-confirm.scss';
</style>

<style scoped lang="scss">
.icd-dialog {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(1080px, calc(100vw - 64px));
  min-height: 480px;
  max-height: min(760px, calc(100vh - 64px));
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-family: var(--font-family-base);
  text-align: left;
}

.icd-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}

.icd-header__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--color-surface-strong);
  color: var(--color-text-secondary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.icd-header__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.icd-header__title-line,
.icd-header__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.icd-header__title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icd-header__sub {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icd-header__title-line .icd-tag {
  flex: none;
}

.icd-header__meta {
  gap: 6px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 20px;
  white-space: nowrap;
}

.icd-header__dot {
  color: var(--color-text-subtle);
}

.icd-body {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) 336px;
  min-height: 0;
}

.icd-select {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-4) var(--space-5);
}

.icd-toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 32px;
  margin-bottom: var(--space-3);
}

.icd-toolbar__groups {
  width: min(100%, calc(112px * v-bind('groupOptions.length')));
}

.icd-toolbar__title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 22px;
}

.icd-toolbar__caption {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);

  strong {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
  }

  .icd-spinner {
    width: 12px;
    height: 12px;
    margin: 0;
  }
}

.icd-shared,
.icd-hint {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-size-xs);
  line-height: 20px;

  svg {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
}

.icd-shared {
  flex: none;
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.icd-hint {
  flex: none;
  margin-top: var(--space-3);
  color: var(--color-text-muted);
}

.icd-link-button {
  display: inline-flex;
  flex: none;
  align-self: flex-start;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  margin: var(--space-2) 0 0 calc(-1 * var(--space-2));
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-accent-active);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--duration-fast) var(--ease-standard);

    &.is-open {
      transform: rotate(180deg);
    }
  }

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-accent-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-active);
    outline-offset: 2px;
  }
}

.icd-skeleton {
  display: block;
  height: 12px;
  border-radius: var(--radius-xs);
  background: var(--color-surface-strong);

  &.is-soft {
    height: 10px;
    background: var(--color-bg);
  }

  &.is-box {
    width: 16px;
    height: 16px;
    margin-top: 3px;
  }

  &.is-tabs {
    width: 184px;
    height: 32px;
    border-radius: var(--radius-md);
  }
}

.icd-skeleton-list {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.icd-skeleton-list__head {
  height: 32px;
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.icd-skeleton-list__row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-bg);

  &:last-child {
    border-bottom: 0;
  }
}

.icd-skeleton-list__text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: 5px;
}

.icd-state {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  text-align: center;

  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    line-height: 22px;
  }

  p {
    max-width: 420px;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 20px;
  }

  code {
    max-width: min(420px, 100%);
    box-sizing: border-box;
    margin-top: var(--space-1);
    padding: 6px var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-soft);
    color: var(--color-danger-strong);
    font-size: var(--font-size-xs);
    line-height: 20px;
    overflow-wrap: anywhere;
  }
}

.icd-state__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-surface-strong);
  color: var(--color-text-muted);

  &.is-danger {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.icd-state__action {
  margin-top: var(--space-3);
}

.icd-footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  min-height: 60px;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.icd-footer__tool {
  margin-left: calc(-1 * var(--space-2));
  padding: 0 var(--space-2);

  :deep(.vx-button__content) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .icd-spinner {
    width: 12px;
    height: 12px;
    margin: 0;
  }
}

.icd-footer__tool-icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icd-footer__note,
.icd-footer__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.icd-footer__hint {
  margin-right: var(--space-1);
}

.icd-footer__spacer {
  flex: 1;
}

.icd-action.is-main {
  min-width: 128px;
}

/* 键盘焦点：VxButton 只有浅色外圈，这里补一圈可辨识的描边。 */
.icd-footer :deep(.vx-button:focus-visible) {
  outline: 2px solid var(--color-accent-active);
  outline-offset: 2px;
}

@media (max-width: 960px) {
  .icd-dialog {
    width: calc(100vw - 48px);
  }

  .icd-body {
    grid-template-columns: minmax(0, 1fr) 296px;
  }
}

/* 窄窗口改为单栏，整个主体一起滚动，列表和计划栏不再各自挤压高度。 */
@media (max-width: 760px) {
  .icd-body {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .icd-select {
    flex: none;
    min-height: auto;
  }

  .icd-select :deep(.icd-list) {
    overflow: visible;
  }
}

@media (prefers-reduced-motion: reduce) {
  .icd-link-button svg {
    transition: none;
  }
}
</style>
