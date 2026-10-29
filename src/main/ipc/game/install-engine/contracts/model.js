/**
 * contracts/model.js — 安装引擎领域模型工厂
 *
 * InstallPlan / ChangeSet / ConflictResult / DependencyResult / DeployStrategy /
 * TransactionPlan / HealthExpectations / ReplaySnapshot / InstallEngineContext 的
 * 规范化工厂与领域常量，是引擎领域模型的唯一来源。纯工具见 contracts/util.js。
 */
import { INSTALL_RULE_ENGINE_VERSION } from '../../../../../shared/installation/install-rule-declarations.js'
import {
  createInstallPlanId,
  isPlainObject,
  normalizeRelativeRulePath,
  normalizeTextList,
  toArrayValue,
  toSafeNumber,
  toSafeText
} from './util.js'

export const SOURCE_INSTALL_ENGINE_VERSION = INSTALL_RULE_ENGINE_VERSION
export const SOURCE_INSTALL_PLAN_SCHEMA_VERSION = 4
export const SOURCE_INSTALL_PLANNER_VERSION = SOURCE_INSTALL_ENGINE_VERSION

export function createEmptyChangeSet(payload = {}) {
  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : Array.isArray(payload.items)
      ? payload.items
      : []
  const summary = isPlainObject(payload.summary) ? payload.summary : {}
  return {
    changeSetVersion: toSafeNumber(payload.changeSetVersion || payload.schemaVersion, 1),
    schemaVersion: toSafeNumber(payload.schemaVersion || payload.changeSetVersion, 1),
    sourceRoot: toSafeText(payload.sourceRoot),
    targetRoot: toSafeText(payload.targetRoot),
    entries,
    summary: {
      addCount: toSafeNumber(summary.addCount ?? summary.add, 0),
      overwriteCount: toSafeNumber(summary.overwriteCount ?? summary.overwrite, 0),
      skipSameHashCount: toSafeNumber(summary.skipSameHashCount ?? summary.skip, 0),
      deleteCount: toSafeNumber(summary.deleteCount ?? summary.delete, 0),
      mkdirCount: toSafeNumber(summary.mkdirCount ?? summary.mkdir, 0),
      restoreCount: toSafeNumber(summary.restoreCount ?? summary.restore, 0),
      backupRequiredCount: toSafeNumber(summary.backupRequiredCount ?? summary.risk, 0),
      add: toSafeNumber(summary.add ?? summary.addCount, 0),
      overwrite: toSafeNumber(summary.overwrite ?? summary.overwriteCount, 0),
      skip: toSafeNumber(summary.skip ?? summary.skipSameHashCount, 0),
      delete: toSafeNumber(summary.delete ?? summary.deleteCount, 0),
      risk: toSafeNumber(summary.risk ?? summary.backupRequiredCount, 0)
    }
  }
}

export function createEmptyConflictResult(payload = {}) {
  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : []
  const summary = isPlainObject(payload.summary) ? payload.summary : {}
  return {
    status: toSafeText(payload.status || 'unknown'),
    level: toSafeText(payload.level || (conflicts.length ? 'warning' : 'none')) || 'none',
    conflicts,
    warnings,
    requiresUserConfirm: payload.requiresUserConfirm === true,
    blockInstall: payload.blockInstall === true,
    summary: {
      warningCount: toSafeNumber(summary.warningCount, warnings.length),
      blockerCount: toSafeNumber(summary.blockerCount, 0),
      conflictCount: toSafeNumber(summary.conflictCount, conflicts.length)
    }
  }
}

export function createEmptyDependencyResult(payload = {}) {
  return {
    status: toSafeText(payload.status || 'unknown'),
    required: Array.isArray(payload.required) ? payload.required : [],
    optional: Array.isArray(payload.optional) ? payload.optional : [],
    conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
    missing: Array.isArray(payload.missing) ? payload.missing : [],
    waiting: Array.isArray(payload.waiting) ? payload.waiting : [],
    provides: Array.isArray(payload.provides) ? payload.provides : [],
    installOrder: Array.isArray(payload.installOrder) ? payload.installOrder : [],
    loadOrderHints: Array.isArray(payload.loadOrderHints) ? payload.loadOrderHints : []
  }
}

export function createEmptyDeployStrategy(payload = {}) {
  return {
    strategy: toSafeText(payload.strategy || payload.actual || payload.preferred || 'copy'),
    preferred: toSafeText(payload.preferred || payload.strategy || 'copy'),
    actual: toSafeText(payload.actual || payload.strategy || 'copy'),
    fallback: Array.isArray(payload.fallback) ? payload.fallback : [],
    fallbackReasons: Array.isArray(payload.fallbackReasons) ? payload.fallbackReasons : [],
    requiresAdmin: payload.requiresAdmin === true,
    reason: toSafeText(payload.reason),
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    capabilities: isPlainObject(payload.capabilities)
      ? payload.capabilities
      : {
          hardlink: false,
          symlink: false,
          copy: true
        }
  }
}

export function createEmptyTransactionPlan(payload = {}) {
  return {
    transactionId: toSafeText(payload.transactionId),
    jobId: toSafeText(payload.jobId),
    itemId: toSafeText(payload.itemId),
    source: toSafeText(payload.source),
    state: toSafeText(payload.state || 'prepared'),
    required: payload.required === true,
    rollbackPolicy: toSafeText(payload.rollbackPolicy || 'none'),
    rollbackAvailable: payload.rollbackAvailable === true,
    backupRequired: payload.backupRequired === true,
    recoveryHint: toSafeText(payload.recoveryHint),
    changeSet: isPlainObject(payload.changeSet) ? payload.changeSet : {},
    backupPlan: isPlainObject(payload.backupPlan) ? payload.backupPlan : {},
    rollbackPlan: isPlainObject(payload.rollbackPlan) ? payload.rollbackPlan : {},
    createdAt: toSafeText(payload.createdAt || new Date().toISOString())
  }
}

export function createEmptyHealthExpectations(payload = {}) {
  return {
    requiredFiles: normalizeTextList(payload.requiredFiles || payload.required_files, {
      pathLike: true
    }),
    requiredDirs: normalizeTextList(payload.requiredDirs || payload.required_dirs, {
      pathLike: true
    }),
    optionalFiles: normalizeTextList(payload.optionalFiles || payload.optional_files, {
      pathLike: true
    }),
    recordRequired: payload.recordRequired !== false
  }
}

export function createEmptyReplaySnapshot(payload = {}) {
  return {
    archiveStructureSummary: isPlainObject(payload.archiveStructureSummary)
      ? payload.archiveStructureSummary
      : {},
    ruleVersion: toSafeNumber(payload.ruleVersion, 0),
    plannerVersion: toSafeNumber(payload.plannerVersion, 2),
    sourceContext: isPlainObject(payload.sourceContext) ? payload.sourceContext : {},
    createdAt: toSafeText(payload.createdAt || new Date().toISOString())
  }
}

function normalizeRiskList(value = []) {
  return toArrayValue(value)
    .map((item) => {
      if (isPlainObject(item)) {
        return item
      }
      const message = toSafeText(item)
      return message ? { code: 'warning', message } : null
    })
    .filter(Boolean)
}

function collectLifecycleRiskList(payload = {}) {
  const lifecycleEntries = [
    ['post_install', payload.postInstallSteps],
    ['on_enable', payload.onEnableSteps],
    ['on_disable', payload.onDisableSteps],
    ['on_uninstall', payload.onUninstallSteps]
  ]
  const riskList = []
  const highRiskActions = new Set([
    'run_command',
    'run_script',
    'execute',
    'write_text_file',
    'patch_json',
    'patch_ini'
  ])
  const highRiskExtensions = new Set(['.exe', '.bat', '.cmd', '.ps1', '.dll', '.sys'])

  for (const [lifecycleName, steps] of lifecycleEntries) {
    for (const step of Array.isArray(steps) ? steps : []) {
      const action = toSafeText(step?.action || step?.type || step?.name).toLowerCase()
      const stepPath = normalizeRelativeRulePath(step?.path || step?.relativePath || '')
      const extension = stepPath.includes('.') ? `.${stepPath.split('.').pop()}`.toLowerCase() : ''
      if (!highRiskActions.has(action) && !highRiskExtensions.has(extension)) {
        continue
      }

      riskList.push({
        code: 'high_risk_lifecycle_action',
        level: 'high',
        lifecycle: lifecycleName,
        action,
        path: stepPath,
        message: highRiskActions.has(action)
          ? '生命周期动作会修改文件或执行本地程序，需要用户确认'
          : '生命周期动作涉及高风险文件类型，需要用户确认'
      })
    }
  }

  return riskList
}

function dedupeRiskList(list = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const key = [
      toSafeText(item?.code),
      toSafeText(item?.lifecycle),
      toSafeText(item?.action),
      toSafeText(item?.path),
      toSafeText(item?.message)
    ].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(item)
  }
  return result
}

export function createInstallEngineContext(payload = {}) {
  const sourceMeta = isPlainObject(payload.sourceMeta) ? payload.sourceMeta : {}

  return {
    source: toSafeText(payload.source || sourceMeta.source || '').toLowerCase(),
    sourceGameId: toSafeNumber(payload.sourceGameId || sourceMeta.sourceId, 0),
    sourceGameSlug: toSafeText(payload.sourceGameSlug || sourceMeta.sourceSlug),
    domainName: toSafeText(payload.domainName || payload.gameDomainName || sourceMeta.sourceSlug),
    modId: toSafeNumber(payload.modId, 0),
    fileId: toSafeNumber(payload.fileId, 0),
    archivePath: toSafeText(payload.archivePath || payload.filePath),
    stagingPath: toSafeText(payload.stagingPath),
    gameRoot: toSafeText(payload.gameRoot),
    packageFolderName: toSafeText(payload.packageFolderName),
    installRule: isPlainObject(payload.installRule) ? payload.installRule : null,
    sourceMeta,
    data: isPlainObject(payload.data) ? payload.data : {},
    deployScope: isPlainObject(payload.deployScope) ? payload.deployScope : {},
    managedConfigContext: isPlainObject(payload.managedConfigContext) ? payload.managedConfigContext : {},
    installedCapabilities: isPlainObject(payload.installedCapabilities)
      ? payload.installedCapabilities
      : {},
    jobId: toSafeText(payload.jobId),
    itemId: toSafeText(payload.itemId),
    event: payload.event || null,
    phase: toSafeText(payload.phase || 'install') || 'install',
    snapshotCache: payload.snapshotCache instanceof Map ? payload.snapshotCache : new Map(),
    // P4：可选阶段耗时埋点回调，仅基准/诊断场景注入，生产默认 null（不产生开销）。
    onStageTiming: typeof payload.onStageTiming === 'function' ? payload.onStageTiming : null,
    // P3：增量/幂等安装开关，开启后对已存在且同哈希的目标文件标记 skip_same_hash 跳过。
    incrementalInstall: payload.incrementalInstall === true
  }
}

export function createInstallPlan(payload = {}) {
  const source = toSafeText(payload.source).toLowerCase()
  const warnings = normalizeRiskList(payload.warnings)
  const risks = dedupeRiskList([
    ...normalizeRiskList(payload.risks),
    ...collectLifecycleRiskList(payload)
  ])
  const requiresUserConfirm =
    payload.requiresUserConfirm === true || risks.length > 0 || payload.autoExecutable === false
  const autoExecutable =
    payload.autoExecutable === true
      ? !requiresUserConfirm
      : payload.autoExecutable === false
        ? false
        : !requiresUserConfirm
  const transactionPlan = createEmptyTransactionPlan(
    isPlainObject(payload.transactionPlan)
      ? payload.transactionPlan
      : isPlainObject(payload.transaction)
        ? payload.transaction
        : {}
  )

  return {
    planId: toSafeText(payload.planId) || createInstallPlanId('install_plan'),
    planSchemaVersion: toSafeNumber(payload.planSchemaVersion, SOURCE_INSTALL_PLAN_SCHEMA_VERSION),
    plannerVersion: toSafeText(payload.plannerVersion || SOURCE_INSTALL_PLANNER_VERSION),
    engineVersion: toSafeText(payload.engineVersion || SOURCE_INSTALL_ENGINE_VERSION),
    planner: isPlainObject(payload.planner)
      ? payload.planner
      : {
          mode: toSafeText(payload.plannerMode || payload.explain?.mode),
          version: toSafeText(payload.plannerVersion || SOURCE_INSTALL_PLANNER_VERSION),
          fallbackUsed: payload.fallbackUsed === true,
          fallbackReason: toSafeText(payload.fallbackReason)
        },
    source,
    sourceAdapter: toSafeText(payload.sourceAdapter),
    strategy: toSafeText(payload.strategy),
    ruleId: toSafeText(payload.ruleId),
    confidence: toSafeNumber(payload.confidence, 0),
    sourceRoot: toSafeText(payload.sourceRoot),
    lifecycleStagingRoot: toSafeText(payload.lifecycleStagingRoot || payload.sourceRoot),
    targetRoot: toSafeText(payload.targetRoot),
    targetRelativePath: toSafeText(payload.targetRelativePath || '.'),
    targetBaseType: toSafeText(payload.targetBaseType || 'game') || 'game',
    operations: Array.isArray(payload.operations) ? payload.operations : [],
    routes: Array.isArray(payload.routes) ? payload.routes : [],
    routeOperations: Array.isArray(payload.routeOperations) ? payload.routeOperations : [],
    coverageLedger: Array.isArray(payload.coverageLedger) ? payload.coverageLedger : [],
    coverageSummary: isPlainObject(payload.coverageSummary) ? payload.coverageSummary : {},
    ownershipIndex: Array.isArray(payload.ownershipIndex)
      ? payload.ownershipIndex
      : Array.isArray(payload.modOwnershipIndex)
        ? payload.modOwnershipIndex
        : [],
    dependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
    autoExecutable,
    requiresUserConfirm,
    confirmReason: toSafeText(
      payload.confirmReason ||
        (requiresUserConfirm
          ? risks
              .map((item) => item.message)
              .filter(Boolean)
              .join('；')
          : '')
    ),
    warnings,
    risks,
    usageType: toSafeNumber(payload.usageType, 1),
    isRunnable: !!payload.isRunnable,
    launchAction: toSafeText(payload.launchAction),
    showInjectButton: !!payload.showInjectButton,
    enableExecutablePath: toSafeText(payload.enableExecutablePath),
    enableExecutableBaseType: toSafeText(payload.enableExecutableBaseType),
    launchArgs: normalizeTextList(payload.launchArgs),
    postInstallSteps: Array.isArray(payload.postInstallSteps) ? payload.postInstallSteps : [],
    onEnableSteps: Array.isArray(payload.onEnableSteps) ? payload.onEnableSteps : [],
    onDisableSteps: Array.isArray(payload.onDisableSteps) ? payload.onDisableSteps : [],
    onUninstallSteps: Array.isArray(payload.onUninstallSteps) ? payload.onUninstallSteps : [],
    explain: isPlainObject(payload.explain)
      ? payload.explain
      : {
          mode: '',
          matchedRuleId: '',
          score: 0,
          candidateCount: 0,
          checkedRules: [],
          matchedSignals: [],
          missedReasons: [],
          fallback: []
        },
    missedReasons: Array.isArray(payload.missedReasons) ? payload.missedReasons : [],
    candidatePlans: Array.isArray(payload.candidatePlans) ? payload.candidatePlans : [],
    changeSet: createEmptyChangeSet(
      isPlainObject(payload.changeSet)
        ? payload.changeSet
        : {
            sourceRoot: payload.sourceRoot,
            targetRoot: payload.targetRoot
          }
    ),
    conflictResult: createEmptyConflictResult(
      isPlainObject(payload.conflictResult) ? payload.conflictResult : {}
    ),
    dependencyResult: createEmptyDependencyResult(
      isPlainObject(payload.dependencyResult) ? payload.dependencyResult : {}
    ),
    deployStrategy: createEmptyDeployStrategy(
      isPlainObject(payload.deployStrategy) ? payload.deployStrategy : {}
    ),
    transactionPlan,
    packageType: toSafeText(payload.packageType || payload.packageProfile?.type || 'generic'),
    packageAdapter: toSafeText(payload.packageAdapter || payload.packageProfile?.adapter || ''),
    packageProfile: isPlainObject(payload.packageProfile)
      ? payload.packageProfile
      : {
          type: toSafeText(payload.packageType || 'generic') || 'generic',
          confidence: 0,
          signals: []
        },
    healthExpectations: createEmptyHealthExpectations(
      isPlainObject(payload.healthExpectations) ? payload.healthExpectations : {}
    ),
    replaySnapshot: createEmptyReplaySnapshot(
      isPlainObject(payload.replaySnapshot)
        ? payload.replaySnapshot
        : isPlainObject(payload.replayContext)
          ? payload.replayContext
          : {}
    ),
    replayContext: isPlainObject(payload.replayContext) ? payload.replayContext : {},
    packageRoot: toSafeText(payload.packageRoot),
    candidateRoot: toSafeText(payload.candidateRoot)
  }
}
