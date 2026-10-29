// 汇总各验收场景的门槛和就绪状态。
import { AI_AGENT_READINESS_STATUSES } from './constants.js'
import { buildReadinessItem } from './status.js'
import { READINESS_DEFINITIONS } from './definitions.js'

export function resolveAiAgentReadinessStatus(runtimeStatus = {}, options = {}) {
  const context = {
    runtimeStatus: runtimeStatus && typeof runtimeStatus === 'object' ? runtimeStatus : {},
    env: options?.env && typeof options.env === 'object' ? options.env : {},
    featureFlags:
      options?.featureFlags && typeof options.featureFlags === 'object' ? options.featureFlags : {},
    directoryRootStatus: Array.isArray(options?.directoryRootStatus)
      ? options.directoryRootStatus
      : [],
    nexusApiKeyStatus:
      options?.nexusApiKeyStatus && typeof options.nexusApiKeyStatus === 'object'
        ? options.nexusApiKeyStatus
        : {},
    externalLogFileStatus: Array.isArray(options?.externalLogFileStatus)
      ? options.externalLogFileStatus
      : []
  }
  const items = READINESS_DEFINITIONS.map((definition) => buildReadinessItem(definition, context))
  const summary = items.reduce(
    (acc, item) => {
      acc.total += 1
      if (item.status === AI_AGENT_READINESS_STATUSES.READY) acc.readyCount += 1
      if (item.status === AI_AGENT_READINESS_STATUSES.PROTECTED) acc.protectedCount += 1
      if (item.status === AI_AGENT_READINESS_STATUSES.NEEDS_INPUT) acc.needsInputCount += 1
      if (item.status === AI_AGENT_READINESS_STATUSES.BLOCKED) acc.blockedCount += 1
      return acc
    },
    {
      total: 0,
      readyCount: 0,
      protectedCount: 0,
      needsInputCount: 0,
      blockedCount: 0
    }
  )

  return {
    summary: {
      ...summary,
      remainingCount: summary.total - summary.readyCount
    },
    items
  }
}
