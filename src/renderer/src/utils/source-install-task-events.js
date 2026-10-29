import { clientI18n } from '../i18n/index.js'
import { uiMessage, resolveUiMessage } from '../i18n/message.js'

const SOURCE_INSTALL_REFRESH_STATES = new Set([
  'completed',
  'completed_with_warning',
  'partial_failed'
])

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase()
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function collectPayloadCandidates(payload = {}) {
  if (!isPlainObject(payload)) {
    return []
  }

  return [
    payload,
    payload.job,
    payload.payload,
    payload.sourceInstallTaskPayload,
    payload.payload?.sourceInstallTaskPayload,
    payload.plan?.sourceInstallTaskPayload,
    payload.installPlan?.sourceInstallTaskPayload,
    payload.sourceInstallJob,
    payload.sourceInstallJob?.job,
    payload.result?.sourceInstallJob,
    payload.result?.sourceInstallJob?.job
  ].filter(isPlainObject)
}

function findFirstText(payload = {}, resolvers = []) {
  for (const candidate of collectPayloadCandidates(payload)) {
    for (const resolver of resolvers) {
      const text = normalizeText(resolver(candidate))
      if (text) {
        return text
      }
    }
  }
  return ''
}

function isAgentTaskPayload(payload = {}) {
  return Boolean(
    isPlainObject(payload) &&
      (payload.taskId || payload.task_id || payload.agentTaskId || payload.agent_task_id) &&
      (payload.stage || payload.result || payload.plan)
  )
}

export function getSourceInstallTaskState(payload = {}) {
  return findFirstText(payload, [
    (item) => item.state,
    (item) => item.job?.state,
    (item) => item.payload?.state
  ]) || findFirstText(payload, [
    (item) => item.stage,
    (item) => item.job?.stage
  ])
}

export function getSourceInstallTaskCompletionNotice(payload = {}) {
  const title = String(payload.title || payload.job?.title || '').trim() || uiMessage('ui.mod')
  const items = Array.isArray(payload.items) ? payload.items : []
  const downloadOnly = items.length > 0 && items.every((item) => item.state === 'file_ready')
  const warning = getSourceInstallTaskState(payload) === 'completed_with_warning'
  const messageKey = downloadOnly
    ? warning ? 'ui.downloadCompletedWarning' : 'ui.downloadCompleted'
    : warning ? 'ui.installCompletedWarning' : 'ui.installCompleted'
  const displayMessage = uiMessage(messageKey, { title })
  return {
    type: warning ? 'warning' : 'success',
    displayMessage,
    message: clientI18n.i18n.global.t(messageKey, { title: resolveUiMessage(title) })
  }
}

export function getSourceInstallTaskSource(payload = {}) {
  return findFirstText(payload, [
    (item) => item.source,
    (item) => item.sourceAdapter,
    (item) => item.source_adapter,
    (item) => item.sourceMeta?.source,
    (item) => item.metadata?.source,
    (item) => item.job?.source,
    (item) => item.payload?.source,
    (item) => item.payload?.sourceAdapter
  ])
}

export function getSourceInstallTaskGameKey(payload = {}) {
  const directGameKey = findFirstText(payload, [
    (item) => item.game_key,
    (item) => item.gameKey,
    (item) => item.job?.game_key,
    (item) => item.job?.gameKey,
    (item) => item.payload?.gameKey,
    (item) => item.payload?.game_key,
    (item) => item.sourceMeta?.gameKey
  ])
  if (directGameKey) {
    return directGameKey
  }

  const source = getSourceInstallTaskSource(payload)
  const sourceGameId = findFirstText(payload, [
    (item) => item.sourceGameId,
    (item) => item.source_game_id,
    (item) => item.sourceMeta?.sourceGameId,
    (item) => item.sourceMeta?.sourceId,
    (item) => item.sourceMeta?.sourceSlug,
    (item) => item.sourceMeta?.community,
    (item) => item.community,
    (item) => item.payload?.sourceGameId
  ])
  return source && sourceGameId ? `${source}:${sourceGameId}` : ''
}

export function shouldRefreshInstalledModsAfterSourceTask(
  payload = {},
  source = '',
  gameKeyCandidates = [],
  options = {}
) {
  if (!SOURCE_INSTALL_REFRESH_STATES.has(getSourceInstallTaskState(payload))) {
    return false
  }

  const taskSource = getSourceInstallTaskSource(payload)
  const expectedSource = normalizeText(source)
  if (expectedSource && taskSource && taskSource !== expectedSource) {
    return false
  }

  const taskGameKey = getSourceInstallTaskGameKey(payload)
  if (isAgentTaskPayload(payload) && !taskSource && !taskGameKey) {
    return false
  }

  const expectedGameKeys = new Set(
    (Array.isArray(gameKeyCandidates) ? gameKeyCandidates : [])
      .map((item) => normalizeText(item))
      .filter(Boolean)
  )
  if (!taskGameKey || expectedGameKeys.size === 0) {
    return true
  }

  if (expectedGameKeys.has(taskGameKey)) {
    return true
  }

  return options?.allowSourceOnly === true && expectedSource && taskSource === expectedSource
}

export function createSourceInstallTaskRefreshScheduler(refresh, options = {}) {
  const delays = Array.isArray(options?.delays) && options.delays.length
    ? options.delays
    : [0, 800, 2500]
  const logMessage = String(options?.logMessage || '刷新已安装模组失败').trim()
  const timers = new Set()
  let activeRunId = 0

  const clear = () => {
    activeRunId += 1
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
  }

  const schedule = () => {
    clear()
    const runId = activeRunId

    delays.forEach((delay) => {
      const safeDelay = Math.max(0, Number(delay || 0))
      const run = async () => {
        if (runId !== activeRunId) {
          return
        }

        try {
          await refresh()
        } catch (error) {
          console.warn(logMessage, error)
        }
      }

      if (safeDelay <= 0) {
        run()
        return
      }

      const timer = setTimeout(() => {
        timers.delete(timer)
        run()
      }, safeDelay)
      timers.add(timer)
    })
  }

  return {
    schedule,
    clear
  }
}

// KeepAlive 的 mounted/activated 会连续触发；订阅替换必须幂等，并保留平台专属事件。
export function createSourceInstallTaskSubscriptions(ipc, {
  onTaskUpdated,
  refreshScheduler,
  listeners = []
}) {
  const subscriptions = [
    ['source-install-task:updated', onTaskUpdated],
    ['agent-task:updated', onTaskUpdated],
    ...listeners
  ]
  function removeListeners() {
    for (const [channel, listener] of subscriptions) ipc.removeListener(channel, listener)
  }
  return {
    activate() {
      removeListeners()
      for (const [channel, listener] of subscriptions) ipc.on(channel, listener)
    },
    deactivate() {
      removeListeners()
      refreshScheduler.clear()
    }
  }
}
