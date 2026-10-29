import { resolveSourcePlatformLabel } from '../../sources/source-platform-registry.js'

export const AUTO_INSTALL_DECISION_MAX_ATTEMPTS = 3

// 只带当前目标的稳定标识。页面上下文由聊天请求单独传递，不能把完整计划、
// 旧 decisionPrompt 和同一份页面数据反复嵌进用户消息。
export function buildInstallDecisionIdentity(candidate = {}, context = {}) {
  const source = String(candidate.source || '').trim()
  const game = context.game || {}
  const sameSource = source === (game.businessSource || game.source)
  const fields = {
    source,
    modId: candidate.modId || candidate.id,
    name: candidate.name || candidate.modName,
    version: candidate.version,
    fileId: candidate.fileId || candidate.selectedFileId,
    domainName: candidate.domainName || (sameSource ? game.domainName || game.sourceSlug : ''),
    sourceGameId: candidate.sourceGameId || candidate.gameId || (sameSource ? game.sourceGameId : ''),
    modReference: candidate.modReference
  }
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    const text = String(value ?? '').trim()
    return text && text.length <= 256 ? [[key, text]] : []
  }))
}

export function buildInstallDecisionPrompt(candidate = {}, context = {}, plan = {}) {
  const identity = buildInstallDecisionIdentity(plan.candidateIdentity || candidate, context)
  return [
    '继续完成这个安装计划的 AI 决策，直接执行已获授权的查询和预检，不把可执行的读操作留作下一步建议。',
    '目标模组（数据）：' + JSON.stringify(identity),
    '当前缺口：' + JSON.stringify(Array.isArray(plan.missingDecisionData) ? plan.missingDecisionData : []),
    '页面、游戏和会话状态见本次请求的当前页面上下文，不沿用历史中的故障结论。',
    '本地游戏使用 vertex.game.list 返回的 gameId；来源游戏 ID 和后端游戏编号不能替代本地主键。编号不匹配时先查询列表。',
    '缺少安装位置证据时调用 vertex.install.location_hints，核对作者说明、对应文件和 EXE 线索；不要猜目录。',
    '需要包内证据时读取真实文件并执行 archive.inspect、rule.match_preview 和安装预检；不能伪造 sourceInstallTaskPayload。',
    '如果需要用户下载授权或该文件不属于可部署模组，明确给出对应操作或不可安装结论；不要反复重查同一缺口。提交仍须遵守工具的权限和确认要求。'
  ].join('\n')
}

const INSTALL_INTENT_PATTERNS = [
  /帮我安装/,
  /给我安装/,
  /请安装/,
  /直接安装/,
  /开始安装/,
  /安装这个/,
  /装一下/,
  /装上/,
  /加入安装任务/,
  /加入任务中心/,
  /一键安装/,
  /go ahead and install/i,
  /please install/i,
  /install this/i,
  /start install/i,
  /add (it|this)? ?to install task/i
]

const INSTALL_QUESTION_PATTERNS = [
  /怎么安装/,
  /如何安装/,
  /怎样安装/,
  /安装教程/,
  /可以安装吗/,
  /能安装吗/,
  /能不能安装/,
  /是否能安装/,
  /how to install/i,
  /can i install/i
]

const INSTALL_INTENT_STRIP_PATTERNS = [
  /帮我/g,
  /给我/g,
  /请/g,
  /直接/g,
  /开始/g,
  /一下/g,
  /一键/g,
  /加入安装任务/g,
  /加入任务中心/g,
  /安装/g,
  /装一下/g,
  /装上/g,
  /go ahead and/gi,
  /please/gi,
  /start/gi,
  /add(?: it| this)? ?to install task/gi,
  /install/gi
]

const GENERIC_INSTALL_TARGET_PATTERNS = [
  /这个模组/gi,
  /当前模组/gi,
  /这个mod/gi,
  /this mod/gi,
  /current mod/gi,
  /这个/gi,
  /当前这个/gi,
  /它/gi,
  /\bit\b/gi,
  /\bthis\b/gi
]

function toPlainJson(value, fallback = null) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function normalizeInstallTargetText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function normalizeCandidateSource(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function resolveCandidateSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source)
}

function matchContextInstallCandidate(candidate = {}, context = {}) {
  const contextMod = context?.mod && typeof context.mod === 'object' ? context.mod : {}
  const contextSource = normalizeCandidateSource(
    contextMod?.source || context?.page?.source || context?.game?.source
  )
  const candidateSource = normalizeCandidateSource(candidate?.source)
  if (contextSource && candidateSource && contextSource !== candidateSource) {
    return false
  }

  const contextModId = normalizeInstallTargetText(contextMod?.modId)
  const candidateModId = normalizeInstallTargetText(candidate?.modId || candidate?.id)
  if (contextModId && candidateModId && contextModId === candidateModId) {
    return true
  }

  const contextModName = normalizeInstallTargetText(contextMod?.name)
  if (!contextModName) {
    return false
  }

  const candidateKeys = [
    candidate?.name,
    candidate?.modName,
    candidate?.displayName,
    candidate?.packageName,
    candidate?.fullName
  ]
    .map((item) => normalizeInstallTargetText(item))
    .filter(Boolean)

  return candidateKeys.some((item) => item === contextModName)
}

function buildContextInstallCandidate(context = {}, target = '') {
  const contextMod = context?.mod && typeof context.mod === 'object' ? context.mod : {}
  const source = normalizeCandidateSource(
    contextMod?.source || context?.page?.source || context?.game?.source
  )
  const modId = String(contextMod?.modId || '').trim()
  const name = String(contextMod?.name || '').trim()

  if (!source || (!modId && !name)) {
    return null
  }

  const normalizedTarget = normalizeInstallTargetText(target)
  if (normalizedTarget) {
    const matched = [modId, name]
      .map((item) => normalizeInstallTargetText(item))
      .filter(Boolean)
      .some((item) => item === normalizedTarget)
    if (!matched) {
      return null
    }
  }

  return toPlainJson(
    {
      source,
      sourceLabel: resolveCandidateSourceLabel(source),
      modId,
      id: modId || name,
      fileId: String(contextMod?.fileId || '').trim(),
      name,
      version: String(contextMod?.version || '').trim(),
      domainName: String(context?.game?.domainName || context?.game?.sourceSlug || '').trim(),
      sourceSlug: String(context?.game?.sourceSlug || '').trim(),
      sourceGameId: String(context?.game?.sourceGameId || '').trim(),
      gameId: String(context?.game?.id || context?.game?.sourceGameId || '').trim(),
      appId: String(context?.game?.appId || '').trim()
    },
    null
  )
}

function extractExplicitInstallTarget(message = '') {
  let normalizedSubject = String(message || '').trim()
  for (const pattern of INSTALL_INTENT_STRIP_PATTERNS) {
    normalizedSubject = normalizedSubject.replace(pattern, '')
  }
  for (const pattern of GENERIC_INSTALL_TARGET_PATTERNS) {
    normalizedSubject = normalizedSubject.replace(pattern, '')
  }
  normalizedSubject = normalizedSubject.replace(/[\s,.;:!?，。！？、“”"'()[\]{}<>_-]+/g, '')
  return normalizeInstallTargetText(normalizedSubject)
}

function matchExplicitInstallCandidate(candidate = {}, target = '') {
  const normalizedTarget = normalizeInstallTargetText(target)
  if (!normalizedTarget) {
    return false
  }

  const candidateKeys = [
    candidate?.name,
    candidate?.modName,
    candidate?.displayName,
    candidate?.packageName,
    candidate?.fullName,
    candidate?.fileName
  ]
    .map((item) => normalizeInstallTargetText(item))
    .filter(Boolean)

  if (!candidateKeys.length) {
    return false
  }

  if (candidateKeys.some((item) => item === normalizedTarget)) {
    return true
  }

  if (normalizedTarget.length < 3) {
    return false
  }

  return candidateKeys.some(
    (item) => item.includes(normalizedTarget) || normalizedTarget.includes(item)
  )
}

export function shouldAutoContinueInstallDecision(plan = null) {
  const safePlan = toPlainJson(plan, null)
  const canContinue =
    safePlan && safePlan.canSubmit === false && safePlan.canDecide !== false && !safePlan.submitted
  return Boolean(canContinue)
}

export function getInstallPlanProgressSignature(plan = null) {
  const safePlan = toPlainJson(plan, null)
  if (!safePlan || typeof safePlan !== 'object') {
    return ''
  }
  return JSON.stringify({
    modName: String(safePlan.modName || '').trim(),
    version: String(safePlan.version || '').trim(),
    source: String(safePlan.source || '').trim(),
    fileName: String(safePlan.fileName || '').trim(),
    targetSummary: String(safePlan.targetSummary || '').trim(),
    precheckText: String(safePlan.precheckText || '').trim(),
    riskLevel: String(safePlan.riskLevel || '').trim(),
    riskText: String(safePlan.riskText || '').trim(),
    canSubmit: safePlan.canSubmit === true,
    canDecide: safePlan.canDecide === true,
    decisionState: String(safePlan.decisionState || '').trim(),
    missingDecisionData: Array.isArray(safePlan.missingDecisionData)
      ? safePlan.missingDecisionData.map((item) => String(item || '').trim())
      : [],
    hasSourceInstallTaskPayload: Boolean(safePlan.sourceInstallTaskPayload)
  })
}

export function shouldRetryAutoInstallDecision(options = {}) {
  const attempt = Math.max(0, Number(options?.attempt || 0))
  const maxAttempts = Math.max(
    1,
    Number(options?.maxAttempts || AUTO_INSTALL_DECISION_MAX_ATTEMPTS)
  )
  if (attempt + 1 >= maxAttempts) {
    return false
  }

  const currentPlan = toPlainJson(options?.currentPlan, null)
  if (!shouldAutoContinueInstallDecision(currentPlan)) {
    return false
  }

  const previousSignature = getInstallPlanProgressSignature(options?.previousPlan)
  const currentSignature = getInstallPlanProgressSignature(currentPlan)
  return Boolean(currentSignature && currentSignature !== previousSignature)
}

export function hasExplicitInstallIntent(message = '') {
  const content = String(message || '').trim()
  if (!content) {
    return false
  }
  if (INSTALL_QUESTION_PATTERNS.some((pattern) => pattern.test(content))) {
    return false
  }
  return INSTALL_INTENT_PATTERNS.some((pattern) => pattern.test(content))
}

export function shouldAutoSubmitReadyInstallPlan(options = {}) {
  if (options?.autoSubmitEnabled !== true) {
    return false
  }

  const plan = toPlainJson(options?.plan, null)
  if (!hasExplicitInstallIntent(options?.message)) {
    return false
  }
  if (!plan || typeof plan !== 'object') {
    return false
  }
  if (plan.submitted || plan.canSubmit !== true) {
    return false
  }
  const riskLevel = String(plan.riskLevel || '')
    .trim()
    .toLowerCase()
  if (riskLevel && !['info', 'ready', 'success'].includes(riskLevel)) {
    return false
  }
  return Boolean(plan.sourceInstallTaskPayload)
}

export function shouldRequestManualInstallConfirmation(options = {}) {
  const plan = toPlainJson(options?.plan, null)
  if (!hasExplicitInstallIntent(options?.message)) {
    return false
  }
  return Boolean(
    plan &&
      typeof plan === 'object' &&
      !plan.submitted &&
      plan.canSubmit === true &&
      plan.sourceInstallTaskPayload
  )
}

export function shouldNotifySubmittedInstallPlan(options = {}) {
  const plan = toPlainJson(options?.plan, null)
  if (!hasExplicitInstallIntent(options?.message)) {
    return false
  }
  return Boolean(plan && typeof plan === 'object' && plan.submitted === true)
}

export function resolveExplicitInstallPlanAction(options = {}) {
  const message = String(options?.message || '').trim()
  const plan = toPlainJson(options?.plan, null)
  if (
    shouldAutoSubmitReadyInstallPlan({
      message,
      plan,
      autoSubmitEnabled: options?.autoSubmitEnabled === true
    })
  ) {
    return 'submit'
  }
  if (shouldRequestManualInstallConfirmation({ message, plan })) {
    return 'confirm'
  }
  if (hasExplicitInstallIntent(message) && shouldAutoContinueInstallDecision(plan)) {
    return 'continue'
  }
  return ''
}

export function resolveExplicitInstallCandidate(options = {}) {
  const message = String(options?.message || '').trim()
  const plan = toPlainJson(options?.plan, null)
  if (!hasExplicitInstallIntent(message) || plan) {
    return null
  }

  const candidates = Array.isArray(options?.candidates)
    ? options.candidates
        .map((item) => toPlainJson(item, null))
        .filter((item) => item && typeof item === 'object')
    : []
  const currentContext = toPlainJson(options?.context, null)

  const explicitTarget = extractExplicitInstallTarget(message)
  if (!explicitTarget) {
    if (currentContext && typeof currentContext === 'object') {
      const contextMatchedCandidates = candidates.filter((item) =>
        matchContextInstallCandidate(item, currentContext)
      )
      if (contextMatchedCandidates.length === 1) {
        return contextMatchedCandidates[0]
      }
      const contextCandidate = buildContextInstallCandidate(currentContext, '')
      if (contextCandidate) {
        return contextCandidate
      }
    }
    return candidates.length === 1 ? candidates[0] : null
  }

  const matchedCandidates = candidates.filter((item) =>
    matchExplicitInstallCandidate(item, explicitTarget)
  )
  if (matchedCandidates.length === 1) {
    return matchedCandidates[0]
  }

  if (currentContext && typeof currentContext === 'object') {
    const contextCandidate = buildContextInstallCandidate(currentContext, explicitTarget)
    if (contextCandidate) {
      return contextCandidate
    }
  }

  return null
}
