export const trainerMessages = {
  'zh-CN': {
    invalid_trainer_path: '修改器路径无效，请重新下载。',
    untrusted_trainer_file: '该文件不属于已登记的 FLiNG 下载，已拒绝操作。',
    linked_trainer_path: '修改器路径包含链接或目录联接，已拒绝操作。',
    file_not_found: '修改器文件不存在，请重新下载。',
    invalid_executable_extension: '仅允许运行 .exe 修改器文件。',
    invalid_executable_signature: '该文件不是有效的 Windows 可执行文件，请重新下载。',
    executable_file_unreadable: '无法读取修改器文件，请检查文件权限。',
    executable_file_migration_failed: '无法为旧修改器补全 .exe 后缀，请检查文件是否被占用。',
    trainer_file_busy: '修改器文件正在运行或被占用，请关闭后重试。',
    trainer_operation_failed: '修改器文件操作失败，请检查文件权限后重试。',
    trainer_open_failed: '无法启动修改器，请检查文件是否被系统拦截。'
  },
  'en-US': {
    invalid_trainer_path: 'The trainer path is invalid. Download the trainer again.',
    untrusted_trainer_file: 'This file is not a registered FLiNG download. The operation was blocked.',
    linked_trainer_path: 'The trainer path contains a link or directory junction. The operation was blocked.',
    file_not_found: 'The trainer file is missing. Download it again.',
    invalid_executable_extension: 'Only .exe trainer files can be run.',
    invalid_executable_signature: 'This is not a valid Windows executable. Download it again.',
    executable_file_unreadable: 'The trainer file could not be read. Check its permissions.',
    executable_file_migration_failed: 'The .exe extension could not be added. Check whether the trainer file is in use.',
    trainer_file_busy: 'The trainer file is running or in use. Close it and try again.',
    trainer_operation_failed: 'The trainer file operation failed. Check its permissions and try again.',
    trainer_open_failed: 'The trainer could not be started. Check whether it was blocked by the system.'
  }
}

export function trainerFailure(code) {
  return { success: false, errorCode: code, code, messageKey: `trainer.${code}`, messageParams: {} }
}
