const MAX_DEFAULT_CONFLICT_PATHS = 100

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function buildConflictKey(endpointType = 0, deployDomain = '', targetRelativePath = '') {
  return `${toSafeNumber(endpointType)}::${toSafeText(deployDomain)}::${toSafeText(targetRelativePath)}`
}

function normalizeTargetRelativePath(value = '') {
  const text = toSafeText(value).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!text || text === '.') return ''
  const parts = text
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.')
  if (!parts.length || parts.includes('..')) return ''
  return parts.join('/')
}

function normalizeTargetRelativeKey(value = '') {
  return normalizeTargetRelativePath(value).toLowerCase()
}

function compareDeployOrder(left = {}, right = {}) {
  const priorityDiff = toSafeNumber(left.priorityOrder) - toSafeNumber(right.priorityOrder)
  if (priorityDiff !== 0) return priorityDiff
  return toSafeNumber(left.installedModId) - toSafeNumber(right.installedModId)
}

function resolvePredictedWinner(mods = []) {
  const activeMods = mods.filter((mod) => mod.isActive)
  if (!activeMods.length) return null
  return [...activeMods].sort(compareDeployOrder).at(-1) || null
}

function normalizeWinnerSnapshot(mod = null) {
  if (!mod) return null
  return {
    installedModId: toSafeNumber(mod.installedModId),
    name: toSafeText(mod.name),
    priorityOrder: toSafeNumber(mod.priorityOrder),
    source: toSafeText(mod.source),
    isCandidate: mod.isCandidate === true
  }
}

function normalizeOwnerRows(ownerRows = []) {
  const ownerMap = new Map()
  for (const row of Array.isArray(ownerRows) ? ownerRows : []) {
    const key = buildConflictKey(row.endpoint_type, row.deploy_domain, row.target_relative_path)
    ownerMap.set(key, {
      ownerModId: toSafeNumber(row.owner_mod_id),
      ownerPriorityOrder: toSafeNumber(row.owner_priority_order)
    })
  }
  return ownerMap
}

function normalizeManifestRow(row = {}) {
  return {
    endpointType: toSafeNumber(row.endpoint_type),
    deployDomain: toSafeText(row.deploy_domain),
    targetRelativePath: toSafeText(row.target_relative_path),
    installedModId: toSafeNumber(row.mod_id),
    name: toSafeText(row.mod_name),
    source: toSafeText(row.mod_source),
    priorityOrder: toSafeNumber(row.priority_order),
    isActive: toSafeNumber(row.is_active) === 1
  }
}

function createPrioritySuggestion(conflict = {}, activeMods = [], ledgerWinner = null) {
  if (activeMods.length <= 1) return null
  const predictedWinner = conflict.predictedWinner
  const targetWinner = ledgerWinner || predictedWinner
  if (!targetWinner) return null

  const maxPriority = Math.max(...activeMods.map((mod) => toSafeNumber(mod.priorityOrder)))
  const sortedActiveMods = [...activeMods].sort(compareDeployOrder)
  const targetAlreadyLast =
    sortedActiveMods.at(-1)?.installedModId === toSafeNumber(targetWinner.installedModId)

  if (targetAlreadyLast && !conflict.winnerMismatch) {
    return {
      type: 'review_priority_order',
      destructive: false,
      requiresConfirmation: false,
      targetWinnerModId: targetWinner.installedModId,
      targetWinnerName: targetWinner.name,
      currentOrder: sortedActiveMods.map((mod) => ({
        installedModId: mod.installedModId,
        name: mod.name,
        priorityOrder: mod.priorityOrder
      })),
      message: `${targetWinner.name || '当前生效模组'} 已是最高 priority_order；如当前生效结果不符合预期，请选择希望生效的模组并调整排序后重建部署。`
    }
  }

  return {
    type: 'reorder_priority',
    destructive: false,
    requiresConfirmation: false,
    targetWinnerModId: targetWinner.installedModId,
    targetWinnerName: targetWinner.name,
    proposedPriorityOrder: maxPriority + 1,
    currentOrder: sortedActiveMods.map((mod) => ({
      installedModId: mod.installedModId,
      name: mod.name,
      priorityOrder: mod.priorityOrder
    })),
    message: `如希望 ${targetWinner.name || '指定模组'} 生效，可将其 priority_order 调整到 ${maxPriority + 1} 或更高后重建部署。`
  }
}

function createDomainRebuildSuggestion(conflict = {}) {
  if (!conflict.winnerMismatch) return null
  return {
    type: 'domain_rebuild',
    destructive: true,
    requiresConfirmation: false,
    endpointType: conflict.endpointType,
    deployDomain: conflict.deployDomain,
    message:
      '账本生效方与按当前 priority_order 预测的生效方不一致，可能是部署账本过期；建议重建该部署域。'
  }
}

function normalizeSuggestedAction(action = {}) {
  return {
    type: toSafeText(action.type),
    destructive: action.destructive === true,
    requiresConfirmation: action.requiresConfirmation === true,
    targetWinnerModId: toSafeNumber(action.targetWinnerModId),
    targetWinnerName: toSafeText(action.targetWinnerName),
    message: toSafeText(action.message)
  }
}

function createRepairSuggestion(activeMods = [], suggestedActions = []) {
  const primaryAction =
    suggestedActions.find((action) => action?.type === 'reorder_priority') ||
    suggestedActions.find((action) => action?.type === 'domain_rebuild') ||
    suggestedActions.find((action) => action?.type === 'review_priority_order') ||
    null

  if (primaryAction) {
    return {
      type: primaryAction.type,
      destructive: primaryAction.destructive === true,
      requiresConfirmation: primaryAction.requiresConfirmation === true,
      message: primaryAction.message,
      actions: suggestedActions.map(normalizeSuggestedAction)
    }
  }

  if (activeMods.length <= 1) {
    return {
      type: 'no_action',
      destructive: false,
      requiresConfirmation: false,
      message: '冲突路径当前最多只有一个启用模组，无需调整加载顺序。',
      actions: []
    }
  }

  return {
    type: 'review_priority_order',
    destructive: false,
    requiresConfirmation: false,
    message: '多个启用模组声明同一目标路径，请复核当前 priority_order 是否符合预期。',
    actions: []
  }
}

function createConflictIssue(type = '', severity = 'info', message = '', extra = {}) {
  return {
    type,
    severity,
    message,
    ...extra
  }
}

function createConflictIssues(conflict = {}, activeMods = [], repairSuggestion = {}) {
  const issues = []
  const activeModCount = activeMods.length
  const modCount = Array.isArray(conflict.mods) ? conflict.mods.length : 0
  const candidateTargets = Array.isArray(conflict.candidateTargets) ? conflict.candidateTargets : []

  if (activeModCount > 1) {
    issues.push(
      createConflictIssue(
        'same_path_overlap',
        'warning',
        '多个启用中的模组声明了同一目标路径，最终生效方取决于部署加载顺序。',
        {
          activeModCount,
          repairSuggestion
        }
      )
    )
  } else if (modCount > 1) {
    issues.push(
      createConflictIssue(
        'inactive_overlap',
        'info',
        '该目标路径存在多模组声明，但当前最多只有一个模组启用。',
        {
          activeModCount,
          repairSuggestion
        }
      )
    )
  }

  if (conflict.winnerMismatch) {
    issues.push(
      createConflictIssue(
        'ledger_winner_mismatch',
        'warning',
        '账本生效方与按当前 priority_order 预测的生效方不一致，部署账本可能已经过期。',
        {
          ledgerWinner: conflict.ledgerWinner || null,
          predictedWinner: conflict.predictedWinner || null,
          repairSuggestion
        }
      )
    )
  }

  if (conflict.priorityInverted) {
    issues.push(
      createConflictIssue(
        'loading_order_issue',
        'warning',
        '当前 priority_order 会让预测生效方覆盖账本生效方，存在加载顺序倒挂风险。',
        {
          ledgerWinner: conflict.ledgerWinner || null,
          predictedWinner: conflict.predictedWinner || null,
          repairSuggestion
        }
      )
    )
  }

  if (candidateTargets.length) {
    const winnerBefore = normalizeWinnerSnapshot(conflict.candidateWinnerBefore)
    const winnerAfter = normalizeWinnerSnapshot(conflict.candidateWinnerAfter)
    issues.push(
      createConflictIssue(
        conflict.candidateWinnerChanged ? 'candidate_winner_change' : 'candidate_same_path_overlap',
        conflict.candidateWinnerChanged ? 'warning' : 'info',
        conflict.candidateWinnerChanged
          ? '候选安装计划会改变该目标路径的预测生效方。'
          : '候选安装计划会写入该目标路径，但预测生效方不变。',
        {
          candidateTargets,
          winnerBefore,
          winnerAfter,
          repairSuggestion
        }
      )
    )
  }

  return issues
}

function normalizePlanList(value = []) {
  return (Array.isArray(value) ? value : []).map((item) => toPlainJson(item, item)).filter(Boolean)
}

function appendPlanObject(result = [], seen = new Set(), candidate = null) {
  if (Array.isArray(candidate)) {
    candidate.forEach((item) => appendPlanObject(result, seen, item))
    return
  }
  if (!candidate || typeof candidate !== 'object') return
  const plan = toPlainJson(candidate, {})
  const key = toSafeText(
    plan.planId ||
      plan.id ||
      plan.modId ||
      plan.modReference ||
      plan.packageName ||
      JSON.stringify(plan).slice(0, 120)
  )
  if (seen.has(key)) return
  seen.add(key)
  result.push(plan)
}

function collectPlanObjects(options = {}) {
  const candidates = [
    options.installPlan,
    options.candidatePlan,
    options.plan,
    options.standardPreflight,
    options.standardPreflight?.standardInstallPlan,
    options.standardPreflight?.installPlan,
    options.standardPreflight?.plan
  ]
  const result = []
  const seen = new Set()
  for (const candidate of candidates) {
    appendPlanObject(result, seen, candidate)
  }
  return result
}

function resolveCandidateEndpointType(plan = {}, options = {}) {
  return toSafeNumber(
    plan.endpointType ?? plan.endpoint_type ?? plan.deployScope?.endpointType ?? options.endpointType,
    0
  )
}

function resolveCandidateDeployDomain(plan = {}, options = {}) {
  return toSafeText(
    plan.deployDomain ||
      plan.deploy_domain ||
      plan.domainName ||
      plan.gameDomainName ||
      plan.deployScope?.deployDomain ||
      plan.deployScope?.deploy_domain ||
      options.deployDomain
  )
}

function resolveCandidateName(plan = {}, options = {}) {
  return toSafeText(
    plan.candidateName ||
      plan.modName ||
      plan.name ||
      plan.title ||
      plan.displayName ||
      plan.packageName ||
      plan.modReference ||
      options.candidateModName,
    '候选安装包'
  )
}

function collectTargetEntriesFromPlan(plan = {}) {
  const entries = []
  const pushList = (value, source) => {
    if (!Array.isArray(value)) return
    value.forEach((item) => {
      if (item && typeof item === 'object') {
        entries.push({ item, source })
      }
    })
  }

  pushList(plan.changeSet?.entries, 'changeSet.entries')
  pushList(plan.changeSet?.items, 'changeSet.items')
  pushList(plan.operations, 'operations')
  pushList(plan.routeOperations, 'routeOperations')
  pushList(plan.coverageLedger, 'coverageLedger')

  if (!entries.length) {
    pushList(plan.routes, 'routes')
  }

  if (!entries.length && normalizeTargetRelativePath(plan.targetRelativePath)) {
    entries.push({ item: plan, source: 'plan.targetRelativePath' })
  }

  return entries
}

function resolveTargetPathFromEntry(entry = {}) {
  return normalizeTargetRelativePath(
    entry.targetRelativePath ||
      entry.target_relative_path ||
      entry.relativeTargetPath ||
      entry.relative_target_path ||
      entry.relativePath ||
      entry.relative_path ||
      entry.relative ||
      entry.path
  )
}

function createCandidateTarget(rawTarget = {}, source = '', index = 0, plan = {}, options = {}) {
  const targetRelativePath = resolveTargetPathFromEntry(rawTarget)
  if (!targetRelativePath) return null

  return {
    targetRelativePath,
    targetRelativeKey: normalizeTargetRelativeKey(targetRelativePath),
    endpointType: resolveCandidateEndpointType(rawTarget, {
      endpointType: resolveCandidateEndpointType(plan, options)
    }),
    deployDomain: resolveCandidateDeployDomain(rawTarget, {
      deployDomain: resolveCandidateDeployDomain(plan, options)
    }),
    candidateModId: toSafeNumber(
      rawTarget.candidateModId ||
        rawTarget.modId ||
        rawTarget.mod_id ||
        plan.candidateModId ||
        plan.modId ||
        plan.mod_id ||
        options.candidateModId,
      0
    ),
    candidateName: resolveCandidateName(rawTarget, {
      candidateModName: resolveCandidateName(plan, options)
    }),
    source: toSafeText(rawTarget.source || plan.source || options.source),
    priorityOrder: toSafeNumber(
      rawTarget.priorityOrder ||
        rawTarget.priority_order ||
        plan.priorityOrder ||
        plan.priority_order ||
        options.candidatePriorityOrder,
      0
    ),
    sourceField: source,
    sortIndex: index
  }
}

function candidateTargetMatchesConflict(target = {}, conflict = {}) {
  if (target.targetRelativeKey !== normalizeTargetRelativeKey(conflict.targetRelativePath)) {
    return false
  }
  if (toSafeNumber(target.endpointType, 0) !== toSafeNumber(conflict.endpointType, 0)) {
    return false
  }
  const targetDeployDomain = toSafeText(target.deployDomain)
  return !targetDeployDomain || targetDeployDomain === toSafeText(conflict.deployDomain)
}

function createCandidateModSnapshot(target = {}, index = 0, activeMods = []) {
  const maxPriority = Math.max(0, ...activeMods.map((mod) => toSafeNumber(mod.priorityOrder)))
  const priorityOrder = toSafeNumber(target.priorityOrder, 0) || maxPriority + index + 1
  const candidateId = toSafeNumber(target.candidateModId, 0) || -(index + 1)

  return {
    installedModId: candidateId,
    name: target.candidateName,
    source: target.source,
    priorityOrder,
    isActive: true,
    isCandidate: true,
    targetRelativePath: target.targetRelativePath
  }
}

export function collectCandidateInstallTargets(options = {}) {
  const targets = []
  const seen = new Set()
  const addTarget = (target) => {
    if (!target) return
    const key = [
      target.endpointType,
      target.deployDomain,
      target.targetRelativeKey,
      target.candidateModId,
      target.candidateName
    ].join('|')
    if (seen.has(key)) return
    seen.add(key)
    targets.push(target)
  }

  if (Array.isArray(options.candidateTargets)) {
    options.candidateTargets.forEach((target, index) => {
      addTarget(createCandidateTarget(target, 'candidateTargets', index, target, options))
    })
  }

  for (const plan of collectPlanObjects(options)) {
    collectTargetEntriesFromPlan(plan).forEach(({ item, source }, index) => {
      addTarget(createCandidateTarget(item, source, index, plan, options))
    })
  }

  return targets
}

function normalizeRuleMissReason(reason = {}, index = 0, plan = {}) {
  if (typeof reason === 'string') {
    const message = toSafeText(reason)
    if (!message) return null
    return {
      type: 'rule_not_matched',
      severity: 'warning',
      code: 'rule_not_matched',
      message,
      ruleId: toSafeText(plan.ruleId || plan.explain?.matchedRuleId),
      sortIndex: index,
      detail: {}
    }
  }

  if (!reason || typeof reason !== 'object') return null
  const detail = toPlainJson(reason.details || reason.detail || {}, {})
  const code = toSafeText(reason.code || reason.reason || reason.type, 'rule_not_matched')
  const message = toSafeText(
    reason.message ||
      reason.description ||
      reason.reasonText ||
      reason.reason ||
      code ||
      '安装规则未命中'
  )

  return {
    type: 'rule_not_matched',
    severity: toSafeText(reason.severity || reason.level, 'warning'),
    code,
    message,
    ruleId: toSafeText(reason.ruleId || reason.rule_id || plan.ruleId || plan.explain?.matchedRuleId),
    matcher: toSafeText(reason.matcher || reason.matcherPath || reason.path),
    sortIndex: index,
    detail
  }
}

function createRuleNotMatchedRepairSuggestion(issues = []) {
  if (!issues.length) {
    return {
      type: 'no_action',
      destructive: false,
      requiresConfirmation: false,
      message: '未发现安装规则未命中诊断。',
      actions: []
    }
  }

  return {
    type: 'review_install_rule',
    destructive: false,
    requiresConfirmation: false,
    message: '安装规则未命中，请复核安装规则 matcher、source 选择、压缩包结构和目标路径配置后重新生成安装计划。',
    actions: [
      {
        type: 'review_install_rule',
        destructive: false,
        requiresConfirmation: false,
        message: '检查 installRule.matchers / source / target 与压缩包结构是否匹配。'
      },
      {
        type: 'replan_install',
        destructive: false,
        requiresConfirmation: false,
        message: '修正规则或补齐上下文后重新调用安装预检。'
      }
    ]
  }
}

function createRuleNotMatchedDiagnostics(options = {}) {
  const issues = []
  const seen = new Set()
  const plans = collectPlanObjects(options)

  for (const plan of plans) {
    const missedReasons = [
      ...normalizePlanList(plan.missedReasons),
      ...normalizePlanList(plan.explain?.missedReasons),
      ...normalizePlanList(plan.standardPreflight?.standardInstallPlan?.missedReasons),
      ...normalizePlanList(plan.standardPreflight?.installPlan?.missedReasons)
    ]

    missedReasons.forEach((reason, index) => {
      const issue = normalizeRuleMissReason(reason, index, plan)
      if (!issue) return
      const key = [
        issue.code,
        issue.ruleId,
        issue.matcher,
        issue.message,
        JSON.stringify(issue.detail)
      ].join('|')
      if (seen.has(key)) return
      seen.add(key)
      issues.push(issue)
    })

    const confirmReason = toSafeText(
      plan.confirmReason || plan.message || plan.reason || plan.standardPreflight?.message
    )
    const looksUnmatched = /规则未命中|未命中安装规则|rule[_ -]?not[_ -]?matched|rule unmatched|no match/i.test(
      confirmReason
    )
    if (looksUnmatched) {
      const issue = normalizeRuleMissReason(
        {
          code: 'rule_not_matched',
          message: confirmReason
        },
        issues.length,
        plan
      )
      const key = [issue.code, issue.ruleId, issue.message].join('|')
      if (!seen.has(key)) {
        seen.add(key)
        issues.push(issue)
      }
    }
  }

  return {
    hasRuleNotMatched: issues.length > 0,
    ruleNotMatchedCount: issues.length,
    installPlanIssues: issues,
    installRuleRepairSuggestion: createRuleNotMatchedRepairSuggestion(issues)
  }
}

function summarizePairs(conflicts = []) {
  const pairCounter = new Map()
  for (const conflict of conflicts) {
    const activeMods = conflict.mods.filter((mod) => mod.isActive)
    for (let i = 0; i < activeMods.length; i += 1) {
      for (let j = i + 1; j < activeMods.length; j += 1) {
        const pairKey = [activeMods[i].installedModId, activeMods[j].installedModId]
          .sort((a, b) => a - b)
          .join('-')
        const entry = pairCounter.get(pairKey) || {
          modAId: activeMods[i].installedModId,
          modA: activeMods[i].name,
          modBId: activeMods[j].installedModId,
          modB: activeMods[j].name,
          overlapCount: 0
        }
        entry.overlapCount += 1
        pairCounter.set(pairKey, entry)
      }
    }
  }
  return [...pairCounter.values()].sort((a, b) => b.overlapCount - a.overlapCount).slice(0, 20)
}

export function createConflictAnalysisFromRows(rows = [], ownerRows = [], options = {}) {
  const maxConflictPaths = Math.max(1, toSafeNumber(options.maxConflictPaths, MAX_DEFAULT_CONFLICT_PATHS))
  const ownerMap = normalizeOwnerRows(ownerRows)
  const pathMap = new Map()
  const ruleDiagnostics = createRuleNotMatchedDiagnostics(options)
  const candidateTargets = collectCandidateInstallTargets(options)

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const row = normalizeManifestRow(rawRow)
    const key = buildConflictKey(row.endpointType, row.deployDomain, row.targetRelativePath)
    if (!pathMap.has(key)) {
      const owner = ownerMap.get(key) || { ownerModId: 0, ownerPriorityOrder: 0 }
      pathMap.set(key, {
        endpointType: row.endpointType,
        deployDomain: row.deployDomain,
        targetRelativePath: row.targetRelativePath,
        winnerModId: owner.ownerModId,
        ownerPriorityOrder: owner.ownerPriorityOrder,
        mods: []
      })
    }
    pathMap.get(key).mods.push({
      installedModId: row.installedModId,
      name: row.name,
      source: row.source,
      priorityOrder: row.priorityOrder,
      isActive: row.isActive
    })
  }

  const allConflicts = [...pathMap.values()].map((conflict) => {
    const mods = [...conflict.mods].sort(compareDeployOrder)
    const activeMods = mods.filter((mod) => mod.isActive)
    const ledgerWinner = mods.find((mod) => mod.installedModId === conflict.winnerModId) || null
    const predictedWinner = resolvePredictedWinner(mods)
    const winner = ledgerWinner || predictedWinner || null
    const matchedCandidateTargets = candidateTargets.filter((target) =>
      candidateTargetMatchesConflict(target, conflict)
    )
    const candidateMods = matchedCandidateTargets.map((target, index) =>
      createCandidateModSnapshot(target, index, activeMods)
    )
    const candidateWinnerBefore = winner
    const candidateWinnerAfter = candidateMods.length
      ? resolvePredictedWinner([...mods, ...candidateMods])
      : null
    const candidateWinnerChanged =
      !!candidateWinnerBefore &&
      !!candidateWinnerAfter &&
      toSafeNumber(candidateWinnerBefore.installedModId) !==
        toSafeNumber(candidateWinnerAfter.installedModId)
    const winnerMismatch =
      !!ledgerWinner &&
      !!predictedWinner &&
      toSafeNumber(ledgerWinner.installedModId) !== toSafeNumber(predictedWinner.installedModId)
    const priorityInverted =
      !!ledgerWinner &&
      activeMods.length > 1 &&
      toSafeNumber(ledgerWinner.installedModId) !== toSafeNumber(predictedWinner?.installedModId)
    const prioritySuggestion = createPrioritySuggestion(
      {
        ...conflict,
        mods,
        predictedWinner,
        winnerMismatch
      },
      activeMods,
      ledgerWinner
    )
    const domainRebuildSuggestion = createDomainRebuildSuggestion({
      ...conflict,
      winnerMismatch
    })
    const suggestedActions = [prioritySuggestion, domainRebuildSuggestion].filter(Boolean)
    const repairSuggestion = createRepairSuggestion(activeMods, suggestedActions)
    const issueContext = {
      ...conflict,
      mods,
      ledgerWinner: ledgerWinner
        ? {
            installedModId: ledgerWinner.installedModId,
            name: ledgerWinner.name,
            priorityOrder: ledgerWinner.priorityOrder
          }
        : null,
      predictedWinner: predictedWinner
        ? {
            installedModId: predictedWinner.installedModId,
            name: predictedWinner.name,
            priorityOrder: predictedWinner.priorityOrder
          }
        : null,
      winnerMismatch,
      priorityInverted,
      candidateTargets: matchedCandidateTargets,
      candidateWinnerBefore,
      candidateWinnerAfter,
      candidateWinnerChanged
    }
    const issues = createConflictIssues(issueContext, activeMods, repairSuggestion)

    return {
      ...toPlainJson(conflict, {}),
      mods,
      activeModCount: activeMods.length,
      severity: candidateWinnerChanged
        ? 'warning'
        : winnerMismatch
          ? 'warning'
          : activeMods.length > 1
            ? 'warning'
            : 'info',
      winnerModId: winner?.installedModId || conflict.winnerModId || 0,
      winnerName: winner?.name || '',
      ledgerWinner: ledgerWinner
        ? {
            installedModId: ledgerWinner.installedModId,
            name: ledgerWinner.name,
            priorityOrder: ledgerWinner.priorityOrder
          }
        : null,
      predictedWinner: predictedWinner
        ? {
            installedModId: predictedWinner.installedModId,
            name: predictedWinner.name,
            priorityOrder: predictedWinner.priorityOrder
          }
        : null,
      winnerMismatch,
      priorityInverted,
      candidateTargets: matchedCandidateTargets,
      candidateMods,
      candidateWinnerBefore: normalizeWinnerSnapshot(candidateWinnerBefore),
      candidateWinnerAfter: normalizeWinnerSnapshot(candidateWinnerAfter),
      candidateWinnerChanged,
      issues,
      repairSuggestion,
      suggestedActions,
      note: candidateWinnerChanged
        ? '候选安装计划会改变该目标路径的预测生效方，请在安装前确认覆盖结果。'
        : winnerMismatch
          ? '账本生效方与当前 priority_order 预测不一致，建议检查排序并重建部署域。'
          : activeMods.length > 1
            ? '多个启用中的模组声明了同一目标路径，实际生效方由 priority_order 越大越晚覆盖决定。'
            : '冲突模组中只有一个处于启用状态，当前无实际覆盖影响。'
    }
  })

  const conflicts = allConflicts.slice(0, maxConflictPaths)
  const candidateWinnerChanges = allConflicts
    .filter((conflict) => conflict.candidateWinnerChanged)
    .map((conflict) => ({
      endpointType: conflict.endpointType,
      deployDomain: conflict.deployDomain,
      targetRelativePath: conflict.targetRelativePath,
      winnerBefore: conflict.candidateWinnerBefore,
      winnerAfter: conflict.candidateWinnerAfter,
      candidateTargets: conflict.candidateTargets
    }))
  const suggestedActions = conflicts
    .flatMap((conflict) =>
      conflict.suggestedActions.map((action) => ({
        ...action,
        targetRelativePath: conflict.targetRelativePath,
        deployDomain: conflict.deployDomain,
        endpointType: conflict.endpointType
      }))
    )
    .slice(0, 20)

  return {
    conflictCount: allConflicts.length,
    truncated: allConflicts.length > maxConflictPaths,
    conflicts,
    modPairSummary: summarizePairs(allConflicts),
    suggestedActions,
    candidateTargetCount: candidateTargets.length,
    candidateWinnerChanges,
    hasWinnerMismatch: allConflicts.some((conflict) => conflict.winnerMismatch),
    hasPriorityInversion: allConflicts.some((conflict) => conflict.priorityInverted),
    hasCandidateWinnerChange: candidateWinnerChanges.length > 0,
    candidateWinnerChangeCount: candidateWinnerChanges.length,
    hasLoadingOrderIssue: allConflicts.some((conflict) =>
      conflict.issues.some((issue) => issue.type === 'loading_order_issue')
    ),
    loadingOrderIssueCount: allConflicts.filter((conflict) =>
      conflict.issues.some((issue) => issue.type === 'loading_order_issue')
    ).length,
    issueSummary: {
      samePathOverlapCount: allConflicts.filter((conflict) =>
        conflict.issues.some((issue) => issue.type === 'same_path_overlap')
      ).length,
      loadingOrderIssueCount: allConflicts.filter((conflict) =>
        conflict.issues.some((issue) => issue.type === 'loading_order_issue')
      ).length,
      candidateWinnerChangeCount: candidateWinnerChanges.length,
      winnerMismatchCount: allConflicts.filter((conflict) => conflict.winnerMismatch).length,
      ruleNotMatchedCount: ruleDiagnostics.ruleNotMatchedCount
    },
    ...ruleDiagnostics
  }
}
