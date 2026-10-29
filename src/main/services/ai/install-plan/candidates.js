// 候选身份匹配与高置信度选择。
import { resolveBusinessSource } from '../../../../shared/sources/source-platform-registry.js'
import { pickFirstText, toSafeText } from './values.js'

export function resolveCandidateSource(candidate = {}, context = {}) {
  const resolvedSource = resolveBusinessSource({
    displaySource: pickFirstText(
      candidate.displaySource,
      candidate.display_source,
      candidate.sourcePlatform,
      candidate.source_platform,
      candidate.source,
      context.displaySource,
      context.display_source,
      context.page?.displaySource,
      context.page?.display_source,
      context.page?.sourcePlatform,
      context.page?.source_platform,
      context.page?.source
    ),
    source: pickFirstText(
      candidate.source,
      candidate.sourcePlatform,
      candidate.source_platform,
      context.source,
      context.sourcePlatform,
      context.source_platform,
      context.page?.source,
      context.page?.sourcePlatform,
      context.page?.source_platform
    ),
    businessSource: pickFirstText(
      candidate.businessSource,
      candidate.business_source,
      context.businessSource,
      context.business_source,
      context.page?.businessSource,
      context.page?.business_source
    ),
    targetSourcePlatform: pickFirstText(
      candidate.targetSourcePlatform,
      candidate.target_source_platform,
      context.targetSourcePlatform,
      context.target_source_platform,
      context.page?.targetSourcePlatform,
      context.page?.target_source_platform
    )
  })

  return (
    resolvedSource ||
    pickFirstText(
      candidate.source,
      candidate.businessSource,
      candidate.targetSourcePlatform,
      context.businessSource,
      context.page?.businessSource,
      context.page?.source
    ).toLowerCase()
  )
}

function resolveCandidateId(candidate = {}) {
  return pickFirstText(
    candidate.modId,
    candidate.mod_id,
    candidate.id,
    candidate.packageFullName,
    candidate.fullName,
    candidate.packageName,
    candidate.package_name,
    candidate.resourceId,
    candidate.resource_id,
    candidate.slug
  )
}

function buildCandidateIdentity(candidate = {}, context = {}) {
  const source = resolveCandidateSource(candidate, context)
  const id = resolveCandidateId(candidate)
  return source && id ? `${source}:${String(id)}` : ''
}

function hasStableCandidateIdentity(candidate = {}, context = {}) {
  return Boolean(buildCandidateIdentity(candidate, context))
}

function isExplicitSelectedCandidate(candidate = {}, context = {}) {
  return Boolean(
    hasStableCandidateIdentity(candidate, context) &&
      (candidate.selected === true ||
        candidate.isSelected === true ||
        candidate.explicitSelected === true ||
        candidate.userSelected === true)
  )
}

function isCurrentPageDetailCandidate(candidate = {}, context = {}) {
  if (!hasStableCandidateIdentity(candidate, context)) return false
  const pageType = toSafeText(context?.page?.type)
  if (pageType !== 'mod_detail') return false

  const contextSource = resolveCandidateSource({}, context)
  const contextModId = pickFirstText(context?.mod?.modId, context?.mod?.id)
  const candidateSource = resolveCandidateSource(candidate, context)
  const candidateId = resolveCandidateId(candidate)
  if (contextSource && candidateSource !== contextSource) return false
  return !contextModId || candidateId === contextModId
}

function isStrictMatchCandidate(candidate = {}, context = {}) {
  if (!hasStableCandidateIdentity(candidate, context)) return false
  const matchType = toSafeText(candidate.matchType || candidate.match_type).toLowerCase()
  return (
    candidate.exactMatch === true ||
    candidate.strictMatch === true ||
    matchType === 'exact' ||
    matchType === 'strict'
  )
}

function pickUniqueCandidate(candidates = [], context = {}, predicate) {
  const matches = candidates.filter(predicate)
  const identityMap = new Map()
  for (const candidate of matches) {
    const identity = buildCandidateIdentity(candidate, context)
    if (!identity || identityMap.has(identity)) continue
    identityMap.set(identity, candidate)
  }
  return identityMap.size === 1 ? [...identityMap.values()][0] : null
}

export function resolveHighConfidenceInstallCandidate(candidates = [], context = {}) {
  if (candidates.length === 1) {
    const candidate = candidates[0]
    return {
      candidate,
      reason: hasStableCandidateIdentity(candidate, context)
        ? 'single_stable_candidate'
        : 'single_candidate'
    }
  }

  const selectedCandidate = pickUniqueCandidate(candidates, context, (candidate) =>
    isExplicitSelectedCandidate(candidate, context)
  )
  if (selectedCandidate) {
    return {
      candidate: selectedCandidate,
      reason: 'explicit_selected_candidate'
    }
  }

  const pageDetailCandidate = pickUniqueCandidate(candidates, context, (candidate) =>
    isCurrentPageDetailCandidate(candidate, context)
  )
  if (pageDetailCandidate) {
    return {
      candidate: pageDetailCandidate,
      reason: 'current_page_detail_candidate'
    }
  }

  const detailCandidate = pickUniqueCandidate(
    candidates,
    context,
    (candidate) =>
      hasStableCandidateIdentity(candidate, context) && candidate._candidateOrigin === 'tool_detail'
  )
  if (detailCandidate) {
    return {
      candidate: detailCandidate,
      reason: 'tool_detail_candidate'
    }
  }

  const strictCandidate = pickUniqueCandidate(candidates, context, (candidate) =>
    isStrictMatchCandidate(candidate, context)
  )
  if (strictCandidate) {
    return {
      candidate: strictCandidate,
      reason: 'unique_strict_match_candidate'
    }
  }

  return null
}

export function mergeResolvedCandidate(candidates = [], resolvedCandidate = {}, context = {}) {
  const resolvedIdentity = buildCandidateIdentity(resolvedCandidate, context)
  if (!resolvedIdentity) return candidates
  let merged = false
  const nextCandidates = candidates.map((candidate) => {
    if (buildCandidateIdentity(candidate, context) !== resolvedIdentity) return candidate
    merged = true
    return {
      ...candidate,
      ...resolvedCandidate
    }
  })
  return merged ? nextCandidates : [resolvedCandidate, ...nextCandidates]
}
