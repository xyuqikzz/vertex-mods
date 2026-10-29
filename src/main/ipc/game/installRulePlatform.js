const INSTALL_RULE_PLATFORM_MAP = Object.freeze({
  gamebanana: {
    source: 'gamebanana', displayName: 'Banana', supportsRuleInstall: true,
    ruleFieldNames: ['installRule', 'sourceInstallRule'], planFieldName: 'sourceInstallPlan',
    domainFieldNames: ['sourceGameDomain', 'gameDomainName', 'sourceGameSlug'],
    sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId']
  },
  'steam-workshop': {
    source: 'steam-workshop', displayName: 'Steam', supportsRuleInstall: true,
    ruleFieldNames: ['installRule', 'sourceInstallRule'], planFieldName: 'sourceInstallPlan',
    domainFieldNames: ['sourceGameDomain', 'gameDomainName', 'sourceGameSlug'],
    sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId', 'steamAppId']
  },
  nexus: {
    source: 'nexus',
    displayName: 'Nexus',
    ruleFieldNames: ['installRule', 'sourceInstallRule', 'nexusInstallRule'],
    planFieldName: 'nexusInstallPlan',
    domainFieldNames: ['sourceGameDomain', 'gameDomainName', 'nexusGameDomain', 'sourceGameSlug'],
    sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId', 'nexusGameId', 'sourceId'],
    supportsRuleInstall: true
  },
  modio: {
    source: 'modio',
    displayName: 'mod.io',
    ruleFieldNames: ['installRule', 'sourceInstallRule', 'modioInstallRule'],
    planFieldName: 'modioInstallPlan',
    domainFieldNames: [
      'sourceGameDomain',
      'gameDomainName',
      'sourceGameSlug',
      'gameSourceSlug',
      'modioGameSlug',
      'modioGameDomain'
    ],
    sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId', 'modioGameId', 'sourceId'],
    supportsRuleInstall: true
  },
  ficsit: {
    source: 'ficsit',
    displayName: 'Ficsit',
    ruleFieldNames: ['installRule', 'sourceInstallRule', 'ficsitInstallRule'],
    planFieldName: 'ficsitInstallPlan',
    domainFieldNames: [
      'sourceGameDomain',
      'gameDomainName',
      'sourceGameSlug',
      'gameSourceSlug',
      'ficsitGameSlug'
    ],
    sourceGameIdFieldNames: [
      'sourceGameId',
      'gameSourceId',
      'ficsitGameId',
      'steamAppId',
      'appId',
      'sourceId'
    ],
    supportsRuleInstall: true
  },
  vamhub: {
    source: 'vamhub',
    displayName: 'VAM-Hub',
    ruleFieldNames: ['installRule', 'sourceInstallRule', 'vamhubInstallRule'],
    planFieldName: 'vamhubInstallPlan',
    domainFieldNames: [
      'sourceGameDomain',
      'gameDomainName',
      'sourceGameSlug',
      'gameSourceSlug',
      'vamhubGameSlug',
      'vamhubGameDomain'
    ],
    sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId', 'vamhubGameId', 'sourceId'],
    supportsRuleInstall: true
  }
})

const DEFAULT_RULE_PLATFORM = Object.freeze({
  source: '',
  displayName: '',
  ruleFieldNames: ['installRule', 'sourceInstallRule'],
  planFieldName: 'sourceInstallPlan',
  domainFieldNames: ['sourceGameDomain', 'gameDomainName', 'sourceGameSlug', 'gameSourceSlug'],
  sourceGameIdFieldNames: ['sourceGameId', 'gameSourceId', 'sourceId'],
  supportsRuleInstall: false
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeSource(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (!text || text === 'vertex') {
    return 'server'
  }
  return text
}

function toSafeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function pickFirstText(target = {}, fieldNames = []) {
  const source = toSafeObject(target)
  for (const fieldName of fieldNames) {
    const text = toSafeText(source[fieldName])
    if (text) {
      return text
    }
  }
  return ''
}

export function normalizeInstallRuleSource(value = '') {
  return toSafeSource(value)
}

export function getInstallRulePlatform(source = '') {
  const safeSource = normalizeInstallRuleSource(source)
  const platform = INSTALL_RULE_PLATFORM_MAP[safeSource]
  return (
    platform || {
      ...DEFAULT_RULE_PLATFORM,
      source: safeSource,
      displayName: safeSource
    }
  )
}

export function isInstallRuleManagedSource(source = '') {
  return getInstallRulePlatform(source).supportsRuleInstall === true
}

export function getInstallRulePlatformLabel(source = '') {
  const platform = getInstallRulePlatform(source)
  return platform.displayName || platform.source || '当前来源'
}

export function resolveInstallRuleSourceDomain(data = {}, sourceMeta = {}) {
  const target = toSafeObject(data)
  const meta = toSafeObject(sourceMeta)
  const platform = getInstallRulePlatform(meta.source || target.sourceType || target.source)
  return (
    pickFirstText(target, platform.domainFieldNames) ||
    pickFirstText(meta, ['sourceSlug', 'source_slug', 'domainName', 'domain_name']) ||
    ''
  )
}

export function resolveInstallRuleSourceGameId(data = {}, sourceMeta = {}) {
  const target = toSafeObject(data)
  const meta = toSafeObject(sourceMeta)
  const platform = getInstallRulePlatform(meta.source || target.sourceType || target.source)
  return (
    Number(pickFirstText(target, platform.sourceGameIdFieldNames) || 0) ||
    Number(meta.sourceId || meta.source_id || 0) ||
    0
  )
}

export function resolveInstallRuleObject(data = {}, sourceMeta = {}) {
  const target = toSafeObject(data)
  const meta = toSafeObject(sourceMeta)
  const platform = getInstallRulePlatform(meta.source || target.sourceType || target.source)
  const ruleFieldNames = [
    ...platform.ruleFieldNames,
    'installRule',
    'sourceInstallRule',
    'nexusInstallRule'
  ]

  for (const fieldName of ruleFieldNames) {
    const value = target[fieldName]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value
    }
  }
  return null
}

export function buildInstallRulePlatformContext(data = {}, sourceMeta = {}) {
  const meta = toSafeObject(sourceMeta)
  const source = normalizeInstallRuleSource(meta.source || data?.sourceType || data?.source)
  const platform = getInstallRulePlatform(source)
  const domainName = resolveInstallRuleSourceDomain(data, {
    ...meta,
    source
  })

  return {
    source,
    platform,
    platformLabel: getInstallRulePlatformLabel(source),
    isRuleManaged: isInstallRuleManagedSource(source),
    domainName,
    sourceGameId: resolveInstallRuleSourceGameId(data, {
      ...meta,
      source
    }),
    installRule: resolveInstallRuleObject(data, {
      ...meta,
      source
    })
  }
}

export function buildInstallRulePlanMetadata(plan = {}, context = {}) {
  const safePlan = toSafeObject(plan)
  const source = normalizeInstallRuleSource(context.source || safePlan.source || '')
  const operations = Array.isArray(safePlan.operations) ? safePlan.operations : []
  const dependencies = Array.isArray(safePlan.dependencies) ? safePlan.dependencies : []
  const warnings = Array.isArray(safePlan.warnings) ? safePlan.warnings : []
  const risks = Array.isArray(safePlan.risks) ? safePlan.risks : []
  const requiresUserConfirm = safePlan.requiresUserConfirm === true
  return {
    planId: toSafeText(safePlan.planId),
    planSchemaVersion: Number(safePlan.planSchemaVersion || 1),
    plannerVersion: toSafeText(safePlan.plannerVersion),
    engineVersion: toSafeText(safePlan.engineVersion),
    planner: safePlan.planner && typeof safePlan.planner === 'object' ? safePlan.planner : {},
    source,
    sourceAdapter: toSafeText(safePlan.sourceAdapter),
    domainName: toSafeText(context.domainName || safePlan.domainName),
    strategy: toSafeText(safePlan.strategy),
    ruleId: toSafeText(safePlan.ruleId),
    confidence: Number(safePlan.confidence || 0),
    explain: safePlan.explain && typeof safePlan.explain === 'object' ? safePlan.explain : {},
    sourceRoot: toSafeText(safePlan.sourceRoot),
    targetRoot: toSafeText(safePlan.targetRoot || context.targetRoot),
    targetRelativePath: safePlan.targetRelativePath,
    packageRoot: safePlan.packageRoot,
    lifecycleStagingRoot: toSafeText(
      safePlan.lifecycleStagingRoot || safePlan.sourceRoot || context.lifecycleStagingRoot
    ),
    targetBaseType: toSafeText(safePlan.targetBaseType || 'game') || 'game',
    operations,
    routes: Array.isArray(safePlan.routes) ? safePlan.routes : [],
    routeOperations: Array.isArray(safePlan.routeOperations) ? safePlan.routeOperations : [],
    coverageLedger: Array.isArray(safePlan.coverageLedger) ? safePlan.coverageLedger : [],
    coverageSummary:
      safePlan.coverageSummary && typeof safePlan.coverageSummary === 'object'
        ? safePlan.coverageSummary
        : {},
    dependencies,
    missedReasons: Array.isArray(safePlan.missedReasons) ? safePlan.missedReasons : [],
    candidatePlans: Array.isArray(safePlan.candidatePlans) ? safePlan.candidatePlans : [],
    changeSet:
      safePlan.changeSet && typeof safePlan.changeSet === 'object' ? safePlan.changeSet : {},
    conflictResult:
      safePlan.conflictResult && typeof safePlan.conflictResult === 'object'
        ? safePlan.conflictResult
        : {},
    dependencyResult:
      safePlan.dependencyResult && typeof safePlan.dependencyResult === 'object'
        ? safePlan.dependencyResult
        : {},
    deployStrategy:
      safePlan.deployStrategy && typeof safePlan.deployStrategy === 'object'
        ? safePlan.deployStrategy
        : {},
    transactionPlan:
      safePlan.transactionPlan && typeof safePlan.transactionPlan === 'object'
        ? safePlan.transactionPlan
        : safePlan.transaction && typeof safePlan.transaction === 'object'
          ? safePlan.transaction
          : {},
    packageType: toSafeText(safePlan.packageType || safePlan.packageProfile?.type || 'generic'),
    packageAdapter: toSafeText(safePlan.packageAdapter || safePlan.packageProfile?.adapter),
    packageProfile:
      safePlan.packageProfile && typeof safePlan.packageProfile === 'object'
        ? safePlan.packageProfile
        : {},
    healthExpectations:
      safePlan.healthExpectations && typeof safePlan.healthExpectations === 'object'
        ? safePlan.healthExpectations
        : {},
    replaySnapshot:
      safePlan.replaySnapshot && typeof safePlan.replaySnapshot === 'object'
        ? safePlan.replaySnapshot
        : {},
    replayContext:
      safePlan.replayContext && typeof safePlan.replayContext === 'object'
        ? safePlan.replayContext
        : {},
    autoExecutable: safePlan.autoExecutable !== false && !requiresUserConfirm,
    requiresUserConfirm,
    confirmReason: toSafeText(safePlan.confirmReason),
    warnings,
    risks,
    deployedFiles: operations
      .map((item) => ({
        relativePath: toSafeText(item?.relativePath || item?.relative),
        targetPath: toSafeText(item?.targetPath || item?.to)
      }))
      .filter((item) => item.relativePath || item.targetPath),
    usageType: Number(context.usageType || safePlan.usageType || 1),
    isRunnable: !!safePlan.isRunnable,
    launchAction: toSafeText(safePlan.launchAction),
    showInjectButton: !!safePlan.showInjectButton,
    enableExecutablePath: toSafeText(safePlan.enableExecutablePath),
    enableExecutableBaseType: toSafeText(safePlan.enableExecutableBaseType),
    launchArgs: Array.isArray(safePlan.launchArgs)
      ? safePlan.launchArgs.map((item) => toSafeText(item)).filter(Boolean)
      : [],
    postInstallSteps: Array.isArray(safePlan.postInstallSteps) ? safePlan.postInstallSteps : [],
    onEnableSteps: Array.isArray(safePlan.onEnableSteps) ? safePlan.onEnableSteps : [],
    onDisableSteps: Array.isArray(safePlan.onDisableSteps) ? safePlan.onDisableSteps : [],
    onUninstallSteps: Array.isArray(safePlan.onUninstallSteps) ? safePlan.onUninstallSteps : []
  }
}

export function writeInstallRulePlanMetadata(metadata = {}, plan = {}, context = {}) {
  const target = toSafeObject(metadata)
  const source = normalizeInstallRuleSource(context.source || plan?.source || '')
  const platform = getInstallRulePlatform(source)
  const planMetadata = buildInstallRulePlanMetadata(plan, {
    ...context,
    source
  })

  target.installRulePlan = planMetadata
  target.sourceInstallPlan = planMetadata
  if (platform.planFieldName) {
    target[platform.planFieldName] = planMetadata
  }
  if (source === 'nexus') {
    target.nexusInstallPlan = planMetadata
  }
  if (source === 'modio') {
    target.modioInstallPlan = planMetadata
  }
  if (source === 'ficsit') {
    target.ficsitInstallPlan = planMetadata
  }
  if (source === 'vamhub') {
    target.vamhubInstallPlan = planMetadata
  }
  return planMetadata
}

export function resolveInstallRulePlanFromMetadata(metadata = {}) {
  const target = toSafeObject(metadata)
  if (target.installRulePlan && typeof target.installRulePlan === 'object') {
    return target.installRulePlan
  }
  if (target.sourceInstallPlan && typeof target.sourceInstallPlan === 'object') {
    return target.sourceInstallPlan
  }

  const source = normalizeInstallRuleSource(target.sourceType || target.source || '')
  const platform = getInstallRulePlatform(source)
  const sourcePlan = platform.planFieldName ? target[platform.planFieldName] : null
  if (sourcePlan && typeof sourcePlan === 'object') {
    return sourcePlan
  }

  if (target.nexusInstallPlan && typeof target.nexusInstallPlan === 'object') {
    return target.nexusInstallPlan
  }
  if (target.modioInstallPlan && typeof target.modioInstallPlan === 'object') {
    return target.modioInstallPlan
  }
  if (target.ficsitInstallPlan && typeof target.ficsitInstallPlan === 'object') {
    return target.ficsitInstallPlan
  }
  if (target.vamhubInstallPlan && typeof target.vamhubInstallPlan === 'object') {
    return target.vamhubInstallPlan
  }
  return {}
}

export function normalizeStoredInstallRulePlan(metadata = {}) {
  const target = toSafeObject(metadata)
  const plan = resolveInstallRulePlanFromMetadata(target)
  return {
    ...plan,
    planId: toSafeText(plan?.planId),
    planSchemaVersion: Number(plan?.planSchemaVersion || 1),
    plannerVersion: toSafeText(plan?.plannerVersion),
    engineVersion: toSafeText(plan?.engineVersion),
    planner: plan?.planner && typeof plan.planner === 'object' ? plan.planner : {},
    sourceRoot: toSafeText(plan?.sourceRoot),
    targetRoot: toSafeText(plan?.targetRoot || target?.targetPath),
    targetBaseType: toSafeText(plan?.targetBaseType || 'game') || 'game',
    lifecycleStagingRoot: toSafeText(plan?.lifecycleStagingRoot || target?.stagingPath),
    operations: Array.isArray(plan?.operations) ? plan.operations : [],
    routes: Array.isArray(plan?.routes) ? plan.routes : [],
    routeOperations: Array.isArray(plan?.routeOperations) ? plan.routeOperations : [],
    coverageLedger: Array.isArray(plan?.coverageLedger) ? plan.coverageLedger : [],
    coverageSummary:
      plan?.coverageSummary && typeof plan.coverageSummary === 'object'
        ? plan.coverageSummary
        : {},
    dependencies: Array.isArray(plan?.dependencies) ? plan.dependencies : [],
    missedReasons: Array.isArray(plan?.missedReasons) ? plan.missedReasons : [],
    candidatePlans: Array.isArray(plan?.candidatePlans) ? plan.candidatePlans : [],
    changeSet: plan?.changeSet && typeof plan.changeSet === 'object' ? plan.changeSet : {},
    conflictResult:
      plan?.conflictResult && typeof plan.conflictResult === 'object' ? plan.conflictResult : {},
    dependencyResult:
      plan?.dependencyResult && typeof plan.dependencyResult === 'object'
        ? plan.dependencyResult
        : {},
    deployStrategy:
      plan?.deployStrategy && typeof plan.deployStrategy === 'object' ? plan.deployStrategy : {},
    transactionPlan:
      plan?.transactionPlan && typeof plan.transactionPlan === 'object'
        ? plan.transactionPlan
        : plan?.transaction && typeof plan.transaction === 'object'
          ? plan.transaction
          : {},
    packageType: toSafeText(plan?.packageType || plan?.packageProfile?.type || 'generic'),
    packageAdapter: toSafeText(plan?.packageAdapter || plan?.packageProfile?.adapter),
    packageProfile:
      plan?.packageProfile && typeof plan.packageProfile === 'object' ? plan.packageProfile : {},
    healthExpectations:
      plan?.healthExpectations && typeof plan.healthExpectations === 'object'
        ? plan.healthExpectations
        : {},
    replaySnapshot:
      plan?.replaySnapshot && typeof plan.replaySnapshot === 'object' ? plan.replaySnapshot : {},
    replayContext:
      plan?.replayContext && typeof plan.replayContext === 'object' ? plan.replayContext : {},
    autoExecutable: plan?.autoExecutable !== false && plan?.requiresUserConfirm !== true,
    requiresUserConfirm: plan?.requiresUserConfirm === true,
    confirmReason: toSafeText(plan?.confirmReason),
    warnings: Array.isArray(plan?.warnings) ? plan.warnings : [],
    risks: Array.isArray(plan?.risks) ? plan.risks : [],
    deployedFiles: Array.isArray(plan?.deployedFiles) ? plan.deployedFiles : [],
    postInstallSteps: Array.isArray(plan?.postInstallSteps) ? plan.postInstallSteps : [],
    onEnableSteps: Array.isArray(plan?.onEnableSteps) ? plan.onEnableSteps : [],
    onDisableSteps: Array.isArray(plan?.onDisableSteps) ? plan.onDisableSteps : [],
    onUninstallSteps: Array.isArray(plan?.onUninstallSteps) ? plan.onUninstallSteps : []
  }
}
