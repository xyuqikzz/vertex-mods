<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { $message } from '@renderer/common/message.js'
import {
  VxButton,
  VxCheckbox,
  VxConfirmModal,
  VxModal,
  VxSegmented
} from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'
import {
  analyzeLocalModSources,
  commitLocalModManagement,
  pickLocalModSources,
  resolveLocalModInstallTarget,
  selectLocalModInstallTargetFolder
} from './local-mod-manager-service.js'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  context: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'completed', 'task-created'])

const { t, locale } = useI18n()

const MODE = Object.freeze({
  LIBRARY: 'library',
  INSTALL: 'library_install_task',
  BIND: 'bind_existing'
})
const MODE_KEYS = Object.freeze({
  [MODE.LIBRARY]: 'library',
  [MODE.INSTALL]: 'install',
  [MODE.BIND]: 'bind'
})

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const managementMode = ref(MODE.LIBRARY)
const loading = ref(false)
const analyzing = ref(false)
const resolvingMap = ref({})
const selectedIndex = ref(0)
const resultState = ref(null)
const bindConfirmOpen = ref(false)
const dragActive = ref(false)
const addMenuOpen = ref(false)
const addMenuRef = ref(null)
const options = reactive({
  autoStart: false,
  conflictStrategy: 'skip'
})
const items = ref([])

const busy = computed(() => loading.value || analyzing.value)
const selectedItem = computed(() => items.value[selectedIndex.value] || null)
const modeKey = computed(() => MODE_KEYS[managementMode.value] || 'library')
const isDone = computed(() => !!resultState.value?.success)

const modeOptions = computed(() =>
  Object.entries(MODE_KEYS).map(([value, key]) => ({ value, label: t(`localMod.modes.${key}`) }))
)

const contextParts = computed(() => {
  const parts = [String(props.context?.gameName || '').trim() || t('localMod.currentGame')]
  const platform = String(props.context?.sourcePlatform || '').trim()
  if (platform) parts.push(resolveSourcePlatformLabel(platform) || platform)
  parts.push(t('localMod.profile', { name: props.context?.profileName || 'default' }))
  return parts
})

function itemStatus(item = {}) {
  if (item.analysis?.success === false || item.riskLevel === 'blocked') return 'blocked'
  if (item.riskLevel === 'warning' || item.duplicateState?.duplicated) return 'warning'
  return 'ok'
}

const statusCounts = computed(() => {
  const counts = { ok: 0, warning: 0, blocked: 0 }
  for (const item of items.value) counts[itemStatus(item)] += 1
  return counts
})

const eligibleCount = computed(() => statusCounts.value.ok + statusCounts.value.warning)

const canSubmit = computed(() => {
  if (!items.value.length || busy.value || isDone.value) return false
  return eligibleCount.value > 0
})

const primaryText = computed(() => {
  if (loading.value) return t('localMod.submitting')
  if (!items.value.length) return t('localMod.submitEmpty')
  return managementMode.value === MODE.BIND
    ? t('localMod.submitBind', { count: eligibleCount.value })
    : t('localMod.submit', { count: eligibleCount.value })
})

const bindPaths = computed(() =>
  items.value.filter((item) => itemStatus(item) !== 'blocked').map((item) => item.path)
)

const resultSummary = computed(() => {
  const data = resultState.value?.data || {}
  const failed = Array.isArray(data.failed) ? data.failed : []
  const assets = Array.isArray(data.assets) ? data.assets.length : 0
  const bindings = Array.isArray(data.bindings) ? data.bindings.length : 0
  const tasks = Array.isArray(data.tasks) ? data.tasks.length : 0
  const ok =
    managementMode.value === MODE.BIND
      ? bindings
      : Math.max(assets, Math.max(0, items.value.length - failed.length))
  const details = []
  if (managementMode.value === MODE.BIND)
    details.push(t('localMod.resultBindings', { count: bindings }))
  else details.push(t('localMod.resultAssets', { count: assets }))
  if (managementMode.value === MODE.INSTALL)
    details.push(t('localMod.resultTasks', { count: tasks }))
  return {
    title: failed.length
      ? t('localMod.resultTitle', { ok, failed: failed.length })
      : t('localMod.resultAllOk', { ok }),
    details: details.join(' · '),
    failed
  }
})

function formatCount(value) {
  return Number(value || 0).toLocaleString(
    String(locale.value).startsWith('zh') ? 'zh-CN' : 'en-US'
  )
}

function formatFileSize(value = 0) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '--'
  const units = ['B', 'KB', 'MB', 'GB']
  let nextSize = size
  let index = 0
  while (nextSize >= 1024 && index < units.length - 1) {
    nextSize /= 1024
    index += 1
  }
  return `${nextSize.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function sourceTypeLabel(value = '') {
  const type = String(value || '').trim()
  if (['archive', 'folder', 'file'].includes(type)) return t(`localMod.sourceType.${type}`)
  return type || '--'
}

function duplicateNotes(item = {}) {
  const state = item.duplicateState || {}
  const notes = []
  if (state.batchDuplicate) notes.push(t('localMod.duplicates.batch'))
  if (state.assetDuplicate) notes.push(t('localMod.duplicates.asset'))
  if (state.bindingDuplicate) notes.push(t('localMod.duplicates.binding'))
  return notes
}

function riskMessages(item = {}) {
  return (Array.isArray(item.riskReasons) ? item.riskReasons : [])
    .map((reason) => String(reason?.message || reason || '').trim())
    .filter(Boolean)
}

function itemMeta(item = {}) {
  const parts = [
    sourceTypeLabel(item.analysis?.sourceType),
    formatFileSize(item.analysis?.sizeBytes)
  ]
  const note = riskMessages(item)[0] || duplicateNotes(item)[0]
  if (note) parts.push(note)
  return parts.filter((part) => part && part !== '--').join(' · ')
}

function checkText(item = {}) {
  const status = itemStatus(item)
  if (status === 'ok') return t('localMod.checkOk')
  if (status === 'warning') return t('localMod.checkWarning')
  const reason = riskMessages(item)[0] || String(item.analysis?.message || '').trim()
  return reason ? t('localMod.checkBlocked', { reason }) : t('localMod.checkBlockedFallback')
}

function closeDialog() {
  if (loading.value) return
  open.value = false
}

function resetState({ keepMode = false } = {}) {
  if (!keepMode) managementMode.value = MODE.LIBRARY
  loading.value = false
  analyzing.value = false
  resolvingMap.value = {}
  selectedIndex.value = 0
  resultState.value = null
  bindConfirmOpen.value = false
  dragActive.value = false
  addMenuOpen.value = false
  options.autoStart = false
  options.conflictStrategy = 'skip'
  items.value = []
}

function createItemFromAnalysis(analysis = {}) {
  const duplicateState = analysis.duplicateState || {}
  return {
    id: `${analysis.path || Math.random()}-${Date.now()}-${Math.random()}`,
    path: analysis.path,
    analysis,
    displayName: analysis.displayName || analysis.fileName || '本地 Mod',
    version: '',
    author: '',
    note: '',
    tags: ['local'],
    riskLevel: analysis.riskLevel || 'safe',
    riskReasons: Array.isArray(analysis.riskReasons) ? analysis.riskReasons : [],
    duplicateState,
    installTarget: null,
    installTargetState: duplicateState.duplicated ? 'warning' : ''
  }
}

// 新来源追加到列表末尾；同一路径重新分析时替换原条目。
async function analyzePaths(paths = []) {
  const nextPaths = [...new Set(paths.map((item) => String(item || '').trim()).filter(Boolean))]
  if (!nextPaths.length) return
  analyzing.value = true
  resultState.value = null
  try {
    const result = await analyzeLocalModSources({
      ...props.context,
      paths: nextPaths
    })
    const list = Array.isArray(result?.data?.items) ? result.data.items : []
    if (!list.length) {
      $message.warning(result?.message || t('localMod.nothingFound'))
      return
    }
    const incoming = list.map((item) => createItemFromAnalysis(item))
    const incomingPaths = new Set(incoming.map((item) => item.path))
    const kept = items.value.filter((item) => !incomingPaths.has(item.path))
    items.value = [...kept, ...incoming]
    selectedIndex.value = kept.length
  } catch (error) {
    console.error('分析本地模组来源失败', error)
    $message.error(String(error?.message || t('localMod.analyzeFailed')))
  } finally {
    analyzing.value = false
  }
}

async function pickSources(mode = 'all') {
  addMenuOpen.value = false
  if (busy.value) return
  analyzing.value = true
  let paths = []
  try {
    const result = await pickLocalModSources({ mode })
    if (result?.success && Array.isArray(result.paths)) paths = result.paths
  } catch (error) {
    console.error('选择本地 Mod 来源失败', error)
    $message.error(String(error?.message || t('localMod.pickFailed')))
  } finally {
    analyzing.value = false
  }
  if (paths.length) await analyzePaths(paths)
}

function handleDragOver(event) {
  if (busy.value || isDone.value) return
  event.preventDefault()
  dragActive.value = true
}

function handleDragLeave(event) {
  if (event.currentTarget?.contains?.(event.relatedTarget)) return
  dragActive.value = false
}

async function handleDrop(event) {
  event.preventDefault()
  dragActive.value = false
  if (busy.value || isDone.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  await analyzePaths(files.map((item) => item.path).filter(Boolean))
}

function removeItem(index) {
  if (busy.value) return
  const next = [...items.value]
  next.splice(index, 1)
  items.value = next
  if (selectedIndex.value >= next.length) selectedIndex.value = Math.max(0, next.length - 1)
  else if (index < selectedIndex.value) selectedIndex.value -= 1
}

function setResolving(item = {}, value = false) {
  const next = { ...resolvingMap.value }
  if (value) next[item.id] = true
  else delete next[item.id]
  resolvingMap.value = next
}

async function resolveTarget(item = {}) {
  if (!item?.path || resolvingMap.value[item.id]) return false
  setResolving(item, true)
  try {
    const result = await resolveLocalModInstallTarget({
      ...props.context,
      sourcePath: item.path,
      analysis: item.analysis
    })
    if (result?.success && result.data?.installTarget) {
      item.installTarget = result.data.installTarget
      item.installTargetState = 'success'
      return true
    }
    item.installTarget = {
      mode: 'unresolved'
    }
    item.installTargetState = 'required'
    if (result?.code !== 'local_mod_manual_target_required' && result?.message) {
      $message.warning(result.message)
    }
    return false
  } catch (error) {
    console.error('解析本地模组安装目标失败', error)
    item.installTargetState = 'required'
    $message.error(String(error?.message || t('localMod.targetFailed')))
    return false
  } finally {
    setResolving(item, false)
  }
}

async function selectManualTarget(item = {}) {
  if (!item?.path || resolvingMap.value[item.id]) return
  setResolving(item, true)
  try {
    const result = await selectLocalModInstallTargetFolder({
      ...props.context,
      sourcePath: item.path
    })
    if (result?.success && result.data?.installTarget) {
      item.installTarget = result.data.installTarget
      item.installTargetState = 'success'
      return
    }
    if (result?.success === false && !result.canceled) {
      $message.error(result.message || t('localMod.targetUnavailable'))
    }
  } catch (error) {
    console.error('选择安装目标文件夹失败', error)
    $message.error(String(error?.message || t('localMod.targetUnavailable')))
  } finally {
    setResolving(item, false)
  }
}

async function ensureInstallTargets() {
  if (managementMode.value !== MODE.INSTALL) return true
  for (const item of items.value) {
    if (itemStatus(item) === 'blocked') continue
    if (item.installTarget?.mode === 'rule' || item.installTarget?.mode === 'manual') {
      continue
    }
    const resolved = await resolveTarget(item)
    if (!resolved) {
      selectedIndex.value = items.value.indexOf(item)
      $message.warning(t('localMod.needTarget', { name: item.displayName }))
      return false
    }
  }
  return true
}

async function submit() {
  if (!canSubmit.value) return
  const targetReady = await ensureInstallTargets()
  if (!targetReady) return
  if (managementMode.value === MODE.BIND) {
    bindConfirmOpen.value = true
    return
  }
  await commit()
}

async function commit() {
  if (!items.value.length || loading.value) return
  loading.value = true
  resultState.value = null
  try {
    const result = await commitLocalModManagement({
      ...props.context,
      managementMode: managementMode.value,
      conflictStrategy: options.conflictStrategy,
      autoStart: options.autoStart,
      items: items.value.map((item) => ({
        path: item.path,
        analysis: item.analysis,
        displayName: item.displayName,
        version: item.version,
        author: item.author,
        note: item.note,
        tags: item.tags,
        installTarget: item.installTarget
      })),
      metadata: {
        createdBy: 'local-mod-manager'
      }
    })
    resultState.value = result
    if (result?.success) {
      emit('completed', result)
      if (managementMode.value === MODE.INSTALL) {
        emit('task-created', result)
      }
      return
    }
    $message.error(result?.message || t('localMod.failedFallback'))
  } catch (error) {
    console.error('本地模组接管失败', error)
    $message.error(String(error?.message || t('localMod.failedFallback')))
  } finally {
    loading.value = false
  }
}

function continueAdding() {
  resetState({ keepMode: true })
}

function toggleAddMenu() {
  if (busy.value) return
  addMenuOpen.value = !addMenuOpen.value
  if (addMenuOpen.value) {
    nextTick(() => addMenuRef.value?.querySelector('button')?.focus())
  }
}

function handleDocumentPointer(event) {
  if (!addMenuOpen.value) return
  const root = addMenuRef.value?.parentElement
  if (root && !root.contains(event.target)) addMenuOpen.value = false
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    addMenuOpen.value = false
  }
}

watch(addMenuOpen, (value) => {
  if (value) document.addEventListener('pointerdown', handleDocumentPointer, true)
  else document.removeEventListener('pointerdown', handleDocumentPointer, true)
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointer, true))

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      resetState()
    }
  }
)
</script>

<template>
  <VxModal
    :model-value="open"
    plain
    :aria-label="t('localMod.title')"
    :close-on-esc="!loading"
    panel-class="lmm-modal"
    @update:model-value="(value) => !value && closeDialog()"
  >
    <section class="lmm" :aria-busy="busy">
      <header class="lmm__header">
        <div class="lmm__heading">
          <h2 class="lmm__title">{{ t('localMod.title') }}</h2>
          <p class="lmm__context">
            <template v-for="(part, index) in contextParts" :key="index">
              <span v-if="index" aria-hidden="true">·</span>
              <span>{{ part }}</span>
            </template>
          </p>
        </div>
        <button
          type="button"
          class="lmm__icon-button"
          :aria-label="t('localMod.close')"
          :title="t('localMod.close')"
          :disabled="loading"
          @click="closeDialog"
        >
          <ToolIcon name="close" :size="14" />
        </button>
      </header>

      <!-- 还没有来源：先选方式，再拖入 -->
      <div v-if="!items.length" class="lmm__start">
        <div class="lmm__modes">
          <span id="lmm-mode-label" class="lmm__label">{{ t('localMod.modeLabel') }}</span>
          <div class="lmm__mode-cards" role="radiogroup" aria-labelledby="lmm-mode-label">
            <button
              v-for="(key, value) in MODE_KEYS"
              :key="value"
              type="button"
              role="radio"
              class="lmm__mode-card"
              :class="{ 'is-active': managementMode === value, 'is-danger': key === 'bind' }"
              :aria-checked="managementMode === value"
              @click="managementMode = value"
            >
              <span class="lmm__mode-head">
                <span class="lmm__radio" aria-hidden="true"></span>
                {{ t(`localMod.modes.${key}`) }}
                <span v-if="key !== 'install'" class="lmm__mode-badge">{{
                  t(`localMod.modeBadges.${key}`)
                }}</span>
              </span>
              <span class="lmm__mode-desc">{{ t(`localMod.modeCardHints.${key}`) }}</span>
            </button>
          </div>
        </div>

        <div
          class="lmm__drop"
          :class="{ 'is-active': dragActive }"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <span class="lmm__drop-icon" aria-hidden="true">
            <span v-if="analyzing" class="lmm__spinner is-large"></span>
            <ToolIcon v-else name="drop" :size="22" />
          </span>
          <h3 class="lmm__drop-title" aria-live="polite">
            {{
              analyzing
                ? t('localMod.analyzing')
                : dragActive
                  ? t('localMod.dropActive')
                  : t('localMod.dropTitle')
            }}
          </h3>
          <p class="lmm__drop-hint">{{ t('localMod.dropHint') }}</p>
          <div class="lmm__drop-actions">
            <VxButton variant="secondary" :disabled="busy" @click="pickSources('archive')">
              <ToolIcon name="archive" :size="14" />
              {{ t('localMod.pickArchive') }}
            </VxButton>
            <VxButton variant="secondary" :disabled="busy" @click="pickSources('folder')">
              <ToolIcon name="folder" :size="14" />
              {{ t('localMod.pickFolder') }}
            </VxButton>
            <VxButton variant="secondary" :disabled="busy" @click="pickSources('all')">
              <ToolIcon name="file" :size="14" />
              {{ t('localMod.pickFile') }}
            </VxButton>
          </div>
        </div>
      </div>

      <!-- 已有来源：左列表 + 右详情 -->
      <template v-else>
        <div class="lmm__toolbar">
          <VxSegmented
            v-model="managementMode"
            :options="modeOptions"
            :aria-label="t('localMod.modeLabel')"
            :class="{ 'is-locked': isDone || loading }"
          />
          <span class="lmm__mode-hint" :class="{ 'is-danger': managementMode === MODE.BIND }">
            {{ t(`localMod.modeHints.${modeKey}`) }}
          </span>
          <div class="lmm__add">
            <VxButton
              variant="secondary"
              size="sm"
              :disabled="busy || isDone"
              :loading="analyzing"
              aria-haspopup="menu"
              :aria-expanded="addMenuOpen"
              @click="toggleAddMenu"
            >
              <ToolIcon v-if="!analyzing" name="plus" :size="14" />
              {{ t('localMod.addSource') }}
            </VxButton>
            <div
              v-if="addMenuOpen"
              ref="addMenuRef"
              class="lmm__menu"
              role="menu"
              @keydown="handleMenuKeydown"
            >
              <button type="button" role="menuitem" @click="pickSources('archive')">
                <ToolIcon name="archive" :size="14" />{{ t('localMod.pickArchive') }}
              </button>
              <button type="button" role="menuitem" @click="pickSources('folder')">
                <ToolIcon name="folder" :size="14" />{{ t('localMod.pickFolder') }}
              </button>
              <button type="button" role="menuitem" @click="pickSources('all')">
                <ToolIcon name="file" :size="14" />{{ t('localMod.pickFile') }}
              </button>
            </div>
          </div>
        </div>

        <div class="lmm__body">
          <nav
            class="lmm__sources vx-ui-scrollbar"
            :class="{ 'is-drop': dragActive }"
            :aria-label="t('localMod.sourceList')"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <ul>
              <li v-for="(item, index) in items" :key="item.id" class="lmm__source">
                <button
                  type="button"
                  class="lmm__source-main"
                  :class="{ 'is-current': selectedIndex === index }"
                  :aria-current="selectedIndex === index ? 'true' : undefined"
                  @click="selectedIndex = index"
                >
                  <span class="lmm__source-line">
                    <span class="lmm__source-name">{{ item.displayName }}</span>
                    <span class="lmm__pill" :class="`is-${itemStatus(item)}`">{{
                      t(`localMod.status.${itemStatus(item)}`)
                    }}</span>
                  </span>
                  <span class="lmm__source-path" :title="item.path">{{ item.path }}</span>
                  <span class="lmm__source-meta">{{ itemMeta(item) }}</span>
                </button>
                <button
                  v-if="!isDone"
                  type="button"
                  class="lmm__remove"
                  :aria-label="t('localMod.remove', { name: item.displayName })"
                  :title="t('localMod.remove', { name: item.displayName })"
                  :disabled="busy"
                  @click="removeItem(index)"
                >
                  <ToolIcon name="close" :size="12" />
                </button>
              </li>
            </ul>
          </nav>

          <div class="lmm__detail vx-ui-scrollbar">
            <div v-if="isDone" class="lmm__result" role="status">
              <strong>{{ resultSummary.title }}</strong>
              <span>{{ resultSummary.details }}</span>
              <span
                v-for="failed in resultSummary.failed"
                :key="failed.path || failed.message"
                class="lmm__result-failed"
                >{{ failed.message }}</span
              >
            </div>

            <template v-if="selectedItem">
              <section class="lmm__section" aria-labelledby="lmm-info-title">
                <h3 id="lmm-info-title" class="lmm__section-title">{{ t('localMod.info') }}</h3>
                <div class="lmm__grid">
                  <label class="lmm__field">
                    {{ t('localMod.name') }}
                    <input
                      v-model="selectedItem.displayName"
                      class="lmm__input"
                      type="text"
                      :disabled="isDone || loading"
                    />
                  </label>
                  <label class="lmm__field">
                    {{ t('localMod.version') }}
                    <input
                      v-model="selectedItem.version"
                      class="lmm__input"
                      type="text"
                      :placeholder="t('localMod.optional')"
                      :disabled="isDone || loading"
                    />
                  </label>
                  <label class="lmm__field">
                    {{ t('localMod.author') }}
                    <input
                      v-model="selectedItem.author"
                      class="lmm__input"
                      type="text"
                      :placeholder="t('localMod.optional')"
                      :disabled="isDone || loading"
                    />
                  </label>
                  <label class="lmm__field">
                    {{ t('localMod.note') }}
                    <input
                      v-model="selectedItem.note"
                      class="lmm__input"
                      type="text"
                      :placeholder="t('localMod.optional')"
                      :disabled="isDone || loading"
                    />
                  </label>
                </div>
              </section>

              <section class="lmm__section" aria-labelledby="lmm-check-title">
                <h3 id="lmm-check-title" class="lmm__section-title">{{ t('localMod.check') }}</h3>
                <div class="lmm__check" :class="`is-${itemStatus(selectedItem)}`">
                  <ToolIcon
                    :name="
                      itemStatus(selectedItem) === 'ok'
                        ? 'check-circle'
                        : itemStatus(selectedItem) === 'warning'
                          ? 'warning'
                          : 'error'
                    "
                    :size="15"
                  />
                  <span>{{ checkText(selectedItem) }}</span>
                </div>
                <ul
                  v-if="
                    itemStatus(selectedItem) !== 'ok' &&
                    (riskMessages(selectedItem).length || duplicateNotes(selectedItem).length)
                  "
                  class="lmm__notes"
                >
                  <li v-for="message in riskMessages(selectedItem)" :key="message">
                    {{ message }}
                  </li>
                  <li v-for="note in duplicateNotes(selectedItem)" :key="note">{{ note }}</li>
                </ul>
                <dl class="lmm__facts">
                  <dt>{{ t('localMod.type') }}</dt>
                  <dd>{{ sourceTypeLabel(selectedItem.analysis?.sourceType) }}</dd>
                  <dt>{{ t('localMod.size') }}</dt>
                  <dd>{{ formatFileSize(selectedItem.analysis?.sizeBytes) }}</dd>
                  <dt>{{ t('localMod.files') }}</dt>
                  <dd>
                    {{
                      t('localMod.countUnit', {
                        count: formatCount(selectedItem.analysis?.fileCount)
                      })
                    }}
                  </dd>
                  <dt>{{ t('localMod.dirs') }}</dt>
                  <dd>
                    {{
                      t('localMod.countUnit', {
                        count: formatCount(selectedItem.analysis?.dirCount)
                      })
                    }}
                  </dd>
                  <dt>{{ t('localMod.fingerprint') }}</dt>
                  <dd class="is-wide is-mono" :title="selectedItem.analysis?.fingerprint || ''">
                    {{ selectedItem.analysis?.fingerprint || '--' }}
                  </dd>
                </dl>
                <div v-if="selectedItem.analysis?.signals?.length" class="lmm__signals">
                  <span v-for="signal in selectedItem.analysis.signals" :key="signal">{{
                    signal
                  }}</span>
                </div>
              </section>

              <section
                v-if="managementMode === MODE.INSTALL && itemStatus(selectedItem) !== 'blocked'"
                class="lmm__section"
                aria-labelledby="lmm-target-title"
              >
                <h3 id="lmm-target-title" class="lmm__section-title">
                  {{ t('localMod.target') }}
                </h3>
                <div
                  class="lmm__target"
                  :class="{
                    'is-missing':
                      selectedItem.installTarget?.mode !== 'rule' &&
                      selectedItem.installTarget?.mode !== 'manual'
                  }"
                >
                  <div class="lmm__target-main">
                    <template v-if="selectedItem.installTarget?.mode === 'rule'">
                      <span class="lmm__target-kind">
                        <span class="lmm__pill is-ok">{{ t('localMod.targetRule') }}</span>
                        {{
                          selectedItem.installTarget.ruleName || selectedItem.installTarget.ruleId
                        }}
                      </span>
                      <span class="lmm__target-path">{{
                        selectedItem.installTarget.targetPath ||
                        selectedItem.installTarget.targetRelativePath
                      }}</span>
                    </template>
                    <template v-else-if="selectedItem.installTarget?.mode === 'manual'">
                      <span class="lmm__target-kind">{{ t('localMod.targetManual') }}</span>
                      <span class="lmm__target-path">{{
                        selectedItem.installTarget.targetPath
                      }}</span>
                    </template>
                    <template v-else>
                      <span class="lmm__target-kind">{{ t('localMod.targetMissing') }}</span>
                      <span class="lmm__target-hint">{{ t('localMod.targetMissingHint') }}</span>
                    </template>
                  </div>
                  <VxButton
                    variant="ghost"
                    size="sm"
                    :loading="!!resolvingMap[selectedItem.id]"
                    :disabled="isDone || loading"
                    @click="resolveTarget(selectedItem)"
                  >
                    {{
                      resolvingMap[selectedItem.id] ? t('localMod.matching') : t('localMod.rematch')
                    }}
                  </VxButton>
                  <VxButton
                    variant="secondary"
                    size="sm"
                    :disabled="!!resolvingMap[selectedItem.id] || isDone || loading"
                    @click="selectManualTarget(selectedItem)"
                  >
                    {{
                      selectedItem.installTarget?.mode === 'rule' ||
                      selectedItem.installTarget?.mode === 'manual'
                        ? t('localMod.pickTarget')
                        : t('localMod.pickTargetFirst')
                    }}
                  </VxButton>
                </div>
              </section>
            </template>
          </div>
        </div>
      </template>

      <footer class="lmm__footer">
        <span class="lmm__summary">
          <template v-if="!items.length">{{ t('localMod.footerEmpty') }}</template>
          <template v-else>
            {{ t('localMod.footerCount', { total: items.length }) }}
            <template v-if="statusCounts.ok">
              ·
              <strong class="is-ok">{{
                t('localMod.footerOk', { count: statusCounts.ok })
              }}</strong>
            </template>
            <template v-if="statusCounts.warning">
              ·
              <strong class="is-warning">{{
                t('localMod.footerWarning', { count: statusCounts.warning })
              }}</strong>
            </template>
            <template v-if="statusCounts.blocked">
              ·
              <strong class="is-blocked">{{
                t('localMod.footerBlocked', { count: statusCounts.blocked })
              }}</strong>
            </template>
          </template>
        </span>
        <VxCheckbox
          v-if="managementMode === MODE.INSTALL && items.length && !isDone"
          v-model="options.autoStart"
          :label="t('localMod.autoStart')"
          :disabled="loading"
        />
        <template v-if="isDone">
          <VxButton variant="secondary" @click="continueAdding">
            {{ t('localMod.continueAdding') }}
          </VxButton>
          <VxButton @click="closeDialog">{{ t('localMod.done') }}</VxButton>
        </template>
        <template v-else>
          <VxButton variant="secondary" :disabled="loading" @click="closeDialog">
            {{ t('localMod.cancel') }}
          </VxButton>
          <VxButton
            :variant="managementMode === MODE.BIND ? 'danger' : 'primary'"
            :disabled="!canSubmit"
            :loading="loading"
            @click="submit"
          >
            {{ primaryText }}
          </VxButton>
        </template>
      </footer>
    </section>

    <VxConfirmModal
      v-model="bindConfirmOpen"
      danger
      :title="t('localMod.bindTitle', { count: bindPaths.length })"
      :confirm-text="t('localMod.bindConfirm')"
      :cancel-text="t('localMod.bindCancel')"
      @confirm="commit"
    >
      <div class="lmm-bind">
        <p class="lmm-bind__body">{{ t('localMod.bindBody') }}</p>
        <ul class="lmm-bind__paths vx-ui-scrollbar">
          <li v-for="path in bindPaths" :key="path" :title="path">{{ path }}</li>
        </ul>
        <p class="lmm-bind__note">{{ t('localMod.bindNote') }}</p>
      </div>
    </VxConfirmModal>
  </VxModal>
</template>

<style scoped lang="scss">
.lmm {
  width: min(960px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 56px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  color: var(--color-text);
  font-size: 14px;
}

.lmm__header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
}

.lmm__heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.lmm__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.lmm__context {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.lmm__icon-button {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

/* 空状态 */
.lmm__start {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 20px 20px;
  overflow: auto;
}

.lmm__modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lmm__label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.lmm__mode-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.lmm__mode-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &.is-active {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-accent-soft);
  }

  &.is-danger.is-active {
    border-color: var(--color-warning);
    box-shadow: 0 0 0 3px var(--color-warning-soft);
  }
}

.lmm__mode-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.lmm__radio {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 50%;
}

.lmm__mode-card.is-active .lmm__radio {
  border: 5px solid var(--color-accent);
}

.lmm__mode-card.is-danger.is-active .lmm__radio {
  border-color: var(--color-warning);
}

.lmm__mode-badge {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-size: 11.5px;
  font-weight: 600;
}

.lmm__mode-card.is-danger .lmm__mode-badge {
  background: var(--color-warning-soft);
  color: #8a3f04;
}

.lmm__mode-desc {
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  line-height: 1.55;
}

.lmm__drop {
  flex: 1 1 auto;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: 12px;
  background: var(--color-surface-soft);
  text-align: center;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &.is-active {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }
}

.lmm__drop-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
  border-radius: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
}

.lmm__drop-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.lmm__drop-hint {
  max-width: 460px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.lmm__drop-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;

  :deep(.vx-button) {
    gap: 6px;
  }
}

/* 已有来源 */
.lmm__toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px 14px;
  border-bottom: 1px solid var(--color-border);

  :deep(.vx-segmented) {
    flex: 0 0 auto;
    width: 360px;
  }

  :deep(.vx-segmented.is-locked) {
    pointer-events: none;
    opacity: 0.6;
  }
}

.lmm__mode-hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-tertiary);
  font-size: 12.5px;

  &.is-danger {
    color: #8a3f04;
  }
}

.lmm__add {
  position: relative;
  flex: 0 0 auto;

  :deep(.vx-button) {
    gap: 6px;
  }
}

.lmm__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 5;
  min-width: 168px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      outline: none;
      background: var(--color-surface-hover);
      color: var(--color-text);
    }
  }
}

.lmm__body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
}

.lmm__sources {
  min-height: 0;
  overflow: auto;
  padding: 8px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-soft);

  &.is-drop {
    background: var(--color-accent-soft);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

.lmm__source {
  position: relative;
}

.lmm__source-main {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 34px 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--color-surface);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &.is-current {
    border-color: var(--color-accent);
    background: var(--color-surface);
    box-shadow: 0 0 0 3px var(--color-accent-soft);
  }
}

.lmm__source-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lmm__source-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lmm__source-path {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lmm__source-meta {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lmm__remove {
  position: absolute;
  top: 8px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-danger-strong);
  }

  &:focus-visible {
    outline: none;
    opacity: 1;
    box-shadow: var(--focus-ring);
  }
}

.lmm__source:hover .lmm__remove,
.lmm__source-main.is-current + .lmm__remove {
  opacity: 1;
}

.lmm__pill {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 20px;

  &.is-ok {
    background: var(--color-success-soft);
    color: var(--color-success-strong);
  }

  &.is-warning {
    background: var(--color-warning-soft);
    color: #8a3f04;
  }

  &.is-blocked {
    background: var(--color-danger-soft);
    color: var(--color-danger-strong);
  }
}

.lmm__detail {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 22px;
}

.lmm__result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #b7e4c7;
  border-radius: 10px;
  background: #f0fdf4;
  color: #14532d;
  font-size: 13px;

  strong {
    font-size: 13.5px;
  }
}

.lmm__result-failed {
  color: var(--color-danger-strong);
}

.lmm__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lmm__section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.lmm__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.lmm__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
}

.lmm__input {
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 13.5px;
  font-weight: 400;

  &::placeholder {
    color: var(--color-placeholder);
  }

  &:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    background: var(--control-bg-disabled);
    color: var(--color-text-muted);
  }
}

.lmm__check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;

  :deep(svg) {
    flex: 0 0 auto;
    margin-top: 2px;
  }

  &.is-ok {
    border: 1px solid #b7e4c7;
    background: #f0fdf4;
    color: #14532d;
  }

  &.is-warning {
    border: 1px solid #f2d6a5;
    background: #fffaf0;
    color: #7a3d06;
  }

  &.is-blocked {
    border: 1px solid #f3b9b9;
    background: var(--color-danger-soft);
    color: var(--color-danger-strong);
  }
}

.lmm__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.lmm__facts {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 72px minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0;
  font-size: 13px;

  dt {
    color: var(--color-text-muted);
  }

  dd {
    margin: 0;
    min-width: 0;
  }

  .is-wide {
    grid-column: span 3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .is-mono {
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 12px;
  }
}

.lmm__signals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    padding: 1px 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface-hover);
    color: var(--color-text-secondary);
    font-size: 12px;
  }
}

.lmm__target {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);

  &.is-missing {
    border-color: #f2d6a5;
    background: #fffaf0;
  }
}

.lmm__target-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lmm__target-kind {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
}

.lmm__target-path {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lmm__target-hint {
  color: #7a3d06;
  font-size: 12.5px;
}

.lmm__footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
}

.lmm__summary {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 13px;

  strong {
    font-weight: 600;
  }

  .is-ok {
    color: var(--color-success-strong);
  }

  .is-warning {
    color: #8a3f04;
  }

  .is-blocked {
    color: var(--color-danger-strong);
  }
}

.lmm__spinner {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: lmm-spin 0.7s linear infinite;

  &.is-large {
    width: 20px;
    height: 20px;
    color: var(--color-accent);
  }
}

.lmm-bind {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lmm-bind__body,
.lmm-bind__note {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13.5px;
  line-height: 1.65;
}

.lmm-bind__note {
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.lmm-bind__paths {
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-soft);
  list-style: none;

  li {
    overflow: hidden;
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 12px;
    line-height: 1.8;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@keyframes lmm-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .lmm__mode-cards {
    grid-template-columns: 1fr;
  }

  .lmm__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(120px, 34%) minmax(0, 1fr);
  }

  .lmm__sources {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .lmm__toolbar {
    flex-wrap: wrap;

    :deep(.vx-segmented) {
      width: 100%;
    }
  }
}
</style>
