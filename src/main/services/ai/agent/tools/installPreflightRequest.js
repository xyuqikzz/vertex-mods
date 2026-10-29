function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim() || fallback
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

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function firstPlainObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return toPlainJson(value, {})
    }
  }
  return {}
}

function firstEntryFromPayload(payload = {}, candidate = {}) {
  const entries = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload?.batchEntries)
        ? payload.batchEntries
        : []
  const fileId = pickFirstText(candidate.fileId, candidate.sourceFileId, candidate.selectedFileId)
  const matched = fileId ? entries.find((entry) => [entry.item?.sourceFileId, entry.meta?.installPayload?.fileId, entry.meta?.installPayload?.id].some((id) => String(id) === fileId)) : null
  return matched || entries.find((entry) => entry && typeof entry === 'object' &&
    Number(entry.meta?.installPayload?.typeId || 0) !== 1 && !entry.meta?.installPayload?.dependencyRole) || entries[0] || {}
}

function resolveEntryObject(entry = {}) {
  const source = entry && typeof entry === 'object' ? entry : {}
  return {
    item: source.item && typeof source.item === 'object' ? source.item : source,
    meta: source.meta && typeof source.meta === 'object' ? source.meta : {}
  }
}

export function resolveStandardPreflightSource(candidate = {}, context = {}, taskPayload = {}) {
  return pickFirstText(
    candidate.source,
    candidate.sourceType,
    candidate.sourcePlatform,
    taskPayload.source,
    taskPayload.sourceType,
    taskPayload.sourcePlatform,
    context?.page?.businessSource,
    context?.page?.source,
    context?.game?.source
  ).toLowerCase()
}

export function createStandardPreflightRequest(options = {}) {
  const candidate = toPlainJson(options.candidate, {})
  const context = toPlainJson(options.context, {})
  const plan = toPlainJson(options.plan, {})
  const taskPayload = firstPlainObject(plan.sourceInstallTaskPayload, candidate.sourceInstallTaskPayload)
  const entry = firstEntryFromPayload(taskPayload, candidate)
  const { item, meta } = resolveEntryObject(entry)
  const installPayload = firstPlainObject(
    candidate.installPayload,
    meta.installPayload,
    entry.installPayload,
    item.installPayload,
    plan.installPayload
  )
  const source = resolveStandardPreflightSource(candidate, context, taskPayload)
  const filePath = pickFirstText(
    candidate.filePath,
    candidate.file_path,
    candidate.archivePath,
    candidate.archive_path,
    candidate.localFilePath,
    candidate.downloadedFilePath,
    plan.filePath,
    plan.archivePath,
    taskPayload.filePath,
    taskPayload.archivePath,
    item.filePath,
    item.file_path,
    item.finalFilePath,
    item.archivePath,
    meta.filePath,
    meta.archivePath,
    installPayload.filePath,
    installPayload.archivePath
  )

  if (!filePath) {
    return {
      available: false,
      reason: 'missing_archive',
      missing: ['filePath'],
      source,
      installPayload,
      taskPayload
    }
  }

  return {
    available: true,
    reason: '',
    missing: [],
    source,
    filePath,
    installPayload,
    taskPayload,
    request: {
      filePath,
      source,
      data: { ...(Object.keys(installPayload).length ? installPayload : candidate),
        ...(candidate.installChoices ? { installChoices: candidate.installChoices } : {}) },
      type: toSafeNumber(candidate.type || taskPayload.type || meta.type || item.type, 1) || 1
    }
  }
}
