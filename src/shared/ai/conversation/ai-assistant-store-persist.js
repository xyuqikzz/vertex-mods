export const AI_ASSISTANT_PERSISTED_PATHS = Object.freeze([
  'currentSessionId',
  'currentSessionTitle',
  'currentContextSnapshot',
  'sessionHistory',
  'deletedSessionIds',
  'messages',
  'candidates',
  'installPlan',
  'selectedModel',
  'selectedModelConfigBasis',
  'selectedMode'
])

export const AI_ASSISTANT_VOLATILE_PATHS = Object.freeze([
  'currentExecutionId',
  'runtimeStatus',
  'availableModels',
  'isLoadingModels',
  'isProcessing',
  'processingPhase',
  'pendingResultCount',
  'submittingPlan',
  'agentTasks',
  'agentTaskLoading',
  'agentTaskActionBusyTaskId'
])

export function createAiAssistantPersistOptions() {
  return {
    pick: [...AI_ASSISTANT_PERSISTED_PATHS]
  }
}

export function resolveAiAssistantModelSelection(options = {}) {
  const selectedModel = String(options?.selectedModel || '').trim()
  const selectedModelConfigBasis = String(options?.selectedModelConfigBasis || '').trim()
  const configuredModel = String(options?.configuredModel || '').trim()

  if (!configuredModel) {
    return {
      selectedModel,
      selectedModelConfigBasis
    }
  }

  const shouldUseConfiguredModel =
    options?.forceConfiguredModel === true ||
    !selectedModel ||
    !selectedModelConfigBasis ||
    selectedModelConfigBasis !== configuredModel

  return {
    selectedModel: shouldUseConfiguredModel ? configuredModel : selectedModel,
    selectedModelConfigBasis: configuredModel
  }
}
