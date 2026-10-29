import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isPathInside, isRealPathInside } from '../ipc/game/install-engine/pathSafety.js'

const profileLocks = new Map()
const mutationContext = new AsyncLocalStorage()

export async function withThunderstoreProfileMutation(payload, operation) {
  const key = `${String(payload.community || '')
    .trim()
    .toLowerCase()}:${String(payload.profileName || 'default')
    .trim()
    .toLowerCase()}`
  const owner = mutationContext.getStore()
  const existing = profileLocks.get(key)
  if (existing && existing !== owner) {
    throw Object.assign(new Error('当前 Thunderstore 配置正在执行写入，请稍后重试'), {
      code: 'thunderstore_profile_busy'
    })
  }
  if (existing) return operation()
  const token = Symbol(key)
  profileLocks.set(key, token)
  try {
    return await mutationContext.run(token, operation)
  } finally {
    if (profileLocks.get(key) === token) profileLocks.delete(key)
  }
}

function safeChild(root, relative) {
  const target = path.resolve(root, relative)
  if (
    target === path.resolve(root) ||
    !isPathInside(root, target) ||
    !isRealPathInside(root, target)
  ) {
    throw new Error(`模组文件超出安装目录：${relative}`)
  }
  return target
}

// Preparation happens before this function. Only the files in this finite write set are backed up.
// commit must be a single atomic database operation, after every file operation succeeds.
export async function replaceThunderstoreFiles({
  root,
  preparedRoot,
  files,
  obsoleteFiles = [],
  preflight = () => {},
  commit,
  io = fs
}) {
  const entries = new Map()
  for (const relative of [...obsoleteFiles, ...files]) {
    const target = safeChild(root, relative)
    const key = process.platform === 'win32' ? target.toLowerCase() : target
    entries.set(key, { relative, target })
  }
  const writes = new Set(
    files.map((relative) => {
      const target = safeChild(root, relative)
      return process.platform === 'win32' ? target.toLowerCase() : target
    })
  )
  await preflight([...entries.values()].map((entry) => entry.target))
  const backupRoot = await io.mkdtemp(path.join(os.tmpdir(), 'vertex-thunderstore-update-'))
  const changed = []
  let retainBackup = false
  async function replaceFile(source, target) {
    safeChild(root, path.relative(root, target))
    await io.ensureDir(path.dirname(target))
    const temporary = `${target}.${crypto.randomUUID()}.replacing`
    try {
      await io.copyFile(source, temporary)
      await io.rename(temporary, target)
    } finally {
      await io.remove(temporary).catch(() => {})
    }
  }
  try {
    for (const [index, entry] of [...entries.values()].entries()) {
      const stat = await io.lstat(entry.target).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (stat && (!stat.isFile() || stat.isSymbolicLink()))
        throw new Error('安装目标不是普通文件，已中止更新')
      entry.backup = stat ? path.join(backupRoot, String(index)) : ''
      if (entry.backup) await io.copyFile(entry.target, entry.backup)
    }
    await io.writeJson(path.join(backupRoot, 'recovery.json'), {
      root,
      entries: [...entries.values()]
    })
    for (const [key, entry] of entries) {
      if (writes.has(key)) {
        await replaceFile(safeChild(preparedRoot, entry.relative), entry.target)
        changed.push(entry)
      } else if (entry.backup) {
        safeChild(root, entry.relative)
        await io.unlink(entry.target)
        changed.push(entry)
      }
    }
    return await commit()
  } catch (error) {
    const recoveryErrors = []
    for (const entry of [...changed].reverse()) {
      try {
        if (entry.backup) await replaceFile(entry.backup, entry.target)
        else {
          safeChild(root, entry.relative)
          await io.unlink(entry.target)
        }
      } catch (failure) {
        recoveryErrors.push({ path: entry.target, message: failure.message })
      }
    }
    if (recoveryErrors.length) {
      retainBackup = true
      error.needRecovery = true
      error.recoveryPath = backupRoot
      error.recoveryErrors = recoveryErrors
      error.message = `更新失败且部分文件未能恢复，恢复资料已保留：${error.message}`
    }
    throw error
  } finally {
    if (!retainBackup) await io.remove(backupRoot).catch(() => {})
  }
}
