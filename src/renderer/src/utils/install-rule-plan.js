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

function toPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function getInstallRulePlanFieldName(source = '') {
  if (source === 'nexus') {
    return 'nexusInstallPlan'
  }
  if (source === 'modio') {
    return 'modioInstallPlan'
  }
  if (source === 'ficsit') {
    return 'ficsitInstallPlan'
  }
  return 'sourceInstallPlan'
}

export function normalizeInstallRuleLaunchAction(value = '', defaultValue = '') {
  const text = toSafeText(value).toLowerCase()

  if (!text) {
    return defaultValue
  }

  if (['inject_mod', 'inject', 'enable_exe'].includes(text)) {
    return 'inject_mod'
  }
  if (
    ['default_execute', 'default', 'default_launch', 'auto_execute', 'auto_launch'].includes(text)
  ) {
    return 'default_execute'
  }
  if (['manual_execute', 'manual', 'run_tool', 'manual_launch'].includes(text)) {
    return 'manual_execute'
  }

  return text
}

export function normalizeInstallRuleLaunchArgs(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => toSafeText(item)).filter(Boolean)
  }

  const text = toSafeText(value)
  return text ? [text] : []
}

export function normalizeInstallRuleOptionalBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  const text = toSafeText(value).toLowerCase()
  if (!text) {
    return null
  }

  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(text)) {
    return false
  }
  return null
}

export function extractInstallRuleMatchedRuleId(installRulePlan = {}) {
  const plan = toPlainObject(installRulePlan) || {}
  const explicitRuleId = toSafeText(
    plan.ruleId || plan.rule_id || plan.matchedRuleId || plan.matched_rule_id || ''
  )
  if (explicitRuleId) {
    return explicitRuleId
  }

  const strategy = toSafeText(plan.strategy)
  if (!strategy) {
    return ''
  }

  const matchedRuleId = strategy.match(/^json_rule:(.+)$/i)?.[1]
  return toSafeText(matchedRuleId)
}

export function resolveInstallRulePlanFromMetadata(metadata = {}, sourceType = '') {
  const target = toPlainObject(metadata) || {}
  const commonPlan = toPlainObject(target.installRulePlan)
  if (commonPlan) {
    return commonPlan
  }

  const genericPlan = toPlainObject(target.sourceInstallPlan)
  if (genericPlan) {
    return genericPlan
  }

  const source = toSafeSource(
    sourceType ||
      target.sourceType ||
      target.source ||
      target.sourcePlatform ||
      target.category ||
      ''
  )
  const sourcePlan = toPlainObject(target[getInstallRulePlanFieldName(source)])
  if (sourcePlan) {
    return sourcePlan
  }

  for (const fieldName of [
    'nexusInstallPlan',
    'modioInstallPlan',
    'ficsitInstallPlan',
    'vamhubInstallPlan'
  ]) {
    const fallbackPlan = toPlainObject(target[fieldName])
    if (fallbackPlan) {
      return fallbackPlan
    }
  }

  return {}
}
