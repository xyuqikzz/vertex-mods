<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { uiMessage } from '../../../../i18n/message.js'

import { computed } from 'vue'
import { gamePresentation } from '@renderer/i18n/content.js'
import { getRetiredSourceFailure } from '../../../../../../shared/sources/retired-source-policy.js'
import { publicGameKey } from '../../../../../../shared/games/game-rule-support.js'
import router from '@renderer/router/index.js'
import { $message } from '@renderer/common/message.js'
import GameCover from './game-cover.vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { positivePlatformId } from '../../../../../../shared/sources/community-source.js'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import { GAME_CARD_MIN_COLUMN, normalizeGameCardLayout } from './game-card-layout.js'

const props = defineProps({
  // 只有聚合来源里各卡片来源不同，单一来源下来源名重复，不再显示。
  showSource: {
    type: Boolean,
    default: false
  },
  // portrait：竖版封面（Thunderstore、Nexus）；landscape：横版封面（其余来源与聚合）。
  layout: {
    type: String,
    default: 'landscape',
    validator: (value) => ['portrait', 'landscape'].includes(value)
  },
  pageData: {
    type: Object,
    default: () => ({
      records: [],
      total: 0,
      size: 20,
      current: 1,
      pages: 1
    })
  }
})

const emit = defineEmits(['page-change', 'refresh'])

// 最小列宽与 index.vue 计算每页数量用的是同一个值，列数才能对得上。
const gridStyle = computed(() => ({
  '--game-card-min-column': `${GAME_CARD_MIN_COLUMN[normalizeGameCardLayout(props.layout)]}px`
}))

const SOURCE_PLATFORM = Object.freeze({
  THUNDERSTORE: 'thunderstore',
  FICSIT: 'ficsit',
  NEXUS: 'nexus',
  MODIO: 'modio',
  VAMHUB: 'vamhub'
})

function normalizeSourceKey(value = '') {
  const source = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '')

  if (source === 'ficsit') return SOURCE_PLATFORM.FICSIT
  if (source === 'nexus') return SOURCE_PLATFORM.NEXUS
  if (source === 'modio') return SOURCE_PLATFORM.MODIO
  if (source === 'vamhub' || source === 'vam') return SOURCE_PLATFORM.VAMHUB
  if (source === 'thunderstore') return SOURCE_PLATFORM.THUNDERSTORE
  if (source === 'steamworkshop') return 'steam-workshop'
  return source
}

function isRemovedModrinthSource(value = '') {
  const source = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
  return source === 'modrinth' || source === 'modrinth4'
}

function resolveTargetSourcePlatform(item = {}) {
  return normalizeSourceKey(
    item?.targetSourcePlatform ||
      item?.target_source_platform ||
      item?.targetPlatform ||
      item?.target_platform ||
      ''
  )
}

function resolveRouteSourcePlatform(item = {}) {
  const targetSourcePlatform = resolveTargetSourcePlatform(item)
  if (targetSourcePlatform) return targetSourcePlatform
  if (Number(item?.isFicsit || 0) === 1) return SOURCE_PLATFORM.FICSIT
  if (Number(item?.isNexus || 0) === 1) return SOURCE_PLATFORM.NEXUS
  if (Number(item?.isModio || 0) === 1) return SOURCE_PLATFORM.MODIO
  if (Number(item?.isSQ || 0) === 1) return SOURCE_PLATFORM.THUNDERSTORE
  return normalizeSourceKey(item?.sourcePlatform || item?.source_platform || item?.source || '')
}

function resolveSourceBadgeClass(item = {}) {
  return resolveRouteSourcePlatform(item) || 'unknown'
}

function resolveSourceBadgeText(item = {}) {
  const displayName = firstSafeText(
    item?.targetSourcePlatformName,
    item?.target_source_platform_name,
    item?.sourcePlatformName,
    item?.source_platform_name
  )
  if (displayName) return displayName

  const source = resolveRouteSourcePlatform(item)
  if (source === 'gamebanana' || source === 'steam-workshop') return resolveSourcePlatformLabel(source)
  if (source === SOURCE_PLATFORM.FICSIT) return 'Ficsit'
  if (source === SOURCE_PLATFORM.NEXUS) return 'Nexus'
  if (source === SOURCE_PLATFORM.MODIO) return 'Modio'
  if (source === SOURCE_PLATFORM.VAMHUB) return 'VAM-Hub'
  if (source === SOURCE_PLATFORM.THUNDERSTORE) return 'Thunderstore'
  return String(item?.source || source || '').trim()
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) {
      return number
    }
  }
  return 0
}

function firstSafeText(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

const goToDetails = (item) => {
  if (
    isRemovedModrinthSource(
      item?.targetSourcePlatform ||
        item?.target_source_platform ||
        item?.sourcePlatform ||
        item?.source_platform ||
        item?.source
    )
  ) {
    $message.warning(uiMessage('ui.theModrinthSourceHasBeenRetiredAndCannotBeOpened'))
    return
  }

  const sourcePlatform = resolveRouteSourcePlatform(item)
  const retired = getRetiredSourceFailure(sourcePlatform)
  if (retired) {
    $message.warning(retired.message)
    return
  }

  if (sourcePlatform === 'gamebanana' || sourcePlatform === 'steam-workshop') {
    try {
      const id = sourcePlatform === 'steam-workshop' ? item.steamAppId : item.sourceGameId
      router.push({
        name: 'GameCommunityModList',
        params: { source: sourcePlatform, id: positivePlatformId(id) },
        query: {
          gameKey: publicGameKey(item),
          gameName: firstSafeText(item.chineseTitle, item.englishTitle, id),
          englishTitle: firstSafeText(item.englishTitle),
          publicGameKey: firstSafeText(item.gameKey),
          cover: firstSafeText(item.coverImage, getImgUrl(item))
        }
      })
    } catch { $message.warning(uiMessage('ui.thisGameHasNoValidSourceIdentifier')) }
  } else if (sourcePlatform === SOURCE_PLATFORM.THUNDERSTORE) {
    const thunderstoreGameId = firstSafeText(item?.sourceGameId, item?.sourceSlug, item?.id)
    if (!thunderstoreGameId) {
      $message.warning(uiMessage('ui.thisThunderstoreGameHasNoValidIdentifier'))
      return
    }
    router.push(`/app/game/thunderstore/mod/list/${encodeURIComponent(thunderstoreGameId)}`)
  } else if (sourcePlatform === SOURCE_PLATFORM.FICSIT) {
    const ficsitGameId = firstPositiveNumber(
      item?.sourceGameId,
      item?.source_game_id,
      item?.id,
      item?.steamAppId,
      item?.steam_app_id
    )
    if (!Number.isFinite(ficsitGameId) || ficsitGameId <= 0) {
      $message.warning(uiMessage('ui.thisFicsitGameHasNoValidIdentifier'))
      return
    }
    router.push({
      path: `/app/game/ficsit/mod/list/${encodeURIComponent(String(ficsitGameId))}`,
      query: {
        gameKey: publicGameKey(item),
        name: firstSafeText(item?.chineseTitle, item?.englishTitle, item?.sourceSlug, '幸福工厂'),
        englishName: firstSafeText(item?.englishTitle, item?.sourceSlug, 'Satisfactory'),
        cover: String(item?.coverImage || '').trim(),
        desc: String(item?.description || '').trim(),
        mods: String(item?.modCount || 0),
        steamAppId: String(item?.steamAppId || item?.steam_app_id || ficsitGameId),
        gameId: String(ficsitGameId)
      }
    })
  } else if (sourcePlatform === SOURCE_PLATFORM.NEXUS) {
    const domainName = firstSafeText(
      item?.nexusDomainName,
      item?.sourceSlug,
      item?.source_game_slug,
      item?.id
    )
    if (!domainName) {
      $message.warning(uiMessage('ui.thisGameHasNoNexusIdentifier'))
      return
    }
    router.push({
      path: `/app/game/nexus/mod/list/${encodeURIComponent(domainName)}`,
      query: {
        gameKey: publicGameKey(item),
        name: String(item?.chineseTitle || item?.englishTitle || domainName).trim(),
        englishTitle: String(item?.englishTitle || '').trim(),
        cover: String(item?.coverImage || '').trim(),
        mods: String(item?.modCount || 0),
        nexusGameId: String(item?.nexusGameId || item?.sourceGameId || item?.source_game_id || ''),
        backendGameId: String(item?.backendGameId || ''),
        appId: String(item?.steamAppId || item?.appId || '')
      }
    })
  } else if (sourcePlatform === SOURCE_PLATFORM.MODIO) {
    const modioGameId = firstPositiveNumber(
      item?.modioGameId,
      item?.sourceGameId,
      item?.source_game_id,
      item?.id
    )
    if (!Number.isFinite(modioGameId) || modioGameId <= 0) {
      $message.warning(uiMessage('ui.thisGameHasNoModIoIdentifier'))
      return
    }
    router.push({
      path: `/app/game/modio/mod/list/${encodeURIComponent(String(modioGameId))}`,
      query: {
        gameKey: publicGameKey(item),
        name: String(item?.chineseTitle || item?.englishTitle || modioGameId).trim(),
        englishTitle: String(item?.englishTitle || '').trim(),
        nameId: firstSafeText(item?.modioNameId, item?.sourceSlug, item?.source_game_slug),
        cover: String(item?.coverImage || '').trim(),
        desc: String(item?.description || '').trim(),
        mods: String(item?.modCount || 0),
        profileUrl: String(item?.profileUrl || '').trim()
      }
    })
  } else if (sourcePlatform === SOURCE_PLATFORM.VAMHUB) {
    const vamHubGameId = firstSafeText(
      item?.sourceGameId,
      item?.source_game_id,
      item?.sourceSlug,
      item?.source_game_slug,
      'vam'
    )
    const vamHubSourceSlug = firstSafeText(
      item?.sourceSlug,
      item?.source_slug,
      item?.sourceGameSlug,
      item?.source_game_slug,
      item?.sourceGameDomain,
      item?.source_game_domain,
      vamHubGameId,
      'vam'
    )
    const vamHubAppId = firstPositiveNumber(
      item?.appId,
      item?.app_id,
      item?.appid,
      item?.steamAppId,
      item?.steam_app_id
    )
    const vamHubBackendGameId = firstPositiveNumber(
      item?.gameId,
      item?.game_id,
      item?.backendGameId,
      item?.backend_game_id,
      item?.id
    )
    router.push({
      path: `/app/game/vamhub/mod/list/${encodeURIComponent(vamHubGameId)}`,
      query: {
        gameKey: publicGameKey(item),
        name: String(item?.chineseTitle || item?.englishTitle || 'Virt a Mate').trim(),
        englishName: String(item?.englishTitle || 'Virt a Mate').trim(),
        cover: String(item?.coverImage || '').trim(),
        desc: String(item?.description || '').trim(),
        mods: String(item?.modCount || 0),
        sourcePlatform: 'vamhub',
        sourceGameId: String(vamHubGameId || 'vam'),
        sourceSlug: String(vamHubSourceSlug || 'vam'),
        sourceGameSlug: String(vamHubSourceSlug || 'vam'),
        sourceGameDomain: String(vamHubSourceSlug || 'vam'),
        appId: vamHubAppId ? String(vamHubAppId) : '',
        gameId: vamHubBackendGameId ? String(vamHubBackendGameId) : '',
        backendGameId: vamHubBackendGameId ? String(vamHubBackendGameId) : '',
        clientRootPath: String(item?.clientRootPath || item?.client_root_path || '').trim(),
        clientExePath: String(item?.clientExePath || item?.client_exe_path || '').trim()
      }
    })
  } else {
    $message.warning(uiMessage('ui.thisSourceDoesNotSupportOnlinePreview'))
  }
}

function getImgUrl(item) {
  const { nexusGameId = '' } = item
  if (!nexusGameId) return ''
  return `https://images.nexusmods.com/images/games/v2/${nexusGameId}/tile.jpg`
}

function hasInstallRuleSupport(item) {
  return Number(item?.isHasRule ?? item?.is_has_rule ?? 0) === 1
}

function toSafeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function formatStatNumber(value) {
  const number = Math.max(toSafeNumber(value), 0)
  if (number >= 10000) return uiText('ui.value10000Variant2', { value1: ((number / 10000).toFixed(1).replace(/\.0$/, '')) })
  return number.toLocaleString('zh-CN')
}

function resolveGameTitle(item) {
  return gamePresentation(item).title || '—'
}

function resolveGameSubtitle(item) {
  return gamePresentation(item).subtitle
}

function resolveGameTitleTip(item) {
  const title = resolveGameTitle(item)
  const subtitle = resolveGameSubtitle(item)
  return subtitle ? `${title} / ${subtitle}` : title
}

function resolveModCountTitle(item) {
  return uiText('ui.valueMods', { value1: (toSafeNumber(item?.modCount).toLocaleString('zh-CN')) })
}

function shouldShowModCount(item) {
  return toSafeNumber(item?.modCount) > 0
}
</script>

<template>
  <div class="game-showcase">
    <ul v-if="pageData.records.length" class="game-grid" :class="`is-${layout}`" :style="gridStyle">
      <li
        v-for="game in pageData.records"
        :key="game.aggregateKey || game.id"
        class="game-grid__cell"
      >
        <button
          type="button"
          class="game-card"
          :title="resolveGameTitleTip(game)"
          :aria-label="$t('ui.openModsForValue', { value1: (resolveGameTitleTip(game)) })"
          @click="goToDetails(game)"
        >
          <GameCover
            class="game-card__cover"
            :src="game.coverImage || getImgUrl(game)"
            :alt="resolveGameTitleTip(game)"
            :fallback-text="resolveGameTitle(game)"
            fallback-mode="initials"
            fit="auto"
          />

          <!-- 顶部角标：左侧来源（仅聚合），右侧安装规则 -->
          <span v-if="showSource || hasInstallRuleSupport(game)" class="game-card__chips">
            <span
              v-if="showSource"
              :class="`game-card__chip game-card__source source-${resolveSourceBadgeClass(game)}`"
            >
              {{ resolveSourceBadgeText(game) }}
            </span>
            <span v-if="hasInstallRuleSupport(game)" class="game-card__chip game-card__rule">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              {{ $t('ui.installationRulesAvailable') }}
            </span>
          </span>

          <!-- 底部叠字：遮罩保证任何封面上都可读 -->
          <span class="game-card__scrim" aria-hidden="true"></span>
          <span class="game-card__info">
            <span class="game-card__title">{{ resolveGameTitle(game) }}</span>
            <span class="game-card__meta">
              <span v-if="resolveGameSubtitle(game)" class="game-card__subtitle">
                {{ resolveGameSubtitle(game) }}
              </span>
              <span
                v-if="shouldShowModCount(game)"
                class="game-card__mods"
                :title="resolveModCountTitle(game)"
              >
                <strong>{{ formatStatNumber(game.modCount) }}</strong> {{ $t('ui.mods') }}
              </span>
            </span>
          </span>
        </button>
      </li>
    </ul>

    <div v-else class="game-empty">
      <span class="game-empty__icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
          <path d="m20 20-4-4M8.5 8.5l5 5M13.5 8.5l-5 5" />
        </svg>
      </span>
      <strong>{{ $t('ui.noGamesFound') }}</strong>
      <p>{{ $t('ui.noGamesMatchTheCurrentSourceAndFiltersTryAnother') }}</p>
      <VxButton variant="secondary" size="sm" @click="emit('refresh')">{{ $t('ui.resetAndRefresh') }}</VxButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--game-card-min-column, 260px), 1fr));
  // 间距与 game-card-layout.js 的 GAME_CARD_GAP 一致。
  gap: var(--space-4);
  margin: 0;
  padding: 0 0 var(--space-4);
  list-style: none;
}

.game-grid__cell {
  min-width: 0;
}

// ---------- 卡片：整张卡就是封面，信息叠在封面上 ----------
.game-card {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  color: var(--color-cover-text);
  font: inherit;
  text-align: left;
  background: var(--color-surface-strong);
  border: 0;
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;

  .is-portrait & {
    aspect-ratio: 3 / 4;
  }

  .is-landscape & {
    aspect-ratio: 16 / 9;
  }

  // 描边画在卡片内侧，避免被滚动容器边缘裁掉。
  &::after {
    position: absolute;
    z-index: 3;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--color-shadow);
    content: '';
    pointer-events: none;
    transition: box-shadow var(--duration-fast) var(--ease-standard);
  }

  // 悬停只加描边，不放大、不位移。
  &:hover::after {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  &:focus-visible::after {
    box-shadow:
      inset 0 0 0 2px var(--color-accent),
      inset 0 0 0 4px var(--color-accent-soft);
  }
}

// 提高优先级，覆盖封面组件自身的 position: relative。
.game-card .game-card__cover {
  position: absolute;
  inset: 0;
}

.game-card__chips {
  position: absolute;
  z-index: 2;
  top: var(--space-2);
  right: var(--space-2);
  left: var(--space-2);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.game-card__chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  height: 22px;
  padding: 0 7px;
  overflow: hidden;
  color: var(--color-cover-text);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--color-cover-chip-bg);
  border-radius: var(--radius-sm);
}

.game-card__source {
  flex: 0 1 auto;
  min-width: 0;
}

.game-card__rule {
  margin-left: auto;

  svg {
    flex: none;
    width: 11px;
    height: 11px;
    color: var(--color-cover-success);
    stroke-width: 3;
  }
}

.game-card__scrim {
  position: absolute;
  z-index: 1;
  right: 0;
  bottom: 0;
  left: 0;
  height: 56%;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--color-cover-scrim-mid) 45%,
    var(--color-cover-scrim) 100%
  );
  pointer-events: none;

  .is-landscape & {
    height: 64%;
  }
}

.game-card__info {
  position: absolute;
  z-index: 2;
  right: var(--space-3);
  bottom: 11px;
  left: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  .is-landscape & {
    right: 14px;
    left: 14px;
  }
}

.game-card__title {
  overflow: hidden;
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;

  .is-landscape & {
    font-size: var(--font-size-lg);
  }
}

.game-card__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-cover-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}

.game-card__subtitle {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.game-card__mods {
  flex: none;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  strong {
    color: var(--color-cover-text);
    font-weight: var(--font-weight-semibold);
  }
}

@media (prefers-reduced-motion: reduce) {
  .game-card::after {
    transition: none;
  }
}

// ---------- 空状态 ----------
.game-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 360px;
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
    max-width: 360px;
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
  }
}

.game-empty__icon {
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
</style>
