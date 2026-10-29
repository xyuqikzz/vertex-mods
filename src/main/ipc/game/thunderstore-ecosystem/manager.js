import {
  THUNDERSTORE_ECOSYSTEM_BASE_SHA256,
  THUNDERSTORE_ECOSYSTEM_MERGE_POLICY,
  THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION,
  createEmptyEcosystemOverlay,
  hashEcosystemJson,
  mergeThunderstoreEcosystem,
  validateBackendOverlayEnvelope,
  validateEcosystemData
} from './merge.js'

const DEFAULT_UPSTREAM_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_BACKEND_TTL_MS = 10 * 60 * 1000

function toTimestamp(value = '') {
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function toIsoString(now) {
  return new Date(now()).toISOString()
}

function isFresh(record, ttlMs, now) {
  return !!record && now() - toTimestamp(record.fetchedAt) < ttlMs
}

function createEmptyBackendEnvelope() {
  const overlay = createEmptyEcosystemOverlay()
  return {
    revision: 0,
    targetSchemaVersion: THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION,
    baseSha256: THUNDERSTORE_ECOSYSTEM_BASE_SHA256,
    mergePolicy: THUNDERSTORE_ECOSYSTEM_MERGE_POLICY,
    contentHash: hashEcosystemJson(overlay),
    publishedAt: '',
    overlay
  }
}

function normalizeCachedUpstream(record = {}) {
  const validation = validateEcosystemData(record?.data)
  if (!validation.valid) {
    return null
  }
  return {
    etag: String(record?.etag || ''),
    sha256: validation.hash,
    fetchedAt: String(record?.fetchedAt || record?.updatedAt || ''),
    data: validation.data
  }
}

function normalizeCachedBackend(record = {}) {
  const validation = validateBackendOverlayEnvelope(record?.envelope || record)
  if (!validation.valid) {
    return null
  }
  return {
    etag: String(record?.etag || ''),
    fetchedAt: String(record?.fetchedAt || record?.updatedAt || ''),
    envelope: validation.envelope
  }
}

function normalizeCacheRecord(record = {}) {
  if (Number(record?.cacheVersion) === 2) {
    return {
      upstream: normalizeCachedUpstream(record.upstream),
      backend: normalizeCachedBackend(record.backend)
    }
  }

  // 兼容旧版 { date, updatedAt, data } GitHub 快照缓存。
  const legacyUpstream = normalizeCachedUpstream({
    data: record?.data,
    fetchedAt: record?.updatedAt || record?.date
  })
  return {
    upstream: legacyUpstream,
    backend: null
  }
}

export function createThunderstoreEcosystemManager(options = {}) {
  const bundledAdapter = options.bundledAdapter
  const upstreamAdapter = options.upstreamAdapter
  const backendAdapter = options.backendAdapter
  const cacheAdapter = options.cacheAdapter
  const onUpdated = typeof options.onUpdated === 'function' ? options.onUpdated : () => {}
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const upstreamTtlMs = Number(options.upstreamTtlMs || DEFAULT_UPSTREAM_TTL_MS)
  const backendTtlMs = Number(options.backendTtlMs || DEFAULT_BACKEND_TTL_MS)

  let initialized = false
  let bundledData = null
  let sourceState = {
    upstream: null,
    backend: null
  }
  let currentSnapshot = null
  let refreshPromise = null
  let lastErrors = []

  function buildSnapshot(reason = 'load') {
    const upstreamData = sourceState.upstream?.data || bundledData
    const backendEnvelope = sourceState.backend?.envelope || createEmptyBackendEnvelope()
    const merged = mergeThunderstoreEcosystem(upstreamData, backendEnvelope.overlay)
    const refreshedAt = toIsoString(now)
    currentSnapshot = {
      data: merged.data,
      metadata: {
        schemaVersion: merged.data.schemaVersion,
        effectiveHash: merged.hash,
        upstreamHash:
          sourceState.upstream?.sha256 ||
          hashEcosystemJson(validateEcosystemData(bundledData).data),
        upstreamSource: sourceState.upstream ? 'github-cache' : 'bundled',
        upstreamFetchedAt: String(sourceState.upstream?.fetchedAt || ''),
        backendRevision: Number(backendEnvelope.revision || 0),
        backendHash: String(backendEnvelope.contentHash || ''),
        backendFetchedAt: String(sourceState.backend?.fetchedAt || ''),
        mergePolicy: THUNDERSTORE_ECOSYSTEM_MERGE_POLICY,
        conflicts: merged.conflicts,
        refreshedAt,
        reason,
        errors: [...lastErrors],
        stale:
          !isFresh(sourceState.upstream, upstreamTtlMs, now) ||
          !isFresh(sourceState.backend, backendTtlMs, now)
      }
    }
    return currentSnapshot
  }

  async function initialize() {
    if (initialized) {
      return currentSnapshot
    }
    if (!bundledAdapter?.read || !cacheAdapter?.read) {
      throw new Error('Thunderstore ecosystem Adapter 未完整配置')
    }

    const bundledValidation = validateEcosystemData(await bundledAdapter.read())
    if (!bundledValidation.valid) {
      const error = new Error(`内置 ecosystem 无效：${bundledValidation.errors.join('；')}`)
      error.code = 'ecosystem_bundled_invalid'
      throw error
    }
    bundledData = bundledValidation.data

    try {
      sourceState = normalizeCacheRecord((await cacheAdapter.read()) || {})
    } catch (error) {
      lastErrors = [`读取 ecosystem 缓存失败：${error?.message || '未知错误'}`]
      sourceState = { upstream: null, backend: null }
    }

    initialized = true
    return buildSnapshot('initialize')
  }

  async function writeCache() {
    if (!cacheAdapter?.write) {
      return
    }
    await cacheAdapter.write({
      cacheVersion: 2,
      updatedAt: toIsoString(now),
      upstream: sourceState.upstream,
      backend: sourceState.backend,
      effective: {
        sha256: currentSnapshot?.metadata?.effectiveHash || '',
        mergedAt: currentSnapshot?.metadata?.refreshedAt || '',
        data: currentSnapshot?.data || null
      },
      conflicts: currentSnapshot?.metadata?.conflicts || []
    })
  }

  async function refresh() {
    await initialize()
    if (refreshPromise) {
      return await refreshPromise
    }

    refreshPromise = (async () => {
      const previousHash = currentSnapshot?.metadata?.effectiveHash || ''
      const fetchedAt = toIsoString(now)
      const errors = []
      const [upstreamResult, backendResult] = await Promise.allSettled([
        upstreamAdapter?.fetch?.({ etag: sourceState.upstream?.etag || '' }),
        backendAdapter?.fetch?.({ etag: sourceState.backend?.etag || '' })
      ])

      if (upstreamResult.status === 'fulfilled' && upstreamResult.value) {
        const result = upstreamResult.value
        if (result.status === 'not_modified' && sourceState.upstream) {
          sourceState.upstream = { ...sourceState.upstream, fetchedAt }
        } else if (result.status === 'ok') {
          const validation = validateEcosystemData(result.data)
          if (validation.valid) {
            sourceState.upstream = {
              etag: String(result.etag || ''),
              sha256: validation.hash,
              fetchedAt,
              data: validation.data
            }
          } else {
            errors.push(`GitHub ecosystem 校验失败：${validation.errors.join('；')}`)
          }
        }
      } else if (upstreamResult.status === 'rejected') {
        errors.push(`GitHub ecosystem 更新失败：${upstreamResult.reason?.message || '未知错误'}`)
      }

      if (backendResult.status === 'fulfilled' && backendResult.value) {
        const result = backendResult.value
        if (result.status === 'not_modified' && sourceState.backend) {
          sourceState.backend = { ...sourceState.backend, fetchedAt }
        } else if (result.status === 'ok') {
          const validation = validateBackendOverlayEnvelope(result.envelope)
          if (validation.valid) {
            sourceState.backend = {
              etag: String(result.etag || ''),
              fetchedAt,
              envelope: validation.envelope
            }
          } else {
            errors.push(`Vertex Overlay 校验失败：${validation.errors.join('；')}`)
          }
        }
      } else if (backendResult.status === 'rejected') {
        errors.push(`Vertex Overlay 更新失败：${backendResult.reason?.message || '未知错误'}`)
      }

      lastErrors = errors
      const snapshot = buildSnapshot('refresh')
      try {
        await writeCache()
      } catch (error) {
        lastErrors = [...errors, `写入 ecosystem 缓存失败：${error?.message || '未知错误'}`]
        snapshot.metadata.errors = [...lastErrors]
      }

      if (snapshot.metadata.effectiveHash !== previousHash) {
        onUpdated(snapshot)
      }
      return snapshot
    })().finally(() => {
      refreshPromise = null
    })

    return await refreshPromise
  }

  async function load(loadOptions = {}) {
    await initialize()
    if (loadOptions.forceRefresh === true) {
      return await refresh()
    }

    const shouldRefresh =
      !isFresh(sourceState.upstream, upstreamTtlMs, now) ||
      !isFresh(sourceState.backend, backendTtlMs, now)
    if (shouldRefresh) {
      refresh().catch(() => {})
    }
    return currentSnapshot
  }

  function getStatus() {
    return (
      currentSnapshot?.metadata || {
        schemaVersion: THUNDERSTORE_ECOSYSTEM_SCHEMA_VERSION,
        effectiveHash: '',
        upstreamHash: '',
        upstreamSource: 'uninitialized',
        upstreamFetchedAt: '',
        backendRevision: 0,
        backendHash: '',
        backendFetchedAt: '',
        mergePolicy: THUNDERSTORE_ECOSYSTEM_MERGE_POLICY,
        conflicts: [],
        refreshedAt: '',
        reason: 'uninitialized',
        errors: [],
        stale: true
      }
    )
  }

  return {
    load,
    refresh,
    getStatus
  }
}
