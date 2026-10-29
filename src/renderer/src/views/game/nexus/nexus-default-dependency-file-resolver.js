import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { NEXUS_MOD_FILE_CATEGORY_ID } from '../../../../../shared/sources/nexus-file-category.js'

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value = '') {
  return String(value || '').trim()
}

function toUpperText(value = '') {
  return toSafeText(value).toUpperCase()
}

function toLowerText(value = '') {
  return toSafeText(value).toLowerCase()
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value === 1
  }
  const text = toLowerText(value)
  if (['true', '1', 'yes', 'y'].includes(text)) {
    return true
  }
  if (['false', '0', 'no', 'n'].includes(text)) {
    return false
  }
  return defaultValue
}

export function readProviderAlias(source = {}, names = []) {
  const safeSource = source && typeof source === 'object' ? source : {}
  for (const name of names) {
    const value = safeSource?.[name]
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

export function resolveNexusDefaultDependencyProvider(provider = {}, payload = {}) {
  const source = provider && typeof provider === 'object' ? provider : {}
  const domainName = toSafeText(
    readProviderAlias(source, [
      'game_domain',
      'game_domain_name',
      'domain_name',
      'domainName',
      'gameDomain',
      'gameDomainName'
    ]) ||
      payload.gameBaseInfo?.domainName ||
      ''
  )

  return {
    domainName,
    modId: toSafeNumber(
      readProviderAlias(source, ['mod_id', 'modId', 'nexus_mod_id', 'nexusModId', 'id']),
      0
    ),
    fileId: toSafeNumber(
      readProviderAlias(source, ['file_id', 'fileId', 'nexus_file_id', 'nexusFileId']),
      0
    ),
    category: toSafeText(readProviderAlias(source, ['category', 'file_category', 'fileCategory'])),
    fileName: toSafeText(readProviderAlias(source, ['file_name', 'fileName', 'filename'])),
    fileNameRegex: toSafeText(
      readProviderAlias(source, ['file_name_regex', 'fileNameRegex', 'name_regex', 'nameRegex'])
    ),
    fileNameContains: readProviderAlias(source, [
      'file_name_contains',
      'fileNameContains',
      'name_contains',
      'nameContains'
    ]),
    preferLatest: toBoolean(readProviderAlias(source, ['prefer_latest', 'preferLatest']), false),
    allowArchived: toBoolean(readProviderAlias(source, ['allow_archived', 'allowArchived']), false),
    allowOldFiles: toBoolean(
      readProviderAlias(source, ['allow_old_files', 'allowOldFiles']),
      false
    ),
    strict: toBoolean(readProviderAlias(source, ['strict']), true),
    rawProvider: source
  }
}

export function validateNexusDefaultDependencyProviderIdentity(provider = {}, dependencyName = '') {
  const displayName = toSafeText(dependencyName) || '未知项'
  if (!toSafeText(provider?.domainName)) {
    throw new Error(uiText('ui.defaultDependencyValueHasNoNexusGameDomainCannotResolve', { value1: (displayName) }))
  }
  if (toSafeNumber(provider?.modId, 0) <= 0) {
    throw new Error(uiText('ui.defaultDependencyValueHasNoValidModIdCannotResolve', { value1: (displayName) }))
  }
}

export function normalizeNexusDefaultDependencyFileList(fileResponse = {}) {
  if (Array.isArray(fileResponse)) {
    return fileResponse
  }
  if (Array.isArray(fileResponse?.files)) {
    return fileResponse.files
  }
  return []
}

export function getNexusDependencyFileId(file = {}) {
  return toSafeNumber(file?.file_id || file?.fileId || file?.id, 0)
}

export function getNexusDependencyFileName(file = {}) {
  return toSafeText(file?.name || file?.file_name || file?.fileName)
}

function getNexusDependencyFileCategoryId(file = {}) {
  return toSafeNumber(file?.category_id || file?.categoryId, 0)
}

export function getNexusDependencyFileCategoryName(file = {}) {
  const categoryName = toUpperText(file?.category_name || file?.categoryName || file?.category)
  const categoryId = getNexusDependencyFileCategoryId(file)

  if (categoryName) {
    return categoryName
  }
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MAIN) return 'MAIN'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.UPDATE) return 'UPDATE'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OPTIONAL) return 'OPTIONAL'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION) return 'OLD_VERSION'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MISCELLANEOUS) return 'MISCELLANEOUS'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.DELETED) return 'DELETED'
  if (categoryId === NEXUS_MOD_FILE_CATEGORY_ID.ARCHIVED) return 'ARCHIVED'
  return ''
}

function getNexusDependencyFileStateText(file = {}) {
  return [
    file?.status,
    file?.state,
    file?.file_status,
    file?.fileStatus,
    file?.category_name,
    file?.categoryName,
    file?.category
  ]
    .map((item) => toUpperText(item))
    .filter(Boolean)
    .join(' ')
}

export function getNexusDependencyFileUploadedScore(file = {}) {
  const directScore = toSafeNumber(
    file?.uploaded_timestamp || file?.uploadedTimestamp || file?.date_uploaded_timestamp,
    0
  )
  if (directScore > 0) {
    return directScore
  }

  const rawTime = toSafeText(
    file?.uploaded_time || file?.uploadedTime || file?.date_uploaded || file?.dateUploaded
  )
  if (rawTime) {
    const parsedTime = Date.parse(rawTime)
    if (Number.isFinite(parsedTime)) {
      return parsedTime
    }
  }

  return getNexusDependencyFileId(file)
}

export function getNexusDependencyFileSize(file = {}) {
  const directSize = toSafeNumber(file?.size || file?.file_size || file?.fileSize, 0)
  if (directSize > 0) {
    return directSize
  }
  const sizeKb = toSafeNumber(file?.size_kb || file?.sizeKb, 0)
  return sizeKb > 0 ? sizeKb * 1024 : 0
}

export function matchNexusDependencyFileCategory(file = {}, category = '') {
  const wanted = toUpperText(category)
  if (!wanted) return true

  const categoryName = getNexusDependencyFileCategoryName(file)
  const categoryId = getNexusDependencyFileCategoryId(file)

  if (wanted === 'MAIN')
    return categoryName === 'MAIN' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MAIN
  if (wanted === 'UPDATE') {
    return categoryName === 'UPDATE' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.UPDATE
  }
  if (wanted === 'OPTIONAL') {
    return categoryName === 'OPTIONAL' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OPTIONAL
  }
  if (wanted === 'OLD' || wanted === 'OLD_VERSION') {
    return (
      categoryName === 'OLD_VERSION' ||
      categoryName === 'OLD' ||
      categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION
    )
  }
  if (wanted === 'MISC' || wanted === 'MISCELLANEOUS') {
    return (
      categoryName === 'MISCELLANEOUS' ||
      categoryName === 'MISC' ||
      categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MISCELLANEOUS
    )
  }
  if (wanted === 'ARCHIVED') {
    return categoryName === 'ARCHIVED' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.ARCHIVED
  }
  if (wanted === 'DELETED') {
    return categoryName === 'DELETED' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.DELETED
  }

  return categoryName === wanted
}

function normalizeContainsTokens(value) {
  const rawTokens = Array.isArray(value) ? value : [value]
  return rawTokens
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => toLowerText(item))
    .filter(Boolean)
}

export function matchNexusDependencyFileName(file = {}, provider = {}) {
  const fileName = getNexusDependencyFileName(file)
  const normalizedFileName = toLowerText(fileName)
  if (!normalizedFileName) {
    return false
  }

  if (provider.fileName) {
    return normalizedFileName === toLowerText(provider.fileName)
  }

  if (provider.fileNameRegex) {
    let matcher = null
    try {
      matcher = new RegExp(provider.fileNameRegex, 'i')
    } catch {
      throw new Error(uiText('ui.invalidDefaultDependencyFilenamePatternValue', { value1: (provider.fileNameRegex) }))
    }
    return matcher.test(fileName)
  }

  const containsTokens = normalizeContainsTokens(provider.fileNameContains)
  if (containsTokens.length) {
    return containsTokens.every((token) => normalizedFileName.includes(token))
  }

  return true
}

function isDeletedNexusDependencyFile(file = {}) {
  const categoryName = getNexusDependencyFileCategoryName(file)
  const categoryId = getNexusDependencyFileCategoryId(file)
  const stateText = getNexusDependencyFileStateText(file)
  return (
    categoryName === 'DELETED' ||
    categoryId === NEXUS_MOD_FILE_CATEGORY_ID.DELETED ||
    file?.deleted === true ||
    file?.is_deleted === true ||
    file?.isDeleted === true ||
    stateText.includes('DELETED')
  )
}

function isArchivedNexusDependencyFile(file = {}) {
  const categoryName = getNexusDependencyFileCategoryName(file)
  const categoryId = getNexusDependencyFileCategoryId(file)
  const stateText = getNexusDependencyFileStateText(file)
  return (
    categoryName === 'ARCHIVED' ||
    categoryId === NEXUS_MOD_FILE_CATEGORY_ID.ARCHIVED ||
    file?.archived === true ||
    file?.is_archived === true ||
    file?.isArchived === true ||
    stateText.includes('ARCHIVED')
  )
}

function isHiddenNexusDependencyFile(file = {}) {
  const stateText = getNexusDependencyFileStateText(file)
  return (
    file?.hidden === true ||
    file?.is_hidden === true ||
    file?.isHidden === true ||
    stateText.includes('HIDDEN')
  )
}

function isOldNexusDependencyFile(file = {}) {
  return matchNexusDependencyFileCategory(file, 'OLD_VERSION')
}

function isNexusDefaultDependencyFileAllowedByState(file = {}, provider = {}) {
  if (isDeletedNexusDependencyFile(file) || isHiddenNexusDependencyFile(file)) {
    return false
  }
  if (!provider.allowArchived && isArchivedNexusDependencyFile(file)) {
    return false
  }
  const explicitlyWantsOldFile =
    matchNexusDependencyFileCategory(file, provider.category) &&
    toUpperText(provider.category).startsWith('OLD')
  if (!provider.allowOldFiles && !explicitlyWantsOldFile && isOldNexusDependencyFile(file)) {
    return false
  }
  return true
}

function resolveNexusDependencyFileCategoryPriority(file = {}) {
  if (matchNexusDependencyFileCategory(file, 'MAIN')) return 0
  if (matchNexusDependencyFileCategory(file, 'UPDATE')) return 1
  if (matchNexusDependencyFileCategory(file, 'OPTIONAL')) return 2
  if (matchNexusDependencyFileCategory(file, 'MISCELLANEOUS')) return 3
  if (matchNexusDependencyFileCategory(file, 'OLD_VERSION')) return 4
  return 5
}

function isLikelyDeveloperNexusDependencyFile(file = {}) {
  const fileName = toLowerText(getNexusDependencyFileName(file))
  return (
    fileName.includes('for developers') ||
    fileName.includes('developer') ||
    fileName.includes('strict mode')
  )
}

function hasNexusDefaultDependencyNameFilter(provider = {}) {
  return (
    !!toSafeText(provider.fileName) ||
    !!toSafeText(provider.fileNameRegex) ||
    normalizeContainsTokens(provider.fileNameContains).length > 0
  )
}

function hasNexusDefaultDependencyFileFilter(provider = {}) {
  return !!toSafeText(provider.category) || hasNexusDefaultDependencyNameFilter(provider)
}

function sortNexusDependencyFilesByLatest(left = {}, right = {}) {
  const uploadedGap =
    getNexusDependencyFileUploadedScore(right) - getNexusDependencyFileUploadedScore(left)
  if (uploadedGap !== 0) {
    return uploadedGap
  }
  return getNexusDependencyFileId(right) - getNexusDependencyFileId(left)
}

function resolvePreferredNexusDefaultDependencyFile(files = []) {
  const sortedFiles = [...files].sort((left, right) => {
    const categoryGap =
      resolveNexusDependencyFileCategoryPriority(left) -
      resolveNexusDependencyFileCategoryPriority(right)
    if (categoryGap !== 0) {
      return categoryGap
    }

    const developerGap =
      Number(isLikelyDeveloperNexusDependencyFile(left)) -
      Number(isLikelyDeveloperNexusDependencyFile(right))
    if (developerGap !== 0) {
      return developerGap
    }

    const uploadedGap =
      getNexusDependencyFileUploadedScore(right) - getNexusDependencyFileUploadedScore(left)
    if (uploadedGap !== 0) {
      return uploadedGap
    }

    const primaryGap =
      toSafeNumber(right?.is_primary || right?.isPrimary, 0) -
      toSafeNumber(left?.is_primary || left?.isPrimary, 0)
    if (primaryGap !== 0) {
      return primaryGap
    }

    return getNexusDependencyFileId(right) - getNexusDependencyFileId(left)
  })

  return sortedFiles[0] || null
}

export function describeNexusDefaultDependencyFileFilters(provider = {}) {
  const containsTokens = normalizeContainsTokens(provider.fileNameContains)
  return [
    `game_domain=${toSafeText(provider.domainName) || '-'}`,
    `mod_id=${toSafeNumber(provider.modId, 0) || '-'}`,
    provider.category ? `category=${provider.category}` : '',
    provider.fileName ? `file_name=${provider.fileName}` : '',
    provider.fileNameRegex ? `file_name_regex=${provider.fileNameRegex}` : '',
    containsTokens.length ? `file_name_contains=${containsTokens.join('+')}` : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function resolveNexusDefaultDependencyResolvedBy(provider = {}) {
  if (provider.fileId > 0) {
    return 'explicit_file_id'
  }
  if (hasNexusDefaultDependencyNameFilter(provider)) {
    return 'auto_name_match'
  }
  if (provider.preferLatest || provider.category) {
    return 'auto_latest'
  }
  return 'auto_preferred'
}

function buildResolvedProviderSnapshot(provider = {}, file = {}, resolvedBy = '') {
  const fileId = provider.fileId > 0 ? provider.fileId : getNexusDependencyFileId(file)
  const fileName = getNexusDependencyFileName(file) || toSafeText(provider.fileName)
  const category = getNexusDependencyFileCategoryName(file) || toUpperText(provider.category)
  const uploadedTime = toSafeText(
    file?.uploaded_time || file?.uploadedTime || file?.date_uploaded || file?.dateUploaded
  )
  const version = toSafeText(file?.version || file?.file_version || file?.fileVersion)
  const fileSize = getNexusDependencyFileSize(file)
  const resolvedAt = new Date().toISOString()

  return {
    source: 'nexus_file',
    domainName: toSafeText(provider.domainName),
    game_domain: toSafeText(provider.domainName),
    modId: toSafeNumber(provider.modId, 0),
    mod_id: toSafeNumber(provider.modId, 0),
    fileId,
    file_id: fileId,
    fileName,
    file_name: fileName,
    version,
    category,
    uploadedTime,
    uploaded_time: uploadedTime,
    fileSize,
    file_size: fileSize,
    resolvedBy,
    resolved_by: resolvedBy,
    resolvedAt,
    resolved_at: resolvedAt,
    rawProvider: provider.rawProvider || {}
  }
}

export function resolveNexusDefaultDependencyFile(provider = {}, fileResponse = {}, options = {}) {
  const dependencyName = toSafeText(options.dependencyName) || '未知项'
  validateNexusDefaultDependencyProviderIdentity(provider, dependencyName)

  if (toSafeNumber(provider.fileId, 0) > 0) {
    return buildResolvedProviderSnapshot(provider, {}, 'explicit_file_id')
  }

  const fileList = normalizeNexusDefaultDependencyFileList(fileResponse)
  if (!fileList.length) {
    throw new Error(uiText('ui.defaultDependencyValueHasAnEmptyNexusFileListNo', { value1: (dependencyName) }))
  }

  const stateAllowedFiles = fileList.filter((file) =>
    isNexusDefaultDependencyFileAllowedByState(file, provider)
  )
  const selectableFiles = stateAllowedFiles.filter((file) =>
    matchNexusDependencyFileCategory(file, provider.category)
  )
  const matchedFiles = selectableFiles.filter((file) =>
    matchNexusDependencyFileName(file, provider)
  )
  let targetFile = null
  let resolvedBy = resolveNexusDefaultDependencyResolvedBy(provider)
  const hasFilter = hasNexusDefaultDependencyFileFilter(provider)

  if (matchedFiles.length) {
    targetFile =
      hasFilter || provider.preferLatest
        ? [...matchedFiles].sort(sortNexusDependencyFilesByLatest)[0]
        : resolvePreferredNexusDefaultDependencyFile(matchedFiles)
  } else if (provider.strict === false) {
    targetFile = resolvePreferredNexusDefaultDependencyFile(stateAllowedFiles)
    resolvedBy = 'auto_preferred'
  }

  if (!targetFile) {
    throw new Error(
      uiText('ui.noDownloadableFileMatchedDefaultDependencyValueValue', { value1: (dependencyName), value2: (describeNexusDefaultDependencyFileFilters(provider)) })
    )
  }

  const fileId = getNexusDependencyFileId(targetFile)
  if (fileId <= 0) {
    throw new Error(uiText('ui.theNexusFileResolvedForDefaultDependencyValueHasNo', { value1: (dependencyName) }))
  }

  return buildResolvedProviderSnapshot(
    {
      ...provider,
      fileId
    },
    targetFile,
    resolvedBy
  )
}
