import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import { listPackageRootCandidatesByNodeApi } from '../../api/file/index.js'
import userPath from '../../initPath.js'
import store from '../../storage/store/index.js'
import { resolveInstallLifecycleStepRuntime } from './install-engine/lifecycle/pathBaseResolver.js'
import { normalizeInstallPostInstallSteps } from './install-engine/lifecycle/stepNormalizer.js'
import { buildLifecycleCommandInvocation } from './install-engine/lifecycle/commandInvocation.js'
import { isLifecycleCommandAction } from './install-engine/lifecyclePolicy.js'
import { compileInstallRuleObject } from '../../../shared/installation/install-rule-compiler.js'
import { isPathInside as isSafePathInside } from './install-engine/pathSafety.js'
import {
  normalizeExtensionList,
  resolveFirstDefinedValue
} from './install-engine/contracts.js'
import { normalizeTargetBaseType as normalizeUnifiedTargetBaseType } from './install-engine/targetResolver.js'
import { normalizeResolvedSourceInstallPlan } from './install-engine/planPreviewAdapter.js'
import {
  applyInstallRuleLifecycleSteps as runInstallRuleLifecycleSteps,
  applyInstallRulePostInstallSteps as runInstallRulePostInstallSteps,
  normalizeInstallPostInstallBaseType
} from './install-engine/installLifecycleRunner.js'

// 集中放置来源安装规则识别逻辑，避免 method.js 持续膨胀。
const INSTALL_RULE_PREPARED_ROOT_NAME = '__vertex_install_rule__'
const LEGACY_NEXUS_RULE_PREPARED_ROOT_NAME = '__vertex_nexus_rule__'
const INSTALL_RULE_PREPARED_ROOT_NAMES = new Set([
  INSTALL_RULE_PREPARED_ROOT_NAME,
  LEGACY_NEXUS_RULE_PREPARED_ROOT_NAME
])
export function normalizeSourceDomainName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function logInstallRuleDebug(step = '', detail = {}) {
  const debugEnabled =
    process.env.INSTALL_RULE_DEBUG === '1' ||
    process.env.VERTEX_INSTALL_RULE_DEBUG === '1' ||
    process.env.NEXUS_INSTALL_RULE_DEBUG === '1' ||
    process.env.VERTEX_NEXUS_INSTALL_DEBUG === '1'

  if (!debugEnabled) {
    return
  }

  const safeStep = String(step || '').trim() || 'unknown'
  const payload = detail && typeof detail === 'object' ? detail : { value: detail }

  try {
    console.log(`[INSTALL-RULE] ${safeStep}`)
    console.log(JSON.stringify(payload, null, 2))
  } catch (error) {
    console.log(`[INSTALL-RULE] ${safeStep}`, payload, error)
  }
}

function normalizeRecognitionTextList(value = []) {
  const sourceList = Array.isArray(value) ? value : [value]
  const uniqueList = new Set()

  for (const item of sourceList) {
    if (Array.isArray(item)) {
      for (const nestedItem of item) {
        const text = String(nestedItem ?? '').trim()
        if (text) {
          uniqueList.add(text)
        }
      }
      continue
    }

    const text = String(item ?? '').trim()
    if (text) {
      uniqueList.add(text)
    }
  }

  return [...uniqueList]
}

function collectInstallRuleDependencyList(installRule = {}) {
  const safeRule = installRule && typeof installRule === 'object' ? installRule : {}
  const setupDependencies =
    safeRule?.setup && typeof safeRule.setup === 'object' ? safeRule.setup.default_dependencies : []
  return normalizeRecognitionTextList([
    ...(Array.isArray(safeRule?.default_dependencies) ? safeRule.default_dependencies : []),
    ...(Array.isArray(setupDependencies) ? setupDependencies : [])
  ])
}

function collectInstallRuleTargetPathTags(installRule = {}, matchedPlan = null) {
  const safeRule = installRule && typeof installRule === 'object' ? installRule : {}
  const targetPathSet = new Set()

  const pushTargetPath = (value = '') => {
    const normalizedPath = normalizePathLike(value || '.')
    if (!normalizedPath) {
      return
    }

    const pathParts = normalizedPath.split('/').filter(Boolean)
    if (!pathParts.length) {
      targetPathSet.add('.')
      return
    }

    targetPathSet.add(pathParts.join('/'))
    targetPathSet.add(pathParts[0])
  }

  if (matchedPlan && typeof matchedPlan === 'object') {
    pushTargetPath(matchedPlan?.targetRelativePath || '.')
  }

  if (safeRule?.target && typeof safeRule.target === 'object') {
    pushTargetPath(
      safeRule.target?.path || safeRule.target?.target_path || safeRule.target?.targetPath
    )
  }

  const installRules = Array.isArray(safeRule?.install_rules) ? safeRule.install_rules : []
  for (const item of installRules) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const targetRule = item?.target && typeof item.target === 'object' ? item.target : {}
    pushTargetPath(targetRule?.path || targetRule?.target_path || targetRule?.targetPath)
  }

  return [...targetPathSet]
}

function inferInstallRuleModTypeTags(installRule = {}, matchedPlan = null) {
  const safeRule = installRule && typeof installRule === 'object' ? installRule : {}
  const targetPathTags = collectInstallRuleTargetPathTags(safeRule, matchedPlan).map((item) =>
    String(item || '')
      .trim()
      .toLowerCase()
  )
  const dependencyList = collectInstallRuleDependencyList(safeRule)
  const tagSet = new Set()
  const installRules = Array.isArray(safeRule?.install_rules) ? safeRule.install_rules : []

  const launchAction = String(matchedPlan?.launchAction || '')
    .trim()
    .toLowerCase()
  const hasInjectLikeAction =
    launchAction === 'inject_mod' ||
    installRules.some((item) => {
      const targetRule = item?.target && typeof item.target === 'object' ? item.target : {}
      const action = String(
        targetRule?.launch_action ||
          targetRule?.launchAction ||
          targetRule?.execute_mode ||
          targetRule?.executeMode ||
          ''
      )
        .trim()
        .toLowerCase()
      const showInjectButton = !!(targetRule?.show_inject_button || targetRule?.showInjectButton)
      return action === 'inject_mod' || showInjectButton
    })

  if (targetPathTags.some((item) => item.includes('plugins'))) {
    tagSet.add('插件型')
  }

  if (targetPathTags.some((item) => item.includes('mods'))) {
    tagSet.add('Mod Loader 型')
  }

  if (targetPathTags.some((item) => item.includes('script'))) {
    tagSet.add('脚本型')
  }

  if (
    targetPathTags.some((item) => {
      return (
        item.includes('binaries') ||
        item.includes('game') ||
        item.includes('content') ||
        item.includes('pak') ||
        item === '.'
      )
    })
  ) {
    tagSet.add('普通文件覆盖型')
  }

  if (hasInjectLikeAction || matchedPlan?.showInjectButton) {
    tagSet.add('引擎注入型')
  }

  if (dependencyList.length > 0) {
    tagSet.add('前置依赖型')
  }

  if (
    installRules.length > 1 ||
    installRules.some((item) => {
      const sourceRule = item?.source && typeof item.source === 'object' ? item.source : {}
      const sourceType = String(
        sourceRule?.type || sourceRule?.source_type || sourceRule?.sourceType || ''
      )
        .trim()
        .toLowerCase()
      return ['fixed_subdir', 'folder_containing', 'file_by_extension', 'file_by_pattern'].includes(
        sourceType
      )
    })
  ) {
    tagSet.add('目录结构识别型')
  }

  if (!tagSet.size) {
    tagSet.add('普通文件覆盖型')
  }

  return [...tagSet]
}

function collectInstallRuleGameAliasList(installRule = {}, payload = {}) {
  const safeRule = installRule && typeof installRule === 'object' ? installRule : {}
  const sourceMeta =
    payload?.sourceMeta && typeof payload.sourceMeta === 'object' ? payload.sourceMeta : {}
  const gameRule = safeRule?.game && typeof safeRule.game === 'object' ? safeRule.game : {}

  return normalizeRecognitionTextList([
    payload?.domainName,
    sourceMeta?.sourceSlug,
    payload?.gameKey,
    gameRule?.id,
    gameRule?.key,
    gameRule?.alias,
    gameRule?.game_id,
    gameRule?.game_key,
    gameRule?.game_alias,
    gameRule?.aliases,
    gameRule?.game_aliases,
    gameRule?.source_aliases,
    gameRule?.source_mappings
  ])
}

export function buildInstallRuleRecognitionSummary(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const sourceMeta =
    safePayload?.sourceMeta && typeof safePayload.sourceMeta === 'object'
      ? safePayload.sourceMeta
      : {}
  const installRule = resolveCompiledInstallRule(safePayload?.installRule) || {}
  const matchedPlan =
    safePayload?.matchedPlan && typeof safePayload.matchedPlan === 'object'
      ? safePayload.matchedPlan
      : null
  const inspectMeta =
    safePayload?.inspectMeta && typeof safePayload.inspectMeta === 'object'
      ? safePayload.inspectMeta
      : {}
  const installRuleCount = Array.isArray(installRule?.install_rules)
    ? installRule.install_rules.length
    : 0
  const targetPathTags = collectInstallRuleTargetPathTags(installRule, matchedPlan)
  const dependencyList = collectInstallRuleDependencyList(installRule)
  const gameAliases = collectInstallRuleGameAliasList(installRule, safePayload)
  const sourcePlatform = String(sourceMeta?.source || safePayload?.sourcePlatform || 'nexus')
    .trim()
    .toLowerCase()
  const gameDomainName = normalizeSourceDomainName(
    safePayload?.domainName || sourceMeta?.sourceSlug || safePayload?.gameDomainName
  )

  return {
    source: {
      platform: sourcePlatform || 'nexus',
      sourceId: String(sourceMeta?.sourceId || safePayload?.nexusGameId || '').trim(),
      sourceSlug: String(sourceMeta?.sourceSlug || '').trim(),
      modId: Number(safePayload?.modId || 0),
      fileId: Number(safePayload?.fileId || 0)
    },
    game: {
      matched: !!(
        gameDomainName ||
        Number(safePayload?.nexusGameId || 0) > 0 ||
        gameAliases.length
      ),
      strategy: matchedPlan ? 'source_meta+install_rule' : 'source_meta',
      gameId: Number(safePayload?.gameId || sourceMeta?.gameId || 0),
      nexusGameId: Number(safePayload?.nexusGameId || sourceMeta?.sourceId || 0),
      domainName: gameDomainName,
      aliases: gameAliases
    },
    modType: {
      tags: inferInstallRuleModTypeTags(installRule, matchedPlan),
      dependencyCount: dependencyList.length,
      structureSensitive: installRuleCount > 1
    },
    install: {
      matched: !!matchedPlan,
      matchedRuleId: String(matchedPlan?.ruleId || '').trim(),
      strategy: String(
        matchedPlan?.strategy || (installRuleCount > 0 ? 'json_rule' : 'legacy')
      ).trim(),
      targetRelativePath: normalizePathLike(matchedPlan?.targetRelativePath || '.') || '.',
      targetBaseType: String(matchedPlan?.targetBaseType || 'game').trim() || 'game',
      launchAction: String(matchedPlan?.launchAction || '').trim(),
      isRunnable: !!matchedPlan?.isRunnable,
      showInjectButton: !!matchedPlan?.showInjectButton,
      installRuleCount,
      targetPathTags,
      dependencyNames: dependencyList.slice(0, 5)
    },
    archive: {
      isEncrypted: !!inspectMeta?.isEncrypted,
      fileCount: Number(inspectMeta?.structureSummary?.fileCount || 0),
      directoryCount: Number(inspectMeta?.structureSummary?.directoryCount || 0),
      nodeCount: Number(inspectMeta?.structureSummary?.nodeCount || 0),
      maxDepth: Number(inspectMeta?.structureSummary?.maxDepth || 0),
      hasExecutable: Number(inspectMeta?.run?.type || 0) > 0
    }
  }
}

export function resolveCompiledInstallRule(ruleObject = null) {
  const source =
    ruleObject && typeof ruleObject === 'object' && !Array.isArray(ruleObject) ? ruleObject : null
  if (!source) {
    return null
  }

  return compileInstallRuleObject(source)
}

function buildMatchResultSummary(matchDetail = {}) {
  return {
    matched: !!matchDetail?.matched,
    reason: String(matchDetail?.reason || '').trim(),
    usesAdvancedConditions: !!matchDetail?.usesAdvancedConditions,
    requiredDirCount: Array.isArray(matchDetail?.requiredDirs)
      ? matchDetail.requiredDirs.length
      : 0,
    anyRootDirCount: Array.isArray(matchDetail?.anyRootDirs) ? matchDetail.anyRootDirs.length : 0,
    noneRootDirCount: Array.isArray(matchDetail?.noneRootDirs)
      ? matchDetail.noneRootDirs.length
      : 0,
    requiredFileCount: Array.isArray(matchDetail?.requiredFiles)
      ? matchDetail.requiredFiles.length
      : 0,
    anyRootFileCount: Array.isArray(matchDetail?.anyRootFiles)
      ? matchDetail.anyRootFiles.length
      : 0,
    noneRootFileCount: Array.isArray(matchDetail?.noneRootFiles)
      ? matchDetail.noneRootFiles.length
      : 0,
    anyFileNameCount: Array.isArray(matchDetail?.anyFileNames)
      ? matchDetail.anyFileNames.length
      : 0,
    allFileNameCount: Array.isArray(matchDetail?.allFileNames)
      ? matchDetail.allFileNames.length
      : 0,
    noneFileNameCount: Array.isArray(matchDetail?.noneFileNames)
      ? matchDetail.noneFileNames.length
      : 0,
    hasFilePattern:
      !!String(matchDetail?.hasFilePattern || '').trim() ||
      (Array.isArray(matchDetail?.anyFilePatterns) && matchDetail.anyFilePatterns.length > 0),
    anyFilePatternCount: Array.isArray(matchDetail?.anyFilePatterns)
      ? matchDetail.anyFilePatterns.length
      : 0,
    allFilePatternCount: Array.isArray(matchDetail?.allFilePatterns)
      ? matchDetail.allFilePatterns.length
      : 0,
    anyExtensionCount: Array.isArray(matchDetail?.anyFileExtensions)
      ? matchDetail.anyFileExtensions.length
      : 0,
    allExtensionCount: Array.isArray(matchDetail?.allFileExtensions)
      ? matchDetail.allFileExtensions.length
      : 0,
    noneExtensionCount: Array.isArray(matchDetail?.noneFileExtensions)
      ? matchDetail.noneFileExtensions.length
      : 0,
    nonePatternCount: Array.isArray(matchDetail?.noneFilePatterns)
      ? matchDetail.noneFilePatterns.length
      : 0,
    missingDirCount: Array.isArray(matchDetail?.missingDirs) ? matchDetail.missingDirs.length : 0,
    missingAnyRootDirCount: Array.isArray(matchDetail?.missingAnyRootDirs)
      ? matchDetail.missingAnyRootDirs.length
      : 0,
    missingFileCount: Array.isArray(matchDetail?.missingFiles)
      ? matchDetail.missingFiles.length
      : 0,
    missingAnyRootFileCount: Array.isArray(matchDetail?.missingAnyRootFiles)
      ? matchDetail.missingAnyRootFiles.length
      : 0,
    missingAnyFileNameCount: Array.isArray(matchDetail?.missingAnyFileNames)
      ? matchDetail.missingAnyFileNames.length
      : 0,
    missingAllFileNameCount: Array.isArray(matchDetail?.missingAllFileNames)
      ? matchDetail.missingAllFileNames.length
      : 0,
    missingAnyFilePatternCount: Array.isArray(matchDetail?.missingAnyFilePatterns)
      ? matchDetail.missingAnyFilePatterns.length
      : 0,
    missingAllFilePatternCount: Array.isArray(matchDetail?.missingAllFilePatterns)
      ? matchDetail.missingAllFilePatterns.length
      : 0,
    missingAnyExtensionCount: Array.isArray(matchDetail?.missingAnyFileExtensions)
      ? matchDetail.missingAnyFileExtensions.length
      : 0,
    blockedRootDirCount: Array.isArray(matchDetail?.blockedRootDirs)
      ? matchDetail.blockedRootDirs.length
      : 0,
    blockedRootFileCount: Array.isArray(matchDetail?.blockedRootFiles)
      ? matchDetail.blockedRootFiles.length
      : 0,
    blockedFileNameCount: Array.isArray(matchDetail?.blockedFileNames)
      ? matchDetail.blockedFileNames.length
      : 0,
    blockedPatternCount: Array.isArray(matchDetail?.blockedByNonePatterns)
      ? matchDetail.blockedByNonePatterns.length
      : 0,
    blockedExtensionCount: Array.isArray(matchDetail?.blockedByNoneExtensions)
      ? matchDetail.blockedByNoneExtensions.length
      : 0,
    directDirCount: Array.isArray(matchDetail?.actualDirs) ? matchDetail.actualDirs.length : 0,
    directFileCount: Array.isArray(matchDetail?.actualFiles) ? matchDetail.actualFiles.length : 0,
    recursiveFileCount: Array.isArray(matchDetail?.recursiveFilePaths)
      ? matchDetail.recursiveFilePaths.length
      : 0
  }
}

// 统一标准化预检安装计划，方便预检缓存和正式安装复用同一结构。
export function normalizeResolvedInstallPlan(plan = null) {
  return normalizeResolvedSourceInstallPlan(plan)
}

function normalizePathLike(input = '') {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function toPathParts(relativePath = '') {
  const text = normalizePathLike(relativePath)
  return text ? text.split('/') : []
}

export function isPathInside(parentPath = '', childPath = '') {
  return isSafePathInside(parentPath, childPath)
}

export async function ensureDirectory(pathValue = '') {
  if (!pathValue) return false
  try {
    const stat = await fs.stat(pathValue)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export function normalizeInstallUsageType(value, defaultValue = 1) {
  const safeValue = Number(value)
  return [1, 2, 3, 4].includes(safeValue) ? safeValue : defaultValue
}

export function normalizeInstallFolderName(value = '') {
  const safeValue = String(value || '')
    .trim()
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      if (code < 32 || /[<>:"/\\|?*]/.test(char)) {
        return '_'
      }
      return char
    })
    .join('')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  return safeValue || 'package'
}

export function getDefaultDownloadRootPath(basePath = userPath) {
  const safeBasePath = String(basePath || '').trim()

  try {
    const resolvedBasePath = safeBasePath ? path.resolve(safeBasePath) : path.resolve(userPath)
    const driveRoot = String(path.parse(resolvedBasePath).root || '').trim()
    if (driveRoot) {
      return path.join(driveRoot, 'Vertex', 'dow')
    }
  } catch (error) {
    console.log('安装任务默认下载路径解析失败，回退到用户目录', error)
  }

  return path.join(userPath, 'download')
}

function getConfiguredDownloadRootPath() {
  const configuredDownloadPath = store.getStore('systemConfig.settings.downloadPath')
  if (configuredDownloadPath && typeof configuredDownloadPath === 'string') {
    return path.resolve(configuredDownloadPath)
  }
  return getDefaultDownloadRootPath()
}

function normalizeInstallTargetBaseType(value = '', fallback = 'game') {
  return normalizeUnifiedTargetBaseType(value, fallback)
}

// 用户作用域配置目录必须按当前运行用户动态解析，不能依赖固定用户名。
function getLocalAppDataRootPath() {
  const localAppDataPath = String(process.env.LOCALAPPDATA || '').trim()
  if (localAppDataPath) {
    return path.resolve(localAppDataPath)
  }

  const userProfile = String(process.env.USERPROFILE || '').trim()
  if (userProfile) {
    return path.resolve(path.join(userProfile, 'AppData', 'Local'))
  }

  return path.resolve(path.join(os.homedir(), 'AppData', 'Local'))
}

// Roaming AppData 路径解析，与 Local AppData 对称。
function getRoamingAppDataRootPath() {
  const appDataPath = String(process.env.APPDATA || '').trim()
  if (appDataPath) {
    return path.resolve(appDataPath)
  }

  const userProfile = String(process.env.USERPROFILE || '').trim()
  if (userProfile) {
    return path.resolve(path.join(userProfile, 'AppData', 'Roaming'))
  }

  return path.resolve(path.join(os.homedir(), 'AppData', 'Roaming'))
}

function resolveInstallTargetBoundaryRoot(targetBaseType = 'game', gameRoot = '') {
  const normalizedBaseType = normalizeInstallTargetBaseType(targetBaseType, 'game')

  if (normalizedBaseType === 'download') {
    return {
      targetBaseType: 'download',
      targetBoundaryRoot: getConfiguredDownloadRootPath()
    }
  }

  if (normalizedBaseType === 'local_appdata') {
    return {
      targetBaseType: 'local_appdata',
      targetBoundaryRoot: getLocalAppDataRootPath()
    }
  }

  if (normalizedBaseType === 'roaming_appdata') {
    return {
      targetBaseType: 'roaming_appdata',
      targetBoundaryRoot: getRoamingAppDataRootPath()
    }
  }

  return {
    targetBaseType: 'game',
    targetBoundaryRoot: path.resolve(String(gameRoot || ''))
  }
}

function normalizeLaunchArgumentList(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()
  return text ? [text] : []
}

function normalizeNexusLaunchAction(value = '', defaultValue = 'inject_mod') {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()

  if (!text) {
    return defaultValue
  }

  if (['inject_mod', 'inject', 'enable_exe'].includes(text)) {
    return 'inject_mod'
  }
  if (
    ['default_execute', 'default', 'default_launch', 'auto_execute', 'auto_launch'].includes(text)
  ) {
    return 'default_execute'
  }
  if (['manual_execute', 'manual', 'run_tool', 'manual_launch'].includes(text)) {
    return 'manual_execute'
  }

  return defaultValue
}

function getInstallRuleSourceType(sourceRule = {}) {
  return String(
    resolveFirstDefinedValue(sourceRule?.type, sourceRule?.source_type, sourceRule?.sourceType) ||
      'package_root'
  )
    .trim()
    .toLowerCase()
}

function resolveInstallRuleEnableExecutableTarget({
  targetRule = {},
  gameRoot = '',
  targetRoot = '',
  targetBaseType = 'game'
}) {
  const rawExecutablePath = String(
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
  if (!rawExecutablePath) {
    return {
      enableExecutablePath: '',
      enableExecutableBaseType: '',
      launchAction: '',
      showInjectButton: false,
      launchArgs: []
    }
  }

  const executableRelativePath = normalizePathLike(rawExecutablePath)
  if (!executableRelativePath) {
    return {
      enableExecutablePath: '',
      enableExecutableBaseType: '',
      launchAction: '',
      showInjectButton: false,
      launchArgs: []
    }
  }

  const executableBaseType = normalizeInstallPostInstallBaseType(
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
  const launchAction = normalizeNexusLaunchAction(
    resolveFirstDefinedValue(
      targetRule?.launch_action,
      targetRule?.launchAction,
      targetRule?.execute_mode,
      targetRule?.executeMode,
      targetRule?.executable_action,
      targetRule?.executableAction
    ),
    'inject_mod'
  )
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
  const showInjectButton =
    normalizeOptionalBoolean(
      resolveFirstDefinedValue(
        targetRule?.show_inject_button,
        targetRule?.showInjectButton,
        targetRule?.inject_button,
        targetRule?.injectButton
      )
    ) === true

  let baseRoot = ''
  let boundaryRoot = ''
  if (executableBaseType === 'target') {
    baseRoot = path.resolve(String(targetRoot || ''))
    boundaryRoot = baseRoot
  } else {
    const resolvedBoundary = resolveInstallTargetBoundaryRoot(
      executableBaseType === 'target' ? targetBaseType : executableBaseType,
      gameRoot
    )
    baseRoot = resolvedBoundary.targetBoundaryRoot
    boundaryRoot = resolvedBoundary.targetBoundaryRoot
  }

  const resolvedExecutablePath = path.resolve(baseRoot, ...toPathParts(executableRelativePath))
  if (!isPathInside(boundaryRoot, resolvedExecutablePath)) {
    throw new Error('识别到不安全的模组启用 EXE 路径，已阻止安装')
  }

  return {
    enableExecutablePath: resolvedExecutablePath,
    enableExecutableBaseType: executableBaseType,
    launchAction,
    showInjectButton,
    launchArgs
  }
}

// 统一把 target 规则解析成最终绝对目录，并保留边界校验所需的信息。
function resolveInstallTargetLocation({ targetRule = {}, gameRoot = '', packageFolderName = '' }) {
  const safeGameRoot = path.resolve(String(gameRoot || ''))
  const targetType = String(
    resolveFirstDefinedValue(targetRule?.type, targetRule?.target_type, targetRule?.targetType) ||
      'game_root'
  )
    .trim()
    .toLowerCase()
  const requestedTargetBaseType = normalizeInstallTargetBaseType(
    resolveFirstDefinedValue(
      targetRule?.base,
      targetRule?.base_type,
      targetRule?.baseType,
      targetRule?.scope,
      targetRule?.scope_type,
      targetRule?.scopeType,
      targetRule?.user_scope,
      targetRule?.userScope
    ),
    'game'
  )
  const targetPathText = normalizePathLike(
    resolveFirstDefinedValue(targetRule?.path, targetRule?.target_path, targetRule?.targetPath) ||
      ''
  )
  const appendPackageDir =
    normalizeOptionalBoolean(
      targetRule?.append_package_dir ??
        targetRule?.appendPackageDir ??
        targetRule?.append_archive_dir ??
        targetRule?.appendArchiveDir
    ) !== false

  let targetRoot = safeGameRoot
  let targetRelativePath = '.'
  let targetBoundaryRoot = safeGameRoot
  let targetBaseType = 'game'

  if (targetType === 'download_relative') {
    const safeDownloadRoot = getConfiguredDownloadRootPath()
    const relativeParts =
      targetPathText && targetPathText !== '.' ? toPathParts(targetPathText) : []
    if (appendPackageDir) {
      relativeParts.push(normalizeInstallFolderName(packageFolderName))
    }
    targetBoundaryRoot = safeDownloadRoot
    targetBaseType = 'download'
    targetRelativePath = relativeParts.length ? normalizePathLike(relativeParts.join('/')) : '.'
    targetRoot = relativeParts.length
      ? path.resolve(safeDownloadRoot, ...relativeParts)
      : safeDownloadRoot
  } else if (targetType === 'user_relative') {
    if (!targetPathText) {
      throw new Error('用户作用域安装规则缺少 target.path，无法确定安装目标目录')
    }

    const resolvedBoundary = resolveInstallTargetBoundaryRoot(
      requestedTargetBaseType === 'game' ? 'local_appdata' : requestedTargetBaseType,
      safeGameRoot
    )
    targetBaseType = resolvedBoundary.targetBaseType
    targetBoundaryRoot = resolvedBoundary.targetBoundaryRoot
    targetRelativePath = targetPathText
    targetRoot = path.resolve(targetBoundaryRoot, ...toPathParts(targetPathText))
  } else if (targetType === 'game_relative') {
    if (!targetPathText) {
      throw new Error('安装规则缺少 target.path，无法确定安装目标目录')
    }
    targetRelativePath = targetPathText
    targetRoot = path.resolve(safeGameRoot, ...toPathParts(targetPathText))
  } else if (targetPathText && targetPathText !== '.') {
    targetRelativePath = targetPathText
    targetRoot = path.resolve(safeGameRoot, ...toPathParts(targetPathText))
  }

  if (!isPathInside(targetBoundaryRoot, targetRoot)) {
    throw new Error('识别到不安全的安装目标路径，已阻止安装')
  }

  const defaultUsageType = targetBaseType === 'download' ? 2 : 1
  const usageType = normalizeInstallUsageType(
    targetRule?.usageType ?? targetRule?.usage_type,
    defaultUsageType
  )
  const isRunnable =
    normalizeOptionalBoolean(
      targetRule?.mark_runnable ??
        targetRule?.markRunnable ??
        targetRule?.runnable ??
        targetRule?.launchable
    ) === true ||
    usageType === 2 ||
    usageType === 4
  const enableExecutableTarget = resolveInstallRuleEnableExecutableTarget({
    targetRule,
    gameRoot: safeGameRoot,
    targetRoot,
    targetBaseType
  })

  return {
    targetType,
    targetRoot,
    targetRelativePath,
    targetBaseType,
    usageType,
    isRunnable,
    launchAction: enableExecutableTarget.launchAction,
    showInjectButton: enableExecutableTarget.showInjectButton,
    enableExecutablePath: enableExecutableTarget.enableExecutablePath,
    enableExecutableBaseType: enableExecutableTarget.enableExecutableBaseType,
    launchArgs: enableExecutableTarget.launchArgs
  }
}

async function listTopLevelEntries(dirPath = '') {
  try {
    const names = await fs.readdir(dirPath)
    const result = []
    for (const name of names) {
      const fullPath = path.join(dirPath, name)
      let isDirectory = false
      try {
        const stat = await fs.stat(fullPath)
        isDirectory = stat.isDirectory()
      } catch {
        isDirectory = false
      }
      result.push({
        name,
        lowerName: String(name || '').toLowerCase(),
        fullPath,
        isDirectory
      })
    }
    return result
  } catch {
    return []
  }
}

function normalizeRelativeRulePath(input = '') {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/g, '')
    .replace(/^\/+|\/+$/g, '')
}

function escapeRegExpText(input = '') {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildGlobPatternRegExp(pattern = '') {
  const normalized = normalizeRelativeRulePath(pattern)
  if (!normalized) {
    return /^$/
  }

  let regexpText = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]
    const next = normalized[index + 1]

    if (current === '*') {
      if (next === '*') {
        const nextNext = normalized[index + 2]
        if (nextNext === '/') {
          regexpText += '(?:.*/)?'
          index += 2
          continue
        }
        regexpText += '.*'
        index += 1
        continue
      }

      regexpText += '[^/]*'
      continue
    }

    if (current === '?') {
      regexpText += '[^/]'
      continue
    }

    regexpText += escapeRegExpText(current)
  }

  regexpText += '$'
  return new RegExp(regexpText, 'i')
}

function matchGlobPattern(pattern = '', targetPath = '') {
  const normalizedTargetPath = normalizeRelativeRulePath(targetPath)
  if (!normalizedTargetPath) {
    return false
  }
  return buildGlobPatternRegExp(pattern).test(normalizedTargetPath)
}

function matchAnyGlobPattern(patternList = [], targetPath = '') {
  const safePatternList = Array.isArray(patternList) ? patternList : []
  return safePatternList.some((pattern) => matchGlobPattern(pattern, targetPath))
}

function toRuleArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === undefined || value === null) {
    return []
  }

  return [value]
}

function normalizeRuleTextList(list = [], options = {}) {
  const lowerCase = options?.lowerCase !== false
  const pathLike = !!options?.pathLike
  const result = []
  const seen = new Set()

  for (const item of toRuleArray(list)) {
    let text = pathLike ? normalizeRelativeRulePath(item) : String(item ?? '').trim()
    if (!text) {
      continue
    }

    if (lowerCase) {
      text = text.toLowerCase()
    }

    const cacheKey = lowerCase ? text : text.toLowerCase()
    if (seen.has(cacheKey)) {
      continue
    }

    seen.add(cacheKey)
    result.push(text)
  }

  return result
}

// 统一把 match 条件归一化到现有引擎内部结构，避免匹配阶段散落字段分支。
// 统一整理 match 字段，后续匹配阶段只消费这一种结构。
function normalizeInstallMatchRule(matchRule = {}) {
  const rule = matchRule && typeof matchRule === 'object' ? matchRule : {}
  const anyFilePatterns = normalizeRuleTextList(
    [
      ...toRuleArray(resolveFirstDefinedValue(rule.any_file_patterns, rule.anyFilePatterns)),
      ...toRuleArray(resolveFirstDefinedValue(rule.has_file_pattern, rule.hasFilePattern))
    ],
    {
      lowerCase: false,
      pathLike: true
    }
  )

  return {
    requiredDirs: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.root_has_dirs,
        rule.rootHasDirs,
        rule.all_root_dirs,
        rule.allRootDirs,
        rule.required_dirs,
        rule.requiredDirs
      )
    ),
    anyRootDirs: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.any_root_dirs,
        rule.anyRootDirs,
        rule.root_has_any_dirs,
        rule.rootHasAnyDirs
      )
    ),
    noneRootDirs: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.none_root_dirs,
        rule.noneRootDirs,
        rule.root_has_no_dirs,
        rule.rootHasNoDirs
      )
    ),
    requiredFiles: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.root_has_files,
        rule.rootHasFiles,
        rule.all_root_files,
        rule.allRootFiles,
        rule.required_files,
        rule.requiredFiles
      )
    ),
    anyRootFiles: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.any_root_files,
        rule.anyRootFiles,
        rule.root_has_any_files,
        rule.rootHasAnyFiles
      )
    ),
    noneRootFiles: normalizeRuleTextList(
      resolveFirstDefinedValue(
        rule.none_root_files,
        rule.noneRootFiles,
        rule.root_has_no_files,
        rule.rootHasNoFiles
      )
    ),
    anyFileNames: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.any_file_names, rule.anyFileNames)
    ),
    allFileNames: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.all_file_names, rule.allFileNames)
    ),
    noneFileNames: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.none_file_names, rule.noneFileNames)
    ),
    anyFilePatterns,
    allFilePatterns: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.all_file_patterns, rule.allFilePatterns),
      {
        lowerCase: false,
        pathLike: true
      }
    ),
    anyFileExtensions: normalizeExtensionList(
      resolveFirstDefinedValue(rule.any_file_extensions, rule.anyFileExtensions)
    ),
    allFileExtensions: normalizeExtensionList(
      resolveFirstDefinedValue(rule.all_file_extensions, rule.allFileExtensions)
    ),
    noneFileExtensions: normalizeExtensionList(
      resolveFirstDefinedValue(rule.none_file_extensions, rule.noneFileExtensions)
    ),
    noneFilePatterns: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.none_file_patterns, rule.noneFilePatterns),
      {
        lowerCase: false,
        pathLike: true
      }
    ),
    // 递归目录路径 glob 匹配条件
    anyDirPatterns: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.any_dir_patterns, rule.anyDirPatterns),
      {
        lowerCase: false,
        pathLike: true
      }
    ),
    allDirPatterns: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.all_dir_patterns, rule.allDirPatterns),
      {
        lowerCase: false,
        pathLike: true
      }
    ),
    noneDirPatterns: normalizeRuleTextList(
      resolveFirstDefinedValue(rule.none_dir_patterns, rule.noneDirPatterns),
      {
        lowerCase: false,
        pathLike: true
      }
    ),
    // 递归文件数量范围条件
    minFileCount: normalizeOptionalPositiveInteger(
      resolveFirstDefinedValue(rule.min_file_count, rule.minFileCount)
    ),
    maxFileCount: normalizeOptionalPositiveInteger(
      resolveFirstDefinedValue(rule.max_file_count, rule.maxFileCount)
    ),
    // 顶层条目数量范围条件
    rootEntryCountMin: normalizeOptionalPositiveInteger(
      resolveFirstDefinedValue(rule.root_entry_count_min, rule.rootEntryCountMin)
    ),
    rootEntryCountMax: normalizeOptionalPositiveInteger(
      resolveFirstDefinedValue(rule.root_entry_count_max, rule.rootEntryCountMax)
    )
  }
}

export async function applyInstallRuleLifecycleSteps(payload = {}) {
  await runInstallRuleLifecycleSteps(payload, {
    resolveInstallTargetBoundaryRoot,
    logInstallRuleDebug
  })
}

export function previewInstallLifecycleCommands(steps, payload) {
  return normalizeInstallPostInstallSteps(steps).filter((step) => isLifecycleCommandAction(step.action)).map((step) => {
    const runtime = resolveInstallLifecycleStepRuntime(step, payload, { resolveInstallTargetBoundaryRoot })
    const invocation = buildLifecycleCommandInvocation(runtime)
    return { action: runtime.action, path: runtime.resolvedTargetPath, args: invocation.launchArgs,
      executable: invocation.launchTarget, workingDirectory: path.dirname(runtime.resolvedTargetPath),
      repeat: runtime.repeat, requiresConsole: runtime.requiresConsole }
  })
}

export async function applyInstallRulePostInstallSteps(payload = {}) {
  await runInstallRulePostInstallSteps(payload, {
    resolveInstallTargetBoundaryRoot,
    logInstallRuleDebug
  })
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

// 把可选整数值归一化为正整数或 null，用于 min_file_count / max_file_count 等数量范围条件。
function normalizeOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null
  }

  return Math.floor(numericValue)
}

function hasAdvancedInstallMatchCondition(matchRule = {}) {
  const rule = normalizeInstallMatchRule(matchRule)
  return (
    rule.anyRootDirs.length > 0 ||
    rule.noneRootDirs.length > 0 ||
    rule.anyRootFiles.length > 0 ||
    rule.noneRootFiles.length > 0 ||
    rule.anyFileNames.length > 0 ||
    rule.allFileNames.length > 0 ||
    rule.noneFileNames.length > 0 ||
    rule.anyFilePatterns.length > 0 ||
    rule.allFilePatterns.length > 0 ||
    rule.anyFileExtensions.length > 0 ||
    rule.allFileExtensions.length > 0 ||
    rule.noneFileExtensions.length > 0 ||
    rule.noneFilePatterns.length > 0 ||
    rule.anyDirPatterns.length > 0 ||
    rule.allDirPatterns.length > 0 ||
    rule.noneDirPatterns.length > 0 ||
    rule.minFileCount !== null ||
    rule.maxFileCount !== null ||
    rule.rootEntryCountMin !== null ||
    rule.rootEntryCountMax !== null
  )
}

function isInstallRulePreparedRootName(value = '') {
  return INSTALL_RULE_PREPARED_ROOT_NAMES.has(String(value || '').trim())
}

function isPreparedRuleRelativePath(relativePath = '') {
  const safeRelativePath = normalizeRelativeRulePath(relativePath)
  return [...INSTALL_RULE_PREPARED_ROOT_NAMES].some(
    (rootName) => safeRelativePath === rootName || safeRelativePath.startsWith(`${rootName}/`)
  )
}

function isPreparedRuleCandidate(stagingPath = '', candidate = {}) {
  const packageRoot = normalizeRelativeRulePath(candidate?.packageRoot || '')
  if (isPreparedRuleRelativePath(packageRoot)) {
    return true
  }

  const rootPath = String(candidate?.rootPath || '').trim()
  if (!rootPath) {
    return false
  }

  return isPreparedRuleRelativePath(
    path.relative(path.resolve(stagingPath), path.resolve(rootPath))
  )
}

export async function collectDirectorySnapshot(dirPath = '', cache = new Map()) {
  const safeDirPath = path.resolve(String(dirPath || ''))
  if (cache.has(safeDirPath)) {
    return cache.get(safeDirPath)
  }

  const directEntries = await listTopLevelEntries(safeDirPath)
  const filteredDirectEntries = directEntries.filter(
    (item) => !isInstallRulePreparedRootName(item.name)
  )
  const directDirs = []
  const directFiles = []
  const allDirs = []
  const allFiles = []

  for (const entry of filteredDirectEntries) {
    if (entry.isDirectory) {
      const dirRecord = {
        ...entry,
        relativePath: normalizeRelativeRulePath(entry.name)
      }
      directDirs.push(dirRecord)
      allDirs.push(dirRecord)

      const childSnapshot = await collectDirectorySnapshot(entry.fullPath, cache)
      for (const childDir of childSnapshot.allDirs) {
        allDirs.push({
          ...childDir,
          relativePath: normalizeRelativeRulePath(`${entry.name}/${childDir.relativePath}`)
        })
      }
      for (const childFile of childSnapshot.allFiles) {
        allFiles.push({
          ...childFile,
          relativePath: normalizeRelativeRulePath(`${entry.name}/${childFile.relativePath}`)
        })
      }
      continue
    }

    const fileRecord = {
      ...entry,
      relativePath: normalizeRelativeRulePath(entry.name),
      ext: path.extname(entry.name || '').toLowerCase()
    }
    directFiles.push(fileRecord)
    allFiles.push(fileRecord)
  }

  const snapshot = {
    dirPath: safeDirPath,
    directEntries: filteredDirectEntries,
    directDirs,
    directFiles,
    allDirs,
    allFiles
  }
  cache.set(safeDirPath, snapshot)
  return snapshot
}

function orderPackageRootCandidatesByRule(candidates = [], matchRule = {}, sourceRule = {}) {
  const safeCandidates = Array.isArray(candidates) ? [...candidates] : []
  const sourceType = getInstallRuleSourceType(sourceRule)
  const preferDeepCandidate =
    hasAdvancedInstallMatchCondition(matchRule) ||
    sourceType === 'folder_containing' ||
    sourceType === 'file_by_extension'

  safeCandidates.sort((left, right) => {
    if (preferDeepCandidate) {
      if (left.depth !== right.depth) {
        return right.depth - left.depth
      }
    } else if (left.depth !== right.depth) {
      return left.depth - right.depth
    }

    return String(left.packageRoot || '').localeCompare(String(right.packageRoot || ''), 'zh-CN')
  })

  return safeCandidates
}

async function listPackageRootCandidates(stagingPath = '', maxDepth = Number.POSITIVE_INFINITY) {
  const safeStagingPath = path.resolve(String(stagingPath || ''))
  try {
    const nativeCandidates = await listPackageRootCandidatesByNodeApi(stagingPath, maxDepth)
    if (Array.isArray(nativeCandidates)) {
      return nativeCandidates
        .map((item) => ({
          rootPath: path.resolve(String(item?.rootPath || '')),
          packageRoot: normalizeRelativeRulePath(item?.packageRoot || ''),
          depth: Number(item?.depth || 0)
        }))
        .filter((item) => !isPreparedRuleCandidate(safeStagingPath, item))
    }
  } catch (error) {
    console.warn('原生包根目录枚举失败，回退到 JS 实现', error)
  }

  const safeMaxDepth = Number.isFinite(Number(maxDepth))
    ? Math.max(Number(maxDepth), 0)
    : Number.POSITIVE_INFINITY
  const queue = [
    {
      rootPath: safeStagingPath,
      packageRoot: '',
      depth: 0
    }
  ]
  const result = []
  const visited = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    const rootPath = path.resolve(String(current?.rootPath || ''))
    const depth = Number(current?.depth || 0)
    const cacheKey = rootPath.toLowerCase()

    if (!rootPath || visited.has(cacheKey)) {
      continue
    }

    visited.add(cacheKey)
    result.push({
      rootPath,
      packageRoot: normalizeRelativeRulePath(current?.packageRoot || ''),
      depth
    })

    if (depth >= safeMaxDepth) {
      continue
    }

    const entries = await listTopLevelEntries(rootPath)
    for (const entry of entries) {
      if (!entry?.isDirectory || isInstallRulePreparedRootName(entry.name)) {
        continue
      }

      const childPackageRoot = normalizeRelativeRulePath(
        current?.packageRoot ? `${current.packageRoot}/${entry.name}` : entry.name
      )
      queue.push({
        rootPath: entry.fullPath,
        packageRoot: childPackageRoot,
        depth: depth + 1
      })
    }
  }

  return result
}

// 对单个候选包根做规则匹配，返回命中明细供后续选源和日志使用。
async function matchInstallRuleAtPackageRoot(
  packageRoot = '',
  matchRule = {},
  snapshotCache = new Map()
) {
  const rule = normalizeInstallMatchRule(matchRule)
  const requiredDirs = rule.requiredDirs
  const anyRootDirs = rule.anyRootDirs
  const noneRootDirs = rule.noneRootDirs
  const requiredFiles = rule.requiredFiles
  const anyRootFiles = rule.anyRootFiles
  const noneRootFiles = rule.noneRootFiles
  const anyFileNames = rule.anyFileNames
  const allFileNames = rule.allFileNames
  const noneFileNames = rule.noneFileNames
  const anyFilePatterns = rule.anyFilePatterns
  const allFilePatterns = rule.allFilePatterns
  const hasFilePattern = anyFilePatterns[0] || ''
  const anyFileExtensions = rule.anyFileExtensions
  const allFileExtensions = rule.allFileExtensions
  const noneFileExtensions = rule.noneFileExtensions
  const noneFilePatterns = rule.noneFilePatterns
  const anyDirPatterns = rule.anyDirPatterns
  const allDirPatterns = rule.allDirPatterns
  const noneDirPatterns = rule.noneDirPatterns
  const minFileCount = rule.minFileCount
  const maxFileCount = rule.maxFileCount
  const rootEntryCountMin = rule.rootEntryCountMin
  const rootEntryCountMax = rule.rootEntryCountMax
  const hasAnyCondition =
    requiredDirs.length > 0 ||
    anyRootDirs.length > 0 ||
    noneRootDirs.length > 0 ||
    requiredFiles.length > 0 ||
    anyRootFiles.length > 0 ||
    noneRootFiles.length > 0 ||
    anyFileNames.length > 0 ||
    allFileNames.length > 0 ||
    noneFileNames.length > 0 ||
    anyFilePatterns.length > 0 ||
    allFilePatterns.length > 0 ||
    anyFileExtensions.length > 0 ||
    allFileExtensions.length > 0 ||
    noneFileExtensions.length > 0 ||
    noneFilePatterns.length > 0 ||
    anyDirPatterns.length > 0 ||
    allDirPatterns.length > 0 ||
    noneDirPatterns.length > 0 ||
    minFileCount !== null ||
    maxFileCount !== null ||
    rootEntryCountMin !== null ||
    rootEntryCountMax !== null

  if (!hasAnyCondition) {
    return {
      matched: false,
      reason: 'empty_match_rule',
      requiredDirs,
      anyRootDirs,
      noneRootDirs,
      requiredFiles,
      anyRootFiles,
      noneRootFiles,
      anyFileNames,
      allFileNames,
      noneFileNames,
      hasFilePattern,
      anyFilePatterns,
      allFilePatterns,
      anyFileExtensions,
      allFileExtensions,
      noneFileExtensions,
      noneFilePatterns,
      actualDirs: [],
      actualFiles: [],
      actualEntryNames: [],
      recursiveFilePaths: [],
      missingDirs: requiredDirs,
      missingAnyRootDirs: anyRootDirs,
      missingFiles: requiredFiles,
      missingAnyRootFiles: anyRootFiles,
      missingAnyFileNames: anyFileNames,
      missingAllFileNames: allFileNames,
      missingAnyFilePatterns: anyFilePatterns,
      missingAllFilePatterns: allFilePatterns,
      missingAnyFileExtensions: anyFileExtensions,
      hasUnsupportedFilePattern: anyFilePatterns.length > 0,
      blockedRootDirs: [],
      blockedRootFiles: [],
      blockedFileNames: [],
      blockedByNonePatterns: [],
      blockedByNoneExtensions: []
    }
  }

  const entries = await listTopLevelEntries(packageRoot)
  if (!entries.length) {
    return {
      matched: false,
      reason: 'package_root_empty',
      requiredDirs,
      anyRootDirs,
      noneRootDirs,
      requiredFiles,
      anyRootFiles,
      noneRootFiles,
      anyFileNames,
      allFileNames,
      noneFileNames,
      hasFilePattern,
      anyFilePatterns,
      allFilePatterns,
      anyFileExtensions,
      allFileExtensions,
      noneFileExtensions,
      noneFilePatterns,
      actualDirs: [],
      actualFiles: [],
      actualEntryNames: [],
      recursiveFilePaths: [],
      missingDirs: requiredDirs,
      missingAnyRootDirs: anyRootDirs,
      missingFiles: requiredFiles,
      missingAnyRootFiles: anyRootFiles,
      missingAnyFileNames: anyFileNames,
      missingAllFileNames: allFileNames,
      missingAnyFilePatterns: anyFilePatterns,
      missingAllFilePatterns: allFilePatterns,
      missingAnyFileExtensions: anyFileExtensions,
      hasUnsupportedFilePattern: anyFilePatterns.length > 0,
      blockedRootDirs: [],
      blockedRootFiles: [],
      blockedFileNames: [],
      blockedByNonePatterns: [],
      blockedByNoneExtensions: []
    }
  }

  const actualDirs = entries.filter((item) => item.isDirectory).map((item) => item.lowerName)
  const actualFiles = entries
    .filter((item) => !item.isDirectory)
    .map((item) =>
      String(item.name || '')
        .trim()
        .toLowerCase()
    )
  const actualEntryNames = entries.map((item) =>
    String(item.name || '')
      .trim()
      .toLowerCase()
  )
  const dirNameSet = new Set(actualDirs)
  const fileNameSet = new Set(actualFiles)
  const entryNameSet = new Set(actualEntryNames)
  const hasAllDirs = requiredDirs.every((item) => dirNameSet.has(item))
  const hasAnyRootDir = !anyRootDirs.length || anyRootDirs.some((item) => dirNameSet.has(item))
  const blockedRootDirs = noneRootDirs.filter((item) => dirNameSet.has(item))
  const hasNoBlockedRootDir = blockedRootDirs.length === 0
  const hasAllFiles = requiredFiles.every((item) => fileNameSet.has(item))
  const hasAnyRootFile = !anyRootFiles.length || anyRootFiles.some((item) => fileNameSet.has(item))
  const blockedRootFiles = noneRootFiles.filter((item) => fileNameSet.has(item))
  const hasNoBlockedRootFile = blockedRootFiles.length === 0
  const hasAnyNamedEntry =
    !anyFileNames.length || anyFileNames.some((item) => entryNameSet.has(item))
  const hasAllNamedEntry = allFileNames.every((item) => entryNameSet.has(item))
  const blockedFileNames = noneFileNames.filter((item) => entryNameSet.has(item))
  const hasNoBlockedFileName = blockedFileNames.length === 0
  const usesAdvancedConditions = hasAdvancedInstallMatchCondition(rule)
  const missingDirs = requiredDirs.filter((item) => !dirNameSet.has(item))
  const missingAnyRootDirs = anyRootDirs.length > 0 && !hasAnyRootDir ? [...anyRootDirs] : []
  const missingFiles = requiredFiles.filter((item) => !fileNameSet.has(item))
  const missingAnyRootFiles = anyRootFiles.length > 0 && !hasAnyRootFile ? [...anyRootFiles] : []
  const missingAnyFileNames = anyFileNames.length > 0 && !hasAnyNamedEntry ? [...anyFileNames] : []
  const missingAllFileNames = allFileNames.filter((item) => !entryNameSet.has(item))

  // 顶层条目数量范围检查（不需要递归扫描）
  const topLevelEntryCount = entries.length
  const meetsRootEntryCountMin =
    rootEntryCountMin === null || topLevelEntryCount >= rootEntryCountMin
  const meetsRootEntryCountMax =
    rootEntryCountMax === null || topLevelEntryCount <= rootEntryCountMax

  if (
    !hasAllDirs ||
    !hasAnyRootDir ||
    !hasNoBlockedRootDir ||
    !hasAllFiles ||
    !hasAnyRootFile ||
    !hasNoBlockedRootFile ||
    !hasAnyNamedEntry ||
    !hasAllNamedEntry ||
    !hasNoBlockedFileName ||
    !meetsRootEntryCountMin ||
    !meetsRootEntryCountMax
  ) {
    return {
      matched: false,
      reason: 'missing_required_entries',
      requiredDirs,
      anyRootDirs,
      noneRootDirs,
      requiredFiles,
      anyRootFiles,
      noneRootFiles,
      anyFileNames,
      allFileNames,
      noneFileNames,
      hasFilePattern,
      anyFilePatterns,
      allFilePatterns,
      anyFileExtensions,
      allFileExtensions,
      noneFileExtensions,
      noneFilePatterns,
      actualDirs,
      actualFiles,
      actualEntryNames,
      recursiveFilePaths: [],
      missingDirs,
      missingAnyRootDirs,
      missingFiles,
      missingAnyRootFiles,
      missingAnyFileNames,
      missingAllFileNames,
      missingAnyFilePatterns: [],
      missingAllFilePatterns: [],
      missingAnyFileExtensions: [],
      hasUnsupportedFilePattern: false,
      blockedRootDirs,
      blockedRootFiles,
      blockedFileNames,
      blockedByNonePatterns: [],
      blockedByNoneExtensions: [],
      usesAdvancedConditions,
      snapshot: {
        directEntries: entries
      }
    }
  }

  const needsRecursiveScan =
    anyFilePatterns.length > 0 ||
    allFilePatterns.length > 0 ||
    anyFileExtensions.length > 0 ||
    allFileExtensions.length > 0 ||
    noneFileExtensions.length > 0 ||
    noneFilePatterns.length > 0 ||
    anyDirPatterns.length > 0 ||
    allDirPatterns.length > 0 ||
    noneDirPatterns.length > 0 ||
    minFileCount !== null ||
    maxFileCount !== null

  if (!needsRecursiveScan) {
    return {
      matched: true,
      reason: 'matched',
      requiredDirs,
      anyRootDirs,
      noneRootDirs,
      requiredFiles,
      anyRootFiles,
      noneRootFiles,
      anyFileNames,
      allFileNames,
      noneFileNames,
      hasFilePattern,
      anyFilePatterns,
      allFilePatterns,
      anyFileExtensions,
      allFileExtensions,
      noneFileExtensions,
      noneFilePatterns,
      actualDirs,
      actualFiles,
      actualEntryNames,
      recursiveFilePaths: [],
      missingDirs,
      missingAnyRootDirs,
      missingFiles,
      missingAnyRootFiles,
      missingAnyFileNames,
      missingAllFileNames,
      missingAnyFilePatterns: [],
      missingAllFilePatterns: [],
      missingAnyFileExtensions: [],
      hasUnsupportedFilePattern: false,
      blockedRootDirs,
      blockedRootFiles,
      blockedFileNames,
      blockedByNonePatterns: [],
      blockedByNoneExtensions: [],
      usesAdvancedConditions,
      snapshot: {
        directEntries: entries
      }
    }
  }

  const snapshot = await collectDirectorySnapshot(packageRoot, snapshotCache)
  const recursiveFileList = Array.isArray(snapshot?.allFiles) ? snapshot.allFiles : []
  const recursiveFilePaths = recursiveFileList.map((item) =>
    normalizeRelativeRulePath(item.relativePath)
  )
  const anyExtensionSet = new Set(anyFileExtensions)
  const allExtensionSet = new Set(allFileExtensions)
  const noneExtensionSet = new Set(noneFileExtensions)
  const hasAnyFilePatternMatched =
    !anyFilePatterns.length ||
    anyFilePatterns.some((pattern) =>
      recursiveFilePaths.some((item) => matchGlobPattern(pattern, item))
    )
  const missingAllFilePatterns = allFilePatterns.filter(
    (pattern) => !recursiveFilePaths.some((item) => matchGlobPattern(pattern, item))
  )
  const hasAllFilePatternMatched = missingAllFilePatterns.length === 0
  const matchedAnyExtensionFiles = recursiveFileList.filter((item) => anyExtensionSet.has(item.ext))
  const matchedAllExtensionFiles = recursiveFileList.filter((item) => allExtensionSet.has(item.ext))
  const hasAnyExtensionMatched = !anyFileExtensions.length || matchedAnyExtensionFiles.length > 0
  const hasAllExtensionMatched =
    !allFileExtensions.length ||
    (recursiveFileList.length > 0 &&
      recursiveFileList.every((item) => allExtensionSet.has(item.ext)) &&
      matchedAllExtensionFiles.length > 0)
  const blockedByNonePatterns = recursiveFilePaths.filter((item) =>
    matchAnyGlobPattern(noneFilePatterns, item)
  )
  const blockedByNoneExtensions = recursiveFileList
    .filter((item) => noneExtensionSet.has(item.ext))
    .map((item) => normalizeRelativeRulePath(item.relativePath))
  const hasNoBlockedPattern = blockedByNonePatterns.length === 0
  const hasNoBlockedExtension = blockedByNoneExtensions.length === 0
  // 新增：递归目录路径 glob 匹配
  const recursiveDirList = Array.isArray(snapshot?.allDirs) ? snapshot.allDirs : []
  const recursiveDirPaths = recursiveDirList.map((item) =>
    normalizeRelativeRulePath(item.relativePath)
  )
  const hasAnyDirPatternMatched =
    !anyDirPatterns.length ||
    anyDirPatterns.some((pattern) =>
      recursiveDirPaths.some((item) => matchGlobPattern(pattern, item))
    )
  const missingAllDirPatterns = allDirPatterns.filter(
    (pattern) => !recursiveDirPaths.some((item) => matchGlobPattern(pattern, item))
  )
  const hasAllDirPatternMatched = missingAllDirPatterns.length === 0
  const blockedByNoneDirPatterns = recursiveDirPaths.filter((item) =>
    matchAnyGlobPattern(noneDirPatterns, item)
  )
  const hasNoBlockedDirPattern = blockedByNoneDirPatterns.length === 0
  // 新增：递归文件数量范围匹配
  const meetsMinFileCount = minFileCount === null || recursiveFileList.length >= minFileCount
  const meetsMaxFileCount = maxFileCount === null || recursiveFileList.length <= maxFileCount
  const matched =
    hasAnyFilePatternMatched &&
    hasAllFilePatternMatched &&
    hasAnyExtensionMatched &&
    hasAllExtensionMatched &&
    hasNoBlockedPattern &&
    hasNoBlockedExtension &&
    hasAnyDirPatternMatched &&
    hasAllDirPatternMatched &&
    hasNoBlockedDirPattern &&
    meetsMinFileCount &&
    meetsMaxFileCount

  return {
    matched,
    reason: matched ? 'matched' : 'missing_required_entries',
    requiredDirs,
    anyRootDirs,
    noneRootDirs,
    requiredFiles,
    anyRootFiles,
    noneRootFiles,
    anyFileNames,
    allFileNames,
    noneFileNames,
    hasFilePattern,
    anyFilePatterns,
    allFilePatterns,
    anyFileExtensions,
    allFileExtensions,
    noneFileExtensions,
    noneFilePatterns,
    actualDirs,
    actualFiles,
    actualEntryNames,
    recursiveFilePaths,
    missingDirs,
    missingAnyRootDirs,
    missingFiles,
    missingAnyRootFiles,
    missingAnyFileNames,
    missingAllFileNames,
    missingAnyFilePatterns:
      anyFilePatterns.length > 0 && !hasAnyFilePatternMatched ? [...anyFilePatterns] : [],
    missingAllFilePatterns,
    missingAnyFileExtensions:
      anyFileExtensions.length > 0 && !hasAnyExtensionMatched ? [...anyFileExtensions] : [],
    hasUnsupportedFilePattern: anyFilePatterns.length > 0 && !hasAnyFilePatternMatched,
    blockedRootDirs,
    blockedRootFiles,
    blockedFileNames,
    blockedByNonePatterns,
    blockedByNoneExtensions,
    usesAdvancedConditions,
    snapshot
  }
}

// H8 死代码已删除：tryResolveNexusInstallRulesPlanWithCandidates
// 该函数仅被 resolveInstallRulesPlan（已删除）调用，全代码库无外部 import。
// 新引擎 method.js 已切到 inspectSourceInstallPlanByEngine / resolveSourceInstallPlanByEngine。

// H8 死代码已删除：resolveInstallRulesPlan（旧路径部署计划主入口）
// 全代码库无外部 import（nexusInstallRuleTool.js re-export 已注释），
// 新引擎 method.js 已切到 inspectSourceInstallPlanByEngine / resolveSourceInstallPlanByEngine。

function clampInstallRulePreviewNumber(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.max(1, Math.min(Math.floor(number), max))
}

function buildInstallRulePreviewEvidence(matchDetail = {}) {
  const pick = (value = [], limit = 8) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, limit)

  return {
    actualDirs: pick(matchDetail.actualDirs),
    actualFiles: pick(matchDetail.actualFiles),
    missingDirs: pick(matchDetail.missingDirs),
    missingFiles: pick(matchDetail.missingFiles),
    missingAnyRootDirs: pick(matchDetail.missingAnyRootDirs),
    missingAnyRootFiles: pick(matchDetail.missingAnyRootFiles),
    missingAnyFilePatterns: pick(matchDetail.missingAnyFilePatterns),
    missingAllFilePatterns: pick(matchDetail.missingAllFilePatterns),
    missingAnyFileExtensions: pick(matchDetail.missingAnyFileExtensions),
    blockedRootDirs: pick(matchDetail.blockedRootDirs),
    blockedRootFiles: pick(matchDetail.blockedRootFiles),
    blockedFileNames: pick(matchDetail.blockedFileNames),
    blockedByNonePatterns: pick(matchDetail.blockedByNonePatterns),
    blockedByNoneExtensions: pick(matchDetail.blockedByNoneExtensions),
    recursiveFilePaths: pick(matchDetail.recursiveFilePaths, 12)
  }
}

function buildInstallRulePreviewTarget(targetRule = {}, gameRoot = '', packageFolderName = '') {
  try {
    const targetLocation = resolveInstallTargetLocation({
      targetRule,
      gameRoot,
      packageFolderName
    })
    return {
      valid: true,
      targetType: targetLocation.targetType,
      targetBaseType: targetLocation.targetBaseType,
      targetRelativePath: targetLocation.targetRelativePath,
      usageType: targetLocation.usageType,
      isRunnable: targetLocation.isRunnable,
      launchAction: targetLocation.launchAction,
      showInjectButton: targetLocation.showInjectButton
    }
  } catch (error) {
    return {
      valid: false,
      errorCode: 'invalid_target_rule',
      message: String(error?.message || error || '').trim()
    }
  }
}

function normalizeInstallRulePreviewRules(rawRuleJson = {}, rawInstallRules = []) {
  const compiledRule = resolveCompiledInstallRule(rawRuleJson) || {}
  const sourceRules =
    Array.isArray(rawInstallRules) && rawInstallRules.length
      ? rawInstallRules
      : Array.isArray(compiledRule.install_rules)
        ? compiledRule.install_rules
        : []

  return sourceRules
    .map((item, index) => ({
      rule: item,
      index,
      priority: Number(item?.priority || 0)
    }))
    .filter((item) => item.rule && typeof item.rule === 'object')
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }
      return left.index - right.index
    })
}

function buildInstallRulePreviewResultItem({
  item = {},
  candidate = {},
  matchDetail = {},
  target = {},
  sourceType = ''
}) {
  const rule = item.rule && typeof item.rule === 'object' ? item.rule : {}
  const ruleId =
    String(rule.id || rule.name || `rule_${Number(item.index || 0)}`).trim() ||
    `rule_${Number(item.index || 0)}`

  return {
    ruleId,
    ruleName: String(rule.name || '').trim(),
    priority: Number(item.priority || 0),
    matched: matchDetail?.matched === true && target?.valid !== false,
    matchMatched: matchDetail?.matched === true,
    reason:
      matchDetail?.matched === true && target?.valid === false
        ? 'invalid_target_rule'
        : String(matchDetail?.reason || '').trim(),
    packageRoot: String(candidate?.packageRoot || '.').trim() || '.',
    candidateDepth: Number(candidate?.depth || 0),
    sourceType,
    target,
    matchSummary: buildMatchResultSummary(matchDetail),
    evidence: buildInstallRulePreviewEvidence(matchDetail)
  }
}

// 只读预演安装规则匹配：复用正式匹配语义，但不构建 copy plan、不 materialize 源目录、不写 staging。
export async function previewInstallRuleMatches(payload = {}) {
  const stagingPath = String(payload?.stagingPath || payload?.staging_path || '').trim()
  const gameRoot = String(payload?.gameRoot || payload?.game_root || '').trim()
  const packageFolderName = String(
    payload?.packageFolderName || payload?.package_folder_name || ''
  ).trim()
  const maxResults = clampInstallRulePreviewNumber(payload?.maxResults || payload?.limit, 20, 50)
  const maxCandidates = clampInstallRulePreviewNumber(payload?.maxCandidates, 50, 100)
  const rawRuleJson =
    payload?.ruleJson || payload?.rule_json || payload?.installRule || payload?.install_rule || {}
  const rawInstallRules = payload?.installRules || payload?.install_rules || []

  if (!stagingPath) {
    return {
      success: false,
      errorCode: 'missing_staging_path',
      message: '缺少 stagingPath，无法预演安装规则匹配。'
    }
  }
  if (!(await ensureDirectory(stagingPath))) {
    return {
      success: false,
      errorCode: 'staging_path_not_found',
      message: '未找到 stagingPath 目录，无法预演安装规则匹配。'
    }
  }
  if (!gameRoot) {
    return {
      success: false,
      errorCode: 'missing_game_root',
      message: '缺少 gameRoot，无法解析安装目标。'
    }
  }
  if (!(await ensureDirectory(gameRoot))) {
    return {
      success: false,
      errorCode: 'game_root_not_found',
      message: '未找到 gameRoot 目录，无法解析安装目标。'
    }
  }

  const rules = normalizeInstallRulePreviewRules(rawRuleJson, rawInstallRules)
  if (!rules.length) {
    return {
      success: false,
      errorCode: 'missing_install_rules',
      message: '安装规则缺少 install_rules，无法预演匹配。'
    }
  }

  const allCandidates = await listPackageRootCandidates(stagingPath)
  const candidateList = allCandidates.slice(0, maxCandidates)
  const snapshotCache = new Map()
  const results = []
  const matchedRules = []
  let evaluatedCount = 0

  for (const item of rules) {
    const rule = item.rule
    const sourceRule = rule.source && typeof rule.source === 'object' ? rule.source : {}
    const targetRule = rule.target && typeof rule.target === 'object' ? rule.target : {}
    const normalizedMatchRule = normalizeInstallMatchRule(rule.match)
    const sourceType = getInstallRuleSourceType(sourceRule)
    const target = buildInstallRulePreviewTarget(targetRule, gameRoot, packageFolderName)
    const orderedCandidates = orderPackageRootCandidatesByRule(
      candidateList,
      normalizedMatchRule,
      sourceRule
    )

    for (const candidate of orderedCandidates) {
      const matchDetail = await matchInstallRuleAtPackageRoot(
        candidate.rootPath,
        normalizedMatchRule,
        snapshotCache
      )
      evaluatedCount += 1

      const resultItem = buildInstallRulePreviewResultItem({
        item,
        candidate,
        matchDetail,
        target,
        sourceType
      })

      if (results.length < maxResults) {
        results.push(resultItem)
      }

      if (resultItem.matched) {
        matchedRules.push(resultItem)
        break
      }
    }
  }

  const selected = matchedRules[0] || null
  const truncated = results.length >= maxResults && evaluatedCount > results.length

  return {
    success: true,
    matched: !!selected,
    selected,
    matchedRules,
    results,
    summary: {
      ruleCount: rules.length,
      candidateCount: allCandidates.length,
      evaluatedCount,
      returnedResultCount: results.length,
      maxResults,
      maxCandidates,
      candidateLimitApplied: allCandidates.length > candidateList.length,
      truncated
    },
    message: selected
      ? `安装规则预演命中 ${selected.ruleId}。`
      : '安装规则预演未命中任何规则。'
  }
}

// H8 死代码已删除：resolveNexusCustomDeployPlan / resolveInstallRuleDeployPlan
// 这两个函数仅互相调用，且全代码库无外部 import（nexusInstallRuleTool.js re-export 已注释）。
// 新引擎 method.js 已切到 inspectSourceInstallPlanByEngine / resolveSourceInstallPlanByEngine，
// default_dependencies 由 planningPipeline.buildRuleDependencies 装配。
