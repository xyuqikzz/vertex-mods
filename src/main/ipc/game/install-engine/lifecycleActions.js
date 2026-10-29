import fs from 'fs-extra'
import path from 'path'
import { isPlainObject, toSafeText } from './contracts.js'
import {
  INSTALL_ENGINE_ERROR_CODES,
  InstallEngineError,
  normalizeInstallEngineError
} from './installEngineError.js'
import { isPathInside, normalizeSafeRelativePath } from './pathSafety.js'

export const SAFE_LIFECYCLE_ACTIONS = Object.freeze([
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
])

function toPathParts(relativePath = '') {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((item) => item && item !== '.')
}

function resolveActionPath(baseRoot = '', boundaryRoot = '', rawPath = '') {
  const rawText = toSafeText(rawPath)
  if (!rawText) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
      '生命周期安全动作缺少路径'
    )
  }

  const relativePath = normalizeSafeRelativePath(rawText, {
    allowDotSegment: true,
    errorMessage: '生命周期安全动作路径不安全'
  })
  const fullPath =
    relativePath === '.'
      ? path.resolve(baseRoot)
      : path.resolve(baseRoot, ...toPathParts(relativePath))
  if (!isPathInside(boundaryRoot, fullPath)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      '生命周期安全动作路径越界，已拒绝执行'
    )
  }
  return fullPath
}

async function findExistingAncestor(targetPath = '', boundaryRoot = '') {
  let currentPath = path.resolve(targetPath)
  const safeBoundaryRoot = path.resolve(boundaryRoot)
  while (isPathInside(safeBoundaryRoot, currentPath)) {
    if (await fs.pathExists(currentPath)) {
      return currentPath
    }
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }
  return safeBoundaryRoot
}

async function assertPathStillInsideBoundary(boundaryRoot = '', targetPath = '') {
  const safeBoundaryRoot = path.resolve(toSafeText(boundaryRoot))
  const safeTargetPath = path.resolve(toSafeText(targetPath))
  if (!isPathInside(safeBoundaryRoot, safeTargetPath)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      '生命周期安全动作路径越界，已拒绝执行'
    )
  }

  const existingAncestor = await findExistingAncestor(safeTargetPath, safeBoundaryRoot)
  const realBoundaryRoot = await fs.realpath(safeBoundaryRoot).catch(() => safeBoundaryRoot)
  const realAncestor = await fs.realpath(existingAncestor).catch(() => existingAncestor)
  if (!isPathInside(realBoundaryRoot, realAncestor)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      '生命周期安全动作路径越界，已拒绝执行'
    )
  }
}

async function assertActionPathsStillInside(runtime = {}, pathList = []) {
  const boundaryRoot = toSafeText(runtime.boundaryRoot || runtime.baseRoot)
  for (const targetPath of pathList.filter(Boolean)) {
    await assertPathStillInsideBoundary(boundaryRoot, targetPath)
  }
}

function resolveStepPath(step = {}, runtime = {}, fieldNames = []) {
  for (const fieldName of fieldNames) {
    // H1：优先用 pathBaseResolver 已展开 + 已校验的路径，避免后置兜底重复 resolve。
    if (runtime?.resolvedPaths && runtime.resolvedPaths[fieldName]) {
      return runtime.resolvedPaths[fieldName]
    }
    // 回退到 step 原字段（兼容未走 runtime 改造的路径，如直接调 applySafeLifecycleAction 的测试用例）。
    const value = step?.[fieldName]
    if (toSafeText(value)) {
      return resolveActionPath(runtime.baseRoot, runtime.boundaryRoot, value)
    }
  }

  if (fieldNames.includes('path') && runtime.resolvedTargetPath) {
    return runtime.resolvedTargetPath
  }

  throw new InstallEngineError(
    INSTALL_ENGINE_ERROR_CODES.PATH_MISSING,
    '生命周期安全动作缺少路径'
  )
}

// H1：从 runtime.resolvedTexts 或 step 取文本类字段值，优先用已模板展开的版本。
function resolveStepText(step = {}, runtime = {}, fieldNames = []) {
  for (const fieldName of fieldNames) {
    if (runtime?.resolvedTexts && runtime.resolvedTexts[fieldName] !== undefined) {
      return runtime.resolvedTexts[fieldName]
    }
    const value = step?.[fieldName]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function mergePlainJson(left = {}, right = {}) {
  return {
    ...(isPlainObject(left) ? left : {}),
    ...(isPlainObject(right) ? right : {})
  }
}

function normalizeIniToken(value = '', label = '字段') {
  const text = toSafeText(value)
  if (!text || /[\r\n;#[\]=]/.test(text)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_PATCH_INVALID,
      `patch_ini ${label} 不合法`
    )
  }
  return text
}

function escapeIniValue(value = '') {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[;#]/g, '\\$&')
}

function patchIniText(text = '', patch = {}) {
  const section = toSafeText(patch.section) ? normalizeIniToken(patch.section, 'section') : ''
  const key = normalizeIniToken(patch.key, 'key')
  const value = escapeIniValue(patch.value ?? '')

  const lines = String(text || '').split(/\r?\n/)
  const nextLine = `${key}=${value}`
  if (!section) {
    const keyIndex = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`${key.toLowerCase()}=`))
    if (keyIndex >= 0) {
      lines[keyIndex] = nextLine
      return lines.join('\n')
    }
    return [...lines.filter((line, index) => index < lines.length - 1 || line), nextLine].join('\n')
  }

  const header = `[${section}]`
  const headerIndex = lines.findIndex((line) => line.trim().toLowerCase() === header.toLowerCase())
  if (headerIndex < 0) {
    return [...lines.filter((line, index) => index < lines.length - 1 || line), '', header, nextLine].join('\n')
  }

  let insertIndex = headerIndex + 1
  let keyIndex = -1
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (/^\[.*]$/.test(line)) {
      break
    }
    insertIndex = index + 1
    if (line.toLowerCase().startsWith(`${key.toLowerCase()}=`)) {
      keyIndex = index
      break
    }
  }

  if (keyIndex >= 0) {
    lines[keyIndex] = nextLine
  } else {
    lines.splice(insertIndex, 0, nextLine)
  }
  return lines.join('\n')
}

async function ensureLifecycleDirectory(targetPath, runtime) {
  const missing = []
  const boundaryRoot = toSafeText(runtime.boundaryRoot || runtime.baseRoot)
  let current = targetPath
  while (true) {
    await assertActionPathsStillInside(runtime, [current])
    try {
      const stat = await fs.lstat(current)
      const ancestorLink = current !== targetPath && stat.isSymbolicLink() &&
        (await fs.stat(current)).isDirectory()
      if (!stat.isDirectory() && !ancestorLink)
        throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_ACTION_INVALID, '生命周期目标不是普通目录')
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      missing.push(current)
      const parent = path.dirname(current)
      if (parent === current || !isPathInside(boundaryRoot, parent)) throw error
      current = parent
    }
  }
  for (const directory of missing.reverse()) {
    await assertActionPathsStillInside(runtime, [directory])
    try {
      // Non-recursive mkdir distinguishes our directories from concurrent creations.
      await fs.mkdir(directory)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const stat = await fs.lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw error
      continue
    }
    await runtime.directoryReceipt?.recordCreatedDirectory?.(directory)
    await assertActionPathsStillInside(runtime, [directory])
  }
}

async function applySafeLifecycleActionInner(step = {}, runtime = {}) {
  const action = toSafeText(runtime.action || step.action).toLowerCase()
  if (!SAFE_LIFECYCLE_ACTIONS.includes(action)) {
    return false
  }

  if (action === 'copy_path') {
    const sourcePath = resolveStepPath(step, runtime, ['from', 'source', 'source_path', 'sourcePath'])
    const targetPath = resolveStepPath(step, runtime, ['to', 'target', 'target_path', 'targetPath', 'path'])
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.copy(sourcePath, targetPath, { overwrite: step.overwrite !== false, errorOnExist: false })
    return true
  }

  if (action === 'move_path') {
    const sourcePath = resolveStepPath(step, runtime, ['from', 'source', 'source_path', 'sourcePath'])
    const targetPath = resolveStepPath(step, runtime, ['to', 'target', 'target_path', 'targetPath', 'path'])
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.move(sourcePath, targetPath, { overwrite: step.overwrite !== false })
    return true
  }

  if (action === 'rename_path') {
    const sourcePath = resolveStepPath(step, runtime, ['from', 'source', 'source_path', 'sourcePath'])
    const targetPath = resolveStepPath(step, runtime, ['to', 'target', 'target_path', 'targetPath', 'path'])
    if (path.dirname(sourcePath).toLowerCase() !== path.dirname(targetPath).toLowerCase()) {
      throw new InstallEngineError(
        INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_ACTION_INVALID,
        'rename_path 只能在同一目录内重命名'
      )
    }
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath])
    await fs.move(sourcePath, targetPath, { overwrite: step.overwrite !== false })
    return true
  }

  if (action === 'remove_path') {
    const targetPath = resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath])
    await fs.remove(targetPath)
    return true
  }

  if (action === 'remove_empty_dir') {
    const targetPath = resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath])
    let stat
    try {
      stat = await fs.lstat(targetPath)
    } catch (error) {
      if (error.code === 'ENOENT') return true
      throw error
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.LIFECYCLE_ACTION_INVALID, '生命周期目标不是普通目录')
    await assertActionPathsStillInside(runtime, [targetPath])
    try {
      await fs.rmdir(targetPath)
    } catch (error) {
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) return true
      throw error
    }
    runtime.directoryReceipt?.recordRemovedDirectory?.(targetPath, stat)
    return true
  }

  if (action === 'ensure_dir_exists') {
    const targetPath = runtime.resolvedTargetPath
      ? toSafeText(runtime.resolvedTargetPath)
      : resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath])
    await ensureLifecycleDirectory(targetPath, runtime)
    await assertActionPathsStillInside(runtime, [targetPath])
    return true
  }

  if (action === 'write_text_file') {
    const targetPath = resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    const textContent = resolveStepText(step, runtime, ['text', 'content', 'value'])
    await fs.writeFile(targetPath, String(textContent ?? ''), 'utf8')
    return true
  }

  if (action === 'patch_json') {
    const targetPath = resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    const currentText = await fs.readFile(targetPath, 'utf8').catch(() => '{}')
    const currentJson = JSON.parse(currentText || '{}')
    // H1：优先用已模板展开的 patch/value/content，回退 step 原值。
    const patchFromRuntime = resolveStepText(step, runtime, ['patch', 'value', 'content'])
    const patchValue = isPlainObject(patchFromRuntime)
      ? patchFromRuntime
      : isPlainObject(step.patch)
        ? step.patch
        : isPlainObject(step.value)
          ? step.value
          : isPlainObject(step.content)
            ? step.content
            : {}
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    await fs.writeFile(targetPath, stringifyJson(mergePlainJson(currentJson, patchValue)), 'utf8')
    return true
  }

  if (action === 'patch_ini') {
    const targetPath = resolveStepPath(step, runtime, ['path', 'target', 'target_path', 'targetPath'])
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    const currentText = await fs.readFile(targetPath, 'utf8').catch(() => '')
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [targetPath, path.dirname(targetPath)])
    // H1：patchIniText 接收 patch 对象，用 resolveStepText 取已模板展开的 section/key/value。
    const iniPatch = {
      section: resolveStepText(step, runtime, ['section']),
      key: resolveStepText(step, runtime, ['key']),
      value: resolveStepText(step, runtime, ['value'])
    }
    await fs.writeFile(targetPath, patchIniText(currentText, iniPatch), 'utf8')
    return true
  }

  if (action === 'backup_path') {
    const sourcePath = resolveStepPath(step, runtime, ['from', 'source', 'source_path', 'sourcePath', 'path'])
    const targetPath = resolveStepPath(step, runtime, ['to', 'backup', 'backup_path', 'backupPath', 'target'])
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.ensureDir(path.dirname(targetPath))
    await assertActionPathsStillInside(runtime, [sourcePath, targetPath, path.dirname(targetPath)])
    await fs.copy(sourcePath, targetPath, { overwrite: step.overwrite !== false, errorOnExist: false })
    return true
  }

  return false
}

export async function applySafeLifecycleAction(step = {}, runtime = {}) {
  try {
    return await applySafeLifecycleActionInner(step, runtime)
  } catch (error) {
    throw normalizeInstallEngineError(
      error,
      INSTALL_ENGINE_ERROR_CODES.FILE_OPERATION_FAILED,
      '生命周期安全动作执行失败'
    )
  }
}
