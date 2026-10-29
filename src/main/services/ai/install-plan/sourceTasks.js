// 按来源分派安装任务准备，保留不支持来源的失败契约。
import { toSafeText, toPlainJson } from './values.js'
import { resolveNexusSourceTask } from './sources/nexusPlan.js'
import { resolveThunderstoreSourceTask } from './sources/thunderstore.js'
import { resolveVamhubSourceTask } from './sources/vamhub.js'
import { resolveModioSourceTask } from './sources/modio.js'
import { resolveFicsitSourceTask } from './sources/ficsit.js'

export async function resolveAiAgentSourceInstallTaskPayload(payload = {}) {
  const candidate = toPlainJson(payload?.candidate, {})
  const context = toPlainJson(payload?.context, {})
  const source = toSafeText(candidate?.source).toLowerCase()

  if (source === 'nexus') {
    return resolveNexusSourceTask(payload, candidate, context)
  }

  if (source === 'thunderstore') {
    return resolveThunderstoreSourceTask(payload, candidate, context)
  }

  if (source === 'vamhub') {
    return resolveVamhubSourceTask(payload, candidate, context)
  }

  if (source === 'modio') {
    return resolveModioSourceTask(payload, candidate, context)
  }

  if (source !== 'ficsit') {
    return {
      success: false,
      payload: null,
      reason: 'source_not_supported'
    }
  }

  return resolveFicsitSourceTask(payload, candidate, context)
}
