/**
 * multiRoutePlanner.js — 多路由规划模块（薄入口）
 *
 * 统一引擎多路由安装规划主流程。统一引擎已在外层选好命中规则，此模块只负责
 * 执行该规则的 routes，逐 route 的操作构建、计划对象工厂、健康期望与生命周期
 * 列表均已下沉到 route/ 与 healthExpectations / lifecycleList 子模块。
 */

import fs from 'fs-extra'
import path from 'path'
import {
  createInstallPlanId,
  isPlainObject,
  normalizeRelativeRulePath,
  toSafeText
} from './contracts.js'
import {
  createCoverageLedger,
  createLedgerIndex,
  summarizeCoverageLedger
} from './coverageLedger.js'
import {
  INSTALL_ENGINE_ERROR_CODES,
  InstallEngineError
} from './installEngineError.js'
import { resolvePackageProfile } from './package-adapters/index.js'
import { resolveRouteTargetLocation } from './pathMapper.js'
import { evaluateCondition } from './conditionMatcher.js'
import { assemblePlan } from './planAssembler.js'
import { isPathInside, createPlanningPathChecker } from './pathSafety.js'
import { cleanupExpiredMaterializedRoots } from './routeMaterializer.js'
import { buildOperationsForRoute } from './route/routeOperationBuilder.js'
import { createRoutePlan } from './route/routePlanFactory.js'
import { mergeHealthExpectations } from './healthExpectations.js'
import { collectLifecycleList } from './lifecycleList.js'
import { buildRuleDependencies, resolveRuleIdentity } from './planningPipeline.js'
import {
  resolveRouteConflictPolicy,
  resolveRuleConflictPolicy,
  stampOperationsConflictPolicy
} from './conflictPolicyResolver.js'

const MATERIALIZED_ROOT_NAME = '__vertex_install_plan_v3__'

function normalizeSnapshotEntries(snapshot = {}) {
  const dirs = (Array.isArray(snapshot.allDirs) ? snapshot.allDirs : []).map((entry) => ({
    ...entry,
    type: 'dir',
    relativePath: normalizeRelativeRulePath(entry?.relativePath || entry?.name || '')
  }))
  const files = (Array.isArray(snapshot.allFiles) ? snapshot.allFiles : []).map((entry) => ({
    ...entry,
    type: 'file',
    relativePath: normalizeRelativeRulePath(entry?.relativePath || entry?.name || '')
  }))
  return [...dirs, ...files].filter(
    (entry) =>
      entry.relativePath &&
      !/^__(?:vertex_install_plan_v3|vertex_install_rule|vertex_nexus_rule)__(?:\/|$)/i.test(entry.relativePath)
  )
}

function normalizeRouteId(route = {}, ruleId = '', index = 0) {
  return (
    toSafeText(route?.id || route?.routeId || route?.name) ||
    `${toSafeText(ruleId) || 'rule'}__route_${index + 1}`
  )
}

/**
 * 构建多路由安装计划
 *
 * @param {object} rule - 命中的规则（已编译、已规范化，含 routes）
 * @param {object} snapshot - 暂存目录快照
 * @param {object} context - 引擎上下文
 * @param {object} meta - { candidates, missedReasons }
 * @returns {Promise<object>} InstallPlan
 */
export async function buildMultiRoutePlan(rule = {}, snapshot, context = {}, meta = {}) {
  const { ruleId, confidence } = resolveRuleIdentity(rule)
  const ruleConflictPolicy = resolveRuleConflictPolicy(rule)
  const routes = Array.isArray(rule.routes) ? rule.routes : []
  const routeConflictPolicies = routes.map((route) =>
    resolveRouteConflictPolicy(route, ruleConflictPolicy)
  )
  const stagingPath = path.resolve(toSafeText(context.stagingPath))

  // 准备物化目录
  const materializedContainerRoot = path.resolve(stagingPath, MATERIALIZED_ROOT_NAME)
  const materializedRoot = path.resolve(
    materializedContainerRoot,
    createInstallPlanId('materialized')
  )
  if (!isPathInside(materializedContainerRoot, materializedRoot)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
      '安装计划物化目录越界，已阻止安装'
    )
  }
  if (!(await createPlanningPathChecker()(stagingPath, materializedRoot))) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '安装计划私有目录真实路径越界')
  await cleanupExpiredMaterializedRoots(materializedContainerRoot, context)
  await fs.remove(materializedRoot)
  await fs.ensureDir(materializedRoot)
  if (!(await createPlanningPathChecker()(stagingPath, materializedRoot))) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '安装计划私有目录真实路径已变化')

  // 准备覆盖账本
  const allEntries = normalizeSnapshotEntries(snapshot)
  const routeEntryIndex = new Map(allEntries.map((entry) => [entry.relativePath.toLowerCase(), entry]))
  const snapshotForLedger = {
    ...snapshot,
    allDirs: allEntries.filter((e) => e.type === 'dir'),
    allFiles: allEntries.filter((e) => e.type === 'file')
  }
  const coverageLedger = createCoverageLedger(snapshotForLedger)
  const ledgerIndex = createLedgerIndex(coverageLedger)
  for (const ignored of context.declarativeIgnored || []) {
    const entry = ledgerIndex.get(ignored.sourceRelativePath.toLowerCase())
    if (entry && entry.status === 'unmatched') Object.assign(entry, { status: 'ignored', reason: ignored.reason })
  }

  // 包类型识别
  const packageResult = await resolvePackageProfile({
    ...context,
    candidateRoot: stagingPath,
    sourceRoot: stagingPath,
    snapshot
  })
  const packageProfile = packageResult.profile || {}

  // 逐 route 执行
  const routePlans = []
  const routeOperations = []
  const skippedRoutePlans = []
  const allOperations = []
  const internalConflicts = []
  const targetPathIndex = new Map()
  let targetBoundaryRoot = ''
  let targetBaseType = ''

  for (const [routeIndex, route] of routes.entries()) {
    const routeId = normalizeRouteId(route, ruleId, routeIndex)

    // route 级条件评估（可选）
    if (isPlainObject(route.when) || isPlainObject(route.match)) {
      const routeMatch = isPlainObject(route.when) ? route.when : route.match
      const routeEval = await evaluateCondition(routeMatch, {
        ...context,
        snapshot,
        candidateRoot: stagingPath
      })
      if (!routeEval.matched) {
        skippedRoutePlans.push({
          routeId,
          ruleId,
          matched: false,
          reason: routeEval.missedReason?.message || 'route 条件未命中',
          missedReason: routeEval.missedReason
            ? { ...routeEval.missedReason, routeId, ruleId }
            : null,
          checks: Array.isArray(routeEval.checks) ? routeEval.checks.slice(0, 5) : []
        })
        continue
      }
    }

    const targetLocation = await resolveRouteTargetLocation(route, context)
    if (!targetBoundaryRoot) {
      targetBoundaryRoot = targetLocation.targetBoundaryRoot
      targetBaseType = targetLocation.targetBaseType
    } else if (
      path.resolve(targetBoundaryRoot).toLowerCase() !==
        path.resolve(targetLocation.targetBoundaryRoot).toLowerCase() ||
      targetBaseType !== targetLocation.targetBaseType
    ) {
      throw new InstallEngineError(
        INSTALL_ENGINE_ERROR_CODES.RULE_TARGET_CONFLICT,
        '多路由规则暂不支持在同一个计划中跨目标边界合并 route'
      )
    }

    const result = await buildOperationsForRoute({
      route,
      routeId,
      ruleId,
      allEntries,
      targetLocation,
      materializedRoot,
      context: { ...context, routeEntryIndex },
      ledgerIndex,
      targetPathIndex
    })
    // per-route 冲突策略：route 覆盖 rule 默认，标记到该 route 产出的操作。
    stampOperationsConflictPolicy(result.operations, routeConflictPolicies[routeIndex])
    allOperations.push(...result.operations)
    internalConflicts.push(...result.internalConflicts)
    const routePlan = createRoutePlan(route, routeId, ruleId, targetLocation, result.operations)
    routePlans.push(routePlan)
    routeOperations.push({ routeId, ruleId, operations: result.operations })
  }

  if (!targetBoundaryRoot) {
    targetBoundaryRoot = path.resolve(toSafeText(context.gameRoot) || process.cwd())
    targetBaseType = 'game'
  }

  if (rule.declarative) {
    const children = new Map()
    for (const entry of coverageLedger) {
      const parent = path.posix.dirname(entry.sourceRelativePath).toLowerCase()
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(entry)
    }
    for (const directory of coverageLedger.filter((entry) => entry.type === 'dir').sort((a, b) => b.sourceRelativePath.length - a.sourceRelativePath.length)) {
      const entries = children.get(directory.sourceRelativePath.toLowerCase()) || []
      if (directory.status === 'unmatched' && entries.length && entries.every((entry) => ['installed', 'ignored', 'duplicate'].includes(entry.status))) Object.assign(directory, { status: 'ignored', reason: '目录下全部条目已有明确去向' })
    }
  }
  const coverageSummary = summarizeCoverageLedger(coverageLedger)

  // 组装完整计划
  return await assemblePlan({
    rule,
    ruleId,
    confidence,
    operations: allOperations,
    routePlans,
    skippedRoutePlans,
    routeOperations,
    coverageLedger,
    coverageSummary,
    internalConflicts,
    packageProfile,
    context,
    meta,
    mode: 'multi_route',
    plannerMode: 'unified_multi_route',
    sourceRoot: materializedRoot,
    lifecycleStagingRoot: stagingPath,
    targetRoot: targetBoundaryRoot,
    targetBaseType,
    healthExpectations: mergeHealthExpectations(routePlans),
    postInstallSteps: collectLifecycleList(rule, 'post_install', 'postInstall'),
    onEnableSteps: collectLifecycleList(rule, 'on_enable', 'onEnable'),
    onDisableSteps: collectLifecycleList(rule, 'on_disable', 'onDisable'),
    onUninstallSteps: collectLifecycleList(rule, 'on_uninstall', 'onUninstall'),
    dependencies: buildRuleDependencies(rule, packageProfile)
  })
}
