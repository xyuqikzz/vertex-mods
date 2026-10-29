import path from 'path'
import { isPlainObject, normalizeTextList, resolveFirstDefinedValue } from './contracts.js'
import { matchGlobPattern } from './globMatcher.js'
import { normalizeSafeRelativePath } from './pathSafety.js'
import { normalizeInstallFolderName, normalizePathLike } from './targetResolver.js'
import { caseInsensitiveEquals, caseInsensitiveStartsWith } from './caseCompare.js'

export {
  normalizeTargetBaseType,
  resolveRouteTargetLocation
} from './targetResolver.js'

export function normalizeRoutePatternList(value = []) {
  return normalizeTextList(value, { pathLike: true })
}

export function collectRouteIncludePatterns(source = {}) {
  return normalizeRoutePatternList(
    resolveFirstDefinedValue(
      source.include,
      source.includes,
      source.pattern,
      source.patterns,
      source.file_pattern,
      source.filePattern,
      source.file_patterns,
      source.filePatterns
    )
  )
}

export function collectRouteExcludePatterns(source = {}) {
  return normalizeRoutePatternList(
    resolveFirstDefinedValue(source.exclude, source.excludes, source.ignore, source.ignores)
  )
}

export function isRouteSourcePathMatched(relativePath = '', patterns = [], options = {}) {
  const normalizedPath = normalizePathLike(relativePath)
  const caseSensitive = options.caseSensitive === true
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => {
    const normalizedPattern = normalizePathLike(pattern)
    if (!normalizedPattern) return false
    if (normalizedPattern.endsWith('/**')) {
      const prefix = normalizedPattern.slice(0, -3).replace(/\/+$/g, '')
      if (caseSensitive) {
        return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
      }
      // H11：用 Intl.Collator 替代 toLowerCase() 比对，正确处理 Unicode 折叠。
      return (
        caseInsensitiveEquals(normalizedPath, prefix) ||
        caseInsensitiveStartsWith(normalizedPath, `${prefix}/`)
      )
    }
    if (normalizedPattern.startsWith('**/')) {
      const withoutDeepPrefix = normalizedPattern.slice(3)
      if (caseSensitive) {
        return (
          matchGlobPattern(normalizedPattern, normalizedPath, { caseSensitive: true }) ||
          matchGlobPattern(withoutDeepPrefix, normalizedPath, { caseSensitive: true })
        )
      }
      return (
        matchGlobPattern(normalizedPattern, normalizedPath) ||
        matchGlobPattern(withoutDeepPrefix, normalizedPath)
      )
    }
    return matchGlobPattern(normalizedPattern, normalizedPath, { caseSensitive })
  })
}

function normalizePrefixMatch(relativePath = '', prefix = '', caseSensitive = false) {
  const safePath = normalizePathLike(relativePath)
  const safePrefix = normalizePathLike(prefix)
  if (!safePrefix) {
    return {
      matched: false,
      rest: safePath
    }
  }

  const comparePath = caseSensitive ? safePath : safePath.toLowerCase()
  const comparePrefix = caseSensitive ? safePrefix : safePrefix.toLowerCase()
  if (comparePath === comparePrefix) {
    return {
      matched: true,
      rest: ''
    }
  }
  if (comparePath.startsWith(`${comparePrefix}/`)) {
    return {
      matched: true,
      rest: safePath.slice(safePrefix.length + 1)
    }
  }
  return {
    matched: false,
    rest: safePath
  }
}

function resolveReplacePrefix(mapping = {}) {
  const replacePrefix = mapping.replace_prefix || mapping.replacePrefix
  if (isPlainObject(replacePrefix)) {
    return {
      from: normalizePathLike(replacePrefix.from || replacePrefix.source || replacePrefix.match),
      to: normalizePathLike(replacePrefix.to || replacePrefix.target || replacePrefix.with)
    }
  }

  return {
    from: normalizePathLike(mapping.replace_prefix_from || mapping.replacePrefixFrom),
    to: normalizePathLike(mapping.replace_prefix_to || mapping.replacePrefixTo)
  }
}

function shouldPreserveContainer(mapping = {}) {
  return mapping.preserve_container === true || mapping.preserveContainer === true
}

export function mapRouteSourceRelativePath(relativePath = '', mapping = {}, context = {}) {
  const safeMapping = isPlainObject(mapping) ? mapping : {}
  const caseSensitive = safeMapping.case_sensitive === true || safeMapping.caseSensitive === true
  const preserveContainer = shouldPreserveContainer(safeMapping)
  let mappedPath = normalizeSafeRelativePath(relativePath, {
    errorMessage: '源路径不安全，无法映射'
  })

  const replacePrefix = resolveReplacePrefix(safeMapping)
  if (replacePrefix.from) {
    const result = normalizePrefixMatch(mappedPath, replacePrefix.from, caseSensitive)
    if (result.matched) {
      mappedPath = normalizePathLike([replacePrefix.to, result.rest].filter(Boolean).join('/'))
    }
  }

  const stripPrefix = normalizePathLike(safeMapping.strip_prefix || safeMapping.stripPrefix)
  if (stripPrefix) {
    const result = normalizePrefixMatch(mappedPath, stripPrefix, caseSensitive)
    if (result.matched) {
      mappedPath = result.rest
    }
  }

  if (safeMapping.flatten === true && !preserveContainer) {
    mappedPath = path.posix.basename(mappedPath)
  }

  if (safeMapping.append_package_dir === true || safeMapping.appendPackageDir === true) {
    mappedPath = normalizePathLike(
      `${normalizeInstallFolderName(context.packageFolderName || 'package')}/${mappedPath}`
    )
  }

  if (!mappedPath) {
    mappedPath = path.posix.basename(normalizePathLike(relativePath))
  }

  return normalizeSafeRelativePath(mappedPath, {
    errorMessage: '映射后的目标相对路径不安全'
  })
}

export function joinTargetRelativePath(targetRelativePath = '.', mappedRelativePath = '') {
  const base = normalizePathLike(targetRelativePath)
  const mapped = normalizeSafeRelativePath(mappedRelativePath, {
    errorMessage: '映射后的目标相对路径不安全'
  })
  if (!base || base === '.') {
    return mapped
  }
  return normalizeSafeRelativePath(`${base}/${mapped}`, {
    errorMessage: '完整目标相对路径不安全'
  })
}
