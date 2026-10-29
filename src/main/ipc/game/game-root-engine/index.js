import { createGameRootDetectionEngine } from './detectionEngine.js'
import { defaultGameRootEnvironmentAdapter } from './defaultEnvironmentAdapter.js'

const defaultGameRootDetectionEngine = createGameRootDetectionEngine(
  defaultGameRootEnvironmentAdapter
)

export async function detectGameRoot(payload = {}) {
  return await defaultGameRootDetectionEngine.detectGameRoot(payload)
}

export async function detectGameRootFromDirectory(payload = {}) {
  return await defaultGameRootDetectionEngine.detectGameRootFromDirectory(payload)
}

export { resolveKnownGameRoot } from './ruleKernel.js'
