// 从上下文候选生成自动安装计划。
import { assertSourceCapability } from '../../../../shared/sources/source-platform-registry.js'
import {
  collectPageContextCandidates,
  mergeCandidates as mergeModelCandidates
} from '../agent/candidateModelUtils.js'
import { toPlainJson, pickFirstText } from './values.js'
import {
  resolveCandidateSource,
  resolveHighConfidenceInstallCandidate,
  mergeResolvedCandidate
} from './candidates.js'
import { createAiAgentInstallPlanPreview } from './preview.js'

export async function resolveAiAgentAutoInstallPlan(payload = {}) {
  const context = toPlainJson(payload?.context, {})
  const inputCandidates = Array.isArray(payload?.candidates)
    ? payload.candidates
        .map((item) => toPlainJson(item, {}))
        .filter((item) => Object.keys(item).length)
    : []
  const candidates = mergeModelCandidates(inputCandidates, collectPageContextCandidates(context))
  let resolveDetail = payload?.resolveDetail
  if (typeof resolveDetail !== 'function') {
    const modSourceService = await import('../../mod-source/runtime.js')
    resolveDetail = modSourceService.getModSourceDetail
  }

  const highConfidenceCandidate = resolveHighConfidenceInstallCandidate(candidates, context)

  if (!highConfidenceCandidate) {
    return {
      candidates,
      installPlan: null,
      autoResolved: false,
      autoResolvedReason: '',
      detailResolved: false
    }
  }

  const candidateBusinessSource = resolveCandidateSource(highConfidenceCandidate.candidate, context)
  const capability = assertSourceCapability(candidateBusinessSource, 'ai.installPlan')
  if (!capability.success) {
    return {
      candidates,
      installPlan: null,
      autoResolved: false,
      autoResolvedReason: capability.errorCode || 'source_capability_disabled',
      detailResolved: false,
      sourceCapability: {
        source: capability.source || candidateBusinessSource,
        errorCode: capability.errorCode || 'source_capability_disabled',
        message: capability.message || ''
      }
    }
  }

  let resolvedCandidate = highConfidenceCandidate.candidate
  let detailResolved = false

  try {
    const detailResult = await resolveDetail({
      ...resolvedCandidate,
      displaySource: pickFirstText(resolvedCandidate.displaySource, resolvedCandidate.source),
      businessSource: candidateBusinessSource,
      source: candidateBusinessSource,
      context
    })
    const detailRecord = toPlainJson(detailResult?.record, null)
    if (detailResult?.success && detailRecord && Object.keys(detailRecord).length) {
      resolvedCandidate = {
        ...resolvedCandidate,
        ...detailRecord
      }
      detailResolved = true
    }
  } catch {
    detailResolved = false
  }

  const planResult = await createAiAgentInstallPlanPreview({
    candidate: resolvedCandidate,
    context,
    resolveDetail,
    skipDetailHydration: detailResolved,
    resolveSourceInstallTaskPayload: payload?.resolveSourceInstallTaskPayload,
    getModioLatestRule: payload?.getModioLatestRule,
    getModioBinding: payload?.getModioBinding,
    getNexusLatestRule: payload?.getNexusLatestRule,
    getSharedRule: payload?.getSharedRule,
    getNexusBinding: payload?.getNexusBinding,
    getNexusRequirements: payload?.getNexusRequirements,
    getNexusModRequirements: payload?.getNexusModRequirements,
    getModDetail: payload?.getModDetail,
    installedNexusModIds: payload?.installedNexusModIds,
    installedNexusMods: payload?.installedNexusMods,
    resolveVamHubDependencies: payload?.resolveVamHubDependencies,
    prepareFicsitPlan: payload?.prepareFicsitPlan,
    buildThunderstoreInstallPlan: payload?.buildThunderstoreInstallPlan
  })
  const installPlan = toPlainJson(planResult?.plan, null)

  return {
    candidates: mergeResolvedCandidate(candidates, resolvedCandidate, context),
    installPlan,
    autoResolved: Boolean(installPlan),
    autoResolvedReason: highConfidenceCandidate.reason,
    detailResolved
  }
}
