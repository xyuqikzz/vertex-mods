import { isPlainObject, normalizeTextList, toSafeNumber, toSafeText } from '../contracts.js'
import { matchGlobPattern } from '../globMatcher.js'

export function normalizeSnapshotEntries(snapshot = {}) {
  const safeSnapshot = isPlainObject(snapshot) ? snapshot : {}
  return {
    allFiles: (Array.isArray(safeSnapshot.allFiles) ? safeSnapshot.allFiles : []).map((item) => ({
      ...item,
      relativePath: toSafeText(item?.relativePath || item?.path || item?.name).replace(/\\/g, '/'),
      lowerPath: toSafeText(item?.relativePath || item?.path || item?.name)
        .replace(/\\/g, '/')
        .toLowerCase()
    })),
    allDirs: (Array.isArray(safeSnapshot.allDirs) ? safeSnapshot.allDirs : []).map((item) => ({
      ...item,
      relativePath: toSafeText(item?.relativePath || item?.path || item?.name).replace(/\\/g, '/'),
      lowerPath: toSafeText(item?.relativePath || item?.path || item?.name)
        .replace(/\\/g, '/')
        .toLowerCase()
    }))
  }
}

export function hasAnyFile(snapshot = {}, patterns = []) {
  const entries = normalizeSnapshotEntries(snapshot).allFiles
  return normalizeTextList(patterns, { pathLike: true }).some((pattern) =>
    entries.some((entry) => matchGlobPattern(pattern, entry.relativePath))
  )
}

export function hasAnyDir(snapshot = {}, patterns = []) {
  const entries = normalizeSnapshotEntries(snapshot).allDirs
  return normalizeTextList(patterns, { pathLike: true }).some((pattern) =>
    entries.some((entry) => matchGlobPattern(pattern, entry.relativePath))
  )
}

export function createPackageProfile(payload = {}) {
  return {
    type: toSafeText(payload.type || 'generic') || 'generic',
    adapter: toSafeText(payload.adapter || payload.type || 'generic') || 'generic',
    confidence: Math.max(0, Math.min(100, toSafeNumber(payload.confidence, 0))),
    signals: Array.isArray(payload.signals) ? payload.signals : [],
    suggestedTarget: toSafeText(payload.suggestedTarget || payload.suggested_target),
    dependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
    provides: normalizeTextList(payload.provides),
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    healthExpectations: isPlainObject(payload.healthExpectations) ? payload.healthExpectations : {}
  }
}

export async function detectPackageProfile(snapshot = {}, context = {}) {
  const fileCount = Array.isArray(snapshot.allFiles) ? snapshot.allFiles.length : 0
  return createPackageProfile({
    type: 'generic',
    adapter: 'generic',
    confidence: fileCount > 0 ? 10 : 0,
    signals: fileCount > 0 ? [{ code: 'archive_has_files', message: '压缩包包含可部署文件' }] : [],
    suggestedTarget: toSafeText(context.defaultTarget || '.'),
    provides: []
  })
}
