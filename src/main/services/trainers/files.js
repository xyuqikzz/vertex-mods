import fs from 'node:fs'
import { assertTrainerFileAccess } from './filePolicy.js'
import { ensureFlingTrainerExecutable } from './executable.js'
import { trainerFailure } from '../../../shared/i18n/trainer-messages.js'

// 仓储与系统启动能力由 IPC 适配层注入；所有操作共享同一文件归属校验。
export function createTrainerFileService({ getRecords, updateRecordPath, openPath }) {
  const authorize = filePath => assertTrainerFileAccess(filePath, getRecords())
  const guarded = operation => async filePath => {
    try { return await operation(authorize(filePath)) } catch (error) {
      const code = ['invalid_trainer_path', 'untrusted_trainer_file', 'linked_trainer_path'].includes(error.code)
        ? error.code : ['EBUSY', 'EPERM', 'EACCES'].includes(error.code) ? 'trainer_file_busy' : 'trainer_operation_failed'
      return { ...trainerFailure(code), locked: code === 'trainer_file_busy' }
    }
  }
  return {
    removeFileIfUnlocked: guarded(async ({ filePath, exists }) => {
      if (exists) await fs.promises.unlink(filePath)
      return { success: true, locked: false, removed: exists }
    }),
    checkFileUnlocked: guarded(async ({ filePath, exists }) => {
      if (exists) {
        // 不通过移动文件测试占用，避免预检自身留下改名文件。
        const file = await fs.promises.open(filePath, 'r+')
        await file.close()
      }
      return { success: true, locked: false }
    }),
    runFile: guarded(async ({ filePath, exists }) => {
      if (!exists) return trainerFailure('file_not_found')
      const executable = await ensureFlingTrainerExecutable(filePath)
      if (!executable.success) return executable
      if (executable.migrated) {
        try {
          const result = await updateRecordPath(executable.previousFilePath, executable.filePath, 'exe')
          if (!result?.changes) throw new Error('trainer_record_changed')
        } catch (error) {
          // 回滚不能覆盖期间在旧路径创建的新文件；失败时保留已迁移文件供恢复。
          await fs.promises.link(executable.filePath, executable.previousFilePath)
          await fs.promises.unlink(executable.filePath)
          throw error
        }
      }
      authorize(executable.filePath)
      const message = await openPath(executable.filePath)
      return message ? trainerFailure('trainer_open_failed') : {
        success: true, message: '', filePath: executable.filePath, migrated: executable.migrated
      }
    })
  }
}
