import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeList(value) {
  return Array.isArray(value) ? value : []
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function getStandardPlan(plan = {}) {
  const standardPreflight = isPlainObject(plan.standardPreflight) ? plan.standardPreflight : {}
  return isPlainObject(standardPreflight.standardInstallPlan)
    ? standardPreflight.standardInstallPlan
    : {}
}

function normalizeDependencyItem(item = {}) {
  if (typeof item === 'string' || typeof item === 'number') {
    const text = toSafeText(item)
    return text
      ? {
          id: text,
          name: text,
          installState: 'missing'
        }
      : null
  }
  if (!isPlainObject(item)) return null

  const id = toSafeText(
    item.id ||
      item.modId ||
      item.modReference ||
      item.packageFullName ||
      item.fullName ||
      item.sourceModKey ||
      item.name
  )
  const name = toSafeText(item.name || item.displayName || item.modReference || item.packageName, id)
  if (!id && !name) return null

  return {
    ...item,
    id: id || name,
    name: name || id,
    installState: toSafeText(item.installState || item.status, 'missing')
  }
}

function collectDependencyCandidates(plan = {}) {
  const standardPlan = getStandardPlan(plan)
  const dependencyResult = isPlainObject(standardPlan.dependencyResult)
    ? standardPlan.dependencyResult
    : isPlainObject(plan.dependencyResult)
      ? plan.dependencyResult
      : {}

  return [
    ...toSafeList(plan.missingDependencies),
    ...toSafeList(standardPlan.missingDependencies),
    ...toSafeList(dependencyResult.missingDependencies),
    ...toSafeList(dependencyResult.missing),
    ...toSafeList(dependencyResult.dependencies).filter(
      (item) => toSafeText(item?.installState || item?.status) !== 'reused_installed'
    )
  ]
}

export function resolvePlanMissingDependencies(plan = {}, limit = 4) {
  const seen = new Set()
  const result = []

  for (const item of collectDependencyCandidates(plan)) {
    const normalized = normalizeDependencyItem(item)
    if (!normalized) continue
    const key = toSafeText(
      normalized.sourceModKey ||
        normalized.modId ||
        normalized.modReference ||
        normalized.packageFullName ||
        normalized.fullName ||
        normalized.id ||
        normalized.name
    ).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= limit) break
  }

  return result
}

function resolveWinnerName(winner = null) {
  if (!isPlainObject(winner)) return ''
  return toSafeText(
    winner.name ||
      winner.modName ||
      winner.candidateName ||
      winner.displayName ||
      winner.installedModId ||
      winner.modId
  )
}

function resolveConflictWinnerMessage(conflict = {}) {
  const candidateAfter = isPlainObject(conflict.candidateWinnerAfter)
    ? conflict.candidateWinnerAfter
    : null
  const candidateBefore = isPlainObject(conflict.candidateWinnerBefore)
    ? conflict.candidateWinnerBefore
    : null
  if (candidateAfter) {
    const afterName = resolveWinnerName(candidateAfter)
    const beforeName = resolveWinnerName(candidateBefore)
    if (!afterName) return ''
    return beforeName && beforeName !== afterName
      ? uiText('ui.predictedWinnerAfterInstallationValueCurrentValue', { value1: (afterName), value2: (beforeName) })
      : uiText('ui.predictedWinnerAfterInstallationValue', { value1: (afterName) })
  }

  const predictedName = resolveWinnerName(conflict.predictedWinner)
  const ledgerName = resolveWinnerName(conflict.ledgerWinner)
  if (!predictedName) return ''
  if (ledgerName && ledgerName !== predictedName) {
    return uiText('ui.predictedWinnerValueLedgerValue', { value1: (predictedName), value2: (ledgerName) })
  }
  return uiText('ui.predictedWinnerValue', { value1: (predictedName) })
}

export function resolvePlanConflictItems(conflictResult = {}, limit = 4) {
  const max = Math.max(0, toSafeNumber(limit, 4))
  if (!max || !isPlainObject(conflictResult)) return []

  const seen = new Set()
  const result = []
  const addItem = (item = {}, fallback = {}) => {
    if (result.length >= max) return
    const message = toSafeText(item.message || fallback.message)
    if (!message) return
    const code = toSafeText(item.code || item.type || fallback.code || message)
    const key = `${code}:${message}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push({
      code,
      message,
      severity: toSafeText(item.severity || item.level || fallback.severity, 'warning')
    })
  }

  for (const conflict of toSafeList(conflictResult.conflicts)) {
    const winnerMessage = resolveConflictWinnerMessage(conflict)
    addItem(
      {
        type: 'predicted_winner',
        message: winnerMessage,
        severity: conflict.severity || conflictResult.level
      },
      { severity: conflictResult.level }
    )
    if (result.length >= max) return result.slice(0, max)

    for (const issue of toSafeList(conflict.issues)) {
      addItem(issue, {
        code: issue?.type,
        severity: conflict.severity || conflictResult.level
      })
      if (result.length >= max) return result.slice(0, max)
    }

    if (result.length >= max) return result.slice(0, max)
  }

  if (!result.length && conflictResult.level) {
    addItem({
      type: 'conflict_level',
      message: uiText('ui.conflictLevelValue', { value1: (conflictResult.level) }),
      severity: conflictResult.level
    })
  }

  return result.slice(0, max)
}

export function resolvePlanExecutionState(plan = null, submitting = false) {
  if (!plan) {
    return {
      action: 'none',
      disabled: true,
      primaryText: '等待计划',
      get statusText() { return uiText('ui.waitingForInstallationPlan') },
      tone: 'neutral'
    }
  }

  if (plan.submitted || plan.completed) {
    const completed = plan.completed === true
    return {
      action: 'none',
      disabled: true,
      primaryText: completed ? '已完成' : '已加入任务',
      statusText: completed ? uiText('ui.installationTaskComplete') : uiText('ui.submittedToTheInstallationTaskCenter'),
      tone: 'success'
    }
  }

  if (submitting) {
    return {
      action: 'none',
      disabled: true,
      primaryText: '提交中',
      get statusText() { return uiText('ui.submittingToTheInstallationTaskCenter') },
      tone: 'neutral'
    }
  }

  if (plan.canSubmit === false) {
    const hasManualDownloadItems = toSafeList(plan.manualDownloadItems).length > 0
    const hasDraftPayload = isPlainObject(plan.sourceInstallTaskPayloadDraft)
    if (
      plan.decisionState === 'needs_nexus_download_authorization' &&
      hasManualDownloadItems &&
      hasDraftPayload
    ) {
      return {
        action: 'manual_download',
        disabled: false,
        primaryText: plan.primaryActionText || '授权获取下载链接',
        get statusText() { return uiText('ui.waitingForNexusBrowserAuthorization') },
        tone: 'warning'
      }
    }

    const canDecide = plan.canDecide !== false
    return {
      action: canDecide ? 'decide' : 'none',
      disabled: !canDecide,
      primaryText: plan.primaryActionText || (canDecide ? '让 AI 继续决策' : '暂不可提交'),
      statusText: canDecide ? uiText('ui.noTaskDataAvailableToSubmit') : uiText('ui.thePlanIsMissingDataRequiredForExecution'),
      tone: canDecide ? 'warning' : 'danger'
    }
  }

  return {
    action: 'submit',
    disabled: false,
    primaryText: plan.primaryActionText || '授权执行',
    statusText: plan.authorizationText || uiText('ui.addToTheInstallationTaskCenterAfterConfirmation'),
    tone: 'success'
  }
}
