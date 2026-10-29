<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, ref, watch } from 'vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { ToolIcon, ToolIconButton, ToolNotice } from '@renderer/component/tool-page'
import NexusJsonEditorPanel from '@views/game/nexus/component/NexusJsonEditorPanel.vue'
import InstallRuleMappingEditor from '@views/game/nexus/component/config-page/InstallRuleMappingEditor.vue'
import InstallRuleReferencePanel from './InstallRuleReferencePanel.vue'
import { buildInstallRuleOutline, findOutlineRuleAtLine } from '../install-rule-outline.js'
import {
  CURRENT_RULE_SCHEMA_VERSION,
  detectRuleSchemaVersion,
  migrateInstallRuleSchema
} from '../../../../../../shared/installation/install-rule-compiler.js'

// 安装配置页「编辑规则」页签：工具栏 + 规则大纲 + 浅色 JSON 编辑器 + 可收起的编写指南。
// 规格见 Vertex 项目文档《安装配置页 UI 重设计方案》方案 B。
const props = defineProps({
  modelValue: { type: String, default: '' },
  currentSourceText: { type: String, default: '' },
  validationError: { type: String, default: '' },
  saveLoading: { type: Boolean, default: false },
  // 编辑内容与已保存内容不同（有未保存的草稿）。
  dirty: { type: Boolean, default: false },
  // 当前生效的是本地修改且有官方规则可恢复。
  canRestoreOfficial: { type: Boolean, default: false },
  guideOpen: { type: Boolean, default: true }
})

const emit = defineEmits([
  'update:modelValue',
  'update:guideOpen',
  'save',
  'discard',
  'use-official'
])

const editorPanelRef = ref(null)
const mappingOpen = ref(false)
const mappingError = ref('')
const cursorLine = ref(1)
const syntax = ref({ status: 'empty', errorLine: null })
const migrateDialog = ref({ open: false, nextText: '' })
const migrateError = ref('')

// ===== 大纲 =====
// JSON 暂时无效时沿用上一次有效的说明和目标，只更新行号。
let lastValidDetails = new Map()
const outline = computed(() => {
  const result = buildInstallRuleOutline(props.modelValue)
  if (result.valid) {
    lastValidDetails = new Map(result.rules.map((rule) => [rule.id, rule]))
    return result
  }
  return {
    ...result,
    rules: result.rules.map((rule) => {
      const previous = lastValidDetails.get(rule.id)
      return previous
        ? { ...rule, description: previous.description, target: previous.target }
        : rule
    })
  }
})

const activeRule = computed(() => findOutlineRuleAtLine(outline.value.rules, cursorLine.value))
const errorRule = computed(() => findOutlineRuleAtLine(outline.value.rules, syntax.value.errorLine))
const activeSectionKey = computed(() => {
  if (activeRule.value) return ''
  const before = outline.value.sections.filter((section) => section.line <= cursorLine.value)
  return before.length ? before[before.length - 1].key : ''
})

const hasBlockingError = computed(
  () => syntax.value.status === 'invalid' || !!String(props.validationError || '').trim()
)
const canFormat = computed(() => !!editorPanelRef.value?.canFormat)
const saveDisabledReason = computed(() => {
  if (hasBlockingError.value) return uiText('ui.fixErrorsBeforeSaving')
  if (!props.dirty) return uiText('ui.noChangesToSave')
  return ''
})

function goToLine(line) {
  editorPanelRef.value?.goToLine(line)
}

function handleCursorChange(position = {}) {
  cursorLine.value = Number(position.line || 1)
}

function handleSyntaxChange(state = {}) {
  syntax.value = { status: state.status || 'empty', errorLine: state.errorLine || null }
}

function toggleGuide() {
  emit('update:guideOpen', !props.guideOpen)
}

function formatEditor() {
  editorPanelRef.value?.format()
}

function handleSave() {
  if (props.saveLoading || hasBlockingError.value) return
  emit('save')
}

// ===== 手动映射：生成一条映射规则，插到 install_rules 最前面 =====
function applyMapping(rule) {
  try {
    const document = props.modelValue.trim()
      ? JSON.parse(props.modelValue)
      : { schema_version: CURRENT_RULE_SCHEMA_VERSION, install_rules: [] }
    const rules = document.install_rules || document.installRules || []
    document.install_rules = [rule, ...rules]
    delete document.installRules
    emit('update:modelValue', JSON.stringify(document, null, 2))
    mappingError.value = ''
    mappingOpen.value = false
  } catch {
    mappingError.value = '请先修复当前规则 JSON，再加入映射。'
    mappingOpen.value = false
  }
}

// ===== 迁移到当前 schema：旧版本号或 match 里用了 camelCase 别名时出现 =====
const MIGRATE_ALIAS_KEYS = new Set([
  'rootHasDirs',
  'allRootDirs',
  'requiredDirs',
  'anyRootDirs',
  'rootHasAnyDirs',
  'noneRootDirs',
  'rootHasNoDirs',
  'rootHasFiles',
  'allRootFiles',
  'requiredFiles',
  'anyRootFiles',
  'rootHasAnyFiles',
  'noneRootFiles',
  'rootHasNoFiles',
  'anyFileNames',
  'allFileNames',
  'noneFileNames',
  'anyFilePatterns',
  'hasFilePattern',
  'allFilePatterns',
  'noneFilePatterns',
  'anyDirPatterns',
  'allDirPatterns',
  'noneDirPatterns',
  'anyFileExtensions',
  'allFileExtensions',
  'noneFileExtensions',
  'minFileCount',
  'maxFileCount',
  'rootEntryCountMin',
  'rootEntryCountMax'
])

function hasAliasKeys(matchList = []) {
  return matchList.some(
    (match) =>
      match &&
      typeof match === 'object' &&
      Object.keys(match).some((key) => MIGRATE_ALIAS_KEYS.has(key))
  )
}

function containsCamelCaseAlias(ruleObject = {}) {
  if (!ruleObject || typeof ruleObject !== 'object') return false
  const installRules = Array.isArray(ruleObject.install_rules)
    ? ruleObject.install_rules
    : Array.isArray(ruleObject.installRules)
      ? ruleObject.installRules
      : []
  return installRules.some((rule) => {
    if (!rule || typeof rule !== 'object') return false
    if (hasAliasKeys([rule.match, rule.when])) return true
    return (
      Array.isArray(rule.routes) &&
      rule.routes.some(
        (route) => route && typeof route === 'object' && hasAliasKeys([route.match, route.when])
      )
    )
  })
}

const showMigrateButton = computed(() => {
  const text = String(props.modelValue || '').trim()
  if (!text) return false
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  return (
    detectRuleSchemaVersion(parsed) < CURRENT_RULE_SCHEMA_VERSION || containsCamelCaseAlias(parsed)
  )
})

function handleMigrateSchema() {
  migrateError.value = ''
  const text = String(props.modelValue || '').trim()
  if (!text) return
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    migrateError.value = uiText('ui.cannotMigrateTheEditorContentIsNotValidJSONValue', { value1: (error?.message || error) })
    return
  }
  try {
    const migrated = migrateInstallRuleSchema(JSON.parse(JSON.stringify(parsed)))
    migrateDialog.value = { open: true, nextText: JSON.stringify(migrated, null, 2) }
  } catch (error) {
    migrateError.value = uiText('ui.migrationFailedValue', { value1: (String(error?.message || error)) })
  }
}

function applyMigration() {
  emit('update:modelValue', migrateDialog.value.nextText)
}

// 页签从隐藏切回显示时由页面调用，让编辑器重新测量尺寸。
function refresh() {
  nextTick(() => editorPanelRef.value?.refresh())
}

watch(
  () => props.guideOpen,
  () => refresh()
)

defineExpose({ refresh, focus: () => editorPanelRef.value?.focus() })
</script>

<template>
  <section class="source-rule-editor" :aria-label="$t('ui.editRules')">
    <div class="source-rule-editor__toolbar">
      <div class="source-rule-editor__context">
        <span class="tool-tag">{{ $t('ui.localCopy') }}</span>
        <span class="source-rule-editor__base" :title="currentSourceText || $t('ui.localRules')">
          {{ $t('ui.basedOn') }} {{ currentSourceText || $t('ui.localRules') }}
        </span>
        <span v-if="dirty" class="tool-status is-warning">{{ $t('ui.unsavedDraftRetained') }}</span>
      </div>

      <div class="source-rule-editor__actions">
        <VxButton
          variant="ghost"
          size="sm"
          :disabled="saveLoading"
          class="source-rule-editor__tool"
          @click="mappingOpen = true"
        >
          <ToolIcon name="mapping" :size="15" />
          {{ $t('ui.manualMapping') }}
        </VxButton>
        <VxButton
          variant="ghost"
          size="sm"
          class="source-rule-editor__tool source-rule-editor__guide-toggle"
          :class="{ 'is-pressed': guideOpen }"
          :aria-pressed="guideOpen"
          @click="toggleGuide"
        >
          <ToolIcon name="book" :size="15" />
          {{ $t('ui.ruleGuide') }}
        </VxButton>
        <VxButton
          v-if="showMigrateButton"
          variant="ghost"
          size="sm"
          class="source-rule-editor__tool"
          @click="handleMigrateSchema"
        >
          <ToolIcon name="arrow-up" :size="15" />
          {{ $t('ui.migrateToSchemaV') }}{{ CURRENT_RULE_SCHEMA_VERSION }}
        </VxButton>
        <VxButton
          variant="ghost"
          size="sm"
          class="source-rule-editor__tool"
          :disabled="!canFormat"
          @click="formatEditor"
        >
          {{ $t('ui.format') }}
        </VxButton>
        <span class="source-rule-editor__divider" aria-hidden="true"></span>
        <VxButton
          v-if="canRestoreOfficial"
          variant="secondary"
          size="sm"
          :disabled="saveLoading"
          @click="emit('use-official')"
        >
          {{ $t('ui.restoreOfficialRules') }}
        </VxButton>
        <VxButton
          v-if="dirty"
          variant="secondary"
          size="sm"
          :disabled="saveLoading"
          @click="emit('discard')"
        >
          {{ $t('ui.discardChanges') }}
        </VxButton>
        <VxButton
          variant="primary"
          size="sm"
          class="source-rule-editor__save"
          :loading="saveLoading"
          :disabled="!!saveDisabledReason"
          :title="saveDisabledReason || 'Ctrl+S'"
          @click="handleSave"
        >
          {{ $t('ui.saveLocally') }}
        </VxButton>
      </div>
    </div>

    <ToolNotice v-if="mappingError || migrateError" tone="danger">
      {{ mappingError || migrateError }}
      <template #actions>
        <ToolIconButton
          icon="close"
          :label="$t('ui.dismissNotification')"
          size="sm"
          @click="((mappingError = ''), (migrateError = ''))"
        />
      </template>
    </ToolNotice>
    <ToolNotice v-else-if="validationError && syntax.status !== 'invalid'" tone="danger">
      {{ validationError }}
    </ToolNotice>

    <div class="source-rule-editor__workspace" :class="{ 'has-guide': guideOpen }">
      <nav class="source-rule-editor__outline vx-ui-scrollbar" :aria-label="$t('ui.ruleOutline')">
        <div class="source-rule-editor__outline-title">{{ $t('ui.outline') }}</div>
        <button
          v-for="section in outline.sections"
          :key="section.key"
          type="button"
          class="source-rule-editor__item"
          :class="{ 'is-active': activeSectionKey === section.key }"
          :title="$t('ui.valueLineValue', { value1: (section.label), value2: (section.line) })"
          @click="goToLine(section.line)"
        >
          <span class="source-rule-editor__item-id">{{ section.key }}</span>
          <span class="source-rule-editor__item-line">{{ section.line }}</span>
        </button>

        <button
          v-if="outline.ruleListLine"
          type="button"
          class="source-rule-editor__group"
          @click="goToLine(outline.ruleListLine)"
        >
          <span>install_rules</span>
          <small>{{ outline.rules.length }}</small>
        </button>
        <p v-if="!outline.rules.length" class="source-rule-editor__outline-empty">
          {{ outline.ruleListLine ? $t('ui.noInstallationRulesYet') : $t('ui.noInstallRulesFound') }}
        </p>
        <button
          v-for="rule in outline.rules"
          :key="rule.key"
          type="button"
          class="source-rule-editor__item is-rule"
          :class="{
            'is-active': activeRule?.key === rule.key,
            'has-error': errorRule?.key === rule.key
          }"
          :aria-current="activeRule?.key === rule.key ? 'location' : undefined"
          :title="
            [rule.id, rule.description, rule.target && `安装到 ${rule.target}`]
              .filter(Boolean)
              .join('\n')
          "
          @click="goToLine(rule.start)"
        >
          <span class="source-rule-editor__dot" aria-hidden="true"></span>
          <span class="source-rule-editor__item-body">
            <span class="source-rule-editor__item-id">{{ rule.id }}</span>
            <span v-if="rule.target" class="source-rule-editor__item-target">
              → {{ rule.target }}
            </span>
          </span>
          <span class="source-rule-editor__item-line">{{ rule.start }}</span>
          <span v-if="errorRule?.key === rule.key" class="tool-visually-hidden"
            >{{ $t('ui.syntaxErrors') }}</span
          >
        </button>

        <div v-if="activeRule" class="source-rule-editor__current" aria-live="polite">
          <span class="source-rule-editor__current-label">{{ $t('ui.ruleAtCursor') }}</span>
          <strong>{{ activeRule.id }}</strong>
          <span v-if="activeRule.description">{{ activeRule.description }}</span>
          <span v-if="activeRule.target">{{ $t('dialogs.configDetail.ruleTarget') }} {{ activeRule.target }}</span>
        </div>
      </nav>

      <div class="source-rule-editor__editor">
        <NexusJsonEditorPanel
          ref="editorPanelRef"
          :model-value="modelValue"
          :validation-error="''"
          :save-shortcut-enabled="true"
          :show-format-button="false"
          @update:model-value="emit('update:modelValue', $event)"
          @save-shortcut="handleSave"
          @cursor-change="handleCursorChange"
          @syntax-change="handleSyntaxChange"
        />
      </div>

      <aside v-if="guideOpen" class="source-rule-editor__guide" :aria-label="$t('ui.ruleAuthoringGuide')">
        <div class="source-rule-editor__guide-head">
          <span class="source-rule-editor__guide-title">{{ $t('ui.ruleAuthoringGuide') }}</span>
          <ToolIconButton icon="close" :label="$t('ui.closeGuide')" size="sm" @click="toggleGuide" />
        </div>
        <InstallRuleReferencePanel class="source-rule-editor__guide-body" />
      </aside>
    </div>

    <InstallRuleMappingEditor
      :open="mappingOpen"
      @close="mappingOpen = false"
      @apply="applyMapping"
    />

    <VxConfirmModal
      v-model="migrateDialog.open"
      :title="$t('ui.migrateToSchemaVValue', { value1: (CURRENT_RULE_SCHEMA_VERSION) })"
      :content="$t('ui.convertsCamelCaseAliasesInMatchToStandardSnakeCaseFields')"
      :confirm-text="$t('ui.applyMigration')"
      @confirm="applyMigration"
    />
  </section>
</template>

<style scoped lang="scss">
.source-rule-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
}

.source-rule-editor__toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.source-rule-editor__context {
  display: flex;
  flex: 1 1 280px;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px var(--space-2);
  min-width: 0;
}

.source-rule-editor__base {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.source-rule-editor__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.source-rule-editor__tool :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.source-rule-editor__guide-toggle.is-pressed {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
}

.source-rule-editor__divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--color-border);
}

.source-rule-editor__save {
  min-width: 92px;
}

// ===== 工作区：大纲 | 编辑器 | 指南 =====
.source-rule-editor__workspace {
  position: relative;
  display: grid;
  flex: 1;
  grid-template-columns: 216px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;

  &.has-guide {
    grid-template-columns: 216px minmax(0, 1fr) minmax(280px, 340px);
  }
}

.source-rule-editor__outline {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: var(--space-3) var(--space-2);
  overflow-y: auto;
  background: var(--color-surface-soft);
  border-right: 1px solid var(--color-border);

  // 规则多时大纲滚动，条目本身不压缩。
  > * {
    flex-shrink: 0;
  }
}

.source-rule-editor__outline-title {
  padding: 0 10px 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.source-rule-editor__outline-empty {
  margin: 0;
  padding: 4px 10px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.source-rule-editor__group,
.source-rule-editor__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 30px;
  padding: 4px 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.source-rule-editor__group {
  justify-content: space-between;
  margin-top: var(--space-2);
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-weight: var(--font-weight-semibold);

  small {
    color: var(--color-text-muted);
    font-family: var(--font-family-base);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
  }
}

.source-rule-editor__item {
  &.is-active {
    color: var(--color-accent-strong);
    background: var(--color-accent-soft);
  }

  &.is-rule {
    align-items: flex-start;
  }
}

.source-rule-editor__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  background: var(--color-border-strong);
  border-radius: 50%;

  .is-active & {
    background: var(--color-accent);
  }

  .has-error & {
    background: var(--color-danger);
  }
}

.source-rule-editor__item-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;
}

.source-rule-editor__item-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  white-space: nowrap;
  text-overflow: ellipsis;

  .is-active & {
    color: var(--color-accent-strong);
  }
}

.source-rule-editor__item-target {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.source-rule-editor__item-line {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.source-rule-editor__current {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: auto 2px 0;
  padding: 10px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;

  strong {
    color: var(--color-text);
    font-family: var(--font-family-mono);
    font-weight: var(--font-weight-semibold);
  }
}

.source-rule-editor__current-label {
  color: var(--color-text-muted);
}

.source-rule-editor__editor {
  display: flex;
  min-width: 0;
  min-height: 0;

  :deep(.nexus-json-editor-panel) {
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
  }
}

.source-rule-editor__guide {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
}

.source-rule-editor__guide-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 44px;
  padding: 0 var(--space-2) 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.source-rule-editor__guide-title {
  font-size: 13.5px;
  font-weight: var(--font-weight-semibold);
}

.source-rule-editor__guide-body {
  flex: 1;
  min-height: 0;
  padding: var(--space-3) var(--space-4);
}

// 窄窗口：指南盖在编辑器右侧，大纲收窄。
@media (max-width: 1180px) {
  .source-rule-editor__workspace,
  .source-rule-editor__workspace.has-guide {
    grid-template-columns: 184px minmax(0, 1fr);
  }

  .source-rule-editor__guide {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    width: min(340px, 80%);
    box-shadow: var(--shadow-lg);
  }
}

@media (max-width: 860px) {
  .source-rule-editor__workspace,
  .source-rule-editor__workspace.has-guide {
    grid-template-columns: minmax(0, 1fr);
  }

  .source-rule-editor__outline {
    display: none;
  }
}
</style>
