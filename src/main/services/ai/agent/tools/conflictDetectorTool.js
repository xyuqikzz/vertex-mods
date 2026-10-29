import {
  collectCandidateInstallTargets,
  createConflictAnalysisFromRows
} from '../../../../../shared/ai/installation/ai-agent-conflict-analysis.js'

/**
 * 冲突检测只读工具（vertex.conflict.detect，Phase 1 账本查询版）：
 * 基于 mod_file_manifest（每个模组声明的目标路径）与 mod_file_owners（当前生效方）
 * 检测同目标路径覆盖冲突。只读，不触发任何修复或重建。
 */

const MAX_CONFLICT_PATHS = 100

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

async function resolveDatabase(dependencies = {}) {
  if (dependencies.db) {
    return dependencies.db
  }
  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

export async function detectModConflictsTool(args = {}, dependencies = {}) {
  const gameId = toSafeNumber(args.gameId, 0)
  if (gameId <= 0) {
    return {
      success: false,
      errorCode: 'invalid_game_id',
      message: 'gameId 无效，请先调用 vertex.game.list 获取本地游戏列表。'
    }
  }

  const database = await resolveDatabase(dependencies)
  if (!database.tableExists('mod_file_manifest')) {
    return {
      success: true,
      conflicts: [],
      conflictCount: 0,
      note: '当前本地库尚无部署文件账本（mod_file_manifest），无法做覆盖冲突分析。'
    }
  }

  const conditions = ['mf.game_id = ?']
  const params = [gameId]

  if (args.endpointType === 0 || args.endpointType === 1) {
    conditions.push('mf.endpoint_type = ?')
    params.push(toSafeNumber(args.endpointType))
  }
  const deployDomain = toSafeText(args.deployDomain)
  if (deployDomain) {
    conditions.push('mf.deploy_domain = ?')
    params.push(deployDomain)
  }
  const candidateTargets = collectCandidateInstallTargets({
    ...args,
    endpointType: args.endpointType === 0 || args.endpointType === 1 ? args.endpointType : 0,
    deployDomain
  }).slice(0, MAX_CONFLICT_PATHS)
  const candidateConditions = []
  const candidateParams = []
  for (const target of candidateTargets) {
    if (toSafeText(target.deployDomain)) {
      candidateConditions.push(
        '(mf.endpoint_type = ? AND mf.deploy_domain = ? AND mf.target_relative_path = ?)'
      )
      candidateParams.push(
        toSafeNumber(target.endpointType, 0),
        toSafeText(target.deployDomain),
        toSafeText(target.targetRelativePath)
      )
    } else {
      candidateConditions.push('(mf.endpoint_type = ? AND mf.target_relative_path = ?)')
      candidateParams.push(toSafeNumber(target.endpointType, 0), toSafeText(target.targetRelativePath))
    }
  }
  const conflictPathConditions = [
    `(mf.endpoint_type, mf.deploy_domain, mf.target_relative_path) IN (
           SELECT endpoint_type, deploy_domain, target_relative_path
           FROM mod_file_manifest
           WHERE game_id = ?
           GROUP BY endpoint_type, deploy_domain, target_relative_path
           HAVING COUNT(DISTINCT mod_id) > 1
         )`,
    ...candidateConditions
  ]

  // 同一(endpoint_type, deploy_domain, target_relative_path)被多个模组声明 → 覆盖冲突
  let rows = []
  try {
    rows = database.all(
      `SELECT
         mf.endpoint_type,
         mf.deploy_domain,
         mf.target_relative_path,
         mf.mod_id,
         m.name AS mod_name,
         m.source AS mod_source,
         m.priority_order,
         m.is_active
       FROM mod_file_manifest mf
       LEFT JOIN mods m ON m.id = mf.mod_id
       WHERE ${conditions.join(' AND ')}
         AND (${conflictPathConditions.join(' OR ')})
       ORDER BY mf.deploy_domain ASC, mf.target_relative_path ASC, m.priority_order ASC`,
      [...params, gameId, ...candidateParams]
    )
  } catch (error) {
    return {
      success: false,
      errorCode: 'conflict_query_failed',
      message: `冲突账本查询失败：${toSafeText(error?.message) || '未知错误'}`
    }
  }

  let ownerRows = []
  if (database.tableExists('mod_file_owners')) {
    try {
      ownerRows = database.all(
        `SELECT endpoint_type, deploy_domain, target_relative_path, owner_mod_id, owner_priority_order
         FROM mod_file_owners
         WHERE game_id = ?`,
        [gameId]
      )
    } catch {
      // owners 表读取失败时按无生效方信息处理
      ownerRows = []
    }
  }

  const analysis = createConflictAnalysisFromRows(rows, ownerRows, {
    maxConflictPaths: MAX_CONFLICT_PATHS,
    installPlan: args.installPlan,
    candidatePlan: args.candidatePlan,
    plan: args.plan,
    standardPreflight: args.standardPreflight,
    candidateTargets
  })

  return {
    success: true,
    ...analysis
  }
}
