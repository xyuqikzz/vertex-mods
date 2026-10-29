export const APP_REPOSITORY_URL = 'https://github.com/xyuqikzz/vertex-mods'
export const GITHUB_UPDATE_PROVIDER = Object.freeze({
  provider: 'github', owner: 'xyuqikzz', repo: 'vertex-mods', private: false
})
export const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`
export const APP_RELEASES_URL = `${APP_REPOSITORY_URL}/releases`
export const APP_LATEST_RELEASE_API =
  'https://api.github.com/repos/xyuqikzz/vertex-mods/releases/latest'

export function parseAppVersion(value) {
  if (typeof value !== 'string' || value.length > 200) return null
  const match = value
    .trim()
    .match(
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/i
    )
  if (!match) return null
  const prerelease = match[4]?.split('.') || []
  if (prerelease.some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) return null
  return { version: value.trim().replace(/^v/i, ''), core: match.slice(1, 4), prerelease }
}

function compareNumeric(a, b) {
  return BigInt(a) > BigInt(b) ? 1 : BigInt(a) < BigInt(b) ? -1 : 0
}

export function compareAppVersions(left, right) {
  const a = parseAppVersion(left)
  const b = parseAppVersion(right)
  if (!a || !b) throw new Error('invalid_app_version')
  for (let i = 0; i < 3; i++) {
    const order = compareNumeric(a.core[i], b.core[i])
    if (order) return order
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return compareNumeric(x, y)
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function getAppReleaseUrl(tag) {
  return parseAppVersion(tag)
    ? `${APP_RELEASES_URL}/tag/${encodeURIComponent(tag.trim())}`
    : APP_RELEASES_URL
}

export function hasGithubUpdateAssets(release) {
  const parsed = parseAppVersion(release?.tag_name)
  if (!parsed || parsed.prerelease.length || release.draft || release.prerelease) return false
  const prefix = `${APP_REPOSITORY_URL}/releases/download/${encodeURIComponent(release.tag_name.trim())}/`
  const assets = Array.isArray(release.assets) ? release.assets : []
  return [`vertex-${parsed.version}-setup.exe`, 'latest.yml'].every((name) => {
    const matches = assets.filter((asset) => asset?.name === name)
    if (matches.length !== 1) return false
    const asset = matches[0]
    return asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0 &&
      asset.size <= (name === 'latest.yml' ? 1024 * 1024 : 1024 * 1024 * 1024) &&
      asset.browser_download_url === prefix + encodeURIComponent(name)
  })
}
