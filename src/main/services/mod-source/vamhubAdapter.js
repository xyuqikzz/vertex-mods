function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential|xf_[a-z0-9_]+/i
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization|auth.?header|session|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const SENSITIVE_URL_PARAM_PATTERN =
  /^(api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization|auth|session|signature|key|expires|xf_[a-z0-9_]+)$/i

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function sanitizeSensitiveText(value = '') {
  return toSafeText(value).replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeSensitiveUrl(value = '') {
  const text = sanitizeSensitiveText(value)
  if (!/^https?:\/\//i.test(text)) return text
  try {
    const url = new URL(text)
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }
    return url.toString()
  } catch {
    return text
  }
}

function sanitizeVamHubRawValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeVamHubRawValue(item)).filter((item) => item !== undefined)
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeSensitiveUrl(value) : value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeVamHubRawValue(entryValue, entryKey)
    if (sanitized !== undefined) {
      result[entryKey] = sanitized
    }
  }
  return result
}

export function resolveVamHubPackageIdentifier(payload = {}) {
  return pickFirstText(
    payload?.packageName,
    payload?.package_name,
    payload?.modId,
    payload?.mod_id,
    payload?.resourceId,
    payload?.resource_id,
    payload?.id,
    payload?.context?.mod?.packageName,
    payload?.context?.mod?.resourceId,
    payload?.context?.mod?.modId
  )
}

function normalizeVamHubFileName(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  return text.toLowerCase().endsWith('.var') ? text : `${text}.var`
}

function parseVamHubFileSize(value = '') {
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

function normalizeVamHubFileRecord(file = {}) {
  const fileName = normalizeVamHubFileName(file.filename || file.fileName || file.name)
  const downloadUrl = sanitizeSensitiveUrl(
    pickFirstText(file.downloadUrl, file.download_url, file.urlHosted)
  )
  return {
    ...sanitizeVamHubRawValue(toPlainJson(file, {})),
    id: pickFirstText(file.id, file.fileId, fileName, downloadUrl),
    fileId: pickFirstText(file.fileId, file.file_id, file.id, fileName, downloadUrl),
    fileName,
    file_name: fileName,
    name: fileName,
    fileSize: toSafeNumber(file.file_size_bytes, parseVamHubFileSize(file.file_size)),
    file_size: toSafeNumber(file.file_size_bytes, parseVamHubFileSize(file.file_size)),
    downloadUrl,
    download_url: downloadUrl,
    version: pickFirstText(file.version, file.version_string),
    licenseType: pickFirstText(file.licenseType, file.license_type)
  }
}

function flattenVamHubDependencies(dependencies = {}) {
  if (Array.isArray(dependencies)) {
    return dependencies.map((item) => sanitizeVamHubRawValue(item)).filter(Boolean)
  }
  if (!dependencies || typeof dependencies !== 'object') {
    return []
  }
  return Object.entries(dependencies).flatMap(([key, value]) => {
    const list = Array.isArray(value) ? value : value ? [value] : []
    return list.map((item) => ({
      ...sanitizeVamHubRawValue(toPlainJson(item, {})),
      dependencyType: pickFirstText(item?.dependencyType, item?.dependency_type, key)
    }))
  })
}

export function normalizeVamHubRecord(record = {}) {
  const files = (Array.isArray(record?.hubFiles)
    ? record.hubFiles
    : Array.isArray(record?.files)
      ? record.files
      : []
  ).map((file) => normalizeVamHubFileRecord(file))
  const primaryFile = files.find((file) => file.downloadUrl) || files[0] || null
  const resourceId = pickFirstText(record.resourceId, record.resource_id, record.id)
  const packageName = pickFirstText(
    record.packageName,
    record.package_name,
    primaryFile?.fileName?.replace(/\.var$/i, ''),
    record.title,
    resourceId
  )
  const dependencies = flattenVamHubDependencies(record.dependencies)

  return {
    ...sanitizeVamHubRawValue(toPlainJson(record, {})),
    source: 'vamhub',
    id: packageName || resourceId,
    modId: packageName || resourceId,
    resourceId,
    resource_id: resourceId,
    packageName,
    package_name: packageName,
    name: pickFirstText(record.name, record.title, packageName, resourceId),
    title: pickFirstText(record.title, record.name, packageName, resourceId),
    summary: pickFirstText(record.summary, record.tag_line, record.tagLine),
    version: pickFirstText(record.version, record.version_string, record.versionString),
    author: pickFirstText(record.author, record.username, record.userName),
    pictureUrl: sanitizeSensitiveUrl(
      pickFirstText(record.pictureUrl, record.image_url, record.imageUrl, record.icon_url)
    ),
    downloads: toSafeNumber(record.downloads ?? record.download_count ?? record.downloadCount, 0),
    updatedAt: pickFirstText(record.updatedAt, record.last_update, record.lastUpdate),
    fileId: primaryFile?.fileId || '',
    fileName: primaryFile?.fileName || '',
    fileSize: primaryFile?.fileSize || 0,
    downloadUrl: primaryFile?.downloadUrl || '',
    primaryFile,
    files,
    dependencies,
    dependencyCount: toSafeNumber(
      record.dependencyCount ?? record.dependency_count,
      dependencies.length
    ),
    profileUrl: resourceId
      ? `https://hub.virtamate.com/resources/${encodeURIComponent(resourceId)}/`
      : ''
  }
}
