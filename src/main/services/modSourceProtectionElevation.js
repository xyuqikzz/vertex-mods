import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { launchElevatedByNodeApi } from '../api/process/index.js'
import { getModDataByRowId, updateModSourceLockState } from '../db/mods/mods.js'
import { repairModSourceAccessElevated, resolveModSourceLockTargets } from './modSourceFileLock.js'
import { isRepairRequestPath, validateRepairRequest } from '../security/elevationPolicy.js'
import userPath from '../initPath.js'
import store from '../storage/store/index.js'

const HELPER_ARG = '--vertex-mod-source-acl-repair='
const HELPER_DIRECTORY_NAME = 'vertex-source-acl-repair'
const MAX_REPAIR_MODS = 500
const REPAIR_TIMEOUT_MS = 2 * 60 * 1000

function toModId(value) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function normalizeRequestIds(mods = []) {
  return [
    ...new Set(
      (Array.isArray(mods) ? mods : []).map((mod) => toModId(mod?.id ?? mod)).filter(Boolean)
    )
  ].slice(0, MAX_REPAIR_MODS)
}

function resolveHelperDirectory() {
  return path.resolve(app.getPath('temp'), HELPER_DIRECTORY_NAME)
}

function resolveResultPath(requestPath) {
  return `${requestPath}.result.json`
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function isAllowedRepairTarget(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''))
  const parsed = path.parse(resolved)
  if (!resolved || resolved === parsed.root) return false
  const protectedRoots = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean)
  if (protectedRoots.some(root => isPathInside(root, resolved))) return false
  const roots = [userPath, store.get('systemConfig.settings.cachePath'), path.join(parsed.root, 'ModManagerData')].filter(Boolean)
  if (!roots.some(root => isPathInside(root, resolved) && path.resolve(root) !== resolved)) return false
  // Reparse points must not turn an allowed staging path into a protected target.
  let cursor = resolved
  while (cursor !== path.parse(cursor).root) {
    const stat = await fs.lstat(cursor)
    if (stat.isSymbolicLink()) return false
    cursor = path.dirname(cursor)
  }
  const segments = resolved
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const stagingIndex = segments.lastIndexOf('staging')
  return stagingIndex >= 0 && segments.length >= stagingIndex + 2
}

function buildLaunchArgs(requestPath) {
  const helperArg = `${HELPER_ARG}${requestPath}`
  return app.isPackaged ? [helperArg] : [app.getAppPath(), helperArg]
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
}

function waitForElevatedHelper(requestPath) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const timeout = setTimeout(
      () => finish({ success: false, code: 'source_protection_repair_timeout' }),
      REPAIR_TIMEOUT_MS
    )

    let launchResult
    try {
      launchResult = launchElevatedByNodeApi(
        process.execPath,
        buildLaunchArgs(requestPath),
        async (event = {}) => {
          if (event?.event === 'start_failed') {
            finish({
              success: false,
              code: 'source_protection_elevation_failed',
              message: String(event?.message || '无法启动源文件保护修复程序')
            })
            return
          }
          if (event?.event !== 'closed') return
          try {
            const result = await readJsonFile(resolveResultPath(requestPath))
            finish(result)
          } catch (error) {
            finish({
              success: false,
              code: 'source_protection_repair_result_missing',
              message: String(error?.message || '源文件保护修复结果不可用')
            })
          }
        }
      )
    } catch (error) {
      finish({
        success: false,
        code: 'source_protection_elevation_failed',
        message: String(error?.message || '无法启动源文件保护修复程序')
      })
      return
    }

    if (launchResult?.ok === false) {
      const errorCode = Number(launchResult?.errorCode || 0)
      finish({
        success: false,
        code:
          errorCode === 1223
            ? 'source_protection_elevation_cancelled'
            : 'source_protection_elevation_failed',
        win32Error: errorCode,
        message:
          errorCode === 1223
            ? '已取消源文件保护修复，批量操作未执行'
            : String(launchResult?.error || '无法启动源文件保护修复程序')
      })
    }
  })
}

export function getElevatedModSourceRepairRequestPath(argv = process.argv) {
  const arg = (Array.isArray(argv) ? argv : []).find((item) =>
    String(item || '').startsWith(HELPER_ARG)
  )
  return arg ? String(arg).slice(HELPER_ARG.length).trim() : ''
}

export async function requestElevatedModSourceRepair(mods = []) {
  const ids = normalizeRequestIds(mods)
  if (!ids.length) {
    return { success: true, repairedIds: [] }
  }

  const helperDirectory = resolveHelperDirectory()
  await fs.mkdir(helperDirectory, { recursive: true })
  const helperDirectoryStats = await fs.lstat(helperDirectory)
  if (!helperDirectoryStats.isDirectory() || helperDirectoryStats.isSymbolicLink()) {
    return {
      success: false,
      code: 'source_protection_request_directory_invalid',
      message: '源文件保护修复临时目录不安全'
    }
  }
  const requestPath = path.join(helperDirectory, `${randomUUID()}.json`)
  const resultPath = resolveResultPath(requestPath)
  await writeJsonFile(requestPath, { version: 1, operation: 'restore_writable', ids, createdAt: Date.now() })
  try {
    return await waitForElevatedHelper(requestPath)
  } finally {
    await Promise.all([
      fs.rm(requestPath, { force: true }).catch(() => {}),
      fs.rm(resultPath, { force: true }).catch(() => {})
    ])
  }
}

export async function runElevatedModSourceRepairHelper(requestPath = '') {
  const helperDirectory = resolveHelperDirectory()
  const safeRequestPath = path.resolve(String(requestPath || ''))
  if (!isRepairRequestPath(helperDirectory, safeRequestPath)) {
    return { success: false, code: 'source_protection_request_invalid' }
  }
  const resultPath = resolveResultPath(safeRequestPath)
  let result
  let safeToWriteResult = false
  try {
    if (
      !isPathInside(helperDirectory, safeRequestPath) ||
      path.extname(safeRequestPath) !== '.json'
    ) {
      throw Object.assign(new Error('ACL 修复请求路径无效'), {
        code: 'source_protection_request_invalid'
      })
    }
    const helperDirectoryStats = await fs.lstat(helperDirectory)
    const requestStats = await fs.lstat(safeRequestPath)
    if (
      !helperDirectoryStats.isDirectory() ||
      helperDirectoryStats.isSymbolicLink() ||
      !requestStats.isFile() ||
      requestStats.isSymbolicLink() || requestStats.size > 65536
    ) {
      throw Object.assign(new Error('ACL 修复请求文件不安全'), {
        code: 'source_protection_request_invalid'
      })
    }
    safeToWriteResult = true
    const request = await readJsonFile(safeRequestPath)
    const ids = validateRepairRequest(request)

    const repairedIds = []
    const failures = []
    for (const id of ids) {
      const mod = getModDataByRowId(id)
      if (!mod) {
        failures.push({ id, code: 'mod_not_found', message: '未找到模组记录' })
        continue
      }
      const targets = resolveModSourceLockTargets(mod)
      const checks = await Promise.all(targets.map(target => isAllowedRepairTarget(target?.path)))
      const invalidTarget = targets.find((_target, index) => !checks[index])
      if (!targets.length || invalidTarget) {
        failures.push({
          id,
          code: 'source_protection_path_not_allowed',
          path: invalidTarget?.path || '',
          message: '仅允许修复 Vertex staging 内的模组源目录'
        })
        continue
      }
      const repair = await repairModSourceAccessElevated(mod)
      if (!repair?.success) {
        failures.push({ id, code: 'source_protection_repair_failed', repair })
        updateModSourceLockState(id, 'repair_required')
        continue
      }
      updateModSourceLockState(id, 'unlocked')
      repairedIds.push(id)
    }
    result = {
      success: failures.length === 0,
      code: failures.length ? 'source_protection_repair_failed' : 'ok',
      repairedIds,
      failures
    }
  } catch (error) {
    result = {
      success: false,
      code: String(error?.code || 'source_protection_repair_failed'),
      message: String(error?.message || error)
    }
  }

  if (safeToWriteResult) await fs.writeFile(resultPath, JSON.stringify(result), { encoding: 'utf8', flag: 'wx' })
  return result
}
