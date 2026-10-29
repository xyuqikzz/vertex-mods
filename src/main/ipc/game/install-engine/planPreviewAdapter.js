import path from 'path'
import fs from 'fs-extra'
import {
  isPlainObject,
  normalizeRelativeRulePath,
  resolveFirstDefinedValue,
  toSafeText
} from './contracts.js'
import { normalizeInstallPostInstallSteps } from './installLifecycleRunner.js'
import { isPathInside } from './pathSafety.js'
import { resolveTargetBoundaryRoot } from './targetResolver.js'
import { buildCoverageReport } from './coverageLedger.js'
import { assertInstallPlanConflictPoliciesSupported } from './conflictPolicyResolver.js'
import { assertDeclarativeEvidenceCurrent } from './declarativeFacts.js'
import { assertManagedConfigPreviewCurrent } from './managedConfigJournal.js'
import { InstallEngineError } from './installEngineError.js'

function parseJsonObject(value = {}, fallback = {}) {
  if (isPlainObject(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return fallback
  }

  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function normalizePathLike(input = '') {
  return normalizeRelativeRulePath(input)
}

function toPathParts(relativePath = '') {
  const text = normalizePathLike(relativePath)
  return text ? text.split('/') : []
}

function normalizeInstallUsageType(value, defaultValue = 1) {
  const safeValue = Number(value)
  return [1, 2, 3, 4].includes(safeValue) ? safeValue : defaultValue
}

function normalizeLaunchArgumentList(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()
  return text ? [text] : []
}

async function ensureDirectory(pathValue = '') {
  if (!pathValue) return false
  try {
    const stat = await fs.stat(pathValue)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function normalizeInstallPlanRiskList(value = []) {
  const sourceList = Array.isArray(value) ? value : [value]
  return sourceList
    .map((item) => {
      if (isPlainObject(item)) {
        return item
      }
      const message = String(item ?? '').trim()
      return message ? { code: 'warning', message } : null
    })
    .filter(Boolean)
}

function collectInstallPlanLifecycleRisks(plan = {}) {
  const lifecycleEntries = [
    ['post_install', plan.postInstallSteps],
    ['on_enable', plan.onEnableSteps],
    ['on_disable', plan.onDisableSteps],
    ['on_uninstall', plan.onUninstallSteps]
  ]
  const highRiskActions = new Set(['run_command', 'run_script', 'execute'])
  const highRiskExtensions = new Set(['.exe', '.bat', '.cmd', '.ps1'])
  const risks = []

  for (const [lifecycleName, steps] of lifecycleEntries) {
    for (const step of Array.isArray(steps) ? steps : []) {
      const action = String(resolveFirstDefinedValue(step?.action, step?.type, step?.name) || '')
        .trim()
        .toLowerCase()
      const stepPath = normalizePathLike(
        resolveFirstDefinedValue(step?.path, step?.relativePath, step?.relative_path) || ''
      )
      const extension = path.extname(stepPath).toLowerCase()
      if (!highRiskActions.has(action) && !highRiskExtensions.has(extension)) {
        continue
      }

      risks.push({
        code: 'high_risk_lifecycle_action',
        level: 'high',
        lifecycle: lifecycleName,
        action,
        path: stepPath,
        message: '生命周期动作会执行本地程序或脚本，需要用户确认'
      })
    }
  }

  return risks
}

function dedupeInstallPlanRiskList(list = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const key = [
      String(item?.code || '').trim(),
      String(item?.lifecycle || '').trim(),
      String(item?.action || '').trim(),
      String(item?.path || '').trim(),
      String(item?.message || '').trim()
    ].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(item)
  }
  return result
}

function resolveInstallPlanConfirmState(plan = {}) {
  const warnings = normalizeInstallPlanRiskList(plan?.warnings || [])
  const risks = dedupeInstallPlanRiskList([
    ...normalizeInstallPlanRiskList(plan?.risks || []),
    ...collectInstallPlanLifecycleRisks(plan)
  ])
  const requiresUserConfirm =
    plan?.requiresUserConfirm === true || risks.length > 0 || plan?.autoExecutable === false
  const autoExecutable =
    plan?.autoExecutable === true
      ? !requiresUserConfirm
      : plan?.autoExecutable === false
        ? false
        : !requiresUserConfirm
  const confirmReason = String(
    plan?.confirmReason ||
      (requiresUserConfirm
        ? risks
            .map((item) => item.message)
            .filter(Boolean)
            .join('；')
        : '')
  ).trim()

  return {
    autoExecutable,
    requiresUserConfirm,
    confirmReason,
    warnings,
    risks
  }
}

function resolveMetadata(entry = {}) {
  if (isPlainObject(entry?.metadata)) {
    return entry.metadata
  }
  return parseJsonObject(entry?.metadata_json, {})
}

function resolveMetadataPlan(metadata = {}) {
  const installPayload = isPlainObject(metadata?.installPayload) ? metadata.installPayload : {}
  if (isPlainObject(installPayload.installPlan)) {
    return installPayload.installPlan
  }
  if (isPlainObject(metadata?.installRulePlan)) {
    return metadata.installRulePlan
  }
  if (isPlainObject(metadata?.sourceInstallPlan)) {
    return metadata.sourceInstallPlan
  }
  for (const fieldName of [
    'nexusInstallPlan',
    'modioInstallPlan',
    'ficsitInstallPlan',
    'vamhubInstallPlan'
  ]) {
    if (isPlainObject(metadata?.[fieldName])) {
      return metadata[fieldName]
    }
  }

  const lastInstallResult = isPlainObject(metadata?.lastInstallResult)
    ? metadata.lastInstallResult
    : {}
  const previewResult = isPlainObject(lastInstallResult?.previewResult)
    ? lastInstallResult.previewResult
    : {}
  return isPlainObject(previewResult?.installPlan) ? previewResult.installPlan : {}
}

export function resolveSourceInstallPreviewPlanPayload(entry = {}) {
  if (isPlainObject(entry?.installPlan)) {
    return entry.installPlan
  }

  const storedPlan = parseJsonObject(entry?.install_plan_json, {})
  if (Object.keys(storedPlan).length > 0) {
    return storedPlan
  }

  return resolveMetadataPlan(resolveMetadata(entry))
}

export function normalizeResolvedSourceInstallPlan(plan = null) {
  if (!isPlainObject(plan)) {
    return null
  }
  const postInstallSteps = normalizeInstallPostInstallSteps(plan?.postInstallSteps || [])
  const onEnableSteps = normalizeInstallPostInstallSteps(plan?.onEnableSteps || [])
  const onDisableSteps = normalizeInstallPostInstallSteps(plan?.onDisableSteps || [])
  const onUninstallSteps = normalizeInstallPostInstallSteps(plan?.onUninstallSteps || [])
  const confirmState = resolveInstallPlanConfirmState({
    ...plan,
    postInstallSteps,
    onEnableSteps,
    onDisableSteps,
    onUninstallSteps
  })
  const coverageLedger = Array.isArray(plan?.coverageLedger) ? plan.coverageLedger : []

  return {
    planId: toSafeText(plan?.planId),
    planSchemaVersion: Number(plan?.planSchemaVersion || 1),
    plannerVersion: toSafeText(plan?.plannerVersion),
    engineVersion: toSafeText(plan?.engineVersion),
    planner: isPlainObject(plan?.planner) ? plan.planner : {},
    source: toSafeText(plan?.source),
    sourceAdapter: toSafeText(plan?.sourceAdapter),
    confidence: Number(plan?.confidence || 0),
    explain: isPlainObject(plan?.explain) ? plan.explain : {},
    domainName: toSafeText(plan?.domainName),
    strategy: toSafeText(plan?.strategy || 'unknown') || 'unknown',
    ruleId: toSafeText(plan?.ruleId),
    targetRelativePath: normalizePathLike(plan?.targetRelativePath || '.') || '.',
    packageRoot: toSafeText(plan?.packageRoot),
    candidateRoot: toSafeText(plan?.candidateRoot),
    sourceRoot: toSafeText(plan?.sourceRoot),
    lifecycleStagingRoot: toSafeText(plan?.lifecycleStagingRoot),
    targetRoot: toSafeText(plan?.targetRoot),
    targetBaseType: toSafeText(plan?.targetBaseType || 'game') || 'game',
    operations: Array.isArray(plan?.operations) ? plan.operations : [],
    routes: Array.isArray(plan?.routes) ? plan.routes : [],
    routeOperations: Array.isArray(plan?.routeOperations) ? plan.routeOperations : [],
    coverageLedger,
    coverageSummary: isPlainObject(plan?.coverageSummary) ? plan.coverageSummary : {},
    // P3/P4：稳定输出 coverage 可视化报告（UNMATCHED/CONFLICT/UNSAFE 高亮样本），供前端预览面板直接消费。
    coverageReport: buildCoverageReport(coverageLedger),
    dependencies: Array.isArray(plan?.dependencies) ? plan.dependencies : [],
    missedReasons: Array.isArray(plan?.missedReasons) ? plan.missedReasons : [],
    candidatePlans: Array.isArray(plan?.candidatePlans) ? plan.candidatePlans : [],
    changeSet: isPlainObject(plan?.changeSet) ? plan.changeSet : {},
    conflictResult: isPlainObject(plan?.conflictResult) ? plan.conflictResult : {},
    dependencyResult: isPlainObject(plan?.dependencyResult) ? plan.dependencyResult : {},
    deployStrategy: isPlainObject(plan?.deployStrategy) ? plan.deployStrategy : {},
    transactionPlan: isPlainObject(plan?.transactionPlan)
      ? plan.transactionPlan
      : isPlainObject(plan?.transaction)
        ? plan.transaction
        : {},
    packageType: toSafeText(plan?.packageType || plan?.packageProfile?.type || 'generic'),
    packageAdapter: toSafeText(plan?.packageAdapter || plan?.packageProfile?.adapter),
    packageProfile: isPlainObject(plan?.packageProfile) ? plan.packageProfile : {},
    healthExpectations: isPlainObject(plan?.healthExpectations) ? plan.healthExpectations : {},
    replaySnapshot: isPlainObject(plan?.replaySnapshot) ? plan.replaySnapshot : {},
    replayContext: isPlainObject(plan?.replayContext) ? plan.replayContext : {},
    ...confirmState,
    usageType: normalizeInstallUsageType(plan?.usageType, 1),
    isRunnable: !!plan?.isRunnable,
    launchAction: toSafeText(plan?.launchAction),
    showInjectButton: !!plan?.showInjectButton,
    enableExecutablePath: toSafeText(plan?.enableExecutablePath),
    enableExecutableBaseType: toSafeText(plan?.enableExecutableBaseType),
    launchArgs: normalizeLaunchArgumentList(plan?.launchArgs || []),
    postInstallSteps,
    onEnableSteps,
    onDisableSteps,
    onUninstallSteps
  }
}

export async function assertSourceInstallPlanCurrent(plan, gameRoot, runtimeContext = {}) {
  await assertDeclarativeEvidenceCurrent(plan, {
    ...runtimeContext, gameRoot, stagingPath: plan?.lifecycleStagingRoot || plan?.sourceRoot, source: plan?.source
  })
  const dependencyCapabilities = plan?.replayContext?.declarative?.dependencyCapabilities
  if (dependencyCapabilities && JSON.stringify(dependencyCapabilities) !== JSON.stringify(runtimeContext.installedCapabilities)) {
    throw new InstallEngineError('install_engine.preview_stale', '预览后的依赖状态已变化或无法核验，请重新预览')
  }
  await assertManagedConfigPreviewCurrent(plan, gameRoot, runtimeContext.managedConfigContext)
}

export async function resolveCachedSourceInstallPreviewPlan(entry = {}, gameRoot = '', runtimeContext = {}) {
  const rawPlan = resolveSourceInstallPreviewPlanPayload(entry)
  assertInstallPlanConflictPoliciesSupported(rawPlan)
  const plan = normalizeResolvedSourceInstallPlan(rawPlan)
  if (!plan) {
    throw new Error('预检安装计划无效，无法复用')
  }

  const safeGameRoot = path.resolve(String(gameRoot || ''))
  const safeStagingPath = path.resolve(String(entry?.stagingPath || ''))
  const sourceRoot = path.resolve(String(plan?.sourceRoot || ''))
  const lifecycleStagingRoot = path.resolve(
    String(plan?.lifecycleStagingRoot || plan?.sourceRoot || '')
  )
  const resolvedBoundary = await resolveTargetBoundaryRoot(plan?.targetBaseType, safeGameRoot)
  const targetBaseType = resolvedBoundary.targetBaseType
  const targetBoundaryRoot = resolvedBoundary.targetBoundaryRoot
  const targetRelativePath = normalizePathLike(plan?.targetRelativePath || '.') || '.'
  const targetRoot = toSafeText(plan?.targetRoot)
    ? path.resolve(String(plan.targetRoot || ''))
    : targetRelativePath === '.'
      ? targetBoundaryRoot
      : path.resolve(targetBoundaryRoot, ...toPathParts(targetRelativePath))

  if (!isPathInside(safeStagingPath, sourceRoot)) {
    throw new Error('预检暂存源路径异常，无法复用')
  }
  if (!isPathInside(safeStagingPath, lifecycleStagingRoot)) {
    throw new Error('预检生命周期脚本源路径异常，无法复用')
  }
  if (!(await ensureDirectory(sourceRoot))) {
    throw new Error('预检暂存源目录不存在，无法复用')
  }
  if (!(await ensureDirectory(lifecycleStagingRoot))) {
    throw new Error('预检生命周期脚本目录不存在，无法复用')
  }
  if (!isPathInside(targetBoundaryRoot, targetRoot)) {
    throw new Error('预检安装目标路径异常，无法复用')
  }

  await assertSourceInstallPlanCurrent(plan, safeGameRoot, runtimeContext)

  return {
    ...plan,
    sourceRoot,
    lifecycleStagingRoot,
    targetRoot,
    targetRelativePath,
    targetBaseType
  }
}
