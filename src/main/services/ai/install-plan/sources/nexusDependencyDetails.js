// Nexus 默认依赖的身份、文件与摘要。
import {
  toSafeText,
  toSafeNumber,
  isPlainObject,
  pickFirstText,
  normalizeTextKey,
  toPlainJson
} from '../values.js'

function parseNexusDependencyProviderUrl(rawUrl = '') {
  const text = toSafeText(rawUrl)
  if (!text) {
    return {
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }

  try {
    const url = new URL(text)
    const pathMatch = url.pathname.match(/^\/([^/]+)\/mods\/(\d+)/i)
    return {
      domainName: toSafeText(pathMatch?.[1]),
      modId: toSafeNumber(pathMatch?.[2], 0),
      fileId: toSafeNumber(url.searchParams.get('file_id') || url.searchParams.get('fileId'), 0)
    }
  } catch {
    return {
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }
}

function resolveNexusDefaultDependencyProvider(dependency = {}, options = {}) {
  const provider = isPlainObject(dependency?.provider) ? dependency.provider : {}
  const parsedUrl = parseNexusDependencyProviderUrl(provider.url)
  return {
    domainName: pickFirstText(
      provider.domain_name,
      provider.domainName,
      provider.game_domain,
      provider.gameDomain,
      dependency.domainName,
      dependency.sourceGameDomain,
      parsedUrl.domainName,
      options.domainName
    ),
    modId: toSafeNumber(
      pickFirstText(
        provider.mod_id,
        provider.modId,
        dependency.modId,
        dependency.sourceModId,
        parsedUrl.modId
      ),
      0
    ),
    fileId: toSafeNumber(
      pickFirstText(
        provider.file_id,
        provider.fileId,
        dependency.fileId,
        dependency.sourceFileId,
        parsedUrl.fileId
      ),
      0
    )
  }
}

function resolveNexusDefaultDependencySource(dependency = {}) {
  return toSafeText(
    dependency?.source || dependency?.sourceType || dependency?.provider?.source
  ).toLowerCase()
}

function resolveNexusDefaultDependencyDownloadUrl(dependency = {}) {
  const provider = isPlainObject(dependency?.provider) ? dependency.provider : {}
  const asset = isPlainObject(dependency?.asset) ? dependency.asset : {}
  const file = isPlainObject(dependency?.file) ? dependency.file : {}
  const source = resolveNexusDefaultDependencySource(dependency)
  return pickFirstText(
    dependency.downloadUrl,
    dependency.download_url,
    dependency.urlHosted,
    provider.downloadUrl,
    provider.download_url,
    asset.downloadUrl,
    asset.download_url,
    file.downloadUrl,
    file.download_url,
    ['url', 'direct_url', 'direct'].includes(source) ? provider.url || dependency.url : ''
  )
}

function resolveNexusDefaultDependencyVersion(dependency = {}) {
  const provider = isPlainObject(dependency?.provider) ? dependency.provider : {}
  const asset = isPlainObject(dependency?.asset) ? dependency.asset : {}
  return pickFirstText(
    dependency.version,
    dependency.modVersion,
    dependency.versionNumber,
    provider.tag,
    provider.asset_name,
    provider.assetName,
    asset.name
  )
}

function resolveNexusDefaultDependencyFileSize(dependency = {}) {
  const asset = isPlainObject(dependency?.asset) ? dependency.asset : {}
  const file = isPlainObject(dependency?.file) ? dependency.file : {}
  return toSafeNumber(
    pickFirstText(
      dependency.fileSize,
      dependency.file_size,
      providerSafeNumber(dependency?.provider, 'fileSize'),
      providerSafeNumber(dependency?.provider, 'file_size'),
      asset.size,
      file.size
    ),
    0
  )
}

function providerSafeNumber(provider = {}, key = '') {
  return isPlainObject(provider) ? provider[key] : ''
}

function buildNexusDefaultDependencySourceModKey(dependency = {}, index = 0, options = {}) {
  const source = resolveNexusDefaultDependencySource(dependency)
  const provider = resolveNexusDefaultDependencyProvider(dependency, options)
  const dependencyId = pickFirstText(dependency.id, dependency.name, `default-${index + 1}`)

  if (source === 'nexus_file' && provider.modId > 0 && provider.fileId > 0) {
    return `dependency:nexus:${provider.modId}:${provider.fileId}`
  }

  if (source === 'github_release') {
    return `dependency:${normalizeTextKey(dependencyId)}`
  }

  const downloadUrl = resolveNexusDefaultDependencyDownloadUrl(dependency)
  return `dependency:${normalizeTextKey(source || 'default')}:${normalizeTextKey(
    dependencyId || downloadUrl || String(index + 1)
  )}`
}

export function normalizeNexusDefaultDependencyItem(dependency = {}, index = 0, options = {}) {
  const source = resolveNexusDefaultDependencySource(dependency)
  const provider = resolveNexusDefaultDependencyProvider(dependency, options)
  const sourceModKey = buildNexusDefaultDependencySourceModKey(dependency, index, options)
  const dependencyId = pickFirstText(dependency.id, sourceModKey, `default-${index + 1}`)
  const name = pickFirstText(dependency.name, dependency.displayName, dependencyId)
  const version = resolveNexusDefaultDependencyVersion(dependency)
  const downloadUrl = resolveNexusDefaultDependencyDownloadUrl(dependency)
  const fileId =
    source === 'nexus_file' && provider.fileId > 0
      ? String(provider.fileId)
      : pickFirstText(dependency.fileId, dependency.sourceFileId, version, dependencyId)
  const modId =
    source === 'nexus_file' && provider.modId > 0
      ? String(provider.modId)
      : pickFirstText(dependency.modId, dependency.sourceModId, dependencyId)

  return {
    ...toPlainJson(dependency, {}),
    source: 'nexus',
    sourceType: 'nexus',
    sourcePlatform: 'nexus',
    category: 'default_dependency',
    dependencyRole: 'default_dependency',
    isDefaultDependency: true,
    dependencySource: source,
    dependencyId,
    sourceModKey,
    modId,
    id: fileId || dependencyId,
    fileId,
    sourceModId: modId,
    sourceFileId: fileId,
    name,
    modName: name,
    fileName: pickFirstText(dependency.fileName, dependency.file_name, name),
    description: toSafeText(dependency.description || dependency.summary || dependency.notes),
    summary: toSafeText(dependency.summary || dependency.description || dependency.notes),
    version,
    fileSize: resolveNexusDefaultDependencyFileSize(dependency),
    downloadUrl,
    installRule: isPlainObject(dependency.install) ? dependency.install : {},
    required: dependency.required !== false,
    blocking: dependency.blocking === true,
    provider
  }
}

export function buildNexusDefaultDependencySummary(planItem = {}, missingFields = []) {
  return {
    id: pickFirstText(planItem.dependencyId, planItem.id, planItem.sourceModKey),
    name: pickFirstText(planItem.name, planItem.modName, planItem.dependencyId, '默认依赖'),
    source: 'nexus',
    sourceType: toSafeText(planItem.dependencySource || 'default_dependency'),
    sourceModKey: toSafeText(planItem.sourceModKey),
    version: toSafeText(planItem.version),
    installState: missingFields.length ? 'missing' : 'pending',
    required: planItem.required !== false,
    blocking: planItem.blocking === true,
    dependencyRole: 'default_dependency',
    isDefaultDependency: true,
    missingFields,
    reason: missingFields.length ? `默认依赖缺少${missingFields.join('、')}` : ''
  }
}

export function buildNexusDefaultDependencyReference(planItem = {}) {
  return {
    source: 'nexus',
    sourceType: toSafeText(planItem.dependencySource || 'default_dependency'),
    sourcePlatform: 'nexus',
    sourceModKey: toSafeText(planItem.sourceModKey),
    dependencyRole: 'default_dependency',
    isDefaultDependency: true,
    required: planItem.required !== false,
    blocking: planItem.blocking === true,
    name: pickFirstText(planItem.name, planItem.modName, planItem.dependencyId, '默认依赖'),
    modId: pickFirstText(planItem.modId, planItem.sourceModId),
    fileId: pickFirstText(planItem.fileId, planItem.sourceFileId),
    version: toSafeText(planItem.version)
  }
}
