const MAX_DEFAULT_REPAIR_ACTIONS = 20

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function compareDeployOrder(left = {}, right = {}) {
  const priorityDiff = toSafeNumber(left.priorityOrder) - toSafeNumber(right.priorityOrder)
  if (priorityDiff !== 0) return priorityDiff
  return toSafeNumber(left.installedModId) - toSafeNumber(right.installedModId)
}

function buildPlanId() {
  return `conflict-repair-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function buildActionId(type = '', conflict = {}, suffix = '') {
  return [
    'conflict-repair',
    toSafeText(type),
    toSafeNumber(conflict.endpointType),
    toSafeText(conflict.deployDomain),
    toSafeText(conflict.targetRelativePath),
    toSafeText(suffix)
  ]
    .filter(Boolean)
    .join(':')
}

function normalizeMod(mod = {}) {
  return {
    installedModId: toSafeNumber(mod.installedModId),
    name: toSafeText(mod.name),
    source: toSafeText(mod.source),
    priorityOrder: toSafeNumber(mod.priorityOrder),
    isActive: mod.isActive === true
  }
}

function getActiveMods(conflict = {}) {
  return (Array.isArray(conflict.mods) ? conflict.mods : [])
    .map(normalizeMod)
    .filter((mod) => mod.isActive && mod.installedModId > 0)
    .sort(compareDeployOrder)
}

function getUniqueActiveSources(activeMods = []) {
  return [
    ...new Set(
      activeMods
        .map((mod) => toSafeText(mod.source))
        .filter(Boolean)
    )
  ]
}

function findTargetWinner(conflict = {}, activeMods = [], options = {}, suggestion = {}) {
  const preferredWinnerModId = toSafeNumber(options.preferredWinnerModId)
  const suggestedWinnerModId = toSafeNumber(suggestion.targetWinnerModId)
  const ledgerWinnerModId = toSafeNumber(conflict.ledgerWinner?.installedModId)
  const predictedWinnerModId = toSafeNumber(conflict.predictedWinner?.installedModId)
  const targetWinnerModId =
    preferredWinnerModId || suggestedWinnerModId || ledgerWinnerModId || predictedWinnerModId

  return activeMods.find((mod) => mod.installedModId === targetWinnerModId) || null
}

function createReviewAction(conflict = {}, activeMods = [], targetWinner = null) {
  if (!targetWinner) return null
  return {
    id: buildActionId('review_priority_order', conflict, targetWinner.installedModId),
    type: 'review_priority_order',
    title: '复核 priority_order',
    destructive: false,
    requiresConfirmation: false,
    targetRelativePath: toSafeText(conflict.targetRelativePath),
    endpointType: toSafeNumber(conflict.endpointType),
    deployDomain: toSafeText(conflict.deployDomain),
    targetWinnerModId: targetWinner.installedModId,
    targetWinnerName: targetWinner.name,
    currentOrder: activeMods.map((mod) => ({
      installedModId: mod.installedModId,
      name: mod.name,
      source: mod.source,
      priorityOrder: mod.priorityOrder
    })),
    message:
      '目标模组已处于当前排序末尾；如实际生效结果仍不符合预期，请在确认后重建部署域。'
  }
}

function createReorderAction(conflict = {}, activeMods = [], targetWinner = null) {
  if (!targetWinner || activeMods.length <= 1) return null

  const currentLast = activeMods.at(-1)
  if (
    currentLast?.installedModId === targetWinner.installedModId &&
    conflict.winnerMismatch !== true
  ) {
    return createReviewAction(conflict, activeMods, targetWinner)
  }

  const sources = getUniqueActiveSources(activeMods)
  const source = sources.length === 1 ? sources[0] : ''
  const orderIds = [
    ...activeMods
      .filter((mod) => mod.installedModId !== targetWinner.installedModId)
      .map((mod) => mod.installedModId),
    targetWinner.installedModId
  ]

  return {
    id: buildActionId('reorder_priority', conflict, targetWinner.installedModId),
    type: 'reorder_priority',
    title: '调整 priority_order 后重建部署域',
    destructive: true,
    requiresConfirmation: false,
    targetRelativePath: toSafeText(conflict.targetRelativePath),
    endpointType: toSafeNumber(conflict.endpointType),
    deployDomain: toSafeText(conflict.deployDomain),
    source,
    targetWinnerModId: targetWinner.installedModId,
    targetWinnerName: targetWinner.name,
    canExecuteWithExistingSortApi: sources.length === 1,
    currentOrder: activeMods.map((mod) => ({
      installedModId: mod.installedModId,
      name: mod.name,
      source: mod.source,
      priorityOrder: mod.priorityOrder
    })),
    proposedOrder: orderIds.map((id, index) => ({
      installedModId: id,
      priorityOrder: index
    })),
    executionPayload: {
      actionType: 'reorder_priority',
      ids: orderIds,
      source,
      endpointType: toSafeNumber(conflict.endpointType),
      deployDomain: toSafeText(conflict.deployDomain),
      targetRelativePath: toSafeText(conflict.targetRelativePath),
      targetWinnerModId: targetWinner.installedModId,
      reason: 'agent_conflict_repair_priority'
    },
    message: sources.length === 1
      ? `将 ${targetWinner.name || '目标模组'} 放到当前部署顺序末尾，再重建部署域。`
      : '该冲突涉及多个来源，当前排序保存接口只能处理同一来源；需要按来源拆分处理。'
  }
}

function createDomainRebuildActions(conflict = {}, activeMods = [], options = {}) {
  if (!toSafeBoolean(options.includeDomainRebuild, true)) return []

  const sources = getUniqueActiveSources(activeMods)
  return sources.map((source) => {
    const scope = {
      gameId: toSafeNumber(options.gameId),
      source,
      endpointType: toSafeNumber(conflict.endpointType),
      deployDomain: toSafeText(conflict.deployDomain)
    }
    return {
      id: buildActionId('domain_rebuild', conflict, source),
      type: 'domain_rebuild',
      title: '重建部署域',
      destructive: true,
      requiresConfirmation: false,
      targetRelativePath: toSafeText(conflict.targetRelativePath),
      endpointType: scope.endpointType,
      deployDomain: scope.deployDomain,
      source,
      scope,
      executionPayload: {
        actionType: 'domain_rebuild',
        scope,
        targetRelativePath: toSafeText(conflict.targetRelativePath),
        reason: 'agent_conflict_repair_rebuild'
      },
      message: '重建部署域以刷新文件归属账本和实际覆盖结果。'
    }
  })
}

function createDisableModActions(conflict = {}, activeMods = [], targetWinner = null, options = {}) {
  if (!toSafeBoolean(options.includeDisableMod, false)) return []

  const targetWinnerModId = toSafeNumber(targetWinner?.installedModId)
  if (targetWinnerModId <= 0) return []
  return activeMods
    .filter((mod) => mod.installedModId > 0 && mod.installedModId !== targetWinnerModId)
    .map((mod) => ({
      id: buildActionId('disable_mod', conflict, mod.installedModId),
      type: 'disable_mod',
      title: '禁用冲突模组',
      destructive: true,
      requiresConfirmation: false,
      targetRelativePath: toSafeText(conflict.targetRelativePath),
      endpointType: toSafeNumber(conflict.endpointType),
      deployDomain: toSafeText(conflict.deployDomain),
      installedModId: mod.installedModId,
      modName: mod.name,
      source: mod.source,
      targetWinnerModId,
      targetWinnerName: toSafeText(targetWinner?.name),
      executionPayload: {
        actionType: 'disable_mod',
        installedModId: mod.installedModId,
        targetWinnerModId,
        endpointType: toSafeNumber(conflict.endpointType),
        deployDomain: toSafeText(conflict.deployDomain),
        targetRelativePath: toSafeText(conflict.targetRelativePath),
        reason: 'agent_conflict_repair_disable_mod'
      },
      message: `禁用 ${mod.name || '指定模组'}，让 ${targetWinner?.name || '目标模组'} 保持生效。`
    }))
}

function createUninstallModActions(conflict = {}, activeMods = [], targetWinner = null, options = {}) {
  if (!toSafeBoolean(options.includeUninstallMod, false)) return []

  const targetWinnerModId = toSafeNumber(targetWinner?.installedModId)
  if (targetWinnerModId <= 0) return []
  return activeMods
    .filter((mod) => mod.installedModId > 0 && mod.installedModId !== targetWinnerModId)
    .map((mod) => ({
      id: buildActionId('uninstall_mod', conflict, mod.installedModId),
      type: 'uninstall_mod',
      title: '卸载冲突模组',
      destructive: true,
      requiresConfirmation: false,
      targetRelativePath: toSafeText(conflict.targetRelativePath),
      endpointType: toSafeNumber(conflict.endpointType),
      deployDomain: toSafeText(conflict.deployDomain),
      installedModId: mod.installedModId,
      modName: mod.name,
      source: mod.source,
      targetWinnerModId,
      targetWinnerName: toSafeText(targetWinner?.name),
      executionPayload: {
        actionType: 'uninstall_mod',
        installedModId: mod.installedModId,
        force: false,
        targetWinnerModId,
        endpointType: toSafeNumber(conflict.endpointType),
        deployDomain: toSafeText(conflict.deployDomain),
        targetRelativePath: toSafeText(conflict.targetRelativePath),
        reason: 'agent_conflict_repair_uninstall_mod'
      },
      message: `卸载 ${mod.name || '指定模组'}，让 ${targetWinner?.name || '目标模组'} 保持生效。`
    }))
}

function normalizeDependencySummary(dependency = {}) {
  return {
    source: toSafeText(dependency.source),
    id: toSafeText(dependency.id),
    modReference: toSafeText(dependency.modReference),
    packageFullName: toSafeText(dependency.packageFullName),
    name: toSafeText(dependency.name),
    version: toSafeText(dependency.version),
    installState: toSafeText(dependency.installState)
  }
}

function createInstallMissingAction(options = {}) {
  if (!toSafeBoolean(options.includeInstallMissing, false)) return null

  const dependencyResult = toPlainJson(options.dependencyResult, {})
  const payload = toPlainJson(
    dependencyResult.sourceInstallTaskPayload || options.sourceInstallTaskPayload,
    {}
  )
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) return null

  const source = toSafeText(dependencyResult.source || payload.source)
  const dependencies = (Array.isArray(dependencyResult.dependencies)
    ? dependencyResult.dependencies
    : []
  ).map(normalizeDependencySummary)
  const pendingDependencies = dependencies.filter(
    (dependency) => dependency.installState === 'pending'
  )
  const rootName = toSafeText(
    dependencyResult.root?.name ||
      dependencyResult.root?.modReference ||
      payload.metadata?.requestModReference ||
      payload.title
  )

  return {
    id: [
      'conflict-repair',
      'install_missing',
      source,
      toSafeText(payload.sourceGameId),
      toSafeText(dependencyResult.root?.id || dependencyResult.root?.modReference || rootName)
    ]
      .filter(Boolean)
      .join(':'),
    type: 'install_missing',
    title: '补装缺失依赖',
    destructive: true,
    requiresConfirmation: false,
    source,
    sourceLabel: toSafeText(dependencyResult.sourceLabel),
    rootName,
    dependencyCount: toSafeNumber(dependencyResult.dependencyCount, dependencies.length),
    pendingInstallCount: toSafeNumber(dependencyResult.pendingInstallCount, items.length),
    dependencies: pendingDependencies.length ? pendingDependencies : dependencies,
    sourceInstallTaskPayload: payload,
    executionPayload: {
      actionType: 'install_missing',
      sourceInstallTaskPayload: payload,
      reason: 'agent_conflict_repair_install_missing'
    },
    message: `确认后将 ${items.length} 个安装项加入安装任务中心，用于补装${rootName ? ` ${rootName}` : ''} 的缺失依赖。`
  }
}

function shouldIncludeConflict(conflict = {}, options = {}) {
  const targetRelativePath = toSafeText(options.targetRelativePath)
  if (!targetRelativePath) return true
  return toSafeText(conflict.targetRelativePath).toLowerCase() === targetRelativePath.toLowerCase()
}

function addUniqueAction(actions = [], action = null, actionKeySet = new Set()) {
  if (!action?.id || actionKeySet.has(action.id)) return
  actionKeySet.add(action.id)
  actions.push(action)
}

export function createConflictRepairPlan(conflictAnalysis = {}, options = {}) {
  const conflicts = (Array.isArray(conflictAnalysis.conflicts) ? conflictAnalysis.conflicts : [])
    .filter((conflict) => shouldIncludeConflict(conflict, options))
  const maxActions = Math.max(1, toSafeNumber(options.maxActions, MAX_DEFAULT_REPAIR_ACTIONS))
  const actions = []
  const actionKeySet = new Set()

  addUniqueAction(actions, createInstallMissingAction(options), actionKeySet)

  for (const conflict of conflicts) {
    const activeMods = getActiveMods(conflict)
    if (activeMods.length <= 1) continue

    const suggestions = Array.isArray(conflict.suggestedActions) ? conflict.suggestedActions : []
    const hasPreferredWinner = toSafeNumber(options.preferredWinnerModId) > 0
    const shouldPlanReorder =
      hasPreferredWinner ||
      suggestions.some((suggestion) => suggestion?.type === 'reorder_priority')
    const shouldPlanDomainRebuild =
      suggestions.some((suggestion) => suggestion?.type === 'domain_rebuild') ||
      conflict.winnerMismatch === true
    const reorderSuggestion =
      suggestions.find((suggestion) => suggestion?.type === 'reorder_priority') || {}
    const targetWinner = findTargetWinner(conflict, activeMods, options, reorderSuggestion)

    if (shouldPlanReorder) {
      addUniqueAction(actions, createReorderAction(conflict, activeMods, targetWinner), actionKeySet)
    }

    if (shouldPlanDomainRebuild) {
      for (const action of createDomainRebuildActions(conflict, activeMods, options)) {
        addUniqueAction(actions, action, actionKeySet)
      }
    }

    for (const action of createDisableModActions(conflict, activeMods, targetWinner, options)) {
      addUniqueAction(actions, action, actionKeySet)
    }

    for (const action of createUninstallModActions(conflict, activeMods, targetWinner, options)) {
      addUniqueAction(actions, action, actionKeySet)
    }
  }

  const limitedActions = actions.slice(0, maxActions)
  return {
    planId: buildPlanId(),
    status: limitedActions.length ? 'planned' : 'empty',
    conflictCount: toSafeNumber(conflictAnalysis.conflictCount, conflicts.length),
    consideredConflictCount: conflicts.length,
    actionCount: limitedActions.length,
    truncated: actions.length > maxActions,
    actions: limitedActions,
    message: limitedActions.length
      ? `已生成 ${limitedActions.length} 个冲突修复计划动作；仅全部禁用或全部删除类动作需要再次确认。`
      : '当前筛选条件下没有可生成的冲突修复动作。'
  }
}
