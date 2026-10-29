<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import {
  formatInstallDate,
  formatInstallSize
} from '@views/game/component/install-confirm/install-confirm-format.js'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  errorText: {
    type: String,
    default: ''
  },
  modName: {
    type: String,
    default: ''
  },
  translatedModName: {
    type: String,
    default: ''
  },
  gameName: {
    type: String,
    default: ''
  },
  modId: {
    type: [String, Number],
    default: ''
  },
  groups: {
    type: Array,
    default: () => []
  },
  files: {
    type: Array,
    default: () => []
  },
  targetFileId: {
    type: [String, Number],
    default: ''
  },
  dependencySummary: {
    type: Object,
    default: null
  },
  canInstallByRule: {
    type: Boolean,
    default: false
  },
  installSubmitting: {
    type: Boolean,
    default: false
  },
  showOriginalText: {
    type: Boolean,
    default: true
  },
  translateLoading: {
    type: Boolean,
    default: false
  },
  translateDisabled: {
    type: Boolean,
    default: false
  },
  translateButtonText: {
    type: String,
    default: undefined
  },
  showTranslateButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'action', 'translate-list'])

const COLUMNS = Object.freeze([
  { key: 'version', get label() { return uiText('tools.version') }, width: '72px' },
  { key: 'size', get label() { return uiText('tools.size') }, width: '80px', align: 'right' },
  { key: 'date', get label() { return uiText('ui.uploadedOn') }, width: '88px', muted: true }
])

const activeGroupKey = ref('')
const selectedFileKeys = ref([])

const safeGroups = computed(() => (Array.isArray(props.groups) ? props.groups : []))
const visibleGroups = computed(() => safeGroups.value.filter((group) => !isHiddenGroup(group)))
const safeFiles = computed(() => (Array.isArray(props.files) ? props.files : []))
const allowedInlineDescriptionTags = new Set(['a', 'strong', 'em', 'b', 'i', 'u', 'code'])
const ignoredDescriptionTags = new Set(['script', 'style', 'iframe', 'object', 'embed'])

function escapeDescriptionHtml(text = '') {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeDescriptionText(text = '') {
  return escapeDescriptionHtml(text).replace(/\r\n|\r|\n/g, '<br />')
}

function sanitizeDescriptionHref(href = '') {
  const safeHref = String(href || '').trim()
  if (!safeHref) {
    return ''
  }
  if (/^(https?:)?\/\//i.test(safeHref) || /^mailto:/i.test(safeHref)) {
    return safeHref
  }
  return ''
}

function renderDescriptionNode(node) {
  if (!node) {
    return ''
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeDescriptionText(node.textContent || '')
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const tagName = String(node.nodeName || '')
    .trim()
    .toLowerCase()
  if (!tagName || ignoredDescriptionTags.has(tagName)) {
    return ''
  }

  const childrenHtml = Array.from(node.childNodes || [])
    .map((childNode) => renderDescriptionNode(childNode))
    .join('')

  if (tagName === 'br') {
    return '<br />'
  }

  if (tagName === 'li') {
    const itemContent = childrenHtml.trim()
    return itemContent ? `• ${itemContent}<br />` : ''
  }

  if (['p', 'div', 'section', 'article', 'blockquote', 'pre'].includes(tagName)) {
    const blockContent = childrenHtml.trim()
    return blockContent ? `${blockContent}<br />` : ''
  }

  if (['ul', 'ol'].includes(tagName)) {
    return childrenHtml
  }

  if (tagName === 'a') {
    const safeHref = sanitizeDescriptionHref(node.getAttribute('href'))
    if (!safeHref) {
      return childrenHtml
    }
    const linkContent = childrenHtml.trim() || escapeDescriptionHtml(safeHref)
    return `<a href="${escapeDescriptionHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${linkContent}</a>`
  }

  if (allowedInlineDescriptionTags.has(tagName)) {
    return `<${tagName}>${childrenHtml}</${tagName}>`
  }

  return childrenHtml
}

function formatFileDescriptionHtml(description = '') {
  const sourceText = String(description || '').trim()
  if (!sourceText) {
    return ''
  }

  if (typeof DOMParser === 'undefined') {
    return normalizeDescriptionText(sourceText)
  }

  const parser = new DOMParser()
  const documentNode = parser.parseFromString(`<div>${sourceText}</div>`, 'text/html')
  const container = documentNode.body.firstElementChild
  if (!container) {
    return normalizeDescriptionText(sourceText)
  }

  return Array.from(container.childNodes || [])
    .map((childNode) => renderDescriptionNode(childNode))
    .join('')
    .replace(/(?:<br \/>[\s\uFEFF]*){3,}/g, '<br /><br />')
    .replace(/^(?:<br \/>[\s\uFEFF]*)+|(?:[\s\uFEFF]*<br \/>)$/g, '')
}

// 文件描述 Map（从 files prop 中提取，用于在 groups 的 items 中查找描述）
const fileDescriptionHtmlMap = computed(() => {
  const map = new Map()
  for (const file of safeFiles.value) {
    const desc = String(file?.translatedDescription || file?.description || '').trim()
    if (desc) {
      map.set(file.fileId || file.id, formatFileDescriptionHtml(desc))
    }
  }
  return map
})

function resolveFileDescriptionHtml(file = {}) {
  const fileKey = file.fileId || file.id
  const cachedDescription = fileDescriptionHtmlMap.value.get(fileKey)
  if (cachedDescription) {
    return cachedDescription
  }
  const desc = String(file?.translatedDescription || file?.description || '').trim()
  return desc ? formatFileDescriptionHtml(desc) : ''
}
const safeErrorText = computed(() => String(props.errorText || '').trim())

const displayModName = computed(() => {
  const translated = String(props.translatedModName || '').trim()
  return translated || String(props.modName || '').trim() || '--'
})
const originalModName = computed(() => {
  const original = String(props.modName || '').trim()
  const translated = String(props.translatedModName || '').trim()
  return props.showOriginalText && translated && original && translated !== original ? original : ''
})
const headerMeta = computed(() => [
  props.gameName || '',
  props.modId && props.modId !== '--' ? { text: `Mod ID ${props.modId}` } : ''
])

const dialogGroups = computed(() =>
  visibleGroups.value.map((group) => ({
    key: String(group?.key || ''),
    label: String(group?.label || uiText('ui.unknownCategory'))
  }))
)
const dialogItems = computed(() =>
  visibleGroups.value.flatMap((group) =>
    (Array.isArray(group?.items) ? group.items : []).map((file) => {
      const sizeBytes = Number(file?.raw?.size_kb || 0) * 1024
      const sizeText = formatInstallSize(sizeBytes)
      const uploadedAt = Number(file?.uploadedTimestamp || 0)
      return {
        key: resolveFileSelectionKey(file),
        group: String(group?.key || ''),
        title: resolveDisplayFileName(file),
        originalTitle: shouldShowOriginalFileName(file) ? file.name : '',
        descriptionHtml: resolveFileDescriptionHtml(file),
        tags: [
          file?.isPrimary ? { get text() { return uiText('tools.recommended') }, tone: 'accent' } : null,
          file?.isInstalled ? { get text() { return uiText('tools.installed') }, tone: 'success' } : null
        ].filter(Boolean),
        sizeBytes,
        sizeText,
        values: {
          version: String(file?.version || '').trim() || '未标注',
          size: sizeText,
          date: uploadedAt ? formatInstallDate(uploadedAt) : '',
          dateTitle: uploadedAt ? String(file?.uploadedText || '') : ''
        }
      }
    })
  )
)

const selectedFileKeySet = computed(() => new Set(selectedFileKeys.value))
const selectedFiles = computed(() => {
  const keySet = selectedFileKeySet.value
  return safeFiles.value.filter((file) => keySet.has(resolveFileSelectionKey(file)))
})
const selectedFileCount = computed(() => selectedFiles.value.length)
const canSubmitSelection = computed(
  () => !props.loading && !props.installSubmitting && selectedFileCount.value > 0
)

const dependencyItems = computed(() => {
  const summary =
    props.dependencySummary && typeof props.dependencySummary === 'object'
      ? props.dependencySummary
      : {}
  const list = (value) => (Array.isArray(value) ? value : [])
  return [
    ...list(summary.defaultDependencies).map((item, index) => {
      const pending = String(item?.resolutionState || '').trim() === 'pending'
      return {
        key: `default-${String(item?.sourceModKey || item?.id || item?.key || index)}`,
        name: resolveDefaultDependencyPreviewName(item, index),
        kind: '默认依赖',
        meta: [item?.sourceText, item?.providerText]
          .map((text) => String(text || '').trim())
          .filter(Boolean)
          .join(' · '),
        note: String(item?.notes || '').trim(),
        status: item?.installed ? 'installed' : pending ? 'resolving' : 'install',
        statusText: item?.installed ? uiText('tools.installed') : pending ? uiText('ui.awaitingResolution') : uiText('ui.handleDuringInstallation')
      }
    }),
    ...list(summary.pendingDependencies).map((item, index) => {
      const external = isExternalDependency(item)
      return {
        key: `dependency-${String(item?.modId || item?.id || index)}`,
        name: resolveDependencyPreviewName(item, index),
        meta: buildDependencyPreviewMeta(item),
        note: external ? '站外依赖，无法自动下载，请先手动安装。' : '',
        status: external ? 'manual' : 'install',
        statusText: external ? uiText('ui.manualHandlingRequired') : uiText('ui.handleDuringInstallation')
      }
    }),
    ...list(summary.dlcRequirements).map((item, index) => ({
      key: `dlc-${String(item?.appId || item?.id || index)}`,
      name: resolveDlcPreviewName(item, index),
      kind: 'DLC',
      meta: buildDlcPreviewMeta(item),
      status: 'dlc',
      get statusText() { return uiText('ui.ownershipRequired') }
    }))
  ]
})
const dependencyPlan = computed(() => {
  const items = dependencyItems.value
  const manual = items.filter((item) => item.status === 'manual').length
  const pending = items.filter((item) =>
    ['install', 'resolving', 'dlc'].includes(item.status)
  ).length
  let summary = null
  if (manual) summary = { text: uiText('ui.valueItemsRequireManualSteps', { value1: (manual) }), tone: 'warning' }
  else if (items.length && !pending) summary = { get text() { return uiText('ui.allRequirementsMet') }, tone: 'success' }
  else if (pending) summary = { text: uiText('ui.valueItemsWillBeHandledDuringInstallation', { value1: (pending) }), tone: 'muted' }
  return {
    state: props.loading ? 'resolving' : 'ready',
    items,
    summary,
    get emptyText() { return uiText('ui.noPrerequisitesWereDeclaredAndNoDefaultDependenciesAreConfigured') }
  }
})

const totalBytes = computed(() =>
  dialogItems.value
    .filter((item) => selectedFileKeySet.value.has(item.key))
    .reduce((sum, item) => sum + (item.sizeBytes || 0), 0)
)
const dialogTotal = computed(() => {
  if (!selectedFileCount.value) {
    return { value: '—', note: '尚未选择文件' }
  }
  const manual = dependencyItems.value.some((item) => item.status === 'manual')
  const notes = [uiText('ui.valueFiles', { value1: (selectedFileCount.value) })]
  if (dependencyItems.value.length)
    notes.push(manual ? '含需手动处理的依赖' : '依赖大小以安装时为准')
  return { value: formatInstallSize(totalBytes.value) || '—', note: notes.join(' · ') }
})

const dialogTarget = computed(() => [
  { get label() { return uiText('taskCenter.table.game') }, value: props.gameName || '--' },
  {
    get label() { return uiText('dialogs.configDetail.rules') },
    tag: props.canInstallByRule
      ? { get text() { return uiText('ui.matched') }, tone: 'success' }
      : { get text() { return uiText('dialogs.vamCookie.notSet') }, tone: 'warning' }
  },
  {
    get label() { return uiText('siteDetail.download.writeTo') },
    value: props.canInstallByRule ? '按安装规则写入游戏目录' : '下载目录（不写入游戏）',
    small: true
  }
])
const dialogNotice = computed(() =>
  props.canInstallByRule
    ? null
    : {
        tone: 'warning',
        get text() { return uiText('ui.noInstallationRulesMatchThisGameYetSelectedFilesWill') }
      }
)

const dialogTool = computed(() => {
  if (!props.showTranslateButton) return null
  if (props.translateLoading) return { get label() { return uiText('ui.translatingFileList') }, loading: true }
  return {
    label: (props.translateButtonText ?? uiText('ui.translateCurrentFileList')) || uiText('ui.translateCurrentFileList'),
    disabled: props.translateDisabled
  }
})

const dialogActions = computed(() => {
  const count = selectedFileCount.value
  const disabled = !canSubmitSelection.value
  if (!props.canInstallByRule) {
    return [
      {
        key: 'download',
        label: count ? uiText('ui.downloadValueFiles', { value1: (count) }) : uiText('tools.download'),
        variant: 'primary',
        disabled,
        loading: props.installSubmitting
      }
    ]
  }
  return [
    { key: 'download', get label() { return uiText('ui.downloadOnly') }, variant: 'secondary', disabled },
    {
      key: 'install',
      label: count ? uiText('ui.installValueFiles', { value1: (count) }) : uiText('modBrowser.install'),
      variant: 'primary',
      disabled,
      loading: props.installSubmitting
    }
  ]
})
const footerHint = computed(() =>
  !props.loading && safeFiles.value.length && !selectedFileCount.value ? '至少选择一个文件' : ''
)

function isHiddenGroup(group = {}) {
  const key = String(group?.key || '')
    .trim()
    .toUpperCase()
  const label = String(group?.label || '').trim()
  return (
    key === 'DELETED' ||
    key === 'OLD_VERSION' ||
    key === 'ARCHIVED' ||
    label === '已删除' ||
    label === '旧版本' ||
    label === '已归档文件'
  )
}

function isExternalDependency(item = {}) {
  const dependencyType = String(item?.dependencyType || item?.sourceType || '')
    .trim()
    .toLowerCase()
  return (
    dependencyType === 'external' || (!!item?.externalRequirement && dependencyType !== 'nexus')
  )
}

function resolveDefaultDependencyPreviewName(item = {}, index = 0) {
  const name = String(item?.name || item?.displayName || item?.id || '').trim()
  return name || uiText('ui.defaultDependencyValue', { value1: (index + 1) })
}

function resolveDependencyPreviewName(item = {}, index = 0) {
  const name = String(item?.name || item?.modName || item?.title || item?.displayName || '').trim()
  const modId = String(item?.modId || item?.id || '').trim()
  return name || (modId ? uiText('ui.nexusDependencyValue', { value1: (modId) }) : uiText('ui.dependencyValueVariant2', { value1: (index + 1) }))
}

function resolveDependencySourceText(item = {}) {
  const explicitSourceText = String(item?.sourceText || '').trim()
  if (explicitSourceText) {
    return explicitSourceText
  }
  if (isExternalDependency(item)) {
    return uiText('ui.externalDependency')
  }
  return 'Nexus'
}

function buildDependencyPreviewMeta(item = {}) {
  const metaList = []
  const sourceText = resolveDependencySourceText(item)
  const domainName = String(item?.domainName || '').trim()
  const modId = String(item?.modId || item?.id || '').trim()
  const fileId = String(item?.fileId || item?.file_id || '').trim()

  if (sourceText) {
    metaList.push(sourceText)
  }
  if (domainName) {
    metaList.push(domainName)
  }
  if (modId) {
    metaList.push(`Mod ID ${modId}`)
  }
  if (fileId) {
    metaList.push(`File ID ${fileId}`)
  }

  return metaList.join(' · ') || 'Nexus 依赖'
}

function resolveDlcPreviewName(item = {}, index = 0) {
  const name = String(item?.name || item?.title || item?.displayName || '').trim()
  return name || uiText('ui.dLCRequirementValue', { value1: (index + 1) })
}

function buildDlcPreviewMeta(item = {}) {
  const metaList = []
  const appId = String(item?.appId || item?.steamAppId || item?.id || '').trim()
  const url = String(item?.url || '').trim()

  if (appId) {
    metaList.push(`App ID ${appId}`)
  }
  if (url) {
    metaList.push('需要确认购买状态')
  }

  return metaList.join(' · ') || '游戏 DLC 要求'
}

function resolveDisplayFileName(file = {}) {
  const translated = String(file?.translatedName || '').trim()
  return translated || String(file?.name || '').trim() || '--'
}

function resolveFileSelectionKey(file = {}) {
  return String(file?.fileId || file?.id || file?.file_id || file?.name || '').trim()
}

function shouldShowOriginalFileName(file = {}) {
  const original = String(file?.name || '').trim()
  const translated = String(file?.translatedName || '').trim()
  return !!(props.showOriginalText && translated && original && translated !== original)
}

function clonePlainPayload(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function setSelectedKeys(keys = []) {
  if (props.installSubmitting) return
  const validKeys = new Set(safeFiles.value.map((file) => resolveFileSelectionKey(file)))
  selectedFileKeys.value = keys.map((key) => String(key)).filter((key) => validKeys.has(key))
}

function emitClose() {
  if (props.loading) {
    return
  }
  emit('close')
}

function handleAction(key) {
  if (!canSubmitSelection.value) {
    return
  }
  const actionMode = key === 'download' ? 'download' : 'install'
  emit('action', {
    files: clonePlainPayload(selectedFiles.value),
    actionMode,
    includeDependencies: actionMode === 'install',
    dependencyStrategyConfirmed: true
  })
}

function emitTranslateList() {
  if (props.translateLoading || props.translateDisabled || props.loading) {
    return
  }
  const activeGroup =
    visibleGroups.value.find((group) => String(group?.key || '') === activeGroupKey.value) ||
    visibleGroups.value[0] ||
    null
  emit('translate-list', {
    groupKey: String(activeGroup?.key || '').trim(),
    groupLabel: String(activeGroup?.label || '').trim(),
    files: Array.isArray(activeGroup?.items) ? activeGroup.items : []
  })
}

watch(
  () =>
    [
      props.open ? '1' : '0',
      visibleGroups.value.map((group) => String(group?.key || '')).join('|')
    ].join('::'),
  () => {
    if (!props.open) {
      activeGroupKey.value = ''
      return
    }
    const currentKey = String(activeGroupKey.value || '').trim()
    if (
      !currentKey ||
      !visibleGroups.value.some((group) => String(group?.key || '') === currentKey)
    ) {
      activeGroupKey.value = String(visibleGroups.value[0]?.key || '').trim()
    }
  },
  { immediate: true }
)

watch(
  () =>
    [
      props.open ? '1' : '0',
      safeFiles.value.map((file) => resolveFileSelectionKey(file)).join('|'),
      String(props.targetFileId || '').trim()
    ].join('::'),
  () => {
    if (!props.open) {
      selectedFileKeys.value = []
      return
    }
    const validKeySet = new Set(safeFiles.value.map((file) => resolveFileSelectionKey(file)))
    const targetKey = String(props.targetFileId || '').trim()
    if (targetKey && validKeySet.has(targetKey)) {
      selectedFileKeys.value = [targetKey]
      return
    }
    selectedFileKeys.value = selectedFileKeys.value.filter((key) => validKeySet.has(key))
  },
  { immediate: true }
)
</script>

<template>
  <InstallConfirmDialog
    :open="open"
    :mode="canInstallByRule ? 'install' : 'download'"
    :title="displayModName"
    :original-title="originalModName"
    :fallback-initial="displayModName"
    source-label="Nexus Mods"
    :meta="headerMeta"
    :loading="loading"
    :loading-text="$t('ui.fetchingFilesFromNexus')"
    :error-text="safeErrorText"
    :busy="installSubmitting"
    selection-type="multi"
    :groups="dialogGroups"
    :active-group="activeGroupKey"
    :columns="COLUMNS"
    :items="dialogItems"
    :selected-keys="selectedFileKeys"
    :target="dialogTarget"
    :notice="dialogNotice"
    :dependencies="dependencyPlan"
    :total="dialogTotal"
    :tool="dialogTool"
    :footer-hint="footerHint"
    :actions="dialogActions"
    @update:active-group="activeGroupKey = $event"
    @update:selected-keys="setSelectedKeys"
    @action="handleAction"
    @tool="emitTranslateList"
    @close="emitClose"
  />
</template>
