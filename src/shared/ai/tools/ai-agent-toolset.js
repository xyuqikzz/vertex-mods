import { listAvailableAiAgentSkills, routeAiAgentSkills } from '../config/ai-agent-definition.js'

// 智能体每轮只拿到“当前任务需要的工具”：常驻技能、当前问题/页面路由到的技能、
// 最近两轮实际用过的工具及其技能。其他能力留在技能目录里，模型读取技能后再解锁。
// 工具是否可执行、是否需要确认仍由主进程权限策略决定，这里只决定发给模型的工具说明。

export const AI_AGENT_SKILL_READ_TOOL = 'vertex.skill.read'
const RECENT_ASSISTANT_TURNS = 2
const TOOL_NAME_PATTERN = /"name"\s*:\s*"(vertex\.[a-z0-9_.]+)"/gi

function enabledToolNames(tools = []) {
  return new Set(
    (Array.isArray(tools) ? tools : [])
      .filter((tool) => tool && tool.enabled !== false && typeof tool.name === 'string')
      .map((tool) => tool.name)
  )
}

// 历史消息由渲染进程整理成文本，执行摘要以 JSON 附在助手消息末尾。
export function collectRecentAiAgentToolNames(history = [], turns = RECENT_ASSISTANT_TURNS) {
  const assistantMessages = (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'assistant' && typeof item.content === 'string')
    .slice(-turns)
  const names = new Set()
  for (const message of assistantMessages) {
    for (const match of message.content.matchAll(TOOL_NAME_PATTERN)) names.add(match[1])
  }
  return [...names]
}

export function listAiAgentSkillsForTool(definition, toolName = '', tools = []) {
  return listAvailableAiAgentSkills(definition, tools).filter((skill) =>
    skill.tools.includes(toolName)
  )
}

/**
 * 计算本轮发送给模型的工具集合。
 * @returns {{ names: Set<string>, skillIds: string[], reasons: Record<string, string> }}
 */
export function resolveAiAgentActiveToolset(definition, request = {}, tools = []) {
  const enabled = enabledToolNames(tools)
  const available = listAvailableAiAgentSkills(definition, tools)
  const skillIds = new Set()
  const reasons = {}
  const addSkill = (skill, reason) => {
    if (!skill || skillIds.has(skill.id)) return
    skillIds.add(skill.id)
    reasons[skill.id] = reason
  }

  for (const skill of available) if (skill.always) addSkill(skill, 'always')
  const routing = routeAiAgentSkills(definition, request, tools)
  for (const decision of routing.decisions) {
    addSkill(
      available.find((skill) => skill.id === decision.id),
      decision.reason
    )
  }

  const recentNames = collectRecentAiAgentToolNames(request.history).filter((name) =>
    enabled.has(name)
  )
  const extraNames = (Array.isArray(request.extraToolNames) ? request.extraToolNames : []).filter(
    (name) => enabled.has(name)
  )
  for (const name of [...recentNames, ...extraNames]) {
    for (const skill of available) if (skill.tools.includes(name)) addSkill(skill, 'recent_tool')
  }

  const names = new Set()
  if (enabled.has(AI_AGENT_SKILL_READ_TOOL)) names.add(AI_AGENT_SKILL_READ_TOOL)
  for (const skill of available) {
    if (!skillIds.has(skill.id)) continue
    for (const name of skill.tools) if (enabled.has(name)) names.add(name)
  }
  for (const name of [...recentNames, ...extraNames]) names.add(name)

  // 不属于任何可用技能的已启用工具无法通过读取技能解锁，始终保留，避免能力“消失”。
  const owned = new Set(available.flatMap((skill) => skill.tools))
  for (const name of enabled) if (!owned.has(name)) names.add(name)

  return { names, skillIds: [...skillIds], reasons }
}
