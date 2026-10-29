import { checkModUpdateTool } from './modUpdateCheckTool.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

const AGENT_TASK_STAGE = Object.freeze({
  REPAIRING: 'repairing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed'
})

const EXECUTABLE_LIFECYCLE_ACTIONS = Object.freeze(
  new Set(['enable_mod', 'disable_mod', 'uninstall_mod', 'reorder_priority'])
)
const SUPPORTED_LIFECYCLE_ACTIONS = Object.freeze(
  new Set([...EXECUTABLE_LIFECYCLE_ACTIONS, 'update_mod'])
)
const SENSITIVE_KEY_PATTERN =
  /api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization|auth.?header|session|credential|signature/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function redactLifecycleText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeLifecycleOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLifecycleOutput(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactLifecycleText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeLifecycleOutput(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function normalizeIdList(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((id) => toSafeNumber(id))
    .filter((id) => id > 0)
}

function normalizeLifecycleActionType(args = {}) {
  return toSafeText(args.actionType || args.action_type || args.type || args.action).toLowerCase()
}

function normalizeInstalledModId(args = {}) {
  return toSafeNumber(
    args.installedModId || args.installed_mod_id || args.modId || args.mod_id || args.id
  )
}

function normalizeInstalledModRow(row = {}) {
  return {
    installedModId: toSafeNumber(row.id),
    gameId: toSafeNumber(row.game_id),
    source: toSafeText(row.source),
    modId: toSafeText(row.mod_id),
    optionId: toSafeText(row.option_id),
    sourceModKey: toSafeText(row.source_mod_key),
    name: toSafeText(row.name),
    optionName: toSafeText(row.option_name),
    version: toSafeText(row.version) || toSafeText(row.mod_version),
    endpointType: toSafeNumber(row.endpoint_type),
    isActive: toSafeNumber(row.is_active) === 1,
    priorityOrder: toSafeNumber(row.priority_order),
    deployDomain: toSafeText(row.deploy_domain),
    installModel: toSafeText(row.install_model),
    profileName: toSafeText(row.profile_name)
  }
}

function summarizeLifecycleMod(mod = {}) {
  return {
    installedModId: toSafeNumber(mod.installedModId),
    name: redactLifecycleText(mod.name),
    source: toSafeText(mod.source),
    modId: redactLifecycleText(mod.modId),
    sourceModKey: redactLifecycleText(mod.sourceModKey),
    version: redactLifecycleText(mod.version),
    endpointType: toSafeNumber(mod.endpointType),
    isActive: mod.isActive === true,
    priorityOrder: toSafeNumber(mod.priorityOrder),
    deployDomain: redactLifecycleText(mod.deployDomain),
    profileName: redactLifecycleText(mod.profileName)
  }
}

function buildLifecycleImpact(actionType = '', mods = [], options = {}) {
  const affectedMods = (Array.isArray(mods) ? mods : [mods])
    .map((mod) => summarizeLifecycleMod(mod))
    .filter((mod) => mod.installedModId > 0)
  const changeMap = {
    enable_mod: ['将目标模组设为启用，并可能触发部署状态刷新。'],
    disable_mod: ['将目标模组设为禁用，并可能移除或重建相关部署文件。'],
    uninstall_mod: ['卸载目标模组，可能删除本地记录、安装文件和相关部署文件。'],
    reorder_priority: ['按指定 ID 顺序保存 priority_order，可能改变同路径文件覆盖胜出方。']
  }
  const impact = {
    actionType,
    destructive: actionType === 'uninstall_mod',
    affectedCount: affectedMods.length,
    affectedMods,
    changes: changeMap[actionType] || []
  }
  const previousIds = normalizeIdList(options.previousIds)
  const requestedIds = normalizeIdList(options.requestedIds)
  if (previousIds.length) impact.previousOrder = previousIds
  if (requestedIds.length) impact.requestedOrder = requestedIds
  return impact
}

function buildLifecycleRollbackSuggestions(actionType = '', mods = [], options = {}) {
  const affectedMods = (Array.isArray(mods) ? mods : [mods])
    .map((mod) => summarizeLifecycleMod(mod))
    .filter((mod) => mod.installedModId > 0)
  const firstMod = affectedMods[0] || {}
  if (actionType === 'enable_mod') {
    return [
      {
        type: 'inverse_lifecycle_plan',
        tool: 'vertex.mod.lifecycle_plan',
        actionType: 'disable_mod',
        installedModId: firstMod.installedModId,
        message: '如启用结果不符合预期，可重新生成 disable_mod 计划禁用该模组。'
      },
      {
        type: 'rollback_deploy_changes',
        tool: 'vertex.rollback.plan',
        message: '如执行过程产生部署任务，可用相关 taskId 检查是否存在可回滚部署备份。'
      }
    ]
  }
  if (actionType === 'disable_mod') {
    return [
      {
        type: 'inverse_lifecycle_plan',
        tool: 'vertex.mod.lifecycle_plan',
        actionType: 'enable_mod',
        installedModId: firstMod.installedModId,
        message: '如禁用结果不符合预期，可重新生成 enable_mod 计划启用该模组。'
      },
      {
        type: 'rollback_deploy_changes',
        tool: 'vertex.rollback.plan',
        message: '如执行过程产生部署任务，可用相关 taskId 检查是否存在可回滚部署备份。'
      }
    ]
  }
  if (actionType === 'uninstall_mod') {
    return [
      {
        type: 'rollback_deploy_changes',
        tool: 'vertex.rollback.plan',
        message: '卸载后如存在部署备份，优先用相关 taskId 检查可回滚范围。'
      },
      {
        type: 'reinstall_from_source',
        source: firstMod.source,
        sourceModKey: firstMod.sourceModKey,
        message: '如没有可用部署备份，需要从原来源重新安装该模组。'
      }
    ]
  }
  if (actionType === 'reorder_priority') {
    const previousIds = normalizeIdList(options.previousIds)
    return [
      {
        type: 'restore_previous_priority_order',
        tool: 'vertex.mod.lifecycle_plan',
        actionType: 'reorder_priority',
        ids: previousIds,
        message: '如排序结果不符合预期，可用 previousOrder 重新生成重排计划恢复原顺序。'
      },
      {
        type: 'review_conflicts',
        tool: 'vertex.conflict.detect',
        message: '如排序改变了覆盖关系，建议重新检测该游戏的部署冲突。'
      }
    ]
  }
  return []
}

function normalizeAction(args = {}) {
  const action = toPlainJson(args.action || args.lifecycleAction || args.executionPayload || args, {})
  const executionPayload = toPlainJson(action.executionPayload || action, {})
  const actionType = toSafeText(
    executionPayload.actionType || executionPayload.type || action.actionType || action.type
  ).toLowerCase()
  return {
    action,
    executionPayload,
    actionType
  }
}

async function getDefaultDbInstance() {
  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

async function getDeps(overrides = {}, options = {}) {
  const deps = {
    ...overrides
  }
  if (!deps.db) {
    deps.db = await getDefaultDbInstance()
  }

  if (options.includeExecution) {
    if (
      typeof deps.createAgentTask !== 'function' ||
      typeof deps.updateAgentTask !== 'function' ||
      typeof deps.appendAgentTaskLog !== 'function' ||
      typeof deps.getAgentTask !== 'function'
    ) {
      const taskCenter = await import('../taskCenter.js')
      deps.createAgentTask = deps.createAgentTask || taskCenter.createAgentTask
      deps.updateAgentTask = deps.updateAgentTask || taskCenter.updateAgentTask
      deps.appendAgentTaskLog = deps.appendAgentTaskLog || taskCenter.appendAgentTaskLog
      deps.getAgentTask = deps.getAgentTask || taskCenter.getAgentTask
    }
    if (
      typeof deps.toggleModState !== 'function' ||
      typeof deps.uninstallModById !== 'function' ||
      typeof deps.saveModPriorityOrder !== 'function'
    ) {
      const gameMethod = await import('../../../../ipc/game/method.js')
      deps.toggleModState = deps.toggleModState || gameMethod.toggleModState
      deps.uninstallModById = deps.uninstallModById || gameMethod.uninstallModById
      deps.saveModPriorityOrder = deps.saveModPriorityOrder || gameMethod.saveModPriorityOrder
    }
  }

  return deps
}

function getInstalledModById(db, installedModId = 0) {
  if (!db || installedModId <= 0) return null
  return db.get(`SELECT * FROM mods WHERE id = ? LIMIT 1`, [installedModId])
}

function listInstalledModsByIds(db, ids = []) {
  if (!db || !ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.all(
    `SELECT * FROM mods WHERE id IN (${placeholders}) ORDER BY priority_order ASC, id ASC`,
    ids
  )
  return Array.isArray(rows) ? rows : []
}

function createLifecycleAction(payload = {}) {
  const actionType = toSafeText(payload.actionType)
  const riskLevel =
    actionType === 'uninstall_mod' ? 'destructive' : actionType === 'reorder_priority' ? 'medium' : 'high'
  const impact = toPlainJson(payload.impact, null)
  const rollbackSuggestions = Array.isArray(payload.rollbackSuggestions)
    ? toPlainJson(payload.rollbackSuggestions, [])
    : []
  const action = {
    type: actionType,
    actionType,
    title: toSafeText(payload.title),
    riskLevel,
    requiresConfirmation: true,
    executionPayload: {
      actionType,
      ...toPlainJson(payload.executionPayload, {})
    }
  }
  if (impact && typeof impact === 'object') action.impact = impact
  if (rollbackSuggestions.length) action.rollbackSuggestions = rollbackSuggestions
  return action
}

function buildUpdateInstallPlanCandidate(updateResult = {}, installedMod = {}, args = {}) {
  const remoteRecord = updateResult.remoteRecord || {}
  const source = toSafeText(updateResult.source)
  const sourceGameId = pickFirstText(
    remoteRecord.sourceGameId,
    args.sourceGameId,
    args.source_game_id,
    args.gameId,
    args.game_id
  )
  const sourceSlug = pickFirstText(
    remoteRecord.sourceSlug,
    args.sourceSlug,
    args.source_slug,
    args.domainName,
    args.community
  )
  const candidate = {
    ...toPlainJson(remoteRecord, {}),
    source,
    sourceLabel: toSafeText(updateResult.sourceLabel),
        modId: pickFirstText(remoteRecord.modId, remoteRecord.id, installedMod.modId),
        id: pickFirstText(remoteRecord.id, remoteRecord.modId, installedMod.modId),
        name: pickFirstText(remoteRecord.name, installedMod.name),
        version: pickFirstText(updateResult.latestVersion, remoteRecord.version),
    sourceGameId,
    sourceSlug,
    packageOwner: pickFirstText(remoteRecord.packageOwner),
    packageName: pickFirstText(remoteRecord.packageName),
    fullName: pickFirstText(remoteRecord.fullName)
  }
  if (source === 'nexus') {
    candidate.domainName = pickFirstText(candidate.domainName, sourceSlug)
  } else if (source === 'modio') {
    candidate.gameId = pickFirstText(candidate.gameId, sourceGameId)
    candidate.modioGameId = pickFirstText(candidate.modioGameId, sourceGameId)
  } else if (source === 'thunderstore') {
    candidate.community = pickFirstText(candidate.community, sourceGameId, sourceSlug)
  }
  return candidate
}

async function buildUpdateLifecyclePlan(args = {}, depsOverride = {}) {
  const updateResult = await checkModUpdateTool(args, {}, depsOverride)
  if (!updateResult?.success) {
    return {
      ...toPlainJson(updateResult, {}),
      actionType: 'update_mod',
      updateAvailable: false,
      actions: [],
      primaryAction: null,
      nextActions: updateResult?.nextActions || [
        {
          type: 'fix_update_check',
          label: '修正更新检查输入',
          message: updateResult?.message || '请先补齐更新检查所需的来源身份或本地模组记录。'
        }
      ]
    }
  }

  const installedMod = updateResult.installedMod || {}
  const updateAvailable = updateResult.hasUpdate === true || updateResult.updateAvailable === true
  const impact = {
    actionType: 'update_mod',
    destructive: false,
    affectedCount: installedMod.installedModId ? 1 : 0,
    affectedMods: installedMod.installedModId ? [installedMod] : [],
    currentVersion: toSafeText(updateResult.currentVersion),
    latestVersion: toSafeText(updateResult.latestVersion),
    changes: updateAvailable
      ? ['将基于来源详情生成新的安装预检计划；实际写入仍由 vertex.install.execute_plan 确认后提交。']
      : []
  }
  const rollbackSuggestions = updateAvailable
    ? [
        {
          type: 'rollback_deploy_changes',
          tool: 'vertex.rollback.plan',
          message: '更新安装执行后如产生部署任务，可用相关 taskId 检查可回滚部署备份。'
        },
        {
          type: 'keep_current_version_record',
          currentVersion: toSafeText(updateResult.currentVersion),
          message: '生成更新预检前保留当前版本信息；必要时可按来源重新安装当前版本。'
        }
      ]
    : []
  const inspectPayload = updateAvailable
    ? {
        source: toSafeText(updateResult.source),
        candidate: buildUpdateInstallPlanCandidate(updateResult, installedMod, args),
        installedModId: toSafeNumber(installedMod.installedModId),
        currentVersion: toSafeText(updateResult.currentVersion),
        latestVersion: toSafeText(updateResult.latestVersion),
        reason: redactLifecycleText(args.reason)
      }
    : null
  const actions = updateAvailable
    ? [
        {
          type: 'create_update_install_plan',
          actionType: 'update_mod',
          title: '生成更新安装预检',
          tool: 'vertex.install.inspect_plan',
          riskLevel: 'high',
          requiresConfirmation: false,
          executionPayload: inspectPayload
        }
      ]
    : []

  return {
    success: true,
    actionType: 'update_mod',
    source: updateResult.source,
    sourceLabel: updateResult.sourceLabel,
    installedMod,
    remoteRecord: updateResult.remoteRecord,
    currentVersion: updateResult.currentVersion,
    latestVersion: updateResult.latestVersion,
    compareResult: updateResult.compareResult,
    hasUpdate: updateAvailable,
    updateAvailable,
    status: updateResult.status,
    executionSupported: false,
    lifecycleExecuteSupported: false,
    impact,
    rollbackSuggestions,
    warnings: [],
    actions,
    primaryAction: null,
    nextActions: updateAvailable
      ? [
          {
            type: 'create_install_plan',
            tool: 'vertex.install.inspect_plan',
            label: '生成更新安装预检',
            payload: inspectPayload,
            message:
              '检测到远端新版本。请用 vertex.install.inspect_plan 基于该候选生成标准安装预检，确认后再提交安装任务。'
          }
        ]
      : updateResult.nextActions || [],
    message: updateAvailable
      ? `已生成更新计划引导：${updateResult.currentVersion || 'unknown'} -> ${
          updateResult.latestVersion || 'unknown'
        }。`
      : updateResult.message || '当前没有可用更新。'
  }
}

function buildSingleModLifecyclePlan(actionType = '', mod = {}, args = {}) {
  const force = args.force === true
  const reason = redactLifecycleText(args.reason)
  const installedModId = toSafeNumber(mod.installedModId)
  const blockers = []
  const warnings = []

  if (actionType === 'enable_mod' && mod.isActive) {
    warnings.push({
      code: 'mod_already_enabled',
      message: '目标模组当前已经启用，执行后可能只刷新状态。'
    })
  }
  if (actionType === 'disable_mod' && !mod.isActive) {
    warnings.push({
      code: 'mod_already_disabled',
      message: '目标模组当前已经禁用，执行后可能只刷新状态。'
    })
  }
  if (actionType === 'uninstall_mod' && mod.isActive) {
    warnings.push({
      code: 'active_mod_uninstall',
      message: '目标模组当前处于启用状态，卸载会影响已部署文件。'
    })
  }

  const titleMap = {
    enable_mod: '启用已安装模组',
    disable_mod: '禁用已安装模组',
    uninstall_mod: '卸载已安装模组'
  }
  const impact = buildLifecycleImpact(actionType, [mod])
  const rollbackSuggestions = buildLifecycleRollbackSuggestions(actionType, [mod])
  const action = createLifecycleAction({
    actionType,
    title: titleMap[actionType],
    impact,
    rollbackSuggestions,
    executionPayload: {
      installedModId,
      force,
      reason
    }
  })

  return {
    success: blockers.length === 0,
    actionType,
    mod,
    impact,
    rollbackSuggestions,
    blockers,
    warnings,
    actions: blockers.length ? [] : [action],
    primaryAction: blockers.length ? null : action,
    nextActions: blockers.length
      ? [
          {
            type: 'fix_lifecycle_plan',
            label: '修正生命周期计划',
            message: '请先处理阻断项，再生成执行动作。'
          }
        ]
      : [
          {
            type: 'execute_lifecycle_action',
            label: '执行生命周期动作',
            message: '确认无误后，可调用 vertex.mod.lifecycle_execute 执行该 action。'
          }
        ],
    message: blockers.length
      ? '生命周期计划存在阻断项。'
      : `已生成 ${titleMap[actionType]} 的生命周期执行计划。`
  }
}

function buildReorderLifecyclePlan(args = {}, rows = []) {
  const ids = normalizeIdList(args.ids || args.installedModIds || args.installed_mod_ids)
  if (ids.length < 2) {
    return {
      success: false,
      errorCode: 'missing_priority_order_ids',
      actionType: 'reorder_priority',
      message: '重排模组优先级至少需要 2 个 installedModId。'
    }
  }

  const modMap = new Map(rows.map((row) => [toSafeNumber(row.id), normalizeInstalledModRow(row)]))
  const mods = ids.map((id) => modMap.get(id)).filter(Boolean)
  const foundIds = new Set(mods.map((item) => item.installedModId))
  const missingIds = ids.filter((id) => !foundIds.has(id))
  if (missingIds.length) {
    return {
      success: false,
      errorCode: 'installed_mod_not_found',
      actionType: 'reorder_priority',
      missingIds,
      message: '部分模组记录不存在，无法生成优先级重排执行计划。'
    }
  }
  const action = createLifecycleAction({
    actionType: 'reorder_priority',
    title: '重排模组优先级',
    impact: buildLifecycleImpact('reorder_priority', mods, {
      previousIds: rows.map((row) => row?.id),
      requestedIds: ids
    }),
    rollbackSuggestions: buildLifecycleRollbackSuggestions('reorder_priority', mods, {
      previousIds: rows.map((row) => row?.id)
    }),
    executionPayload: {
      ids,
      previousIds: normalizeIdList(rows.map((row) => row?.id)),
      reason: redactLifecycleText(args.reason)
    }
  })

  return {
    success: true,
    actionType: 'reorder_priority',
    mods,
    impact: action.impact,
    rollbackSuggestions: action.rollbackSuggestions || [],
    warnings: [],
    actions: [action],
    primaryAction: action,
    nextActions: [
      {
        type: 'execute_lifecycle_action',
        label: '执行优先级重排',
        message: '确认排序顺序后，可调用 vertex.mod.lifecycle_execute 执行该 action。'
      }
    ],
    message: '已生成模组优先级重排计划。'
  }
}

export async function createModLifecyclePlanTool(args = {}, depsOverride = {}) {
  const actionType = normalizeLifecycleActionType(args)
  if (!actionType) {
    return {
      success: false,
      errorCode: 'missing_lifecycle_action',
      message: '缺少生命周期动作类型。'
    }
  }
  if (!SUPPORTED_LIFECYCLE_ACTIONS.has(actionType)) {
    return {
      success: false,
      errorCode: 'unsupported_lifecycle_action',
      actionType,
      supportedActions: [...SUPPORTED_LIFECYCLE_ACTIONS],
      message: `暂不支持的生命周期动作：${actionType}`
    }
  }
  if (actionType === 'update_mod') {
    return buildUpdateLifecyclePlan(args, depsOverride)
  }

  const deps = await getDeps(depsOverride)
  if (actionType === 'reorder_priority') {
    const ids = normalizeIdList(args.ids || args.installedModIds || args.installed_mod_ids)
    return buildReorderLifecyclePlan(args, listInstalledModsByIds(deps.db, ids))
  }

  const installedModId = normalizeInstalledModId(args)
  if (installedModId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_installed_mod_id',
      actionType,
      message: 'installedModId 无效，请先调用 vertex.mod.installed_list。'
    }
  }

  const row = getInstalledModById(deps.db, installedModId)
  if (!row) {
    return {
      success: false,
      errorCode: 'installed_mod_not_found',
      actionType,
      message: `本地未找到已安装模组记录（installedModId=${installedModId}）。`
    }
  }

  return buildSingleModLifecyclePlan(actionType, normalizeInstalledModRow(row), args)
}

async function completeLifecycleTask(taskId = '', result = {}, deps = {}) {
  const safeResult = sanitizeLifecycleOutput(result) || {}
  const completedTask = await deps.updateAgentTask(taskId, {
    stage: AGENT_TASK_STAGE.COMPLETED,
    progress: 100,
    currentTarget: '生命周期动作执行完成',
    result: safeResult
  })
  await deps.appendAgentTaskLog(taskId, 'info', '生命周期动作执行完成', safeResult)
  return completedTask || (await deps.getAgentTask(taskId))
}

async function failLifecycleTask(taskId = '', errorCode = '', message = '', detail = {}, deps = {}) {
  const safeMessage = redactLifecycleText(message, '模组生命周期动作执行失败')
  const safeDetail = sanitizeLifecycleOutput(detail) || {}
  const failedTask = await deps.updateAgentTask(taskId, {
    stage: AGENT_TASK_STAGE.FAILED,
    progress: 100,
    currentTarget: safeMessage,
    errorCode,
    errorMessage: safeMessage,
    result: {
      success: false,
      errorCode,
      message: safeMessage,
      ...safeDetail
    }
  })
  await deps.appendAgentTaskLog(taskId, 'error', safeMessage, {
    errorCode,
    ...safeDetail
  })
  return failedTask || (await deps.getAgentTask(taskId))
}

async function executeToggleLifecycleAction(actionType = '', payload = {}, task = {}, deps = {}, ctx = {}) {
  const installedModId = toSafeNumber(payload.installedModId || payload.modId || payload.id)
  if (installedModId <= 0) {
    throw Object.assign(new Error('缺少需要切换状态的模组 ID'), {
      errorCode: 'missing_installed_mod_id'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 45,
    currentTarget: actionType === 'enable_mod' ? '启用模组' : '禁用模组'
  })
  const result = await deps.toggleModState(ctx.event || null, {
    id: installedModId,
    isActive: actionType === 'enable_mod',
    agentTaskId: task.taskId
  })
  if (result?.success === false) {
    throw Object.assign(new Error(result.message || '切换模组状态失败'), {
      errorCode: result.errorCode || `${actionType}_failed`,
      detail: {
        lifecycleResult: result
      }
    })
  }

  return {
    success: true,
    actionType,
    linkedJobId: toSafeText(result?.taskId),
    lifecycleResult: {
      success: result?.success !== false,
      taskId: toSafeText(result?.taskId),
      id: installedModId,
      message: redactLifecycleText(result?.message),
      warning: result?.warning === true
    },
    message: redactLifecycleText(
      result?.message || (actionType === 'enable_mod' ? '模组已启用。' : '模组已禁用。')
    )
  }
}

async function executeUninstallLifecycleAction(payload = {}, task = {}, deps = {}, ctx = {}) {
  const installedModId = toSafeNumber(payload.installedModId || payload.modId || payload.id)
  if (installedModId <= 0) {
    throw Object.assign(new Error('缺少需要卸载的模组 ID'), {
      errorCode: 'missing_installed_mod_id'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 45,
    currentTarget: '卸载模组'
  })
  const result = await deps.uninstallModById(ctx.event || null, {
    id: installedModId,
    force: payload.force === true,
    agentTaskId: task.taskId
  })
  if (result?.success === false) {
    throw Object.assign(new Error(result.message || '卸载模组失败'), {
      errorCode: result.errorCode || 'uninstall_mod_failed',
      detail: {
        lifecycleResult: result
      }
    })
  }

  return {
    success: true,
    actionType: 'uninstall_mod',
    linkedJobId: toSafeText(result?.taskId),
    lifecycleResult: {
      success: result?.success !== false,
      taskId: toSafeText(result?.taskId),
      id: toSafeNumber(result?.id || installedModId),
      optionId: toSafeNumber(result?.optionId),
      endpointType: toSafeNumber(result?.endpointType, -1),
      name: redactLifecycleText(result?.name),
      warning: result?.warning === true,
      needRecovery: result?.needRecovery === true,
      recoveryTotal: toSafeNumber(result?.recoveryTotal),
      recoverySuccess: toSafeNumber(result?.recoverySuccess),
      recoveryFailed: toSafeNumber(result?.recoveryFailed),
      message: redactLifecycleText(result?.message)
    },
    message: redactLifecycleText(result?.message || '模组已卸载。')
  }
}

async function executeReorderLifecycleAction(payload = {}, task = {}, deps = {}, ctx = {}) {
  const ids = normalizeIdList(payload.ids || payload.installedModIds || payload.installed_mod_ids)
  if (ids.length < 2) {
    throw Object.assign(new Error('缺少需要保存的排序记录'), {
      errorCode: 'missing_priority_order_ids'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 45,
    currentTarget: '保存模组优先级'
  })
  const result = await deps.saveModPriorityOrder(ctx.event || null, {
    ids,
    source: payload.source,
    endpointType: payload.endpointType,
    agentTaskId: task.taskId
  })
  if (result?.success === false) {
    throw Object.assign(new Error(result.message || '排序保存失败'), {
      errorCode: result.errorCode || 'reorder_priority_failed',
      detail: {
        lifecycleResult: result
      }
    })
  }

  return {
    success: true,
    actionType: 'reorder_priority',
    linkedJobId: toSafeText(result?.taskId || result?.transactionId),
    lifecycleResult: {
      success: result?.success !== false,
      taskId: toSafeText(result?.taskId),
      updatedCount: ids.length,
      message: redactLifecycleText(result?.message)
    },
    message: redactLifecycleText(result?.message || '模组优先级已重排。')
  }
}

export async function executeModLifecycleTool(args = {}, ctx = {}, depsOverride = {}) {
  assertToolExecutionActive(ctx?.signal)
  const deps = await getDeps(depsOverride, { includeExecution: true })
  const normalized = normalizeAction(args)
  if (!normalized.actionType) {
    return {
      success: false,
      errorCode: 'missing_lifecycle_action',
      message: '缺少生命周期执行 action。'
    }
  }
  if (!EXECUTABLE_LIFECYCLE_ACTIONS.has(normalized.actionType)) {
    return {
      success: false,
      errorCode: 'unsupported_lifecycle_action',
      actionType: normalized.actionType,
      message: `暂不支持执行的生命周期动作：${normalized.actionType}`
    }
  }

  const task = await deps.createAgentTask({
    sessionId: ctx?.sessionId || args.sessionId,
    type: 'mod_lifecycle',
    stage: AGENT_TASK_STAGE.REPAIRING,
    progress: 10,
    currentTarget: redactLifecycleText(normalized.action.title || normalized.actionType),
    cancelable: false,
    authorizationMode: ctx?.mode || args.authorizationMode,
    plan: {
      action: sanitizeLifecycleOutput(normalized.action) || {}
    }
  })
  await deps.appendAgentTaskLog(task.taskId, 'info', '开始执行模组生命周期动作', {
    actionType: normalized.actionType
  })

  try {
    let result
    if (normalized.actionType === 'enable_mod' || normalized.actionType === 'disable_mod') {
      result = await executeToggleLifecycleAction(
        normalized.actionType,
        normalized.executionPayload,
        task,
        deps,
        ctx
      )
    } else if (normalized.actionType === 'uninstall_mod') {
      result = await executeUninstallLifecycleAction(normalized.executionPayload, task, deps, ctx)
    } else if (normalized.actionType === 'reorder_priority') {
      result = await executeReorderLifecycleAction(normalized.executionPayload, task, deps, ctx)
    }

    await deps.updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.VERIFYING,
      progress: 90,
      currentTarget: '确认生命周期结果'
    })
    if (['enable_mod', 'disable_mod', 'uninstall_mod'].includes(normalized.actionType)) {
      const id = toSafeNumber(normalized.executionPayload.installedModId || normalized.executionPayload.modId || normalized.executionPayload.id)
      const row = getInstalledModById(deps.db, id)
      const verified = normalized.actionType === 'uninstall_mod'
        ? !row && result?.lifecycleResult?.needRecovery !== true
        : Boolean(row) && (Number(row.is_active) === 1) === (normalized.actionType === 'enable_mod')
      if (!verified) throw Object.assign(new Error('操作返回后，本地模组状态尚未达到目标；请检查任务和恢复信息，不能报告已完成。'), {
        errorCode: 'lifecycle_verification_failed', detail: { verified: false, installedModId: id, lifecycleResult: result?.lifecycleResult }
      })
      result = { ...result, verified: true, completionState: 'verified', verification: { installedModId: id, present: Boolean(row), isActive: row ? Number(row.is_active) === 1 : null } }
    }
    const completedResult = sanitizeLifecycleOutput({
      ...result,
      impact: normalized.action.impact || result?.impact,
      rollbackSuggestions: Array.isArray(normalized.action.rollbackSuggestions)
        ? normalized.action.rollbackSuggestions
        : Array.isArray(result?.rollbackSuggestions)
          ? result.rollbackSuggestions
          : []
    })
    const completedTask = await completeLifecycleTask(task.taskId, completedResult, deps)
    return {
      ...completedResult,
      taskId: task.taskId,
      task: completedTask
    }
  } catch (error) {
    const errorCode = toSafeText(error?.errorCode, 'mod_lifecycle_execute_failed')
    const message = redactLifecycleText(error?.message, '模组生命周期动作执行失败')
    const detail = sanitizeLifecycleOutput(error?.detail || {}) || {}
    const failedTask = await failLifecycleTask(
      task.taskId,
      errorCode,
      message,
      detail,
      deps
    )
    return {
      success: false,
      taskId: task.taskId,
      task: failedTask,
      errorCode,
      message,
      ...detail
    }
  }
}
