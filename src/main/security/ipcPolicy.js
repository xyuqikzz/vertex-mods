import path from 'node:path'
import { assertUpdateUrl } from './updatePolicy.js'
import { isWebUrl } from './windowPolicy.js'

export function assertJsonPayload(value, depth = 0) {
  if (depth > 32) throw new Error('ipc_payload_too_deep')
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) throw new Error('invalid_ipc_payload')
  for (const [key, entry] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('unsafe_ipc_key')
    assertJsonPayload(entry, depth + 1)
  }
  if (depth === 0 && JSON.stringify(value).length > 16 * 1024 * 1024) throw new Error('ipc_payload_too_large')
}

export function assertLocalPath(value) {
  if (typeof value !== 'string' || !value || [...value].some(char => char.charCodeAt(0) < 32) ||
      /^(?:\\\\|\/\/)/.test(value) || !path.win32.isAbsolute(value) ||
      !/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':') ||
      value.split(/[\\/]/).some((part) => part === '..') ||
      path.win32.resolve(value) === path.win32.parse(value).root) throw new Error('invalid_local_path')
  return value
}

export function validateIpcArguments(channel, args) {
  args.forEach((arg) => assertJsonPayload(arg))
  const payload = args[0]
  if (['flingTrainer:remove-file-if-unlocked', 'flingTrainer:check-file-unlocked', 'flingTrainer:run-file'].includes(channel)) {
    if (args.length !== 1) throw new Error('invalid_trainer_payload')
    assertLocalPath(payload?.filePath)
  }
  if (channel === 'ui-language:set' && (args.length !== 1 || !['zh-CN', 'en-US', 'system'].includes(payload))) throw new Error('invalid_ui_language')
  if (channel === 'executeSystemScript') {
    if (typeof payload?.scriptContent !== 'string' || !payload.scriptContent.trim() || payload.scriptContent.length > 262144 ||
        (payload.type && !['bat', 'cmd', 'ps1', 'vbs', 'js'].includes(String(payload.type).toLowerCase()))) throw new Error('invalid_system_script')
  }
  if (channel === 'addTasksToQueue' && !isWebUrl(payload?.download_url)) throw new Error('invalid_download_protocol')
  if (channel === 'addTasksToQueue' && payload?.fun?.method === 'installApp') assertUpdateUrl(payload.download_url)
  if (channel === 'searchLocalInstallFiles') {
    if (![payload?.module, payload?.id].every(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0) ||
        (payload.fileMd5 && !/^[a-f0-9]{32}$/i.test(payload.fileMd5))) throw new Error('invalid_update_record')
  }
  if (channel === 'getConfigByKey' && !['systemConfig', 'systemConfig.settings', 'systemConfig.window'].includes(payload?.key)) throw new Error('config_scope_disabled')
  if (channel === 'dbSet' || channel === 'dbGet') {
    throw new Error('store_scope_disabled')
  }
  if (payload?.replyName && !/^[\w:.-]{1,120}$/.test(payload.replyName)) throw new Error('invalid_reply_channel')
  if (channel === 'openSpecifyPath') assertLocalPath(typeof payload === 'string' ? payload : payload?.path)
  if (channel === 'startSpecifiedApp') {
    const target = payload?.target || payload?.path
    if (!/^steam:\/\/(?:rungameid|run)\/\d+\/?$/i.test(target || '')) assertLocalPath(target)
    if (payload.args !== undefined && (!Array.isArray(payload.args) || payload.args.some((arg) => typeof arg !== 'string' || [...arg].some(char => char.charCodeAt(0) < 32)))) throw new Error('invalid_launch_args')
  }
}
