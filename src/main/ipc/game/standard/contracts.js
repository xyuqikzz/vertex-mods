import { INSTALL_STATES, STANDARD_METADATA_SCHEMA_VERSION, STANDARD_SOURCE } from './constants.js'
import { createStandardTaskId } from './events.js'

export function createInstallTask(payload = {}) {
  return {
    taskId: String(payload.taskId || createStandardTaskId()),
    source: String(payload.source || STANDARD_SOURCE.UNKNOWN),
    state: String(payload.state || INSTALL_STATES.CREATED),
    payloadHash: String(payload.payloadHash || ''),
    inspectToken: String(payload.inspectToken || ''),
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || new Date().toISOString(),
    metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
  }
}

export function createInstallPlan(payload = {}) {
  const requiresUserConfirm = payload.requiresUserConfirm === true
  const autoExecutable =
    payload.autoExecutable === true
      ? !requiresUserConfirm
      : payload.autoExecutable !== false && !requiresUserConfirm
  return {
    source: String(payload.source || STANDARD_SOURCE.UNKNOWN),
    sourceAdapter: String(payload.sourceAdapter || ''),
    strategy: String(payload.strategy || ''),
    ruleId: String(payload.ruleId || ''),
    confidence: Number(payload.confidence || 0),
    sourceRoot: String(payload.sourceRoot || ''),
    targetRoot: String(payload.targetRoot || ''),
    targetRelativePath: String(payload.targetRelativePath || '.'),
    targetBaseType: String(payload.targetBaseType || 'game'),
    packageKey: String(payload.packageKey || ''),
    dependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
    operations: Array.isArray(payload.operations) ? payload.operations : [],
    autoExecutable,
    requiresUserConfirm,
    confirmReason: String(payload.confirmReason || ''),
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    risks: Array.isArray(payload.risks) ? payload.risks : [],
    postInstallSteps: Array.isArray(payload.postInstallSteps) ? payload.postInstallSteps : [],
    onEnableSteps: Array.isArray(payload.onEnableSteps) ? payload.onEnableSteps : [],
    onDisableSteps: Array.isArray(payload.onDisableSteps) ? payload.onDisableSteps : [],
    onUninstallSteps: Array.isArray(payload.onUninstallSteps) ? payload.onUninstallSteps : [],
    explain: payload.explain && typeof payload.explain === 'object' ? payload.explain : {},
    missedReasons: Array.isArray(payload.missedReasons) ? payload.missedReasons : [],
    candidatePlans: Array.isArray(payload.candidatePlans) ? payload.candidatePlans : [],
    changeSet: payload.changeSet && typeof payload.changeSet === 'object' ? payload.changeSet : {},
    conflictResult:
      payload.conflictResult && typeof payload.conflictResult === 'object'
        ? payload.conflictResult
        : {},
    dependencyResult:
      payload.dependencyResult && typeof payload.dependencyResult === 'object'
        ? payload.dependencyResult
        : {},
    deployStrategy:
      payload.deployStrategy && typeof payload.deployStrategy === 'object'
        ? payload.deployStrategy
        : {},
    transactionPlan:
      payload.transactionPlan && typeof payload.transactionPlan === 'object'
        ? payload.transactionPlan
        : {},
    transaction:
      payload.transaction && typeof payload.transaction === 'object'
        ? payload.transaction
        : payload.transactionPlan && typeof payload.transactionPlan === 'object'
          ? payload.transactionPlan
          : {},
    packageType: String(payload.packageType || payload.packageProfile?.type || 'generic'),
    packageAdapter: String(payload.packageAdapter || payload.packageProfile?.adapter || ''),
    packageProfile:
      payload.packageProfile && typeof payload.packageProfile === 'object'
        ? payload.packageProfile
        : {},
    healthExpectations:
      payload.healthExpectations && typeof payload.healthExpectations === 'object'
        ? payload.healthExpectations
        : {},
    replaySnapshot:
      payload.replaySnapshot && typeof payload.replaySnapshot === 'object'
        ? payload.replaySnapshot
        : {},
    replayContext:
      payload.replayContext && typeof payload.replayContext === 'object'
        ? payload.replayContext
        : {},
    legacyPlan: payload.legacyPlan || null,
    metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
  }
}

export function createStandardSourceAdapter(adapter = {}) {
  return {
    source: String(adapter.source || STANDARD_SOURCE.UNKNOWN),
    domain: 'standard',
    inspect: adapter.inspect,
    install: adapter.install,
    resolveDependencies: adapter.resolveDependencies,
    resolvePackage: adapter.resolvePackage,
    buildInstallPlan: adapter.buildInstallPlan
  }
}
