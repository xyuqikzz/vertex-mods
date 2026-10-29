// 工具入参的轻量 JSON Schema 校验。

const MAX_STRING_ARG_LENGTH = 500

function coerceValue(schema = {}, value) {
  if (schema.type === 'number' || schema.type === 'integer') {
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  if (schema.type === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }
  if (schema.type === 'string' && typeof value === 'number') {
    return String(value)
  }
  return value
}

function validateProperty(name = '', schema = {}, rawValue) {
  const value = coerceValue(schema, rawValue)

  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `${name} 必须是数字` }
    }
    if (schema.type === 'integer' && !Number.isInteger(value))
      return { error: `${name} 必须是整数` }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return { error: `${name} 不能小于 ${schema.minimum}` }
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return { value: schema.maximum }
    }
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return { error: `${name} 必须是布尔值` }
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return { error: `${name} 必须是字符串` }
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return { error: `${name} 不能超过 ${schema.maxLength} 个字符` }
    }
    if (typeof schema.maxLength !== 'number' && value.length > MAX_STRING_ARG_LENGTH) {
      return { value: value.slice(0, MAX_STRING_ARG_LENGTH) }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { error: `${name} 必须是数组` }
    }
  } else if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `${name} 必须是对象` }
    }
  }

  if (Array.isArray(schema.enum) && schema.enum.length && !schema.enum.includes(value)) {
    return { error: `${name} 必须是以下值之一：${schema.enum.join(' / ')}` }
  }

  return { value }
}

/**
 * 校验并规整工具入参。
 * @returns {{ valid: boolean, errors: string[], value: object }}
 */
export function validateAiAgentToolArgs(descriptor = {}, args = {}) {
  const schema = descriptor?.inputSchema
  const source = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  if (!schema || schema.type !== 'object') {
    return { valid: true, errors: [], value: { ...source } }
  }

  const errors = []
  const value = {}
  const properties =
    schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((alternative) =>
      alternative.required.every(
        (key) =>
          source[key] !== undefined &&
          source[key] !== null &&
          (typeof source[key] !== 'string' || source[key].trim())
      )
    )
  ) {
    errors.push(
      `至少提供 ${schema.anyOf.map((alternative) => alternative.required.join('、')).join(' 或 ')}`
    )
  }

  for (const key of required) {
    const raw = source[key]
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
      errors.push(`缺少必填参数 ${key}`)
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    const raw = source[key]
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && !raw.trim() && !required.includes(key))
    ) {
      continue
    }
    const result = validateProperty(key, propertySchema || {}, raw)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    value[key] = result.value
  }

  return {
    valid: errors.length === 0,
    errors,
    value
  }
}
