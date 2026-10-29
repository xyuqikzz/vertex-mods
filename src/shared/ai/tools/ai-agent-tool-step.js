// 把一次工具调用整理成对话框里可读的一步，例如“搜索模组：nexus · drop rate”。
// 只挑选白名单里的短字段，路径、凭据、长文本一律不展示。
const STEP_DETAIL_KEYS = Object.freeze([
  'source',
  'keyword',
  'domainName',
  'community',
  'gameName',
  'modName',
  'name',
  'modId',
  'fileId',
  'version',
  'skillId',
  'jobId',
  'taskId',
  'agentTaskId',
  'action',
  'actionType'
])
const MAX_DETAIL_PARTS = 3
const MAX_DETAIL_PART_LENGTH = 48

export function describeAiAgentToolStep(call = {}, title = '') {
  const args = call?.arguments && typeof call.arguments === 'object' ? call.arguments : {}
  const parts = []
  for (const key of STEP_DETAIL_KEYS) {
    const value = args[key]
    const text =
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : ''
    if (!text || text.length > MAX_DETAIL_PART_LENGTH || /[\\/]/.test(text) || parts.includes(text))
      continue
    parts.push(text)
    if (parts.length >= MAX_DETAIL_PARTS) break
  }
  return {
    name: String(call?.name || ''),
    title: String(title || call?.name || '').trim(),
    detail: parts.join(' · ')
  }
}

export function resolveAiAgentStepStatus(result = {}) {
  if (result?.confirmationRequired === true) return 'waiting'
  return result?.success === false ? 'failed' : 'success'
}
