import { ipcMain } from '../../../security/ipc.js'
import { SOURCE_INSTALL_TASK_CHANNELS } from './contracts.js'
import {
  cancelSourceInstallTask,
  clearCompletedSourceInstallTasks,
  createSourceInstallTask,
  deleteSourceInstallTasksByIds,
  getSourceInstallTaskDetail,
  getSourceInstallTaskSummary,
  initSourceInstallTaskOrchestrator,
  listSourceInstallTasks,
  pauseSourceInstallTask,
  performNexusAuthorizationTaskAction,
  resumeSourceInstallTask,
  retrySourceInstallTask
} from './orchestrator.js'
import { recoverSourceInstallTasksOnStartup } from './taskRecovery.js'
import { ensureSourceInstallTaskTables } from './taskStore.js'
import { emitJobUpdated } from './taskEvents.js'
import { runTaskCollectionMutation } from './taskCollectionMutation.js'
import { isThunderstoreStorageMigrationActive } from '../../../services/profiles/thunderstoreStorage.js'

function isThunderstoreTaskPayload(payload = {}) {
  const source = String(payload?.source || payload?.sourceAdapter || '')
    .trim()
    .toLowerCase()
  return source === 'thunderstore'
}

function createTaskCollectionChangeOptions(changeType = '') {
  return {
    changeType,
    onChanged: (result = {}) => {
      emitJobUpdated({
        changeType,
        clearedCount: Number(result?.clearedCount || 0),
        deletedCount: Number(result?.deletedCount || 0)
      })
    }
  }
}

export function sourceInstallTaskIndex() {
  ensureSourceInstallTaskTables()
  recoverSourceInstallTasksOnStartup()
  initSourceInstallTaskOrchestrator()

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.CREATE, async (event, payload = {}) => {
    if (isThunderstoreTaskPayload(payload) && isThunderstoreStorageMigrationActive()) {
      return {
        success: false,
        code: 'thunderstore_storage_busy',
        message: 'Thunderstore 文件正在迁移，请稍后再提交安装任务'
      }
    }
    return await createSourceInstallTask(event, payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.LIST, async (_event, payload = {}) => {
    return listSourceInstallTasks(payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.SUMMARY, async () => {
    return getSourceInstallTaskSummary()
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.DETAIL, async (_event, payload = {}) => {
    return getSourceInstallTaskDetail(payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.PAUSE, async (_event, payload = {}) => {
    return pauseSourceInstallTask(payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.RESUME, async (event, payload = {}) => {
    if (isThunderstoreStorageMigrationActive()) {
      return {
        success: false,
        code: 'thunderstore_storage_busy',
        message: 'Thunderstore 文件正在迁移，请稍后恢复安装任务'
      }
    }
    return await resumeSourceInstallTask(event, payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.CANCEL, async (_event, payload = {}) => {
    return await cancelSourceInstallTask(payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.AUTHORIZATION_ACTION, async (event, payload = {}) => {
    return await performNexusAuthorizationTaskAction(event, payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.RETRY, async (event, payload = {}) => {
    if (isThunderstoreStorageMigrationActive()) {
      return {
        success: false,
        code: 'thunderstore_storage_busy',
        message: 'Thunderstore 文件正在迁移，请稍后重试安装任务'
      }
    }
    return await retrySourceInstallTask(event, payload)
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.CLEAR_COMPLETED, async () => {
    return await runTaskCollectionMutation(
      () => clearCompletedSourceInstallTasks(),
      createTaskCollectionChangeOptions('cleared')
    )
  })

  ipcMain.handle(SOURCE_INSTALL_TASK_CHANNELS.DELETE, async (_event, payload = {}) => {
    return await runTaskCollectionMutation(
      () => deleteSourceInstallTasksByIds(payload),
      createTaskCollectionChangeOptions('deleted')
    )
  })
}
