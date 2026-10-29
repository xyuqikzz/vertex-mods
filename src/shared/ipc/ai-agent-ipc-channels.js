export const AI_AGENT_CHAT_CHANNEL = 'ai-agent:chat'
export const AI_AGENT_CHAT_V2_CHANNEL = 'ai-agent:chat-v2'
export const AI_AGENT_CHAT_DELTA_CHANNEL = 'agent-chat:delta'
export const AI_AGENT_SESSION_TITLE_CHANNEL = 'ai-agent:session-title'

export const AI_AGENT_CHAT_CHANNELS = Object.freeze([
  AI_AGENT_CHAT_CHANNEL,
  AI_AGENT_CHAT_V2_CHANNEL
])

export function isAiAgentChatV2MissingHandlerError(error = null) {
  const message = String(error?.message || error || '')
  return /No handler registered/i.test(message) && message.includes(AI_AGENT_CHAT_V2_CHANNEL)
}

export async function invokeAiAgentChatChannel(invoke, payload = {}) {
  if (typeof invoke !== 'function') {
    throw new TypeError('invokeAiAgentChatChannel requires an invoke function')
  }

  try {
    return await invoke(AI_AGENT_CHAT_V2_CHANNEL, payload)
  } catch (error) {
    if (!isAiAgentChatV2MissingHandlerError(error)) {
      throw error
    }
    return await invoke(AI_AGENT_CHAT_CHANNEL, payload)
  }
}
