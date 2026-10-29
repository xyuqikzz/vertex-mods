import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// 保留原持久化键与记录原文；旧自有云盘队列仅供查看，不自动过期清理或继续安装。
export const useInstallStore = defineStore(
  'installStore',
  () => {
    const waitingInstallList = ref([])
    const taskCount = computed(() => waitingInstallList.value.length)
    const cleanupInstallTasks = () =>
      Array.isArray(waitingInstallList.value) ? waitingInstallList.value : []
    const peekTaskById = (id) =>
      cleanupInstallTasks().find((task) => String(task.taskId) === String(id)) || null
    function removeTask(id) {
      waitingInstallList.value = cleanupInstallTasks().filter(
        (task) => String(task.taskId) !== String(id)
      )
    }
    return {
      waitingInstallList,
      taskCount,
      cleanupInstallTasks,
      peekTaskById,
      getTaskById: peekTaskById,
      removeTask
    }
  },
  { persist: true }
)
