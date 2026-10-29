import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createPlanningPathChecker } from '../pathSafety.js'
import { InstallEngineError } from '../installEngineError.js'

const fail = (message) => {
  throw new InstallEngineError('install_engine.lifecycle_recovery_required', message)
}

function createDirectoryReceipt(boundary, directoryOwners) {
  const mutations = []
  const identity = (stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
  const key = (target) => process.platform === 'win32' ? target.toLowerCase() : target
  return {
    async recordCreatedDirectory(target) {
      // Record ownership immediately, even if reading the new directory's identity fails.
      const mutation = { target, kind: 'created', identity: null }
      mutations.push(mutation)
      const stat = await fs.lstat(target)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('新建目录的状态已变化，无法安全建立恢复记录')
      mutation.identity = identity(stat)
      directoryOwners.set(key(target), mutation)
    },
    recordRemovedDirectory(target, stat) {
      const owner = directoryOwners.get(key(target))
      mutations.push({ target, kind: 'removed', mode: stat.mode,
        owner: owner?.identity === identity(stat) ? owner : null })
    },
    async rollback() {
      for (const mutation of [...mutations].reverse()) {
        if (!(await createPlanningPathChecker()(boundary, mutation.target)))
          fail('生命周期恢复目标真实边界已变化')
        if (mutation.kind === 'removed') {
          try {
            await fs.mkdir(mutation.target, { mode: mutation.mode })
            // A later directory action may have removed one created by an earlier step.
            // Transfer ownership only when this rollback actually restores that directory.
            if (mutation.owner) {
              const stat = await fs.lstat(mutation.target)
              if (!stat.isDirectory() || stat.isSymbolicLink()) fail('恢复后的目录状态已变化')
              mutation.owner.identity = identity(stat)
            }
          } catch (error) {
            if (error.code !== 'EEXIST') throw error
            const stat = await fs.lstat(mutation.target)
            if (!stat.isDirectory() || stat.isSymbolicLink())
              fail('原空目录后来已被替换，已保留当前内容')
          }
          continue
        }
        let stat
        try {
          stat = await fs.lstat(mutation.target)
        } catch (error) {
          if (error.code === 'ENOENT') continue
          throw error
        }
        if (!stat.isDirectory() || stat.isSymbolicLink() || mutation.identity !== identity(stat))
          fail('新建目录后来已被替换，已保留当前内容')
        try {
          // Never recursively remove a directory: another action or user may have added files.
          await fs.rmdir(mutation.target)
        } catch (error) {
          if (error.code === 'ENOENT') continue
          if (['ENOTEMPTY', 'EEXIST'].includes(error.code))
            fail('新建目录已包含后续文件，已保留目录及内容')
          throw error
        }
      }
    },
    async commit() {
      mutations.length = 0
    }
  }
}

async function snapshot(root, backupRoot = '') {
  const entries = []
  let bytes = 0
  const pending = [{ full: root, relative: '' }]
  while (pending.length) {
    const { full, relative } = pending.pop()
    let stat
    try {
      stat = await fs.lstat(full)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink()) fail('生命周期目标包含链接，无法安全建立恢复快照')
    if (entries.length >= 4096 || relative.split('/').length > 80)
      fail('生命周期恢复快照超过条目或深度预算')
    if (stat.isDirectory()) {
      entries.push({ relative, kind: 'dir' })
      if (backupRoot) await fs.mkdir(path.join(backupRoot, relative), { recursive: true })
      for (const name of (await fs.readdir(full)).sort().reverse())
        pending.push({
          full: path.join(full, name),
          relative: relative ? `${relative}/${name}` : name
        })
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > 128 * 1024 * 1024) fail('生命周期恢复快照超过 128 MiB 预算')
      const handle = await fs.open(full, 'r')
      const hash = crypto.createHash('sha256')
      let readBytes = 0
      try {
        const buffer = Buffer.alloc(64 * 1024)
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
          if (!bytesRead) break
          readBytes += bytesRead
          if (readBytes > stat.size) fail('生命周期快照读取期间文件发生变化')
          hash.update(buffer.subarray(0, bytesRead))
        }
      } finally {
        await handle.close()
      }
      if (readBytes !== stat.size) fail('生命周期快照读取期间文件大小发生变化')
      entries.push({ relative, kind: 'file', hash: hash.digest('hex') })
      if (backupRoot) {
        const target = relative
          ? path.join(backupRoot, relative)
          : path.join(backupRoot, '__file__')
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(full, target)
      }
    } else fail('生命周期目标不是普通文件或目录')
  }
  return entries
}

export async function captureLifecycleActionReceipt(step, runtime) {
  const choose = (names) => {
    for (const key of names) {
      if (runtime.resolvedPaths?.[key]) return runtime.resolvedPaths[key]
      if (key === 'path' && runtime.resolvedTargetPath) return runtime.resolvedTargetPath
      if (step[key]) return path.resolve(runtime.baseRoot, String(step[key]).replace(/\\/g, '/'))
    }
    return ''
  }
  let targets
  if (['copy_path', 'backup_path'].includes(runtime.action))
    targets = [
      choose([
        'to',
        'target',
        'target_path',
        'targetPath',
        'backup',
        'backup_path',
        'backupPath',
        'path'
      ])
    ]
  else if (['move_path', 'rename_path'].includes(runtime.action))
    targets = [
      choose(['from', 'source', 'source_path', 'sourcePath']),
      choose(['to', 'target', 'target_path', 'targetPath', 'path'])
    ]
  else targets = [choose(['path', 'target', 'target_path', 'targetPath'])]
  targets = [...new Set(targets.filter(Boolean))]
  const boundary = runtime.boundaryRoot || runtime.baseRoot
  for (const target of targets)
    if (!(await createPlanningPathChecker()(boundary, target))) fail('生命周期快照路径越界')
  if (!targets.length) fail('生命周期动作缺少可恢复的目标路径')
  // Directory-only actions record actual mkdir/rmdir results, without reading their contents.
  if (['ensure_dir_exists', 'remove_empty_dir'].includes(runtime.action))
    return createDirectoryReceipt(boundary, runtime.directoryOwners || new Map())
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-lifecycle-receipt-'))
  const records = []
  try {
    for (const [index, target] of targets.entries()) {
      const backup = path.join(backupRoot, String(index))
      const before = await snapshot(target, backup)
      records.push({ target, backup, before, after: null })
    }
  } catch (error) {
    await fs.rm(backupRoot, { recursive: true, force: true })
    throw error
  }
  return {
    async seal() {
      for (const record of records) record.after = await snapshot(record.target)
    },
    async rollback() {
      for (const record of [...records].reverse()) {
        if (!(await createPlanningPathChecker()(boundary, record.target)))
          fail('生命周期恢复目标真实边界已变化')
        if (!record.after) fail('生命周期动作后的状态无法确定，已保留恢复备份')
        const current = await snapshot(record.target)
        if (JSON.stringify(current) === JSON.stringify(record.before)) continue
        if (record.after && JSON.stringify(current) !== JSON.stringify(record.after))
          fail('生命周期目标后来发生变化，保留文件和恢复备份')
        if (JSON.stringify(record.before) === JSON.stringify(record.after)) continue
        // Every recursive delete is of an absolute target just checked against the original boundary.
        await fs.rm(record.target, { recursive: true, force: true })
        if (record.before.length) {
          await fs.mkdir(path.dirname(record.target), { recursive: true })
          if (record.before[0].kind === 'file')
            await fs.copyFile(path.join(record.backup, '__file__'), record.target)
          else await fs.cp(record.backup, record.target, { recursive: true })
        }
      }
      await fs.rm(backupRoot, { recursive: true, force: true })
    },
    async commit() {
      await fs.rm(backupRoot, { recursive: true, force: true })
    }
  }
}
