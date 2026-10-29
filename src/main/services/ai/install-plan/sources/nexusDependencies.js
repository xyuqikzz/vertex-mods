// Nexus 默认依赖与需求依赖的计划解析。
import { isPlainObject, toSafeText, pickFirstText, toSafeNumber } from '../values.js'
import { collectInstallRuleDefaultDependencies } from '../rules.js'
import {
  normalizeNexusDefaultDependencyItem,
  buildNexusDefaultDependencySummary,
  buildNexusDefaultDependencyReference
} from './nexusDependencyDetails.js'
import { buildNexusSourceInstallTaskEntry } from './nexusPayload.js'
import { resolveNexusVersion } from '../fileMetadata.js'
import { buildNexusManualDownloadPreviewItem } from '../../../../../shared/sources/nexus-download-link.js'

export function resolveNexusDefaultDependencyPlan(context = {}, options = {}) {
  const dependencies = collectInstallRuleDefaultDependencies(options?.installRule)
  const taskEntries = []
  const missingDependencies = []
  const ruleDefaultDependencies = []

  dependencies.forEach((dependency, index) => {
    const planItem = normalizeNexusDefaultDependencyItem(dependency, index, options)
    const missingFields = []
    if (!toSafeText(planItem.downloadUrl)) missingFields.push('downloadUrl')
    if (!isPlainObject(planItem.installRule) || !Object.keys(planItem.installRule).length) {
      missingFields.push('installRule')
    }

    const summary = buildNexusDefaultDependencySummary(planItem, missingFields)
    ruleDefaultDependencies.push(summary)
    if (missingFields.length) {
      missingDependencies.push(summary)
      return
    }

    taskEntries.push(
      buildNexusSourceInstallTaskEntry(planItem, context, {
        ...options,
        sortIndex: taskEntries.length,
        isDefaultDependency: true,
        dependencyRole: 'default_dependency',
        dependencyRef: buildNexusDefaultDependencyReference(planItem),
        dependencyInstallRule: planItem.installRule,
        sourceModKey: planItem.sourceModKey
      })
    )
  })

  return {
    dependencyCount: dependencies.length,
    taskEntries,
    missingDependencies,
    ruleDefaultDependencies
  }
}

function buildNexusRequirementSourceModKey(dependency = {}) {
  const domainName = pickFirstText(dependency.domainName, dependency.gameDomainName)
  const modId = pickFirstText(dependency.modId, dependency.sourceModId, dependency.id)
  const fileId = pickFirstText(dependency.fileId, dependency.sourceFileId)
  return ['nexus', domainName, modId, fileId].filter(Boolean).join(':')
}

function buildNexusRequirementDependencyReference(dependency = {}) {
  return {
    source: 'nexus',
    sourceType: 'nexus',
    sourcePlatform: 'nexus',
    sourceModKey: buildNexusRequirementSourceModKey(dependency),
    dependencyRole: 'nexus_requirement',
    isDefaultDependency: false,
    required: dependency.optional !== true,
    blocking: dependency.optional !== true,
    name: pickFirstText(dependency.name, dependency.modName, dependency.modId, 'Nexus 依赖'),
    modId: pickFirstText(dependency.modId, dependency.sourceModId),
    fileId: pickFirstText(dependency.fileId, dependency.sourceFileId),
    domainName: pickFirstText(dependency.domainName, dependency.gameDomainName),
    version: resolveNexusVersion(dependency)
  }
}

function buildNexusRequirementDependencySummary(dependency = {}, missingFields = []) {
  return {
    source: 'nexus',
    sourceType: toSafeText(dependency.sourceType, 'nexus'),
    sourcePlatform: 'nexus',
    sourceModKey: buildNexusRequirementSourceModKey(dependency),
    dependencyRole: 'nexus_requirement',
    isDefaultDependency: false,
    required: dependency.optional !== true,
    blocking: dependency.optional !== true,
    name: pickFirstText(dependency.name, dependency.modName, dependency.modId, 'Nexus 依赖'),
    modId: pickFirstText(dependency.modId, dependency.sourceModId),
    fileId: pickFirstText(dependency.fileId, dependency.sourceFileId),
    domainName: pickFirstText(dependency.domainName, dependency.gameDomainName),
    version: resolveNexusVersion(dependency),
    installState: missingFields.length ? 'missing' : toSafeText(dependency.installState, 'pending'),
    missingFields,
    reason: missingFields.length ? `Nexus 依赖缺少${missingFields.join('、')}` : '',
    url: toSafeText(dependency.url),
    notes: toSafeText(dependency.notes)
  }
}

function buildNexusRequirementManualDownloadItem(dependency = {}, context = {}, options = {}) {
  const domainName = pickFirstText(
    dependency.domainName,
    dependency.gameDomainName,
    options?.domainName,
    context?.game?.domainName,
    context?.game?.sourceSlug,
    context?.route?.params?.id
  )
  const modId = toSafeNumber(pickFirstText(dependency.modId, dependency.sourceModId), 0)
  const fileId = toSafeNumber(pickFirstText(dependency.fileId, dependency.sourceFileId), 0)
  const name = pickFirstText(dependency.name, dependency.modName, `Nexus 依赖-${modId}`)
  const version = resolveNexusVersion(dependency)
  const fileName = pickFirstText(
    dependency.fileName,
    dependency.file_name,
    name,
    `Nexus 文件-${fileId}`
  )
  const fileSize = toSafeNumber(dependency.fileSize || dependency.file_size, 0)
  const sourceModKey = buildNexusRequirementSourceModKey({
    ...dependency,
    domainName,
    modId,
    fileId
  })

  return buildNexusManualDownloadPreviewItem({
    item: {
      ...dependency,
      source: 'nexus',
      sourceType: 'nexus',
      sourcePlatform: 'nexus',
      sourceModId: String(modId),
      sourceFileId: String(fileId),
      sourceGameSlug: domainName,
      sourceModKey,
      name,
      version,
      manualDownload: true,
      metadata: {
        ...(isPlainObject(dependency.metadata) ? dependency.metadata : {}),
        category: 'nexus_requirement',
        dependencyRole: 'nexus_requirement',
        dependencyRef: buildNexusRequirementDependencyReference({
          ...dependency,
          domainName,
          modId,
          fileId
        }),
        domainName,
        gameDomain: domainName,
        modId,
        fileId,
        fileName,
        fileSize,
        manualDownload: true,
        manualDownloadStatus: 'manual_pending'
      }
    },
    modInfo: {
      ...dependency,
      name,
      modId,
      domainName
    },
    targetFile: {
      name: fileName,
      version,
      fileSize
    },
    domainName,
    modId,
    fileId
  })
}

export function resolveNexusRequirementDependencyPlan(context = {}, options = {}) {
  const dependencyResult =
    options?.nexusDependencyResult && typeof options.nexusDependencyResult === 'object'
      ? options.nexusDependencyResult
      : null
  const dependencies = Array.isArray(dependencyResult?.dependencies)
    ? dependencyResult.dependencies
    : []
  const dlcRequirements = Array.isArray(dependencyResult?.dlcRequirements)
    ? dependencyResult.dlcRequirements
    : []
  const taskEntries = []
  const missingDependencies = []
  const requirementDependencies = []
  const externalDependencies = []
  const reusedInstalledDependencies = []
  const manualDownloadItems = []
  let sortIndex = toSafeNumber(options?.sortIndex, 0)

  dependencies.forEach((dependency) => {
    const sourceType = toSafeText(dependency?.sourceType, 'nexus').toLowerCase()
    const installState = toSafeText(dependency?.installState, 'pending')

    if (sourceType === 'external') {
      const summary = buildNexusRequirementDependencySummary(dependency, ['externalRequirement'])
      externalDependencies.push(summary)
      missingDependencies.push(summary)
      requirementDependencies.push(summary)
      return
    }

    if (installState === 'reused_installed') {
      const summary = buildNexusRequirementDependencySummary(dependency)
      reusedInstalledDependencies.push(summary)
      requirementDependencies.push(summary)
      return
    }

    const modId = toSafeNumber(pickFirstText(dependency?.modId, dependency?.sourceModId), 0)
    const fileId = toSafeNumber(pickFirstText(dependency?.fileId, dependency?.sourceFileId), 0)
    const domainName = pickFirstText(
      dependency?.domainName,
      dependency?.gameDomainName,
      options?.domainName
    )
    const downloadUrl = toSafeText(dependency?.downloadUrl || dependency?.download_url)
    const missingFields = []
    if (!modId) missingFields.push('sourceModId')
    if (!fileId) missingFields.push('downloadFile')
    if (!downloadUrl) missingFields.push('downloadUrl')

    if (missingFields.length) {
      if (missingFields.length === 1 && missingFields[0] === 'downloadUrl' && modId && fileId) {
        const planItem = {
          ...dependency,
          domainName,
          modId,
          fileId,
          category: 'nexus_requirement',
          dependencyRole: 'nexus_requirement',
          sourceModKey: buildNexusRequirementSourceModKey({
            ...dependency,
            domainName,
            modId,
            fileId
          }),
          downloadUrl: '',
          manualDownload: true
        }
        const summary = {
          ...buildNexusRequirementDependencySummary(planItem),
          installState: 'manual_pending',
          manualDownload: true,
          reason: '需要在 Nexus 网页手动授权下载'
        }
        requirementDependencies.push(summary)
        manualDownloadItems.push(
          buildNexusRequirementManualDownloadItem(planItem, context, options)
        )
        taskEntries.push(
          buildNexusSourceInstallTaskEntry(planItem, context, {
            ...options,
            sortIndex,
            dependencyRole: 'nexus_requirement',
            dependencyRef: buildNexusRequirementDependencyReference(planItem),
            sourceModKey: planItem.sourceModKey
          })
        )
        sortIndex += 1
        return
      }

      const summary = buildNexusRequirementDependencySummary(dependency, missingFields)
      requirementDependencies.push(summary)
      missingDependencies.push(summary)
      return
    }

    const summary = buildNexusRequirementDependencySummary(dependency)
    requirementDependencies.push(summary)
    const planItem = {
      ...dependency,
      domainName,
      modId,
      fileId,
      category: 'nexus_requirement',
      dependencyRole: 'nexus_requirement',
      sourceModKey: buildNexusRequirementSourceModKey({
        ...dependency,
        domainName,
        modId,
        fileId
      }),
      downloadUrl
    }
    taskEntries.push(
      buildNexusSourceInstallTaskEntry(planItem, context, {
        ...options,
        sortIndex,
        dependencyRole: 'nexus_requirement',
        dependencyRef: buildNexusRequirementDependencyReference(planItem),
        sourceModKey: planItem.sourceModKey
      })
    )
    sortIndex += 1
  })

  return {
    dependencyCount: dependencies.length + dlcRequirements.length,
    taskEntries,
    missingDependencies,
    requirementDependencies,
    externalDependencies,
    reusedInstalledDependencies,
    dlcRequirements,
    manualDownloadItems
  }
}
