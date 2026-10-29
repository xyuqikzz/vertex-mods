import store from '../storage/store/index.js'
import { STATISTICS_SETTING } from '../../shared/app/statistics-policy.js'

const activeRequests = new Set()
export const statisticsEnabled = () => store.get(STATISTICS_SETTING) === true
store.onDidChange(STATISTICS_SETTING, (enabled) => {
  if (enabled !== true) for (const controller of activeRequests) controller.abort()
})

export async function withStatisticsConsent(send, signal) {
  if (!statisticsEnabled()) return null
  const controller = new AbortController()
  activeRequests.add(controller)
  try {
    return await send(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal)
  } finally {
    activeRequests.delete(controller)
  }
}
