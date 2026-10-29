import {
  resolveAgentSkillInstructions,
  getAiAgentDefinition
} from '../../../../../shared/ai/config/ai-agent-definition.js'
import { listAiAgentToolDescriptors } from '../../../../../shared/ai/tools/ai-agent-tool-schemas.js'

export function readAgentSkillTool(args = {}, ctx = {}) {
  // 编排请求使用启动时的配置快照；独立调用使用当前有效配置。
  const definition = ctx.agentDefinition || getAiAgentDefinition()
  const skill = definition.skills.find((item) => item.id === args.skillId)
  if (!skill || !skill.enabled)
    return {
      success: false,
      errorCode: 'skill_unavailable',
      message: '该技能不存在或已停用，请使用当前技能目录中的标识。'
    }
  const enabled = new Set(
    listAiAgentToolDescriptors(definition)
      .filter((tool) => tool.enabled)
      .map((tool) => tool.name)
  )
  const tools = skill.tools.filter((name) => enabled.has(name))
  if (skill.tools.length && !tools.length)
    return {
      success: false,
      errorCode: 'skill_tools_disabled',
      message: '该技能关联的工具均已停用，无法执行相关操作。'
    }
  const instructions = resolveAgentSkillInstructions(skill)
  // 通用工具输出有数组和单行长度上限，拒绝超长指引，避免悄悄丢掉末尾步骤。
  if (
    instructions.length > 30 ||
    instructions.some((line) => line.length > 1900) ||
    instructions.join('\n').length > 12000
  ) {
    return {
      success: false,
      errorCode: 'skill_content_too_large',
      message: '技能指引过长，请拆为更小的技能或短段落后读取；本次未返回不完整流程。'
    }
  }
  return {
    success: true,
    skill: {
      id: skill.id,
      title: skill.title,
      description: skill.description || skill.title,
      instructions,
      tools
    },
    unavailableTools: skill.tools.filter((name) => !enabled.has(name)),
    message: '已读取完整技能指引，尚未执行操作；以当前用户要求、工具能力和确认流程为准。'
  }
}
