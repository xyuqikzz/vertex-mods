<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { json, jsonLanguage } from '@codemirror/lang-json'
import {
  getDeclarationDiagnostic,
  INSTALL_RULE_COMPLETIONS
} from '../../../../../../shared/installation/install-rule-authoring.js'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  validationError: {
    type: String,
    default: ''
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  placeholder: {
    type: String,
    default: undefined
  },
  formatButtonText: {
    type: String,
    default: undefined
  },
  shortcutText: {
    type: String,
    default: undefined
  },
  saveShortcutEnabled: {
    type: Boolean,
    default: false
  },
  // 外层工具栏自带「格式化」时传 false，改为调用 expose 的 format()。
  showFormatButton: {
    type: Boolean,
    default: true
  },
  height: {
    type: String,
    default: '100%'
  }
})

const emit = defineEmits(['update:modelValue', 'save-shortcut', 'cursor-change', 'syntax-change'])

const editorHostRef = ref(null)
const localEditorText = ref('')
const cursorPosition = ref({ line: 1, column: 1 })
let editorViewInstance = null

function getLineColumnByPosition(sourceText = '', position = 0) {
  const safeText = String(sourceText || '')
  const safePosition = Math.max(0, Math.min(Number(position || 0), safeText.length))
  const beforeText = safeText.slice(0, safePosition)
  const lines = beforeText.split(/\r?\n/)
  const currentLine = lines[lines.length - 1] || ''

  return {
    lineNumber: lines.length,
    columnNumber: currentLine.length + 1
  }
}

function translateJsonErrorReason(message = '') {
  const sourceMessage = String(message || '').trim()
  if (!sourceMessage) {
    return uiText('ui.jSONSyntaxError')
  }

  if (/Expected double-quoted property name in JSON/i.test(sourceMessage)) {
    return uiText('ui.objectPropertyNamesMustUseDoubleQuotes')
  }
  if (/Expected ',' or '}' after property value in JSON/i.test(sourceMessage)) {
    return uiText('ui.aCommaOrClosingBraceIsMissingAfterAnObject')
  }
  if (/Expected ',' or '\]' after array element in JSON/i.test(sourceMessage)) {
    return uiText('ui.aCommaOrClosingBracketIsMissingAfterAnArray')
  }
  if (/Expected ':' after property name in JSON/i.test(sourceMessage)) {
    return uiText('ui.aColonIsMissingAfterAnObjectPropertyName')
  }
  if (/Unexpected end of JSON input/i.test(sourceMessage)) {
    return uiText('ui.jSONInputIsIncomplete')
  }
  if (/Unexpected non-whitespace character after JSON/i.test(sourceMessage)) {
    return uiText('ui.extraContentAfterTheEndOfJSON')
  }
  if (/No number after minus sign in JSON/i.test(sourceMessage)) {
    return uiText('ui.aDigitIsMissingAfterTheMinusSign')
  }
  if (/Unterminated string in JSON/i.test(sourceMessage)) {
    return uiText('ui.aClosingQuoteIsMissingFromAString')
  }
  if (/Bad control character in string literal in JSON/i.test(sourceMessage)) {
    return uiText('ui.aStringContainsAnInvalidControlCharacter')
  }
  if (/Bad escaped character in JSON/i.test(sourceMessage)) {
    return uiText('ui.invalidEscapeCharacter')
  }
  if (/Bad Unicode escape in JSON/i.test(sourceMessage)) {
    return uiText('ui.invalidUnicodeEscape')
  }
  if (/Unexpected token/i.test(sourceMessage)) {
    return uiText('ui.aCharacterIsNotValidJSONSyntax')
  }

  return uiText('ui.jSONSyntaxError')
}

function resolveJsonErrorDetail(error, sourceText = '') {
  const rawMessage = String(error?.message || 'JSON 解析失败')
  const message = translateJsonErrorReason(rawMessage)
  const lineColumnMatch = rawMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  const positionMatch = rawMessage.match(/position\s+(\d+)/i)
  let lineNumber = null
  let columnNumber = null
  let position = null

  if (lineColumnMatch) {
    lineNumber = Number(lineColumnMatch[1] || 0) || null
    columnNumber = Number(lineColumnMatch[2] || 0) || null
  }

  if (positionMatch) {
    position = Number(positionMatch[1] || 0) || 0
  }

  if ((!lineNumber || !columnNumber) && position !== null) {
    const lineColumn = getLineColumnByPosition(sourceText, position)
    lineNumber = lineColumn.lineNumber
    columnNumber = lineColumn.columnNumber
  }

  return {
    message,
    position,
    lineNumber,
    columnNumber,
    lineText: lineNumber ? String(lineNumber) : '--',
    columnText: columnNumber ? String(columnNumber) : '--'
  }
}

function resolveJsonSyntaxState(sourceText = '') {
  const safeText = String(sourceText || '')

  if (!safeText.trim()) {
    return {
      status: 'empty',
      get statusText() { return uiText('ui.waitingForInput') },
      parsedValue: null,
      error: null
    }
  }

  try {
    const parsedValue = JSON.parse(safeText)
    return {
      status: 'valid',
      get statusText() { return uiText('ui.validJSON') },
      parsedValue,
      error: null
    }
  } catch (error) {
    return {
      status: 'invalid',
      get statusText() { return uiText('ui.invalidJSONVariant2') },
      parsedValue: null,
      error: resolveJsonErrorDetail(error, safeText)
    }
  }
}

function resolveErrorSelectionRange(state, errorDetail = null) {
  if (!errorDetail?.lineNumber || !errorDetail?.columnNumber) {
    return null
  }

  const safeLineNumber = Math.max(1, Math.min(Number(errorDetail.lineNumber || 0), state.doc.lines))
  const line = state.doc.line(safeLineNumber)
  const offsetInLine = Math.max(0, Math.min(Number(errorDetail.columnNumber || 1) - 1, line.length))
  const from = line.from + offsetInLine
  const to = Math.min(line.to, from + 1)

  return {
    lineFrom: line.from,
    from,
    to
  }
}

// 浅色主题：颜色全部取 vertex-ui token，白底上对比度均不低于 4.5:1。
const jsonEditorHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: 'var(--color-accent-strong)' },
    { tag: tags.string, color: 'var(--color-success-strong)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--color-warning-strong)' },
    { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: 'var(--color-danger-strong)' },
    { tag: [tags.bracket, tags.punctuation, tags.separator], color: 'var(--color-text-tertiary)' }
  ])
)

const jsonEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: '12.5px'
  },
  '&.cm-focused': {
    outline: 'none'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-family-mono)',
    lineHeight: '22px'
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '10px 0',
    caretColor: 'var(--color-text)'
  },
  '.cm-line': {
    padding: '0 16px 0 6px',
    lineHeight: '22px'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-muted)',
    border: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '32px',
    padding: '0 6px 0 12px',
    lineHeight: '22px',
    textAlign: 'right'
  },
  '.cm-foldGutter .cm-gutterElement': {
    width: '14px',
    color: 'var(--color-text-muted)',
    cursor: 'pointer'
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white))'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white))',
    color: 'var(--color-text)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-text)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent) !important'
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-accent-soft)',
    outline: 'none'
  },
  '.cm-foldPlaceholder': {
    margin: '0 2px',
    padding: '0 6px',
    color: 'var(--color-text-tertiary)',
    backgroundColor: 'var(--color-surface-strong)',
    border: 'none',
    borderRadius: 'var(--radius-xs)'
  },
  '.cm-placeholder': {
    color: 'var(--color-placeholder)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-surface-soft)',
    color: 'var(--color-text)'
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--color-border)'
  },
  '.cm-tooltip': {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    boxShadow: 'var(--shadow-md)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent-soft)',
    color: 'var(--color-accent-strong)'
  },
  '.cm-diagnostic': {
    fontFamily: 'var(--font-family-base)'
  },
  '.cm-diagnostic-error': {
    borderLeft: '3px solid var(--color-danger)'
  }
})

const jsonSyntaxState = ref({
  status: 'empty',
  get statusText() { return uiText('ui.waitingForInput') },
  parsedValue: null,
  error: null
})

function markJsonSyntaxPending(sourceText = '') {
  if (!String(sourceText || '').trim()) {
    jsonSyntaxState.value = resolveJsonSyntaxState('')
    return
  }
  jsonSyntaxState.value = {
    status: 'checking',
    get statusText() { return uiText('taskCenter.itemStates.health_checking') },
    parsedValue: null,
    error: null
  }
}

const jsonDiagnosticsExtension = linter(
  (view) => {
    const syntaxState = resolveJsonSyntaxState(view.state.doc.toString())
    jsonSyntaxState.value = syntaxState
    if (syntaxState.status === 'valid' && syntaxState.parsedValue) {
      const diagnostic = getDeclarationDiagnostic(syntaxState.parsedValue)
      if (diagnostic)
        return [
          {
            from: 0,
            to: Math.min(1, view.state.doc.length),
            severity: 'error',
            message: diagnostic.message
          }
        ]
    }
    if (syntaxState.status !== 'invalid' || !syntaxState.error) {
      return []
    }

    const range = resolveErrorSelectionRange(view.state, syntaxState.error)
    if (!range) {
      return []
    }

    return [
      {
        from: range.from,
        to: Math.max(range.from + 1, range.to),
        severity: 'error',
        message: uiText('ui.lineValueColumnValueValue', { value1: (syntaxState.error.lineText), value2: (syntaxState.error.columnText), value3: (syntaxState.error.message) })
      }
    ]
  },
  { delay: 200 }
)

const normalizedEditorText = computed(() => String(localEditorText.value ?? ''))

const editorLineCount = computed(() => {
  return Math.max(normalizedEditorText.value.split(/\r?\n/).length, 1)
})

const editorCharacterCount = computed(() => {
  return normalizedEditorText.value.length
})

const editorStatusTone = computed(() => {
  if (jsonSyntaxState.value.status === 'valid') {
    return 'valid'
  }
  if (jsonSyntaxState.value.status === 'invalid') {
    return 'invalid'
  }
  if (jsonSyntaxState.value.status === 'checking') {
    return 'checking'
  }
  return 'empty'
})

const canFormatEditorText = computed(() => {
  return !props.readOnly && jsonSyntaxState.value.status === 'valid'
})

// 语法错误所在行；只有 JSON 语法错误能定位，规则校验错误没有行号。
const editorErrorLine = computed(() => {
  if (jsonSyntaxState.value.status !== 'invalid') return null
  return jsonSyntaxState.value.error?.lineNumber || null
})

watch(
  () => [jsonSyntaxState.value.status, editorErrorLine.value],
  ([status, errorLine]) => emit('syntax-change', { status, errorLine }),
  { immediate: true }
)

const editorInlineErrorText = computed(() => {
  if (jsonSyntaxState.value.status === 'invalid' && jsonSyntaxState.value.error) {
    const { lineText, columnText, message } = jsonSyntaxState.value.error
    return uiText('ui.lineValueColumnValueValue', { value1: (lineText), value2: (columnText), value3: (message) })
  }

  const validationMessage = String(props.validationError || '').trim()
  return validationMessage || ''
})

function syncLocalEditorText(nextText = '') {
  const safeText = String(nextText ?? '')
  if (safeText === localEditorText.value) {
    return
  }
  localEditorText.value = safeText
  markJsonSyntaxPending(safeText)
}

function syncEditorViewText(nextText = '') {
  const safeText = String(nextText ?? '')
  const view = editorViewInstance
  if (!view) {
    syncLocalEditorText(safeText)
    emit('update:modelValue', safeText)
    return
  }

  const currentText = view.state.doc.toString()
  if (currentText === safeText) {
    syncLocalEditorText(safeText)
    return
  }

  const selectionAnchor = Math.min(view.state.selection.main.head, safeText.length)
  view.dispatch({
    changes: {
      from: 0,
      to: currentText.length,
      insert: safeText
    },
    selection: { anchor: selectionAnchor }
  })
}

function handleFormatEditor() {
  if (!canFormatEditorText.value) {
    return
  }

  const formattedText = JSON.stringify(jsonSyntaxState.value.parsedValue, null, 2)
  const view = editorViewInstance
  if (!view) {
    syncLocalEditorText(formattedText)
    emit('update:modelValue', formattedText)
    return
  }

  const selectionAnchor = Math.min(view.state.selection.main.head, formattedText.length)
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: formattedText
    },
    selection: { anchor: selectionAnchor },
    scrollIntoView: true
  })
  view.focus()
}

function goToLine(lineNumber = 1, options = {}) {
  const view = editorViewInstance
  if (!view) return
  const safeLine = Math.max(1, Math.min(Number(lineNumber || 1), view.state.doc.lines))
  const line = view.state.doc.line(safeLine)
  const column = Math.max(0, Math.min(Number(options.column || 1) - 1, line.length))
  view.dispatch({
    selection: { anchor: line.from + column },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 48 })
  })
  view.focus()
}

function goToError() {
  const error = jsonSyntaxState.value.error
  if (error?.lineNumber) goToLine(error.lineNumber, { column: error.columnNumber })
}

// 编辑器在 v-show 隐藏期间挂载或尺寸变化后，显示时需要重新测量。
function refresh() {
  editorViewInstance?.requestMeasure()
}

function createEditorExtensions() {
  const extensions = [
    basicSetup,
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    json(),
    jsonLanguage.data.of({
      autocomplete: (context) => {
        const token = context.matchBefore(/"[a-zA-Z0-9_.-]*/)
        return token ? { from: token.from + 1, options: INSTALL_RULE_COMPLETIONS } : null
      }
    }),
    editorPlaceholder((props.placeholder ?? uiText('ui.ruleJsonPlaceholder'))),
    jsonEditorTheme,
    jsonEditorHighlightStyle,
    jsonDiagnosticsExtension,
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head
        const line = update.state.doc.lineAt(head)
        cursorPosition.value = { line: line.number, column: head - line.from + 1 }
        emit('cursor-change', { ...cursorPosition.value })
      }
      if (!update.docChanged || props.readOnly) {
        return
      }

      const nextText = update.state.doc.toString()
      localEditorText.value = nextText
      markJsonSyntaxPending(nextText)
      emit('update:modelValue', nextText)
    })
  ]

  if (props.readOnly) {
    extensions.push(EditorState.readOnly.of(true))
    extensions.push(EditorView.editable.of(false))
    return extensions
  }

  extensions.push(
    keymap.of([
      ...(props.saveShortcutEnabled
        ? [
            {
              key: 'Mod-s',
              run: () => {
                emit('save-shortcut')
                return true
              }
            }
          ]
        : []),
      {
        key: 'Alt-Shift-f',
        run: () => {
          handleFormatEditor()
          return true
        }
      },
      indentWithTab
    ])
  )

  return extensions
}

function destroyEditorView() {
  if (!editorViewInstance) {
    return
  }

  editorViewInstance.destroy()
  editorViewInstance = null
}

function ensureEditorView() {
  if (editorViewInstance || !editorHostRef.value) {
    return
  }

  editorViewInstance = new EditorView({
    state: EditorState.create({
      doc: normalizedEditorText.value,
      extensions: createEditorExtensions()
    }),
    parent: editorHostRef.value
  })
}

async function recreateEditorView() {
  destroyEditorView()
  await nextTick()
  ensureEditorView()
}

watch(
  () => props.modelValue,
  (value) => {
    const safeText = String(value ?? '')
    if (safeText !== localEditorText.value) {
      syncLocalEditorText(safeText)
    }

    if (editorViewInstance && safeText !== editorViewInstance.state.doc.toString()) {
      syncEditorViewText(safeText)
    }
  },
  { immediate: true }
)

watch(
  () => props.readOnly,
  async () => {
    await recreateEditorView()
  }
)

onMounted(async () => {
  await nextTick()
  ensureEditorView()
})

onBeforeUnmount(() => {
  destroyEditorView()
})

defineExpose({
  format: handleFormatEditor,
  goToLine,
  goToError,
  refresh,
  focus: () => editorViewInstance?.focus(),
  canFormat: canFormatEditorText
})
</script>

<template>
  <div class="nexus-json-editor-panel" :class="{ 'is-readonly': readOnly }" :style="{ height }">
    <div class="nexus-json-editor-panel__stage">
      <div ref="editorHostRef" class="nexus-json-editor-panel__host"></div>
    </div>

    <div v-if="editorInlineErrorText" class="nexus-json-editor-panel__error" role="alert">
      <ToolIcon name="error" :size="15" />
      <span class="nexus-json-editor-panel__error-text">
        {{ editorInlineErrorText }}<template v-if="!readOnly">{{ $t('ui.fixTheErrorsBeforeSaving') }}</template>
      </span>
      <VxButton
        v-if="editorErrorLine"
        variant="ghost"
        size="sm"
        class="nexus-json-editor-panel__locate"
        @click="goToError"
      >
        {{ $t('ui.goTo') }}
      </VxButton>
    </div>

    <div class="nexus-json-editor-panel__toolbar">
      <div class="nexus-json-editor-panel__status" :class="`is-${editorStatusTone}`">
        <span class="nexus-json-editor-panel__status-label">
          <span class="nexus-json-editor-panel__status-dot" aria-hidden="true"></span>
          {{ jsonSyntaxState.statusText }}
        </span>
        <span v-if="!readOnly"
          >{{ $t('ui.line') }} {{ cursorPosition.line }} {{ $t('ui.column') }} {{ cursorPosition.column }} {{ $t('ui.columnVariant2') }}</span
        >
        <span>{{ editorLineCount }} {{ $t('ui.lines') }}</span>
        <span>{{ editorCharacterCount }} {{ $t('ui.characters') }}</span>
        <span v-if="readOnly" class="nexus-json-editor-panel__mode-text">{{ $t('ui.readOnlyPreview') }}</span>
      </div>

      <div class="nexus-json-editor-panel__actions">
        <span class="nexus-json-editor-panel__shortcut-text">
          {{ readOnly ? $t('ui.readOnlyScrollToViewTheFullJSON') : (shortcutText ?? $t('ui.editorShortcuts')) }}
        </span>
        <VxButton
          v-if="!readOnly && showFormatButton"
          variant="secondary"
          size="sm"
          class="nexus-json-editor-panel__format-button"
          :disabled="!canFormatEditorText"
          @click="handleFormatEditor"
        >
          {{ (formatButtonText ?? $t('ui.formatJson')) }}
        </VxButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.nexus-json-editor-panel {
  display: flex;
  flex-direction: column;
  min-height: 280px;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.nexus-json-editor-panel__stage {
  flex: 1;
  min-height: 0;
  background: var(--color-surface);
}

.nexus-json-editor-panel__host {
  height: 100%;
}

.nexus-json-editor-panel__host :deep(.cm-editor) {
  height: 100%;
}

.nexus-json-editor-panel__host :deep(.cm-scroller::-webkit-scrollbar) {
  width: 7px;
  height: 7px;
}

.nexus-json-editor-panel__host :deep(.cm-scroller::-webkit-scrollbar-track) {
  background: var(--scrollbar-track-color);
  border-radius: var(--radius-sm);
  margin: 12px 0;
}

.nexus-json-editor-panel__host :deep(.cm-scroller::-webkit-scrollbar-thumb) {
  background: var(--scrollbar-thumb-color);
  border-radius: 4px;
  min-height: 40px;
}

.nexus-json-editor-panel__host :deep(.cm-scroller::-webkit-scrollbar-thumb:hover) {
  background: var(--scrollbar-thumb-hover);
}

.nexus-json-editor-panel__error {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 4px var(--space-2) 4px 14px;
  color: var(--color-danger-strong);
  font-size: 12.5px;
  background: var(--color-danger-soft);
  border-top: 1px solid color-mix(in srgb, var(--color-danger) 24%, var(--color-white));
}

.nexus-json-editor-panel__error-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.nexus-json-editor-panel__locate {
  color: var(--color-danger-strong);
}

.nexus-json-editor-panel__toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px var(--space-4);
  min-height: 32px;
  padding: 3px var(--space-2) 3px 14px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-border);
}

.nexus-json-editor-panel__status {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.nexus-json-editor-panel__status-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-semibold);
}

.nexus-json-editor-panel__status-dot {
  width: 7px;
  height: 7px;
  background: var(--color-text-subtle);
  border-radius: 50%;
}

.nexus-json-editor-panel__status.is-valid {
  .nexus-json-editor-panel__status-label {
    color: var(--color-success-strong);
  }

  .nexus-json-editor-panel__status-dot {
    background: var(--color-success);
  }
}

.nexus-json-editor-panel__status.is-invalid {
  .nexus-json-editor-panel__status-label {
    color: var(--color-danger-strong);
  }

  .nexus-json-editor-panel__status-dot {
    background: var(--color-danger);
  }
}

.nexus-json-editor-panel__status.is-checking .nexus-json-editor-panel__status-dot {
  background: var(--color-accent);
}

.nexus-json-editor-panel__mode-text {
  color: var(--color-accent-strong);
}

.nexus-json-editor-panel__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.nexus-json-editor-panel__shortcut-text {
  white-space: nowrap;
}

@media (max-width: 960px) {
  .nexus-json-editor-panel__shortcut-text {
    display: none;
  }
}
</style>
