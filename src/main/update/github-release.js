import axios from 'axios'
import {
  APP_LATEST_RELEASE_API,
  compareAppVersions,
  parseAppVersion,
  hasGithubUpdateAssets
} from '../../shared/app/app-release.js'

// Share an in-flight check across startup and manual requests. Failures remain retryable.
export function createGithubReleaseChecker({ currentVersion, request = axios.get }) {
  let pending = null
  async function check() {
    const version = currentVersion()
    const result = { currentVersion: version, source: 'github' }
    try {
      if (!parseAppVersion(version)) throw new Error('invalid_current_version')
      const response = await request(APP_LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vertex-Update-Check' },
        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        validateStatus: () => true
      })
      if (response.status === 404) {
        return {
          ...result,
          success: false,
          status: 'unavailable',
          messageKey: 'updates.errors.unavailable'
        }
      }
      if ([403, 429].includes(response.status)) {
        return {
          ...result,
          success: false,
          status: 'error',
          messageKey: 'updates.errors.rate_limited'
        }
      }
      if (response.status !== 200) throw new Error('release_request_failed')
      const data = response.data
      if (!data || typeof data !== 'object') throw new Error('invalid_release')
      const parsed = parseAppVersion(data.tag_name)
      if (!parsed) throw new Error('invalid_release_version')
      if (data.draft || data.prerelease || parsed.prerelease.length) {
        return {
          ...result,
          success: false,
          status: 'unavailable',
          messageKey: 'updates.errors.unavailable'
        }
      }
      const available = compareAppVersions(parsed.version, version) > 0
      const canDownload = hasGithubUpdateAssets(data)
      return {
        ...result,
        success: true,
        status: available ? 'available' : 'current',
        messageKey: available ? (canDownload ? 'updates.available' : 'updates.manualOnly') : 'updates.current',
        release: {
          source: 'github',
          canDownload,
          version: parsed.version,
          tag: data.tag_name.trim(),
          releaseNotes: typeof data.body === 'string' ? data.body.slice(0, 100000) : '',
          publishTime:
            typeof data.published_at === 'string' && Number.isFinite(Date.parse(data.published_at))
              ? data.published_at
              : ''
        }
      }
    } catch (error) {
      const knownErrors = ['invalid_current_version', 'invalid_release_version', 'invalid_release']
      return {
        ...result,
        success: false,
        status: 'error',
        messageKey: `updates.errors.${knownErrors.includes(error.message) ? error.message : 'check_failed'}`
      }
    }
  }
  return () => {
    if (!pending)
      pending = check().finally(() => {
        pending = null
      })
    return pending
  }
}
