import { ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import {
  DEFAULT_TRANSLATION_RUNTIME_STATUS,
  isEdgeTranslationRuntimeAvailable,
  isTranslationRuntimeConfigAvailable,
  normalizeTranslationRuntimeStatus
} from '../../../shared/translation/translation-runtime-config.js'

const translationRuntimeStatus = ref(
  normalizeTranslationRuntimeStatus(DEFAULT_TRANSLATION_RUNTIME_STATUS)
)

let listenerRegistered = false
let statusRefreshPromise = null
let edgeProbePromise = null


function applyRuntimeStatus(status = {}) {
  translationRuntimeStatus.value = normalizeTranslationRuntimeStatus(status)
  return translationRuntimeStatus.value
}

export async function refreshTranslationRuntimeStatus() {
  if (statusRefreshPromise) {
    return await statusRefreshPromise
  }

  statusRefreshPromise = ipcRenderer
    .invoke('translationRuntime:getStatus')
    .then((status) => applyRuntimeStatus(status))
    .catch((error) => {
      console.warn('[翻译运行时] 读取状态失败', error?.message || error)
      return translationRuntimeStatus.value
    })
    .finally(() => {
      statusRefreshPromise = null
    })

  return await statusRefreshPromise
}

export async function probeTranslationRuntimeStatus(payload = {}) {
  const status = await ipcRenderer.invoke(
    'translationRuntime:probe',
    JSON.parse(JSON.stringify(payload || {}))
  )
  return applyRuntimeStatus(status)
}

export async function ensureEdgeTranslationReady(payload = {}) {
  ensureTranslationRuntimeStatus()
  const reason = String(payload?.reason || 'auto_edge_translation').trim()
  let status = await refreshTranslationRuntimeStatus()

  if (isEdgeTranslationRuntimeAvailable(status)) {
    return true
  }

  const edgeStatus = String(status?.edge?.status || 'unknown')
    .trim()
    .toLowerCase()
  if (edgeStatus !== 'unknown' && edgeStatus !== 'checking') {
    return false
  }

  if (!edgeProbePromise) {
    edgeProbePromise = probeTranslationRuntimeStatus({
      ...payload,
      reason
    }).finally(() => {
      edgeProbePromise = null
    })
  }

  status = await edgeProbePromise
  return isEdgeTranslationRuntimeAvailable(status)
}

export function ensureTranslationRuntimeStatus() {
  if (listenerRegistered) {
    return
  }

  listenerRegistered = true
  ipcRenderer.on('translationRuntime:statusChanged', (_event, status = {}) => {
    applyRuntimeStatus(status)
  })
  void refreshTranslationRuntimeStatus()
}

export function isTranslationRuntimeAvailable(
  systemConfig = {},
  runtimeStatus = translationRuntimeStatus.value
) {
  ensureTranslationRuntimeStatus()
  return isTranslationRuntimeConfigAvailable(
    sanitizeUserSystemConfig(systemConfig),
    runtimeStatus
  )
}
