// Nexus 安装参数与任务条目构建。
import {
  isPlainObject,
  toSafeText,
  toSafeNumber,
  toPlainJson,
  pickFirstText,
  normalizeTextKey
} from '../values.js'
import { buildLogoFields } from '../images.js'
import { resolveNexusVersion } from '../fileMetadata.js'
import { buildNexusDefaultDependencyReference } from './nexusDependencyDetails.js'

export function buildNexusSourceInstallPayload(planItem = {}, context = {}, options = {}) {
  const domainName = toSafeText(options?.domainName)
  const dependencyRole = toSafeText(options?.dependencyRole || planItem?.dependencyRole)
  const isDefaultDependency =
    options?.isDefaultDependency === true ||
    dependencyRole === 'default_dependency' ||
    toSafeText(planItem?.category) === 'default_dependency'
  const rawModId = pickFirstText(planItem?.modId, planItem?.sourceModId, planItem?.id)
  const rawFileId = pickFirstText(planItem?.fileId, planItem?.sourceFileId, planItem?.id)
  const modId = isDefaultDependency ? rawModId : toSafeNumber(rawModId, 0)
  const fileId = isDefaultDependency ? rawFileId : toSafeNumber(rawFileId, 0)
  const sortIndex = toSafeNumber(options?.sortIndex, 0)
  const profileName = toSafeText(options?.profileName)
  const version = resolveNexusVersion(planItem)
  const logoFields = buildLogoFields(planItem)
  const sourceModKey = pickFirstText(
    options?.sourceModKey,
    planItem?.sourceModKey,
    isDefaultDependency
      ? `dependency:${normalizeTextKey(pickFirstText(planItem?.dependencyId, planItem?.name, modId))}`
      : `nexus:${modId}:${fileId}`
  )
  const installRule = isDefaultDependency
    ? isPlainObject(options?.dependencyInstallRule)
      ? options.dependencyInstallRule
      : isPlainObject(planItem?.installRule)
        ? planItem.installRule
        : isPlainObject(planItem?.install)
          ? planItem.install
          : {}
    : options?.installRule && typeof options.installRule === 'object'
      ? options.installRule
      : {}
  const metadataCategory = isDefaultDependency
    ? 'default_dependency'
    : toSafeText(planItem?.category)
  return toPlainJson(
    {
      source: 'nexus',
      sourceType: 'nexus',
      sourcePlatform: 'nexus',
      sourceAdapter: 'nexus',
      appid: toSafeNumber(options?.appId, 0),
      appId: toSafeNumber(options?.appId, 0),
      gameId: toSafeNumber(options?.gameId, 0),
      nexusGameId: toSafeNumber(options?.nexusGameId, 0),
      gameName: pickFirstText(context?.game?.name, options?.gameName, 'Nexus 游戏'),
      gameRoot: toSafeText(options?.gameRoot),
      gameRootPath: toSafeText(options?.gameRoot),
      clientRootPath: toSafeText(options?.gameRoot),
      clientInstallPath: '.',
      serverInstallPath: '',
      modId,
      id: fileId,
      fileId,
      modName: pickFirstText(planItem?.modName, planItem?.name, `nexus-${modId}`),
      name: pickFirstText(planItem?.fileName, planItem?.name, `Nexus 文件-${fileId}`),
      description: toSafeText(planItem?.description || planItem?.summary),
      summary: toSafeText(planItem?.summary || planItem?.description),
      version,
      fileSize: toSafeNumber(planItem?.fileSize, 0),
      installType: 0,
      taskType: 0,
      usageType: 1,
      typeId: isDefaultDependency ? 1 : 0,
      ...logoFields,
      downloadUrl: toSafeText(planItem?.downloadUrl),
      gameSourceId: String(options?.nexusGameId || '').trim(),
      gameSourceSlug: domainName,
      sourceId: String(modId),
      sourceSlug: domainName,
      sourceGameDomain: domainName,
      sourceModKey,
      priorityOrder: sortIndex,
      profileId: toSafeText(options?.profileId),
      ruleProfileId: toSafeNumber(options?.ruleProfileId, 0) || null,
      profileName,
      targetProfileName: profileName,
      configProfileId: toSafeText(options?.configProfileId),
      installConfigProfileId: toSafeText(options?.installConfigProfileId),
      ruleVersion: toSafeNumber(options?.ruleVersion, 0) || null,
      cleanupSourceArchiveAfterInstall: planItem?.cleanupSourceArchiveAfterInstall !== false,
      fileMd5: toSafeText(planItem?.fileMd5),
      modVersion: version,
      dependencies: Array.isArray(planItem?.dependencies) ? planItem.dependencies : [],
      nexusInstallRule: installRule,
      metadata: {
        category: metadataCategory,
        dependencyRole: isDefaultDependency ? 'default_dependency' : dependencyRole,
        isDefaultDependency,
        dependencyId: toSafeText(planItem?.dependencyId),
        dependencySource: toSafeText(planItem?.dependencySource),
        fileId,
        sortIndex,
        profileName,
        version,
        ...logoFields
      }
    },
    {}
  )
}

export function buildNexusSourceInstallTaskEntry(planItem = {}, context = {}, options = {}) {
  const dependencyRole = toSafeText(options?.dependencyRole || planItem?.dependencyRole)
  const isDefaultDependency =
    options?.isDefaultDependency === true ||
    dependencyRole === 'default_dependency' ||
    toSafeText(planItem?.category) === 'default_dependency'
  const rawModId = pickFirstText(planItem?.modId, planItem?.sourceModId, planItem?.id)
  const rawFileId = pickFirstText(planItem?.fileId, planItem?.sourceFileId, planItem?.id)
  const modId = isDefaultDependency ? rawModId : toSafeNumber(rawModId, 0)
  const fileId = isDefaultDependency ? rawFileId : toSafeNumber(rawFileId, 0)
  const installPayload = buildNexusSourceInstallPayload(planItem, context, options)
  const sourceGameId = String(options?.nexusGameId || '').trim()
  const version = resolveNexusVersion(planItem)
  const logoFields = buildLogoFields(planItem)
  const sourceModKey = pickFirstText(
    options?.sourceModKey,
    planItem?.sourceModKey,
    installPayload?.sourceModKey,
    `nexus:${modId}:${fileId}`
  )
  const displayName = pickFirstText(planItem?.fileName, planItem?.name, `Nexus 文件-${fileId}`)
  const dependencyRef = isPlainObject(options?.dependencyRef)
    ? options.dependencyRef
    : isDefaultDependency
      ? buildNexusDefaultDependencyReference({
          ...planItem,
          sourceModKey,
          modId,
          fileId,
          version
        })
      : null
  return {
    item: {
      task_name: isDefaultDependency
        ? `默认依赖下载:${pickFirstText(planItem?.modName, planItem?.name, `dependency-${modId}`)}`
        : dependencyRole === 'nexus_requirement'
          ? `Nexus依赖下载:${pickFirstText(planItem?.modName, planItem?.name, `nexus-${modId}`)} - ${displayName}`
          : `Nexus模组下载:${pickFirstText(planItem?.modName, planItem?.name, `nexus-${modId}`)} - ${displayName}`,
      module: '游戏',
      file_type: 'zip',
      download_url: toSafeText(planItem?.downloadUrl),
      file_size: toSafeNumber(planItem?.fileSize, 0),
      saveType: 2,
      sourcePlatform: 'nexus',
      sourceType: 'nexus',
      gameId: toSafeNumber(options?.gameId, 0),
      sourceGameId,
      sourceModId: String(modId),
      sourceModKey,
      sourceFileId: String(fileId),
      dedupeKey: isDefaultDependency
        ? ['nexus', sourceGameId, sourceModKey].filter(Boolean).join(':')
        : ['nexus', sourceGameId, String(modId), String(fileId)].filter(Boolean).join(':'),
      version,
      ...logoFields,
      gameRootPath: toSafeText(options?.gameRoot),
      fun: {
        type: 0
      }
    },
    meta: {
      sourcePlatform: 'nexus',
      sourceType: 'nexus',
      displayName,
      version,
      sortIndex: toSafeNumber(options?.sortIndex, 0),
      dependencyRef,
      ...logoFields,
      installPayload
    }
  }
}
