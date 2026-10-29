/**
 * planAssembler.js — 共享计划组装模块
 *
 * 无论单目标还是多路由，最终都走同一个计划组装流程：
 * basePlan → changeSet → conflict → deploy → dependency → transaction → final plan
 */

import { previewManagedConfigs } from './managedConfigJournal.js'
import path from 'node:path'
import { InstallEngineError } from './installEngineError.js'
import { resolveTargetBoundaryRoot } from './targetResolver.js'
import {
  SOURCE_INSTALL_PLANNER_VERSION,
  createInstallPlan,
  toSafeNumber,
  toSafeText
} from './contracts.js'
import { analyzePlanConflicts } from './conflictAnalyzer.js'
import { solveInstallDependencies } from './dependencySolver.js'
import { resolveDeployStrategy } from './deployStrategyResolver.js'
import { buildPlanChangeSet } from './planChangeSet.js'
import { buildTransactionPlan } from './transactionPlanner.js'
import { buildExplain } from './explainBuilder.js'
import { summarizeCoverageLedger } from './coverageLedger.js'
import { createEmptyConflictResult } from './contracts.js'
import { validatePlanCompleteness } from './planValidator.js'
import { collectLifecycleList } from './lifecycleList.js'
import { buildHealthExpectations } from './healthExpectations.js'
import { buildRuleDependencies } from './planningPipeline.js'
import { PLAN_STAGE, runPlanStage } from './planStageRunner.js'

function mergeConflictResults(externalResult = {}, internalConflicts = []) {
  if (!internalConflicts.length) return externalResult

  const conflicts = [
    ...(Array.isArray(externalResult.conflicts) ? externalResult.conflicts : []),
    ...internalConflicts
  ]
  const warnings = Array.isArray(externalResult.warnings) ? externalResult.warnings : []
  const blockerCount = conflicts.filter((item) => item.level === 'blocker').length
  const level =
    blockerCount > 0
      ? 'blocker'
      : externalResult.level || (conflicts.length || warnings.length ? 'warning' : 'none')

  return createEmptyConflictResult({
    ...externalResult,
    status: externalResult.status || 'completed',
    level,
    conflicts,
    warnings,
    requiresUserConfirm:
      externalResult.requiresUserConfirm === true || conflicts.length > 0 || warnings.length > 0,
    blockInstall: externalResult.blockInstall === true || blockerCount > 0,
    summary: {
      warningCount:
        warnings.length + conflicts.filter((item) => item.level && item.level !== 'blocker').length,
      blockerCount,
      conflictCount: conflicts.length
    }
  })
}

/**
 * 统一计划组装
 *
 * @param {object} payload - 包含所有构建计划所需的数据
 * @returns {Promise<object>} 完整的 InstallPlan
 */
export async function assemblePlan(payload = {}) {
  const {
    rule = {},
    ruleId = '',
    confidence = 80,
    operations = [],
    routePlans,
    skippedRoutePlans,
    routeOperations,
    coverageLedger,
    coverageSummary: inputCoverageSummary,
    internalConflicts = [],
    sourceSelection,
    targetLocation,
    packageProfile = {},
    context = {},
    meta = {},
    mode = 'single_target',
    plannerMode = 'unified',
    sourceRoot: explicitSourceRoot,
    lifecycleStagingRoot: explicitLifecycleStagingRoot,
    targetRoot: explicitTargetRoot,
    targetBaseType: explicitTargetBaseType,
    healthExpectations: explicitHealthExpectations,
    postInstallSteps: explicitPostInstallSteps,
    onEnableSteps: explicitOnEnableSteps,
    onDisableSteps: explicitOnDisableSteps,
    onUninstallSteps: explicitOnUninstallSteps,
    dependencies: explicitDependencies
  } = payload

  const candidates = meta.candidates || []
  const missedReasons = meta.missedReasons || []
  const schemaWarnings = Array.isArray(meta.schemaWarnings) ? meta.schemaWarnings : []

  // 解析源和目标（单目标模式从 sourceSelection/targetLocation 取，多路由模式从显式参数取）
  const sourceRoot = explicitSourceRoot || (sourceSelection ? sourceSelection.sourceRoot : '')
  const lifecycleStagingRoot =
    explicitLifecycleStagingRoot ||
    (sourceSelection ? sourceSelection.lifecycleStagingRoot : sourceRoot)
  const targetRoot = explicitTargetRoot || (targetLocation ? targetLocation.targetRoot : '')
  const targetRelativePath = targetLocation ? targetLocation.targetRelativePath : '.'
  const targetBaseType =
    explicitTargetBaseType || (targetLocation ? targetLocation.targetBaseType : 'game')

  // 生命周期
  const postInstallSteps =
    explicitPostInstallSteps || collectLifecycleList(rule, 'post_install', 'postInstall')
  const onEnableSteps =
    explicitOnEnableSteps || collectLifecycleList(rule, 'on_enable', 'onEnable')
  const onDisableSteps =
    explicitOnDisableSteps || collectLifecycleList(rule, 'on_disable', 'onDisable')
  const onUninstallSteps =
    explicitOnUninstallSteps || collectLifecycleList(rule, 'on_uninstall', 'onUninstall')

  // 依赖
  const dependencies = explicitDependencies || buildRuleDependencies(rule, packageProfile)

  // 健康期望
  const healthExpectations =
    explicitHealthExpectations || buildHealthExpectations(rule, packageProfile, sourceSelection)

  // 覆盖摘要
  const coverageSummary =
    inputCoverageSummary || (coverageLedger ? summarizeCoverageLedger(coverageLedger) : {})

  // 构建基础计划
  const config = context.declarativeReplay?.config || []
  if (config.length) {
    for (const patch of config) {
      const { targetBoundaryRoot } = await resolveTargetBoundaryRoot(patch.base || 'game', context.gameRoot)
      const target = path.resolve(targetBoundaryRoot, patch.path).toLowerCase()
      if (operations.some((operation) => operation.kind !== 'dir' && path.resolve(operation.targetPath).toLowerCase() === target)) {
        throw new InstallEngineError('install_engine.config_conflict', '配置合并目标不能同时由普通文件部署覆盖')
      }
    }
    context.declarativeReplay.configEvidence = await previewManagedConfigs(config, context.gameRoot, context.managedConfigContext)
  }
  const basePlan = createInstallPlan({
    planSchemaVersion: 4,
    plannerVersion: SOURCE_INSTALL_PLANNER_VERSION,
    source: context.source,
    sourceAdapter: `${context.source || 'source'}_unified`,
    strategy: `unified_engine:${ruleId}`,
    ruleId,
    confidence,
    planner: {
      mode: plannerMode,
      version: SOURCE_INSTALL_PLANNER_VERSION,
      fallbackUsed: false,
      selectedRuleId: ruleId
    },
    sourceRoot,
    lifecycleStagingRoot,
    targetRoot,
    targetRelativePath,
    targetBaseType,
    operations,
    routes: routePlans || [],
    routeOperations: routeOperations || [],
    coverageLedger: coverageLedger || [],
    coverageSummary,
    dependencies,
    usageType: targetLocation ? targetLocation.usageType : targetBaseType === 'download' ? 2 : 1,
    isRunnable: targetLocation ? targetLocation.isRunnable : false,
    launchAction: targetLocation ? targetLocation.launchAction : '',
    showInjectButton: targetLocation ? targetLocation.showInjectButton : false,
    enableExecutablePath: targetLocation ? targetLocation.enableExecutablePath : '',
    enableExecutableBaseType: targetLocation ? targetLocation.enableExecutableBaseType : '',
    launchArgs: targetLocation ? targetLocation.launchArgs : [],
    postInstallSteps,
    onEnableSteps,
    onDisableSteps,
    onUninstallSteps,
    packageType: packageProfile.type,
    packageAdapter: packageProfile.adapter,
    packageProfile,
    healthExpectations,
    explain: buildExplain({
      mode,
      ruleId,
      confidence,
      candidates,
      missedReasons,
      coverageLedger,
      routePlans,
      skippedRoutePlans,
      context
    }),
    missedReasons,
    candidatePlans: candidates,
    replaySnapshot: {
      archiveStructureSummary: sourceSelection
        ? summarizeSnapshotForReplay(sourceSelection.snapshot)
        : { fileCount: 0, dirCount: 0, directEntryCount: 0 },
      ruleVersion: toSafeNumber(
        context.installRule?.version || context.installRule?.ruleVersion,
        0
      ),
      plannerVersion: 4,
      sourceContext: {
        source: context.source,
        domainName: context.domainName,
        packageFolderName: context.packageFolderName
      }
    },
    replayContext: {
      ruleId,
      mode,
      routeIds: routePlans ? routePlans.map((rp) => rp.routeId) : [],
      sourceUnits: sourceSelection?.units || [],
      templates: context.ruleTemplates || [],
      declarative: context.declarativeReplay,
      coverageSummary: mode === 'multi_route' ? coverageSummary : undefined
    },
    packageRoot: sourceRoot,
    candidateRoot: sourceSelection ? sourceSelection.sourceRoot : toSafeText(context.stagingPath),
    warnings: [
      ...schemaWarnings,
      ...(Array.isArray(packageProfile.warnings) ? packageProfile.warnings : [])
    ],
    risks: [],
    // 多路由模式的额外标记
    autoExecutable:
      mode === 'multi_route'
        ? operations.length > 0 &&
          internalConflicts.length === 0 &&
          (coverageSummary.unsafeCount || 0) === 0 &&
          (coverageSummary.groupIncompleteCount || 0) === 0
        : undefined,
    requiresUserConfirm:
      mode === 'multi_route'
        ? operations.length === 0 ||
          internalConflicts.length > 0 ||
          (coverageSummary.unmatchedCount || 0) > 0 ||
          (coverageSummary.unsafeCount || 0) > 0
        : undefined,
    confirmReason:
      mode === 'multi_route'
        ? operations.length === 0
          ? '未生成可执行安装操作'
          : internalConflicts.length > 0
            ? '检测到 route 内部目标冲突'
            : (coverageSummary.unsafeCount || 0) > 0
              ? '检测到不安全源路径'
              : (coverageSummary.unmatchedCount || 0) > 0
                ? '存在未匹配源条目，需要用户确认'
                : ''
        : undefined
  })

  // 阶段化组装：每个阶段都有显式名称与统一错误边界（失败时归一并标注 detail.stage）。
  // onStageTiming 为可选耗时埋点回调（生产默认关闭；基准脚本经 context.onStageTiming 采集）。
  const onStageTiming = typeof context.onStageTiming === 'function' ? context.onStageTiming : null

  // P3：增量/幂等安装——运行期/调用方开关（非规则字段），开启后启用哈希比对，
  // 目标已存在且同哈希则跳过部署。
  const incrementalInstall = context.hash === true || context.incrementalInstall === true

  // 阶段：构建变更集
  const changeSet = await runPlanStage(
    PLAN_STAGE.CHANGE_SET,
    () =>
      buildPlanChangeSet(basePlan, {
        ...context,
        targetRoot,
        hash: incrementalInstall
      }),
    onStageTiming
  )

  // 阶段：冲突分析
  const externalConflictResult = await runPlanStage(
    PLAN_STAGE.CONFLICT_ANALYSIS,
    () =>
      analyzePlanConflicts(changeSet, {
        ...context,
        targetRoot
      }),
    onStageTiming
  )

  // 阶段：完整性与安全性校验
  const validationResult = await runPlanStage(
    PLAN_STAGE.VALIDATION,
    () =>
      validatePlanCompleteness(
        { ...basePlan, changeSet },
        {
          ...context,
          targetRoot
        }
      ),
    onStageTiming
  )

  // 合并内部冲突与校验产生的阻断级错误
  const allInternalConflicts = [
    ...internalConflicts,
    ...validationResult.errors
  ]
  const conflictResult = mergeConflictResults(externalConflictResult, allInternalConflicts)

  // 阶段：部署策略
  const deployStrategy = await runPlanStage(
    PLAN_STAGE.DEPLOY_STRATEGY,
    () => resolveDeployStrategy({ ...basePlan, rule }, context),
    onStageTiming
  )

  // 阶段：依赖求解
  const dependencyResult = await runPlanStage(
    PLAN_STAGE.DEPENDENCY,
    () =>
      solveInstallDependencies(
        { ...basePlan, packageProfile },
        { ...context, rule, packageProfile }
      ),
    onStageTiming
  )

  // 阶段：事务规划
  const transactionPlan = await runPlanStage(
    PLAN_STAGE.TRANSACTION,
    () =>
      buildTransactionPlan({
        plan: basePlan,
        changeSet,
        conflictResult,
        deployStrategy,
        context
      }),
    onStageTiming
  )

  // 最终组装
  const finalRequiresUserConfirm =
    basePlan.requiresUserConfirm ||
    conflictResult.requiresUserConfirm ||
    dependencyResult.status === 'blocked' ||
    confidence < 50

  const finalAutoExecutable =
    basePlan.autoExecutable !== false &&
    conflictResult.blockInstall !== true &&
    dependencyResult.status !== 'blocked' &&
    confidence >= 50

  return createInstallPlan({
    ...basePlan,
    changeSet,
    conflictResult,
    dependencyResult,
    deployStrategy,
    transactionPlan,
    warnings: [
      ...(basePlan.warnings || []),
      ...(validationResult.warnings || [])
    ],
    risks: [
      ...(basePlan.risks || []),
      ...(validationResult.risks || [])
    ],
    requiresUserConfirm: finalRequiresUserConfirm,
    autoExecutable: finalAutoExecutable,
    confirmReason:
      conflictResult.blockInstall === true
        ? '安装规划检测到阻断冲突'
        : dependencyResult.status === 'blocked'
          ? '安装规划检测到依赖阻断'
          : confidence < 50
            ? '规则置信度偏低，需要用户确认'
            : basePlan.confirmReason || ''
  })
}

function summarizeSnapshotForReplay(snapshot = {}) {
  return {
    directEntryCount: Array.isArray(snapshot?.directEntries) ? snapshot.directEntries.length : 0,
    fileCount: Array.isArray(snapshot?.allFiles) ? snapshot.allFiles.length : 0,
    dirCount: Array.isArray(snapshot?.allDirs) ? snapshot.allDirs.length : 0
  }
}
