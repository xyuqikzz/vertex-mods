<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, onActivated, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal, VxSegmented, VxSelect } from '@renderer/component/vertex-ui'
import {
  ToolEmpty,
  ToolFilterPills,
  ToolIcon,
  ToolIconButton,
  ToolNotice,
  ToolSearchField,
  coverMonogram,
  coverPlaceholderTone
} from '@renderer/component/tool-page'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { getCommunityDetailWithCover } from '@renderer/utils/community-api.js'
import { readSourceProfiles } from '@renderer/utils/source-profile-registry.js'
import ConfigEntryRow from './config/ConfigEntryRow.vue'
import ConfigFileList from './config/ConfigFileList.vue'
import ConfigRawEditor from './config/ConfigRawEditor.vue'
import {
  classifyConfigFile,
  collectChangedLineNumbers,
  diffConfigDocuments,
  getConfigFileBaseName,
  getConfigFileExtension,
  getConfigFileName,
  isSameConfigValue,
  isStructuredConfigPath,
  matchesConfigFileKeyword,
  normalizeConfigPath,
  parseConfigDocument,
  setConfigEntryValue,
  validateConfigEntryValue
} from './config/cfg-document.js'

// Thunderstore 配置编辑器（方案 A）：左侧文件列表，右侧一个文件的全部配置连续排列，底部固定保存栏。
// 每个文件的未保存修改各自保留；表单修改只替换改过的那一行。
// 规格见 Vertex 项目文档《Thunderstore 配置编辑器 UI 重设计方案》。
const route = useRoute()
const router = useRouter()
const { setMenuName: setPageMenuName } = useMenuName()

const DEFAULT_PROFILE_NAME = 'default'
const HEADER_READ_CONCURRENCY = 4
const GROUP_META = Object.freeze([
  { key: 'mods', get label() { return uiText('ui.mod') } },
  { key: 'loader', get label() { return uiText('tools.loader') } },
  { key: 'other', get label() { return uiText('ui.otherFiles') }, collapsible: true }
])
const MODE_OPTIONS = Object.freeze([
  { get label() { return uiText('ui.forms') }, value: 'form' },
  { get label() { return uiText('modBrowser.originalText') }, value: 'raw' }
])

const communityInfo = ref({ identifier: '', name: '', iconUrl: '' })
const profileName = ref(DEFAULT_PROFILE_NAME)
const files = ref([])
const headerInfo = ref({})
// relativePath -> { originalText, text, updatedAt }
const buffers = ref({})
const savedPaths = ref({})
const selectedPath = ref('')
const fileKeyword = ref('')
const entryKeyword = ref('')
const entryFilter = ref('all')
const preferredMode = ref('form')
const listLoading = ref(false)
const listError = ref('')
const fileLoading = ref(false)
const fileError = ref('')
const saving = ref(false)
const saveError = ref('')
const conflictPath = ref('')
const changesOpen = ref(false)
const activeSectionId = ref('')
const contentRef = ref(null)
const titleRef = ref(null)
const changesRef = ref(null)
let bootstrapToken = 0

const communityIdentifier = computed(() =>
  String(route.params.id || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
)
const packageKeyword = computed(() => String(route.query.package || '').trim())
const communityName = computed(
  () => communityInfo.value.name || communityIdentifier.value || 'Thunderstore'
)

// ===== 确认弹窗（VxConfirmModal 的 Promise 封装）：结果为 confirm / cancel / 额外按钮的 key =====
const dialog = ref(createDialogState())
let dialogResolver = null

function createDialogState() {
  return {
    open: false,
    title: '',
    content: '',
    get confirmText() { return uiText('ui.confirm') },
    get cancelText() { return uiText('ui.cancel') },
    danger: false,
    actions: [],
    items: []
  }
}

function askDialog(options = {}) {
  settleDialog('cancel')
  return new Promise((resolve) => {
    dialogResolver = resolve
    dialog.value = { ...createDialogState(), ...options, open: true }
  })
}

function settleDialog(result) {
  const resolve = dialogResolver
  dialogResolver = null
  resolve?.(result)
}

// ===== 文件列表 =====
function toFileRecord(item = {}) {
  const relativePath = normalizeConfigPath(item.relativePath)
  return {
    relativePath,
    fileName: String(item.fileName || getConfigFileName(relativePath)),
    size: Number(item.size || 0),
    updatedAt: String(item.updatedAt || ''),
    kind: classifyConfigFile(relativePath)
  }
}

const fileRecords = computed(() =>
  files.value.map((file) => {
    const header = headerInfo.value[file.relativePath] || {}
    const buffer = buffers.value[file.relativePath]
    return {
      ...file,
      displayName:
        header.pluginName ||
        (file.kind === 'other' ? file.fileName : getConfigFileBaseName(file.relativePath)),
      version: header.version || '',
      guid: header.guid || '',
      subtitle: file.kind === 'other' ? file.relativePath : file.fileName,
      dirty: Boolean(buffer && buffer.text !== buffer.originalText)
    }
  })
)

function sortRecords(list) {
  return [...list].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, 'zh-CN', { sensitivity: 'base' }) ||
      a.relativePath.localeCompare(b.relativePath)
  )
}

const packageMatches = computed(() =>
  packageKeyword.value
    ? fileRecords.value.filter(
        (file) => file.kind !== 'other' && matchesConfigFileKeyword(file, packageKeyword.value)
      )
    : []
)

const fileGroups = computed(() => {
  const keyword = fileKeyword.value.trim()
  const matchedPaths = new Set(packageMatches.value.map((file) => file.relativePath))
  const filter = (list) =>
    sortRecords(list.filter((file) => matchesConfigFileKeyword(file, keyword)))
  const groups = []
  if (packageMatches.value.length) {
    groups.push({
      key: 'match',
      label: uiText('ui.matchesValue', { value1: (packageKeyword.value) }),
      items: filter(packageMatches.value)
    })
  }
  for (const meta of GROUP_META) {
    groups.push({
      ...meta,
      items: filter(
        fileRecords.value.filter(
          (file) => file.kind === meta.key && !matchedPaths.has(file.relativePath)
        )
      )
    })
  }
  return groups.filter((group) => group.items.length > 0)
})

const packageNotice = computed(() => {
  if (!packageKeyword.value || listLoading.value || !files.value.length) return null
  if (packageMatches.value.length) return null
  return {
    title: uiText('ui.noConfigurationFilesFoundForValue', { value1: (packageKeyword.value) }),
    get text() { return uiText('ui.modsCreateConfigurationFilesAfterTheirFirstGameLaunchAll') }
  }
})

const dirtyPaths = computed(() =>
  fileRecords.value.filter((file) => file.dirty).map((file) => file.relativePath)
)

const profileOptions = computed(() => {
  const record = readSourceProfiles('thunderstore', communityIdentifier.value)
  const list = Array.isArray(record?.list) ? [...record.list] : []
  if (!list.some((item) => item.toLowerCase() === profileName.value.toLowerCase())) {
    list.unshift(profileName.value)
  }
  return list.map((item) => ({ label: item, value: item }))
})

// ===== 当前文件 =====
const currentRecord = computed(
  () => fileRecords.value.find((file) => file.relativePath === selectedPath.value) || null
)
const currentBuffer = computed(() => buffers.value[selectedPath.value] || null)
const originalDoc = computed(() =>
  currentBuffer.value
    ? parseConfigDocument(currentBuffer.value.originalText, selectedPath.value)
    : null
)
const currentDoc = computed(() =>
  currentBuffer.value ? parseConfigDocument(currentBuffer.value.text, selectedPath.value) : null
)
const canUseForm = computed(
  () => isStructuredConfigPath(selectedPath.value) && Boolean(currentDoc.value?.structured)
)
const viewMode = computed(() => (canUseForm.value ? preferredMode.value : 'raw'))
const isDirty = computed(() =>
  Boolean(currentBuffer.value && currentBuffer.value.text !== currentBuffer.value.originalText)
)

const changes = computed(() =>
  originalDoc.value?.structured && currentDoc.value?.structured
    ? diffConfigDocuments(originalDoc.value, currentDoc.value)
    : []
)
const changedIds = computed(() => new Set(changes.value.map((change) => change.id)))
const changedLines = computed(() => collectChangedLineNumbers(changes.value))
const originalValues = computed(
  () => new Map((originalDoc.value?.entries || []).map((entry) => [entry.id, entry.value]))
)

const entryStates = computed(() => {
  const states = new Map()
  if (!currentDoc.value?.structured) return states
  for (const entry of currentDoc.value.entries) {
    const modified = changedIds.value.has(entry.id)
    const differs =
      entry.defaultValue !== undefined && !isSameConfigValue(entry, entry.value, entry.defaultValue)
    states.set(entry.id, {
      modified,
      differs,
      canReset: !modified && differs,
      error: validateConfigEntryValue(entry, entry.value)
    })
  }
  return states
})

const errorCount = computed(() => {
  let count = 0
  for (const state of entryStates.value.values()) if (state.error) count++
  return count
})

const jsonError = computed(() => {
  if (getConfigFileExtension(selectedPath.value) !== '.json' || !currentBuffer.value) return ''
  const text = currentBuffer.value.text
  if (!text.trim()) return ''
  try {
    JSON.parse(text)
    return ''
  } catch (error) {
    return String(error?.message || uiText('ui.couldNotParseJSON'))
  }
})

const filterOptions = computed(() => {
  let differs = 0
  for (const state of entryStates.value.values()) if (state.differs) differs++
  return [
    { value: 'all', get label() { return uiText('tools.all') }, count: currentDoc.value?.entries.length || 0 },
    { value: 'modified', get label() { return uiText('ui.modified') }, count: changes.value.length },
    { value: 'differs', get label() { return uiText('ui.differentFromDefault') }, count: differs }
  ]
})

const visibleSections = computed(() => {
  if (!currentDoc.value?.structured) return []
  const keyword = entryKeyword.value.trim().toLowerCase()
  return currentDoc.value.sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => {
        const state = entryStates.value.get(entry.id)
        if (entryFilter.value === 'modified' && !state?.modified) return false
        if (entryFilter.value === 'differs' && !state?.differs) return false
        if (!keyword) return true
        return `${entry.key}\n${entry.description}`.toLowerCase().includes(keyword)
      })
    }))
    .filter((section) => section.entries.length > 0)
})

const rawLanguage = computed(() => {
  const ext = getConfigFileExtension(selectedPath.value)
  if (ext === '.cfg' || ext === '.ini') return 'ini'
  if (ext === '.json') return 'json'
  return 'plain'
})

const rawNotice = computed(() => {
  if (canUseForm.value || !currentDoc.value) return ''
  if (currentDoc.value.reason === 'unparsed') {
    return uiText('ui.lineValueCouldNotBeRecognizedEditItInSource', { value1: (currentDoc.value.unparsedLine) })
  }
  return '这个文件不是 .cfg / .ini 格式，只能编辑原文。'
})

const fileMetaText = computed(() => {
  const record = currentRecord.value
  if (!record) return ''
  const parts = [formatFileSize(record.size)]
  parts.push(
    savedPaths.value[record.relativePath]
      ? '刚刚保存'
      : uiText('ui.modifiedValue', { value1: (formatDateTime(record.updatedAt)) })
  )
  return parts.join(' · ')
})

const otherDirtyCount = computed(
  () => dirtyPaths.value.filter((path) => path !== selectedPath.value).length
)

const footerState = computed(() => {
  if (errorCount.value > 0) return 'error'
  if (isDirty.value) return 'dirty'
  return 'clean'
})

const canSave = computed(
  () => isDirty.value && errorCount.value === 0 && !saving.value && !fileLoading.value
)

// ===== 读取 =====
function formatFileSize(bytes) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return uiText('ui.unknownTime')
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function describeValue(value) {
  if (value === undefined) return '（新增）'
  return value === '' ? '（空）' : value
}

async function fetchFileList() {
  const result = await ipcRenderer.invoke('thunderstoreGetConfigFiles', {
    community: communityIdentifier.value,
    profileName: profileName.value
  })
  const records = (Array.isArray(result?.files) ? result.files : [])
    .map(toFileRecord)
    .filter((file) => file.relativePath)
  files.value = records
  return records
}

async function readFile(relativePath) {
  const token = bootstrapToken
  fileLoading.value = true
  fileError.value = ''
  try {
    const result = await ipcRenderer.invoke('thunderstoreReadConfigFile', {
      community: communityIdentifier.value,
      profileName: profileName.value,
      relativePath
    })
    if (token !== bootstrapToken) return
    const text = String(result?.content ?? '')
    const record = files.value.find((file) => file.relativePath === relativePath)
    buffers.value[relativePath] = {
      originalText: text,
      text,
      updatedAt: record?.updatedAt || ''
    }
    rememberHeader(relativePath, text)
    if (conflictPath.value === relativePath) conflictPath.value = ''
  } catch (error) {
    if (token !== bootstrapToken) return
    console.error('读取配置文件失败', error)
    if (selectedPath.value === relativePath) {
      fileError.value = uiText('ui.couldNotReadConfigurationFileValue', { value1: (error?.message || relativePath) })
    }
  } finally {
    if (token === bootstrapToken) fileLoading.value = false
  }
}

function rememberHeader(relativePath, text) {
  if (getConfigFileExtension(relativePath) !== '.cfg') return
  const { metadata } = parseConfigDocument(text, relativePath)
  headerInfo.value = { ...headerInfo.value, [relativePath]: metadata }
}

// 列表里显示插件名：后台读一遍 .cfg 文件头（只用来取名称和版本，不当作草稿）。
async function loadHeaders(token) {
  const queue = files.value
    .filter(
      (file) =>
        getConfigFileExtension(file.relativePath) === '.cfg' && !headerInfo.value[file.relativePath]
    )
    .map((file) => file.relativePath)
  const worker = async () => {
    while (queue.length && token === bootstrapToken) {
      const relativePath = queue.shift()
      try {
        const result = await ipcRenderer.invoke('thunderstoreReadConfigFile', {
          community: communityIdentifier.value,
          profileName: profileName.value,
          relativePath
        })
        if (token === bootstrapToken) rememberHeader(relativePath, String(result?.content ?? ''))
      } catch {
        // 读不到文件头时列表退回显示文件名。
      }
    }
  }
  await Promise.all(Array.from({ length: HEADER_READ_CONCURRENCY }, worker))
}

async function loadCommunityInfo(identifier) {
  try {
    const hit = await getCommunityDetailWithCover(identifier)
    communityInfo.value = {
      identifier: String(hit?.identifier || identifier),
      name: String(hit?.name || hit?.identifier || identifier),
      iconUrl: String(hit?.icon_url || '')
    }
  } catch {
    communityInfo.value = { identifier, name: identifier, iconUrl: '' }
  }
}

function resolveRouteSelection(records) {
  const queryFile = normalizeConfigPath(route.query.file)
  if (queryFile && records.some((file) => file.relativePath === queryFile)) return queryFile
  const match = sortRecords(packageMatches.value)[0]
  if (match) return match.relativePath
  if (selectedPath.value && records.some((file) => file.relativePath === selectedPath.value)) {
    return selectedPath.value
  }
  const first = fileGroups.value[0]?.items[0]
  return first?.relativePath || ''
}

async function bootstrapPage() {
  if (!communityIdentifier.value) return
  const token = ++bootstrapToken
  profileName.value =
    String(route.query.profile || DEFAULT_PROFILE_NAME).trim() || DEFAULT_PROFILE_NAME
  files.value = []
  headerInfo.value = {}
  buffers.value = {}
  savedPaths.value = {}
  selectedPath.value = ''
  conflictPath.value = ''
  saveError.value = ''
  fileError.value = ''
  listError.value = ''
  fileLoading.value = false
  listLoading.value = true
  loadCommunityInfo(communityIdentifier.value)
  try {
    const records = await fetchFileList()
    if (token !== bootstrapToken) return
    listLoading.value = false
    const initial = resolveRouteSelection(records)
    if (initial) await selectFile(initial, { focus: false })
    loadHeaders(token)
  } catch (error) {
    if (token !== bootstrapToken) return
    console.error('读取配置文件列表失败', error)
    listError.value = error?.message || '请稍后重试'
    listLoading.value = false
  }
}

async function refreshList() {
  if (listLoading.value) return
  const token = bootstrapToken
  listLoading.value = true
  listError.value = ''
  try {
    const records = await fetchFileList()
    if (token !== bootstrapToken) return
    const existing = new Set(records.map((file) => file.relativePath))
    const nextBuffers = {}
    for (const [path, buffer] of Object.entries(buffers.value)) {
      if (existing.has(path) || buffer.text !== buffer.originalText) nextBuffers[path] = buffer
    }
    buffers.value = nextBuffers
    if (!selectedPath.value || !existing.has(selectedPath.value)) {
      selectedPath.value = ''
      const next = resolveRouteSelection(records)
      if (next) await selectFile(next, { focus: false })
    } else {
      syncCurrentWithDisk(records)
    }
    loadHeaders(token)
  } catch (error) {
    console.error('刷新配置文件列表失败', error)
    listError.value = error?.message || '请稍后重试'
  } finally {
    if (token === bootstrapToken) listLoading.value = false
  }
}

// 磁盘上的文件比打开时新：没改过就直接重新读，改过就提示冲突。
function syncCurrentWithDisk(records) {
  const path = selectedPath.value
  const buffer = buffers.value[path]
  const record = records.find((file) => file.relativePath === path)
  if (!buffer || !record || !buffer.updatedAt || !record.updatedAt) return
  if (record.updatedAt === buffer.updatedAt) return
  if (buffer.text === buffer.originalText) {
    readFile(path)
  } else {
    conflictPath.value = path
  }
}

async function selectFile(relativePath, { focus = true } = {}) {
  const path = normalizeConfigPath(relativePath)
  if (!path) return
  const switching = path !== selectedPath.value
  selectedPath.value = path
  changesOpen.value = false
  saveError.value = ''
  fileError.value = ''
  if (switching) {
    entryKeyword.value = ''
    entryFilter.value = 'all'
    activeSectionId.value = ''
  }
  const buffer = buffers.value[path]
  if (!buffer || buffer.text === buffer.originalText) await readFile(path)
  await nextTick()
  if (switching && contentRef.value) contentRef.value.scrollTop = 0
  if (focus) titleRef.value?.focus?.()
}

// ===== 编辑 =====
function updateEntry(entry, value) {
  const buffer = currentBuffer.value
  if (!buffer || !entry) return
  buffer.text = setConfigEntryValue(buffer.text, entry, value)
  clearSavedMark(selectedPath.value)
}

function undoEntry(entry) {
  const original = originalValues.value.get(entry.id)
  if (original !== undefined) updateEntry(entry, original)
}

function resetEntry(entry) {
  if (entry.defaultValue !== undefined) updateEntry(entry, entry.defaultValue)
}

function updateRawText(text) {
  const buffer = currentBuffer.value
  if (!buffer || buffer.text === text) return
  buffer.text = text
  clearSavedMark(selectedPath.value)
}

function clearSavedMark(path) {
  if (!savedPaths.value[path]) return
  const next = { ...savedPaths.value }
  delete next[path]
  savedPaths.value = next
}

function discardCurrent() {
  const buffer = currentBuffer.value
  if (!buffer) return
  buffer.text = buffer.originalText
  changesOpen.value = false
  saveError.value = ''
}

function undoAllChanges() {
  discardCurrent()
}

function selectMode(mode) {
  preferredMode.value = mode === 'raw' ? 'raw' : 'form'
}

function clearEntryFilter() {
  entryKeyword.value = ''
  entryFilter.value = 'all'
}

// ===== 保存 =====
async function writeFile(path, { force = false } = {}) {
  const buffer = buffers.value[path]
  if (!buffer) return { ok: true }
  if (!force && buffer.updatedAt) {
    const latest = await fetchFileList()
    const hit = latest.find((file) => file.relativePath === path)
    if (hit?.updatedAt && hit.updatedAt !== buffer.updatedAt) return { ok: false, conflict: true }
  }
  const text = buffer.text
  await ipcRenderer.invoke('thunderstoreWriteConfigFile', {
    community: communityIdentifier.value,
    profileName: profileName.value,
    relativePath: path,
    content: text
  })
  const after = await fetchFileList().catch(() => files.value)
  const record = after.find((file) => file.relativePath === path)
  buffer.originalText = text
  buffer.updatedAt = record?.updatedAt || buffer.updatedAt
  savedPaths.value = { ...savedPaths.value, [path]: true }
  if (conflictPath.value === path) conflictPath.value = ''
  rememberHeader(path, text)
  return { ok: true }
}

async function saveCurrentFile({ force = false } = {}) {
  const path = selectedPath.value
  if (!path || saving.value || !isDirty.value || errorCount.value > 0) return
  if (jsonError.value && !force) {
    const answer = await askDialog({
      get title() { return uiText('ui.thisJSONFileHasSyntaxErrors') },
      content: uiText('ui.valueTheModMayNotBeAbleToReadThis', { value1: (jsonError.value) }),
      get confirmText() { return uiText('ui.saveAnyway') },
      get cancelText() { return uiText('ui.keepEditing') },
      danger: true
    })
    if (answer !== 'confirm') return
  }
  saving.value = true
  saveError.value = ''
  changesOpen.value = false
  try {
    const result = await writeFile(path, { force })
    if (result.conflict) {
      conflictPath.value = path
      saving.value = false
      const answer = await askDialog({
        get title() { return uiText('ui.theFileChangedAfterYouOpenedIt') },
        content: uiText('ui.anotherProgramChangedValueBepInExRewritesConfigurationWhenTheGame', { value1: (getConfigFileName(path)) }),
        get cancelText() { return uiText('ui.cancel') },
        get confirmText() { return uiText('ui.overwriteAndSave') },
        danger: true,
        actions: [{ key: 'reload', get text() { return uiText('ui.reload') } }]
      })
      if (answer === 'confirm') await saveCurrentFile({ force: true })
      if (answer === 'reload') await reloadFromDisk(path)
    }
  } catch (error) {
    console.error('保存配置文件失败', error)
    saveError.value = uiText('ui.saveFailedValue', { value1: (error?.message || uiText('ui.tryAgainLater')) })
  } finally {
    saving.value = false
  }
}

async function reloadFromDisk(path = selectedPath.value) {
  const buffer = buffers.value[path]
  if (buffer) buffer.text = buffer.originalText
  conflictPath.value = ''
  saveError.value = ''
  await readFile(path)
}

async function openCurrentFileExternally() {
  if (!selectedPath.value) return
  try {
    await ipcRenderer.invoke('thunderstoreOpenConfigFile', {
      community: communityIdentifier.value,
      profileName: profileName.value,
      relativePath: selectedPath.value
    })
  } catch (error) {
    console.error('打开配置文件失败', error)
    fileError.value = uiText('ui.couldNotOpenConfigurationFileValue', { value1: (error?.message || uiText('ui.tryAgainLater')) })
  }
}

// 离开页面 / 切换 Profile：列出没保存的文件，可以全部保存、不保存或继续编辑。
async function confirmLeave(reason = '离开后这些修改会丢失。') {
  const paths = dirtyPaths.value
  if (!paths.length) return true
  const names = paths.map((path) => {
    const record = fileRecords.value.find((file) => file.relativePath === path)
    return record?.displayName || getConfigFileName(path)
  })
  const answer = await askDialog({
    title: uiText('ui.valueFilesHaveUnsavedChanges', { value1: (paths.length) }),
    content: reason,
    items: names,
    get cancelText() { return uiText('ui.keepEditing') },
    get confirmText() { return uiText('ui.saveAll') },
    actions: [{ key: 'discard', get text() { return uiText('ui.doNotSave') } }]
  })
  if (answer === 'discard') {
    for (const path of paths) {
      const buffer = buffers.value[path]
      if (buffer) buffer.text = buffer.originalText
    }
    return true
  }
  if (answer !== 'confirm') return false
  for (const path of paths) {
    const buffer = buffers.value[path]
    const doc = parseConfigDocument(buffer?.text || '', path)
    const invalid =
      doc.structured && doc.entries.some((entry) => validateConfigEntryValue(entry, entry.value))
    if (invalid) {
      await selectFile(path, { focus: false })
      return false
    }
    try {
      const result = await writeFile(path)
      if (result.conflict) {
        await selectFile(path, { focus: false })
        conflictPath.value = path
        return false
      }
    } catch (error) {
      await selectFile(path, { focus: false })
      saveError.value = uiText('ui.saveFailedValue', { value1: (error?.message || uiText('ui.tryAgainLater')) })
      return false
    }
  }
  return true
}

function changeProfile(next) {
  const target = String(next || '').trim()
  if (!target || target === profileName.value) return
  router.replace({ name: route.name, params: route.params, query: { profile: target } })
}

onBeforeRouteLeave(async () => confirmLeave())

onBeforeRouteUpdate(async (to, from) => {
  const sameCommunity = String(to.params.id || '') === String(from.params.id || '')
  const sameProfile = String(to.query.profile || '') === String(from.query.profile || '')
  if (sameCommunity && sameProfile) return true
  return confirmLeave('切换后这些修改会丢失。')
})

// ===== 分组目录（滚动高亮） =====
function handleContentScroll() {
  const container = contentRef.value
  if (!container) return
  const heads = container.querySelectorAll('[data-section-id]')
  let active = heads[0]?.dataset.sectionId || ''
  for (const head of heads) {
    if (head.offsetTop - container.scrollTop <= 32) active = head.dataset.sectionId
  }
  activeSectionId.value = active
}

function jumpToSection(sectionId) {
  const container = contentRef.value
  const head = container?.querySelector(`[data-section-id="${sectionId}"]`)
  if (!head) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  container.scrollTo({
    top: Math.max(0, head.offsetTop - 12),
    behavior: reduceMotion ? 'auto' : 'smooth'
  })
  activeSectionId.value = sectionId
}

// ===== 改动弹层 =====
function toggleChanges() {
  changesOpen.value = !changesOpen.value
}

function handleWindowPointerDown(event) {
  if (!changesOpen.value) return
  const panel = changesRef.value
  if (panel && !panel.contains(event.target)) changesOpen.value = false
}

// 弹层里点「撤销」后焦点可能落回 body，所以 Esc 监听挂在 window 上。
function handleWindowKeydown(event) {
  if (event.key !== 'Escape' || !changesOpen.value || dialog.value.open) return
  event.stopPropagation()
  changesOpen.value = false
}

watch(changesOpen, (open) => {
  const method = open ? 'addEventListener' : 'removeEventListener'
  window[method]('pointerdown', handleWindowPointerDown, true)
  window[method]('keydown', handleWindowKeydown, true)
})

function handlePageKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    saveCurrentFile()
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown, true)
  window.removeEventListener('keydown', handleWindowKeydown, true)
  settleDialog('cancel')
})

// ===== 路由与菜单 =====
watch(
  () => [route.params.id, route.query.profile],
  () => bootstrapPage(),
  { immediate: true }
)

watch(
  () => [route.query.package, route.query.file],
  () => {
    if (!files.value.length || listLoading.value) return
    const next = resolveRouteSelection(files.value)
    if (next && next !== selectedPath.value) selectFile(next, { focus: false })
  }
)

watch(
  () => [communityName.value, currentRecord.value?.fileName],
  () => {
    const suffix = currentRecord.value?.fileName ? ` - ${currentRecord.value.fileName}` : ''
    setPageMenuName(`${communityName.value} 配置${suffix}`, route.fullPath)
  },
  { immediate: true }
)

watch(visibleSections, () => nextTick(handleContentScroll))

// 回到这个页签时检查磁盘上的文件有没有被游戏改过。
onActivated(() => {
  if (!files.value.length || listLoading.value) return
  fetchFileList()
    .then((records) => syncCurrentWithDisk(records))
    .catch(() => {})
})
</script>

<template>
  <PageBody :is-scroll-enabled="false">
    <section
      class="config-editor"
      :aria-busy="listLoading || fileLoading"
      @keydown="handlePageKeydown"
    >
      <header class="config-editor__head">
        <img
          v-if="communityInfo.iconUrl"
          class="config-editor__icon"
          :src="communityInfo.iconUrl"
          alt=""
        />
        <span
          v-else
          class="config-editor__icon is-monogram"
          :style="{ background: coverPlaceholderTone(communityName) }"
          aria-hidden="true"
          >{{ coverMonogram(communityName) }}</span
        >
        <div class="config-editor__title-row">
          <h1 class="config-editor__title">{{ $t('ui.configurationFile') }}</h1>
          <span class="config-editor__community">{{ communityName }}</span>
        </div>
        <label class="config-editor__profile">
          <span>Profile</span>
          <VxSelect
            class="config-editor__profile-select"
            :model-value="profileName"
            :options="profileOptions"
            :aria-label="$t('ui.switchProfile')"
            @update:model-value="changeProfile"
          />
        </label>
        <span class="config-editor__spacer"></span>
        <span class="config-editor__count">{{ files.length }} {{ $t('ui.filesVariant2') }}</span>
        <ToolIconButton
          icon="refresh"
          :label="$t('ui.refreshFileList')"
          :busy="listLoading && files.length > 0"
          @click="refreshList"
        />
      </header>

      <div class="config-editor__body">
        <ConfigFileList
          v-model:keyword="fileKeyword"
          class="config-editor__files"
          :groups="fileGroups"
          :selected-path="selectedPath"
          :loading="listLoading"
          :notice="packageNotice"
          @select="selectFile"
        />

        <main class="config-editor__main">
          <div v-if="listError && !files.length" class="config-editor__state">
            <ToolEmpty icon="error" :title="$t('ui.couldNotLoadConfigurationFiles')" :description="listError">
              <VxButton variant="secondary" size="sm" @click="bootstrapPage">{{ $t('tools.retry') }}</VxButton>
            </ToolEmpty>
          </div>

          <div v-else-if="listLoading && !files.length" class="config-editor__state is-loading">
            <ToolNotice tone="progress">{{ $t('ui.loadingConfigurationFiles') }}</ToolNotice>
          </div>

          <div v-else-if="!files.length" class="config-editor__state">
            <ToolEmpty
              icon="file"
              :title="$t('ui.thisProfileHasNoConfigurationFilesYet')"
              :description="$t('ui.mostModsCreateConfigurationFilesTheFirstTimeTheGame')"
            >
              <VxButton variant="secondary" size="sm" @click="refreshList">
                <ToolIcon name="refresh" :size="14" />
                {{ $t('tools.refresh') }}
              </VxButton>
            </ToolEmpty>
          </div>

          <template v-else-if="currentRecord">
            <div class="config-editor__file-head">
              <div class="config-editor__file-heading">
                <div class="config-editor__file-title-row">
                  <h2 ref="titleRef" class="config-editor__file-title" tabindex="-1">
                    {{ currentRecord.displayName }}
                  </h2>
                  <span v-if="currentRecord.version" class="tool-tag"
                    >v{{ currentRecord.version }}</span
                  >
                </div>
                <div class="config-editor__file-meta">
                  <span class="config-editor__path" :title="currentRecord.relativePath">{{
                    currentRecord.relativePath
                  }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ fileMetaText }}</span>
                </div>
              </div>
              <VxSegmented
                v-if="canUseForm"
                class="config-editor__mode"
                :model-value="viewMode"
                :options="MODE_OPTIONS"
                :aria-label="$t('ui.editingMode')"
                @update:model-value="selectMode"
              />
              <VxButton variant="ghost" size="sm" @click="openCurrentFileExternally">
                <ToolIcon name="external" :size="14" />
                {{ $t('ui.openExternally') }}
              </VxButton>
            </div>

            <div
              v-if="conflictPath === selectedPath || saveError || fileError"
              class="config-editor__notices"
            >
              <ToolNotice v-if="conflictPath === selectedPath" tone="warning">
                {{ $t('ui.anotherProgramChangedThisFileAfterYouOpenedItBepInEx') }}
                <template #actions>
                  <VxButton variant="secondary" size="sm" @click="reloadFromDisk()"
                    >{{ $t('ui.reload') }}</VxButton
                  >
                  <VxButton
                    variant="ghost"
                    size="sm"
                    :disabled="!canSave"
                    @click="saveCurrentFile({ force: true })"
                    >{{ $t('ui.saveAnyway') }}</VxButton
                  >
                </template>
              </ToolNotice>
              <ToolNotice v-if="saveError" tone="danger">
                {{ saveError }}
                <template #actions>
                  <VxButton
                    variant="secondary"
                    size="sm"
                    :disabled="!canSave"
                    @click="saveCurrentFile()"
                    >{{ $t('tools.retry') }}</VxButton
                  >
                </template>
              </ToolNotice>
              <ToolNotice v-if="fileError" tone="danger">
                {{ fileError }}
                <template #actions>
                  <VxButton variant="secondary" size="sm" @click="readFile(selectedPath)"
                    >{{ $t('tools.retry') }}</VxButton
                  >
                </template>
              </ToolNotice>
            </div>

            <div v-if="!currentBuffer" class="config-editor__state is-loading">
              <div
                v-for="index in 5"
                :key="index"
                class="config-editor__skeleton"
                aria-hidden="true"
              >
                <span class="tool-skeleton is-key"></span>
                <span class="tool-skeleton is-text"></span>
              </div>
            </div>

            <template v-else-if="viewMode === 'form'">
              <div class="config-editor__toolbar">
                <ToolSearchField
                  v-model="entryKeyword"
                  class="config-editor__entry-search"
                  :placeholder="$t('ui.searchSettingsOrDescriptions')"
                />
                <ToolFilterPills
                  v-model="entryFilter"
                  :options="filterOptions"
                  :label="$t('ui.filterSettings')"
                />
                <span class="config-editor__spacer"></span>
                <span class="config-editor__summary">
                  {{ currentDoc.sections.length }} {{ $t('ui.groups') }} {{ currentDoc.entries.length }} {{ $t('ui.items') }}
                </span>
              </div>
              <div class="config-editor__form">
                <div
                  ref="contentRef"
                  class="config-editor__content vx-ui-scrollbar"
                  @scroll.passive="handleContentScroll"
                >
                  <p v-if="!currentDoc.entries.length" class="config-editor__empty-text">
                    {{ $t('ui.thisFileHasNoSettingsYet') }}
                  </p>
                  <p v-else-if="!visibleSections.length" class="config-editor__empty-text">
                    {{ $t('ui.noSettingsMatchTheCurrentFilters') }}
                    <button type="button" class="config-editor__link" @click="clearEntryFilter">
                      {{ $t('tools.clearFilters') }}
                    </button>
                  </p>
                  <section
                    v-for="section in visibleSections"
                    :key="section.id"
                    class="config-editor__section"
                    :aria-labelledby="`${section.id}-title`"
                  >
                    <h3
                      :id="`${section.id}-title`"
                      class="config-editor__section-title"
                      :data-section-id="section.id"
                    >
                      <span class="config-editor__section-name">{{
                        section.name ? `[${section.name}]` : $t('ui.ungrouped')
                      }}</span>
                      <span class="config-editor__section-count"
                        >{{ section.entries.length }} {{ $t('ui.items') }}</span
                      >
                    </h3>
                    <div class="config-editor__panel">
                      <ConfigEntryRow
                        v-for="entry in section.entries"
                        :key="entry.id"
                        :entry="entry"
                        :value="entry.value"
                        :modified="entryStates.get(entry.id)?.modified"
                        :can-reset="entryStates.get(entry.id)?.canReset"
                        :error="entryStates.get(entry.id)?.error"
                        :disabled="saving"
                        @update="updateEntry(entry, $event)"
                        @undo="undoEntry(entry)"
                        @reset="resetEntry(entry)"
                      />
                    </div>
                  </section>
                </div>
                <nav v-if="visibleSections.length > 1" class="config-editor__toc" :aria-label="$t('ui.group')">
                  <div class="config-editor__toc-title">{{ $t('ui.group') }}</div>
                  <button
                    v-for="section in visibleSections"
                    :key="section.id"
                    type="button"
                    class="config-editor__toc-item"
                    :class="{ 'is-active': activeSectionId === section.id }"
                    :aria-current="activeSectionId === section.id ? 'location' : undefined"
                    @click="jumpToSection(section.id)"
                  >
                    <span class="config-editor__toc-name">{{ section.name || $t('ui.ungrouped') }}</span>
                    <span class="config-editor__toc-count">{{ section.entries.length }}</span>
                  </button>
                </nav>
              </div>
            </template>

            <div v-else class="config-editor__raw">
              <ToolNotice v-if="rawNotice" tone="info">{{ rawNotice }}</ToolNotice>
              <ToolNotice v-if="jsonError" tone="warning"
                >{{ $t('ui.invalidJSON') }}{{ jsonError }}</ToolNotice
              >
              <ConfigRawEditor
                :model-value="currentBuffer.text"
                :language="rawLanguage"
                :line-ending="currentDoc?.lineEnding || '\n'"
                :changed-lines="changedLines"
                :label="$t('ui.valueSource', { value1: (currentRecord.fileName) })"
                @update:model-value="updateRawText"
              >
                <template v-if="canUseForm" #status>{{ $t('ui.switchingBackToTheFormReparsesTheSource') }}</template>
              </ConfigRawEditor>
            </div>

            <footer class="config-editor__footer">
              <div
                v-if="changesOpen"
                ref="changesRef"
                class="config-editor__changes"
                role="dialog"
                aria-labelledby="config-changes-title"
              >
                <div class="config-editor__changes-head">
                  <span id="config-changes-title"
                    >{{ currentRecord.displayName }} · {{ changes.length }} {{ $t('ui.unsavedChanges') }}</span
                  >
                  <button type="button" class="config-editor__link" @click="undoAllChanges">
                    {{ $t('ui.undoAll') }}
                  </button>
                </div>
                <ul class="config-editor__changes-list vx-ui-scrollbar">
                  <li v-for="change in changes" :key="change.id" class="config-editor__change">
                    <span
                      class="config-editor__change-key"
                      :title="
                        change.entry.section
                          ? `[${change.entry.section}] ${change.entry.key}`
                          : change.entry.key
                      "
                      >{{ change.entry.key }}</span
                    >
                    <span class="config-editor__change-before">{{
                      describeValue(change.before)
                    }}</span>
                    <ToolIcon name="arrow-down" :size="12" class="config-editor__change-arrow" />
                    <span class="config-editor__change-after">{{
                      describeValue(change.after)
                    }}</span>
                    <button
                      v-if="change.before !== undefined"
                      type="button"
                      class="config-editor__link"
                      @click="undoEntry(change.entry)"
                    >
                      {{ $t('ui.undo') }}
                    </button>
                  </li>
                </ul>
                <div v-if="otherDirtyCount" class="config-editor__changes-other">
                  {{ $t('ui.also') }}
                  <template
                    v-for="(path, index) in dirtyPaths.filter((item) => item !== selectedPath)"
                    :key="path"
                  >
                    <span v-if="index > 0">、</span>
                    <button type="button" class="config-editor__link" @click="selectFile(path)">
                      {{
                        fileRecords.find((file) => file.relativePath === path)?.displayName || path
                      }}
                    </button>
                  </template>
                  {{ $t('ui.unsaved') }}
                </div>
              </div>

              <span
                v-if="footerState === 'error'"
                class="config-editor__status is-error"
                role="status"
              >
                <ToolIcon name="error" :size="15" />
                {{ errorCount }} {{ $t('ui.invalidFieldsMustBeCorrectedBeforeSaving') }}
              </span>
              <span v-else-if="footerState === 'dirty'" class="config-editor__status" role="status">
                <span class="config-editor__dot" aria-hidden="true"></span>
                {{ changes.length ? $t('ui.valueUnsavedItems', { value1: (changes.length) }) : $t('ui.theSourceHasUnsavedChanges') }}
              </span>
              <span v-else class="config-editor__status is-clean" role="status">
                <ToolIcon name="check" :size="15" />
                {{ savedPaths[selectedPath] ? $t('ui.saved') : $t('ui.noUnsavedChanges') }}
              </span>
              <button
                v-if="footerState !== 'clean' && changes.length"
                type="button"
                class="config-editor__link"
                :aria-expanded="changesOpen"
                @click="toggleChanges"
              >
                {{ $t('ui.reviewChanges') }}
              </button>
              <span v-if="otherDirtyCount" class="config-editor__others">
                {{ $t('ui.alsoVariant2') }} {{ otherDirtyCount }} {{ $t('ui.unsavedFiles') }}
              </span>
              <span class="config-editor__spacer"></span>
              <span class="config-editor__shortcut">{{ $t('ui.ctrlSToSave') }}</span>
              <VxButton
                variant="ghost"
                size="sm"
                :disabled="!isDirty || saving"
                @click="discardCurrent"
              >
                {{ $t('ui.discardChanges') }}
              </VxButton>
              <VxButton size="sm" :loading="saving" :disabled="!canSave" @click="saveCurrentFile()">
                {{ $t('dialogs.vamCookie.save') }}
              </VxButton>
            </footer>
          </template>
        </main>
      </div>

      <VxConfirmModal
        v-model="dialog.open"
        :title="dialog.title"
        :content="dialog.content"
        :confirm-text="dialog.confirmText"
        :cancel-text="dialog.cancelText"
        :danger="dialog.danger"
        :actions="dialog.actions"
        @confirm="settleDialog('confirm')"
        @action="settleDialog($event?.key || 'action')"
        @close="settleDialog('cancel')"
      >
        <ul v-if="dialog.items.length" class="config-editor__dialog-list">
          <li v-for="item in dialog.items" :key="item">
            <span class="config-editor__dot" aria-hidden="true"></span>{{ item }}
          </li>
        </ul>
      </VxConfirmModal>
    </section>
  </PageBody>
</template>

<style scoped lang="scss">
.config-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.config-editor__spacer {
  flex: 1 1 auto;
}

// ===== 页头 =====
.config-editor__head {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 14px;
  min-height: 60px;
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--color-surface-strong);
  box-sizing: border-box;
}

.config-editor__icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: var(--radius-sm);

  &.is-monogram {
    display: grid;
    place-items: center;
    color: var(--color-white);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
  }
}

.config-editor__title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.config-editor__title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
}

.config-editor__community {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-editor__profile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.config-editor__profile-select {
  width: 160px;
}

.config-editor__count {
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

// ===== 主体 =====
.config-editor__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.config-editor__files {
  flex: 0 0 284px;
  width: 284px;
  min-width: 0;
}

.config-editor__main {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.config-editor__state {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: var(--space-10);

  &.is-loading {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: var(--space-4);
    padding: var(--space-6);
  }
}

.config-editor__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-surface-strong);

  .is-key {
    width: 180px;
    height: 14px;
  }

  .is-text {
    width: 60%;
    height: 11px;
  }
}

// ===== 文件头 =====
.config-editor__file-head {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  padding: 14px var(--space-6) var(--space-3);
  border-bottom: 1px solid var(--color-surface-strong);
}

.config-editor__file-heading {
  flex: 1 1 320px;
  min-width: 0;
}

.config-editor__file-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.config-editor__file-title {
  margin: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-xs);
  }
}

.config-editor__file-meta {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.config-editor__path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-family-mono);
  text-overflow: ellipsis;
}

.config-editor__mode {
  flex: 0 0 auto;
  width: 132px;
}

.config-editor__notices {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6) 0;
}

// ===== 工具栏 + 表单 =====
.config-editor__toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-6);
}

.config-editor__entry-search {
  width: 260px;
}

.config-editor__summary {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.config-editor__form {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.config-editor__content {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 var(--space-6) var(--space-7);
  overflow-y: auto;
}

.config-editor__empty-text {
  margin: var(--space-12) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: center;
}

.config-editor__section-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: var(--space-5) 2px var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.config-editor__section:first-child .config-editor__section-title {
  margin-top: var(--space-1);
}

.config-editor__section-name {
  font-family: var(--font-family-mono);
}

.config-editor__section-count {
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  font-weight: var(--font-weight-regular);
}

.config-editor__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.config-editor__toc {
  display: flex;
  flex: 0 0 180px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--space-1) var(--space-4) var(--space-4) 0;
  overflow-x: hidden;
  overflow-y: auto;
  box-sizing: border-box;
}

.config-editor__toc-title {
  margin: 0 10px 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.config-editor__toc-item {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 5px 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &.is-active {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-semibold);
    background: color-mix(in srgb, var(--color-accent-soft) 45%, var(--color-white));
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

.config-editor__toc-name {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-family-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-editor__toc-count {
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

// ===== 原文 =====
.config-editor__raw {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-3) var(--space-6) var(--space-4);
}

// ===== 底栏 =====
.config-editor__footer {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 10px;
  min-height: 52px;
  padding: var(--space-2) var(--space-5) var(--space-2) var(--space-6);
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-surface-strong);
  box-sizing: border-box;
}

.config-editor__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  &.is-error {
    color: var(--color-danger-strong);
  }

  &.is-clean {
    color: var(--color-text-tertiary);

    :deep(.tool-icon) {
      color: var(--color-success-strong);
    }
  }
}

.config-editor__others,
.config-editor__shortcut {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.config-editor__dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  background: var(--color-warning);
  border-radius: 50%;
}

.config-editor__link {
  padding: 2px 4px;
  color: var(--color-accent-strong);
  font: inherit;
  font-size: 12.5px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

.config-editor__changes {
  position: absolute;
  bottom: calc(100% + 8px);
  left: var(--space-6);
  z-index: var(--z-index-dropdown);
  width: min(460px, calc(100% - 48px));
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.config-editor__changes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 14px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  border-bottom: 1px solid var(--color-surface-strong);
}

.config-editor__changes-list {
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.config-editor__change {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  .config-editor__link {
    margin-left: auto;
    font-family: var(--font-family-base);
  }
}

.config-editor__change-key {
  flex: 0 0 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-editor__change-before,
.config-editor__change-after {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-editor__change-before {
  color: var(--color-text-tertiary);
  text-decoration: line-through;
}

.config-editor__change-after {
  font-weight: var(--font-weight-semibold);
}

.config-editor__change-arrow {
  color: var(--color-text-tertiary);
  transform: rotate(-90deg);
}

.config-editor__changes-other {
  padding: 10px 14px;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-surface-strong);
}

.config-editor__dialog-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  list-style: none;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);

  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }
}

@media (max-width: 1180px) {
  .config-editor__toc {
    display: none;
  }
}

@media (max-width: 900px) {
  .config-editor__files {
    flex-basis: 220px;
  }

  .config-editor__entry-search {
    width: 100%;
  }
}
</style>
