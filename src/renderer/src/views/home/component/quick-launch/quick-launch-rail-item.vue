<script setup>
import { useI18n } from 'vue-i18n'
import { gamePresentation } from '@renderer/i18n/content.js'
import { computed } from 'vue'
import GameCover from '@renderer/views/game/component/index/game-cover.vue'
import { getRetiredSourceFailure } from '../../../../../../shared/sources/retired-source-policy.js'
import {
  getQuickLaunchPrimaryActionText,
  shouldInjectQuickLaunchMods
} from '@renderer/utils/quick-launch-game-action.js'
import {
  getQuickLaunchGameStatus,
  getQuickLaunchModCount,
  hasQuickLaunchModSource
} from '@renderer/utils/quick-launch-game-info.js'
import { getGameCoverUrl, getGameCoverFallbackUrls } from '@renderer/utils/game-art.js'

// 快捷启动卡片。
// 横列：封面 + 名称 + 圆形启动按钮；悬停 / 键盘聚焦时，启动按钮左侧滑出「管理模组」「浏览模组」
//（本机扫描游戏只滑出「打开游戏目录」）。其余操作在右键菜单。
// 竖列：双列卡片，封面在左，名称、状态和「启动 / 管理模组 / ⋯」在右。
// 本机扫描游戏（没有模组来源）不显示来源、模组数和模组相关操作。

const { t } = useI18n()
const props = defineProps({
  item: {
    type: Object,
    default: () => ({})
  },
  selected: {
    type: Boolean,
    default: false
  },
  menuOpen: {
    type: Boolean,
    default: false
  },
  layoutMode: {
    type: String,
    default: 'horizontal'
  }
})

const emit = defineEmits([
  'select',
  'start-game',
  'manage-mod',
  'preview-mod',
  'open-game-dir',
  'open-menu',
  'context-menu'
])

const isVertical = computed(() => props.layoutMode === 'vertical')
const displayName = computed(() => gamePresentation(props.item).title || t('quickLaunch.unknown'))
const subtitle = computed(() => {
  // 「本地已安装」只是没有英文名时的占位，卡片上不再重复显示
  if (props.item?.displaySubtitleKey === 'quickLaunch.locallyInstalled') return ''
  const text = gamePresentation(props.item).subtitle
  return text && text !== displayName.value ? text : ''
})
const hasModSource = computed(() => hasQuickLaunchModSource(props.item))
const sourceLabel = computed(() => {
  if (!hasModSource.value) return ''
  const label = String(props.item?.sourceLabel || '').trim()
  return label && label !== '--' ? label : ''
})
const modCount = computed(() => (hasModSource.value ? getQuickLaunchModCount(props.item) : 0))
const canPreview = computed(
  () =>
    hasModSource.value && !getRetiredSourceFailure(props.item?.currentSource || props.item?.source)
)
const coverUrl = computed(() => getGameCoverUrl(props.item))
const coverFallbackUrls = computed(() => getGameCoverFallbackUrls(props.item))
const isInject = computed(() => shouldInjectQuickLaunchMods(props.item))
const primaryActionText = computed(() => getQuickLaunchPrimaryActionText(props.item, t))
const primaryActionLabel = computed(() =>
  t(isInject.value ? 'quickLaunch.injectGame' : 'quickLaunch.launchGame', {
    name: displayName.value
  })
)

const status = computed(() => getQuickLaunchGameStatus(props.item))
const actionDisabled = computed(() => status.value !== 'ready')
const statusText = computed(() => {
  if (status.value === 'updating') return t('quickLaunch.updating')
  if (status.value === 'disabled') return t('quickLaunch.disabled')
  return ''
})
const primaryButtonText = computed(() => {
  if (status.value === 'updating') return t('quickLaunch.updatingMods')
  if (status.value === 'disabled') return t('quickLaunch.disabled')
  return primaryActionText.value
})

// 横列名称下方一行：英文名 · 来源 · 模组数；本机扫描游戏显示「本机扫描游戏」
const metaParts = computed(() => {
  const parts = []
  if (subtitle.value) parts.push({ key: 'subtitle', text: subtitle.value })
  if (sourceLabel.value) parts.push({ key: 'source', text: sourceLabel.value })
  if (modCount.value) {
    parts.push({
      key: 'mods',
      text: t('quickLaunch.modCount', { count: modCount.value }, modCount.value)
    })
  }
  return parts
})

// 悬停时名称区域让出的宽度：每个按钮 34px，间距 6px
const extraSpace = computed(() => {
  const count = hasModSource.value ? (canPreview.value ? 2 : 1) : 1
  return `${count * 34 + count * 6}px`
})

function handleContextMenu(event) {
  emit('select')
  const trigger = event.target?.closest?.('button') || event.currentTarget
  const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null
  emit('context-menu', { trigger, point })
}

defineOptions({
  name: 'QuickLaunchRailItem'
})
</script>

<template>
  <article
    class="ql-card"
    :data-state="selected ? 'selected' : 'default'"
    :data-layout="layoutMode"
    :data-status="status"
    :data-local="hasModSource ? undefined : 'true'"
    @click="emit('select')"
    @contextmenu.prevent="handleContextMenu"
  >
    <button
      type="button"
      class="ql-card__cover"
      :aria-pressed="selected ? 'true' : 'false'"
      :aria-label="t('quickLaunch.select', { name: displayName })"
      @click.stop="emit('select')"
    >
      <game-cover
        :src="coverUrl"
        :fallback-srcs="coverFallbackUrls"
        :fallback-text="displayName"
        fallback-mode="name"
        fit="auto"
      />
      <span
        v-if="isVertical && (sourceLabel || modCount)"
        class="ql-card__badges"
        aria-hidden="true"
      >
        <span v-if="sourceLabel" class="ql-card__source">{{ sourceLabel }}</span>
        <span v-if="modCount" class="ql-card__mods">
          <svg viewBox="0 0 24 24">
            <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
            <path d="m4 12 8 4.5 8-4.5" />
            <path d="m4 16.5 8 4.5 8-4.5" />
          </svg>
          {{ modCount }}
        </span>
      </span>
    </button>

    <!-- 横列 -->
    <div v-if="!isVertical" class="ql-card__info" :style="{ '--ql-extra-space': extraSpace }">
      <div class="ql-card__text">
        <h3 class="ql-card__title" :title="displayName">{{ displayName }}</h3>
        <p v-if="statusText" class="ql-card__meta" :data-tone="status">{{ statusText }}</p>
        <p v-else-if="!hasModSource" class="ql-card__meta">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
          {{ t('quickLaunch.localGame') }}
        </p>
        <p v-else-if="metaParts.length" class="ql-card__meta">
          <span v-for="part in metaParts" :key="part.key" class="ql-card__meta-part">
            {{ part.text }}
          </span>
        </p>
      </div>

      <div class="ql-card__extra">
        <template v-if="hasModSource">
          <button
            type="button"
            class="ql-card__btn is-extra"
            :data-tip="t('quickLaunch.manage')"
            :aria-label="t('quickLaunch.manageGame', { name: displayName })"
            @click.stop="emit('manage-mod')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="9" cy="17" r="2" />
            </svg>
          </button>
          <button
            v-if="canPreview"
            type="button"
            class="ql-card__btn is-extra is-near"
            :data-tip="t('quickLaunch.browse')"
            :aria-label="t('quickLaunch.browseGame', { name: displayName })"
            @click.stop="emit('preview-mod')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m15.5 8.5-2 5-5 2 2-5z" />
            </svg>
          </button>
        </template>
        <button
          v-else
          type="button"
          class="ql-card__btn is-extra is-near"
          :data-tip="t('quickLaunch.openDirectory')"
          :aria-label="t('quickLaunch.openGameDirectory', { name: displayName })"
          @click.stop="emit('open-game-dir')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
            />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="ql-card__btn is-primary"
        :disabled="actionDisabled"
        :data-tip="statusText || primaryActionText"
        :aria-label="statusText || primaryActionLabel"
        @click.stop="emit('start-game')"
      >
        <svg
          v-if="status === 'updating'"
          class="is-spinning"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 3a9 9 0 1 1-9 9" />
        </svg>
        <svg v-else-if="isInject" class="is-fill" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.2 2.5 5 13.4h6.1l-.9 8.1 8.3-11h-6.2l.9-8z" />
        </svg>
        <svg v-else class="is-fill" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M8.5 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7l-10.2-6.4a1 1 0 0 0-1.52.85z"
          />
        </svg>
      </button>
    </div>

    <!-- 竖列 -->
    <div v-else class="ql-card__body">
      <div class="ql-card__head">
        <div class="ql-card__text">
          <div class="ql-card__title-row">
            <h3 class="ql-card__title" :title="displayName">{{ displayName }}</h3>
            <span v-if="statusText" class="ql-card__pill" :data-tone="status">{{
              statusText
            }}</span>
          </div>
          <p v-if="!hasModSource" class="ql-card__meta">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
            {{ t('quickLaunch.localGame') }}
          </p>
          <p v-else-if="subtitle" class="ql-card__meta" :title="subtitle">{{ subtitle }}</p>
        </div>
        <button
          v-if="hasModSource"
          type="button"
          class="ql-card__btn is-icon"
          :aria-label="t('quickLaunch.more', { name: displayName })"
          aria-haspopup="menu"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          @click.stop="emit('open-menu', $event.currentTarget)"
        >
          <svg class="is-fill" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      <div class="ql-card__actions">
        <button
          type="button"
          class="ql-card__btn is-primary"
          :disabled="actionDisabled"
          :aria-label="statusText ? undefined : primaryActionLabel"
          @click.stop="emit('start-game')"
        >
          <svg
            v-if="status === 'updating'"
            class="is-spinning"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 3a9 9 0 1 1-9 9" />
          </svg>
          <svg v-else-if="isInject" class="is-fill" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13.2 2.5 5 13.4h6.1l-.9 8.1 8.3-11h-6.2l.9-8z" />
          </svg>
          <svg v-else class="is-fill" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8.5 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7l-10.2-6.4a1 1 0 0 0-1.52.85z"
            />
          </svg>
          {{ primaryButtonText }}
        </button>
        <button
          v-if="hasModSource"
          type="button"
          class="ql-card__btn"
          @click.stop="emit('manage-mod')"
        >
          {{ t('quickLaunch.manage') }}
        </button>
        <button v-else type="button" class="ql-card__btn" @click.stop="emit('open-game-dir')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
            />
          </svg>
          {{ t('quickLaunch.openDirectory') }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
$accent: #0a96ff;
$ink: #1e293b;
$muted: #607086;

.ql-card {
  position: relative;
  flex: 0 0 var(--ql-card-width, 272px);
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(226, 232, 240, 0.86);
  border-radius: 14px;
  background: #ffffff;
  overflow: hidden;
  cursor: pointer;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.03),
    0 8px 22px rgba(15, 23, 42, 0.04);
  transition:
    border-color var(--duration-base) var(--ease-standard),
    box-shadow var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);

  &:hover {
    transform: translateY(-3px);
    box-shadow:
      0 14px 30px rgba(15, 23, 42, 0.09),
      0 4px 12px rgba(15, 23, 42, 0.04);
  }

  &[data-state='selected'] {
    border-color: $accent;
    box-shadow:
      0 0 0 3px rgba(10, 150, 255, 0.16),
      0 10px 24px rgba(15, 23, 42, 0.06);
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;

    &.is-fill {
      fill: currentColor;
      stroke: none;
    }

    &.is-spinning {
      stroke-width: 2.6;
      animation: ql-card-spin 0.9s linear infinite;
    }
  }
}

.ql-card__cover {
  position: relative;
  flex: 0 0 128px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: #243044;
  overflow: hidden;
  cursor: pointer;

  :deep(.game-cover) {
    transition: transform var(--duration-slow) var(--ease-standard);
  }

  &:focus-visible {
    outline: 2px solid $accent;
    outline-offset: -2px;
    border-radius: 14px 14px 0 0;
  }
}

.ql-card:hover .ql-card__cover :deep(.game-cover) {
  transform: scale(1.04);
}

.ql-card[data-status='disabled'] .ql-card__cover :deep(.game-cover) {
  filter: grayscale(1);
  opacity: 0.5;
}

.ql-card__title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: $ink;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ql-card__meta {
  min-width: 0;
  margin: 2px 0 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: $muted;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;

  svg {
    flex: none;
    width: 12px;
    height: 12px;
    stroke-width: 2;
  }

  &[data-tone='updating'] {
    color: #0a7fd9;
  }

  &[data-tone='disabled'] {
    color: #c81e1e;
  }
}

.ql-card__meta-part {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;

  & + &::before {
    content: '·';
    margin-right: 4px;
  }

  &:last-child {
    flex-shrink: 0;
  }

  &:first-child {
    flex-shrink: 1;
  }
}

.ql-card__btn {
  height: 34px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 9px;
  background: #f8fafc;
  color: #475569;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(10, 150, 255, 0.3);
    background: rgba(10, 150, 255, 0.07);
    color: #0a7fd9;
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
  }

  &.is-primary {
    border-color: rgba(10, 150, 255, 0.4);
    background: $accent;
    color: #ffffff;
    font-weight: 700;
    box-shadow:
      0 8px 18px rgba(10, 150, 255, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.28);

    &:hover:not(:disabled) {
      border-color: rgba(10, 150, 255, 0.4);
      background: #1a9dff;
      color: #ffffff;
      box-shadow: 0 6px 16px rgba(10, 150, 255, 0.38);
    }

    &:disabled {
      border-color: #e2e8f0;
      background: #eef2f6;
      color: #7b8a9e;
      box-shadow: none;
    }
  }

  &.is-icon {
    width: 32px;
    height: 32px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: #94a3b8;

    svg {
      width: 16px;
      height: 16px;
    }
  }
}

.ql-card[data-status='updating'] .ql-card__btn.is-primary:disabled {
  border-color: rgba(10, 150, 255, 0.2);
  background: rgba(10, 150, 255, 0.1);
  color: #0a7fd9;
}

// 图标按钮的文字提示（悬停或键盘聚焦时显示）
.ql-card__btn[data-tip]:is(:hover, :focus-visible)::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: var(--z-index-tooltip);
  height: 24px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  transform: translateX(-50%);
  border-radius: 6px;
  background: $ink;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

/* 横列 */
.ql-card__info {
  position: relative;
  height: 62px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 14px;
}

.ql-card__text {
  flex: 1;
  min-width: 0;
  transition:
    margin-right var(--duration-base) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

// 悬停时从启动按钮左侧滑出的操作；离启动按钮近的先出现
.ql-card__extra {
  position: absolute;
  top: 50%;
  right: 58px;
  display: flex;
  gap: 6px;
  transform: translateY(-50%);
  pointer-events: none;
}

.ql-card__btn.is-extra {
  position: relative;
  width: 34px;
  padding: 0;
  border-color: rgba(203, 213, 225, 0.9);
  border-radius: 10px;
  background: #ffffff;
  opacity: 0;
  transform: translateX(16px) scale(0.86);
  transition-delay: 40ms;

  svg {
    width: 16px;
    height: 16px;
  }

  &.is-near {
    transition-delay: 0ms;
  }
}

.ql-card__info .ql-card__btn.is-primary {
  position: relative;
  z-index: 1;
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  box-shadow:
    0 6px 14px rgba(10, 150, 255, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);

  svg {
    width: 16px;
    height: 16px;
  }

  &:disabled {
    box-shadow: none;
  }
}

.ql-card:is(:hover, :focus-within) {
  .ql-card__extra {
    pointer-events: auto;
  }

  .ql-card__btn.is-extra {
    opacity: 1;
    transform: none;
  }

  .ql-card__text {
    margin-right: var(--ql-extra-space, 0px);
  }
}

/* 竖列：双列卡片 */
.ql-card[data-layout='vertical'] {
  flex: none;
  height: 120px;
  flex-direction: row;

  &:hover {
    transform: translateY(-2px);
    border-color: rgba(10, 150, 255, 0.3);
  }

  &[data-state='selected'] {
    border-color: $accent;
  }

  .ql-card__cover {
    flex: 0 0 236px;
    height: 100%;

    &:focus-visible {
      border-radius: 14px 0 0 14px;
    }
  }
}

.ql-card__badges {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 2;
  max-width: calc(100% - 16px);
  display: flex;
  gap: 6px;
  pointer-events: none;
}

.ql-card__source,
.ql-card__mods {
  height: 20px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.ql-card__source {
  min-width: 0;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.72);
  color: #ffffff;
  text-overflow: ellipsis;
}

.ql-card__mods {
  flex: none;
  background: rgba(255, 255, 255, 0.92);
  color: #334155;

  svg {
    width: 11px;
    height: 11px;
    stroke: $accent;
    stroke-width: 2.4;
  }
}

.ql-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 13px 12px 13px 18px;
}

.ql-card__head {
  display: flex;
  align-items: flex-start;
  gap: 6px;

  .ql-card__btn.is-icon {
    margin-top: -4px;
  }
}

.ql-card:hover .ql-card__head .ql-card__btn.is-icon {
  background: #f1f5f9;
  color: #334155;
}

.ql-card__title-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  .ql-card__title {
    font-size: 16px;
  }
}

.ql-card__pill {
  flex: none;
  height: 20px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;

  &[data-tone='updating'] {
    background: rgba(10, 150, 255, 0.1);
    color: #0a7fd9;
  }

  &[data-tone='disabled'] {
    background: rgba(220, 38, 38, 0.08);
    color: #c81e1e;
  }
}

.ql-card__body .ql-card__meta {
  color: #7b8a9e;
}

.ql-card__actions {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;

  .ql-card__btn.is-primary {
    min-width: 112px;
  }
}

@keyframes ql-card-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ql-card,
  .ql-card__btn,
  .ql-card__text,
  .ql-card__cover :deep(.game-cover) {
    transition: none;
  }

  .ql-card:hover,
  .ql-card[data-layout='vertical']:hover,
  .ql-card:hover .ql-card__cover :deep(.game-cover) {
    transform: none;
  }

  .ql-card svg.is-spinning {
    animation: none;
  }
}
</style>
