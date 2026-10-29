import { probeEdgeTranslate } from './edgeTranslateProvider.js'
import {
  DEFAULT_TRANSLATION_RUNTIME_STATUS,
  normalizeTranslationRuntimeStatus
} from '../../../shared/translation/translation-runtime-config.js'

const EDGE_PROBE_TEXTS = Object.freeze(['Start Game', 'Settings', 'Exit'])
const EDGE_PROBE_TIMEOUT_MS = 5000

let runtimeStatus = normalizeTranslationRuntimeStatus(DEFAULT_TRANSLATION_RUNTIME_STATUS)
let statusNotifier = null
let activeProbePromise = null

function toSafeText(value = '') {
  return String(value || '').trim()
}

function getStatusSnapshot() {
  return normalizeTranslationRuntimeStatus(runtimeStatus)
}

function emitStatusChanged() {
  if (typeof statusNotifier !== 'function') {
    return
  }

  try {
    statusNotifier(getStatusSnapshot())
  } catch (error) {
    console.warn('[翻译运行时] 状态通知失败', error?.message || error)
  }
}

function updateEdgeStatus(patch = {}) {
  runtimeStatus = normalizeTranslationRuntimeStatus({
    ...runtimeStatus,
    edge: {
      ...runtimeStatus.edge,
      ...patch
    }
  })
  emitStatusChanged()
  return getStatusSnapshot()
}

export function setTranslationRuntimeStatusNotifier(notifier = null) {
  statusNotifier = typeof notifier === 'function' ? notifier : null
}

export function getTranslationRuntimeStatus() {
  return getStatusSnapshot()
}

export function markEdgeTranslateAvailable(payload = {}) {
  return updateEdgeStatus({
    status: 'available',
    available: true,
    checkedAt: new Date().toISOString(),
    latencyMs: Number(payload.latencyMs || 0) || 0,
    errorMessage: ''
  })
}

export function markEdgeTranslateUnavailable(payload = {}) {
  return updateEdgeStatus({
    status: 'unavailable',
    available: false,
    checkedAt: new Date().toISOString(),
    latencyMs: Number(payload.latencyMs || 0) || 0,
    errorMessage: toSafeText(payload.errorMessage) || 'Edge 翻译不可用'
  })
}

export async function runTranslationRuntimeProbe(payload = {}) {
  if (activeProbePromise) {
    return await activeProbePromise
  }

  activeProbePromise = (async () => {
    const reason = toSafeText(payload.reason) || 'manual'
    updateEdgeStatus({
      status: 'checking',
      available: false,
      checkedAt: '',
      latencyMs: 0,
      errorMessage: ''
    })

    const result = await probeEdgeTranslate({
      texts: EDGE_PROBE_TEXTS,
      targetLanguage: 'zh-Hans',
      timeoutMs: Number(payload.timeoutMs || EDGE_PROBE_TIMEOUT_MS) || EDGE_PROBE_TIMEOUT_MS
    })

    const nextStatus = result.available
      ? markEdgeTranslateAvailable({
          latencyMs: result.latencyMs
        })
      : markEdgeTranslateUnavailable({
          latencyMs: result.latencyMs,
          errorMessage: result.errorMessage
        })

    console.info('[翻译自检] Edge 翻译自检完成', {
      reason,
      available: nextStatus.edge.available,
      latencyMs: nextStatus.edge.latencyMs,
      errorMessage: nextStatus.edge.errorMessage
    })

    return nextStatus
  })().finally(() => {
    activeProbePromise = null
  })

  return await activeProbePromise
}
