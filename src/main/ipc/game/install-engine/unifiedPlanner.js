import { createInstallEngineContext, toSafeText } from './contracts.js'
import { compileInstallRule } from './compiler.js'
import { evaluateCondition } from './conditionMatcher.js'
import { buildSingleTargetPlan } from './singleTargetPlanner.js'
import { buildMultiRoutePlan } from './multiRoutePlanner.js'
import { collectTopLevelSnapshot, ensureDirectory, ensureRecursiveSnapshot } from './fsSnapshot.js'
import { InstallEngineError, isRecoverablePlanningError, normalizeInstallEngineError } from './installEngineError.js'
import { StructuredLogger } from './structuredLog.js'
import { resolveRuleIdentity } from './planningPipeline.js'
import { prepareDeclarativeRule } from './declarativePlanner.js'

function getRuleDiagnosticsByIndex(diagnostics = []) {
  const result = new Map()
  for (const item of Array.isArray(diagnostics) ? diagnostics : []) {
    const match = toSafeText(item?.path).match(/^install_rules\[(\d+)\]/)
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isInteger(index)) continue
    if (!result.has(index)) result.set(index, [])
    result.get(index).push(item)
  }
  return result
}

function isRuleDiagnostic(diagnostic = {}) {
  return /^install_rules\[\d+\]/.test(toSafeText(diagnostic?.path))
}

function createSchemaMissedReason(ruleId = '', diagnostics = []) {
  const firstMessage = toSafeText(diagnostics[0]?.message || '规则 Schema 校验失败')
  return {
    ruleId,
    code: 'schema_validation_error',
    message: firstMessage,
    details: {
      diagnostics
    }
  }
}

export function hasUnifiedInstallRuleCapability(installRule = {}) {
  const compiled = compileInstallRule(installRule)
  const rules = Array.isArray(compiled.install_rules) ? compiled.install_rules : []
  return rules.length > 0
}

export function createUnifiedInstallPlanContext(payload = {}) {
  const snapshotCache = payload.snapshotCache instanceof Map ? payload.snapshotCache : new Map()
  return createInstallEngineContext({
    ...payload,
    snapshotCache
  })
}

export async function resolveUnifiedInstallPlan(payload = {}) {
  const context = createUnifiedInstallPlanContext(payload)
  const logger = new StructuredLogger()
  context.logger = logger

  let compiled
  try {
    compiled = compileInstallRule(context.installRule || {})
  } catch (error) {
    logger.error('schema_validation', `编译规则时遇到阻断错误: ${error.message}`, { context: { payload } })
    throw error
  }

  const rules = Array.isArray(compiled.install_rules) ? compiled.install_rules : []
  const schemaDiagnostics = compiled.schemaDiagnostics || {}
  context.ruleTemplates = compiled.template_versions || []
  const schemaWarnings = Array.isArray(schemaDiagnostics.warnings) ? schemaDiagnostics.warnings : []
  if (schemaWarnings.length > 0) {
    logger.warn('schema_validation', `编译规则存在 Schema 警告`, { checks: schemaWarnings })
  }
  const schemaTopLevelErrors = Array.isArray(schemaDiagnostics.errors)
    ? schemaDiagnostics.errors.filter((item) => !isRuleDiagnostic(item))
    : []
  const schemaPlanWarnings = [...schemaWarnings, ...schemaTopLevelErrors]
  const schemaErrorsByIndex = getRuleDiagnosticsByIndex(schemaDiagnostics.errors || [])

  if (!rules.length) return null

  const stagingPath = toSafeText(context.stagingPath)
  if (!stagingPath || !(await ensureDirectory(stagingPath))) {
    throw new Error('安装暂存目录不存在，无法执行统一规则规划')
  }

  const snapshot = await collectTopLevelSnapshot(stagingPath, context.snapshotCache, { excludeInstallInternal: true })
  const sorted = [...rules].sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0)
    if (priorityDiff !== 0) return priorityDiff
    return resolveRuleIdentity(b).confidence - resolveRuleIdentity(a).confidence
  })
  const candidates = []
  const missedReasons = []

  for (const rule of sorted) {
    const { ruleId, confidence } = resolveRuleIdentity(rule)
    const ruleIndex = rules.indexOf(rule)
    const ruleSchemaErrors = schemaErrorsByIndex.get(ruleIndex) || []
    if (ruleSchemaErrors.length) {
      const missedReason = createSchemaMissedReason(ruleId, ruleSchemaErrors)
      candidates.push({
        ruleId,
        rule,
        matched: false,
        evaluation: {
          matched: false,
          checks: [],
          missedReason
        },
        priority: rule.priority || 0,
        confidence,
        reason: missedReason.message
      })
      missedReasons.push(missedReason)
      continue
    }

    const evaluation = rule.declarative && rule.match === undefined
      ? { matched: true, checks: [] }
      : await evaluateCondition(rule.match, {
      snapshot,
      gameRoot: context.gameRoot,
      candidateRoot: stagingPath,
      snapshotCache: context.snapshotCache,
      logger: context.logger
    }, { mode: 'fast', ruleId })

    candidates.push({
      ruleId,
      rule,
      matched: evaluation.matched,
      evaluation,
      priority: rule.priority || 0,
      confidence,
      reason: evaluation.matched
        ? '规则条件全部命中'
        : evaluation.missedReason?.message || '规则条件未命中'
    })

    if (!evaluation.matched) {
      if (evaluation.missedReason) {
        missedReasons.push({ ...evaluation.missedReason, ruleId })
      }
      continue
    }

    try {
      const recursiveSnapshot = await ensureRecursiveSnapshot(snapshot, context.snapshotCache)
      const planMeta = { candidates, missedReasons, schemaWarnings: schemaPlanWarnings }
      const prepared = await prepareDeclarativeRule(rule, recursiveSnapshot, context)
      if (!prepared.matched) continue
      const preparedContext = { ...context, declarativeReplay: prepared.replay, declarativeIgnored: prepared.ignored,
        installedCapabilities: { ...context.installedCapabilities, records: [...(context.installedCapabilities?.records || []), ...(prepared.providedCapabilities || [])] } }
      if (Array.isArray(prepared.rule.routes) && prepared.rule.routes.length > 0) {
        const plan = await buildMultiRoutePlan(prepared.rule, prepared.snapshot || recursiveSnapshot, preparedContext, planMeta)
        if (rule.declarative) {
          if (prepared.replay?.units?.some((unit) => unit.dependencies?.length) && plan.dependencyResult?.status === 'blocked') {
            throw new InstallEngineError('install_engine.dependency_blocked', '所选安装单元缺少必要依赖或存在冲突，请先处理依赖', { dependencyResult: plan.dependencyResult })
          }
          const unhandled = (plan.coverageLedger || []).filter((entry) => entry.status === 'unmatched')
          if (unhandled.length) {
            throw new InstallEngineError('install_engine.unhandled_files', `仍有 ${unhandled.length} 个文件或目录未说明安装或忽略方式：${unhandled.slice(0, 3).map((entry) => entry.sourceRelativePath).join('、')}`, { files: unhandled.slice(0, 100).map((entry) => entry.sourceRelativePath) })
          }
        }
        return plan
      }
      return await buildSingleTargetPlan(prepared.rule, recursiveSnapshot, preparedContext, planMeta)
    } catch (error) {
      const safeError = normalizeInstallEngineError(error)
      if (rule.declarative) throw safeError
      if (!isRecoverablePlanningError(safeError)) {
        throw safeError
      }

      console.warn(`统一引擎规则 ${ruleId} 构建计划失败:`, safeError.message)
      missedReasons.push({
        ruleId,
        code: safeError.code || 'plan_build_error',
        message: `规则命中但构建计划失败: ${toSafeText(safeError.message || '未知错误')}`,
        details: safeError.detail || {}
      })
    }
  }

  return null
}
