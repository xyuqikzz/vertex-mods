/**
 * singleTargetPlanner.js — 单目标规划模块
 *
 * 统一引擎单目标安装规划模块。
 * 处理无 routes 的规则：source 解析 → target 解析 → 操作构建 → assemblePlan
 */

import { resolvePackageProfile } from './package-adapters/index.js'
import { resolveRuleTargetLocation } from './targetResolver.js'
import { assemblePlan } from './planAssembler.js'
import { INSTALL_ENGINE_ERROR_CODES, InstallEngineError } from './installEngineError.js'
import { buildCopyOperations, resolveRuleSourceSelection } from './sharedPlannerUtils.js'
import { resolveRuleIdentity } from './planningPipeline.js'
import { resolveRuleConflictPolicy, stampOperationsConflictPolicy } from './conflictPolicyResolver.js'

/**
 * 构建单目标安装计划
 *
 * @param {object} rule - 命中的规则（已编译、已规范化）
 * @param {object} snapshot - 暂存目录快照
 * @param {object} context - 引擎上下文
 * @param {object} meta - { candidates, missedReasons }
 * @returns {Promise<object>} InstallPlan
 */
export async function buildSingleTargetPlan(rule = {}, snapshot, context = {}, meta = {}) {
  const { ruleId, confidence } = resolveRuleIdentity(rule)
  const conflictPolicy = resolveRuleConflictPolicy(rule)

  // 1. 源选择
  const sourceSelection = await resolveRuleSourceSelection(rule, {
    ...context,
    matchEvidence: meta.candidates?.at(-1)?.evaluation?.checks || []
  })

  // 2. 包类型识别
  const packageResult = await resolvePackageProfile({
    ...context,
    candidateRoot: sourceSelection.sourceRoot,
    sourceRoot: sourceSelection.sourceRoot,
    snapshot: sourceSelection.snapshot
  })
  const packageProfile = packageResult.profile || {}

  // 3. 目标解析
  const targetLocation = await resolveRuleTargetLocation(rule, context, packageProfile)

  // 4. 操作构建（标记规则级冲突策略）
  const operations = await buildCopyOperations(sourceSelection, targetLocation.targetRoot)
  if (!operations.length) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装规则命中，但没有可复制的部署文件'
    )
  }
  stampOperationsConflictPolicy(operations, conflictPolicy)

  // 5. 组装完整计划
  return await assemblePlan({
    rule,
    ruleId,
    confidence,
    operations,
    sourceSelection,
    targetLocation,
    packageProfile,
    context,
    meta,
    mode: 'single_target',
    plannerMode: 'unified_single_target'
  })
}
