/**
 * 多来源模组"配置方案"物理隔离管理器
 *
 * 核心概念：
 * - is_active: 当前物理部署状态（1=已部署, 0=未部署）
 * - profile_enabled: 模组在其所属 profile 中的期望状态（1=启用, 0=用户手动禁用）
 *
 * 切换 profile 时：
 * 1. 将当前所有激活模组的 profile_enabled 同步为 is_active（保存用户的手动启用/禁用状态）
 * 2. 禁用所有不属于目标 profile 的激活模组
 * 3. 按 profile_enabled 恢复目标 profile 的模组状态
 */
import dbInstance from '../../db/dbInstance.js'
import { toggleModState, uninstallModById } from './method.js'
import { updateSourceModpackTargetProfileName } from '../../db/mods/sourceModpackInstances.js'
import { findGameRecord } from '../../db/games/gameRecord.js'

function normalizeSource(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseJsonObjectSafe(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isDefaultDependencyMod(mod = {}) {
  const metadata = parseJsonObjectSafe(mod?.metadata_json || mod?.metadata)
  return (
    Number(mod?.type_id || 0) === 1 ||
    String(metadata?.category || '').trim() === 'default_dependency'
  )
}

function sortModsForProfileDisable(mods = []) {
  return mods
    .map((mod, index) => ({ mod, index }))
    .sort((left, right) => {
      const defaultDependencyGap =
        Number(isDefaultDependencyMod(left.mod)) - Number(isDefaultDependencyMod(right.mod))
      if (defaultDependencyGap !== 0) {
        return defaultDependencyGap
      }
      return left.index - right.index
    })
    .map((item) => item.mod)
}

function buildSourceFilter(source = '') {
  const safeSource = normalizeSource(source)
  if (!safeSource) {
    return { clause: '', params: [] }
  }
  return {
    clause: ` AND lower(COALESCE(source, '')) = ?`,
    params: [safeSource]
  }
}

/**
 * 获取指定游戏 + 来源下某个 profile 的所有模组记录
 */
function getModsByProfile(gameId, profileName, endpointType = 0, source = '') {
  const safeProfileName = String(profileName || 'default').trim() || 'default'
  const sourceFilter = buildSourceFilter(source)
  return (
    dbInstance.all(
      `SELECT id, name, source_mod_key, is_active, profile_name, profile_enabled, type_id, metadata_json
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?
       ${sourceFilter.clause}
     ORDER BY priority_order ASC, id ASC`,
      [gameId, endpointType, safeProfileName.toLowerCase(), ...sourceFilter.params]
    ) || []
  )
}

/**
 * 获取指定游戏 + 来源下所有激活的模组（不限 profile）
 */
function getActiveModsByGame(gameId, endpointType = 0, source = '') {
  const sourceFilter = buildSourceFilter(source)
  return (
    dbInstance.all(
      `SELECT id, name, source_mod_key, is_active, profile_name, profile_enabled, type_id, metadata_json
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND is_active = 1
       ${sourceFilter.clause}
     ORDER BY priority_order ASC, id ASC`,
      [gameId, endpointType, ...sourceFilter.params]
    ) || []
  )
}

/**
 * 根据 sourceMeta 找到 game_id
 */
function resolveGameId(payload = {}) {
  const appId = Number(payload.appId || payload.appid || 0)
  const source = String(payload.source || payload.sourcePlatform || '').trim()
  const sourceId = String(payload.sourceId || payload.sourceGameId || '').trim()
  const sourceSlug = String(
    payload.sourceSlug ||
      payload.sourceGameSlug ||
      payload.domainName ||
      payload.nameId ||
      (sourceId && !/^\d+$/.test(sourceId) ? sourceId : '')
  ).trim()

  const record = findGameRecord({
    source,
    sourceId,
    sourceSlug,
    appId: appId > 0 ? String(appId) : ''
  })
  if (record?.id) {
    return record.id
  }

  if (appId > 0) {
    const game = dbInstance.get(`SELECT id FROM games WHERE app_id = ? LIMIT 1`, [appId])
    if (game) return game.id
  }

  if (source && sourceId) {
    const game = dbInstance.get(`SELECT id FROM games WHERE source = ? AND source_id = ? LIMIT 1`, [
      source,
      sourceId
    ])
    if (game) return game.id
  }

  if (source && sourceSlug) {
    const game = dbInstance.get(
      `SELECT id FROM games WHERE source = ? AND source_slug = ? LIMIT 1`,
      [source, sourceSlug]
    )
    if (game) return game.id
  }

  return 0
}

function replaceProfileNameInMetadata(metadataValue, previousName, nextName) {
  const metadata = parseJsonObjectSafe(metadataValue)
  let changed = false
  for (const key of [
    'profileName',
    'profile_name',
    'targetProfileName',
    'target_profile_name',
    'sourceProfile',
    'source_profile'
  ]) {
    if (
      String(metadata?.[key] || '')
        .trim()
        .toLowerCase() === previousName.toLowerCase()
    ) {
      metadata[key] = nextName
      changed = true
    }
  }
  return changed ? JSON.stringify(metadata) : null
}

export function renameSourceProfile(payload = {}) {
  const gameId = resolveGameId(payload)
  const previousName = String(
    payload.previousProfile || payload.currentProfile || payload.profileName || ''
  ).trim()
  const nextName = String(payload.nextProfile || payload.targetProfile || '').trim()
  if (!previousName || !nextName) {
    return { success: false, message: '配置名称不能为空' }
  }
  if (nextName.length > 32) {
    return { success: false, message: '配置名称长度不能超过 32 个字符' }
  }
  if (/[\\/:*?"<>|]/.test(nextName)) {
    return { success: false, message: '配置名称不能包含 \\ / : * ? " < > |' }
  }

  const endpointType = Number(payload.endpointType || 0)
  const source = normalizeSource(payload.source || payload.sourcePlatform || '')
  const sourceFilter = buildSourceFilter(source)
  const scopeParams = [gameId, endpointType, ...sourceFilter.params]
  const duplicate = gameId
    ? dbInstance.get(
        `SELECT id
         FROM mods
         WHERE game_id = ?
           AND endpoint_type = ?
           ${sourceFilter.clause}
           AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?
           AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) <> ?
         LIMIT 1`,
        [...scopeParams, nextName.toLowerCase(), previousName.toLowerCase()]
      )
    : null
  if (duplicate) {
    return { success: false, message: '配置名称已存在，请更换' }
  }

  const rows = gameId
    ? dbInstance.all(
        `SELECT id, metadata_json
         FROM mods
         WHERE game_id = ?
           AND endpoint_type = ?
           ${sourceFilter.clause}
           AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?`,
        [...scopeParams, previousName.toLowerCase()]
      ) || []
    : []

  const community = String(payload.community || payload.sourceId || payload.sourceGameId || '')
    .trim()
    .toLowerCase()
  if (source === 'thunderstore' && community && dbInstance.tableExists('thunderstore_profiles')) {
    const duplicatedProfile = dbInstance.get(
      `SELECT id
       FROM thunderstore_profiles
       WHERE community = ? AND lower(profile_name) = ? AND lower(profile_name) <> ?
       LIMIT 1`,
      [community, nextName.toLowerCase(), previousName.toLowerCase()]
    )
    if (duplicatedProfile) {
      return { success: false, message: '配置名称已存在，请更换' }
    }
  }
  let renamedProfileRows = 0
  dbInstance.transaction(() => {
    for (const row of rows) {
      const metadataJson = replaceProfileNameInMetadata(row.metadata_json, previousName, nextName)
      dbInstance.run(
        `UPDATE mods
         SET profile_name = ?,
             metadata_json = COALESCE(?, metadata_json),
             deploy_domain = CASE WHEN lower(COALESCE(source, '')) = 'thunderstore'
               THEN ? ELSE deploy_domain END,
             updated_at = ?
         WHERE id = ?`,
        [
          nextName,
          metadataJson,
          `thunderstore:${nextName.toLowerCase()}`,
          new Date().toISOString(),
          row.id
        ]
      )
    }

    if (source === 'thunderstore' && community && dbInstance.tableExists('thunderstore_profiles')) {
      const result = dbInstance.run(
        `UPDATE thunderstore_profiles
         SET profile_name = ?, updated_at = ?
         WHERE community = ? AND lower(profile_name) = ?`,
        [nextName, new Date().toISOString(), community, previousName.toLowerCase()]
      )
      renamedProfileRows = Number(result?.changes || 0)
    }
    updateSourceModpackTargetProfileName({
      sourcePlatform: source,
      localGameInstallationId: gameId,
      endpointType,
      profileName: previousName,
      nextProfileName: nextName
    })
  })

  return {
    success: true,
    previousProfile: previousName,
    profileName: nextName,
    renamedModRows: rows.length,
    renamedProfileRows,
    message: `已将配置“${previousName}”重命名为“${nextName}”`
  }
}

/**
 * 切换 profile：
 * 1. 保存所有模组当前 is_active 到 profile_enabled（记住用户的手动状态）
 * 2. 禁用所有不属于目标 profile 的激活模组
 * 3. 按 profile_enabled 恢复目标 profile 的模组（只启用 profile_enabled=1 的）
 *
 * @param {Object} event - IPC event（用于 toggleModState）
 * @param {Object} payload
 * @param {number|string} payload.appId - 游戏 AppID
 * @param {string} payload.source - 来源平台
 * @param {string} payload.sourceId - 来源游戏 ID
 * @param {string} payload.targetProfile - 目标 profile 名称
 * @param {string} payload.currentProfile - 当前 profile 名称（可选）
 * @param {number} payload.endpointType - 端点类型（默认 0 = 客户端）
 */
export async function switchSourceProfile(event, payload = {}) {
  const gameId = resolveGameId(payload)
  if (!gameId) {
    return {
      success: false,
      message: '未找到对应游戏记录'
    }
  }

  const targetProfile = String(payload.targetProfile || 'default').trim()
  const endpointType = Number(payload.endpointType || 0)
  const source = normalizeSource(payload.source || payload.sourcePlatform || '')
  const currentProfile = String(payload.currentProfile || '').trim()
  // 归一化：profile_name 在 DB 里有 ''/NULL/'default' 三种历史写法，统一按 lower-case 比较，
  // 否则按 profile 分组时会把 ''、'default'、'Default' 当成三个不同 profile。
  const normalizedTargetProfile = targetProfile.toLowerCase() || 'default'
  const normalizedCurrentProfile = currentProfile.toLowerCase()

  console.log('[ProfileSwitch] ========== 开始切换 ==========')
  console.log(
    '[ProfileSwitch] gameId:',
    gameId,
    'source:',
    source || '(all)',
    'currentProfile:',
    currentProfile || '(unknown)',
    'targetProfile:',
    targetProfile
  )

  // 发送进度通知的辅助函数
  const sendProgress = (data) => {
    try {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('sourceProfile:switchProgress', data)
      }
    } catch {
      // ignore
    }
  }

  // 1. 获取当前所有激活的模组 & 目标 profile 的模组
  const activeMods = getActiveModsByGame(gameId, endpointType, source)
  const targetMods = getModsByProfile(gameId, targetProfile, endpointType, source)

  console.log(
    '[ProfileSwitch] 当前激活模组:',
    activeMods.map((m) => ({
      id: m.id,
      name: m.name,
      profile: m.profile_name,
      is_active: m.is_active,
      profile_enabled: m.profile_enabled
    }))
  )
  console.log(
    '[ProfileSwitch] 目标配置模组:',
    targetMods.map((m) => ({
      id: m.id,
      name: m.name,
      profile: m.profile_name,
      is_active: m.is_active,
      profile_enabled: m.profile_enabled
    }))
  )

  // 2. 确定需要禁用的模组（不属于目标 profile 的激活模组）
  const targetModIdSet = new Set(targetMods.map((m) => m.id))
  const modsToDisable = sortModsForProfileDisable(
    activeMods.filter((m) => !targetModIdSet.has(m.id))
  )
  // 按 profile 维度分组：currentProfile 的活跃模组属于「正常切换被停用」，
  // 既不是 currentProfile 也不是 target 的活跃模组属于「孤儿配置清理」。
  // 没有 currentProfile（旧调用 / 直接 IPC）时所有禁用项都按孤儿处理。
  const modsFromCurrentProfile = []
  const modsFromOrphanProfiles = []
  for (const mod of modsToDisable) {
    const modProfile =
      String(mod.profile_name || 'default')
        .trim()
        .toLowerCase() || 'default'
    if (normalizedCurrentProfile && modProfile === normalizedCurrentProfile) {
      modsFromCurrentProfile.push(mod)
    } else if (modProfile !== normalizedTargetProfile) {
      modsFromOrphanProfiles.push(mod)
    }
  }

  // 3. 按 profile_enabled 确定目标 profile 中需要启用的模组
  const modsToEnable = targetMods.filter(
    (m) => Number(m.is_active) !== 1 && Number(m.profile_enabled) !== 0
  )
  // 目标配置「应当生效」的模组总数（含已经 active 的），用作 toast 给用户看的「已激活 N 个」。
  // 与 modsToEnable.length 区别：modsToEnable 是「这次新启用的」，targetActiveTotal 是「目标配置完整的活跃集合」。
  const targetActiveTotal = targetMods.filter((m) => Number(m.profile_enabled) !== 0).length

  console.log(
    '[ProfileSwitch] 需要禁用:',
    modsToDisable.map((m) => ({ id: m.id, name: m.name, profile: m.profile_name }))
  )
  console.log(
    '[ProfileSwitch] 禁用分组: 当前配置',
    modsFromCurrentProfile.length,
    '个 / 孤儿配置',
    modsFromOrphanProfiles.length,
    '个'
  )
  console.log(
    '[ProfileSwitch] 需要启用:',
    modsToEnable.map((m) => ({
      id: m.id,
      name: m.name,
      profile: m.profile_name,
      profile_enabled: m.profile_enabled
    }))
  )
  console.log(
    '[ProfileSwitch] 目标配置应当生效模组总数:',
    targetActiveTotal,
    '其中本次新启用',
    modsToEnable.length,
    '个'
  )

  const totalSteps = modsToDisable.length + modsToEnable.length
  let completedSteps = 0
  let disabledCount = 0
  let enabledCount = 0
  const disabledIds = []
  const errors = []

  sendProgress({
    stage: 'start',
    targetProfile,
    totalDisable: modsToDisable.length,
    totalEnable: modsToEnable.length,
    totalSteps
  })

  // 4. 禁用非目标 profile 的激活模组
  for (const mod of modsToDisable) {
    sendProgress({
      stage: 'disabling',
      current: completedSteps + 1,
      total: totalSteps,
      modName: mod.name || mod.source_mod_key || ''
    })
    try {
      const result = await toggleModState(event, { id: mod.id, isActive: false })
      if (!result?.success) {
        console.error(
          '[ProfileSwitch] 禁用失败:',
          mod.name || mod.id,
          'profile:',
          mod.profile_name,
          'modId:',
          mod.id,
          'rawMessage:',
          result?.message,
          'fullResult:',
          result
        )
        errors.push(`禁用 ${mod.name || mod.id} 失败：${result?.message || '未知错误'}`)
      } else {
        disabledIds.push(mod.id)
        disabledCount++
      }
    } catch (error) {
      console.error(
        '[ProfileSwitch] 禁用异常:',
        mod.name || mod.id,
        'profile:',
        mod.profile_name,
        'modId:',
        mod.id,
        'errorMessage:',
        error?.message,
        'stack:',
        error?.stack
      )
      errors.push(`禁用 ${mod.name || mod.id} 失败：${error?.message || '未知错误'}`)
    }
    completedSteps++
  }

  // 5. 恢复被禁用模组的 profile_enabled = 1（它们在自己的 profile 中本来是启用的）
  //    toggleModState 会把 profile_enabled 设为 0，这里需要修正回来
  if (disabledIds.length > 0) {
    dbInstance.run(
      `UPDATE mods SET profile_enabled = 1 WHERE id IN (${disabledIds.map(() => '?').join(',')})`,
      disabledIds
    )
    console.log('[ProfileSwitch] 已恢复被禁用模组的 profile_enabled=1, ids:', disabledIds)
  }

  // 6. 启用目标 profile 中 profile_enabled = 1 的模组
  for (const mod of modsToEnable) {
    sendProgress({
      stage: 'enabling',
      current: completedSteps + 1,
      total: totalSteps,
      modName: mod.name || mod.source_mod_key || ''
    })
    try {
      const result = await toggleModState(event, { id: mod.id, isActive: true })
      if (!result?.success) {
        errors.push(`启用 ${mod.name || mod.id} 失败：${result?.message || '未知错误'}`)
      } else {
        enabledCount++
      }
    } catch (error) {
      console.error('[ProfileSwitch] 启用失败:', mod.name, error?.message)
      errors.push(`启用 ${mod.name || mod.id} 失败：${error?.message || '未知错误'}`)
    }
    completedSteps++
  }

  // 最终状态验证
  const finalState = (() => {
    const sourceFilter = buildSourceFilter(source)
    return (
      dbInstance.all(
        `SELECT id, name, source, is_active, profile_name, profile_enabled
         FROM mods
         WHERE game_id = ?
           AND endpoint_type = ?
           ${sourceFilter.clause}
         ORDER BY id`,
        [gameId, endpointType, ...sourceFilter.params]
      ) || []
    )
  })()
  console.log(
    '[ProfileSwitch] 切换完成后最终状态:',
    finalState.map((m) => ({
      id: m.id,
      name: m.name,
      source: m.source,
      is_active: m.is_active,
      profile: m.profile_name,
      profile_enabled: m.profile_enabled
    }))
  )
  console.log(
    '[ProfileSwitch] 结果: 禁用',
    disabledCount,
    '个, 启用',
    enabledCount,
    '个, 错误',
    errors.length,
    '个'
  )
  console.log('[ProfileSwitch] ========== 切换结束 ==========')

  // 把刚刚的「禁用分组」结果与「实际成功 ID 集合」交叉一下，
  // 得到「当前配置真实成功停用 / 孤儿真实成功清理」两个数字。
  const disabledIdSet = new Set(disabledIds)
  const disabledFromCurrentSuccess = modsFromCurrentProfile.filter((m) =>
    disabledIdSet.has(m.id)
  ).length
  const disabledOrphanSuccess = modsFromOrphanProfiles.filter((m) => disabledIdSet.has(m.id)).length
  // 「已激活」按用户心智 = 目标配置应当生效模组的完整数量。
  // = 本次新启用成功数 + 切换前已经在 active 的目标模组数。
  // 这样即使本次只新启用 1 个、另 2 个本来已 active，对用户来说目标配置就是「3 个生效」。
  const keptActiveCount = Math.max(0, targetActiveTotal - modsToEnable.length)
  const activatedCount = enabledCount + keptActiveCount

  sendProgress({
    stage: 'done',
    disabledCount,
    enabledCount,
    activatedCount,
    disabledFromCurrent: disabledFromCurrentSuccess,
    disabledOrphan: disabledOrphanSuccess,
    errors
  })

  // toast 只给最简结论：激活 N / 禁用 M。
  // 按 profile 分组的明细（来自 currentProfile vs 孤儿）已经在上方 console.log 里完整输出，
  // 不再塞进 toast 增加用户阅读负担。失败时仍把首条原始报错带出来。
  const buildSwitchMessage = () => {
    if (errors.length > 0) {
      const firstReason = String(errors[0] || '').trim() || '未知错误'
      if (errors.length === 1) return `切换失败：${firstReason}`
      return `切换失败：${firstReason}（共 ${errors.length} 个错误，另 ${errors.length - 1} 个详见日志）`
    }
    return `已切换到"${targetProfile}"：激活 ${activatedCount} 个，禁用 ${disabledCount} 个`
  }

  return {
    success: errors.length === 0,
    message: buildSwitchMessage(),
    disabledCount,
    enabledCount,
    activatedCount,
    disabledFromCurrent: disabledFromCurrentSuccess,
    disabledOrphan: disabledOrphanSuccess,
    targetProfile,
    errors
  }
}

/**
 * 删除 profile：停用并卸载该配置下的所有模组，同时清理 per-mod 的暂存源文件。
 *
 * 删除范围 / 不删除范围（重要）：
 *   ✓ 物理部署文件（游戏目录下的硬链接）— `uninstallModById` 内部 undeploy 处理
 *   ✓ `mods` 行 — `dbUninstallMod(id)` 删行
 *   ✓ `mod_file_owners` / `mod_file_manifest` — 卸载后 `reconcileDeploy` 重建会自动清理
 *   ✓ `mod.staging_path` 目录 — `uninstallSpecifiedModFile` 末段 `fs.rmSync(meta.stagingPath)`
 *   ✗ `mod.archive_path`（原始下载压缩包）— 与其他 profile / 其他 mod 行**共用**，不删
 *   ✗ 离线包缓存 `<offlinePackCache>/<sha>/` — 多次导入同 vxpack **共用**，由独立 retention 任务清理
 *
 * 隔离保证：每个 mod 行的 `staging_path` 是导入时生成的独立 uuid 目录（offline 和 online 都一样），
 * 所以删除本 profile 任何一个 mod 的 staging 都不会影响其他 profile 的同名同源 mod 的 staging。
 */
export async function deleteSourceProfile(event, payload = {}) {
  const gameId = resolveGameId(payload)
  if (!gameId) {
    return {
      success: false,
      message: '未找到对应游戏记录'
    }
  }

  const targetProfile = String(payload.targetProfile || payload.profileName || '').trim()
  const isDefaultProfile =
    payload?.isDefault === true ||
    (payload?.isDefault !== false && targetProfile.toLowerCase() === 'default')
  if (!targetProfile || isDefaultProfile) {
    return {
      success: false,
      message: '默认配置不能删除'
    }
  }

  const endpointType = Number(payload.endpointType || 0)
  const source = normalizeSource(payload.source || payload.sourcePlatform || '')
  const targetMods = getModsByProfile(gameId, targetProfile, endpointType, source)

  console.log('[DeleteProfile] ========== 开始删除 ==========')
  console.log(
    '[DeleteProfile] gameId:',
    gameId,
    'source:',
    source || '(all)',
    'targetProfile:',
    targetProfile,
    'modCount:',
    targetMods.length
  )

  if (targetMods.length === 0) {
    console.log('[DeleteProfile] 配置无模组，直接结束')
    console.log('[DeleteProfile] ========== 删除结束 ==========')
    return {
      success: true,
      message: `配置"${targetProfile}"没有模组，已直接清理`,
      targetProfile,
      removedCount: 0,
      totalCount: 0,
      errors: []
    }
  }

  // 卸载顺序：非默认依赖先卸，默认依赖最后卸。
  // 启用态模组会被 uninstallModById 以 mod_locked_active 拦截，需用户先禁用。
  const sortedMods = sortModsForProfileDisable(targetMods)

  const errors = []
  let removedCount = 0
  for (const mod of sortedMods) {
    try {
      const result = await uninstallModById(event, { id: mod.id })
      if (!result?.success) {
        console.error(
          '[DeleteProfile] 卸载失败:',
          mod.name || mod.id,
          'profile:',
          mod.profile_name,
          'rawMessage:',
          result?.message
        )
        errors.push(`卸载 ${mod.name || mod.id} 失败：${result?.message || '未知错误'}`)
        continue
      }
      removedCount++
    } catch (error) {
      console.error(
        '[DeleteProfile] 卸载异常:',
        mod.name || mod.id,
        'profile:',
        mod.profile_name,
        'errorMessage:',
        error?.message,
        'stack:',
        error?.stack
      )
      errors.push(`卸载 ${mod.name || mod.id} 失败：${error?.message || '未知错误'}`)
    }
  }

  console.log(
    '[DeleteProfile] 结果: 已删除',
    removedCount,
    '个 / 共',
    sortedMods.length,
    '个 / 错误',
    errors.length,
    '个'
  )
  console.log('[DeleteProfile] ========== 删除结束 ==========')

  if (errors.length > 0) {
    const firstReason = String(errors[0] || '').trim() || '未知错误'
    // 收集失败 mod id，供 UI 提供「重试清理」入口（审计 🔴#6）
    const failedModIds = sortedMods
      .filter((mod) => {
        const text = `卸载 ${mod.name || mod.id} 失败`
        return errors.some((err) => String(err || '').startsWith(text))
      })
      .map((mod) => Number(mod.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)
    return {
      success: false,
      partialSuccess: removedCount > 0,
      message:
        errors.length === 1
          ? `删除配置失败：${firstReason}`
          : `删除配置部分失败：${firstReason}（共 ${errors.length} 个错误，已删除 ${removedCount}/${sortedMods.length} 个模组）`,
      targetProfile,
      removedCount,
      totalCount: sortedMods.length,
      failedModIds,
      errors
    }
  }

  return {
    success: true,
    message: `已删除配置"${targetProfile}"：卸载 ${removedCount} 个模组及其 staging 目录（共享的下载压缩包与离线包缓存按来源保留）`,
    targetProfile,
    removedCount,
    totalCount: sortedMods.length,
    errors: []
  }
}

/**
 * 重试清理：deleteSourceProfile 部分失败后，UI 拿 failedModIds 调此入口继续卸载
 * 直至全部清空，再让 UI 删 registry（审计 🔴#6 兜底）
 */
export async function retryDeleteSourceProfile(event, payload = {}) {
  const modIds = Array.isArray(payload?.modIds)
    ? payload.modIds.map((id) => Number(id || 0)).filter((id) => Number.isFinite(id) && id > 0)
    : []
  if (!modIds.length) {
    return {
      success: false,
      message: '未提供待重试的模组 id'
    }
  }

  const errors = []
  let removedCount = 0
  for (const modId of modIds) {
    try {
      const result = await uninstallModById(event, { id: modId })
      if (!result?.success) {
        errors.push(`重试卸载 #${modId} 失败：${result?.message || '未知错误'}`)
        continue
      }
      removedCount++
    } catch (error) {
      errors.push(`重试卸载 #${modId} 异常：${error?.message || '未知错误'}`)
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      partialSuccess: removedCount > 0,
      message: `重试清理部分失败：已删除 ${removedCount}/${modIds.length} 个，剩余 ${errors.length} 个错误`,
      removedCount,
      totalCount: modIds.length,
      failedModIds: modIds,
      errors
    }
  }

  return {
    success: true,
    message: `重试清理完成：已删除 ${removedCount} 个剩余模组`,
    removedCount,
    totalCount: modIds.length,
    errors: []
  }
}

/**
 * 获取指定游戏各 profile 的模组统计
 */
export function getSourceProfileStats(payload = {}) {
  const gameId = resolveGameId(payload)
  if (!gameId) {
    return { profiles: [] }
  }

  const endpointType = Number(payload.endpointType || 0)
  const source = normalizeSource(payload.source || payload.sourcePlatform || '')
  const sourceFilter = buildSourceFilter(source)
  const rows =
    dbInstance.all(
      `SELECT COALESCE(NULLIF(profile_name, ''), 'default') as profile_name, COUNT(*) as count, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeCount
      FROM mods
      WHERE game_id = ?
        AND endpoint_type = ?
        ${sourceFilter.clause}
      GROUP BY COALESCE(NULLIF(profile_name, ''), 'default')
      ORDER BY profile_name ASC`,
      [gameId, endpointType, ...sourceFilter.params]
    ) || []

  return {
    profiles: rows.map((row) => ({
      profileName: row.profile_name || 'default',
      totalCount: Number(row.count || 0),
      activeCount: Number(row.activeCount || 0)
    }))
  }
}
