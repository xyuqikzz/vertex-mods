import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'

export function normalizeComparablePath(value = '') {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase()
}

export function isPathInside(candidatePath, rootPath) {
  const candidate = normalizeComparablePath(candidatePath)
  const root = normalizeComparablePath(rootPath)
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`)
}

export function assertSafeRemovablePath(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''))
  const parsed = path.parse(resolved)
  if (!resolved || resolved === parsed.root || resolved === path.resolve(os.homedir())) {
    const error = new Error('拒绝清理不安全的缓存路径')
    error.code = 'unsafe_cache_cleanup_path'
    throw error
  }
  return resolved
}

export async function copyDirectoryBounded(sourceDir, targetDir, options = {}) {
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || 16), 32))
  const pending = [{ sourcePath: sourceDir, relativePath: '' }]
  const running = new Set()
  let failure = null
  const result = { size: 0, fileCount: 0, skippedLinkCount: 0 }

  const processEntry = async ({ sourcePath, relativePath }) => {
    const stats = await fs.lstat(sourcePath)
    if (stats.isSymbolicLink()) {
      result.skippedLinkCount += 1
      return
    }

    const targetPath = relativePath ? path.join(targetDir, relativePath) : targetDir
    if (stats.isDirectory()) {
      await fs.ensureDir(targetPath)
      const names = await fs.readdir(sourcePath)
      names.forEach((name) => {
        pending.push({
          sourcePath: path.join(sourcePath, name),
          relativePath: relativePath ? path.join(relativePath, name) : name
        })
      })
      return
    }

    await fs.ensureDir(path.dirname(targetPath))
    await fs.copyFile(sourcePath, targetPath)
    result.size += Number(stats.size || 0)
    result.fileCount += 1
    options.onProgress?.({ ...result, currentPath: sourcePath })
  }

  while ((!failure && pending.length) || running.size) {
    while (!failure && pending.length && running.size < concurrency) {
      const entry = pending.shift()
      // 所有在途写入结束后才能把失败交给上层清理迁移目录。
      const task = processEntry(entry)
        .catch((error) => { failure ||= error })
        .finally(() => running.delete(task))
      running.add(task)
    }
    if (running.size) {
      await Promise.race(running)
    }
  }
  if (failure) throw failure

  return {
    ...result,
    sizeMB: (result.size / (1024 * 1024)).toFixed(2)
  }
}
