import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import {
  createEmptyChangeSet,
  normalizeRelativeRulePath,
  toSafeNumber,
  toSafeText
} from './contracts.js'
import { resolveAdaptiveConcurrency, runWithConcurrencyLimit } from './concurrency.js'
import { isPathInside } from './pathSafety.js'
import {
  DEFAULT_CONFLICT_POLICY,
  assertExecutableConflictPolicy,
  resolveExistingFileOutcome
} from './conflictPolicyResolver.js'

const DEFAULT_CHANGE_SET_CONCURRENCY = 10

// O2：大文件快速指纹阈值（100MB）+ 采样块大小（1MB）。
// 先用「size + 头部 1MB + 尾部 1MB」排除不同内容；采样相同再做完整 SHA-256。
const FAST_HASH_THRESHOLD = 100 * 1024 * 1024
const FAST_HASH_CHUNK_SIZE = 1024 * 1024

async function calculateSha256(filePath = '') {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

// O2：快速指纹 = sha256('size:' + fileSize + 头部 1MB + 尾部 1MB)，用 'fast:' 前缀标识。
async function calculateFastFingerprint(filePath = '', fileSize = 0) {
  const hash = crypto.createHash('sha256')
  hash.update(`size:${fileSize}`)
  const headStream = fs.createReadStream(filePath, { start: 0, end: FAST_HASH_CHUNK_SIZE - 1 })
  for await (const chunk of headStream) hash.update(chunk)
  if (fileSize > FAST_HASH_CHUNK_SIZE * 2) {
    const tailStream = fs.createReadStream(filePath, { start: fileSize - FAST_HASH_CHUNK_SIZE })
    for await (const chunk of tailStream) hash.update(chunk)
  }
  return `fast:${hash.digest('hex')}`
}

// O2：按文件大小自动选择快速指纹或完整哈希。stat 可选（传入避免重复 stat）。
async function calculateSha256Smart(filePath = '', stat = null) {
  if (stat && stat.size > FAST_HASH_THRESHOLD) {
    return calculateFastFingerprint(filePath, stat.size)
  }
  return calculateSha256(filePath)
}

async function calculateSha256Pair(sourcePath = '', targetPath = '') {
  return await Promise.all([
    calculateSha256(sourcePath).catch(() => ''),
    calculateSha256(targetPath).catch(() => '')
  ])
}

// O2：成对智能哈希，返回 [sourceHash, targetHash]，大文件用快速指纹。
async function calculateSha256PairSmart(sourcePath = '', targetPath = '', sourceStat = null, targetStat = null) {
  return await Promise.all([
    calculateSha256Smart(sourcePath, sourceStat).catch(() => ''),
    calculateSha256Smart(targetPath, targetStat).catch(() => '')
  ])
}

function resolveChangeSetConcurrency(context = {}, itemCount = null) {
  const concurrency = Number(context.changeSetConcurrency || context.hashConcurrency)
  if (Number.isFinite(concurrency) && concurrency > 0) {
    return Math.max(1, Math.floor(concurrency))
  }
  if (context.adaptiveConcurrency === false || itemCount === null) {
    return DEFAULT_CHANGE_SET_CONCURRENCY
  }
  return resolveAdaptiveConcurrency(itemCount, { base: DEFAULT_CHANGE_SET_CONCURRENCY, max: 16 })
}

async function collectFileOperationsFromRoot(sourceRoot = '', targetRoot = '') {
  const operations = []
  const safeSourceRoot = path.resolve(toSafeText(sourceRoot))
  const safeTargetRoot = path.resolve(toSafeText(targetRoot))
  if (!(await fs.pathExists(safeSourceRoot))) return operations

  async function walk(currentRoot = '') {
    const children = await fs.readdir(currentRoot, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      const sourcePath = path.join(currentRoot, child.name)
      if (child.isDirectory()) {
        await walk(sourcePath)
        continue
      }
      if (!child.isFile()) continue

      const relativePath = normalizeRelativeRulePath(path.relative(safeSourceRoot, sourcePath))
      operations.push({
        type: 'copy',
        kind: 'file',
        sourcePath,
        targetPath: path.join(safeTargetRoot, ...relativePath.split('/').filter(Boolean)),
        relativePath
      })
    }
  }

  await walk(safeSourceRoot)
  return operations
}

function normalizeOperationList(plan = {}) {
  return (Array.isArray(plan.operations) ? plan.operations : [])
    .map((operation) => ({
      type: toSafeText(operation.type || 'copy'),
      kind: toSafeText(operation.kind || (operation.type === 'mkdir' ? 'dir' : 'file')),
      sourcePath: toSafeText(operation.sourcePath || operation.from || operation.source),
      originalSourcePath: toSafeText(operation.originalSourcePath || operation.originalSource || ''),
      targetPath: toSafeText(operation.targetPath || operation.to || operation.target),
      relativePath: normalizeRelativeRulePath(operation.relativePath || operation.relative || ''),
      sourceRelativePath: normalizeRelativeRulePath(operation.sourceRelativePath || ''),
      routeId: toSafeText(operation.routeId),
      ruleId: toSafeText(operation.ruleId),
      conflictPolicy:
        assertExecutableConflictPolicy(
          operation.conflictPolicy ?? operation.conflict_policy ?? operation.appliedPolicy
        ) || ''
    }))
    .filter((operation) => operation.sourcePath && operation.targetPath)
}

async function buildChangeSetEntry(operation = {}, targetRoot = '', context = {}) {
  const sourcePath = path.resolve(operation.sourcePath)
  const targetPath = path.resolve(operation.targetPath)
  const relativePath =
    operation.relativePath ||
    normalizeRelativeRulePath(
      targetRoot && isPathInside(targetRoot, targetPath)
        ? path.relative(path.resolve(targetRoot), targetPath)
        : path.basename(targetPath)
    )
  const sourceStat = await fs.stat(sourcePath).catch(() => null)
  const isDirOperation = operation.kind === 'dir' || operation.type === 'mkdir'
  if (isDirOperation) {
    if (!sourceStat?.isDirectory()) return null
    const targetStat = await fs.stat(targetPath).catch(() => null)
    return {
      action: targetStat?.isDirectory() ? 'skip_existing_dir' : 'mkdir',
      kind: 'dir',
      sourcePath,
      originalSourcePath: operation.originalSourcePath,
      targetPath,
      relativePath,
      relativeTargetPath: relativePath,
      sourceRelativePath: operation.sourceRelativePath,
      routeId: operation.routeId,
      ruleId: operation.ruleId,
      fileSize: 0,
      sha256: '',
      targetSha256: '',
      owner: null,
      exists: !!targetStat,
      backupRequired: targetStat && !targetStat.isDirectory(),
      riskLevel: targetStat && !targetStat.isDirectory() ? 'warning' : 'none'
    }
  }

  if (!sourceStat?.isFile()) return null

  const targetStat = await fs.stat(targetPath).catch(() => null)
  const fileSize = toSafeNumber(sourceStat.size, 0)
  let sourceHash = ''
  let targetHash = ''
  let action = targetStat?.isFile() ? 'overwrite' : 'add'

  if (context.hash === true) {
    if (targetStat?.isFile()) {
      // O2：大文件用快速指纹（size + 头尾 1MB），降低 UE5 pak 几个 GB 文件哈希耗时。
      const hashPair = await calculateSha256PairSmart(sourcePath, targetPath, sourceStat, targetStat)
      sourceHash = hashPair[0]
      targetHash = hashPair[1]
      // 采样不同已经证明内容不同；采样相同仍须完整比对，不能把中间差异当作未变化。
      if (
        sourceHash &&
        targetHash &&
        sourceHash.startsWith('fast:') &&
        targetHash.startsWith('fast:') &&
        sourceHash === targetHash
      ) {
        // 仅完整哈希相同才能决定跳过。
        const fullPair = await calculateSha256Pair(sourcePath, targetPath)
        sourceHash = fullPair[0]
        targetHash = fullPair[1]
      }
    } else {
      sourceHash = await calculateSha256Smart(sourcePath, sourceStat).catch(() => '')
    }

    if (
      targetStat?.isFile() &&
      targetStat.size === sourceStat.size &&
      sourceHash &&
      sourceHash === targetHash
    ) {
      action = 'skip_same_hash'
    }
  }

  // per-route 冲突策略：仅当目标已存在且需覆盖时按策略推导动作/备份/风险。
  // 默认策略 backup = 覆盖并备份 + 提示，等价历史行为；未声明策略时零变更。
  const conflictPolicy =
    assertExecutableConflictPolicy(operation.conflictPolicy) || DEFAULT_CONFLICT_POLICY
  let backupRequired = false
  let riskLevel = 'none'
  if (action === 'overwrite') {
    const outcome = resolveExistingFileOutcome(conflictPolicy)
    action = outcome.action
    backupRequired = outcome.backupRequired
    riskLevel = outcome.riskLevel
  }

  return {
    action,
    kind: 'file',
    sourcePath,
    originalSourcePath: operation.originalSourcePath,
    targetPath,
    relativePath,
    relativeTargetPath: relativePath,
    sourceRelativePath: operation.sourceRelativePath,
    routeId: operation.routeId,
    ruleId: operation.ruleId,
    conflictPolicy,
    appliedPolicy: conflictPolicy,
    fileSize,
    sha256: sourceHash,
    targetSha256: targetHash,
    owner: null,
    exists: !!targetStat,
    backupRequired,
    riskLevel
  }
}

export async function buildPlanChangeSet(plan = {}, context = {}) {
  const sourceRoot = toSafeText(plan.sourceRoot || context.sourceRoot)
  const targetRoot = toSafeText(plan.targetRoot || context.targetRoot)
  let operations = normalizeOperationList(plan)
  if (!operations.length && sourceRoot && targetRoot) {
    operations = await collectFileOperationsFromRoot(sourceRoot, targetRoot)
  }

  const entries = (
    await runWithConcurrencyLimit(
      operations,
      resolveChangeSetConcurrency(context, operations.length),
      (operation) => buildChangeSetEntry(operation, targetRoot, context)
    )
  ).filter(Boolean)

  const summary = {
    addCount: entries.filter((item) => item.action === 'add').length,
    overwriteCount: entries.filter((item) => item.action === 'overwrite').length,
    skipSameHashCount: entries.filter((item) => item.action === 'skip_same_hash').length,
    deleteCount: 0,
    mkdirCount: entries.filter((item) => item.action === 'mkdir').length,
    restoreCount: 0,
    backupRequiredCount: entries.filter((item) => item.backupRequired).length
  }

  return createEmptyChangeSet({
    sourceRoot,
    targetRoot,
    entries,
    summary: {
      ...summary,
      add: summary.addCount,
      overwrite: summary.overwriteCount,
      skip: summary.skipSameHashCount,
      delete: summary.deleteCount,
      risk: summary.backupRequiredCount
    }
  })
}
