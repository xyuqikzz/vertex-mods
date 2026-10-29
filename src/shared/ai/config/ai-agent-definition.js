import defaults from './ai-agent-definition.json' with { type: 'json' }
import { buildAiSourcePromptLines, listAiSearchSources } from '../../sources/source-platform-registry.js'
import { buildAgentSourceCredentialPromptLines } from '../installation/ai-agent-source-credential.js'
import { buildInstallRuleAuthoringSummary } from '../../installation/install-rule-documentation.js'
import { INSTALL_FAILURE_RECOVERY_INSTRUCTIONS } from '../../installation/install-failure-recovery.js'

export const AI_AGENT_DEFINITION_MAX_BYTES = 256 * 1024
export const AI_AGENT_DEFAULT_CONTEXT_WINDOW_TOKENS = defaults.runtime.contextWindowTokens
let provider = () => defaults
const clone = (value) => JSON.parse(JSON.stringify(value))
const fail = (field, reason) => {
  throw new Error(`智能体配置 ${field}：${reason}`)
}
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
function keys(value, allowed, field) {
  if (!object(value)) fail(field, '必须是对象')
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${field}.${key}`, '不支持的字段')
}
function text(value, field, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(field, `必须是非空文本，最多 ${max} 字符`)
}
function bool(value, field) {
  if (typeof value !== 'boolean') fail(field, '必须是 true 或 false')
}
function list(value, field, max = 100) {
  if (!Array.isArray(value) || value.length > max) fail(field, `必须是数组，最多 ${max} 项`)
}
function unique(items, key, field) {
  const seen = new Set()
  for (const item of items) {
    text(item?.[key], `${field}.${key}`, 100)
    if (seen.has(item[key])) fail(field, `重复标识 ${item[key]}`)
    seen.add(item[key])
  }
}

// 可配置的是行为与展示；可执行处理器、参数 schema 和权限仍由程序约束。
export function validateAiAgentDefinition(value, knownTools = defaults.tools.map((t) => t.name)) {
  keys(
    value,
    [
      'schemaVersion',
      'activeRolePreset',
      'role',
      'rolePresets',
      'runtime',
      'routing',
      'skills',
      'tools'
    ],
    'root'
  )
  if (value.schemaVersion !== 1) fail('schemaVersion', '仅支持版本 1')
  const { role, runtime } = value
  keys(
    role,
    [
      'id',
      'name',
      'role',
      'sections',
      'toolSectionTitle',
      'toolCallInstruction',
      'toolCallExample',
      'toolResultInstruction'
    ],
    'role'
  )
  for (const key of [
    'id',
    'name',
    'role',
    'toolSectionTitle',
    'toolCallInstruction',
    'toolCallExample',
    'toolResultInstruction'
  ])
    text(role[key], `role.${key}`)
  list(role.sections, 'role.sections', 30)
  for (const section of role.sections) {
    keys(section, ['title', 'lines'], 'role.sections')
    text(section.title, 'section.title', 100)
    list(section.lines, 'section.lines')
    section.lines.forEach((line) => text(line, 'section.lines'))
  }
  list(value.rolePresets, 'rolePresets', 20)
  unique(value.rolePresets, 'id', 'rolePresets')
  for (const preset of value.rolePresets) {
    keys(preset, ['id', 'title', 'prompt'], 'rolePresets')
    text(preset.title, 'preset.title', 100)
    text(preset.prompt, 'preset.prompt')
  }
  if (!value.rolePresets.some((p) => p.id === value.activeRolePreset))
    fail('activeRolePreset', '找不到对应角色预设')
  keys(runtime, ['maxRounds', 'maxToolCallsPerRound', 'maxRepeatedReadCalls', 'contextWindowTokens'], 'runtime')
  for (const [key, min, max] of [
    ['maxRounds', 1, 24],
    ['maxToolCallsPerRound', 1, 8],
    ['maxRepeatedReadCalls', 1, 3]
  ]) {
    if (!Number.isInteger(runtime[key]) || runtime[key] < min || runtime[key] > max)
      fail(`runtime.${key}`, `必须是 ${min} 到 ${max} 的整数`)
  }
  if (runtime.contextWindowTokens !== undefined && (!Number.isInteger(runtime.contextWindowTokens) || runtime.contextWindowTokens < 4096 || runtime.contextWindowTokens > 1048576)) fail('runtime.contextWindowTokens', '必须是 4096 到 1048576 的整数')
  list(value.tools, 'tools', 200)
  unique(value.tools, 'name', 'tools')
  for (const tool of value.tools) {
    keys(tool, ['name', 'title', 'description', 'argsHint', 'enabled'], 'tools')
    if (!knownTools.includes(tool.name)) fail('tools', `未注册工具 ${tool.name}`)
    bool(tool.enabled, `tools.${tool.name}.enabled`)
    for (const key of ['title', 'description', 'argsHint'])
      if (tool[key] !== undefined) text(tool[key], `tools.${tool.name}.${key}`)
  }
  list(value.skills, 'skills', 40)
  unique(value.skills, 'id', 'skills')
  for (const skill of value.skills) {
    keys(
      skill,
      [
        'id',
        'title',
        'description',
        'enabled',
        'always',
        'priority',
        'triggers',
        'pageTypes',
        'tools',
        'instructions'
      ],
      'skills'
    )
    text(skill.title, 'skill.title', 100)
    bool(skill.enabled, 'skill.enabled')
    bool(skill.always, 'skill.always')
    if (skill.description !== undefined) text(skill.description, 'skill.description', 300)
    if (
      skill.priority !== undefined &&
      (!Number.isInteger(skill.priority) || skill.priority < 0 || skill.priority > 100)
    )
      fail('skill.priority', '必须是 0 到 100 的整数')
    if (skill.pageTypes !== undefined) {
      list(skill.pageTypes, 'skill.pageTypes', 20)
      skill.pageTypes.forEach((page) => text(page, 'skill.pageTypes', 100))
    }
    for (const key of ['triggers', 'tools', 'instructions']) {
      list(skill[key], `skill.${key}`)
      skill[key].forEach((line) => text(line, `skill.${key}`, key === 'instructions' ? 8000 : 100))
    }
    for (const name of skill.tools)
      if (!knownTools.includes(name)) fail('skill.tools', `未注册工具 ${name}`)
  }
  if (value.routing !== undefined) {
    keys(value.routing, ['maxSkills', 'maxInstructionChars', 'followupTriggers'], 'routing')
    for (const [key, min, max] of [
      ['maxSkills', 1, 12],
      ['maxInstructionChars', 1000, 24000]
    ]) {
      if (
        !Number.isInteger(value.routing[key]) ||
        value.routing[key] < min ||
        value.routing[key] > max
      )
        fail(`routing.${key}`, `必须是 ${min} 到 ${max} 的整数`)
    }
    list(value.routing.followupTriggers, 'routing.followupTriggers', 30)
    value.routing.followupTriggers.forEach((word) => text(word, 'routing.followupTriggers', 40))
  }
  if (JSON.stringify(value).length > AI_AGENT_DEFINITION_MAX_BYTES) fail('root', '配置过大')
  const normalized = clone(value)
  // 旧配置允许缺少后续新增的容量字段；保留显式设置，不重置用户的角色和工具配置。
  normalized.runtime.contextWindowTokens ??= AI_AGENT_DEFAULT_CONTEXT_WINDOW_TOKENS
  return normalized
}

export function getDefaultAiAgentDefinition() {
  return clone(defaults)
}
export function setAiAgentDefinitionProvider(nextProvider) {
  provider = nextProvider
}
export function getAiAgentDefinition() {
  return clone(provider())
}

export function resolveAgentRole(definition = defaults) {
  const role = clone(definition.role)
  role.sections = role.sections.map((section) => ({
    ...section,
    lines: section.lines.map(expandAgentInstruction)
  }))
  role.toolCallExample = expandAgentInstruction(role.toolCallExample)
  const preset = definition.rolePresets.find((p) => p.id === definition.activeRolePreset)
  if (preset) role.sections.push({ title: `协作方式：${preset.title}`, lines: [preset.prompt] })
  role.sections.push({ title: '当前执行契约', lines: [
    '以工具返回的权限裁决为准：同会话同目标可复用确认，full_auto 对主进程核对的安装计划和单模组启停卸载可自动执行；不要额外重复索取确认。未获授权或用户停用的操作不得执行。accepted 只代表入队，查询 task_detail 的 verified/health 后再报告写后核验结果。'
  ] })
  return role
}

export function expandAgentInstruction(line) {
  const sourceLines = buildAiSourcePromptLines()
  const credentialLines = buildAgentSourceCredentialPromptLines()
  return line
    .replace(/\{\{installRuleAuthoring\}\}/g, () => buildInstallRuleAuthoringSummary())
    .replace(/\{\{sourcePrompt:(\d+)\}\}/g, (_, i) => sourceLines[i] || '')
    .replace(/\{\{credentialPrompt:(\d+)\}\}/g, (_, i) => credentialLines[i] || '')
    .replace(/\{\{searchSources\}\}/g, listAiSearchSources().join('|'))
}

export function resolveAgentSkillInstructions(skill) {
  const instructions = skill.instructions.map(expandAgentInstruction)
  if (skill.tools.includes('vertex.install.failure_diagnose')) {
    instructions.push(INSTALL_FAILURE_RECOVERY_INSTRUCTIONS)
  }
  if (skill.id === 'install_rule_authoring') {
    const current = buildInstallRuleAuthoringSummary()
    // Older saved definitions retain user instructions while receiving current executable capabilities.
    if (!instructions.some((line) => line.includes(current))) instructions.push(current)
  }
  return instructions
}

export function applyAgentToolConfiguration(descriptor, definition = getAiAgentDefinition()) {
  const config = definition.tools.find((t) => t.name === descriptor.name)
  // 已注册工具默认开启；旧配置缺少新增条目时也可用，显式 false 仍用于停用。
  return {
    ...descriptor,
    ...(config || {}),
    enabled: descriptor.enabled !== false && config?.enabled !== false
  }
}

export function listAvailableAiAgentSkills(definition, tools = []) {
  const available = new Set(tools.filter((t) => t.enabled).map((t) => t.name))
  return definition.skills.filter(
    (skill) =>
      skill.enabled && (skill.tools.length === 0 || skill.tools.some((name) => available.has(name)))
  )
}

function matchesTerm(value, term) {
  const text = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
  const word = String(term || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
  if (!word) return false
  let start = text.indexOf(word)
  while (start !== -1) {
    // 英文按单词边界匹配，防止 mod 命中 model / modern；数字后缀允许 DLSS5。
    if (
      (!/^[a-z]/.test(word) || !/[a-z]/.test(text[start - 1] || '')) &&
      (!/[a-z]$/.test(word) || !/[a-z]/.test(text[start + word.length] || ''))
    )
      return true
    start = text.indexOf(word, start + word.length)
  }
  return false
}

export function routeAiAgentSkills(
  definition,
  { message = '', history = [], context = {} } = {},
  tools = []
) {
  const available = listAvailableAiAgentSkills(definition, tools)
  const routing = definition.routing || defaults.routing
  const current = String(message || '').slice(0, 12000)
  const hits = (skill, text) => skill.triggers.filter((word) => matchesTerm(text, word)).length
  const direct = new Map(available.map((s) => [s.id, hits(s, current)]))
  const hasDirect = [...direct.values()].some((score) => score > 0)
  const hasSpecific = available.some(
    (skill) => direct.get(skill.id) > 0 && (skill.priority || 0) >= 70
  )
  const followup =
    current.length <= 120 && routing.followupTriggers.some((term) => matchesTerm(current, term))
  const pages = [
    context?.page?.type,
    context?.page?.scene,
    context?.pageType,
    context?.tool
  ].filter((value) => typeof value === 'string')
  const usePage = !hasSpecific && (!hasDirect || followup)
  const hasPage =
    usePage &&
    available.some((skill) => (skill.pageTypes || []).some((page) => pages.includes(page)))
  // 新任务有明确意图时只用当前问题；历史仅帮助解析短追问，不把旧目标常驻。
  const recent =
    !hasSpecific && !hasPage && followup && Array.isArray(history)
      ? history
          .filter((h) => h?.role === 'user' && typeof h.content === 'string')
          .slice(-4)
          .reverse()
      : []
  const previous =
    recent
      .find((h) => available.some((s) => hits(s, h.content.slice(-2000))))
      ?.content.slice(-2000) || ''
  const matched = available
    .map((skill, index) => {
      const directHits = direct.get(skill.id)
      const pageHit = usePage && (skill.pageTypes || []).some((page) => pages.includes(page))
      const historyHits = hits(skill, previous)
      const reason = skill.always
        ? 'always'
        : directHits
          ? 'message'
          : pageHit
            ? 'page'
            : historyHits
              ? 'followup'
              : ''
      const score = skill.always
        ? 10000
        : directHits
          ? 300 + (skill.priority || 0) + Math.min(directHits, 5)
          : pageHit
            ? 200 + (skill.priority || 0)
            : historyHits
              ? 100 + (skill.priority || 0)
              : 0
      return { skill, reason, score, index }
    })
    .filter((entry) => entry.reason)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  let used = 0
  const skills = []
  const decisions = matched.map((entry) => {
    const skill = {
      ...entry.skill,
      instructions: resolveAgentSkillInstructions(entry.skill)
    }
    const size = skill.instructions.join('\n').length
    const loaded = skills.length < routing.maxSkills && used + size <= routing.maxInstructionChars
    if (loaded) {
      skills.push(skill)
      used += size
    }
    return {
      id: skill.id,
      title: skill.title,
      reason: entry.reason,
      loaded,
      deferredReason: loaded ? '' : 'prompt_budget'
    }
  })
  return { skills, decisions, instructionChars: used }
}

export function selectAiAgentSkills(definition, request = {}, tools = []) {
  return routeAiAgentSkills(definition, request, tools).skills
}

export function mergeBuiltInAiAgentSkills(config) {
  const result = clone(config)
  for (const builtin of defaults.skills) {
    const index = result.skills.findIndex((s) => s.id === builtin.id)
    if (index < 0) result.skills.push(clone(builtin))
    else result.skills[index] = { ...clone(builtin), ...result.skills[index] }
  }
  if (!result.routing) result.routing = clone(defaults.routing)
  // 补齐全部内置工具并默认开启，保留已明确设置的开关与自定义说明。
  for (const builtin of defaults.tools) {
    if (!result.tools.some((tool) => tool.name === builtin.name)) {
      result.tools.push({ ...clone(builtin), enabled: true })
    }
  }
  return result
}
