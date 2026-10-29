function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

export function resolveAgentTaskStatusTaskId(payload = {}) {
  if (typeof payload === 'string' || typeof payload === 'number') {
    return toSafeText(payload)
  }
  if (!payload || typeof payload !== 'object') return ''

  return toSafeText(
    payload.taskId || payload.task_id || payload.agentTaskId || payload.agent_task_id
  )
}

export async function resolveAgentTaskStatus(payload = {}, deps = {}) {
  const taskId = resolveAgentTaskStatusTaskId(payload)
  if (!taskId || typeof deps.getAgentTask !== 'function') return null

  return await deps.getAgentTask(taskId)
}
