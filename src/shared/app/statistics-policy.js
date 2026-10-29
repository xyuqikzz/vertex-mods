export const STATISTICS_SETTING = 'systemConfig.settings.statisticsEnabled'
export const isStatisticsEndpoint = (url) => {
  try {
    return new URL(url).pathname.endsWith('/api/statistics/events/batch')
  } catch {
    return false
  }
}
