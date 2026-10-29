/**
 * planValidator.js - Plan 完整性与安全性校验模块
 *
 * 用于在最终组装安装计划之前，对物理文件的存在性、目标路径是否越界安全，
 * 以及是否存在未捕获的源文件进行全面的静态与动态检查，提前拦截潜在问题。
 */

import fs from 'fs-extra'
import { isPathInside } from './pathSafety.js'
import { COVERAGE_LEDGER_STATUS } from './coverageLedger.js'
import {
  MERGE_POLICY_NOT_SUPPORTED_CODE,
  MERGE_POLICY_NOT_SUPPORTED_MESSAGE,
  normalizeConflictPolicy
} from './conflictPolicyResolver.js'

/**
 * 校验计划的完整性与安全性
 *
 * @param {object} basePlan - 基础计划对象
 * @param {object} context - 上下文环境
 * @returns {Promise<object>} 包含 errors, warnings, risks 的校验结果
 */
export async function validatePlanCompleteness(basePlan = {}, context = {}) {
  const errors = []
  const warnings = []
  const risks = []

  const operations = basePlan.operations || []
  const changeSetEntries = Array.isArray(basePlan?.changeSet?.entries)
    ? basePlan.changeSet.entries
    : Array.isArray(basePlan?.changeSet?.items)
      ? basePlan.changeSet.items
      : []
  const targetRoot = basePlan.targetRoot || context.targetRoot || ''

  // 运行时兜底：即使规则绕过 schema，merge 也不能进入部署阶段。
  if (
    [...operations, ...changeSetEntries].some(
      (item) =>
        String(item?.action || '').trim().toLowerCase() === 'merge' ||
        normalizeConflictPolicy(
          item?.conflictPolicy ?? item?.conflict_policy ?? item?.appliedPolicy
        ) === 'merge'
    )
  ) {
    errors.push({
      type: MERGE_POLICY_NOT_SUPPORTED_CODE,
      code: MERGE_POLICY_NOT_SUPPORTED_CODE,
      level: 'blocker',
      message: MERGE_POLICY_NOT_SUPPORTED_MESSAGE
    })
  }

  // 1. 物理源文件存在性校验 (sourcePath 存在性)
  const copyOperations = operations.filter((op) => op.type === 'copy')
  if (copyOperations.length > 0) {
    const existenceChecks = await Promise.all(
      copyOperations.map(async (op) => {
        if (!op.sourcePath) {
          return { op, exists: false }
        }
        try {
          const exists = await fs.pathExists(op.sourcePath)
          return { op, exists }
        } catch {
          return { op, exists: false }
        }
      })
    )

    for (const { op, exists } of existenceChecks) {
      if (!exists) {
        errors.push({
          type: 'physical_file_missing',
          level: 'blocker',
          relativePath: op.relativePath || '',
          targetPath: op.targetPath || '',
          message: `物理源文件在暂存盘中不存在: ${op.sourcePath}`,
          detail: { sourcePath: op.sourcePath }
        })
      }
    }
  }

  // 2. 目标路径沙盒越界强校验 (targetPath 越界检测)
  if (targetRoot) {
    for (const op of operations) {
      if (op.targetPath) {
        const isSafe = isPathInside(targetRoot, op.targetPath)
        if (!isSafe) {
          errors.push({
            type: 'path_out_of_bounds',
            level: 'blocker',
            relativePath: op.relativePath || '',
            targetPath: op.targetPath || '',
            message: `目标部署路径越界，不在安装根目录范围内: ${op.targetPath}`,
            detail: { targetRoot, targetPath: op.targetPath }
          })
        }
      }
    }
  }

  // 3. 未匹配漏捕获文件审计
  const coverageLedger = basePlan.coverageLedger || []
  const unmatchedFiles = coverageLedger.filter(
    (item) => item.type === 'file' && item.status === COVERAGE_LEDGER_STATUS.UNMATCHED
  )

  for (const item of unmatchedFiles) {
    warnings.push({
      type: 'unmatched_source_file',
      level: 'warning',
      relativePath: item.relativePath || '',
      message: `源文件未匹配到任何安装规则，将被忽略: ${item.relativePath}`,
      detail: { relativePath: item.relativePath }
    })
  }

  // 4. 空操作安全拦截
  const hasValidOps = operations.some((op) => op.type === 'copy' || op.type === 'mkdir')
  if (basePlan.ruleId && !hasValidOps) {
    errors.push({
      type: 'empty_plan_operations',
      level: 'blocker',
      message: `未生成任何有效安装操作，已自动拦截。请检查安装规则与包内容是否匹配。`,
      detail: { ruleId: basePlan.ruleId }
    })
  }

  return {
    errors,
    warnings,
    risks
  }
}
