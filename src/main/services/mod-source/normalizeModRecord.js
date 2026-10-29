import {
  normalizeSourcePlatform,
  resolveSourcePlatformLabel
} from '../../../shared/sources/source-platform-registry.js'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeSource(value = '') {
  return normalizeSourcePlatform(value)
}

function pickFicsitVersion(record = {}) {
  const latestVersions =
    record?.latestVersions && typeof record.latestVersions === 'object' ? record.latestVersions : {}
  return pickFirstText(
    latestVersions?.release?.version,
    latestVersions?.beta?.version,
    latestVersions?.alpha?.version,
    record.version,
    record.modVersion
  )
}

function pickFicsitDownloadUrl(record = {}) {
  const latestVersions =
    record?.latestVersions && typeof record.latestVersions === 'object' ? record.latestVersions : {}
  return pickFirstText(
    record.downloadUrl,
    record.download_url,
    latestVersions?.release?.link,
    latestVersions?.beta?.link,
    latestVersions?.alpha?.link
  )
}

function pickThunderstoreVersion(record = {}) {
  const versions = Array.isArray(record?.versions) ? record.versions : []
  return pickFirstText(record.version, versions[0]?.version_number, versions[0]?.name)
}

function pickThunderstoreLatestVersion(record = {}) {
  const versions = Array.isArray(record?.versions) ? record.versions : []
  return versions[0] && typeof versions[0] === 'object' ? versions[0] : {}
}

function pickThunderstoreDownloadUrl(record = {}) {
  const latestVersion = pickThunderstoreLatestVersion(record)
  return pickFirstText(record.downloadUrl, record.download_url, latestVersion?.download_url)
}

function pickModioFile(record = {}) {
  if (record?.modfile && typeof record.modfile === 'object') {
    return record.modfile
  }
  if (record?.modFile && typeof record.modFile === 'object') {
    return record.modFile
  }
  if (record?.file && typeof record.file === 'object') {
    return record.file
  }
  return {}
}

function pickModioVersion(record = {}) {
  const file = pickModioFile(record)
  return pickFirstText(record.version, record.modVersion, file?.version)
}

function pickModioDownloadUrl(record = {}) {
  const file = pickModioFile(record)
  const download = file?.download && typeof file.download === 'object' ? file.download : {}
  return pickFirstText(
    record.downloadUrl,
    record.download_url,
    file?.downloadUrl,
    file?.download_url,
    download?.binary_url,
    download?.binaryUrl,
    download?.url,
    file?.binary_url
  )
}

function pickModioFileHash(record = {}) {
  const file = pickModioFile(record)
  const filehash = file?.filehash
  if (!filehash) {
    return ''
  }

  if (typeof filehash === 'string') {
    return filehash.trim()
  }

  if (typeof filehash === 'object') {
    return pickFirstText(filehash?.md5, filehash?.sha1, filehash?.sha256, filehash?.hash)
  }

  return ''
}

function pickModioFileSize(record = {}) {
  const file = pickModioFile(record)
  return toSafeNumber(record.fileSize ?? record.file_size ?? file?.filesize ?? file?.file_size, 0)
}

function pickModioPlatforms(record = {}) {
  const file = pickModioFile(record)
  return Array.isArray(file?.platforms) ? file.platforms : []
}

function resolveSourceLabel(source = '', fallback = '') {
  return resolveSourcePlatformLabel(source, fallback)
}

export function normalizeModRecord(record = {}, options = {}) {
  const source = normalizeSource(record.source || options.source)
  const id = pickFirstText(
    record.id,
    record.modId,
    record.mod_id,
    record.project_id,
    record.slug,
    record.mod_reference,
    record.full_name,
    record.packageName,
    record.package_name,
    record.name
  )
  const versions = Array.isArray(record?.versions) ? record.versions : []
  const latestVersion = versions[0] && typeof versions[0] === 'object' ? versions[0] : {}
  const files = Array.isArray(record?.files) ? record.files : []
  const primaryFile =
    record?.primaryFile && typeof record.primaryFile === 'object'
      ? record.primaryFile
      : record?.primary_file && typeof record.primary_file === 'object'
        ? record.primary_file
        : record?.selectedFile && typeof record.selectedFile === 'object'
          ? record.selectedFile
          : record?.selected_file && typeof record.selected_file === 'object'
            ? record.selected_file
            : files[0] && typeof files[0] === 'object'
              ? files[0]
              : null
  const latestDependencies = Array.isArray(latestVersion?.dependencies)
    ? latestVersion.dependencies
    : []
  const requiredDependencies = Array.isArray(record?.requiredMods)
    ? record.requiredMods
    : Array.isArray(record?.required_mods)
      ? record.required_mods
      : Array.isArray(record?.requires)
        ? record.requires
        : Array.isArray(record?.required)
          ? record.required
          : []
  const dependencyList = Array.isArray(record?.dependencies)
    ? record.dependencies
    : requiredDependencies.length
      ? requiredDependencies
      : latestDependencies
  const downloads = toSafeNumber(
    record.downloads ??
      record.follows ??
      record.download_count ??
      record.modDownloads ??
      record.mod_downloads ??
      record.stats?.downloads_total,
    0
  )
  const thunderstorePackageOwner =
    source === 'thunderstore' ? pickFirstText(record.packageOwner, record.owner, record.namespace) : ''
  const thunderstorePackageName =
    source === 'thunderstore' ? pickFirstText(record.packageName, record.name, id) : ''
  const thunderstoreFullNameFallback =
    source === 'thunderstore' && thunderstorePackageOwner && thunderstorePackageName
      ? `${thunderstorePackageOwner}-${thunderstorePackageName}`
      : ''
  const vamhubPackageName =
    source === 'vamhub'
      ? pickFirstText(record.packageName, record.package_name, record.modId, record.mod_id, id)
      : ''
  if (!id && !record.name) {
    return null
  }

  return {
    id: id || toSafeText(record.name),
    source,
    sourceLabel: resolveSourceLabel(source, record.sourceLabel || options.sourceLabel),
    modId: pickFirstText(record.modId, record.mod_id, record.project_id, record.mod_reference, id),
    modReference:
      source === 'ficsit'
        ? pickFirstText(record.modReference, record.mod_reference, record.modId, id)
        : '',
    fileId:
      source === 'modio'
        ? pickFirstText(record.fileId, record.file_id, pickModioFile(record)?.id)
        : pickFirstText(record.fileId, record.file_id, primaryFile?.fileId, primaryFile?.file_id),
    namespace: toSafeText(record.namespace),
    fullName:
      source === 'thunderstore'
        ? pickFirstText(
            record.fullName,
            record.full_name,
            record.packageFullName,
            thunderstoreFullNameFallback,
            id
          )
        : '',
    packageFullName:
      source === 'thunderstore'
        ? pickFirstText(
            record.packageFullName,
            record.full_name,
            record.fullName,
            thunderstoreFullNameFallback,
            id
          )
        : '',
    packageOwner: thunderstorePackageOwner,
    packageName: source === 'vamhub' ? vamhubPackageName : thunderstorePackageName,
    resourceId: pickFirstText(record.resourceId, record.resource_id),
    community: toSafeText(record.community || options.community),
    domainName: pickFirstText(record.domainName, record.domain_name, options.domainName),
    gameId: pickFirstText(record.gameId, record.game_id, options.gameId),
    name: pickFirstText(record.name, record.title, record.full_name, id),
    version:
      source === 'ficsit'
        ? pickFicsitVersion(record)
        : source === 'modio'
          ? pickModioVersion(record)
          : source === 'thunderstore'
            ? pickThunderstoreVersion(record)
            : pickFirstText(record.version, record.modVersion, primaryFile?.version),
    author: pickFirstText(
      record.author,
      record.owner,
      record.uploader?.name,
      record.submitted_by?.username
    ),
    updatedAt: pickFirstText(
      record.updatedAt,
      record.updated_at,
      record.updatedTime,
      record.updated_time,
      record.last_updated,
      record.date_modified,
      record.published,
      latestVersion?.date_created
    ),
    popularity: downloads
      ? String(downloads)
      : pickFirstText(record.popularity, record.downloadCount),
    summary: pickFirstText(
      record.summary,
      record.short_description,
      record.description,
      record.full_description,
      latestVersion?.description
    ),
    // 简介不能替代完整安装说明，AI 路径判断需要保留详情正文。
    description: pickFirstText(record.description, record.description_plaintext, record.full_description),
    installation: pickFirstText(record.installation, record.installInstructions, record.install_instructions),
    readme: pickFirstText(record.readme, record.readmeText, record.readme_text),
    pictureUrl: pickFirstText(
      record.pictureUrl,
      record.picture_url,
      record.thumbnailUrl,
      record.logo,
      record.icon,
      record.icon_url,
      record.image_url,
      record.imageUrl,
      record.featured_gallery,
      record.logo?.thumb_640x360,
      record.logo?.original,
      pickThunderstoreLatestVersion(record)?.icon,
      latestVersion?.icon
    ),
    downloadUrl:
      source === 'ficsit'
        ? pickFicsitDownloadUrl(record)
        : source === 'thunderstore'
          ? pickThunderstoreDownloadUrl(record)
          : source === 'modio'
            ? pickModioDownloadUrl(record)
            : pickFirstText(record.downloadUrl, record.download_url),
    profileUrl: pickFirstText(
      record.profileUrl,
      record.profile_url,
      record.package_url
    ),
    fileSize:
      source === 'modio'
        ? pickModioFileSize(record)
        : source === 'thunderstore'
          ? toSafeNumber(record.fileSize ?? pickThunderstoreLatestVersion(record)?.file_size, 0)
          : toSafeNumber(record.fileSize ?? record.file_size, 0),
    fileMd5:
      source === 'modio'
        ? pickModioFileHash(record)
        : pickFirstText(record.fileMd5, record.file_md5, record.md5),
    fileName: pickFirstText(
      record.fileName,
      record.file_name,
      primaryFile?.name,
      primaryFile?.file_name,
      primaryFile?.filename
    ),
    versionId: pickFirstText(record.versionId, record.version_id),
    versionType: pickFirstText(record.versionType, record.version_type),
    sha1: pickFirstText(record.sha1),
    sha512: pickFirstText(record.sha512),
    primaryFile,
    files,
    versions: Array.isArray(record?.versions) ? record.versions : [],
    gameVersions: [],
    loaders: [],
    platforms: source === 'modio' ? pickModioPlatforms(record) : [],
    dependencies: dependencyList,
    dependencyCount: toSafeNumber(record.dependencyCount, dependencyList.length),
    installStatus: toSafeText(record.installStatus || 'unknown'),
    installStatusText: toSafeText(record.installStatusText || '待预检'),
    canInstall: record.canInstall === true,
    previewOnly: record.previewOnly !== false
  }
}
