// Thunderstore 安装参数与来源任务准备。
import { pickFirstText, toSafeText, toSafeNumber, toPlainJson } from '../values.js'
import { buildLogoFields } from '../images.js'
import { resolveThunderstoreDownloadUrl, resolveThunderstoreVersion } from '../fileMetadata.js'

function resolveThunderstoreCommunity(candidate = {}, context = {}) {
  return pickFirstText(
    candidate?.community,
    candidate?.sourceGameId,
    context?.game?.sourceGameId,
    context?.game?.sourceSlug,
    context?.route?.query?.community,
    context?.route?.params?.id
  )
}

function normalizeThunderstoreFullName(value = '') {
  return toSafeText(value).toLowerCase()
}

function parseThunderstoreDependencyReference(value = {}) {
  if (typeof value === 'string') {
    const raw = toSafeText(value)
    const match = raw.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
    return {
      fullName: match ? toSafeText(match[1]) : raw,
      requiredVersion: match ? toSafeText(match[2]) : '',
      name: match ? toSafeText(match[1]) : raw
    }
  }

  const source = value && typeof value === 'object' ? value : {}
  const sourceModKey = pickFirstText(source?.sourceModKey, source?.source_mod_key)
  const sourceModKeyParts = sourceModKey.split(':')
  const fullNameFromKey =
    sourceModKeyParts[0] === 'thunderstore' && sourceModKeyParts.length >= 3
      ? sourceModKeyParts.slice(2).join(':')
      : ''

  return {
    fullName: pickFirstText(
      source?.fullName,
      source?.packageFullName,
      source?.full_name,
      source?.package_full_name,
      fullNameFromKey,
      source?.id,
      source?.modId
    ),
    requiredVersion: pickFirstText(
      source?.requiredVersion,
      source?.required_version,
      source?.version,
      source?.version_number
    ),
    name: pickFirstText(
      source?.name,
      source?.displayName,
      source?.fullName,
      source?.packageFullName
    )
  }
}

function normalizeThunderstoreDependencyReferences(list = [], community = '') {
  const result = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const dependency = parseThunderstoreDependencyReference(item)
    const fullName = toSafeText(dependency.fullName)
    if (!fullName) {
      continue
    }
    const key = `${normalizeThunderstoreFullName(fullName)}@${toSafeText(
      dependency.requiredVersion
    ).toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const sourceModKey = ['thunderstore', community, fullName].filter(Boolean).join(':')
    result.push({
      source: 'thunderstore',
      sourceType: 'thunderstore',
      sourcePlatform: 'thunderstore',
      sourceModKey,
      dependencyRole: 'thunderstore_dependency',
      packageFullName: fullName,
      fullName,
      name: pickFirstText(dependency.name, fullName),
      version: toSafeText(dependency.requiredVersion),
      requiredVersion: toSafeText(dependency.requiredVersion),
      optional: false
    })
  }
  return result
}

function buildThunderstoreSourceInstallPayload(planItem = {}, context = {}, options = {}) {
  const community = toSafeText(options?.community)
  const fullName = pickFirstText(
    planItem?.fullName,
    planItem?.packageFullName,
    planItem?.modId,
    planItem?.id
  )
  const version = resolveThunderstoreVersion(planItem)
  const profileName = toSafeText(options?.profileName || 'default')
  const logoFields = buildLogoFields(planItem)
  const dependencyRole = toSafeText(options?.dependencyRole || planItem?.dependencyRole)
  const isDependency = options?.isDependency === true || !!dependencyRole
  const dependencies = normalizeThunderstoreDependencyReferences(planItem?.dependencies, community)
  return toPlainJson(
    {
      source: 'thunderstore',
      sourceType: 'thunderstore',
      sourcePlatform: 'thunderstore',
      sourceAdapter: 'thunderstore',
      sourceGameId: community,
      community,
      appId: toSafeNumber(options?.appId, 0),
      gameId: toSafeNumber(options?.appId, 0),
      gameRoot: pickFirstText(
        options?.gameRoot,
        options?.gameExePath,
        context?.game?.executableFile,
        context?.game?.clientExePath
      ),
      gameExePath: pickFirstText(
        options?.gameExePath,
        context?.game?.executableFile,
        context?.game?.clientExePath
      ),
      packageLoader: toSafeText(options?.packageLoader),
      profileName,
      fullName,
      packageFullName: fullName,
      packageOwner: toSafeText(planItem?.packageOwner || planItem?.namespace),
      packageName: pickFirstText(planItem?.packageName, planItem?.name, fullName),
      displayName: pickFirstText(planItem?.displayName, planItem?.name, fullName),
      modName: pickFirstText(planItem?.displayName, planItem?.name, fullName),
      name: pickFirstText(planItem?.displayName, planItem?.name, fullName),
      version,
      downloadUrl: resolveThunderstoreDownloadUrl(planItem),
      fileSize: toSafeNumber(planItem?.fileSize, 0),
      ...logoFields,
      description: toSafeText(planItem?.description || planItem?.summary),
      packageUrl: pickFirstText(planItem?.packageUrl, planItem?.profileUrl),
      dependencyRole,
      dependencies,
      sourceModKey: ['thunderstore', community, fullName].filter(Boolean).join(':'),
      cleanupSourceArchiveAfterInstall: false,
      metadata: {
        category: isDependency ? 'thunderstore_dependency' : 'thunderstore',
        source: 'thunderstore',
        community,
        profileName,
        version,
        dependencyRole,
        ...logoFields
      }
    },
    {}
  )
}

function buildThunderstoreSourceInstallTaskEntry(planItem = {}, context = {}, options = {}) {
  const fullName = pickFirstText(
    planItem?.fullName,
    planItem?.packageFullName,
    planItem?.modId,
    planItem?.id
  )
  const version = resolveThunderstoreVersion(planItem)
  const installPayload = buildThunderstoreSourceInstallPayload(planItem, context, options)
  const community = toSafeText(options?.community)
  const logoFields = buildLogoFields(planItem)
  const sortIndex = toSafeNumber(options?.sortIndex ?? planItem?.sortIndex, 0)
  const displayName = pickFirstText(planItem?.displayName, planItem?.name, fullName, '未知包')
  const isDependency = options?.isDependency === true || !!toSafeText(options?.dependencyRole)
  const dependencyRef = isDependency
    ? {
        source: 'thunderstore',
        sourceType: 'thunderstore',
        sourceModKey: installPayload.sourceModKey,
        dependencyRole: 'thunderstore_dependency',
        packageFullName: fullName,
        fullName,
        name: displayName,
        version
      }
    : null
  return {
    item: {
      task_name: `Thunderstore模组下载:${displayName}${version ? `@${version}` : ''}`,
      module: '游戏',
      file_type: 'zip',
      download_url: resolveThunderstoreDownloadUrl(planItem),
      file_size: toSafeNumber(planItem?.fileSize, 0),
      saveType: 2,
      sourcePlatform: 'thunderstore',
      sourceType: 'thunderstore',
      sourceGameId: community,
      sourceModId: fullName,
      sourceFileId: version,
      sourceModKey: installPayload.sourceModKey,
      packageFullName: fullName,
      version,
      dedupeKey: ['thunderstore', community, fullName, version].filter(Boolean).join(':'),
      gameExePath: installPayload.gameExePath,
      ...logoFields,
      fun: {
        type: 0
      }
    },
    meta: {
      ...toPlainJson(planItem, {}),
      sourcePlatform: 'thunderstore',
      sourceType: 'thunderstore',
      displayName,
      version,
      sortIndex,
      dependencyRef,
      ...logoFields,
      installPayload
    }
  }
}

async function resolveThunderstoreInstallPlanItems(payload = {}) {
  const candidate = toPlainJson(payload?.candidate, {})
  const fallbackItem = toPlainJson(payload?.fallbackItem || candidate, {})
  let buildPlan = payload?.buildThunderstoreInstallPlan
  if (typeof buildPlan !== 'function') {
    const thunderstoreModule = await import('../../../../ipc/game/thunderstore.js')
    buildPlan = thunderstoreModule.thunderstoreBuildSourceInstallTaskPlan
  }

  if (typeof buildPlan !== 'function') {
    return [fallbackItem]
  }

  try {
    const result = await buildPlan({
      community: payload?.community,
      packageFullName: payload?.fullName,
      versionNumber: payload?.version,
      appId: payload?.appId,
      packageLoader: payload?.packageLoader,
      profileName: payload?.profileName
    })
    const items = Array.isArray(result?.installPlan) ? result.installPlan : []
    return items.length ? items : [fallbackItem]
  } catch {
    return [fallbackItem]
  }
}

export async function resolveThunderstoreSourceTask(payload, candidate, context) {
  const community = resolveThunderstoreCommunity(candidate, context)
  const fullName = pickFirstText(
    candidate?.fullName,
    candidate?.packageFullName,
    candidate?.modId,
    candidate?.id
  )
  const downloadUrl = resolveThunderstoreDownloadUrl(candidate)
  const version = resolveThunderstoreVersion(candidate)

  const runtimeMissingFields = []
  if (!community) runtimeMissingFields.push('sourceGameId')
  if (!fullName) runtimeMissingFields.push('sourceModId')
  if (!downloadUrl) runtimeMissingFields.push('downloadUrl')
  if (!version) runtimeMissingFields.push('version')

  if (runtimeMissingFields.length) {
    return {
      success: false,
      payload: null,
      reason: 'missing_thunderstore_runtime_context',
      missingFields: runtimeMissingFields
    }
  }

  const resolvedCandidate = {
    ...candidate,
    version,
    downloadUrl
  }
  const appId = toSafeNumber(
    pickFirstText(
      context?.game?.appId,
      context?.route?.query?.appId,
      context?.route?.query?.appid,
      candidate?.appId,
      candidate?.gameId
    ),
    0
  )
  const packageLoader = pickFirstText(
    candidate?.packageLoader,
    context?.game?.packageLoader,
    context?.route?.query?.packageLoader,
    context?.route?.query?.loader
  )
  const profileName = pickFirstText(
    candidate?.profileName,
    context?.game?.profileName,
    context?.thunderstore?.profileName,
    context?.search?.filters?.profile,
    context?.route?.query?.profileName,
    'default'
  )
  const gameExePath = pickFirstText(
    context?.game?.executableFile,
    context?.game?.clientExePath,
    context?.thunderstore?.gameExePath,
    context?.thunderstore?.clientExePath
  )
  const planItems = await resolveThunderstoreInstallPlanItems({
    candidate,
    fallbackItem: resolvedCandidate,
    community,
    fullName,
    version,
    appId,
    packageLoader,
    profileName,
    buildThunderstoreInstallPlan: payload?.buildThunderstoreInstallPlan
  })
  const rootItem =
    planItems.find(
      (item) =>
        normalizeThunderstoreFullName(
          pickFirstText(item?.fullName, item?.packageFullName, item?.modId, item?.id)
        ) === normalizeThunderstoreFullName(fullName)
    ) ||
    planItems[planItems.length - 1] ||
    resolvedCandidate
  const installPayload = buildThunderstoreSourceInstallPayload(rootItem, context, {
    community,
    appId,
    packageLoader,
    profileName,
    gameExePath,
    gameRoot: gameExePath
  })
  const taskEntries = planItems.map((planItem, index) => {
    const itemFullName = pickFirstText(
      planItem?.fullName,
      planItem?.packageFullName,
      planItem?.modId,
      planItem?.id
    )
    const isDependency =
      normalizeThunderstoreFullName(itemFullName) !== normalizeThunderstoreFullName(fullName)
    return buildThunderstoreSourceInstallTaskEntry(planItem, context, {
      community,
      appId,
      packageLoader,
      profileName,
      gameExePath,
      gameRoot: gameExePath,
      sortIndex: index,
      isDependency,
      dependencyRole: isDependency ? 'thunderstore_dependency' : ''
    })
  })

  return {
    success: true,
    payload: {
      source: 'thunderstore',
      sourceAdapter: 'thunderstore',
      sourceGameId: community,
      gameKey: `thunderstore:${community}`,
      gameRoot: gameExePath,
      title: `${pickFirstText(rootItem?.displayName, rootItem?.name, fullName)} 安装任务`,
      items: taskEntries,
      sourceMeta: {
        source: 'thunderstore',
        community,
        profileName,
        packageLoader
      },
      metadata: {
        requestModId: fullName,
        community,
        appId,
        packageLoader,
        version,
        dependencyCount: Math.max(taskEntries.length - 1, 0)
      },
      options: {
        autoStart: true,
        includeDependencies: taskEntries.length > 1
      }
    },
    installPayload
  }
}
