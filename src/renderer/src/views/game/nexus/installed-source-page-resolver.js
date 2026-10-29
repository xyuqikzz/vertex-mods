function toSafeText(value) {
  return String(value ?? '').trim()
}

function readFirstText(source = {}, keys = []) {
  for (const key of keys) {
    const value = toSafeText(source?.[key])
    if (value) return value
  }
  return ''
}

function normalizeHttpUrl(value = '') {
  const text = toSafeText(value)
  if (!text) return ''

  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function buildGithubReleasePage(provider = {}) {
  const owner = readFirstText(provider, ['owner', 'repo_owner', 'repoOwner'])
  const repo = readFirstText(provider, ['repo', 'repository', 'repo_name', 'repoName'])
  const tag = readFirstText(provider, ['tag', 'tag_name', 'tagName', 'version'])
  if (!owner || !repo) return ''

  const repositoryUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  return tag ? `${repositoryUrl}/releases/tag/${encodeURIComponent(tag)}` : `${repositoryUrl}/releases`
}

function normalizeGithubReleasePage(value = '') {
  const safeUrl = normalizeHttpUrl(value)
  if (!safeUrl) return ''

  try {
    const url = new URL(safeUrl)
    if (url.hostname.toLowerCase() !== 'github.com') return safeUrl

    const parts = url.pathname.split('/').filter(Boolean)
    const [owner, repo, section, action, tag] = parts
    if (!owner || !repo) return safeUrl
    if (section === 'releases' && action === 'download' && tag) {
      return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(tag)}`
    }
    if (section === 'releases' && action === 'tag' && tag) {
      return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(tag)}`
    }
    return safeUrl
  } catch {
    return ''
  }
}

function resolveDefaultDependencySourcePage(metadata = {}, downloadUrl = '') {
  if (metadata?.resolvedProvider?.source === 'github_release') {
    const resolvedPage = buildGithubReleasePage(metadata.resolvedProvider)
    if (resolvedPage) return resolvedPage
  }
  const provider =
    metadata?.provider && typeof metadata.provider === 'object' && !Array.isArray(metadata.provider)
      ? metadata.provider
      : {}
  const githubReleasePage = buildGithubReleasePage(provider)
  if (githubReleasePage) return githubReleasePage

  const providerPageUrl = readFirstText(provider, [
    'release_url',
    'releaseUrl',
    'page_url',
    'pageUrl',
    'source_url',
    'sourceUrl',
    'url'
  ])
  if (providerPageUrl) {
    const normalizedProviderPageUrl = normalizeGithubReleasePage(providerPageUrl)
    if (normalizedProviderPageUrl) return normalizedProviderPageUrl
  }

  const providerDownloadUrl = readFirstText(provider, ['download_url', 'downloadUrl'])
  return normalizeGithubReleasePage(providerDownloadUrl || downloadUrl)
}

export function resolveInstalledNexusSourcePageUrl(input = {}) {
  const metadata =
    input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {}
  const isDefaultDependency =
    input?.isDefaultDependency === true || toSafeText(metadata?.category) === 'default_dependency'

  if (isDefaultDependency) {
    const dependencyUrl = resolveDefaultDependencySourcePage(metadata, input?.downloadUrl)
    if (dependencyUrl) return dependencyUrl
  }

  const domainName = toSafeText(input?.domainName)
  const modId = toSafeText(input?.modId)
  if (domainName && modId) {
    return `https://www.nexusmods.com/${encodeURIComponent(domainName)}/mods/${encodeURIComponent(modId)}`
  }

  return normalizeHttpUrl(input?.downloadUrl)
}
