/**
 * condition/fileConditions.js — 文件类条件评估族
 *
 * 每个评估器接收 (match, ec)，命中字段则返回一个 check，否则返回 null。
 * 行为与原 conditionMatcher._evaluateCondition 中对应字段块逐字一致。
 */
import { matchGlobPattern } from '../globMatcher.js'
import { createCheck, normalizeConditionTextList } from './conditionUtils.js'

export function evalRootHasFiles(match, ec) {
  const expected = normalizeConditionTextList(match.root_has_files, { lowerCase: true })
  if (!expected.length) return null
  const { directFileNames } = ec.index
  const allPresent = expected.every((file) => directFileNames.has(file))
  const missing = expected.filter((file) => !directFileNames.has(file))
  const actualList = Array.from(directFileNames).slice(0, 5)
  return createCheck(
    'archive',
    'root_has_files',
    expected,
    allPresent,
    allPresent ? '顶层文件全部存在' : `顶层文件缺失: ${missing.join(', ')}`,
    {
      actual: actualList,
      suggestion: allPresent ? '' : `压缩包顶层缺少期望的文件 [${missing.join(', ')}]，实际仅包含 [${actualList.join(', ')}]。请检查打包层级或确认文件名拼写及大小写是否匹配。`
    }
  )
}

export function evalAnyRootFiles(match, ec) {
  const expected = normalizeConditionTextList(match.any_root_files, { lowerCase: true })
  if (!expected.length) return null
  const { directFileNames } = ec.index
  const anyPresent = expected.some((file) => directFileNames.has(file))
  const actualList = Array.from(directFileNames).slice(0, 5)
  return createCheck(
    'archive',
    'any_root_files',
    expected,
    anyPresent,
    anyPresent ? '顶层文件至少命中一个' : '顶层文件无一命中',
    {
      actual: actualList,
      suggestion: anyPresent ? '' : `压缩包顶层未包含期望文件 [${expected.join(', ')}] 中的任意一个，实际仅包含 [${actualList.join(', ')}]。请确认压缩包是否为所选模组包。`
    }
  )
}

export function evalNoneRootFiles(match, ec) {
  const expected = normalizeConditionTextList(match.none_root_files, { lowerCase: true })
  if (!expected.length) return null
  const { directFileNames } = ec.index
  const conflicts = expected.filter((file) => directFileNames.has(file))
  const nonePresent = conflicts.length === 0
  return createCheck(
    'archive',
    'none_root_files',
    expected,
    nonePresent,
    nonePresent ? '顶层文件黑名单未命中' : `顶层文件中存在被排除的文件: ${conflicts.join(', ')}`,
    {
      actual: conflicts,
      suggestion: nonePresent ? '' : `压缩包顶层包含了被排除的黑名单文件 [${conflicts.join(', ')}]。`
    }
  )
}

export async function evalAnyFileBasenames(match, ec) {
  const expected = normalizeConditionTextList(match.any_file_basenames, { lowerCase: true })
  if (!expected.length) return null
  const { allFileNames } = await ec.getRecursive()
  const anyPresent = expected.some((name) => allFileNames.has(name))
  const actualList = Array.from(allFileNames).slice(0, 5)
  return createCheck(
    'archive',
    'any_file_basenames',
    expected,
    anyPresent,
    anyPresent ? '递归文件名至少命中一个' : '递归文件名无一命中',
    {
      actual: actualList,
      suggestion: anyPresent ? '' : `在压缩包内的所有子目录中，均未找到文件名为 [${expected.join(', ')}] 的文件。实际文件缩影前5个: [${actualList.join(', ')}]。这通常意味着该包结构不符合当前规则，或者文件已被重命名。`
    }
  )
}

export async function evalAnyFilePatterns(match, ec) {
  const expected = normalizeConditionTextList(match.any_file_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allFilePaths } = await ec.getRecursive()
  const anyMatched = expected.some((pattern) =>
    allFilePaths.some((fp) => matchGlobPattern(pattern, fp))
  )
  const actualList = allFilePaths.slice(0, 5)
  return createCheck(
    'archive',
    'any_file_patterns',
    expected,
    anyMatched,
    anyMatched ? '递归文件路径至少命中一个 glob' : '递归文件路径无一命中 glob',
    {
      matchedPaths: allFilePaths.filter((fp) => expected.some((pattern) => matchGlobPattern(pattern, fp))),
      actual: actualList,
      suggestion: anyMatched ? '' : `压缩包中没有文件匹配 Glob 模式 [${expected.join(', ')}]。实际文件相对路径前5个: [${actualList.join(', ')}]。请检查 Glob 表达式语法、通配符或模组打包层级。`
    }
  )
}

export async function evalAllFilePatterns(match, ec) {
  const expected = normalizeConditionTextList(match.all_file_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allFilePaths } = await ec.getRecursive()
  const allMatched = expected.every((pattern) =>
    allFilePaths.some((fp) => matchGlobPattern(pattern, fp))
  )
  const missing = expected.filter((pattern) =>
    !allFilePaths.some((fp) => matchGlobPattern(pattern, fp))
  )
  const actualList = allFilePaths.slice(0, 5)
  return createCheck(
    'archive',
    'all_file_patterns',
    expected,
    allMatched,
    allMatched ? '递归文件路径全部命中 glob' : `递归文件路径未全部命中 glob，缺失匹配的模式: ${missing.join(', ')}`,
    {
      matchedPaths: allFilePaths.filter((fp) => expected.some((pattern) => matchGlobPattern(pattern, fp))),
      actual: actualList,
      suggestion: allMatched ? '' : `未在压缩包中集齐所有符合 Glob 模式 [${expected.join(', ')}] 的文件路径，缺失: [${missing.join(', ')}]。`
    }
  )
}

export async function evalNoneFilePatterns(match, ec) {
  const expected = normalizeConditionTextList(match.none_file_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allFilePaths } = await ec.getRecursive()
  const conflicts = allFilePaths.filter((fp) =>
    expected.some((pattern) => matchGlobPattern(pattern, fp))
  )
  const noneMatched = conflicts.length === 0
  return createCheck(
    'archive',
    'none_file_patterns',
    expected,
    noneMatched,
    noneMatched ? '递归文件路径黑名单未命中' : `递归文件路径中存在被排除的文件路径: ${conflicts.slice(0, 5).join(', ')}`,
    {
      actual: conflicts.slice(0, 5),
      suggestion: noneMatched ? '' : `压缩包中包含了被黑名单排除的 Glob 模式文件路径 [${conflicts.slice(0, 5).join(', ')}]。`
    }
  )
}
