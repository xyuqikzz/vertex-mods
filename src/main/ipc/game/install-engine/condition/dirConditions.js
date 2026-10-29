/**
 * condition/dirConditions.js — 目录类条件评估族
 *
 * 每个评估器接收 (match, ec)，命中字段则返回一个 check，否则返回 null。
 * ec.index 为顶层快照索引；ec.getRecursive() 返回递归快照索引。
 * 行为与原 conditionMatcher._evaluateCondition 中对应字段块逐字一致。
 */
import { matchGlobPattern } from '../globMatcher.js'
import { createCheck, normalizeConditionTextList } from './conditionUtils.js'

export function evalRootHasDirs(match, ec) {
  const expected = normalizeConditionTextList(match.root_has_dirs, { lowerCase: true })
  if (!expected.length) return null
  const { directDirNames } = ec.index
  const allPresent = expected.every((dir) => directDirNames.has(dir))
  const missing = expected.filter((dir) => !directDirNames.has(dir))
  const actualList = Array.from(directDirNames).slice(0, 5)
  return createCheck(
    'archive',
    'root_has_dirs',
    expected,
    allPresent,
    allPresent ? '顶层目录全部存在' : `顶层目录缺失: ${missing.join(', ')}`,
    {
      actual: actualList,
      suggestion: allPresent ? '' : `压缩包顶层缺少期望的目录 [${missing.join(', ')}]，实际仅包含 [${actualList.join(', ')}]。请检查打包层级或目录名称大小写。`
    }
  )
}

export function evalAnyRootDirs(match, ec) {
  const expected = normalizeConditionTextList(match.any_root_dirs, { lowerCase: true })
  if (!expected.length) return null
  const { directDirNames } = ec.index
  const anyPresent = expected.some((dir) => directDirNames.has(dir))
  const actualList = Array.from(directDirNames).slice(0, 5)
  return createCheck(
    'archive',
    'any_root_dirs',
    expected,
    anyPresent,
    anyPresent ? '顶层目录至少命中一个' : '顶层目录无一命中',
    {
      actual: actualList,
      suggestion: anyPresent ? '' : `压缩包顶层目录未包含期望目录 [${expected.join(', ')}] 中的任意一个，实际仅包含 [${actualList.join(', ')}]。请检查模组包是否被多层文件夹嵌套。`
    }
  )
}

export function evalNoneRootDirs(match, ec) {
  const expected = normalizeConditionTextList(match.none_root_dirs, { lowerCase: true })
  if (!expected.length) return null
  const { directDirNames } = ec.index
  const conflicts = expected.filter((dir) => directDirNames.has(dir))
  const nonePresent = conflicts.length === 0
  return createCheck(
    'archive',
    'none_root_dirs',
    expected,
    nonePresent,
    nonePresent ? '顶层目录黑名单未命中' : `顶层目录中存在被排除的目录: ${conflicts.join(', ')}`,
    {
      actual: conflicts,
      suggestion: nonePresent ? '' : `压缩包顶层包含了被排除的黑名单目录 [${conflicts.join(', ')}]。请检查压缩包是否包含非必须文件或多余文件夹。`
    }
  )
}

export async function evalAnyDirBasenames(match, ec) {
  const expected = normalizeConditionTextList(match.any_dir_basenames, { lowerCase: true })
  if (!expected.length) return null
  const { allDirNames } = await ec.getRecursive()
  const anyPresent = expected.some((name) => allDirNames.has(name))
  const actualList = Array.from(allDirNames).slice(0, 5)
  return createCheck(
    'archive',
    'any_dir_basenames',
    expected,
    anyPresent,
    anyPresent ? '递归目录名至少命中一个' : '递归目录名无一命中',
    {
      actual: actualList,
      suggestion: anyPresent ? '' : `在压缩包内的所有子目录中，均未找到文件夹名称为 [${expected.join(', ')}] 的目录。实际文件夹缩影前5个: [${actualList.join(', ')}]。`
    }
  )
}

export async function evalAnyDirPatterns(match, ec) {
  const expected = normalizeConditionTextList(match.any_dir_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allDirPaths } = await ec.getRecursive()
  const anyMatched = expected.some((pattern) =>
    allDirPaths.some((dp) => matchGlobPattern(pattern, dp))
  )
  const actualList = allDirPaths.slice(0, 5)
  return createCheck(
    'archive',
    'any_dir_patterns',
    expected,
    anyMatched,
    anyMatched ? '递归目录路径至少命中一个 glob' : '递归目录路径无一命中 glob',
    {
      actual: actualList,
      suggestion: anyMatched ? '' : `压缩包中没有文件夹匹配 Glob 模式 [${expected.join(', ')}]。`
    }
  )
}

export async function evalAllDirPatterns(match, ec) {
  const expected = normalizeConditionTextList(match.all_dir_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allDirPaths } = await ec.getRecursive()
  const allMatched = expected.every((pattern) =>
    allDirPaths.some((dp) => matchGlobPattern(pattern, dp))
  )
  const missing = expected.filter((pattern) =>
    !allDirPaths.some((dp) => matchGlobPattern(pattern, dp))
  )
  const actualList = allDirPaths.slice(0, 5)
  return createCheck(
    'archive',
    'all_dir_patterns',
    expected,
    allMatched,
    allMatched ? '递归目录路径全部命中 glob' : `递归目录路径未全部命中 glob，缺失: ${missing.join(', ')}`,
    {
      actual: actualList,
      suggestion: allMatched ? '' : `压缩包中未满足全部目录匹配模式，缺失: [${missing.join(', ')}]。`
    }
  )
}

export async function evalNoneDirPatterns(match, ec) {
  const expected = normalizeConditionTextList(match.none_dir_patterns, { pathLike: true })
  if (!expected.length) return null
  const { allDirPaths } = await ec.getRecursive()
  const conflicts = allDirPaths.filter((dp) =>
    expected.some((pattern) => matchGlobPattern(pattern, dp))
  )
  const noneMatched = conflicts.length === 0
  return createCheck(
    'archive',
    'none_dir_patterns',
    expected,
    noneMatched,
    noneMatched ? '递归目录路径黑名单未命中' : `递归目录路径中存在被排除的目录(递归目录路径黑名单被命中): ${conflicts.slice(0, 5).join(', ')}`,
    {
      actual: conflicts.slice(0, 5),
      suggestion: noneMatched ? '' : `压缩包中包含了被排除的黑名单目录路径 [${conflicts.slice(0, 5).join(', ')}]。`
    }
  )
}
