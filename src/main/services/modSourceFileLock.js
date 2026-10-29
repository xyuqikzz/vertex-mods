import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MAX_PATH = 260
const require = createRequire(import.meta.url)
let nativeAclApiPromise = null

function toModId(modId) {
  const id = Number(modId)
  return Number.isFinite(id) ? id : 0
}

function toText(value) {
  return String(value ?? '').trim()
}

function isBoundMod(mod) {
  return toText(mod?.install_model).toLowerCase() === 'bound'
}

function normalizePath(p) {
  const trimmed = toText(p)
  if (!trimmed) return ''
  const normalized = path.normalize(trimmed)
  if (normalized.length >= MAX_PATH && process.platform === 'win32') {
    if (normalized.startsWith('\\\\?\\')) {
      return normalized
    }
    if (normalized.startsWith('\\\\')) {
      return `\\\\?\\UNC\\${normalized.slice(2)}`
    }
    return `\\\\?\\${normalized}`
  }
  return normalized
}

function isUncPath(p) {
  const lower = toText(p).toLowerCase()
  return (
    (lower.startsWith('\\\\') && !lower.startsWith('\\\\?\\')) ||
    lower.startsWith('\\\\?\\unc\\')
  )
}

function hasNativeAclInterface(fileApi) {
  return !!(
    fileApi &&
    typeof fileApi.protectModSource === 'function' &&
    typeof fileApi.restoreModSource === 'function' &&
    typeof fileApi.validateModSourceReadable === 'function' &&
    typeof fileApi.repairModSourceAccess === 'function'
  )
}

function listNativeAddonCandidates() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'node') : '',
    path.resolve(process.cwd(), 'resources', 'node'),
    path.resolve(moduleDir, '..', '..', '..', 'resources', 'node')
  ].filter(Boolean)
  const candidates = []
  for (const root of roots) {
    candidates.push(path.join(root, 'file_api_v3.node'))
    candidates.push(path.join(root, 'file_api_v2.node'))
    candidates.push(path.join(root, 'file_api.node'))
  }
  return [...new Set(candidates)]
}

async function loadNativeAclApi() {
  if (nativeAclApiPromise) return nativeAclApiPromise

  nativeAclApiPromise = (async () => {
    const loadErrors = []
    try {
      const runtimeApi = await import('./modSourceFileLockRuntime.js')
      const fileApi = runtimeApi.getRuntimeVertexFileNodeApi()
      if (hasNativeAclInterface(fileApi)) return fileApi
      loadErrors.push('Electron 原生文件模块缺少 ACL interface')
    } catch (error) {
      loadErrors.push(String(error?.message || error || 'Electron 原生文件模块加载失败'))
    }

    for (const candidate of listNativeAddonCandidates()) {
      if (!fs.existsSync(candidate)) continue
      try {
        const fileApi = require(candidate)
        if (hasNativeAclInterface(fileApi)) return fileApi
        loadErrors.push(`${candidate}: 缺少 ACL interface`)
      } catch (error) {
        loadErrors.push(`${candidate}: ${error?.message || error}`)
      }
    }

    const error = new Error(`无法加载 Vertex 原生 ACL 模块：${loadErrors.join('；')}`)
    error.code = 'native_acl_unavailable'
    throw error
  })()

  try {
    return await nativeAclApiPromise
  } catch (error) {
    nativeAclApiPromise = null
    throw error
  }
}

async function callNativeAcl(methodName, targetPath) {
  const fileApi = await loadNativeAclApi()
  return await new Promise((resolve, reject) => {
    try {
      fileApi[methodName](targetPath, (error, result) => {
        if (error) {
          reject(error)
          return
        }
        resolve(result && typeof result === 'object' ? result : {})
      })
    } catch (error) {
      reject(error)
    }
  })
}

function buildNativeAclFailure(target, result = {}, fallbackCode = 'acl_operation_failed') {
  const failedPath = toText(result?.failedPath) || toText(target?.path)
  const systemError = toText(result?.systemError)
  return {
    path: failedPath,
    targetPath: toText(target?.path),
    code: toText(result?.code) || fallbackCode,
    message: systemError || '原生 ACL 操作失败',
    win32Error: Number(result?.win32Error || 0),
    currentUserSid: toText(result?.currentUserSid),
    rollbackAttempted: result?.rollbackAttempted === true,
    rollbackSucceeded: result?.rollbackSucceeded === true
  }
}

export function resolveModSourceLockTargets(mod, options = {}) {
  if (isBoundMod(mod)) return []

  const sourceRoot = toText(mod?.source_root_path)
  if (sourceRoot) {
    return [{ path: sourceRoot, type: 'directory', kind: 'source_root' }]
  }

  const archivePath = toText(mod?.archive_path)
  const stagingPath = toText(mod?.staging_path)

  const canCollapseSharedParent =
    options.requireExistingPaths !== true ||
    (fs.existsSync(archivePath) && fs.existsSync(stagingPath))
  if (archivePath && stagingPath && canCollapseSharedParent) {
    const archiveDir = path.dirname(archivePath)
    const stagingDir = path.dirname(stagingPath)
    if (
      path.normalize(archiveDir).toLowerCase() === path.normalize(stagingDir).toLowerCase()
    ) {
      return [{ path: archiveDir, type: 'directory', kind: 'shared_parent' }]
    }
  }

  const targets = []
  if (stagingPath) targets.push({ path: stagingPath, type: 'directory', kind: 'staging' })
  if (archivePath) targets.push({ path: archivePath, type: 'file', kind: 'archive' })
  return targets
}

export async function checkModSourceLockCapability(mod) {
  if (isBoundMod(mod)) {
    return { capable: false, reason: 'bound_model_skip' }
  }
  const targets = resolveModSourceLockTargets(mod, { requireExistingPaths: true })
  if (!targets.length) {
    return { capable: false, reason: 'empty_path' }
  }
  for (const t of targets) {
    const normalized = normalizePath(t.path)
    if (!normalized) return { capable: false, reason: 'empty_path' }
    if (isUncPath(normalized)) return { capable: false, reason: 'unsupported_fs' }
    if (!fs.existsSync(normalized)) return { capable: false, reason: 'not_found', path: t.path }
  }
  return { capable: true, targets }
}

export async function lockModSource(mod) {
  const id = toModId(mod?.id ?? mod?.mod_id)
  if (!id) {
    return { success: false, state: 'lock_failed', targets: [], failures: [{ code: 'invalid_id' }] }
  }
  if (isBoundMod(mod)) {
    return { success: true, state: 'unlocked', targets: [], failures: [], skipped: true }
  }
  const targets = resolveModSourceLockTargets(mod, { requireExistingPaths: true })
  if (!targets.length) {
    return {
      success: false,
      state: 'lock_failed',
      targets: [],
      failures: [{ code: 'empty_path', message: '无可加锁路径' }]
    }
  }

  const applied = []
  const failures = []
  for (const t of targets) {
    const normalized = normalizePath(t.path)
    if (!normalized) {
      failures.push({ path: t.path, code: 'empty_path', message: '路径为空' })
      continue
    }
    if (isUncPath(normalized)) {
      failures.push({ path: t.path, code: 'unsupported_fs', message: 'UNC / 网络路径不支持 ACL' })
      continue
    }
    if (!fs.existsSync(normalized)) {
      failures.push({ path: t.path, code: 'not_found', message: '路径不存在' })
      continue
    }
    const isDirectory = t.type === 'directory' ? true : fs.statSync(normalized).isDirectory()
    try {
      const res = await callNativeAcl('protectModSource', normalized)
      if (res?.success === true && res?.readable === true) {
        applied.push({
          path: t.path,
          type: isDirectory ? 'directory' : 'file',
          success: true,
          currentUserSid: toText(res.currentUserSid),
          processedPaths: Number(res.processedPaths || 0)
        })
      } else {
        failures.push(buildNativeAclFailure(t, res, 'lock_read_validation_failed'))
      }
    } catch (error) {
      failures.push({
        path: t.path,
        code: toText(error?.code) || 'native_acl_failed',
        message: toText(error?.message) || '原生 ACL 加锁失败'
      })
    }
  }

  if (failures.length === 0) {
    return { success: true, state: 'locked', targets: applied, failures: [] }
  }

  const rollback = []
  for (const target of [...applied].reverse()) {
    try {
      const restoreResult = await callNativeAcl('restoreModSource', normalizePath(target.path))
      rollback.push({
        path: target.path,
        success: restoreResult?.success === true,
        code: toText(restoreResult?.code)
      })
      target.rolledBack = restoreResult?.success === true
    } catch (error) {
      rollback.push({
        path: target.path,
        success: false,
        code: toText(error?.code) || 'native_acl_failed',
        message: toText(error?.message)
      })
      target.rolledBack = false
    }
  }
  if (applied.length === 0) {
    return { success: false, state: 'lock_failed', targets: [], failures }
  }
  return {
    success: false,
    state: 'lock_failed',
    targets: applied,
    failures,
    rollback,
    partial: true
  }
}

export async function unlockModSource(mod) {
  const id = toModId(mod?.id ?? mod?.mod_id)
  if (!id) {
    return {
      success: false,
      state: 'unlock_failed',
      targets: [],
      failures: [{ code: 'invalid_id' }]
    }
  }
  if (isBoundMod(mod)) {
    return { success: true, state: 'unlocked', targets: [], failures: [], skipped: true }
  }
  const targets = resolveModSourceLockTargets(mod)
  if (!targets.length) {
    return {
      success: false,
      state: 'unlock_failed',
      targets: [],
      failures: [{ code: 'empty_path', message: '无可解锁路径' }]
    }
  }

  const applied = []
  const failures = []
  for (const t of targets) {
    const normalized = normalizePath(t.path)
    if (!normalized) {
      failures.push({ path: t.path, code: 'empty_path', message: '路径为空' })
      continue
    }
    if (isUncPath(normalized)) {
      failures.push({ path: t.path, code: 'unsupported_fs', message: 'UNC / 网络路径不支持 ACL' })
      continue
    }
    if (!fs.existsSync(normalized)) {
      applied.push({ path: t.path, type: t.type, success: true, skipped: 'not_found' })
      continue
    }
    const isDirectory = t.type === 'directory' ? true : fs.statSync(normalized).isDirectory()
    try {
      const res = await callNativeAcl('restoreModSource', normalized)
      if (res?.success === true && res?.restored === true) {
        applied.push({
          path: t.path,
          type: isDirectory ? 'directory' : 'file',
          success: true,
          currentUserSid: toText(res.currentUserSid),
          processedPaths: Number(res.processedPaths || 0)
        })
      } else {
        failures.push(buildNativeAclFailure(t, res, 'acl_restore_failed'))
      }
    } catch (error) {
      failures.push({
        path: t.path,
        code: toText(error?.code) || 'native_acl_failed',
        message: toText(error?.message) || '原生 ACL 解锁失败'
      })
    }
  }

  if (failures.length === 0) {
    return { success: true, state: 'unlocked', targets: applied, failures: [] }
  }
  if (applied.length === 0) {
    return { success: false, state: 'unlock_failed', targets: [], failures }
  }
  return {
    success: false,
    state: 'unlock_failed',
    targets: applied,
    failures,
    partial: true
  }
}

export async function inspectModSourceLock(mod) {
  if (isBoundMod(mod)) {
    return { success: true, state: 'unlocked', readable: true, targets: [], failures: [] }
  }

  const targets = resolveModSourceLockTargets(mod, { requireExistingPaths: true })
  if (!targets.length) {
    return {
      success: false,
      state: 'repair_required',
      readable: false,
      targets: [],
      failures: [{ code: 'empty_path', message: '无可验证路径' }]
    }
  }

  const inspected = []
  const failures = []
  for (const target of targets) {
    const normalized = normalizePath(target.path)
    if (!normalized || !fs.existsSync(normalized)) {
      failures.push({
        path: target.path,
        code: normalized ? 'not_found' : 'empty_path',
        message: normalized ? '路径不存在' : '路径为空'
      })
      continue
    }
    try {
      const result = await callNativeAcl('validateModSourceReadable', normalized)
      if (result?.success === true && result?.readable === true) {
        inspected.push({
          path: target.path,
          type: target.type,
          readable: true,
          currentUserSid: toText(result.currentUserSid)
        })
      } else {
        failures.push(buildNativeAclFailure(target, result, 'source_staging_unreadable'))
      }
    } catch (error) {
      failures.push({
        path: target.path,
        code: toText(error?.code) || 'native_acl_failed',
        message: toText(error?.message) || '原生 ACL 读取验证失败'
      })
    }
  }

  return {
    success: failures.length === 0,
    state: failures.length === 0 ? 'locked' : 'repair_required',
    readable: failures.length === 0,
    targets: inspected,
    failures
  }
}

export async function repairModSourceLock(mod) {
  const unlocked = await unlockModSource(mod)
  if (!unlocked.success) {
    return {
      success: false,
      state: 'repair_required',
      failures: unlocked.failures,
      unlock: unlocked
    }
  }

  const locked = await lockModSource(mod)
  return {
    ...locked,
    state: locked.success ? 'locked' : 'repair_required',
    unlock: unlocked
  }
}

export async function repairModSourceAccessElevated(mod) {
  const id = toModId(mod?.id ?? mod?.mod_id)
  if (!id) {
    return {
      success: false,
      state: 'repair_required',
      targets: [],
      failures: [{ code: 'invalid_id', message: '模组 id 无效' }]
    }
  }
  if (isBoundMod(mod)) {
    return { success: true, state: 'unlocked', targets: [], failures: [], skipped: true }
  }

  const targets = resolveModSourceLockTargets(mod)
  const repaired = []
  const failures = []
  for (const target of targets) {
    const normalized = normalizePath(target.path)
    if (!normalized || !fs.existsSync(normalized)) {
      failures.push({
        path: target.path,
        code: normalized ? 'not_found' : 'empty_path',
        message: normalized ? '路径不存在' : '路径为空'
      })
      continue
    }
    if (isUncPath(normalized)) {
      failures.push({
        path: target.path,
        code: 'unsupported_fs',
        message: 'UNC / 网络路径不支持 ACL 修复'
      })
      continue
    }
    try {
      const result = await callNativeAcl('repairModSourceAccess', normalized)
      if (result?.success === true && result?.restored === true) {
        repaired.push({
          path: target.path,
          type: target.type,
          success: true,
          currentUserSid: toText(result.currentUserSid),
          processedPaths: Number(result.processedPaths || 0)
        })
      } else {
        failures.push(buildNativeAclFailure(target, result, 'acl_owner_repair_failed'))
      }
    } catch (error) {
      failures.push({
        path: target.path,
        code: toText(error?.code) || 'native_acl_failed',
        message: toText(error?.message) || '原生 ACL 所有者修复失败'
      })
    }
  }

  return {
    success: failures.length === 0,
    state: failures.length === 0 ? 'unlocked' : 'repair_required',
    targets: repaired,
    failures,
    partial: repaired.length > 0 && failures.length > 0
  }
}
