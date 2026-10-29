import { reactive } from 'vue'
import { uiMessage } from '../i18n/message.js'

const TYPE_META = {
  info: {
    label: uiMessage('ui.information')
  },
  success: {
    label: uiMessage('ui.success')
  },
  error: {
    label: uiMessage('ui.failed')
  },
  warning: {
    label: uiMessage('ui.warning')
  }
}

const DEFAULT_WIDTH = 'min(520px, calc(100vw - 32px))'

const defaultState = () => ({
  open: false,
  type: 'info',
  toneLabel: uiMessage('ui.information'),
  title: '',
  content: '',
  duration: 2,
  showIcon: true,
  showClose: true,
  width: DEFAULT_WIDTH,
  stackIndex: 0,
  stackSize: 0
})

export const messageTipStack = reactive([])
export const messageTipState = reactive(defaultState())

let activeId = 0
const entryTimers = new Map()
const entryCloseAtMap = new Map()
const entryOptionsMap = new Map()

function normalizeType(value) {
  const type = String(value || 'info')
    .trim()
    .toLowerCase()

  if (type === 'success' || type === 'error' || type === 'warning') {
    return type
  }
  return 'info'
}

function normalizeText(value, fallback = '') {
  if (value?.messageKey) return value
  if (value == null && fallback?.messageKey) return fallback
  const text = String(value ?? fallback ?? '').trim()
  return text || fallback
}

function normalizeDuration(value) {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration < 0) {
    return 3
  }
  return duration
}

function normalizeWidth(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return `min(${Math.round(value)}px, calc(100vw - 32px))`
  }

  const width = String(value ?? '').trim()
  return width || DEFAULT_WIDTH
}

function resolveTitle(options, type) {
  const content = normalizeText(options.content, '')
  const title = normalizeText(options.title, '')
  if (title) return title
  if (content) return content
  return TYPE_META[type].label
}

function createEntry(options = {}) {
  const type = normalizeType(options.type ?? options.status)

  return {
    id: ++activeId,
    type,
    toneLabel: normalizeText(options.toneLabel, TYPE_META[type].label),
    title: resolveTitle(options, type),
    content: normalizeText(options.content, ''),
    duration: normalizeDuration(options.duration ?? 3),
    showIcon: options.showIcon !== false,
    showClose: options.showClose !== false,
    width: normalizeWidth(options.width)
  }
}

function clearTimer(id) {
  const timer = entryTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    entryTimers.delete(id)
  }
  entryCloseAtMap.delete(id)
}

function syncLegacyState() {
  const top = messageTipStack[0]
  if (!top) {
    Object.assign(messageTipState, defaultState())
    return
  }

  Object.assign(messageTipState, {
    ...defaultState(),
    ...top,
    open: true,
    stackIndex: 0,
    stackSize: messageTipStack.length
  })
}

function scheduleAutoClose(entry, duration = entry.duration) {
  clearTimer(entry.id)

  if (!duration) {
    return
  }

  const delay = duration * 1000
  const timer = setTimeout(() => {
    closeMessageTip(entry.id)
  }, delay)

  entryTimers.set(entry.id, timer)
  entryCloseAtMap.set(entry.id, Date.now() + delay)
}

function extendAutoClose(entry, extraDuration = 0.5) {
  if (!entry?.duration) {
    return
  }

  const closeAt = entryCloseAtMap.get(entry.id)
  const remaining = Math.max((closeAt || Date.now()) - Date.now(), 0)
  scheduleAutoClose(entry, remaining / 1000 + extraDuration)
}

function removeEntryById(id) {
  const index = messageTipStack.findIndex((item) => item.id === id)
  if (index < 0) {
    return null
  }

  const [entry] = messageTipStack.splice(index, 1)
  clearTimer(entry.id)
  entryOptionsMap.delete(entry.id)
  syncLegacyState()
  return entry
}

function updateMessageTip(id, nextOptions = {}) {
  const entry = messageTipStack.find((item) => item.id === id)
  if (!entry) {
    return false
  }

  const currentOptions = entryOptionsMap.get(id) || {}
  const mergedOptions = {
    ...currentOptions,
    ...nextOptions
  }
  const type = normalizeType(mergedOptions.type ?? mergedOptions.status)

  Object.assign(entry, {
    type,
    toneLabel: normalizeText(mergedOptions.toneLabel, TYPE_META[type].label),
    title: resolveTitle(mergedOptions, type),
    content: normalizeText(mergedOptions.content, ''),
    duration: normalizeDuration(mergedOptions.duration ?? 3),
    showIcon: mergedOptions.showIcon !== false,
    showClose: mergedOptions.showClose !== false,
    width: normalizeWidth(mergedOptions.width)
  })

  entryOptionsMap.set(id, {
    ...mergedOptions,
    type
  })
  scheduleAutoClose(entry)
  syncLegacyState()
  return true
}

function isSameMessageTip(current, next) {
  return JSON.stringify([current?.title, current?.content]) === JSON.stringify([next?.title, next?.content])
}

function createController(entry) {
  return {
    close() {
      closeMessageTip(entry.id)
    },
    update(nextOptions = {}) {
      updateMessageTip(entry.id, nextOptions)
    },
    destroy() {
      closeMessageTip(entry.id)
    }
  }
}

export function closeMessageTip(id = null) {
  if (id == null) {
    const top = messageTipStack[0]
    if (!top) {
      return false
    }
    return Boolean(removeEntryById(top.id))
  }

  return Boolean(removeEntryById(id))
}

export function showMessageTip(options = {}) {
  const entry = createEntry(options)
  const top = messageTipStack[0]

  if (isSameMessageTip(top, entry)) {
    extendAutoClose(top)
    return createController(top)
  }

  messageTipStack.unshift(entry)
  entryOptionsMap.set(entry.id, {
    ...options,
    type: entry.type
  })
  syncLegacyState()
  scheduleAutoClose(entry)

  return createController(entry)
}

export const messageTip = {
  show: showMessageTip,
  info(title, options = {}) {
    return showMessageTip({
      ...options,
      type: 'info',
      title
    })
  },
  success(title, options = {}) {
    return showMessageTip({
      ...options,
      type: 'success',
      title
    })
  },
  warning(title, options = {}) {
    return showMessageTip({
      ...options,
      type: 'warning',
      title
    })
  },
  error(title, options = {}) {
    return showMessageTip({
      ...options,
      type: 'error',
      title
    })
  },
  close(id = null) {
    return closeMessageTip(id)
  },
  closeAll() {
    const items = [...messageTipStack]
    items.forEach((item) => closeMessageTip(item.id))
  },
  update(id, nextOptions = {}) {
    return updateMessageTip(id, nextOptions)
  }
}
