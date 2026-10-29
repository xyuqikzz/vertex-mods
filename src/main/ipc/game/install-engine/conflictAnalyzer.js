import fs from 'fs-extra'
import path from 'path'
import {
  createEmptyConflictResult,
  normalizeRelativeRulePath,
  toSafeNumber,
  toSafeText
} from './contracts.js'
import { sanitizeErrorMessage } from './installEngineError.js'
import { isPathInside } from './pathSafety.js'
import { normalizeDeploymentPath } from '../../../utils/deploymentPathIdentity.js'

function normalizeRelativeKey(value = '') {
  return normalizeRelativeRulePath(value).toLowerCase()
}

function readOwnerList(ownerIndex, targetPath = '', relativePath = '') {
  const key = normalizeDeploymentPath(targetPath)
  const legacyKey = normalizeRelativeKey(relativePath)
  if (!ownerIndex) return []
  if (ownerIndex instanceof Map) {
    return ownerIndex.get(key) || ownerIndex.get(legacyKey) || []
  }
  if (typeof ownerIndex === 'object') {
    const value = ownerIndex[key] || ownerIndex[legacyKey] || ownerIndex[relativePath]
    return Array.isArray(value) ? value : value ? [value] : []
  }
  return []
}

async function resolveOwnerIndex(context = {}) {
  if (context.ownerIndex) return context.ownerIndex
  const deployScope =
    context.deployScope && typeof context.deployScope === 'object' ? context.deployScope : {}
  if (!deployScope.gameId && !deployScope.game_id) return null

  try {
    const { buildFileOwnerIndex } = await import('../deployReconcilerRuntime.js')
    const result = await buildFileOwnerIndex(deployScope)
    return result.ownerIndex || null
  } catch (error) {
    return {
      __error: sanitizeErrorMessage(error?.message || error, '文件归属索引不可用')
    }
  }
}

function createConflict(type = '', level = 'warning', entry = {}, extra = {}) {
  return {
    type,
    level,
    relativePath: toSafeText(entry.relativePath || entry.relativeTargetPath),
    targetPath: sanitizeErrorMessage(entry.targetPath, ''),
    owner: extra.owner || null,
    message: toSafeText(extra.message),
    detail: extra.detail || {}
  }
}

function rankLevel(level = '') {
  const order = {
    none: 0,
    info: 1,
    warning: 2,
    high: 3,
    blocker: 4
  }
  return order[toSafeText(level).toLowerCase()] ?? 0
}

function resolveFinalLevel(conflicts = [], warnings = []) {
  const maxRank = Math.max(
    0,
    ...conflicts.map((item) => rankLevel(item.level)),
    ...warnings.map((item) => rankLevel(item.level))
  )
  if (maxRank >= 4) return 'blocker'
  if (maxRank >= 3) return 'warning'
  if (maxRank >= 2) return 'warning'
  if (maxRank >= 1) return 'info'
  return 'none'
}

export async function analyzePlanConflicts(changeSet = {}, context = {}) {
  const entries = Array.isArray(changeSet.entries)
    ? changeSet.entries
    : Array.isArray(changeSet.items)
      ? changeSet.items
      : []
  const targetRoot = path.resolve(toSafeText(changeSet.targetRoot || context.targetRoot || '.'))
  const ownerIndex = await resolveOwnerIndex(context)
  const conflicts = []
  const warnings = []
  const currentModId = toSafeNumber(
    context.currentModId || context.modId || context.optionId || context.recordId,
    0
  )

  if (ownerIndex?.__error) {
    warnings.push({
      type: 'owner_index_unavailable',
      level: 'info',
      message: `文件归属索引不可用：${ownerIndex.__error}`
    })
  }

  for (const entry of entries) {
    const targetPath = path.resolve(toSafeText(entry.targetPath))
    const relativePath = toSafeText(entry.relativePath || entry.relativeTargetPath)

    if (!targetPath || !isPathInside(targetRoot, targetPath)) {
      conflicts.push(
        createConflict('path_unsafe', 'blocker', entry, {
          message: '目标路径不在计划目标目录内'
        })
      )
      continue
    }

    const ownerList = readOwnerList(ownerIndex, targetPath, relativePath)
    const otherOwner = ownerList.find(
      (owner) => toSafeNumber(owner.modId || owner.mod_id, 0) !== currentModId
    )
    if (otherOwner) {
      conflicts.push(
        createConflict('owned_by_other_mod', 'high', entry, {
          owner: {
            modId: toSafeNumber(otherOwner.modId || otherOwner.mod_id, 0),
            source: toSafeText(otherOwner.source || otherOwner.sourcePlatform),
            title: toSafeText(otherOwner.record?.name || otherOwner.record?.option_name)
          },
          message: '目标文件已由其他模组占用'
        })
      )
      continue
    }

    const targetStat = await fs.stat(targetPath).catch(() => null)
    if (entry.kind === 'dir' && targetStat?.isDirectory()) {
      continue
    }
    if (entry.kind === 'dir' && targetStat && !targetStat.isDirectory()) {
      conflicts.push(
        createConflict('target_file_blocks_directory', 'blocker', entry, {
          message: '目录部署目标位置已有同名文件'
        })
      )
      continue
    }

    if (targetStat) {
      const policy = toSafeText(entry.conflictPolicy || entry.appliedPolicy).toLowerCase()
      const action = toSafeText(entry.action).toLowerCase()
      if (action === 'skip' || policy === 'skip') {
        // per-route 冲突策略 skip：目标已存在时按规则有意跳过，不计为冲突。
        continue
      }
      if (action === 'fail' || policy === 'fail') {
        conflicts.push(
          createConflict('target_file_policy_fail', 'blocker', entry, {
            message: '目标文件已存在，冲突策略为 fail，已阻断安装',
            detail: { conflictPolicy: 'fail' }
          })
        )
        continue
      }
      warnings.push(
        createConflict('target_file_exists', 'warning', entry, {
          message: '目标文件已存在，安装时需要覆盖或备份'
        })
      )
    }
  }

  const level = resolveFinalLevel(conflicts, warnings)
  return createEmptyConflictResult({
    status: 'completed',
    level,
    conflicts,
    warnings,
    requiresUserConfirm: ['warning', 'blocker'].includes(level),
    blockInstall: level === 'blocker',
    summary: {
      warningCount: warnings.length + conflicts.filter((item) => item.level !== 'blocker').length,
      blockerCount: conflicts.filter((item) => item.level === 'blocker').length,
      conflictCount: conflicts.length
    }
  })
}
