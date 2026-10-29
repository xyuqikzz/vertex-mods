import { runModPriorityTransaction } from './modPriorityTransaction.js'
import { inspectPackageInstallability } from './packageInstallability.js'
import { transitionManagedConfigs, recoverManagedConfigOwners } from '../ipc/game/install-engine/managedConfigJournal.js'
// 安装、更新、启停和卸载业务服务。event 参数是受限通知端口，不是 Electron 原始事件。
// 预检缓存、锁和回滚仍由本服务及既有安装引擎统一管理，接入层不得复制状态。
import { isLegacyManifestOnlyRecord } from '../../shared/sources/retired-source-policy.js'
import { isLegacySource } from '../db/sources/legacySourceRecords.js'
import { validateLegacyUninstallManifest, collectLegacyManifestFiles } from '../ipc/game/legacyUninstallSafety.js'
import { assertInstallSourceAvailable } from '../ipc/game/retiredSourceInstallGuard.js'
import dbInstance from '../db/dbInstance.js'
import { removeMissingDiscoveredGame } from './gameCatalog.js'
import { deleteManagedFileAssetOwnersByOwner } from '../db/files/managedFileAssets.js'
import { getGameByAppId } from '../ipc/game/tool.js'
import { extractAndGetStructure, formatChinaTime, getParentPath, selectFile, uninstallFiles, pathExistsSync, getPath } from '../ipc/tool.js'

import { scanExecutablesInDirectoryByNodeApi } from '../api/file/index.js'
import { scanDriveByFilename } from '../ipc/game/scanDrive.js'
import path from 'path'
import { dbUninstallMod, deleteBackupData, getAllModDataByAppId, getBackupData, getBackupDataByPath, getModByData, getModDataById, insertBackupData, insertMod, updateModActiveState, updateModSourceLockState } from '../db/mods/mods.js'
import { inspectModSourceLock, lockModSource } from './modSourceFileLock.js'
import { ensureModSourcesWritableForMutation, prepareModSourcesForBulkMutation, sortModsForBulkMutation } from './modSourceMutationGuard.js'
import userPath from '../initPath.js'
import fs from 'fs-extra'
import { getGameDataByAppId, getModListByAppIdSql, queryServerModInstallStatus, repairUnscopedModProfileBySourceSql, updateGameServerModTypeByAppId, updateServerPath, deleteGameById } from '../db/games/game.js'
import { getModDeployScopeById, updateModPriorityOrders } from '../db/mods/modDeployment.js'
import { deleteDownloadRecordsByFilePath } from '../db/files/download.js'
import { insertFile } from '../db/files/files.js'
import { registerModSourceAssetForInstalledMod, releaseOwner as releaseManagedFileOwner } from './managed-files/service.js'
import { v4 as uuidv4 } from 'uuid'
import { getLocalGameData, getLocalModData } from '../ipc/data/utils.js'
import store from '../storage/store/index.js'
import { StagingManager } from '../utils/stagingManager.js'
import { buildOccupiedFilesMessage, collectStructureFilePaths, inspectFileOccupancy } from '../utils/fileOccupancy.js'
import { normalizeGameSourceMeta, upsertGameRecord } from '../db/games/gameRecord.js'
import { buildInstallRuleRecognitionSummary as buildNexusInstallRecognitionSummary, applyInstallRuleLifecycleSteps, applyInstallRulePostInstallSteps, collectDirectorySnapshot, ensureDirectory, isPathInside, logInstallRuleDebug as logNexusInstallRuleDebug, normalizeInstallFolderName, normalizeInstallUsageType, normalizeSourceDomainName as normalizeNexusDomainName, normalizeResolvedInstallPlan as normalizeResolvedNexusInstallPlan, resolveCompiledInstallRule as resolveCompiledNexusInstallRule } from '../ipc/game/installRuleTool.js'
import { hasSourceInstallRuleCapability, inspectSourceInstallPlanByEngine, resolveCachedSourceInstallPreviewPlan, resolveSourceInstallPlanByEngine, assertSourceInstallPlanCurrent } from '../ipc/game/install-engine/index.js'
import { resolveKnownGameRoot } from '../ipc/game/game-root-engine/ruleKernel.js'
import { requestLifecycleAuthorization as requestLifecycleAuthorizationImpl } from '../ipc/game/install-engine/lifecycleAuthorization.js'
import { runInstallEngineReplaySample } from '../ipc/game/install-engine/replaySampleRunner.js'
import { buildInstallRulePlatformContext, getInstallRulePlatformLabel, isInstallRuleManagedSource, normalizeInstallRuleSource, normalizeStoredInstallRulePlan, writeInstallRulePlanMetadata } from '../ipc/game/installRulePlatform.js'
import { reconcileDeploy } from '../ipc/game/deployReconciler.js'
import { withDeploymentScopeMutationLocks } from '../ipc/game/deploymentScopeMutationLock.js'
import { previewInstallLifecycleCommands } from '../ipc/game/installRuleTool.js'
import { getModFeatureFlags } from '../ipc/game/featureFlags.js'
import { resolveModUninstallPathPayload } from '../ipc/game/modUninstallPaths.js'
import { runModTask } from '../ipc/game/taskScheduler.js'
import { INSTALL_FLOW_CONFIG } from '../../shared/installation/install-flow-config.js'
import { formatInstallFailureMessage } from '../../shared/installation/install-flow-message.js'
import { STANDARD_METADATA_SCHEMA_VERSION } from '../ipc/game/standard/constants.js'
import { replaceModById, restoreModRecordSnapshot, restoreDeletedModRecordSnapshot } from '../db/mods/mods.js'
import { runModUpdateTransaction } from './modUpdateTransaction.js'
import { isRealPathInside } from '../ipc/game/install-engine/pathSafety.js'


const INSTALL_RULE_RUNNABLE_FILE_EXTENSIONS = new Set(['.exe', '.bat'])

const NEXUS_INSTALL_PREVIEW_STAGING_TTL_MS = INSTALL_FLOW_CONFIG.install.previewStagingTtlMs
const uninstallingModIdSet = new Set()
const installRulePreviewStagingMap = new Map()

function normalizeInstallFailureForUi(message = '', context = {}) {
  return formatInstallFailureMessage(message, {
    fallback: context?.fallback || '安装失败，请检查游戏是否正在运行，或稍后重试',
    ...context
  })
}

function assignInstallFailureMessage(returnData = {}, message = '', context = {}) {
  const rawMessage = String(message || '安装失败').trim()
  const userMessage = normalizeInstallFailureForUi(rawMessage, context)
  returnData.rawErrorMsg = rawMessage
  returnData.errorMsg = userMessage
  return userMessage
}

// B1：构造生命周期命令授权上下文。
// trustLevel 透传规则信任级别（缺省 community）；社区命令由逐次授权结果决定。
// 可执行扩展名白名单、参数安全校验与全局熔断始终在运行层（lifecyclePolicy）强制执行。
// 授权必须由调用方明确提供，遗漏授权上下文时拒绝命令执行。
// 调用方先调 requestLifecycleAuthorization，再把 authorizedByUser 传入。
function buildLifecycleCommandContext(trustLevel = '', options = {}) {
  const authorizedByUser = options.authorizedByUser === true
  return {
    authorized: authorizedByUser,
    trustLevel:
      String(trustLevel || '')
        .trim()
        .toLowerCase() || 'community'
  }
}

// H6：导出 IPC handler 调用的解析函数（封装实现模块）。


// H6：请求用户对 community/user 规则的命令动作显式授权。
// 实现细节见 install-engine/lifecycleAuthorization.js，这里保留薄包装层方便单元测试 mock。
async function requestLifecycleAuthorization(deployPlan = {}, postInstallSteps = [], event = null, runtimeContext = {}) {
  return requestLifecycleAuthorizationImpl(deployPlan, previewInstallLifecycleCommands(postInstallSteps, runtimeContext), event)
}

/**
 * A1：安装「提交阶段」（部署 / 记录 / 重建 / 安装后处理）失败时回滚已产生的副作用，
 * 保证两条部署路径行为一致——不在游戏目录残留半安装文件，也不留下悬挂 mod 记录。
 *
 * 传统路径：撤销已部署文件（undeploy）；安全路径：删除悬挂 mod 记录，必要时按范围重协调以回收已落盘文件。
 */
async function rollbackInstallArtifacts({
  useSafeDeployReconcile = false,
  traditionalDeployed = false,
  reconcileApplied = false,
  deploySourceRoot = '',
  deployTargetRoot = '',
  insertedModId = 0
} = {}) {
  // 安全路径下若 reconcile 已成功落盘，需先捕获部署范围，删除记录后再按范围回收孤立文件。
  let safeScope = null
  if (useSafeDeployReconcile && reconcileApplied && insertedModId) {
    try {
      safeScope = getModDeployScopeById(insertedModId)
    } catch (error) {
      console.error('[install-rollback] 获取部署范围失败', error?.message || error)
    }
  }

  if (insertedModId) {
    try {
      dbUninstallMod(insertedModId)
    } catch (error) {
      console.error('[install-rollback] 删除悬挂 mod 记录失败', error?.message || error)
    }
  }

  if (traditionalDeployed && deploySourceRoot && deployTargetRoot) {
    try {
      await StagingManager.undeploy(deploySourceRoot, deployTargetRoot)
    } catch (error) {
      console.error('[install-rollback] 撤销传统部署失败', error?.message || error)
    }
  }

  if (safeScope) {
    try {
      await reconcileDeploy({ scope: safeScope, mode: 'incremental', reason: 'install_rollback' })
    } catch (error) {
      console.error('[install-rollback] 安全部署回收失败', error?.message || error)
    }
  }
}

function replyInstallWarning(event, message = '', context = {}) {
  const rawMessage = String(message || '安装失败').trim()
  const userMessage = normalizeInstallFailureForUi(rawMessage, context)
  event.reply('node-notify', {
    type: 'warning',
    message: userMessage,
    rawMessage
  })
  return userMessage
}

function replyModInstallFailed(event, returnData = {}, message = '', context = {}, options = {}) {
  const userMessage = assignInstallFailureMessage(returnData, message, context)
  if (options.notify !== false) {
    event.reply('node-notify', {
      type: 'warning',
      message: userMessage,
      rawMessage: returnData.rawErrorMsg
    })
  }
  event.reply('modInstall-failed', returnData)
  return userMessage
}

function parseJsonArraySafe(value) {
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

function parseJsonObjectSafe(value) {
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

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function getDownloadStorageContext(data = {}) {
  const context = data?.storageContext
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null
  }

  return context
}

function resolveInstallStagingPath(data = {}, appid, fileNameWithoutExt, gameRoot = '') {
  const storageContext = getDownloadStorageContext(data)
  const stagingRoot = String(storageContext?.stagingRoot || '').trim()

  if (stagingRoot && storageContext?.useLegacyStrategy !== true) {
    return path.join(stagingRoot, String(fileNameWithoutExt || ''))
  }

  return StagingManager.getStagingPath(appid, fileNameWithoutExt, gameRoot)
}

function writeDownloadStorageContextMetadata(metadata = {}, data = {}) {
  const storageContext = getDownloadStorageContext(data)
  if (!storageContext) {
    return
  }

  metadata.storageContext = {
    cacheRoot: String(storageContext.cacheRoot || '').trim(),
    downloadRoot: String(storageContext.downloadRoot || '').trim(),
    tempRoot: String(storageContext.tempRoot || '').trim(),
    stagingRoot: String(storageContext.stagingRoot || '').trim(),
    backupRoot: String(storageContext.backupRoot || '').trim(),
    manifestRoot: String(storageContext.manifestRoot || '').trim(),
    deploymentRoot: String(storageContext.deploymentRoot || '').trim(),
    useLegacyStrategy: storageContext.useLegacyStrategy === true,
    reason: String(storageContext.reason || '').trim()
  }
}

function normalizeDependencyReference(item = {}) {
  if (typeof item === 'string') {
    const sourceModKey = String(item || '').trim()
    return sourceModKey
      ? {
          sourceModKey,
          name: sourceModKey,
          modId: 0,
          fileId: 0
        }
      : null
  }

  const source = item && typeof item === 'object' ? item : {}
  const sourceModKey = String(
    source.sourceModKey || source.source_mod_key || source.key || ''
  ).trim()
  const modId = toSafeNumber(source.modId || source.mod_id, 0)
  const fileId = toSafeNumber(source.fileId || source.file_id, 0)
  if (!sourceModKey && modId <= 0) {
    return null
  }

  return {
    sourceModKey,
    name:
      String(source.name || source.displayName || source.modName || source.title || '').trim() ||
      sourceModKey ||
      String(modId),
    modId,
    fileId
  }
}

function formatDependencyModNameList(list = [], limit = 3) {
  const names = []
  const seen = new Set()

  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item?.name || item?.displayName || '').trim()
    if (!name || seen.has(name)) {
      continue
    }
    seen.add(name)
    names.push(name)
  }

  if (!names.length) {
    return ''
  }

  const displayList = names.slice(0, limit)
  if (names.length <= limit) {
    return displayList.join('、')
  }

  return `${displayList.join('、')} 等 ${names.length} 个模组`
}

function getModDisplayName(mod = {}) {
  return String(mod?.name || mod?.option_name || mod?.displayName || mod?.id || '').trim() || '--'
}

function getModDependencyReferences(mod = {}) {
  const dependencyMap = new Map()
  const dependencies = parseJsonArraySafe(mod?.dependencies_json || mod?.dependencies)
    .map((entry) => normalizeDependencyReference(entry))
    .filter(Boolean)

  for (const dependency of dependencies) {
    const sourceModKey = String(dependency?.sourceModKey || '').trim()
    const modId = toSafeNumber(dependency?.modId, 0)
    const fileId = toSafeNumber(dependency?.fileId, 0)
    const key = sourceModKey || (modId > 0 ? `mod:${modId}:${fileId || '*'}` : '')
    if (!key) {
      continue
    }
    dependencyMap.set(key, dependency)
  }

  return [...dependencyMap.values()]
}

function doesDependencyReferenceMatchMod(dependency = {}, mod = {}) {
  const dependencySourceModKey = String(dependency?.sourceModKey || '').trim()
  const targetSourceModKey = String(mod?.source_mod_key || mod?.sourceModKey || '').trim()
  if (
    dependencySourceModKey &&
    targetSourceModKey &&
    dependencySourceModKey === targetSourceModKey
  ) {
    return true
  }

  const dependencyModId = toSafeNumber(dependency?.modId || dependency?.mod_id, 0)
  const targetModId = toSafeNumber(mod?.mod_id || mod?.modId, 0)
  if (dependencyModId <= 0 || targetModId <= 0 || dependencyModId !== targetModId) {
    return false
  }

  const dependencyFileId = toSafeNumber(dependency?.fileId || dependency?.file_id, 0)
  const targetFileId = toSafeNumber(mod?.option_id || mod?.optionId, 0)
  return dependencyFileId <= 0 || targetFileId <= 0 || dependencyFileId === targetFileId
}

function resolveInstalledDependencyMods(mod = {}) {
  if (!mod?.id || !mod?.game_id) {
    return []
  }

  const dependencies = getModDependencyReferences(mod)
  if (!dependencies.length) {
    return []
  }

  // 依赖解析必须限定在同一 profile 内，防止跨 profile 误启用依赖（与 buildModDependencyUsageState 保持一致）
  const modProfileName = String(mod?.profile_name || 'default').trim() || 'default'
  const relatedMods = dbInstance.all(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND id <> ?
       AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = lower(?)`,
    [Number(mod.game_id || 0), Number(mod.endpoint_type || 0), Number(mod.id || 0), modProfileName]
  )
  const matchedMap = new Map()

  for (const item of relatedMods) {
    if (!dependencies.some((dependency) => doesDependencyReferenceMatchMod(dependency, item))) {
      continue
    }
    matchedMap.set(Number(item?.id || 0), item)
  }

  return [...matchedMap.values()].sort((a, b) => {
    const priorityDiff = toSafeNumber(a?.priority_order, 0) - toSafeNumber(b?.priority_order, 0)
    if (priorityDiff !== 0) {
      return priorityDiff
    }
    return toSafeNumber(a?.id, 0) - toSafeNumber(b?.id, 0)
  })
}

function appendUniqueModSummary(targetList = [], sourceList = []) {
  const seen = new Set(
    targetList.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0)
  )

  for (const item of Array.isArray(sourceList) ? sourceList : []) {
    const id = Number(item?.id || 0)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue
    }
    seen.add(id)
    targetList.push({
      id,
      name: getModDisplayName(item)
    })
  }

  return targetList
}

function buildModDependencyUsageState(mod = {}) {
  if (!mod?.id || !mod?.game_id) {
    return {
      isDefaultDependency: false,
      dependents: [],
      activeDependents: []
    }
  }

  const metadata = parseJsonObjectSafe(mod?.metadata_json)
  const isDefaultDependency =
    Number(mod?.type_id || 0) === 1 ||
    String(metadata?.category || '').trim() === 'default_dependency'
  const sourceModKey = String(mod?.source_mod_key || '').trim()
  const sourceModId = toSafeNumber(mod?.mod_id, 0)

  if (!sourceModKey && sourceModId <= 0) {
    return {
      isDefaultDependency,
      dependents: [],
      activeDependents: []
    }
  }

  // 关键：依赖人扫描必须限定在「同一个 profile」内。
  // Vertex 的 profile 是隔离的——`default` profile 里的 MapUnlocker 引用的是
  // `default` profile 里的 RE-UE4SS（同 source_mod_key 但 mod.id 不同），
  // **不会**指向 `导入-XXXX` profile 里的副本。
  // 不加 profile 过滤会出现：禁用 `导入-XXXX` 里的 RE-UE4SS 时，错把
  // `default` 里的 MapUnlocker 当成它的依赖人，从而误报「默认依赖仍被 X 使用」。
  // 同样规则适用于卸载流程（call site：method.js 4840+ / 4908+）。
  const modProfileName = String(mod?.profile_name || 'default').trim() || 'default'
  const relatedMods = dbInstance.all(
    `SELECT id, name, option_name, is_active, dependencies_json, profile_name
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND id <> ?
       AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = lower(?)`,
    [
      Number(mod.game_id || 0),
      Number(mod.endpoint_type || 0),
      Number(mod.id || 0),
      modProfileName
    ]
  )
  const dependents = []

  for (const item of relatedMods) {
    const dependencies = getModDependencyReferences(item)
    if (!dependencies.some((entry) => doesDependencyReferenceMatchMod(entry, mod))) {
      continue
    }

    dependents.push({
      id: Number(item?.id || 0),
      name: getModDisplayName(item),
      isActive: Number(item?.is_active ?? 1) === 1
    })
  }

  return {
    isDefaultDependency,
    dependents,
    activeDependents: dependents.filter((item) => item.isActive)
  }
}

async function enableInstalledDependenciesForMod(event, mod = {}, taskContext = {}) {
  const updateTask = typeof taskContext.update === 'function' ? taskContext.update : () => {}
  const dependencyVisitedSet =
    taskContext.dependencyVisitedSet instanceof Set ? taskContext.dependencyVisitedSet : new Set()
  const dependencyMods = resolveInstalledDependencyMods(mod).filter(
    (item) => Number(item?.is_active ?? 1) !== 1
  )
  const enabledDependencies = []

  for (const dependencyMod of dependencyMods) {
    const dependencyId = Number(dependencyMod?.id || 0)
    if (!dependencyId || dependencyVisitedSet.has(dependencyId)) {
      continue
    }

    const dependencyName = getModDisplayName(dependencyMod)
    updateTask({
      stage: 'planning',
      progress: 30,
      currentTarget: `启用前置依赖：${dependencyName}`
    })
    const dependencyResult = await executeToggleModState(
      event,
      {
        id: dependencyId,
        isActive: true
      },
      {
        ...taskContext,
        dependencyVisitedSet
      }
    )

    if (!dependencyResult?.success) {
      return {
        success: false,
        message: `前置依赖 ${dependencyName} 启用失败：${String(dependencyResult?.message || '未知错误')}`,
        dependencyId,
        enabledDependencies
      }
    }

    appendUniqueModSummary(enabledDependencies, dependencyResult?.enabledDependencies || [])
    if (!dependencyResult?.skipped) {
      appendUniqueModSummary(enabledDependencies, [dependencyMod])
    }
  }

  return {
    success: true,
    enabledDependencies
  }
}

function isRuntimeBackupReleased(item = {}) {
  return (
    String(item?.state || '')
      .trim()
      .toLowerCase() === 'released'
  )
}

function isInstallRuleManagedMod(mod = {}) {
  const metadata = parseJsonObjectSafe(mod?.metadata_json)
  const source = normalizeInstallRuleSource(
    mod?.source || metadata?.sourceType || metadata?.source || ''
  )
  return isInstallRuleManagedSource(source)
}

function isUnifiedDeployManagedMod(mod = {}, metadata = null) {
  const meta =
    metadata && typeof metadata === 'object' ? metadata : parseJsonObjectSafe(mod?.metadata_json)
  const source = normalizeInstallRuleSource(mod?.source || meta?.sourceType || meta?.source || '')
  const installModel = String(mod?.install_model || 'managed')
    .trim()
    .toLowerCase()
  return (
    getModFeatureFlags().enablePriorityReconcile &&
    source &&
    source !== 'thunderstore' &&
    installModel !== 'legacy' &&
    !!getModDeployScopeById(mod?.id) &&
    !!String(meta?.stagingPath || mod?.staging_path || '').trim() &&
    !!String(meta?.targetPath || mod?.target_path || '').trim()
  )
}

function normalizeRuntimeBackupOptionIdText(value = '') {
  return String(value ?? '').trim()
}

function hashRuntimeBackupOwnerText(value = '') {
  const safeValue = String(value || '').trim()
  if (!safeValue) {
    return 0
  }

  let hash = 2166136261
  for (let index = 0; index < safeValue.length; index += 1) {
    hash ^= safeValue.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return 5000000000 + (hash >>> 0)
}

function resolveRuntimeBackupOwnerId(payload = {}) {
  const rawOptionId = normalizeRuntimeBackupOptionIdText(
    payload?.optionId ?? payload?.option_id ?? payload?.id
  )
  const numericOptionId = Number(rawOptionId)
  if (Number.isInteger(numericOptionId) && numericOptionId > 0) {
    return numericOptionId
  }

  const sourceModKey = String(payload?.sourceModKey || payload?.source_mod_key || '').trim()
  if (sourceModKey) {
    return hashRuntimeBackupOwnerText(`source_mod_key:${sourceModKey}`)
  }

  if (rawOptionId) {
    return hashRuntimeBackupOwnerText(`option_id:${rawOptionId}`)
  }

  return 0
}

function findModByRuntimeBackupEntry(entry = {}, options = {}) {
  const gameId = Number(options?.gameId || 0)
  const endpointType = Number(options?.endpointType || 0)
  if (!gameId) {
    return null
  }

  const metadata = parseJsonObjectSafe(entry?.metadata_json)
  const sourceModKey = String(metadata?.sourceModKey || '').trim()
  if (sourceModKey) {
    const ownerMod = dbInstance.get(
      `SELECT id, name, option_name, is_active
       FROM mods
       WHERE game_id = ?
         AND source_mod_key = ?
         AND endpoint_type = ?
       LIMIT 1`,
      [gameId, sourceModKey, endpointType]
    )
    if (ownerMod) {
      return ownerMod
    }
  }

  const optionIdText = normalizeRuntimeBackupOptionIdText(metadata?.optionId)
  if (optionIdText) {
    const ownerMod = dbInstance.get(
      `SELECT id, name, option_name, is_active
       FROM mods
       WHERE game_id = ?
         AND option_id = ?
         AND endpoint_type = ?
       LIMIT 1`,
      [gameId, optionIdText, endpointType]
    )
    if (ownerMod) {
      return ownerMod
    }
  }

  const fallbackOwnerId = Number(entry?.mod_id || 0)
  if (fallbackOwnerId > 0) {
    return dbInstance.get(
      `SELECT id, name, option_name, is_active
       FROM mods
       WHERE game_id = ?
         AND option_id = ?
         AND endpoint_type = ?
       LIMIT 1`,
      [gameId, String(fallbackOwnerId), endpointType]
    )
  }

  return null
}

function getModRuntimeBackupList(mod = {}) {
  const runtimeBackupOwnerId = resolveRuntimeBackupOwnerId({
    optionId: mod?.option_id,
    sourceModKey: mod?.source_mod_key
  })
  const endpointType = Number(mod?.endpoint_type || 0)
  const gameId = Number(mod?.game_id || 0)

  if (!runtimeBackupOwnerId || !gameId) {
    return []
  }

  return (getBackupData(runtimeBackupOwnerId, endpointType) || []).filter(
    (item) => Number(item?.game_id || 0) === gameId
  )
}

function getNexusRuntimeBackupRootPath(targetRoot = '') {
  return path.join(StagingManager.getWorkspaceRootPath(targetRoot), 'runtime-backup', 'nexus')
}

function buildRuntimeBackupEntryPath(
  backupRoot = '',
  targetPath = '',
  index = 0,
  targetType = 'file'
) {
  const safeTargetType = String(targetType || 'file')
    .trim()
    .toLowerCase()
  const extension = safeTargetType === 'directory' ? '' : path.extname(String(targetPath || ''))
  const safeExtension = extension && extension.length <= 32 ? extension : ''
  const baseName = normalizeInstallFolderName(path.basename(String(targetPath || ''), extension))
  return path.join(
    backupRoot,
    `${String(index + 1).padStart(4, '0')}_${baseName}_${uuidv4().slice(0, 8)}${safeExtension}`
  )
}

async function collectRuntimeOverwriteEntries(sourceRoot = '', targetRoot = '') {
  const safeSourceRoot = path.resolve(String(sourceRoot || ''))
  const safeTargetRoot = path.resolve(String(targetRoot || ''))

  if (!(await fs.pathExists(safeSourceRoot))) {
    return []
  }

  const collisionMap = new Map()

  async function walk(currentSourceRoot, relativePath = '') {
    let entryList = []
    try {
      entryList = await fs.readdir(currentSourceRoot, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entryList) {
      const nextRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name
      const sourcePath = path.join(currentSourceRoot, entry.name)
      const targetPath = path.join(safeTargetRoot, nextRelativePath)

      let sourceStat = null
      try {
        sourceStat = await fs.lstat(sourcePath)
      } catch {
        sourceStat = null
      }

      if (!sourceStat) {
        continue
      }

      let targetStat = null
      if (await fs.pathExists(targetPath)) {
        try {
          targetStat = await fs.lstat(targetPath)
        } catch {
          targetStat = null
        }
      }

      const sourceIsDirectory = sourceStat.isDirectory()
      const targetIsDirectory = targetStat?.isDirectory() === true

      if (targetStat && (!sourceIsDirectory || !targetIsDirectory)) {
        const targetKey = String(targetPath || '')
          .trim()
          .toLowerCase()
        if (!collisionMap.has(targetKey)) {
          collisionMap.set(targetKey, {
            filePath: targetPath,
            relativePath: String(nextRelativePath || '').replace(/\\/g, '/'),
            sourceType: sourceIsDirectory ? 'directory' : 'file',
            targetType: targetIsDirectory ? 'directory' : 'file'
          })
        }
      }

      if (sourceIsDirectory && (!targetStat || targetIsDirectory)) {
        await walk(sourcePath, nextRelativePath)
      }
    }
  }

  await walk(safeSourceRoot)
  return [...collisionMap.values()]
}

async function backupRuntimeOverwriteTargets(payload = {}) {
  const source = normalizeInstallRuleSource(
    payload?.source || payload?.sourceMeta?.source || 'nexus'
  )
  const sourceLabel = getInstallRulePlatformLabel(source)
  const gameRowId = Number(payload?.gameRowId || 0)
  const optionIdText = normalizeRuntimeBackupOptionIdText(payload?.optionId)
  const sourceModKey = String(payload?.sourceModKey || '').trim()
  const runtimeBackupOwnerId = resolveRuntimeBackupOwnerId({
    optionId: optionIdText,
    sourceModKey
  })
  const endpointType = Number(payload?.endpointType || 0)
  const sourceRoot = String(payload?.sourceRoot || '').trim()
  const targetRoot = String(payload?.targetRoot || '').trim()
  const modName = String(payload?.modName || '').trim()

  if (!gameRowId || !runtimeBackupOwnerId || !sourceRoot || !targetRoot) {
    return {
      success: false,
      message: `缺少 ${sourceLabel} 运行时备份参数`
    }
  }

  const collisionList = await collectRuntimeOverwriteEntries(sourceRoot, targetRoot)
  if (!collisionList.length) {
    return {
      success: true,
      collisionCount: 0,
      backupCount: 0,
      results: []
    }
  }

  const backupRoot = path.join(
    getNexusRuntimeBackupRootPath(targetRoot),
    String(gameRowId),
    String(endpointType),
    String(runtimeBackupOwnerId)
  )

  await fs.ensureDir(backupRoot)
  const preparedBackupList = []

  for (let index = 0; index < collisionList.length; index += 1) {
    const item = collisionList[index]
    const backupPath = buildRuntimeBackupEntryPath(
      backupRoot,
      item.filePath,
      index,
      item.targetType
    )

    try {
      await fs.copy(item.filePath, backupPath, {
        overwrite: true,
        errorOnExist: false
      })
    } catch (error) {
      await Promise.all(
        preparedBackupList.map((entry) => fs.remove(String(entry.backupPath || '')).catch(() => {}))
      )
      return {
        success: false,
        message: `启用前备份被覆盖文件失败：${item.filePath}`,
        collisionCount: collisionList.length,
        backupCount: preparedBackupList.length,
        error
      }
    }

    preparedBackupList.push({
      ...item,
      backupPath
    })
  }

  try {
    for (const entry of preparedBackupList) {
      const previousRow = (getBackupDataByPath(entry.filePath, endpointType, gameRowId) || []).find(
        (item) => Number(item?.mod_id || 0) === runtimeBackupOwnerId
      )

      insertBackupData({
        game_id: gameRowId,
        mod_id: runtimeBackupOwnerId,
        file_path: entry.filePath,
        backup_path: entry.backupPath,
        type: endpointType,
        metadata: {
          source,
          modName,
          optionId: optionIdText,
          sourceModKey,
          runtimeBackupOwnerId,
          relativePath: entry.relativePath,
          sourceType: entry.sourceType,
          targetType: entry.targetType,
          sourceRoot: path.resolve(sourceRoot),
          targetRoot: path.resolve(targetRoot),
          updatedAt: formatChinaTime()
        }
      })

      const previousBackupPath = String(previousRow?.backup_path || '').trim()
      if (previousBackupPath && previousBackupPath !== entry.backupPath) {
        await fs.remove(previousBackupPath).catch(() => {})
      }
    }
  } catch (error) {
    return {
      success: false,
      message: error?.message || `写入 ${sourceLabel} 运行时备份记录失败`,
      collisionCount: collisionList.length,
      backupCount: preparedBackupList.length,
      error
    }
  }

  return {
    success: true,
    collisionCount: collisionList.length,
    backupCount: preparedBackupList.length,
    results: preparedBackupList
  }
}

function buildNexusRuntimeBackupConflictState(mod = {}) {
  const runtimeBackupOwnerId = resolveRuntimeBackupOwnerId({
    optionId: mod?.option_id,
    sourceModKey: mod?.source_mod_key
  })
  const endpointType = Number(mod?.endpoint_type || 0)
  const gameId = Number(mod?.game_id || 0)
  const backupList = getModRuntimeBackupList(mod).filter((item) => !isRuntimeBackupReleased(item))
  const blockerMap = new Map()

  if (!runtimeBackupOwnerId || !gameId || !backupList.length) {
    return {
      blocked: false,
      blockers: [],
      backupList
    }
  }

  for (const entry of backupList) {
    const relatedList = getBackupDataByPath(entry.file_path, endpointType, gameId)
    for (const relatedItem of relatedList) {
      const relatedModId = Number(relatedItem?.mod_id || 0)
      if (
        !relatedModId ||
        relatedModId === runtimeBackupOwnerId ||
        isRuntimeBackupReleased(relatedItem)
      ) {
        continue
      }
      if (Number(relatedItem?.id || 0) <= Number(entry?.id || 0)) {
        continue
      }

      const ownerMod = findModByRuntimeBackupEntry(relatedItem, {
        gameId,
        endpointType
      })

      if (!ownerMod || Number(ownerMod?.is_active ?? 1) !== 1) {
        continue
      }

      const ownerKey = Number(ownerMod?.id || 0) || relatedModId
      blockerMap.set(ownerKey, {
        id: Number(ownerMod?.id || 0),
        name: String(ownerMod?.name || ownerMod?.option_name || relatedModId).trim() || '--'
      })
    }
  }

  return {
    blocked: blockerMap.size > 0,
    blockers: [...blockerMap.values()],
    backupList
  }
}

function buildNexusRuntimeBackupBlockedMessage(blockers = [], actionText = '禁用') {
  return `当前模组覆盖的文件仍被 ${formatDependencyModNameList(blockers) || '其他模组'} 使用，请先禁用或删除后安装的相关模组后再${actionText}`
}

function parseInstallStructureJson(value = '') {
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

function inspectModsOccupancy(mods = []) {
  const safeMods = Array.isArray(mods) ? mods.filter(Boolean) : []
  const filePaths = []

  for (const mod of safeMods) {
    const structure = parseInstallStructureJson(mod?.install_paths_json)
    filePaths.push(...collectStructureFilePaths(structure))
  }

  const inspectResult = inspectFileOccupancy(filePaths)
  return {
    ...inspectResult,
    success: !inspectResult.hasOccupiedFiles,
    message: inspectResult.hasOccupiedFiles
      ? buildOccupiedFilesMessage(inspectResult.occupiedFiles)
      : ''
  }
}

function buildTreeStructureSummary(structure = []) {
  const safeStructure = Array.isArray(structure) ? structure : []
  const stack = safeStructure.map((item) => ({
    node: item,
    depth: 0
  }))
  let directoryCount = 0
  let fileCount = 0
  let maxDepth = 0

  while (stack.length > 0) {
    const current = stack.pop()
    const node = current?.node && typeof current.node === 'object' ? current.node : {}
    const depth = Number(current?.depth || 0)
    maxDepth = Math.max(maxDepth, depth)

    if (Number(node?.type || 0) === 0) {
      directoryCount += 1
    } else {
      fileCount += 1
    }

    const children = Array.isArray(node?.sub) ? node.sub : []
    for (const child of children) {
      stack.push({
        node: child,
        depth: depth + 1
      })
    }
  }

  return {
    rootPath: String(safeStructure[0]?.path || '').trim(),
    directoryCount,
    fileCount,
    nodeCount: directoryCount + fileCount,
    maxDepth
  }
}

function buildInstallInspectMeta(structureData = {}, executableInfo = null) {
  const structure = Array.isArray(structureData?.structure) ? structureData.structure : []
  return {
    isEncrypted: !!structureData?.isEncrypted,
    backupCount: Array.isArray(structureData?.backup) ? structureData.backup.length : 0,
    structureSummary: buildTreeStructureSummary(structure),
    run:
      executableInfo && typeof executableInfo === 'object'
        ? executableInfo
        : structureData?.run && typeof structureData.run === 'object'
          ? structureData.run
          : { type: 0, path: '', paths: [] }
  }
}

function emitInstallStructureDebug(event, payload = {}) {
  if (!event || typeof event.reply !== 'function') {
    return
  }

  const structureData =
    payload?.structureData && typeof payload.structureData === 'object' ? payload.structureData : {}
  event.reply('data-log', {
    stage: String(payload?.stage || '').trim(),
    filePath: String(payload?.filePath || '').trim(),
    ...buildInstallInspectMeta(structureData, payload?.executableInfo || null)
  })
}

function clearNexusInstallPreviewTimeout(entry = {}) {
  if (entry?.timeoutId) {
    clearTimeout(entry.timeoutId)
  }
}

async function cleanupNexusInstallPreviewStagingEntry(token = '', options = {}) {
  const safeToken = String(token || '').trim()
  if (!safeToken) return

  const entry = installRulePreviewStagingMap.get(safeToken)
  if (!entry) return

  installRulePreviewStagingMap.delete(safeToken)
  clearNexusInstallPreviewTimeout(entry)

  if (options?.removeStaging === false) {
    return
  }

  const stagingPath = String(entry?.stagingPath || '').trim()
  if (!stagingPath) {
    return
  }

  try {
    await fs.remove(stagingPath)
  } catch (error) {
    console.warn('清理预检暂存目录失败', {
      token: safeToken,
      stagingPath,
      error
    })
  }
}

async function cleanupExpiredNexusInstallPreviewStaging() {
  const now = Date.now()
  const tokenList = []

  for (const [token, entry] of installRulePreviewStagingMap.entries()) {
    if (Number(entry?.expireAt || 0) <= now) {
      tokenList.push(token)
    }
  }

  for (const token of tokenList) {
    await cleanupNexusInstallPreviewStagingEntry(token)
  }
}

async function storeNexusInstallPreviewStaging(payload = {}) {
  await cleanupExpiredNexusInstallPreviewStaging()

  const token = `nexus_preview_${Date.now()}_${uuidv4().slice(0, 8)}`
  const expireAt = Date.now() + NEXUS_INSTALL_PREVIEW_STAGING_TTL_MS
  const entry = {
    token,
    appId: Number(payload?.appId || 0),
    filePath: path.resolve(String(payload?.filePath || '')),
    stagingPath: path.resolve(String(payload?.stagingPath || '')),
    installPlan:
      payload?.installPlan && typeof payload.installPlan === 'object' ? payload.installPlan : null,
    structure: Array.isArray(payload?.structure) ? payload.structure : [],
    createdAt: Date.now(),
    expireAt,
    timeoutId: null
  }

  const timeoutId = setTimeout(() => {
    cleanupNexusInstallPreviewStagingEntry(token).catch((error) => {
      console.warn('预检暂存目录超时清理失败', {
        token,
        error
      })
    })
  }, NEXUS_INSTALL_PREVIEW_STAGING_TTL_MS)
  timeoutId.unref?.()
  entry.timeoutId = timeoutId

  installRulePreviewStagingMap.set(token, entry)
  return token
}

async function consumeNexusInstallPreviewStaging(token = '', expected = {}) {
  await cleanupExpiredNexusInstallPreviewStaging()

  const safeToken = String(token || '').trim()
  if (!safeToken) {
    return null
  }

  const entry = installRulePreviewStagingMap.get(safeToken)
  if (!entry) {
    return null
  }

  const expectedAppId = Number(expected?.appId || 0)
  const expectedFilePath = path.resolve(String(expected?.filePath || ''))

  if (expectedAppId > 0 && expectedAppId !== Number(entry?.appId || 0)) {
    return null
  }

  if (expectedFilePath && expectedFilePath !== String(entry?.filePath || '')) {
    return null
  }

  installRulePreviewStagingMap.delete(safeToken)
  clearNexusInstallPreviewTimeout(entry)

  if (!(await fs.pathExists(String(entry?.stagingPath || '')))) {
    return null
  }

  return entry
}

function resolveNexusInstallPreviewToken(data = {}) {
  return String(
    data?.nexusPreviewToken || data?.previewToken || data?.nexus_preview_token || ''
  ).trim()
}

function normalizeModSourceType(value = '') {
  return normalizeInstallRuleSource(value)
}

function hasUsableSourceIdentity(sourceMeta = {}) {
  const source = String(sourceMeta?.source || '')
    .trim()
    .toLowerCase()
  const sourceId = String(
    sourceMeta?.sourceId ?? sourceMeta?.source_id ?? sourceMeta?.id ?? sourceMeta?.community ?? ''
  ).trim()
  const sourceSlug = String(
    sourceMeta?.sourceSlug ??
      sourceMeta?.source_slug ??
      sourceMeta?.community ??
      sourceMeta?.domainName ??
      sourceMeta?.domain_name ??
      ''
  ).trim()
  const appId = String(
    sourceMeta?.appId ??
      sourceMeta?.app_id ??
      sourceMeta?.steamAppId ??
      sourceMeta?.steam_app_id ??
      ''
  ).trim()
  return !!(source && (sourceId || sourceSlug || appId))
}

function buildModSourceMeta(data = {}) {
  const source = normalizeModSourceType(data?.sourceType || data?.source || data?.sourcePlatform)
  const appId = String(data?.appid || data?.appId || '').trim()
  const sourceId = String(
    data?.gameSourceId ||
      data?.sourceGameId ||
      data?.nexusGameId ||
      data?.modioGameId ||
      data?.sourceId ||
      ''
  ).trim()
  const sourceSlug = String(
    data?.gameSourceSlug || data?.sourceGameSlug || data?.modioGameSlug || data?.sourceSlug || ''
  ).trim()
  const gameDomainName = normalizeNexusDomainName(
    data?.sourceGameDomain || data?.gameDomainName || data?.nexusGameDomain || data?.modioGameDomain
  )

  return {
    source,
    appId,
    sourceId: sourceId || (source === 'server' ? appId : ''),
    sourceSlug:
      sourceSlug ||
      (source === 'nexus' || source === 'modio' || source === 'ficsit' ? gameDomainName : ''),
    gameId: Number(data?.gameId || 0)
  }
}

function resolveModLifecycleExecutionContext(mod = {}, metadata = {}) {
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {}
  const sourceMeta = buildModSourceMeta({
    ...safeMetadata,
    ...mod,
    sourceType: safeMetadata?.sourceType || mod?.source
  })
  const appId = Number(mod?.game_id || mod?.appid || 0)
  const game = appId > 0 ? getGameDataByAppId(appId, sourceMeta) : null
  const installRulePlan = normalizeStoredInstallRulePlan(safeMetadata)

  return {
    gameRoot: game ? resolveClientGameRoot(game) : '',
    stagingRoot: String(
      installRulePlan?.lifecycleStagingRoot || safeMetadata?.stagingPath || mod?.stagingPath || ''
    ).trim(),
    targetRoot: String(safeMetadata?.targetPath || mod?.targetPath || '').trim(),
    targetBaseType: String(installRulePlan?.targetBaseType || 'game').trim() || 'game',
    installRulePlan,
    sourceInstallPlan: installRulePlan,
    nexusInstallPlan: installRulePlan
  }
}

function getManagedConfigPatches(metadata = {}) {
  return normalizeStoredInstallRulePlan(metadata)?.replayContext?.declarative?.config || []
}

async function commitLifecycleReceipts(receipts) {
  for (const receipt of receipts) {
    try { await receipt.commit() } catch (error) { console.warn('生命周期成功后的临时备份清理失败', error.code || error.name) }
  }
}

async function rollbackLifecycleReceipts(receipts) {
  const failures = []
  for (const receipt of [...receipts].reverse()) {
    try { await receipt.rollback() } catch (error) { failures.push(error.message) }
  }
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { needRecovery: true })
  receipts.length = 0
}

async function rollbackConfigAndLifecycle(receipts, configTransition) {
  const failures = []
  try { await rollbackLifecycleReceipts(receipts) } catch (error) { failures.push(error.message) }
  try { await configTransition?.rollback() } catch (error) { failures.push(error.message) }
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { needRecovery: true })
}

function getInstalledRuleCapabilities(gameId, { endpointType = 0, profileName = 'default', excludeModId = 0 } = {}) {
  const records = []
  for (const mod of dbInstance.all(`SELECT * FROM mods WHERE game_id = ? AND is_active = 1
    AND endpoint_type = ? AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ? AND id <> ? ORDER BY id`,
  [Number(gameId || 0), Number(endpointType), String(profileName || 'default').trim().toLowerCase(), Number(excludeModId || 0)])) {
    const metadata = parseJsonObjectSafe(mod.metadata_json)
    if (mod.source_mod_key) records.push({ id: mod.source_mod_key, version: String(mod.version || mod.mod_version || '') })
    const provided = normalizeStoredInstallRulePlan(metadata)?.replayContext?.declarative?.providedCapabilities
    if (Array.isArray(provided)) records.push(...provided)
  }
  return { records }
}

function getRulePlanningState(game, data, sourceMeta, endpointType, previousMod) {
  const profileName = String(data.profileName || data.targetProfileName || 'default').trim() || 'default'
  if (previousMod === undefined) {
    const previousId = Number(data.updateTargetModId || data.sourceModpackPreviousLocalModId || 0)
    previousMod = previousId
      ? dbInstance.get('SELECT * FROM mods WHERE id = ?', [previousId])
      : getModByData({ game_id: data.appid || data.appId || game.app_id, mod_id: data.modId,
          option_id: data.id, endpoint_type: endpointType, profileName, sourceMeta })
    if (previousId && !previousMod) throw new Error('更新目标已不存在，请刷新后重新预检')
  }
  if (previousMod && (Number(previousMod.game_id) !== Number(game.id) ||
      Number(previousMod.endpoint_type || 0) !== endpointType ||
      String(previousMod.profile_name || 'default').toLowerCase() !== profileName.toLowerCase() ||
      String(previousMod.source || '').toLowerCase() !== String(sourceMeta.source || '').toLowerCase() ||
      String(previousMod.mod_id) !== String(data.modId))) {
    throw new Error('更新目标不属于当前游戏、端点或配置，请重新预检')
  }
  const metadata = parseJsonObjectSafe(previousMod?.metadata_json)
  return {
    installedCapabilities: getInstalledRuleCapabilities(game.id, { endpointType, profileName, excludeModId: previousMod?.id }),
    managedConfigContext: { journalRoot: path.join(userPath, 'install-config-journals'), owner: metadata.managedConfigOwner || '' }
  }
}

// Read the same ownership/dependency scope for diagnostics as for installation.
// Consumers still run their own plan and cannot turn this context into an authorization.
export function getInstallRulePlanningContext(data = {}, installRule = data.installRule || {}) {
  const sourceMeta = buildModSourceMeta(data)
  const game = getGameDataByAppId(Number(data.appid || data.appId || 0), sourceMeta)
  if (!game) throw new Error('任务关联的游戏记录不存在，请刷新安装上下文')
  const endpointType = Number(data.endpointType || data.endpoint_type || 0)
  const gameRoot = endpointType === 0 ? resolveClientGameRoot(game, installRule) : String(data.gameRoot || data.gameRootPath || '').trim()
  if (!gameRoot) throw new Error('任务缺少对应端点的安装根目录，请重新预检')
  return { ...getRulePlanningState(game, data, sourceMeta, endpointType), data, sourceMeta,
    source: sourceMeta.source, gameRoot }
}

async function beginModConfigTransition(mod, active) {
  const metadata = parseJsonObjectSafe(mod?.metadata_json)
  const patches = getManagedConfigPatches(metadata)
  if (!patches.length) return null
  const context = resolveModLifecycleExecutionContext(mod, metadata)
  return transitionManagedConfigs({
    journalRoot: path.join(userPath, 'install-config-journals'),
    owner: metadata.managedConfigOwner,
    gameRoot: context.gameRoot,
    patches,
    active
  })
}

export async function recoverInstalledConfigState() {
  const owners = new Map()
  const boundaries = new Set()
  for (const game of dbInstance.all('SELECT * FROM games')) {
    const root = String(game.client_root_path || '').trim()
    if (root) boundaries.add(path.resolve(root))
  }
  for (const mod of dbInstance.all('SELECT * FROM mods')) {
    const metadata = parseJsonObjectSafe(mod.metadata_json)
    if (!metadata.managedConfigOwner) continue
    const context = resolveModLifecycleExecutionContext(mod, metadata)
    if (!context.gameRoot) continue
    boundaries.add(path.resolve(context.gameRoot))
    owners.set(metadata.managedConfigOwner, { gameRoot: context.gameRoot, active: Number(mod.is_active) === 1 && Number(mod.profile_enabled ?? 1) === 1, patches: getManagedConfigPatches(metadata) })
  }
  return recoverManagedConfigOwners({ journalRoot: path.join(userPath, 'install-config-journals'), owners, boundaries: [...boundaries] })
}

function resolveClientGameRoot(game = {}, installRule = null) {
  const clientExePath = String(game?.client_exe_path || '').trim()
  const storedRootPath = String(game?.client_root_path || '').trim()
  const resolved = resolveKnownGameRoot({
    ruleJson: installRule,
    exePath: clientExePath,
    storedRootPath,
    useExeParentFallback: false
  })
  return resolved.rootPath || getParentPath(clientExePath) || ''
}

function resolveManagedWorkspaceRootFromPath(targetPath = '') {
  const safeTargetPath = path.resolve(String(targetPath || ''))
  const pathParts = safeTargetPath.split(path.sep).filter(Boolean)
  const vertexIndex = pathParts.findIndex((item, index) => {
    return (
      String(item || '')
        .trim()
        .toLowerCase() === 'vertex' &&
      String(pathParts[index + 1] || '')
        .trim()
        .toLowerCase() === 'dow'
    )
  })

  if (vertexIndex === -1) {
    return ''
  }

  return pathParts.slice(0, vertexIndex + 2).join(path.sep)
}

async function cleanupManagedEmptyParentDirs(targetPath = '') {
  const safeTargetPath = path.resolve(String(targetPath || ''))
  const workspaceRoot = resolveManagedWorkspaceRootFromPath(safeTargetPath)

  if (!workspaceRoot) {
    return
  }

  let currentPath = path.dirname(safeTargetPath)
  while (currentPath && currentPath !== workspaceRoot) {
    if (!isPathInside(workspaceRoot, currentPath)) {
      break
    }

    try {
      const stat = await fs.stat(currentPath)
      if (!stat.isDirectory()) {
        break
      }

      const childList = await fs.readdir(currentPath)
      if (childList.length > 0) {
        break
      }

      await fs.rmdir(currentPath)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        currentPath = path.dirname(currentPath)
        continue
      }
      break
    }

    const parentPath = path.dirname(currentPath)
    if (!parentPath || parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }
}

function waitForArchiveCleanupRetry(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function removeSourceArchiveWithRetry(filePath = '', maxAttemptCount = 3) {
  const safeFilePath = String(filePath || '').trim()
  const safeMaxAttemptCount = Math.max(1, Number(maxAttemptCount) || 1)

  if (!safeFilePath) {
    return {
      existed: false,
      removed: false,
      error: null
    }
  }

  if (!(await fs.pathExists(safeFilePath))) {
    return {
      existed: false,
      removed: false,
      error: null
    }
  }

  let lastError = null
  for (let attemptIndex = 0; attemptIndex < safeMaxAttemptCount; attemptIndex += 1) {
    try {
      await fs.remove(safeFilePath)
      if (!(await fs.pathExists(safeFilePath))) {
        return {
          existed: true,
          removed: true,
          error: null
        }
      }
      lastError = new Error('源压缩包删除后仍然存在')
    } catch (error) {
      lastError = error
      if (!(await fs.pathExists(safeFilePath))) {
        return {
          existed: true,
          removed: true,
          error: null
        }
      }
    }

    if (attemptIndex < safeMaxAttemptCount - 1) {
      await waitForArchiveCleanupRetry(
        INSTALL_FLOW_CONFIG.install.archiveCleanupRetryDelayMs * (attemptIndex + 1)
      )
    }
  }

  return {
    existed: true,
    removed: false,
    error: lastError
  }
}

async function resolveExecutableInfoFromDirectory(dirPath = '') {
  try {
    const nativeResult = normalizeRunnableFileInfo(
      await scanExecutablesInDirectoryByNodeApi(dirPath)
    )
    if (Number(nativeResult?.type || 0) > 0) {
      return nativeResult
    }
  } catch (error) {
    console.warn('原生可执行文件扫描失败，回退到 JS 实现', error)
  }

  if (!(await ensureDirectory(dirPath))) {
    return {
      type: 0,
      path: '',
      paths: []
    }
  }

  return await resolveRunnableFileInfoFromDirectory(dirPath)
}

function isInstallRuleRunnableFilePath(filePath = '') {
  return INSTALL_RULE_RUNNABLE_FILE_EXTENSIONS.has(
    path.extname(String(filePath || '')).toLowerCase()
  )
}

function normalizeRunnableFileInfo(paths = []) {
  const sourcePaths =
    paths && typeof paths === 'object' && !Array.isArray(paths)
      ? [String(paths?.path || '').trim(), ...(Array.isArray(paths?.paths) ? paths.paths : [])]
      : Array.isArray(paths)
        ? paths
        : []
  const runnablePaths = [
    ...new Set(
      sourcePaths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => isInstallRuleRunnableFilePath(item))
    )
  ]

  if (!runnablePaths.length) {
    return {
      type: 0,
      path: '',
      paths: []
    }
  }

  if (runnablePaths.length === 1) {
    return {
      type: 1,
      path: runnablePaths[0],
      paths: []
    }
  }

  return {
    type: 2,
    path: '',
    paths: runnablePaths
  }
}

async function resolveRunnableFileInfoFromDirectory(dirPath = '') {
  const snapshot = await collectDirectorySnapshot(dirPath, new Map())
  const runnablePaths = (Array.isArray(snapshot?.allFiles) ? snapshot.allFiles : [])
    .filter((item) => isInstallRuleRunnableFilePath(item?.fullPath || item?.name || ''))
    .map((item) => String(item?.fullPath || '').trim())
    .filter(Boolean)

  return normalizeRunnableFileInfo(runnablePaths)
}

function resolveRelativeTargetFilePath(targetRoot = '', relativePath = '') {
  const rawTargetRoot = String(targetRoot || '').trim()
  if (!rawTargetRoot) {
    return ''
  }

  const safeTargetRoot = path.resolve(rawTargetRoot)
  const normalizedRelativePath = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item && item !== '.')

  if (!safeTargetRoot || !normalizedRelativePath.length) {
    return ''
  }

  const targetPath = path.resolve(safeTargetRoot, ...normalizedRelativePath)
  return isPathInside(safeTargetRoot, targetPath) ? targetPath : ''
}

async function resolveRunnableFileInfoFromDeploySource(sourceRoot = '', targetRoot = '') {
  const rawSourceRoot = String(sourceRoot || '').trim()
  const rawTargetRoot = String(targetRoot || '').trim()
  if (!rawSourceRoot || !rawTargetRoot) {
    return {
      type: 0,
      path: '',
      paths: []
    }
  }

  const safeSourceRoot = path.resolve(rawSourceRoot)
  const safeTargetRoot = path.resolve(rawTargetRoot)
  if (!(await ensureDirectory(safeSourceRoot))) {
    return {
      type: 0,
      path: '',
      paths: []
    }
  }

  try {
    const snapshot = await collectDirectorySnapshot(safeSourceRoot, new Map())
    const runnableTargetPaths = (Array.isArray(snapshot?.allFiles) ? snapshot.allFiles : [])
      .filter((item) => isInstallRuleRunnableFilePath(item?.fullPath || item?.name || ''))
      .map((item) => resolveRelativeTargetFilePath(safeTargetRoot, item?.relativePath))
      .filter(Boolean)

    return normalizeRunnableFileInfo(runnableTargetPaths)
  } catch (error) {
    console.warn('根据安装源目录识别可运行文件失败', error)
    return {
      type: 0,
      path: '',
      paths: []
    }
  }
}

async function resolveInstallRuleRunnableInfo({
  sourceRoot = '',
  targetRoot = '',
  fallbackDir = '',
  allowFallbackScan = false
} = {}) {
  const sourceMappedInfo = await resolveRunnableFileInfoFromDeploySource(sourceRoot, targetRoot)
  if (Number(sourceMappedInfo?.type || 0) > 0) {
    return sourceMappedInfo
  }

  if (allowFallbackScan) {
    return await resolveExecutableInfoFromDirectory(fallbackDir || targetRoot)
  }

  return {
    type: 0,
    path: '',
    paths: []
  }
}

export async function nexusUpsertDetectedGamePath(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const appId = Number(target.appId || 0)
  const gameId = Number(target.gameId || 0)
  const exePath = String(target.exePath || target.clientExePath || '').trim()
  const rootPath = String(target.rootPath || target.clientRootPath || '').trim()
  const sourceMeta = normalizeGameSourceMeta(target.sourceMeta || target)
  const hasSourceIdentity = hasUsableSourceIdentity(sourceMeta)

  if ((!Number.isFinite(appId) || appId <= 0) && !hasSourceIdentity) {
    return {
      success: false,
      reason: 'invalid_source_identity'
    }
  }

  if (!exePath) {
    return {
      success: false,
      reason: 'empty_exe_path'
    }
  }

  const finalRootPath = rootPath || getParentPath(exePath)
  if (!finalRootPath) {
    return {
      success: false,
      reason: 'empty_root_path'
    }
  }

  if (!pathExistsSync(exePath)) {
    return {
      success: false,
      reason: 'exe_not_found'
    }
  }

  if (!pathExistsSync(finalRootPath)) {
    return {
      success: false,
      reason: 'root_not_found'
    }
  }

  await upsertGameRecord(
    appId,
    exePath,
    Number.isFinite(gameId) ? gameId : 0,
    finalRootPath,
    sourceMeta
  )
  return {
    success: true,
    reason: 'saved',
    game: getGameDataByAppId(appId, sourceMeta)
  }
}

export async function getGameLocalByAppId(event, data) {
  const { appId, executableFile, hasServer, serverExecutable, gameId } = data
  const sourceMeta = normalizeGameSourceMeta(data?.sourceMeta || data)
  const result = await getGameByAppId(appId, executableFile, gameId, sourceMeta)
  event.reply(result ? 'gamePathSearchSuccessful' : 'gamePathFailure', result || appId)

  if (!hasServer) {
    if (result) {
      getLocalGameData(event)
    }
    return
  }

  const isServerInstalled = Number(result?.is_server_installed || 0)
  const serverExePath = String(result?.server_exe_path || '')

  if (isServerInstalled) {
    if (serverExePath && fs.existsSync(serverExePath)) {
      event.reply('serverFoundSuccess')
      event.reply('updateLocalInfo', getGameDataByAppId(appId, sourceMeta))
      getLocalGameData(event)
      return
    } else {
      updateServerPath(appId, '', sourceMeta)
    }
  }

  if (serverExecutable) {
    const path = await scanDriveByFilename(serverExecutable)
    if (path) {
      updateServerPath(appId, path, sourceMeta)
      event.reply('serverFoundSuccess')
      event.reply('updateLocalInfo', getGameDataByAppId(appId, sourceMeta))
      getLocalGameData(event)
      return
    }
  }

  if (result) {
    getLocalGameData(event)
  }
  event.reply('serverFoundFailure')
}

export async function scanNowGameById(event, data) {
  const { appId, executableFile, gameId } = data
  const sourceMeta = normalizeGameSourceMeta(data?.sourceMeta || data)
  const path = await scanDriveByFilename(executableFile)

  if (path) {
    await upsertGameRecord(appId, path, gameId, '', sourceMeta)
    event.reply('scanNowGameSuccess')
    event.reply('homeGameListNeedRefresh')
  } else {
    event.reply('scanNowGameFail')
  }
}

export async function manuallyAddGame(event, data) {
  const { appId, executableFile, client_root_path, serverExecutable, type = 0, gameId } = data
  const sourceMeta = normalizeGameSourceMeta(data?.sourceMeta || data)
  let appName = type ? serverExecutable : executableFile
  let defaultPath = type ? '' : client_root_path
  let title = type ? '手动选择服务器' : '手动添加游戏'
  const extensions = appName ? [appName.split('.').pop()] : ['exe']

  const path = await selectFile({
    filters: [{ name: appName?.split('.')[0] || '可执行文件', extensions }],
    defaultPath,
    title,
    properties: ['openFile', 'dontAddToRecent']
  })

  if (!path) return event.reply('manuallyAddGameFail', { reason: 'cancelled' })

  // 验证文件类型
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.lnk') || !lowerPath.endsWith('.exe')) {
    return event.reply('manuallyAddGameFail', { reason: 'invalid_path' })
  }

  // 验证文件名
  if (appName && path.split(/[\\/]/).pop() !== appName) {
    return event.reply('manuallyAddGameFail', { reason: 'invalid_path' })
  }

  try {
    if (type === 0) {
      await upsertGameRecord(appId, path, gameId, '', sourceMeta)
      getLocalGameData(event)
      event.reply('manuallyAddGameSuccess')
      event.reply('homeGameListNeedRefresh')
      event.reply('updateLocalInfo', getGameDataByAppId(appId, sourceMeta))
    } else {
      updateServerPath(appId, path, sourceMeta)
      getLocalGameData(event)
      event.reply('serverFoundSuccess', 1)
      event.reply('updateLocalInfo', getGameDataByAppId(appId, sourceMeta))
    }
  } catch (error) {
    console.error('数据库操作失败:', error)
    event.reply('manuallyAddGameFail', { reason: 'db_error' })
  }
}



export async function installModsV2(event, filePath, data, type = 1) {
  await assertInstallSourceAvailable({ filePath, data })
  return await installModsExecuteV2(event, filePath, data, type)
}

export async function previewArchiveStructure(event, payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const filePath = String(target.filePath || '').trim()
  const appId = Number(target.appId || target.appid || 0)
  const usageType = Number(target.usageType || 1)

  if (!filePath) {
    return {
      success: false,
      message: '缺少压缩包路径'
    }
  }

  if (!(await fs.pathExists(filePath))) {
    return {
      success: false,
      message: '压缩包不存在'
    }
  }

  const previewFolderName = uuidv4()
  const previewGame = Number.isFinite(appId) && appId > 0 ? getGameDataByAppId(appId) : null
  const previewBasePath = String(
    previewGame?.client_root_path || previewGame?.client_exe_path || ''
  ).trim()
  const stagingPath = StagingManager.getStagingPath(
    Number.isFinite(appId) && appId > 0 ? appId : 'preview',
    previewFolderName,
    previewBasePath
  )

  try {
    await fs.remove(stagingPath)
    const result = await extractAndGetStructure(filePath, stagingPath, usageType, event)
    const { type = 0, msg = '', data = {} } = result || {}

    if (type === 0) {
      return {
        success: false,
        message: msg || '压缩包结构解析失败',
        archiveName: path.basename(filePath),
        filePath,
        structure: Array.isArray(data?.structure) ? data.structure : [],
        run: data?.run || null,
        data
      }
    }

    return {
      success: true,
      message: '压缩包结构解析成功',
      archiveName: path.basename(filePath),
      filePath,
      structure: Array.isArray(data?.structure) ? data.structure : [],
      run: data?.run || null,
      data
    }
  } catch (error) {
    console.error('previewArchiveStructure 执行异常', error)
    return {
      success: false,
      message: error?.message || '压缩包结构解析失败'
    }
  } finally {
    try {
      await fs.remove(stagingPath)
    } catch (cleanupError) {
      console.warn('previewArchiveStructure 清理暂存目录失败', cleanupError)
    }
  }
}

export async function inspectSourceInstallPlan(event, payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const filePath = String(target.filePath || '').trim()
  const data = target?.data && typeof target.data === 'object' ? target.data : {}
  const appId = Number(data?.appid || data?.appId || target.appId || target.appid || 0)
  const usageType = Number(data?.usageType || target.usageType || 1)
  const packageFolderName = uuidv4()
  const sourceMeta = buildModSourceMeta(data)
  const rulePlatformContext = buildInstallRulePlatformContext(data, sourceMeta)
  const installRuleDomainName = normalizeNexusDomainName(rulePlatformContext.domainName)

  if (!filePath) {
    return {
      success: false,
      message: '缺少压缩包路径'
    }
  }

  if (!(await fs.pathExists(filePath))) {
    return {
      success: false,
      message: '压缩包不存在'
    }
  }

  const hasSourceIdentity = hasUsableSourceIdentity(sourceMeta)

  const packageSupport = await inspectPackageInstallability(filePath)
  if (packageSupport.supported === false) {
    return {
      success: false, matched: false, code: packageSupport.code,
      failureStage: 'unsupported_package', message: packageSupport.message, packageSupport
    }
  }

  if ((!Number.isFinite(appId) || appId <= 0) && !hasSourceIdentity) {
    return {
      success: false,
      message: '缺少有效的游戏来源标识'
    }
  }

  const game = getGameDataByAppId(appId, sourceMeta)
  if (!game?.client_exe_path) {
    return {
      success: false,
      message: '未找到游戏安装信息'
    }
  }

  const installRule = resolveCompiledNexusInstallRule(rulePlatformContext.installRule) || {}
  const gameRoot = resolveClientGameRoot(game, installRule)
  const installRules = Array.isArray(installRule?.install_rules) ? installRule.install_rules : []
  const hasInstallRuleCapability = hasSourceInstallRuleCapability(installRule)
  const baseRecognitionPayload = {
    installRule,
    sourceMeta,
    sourcePlatform: rulePlatformContext.source || sourceMeta?.source || data?.sourceType || 'nexus',
    domainName: rulePlatformContext.domainName,
    gameId: Number(data?.gameId || sourceMeta?.gameId || 0),
    nexusGameId: rulePlatformContext.sourceGameId,
    sourceGameId: rulePlatformContext.sourceGameId,
    modId: Number(data?.modId || 0),
    fileId: Number(data?.id || 0)
  }
  logNexusInstallRuleDebug('inspect_plan.received', {
    filePath,
    appId,
    source: rulePlatformContext.source,
    gameRoot,
    installRuleCount: installRules.length,
    hasInstallRuleCapability
  })

  if (!hasInstallRuleCapability) {
    const inspectMeta = buildInstallInspectMeta({}, null)
    return {
      success: true,
      matched: false,
      reason: 'no_install_rules',
      archiveName: path.basename(filePath),
      filePath,
      structure: [],
      run: null,
      data: inspectMeta,
      installPlan: null,
      recognitionSummary: buildNexusInstallRecognitionSummary({
        ...baseRecognitionPayload,
        inspectMeta,
        matchedPlan: null
      })
    }
  }

  const previewFolderName = uuidv4()
  const stagingPath = StagingManager.getStagingPath(appId, previewFolderName, gameRoot)
  let shouldCleanupStaging = true

  try {
    await fs.remove(stagingPath)
    const result = await extractAndGetStructure(filePath, stagingPath, usageType, event)
    const { type = 0, msg = '', data: structureData = {} } = result || {}
    let executableInfo = null
    const ensureExecutableInfo = async () => {
      if (executableInfo && typeof executableInfo === 'object') {
        return executableInfo
      }

      executableInfo =
        structureData?.run && Number(structureData?.run?.type || 0) > 0
          ? structureData.run
          : await resolveExecutableInfoFromDirectory(stagingPath)
      return executableInfo
    }

    if (type === 0) {
      const resolvedExecutableInfo = await ensureExecutableInfo()
      const inspectMeta = buildInstallInspectMeta(structureData, resolvedExecutableInfo)
      return {
        success: false,
        message: msg || '压缩包结构解析失败',
        matched: false,
        archiveName: path.basename(filePath),
        filePath,
        structure: Array.isArray(structureData?.structure) ? structureData.structure : [],
        run: resolvedExecutableInfo,
        data: inspectMeta,
        recognitionSummary: buildNexusInstallRecognitionSummary({
          ...baseRecognitionPayload,
          inspectMeta,
          matchedPlan: null
        })
      }
    }

    const matchedPlan = await inspectSourceInstallPlanByEngine({
      ...getRulePlanningState(game, data, sourceMeta, Number(data.endpointType ?? data.taskType ?? 0)),
      source: rulePlatformContext.source,
      domainName: installRuleDomainName,
      sourceGameId: rulePlatformContext.sourceGameId,
      sourceMeta,
      data,
      stagingPath,
      gameRoot,
      installRule,
      packageFolderName
    })

    const normalizedMatchedPlan = normalizeResolvedNexusInstallPlan(matchedPlan)
    if (normalizedMatchedPlan) {
      const resolvedExecutableInfo = await ensureExecutableInfo()
      const inspectMeta = buildInstallInspectMeta(structureData, resolvedExecutableInfo)
      const stagingToken = await storeNexusInstallPreviewStaging({
        appId,
        filePath,
        stagingPath,
        installPlan: normalizedMatchedPlan,
        structure: Array.isArray(structureData?.structure) ? structureData.structure : []
      })
      shouldCleanupStaging = false

      return {
        success: true,
        matched: true,
        reason: 'matched',
        archiveName: path.basename(filePath),
        filePath,
        stagingToken,
        autoExecutable: normalizedMatchedPlan.autoExecutable !== false,
        requiresUserConfirm: normalizedMatchedPlan.requiresUserConfirm === true,
        confirmReason: String(normalizedMatchedPlan.confirmReason || '').trim(),
        warnings: Array.isArray(normalizedMatchedPlan.warnings)
          ? normalizedMatchedPlan.warnings
          : [],
        risks: Array.isArray(normalizedMatchedPlan.risks) ? normalizedMatchedPlan.risks : [],
        installPlan: normalizedMatchedPlan,
        recognitionSummary: buildNexusInstallRecognitionSummary({
          ...baseRecognitionPayload,
          inspectMeta,
          matchedPlan: normalizedMatchedPlan
        })
      }
    }

    const resolvedExecutableInfo = await ensureExecutableInfo()
    const inspectMeta = buildInstallInspectMeta(structureData, resolvedExecutableInfo)

    return {
      success: true,
      matched: false,
      reason: 'rule_not_matched',
      archiveName: path.basename(filePath),
      filePath,
      structure: Array.isArray(structureData?.structure) ? structureData.structure : [],
      run: resolvedExecutableInfo,
      data: inspectMeta,
      installPlan: null,
      recognitionSummary: buildNexusInstallRecognitionSummary({
        ...baseRecognitionPayload,
        inspectMeta,
        matchedPlan: null
      })
    }
  } catch (error) {
    console.error('inspectSourceInstallPlan 执行异常', error)
    return {
      success: false,
      matched: false,
      code: error?.code || '',
      selectionRequest: error?.detail?.selectionRequest || null,
      message: error?.message || '安装规则预检失败'
    }
  } finally {
    if (shouldCleanupStaging) {
      try {
        await fs.remove(stagingPath)
      } catch (cleanupError) {
        console.warn('inspectSourceInstallPlan 清理暂存目录失败', cleanupError)
      }
    }
  }
}

export async function inspectNexusInstallPlan(event, payload = {}) {
  return inspectSourceInstallPlan(event, payload)
}

export async function getInstalledModsBySource(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const appId = Number(target.appId || target.appid || 0)
  const endpointType = Number(target.endpointType || target.type || 0)
  const sourceMeta =
    target.sourceMeta && typeof target.sourceMeta === 'object' ? target.sourceMeta : {}
  const hasSourceIdentity = hasUsableSourceIdentity(sourceMeta)

  if ((!Number.isFinite(appId) || appId <= 0) && !hasSourceIdentity) {
    return {
      success: false,
      message: '缺少有效的游戏来源标识',
      records: []
    }
  }

  const repairResult =
    sourceMeta?.repairUnscopedProfile === true
      ? repairUnscopedModProfileBySourceSql(appId, endpointType, sourceMeta)
      : { changes: 0, records: [] }

  return {
    success: true,
    repairResult,
    records: (getModListByAppIdSql(appId, endpointType, sourceMeta) || []).map((mod) => ({
      ...mod,
      canRemoveRecordOnly: canRemoveMissingGameModRecord(mod)
    }))
  }
}

function canRemoveMissingGameModRecord(mod = {}) {
  // 仅处理 Nexus 客户端安装记录；不能把权限错误或缺少绑定当成目录已删除。
  if (mod.source !== 'nexus' || Number(mod.endpoint_type) !== 0 || mod.install_model === 'bound') return false
  const game = dbInstance.get('SELECT * FROM games WHERE id = ?', [Number(mod.game_id)])
  const root = String(game?.client_root_path || '').trim()
  if (!root || !path.isAbsolute(root)) return false
  try {
    fs.statSync(root)
    return false
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR'
  }
}

async function removeMissingGameModRecord(event, id, options = {}) {
  const scope = getModDeployScopeById(id)
  return withDeploymentScopeMutationLocks(scope ? [scope] : [], () => {
    const mod = dbInstance.get('SELECT * FROM mods WHERE id = ?', [id])
    if (!mod || !canRemoveMissingGameModRecord(mod)) {
      return { success: false, id, code: 'game_root_not_missing', message: '游戏目录状态已变化，未移除记录，请刷新后重试' }
    }
    // 不运行禁用、部署重建、生命周期脚本或文件清理，避免重建已经消失的游戏目录。
    dbInstance.transaction(() => {
      dbInstance.run('DELETE FROM mod_file_manifest WHERE mod_id = ?', [id])
      dbInstance.run('DELETE FROM mod_file_owners WHERE owner_mod_id = ?', [id])
      deleteManagedFileAssetOwnersByOwner({ ownerType: 'mod', ownerId: String(id) })
      dbUninstallMod(id)
    })
    event.reply('uninstallModSuccess', mod.name)
    event.reply('uninstallModSuccess-modM')
    getLocalModData(event)
    return { success: true, id, recordOnly: true, message: '游戏目录已缺失，已移除模组安装记录；源文件、缓存和备份已保留' }
  }, { token: options.scopeLockToken, ownerId: `remove-record:${id}`, operation: 'uninstall' })
}

async function installModsExecuteV2(event, filePath, data, iType) {
  const {
    appid,
    name,
    cover,
    clientInstallPath,
    serverInstallPath,
    fileSize,
    installType,
    version,
    id,
    taskType,
    modName,
    modId,
    typeId,
    usageType,
    fileMd5,
    modVersion,
    isUp = 0,
    sourceGameDomain = '',
    gameDomainName = '',
    nexusGameDomain = ''
  } = data
  // deferActivation：仅入库 + 解压暂存，但**不部署到游戏目录、不写 mod_file_owners**，
  // 入库时强制 is_active=0 / install_state=0。
  // 用户从模组管理页点「启用」时再走标准 toggleModState → deploy 流程。
  // 当前唯一使用方：离线安装包导入（用户期望「先导入再按需启用」）。
  const deferActivation = data?.deferActivation === true
  const returnData = data
  const sourceMeta = buildModSourceMeta(data)
  const profileName =
    String(
      data.profileName ||
        data.targetProfileName ||
        sourceMeta.profileName ||
        sourceMeta.targetProfileName ||
        'default'
    ).trim() || 'default'
  const rulePlatformContext = buildInstallRulePlatformContext(
    {
      ...data,
      sourceGameDomain: sourceGameDomain || gameDomainName || nexusGameDomain
    },
    sourceMeta
  )
  const isRuleManagedSource = rulePlatformContext.isRuleManaged
  const installRuleDomainName = normalizeNexusDomainName(rulePlatformContext.domainName)
  const nexusDomainName = installRuleDomainName
  const nexusInstallRule = resolveCompiledNexusInstallRule(rulePlatformContext.installRule) || {}
  const previewToken = resolveNexusInstallPreviewToken(data)
  const pendingPreviewCleanupPathSet = new Set()
  const shouldCleanupSourceArchiveAfterInstall = !!data?.cleanupSourceArchiveAfterInstall
  const cleanupPendingPreviewStaging = async () => {
    const stagingPathList = [...pendingPreviewCleanupPathSet]
    pendingPreviewCleanupPathSet.clear()

    for (const stagingPath of stagingPathList) {
      if (!String(stagingPath || '').trim()) {
        continue
      }
      try {
        await fs.remove(stagingPath)
      } catch (error) {
        console.warn('清理预检复用暂存目录失败', {
          stagingPath,
          error
        })
      }
    }
  }
  const cleanupSourceArchiveAfterInstall = async () => {
    const safeFilePath = String(filePath || '').trim()
    if (!shouldCleanupSourceArchiveAfterInstall || !safeFilePath) {
      return
    }

    try {
      const cleanupResult = await removeSourceArchiveWithRetry(safeFilePath)
      if (!cleanupResult.existed || cleanupResult.removed) {
        try {
          deleteDownloadRecordsByFilePath(safeFilePath)
        } catch (error) {
          console.warn('安装成功后清理源压缩包下载记录失败', {
            filePath: safeFilePath,
            error
          })
        }
      }
      if (!cleanupResult.existed) {
        return
      }

      if (!cleanupResult.removed) {
        throw cleanupResult.error || new Error('源压缩包删除失败')
      }

      await cleanupManagedEmptyParentDirs(safeFilePath)
    } catch (error) {
      console.warn('安装成功后删除源压缩包失败', {
        filePath: safeFilePath,
        error
      })
    }
  }
  logNexusInstallRuleDebug('install_v2.received', {
    filePath,
    appid,
    modId,
    optionId: id,
    sourceMeta,
    source: rulePlatformContext.source,
    nexusDomainName,
    installRuleCount: Array.isArray(nexusInstallRule?.install_rules)
      ? nexusInstallRule.install_rules.length
      : 0,
    hasPreviewToken: !!previewToken
  })

  const resolvedInstallPlans = []
  const deployReconcileResults = []
  const getLastResolvedInstallPlan = () =>
    resolvedInstallPlans.length > 0 ? resolvedInstallPlans[resolvedInstallPlans.length - 1] : null
  const getLastDeployReconcileResult = () =>
    deployReconcileResults.length > 0
      ? deployReconcileResults[deployReconcileResults.length - 1]
      : null

  const failResult = (message = '安装失败', shouldNotify = true, context = {}) => {
    cleanupPendingPreviewStaging().catch((error) => {
      console.warn('安装失败后清理预检暂存目录失败', error)
    })
    const userMessage = replyModInstallFailed(event, returnData, message, context, {
      notify: shouldNotify
    })
    return {
      success: false,
      message: userMessage,
      rawMessage: returnData.rawErrorMsg,
      code: String(context?.code || context?.errorCode || '').trim(),
      needRecovery: context?.needRecovery === true,
      stage: String(context?.stage || context?.failureStage || '').trim(),
      modId: Number(context?.modId || 0),
      modName: String(context?.modName || '').trim(),
      sourcePath: String(context?.sourcePath || '').trim(),
      systemError:
        context?.systemError && typeof context.systemError === 'object' ? context.systemError : {},
      id,
      taskType,
      installPlan: getLastResolvedInstallPlan(),
      installPlans: resolvedInstallPlans,
      reconcileResult: getLastDeployReconcileResult(),
      reconcileResults: deployReconcileResults
    }
  }

  try {
    const game = getGameDataByAppId(appid, sourceMeta)
    if (!game) {
      return failResult('无法找到安装路径')
    }

    const { is_server_installed, server_install_mod_type, client_exe_path, server_exe_path } = game

    if (server_install_mod_type === 0 && taskType === 1) {
      return failResult('服务器已经禁用安装Mod')
    }

    const boolean = queryServerModInstallStatus({
      game_id: appid,
      mod_id: modId,
      option_id: id,
      sourceMeta
    })

    let installModeToExecute =
      taskType === 0 && server_install_mod_type === 1 && installType !== 1 && boolean
        ? [0, 1]
        : [taskType]

    if (installModeToExecute.includes(1) && !is_server_installed) {
      const serverMissingMessage = replyInstallWarning(event, '未找到服务器')

      if (installModeToExecute.length === 1) {
        replyModInstallFailed(event, returnData, '未找到服务器', {}, { notify: false })
        return {
          success: false,
          message: serverMissingMessage,
          rawMessage: returnData.rawErrorMsg,
          id,
          taskType
        }
      }
      installModeToExecute = [0]
    }

    let installedCount = 0
    const installedRecords = []

    for (const int of installModeToExecute) {
      let install_paths_json = []
      let metadata_json = {
        metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
      }
      let modByData = getModByData({
        game_id: appid,
        mod_id: modId,
        option_id: id,
        endpoint_type: int,
        profileName,
        sourceMeta
      })
      const updateTargetModId = Number(data.updateTargetModId || 0)
      if (data.updateTargetModId !== undefined &&
          (!Number.isSafeInteger(updateTargetModId) || updateTargetModId <= 0 ||
           !String(data.profileName || data.targetProfileName || '').trim())) {
        throw new Error('更新必须指定有效的安装记录和配置档案，请刷新后重试')
      }
      if (updateTargetModId && data.sourceModpackPreviousLocalModId &&
          updateTargetModId !== Number(data.sourceModpackPreviousLocalModId)) {
        throw new Error('更新目标记录不一致，请重新预检')
      }
      const previousLocalModId = updateTargetModId || Number(data.sourceModpackPreviousLocalModId || 0)
      if (previousLocalModId > 0) {
        const previous = dbInstance.get('SELECT * FROM mods WHERE id = ?', [previousLocalModId])
        if (!previous || Number(previous.game_id) !== Number(game.id) ||
            Number(previous.endpoint_type || 0) !== int ||
            String(previous.source || '').toLowerCase() !== String(sourceMeta.source || '').toLowerCase() ||
            String(previous.mod_id) !== String(modId) ||
            String(previous.profile_name || 'default').toLowerCase() !== profileName.toLowerCase() ||
            (modByData && Number(modByData.id) !== previousLocalModId)) {
          throw new Error('更新目标已变化或不属于当前游戏与配置，请重新预检')
        }
        if (updateTargetModId &&
            (String(previous.option_id) !== String(data.updateExpectedFileId) ||
             String(previous.version || previous.mod_version || '') !== String(data.updateExpectedVersion ?? ''))) {
          throw Object.assign(new Error('待更新版本已发生变化，请刷新后重新提交'), { code: 'mod_update_stale' })
        }
        modByData = previous
      }

      // 防止旧入口通过唯一 source_mod_key 的 upsert 冒充首次安装覆盖现有记录。
      if (!modByData && data.sourceModKey) {
        const collision = dbInstance.get(`SELECT id FROM mods WHERE game_id = ? AND source_mod_key = ?
          AND endpoint_type = ? AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?`,
        [game.id, String(data.sourceModKey), int, profileName.toLowerCase()])
        if (collision) throw new Error('已有安装记录，更新必须明确指定旧记录，请刷新后重试')
      }

      if (modByData && !previousLocalModId && !isUp && Number(modByData.is_active ?? 1) === 1) {
        continue
      }

      const planningState = getRulePlanningState(game, { ...data, profileName }, sourceMeta, int, modByData)
      const exe_path = int === 0 ? client_exe_path : server_exe_path
      const gameRoot =
        int === 0 ? resolveClientGameRoot(game, nexusInstallRule) : getParentPath(exe_path)
      const installPath = String(int === 0 ? clientInstallPath || '' : serverInstallPath || '')
      let fullInstallPath = ''
      const fileNameWithoutExt = uuidv4()
      let deploySourceRoot = ''
      let deployLifecycleStagingRoot = ''
      let deployTargetRoot = ''
      let resolvedUsageType = normalizeInstallUsageType(usageType, 1)
      let deployPlan = null
      let structureData = {}

      let stagingPath = resolveInstallStagingPath(data, appid, fileNameWithoutExt, gameRoot)

      switch (resolvedUsageType) {
        case 1:
          fullInstallPath = path.join(gameRoot, installPath)
          break
        case 2:
          fullInstallPath = path.join(userPath, 'modifier', String(appid), fileNameWithoutExt)
          fs.mkdirSync(fullInstallPath, { recursive: true })
          break
        case 3:
          fullInstallPath = getPath(installPath)
          break
        case 4:
          fullInstallPath = path.join(gameRoot, installPath)
          break
      }
      deploySourceRoot = stagingPath
      deployLifecycleStagingRoot = stagingPath
      deployTargetRoot = fullInstallPath

      if (isRuleManagedSource && int === 0 && usageType === 1) {
        const cachedPreviewEntry = await consumeNexusInstallPreviewStaging(previewToken, {
          appId: appid,
          filePath
        })

        if (cachedPreviewEntry) {
          try {
            stagingPath = path.resolve(String(cachedPreviewEntry?.stagingPath || ''))
            deploySourceRoot = stagingPath
            structureData = {
              structure: Array.isArray(cachedPreviewEntry?.structure)
                ? cachedPreviewEntry.structure
                : []
            }
            deployPlan = await resolveCachedSourceInstallPreviewPlan(cachedPreviewEntry, gameRoot, { data, ...planningState })
            logNexusInstallRuleDebug('install_v2.reuse_preview_plan', {
              filePath,
              previewToken,
              gameRoot,
              stagingPath,
              installPlan: normalizeResolvedNexusInstallPlan(cachedPreviewEntry?.installPlan)
            })
            pendingPreviewCleanupPathSet.add(stagingPath)
            emitInstallStructureDebug(event, {
              stage: 'install.reuse_preview',
              filePath,
              structureData
            })
          } catch (error) {
            if (error?.code === 'install_engine.preview_stale' || error?.code === 'install_engine.fact_unknown') {
              pendingPreviewCleanupPathSet.add(cachedPreviewEntry.stagingPath)
              return failResult(error.message, true, error)
            }
            console.warn('复用预检结果失败，已回退到重新解压', error)
            await fs.remove(String(cachedPreviewEntry?.stagingPath || '')).catch(() => {})
            stagingPath = resolveInstallStagingPath(data, appid, fileNameWithoutExt, gameRoot)
            deploySourceRoot = stagingPath
            deployPlan = null
            structureData = {}
          }
        }
      }

      if (!deployPlan) {
        const result = await extractAndGetStructure(filePath, stagingPath, resolvedUsageType, event)
        const { type = 0, msg = '', data: extractedStructureData = {} } = result
        structureData =
          extractedStructureData && typeof extractedStructureData === 'object'
            ? extractedStructureData
            : {}

        emitInstallStructureDebug(event, {
          stage: 'install.extract',
          filePath,
          structureData
        })

        if (type === 0) {
          return failResult(msg || '文件解压失败')
        }
      }

      if (isRuleManagedSource) {
        if (int !== 0) {
          return failResult(`${rulePlatformContext.platformLabel} 模组暂不支持服务端安装`)
        }

        if (usageType !== 1) {
          return failResult(`${rulePlatformContext.platformLabel} 自动安装仅支持标准资源包`)
        }

        if (!deployPlan) {
          deployPlan = await resolveSourceInstallPlanByEngine({
            ...planningState,
            source: rulePlatformContext.source,
            domainName: installRuleDomainName,
            sourceGameId: rulePlatformContext.sourceGameId,
            sourceMeta,
            data,
            stagingPath,
            gameRoot,
            packageFolderName: fileNameWithoutExt,
            installRule: nexusInstallRule,
            jobId: data.sourceInstallJobId || data.jobId,
            itemId: data.sourceInstallItemId || data.itemId,
            deployScope: {
              gameId: Number(game?.id || 0),
              source: rulePlatformContext.source,
              endpointType: int,
              deployDomain: installRuleDomainName
            }
          })
          logNexusInstallRuleDebug('install_v2.resolved_deploy_plan', {
            filePath,
            gameRoot,
            stagingPath,
            deployPlan: normalizeResolvedNexusInstallPlan(deployPlan)
          })
        }
        resolvedUsageType = normalizeInstallUsageType(deployPlan.usageType, resolvedUsageType)
        deploySourceRoot = deployPlan.sourceRoot
        deployLifecycleStagingRoot = String(
          deployPlan?.lifecycleStagingRoot || deployPlan?.sourceRoot || stagingPath
        ).trim()
        deployTargetRoot = deployPlan.targetRoot
        fullInstallPath = deployPlan.targetRoot
        writeInstallRulePlanMetadata(metadata_json, deployPlan, {
          source: rulePlatformContext.source,
          domainName: installRuleDomainName,
          usageType: resolvedUsageType,
          lifecycleStagingRoot: deployLifecycleStagingRoot
        })
        const normalizedResolvedPlan = normalizeResolvedNexusInstallPlan(deployPlan)
        if (normalizedResolvedPlan) {
          resolvedInstallPlans.push(normalizedResolvedPlan)
        }
      }

      const useSafeDeployReconcile = getModFeatureFlags().enablePriorityReconcile
      const previousMetadata = parseJsonObjectSafe(modByData?.metadata_json)
      metadata_json.managedConfigOwner = previousMetadata.managedConfigOwner || uuidv4()
      let managedConfigTransition = null
      const lifecycleReceipts = []
      const activate = !deferActivation && (!modByData || Number(modByData.is_active ?? 1) === 1)
      // 在任何替换动作前完成授权，拒绝授权时旧版本保持原样。
      const lifecycleAuth = activate
        ? await requestLifecycleAuthorization(deployPlan, deployPlan?.postInstallSteps || [], event, {
          gameRoot, stagingRoot: deployLifecycleStagingRoot || deploySourceRoot,
          targetRoot: deployTargetRoot, targetBaseType: deployPlan?.targetBaseType || 'game'
        })
        : { authorized: true }
      if (!lifecycleAuth.authorized) {
        return failResult(`生命周期命令动作未获授权（${lifecycleAuth.reason}），安装已中止`)
      }
      let savedMod = null
      const validatePlanningState = () => assertSourceInstallPlanCurrent(deployPlan, gameRoot, {
        data, ...getRulePlanningState(game, { ...data, profileName }, sourceMeta, int, modByData)
      })
      const commitInstall = async (scopeLockToken) => {
        if (!modByData) await validatePlanningState()
        if (!useSafeDeployReconcile && isRuleManagedSource && activate) {
          const runtimeBackupResult = await backupRuntimeOverwriteTargets({
            source: rulePlatformContext.source,
            gameRowId: Number(game?.id || 0),
            optionId: id,
            endpointType: int,
            sourceRoot: deploySourceRoot,
            targetRoot: deployTargetRoot,
            modName: String(modName || name || '').trim(),
            sourceModKey: data.sourceModKey
          })

          if (!runtimeBackupResult?.success) {
            throw new Error(runtimeBackupResult?.message || '启用前备份被覆盖文件失败')
          }
        }

        let traditionalDeployed = false
        let insertedModId = 0
        let reconcileApplied = false

        try {
          const config = deployPlan?.replayContext?.declarative?.config || []
          const previousConfig = getManagedConfigPatches(previousMetadata)
          const applyManagedConfig = async () => {
            if (config.length || previousConfig.length) {
              managedConfigTransition = await transitionManagedConfigs({
                journalRoot: path.join(userPath, 'install-config-journals'),
                owner: metadata_json.managedConfigOwner,
                gameRoot,
                patches: config,
                previousPatches: previousConfig,
                active: activate
              })
            }
          }
          if (!useSafeDeployReconcile && activate) {
            traditionalDeployed = true
            await StagingManager.deploy(deploySourceRoot, deployTargetRoot)
          }

          if (!useSafeDeployReconcile) await applyManagedConfig()

          if (!useSafeDeployReconcile && activate) {
            await applyInstallRulePostInstallSteps({
              receipts: lifecycleReceipts,
              postInstallSteps: deployPlan?.postInstallSteps || [],
              gameRoot,
              stagingRoot: deployLifecycleStagingRoot || deploySourceRoot,
              targetRoot: deployTargetRoot,
              targetBaseType: deployPlan?.targetBaseType || 'game',
              lifecycleCommandContext: buildLifecycleCommandContext(deployPlan?.trustLevel, {
                authorizedByUser: lifecycleAuth.authorized
              })
            })
          }

          install_paths_json = structureData.structure

          metadata_json.stagingPath = deploySourceRoot || stagingPath
          metadata_json.targetPath = fullInstallPath
          writeDownloadStorageContextMetadata(metadata_json, data)

          if (resolvedUsageType !== 1 || deployPlan?.targetBaseType !== 'game') {
            metadata_json.open_path = fullInstallPath
          }

          const executableInfo = await resolveInstallRuleRunnableInfo({
            sourceRoot: deploySourceRoot,
            targetRoot: deployTargetRoot,
            fallbackDir: fullInstallPath,
            allowFallbackScan:
              resolvedUsageType === 2 || resolvedUsageType === 4 || deployPlan?.isRunnable
          })
          if (
            Number(executableInfo?.type || 0) > 0 ||
            resolvedUsageType === 2 ||
            resolvedUsageType === 4 ||
            deployPlan?.isRunnable
          ) {
            metadata_json.executablePath = executableInfo
            metadata_json.isRunnable = Number(executableInfo?.type || 0) > 0
          }

          const modData = {
            appid,
            sourceMeta,
            source: sourceMeta.source,
            modId,
            id,
            modName,
            name,
            description: String(
              data.description || data.summary || data.modDescription || data.desc || ''
            ).trim(),
            version,
            downloadUrl: data.downloadUrl,
            fileSize,
            install_paths_json,
            metadata_json: {
              ...metadata_json,
              sourceType: sourceMeta.source,
              sourceId: sourceMeta.sourceId,
              sourceSlug: sourceMeta.sourceSlug,
              sourceGameDomain: nexusDomainName || '',
              shareLinks: Array.isArray(data.shareLinks) ? data.shareLinks : [],
              // 离线包导入路径标记：toggleModState 启用时无需重新预检即可使用此 staging。
              deferActivation: deferActivation || undefined
            },
            installType,
            usageType: resolvedUsageType,
            cover,
            typeId,
            endpoint_type: int,
            fileMD5: fileMd5,
            modVersion,
            source_mod_key: data.sourceModKey,
            packageOwner: data.packageOwner,
            packageName: data.packageName,
            profileName,
            archivePath: data.archivePath,
            stagingPath: metadata_json.stagingPath || data.stagingPath,
            targetPath: metadata_json.targetPath || data.targetPath,
            dependencies: data.dependencies,
            files: data.files,
            metadata: data.metadata,
            // 延迟激活：模组管理列表显示为「未启用」，用户手动启用时再走 toggleModState。
            isActive: activate ? 1 : 0,
            installState: activate ? 1 : 0
          }

          if (modByData) replaceModById(modByData, modData, { replaceSourceModKey: previousLocalModId > 0 })
          else await insertMod(modData)
          savedMod = modByData
            ? dbInstance.get('SELECT * FROM mods WHERE id = ?', [modByData.id])
            : getModByData({
                game_id: appid,
                mod_id: modId,
                option_id: id,
                endpoint_type: int,
                profileName,
                sourceMeta
              })
          insertedModId = savedMod?.id || 0
          if (useSafeDeployReconcile && !savedMod?.id && activate) {
            throw new Error('安装记录写入后未找到对应模组，无法执行安全部署重建')
          }
          if (useSafeDeployReconcile && savedMod?.id &&
              (activate || (modByData && Number(modByData.is_active ?? 1) === 1))) {
            const reconcileResult = await reconcileDeploy({
              mode: 'install_rebuild',
              modId: savedMod.id,
              reason: 'install_mod',
              scopeLockToken
            })
            deployReconcileResults.push(reconcileResult)
            if (!reconcileResult?.success) {
              throw Object.assign(
                new Error(reconcileResult?.message || '安全部署重建失败'),
                reconcileResult
              )
            }
            reconcileApplied = true
          }
          // Deploy the base file before applying fields; a later rebuild must preserve them.
          if (useSafeDeployReconcile) await applyManagedConfig()
          if (useSafeDeployReconcile && activate) {
            await applyInstallRulePostInstallSteps({
              receipts: lifecycleReceipts,
              postInstallSteps: deployPlan?.postInstallSteps || [],
              gameRoot,
              stagingRoot: deployLifecycleStagingRoot || deploySourceRoot,
              targetRoot: deployTargetRoot,
              targetBaseType: deployPlan?.targetBaseType || 'game',
              lifecycleCommandContext: buildLifecycleCommandContext(deployPlan?.trustLevel, {
                authorizedByUser: lifecycleAuth.authorized
              })
            })
          }
        } catch (commitError) {
          try { await rollbackLifecycleReceipts(lifecycleReceipts) } catch (recoveryError) { commitError.needRecovery = true; commitError.message += `；${recoveryError.message}` }
          // Release fields while their deployed base files still exist, before file rollback.
          try {
            await managedConfigTransition?.rollback()
            managedConfigTransition = null
          } catch (recoveryError) {
            commitError.needRecovery = true
            commitError.message += `；${recoveryError.message}`
          }
          // 更新事务负责恢复旧记录及文件，不能按首次安装逻辑删除同一个记录 ID。
          if (modByData) throw commitError
          await rollbackInstallArtifacts({
            useSafeDeployReconcile,
            traditionalDeployed,
            reconcileApplied,
            deploySourceRoot,
            deployTargetRoot,
            insertedModId
          })
          throw commitError
        }
      }
      try {
        if (modByData) {
          await runModUpdateTransaction(
            {
              previousMod: modByData,
              sourceRoot: deploySourceRoot,
              targetRoot: deployTargetRoot,
              useSafeDeployReconcile,
              previousUsesReconcile: isUnifiedDeployManagedMod(modByData),
              activate
            },
            commitInstall,
            {
              getScope: getModDeployScopeById,
              readMod: (modRecordId) =>
                dbInstance.get('SELECT * FROM mods WHERE id = ?', [modRecordId]),
              restoreMod: restoreModRecordSnapshot,
              validateBeforeMutation: validatePlanningState,
              ensureWritable: ensureModSourcesWritableForMutation,
              lockSource: async (mod) => {
                const result = await lockModSource(mod)
                updateModSourceLockState(mod.id, result.success ? 'locked' : 'repair_required')
                return result
              },
              reconcile: reconcileDeploy,
              undeploy: (source, target) => StagingManager.undeploy(source, target),
              cleanupStaging: async (oldPath) => {
                const oldMeta = parseJsonObjectSafe(modByData.metadata_json)
                const stagingRoot =
                  oldMeta.storageContext?.stagingRoot ||
                  path.join(StagingManager.getWorkspaceRootPath(gameRoot), 'staging', String(appid))
                const resolvedOldPath = path.resolve(oldPath)
                if (
                  resolvedOldPath === path.resolve(stagingRoot) ||
                  !isPathInside(stagingRoot, resolvedOldPath) ||
                  !isRealPathInside(stagingRoot, resolvedOldPath)
                )
                  return
                const shared = dbInstance
                  .all('SELECT * FROM mods WHERE id <> ?', [
                    modByData.id
                  ])
                  .filter((record) => {
                    const otherPath = String(
                      parseJsonObjectSafe(record.metadata_json).stagingPath ||
                        record.staging_path ||
                        ''
                    ).trim()
                    return (
                      otherPath &&
                      (isPathInside(resolvedOldPath, otherPath) ||
                        isPathInside(otherPath, resolvedOldPath))
                    )
                  })
                if (shared.length) {
                  for (const record of shared.filter((item) => Number(item.is_active) === 1)) {
                    const locked = await lockModSource(record)
                    updateModSourceLockState(record.id, locked.success ? 'locked' : 'repair_required')
                  }
                  return
                }
                await fs.remove(oldPath)
                await cleanupManagedEmptyParentDirs(oldPath)
              },
              warn: (message, detail) => {
                console.warn(message, detail)
                try {
                  if (message.startsWith('更新成功，但')) replyInstallWarning(event, message)
                } catch (error) {
                  console.warn('发送更新警告失败', error)
                }
              }
            }
          )
        } else {
          await commitInstall()
        }
        await managedConfigTransition?.commit()
        await commitLifecycleReceipts(lifecycleReceipts)
      } catch (commitError) {
        try { await rollbackLifecycleReceipts(lifecycleReceipts) } catch (recoveryError) { commitError.needRecovery = true; commitError.message += `；${recoveryError.message}` }
        try { await managedConfigTransition?.rollback() } catch (recoveryError) {
          commitError.needRecovery = true
          commitError.message += `；${recoveryError.message}`
        }
        // 恢复失败时保留新旧暂存，以便重新恢复，不能交给预览清理器删除。
        if (commitError.needRecovery) pendingPreviewCleanupPathSet.delete(stagingPath)
        return failResult(`安装提交失败: ${commitError?.message || commitError}`, true, commitError)
      }
      if (savedMod?.id) {
        try {
          await registerModSourceAssetForInstalledMod(savedMod, {
            filePath,
            fileMd5,
            fileSize,
            version,
            sourcePlatform: sourceMeta.source,
            gameId: appid,
            appid,
            profileName
          })
        } catch (error) {
          console.warn('安装成功后登记源文件资产失败', error)
        }
      }
      pendingPreviewCleanupPathSet.delete(stagingPath)
      installedRecords.push({
        id: savedMod?.id,
        active: activate,
        sourceRoot: deploySourceRoot,
        targetRoot: deployTargetRoot
      })
      installedCount += 1
      getLocalModData(event)
      if (deferActivation) {
        // 延迟激活：模组已入库但未部署，语义是「已导入未启用」，不发 installModsSuccess
        event.reply('installModsImported', { id, taskType, deferActivation: true })
        event.reply('installModsSuccess-modM')
      } else {
        event.reply('installModsSuccess', { id, taskType })
        event.reply('installModsSuccess-modM')
      }

      // insertFile 已移到循环外执行
    }

    if (iType !== 1 && installedCount > 0) {
      const settings = store.get('systemConfig.settings') || {}
      const autoBackup = settings.installTaskAutoBackup === true
      if (autoBackup) {
        const file = {
          module: 0,
          type: path.extname(filePath).toLowerCase().replace('.', '') || 'zip',
          version,
          external_id: id,
          filePath,
          md5: fileMd5,
          create_time: formatChinaTime()
        }
        insertFile(file)
      } else {
        try {
          fs.removeSync(filePath)
        } catch {
          // 忽略清理失败，避免影响安装结果
        }
      }
    }

    if (pendingPreviewCleanupPathSet.size > 0) {
      await cleanupPendingPreviewStaging()
    }

    await cleanupSourceArchiveAfterInstall()

    return {
      success: true,
      message: installedCount > 0 ? '安装成功' : '已存在相同安装记录',
      installedRecords,
      id,
      taskType,
      installPlan: getLastResolvedInstallPlan(),
      installPlans: resolvedInstallPlans,
      reconcileResult: getLastDeployReconcileResult(),
      reconcileResults: deployReconcileResults
    }
  } catch (error) {
    console.error('installModsExecuteV2 执行异常', error)
    // O11：安装失败时产出回放样本，便于后续复现失败原因。
    // 回放产出失败不应影响主流程错误传递，仅记录日志。
    // 注意：stagingPath/gameRoot 是 try 块内的块级 const，catch 块访问不到，
    // 这里只用函数作用域内可访问的 nexusInstallRule + rulePlatformContext。
    // runInstallEngineReplaySample 内部会 try/catch 处理缺失字段，不会因数据不全而抛错。
    try {
      const replaySample = await runInstallEngineReplaySample({
        sampleId: `install-failure-${id || 'unknown'}-${Date.now()}`,
        context: {
          installRule: nexusInstallRule || rulePlatformContext?.installRule || null
        },
        expect: {
          matched: false,
          error: true
        }
      })
      console.warn('installModsExecuteV2 安装失败回放样本已产出', {
        sampleId: replaySample?.sampleId,
        passed: replaySample?.passed,
        durationMs: replaySample?.durationMs,
        failureReason: String(error?.message || error || '').slice(0, 200)
      })
    } catch (replayError) {
      console.error('installModsExecuteV2 回放样本产出失败', replayError?.message || replayError)
    }
    return failResult(error?.message || '安装失败', false, error)
  }
}

function buildUninstallExecutionResult(payload = {}) {
  return {
    ...(payload.code ? { code: String(payload.code) } : {}),
    success: !!payload.success,
    warning: !!payload.warning,
    id: Number(payload.id || 0),
    optionId: Number(payload.optionId || 0),
    endpointType: Number.isFinite(Number(payload.endpointType)) ? Number(payload.endpointType) : -1,
    name: String(payload.name || ''),
    needRecovery: !!payload.needRecovery,
    recoveryTotal: Number(payload.recoveryTotal || 0),
    recoverySuccess: Number(payload.recoverySuccess || 0),
    recoveryFailed: Number(payload.recoveryFailed || 0),
    message: String(payload.message || (payload.success ? '卸载完成' : '卸载失败'))
  }
}

async function uninstallSpecifiedModFile(mod, event, id, options = {}) {
  const scope = getModDeployScopeById(id)
  if (scope && isUnifiedDeployManagedMod(mod, parseJsonObjectSafe(mod?.metadata_json))) {
    return withDeploymentScopeMutationLocks([scope], async (scopeLockToken) =>
      uninstallSpecifiedModFileLocked(dbInstance.get('SELECT * FROM mods WHERE id = ?', [id]), event, id, { ...options, scopeLockToken }), {
      token: options.scopeLockToken, ownerId: `uninstall:${id}`, operation: 'uninstall',
      onWait: () => options.update?.({ stage: 'planning', currentTarget: '等待其他部署任务完成' })
    })
  }
  return uninstallSpecifiedModFileLocked(mod, event, id, options)
}

async function uninstallSpecifiedModFileLocked(mod, event, id, options = {}) {
  let configTransition
  const lifecycleReceipts = []
  try {
    if (!mod) return options.returnDetail ? { success: false, message: '模组记录已变化，请刷新后重试' } : false
    if (Number(mod.is_active ?? 0) === 1 && !isLegacyManifestOnlyRecord(mod)) {
      return options.returnDetail ? { success: false, code: 'mod_locked_active', message: '请先禁用模组后再卸载' } : false
    }
    const writable = isLegacyManifestOnlyRecord(mod) ? { success: true } : await ensureModSourcesWritableForMutation([mod])
    if (!writable.success) return options.returnDetail ? writable : false
    configTransition = await beginModConfigTransition(mod, false)
    const result = await uninstallSpecifiedModFileInner(mod, event, id, { ...options, lifecycleReceipts })
    if (typeof result === 'boolean' ? result : result?.success) { await configTransition?.commit(); await commitLifecycleReceipts(lifecycleReceipts) }
    else await rollbackConfigAndLifecycle(lifecycleReceipts, configTransition)
    return result
  } catch (error) {
    try { await rollbackConfigAndLifecycle(lifecycleReceipts, configTransition) } catch (recoveryError) { error.needRecovery = true; error.message += `；${recoveryError.message}` }
    return options.returnDetail ? buildUninstallExecutionResult({ success: false, id, code: error.code, message: error.message, needRecovery: !!error.needRecovery }) : false
  }
}

async function uninstallSpecifiedModFileInner(mod, event, id, options = {}) {
  const {
    emitSuccessEvent = true,
    syncLocalData = true,
    emitNotify = true,
    emitDoneEvent = true,
    returnDetail = false,
    force = false,
    skipDeploymentReconcile = false
  } = options
  const finalizeResult = (payload = {}) => {
    const result = buildUninstallExecutionResult({
      ...payload,
      id: Number(payload?.id || id || 0)
    })
    return returnDetail ? result : result.success
  }

  const emitDone = (payload = {}) => {
    if (!emitDoneEvent) return
    event.reply('uninstallModDone', {
      success: !!payload.success,
      warning: !!payload.warning,
      id: Number(id || 0),
      optionId: Number(payload.optionId || 0),
      endpointType: Number.isFinite(Number(payload.endpointType))
        ? Number(payload.endpointType)
        : -1,
      name: String(payload.name || ''),
      needRecovery: !!payload.needRecovery,
      recoveryTotal: Number(payload.recoveryTotal || 0),
      recoverySuccess: Number(payload.recoverySuccess || 0),
      recoveryFailed: Number(payload.recoveryFailed || 0),
      message: String(payload.message || '')
    })
  }

  if (!mod) {
    if (emitNotify) {
      event.reply('node-notify', {
        type: 'warning',
        message: '未找到需要卸载的模组'
      })
    }
    emitDone({
      success: false,
      message: '未找到需要卸载的模组'
    })
    return finalizeResult({
      success: false,
      message: '未找到需要卸载的模组'
    })
  }

  const { name, option_id, endpoint_type, metadata_json } = mod
  const uninstallPathPayload = resolveModUninstallPathPayload(mod)
  const meta = parseJsonObjectSafe(metadata_json)
  const useUnifiedDeploy = isUnifiedDeployManagedMod(mod, meta)
  if (isLegacySource(mod.source) && !useUnifiedDeploy && !validateLegacyUninstallManifest(uninstallPathPayload, dbInstance.get('SELECT * FROM games WHERE id = ?', [mod.game_id]) || {}, mod.endpoint_type)) {
    const failure = { success: false, code: 'legacy_manifest_untrusted', message: '历史模组缺少可靠的游戏目录或部署清单，已停止卸载；原文件和备份均保留。' }
    emitDone(failure)
    return finalizeResult(failure)
  }
  const deployScope = getModDeployScopeById(id)
  const isNexusManaged = isInstallRuleManagedMod(mod)
  const backupConflictState =
    isNexusManaged && !useUnifiedDeploy
      ? buildNexusRuntimeBackupConflictState(mod)
      : { blocked: false, blockers: [], backupList: [] }
  const skipInstalledFileRemoval =
    useUnifiedDeploy || (isNexusManaged && Number(mod?.is_active ?? 1) !== 1)
  const runtimeBackupList = useUnifiedDeploy
    ? []
    : isNexusManaged
      ? getModRuntimeBackupList(mod)
      : getBackupData(option_id, endpoint_type)

  if (isLegacySource(mod.source) && !useUnifiedDeploy) {
    const targetPaths = new Set(collectLegacyManifestFiles(uninstallPathPayload))
    const conflictingBackup = dbInstance.all(
      "SELECT * FROM mod_runtime_files WHERE state <> 'released' AND endpoint_type = ?",
      [Number(endpoint_type || 0)]
    ).some((entry) => targetPaths.has(path.resolve(String(entry.file_path || '')).toLowerCase()) && (
      String(entry.mod_id) !== String(option_id) ||
      (Number(entry.game_id) !== 0 && Number(entry.game_id) !== Number(mod.game_id))
    ))
    if (conflictingBackup) {
      const failure = { success: false, code: 'legacy_backup_owner_conflict', message: '历史文件存在其他模组的备份关系，已停止卸载并保留全部记录。' }
      emitDone(failure)
      return finalizeResult(failure)
    }
  }

  let legacyRecoveryResult = null
  if (isLegacySource(mod.source) && runtimeBackupList.length) {
    const targets = new Set(collectLegacyManifestFiles(uninstallPathPayload))
    const invalidBackup = runtimeBackupList.some((entry) =>
      (Number(entry.game_id) !== 0 && Number(entry.game_id) !== Number(mod.game_id)) ||
      !targets.has(path.resolve(String(entry.file_path || '')).toLowerCase()) ||
      !entry.backup_path || !fs.existsSync(entry.backup_path) || !fs.statSync(entry.backup_path).isFile()
    )
    if (invalidBackup) {
      const failure = { success: false, code: 'legacy_backup_unavailable', message: '历史备份缺失或与部署清单不一致，已停止卸载并保留原记录。' }
      emitDone(failure)
      return finalizeResult(failure)
    }
  }

  if (backupConflictState.blocked && !force) {
    const blockedMessage = buildNexusRuntimeBackupBlockedMessage(
      backupConflictState.blockers,
      '卸载'
    )
    if (emitNotify) {
      event.reply('node-notify', {
        type: 'warning',
        message: blockedMessage
      })
    }
    emitDone({
      success: false,
      optionId: option_id,
      endpointType: endpoint_type,
      name,
      message: blockedMessage
    })
    return finalizeResult({
      success: false,
      optionId: option_id,
      endpointType: endpoint_type,
      name,
      message: blockedMessage
    })
  }

  if (!uninstallPathPayload && !useUnifiedDeploy) {
    if (emitNotify) {
      event.reply('node-notify', {
        type: 'warning',
        message: '未找到需要卸载的路径'
      })
    }
    emitDone({
      success: false,
      optionId: option_id,
      endpointType: endpoint_type,
      name,
      message: '未找到需要卸载的路径'
    })
    return finalizeResult({
      success: false,
      optionId: option_id,
      endpointType: endpoint_type,
      name,
      message: '未找到需要卸载的路径'
    })
  }

  const lifecycleContext = resolveModLifecycleExecutionContext(mod, meta)
  const uninstallLifecycleSteps = Array.isArray(lifecycleContext?.installRulePlan?.onUninstallSteps)
    ? lifecycleContext.installRulePlan.onUninstallSteps
    : []

  if (uninstallLifecycleSteps.length) {
    try {
      // H6：community/user 规则含命令动作时，先请求用户显式授权再执行。
      const uninstallAuth = await requestLifecycleAuthorization(
        lifecycleContext?.installRulePlan,
        uninstallLifecycleSteps,
        event,
        lifecycleContext
      )
      if (!uninstallAuth.authorized) {
        return finalizeResult({
          success: false,
          optionId: option_id,
          endpointType: endpoint_type,
          name,
          message: `生命周期命令动作未获授权（${uninstallAuth.reason}），卸载已中止`
        })
      }
      await applyInstallRuleLifecycleSteps({
        lifecycleName: 'on_uninstall',
        receipts: options.lifecycleReceipts,
        steps: uninstallLifecycleSteps,
        gameRoot: lifecycleContext.gameRoot,
        stagingRoot: lifecycleContext.stagingRoot,
        targetRoot: lifecycleContext.targetRoot,
        lifecycleCommandContext: buildLifecycleCommandContext(
          lifecycleContext?.installRulePlan?.trustLevel,
          { authorizedByUser: uninstallAuth.authorized }
        ),
        targetBaseType: lifecycleContext.targetBaseType
      })
    } catch (error) {
      const lifecycleErrorMessage = String(error?.message || '卸载前脚本执行失败')
      if (emitNotify) {
        event.reply('node-notify', {
          type: 'warning',
          message: lifecycleErrorMessage
        })
      }
      emitDone({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: lifecycleErrorMessage
      })
      return finalizeResult({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: lifecycleErrorMessage
      })
    }
  }

  if (!skipInstalledFileRemoval) {
    const occupancyResult = inspectModsOccupancy([mod])
    if (!occupancyResult.success) {
      if (emitNotify) {
        event.reply('node-notify', {
          type: 'warning',
          message: occupancyResult.message
        })
      }
      emitDone({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: occupancyResult.message
      })
      return finalizeResult({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: occupancyResult.message
      })
    }

    try {
      if (!isLegacySource(mod.source) && meta.stagingPath && meta.targetPath) {
        await StagingManager.undeploy(meta.stagingPath, meta.targetPath)
      }
    } catch (err) {
      console.error('卸载时取消部署失败:', err)
    }

    const data = uninstallFiles(uninstallPathPayload, mod)
    if (!data) {
      if (emitNotify) {
        event.reply('node-notify', {
          type: 'warning',
          message: '卸载未完成,请检查文件是否占用'
        })
      }
      emitDone({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: '卸载未完成,请检查文件是否占用'
      })
      return finalizeResult({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message: '卸载未完成,请检查文件是否占用'
      })
    }
  }

  if (isLegacySource(mod.source) && runtimeBackupList.length) {
    legacyRecoveryResult = executeBackupRecovery(runtimeBackupList, { preserveBackups: true })
    if (legacyRecoveryResult.failed > 0) {
      const failure = { success: false, code: 'legacy_backup_restore_failed', message: '历史备份恢复未完成，已保留全部备份和模组记录，可重试。' }
      emitDone(failure)
      return finalizeResult(failure)
    }
  }
  dbUninstallMod(id)
  if (getModFeatureFlags().enablePriorityReconcile && !skipDeploymentReconcile) {
    let reconcileResult
    try {
      reconcileResult = await reconcileDeploy({ mode: 'incremental', scope: deployScope, reason: 'uninstall', scopeLockToken: options.scopeLockToken })
    } catch (error) {
      restoreDeletedModRecordSnapshot(mod)
      throw error
    }
    if (!reconcileResult?.success) {
      restoreDeletedModRecordSnapshot(mod)
      const message = reconcileResult?.message || '卸载后的安全部署重建失败'
      if (emitNotify) {
        event.reply('node-notify', {
          type: 'warning',
          message
        })
      }
      emitDone({
        success: false,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message
      })
      return finalizeResult({
        success: false,
        code: reconcileResult.code,
        needRecovery: reconcileResult.needRecovery === true,
        optionId: option_id,
        endpointType: endpoint_type,
        name,
        message
      })
    }
  }

  if (legacyRecoveryResult) {
    for (const entry of runtimeBackupList) dbInstance.run("UPDATE mod_runtime_files SET state = 'released' WHERE id = ?", [entry.id])
  }
  try {
    await releaseManagedFileOwner({ ownerType: 'mod', ownerId: id }, { deleteUnused: !isLegacySource(mod.source) })
  } catch (error) {
    console.warn('卸载后释放源文件资产引用失败', error)
  }

  try {
    if (!isLegacySource(mod.source) && meta.stagingPath) {
      fs.rmSync(meta.stagingPath, { recursive: true, force: true })
      await cleanupManagedEmptyParentDirs(meta.stagingPath)
    }
  } catch (err) {
    console.error('卸载后清理暂存目录失败:', err)
  }

  let recoveryResult = {
    needRecovery: false,
    total: 0,
    success: 0,
    failed: 0
  }
  if (runtimeBackupList.length) {
    console.log('查询到可用备份')
    recoveryResult = legacyRecoveryResult || executeBackupRecovery(runtimeBackupList)
  }

  if (syncLocalData) {
    setTimeout(() => {
      getLocalModData(event)
    }, 300)
  }

  if (recoveryResult.failed > 0 && emitNotify) {
    event.reply('node-notify', {
      type: 'warning',
      message: `卸载完成，但有 ${recoveryResult.failed} 个备份恢复失败`
    })
  }

  const hasRecoveryWarning = recoveryResult.failed > 0
  const uninstallResult = buildUninstallExecutionResult({
    success: true,
    warning: hasRecoveryWarning,
    id: Number(id || 0),
    optionId: option_id,
    endpointType: endpoint_type,
    name,
    needRecovery: recoveryResult.needRecovery,
    recoveryTotal: recoveryResult.total,
    recoverySuccess: recoveryResult.success,
    recoveryFailed: recoveryResult.failed,
    message:
      recoveryResult.failed > 0
        ? `卸载完成，但有 ${recoveryResult.failed} 个备份恢复失败`
        : '卸载完成'
  })

  if (emitSuccessEvent) {
    event.reply('uninstallModSuccess', name)
    event.reply('uninstallModSuccess-modM')
  }

  emitDone(uninstallResult)

  return finalizeResult(uninstallResult)
}

export async function checkModFileOccupancy(payload = {}) {
  const idList = Array.isArray(payload?.ids) ? payload.ids : []
  const singleId = Number(payload?.id || 0)
  const targetIds = [
    ...new Set([...idList, ...(singleId > 0 ? [singleId] : [])].map(Number))
  ].filter((item) => Number.isFinite(item) && item > 0)

  if (!targetIds.length) {
    return {
      success: false,
      message: '缺少模组 id'
    }
  }

  const mods = targetIds
    .map((modId) =>
      dbInstance.get(
        `SELECT id, name, option_name, install_paths_json
         FROM mods
         WHERE id = ?`,
        [modId]
      )
    )
    .filter(Boolean)

  if (!mods.length) {
    return {
      success: false,
      message: '未找到需要检测的模组'
    }
  }

  const result = inspectModsOccupancy(mods)
  return {
    success: result.success,
    message: result.message,
    totalCount: result.totalCount,
    occupiedFiles: result.occupiedFiles
  }
}

async function runUninstallTask(event, type, currentTarget, execute) {
  return await runModTask({
    event,
    type,
    cancelable: false,
    execute: async ({ task, update }) => {
      update({ stage: 'planning', progress: 10, currentTarget })
      const result = await execute({ task, update })
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return result
      }
      return {
        success: result !== false,
        message: result === false ? '卸载失败' : '卸载完成'
      }
    }
  })
}

function copyFileSync(src, dest) {
  // 确保目标父目录存在
  const parentDir = path.dirname(dest)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }

  // 兼容恢复“文件”与“目录”
  const srcStats = fs.statSync(src)
  if (fs.existsSync(dest)) {
    const destStats = fs.statSync(dest)
    // 目标类型与源类型不一致时，先删除目标，避免复制失败
    if (srcStats.isDirectory() !== destStats.isDirectory()) {
      fs.removeSync(dest)
    }
  }
  fs.copySync(src, dest, {
    overwrite: true,
    errorOnExist: false
  })

  const restoredType = srcStats.isDirectory() ? '目录' : '文件'
  console.log(`已恢复${restoredType}：${src} -> ${dest}`)
}

function executeBackupRecovery(list, options = {}) {
  console.log('可用备份', list)
  const safeList = [...(Array.isArray(list) ? list : [])].sort(
    (left, right) => Number(right?.id || 0) - Number(left?.id || 0)
  )
  const result = {
    needRecovery: safeList.length > 0,
    total: 0,
    success: 0,
    failed: 0
  }

  safeList.forEach((item) => {
    const { is_delete_backup = 0, id, file_path, backup_path } = item
    const shouldSkipRecovery = Number(is_delete_backup || 0) !== 0 || isRuntimeBackupReleased(item)

    if (!shouldSkipRecovery) {
      result.total += 1
      try {
        if (fs.existsSync(backup_path)) {
          copyFileSync(backup_path, file_path)
          result.success += 1
        } else {
          console.log(`备份文件不存在：${backup_path}`)
          result.failed += 1
        }
      } catch (err) {
        console.log(`恢复失败：${backup_path} -> ${file_path}`, err)
        result.failed += 1
      }
    }
    // 删除备份数据
    if (!options.preserveBackups) deleteBackupData(id, backup_path)
  })

  return result
}

export async function uninstallMod(event, id) {
  const modId = Number(id || 0)
  if (!modId) {
    event.reply('node-notify', {
      type: 'warning',
      message: '卸载参数无效'
    })
    return
  }

  if (uninstallingModIdSet.has(modId)) {
    event.reply('node-notify', {
      type: 'warning',
      message: '卸载任务进行中，请勿重复点击'
    })
    return
  }

  uninstallingModIdSet.add(modId)
  try {
    await runUninstallTask(event, 'uninstall_mod', '准备卸载模组', async ({ update }) => {
      const mod = dbInstance.get(`SELECT *
                                  from mods
                                  where id = ${modId}`)
      const isActive = Number(mod?.is_active ?? 0) === 1
      if (isActive && !isLegacyManifestOnlyRecord(mod)) {
        const message = '该模组处于启用状态，源文件已加锁。请先禁用后再卸载。'
        event.reply('node-notify', {
          type: 'warning',
          message
        })
        return {
          success: false,
          message,
          code: 'mod_locked_active',
          id: modId
        }
      }
      const dependencyUsageState = buildModDependencyUsageState(mod)
      if (
        dependencyUsageState.activeDependents.length > 0
      ) {
        const message = `仍被 ${formatDependencyModNameList(dependencyUsageState.activeDependents) || '其他模组'} 依赖，无法卸载`
        event.reply('node-notify', {
          type: 'warning',
          message
        })
        return {
          success: false,
          message
        }
      }
      update({ stage: 'applying', progress: 45, currentTarget: '执行卸载' })
      const result = await uninstallSpecifiedModFile(mod, event, modId, {
        update,
        emitSuccessEvent: true,
        syncLocalData: true,
        returnDetail: true
      })
      update({ stage: 'verifying', progress: 90, currentTarget: '刷新卸载结果' })
      return result
    })
  } finally {
    uninstallingModIdSet.delete(modId)
  }
}

export async function uninstallModById(event, payload = {}) {
  const modId = Number(payload?.id || 0)
  if (!modId) {
    return {
      success: false,
      message: '卸载参数无效'
    }
  }

  if (uninstallingModIdSet.has(modId)) {
    return {
      success: false,
      message: '卸载任务进行中，请勿重复点击'
    }
  }

  uninstallingModIdSet.add(modId)
  try {
    return await runUninstallTask(
      event,
      'uninstall_mod_by_id',
      '准备卸载模组',
      async ({ update }) => {
        const mod = dbInstance.get(
          `SELECT *
         FROM mods
         WHERE id = ?`,
          [modId]
        )
        if (!mod) {
          return {
            success: false,
            message: '未找到对应模组',
            id: modId
          }
        }

        if (payload.recordOnly === true) {
          return await removeMissingGameModRecord(event, modId, payload)
        }

        const isActive = Number(mod?.is_active ?? 0) === 1
        if (isActive && !isLegacyManifestOnlyRecord(mod)) {
          return {
            success: false,
            message: '该模组处于启用状态，源文件已加锁。请先禁用后再卸载。',
            code: 'mod_locked_active',
            id: modId
          }
        }

        const dependencyUsageState = buildModDependencyUsageState(mod)
        if (
          payload?.force !== true &&
          dependencyUsageState.activeDependents.length > 0
        ) {
          return {
            success: false,
            message: `仍被 ${formatDependencyModNameList(dependencyUsageState.activeDependents) || '其他模组'} 依赖，无法卸载`,
            id: modId
          }
        }

        update({ stage: 'applying', progress: 45, currentTarget: '执行卸载' })
        const uninstallResult = await uninstallSpecifiedModFile(mod, event, modId, {
          update,
          scopeLockToken: payload.scopeLockToken,
          emitSuccessEvent: true,
          syncLocalData: true,
          emitDoneEvent: false,
          emitNotify: false,
          returnDetail: true,
          force: payload?.force === true,
          skipDeploymentReconcile: payload?.skipDeploymentReconcile === true
        })
        update({ stage: 'verifying', progress: 90, currentTarget: '刷新卸载结果' })
        return buildUninstallExecutionResult({
          ...uninstallResult,
          id: modId
        })
      }
    )
  } catch (error) {
    console.error('uninstallModById 执行异常', error)
    return {
      success: false,
      message: String(error?.message || '卸载失败'),
      id: modId
    }
  } finally {
    uninstallingModIdSet.delete(modId)
  }
}

export async function uninstallAllMods(event, id) {
  console.log('执行卸载所有mod')
  await runUninstallTask(
    event,
    'uninstall_all_mods',
    '准备批量卸载客户端模组',
    async ({ update }) => {
      const allArr = getAllModDataByAppId(id, 0, { source: 'server', appId: id }) || []
      update({ stage: 'applying', progress: 35, currentTarget: '批量卸载客户端模组' })
      const result = await executeBulkModAction(event, {
        action: 'delete',
        ids: allArr.map((mod) => mod.id)
      })
      event.reply('uninstallBatchDone', {
        endpointType: 0,
        total: result.total || allArr.length,
        success: result.successCount || 0,
        failed: result.failedCount || 0
      })
      update({ stage: 'verifying', progress: 90, currentTarget: '刷新卸载结果' })
      return result
    }
  )
}

export async function uninstallServerMod(event, data) {
  const { gameId, type, modId } = data
  if (type === 0) {
    await runUninstallTask(
      event,
      'uninstall_server_mod',
      '准备卸载服务端模组',
      async ({ update }) => {
        const item = getModDataById(gameId, modId, { source: 'server', appId: gameId })
        update({ stage: 'applying', progress: 45, currentTarget: '执行服务端模组卸载' })
        const result = await uninstallSpecifiedModFile(item, event, item?.id, {
          emitSuccessEvent: true,
          syncLocalData: true,
          returnDetail: true
        })
        update({ stage: 'verifying', progress: 90, currentTarget: '刷新卸载结果' })
        return result
      }
    )
  }

  if (type === 1) {
    await runUninstallTask(
      event,
      'uninstall_all_server_mods',
      '准备批量卸载服务端模组',
      async ({ update }) => {
        const arr = getAllModDataByAppId(gameId, 1, { source: 'server', appId: gameId }) || []
        update({ stage: 'applying', progress: 35, currentTarget: '批量卸载服务端模组' })
        const result = await executeBulkModAction(event, {
          action: 'delete',
          ids: arr.map((mod) => mod.id)
        })
        event.reply('uninstallBatchDone', {
          endpointType: 1,
          total: result.total || arr.length,
          success: result.successCount || 0,
          failed: result.failedCount || 0
        })
        update({ stage: 'verifying', progress: 90, currentTarget: '刷新卸载结果' })
        return result
      }
    )
  }
}

export function switchGameServerModType(event, data) {
  const { appId, type } = data
  const sourceMeta = { source: 'server', appId }
  const { changes } = updateGameServerModTypeByAppId(appId, type, sourceMeta)

  if (changes) {
    event.reply('updateLocalInfo', getGameDataByAppId(appId, sourceMeta))
    getLocalGameData(event)
  }
}







export async function saveModPriorityOrder(event, payload = {}) {
  const ids = (Array.isArray(payload?.ids) ? payload.ids : [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  if (!ids.length) {
    return {
      success: false,
      message: '缺少需要保存的排序记录'
    }
  }

  return await runModTask({
    event,
    type: 'save_mod_priority_order',
    cancelable: false,
    execute: async ({ task, update }) => {
      update({ stage: 'planning', progress: 20, currentTarget: '检查排序与部署范围' })
      const uniqueIds = [...new Set(ids)]
      const scopes = uniqueIds.map((id) => getModDeployScopeById(id)).filter(Boolean)
      if (scopes.length !== uniqueIds.length)
        return { success: false, message: '部分模组记录不存在，请刷新列表' }
      return await runModPriorityTransaction({
        ids: uniqueIds,
        scopes,
        taskId: task.taskId,
        enabled: getModFeatureFlags().enablePriorityReconcile,
        readPriorities: (recordIds) =>
          recordIds.map((id) =>
            dbInstance.get('SELECT id, priority_order FROM mods WHERE id = ?', [id])
          ),
        writePriorities: (recordIds) => {
          update({ stage: 'applying', progress: 45, currentTarget: '保存并应用排序' })
          return updateModPriorityOrders(recordIds)
        },
        restorePriorities: (records) =>
          dbInstance.transaction(() => {
            for (const record of records)
              dbInstance.run('UPDATE mods SET priority_order = ? WHERE id = ?', [
                record.priority_order,
                record.id
              ])
          }),
        reconcile: reconcileDeploy
      })
    }
  })
}

export async function executeToggleModState(event, data, taskContext = {}) {
  const mods = []
  const seen = new Set()
  const collect = (mod) => {
    if (!mod || seen.has(mod.id)) return
    seen.add(mod.id)
    mods.push(mod)
    if (data.isActive) for (const dependency of resolveInstalledDependencyMods(mod)) collect(dependency)
  }
  collect(dbInstance.get('SELECT * FROM mods WHERE id = ?', [data.id]))
  const scopes = mods.filter((mod) => isUnifiedDeployManagedMod(mod, parseJsonObjectSafe(mod.metadata_json)))
    .map((mod) => getModDeployScopeById(mod.id)).filter(Boolean)
  if (!scopes.length) return executeToggleModStateLocked(event, data, taskContext)
  try {
    return await withDeploymentScopeMutationLocks(scopes, async (scopeLockToken) =>
      executeToggleModStateLocked(event, data, { ...taskContext, scopeLockToken }), {
      token: taskContext.scopeLockToken, ownerId: `toggle:${data.id}`, operation: 'toggle',
      onWait: () => taskContext.update?.({ stage: 'planning', currentTarget: '等待其他部署任务完成' })
    })
  } catch (error) { return { success: false, code: error.code, message: error.message } }
}

async function executeToggleModStateLocked(event, data, taskContext = {}) {
  let configTransition
  const lifecycleReceipts = []
  try {
    const mod = dbInstance.get('SELECT * FROM mods WHERE id = ?', [data.id])
    if (!data.isActive) configTransition = await beginModConfigTransition(mod, false)
    const result = await executeToggleModStateInner(event, data, {
      ...taskContext,
      lifecycleReceipts,
      applyConfigTransition: async () => { configTransition = await beginModConfigTransition(mod, true) }
    })
    if (result?.success) { await configTransition?.commit(); await commitLifecycleReceipts(lifecycleReceipts) }
    else await rollbackConfigAndLifecycle(lifecycleReceipts, configTransition)
    return result
  } catch (error) {
    try { await rollbackConfigAndLifecycle(lifecycleReceipts, configTransition) } catch (recoveryError) { error.needRecovery = true; error.message += `；${recoveryError.message}` }
    return { success: false, code: error.code, message: error.message, needRecovery: !!error.needRecovery }
  }
}

async function executeToggleModStateInner(event, data, taskContext = {}) {
  const updateTask = typeof taskContext.update === 'function' ? taskContext.update : () => {}
  const { id, isActive } = data
  const safeId = Number(id || 0)
  const dependencyVisitedSet =
    taskContext.dependencyVisitedSet instanceof Set ? taskContext.dependencyVisitedSet : new Set()
  let sourceMod = null
  let sourceUnlockedForMutation = false
  let relockSourceOnExit = false

  if (isActive) {
    if (dependencyVisitedSet.has(safeId)) {
      return {
        success: true,
        skipped: true,
        message: '依赖链中已处理该模组',
        id: safeId,
        enabledDependencies: []
      }
    }
    dependencyVisitedSet.add(safeId)
  }

  try {
    const mod = await dbInstance.get(`SELECT * FROM mods WHERE id = ?`, [id])
    if (!mod) {
      return { success: false, message: '未找到对应模组' }
    }
    sourceMod = mod
    const isNexusManaged = isInstallRuleManagedMod(mod)
    const dependencyUsageState = buildModDependencyUsageState(mod)
    if (
      !isActive &&
      data?.force !== true &&
      dependencyUsageState.activeDependents.length > 0
    ) {
      return {
        success: false,
        message: `仍被 ${formatDependencyModNameList(dependencyUsageState.activeDependents) || '其他模组'} 依赖，无法禁用`,
        id
      }
    }

    const { metadata_json } = mod
    const meta = parseJsonObjectSafe(metadata_json)
    const lifecycleContext = resolveModLifecycleExecutionContext(mod, meta)
    const useUnifiedDeploy = isUnifiedDeployManagedMod(mod, meta)

    if (!isActive) {
      updateTask({ stage: 'planning', progress: 20, currentTarget: '检查禁用条件' })
      if (isNexusManaged) {
        const backupConflictState = buildNexusRuntimeBackupConflictState(mod)
        if (backupConflictState.blocked && data?.force !== true) {
          return {
            success: false,
            message: buildNexusRuntimeBackupBlockedMessage(backupConflictState.blockers, '禁用'),
            id
          }
        }
      }

      const disableLifecycleSteps = Array.isArray(lifecycleContext?.installRulePlan?.onDisableSteps)
        ? lifecycleContext.installRulePlan.onDisableSteps
        : []
      let disableAuth = { authorized: true }
      if (disableLifecycleSteps.length) {
        // H6：community/user 规则含命令动作时，先请求用户显式授权再执行。
        disableAuth = await requestLifecycleAuthorization(
          lifecycleContext?.installRulePlan,
          disableLifecycleSteps,
          event,
          lifecycleContext
        )
        if (!disableAuth.authorized) {
          return {
            success: false,
            optionId: mod?.option_id,
            endpointType: Number(mod?.endpoint_type || 0),
            name: mod?.name,
            message: `生命周期命令动作未获授权（${disableAuth.reason}），禁用已中止`
          }
        }
      }

      const writable = await ensureModSourcesWritableForMutation([mod])
      if (!writable.success) {
        return {
          ...writable,
          success: false,
          message: writable.message || '无法修复模组源文件保护状态，禁用未执行',
          id,
          unlockResult: writable
        }
      }
      const unlockRes = writable
      sourceUnlockedForMutation = true
      relockSourceOnExit = true

      // 硬链接与暂存源共享 ACL；先解除自身保护，避免把拒绝写入误判为游戏占用。
      // 真正被进程占用时仍阻止禁用，finally 会恢复源文件保护。
      updateTask({ stage: 'scanning', progress: 35, currentTarget: '检查文件占用' })
      const occupancyResult = inspectModsOccupancy([mod])
      if (!occupancyResult.success) {
        return {
          success: false,
          message: occupancyResult.message,
          id
        }
      }

      if (disableLifecycleSteps.length) {
        await applyInstallRuleLifecycleSteps({
          lifecycleName: 'on_disable',
          receipts: taskContext.lifecycleReceipts,
          steps: disableLifecycleSteps,
          gameRoot: lifecycleContext.gameRoot,
          stagingRoot: lifecycleContext.stagingRoot,
          targetRoot: lifecycleContext.targetRoot,
          targetBaseType: lifecycleContext.targetBaseType,
          lifecycleCommandContext: buildLifecycleCommandContext(
            lifecycleContext?.installRulePlan?.trustLevel,
            { authorizedByUser: disableAuth.authorized }
          )
        })
      }

      if (!useUnifiedDeploy && meta.stagingPath && meta.targetPath) {
        updateTask({ stage: 'applying', progress: 55, currentTarget: '取消部署模组文件' })
        await StagingManager.undeploy(meta.stagingPath, meta.targetPath)
      } else if (!useUnifiedDeploy) {
        console.warn('禁用警告：缺少暂存路径或目标路径，无法安全取消部署。')
      }

      let recoveryResult = {
        needRecovery: false,
        total: 0,
        success: 0,
        failed: 0
      }
      if (isNexusManaged && !useUnifiedDeploy) {
        const backupList = getModRuntimeBackupList(mod)
        if (backupList.length) {
          recoveryResult = executeBackupRecovery(backupList)
        }
      }

      const mockEvent = { reply: (...args) => event.sender.send(...args) }

      updateModActiveState(id, false)
      if (
        getModFeatureFlags().enablePriorityReconcile &&
        data?.skipDeploymentReconcile !== true
      ) {
        updateTask({ stage: 'verifying', progress: 80, currentTarget: '协调部署域' })
        const reconcileResult = await reconcileDeploy({
          mode: 'incremental',
          modId: id,
          reason: 'toggle_disable',
          scopeLockToken: taskContext.scopeLockToken,
          agentTaskId: data?.agentTaskId || data?.agent_task_id
        })
        if (!reconcileResult?.success) {
          updateModActiveState(id, true)
          return {
            success: false,
            message: reconcileResult?.message || '禁用后的安全部署重建失败',
            code: reconcileResult?.code,
            needRecovery: reconcileResult?.needRecovery === true,
            id
          }
        }
      }
      relockSourceOnExit = false
      getLocalModData(mockEvent)
      updateTask({ stage: 'verifying', progress: 95, currentTarget: '刷新本地列表' })
      return {
        success: true,
        warning: recoveryResult.failed > 0,
        message: recoveryResult.failed > 0
            ? `模组已禁用，但有 ${recoveryResult.failed} 个备份恢复失败`
            : '模组已禁用',
        id,
        unlockResult: unlockRes
      }
    } else {
      updateTask({ stage: 'planning', progress: 20, currentTarget: '检查启用条件' })
      if (!meta.stagingPath || !meta.targetPath) {
        return { success: false, message: '模组缺少链接部署信息，请重新安装' }
      }

      if (!(await fs.pathExists(meta.stagingPath))) {
        return {
          success: false,
          message: '模组暂存目录不存在，可能已被清理，请重新安装该模组后再启用'
        }
      }

      const sourceReadability = await inspectModSourceLock(mod)
      if (!sourceReadability.success) {
        return {
          success: false,
          code: 'source_staging_unreadable',
          message: '无法读取已安装模组的暂存源文件，请修复源文件保护状态后重试',
          id,
          sourcePath: sourceReadability.failures?.[0]?.path || meta.stagingPath,
          sourceLockInspection: sourceReadability
        }
      }

      const dependencyEnableResult = await enableInstalledDependenciesForMod(event, mod, {
        ...taskContext,
        dependencyVisitedSet
      })
      if (!dependencyEnableResult?.success) {
        return {
          success: false,
          message: dependencyEnableResult?.message || '前置依赖启用失败',
          id,
          enabledDependencies: dependencyEnableResult?.enabledDependencies || []
        }
      }
      const enabledDependencies = dependencyEnableResult.enabledDependencies || []

      if (isNexusManaged && !useUnifiedDeploy) {
        const runtimeBackupResult = await backupRuntimeOverwriteTargets({
          source: mod?.source,
          gameRowId: Number(mod?.game_id || 0),
          optionId: mod?.option_id,
          endpointType: Number(mod?.endpoint_type || 0),
          sourceRoot: meta.stagingPath,
          targetRoot: meta.targetPath,
          modName: String(mod?.name || mod?.option_name || '').trim(),
          sourceModKey: String(mod?.source_mod_key || '').trim()
        })

        if (!runtimeBackupResult?.success) {
          return {
            success: false,
            message: runtimeBackupResult?.message || '启用前备份被覆盖文件失败',
            id
          }
        }
      }

      // Dependency activation has deployed the base config; lifecycle actions may now use its fields.
      await taskContext.applyConfigTransition?.()

      const enableLifecycleSteps = Array.isArray(lifecycleContext?.installRulePlan?.onEnableSteps)
        ? lifecycleContext.installRulePlan.onEnableSteps
        : []
      if (enableLifecycleSteps.length) {
        // H6：community/user 规则含命令动作时，先请求用户显式授权再执行。
        const enableAuth = await requestLifecycleAuthorization(
          lifecycleContext?.installRulePlan,
          enableLifecycleSteps,
          event,
          lifecycleContext
        )
        if (!enableAuth.authorized) {
          return {
            success: false,
            message: `生命周期命令动作未获授权（${enableAuth.reason}），启用已中止`,
            id
          }
        }
        await applyInstallRuleLifecycleSteps({
          lifecycleName: 'on_enable',
          receipts: taskContext.lifecycleReceipts,
          steps: enableLifecycleSteps,
          gameRoot: lifecycleContext.gameRoot,
          stagingRoot: lifecycleContext.stagingRoot,
          targetRoot: lifecycleContext.targetRoot,
          targetBaseType: lifecycleContext.targetBaseType,
          lifecycleCommandContext: buildLifecycleCommandContext(
            lifecycleContext?.installRulePlan?.trustLevel,
            { authorizedByUser: enableAuth.authorized }
          )
        })
      }

      if (!useUnifiedDeploy) {
        updateTask({ stage: 'applying', progress: 55, currentTarget: '部署模组文件' })
        await StagingManager.deploy(meta.stagingPath, meta.targetPath)
      }

      const mockEvent = { reply: (...args) => event.sender.send(...args) }
      updateModActiveState(id, true)
      if (getModFeatureFlags().enablePriorityReconcile) {
        updateTask({ stage: 'verifying', progress: 80, currentTarget: '协调部署域' })
        const reconcileResult = await reconcileDeploy({
          mode: 'incremental',
          modId: id,
          reason: 'toggle_enable',
          scopeLockToken: taskContext.scopeLockToken,
          agentTaskId: data?.agentTaskId || data?.agent_task_id
        })
        if (!reconcileResult?.success) {
          updateModActiveState(id, false)
          return {
            success: false,
            message: reconcileResult?.message || '启用后的安全部署重建失败',
            code: reconcileResult?.code,
            needRecovery: reconcileResult?.needRecovery === true,
            id
          }
        }
      }
      getLocalModData(mockEvent)
      updateTask({ stage: 'verifying', progress: 95, currentTarget: '刷新本地列表' })
      const lockRes = await lockModSource(mod)
      const lockState = lockRes.success ? 'locked' : 'lock_failed'
      try {
        updateModSourceLockState(safeId, lockState)
      } catch (err) {
        console.warn('[mod lock] 启用加锁状态写回失败', safeId, err)
      }
      if (!lockRes.success) {
        console.warn('[mod lock] 启用加锁失败', safeId, lockRes)
      }
      return {
        success: true,
        warning: !lockRes.success,
        message: !lockRes.success
          ? `模组已启用，但源文件加锁失败：${
              lockRes.failures?.map((f) => f.path).join(', ') || ''
            }，可点击"重试加锁"`
          : enabledDependencies.length
            ? `模组已启用（已自动启用 ${enabledDependencies.length} 个前置：${formatDependencyModNameList(enabledDependencies)}）`
            : '模组已启用',
        id,
        enabledDependencyCount: enabledDependencies.length,
        enabledDependencies,
        lockResult: lockRes
      }
    }
  } catch (error) {
    console.error('切换模组状态失败:', error)
    if (String(error?.message || '').includes('Staging directory does not exist')) {
      return {
        success: false,
        message: '模组暂存目录不存在，可能已被清理，请重新安装该模组后再启用'
      }
    }
    return { success: false, code: error.code, message: error.message || '操作失败', needRecovery: !!error.needRecovery }
  } finally {
    if (sourceMod && sourceUnlockedForMutation && relockSourceOnExit) {
      try {
        const relockResult = await lockModSource(sourceMod)
        updateModSourceLockState(safeId, relockResult.success ? 'locked' : 'repair_required')
        if (!relockResult.success) {
          console.warn('[mod lock] 生命周期异常后重新加锁失败', safeId, relockResult)
        }
      } catch (relockError) {
        try {
          updateModSourceLockState(safeId, 'repair_required')
        } catch {
          // 状态写回失败仅记录原始重新加锁异常。
        }
        console.warn('[mod lock] 生命周期异常后重新加锁异常', safeId, relockError)
      }
    }
  }
}

export async function setModActiveStateForDeploymentRollback(event, data = {}, taskContext = {}) {
  return await executeToggleModState(
    event,
    {
      ...data,
      force: true,
      skipDeploymentReconcile: true
    },
    taskContext
  )
}

export async function toggleModState(event, data = {}) {
  return await runModTask({
    event,
    type: data?.isActive ? 'enable_mod' : 'disable_mod',
    cancelable: false,
    execute: async ({ task, update }) => {
      update({ stage: 'planning', progress: 10, currentTarget: '准备切换模组状态' })
      return await executeToggleModState(event, data, { task, update })
    }
  })
}

export async function executeBulkModAction(event, payload = {}) {
  const action = String(payload?.action || '')
    .trim()
    .toLowerCase()
  if (action !== 'disable' && action !== 'delete') {
    return { success: false, code: 'invalid_bulk_action', message: '批量操作类型无效' }
  }

  const recordOnlyIds = new Set(action === 'delete' && Array.isArray(payload.recordOnlyIds)
    ? payload.recordOnlyIds.map(Number) : [])

  const ids = [
    ...new Set(
      (Array.isArray(payload?.ids) ? payload.ids : [])
        .map((id) => Number(id || 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ]
  const mods = sortModsForBulkMutation(
    ids
      .map((id) => dbInstance.get('SELECT * FROM mods WHERE id = ?', [id]))
      .filter(Boolean)
      .map((mod) => ({
        ...mod,
        ...buildModDependencyUsageState(mod)
      }))
  )
  if (!mods.length) {
    return {
      success: false,
      code: 'bulk_mods_not_found',
      message: '未找到可操作的模组',
      total: ids.length,
      successCount: 0,
      failedCount: ids.length,
      results: ids.map((id) => ({ id, success: false, code: 'mod_not_found' }))
    }
  }

  const mutationMods =
    action === 'delete'
      ? mods.filter((mod) => !recordOnlyIds.has(Number(mod.id)) && !isLegacyManifestOnlyRecord(mod))
      : mods.filter((mod) => Number(mod?.is_active ?? 0) === 1)
  const sourcePreparation = await prepareModSourcesForBulkMutation(mutationMods)
  if (!sourcePreparation.success) {
    return { ...sourcePreparation, success: false, total: ids.length, action }
  }

  const foundIds = new Set(mods.map((mod) => Number(mod.id)))
  const results = ids
    .filter((id) => !foundIds.has(id))
    .map((id) => ({
      id,
      success: false,
      code: 'mod_not_found',
      message: '模组记录不存在，请刷新列表'
    }))
  try {
    for (const mod of mods) {
      const current = dbInstance.get('SELECT * FROM mods WHERE id = ?', [mod.id])
      if (!current) {
        results.push({ id: mod.id, success: action === 'delete', skipped: true })
        continue
      }

      if (recordOnlyIds.has(Number(mod.id))) {
        const removed = await uninstallModById(event, { id: mod.id, recordOnly: true })
        results.push({ ...removed, id: mod.id, name: mod.name, stage: 'delete' })
        continue
      }

      const usage = buildModDependencyUsageState(current)
      if (usage.activeDependents.length > 0) {
        results.push({
          id: mod.id,
          name: mod.name,
          success: false,
          skipped: true,
          code: 'active_dependents_remaining',
          message: `仍有启用的模组依赖它，已保留：${formatDependencyModNameList(usage.activeDependents)}`
        })
        continue
      }

      if (
        Number(current?.is_active ?? 0) === 1 &&
        !(action === 'delete' && isLegacyManifestOnlyRecord(current))
      ) {
        const disabled = await executeToggleModState(
          event,
          { id: mod.id, isActive: false },
          { update: () => {} }
        )
        if (!disabled?.success) {
          results.push({
            id: mod.id,
            name: mod.name,
            success: false,
            stage: 'disable',
            code: disabled?.code,
            message: disabled?.message || '禁用失败'
          })
          continue
        }
      }

      if (action === 'disable') {
        results.push({ id: mod.id, name: mod.name, success: true })
        continue
      }

      const removed = await uninstallModById(event, { id: mod.id })
      results.push({
        id: mod.id,
        name: mod.name,
        success: removed?.success === true,
        stage: 'delete',
        code: removed?.code,
        message: removed?.message || (removed?.success ? '删除完成' : '删除失败')
      })
    }
  } finally {
    for (const mod of mods) {
      const current = dbInstance.get('SELECT * FROM mods WHERE id = ?', [mod.id])
      if (
        !current ||
        recordOnlyIds.has(Number(mod.id)) ||
        Number(current?.is_active ?? 0) !== 1 ||
        (action === 'delete' && isLegacyManifestOnlyRecord(current))
      )
        continue
      try {
        const lockResult = await lockModSource(current)
        updateModSourceLockState(mod.id, lockResult?.success ? 'locked' : 'repair_required')
      } catch (error) {
        updateModSourceLockState(mod.id, 'repair_required')
        console.warn('[mod lock] 批量操作异常恢复源保护失败', mod.id, error)
      }
    }
  }

  const successCount = results.filter((item) => item.success).length
  const failedItems = results.filter((item) => !item.success)
  return {
    success: failedItems.length === 0,
    partial: successCount > 0 && failedItems.length > 0,
    code: failedItems.length ? 'bulk_mod_action_partial_failure' : 'ok',
    message:
      failedItems.length > 0
        ? `批量${action === 'delete' ? '删除' : '禁用'}完成：成功 ${successCount} 个，失败 ${failedItems.length} 个`
        : `已${action === 'delete' ? '删除' : '禁用'}全部 ${successCount} 个模组`,
    action,
    total: ids.length,
    successCount,
    failedCount: failedItems.length,
    results,
    sourceProtectionRepair: sourcePreparation.elevation || null
  }
}

/**
 * 移除游戏管理记录；失效的自动识别条目仅记录游戏库移除选择。
 * @param {object} event
 * @param {number|string} id 游戏记录 ID 或自动识别条目的 ID
 */
export async function removeGame(event, id) {
  try {
    if (typeof id === 'string' && id.startsWith('discovered:')) {
      const result = removeMissingDiscoveredGame(id)
      if (!result.success) return result
      getLocalGameData(event)
      return result
    }
    const gameId = Number(id)
    if (!Number.isSafeInteger(gameId) || gameId <= 0) {
      return { success: false, code: 'invalid_game_id', message: '游戏记录参数无效' }
    }
    if (!dbInstance.get('SELECT id FROM games WHERE id = ?', [gameId])) {
      return { success: false, code: 'game_not_found', message: '游戏记录不存在，请刷新后重试' }
    }
    const installed = dbInstance.get('SELECT COUNT(*) AS count FROM mods WHERE game_id = ?', [gameId])
    if (Number(installed?.count) > 0) {
      return { success: false, code: 'game_has_installed_mods', message: '请先移除该游戏的全部模组安装记录，再从游戏库移除' }
    }
    deleteGameById(gameId)
    // 强制通知前端更新游戏列表数据
    getLocalGameData(event)
    return { success: true, message: '已从游戏库移除' }
  } catch (error) {
    console.error('[IPC Game Method] removeGame 失败', error)
    return { success: false, code: 'remove_game_failed', message: '移除游戏失败，请稍后重试' }
  }
}
