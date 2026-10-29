<script setup>
const { t: uiText } = useI18n()

import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { canTranslateModContent } from '@renderer/i18n/content.js'
import { localizeModUiText } from '@renderer/i18n/mod-browser-ui.js'
import Pagination from '@renderer/component/Pagination.vue'
import VxButton from '@renderer/component/vertex-ui/VxButton.vue'
import GameCover from '@views/game/component/index/game-cover.vue'
import { waitForUiRender } from '@renderer/utils/ui-render.js'

const props = defineProps({
  notice: {
    type: Object,
    default: () => ({})
  },
  loading: {
    type: Boolean,
    default: false
  },
  loadingText: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: ''
  },
  items: {
    type: Array,
    default: () => []
  },
  current: {
    type: Number,
    default: 1
  },
  pages: {
    type: Number,
    default: 1
  },
  total: {
    type: Number,
    default: 0
  },
  size: {
    type: Number,
    default: 20
  },
  currentCount: {
    type: Number,
    default: 0
  },
  showPagination: {
    type: Boolean,
    default: true
  },
  floatingActions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'notice-action',
  'open-detail',
  'secondary-action',
  'item-action',
  'install',
  'page-change',
  'translate-item',
  'floating-action'
])

const { t, locale } = useI18n()
const VIEW_MODE_STORAGE_KEY = 'vertex.unifiedModList.viewMode'
const SKELETON_COUNT = 6

const originalTextVisibleMap = ref({})
const viewMode = ref(readViewMode())
const menuState = ref({ item: null, style: {} })
const menuRef = ref(null)
let menuTrigger = null

const visibleFloatingActions = computed(() =>
  (Array.isArray(props.floatingActions) ? props.floatingActions : []).filter(
    (item) => item?.visible !== false && (item?.key !== 'translate-current-page' || canTranslateModContent())
  )
)

const resultSummary = computed(() => {
  const total = Number(props.total || 0)
  const pages = Number(props.pages || 0)
  const current = Number(props.current || 1)
  if (total > 0) {
    return t(pages > 1 ? 'modBrowser.pagedTotal' : 'modBrowser.total', {
      total: total.toLocaleString(locale.value), current, pages: pages.toLocaleString(locale.value)
    })
  }
  return t('modBrowser.page', { current })
})

const viewOptions = computed(() => [
  { value: 'card', label: t('modBrowser.cards') },
  { value: 'list', label: t('modBrowser.list') }
])

// 视图偏好只属于当前用户的本机浏览习惯；读写失败时回到卡片视图。
function readViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

function setViewMode(mode) {
  viewMode.value = mode === 'list' ? 'list' : 'card'
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode.value)
  } catch {
    // 本地存储不可用时只影响偏好记忆
  }
}

function toSafeText(value, fallback = '--') {
  const text = String(value || '').trim()
  return text || fallback
}

function getDisplayTitle(item = {}) {
  if (!canTranslateModContent() || isOriginalTextVisible(item)) {
    return toSafeText(item?.title)
  }

  const translatedTitle = String(item?.translatedTitle || '').trim()
  return toSafeText(translatedTitle || item?.title)
}

function getDisplayDescription(item = {}) {
  if (!canTranslateModContent() || isOriginalTextVisible(item)) {
    return toSafeText(item?.description, t('modBrowser.noDescription'))
  }

  const translatedDescription = String(item?.translatedDescription || '').trim()
  return toSafeText(translatedDescription || item?.description, t('modBrowser.noDescription'))
}

function getVisibleTags(item = {}) {
  return (Array.isArray(item?.tags) ? item.tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 2)
}

function hasTranslation(item = {}) {
  if (!canTranslateModContent()) return false
  return (
    !!String(item?.translatedTitle || '').trim() ||
    !!String(item?.translatedDescription || '').trim()
  )
}

function hasOriginalText(item = {}) {
  if (!canTranslateModContent()) return false
  const original = String(item?.title || '').trim()
  const translated = String(item?.translatedTitle || '').trim()
  const originalDescription = String(item?.description || '').trim()
  const translatedDescription = String(item?.translatedDescription || '').trim()
  return !!(
    (translated && original && translated !== original) ||
    (translatedDescription && originalDescription && translatedDescription !== originalDescription)
  )
}

function getOriginalTextKey(item = {}) {
  return String(item?.id || item?.raw?.id || item?.title || item?.description || '').trim()
}

function isOriginalTextVisible(item = {}) {
  const key = getOriginalTextKey(item)
  return !!(key && originalTextVisibleMap.value[key])
}

function toggleOriginalText(item = {}) {
  if (!hasOriginalText(item)) {
    return
  }

  const key = getOriginalTextKey(item)
  if (!key) {
    return
  }

  originalTextVisibleMap.value = {
    ...originalTextVisibleMap.value,
    [key]: !originalTextVisibleMap.value[key]
  }
}

function getTranslationBadgeText(item = {}) {
  if (isOriginalTextVisible(item)) return t('modBrowser.originalText')
  return t('modBrowser.microsoftTranslation')
}

function getOriginalToggleText(item = {}) {
  return isOriginalTextVisible(item)
    ? t('modBrowser.showTranslation')
    : t('modBrowser.showOriginal')
}

// 显示译名时，在旁边用弱化文字补充来源原名，方便和来源站点对照。
function getOriginalTitle(item = {}) {
  if (!hasTranslation(item) || isOriginalTextVisible(item)) return ''
  const original = String(item?.title || '').trim()
  const translated = String(item?.translatedTitle || '').trim()
  return translated && original && translated !== original ? original : ''
}

// 来源适配器若单独提供作者名，配合人像图标展示；否则沿用已拼好的副标题。
function getAuthorText(item = {}) {
  const author = String(item?.author || '').trim()
  return author && author !== '--' ? author : String(item?.subtitle || '').trim()
}

function getDownloadText(item = {}) {
  const count = formatDownloadCount(item?.downloadCount)
  return count ? t('modBrowser.downloadCount', { count }) : ''
}

function isUpdatable(item = {}) {
  return getInstalledState(item).updatable
}

function formatDownloadCount(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value).trim()
  if (number <= 0) return ''
  if (locale.value.startsWith('en')) return new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(number)
  if (number >= 1e8) return uiText('ui.value100000000', { value1: ((number / 1e8).toFixed(1).replace(/\.0$/, '')) })
  if (number >= 1e7) return uiText('ui.value10000', { value1: (Math.round(number / 1e4).toLocaleString('zh-CN')) })
  if (number >= 1e4) return uiText('ui.value10000', { value1: ((number / 1e4).toFixed(1).replace(/\.0$/, '')) })
  return number.toLocaleString('zh-CN')
}

// 「已安装 x · 可更新」拆成两段：安装状态用成功色，可更新单独作为提示标签。
function getInstalledState(item = {}) {
  const text = String(item?.installedText || '').trim()
  if (!text) return { text: '', updatable: false }
  const updatable = /可更新/.test(text)
  const cleaned = text
    .replace(/\s*[·•/]\s*可更新/g, '')
    .replace(/可更新/g, '')
    .trim()
  return { text: cleaned, updatable }
}

function getCardExtraActions(item = {}) {
  return (Array.isArray(item?.actionButtons) ? item.actionButtons : []).filter((action) => {
    return action?.visible !== false && !!String(action?.label || '').trim()
  })
}

// 强调色的扩展操作（例如「运行」）直接显示，其余收进「更多」。
function getVisibleExtraActions(item = {}) {
  return getCardExtraActions(item).filter(
    (action) => String(action?.tone || '').trim() === 'accent'
  )
}

function hasInstallAction(item = {}) {
  return item?.installable !== false
}

function showSecondaryAsMain(item = {}) {
  return !hasInstallAction(item) && !!String(item?.secondaryText || '').trim()
}

function getInstallButtonText(item = {}) {
  return item?.installing
    ? localizeModUiText(toSafeText(item.installingText, t('modBrowser.installing')))
    : localizeModUiText(toSafeText(item.installText, t('modBrowser.install')))
}

function getDetailText(item = {}) {
  return localizeModUiText(toSafeText(item?.detailText, t('modBrowser.details')))
}

function getMenuEntries(item = {}) {
  const entries = []
  if (canTranslateModContent() && item.translateActionText && !item.translateHidden) {
    entries.push({
      key: 'translate',
      label: item.translateActionText,
      disabled: !!item.translateDisabled
    })
  }
  if (hasOriginalText(item)) {
    entries.push({
      key: 'toggle-original',
      label: getOriginalToggleText(item)
    })
  }
  entries.push({ key: 'detail', label: getDetailText(item) })
  getCardExtraActions(item)
    .filter((action) => String(action?.tone || '').trim() !== 'accent')
    .forEach((action) => {
      entries.push({
        key: `action:${action.key || action.label}`,
        label: toSafeText(action.label, t('modBrowser.action')),
        title: action.title || '',
        disabled: !!action.disabled,
        action
      })
    })
  if (!showSecondaryAsMain(item) && String(item?.secondaryText || '').trim()) {
    entries.push({
      key: 'secondary',
      label: localizeModUiText(item.secondaryText),
      disabled: !!item.secondaryDisabled
    })
  }
  return entries
}

const menuEntries = computed(() =>
  menuState.value.item ? getMenuEntries(menuState.value.item) : []
)

function onPageChange(page) {
  emit('page-change', page)
}

function handleOpenDetail(item = {}) {
  emit('open-detail', item)
}

function positionMenu(trigger) {
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const padding = 12
  const width = 196
  const height = menuRef.value?.scrollHeight || 200
  const below = window.innerHeight - rect.bottom - padding - 4
  const upwards = below < height && rect.top > below
  menuState.value = {
    ...menuState.value,
    style: {
      left: `${Math.max(padding, Math.min(rect.right - width, window.innerWidth - width - padding))}px`,
      top: `${upwards ? Math.max(padding, rect.top - height - 4) : rect.bottom + 4}px`,
      width: `${width}px`
    }
  }
}

async function openMenu(item, event) {
  if (menuState.value.item === item) {
    closeMenu(true)
    return
  }
  menuTrigger = event?.currentTarget || null
  menuState.value = { item, style: {} }
  positionMenu(menuTrigger)
  await nextTick()
  positionMenu(menuTrigger)
  menuRef.value?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
}

function closeMenu(restoreFocus = false) {
  if (!menuState.value.item) return
  menuState.value = { item: null, style: {} }
  if (restoreFocus === true) menuTrigger?.focus?.()
  menuTrigger = null
}

function handleMenuEntry(entry = {}) {
  const item = menuState.value.item
  if (!item || entry.disabled) return
  closeMenu(true)
  if (entry.key === 'translate') emit('translate-item', item)
  else if (entry.key === 'toggle-original') toggleOriginalText(item)
  else if (entry.key === 'detail') handleOpenDetail(item)
  else if (entry.key === 'secondary') emit('secondary-action', item)
  else if (entry.action) emit('item-action', { item, action: entry.action })
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'Tab') {
    closeMenu(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const entries = [...(menuRef.value?.querySelectorAll('button:not(:disabled)') || [])]
    if (!entries.length) return
    const index = entries.indexOf(document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
    entries[next].focus()
  }
}

function handleOutsidePointer(event) {
  if (!menuState.value.item) return
  if (menuRef.value?.contains(event.target) || menuTrigger?.contains?.(event.target)) return
  closeMenu()
}

function handleViewportChange() {
  if (menuState.value.item) closeMenu()
}

function getFloatingActionText(action = {}) {
  if (action?.loading) {
    const total = Number(action?.progressTotal || 0)
    const current = Math.max(0, Math.min(Number(action?.progressCurrent || 0), total))
    return total > 0
      ? t('modBrowser.translatingProgress', { current, total })
      : t('modBrowser.translating')
  }
  if (action?.disabled) return t('modBrowser.pageTranslated')
  return t('modBrowser.translatePage')
}

async function onFloatingActionClick(action = {}) {
  if (action?.disabled || action?.loading) {
    return
  }

  // 先让点击态完成一次渲染，再交给父级进入翻译流程，降低点击瞬间的卡顿感。
  await waitForUiRender()
  emit('floating-action', action)
}

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onDeactivated(() => closeMenu())

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div class="unified-mod-list">
    <div v-if="notice?.show" class="list-state is-notice" role="status">
      <span class="list-state__icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 11h12v9H6z" />
          <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
        </svg>
      </span>
      <strong>{{ localizeModUiText(toSafeText(notice?.title, t('modBrowser.unavailable'))) }}</strong>
      <p>{{ toSafeText(notice?.text, t('modBrowser.checkConfiguration')) }}</p>
      <VxButton v-if="notice?.actionText" variant="soft" size="sm" @click="emit('notice-action')">
        {{ localizeModUiText(notice.actionText) }}
      </VxButton>
    </div>

    <template v-else>
      <!-- 结果栏：数量 / 翻译本页 / 视图切换 -->
      <div v-if="!loading && items.length" class="list-bar">
        <p class="list-bar__summary">{{ resultSummary }}</p>
        <div class="list-bar__tools">
          <VxButton
            v-for="action in visibleFloatingActions"
            :key="action.key || action.label"
            variant="secondary"
            size="sm"
            class="list-bar__translate"
            :disabled="!!action.disabled || !!action.loading"
            :aria-busy="!!action.loading"
            :title="localizeModUiText(action.label) || t('modBrowser.translatePage')"
            @click="onFloatingActionClick(action)"
          >
            <span class="button-inner">
              <svg v-if="action.loading" class="spin" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" opacity="0.25" />
                <path d="M12 3a9 9 0 0 1 9 9" />
              </svg>
              <svg v-else-if="action.disabled" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h9M8.5 3v2M11 5c-.8 3.5-3.3 6.5-6.5 8M6.5 8.5c1 2 2.6 3.6 4.5 4.5" />
                <path d="m13 21 4-10 4 10M14.5 17.5h5" />
              </svg>
              {{ getFloatingActionText(action) }}
            </span>
          </VxButton>

          <div class="view-toggle" role="group" :aria-label="t('modBrowser.view')">
            <button
              v-for="option in viewOptions"
              :key="option.value"
              type="button"
              class="view-toggle__item"
              :class="{ 'is-active': viewMode === option.value }"
              :aria-pressed="viewMode === option.value"
              :aria-label="option.label"
              :title="option.label"
              @click="setViewMode(option.value)"
            >
              <svg v-if="option.value === 'card'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 加载中 -->
      <div
        v-if="loading"
        class="mod-grid"
        :aria-label="loadingText || t('modBrowser.loading')"
        aria-busy="true"
      >
        <div v-for="n in SKELETON_COUNT" :key="n" class="mod-card is-skeleton" aria-hidden="true">
          <div class="mod-card__media"></div>
          <div class="mod-card__body skeleton-lines">
            <span class="skeleton" style="width: 56%; height: 14px"></span>
            <span class="skeleton" style="width: 32%"></span>
            <span class="skeleton" style="width: 94%"></span>
            <span class="skeleton" style="width: 70%"></span>
          </div>
          <div class="mod-card__footer">
            <span class="skeleton" style="width: 30%"></span>
            <span class="skeleton" style="width: 72px; height: 32px; margin-left: auto"></span>
          </div>
        </div>
      </div>

      <!-- 空结果 -->
      <div v-else-if="!items.length" class="list-state">
        <span class="list-state__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
            <path d="m20 20-4-4M8.5 8.5l5 5M13.5 8.5l-5 5" />
          </svg>
        </span>
        <strong>{{ emptyText || t('modBrowser.empty') }}</strong>
        <p>{{ t('modBrowser.emptyHint') }}</p>
      </div>

      <!-- 卡片视图 -->
      <div v-else-if="viewMode === 'card'" class="mod-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="mod-card"
          :class="{ 'is-busy': !!item.installing }"
        >
          <button
            type="button"
            class="mod-card__media"
            :aria-label="t('modBrowser.viewDetails', { name: getDisplayTitle(item) })"
            @click="handleOpenDetail(item)"
          >
            <GameCover :src="item.cover || ''" alt="" :fallback-text="item.title" />
          </button>
          <div v-if="getInstalledState(item).text || isUpdatable(item)" class="mod-card__badges">
            <span
              v-if="getInstalledState(item).text"
              class="mod-card__badge is-installed"
              :title="item.installedText"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              {{ getInstalledState(item).text }}
            </span>
            <span v-if="isUpdatable(item)" class="mod-card__badge is-update">
              {{ t('modBrowser.updateAvailable') }}
            </span>
          </div>
          <button
            v-if="hasTranslation(item) && hasOriginalText(item)"
            type="button"
            class="translation-badge is-floating"
            :class="{ 'is-original': isOriginalTextVisible(item) }"
            :aria-pressed="isOriginalTextVisible(item)"
            :title="getOriginalToggleText(item)"
            @click="toggleOriginalText(item)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h9M8.5 3v2M11 5c-.8 3.5-3.3 6.5-6.5 8M6.5 8.5c1 2 2.6 3.6 4.5 4.5" />
              <path d="m13 21 4-10 4 10M14.5 17.5h5" />
            </svg>
            {{ getTranslationBadgeText(item) }}
          </button>
          <span v-else-if="hasTranslation(item)" class="translation-badge is-floating">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h9M8.5 3v2M11 5c-.8 3.5-3.3 6.5-6.5 8M6.5 8.5c1 2 2.6 3.6 4.5 4.5" />
              <path d="m13 21 4-10 4 10M14.5 17.5h5" />
            </svg>
            {{ getTranslationBadgeText(item) }}
          </span>

          <div class="mod-card__body">
            <div class="mod-card__title-row">
              <button
                type="button"
                class="mod-card__title"
                :title="getDisplayTitle(item)"
                @click="handleOpenDetail(item)"
              >
                {{ getDisplayTitle(item) }}
              </button>
              <span
                v-if="getOriginalTitle(item)"
                class="mod-card__original"
                :title="getOriginalTitle(item)"
              >
                {{ getOriginalTitle(item) }}
              </span>
            </div>
            <p
              v-if="getAuthorText(item) || getVisibleTags(item).length"
              class="mod-card__meta-line"
            >
              <span
                v-if="getAuthorText(item)"
                class="mod-card__subtitle"
                :title="getAuthorText(item)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="8.5" r="3.75" />
                  <path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
                </svg>
                <span class="mod-card__subtitle-text">{{ getAuthorText(item) }}</span>
              </span>
              <span
                v-for="(tag, tagIndex) in getVisibleTags(item)"
                :key="`${item.id}-tag-${tagIndex}`"
                class="mod-card__tag"
                :title="tag"
              >
                {{ tag }}
              </span>
            </p>
            <p class="mod-card__desc" :title="getDisplayDescription(item)">
              {{ getDisplayDescription(item) }}
            </p>
          </div>

          <div class="mod-card__footer">
            <span v-if="getDownloadText(item)" class="meta-item">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {{ getDownloadText(item) }}
            </span>
            <span v-if="item.statusText" class="meta-chip is-success">{{ item.statusText }}</span>

            <span class="mod-card__actions">
              <button
                type="button"
                class="more-button"
                :class="{ 'is-open': menuState.item === item }"
                aria-haspopup="menu"
                :aria-expanded="menuState.item === item"
                :aria-label="t('modBrowser.more', { name: getDisplayTitle(item) })"
                @click.stop="openMenu(item, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              <VxButton
                v-for="action in getVisibleExtraActions(item)"
                :key="`${item.id}-extra-${action.key || action.label}`"
                variant="secondary"
                size="sm"
                :disabled="!!action.disabled"
                :title="action.title || ''"
                @click="emit('item-action', { item, action })"
              >
                {{ toSafeText(action.label, t('modBrowser.action')) }}
              </VxButton>
              <VxButton
                v-if="hasInstallAction(item)"
                class="main-action"
                :variant="isUpdatable(item) ? 'primary' : 'secondary'"
                size="sm"
                :disabled="!!item.installDisabled || !!item.installing"
                :aria-busy="!!item.installing"
                @click="emit('install', item)"
              >
                <span class="button-inner">
                  <svg v-if="item.installing" class="spin" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                  </svg>
                  {{ getInstallButtonText(item) }}
                </span>
              </VxButton>
              <VxButton
                v-else-if="showSecondaryAsMain(item)"
                class="main-action"
                :variant="isUpdatable(item) ? 'primary' : 'secondary'"
                size="sm"
                :disabled="!!item.secondaryDisabled"
                @click="emit('secondary-action', item)"
              >
                <span class="button-inner">
                  <svg v-if="isUpdatable(item)" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20V5M6 11l6-6 6 6" />
                  </svg>
                  {{ localizeModUiText(item.secondaryText) }}
                </span>
              </VxButton>
            </span>
          </div>
        </article>
      </div>

      <!-- 列表视图 -->
      <div v-else class="mod-table-wrap vx-ui-scrollbar">
        <div class="mod-table" role="table" :aria-label="t('modBrowser.listLabel')">
          <div class="mod-table__head" role="row">
            <span role="columnheader"
              ><span class="sr-only">{{ t('modBrowser.columnThumbnail') }}</span></span
            >
            <span role="columnheader">{{ t('modBrowser.columnMod') }}</span>
            <span role="columnheader">{{ t('modBrowser.columnSummary') }}</span>
            <span role="columnheader" class="is-right">{{ t('modBrowser.columnDownloads') }}</span>
            <span role="columnheader">{{ t('modBrowser.columnStatus') }}</span>
            <span role="columnheader"
              ><span class="sr-only">{{ t('modBrowser.action') }}</span></span
            >
          </div>
          <div v-for="item in items" :key="item.id" class="mod-table__row" role="row">
            <span role="cell">
              <button
                type="button"
                class="mod-table__thumb"
                :aria-label="t('modBrowser.viewDetails', { name: getDisplayTitle(item) })"
                @click="handleOpenDetail(item)"
              >
                <GameCover :src="item.cover || ''" alt="" :fallback-text="item.title" />
              </button>
            </span>
            <span role="cell" class="mod-table__name">
              <span class="mod-card__title-row">
                <button
                  type="button"
                  class="mod-card__title is-compact"
                  :title="getDisplayTitle(item)"
                  @click="handleOpenDetail(item)"
                >
                  {{ getDisplayTitle(item) }}
                </button>
                <button
                  v-if="hasTranslation(item) && hasOriginalText(item)"
                  type="button"
                  class="translation-badge"
                  :class="{ 'is-original': isOriginalTextVisible(item) }"
                  :aria-pressed="isOriginalTextVisible(item)"
                  :title="getOriginalToggleText(item)"
                  @click="toggleOriginalText(item)"
                >
                  {{ getTranslationBadgeText(item) }}
                </button>
              </span>
              <span v-if="item.subtitle" class="mod-card__subtitle">{{ item.subtitle }}</span>
            </span>
            <span role="cell" class="mod-table__desc" :title="getDisplayDescription(item)">
              {{ getDisplayDescription(item) }}
            </span>
            <span role="cell" class="mod-table__downloads">
              {{ formatDownloadCount(item.downloadCount) || '--' }}
            </span>
            <span role="cell" class="mod-table__status">
              <span
                v-if="getInstalledState(item).text"
                class="meta-installed"
                :title="item.installedText"
              >
                {{ getInstalledState(item).text }}
              </span>
              <span v-if="getInstalledState(item).updatable" class="meta-chip is-warning"
                >{{ t('modBrowser.updateAvailable') }}</span
              >
              <span v-if="!getInstalledState(item).text" class="meta-item">{{
                t('modBrowser.notInstalled')
              }}</span>
            </span>
            <span role="cell" class="mod-card__actions">
              <button
                type="button"
                class="more-button"
                :class="{ 'is-open': menuState.item === item }"
                aria-haspopup="menu"
                :aria-expanded="menuState.item === item"
                :aria-label="t('modBrowser.more', { name: getDisplayTitle(item) })"
                @click.stop="openMenu(item, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              <VxButton
                v-if="hasInstallAction(item)"
                class="main-action"
                variant="secondary"
                size="sm"
                :disabled="!!item.installDisabled || !!item.installing"
                :aria-busy="!!item.installing"
                @click="emit('install', item)"
              >
                <span class="button-inner">
                  <svg v-if="item.installing" class="spin" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </svg>
                  {{ getInstallButtonText(item) }}
                </span>
              </VxButton>
              <VxButton
                v-else-if="showSecondaryAsMain(item)"
                variant="secondary"
                size="sm"
                :disabled="!!item.secondaryDisabled"
                @click="emit('secondary-action', item)"
              >
                {{ localizeModUiText(item.secondaryText) }}
              </VxButton>
            </span>
          </div>
        </div>
      </div>
    </template>

    <pagination
      v-if="showPagination && total > 0 && !loading && !notice?.show"
      :current="current"
      :pages="pages"
      :total="total"
      :size="size"
      :current-count="currentCount || items.length"
      show-jumper
      @change="onPageChange"
    />

    <!-- 「更多」菜单：Teleport 到 body，避免被页面滚动容器裁切 -->
    <Teleport to="body">
      <div
        v-if="menuState.item"
        ref="menuRef"
        class="unified-mod-card-menu"
        role="menu"
        :aria-label="t('modBrowser.more', { name: getDisplayTitle(menuState.item) })"
        :style="menuState.style"
        @keydown="handleMenuKeydown"
      >
        <button
          v-for="entry in menuEntries"
          :key="entry.key"
          type="button"
          role="menuitem"
          class="unified-mod-card-menu__item"
          :disabled="!!entry.disabled"
          :title="entry.title || undefined"
          @click="handleMenuEntry(entry)"
        >
          {{ entry.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.unified-mod-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-2);
  color: var(--color-text);
  font-family: var(--font-family-base);

  svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.button-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  svg {
    width: 15px;
    height: 15px;
  }
}

.spin {
  animation: list-spin 0.9s linear infinite;
}

@keyframes list-spin {
  to {
    transform: rotate(360deg);
  }
}

// ---------- 结果栏 ----------
.list-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  padding: 0 2px;
}

.list-bar__summary {
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.list-bar__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.view-toggle {
  display: flex;
  height: var(--control-height-sm);
  padding: 2px;
  box-sizing: border-box;
  background: var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.view-toggle__item {
  display: grid;
  place-items: center;
  width: 36px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    color: var(--color-text);
  }

  &.is-active {
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }
}

// ---------- 卡片视图 ----------
.mod-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  gap: var(--space-4);
}

.mod-card {
  --mod-card-media-height: 136px;
  --mod-card-icon-size: 84px;

  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-skeleton) {
    border-color: var(--color-border-strong);
    box-shadow: var(--shadow-md);
  }

  // 正在提交任务：描边用主色提示，不在卡片里维护独立进度（进度统一在任务中心）。
  &.is-busy {
    border-color: var(--color-accent);
  }
}

// 封面区：图标模糊铺底，中间放大展示原图标。
.mod-card__media {
  position: relative;
  display: block;
  flex: none;
  width: 100%;
  height: var(--mod-card-media-height);
  padding: 0;
  overflow: hidden;
  background: var(--color-surface-strong);
  border: 0;
  outline: none;
  cursor: pointer;

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  :deep(.game-cover) {
    background: var(--color-surface-strong);
  }

  :deep(.game-cover__ambient) {
    filter: blur(26px) saturate(1.25);
    transform: scale(1.35);
  }

  :deep(.game-cover.is-loaded .game-cover__ambient) {
    opacity: 0.9;
  }

  :deep(.game-cover__art) {
    inset: auto;
    top: 50%;
    left: 50%;
    width: var(--mod-card-icon-size);
    height: var(--mod-card-icon-size);
    object-fit: cover;
    border-radius: var(--radius-lg);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.24),
      var(--shadow-md);
    transform: translate(-50%, -50%);
    transition:
      opacity var(--duration-slow) var(--ease-standard),
      transform var(--duration-base) var(--ease-standard);
  }

  &:hover :deep(.game-cover__art) {
    transform: translate(-50%, -50%) scale(1.04);
  }

  :deep(.game-cover__fallback) {
    font-size: var(--font-size-2xl);
  }
}

.mod-card__badges {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: calc(100% - 120px);
  pointer-events: none;
}

.mod-card__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 22px;
  padding: 0 8px;
  overflow: hidden;
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-pill);

  svg {
    flex: none;
    width: 12px;
    height: 12px;
    stroke-width: 2.6;
  }

  &.is-installed {
    color: var(--color-success-strong);
    background: var(--color-success-soft);
  }

  &.is-update {
    flex: none;
    color: var(--color-warning-strong);
    background: var(--color-warning-soft);
  }
}

.mod-card__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px var(--space-4) 0;
}

.mod-card__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.mod-card__title {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.45;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent-active);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &.is-compact {
    font-size: var(--font-size-md);
  }
}

.mod-card__original {
  flex: 0 10 auto;
  min-width: 48px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.translation-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 5px;
  color: var(--color-accent-strong);
  font-family: var(--font-family-base);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  line-height: 18px;
  background: color-mix(in srgb, var(--color-accent-soft) 60%, var(--color-surface));
  border: 0;
  border-radius: var(--radius-xs);
  outline: none;

  svg {
    flex: none;
    width: 12px;
    height: 12px;
  }

  &:is(button) {
    cursor: pointer;
  }

  &.is-original {
    color: var(--color-text-secondary);
    background: var(--color-surface-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  // 卡片封面右上角：实心浅蓝底，保证在任意封面颜色上都清晰可读。
  &.is-floating {
    position: absolute;
    top: 10px;
    right: 10px;
    height: 22px;
    padding: 0 8px 0 6px;
    background: var(--color-accent-soft);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-sm);

    &.is-original {
      color: var(--color-text-secondary);
      background: var(--color-surface);
    }
  }
}

.mod-card__meta-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.mod-card__subtitle {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;

  svg {
    flex: none;
    width: 13px;
    height: 13px;
  }
}

.mod-card__subtitle-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mod-card__tag {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0 6px;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-surface-soft);
  border-radius: var(--radius-xs);
}

.mod-card__desc {
  display: -webkit-box;
  min-height: calc(2 * 1.6em);
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.mod-card__footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: 56px;
  margin-top: 14px;
  padding: 10px var(--space-3) 10px var(--space-4);
  box-sizing: border-box;
  border-top: 1px solid var(--color-surface-strong);
}

.meta-item {
  display: inline-flex;
  flex: 0 1 auto;
  font-variant-numeric: tabular-nums;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;

  svg {
    flex: none;
    width: 13px;
    height: 13px;
    stroke-width: 2;
  }
}

.meta-installed {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  max-width: 50%;
  overflow: hidden;
  color: var(--color-success-strong);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;

  svg {
    flex: none;
    width: 12px;
    height: 12px;
    stroke-width: 2.6;
  }
}

// 状态用带语义色的文字表达，不再做成一个个小标签。
.meta-chip {
  flex: none;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;

  &.is-warning {
    color: var(--color-warning-strong);
  }

  &.is-success {
    color: var(--color-success-strong);
  }
}

.mod-card__actions {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-left: auto;
}

.more-button {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
    stroke: none;
  }

  &:hover,
  &.is-open {
    color: var(--color-text);
    background: var(--color-surface-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.main-action {
  min-width: 76px;

  .button-inner svg {
    width: 14px;
    height: 14px;
    stroke-width: 2;
  }
}

// ---------- 骨架 ----------
.mod-card.is-skeleton {
  animation: list-pulse 1.4s ease-in-out infinite;

  .mod-card__media {
    cursor: default;
  }
}

.skeleton {
  display: block;
  height: 10px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-xs);
}

.skeleton-lines {
  gap: 10px;
  padding-top: var(--space-4);
}

@keyframes list-pulse {
  50% {
    opacity: 0.55;
  }
}

// ---------- 列表视图 ----------
.mod-table-wrap {
  overflow-x: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mod-table {
  min-width: 980px;
}

.mod-table__head,
.mod-table__row {
  display: grid;
  grid-template-columns: 44px minmax(220px, 2fr) minmax(240px, 3fr) 88px minmax(150px, 1fr) 176px;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-4);
}

.mod-table__head {
  height: 38px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);

  .is-right {
    text-align: right;
  }
}

.mod-table__row {
  min-height: 60px;
  border-bottom: 1px solid var(--color-surface-strong);
  transition: background var(--duration-fast) var(--ease-standard);

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--color-surface-hover);
  }
}

.mod-table__thumb {
  position: relative;
  display: block;
  width: 44px;
  height: 44px;
  padding: 0;
  overflow: hidden;
  background: var(--color-surface-strong);
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  :deep(.game-cover__fallback) {
    font-size: var(--font-size-xs);
  }
}

.mod-table__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mod-table__desc {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mod-table__downloads {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-sm);
  text-align: right;
  white-space: nowrap;
}

.mod-table__status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  .meta-installed {
    flex: 0 1 auto;
    min-width: 0;
    max-width: none;
  }
}

// ---------- 状态 ----------
.list-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 320px;
  padding: var(--space-8);
  text-align: center;
  background: var(--color-surface);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);

  strong {
    color: var(--color-text);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }

  p {
    max-width: 420px;
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
  }

  &.is-notice {
    border-style: solid;
    border-color: var(--color-border);

    .list-state__icon {
      color: var(--color-accent-strong);
      background: var(--color-accent-soft);
    }
  }
}

.list-state__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border-radius: var(--radius-pill);

  svg {
    width: 22px;
    height: 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mod-card.is-skeleton,
  .spin {
    animation: none;
  }
}
</style>

<style lang="scss">
// 卡片「更多」菜单通过 Teleport 渲染到 body，样式不能使用 scoped。
.unified-mod-card-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  box-sizing: border-box;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  .unified-mod-card-menu__item {
    display: block;
    width: 100%;
    height: var(--control-height-sm);
    padding: 0 10px;
    overflow: hidden;
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-sm);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;

    &:hover:not(:disabled),
    &:focus-visible {
      background: var(--color-surface-hover);
      outline: none;
    }

    &:focus-visible {
      box-shadow: inset 0 0 0 2px var(--color-accent);
    }

    &:disabled {
      color: var(--control-text-disabled);
      cursor: not-allowed;
    }
  }
}
</style>
