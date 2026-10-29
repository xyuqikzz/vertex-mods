<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import {
  formatInstallDate,
  formatInstallDateTime,
  formatInstallSize
} from '@views/game/component/install-confirm/install-confirm-format.js'

// 社区来源（GameBanana、Steam 创意工坊）的安装确认弹窗。
// 一次提交一个文件，提交参数与原来的 install.submit(detail, file, mode) 相同。
const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'install' },
  detail: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  source: { type: String, default: '' },
  sourceLabel: { type: String, default: '' },
  gameName: { type: String, default: '' },
  hasRule: { type: Boolean, default: false },
  canInstall: { type: Boolean, default: false },
  profileName: { type: String, default: '' }
})

const emit = defineEmits(['close', 'submit'])

const selectedId = ref('')
const isWorkshop = computed(() => props.source === 'steam-workshop')
const files = computed(() => (Array.isArray(props.detail?.files) ? props.detail.files : []))
const isInstall = computed(() => props.mode === 'install' && props.canInstall)

const columns = computed(() =>
  [
    isWorkshop.value
      ? { key: 'date', get label() { return uiText('ui.updatedOn') }, width: '96px', muted: true }
      : files.value.some((file) => String(file?.version || '').trim())
        ? { key: 'version', get label() { return uiText('tools.version') }, width: '88px' }
        : null,
    { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' }
  ].filter(Boolean)
)

const items = computed(() =>
  files.value.map((file) => {
    const size = Number(file?.size) || 0
    // Steam 的 version 是 time_updated（Unix 秒），按更新日期显示。
    const updatedAt = isWorkshop.value ? Number(file?.version) || 0 : 0
    return {
      key: String(file.id),
      title: String(file?.name || '--'),
      monoTitle: isWorkshop.value,
      history: !!file?.archived,
      tags: file?.archived ? [{ get text() { return uiText('ui.archived') }, tone: 'warning' }] : [],
      disabled: !!file?.blocked,
      disabledReason: file?.blocked ? '来源标记为不安全，不能下载' : '',
      sizeBytes: size,
      sizeText: formatInstallSize(size),
      values: {
        version: String(file?.version || '').trim(),
        date: updatedAt ? formatInstallDate(updatedAt) : '',
        dateTitle: updatedAt ? formatInstallDateTime(updatedAt) : '',
        size: formatInstallSize(size)
      }
    }
  })
)

const selectedFile = computed(
  () => files.value.find((file) => String(file.id) === selectedId.value && !file.blocked) || null
)

const meta = computed(() => [
  props.gameName,
  props.detail?.id ? { text: `${isWorkshop.value ? '物品 ID' : 'Mod ID'} ${props.detail.id}` } : ''
])

const target = computed(() => {
  const rows = [{ get label() { return uiText('taskCenter.table.game') }, value: props.gameName || '--' }]
  if (props.hasRule) {
    rows.push({
      get label() { return uiText('dialogs.configDetail.rules') },
      tag: props.canInstall
        ? { get text() { return uiText('ui.matched') }, tone: 'success' }
        : { get text() { return uiText('modBrowser.unidentified') }, tone: 'warning' }
    })
  } else {
    rows.push({ get label() { return uiText('dialogs.configDetail.rules') }, tag: { get text() { return uiText('dialogs.vamCookie.notSet') }, tone: 'warning' } })
  }
  if (props.profileName && props.canInstall) {
    rows.push({ get label() { return uiText('ui.configuration') }, value: props.profileName })
  }
  rows.push({
    get label() { return uiText('siteDetail.download.writeTo') },
    value: isInstall.value ? '按安装规则写入游戏目录' : '下载目录（不写入游戏）',
    small: true
  })
  return rows
})

const notice = computed(() => {
  if (props.error) return { tone: 'warning', text: props.error }
  if (!props.hasRule) {
    return { tone: 'warning', get text() { return uiText('ui.thisGameHasNoInstallationRulesYetFilesWillOnly') } }
  }
  if (!props.canInstall) {
    return {
      tone: 'warning',
      get text() { return uiText('ui.theGameFolderHasNotBeenDetectedFilesWillOnly') }
    }
  }
  return null
})

const total = computed(() => {
  if (!selectedFile.value) return { value: '—', note: '尚未选择文件' }
  return {
    value: formatInstallSize(selectedFile.value.size) || '大小未知',
    note: isInstall.value ? '1 个文件 · 安装后可在「模组管理」中停用或卸载' : '1 个文件 · 只下载'
  }
})

const actions = computed(() => {
  const disabled = !selectedFile.value
  if (!isInstall.value) {
    return [{ key: 'download', get label() { return uiText('tools.download') }, variant: 'primary', disabled, loading: props.busy }]
  }
  return [
    { key: 'download', get label() { return uiText('ui.downloadOnly') }, variant: 'secondary', disabled },
    { key: 'install', get label() { return uiText('modBrowser.install') }, variant: 'primary', disabled, loading: props.busy }
  ]
})

const footerHint = computed(() =>
  files.value.length && !selectedFile.value ? '请选择一个文件' : ''
)

function select(keys = []) {
  const id = String(keys[0] || '')
  if (files.value.some((file) => String(file.id) === id && !file.blocked)) selectedId.value = id
}

function submit(key) {
  if (!selectedFile.value || props.busy) return
  emit('submit', selectedFile.value, key === 'install' ? 'install' : 'download')
}

watch(
  () => [props.open, props.detail],
  () => {
    if (!props.open) return
    // 预选第一个可下载的当前文件（Steam 只有一个文件）。
    const first =
      files.value.find((file) => !file.blocked && !file.archived) ||
      files.value.find((file) => !file.blocked)
    selectedId.value = first ? String(first.id) : ''
  },
  { immediate: true }
)
</script>

<template>
  <InstallConfirmDialog
    :open="open"
    :mode="isInstall ? 'install' : 'download'"
    :title="detail?.name || $t('modBrowser.selectFile')"
    :icon-url="detail?.image || ''"
    :fallback-initial="detail?.name || sourceLabel"
    :source-label="sourceLabel"
    :meta="meta"
    :busy="busy"
    :empty-text="$t('ui.theAuthorHasNotProvidedADirectlyDownloadableFileCheck')"
    selection-type="single"
    :selection-title="$t('modBrowser.selectFile')"
    :selection-caption="isWorkshop ? $t('ui.steamWorkshopItemsHaveOnlyOneFile') : ''"
    :history-label="$t('ui.showOlderVersions')"
    :columns="columns"
    :items="items"
    :selected-keys="selectedId ? [selectedId] : []"
    :target="target"
    :notice="notice"
    :show-selected="false"
    :dependencies="{ state: 'ready', items: [], emptyText: $t('siteDetail.download.noDependencies') }"
    :total="total"
    :footer-hint="footerHint"
    :actions="actions"
    @update:selected-keys="select"
    @action="submit"
    @close="emit('close')"
  />
</template>
