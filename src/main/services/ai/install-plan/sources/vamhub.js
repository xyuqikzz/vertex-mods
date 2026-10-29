// VAM-Hub 既有来源任务兼容逻辑。
import {
  pickFirstText,
  toSafeNumber,
  isPlainObject,
  toSafeText,
  toPlainJson,
  resolveSourceLabel
} from '../values.js'
import { fetchSharedRule } from '../../../../ipc/game/sharedRuleClient.js'
import { compileInstallRuleForAi } from '../rules.js'
import { resolveVamHubFileName, parseVamHubPackage, parseVamHubFileSize } from '../fileMetadata.js'
import { buildLogoFields } from '../images.js'

function resolveVamHubSourceGameId(candidate = {}, context = {}) {
  const rawId = pickFirstText(
    candidate?.sourceGameId,
    candidate?.sourceId,
    context?.game?.sourceGameId,
    context?.install?.sourceGameId,
    context?.route?.query?.sourceGameId,
    context?.route?.params?.id,
    'vam'
  ).toLowerCase()
  if (['game:vam', 'vamhub:vam', 'virt-a-mate', 'virtamate'].includes(rawId)) return 'vam'
  return rawId || 'vam'
}

function resolveVamHubSourceSlug(candidate = {}, context = {}) {
  const rawSlug = pickFirstText(
    candidate?.sourceSlug,
    candidate?.sourceGameSlug,
    context?.game?.sourceSlug,
    context?.route?.query?.sourceSlug,
    context?.route?.query?.sourceGameSlug,
    resolveVamHubSourceGameId(candidate, context),
    'vam'
  ).toLowerCase()
  if (['game:vam', 'vamhub:vam', 'virt-a-mate', 'virtamate'].includes(rawSlug)) return 'vam'
  return rawSlug || 'vam'
}

function resolveVamHubAppId(candidate = {}, context = {}) {
  return toSafeNumber(
    pickFirstText(
      candidate?.appId,
      candidate?.appid,
      context?.game?.appId,
      context?.route?.query?.appId,
      context?.route?.query?.appid,
      context?.route?.query?.steamAppId
    ),
    0
  )
}

function resolveVamHubBackendGameId(candidate = {}, context = {}) {
  return toSafeNumber(
    pickFirstText(
      candidate?.gameId,
      candidate?.backendGameId,
      context?.game?.gameId,
      context?.game?.id,
      context?.route?.query?.gameId,
      context?.route?.query?.backendGameId
    ),
    0
  )
}

function resolveVamHubGameRoot(candidate = {}, context = {}) {
  return pickFirstText(
    candidate?.gameRoot,
    candidate?.gameRootPath,
    candidate?.installRoot,
    context?.game?.gameRoot,
    context?.game?.gameRootPath,
    context?.game?.installRoot,
    context?.install?.installRoot,
    context?.route?.query?.gameRoot,
    context?.route?.query?.gameRootPath,
    context?.route?.query?.clientRootPath
  )
}

async function resolveVamHubInstallRule(
  candidate = {},
  context = {},
  getSharedRule = fetchSharedRule
) {
  const selection = candidate.ruleSelection || context?.install?.ruleSelection
  if (!['local_override', 'player_profile', 'local', 'player'].includes(selection)) {
    const document = await getSharedRule({
      sourcePlatform: 'vamhub',
      sourceGameId: resolveVamHubSourceGameId(candidate, context),
      domainName: resolveVamHubSourceSlug(candidate, context),
      appId: resolveVamHubAppId(candidate, context)
    })
    return compileInstallRuleForAi(document.ruleJson)
  }
  const sourceRule =
    candidate?.installRule ||
    candidate?.vamhubInstallRule ||
    candidate?.sourceInstallRule ||
    context?.install?.installRule ||
    context?.install?.ruleJson ||
    null
  return compileInstallRuleForAi(sourceRule || {})
}

export function resolveVamHubDownloadUrl(planItem = {}) {
  return pickFirstText(
    planItem?.downloadUrl,
    planItem?.download_url,
    planItem?.urlHosted,
    planItem?.latestUrl,
    planItem?.selectedFile?.downloadUrl,
    planItem?.selectedFile?.download_url,
    planItem?.selected_file?.downloadUrl,
    planItem?.selected_file?.download_url,
    planItem?.primaryFile?.downloadUrl,
    planItem?.primaryFile?.download_url,
    planItem?.primary_file?.downloadUrl,
    planItem?.primary_file?.download_url
  )
}

export function resolveVamHubPackageName(planItem = {}) {
  return pickFirstText(
    planItem?.packageName,
    planItem?.package_name,
    planItem?.modId,
    planItem?.mod_id,
    planItem?.id,
    resolveVamHubFileName(planItem).replace(/\.var$/i, '')
  )
}

function buildVamHubSourceInstallPayload(planItem = {}, context = {}, options = {}) {
  const sourceGameId = toSafeText(
    options?.sourceGameId || resolveVamHubSourceGameId(planItem, context)
  )
  const sourceGameSlug = toSafeText(
    options?.sourceGameSlug || resolveVamHubSourceSlug(planItem, context)
  )
  const appId = toSafeNumber(options?.appId, 0)
  const gameId = toSafeNumber(options?.gameId, 0)
  const gameRoot = toSafeText(options?.gameRoot)
  const fileName = resolveVamHubFileName(planItem)
  const parsed = parseVamHubPackage(
    fileName || resolveVamHubPackageName(planItem),
    planItem?.version
  )
  const packageName = resolveVamHubPackageName(planItem)
  const sourceModKey = pickFirstText(planItem?.sourceModKey, parsed.sourceModKey, packageName)
  const sourceFileId = pickFirstText(
    planItem?.sourceFileId,
    planItem?.fileId,
    parsed.id,
    sourceModKey
  )
  const targetFileName = fileName || `${sourceFileId}.var`
  const displayName = pickFirstText(
    planItem?.displayName,
    planItem?.title,
    planItem?.name,
    packageName,
    sourceFileId,
    'VAM-Hub 资源'
  )
  const downloadUrl = resolveVamHubDownloadUrl(planItem)
  const fileSize = toSafeNumber(
    planItem?.fileSize ?? planItem?.file_size_bytes,
    parseVamHubFileSize(planItem?.file_size)
  )
  const resourceId = pickFirstText(planItem?.resourceId, planItem?.resource_id)
  const logoFields = buildLogoFields(planItem)
  const dependencyRole = toSafeText(options?.dependencyRole || planItem?.dependencyRole)
  const dependencyType = toSafeText(options?.dependencyType || planItem?.dependencyType)
  const installRule =
    options?.installRule && isPlainObject(options.installRule) ? options.installRule : {}
  const sourceMeta = {
    source: 'vamhub',
    sourceId: sourceGameId,
    sourceSlug: sourceGameSlug,
    appId: appId || '',
    gameId: gameId || 0,
    platformLabel: resolveSourceLabel('vamhub'),
    resourceId,
    packageName,
    fileName: targetFileName
  }
  const metadata = {
    category: 'vamhub',
    source: 'vamhub',
    sourceType: 'vamhub',
    sourcePlatform: 'vamhub',
    sourceMeta,
    fileName: targetFileName,
    packageName,
    licenseType: toSafeText(planItem?.licenseType),
    resourceId,
    dependencyType,
    tier: toSafeNumber(planItem?.tier, 0),
    ...logoFields
  }

  return toPlainJson(
    {
      source: 'vamhub',
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceAdapter: 'vamhub',
      sourceGameId,
      gameSourceId: sourceGameId,
      gameSourceSlug: sourceGameSlug,
      sourceGameSlug,
      sourceSlug: sourceGameSlug,
      sourceGameDomain: sourceGameSlug,
      gameSourceDomain: sourceGameSlug,
      appid: appId,
      appId,
      gameId,
      gameName: pickFirstText(context?.game?.name, 'Virt-A-Mate'),
      gameRoot,
      gameRootPath: gameRoot,
      clientRootPath: gameRoot,
      sourceModKey,
      sourceModId: sourceModKey,
      sourceFileId,
      modId: sourceModKey,
      fileId: sourceFileId,
      id: sourceFileId,
      modName: displayName,
      name: targetFileName,
      packageFolderName: sourceModKey || displayName,
      version: toSafeNumber(parsed.version, 1),
      fileName: targetFileName,
      archiveName: targetFileName,
      fileSize,
      downloadUrl,
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: 0,
      cleanupSourceArchiveAfterInstall: true,
      dependencyRole,
      dependencyType,
      installRule,
      vamhubInstallRule: installRule,
      sourceInstallRule: installRule,
      ruleSelection: options.ruleSelection || 'public',
      sourceMeta,
      metadata,
      ...logoFields
    },
    {}
  )
}

function buildVamHubSourceInstallTaskEntry(planItem = {}, context = {}, options = {}) {
  const installPayload = buildVamHubSourceInstallPayload(planItem, context, options)
  const sourceGameId = toSafeText(options?.sourceGameId || installPayload.sourceGameId)
  const sourceModKey = toSafeText(installPayload.sourceModKey)
  const sourceFileId = toSafeText(installPayload.sourceFileId)
  const version = toSafeNumber(installPayload.version, 1)
  const displayName = pickFirstText(installPayload.modName, planItem?.name, 'VAM-Hub 资源')
  const logoFields = buildLogoFields(planItem)
  const dependencyRef =
    options?.isDependency === true || toSafeText(options?.dependencyRole)
      ? {
          source: 'vamhub',
          sourceType: 'vamhub',
          sourceModKey,
          dependencyRole: toSafeText(options?.dependencyRole || 'vamhub_dependency'),
          dependencyType: toSafeText(options?.dependencyType || planItem?.dependencyType),
          packageName: installPayload.sourceMeta?.packageName || sourceModKey,
          fileName: installPayload.fileName,
          version
        }
      : null

  return {
    item: {
      id: `vamhub:${sourceFileId}`,
      task_name: `VAM-Hub下载:${displayName}`,
      module: '游戏',
      file_type: 'var',
      file_size: toSafeNumber(installPayload.fileSize, 0),
      download_url: toSafeText(installPayload.downloadUrl),
      saveType: 2,
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      sourceGameId,
      sourceModKey,
      sourceModId: sourceModKey,
      sourceFileId,
      name: displayName,
      version,
      fileName: installPayload.fileName,
      dedupeKey: ['vamhub', sourceGameId, sourceModKey, version].filter(Boolean).join(':'),
      showOpenInDownloadList: true,
      ...logoFields,
      fun: {
        type: 0
      }
    },
    meta: {
      sourceType: 'vamhub',
      sourcePlatform: 'vamhub',
      displayName,
      fileName: installPayload.fileName,
      version,
      sourceGameId,
      sourceMeta: installPayload.sourceMeta,
      artifactKey: `vamhub:${sourceGameId}:${sourceModKey}:${version}`,
      dependencyRef,
      sortIndex: toSafeNumber(options?.sortIndex, 0),
      ...logoFields,
      installPayload
    }
  }
}

async function resolveVamHubInstallPlanItems(payload = {}) {
  const candidate = toPlainJson(payload?.candidate, {})
  const fallbackItem = toPlainJson(payload?.fallbackItem || candidate, {})
  if (typeof payload?.resolveVamHubDependencies !== 'function') {
    const dependencies = Array.isArray(candidate?.dependencies) ? candidate.dependencies : []
    return dependencies.length
      ? [
          fallbackItem,
          ...dependencies.map((item) => ({
            ...toPlainJson(item, {}),
            dependencyRole: pickFirstText(item?.dependencyRole, 'vamhub_dependency')
          }))
        ]
      : [fallbackItem]
  }

  try {
    const result = await payload.resolveVamHubDependencies({
      source: 'vamhub',
      candidate,
      context: payload?.context,
      maxDepth: payload?.maxDepth
    })
    const dependencies = Array.isArray(result?.dependencies) ? result.dependencies : []
    return dependencies.length ? [fallbackItem, ...dependencies] : [fallbackItem]
  } catch {
    return [fallbackItem]
  }
}

export async function resolveVamhubSourceTask(payload, candidate, context) {
  const sourceGameId = resolveVamHubSourceGameId(candidate, context)
  const sourceGameSlug = resolveVamHubSourceSlug(candidate, context)
  const packageName = resolveVamHubPackageName(candidate)
  const downloadUrl = resolveVamHubDownloadUrl(candidate)
  const fileName = resolveVamHubFileName(candidate)
  const gameRoot = resolveVamHubGameRoot(candidate, context)

  const runtimeMissingFields = []
  if (!sourceGameId) runtimeMissingFields.push('sourceGameId')
  if (!packageName) runtimeMissingFields.push('sourceModId')
  if (!fileName) runtimeMissingFields.push('downloadFile')
  if (!downloadUrl) runtimeMissingFields.push('downloadUrl')
  if (!gameRoot) runtimeMissingFields.push('gameRoot')

  if (runtimeMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_vamhub_runtime_context',
      missingFields: runtimeMissingFields
    }
  }

  const appId = resolveVamHubAppId(candidate, context)
  const gameId = resolveVamHubBackendGameId(candidate, context)
  const installRule = await resolveVamHubInstallRule(candidate, context, payload?.getSharedRule)
  const ruleSelection = candidate.ruleSelection || context?.install?.ruleSelection || 'public'
  const resolvedCandidate = {
    ...candidate,
    source: 'vamhub',
    packageName,
    fileName,
    downloadUrl
  }
  const planItems = await resolveVamHubInstallPlanItems({
    candidate: resolvedCandidate,
    fallbackItem: resolvedCandidate,
    context,
    resolveVamHubDependencies: payload?.resolveVamHubDependencies,
    maxDepth: payload?.maxDepth
  })
  const taskEntries = planItems.map((planItem, index) => {
    const isDependency = index > 0
    return buildVamHubSourceInstallTaskEntry(planItem, context, {
      sourceGameId,
      sourceGameSlug,
      appId,
      gameId,
      gameRoot,
      installRule,
      ruleSelection,
      sortIndex: index,
      isDependency,
      dependencyRole: isDependency ? 'vamhub_dependency' : '',
      dependencyType: isDependency
        ? pickFirstText(planItem?.dependencyType, planItem?.dependency_type)
        : ''
    })
  })
  const rootEntry = taskEntries[0]
  const installPayload =
    rootEntry?.meta?.installPayload ||
    buildVamHubSourceInstallPayload(resolvedCandidate, context, {
      sourceGameId,
      sourceGameSlug,
      appId,
      gameId,
      gameRoot,
      installRule,
      ruleSelection
    })

  return {
    success: true,
    payload: {
      source: 'vamhub',
      sourceAdapter: 'vamhub',
      sourceGameId,
      gameKey: `vamhub:${sourceGameId}`,
      gameRoot,
      title: `${pickFirstText(candidate?.name, candidate?.title, packageName)} 安装任务`,
      mainItem: rootEntry?.item || {},
      mainMeta: rootEntry?.meta || {},
      items: taskEntries,
      installRule,
      sourceMeta: {
        source: 'vamhub',
        sourceId: sourceGameId,
        sourceSlug: sourceGameSlug,
        appId: appId || '',
        gameId: gameId || 0,
        sourceGameId,
        platformLabel: resolveSourceLabel('vamhub'),
        resourceId: pickFirstText(candidate?.resourceId, candidate?.resource_id),
        packageName
      },
      metadata: {
        requestModId: packageName,
        sourceGameId,
        appId,
        gameId,
        dependencyCount: Math.max(taskEntries.length - 1, 0)
      },
      options: {
        autoStart: true,
        includeDependencies: taskEntries.length > 1
      }
    },
    installPayload,
    dependencyCount: Math.max(taskEntries.length - 1, 0)
  }
}
