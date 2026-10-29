const SOURCE_LABELS = Object.freeze({
  ai: 'AI 服务',
  nexus: 'Nexus 服务',
  modio: 'Mod.io 服务',
  ficsit: 'Ficsit 服务',
  thunderstore: 'Thunderstore 服务',
  vamhub: 'VAM-Hub 服务',
  // 编排器自身、任务记录、本地数据库等不属于任何外部服务的异常。
  agent: 'Vertex 本地处理'
})

// Classification uses provider codes/status, never the mere presence of “token”.
export function classifyAiAgentError(error = {}, options = {}) {
  const status = Number(error?.status || error?.response?.status || 0)
  const code = String(
    error?.code || error?.error?.code || error?.response?.data?.error?.code || ''
  ).toLowerCase()
  const message = String(error?.message || error?.error?.message || '')
  // 调用方未指定来源时，优先使用错误自身携带的来源（如 Nexus 账号服务的 nexus_* 错误码）。
  const source =
    options.source || String(error?.vertexErrorSource || '') || (/^nexus_/.test(code) ? 'nexus' : 'ai')
  const label = SOURCE_LABELS[source] || '模组来源服务'
  const isLocal = source === 'agent'
  let kind = 'unknown'
  if (
    ['AbortError', 'APIUserAbortError'].includes(error?.name) ||
    /^(aborted|cancelled|canceled)$/.test(code) ||
    /^request was aborted\.?$/i.test(message.trim())
  )
    kind = 'cancelled'
  else if (
    /context_length|context_window|context_budget|too_many_tokens/.test(code) ||
    /maximum context length|context (?:length|window).*(?:exceed|limit)/i.test(message)
  )
    kind = 'context'
  else if (
    /insufficient_quota|quota_exceeded|insufficient_balance/.test(code) ||
    /insufficient (?:quota|balance)/i.test(message)
  )
    kind = 'quota'
  else if (
    status === 401 ||
    /invalid_api_key|authentication_error|unauthorized|api_key_invalid|auth_expired/.test(code) ||
    /(?:invalid|incorrect|expired|missing) (?:api[ _-]?key|access token)/i.test(message)
  )
    kind = 'authentication'
  else if (status === 403 || /permission_denied|access_denied/.test(code)) kind = 'permission'
  else if (status === 429 || /rate_limit/.test(code)) kind = 'rate_limit'
  else if (
    status === 400 ||
    status === 422 ||
    /invalid_(?:parameter|request|argument)/.test(code) ||
    /max_tokens.*(?:must|invalid|unsupported)/i.test(message)
  )
    kind = 'parameters'
  else if (
    status === 408 ||
    /timeout|etimedout|econnaborted/.test(code) ||
    error?.name === 'TimeoutError'
  )
    kind = 'timeout'
  else if (
    /econnreset|econnrefused|enotfound|eai_again|fetch_failed|network_failed/.test(code) ||
    /fetch failed|connection error|network error/i.test(message)
  )
    kind = 'network'
  else if (status >= 500) kind = 'unavailable'
  const descriptions = {
    cancelled: '本轮处理已停止。已提交的安装任务请在任务中心查看。',
    authentication: `${label}认证失败，请检查对应账号或接口凭据。`,
    permission: `${label}拒绝访问，请检查账号权限。`,
    quota: `${label}额度不足，请检查用量或余额。`,
    context: '对话内容超过模型容量，请缩小问题范围或新建会话。',
    parameters:
      source === 'ai'
        ? `${label}不支持本次请求参数，请检查模型与接口配置。`
        : isLocal
          ? `${label}收到无效参数，本轮未完成。`
          : `${label}不支持本次查询参数，请核对游戏与搜索条件。`,
    rate_limit: `${label}请求过于频繁，请稍后重试。`,
    timeout: `${label}响应超时，请稍后重试。`,
    network: isLocal ? '网络连接失败，请检查网络后重试。' : `暂时无法连接${label}，请检查网络后重试。`,
    unavailable: `${label}暂时不可用，请稍后重试。`,
    unknown: isLocal
      ? `${label}出现异常，本轮未完成；可以重试，仍失败时请查看日志。`
      : `${label}请求未完成，暂时无法确认原因。`
  }
  return {
    kind,
    source,
    status: status || undefined,
    code: `agent_${kind}`,
    message: descriptions[kind],
    retryable: ['rate_limit', 'timeout', 'network', 'unavailable'].includes(kind),
    settings:
      !isLocal &&
      (['authentication', 'permission', 'quota'].includes(kind) ||
        (source === 'ai' && kind === 'parameters')),
    settingsTarget: source === 'ai' ? 'aiTranslation' : isLocal ? '' : 'sources'
  }
}
