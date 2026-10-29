import { nativeText } from '../../services/uiLanguage.js'
import { exportLegacySourceRecords } from './legacySourceExport.js'
import { openInstalledModLocation } from '../../services/modLocation.js'
import { validateInstallRuleConfig } from '../../services/ai/agent/tools/installRuleConfigWriterTool.js'
import { workshopIndex } from './workshop.js'
import { getRetiredSourceFailure } from '../../../shared/sources/retired-source-policy.js'
import { dialog } from 'electron'
import { ipcMain } from '../../security/ipc.js'
import { getLocalModData } from '../data/utils.js'
import {
  checkModFileOccupancy,
  executeBulkModAction,
  getGameAppIdList,
  getGameListData,
  getGameLocalByAppId,
  getInstalledModsBySource,
  getRecentInstalledMods,
  getModInstallRecord,
  previewArchiveStructure,
  getModListByAppId,
  manuallyAddGame,
  nexusUpsertDetectedGamePath,
  scanNowGameById,
  switchGameServerModType,
  uninstallAllMods,
  uninstallModById,
  uninstallMod,
  uninstallServerMod,
  toggleModState,
  removeGame,
  saveModPriorityOrder,
  // H6：生命周期命令动作逐次授权 — 前端弹窗确认后回传结果，主进程解析 pending promise。
  resolveLifecycleAuthorization
} from './method.js'
import {
  thunderstoreDetectInstalledGame,
  thunderstoreGetEcosystem,
  thunderstoreGetEcosystemStatus,
  thunderstoreGetInstallState,
  thunderstoreGetInstalledMods,
  thunderstoreGetUpdates,
  thunderstoreCheckModFileOccupancy,
  thunderstoreShareProfile,
  thunderstoreResolveProfileCode,
  thunderstoreInstallPackage,
  thunderstoreInstallDownloadedPackages,
  thunderstoreSetModEnabled,
  thunderstoreSetAllModsEnabled,
  thunderstoreDeleteProfile,
  thunderstoreUninstallPackage,
  thunderstoreUpdatePackage,
  thunderstoreBuildLaunchArgs,
  thunderstoreLaunchGame,
  thunderstoreSelectGameExecutable,
  thunderstoreGetConfigFiles,
  thunderstoreReadConfigFile,
  thunderstoreWriteConfigFile,
  thunderstoreOpenConfigFile,
  thunderstoreBuildSourceInstallTaskPlan
} from './thunderstore.js'
import { runThunderstoreStorageOperation } from '../../services/profiles/thunderstoreStorage.js'
import {
  ficsitGetInstalledMods,
  ficsitCheckModFileOccupancy,
  ficsitResolveGamePath,
  ficsitSetModEnabled,
  ficsitUninstallMod
} from './ficsit.js'

import {
  inspectStandardSourceInstallPlan,
  installStandardSourcePackage
} from './standard/orchestrator.js'
import {
  getLatestNexusGameRuleByNexusGameId,
  saveNexusGameRuleIfNewer
} from '../../db/sources/nexus/nexusRule.js'
import {
  getLatestModioGameRuleByModioGameId,
  saveModioGameRuleIfNewer
} from '../../db/sources/modio/modioRule.js'
import {
  acknowledgeNexusGameRuleOverrideUpdate,
  getNexusGameRuleOverride,
  upsertNexusGameRuleOverride
} from '../../db/sources/nexus/nexusRuleOverride.js'
import {
  installDetectGameRootByRule as nexusDetectGameRootByRule,
  installDetectGameRootByRuleFromDirectory as nexusDetectGameRootByRuleFromDirectory
} from './installRuleDetect.js'
import {
  getNexusGameBinding,
  getNexusGameBindingsByAppIds,
  upsertNexusGameBinding
} from '../../db/sources/nexus/nexusBinding.js'
import {
  getModioGameBinding,
  getModioGameBindingsByGameIds,
  upsertModioGameBinding
} from '../../db/sources/modio/modioBinding.js'
import { runModTask } from './taskScheduler.js'
import {
  getGameNameDictSyncState,
  resolveGameNameDictLocalBatch,
  resolveGameNameDictSearchNameLocalBatch,
  syncGameNameDictOnce
} from './gameNameDict.js'
import { sourceInstallTaskIndex } from './source-install-task/index.js'
import { sourceModpackInstanceIndex } from './source-modpack-instance/index.js'
import {
  deleteSourceProfile,
  renameSourceProfile,
  retryDeleteSourceProfile,
  switchSourceProfile,
  getSourceProfileStats
} from './sourceProfileManager.js'
import {
  createLocalBoundMod,
  deleteLocalBoundMod,
  disableLocalBoundMod,
  enableLocalBoundMod,
  refreshLocalBoundMods,
  selectLocalBoundModFiles,
  selectLocalBoundModFolders,
  unbindLocalBoundMod
} from './localBoundMod.js'
import {
  dbUninstallMod,
  getInactiveModsByAppId,
  getModDataByRowId,
  updateModSourceLockState,
  updateModSourceStatus
} from '../../db/mods/mods.js'
import {
  checkAndPersistInactiveMods,
  checkModSourceStatus
} from '../../services/modSourceStatusChecker.js'
import { lockModSource, unlockModSource } from '../../services/modSourceFileLock.js'
import { localModImportIndex } from './local-mod-import/index.js'
import { localModManagerIndex } from './local-mod-manager/index.js'
import { vxpackIndex } from './vxpack/index.js'
import { vamhubIndex } from './vamhub.js'

function runSourceProfileStorageOperation(payload = {}, operation) {
  const source = String(payload?.source || payload?.sourcePlatform || '')
    .trim()
    .toLowerCase()
  return source === 'thunderstore' ? runThunderstoreStorageOperation(operation) : operation()
}

function resolveSourceInstallIpcSource(payload = {}) {
  return (
    payload?.source ||
    payload?.sourceType ||
    payload?.sourcePlatform ||
    payload?.data?.source ||
    payload?.data?.sourceType ||
    payload?.data?.sourcePlatform ||
    payload?.data?.sourceMeta?.source ||
    'nexus'
  )
}

export function gameIndex() {
  workshopIndex()
  sourceInstallTaskIndex()
  sourceModpackInstanceIndex()
  localModManagerIndex()
  localModImportIndex()
  vxpackIndex()
  vamhubIndex()

  ipcMain.handle('gameNameDictResolveBatch', async (_event, payload = {}) => {
    return resolveGameNameDictLocalBatch(payload)
  })

  ipcMain.handle('gameNameDictResolveSearchNameBatch', async (_event, payload = {}) => {
    return resolveGameNameDictSearchNameLocalBatch(payload)
  })

  ipcMain.handle('gameNameDictSyncNow', async (_event, payload = {}) => {
    return await syncGameNameDictOnce({ reason: payload?.reason || 'manual' })
  })

  ipcMain.handle('gameNameDictGetSyncState', async () => {
    return getGameNameDictSyncState()
  })

  ipcMain.handle('thunderstoreBuildSourceInstallTaskPlan', async (_event, payload = {}) => {
    return await thunderstoreBuildSourceInstallTaskPlan(payload)
  })

  ipcMain.on('getGameLocalByAppId', async (event, data) => {
    await getGameLocalByAppId(event, data)
  })

  ipcMain.on('scanNowGameById', async (event, data) => {
    await scanNowGameById(event, data)
  })

  ipcMain.on('manuallyAddGame', async (event, data) => {
    await manuallyAddGame(event, data)
  })

  // 旧版自有云盘工作流的 IPC 只提供确定的下线响应。
  for (const channel of ["verifyInstallTaskFilesMd5","buildInstallTaskBindingsByMd5","selectInstallTaskFiles","selectInstallTaskArchiveFiles","normalizeInstallTaskFilePaths","parseInstallTaskArchiveFromPath","backupInstallTaskFiles","syncInstalledModsAfterTask","filterNeedDownloadByLocalCache"]) {
    ipcMain.handle(channel, () => getRetiredSourceFailure())
  }

  ipcMain.handle('legacy-mod:export-records', (_event, payload = {}) => exportLegacySourceRecords(payload))

  ipcMain.on('getModInstallRecord', async (event, data) => {
    await getModInstallRecord(event, data)
  })

  ipcMain.on('uninstallMod', async (event, id) => {
    await uninstallMod(event, id)
  })

  ipcMain.on('switchVersionUninstallMod', (event) => {
    const failure = getRetiredSourceFailure()
    event.reply('node-notify', { ...failure, type: 'warning' })
    event.reply('modInstall-failed', failure)
  })

  ipcMain.on('uninstallAllMods', async (event, id) => {
    await uninstallAllMods(event, id)
  })

  ipcMain.on('switchGameServerModType', async (event, data) => {
    switchGameServerModType(event, data)
  })

  ipcMain.on('uninstallServerMod', async (event, data) => {
    await uninstallServerMod(event, data)
  })

  ipcMain.handle('toggleModState', async (event, data) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await toggleModState(invokeEvent, data)
  })

  ipcMain.handle('mod:bulkAction', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => event.sender.send(channel, ...args)
    }
    return await executeBulkModAction(invokeEvent, payload)
  })

  ipcMain.on('searchLocalModFiles', (event) => {
    const failure = getRetiredSourceFailure()
    event.reply('node-notify', { ...failure, type: 'warning' })
    event.reply('modInstall-failed', failure)
  })

  ipcMain.on('getGameAppIdList', async (event) => {
    getGameAppIdList(event)
  })

  ipcMain.on('getGameListData', async (event) => {
    getGameListData(event)
  })

  ipcMain.on('getHomeGameListData', async (event) => {
    getGameListData(event, 'getHomeGameListDataSuccess')
  })

  // 游戏库检视器读取最近安装的模组（只读）。
  ipcMain.handle('getRecentInstalledMods', async (_event, payload = {}) => {
    return getRecentInstalledMods(payload)
  })

  ipcMain.on('removeGame', async (event, id) => {
    await removeGame(event, id)
  })

  ipcMain.handle('removeGame', async (event, id) => {
    return await removeGame(event, id)
  })

  ipcMain.on('getModListByAppId', async (event, data) => {
    getModListByAppId(event, data)
  })

  ipcMain.handle('saveModPriorityOrder', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await saveModPriorityOrder(invokeEvent, payload)
  })

  // 整合包顺序安装
  ipcMain.on('installModpackSequentially', (event) => {
    const failure = getRetiredSourceFailure()
    event.reply('node-notify', { ...failure, type: 'warning' })
    event.reply('modInstall-failed', failure)
  })


  ipcMain.handle('installModsExecuteV2', async (event, payload = {}) => {
    const { filePath, data, type = 1 } = payload
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runModTask({
      event: invokeEvent,
      type: 'install_mods_v2',
      cancelable: false,
      execute: async ({ update }) => {
        update({ stage: 'planning', progress: 10, currentTarget: '准备安装模组' })
        const result = await installStandardSourcePackage(
          invokeEvent,
          { filePath, data, type },
          { source: data?.source || data?.sourceType || data?.sourceMeta?.source || 'nexus' }
        )

        // 兜底：安装成功后强制同步一次本地模组数据，确保前端收到更新通知
        if (result?.success) {
          try {
            update({ stage: 'verifying', progress: 90, currentTarget: '同步本地模组数据' })
            getLocalModData(invokeEvent)
          } catch (error) {
            console.error('installModsExecuteV2 兜底同步本地模组数据失败', error)
          }
        }

        return result
      }
    })
  })

  ipcMain.handle('source-install:preview', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await inspectStandardSourceInstallPlan(invokeEvent, payload, {
      source: resolveSourceInstallIpcSource(payload)
    })
  })

  ipcMain.handle('source-install:execute', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runModTask({
      event: invokeEvent,
      type: 'source_install_execute',
      cancelable: false,
      execute: async ({ update }) => {
        update({ stage: 'planning', progress: 10, currentTarget: '准备执行统一来源安装' })
        const result = await installStandardSourcePackage(invokeEvent, payload, {
          source: resolveSourceInstallIpcSource(payload)
        })

        if (result?.success) {
          try {
            update({ stage: 'verifying', progress: 90, currentTarget: '同步本地模组数据' })
            getLocalModData(invokeEvent)
          } catch (error) {
            console.error('source-install:execute 兜底同步本地模组数据失败', error)
          }
        }

        return result
      }
    })
  })

  ipcMain.handle('previewArchiveStructure', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await previewArchiveStructure(invokeEvent, payload)
  })

  ipcMain.handle('inspectNexusInstallPlan', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await inspectStandardSourceInstallPlan(invokeEvent, payload, {
      source: payload?.data?.source || payload?.data?.sourceType || payload?.source || 'nexus'
    })
  })

  ipcMain.handle('inspectSourceInstallPlan', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await inspectStandardSourceInstallPlan(invokeEvent, payload, {
      source: payload?.data?.source || payload?.data?.sourceType || payload?.source || 'nexus'
    })
  })

  // H6：前端 LifecycleAuthorizationDialogHost.vue 用户确认/取消后，通过
  // 'vertex:lifecycle:submit-authorization' 回传结果，主进程解析 pending promise。
  // 采用 ipcMain.on（非 invoke）以匹配前端 ipcRenderer.send 调用模式，
  // 避免前端等待返回值卡住弹窗关闭流程。
  ipcMain.on('vertex:lifecycle:submit-authorization', (_event, payload = {}) => {
    const requestId = String(payload?.requestId || '')
    const confirmed = payload?.confirmed === true
    if (!requestId) {
      console.warn('vertex:lifecycle:submit-authorization 缺少 requestId', payload)
      return
    }
    const resolved = resolveLifecycleAuthorization(requestId, confirmed)
    if (!resolved) {
      console.warn('vertex:lifecycle:submit-authorization 未找到对应请求', {
        requestId,
        confirmed
      })
    }
  })


  ipcMain.handle('getInstalledModsBySource', async (_event, payload = {}) => {
    return await getInstalledModsBySource(payload)
  })

  ipcMain.handle('mod:open-location', (_event, payload = {}) => openInstalledModLocation(payload))

  ipcMain.handle('local-bound-mod:select-files', async () => {
    return await selectLocalBoundModFiles()
  })

  ipcMain.handle('local-bound-mod:select-folders', async () => {
    return await selectLocalBoundModFolders()
  })

  ipcMain.handle('local-bound-mod:create', async (_event, payload = {}) => {
    return await createLocalBoundMod(payload)
  })

  ipcMain.handle('local-bound-mod:enable', async (_event, payload = {}) => {
    return await enableLocalBoundMod(payload)
  })

  ipcMain.handle('local-bound-mod:disable', async (_event, payload = {}) => {
    return await disableLocalBoundMod(payload)
  })

  ipcMain.handle('local-bound-mod:delete', async (_event, payload = {}) => {
    return await deleteLocalBoundMod(payload)
  })

  ipcMain.handle('local-bound-mod:unbind', async (_event, payload = {}) => {
    return await unbindLocalBoundMod(payload)
  })

  ipcMain.handle('local-bound-mod:refresh', async (_event, payload = {}) => {
    return await refreshLocalBoundMods(payload)
  })

  ipcMain.handle('uninstallModById', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await uninstallModById(invokeEvent, payload)
  })

  ipcMain.handle('mod:checkSourceStatus', async (_event, payload = {}) => {
    const { appId, sourceMeta = {}, force = false, ids = null } = payload
    let mods
    if (Array.isArray(ids) && ids.length) {
      mods = ids
        .map((id) => getModDataByRowId(id))
        .filter(Boolean)
        .filter((mod) => Number(mod?.is_active ?? 0) === 0)
    } else {
      mods = getInactiveModsByAppId(appId, sourceMeta)
    }
    if (!Array.isArray(mods) || !mods.length) {
      return { success: true, results: [] }
    }
    const candidates = force
      ? mods
      : mods.filter((m) => {
          const checkedAt = String(m?.source_status_checked_at || '')
          if (!checkedAt) return true
          const parsed = new Date(checkedAt.replace(' ', 'T')).getTime()
          if (!Number.isFinite(parsed)) return true
          return Date.now() - parsed > 5 * 60 * 1000
        })
    const results = await checkAndPersistInactiveMods(candidates)
    return { success: true, results }
  })

  ipcMain.handle('mod:checkSingleSourceStatus', async (_event, payload = {}) => {
    const mod = getModDataByRowId(payload?.id)
    if (!mod) return { success: false, message: '未找到模组' }
    const r = await checkModSourceStatus(mod)
    try {
      updateModSourceStatus(mod.id, r.status)
    } catch (err) {
      console.error('[mod source status] 单模组校验写回失败', mod?.id, err)
    }
    return { success: true, ...r }
  })

  ipcMain.handle('mod:clearInvalidRecord', async (_event, payload = {}) => {
    const mod = getModDataByRowId(payload?.id)
    if (!mod) return { success: false, message: '未找到模组' }
    if (String(mod?.source_status || '') !== 'missing') {
      return { success: false, message: '仅可清除已失效的模组记录' }
    }
    try {
      await unlockModSource(mod)
    } catch (err) {
      console.warn('[mod lock] 清除失效记录前解锁失败', mod?.id, err)
    }
    dbUninstallMod(mod.id)
    return { success: true }
  })

  ipcMain.handle('mod:retryLock', async (_event, payload = {}) => {
    const mod = getModDataByRowId(payload?.id)
    if (!mod) return { success: false, message: '未找到模组' }
    const isActive = Number(mod?.is_active ?? 0) === 1
    if (!isActive) {
      return { success: false, message: '仅启用态模组可重试加锁' }
    }
    const lockRes = await lockModSource(mod)
    const state = lockRes.success ? 'locked' : 'lock_failed'
    try {
      updateModSourceLockState(mod.id, state)
    } catch (err) {
      console.warn('[mod lock] 重试加锁状态写回失败', mod?.id, err)
    }
    return {
      success: lockRes.success,
      state,
      targets: lockRes.targets || [],
      failures: lockRes.failures || [],
      message: lockRes.success
        ? '已重新加锁'
        : `加锁失败：${lockRes.failures?.map((f) => f.path).join(', ') || ''}`
    }
  })

  ipcMain.handle('checkModFileOccupancy', async (_event, payload = {}) => {
    return await checkModFileOccupancy(payload)
  })


  /**
   * Ficsit 使用标准来源兼容适配器，内部暂复用原有 Ficsit 安装能力。
   */
  ipcMain.handle('ficsitResolveGamePath', async (_event, payload = {}) => {
    return await ficsitResolveGamePath(payload)
  })

  ipcMain.handle('ficsitInstallMod', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runModTask({
      event: invokeEvent,
      type: 'ficsit_install_mod',
      cancelable: false,
      execute: async ({ update }) => {
        update({ stage: 'planning', progress: 10, currentTarget: '准备安装 Ficsit 模组' })
        const result = await installStandardSourcePackage(invokeEvent, payload, {
          source: 'ficsit',
          mode: 'online'
        })
        update({ stage: 'verifying', progress: 90, currentTarget: '确认 Ficsit 安装结果' })
        return result
      }
    })
  })

  ipcMain.handle('ficsitPrepareInstallPlan', async (event, payload = {}) => {
    return await inspectStandardSourceInstallPlan(event, payload, {
      source: 'ficsit'
    })
  })

  ipcMain.handle('ficsitInstallDownloadedMods', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runModTask({
      event: invokeEvent,
      type: 'ficsit_install_downloaded_mods',
      cancelable: false,
      execute: async ({ update }) => {
        update({ stage: 'planning', progress: 10, currentTarget: '准备安装本地 Ficsit 模组' })
        const result = await installStandardSourcePackage(invokeEvent, payload, {
          source: 'ficsit',
          mode: 'downloaded'
        })
        update({ stage: 'verifying', progress: 90, currentTarget: '确认 Ficsit 安装结果' })
        return result
      }
    })
  })

  ipcMain.handle('ficsitGetInstalledMods', async (_event, payload = {}) => {
    return await ficsitGetInstalledMods(payload)
  })

  ipcMain.handle('ficsitCheckModFileOccupancy', async (_event, payload = {}) => {
    return await ficsitCheckModFileOccupancy(payload)
  })

  ipcMain.handle('ficsitSetModEnabled', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await ficsitSetModEnabled(invokeEvent, payload)
  })

  ipcMain.handle('ficsitUninstallMod', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await ficsitUninstallMod(invokeEvent, payload)
  })

  /**
   * Nexus 游戏规则本地缓存
   */
  ipcMain.handle('nexusSaveGameRuleIfNewer', async (_event, payload = {}) => {
    return saveNexusGameRuleIfNewer(payload)
  })

  ipcMain.handle('nexusGetLatestGameRule', async (_event, payload = {}) => {
    const nexusGameId = Number(payload?.nexusGameId || 0)
    return getLatestNexusGameRuleByNexusGameId(nexusGameId)
  })

  ipcMain.handle('nexusGetGameRuleOverride', async (_event, payload = {}) => {
    return getNexusGameRuleOverride(payload)
  })

  ipcMain.handle('installRule:validate', (_event, payload = {}) => {
    // Validation only: no file access, persistence or lifecycle actions.
    return validateInstallRuleConfig({ ruleJsonText: String(payload?.text || '') })
  })

  ipcMain.handle('nexusUpsertGameRuleOverride', async (_event, payload = {}) => {
    return upsertNexusGameRuleOverride(payload)
  })

  ipcMain.handle('nexusAcknowledgeGameRuleOverrideUpdate', async (_event, payload = {}) => {
    return acknowledgeNexusGameRuleOverrideUpdate(payload)
  })

  ipcMain.handle('nexusDetectGameRootByRule', async (_event, payload = {}) => {
    return await nexusDetectGameRootByRule(payload)
  })

  ipcMain.handle('nexusDetectGameRootByRuleFromDirectory', async (_event, payload = {}) => {
    return await nexusDetectGameRootByRuleFromDirectory(payload)
  })

  ipcMain.handle('nexusSelectAndDetectGameRootByRule', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || nativeText('selectGameDirectory')),
      defaultPath: String(payload?.defaultPath || ''),
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return {
        success: false,
        canceled: true,
        reason: 'canceled'
      }
    }

    return await nexusDetectGameRootByRuleFromDirectory({
      ...payload,
      selectedDirectory: String(result.filePaths[0] || '')
    })
  })

  /**
   * mod.io 游戏规则本地缓存
   */
  ipcMain.handle('modioSaveGameRuleIfNewer', async (_event, payload = {}) => {
    return saveModioGameRuleIfNewer(payload)
  })

  ipcMain.handle('modioGetLatestGameRule', async (_event, payload = {}) => {
    const modioGameId = Number(payload?.modioGameId || 0)
    return getLatestModioGameRuleByModioGameId(modioGameId)
  })

  ipcMain.handle('modioDetectGameRootByRule', async (_event, payload = {}) => {
    const modioGameId = Number(payload?.modioGameId || 0)
    const result = await nexusDetectGameRootByRule({
      ...payload,
      nexusGameId: modioGameId
    })
    return {
      ...result,
      modioGameId: Number(result?.nexusGameId || modioGameId || 0)
    }
  })

  ipcMain.handle('modioSelectAndDetectGameRootByRule', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || nativeText('selectGameDirectory')),
      defaultPath: String(payload?.defaultPath || ''),
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return {
        success: false,
        canceled: true,
        reason: 'canceled'
      }
    }

    const modioGameId = Number(payload?.modioGameId || 0)
    const detected = await nexusDetectGameRootByRuleFromDirectory({
      ...payload,
      nexusGameId: modioGameId,
      selectedDirectory: String(result.filePaths[0] || '')
    })
    return {
      ...detected,
      modioGameId: Number(detected?.nexusGameId || modioGameId || 0)
    }
  })

  ipcMain.handle('modioUpsertGameBinding', async (_event, payload = {}) => {
    return upsertModioGameBinding(payload)
  })

  ipcMain.handle('modioGetGameBinding', async (_event, payload = {}) => {
    return getModioGameBinding(payload)
  })

  ipcMain.handle('modioGetGameBindingsByGameIds', async (_event, payload = {}) => {
    const modioGameIds = Array.isArray(payload?.modioGameIds) ? payload.modioGameIds : []
    return getModioGameBindingsByGameIds(modioGameIds)
  })

  ipcMain.handle('nexusUpsertDetectedGamePath', async (_event, payload = {}) => {
    return await nexusUpsertDetectedGamePath(payload)
  })

  ipcMain.handle('nexusUpsertGameBinding', async (_event, payload = {}) => {
    return upsertNexusGameBinding(payload)
  })

  ipcMain.handle('nexusGetGameBinding', async (_event, payload = {}) => {
    return getNexusGameBinding(payload)
  })

  ipcMain.handle('nexusGetGameBindingsByAppIds', async (_event, payload = {}) => {
    const appIds = Array.isArray(payload?.appIds) ? payload.appIds : []
    return getNexusGameBindingsByAppIds(appIds)
  })

  /**
   * Thunderstore 独立安装链路（不复用现有 installMods 流程）
   */
  ipcMain.handle('thunderstoreDetectInstalledGame', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreDetectInstalledGame(payload))
  })

  ipcMain.handle('thunderstoreGetEcosystem', async (_event, payload = {}) => {
    return await thunderstoreGetEcosystem(payload)
  })

  ipcMain.handle('thunderstoreGetEcosystemStatus', async () => {
    return thunderstoreGetEcosystemStatus()
  })

  ipcMain.handle('thunderstoreGetInstallState', async (_event, payload = {}) => {
    return await thunderstoreGetInstallState(payload)
  })

  ipcMain.handle('thunderstoreGetInstalledMods', async (_event, payload = {}) => {
    return await thunderstoreGetInstalledMods(payload)
  })

  ipcMain.handle('thunderstoreCheckModFileOccupancy', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() =>
      thunderstoreCheckModFileOccupancy(payload)
    )
  })

  ipcMain.handle('thunderstoreGetUpdates', async (_event, payload = {}) => {
    return await thunderstoreGetUpdates(payload)
  })

  ipcMain.handle('thunderstoreShareProfile', async (_event, payload = {}) => {
    return await thunderstoreShareProfile(payload)
  })

  ipcMain.handle('thunderstoreResolveProfileCode', async (_event, payload = {}) => {
    return await thunderstoreResolveProfileCode(payload)
  })

  ipcMain.handle('thunderstoreInstallPackage', async (event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreInstallPackage(event, payload))
  })

  ipcMain.handle('thunderstoreInstallDownloadedPackages', async (event, payload = {}) => {
    return await runThunderstoreStorageOperation(() =>
      thunderstoreInstallDownloadedPackages(event, payload)
    )
  })

  ipcMain.handle('thunderstoreSetModEnabled', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreSetModEnabled(payload))
  })

  ipcMain.handle('thunderstoreSetAllModsEnabled', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreSetAllModsEnabled(payload))
  })

  ipcMain.handle('thunderstoreUninstallPackage', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreUninstallPackage(payload))
  })

  ipcMain.handle('thunderstoreDeleteProfile', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreDeleteProfile(payload))
  })

  ipcMain.handle('thunderstoreUpdatePackage', async (event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreUpdatePackage(event, payload))
  })

  ipcMain.handle('thunderstoreBuildLaunchArgs', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreBuildLaunchArgs(payload))
  })

  ipcMain.handle('thunderstoreLaunchGame', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreLaunchGame(payload))
  })

  ipcMain.handle('thunderstoreSelectGameExecutable', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() =>
      thunderstoreSelectGameExecutable(payload)
    )
  })

  ipcMain.handle('thunderstoreGetConfigFiles', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreGetConfigFiles(payload))
  })

  ipcMain.handle('thunderstoreReadConfigFile', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreReadConfigFile(payload))
  })

  ipcMain.handle('thunderstoreWriteConfigFile', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreWriteConfigFile(payload))
  })

  ipcMain.handle('thunderstoreOpenConfigFile', async (_event, payload = {}) => {
    return await runThunderstoreStorageOperation(() => thunderstoreOpenConfigFile(payload))
  })

  // 多来源配置方案物理隔离
  ipcMain.handle('sourceProfile:switch', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runSourceProfileStorageOperation(payload, () =>
      switchSourceProfile(invokeEvent, payload)
    )
  })

  ipcMain.handle('sourceProfile:stats', async (_event, payload = {}) => {
    return getSourceProfileStats(payload)
  })

  ipcMain.handle('sourceProfile:delete', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runSourceProfileStorageOperation(payload, () =>
      deleteSourceProfile(invokeEvent, payload)
    )
  })

  ipcMain.handle('sourceProfile:rename', async (_event, payload = {}) => {
    return await runSourceProfileStorageOperation(payload, async () => renameSourceProfile(payload))
  })

  ipcMain.handle('sourceProfile:retryDelete', async (event, payload = {}) => {
    const invokeEvent = {
      ...event,
      reply: (channel, ...args) => {
        event.sender.send(channel, ...args)
      }
    }
    return await runSourceProfileStorageOperation(payload, () =>
      retryDeleteSourceProfile(invokeEvent, payload)
    )
  })
}
