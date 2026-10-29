import { isPlainObject } from './compilerUtils.js'

const AUTO_ROOT_DIR_MATCH_RULE_ID = '__auto_root_dir_match__'
const AUTO_ROOT_DIR_MATCH_RULE_PRIORITY = 100

function normalizeSingleSegmentGameDirName(value = '') {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  if (['.', '..'].includes(text)) {
    return ''
  }

  if (/^[A-Za-z]:/.test(text)) {
    return ''
  }

  if (/[\\/]/.test(text)) {
    return ''
  }

  return text
}

function createAutoRootDirMatchRule(gameDirName = '') {
  return {
    id: AUTO_ROOT_DIR_MATCH_RULE_ID,
    name: '内置-根路径匹配',
    builtin: true,
    generated_by: 'auto_root_dir_match',
    priority: AUTO_ROOT_DIR_MATCH_RULE_PRIORITY,
    match: {
      root_has_dirs: [gameDirName]
    },
    source: {
      type: 'package_root'
    },
    target: {
      type: 'game_root',
      path: '.'
    }
  }
}

export function appendAutoRootDirMatchRule(target = {}, variableMap = {}) {
  if (!isPlainObject(target)) {
    return target
  }

  const gameDirName = normalizeSingleSegmentGameDirName(variableMap?.game_dir)
  if (!gameDirName) {
    return target
  }

  const currentInstallRules = Array.isArray(target.install_rules) ? target.install_rules : []
  const hasBuiltinAutoRule = currentInstallRules.some(
    (item) =>
      isPlainObject(item) &&
      String(item.id || '').trim() === AUTO_ROOT_DIR_MATCH_RULE_ID
  )
  if (hasBuiltinAutoRule) {
    return target
  }

  const autoRule = createAutoRootDirMatchRule(gameDirName)
  const nextInstallRules = [...currentInstallRules, autoRule]
  const result = {
    ...target,
    install_rules: nextInstallRules
  }

  if (Array.isArray(target.installRules)) {
    result.installRules = [...target.installRules, autoRule]
  }

  return result
}
