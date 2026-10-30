<script>
// “稍后提醒”只在本次运行内生效，重启客户端后恢复（与「我的游戏」一致）。
let attentionDismissedForRun = false
</script>
<script setup>
import { useI18n } from 'vue-i18n'
import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { toolServiceText as serviceText } from '@renderer/i18n/tool-service-text.js'
import { gamePresentation } from '@renderer/i18n/content.js'
import { computed, onActivated, onDeactivated, onBeforeUnmount, ref } from 'vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import {
  ToolAttention,
  ToolCoverCard,
  ToolEmpty,
  ToolFilterPills,
  ToolIcon,
  ToolIconButton,
  ToolNotice,
  ToolSearchField,
  coverMonogram,
  coverPlaceholderTone
} from '@renderer/component/tool-page/index.js'
import DlssPanel from '@renderer/component/dlss/DlssPanel.vue'
import DlssGameArt from '@renderer/component/dlss/DlssGameArt.vue'
import { dlssApi } from '@renderer/component/dlss/api.js'
import { swapperApi } from '@renderer/component/dlss/swapper-api.js'
import { gameStatus, sourceLabel } from '@renderer/component/dlss/presentation.js'
import { useLibraryScan } from '@renderer/component/dlss/useLibraryScan.js'

const { t: uiText } = useI18n()

const bindings = ref([]),
  surface = ref(null),
  dropEnvironment = ref('checking'),
  loading = ref(false),
  choosing = ref(false),
  error = ref('')
const displayName = (item) => gamePresentation(item).title
const open = ref(false),
  selected = ref(''),
  context = ref({}),
  dragging = ref(false),
  activated = ref(false)
const checking = ref(false),
  removing = ref(false),
  removeConfirm = ref(false),
  removalTarget = ref(null)
const interactionBusy = computed(
  () => open.value || choosing.value || checking.value || removing.value || removeConfirm.value
)
const {
  games: discovered,
  scanning,
  error: scanError,
  scan: scanLibrary
} = useLibraryScan(() => swapperApi('scanLibrary'))
const displayed = computed(() => [
  ...bindings.value,
  ...discovered.value.filter(
    (game) =>
      !bindings.value.some((item) => item.gameRoot.toLowerCase() === game.gameRoot.toLowerCase())
  )
])
// 状态筛选按 gameStatus 的色调分组：已安装 / 需处理（待还原、还原需处理、位置已失效）/ 未安装。
const STATUS_GROUP = {
  success: 'installed',
  warning: 'attention',
  danger: 'attention',
  info: 'idle'
}
const statusFilter = ref('all')
const keyword = ref('')
const attentionDismissed = ref(attentionDismissedForRun)
const statusGroup = (item) => STATUS_GROUP[gameStatus(item).tone] || 'idle'
const groupCounts = computed(() =>
  displayed.value.reduce(
    (counts, item) => {
      counts[statusGroup(item)] += 1
      return counts
    },
    { installed: 0, attention: 0, idle: 0 }
  )
)
const libraryReady = computed(() => !(scanning.value && !displayed.value.length))
const filterOptions = computed(() => {
  const count = (value) => (libraryReady.value ? value : null)
  return [
    { value: 'all', label: tt('全部'), count: count(displayed.value.length) },
    { value: 'installed', label: tt('已安装'), count: count(groupCounts.value.installed) },
    { value: 'attention', label: tt('需处理'), count: count(groupCounts.value.attention) },
    { value: 'idle', label: tt('未安装'), count: count(groupCounts.value.idle) }
  ]
})
const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase())
const filteredGames = computed(() =>
  displayed.value.filter((item) => {
    if (statusFilter.value !== 'all' && statusGroup(item) !== statusFilter.value) return false
    if (!normalizedKeyword.value) return true
    return [displayName(item), item.name, item.englishTitle, item.gameRoot]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(normalizedKeyword.value))
  })
)
const attentionItems = computed(() =>
  displayed.value
    .filter((item) => statusGroup(item) === 'attention')
    .map((item) => {
      const status = gameStatus(item)
      const name = displayName(item)
      const lastState = item.sessions?.at(-1)?.state
      // 与 gameStatus 的判断顺序一致：没有待处理会话、路径失效时才是“位置已失效”。
      const missing =
        item.pathValid === false &&
        !item.swapperInstalled &&
        (!lastState || lastState === 'restored')
      return {
        key: item.id || item.gameRoot,
        name: name + ' · ' + status.label,
        detail: missing
          ? tt('找不到 {0}，游戏可能已被移动或卸载。', [item.gameRoot])
          : status.tone === 'danger'
            ? tt('上次还原没有完成，请打开后处理。')
            : tt('上次安装后还没有还原，游戏目录里仍是替换后的文件。'),
        detailTitle: item.gameRoot,
        monogram: coverMonogram(item.englishTitle || item.englishName || name),
        tone: coverPlaceholderTone(item.gameRoot),
        portrait: true,
        actionLabel: missing ? tt('移除记录') : tt('打开处理')
      }
    })
)
const showAttention = computed(
  () =>
    !attentionDismissed.value &&
    attentionItems.value.length > 0 &&
    statusFilter.value === 'all' &&
    !normalizedKeyword.value
)
const showSkeleton = computed(
  () => !displayed.value.length && (scanning.value || loading.value) && !scanError.value
)
const sectionHint = computed(() =>
  scanning.value
    ? tt('正在扫描 Steam、Epic、GOG、Xbox 游戏库…')
    : tt('已扫描 Steam、Epic、GOG、Xbox 游戏库')
)
const dropTitle = computed(() =>
  dropEnvironment.value === 'elevated'
    ? tt('选择游戏文件夹')
    : dragging.value
      ? tt('松开以检测游戏')
      : tt('列表里没有？把游戏文件夹拖到这里')
)
const dropDescription = computed(() =>
  dropEnvironment.value === 'elevated'
    ? tt('以管理员身份运行时不能拖入文件夹，请使用“选择文件夹”。')
    : tt('自动识别游戏程序、渲染 API 和安装方式。也可以拖到页面任意位置。')
)

function coverSource(item) {
  return (
    item.artwork?.coverUrl ||
    item.coverImage ||
    (item.steamAppId
      ? 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/' +
        item.steamAppId +
        '/library_600x900.jpg'
      : '')
  )
}

function cardView(item) {
  const status = gameStatus(item)
  const name = displayName(item)
  return {
    title: name,
    meta: [status.tone === 'info' ? sourceLabel(item) + ' · ' + status.label : sourceLabel(item)],
    flag:
      status.tone === 'info'
        ? null
        : { tone: status.tone === 'success' ? 'success' : status.tone, label: status.label },
    portrait: true,
    tone: coverPlaceholderTone(item.gameRoot),
    coverLabel: name + ' · ' + status.label + tt(' · 管理 DLSS5'),
    coverDisabled: interactionBusy.value,
    coverAttrs: {
      class: 'game-card',
      title: item.gameRoot,
      'data-binding-id': item.id || undefined
    }
  }
}

const gameCards = computed(() =>
  filteredGames.value.map((item) => ({ key: item.id || item.gameRoot, item, view: cardView(item) }))
)

function openAttention(key) {
  const item = displayed.value.find((game) => (game.id || game.gameRoot) === key)
  if (item) showGame(item)
}

function dismissAttention() {
  attentionDismissedForRun = true
  attentionDismissed.value = true
}

function clearFilters() {
  statusFilter.value = 'all'
  keyword.value = ''
}

let timer,
  dragDepth = 0,
  generation = 0,
  listRevision = 0
async function refresh() {
  if (loading.value || removing.value) return
  const revision = listRevision
  loading.value = true
  try {
    const result = await swapperApi('list')
    if (revision !== listRevision) return
    bindings.value = result
    error.value = ''
  } catch (e) {
    if (revision === listRevision) error.value = e.message
  } finally {
    loading.value = false
  }
}
async function showGame(item) {
  if (interactionBusy.value) return
  const token = generation
  checking.value = true
  error.value = ''
  try {
    const location = await swapperApi('checkLocation', { id: item.id, gameRoot: item.gameRoot })
    if (token !== generation) return
    const programGone =
      location.exists && location.programMissing && item.id && canRemoveResidual(item)
    if (!location.exists || programGone) {
      removalTarget.value = {
        id: item.id,
        gameRoot: item.gameRoot,
        name: displayName(item),
        programMissing: !!programGone,
        item
      }
      removeConfirm.value = true
      return
    }
    openGame(item)
  } catch (e) {
    if (token === generation) error.value = e.message
  } finally {
    checking.value = false
  }
}
function openGame(item) {
  selected.value = item.id || ''
  // The selected card already has an identity; scanning only fills in its configuration.
  context.value = {
    name: item.name,
    englishTitle: item.englishTitle || item.englishName || item.rawName,
    chineseTitle: item.chineseTitle || item.chineseName,
    gameRoot: item.gameRoot,
    exePath: item.exePath,
    sourcePlatform: item.sourcePlatform,
    steamAppId: item.steamAppId,
    coverImage: item.coverImage,
    artwork: item.artwork
  }
  open.value = true
}
// 文件安装的备份保留在目录中；只有恢复信息依赖记录的旧版会话阻止移除。
function canRemoveResidual(item) {
  return !item.sessions?.some((session) => session.state !== 'restored')
}
const removalTitle = computed(() =>
  removalTarget.value?.programMissing
    ? tt('找不到游戏程序，是否移除记录？')
    : tt('游戏路径不存在，是否删除？')
)
const removalDescription = computed(() => {
  const target = removalTarget.value
  if (!target) return ''
  return target.programMissing
    ? tt(
        '{0} 的游戏文件夹还在，但游戏程序已经不存在，可能已卸载或移动。移除记录只会从列表里去掉这款游戏，存档、模组、DLSS 文件和还原备份都会保留。重装游戏后可重新添加此文件夹；如需先还原 DLSS 文件，请选择“仍然打开”。',
        [target.name]
      )
    : target.name
})
const removalActions = computed(() =>
  removalTarget.value?.programMissing
    ? [{ key: 'open', text: tt('仍然打开'), variant: 'secondary' }]
    : []
)
function handleRemovalAction(action) {
  const target = removalTarget.value
  if (action?.key !== 'open' || !target?.item) return
  openGame(target.item)
}
async function removeMissingGame() {
  const item = removalTarget.value
  if (!item || removing.value) return
  removing.value = true
  error.value = ''
  try {
    if (item.id)
      await swapperApi(
        'remove',
        item.programMissing
          ? { id: item.id, onlyIfProgramMissing: true }
          : { id: item.id, onlyIfMissing: true }
      )
    else if ((await swapperApi('checkLocation', { gameRoot: item.gameRoot })).exists)
      throw new Error(tt('游戏路径已恢复，未删除记录，请重新打开游戏。'))
    listRevision++
    if (item.id) bindings.value = bindings.value.filter((record) => record.id !== item.id)
    discovered.value = discovered.value.filter(
      (record) => record.gameRoot.toLowerCase() !== item.gameRoot.toLowerCase()
    )
    removalTarget.value = null
  } catch (e) {
    error.value = e.message
    return { success: false, message: e.message }
  } finally {
    removing.value = false
  }
}
function openPath(value) {
  selected.value = ''
  context.value = { gameRoot: value }
  open.value = true
}
async function checkDropEnvironment() {
  try {
    const result = await swapperApi('dropEnvironment')
    dropEnvironment.value = result.status
  } catch {
    dropEnvironment.value = 'unavailable'
  }
}
async function choose() {
  if (interactionBusy.value) return
  choosing.value = true
  error.value = ''
  try {
    const result = await dlssApi('pick', { kind: 'directory' })
    if (!result.canceled) openPath(result.path)
  } catch (e) {
    error.value = e.message
  } finally {
    choosing.value = false
  }
}
function dragEnter(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
  dragDepth++
  dragging.value = true
}
function dragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}
function dragOver(event) {
  if (interactionBusy.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function drop(event) {
  dragDepth = 0
  dragging.value = false
  if (interactionBusy.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length !== 1) {
    error.value = uiText('tools.selectOneGameFolderAtATime')
    return
  }
  const value = window.api?.getPathForFile?.(files[0]) || ''
  const entry = event.dataTransfer?.items?.[0]?.webkitGetAsEntry?.()
  if (entry?.isFile || /\.exe$/i.test(value)) {
    error.value = uiText('tools.dropAGameFolderToScanItAutomatically')
    return
  }
  if (!value) {
    error.value = uiText('tools.couldNotReadTheDroppedPathUseChooseFolder')
    return
  }
  openPath(value)
}
function resetDrag() {
  dragDepth = 0
  dragging.value = false
}
function windowFileDrag(event) {
  if (!activated.value || interactionBusy.value) return
  if (surface.value?.contains(event.target)) return
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'dragenter') dragEnter(event)
  else if (event.type === 'dragover') dragOver(event)
  else if (event.type === 'dragleave') dragLeave()
  else if (event.type === 'drop') drop(event)
}
function listenForDrag(add) {
  const method = add ? 'addEventListener' : 'removeEventListener'
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'])
    window[method](type, windowFileDrag)
  window[method]('dragend', resetDrag)
  window[method]('blur', resetDrag)
}
onActivated(() => {
  if (activated.value) return
  activated.value = true
  listenForDrag(true)
  checkDropEnvironment()
  refresh()
  scanLibrary()
  clearInterval(timer)
  timer = setInterval(refresh, 5000)
})
onDeactivated(() => {
  generation++
  removeConfirm.value = false
  removalTarget.value = null
  activated.value = false
  resetDrag()
  listenForDrag(false)
  clearInterval(timer)
})
onBeforeUnmount(() => {
  generation++
  clearInterval(timer)
  listenForDrag(false)
})
</script>
<template>
  <div
    ref="surface"
    class="dlss-tool tool-section"
    :data-file-drop-active="activated && !interactionBusy ? 'true' : 'false'"
    @dragenter.prevent.stop="dragEnter"
    @dragover="dragOver"
    @dragleave.prevent.stop="dragLeave"
    @drop.prevent.stop="drop"
  >
    <header class="tool-toolbar">
      <ToolFilterPills v-model="statusFilter" variant="accent" :options="filterOptions" :label="tt('按状态筛选')" />
      <div class="tool-toolbar__tools">
        <ToolSearchField
          v-model="keyword"
          :placeholder="tt('搜索游戏')"
          :label="tt('搜索本地游戏')"
        />
        <ToolIconButton
          class="scan-library-button"
          icon="refresh"
          :label="tt('重新扫描本地游戏')"
          :busy="scanning"
          @click="scanLibrary"
        />
      </div>
    </header>

    <ToolNotice v-if="error" tone="danger" class="page-error">
      {{ serviceText(error) }}
      <template #actions>
        <VxButton variant="secondary" size="sm" @click="refresh">{{ tt('重试') }}</VxButton>
      </template>
    </ToolNotice>

    <ToolAttention
      v-if="showAttention"
      :title="tt('{0} 个游戏需要处理', [attentionItems.length])"
      :items="attentionItems"
      :disabled="interactionBusy"
      @action="openAttention"
      @dismiss="dismissAttention"
    />

    <section
      class="game-drop-zone"
      :class="{ 'is-dragging': dragging, 'is-elevated': dropEnvironment === 'elevated' }"
      :aria-label="tt('添加游戏')"
    >
      <span class="drop-icon" aria-hidden="true">
        <ToolIcon name="folder-plus" :size="18" />
      </span>
      <div class="drop-text">
        <h3>{{ dropTitle }}</h3>
        <p>{{ dropDescription }}</p>
      </div>
      <div class="browse-actions">
        <VxButton
          variant="secondary"
          :disabled="interactionBusy"
          :loading="choosing"
          @click="choose"
        >
          {{ tt('选择文件夹') }}
        </VxButton>
      </div>
    </section>

    <section class="recent-games" aria-labelledby="dlss-games-title" :aria-busy="scanning">
      <div class="tool-section-head">
        <h2 id="dlss-games-title" class="tool-section-title">
          {{ tt('本地游戏') }}<small v-if="libraryReady">{{ displayed.length }}</small>
        </h2>
        <p class="tool-section-hint" :role="scanning ? 'status' : undefined">
          <span v-if="scanning" class="tool-inline-spinner" aria-hidden="true"></span>
          {{ sectionHint }}
        </p>
      </div>

      <ToolNotice v-if="scanError" tone="danger" class="page-error">
        {{ serviceText(scanError) }}
        <template #actions>
          <VxButton variant="secondary" size="sm" :disabled="scanning" @click="scanLibrary">
            {{ tt('重试扫描') }}
          </VxButton>
        </template>
      </ToolNotice>

      <div v-if="showSkeleton" class="tool-cover-grid is-portrait" aria-hidden="true">
        <div v-for="index in 8" :key="index" class="tool-skeleton-card is-portrait">
          <span class="tool-skeleton is-cover"></span>
          <span class="tool-skeleton is-line"></span>
          <span class="tool-skeleton is-short"></span>
        </div>
      </div>

      <div v-else-if="gameCards.length" class="game-library tool-cover-grid is-portrait">
        <ToolCoverCard
          v-for="card in gameCards"
          :key="card.key"
          v-bind="card.view"
          @select="showGame(card.item)"
        >
          <template #media>
            <DlssGameArt
              :src="coverSource(card.item)"
              :fallbacks="card.item.artwork?.coverFallbackUrls || []"
              :name="displayName(card.item)"
            />
          </template>
        </ToolCoverCard>
      </div>

      <ToolEmpty
        v-else-if="displayed.length"
        compact
        icon="search"
        :title="tt('没有符合条件的游戏')"
        :description="tt('换个筛选条件或关键词试试。')"
      >
        <VxButton variant="secondary" @click="clearFilters">{{ tt('清除筛选') }}</VxButton>
      </ToolEmpty>

      <ToolEmpty
        v-else-if="!scanError"
        compact
        icon="folder"
        :title="tt('没有扫描到本地游戏')"
        :description="
          tt('可以把游戏文件夹拖到这个页面，或者选择文件夹。也可以从模组列表里的“DLSS5”按钮进入。')
        "
      >
        <VxButton variant="secondary" :loading="scanning" @click="scanLibrary">
          {{ tt('重新扫描') }}
        </VxButton>
      </ToolEmpty>
    </section>

    <div v-if="dragging" class="drop-overlay" role="status">
      <div class="drop-overlay__content">
        <span class="drop-overlay__icon" aria-hidden="true">
          <ToolIcon name="drop" :size="28" />
        </span>
        <strong>{{ tt('松开以检测游戏') }}</strong>
        <span>{{ tt('一次拖入一个游戏文件夹，不要拖 .exe 文件') }}</span>
      </div>
    </div>

    <DlssPanel v-model="open" :binding-id="selected" :context="context" @changed="refresh" />
    <VxConfirmModal
      v-model="removeConfirm"
      :title="removalTitle"
      :description="removalDescription"
      :confirm-text="removalTarget?.programMissing ? tt('移除记录') : tt('确认')"
      :cancel-text="tt('取消')"
      :actions="removalActions"
      danger
      :confirm-action="removeMissingGame"
      @action="handleRemovalAction"
    />
  </div>
</template>

<style scoped lang="scss">
.dlss-tool {
  position: relative;
}

// 没有封面图时，占位底色与风灵月影、我的游戏一致（深色底 + 浅色缩写）。
.dlss-tool :deep(.tool-cover-card__cover .dlss-art) {
  color: rgba(255, 255, 255, 0.6);
  background: var(--cover-tone, var(--color-surface-strong));
}

.game-drop-zone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) 14px;
  padding: var(--space-3) 14px var(--space-3) var(--space-3);
  background: var(--color-surface-soft);
  border: 1px dashed var(--color-border-strong);
  border-radius: 10px;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &.is-dragging {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
    border-color: var(--color-accent);
  }
}

.drop-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--color-accent-active);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.drop-text {
  flex: 1 1 320px;
  min-width: 0;

  h3 {
    margin: 0;
    color: var(--color-text);
    font-size: 13.5px;
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-base);
  }

  p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 12.5px;
    line-height: var(--line-height-base);
  }
}

.browse-actions {
  display: flex;
  gap: var(--space-2);
}

.recent-games {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: center;
  background: color-mix(in srgb, var(--color-accent-soft) 40%, rgba(255, 255, 255, 0.94));
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-lg);
  pointer-events: none;

  strong {
    color: var(--color-accent-strong);
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
  }
}

// 内容很长时覆盖层会跟着变高，提示内容贴在可视区域内。
.drop-overlay__content {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: 120px var(--space-6) var(--space-8);
}

.drop-overlay__icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-1);
  color: var(--color-accent-active);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
}

@media (prefers-reduced-motion: reduce) {
  .game-drop-zone {
    transition: none;
  }
}
</style>
