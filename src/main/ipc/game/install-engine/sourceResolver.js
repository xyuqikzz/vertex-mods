import {
  isPlainObject,
  normalizeExtensionList,
  normalizeRelativeRulePath,
  normalizeTextList,
  resolveFirstDefinedValue,
  toArrayValue,
  toSafeText
} from './contracts.js'

function copyCommonSourceOptions(source = {}, target = {}) {
  const optionFieldNames = [
    'preserve_candidate_dir',
    'preserveCandidateDir',
    'keep_candidate_dir',
    'keepCandidateDir',
    'unwrap_single_root',
    'unwrapSingleRoot',
    'strip_single_root',
    'stripSingleRoot',
    'unwrap_package_root',
    'unwrapPackageRoot',
    'unwrap_mode',
    'unwrapMode',
    'unwrap_single_root_mode',
    'filename_prefix_subdirs',
    'filenamePrefixSubdirs',
    'filename_prefix_dirs',
    'filenamePrefixDirs',
    'filename_prefix_delimiters',
    'filenamePrefixDelimiters',
    'filename_prefix_separator',
    'filenamePrefixSeparator'
  ]

  for (const fieldName of optionFieldNames) {
    if (source[fieldName] !== undefined) {
      target[fieldName] = source[fieldName]
    }
  }

  return target
}

export function normalizeRuleSource(source = {}) {
  const safeSource = isPlainObject(source) ? source : {}
  const rawType = toSafeText(
    resolveFirstDefinedValue(safeSource.type, safeSource.source_type, safeSource.sourceType)
  ).toLowerCase()
  const rawSelect = toSafeText(
    resolveFirstDefinedValue(safeSource.select, safeSource.kind, safeSource.mode)
  ).toLowerCase()
  const sourceMode = rawSelect || rawType || 'package_root'

  if (
    [
      'package_root',
      'root',
      'archive_root',
      'candidate_root',
      'archive_file',
      'download_file',
      'source_file',
      'package_file',
      'folder_containing',
      'fixed_subdir',
      'file_by_extension',
      'file_by_pattern'
    ].includes(sourceMode)
  ) {
    const legacySource = {
      ...safeSource,
      type:
        sourceMode === 'root' || sourceMode === 'archive_root' || sourceMode === 'candidate_root'
          ? 'package_root'
          : sourceMode === 'download_file' ||
              sourceMode === 'source_file' ||
              sourceMode === 'package_file'
            ? 'archive_file'
          : sourceMode
    }
    if (sourceMode === 'fixed_subdir') {
      legacySource.path = normalizeRelativeRulePath(
        resolveFirstDefinedValue(safeSource.path, safeSource.source_path, safeSource.sourcePath)
      )
    }
    return legacySource
  }

  if (['files', 'file', 'patterns', 'pattern', 'glob'].includes(sourceMode)) {
    const includePatterns = normalizeTextList(
      [
        ...toArrayValue(
          resolveFirstDefinedValue(
            safeSource.include,
            safeSource.includes,
            safeSource.pattern,
            safeSource.patterns,
            safeSource.file_pattern,
            safeSource.filePattern,
            safeSource.file_patterns,
            safeSource.filePatterns
          )
        )
      ],
      {
        pathLike: true
      }
    )

    return copyCommonSourceOptions(safeSource, {
      type: 'file_by_pattern',
      patterns: includePatterns
    })
  }

  if (['extension', 'extensions', 'ext'].includes(sourceMode)) {
    const extensionList = normalizeExtensionList(
      resolveFirstDefinedValue(
        safeSource.extension,
        safeSource.extensions,
        safeSource.ext,
        safeSource.exts
      )
    )

    if (extensionList.length > 1) {
      return copyCommonSourceOptions(safeSource, {
        type: 'file_by_pattern',
        patterns: extensionList.map((extension) => `**/*${extension}`)
      })
    }

    return copyCommonSourceOptions(safeSource, {
      type: 'file_by_extension',
      extension: extensionList[0] || ''
    })
  }

  if (['dir', 'dirs', 'directory', 'folder', 'subdir'].includes(sourceMode)) {
    return copyCommonSourceOptions(safeSource, {
      type: 'fixed_subdir',
      path: normalizeRelativeRulePath(
        resolveFirstDefinedValue(
          safeSource.path,
          safeSource.dir,
          safeSource.directory,
          safeSource.folder,
          safeSource.source_path,
          safeSource.sourcePath
        )
      )
    })
  }

  return copyCommonSourceOptions(safeSource, {
    type: 'package_root'
  })
}
