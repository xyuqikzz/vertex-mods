import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import {
  extractInstallRuleMatchedRuleId,
  normalizeInstallRuleLaunchAction,
  resolveInstallRulePlanFromMetadata
} from '@renderer/utils/install-rule-plan.js'
import { INSTALL_FLOW_CONFIG } from '../../../../../shared/installation/install-flow-config.js'
import { buildNexusFileIdentity } from '../../../../../shared/sources/nexus-download-link.js'
import {
  getNexusModFiles,
  getNexusModInfo,
  getNexusModRequirements,
  NEXUS_MOD_FILE_CATEGORY_ID
} from '@renderer/utils/nexus-api.js'
import {
  buildGithubReleaseProviderSnapshot,
  resolveGithubReleaseAsset
} from '@renderer/utils/github-release-api.js'
import {
  getNexusDependencyFileSize,
  readProviderAlias,
  resolveNexusDefaultDependencyFile,
  resolveNexusDefaultDependencyProvider,
  validateNexusDefaultDependencyProviderIdentity
} from './nexus-default-dependency-file-resolver.js'
import { resolveInstalledNexusSourcePageUrl } from './installed-source-page-resolver.js'
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'
import { TtlLruCache } from '../../../../../shared/utils/ttl-lru-cache.js'

const nexusModInfoCache = new TtlLruCache({ max: 500, ttl: 10 * 60 * 1000 })
const nexusModInfoRequestCache = new Map()
const NEXUS_SOURCE_LABEL = resolveSourcePlatformLabel('nexus', 'Nexus')

function invokeIpc(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

function createOperationTimeoutError(label = '操作', timeoutMs = 0) {
  const error = new Error(uiText('ui.valueTimedOut', { value1: (label) }))
  error.code = 'OPERATION_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function withOperationTimeout(promise, timeoutMs, label = '操作') {
  const safeTimeoutMs = Number(timeoutMs || 0)
  if (!Number.isFinite(safeTimeoutMs) || safeTimeoutMs <= 0) {
    return promise
  }

  let timer = null
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(createOperationTimeoutError(label, safeTimeoutMs))
    }, safeTimeoutMs)

    Promise.resolve(promise)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      })
  })
}

export const nexusFileCategoryIdLabelMap = Object.freeze({
  get [NEXUS_MOD_FILE_CATEGORY_ID.MAIN]() { return uiText('ui.mainFiles') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.UPDATE]() { return uiText('ui.updateFiles') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.OPTIONAL]() { return uiText('ui.optionalFiles') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION]() { return uiText('ui.olderVersions') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.MISCELLANEOUS]() { return uiText('ui.miscellaneousFiles') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.DELETED]() { return uiText('ui.deleted') },
  get [NEXUS_MOD_FILE_CATEGORY_ID.ARCHIVED]() { return uiText('ui.archivedFiles') }
})

export const nexusFileCategoryNameLabelMap = Object.freeze({
  get MAIN() { return uiText('ui.mainFiles') },
  get UPDATE() { return uiText('ui.updateFiles') },
  get OPTIONAL() { return uiText('ui.optionalFiles') },
  get OLD_VERSION() { return uiText('ui.olderVersions') },
  get MISCELLANEOUS() { return uiText('ui.miscellaneousFiles') },
  get MISC() { return uiText('ui.miscellaneousFiles') },
  get DELETED() { return uiText('ui.deleted') },
  get ARCHIVED() { return uiText('ui.archivedFiles') }
})

export const nexusFileCategoryOrderMap = Object.freeze({
  MAIN: 10,
  UPDATE: 20,
  OPTIONAL: 30,
  MISCELLANEOUS: 40,
  MISC: 40,
  ARCHIVED: 90,
  DELETED: 90,
  OLD_VERSION: 100
})

export const NEXUS_REQUIREMENT_EXCLUDE_REASON = Object.freeze({
  HANDLED_BY_DEFAULT_DEPENDENCY: 'handled_by_default_dependency',
  DEFAULT_DEPENDENCY_ALREADY_INSTALLED: 'default_dependency_already_installed',
  SAME_NEXUS_MOD_ALREADY_INSTALLED: 'same_nexus_mod_already_installed'
})

export const NEXUS_REQUIREMENT_DISPLAY_STATUS = Object.freeze({
  PENDING: 'pending',
  MANUAL: 'manual',
  INSTALLED: 'installed'
})

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeSet(value) {
  if (value instanceof Set) {
    return value
  }
  return new Set(Array.isArray(value) ? value : [])
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  const text = String(value || '').trim()
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  const text = String(value || '').trim()
  if (!text) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeLaunchArgumentList(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()
  return text ? [text] : []
}

function normalizeOptionalBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) {
    return null
  }

  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(text)) {
    return false
  }

  return null
}

function resolveFirstDefinedValue(...valueList) {
  for (const value of valueList) {
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

function normalizeNexusTargetBaseType(value = '', fallback = 'game') {
  const text = String(value || '')
    .trim()
    .toLowerCase()

  if (!text) {
    return fallback
  }

  if (['target', 'target_root', 'targetroot', 'resolved_target', 'resolvedtarget'].includes(text)) {
    return 'target'
  }
  if (['download', 'download_root', 'downloadroot', 'download_relative'].includes(text)) {
    return 'download'
  }
  if (
    [
      'local_appdata',
      'localappdata',
      'local_app_data',
      'local_appdata_root',
      'localappdata_root',
      'user_local_appdata',
      'userlocalappdata',
      '%localappdata%'
    ].includes(text)
  ) {
    return 'local_appdata'
  }

  return 'game'
}

function normalizeWindowsPathLike(value = '') {
  return String(value || '')
    .trim()
    .replace(/\//g, '\\')
}

function trimWindowsPathEdgeSlash(value = '') {
  return normalizeWindowsPathLike(value).replace(/^\\+|\\+$/g, '')
}

function isAbsoluteWindowsPath(value = '') {
  const text = normalizeWindowsPathLike(value)
  return /^[A-Za-z]:\\/.test(text) || text.startsWith('\\\\')
}

function joinWindowsPath(basePath = '', relativePath = '') {
  const safeBasePath = normalizeWindowsPathLike(basePath).replace(/[\\]+$/, '')
  const safeRelativePath = trimWindowsPathEdgeSlash(relativePath)
  if (!safeBasePath) {
    return safeRelativePath
  }
  if (!safeRelativePath) {
    return safeBasePath
  }
  return `${safeBasePath}\\${safeRelativePath}`
}

function getCurrentNexusInstallRuleList(currentNexusRule = null) {
  const ruleJson =
    currentNexusRule?.ruleJson && typeof currentNexusRule.ruleJson === 'object'
      ? currentNexusRule.ruleJson
      : {}
  return Array.isArray(ruleJson?.install_rules)
    ? ruleJson.install_rules
    : Array.isArray(ruleJson?.installRules)
      ? ruleJson.installRules
      : []
}

function findCurrentNexusInstallRule(currentNexusRule = null, ruleId = '') {
  const safeRuleId = String(ruleId || '').trim()
  if (!safeRuleId) {
    return null
  }

  return (
    getCurrentNexusInstallRuleList(currentNexusRule).find((item) => {
      const candidateId = String(item?.id || item?.name || '').trim()
      return candidateId && candidateId === safeRuleId
    }) || null
  )
}

function resolveCurrentRuleLaunchDescriptor(rule = {}, options = {}) {
  const targetRule = rule?.target && typeof rule.target === 'object' ? rule.target : {}
  const launchAction = normalizeNexusLaunchAction(
    resolveFirstDefinedValue(
      targetRule?.launch_action,
      targetRule?.launchAction,
      targetRule?.execute_mode,
      targetRule?.executeMode,
      targetRule?.executable_action,
      targetRule?.executableAction
    ),
    ''
  )
  const rawLaunchTarget = String(
    resolveFirstDefinedValue(
      targetRule?.launch_target,
      targetRule?.launchTarget,
      targetRule?.inject_target,
      targetRule?.injectTarget,
      targetRule?.enable_target,
      targetRule?.enableTarget,
      targetRule?.enable_exe,
      targetRule?.enableExe,
      targetRule?.launch_exe,
      targetRule?.launchExe,
      targetRule?.inject_exe,
      targetRule?.injectExe
    ) || ''
  ).trim()
  const baseType = normalizeNexusTargetBaseType(
    resolveFirstDefinedValue(
      targetRule?.launch_target_base,
      targetRule?.launch_target_base_type,
      targetRule?.launchTargetBase,
      targetRule?.launchTargetBaseType,
      targetRule?.inject_target_base,
      targetRule?.inject_target_base_type,
      targetRule?.injectTargetBase,
      targetRule?.injectTargetBaseType,
      targetRule?.enable_target_base,
      targetRule?.enable_target_base_type,
      targetRule?.enableTargetBase,
      targetRule?.enableTargetBaseType,
      targetRule?.enable_exe_base,
      targetRule?.enable_exe_base_type,
      targetRule?.enableExeBase,
      targetRule?.enableExeBaseType,
      targetRule?.launch_exe_base,
      targetRule?.launch_exe_base_type,
      targetRule?.launchExeBase,
      targetRule?.launchExeBaseType,
      targetRule?.inject_exe_base,
      targetRule?.inject_exe_base_type,
      targetRule?.injectExeBase,
      targetRule?.injectExeBaseType
    ),
    'game'
  )
  const showInjectButton =
    normalizeOptionalBoolean(
      resolveFirstDefinedValue(
        targetRule?.show_inject_button,
        targetRule?.showInjectButton,
        targetRule?.inject_button,
        targetRule?.injectButton
      )
    ) === true
  const launchArgs = normalizeLaunchArgumentList(
    resolveFirstDefinedValue(
      targetRule?.launch_args,
      targetRule?.launchArgs,
      targetRule?.launch_target_args,
      targetRule?.launchTargetArgs,
      targetRule?.inject_target_args,
      targetRule?.injectTargetArgs,
      targetRule?.enable_target_args,
      targetRule?.enableTargetArgs,
      targetRule?.enable_exe_args,
      targetRule?.enableExeArgs,
      targetRule?.launch_exe_args,
      targetRule?.launchExeArgs,
      targetRule?.inject_exe_args,
      targetRule?.injectExeArgs
    )
  )

  let enableExecutablePath = rawLaunchTarget
  if (rawLaunchTarget && !isAbsoluteWindowsPath(rawLaunchTarget)) {
    const gameRootPath = String(options?.gameRootPath || '').trim()
    const targetRootPath = String(options?.targetRootPath || '').trim()
    const baseRoot =
      baseType === 'target'
        ? targetRootPath || gameRootPath
        : baseType === 'game'
          ? gameRootPath || targetRootPath
          : ''
    if (baseRoot) {
      enableExecutablePath = joinWindowsPath(baseRoot, rawLaunchTarget)
    }
  }

  return {
    launchAction,
    showInjectButton,
    enableExecutablePath: normalizeWindowsPathLike(enableExecutablePath),
    enableExecutableBaseType: baseType,
    launchArgs
  }
}

export function resolveCurrentRuleInjectDescriptor(currentNexusRule = null, options = {}) {
  const installRules = getCurrentNexusInstallRuleList(currentNexusRule)
  if (!installRules.length) {
    return null
  }

  const targetRootPath = String(options?.targetRootPath || '').trim()
  const sortedRuleList = installRules
    .map((rule, index) => ({
      rule,
      index,
      priority: toSafeNumber(rule?.priority, 0)
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }
      return left.index - right.index
    })

  for (const entry of sortedRuleList) {
    const descriptor = resolveCurrentRuleLaunchDescriptor(entry.rule, options)
    const launchPath = String(descriptor?.enableExecutablePath || '').trim()
    if (
      descriptor?.launchAction !== 'inject_mod' ||
      descriptor?.showInjectButton !== true ||
      !launchPath
    ) {
      continue
    }

    const requiresTargetRoot =
      descriptor?.enableExecutableBaseType === 'target' && !isAbsoluteWindowsPath(launchPath)
    if (requiresTargetRoot && !targetRootPath) {
      continue
    }

    return {
      ...descriptor,
      ruleId: String(entry.rule?.id || entry.rule?.name || '').trim()
    }
  }

  return null
}

function normalizeNexusLaunchAction(value = '', defaultValue = '') {
  return normalizeInstallRuleLaunchAction(value, defaultValue)
}

function extractNexusMatchedRuleId(nexusInstallPlan = {}) {
  return extractInstallRuleMatchedRuleId(nexusInstallPlan)
}

function dedupeDependencyReferenceList(list = []) {
  const map = new Map()

  for (const item of parseJsonArray(list)) {
    const normalized = normalizeModDependencyReference(item)
    if (!normalized?.sourceModKey) {
      continue
    }
    map.set(normalized.sourceModKey, normalized)
  }

  return [...map.values()]
}

function formatDependentNameList(list = [], limit = 3) {
  const nameList = dedupeDependencyReferenceList(list)
    .map((item) => String(item?.name || item?.displayName || '').trim())
    .filter(Boolean)

  if (!nameList.length) {
    return ''
  }

  const displayList = nameList.slice(0, limit)
  if (nameList.length <= limit) {
    return displayList.join('、')
  }

  return uiText('ui.valueModsIncludingValue', { value1: (displayList.join('、')), value2: (nameList.length) })
}

export function normalizeModDependencyReference(item = {}) {
  if (typeof item === 'string') {
    const sourceModKey = String(item || '').trim()
    if (!sourceModKey) {
      return null
    }
    return {
      sourceModKey,
      name: sourceModKey,
      modId: 0,
      fileId: 0,
      sourceType: '',
      dependencyRole: '',
      isDefaultDependency: false
    }
  }

  const source = item && typeof item === 'object' ? item : {}
  const sourceModKey = String(
    source.sourceModKey || source.source_mod_key || source.key || ''
  ).trim()

  if (!sourceModKey) {
    return null
  }

  return {
    sourceModKey,
    name:
      String(source.name || source.displayName || source.modName || source.title || '').trim() ||
      sourceModKey,
    modId: toSafeNumber(source.modId || source.mod_id, 0),
    fileId: toSafeNumber(source.fileId || source.file_id, 0),
    sourceType: String(source.sourceType || source.source_type || '').trim(),
    dependencyRole: String(source.dependencyRole || source.dependency_role || '').trim(),
    isDefaultDependency:
      !!source.isDefaultDependency ||
      String(source.dependencyRole || source.dependency_role || '').trim() === 'default_dependency'
  }
}

export function buildModDependencyReference(payload = {}) {
  return normalizeModDependencyReference(payload)
}

export function shouldHideNexusRequirementDetail(requirement = {}) {
  const excludeReason = String(requirement?.excludeReason || '').trim()
  return (
    excludeReason === NEXUS_REQUIREMENT_EXCLUDE_REASON.HANDLED_BY_DEFAULT_DEPENDENCY ||
    excludeReason === NEXUS_REQUIREMENT_EXCLUDE_REASON.DEFAULT_DEPENDENCY_ALREADY_INSTALLED
  )
}

export function resolveNexusRequirementDisplayStatus(requirement = {}) {
  const excludeReason = String(requirement?.excludeReason || '').trim()
  if (excludeReason === NEXUS_REQUIREMENT_EXCLUDE_REASON.SAME_NEXUS_MOD_ALREADY_INSTALLED) {
    return NEXUS_REQUIREMENT_DISPLAY_STATUS.INSTALLED
  }

  const dependencyType = String(requirement?.dependencyType || requirement?.sourceType || '')
    .trim()
    .toLowerCase()
  const isExternalRequirement =
    dependencyType === 'external' ||
    (!!requirement?.externalRequirement && dependencyType !== 'nexus')
  if (isExternalRequirement) {
    return NEXUS_REQUIREMENT_DISPLAY_STATUS.MANUAL
  }

  return NEXUS_REQUIREMENT_DISPLAY_STATUS.PENDING
}

export async function resolveNexusRequirementLogoMap(payload = {}) {
  const requirementList = Array.isArray(payload?.requirements) ? payload.requirements : []
  const fallbackDomainName = String(payload?.fallbackDomainName || '').trim()
  const logoMap = new Map()

  for (const item of requirementList) {
    const dependencyType = String(item?.dependencyType || item?.sourceType || '')
      .trim()
      .toLowerCase()
    const modId = toSafeNumber(item?.modId, 0)
    const domainName = String(item?.domainName || fallbackDomainName || '')
      .trim()
      .toLowerCase()
    const isExternalRequirement =
      dependencyType === 'external' || (!!item?.externalRequirement && dependencyType !== 'nexus')

    if (isExternalRequirement || !domainName || modId <= 0) {
      continue
    }

    const cacheKey = `${domainName}:${modId}`
    if (logoMap.has(cacheKey)) {
      continue
    }

    try {
      const modInfo = await getCachedNexusModInfo(domainName, modId, payload?.apiConfig || {})
      logoMap.set(cacheKey, String(modInfo?.pictureUrl || '').trim())
    } catch (error) {
      console.warn('[NEXUS] 查询依赖封面失败', { domainName, modId, error })
      logoMap.set(cacheKey, '')
    }
  }

  return logoMap
}

async function getCachedNexusModInfo(domainName = '', modId = 0, config = {}) {
  const safeDomainName = String(domainName || '')
    .trim()
    .toLowerCase()
  const safeModId = toSafeNumber(modId, 0)
  if (!safeDomainName || safeModId <= 0) {
    return {}
  }

  const cacheKey = `${safeDomainName}:${safeModId}`
  const cachedValue = nexusModInfoCache.get(cacheKey)
  if (cachedValue !== undefined) {
    return cachedValue
  }

  if (!nexusModInfoRequestCache.has(cacheKey)) {
    const requestPromise = getNexusModInfo(safeDomainName, safeModId, config)
      .then((value) => {
        nexusModInfoCache.set(cacheKey, value)
        return value
      })
      .finally(() => {
        nexusModInfoRequestCache.delete(cacheKey)
      })
    nexusModInfoRequestCache.set(cacheKey, requestPromise)
  }

  return await nexusModInfoRequestCache.get(cacheKey)
}

export function normalizeWindowsPath(value = '') {
  return String(value || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\{2,}/g, '\\')
    .replace(/\\+$/g, '')
}

export function getPathDirname(filePath = '') {
  const normalized = normalizeWindowsPath(filePath)
  const index = normalized.lastIndexOf('\\')
  if (index <= 0) {
    return normalized
  }
  return normalized.slice(0, index)
}

export function formatInstalledDateTime(value = '') {
  const text = String(value || '').trim()
  if (!text) return '--'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN')
}

export function getRelativePathUnderRoot(rootPath = '', filePath = '') {
  const root = normalizeWindowsPath(rootPath)
  const file = normalizeWindowsPath(filePath)
  if (!root || !file) {
    return ''
  }

  const rootLower = root.toLowerCase()
  const fileLower = file.toLowerCase()
  if (fileLower === rootLower) {
    return ''
  }

  const prefix = `${rootLower}\\`
  if (!fileLower.startsWith(prefix)) {
    return ''
  }

  return file.slice(root.length + 1)
}

export function buildInstallLocationInfo(files = [], installRoot = '') {
  const normalizedRoot = normalizeWindowsPath(installRoot)
  const locationEntries = []
  const seen = new Set()

  for (const item of Array.isArray(files) ? files : []) {
    const filePath = normalizeWindowsPath(item)
    if (!filePath) {
      continue
    }

    const relativePath = getRelativePathUnderRoot(normalizedRoot, filePath)
    const relativeDir = relativePath.includes('\\')
      ? relativePath.slice(0, relativePath.lastIndexOf('\\'))
      : ''
    const locationLabel = relativeDir || '.'
    const absoluteDir = relativeDir
      ? normalizeWindowsPath(`${normalizedRoot}\\${relativeDir}`)
      : normalizedRoot || getPathDirname(filePath)

    if (!locationLabel || seen.has(locationLabel)) {
      continue
    }

    seen.add(locationLabel)
    locationEntries.push({
      label: locationLabel,
      absolutePath: absoluteDir || normalizedRoot || getPathDirname(filePath)
    })
  }

  if (!locationEntries.length) {
    return {
      installLocationText: normalizedRoot || '--',
      installLocationTooltip: normalizedRoot || '--',
      primaryInstallPath: normalizedRoot
    }
  }

  const labels = locationEntries.map((item) => item.label)
  return {
    installLocationText: labels.length === 1 ? labels[0] : uiText('ui.valueLocationsIncludingValue', { value1: (labels[0]), value2: (labels.length) }),
    installLocationTooltip: locationEntries.map((item) => item.absolutePath).join('\n'),
    primaryInstallPath: String(locationEntries[0]?.absolutePath || normalizedRoot || '').trim()
  }
}

export function getDefaultDependencyList(currentNexusRule = null) {
  const ruleJson =
    currentNexusRule?.ruleJson && typeof currentNexusRule.ruleJson === 'object'
      ? currentNexusRule.ruleJson
      : {}
  const setup =
    ruleJson?.setup && typeof ruleJson.setup === 'object' && !Array.isArray(ruleJson.setup)
      ? ruleJson.setup
      : {}

  const setupDependencies = Array.isArray(setup?.default_dependencies)
    ? setup.default_dependencies
    : Array.isArray(setup?.defaultDependencies)
      ? setup.defaultDependencies
      : []
  const directDependencies = Array.isArray(ruleJson?.default_dependencies)
    ? ruleJson.default_dependencies
    : Array.isArray(ruleJson?.defaultDependencies)
      ? ruleJson.defaultDependencies
      : []

  return [...setupDependencies, ...directDependencies]
}

function buildDependencyMatchText(target = {}) {
  const source = target && typeof target === 'object' ? target : {}
  const provider = source?.provider && typeof source.provider === 'object' ? source.provider : {}

  return [
    source?.id,
    source?.name,
    source?.notes,
    provider?.owner,
    provider?.repo,
    provider?.tag,
    provider?.asset_name,
    provider?.assetName,
    provider?.url,
    provider?.download_url,
    provider?.downloadUrl
  ]
    .map((item) =>
      String(item || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean)
    .join(' ')
}

function buildRequirementMatchText(requirement = {}) {
  return [requirement?.name, requirement?.url, requirement?.notes]
    .map((item) =>
      String(item || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean)
    .join(' ')
}

function isUe4ssMatchText(text = '') {
  const value = String(text || '')
    .trim()
    .toLowerCase()

  return value.includes('ue4ss') || value.includes('re-ue4ss')
}

export function resolveNexusDependencyProvider(provider = {}) {
  const source = provider && typeof provider === 'object' ? provider : {}
  const domainName = String(
    readProviderAlias(source, [
      'game_domain',
      'game_domain_name',
      'domain_name',
      'domainName',
      'gameDomain',
      'gameDomainName'
    ]) || ''
  ).trim()
  const modId = toSafeNumber(
    readProviderAlias(source, ['mod_id', 'modId', 'nexus_mod_id', 'nexusModId', 'id']),
    0
  )
  const fileId = toSafeNumber(
    readProviderAlias(source, ['file_id', 'fileId', 'nexus_file_id', 'nexusFileId']),
    0
  )

  if (domainName && modId > 0 && fileId > 0) {
    return {
      domainName,
      modId,
      fileId
    }
  }

  const rawUrl = String(source.url || '').trim()
  if (!rawUrl) {
    return {
      domainName,
      modId,
      fileId
    }
  }

  try {
    const url = new URL(rawUrl)
    const pathMatch = url.pathname.match(/^\/([^/]+)\/mods\/(\d+)/i)
    const parsedDomainName = pathMatch?.[1] ? String(pathMatch[1]).trim() : domainName
    const parsedModId = toSafeNumber(pathMatch?.[2], modId)
    const parsedFileId = toSafeNumber(
      url.searchParams.get('file_id') || url.searchParams.get('fileId'),
      fileId
    )

    return {
      domainName: parsedDomainName,
      modId: parsedModId,
      fileId: parsedFileId
    }
  } catch {
    return {
      domainName,
      modId,
      fileId
    }
  }
}

export function buildGithubDependencySourceModKey(dependency = {}, resolvedDependency = {}) {
  const asset = resolvedDependency.asset || {}
  const dependencyId = String(dependency?.id || asset.name || 'default_dependency').trim()
  return `dependency:${dependencyId}`
}

export function buildNexusDependencySourceModKey(resolvedProvider = {}) {
  const modId = toSafeNumber(resolvedProvider?.modId, 0)
  const fileId = toSafeNumber(resolvedProvider?.fileId, 0)
  return `dependency:nexus:${modId}:${fileId}`
}

function buildDefaultDependencySourceModKey(dependency = {}) {
  const source = String(dependency?.source || '')
    .trim()
    .toLowerCase()

  if (source === 'github_release') {
    return buildGithubDependencySourceModKey(dependency, {
      asset: {
        name: String(
          dependency?.provider?.asset_name ||
            dependency?.provider?.assetName ||
            dependency?.id ||
            ''
        ).trim()
      }
    })
  }

  if (source === 'nexus_file') {
    return buildNexusDependencySourceModKey(
      resolveNexusDependencyProvider(dependency?.provider || {})
    )
  }

  return ''
}

function resolveDefaultDependencySourceText(source = '') {
  const safeSource = String(source || '')
    .trim()
    .toLowerCase()

  if (safeSource === 'github_release') {
    return 'GitHub Release'
  }
  if (safeSource === 'nexus_file') {
    return uiText('ui.nexusFile')
  }
  if (safeSource === 'url' || safeSource === 'direct_url') {
    return uiText('ui.directDownload')
  }
  return safeSource || uiText('ui.defaultDependency')
}

function resolveNexusProviderFilterText(provider = {}) {
  const source = provider && typeof provider === 'object' ? provider : {}
  const category = String(readProviderAlias(source, ['category', 'file_category', 'fileCategory']) || '').trim()
  const fileName = String(readProviderAlias(source, ['file_name', 'fileName', 'name']) || '').trim()
  const fileNameRegex = String(
    readProviderAlias(source, ['file_name_regex', 'fileNameRegex', 'regex']) || ''
  ).trim()
  const containsValue = readProviderAlias(source, [
    'file_name_contains',
    'fileNameContains',
    'contains'
  ])
  const containsText = Array.isArray(containsValue)
    ? containsValue.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
    : String(containsValue || '').trim()

  return [
    category ? `Category ${category}` : '',
    fileName ? `File Name ${fileName}` : '',
    fileNameRegex ? `Regex ${fileNameRegex}` : '',
    containsText ? `Contains ${containsText}` : ''
  ]
    .filter(Boolean)
    .join(' / ')
}

function resolveDefaultDependencyProviderText(dependency = {}) {
  const source = String(dependency?.source || '')
    .trim()
    .toLowerCase()
  const provider =
    dependency?.provider && typeof dependency.provider === 'object' ? dependency.provider : {}

  if (source === 'github_release') {
    const repoText = [provider?.owner, provider?.repo].map((item) => String(item || '').trim()).filter(Boolean).join('/')
    const assetName = String(provider?.asset_name || provider?.assetName || provider?.asset_name_regex || provider?.assetNameRegex || provider?.asset_name_contains || provider?.assetNameContains || '').trim()
    const tag = String(provider?.tag || '').trim()
    return [repoText, tag && tag.toLowerCase() !== 'latest' ? `Tag ${tag}` : uiText('ui.latestStableRelease'), assetName].filter(Boolean).join(' / ')
  }

  if (source === 'nexus_file') {
    const resolvedProvider = resolveNexusDependencyProvider(provider)
    const fileId = toSafeNumber(resolvedProvider?.fileId, 0)
    const filterText = fileId > 0 ? '' : resolveNexusProviderFilterText(provider)
    return [
      String(resolvedProvider?.domainName || '').trim(),
      toSafeNumber(resolvedProvider?.modId, 0) > 0 ? `Mod ID ${resolvedProvider.modId}` : '',
      fileId > 0 ? `File ID ${resolvedProvider.fileId}` : filterText || uiText('ui.fileAwaitingResolution')
    ]
      .filter(Boolean)
      .join(' / ')
  }

  return String(provider?.url || provider?.download_url || provider?.downloadUrl || '').trim()
}

function buildDefaultDependencyPreviewList(currentNexusRule = null, options = {}) {
  const installedSourceModKeys = toSafeSet(options.installedSourceModKeys)

  return getDefaultDependencyList(currentNexusRule).map((dependency, index) => {
    const source = String(dependency?.source || '')
      .trim()
      .toLowerCase()
    const sourceModKey = buildDefaultDependencySourceModKey(dependency)
    const isUnresolvedNexusFile = source === 'nexus_file' && /:0$/.test(sourceModKey)
    return {
      key: sourceModKey || `default-dependency-${index}`,
      id: String(dependency?.id || '').trim(),
      name: String(dependency?.name || dependency?.id || `默认依赖 ${index + 1}`).trim(),
      notes: String(dependency?.notes || dependency?.description || '').trim(),
      source,
      sourceType: source,
      sourceText: resolveDefaultDependencySourceText(source),
      providerText: resolveDefaultDependencyProviderText(dependency),
      sourceModKey,
      required: dependency?.required !== false,
      blocking: dependency?.blocking === true,
      installed: isUnresolvedNexusFile ? false : !!sourceModKey && installedSourceModKeys.has(sourceModKey),
      resolutionState: isUnresolvedNexusFile ? 'pending' : 'resolved',
      dependencyType: 'default',
      dependencyRole: 'default_dependency',
      isDefaultDependency: true
    }
  })
}

export function buildDefaultDependencyReference(dependency = {}) {
  const sourceModKey = buildDefaultDependencySourceModKey(dependency)
  if (!sourceModKey) {
    return null
  }

  const source = String(dependency?.source || '')
    .trim()
    .toLowerCase()
  const resolvedProvider =
    source === 'nexus_file'
      ? resolveNexusDependencyProvider(dependency?.provider || {})
      : { modId: 0, fileId: 0 }

  return buildModDependencyReference({
    sourceModKey,
    name: String(dependency?.name || dependency?.id || '默认依赖').trim() || '默认依赖',
    modId: toSafeNumber(resolvedProvider?.modId, 0),
    fileId: toSafeNumber(resolvedProvider?.fileId, 0),
    sourceType: source || 'default_dependency',
    dependencyRole: 'default_dependency',
    isDefaultDependency: true
  })
}

export function buildInstalledModDependencyReference(record = {}) {
  return buildModDependencyReference({
    sourceModKey: String(record?.sourceModKey || record?.source_mod_key || '').trim(),
    name:
      String(
        record?.displayName || record?.name || record?.optionName || record?.option_name || ''
      ).trim() || '--',
    modId: toSafeNumber(record?.modId || record?.mod_id, 0),
    fileId: toSafeNumber(record?.optionId || record?.option_id, 0),
    sourceType: String(record?.sourceType || record?.source || 'nexus').trim(),
    dependencyRole:
      String(record?.dependencyRole || record?.metadata?.category || '').trim() ===
      'default_dependency'
        ? 'default_dependency'
        : 'nexus_requirement',
    isDefaultDependency: !!record?.isDefaultDependency || Number(record?.type_id || 0) === 1
  })
}

function findMatchedDefaultDependency(requirement = {}, dependencyList = []) {
  const safeDependencyList = Array.isArray(dependencyList) ? dependencyList : []
  const requirementModId = toSafeNumber(requirement?.modId, 0)
  const requirementText = buildRequirementMatchText(requirement)

  for (const dependency of safeDependencyList) {
    const source = String(dependency?.source || '')
      .trim()
      .toLowerCase()
    const dependencyText = buildDependencyMatchText(dependency)

    if (source === 'nexus_file') {
      const resolvedProvider = resolveNexusDependencyProvider(dependency?.provider || {})
      if (requirementModId > 0 && requirementModId === toSafeNumber(resolvedProvider?.modId, 0)) {
        return dependency
      }
    }

    if (
      requirementText &&
      dependencyText &&
      isUe4ssMatchText(requirementText) &&
      isUe4ssMatchText(dependencyText)
    ) {
      return dependency
    }
  }

  return null
}

function resolvePendingRequirementList(requirementInfo = {}, options = {}) {
  const dependencyList = getDefaultDependencyList(options.currentNexusRule)
  const safeRequirementList = Array.isArray(requirementInfo?.dependencies)
    ? requirementInfo.dependencies
    : []
  const domainName = String(
    requirementInfo?.domainName || options.domainName || options.gameBaseInfo?.domainName || ''
  ).trim()
  const pendingDependencies = []
  const excludedDependencies = []
  const installedSourceModKeys = toSafeSet(options.installedSourceModKeys)
  const installedNexusModIds = toSafeSet(options.installedNexusModIds)

  for (const requirement of safeRequirementList) {
    const safeRequirement = requirement && typeof requirement === 'object' ? requirement : {}
    const safeModId = toSafeNumber(safeRequirement?.modId, 0)
    const matchedDefaultDependency = findMatchedDefaultDependency(safeRequirement, dependencyList)

    if (matchedDefaultDependency) {
      const sourceModKey = buildDefaultDependencySourceModKey(matchedDefaultDependency)
      excludedDependencies.push({
        ...safeRequirement,
        excludeReason:
          sourceModKey && installedSourceModKeys.has(sourceModKey)
            ? 'default_dependency_already_installed'
            : 'handled_by_default_dependency',
        matchedDefaultDependency: {
          id: String(matchedDefaultDependency?.id || '').trim(),
          name: String(matchedDefaultDependency?.name || '').trim(),
          source: String(matchedDefaultDependency?.source || '').trim()
        }
      })
      continue
    }

    if (safeModId > 0 && installedNexusModIds.has(safeModId)) {
      excludedDependencies.push({
        ...safeRequirement,
        excludeReason: 'same_nexus_mod_already_installed'
      })
      continue
    }

    pendingDependencies.push({
      ...safeRequirement,
      domainName: String(safeRequirement?.domainName || domainName).trim() || domainName,
      dependencyType:
        String(safeRequirement?.dependencyType || safeRequirement?.sourceType || '')
          .trim()
          .toLowerCase() === 'external'
          ? 'external'
          : 'nexus'
    })
  }

  return {
    pendingDependencies,
    excludedDependencies
  }
}

export function buildNexusSourceMeta(payload = {}) {
  return {
    source: 'nexus',
    sourceId: String(
      payload?.currentNexusRule?.nexusGameId || payload?.routeQuery?.nexusGameId || ''
    ).trim(),
    sourceSlug: String(payload?.gameBaseInfo?.domainName || '').trim(),
    appId: String(payload?.resolvedNexusAppId || '').trim()
  }
}

function resolveNexusSourceModKeyParts(sourceModKey = '') {
  const parts = String(sourceModKey || '')
    .split(':')
    .map((item) => item.trim())
    .filter(Boolean)

  if (parts.length < 2) {
    return {
      modId: '',
      optionId: ''
    }
  }

  if (parts[0].toLowerCase() === 'nexus') {
    return {
      modId: parts[1] || '',
      optionId: parts[2] || ''
    }
  }

  return {
    modId: parts[0] || '',
    optionId: parts[1] || ''
  }
}

export function normalizeInstalledNexusRecord(item = {}, options = {}) {
  const metadata = parseJsonObject(item?.metadata_json || {})
  const nexusInstallPlan = resolveInstallRulePlanFromMetadata(metadata, 'nexus')
  const dependencies = dedupeDependencyReferenceList(
    item?.dependencies_json || item?.dependencies || []
  )

  const executableInfo =
    metadata?.executablePath && typeof metadata.executablePath === 'object'
      ? metadata.executablePath
      : {}
  const executableType = toSafeNumber(executableInfo?.type, 0)
  const executablePath = String(executableInfo?.path || '').trim()
  const executablePaths = (Array.isArray(executableInfo?.paths) ? executableInfo.paths : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
  const matchedRuleId = extractNexusMatchedRuleId(nexusInstallPlan)
  const currentRuleLaunchDescriptor = findCurrentNexusInstallRule(
    options?.currentNexusRule,
    matchedRuleId
  )
    ? resolveCurrentRuleLaunchDescriptor(
        findCurrentNexusInstallRule(options?.currentNexusRule, matchedRuleId),
        {
          gameRootPath: options?.gameRootPath,
          targetRootPath: String(metadata?.targetPath || item?.target_path || '').trim()
        }
      )
    : null
  const storedLaunchAction = normalizeNexusLaunchAction(
    resolveFirstDefinedValue(nexusInstallPlan?.launchAction, nexusInstallPlan?.launch_action),
    ''
  )
  const storedEnableExecutablePath = String(
    resolveFirstDefinedValue(
      nexusInstallPlan?.enableExecutablePath,
      nexusInstallPlan?.enable_executable_path
    ) || ''
  ).trim()
  const storedEnableExecutableBaseType = String(
    resolveFirstDefinedValue(
      nexusInstallPlan?.enableExecutableBaseType,
      nexusInstallPlan?.enable_executable_base_type
    ) || ''
  ).trim()
  const storedLaunchArgs = normalizeLaunchArgumentList(
    resolveFirstDefinedValue(nexusInstallPlan?.launchArgs, nexusInstallPlan?.launch_args) || []
  )
  const hasExplicitShowInjectButton =
    normalizeOptionalBoolean(nexusInstallPlan?.showInjectButton) !== null ||
    normalizeOptionalBoolean(nexusInstallPlan?.show_inject_button) !== null
  const launchAction =
    storedLaunchAction || String(currentRuleLaunchDescriptor?.launchAction || '').trim()
  const enableExecutablePath =
    storedEnableExecutablePath ||
    String(currentRuleLaunchDescriptor?.enableExecutablePath || '').trim()
  const enableExecutableBaseType =
    storedEnableExecutableBaseType ||
    String(currentRuleLaunchDescriptor?.enableExecutableBaseType || '').trim()
  const launchArgs = storedLaunchArgs.length
    ? storedLaunchArgs
    : normalizeLaunchArgumentList(currentRuleLaunchDescriptor?.launchArgs || [])
  const hasLaunchTarget = !!enableExecutablePath
  const showInjectButton = hasExplicitShowInjectButton
    ? normalizeOptionalBoolean(nexusInstallPlan?.showInjectButton) === true ||
      normalizeOptionalBoolean(nexusInstallPlan?.show_inject_button) === true
    : currentRuleLaunchDescriptor?.showInjectButton === true
  const isManualExecutable = launchAction === 'manual_execute' && hasLaunchTarget
  const isDefaultExecutable = launchAction === 'default_execute' && hasLaunchTarget
  const canInjectLaunch = launchAction === 'inject_mod' && hasLaunchTarget
  const isInjectable = canInjectLaunch && showInjectButton
  const hideRunnableByLaunchAction = isDefaultExecutable || canInjectLaunch
  const isRunnable =
    !hideRunnableByLaunchAction &&
    (isManualExecutable || executableType > 0 || !!executablePath || executablePaths.length > 0)

  const installPathInfo = buildInstallLocationInfo(
    Array.isArray(item?.install_paths_json)
      ? item.install_paths_json
      : (() => {
          try {
            return JSON.parse(String(item?.install_paths_json || '[]'))
          } catch {
            return []
          }
        })(),
    metadata?.targetPath || item?.target_path || ''
  )

  const domainName = String(metadata?.sourceGameDomain || options?.gameDomainName || '').trim()
  const sourceModKey = String(item?.source_mod_key || item?.sourceModKey || '').trim()
  const sourceModKeyParts = resolveNexusSourceModKeyParts(sourceModKey)
  const modId = String(item?.mod_id || item?.modId || sourceModKeyParts.modId || '').trim()
  const optionId = String(item?.option_id || item?.optionId || sourceModKeyParts.optionId || '').trim()
  const metadataCategory = String(metadata?.category || '').trim()
  const isDefaultDependency =
    toSafeNumber(item?.type_id, 0) === 1 || metadataCategory === 'default_dependency'
  const sourcePageUrl = resolveInstalledNexusSourcePageUrl({
    metadata,
    domainName,
    modId,
    downloadUrl: item?.download_url,
    isDefaultDependency
  })
  const description = String(
    item?.description || metadata?.description || metadata?.summary || ''
  ).trim()
  const summary = String(item?.summary || metadata?.summary || description).trim()

  return {
    id: toSafeNumber(item?.id, 0),
    modId,
    optionId,
    sourceModKey,
    name: String(item?.name || '--').trim(),
    optionName: String(item?.option_name || '').trim(),
    displayName: String(item?.name || item?.option_name || '--').trim(),
    description,
    summary,
    version: String(item?.version || '--').trim(),
    cover: String(item?.cover || '').trim(),
    installedAt: formatInstalledDateTime(item?.installed_at),
    isActive: toSafeNumber(item?.is_active, 1),
    canRemoveRecordOnly: item?.canRemoveRecordOnly === true,
    priorityOrder: toSafeNumber(item?.priority_order, 0),
    deployDomain: String(item?.deploy_domain || '').trim(),
    installModel: String(item?.install_model || 'legacy').trim(),
    compatFlags: String(item?.compat_flags || '[]').trim(),
    lastReconcileAt: String(item?.last_reconcile_at || '').trim(),
    stagingPath: String(metadata?.stagingPath || item?.staging_path || '').trim(),
    targetPath: String(metadata?.targetPath || item?.target_path || '').trim(),
    archivePath: String(
      item?.archive_path || item?.archivePath || metadata?.archivePath || ''
    ).trim(),
    targetRelativePath: String(
      resolveFirstDefinedValue(
        nexusInstallPlan?.targetRelativePath,
        nexusInstallPlan?.target_relative_path
      ) || ''
    ).trim(),
    targetBaseType: String(
      resolveFirstDefinedValue(
        nexusInstallPlan?.targetBaseType,
        nexusInstallPlan?.target_base_type
      ) || 'game'
    ).trim(),
    matchedRuleId,
    installRuleStrategy: String(
      resolveFirstDefinedValue(nexusInstallPlan?.strategy, nexusInstallPlan?.installRuleStrategy) ||
        ''
    ).trim(),
    executableInfo,
    executableType,
    executablePath,
    executablePaths,
    hasMultipleExecutables: executableType === 2 || executablePaths.length > 1,
    isRunnable,
    launchAction,
    showInjectButton,
    enableExecutablePath,
    enableExecutableBaseType,
    launchArgs,
    isManualExecutable,
    isDefaultExecutable,
    canInjectLaunch,
    isInjectable,
    sourceLabel: isDefaultDependency ? '默认依赖' : NEXUS_SOURCE_LABEL,
    sourcePageUrl,
    downloadUrl: String(item?.download_url || '').trim(),
    sourceType: String(item?.source || metadata?.sourceType || 'nexus').trim(),
    isDefaultDependency,
    dependencyRole: isDefaultDependency ? 'default_dependency' : 'nexus_requirement',
    metadata,
    dependencies,
    dependencyCount: dependencies.length,
    ...installPathInfo,
    raw: item
  }
}

export function decorateInstalledNexusRecords(records = []) {
  const safeList = toSafeArray(records).map((item) => {
    const dependencies = dedupeDependencyReferenceList(
      item?.dependencies || item?.dependencies_json
    )
    return {
      ...item,
      dependencies,
      dependencyCount: dependencies.length
    }
  })
  const dependentMap = new Map()
  const sourceModKeyMap = new Map()
  const modIdMap = new Map()

  for (const item of safeList) {
    const sourceModKey = String(item?.sourceModKey || '').trim()
    if (!sourceModKey) {
      if (toSafeNumber(item?.modId, 0) > 0) {
        modIdMap.set(toSafeNumber(item.modId, 0), item)
      }
      continue
    }
    sourceModKeyMap.set(sourceModKey, item)

    const safeModId = toSafeNumber(item?.modId, 0)
    if (safeModId <= 0) {
      continue
    }

    const existing = modIdMap.get(safeModId)
    if (!existing) {
      modIdMap.set(safeModId, item)
      continue
    }

    const currentScore = Number(item?.isActive ? 1000000 : 0) + toSafeNumber(item?.id, 0)
    const existingScore = Number(existing?.isActive ? 1000000 : 0) + toSafeNumber(existing?.id, 0)
    if (currentScore >= existingScore) {
      modIdMap.set(safeModId, item)
    }
  }

  for (const item of safeList) {
    const dependentRef = buildInstalledModDependencyReference(item)
    if (!dependentRef?.sourceModKey) {
      continue
    }

    for (const dependency of toSafeArray(item?.dependencies)) {
      const dependencyRef = normalizeModDependencyReference(dependency)
      const targetSourceModKey = String(dependencyRef?.sourceModKey || '').trim()
      const targetModId = toSafeNumber(dependencyRef?.modId, 0)
      const sourceKeyMatchedRecord =
        targetSourceModKey && sourceModKeyMap.get(targetSourceModKey)
          ? sourceModKeyMap.get(targetSourceModKey)
          : null
      const modIdMatchedRecord =
        !sourceKeyMatchedRecord && targetModId > 0 ? modIdMap.get(targetModId) : null
      const targetRecord = sourceKeyMatchedRecord || modIdMatchedRecord || null

      if (!targetRecord) {
        continue
      }
      const dependentTargetKey = String(targetRecord?.sourceModKey || '').trim()
      if (!dependentTargetKey) {
        continue
      }
      if (!dependentMap.has(dependentTargetKey)) {
        dependentMap.set(dependentTargetKey, [])
      }
      dependentMap.get(dependentTargetKey).push({
        ...dependentRef,
        id: toSafeNumber(item?.id, 0),
        isActive: !!item?.isActive
      })
    }
  }

  const decoratedList = safeList.map((item) => {
    const sourceModKey = String(item?.sourceModKey || '').trim()
    const dependentMods = dedupeDependencyReferenceList(dependentMap.get(sourceModKey) || []).map(
      (dependency) => {
        const matched =
          (dependentMap.get(sourceModKey) || []).find(
            (entry) => String(entry?.sourceModKey || '').trim() === dependency.sourceModKey
          ) || {}
        return {
          ...dependency,
          id: toSafeNumber(matched?.id, 0),
          isActive: !!matched?.isActive
        }
      }
    )
    const activeDependentMods = dependentMods.filter((entry) => entry?.isActive)
    const inactiveDependentMods = dependentMods.filter((entry) => !entry?.isActive)
    const dependentSummaryText = formatDependentNameList(dependentMods)
    const activeDependentSummaryText = formatDependentNameList(activeDependentMods)
    const isProtectedDefaultDependency =
      !!item?.isDefaultDependency && activeDependentMods.length > 0
    const dependencyWarningText = isProtectedDefaultDependency
      ? '当前为默认依赖，禁用后可能会导致大部分模组失效。'
      : dependentSummaryText
        ? uiText('ui.valueDependsOnThisModContinuingMayPreventDependentMods', { value1: (dependentSummaryText) })
        : ''
    const disableBlockedReason = isProtectedDefaultDependency
      ? uiText('ui.defaultDependencyIsUsedByValueAndCannotBeDisabled', { value1: (activeDependentSummaryText || dependentSummaryText) })
      : ''
    const uninstallBlockedReason = isProtectedDefaultDependency && !item.canRemoveRecordOnly
      ? uiText('ui.defaultDependencyIsUsedByValueAndCannotBeUninstalled', { value1: (activeDependentSummaryText || dependentSummaryText) })
      : ''

    return {
      ...item,
      dependentMods,
      activeDependentMods,
      inactiveDependentMods,
      dependentCount: dependentMods.length,
      activeDependentCount: activeDependentMods.length,
      inactiveDependentCount: inactiveDependentMods.length,
      dependentSummaryText,
      activeDependentSummaryText,
      dependencyWarningText,
      disableConfirmText: dependencyWarningText
        ? uiText('ui.disableModValueValue', { value1: (item?.displayName || item?.name || '--'), value2: (dependencyWarningText) })
        : '',
      uninstallConfirmText: dependencyWarningText
        ? uiText('ui.uninstallModValueValue', { value1: (item?.displayName || item?.name || '--'), value2: (dependencyWarningText) })
        : '',
      dependencyHintText:
        !item?.isDefaultDependency && dependentSummaryText ? uiText('ui.requiredByValue', { value1: (dependentSummaryText) }) : '',
      disableBlockedReason,
      uninstallBlockedReason,
      canDisable: !disableBlockedReason,
      canUninstall: !uninstallBlockedReason
    }
  })

  return decoratedList
}

function resolveNexusDownloadGamePath(payload = {}) {
  return String(
    payload?.detectedRootPath ||
      payload?.currentNexusRule?.rootPath ||
      payload?.currentNexusRule?.clientRootPath ||
      ''
  ).trim()
}

function buildGithubDependencyTask(resolvedDependency = {}, dependency = {}, payload = {}) {
  const asset = resolvedDependency.asset || {}
  const dependencyName =
    String(dependency?.name || resolvedDependency.releaseName || asset.name || '默认依赖').trim() ||
    '默认依赖'
  const gameRootPath = resolveNexusDownloadGamePath(payload)
  const sourceGameId = String(
    payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || ''
  ).trim()
  const sourceModKey = buildGithubDependencySourceModKey(dependency, resolvedDependency)

  return {
    task_name: uiText('ui.defaultDependencyDownloadValue', { value1: (dependencyName) }),
    module: '游戏',
    file_type: String(asset.contentType || 'zip').trim() || 'zip',
    download_url: String(asset.downloadUrl || '').trim(),
    file_size: Number(asset.size || 0),
    saveType: 2,
    sourcePlatform: 'nexus',
    sourceType: 'nexus',
    gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
    sourceGameId,
    sourceModId: sourceModKey,
    sourceModKey,
    sourceFileId: String(asset.id || asset.name || '').trim(),
    dedupeKey: ['nexus', sourceGameId, sourceModKey, String(asset.id || asset.name || '').trim()]
      .filter(Boolean)
      .join(':'),
    gameRootPath,
    fun: {
      type: 0
    }
  }
}

export function resolveDownloadLinkUrl(item = {}) {
  return String(item?.URI || item?.uri || item?.download_url || item?.downloadUrl || '').trim()
}

function resolveNexusDescriptionText(...sources) {
  for (const source of sources) {
    const text = String(source || '').trim()
    if (text) {
      return text
    }
  }
  return ''
}

function resolveNexusInstallConfig(payload = {}) {
  const installConfig =
    payload?.installConfig && typeof payload.installConfig === 'object' ? payload.installConfig : {}
  const profileName = String(
    installConfig.profileName || installConfig.targetProfileName || payload.profileName || ''
  ).trim()
  const targetProfileName = String(installConfig.targetProfileName || profileName).trim()
  const configProfileId = String(
    installConfig.configProfileId ||
      installConfig.installConfigProfileId ||
      installConfig.profileId ||
      payload.configProfileId ||
      payload.installConfigProfileId ||
      payload.profileId ||
      ''
  ).trim()
  const profileId = String(
    installConfig.profileId ||
      payload.profileId ||
      configProfileId ||
      ''
  ).trim()
  const configProfileName = String(
    installConfig.configProfileName ||
      installConfig.installConfigProfileName ||
      payload.configProfileName ||
      payload.installConfigProfileName ||
      ''
  ).trim()
  const installConfigProfileId = String(
    installConfig.installConfigProfileId || payload.installConfigProfileId || configProfileId
  ).trim()
  const installConfigProfileName = String(
    installConfig.installConfigProfileName || payload.installConfigProfileName || configProfileName
  ).trim()
  const ruleProfileId = toSafeNumber(installConfig.ruleProfileId || payload.ruleProfileId, 0) || null
  const profileScope = String(
    installConfig.profileScope || installConfig.installConfigProfileScope || payload.profileScope || ''
  ).trim()
  const profileKey = String(installConfig.profileKey || '').trim()
  const sourceType = String(
    installConfig.installConfigSourceType || installConfig.sourceType || ''
  ).trim()
  const ruleVersion = toSafeNumber(installConfig.ruleVersion || payload.ruleVersion, 0) || null

  return {
    profileId,
    ruleProfileId,
    profileName,
    targetProfileName,
    profileScope,
    profileKey,
    configProfileId,
    configProfileName,
    installConfigProfileId,
    installConfigProfileName,
    installConfigProfileScope: profileScope,
    installConfigSourceType: sourceType,
    ruleVersion
  }
}

function buildDependencyInstallPayload(context = {}, dependency = {}, resolvedDependency = {}) {
  const asset = resolvedDependency.asset || {}
  const dependencyId = String(dependency?.id || asset.name || 'default_dependency').trim()
  const installConfig = resolveNexusInstallConfig(context)
  const dependencyName =
    String(dependency?.name || resolvedDependency.releaseName || asset.name || '默认依赖').trim() ||
    '默认依赖'
  const dependencyDescription = resolveNexusDescriptionText(
    dependency?.description,
    dependency?.summary,
    dependency?.notes,
    resolvedDependency?.releaseName
  )
  const gameName =
    String(
      context.currentNexusRule?.gameName ||
        context.gameBaseInfo?.name ||
        context.gameBaseInfo?.domainName ||
        ''
    ).trim() || 'Nexus 游戏'

  return {
    appid: context.resolvedNexusAppId,
    gameId: toSafeNumber(context.currentNexusRule?.gameId, 0),
    nexusGameId: toSafeNumber(context.currentNexusRule?.nexusGameId, 0),
    gameName,
    clientInstallPath: String(dependency?.install?.target?.path || '.').trim() || '.',
    serverInstallPath: '',
    modId: dependencyId,
    id: dependencyId,
    modName: dependencyName,
    name: dependencyName,
    description: dependencyDescription,
    summary: dependencyDescription,
    version: String(resolvedDependency.tag || resolvedDependency.releaseName || asset.name || '').trim(),
    fileSize: Number(asset.size || 0),
    installType: 0,
    taskType: 0,
    usageType: 1,
    typeId: 1,
    cover: String(context.gameBaseInfo?.coverImage || '').trim(),
    downloadUrl: String(asset.downloadUrl || '').trim(),
    sourceType: 'nexus',
    gameSourceId: String(context.currentNexusRule?.nexusGameId || '').trim(),
    gameSourceSlug: String(context.gameBaseInfo?.domainName || '').trim(),
    sourceId: dependencyId,
    sourceSlug: String(context.gameBaseInfo?.domainName || '').trim(),
    sourceGameDomain: String(context.gameBaseInfo?.domainName || '').trim(),
    sourceModKey: `dependency:${dependencyId}`,
    profileId: installConfig.profileId,
    ruleProfileId: installConfig.ruleProfileId,
    profileName: installConfig.profileName,
    targetProfileName: installConfig.targetProfileName,
    profileScope: installConfig.profileScope,
    configProfileId: installConfig.configProfileId,
    configProfileName: installConfig.configProfileName,
    installConfigProfileId: installConfig.installConfigProfileId,
    installConfigProfileName: installConfig.installConfigProfileName,
    installConfigProfileScope: installConfig.installConfigProfileScope,
    installConfigSourceType: installConfig.installConfigSourceType,
    ruleVersion: installConfig.ruleVersion,
    cleanupSourceArchiveAfterInstall: true,
    fileMd5: '',
    modVersion: String(resolvedDependency.tag || resolvedDependency.releaseName || asset.name || '').trim(),
    nexusInstallRule:
      dependency?.install && typeof dependency.install === 'object' ? dependency.install : {},
    metadata: {
      category: 'default_dependency',
      provider: dependency?.provider || {},
      resolvedProvider: buildGithubReleaseProviderSnapshot(resolvedDependency),
      dependencyId,
      description: dependencyDescription,
      summary: dependencyDescription,
      ...installConfig
    }
  }
}

export function buildMainModInstallRule(currentNexusRule = null) {
  const ruleJson =
    currentNexusRule?.ruleJson && typeof currentNexusRule.ruleJson === 'object'
      ? currentNexusRule.ruleJson
      : {}

  const installRules = Array.isArray(ruleJson?.install_rules)
    ? ruleJson.install_rules
    : Array.isArray(ruleJson?.installRules)
      ? ruleJson.installRules
      : []
  if (!installRules.length) {
    return {}
  }

  return {
    install_rules: installRules
  }
}

export async function buildDefaultDependencyBatchEntries(payload = {}) {
  const dependencyList = getDefaultDependencyList(payload.currentNexusRule)
  const githubDependencies = dependencyList.filter((item) => {
    const source = String(item?.source || '')
      .trim()
      .toLowerCase()
    return source === 'github_release'
  })
  const installedSourceModKeys = toSafeSet(payload.installedSourceModKeys)

  const entries = []
  let sortIndex = toSafeNumber(payload.startSortIndex, 0)
  for (const dependency of githubDependencies) {
    // 已安装的依赖沿用现有记录，不为每次安装主模组重新查询 latest。
    if (installedSourceModKeys.has(buildDefaultDependencySourceModKey(dependency))) {
      continue
    }
    const provider =
      dependency?.provider && typeof dependency.provider === 'object' ? dependency.provider : {}
    const resolvedDependency = await resolveGithubReleaseAsset(provider)
    const sourceModKey = buildGithubDependencySourceModKey(dependency, resolvedDependency)
    if (installedSourceModKeys.has(sourceModKey)) {
      continue
    }
    const task = buildGithubDependencyTask(resolvedDependency, dependency, payload)
    if (!task.download_url) {
      continue
    }

    entries.push({
      item: task,
      meta: {
        sortIndex,
        dependencyRef: buildDefaultDependencyReference(dependency),
        installPayload: {
          ...buildDependencyInstallPayload(payload, dependency, resolvedDependency),
          sourceModKey
        },
        displayName: String(dependency?.name || task.task_name || '默认依赖').trim()
      }
    })
    sortIndex += 1
  }

  const nexusEntries = await buildNexusDependencyBatchEntries({
    ...payload,
    startSortIndex: sortIndex
  })

  return [...entries, ...nexusEntries]
}

export async function buildNexusDependencyBatchEntries(payload = {}) {
  const dependencyList = getDefaultDependencyList(payload.currentNexusRule)
  const nexusDependencies = dependencyList.filter((item) => {
    const source = String(item?.source || '')
      .trim()
      .toLowerCase()
    return source === 'nexus_file'
  })
  const installedSourceModKeys = toSafeSet(payload.installedSourceModKeys)
  const installConfig = resolveNexusInstallConfig(payload)
  const gameName =
    String(
      payload.currentNexusRule?.gameName ||
        payload.gameBaseInfo?.name ||
        payload.gameBaseInfo?.domainName ||
        ''
    ).trim() || 'Nexus 游戏'

  const entries = []
  let sortIndex = toSafeNumber(payload.startSortIndex, 0)
  const gameRootPath = resolveNexusDownloadGamePath(payload)
  const manualDependencyArtifactMap = buildManualNexusDependencyArtifactMap(
    payload.manualResolvedDependencies
  )

  for (const dependency of nexusDependencies) {
    const provider =
      dependency?.provider && typeof dependency.provider === 'object' ? dependency.provider : {}
    const dependencyLabel = String(dependency?.name || dependency?.id || '').trim() || '未知项'
    const normalizedProvider = resolveNexusDefaultDependencyProvider(provider, payload)
    validateNexusDefaultDependencyProviderIdentity(normalizedProvider, dependencyLabel)
    const fileResponse =
      toSafeNumber(normalizedProvider?.fileId, 0) > 0
        ? null
        : await getNexusModFiles(
            normalizedProvider.domainName,
            normalizedProvider.modId,
            payload.apiConfig || {}
          )
    const resolvedProvider = resolveNexusDefaultDependencyFile(normalizedProvider, fileResponse, {
      dependencyName: dependencyLabel
    })
    const domainName = String(resolvedProvider?.domainName || '').trim()
    const modId = toSafeNumber(resolvedProvider?.modId, 0)
    const fileId = toSafeNumber(resolvedProvider?.fileId, 0)
    const dependencyFileSize = getNexusDependencyFileSize(resolvedProvider)
    const dependencyVersion = String(resolvedProvider?.version || '').trim()
    const dependencyFileName = String(resolvedProvider?.fileName || '').trim()

    if (!domainName || modId <= 0 || fileId <= 0) {
      throw new Error(
        uiText('ui.defaultDependencyValueHasNoValidNexusFileIdentifier', { value1: (String(dependency?.name || dependency?.id || '').trim() || uiText('ui.unknownItem')) })
      )
    }

    const modInfo = await getCachedNexusModInfo(domainName, modId, payload.apiConfig || {})

    const sourceModKey = buildNexusDependencySourceModKey(resolvedProvider)
    if (installedSourceModKeys.has(sourceModKey)) {
      continue
    }

    const dependencyKey = resolveManualNexusDependencyKey({ domainName, modId, fileId })
    const manualArtifact = dependencyKey ? manualDependencyArtifactMap.get(dependencyKey) : null
    const manualArtifactInfo = manualArtifact
      ? resolveManualNexusDependencyArtifact(manualArtifact)
      : { downloadUrl: '', localFilePath: '' }
    const downloadUrl = manualArtifactInfo.downloadUrl
    const localFilePath = manualArtifactInfo.localFilePath
    const manualDownloadPending = !downloadUrl && !localFilePath

    const dependencyName =
      String(dependency?.name || modInfo?.name || dependency?.id || uiText('ui.nexusDependencyValueVariant2', { value1: (modId) })).trim() ||
      uiText('ui.nexusDependencyValueVariant2', { value1: (modId) })
    const dependencyCover = String(
      modInfo?.pictureUrl || payload.gameBaseInfo?.coverImage || ''
    ).trim()
    const dependencyDescription = resolveNexusDescriptionText(
      dependency?.description,
      dependency?.summary,
      modInfo?.summary,
      modInfo?.description,
      dependency?.notes
    )

    entries.push({
      item: {
        task_name: uiText('ui.defaultDependencyDownloadValue', { value1: (dependencyName) }),
        module: '游戏',
        file_type: 'zip',
        download_url: downloadUrl,
        filePath: localFilePath,
        file_size: dependencyFileSize,
        saveType: 2,
        sourcePlatform: 'nexus',
        sourceType: 'nexus',
        gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
        sourceGameId: String(
          payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || ''
        ).trim(),
        sourceModId: String(modId),
        sourceModKey,
        sourceFileId: String(fileId),
        dedupeKey: [
          'nexus',
          String(payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || '').trim(),
          String(modId),
          String(fileId)
        ]
          .filter(Boolean)
          .join(':'),
        gameRootPath,
        fun: {
          type: 0
        }
      },
      meta: {
        sortIndex,
        nexusAuthorization: {
          gameDomain: domainName,
          modId,
          fileId,
          fileName: dependencyFileName || dependencyName,
          fileSize: dependencyFileSize
        },
        dependencyRef: buildModDependencyReference({
          sourceModKey,
          name: dependencyName,
          modId,
          fileId,
          sourceType: 'nexus_file',
          dependencyRole: 'default_dependency',
          isDefaultDependency: true
        }),
        displayName: dependencyName,
        installPayload: {
          appid: payload.resolvedNexusAppId,
          gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
          gameName,
          clientInstallPath: String(dependency?.install?.target?.path || '.').trim() || '.',
          serverInstallPath: '',
          modId,
          id: fileId,
          modName: dependencyName,
          name: dependencyName,
          description: dependencyDescription,
          summary: dependencyDescription,
          version: dependencyVersion,
          fileSize: dependencyFileSize,
          installType: 0,
          taskType: 0,
          usageType: 1,
          typeId: 1,
          cover: dependencyCover,
          downloadUrl,
          localPath: localFilePath,
          filePath: localFilePath,
          manualDownload: !!manualArtifact || !!localFilePath || manualDownloadPending,
          manualDownloadPending,
          sourceType: 'nexus',
          sourceId: String(modId),
          sourceSlug: domainName,
          sourceGameDomain: domainName,
          sourceModKey,
          profileId: installConfig.profileId,
          ruleProfileId: installConfig.ruleProfileId,
          profileName: installConfig.profileName,
          targetProfileName: installConfig.targetProfileName,
          profileScope: installConfig.profileScope,
          configProfileId: installConfig.configProfileId,
          configProfileName: installConfig.configProfileName,
          installConfigProfileId: installConfig.installConfigProfileId,
          installConfigProfileName: installConfig.installConfigProfileName,
          installConfigProfileScope: installConfig.installConfigProfileScope,
          installConfigSourceType: installConfig.installConfigSourceType,
          ruleVersion: installConfig.ruleVersion,
          cleanupSourceArchiveAfterInstall: true,
          fileMd5: '',
          modVersion: dependencyVersion,
          nexusInstallRule:
            dependency?.install && typeof dependency.install === 'object' ? dependency.install : {},
          metadata: {
            category: 'default_dependency',
            provider,
            resolvedProvider,
            resolved_provider: resolvedProvider,
            dependencyId: String(dependency?.id || '').trim(),
            dependencyKey,
            domainName,
            modId,
            fileId,
            fileName: dependencyFileName,
            description: dependencyDescription,
            summary: dependencyDescription,
            manualDownload: !!manualArtifact || !!localFilePath || manualDownloadPending,
            manualDownloadStatus: manualDownloadPending ? 'manual_pending' : 'ready_to_install',
            ...installConfig
          }
        }
      }
    })
    sortIndex += 1
  }

  return entries
}

export function isUsableNexusDependencyFile(file = {}) {
  const categoryName = String(file?.category_name || file?.categoryName || '')
    .trim()
    .toUpperCase()
  const categoryId = toSafeNumber(file?.category_id || file?.categoryId, 0)
  return categoryName !== 'DELETED' && categoryId !== NEXUS_MOD_FILE_CATEGORY_ID.DELETED
}

function resolveNexusDependencyFileCategoryPriority(file = {}) {
  const categoryName = String(file?.category_name || file?.categoryName || '')
    .trim()
    .toUpperCase()
  const categoryId = toSafeNumber(file?.category_id || file?.categoryId, 0)

  if (categoryName === 'MAIN' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MAIN) {
    return 0
  }
  if (categoryName === 'UPDATE' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.UPDATE) {
    return 1
  }
  if (categoryName === 'OPTIONAL' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OPTIONAL) {
    return 2
  }
  if (
    categoryName === 'MISCELLANEOUS' ||
    categoryName === 'MISC' ||
    categoryId === NEXUS_MOD_FILE_CATEGORY_ID.MISCELLANEOUS
  ) {
    return 3
  }
  if (categoryName === 'OLD_VERSION' || categoryId === NEXUS_MOD_FILE_CATEGORY_ID.OLD_VERSION) {
    return 4
  }

  return 5
}

function isLikelyDeveloperNexusDependencyFile(file = {}) {
  const fileName = String(file?.name || file?.file_name || '')
    .trim()
    .toLowerCase()
  if (!fileName) {
    return false
  }

  return (
    fileName.includes('for developers') ||
    fileName.includes('developer') ||
    fileName.includes('strict mode')
  )
}

export function resolvePreferredNexusDependencyFile(files = []) {
  const safeFiles = (Array.isArray(files) ? files : []).filter((item) =>
    isUsableNexusDependencyFile(item)
  )
  if (!safeFiles.length) {
    return null
  }

  const sortedFiles = [...safeFiles].sort((left, right) => {
    const categoryGap =
      resolveNexusDependencyFileCategoryPriority(left) -
      resolveNexusDependencyFileCategoryPriority(right)
    if (categoryGap !== 0) {
      return categoryGap
    }

    const developerGap =
      Number(isLikelyDeveloperNexusDependencyFile(left)) -
      Number(isLikelyDeveloperNexusDependencyFile(right))
    if (developerGap !== 0) {
      return developerGap
    }

    const uploadedGap =
      toSafeNumber(right?.uploaded_timestamp || right?.uploadedTimestamp, 0) -
      toSafeNumber(left?.uploaded_timestamp || left?.uploadedTimestamp, 0)
    if (uploadedGap !== 0) {
      return uploadedGap
    }

    const primaryGap =
      toSafeNumber(right?.is_primary || right?.isPrimary, 0) -
      toSafeNumber(left?.is_primary || left?.isPrimary, 0)
    if (primaryGap !== 0) {
      return primaryGap
    }

    return (
      toSafeNumber(right?.file_id || right?.fileId, 0) -
      toSafeNumber(left?.file_id || left?.fileId, 0)
    )
  })

  return sortedFiles[0] || null
}

function resolveManualNexusDependencyKey(input = {}) {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const domainName = String(
    input.domainName || input.gameDomain || input.sourceGameDomain || metadata.domainName || ''
  )
    .trim()
    .toLowerCase()
  const modId = toSafeNumber(input.modId || input.mod_id || metadata.modId, 0)
  const fileId = toSafeNumber(input.fileId || input.file_id || metadata.fileId, 0)
  return domainName && modId > 0 && fileId > 0 ? `nexus:${domainName}:${modId}:${fileId}` : ''
}

function buildManualNexusDependencyArtifactMap(list = []) {
  const map = new Map()
  for (const item of Array.isArray(list) ? list : []) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const key =
      String(item?.dependencyKey || metadata.dependencyKey || '').trim() ||
      resolveManualNexusDependencyKey(item)
    if (key) {
      map.set(key, item)
    }
  }
  return map
}

function resolveManualNexusDependencyArtifact(artifact = {}) {
  const metadata = artifact?.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {}
  return {
    downloadUrl: String(
      artifact.downloadUrl || artifact.download_url || metadata.downloadUrl || ''
    ).trim(),
    localFilePath: String(
      artifact.localFilePath ||
        artifact.localPath ||
        artifact.filePath ||
        metadata.localPath ||
        metadata.filePath ||
        ''
    ).trim()
  }
}

export async function buildNexusRequirementBatchEntries(payload = {}) {
  const safeDependencies = Array.isArray(payload.pendingDependencies)
    ? payload.pendingDependencies
    : []
  const nexusDependencies = safeDependencies.filter((item) => {
    return (
      String(item?.dependencyType || item?.sourceType || '')
        .trim()
        .toLowerCase() === 'nexus'
    )
  })

  const entries = []
  let sortIndex = toSafeNumber(payload.startSortIndex, 0)
  const manualDependencyArtifactMap = buildManualNexusDependencyArtifactMap(
    payload.manualResolvedDependencies
  )
  const skippedManualDependencyKeySet = new Set(
    Array.isArray(payload.skippedManualDependencyKeys) ? payload.skippedManualDependencyKeys : []
  )
  const gameRootPath = resolveNexusDownloadGamePath(payload)
  const gameName =
    String(
      payload.currentNexusRule?.gameName ||
        payload.gameBaseInfo?.name ||
        payload.gameBaseInfo?.domainName ||
        ''
    ).trim() || 'Nexus 游戏'
  const installConfig = resolveNexusInstallConfig(payload)

  for (const dependency of nexusDependencies) {
    const domainName = String(
      dependency?.domainName || payload.gameBaseInfo?.domainName || payload.fallbackDomainName || ''
    ).trim()
    const modId = toSafeNumber(dependency?.modId, 0)
    const requestedFileId = toSafeNumber(dependency?.fileId, 0)
    const modInfo = await getCachedNexusModInfo(domainName, modId, payload.apiConfig || {})
    const dependencyName =
      String(
        dependency?.name || dependency?.modName || modInfo?.name || uiText('ui.nexusDependencyValueVariant2', { value1: (modId) })
      ).trim() || uiText('ui.nexusDependencyValueVariant2', { value1: (modId) })
    const dependencyCover = String(modInfo?.pictureUrl || '').trim()
    const dependencyDescription = resolveNexusDescriptionText(
      dependency?.description,
      dependency?.summary,
      modInfo?.summary,
      modInfo?.description,
      dependency?.notes
    )

    if (!domainName || modId <= 0) {
      continue
    }

    const fileResponse = await getNexusModFiles(domainName, modId, payload.apiConfig || {})
    const fileList = Array.isArray(fileResponse?.files) ? fileResponse.files : []
    const targetFile =
      fileList.find((item) => {
        const fileId = toSafeNumber(item?.file_id || item?.fileId, 0)
        return (
          requestedFileId > 0 && fileId === requestedFileId && isUsableNexusDependencyFile(item)
        )
      }) || resolvePreferredNexusDependencyFile(fileList)
    const fileId = toSafeNumber(targetFile?.file_id || targetFile?.fileId, 0)
    if (fileId <= 0) {
      throw new Error(uiText('ui.noUsableMainFileFoundForDependencyValue', { value1: (dependencyName) }))
    }

    const dependencyKey = resolveManualNexusDependencyKey({
      domainName,
      modId,
      fileId
    })
    if (dependencyKey && skippedManualDependencyKeySet.has(dependencyKey)) {
      continue
    }

    const manualArtifact = dependencyKey ? manualDependencyArtifactMap.get(dependencyKey) : null
    const manualArtifactInfo = manualArtifact
      ? resolveManualNexusDependencyArtifact(manualArtifact)
      : { downloadUrl: '', localFilePath: '' }
    const downloadUrl = manualArtifactInfo.downloadUrl
    const localFilePath = manualArtifactInfo.localFilePath
    const manualDownloadPending = !downloadUrl && !localFilePath

    entries.push({
      item: {
        task_name: uiText('ui.nexusDependencyDownloadValueValue', { value1: (dependencyName), value2: (String(targetFile?.name || '未命名文件').trim()) }),
        module: '游戏',
        file_type: 'zip',
        download_url: downloadUrl,
        filePath: localFilePath,
        file_size: Number(targetFile?.size_kb || 0) * 1024,
        saveType: 2,
        sourcePlatform: 'nexus',
        sourceType: 'nexus',
        gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
        sourceGameId: String(
          payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || ''
        ).trim(),
        sourceModId: String(modId),
        sourceModKey: `nexus:${modId}:${fileId}`,
        sourceFileId: String(fileId),
        dedupeKey: [
          'nexus',
          String(payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || '').trim(),
          String(modId),
          String(fileId)
        ]
          .filter(Boolean)
          .join(':'),
        gameRootPath,
        fun: {
          type: 0
        }
      },
      meta: {
        sortIndex,
        nexusAuthorization: {
          gameDomain: domainName,
          modId,
          fileId,
          ...buildNexusFileIdentity(targetFile)
        },
        displayName: dependencyName,
        dependencyRef: buildModDependencyReference({
          sourceModKey: `nexus:${modId}:${fileId}`,
          name: dependencyName,
          modId,
          fileId,
          sourceType: 'nexus',
          dependencyRole: 'nexus_requirement',
          isDefaultDependency: false
        }),
        installPayload: {
          appid: payload.resolvedNexusAppId,
          gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
          nexusGameId: toSafeNumber(payload.currentNexusRule?.nexusGameId, 0),
          gameName,
          clientInstallPath: '.',
          serverInstallPath: '',
          modId,
          id: fileId,
          modName: dependencyName,
          name: String(targetFile?.name || dependencyName).trim(),
          description: dependencyDescription,
          summary: dependencyDescription,
          version: String(targetFile?.version || dependency?.notes || '').trim(),
          fileSize: Number(targetFile?.size_kb || 0) * 1024,
          installType: 0,
          taskType: 0,
          usageType: 1,
          typeId: 0,
          cover: dependencyCover,
          downloadUrl,
          localPath: localFilePath,
          filePath: localFilePath,
          manualDownload: !!manualArtifact || !!localFilePath || manualDownloadPending,
          manualDownloadPending,
          sourceType: 'nexus',
          gameSourceId: String(payload.currentNexusRule?.nexusGameId || '').trim(),
          gameSourceSlug: domainName,
          sourceId: String(modId),
          sourceSlug: domainName,
          sourceGameDomain: domainName,
          sourceModKey: `nexus:${modId}:${fileId}`,
          profileId: installConfig.profileId,
          ruleProfileId: installConfig.ruleProfileId,
          profileName: installConfig.profileName,
          targetProfileName: installConfig.targetProfileName,
          profileScope: installConfig.profileScope,
          configProfileId: installConfig.configProfileId,
          configProfileName: installConfig.configProfileName,
          installConfigProfileId: installConfig.installConfigProfileId,
          installConfigProfileName: installConfig.installConfigProfileName,
          installConfigProfileScope: installConfig.installConfigProfileScope,
          installConfigSourceType: installConfig.installConfigSourceType,
          ruleVersion: installConfig.ruleVersion,
          cleanupSourceArchiveAfterInstall: true,
          fileMd5: '',
          modVersion: String(targetFile?.version || dependency?.notes || '').trim(),
          nexusInstallRule:
            payload.installRule && typeof payload.installRule === 'object'
              ? payload.installRule
              : {},
          metadata: {
            category: 'nexus_requirement',
            dependencyId: String(dependency?.id || '').trim(),
            dependencyNotes: String(dependency?.notes || '').trim(),
            dependencyType: 'nexus',
            dependencyKey,
            fileId,
            description: dependencyDescription,
            summary: dependencyDescription,
            manualDownload: !!manualArtifact || !!localFilePath || manualDownloadPending,
            manualDownloadStatus: manualDownloadPending ? 'manual_pending' : 'ready_to_install',
            ...installConfig
          }
        }
      }
    })
    sortIndex += 1
  }

  return entries
}

export async function buildNexusFileBatchEntry(payload = {}) {
  const mod = payload.mod || {}
  const file = payload.file || {}
  const domainName = String(
    mod?.domainName || payload.gameBaseInfo?.domainName || payload.fallbackDomainName || ''
  ).trim()
  const modId = toSafeNumber(mod?.modId, 0)
  const fileId = toSafeNumber(file?.fileId, 0)
  const localFilePath = String(payload.localFilePath || payload.filePath || '').trim()
  const downloadUrl = String(payload.downloadUrl || payload.download_url || '').trim()
  const manualDownloadPending = !downloadUrl && !localFilePath
  const gameRootPath = resolveNexusDownloadGamePath(payload)
  const gameName =
    String(
      payload.currentNexusRule?.gameName ||
        payload.gameBaseInfo?.name ||
        payload.gameBaseInfo?.domainName ||
        ''
    ).trim() || 'Nexus 游戏'
  const modDescription = resolveNexusDescriptionText(
    mod?.description,
    mod?.summary,
    mod?.raw?.description,
    mod?.raw?.summary,
    file?.description,
    file?.summary,
    file?.changelog
  )
  const installConfig = resolveNexusInstallConfig(payload)
  const sortIndex = toSafeNumber(payload.sortIndex, 10000)

  return {
    item: {
      task_name: uiText('ui.nexusModDownloadValueValue', { value1: (String(mod?.name || '未知模组').trim()), value2: (String(file?.name || '未知文件').trim()) }),
      module: '游戏',
      file_type: 'zip',
      download_url: downloadUrl,
      filePath: localFilePath,
      file_size: Number(file?.raw?.size_kb || 0) * 1024,
      saveType: 2,
      sourcePlatform: 'nexus',
      sourceType: 'nexus',
      gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
      sourceGameId: String(
        payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || ''
      ).trim(),
      sourceModId: String(modId),
      sourceModKey: `nexus:${modId}:${fileId}`,
      sourceFileId: String(fileId),
      dedupeKey: [
        'nexus',
        String(payload.currentNexusRule?.nexusGameId || payload.currentNexusRule?.gameId || '').trim(),
        String(modId),
        String(fileId)
      ]
        .filter(Boolean)
        .join(':'),
      gameRootPath,
      fun: {
        type: 0
      }
    },
    meta: {
      sortIndex,
      nexusAuthorization: {
        gameDomain: domainName,
        modId,
        fileId,
        ...buildNexusFileIdentity(file)
      },
      displayName: String(file?.name || mod?.name || 'Nexus 模组').trim(),
      dependencyRef: buildModDependencyReference({
        sourceModKey: `nexus:${modId}:${fileId}`,
        name: String(mod?.name || file?.name || 'Nexus 模组').trim(),
        modId,
        fileId,
        sourceType: 'nexus',
        dependencyRole: 'main_mod',
        isDefaultDependency: false
      }),
      installPayload: {
        appid: payload.resolvedNexusAppId,
        gameId: toSafeNumber(payload.currentNexusRule?.gameId, 0),
        nexusGameId: toSafeNumber(payload.currentNexusRule?.nexusGameId, 0),
        gameName,
        clientInstallPath: '.',
        serverInstallPath: '',
        modId,
        id: fileId,
        modName: String(mod?.name || '').trim(),
        name: String(file?.name || '').trim(),
        description: modDescription,
        summary: modDescription,
        version: String(file?.version || '').trim(),
        fileSize: Number(file?.raw?.size_kb || 0) * 1024,
        installType: 0,
        taskType: 0,
        usageType: 1,
        typeId: 0,
        cover: String(mod?.pictureUrl || '').trim(),
        downloadUrl,
        localPath: localFilePath,
        filePath: localFilePath,
        manualDownload:
          manualDownloadPending || !!localFilePath || payload.manualDownload === true,
        manualDownloadPending,
        sourceType: 'nexus',
        gameSourceId: String(payload.currentNexusRule?.nexusGameId || '').trim(),
        gameSourceSlug: domainName,
        sourceId: String(modId),
        sourceSlug: domainName,
        sourceGameDomain: domainName,
        sourceModKey: `nexus:${modId}:${fileId}`,
        priorityOrder: sortIndex,
        profileId: installConfig.profileId,
        ruleProfileId: installConfig.ruleProfileId,
        profileName: installConfig.profileName,
        targetProfileName: installConfig.targetProfileName,
        profileScope: installConfig.profileScope,
        configProfileId: installConfig.configProfileId,
        configProfileName: installConfig.configProfileName,
        installConfigProfileId: installConfig.installConfigProfileId,
        installConfigProfileName: installConfig.installConfigProfileName,
        installConfigProfileScope: installConfig.installConfigProfileScope,
        installConfigSourceType: installConfig.installConfigSourceType,
        ruleVersion: installConfig.ruleVersion,
        cleanupSourceArchiveAfterInstall: true,
        fileMd5: '',
        modVersion: String(file?.version || '').trim(),
        dependencies: dedupeDependencyReferenceList(payload.dependencies || []),
        nexusInstallRule:
          payload.installRule && typeof payload.installRule === 'object' ? payload.installRule : {},
        metadata: {
          category: String(file?.rawCategoryName || '').trim(),
          fileId,
          sortIndex,
          description: modDescription,
          summary: modDescription,
          ...installConfig
        }
      }
    }
  }
}

export function isDefaultDependencyInstallPayload(installPayload = {}) {
  const metadata =
    installPayload?.metadata && typeof installPayload.metadata === 'object'
      ? installPayload.metadata
      : {}

  return (
    toSafeNumber(installPayload?.typeId, 0) === 1 ||
    String(metadata?.category || '').trim() === 'default_dependency'
  )
}

export function normalizeNexusModList(list = [], fallbackDomainName = '') {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const modId = toSafeNumber(item?.mod_id || item?.modId, 0)
    const updatedTimestamp = toSafeNumber(item?.updated_timestamp, 0)
    return {
      id: modId || `nexus-mod-${index}`,
      modId,
      domainName: String(item?.domain_name || fallbackDomainName || '').trim(),
      name: String(item?.name || `未命名模组-${index + 1}`),
      summary: String(item?.summary || item?.description || ''),
      pictureUrl: String(item?.picture_url || ''),
      version: String(item?.version || ''),
      author: String(item?.author || item?.uploaded_by || ''),
      modDownloads: toSafeNumber(item?.mod_downloads, 0),
      updatedTimestamp,
      updatedTime: String(item?.updated_time || '')
    }
  })
}

export function formatNumber(value) {
  const number = toSafeNumber(value, 0)
  return number.toLocaleString('zh-CN')
}

export function formatDateTime(value) {
  if (!value) {
    return '--'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }
  return date.toLocaleString('zh-CN')
}

export function formatFileSize(sizeKb = 0) {
  const size = Number(sizeKb || 0)
  if (!Number.isFinite(size) || size <= 0) {
    return '--'
  }
  if (size < 1024) {
    return `${size.toFixed(0)} KB`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} MB`
  }
  return `${(size / (1024 * 1024)).toFixed(2)} GB`
}

export function resolveNexusFileCategoryLabel(item = {}) {
  const categoryId = toSafeNumber(item?.categoryId || item?.category_id, 0)
  const rawCategoryName = String(item?.categoryName || item?.category_name || '').trim()
  const normalizedCategoryName = rawCategoryName.toUpperCase()
  return (
    nexusFileCategoryNameLabelMap[normalizedCategoryName] ||
    rawCategoryName ||
    nexusFileCategoryIdLabelMap[categoryId] ||
    uiText('ui.unknownCategory')
  )
}

export function normalizeNexusModFiles(list = []) {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const fileId = toSafeNumber(item?.file_id || item?.fileId, 0)
    const uploadedTimestamp = toSafeNumber(item?.uploaded_timestamp, 0)
    const description = String(item?.description || item?.changelog || '').trim()
    return {
      id: fileId || `nexus-file-${index}`,
      fileId,
      name: String(item?.name || item?.file_name || `未命名文件-${index + 1}`),
      version: String(item?.version || '').trim(),
      description,
      rawCategoryName: String(item?.categoryName || item?.category_name || '')
        .trim()
        .toUpperCase(),
      categoryLabel: resolveNexusFileCategoryLabel(item),
      sizeText: formatFileSize(item?.size_kb),
      uploadedTimestamp,
      uploadedText: formatDateTime(uploadedTimestamp ? uploadedTimestamp * 1000 : 0),
      isPrimary: toSafeNumber(item?.is_primary, 0) === 1,
      raw: item
    }
  })
}

export function groupNexusFiles(files = []) {
  const fileList = Array.isArray(files) ? files : []
  const groupMap = new Map()

  for (const item of fileList) {
    const groupKey =
      String(item?.rawCategoryName || item?.categoryLabel || 'UNKNOWN').trim() || 'UNKNOWN'
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        key: groupKey,
        label: String(item?.categoryLabel || uiText('ui.unknownCategory')).trim() || uiText('ui.unknownCategory'),
        items: []
      })
    }
    groupMap.get(groupKey).items.push(item)
  }

  return Array.from(groupMap.values()).map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      const timeGap =
        toSafeNumber(b?.uploadedTimestamp || b?.raw?.uploaded_timestamp, 0) -
        toSafeNumber(a?.uploadedTimestamp || a?.raw?.uploaded_timestamp, 0)
      if (timeGap !== 0) {
        return timeGap
      }
      return toSafeNumber(b?.fileId || b?.id, 0) - toSafeNumber(a?.fileId || a?.id, 0)
    })
  })).sort((a, b) => {
    const orderA = nexusFileCategoryOrderMap[a.key] ?? 50
    const orderB = nexusFileCategoryOrderMap[b.key] ?? 50
    if (orderA !== orderB) {
      return orderA - orderB
    }
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN')
  })
}

export function buildNexusRequirementSummaryText(requirementInfo = {}) {
  const totalCount = toSafeNumber(requirementInfo?.totalCount, 0)
  const pendingCount = Array.isArray(requirementInfo?.pendingDependencies)
    ? requirementInfo.pendingDependencies.length
    : 0
  const excludedCount = Array.isArray(requirementInfo?.excludedDependencies)
    ? requirementInfo.excludedDependencies.length
    : 0
  const dlcCount = Array.isArray(requirementInfo?.dlcRequirements)
    ? requirementInfo.dlcRequirements.length
    : 0

  return uiText('ui.dependencyCheckCompleteValueOriginalValueExcludedValuePendingValue', { value1: (totalCount), value2: (excludedCount), value3: (pendingCount), value4: (dlcCount) })
}

export async function inspectNexusModRequirements(payload = {}) {
  const mod = payload.mod || {}
  const domainName = String(
    mod?.domainName || payload.gameBaseInfo?.domainName || payload.fallbackDomainName || ''
  ).trim()
  const modId = toSafeNumber(mod?.modId, 0)

  if (!domainName || modId <= 0) {
    return null
  }

  let requirementError = ''
  let requirementInfo = null
  try {
    requirementInfo = await getNexusModRequirements(
      domainName,
      modId,
      payload.apiConfig || {},
      {
        count: 100
      }
    )
  } catch (error) {
    requirementError = String(error?.message || '依赖查询失败')
    requirementInfo = {
      modId,
      modName: String(mod?.name || '').trim(),
      domainName,
      totalCount: 0,
      dependencies: [],
      nexusDependencies: [],
      externalDependencies: [],
      dlcRequirements: []
    }
  }
  const resolvedRequirementList = resolvePendingRequirementList(requirementInfo, {
    currentNexusRule: payload.currentNexusRule,
    gameBaseInfo: payload.gameBaseInfo,
    domainName,
    installedSourceModKeys: payload.installedSourceModKeys,
    installedNexusModIds: payload.installedNexusModIds
  })
  const defaultDependencies = buildDefaultDependencyPreviewList(payload.currentNexusRule, {
    installedSourceModKeys: payload.installedSourceModKeys
  })

  return {
    modId: requirementInfo?.modId || modId,
    modName: String(requirementInfo?.modName || mod?.name || '').trim(),
    domainName,
    totalCount: toSafeNumber(requirementInfo?.totalCount, 0),
    nexusDependencies: Array.isArray(requirementInfo?.nexusDependencies)
      ? requirementInfo.nexusDependencies
      : [],
    externalDependencies: Array.isArray(requirementInfo?.externalDependencies)
      ? requirementInfo.externalDependencies
      : [],
    dlcRequirements: Array.isArray(requirementInfo?.dlcRequirements)
      ? requirementInfo.dlcRequirements
      : [],
    defaultDependencies,
    pendingDependencies: resolvedRequirementList.pendingDependencies,
    excludedDependencies: resolvedRequirementList.excludedDependencies,
    requirementError,
    rawRequirementInfo: requirementInfo
  }
}

export async function inspectNexusInstallPlan(payload = {}) {
  return await withOperationTimeout(
    invokeIpc('inspectNexusInstallPlan', payload),
    INSTALL_FLOW_CONFIG.install.verifyTimeoutMs,
    '安装规则分析'
  )
}

export async function previewSourceInstall(payload = {}) {
  return await withOperationTimeout(
    invokeIpc('source-install:preview', payload),
    INSTALL_FLOW_CONFIG.install.verifyTimeoutMs,
    '统一安装预案分析'
  )
}

export async function installModsExecuteV2(payload = {}) {
  return await withOperationTimeout(
    invokeIpc('installModsExecuteV2', payload),
    INSTALL_FLOW_CONFIG.install.executeTimeoutMs,
    '模组安装'
  )
}

export async function executeSourceInstall(payload = {}) {
  return await withOperationTimeout(
    invokeIpc('source-install:execute', payload),
    INSTALL_FLOW_CONFIG.install.executeTimeoutMs,
    '统一来源安装'
  )
}

export async function getInstalledModsBySource(payload = {}) {
  return await invokeIpc('getInstalledModsBySource', payload)
}

export async function checkModFileOccupancy(payload = {}) {
  return await invokeIpc('checkModFileOccupancy', payload)
}

export async function toggleModState(payload = {}) {
  return await invokeIpc('toggleModState', payload)
}

export async function uninstallModById(payload = {}) {
  return await invokeIpc('uninstallModById', payload)
}

export async function saveNexusModPriorityOrder(payload = {}) {
  return await invokeIpc('saveModPriorityOrder', {
    ...payload,
    source: 'nexus',
    endpointType: 0
  })
}
