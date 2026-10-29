<script setup>
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { getQuickLaunchWeights } from '@renderer/utils/quick-launch-weight.js'
import { gameLibraryKey as getGameKey } from '../../../../../shared/games/game-library.js'
import storage from '@renderer/common/storage.js'
import QuickLaunchToolbar from './quick-launch/quick-launch-toolbar.vue'
import QuickLaunchRail from './quick-launch/quick-launch-rail.vue'

const props = defineProps({
  quickLaunchGames: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  }
})

// select：当前选中游戏变化（含自动选中的「最常启动」），供上方大图显示。
// focus-game：用户主动点选或启动了某个游戏，大图需要立即切到该游戏。
const emit = defineEmits([
  'start-game',
  'manage-mod',
  'preview-mod',
  'open-game-dir',
  'select',
  'focus-game'
])

// 排列方式沿用原来的本地存储键；没有保存过时默认横列
const QUICK_LAUNCH_LAYOUT_KEY = 'home_quick_launch_layout_mode'
const searchKeyword = ref('')
const layoutMode = ref(getSavedLayoutMode())
const selectedKey = ref('')
const userSelected = ref(false)
const localWeights = ref(getQuickLaunchWeights())

function refreshWeights() {
  localWeights.value = getQuickLaunchWeights()
}

function getSavedLayoutMode() {
  try {
    return storage.local.get(QUICK_LAUNCH_LAYOUT_KEY) === 'vertical' ? 'vertical' : 'horizontal'
  } catch {
    return 'horizontal'
  }
}

function handleLayoutModeChange(value) {
  layoutMode.value = value === 'vertical' ? 'vertical' : 'horizontal'
  try {
    storage.local.set(QUICK_LAUNCH_LAYOUT_KEY, layoutMode.value)
  } catch {
    // 本地存储不可用时只影响本次会话
  }
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeCompactSearchText(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9一-鿿]/g, '')
}

function matchSearchText(field, keyword, compactKeyword) {
  const text = normalizeSearchText(field)
  const compactText = normalizeCompactSearchText(field)
  return text.includes(keyword) || Boolean(compactKeyword && compactText.includes(compactKeyword))
}

function compareText(a = '', b = '') {
  return String(a || '').localeCompare(String(b || ''), contentLocale.value, {
    sensitivity: 'base',
    numeric: true
  })
}

const normalizedSearchKeyword = computed(() => normalizeSearchText(searchKeyword.value))
const compactSearchKeyword = computed(() => normalizeCompactSearchText(searchKeyword.value))

const sortedQuickLaunchGames = computed(() => {
  const weights = localWeights.value
  return [...props.quickLaunchGames].sort((a, b) => {
    const wa = Number(weights[a.app_id || a.steamAppId || a.id] || 0)
    const wb = Number(weights[b.app_id || b.steamAppId || b.id] || 0)
    if (wb !== wa) {
      return wb - wa
    }
    return compareText(gamePresentation(a).title, gamePresentation(b).title)
  })
})

const filteredQuickLaunchGames = computed(() => {
  const keyword = normalizedSearchKeyword.value
  const compactKeyword = compactSearchKeyword.value
  if (!keyword) {
    return sortedQuickLaunchGames.value
  }

  return sortedQuickLaunchGames.value.filter((item) => {
    const fields = [
      item?.displayName,
      item?.chineseTitle,
      item?.englishTitle,
      item?.displaySubtitle,
      item?.sourceLabel,
      item?.source,
      item?.currentSource
    ]
    return fields.some((field) => matchSearchText(field, keyword, compactKeyword))
  })
})

const isSearching = computed(() => normalizedSearchKeyword.value.length > 0)
const topGameKey = computed(() => {
  const top = sortedQuickLaunchGames.value[0]
  return top ? getGameKey(top) : ''
})
const selectedGame = computed(
  () => sortedQuickLaunchGames.value.find((item) => getGameKey(item) === selectedKey.value) || null
)

// 没有手动选择时始终跟随启动次数最多的游戏；手动选择的游戏被移除后回到最常启动。
function ensureSelectedGame() {
  if (userSelected.value && selectedGame.value) {
    return
  }
  userSelected.value = false
  selectedKey.value = topGameKey.value
}

function selectGame(item, { focus = true } = {}) {
  selectedKey.value = getGameKey(item)
  userSelected.value = selectedKey.value !== topGameKey.value
  if (focus) {
    emit('focus-game', item)
  }
}

function handleSelectGame(item) {
  selectGame(item)
}

function handleStartGame(item) {
  selectGame(item)
  emit('start-game', item)
}

// 管理 / 浏览 / 打开目录会离开首页或打开外部窗口，只同步选中，不切换大图
function handleCardAction(eventName, item) {
  selectGame(item, { focus: false })
  emit(eventName, item)
}

function clearSearch() {
  searchKeyword.value = ''
}

function handleStorageChange(e) {
  if (e.key === 'quick_launch_weights') {
    refreshWeights()
  }
}

watch(
  () => [props.quickLaunchGames, localWeights.value],
  () => {
    ensureSelectedGame()
  },
  { deep: true, immediate: true }
)

watch(
  () => [selectedGame.value, selectedKey.value === topGameKey.value],
  ([item, isTop]) => {
    emit('select', { item, isTop })
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('storage', handleStorageChange)
  window.addEventListener('focus', refreshWeights)
})

onActivated(() => {
  refreshWeights()
  ensureSelectedGame()
})

onUnmounted(() => {
  window.removeEventListener('storage', handleStorageChange)
  window.removeEventListener('focus', refreshWeights)
})

defineOptions({
  name: 'HomeQuickLaunch'
})
</script>

<template>
  <section class="quick-launch-panel" :aria-label="$t('quickLaunch.title')">
    <quick-launch-toolbar
      v-model:keyword="searchKeyword"
      :total-count="sortedQuickLaunchGames.length"
      :layout-mode="layoutMode"
      @update:layout-mode="handleLayoutModeChange"
    />

    <quick-launch-rail
      :games="filteredQuickLaunchGames"
      :loading="loading"
      :is-searching="isSearching"
      :keyword="searchKeyword"
      :selected-key="selectedKey"
      :layout-mode="layoutMode"
      @select="handleSelectGame"
      @start-game="handleStartGame"
      @manage-mod="(item) => handleCardAction('manage-mod', item)"
      @preview-mod="(item) => handleCardAction('preview-mod', item)"
      @open-game-dir="(item) => handleCardAction('open-game-dir', item)"
      @clear-search="clearSearch"
    />
  </section>
</template>

<style scoped lang="scss">
.quick-launch-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
