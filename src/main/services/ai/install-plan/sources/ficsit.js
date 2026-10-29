// Ficsit 安装参数与来源任务准备。
import {
  toSafeNumber,
  pickFirstText,
  toSafeText,
  normalizeTextKey,
  toPlainJson
} from '../values.js'
import { resolveFicsitVersion } from '../fileMetadata.js'
import { buildLogoFields } from '../images.js'
import { fetchSharedRule } from '../../../../ipc/game/sharedRuleClient.js'
import { compileInstallRuleForAi } from '../rules.js'

function resolveFicsitAppId(context = {}) {
  return toSafeNumber(
    pickFirstText(
      context?.game?.appId,
      context?.route?.query?.appId,
      context?.route?.query?.appid,
      context?.route?.query?.steamAppId,
      context?.route?.params?.id,
      context?.game?.sourceGameId,
      context?.game?.id
    ),
    0
  )
}

function resolveFicsitGameId(context = {}) {
  return toSafeNumber(
    pickFirstText(
      context?.game?.id,
      context?.game?.sourceGameId,
      context?.route?.query?.gameId,
      context?.route?.params?.id,
      context?.game?.appId
    ),
    0
  )
}

function normalizeFicsitDependencyRecord(item = {}) {
  if (typeof item === 'string') {
    const modReference = toSafeText(item)
    if (!modReference) return null
    return {
      source: 'ficsit',
      sourceType: 'ficsit',
      sourceModKey: modReference,
      dependencyRole: 'ficsit_requirement',
      modReference,
      condition: '',
      optional: false,
      name: modReference,
      version: ''
    }
  }

  const source = item && typeof item === 'object' ? item : {}
  const modReference = pickFirstText(
    source.modReference,
    source.mod_reference,
    source.sourceModKey,
    source.source_mod_key
  )
  if (!modReference) {
    return null
  }

  return {
    source: 'ficsit',
    sourceType: 'ficsit',
    sourceModKey: pickFirstText(source.sourceModKey, source.source_mod_key, modReference),
    dependencyRole: toSafeText(source.dependencyRole || 'ficsit_requirement'),
    modReference,
    condition: toSafeText(source.condition || source.requiredVersion),
    optional: source.optional === true,
    name: pickFirstText(source.name, source.modName, modReference),
    version: toSafeText(source.version)
  }
}

function normalizeFicsitDependencyRecords(list = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const dependency = normalizeFicsitDependencyRecord(item)
    if (!dependency) {
      continue
    }
    const key = `${normalizeTextKey(dependency.modReference)}@${normalizeTextKey(dependency.condition)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(dependency)
  }
  return result
}

function buildFicsitDownloadBusinessId(sourceGameId = '', planItem = {}) {
  const modKey = normalizeTextKey(
    pickFirstText(planItem?.modReference, planItem?.modId, planItem?.name)
  )
  return sourceGameId && modKey ? `ficsit:${sourceGameId}:${modKey}` : ''
}

function buildFicsitDownloadDedupeKey(sourceGameId = '', planItem = {}) {
  const businessId = buildFicsitDownloadBusinessId(sourceGameId, planItem)
  const fileKey = normalizeTextKey(
    pickFirstText(resolveFicsitVersion(planItem), planItem?.versionId, planItem?.downloadUrl)
  )
  return [businessId, fileKey].filter(Boolean).join(':')
}

function buildFicsitSourceInstallPayload(planItem = {}, context = {}, options = {}) {
  const appId = toSafeNumber(options?.appId, 0)
  const gameId = toSafeNumber(options?.gameId || resolveFicsitGameId(context) || appId, 0)
  const sourceGameId = String(appId || gameId).trim()
  const modReference = pickFirstText(planItem?.modReference, planItem?.sourceModKey)
  const version = resolveFicsitVersion(planItem)
  const versionId = pickFirstText(planItem?.versionId, planItem?.fileId, version, modReference)
  const displayName = pickFirstText(planItem?.name, modReference)
  const sortIndex = toSafeNumber(planItem?.sortIndex ?? options?.sortIndex, 0)
  const dependencies = normalizeFicsitDependencyRecords(planItem?.dependencies)
  const profileName = toSafeText(options?.profileName || 'Ficsit')
  const logoFields = buildLogoFields(planItem)
  const installRule =
    options?.installRule && typeof options.installRule === 'object' ? options.installRule : {}
  const sourceMeta = {
    source: 'ficsit',
    sourceId: appId,
    sourceSlug: 'satisfactory',
    modReference,
    modName: displayName,
    version,
    versionId,
    stability: toSafeText(planItem?.stability),
    fileName: toSafeText(planItem?.archiveName),
    profileName,
    ...logoFields
  }

  return toPlainJson(
    {
      source: 'ficsit',
      sourceType: 'ficsit',
      sourcePlatform: 'ficsit',
      sourceAdapter: 'ficsit',
      sourceGameId: appId,
      sourceGameSlug: 'satisfactory',
      ficsitGameId: appId,
      appid: appId,
      appId,
      steamAppId: appId,
      gameId,
      gameName: pickFirstText(context?.game?.name, '幸福工厂'),
      gameRoot: toSafeText(context?.game?.installRoot),
      clientInstallPath: '.',
      serverInstallPath: '',
      modId: modReference,
      fileId: versionId,
      id: versionId,
      modReference,
      modName: displayName,
      name: displayName,
      packageFolderName: modReference,
      version,
      fileSize: toSafeNumber(planItem?.fileSize, 0),
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: 0,
      ...logoFields,
      downloadUrl: toSafeText(planItem?.downloadUrl),
      gameSourceId: sourceGameId,
      gameSourceSlug: 'satisfactory',
      sourceId: modReference,
      sourceSlug: 'satisfactory',
      sourceGameDomain: 'satisfactory',
      gameDomainName: 'satisfactory',
      sourceModKey: modReference,
      priorityOrder: sortIndex,
      profileName,
      targetProfileName: profileName,
      cleanupSourceArchiveAfterInstall: true,
      modVersion: version,
      dependencies,
      ficsitInstallRule: installRule,
      sourceInstallRule: installRule,
      ruleSelection: options.ruleSelection || 'public',
      installRule,
      sourceMeta,
      metadata: {
        source: 'ficsit',
        sourceType: 'ficsit',
        sourceAdapter: 'ficsit',
        category: 'ficsit',
        sourceModKey: modReference,
        modReference,
        versionId,
        sortIndex,
        profileName,
        stability: toSafeText(planItem?.stability),
        dependencies,
        ...logoFields,
        originalFicsitVersion: {
          id: versionId,
          version,
          stability: toSafeText(planItem?.stability),
          link: toSafeText(planItem?.downloadUrl)
        }
      },
      sourceOriginal: {
        ...sourceMeta,
        dependencies
      }
    },
    {}
  )
}

function enrichFicsitInstallPlanEntries(installPlan = [], candidate = {}) {
  return (Array.isArray(installPlan) ? installPlan : []).map((entry, index) => {
    const planItem = entry && typeof entry === 'object' ? entry : {}
    const itemLogoFields = buildLogoFields(planItem)
    const logoFields = Object.keys(itemLogoFields).length
      ? itemLogoFields
      : buildLogoFields(candidate)
    const modReference = pickFirstText(
      planItem?.modReference,
      planItem?.sourceModKey,
      candidate?.modReference,
      candidate?.modId,
      candidate?.id
    )
    const version = pickFirstText(resolveFicsitVersion(planItem), resolveFicsitVersion(candidate))

    return {
      ...planItem,
      modReference,
      name: pickFirstText(planItem?.name, candidate?.name, modReference),
      version,
      versionId: pickFirstText(
        planItem?.versionId,
        planItem?.fileId,
        candidate?.versionId,
        candidate?.fileId,
        version,
        modReference
      ),
      downloadUrl: pickFirstText(planItem?.downloadUrl, candidate?.downloadUrl),
      fileSize: toSafeNumber(planItem?.fileSize ?? candidate?.fileSize, 0),
      sortIndex: toSafeNumber(planItem?.sortIndex, index),
      ...logoFields
    }
  })
}

function buildFicsitDownloadBatchEntries(installPlan = [], context = {}, options = {}) {
  const appId = toSafeNumber(options?.appId, 0)
  const gameId = toSafeNumber(options?.gameId || resolveFicsitGameId(context) || appId, 0)
  const sourceGameId = String(appId || gameId).trim()
  const profileName = toSafeText(options?.profileName || 'Ficsit')
  const installRule =
    options?.installRule && typeof options.installRule === 'object' ? options.installRule : {}

  return (Array.isArray(installPlan) ? installPlan : []).map((planItem, index) => {
    const modReference = toSafeText(planItem?.modReference)
    const displayName = pickFirstText(planItem?.name, modReference, '未知模组')
    const version = resolveFicsitVersion(planItem)
    const downloadUrl = toSafeText(planItem?.downloadUrl)
    const sortIndex = toSafeNumber(planItem?.sortIndex, index)
    const logoFields = buildLogoFields(planItem)
    return {
      item: {
        task_name: `Ficsit模组下载:${displayName}${version ? `@${version}` : ''}`,
        module: '游戏',
        file_type: 'zip',
        download_url: downloadUrl,
        file_size: toSafeNumber(planItem?.fileSize, 0),
        saveType: 2,
        sourcePlatform: 'ficsit',
        sourceType: 'ficsit',
        sourceGameId,
        sourceModId: modReference,
        sourceModKey: buildFicsitDownloadBusinessId(sourceGameId, planItem),
        modReference,
        version,
        sourceFileId: pickFirstText(planItem?.versionId, planItem?.fileId, version),
        businessId: buildFicsitDownloadBusinessId(sourceGameId, planItem),
        dedupeKey: buildFicsitDownloadDedupeKey(sourceGameId, planItem),
        ...logoFields,
        fun: {
          type: 0
        }
      },
      meta: {
        ...toPlainJson(planItem, {}),
        sortIndex,
        sourcePlatform: 'ficsit',
        sourceType: 'ficsit',
        displayName,
        version,
        ...logoFields,
        installPayload: buildFicsitSourceInstallPayload(planItem, context, {
          appId,
          gameId,
          installRule,
          ruleSelection: options.ruleSelection,
          profileName,
          sortIndex
        })
      }
    }
  })
}

export async function resolveFicsitSourceTask(payload, candidate, context) {
  const appId = resolveFicsitAppId(context)
  const gameId = resolveFicsitGameId(context) || appId
  const modReference = pickFirstText(candidate?.modReference, candidate?.modId, candidate?.id)
  const downloadUrl = toSafeText(candidate?.downloadUrl)

  const runtimeMissingFields = []
  if (!appId) runtimeMissingFields.push('sourceGameId')
  if (!modReference) runtimeMissingFields.push('sourceModId')
  if (!downloadUrl) runtimeMissingFields.push('downloadUrl')

  if (runtimeMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_ficsit_runtime_context',
      missingFields: runtimeMissingFields
    }
  }

  let preparePlan = payload?.prepareFicsitPlan
  if (typeof preparePlan !== 'function') {
    const ficsitModule = await import('../../../../ipc/game/ficsit.js')
    preparePlan = ficsitModule.ficsitPrepareInstallPlan
  }

  const ruleSelection = candidate.ruleSelection || context?.install?.ruleSelection || 'public'
  const privateRule = ['local_override', 'player_profile', 'local', 'player'].includes(
    ruleSelection
  )
  const installRule = privateRule
    ? compileInstallRuleForAi(
        payload?.installRule || candidate?.installRule || context?.install?.installRule || {}
      )
    : compileInstallRuleForAi(
        (
          await (payload?.getSharedRule || fetchSharedRule)({
            sourcePlatform: 'ficsit',
            sourceGameId: String(appId),
            domainName: 'satisfactory',
            appId
          })
        ).ruleJson
      )
  const candidateLogoFields = buildLogoFields(candidate)
  const request = {
    appId,
    gameId,
    executableFile: pickFirstText(context?.game?.executableFile, context?.game?.clientExePath),
    modId: toSafeNumber(candidate?.modId, 0),
    modReference,
    name: pickFirstText(candidate?.name, modReference),
    version: resolveFicsitVersion(candidate),
    downloadUrl,
    logo: candidateLogoFields.logo || ''
  }
  const planResult = await preparePlan(request)
  const installPlan = enrichFicsitInstallPlanEntries(planResult?.installPlan, {
    ...candidate,
    downloadUrl,
    ...candidateLogoFields
  })
  if (!planResult?.success || !installPlan.length) {
    return {
      success: false,
      payload: null,
      reason: toSafeText(planResult?.message || 'ficsit_plan_unavailable')
    }
  }

  const sourceGameId = String(appId || gameId).trim()
  return {
    success: true,
    payload: {
      source: 'ficsit',
      sourceAdapter: 'ficsit',
      sourceGameId,
      gameKey: `ficsit:${sourceGameId}`,
      gameRoot: toSafeText(context?.game?.installRoot),
      title: `${pickFirstText(candidate?.name, modReference)} 安装任务`,
      items: buildFicsitDownloadBatchEntries(installPlan, context, {
        appId,
        gameId,
        installRule,
        ruleSelection
      }),
      metadata: {
        requestModReference: modReference,
        gameId,
        appId
      },
      options: {
        autoStart: true
      }
    },
    planResult: {
      ...planResult,
      installPlan
    }
  }
}
