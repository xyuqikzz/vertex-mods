const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_CACHE_MAX_SIZE = 200

const DEFAULT_SOURCE_INTERVAL_MS = Object.freeze({
  nexus: 750,
  modio: 500,
  ficsit: 300,
  thunderstore: 300
})

const requestCache = new Map()
const inFlightRequests = new Map()
const sourceQueues = new Map()
const sourceAvailableAt = new Map()

let nowProvider = () => Date.now()
let sleepProvider = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeSourceKey(source = '') {
  return String(source || 'unknown')
    .trim()
    .toLowerCase()
}

function normalizeCacheKey(key = '') {
  return String(key || '').trim()
}

function cloneJson(value) {
  if (typeof value === 'undefined') {
    return undefined
  }
  return JSON.parse(JSON.stringify(value))
}

function stableStringify(value) {
  if (typeof value === 'undefined') {
    return 'undefined'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function trimCache(maxSize = DEFAULT_CACHE_MAX_SIZE) {
  const safeMaxSize = Math.max(1, Number(maxSize) || DEFAULT_CACHE_MAX_SIZE)
  while (requestCache.size > safeMaxSize) {
    const oldestKey = requestCache.keys().next().value
    requestCache.delete(oldestKey)
  }
}

function readCache(cacheKey = '', now = nowProvider()) {
  const key = normalizeCacheKey(cacheKey)
  if (!key) return { hit: false, value: null }

  const entry = requestCache.get(key)
  if (!entry) return { hit: false, value: null }
  if (entry.expiresAt <= now) {
    requestCache.delete(key)
    return { hit: false, value: null }
  }

  return { hit: true, value: cloneJson(entry.value) }
}

function writeCache(cacheKey = '', value, options = {}) {
  const key = normalizeCacheKey(cacheKey)
  if (!key) return

  const rawTtlMs = Number(options.ttlMs)
  const ttlMs = Math.max(0, Number.isFinite(rawTtlMs) ? rawTtlMs : DEFAULT_CACHE_TTL_MS)
  if (ttlMs <= 0) return

  requestCache.set(key, {
    value: cloneJson(value),
    expiresAt: nowProvider() + ttlMs
  })
  trimCache(options.maxSize)
}

async function waitForSourceSlot(source = '', minIntervalMs = null) {
  const sourceKey = normalizeSourceKey(source)
  const hasCustomInterval = minIntervalMs !== null && typeof minIntervalMs !== 'undefined'
  const rawIntervalMs = Number(minIntervalMs)
  const intervalMs = Math.max(
    0,
    hasCustomInterval && Number.isFinite(rawIntervalMs)
      ? rawIntervalMs
      : DEFAULT_SOURCE_INTERVAL_MS[sourceKey] || 0
  )
  if (intervalMs <= 0) return

  const previous = sourceQueues.get(sourceKey) || Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      const now = nowProvider()
      const availableAt = Number(sourceAvailableAt.get(sourceKey) || 0)
      const delayMs = Math.max(0, availableAt - now)
      if (delayMs > 0) {
        await sleepProvider(delayMs)
      }
      sourceAvailableAt.set(sourceKey, nowProvider() + intervalMs)
    })

  sourceQueues.set(sourceKey, next)
  await next
}

export function buildModSourceRequestCacheKey(source = '', action = '', payload = {}) {
  return `${normalizeSourceKey(source)}:${String(action || '').trim()}:${stableStringify(payload)}`
}

export async function runCachedModSourceRequest(options = {}, loader) {
  if (typeof loader !== 'function') {
    throw new Error('mod-source 请求缺少 loader')
  }

  const source = normalizeSourceKey(options.source)
  const cacheKey = normalizeCacheKey(options.cacheKey)
  const cacheable = options.cacheable !== false && Boolean(cacheKey)
  if (cacheable) {
    const cached = readCache(cacheKey)
    if (cached.hit) {
      return cached.value
    }

    const inFlight = inFlightRequests.get(cacheKey)
    if (inFlight) {
      return cloneJson(await inFlight)
    }
  }

  const requestPromise = (async () => {
    await waitForSourceSlot(source, options.minIntervalMs)
    const result = await loader()
    if (cacheable) {
      writeCache(cacheKey, result, {
        ttlMs: options.ttlMs,
        maxSize: options.maxSize
      })
    }
    return result
  })()

  if (cacheable) {
    inFlightRequests.set(cacheKey, requestPromise)
  }

  try {
    return await requestPromise
  } finally {
    if (cacheable) {
      inFlightRequests.delete(cacheKey)
    }
  }
}

export function __resetModSourceRequestCoordinatorForTest(options = {}) {
  requestCache.clear()
  inFlightRequests.clear()
  sourceQueues.clear()
  sourceAvailableAt.clear()
  nowProvider = typeof options.now === 'function' ? options.now : () => Date.now()
  sleepProvider =
    typeof options.sleep === 'function'
      ? options.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}
