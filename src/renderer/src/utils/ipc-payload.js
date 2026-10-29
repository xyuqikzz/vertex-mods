import { isRef, toRaw } from 'vue'

export function sanitizeIpcPayload(payload, fallback = {}) {
  try {
    const text = JSON.stringify(payload, (_key, value) => {
      const unwrappedValue = isRef(value) ? value.value : value
      return unwrappedValue && typeof unwrappedValue === 'object'
        ? toRaw(unwrappedValue)
        : unwrappedValue
    })
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch (error) {
    console.error('IPC 参数序列化失败', error)
    return fallback
  }
}
