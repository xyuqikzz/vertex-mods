import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useInstallStore } from '@renderer/store/installStore.js'
import {
  buildAiPageContextSnapshot,
  formatAiPageContextTitle
} from '../../../shared/ai/conversation/ai-agent-page-context.js'
import {
  mergeAiPageContextOverride,
  useAiPageContextOverride
} from './ai-page-context-overrides.js'

function summarizeInstallStore(installStore) {
  const tasks = installStore.cleanupInstallTasks()
  const activeTasks = Array.isArray(tasks) ? tasks : []

  return {
    activeCount: activeTasks.length,
    waitingCount: activeTasks.filter((item) =>
      ['WAIT_DOWNLOAD', 'WAIT_SELECT_FILES', 'VERIFYING', 'READY_INSTALL', 'INSTALLING'].includes(
        item.status
      )
    ).length,
    failedCount: activeTasks.filter((item) => item.status === 'FAILED').length
  }
}

export function useAiPageContext() {
  const route = useRoute()
  const installStore = useInstallStore()
  const pageContextOverride = useAiPageContextOverride(route)

  const pageContext = computed(() =>
    mergeAiPageContextOverride(
      buildAiPageContextSnapshot(route, {
        installTaskSummary: summarizeInstallStore(installStore)
      }),
      pageContextOverride.value
    )
  )
  const contextTitle = computed(() => formatAiPageContextTitle(pageContext.value))

  function getSnapshot() {
    return JSON.parse(JSON.stringify(pageContext.value))
  }

  return {
    pageContext,
    contextTitle,
    getSnapshot
  }
}
