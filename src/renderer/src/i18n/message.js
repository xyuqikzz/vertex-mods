import { clientI18n } from './index.js'

// Keep a cloneable message identity in transient UI state; resolve it when rendering.
export function uiMessage(key, params = {}) {
  return { messageKey: key, messageParams: params }
}

export function resolveUiMessage(value) {
  if (!value || typeof value !== 'object' || typeof value.messageKey !== 'string')
    return String(value ?? '')
  const params = Object.fromEntries(Object.entries(value.messageParams || {}).map(([key, item]) =>
    [key, item?.messageKey ? resolveUiMessage(item) : item]
  ))
  return clientI18n.i18n.global.t(value.messageKey, params)
}
