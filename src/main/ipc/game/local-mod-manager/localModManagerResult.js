export const LOCAL_MOD_MANAGER_ERROR_CODE = Object.freeze({
  PATH_MISSING: 'local_mod_path_missing',
  PATH_UNSAFE: 'local_mod_path_unsafe',
  DUPLICATE_PATH: 'local_mod_duplicate_path',
  DUPLICATE_ASSET: 'local_mod_duplicate_asset',
  ARCHIVE_UNSAFE: 'local_mod_archive_unsafe',
  GAME_MISSING: 'local_mod_game_missing',
  INSTALL_RULE_MISSING: 'local_mod_install_rule_missing',
  MANUAL_TARGET_REQUIRED: 'local_mod_manual_target_required',
  MANUAL_TARGET_UNSAFE: 'local_mod_manual_target_unsafe',
  PARTIAL_FAILED: 'local_mod_commit_partial_failed',
  TASK_CREATE_FAILED: 'local_mod_task_create_failed',
  PERMISSION_DENIED: 'local_mod_permission_denied'
})

export function createSuccess(message = '操作成功', data = {}) {
  return {
    success: true,
    message,
    data
  }
}

export function createFailure(code = '', message = '操作失败', data = {}) {
  return {
    success: false,
    code,
    message,
    data
  }
}
