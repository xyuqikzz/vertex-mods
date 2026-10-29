import { getSourcePlatformDefinition, normalizeSourcePlatform } from './source-platform-registry.js'

export function getRetiredSourceFailure(source = 'vertex') {
  const definition = getSourcePlatformDefinition(source)
  if (!definition?.retiredOnline) return null
  return {
    success: false,
    ok: false,
    source: definition.key,
    code: 'removed_source',
    errorCode: 'removed_source',
    recoverable: false,
    message: definition.removedReason
  }
}

export function createRetiredSourceError(source = 'vertex') {
  const failure = getRetiredSourceFailure(source)
  return failure ? Object.assign(new Error(failure.message), failure) : null
}

// 仅检查业务身份字段，不将工具命名空间、协议、路径或 server 安装终端当作来源。
export function findRetiredSource(payload) {
  const seen = new Set()
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    for (const key of [
      'source',
      'sourceType',
      'sourcePlatform',
      'source_platform',
      'source_type',
      'sourceAdapter',
      'source_adapter',
      'businessSource',
      'business_source',
      'target_source_platform',
      'targetSourcePlatform'
    ]) {
      if (typeof value[key] === 'string' && getRetiredSourceFailure(value[key]))
        return normalizeSourcePlatform(value[key])
    }
    for (const key of [
      'data',
      'sourceMeta',
      'candidate',
      'plan',
      'installPlan',
      'sourceInstallTaskPayload',
      'sourceInstallTaskPayloadDraft',
      'item',
      'meta',
      'installPayload',
      'payload',
      'fun',
      'items',
      'entries',
      'batchEntries',
      'mainItem',
      'mainMeta'
    ]) {
      const children = Array.isArray(value[key]) ? value[key] : [value[key]]
      for (const child of children) {
        const source = visit(child)
        if (source) return source
      }
    }
    return ''
  }
  return visit(payload)
}

export function assertNoRetiredSource(payload) {
  const source = findRetiredSource(payload)
  if (source) throw createRetiredSourceError(source)
}

export function isRetiredSourceApiPath(url = '') {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(String(url), 'https://backend.invalid').pathname)
  } catch {
    return false
  }
  const route = pathname.replace(/^.*?\/client(?=\/)/, '')
  return (
    /^\/(?:mod|modpack)(?:\/|$)/i.test(route) ||
    /^\/user\/(?:apply\/upload\/module|upload\/application\/status|my\/mods)(?:\/|$)/i.test(
      route
    ) ||
    /^\/game\/(?:all\/list|modpack\/list|mod\/install\/(?:total|path))(?:\/|$)/i.test(route) ||
    /^\/pan\/(?:get\/(?:clientAccessToken|accessToken)|trigger\/second\/upload|save\/cache\/record|delete\/cached\/file|create\/upload\/file|chunk\/upload\/url)(?:\/|$)/i.test(
      route
    )
  )
}

export function assertActiveSourceApiPath(url) {
  if (isRetiredSourceApiPath(url)) throw createRetiredSourceError()
}

export function getRetiredDownloadFailure(task = {}) {
  const source = findRetiredSource(task)
  if (source) return getRetiredSourceFailure(source)
  // 旧自有下载任务可能没有来源字段，但仍带自有安装回调。
  if (
    task.fun?.method === 'installMods' &&
    !task.sourcePlatform &&
    !task.sourceType &&
    !task.source
  )
    return getRetiredSourceFailure()
  return null
}

export function isLegacyManifestOnlyRecord(record = {}) {
  if (
    !getRetiredSourceFailure(record.source) ||
    String(record.install_model || 'legacy') !== 'legacy'
  )
    return false
  let metadata
  try {
    metadata =
      typeof record.metadata_json === 'string'
        ? JSON.parse(record.metadata_json || '{}')
        : record.metadata_json || {}
  } catch {
    return false
  }
  return ![
    record.source_root_path,
    record.archive_path,
    record.staging_path,
    metadata.sourceRoot,
    metadata.sourceRootPath,
    metadata.archivePath,
    metadata.stagingPath
  ].some((value) => String(value || '').trim())
}
