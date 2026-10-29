import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// 安装规则大纲：从编辑器 JSON 文本中找出顶层分区和每条 install_rules 的起止行。
// 只做前端展示，不参与校验和保存；JSON 无效时仍按扫描结果给出行号和 id。

const SECTION_LABELS = Object.freeze({
  get game() { return uiText('ui.gameInformation') },
  get game_detect() { return uiText('ui.folderDetection') },
  get requires() { return uiText('ui.requiredCapabilities') },
  get variables() { return uiText('ui.variables') },
  get templates() { return uiText('ui.templates') },
  get use_templates() { return uiText('ui.useTemplate') },
  get dependencies() { return uiText('taskCenter.detail.dependency') },
  get default_dependencies() { return uiText('ui.defaultDependency') }
})

const RULE_LIST_KEYS = new Set(['install_rules', 'installRules'])

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 逐字符扫描 JSON 文本，记录顶层键所在行、install_rules 每个元素的起止行和 id。
 * 不依赖 JSON.parse，所以输入到一半、语法有误时也能给出大致位置。
 */
export function scanInstallRuleOutline(text = '') {
  const source = String(text ?? '')
  const keys = {}
  const rules = []
  const stack = []
  let line = 1
  let index = 0
  let lastKey = null
  let lastKeyLine = 0
  let afterColon = false
  let expectRuleList = false
  let pendingIdRule = -1

  while (index < source.length) {
    const char = source[index]

    if (char === '\n') {
      line++
      index++
      continue
    }

    if (char === ' ' || char === '\t' || char === '\r') {
      index++
      continue
    }

    if (char === '"') {
      let cursor = index + 1
      let value = ''
      while (cursor < source.length) {
        const current = source[cursor]
        if (current === '\\') {
          value += source[cursor + 1] ?? ''
          cursor += 2
          continue
        }
        if (current === '"' || current === '\n') break
        value += current
        cursor++
      }
      if (afterColon) {
        if (pendingIdRule >= 0 && rules[pendingIdRule] && !rules[pendingIdRule].id) {
          rules[pendingIdRule].id = value
        }
        pendingIdRule = -1
        lastKey = null
      } else {
        lastKey = value
        lastKeyLine = line
      }
      afterColon = false
      expectRuleList = false
      index = source[cursor] === '"' ? cursor + 1 : cursor
      continue
    }

    if (char === ':') {
      if (lastKey !== null) {
        const depth = stack.length
        if (depth === 1 && stack[0].type === '{') {
          if (!(lastKey in keys)) keys[lastKey] = lastKeyLine
          expectRuleList = RULE_LIST_KEYS.has(lastKey)
        }
        const owner = stack[depth - 1]
        if (lastKey === 'id' && owner?.ruleIndex !== undefined) pendingIdRule = owner.ruleIndex
      }
      lastKey = null
      afterColon = true
      index++
      continue
    }

    if (char === '{' || char === '[') {
      const parent = stack[stack.length - 1]
      const entry = { type: char }
      if (char === '[' && expectRuleList && stack.length === 1) entry.isRuleList = true
      if (char === '{' && parent?.isRuleList) {
        entry.ruleIndex = rules.length
        rules.push({ id: '', start: line, end: line })
      }
      stack.push(entry)
      expectRuleList = false
      afterColon = false
      pendingIdRule = -1
      lastKey = null
      index++
      continue
    }

    if (char === '}' || char === ']') {
      const entry = stack.pop()
      if (entry?.ruleIndex !== undefined) rules[entry.ruleIndex].end = line
      expectRuleList = false
      afterColon = false
      pendingIdRule = -1
      lastKey = null
      index++
      continue
    }

    // 逗号、数字、true/false/null 等其他记号。
    expectRuleList = false
    afterColon = char === ',' ? false : afterColon
    if (char !== ',') pendingIdRule = -1
    lastKey = null
    index++
  }

  // 未闭合的规则（正在输入）延伸到文本末尾。
  for (const entry of stack) {
    if (entry.ruleIndex !== undefined) rules[entry.ruleIndex].end = line
  }

  return { keys, rules, lineCount: line }
}

function formatTarget(target) {
  if (!isPlainObject(target)) return ''
  const base = String(target.base || 'game').trim() || 'game'
  const rawPath = String(target.path ?? '').trim()
  const path = rawPath
    .replace(/\{\{\s*unit\.identity\s*\}\}/g, '{identity}')
    .replace(/\{\{\s*param:([\w.-]+)\s*\}\}/g, '{$1}')
  const isRoot = !path || path === '.' || path === './'
  if (base === 'game') return isRoot ? uiText('ui.gameRootFolder') : path
  return isRoot ? base : `${base}/${path}`
}

/** 一句话说明这条规则把文件装到哪里，用于大纲和对比列表。 */
export function describeInstallRuleTarget(rule) {
  if (!isPlainObject(rule)) return ''
  const declarative = isPlainObject(rule.declarative) ? rule.declarative : {}
  const candidates = [
    rule.target,
    Array.isArray(rule.routes)
      ? rule.routes.find((route) => isPlainObject(route?.target))?.target
      : null,
    Array.isArray(declarative.units)
      ? declarative.units.find((unit) => isPlainObject(unit?.target))?.target
      : null,
    Array.isArray(declarative.routes)
      ? declarative.routes.find((route) => isPlainObject(route?.target))?.target
      : null
  ]
  const text = candidates.map(formatTarget).find(Boolean)
  if (isPlainObject(declarative.fomod)) return text ? `FOMOD → ${text}` : 'FOMOD'
  if (text) return text
  if (declarative.config || rule.config) return '配置字段'
  if (Array.isArray(declarative.ignore) || Array.isArray(rule.ignore)) return '忽略'
  return ''
}

/**
 * 生成编辑器大纲。valid=false 时 rules 仍来自扫描结果（id、行号），只是没有说明和目标。
 */
export function buildInstallRuleOutline(text = '') {
  const source = String(text ?? '')
  const scanned = scanInstallRuleOutline(source)
  let parsed = null
  let valid = false
  if (source.trim()) {
    try {
      parsed = JSON.parse(source)
      valid = isPlainObject(parsed)
    } catch {
      valid = false
    }
  }

  const document = valid ? parsed : {}
  const ruleList = Array.isArray(document.install_rules)
    ? document.install_rules
    : Array.isArray(document.installRules)
      ? document.installRules
      : []

  const sections = Object.keys(SECTION_LABELS)
    .filter((key) => scanned.keys[key] !== undefined)
    .map((key) => ({ key, label: SECTION_LABELS[key], line: scanned.keys[key] }))
    .sort((left, right) => left.line - right.line)

  const rules = scanned.rules.map((range, index) => {
    const rule = valid && isPlainObject(ruleList[index]) ? ruleList[index] : null
    const id = String(rule?.id ?? range.id ?? '').trim()
    return {
      index,
      key: `${index}:${id}`,
      id: id || `规则 ${index + 1}`,
      hasId: !!id,
      description: rule ? String(rule.description || '').trim() : '',
      target: rule ? describeInstallRuleTarget(rule) : '',
      start: range.start,
      end: range.end
    }
  })

  const schemaVersion = Number(document.schema_version ?? document.schemaVersion ?? 0) || null

  return {
    valid,
    sections,
    rules,
    ruleListLine: scanned.keys.install_rules ?? scanned.keys.installRules ?? null,
    ruleCount: valid ? ruleList.length : rules.length,
    schemaVersion
  }
}

/** 找出包含某一行的规则（光标所在、错误所在）。 */
export function findOutlineRuleAtLine(rules = [], line = 0) {
  const target = Number(line || 0)
  if (!target) return null
  return rules.find((rule) => rule.start <= target && target <= rule.end) || null
}

/** 规则文本的摘要（规则条数、schema 版本），用于页头「当前生效」。 */
export function summarizeInstallRuleText(text = '') {
  const source = String(text ?? '').trim()
  if (!source) return { ruleCount: 0, schemaVersion: null }
  try {
    const parsed = JSON.parse(source)
    if (!isPlainObject(parsed)) return { ruleCount: 0, schemaVersion: null }
    const list = Array.isArray(parsed.install_rules)
      ? parsed.install_rules
      : Array.isArray(parsed.installRules)
        ? parsed.installRules
        : []
    return {
      ruleCount: list.length,
      schemaVersion: Number(parsed.schema_version ?? parsed.schemaVersion ?? 0) || null
    }
  } catch {
    return { ruleCount: 0, schemaVersion: null }
  }
}
