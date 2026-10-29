<script setup>
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { localizeModUiText } from '@renderer/i18n/mod-browser-ui.js'
import AppImage from '@renderer/component/AppImage.vue'
import GameCover from '@views/game/component/index/game-cover.vue'
import DlssEntry from '@renderer/component/dlss/DlssEntry.vue'
import { VxButton } from '@renderer/component/vertex-ui'
import InstallRuleAiPromptModal from '@views/game/source/component/InstallRuleAiPromptModal.vue'
import { getInstallRuleAiIdentity } from '@views/game/source/install-rule-ai-prompt.js'

const props = defineProps({
  ruleAiContext: { type: Object, default: null },
  ruleAiMissing: { type: Boolean, default: false },
  ruleAiEditorAction: { type: String, default: '' },
  dlssContext: { type: Object, default: null },
  coverImage: {
    type: String,
    default: ''
  },
  logoImage: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  subtitle: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  // 来源、域名、列表状态等标签对用户没有信息量，横幅不再展示；保留属性以兼容各平台调用。
  tags: {
    type: Array,
    default: () => []
  },
  stats: {
    type: Array,
    default: () => []
  },
  statusText: {
    type: String,
    default: ''
  },
  statusType: {
    type: String,
    default: 'info'
  },
  statusSubText: {
    type: String,
    default: ''
  },
  showStatus: {
    type: Boolean,
    default: true
  },
  actions: {
    type: Array,
    default: () => []
  },
  moreActions: {
    type: Array,
    default: () => []
  },
  moreButtonText: {
    type: String,
    default: ''
  }
})

const { t } = useI18n()
const emit = defineEmits(['action', 'rule-saved'])

const showMoreOptions = ref(false)
const ruleAiPromptOpen = ref(false)
const showRuleAiShortcut = computed(() => !!props.ruleAiContext && props.ruleAiMissing)
watch(() => getInstallRuleAiIdentity(props.ruleAiContext || {}), () => {
  ruleAiPromptOpen.value = false
})
const actionButtonsRef = ref(null)
const moreButtonRef = ref(null)
const moreMenuRef = ref(null)
const moreMenuStyle = ref({})
// 主操作的拆分按钮下拉（例如「注入模组」旁的其它启动方式）。
const showPrimaryMenu = ref(false)
const primaryMenuButtonRef = ref(null)
const primaryMenuRef = ref(null)
const primaryMenuStyle = ref({})
// 拆分按钮渲染在 v-for 内，模板字符串 ref 会变成数组，这里用函数 ref 保存单个元素。
function setPrimaryMenuButton(element) {
  primaryMenuButtonRef.value = element
}
function setPrimaryMenu(element) {
  primaryMenuRef.value = element
}

const safeStatusClass = computed(() => {
  const value = String(props.statusType || '')
    .trim()
    .toLowerCase()
  if (value === 'success') return 'found'
  if (value === 'warning') return 'warning'
  if (value === 'danger' || value === 'error') return 'not-found'
  return 'info'
})

const visibleActions = computed(() => {
  return normalizeActions(props.actions)
})

// 未识别到游戏时，把「重新扫描 / 手动添加」从「更多」菜单提到状态栏，减少一次点击。
const STATUS_QUICK_ACTION_KEYS = ['scan', 'manual-bind', 'manual-add']
const statusQuickActions = computed(() => {
  if (!props.showStatus || safeStatusClass.value === 'found') return []
  return visibleActions.value.filter((item) =>
    STATUS_QUICK_ACTION_KEYS.includes(String(item?.key || '').trim())
  )
})

const visibleMoreActions = computed(() => {
  const quickKeys = new Set(statusQuickActions.value.map((item) => item.key))
  const actionList = [
    ...(props.ruleAiContext ? [{ key: 'ai-rule-prompt', label: t('modBrowser.aiRule') }] : []),
    ...normalizeActions(props.moreActions),
    ...visibleActions.value.filter((item) => isMoreAction(item) && !quickKeys.has(item.key))
  ]
  const seen = new Set()
  return actionList.filter((item) => {
    const key = String(item?.key || item?.label || '').trim()
    if (!key) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})

const visibleMainActions = computed(() => {
  return visibleActions.value.filter((item) => !isMoreAction(item) && !isPrimaryMenuAction(item))
})

// placement: 'primary-menu' 的操作挂在第一个主操作的下拉里。
const primaryMenuActions = computed(() => visibleActions.value.filter(isPrimaryMenuAction))

// Detection may disable the focused menu item after the menu has opened.
watch(
  () =>
    visibleMoreActions.value
      .map((item) => `${item.key}:${!!item.disabled || !!item.loading}`)
      .join('|'),
  async () => {
    await nextTick()
    if (!showMoreOptions.value) return
    positionMoreOptions()
    if (!moreMenuRef.value?.contains(document.activeElement) || document.activeElement.disabled)
      moreMenuRef.value?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  }
)

function normalizeActions(actions = []) {
  return (Array.isArray(actions) ? actions : []).filter((item) => {
    return item?.visible !== false && !!String(item?.label || '').trim()
  }).map(item => ({ ...item, label: localizeModUiText(item.label), loadingText: localizeModUiText(item.loadingText) }))
}

function isMoreAction(action = {}) {
  const placement = String(action?.placement || action?.group || '').trim()
  if (placement === 'more' || placement === 'dropdown') return true
  if (action?.more === true) return true

  const key = String(action?.key || '').trim()
  return [
    'open-root',
    'open-game-folder',
    'scan',
    'manual-bind',
    'manual-add',
    'config-file'
  ].includes(key)
}

function isPrimaryMenuAction(action = {}) {
  return String(action?.placement || '').trim() === 'primary-menu'
}

function isPrimaryAction(action = {}) {
  return String(action?.type || '').trim() === 'primary'
}

const secondaryMainActions = computed(() =>
  visibleMainActions.value.filter((item) => !isPrimaryAction(item))
)
const primaryMainActions = computed(() => visibleMainActions.value.filter(isPrimaryAction))

function getMainActionVariant(action = {}) {
  return String(action?.tone || '').trim() === 'danger' ? 'danger' : 'secondary'
}

function getMoreActionClass(action = {}, index = 0) {
  const tone = String(action?.tone || '').trim()
  const separated =
    index === 1 && visibleMoreActions.value[0]?.key === 'ai-rule-prompt'
  return ['dropdown-item', tone ? `is-${tone}` : '', separated ? 'is-separated' : ''].filter(
    Boolean
  )
}

function closeMoreOptions(restoreFocus = false) {
  showMoreOptions.value = false
  if (restoreFocus === true) moreButtonRef.value?.focus()
}

function closePrimaryMenu(restoreFocus = false) {
  showPrimaryMenu.value = false
  if (restoreFocus === true) primaryMenuButtonRef.value?.focus()
}

function closeMenus() {
  closeMoreOptions()
  closePrimaryMenu()
}

// 菜单宽度固定，右边缘与触发按钮对齐，避免随整行操作区变宽；下方空间不足时向上展开。
function computeMenuStyle(anchorElement, menuElement) {
  const anchor = anchorElement.getBoundingClientRect()
  const padding = 12
  const width = Math.min(220, window.innerWidth - padding * 2)
  const below = window.innerHeight - anchor.bottom - padding - 4
  const above = anchor.top - padding - 4
  const height = menuElement?.scrollHeight || 240
  const upwards = below < Math.min(height, 240) && above > below
  const maxHeight = Math.max(40, upwards ? above : below)
  return {
    left: `${Math.max(padding, Math.min(anchor.right - width, window.innerWidth - width - padding))}px`,
    top: `${upwards ? Math.max(padding, anchor.top - Math.min(height, maxHeight) - 4) : anchor.bottom + 4}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`
  }
}

function positionMoreOptions() {
  if (showMoreOptions.value && moreButtonRef.value) {
    moreMenuStyle.value = computeMenuStyle(moreButtonRef.value, moreMenuRef.value)
  }
  if (showPrimaryMenu.value && primaryMenuButtonRef.value) {
    primaryMenuStyle.value = computeMenuStyle(primaryMenuButtonRef.value, primaryMenuRef.value)
  }
}

async function toggleMoreOptions() {
  if (showMoreOptions.value) return closeMoreOptions(true)
  closePrimaryMenu()
  showMoreOptions.value = true
  await nextTick()
  positionMoreOptions()
  moreMenuRef.value?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
}

async function togglePrimaryMenu() {
  if (showPrimaryMenu.value) return closePrimaryMenu(true)
  closeMoreOptions()
  showPrimaryMenu.value = true
  await nextTick()
  positionMoreOptions()
  primaryMenuRef.value?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
}

function navigateMenu(event, menuElement, close) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
  } else if (event.key === 'Tab') {
    close(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...(menuElement?.querySelectorAll('button:not(:disabled)') || [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[index].focus()
  }
}

function handleMenuKeydown(event) {
  navigateMenu(event, moreMenuRef.value, closeMoreOptions)
}

function handlePrimaryMenuKeydown(event) {
  navigateMenu(event, primaryMenuRef.value, closePrimaryMenu)
}

function handleOutsideClick(event) {
  if (
    showMoreOptions.value &&
    !moreMenuRef.value?.contains(event.target) &&
    !moreButtonRef.value?.contains(event.target)
  )
    closeMoreOptions()
  if (
    showPrimaryMenu.value &&
    !primaryMenuRef.value?.contains(event.target) &&
    !primaryMenuButtonRef.value?.contains(event.target)
  )
    closePrimaryMenu()
}
onMounted(() => {
  document.addEventListener('pointerdown', handleOutsideClick)
  window.addEventListener('resize', positionMoreOptions)
  window.addEventListener('scroll', positionMoreOptions, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsideClick)
  window.removeEventListener('resize', positionMoreOptions)
  window.removeEventListener('scroll', positionMoreOptions, true)
})
onDeactivated(() => {
  closeMenus()
  ruleAiPromptOpen.value = false
})

// 主操作不可用时（例如未找到游戏），其下拉中的启动方式同样不可用，避免出现孤立的可点箭头。
function isPrimaryMenuDisabled(primary = {}) {
  return (
    !!primary.disabled ||
    !!primary.loading ||
    primaryMenuActions.value.every((item) => item.disabled || item.loading)
  )
}

function handleActionClick(action = {}) {
  if (action?.disabled || action?.loading) {
    return
  }
  closeMenus()
  if (action?.key === 'ai-rule-prompt') {
    moreButtonRef.value?.focus()
    ruleAiPromptOpen.value = true
    return
  }
  emit('action', String(action?.key || '').trim(), action)
}
</script>

<template>
  <section
    class="unified-mod-header"
    :class="{ 'has-cover': !!coverImage }"
    :aria-label="title || t('modBrowser.unknownGame')"
    @click="closeMenus"
  >
    <!-- 封面模糊铺底：只表达所属游戏的氛围，文字对比度由上层遮罩保证。 -->
    <div class="header-backdrop" aria-hidden="true">
      <GameCover v-if="coverImage" :src="coverImage" alt="" loading="eager" />
    </div>
    <div class="header-scrim" aria-hidden="true"></div>

    <div class="header-main">
      <div class="header-cover">
        <GameCover
          :src="coverImage || ''"
          :alt="title || t('modBrowser.unknownGame')"
          :fallback-text="title"
          fallback-mode="name"
          loading="eager"
        />
      </div>

      <div class="header-info">
        <div class="header-identity">
          <div class="header-title-row">
            <div v-if="logoImage" class="header-logo">
              <app-image :src="logoImage" :alt="title || t('modBrowser.unknownGame')" />
            </div>
            <h1 class="header-title" :title="title">{{ title || t('modBrowser.unknownGame') }}</h1>
          </div>

          <p v-if="subtitle && subtitle !== title" class="header-subtitle" :title="subtitle">
            {{ subtitle }}
          </p>
          <p v-if="description" class="header-desc" :title="description">{{ description }}</p>
        </div>

        <div class="header-bottom">
          <dl v-if="stats.length" class="header-stats">
            <div v-for="(item, index) in stats" :key="`${item?.label || 'stat'}-${index}`">
              <dt>{{ localizeModUiText(item?.label) || '--' }}</dt>
              <dd>
                {{ item?.value ?? '--' }}
                <span
                  v-if="item?.hint"
                  class="header-stat__hint"
                  :class="item?.hintTone ? `is-${item.hintTone}` : ''"
                  >{{ item.hint }}</span
                >
              </dd>
            </div>
          </dl>

          <div
            v-if="
              visibleMoreActions.length || visibleMainActions.length || dlssContext || $slots.right
            "
            ref="actionButtonsRef"
            class="header-actions"
            @click.stop
          >
            <template v-if="visibleMainActions.length">
              <div
                v-for="(item, index) in primaryMainActions"
                :key="item.key || item.label"
                class="header-primary-group"
                :class="{ 'is-split': index === 0 && primaryMenuActions.length }"
              >
                <VxButton
                  variant="primary"
                  size="lg"
                  class="header-primary"
                  :loading="!!item.loading"
                  :disabled="!!item.disabled"
                  @click="handleActionClick(item)"
                >
                  <span class="header-primary__inner">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 4.5v15l12.5-7.5z" />
                    </svg>
                    {{ item.loading ? item.loadingText || item.label : item.label }}
                  </span>
                </VxButton>
                <template v-if="index === 0 && primaryMenuActions.length">
                  <button
                    :ref="setPrimaryMenuButton"
                    type="button"
                    class="header-primary-toggle"
                    :class="{ 'is-open': showPrimaryMenu }"
                    aria-haspopup="menu"
                    :aria-expanded="showPrimaryMenu"
                    :aria-label="t('modBrowser.launchOptions')"
                    :title="t('modBrowser.launchOptions')"
                    :disabled="isPrimaryMenuDisabled(item)"
                    @click="togglePrimaryMenu"
                    @keydown.down.prevent="!showPrimaryMenu && togglePrimaryMenu()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                  </button>
                  <Teleport to="body">
                    <div
                      v-if="showPrimaryMenu"
                      :ref="setPrimaryMenu"
                      class="unified-header-more-menu vx-ui-scrollbar"
                      role="menu"
                      :aria-label="t('modBrowser.launchOptions')"
                      :style="primaryMenuStyle"
                      @click.stop
                      @keydown="handlePrimaryMenuKeydown"
                    >
                      <button
                        v-for="menuItem in primaryMenuActions"
                        :key="menuItem.key || menuItem.label"
                        type="button"
                        role="menuitem"
                        class="dropdown-item"
                        :title="menuItem.title || menuItem.label"
                        :disabled="!!menuItem.disabled || !!menuItem.loading"
                        @click="handleActionClick(menuItem)"
                      >
                        {{ menuItem.label }}
                      </button>
                    </div>
                  </Teleport>
                </template>
              </div>

              <VxButton
                v-for="item in secondaryMainActions"
                :key="item.key || item.label"
                :variant="getMainActionVariant(item)"
                size="lg"
                :loading="!!item.loading"
                :disabled="!!item.disabled"
                @click="handleActionClick(item)"
              >
                {{ item.loading ? item.loadingText || item.label : item.label }}
              </VxButton>
            </template>
            <slot v-else name="right"></slot>

            <DlssEntry v-if="dlssContext" :context="{ ...dlssContext, coverImage }" />

            <div v-if="visibleMoreActions.length" class="more-options-container">
              <button
                ref="moreButtonRef"
                class="header-more"
                :class="{ 'is-open': showMoreOptions }"
                type="button"
                aria-haspopup="menu"
                :aria-expanded="showMoreOptions"
                :aria-label="moreButtonText || t('modBrowser.moreSettings')"
                :title="moreButtonText || t('modBrowser.moreSettings')"
                @click="toggleMoreOptions"
                @keydown.down.prevent="!showMoreOptions && toggleMoreOptions()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              <Teleport to="body">
                <div
                  v-if="showMoreOptions"
                  ref="moreMenuRef"
                  class="unified-header-more-menu vx-ui-scrollbar"
                  role="menu"
                  :aria-label="moreButtonText || t('modBrowser.moreSettings')"
                  :style="moreMenuStyle"
                  @click.stop
                  @keydown="handleMenuKeydown"
                >
                  <button
                    v-for="(item, index) in visibleMoreActions"
                    :key="item.key || item.label"
                    type="button"
                    role="menuitem"
                    :title="item.loading ? item.loadingText || item.label : item.label"
                    :class="getMoreActionClass(item, index)"
                    :disabled="!!item.disabled || !!item.loading"
                    @click="handleActionClick(item)"
                  >
                    {{ item.loading ? item.loadingText || item.label : item.label }}
                  </button>
                </div>
              </Teleport>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 状态栏：识别结果 + 就地处理入口 -->
    <div v-if="showStatus" class="header-status-bar" :class="`is-${safeStatusClass}`" role="status">
      <span class="header-status__icon" aria-hidden="true">
        <svg v-if="safeStatusClass === 'found'" viewBox="0 0 24 24">
          <path d="m6 12.5 4 4L18 8.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24">
          <path d="M12 7.5v5.5M12 16.5h.01" />
        </svg>
      </span>
      <strong class="header-status__title">
        {{ localizeModUiText(statusText) || t('modBrowser.unknownStatus') }}
      </strong>
      <span v-if="statusSubText" class="header-status__text" :title="statusSubText">
        {{ statusSubText }}
      </span>
      <span
        v-if="showRuleAiShortcut || $slots['status-action'] || statusQuickActions.length"
        class="header-status__actions"
        @click.stop
      >
        <VxButton
          v-for="(item, index) in statusQuickActions"
          :key="item.key"
          class="header-status__button"
          :class="{ 'is-emphasis': !showRuleAiShortcut && index === statusQuickActions.length - 1 }"
          size="sm"
          variant="secondary"
          :loading="!!item.loading"
          :disabled="!!item.disabled"
          @click="handleActionClick(item)"
        >
          {{ item.loading ? item.loadingText || item.label : item.label }}
        </VxButton>
        <VxButton
          v-if="showRuleAiShortcut"
          class="header-status__button is-emphasis"
          size="sm"
          variant="secondary"
          @click="ruleAiPromptOpen = true"
        >
          {{ t('modBrowser.aiGenerate') }}
        </VxButton>
        <slot v-else name="status-action"></slot>
      </span>
    </div>

    <div v-if="$slots.footer" class="header-footer">
      <slot name="footer"></slot>
    </div>
    <InstallRuleAiPromptModal
      v-if="ruleAiContext"
      v-model="ruleAiPromptOpen"
      :game-context="ruleAiContext"
      :editor-available="!!ruleAiEditorAction"
      @open-editor="emit('action', ruleAiEditorAction)"
      @saved="emit('rule-saved')"
    />
  </section>
</template>

<style scoped lang="scss">
// 横幅叠在游戏封面之上：文字与控件统一使用 --color-cover-* token，
// 封面内容未知，由 .header-scrim 的深色遮罩保证 WCAG AA 对比度。
.unified-mod-header {
  --header-title-size: 32px;
  --header-cover-width: 288px;
  --header-on-cover-fill: rgba(255, 255, 255, 0.12);
  --header-on-cover-fill-hover: rgba(255, 255, 255, 0.2);
  --header-on-cover-line: rgba(255, 255, 255, 0.18);

  position: relative;
  isolation: isolate;
  overflow: hidden;
  color: var(--color-cover-text);
  font-family: var(--font-family-base);
  background: var(--color-text);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }
}

.header-backdrop {
  position: absolute;
  inset: 0;
  z-index: -2;

  // 只保留模糊的氛围层，原图由左侧封面完整展示。
  :deep(.game-cover) {
    background: transparent;
  }

  :deep(.game-cover__art) {
    display: none;
  }

  :deep(.game-cover__ambient) {
    filter: blur(36px) saturate(1.2);
    transform: scale(1.3);
  }

  :deep(.game-cover.is-loaded .game-cover__ambient) {
    opacity: 0.85;
  }
}

.header-scrim {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(
    90deg,
    var(--color-cover-scrim) 0%,
    var(--color-cover-scrim-mid) 62%,
    color-mix(in srgb, var(--color-cover-scrim-mid) 70%, transparent) 100%
  );
}

.header-main {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--space-5) var(--space-7);
  padding: var(--space-7) var(--space-8) var(--space-6);
}

.header-cover {
  position: relative;
  flex: 0 0 var(--header-cover-width);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--color-cover-chip-bg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);

  // 细描边让深色封面与背景分开。
  &::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--header-on-cover-line);
    pointer-events: none;
  }

  :deep(.game-cover.is-fallback) {
    background: var(--color-cover-chip-bg);
  }

  :deep(.game-cover__fallback) {
    color: var(--color-cover-text-secondary);
  }
}

.header-info {
  display: flex;
  flex: 1 1 420px;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-4);
  min-width: 0;
}

.header-identity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.header-logo {
  flex: none;
  width: 36px;
  height: 36px;
  overflow: hidden;
  background: var(--header-on-cover-fill);
  border-radius: var(--radius-sm);

  :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.header-title {
  min-width: 0;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  color: var(--color-cover-text);
  font-size: var(--header-title-size);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-subtitle,
.header-desc {
  margin: 0;
  color: var(--color-cover-text-secondary);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.header-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-desc {
  display: -webkit-box;
  max-width: 720px;
  overflow: hidden;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.header-bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4) var(--space-6);
}

.header-stats {
  display: flex;
  flex-wrap: wrap;
  margin: 0;

  > div {
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    padding: 0 var(--space-6);

    &:first-child {
      padding-left: 0;
    }

    & + div {
      border-left: 1px solid var(--header-on-cover-line);
    }
  }

  dd {
    margin: 0;
    color: var(--color-cover-text);
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
  }

  dt {
    color: var(--color-cover-text-secondary);
    font-size: var(--font-size-xs);
  }
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;

  // 封面上的次要按钮：半透明白底，悬停加深；禁用态降低不透明度而不是换成浅灰底。
  :deep(.vx-button.vx-button-secondary),
  :deep(.vx-button.vx-button-danger) {
    color: var(--color-cover-text);
    background: var(--header-on-cover-fill);
    border-color: var(--header-on-cover-line);

    &:hover:not(:disabled) {
      color: var(--color-cover-text);
      background: var(--header-on-cover-fill-hover);
      border-color: var(--header-on-cover-line);
    }

    &:disabled {
      color: var(--color-cover-text-secondary);
      background: var(--header-on-cover-fill);
      border-color: transparent;
      opacity: 0.55;
    }
  }

  :deep(.vx-button.vx-button-danger) {
    color: var(--color-danger-soft);
  }

  :deep(.vx-button-lg) {
    padding: 0 var(--space-4);
  }

  :deep(.vx-button.vx-button-primary) {
    padding: 0 var(--space-5);
    box-shadow: var(--shadow-md);
  }

  :deep(.vx-button.vx-button-primary:disabled) {
    color: var(--color-cover-text-secondary);
    background: var(--header-on-cover-fill);
    border-color: transparent;
    box-shadow: none;
    opacity: 0.7;
  }
}

.more-options-container {
  position: relative;
}

.header-more {
  display: grid;
  place-items: center;
  width: var(--control-height-lg);
  height: var(--control-height-lg);
  padding: 0;
  color: var(--color-cover-text);
  background: var(--header-on-cover-fill);
  border: 1px solid var(--header-on-cover-line);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
    stroke: none;
  }

  &:hover,
  &.is-open {
    background: var(--header-on-cover-fill-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.header-primary-group {
  display: inline-flex;
  align-items: stretch;

  // 拆分按钮：左侧执行主操作，右侧箭头展开其它方式，两段共用一个圆角外框。
  &.is-split :deep(.vx-button.vx-button-primary) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
}

.header-primary-toggle {
  display: grid;
  place-items: center;
  width: 34px;
  padding: 0;
  color: var(--color-text-inverse);
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-left: 1px solid color-mix(in srgb, var(--color-text-inverse) 35%, transparent);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  box-shadow: var(--shadow-md);
  outline: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
    stroke-width: 2.2;
  }

  &:hover:not(:disabled),
  &.is-open {
    background: var(--color-accent-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    color: var(--color-cover-text-secondary);
    background: var(--header-on-cover-fill);
    border-color: transparent;
    box-shadow: none;
    opacity: 0.7;
    cursor: not-allowed;
  }
}

.header-stat__hint {
  margin-left: 6px;
  color: var(--color-cover-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);

  // 深色横幅上的提示色：浅橙在遮罩上约 8:1。
  &.is-warning {
    color: var(--color-warning-soft);
  }
}

.header-primary__inner {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  svg {
    width: 13px;
    height: 13px;
    fill: currentColor;
    stroke: none;
  }
}

// ---------- 状态栏 ----------
.header-status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px var(--space-3);
  min-height: 44px;
  padding: 6px var(--space-4) 6px var(--space-8);
  font-size: var(--font-size-sm);
  background: color-mix(in srgb, var(--color-black) 42%, transparent);
  border-top: 1px solid var(--header-on-cover-line);
}

.header-status__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--color-text);
  background: var(--color-cover-text);
  border-radius: var(--radius-pill);

  svg {
    width: 13px;
    height: 13px;
    stroke-width: 2.6;
  }

  .is-found & {
    background: var(--color-cover-success);
  }

  .is-warning & {
    background: var(--color-warning-soft);
  }

  .is-not-found & {
    background: var(--color-danger-soft);
  }
}

.header-status__title {
  flex: none;
  font-weight: var(--font-weight-semibold);
}

.header-status__text {
  flex: 1 1 240px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-cover-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-status__actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;

  :deep(.vx-button.vx-button-secondary) {
    min-height: 28px;
    color: var(--color-cover-text);
    background: var(--header-on-cover-fill);
    border-color: var(--header-on-cover-line);

    &:hover:not(:disabled) {
      color: var(--color-cover-text);
      background: var(--header-on-cover-fill-hover);
    }

    &:disabled {
      opacity: 0.55;
    }
  }

  // 主要的就地处理入口用实心白底，和其它半透明按钮区分。
  :deep(.vx-button.header-status__button.is-emphasis) {
    color: var(--color-text);
    background: var(--color-cover-text);
    border-color: transparent;

    &:hover:not(:disabled) {
      color: var(--color-text);
      background: var(--color-surface-strong);
    }
  }
}

.header-footer {
  padding: var(--space-3) var(--space-8);
  color: var(--color-cover-text);
  border-top: 1px solid var(--header-on-cover-line);
}

@media (max-width: 760px) {
  .header-main {
    padding: var(--space-5);
  }

  .header-cover {
    flex-basis: 100%;
  }

  .header-actions {
    margin-left: 0;
  }

  .header-status-bar {
    padding-left: var(--space-5);
  }
}
</style>

<style lang="scss">
// 「更多」菜单通过 Teleport 渲染到 body，样式不能使用 scoped。
.unified-header-more-menu {
  position: fixed;
  z-index: var(--z-index-dropdown);
  box-sizing: border-box;
  min-width: 200px;
  overflow-y: auto;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  .dropdown-item {
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

    &.is-danger {
      color: var(--color-danger);
    }

    &.is-separated {
      position: relative;
      margin-top: 9px;

      &::before {
        position: absolute;
        top: -5px;
        right: 6px;
        left: 6px;
        height: 1px;
        content: '';
        background: var(--color-surface-strong);
      }
    }
  }
}
</style>
