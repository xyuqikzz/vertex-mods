import { getAiAgentDefinition } from '../../../shared/ai/config/ai-agent-definition.js'

export function listAiAgentSkills() {
  return getAiAgentDefinition().skills.map((item) => ({ ...item }))
}
