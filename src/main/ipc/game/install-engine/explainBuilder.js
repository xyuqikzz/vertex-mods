import { isPlainObject, toSafeNumber, toSafeText } from './contracts.js'
import { COVERAGE_LEDGER_STATUS, summarizeCoverageLedger } from './coverageLedger.js'

export function buildCandidateSummary(candidateList = []) {
  return (Array.isArray(candidateList) ? candidateList : []).map((item) => {
    const evaluation = isPlainObject(item?.evaluation) ? item.evaluation : {}
    return {
      ruleId: toSafeText(item?.ruleId || evaluation.ruleId),
      matched: item?.matched === true || evaluation.matched === true,
      score: toSafeNumber(item?.score ?? evaluation.score, 0),
      confidence: toSafeNumber(item?.confidence ?? evaluation.confidence, 0),
      reason: toSafeText(item?.reason || evaluation.reason),
      risks: Array.isArray(evaluation.risks) ? evaluation.risks : []
    }
  })
}

/**
 * 统一构建 explain（single_target / multi_route 两种模式分支单源），
 * 由 planAssembler 调用，避免 explain 细节在组装层内联分散。
 */
export function buildExplain(payload = {}) {
  const { mode, ruleId, candidates, missedReasons, coverageLedger, routePlans, skippedRoutePlans, context } =
    payload
  const diagnostics = context && context.logger ? context.logger.getLogs() : []

  if (mode === 'multi_route') {
    const coverageSummary = summarizeCoverageLedger(coverageLedger || [])
    const matchedRoutes = (routePlans || []).map((rp) => ({
      routeId: rp.routeId,
      ruleId: rp.ruleId,
      matched: true,
      operationCount: (rp.operations || []).length
    }))
    const skippedRoutes = (skippedRoutePlans || []).map((rp) => ({
      routeId: rp.routeId,
      ruleId: rp.ruleId,
      matched: false,
      operationCount: 0,
      reason: rp.reason || rp.missedReason?.message || 'route 条件未命中',
      missedReason: rp.missedReason || null,
      checks: Array.isArray(rp.checks) ? rp.checks : []
    }))
    return {
      mode: 'unified_multi_route',
      matchedRuleId: toSafeText(ruleId),
      matchedRuleIds: [toSafeText(ruleId)],
      candidateCount: (candidates || []).length,
      checkedRules: buildCandidateSummary(candidates || []),
      routes: [...matchedRoutes, ...skippedRoutes],
      matchedSignals: [],
      missedReasons: missedReasons || [],
      coverageSummary,
      fileCoverageRatio: coverageSummary.coverageRatio,
      unmatchedFiles: (coverageLedger || [])
        .filter((item) => item.type === 'file' && item.status === COVERAGE_LEDGER_STATUS.UNMATCHED)
        .slice(0, 50),
      fallback: [],
      diagnostics
    }
  }

  // single_target mode
  return {
    mode: 'unified_single_target',
    matchedRuleId: toSafeText(ruleId),
    score: 0,
    confidence: toSafeNumber(payload.confidence, 80),
    candidateCount: (candidates || []).length,
    checkedRules: buildCandidateSummary(candidates || []),
    matchedSignals: [],
    missedReasons: missedReasons || [],
    fallback: [],
    selectedReason: '按优先级首条命中',
    diagnostics
  }
}
