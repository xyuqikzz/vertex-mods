// 环境变量与运行时工具状态读取。

export function readEnvText(env = {}, key = '') {
  return String(env?.[key] ?? '').trim()
}

export function isEnvEnabled(env = {}, key = '') {
  return readEnvText(env, key) === '1'
}

export function hasAnyEnv(env = {}, keys = []) {
  return keys.some((key) => !!readEnvText(env, key))
}

export function hasAllEnv(env = {}, keys = []) {
  return keys.every((key) => !!readEnvText(env, key))
}

export function hasRuntimeText(runtimeStatus = {}, key = '') {
  return String(runtimeStatus?.[key] || '').trim().length > 0
}

export function parseEnvListText(value = '') {
  return String(value || '')
    .split(/[\r\n;]+/)
    .map((item) => item.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

export function hasRuntimeTool(runtimeStatus = {}, toolName = '') {
  const expectedName = String(toolName || '').trim()
  if (!expectedName || !Array.isArray(runtimeStatus?.tools)) return false
  return runtimeStatus.tools.some((item) => {
    if (typeof item === 'string') return item === expectedName
    return (
      String(item?.name || '').trim() === expectedName ||
      String(item?.toolName || '').trim() === expectedName ||
      String(item?.function?.name || '').trim() === expectedName
    )
  })
}
