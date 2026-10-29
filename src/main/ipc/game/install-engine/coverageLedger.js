import {
  normalizeRelativeRulePath,
  toSafeNumber,
  toSafeText
} from './contracts.js'
import { normalizeSafeRelativePath } from './pathSafety.js'

export const COVERAGE_LEDGER_STATUS = Object.freeze({
  INSTALLED: 'installed',
  IGNORED: 'ignored',
  UNMATCHED: 'unmatched',
  CONFLICT: 'conflict',
  UNSAFE: 'unsafe',
  DUPLICATE: 'duplicate',
  DEPENDENCY_PENDING: 'dependency_pending',
  GROUP_INCOMPLETE: 'group_incomplete'
})

function normalizeLedgerKey(relativePath = '') {
  return normalizeRelativeRulePath(relativePath).toLowerCase()
}

function isUnsafeRelativePath(relativePath = '') {
  try {
    normalizeSafeRelativePath(relativePath, {
      errorMessage: '源路径不安全'
    })
    return false
  } catch {
    return true
  }
}

export function createCoverageLedger(snapshot = {}) {
  const allDirs = Array.isArray(snapshot.allDirs) ? snapshot.allDirs : []
  const allFiles = Array.isArray(snapshot.allFiles) ? snapshot.allFiles : []
  const ledger = []
  const seen = new Set()

  // P4：按类型分别遍历（dir 先于 file，去重语义与原实现一致），
  // 取代原 `allDirs.includes(entry)` 的 O(n²) 类型判定，降为 O(n)。
  const collect = (entries, type) => {
    for (const entry of entries) {
      const sourceRelativePath = normalizeRelativeRulePath(entry?.relativePath || entry?.name || '')
      if (!sourceRelativePath) {
        continue
      }

      const key = normalizeLedgerKey(sourceRelativePath)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      const unsafe = isUnsafeRelativePath(sourceRelativePath)
      ledger.push({
        sourceRelativePath,
        type,
        status: unsafe ? COVERAGE_LEDGER_STATUS.UNSAFE : COVERAGE_LEDGER_STATUS.UNMATCHED,
        routeId: '',
        ruleId: '',
        targetRelativePath: '',
        reason: unsafe ? '源路径不安全，已拒绝安装' : '',
        size: toSafeNumber(entry?.size, 0)
      })
    }
  }

  collect(allDirs, 'dir')
  collect(allFiles, 'file')

  return ledger
}

export function createLedgerIndex(ledger = []) {
  const index = new Map()
  for (const item of Array.isArray(ledger) ? ledger : []) {
    const key = normalizeLedgerKey(item?.sourceRelativePath)
    if (key) {
      index.set(key, item)
    }
  }
  return index
}

export function updateLedgerEntry(index = new Map(), relativePath = '', patch = {}) {
  const key = normalizeLedgerKey(relativePath)
  const entry = index.get(key)
  if (!entry) {
    return null
  }

  Object.assign(entry, {
    ...patch,
    status: toSafeText(patch.status || entry.status) || entry.status,
    routeId: toSafeText(patch.routeId ?? entry.routeId),
    ruleId: toSafeText(patch.ruleId ?? entry.ruleId),
    targetRelativePath: toSafeText(patch.targetRelativePath ?? entry.targetRelativePath),
    reason: toSafeText(patch.reason ?? entry.reason)
  })
  return entry
}

export function summarizeCoverageLedger(ledger = []) {
  const summary = {
    totalCount: 0,
    fileCount: 0,
    dirCount: 0,
    installedCount: 0,
    ignoredCount: 0,
    unmatchedCount: 0,
    conflictCount: 0,
    unsafeCount: 0,
    duplicateCount: 0,
    dependencyPendingCount: 0,
    groupIncompleteCount: 0
  }

  for (const item of Array.isArray(ledger) ? ledger : []) {
    summary.totalCount += 1
    if (item?.type === 'dir') {
      summary.dirCount += 1
    } else {
      summary.fileCount += 1
    }

    const status = toSafeText(item?.status).toLowerCase()
    if (status === COVERAGE_LEDGER_STATUS.INSTALLED) summary.installedCount += 1
    else if (status === COVERAGE_LEDGER_STATUS.IGNORED) summary.ignoredCount += 1
    else if (status === COVERAGE_LEDGER_STATUS.CONFLICT) summary.conflictCount += 1
    else if (status === COVERAGE_LEDGER_STATUS.UNSAFE) summary.unsafeCount += 1
    else if (status === COVERAGE_LEDGER_STATUS.DUPLICATE) summary.duplicateCount += 1
    else if (status === COVERAGE_LEDGER_STATUS.DEPENDENCY_PENDING) {
      summary.dependencyPendingCount += 1
    } else if (status === COVERAGE_LEDGER_STATUS.GROUP_INCOMPLETE) {
      summary.groupIncompleteCount += 1
    } else {
      summary.unmatchedCount += 1
    }
  }

  summary.coveredCount = summary.installedCount + summary.ignoredCount + summary.duplicateCount
  summary.coverageRatio = summary.totalCount
    ? Number((summary.coveredCount / summary.totalCount).toFixed(4))
    : 1
  return summary
}

/**
 * 构建前端可直接消费的覆盖可视化报告（P3：coverage 可视化）。
 *
 * 在 summarizeCoverageLedger 的统计之上，额外按状态抽取需要用户关注的条目样本
 * （UNMATCHED / CONFLICT / UNSAFE），供前端高亮展示「哪些源条目未被安装/冲突/不安全」。
 * 纯函数、零副作用，不改变任何既有计划输出。
 *
 * @param {Array} ledger 覆盖账本
 * @param {object} options { sampleLimit }
 * @returns {{ summary: object, highlights: { unmatched: array, conflict: array, unsafe: array } }}
 */
export function buildCoverageReport(ledger = [], options = {}) {
  const safeLedger = Array.isArray(ledger) ? ledger : []
  const sampleLimit = Math.max(1, Math.min(200, toSafeNumber(options.sampleLimit, 50)))

  const sampleByStatus = (status) =>
    safeLedger
      .filter((item) => toSafeText(item?.status).toLowerCase() === status)
      .slice(0, sampleLimit)
      .map((item) => ({
        sourceRelativePath: toSafeText(item?.sourceRelativePath),
        type: toSafeText(item?.type),
        targetRelativePath: toSafeText(item?.targetRelativePath),
        routeId: toSafeText(item?.routeId),
        ruleId: toSafeText(item?.ruleId),
        reason: toSafeText(item?.reason)
      }))

  return {
    summary: summarizeCoverageLedger(safeLedger),
    highlights: {
      unmatched: sampleByStatus(COVERAGE_LEDGER_STATUS.UNMATCHED),
      conflict: sampleByStatus(COVERAGE_LEDGER_STATUS.CONFLICT),
      unsafe: sampleByStatus(COVERAGE_LEDGER_STATUS.UNSAFE)
    }
  }
}
