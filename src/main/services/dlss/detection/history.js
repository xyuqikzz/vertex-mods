import { pathKey } from '../files.js'
import renderingApi from '../../../../shared/dlss-swapper/rendering-api.js'
import fs from 'node:fs'
import { ownedPath } from './executables.js'

const MAX_AGE = 24 * 60 * 60 * 1000
const sameFingerprint = (a, b) => a && b && a.size === b.size && a.modifiedAt === b.modifiedAt

// Preserve precise, owned runtime logs independently of installed plugin files.
// A single scan never promotes a GPU/client or configuration hint to a saved result.
export function rememberScanDetections(record, scan, now = Date.now()) {
  let changed = false
  for (const exe of scan.exeCandidates || []) {
    const r = exe.rendering
    const evidence =
      exe.processState === 'running'
        ? r?.current
        : exe.processState === 'not-running'
          ? r?.lastObserved
          : null
    if (
      !exe.fingerprint ||
      !evidence ||
      r.state === 'conflict' ||
      !renderingApi.choices.some((choice) => choice.value === evidence.api)
    )
      continue
    const time =
      evidence.observedAt || Math.max(0, ...(evidence.evidence || []).map((e) => e.observedAt || 0))
    const key = pathKey(exe.path),
      saved = record.detectionHistory?.[key]
    if (
      !Number.isFinite(time) ||
      time <= 0 ||
      time > now ||
      now - time > MAX_AGE ||
      time <= (record.detectionInvalidations?.[key] || 0) ||
      (saved && saved.observedAt >= time)
    )
      continue
    const files = [
      ...new Set(
        [
          exe.evidenceFile,
          ...(exe.staticApiCandidates || []).flatMap((item) =>
            (item.sources || []).map((source) => source.file)
          )
        ].filter((file) => file && pathKey(file) !== key)
      )
    ]
    const dependencies = []
    try {
      for (const file of files) {
        if (!ownedPath(record.gameRoot, file)) throw new Error('unowned dependency')
        const stat = fs.statSync(file)
        dependencies.push({ path: file, size: stat.size, modifiedAt: stat.mtimeMs })
      }
    } catch {
      continue
    }
    record.detectionHistory = {
      ...record.detectionHistory,
      [key]: {
        api: evidence.api,
        confidence: evidence.state,
        source: 'runtime-log',
        fingerprint: exe.fingerprint,
        dependencies,
        observedAt: time
      }
    }
    changed = true
  }
  return changed
}

export function rememberDetection(record, result) {
  const key = pathKey(result.exePath)
  if (['manual_required', 'unavailable'].includes(result.code)) return
  if (record.detectionHistory?.[key]) {
    record.detectionHistory = { ...record.detectionHistory }
    delete record.detectionHistory[key]
  }
  if (
    !['detected', 'recommended'].includes(result.code) ||
    result.source === 'static' ||
    !result.api ||
    !result.session ||
    !result.fingerprint
  ) {
    // A later scan must not re-import the same log that a new inconclusive
    // session just invalidated, including after the game has exited.
    record.detectionInvalidations = { ...record.detectionInvalidations, [key]: Date.now() }
    return
  }
  if (record.detectionInvalidations?.[key]) {
    record.detectionInvalidations = { ...record.detectionInvalidations }
    delete record.detectionInvalidations[key]
  }
  record.detectionHistory = {
    ...record.detectionHistory,
    [key]: {
      api: result.api,
      confidence: result.confidence,
      source: result.source,
      fingerprint: result.fingerprint,
      dependencies: result.dependencies || [],
      observedAt: Date.now()
    }
  }
}

// A stopped game's recent session can plan installation, but never becomes current evidence.
export function applyDetectionHistory(scan, record, now = Date.now()) {
  const candidates = new Set([...(scan.exeCandidates || []), ...(scan.selectableExecutables || [])])
  for (const exe of candidates) {
    const saved = record.detectionHistory?.[pathKey(exe.path)]
    const r = exe.rendering
    const invalidatedAt = record.detectionInvalidations?.[pathKey(exe.path)] || 0
    if (
      r?.installationPlan?.source === 'history' &&
      r.installationPlan.observedAt <= invalidatedAt
    ) {
      r.installationPlan = null
      if (!r.recommendedApi && r.state !== 'conflict') r.state = 'needs-choice'
    }
    if (
      !r ||
      exe.processState !== 'not-running' ||
      r.current ||
      r.requested ||
      (r.recommendedApi && r.recommendationSource !== 'static') ||
      r.state === 'conflict' ||
      r.reasons?.some(
        (reason) => reason !== 'historical_disagreement' && !reason.startsWith('log_')
      ) ||
      !saved ||
      !sameFingerprint(saved.fingerprint, exe.fingerprint) ||
      !Number.isFinite(saved.observedAt) ||
      now < saved.observedAt ||
      now - saved.observedAt > MAX_AGE ||
      !renderingApi.choices.some((choice) => choice.value === saved.api) ||
      (r.lastObserved?.observedAt || 0) > saved.observedAt
    )
      continue
    if (
      (saved.dependencies || []).some((file) => {
        try {
          if (!ownedPath(record.gameRoot, file.path)) return true
          const stat = fs.statSync(file.path)
          return stat.size !== file.size || stat.mtimeMs !== file.modifiedAt
        } catch {
          return true
        }
      })
    )
      continue
    r.lastDetection = {
      api: saved.api,
      source: saved.source,
      confidence: saved.confidence,
      observedAt: saved.observedAt
    }
    r.recommendedApi = null
    r.installationPlan = { ...r.lastDetection, source: 'last-detection' }
    r.state = 'ready'
  }
  return scan
}
