<script setup>
const { t: uiText } = useI18n()

import { uiMessage } from '../../i18n/message.js'

import { groupGameLibrary, sourceLibraryMeta, sourceLibraryRoute } from '../../../../shared/games/game-library.js'
import { normalizeSourcePlatform, getSourcePlatformDefinition, SOURCE_PLATFORM_DEFINITIONS, resolveSourcePlatformLabel } from '../../../../shared/sources/source-platform-registry.js'
import { getRetiredSourceFailure } from '../../../../shared/sources/retired-source-policy.js'
import { computed, onMounted, onUnmounted, onActivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import router from '@renderer/router/index.js'
import PageBody from '@renderer/component/page-body.vue'
import { useGameStore } from '@renderer/store/gameStore.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import appletSvg from '@renderer/assets/icons/applet.svg'
import moduleSvg from '@renderer/assets/icons/module.svg'
import downloadSvg from '@renderer/assets/icons/download.svg'
import deviceSvg from '@renderer/assets/icons/device.svg'
import gameSvg from '@renderer/assets/icons/game.svg'
import gameToolsSvg from '@renderer/assets/icons/game-tools.svg'
import { $message } from '@renderer/common/message.js'
import storage from '@renderer/common/storage.js'
import { GET_HOME_ADS } from '@renderer/api/modules/index.js'
import { GET_GAME_DETAILS, GET_GAME_DETAILS_BY_LIST } from '@renderer/api/modules/game.js'
import defaultAvatar from '@renderer/assets/image/user/noAvatar.png'
import HomeHeader from './component/home-header.vue'
import HomeAds from './component/home-ads.vue'
import HomeModules from './component/home-modules.vue'
import HomeQuickLaunch from './component/home-quick-launch.vue'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { increaseQuickLaunchWeight } from '@renderer/utils/quick-launch-weight.js'
import { startQuickLaunchGame } from '@renderer/utils/quick-launch-game-action.js'
import { getR2modmanCommunityMetaBySteamAppId } from '@renderer/utils/community-api.js'
import { resolveGameNameDictBatch } from '@renderer/utils/game-name-dict.js'
import { resolveSelectedSourceProfileName } from '@renderer/utils/source-profile-registry.js'
const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()

const { t, locale } = useI18n()
const module_list = computed(() => [
  {
    svgName: 'gameSvg',
    name: t('nav.mods'),
    description: t('home.modsHint'),
    path: '/app/game',
    accent: 'game'
  },
  {
    svgName: 'gameToolsSvg',
    name: t('nav.gameTools'),
    description: t('home.toolsHint'),
    path: '/app/game-tools?tool=fling-trainer',
    accent: 'device'
  },
  {
    svgName: 'appletSvg',
    name: t('nav.system'),
    description: t('home.systemHint'),
    path: '/app/system',
    accent: 'system'
  }
])

const gameStore = useGameStore()

const iconMap = {
  appletSvg,
  moduleSvg,
  downloadSvg,
  deviceSvg,
  gameSvg,
  gameToolsSvg
}

const currentTime = ref('')
const currentDateTime = ref(new Date())
const currentDate = computed(() => new Intl.DateTimeFormat(locale.value, {
  month: 'long', day: 'numeric', weekday: 'long'
}).format(currentDateTime.value))
const homeGameList = ref([])
const homeAds = ref([])
const quickLaunchGames = ref([])
const quickLaunchLoading = ref(true)
// 轮播最后一页显示的游戏：默认最常启动，用户在快捷启动里点选后切换
const featuredGame = ref(null)
const featuredIsTop = ref(true)
const heroFocusToken = ref(0)
const thunderstoreMetaByAppId = ref({})
const nexusBindingByAppId = ref({})
const nexusSteamAppIdByGameId = ref({})
const hasActivatedOnce = ref(false)
const HOME_ADS_CACHE_KEY = 'home_ads_cache'
const HOME_ADS_CACHE_TTL = 1000 * 60 * 60 * 24
const HOME_QUICK_LAUNCH_CACHE_KEY = 'home_quick_launch_cache'
const HOME_QUICK_LAUNCH_CACHE_TTL = 1000 * 60 * 60 * 24
const HOME_QUICK_LAUNCH_CACHE_VERSION = 10

const SOURCE_TYPE = Object.freeze({
  VERTEX: 'vertex',
  THUNDERSTORE: 'thunderstore',
  FICSIT: 'ficsit',
  NEXUS: 'nexus',
  MODIO: 'modio'
})
const FICSIT_STEAM_APP_ID = 526870
const SOURCE_LABEL_MAP = Object.freeze({ get all() { return uiText('tools.all') }, ...Object.fromEntries(Object.keys(SOURCE_PLATFORM_DEFINITIONS).map(source => [source, resolveSourcePlatformLabel(source)])) })

const updateTime = () => {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  currentTime.value = `${hours}:${minutes}`

  currentDateTime.value = now
}

let timeInterval

function useModule(data) {
  if (data.isNotEnabled) {
    $message.warning(t('home.comingSoon'))
    return
  }
  router.push(data.path)
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainStringList(input) {
  if (!Array.isArray(input)) {
    return []
  }
  return input.map((item) => String(item || '').trim()).filter(Boolean)
}

function normalizeSourceType(value = '') {
  const source = normalizeSourcePlatform(value)
  return getSourcePlatformDefinition(source) ? source : ''
}

function getQuickLaunchSourceHint(game = {}, sourceType = '') {
  const normalizedSource = normalizeSourceType(sourceType)
  const sourceHints =
    game?.sourceHints && typeof game.sourceHints === 'object' ? game.sourceHints : {}
  const hint = sourceHints[normalizedSource]
  return hint && typeof hint === 'object' ? hint : null
}

function buildManagedGameKey(game = {}, sourceType = normalizeSourceType(game?.source)) {
  const normalizedSource = normalizeSourceType(sourceType)
  const appId = String(game?.app_id || '').trim()
  const sourceHint = getQuickLaunchSourceHint(game, normalizedSource)
  const sourceMeta = game?.sourceMeta?.[normalizedSource] || {}
  // 来源记录的 ID 只属于自身平台，不能拿另一平台的同名字段充当管理标识。
  const sourceRecord = normalizeSourceType(game?.source) === normalizedSource ? game : {}

  if (normalizedSource === SOURCE_TYPE.THUNDERSTORE) {
    const community = String(
      sourceHint?.community || sourceHint?.sourceSlug || getThunderstoreCommunity(game) || ''
    )
      .trim()
      .toLowerCase()
    return [normalizedSource, community || appId, community].join(':')
  }

  if (normalizedSource === SOURCE_TYPE.NEXUS) {
    const nexusGameId = String(
      sourceHint?.nexusGameId || sourceHint?.sourceId || sourceMeta.nexusGameId ||
      sourceMeta.sourceId || sourceRecord.source_id || sourceRecord.nexusGameId || ''
    ).trim()
    const domainName = String(
      sourceHint?.domainName || sourceHint?.sourceSlug || sourceMeta.domainName ||
      sourceMeta.sourceSlug || sourceRecord.source_slug || sourceRecord.domainName || ''
    )
      .trim()
      .toLowerCase()
    return [normalizedSource, nexusGameId || domainName || appId, domainName].join(':')
  }

  if (normalizedSource === SOURCE_TYPE.FICSIT) {
    const gameId = String(
      sourceHint?.gameId || getGameSteamAppId(game) || FICSIT_STEAM_APP_ID
    ).trim()
    return [normalizedSource, gameId || appId, ''].join(':')
  }

  if (normalizedSource === SOURCE_TYPE.MODIO) {
    const modioGameId = String(
      sourceHint?.modioGameId || sourceHint?.sourceId || sourceMeta.modioGameId ||
      sourceMeta.sourceId || sourceRecord.source_id || sourceRecord.modioGameId || appId
    ).trim()
    const nameId = String(
      sourceHint?.nameId || sourceHint?.sourceSlug || sourceMeta.nameId ||
      sourceMeta.sourceSlug || sourceRecord.source_slug || ''
    )
      .trim()
      .toLowerCase()
    return [normalizedSource, modioGameId || nameId || appId, nameId].join(':')
  }

  const vertexGameId = String(sourceHint?.gameId || getVertexDetailId(game) || appId).trim()
  return [normalizedSource, vertexGameId || appId, ''].join(':')
}

function getThunderstoreCommunity(game = {}) {
  return String(game?.source_slug || game?.source_id || '')
    .trim()
    .toLowerCase()
}

function resolveGameDisplayCover(game = {}, fallbackCover = '') {
  return String(
    game?.displayCover ||
      game?.coverImage ||
      game?.cover_image ||
      game?.backgroundImage ||
      game?.background_image ||
      fallbackCover ||
      ''
  ).trim()
}

function getGameSteamAppId(game = {}) {
  return toSafeNumber(game?.steamAppId || game?.app_id || game?.appId || game?.steam_app_id, 0)
}

function getGameDetailId(game = {}) {
  return toSafeNumber(game?.game_id || game?.id, 0)
}

function isSteamFallbackName(value = '', steamAppId = 0) {
  const text = String(value || '').trim()
  if (!text || steamAppId <= 0) return false
  return text.toLowerCase() === `steam ${steamAppId}`.toLowerCase()
}

function normalizeQuickLaunchName(value = '', steamAppId = 0) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (isSteamFallbackName(text, steamAppId)) {
    return ''
  }
  return text
}

function resolveGameNameDictSourcePlatform(sourceType = '', steamAppId = 0) {
  const normalizedSource = normalizeSourceType(sourceType)
  if (normalizedSource === SOURCE_TYPE.NEXUS) return 'nexus'
  if (normalizedSource === SOURCE_TYPE.MODIO) return 'modio'
  if (normalizedSource === SOURCE_TYPE.THUNDERSTORE) return 'thunderstore'
  if (normalizedSource === SOURCE_TYPE.FICSIT) return 'ficsit'
  if (steamAppId > 0) return 'steam'
  return 'global'
}

function buildQuickLaunchNameDictItem(game = {}, sourceType = '', steamAppId = 0) {
  const normalizedSource = normalizeSourceType(sourceType)
  const sourceHint = getQuickLaunchSourceHint(game, normalizedSource)
  const rawName = normalizeQuickLaunchName(
    game?.englishTitle ||
      sourceHint?.englishName ||
      sourceHint?.gameName ||
      sourceHint?.displayName ||
      game?.name ||
      game?.displayName ||
      game?.chineseTitle,
    steamAppId
  )
  const fallbackName = normalizeQuickLaunchName(
    game?.displayName || game?.chineseTitle || rawName || game?.name,
    steamAppId
  )

  return {
    sourcePlatform: resolveGameNameDictSourcePlatform(normalizedSource, steamAppId),
    rawName: rawName || fallbackName,
    fallbackName
  }
}

async function resolveQuickLaunchDictNameMap(games = [], gameDetailMap = new Map()) {
  const list = Array.isArray(games) ? games : []
  if (!list.length) return new Map()

  const dictItems = list.map((game) => {
    const detail = gameDetailMap.get(Number(game?.app_id)) || {}
    const sourceGame = { ...game, ...detail }
    const steamAppId = getGameSteamAppId(sourceGame)
    const sourceType = normalizeSourceType(
      sourceGame?.currentSource || sourceGame?.source || sourceGame?.sourceType
    )
    return buildQuickLaunchNameDictItem(sourceGame, sourceType, steamAppId)
  })

  try {
    const resolvedList = await resolveGameNameDictBatch(dictItems)
    return new Map(
      resolvedList.map((item, index) => {
        const sourceGame = list[index] || {}
        const steamAppId = getGameSteamAppId(sourceGame)
        const displayName = normalizeQuickLaunchName(item?.displayName, steamAppId)
        return [
          sourceGame,
          {
            displayName,
            chineseName: normalizeQuickLaunchName(item?.chineseName, steamAppId),
            rawName: normalizeQuickLaunchName(item?.rawName || dictItems[index]?.rawName, steamAppId),
            matched: Boolean(item?.matched)
          }
        ]
      })
    )
  } catch (error) {
    console.warn('[Home Quick Launch] 游戏中文名字典解析失败', error)
    return new Map()
  }
}

function resolveQuickLaunchDisplayName(
  detail = {},
  localGame = {},
  nexusBinding = null,
  steamAppId = 0
) {
  const fallbackName = steamAppId > 0 ? `Steam ${steamAppId}` : '未知游戏'
  const candidates = [
    normalizeQuickLaunchName(detail?.chineseTitle, steamAppId),
    normalizeQuickLaunchName(detail?.englishTitle, steamAppId),
    normalizeQuickLaunchName(nexusBinding?.gameName, steamAppId),
    normalizeQuickLaunchName(localGame?.chineseTitle || localGame?.name, steamAppId),
    normalizeQuickLaunchName(localGame?.englishTitle, steamAppId)
  ]
  return candidates.find((item) => !!item) || fallbackName
}

function getVertexDetailId(game = {}) {
  const fromDetail = toSafeNumber(game?.vertexGameId, 0)
  if (fromDetail > 0) {
    return fromDetail
  }

  const fallbackGameId = toSafeNumber(game?.game_id, 0)
  const steamAppId = getGameSteamAppId(game)
  if (steamAppId === FICSIT_STEAM_APP_ID && fallbackGameId === steamAppId) {
    return 0
  }
  return fallbackGameId
}

function buildFicsitRouteQuery(game = {}, gameId = '') {
  const modCount = toSafeNumber(game?.modCount || game?.clientModCount, 0)
  return {
    name: String(
      game?.displayName || game?.chineseTitle || game?.englishTitle || '幸福工厂'
    ).trim(),
    englishName: String(game?.englishTitle || 'Satisfactory').trim(),
    cover: String(game?.displayCover || game?.coverImage || '').trim(),
    desc: String(game?.description || '').trim(),
    mods: String(modCount),
    steamAppId: String(getGameSteamAppId(game) || FICSIT_STEAM_APP_ID),
    gameId: String(gameId || '')
  }
}

function resolveManageGameId(game = {}, sourceType = '', sourceMeta = {}) {
  if (sourceType === SOURCE_TYPE.VERTEX) {
    return toSafeNumber(sourceMeta?.gameId, getVertexDetailId(game))
  }
  if (sourceType === SOURCE_TYPE.FICSIT) {
    return toSafeNumber(sourceMeta?.gameId, getGameSteamAppId(game))
  }
  if (sourceType === SOURCE_TYPE.NEXUS) {
    return toSafeNumber(sourceMeta?.backendGameId, getGameDetailId(game))
  }
  if (sourceType === SOURCE_TYPE.MODIO) {
    return toSafeNumber(sourceMeta?.backendGameId, getGameDetailId(game))
  }
  return toSafeNumber(sourceMeta?.gameId, getGameDetailId(game))
}

function resolveManageSourceId(game = {}, sourceType = '', sourceMeta = {}, steamAppId = 0) {
  if (['modio', 'vamhub', 'gamebanana', 'steam-workshop'].includes(sourceType)) return String(sourceMeta.sourceId || sourceMeta.modioGameId || game.source_id || '')
  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    return String(sourceMeta?.community || getThunderstoreCommunity(game) || '')
      .trim()
      .toLowerCase()
  }
  if (sourceType === SOURCE_TYPE.FICSIT) {
    return String(sourceMeta?.gameId || getGameSteamAppId(game) || FICSIT_STEAM_APP_ID).trim()
  }
  if (sourceType === SOURCE_TYPE.NEXUS) {
    return (
      String(sourceMeta?.nexusGameId || '').trim() ||
      String(sourceMeta?.domainName || '')
        .trim()
        .toLowerCase()
    )
  }
  if (sourceType === SOURCE_TYPE.MODIO) {
    return String(sourceMeta?.modioGameId || getGameDetailId(game) || '').trim()
  }
  return String(steamAppId || getGameSteamAppId(game) || '').trim()
}

function buildModManagementQuery(
  game = {},
  sourceType = '',
  sourceMeta = {},
  steamAppId = 0,
  sourceProfile = 'default'
) {
  const gameId = resolveManageGameId(game, sourceType, sourceMeta)
  const sourceId = resolveManageSourceId(game, sourceType, sourceMeta, steamAppId)
  const query = {
    source: sourceType,
    legacyGameRowId: sourceType === SOURCE_TYPE.VERTEX ? String(game.source_row_id || game.id || '') : '',
    sourceId: String(sourceId || '').trim(),
    gameId: String(gameId || ''),
    community:
      sourceType === SOURCE_TYPE.THUNDERSTORE ? String(sourceMeta?.community || '').trim() : '',
    profile: sourceProfile,
    name: String(game.name || game.displayName || game.chineseTitle || ''),
    rootPath: String(game.client_root_path || ''),
    sourceSlug: String(game.source_slug || ''),
    domainName: sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.domainName || '').trim() : '',
    nexusGameId:
      sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.nexusGameId || '').trim() : '',
    backendGameId:
      sourceType === SOURCE_TYPE.NEXUS
        ? String(sourceMeta?.backendGameId || gameId || '').trim()
        : '',
    modioGameId:
      sourceType === SOURCE_TYPE.MODIO ? String(sourceMeta?.modioGameId || sourceId || '').trim() : '',
    nameId: sourceType === SOURCE_TYPE.MODIO ? String(sourceMeta?.nameId || '').trim() : '',
    appId: String(steamAppId || '').trim()
  }
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => String(value || '').trim() !== '')
  )
}

async function ensureThunderstoreMetaByAppIds(appIds = []) {
  const source = Array.isArray(appIds) ? appIds : []
  const uniqueIds = Array.from(
    new Set(source.map((item) => toSafeNumber(item, 0)).filter((item) => item > 0))
  )
  const needFetchIds = uniqueIds.filter(
    (appId) => !Object.prototype.hasOwnProperty.call(thunderstoreMetaByAppId.value, appId)
  )

  if (!needFetchIds.length) {
    return
  }

  const resultMap = {}
  await Promise.all(
    needFetchIds.map(async (appId) => {
      try {
        resultMap[appId] = await getR2modmanCommunityMetaBySteamAppId(appId)
      } catch (error) {
        console.error('[Home Quick Launch] 社区映射加载失败', error)
        resultMap[appId] = null
      }
    })
  )

  thunderstoreMetaByAppId.value = {
    ...thunderstoreMetaByAppId.value,
    ...resultMap
  }
}

async function ensureNexusBindingByAppIds(appIds = []) {
  const source = Array.isArray(appIds) ? appIds : []
  const uniqueIds = Array.from(
    new Set(source.map((item) => toSafeNumber(item, 0)).filter((item) => item > 0))
  )
  const needFetchIds = uniqueIds.filter(
    (appId) => !Object.prototype.hasOwnProperty.call(nexusBindingByAppId.value, appId)
  )

  if (!needFetchIds.length) {
    return
  }

  try {
    const list = await ipcRenderer.invoke('nexusGetGameBindingsByAppIds', {
      appIds: needFetchIds
    })
    const listSource = Array.isArray(list) ? list : []
    const resultMap = {}

    for (const item of listSource) {
      const appId = toSafeNumber(item?.appId, 0)
      if (!appId) continue
      resultMap[appId] = {
        appId,
        nexusGameId: toSafeNumber(item?.nexusGameId, 0),
        backendGameId: toSafeNumber(item?.backendGameId, 0),
        domainName: String(item?.domainName || '').trim(),
        gameName: String(item?.gameName || '').trim(),
        coverImage: String(item?.coverImage || '').trim(),
        ruleVersion: toSafeNumber(item?.ruleVersion, 0)
      }
    }

    for (const appId of needFetchIds) {
      if (!Object.prototype.hasOwnProperty.call(resultMap, appId)) {
        resultMap[appId] = null
      }
    }

    nexusBindingByAppId.value = {
      ...nexusBindingByAppId.value,
      ...resultMap
    }
  } catch (error) {
    console.error('[Home Quick Launch] Nexus 绑定加载失败', error)
  }
}

function getThunderstoreMetaByGame(game = {}) {
  const steamAppId = getGameSteamAppId(game)
  const mappedMeta = steamAppId > 0 ? thunderstoreMetaByAppId.value[steamAppId] || null : null
  if (mappedMeta?.community) {
    return mappedMeta
  }

  const thunderstoreHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.THUNDERSTORE)
  if (thunderstoreHint?.community) {
    return {
      steamAppId,
      community: String(
        thunderstoreHint?.community ||
          thunderstoreHint?.sourceSlug ||
          thunderstoreHint?.sourceId ||
          ''
      )
        .trim()
        .toLowerCase(),
      gameKey: String(thunderstoreHint?.gameKey || thunderstoreHint?.sourceId || '').trim(),
      displayName: String(
        thunderstoreHint?.displayName ||
          game?.displayName ||
          game?.chineseTitle ||
          game?.englishTitle ||
          game?.name ||
          ''
      ).trim(),
      packageLoader: String(thunderstoreHint?.packageLoader || '').trim()
    }
  }

  const explicitSource = normalizeSourceType(
    game?.source || game?.currentSource || game?.sourceType
  )
  if (explicitSource !== SOURCE_TYPE.THUNDERSTORE) {
    return null
  }

  const fallbackCommunity = getThunderstoreCommunity(game)
  if (!fallbackCommunity) {
    return null
  }

  return {
    steamAppId,
    community: fallbackCommunity,
    gameKey: String(game?.source_id || '').trim(),
    displayName: String(
      game?.displayName || game?.chineseTitle || game?.englishTitle || game?.name || ''
    ).trim()
  }
}

function getNexusBindingByGame(game = {}) {
  const steamAppId = getGameSteamAppId(game)
  const mappedBinding = steamAppId > 0 ? nexusBindingByAppId.value[steamAppId] || null : null
  if (mappedBinding?.domainName) {
    return mappedBinding
  }

  const nexusHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.NEXUS)
  if (nexusHint?.domainName) {
    return {
      appId: steamAppId,
      nexusGameId: toSafeNumber(nexusHint?.nexusGameId || nexusHint?.sourceId, 0),
      backendGameId: toSafeNumber(
        nexusHint?.backendGameId || nexusHint?.gameId || game?.backendGameId || game?.game_id,
        0
      ),
      domainName: String(nexusHint?.domainName || nexusHint?.sourceSlug || '')
        .trim()
        .toLowerCase(),
      gameName: String(
        nexusHint?.gameName || game?.displayName || game?.chineseTitle || game?.name || ''
      ).trim(),
      coverImage: String(
        nexusHint?.coverImage || game?.displayCover || game?.coverImage || ''
      ).trim()
    }
  }

  const explicitSource = normalizeSourceType(
    game?.source || game?.currentSource || game?.sourceType
  )
  if (explicitSource !== SOURCE_TYPE.NEXUS) {
    return null
  }

  const fallbackDomainName = String(game?.source_slug || '')
    .trim()
    .toLowerCase()
  if (!fallbackDomainName) {
    return null
  }

  return {
    appId: steamAppId,
    nexusGameId: toSafeNumber(game?.source_id || game?.nexusGameId, 0),
    backendGameId: toSafeNumber(game?.backendGameId || game?.game_id || game?.id, 0),
    domainName: fallbackDomainName,
    gameName: String(game?.displayName || game?.chineseTitle || game?.name || '').trim(),
    coverImage: String(game?.displayCover || game?.coverImage || '').trim()
  }
}

function getModioMetaByGame(game = {}) {
  const steamAppId = getGameSteamAppId(game)
  const modioHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.MODIO)
  const explicitSource = normalizeSourceType(game?.source || game?.currentSource || game?.sourceType)
  if (explicitSource !== SOURCE_TYPE.MODIO && !modioHint) {
    return null
  }

  const modioGameId = toSafeNumber(
    modioHint?.modioGameId || modioHint?.sourceId || game?.source_id || game?.game_id || game?.id,
    0
  )
  const nameId = String(
    modioHint?.nameId || modioHint?.sourceSlug || game?.source_slug || game?.nameId || ''
  )
    .trim()
    .toLowerCase()

  if (!modioGameId && !nameId) {
    return null
  }

  return {
    steamAppId,
    modioGameId,
    backendGameId: toSafeNumber(modioHint?.backendGameId || game?.backendGameId || game?.game_id, 0),
    nameId,
    gameName: String(game?.displayName || game?.chineseTitle || game?.name || nameId || '').trim(),
    coverImage: String(game?.displayCover || game?.coverImage || '').trim()
  }
}

function getQuickLaunchAvailableSources(game = {}) {
  const sourceSet = new Set()
  const explicitSource = normalizeSourceType(
    game?.source || game?.currentSource || game?.sourceType
  )
  const steamAppId = getGameSteamAppId(game)
  const vertexGameId = getVertexDetailId(game)
  const vertexHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.VERTEX)
  const ficsitHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.FICSIT)
  const thunderstoreMeta = getThunderstoreMetaByGame(game)
  const nexusBinding = getNexusBindingByGame(game)
  const modioMeta = getModioMetaByGame(game)

  if (
    explicitSource === SOURCE_TYPE.VERTEX ||
    toSafeNumber(vertexHint?.gameId, 0) > 0 ||
    vertexGameId > 0
  ) {
    sourceSet.add(SOURCE_TYPE.VERTEX)
  }
  if (
    steamAppId === FICSIT_STEAM_APP_ID ||
    explicitSource === SOURCE_TYPE.FICSIT ||
    toSafeNumber(ficsitHint?.gameId, 0) > 0
  ) {
    sourceSet.add(SOURCE_TYPE.FICSIT)
  }
  if (thunderstoreMeta?.community) {
    sourceSet.add(SOURCE_TYPE.THUNDERSTORE)
  }
  if (nexusBinding?.domainName) {
    sourceSet.add(SOURCE_TYPE.NEXUS)
  }
  if (modioMeta?.modioGameId || modioMeta?.nameId) {
    sourceSet.add(SOURCE_TYPE.MODIO)
  }
  if (explicitSource && !sourceSet.has(explicitSource)) {
    sourceSet.add(explicitSource)
  }

  return [...sourceSet]
}

function getQuickLaunchSourceMeta(game = {}, sourceType = SOURCE_TYPE.VERTEX) {
  if (['vamhub', 'gamebanana', 'steam-workshop'].includes(sourceType)) {
    const entry = game.sourceEntries?.find(item => normalizeSourceType(item.source) === sourceType)
      || (normalizeSourceType(game.source) === sourceType ? game : null)
    return entry ? sourceLibraryMeta(entry) : null
  }
  const steamAppId = getGameSteamAppId(game)
  const gameId = getGameDetailId(game)
  const vertexHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.VERTEX)
  const ficsitHint = getQuickLaunchSourceHint(game, SOURCE_TYPE.FICSIT)
  const vertexGameId =
    toSafeNumber(vertexHint?.gameId, 0) || getVertexDetailId(game) || toSafeNumber(game?.game_id, 0)

  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    const thunderstoreMeta = getThunderstoreMetaByGame(game)
    const community = String(thunderstoreMeta?.community || getThunderstoreCommunity(game) || '')
      .trim()
      .toLowerCase()
    if (!community) {
      return null
    }
    return {
      community,
      gameKey: String(thunderstoreMeta?.gameKey || '').trim(),
      packageLoader: String(thunderstoreMeta?.packageLoader || '').trim(),
      exeNames: toPlainStringList(thunderstoreMeta?.exeNames),
      steamFolderName: String(thunderstoreMeta?.steamFolderName || '').trim(),
      displayName: String(
        game?.displayName ||
          thunderstoreMeta?.displayName ||
          game?.chineseTitle ||
          game?.englishTitle ||
          game?.name ||
          ''
      ).trim()
    }
  }

  if (sourceType === SOURCE_TYPE.FICSIT) {
    const ficsitGameId = toSafeNumber(ficsitHint?.gameId, 0) || steamAppId || gameId
    return {
      gameId: ficsitGameId,
      steamAppId: steamAppId || FICSIT_STEAM_APP_ID
    }
  }

  if (sourceType === SOURCE_TYPE.NEXUS) {
    const nexusBinding = getNexusBindingByGame(game)
    const domainName = String(nexusBinding?.domainName || '')
      .trim()
      .toLowerCase()
    if (!domainName) {
      return null
    }
    return {
      domainName,
      gameName: String(
        game?.displayName || game?.chineseTitle || nexusBinding?.gameName || game?.name || ''
      ).trim(),
      coverImage: String(
        nexusBinding?.coverImage || game?.displayCover || game?.coverImage || ''
      ).trim(),
      nexusGameId: String(nexusBinding?.nexusGameId || game?.source_id || '').trim(),
      backendGameId: toSafeNumber(
        nexusBinding?.backendGameId || game?.backendGameId || game?.game_id,
        0
      )
    }
  }

  if (sourceType === SOURCE_TYPE.MODIO) {
    const modioMeta = getModioMetaByGame(game)
    if (!modioMeta) {
      return null
    }
    return {
      modioGameId: modioMeta.modioGameId,
      backendGameId: modioMeta.backendGameId,
      nameId: modioMeta.nameId,
      gameName: modioMeta.gameName,
      coverImage: modioMeta.coverImage
    }
  }

  return {
    gameId: vertexGameId
  }
}

function resolveQuickLaunchSource(game = {}) {
  const availableSources = getQuickLaunchAvailableSources(game)
  const preferredSource = normalizeSourceType(
    game?.currentSource || game?.sourceType || game?.source
  )

  if (preferredSource && availableSources.includes(preferredSource)) {
    return preferredSource
  }

  if (availableSources.includes(SOURCE_TYPE.VERTEX)) {
    return SOURCE_TYPE.VERTEX
  }
  if (availableSources.includes(SOURCE_TYPE.FICSIT)) {
    return SOURCE_TYPE.FICSIT
  }
  if (availableSources.includes(SOURCE_TYPE.THUNDERSTORE)) {
    return SOURCE_TYPE.THUNDERSTORE
  }
  if (availableSources.includes(SOURCE_TYPE.NEXUS)) {
    return SOURCE_TYPE.NEXUS
  }
  if (availableSources.includes(SOURCE_TYPE.MODIO)) {
    return SOURCE_TYPE.MODIO
  }
  if (preferredSource && availableSources.includes(preferredSource)) {
    return preferredSource
  }

  return availableSources[0] || ''
}

function resolveQuickLaunchManageSource(game = {}) {
  const availableSources = getQuickLaunchAvailableSources(game)
  const preferredSource = normalizeSourceType(
    game?.currentSource || game?.sourceType || game?.source
  )
  const managedSource = normalizeSourceType(game?.manageSource)

  if (preferredSource === SOURCE_TYPE.NEXUS && availableSources.includes(SOURCE_TYPE.NEXUS)) {
    return SOURCE_TYPE.NEXUS
  }

  if (managedSource && availableSources.includes(managedSource)) {
    return managedSource
  }
  if (preferredSource && availableSources.includes(preferredSource)) {
    return preferredSource
  }
  if (availableSources.includes(SOURCE_TYPE.VERTEX)) {
    return SOURCE_TYPE.VERTEX
  }
  if (availableSources.includes(SOURCE_TYPE.FICSIT)) {
    return SOURCE_TYPE.FICSIT
  }
  if (availableSources.includes(SOURCE_TYPE.THUNDERSTORE)) {
    return SOURCE_TYPE.THUNDERSTORE
  }
  if (availableSources.includes(SOURCE_TYPE.NEXUS)) {
    return SOURCE_TYPE.NEXUS
  }
  if (availableSources.includes(SOURCE_TYPE.MODIO)) {
    return SOURCE_TYPE.MODIO
  }

  return availableSources[0] || ''
}

function mapQuickLaunchGameWithSource(game = {}) {
  const availableSources = getQuickLaunchAvailableSources(game)
  const currentSource = resolveQuickLaunchSource(game)
  const manageSource = resolveQuickLaunchManageSource(game)

  return {
    ...game,
    manageKey: buildManagedGameKey(game, manageSource || currentSource),
    sourceLabel: SOURCE_LABEL_MAP[currentSource] || currentSource || '--',
    availableSources,
    sourceMeta: {
      ...Object.fromEntries(['vamhub', 'gamebanana', 'steam-workshop'].map(source => [source, getQuickLaunchSourceMeta(game, source)])),
      [SOURCE_TYPE.VERTEX]: getQuickLaunchSourceMeta(game, SOURCE_TYPE.VERTEX),
      [SOURCE_TYPE.THUNDERSTORE]: getQuickLaunchSourceMeta(game, SOURCE_TYPE.THUNDERSTORE),
      [SOURCE_TYPE.FICSIT]: getQuickLaunchSourceMeta(game, SOURCE_TYPE.FICSIT),
      [SOURCE_TYPE.NEXUS]: getQuickLaunchSourceMeta(game, SOURCE_TYPE.NEXUS),
      [SOURCE_TYPE.MODIO]: getQuickLaunchSourceMeta(game, SOURCE_TYPE.MODIO)
    },
    currentSource,
    manageSource
  }
}

async function ensureQuickLaunchGameSource(game = {}) {
  const steamAppId = getGameSteamAppId(game)
  if (steamAppId > 0) {
    await Promise.all([
      ensureThunderstoreMetaByAppIds([steamAppId]),
      ensureNexusBindingByAppIds([steamAppId])
    ])
  }
  return mapQuickLaunchGameWithSource(game)
}

async function ensureNexusSteamAppId(game = {}) {
  const existingAppId = getGameSteamAppId(game)
  if (existingAppId > 0) {
    return existingAppId
  }

  const sourceType = normalizeSourceType(game?.source || game?.currentSource || game?.sourceType)
  const backendGameId = toSafeNumber(game?.game_id || game?.sourceMeta?.nexus?.backendGameId, 0)
  if (sourceType !== SOURCE_TYPE.NEXUS || backendGameId <= 0) {
    return 0
  }

  const cachedAppId = toSafeNumber(nexusSteamAppIdByGameId.value[backendGameId], 0)
  if (cachedAppId > 0) {
    game.steamAppId = cachedAppId
    game.app_id = String(cachedAppId)
    return cachedAppId
  }

  try {
    const detail = (await GET_GAME_DETAILS(backendGameId)) || {}
    const resolvedAppId = toSafeNumber(
      detail?.steamAppId || detail?.app_id || detail?.appId || detail?.steam_app_id,
      0
    )
    if (resolvedAppId > 0) {
      nexusSteamAppIdByGameId.value = {
        ...nexusSteamAppIdByGameId.value,
        [backendGameId]: resolvedAppId
      }
      game.steamAppId = resolvedAppId
      game.app_id = String(resolvedAppId)
      return resolvedAppId
    }
  } catch (error) {
    console.warn('[Home Quick Launch] 读取 Nexus 游戏 AppId 失败', error)
  }

  return 0
}

function createQuickLaunchSignature(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const appId = String(item?.app_id || '')
      const source = String(item?.source || '')
      const sourceId = String(item?.source_id || '')
      const sourceSlug = String(item?.source_slug || '')
      const executablePath = item?.client_exe_path || ''
      const clientModCount = Number(item?.clientModCount || 0)
      const serverModCount = Number(item?.serverModCount || 0)
      const coverImage = resolveGameDisplayCover(item)
      return `${source}:${sourceId}:${sourceSlug}:${appId}:${executablePath}:${clientModCount}:${serverModCount}:${coverImage}`
    })
    .sort()
    .join('|')
}

function getCachedQuickLaunchPayload() {
  const cached = storage.local.get(HOME_QUICK_LAUNCH_CACHE_KEY)
  if (!cached || typeof cached !== 'object') {
    return {
      data: [],
      signature: '',
      detailReady: false
    }
  }

  const expireAt = Number(cached.expireAt)
  if (!Number.isFinite(expireAt) || expireAt <= Date.now()) {
    storage.local.remove(HOME_QUICK_LAUNCH_CACHE_KEY)
    return {
      data: [],
      signature: '',
      detailReady: false
    }
  }

  const version = Number(cached.version || 0)
  if (version !== HOME_QUICK_LAUNCH_CACHE_VERSION) {
    storage.local.remove(HOME_QUICK_LAUNCH_CACHE_KEY)
    return {
      data: [],
      signature: '',
      detailReady: false
    }
  }

  return {
    data: Array.isArray(cached.data) ? cached.data : [],
    signature: typeof cached.signature === 'string' ? cached.signature : '',
    detailReady: Boolean(cached.detailReady)
  }
}

function setCachedQuickLaunchPayload(data, signature = '', detailReady = false) {
  storage.local.set(HOME_QUICK_LAUNCH_CACHE_KEY, {
    version: HOME_QUICK_LAUNCH_CACHE_VERSION,
    expireAt: Date.now() + HOME_QUICK_LAUNCH_CACHE_TTL,
    signature: typeof signature === 'string' ? signature : '',
    detailReady: Boolean(detailReady),
    data: Array.isArray(data) ? data : []
  })
}

function loadQuickLaunchGamesFromCache() {
  const { data } = getCachedQuickLaunchPayload()
  if (data.length) {
    quickLaunchGames.value = data
  }
}

async function buildQuickLaunchGames(list = []) {
  quickLaunchLoading.value = true
  try {
    const launchableSourceList = list.filter(
      (item) => item.isGameLocalPathExist && (item.client_exe_path || (item.discovered && item.app_id))
    )
    const launchableList = launchableSourceList
    const launchableSignature = createQuickLaunchSignature(launchableList)

    if (!launchableList.length) {
      quickLaunchGames.value = []
      setCachedQuickLaunchPayload([], '', true)
      return
    }

    const cachedQuickLaunch = getCachedQuickLaunchPayload()
    const hasPlaceholderNameInCache = Array.isArray(cachedQuickLaunch.data)
      ? cachedQuickLaunch.data.some((item) => {
          const steamAppId = toSafeNumber(item?.steamAppId || item?.app_id, 0)
          const displayName = String(
            item?.displayName || item?.chineseTitle || item?.englishTitle || ''
          )
          return isSteamFallbackName(displayName, steamAppId)
        })
      : false
    if (
      cachedQuickLaunch.signature === launchableSignature &&
      Array.isArray(cachedQuickLaunch.data) &&
      cachedQuickLaunch.data.length
    ) {
      quickLaunchGames.value = cachedQuickLaunch.data
      if (cachedQuickLaunch.detailReady && !hasPlaceholderNameInCache) {
        return
      }
    }

    const gameAppIds = launchableList
      .map((item) => Number(item.app_id))
      .filter((id) => Number.isFinite(id) && id > 0)
    await Promise.all([
      ensureThunderstoreMetaByAppIds(gameAppIds),
      ensureNexusBindingByAppIds(gameAppIds)
    ])

    let gameDetailMap = new Map()
    let isDetailRequestSuccess = gameAppIds.length === 0
    if (gameAppIds.length) {
      try {
        const detailList = await GET_GAME_DETAILS_BY_LIST(gameAppIds, true)
        gameDetailMap = new Map(
          (Array.isArray(detailList) ? detailList : []).map((item) => [
            Number(item.steamAppId),
            item
          ])
        )
        isDetailRequestSuccess = true
      } catch (error) {
        console.error('获取快捷启动游戏详情失败:', error)
      }
    }

    if (!isDetailRequestSuccess && cachedQuickLaunch.signature === launchableSignature) {
      return
    }

    const dictNameMap = await resolveQuickLaunchDictNameMap(launchableList, gameDetailMap)

    const nextQuickLaunchGames = launchableList.map((item) => {
      const detail = gameDetailMap.get(Number(item.app_id)) || {}
      const steamAppId = toSafeNumber(detail?.steamAppId || item?.app_id, 0)
      const nexusBinding = nexusBindingByAppId.value[steamAppId] || null
      const detailChineseTitle = normalizeQuickLaunchName(
        detail?.chineseTitle || item?.name,
        steamAppId
      )
      const detailEnglishTitle = normalizeQuickLaunchName(detail?.englishTitle, steamAppId)
      const bindingGameName = normalizeQuickLaunchName(nexusBinding?.gameName, steamAppId)
      const dictName = dictNameMap.get(item) || {}
      const fallbackDisplayName = resolveQuickLaunchDisplayName(detail, item, nexusBinding, steamAppId)
      const displayName = dictName.displayName || fallbackDisplayName
      const displayCover = resolveGameDisplayCover(
        item,
        detail?.coverImage || nexusBinding?.coverImage || ''
      )
      const detailGameId = toSafeNumber(detail?.id || detail?.game_id, 0)
      const localGameId = toSafeNumber(item?.game_id, 0)
      const safeVertexGameId =
        detailGameId ||
        (steamAppId === FICSIT_STEAM_APP_ID && localGameId === steamAppId ? 0 : localGameId)

      const merged = {
        ...detail,
        ...item,
        steamAppId,
        vertexGameId: safeVertexGameId,
        chineseTitle: dictName.chineseName || detailChineseTitle || displayName,
        englishTitle: detailEnglishTitle || bindingGameName || dictName.rawName || fallbackDisplayName,
        rawDisplayName: fallbackDisplayName,
        coverImage: displayCover,
        displayName,
        displaySubtitle: detailEnglishTitle || bindingGameName || '',
        displaySubtitleKey: detailEnglishTitle || bindingGameName ? '' : 'quickLaunch.locallyInstalled',
        displayCover
      }
      return mapQuickLaunchGameWithSource(merged)
    })
    quickLaunchGames.value = groupGameLibrary(nextQuickLaunchGames)
    setCachedQuickLaunchPayload(quickLaunchGames.value, launchableSignature, isDetailRequestSuccess)
  } finally {
    quickLaunchLoading.value = false
  }
}

function refreshHomeGameList() {
  ipcRenderer.send('getHomeGameListData')
}

function refreshQuickLaunchGames() {
  quickLaunchLoading.value = true
  refreshHomeGameList()
}

function getCachedHomeAds() {
  const cached = storage.local.get(HOME_ADS_CACHE_KEY)
  if (!cached || typeof cached !== 'object') return []

  const expireAt = Number(cached.expireAt)
  if (!Number.isFinite(expireAt) || expireAt <= Date.now()) {
    storage.local.remove(HOME_ADS_CACHE_KEY)
    return []
  }

  return Array.isArray(cached.data) ? cached.data : []
}

function setCachedHomeAds(data) {
  storage.local.set(HOME_ADS_CACHE_KEY, {
    expireAt: Date.now() + HOME_ADS_CACHE_TTL,
    data: Array.isArray(data) ? data : []
  })
}

async function loadHomeAds() {
  const cachedAds = getCachedHomeAds()
  if (cachedAds.length) {
    homeAds.value = cachedAds
  }

  try {
    const res = await GET_HOME_ADS()
    const latestAds = Array.isArray(res) ? res : []
    homeAds.value = latestAds
    setCachedHomeAds(latestAds)
  } catch {
    if (!homeAds.value.length) {
      homeAds.value = cachedAds
    }
  }
}

function startQuickGame(game) {
  startQuickLaunchGame(game, {
    ensureGameSource: ensureQuickLaunchGameSource
  }).catch((error) => {
    console.error('首页快捷启动执行失败', error)
    $message.error(uiMessage('ui.launchFailedValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  })
}

function resolveQuickGameDirectory(game = {}) {
  const rootPath = String(
    game?.client_root_path || game?.installPath || game?.gamePath || ''
  ).trim()
  if (rootPath) {
    return rootPath
  }

  const exePath = String(game?.client_exe_path || '').trim()
  if (!exePath) {
    return ''
  }

  const normalizedPath = exePath.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(
    normalizedPath.lastIndexOf('\\'),
    normalizedPath.lastIndexOf('/')
  )
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : normalizedPath
}

function openQuickGameDirectory(game) {
  openQuickGameDirectoryInternal(game).catch((error) => {
    console.error('首页快捷启动打开游戏目录失败', error)
    $message.error(uiMessage('ui.couldNotOpenFolderValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  })
}

async function openQuickGameDirectoryInternal(game) {
  const resolvedGame = await ensureQuickLaunchGameSource(game)
  const gameDirectory = resolveQuickGameDirectory(resolvedGame)
  if (!gameDirectory) {
    $message.warning(uiMessage('ui.gameFolderNotFound'))
    return
  }
  ipcRenderer.send('openSpecifyPath', gameDirectory)
}

function openModCenter() {
  router.push('/app/game')
}

function handleQuickLaunchSelect({ item = null, isTop = true } = {}) {
  featuredGame.value = item
  featuredIsTop.value = isTop
}

function focusHeroGame() {
  heroFocusToken.value += 1
}

async function openQuickGameModManagement(game) {
  const resolvedGame = await ensureQuickLaunchGameSource(game)
  const sourceType =
    normalizeSourceType(resolvedGame?.manageSource) || resolveQuickLaunchManageSource(resolvedGame)
  if (!sourceType) {
    $message.warning(uiMessage('ui.thisGameHasNoAvailableSourceForModManagement'))
    return
  }

  const steamAppId = await ensureNexusSteamAppId(resolvedGame)
  if (!steamAppId && (sourceType === SOURCE_TYPE.VERTEX || sourceType === SOURCE_TYPE.FICSIT)) {
    $message.warning(uiMessage('ui.noValidGameIdentifierFound'))
    return
  }

  const sourceMeta = resolvedGame?.sourceMeta?.[sourceType] || {}
  const gameId = resolveManageGameId(resolvedGame, sourceType, sourceMeta)
  const sourceId = resolveManageSourceId(resolvedGame, sourceType, sourceMeta, steamAppId)
  if (!sourceId) {
    $message.warning(uiMessage('ui.thisSourceHasNoValidIdentifierForModManagement'))
    return
  }
  const sourceProfile = resolveSelectedSourceProfileName(sourceType, sourceId)

  gameStore.setCurrentManagedGame({
    manageKey: buildManagedGameKey(resolvedGame, sourceType),
    sourceId,
    steamAppId,
    chineseTitle: resolvedGame.displayName || resolvedGame.chineseTitle || '',
    is_server_installed: Number(resolvedGame.is_server_installed || 0),
    server_install_mod_type: Number(resolvedGame.server_install_mod_type || 0),
    gId: gameId,
    sourceType,
    sourceCommunity:
      sourceType === SOURCE_TYPE.THUNDERSTORE ? String(sourceMeta?.community || '') : '',
    sourceProfile,
    sourceGameId: gameId,
    sourceDomainName:
      sourceType === SOURCE_TYPE.NEXUS ? String(sourceMeta?.domainName || '').trim() : '',
    sourceNexusGameId:
      sourceType === SOURCE_TYPE.NEXUS ? toSafeNumber(sourceMeta?.nexusGameId, 0) : 0
  })

  router.push({
    path: `/app/game/modManagement/${encodeURIComponent(String(sourceType))}/${encodeURIComponent(String(sourceId))}`,
    query: buildModManagementQuery(
      resolvedGame,
      sourceType,
      sourceMeta,
      steamAppId,
      sourceProfile
    )
  })
}

async function previewMod(game) {
  const resolvedGame = await ensureQuickLaunchGameSource(game)
  const sourceType = resolveQuickLaunchSource(resolvedGame)
  const retired = getRetiredSourceFailure(sourceType)
  if (retired) {
    $message.warning(retired.message)
    return
  }
  if (!sourceType) {
    $message.warning(uiMessage('ui.thisGameHasNoAvailableSourceForModPreview'))
    return
  }

  const sharedRoute = sourceLibraryRoute(resolvedGame, sourceType)
  if (sharedRoute) { router.push(sharedRoute); return }
  const steamAppId = await ensureNexusSteamAppId(resolvedGame)
  if (!steamAppId && ![SOURCE_TYPE.NEXUS, SOURCE_TYPE.MODIO].includes(sourceType)) {
    $message.warning(uiMessage('ui.noValidGameIdentifierFound'))
    return
  }

  const sourceMeta = resolvedGame?.sourceMeta?.[sourceType] || {}
  if (sourceType === SOURCE_TYPE.THUNDERSTORE) {
    const community = String(sourceMeta?.community || getThunderstoreCommunity(resolvedGame) || '')
      .trim()
      .toLowerCase()
    if (!community) {
      $message.warning(uiMessage('ui.thisGameHasNoThunderstoreCommunityIdentifierForPreview'))
      return
    }
    increaseQuickLaunchWeight(steamAppId)
    router.push(`/app/game/thunderstore/mod/list/${encodeURIComponent(community)}`)
    return
  }

  if (sourceType === SOURCE_TYPE.FICSIT) {
    const gameId = toSafeNumber(sourceMeta?.gameId, getGameSteamAppId(resolvedGame))
    if (!gameId) {
      $message.warning(uiMessage('ui.thisFicsitGameHasNoValidIdentifierForPreview'))
      return
    }
    increaseQuickLaunchWeight(steamAppId)
    router.push({
      path: `/app/game/ficsit/mod/list/${encodeURIComponent(String(gameId))}`,
      query: buildFicsitRouteQuery(resolvedGame, gameId)
    })
    return
  }

  if (sourceType === SOURCE_TYPE.NEXUS) {
    const domainName = String(sourceMeta?.domainName || '')
      .trim()
      .toLowerCase()
    if (!domainName) {
      $message.warning(uiMessage('ui.thisNexusGameHasNoDomainIdentifierForPreview'))
      return
    }
    increaseQuickLaunchWeight(steamAppId)
    router.push({
      path: `/app/game/nexus/mod/list/${encodeURIComponent(domainName)}`,
      query: {
        name: String(sourceMeta?.gameName || resolvedGame.displayName || domainName).trim(),
        englishTitle: String(resolvedGame.englishTitle || '').trim(),
        cover: String(sourceMeta?.coverImage || resolvedGame.displayCover || '').trim(),
        mods: String(resolvedGame?.modCount || resolvedGame?.clientModCount || 0),
        nexusGameId: String(sourceMeta?.nexusGameId || ''),
        backendGameId: String(sourceMeta?.backendGameId || ''),
        appId: String(getGameSteamAppId(resolvedGame) || '')
      }
    })
    return
  }

  if (sourceType === SOURCE_TYPE.MODIO) {
    const modioGameId = toSafeNumber(sourceMeta?.modioGameId || resolvedGame?.game_id, 0)
    if (!modioGameId) {
      $message.warning(uiMessage('ui.thisModIoGameHasNoValidIdentifierForPreview'))
      return
    }
    increaseQuickLaunchWeight(steamAppId || modioGameId)
    router.push({
      path: `/app/game/modio/mod/list/${encodeURIComponent(String(modioGameId))}`,
      query: {
        name: String(sourceMeta?.gameName || resolvedGame.displayName || '').trim(),
        englishTitle: String(resolvedGame.englishTitle || '').trim(),
        nameId: String(sourceMeta?.nameId || '').trim(),
        cover: String(sourceMeta?.coverImage || resolvedGame.displayCover || '').trim(),
        desc: String(resolvedGame?.description || '').trim(),
        mods: String(resolvedGame?.modCount || resolvedGame?.clientModCount || 0),
        gameId: String(sourceMeta?.backendGameId || ''),
        appId: String(getGameSteamAppId(resolvedGame) || '')
      }
    })
    return
  }

  $message.warning(uiMessage('ui.thisSourceDoesNotSupportOnlinePreview'))
}

useIpc('getHomeGameListDataSuccess', (data = []) => {
  homeGameList.value = Array.isArray(data) ? data : []
  buildQuickLaunchGames(homeGameList.value).then()
})

useIpc('homeGameListNeedRefresh', () => {
  refreshQuickLaunchGames()
})

onMounted(() => {
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
  loadQuickLaunchGamesFromCache()
  refreshQuickLaunchGames()
  loadHomeAds()
  setPageMenuName('首页', route.path)
})

onActivated(() => {
  setPageMenuName('首页', route.path)
  if (!hasActivatedOnce.value) {
    hasActivatedOnce.value = true
    return
  }
  refreshQuickLaunchGames()
  loadHomeAds()
})

onUnmounted(() => {
  clearInterval(timeInterval)
})

defineOptions({
  name: 'Home'
})
</script>

<template>
  <div class="home-container">
    <page-body class="main-page-body">
      <div class="content-layout">
        <div class="content-header-row">
          <home-header
            :current-time="currentTime"
            :current-date="currentDate"
            :default-avatar="defaultAvatar"
          />
        </div>

        <div class="content-hero-row">
          <HomeAds
            :ad-list="homeAds"
            :featured-game="featuredGame"
            :featured-is-top="featuredIsTop"
            :games-loading="quickLaunchLoading"
            :focus-token="heroFocusToken"
            @start-game="startQuickGame"
            @manage-mod="openQuickGameModManagement"
            @preview-mod="previewMod"
            @open-game-dir="openQuickGameDirectory"
            @refresh-games="refreshQuickLaunchGames"
            @open-mod-center="openModCenter"
          />
          <home-modules :module-list="module_list" :icon-map="iconMap" @use-module="useModule" />
        </div>

        <home-quick-launch
          :quick-launch-games="quickLaunchGames"
          :loading="quickLaunchLoading"
          @start-game="startQuickGame"
          @manage-mod="openQuickGameModManagement"
          @preview-mod="previewMod"
          @open-game-dir="openQuickGameDirectory"
          @select="handleQuickLaunchSelect"
          @focus-game="focusHeroGame"
        />
      </div>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.home-container {
  width: 100%;
  height: 100%;
  --home-bg: transparent;
  --home-surface: #ffffff;
  --home-primary: #0a96ff;
  --home-primary-hover: #087cd6;
  --home-text-main: #1a2233;
  --home-text-sub: #5c6b7f;
  --home-text-muted: #8b99ab;
  --home-border: rgba(0, 0, 0, 0.05);
  --home-border-hover: rgba(10, 150, 255, 0.3);
  --home-radius-lg: 16px;
  --home-radius-md: 12px;
  --home-radius-sm: 8px;
  --home-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.03);
  --home-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.06);
  --home-shadow-hover: 0 8px 24px rgba(10, 150, 255, 0.12);
  --home-ad-ratio: 1635 / 408;
  --space-xs: 8px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 32px;
}

.content-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  margin: 0;
  padding-bottom: var(--space-md);
}

.content-header-row {
  width: 100%;
  min-width: 0;
  // 顶部栏没有卡片底，和下方内容的间距收到 16
  margin-bottom: calc(16px - var(--space-md));
}

// 轮播按广告图比例决定高度，功能入口与之等高；窗口较窄时功能入口换到大图下方横排
.content-hero-row {
  display: grid;
  grid-template-columns: minmax(0, 2.6fr) minmax(300px, 1fr);
  gap: var(--space-md);
  min-width: 0;
}

@media (max-width: 1480px) {
  .home-container {
    --space-md: 16px;
  }
}

@media (max-width: 1280px) {
  .content-hero-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
