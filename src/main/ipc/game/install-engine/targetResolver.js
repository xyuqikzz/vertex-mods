import { resolveInstallRuleTargetBase } from '../../../../shared/installation/install-rule-declarations.js'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import {
  isPlainObject,
  normalizeRelativeRulePath,
  normalizeTextList,
  resolveFirstDefinedValue,
  toSafeText
} from './contracts.js'
import { isPathInside, normalizeSafeRelativePath } from './pathSafety.js'

export function normalizePathLike(value = '') {
  return normalizeRelativeRulePath(value)
}

export function toPathParts(relativePath = '') {
  const text = normalizePathLike(relativePath)
  return text && text !== '.' ? text.split('/').filter(Boolean) : []
}

export function normalizeInstallFolderName(value = '') {
  const text = toSafeText(value)
    .split('')
    .map((char) => (/[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  return text || 'package'
}

function normalizeInstallUsageType(value, defaultValue = 1) {
  const safeValue = Number(value)
  return [1, 2, 3, 4].includes(safeValue) ? safeValue : defaultValue
}

export function normalizeTargetBaseType(value = '', fallback = 'game') {
  return resolveInstallRuleTargetBase(value) || fallback
}

async function getDownloadRootPath() {
  let config = {}
  try {
    const { readRuntimeDownloadConfig } = await import('./runtimeDownloadConfig.js')
    config = readRuntimeDownloadConfig()
  } catch {
    // 独立规则测试没有 Electron 配置，沿用客户端默认下载位置。
  }
  if (toSafeText(config.downloadPath)) return path.resolve(config.downloadPath)
  const driveRoot = path.parse(path.resolve(toSafeText(config.userPath) || os.homedir())).root
  return path.join(driveRoot, 'Vertex', 'dow')
}

function resolveUserDataRoot(baseType = 'local_appdata') {
  if (baseType === 'roaming_appdata') {
    return path.resolve(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  }
  return path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
}

export async function resolveTargetBoundaryRoot(baseType = 'game', gameRoot = '') {
  const normalizedBaseType = normalizeTargetBaseType(baseType, 'game')
  if (normalizedBaseType === 'download') {
    return {
      targetBaseType: 'download',
      targetBoundaryRoot: await getDownloadRootPath()
    }
  }
  if (normalizedBaseType === 'local_appdata' || normalizedBaseType === 'roaming_appdata') {
    return {
      targetBaseType: normalizedBaseType,
      targetBoundaryRoot: resolveUserDataRoot(normalizedBaseType)
    }
  }
  return {
    targetBaseType: 'game',
    targetBoundaryRoot: path.resolve(toSafeText(gameRoot) || process.cwd())
  }
}

function normalizeTargetRelativePath(value = '') {
  const text = normalizePathLike(value || '.')
  if (!text || text === '.') return '.'
  return normalizeSafeRelativePath(text, {
    allowDotSegment: true,
    errorMessage: '安装目标路径不安全'
  })
}

function resolveRequestedBaseType(targetRule = {}) {
  return normalizeTargetBaseType(
    resolveFirstDefinedValue(
      targetRule.base,
      targetRule.base_type,
      targetRule.baseType,
      targetRule.scope,
      targetRule.scope_type,
      targetRule.scopeType,
      targetRule.user_scope,
      targetRule.userScope
    ),
    'game'
  )
}

function resolveTargetType(targetRule = {}, fallback = 'game_relative') {
  return toSafeText(
    resolveFirstDefinedValue(targetRule.type, targetRule.target_type, targetRule.targetType) ||
      fallback
  ).toLowerCase()
}

export async function resolveRuleTargetLocation(rule = {}, context = {}, packageProfile = {}) {
  const targetRule = isPlainObject(rule.target) ? { ...rule.target } : {}
  if (!toSafeText(targetRule.path || targetRule.target_path || targetRule.targetPath)) {
    const suggestedTarget = toSafeText(packageProfile.suggestedTarget)
    if (suggestedTarget && suggestedTarget !== '.') {
      targetRule.path = suggestedTarget
    }
  }

  const safeGameRoot = path.resolve(toSafeText(context.gameRoot) || process.cwd())
  const targetType = resolveTargetType(targetRule, 'game_root')
  const requestedBaseType = resolveRequestedBaseType(targetRule)
  const targetPathText = normalizeTargetRelativePath(
    resolveFirstDefinedValue(targetRule.path, targetRule.target_path, targetRule.targetPath) || '.'
  )
  const appendPackageDir =
    (targetRule.append_package_dir ??
      targetRule.appendPackageDir ??
      targetRule.append_archive_dir ??
      targetRule.appendArchiveDir) !== false

  let targetBoundaryRoot = safeGameRoot
  let targetBaseType = 'game'
  let targetRelativePath = '.'
  let targetRoot = safeGameRoot

  if (targetType === 'download_relative') {
    const boundary = await resolveTargetBoundaryRoot('download', safeGameRoot)
    const relativeParts = toPathParts(targetPathText)
    if (appendPackageDir) {
      relativeParts.push(normalizeInstallFolderName(context.packageFolderName || 'package'))
    }
    targetBaseType = boundary.targetBaseType
    targetBoundaryRoot = boundary.targetBoundaryRoot
    targetRelativePath = relativeParts.length ? normalizePathLike(relativeParts.join('/')) : '.'
    targetRoot = relativeParts.length
      ? path.resolve(targetBoundaryRoot, ...relativeParts)
      : targetBoundaryRoot
  } else if (targetType === 'user_relative') {
    if (!targetPathText || targetPathText === '.') {
      throw new Error('用户作用域安装规则缺少 target.path，无法确定安装目标目录')
    }
    const boundary = await resolveTargetBoundaryRoot(
      requestedBaseType === 'game' ? 'local_appdata' : requestedBaseType,
      safeGameRoot
    )
    targetBaseType = boundary.targetBaseType
    targetBoundaryRoot = boundary.targetBoundaryRoot
    targetRelativePath = targetPathText
    targetRoot = path.resolve(targetBoundaryRoot, ...toPathParts(targetPathText))
  } else if (targetType === 'game_relative' || targetPathText !== '.') {
    targetRelativePath = targetPathText
    targetRoot =
      targetPathText === '.'
        ? safeGameRoot
        : path.resolve(safeGameRoot, ...toPathParts(targetPathText))
  }

  if (!isPathInside(targetBoundaryRoot, targetRoot)) {
    throw new Error('识别到不安全的安装目标路径，已阻止安装')
  }

  const usageType = normalizeInstallUsageType(
    targetRule.usageType ?? targetRule.usage_type,
    targetBaseType === 'download' ? 2 : 1
  )

  return {
    targetType,
    targetRoot,
    targetRelativePath,
    targetBaseType,
    usageType,
    isRunnable:
      targetRule.mark_runnable === true ||
      targetRule.markRunnable === true ||
      targetRule.runnable === true ||
      usageType === 2 ||
      usageType === 4,
    launchAction: toSafeText(targetRule.launchAction || targetRule.launch_action),
    showInjectButton:
      targetRule.showInjectButton === true || targetRule.show_inject_button === true,
    enableExecutablePath: normalizePathLike(
      targetRule.enableExecutablePath || targetRule.enable_executable_path || ''
    ),
    enableExecutableBaseType: normalizeTargetBaseType(
      targetRule.enableExecutableBaseType ||
        targetRule.enable_executable_base_type ||
        targetBaseType,
      targetBaseType
    ),
    launchArgs: normalizeTextList(targetRule.launchArgs || targetRule.launch_args)
  }
}

export async function resolveRouteTargetLocation(route = {}, context = {}) {
  const targetRule = isPlainObject(route.target) ? route.target : {}
  const targetType = resolveTargetType(targetRule, 'game_relative')
  const requestedBaseType = resolveRequestedBaseType(targetRule)
  const targetPathText = normalizeTargetRelativePath(
    resolveFirstDefinedValue(targetRule.path, targetRule.target_path, targetRule.targetPath) || '.'
  )

  let targetBaseType = 'game'
  let targetBoundaryRoot = path.resolve(toSafeText(context.gameRoot) || process.cwd())
  let targetRelativePath = targetPathText || '.'

  if (targetType === 'download_relative') {
    const boundary = await resolveTargetBoundaryRoot('download', context.gameRoot)
    targetBaseType = boundary.targetBaseType
    targetBoundaryRoot = boundary.targetBoundaryRoot
  } else if (targetType === 'user_relative') {
    if (!targetPathText || targetPathText === '.') {
      throw new Error('用户作用域 route 缺少 target.path，无法确定安装目标目录')
    }
    const boundary = await resolveTargetBoundaryRoot(
      requestedBaseType === 'game' ? 'local_appdata' : requestedBaseType,
      context.gameRoot
    )
    targetBaseType = boundary.targetBaseType
    targetBoundaryRoot = boundary.targetBoundaryRoot
  }

  if (!targetRelativePath || targetRelativePath === '.') {
    targetRelativePath = '.'
  }

  const targetRoot =
    targetRelativePath === '.'
      ? targetBoundaryRoot
      : path.resolve(targetBoundaryRoot, ...toPathParts(targetRelativePath))
  if (!isPathInside(targetBoundaryRoot, targetRoot)) {
    throw new Error('route 目标路径越界，已阻止安装')
  }

  return {
    targetType,
    targetBaseType,
    targetBoundaryRoot,
    targetRelativePath,
    targetRoot
  }
}

export async function resolveSingleRoot(sourceRoot = '', sourceRule = {}) {
  const unwrap =
    sourceRule.unwrap_single_root === true ||
    sourceRule.unwrapSingleRoot === true ||
    sourceRule.strip_single_root === true ||
    sourceRule.stripSingleRoot === true ||
    sourceRule.unwrap_package_root === true ||
    sourceRule.unwrapPackageRoot === true
  if (!unwrap) {
    return {
      sourceRoot: path.resolve(sourceRoot),
      wrappedRootName: '',
      unwrapped: false
    }
  }

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((item) => item.isDirectory())
  const files = entries.filter((item) => item.isFile())
  if (dirs.length === 1 && files.length === 0) {
    return {
      sourceRoot: path.resolve(sourceRoot, dirs[0].name),
      wrappedRootName: dirs[0].name,
      unwrapped: true
    }
  }

  const strict =
    toSafeText(sourceRule.unwrap_mode || sourceRule.unwrapMode).toLowerCase() === 'strict'
  if (strict) {
    throw new Error('安装源目录不满足单层包裹目录剥离条件')
  }

  return {
    sourceRoot: path.resolve(sourceRoot),
    wrappedRootName: '',
    unwrapped: false
  }
}
