const REFRESHABLE_PREFLIGHT_REASONS = new Set(['missing_archive', 'archive_not_found'])

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function buildArtifactPathMap(detail = {}) {
  const artifacts = Array.isArray(detail.artifacts) ? detail.artifacts : []
  const map = new Map()
  artifacts.forEach((artifact) => {
    const artifactKey = toSafeText(artifact?.artifact_key || artifact?.artifactKey)
    const filePath = toSafeText(artifact?.file_path || artifact?.filePath)
    if (artifactKey && filePath) {
      map.set(artifactKey, filePath)
    }
  })
  return map
}

function patchEntryWithFilePath(entry = {}, filePath = '') {
  const safeFilePath = toSafeText(filePath)
  if (!safeFilePath) return toPlainJson(entry, {})

  const source = toPlainJson(entry, {})
  const hasItemObject = source.item && typeof source.item === 'object' && !Array.isArray(source.item)
  const itemSource = hasItemObject
    ? toPlainJson(source.item, {})
    : toPlainJson(
        {
          ...source,
          meta: undefined
        },
        {}
      )
  const metaSource = toPlainJson(source.meta, {})
  const installPayload = toPlainJson(
    metaSource.installPayload || source.installPayload || itemSource.installPayload,
    {}
  )

  return {
    ...source,
    item: {
      ...itemSource,
      filePath: itemSource.filePath || safeFilePath,
      finalFilePath: itemSource.finalFilePath || safeFilePath
    },
    meta: {
      ...metaSource,
      filePath: metaSource.filePath || safeFilePath,
      archivePath: metaSource.archivePath || safeFilePath,
      installPayload: {
        ...installPayload,
        filePath: installPayload.filePath || safeFilePath,
        archivePath: installPayload.archivePath || safeFilePath
      }
    }
  }
}

function resolveItemArtifactFilePath(entry = {}, index = 0, items = [], artifactPathMap = new Map()) {
  const explicitArtifactKey = toSafeText(
    entry?.meta?.artifactKey ||
      entry?.meta?.artifact_key ||
      entry?.item?.artifactKey ||
      entry?.item?.artifact_key ||
      entry?.artifactKey ||
      entry?.artifact_key
  )
  if (explicitArtifactKey && artifactPathMap.has(explicitArtifactKey)) {
    return artifactPathMap.get(explicitArtifactKey)
  }

  const item = items[index] || {}
  const itemArtifactKey = toSafeText(item.artifact_key || item.artifactKey)
  if (itemArtifactKey && artifactPathMap.has(itemArtifactKey)) {
    return artifactPathMap.get(itemArtifactKey)
  }

  return ''
}

export function shouldRefreshAgentStandardPreflight(task = {}) {
  const plan = toPlainObject(task.plan)
  const sourcePayload = toPlainObject(plan.sourceInstallTaskPayload)
  if (!Array.isArray(sourcePayload.items) || !sourcePayload.items.length) {
    return false
  }

  const result = toPlainObject(task.result)
  const standardPreflight = toPlainObject(plan.standardPreflight || result.standardPreflight)
  const status = toSafeText(standardPreflight.status)
  const reason = toSafeText(standardPreflight.reason)
  if (!status) return true
  if (status !== 'skipped') return false
  return !reason || REFRESHABLE_PREFLIGHT_REASONS.has(reason)
}

export function summarizeAgentInstallPlan(plan = null) {
  if (!plan || typeof plan !== 'object') return null
  const standardPreflight = toPlainObject(plan.standardPreflight)

  return {
    id: toSafeText(plan.id),
    modName: toSafeText(plan.modName),
    version: toSafeText(plan.version),
    source: toSafeText(plan.source),
    sourceLabel: toSafeText(plan.sourceLabel),
    fileName: toSafeText(plan.fileName),
    gameName: toSafeText(plan.gameName),
    targetSummary: toSafeText(plan.targetSummary),
    precheckText: toSafeText(plan.precheckText),
    riskLevel: toSafeText(plan.riskLevel),
    riskText: toSafeText(plan.riskText),
    canSubmit: plan.canSubmit === true,
    canDecide: plan.canDecide === true,
    decisionState: toSafeText(plan.decisionState),
    missingDecisionData: Array.isArray(plan.missingDecisionData) ? plan.missingDecisionData : [],
    standardPreflightStatus: toSafeText(standardPreflight.status),
    inspectToken: toSafeText(standardPreflight.inspectToken),
    payloadHash: toSafeText(standardPreflight.payloadHash),
    conflictLevel: toSafeText(standardPreflight.conflictResult?.level)
  }
}

export function applyDownloadedArtifactsToInstallPlan(plan = {}, detail = {}) {
  const safePlan = toPlainJson(plan, {})
  const sourcePayload = toPlainObject(safePlan.sourceInstallTaskPayload)
  const payloadItems = Array.isArray(sourcePayload.items) ? sourcePayload.items : []
  if (!payloadItems.length) {
    return {
      changed: false,
      plan: safePlan,
      filePaths: []
    }
  }

  const detailItems = Array.isArray(detail.items) ? detail.items : []
  const artifactPathMap = buildArtifactPathMap(detail)
  const filePaths = []
  const nextItems = payloadItems.map((entry, index) => {
    const filePath = resolveItemArtifactFilePath(entry, index, detailItems, artifactPathMap)
    if (!filePath) return toPlainJson(entry, {})
    filePaths.push(filePath)
    return patchEntryWithFilePath(entry, filePath)
  })

  if (!filePaths.length) {
    return {
      changed: false,
      plan: safePlan,
      filePaths: []
    }
  }

  const firstFilePath = filePaths[0]
  return {
    changed: true,
    filePaths,
    plan: {
      ...safePlan,
      filePath: safePlan.filePath || firstFilePath,
      archivePath: safePlan.archivePath || firstFilePath,
      sourceInstallTaskPayload: {
        ...sourcePayload,
        filePath: sourcePayload.filePath || firstFilePath,
        archivePath: sourcePayload.archivePath || firstFilePath,
        items: nextItems
      }
    }
  }
}
