/**
 * condition/textConditions.js — 文件名 / 扩展名 / 数量条件评估族
 *
 * 每个评估器接收 (match, ec)，命中字段则返回一个 check，否则返回 null。
 * 行为与原 conditionMatcher._evaluateCondition 中对应字段块逐字一致。
 */
import {
  createCheck,
  normalizeConditionExtensionList,
  normalizeConditionNumber,
  normalizeConditionTextList
} from './conditionUtils.js'

export function evalAnyFileNames(match, ec) {
  const expected = normalizeConditionTextList(match.any_file_names, { lowerCase: true })
  if (!expected.length) return null
  const { directEntryNames } = ec.index
  const anyPresent = expected.some((name) => directEntryNames.has(name))
  const actualList = Array.from(directEntryNames).slice(0, 5)
  return createCheck(
    'archive',
    'any_file_names',
    expected,
    anyPresent,
    anyPresent ? '顶层子项名称至少命中一个' : '顶层子项名称无一命中',
    {
      actual: actualList,
      suggestion: anyPresent ? '' : `压缩包顶层的子项名称中未包含期望名称 [${expected.join(', ')}] 中的任意一个，实际仅包含 [${actualList.join(', ')}]。`
    }
  )
}

export function evalAllFileNames(match, ec) {
  const expected = normalizeConditionTextList(match.all_file_names, { lowerCase: true })
  if (!expected.length) return null
  const { directEntryNames } = ec.index
  const allPresent = expected.every((name) => directEntryNames.has(name))
  const missing = expected.filter((name) => !directEntryNames.has(name))
  const actualList = Array.from(directEntryNames).slice(0, 5)
  return createCheck(
    'archive',
    'all_file_names',
    expected,
    allPresent,
    allPresent ? '顶层子项名称全部存在' : `顶层子项名称缺失: ${missing.join(', ')}`,
    {
      actual: actualList,
      suggestion: allPresent ? '' : `压缩包顶层缺少期望的子项 [${missing.join(', ')}]，实际仅包含 [${actualList.join(', ')}]。`
    }
  )
}

export function evalNoneFileNames(match, ec) {
  const expected = normalizeConditionTextList(match.none_file_names, { lowerCase: true })
  if (!expected.length) return null
  const { directEntryNames } = ec.index
  const conflicts = expected.filter((name) => directEntryNames.has(name))
  const nonePresent = conflicts.length === 0
  return createCheck(
    'archive',
    'none_file_names',
    expected,
    nonePresent,
    nonePresent ? '顶层子项名称黑名单未命中' : `顶层子项中存在被排除的名称: ${conflicts.join(', ')}`,
    {
      actual: conflicts,
      suggestion: nonePresent ? '' : `压缩包顶层包含了被排除的黑名单子项名称 [${conflicts.join(', ')}]。`
    }
  )
}

export async function evalAnyFileExtensions(match, ec) {
  const expected = normalizeConditionExtensionList(match.any_file_extensions)
  if (!expected.length) return null
  const indexObj = await ec.getRecursive()
  const { allFiles } = indexObj
  const anyMatched = expected.some((ext) => indexObj.getFilesByExtension(ext).length > 0)
  const actualExtensions = Array.from(new Set(allFiles.map(item => (item.ext || '').toLowerCase()))).filter(Boolean).slice(0, 5)
  return createCheck(
    'archive',
    'any_file_extensions',
    expected,
    anyMatched,
    anyMatched ? '递归文件至少命中一种扩展名' : '递归文件无一命中指定扩展名',
    {
      actual: actualExtensions,
      suggestion: anyMatched ? '' : `压缩包内文件均不属于期望扩展名 [${expected.join(', ')}]。实际拥有扩展名前5个: [${actualExtensions.join(', ')}]。这说明压缩包中不含有该模组所需的资源/代码文件类型。`
    }
  )
}

export async function evalAllFileExtensions(match, ec) {
  const expected = normalizeConditionExtensionList(match.all_file_extensions)
  if (!expected.length) return null
  const indexObj = await ec.getRecursive()
  const { allFiles } = indexObj
  let matchedCount = 0
  for (const ext of expected) {
    matchedCount += indexObj.getFilesByExtension(ext).length
  }
  const allMatched = allFiles.length > 0 && matchedCount === allFiles.length
  const actualExtensions = Array.from(new Set(allFiles.map(item => (item.ext || '').toLowerCase()))).filter(Boolean).slice(0, 5)
  return createCheck(
    'archive',
    'all_file_extensions',
    expected,
    allMatched,
    allMatched ? '递归文件全部属于指定扩展名集合' : '递归文件不全属于指定扩展名集合',
    {
      actual: actualExtensions,
      suggestion: allMatched ? '' : `压缩包内包含了不在期望扩展名范围 [${expected.join(', ')}] 内的其他类型文件。实际拥有扩展名: [${actualExtensions.join(', ')}]。`
    }
  )
}

export async function evalNoneFileExtensions(match, ec) {
  const expected = normalizeConditionExtensionList(match.none_file_extensions)
  if (!expected.length) return null
  const indexObj = await ec.getRecursive()
  const conflicts = []
  for (const ext of expected) {
    if (indexObj.getFilesByExtension(ext).length > 0) {
      conflicts.push(ext)
    }
  }
  const noneMatched = conflicts.length === 0
  return createCheck(
    'archive',
    'none_file_extensions',
    expected,
    noneMatched,
    noneMatched ? '递归文件扩展名黑名单未命中' : `递归文件中存在被排除的扩展名: ${conflicts.join(', ')}`,
    {
      actual: conflicts,
      suggestion: noneMatched ? '' : `压缩包内包含了被黑名单禁止的文件扩展名 [${conflicts.join(', ')}]。`
    }
  )
}

export async function evalMinFileCount(match, ec) {
  const expected = normalizeConditionNumber(match.min_file_count)
  if (expected === null) return null
  const { allFiles } = await ec.getRecursive()
  const meetsMin = allFiles.length >= expected
  return createCheck(
    'archive',
    'min_file_count',
    expected,
    meetsMin,
    meetsMin
      ? `递归文件数量 ${allFiles.length} >= ${expected}`
      : `递归文件数量 ${allFiles.length} < ${expected}`,
    {
      actual: allFiles.length,
      suggestion: meetsMin ? '' : `压缩包内的文件总数太少（当前: ${allFiles.length}，期望至少: ${expected}）。这很可能是一个空包或已损坏的无效模组压缩包。`
    }
  )
}

export async function evalMaxFileCount(match, ec) {
  const expected = normalizeConditionNumber(match.max_file_count)
  if (expected === null) return null
  const { allFiles } = await ec.getRecursive()
  const meetsMax = allFiles.length <= expected
  return createCheck(
    'archive',
    'max_file_count',
    expected,
    meetsMax,
    meetsMax
      ? `递归文件数量 ${allFiles.length} <= ${expected}`
      : `递归文件数量 ${allFiles.length} > ${expected}`,
    {
      actual: allFiles.length,
      suggestion: meetsMax ? '' : `压缩包内的文件数超过了所允许的阈值（当前: ${allFiles.length}，期望最多: ${expected}）。请检查这是否是打包了不必要多余文件的合集包。`
    }
  )
}

export function evalRootEntryCountMin(match, ec) {
  const expected = normalizeConditionNumber(match.root_entry_count_min)
  if (expected === null) return null
  const entryCount = ec.index.directEntries.length
  const meetsMin = entryCount >= expected
  return createCheck(
    'archive',
    'root_entry_count_min',
    expected,
    meetsMin,
    meetsMin
      ? `顶层条目数量 ${entryCount} >= ${expected}`
      : `顶层条目数量 ${entryCount} < ${expected}`,
    {
      actual: entryCount,
      suggestion: meetsMin ? '' : `压缩包顶级文件夹中的文件及目录数量过少（当前: ${entryCount}，期望至少: ${expected}）。`
    }
  )
}

export function evalRootEntryCountMax(match, ec) {
  const expected = normalizeConditionNumber(match.root_entry_count_max)
  if (expected === null) return null
  const entryCount = ec.index.directEntries.length
  const meetsMax = entryCount <= expected
  return createCheck(
    'archive',
    'root_entry_count_max',
    expected,
    meetsMax,
    meetsMax
      ? `顶层条目数量 ${entryCount} <= ${expected}`
      : `顶层条目数量 ${entryCount} > ${expected}`,
    {
      actual: entryCount,
      suggestion: meetsMax ? '' : `压缩包顶层目录下的文件和文件夹数量过多（当前: ${entryCount}，最高限制: ${expected}）。这通常是打包人员在打包时没有新建总文件夹，而是直接将散乱的所有文件直接压缩引起的。建议添加顶级统领包。`
    }
  )
}
