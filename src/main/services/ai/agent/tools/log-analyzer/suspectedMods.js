// 从任务与日志证据推断可疑模组。
import {
  toSafeText,
  toSafeNumber,
  truncateText,
  normalizeLogLevel,
  isProblemLog
} from './values.js'

const MAX_SUSPECTED_MODS = 20

const MAX_SUSPECTED_MOD_EVIDENCE = 4

const EXTERNAL_LOG_MOD_NAME_BLOCKLIST = Object.freeze(
  new Set([
    'bepinex',
    'unity',
    'unityengine',
    'system',
    'microsoft',
    'mscorlib',
    'netstandard',
    'error',
    'fatal',
    'warn',
    'warning',
    'info',
    'debug'
  ])
)

const SUSPECTED_MOD_CONFIDENCE_WEIGHT = Object.freeze({
  high: 3,
  medium: 2,
  low: 1
})

function createEvidence(source = '', data = {}) {
  const message = truncateText(data.message, 500)
  if (!message && !data.stage) return null
  return {
    source: toSafeText(source),
    level: normalizeLogLevel(data.level),
    stage: toSafeText(data.stage),
    message,
    filePath: toSafeText(data.filePath),
    lineNumber: toSafeNumber(data.lineNumber),
    createdAt: toSafeText(data.createdAt)
  }
}

function uniqueEvidence(evidence = []) {
  const seen = new Set()
  const result = []
  for (const item of evidence) {
    if (!item) continue
    const key = [
      item.source,
      item.level,
      item.stage,
      item.filePath,
      item.lineNumber,
      item.message
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result.slice(0, MAX_SUSPECTED_MOD_EVIDENCE)
}

function normalizeConfidence(value = '') {
  const confidence = toSafeText(value).toLowerCase()
  return SUSPECTED_MOD_CONFIDENCE_WEIGHT[confidence] ? confidence : 'medium'
}

function normalizeExternalModName(value = '') {
  const title = toSafeText(value)
    .replace(/^[\s"'`[\]():-]+|[\s"'`[\]():-]+$/g, '')
    .replace(/\.(dll|pak|zip|rar|7z)$/i, '')
    .trim()
  if (!title || title.length < 2 || title.length > 120) return ''
  if (EXTERNAL_LOG_MOD_NAME_BLOCKLIST.has(title.toLowerCase())) return ''
  return title
}

function inferExternalLogModName(message = '') {
  const text = toSafeText(message)
  const pluginPathMatch = text.match(/\bBepInEx[\\/]+plugins[\\/]+([^\\/\s]+)\.dll\b/i)
  if (pluginPathMatch) {
    const title = normalizeExternalModName(pluginPathMatch[1])
    if (title) return title
  }

  const taggedLoggerMatch = text.match(
    /\[(?:error|fatal|warn|warning|info|debug)?\s*:\s*([^\]\r\n]{2,120})\]/i
  )
  if (taggedLoggerMatch) {
    const title = normalizeExternalModName(taggedLoggerMatch[1])
    if (title) return title
  }

  const explicitNameMatch = text.match(
    /\b(?:plugin|mod|assembly)\s+["']?([A-Za-z0-9][A-Za-z0-9_.-]{1,80})["']?/i
  )
  if (explicitNameMatch) {
    const title = normalizeExternalModName(explicitNameMatch[1])
    if (title) return title
  }

  const stackMatch = text.match(/\bat\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\./)
  if (stackMatch) {
    const parts = stackMatch[1].split('.').filter(Boolean)
    const candidate = parts.find((part) => /mod|plugin/i.test(part)) || parts[0]
    return normalizeExternalModName(candidate)
  }
  return ''
}

function compareSuspectedMods(left = {}, right = {}) {
  const confidenceDiff =
    (SUSPECTED_MOD_CONFIDENCE_WEIGHT[normalizeConfidence(right.confidence)] || 0) -
    (SUSPECTED_MOD_CONFIDENCE_WEIGHT[normalizeConfidence(left.confidence)] || 0)
  if (confidenceDiff !== 0) return confidenceDiff
  return toSafeText(left.title).localeCompare(toSafeText(right.title))
}

function createSuspectedMod(item = {}, job = {}, options = {}) {
  const evidence = uniqueEvidence(options.evidence || [])
  const message = toSafeText(options.message || item.message || item.errorMessage)
  const failureStage = toSafeText(options.failureStage || item.failureStage)
  if (!item.itemId && !item.title && !item.artifactKey) return null
  return {
    jobId: job.jobId,
    source: job.source,
    itemId: toSafeText(item.itemId),
    title: toSafeText(item.title, '安装项'),
    version: toSafeText(item.version),
    sourceModKey: toSafeText(item.sourceModKey),
    dependencyKey: toSafeText(item.dependencyKey),
    installKey: toSafeText(item.installKey),
    artifactKey: toSafeText(item.artifactKey),
    failureStage,
    message,
    confidence: normalizeConfidence(options.confidence),
    evidence
  }
}

function getSuspectedModKey(mod = {}) {
  return [mod.jobId, mod.itemId, mod.artifactKey, mod.sourceModKey, mod.title].join('|')
}

export function uniqueSuspectedMods(mods = []) {
  const byKey = new Map()
  for (const mod of mods.filter(Boolean)) {
    const key = getSuspectedModKey(mod)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, mod)
      continue
    }
    const currentWeight = SUSPECTED_MOD_CONFIDENCE_WEIGHT[normalizeConfidence(mod.confidence)] || 0
    const existingWeight =
      SUSPECTED_MOD_CONFIDENCE_WEIGHT[normalizeConfidence(existing.confidence)] || 0
    byKey.set(key, {
      ...existing,
      ...mod,
      confidence: currentWeight > existingWeight ? mod.confidence : existing.confidence,
      evidence: uniqueEvidence([...(existing.evidence || []), ...(mod.evidence || [])])
    })
  }
  return [...byKey.values()].sort(compareSuspectedMods).slice(0, MAX_SUSPECTED_MODS)
}

export function createExternalLogSuspectedMods(samples = [], job = {}) {
  const mods = []
  for (const sample of samples.filter(isProblemLog)) {
    const title = inferExternalLogModName(sample.message)
    if (!title) continue
    mods.push(
      createSuspectedMod({ title }, job, {
        confidence: sample.level === 'error' ? 'medium' : 'low',
        failureStage: 'external_log',
        message: sample.message,
        evidence: [createEvidence('external_log', sample)]
      })
    )
  }
  return uniqueSuspectedMods(mods)
}

export function createSuspectedMods(context = {}) {
  const { job = {}, items = [], failedItems = [], classifications = [], problemLogs = [] } = context
  const itemById = new Map(items.map((item) => [item.itemId, item]))
  const mods = []

  for (const failedItem of failedItems) {
    const item = itemById.get(failedItem.itemId) || failedItem
    const matchedClassifications = classifications.filter(
      (classification) => classification.kind === 'item' && classification.targetId === item.itemId
    )
    const matchedLogs = problemLogs.filter((log) => log.itemId === item.itemId)
    mods.push(
      createSuspectedMod(item, job, {
        confidence: 'high',
        failureStage: failedItem.failureStage,
        message: failedItem.message,
        evidence: [
          createEvidence('install_task', {
            level: 'error',
            stage: failedItem.failureStage,
            message: failedItem.message
          }),
          ...matchedClassifications.map((classification) =>
            createEvidence('install_classifier', {
              level: classification.recoverable === false ? 'error' : 'warn',
              stage: classification.stage,
              message: classification.message
            })
          ),
          ...matchedLogs.map((log) =>
            createEvidence('install_log', {
              level: log.level,
              message: log.message,
              createdAt: log.createdAt
            })
          )
        ]
      })
    )
  }

  const knownKeys = new Set(mods.filter(Boolean).map(getSuspectedModKey))
  for (const log of problemLogs.filter((item) => item.itemId)) {
    const item = itemById.get(log.itemId)
    if (!item) continue
    const candidate = createSuspectedMod(item, job, {
      confidence: 'medium',
      failureStage: item.failureStage,
      message: log.message,
      evidence: [
        createEvidence('install_log', {
          level: log.level,
          message: log.message,
          createdAt: log.createdAt
        })
      ]
    })
    const key = getSuspectedModKey(candidate)
    if (!knownKeys.has(key)) {
      knownKeys.add(key)
      mods.push(candidate)
    }
  }

  return uniqueSuspectedMods(mods)
}
