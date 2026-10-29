import fs from 'fs-extra'
import { compareVersions } from '../../utils/version.js'
import { deleteFileSync, verifyFileMD5 } from '../../utils/fileIntegrity.js'
import {
  deleteFileRecordById,
  findFileRecord,
  getAppFileRecords,
  getFileRecordById
} from '../../db/files/files.js'

// 文件校验和删除属于应用流程；仓储只读写记录，避免导入数据库时加载 IPC。
export function deleteFileById(fileId) {
  const { file_path = '' } = getFileRecordById(fileId)
  deleteFileSync(file_path)
  deleteFileRecordById(fileId)
}

export async function getFileById(file) {
  const record = findFileRecord(file)
  if (!record) return null
  if (compareVersions(file.version, record.version) === 0 && fs.existsSync(record.file_path)) {
    if (await verifyFileMD5(record.file_path, record.md5)) return record.file_path
  }
  deleteFileById(record.id)
  return null
}

export function findAndCleanLowVersion(version) {
  for (const file of getAppFileRecords()) {
    if (compareVersions(version, file.version) !== -1) deleteFileById(file.id)
  }
}
