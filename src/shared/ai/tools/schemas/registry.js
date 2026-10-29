// 工具别名、配置展开与模型函数协议适配。
import { applyAgentToolConfiguration, getAiAgentDefinition } from '../../config/ai-agent-definition.js'
import { AI_AGENT_TOOL_DESCRIPTORS } from './descriptors.js'

const AI_AGENT_TOOL_NAME_ALIASES = Object.freeze({
  'vertex.install.rule.reference.docs': 'vertex.install_rule.reference_docs',
  'vertex.install.rule.save.config': 'vertex.install_rule.save_config'
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function normalizeAiAgentToolName(name = '') {
  const target = toSafeText(name)
  return AI_AGENT_TOOL_NAME_ALIASES[target] || target
}

export function getAiAgentToolDescriptor(name = '', definition = getAiAgentDefinition()) {
  const target = normalizeAiAgentToolName(name)
  const descriptor = AI_AGENT_TOOL_DESCRIPTORS.find((item) => item.name === target)
  return descriptor ? applyAgentToolConfiguration(descriptor, definition) : null
}

export function listAiAgentToolDescriptors(definition = getAiAgentDefinition()) {
  return AI_AGENT_TOOL_DESCRIPTORS.map((item) => applyAgentToolConfiguration(item, definition))
}

/**
 * 将工具名转换为 OpenAI function calling 允许的函数名（不允许点号）。
 */
export function toAiAgentFunctionName(toolName = '') {
  return normalizeAiAgentToolName(toolName).replace(/\./g, '_')
}

export function fromAiAgentFunctionName(functionName = '') {
  const target = toSafeText(functionName)
  const matched = AI_AGENT_TOOL_DESCRIPTORS.find(
    (item) => toAiAgentFunctionName(item.name) === target
  )
  return matched ? matched.name : target.replace(/_/g, '.')
}

/**
 * 构建 OpenAI 兼容 tools 参数。
 */
export function buildAiAgentFunctionTools(descriptors = listAiAgentToolDescriptors()) {
  return (Array.isArray(descriptors) ? descriptors : [])
    .filter((item) => item?.enabled)
    .map((item) => ({
      type: 'function',
      function: {
        name: toAiAgentFunctionName(item.name),
        description: `${item.title}：${item.description}；权限：${item.requiresConfirmation === 'always' ? '始终确认' : item.readonly ? '只读' : '按权限策略执行'}`,
        parameters: item.inputSchema || { type: 'object', properties: {} }
      }
    }))
}
