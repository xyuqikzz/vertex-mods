// 安装预览、依赖展示与待用户决策信息。
import {
  toSafeText,
  toSafeNumber,
  pickFirstText,
  toPlainJson,
  resolveSourceLabel
} from './values.js'
import {
  findRetiredSource,
  getRetiredSourceFailure
} from '../../../../shared/sources/retired-source-policy.js'
import { analyzeInstallLocationEvidence } from '../agent/tools/installLocationEvidence.js'
import { collectInstallDetailDocuments } from '../agent/tools/installLocationHintsTool.js'
import { resolveCandidateSource } from './candidates.js'
import { resolvePlanItemVersion } from './fileMetadata.js'
import { resolveAiAgentSourceInstallTaskPayload } from './sourceTasks.js'
import { hydrateInstallPlanCandidate } from './candidateDetails.js'
import { buildInstallDecisionIdentity, buildInstallDecisionPrompt } from '../../../../shared/ai/installation/ai-install-decision-auto.js'

function resolveSourceInstallTaskPayloadVersion(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const firstItem =
    items.find((entry) => {
      const installPayload = entry?.meta?.installPayload || {}
      const metadata = installPayload?.metadata || {}
      const category = toSafeText(metadata?.category)
      return (
        toSafeNumber(installPayload?.typeId, 0) !== 1 &&
        category !== 'default_dependency' &&
        category !== 'nexus_requirement'
      )
    }) ||
    items[0] ||
    null
  return pickFirstText(
    firstItem?.meta?.installPayload?.version,
    firstItem?.meta?.installPayload?.modVersion,
    firstItem?.meta?.installPayload?.sourceMeta?.version,
    firstItem?.item?.version,
    firstItem?.meta?.version,
    payload?.version
  )
}

function normalizeMissingDecisionData(fields = []) {
  const normalized = []
  const aliasMap = {
    fileId: 'downloadFile',
    sourceFileId: 'downloadFile',
    downloadFile: 'downloadFile',
    downloadUrl: 'downloadUrl',
    installRule: 'installRule',
    defaultDependencies: 'defaultDependencies',
    nexusDependencies: 'nexusDependencies',
    nexusRequirements: 'nexusDependencies',
    gameRoot: 'gameRoot',
    sourceInstallTaskPayload: 'sourceInstallTaskPayload'
  }

  for (const field of Array.isArray(fields) ? fields : []) {
    const key = toSafeText(field)
    if (!key) continue
    const value = aliasMap[key] || key
    if (!normalized.includes(value)) {
      normalized.push(value)
    }
  }

  if (!normalized.includes('sourceInstallTaskPayload')) {
    normalized.push('sourceInstallTaskPayload')
  }

  return normalized
}

function formatMissingDecisionText(fields = []) {
  const labelMap = {
    downloadFile: '下载文件',
    downloadUrl: '下载链接',
    installRule: '安装规则',
    defaultDependencies: '默认依赖',
    nexusDependencies: 'Nexus 模组依赖',
    gameRoot: '游戏目录',
    sourceInstallTaskPayload: '任务中心 payload',
    sourceGameDomain: 'Nexus 游戏域名',
    sourceGameId: '来源游戏标识',
    sourceModId: '来源模组标识',
    appId: '本地游戏标识',
    version: '版本信息'
  }
  const labels = (Array.isArray(fields) ? fields : [])
    .map((field) => labelMap[toSafeText(field)] || toSafeText(field))
    .filter(Boolean)

  return labels.length ? `还需要补齐${labels.join('、')}` : '还需要补齐运行态数据'
}

function mergeDependencyItems(...lists) {
  const seen = new Set()
  const result = []

  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item) continue
      const normalized = typeof item === 'object' ? toPlainJson(item, {}) : { id: toSafeText(item) }
      const key = pickFirstText(
        normalized.sourceModKey,
        normalized.id,
        normalized.modId,
        normalized.name
      ).toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(normalized)
    }
  }

  return result
}

export async function createAiAgentInstallPlanPreview(payload = {}) {
  const retiredSource =
    findRetiredSource(payload) ||
    resolveCandidateSource(payload.candidate || {}, payload.context || {})
  const retiredFailure = getRetiredSourceFailure(retiredSource)
  if (retiredFailure) return { ...retiredFailure, plan: null }
  let candidate = toPlainJson(payload?.candidate, {})
  const context = toPlainJson(payload?.context, {})
  const hydratedCandidate =
    payload?.skipDetailHydration === true
      ? {
          candidate,
          detailResolved: false
        }
      : await hydrateInstallPlanCandidate(candidate, context, payload?.resolveDetail)
  candidate = hydratedCandidate.candidate
  if (hydratedCandidate.errorCode)
    return {
      success: false,
      errorCode: hydratedCandidate.errorCode,
      message: hydratedCandidate.message,
      plan: null
    }
  let autoTaskPayloadResolved = false
  let missingDecisionData = []
  let sourceInstallTaskPayloadDraft = null
  let manualDownloadItems = []
  let missingDecisionReason = ''
  if (!candidate.sourceInstallTaskPayload) {
    const resolvePayload =
      typeof payload?.resolveSourceInstallTaskPayload === 'function'
        ? payload.resolveSourceInstallTaskPayload
        : resolveAiAgentSourceInstallTaskPayload
    const taskPayloadResult = await resolvePayload({
      candidate,
      context,
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
    const taskDependencyCount = toSafeNumber(taskPayloadResult?.dependencyCount, 0)
    const taskMissingDependencies = Array.isArray(taskPayloadResult?.missingDefaultDependencies)
      ? taskPayloadResult.missingDefaultDependencies
      : []
    const taskRuleDefaultDependencies = Array.isArray(taskPayloadResult?.ruleDefaultDependencies)
      ? taskPayloadResult.ruleDefaultDependencies
      : []
    const taskMissingNexusRequirements = Array.isArray(taskPayloadResult?.missingNexusRequirements)
      ? taskPayloadResult.missingNexusRequirements
      : []
    const taskNexusRequirements = Array.isArray(taskPayloadResult?.nexusRequirements)
      ? taskPayloadResult.nexusRequirements
      : []
    const taskExternalNexusRequirements = Array.isArray(
      taskPayloadResult?.externalNexusRequirements
    )
      ? taskPayloadResult.externalNexusRequirements
      : []
    const taskDlcRequirements = Array.isArray(taskPayloadResult?.dlcRequirements)
      ? taskPayloadResult.dlcRequirements
      : []
    if (
      taskDependencyCount ||
      taskMissingDependencies.length ||
      taskMissingNexusRequirements.length ||
      taskRuleDefaultDependencies.length ||
      taskNexusRequirements.length ||
      taskExternalNexusRequirements.length ||
      taskDlcRequirements.length
    ) {
      candidate = {
        ...candidate,
        dependencyCount: Math.max(toSafeNumber(candidate.dependencyCount, 0), taskDependencyCount),
        missingDependencies: mergeDependencyItems(
          candidate.missingDependencies,
          taskMissingDependencies,
          taskMissingNexusRequirements
        ),
        ruleDefaultDependencies: mergeDependencyItems(
          candidate.ruleDefaultDependencies,
          taskRuleDefaultDependencies
        ),
        nexusRequirements: mergeDependencyItems(candidate.nexusRequirements, taskNexusRequirements),
        externalNexusRequirements: mergeDependencyItems(
          candidate.externalNexusRequirements,
          taskExternalNexusRequirements
        ),
        dlcRequirements: mergeDependencyItems(candidate.dlcRequirements, taskDlcRequirements),
        nexusDependencyResult:
          taskPayloadResult?.nexusDependencyResult &&
          typeof taskPayloadResult.nexusDependencyResult === 'object'
            ? taskPayloadResult.nexusDependencyResult
            : candidate.nexusDependencyResult
      }
    }
    if (taskPayloadResult?.success && taskPayloadResult?.payload) {
      candidate = {
        ...candidate,
        sourceInstallTaskPayload: taskPayloadResult.payload
      }
      autoTaskPayloadResolved = true
    } else {
      sourceInstallTaskPayloadDraft = toPlainJson(
        taskPayloadResult?.sourceInstallTaskPayloadDraft || taskPayloadResult?.payloadDraft,
        null
      )
      manualDownloadItems = Array.isArray(taskPayloadResult?.manualDownloadItems)
        ? taskPayloadResult.manualDownloadItems.map((item) => toPlainJson(item, {}))
        : []
      missingDecisionReason = toSafeText(taskPayloadResult?.reason)
      missingDecisionData = normalizeMissingDecisionData(
        taskPayloadResult?.missingFields || taskPayloadResult?.missing || []
      )
    }
  }
  const source = toSafeText(candidate.source || context?.page?.source || '')
  const sourceLabel = toSafeText(candidate.sourceLabel || resolveSourceLabel(source))
  const modName = toSafeText(candidate.name || context?.mod?.name || '待确认模组')
  const gameName = toSafeText(context?.game?.name || '当前游戏')
  const canSubmit = Boolean(candidate.sourceInstallTaskPayload)
  const taskRequiresNexusAuthorization =
    canSubmit &&
    source === 'nexus' &&
    (candidate.sourceInstallTaskPayload?.metadata?.requiresNexusAuthorization === true ||
      candidate.sourceInstallTaskPayload?.items?.some((entry) => {
        const item = entry?.item || {}
        const installPayload = entry?.meta?.installPayload || {}
        return (
          !toSafeText(item.download_url || installPayload.downloadUrl) &&
          !!pickFirstText(item.sourceFileId, installPayload.id, installPayload.fileId)
        )
      }))
  const planPayloadMetadata =
    (candidate.sourceInstallTaskPayload?.metadata &&
    typeof candidate.sourceInstallTaskPayload.metadata === 'object'
      ? candidate.sourceInstallTaskPayload.metadata
      : sourceInstallTaskPayloadDraft?.metadata &&
          typeof sourceInstallTaskPayloadDraft.metadata === 'object'
        ? sourceInstallTaskPayloadDraft.metadata
        : {}) || {}
  const ruleDefaultDependencies = mergeDependencyItems(
    candidate.ruleDefaultDependencies,
    planPayloadMetadata.ruleDefaultDependencies
  )
  const missingDependencies = mergeDependencyItems(
    candidate.missingDependencies,
    planPayloadMetadata.missingDefaultDependencies,
    planPayloadMetadata.missingNexusRequirements,
    planPayloadMetadata.missingDependencies
  )
  const nexusRequirements = mergeDependencyItems(
    candidate.nexusRequirements,
    planPayloadMetadata.nexusRequirements
  )
  const externalNexusRequirements = mergeDependencyItems(
    candidate.externalNexusRequirements,
    planPayloadMetadata.externalNexusRequirements
  )
  const dlcRequirements = mergeDependencyItems(
    candidate.dlcRequirements,
    planPayloadMetadata.dlcRequirements
  )
  const dependencyCount = Math.max(
    toSafeNumber(candidate.dependencyCount, 0),
    toSafeNumber(planPayloadMetadata.dependencyCount, 0),
    ruleDefaultDependencies.length,
    nexusRequirements.length + externalNexusRequirements.length + dlcRequirements.length
  )
  const needsNexusDownloadAuthorization =
    !canSubmit &&
    missingDecisionReason === 'missing_nexus_download_authorization' &&
    Boolean(sourceInstallTaskPayloadDraft) &&
    manualDownloadItems.length > 0
  const displayVersion = pickFirstText(
    resolvePlanItemVersion(source, candidate),
    resolveSourceInstallTaskPayloadVersion(candidate.sourceInstallTaskPayload)
  )
  const plan = {
    id: `plan-${Date.now()}`,
    candidateIdentity: buildInstallDecisionIdentity(candidate, context),
    modName,
    version: toSafeText(displayVersion || 'latest'),
    source,
    sourceLabel,
    fileName: toSafeText(
      candidate.fileName ||
        candidate.file_name ||
        (canSubmit ? 'AI 已选定下载文件' : 'AI 未选定下载文件')
    ),
    dependencyCount,
    missingDependencies,
    ruleDefaultDependencies,
    nexusRequirements,
    externalNexusRequirements,
    dlcRequirements,
    dependencyResult:
      candidate.nexusDependencyResult ||
      (planPayloadMetadata.nexusDependencyResult &&
      typeof planPayloadMetadata.nexusDependencyResult === 'object'
        ? planPayloadMetadata.nexusDependencyResult
        : null),
    gameName,
    targetSummary: toSafeText(
      context?.game?.installRoot
        ? needsNexusDownloadAuthorization || taskRequiresNexusAuthorization
          ? '等待 Nexus 网页授权下载链接'
          : '当前游戏目录'
        : canSubmit
          ? '等待任务中心预检'
          : formatMissingDecisionText(missingDecisionData)
    ),
    precheckText: canSubmit
      ? taskRequiresNexusAuthorization
        ? '任务可立即创建；加入后需要你在任务中心完成 Nexus 网页授权。'
        : autoTaskPayloadResolved
          ? 'AI 已自动补齐来源、下载与任务 payload 决策，加入任务前仍需要你最终确认。'
          : 'AI 已完成来源、文件与任务 payload 决策，加入任务前仍需要你最终确认。'
      : needsNexusDownloadAuthorization
        ? '已选定 Nexus 文件并匹配安装规则，仍需要在 Nexus 网页授权下载链接。'
        : `AI 决策尚未生成任务中心 payload；${formatMissingDecisionText(missingDecisionData)}，不能直接提交。`,
    riskLevel: canSubmit && !taskRequiresNexusAuthorization ? 'info' : 'warning',
    riskText: canSubmit
      ? taskRequiresNexusAuthorization
        ? '需要用户完成 Nexus 授权'
        : '等待最终确认'
      : needsNexusDownloadAuthorization
        ? '等待 Nexus 授权'
        : 'AI 决策未完成',
    canSubmit,
    canDecide: !canSubmit && !needsNexusDownloadAuthorization,
    primaryActionText: canSubmit
      ? taskRequiresNexusAuthorization
        ? '加入任务并等待授权'
        : '加入安装任务'
      : needsNexusDownloadAuthorization
        ? '授权获取下载链接'
        : '让 AI 继续决策',
    sourceInstallTaskPayload: candidate.sourceInstallTaskPayload || null,
    sourceInstallTaskPayloadDraft,
    manualDownloadItems,
    decisionState: canSubmit
      ? taskRequiresNexusAuthorization
        ? 'ready_waiting_authorization'
        : 'ready'
      : needsNexusDownloadAuthorization
        ? 'needs_nexus_download_authorization'
        : 'needs_more_context',
    autoTaskPayloadResolved,
    missingDecisionData: canSubmit ? [] : missingDecisionData
  }
  if (
    !canSubmit &&
    ['nexus', 'modio'].includes(source) &&
    missingDecisionData.some((field) => ['installRule', 'gameRoot'].includes(field))
  ) {
    plan.installationGuidance = {
      ...analyzeInstallLocationEvidence(collectInstallDetailDocuments(candidate), {}),
      detailLookup: {
        sourcePlatform: source,
        modId: String(candidate.modId || candidate.id || ''),
        ...(source === 'nexus'
          ? {
              domainName:
                candidate.domainName || context.game?.sourceSlug || context.game?.domainName || ''
            }
          : {
              sourceGameId: String(
                candidate.sourceGameId || candidate.gameId || context.game?.sourceGameId || ''
              )
            }),
        ...(candidate.fileId ? { fileId: String(candidate.fileId) } : {})
      }
    }
  }
  plan.decisionPrompt =
    canSubmit || needsNexusDownloadAuthorization
      ? ''
      : buildInstallDecisionPrompt(candidate, context, plan)

  return {
    success: true,
    plan,
    detailResolved: hydratedCandidate.detailResolved
  }
}
