// Nexus 安装计划准备与来源任务编排。
import {
  toSafeText,
  toSafeNumber,
  toPlainJson,
  pickFirstText,
  parseJsonObject,
  resolveSourceLabel
} from '../values.js'
import {
  resolveNexusDefaultDependencyPlan,
  resolveNexusRequirementDependencyPlan
} from './nexusDependencies.js'
import { buildNexusSourceInstallTaskEntry, buildNexusSourceInstallPayload } from './nexusPayload.js'
import { fetchSharedRule } from '../../../../ipc/game/sharedRuleClient.js'
import { resolveNexusDependencies } from '../../agent/tools/adapters/nexusAdapter.js'
import { resolveNexusDomainName, resolveNexusAppId, resolveNexusGameRoot } from './nexusIdentity.js'

function buildNexusSourceInstallTaskPayload(candidate = {}, context = {}, options = {}) {
  const modId = toSafeNumber(candidate?.modId || candidate?.id, 0)
  const fileId = toSafeNumber(candidate?.fileId, 0)
  const nexusGameId = toSafeNumber(options?.nexusGameId, 0)
  const appId = toSafeNumber(options?.appId, 0)
  const gameRoot = toSafeText(options?.gameRoot)
  const defaultDependencyPlan = resolveNexusDefaultDependencyPlan(context, options)
  const nexusRequirementPlan = resolveNexusRequirementDependencyPlan(context, {
    ...options,
    sortIndex: defaultDependencyPlan.taskEntries.length,
    nexusDependencyResult: options?.nexusDependencyResult
  })
  const mainEntry = buildNexusSourceInstallTaskEntry(candidate, context, {
    ...options,
    sortIndex: defaultDependencyPlan.taskEntries.length + nexusRequirementPlan.taskEntries.length
  })
  const items = [
    ...defaultDependencyPlan.taskEntries,
    ...nexusRequirementPlan.taskEntries,
    mainEntry
  ]
  const dependencyCount =
    defaultDependencyPlan.dependencyCount + nexusRequirementPlan.dependencyCount
  const missingDependencies = [
    ...defaultDependencyPlan.missingDependencies,
    ...nexusRequirementPlan.missingDependencies
  ]
  const manualDownloadItems = Array.isArray(nexusRequirementPlan.manualDownloadItems)
    ? nexusRequirementPlan.manualDownloadItems
    : []

  return toPlainJson(
    {
      source: 'nexus',
      sourceAdapter: 'nexus',
      sourceGameId: String(nexusGameId),
      gameKey: `nexus:${nexusGameId}`,
      gameRoot,
      title: `${pickFirstText(candidate?.name, candidate?.modName, `nexus-${modId}`)} 安装任务`,
      items,
      manualDownloadItems,
      metadata: {
        requestModId: modId,
        fileId,
        nexusGameId,
        appId,
        dependencyCount,
        defaultDependencyCount: defaultDependencyPlan.dependencyCount,
        nexusRequirementCount: nexusRequirementPlan.dependencyCount,
        taskDefaultDependencyCount: defaultDependencyPlan.taskEntries.length,
        taskNexusRequirementCount: nexusRequirementPlan.taskEntries.length,
        missingDefaultDependencies: defaultDependencyPlan.missingDependencies,
        missingNexusRequirements: nexusRequirementPlan.missingDependencies,
        missingDependencies,
        manualDownloadItems,
        ruleDefaultDependencies: defaultDependencyPlan.ruleDefaultDependencies,
        nexusRequirements: nexusRequirementPlan.requirementDependencies,
        externalNexusRequirements: nexusRequirementPlan.externalDependencies,
        reusedInstalledNexusRequirements: nexusRequirementPlan.reusedInstalledDependencies,
        dlcRequirements: nexusRequirementPlan.dlcRequirements,
        nexusDependencyResult: options?.nexusDependencyResult || null
      },
      options: {
        autoStart: true,
        includeDependencies:
          defaultDependencyPlan.taskEntries.length + nexusRequirementPlan.taskEntries.length > 0
      }
    },
    {}
  )
}

export async function resolveNexusSourceTask(payload, candidate, context) {
  const domainName = resolveNexusDomainName(candidate, context)
  const modId = toSafeNumber(candidate?.modId || candidate?.id, 0)
  const fileId = toSafeNumber(candidate?.fileId, 0)
  const downloadUrl = toSafeText(candidate?.downloadUrl)

  const runtimeMissingFields = []
  if (!domainName) runtimeMissingFields.push('sourceGameDomain')
  if (!modId) runtimeMissingFields.push('sourceModId')
  if (!fileId) runtimeMissingFields.push('downloadFile')
  if (!downloadUrl) runtimeMissingFields.push('downloadUrl')

  const identityMissingFields = runtimeMissingFields.filter((field) => field !== 'downloadUrl')
  if (identityMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_nexus_runtime_context',
      missingFields: runtimeMissingFields
    }
  }

  let getNexusBinding = payload?.getNexusBinding
  if (typeof getNexusBinding !== 'function') {
    const nexusBindingModule = await import('../../../../db/sources/nexus/nexusBinding.js')
    getNexusBinding = nexusBindingModule.getNexusGameBinding
  }

  const fallbackNexusGameId = toSafeNumber(
    pickFirstText(candidate?.nexusGameId, candidate?.gameId, context?.game?.sourceGameId),
    0
  )
  const binding =
    getNexusBinding({
      nexusGameId: fallbackNexusGameId,
      domainName,
      appId: resolveNexusAppId(candidate, context)
    }) ||
    getNexusBinding({
      domainName,
      appId: resolveNexusAppId(candidate, context)
    }) ||
    getNexusBinding({
      nexusGameId: fallbackNexusGameId,
      domainName
    }) ||
    null

  const appId = resolveNexusAppId(candidate, context, binding)
  const nexusGameId = toSafeNumber(binding?.nexusGameId, 0) || fallbackNexusGameId
  const gameRoot = resolveNexusGameRoot(context, binding)

  let getNexusLatestRule = payload?.getNexusLatestRule
  if (typeof getNexusLatestRule !== 'function') {
    getNexusLatestRule = (id) =>
      fetchSharedRule({
        sourcePlatform: 'nexus',
        sourceGameId: String(id),
        nexusGameId: id,
        domainName,
        appId
      })
  }

  const cachedRule = nexusGameId ? await getNexusLatestRule(nexusGameId) : null
  const ruleJson = parseJsonObject(cachedRule?.ruleJson, {})
  const backendGameId = toSafeNumber(cachedRule?.gameId, 0)

  const installMissingFields = []
  // Nexus 按来源游戏身份和已绑定目录安装；Steam App ID 只用于补充匹配，
  // 不能阻止已有 Nexus 身份的游戏进入预检或下载授权。
  if (!nexusGameId) installMissingFields.push('sourceGameId')
  if (!gameRoot) installMissingFields.push('gameRoot')
  if (!Object.keys(ruleJson).length) installMissingFields.push('installRule')

  const missingFields = [...runtimeMissingFields, ...installMissingFields]
  if (installMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_nexus_install_context',
      missingFields
    }
  }

  const profileName = pickFirstText(candidate?.profileName, context?.route?.query?.profileName)
  let nexusDependencyResult = null
  try {
    nexusDependencyResult = await resolveNexusDependencies(
      {
        candidate: {
          ...candidate,
          domainName,
          modId,
          fileId
        },
        context
      },
      {
        pageContext: context,
        getModDetail: payload?.getModDetail,
        getNexusRequirements: payload?.getNexusRequirements,
        getNexusModRequirements: payload?.getNexusModRequirements,
        installedNexusModIds: payload?.installedNexusModIds,
        installedNexusMods: payload?.installedNexusMods
      }
    )
  } catch (error) {
    nexusDependencyResult = {
      success: false,
      source: 'nexus',
      sourceLabel: resolveSourceLabel('nexus'),
      resolverStatus: 'failed',
      dependencyCount: 0,
      dependencies: [],
      installPlan: [],
      warnings: [toSafeText(error?.message, 'Nexus 依赖解析失败')]
    }
  }
  const payloadOptions = {
    appId,
    gameId: backendGameId,
    nexusGameId,
    gameName: pickFirstText(context?.game?.name, binding?.gameName),
    gameRoot,
    domainName,
    installRule: ruleJson,
    profileName,
    ruleVersion: toSafeNumber(cachedRule?.ruleVersion, 0),
    sortIndex: 0,
    nexusDependencyResult
  }
  const installPayload = buildNexusSourceInstallPayload(candidate, context, payloadOptions)
  const sourceInstallTaskPayload = buildNexusSourceInstallTaskPayload(
    candidate,
    context,
    payloadOptions
  )
  const sourceInstallTaskPayloadMeta =
    sourceInstallTaskPayload?.metadata && typeof sourceInstallTaskPayload.metadata === 'object'
      ? sourceInstallTaskPayload.metadata
      : {}
  const dependencyManualDownloadItems = Array.isArray(sourceInstallTaskPayload.manualDownloadItems)
    ? sourceInstallTaskPayload.manualDownloadItems
    : Array.isArray(sourceInstallTaskPayloadMeta.manualDownloadItems)
      ? sourceInstallTaskPayloadMeta.manualDownloadItems
      : []
  const dependencyResult = {
    dependencyCount: toSafeNumber(sourceInstallTaskPayloadMeta.dependencyCount, 0),
    defaultDependencyCount: toSafeNumber(sourceInstallTaskPayloadMeta.defaultDependencyCount, 0),
    nexusRequirementCount: toSafeNumber(sourceInstallTaskPayloadMeta.nexusRequirementCount, 0),
    missingDefaultDependencies: Array.isArray(
      sourceInstallTaskPayloadMeta.missingDefaultDependencies
    )
      ? sourceInstallTaskPayloadMeta.missingDefaultDependencies
      : [],
    missingNexusRequirements: Array.isArray(sourceInstallTaskPayloadMeta.missingNexusRequirements)
      ? sourceInstallTaskPayloadMeta.missingNexusRequirements
      : [],
    missingDependencies: Array.isArray(sourceInstallTaskPayloadMeta.missingDependencies)
      ? sourceInstallTaskPayloadMeta.missingDependencies
      : [],
    ruleDefaultDependencies: Array.isArray(sourceInstallTaskPayloadMeta.ruleDefaultDependencies)
      ? sourceInstallTaskPayloadMeta.ruleDefaultDependencies
      : [],
    nexusRequirements: Array.isArray(sourceInstallTaskPayloadMeta.nexusRequirements)
      ? sourceInstallTaskPayloadMeta.nexusRequirements
      : [],
    externalNexusRequirements: Array.isArray(sourceInstallTaskPayloadMeta.externalNexusRequirements)
      ? sourceInstallTaskPayloadMeta.externalNexusRequirements
      : [],
    dlcRequirements: Array.isArray(sourceInstallTaskPayloadMeta.dlcRequirements)
      ? sourceInstallTaskPayloadMeta.dlcRequirements
      : [],
    manualDownloadItems: dependencyManualDownloadItems,
    nexusDependencyResult:
      sourceInstallTaskPayloadMeta.nexusDependencyResult &&
      typeof sourceInstallTaskPayloadMeta.nexusDependencyResult === 'object'
        ? sourceInstallTaskPayloadMeta.nexusDependencyResult
        : nexusDependencyResult
  }
  const hasRequiredMissingDefaultDependency = dependencyResult.missingDefaultDependencies.some(
    (item) => item?.required !== false || item?.blocking === true
  )
  const hasRequiredMissingNexusRequirement = dependencyResult.missingNexusRequirements.some(
    (item) => item?.required !== false || item?.blocking === true
  )

  const requiresNexusAuthorization = !downloadUrl || dependencyManualDownloadItems.length > 0
  sourceInstallTaskPayload.metadata = {
    ...sourceInstallTaskPayloadMeta,
    requiresNexusAuthorization
  }

  if (hasRequiredMissingDefaultDependency) {
    return {
      success: false,
      payload: null,
      payloadDraft: sourceInstallTaskPayload,
      sourceInstallTaskPayloadDraft: sourceInstallTaskPayload,
      reason: 'missing_default_dependencies',
      missingFields: ['defaultDependencies'],
      binding,
      rule: cachedRule,
      installPayload,
      ...dependencyResult
    }
  }

  if (hasRequiredMissingNexusRequirement) {
    return {
      success: false,
      payload: null,
      payloadDraft: sourceInstallTaskPayload,
      sourceInstallTaskPayloadDraft: sourceInstallTaskPayload,
      reason: 'missing_nexus_dependencies',
      missingFields: ['nexusDependencies'],
      binding,
      rule: cachedRule,
      installPayload,
      ...dependencyResult
    }
  }

  return {
    success: true,
    payload: sourceInstallTaskPayload,
    binding,
    rule: cachedRule,
    installPayload,
    requiresNexusAuthorization,
    ...dependencyResult
  }
}
