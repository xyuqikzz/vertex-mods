import { releaseConfig } from '../../shared/app/release-config.js'
import { APP_RELEASES_URL, parseAppVersion } from '../../shared/app/app-release.js'
export const UPDATE_FEED = releaseConfig.updateFeed

export function assertUpdateUrl(value, updateFeed = UPDATE_FEED) {
  if (!updateFeed) throw new Error('updates_disabled')
  const url = new URL(value, updateFeed)
  const feed = new URL(updateFeed)
  if (url.protocol !== 'https:' || url.origin !== feed.origin || !url.pathname.startsWith(feed.pathname) ||
      url.username || url.password || url.hash || url.search || [...String(value)].some(char => char.charCodeAt(0) <= 32 || char === '\\')) throw new Error('untrusted_update_source')
  return url.href
}

export function assertUpdateMetadata(info, updateFeed = UPDATE_FEED) {
  if (!info || !Array.isArray(info.files) || !info.files.length) throw new Error('missing_update_metadata')
  for (const file of info.files) {
    assertUpdateUrl(file.url, updateFeed)
    if (typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw new Error('missing_update_digest')
  }
}

export function assertMatchingSignatures(current, update) {
  if (current?.status !== 'Valid' || !current?.subject) throw new Error('current_app_signature_unavailable')
  if (update?.status !== 'Valid' || update?.subject !== current.subject) throw new Error('untrusted_update_signature')
}

export function assertGithubUpdateMetadata(info, release) {
  const version = parseAppVersion(release?.tag)
  if (!version || version.prerelease.length || release.canDownload !== true ||
      info?.version !== version.version || info?.tag !== release.tag || info?.files?.length !== 1 || info.packages) {
    throw new Error('untrusted_update_metadata')
  }
  const feed = `${APP_RELEASES_URL}/download/${encodeURIComponent(release.tag)}/`
  assertUpdateMetadata(info, feed)
  if (info.files[0].url !== `vertex-${version.version}-setup.exe`) {
    throw new Error('untrusted_update_metadata')
  }
}
