function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPositiveNumber(value = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const numberValue = toPositiveNumber(value)
    if (numberValue > 0) {
      return numberValue
    }
  }
  return 0
}

export function resolveNexusRequirementModId(requirement = {}, linkMeta = {}) {
  const explicitModId = firstPositiveNumber(
    requirement?.modId,
    requirement?.mod_id,
    requirement?.sourceModId,
    requirement?.source_mod_id
  )
  if (explicitModId > 0) {
    return explicitModId
  }

  const linkModId = toPositiveNumber(linkMeta?.modId)
  if (linkModId > 0) {
    return linkModId
  }

  if (!isNexusRequirementRawExternal(requirement)) {
    return firstPositiveNumber(requirement?.id, requirement?.sourceId, requirement?.source_id)
  }

  return 0
}

export function isNexusRequirementRawExternal(requirement = {}) {
  const value = requirement?.externalRequirement
  return value === true || toSafeText(value).toLowerCase() === 'true'
}

export function resolveNexusRequirementExternalFlag(
  requirement = {},
  resolvedModId = 0,
  linkMeta = {}
) {
  if (!isNexusRequirementRawExternal(requirement)) {
    return false
  }
  if (linkMeta?.isNexusModLink || toPositiveNumber(resolvedModId) > 0) {
    return false
  }
  return true
}
