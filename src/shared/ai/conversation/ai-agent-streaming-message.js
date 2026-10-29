function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toMessageList(value = []) {
  return Array.isArray(value) ? value : []
}

function normalizeMessageExtra(extra = {}) {
  return extra && typeof extra === 'object' ? extra : {}
}

function createDefaultMessage(role, content, extra = {}) {
  return {
    id: toSafeText(extra.id),
    role,
    content,
    type: extra.type || 'text',
    createdAt: Date.now(),
    ...extra
  }
}

const DUPLICATE_TEXT_MIN_LENGTH = 6

function normalizeComparableText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isDuplicateTailContent(previousContent = '', nextContent = '') {
  const previous = normalizeComparableText(previousContent)
  const next = normalizeComparableText(nextContent)
  return (
    next.length >= DUPLICATE_TEXT_MIN_LENGTH &&
    previous.length > next.length &&
    previous.endsWith(next)
  )
}

function removeDuplicateTailLines(content = '') {
  const lines = String(content || '').split(/\r?\n/)
  const normalizedLines = []
  let previousText = ''

  lines.forEach((line) => {
    const text = line.trim()
    if (isDuplicateTailContent(previousText, text)) {
      while (normalizedLines.length && !normalizedLines[normalizedLines.length - 1].trim()) {
        normalizedLines.pop()
      }
      return
    }
    normalizedLines.push(line)
    if (text) {
      previousText = text
    }
  })

  return normalizedLines.join('\n')
}

function normalizeAssistantMessageContent(content = '') {
  return removeDuplicateTailLines(String(content || '').trim())
}

function findTrailingOverlap(currentContent = '', delta = '') {
  const current = String(currentContent || '')
  const incoming = String(delta || '')
  const maxLength = Math.min(current.length, incoming.length)

  for (let length = maxLength; length >= 2; length -= 1) {
    if (current.endsWith(incoming.slice(0, length))) {
      return length
    }
  }
  return 0
}

function mergeStreamingDelta(currentContent = '', delta = '') {
  const current = String(currentContent || '')
  const incoming = String(delta || '')
  const incomingWithoutLeadingSpace = incoming.trimStart()

  if (!current) return incoming
  if (incoming.startsWith(current)) return incoming
  if (incoming.length >= 6 && current.endsWith(incoming)) return current
  if (incomingWithoutLeadingSpace.length >= 6 && current.endsWith(incomingWithoutLeadingSpace)) {
    return current
  }

  const overlapLength = findTrailingOverlap(current, incoming)
  if (overlapLength > 0) {
    return `${current}${incoming.slice(overlapLength)}`
  }
  return `${current}${incoming}`
}

function mergeFinalAssistantContent(previousContent = '', incomingContent = '') {
  const previous = normalizeAssistantMessageContent(previousContent)
  const incoming = normalizeAssistantMessageContent(incomingContent)

  if (!previous) return incoming
  if (!incoming) return previous
  if (isDuplicateTailContent(previous, incoming)) return previous
  if (isDuplicateTailContent(incoming, previous)) return incoming
  if (incoming.startsWith(previous)) return incoming
  if (previous.startsWith(incoming)) return previous
  return incoming
}

function findMergeableAssistantMessageIndex(messages = [], incomingContent = '', executionId = '') {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') break
    if (message?.role !== 'assistant') continue
    if (executionId) {
      if (message.executionId === executionId) return index
      continue
    }
    if (message.streaming === true) return index
    if (isDuplicateTailContent(message.content, incomingContent)) return index
    if (isDuplicateTailContent(incomingContent, message.content)) return index
    const existingContent = String(message.content || '').trim()
    if (
      existingContent &&
      String(incomingContent || '')
        .trim()
        .startsWith(existingContent)
    ) {
      return index
    }
    break
  }
  return -1
}

export function applyAiAgentStreamingDelta(state = {}, payload = {}, context = {}, options = {}) {
  const executionId = toSafeText(payload?.executionId)
  const sessionId = toSafeText(payload?.sessionId)
  const delta = String(payload?.delta || '')
  const currentExecutionId = toSafeText(context?.currentExecutionId)
  const currentSessionId = toSafeText(context?.currentSessionId)
  const messages = toMessageList(state.messages)

  if (!executionId || executionId !== currentExecutionId) {
    return { ...state, messages, changed: false }
  }
  if (sessionId && sessionId !== currentSessionId) {
    return { ...state, messages, changed: false }
  }
  if (!delta) {
    return { ...state, messages, changed: false }
  }
  if (payload.sequence && state.streamingExecutionId === executionId && payload.sequence <= (state.streamingSequence || 0)) {
    return { ...state, messages, changed: false }
  }

  let streamingAssistantMessageId = toSafeText(state.streamingAssistantMessageId)
  let streamingExecutionId = toSafeText(state.streamingExecutionId)
  let nextMessages = messages.slice()

  if (!streamingAssistantMessageId || streamingExecutionId !== executionId) {
    streamingExecutionId = executionId
    streamingAssistantMessageId =
      payload.deltaMode === 'append' ? `reply-${executionId}` : typeof options.createId === 'function'
        ? toSafeText(options.createId('stream'))
        : `stream-${Date.now()}`
    const createMessage =
      typeof options.createMessage === 'function' ? options.createMessage : createDefaultMessage
    nextMessages.push(
      createMessage('assistant', '', {
        id: streamingAssistantMessageId,
        type: 'streaming',
        streaming: true,
        executionId
      })
    )
  }

  const messageIndex = nextMessages.findIndex(
    (message) => message.id === streamingAssistantMessageId
  )
  if (messageIndex < 0) {
    return {
      ...state,
      messages: nextMessages,
      streamingAssistantMessageId,
      streamingExecutionId,
      changed: false
    }
  }

  const currentMessage = nextMessages[messageIndex]
  nextMessages[messageIndex] = {
    ...currentMessage,
    content: payload.deltaMode === 'append' ? currentMessage.content + delta : mergeStreamingDelta(currentMessage.content, delta),
    updatedAt: Date.now()
  }

  return {
    messages: nextMessages,
    streamingAssistantMessageId,
    streamingExecutionId,
    streamingSequence: payload.sequence || state.streamingSequence || 0,
    changed: true
  }
}

export function finalizeAiAgentStreamingAssistantMessage(
  state = {},
  content = '',
  extra = {},
  options = {}
) {
  const safeExtra = normalizeMessageExtra(extra)
  const safeContent = safeExtra.executionId ? String(content || '').trim() : normalizeAssistantMessageContent(content)
  const messages = toMessageList(state.messages)
  if (!safeContent && !safeExtra.toolCalls?.length && !safeExtra.confirmations?.length) {
    return { ...state, messages, changed: false }
  }

  const streamingAssistantMessageId = toSafeText(state.streamingAssistantMessageId)
  const toolCalls = Array.isArray(safeExtra.toolCalls) ? safeExtra.toolCalls : []
  const confirmations = Array.isArray(safeExtra.confirmations) ? safeExtra.confirmations : []

  if (streamingAssistantMessageId) {
    const messageIndex = messages.findIndex((message) => message.id === streamingAssistantMessageId)
    if (messageIndex >= 0 && (!safeExtra.executionId || messages[messageIndex].executionId === safeExtra.executionId)) {
      const nextMessages = messages.slice()
      nextMessages[messageIndex] = {
        ...nextMessages[messageIndex],
        ...safeExtra,
        content: safeExtra.executionId ? safeContent : mergeFinalAssistantContent(nextMessages[messageIndex].content, safeContent),
        type: safeExtra.type || 'text',
        streaming: false,
        toolCalls,
        confirmations,
        updatedAt: Date.now()
      }
      return {
        messages: nextMessages,
        streamingAssistantMessageId: '',
        streamingExecutionId: '',
        changed: true
      }
    }
  }

  const createMessage =
    typeof options.createMessage === 'function' ? options.createMessage : createDefaultMessage
  const mergeableMessageIndex = findMergeableAssistantMessageIndex(messages, safeContent, safeExtra.executionId)
  if (mergeableMessageIndex >= 0) {
    const nextMessages = messages.slice()
    nextMessages[mergeableMessageIndex] = {
      ...nextMessages[mergeableMessageIndex],
      ...safeExtra,
      content: safeExtra.executionId ? safeContent : mergeFinalAssistantContent(nextMessages[mergeableMessageIndex].content, safeContent),
      type: safeExtra.type || 'text',
      streaming: false,
      toolCalls,
      confirmations,
      updatedAt: Date.now()
    }
    return {
      messages: nextMessages,
      streamingAssistantMessageId: '',
      streamingExecutionId: '',
      changed: true
    }
  }
  return {
    messages: messages.concat(createMessage('assistant', safeContent, safeExtra)),
    streamingAssistantMessageId: '',
    streamingExecutionId: '',
    changed: true
  }
}
