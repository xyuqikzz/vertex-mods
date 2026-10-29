import fs from 'node:fs/promises'
import path from 'node:path'

// The persisted record owns the path; renderer input may only select a record and opt in.
export async function deleteRecordedDownload(input, { findRecord, deleteRecord, io = fs }) {
  const id = Number(input?.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('无效的下载记录')
  const record = await findRecord(id)
  if (!record) return { success: true }
  if (input.deleteLocalFile === true) {
    const filePath = String(record.file_path || '')
    if (!path.isAbsolute(filePath)) throw new Error('下载记录中的文件路径无效')
    try {
      const stat = await io.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('仅可删除下载记录对应的普通文件')
      await io.unlink(filePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await deleteRecord(id)
  return { success: true }
}
