export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key)
}

export function formatRulePath(pathList = []) {
  if (!Array.isArray(pathList) || !pathList.length) {
    return 'rule'
  }

  let result = ''
  for (const item of pathList) {
    if (typeof item === 'number') {
      result += `[${item}]`
      continue
    }

    const text = String(item || '').trim()
    if (!text) {
      continue
    }

    result += result ? `.${text}` : text
  }

  return result || 'rule'
}

export function createRuleCompileError(
  code = 'rule_compile_error',
  message = '规则编译失败',
  detail = {}
) {
  const error = new Error(message)
  error.code = code
  error.detail = detail
  return error
}
