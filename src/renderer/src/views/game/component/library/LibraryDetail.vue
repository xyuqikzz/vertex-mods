<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { VxButton } from '@renderer/component/vertex-ui/index.js'

// 行内详情区：插在选中卡片所在行的下面，只负责展示和抛出操作，业务逻辑留在页面里。
const props = defineProps({
  detailId: { type: String, required: true },
  view: { type: Object, required: true },
  caretLeft: { type: String, default: '50%' },
  launching: { type: Boolean, default: false },
  moreExpanded: { type: Boolean, default: false },
  recentMods: { type: Array, default: () => [] },
  recentState: { type: String, default: 'idle' },
  recentLimit: { type: Number, default: 3 }
})

const emit = defineEmits([
  'close',
  'launch',
  'relocate',
  'manage',
  'browse',
  'open-folder',
  'copy-path',
  'toggle-more',
  'switch-source',
  'remove',
  'cover-error',
  'escape'
])

function handleKeydown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  emit('escape')
}

function recentEmptyText() {
  if (props.recentState === 'error') return uiText('ui.installationRecordsAreTemporarilyUnavailableCheckManageMods')
  if (props.view.modCount > 0) return uiText('ui.valueModsInstalledViewThemInManageMods', { value1: (props.view.modCount) })
  if (props.view.status === 'unbound') return uiText('ui.bindAGameFolderBeforeInstallingMods')
  return uiText('ui.noModsInstalledYetBrowseModsToGetStarted')
}
</script>

<template>
  <section
    :id="detailId"
    class="library-detail"
    :aria-label="$t('ui.valueDetails', { value1: (view.title) })"
    :style="{ '--caret-left': caretLeft }"
    @keydown="handleKeydown"
  >
    <span class="library-detail__caret" aria-hidden="true"></span>
    <button
      type="button"
      class="library-detail__close"
      :aria-label="$t('ui.collapseDetails')"
      :title="$t('ui.collapseDetailsEsc')"
      @click="emit('close')"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>

    <div class="library-detail__layout">
      <div class="library-detail__cover" :style="{ '--cover-tone': view.tone }" aria-hidden="true">
        <img v-if="view.cover" :src="view.cover" alt="" @error="emit('cover-error')" />
        <span v-else class="library-detail__monogram">{{ view.monogram }}</span>
      </div>

      <div class="library-detail__main">
        <h2 class="library-detail__title">{{ view.title }}</h2>
        <p v-if="view.subtitle" class="library-detail__subtitle">{{ view.subtitle }}</p>
        <p class="library-detail__summary">
          <span class="library-detail__dot" :class="`is-${view.status}`" aria-hidden="true"></span>
          {{ view.summary }}
        </p>

        <p
          v-if="view.status === 'missing' && view.hasSources"
          class="library-detail__note is-warning"
          role="note"
        >
          {{ $t('ui.theGameMayHaveBeenMovedOrUninstalledLocateIt') }}
        </p>
        <p
          v-else-if="view.status === 'missing'"
          class="library-detail__note is-warning"
          role="note"
        >
          {{ $t('ui.theGameFolderNoLongerExistsThisAutomaticallyDetectedRecord') }}
        </p>
        <p
          v-else-if="view.status === 'unbound' && view.hasSources"
          class="library-detail__note"
          role="note"
        >
          {{ $t('ui.thisGameWasAddedFrom') }}
          {{ view.sourceLabel }} {{ $t('ui.butItsLocalInstallationFolderHasNotBeenFoundBind') }}
        </p>

        <div class="library-detail__actions">
          <VxButton v-if="view.canLaunch" size="lg" :loading="launching" @click="emit('launch')">
            <svg class="library-detail__play" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
            {{ view.primaryText }}
          </VxButton>
          <VxButton v-else-if="view.hasSources" size="lg" @click="emit('relocate')">
            {{ view.repairText }}
          </VxButton>
          <VxButton
            v-else-if="view.status === 'missing' && view.canRemove"
            variant="secondary"
            size="lg"
            @click="emit('remove')"
          >
            {{ $t('ui.removeFromLibrary') }}
          </VxButton>
          <VxButton v-else size="lg" disabled>{{ $t('ui.cannotLaunchRightNow') }}</VxButton>

          <template v-if="view.hasSources">
            <VxButton variant="secondary" size="lg" @click="emit('manage')">
              {{ $t('quickLaunch.manage') }}
              <span class="library-detail__count">{{ view.sourceModCount }}</span>
            </VxButton>
            <VxButton v-if="view.canPreview" variant="secondary" size="lg" @click="emit('browse')">
              {{ $t('quickLaunch.browse') }}
            </VxButton>
          </template>
          <VxButton
            v-else-if="view.folderExists"
            variant="secondary"
            size="lg"
            @click="emit('open-folder')"
          >
            {{ $t('ui.openGameFolder') }}
          </VxButton>

          <button
            type="button"
            class="library-detail__more"
            :aria-label="$t('ui.moreActions')"
            :title="$t('ui.moreActions')"
            aria-haspopup="menu"
            :aria-expanded="moreExpanded"
            @click="emit('toggle-more', $event.currentTarget)"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12.5" cy="8" r="1.3" />
            </svg>
          </button>
        </div>

        <dl class="library-detail__facts">
          <dt>{{ $t('ui.modSources') }}</dt>
          <dd>
            <span
              v-if="view.sourceOptions.length > 1"
              class="library-detail__segmented"
              role="group"
              :aria-label="$t('ui.modSources')"
            >
              <button
                v-for="option in view.sourceOptions"
                :key="option.value"
                type="button"
                class="library-detail__segment"
                :class="{ 'is-active': view.source === option.value }"
                :aria-pressed="view.source === option.value"
                @click="emit('switch-source', option.value)"
              >
                {{ option.label }}
              </button>
            </span>
            <strong v-else-if="view.hasSources">{{ view.sourceLabel }}</strong>
            <span v-else class="library-detail__muted">{{ $t('ui.detectedLocallyNoModSourceLinked') }}</span>
          </dd>
          <dt>{{ $t('ui.gameFolder') }}</dt>
          <dd class="library-detail__path-row">
            <template v-if="view.path">
              <span
                class="library-detail__path"
                :class="{ 'is-warning': view.status === 'missing' }"
                :title="view.path"
              >
                {{ view.path }}
              </span>
              <button
                type="button"
                class="library-detail__icon-button"
                :aria-label="$t('ui.copyGamePath')"
                :title="$t('ui.copyGamePath')"
                @click="emit('copy-path')"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
                  <path d="M3 10.5H2.5v-8h8V3" />
                </svg>
              </button>
            </template>
            <span v-else class="library-detail__muted">{{ $t('ui.notBound') }}</span>
          </dd>
        </dl>
      </div>

      <section class="library-detail__recent" aria-labelledby="library-recent-title">
        <div class="library-detail__recent-header">
          <h3 id="library-recent-title">{{ $t('ui.recentlyInstalled') }}</h3>
          <button
            v-if="view.hasSources && view.modCount > 0"
            type="button"
            class="library-detail__link"
            @click="emit('manage')"
          >
            {{ $t('ui.viewAll') }}
          </button>
        </div>
        <div class="library-detail__recent-box">
          <p v-if="!view.hasSources" class="library-detail__empty">
            {{ $t('ui.thisGameWasDetectedLocallyAndHasNoModSource') }}
          </p>
          <ul v-else-if="recentState === 'loading'" class="library-detail__list" aria-busy="true">
            <li
              v-for="index in recentLimit"
              :key="index"
              class="library-detail__item"
              aria-hidden="true"
            >
              <span class="library-detail__skeleton"></span>
            </li>
          </ul>
          <ul v-else-if="recentMods.length" class="library-detail__list">
            <li v-for="mod in recentMods" :key="mod.id" class="library-detail__item">
              <span
                class="library-detail__dot"
                :class="mod.isActive ? 'is-ready' : 'is-off'"
                aria-hidden="true"
              ></span>
              <span
                class="library-detail__mod"
                :title="mod.version ? `${mod.name} v${mod.version}` : mod.name"
              >
                {{ mod.name }}
              </span>
              <span class="library-detail__mod-state">{{
                mod.isActive ? $t('ui.enabled') : $t('modelSettings.disabled')
              }}</span>
            </li>
          </ul>
          <p v-else class="library-detail__empty">{{ recentEmptyText() }}</p>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
$warning-text: color-mix(in srgb, var(--color-warning) 50%, var(--color-black));
$warning-bg: color-mix(in srgb, var(--color-warning-soft) 45%, var(--color-white));
$warning-border: color-mix(in srgb, var(--color-warning) 28%, var(--color-white));
$panel-border: color-mix(in srgb, var(--color-border) 70%, var(--color-white));

@mixin focus-ring {
  outline: none;

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.library-detail {
  position: relative;
  margin-top: 18px;
  padding: var(--space-6);
  background: var(--color-surface-soft);
  border: 1px solid $panel-border;
  border-radius: var(--radius-lg);
}

// 小箭头对准选中卡片的中心，位置由页面按列号计算。
.library-detail__caret {
  position: absolute;
  top: -8px;
  left: var(--caret-left);
  width: 14px;
  height: 14px;
  background: var(--color-surface-soft);
  border-top: 1px solid $panel-border;
  border-left: 1px solid $panel-border;
  transform: rotate(45deg);
}

.library-detail__close {
  @include focus-ring;

  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-strong);
  }
}

.library-detail__layout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-7);
}

.library-detail__cover {
  position: relative;
  display: flex;
  flex: 0 1 320px;
  align-self: flex-start;
  align-items: center;
  justify-content: center;
  min-width: 240px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--cover-tone, var(--color-surface-strong));
  border-radius: 10px;

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.library-detail__monogram {
  color: rgba(255, 255, 255, 0.5);
  font-size: 44px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 3px;
  line-height: 1;
}

.library-detail__main {
  display: flex;
  flex: 1 1 380px;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.library-detail__title {
  margin: 0;
  padding-right: var(--space-10);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.library-detail__subtitle {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.library-detail__summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.library-detail__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  background: var(--color-text-subtle);
  border-radius: 50%;

  &.is-ready {
    background: var(--color-success);
  }

  &.is-missing {
    background: var(--color-warning);
  }

  &.is-off {
    background: var(--color-border-strong);
  }
}

.library-detail__note {
  margin: 10px 0 0;
  padding: 10px var(--space-3);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--color-surface);
  border: 1px solid $panel-border;
  border-radius: var(--radius-md);

  &.is-warning {
    color: $warning-text;
    background: $warning-bg;
    border-color: $warning-border;
  }
}

.library-detail__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: 14px;
}

.library-detail__play {
  width: 13px;
  height: 13px;
  margin-right: var(--space-2);
}

.library-detail__count {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

.library-detail__more {
  @include focus-ring;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-lg);
  height: var(--control-height-lg);
  padding: 0;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover,
  &[aria-expanded='true'] {
    color: var(--color-text);
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }
}

.library-detail__facts {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 10px var(--space-3);
  margin: var(--space-4) 0 0;
  font-size: var(--font-size-sm);

  dt {
    color: var(--color-text-tertiary);
  }

  dd {
    min-width: 0;
    margin: 0;
  }

  strong {
    font-weight: var(--font-weight-semibold);
  }
}

.library-detail__muted {
  color: var(--color-text-tertiary);
}

.library-detail__segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.library-detail__segment {
  @include focus-ring;

  height: 26px;
  padding: 0 var(--space-3);
  color: var(--color-text-tertiary);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-semibold);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &.is-active {
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }
}

.library-detail__path-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.library-detail__path {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  white-space: nowrap;
  text-overflow: ellipsis;

  &.is-warning {
    color: $warning-text;
  }
}

.library-detail__icon-button {
  @include focus-ring;

  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--color-text-tertiary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-strong);
  }
}

.library-detail__recent {
  display: flex;
  flex: 0 1 300px;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 240px;
}

.library-detail__recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  // 给右上角的收起按钮留位置。
  padding-right: var(--space-8);

  h3 {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
}

.library-detail__link {
  @include focus-ring;

  height: 28px;
  padding: 0 var(--space-2);
  color: var(--color-accent-active);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-semibold);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-strong);
  }
}

.library-detail__recent-box {
  padding: 2px 14px;
  background: var(--color-surface);
  border: 1px solid $panel-border;
  border-radius: 10px;
}

.library-detail__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-detail__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;

  & + & {
    border-top: 1px solid var(--color-surface-hover);
  }
}

.library-detail__mod {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.library-detail__mod-state {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.library-detail__skeleton {
  display: block;
  width: 70%;
  height: 10px;
  background: var(--color-surface-strong);
  border-radius: var(--radius-xs);
}

.library-detail__empty {
  margin: 0;
  padding: var(--space-3) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}
</style>
