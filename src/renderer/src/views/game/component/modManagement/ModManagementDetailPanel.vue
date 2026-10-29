<script setup>
import { matchesModMetadataLabel } from './mod-metadata-label.js'
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  MoreOutlined,
  WarningOutlined
} from '@ant-design/icons-vue'
import ModManagementIcon from './ModManagementIcon.vue'
import ModManagementMenu from './ModManagementMenu.vue'
import { $message } from '@renderer/common/message.js'
import { VxButton, VxSwitch } from '@renderer/component/vertex-ui'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import { useModManagementControllerContext } from './mod-management-context.js'
import { getModFileInfo } from '../../../../../../shared/games/mod-management-location.js'

const DIRECTORY_KEYS = ['open-install-root', 'location', 'open-location', 'open-local-library']
const UPDATE_KEYS = ['update', 'update-package', 'update-ficsit', 'update-nexus', 'update-modio']
const LIST_LIMIT = 5

const controller = useModManagementControllerContext()
const ui = inject('mod-management-ui')
const vControl = ui.controlDirective
const copied = ref(false)
const copyBusy = ref(false)
const more = reactive({ open: false, anchor: null })
const expanded = reactive({ desc: false, dependents: false, files: false })
const descRef = ref(null)
const scrollRef = ref(null)
const panelRef = ref(null)
const descClamped = ref(false)
let copyTimer
const card = computed(() => controller.selectedCard)
const rows = computed(() =>
  (controller.selectedDetailInfo?.infoGroups || []).flatMap((group) => group.rows || [])
)
function detailValue(labels) {
  return String(
    rows.value.find((row) => matchesModMetadataLabel(row, labels) && row.value && row.value !== '--')
      ?.value ||
      ui.meta(card.value, labels) ||
      ''
  )
}
const source = computed(() => resolveSourcePlatformLabel(card.value?.source, ui.source(card.value)))
// 来源只在与当前页面不同时显示（例如本地接管进来的模组），避免和页头重复。
const showSource = computed(
  () =>
    Boolean(controller.activeSource && card.value?.source) &&
    card.value.source !== controller.activeSource
)
const fileInfo = computed(() => getModFileInfo(card.value?.raw))
const fileItems = computed(() => fileInfo.value.files)
const fileCount = computed(
  () =>
    fileItems.value.length ||
    (card.value?.raw?.fileCount ?? card.value?.raw?.file_count ?? (detailValue(['文件数']) || '--'))
)
const relations = computed(
  () => controller.selectedRelations || { dependencies: [], dependents: [] }
)
const relationsKnown = computed(() => card.value?.relationsKnown !== false)
const enabledDependents = computed(() => (card.value ? ui.dependentCards(card.value) : []))
const missing = computed(() => (card.value ? ui.missingDependencies(card.value) : []))
const dependents = computed(() => {
  const list = [...(relations.value.dependents || [])]
  // 已启用的被依赖模组排在前面：禁用或删除时真正受影响的是它们。
  return list.sort(
    (a, b) =>
      Number(Boolean(relationCard(b)?.toggle?.checked)) -
      Number(Boolean(relationCard(a)?.toggle?.checked))
  )
})
const visibleDependents = computed(() =>
  expanded.dependents ? dependents.value : dependents.value.slice(0, LIST_LIMIT)
)
const visibleFiles = computed(() =>
  expanded.files ? fileItems.value : fileItems.value.slice(0, LIST_LIMIT)
)
function formatSize(value) {
  let size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  const text = unit === 0 ? String(Math.round(size)) : size.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[unit]}`
}
const fileSummary = computed(() => {
  const count = Number(fileCount.value)
  const size = formatSize(card.value?.raw?.file_size ?? card.value?.raw?.fileSize)
  const text = Number.isFinite(count) ? uiText('ui.valueItems', { value1: (count.toLocaleString('zh-CN')) }) : '—'
  return size ? `${text} · ${size}` : text
})
const versionText = computed(() => {
  const value = ui.version(card.value)
  if (value && value !== '--') return value
  return ui.isLocal(card.value) ? uiText('ui.unspecified') : '—'
})
const authorText = computed(() => {
  const value = ui.author(card.value)
  if (value && value !== '--') return value
  return ui.isLocal(card.value) ? uiText('ui.localImport') : '—'
})
const info = computed(() => {
  const list = [
    { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: versionText.value, mono: versionText.value !== uiText('ui.unspecified') },
    { labelKey: 'localMod.author', get label() { return uiText('localMod.author') }, value: authorText.value },
    { labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: ui.installTime(card.value) || '—' },
    { labelKey: 'tools.file', get label() { return uiText('tools.file') }, value: fileSummary.value }
  ]
  if (showSource.value) list.push({ labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: source.value })
  return list
})
const path = computed(() => fileInfo.value.primaryInstallPath)
const openingDirectory = ref(false)
async function runAction(action) {
  if (action.disabled || openingDirectory.value) return
  const directory = DIRECTORY_KEYS.includes(action.key)
  if (directory) openingDirectory.value = true
  try {
    await controller.handleDetailAction(card.value, action.key)
  } finally {
    if (directory) openingDirectory.value = false
  }
}
const headerActions = computed(() => {
  const actions = controller.selectedDetailActions || []
  const groups = [
    { keys: DIRECTORY_KEYS, labelKey: 'ui.openFolder', get label() { return uiText('ui.openFolder') }, icon: FolderOpenOutlined },
    { keys: ['open-config-files'], labelKey: 'ui.configurationFile', get label() { return uiText('ui.configurationFile') }, icon: FileTextOutlined },
    {
      keys: ['open-source-page', 'open-package-page', 'source'],
      labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') },
      icon: LinkOutlined
    }
  ]
  return groups.map((group) => {
    const action = actions.find((item) => group.keys.includes(item.key))
    const localWithoutPage =
      group.keys.includes('open-source-page') &&
      ui.isLocal(card.value) &&
      !card.value?.raw?.packageUrl &&
      !card.value?.raw?.sourceUrl
    return {
      ...group,
      ...action,
      label: group.label,
      title: localWithoutPage
        ? uiText('ui.locallyImportedModsHaveNoSourcePage')
        : action?.title || (!action ? uiText('ui.thisSourceDoesNotSupportThisActionYet') : ''),
      disabled: !action || action.disabled || localWithoutPage
    }
  })
})
const sourceWarning = computed(() => {
  const raw = card.value?.raw || {}
  if (raw.source_status === 'missing')
    return {
      tone: 'danger',
      get title() { return uiText('ui.sourceFilesMissing') },
      get text() { return uiText('ui.sourceFilesNoLongerExistSoThisModCannotBe') },
      action: findAction('clear-record')
    }
  if (card.value?.toggle?.checked && raw.source_lock_state === 'lock_failed')
    return {
      tone: 'warning',
      get title() { return uiText('ui.couldNotLockSourceFiles') },
      get text() { return uiText('ui.theModIsEnabledButDeletionProtectionMayNotBe') },
      action: findAction('retry-lock')
    }
  if (card.value?.toggle?.checked && raw.source_lock_state === 'locked')
    return {
      tone: 'info',
      get title() { return uiText('ui.sourceFilesLocked') },
      get text() { return uiText('ui.sourceFilesAreProtectedByALockDisableTheMod') }
    }
  return null
})
function findAction(key) {
  return (controller.selectedDetailActions || []).find((action) => action.key === key) || null
}
// 提示条里已经出现的操作（清除失效记录、重试加锁）不再在菜单里重复。
const extraActions = computed(() =>
  (controller.selectedDetailActions || []).filter(
    (action) =>
      !headerActions.value.some((item) => item.key === action.key) &&
      !UPDATE_KEYS.includes(action.key) &&
      action.key !== 'delete' &&
      action.key !== sourceWarning.value?.action?.key
  )
)
const deleteText = computed(() =>
  card.value?.raw?.canRemoveRecordOnly || card.value?.installModel === 'local-library'
    ? '移除记录'
    : card.value?.installModel === 'bound'
      ? '删除文件'
      : '删除'
)
const deleteTitle = computed(() =>
  card.value?.raw?.canRemoveRecordOnly
    ? '游戏目录已缺失，仅移除安装记录'
    : card.value?.toggle?.checked && card.value?.installModel !== 'local-library'
      ? '请先禁用后再卸载'
      : ''
)
const menuItems = computed(() => {
  if (!card.value) return []
  const deletable = ui.canDelete(card.value)
  return [
    { key: 'copy-path', labelKey: 'ui.copyInstallationLocation', get label() { return uiText('ui.copyInstallationLocation') }, disabled: !path.value },
    { key: 'copy-name', labelKey: 'ui.copyName', get label() { return uiText('ui.copyName') } },
    ...(extraActions.value.length ? [{ separator: true }] : []),
    ...extraActions.value.map((action) => ({
      key: action.key,
      label: action.loading ? action.loadingText || `${action.label}…` : action.label,
      disabled: ui.busy || action.disabled || action.loading,
      title: action.title || ''
    })),
    { separator: true },
    {
      key: 'delete',
      label: `${deleteText.value}…`,
      danger: true,
      className: 'mm-detail-delete',
      disabled: ui.busy || !deletable,
      hint: !deletable && card.value.toggle?.checked ? uiText('ui.disableFirst') : '',
      title: deleteTitle.value
    }
  ]
})
function openMore(event) {
  more.anchor = { rect: event.currentTarget.getBoundingClientRect() }
  more.open = true
}
function runMenu(item) {
  if (!card.value) return
  if (item.key === 'copy-path') return copyPath()
  if (item.key === 'copy-name') return ui.copyText(ui.title(card.value), '名称')
  if (item.key === 'delete') return controller.handleDetailDelete(card.value)
  const action = extraActions.value.find((entry) => entry.key === item.key)
  if (action) return controller.handleDetailAction(card.value, action.key)
}
const displayNote = computed(() => {
  const note = String(card.value?.noteText || '')
  return note === uiText('ui.updateAvailableTargetVersionValue', { value1: (ui.latestVersion(card.value)) }) ? '' : note
})
const stateText = computed(() => {
  if (card.value?.toggle?.visible === false) return card.value.status?.text || uiText('ui.localAsset')
  return ui.switchValue(card.value) ? uiText('ui.enabled') : uiText('ui.disabled')
})
function relationCard(item) {
  return ui.cards.find((row) => row.key === item.key)
}
function relationStatus(item) {
  const row = relationCard(item)
  if (row) return row.toggle?.checked ? 'enabled' : 'disabled'
  return item.installed ? 'installed' : 'missing'
}
const RELATION_TEXT = {
  get enabled() { return uiText('ui.enabled') },
  get disabled() { return uiText('ui.disabled') },
  get installed() { return uiText('tools.installed') },
  get missing() { return uiText('tools.notInstalled3') }
}
function relationTitle(item) {
  const row = relationCard(item)
  if (!row) return item.installed ? item.title : uiText('ui.valueIsNotInstalled', { value1: (item.title) })
  return uiText('ui.viewValue', { value1: (item.title) })
}
function visitRelation(item) {
  const row = relationCard(item)
  if (row) ui.focusCard(row.key)
}
const missingText = computed(() => {
  const names = missing.value.map((item) => item.title)
  if (!names.length) return ''
  const head = names.slice(0, 3).join('、')
  const tail = names.length > 3 ? uiText('ui.andValueOthers', { value1: (names.length) }) : ''
  return uiText('ui.valueValueIsNotInstalledValueMayNotLoadCorrectly', { value1: (head), value2: (tail), value3: (ui.title(card.value)) })
})
async function copyPath() {
  if (!path.value || copyBusy.value) return
  const value = path.value
  copyBusy.value = true
  try {
    await navigator.clipboard.writeText(value)
    if (path.value !== value) return
    copied.value = true
    $message.success(uiMessage('ui.installationLocationCopied'))
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    copied.value = false
    $message.error(uiMessage('ui.copyingFailedPleaseTryAgain'))
  } finally {
    copyBusy.value = false
  }
}
async function measureDescription() {
  descClamped.value = false
  await nextTick()
  const el = descRef.value
  if (el) descClamped.value = el.scrollHeight > el.clientHeight + 1
}
watch(
  () => card.value?.key,
  () => {
    copied.value = false
    more.open = false
    expanded.desc = false
    expanded.dependents = false
    expanded.files = false
    clearTimeout(copyTimer)
    // 换模组时从头部开始看，不沿用上一个模组的滚动位置。
    if (scrollRef.value) scrollRef.value.scrollTop = 0
  }
)
watch(
  () => [card.value?.key, card.value?.description, ui.narrow],
  () => measureDescription(),
  { immediate: true, flush: 'post' }
)
// 抽屉关闭后内容变为 inert；焦点原本在抽屉里时还给正在查看的行，避免落到 body。
watch(
  () => ui.drawerOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || !panelRef.value?.contains(document.activeElement)) return
    document.querySelector('.mm-compact-item.is-viewing .mm-mod-name-button')?.focus()
  }
)
onBeforeUnmount(() => clearTimeout(copyTimer))
</script>

<template>
  <aside
    ref="panelRef"
    class="mm-split-right"
    :class="{ 'is-drawer': ui.narrow, 'is-open': ui.drawerOpen }"
    :aria-label="$t('ui.modDetails')"
    :aria-hidden="ui.narrow && !ui.drawerOpen ? 'true' : undefined"
    :inert="ui.narrow && !ui.drawerOpen ? true : undefined"
  >
    <div v-if="!card" class="mm-state">
      <FileTextOutlined aria-hidden="true" />
      <h3>{{ $t('ui.noModSelected') }}</h3>
      <p>{{ $t('ui.selectAModInTheListOnTheLeftTo') }}</p>
    </div>
    <template v-else>
      <div ref="scrollRef" class="mm-detail-scroll mm-scrollbar">
        <header class="mm-detail-header">
          <ModManagementIcon
            :src="card.coverUrl || ''"
            :name="card.title || ''"
            :size="44"
            class="mm-detail-cover"
          />
          <div class="mm-detail-identity">
            <div class="mm-detail-title-row">
              <h2 :title="card.title || ''">{{ card.title || '—' }}</h2>
            </div>
            <div class="mm-detail-subtitle">
              <span>{{ authorText }}</span
              ><span aria-hidden="true">·</span
              ><span :class="{ 'mm-mono': versionText !== '未标注' }">{{ versionText }}</span>
            </div>
          </div>
          <div class="mm-detail-state">
            <span
              class="mm-detail-state-text"
              :class="{ 'is-enabled': card.toggle?.visible !== false && ui.switchValue(card) }"
              >{{ stateText }}</span
            >
            <VxSwitch
              v-if="card.toggle?.visible !== false"
              :key="`${card.key}:${ui.switchRev(card)}`"
              v-control="{
                label: `${ui.switchValue(card) ? '禁用' : '启用'} ${card.title}`,
                switch: true,
                checked: ui.switchValue(card)
              }"
              class="mm-detail-switch"
              :class="{ 'is-pending': ui.isSwitchPending(card) }"
              :model-value="ui.switchValue(card)"
              :disabled="ui.rowLocked || card.toggle?.disabled || ui.isUpdating(card)"
              :aria-busy="ui.isSwitchPending(card) || Boolean(card.toggle?.loading)"
              :title="ui.isUpdating(card) ? $t('ui.cannotToggleWhileUpdating') : card.toggle?.title || ''"
              @update:model-value="ui.toggle(card, $event, true)"
            />
          </div>
          <button
            v-if="ui.narrow"
            type="button"
            class="mm-icon-button mm-drawer-close"
            :aria-label="$t('taskCenter.actions.close')"
            :title="$t('ui.closeDetailsEsc')"
            @click="ui.drawerOpen = false"
          >
            <CloseOutlined />
          </button>
        </header>
        <div class="mm-detail-actions">
          <VxButton
            v-for="action in headerActions"
            :key="action.label"
            variant="secondary"
            size="sm"
            :class="{ 'is-icon-only': ui.narrow }"
            :disabled="ui.busy || action.disabled || openingDirectory"
            :title="action.title || (ui.narrow ? action.label : undefined)"
            :aria-label="ui.narrow ? action.label : undefined"
            :loading="Boolean(action.loading) || (openingDirectory && DIRECTORY_KEYS.includes(action.key))"
            @click="runAction(action)"
            ><component :is="action.icon" /><span class="mm-action-text">{{
              action.label
            }}</span></VxButton
          >
          <button
            type="button"
            class="mm-icon-button mm-detail-more"
            :class="{ 'is-open': more.open }"
            :aria-label="$t('ui.moreActions')"
            aria-haspopup="menu"
            :aria-expanded="more.open"
            @click="openMore"
          >
            <MoreOutlined />
          </button>
        </div>
        <div class="mm-callouts">
          <div
            v-if="sourceWarning"
            class="mm-callout mm-notice"
            :class="`is-${sourceWarning.tone}`"
            :role="sourceWarning.tone === 'danger' ? 'alert' : 'status'"
          >
            <span class="mm-callout-icon" aria-hidden="true"><WarningOutlined /></span>
            <div class="mm-callout-body">
              <strong>{{ sourceWarning.title }}</strong>
              <p>{{ sourceWarning.text }}</p>
            </div>
            <VxButton
              v-if="sourceWarning.action"
              variant="secondary"
              size="sm"
              class="mm-callout-action"
              :disabled="ui.busy || sourceWarning.action.disabled"
              :loading="Boolean(sourceWarning.action.loading)"
              :title="sourceWarning.action.title || undefined"
              @click="controller.handleDetailAction(card, sourceWarning.action.key)"
              >{{ sourceWarning.action.label }}</VxButton
            >
          </div>
          <div v-if="missing.length" class="mm-callout mm-notice is-warning" role="status">
            <span class="mm-callout-icon" aria-hidden="true"><WarningOutlined /></span>
            <div class="mm-callout-body">
              <strong>{{ $t('ui.missing') }} {{ missing.length }} {{ $t('ui.prerequisites') }}</strong>
              <p>{{ missingText }}</p>
            </div>
          </div>
          <div
            v-if="ui.hasUpdate(card)"
            class="mm-callout mm-update-banner"
            :class="{ 'is-busy': ui.isUpdating(card) }"
            role="status"
          >
            <span class="mm-callout-icon" aria-hidden="true"
              ><span v-if="ui.isUpdating(card)" class="mm-spin"></span><ArrowUpOutlined v-else
            /></span>
            <div class="mm-callout-body">
              <template v-if="ui.isUpdating(card)">
                <strong
                  >{{ $t('ui.updatingTo') }} <span class="mm-mono">{{ ui.latestVersion(card) || $t('ui.newVersion') }}</span
                  >…</strong
                >
                <p>{{ $t('ui.refreshesAutomaticallyWhenComplete') }}</p>
              </template>
              <template v-else>
                <strong
                  >{{ $t('ui.newVersion') }}
                  <span class="mm-mono">{{ ui.latestVersion(card) || '' }}</span> {{ $t('tools.available') }}</strong
                >
                <p>
                  {{ $t('tools.current') }} <span class="mm-mono">{{ versionText }}</span>
                </p>
              </template>
            </div>
            <VxButton
              variant="secondary"
              size="sm"
              class="mm-callout-action"
              :disabled="
                ui.busy ||
                !ui.updateAction(card) ||
                ui.updateAction(card).disabled ||
                ui.isUpdating(card)
              "
              :title="ui.updateAction(card)?.title || undefined"
              @click="ui.runUpdate(card)"
              >{{ ui.isUpdating(card) ? $t('ui.updating') : $t('taskCenter.table.updated') }}</VxButton
            >
          </div>
        </div>
        <section class="mm-detail-section" aria-labelledby="mm-detail-desc-title">
          <h3 id="mm-detail-desc-title">{{ $t('modBrowser.columnSummary') }}</h3>
          <p
            ref="descRef"
            class="mm-detail-desc"
            :class="{ 'is-clamped': !expanded.desc, 'is-empty': !card.description }"
          >
            {{ card.description || $t('ui.noDescriptionVariant2') }}
          </p>
          <button
            v-if="descClamped || expanded.desc"
            type="button"
            class="mm-link-button"
            :aria-expanded="expanded.desc"
            @click="expanded.desc = !expanded.desc"
          >
            {{ expanded.desc ? $t('tools.collapse') : $t('dialogs.vamDetail.expand') }}
          </button>
          <p v-if="displayNote" class="mm-detail-note" :class="`is-${card.noteTone || 'default'}`">
            {{ displayNote }}
          </p>
        </section>
        <section class="mm-detail-section" aria-labelledby="mm-detail-info-title">
          <h3 id="mm-detail-info-title">{{ $t('ui.informationVariant2') }}</h3>
          <dl class="mm-info-grid">
            <div v-for="item in info" :key="item.label">
              <dt>{{ item.label }}</dt>
              <dd :class="{ 'mm-mono': item.mono }" :title="String(item.value)">
                {{ item.value }}
              </dd>
            </div>
            <div class="mm-install-path">
              <dt>{{ $t('ui.installationLocation') }}</dt>
              <dd>
                <code v-if="path" :title="path">{{ path }}</code>
                <span v-else class="mm-muted">{{ $t('ui.thisInstallationRecordHasNoLocalPathToOpen') }}</span>
                <button
                  v-if="path"
                  type="button"
                  class="mm-icon-button is-small mm-copy-path"
                  :aria-label="copied ? $t('ui.installationLocationCopied') : $t('ui.copyInstallationLocation')"
                  :title="copied ? $t('ui.copiedVariant2') : $t('ui.copyInstallationLocation')"
                  :disabled="copyBusy"
                  @click="copyPath"
                >
                  <CheckOutlined v-if="copied" /><CopyOutlined v-else />
                </button>
              </dd>
            </div>
          </dl>
          <span class="mm-sr-only" aria-live="polite">{{ copied ? $t('ui.installationLocationCopiedVariant2') : '' }}</span>
        </section>
        <section class="mm-detail-section mm-relation-group" aria-labelledby="mm-detail-deps-title">
          <h3 id="mm-detail-deps-title">
            {{ $t('taskCenter.detail.dependency') }}<span class="mm-section-count">{{
              relationsKnown ? relations.dependencies?.length || 0 : '—'
            }}</span>
          </h3>
          <div v-if="relationsKnown && relations.dependencies?.length" class="mm-relations">
            <button
              v-for="item in relations.dependencies"
              :key="item.key"
              type="button"
              class="mm-relation-item"
              :disabled="!relationCard(item)"
              :title="relationTitle(item)"
              @click="visitRelation(item)"
            >
              <ModManagementIcon
                :src="item.logoUrl || ''"
                :name="item.title || ''"
                :size="20"
                class="mm-relation-cover"
              />
              <span class="mm-relation-name">{{ item.title }}</span>
              <span v-if="item.version" class="mm-relation-version mm-mono">{{
                item.version
              }}</span>
              <span class="mm-relation-status" :class="`is-${relationStatus(item)}`"
                ><i aria-hidden="true"></i>{{ RELATION_TEXT[relationStatus(item)] }}</span
              >
            </button>
          </div>
          <p v-else class="mm-section-empty">
            {{ relationsKnown ? $t('ui.noPrerequisites') : $t('ui.thisSourceDoesNotProvideDependencyInformation') }}
          </p>
        </section>
        <section
          class="mm-detail-section mm-relation-group"
          aria-labelledby="mm-detail-dependents-title"
        >
          <h3 id="mm-detail-dependents-title">
            {{ $t('ui.requiredByOtherMods') }}<span class="mm-section-count">{{
              relationsKnown ? dependents.length : '—'
            }}</span>
          </h3>
          <div v-if="enabledDependents.length" class="mm-inline-warning" role="status">
            <WarningOutlined aria-hidden="true" />
            <p>{{ $t('ui.afterDisablingOrDeletingTheFollowing') }} {{ enabledDependents.length }} {{ $t('ui.enabledModsWillNoLongerLoad') }}</p>
          </div>
          <div v-if="relationsKnown && dependents.length" class="mm-relations">
            <button
              v-for="item in visibleDependents"
              :key="item.key"
              type="button"
              class="mm-relation-item"
              :disabled="!relationCard(item)"
              :title="relationTitle(item)"
              @click="visitRelation(item)"
            >
              <ModManagementIcon
                :src="item.logoUrl || ''"
                :name="item.title || ''"
                :size="20"
                class="mm-relation-cover"
              />
              <span class="mm-relation-name">{{ item.title }}</span>
              <span v-if="item.version" class="mm-relation-version mm-mono">{{
                item.version
              }}</span>
              <span class="mm-relation-status" :class="`is-${relationStatus(item)}`"
                ><i aria-hidden="true"></i>{{ RELATION_TEXT[relationStatus(item)] }}</span
              >
            </button>
          </div>
          <p v-else class="mm-section-empty">
            {{ relationsKnown ? $t('ui.noOtherModsDependOnThisMod') : $t('ui.thisSourceDoesNotProvideDependencyInformation') }}
          </p>
          <button
            v-if="dependents.length > LIST_LIMIT"
            type="button"
            class="mm-link-button"
            :aria-expanded="expanded.dependents"
            @click="expanded.dependents = !expanded.dependents"
          >
            {{ expanded.dependents ? $t('tools.collapse') : $t('ui.showAllValue', { value1: (dependents.length) }) }}
          </button>
        </section>
        <section class="mm-detail-section mm-detail-files" aria-labelledby="mm-detail-files-title">
          <h3 id="mm-detail-files-title">
            {{ $t('tools.file') }}<span class="mm-section-count">{{ fileItems.length || fileCount }}</span>
          </h3>
          <ul v-if="fileItems.length" class="mm-file-list">
            <li v-for="file in visibleFiles" :key="file">
              <FileOutlined aria-hidden="true" /><code :title="file">{{ file }}</code>
            </li>
          </ul>
          <p v-else class="mm-section-empty">
            {{ Number(fileCount) === 0 ? $t('ui.thisModHasNoFileRecords') : $t('ui.thisSourceDoesNotProvideFileDetails') }}
          </p>
          <button
            v-if="fileItems.length > LIST_LIMIT"
            type="button"
            class="mm-link-button"
            :aria-expanded="expanded.files"
            @click="expanded.files = !expanded.files"
          >
            {{ expanded.files ? $t('tools.collapse') : $t('ui.showAllValueFiles', { value1: (fileItems.length) }) }}
          </button>
        </section>
      </div>
      <ModManagementMenu
        :open="more.open"
        :anchor="more.anchor"
        :items="menuItems"
        :label="$t('ui.moreActionsForValue', { value1: (card.title || $t('ui.mod')) })"
        menu-class="mm-detail-menu"
        @close="more.open = false"
        @select="runMenu"
      />
    </template>
  </aside>
</template>
