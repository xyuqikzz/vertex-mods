import { isPlainObject, toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { isValidNumberLike, resolveFirstDefinedValue } from './primitives.js'
import { validateUnknownFields } from './fieldGuards.js'

// 生命周期安全动作（须与 lifecycleActions.js SAFE_LIFECYCLE_ACTIONS 保持一致）
const LIFECYCLE_SAFE_ACTIONS = [
  'copy_path',
  'move_path',
  'rename_path',
  'remove_path',
  'remove_empty_dir',
  'ensure_dir_exists',
  'write_text_file',
  'patch_ini',
  'patch_json',
  'backup_path'
]
// 生命周期命令动作（须与 lifecyclePolicy.js LIFECYCLE_COMMAND_ACTIONS 保持一致）
const LIFECYCLE_COMMAND_ACTIONS = ['run_command', 'run_script', 'execute']
const LIFECYCLE_ACTIONS = new Set([...LIFECYCLE_SAFE_ACTIONS, ...LIFECYCLE_COMMAND_ACTIONS])

const LIFECYCLE_STEP_FIELDS = new Set([
  'action',
  'path',
  'base',
  'base_type',
  'baseType',
  'scope',
  'args',
  'stdin',
  'stdin_interval_ms',
  'stdinIntervalMs',
  'requires_console',
  'requiresConsole',
  'repeat',
  'timeout_ms',
  'timeoutMs',
  'from',
  'to',
  'source',
  'target',
  'dest',
  'destination',
  'content',
  'text',
  'encoding',
  'section',
  'key',
  'value',
  'json_path',
  'jsonPath',
  'create_if_missing',
  'createIfMissing',
  'overwrite',
  'description',
  'name',
  'id'
])

// E4 / B1：深入校验生命周期步骤结构（动作枚举、参数类型、范围）。
export function validateLifecycleStep(step = {}, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (!isPlainObject(step)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_lifecycle_step_type',
      pathPrefix,
      '生命周期步骤必须是对象',
      { ruleId }
    )
    return
  }
  validateUnknownFields(step, LIFECYCLE_STEP_FIELDS, pathPrefix, diagnostics, ruleId)

  const action = toSafeText(step.action).toLowerCase()
  if (!action) {
    pushDiagnostic(diagnostics, 'error', 'missing_lifecycle_action', `${pathPrefix}.action`, '生命周期步骤缺少 action', { ruleId })
  } else if (!LIFECYCLE_ACTIONS.has(action)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'unsupported_lifecycle_action',
      `${pathPrefix}.action`,
      `不支持的生命周期动作：${action}`,
      { ruleId }
    )
  }

  if (step.path !== undefined && typeof step.path !== 'string') {
    pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_path_type', `${pathPrefix}.path`, '生命周期 path 必须是字符串', { ruleId })
  }
  if (step.args !== undefined && !Array.isArray(step.args) && typeof step.args !== 'string') {
    pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_args_type', `${pathPrefix}.args`, '生命周期 args 必须是数组或字符串', { ruleId })
  }
  if (step.stdin !== undefined && !Array.isArray(step.stdin) && typeof step.stdin !== 'string') {
    pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_stdin_type', `${pathPrefix}.stdin`, '生命周期 stdin 必须是数组或字符串', { ruleId })
  }

  const repeat = resolveFirstDefinedValue(step.repeat)
  if (repeat !== undefined) {
    if (!isValidNumberLike(repeat)) {
      pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_repeat_type', `${pathPrefix}.repeat`, '生命周期 repeat 必须是数字', { ruleId })
    } else if (Number(repeat) < 1 || Number(repeat) > 100) {
      pushDiagnostic(diagnostics, 'warning', 'lifecycle_repeat_out_of_range', `${pathPrefix}.repeat`, '生命周期 repeat 建议取值在 1~100 之间', { ruleId })
    }
  }

  const timeout = resolveFirstDefinedValue(step.timeout_ms, step.timeoutMs)
  if (timeout !== undefined && !isValidNumberLike(timeout)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_timeout_type', `${pathPrefix}.timeout_ms`, '生命周期 timeout_ms 必须是数字', { ruleId })
  }
}

export function validateLifecycleStepList(steps, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (steps === undefined || steps === null) return
  if (!Array.isArray(steps)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_lifecycle_type', pathPrefix, `${pathPrefix} 必须是数组`, { ruleId })
    return
  }
  steps.forEach((step, index) =>
    validateLifecycleStep(step, `${pathPrefix}[${index}]`, diagnostics, ruleId)
  )
}
