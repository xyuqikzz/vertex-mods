import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
import { matchGithubAssetNames } from './github-asset-matcher.js'
const axios = createMainHttp('github')

const GITHUB_API_BASE_URL = 'https://api.github.com'
const REQUEST_TIMEOUT = 60000

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function normalizeGithubReleaseAsset(asset = {}) {
  const target = asset && typeof asset === 'object' ? asset : {}
  return {
    id: toSafeNumber(target.id, 0),
    name: toSafeText(target.name),
    size: toSafeNumber(target.size, 0),
    contentType: toSafeText(target.content_type),
    downloadUrl: toSafeText(target.browser_download_url),
    updatedAt: toSafeText(target.updated_at),
    digest: toSafeText(target.digest)
  }
}

function buildGithubReleaseDownloadUrl({ owner = '', repo = '', tag = '', assetName = '' }) {
  const safeOwner = toSafeText(owner)
  const safeRepo = toSafeText(repo)
  const safeTag = toSafeText(tag)
  const safeAssetName = toSafeText(assetName)

  if (!safeOwner || !safeRepo || !safeTag || !safeAssetName) {
    return ''
  }

  return `https://github.com/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/releases/download/${encodeURIComponent(safeTag)}/${encodeURIComponent(safeAssetName)}`
}

export async function resolveGithubReleaseAsset(provider = {}) {
  const owner = toSafeText(provider.owner)
  const repo = toSafeText(provider.repo)
  const requestedTag = toSafeText(provider.tag)
  const useLatest = !requestedTag || requestedTag.toLowerCase() === 'latest'
  const tag = useLatest ? '' : requestedTag
  const assetName = toSafeText(provider.asset_name || provider.assetName)
  const assetNameRegex = toSafeText(provider.asset_name_regex || provider.assetNameRegex)
  const containsValue = provider.asset_name_contains ?? provider.assetNameContains
  const contains = (Array.isArray(containsValue) ? containsValue : [containsValue])
    .map((value) => toSafeText(value).toLowerCase())
    .filter(Boolean)
  const directDownloadUrl = toSafeText(
    provider.download_url || provider.downloadUrl || provider.browser_download_url
  )
  const githubToken = toSafeText(
    provider.github_token ||
      provider.githubToken ||
      provider.token
  )

  if (!owner || !repo) {
    throw new Error(uiText('ui.gitHubReleaseConfigurationMustIncludeOwnerAndRepo'))
  }

  // 明确固定 tag + 文件名的旧规则保留直链能力；latest 必须先解析真实版本，
  // 不能拼成 /download/latest，也不能复用规则里残留的旧版本直链。
  const constructedDownloadUrl = buildGithubReleaseDownloadUrl({
    owner,
    repo,
    tag,
    assetName
  })
  const preferredDownloadUrl = !useLatest && assetName
    ? directDownloadUrl || constructedDownloadUrl
    : ''
  if (preferredDownloadUrl) {
    return {
      owner,
      repo,
      tag,
      requestedTag,
      versionPolicy: 'pinned',
      releaseName: tag,
      asset: {
        id: 0,
        name: assetName,
        size: 0,
        contentType: '',
        downloadUrl: preferredDownloadUrl,
        updatedAt: '',
        digest: ''
      }
    }
  }

  const response = await axios({
    url: `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${useLatest ? 'latest' : `tags/${encodeURIComponent(tag)}`}`,
    method: 'GET',
    timeout: REQUEST_TIMEOUT,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Vertex',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {})
    }
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.gitHubReleaseQueryFailedWithHTTPStatusValue', { value1: (response?.status || 0) }))
  }

  const data = response?.data && typeof response.data === 'object' ? response.data : {}
  const resolvedTag = toSafeText(data.tag_name)
  if (!resolvedTag || data.draft === true || (useLatest && data.prerelease === true)) {
    throw new Error(uiText('ui.gitHubReleaseReturnedNoAvailableRelease'))
  }
  if (!useLatest && resolvedTag !== tag) {
    throw new Error(uiText('ui.gitHubReleaseReturnedAVersionThatDoesNotMatchTag', { value1: (tag) }))
  }
  const assets = Array.isArray(data.assets)
    ? data.assets
        .filter((item) => !item.state || item.state === 'uploaded')
        .map((item) => normalizeGithubReleaseAsset(item))
    : []
  const regexMatches = !assetName && assetNameRegex
    ? await matchGithubAssetNames(assetNameRegex, assets.map((item) => item.name))
    : null
  const matchedAssets = assets.filter((item, index) => {
    if (!item.downloadUrl) return false
    if (assetName) return item.name === assetName
    if (regexMatches) return regexMatches[index]
    return contains.every((token) => item.name.toLowerCase().includes(token))
  })

  if (!matchedAssets.length) {
    throw new Error(uiText('ui.noAssetsMatchedGitHubReleaseValueValue', { value1: (resolvedTag), value2: (assetName || assetNameRegex || contains.join(', ') || uiText('ui.noFilterSpecified')) }))
  }
  if (matchedAssets.length > 1) {
    throw new Error(uiText('ui.multipleAssetsMatchedGitHubReleaseValueNarrowTheFilenameFilter', { value1: (resolvedTag), value2: (matchedAssets.slice(0, 5).map((item) => item.name).join(', ')) }))
  }

  return {
    owner,
    repo,
    tag: resolvedTag,
    requestedTag,
    versionPolicy: useLatest ? 'latest' : 'pinned',
    releaseName: toSafeText(data.name || data.tag_name),
    asset: matchedAssets[0]
  }
}

export function buildGithubReleaseProviderSnapshot(resolved = {}) {
  const asset = resolved.asset || {}
  return {
    source: 'github_release',
    owner: resolved.owner,
    repo: resolved.repo,
    tag: resolved.tag,
    requestedTag: resolved.requestedTag,
    versionPolicy: resolved.versionPolicy,
    asset_id: asset.id,
    asset_name: asset.name,
    download_url: asset.downloadUrl,
    digest: asset.digest,
    resolvedAt: new Date().toISOString()
  }
}
