import { isPlainObject, toPlainJson, toSafeNumber, toSafeText } from './contracts.js'
import { compileInstallRule } from './compiler.js'
import { evaluateCondition } from './conditionMatcher.js'
import { collectTopLevelSnapshot, ensureRecursiveSnapshot } from './fsSnapshot.js'
import { sanitizeErrorMessage } from './installEngineError.js'
import { resolveUnifiedInstallPlan } from './unifiedPlanner.js'

function normalizeExpectation(expect = {}) {
  return isPlainObject(expect) ? expect : {}
}

/**
 * 从快照中提取可安全序列化的目录树摘要（不含本机绝对路径）
 * @param {object} snapshot - 快照对象
 * @returns {object} 目录树摘要
 */
function summarizeSnapshotTree(snapshot = {}) {
  const directEntries = Array.isArray(snapshot.directEntries) ? snapshot.directEntries : []
  const allFiles = Array.isArray(snapshot.allFiles) ? snapshot.allFiles : []
  const allDirs = Array.isArray(snapshot.allDirs) ? snapshot.allDirs : []
  const directDirs = Array.isArray(snapshot.directDirs) ? snapshot.directDirs : []
  const directFiles = Array.isArray(snapshot.directFiles) ? snapshot.directFiles : []

  const extensionCounts = {}
  for (const file of allFiles) {
    const ext = toSafeText(file.ext || '').toLowerCase() || '(no ext)'
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1
  }

  return {
    directEntryCount: directEntries.length,
    directDirCount: directDirs.length,
    directFileCount: directFiles.length,
    totalFileCount: allFiles.length,
    totalDirCount: allDirs.length,
    recursiveLoaded: snapshot.recursiveLoaded === true,
    topLevelDirs: directDirs.slice(0, 30).map((d) => toSafeText(d.name || d.relativePath || '')),
    topLevelFiles: directFiles.slice(0, 30).map((f) => toSafeText(f.name || f.relativePath || '')),
    extensionDistribution: extensionCounts
  }
}

/**
 * 采集每条规则的独立评估记录（含耗时、命中结果、失败 checks）
 *
 * @param {Array} rules - 编译后的规则列表
 * @param {object} snapshot - 递归快照
 * @param {object} context - 评估上下文
 * @returns {Promise<Array>} 每条规则的评估记录
 */
async function collectRuleEvaluationTrace(rules = [], snapshot = {}, context = {}) {
  const trace = []
  for (const rule of rules) {
    const ruleId = toSafeText(rule.id || rule.name || 'unknown')
    const ruleStartedAt = Date.now()
    let evaluation
    try {
      evaluation = rule.declarative && rule.match === undefined ? { matched: true, checks: [] } : await evaluateCondition(rule.match, {
        snapshot,
        gameRoot: context.gameRoot,
        candidateRoot: context.stagingPath,
        snapshotCache: context.snapshotCache
      }, { mode: 'explain', ruleId })
    } catch (evalError) {
      trace.push({
        ruleId,
        priority: toSafeNumber(rule.priority, 0),
        confidence: toSafeNumber(rule.confidence, 80),
        matched: false,
        durationMs: Date.now() - ruleStartedAt,
        error: sanitizeErrorMessage(evalError?.message || String(evalError)),
        failedChecks: []
      })
      continue
    }

    const failedChecks = Array.isArray(evaluation.checks)
      ? evaluation.checks
          .filter((c) => c.matched !== true)
          .slice(0, 10)
          .map((c) => ({
            kind: toSafeText(c.kind),
            path: toSafeText(c.path),
            expected: c.expected ?? null,
            actual: c.actual ?? null,
            suggestion: toSafeText(c.suggestion),
            message: sanitizeErrorMessage(toSafeText(c.message))
          }))
      : []

    trace.push({
      ruleId,
      priority: toSafeNumber(rule.priority, 0),
      confidence: toSafeNumber(rule.confidence, 80),
      matched: evaluation.matched === true,
      durationMs: Date.now() - ruleStartedAt,
      checksTotal: Array.isArray(evaluation.checks) ? evaluation.checks.length : 0,
      failedChecks
    })
  }
  return trace
}

export async function runInstallEngineReplaySample(sample = {}) {
  const context = isPlainObject(sample.context) ? sample.context : sample
  const expect = normalizeExpectation(sample.expect || sample.expected)
  const startedAt = Date.now()

  // 回放增强：采集快照摘要和规则评估轨迹
  let snapshotSummary = null
  let ruleEvaluationTrace = null
  try {
    if (context.stagingPath && context.installRule) {
      const snapshotCache = context.snapshotCache instanceof Map ? context.snapshotCache : new Map()
      const topSnapshot = await collectTopLevelSnapshot(toSafeText(context.stagingPath), snapshotCache)
      const recursiveSnapshot = await ensureRecursiveSnapshot(topSnapshot, snapshotCache)
      snapshotSummary = summarizeSnapshotTree(recursiveSnapshot)

      const compiled = compileInstallRule(context.installRule)
      const rules = Array.isArray(compiled.install_rules) ? compiled.install_rules : []
      ruleEvaluationTrace = await collectRuleEvaluationTrace(rules, recursiveSnapshot, {
        ...context,
        snapshotCache
      })
    }
  } catch {
    // 增强数据采集失败不影响主流程
  }

  try {
    const plan = await resolveUnifiedInstallPlan(context)
    const matched = !!plan
    const targetRelativePaths = [
      toSafeText(plan?.targetRelativePath),
      ...(Array.isArray(plan?.routes) ? plan.routes.map((item) => toSafeText(item?.targetRelativePath)) : [])
    ].filter(Boolean)
    const operationRelativePaths = (
      Array.isArray(plan?.operations) ? plan.operations : []
    )
      .map((item) => toSafeText(item?.relativePath || item?.relativeTargetPath))
      .filter(Boolean)
    const ruleMatched =
      !expect.ruleId ||
      toSafeText(plan?.ruleId).toLowerCase() === toSafeText(expect.ruleId).toLowerCase()
    const targetMatched =
      !expect.targetRelativePath ||
      targetRelativePaths.some(
        (item) => item.toLowerCase() === toSafeText(expect.targetRelativePath).toLowerCase()
      )
    const routeMatched =
      !expect.routeId ||
      (Array.isArray(plan?.routes) ? plan.routes : []).some(
        (item) => toSafeText(item?.routeId).toLowerCase() === toSafeText(expect.routeId).toLowerCase()
      )
    const operationMatched =
      !expect.operationRelativePath ||
      operationRelativePaths.some(
        (item) => item.toLowerCase() === toSafeText(expect.operationRelativePath).toLowerCase()
      )
    const passed =
      matched === (expect.matched !== false) &&
      ruleMatched &&
      targetMatched &&
      routeMatched &&
      operationMatched &&
      (!Array.isArray(expect.operationRelativePaths) || JSON.stringify([...operationRelativePaths].sort()) === JSON.stringify([...expect.operationRelativePaths].sort())) &&
      (expect.unmatchedFileCount === undefined || (plan?.coverageLedger || []).filter((entry) => entry.type === 'file' && entry.status === 'unmatched').length === expect.unmatchedFileCount)

    return {
      sampleId: toSafeText(sample.sampleId || sample.id || context.sampleId),
      passed,
      matched,
      durationMs: Date.now() - startedAt,
      expected: toPlainJson(expect, {}),
      actual: {
        ruleId: toSafeText(plan?.ruleId),
        targetRelativePath: toSafeText(plan?.targetRelativePath),
        targetRelativePaths,
        routeIds: (Array.isArray(plan?.routes) ? plan.routes : [])
          .map((item) => toSafeText(item?.routeId))
          .filter(Boolean),
        operationRelativePaths,
        strategy: toSafeText(plan?.strategy),
        plannerMode: toSafeText(plan?.planner?.mode || plan?.explain?.mode)
      },
      replaySnapshot: {
        snapshotSummary,
        ruleEvaluationTrace
      },
      plan: toPlainJson(plan, null)
    }
  } catch (error) {
    return {
      sampleId: toSafeText(sample.sampleId || sample.id || context.sampleId),
      passed: expect.error === true && (!expect.errorCode || expect.errorCode === error.code),
      errorCode: error.code || '',
      matched: false,
      durationMs: Date.now() - startedAt,
      error: sanitizeErrorMessage(toSafeText(error?.message || error)),
      expected: toPlainJson(expect, {}),
      replaySnapshot: {
        snapshotSummary,
        ruleEvaluationTrace
      }
    }
  }
}

export async function runInstallEngineReplaySamples(samples = []) {
  const records = []
  for (const sample of Array.isArray(samples) ? samples : []) {
    records.push(await runInstallEngineReplaySample(sample))
  }
  return {
    passed: records.every((item) => item.passed),
    total: records.length,
    failed: records.filter((item) => !item.passed).length,
    records
  }
}
