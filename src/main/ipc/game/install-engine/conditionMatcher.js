/**
 * conditionMatcher.js — 统一条件评估模块（薄分派器）
 *
 * 统一处理标准扁平 match、命名空间条件和历史 when 组合条件。
 * 只处理编译阶段规范化后的标准字段名（snake_case）。
 *
 * 输入: match 对象 + context { snapshot, gameRoot, candidateRoot }
 * 输出: { matched, checks, missedReason }
 *
 * 字段族评估已下沉到 condition/ 子模块；本文件负责：快照/索引准备、按原始顺序
 * 分派字段评估器（保持 fast 模式逐字段短路语义）、组合条件与命名空间条件递归。
 */

import { isPlainObject, toArrayValue, toSafeText } from './contracts.js'
import { collectTopLevelSnapshot, ensureRecursiveSnapshot } from './fsSnapshot.js'
import { createCheck, buildMissedReason, extractNamespacedConditionKey } from './condition/conditionUtils.js'
import { EMPTY_SNAPSHOT, getConditionIndex } from './condition/conditionIndex.js'
import { convertArchiveConditionToFlat } from './condition/archiveCondition.js'
import { evaluateGameCondition } from './condition/gameCondition.js'
import {
  evalRootHasDirs,
  evalAnyRootDirs,
  evalNoneRootDirs,
  evalAnyDirBasenames,
  evalAnyDirPatterns,
  evalAllDirPatterns,
  evalNoneDirPatterns
} from './condition/dirConditions.js'
import {
  evalRootHasFiles,
  evalAnyRootFiles,
  evalNoneRootFiles,
  evalAnyFileBasenames,
  evalAnyFilePatterns,
  evalAllFilePatterns,
  evalNoneFilePatterns
} from './condition/fileConditions.js'
import {
  evalAnyFileNames,
  evalAllFileNames,
  evalNoneFileNames,
  evalAnyFileExtensions,
  evalAllFileExtensions,
  evalNoneFileExtensions,
  evalMinFileCount,
  evalMaxFileCount,
  evalRootEntryCountMin,
  evalRootEntryCountMax
} from './condition/textConditions.js'

// 字段评估器按原 _evaluateCondition 中字段块的顺序排列，保持 fast 模式逐字段短路语义。
// O1：每个评估器关联 fieldName，按 match 的 key 直接查 evaluator，避免 28 次空评估。
const FIELD_EVALUATOR_ENTRIES = [
  // ─── 目录条件 ───
  { fieldName: 'root_has_dirs', evaluate: evalRootHasDirs },
  { fieldName: 'any_root_dirs', evaluate: evalAnyRootDirs },
  { fieldName: 'none_root_dirs', evaluate: evalNoneRootDirs },
  // ─── 文件条件 ───
  { fieldName: 'root_has_files', evaluate: evalRootHasFiles },
  { fieldName: 'any_root_files', evaluate: evalAnyRootFiles },
  { fieldName: 'none_root_files', evaluate: evalNoneRootFiles },
  // ─── 文件名条件 ───
  { fieldName: 'any_file_names', evaluate: evalAnyFileNames },
  { fieldName: 'all_file_names', evaluate: evalAllFileNames },
  { fieldName: 'none_file_names', evaluate: evalNoneFileNames },
  { fieldName: 'any_file_basenames', evaluate: evalAnyFileBasenames },
  { fieldName: 'any_dir_basenames', evaluate: evalAnyDirBasenames },
  // ─── glob 模式条件 ───
  { fieldName: 'any_file_patterns', evaluate: evalAnyFilePatterns },
  { fieldName: 'all_file_patterns', evaluate: evalAllFilePatterns },
  { fieldName: 'none_file_patterns', evaluate: evalNoneFilePatterns },
  { fieldName: 'any_dir_patterns', evaluate: evalAnyDirPatterns },
  { fieldName: 'all_dir_patterns', evaluate: evalAllDirPatterns },
  { fieldName: 'none_dir_patterns', evaluate: evalNoneDirPatterns },
  // ─── 扩展名条件 ───
  { fieldName: 'any_file_extensions', evaluate: evalAnyFileExtensions },
  { fieldName: 'all_file_extensions', evaluate: evalAllFileExtensions },
  { fieldName: 'none_file_extensions', evaluate: evalNoneFileExtensions },
  // ─── 数量条件 ───
  { fieldName: 'min_file_count', evaluate: evalMinFileCount },
  { fieldName: 'max_file_count', evaluate: evalMaxFileCount },
  { fieldName: 'root_entry_count_min', evaluate: evalRootEntryCountMin },
  { fieldName: 'root_entry_count_max', evaluate: evalRootEntryCountMax }
]

async function evaluateNamespacedCondition(scope = '', kind = '', payload = {}, context = {}, options = {}) {
  if (scope === 'game') {
    const gameCheck = await evaluateGameCondition(kind, payload, context)
    return {
      matched: gameCheck.matched,
      checks: [gameCheck]
    }
  }

  const subMatch = convertArchiveConditionToFlat(kind, payload)
  if (subMatch && Object.keys(subMatch).length) {
    return await evaluateCondition(subMatch, context, options)
  }

  return {
    matched: false,
    checks: [createCheck('archive', kind, payload, false, '压缩包条件无有效字段')]
  }
}

/**
 * 评估扁平 match 条件对象
 *
 * 所有字段之间是 AND 关系。
 * any/any_of 子字段内部是 OR 关系。
 *
 * @param {object} match - 规范化后的扁平条件对象
 * @param {object} context - { snapshot, gameRoot, candidateRoot, snapshotCache }
 * @returns {Promise<{ matched: boolean, checks: array, missedReason: object|null }>}
 */
async function _evaluateCondition(match = {}, context = {}, options = {}) {
  if (!isPlainObject(match) || Object.keys(match).length === 0) {
    // 空条件不命中，避免无条件规则误安装。
    return {
      matched: false,
      checks: [createCheck('rule', 'empty', {}, false, '空条件不匹配')],
      missedReason: { ruleId: '', code: 'empty_match', message: '空条件不匹配', details: {} }
    }
  }

  const mode = options.mode || 'explain'
  const isFast = mode === 'fast'
  const checks = []
  let matched = true

  // 快速短路助手
  function checkShortCircuit() {
    return isFast && !matched
  }

  // 获取快照
  const candidateRoot = toSafeText(context.candidateRoot || context.stagingPath)
  let snapshot = isPlainObject(context.snapshot)
    ? context.snapshot
    : candidateRoot
      ? await collectTopLevelSnapshot(candidateRoot, context.snapshotCache || new Map())
      : EMPTY_SNAPSHOT

  // 顶层索引在递归加载前一次性求值；递归索引按需惰性加载并缓存。
  const topLevelIndex = getConditionIndex(snapshot)
  let recursiveIndex = null
  const getRecursive = async () => {
    if (recursiveIndex) return recursiveIndex
    if (snapshot?.recursiveLoaded !== true) {
      snapshot = await ensureRecursiveSnapshot(snapshot, context.snapshotCache || new Map())
    }
    recursiveIndex = getConditionIndex(snapshot)
    return recursiveIndex
  }
  const ec = { index: topLevelIndex, getRecursive }

  // ─── 扁平字段条件：O1 按 match 的 key 直接查 evaluator，避免 28 次空评估 ───
  // 保持原始字段顺序（按 FIELD_EVALUATOR_ENTRIES 顺序遍历 match 中存在的字段）
  for (const { fieldName, evaluate } of FIELD_EVALUATOR_ENTRIES) {
    if (!(fieldName in match)) continue
    const check = await evaluate(match, ec)
    if (check) {
      checks.push(check)
      if (check.matched !== true) matched = false
    }
    if (checkShortCircuit()) {
      return { matched: false, checks, missedReason: buildMissedReason(checks) }
    }
  }

  // ─── 条件组合：any_of ───

  const anyOfConditions = toArrayValue(match.any_of)
  if (anyOfConditions.length) {
    let anyOfMatched = false
    for (const subMatch of anyOfConditions) {
      const subResult = await evaluateCondition(subMatch, context, options)
      if (subResult.matched) {
        anyOfMatched = true
        checks.push(...subResult.checks)
        break
      }
    }
    if (!anyOfMatched) {
      checks.push(createCheck('archive', 'any_of', match.any_of, false, 'any_of 子条件组无一满足'))
      matched = false
    }
  }
  if (checkShortCircuit()) return { matched: false, checks, missedReason: buildMissedReason(checks) }

  // ─── 组合条件 ───

  const allConditions = toArrayValue(match.all)
  for (const condition of allConditions) {
    const subResult = await evaluateCondition(condition, context, options)
    checks.push(...subResult.checks)
    if (!subResult.matched) {
      matched = false
      if (isFast) {
        return {
          matched: false,
          checks,
          missedReason: buildMissedReason(checks)
        }
      }
    }
  }

  const anyConditions = toArrayValue(match.any)
  if (anyConditions.length) {
    let anyMatched = false
    for (const condition of anyConditions) {
      const subResult = await evaluateCondition(condition, context, options)
      if (subResult.matched) {
        anyMatched = true
        checks.push(...subResult.checks)
        break
      }
    }
    if (!anyMatched) {
      checks.push(createCheck('rule', 'any', match.any, false, 'any 子条件组无一满足'))
      matched = false
    }
  }
  if (checkShortCircuit()) return { matched: false, checks, missedReason: buildMissedReason(checks) }

  const notConditions = toArrayValue(match.not)
  for (const condition of notConditions) {
    const subResult = await evaluateCondition(condition, context, options)
    const notMatched = !subResult.matched
    checks.push(
      createCheck(
        'rule',
        'not',
        condition,
        notMatched,
        notMatched ? '排除条件未命中' : '排除条件被命中'
      )
    )
    if (!notMatched) {
      matched = false
      if (isFast) {
        return {
          matched: false,
          checks,
          missedReason: buildMissedReason(checks)
        }
      }
    }
  }

  // ─── archive/game 命名空间条件 ───
  // O12：按固定顺序 [archive, game] 遍历命名空间条件，避免依赖 Object.entries 插入顺序。
  const NAMESPACE_ORDER = ['archive', 'game']
  const namespacedEntries = []
  for (const key of Object.keys(match)) {
    const namespaced = extractNamespacedConditionKey(key)
    if (!namespaced) continue
    namespacedEntries.push(namespaced)
  }
  namespacedEntries.sort((a, b) => {
    const ai = NAMESPACE_ORDER.indexOf(a.scope)
    const bi = NAMESPACE_ORDER.indexOf(b.scope)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })

  for (const namespaced of namespacedEntries) {
    const payload = match[`${namespaced.scope}.${namespaced.kind}`]
    const subResult = await evaluateNamespacedCondition(
      namespaced.scope,
      namespaced.kind,
      payload,
      context,
      options
    )
    checks.push(...subResult.checks)
    if (!subResult.matched) {
      matched = false
      if (isFast) {
        return {
          matched: false,
          checks,
          missedReason: buildMissedReason(checks)
        }
      }
    }
  }

  // O12：match.archive 命名空间条件（对象形式）
  if (isPlainObject(match.archive)) {
    for (const [kind, payload] of Object.entries(match.archive)) {
      const subResult = await evaluateNamespacedCondition('archive', kind, payload, context, options)
      checks.push(...subResult.checks)
      if (!subResult.matched) {
        matched = false
        if (isFast) {
          return {
            matched: false,
            checks,
            missedReason: buildMissedReason(checks)
          }
        }
      }
    }
  }

  if (isPlainObject(match.game)) {
    for (const [kind, payload] of Object.entries(match.game)) {
      const gameCheck = await evaluateGameCondition(kind, payload, context)
      checks.push(gameCheck)
      if (!gameCheck.matched) {
        matched = false
        if (isFast) {
          return {
            matched: false,
            checks,
            missedReason: buildMissedReason(checks)
          }
        }
      }
    }
  }

  // 如果没有任何有效条件被评估，视为不匹配
  if (!checks.length) {
    return {
      matched: false,
      checks: [createCheck('rule', 'no_conditions', {}, false, '无有效条件')],
      missedReason: { ruleId: '', code: 'no_conditions', message: '无有效条件', details: {} }
    }
  }

  return {
    matched,
    checks,
    missedReason: matched ? null : buildMissedReason(checks)
  }
}

export async function evaluateCondition(match = {}, context = {}, options = {}) {
  const logger = context.logger
  if (logger) {
    logger.info('condition_evaluation', `开始评估规则条件`, {
      ruleId: options.ruleId || '',
      context: { match }
    })
  }

  const result = await _evaluateCondition(match, context, options)

  if (logger) {
    if (result.matched) {
      logger.info('condition_evaluation', `规则条件评估完全命中`, {
        ruleId: options.ruleId || '',
        checks: result.checks
      })
    } else {
      logger.warn('condition_evaluation', `规则条件评估未命中`, {
        ruleId: options.ruleId || '',
        checks: result.checks
      })
    }
  }

  return result
}
