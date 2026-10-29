import { normalizeLaunchArgumentList, normalizePathLike } from './runnerUtils.js'
import { LIFECYCLE_PASSTHROUGH_FIELDS } from './contracts.js'

function resolveFirstDefinedValue(...valueList) {
  for (const value of valueList) {
    if (value !== undefined && value !== null) {
      return value
    }
  }

  return undefined
}

function normalizeOptionalBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) {
    return null
  }

  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(text)) {
    return false
  }

  return null
}

export function normalizeInstallPostInstallBaseType(value = '', fallback = 'target') {
  const text = String(value || '')
    .trim()
    .toLowerCase()

  if (!text) {
    return fallback
  }

  if (['download', 'download_root', 'downloadroot', 'download_relative'].includes(text)) {
    return 'download'
  }

  if (
    [
      'local_appdata',
      'localappdata',
      'local_app_data',
      'local_appdata_root',
      'localappdata_root',
      'user_local_appdata',
      'userlocalappdata',
      '%localappdata%'
    ].includes(text)
  ) {
    return 'local_appdata'
  }

  if (
    [
      'roaming_appdata',
      'roamingappdata',
      'roaming_app_data',
      'roaming_appdata_root',
      'roamingappdata_root',
      'appdata',
      'user_appdata',
      'userappdata',
      '%appdata%'
    ].includes(text)
  ) {
    return 'roaming_appdata'
  }

  if (['game', 'game_root', 'gameroot', 'game_relative'].includes(text)) {
    return 'game'
  }

  if (
    ['staging', 'staging_root', 'stagingroot', 'stage', 'source_root', 'sourceroot'].includes(text)
  ) {
    return 'staging'
  }

  if (['target', 'target_root', 'targetroot', 'resolved_target', 'resolvedtarget'].includes(text)) {
    return 'target'
  }

  return fallback
}

export function normalizeInstallPostInstallSteps(list = []) {
  const result = []

  for (const item of Array.isArray(list) ? list : []) {
    const step = item && typeof item === 'object' ? item : {}
    const action = String(resolveFirstDefinedValue(step.action, step.type, step.name) || '')
      .trim()
      .toLowerCase()

    if (!action) {
      continue
    }

    const resolvedBaseType = resolveFirstDefinedValue(
      step.base,
      step.base_type,
      step.baseType,
      step.path_type,
      step.pathType,
      step.target_type,
      step.targetType
    )
    const normalizedBaseTypeText = String(resolvedBaseType ?? '').trim()
    const repeatValue = Number(
      resolveFirstDefinedValue(step.repeat, step.repeat_count, step.repeatCount, step.times) || 1
    )
    const timeoutMsValue = Number(
      resolveFirstDefinedValue(step.timeout_ms, step.timeoutMs, step.timeout, step.max_wait_ms) ||
        300000
    )
    const stdinIntervalMsValue = Number(
      resolveFirstDefinedValue(
        step.stdin_interval_ms,
        step.stdinIntervalMs,
        step.stdin_delay_ms,
        step.stdinDelayMs,
        step.input_interval_ms,
        step.inputIntervalMs,
        step.input_delay_ms,
        step.inputDelayMs
      ) || 220
    )
    const requiresConsole =
      normalizeOptionalBoolean(
        resolveFirstDefinedValue(
          step.requires_console,
          step.requiresConsole,
          step.require_console,
          step.requireConsole,
          step.console_window,
          step.consoleWindow,
          step.new_console_window,
          step.newConsoleWindow,
          step.use_console_window,
          step.useConsoleWindow,
          step.create_console,
          step.createConsole
        )
      ) === true

    result.push({
      action,
      path: normalizePathLike(
        resolveFirstDefinedValue(
          step.path,
          step.relative_path,
          step.relativePath,
          step.dir,
          step.directory
        ) || ''
      ),
      args: normalizeLaunchArgumentList(
        resolveFirstDefinedValue(step.args, step['arguments'], step.argv)
      ),
      stdin: normalizeLaunchArgumentList(
        resolveFirstDefinedValue(step.stdin, step.input, step.inputs)
      ),
      stdinIntervalMs:
        Number.isFinite(stdinIntervalMsValue) && stdinIntervalMsValue >= 0
          ? Math.floor(stdinIntervalMsValue)
          : 220,
      requiresConsole,
      repeat: Number.isFinite(repeatValue) && repeatValue > 0 ? Math.floor(repeatValue) : 1,
      timeoutMs:
        Number.isFinite(timeoutMsValue) && timeoutMsValue > 0 ? Math.floor(timeoutMsValue) : 300000,
      // 未显式声明 base_type 时保留为空，执行阶段会按当前安装目标的默认基准解释。
      baseType: normalizedBaseTypeText
        ? normalizeInstallPostInstallBaseType(normalizedBaseTypeText, '')
        : ''
    })

    // H1：保留 schema 承诺的安全动作字段（from/to/source/target/text/content/value/patch/
    // section/key/backup/backup_path/json_path/overwrite/encoding/create_if_missing 等），
    // 不归一化字段名（由 lifecycleActions 的多别名回退处理），只确保字段不被丢弃。
    // 写入上一步 push 的同一个 entry，避免额外内存分配。
    const lastEntry = result[result.length - 1]
    for (const fieldName of LIFECYCLE_PASSTHROUGH_FIELDS) {
      const fieldValue = step[fieldName]
      if (fieldValue !== undefined && fieldValue !== null) {
        lastEntry[fieldName] = fieldValue
      }
    }
  }

  return result
}
