// Mod.io 安装参数与来源任务准备。
import { toSafeNumber, pickFirstText, toSafeText, toPlainJson, parseJsonObject } from '../values.js'
import { buildLogoFields } from '../images.js'
import { resolveModioVersion } from '../fileMetadata.js'
import { fetchSharedRule } from '../../../../ipc/game/sharedRuleClient.js'

function resolveModioSourceGameId(candidate = {}, context = {}) {
  return toSafeNumber(
    pickFirstText(
      candidate?.gameId,
      candidate?.modioGameId,
      context?.game?.sourceGameId,
      context?.route?.query?.sourceGameId,
      context?.route?.query?.modioGameId,
      context?.game?.id,
      context?.route?.params?.id
    ),
    0
  )
}

function resolveModioAppId(candidate = {}, context = {}, binding = null) {
  return toSafeNumber(
    pickFirstText(
      binding?.appId,
      context?.game?.appId,
      context?.route?.query?.appId,
      context?.route?.query?.appid,
      candidate?.appId,
      candidate?.appid,
      resolveModioSourceGameId(candidate, context)
    ),
    0
  )
}

function resolveModioNameId(candidate = {}, context = {}, binding = null) {
  return pickFirstText(
    binding?.nameId,
    candidate?.sourceSlug,
    candidate?.sourceGameSlug,
    candidate?.domainName,
    context?.game?.sourceSlug,
    context?.game?.nameId,
    context?.route?.query?.nameId
  )
}

function resolveModioGameRoot(context = {}, binding = null) {
  return pickFirstText(
    context?.game?.installRoot,
    binding?.detectedRootPath,
    context?.route?.query?.clientRootPath
  )
}

function normalizeModioPlatformList(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim()
      }

      return pickFirstText(item?.platform, item?.name, item?.os)
    })
    .filter(Boolean)
}

function normalizeModioDependencyReferences(list = []) {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const source = item && typeof item === 'object' ? item : {}
    const modId = pickFirstText(source.modId, source.mod_id, source.id)
    if (!modId) {
      continue
    }
    const fileId = pickFirstText(source.fileId, source.file_id)
    const key = `${modId}:${fileId}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push({
      source: 'modio',
      sourceType: 'modio',
      dependencyRole: toSafeText(source.dependencyRole || 'modio_dependency'),
      modId,
      fileId,
      name: pickFirstText(source.name, source.modName, modId),
      version: toSafeText(source.version),
      sourceModKey: fileId ? `modio:${modId}:${fileId}` : `modio:${modId}`
    })
  }
  return result
}

function buildModioSourceMeta(planItem = {}, options = {}) {
  const modioGameId = toSafeNumber(options?.modioGameId, 0)
  const logoFields = buildLogoFields(planItem)
  return {
    source: 'modio',
    sourceId: modioGameId,
    sourceSlug: toSafeText(options?.nameId),
    appId: toSafeNumber(options?.appId, 0),
    modioGameId,
    ruleVersion: toSafeNumber(options?.ruleVersion, 0) || null,
    modName: pickFirstText(planItem?.name, planItem?.modName),
    fileName: pickFirstText(planItem?.fileName, planItem?.name),
    profileName: toSafeText(options?.profileName),
    version: resolveModioVersion(planItem),
    ...logoFields
  }
}

function buildModioSourceInstallPayload(planItem = {}, context = {}, options = {}) {
  const modioGameId = toSafeNumber(options?.modioGameId, 0)
  const appId = toSafeNumber(options?.appId || modioGameId, 0)
  const gameId = toSafeNumber(options?.gameId, 0)
  const modId = toSafeNumber(planItem?.modId || planItem?.id, 0)
  const fileId = toSafeNumber(planItem?.fileId, 0)
  const version = resolveModioVersion(planItem)
  const modName = pickFirstText(planItem?.name, planItem?.modName, `modio-${modId}`)
  const profileName = toSafeText(options?.profileName || 'Mod.io')
  const sortIndex = toSafeNumber(options?.sortIndex, 0)
  const logoFields = buildLogoFields(planItem)
  const installRule =
    options?.installRule && typeof options.installRule === 'object' ? options.installRule : {}
  const sourceMeta = buildModioSourceMeta(planItem, {
    modioGameId,
    appId,
    nameId: options?.nameId,
    ruleVersion: options?.ruleVersion,
    profileName
  })
  const dependencyRole = toSafeText(planItem?.dependencyRole)
  const dependencies = normalizeModioDependencyReferences(planItem?.dependencies)
  const platforms = normalizeModioPlatformList(planItem?.platforms)
  const sourceSlug = toSafeText(options?.nameId)
  const gameRoot = toSafeText(options?.gameRoot)

  return toPlainJson(
    {
      source: 'modio',
      sourceType: 'modio',
      sourcePlatform: 'modio',
      sourceAdapter: 'modio',
      sourceGameId: modioGameId,
      modioGameId,
      appid: appId,
      appId,
      gameId,
      gameName: pickFirstText(context?.game?.name, options?.gameName, '当前游戏'),
      gameRoot,
      clientInstallPath: '.',
      serverInstallPath: '',
      modId,
      fileId,
      id: fileId,
      modName,
      name: pickFirstText(planItem?.fileName, modName),
      packageFolderName: modName || `modio-${modId}`,
      version,
      fileSize: toSafeNumber(planItem?.fileSize, 0),
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: 0,
      ...logoFields,
      downloadUrl: toSafeText(planItem?.downloadUrl),
      gameSourceId: String(modioGameId),
      gameSourceSlug: sourceSlug,
      sourceGameSlug: sourceSlug,
      sourceId: String(modId),
      sourceSlug,
      sourceGameDomain: sourceSlug,
      sourceModKey: `modio:${modId}:${fileId}`,
      priorityOrder: sortIndex,
      profileName,
      targetProfileName: profileName,
      cleanupSourceArchiveAfterInstall: true,
      fileMd5: toSafeText(planItem?.fileMd5),
      modVersion: version,
      dependencyRole,
      dependencies,
      installRule,
      modioInstallRule: installRule,
      sourceInstallRule: installRule,
      sourceMeta,
      metadata: {
        category: 'modio',
        source: 'modio',
        sourceMeta,
        fileId,
        platforms,
        profileUrl: toSafeText(planItem?.profileUrl),
        sourcePageUrl: toSafeText(planItem?.sourcePageUrl || planItem?.profileUrl),
        dependencyRole,
        sortIndex,
        profileName,
        version,
        ...logoFields
      }
    },
    {}
  )
}

function buildModioDownloadEntry(planItem = {}, context = {}, options = {}) {
  const installPayload = buildModioSourceInstallPayload(planItem, context, options)
  const modioGameId = toSafeNumber(options?.modioGameId, 0)
  const modId = toSafeNumber(planItem?.modId || planItem?.id, 0)
  const fileId = toSafeNumber(planItem?.fileId, 0)
  const version = resolveModioVersion(planItem)
  const modName = pickFirstText(planItem?.name, planItem?.modName, `modio-${modId}`)
  const logoFields = buildLogoFields(planItem)
  return {
    item: {
      task_name: `Modio模组下载:${modName}${version ? `@${version}` : ''}`,
      module: '游戏',
      file_type: 'zip',
      download_url: toSafeText(planItem?.downloadUrl),
      file_size: toSafeNumber(planItem?.fileSize, 0),
      saveType: 2,
      sourcePlatform: 'modio',
      sourceType: 'modio',
      gameId: modioGameId,
      sourceGameId: modioGameId,
      sourceModId: modId,
      sourceFileId: fileId,
      dedupeKey: ['modio', String(modioGameId), String(modId), String(fileId)].join(':'),
      version,
      ...logoFields,
      showOpenInDownloadList: true,
      fun: {
        type: 0
      }
    },
    meta: {
      sourceType: 'modio',
      sourcePlatform: 'modio',
      displayName: modName,
      fileName: pickFirstText(planItem?.fileName, modName),
      version,
      ...logoFields,
      gameId: modioGameId,
      modId,
      fileId,
      filehash: toSafeText(planItem?.fileMd5),
      platforms: normalizeModioPlatformList(planItem?.platforms),
      profileUrl: toSafeText(planItem?.profileUrl),
      sourcePageUrl: toSafeText(planItem?.sourcePageUrl || planItem?.profileUrl),
      sortIndex: toSafeNumber(options?.sortIndex, 0),
      installPayload
    }
  }
}

export async function resolveModioSourceTask(payload, candidate, context) {
  const modioGameId = resolveModioSourceGameId(candidate, context)
  const appId = resolveModioAppId(candidate, context)
  const nameId = resolveModioNameId(candidate, context)
  const modId = toSafeNumber(candidate?.modId || candidate?.id, 0)
  const fileId = toSafeNumber(candidate?.fileId, 0)
  const downloadUrl = toSafeText(candidate?.downloadUrl)

  const runtimeMissingFields = []
  if (!modioGameId) runtimeMissingFields.push('sourceGameId')
  if (!modId) runtimeMissingFields.push('sourceModId')
  if (!fileId) runtimeMissingFields.push('downloadFile')
  if (!downloadUrl) runtimeMissingFields.push('downloadUrl')

  if (runtimeMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_modio_runtime_context',
      missingFields: runtimeMissingFields
    }
  }

  let getModioLatestRule = payload?.getModioLatestRule
  if (typeof getModioLatestRule !== 'function') {
    getModioLatestRule = (id) =>
      fetchSharedRule({
        sourcePlatform: 'modio',
        sourceGameId: String(id),
        domainName: nameId,
        appId
      })
  }

  let getModioBinding = payload?.getModioBinding
  if (typeof getModioBinding !== 'function') {
    const modioBindingModule = await import('../../../../db/sources/modio/modioBinding.js')
    getModioBinding = modioBindingModule.getModioGameBinding
  }

  const cachedRule = await getModioLatestRule(modioGameId)
  const ruleJson = parseJsonObject(cachedRule?.ruleJson, {})
  const binding =
    getModioBinding({
      modioGameId,
      nameId,
      appId: appId || modioGameId
    }) ||
    getModioBinding({
      modioGameId,
      appId: appId || modioGameId
    }) ||
    null
  const resolvedAppId = resolveModioAppId(candidate, context, binding)
  const gameRoot = resolveModioGameRoot(context, binding)
  const backendGameId = toSafeNumber(cachedRule?.gameId, 0)

  const installMissingFields = []
  if (!resolvedAppId) installMissingFields.push('appId')
  if (!gameRoot) installMissingFields.push('gameRoot')
  if (!Object.keys(ruleJson).length) installMissingFields.push('installRule')

  if (installMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_modio_install_context',
      missingFields: installMissingFields
    }
  }

  const sourceGameId = String(modioGameId).trim()
  const installPayload = buildModioSourceInstallPayload(candidate, context, {
    modioGameId,
    appId: resolvedAppId,
    gameId: backendGameId,
    gameName: pickFirstText(context?.game?.name, binding?.gameName),
    gameRoot,
    nameId,
    installRule: ruleJson,
    ruleVersion: toSafeNumber(cachedRule?.ruleVersion, 0),
    profileName: 'Mod.io',
    sortIndex: 0
  })

  return {
    success: true,
    payload: {
      source: 'modio',
      sourceAdapter: 'modio',
      sourceGameId,
      gameKey: `modio:${sourceGameId}`,
      gameRoot,
      title: `${pickFirstText(candidate?.name, `modio-${modId}`)} 安装任务`,
      items: [
        buildModioDownloadEntry(candidate, context, {
          modioGameId,
          appId: resolvedAppId,
          gameId: backendGameId,
          gameName: pickFirstText(context?.game?.name, binding?.gameName),
          gameRoot,
          nameId,
          installRule: ruleJson,
          ruleVersion: toSafeNumber(cachedRule?.ruleVersion, 0),
          profileName: 'Mod.io',
          sortIndex: 0
        })
      ],
      metadata: {
        requestModId: modId,
        fileId,
        gameId: backendGameId,
        appId: resolvedAppId
      },
      options: {
        autoStart: true
      }
    },
    rule: cachedRule,
    binding,
    installPayload
  }
}
