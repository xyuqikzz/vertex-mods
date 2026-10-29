import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// Thunderstore 配置文件（BepInEx .cfg / doorstop .ini）的解析与按行写回。
// 只在前端使用：解析出分组、条目和 BepInEx 写在注释里的元数据（类型、默认值、范围、可选值），
// 写回时只替换改过的那几行，保留原来的空行、注释、分隔符写法和换行符。
// 规格见 Vertex 项目文档《Thunderstore 配置编辑器 UI 重设计方案》。

export const STRUCTURED_CONFIG_EXTENSIONS = Object.freeze(['.cfg', '.ini'])

const INT_TYPES = new Set([
  'int16',
  'int32',
  'int64',
  'uint16',
  'uint32',
  'uint64',
  'byte',
  'sbyte'
])
const FLOAT_TYPES = new Set(['single', 'double', 'decimal', 'float'])
const INT_PATTERN = /^[+-]?\d+$/
const FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const COLOR_PATTERN = /^#?[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/
// 值保留行尾空白，输入时不会把用户刚敲的空格吞掉；比较和校验时再去掉。
const ENTRY_PATTERN = /^(\s*)([^=]*?[^=\s])(\s*=\s?)(.*)$/

export const CONFIG_ENTRY_TYPE_LABELS = Object.freeze({
  get bool() { return uiText('ui.switches') },
  get int() { return uiText('ui.integer') },
  get float() { return uiText('ui.decimal') },
  get enum() { return uiText('ui.singleChoice') },
  get flags() { return uiText('ui.multipleChoices') },
  key: '快捷键',
  get color() { return uiText('ui.color') },
  get string() { return uiText('ui.text') },
  get text() { return uiText('ui.text') }
})

export function normalizeConfigPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .trim()
}

export function getConfigFileName(relativePath) {
  const segments = normalizeConfigPath(relativePath).split('/')
  return segments[segments.length - 1] || ''
}

export function getConfigFileExtension(relativePath) {
  const fileName = getConfigFileName(relativePath)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function getConfigFileBaseName(relativePath) {
  const fileName = getConfigFileName(relativePath)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
}

export function isStructuredConfigPath(relativePath) {
  return STRUCTURED_CONFIG_EXTENSIONS.includes(getConfigFileExtension(relativePath))
}

// 列表分组：mods（模组配置）/ loader（BepInEx.cfg、doorstop_config.ini）/ other（其他文本文件）。
export function classifyConfigFile(relativePath) {
  const lowerPath = normalizeConfigPath(relativePath).toLowerCase()
  const fileName = getConfigFileName(lowerPath)
  if (lowerPath === 'bepinex/config/bepinex.cfg' || fileName === 'doorstop_config.ini') {
    return 'loader'
  }
  return isStructuredConfigPath(lowerPath) ? 'mods' : 'other'
}

// 模组名、包名、文件名比较时去掉大小写和符号：「Better Stamina」「BetterStamina」「better_stamina」视为相同。
export function compactConfigKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '')
}

export function matchesConfigFileKeyword(file = {}, keyword = '') {
  const plain = String(keyword || '')
    .trim()
    .toLowerCase()
  if (!plain) return true
  const compact = compactConfigKeyword(plain)
  const fields = [file.relativePath, file.fileName, file.displayName, file.guid]
  return fields.some((field) => {
    const text = String(field || '').toLowerCase()
    if (!text) return false
    if (text.includes(plain)) return true
    return compact.length > 0 && compactConfigKeyword(text).includes(compact)
  })
}

export function splitConfigText(text) {
  const source = String(text ?? '')
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (trailingNewline) lines.pop()
  return { lines, lineEnding, trailingNewline }
}

function joinConfigLines(lines, lineEnding, trailingNewline) {
  return lines.join(lineEnding) + (trailingNewline ? lineEnding : '')
}

function stripCommentMarker(line) {
  return String(line || '').replace(/^\s*(?:##?|;+)\s?/, '')
}

function parseHeaderMetadata(headerLines) {
  const metadata = { pluginName: '', version: '', guid: '' }
  for (const line of headerLines) {
    const text = stripCommentMarker(line).trim()
    const created = text.match(/^Settings file was created by plugin\s+(.+?)(?:\s+v(\S+))?$/i)
    if (created) {
      metadata.pluginName = String(created[1] || '').trim()
      metadata.version = String(created[2] || '').trim()
      continue
    }
    const guid = text.match(/^Plugin GUID:\s*(.+)$/i)
    if (guid) metadata.guid = String(guid[1] || '').trim()
  }
  return metadata
}

function parseCommentBlock(commentLines) {
  const result = {
    descriptionLines: [],
    settingType: '',
    defaultText: undefined,
    range: null,
    options: [],
    multiple: false
  }
  for (const line of commentLines) {
    const isBepInExMeta = /^\s*#(?!#)/.test(line)
    const text = stripCommentMarker(line)
    const trimmed = text.trim()
    if (isBepInExMeta) {
      const typeMatch = trimmed.match(/^Setting type:\s*(.+)$/i)
      if (typeMatch) {
        result.settingType = typeMatch[1].trim()
        continue
      }
      const defaultMatch = text.match(/^\s*Default value:\s?(.*)$/i)
      if (defaultMatch) {
        result.defaultText = defaultMatch[1].trim()
        continue
      }
      const rangeMatch = trimmed.match(/^Acceptable value range:\s*From\s+(\S+)\s+to\s+(\S+)/i)
      if (rangeMatch) {
        const min = Number(rangeMatch[1])
        const max = Number(rangeMatch[2])
        if (Number.isFinite(min) && Number.isFinite(max)) result.range = { min, max }
        continue
      }
      const optionsMatch = trimmed.match(/^Acceptable values:\s*(.+)$/i)
      if (optionsMatch) {
        result.options = optionsMatch[1]
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        continue
      }
      if (/^Multiple values can be set at the same time/i.test(trimmed)) {
        result.multiple = true
        continue
      }
    }
    result.descriptionLines.push(trimmed)
  }
  return result
}

function resolveEntryType(meta, rawValue) {
  const settingType = meta.settingType
  const lowerType = settingType.toLowerCase()
  if (meta.options.length > 0) {
    return { type: meta.multiple ? 'flags' : 'enum', inferred: false }
  }
  if (settingType) {
    if (lowerType === 'boolean') return { type: 'bool', inferred: false }
    if (INT_TYPES.has(lowerType)) return { type: 'int', inferred: false }
    if (FLOAT_TYPES.has(lowerType)) return { type: 'float', inferred: false }
    if (lowerType === 'string') return { type: 'string', inferred: false }
    if (lowerType === 'keyboardshortcut') return { type: 'key', inferred: false }
    if (lowerType === 'color') return { type: 'color', inferred: false }
    return { type: 'text', inferred: false }
  }
  const value = String(rawValue || '').trim()
  if (/^(true|false)$/i.test(value)) return { type: 'bool', inferred: true }
  if (INT_PATTERN.test(value)) return { type: 'int', inferred: true }
  if (FLOAT_PATTERN.test(value) && value.includes('.')) return { type: 'float', inferred: true }
  return { type: 'string', inferred: true }
}

function resolveBoolTokens(rawValue) {
  const value = String(rawValue || '').trim()
  if (value === 'True' || value === 'False') return ['True', 'False']
  if (value === 'TRUE' || value === 'FALSE') return ['TRUE', 'FALSE']
  return ['true', 'false']
}

function canonicalValue(type, rawValue, quoteChar) {
  const value = String(rawValue ?? '')
  if (type === 'bool') {
    const lower = value.trim().toLowerCase()
    return lower === 'true' || lower === 'false' ? lower : value
  }
  if (quoteChar && value.length >= 2 && value.startsWith(quoteChar) && value.endsWith(quoteChar)) {
    return value.slice(1, -1)
  }
  return value
}

function resolveQuoteChar(rawValue) {
  const value = String(rawValue || '')
  if (value.length < 2) return ''
  if (value.startsWith('"') && value.endsWith('"')) return '"'
  if (value.startsWith("'") && value.endsWith("'")) return "'"
  return ''
}

/**
 * 解析配置文本。
 * structured=false 时说明不是 .cfg / .ini（reason: 'unsupported'）或有认不出的行（reason: 'unparsed'，
 * unparsedLine 为 1 起的行号），只能编辑原文。
 */
export function parseConfigDocument(text, relativePath = '') {
  const { lines, lineEnding } = splitConfigText(text)
  const base = {
    structured: false,
    reason: '',
    unparsedLine: 0,
    lineEnding,
    lineCount: lines.length,
    metadata: { pluginName: '', version: '', guid: '' },
    sections: [],
    entries: []
  }

  if (relativePath && !isStructuredConfigPath(relativePath)) {
    return { ...base, reason: 'unsupported' }
  }

  const headerLines = []
  const sections = []
  const entries = []
  let currentSection = null
  let pendingComments = []
  let seenContent = false
  const occurrence = new Map()

  const ensureSection = (name) => {
    const section = { id: `section:${sections.length}`, name, entries: [] }
    sections.push(section)
    return section
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      pendingComments = []
      continue
    }

    if (/^[#;]/.test(trimmed)) {
      if (!seenContent) headerLines.push(line)
      pendingComments.push(line)
      continue
    }

    const sectionMatch = trimmed.match(/^\[(.*)\]$/)
    if (sectionMatch) {
      seenContent = true
      currentSection = ensureSection(sectionMatch[1].trim())
      pendingComments = []
      continue
    }

    const entryMatch = line.match(ENTRY_PATTERN)
    if (!entryMatch || /^[#;[]/.test(entryMatch[2].trim())) {
      return { ...base, reason: 'unparsed', unparsedLine: index + 1 }
    }

    // 文件头注释紧挨着第一个条目时（没有分组、没有空行），不把它当成条目说明。
    const commentLines = seenContent ? pendingComments : []
    seenContent = true
    if (!currentSection) currentSection = ensureSection('')

    const [, indent, key, separator, rawValue] = entryMatch
    const meta = parseCommentBlock(commentLines)
    const { type, inferred } = resolveEntryType(meta, rawValue)
    const quoteChar = type === 'bool' ? '' : resolveQuoteChar(rawValue)
    const identityBase = `${currentSection.name}\u0000${key.trim()}`
    const count = occurrence.get(identityBase) || 0
    occurrence.set(identityBase, count + 1)

    const entry = {
      id: `${identityBase}\u0000${count}`,
      sectionId: currentSection.id,
      section: currentSection.name,
      key: key.trim(),
      lineIndex: index,
      prefix: `${indent}${key}${separator}`,
      rawValue,
      quoteChar,
      type,
      inferred,
      settingType: meta.settingType,
      description: meta.descriptionLines.join('\n').trim(),
      defaultValue:
        meta.defaultText === undefined ? undefined : canonicalValue(type, meta.defaultText, ''),
      range: meta.range,
      options: meta.options,
      boolTokens: type === 'bool' ? resolveBoolTokens(rawValue) : null,
      value: canonicalValue(type, rawValue, quoteChar)
    }
    currentSection.entries.push(entry)
    entries.push(entry)
    pendingComments = []
  }

  return {
    ...base,
    structured: true,
    metadata: parseHeaderMetadata(headerLines),
    sections: sections.filter((section) => section.entries.length > 0),
    entries
  }
}

function formatEntryValue(entry, value) {
  const text = String(value ?? '')
  if (entry.type === 'bool') {
    const tokens = entry.boolTokens || ['true', 'false']
    if (text === 'true') return tokens[0]
    if (text === 'false') return tokens[1]
    return text
  }
  return entry.quoteChar ? `${entry.quoteChar}${text}${entry.quoteChar}` : text
}

// 把一个条目的新值写进文本：只替换该条目所在的那一行。
export function setConfigEntryValue(text, entry, value) {
  const { lines, lineEnding, trailingNewline } = splitConfigText(text)
  if (!entry || entry.lineIndex < 0 || entry.lineIndex >= lines.length) return String(text ?? '')
  lines[entry.lineIndex] = `${entry.prefix}${formatEntryValue(entry, value)}`
  return joinConfigLines(lines, lineEnding, trailingNewline)
}

function isNumericType(entry) {
  return entry?.type === 'int' || entry?.type === 'float'
}

// 两个值是否等价：数字按数值比较（1 和 1.0 相同），开关和选项不区分大小写。
export function isSameConfigValue(entry, left, right) {
  if (left === undefined || right === undefined) return left === right
  const a = String(left)
  const b = String(right)
  if (a === b) return true
  if (isNumericType(entry)) {
    const na = Number(a.trim())
    const nb = Number(b.trim())
    return a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && na === nb
  }
  if (entry?.type === 'bool' || entry?.type === 'enum') {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }
  if (entry?.type === 'flags') {
    const normalize = (value) =>
      splitFlagValue(value)
        .map((item) => item.toLowerCase())
        .sort()
        .join(',')
    return normalize(a) === normalize(b)
  }
  return false
}

export function splitFlagValue(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

// 多选：None 与其他值互斥；按文件里可选值的顺序写回，用 ", " 连接（与 BepInEx 一致）。
export function toggleFlagValue(entry, value, option) {
  const options = entry?.options || []
  const selected = new Set(splitFlagValue(value).map((item) => item.toLowerCase()))
  const target = String(option || '').toLowerCase()
  if (selected.has(target)) {
    selected.delete(target)
  } else {
    selected.add(target)
    if (target === 'none') {
      selected.clear()
      selected.add('none')
    } else {
      selected.delete('none')
    }
  }
  const ordered = options.filter((item) => selected.has(item.toLowerCase()))
  if (!ordered.length && options.some((item) => item.toLowerCase() === 'none')) return 'None'
  return ordered.join(', ')
}

function formatRangeNumber(value) {
  return String(value)
}

export function describeConfigRange(range) {
  if (!range) return ''
  return `${formatRangeNumber(range.min)} – ${formatRangeNumber(range.max)}`
}

// 校验条目的值；返回空字符串表示通过。按值推断类型的条目不做严格校验。
export function validateConfigEntryValue(entry, value) {
  if (!entry || entry.inferred) return ''
  const text = String(value ?? '').trim()
  if (entry.type === 'int' || entry.type === 'float') {
    const pattern = entry.type === 'int' ? INT_PATTERN : FLOAT_PATTERN
    if (!pattern.test(text)) return entry.type === 'int' ? '请输入整数' : '请输入数字'
    const number = Number(text)
    if (entry.range && (number < entry.range.min || number > entry.range.max)) {
      return uiText('ui.outsideRangeValue', { value1: (describeConfigRange(entry.range)) })
    }
    return ''
  }
  if (entry.type === 'enum') {
    const hit = entry.options.some((option) => option.toLowerCase() === text.toLowerCase())
    return hit ? '' : '不是可选的值'
  }
  if (entry.type === 'flags') {
    const invalid = splitFlagValue(text).find(
      (item) => !entry.options.some((option) => option.toLowerCase() === item.toLowerCase())
    )
    return invalid ? uiText('ui.valueIsNotAnAvailableValue', { value1: (invalid) }) : ''
  }
  if (entry.type === 'color') {
    return COLOR_PATTERN.test(text) ? '' : '请输入 6 位或 8 位十六进制颜色，如 FFD24DFF'
  }
  if (entry.type === 'bool') {
    return text === 'true' || text === 'false' ? '' : '请选择开或关'
  }
  return ''
}

export function describeConfigEntryType(entry) {
  if (!entry) return ''
  if (entry.type === 'text' && entry.settingType) return uiText('ui.valueEditAsText', { value1: (entry.settingType) })
  return CONFIG_ENTRY_TYPE_LABELS[entry.type] || '文本'
}

// 对比打开时和当前的文档：返回改过的条目（按「分组 + 键 + 第几次出现」对应）。
export function diffConfigDocuments(originalDoc, currentDoc) {
  const before = new Map((originalDoc?.entries || []).map((entry) => [entry.id, entry]))
  const changes = []
  for (const entry of currentDoc?.entries || []) {
    const original = before.get(entry.id)
    if (!original) {
      changes.push({ id: entry.id, entry, before: undefined, after: entry.value })
      continue
    }
    if (original.value !== entry.value) {
      changes.push({ id: entry.id, entry, before: original.value, after: entry.value })
    }
  }
  return changes
}

// 原文里改过的行（1 起的行号）：按条目对应，加上新增的条目。
export function collectChangedLineNumbers(changes = []) {
  return changes.map((change) => change.entry.lineIndex + 1)
}

export function hexColorPreview(value) {
  const text = String(value || '')
    .trim()
    .replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}/.test(text)) return ''
  return `#${text.slice(0, 6)}`
}

// 取色器返回 #rrggbb；保留原来的透明度位和大小写习惯。
export function mergePickedColor(previous, picked) {
  const hex = String(picked || '')
    .replace(/^#/, '')
    .slice(0, 6)
  const old = String(previous || '')
    .trim()
    .replace(/^#/, '')
  const alpha = old.length === 8 ? old.slice(6) : ''
  const upper = old === old.toUpperCase()
  const merged = `${upper ? hex.toUpperCase() : hex.toLowerCase()}${alpha}`
  return String(previous || '')
    .trim()
    .startsWith('#')
    ? `#${merged}`
    : merged
}
