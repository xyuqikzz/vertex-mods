// 兼容入口：实现按职责拆分，调用方继续使用此模块。
export { AI_AGENT_PERMISSION_LEVELS } from './schemas/shared.js'
export { AI_AGENT_TOOL_DESCRIPTORS } from './schemas/descriptors.js'
export {
  normalizeAiAgentToolName,
  getAiAgentToolDescriptor,
  listAiAgentToolDescriptors,
  toAiAgentFunctionName,
  fromAiAgentFunctionName,
  buildAiAgentFunctionTools
} from './schemas/registry.js'
export { validateAiAgentToolArgs } from './schemas/validation.js'
