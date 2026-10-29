function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function stripWrappingQuotes(value = '') {
  return toSafeText(value).replace(/^['"]+|['"]+$/g, '')
}

function toSafeNumber(value = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function safeDecodeText(value = '') {
  const text = toSafeText(value)
  if (!text) {
    return ''
  }
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function pickText(source = {}, keys = []) {
  for (const key of keys) {
    const value = toSafeText(source?.[key])
    if (value) {
      return value
    }
  }
  return ''
}

function getFileBaseName(value = '') {
  const text = toSafeText(value)
  if (!text) {
    return ''
  }
  const parts = text.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || text
}

function normalizeComparableFileName(value = '') {
  return getFileBaseName(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

function firstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function hasPositiveExpires(value = '') {
  const expiresValue = Number(value)
  return Number.isFinite(expiresValue) && expiresValue > 0
}

function parseNxmUrlAuthorization(urlText = '') {
  const parsedUrl = new URL(urlText)
  const pathParts = parsedUrl.pathname.split('/').map(safeDecodeText).filter(Boolean)
  const modIndex = pathParts.findIndex((item) => item.toLowerCase() === 'mods')
  const fileIndex = pathParts.findIndex((item) => item.toLowerCase() === 'files')

  return {
    gameDomain: safeDecodeText(parsedUrl.hostname),
    modId: modIndex !== -1 ? toSafeNumber(pathParts[modIndex + 1]) : 0,
    fileId: fileIndex !== -1 ? toSafeNumber(pathParts[fileIndex + 1]) : 0,
    key: toSafeText(parsedUrl.searchParams.get('key')),
    expires: toSafeText(parsedUrl.searchParams.get('expires')),
    userId: toSafeText(parsedUrl.searchParams.get('user_id') || parsedUrl.searchParams.get('userId'))
  }
}

export function parseNexusDownloadLinkEndpoint(endpoint = '') {
  const endpointText = toSafeText(endpoint)
  if (!endpointText) {
    return {
      gameDomain: '',
      modId: 0,
      fileId: 0
    }
  }

  let pathname = endpointText
  try {
    pathname = new URL(endpointText).pathname
  } catch {
    pathname = endpointText.split('?')[0]
  }

  const pathParts = pathname.split('/').map(safeDecodeText).filter(Boolean)
  const gameIndex = pathParts.findIndex((item) => item.toLowerCase() === 'games')
  const modIndex = pathParts.findIndex((item) => item.toLowerCase() === 'mods')
  const fileIndex = pathParts.findIndex((item) => item.toLowerCase() === 'files')

  return {
    gameDomain: gameIndex !== -1 ? safeDecodeText(pathParts[gameIndex + 1]) : '',
    modId: modIndex !== -1 ? toSafeNumber(pathParts[modIndex + 1]) : 0,
    fileId: fileIndex !== -1 ? toSafeNumber(pathParts[fileIndex + 1]) : 0
  }
}

export function parseNexusDownloadAuthorization(input = {}) {
  if (typeof input === 'string') {
    const urlText = stripWrappingQuotes(input)
    if (!urlText) {
      return {
        gameDomain: '',
        modId: 0,
        fileId: 0,
        key: '',
        expires: '',
        userId: ''
      }
    }
    try {
      return parseNxmUrlAuthorization(urlText)
    } catch {
      return {
        gameDomain: '',
        modId: 0,
        fileId: 0,
        key: '',
        expires: '',
        userId: ''
      }
    }
  }

  if (input?.downloadAuthorization) {
    return parseNexusDownloadAuthorization(input.downloadAuthorization)
  }
  if (input?.authorization) {
    return parseNexusDownloadAuthorization(input.authorization)
  }

  const source = input

  return {
    gameDomain: toSafeText(source?.gameDomain || source?.gameDomainName || source?.domainName),
    modId: toSafeNumber(source?.modId || source?.mod_id),
    fileId: toSafeNumber(source?.fileId || source?.file_id),
    key: pickText(source, ['key', 'downloadKey', 'nexusDownloadKey']),
    expires: pickText(source, ['expires', 'expire', 'expiresAt', 'expiration']),
    userId: pickText(source, ['userId', 'user_id', 'nexusUserId'])
  }
}

export function buildNexusManualDownloadPageUrl(input = {}) {
  const target =
    typeof input === 'string' && input.includes('/download_link.json')
      ? parseNexusDownloadLinkEndpoint(input)
      : parseNexusDownloadAuthorization(input)
  const gameDomain = toSafeText(target.gameDomain || target.domainName || target.gameDomainName)
  const modId = toSafeNumber(target.modId || target.mod_id)
  const fileId = toSafeNumber(target.fileId || target.file_id)

  if (!gameDomain || modId <= 0 || fileId <= 0) {
    return ''
  }

  const url = new URL(
    `https://www.nexusmods.com/${encodeURIComponent(gameDomain)}/mods/${encodeURIComponent(modId)}`
  )
  url.searchParams.set('tab', 'files')
  url.searchParams.set('file_id', String(fileId))
  url.searchParams.set('nmm', '1')
  return url.toString()
}

export function buildNexusManualDownloadPreviewItem(context = {}) {
  const item = context.item || {}
  const modInfo = context.modInfo || {}
  const targetFile = context.targetFile || {}
  const sourceMetadata =
    item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata
      : {}
  const domainName = toSafeText(context.domainName || context.gameDomain)
  const modId = toSafeNumber(context.modId)
  const fileId = toSafeNumber(context.fileId)
  const fileName = firstText(
    targetFile.name,
    sourceMetadata.fileName,
    sourceMetadata.file_name,
    `Nexus 文件-${fileId}`
  )
  const fileSize =
    toSafeNumber(targetFile.size_kb) * 1024 ||
    toSafeNumber(targetFile.fileSize || targetFile.file_size) ||
    toSafeNumber(sourceMetadata.fileSize || sourceMetadata.file_size)

  return {
    ...item,
    manualDownload: true,
    downloadUrl: '',
    name: firstText(item.name, modInfo?.name, `Nexus 模组-${modId}`),
    version: firstText(item.version, targetFile.version),
    status: 'manual_pending',
    reason: '需要在 Nexus 网页手动授权下载',
    canImport: false,
    metadata: {
      ...sourceMetadata,
      cover: firstText(sourceMetadata.cover, modInfo?.pictureUrl),
      description: firstText(sourceMetadata.description, modInfo?.summary),
      fileName,
      fileSize,
      domainName,
      gameDomain: domainName,
      modId,
      fileId,
      manualDownload: true,
      manualDownloadStatus: 'manual_pending',
      manualDownloadPageUrl: buildNexusManualDownloadPageUrl({
        gameDomain: domainName,
        modId,
        fileId
      })
    }
  }
}

export function buildNexusDownloadLinkQueryParams(input = {}) {
  const authorization = parseNexusDownloadAuthorization(input)
  if (!authorization.key || !hasPositiveExpires(authorization.expires)) {
    return {}
  }

  return {
    key: authorization.key,
    expires: authorization.expires
  }
}

export function isNexusDownloadLinkForbiddenError(error = {}) {
  return String(error?.code || '').trim() === 'NEXUS_DOWNLOAD_LINK_FORBIDDEN'
}

export function isNexusDownloadAuthorizationExpired(input = {}) {
  const authorization = parseNexusDownloadAuthorization(input)
  const expiresValue = Number(authorization.expires)
  if (!Number.isFinite(expiresValue) || expiresValue <= 0) {
    return true
  }

  const expiresMs = expiresValue > 100000000000 ? expiresValue : expiresValue * 1000
  return expiresMs <= Date.now()
}

export function isCompleteNexusDownloadAuthorization(input = {}) {
  const authorization = parseNexusDownloadAuthorization(input)
  return (
    !!toSafeText(authorization.gameDomain) &&
    toSafeNumber(authorization.modId) > 0 &&
    toSafeNumber(authorization.fileId) > 0 &&
    !!toSafeText(authorization.key) &&
    hasPositiveExpires(authorization.expires)
  )
}

export function isCompleteFreshNexusDownloadAuthorization(input = {}) {
  return isCompleteNexusDownloadAuthorization(input) && !isNexusDownloadAuthorizationExpired(input)
}

export function matchNexusDownloadAuthorizationTarget(authorizationInput = {}, targetInput = {}) {
  const authorization = parseNexusDownloadAuthorization(authorizationInput)
  const target = parseNexusDownloadAuthorization(targetInput)

  if (!authorization.key || !authorization.expires) {
    return {
      matched: false,
      reason: 'authorization_missing',
      message: 'Nexus 下载授权缺少 key 或 expires，请重新打开文件页并再次点击下载。'
    }
  }

  if (isNexusDownloadAuthorizationExpired(authorization)) {
    return {
      matched: false,
      reason: 'authorization_expired',
      message: 'Nexus 下载授权已过期。请重新打开文件页，并再次点击下载。'
    }
  }

  const sameTarget =
    toSafeText(authorization.gameDomain).toLowerCase() ===
      toSafeText(target.gameDomain).toLowerCase() &&
    toSafeNumber(authorization.modId) === toSafeNumber(target.modId) &&
    toSafeNumber(authorization.fileId) === toSafeNumber(target.fileId)

  if (!sameTarget) {
    return {
      matched: false,
      reason: 'target_mismatch',
      message:
        '识别到的 Nexus 下载文件与当前等待项不一致。请回到 Vertex 打开的 Nexus 文件页面，点击对应文件的下载按钮。'
    }
  }

  return {
    matched: true,
    reason: '',
    message: ''
  }
}

export function buildNexusManualDownloadHttpErrorNotice(error = {}) {
  const status = Number(error?.status || error?.response?.status || 0)

  if (status === 400) {
    return {
      reason: 'account_mismatch_suspected',
      title: 'Nexus 账号不一致，无法获取下载地址',
      message:
        'Vertex 中配置的 Nexus API Key 需要和外部浏览器当前登录的 Nexus 账号保持一致。\n当前下载授权由浏览器登录账号生成，但 Vertex 请求下载地址时使用的是已配置的 API Key；如果两个账号不同，Nexus 会返回 400。\n\n请确认：\n1. 外部浏览器登录的是生成该 API Key 的 Nexus 账号。\n2. Vertex 设置中的 Nexus API Key 没有填错或过期。\n3. 修改后重新打开 Nexus 文件页，并再次点击下载。'
    }
  }

  if (status === 403) {
    return {
      reason: 'api_key_forbidden',
      title: 'Nexus API Key 无效或权限不足',
      message: 'Nexus API Key 无效或权限不足。请检查 Vertex 中配置的 Nexus API Key，并确认账号可以访问该文件。'
    }
  }

  if (status === 410) {
    return {
      reason: 'authorization_expired',
      title: 'Nexus 下载授权已过期',
      message: 'Nexus 下载授权已过期。请重新打开文件页，并再次点击下载。'
    }
  }

  return {
    reason: 'download_link_failed',
    title: 'Nexus 下载地址获取失败',
    message: String(error?.message || 'Nexus 下载地址获取失败，请稍后重试或选择已下载文件。')
  }
}

// API display names and rounded KB values are not archive identity checks.
export function buildNexusFileIdentity(file = {}) {
  const raw = file.raw || file
  const exactSize = toSafeNumber(raw.size_in_bytes || raw.sizeInBytes)
  return {
    fileName: toSafeText(raw.file_name || raw.fileName || file.name),
    fileSize: exactSize || toSafeNumber(raw.size_kb) * 1024,
    fileSizeExact: exactSize > 0,
    fileVersion: toSafeText(raw.version || file.version)
  }
}

export function getNextNexusAuthorizationItem(items = [], lastOpenedItemId = '') {
  if (!Array.isArray(items) || !items.length) return null
  const anchor = items.findIndex((item) => item.itemId === lastOpenedItemId)
  for (let offset = 1; offset <= items.length; offset += 1) {
    const item = items[(anchor + offset) % items.length]
    if (item.status === 'waiting_authorization') return item
  }
  return null
}

export function validateNexusManualSelectedFile(fileMeta = {}, targetMeta = {}) {
  const selectedPath = toSafeText(fileMeta?.path || fileMeta?.filePath)
  const selectedName = toSafeText(fileMeta?.name || getFileBaseName(selectedPath))
  if (!selectedPath || !selectedName) {
    return {
      valid: false,
      confidence: 'none',
      needsConfirmation: false,
      reason: 'file_missing',
      message: '请选择已下载的 Nexus 文件。'
    }
  }

  const expectedName = toSafeText(
    targetMeta?.fileName || targetMeta?.name || targetMeta?.expectedFileName
  )
  const selectedSize = toSafeNumber(fileMeta?.size || fileMeta?.fileSize)
  const expectedSize = toSafeNumber(targetMeta?.fileSize || targetMeta?.size || targetMeta?.file_size)
  const nameMatches =
    !!expectedName &&
    normalizeComparableFileName(selectedName) === normalizeComparableFileName(expectedName)
  const sizeMatches = expectedSize > 0 && selectedSize > 0 && selectedSize === expectedSize
  // Old tasks saved the display title and size_kb * 1024 without a precision flag.
  const approximateSize = targetMeta.fileSizeExact === false ||
    (targetMeta.fileSizeExact === undefined && !/\.(zip|7z|rar)$/i.test(expectedName))
  const roundedSizeMatches = approximateSize && expectedSize > 0 && selectedSize > 0 &&
    Math.abs(selectedSize - expectedSize) < 1024
  const sizeContradictsTarget = expectedSize > 0 && selectedSize > 0 &&
    ((targetMeta.fileSizeExact === true && !sizeMatches) || (approximateSize && !roundedSizeMatches))

  if (nameMatches && !approximateSize && (sizeMatches || expectedSize <= 0)) {
    return {
      valid: true,
      confidence: 'strong',
      needsConfirmation: false,
      reason: '',
      message: expectedSize > 0 ? '文件名和大小均匹配' : '文件名匹配'
    }
  }

  // Confirmation resolves incomplete identity; it cannot override a known size mismatch.
  if (!sizeContradictsTarget && (nameMatches || sizeMatches || roundedSizeMatches)) {
    return {
      valid: true,
      confidence: 'weak',
      needsConfirmation: true,
      reason: 'partial_match',
      message: '该文件无法完成强校验，但文件名或大小与目标文件存在匹配。'
    }
  }

  return {
    valid: false,
    confidence: 'none',
    needsConfirmation: false,
    reason: 'mismatch',
    message: '选择的文件与当前 Nexus 文件不匹配。请确认文件名、版本和大小后重新选择。'
  }
}
