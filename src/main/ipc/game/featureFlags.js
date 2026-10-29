function readBoolEnv(key, defaultValue = true) {
  const value = process.env[key]
  if (value === undefined || value === null || value === '') return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return true
}

export function getModFeatureFlags() {
  return {
    enablePriorityReconcile: readBoolEnv('VERTEX_ENABLE_PRIORITY_RECONCILE', true)
  }
}

export function getAiAgentFeatureFlags() {
  return {
    // Agent V2：工具注册 + schema 校验 + 权限策略 + 审计日志 + function calling 编排
    enableAgentV2: readBoolEnv('VERTEX_ENABLE_AGENT_V2', true),
    // Agent 写工具：execute/destructive 总开关，关闭后即使用户确认也不执行写操作
    enableAgentWriteTools: readBoolEnv('VERTEX_ENABLE_AGENT_WRITE_TOOLS', true),
    // 全自动能力总开关；关闭时 full_auto 降为 semi_auto，不能被调用上下文重新开启
    enableAgentFullAuto: readBoolEnv('VERTEX_ENABLE_AGENT_FULL_AUTO', true)
  }
}
