import fs from 'fs-extra'
import path from 'path'
import {
  normalizeExtensionList,
  normalizeRelativeRulePath,
  normalizeTextList,
  resolveFirstDefinedValue,
  toSafeText
} from './contracts.js'
import { collectDirectorySnapshot, ensureDirectory } from './fsSnapshot.js'
import { matchGlobPattern } from './globMatcher.js'
import { INSTALL_ENGINE_ERROR_CODES, InstallEngineError } from './installEngineError.js'
import { isPathInside, isRealPathInside, createPlanningPathChecker, resolveSafeRelativeChildPath } from './pathSafety.js'
import { resolveAdaptiveConcurrency, runWithConcurrencyLimit } from './concurrency.js'
import { normalizeRuleSource } from './sourceResolver.js'
import { normalizeInstallFolderName, resolveSingleRoot } from './targetResolver.js'
import { materializeSourceUnits } from './sourceUnitMaterializer.js'

const INTERNAL_SOURCE_ROOT_PREFIXES = [
  '__vertex_install_plan_v3__/',
  '__vertex_install_rule__/',
  '__vertex_nexus_rule__/'
]

export function collectSourcePatterns(sourceRule = {}) {
  return normalizeTextList(
    resolveFirstDefinedValue(
      sourceRule.pattern,
      sourceRule.patterns,
      sourceRule.include,
      sourceRule.includes,
      sourceRule.file_pattern,
      sourceRule.filePattern,
      sourceRule.file_patterns,
      sourceRule.filePatterns
    ),
    { pathLike: true }
  )
}

function normalizeOptionalBoolean(value) {
  if (value === true || value === false) return value
  const text = toSafeText(value).toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false
  return null
}

function collectSourceMarkerName(sourceRule = {}) {
  return toSafeText(
    resolveFirstDefinedValue(
      sourceRule.marker,
      sourceRule.marker_name,
      sourceRule.markerName,
      sourceRule.entry_name,
      sourceRule.entryName
    )
  )
}

function resolvePreserveCandidateDirectoryOption(sourceRule = {}) {
  return normalizeOptionalBoolean(
    sourceRule.preserve_candidate_dir ??
      sourceRule.preserveCandidateDir ??
      sourceRule.keep_candidate_dir ??
      sourceRule.keepCandidateDir
  )
}

function shouldPreserveCandidateDirectory(sourceRule = {}) {
  return resolvePreserveCandidateDirectoryOption(sourceRule) === true
}

function isInternalSourceEntry(relativePath = '') {
  const normalizedPath = normalizeRelativeRulePath(relativePath).toLowerCase()
  return INTERNAL_SOURCE_ROOT_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
}

function getRelativePathDepth(relativePath = '') {
  return normalizeRelativeRulePath(relativePath).split('/').filter(Boolean).length
}

function resolvePreservedRootName(sourceRoot = '', stagingPath = '', context = {}) {
  const safeSourceRoot = path.resolve(sourceRoot)
  const safeStagingPath = path.resolve(stagingPath)
  const fallbackName =
    safeSourceRoot === safeStagingPath
      ? toSafeText(context.packageFolderName)
      : path.basename(safeSourceRoot)
  return normalizeInstallFolderName(fallbackName || path.basename(safeSourceRoot))
}

function resolveArchiveFileName(sourceRule = {}, context = {}) {
  const data = context?.data && typeof context.data === 'object' ? context.data : {}
  const configuredName = toSafeText(
    resolveFirstDefinedValue(
      sourceRule.file_name,
      sourceRule.fileName,
      sourceRule.name,
      data.fileName,
      data.filename,
      data.archiveName,
      data.name
    )
  )
  if (configuredName) {
    return normalizeInstallFolderName(configuredName)
  }
  return normalizeInstallFolderName(path.basename(toSafeText(context.archivePath)) || 'package')
}

async function materializeArchiveFileSource(stagingPath = '', sourceRule = {}, context = {}) {
  const archivePathText = toSafeText(context.archivePath)
  const archivePath = archivePathText ? path.resolve(archivePathText) : ''
  if (!archivePath || !(await fs.pathExists(archivePath))) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装规则要求使用原始下载文件，但下载文件不存在'
    )
  }
  const stat = await fs.stat(archivePath)
  if (!stat.isFile()) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装规则要求使用原始下载文件，但当前路径不是文件'
    )
  }

  const materializedRoot = path.resolve(stagingPath, '__vertex_install_plan_v3__', 'archive_file')
  const fileName = resolveArchiveFileName(sourceRule, context)
  const targetFilePath = path.resolve(materializedRoot, fileName)
  await fs.ensureDir(materializedRoot)
  await fs.copy(archivePath, targetFilePath, {
    overwrite: true,
    errorOnExist: false,
    dereference: false
  })
  return materializedRoot
}

async function resolveFolderContainingMarker(stagingPath = '', sourceRule = {}, context = {}) {
  const markerName = collectSourceMarkerName(sourceRule)
  const markerKey = markerName.toLowerCase()
  if (!markerKey) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装规则缺少有效的 source.marker，无法确定安装源目录'
    )
  }

  const snapshot = await collectDirectorySnapshot(stagingPath, context.snapshotCache || new Map())
  const evidencePaths = sourceRule.marker_pattern
    ? (snapshot.allFiles || []).filter((entry) => matchGlobPattern(sourceRule.marker_pattern, entry.relativePath)).map((entry) => entry.relativePath)
    : (context.matchEvidence || []).filter((check) => check.matched).flatMap((check) => check.matchedPaths || [])
  const relevantEvidence = evidencePaths.filter((value) => value.toLowerCase().split('/').includes(markerKey))
  const markerEntries = [...(snapshot.allDirs || []), ...(snapshot.allFiles || [])]
    .filter((entry) => !isInternalSourceEntry(entry.relativePath))
    .filter((entry) => toSafeText(entry.name).toLowerCase() === markerKey)
    .filter((entry) => {
      if (!sourceRule.marker_pattern && !relevantEvidence.length) return true
      const key = normalizeRelativeRulePath(entry.relativePath).toLowerCase()
      return relevantEvidence.some((value) => value.toLowerCase() === key || value.toLowerCase().startsWith(`${key}/`))
    })
    .map((entry) => {
      const markerRelativePath = normalizeRelativeRulePath(entry.relativePath)
      const parentPath = path.posix.dirname(markerRelativePath)
      const candidateRelativePath = parentPath === '.' ? '' : normalizeRelativeRulePath(parentPath)
      const sourceRoot = candidateRelativePath
        ? path.resolve(stagingPath, ...candidateRelativePath.split('/').filter(Boolean))
        : path.resolve(stagingPath)
      return {
        sourceRoot,
        candidateRelativePath,
        markerRelativePath,
        depth: getRelativePathDepth(candidateRelativePath),
        length: candidateRelativePath.length
      }
    })
    .sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth
      if (left.length !== right.length) return left.length - right.length
      return left.candidateRelativePath.localeCompare(right.candidateRelativePath)
    })

  const uniqueEntries = [...new Map(markerEntries.map((entry) => [entry.sourceRoot.toLowerCase(), entry])).values()]
  const selected = uniqueEntries[0]
  if (!selected) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装规则缺少有效的 source.marker，无法确定安装源目录'
    )
  }

  if (uniqueEntries.length > 1 && sourceRule.selection !== 'all') {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_AMBIGUOUS, '找到多个安装单元，规则必须声明 source.selection 为 all 或进一步限定 marker_pattern', { candidates: uniqueEntries.map((entry) => entry.candidateRelativePath) })
  }
  if (uniqueEntries.length > 128 || uniqueEntries.some((a, i) => uniqueEntries.some((b, j) => i !== j && isPathInside(a.sourceRoot, b.sourceRoot)))) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_AMBIGUOUS, '安装单元数量过多或目录互相嵌套，无法确定独立归属')
  }
  return uniqueEntries
}

export async function resolveRuleSourceSelection(rule = {}, context = {}) {
  const stagingPath = path.resolve(toSafeText(context.stagingPath))
  const sourceRule = normalizeRuleSource(rule.source)
  const sourceType = toSafeText(sourceRule.type || 'package_root').toLowerCase()
  let sourceRoot = stagingPath
  let filterPatterns = []
  let preserveSourceRootName = ''
  let sourceUnits = []

  if (sourceType === 'fixed_subdir') {
    const relativePath = toSafeText(
      resolveFirstDefinedValue(sourceRule.path, sourceRule.source_path, sourceRule.sourcePath)
    )
    const resolved = resolveSafeRelativeChildPath(stagingPath, relativePath, {
      errorMessage: '安装源路径不安全',
      boundaryErrorMessage: '安装源路径越界，已阻止安装'
    })
    sourceRoot = resolved.fullPath
  } else if (sourceType === 'archive_file') {
    sourceRoot = await materializeArchiveFileSource(stagingPath, sourceRule, context)
  } else if (sourceType === 'file_by_extension') {
    const extensions = normalizeExtensionList(
      resolveFirstDefinedValue(sourceRule.extension, sourceRule.extensions, sourceRule.ext)
    )
    filterPatterns = extensions.map((extension) => `**/*${extension}`)
  } else if (sourceType === 'file_by_pattern') {
    filterPatterns = collectSourcePatterns(sourceRule)
  } else if (sourceType === 'folder_containing') {
    const markerName = collectSourceMarkerName(sourceRule)
    if (markerName) {
      const markerSelections = await resolveFolderContainingMarker(stagingPath, sourceRule, context)
      const markerSelection = markerSelections[0]
      sourceRoot = markerSelection.sourceRoot
      if (resolvePreserveCandidateDirectoryOption(sourceRule) !== false) {
        preserveSourceRootName = resolvePreservedRootName(sourceRoot, stagingPath, context)
      }
      if (markerSelections.length > 1 || sourceRule.ensure_files?.length) {
        const materialized = await materializeSourceUnits(markerSelections.map((unit) => ({ ...unit, preserveSourceRootName: resolvePreserveCandidateDirectoryOption(sourceRule) === false ? '' : resolvePreservedRootName(unit.sourceRoot, stagingPath, context) })), sourceRule, stagingPath, context)
        sourceRoot = materialized.sourceRoot
        sourceUnits = materialized.units
        preserveSourceRootName = ''
      } else {
        sourceUnits = [{ id: preserveSourceRootName || path.basename(sourceRoot), sourceRelativePath: markerSelection.candidateRelativePath, targetPrefix: preserveSourceRootName, markerPath: markerSelection.markerRelativePath }]
      }
    } else {
      const relativePath = toSafeText(sourceRule.path || sourceRule.folder || sourceRule.dir)
      if (relativePath) {
        const resolved = resolveSafeRelativeChildPath(stagingPath, relativePath, {
          errorMessage: '安装源路径不安全',
          boundaryErrorMessage: '安装源路径越界，已阻止安装'
        })
        sourceRoot = resolved.fullPath
      }
    }
  }

  if (!sourceUnits.length && !preserveSourceRootName && shouldPreserveCandidateDirectory(sourceRule)) {
    preserveSourceRootName = resolvePreservedRootName(sourceRoot, stagingPath, context)
  }

  const wrapped = sourceUnits.length ? { sourceRoot, wrappedRootName: '', unwrapped: false } : await resolveSingleRoot(sourceRoot, sourceRule)
  sourceRoot = wrapped.sourceRoot
  if (!isPathInside(stagingPath, sourceRoot) || !isRealPathInside(stagingPath, sourceRoot)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
      '识别到不安全的安装源路径，已阻止安装'
    )
  }
  if (!(await ensureDirectory(sourceRoot))) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
      '安装源目录不存在，无法继续安装'
    )
  }

  const snapshot = await collectDirectorySnapshot(sourceRoot, context.snapshotCache || new Map(), {
    boundaryRoot: sourceRoot
  })
  return {
    sourceRule,
    sourceType,
    sourceRoot,
    lifecycleStagingRoot: sourceRoot,
    wrappedRootName: wrapped.wrappedRootName,
    unwrapped: wrapped.unwrapped,
    preserveSourceRootName,
    filterPatterns,
    snapshot,
    units: sourceUnits
  }
}

export function isSourceFileMatched(relativePath = '', patterns = []) {
  return patterns.some((pattern) => {
    const normalizedPattern = normalizeRelativeRulePath(pattern)
    const normalizedPath = normalizeRelativeRulePath(relativePath)
    if (normalizedPattern === normalizedPath) return true
    return matchGlobPattern(normalizedPattern, normalizedPath)
  })
}

export async function buildCopyOperations(sourceSelection = {}, targetRoot = '') {
  const patterns = Array.isArray(sourceSelection.filterPatterns)
    ? sourceSelection.filterPatterns.filter(Boolean)
    : []
  const allFiles = Array.isArray(sourceSelection.snapshot?.allFiles)
    ? sourceSelection.snapshot.allFiles
    : []
  const publicFiles = allFiles.filter((entry) => !isInternalSourceEntry(entry.relativePath))
  const selectedFiles = patterns.length
    ? publicFiles.filter((entry) => isSourceFileMatched(entry.relativePath, patterns))
    : publicFiles

  const safeTargetRoot = path.resolve(toSafeText(targetRoot))
  const sourceRootText = toSafeText(sourceSelection.sourceRoot)
  const safeSourceRoot = sourceRootText ? path.resolve(sourceRootText) : ''
  const checkPath = createPlanningPathChecker()
  const operations = await runWithConcurrencyLimit(selectedFiles, resolveAdaptiveConcurrency(selectedFiles.length), async (entry) => {
      const sourceRelativePath = normalizeRelativeRulePath(entry.relativePath)
      const relativePath = sourceSelection.preserveSourceRootName
        ? normalizeRelativeRulePath(`${sourceSelection.preserveSourceRootName}/${sourceRelativePath}`)
        : sourceRelativePath
      const sourcePath = toSafeText(entry.fullPath)
      const targetPath = path.resolve(safeTargetRoot, ...relativePath.split('/').filter(Boolean))

      // B2：拒绝符号链接源，避免把指向边界外的链接带入安装。
      const sourceStat = sourcePath ? await fs.lstat(sourcePath) : null
      if (sourceStat && sourceStat.isSymbolicLink()) {
        throw new InstallEngineError(
          INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
          `安装源为符号链接，已阻止安装：${sourcePath}`
        )
      }
      if (safeSourceRoot && !(await checkPath(safeSourceRoot, sourcePath))) {
        throw new InstallEngineError(
          INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
          `安装源真实路径越界，已阻止安装：${sourcePath}`
        )
      }
      // B2：解析真实路径后复检目标仍位于目标根内，防 junction 逃逸。
      if (!(await checkPath(safeTargetRoot, targetPath))) {
        throw new InstallEngineError(
          INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
          `安装目标越界，已阻止安装：${targetPath}`
        )
      }

      return {
        type: 'copy',
        sourcePath,
        sourceRelativePath,
        targetPath,
        relativePath,
        sourceBoundaryRoot: safeSourceRoot
      }
    })
  return operations.filter((item) => item.sourcePath && item.targetPath)
}
