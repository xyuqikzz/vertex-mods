import { computed, onBeforeUnmount, ref, unref, watch } from 'vue'

import {
  normalizeAiPageContextPatch,
  refreshAiPageContextCapabilities
} from '../../../shared/ai/conversation/ai-agent-page-context.js'

const overrideVersion = ref(0)
const overrideMap = new Map()

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function resolveRouteKey(routeLike = {}) {
  const route = unref(routeLike) || {}
  const name = toSafeText(route.name)
  const path = toSafeText(name === 'GameSiteDetail' ? route.fullPath || route.path : route.path || route.fullPath)
  return [name, path].filter(Boolean).join('::')
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergePlainContext(baseValue, overrideValue) {
  if (typeof overrideValue === 'undefined') {
    return toPlainJson(baseValue, baseValue)
  }
  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
    return toPlainJson(overrideValue, overrideValue)
  }

  const result = { ...baseValue }
  Object.entries(overrideValue).forEach(([key, value]) => {
    result[key] = mergePlainContext(result[key], value)
  })
  return result
}

function normalizeOverride(override = {}) {
  return normalizeAiPageContextPatch(override, { allowRoute: false })
}

export function mergeAiPageContextOverride(baseContext = {}, override = {}) {
  return refreshAiPageContextCapabilities(
    toPlainJson(mergePlainContext(baseContext, normalizeOverride(override)), {})
  )
}

export function getAiPageContextOverride(routeLike = {}) {
  const key = resolveRouteKey(routeLike)
  return key ? toPlainJson(overrideMap.get(key), {}) : {}
}

export function setAiPageContextOverride(routeLike = {}, override = {}) {
  const key = resolveRouteKey(routeLike)
  if (!key) return false

  const nextOverride = toPlainJson(normalizeOverride(override), {})
  const previousOverride = overrideMap.get(key)
  if (JSON.stringify(previousOverride || {}) === JSON.stringify(nextOverride || {})) {
    return false
  }

  overrideMap.set(key, nextOverride)
  overrideVersion.value += 1
  return true
}

function clearAiPageContextOverrideByKey(key = '') {
  const safeKey = toSafeText(key)
  if (!safeKey || !overrideMap.has(safeKey)) return false

  overrideMap.delete(safeKey)
  overrideVersion.value += 1
  return true
}

export function createAiPageContextProvider(routeLike = {}) {
  return {
    update(override = {}) {
      return setAiPageContextOverride(routeLike, override)
    },
    clear() {
      return clearAiPageContextOverride(routeLike)
    },
    snapshot() {
      return getAiPageContextOverride(routeLike)
    }
  }
}

export function useAiPageContextProvider(routeLike = {}) {
  const provider = createAiPageContextProvider(routeLike)
  let activeRouteKey = resolveRouteKey(routeLike)
  const stopWatchRouteKey = watch(
    () => resolveRouteKey(routeLike),
    (nextKey, previousKey) => {
      if (previousKey && previousKey !== nextKey) {
        clearAiPageContextOverrideByKey(previousKey)
      }
      activeRouteKey = nextKey
    }
  )

  onBeforeUnmount(() => {
    clearAiPageContextOverrideByKey(activeRouteKey || resolveRouteKey(routeLike))
    stopWatchRouteKey()
  })
  return provider
}

export function clearAiPageContextOverride(routeLike = {}) {
  const key = resolveRouteKey(routeLike)
  return clearAiPageContextOverrideByKey(key)
}

export function useAiPageContextOverride(routeLike = {}) {
  return computed(() => {
    overrideVersion.value
    const key = resolveRouteKey(routeLike)
    return toPlainJson(overrideMap.get(key), {})
  })
}
