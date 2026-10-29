import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { safeJoin, fileHash, atomicWrite, fail } from './files.js'

// A persisted write-ahead manifest. Roots are derived from main-process bindings,
// never from renderer-supplied deployment paths.
export async function deployFiles({
  root,
  backupRoot,
  files,
  journal,
  persist,
  beforeWrite = async () => {}
}) {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(backupRoot, { recursive: true })
  journal.state = 'deploying'
  journal.files ||= []
  journal.directories ||= []
  persist()
  try {
    for (const file of files) {
      const target = await safeJoin(root, file.target)
      const disabling = file.operation === 'disable'
      const data = disabling
        ? null
        : file.content === undefined
          ? await fs.readFile(file.source)
          : Buffer.from(file.content)
      // A disabled file's installed state is absence. The same hash-based
      // recovery then restores its backup and preserves any subsequently added file.
      const sha256 = disabling ? null : createHash('sha256').update(data).digest('hex')
      if (file.sha256 && file.sha256 !== sha256)
        fail('asset_hash_mismatch', '部署前组件完整性校验失败')
      const beforeHash = await fileHash(target)
      if (Object.hasOwn(file, 'expectedBeforeHash') && file.expectedBeforeHash !== beforeHash)
        fail('preview_changed', '安装预览后目标文件已变化，请重新查看清单')
      if (disabling && !beforeHash) fail('preview_changed', '待停用的文件已不存在，请重新查看清单')
      const backup = beforeHash ? `${randomUUID()}.bak` : null
      const record = {
        path: file.target,
        component: file.component,
        kind: disabling
          ? 'disabled'
          : file.content !== undefined
            ? 'config'
            : beforeHash
              ? 'replaced'
              : 'added',
        beforeHash,
        sha256,
        backup,
        state: 'planned'
      }
      journal.files.push(record)
      persist()
      const missing = []
      let dir = path.dirname(target)
      while (dir !== root) {
        try {
          await fs.access(dir)
          break
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        missing.unshift(path.relative(root, dir))
        dir = path.dirname(dir)
      }
      for (const relative of missing) {
        if (!journal.directories.includes(relative)) {
          journal.directories.push(relative)
          persist()
        }
        await fs.mkdir(await safeJoin(root, relative), { recursive: true })
      }
      if (backup) {
        await fs.copyFile(target, await safeJoin(backupRoot, backup), fs.constants.COPYFILE_EXCL)
        if ((await fileHash(path.join(backupRoot, backup))) !== beforeHash)
          fail('backup_failed', '原文件备份校验失败')
      }
      record.state = 'backed-up'
      persist()
      await beforeWrite(record)
      if ((await fileHash(target)) !== beforeHash)
        fail('deployment_conflict', '部署期间文件已被其他程序修改')
      if (disabling) await fs.unlink(target)
      else await atomicWrite(target, data)
      record.state = 'deployed'
      persist()
    }
    journal.state = 'deployed'
    persist()
  } catch (error) {
    journal.state = 'pending-restore'
    persist()
    await restoreFiles({ root, backupRoot, journal, persist })
    throw error
  }
}

export async function restoreFiles({ root, backupRoot, journal, persist }) {
  const failures = []
  for (const file of [...(journal.files || [])].reverse()) {
    if (['restored', 'preserved-config'].includes(file.state)) continue
    try {
      const target = await safeJoin(root, file.path)
      const current = await fileHash(target)
      if (current === file.beforeHash) {
        file.state = 'restored'
        persist()
        continue
      }
      if (current !== (file.restoreHash || file.sha256))
        fail('restore_conflict', '文件已被修改，保留当前文件及备份')
      if (file.beforeHash) {
        const backup = await safeJoin(backupRoot, file.backup)
        if ((await fileHash(backup)) !== file.beforeHash)
          fail('backup_invalid', '备份缺失或校验失败')
        await atomicWrite(target, await fs.readFile(backup))
      } else await fs.unlink(target)
      file.state = 'restored'
      persist()
    } catch (error) {
      file.error = error.code || 'restore_failed'
      failures.push({ path: file.path, code: file.error })
      persist()
    }
  }
  for (const relative of [...(journal.directories || [])].reverse()) {
    try {
      await fs.rmdir(await safeJoin(root, relative))
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code))
        failures.push({ path: relative, code: error.code })
    }
  }
  journal.state = failures.length ? 'restore-failed' : 'restored'
  journal.failures = failures
  persist()
  return { restored: !failures.length, failures }
}
