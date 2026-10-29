import { parentPort } from 'node:worker_threads'
import { scanGame } from './swapper/scan.js'
import { captureInstallation, checkRuntime } from './runtime-check.js'
import { observeRuntime } from './detection/observe.js'

parentPort.on('message', async ({ id, action, input }) => {
  try {
    const value =
      action === 'scan'
        ? await scanGame(typeof input === 'string' ? input : input.root, {
            captureCandidates: input.captureCandidates
          })
        : action === 'observe'
          ? await observeRuntime(input)
          : action === 'snapshot'
            ? captureInstallation(input)
            : action === 'check'
              ? await checkRuntime(input)
              : null
    parentPort.postMessage({ id, value })
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code } })
  }
})
