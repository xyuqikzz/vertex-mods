// 来源文件名、大小与版本解析。
import { pickFirstText, toSafeText } from './values.js'

export function resolveNexusVersion(planItem = {}) {
  const files = Array.isArray(planItem?.files) ? planItem.files : []
  return pickFirstText(
    planItem?.version,
    planItem?.modVersion,
    planItem?.mod_version,
    planItem?.fileVersion,
    planItem?.file_version,
    planItem?.versionNumber,
    planItem?.version_number,
    planItem?.selectedFile?.version,
    planItem?.selected_file?.version,
    planItem?.file?.version,
    planItem?.latestFile?.version,
    planItem?.latest_file?.version,
    files[0]?.version
  )
}

export function resolveModioVersion(planItem = {}) {
  const file =
    planItem?.modfile && typeof planItem.modfile === 'object'
      ? planItem.modfile
      : planItem?.modFile && typeof planItem.modFile === 'object'
        ? planItem.modFile
        : planItem?.file && typeof planItem.file === 'object'
          ? planItem.file
          : {}
  return pickFirstText(
    planItem?.version,
    planItem?.modVersion,
    planItem?.mod_version,
    planItem?.versionNumber,
    planItem?.version_number,
    file?.version,
    file?.versionNumber,
    file?.version_number
  )
}

export function resolveFicsitVersion(planItem = {}) {
  const latestVersions =
    planItem?.latestVersions && typeof planItem.latestVersions === 'object'
      ? planItem.latestVersions
      : planItem?.latest_versions && typeof planItem.latest_versions === 'object'
        ? planItem.latest_versions
        : {}
  const versions = Array.isArray(planItem?.versions) ? planItem.versions : []
  return pickFirstText(
    planItem?.version,
    planItem?.modVersion,
    planItem?.mod_version,
    planItem?.versionNumber,
    planItem?.version_number,
    planItem?.latestVersion?.version,
    planItem?.latest_version?.version,
    latestVersions?.release?.version,
    latestVersions?.beta?.version,
    latestVersions?.alpha?.version,
    versions[0]?.version,
    versions[0]?.version_number,
    planItem?.versionId
  )
}

function normalizeVamHubFileName(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

export function parseVamHubPackage(value = '', fallbackVersion = 1) {
  const base = toSafeText(value).replace(/\.var$/i, '')
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 2) {
    return {
      creator: '',
      name: base,
      version: Number(fallbackVersion || 1),
      sourceModKey: base,
      id: base
    }
  }

  const creator = parts[0]
  const last = parts[parts.length - 1]
  const hasVersion = /^\d+$/.test(last) || last.toLowerCase() === 'latest'
  const version = /^\d+$/.test(last) ? Number(last) : Number(fallbackVersion || 1)
  const name = (hasVersion ? parts.slice(1, -1) : parts.slice(1)).join('.')
  const sourceModKey = [creator, name || parts.slice(1).join('.')].filter(Boolean).join('.')
  return {
    creator,
    name: name || parts.slice(1).join('.'),
    version: version || 1,
    sourceModKey,
    id: [sourceModKey, version || 1].filter(Boolean).join('.')
  }
}

export function parseVamHubFileSize(value = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = toSafeText(value)
  if (!text) return 0
  const number = Number(text.replace(/,/g, '').match(/[\d.]+/)?.[0] || 0)
  if (!Number.isFinite(number)) return 0
  const lower = text.toLowerCase()
  if (lower.includes('gb')) return Math.round(number * 1024 * 1024 * 1024)
  if (lower.includes('mb')) return Math.round(number * 1024 * 1024)
  if (lower.includes('kb')) return Math.round(number * 1024)
  return Math.round(number)
}

export function resolveVamHubFileName(planItem = {}) {
  return normalizeVamHubFileName(
    pickFirstText(
      planItem?.fileName,
      planItem?.file_name,
      planItem?.filename,
      planItem?.selectedFile?.fileName,
      planItem?.selectedFile?.filename,
      planItem?.selected_file?.fileName,
      planItem?.selected_file?.filename,
      planItem?.primaryFile?.fileName,
      planItem?.primaryFile?.filename,
      planItem?.primary_file?.fileName,
      planItem?.primary_file?.filename,
      planItem?.packageName,
      planItem?.package_name,
      planItem?.modId,
      planItem?.id
    )
  )
}

function resolveVamHubVersion(planItem = {}) {
  const fileName = resolveVamHubFileName(planItem)
  const parsed = parseVamHubPackage(fileName || planItem?.packageName || planItem?.id)
  return pickFirstText(
    planItem?.version,
    planItem?.version_string,
    planItem?.versionString,
    planItem?.selectedFile?.version,
    planItem?.primaryFile?.version,
    parsed.version
  )
}

export function resolvePlanItemVersion(source = '', planItem = {}) {
  const normalizedSource = toSafeText(source).toLowerCase()
  if (normalizedSource === 'nexus') {
    return resolveNexusVersion(planItem)
  }
  if (normalizedSource === 'modio') {
    return resolveModioVersion(planItem)
  }
  if (normalizedSource === 'ficsit') {
    return resolveFicsitVersion(planItem)
  }
  if (normalizedSource === 'thunderstore') {
    return resolveThunderstoreVersion(planItem)
  }
  if (normalizedSource === 'vamhub') {
    return resolveVamHubVersion(planItem)
  }
  return pickFirstText(planItem?.version, planItem?.modVersion, planItem?.version_number)
}

function normalizeThunderstoreVersionText(value = '') {
  const version = toSafeText(value)
  return version && version.toLowerCase() !== 'latest' ? version : ''
}

function resolveThunderstoreDownloadUrlVersion(value = '') {
  const text = toSafeText(value)
  if (!text) return ''

  const normalized = text
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  const downloadIndex = parts.findIndex((part) => part.toLowerCase() === 'download')
  if (downloadIndex >= 0 && parts.length > downloadIndex + 3) {
    return normalizeThunderstoreVersionText(parts[downloadIndex + 3])
  }

  return ''
}

export function resolveThunderstoreDownloadUrl(planItem = {}) {
  const versions = Array.isArray(planItem?.versions) ? planItem.versions : []
  return pickFirstText(
    planItem?.downloadUrl,
    planItem?.download_url,
    planItem?.latestVersion?.download_url,
    planItem?.latestVersion?.downloadUrl,
    planItem?.latest_version?.download_url,
    planItem?.latest_version?.downloadUrl,
    planItem?.latest?.download_url,
    planItem?.latest?.downloadUrl,
    versions[0]?.download_url,
    versions[0]?.downloadUrl
  )
}

export function resolveThunderstoreVersion(planItem = {}) {
  const versions = Array.isArray(planItem?.versions) ? planItem.versions : []
  return (
    normalizeThunderstoreVersionText(
      pickFirstText(
        planItem?.version,
        planItem?.versionNumber,
        planItem?.version_number,
        planItem?.modVersion,
        planItem?.latestVersion?.version_number,
        planItem?.latestVersion?.version,
        planItem?.latestVersion?.name,
        planItem?.latest_version?.version_number,
        planItem?.latest_version?.version,
        planItem?.latest?.version_number,
        planItem?.latest?.version,
        versions[0]?.version_number,
        versions[0]?.version,
        versions[0]?.name
      )
    ) || resolveThunderstoreDownloadUrlVersion(resolveThunderstoreDownloadUrl(planItem))
  )
}
