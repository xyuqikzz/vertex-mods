<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import {
  Compartment,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField
} from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutterLineClass, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// 配置文件原文编辑器：浅色 CodeMirror，配色与安装配置页的 JSON 编辑器一致。
// .cfg / .ini 用一个很小的 StreamLanguage 高亮注释、分组、键和值；.json 用 lang-json；其他格式只显示行号。
const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'plain' },
  lineEnding: { type: String, default: '\n' },
  // 1 起的行号：改过的行加浅橙底、行号变橙色。
  changedLines: { type: Array, default: () => [] },
  label: { type: String, default: undefined }
})

const emit = defineEmits(['update:modelValue'])

const hostRef = ref(null)
const cursor = ref({ line: 1, column: 1 })
const lineCount = ref(1)
let view = null
const languageCompartment = new Compartment()
const separatorCompartment = new Compartment()

const iniLanguage = StreamLanguage.define({
  name: 'ini',
  startState: () => ({ afterSeparator: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.afterSeparator = false
      stream.eatSpace()
      if (stream.match(/^[#;].*/)) return 'comment'
      if (stream.match(/^\[[^\]]*\]/)) return 'heading'
      if (stream.match(/^[^=]+?(?=\s*=)/)) return 'propertyName'
    }
    if (!state.afterSeparator && stream.match(/^\s*=\s*/)) {
      state.afterSeparator = true
      return 'operator'
    }
    stream.skipToEnd()
    return state.afterSeparator ? 'string' : null
  }
})

const highlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.comment, color: 'var(--color-text-tertiary)' },
    { tag: tags.heading, color: 'var(--color-accent-strong)', fontWeight: '600' },
    { tag: tags.propertyName, color: 'var(--color-accent-strong)' },
    { tag: tags.string, color: 'var(--color-success-strong)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--color-warning-strong)' },
    { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: 'var(--color-danger-strong)' },
    {
      tag: [tags.operator, tags.bracket, tags.punctuation, tags.separator],
      color: 'var(--color-text-tertiary)'
    }
  ])
)

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: '12.5px'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-family-mono)',
    lineHeight: '20px'
  },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--color-text)' },
  '.cm-line': { padding: '0 16px 0 6px' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-muted)',
    border: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '32px',
    padding: '0 8px 0 12px',
    textAlign: 'right'
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white))'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-soft) 38%, var(--color-white))',
    color: 'var(--color-text)'
  },
  '.cm-line.config-raw__changed': {
    backgroundColor: 'color-mix(in srgb, var(--color-warning-soft) 60%, var(--color-white))'
  },
  '.cm-gutterElement.config-raw__changed-gutter': {
    color: 'var(--color-warning-strong)',
    fontWeight: '600'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent) !important'
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-accent-soft)',
    outline: 'none'
  },
  '.cm-panels': { backgroundColor: 'var(--color-surface-soft)', color: 'var(--color-text)' },
  '.cm-tooltip': {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  }
})

class ChangedGutterMarker extends GutterMarker {
  elementClass = 'config-raw__changed-gutter'
}
const changedGutterMarker = new ChangedGutterMarker()
const changedLineDecoration = Decoration.line({ class: 'config-raw__changed' })

function resolveLanguage() {
  if (props.language === 'ini') return iniLanguage
  if (props.language === 'json') return json()
  return []
}

function buildChangedSets(state, changedLines) {
  const lines = [...new Set(changedLines || [])]
    .map((line) => Number(line))
    .filter((line) => Number.isInteger(line) && line >= 1 && line <= state.doc.lines)
    .sort((a, b) => a - b)
  const decorations = new RangeSetBuilder()
  const markers = new RangeSetBuilder()
  for (const lineNumber of lines) {
    const line = state.doc.line(lineNumber)
    decorations.add(line.from, line.from, changedLineDecoration)
    markers.add(line.from, line.from, changedGutterMarker)
  }
  return { decorations: decorations.finish(), markers: markers.finish() }
}

// 改过的行：由外层按解析结果给出行号；编辑过程中先随文本变化平移，外层更新后重建。
const setChangedLines = StateEffect.define()
const changedLinesField = StateField.define({
  create: () => ({ decorations: Decoration.none, markers: RangeSet.empty }),
  update(value, transaction) {
    let next = value
    if (transaction.docChanged) {
      next = {
        decorations: value.decorations.map(transaction.changes),
        markers: value.markers.map(transaction.changes)
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setChangedLines)) next = buildChangedSets(transaction.state, effect.value)
    }
    return next
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    gutterLineClass.from(field, (value) => value.markers)
  ]
})

function readText() {
  // sliceDoc 按 lineSeparator 拼接，保持文件原来的 CRLF / LF。
  return view ? view.state.sliceDoc() : ''
}

function updateStatus(state) {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  cursor.value = { line: line.number, column: head - line.from + 1 }
  lineCount.value = state.doc.lines
}

function createState(text) {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      separatorCompartment.of(EditorState.lineSeparator.of(props.lineEnding || '\n')),
      languageCompartment.of(resolveLanguage()),
      highlightStyle,
      editorTheme,
      changedLinesField,
      EditorView.contentAttributes.of({ 'aria-label': (props.label ?? uiText('ui.configurationSourceText')) }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit('update:modelValue', readText())
        if (update.docChanged || update.selectionSet) updateStatus(update.state)
      })
    ]
  })
}

function refreshChanged() {
  if (!view) return
  view.dispatch({ effects: setChangedLines.of([...props.changedLines]) })
}

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: hostRef.value })
  updateStatus(view.state)
  refreshChanged()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.lineEnding,
  (value) => {
    view?.dispatch({
      effects: separatorCompartment.reconfigure(EditorState.lineSeparator.of(value || '\n'))
    })
  }
)

watch(
  () => props.language,
  () => view?.dispatch({ effects: languageCompartment.reconfigure(resolveLanguage()) })
)

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const text = String(value ?? '')
    if (text === readText()) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  },
  { flush: 'post' }
)

watch(() => props.changedLines, refreshChanged, { deep: true, flush: 'post' })

const eolLabel = computed(() => (props.lineEnding === '\r\n' ? 'CRLF' : 'LF'))

function focus() {
  view?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="config-raw">
    <div ref="hostRef" class="config-raw__editor"></div>
    <div class="config-raw__status">
      <span>{{ $t('ui.line') }} {{ cursor.line }} {{ $t('ui.column') }} {{ cursor.column }} {{ $t('ui.columnVariant2') }}</span>
      <span>{{ lineCount }} {{ $t('ui.lines') }}</span>
      <span>UTF-8</span>
      <span>{{ eolLabel }}</span>
      <span class="config-raw__spacer"></span>
      <slot name="status"></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.config-raw {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.config-raw__editor {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.config-raw__status {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.config-raw__spacer {
  flex: 1 1 auto;
}
</style>
