/**
 * route/routeOperationBuilder.js — 单个 route 的操作构建
 *
 * 负责把命中 route 的源条目映射为安装操作（mkdir/copy），并更新覆盖账本、
 * 收集 route 内部目标冲突，最后并发物化到计划临时目录。
 */
import path from 'path'
import { isPlainObject, normalizeRelativeRulePath, toSafeText } from '../contracts.js'
import {
  COVERAGE_LEDGER_STATUS,
  updateLedgerEntry
} from '../coverageLedger.js'
import { runWithConcurrencyLimit } from '../concurrency.js'
import { sanitizeErrorMessage } from '../installEngineError.js'
import { joinTargetRelativePath, mapRouteSourceRelativePath } from '../pathMapper.js'
import {
  isStripPrefixRootDirectory,
  isEntryIncludedByRoute,
  isEntryExcludedByRoute
} from '../routeMatcher.js'
import { resolveMaterializeConcurrency, materializeOperation } from '../routeMaterializer.js'
import { markIncompleteUnrealGroups } from '../unrealGroupValidator.js'

function normalizeTargetKey(value = '') {
  return normalizeRelativeRulePath(value).toLowerCase()
}

function createInternalConflict(type = '', operation = {}, message = '') {
  return {
    type,
    level: 'blocker',
    relativePath: toSafeText(operation.relativePath || operation.relativeTargetPath),
    targetPath: sanitizeErrorMessage(operation.targetPath, ''),
    routeId: toSafeText(operation.routeId),
    ruleId: toSafeText(operation.ruleId),
    message
  }
}

function markParentDirectoriesInstalled(payload = {}) {
  const {
    sourceRelativePath = '',
    targetRelativePath = '',
    routeId = '',
    ruleId = '',
    ledgerIndex = new Map()
  } = payload
  const sourceParts = normalizeRelativeRulePath(sourceRelativePath).split('/').filter(Boolean)
  const targetParts = normalizeRelativeRulePath(targetRelativePath).split('/').filter(Boolean)
  if (sourceParts.length <= 1) return

  for (let index = 1; index < sourceParts.length; index += 1) {
    const sourceDir = sourceParts.slice(0, index).join('/')
    const targetDir = targetParts.slice(0, Math.min(index, targetParts.length - 1)).join('/')
    const current = ledgerIndex.get(sourceDir.toLowerCase())
    if (!current || current.status !== COVERAGE_LEDGER_STATUS.UNMATCHED) continue
    updateLedgerEntry(ledgerIndex, sourceDir, {
      status: COVERAGE_LEDGER_STATUS.INSTALLED,
      routeId,
      ruleId,
      targetRelativePath: targetDir,
      reason: '父目录随文件部署自动覆盖'
    })
  }
}

export async function buildOperationsForRoute(payload = {}) {
  const {
    route,
    routeId,
    ruleId,
    allEntries,
    targetLocation,
    materializedRoot,
    context,
    ledgerIndex,
    targetPathIndex
  } = payload
  const mapping = isPlainObject(route.mapping) ? route.mapping : {}
  const selectedEntries = []
  const skippedEntries = []
  const routeOperations = []
  const internalConflicts = []
  const exactPaths = Array.isArray(route.source?.paths) ? new Set(route.source.paths.map((value) => value.toLowerCase())) : null

  const entries = Array.isArray(route.source?.paths) && context.routeEntryIndex instanceof Map
    ? route.source.paths.map((value) => context.routeEntryIndex.get(value.toLowerCase())).filter(Boolean)
    : allEntries
  for (const entry of entries) {
    if (isEntryExcludedByRoute(entry, route)) {
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: COVERAGE_LEDGER_STATUS.IGNORED,
        routeId,
        ruleId,
        reason: '被 route.source.exclude 显式忽略'
      })
      skippedEntries.push(entry)
      continue
    }
    if (exactPaths ? !exactPaths.has(entry.relativePath.toLowerCase()) : !isEntryIncludedByRoute(entry, route)) continue
    selectedEntries.push(entry)
  }

  const blockedGroupEntries = markIncompleteUnrealGroups(
    route,
    selectedEntries.filter((e) => e.type === 'file'),
    ledgerIndex
  )

  for (const entry of selectedEntries) {
    if (blockedGroupEntries.has(entry.relativePath.toLowerCase())) {
      skippedEntries.push(entry)
      continue
    }

    const ledgerEntry = ledgerIndex.get(entry.relativePath.toLowerCase())
    if (ledgerEntry?.status === COVERAGE_LEDGER_STATUS.UNSAFE) {
      skippedEntries.push(entry)
      continue
    }
    if (ledgerEntry?.status === COVERAGE_LEDGER_STATUS.INSTALLED && !Array.isArray(route.source?.paths)) {
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: COVERAGE_LEDGER_STATUS.DUPLICATE,
        routeId,
        ruleId,
        reason: '源条目已被更早 route 覆盖，已跳过重复安装'
      })
      skippedEntries.push(entry)
      continue
    }

    if (isStripPrefixRootDirectory(entry, mapping, route)) {
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: COVERAGE_LEDGER_STATUS.INSTALLED,
        routeId,
        ruleId,
        targetRelativePath: targetLocation.targetRelativePath,
        reason: '源根目录已由 route 目标目录承载'
      })
      skippedEntries.push(entry)
      continue
    }

    let mappedRelativePath = ''
    try {
      mappedRelativePath = mapRouteSourceRelativePath(entry.relativePath, mapping, context)
    } catch (error) {
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: COVERAGE_LEDGER_STATUS.UNSAFE,
        routeId,
        ruleId,
        reason: toSafeText(error?.message || '路径映射失败')
      })
      skippedEntries.push(entry)
      continue
    }

    const targetRelativePath = joinTargetRelativePath(
      targetLocation.targetRelativePath,
      mappedRelativePath
    )
    const targetKey = normalizeTargetKey(targetRelativePath)
    const existingOperation = targetPathIndex.get(targetKey)
    if (existingOperation) {
      if (existingOperation.kind === 'dir' && entry.type === 'dir') {
        updateLedgerEntry(ledgerIndex, entry.relativePath, { status: COVERAGE_LEDGER_STATUS.INSTALLED, routeId, ruleId, targetRelativePath, reason: '目录与已有路由共享，文件仍逐项检查冲突' })
        continue
      }
      const sameSource =
        normalizeRelativeRulePath(existingOperation.sourceRelativePath).toLowerCase() ===
        normalizeRelativeRulePath(entry.relativePath).toLowerCase()
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: sameSource ? COVERAGE_LEDGER_STATUS.DUPLICATE : COVERAGE_LEDGER_STATUS.CONFLICT,
        routeId,
        ruleId,
        targetRelativePath,
        reason: sameSource ? '重复命中相同目标，已合并跳过' : '多个 route 映射到同一目标路径'
      })
      if (!sameSource) {
        internalConflicts.push(
          createInternalConflict(
            'route_target_conflict',
            {
              routeId,
              ruleId,
              relativePath: targetRelativePath,
              targetPath: path.resolve(
                targetLocation.targetBoundaryRoot,
                ...targetRelativePath.split('/')
              )
            },
            '多个 route 映射到同一目标路径'
          )
        )
      }
      skippedEntries.push(entry)
      continue
    }

    const materializedPath = path.resolve(materializedRoot, ...targetRelativePath.split('/'))
    const targetPath = path.resolve(
      targetLocation.targetBoundaryRoot,
      ...targetRelativePath.split('/')
    )
    const operation = {
      type: entry.type === 'dir' ? 'mkdir' : 'copy',
      kind: entry.type,
      sourcePath: materializedPath,
      originalSourcePath: toSafeText(entry.fullPath),
      sourceBoundaryRoot: context.stagingPath,
      sourceRelativePath: entry.relativePath,
      targetPath,
      relativePath: targetRelativePath,
      relativeTargetPath: targetRelativePath,
      routeId,
      ruleId
    }

    targetPathIndex.set(targetKey, operation)
    routeOperations.push(operation)
    updateLedgerEntry(ledgerIndex, entry.relativePath, {
      status: COVERAGE_LEDGER_STATUS.INSTALLED,
      routeId,
      ruleId,
      targetRelativePath,
      reason: ''
    })
    if (entry.type === 'file') {
      markParentDirectoriesInstalled({
        sourceRelativePath: entry.relativePath,
        targetRelativePath,
        routeId,
        ruleId,
        ledgerIndex
      })
    }
  }

  await runWithConcurrencyLimit(
    routeOperations,
    resolveMaterializeConcurrency(context, routeOperations.length),
    materializeOperation
  )

  return { operations: routeOperations, selectedEntries, skippedEntries, internalConflicts }
}
