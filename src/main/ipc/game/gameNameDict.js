import axios from 'axios'
import { app } from 'electron'
import {
  applyGameNameDictSnapshot,
  finishGameNameDictSnapshot,
  getLocalGameNameDictCursor,
  getLocalGameNameDictSnapshotVersion,
  isLocalGameNameDictSnapshotReady,
  resetLocalGameNameDict,
  resolveGameNameDictBatch,
  resolveGameNameDictSearchNameBatch,
  setLocalGameNameDictSnapshotVersion,
  setLocalGameNameDictVersion
} from '../../db/games/gameNameDict.js'

const { VITE_REQUEST_API, VITE_APP_VERSION } = import.meta.env
const DEFAULT_SYNC_LIMIT = 1000
const MAX_SNAPSHOT_ROUNDS = 10000

let syncPromise = null
let lastSyncState = {
  status: 'idle',
  reason: '',
  message: '',
  serverChangeId: 0,
  localChangeId: 0,
  versionNo: '',
  snapshotVersion: '',
  changedCount: 0,
  updatedAt: ''
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value) {
  return String(value ?? '').trim()
}

function updateSyncState(patch = {}) {
  lastSyncState = {
    ...lastSyncState,
    ...patch,
    updatedAt: new Date().toISOString()
  }
  return lastSyncState
}

function summarizeGameNameDictResponse(path, data = {}) {
  if (path.includes('/manifest')) {
    return {
      serverChangeId: toSafeNumber(data?.serverChangeId, 0),
      versionNo: toSafeText(data?.versionNo),
      snapshotVersion: toSafeText(data?.snapshotVersion),
      fullSnapshotRequired: Boolean(data?.fullSnapshotRequired),
      recommendedLimit: toSafeNumber(data?.recommendedLimit, DEFAULT_SYNC_LIMIT)
    }
  }

  if (path.includes('/snapshot')) {
    return {
      serverChangeId: toSafeNumber(data?.serverChangeId, 0),
      nextAliasId: toSafeNumber(data?.nextAliasId, 0),
      hasMore: Boolean(data?.hasMore),
      recordCount: Array.isArray(data?.records) ? data.records.length : 0
    }
  }

  return null
}

async function requestGameNameDict(path, options = {}) {
  const baseURL = toSafeText(VITE_REQUEST_API)
  if (!baseURL) {
    throw new Error('未配置后端接口地址')
  }

  const method = options.method || 'GET'
  const startedAt = Date.now()
  console.log('[游戏名称字典] 请求后端接口', {
    method,
    url: `${baseURL}${path}`,
    params: options.params || null,
    hasBody: Boolean(options.data)
  })

  let response
  try {
    response = await axios.request({
      baseURL,
      url: path,
      method,
      params: options.params,
      data: options.data,
      timeout: options.timeout || 30000,
      headers: {
        'vertex-version': toSafeText(VITE_APP_VERSION) || app.getVersion() || '0.0.0',
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.warn('[游戏名称字典] 后端接口请求异常', {
      method,
      path,
      status: error?.response?.status || 0,
      response: error?.response?.data || null,
      message: toSafeText(error?.message),
      durationMs: Date.now() - startedAt
    })
    throw error
  }

  const result = response?.data || {}
  if (Number(result.code) !== 200) {
    console.warn('[游戏名称字典] 后端接口返回失败', {
      method,
      path,
      code: result.code,
      message: toSafeText(result.message),
      durationMs: Date.now() - startedAt
    })
    throw new Error(toSafeText(result.message) || '游戏名称字典同步失败')
  }
  console.log('[游戏名称字典] 后端接口调用成功', {
    method,
    path,
    durationMs: Date.now() - startedAt,
    data: summarizeGameNameDictResponse(path, result.data)
  })
  return result.data
}

async function loadManifest(localChangeId = 0) {
  return await requestGameNameDict('/game-name-dict/manifest', {
    params: {
      clientChangeId: Math.max(toSafeNumber(localChangeId, 0), 0)
    }
  })
}

async function runSnapshotSync(manifest = {}) {
  resetLocalGameNameDict()

  let afterId = 0
  let rounds = 0
  const limit = Math.max(toSafeNumber(manifest.recommendedLimit, DEFAULT_SYNC_LIMIT), 1)
  const serverChangeId = Math.max(toSafeNumber(manifest.serverChangeId, 0), 0)
  const versionNo = toSafeText(manifest.versionNo)
  const snapshotVersion = toSafeText(manifest.snapshotVersion)
  let changedCount = 0

  while (rounds < MAX_SNAPSHOT_ROUNDS) {
    rounds += 1
    const page = await requestGameNameDict('/game-name-dict/snapshot', {
      params: {
        afterId,
        limit
      },
      timeout: 60000
    })

    const records = Array.isArray(page?.records) ? page.records : []
    changedCount += applyGameNameDictSnapshot(records)
    afterId = Math.max(toSafeNumber(page?.nextAliasId, afterId), afterId)

    if (!page?.hasMore) {
      finishGameNameDictSnapshot(serverChangeId, versionNo, snapshotVersion)
      console.log('[游戏名称字典] 快照同步写入完成', {
        changedCount,
        serverChangeId,
        snapshotVersion
      })
      return {
        serverChangeId,
        localChangeId: serverChangeId,
        versionNo,
        snapshotVersion,
        changedCount,
        mode: 'snapshot'
      }
    }
  }

  throw new Error('游戏名称字典快照分页次数异常')
}

export async function syncGameNameDictOnce(options = {}) {
  if (syncPromise) {
    return await syncPromise
  }

  syncPromise = (async () => {
    const reason = toSafeText(options.reason) || 'manual'
    updateSyncState({
      status: 'syncing',
      reason,
      message: '开始同步游戏名称字典'
    })

    try {
      const localChangeId = getLocalGameNameDictCursor()
      const localSnapshotVersion = getLocalGameNameDictSnapshotVersion()
      const manifest = await loadManifest(localChangeId)
      const serverChangeId = Math.max(toSafeNumber(manifest?.serverChangeId, 0), 0)
      const versionNo = toSafeText(manifest?.versionNo)
      const snapshotVersion = toSafeText(manifest?.snapshotVersion)
      const snapshotChanged = Boolean(snapshotVersion && snapshotVersion !== localSnapshotVersion)

      let result
      if (!isLocalGameNameDictSnapshotReady() || manifest?.fullSnapshotRequired || snapshotChanged) {
        result = await runSnapshotSync(manifest)
      } else {
        result = {
          serverChangeId,
          localChangeId,
          versionNo,
          snapshotVersion,
          changedCount: 0,
          mode: 'skip'
        }
        if (versionNo) {
          setLocalGameNameDictVersion(versionNo)
        }
        if (snapshotVersion) {
          setLocalGameNameDictSnapshotVersion(snapshotVersion)
        }
      }

      const nextState = updateSyncState({
        status: 'success',
        reason,
        message: '游戏名称字典同步完成',
        ...result
      })
      console.log('[游戏名称字典] 同步完成', {
        reason,
        mode: result?.mode || '',
        changedCount: toSafeNumber(result?.changedCount, 0),
        serverChangeId: toSafeNumber(result?.serverChangeId, 0),
        localChangeId: toSafeNumber(result?.localChangeId, 0),
        snapshotVersion: toSafeText(result?.snapshotVersion)
      })
      return nextState
    } catch (error) {
      return updateSyncState({
        status: 'failed',
        reason,
        message: toSafeText(error?.message) || '游戏名称字典同步失败',
        localChangeId: getLocalGameNameDictCursor()
      })
    } finally {
      syncPromise = null
    }
  })()

  return await syncPromise
}

export function getGameNameDictSyncState() {
  return {
    ...lastSyncState,
    localChangeId: getLocalGameNameDictCursor()
  }
}

export function resolveGameNameDictLocalBatch(payload = {}) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : []
  return resolveGameNameDictBatch(items)
}

export function resolveGameNameDictSearchNameLocalBatch(payload = {}) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : []
  return resolveGameNameDictSearchNameBatch(items)
}
