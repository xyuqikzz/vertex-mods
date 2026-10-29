import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { LOCAL_MOD_MANAGER_ERROR_CODE } from './localModManagerResult.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function isSamePath(left = '', right = '') {
  if (!left || !right) return false
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function collectBlockedRoots(payload = {}) {
  const roots = new Set()
  const home = os.homedir()
  if (home) roots.add(path.resolve(home).toLowerCase())
  const downloads = home ? path.join(home, 'Downloads') : ''
  if (downloads) roots.add(path.resolve(downloads).toLowerCase())
  const gameRoot = toSafeText(payload.gameRoot || payload.rootPath || payload.gamePath)
  if (gameRoot) roots.add(path.resolve(gameRoot).toLowerCase())
  for (const value of [
    process.env.SystemRoot,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ]) {
    if (value) roots.add(path.resolve(value).toLowerCase())
  }
  return roots
}

export function validateManagedSourcePath(targetPath = '', payload = {}) {
  const safePath = toSafeText(targetPath)
  if (!safePath) {
    return {
      safe: false,
      code: LOCAL_MOD_MANAGER_ERROR_CODE.PATH_MISSING,
      message: '路径为空'
    }
  }

  const resolved = path.resolve(safePath)
  const parsed = path.parse(resolved)
  const blockedRoots = collectBlockedRoots(payload)
  const normalized = resolved.toLowerCase()
  if (isSamePath(resolved, parsed.root) || blockedRoots.has(normalized)) {
    return {
      safe: false,
      code: LOCAL_MOD_MANAGER_ERROR_CODE.PATH_UNSAFE,
      message: '该路径属于高风险目录，已阻止接管',
      path: resolved
    }
  }

  if (!fs.pathExistsSync(resolved)) {
    return {
      safe: false,
      code: LOCAL_MOD_MANAGER_ERROR_CODE.PATH_MISSING,
      message: '路径不存在',
      path: resolved
    }
  }

  return {
    safe: true,
    path: resolved
  }
}

export function validateManualInstallTarget(targetPath = '', payload = {}) {
  const safePath = toSafeText(targetPath)
  if (!safePath) {
    return {
      safe: false,
      code: LOCAL_MOD_MANAGER_ERROR_CODE.MANUAL_TARGET_REQUIRED,
      message: '请选择安装目标文件夹'
    }
  }

  const resolved = path.resolve(safePath)
  const parsed = path.parse(resolved)
  const blockedRoots = collectBlockedRoots(payload)
  const normalized = resolved.toLowerCase()
  if (isSamePath(resolved, parsed.root) || blockedRoots.has(normalized)) {
    return {
      safe: false,
      code: LOCAL_MOD_MANAGER_ERROR_CODE.MANUAL_TARGET_UNSAFE,
      message: '安装目标不能是系统根目录、用户主目录、下载目录或游戏根目录本身',
      path: resolved
    }
  }

  return {
    safe: true,
    path: resolved
  }
}

export function collectBatchDuplicatePaths(paths = []) {
  const seen = new Set()
  const duplicates = []
  for (const item of Array.isArray(paths) ? paths : []) {
    const text = toSafeText(typeof item === 'string' ? item : item?.path)
    if (!text) continue
    const resolved = path.resolve(text)
    const key = resolved.toLowerCase()
    if (seen.has(key)) {
      duplicates.push(resolved)
      continue
    }
    seen.add(key)
  }
  return duplicates
}

export function isPathInside(parentPath = '', childPath = '') {
  const parent = path.resolve(parentPath)
  const child = path.resolve(childPath)
  const relative = path.relative(parent, child)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function toGameRelativePath(gameRoot = '', targetPath = '') {
  if (!gameRoot || !targetPath || !isPathInside(gameRoot, targetPath)) {
    return ''
  }
  return path.relative(path.resolve(gameRoot), path.resolve(targetPath)).replace(/\\/g, '/')
}
