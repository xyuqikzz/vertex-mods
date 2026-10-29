export const DEFAULT_DOWNLOAD_CONCURRENT_COUNT = 1
export const MAX_DOWNLOAD_CONCURRENT_COUNT = 5
export const DOWNLOAD_ENGINE_ARIA2 = 'aria2'
export const DOWNLOAD_ENGINE_BROWSER = 'browser'
export const DEFAULT_DOWNLOAD_ENGINE = DOWNLOAD_ENGINE_ARIA2
export const DOWNLOAD_ENGINE_OPTIONS = Object.freeze([
  { label: 'aria2 下载引擎', value: DOWNLOAD_ENGINE_ARIA2 },
  { label: '浏览器下载引擎', value: DOWNLOAD_ENGINE_BROWSER }
])

export function normalizeDownloadConcurrentCount(value) {
  const target = Math.floor(Number(value || 0))
  if (!Number.isFinite(target) || target <= 0) {
    return DEFAULT_DOWNLOAD_CONCURRENT_COUNT
  }
  return Math.min(MAX_DOWNLOAD_CONCURRENT_COUNT, target)
}

export function normalizeDownloadEngine(value) {
  const target = String(value || '')
    .trim()
    .toLowerCase()
  return DOWNLOAD_ENGINE_OPTIONS.some((item) => item.value === target)
    ? target
    : DEFAULT_DOWNLOAD_ENGINE
}
