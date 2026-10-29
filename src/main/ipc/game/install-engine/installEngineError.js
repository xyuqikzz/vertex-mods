export const INSTALL_ENGINE_ERROR_CODES = Object.freeze({
  RULE_INVALID: 'install_engine.rule_invalid',
  RULE_SOURCE_NOT_FOUND: 'install_engine.rule_source_not_found',
  RULE_SOURCE_AMBIGUOUS: 'install_engine.rule_source_ambiguous',
  RULE_TARGET_CONFLICT: 'install_engine.rule_target_conflict',
  RULE_CONDITION_MISMATCH: 'install_engine.rule_condition_mismatch',
  PATH_UNSAFE: 'install_engine.path_unsafe',
  PATH_OUT_OF_BOUNDS: 'install_engine.path_out_of_bounds',
  PATH_MISSING: 'install_engine.path_missing',
  SNAPSHOT_DEPTH_EXCEEDED: 'install_engine.snapshot_depth_exceeded',
  LIFECYCLE_ACTION_INVALID: 'install_engine.lifecycle_action_invalid',
  LIFECYCLE_PATCH_INVALID: 'install_engine.lifecycle_patch_invalid',
  FILE_OPERATION_FAILED: 'install_engine.file_operation_failed',
  RULE_NOT_MATCHED: 'install_engine.rule_not_matched',
  DEPENDENCY_INVALID: 'install_engine.dependency_invalid'
})

export function sanitizeErrorMessage(value = '', fallback = '安装引擎执行失败') {
  const text = String(value || fallback)
  const sanitized = text
    .replace(/[A-Za-z]:[\\/][^\s"'`<>|]+/g, '[本机路径]')
    .replace(/\\\\[^\\/\s]+[\\/][^\s"'`<>|]+/g, '[本机路径]')
    .replace(/(^|\s)\/(?:[^/\s"'`<>|]+\/)+[^/\s"'`<>|]+/g, '$1[本机路径]')
  return sanitized || fallback
}

export class InstallEngineError extends Error {
  constructor(code = INSTALL_ENGINE_ERROR_CODES.FILE_OPERATION_FAILED, message = '', detail = {}) {
    super(sanitizeErrorMessage(message))
    this.name = 'InstallEngineError'
    this.code = code
    this.detail = detail && typeof detail === 'object' ? detail : {}
  }
}

export function normalizeInstallEngineError(
  error,
  code = INSTALL_ENGINE_ERROR_CODES.FILE_OPERATION_FAILED,
  fallback = '安装引擎执行失败'
) {
  if (error instanceof InstallEngineError) {
    return error
  }
  return new InstallEngineError(code, sanitizeErrorMessage(error?.message || error, fallback), {
    originalName: String(error?.name || '')
  })
}

const RECOVERABLE_PLANNING_CODES = new Set([
  INSTALL_ENGINE_ERROR_CODES.RULE_INVALID,
  INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_NOT_FOUND,
  INSTALL_ENGINE_ERROR_CODES.RULE_TARGET_CONFLICT,
  INSTALL_ENGINE_ERROR_CODES.RULE_CONDITION_MISMATCH,
  INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
  INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
  INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
  INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_ACTION_INVALID,
  INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_PATCH_INVALID,
  INSTALL_ENGINE_ERROR_CODES.RULE_NOT_MATCHED,
  INSTALL_ENGINE_ERROR_CODES.DEPENDENCY_INVALID,
  'rule_invalid',
  'rule_source_not_found',
  'rule_target_conflict',
  'route_target_conflict',
  'rule_condition_mismatch',
  'path_unsafe',
  'path_out_of_bounds',
  'path_missing'
])

export function isRecoverablePlanningError(error) {
  if (!error || typeof error !== 'object') return false
  return RECOVERABLE_PLANNING_CODES.has(String(error.code || '').trim())
}
