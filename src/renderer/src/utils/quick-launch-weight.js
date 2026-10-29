import storage from '@renderer/common/storage.js'

const WEIGHT_KEY = 'quick_launch_weights'

export function getQuickLaunchWeights() {
  return storage.local.get(WEIGHT_KEY) || {}
}

export function increaseQuickLaunchWeight(gameId) {
  if (!gameId) return
  const weights = getQuickLaunchWeights()
  weights[gameId] = Number(weights[gameId] || 0) + 1
  storage.local.set(WEIGHT_KEY, weights)
}
