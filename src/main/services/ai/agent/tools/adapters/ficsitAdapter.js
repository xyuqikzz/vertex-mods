import { resolveAiAgentSourceInstallTaskPayload } from '../../../agentInstallPlan.js'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'

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

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source, '未知来源')
}

function normalizeDependencyReference(dependency = {}, options = {}) {
  if (typeof dependency === 'string') {
    const text = toSafeText(dependency)
    if (!text) return null
    return {
      source: options.source || '',
      id: text,
      name: text,
      version: '',
      optional: false,
      installState: options.installState || 'metadata_only',
      raw: text
    }
  }

  if (!dependency || typeof dependency !== 'object') {
    return null
  }

  const id = pickFirstText(
    dependency.id,
    dependency.modId,
    dependency.mod_id,
    dependency.modReference,
    dependency.mod_reference,
    dependency.packageFullName,
    dependency.fullName,
    dependency.full_name,
    dependency.name
  )
  if (!id) return null

  return {
    source: options.source || '',
    id,
    modId: pickFirstText(dependency.modId, dependency.mod_id),
    modReference: pickFirstText(dependency.modReference, dependency.mod_reference),
    packageFullName: pickFirstText(
      dependency.packageFullName,
      dependency.fullName,
      dependency.full_name
    ),
    name: pickFirstText(dependency.name, dependency.displayName, dependency.modReference, id),
    version: pickFirstText(dependency.version, dependency.version_number, dependency.versionId),
    condition: toSafeText(dependency.condition),
    optional: dependency.optional === true,
    installState: options.installState || toSafeText(dependency.installState, 'metadata_only'),
    dependencyRole: pickFirstText(dependency.dependencyRole, dependency.dependency_role),
    raw: toPlainJson(dependency, {})
  }
}

function normalizeDependencyList(list = [], options = {}) {
  return (Array.isArray(list) ? list : [])
    .map((item) => normalizeDependencyReference(item, options))
    .filter(Boolean)
}

function normalizeFicsitKey(value = '') {
  return toSafeText(value).toLowerCase()
}

function normalizeFicsitPlanItem(item = {}, options = {}) {
  const modReference = pickFirstText(item.modReference, item.mod_reference, item.id, item.name)
  if (!modReference) return null
  return {
    source: 'ficsit',
    id: modReference,
    modReference,
    name: pickFirstText(item.name, modReference),
    version: toSafeText(item.version),
    versionId: toSafeText(item.versionId),
    downloadUrl: toSafeText(item.downloadUrl),
    optional: false,
    installState: options.installState || 'pending',
    isRoot: options.isRoot === true,
    sortIndex: toSafeNumber(options.sortIndex, 0),
    dependencies: normalizeDependencyList(item.dependencies, {
      source: 'ficsit',
      installState: 'metadata_only'
    }),
    raw: toPlainJson(item, {})
  }
}

function resolveFicsitAppId(candidate = {}, context = {}) {
  return toSafeNumber(
    candidate.appId ||
      candidate.ficsitAppId ||
      context?.game?.appId ||
      context?.game?.sourceGameId ||
      context?.route?.query?.appId ||
      context?.route?.query?.ficsitAppId,
    0
  )
}

function resolveFicsitGameId(candidate = {}, context = {}, appId = 0) {
  return (
    toSafeNumber(
      candidate.gameId ||
        candidate.ficsitGameId ||
        context?.game?.gameId ||
        context?.route?.query?.gameId ||
        context?.route?.query?.ficsitGameId,
      0
    ) || appId
  )
}

export async function resolveFicsitDependencies(args = {}, ctx = {}) {
  const candidate = toPlainJson(args.candidate, {})
  const context = toPlainJson(args.context || ctx?.pageContext, {})
  const appId = resolveFicsitAppId(candidate, context)
  const gameId = resolveFicsitGameId(candidate, context, appId)
  const modReference = pickFirstText(
    candidate.modReference,
    candidate.mod_reference,
    candidate.modId,
    candidate.id
  )
  const downloadUrl = toSafeText(candidate.downloadUrl)

  if (!appId || !modReference || !downloadUrl) {
    return {
      success: false,
      source: 'ficsit',
      sourceLabel: resolveSourceLabel('ficsit'),
      errorCode: 'missing_ficsit_context',
      message: 'Ficsit 依赖解析缺少 appId、modReference 或 downloadUrl。',
      missing: [
        !appId ? 'appId' : '',
        !modReference ? 'modReference' : '',
        !downloadUrl ? 'downloadUrl' : ''
      ].filter(Boolean)
    }
  }

  let preparePlan = ctx?.prepareFicsitPlan
  if (typeof preparePlan !== 'function') {
    const ficsitModule = await import('../../../../../ipc/game/ficsit.js')
    preparePlan = ficsitModule.ficsitPrepareInstallPlan
  }

  const request = {
    appId,
    gameId,
    executableFile: pickFirstText(
      candidate.executableFile,
      context?.game?.executableFile,
      context?.game?.clientExePath
    ),
    modId: toSafeNumber(candidate.modId, 0),
    modReference,
    name: pickFirstText(candidate.name, modReference),
    version: toSafeText(candidate.version),
    downloadUrl,
    logo: pickFirstText(candidate.pictureUrl, candidate.logo, candidate.cover)
  }
  const payloadContext = {
    ...context,
    game: {
      ...toPlainJson(context?.game, {}),
      appId,
      id: gameId,
      sourceGameId: gameId,
      ficsitGameId: gameId
    }
  }
  const resolveTaskPayload =
    typeof ctx?.resolveSourceInstallTaskPayload === 'function'
      ? ctx.resolveSourceInstallTaskPayload
      : resolveAiAgentSourceInstallTaskPayload
  const taskPayloadResult = await resolveTaskPayload({
    candidate: {
      ...candidate,
      source: 'ficsit',
      modReference,
      downloadUrl
    },
    context: payloadContext,
    installRule: toPlainJson(args.installRule, {}),
    prepareFicsitPlan: preparePlan,
    getSharedRule: ctx?.getSharedRule
  })
  const planResult = taskPayloadResult?.planResult || {}
  const installOrder = Array.isArray(planResult?.installPlan) ? planResult.installPlan : []
  if (!taskPayloadResult?.success || !planResult?.success) {
    return {
      success: false,
      source: 'ficsit',
      sourceLabel: resolveSourceLabel('ficsit'),
      errorCode: 'ficsit_dependency_resolve_failed',
      message: toSafeText(planResult?.message || taskPayloadResult?.reason, 'Ficsit 依赖解析失败。')
    }
  }

  const rootKey = normalizeFicsitKey(planResult?.rootKey || modReference)
  const normalizedInstallPlan = installOrder
    .map((item, index) =>
      normalizeFicsitPlanItem(item, {
        sortIndex: index,
        isRoot: normalizeFicsitKey(item?.modReference || item?.mod_reference) === rootKey
      })
    )
    .filter(Boolean)
  const pendingDependencies = normalizedInstallPlan.filter((item) => !item.isRoot)
  const reusedInstalledDependencies = normalizeDependencyList(
    planResult?.reusedInstalledDependencies,
    {
      source: 'ficsit',
      installState: 'reused_installed'
    }
  )
  const sourceInstallTaskPayload = taskPayloadResult?.payload || null
  const canSubmitInstallTask = Boolean(sourceInstallTaskPayload?.items?.length)

  return {
    success: true,
    source: 'ficsit',
    sourceLabel: resolveSourceLabel('ficsit'),
    resolverStatus: 'resolved',
    recursive: true,
    request,
    root: normalizedInstallPlan.find((item) => item.isRoot) || {
      source: 'ficsit',
      id: modReference,
      modReference,
      name: pickFirstText(candidate.name, modReference),
      version: toSafeText(candidate.version)
    },
    dependencyCount: pendingDependencies.length + reusedInstalledDependencies.length,
    pendingInstallCount: normalizedInstallPlan.length,
    reusedInstalledDependencyCount: reusedInstalledDependencies.length,
    dependencies: [...pendingDependencies, ...reusedInstalledDependencies],
    installPlan: normalizedInstallPlan,
    reusedInstalledDependencies,
    sourceInstallTaskPayload,
    canSubmitInstallTask,
    message:
      pendingDependencies.length || reusedInstalledDependencies.length
        ? `Ficsit 依赖解析完成，待安装 ${pendingDependencies.length} 个依赖，复用 ${reusedInstalledDependencies.length} 个已安装依赖。`
        : 'Ficsit 依赖解析完成，未发现需要补装的依赖。'
  }
}
