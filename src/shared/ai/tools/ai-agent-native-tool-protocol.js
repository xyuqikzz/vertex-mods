import { fromAiAgentFunctionName } from './ai-agent-tool-schemas.js'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

export function parseAiAgentFunctionArguments(rawArguments) {
  if (rawArguments && typeof rawArguments === 'object') {
    return toPlainJson(rawArguments, {})
  }
  try {
    const parsed = JSON.parse(String(rawArguments || '{}'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function normalizeAiAgentNativeToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((item) => {
    const raw = item?.function?.arguments
    let argumentError = ''
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      argumentError = '工具参数不是合法 JSON 对象，操作未执行；请按工具定义重新生成完整参数。'
    }
    return {
      id: toSafeText(item?.id),
      name: fromAiAgentFunctionName(item?.function?.name),
      arguments: parseAiAgentFunctionArguments(raw),
      ...(argumentError ? { argumentError } : {})
    }
  })
}

export function mergeAiAgentStreamToolCallDelta(toolCallMap, toolCallDelta = {}) {
  if (!toolCallMap || typeof toolCallMap.get !== 'function') return
  const index = Number.isFinite(Number(toolCallDelta.index)) ? Number(toolCallDelta.index) : 0
  const current = toolCallMap.get(index) || {
    index,
    id: '',
    type: 'function',
    function: {
      name: '',
      arguments: ''
    }
  }

  if (toolCallDelta.id) {
    current.id = toSafeText(toolCallDelta.id)
  }
  if (toolCallDelta.type) {
    current.type = toSafeText(toolCallDelta.type) || 'function'
  }
  if (toolCallDelta.function?.name) {
    current.function.name += toSafeText(toolCallDelta.function.name)
  }
  if (toolCallDelta.function?.arguments) {
    current.function.arguments += String(toolCallDelta.function.arguments || '')
  }

  toolCallMap.set(index, current)
}

export function buildAiAgentStreamToolCalls(toolCallMap) {
  if (!toolCallMap || typeof toolCallMap.values !== 'function') return []
  return [...toolCallMap.values()]
    .sort((left, right) => left.index - right.index)
    .map((item) => ({
      id: item.id,
      type: item.type || 'function',
      function: {
        name: item.function?.name || '',
        arguments: item.function?.arguments || ''
      }
    }))
}

export function buildAiAgentNativeChatRequest(options = {}) {
  return {
    model: toSafeText(options.model),
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.2,
    messages: Array.isArray(options.messages) ? options.messages : [],
    tools: Array.isArray(options.tools || options.nativeTools) ? options.tools || options.nativeTools : [],
    tool_choice: options.circuitBroken ? 'none' : 'auto'
  }
}

function readErrorStatus(error = null) {
  return Number(error?.status || error?.response?.status || 0)
}

// DeepSeek 思考模式带 tools 时，要求此前助手消息回传 reasoning_content，缺失返回 400。
export function isAiAgentReasoningContentRequiredError(error = null) {
  if (!error || error.name === 'AbortError') return false
  const status = readErrorStatus(error)
  return (!status || status === 400) && /reasoning_content/i.test(toSafeText(error?.message))
}

// 接口按真实分词判断请求超出模型上下文；本地估算只是近似值，两者可能不一致。
export function isAiAgentContextLengthExceededError(error = null) {
  if (!error || error.name === 'AbortError') return false
  const status = readErrorStatus(error)
  if (status && ![400, 413, 422].includes(status)) return false
  return /context.{0,16}(length|window|limit)|maximum context|too many tokens|token limit|prompt is too long|input is too long|上下文.{0,8}(长度|超出|过长)/i.test(
    toSafeText(error?.message)
  )
}

// 与工具无关的 400/422（上下文超长、内容审核、模型不存在、思考内容缺失）必须如实报错，
// 不能悄悄改用文本协议掩盖真实原因。
function isUnrelatedRequestError(message = '') {
  return /content.?(filter|policy|moderation)|safety|sensitive|model.{0,24}(not.?exist|not.?found|does not exist)|reasoning_content|context.{0,16}(length|window|limit)|maximum context|too many tokens|prompt is too long|上下文|审核|敏感/i.test(
    message
  )
}

export function isLikelyAiAgentToolsUnsupportedError(error = null) {
  if (!error || error.name === 'AbortError') return false
  const message = toSafeText(error?.message).toLowerCase()
  if (isUnrelatedRequestError(message)) return false
  const status = readErrorStatus(error)
  if (status === 400 || status === 422) return true
  return /tool|function|unsupported|invalid.*param/i.test(message)
}

export function isLikelyAiAgentStreamUnsupportedError(error = null) {
  if (!error || error.name === 'AbortError') return false
  const message = toSafeText(error?.message).toLowerCase()
  const status = Number(error?.status || error?.response?.status || 0)
  if ((status === 400 || status === 422) && !message) return false
  if (status === 400 || status === 422) return /stream|streaming/i.test(message)
  return /stream|streaming.*unsupported|unsupported.*stream/i.test(message)
}
