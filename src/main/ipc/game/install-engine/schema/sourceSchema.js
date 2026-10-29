import { isPlainObject, toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { isValidTextList, hasTextValue, resolveFirstDefinedValue } from './primitives.js'

const SOURCE_TYPES = new Set([
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
  'file_by_pattern',
  'files',
  'file',
  'patterns',
  'pattern',
  'glob',
  'extension',
  'extensions',
  'ext',
  'dir',
  'dirs',
  'directory',
  'folder',
  'subdir'
])

export function resolveSourceMode(source = {}) {
  const rawType = toSafeText(
    resolveFirstDefinedValue(source.type, source.source_type, source.sourceType)
  ).toLowerCase()
  const rawSelect = toSafeText(
    resolveFirstDefinedValue(source.select, source.kind, source.mode)
  ).toLowerCase()
  return rawSelect || rawType || 'package_root'
}

export function normalizeSourceMode(source = {}) {
  const sourceMode = resolveSourceMode(source)
  if (['package_root', 'root', 'archive_root', 'candidate_root'].includes(sourceMode)) {
    return { sourceMode, sourceType: 'package_root' }
  }
  if (['archive_file', 'download_file', 'source_file', 'package_file'].includes(sourceMode)) {
    return { sourceMode, sourceType: 'archive_file' }
  }
  if (
    ['folder_containing', 'fixed_subdir', 'file_by_extension', 'file_by_pattern'].includes(
      sourceMode
    )
  ) {
    return { sourceMode, sourceType: sourceMode }
  }
  if (['files', 'file', 'patterns', 'pattern', 'glob'].includes(sourceMode)) {
    return { sourceMode, sourceType: 'file_by_pattern' }
  }
  if (['extension', 'extensions', 'ext'].includes(sourceMode)) {
    return { sourceMode, sourceType: 'file_by_extension' }
  }
  if (['dir', 'dirs', 'directory', 'folder', 'subdir'].includes(sourceMode)) {
    return { sourceMode, sourceType: 'fixed_subdir' }
  }
  return { sourceMode, sourceType: '' }
}

function resolveFieldValue(payload = {}, fieldNames = []) {
  for (const fieldName of fieldNames) {
    if (payload[fieldName] !== undefined && payload[fieldName] !== null) {
      return payload[fieldName]
    }
  }
  return undefined
}

function validateRequiredTextField(target = {}, fieldNames = [], options = {}) {
  const { diagnostics, ruleId, pathPrefix, pathName, missingCode, invalidCode, message } = options
  const value = resolveFieldValue(target, fieldNames)
  if (value === undefined || value === null) {
    pushDiagnostic(diagnostics, 'error', missingCode, `${pathPrefix}.${pathName}`, message, {
      ruleId
    })
    return
  }
  if (!isValidTextList(value)) {
    pushDiagnostic(
      diagnostics,
      'error',
      invalidCode,
      `${pathPrefix}.${pathName}`,
      `${pathName} 必须是字符串、数字或由字符串/数字组成的数组`,
      { ruleId }
    )
    return
  }
  if (!hasTextValue(value)) {
    pushDiagnostic(diagnostics, 'error', missingCode, `${pathPrefix}.${pathName}`, message, {
      ruleId
    })
  }
}

export function validateSource(source = {}, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (source === undefined || source === null) return
  if (!isPlainObject(source)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_source_type', pathPrefix, 'source 必须是对象', {
      ruleId
    })
    return
  }
  if (source.paths !== undefined && (!Array.isArray(source.paths) || !source.paths.length || source.paths.length > 50000 || source.paths.some((value) => typeof value !== 'string' || !value))) {
    pushDiagnostic(diagnostics, 'error', 'invalid_source_paths', `${pathPrefix}.paths`, 'paths 必须为非空精确路径数组，最多 50000 项', { ruleId })
  }

  const { sourceMode, sourceType } = normalizeSourceMode(source)
  if (sourceMode && !SOURCE_TYPES.has(sourceMode)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'unsupported_source_type',
      `${pathPrefix}.type`,
      `source.type 不支持 ${sourceMode}`,
      { ruleId, suggestion: 'package_root' }
    )
    return
  }

  if (sourceType === 'fixed_subdir') {
    const pathFields = ['dir', 'dirs', 'directory', 'folder', 'subdir'].includes(sourceMode)
      ? ['path', 'dir', 'directory', 'folder', 'source_path', 'sourcePath']
      : ['path', 'source_path', 'sourcePath']
    validateRequiredTextField(source, pathFields, {
      diagnostics,
      ruleId,
      pathPrefix,
      pathName: 'path',
      missingCode: 'missing_source_path',
      invalidCode: 'invalid_source_path_type',
      message: 'fixed_subdir 类型必须提供 source.path'
    })
  }
  if (sourceType === 'file_by_extension') {
    validateRequiredTextField(source, ['extension', 'extensions', 'ext', 'exts'], {
      diagnostics,
      ruleId,
      pathPrefix,
      pathName: 'extension',
      missingCode: 'missing_source_extension',
      invalidCode: 'invalid_source_extension_type',
      message: 'file_by_extension 类型必须提供 source.extension'
    })
  }
  if (sourceType === 'file_by_pattern') {
    validateRequiredTextField(
      source,
      [
        'include',
        'includes',
        'pattern',
        'patterns',
        'file_pattern',
        'filePattern',
        'file_patterns',
        'filePatterns'
      ],
      {
        diagnostics,
        ruleId,
        pathPrefix,
        pathName: 'patterns',
        missingCode: 'missing_source_pattern',
        invalidCode: 'invalid_source_pattern_type',
        message: 'file_by_pattern 类型必须提供 source.patterns 或 source.include'
      }
    )
  }
  if (sourceType === 'folder_containing') {
    if ((source.marker_pattern !== undefined || source.ensure_files !== undefined) &&
        !hasTextValue(resolveFieldValue(source, ['marker', 'marker_name', 'markerName', 'entry_name', 'entryName']))) {
      pushDiagnostic(diagnostics, 'error', 'missing_source_marker', `${pathPrefix}.marker`, 'marker_pattern 和 ensure_files 必须绑定明确的 marker', { ruleId })
    }
    const selection = source.selection ?? 'unique'
    if (!['unique', 'all'].includes(selection)) {
      pushDiagnostic(diagnostics, 'error', 'invalid_source_selection', `${pathPrefix}.selection`, 'selection 必须为 unique 或 all', { ruleId })
    }
    if (source.marker_pattern !== undefined && (typeof source.marker_pattern !== 'string' || !source.marker_pattern.trim())) {
      pushDiagnostic(diagnostics, 'error', 'invalid_marker_pattern', `${pathPrefix}.marker_pattern`, 'marker_pattern 必须为非空 glob 字符串', { ruleId })
    }
    validateRequiredTextField(
      source,
      ['marker', 'marker_name', 'markerName', 'entry_name', 'entryName', 'path', 'folder', 'dir'],
      {
        diagnostics,
        ruleId,
        pathPrefix,
        pathName: 'marker',
        missingCode: 'missing_source_marker',
        invalidCode: 'invalid_source_marker_type',
        message: 'folder_containing 类型必须提供 source.marker 或 source.path'
      }
    )
  }

  if (source.ensure_files !== undefined) {
    const files = source.ensure_files
    if (sourceType !== 'folder_containing' || !Array.isArray(files) || files.length > 32 ||
        files.some((file) => !isPlainObject(file) || typeof file.path !== 'string' || !file.path.trim() ||
          (file.text !== undefined && typeof file.text !== 'string') || new TextEncoder().encode(file.text || '').length > 65536)) {
      pushDiagnostic(diagnostics, 'error', 'invalid_ensure_files', `${pathPrefix}.ensure_files`, 'ensure_files 仅用于 folder_containing，最多 32 个含 path 和 text 的文本文件，每个不超过 64 KiB', { ruleId })
    }
  }

  // H7：package_root 类型未声明 unwrap_single_root 时产生 warning。
  // 旧引擎 installRuleTool.resolveInstallRulesPlan 通过 listPackageRootCandidates 自动探测候选根，
  // 新引擎要求显式声明 unwrap_single_root: true 才剥离单层外壳，行为不一致且迁移易漏写。
  // 警告而非报错，因为确实存在压缩包顶层无外壳目录的情况（此时 unwrap_single_root 会破坏结构）。
  if (sourceType === 'package_root') {
    const hasUnwrapField = [
      'unwrap_single_root',
      'unwrapSingleRoot',
      'strip_single_root',
      'stripSingleRoot',
      'unwrap_package_root',
      'unwrapPackageRoot'
    ].some((field) => source[field] !== undefined && source[field] !== null)
    if (!hasUnwrapField) {
      pushDiagnostic(
        diagnostics,
        'warning',
        'unwrap_single_root_recommended',
        `${pathPrefix}.type`,
        'source.type=package_root 但未声明 unwrap_single_root。若压缩包顶层是单层外壳目录（如 SB/Content/Paks/），未声明会导致外壳被复制到目标路径。建议显式声明 unwrap_single_root: true 或确认要保留外壳目录',
        { ruleId, suggestion: 'unwrap_single_root: true' }
      )
    }
  }
}
