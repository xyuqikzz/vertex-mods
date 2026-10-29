import { markStartupRecoverableTasks } from './taskStore.js'

export function recoverSourceInstallTasksOnStartup() {
  try {
    markStartupRecoverableTasks()
  } catch (error) {
    console.error('安装任务恢复检查失败', error)
  }
}
