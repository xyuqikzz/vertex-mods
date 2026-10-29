import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
let activeWorkers = 0

export function matchGithubAssetNames(pattern, names) {
  if (typeof pattern !== 'string' || pattern.length > 512 || !Array.isArray(names) ||
      names.length > 1000 || names.some((name) => typeof name !== 'string' || name.length > 4096) ||
      names.reduce((total, name) => total + name.length, 0) > 256 * 1024) {
    return Promise.reject(new Error(uiText('ui.gitHubReleaseFilenameMatchingExceededItsSafetyBudget')))
  }
  if (activeWorkers >= 4) return Promise.reject(new Error(uiText('ui.gitHubReleaseFilenameMatchingIsBusyTryAgainLater')))
  activeWorkers++
  return new Promise((resolve, reject) => {
    let worker
    let timer
    let finished = false
    const finish = (error, matches) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      worker?.terminate()
      activeWorkers--
      if (error) reject(error)
      else resolve(matches)
    }
    try {
      worker = new Worker(new URL('./github-asset-match.worker.js', import.meta.url), { type: 'module' })
      timer = setTimeout(() => finish(new Error(uiText('ui.gitHubReleaseRegularExpressionMatchingTimedOutSimplifyAssetName'))), 2000)
      worker.onmessage = ({ data }) => {
        if (data?.error) return finish(new Error(data.error))
        if (!Array.isArray(data?.matches) || data.matches.length !== names.length || data.matches.some((item) => typeof item !== 'boolean')) {
          return finish(new Error(uiText('ui.gitHubReleaseFilenameMatchingReturnedAnInvalidResult')))
        }
        finish(null, data.matches)
      }
      worker.onerror = () => finish(new Error(uiText('ui.gitHubReleaseFilenameMatchingFailed')))
      worker.postMessage({ pattern, names })
    } catch {
      finish(new Error(uiText('ui.couldNotStartGitHubReleaseFilenameMatching')))
    }
  })
}
