import renderingApi from '../../../../shared/dlss-swapper/rendering-api.js'

// 同类、同作用域证据才参与仲裁，静态能力不与当前会话争夺一个字段。
export function resolveRendering(exe, engineEvidence = [], issues = []) {
  const candidates = exe.staticApiCandidates || exe.apiCandidates || []
  const staticCandidates = [
    ...new Set(candidates.map((item) => renderingApi.exact(item.api, item.label)).filter(Boolean))
  ].sort()
  const evidence = [...engineEvidence]
  if (exe.apiEvidence?.confidence === 'observed') {
    const api = renderingApi.exact(exe.api, exe.apiLabel)
    if (api)
      evidence.push({
        api,
        claim: 'presented',
        scope: exe.apiEvidence.scope || 'historical',
        source: exe.apiEvidence.source,
        observedAt: exe.apiEvidence.observedAt,
        file: exe.apiEvidence.file
      })
  }
  const reasons = [...issues]
  function agree(items) {
    const values = [...new Set(items.map((item) => item.api))]
    return values.length === 1 ? { api: values[0], evidence: items } : null
  }
  const requestedItems = evidence.filter((item) => item.claim === 'requested')
  const logHint = agree(evidence.filter((item) => item.claim === 'log-hint'))
  const requested = agree(requestedItems)
  const hintItems = evidence.filter(
    (item) => item.scope === 'current' && item.claim === 'runtime-hint'
  )
  const runtimeHint = agree(hintItems)
  if (requestedItems.length && !requested) reasons.push('requested_conflict')
  const currentItems = evidence.filter(
    (item) => item.scope === 'current' && ['initialized', 'presented'].includes(item.claim)
  )
  // 精确版本与 DXGI 家族兼容；不同精确 API 的强证据冲突仍应可见。
  const preciseCurrent = currentItems.filter((item) => item.api !== 'dxgi')
  const currentAgreement = agree(
    preciseCurrent.length && preciseCurrent.every((item) => /^d3d1[12]$/.test(item.api))
      ? preciseCurrent
      : currentItems
  )
  const conflict = currentItems.length > 0 && !currentAgreement
  if (conflict) reasons.push('runtime_conflict')
  const current = currentAgreement && {
    ...currentAgreement,
    state: currentAgreement.evidence.some((item) => item.claim === 'presented')
      ? 'observed'
      : 'initialized'
  }
  const preciseRuntime = current && current.api !== 'dxgi'
  const hintConflict =
    !preciseRuntime &&
    ((hintItems.length > 0 && !runtimeHint) ||
      (runtimeHint && requested && runtimeHint.api !== requested.api) ||
      (runtimeHint && current?.api === 'dxgi' && !/^d3d1[12]$/.test(runtimeHint.api)))
  if (hintConflict) reasons.push('runtime_hint_conflict')
  const historical = evidence.filter((item) => item.scope === 'historical' && item.observedAt)
  const latest = Math.max(0, ...historical.map((item) => item.observedAt))
  const history = agree(historical.filter((item) => latest - item.observedAt <= 15000))
  const lastObserved = history && {
    ...history,
    observedAt: latest,
    state: history.evidence.some((item) => item.claim === 'presented') ? 'observed' : 'initialized'
  }
  if (current && requested && current.api !== requested.api && current.api !== 'dxgi')
    reasons.push('runtime_fallback')
  const specific = staticCandidates.filter((api) => api !== 'dxgi')
  const normalized =
    specific.length && specific.every((api) => /^d3d1[12]$/.test(api)) ? specific : staticCandidates
  const staticApi = normalized.length === 1 ? normalized[0] : null
  const historyDisagrees =
    !current &&
    !runtimeHint &&
    !requested &&
    staticApi &&
    [lastObserved?.api, logHint?.api].some(
      (api) => api && api !== staticApi && !(api === 'dxgi' && /^d3d1[12]$/.test(staticApi))
    )
  if (historyDisagrees) reasons.push('historical_disagreement')
  const recommended =
    conflict ||
    hintConflict ||
    (!current && reasons.includes('requested_conflict')) ||
    (!current && !runtimeHint && !requested && reasons.includes('configuration_unresolved'))
      ? null
      : (preciseRuntime ? current.api : runtimeHint?.api || current?.api) ||
        requested?.api ||
        (historyDisagrees || reasons.some((reason) => reason.startsWith('gpu_client_'))
          ? null
          : staticApi)
  // Installing requires closing the game. A validated recent session can still
  // supply the installation plan after exit, without claiming it is running.
  // Readers already verify log ownership, age and binary update timestamps.
  const installationPlan =
    !recommended &&
    exe.processState === 'not-running' &&
    !reasons.length &&
    lastObserved &&
    renderingApi.choices.some((item) => item.value === lastObserved.api)
      ? { api: lastObserved.api, source: 'history', observedAt: lastObserved.observedAt }
      : null
  const modeApis = [
    ...new Set([
      ...(normalized.length === 1 || normalized.every((api) => /^d3d1[12]$/.test(api))
        ? normalized.filter((api) => api !== 'dxgi')
        : []),
      ...evidence.map((item) => item.api).filter((api) => api !== 'dxgi')
    ])
  ].sort()
  return {
    version: 1,
    staticCandidates,
    requested,
    runtimeHint,
    current,
    lastObserved,
    installationPlan,
    logHint,
    evidence,
    reasons: [...new Set(reasons)],
    recommendedApi: recommended,
    recommendationSource:
      runtimeHint && !preciseRuntime && recommended === runtimeHint.api
        ? 'gpu-client'
        : current
          ? current.state
          : requested
            ? 'configuration'
            : staticApi
              ? 'static'
              : 'unknown',
    state:
      conflict || hintConflict || (!current && reasons.includes('requested_conflict'))
        ? 'conflict'
        : recommended || installationPlan
          ? 'ready'
          : 'needs-choice',
    profiles: modeApis.map((api) => ({ id: api, api, label: renderingApi.label(api) }))
  }
}
