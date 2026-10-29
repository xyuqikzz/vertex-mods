<script setup>
import { useI18n } from 'vue-i18n'
import { gamePresentation } from '@renderer/i18n/content.js'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import GameCover from '@renderer/views/game/component/index/game-cover.vue'
import AppImage from '@renderer/component/AppImage.vue'
import { getRetiredSourceFailure } from '../../../../../shared/sources/retired-source-policy.js'
import {
  getQuickLaunchPrimaryActionText,
  shouldInjectQuickLaunchMods
} from '@renderer/utils/quick-launch-game-action.js'
import {
  getQuickLaunchGameDirectory,
  getQuickLaunchGameStatus,
  getQuickLaunchModCount,
  hasQuickLaunchModSource
} from '@renderer/utils/quick-launch-game-info.js'
import { getGameCoverUrl, getSteamGameArtUrl } from '@renderer/utils/game-art.js'

// 首页轮播大图：后台广告按原顺序排在前面，最后一页是选中的游戏（默认最常启动）；
// 没有本地游戏时最后一页换成「开始使用」。
// 播放规则：本次运行第一次进入首页从第 1 条广告开始自动播放，播到最后一页停止；
// 之后再回到首页直接停在最后一页。悬停、焦点在轮播内、窗口失焦或页面隐藏时暂停。
// 游戏页：有模组来源时显示来源、模组数和「管理模组 | 浏览模组」；本机扫描游戏（没有模组来源）
// 只显示「本机扫描」和安装目录，操作只有启动和打开游戏目录。

const { t } = useI18n()
const props = defineProps({
  adList: {
    type: Array,
    default: () => []
  },
  featuredGame: {
    type: Object,
    default: null
  },
  featuredIsTop: {
    type: Boolean,
    default: true
  },
  gamesLoading: {
    type: Boolean,
    default: false
  },
  // 用户在快捷启动里主动选择游戏时递增，轮播立即切到游戏页并停止自动播放
  focusToken: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits([
  'start-game',
  'manage-mod',
  'preview-mod',
  'open-game-dir',
  'refresh-games',
  'open-mod-center'
])

const AUTO_PLAY_INTERVAL = 5000

// 模块级标记：渲染进程本次运行内只自动播放一轮广告
let adsAutoPlayedThisRun = false

const rootRef = ref(null)
const currentIndex = ref(0)
const autoPlaying = ref(false)
const userControlled = ref(false)
const hovered = ref(false)
const focusWithin = ref(false)
const pageVisible = ref(typeof document === 'undefined' ? true : !document.hidden)
const windowFocused = ref(typeof document === 'undefined' ? true : document.hasFocus())
const viewActive = ref(true)
const heroArtLoaded = ref(false)
const heroArtFailed = ref(false)
let autoPlayTimer = null

const normalizedAds = computed(() => {
  return (Array.isArray(props.adList) ? props.adList : [])
    .filter((item) => item && item.imageUrl)
    .map((item, index) => ({
      id: item.id ?? index,
      title: item.title || t('hero.recommendation'),
      imageUrl: item.imageUrl,
      linkUrl: item.linkUrl || ''
    }))
})

const finalSlide = computed(() => {
  if (props.featuredGame) return { type: 'game', key: 'game', label: featuredLabel.value }
  if (!props.gamesLoading) return { type: 'welcome', key: 'welcome', label: t('hero.start') }
  return null
})

const slides = computed(() => {
  const list = normalizedAds.value.map((ad) => ({
    type: 'ad',
    key: `ad-${ad.id}`,
    label: ad.title,
    ad
  }))
  if (finalSlide.value) list.push(finalSlide.value)
  if (!list.length) list.push({ type: 'pending', key: 'pending', label: t('quickLaunch.reading') })
  return list
})

const lastIndex = computed(() => slides.value.length - 1)
const adSignature = computed(() =>
  normalizedAds.value.map((ad) => `${ad.id}|${ad.imageUrl}`).join(',')
)
const paused = computed(
  () =>
    hovered.value ||
    focusWithin.value ||
    !pageVisible.value ||
    !windowFocused.value ||
    !viewActive.value
)

const game = computed(() => props.featuredGame || {})
const featuredLabel = computed(() => (props.featuredIsTop ? t('hero.mostPlayed') : t('hero.selected')))
const gameName = computed(() => gamePresentation(game.value).title || t('quickLaunch.unknown'))
const gameSubtitle = computed(() => {
  // 「本地已安装」只是没有英文名时的占位，大图上不再重复显示
  if (game.value.displaySubtitleKey === 'quickLaunch.locallyInstalled') return ''
  const subtitle = gamePresentation(game.value).subtitle
  return subtitle && subtitle !== gameName.value ? subtitle : ''
})
const gameHasModSource = computed(() => hasQuickLaunchModSource(game.value))
const gameSourceLabel = computed(() => {
  if (!gameHasModSource.value) return ''
  const label = String(game.value.sourceLabel || game.value.currentSource || '').trim()
  return label && label !== '--' ? label : ''
})
const gameModCount = computed(() =>
  gameHasModSource.value ? getQuickLaunchModCount(game.value) : 0
)
const gameDirectory = computed(() =>
  gameHasModSource.value ? '' : getQuickLaunchGameDirectory(game.value)
)
const gameStatus = computed(() => getQuickLaunchGameStatus(game.value))
const gameBusy = computed(() => gameStatus.value !== 'ready')
const gameInject = computed(() => shouldInjectQuickLaunchMods(game.value))
const gamePrimaryText = computed(() => {
  if (gameStatus.value === 'updating') return t('quickLaunch.updating')
  if (gameStatus.value === 'disabled') return t('quickLaunch.disabled')
  return getQuickLaunchPrimaryActionText(game.value, t)
})
const canPreviewGame = computed(
  () =>
    gameHasModSource.value && !getRetiredSourceFailure(game.value.currentSource || game.value.source)
)
const gameCoverUrl = computed(() => getGameCoverUrl(game.value))
const heroArtUrl = computed(() => getSteamGameArtUrl(game.value, 'hero'))

watch(heroArtUrl, () => {
  heroArtLoaded.value = false
  heroArtFailed.value = false
})

function clearAutoPlayTimer() {
  if (autoPlayTimer) {
    clearTimeout(autoPlayTimer)
    autoPlayTimer = null
  }
}

function scheduleAutoPlay() {
  clearAutoPlayTimer()
  if (!autoPlaying.value || paused.value) return
  autoPlayTimer = setTimeout(advanceAutoPlay, AUTO_PLAY_INTERVAL)
}

function stopAutoPlay() {
  autoPlaying.value = false
  clearAutoPlayTimer()
}

function startAutoPlay() {
  autoPlaying.value = true
  currentIndex.value = 0
  scheduleAutoPlay()
}

function advanceAutoPlay() {
  autoPlayTimer = null
  if (!autoPlaying.value) return
  if (currentIndex.value < lastIndex.value) {
    currentIndex.value += 1
  }
  // 最后一页（游戏 / 开始使用）出现后停止；本机游戏还在读取时停在最后一条广告等待
  if (currentIndex.value >= lastIndex.value && finalSlide.value) {
    stopAutoPlay()
    return
  }
  scheduleAutoPlay()
}

function goTo(index) {
  userControlled.value = true
  stopAutoPlay()
  currentIndex.value = Math.min(Math.max(index, 0), lastIndex.value)
}

function openAd(ad) {
  if (!ad?.linkUrl) return
  window.open(ad.linkUrl, '_blank')
}

// 只加载当前页及下一页，避免不可见的轮播页抢占首屏带宽。
function shouldLoadSlide(index) {
  return index === currentIndex.value || index === currentIndex.value + 1
}

function handleFocusOut(event) {
  if (!rootRef.value?.contains(event.relatedTarget)) {
    focusWithin.value = false
  }
}

function handleVisibilityChange() {
  pageVisible.value = !document.hidden
}

function handleWindowFocus() {
  windowFocused.value = true
}

function handleWindowBlur() {
  windowFocused.value = false
}

// 页数变化时保持在原来的逻辑位置：未手动切换时始终停在最后一页
watch(lastIndex, (last, previousLast) => {
  if (currentIndex.value > last) {
    currentIndex.value = last
    return
  }
  if (!autoPlaying.value && !userControlled.value && currentIndex.value === previousLast) {
    currentIndex.value = last
  }
})

watch(
  adSignature,
  () => {
    if (!normalizedAds.value.length) {
      stopAutoPlay()
      currentIndex.value = lastIndex.value
      return
    }
    // 自动播放期间广告列表更新（缓存 → 接口）：从第 1 条重新开始
    if (autoPlaying.value) {
      currentIndex.value = 0
      scheduleAutoPlay()
      return
    }
    if (!adsAutoPlayedThisRun && !userControlled.value) {
      adsAutoPlayedThisRun = true
      startAutoPlay()
      return
    }
    currentIndex.value = userControlled.value
      ? Math.min(currentIndex.value, lastIndex.value)
      : lastIndex.value
  },
  { immediate: true }
)

watch(paused, () => {
  scheduleAutoPlay()
})

watch(
  () => props.focusToken,
  () => {
    userControlled.value = true
    stopAutoPlay()
    currentIndex.value = lastIndex.value
  }
)

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('blur', handleWindowBlur)
})

onActivated(() => {
  viewActive.value = true
})

// 离开首页（keep-alive 缓存）后再回来：直接停在最后一页，不再重播广告
onDeactivated(() => {
  viewActive.value = false
  stopAutoPlay()
  currentIndex.value = lastIndex.value
})

onUnmounted(() => {
  stopAutoPlay()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('blur', handleWindowBlur)
})
</script>

<template>
  <section
    ref="rootRef"
    class="hero"
    aria-roledescription="carousel"
    :aria-label="t('hero.carousel')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focusWithin = true"
    @focusout="handleFocusOut"
  >
    <div
      v-for="(slide, index) in slides"
      :key="slide.key"
      class="hero-slide"
      :class="[`is-${slide.type}`, { 'is-active': index === currentIndex }]"
      role="group"
      aria-roledescription="slide"
      :aria-label="t('hero.slide', { index: index + 1, total: slides.length, label: slide.label })"
      :aria-hidden="index === currentIndex ? undefined : 'true'"
      :inert="index === currentIndex ? undefined : ''"
    >
      <!-- 广告 -->
      <template v-if="slide.type === 'ad'">
        <button
          v-if="slide.ad.linkUrl"
          type="button"
          class="hero-ad"
          :aria-label="t('hero.open', { title: slide.ad.title })"
          @click="openAd(slide.ad)"
        >
          <AppImage v-if="shouldLoadSlide(index)" class="hero-ad__image" :src="slide.ad.imageUrl" alt="" loading="eager" />
        </button>
        <div v-else class="hero-ad">
          <AppImage
            v-if="shouldLoadSlide(index)"
            class="hero-ad__image"
            :src="slide.ad.imageUrl"
            :alt="slide.ad.title"
            loading="eager"
          />
        </div>
      </template>

      <!-- 选中游戏（默认最常启动） -->
      <template v-else-if="slide.type === 'game'">
        <div class="hero-art" aria-hidden="true">
          <game-cover :src="shouldLoadSlide(index) ? gameCoverUrl : ''" :fallback-text="gameName" fallback-mode="name" loading="eager" />
          <img
            v-if="shouldLoadSlide(index) && heroArtUrl && !heroArtFailed"
            class="hero-art__image"
            :class="{ 'is-loaded': heroArtLoaded }"
            :src="heroArtUrl"
            alt=""
            draggable="false"
            decoding="async"
            @load="heroArtLoaded = true"
            @error="heroArtFailed = true"
          />
        </div>
        <div class="hero-shade" aria-hidden="true"></div>
        <!-- 「最常启动 / 已选择」只保留在轮播页的无障碍标签里，画面上不再显示 -->
        <div class="hero-content is-game">
          <div class="hero-heading">
            <h2 class="hero-title" :title="gameName">{{ gameName }}</h2>
            <p v-if="gameSubtitle" class="hero-subtitle">{{ gameSubtitle }}</p>
          </div>
          <div v-if="gameHasModSource && (gameSourceLabel || gameModCount)" class="hero-chips">
            <span v-if="gameSourceLabel" class="hero-chip">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
                <path d="m4 12 8 4.5 8-4.5" />
                <path d="m4 16.5 8 4.5 8-4.5" />
              </svg>
              {{ gameSourceLabel }}
            </span>
            <span v-if="gameModCount" class="hero-chip">
              {{ t('quickLaunch.modCount', { count: gameModCount }, gameModCount) }}
            </span>
          </div>
          <div v-else-if="!gameHasModSource" class="hero-chips">
            <span class="hero-chip">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
              {{ t('hero.localGame') }}
            </span>
            <span v-if="gameDirectory" class="hero-path" :title="gameDirectory">
              {{ gameDirectory }}
            </span>
          </div>
          <div class="hero-actions">
            <button
              type="button"
              class="hero-btn is-primary"
              :disabled="gameBusy"
              @click="emit('start-game', featuredGame)"
            >
              <svg
                v-if="gameStatus === 'updating'"
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="is-stroke is-spinning"
              >
                <path d="M12 3a9 9 0 1 1-9 9" />
              </svg>
              <svg v-else-if="gameInject" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13.2 2.5 5 13.4h6.1l-.9 8.1 8.3-11h-6.2l.9-8z" />
              </svg>
              <svg v-else viewBox="0 0 1024 1024" aria-hidden="true">
                <path
                  d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z m144.1 465.4l-196.6 142.6c-13.4 9.7-32.1 0.2-32.1-16.3V370.4c0-16.5 18.7-26 32.1-16.3l196.6 142.6c11.1 8.1 11.1 24.6 0 32.7z"
                />
              </svg>
              {{ gamePrimaryText }}
            </button>
            <template v-if="gameHasModSource">
              <div class="hero-btn-group" role="group" :aria-label="t('hero.modActions')">
                <button type="button" class="hero-btn" @click="emit('manage-mod', featuredGame)">
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                    <circle cx="15" cy="7" r="2" />
                    <circle cx="9" cy="17" r="2" />
                  </svg>
                  {{ t('quickLaunch.manage') }}
                </button>
                <button
                  v-if="canPreviewGame"
                  type="button"
                  class="hero-btn"
                  @click="emit('preview-mod', featuredGame)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m15.5 8.5-2 5-5 2 2-5z" />
                  </svg>
                  {{ t('quickLaunch.browse') }}
                </button>
              </div>
              <button
                type="button"
                class="hero-btn is-icon"
                :aria-label="t('quickLaunch.openDirectory')"
                :title="t('quickLaunch.openDirectory')"
                @click="emit('open-game-dir', featuredGame)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                  <path
                    d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
                  />
                </svg>
              </button>
            </template>
            <button
              v-else
              type="button"
              class="hero-btn"
              @click="emit('open-game-dir', featuredGame)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="is-stroke">
                <path
                  d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"
                />
              </svg>
              {{ t('quickLaunch.openDirectory') }}
            </button>
          </div>
        </div>
      </template>

      <!-- 没有本地游戏：开始使用 -->
      <template v-else-if="slide.type === 'welcome'">
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="hero-content is-welcome">
          <div class="hero-welcome-copy">
            <span class="hero-pill">{{ t('hero.start') }}</span>
            <h2 class="hero-title">{{ t('hero.addGames') }}</h2>
            <p class="hero-desc">
              {{ t('hero.description') }}
            </p>
            <div class="hero-actions">
              <button
                type="button"
                class="hero-btn is-primary"
                :disabled="gamesLoading"
                @click="emit('refresh-games')"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="is-stroke"
                  :class="{ 'is-spinning': gamesLoading }"
                >
                  <path
                    d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"
                  />
                </svg>
                {{ gamesLoading ? t('hero.refreshing') : t('hero.refresh') }}
              </button>
              <button type="button" class="hero-btn" @click="emit('open-mod-center')">
                {{ t('hero.mods') }}
              </button>
            </div>
          </div>
          <ol class="hero-steps">
            <li class="hero-step">
              <span class="hero-step__index">01</span>
              <span class="hero-step__title">{{ t('hero.detect') }}</span>
              <span class="hero-step__desc">{{ t('hero.detectHint') }}</span>
            </li>
            <li class="hero-step">
              <span class="hero-step__index">02</span>
              <span class="hero-step__title">{{ t('hero.install') }}</span>
              <span class="hero-step__desc">{{ t('hero.installHint') }}</span>
            </li>
            <li class="hero-step">
              <span class="hero-step__index">03</span>
              <span class="hero-step__title">{{ t('hero.launch') }}</span>
              <span class="hero-step__desc">{{ t('hero.launchHint') }}</span>
            </li>
          </ol>
        </div>
      </template>

      <!-- 广告和本机游戏都还在读取 -->
      <div v-else class="hero-pending" role="status">{{ t('quickLaunch.reading') }}</div>
    </div>

    <div v-if="slides.length > 1" class="hero-dots" role="group" :aria-label="t('hero.switch')">
      <button
        v-for="(slide, index) in slides"
        :key="`dot-${slide.key}`"
        type="button"
        class="hero-dot"
        :class="{ 'is-active': index === currentIndex }"
        :aria-label="t('hero.dot', { index: index + 1, label: slide.label })"
        :aria-current="index === currentIndex ? 'true' : undefined"
        @click="goTo(index)"
      >
        <span class="hero-dot__bar"></span>
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
$hero-ink: #010510;
$accent: #0a96ff;

.hero {
  position: relative;
  min-width: 0;
  // 轮播固定使用广告图原始比例（1635:408），广告不裁切；游戏页、开始使用页共用同一尺寸
  aspect-ratio: var(--home-ad-ratio, 1635 / 408);
  container: home-hero / inline-size;
  border-radius: 14px;
  overflow: hidden;
  background: $hero-ink;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
  isolation: isolate;
}

.hero-slide {
  position: absolute;
  inset: 0;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--duration-slow) var(--ease-standard),
    visibility 0s linear var(--duration-slow);

  &.is-active {
    z-index: 1;
    opacity: 1;
    visibility: visible;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }
}

/* 广告 */
.hero-ad {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: $hero-ink;
  cursor: default;

  &:is(button) {
    cursor: pointer;
  }

  &:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: -4px;
    border-radius: 14px;
  }
}

.hero-ad__image {
  display: block;
  width: 100%;
  height: 100%;
  // 容器与广告图同比例，cover 不会裁切；个别比例略有出入的图只会居中裁掉边缘几像素
  object-fit: cover;
  object-position: center;
}

/* 游戏大图 */
.hero-art {
  position: absolute;
  inset: 0;
}

// 没有任何封面时保持深色底，游戏名已在左侧显示
.hero .hero-art :deep(.game-cover.is-fallback) {
  background: $hero-ink;
}

.hero .hero-art :deep(.game-cover__fallback) {
  display: none;
}

.hero-art__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  // Steam 宽幅图底部常带黑边，顶部对齐把它裁掉
  object-position: 70% 0%;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-standard);

  &.is-loaded {
    opacity: 1;
  }
}

.hero-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(1, 5, 16, 0.92) 0%,
    rgba(1, 5, 16, 0.66) 36%,
    rgba(1, 5, 16, 0) 68%
  );
}

.hero-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 78% 50%,
    rgba(10, 150, 255, 0.28) 0%,
    rgba(10, 150, 255, 0) 55%
  );
}

.hero-content {
  position: relative;
  z-index: 1;
  height: 100%;
  // 英文按钮较长，640 内放得下「启动 + 模组按钮组 + 目录」一行
  max-width: 640px;
  box-sizing: border-box;
  padding: 24px 36px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;

  // 游戏页：名称等信息从顶部排列，操作按钮固定在底部，
  // 有没有英文名、来源标签，按钮都在同一位置
  &.is-game {
    justify-content: flex-start;
    padding-block: 30px;
  }

  &.is-welcome {
    max-width: none;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
  }
}

.hero-welcome-copy {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hero-pill {
  align-self: flex-start;
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(92, 194, 255, 0.4);
  border-radius: 999px;
  background: rgba(10, 150, 255, 0.18);
  color: #8fd3ff;
  font-size: 12px;
  font-weight: 700;

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5cc2ff;
  }
}

.hero-heading {
  min-width: 0;
}

.hero-title {
  margin: 0;
  overflow: hidden;
  color: #ffffff;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.15;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-subtitle {
  margin: 6px 0 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-desc {
  max-width: 440px;
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
  line-height: 22px;
}

.hero-chips {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hero-chip {
  flex: none;
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;

  svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }
}

// 本机扫描游戏的安装目录：等宽字体单行省略，完整路径在 title 里
.hero-path {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.66);
  font-family: Consolas, 'Cascadia Mono', monospace;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-actions {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hero-btn {
  height: 40px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  svg {
    width: 15px;
    height: 15px;
    fill: currentColor;

    &.is-stroke {
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    &.is-spinning {
      animation: hero-spin 0.9s linear infinite;
    }
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.is-primary {
    padding: 0 22px;
    border-color: rgba(10, 150, 255, 0.4);
    background: $accent;
    font-size: 14px;
    font-weight: 700;
    box-shadow:
      0 8px 20px rgba(10, 150, 255, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.28);

    &:hover:not(:disabled) {
      background: #1a9dff;
      box-shadow: 0 4px 12px rgba(10, 150, 255, 0.45);
    }
  }

  &.is-icon {
    width: 40px;
    padding: 0;
  }
}

// 「管理模组 | 浏览模组」合成一组，与启动按钮区分主次
.hero-btn-group {
  display: flex;
  height: 40px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;

  .hero-btn {
    height: 100%;
    padding: 0 14px;
    border: 0;
    border-radius: 0;
    background: transparent;

    & + .hero-btn {
      border-left: 1px solid rgba(255, 255, 255, 0.18);
    }

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }

    &:active:not(:disabled) {
      transform: none;
    }

    &:focus-visible {
      outline-offset: -3px;
      border-radius: 9px;
    }
  }
}

// 选择器加上 .is-game，避免被下方容器查询里的 margin-top 覆盖
.hero-content.is-game .hero-actions {
  margin-top: auto;
}

/* 开始使用步骤 */
.hero-steps {
  flex: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 12px;
  list-style: none;
}

.hero-step {
  width: 136px;
  box-sizing: border-box;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.hero-step__index {
  color: #5cc2ff;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}

.hero-step__title {
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
}

.hero-step__desc {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  line-height: 18px;
}

.hero-pending {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

/* 圆点 */
.hero-dots {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
}

.hero-dot {
  padding: 8px 3px;
  display: flex;
  border: 0;
  background: transparent;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: -2px;
    border-radius: 6px;
  }
}

.hero-dot__bar {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.45);
  transition:
    width var(--duration-base) var(--ease-standard),
    background-color var(--duration-base) var(--ease-standard);
}

.hero-dot.is-active .hero-dot__bar {
  width: 18px;
  background: #ffffff;
}

.hero-dot:hover:not(.is-active) .hero-dot__bar {
  background: rgba(255, 255, 255, 0.75);
}

@keyframes hero-spin {
  to {
    transform: rotate(360deg);
  }
}

// 轮播高度随宽度变化（宽 / 4），内容按可用高度逐级收紧
@container home-hero (max-width: 960px) {
  .hero-content {
    padding: 22px 32px;
    gap: 8px;
  }

  .hero-content.is-game {
    padding-block: 26px;
  }

  .hero-welcome-copy {
    gap: 8px;
  }

  .hero-title {
    font-size: 28px;
  }

  .hero-subtitle,
  .hero-steps {
    display: none;
  }

  .hero-actions {
    margin-top: 2px;
  }
}

@container home-hero (max-width: 760px) {
  .hero-chips,
  .hero-desc {
    display: none;
  }

  .hero-title {
    font-size: 26px;
  }

  .hero-btn,
  .hero-btn-group {
    height: 36px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-slide,
  .hero-slide.is-active,
  .hero-art__image,
  .hero-btn,
  .hero-dot__bar {
    transition: none;
  }

  .hero-btn svg.is-spinning {
    animation: none;
  }
}
</style>
