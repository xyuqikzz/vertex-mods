import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../i18n/message.js'
import { sanitizeUserApiConfig } from '../../../shared/account/user-config-policy.js'
import { computed, ref } from 'vue'
import { classifyAiAgentError } from '../../../shared/ai/conversation/ai-agent-error.js'
import { resolveAiAgentOutcome } from '../../../shared/ai/conversation/ai-agent-outcome.js'
import { rebaseAssistantSnapshot } from '../../../shared/ai/conversation/ai-assistant-snapshot.js'
import { defineStore } from 'pinia'
import router from '@renderer/router/index.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import {
  formatAiPageContextTitle,
  mergeInstallTaskSummaryIntoContext,
  normalizeInstallTaskSummary
} from '../../../shared/ai/conversation/ai-agent-page-context.js'
import {
  AI_AGENT_AUTHORIZATION_MODES,
  normalizeAiAgentAuthorizationMode
} from '../../../shared/ai/config/ai-agent-config.js'
import {
  AI_AGENT_CHAT_DELTA_CHANNEL,
  AI_AGENT_SESSION_TITLE_CHANNEL,
  invokeAiAgentChatChannel
} from '../../../shared/ipc/ai-agent-ipc-channels.js'
import {
  DEFAULT_AI_AGENT_SESSION_TITLE,
  isDefaultAiAgentSessionTitle,
  normalizeAiAgentSessionTitle
} from '../../../shared/ai/conversation/ai-agent-session-title.js'
import {
  createAiAssistantPersistOptions,
  resolveAiAssistantModelSelection
} from '../../../shared/ai/conversation/ai-assistant-store-persist.js'
import {
  applyAiAgentStreamingDelta,
  finalizeAiAgentStreamingAssistantMessage
} from '../../../shared/ai/conversation/ai-agent-streaming-message.js'
import { buildAiAgentRecoverableContext } from '../../../shared/ai/conversation/ai-agent-recoverable-context.js'
import { buildAiAgentConversationHistory, buildAiAgentToolResultSummary, sanitizeForModel } from '../../../shared/ai/tools/ai-agent-tool-loop.js'
import {
  AUTO_INSTALL_DECISION_MAX_ATTEMPTS,
  buildInstallDecisionPrompt,
  shouldAutoContinueInstallDecision,
  shouldRetryAutoInstallDecision,
  shouldAutoSubmitReadyInstallPlan,
  shouldRequestManualInstallConfirmation
} from '../../../shared/ai/installation/ai-install-decision-auto.js'
import { formatAgentScriptResult } from '../../../shared/ai/tools/ai-agent-script.js'
import {
  canAnalyzeTaskLogs,
  createTaskLogAnalysisPrompt,
  filterInstallRelatedAgentTasks,
  resolveTaskCompletionSummary,
  resolveTaskErrorMessage,
  resolveTaskFailureSummary,
  resolveTaskId,
  resolveTaskLinkedJobId
} from '../component/ai-assistant/agentTaskPanelView.js'

export const AI_ASSISTANT_MODES = Object.freeze([
  {
    value: AI_AGENT_AUTHORIZATION_MODES.SAFE,
    get label() { return uiText('ui.safeMode') },
    get shortLabel() { return uiText('ui.safe') },
    get description() { return uiText('ui.readAndCreatePlansOnly') }
  },
  {
    value: AI_AGENT_AUTHORIZATION_MODES.SEMI_AUTO,
    get label() { return uiText('ui.confirmExecution') },
    get shortLabel() { return uiText('ui.confirm') },
    get description() { return uiText('ui.confirmBeforeExecutingActions') }
  },
  {
    value: AI_AGENT_AUTHORIZATION_MODES.FULL_AUTO,
    get label() { return uiText('ui.fullAccess') },
    get shortLabel() { return uiText('ui.fullAccess') },
    get description() { return uiText('ui.executeAutomaticallyWhenSafetyConstraintsAreMet') }
  }
])

function createId(prefix = 'ai') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createMessage(role, content, extra = {}) {
  return {
    id: createId('msg'),
    role,
    content,
    type: extra.type || 'text',
    createdAt: Date.now(),
    ...extra
  }
}

function createAssistantWindowState(patch = {}) {
  const source = patch && typeof patch === 'object' ? patch : {}
  const taskSummary =
    source.agentTaskSummary && typeof source.agentTaskSummary === 'object'
      ? source.agentTaskSummary
      : {}

  return {
    open: source.open === true,
    visible: source.visible === true,
    focused: source.focused === true,
    dockMode: String(source.dockMode || 'closed').trim() || 'closed',
    dockInset: Math.max(0, Math.round(Number(source.dockInset) || 0)),
    isProcessing: source.isProcessing === true,
    statusLabel: String(source.statusLabel || '').trim(),
    statusTone: String(source.statusTone || '').trim(),
    pendingResultCount: Math.max(0, Number(source.pendingResultCount || 0)),
    agentTaskSummary: {
      total: Math.max(0, Number(taskSummary.total || 0)),
      active: Math.max(0, Number(taskSummary.active || 0)),
      failed: Math.max(0, Number(taskSummary.failed || 0))
    },
    currentSessionTitle: String(source.currentSessionTitle || '').trim(),
    context: sanitizeIpcPayload(source.context || null, null)
  }
}

function invokeAiAgentChat(payload = {}) {
  return invokeAiAgentChatChannel((channel, requestPayload) => {
    return ipcRenderer.invoke(channel, requestPayload)
  }, payload)
}

function normalizeAssistantModelRecord(record = {}) {
  const id = String(record?.id || record?.name || record?.model || '').trim()
  if (!id) return null
  return {
    id,
    name: String(record?.name || record?.id || id).trim() || id
  }
}

function resolveInstallTaskJobId(target = {}) {
  if (!target || typeof target !== 'object') return ''
  return (
    resolveTaskLinkedJobId(target) ||
    String(
      target.linkedJobId ||
        target.linked_job_id ||
        target.sourceInstallTaskId ||
        target.source_install_task_id ||
        target.jobId ||
        target.job_id ||
        target?.result?.jobId ||
        target?.result?.job_id ||
        target?.sourceInstallJob?.jobId ||
        target?.sourceInstallJob?.job_id ||
        ''
    ).trim()
  )
}

function toSafeStoreText(value = '') {
  return String(value ?? '').trim()
}

function toSafeStoreNumber(value = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeNexusApiConfigForAiAssistant(config = {}) {
  const source = sanitizeUserApiConfig(config)
  const apiKey = toSafeStoreText(source.apiKey)
  const apiKeySource = apiKey ? 'local' : ''

  return {
    apiKey,
    apiKeySource,
  }
}

function getObjectField(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function requestSystemConfigSnapshot() {
  return requestSystemConfigSettings({})
}

function getResolvedNexusTarget(source = {}) {
  const metadata = getObjectField(source?.metadata)
  const installPayload = getObjectField(source?.meta?.installPayload || source?.installPayload)
  const item = getObjectField(source?.item || source)
  return {
    domainName: toSafeStoreText(
      metadata.domainName ||
        metadata.gameDomain ||
        metadata.sourceGameDomain ||
        installPayload.sourceGameDomain ||
        installPayload.domainName ||
        item.sourceGameSlug
    ),
    modId: toSafeStoreNumber(
      metadata.modId || metadata.mod_id || installPayload.modId || item.sourceModId,
      0
    ),
    fileId: toSafeStoreNumber(
      metadata.fileId || metadata.file_id || installPayload.fileId || item.sourceFileId,
      0
    )
  }
}

function isSameNexusTarget(entry = {}, resolvedItem = {}) {
  const entryTarget = getResolvedNexusTarget(entry)
  const resolvedTarget = getResolvedNexusTarget(resolvedItem)
  return (
    entryTarget.modId > 0 &&
    entryTarget.fileId > 0 &&
    resolvedTarget.modId === entryTarget.modId &&
    resolvedTarget.fileId === entryTarget.fileId &&
    (!entryTarget.domainName ||
      !resolvedTarget.domainName ||
      entryTarget.domainName === resolvedTarget.domainName)
  )
}

function patchNexusEntryArtifact(entry = {}, resolvedItem = {}) {
  const metadata = getObjectField(resolvedItem?.metadata)
  const downloadUrl = toSafeStoreText(resolvedItem?.downloadUrl || resolvedItem?.download_url)
  const localFile = getObjectField(resolvedItem?.localFile)
  const localFilePath = toSafeStoreText(
    resolvedItem?.localFilePath ||
      resolvedItem?.local_file_path ||
      localFile.path ||
      metadata.localPath ||
      metadata.filePath
  )
  const fileName = toSafeStoreText(metadata.fileName || metadata.file_name || localFile.name)
  const fileSize = toSafeStoreNumber(metadata.fileSize || metadata.file_size || localFile.size, 0)
  const item = getObjectField(entry.item)
  const meta = getObjectField(entry.meta)
  const installPayload = getObjectField(meta.installPayload)

  const nextItem = {
    ...item,
    download_url: downloadUrl || item.download_url || '',
    file_size: fileSize || item.file_size || 0
  }
  const nextInstallPayload = {
    ...installPayload,
    downloadUrl: downloadUrl || installPayload.downloadUrl || '',
    fileSize: fileSize || installPayload.fileSize || 0
  }
  const nextMeta = {
    ...meta,
    fileSize: fileSize || meta.fileSize || 0,
    installPayload: nextInstallPayload
  }

  if (localFilePath) {
    nextItem.filePath = localFilePath
    nextItem.file_path = localFilePath
    nextItem.finalFilePath = localFilePath
    nextMeta.filePath = localFilePath
    nextMeta.archivePath = localFilePath
    nextInstallPayload.filePath = localFilePath
    nextInstallPayload.archivePath = localFilePath
  }
  if (fileName) {
    nextMeta.fileName = fileName
    nextInstallPayload.fileName = fileName
  }

  return {
    ...entry,
    item: nextItem,
    meta: nextMeta
  }
}

function hasReadyNexusArtifact(entry = {}) {
  const item = getObjectField(entry.item)
  const meta = getObjectField(entry.meta)
  const installPayload = getObjectField(meta.installPayload)
  return Boolean(
    toSafeStoreText(item.download_url || installPayload.downloadUrl) ||
      toSafeStoreText(
        item.filePath ||
          item.file_path ||
          item.finalFilePath ||
          meta.filePath ||
          meta.archivePath ||
          installPayload.filePath ||
          installPayload.archivePath
      )
  )
}

function getInstallPlanSnapshotKey(plan = {}) {
  if (!plan || typeof plan !== 'object') return ''
  const payload = getObjectField(plan.sourceInstallTaskPayload || plan.sourceInstallTaskPayloadDraft)
  const firstEntry = Array.isArray(payload.items) ? getObjectField(payload.items[0]) : {}
  const entryItem = getObjectField(firstEntry.item)
  const entryMeta = getObjectField(firstEntry.meta)
  const installPayload = getObjectField(entryMeta.installPayload)
  const source = toSafeStoreText(
    plan.source || plan.sourcePlatform || payload.source || entryItem.sourcePlatform
  ).toLowerCase()
  const identity = toSafeStoreText(
    plan.sourceModId ||
      plan.modId ||
      installPayload.modId ||
      installPayload.modReference ||
      entryItem.sourceModId ||
      plan.modName ||
      plan.name
  ).toLowerCase()
  const version = toSafeStoreText(
    plan.sourceFileId ||
      plan.fileId ||
      installPayload.fileId ||
      entryItem.sourceFileId ||
      plan.version ||
      plan.fileName
  ).toLowerCase()
  return [source, identity, version].filter(Boolean).join(':')
}

function hasSubmittedInstallPlanState(plan = {}) {
  if (!plan || typeof plan !== 'object') return false
  return Boolean(
    plan.submitted === true ||
      plan.completed === true ||
      toSafeStoreText(plan.agentTaskId || plan.taskId || plan.linkedJobId)
  )
}

function shouldKeepCurrentInstallPlanSnapshot(
  currentPlan = null,
  incomingPlan = null,
  sameSession = true
) {
  if (!sameSession || !hasSubmittedInstallPlanState(currentPlan)) return false
  if (hasSubmittedInstallPlanState(incomingPlan)) return false
  if (!incomingPlan) return true
  const currentKey = getInstallPlanSnapshotKey(currentPlan)
  const incomingKey = getInstallPlanSnapshotKey(incomingPlan)
  return Boolean(currentKey && incomingKey && currentKey === incomingKey)
}

const AGENT_TASK_FEEDBACK_STAGES = new Set(['completed', 'failed', 'cancelled', 'rolled_back'])

export const useAiAssistantStore = defineStore(
  'aiAssistantStore',
  () => {
    const currentContextSnapshot = ref({})
    const currentSessionId = ref(createId('session'))
    const currentSessionTitle = ref(DEFAULT_AI_AGENT_SESSION_TITLE)
    const sessionHistory = ref([])
    const messages = ref([])
    const candidates = ref([])
    const installPlan = ref(null)
    const nexusManualDownloadOpen = ref(false)
    const nexusManualDownloadItems = ref([])
    const nexusManualDownloadApiConfig = ref({})
    const nexusManualDownloadPlan = ref(null)
    const nexusManualDownloadPlanId = ref('')
    const runtimeStatus = ref({
      configured: false,
      providerType: '',
      model: '',
      reason: 'unknown'
    })
    const availableModels = ref([])
    const isLoadingModels = ref(false)
    const selectedModel = ref('')
    const selectedModelConfigBasis = ref('')
    const selectedMode = ref('')
    const isProcessing = ref(false)
    const processingPhase = ref('')
    // 当前这一轮智能体正在执行的步骤（工具调用开始/结束实时推送），结束后并入消息的工具记录。
    const liveToolSteps = ref([])
    const pendingResultCount = ref(0)
    const submittingPlan = ref(false)
    const agentTasks = ref([])
    const agentTaskLoading = ref(false)
    const agentTaskActionBusyTaskId = ref('')
    const currentExecutionId = ref('')
    const isCancelling = ref(false)
    const remoteExecution = ref(null)
    const deletedSessionIds = ref([])
    let activeConversation = null
    let synchronizedSnapshot = {}
    let snapshotSync = null
    let snapshotDirty = false
    let streamingSequence = 0
    const assistantWindowState = ref(createAssistantWindowState())
    let processingTimer = null
    let sourceInstallTaskSummaryTimer = null
    let sourceInstallTaskSummarySerial = 0
    let agentTaskRefreshTimer = null
    let agentTaskRequestSerial = 0
    let agentTaskTerminalFeedbackKeys = new Set()
    let latestInstallTaskSnapshot
    let streamingAssistantMessageId = ''
    let streamingExecutionId = ''

    const statusLabel = computed(() => {
      if (isProcessing.value) return uiText('ui.querying')
      return runtimeStatus.value.configured ? uiText('modelSettings.configured') : uiText('dialogs.vamCookie.notSet')
    })
    const statusTone = computed(() => {
      if (isProcessing.value) return 'processing'
      return runtimeStatus.value.configured ? 'ready' : 'warning'
    })
    const assistantWindowOpen = computed(() => assistantWindowState.value.open === true)
    const displayStatusLabel = computed(() =>
      assistantWindowOpen.value
        ? assistantWindowState.value.statusLabel || statusLabel.value
        : statusLabel.value
    )
    const displayStatusTone = computed(() =>
      assistantWindowOpen.value
        ? assistantWindowState.value.statusTone || statusTone.value
        : statusTone.value
    )
    const displayPendingResultCount = computed(() =>
      assistantWindowOpen.value
        ? assistantWindowState.value.pendingResultCount
        : pendingResultCount.value
    )
    const contextTitle = computed(() => formatAiPageContextTitle(currentContextSnapshot.value))
    const agentTaskSummary = computed(() => {
      const tasks = filterInstallRelatedAgentTasks(agentTasks.value)
      return {
        total: tasks.length,
        active: tasks.filter((task) =>
          [
            'queued',
            'analyzing',
            'searching',
            'resolving_dependencies',
            'downloading',
            'inspecting',
            'planning',
            'installing',
            'verifying'
          ].includes(String(task?.stage || '').trim())
        ).length,
        failed: tasks.filter((task) => String(task?.stage || '').trim() === 'failed').length
      }
    })
    const assistantModes = computed(() => AI_ASSISTANT_MODES)
    const hasConversationState = computed(
      () =>
        isProcessing.value ||
        Boolean(remoteExecution.value) ||
        messages.value.length > 0 ||
        sessionHistory.value.length > 0 ||
        candidates.value.length > 0 ||
        Boolean(installPlan.value)
    )
    const effectiveSelectedModel = computed(() =>
      String(selectedModel.value || runtimeStatus.value.model || '').trim()
    )
    const effectiveSelectedMode = computed(() =>
      normalizeAiAgentAuthorizationMode(
        selectedMode.value || runtimeStatus.value?.permissionMode
      )
    )

    function syncPendingResultCount() {
      const pendingCandidates = Array.isArray(candidates.value) ? candidates.value.length : 0
      const pendingPlan = installPlan.value && installPlan.value.submitted !== true ? 1 : 0
      pendingResultCount.value = pendingCandidates + pendingPlan
    }

    function setContextSnapshot(context = {}) {
      currentContextSnapshot.value = sanitizeIpcPayload(
        mergeInstallTaskSummaryIntoContext(context, latestInstallTaskSnapshot),
        {}
      )
    }

    function buildRecoverableChatContext() {
      return sanitizeIpcPayload(
        buildAiAgentRecoverableContext(currentContextSnapshot.value, {
          installPlan: installPlan.value,
          agentTasks: agentTasks.value,
          messages: messages.value,
          candidates: candidates.value
        }),
        {}
      )
    }

    async function refreshRuntimeStatus(options = {}) {
      try {
        const status = await ipcRenderer.invoke('ai-agent:status', {})
        runtimeStatus.value = sanitizeIpcPayload(status, runtimeStatus.value)
        remoteExecution.value = status?.activeExecution || null
        const runtimeMode = normalizeAiAgentAuthorizationMode(status?.permissionMode)
        if (runtimeMode && !selectedMode.value) {
          selectedMode.value = runtimeMode
        }
        const modelSelection = resolveAiAssistantModelSelection({
          selectedModel: selectedModel.value,
          selectedModelConfigBasis: selectedModelConfigBasis.value,
          configuredModel: runtimeStatus.value.model,
          forceConfiguredModel: options?.syncSelectedModel === true
        })
        selectedModel.value = modelSelection.selectedModel
        selectedModelConfigBasis.value = modelSelection.selectedModelConfigBasis
      } catch (error) {
        runtimeStatus.value = {
          configured: false,
          providerType: '',
          model: '',
          reason: String(error?.message || 'status_failed')
        }
      }
    }

    function setSelectedModel(model = '') {
      selectedModel.value = String(model || '').trim()
      selectedModelConfigBasis.value = String(runtimeStatus.value.model || '').trim()
    }

    function setSelectedMode(mode = '') {
      selectedMode.value = normalizeAiAgentAuthorizationMode(mode)
    }

    async function refreshAvailableModels(options = {}) {
      if (isLoadingModels.value) {
        return
      }
      isLoadingModels.value = true
      try {
        const response = await ipcRenderer.invoke('ai-agent:models', {})
        const payload = sanitizeIpcPayload(response, {})
        const models = Array.isArray(payload?.models) ? payload.models : []
        const modelMap = new Map()
        models
          .map((item) => normalizeAssistantModelRecord(item))
          .filter(Boolean)
          .forEach((item) => {
            if (!modelMap.has(item.id)) {
              modelMap.set(item.id, item)
            }
          })
        const configuredModel = String(runtimeStatus.value.model || '').trim()
        if (configuredModel && !modelMap.has(configuredModel)) {
          modelMap.set(configuredModel, {
            id: configuredModel,
            name: configuredModel
          })
        }
        availableModels.value = [...modelMap.values()].sort((left, right) =>
          left.id.localeCompare(right.id)
        )
        if (!selectedModel.value && configuredModel) {
          selectedModel.value = configuredModel
        }
      } catch (error) {
        if (options?.silent !== true) {
          messages.value.push(
            createMessage('assistant', String(error?.message || '模型列表获取失败。'), {
              type: 'warning'
            })
          )
        }
      } finally {
        isLoadingModels.value = false
      }
    }

    function applyInstallTaskSnapshot(summary = {}, options = {}) {
      const nextInstallTask = normalizeInstallTaskSummary(summary)
      latestInstallTaskSnapshot = nextInstallTask
      const previousInstallTask = sanitizeIpcPayload(currentContextSnapshot.value?.installTask, {})
      const changed = JSON.stringify(previousInstallTask) !== JSON.stringify(nextInstallTask)
      if (!changed) {
        return false
      }
      setContextSnapshot({
        ...currentContextSnapshot.value,
        installTask: nextInstallTask
      })
      if (options?.persist !== false) {
        persistCurrentSession()
      }
      return true
    }

    async function refreshInstallTaskSnapshot(options = {}) {
      const requestSerial = ++sourceInstallTaskSummarySerial
      try {
        const summary = await ipcRenderer.invoke('source-install-task:summary', {})
        if (requestSerial !== sourceInstallTaskSummarySerial) return false
        return applyInstallTaskSnapshot(summary, options)
      } catch {
        // 这里静默失败，避免任务摘要读取问题阻断 AI 助手主流程
        if (requestSerial !== sourceInstallTaskSummarySerial) return false
        return false
      }
    }

    function scheduleInstallTaskSnapshotRefresh() {
      if (sourceInstallTaskSummaryTimer) return
      sourceInstallTaskSummaryTimer = setTimeout(() => {
        sourceInstallTaskSummaryTimer = null
        refreshInstallTaskSnapshot()
      }, 300)
    }

    ipcRenderer.on('source-install-task:updated', () => {
      refreshInstallTaskSnapshot()
    })
    ipcRenderer.on('source-install-task:item-updated', scheduleInstallTaskSnapshotRefresh)
    ipcRenderer.on('source-install-task:artifact-updated', scheduleInstallTaskSnapshotRefresh)
    ipcRenderer.on('agent-task:updated', (_event, payload = {}) => {
      applyAgentTaskUpdated(payload)
    })
    ipcRenderer.on('agent-task:log', scheduleAgentTaskRefresh)
    ipcRenderer.on(AI_AGENT_CHAT_DELTA_CHANNEL, (_event, payload = {}) => {
      if (payload.type === 'execution-state') {
        remoteExecution.value = payload.active || null
        if (!payload.active && !activeConversation) isCancelling.value = false
        return
      }
      applyAgentChatDelta(payload)
    })
    ipcRenderer.on('ai-assistant-window:state-changed', (_event, payload = {}) => {
      applyAssistantWindowState(payload)
    })
    ipcRenderer.on('ai-assistant-window:store-snapshot-updated', (_event, payload = {}) => {
      const snapshot = sanitizeIpcPayload(payload?.snapshot || payload, null)
      if (snapshotSync || activeConversation) return
      applyAssistantStoreSnapshot(snapshot, { persist: false })
    })
    ipcRenderer.on('system-config:updated', (_event, payload = {}) => {
      if (payload?.scope && payload.scope !== 'ai-runtime') return
      refreshRuntimeStatus({ syncSelectedModel: true }).then(() => {
        publishAssistantStoreSnapshot({ allowEmpty: true })
        refreshAvailableModels({ silent: true })
      })
    })

    function applyAssistantWindowState(payload = {}) {
      assistantWindowState.value = createAssistantWindowState(sanitizeIpcPayload(payload, {}))
    }

    function publishAssistantWindowState() {
      ipcRenderer.send(
        'ai-assistant-window:update-state',
        sanitizeIpcPayload(
          {
            isProcessing: isProcessing.value,
            statusLabel: statusLabel.value,
            statusTone: statusTone.value,
            pendingResultCount: pendingResultCount.value,
            agentTaskSummary: agentTaskSummary.value,
            currentSessionTitle: currentSessionTitle.value
          },
          {}
        )
      )
    }

    function buildSessionTitle() {
      return normalizeAiAgentSessionTitle(currentSessionTitle.value, DEFAULT_AI_AGENT_SESSION_TITLE)
    }

    function persistAssistantState() {
      try {
        const store = useAiAssistantStore()
        store?.$persist?.()
      } catch {
        // 持久化插件不可用时保留内存态，避免会话流程被打断。
      }
    }

    function createAssistantStoreSnapshot() {
      return sanitizeIpcPayload(
        {
          currentSessionId: currentSessionId.value,
          currentSessionTitle: currentSessionTitle.value,
          currentContextSnapshot: currentContextSnapshot.value,
          sessionHistory: sessionHistory.value,
          messages: messages.value,
          candidates: candidates.value,
          installPlan: installPlan.value,
          selectedModel: selectedModel.value,
          selectedModelConfigBasis: selectedModelConfigBasis.value,
          selectedMode: selectedMode.value,
          deletedSessionIds: deletedSessionIds.value,
          revision: Number(synchronizedSnapshot.revision || 0),
          updatedAt: Date.now()
        },
        {}
      )
    }

    function rebuildAgentTaskTerminalFeedbackKeys() {
      agentTaskTerminalFeedbackKeys = new Set(
        messages.value
          .map((message) => String(message?.agentTaskFeedback?.key || '').trim())
          .filter(Boolean)
      )
    }

    function publishAssistantStoreSnapshot() {
      snapshotDirty = true
      void flushAssistantStoreSnapshot().catch(() => {})
    }

    function flushAssistantStoreSnapshot() {
      if (snapshotSync) return snapshotSync
      snapshotSync = (async () => {
        let conflicts = 0
        while (snapshotDirty) {
          snapshotDirty = false
          const base = synchronizedSnapshot
          const snapshot = createAssistantStoreSnapshot()
          const response = await ipcRenderer.invoke('ai-assistant-window:sync-store-snapshot', sanitizeIpcPayload({
            snapshot, baseRevision: Number(base.revision || 0), allowEmpty: true
          }, {}))
          if (!response?.snapshot) throw new Error(uiText('ui.conversationSyncIsTemporarilyUnavailablePleaseTryAgain'))
          if (response.conflict) {
            if (++conflicts > 3) throw new Error(uiText('ui.thisConversationIsBeingUpdatedInAnotherWindowTryAgain'))
            const rebased = rebaseAssistantSnapshot(base, createAssistantStoreSnapshot(), response.snapshot)
            synchronizedSnapshot = response.snapshot
            applyAssistantStoreSnapshot(rebased, { persist: false, rebased: true })
            snapshotDirty = true
          } else {
            synchronizedSnapshot = response.snapshot
          }
        }
        return synchronizedSnapshot
      })().finally(() => { snapshotSync = null })
      return snapshotSync
    }

    async function syncAssistantStoreSnapshot(options = {}) {
      persistCurrentSession()
      void options
      snapshotDirty = true
      return await flushAssistantStoreSnapshot()
    }

    function applyAssistantStoreSnapshot(snapshot = {}, options = {}) {
      const safeSnapshot = sanitizeIpcPayload(snapshot, {})
      if (!snapshot || !Object.keys(safeSnapshot).length) return false
      if (!options.rebased && Number(safeSnapshot.revision || 0) < Number(synchronizedSnapshot.revision || 0)) return false
      if (!options.rebased) synchronizedSnapshot = safeSnapshot
      deletedSessionIds.value = [...new Set([...deletedSessionIds.value, ...(safeSnapshot.deletedSessionIds || [])])]
      const hasSnapshotField = (field) => Object.prototype.hasOwnProperty.call(safeSnapshot, field)
      const previousSessionId = String(currentSessionId.value || '').trim()

      if (
        hasSnapshotField('currentSessionId') &&
        String(safeSnapshot.currentSessionId || '').trim()
      ) {
        currentSessionId.value = String(safeSnapshot.currentSessionId || '').trim()
      }
      if (hasSnapshotField('currentSessionTitle')) {
        currentSessionTitle.value = normalizeAiAgentSessionTitle(
          safeSnapshot.currentSessionTitle,
          DEFAULT_AI_AGENT_SESSION_TITLE
        )
      }
      if (hasSnapshotField('currentContextSnapshot')) {
        setContextSnapshot(safeSnapshot.currentContextSnapshot)
      }
      if (hasSnapshotField('sessionHistory')) {
        sessionHistory.value = sanitizeIpcPayload(safeSnapshot.sessionHistory, [])
      }
      if (hasSnapshotField('messages')) {
        messages.value = sanitizeIpcPayload(safeSnapshot.messages, [])
      }
      if (hasSnapshotField('candidates')) {
        candidates.value = sanitizeIpcPayload(safeSnapshot.candidates, [])
      }
      if (hasSnapshotField('installPlan')) {
        const incomingPlan = sanitizeIpcPayload(safeSnapshot.installPlan, null)
        const incomingSessionId = String(safeSnapshot.currentSessionId || '').trim()
        const sameSession = !incomingSessionId || incomingSessionId === previousSessionId
        if (!shouldKeepCurrentInstallPlanSnapshot(installPlan.value, incomingPlan, sameSession)) {
          installPlan.value = incomingPlan
        }
      }
      if (hasSnapshotField('selectedModel')) {
        const modelSelection = resolveAiAssistantModelSelection({
          selectedModel: safeSnapshot.selectedModel || selectedModel.value,
          selectedModelConfigBasis: hasSnapshotField('selectedModelConfigBasis')
            ? safeSnapshot.selectedModelConfigBasis
            : '',
          configuredModel: runtimeStatus.value.model
        })
        selectedModel.value = modelSelection.selectedModel
        selectedModelConfigBasis.value = modelSelection.selectedModelConfigBasis
      } else if (hasSnapshotField('selectedModelConfigBasis')) {
        selectedModelConfigBasis.value = String(safeSnapshot.selectedModelConfigBasis || '').trim()
      }
      if (hasSnapshotField('selectedMode')) {
        selectedMode.value = normalizeAiAgentAuthorizationMode(
          safeSnapshot.selectedMode || selectedMode.value
        )
      }
      rebuildAgentTaskTerminalFeedbackKeys()
      syncPendingResultCount()
      if (options?.persist !== false) {
        persistAssistantState()
        publishAssistantStoreSnapshot()
      }
      return true
    }

    async function refreshAssistantStoreSnapshot() {
      try {
        const response = await ipcRenderer.invoke('ai-assistant-window:get-store-snapshot')
        const snapshot = sanitizeIpcPayload(response?.snapshot || response, null)
        return applyAssistantStoreSnapshot(snapshot, { persist: false })
      } catch {
        return false
      }
    }

    function persistCurrentSession() {
      if (!messages.value.length) return
      if (deletedSessionIds.value.includes(currentSessionId.value)) return

      const snapshot = sanitizeIpcPayload(
        {
          id: currentSessionId.value,
          title: buildSessionTitle(),
          updatedAt: Date.now(),
          context: currentContextSnapshot.value,
          messages: messages.value,
          candidates: candidates.value,
          installPlan: installPlan.value
        },
        {}
      )
      const nextHistory = sessionHistory.value.filter((session) => session.id !== snapshot.id)
      sessionHistory.value = [snapshot, ...nextHistory].slice(0, 20)
      persistAssistantState()
      publishAssistantStoreSnapshot()
    }

    function startNewSession(context = currentContextSnapshot.value) {
      persistCurrentSession()
      setContextSnapshot(context)
      currentSessionId.value = createId('session')
      currentSessionTitle.value = DEFAULT_AI_AGENT_SESSION_TITLE
      messages.value = []
      candidates.value = []
      installPlan.value = null
      agentTasks.value = []
      agentTaskTerminalFeedbackKeys = new Set()
      syncPendingResultCount()
      persistAssistantState()
      publishAssistantStoreSnapshot()
      refreshAgentTasks()
    }

    function loadSession(sessionId = '') {
      persistCurrentSession()
      const target = sessionHistory.value.find((session) => session.id === sessionId)
      if (!target) return

      currentSessionId.value = target.id
      currentSessionTitle.value = normalizeAiAgentSessionTitle(
        target.title,
        DEFAULT_AI_AGENT_SESSION_TITLE
      )
      setContextSnapshot(target.context)
      messages.value = sanitizeIpcPayload(target.messages, [])
      candidates.value = sanitizeIpcPayload(target.candidates, [])
      installPlan.value = sanitizeIpcPayload(target.installPlan, null)
      rebuildAgentTaskTerminalFeedbackKeys()
      syncPendingResultCount()
      publishAssistantStoreSnapshot()
      refreshAgentTasks()
    }

    function deleteSession(sessionId = '', context = currentContextSnapshot.value) {
      if (!sessionId) return
      deletedSessionIds.value = [...new Set([...deletedSessionIds.value, sessionId])]
      if (activeConversation?.sessionId === sessionId) void cancelCurrentExecution()

      const shouldResetCurrentSession = currentSessionId.value === sessionId
      sessionHistory.value = sessionHistory.value.filter((session) => session.id !== sessionId)

      if (shouldResetCurrentSession) {
        setContextSnapshot(context)
        currentSessionId.value = createId('session')
        currentSessionTitle.value = DEFAULT_AI_AGENT_SESSION_TITLE
        messages.value = []
        candidates.value = []
        installPlan.value = null
        agentTasks.value = []
        agentTaskTerminalFeedbackKeys = new Set()
        syncPendingResultCount()
        refreshAgentTasks()
      }

      persistAssistantState()
      publishAssistantStoreSnapshot({ allowEmpty: true })
    }

    function normalizeAgentTaskList(result = []) {
      const payload = sanitizeIpcPayload(result, [])
      if (Array.isArray(payload)) return payload
      if (Array.isArray(payload?.records)) return payload.records
      if (Array.isArray(payload?.tasks)) return payload.tasks
      return []
    }

    function resolveAgentTaskSourceJob(task = {}) {
      return sanitizeIpcPayload(task?.result?.sourceInstallJob || task?.sourceInstallJob || {}, {})
    }

    function buildAgentTaskTerminalFeedback(task = {}) {
      const stage = String(task?.stage || '').trim()
      const sourceJob = resolveAgentTaskSourceJob(task)
      const title = String(sourceJob.title || task.currentTarget || '安装任务').trim()
      const completionSummary = resolveTaskCompletionSummary(task)
      const failureSummary = resolveTaskFailureSummary(task)
      const errorMessage = resolveTaskErrorMessage(task)

      if (stage === 'completed') {
        return {
          type: 'success',
          content: [title ? uiText('ui.valueCompleted', { value1: (title) }) : '安装任务已完成。', completionSummary]
            .filter(Boolean)
            .join('\n')
        }
      }
      if (stage === 'failed') {
        return {
          type: 'error',
          content: [
            title ? uiText('ui.valueFailedVariant2', { value1: (title) }) : '安装任务执行失败。',
            failureSummary || errorMessage
          ]
            .filter(Boolean)
            .join('\n')
        }
      }
      if (stage === 'cancelled') {
        return {
          type: 'warning',
          content: title ? uiText('ui.valueCancelled', { value1: (title) }) : '安装任务已取消。'
        }
      }
      if (stage === 'rolled_back') {
        return {
          type: 'success',
          content: [title ? uiText('ui.valueRolledBack', { value1: (title) }) : '安装任务已回滚。', completionSummary]
            .filter(Boolean)
            .join('\n')
        }
      }
      return null
    }

    function hasAgentTaskTerminalFeedback(feedbackKey = '') {
      if (!feedbackKey) return true
      return messages.value.some(
        (message) => String(message?.agentTaskFeedback?.key || '').trim() === feedbackKey
      )
    }

    function appendAgentTaskTerminalFeedback(task = {}) {
      const taskId = resolveTaskId(task)
      const linkedJobId = resolveTaskLinkedJobId(task)
      const stage = String(task?.stage || '').trim()
      if (!taskId || !linkedJobId || !AGENT_TASK_FEEDBACK_STAGES.has(stage)) {
        return false
      }

      const feedbackKey = `${taskId}:${linkedJobId}:${stage}`
      if (
        agentTaskTerminalFeedbackKeys.has(feedbackKey) ||
        hasAgentTaskTerminalFeedback(feedbackKey)
      ) {
        agentTaskTerminalFeedbackKeys.add(feedbackKey)
        return false
      }

      const feedback = buildAgentTaskTerminalFeedback(task)
      if (!feedback?.content) {
        return false
      }

      agentTaskTerminalFeedbackKeys.add(feedbackKey)
      messages.value.push(
        createMessage('assistant', feedback.content, {
          type: feedback.type,
          agentTaskFeedback: {
            key: feedbackKey,
            taskId,
            linkedJobId,
            stage
          }
        })
      )
      syncPendingResultCount()
      persistCurrentSession()
      return true
    }

    async function refreshAgentTasks(options = {}) {
      const requestSerial = ++agentTaskRequestSerial
      if (options?.silent !== true) {
        agentTaskLoading.value = true
      }
      try {
        const result = await ipcRenderer.invoke(
          'agent-task:list',
          sanitizeIpcPayload(
            {
              sessionId: currentSessionId.value,
              limit: 10
            },
            {}
          )
        )
        if (requestSerial !== agentTaskRequestSerial) return false
        agentTasks.value = normalizeAgentTaskList(result)
        return true
      } catch {
        if (requestSerial !== agentTaskRequestSerial) return false
        agentTasks.value = []
        return false
      } finally {
        if (requestSerial === agentTaskRequestSerial) {
          agentTaskLoading.value = false
        }
      }
    }

    async function openInstallTaskDetail(target = {}) {
      const safeTarget = sanitizeIpcPayload(target, {})
      const jobId = resolveInstallTaskJobId(safeTarget)
      if (!jobId) {
        $message.warning(uiMessage('ui.noInstallationTaskIsAvailableToOpen'))
        messages.value.push(
          createMessage('assistant', '暂未找到任务中心关联 ID，请稍后刷新任务状态。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      const currentRoute = router.currentRoute.value
      const routeTarget = {
        path: '/app/game/install-tasks',
        query: {
          jobId
        }
      }
      if (currentRoute?.path === routeTarget.path) {
        const currentJobId = String(currentRoute?.query?.jobId || '').trim()
        if (currentJobId === jobId) {
          return true
        }
        await router.replace(routeTarget)
      } else {
        await router.push(routeTarget)
      }
      return true
    }

    function scheduleAgentTaskRefresh() {
      if (agentTaskRefreshTimer) return
      agentTaskRefreshTimer = setTimeout(() => {
        agentTaskRefreshTimer = null
        refreshAgentTasks({ silent: true })
      }, 300)
    }

    function applyAgentTaskUpdated(payload = {}) {
      const task = sanitizeIpcPayload(payload, null)
      if (!task?.taskId) {
        scheduleAgentTaskRefresh()
        return
      }
      if (task.sessionId && task.sessionId !== currentSessionId.value) {
        return
      }
      const existingIndex = agentTasks.value.findIndex((item) => item.taskId === task.taskId)
      if (existingIndex >= 0) {
        agentTasks.value.splice(existingIndex, 1, task)
      } else {
        agentTasks.value.unshift(task)
      }
      agentTasks.value = agentTasks.value
        .slice()
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        .slice(0, 10)

      appendAgentTaskTerminalFeedback(task)

      const currentPlan = sanitizeIpcPayload(installPlan.value, null)
      const taskPlan = getObjectField(sanitizeIpcPayload(task.plan, {}))
      const taskResult = getObjectField(sanitizeIpcPayload(task.result, {}))
      const taskStandardPreflight = getObjectField(taskResult.standardPreflight)
      if (Object.keys(taskStandardPreflight).length) {
        // 下载完成后的标准预检结果来自 task.result，需要同步回计划卡详情。
        taskPlan.standardPreflight = taskStandardPreflight
      }
      const currentAgentTaskId = String(
        currentPlan?.agentTaskId || currentPlan?.taskId || ''
      ).trim()
      const currentLinkedJobId = resolveInstallTaskJobId(currentPlan || {})
      const taskLinkedJobId = resolveTaskLinkedJobId(task)
      const sameAgentTask = currentAgentTaskId && currentAgentTaskId === task.taskId
      const sameInstallJob =
        currentLinkedJobId && taskLinkedJobId && currentLinkedJobId === taskLinkedJobId
      if (!currentPlan || (!sameAgentTask && !sameInstallJob)) {
        if (
          taskLinkedJobId &&
          ['completed', 'failed', 'cancelled', 'rolled_back'].includes(
            String(task.stage || '').trim()
          )
        ) {
          candidates.value = []
          syncPendingResultCount()
          persistCurrentSession()
        }
        return
      }

      const currentPreflight = JSON.stringify(currentPlan.standardPreflight || {})
      const nextPreflight = JSON.stringify(taskPlan.standardPreflight || {})
      const nextSubmitted = currentPlan.submitted === true || taskPlan.submitted === true
      const taskStage = String(task.stage || '').trim()
      const nextCompleted = taskStage === 'completed'
      const hasTaskLink =
        String(currentPlan.agentTaskId || currentPlan.taskId || '').trim() === task.taskId &&
        currentLinkedJobId === taskLinkedJobId
      if (
        currentPreflight === nextPreflight &&
        nextSubmitted &&
        hasTaskLink &&
        currentPlan.completed === nextCompleted
      ) {
        return
      }
      installPlan.value = {
        ...currentPlan,
        ...taskPlan,
        submitted: true,
        completed: currentPlan.completed === true || nextCompleted,
        agentTaskId: task.taskId || taskPlan.agentTaskId || currentPlan.agentTaskId || '',
        taskId: task.taskId || taskPlan.taskId || currentPlan.taskId || '',
        linkedJobId: taskLinkedJobId || taskPlan.linkedJobId || currentPlan.linkedJobId || ''
      }
      candidates.value = []
      syncPendingResultCount()
      persistCurrentSession()
    }

    function applyAgentTaskRetryResult(result = {}, actionName = '') {
      const agentResult = sanitizeIpcPayload(result?.agentResult, null)
      if (actionName !== 'retry' || !agentResult || typeof agentResult !== 'object') {
        messages.value.push(createMessage('assistant', result.message || 'Agent 任务操作已执行。'))
        return
      }

      if (Array.isArray(agentResult.candidates)) {
        candidates.value = agentResult.candidates
      }
      if (Object.prototype.hasOwnProperty.call(agentResult, 'installPlan')) {
        installPlan.value = agentResult.installPlan || null
      }
      syncPendingResultCount()

      messages.value.push(
        createMessage(
          'assistant',
          result.message || agentResult.assistantMessage || '普通分析任务已重试。',
          {
            toolCalls: Array.isArray(agentResult.toolCalls) ? agentResult.toolCalls : [],
            confirmations: Array.isArray(agentResult.confirmations) ? agentResult.confirmations : []
          }
        )
      )
    }

    async function executeAgentTaskAction(task = {}, action = '') {
      const operationSessionId = currentSessionId.value
      const targetTask = sanitizeIpcPayload(task, {})
      const taskId = String(targetTask.taskId || '').trim()
      const actionName = String(action || '').trim()
      if (!taskId || !actionName || agentTaskActionBusyTaskId.value) {
        return false
      }

      if (actionName === 'rollback') {
        const confirmed = window.confirm('确认回滚该 Agent 任务关联的安装结果？')
        if (!confirmed) return false
      }

      agentTaskActionBusyTaskId.value = taskId
      try {
        const response = await ipcRenderer.invoke(
          `agent-task:${actionName}`,
          sanitizeIpcPayload(
            {
              taskId
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const result = sanitizeIpcPayload(response, {})
        if (result.success) {
          applyAgentTaskRetryResult(result, actionName)
          await refreshAgentTasks()
          await refreshInstallTaskSnapshot({ persist: false })
          persistCurrentSession()
          return true
        }

        appendOperationMessage(operationSessionId,
          createMessage('assistant', result.message || 'Agent 任务操作失败。', {
            type: 'warning'
          })
        )
        await refreshAgentTasks({ silent: true })
        persistCurrentSession()
        return false
      } catch (error) {
        appendOperationMessage(operationSessionId,
          createMessage(
            'assistant',
            uiText('ui.agentTaskOperationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }),
            {
              type: 'warning'
            }
          )
        )
        persistCurrentSession()
        return false
      } finally {
        agentTaskActionBusyTaskId.value = ''
      }
    }

    function cancelAgentTask(task = {}) {
      return executeAgentTaskAction(task, 'cancel')
    }

    function retryAgentTask(task = {}) {
      return executeAgentTaskAction(task, 'retry')
    }

    function rollbackAgentTask(task = {}) {
      return executeAgentTaskAction(task, 'rollback')
    }

    function createPostRollbackActionKey(taskId = '', action = {}, actionType = '') {
      const executionPayload =
        action?.executionPayload && typeof action.executionPayload === 'object'
          ? action.executionPayload
          : {}
      const payloadFingerprint = JSON.stringify({
        id: action?.id || '',
        actionType,
        executionPayload
      })
      return [taskId || 'task', actionType || 'action', payloadFingerprint]
        .join(':')
        .replace(/\s+/g, ' ')
    }

    function findExistingPostRollbackConfirmation(actionKey = '') {
      const safeActionKey = String(actionKey || '').trim()
      if (!safeActionKey) return null
      for (const message of Array.isArray(messages.value) ? messages.value : []) {
        for (const confirmation of Array.isArray(message?.confirmations)
          ? message.confirmations
          : []) {
          if (confirmation?.postRollbackActionKey !== safeActionKey) continue
          const status = String(confirmation.status || 'pending').trim()
          if (['pending', 'approved'].includes(status)) {
            return confirmation
          }
        }
      }
      return null
    }

    function requestPostRollbackRepairAction(payload = {}) {
      const request = sanitizeIpcPayload(payload, {})
      const targetTask = sanitizeIpcPayload(request.task, {})
      const repairAction = sanitizeIpcPayload(request.action, {})
      const executionPayload =
        repairAction.executionPayload && typeof repairAction.executionPayload === 'object'
          ? repairAction.executionPayload
          : {}
      const actionType = String(
        executionPayload.actionType || repairAction.actionType || repairAction.type || ''
      ).trim()
      const taskId = resolveTaskId(targetTask)
      if (!actionType || !repairAction || typeof repairAction !== 'object') {
        messages.value.push(
          createMessage('assistant', '回滚后续动作缺少可执行 payload，暂不能生成确认请求。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      const actionKey = createPostRollbackActionKey(taskId, repairAction, actionType)
      const existingConfirmation = findExistingPostRollbackConfirmation(actionKey)
      if (existingConfirmation) {
        messages.value.push(
          createMessage(
            'assistant',
            existingConfirmation.status === 'approved'
              ? '该回滚后续动作已经确认执行，请等待任务刷新后查看结果。'
              : '该回滚后续动作已有待确认卡片，请先处理现有确认请求。',
            {
              type: 'warning'
            }
          )
        )
        persistCurrentSession()
        return false
      }

      const actionTitle =
        String(repairAction.title || '').trim() ||
        {
          domain_rebuild: '重建部署域账本',
          uninstall_mod: '卸载本地模组记录',
          disable_mod: '禁用本地模组记录'
        }[actionType] ||
        actionType
      const confirmation = {
        id: createId('confirm'),
        get title() { return uiText('ui.confirmFollowUpRollbackAction') },
        description:
          String(repairAction.message || repairAction.reason || '').trim() ||
          uiText('ui.thisOperationChangesLocalModStateOrTheDeploymentLedger'),
        toolName: 'vertex.conflict.execute_repair',
        permissionLevel: 'destructive',
        dangerous: true,
        requiresConfirmation: 'by_policy',
        allowGrant: false,
        postRollbackActionKey: actionKey,
        status: 'pending',
        mode: effectiveSelectedMode.value,
        sessionId: currentSessionId.value,
        createdAt: Date.now(),
        grantContext: {
          toolName: 'vertex.conflict.execute_repair',
          actionType
        },
        args: {
          action: repairAction,
          reason: 'agent_post_rollback_followup',
          sourceAgentTaskId: taskId
        }
      }

      messages.value.push(
        createMessage('assistant', uiText('ui.followUpRollbackActionNeedsConfirmationValue', { value1: (actionTitle) }), {
          confirmations: [confirmation]
        })
      )
      persistCurrentSession()
      return true
    }

    async function analyzeAgentTaskLogs(task = {}) {
      const targetTask = sanitizeIpcPayload(task, {})
      if (!canAnalyzeTaskLogs(targetTask)) {
        messages.value.push(
          createMessage('assistant', '该 Agent 任务没有可定位的安装日志，暂不能自动分析。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      if (isProcessing.value) {
        messages.value.push(
          createMessage('assistant', '当前已有 AI 请求处理中，请稍后再分析日志。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      await sendMessage(createTaskLogAnalysisPrompt(targetTask))
      return true
    }

    function startProcessing(phases = ['正在处理']) {
      if (processingTimer) {
        clearInterval(processingTimer)
        processingTimer = null
      }
      const phaseList = phases.filter(Boolean)
      isProcessing.value = true
      processingPhase.value = phaseList[0] || '正在处理'
    }

    function stopProcessing() {
      if (processingTimer) {
        clearInterval(processingTimer)
        processingTimer = null
      }
      isProcessing.value = false
      processingPhase.value = ''
    }

    function clearInstallPlan() {
      installPlan.value = null
      nexusManualDownloadOpen.value = false
      nexusManualDownloadItems.value = []
      nexusManualDownloadPlan.value = null
      nexusManualDownloadPlanId.value = ''
      syncPendingResultCount()
      persistCurrentSession()
    }

    async function refreshNexusManualDownloadApiConfig() {
      const systemConfig = await requestSystemConfigSnapshot()
      try {
        const { applyEffectiveNexusApiConfig, normalizeNexusApiConfig } = await import(
          '@renderer/utils/nexus-api-config.js'
        )
        const effectiveConfig = await applyEffectiveNexusApiConfig(systemConfig)
        nexusManualDownloadApiConfig.value = normalizeNexusApiConfig(effectiveConfig?.nexusApi)
      } catch {
        nexusManualDownloadApiConfig.value = normalizeNexusApiConfigForAiAssistant(
          systemConfig?.nexusApi
        )
      }
      return nexusManualDownloadApiConfig.value
    }

    async function requestNexusManualDownload(plan = installPlan.value) {
      const targetPlan = sanitizeIpcPayload(plan || installPlan.value, null)
      const items = Array.isArray(targetPlan?.manualDownloadItems)
        ? targetPlan.manualDownloadItems.map((item) => sanitizeIpcPayload(item, {}))
        : []
      if (!targetPlan || !items.length || !targetPlan.sourceInstallTaskPayloadDraft) {
        messages.value.push(
          createMessage('assistant', '当前计划缺少 Nexus 手动授权所需的文件信息。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      nexusManualDownloadPlan.value = targetPlan
      nexusManualDownloadPlanId.value = String(targetPlan.id || '').trim()
      nexusManualDownloadItems.value = items
      await refreshNexusManualDownloadApiConfig()
      nexusManualDownloadOpen.value = true
      return true
    }

    function closeNexusManualDownload() {
      nexusManualDownloadOpen.value = false
    }

    function cancelNexusManualDownload() {
      closeNexusManualDownload()
    }

    function applyNexusManualDownloadResolvedItem(resolvedItem = {}) {
      const targetItem = sanitizeIpcPayload(resolvedItem, null)
      const activePlan =
        installPlan.value &&
        (!nexusManualDownloadPlanId.value ||
          String(installPlan.value.id || '').trim() === nexusManualDownloadPlanId.value)
          ? installPlan.value
          : nexusManualDownloadPlan.value
      const draftPayload = sanitizeIpcPayload(
        activePlan?.sourceInstallTaskPayloadDraft || activePlan?.sourceInstallTaskPayload,
        null
      )
      if (!targetItem || !draftPayload || !Array.isArray(draftPayload.items)) {
        messages.value.push(
          createMessage('assistant', 'Nexus 下载授权已完成，但当前计划草稿已失效。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }
      if (targetItem.canImport === false || toSafeStoreText(targetItem.status) === 'skipped') {
        messages.value.push(
          createMessage('assistant', '已跳过 Nexus 文件，当前计划仍需要可用下载链接或本地文件。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      const shouldPatchFirst = draftPayload.items.length === 1
      const nextItems = draftPayload.items.map((entry) =>
        shouldPatchFirst || isSameNexusTarget(entry, targetItem)
          ? patchNexusEntryArtifact(entry, targetItem)
          : entry
      )
      const nextPayload = {
        ...draftPayload,
        items: nextItems
      }
      const unresolvedManualItems = (
        Array.isArray(activePlan?.manualDownloadItems) ? activePlan.manualDownloadItems : []
      ).filter((item) => !isSameNexusTarget(item, targetItem))
      const allArtifactsReady = nextItems.every((entry) => hasReadyNexusArtifact(entry))
      const nextPlan = allArtifactsReady
        ? {
            ...activePlan,
            sourceInstallTaskPayload: nextPayload,
            sourceInstallTaskPayloadDraft: null,
            manualDownloadItems: [],
            canSubmit: true,
            canDecide: false,
            decisionState: 'ready',
            autoTaskPayloadResolved: true,
            missingDecisionData: [],
            primaryActionText: '加入安装任务',
            targetSummary: '下载文件已就绪',
            precheckText: '已获取 Nexus 下载文件，确认后加入安装任务。',
            riskLevel: 'info',
            riskText: '等待最终确认'
          }
        : {
            ...activePlan,
            sourceInstallTaskPayloadDraft: nextPayload,
            manualDownloadItems: unresolvedManualItems,
            canSubmit: false,
            canDecide: false,
            decisionState: 'needs_nexus_download_authorization',
            primaryActionText: '授权获取下载链接'
          }

      installPlan.value = nextPlan
      nexusManualDownloadPlan.value = nextPlan
      nexusManualDownloadItems.value = allArtifactsReady ? [] : unresolvedManualItems
      if (allArtifactsReady) {
        closeNexusManualDownload()
        messages.value.push(
          createMessage('assistant', 'Nexus 下载授权已完成，确认后将加入安装任务。')
        )
        $message.success(uiMessage('ui.nexusDownloadFilesRetrieved'))
      }
      syncPendingResultCount()
      persistCurrentSession()
      return true
    }

    async function maybeAutoSubmitInstallPlan(message = '', options = {}) {
      const targetPlan = sanitizeIpcPayload(options?.plan || installPlan.value, null)
      if (
        !shouldAutoSubmitReadyInstallPlan({
          message,
          plan: targetPlan,
          autoSubmitEnabled: options?.autoSubmitEnabled === true
        })
      ) {
        return false
      }
      await submitInstallPlan({
        plan: targetPlan,
        autoTriggered: true
      })
      return true
    }

    function shouldSubmitSelectedCandidateInstallPlan(plan = null) {
      const targetPlan = sanitizeIpcPayload(plan, null)
      if (!targetPlan || typeof targetPlan !== 'object') {
        return false
      }
      if (targetPlan.submitted || targetPlan.canSubmit !== true) {
        return false
      }
      if (!targetPlan.sourceInstallTaskPayload) {
        return false
      }
      const riskLevel = String(targetPlan.riskLevel || '')
        .trim()
        .toLowerCase()
      return !riskLevel || ['info', 'ready', 'success'].includes(riskLevel)
    }

    async function submitSelectedCandidateInstallPlan(plan = null) {
      const targetPlan = sanitizeIpcPayload(plan || installPlan.value, null)
      if (!shouldSubmitSelectedCandidateInstallPlan(targetPlan)) {
        return false
      }
      return await submitInstallPlan({
        plan: targetPlan,
        autoTriggered: true
      })
    }

    function resetStreamingAssistantMessage() {
      streamingAssistantMessageId = ''
      streamingExecutionId = ''
      streamingSequence = 0
    }

    async function generateSessionTitleFromFirstMessage(
      userMessage = '',
      assistantMessage = '',
      sessionId = currentSessionId.value
    ) {
      const expectedSessionId = String(sessionId || '').trim()
      const content = String(userMessage || '').trim()
      if (
        !content ||
        !expectedSessionId ||
        expectedSessionId !== currentSessionId.value ||
        !isDefaultAiAgentSessionTitle(currentSessionTitle.value)
      ) {
        return false
      }

      try {
        const response = await ipcRenderer.invoke(
          AI_AGENT_SESSION_TITLE_CHANNEL,
          sanitizeIpcPayload(
            {
              message: content,
              assistantMessage,
              model: effectiveSelectedModel.value
            },
            {}
          )
        )
        if (expectedSessionId !== currentSessionId.value) {
          return false
        }
        const title = normalizeAiAgentSessionTitle(response?.title, '')
        if (!title) {
          return false
        }
        currentSessionTitle.value = title
        persistCurrentSession()
        return true
      } catch {
        return false
      }
    }

    function applyAgentChatDelta(payload = {}) {
      if (!activeConversation) return
      if (activeConversation && payload.executionId !== activeConversation.executionId) return
      if (payload.type === 'phase') {
        if (activeConversation && !isCancelling.value) processingPhase.value = payload.phase || '正在处理'
        return
      }
      if (payload.type === 'step') {
        const step = sanitizeIpcPayload(payload.step, null)
        if (!step?.id) return
        const steps = liveToolSteps.value.filter((item) => item.id !== step.id)
        const index = liveToolSteps.value.findIndex((item) => item.id === step.id)
        if (index >= 0) steps.splice(index, 0, step)
        else steps.push(step)
        liveToolSteps.value = steps.slice(-24)
        return
      }
      const run = activeConversation
      if (run && deletedSessionIds.value.includes(run.sessionId)) return
      const result = applyAiAgentStreamingDelta(
        {
          messages: run?.messages || messages.value,
          streamingAssistantMessageId,
          streamingExecutionId,
          streamingSequence
        },
        payload,
        {
          currentExecutionId: currentExecutionId.value,
          currentSessionId: run?.sessionId || currentSessionId.value
        },
        {
          createId,
          createMessage
        }
      )
      if (run) run.messages = result.messages
      if (!run || currentSessionId.value === run.sessionId) messages.value = result.messages
      streamingAssistantMessageId = result.streamingAssistantMessageId || ''
      streamingExecutionId = result.streamingExecutionId || ''
      streamingSequence = result.streamingSequence || 0
    }

    function appendOrFinalizeAssistantMessage(content = '', extra = {}) {
      const result = finalizeAiAgentStreamingAssistantMessage(
        {
          messages: messages.value,
          streamingAssistantMessageId,
          streamingExecutionId
        },
        content,
        extra,
        {
          createMessage
        }
      )
      if (!result.changed) return
      messages.value = result.messages
      streamingAssistantMessageId = result.streamingAssistantMessageId || ''
      streamingExecutionId = result.streamingExecutionId || ''
    }

    function updateConfirmationStatus(confirmationId = '', patch = {}) {
      const safeConfirmationId = String(confirmationId || '').trim()
      if (!safeConfirmationId) return

      messages.value = messages.value.map((message) => {
        if (!Array.isArray(message.confirmations) || !message.confirmations.length) {
          return message
        }
        return {
          ...message,
          confirmations: message.confirmations.map((item) =>
            item?.id === safeConfirmationId
              ? {
                  ...item,
                  ...patch
                }
              : item
          )
        }
      })
    }

    function appendManualInstallConfirmationMessage(plan = installPlan.value) {
      const targetPlan = sanitizeIpcPayload(plan, {})
      if (targetPlan && Object.keys(targetPlan).length) {
        installPlan.value = {
          ...targetPlan,
          requiresManualConfirmation: true
        }
      }
      syncPendingResultCount()
    }

    async function refreshCurrentPageContext(options = {}) {
      const operationSessionId = currentSessionId.value
      try {
        const response = await ipcRenderer.invoke(
          'ai-assistant-window:sync-context',
          sanitizeIpcPayload(
            {
              requestId: createId('context'),
              reason: options?.reason || 'send-message'
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        if (response?.success !== true) return false

        const context = sanitizeIpcPayload(response.context, null)
        if (!context || typeof context !== 'object') return false

        setContextSnapshot(context)
        if (options?.persist !== false) {
          persistAssistantState()
        }
        return true
      } catch (error) {
        if (options?.silent !== true) {
          console.error('同步 AI 助手上下文失败:', error)
        }
        return false
      }
    }

    function appendOperationMessage(sessionId, message) {
      if (deletedSessionIds.value.includes(sessionId)) return
      if (currentSessionId.value === sessionId) messages.value.push(message)
      else {
        const session = sessionHistory.value.find((item) => item.id === sessionId)
        if (!session) return
        sessionHistory.value = sessionHistory.value.map((item) => item.id === sessionId
          ? { ...item, messages: [...item.messages, message], updatedAt: Date.now() }
          : item)
      }
      persistAssistantState()
      publishAssistantStoreSnapshot()
    }

    function saveConversationResult(run, response) {
      if (deletedSessionIds.value.includes(run.sessionId)) return
      const visible = currentSessionId.value === run.sessionId
      const stored = sessionHistory.value.find((session) => session.id === run.sessionId)
      const outcome = resolveAiAgentOutcome(response)
      const finalized = finalizeAiAgentStreamingAssistantMessage({
        messages: visible ? messages.value : run.messages,
        streamingAssistantMessageId,
        streamingExecutionId: run.executionId
      }, response.assistantMessage || response.error?.message || '', {
        id: `reply-${run.executionId}`, executionId: run.executionId, sessionId: run.sessionId,
        type: outcome === 'failed' ? 'error' : ['partial', 'cancelled'].includes(outcome) ? 'warning' : 'text',
        outcome, error: response.error, stopReason: response.stopReason, canRetry: response.canRetry === true,
        toolCalls: response.toolCalls || [], confirmations: response.confirmations || []
      }, { createMessage })
      const session = {
        ...stored, id: run.sessionId, title: stored?.title || run.title,
        context: run.context, messages: finalized.messages,
        candidates: response.candidates || [], installPlan: response.installPlan || null,
        updatedAt: Date.now()
      }
      sessionHistory.value = [session, ...sessionHistory.value.filter((item) => item.id !== run.sessionId)].slice(0, 20)
      if (visible) {
        messages.value = session.messages
        candidates.value = session.candidates
        installPlan.value = session.installPlan
        syncPendingResultCount()
      }
      run.messages = session.messages
      persistAssistantState()
      publishAssistantStoreSnapshot()
    }

    async function sendMessage(text = '', options = {}) {
      const content = String(text || '').trim()
      if (!content || isProcessing.value || activeConversation || remoteExecution.value) return { accepted: false }
      const run = {
        executionId: createId('exec'), sessionId: currentSessionId.value,
        title: currentSessionTitle.value, context: sanitizeIpcPayload(currentContextSnapshot.value, {}),
        messages: messages.value, sent: false, cancelRequested: false
      }
      activeConversation = run
      currentExecutionId.value = run.executionId
      isCancelling.value = false
      startProcessing(['正在准备请求'])
      let accepted = false
      let shouldGenerateSessionTitle = false
      let assistantMessageForTitle = ''
      try {
        if (!options.retryOfExecutionId) await refreshCurrentPageContext({ reason: 'send-message', silent: true, persist: false })
        if (run.cancelRequested || currentSessionId.value !== run.sessionId || deletedSessionIds.value.includes(run.sessionId)) return { accepted: false }
        run.context = sanitizeIpcPayload(currentContextSnapshot.value, {})
        shouldGenerateSessionTitle = !messages.value.some((message) => message.role === 'user') && isDefaultAiAgentSessionTitle(currentSessionTitle.value)
        const conversationHistory = buildAiAgentConversationHistory(messages.value)
        const recoverableContext = buildRecoverableChatContext()
        const continuationId = String(options.continuation?.confirmationId || '').trim()
        // 自动续跑的提示只给智能体看，对话里不出现一条用户没说过的话。
        const userMessage = createMessage('user', content, {
          executionId: run.executionId,
          ...(continuationId ? { type: 'continuation' } : {})
        })
        run.userMessageId = userMessage.id
        messages.value.push(userMessage)
        run.messages = messages.value
        accepted = true
        liveToolSteps.value = []
        options.onAccepted?.()
        persistCurrentSession()

        // 用户输入的每句话都交给智能体判断：是否安装、装哪一个、是否继续，由它结合上下文与工具结果决定。
        // 候选卡、计划卡上的按钮仍直接执行对应操作。
        await syncAssistantStoreSnapshot()
        if (run.cancelRequested || deletedSessionIds.value.includes(run.sessionId)) return { accepted: true }
        if (currentSessionId.value === run.sessionId) {
          candidates.value = []
          installPlan.value = null
        }
        resetStreamingAssistantMessage()
        processingPhase.value = '正在生成回复'
        run.sent = true
        const response = sanitizeIpcPayload(await invokeAiAgentChat(sanitizeIpcPayload({
          message: content, executionId: run.executionId, sessionId: run.sessionId,
          userMessageId: run.userMessageId, createdAt: userMessage.createdAt,
          context: recoverableContext, history: conversationHistory, useContext: true,
          model: effectiveSelectedModel.value, mode: effectiveSelectedMode.value, stream: true,
          retryOfExecutionId: options.retryOfExecutionId,
          ...(continuationId ? { continuation: { confirmationId: continuationId } } : {})
        }, {})), {})
        if (activeConversation !== run) return { accepted: true }
        if (response.accepted === false) {
          accepted = false
          const remove = (list) => list.filter((message) => message.id !== run.userMessageId)
          if (currentSessionId.value === run.sessionId) messages.value = remove(messages.value)
          run.messages = remove(run.messages)
          sessionHistory.value = sessionHistory.value.map((session) => session.id === run.sessionId ? { ...session, messages: remove(session.messages) } : session)
          $message.warning(response.assistantMessage || '请求尚未开始，请稍后重试。')
          return { accepted: false }
        }
        assistantMessageForTitle = response.assistantMessage || ''
        saveConversationResult(run, response)
        if (currentSessionId.value === run.sessionId && !run.cancelRequested) {
          await refreshAgentTasks({ silent: true })
        }
        return { accepted: true }
      } catch (error) {
        if (accepted && activeConversation === run) {
          console.warn('[AI Assistant] 会话请求异常', JSON.stringify(sanitizeForModel({ name: error?.name, code: error?.code, message: error?.message })))
          const failure = classifyAiAgentError(error)
          saveConversationResult(run, { success: false, error: failure, assistantMessage: failure.message, outcome: run.cancelRequested ? 'cancelled' : 'failed' })
        } else $message.warning(uiMessage('ui.theRequestHasNotStartedPleaseTryAgain'))
        return { accepted }
      } finally {
        if (activeConversation === run) {
          if (accepted && run.cancelRequested && !run.sent && !run.actionStarted) saveConversationResult(run, { success: false, outcome: 'cancelled', assistantMessage: '本轮处理已停止。' })
          activeConversation = null
          currentExecutionId.value = ''
          isCancelling.value = false
          liveToolSteps.value = []
          stopProcessing()
          resetStreamingAssistantMessage()
          if (shouldGenerateSessionTitle && !deletedSessionIds.value.includes(run.sessionId)) await generateSessionTitleFromFirstMessage(content, assistantMessageForTitle, run.sessionId)
          persistCurrentSession()
          try { await syncAssistantStoreSnapshot() } catch { $message.warning(uiMessage('ui.theConversationHasNotSyncedYetItIsRetainedIn')) }
        }
      }
    }

    // 只看同一条回复里的其他确认：更早轮次里用户没处理的卡片不应挡住本次续跑。
    function hasPendingAgentConfirmations(confirmationId = '') {
      const owner = messages.value.find((message) =>
        (Array.isArray(message.confirmations) ? message.confirmations : []).some((item) => item?.id === confirmationId)
      )
      return Boolean(
        owner?.confirmations?.some(
          (item) => item?.id !== confirmationId && (!item?.status || item.status === 'pending')
        )
      )
    }

    // 用户在确认卡上批准的操作执行完后，智能体接着完成原任务（核验、继续剩余步骤、汇报）。
    // 用户取消或确认已失效时不续跑；同一轮还有其他待确认操作时，等全部处理完再续跑。
    function resumeAgentAfterConfirmation(confirmationId = '', result = {}, sessionId = '') {
      const id = String(confirmationId || '').trim()
      if (!id || ['cancelled', 'confirmation_expired'].includes(result?.errorCode)) return false
      setTimeout(() => {
        if (currentSessionId.value !== sessionId || deletedSessionIds.value.includes(sessionId)) return
        if (hasPendingAgentConfirmations(id)) return
        sendMessage('继续完成刚才的任务', { continuation: { confirmationId: id } }).catch(() => {})
      }, 0)
      return true
    }

    async function retryMessage(message = {}) {
      if (!message.canRetry || message.sessionId !== currentSessionId.value) return false
      return sendMessage('重试上次未完成的查询', { retryOfExecutionId: message.executionId })
    }

    async function openAiSettings(error = {}) {
      await ipcRenderer.invoke('ai-assistant-window:open-settings', sanitizeIpcPayload({ section: error?.settingsTarget }, {}))
    }

    async function createInstallPlan(candidate = {}, options = {}) {
      const operationSessionId = currentSessionId.value
      startProcessing(['正在生成安装决策', '正在检查来源信息', '正在整理预检摘要'])
      const autoSubmitWhenReady = options?.autoSubmitWhenReady === true
      const directSubmitWhenReady = options?.directSubmitWhenReady === true
      const installIntentMessage = String(options?.installIntentMessage || '').trim()

      try {
        const payload = sanitizeIpcPayload(
          {
            candidate,
            sessionId: currentSessionId.value,
            context: currentContextSnapshot.value
          },
          {}
        )
        const response = await ipcRenderer.invoke('ai-agent:create-install-plan', payload)
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const plan = sanitizeIpcPayload(response?.plan || response, null)
        installPlan.value = plan
        if (plan) {
          if (directSubmitWhenReady && (await submitSelectedCandidateInstallPlan(plan))) {
            return true
          }
          const manualConfirmationRequired = shouldRequestManualInstallConfirmation({
            message: installIntentMessage,
            plan
          })
          syncPendingResultCount()
          // 决策结果与模组名都由下方安装计划行动条直接呈现，这里不再追加重复的状态文本；
          // 仅在“需用户确认”或“仍在补齐数据”这类需要额外说明的场景下保留一句轻量提示。
          if (manualConfirmationRequired) {
            appendOperationMessage(operationSessionId,
              createMessage('assistant', '安装计划已就绪，确认后将加入安装任务。')
            )
          } else if (plan.decisionState === 'needs_nexus_download_authorization') {
            appendOperationMessage(operationSessionId,
              createMessage('assistant', '需要在 Nexus 网页授权下载链接，点击计划卡按钮继续。')
            )
          } else if (plan.canSubmit === false) {
            appendOperationMessage(operationSessionId, createMessage('assistant', '正在自动补齐安装所需数据，请稍候…'))
          }
          if (shouldAutoContinueInstallDecision(plan)) {
            stopProcessing()
            await continueInstallDecision(plan, {
              autoTriggered: true,
              autoSubmitWhenReady,
              directSubmitWhenReady,
              installIntentMessage
            })
            return true
          }
          if (manualConfirmationRequired) {
            return false
          }
          if (
            autoSubmitWhenReady &&
            (await maybeAutoSubmitInstallPlan(installIntentMessage, {
              plan
            }))
          ) {
            return true
          }
        }
        return false
      } catch (error) {
        appendOperationMessage(operationSessionId,
          createMessage('assistant', uiText('ui.couldNotCreateInstallationPlanValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }), {
            type: 'error'
          })
        )
        return false
      } finally {
        stopProcessing()
        persistCurrentSession()
      }
    }

    async function installCandidate(candidate = {}) {
      return await createInstallPlan(candidate, {
        autoTriggered: true,
        autoSubmitWhenReady: true,
        directSubmitWhenReady: true,
        installIntentMessage: '安装'
      })
    }

    async function continueInstallDecision(plan = installPlan.value, options = {}) {
      const operationSessionId = currentSessionId.value
      const targetPlan = sanitizeIpcPayload(plan, null)
      const autoTriggered = options?.autoTriggered === true
      const autoAttempt = Math.max(0, Number(options?.autoAttempt || 0))
      const autoSubmitWhenReady = options?.autoSubmitWhenReady === true
      const directSubmitWhenReady = options?.directSubmitWhenReady === true
      const installIntentMessage = String(options?.installIntentMessage || '').trim()
      if (!targetPlan || isProcessing.value) return

      const candidate = targetPlan.candidateIdentity || candidates.value.find(
        (item) => item.source === targetPlan.source && item.name === targetPlan.modName
      ) || { source: targetPlan.source, name: targetPlan.modName, version: targetPlan.version }
      // 已保存的旧计划也走当前简短协议，不重放数千字的旧上下文。
      const prompt = buildInstallDecisionPrompt(candidate, currentContextSnapshot.value, targetPlan)

      if (!autoTriggered) {
        appendOperationMessage(operationSessionId,
          createMessage('user', uiText('ui.continueWithAIDecisionValue', { value1: (targetPlan.modName || uiText('ui.modAwaitingConfirmation')) }))
        )
      }
      startProcessing(
        autoTriggered
          ? ['正在自动继续决策', '正在读取来源详情', '正在判断任务数据']
          : ['正在继续安装决策', '正在读取来源详情', '正在判断任务数据']
      )

      try {
        currentExecutionId.value = createId('exec')
        resetStreamingAssistantMessage()
        const recoverableContext = sanitizeIpcPayload(
          buildAiAgentRecoverableContext(currentContextSnapshot.value, {
            installPlan: targetPlan,
            agentTasks: agentTasks.value,
            messages: messages.value,
            candidates: candidates.value
          }),
          {}
        )
        const response = await invokeAiAgentChat(
          sanitizeIpcPayload(
            {
              message: prompt,
              executionId: currentExecutionId.value,
              sessionId: currentSessionId.value,
              context: recoverableContext,
              history: buildAiAgentConversationHistory(messages.value),
              useContext: true,
              model: effectiveSelectedModel.value,
              stream: true
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const normalizedResponse = sanitizeIpcPayload(response, {})
        if (normalizedResponse.assistantMessage) {
          appendOrFinalizeAssistantMessage(normalizedResponse.assistantMessage, {
            error: normalizedResponse.error,
            outcome: normalizedResponse.outcome,
            stopReason: normalizedResponse.stopReason,
            toolCalls: Array.isArray(normalizedResponse.toolCalls)
              ? normalizedResponse.toolCalls
              : [],
            confirmations: Array.isArray(normalizedResponse.confirmations)
              ? normalizedResponse.confirmations
              : []
          })
        }
        if (Array.isArray(normalizedResponse.candidates) && normalizedResponse.candidates.length) {
          candidates.value = normalizedResponse.candidates
        }
        if (normalizedResponse.installPlan) {
          installPlan.value = normalizedResponse.installPlan
        }
        if (normalizedResponse.stopReason === 'context_budget') {
          // 给出明确的设置恢复入口；不自动重复同一份超预算请求。
          installPlan.value = null
          syncPendingResultCount()
          return
        }
        await refreshAgentTasks({ silent: true })
        syncPendingResultCount()
        if (
          autoTriggered &&
          shouldRetryAutoInstallDecision({
            previousPlan: targetPlan,
            currentPlan: installPlan.value,
            attempt: autoAttempt,
            maxAttempts: AUTO_INSTALL_DECISION_MAX_ATTEMPTS
          })
        ) {
          stopProcessing()
          await continueInstallDecision(installPlan.value, {
            autoTriggered: true,
            autoAttempt: autoAttempt + 1,
            autoSubmitWhenReady,
            directSubmitWhenReady,
            installIntentMessage
          })
          return
        }
        if (
          autoTriggered &&
          directSubmitWhenReady &&
          (await submitSelectedCandidateInstallPlan(installPlan.value))
        ) {
          return
        }
        if (
          autoTriggered &&
          shouldRequestManualInstallConfirmation({
            message: installIntentMessage,
            plan: installPlan.value
          })
        ) {
          appendManualInstallConfirmationMessage(installPlan.value)
          return
        }
        if (
          autoTriggered &&
          autoSubmitWhenReady &&
          (await maybeAutoSubmitInstallPlan(installIntentMessage, {
            plan: installPlan.value
          }))
        ) {
          return
        }
      } catch (error) {
        appendOrFinalizeAssistantMessage(
          uiText('ui.aIDecisionCannotContinueValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }),
          { type: 'error' }
        )
      } finally {
        stopProcessing()
        persistCurrentSession()
      }
    }

    async function loadCandidateDetail(candidate = {}) {
      const operationSessionId = currentSessionId.value
      if (!candidate || isProcessing.value) return

      startProcessing(['正在读取模组详情', '正在整理依赖与版本'])
      try {
        const response = await ipcRenderer.invoke(
          'mod-source:detail',
          sanitizeIpcPayload(
            {
              ...candidate,
              context: currentContextSnapshot.value
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const result = sanitizeIpcPayload(response, {})
        if (!result.success || !result.record) {
          appendOperationMessage(operationSessionId,
            createMessage('assistant', result.message || '模组详情暂不可用。', {
              type: 'warning'
            })
          )
          return
        }

        const record = result.record
        candidates.value = candidates.value.map((item) =>
          item.id === candidate.id || item.modId === candidate.modId
            ? {
                ...item,
                ...record,
                detailLoaded: true
              }
            : item
        )
      } catch (error) {
        appendOperationMessage(operationSessionId,
          createMessage('assistant', uiText('ui.couldNotReadDetailsValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }), {
            type: 'error'
          })
        )
      } finally {
        stopProcessing()
        persistCurrentSession()
      }
    }

    async function submitInstallPlan(options = {}) {
      const operationSessionId = currentSessionId.value
      const targetPlan = sanitizeIpcPayload(options?.plan || installPlan.value, null)
      if (!targetPlan || submittingPlan.value) return false

      submittingPlan.value = true
      try {
        const response = await ipcRenderer.invoke(
          'ai-agent:confirm-tool',
          sanitizeIpcPayload(
            {
              confirmationId: targetPlan.confirmationId,
              sessionId: currentSessionId.value
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const result = sanitizeIpcPayload(response, {})
        if (result.success) {
          const linkedJobId = result.jobId || targetPlan.linkedJobId || ''
          installPlan.value = {
            ...targetPlan,
            submitted: true,
            agentTaskId: result.agentTaskId || result.taskId || targetPlan.agentTaskId || '',
            taskId: result.taskId || result.agentTaskId || targetPlan.taskId || '',
            linkedJobId
          }
          candidates.value = []
          syncPendingResultCount()
          await refreshInstallTaskSnapshot()
          await refreshAgentTasks({ silent: true })
          $message.success(uiMessage('modBrowser.queued'))
          appendOperationMessage(operationSessionId,
            createMessage(
              'assistant',
              linkedJobId
                ? '安装任务已提交。可点击“查看任务”查看进度。'
                : '安装任务已提交，任务中心同步后可查看进度。'
            )
          )
          return true
        }

        appendOperationMessage(operationSessionId,
          createMessage('assistant', result.message || '安装任务数据尚未生成，暂不能提交。', {
            type: 'warning'
          })
        )
        return false
      } finally {
        submittingPlan.value = false
        persistCurrentSession()
      }
    }

    async function confirmSourceCredentialAction(targetConfirmation = {}) {
      const confirmationId = String(targetConfirmation.id || '').trim()
      const toolName = String(targetConfirmation.toolName || '').trim()
      const secretInput = sanitizeIpcPayload(targetConfirmation.secretInput, {})
      if (!confirmationId || toolName !== 'vertex.source_credential.configure') return false

      updateConfirmationStatus(confirmationId, {
        status: 'approved',
        approvedAt: Date.now()
      })

      try {
        const response = await ipcRenderer.invoke(
          'ai-agent:confirm-tool',
          sanitizeIpcPayload(
            {
              confirmationId,
              grantScope: targetConfirmation.grantScope,
              sessionId: currentSessionId.value,
              executionId: targetConfirmation.executionId || currentExecutionId.value,
              secretInput
            },
            {}
          )
        )
        const result = sanitizeIpcPayload(response, {})
        if (result.success) {
          updateConfirmationStatus(confirmationId, {
            message: result.message || uiText('ui.sourceAPIKeySaved')
          })
          messages.value.push(createMessage('assistant', result.message || '来源 API Key 已保存。'))
          await refreshRuntimeStatus()
          persistCurrentSession()
          // 授权补齐后，智能体接着完成刚才因缺少凭据而中断的查询。
          resumeAgentAfterConfirmation(confirmationId, result, currentSessionId.value)
          return true
        }

        updateConfirmationStatus(confirmationId, {
          status: 'failed',
          message: result.message || uiText('ui.couldNotSaveSourceAPIKey')
        })
        messages.value.push(
          createMessage('assistant', result.message || '来源 API Key 保存失败。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      } catch (error) {
        const message = uiText('ui.couldNotSaveSourceAPIKeyValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
        updateConfirmationStatus(confirmationId, {
          status: 'failed',
          message
        })
        messages.value.push(createMessage('assistant', message, { type: 'warning' }))
        persistCurrentSession()
        return false
      }
    }

    async function confirmAgentAction(confirmation = {}) {
      const target = sanitizeIpcPayload(confirmation, {})
      if (!target.id || ['approved', 'running', 'completed'].includes(target.status)) return false
      if (target.toolName === 'vertex.source_credential.configure') return confirmSourceCredentialAction(target)
      return confirmGenericAgentToolAction(target)
    }

    async function confirmGenericAgentToolAction(targetConfirmation = {}) {
      const operationSessionId = currentSessionId.value
      const confirmationId = String(targetConfirmation.id || '').trim()
      const toolName = String(targetConfirmation.toolName || '').trim()
      if (!confirmationId) return false
      const isScript = toolName === 'vertex.script.run'
      if (isScript && isProcessing.value) return false
      const scriptExecutionId = isScript ? createId('script') : ''
      if (!toolName) {
        updateConfirmationStatus(confirmationId, {
          status: 'failed',
          message: uiText('ui.theAuthorizationRequestHasNoToolNameExecutionCannotContinue')
        })
        appendOperationMessage(operationSessionId,
          createMessage('assistant', '授权请求缺少工具名，无法继续执行。', {
            type: 'warning'
          })
        )
        persistCurrentSession()
        return false
      }

      updateConfirmationStatus(confirmationId, {
        status: isScript ? 'running' : 'approved',
        approvedAt: Date.now(),
        grantScope: targetConfirmation.grantScope || ''
      })

      if (isScript) {
        currentExecutionId.value = scriptExecutionId
        startProcessing(['正在运行脚本'])
      }
      try {
        const response = await ipcRenderer.invoke(
          'ai-agent:confirm-tool',
          sanitizeIpcPayload(
            {
              confirmationId,
              grantScope: targetConfirmation.grantScope,
              sessionId: currentSessionId.value,
              executionId: scriptExecutionId || targetConfirmation.executionId || currentExecutionId.value,
            },
            {}
          )
        )
        if (currentSessionId.value !== operationSessionId || deletedSessionIds.value.includes(operationSessionId)) return false
        const result = sanitizeIpcPayload(response, {})
        const toolCalls = [{
          name: toolName,
          arguments: buildAiAgentToolResultSummary(targetConfirmation.args),
          success: result.success === true,
          errorCode: result.errorCode,
          message: result.message,
          resultSummary: buildAiAgentToolResultSummary(result)
        }]
        if (isScript) {
          updateConfirmationStatus(confirmationId, {
            status: result.success ? 'completed' : result.errorCode === 'cancelled' ? 'cancelled' : 'failed',
            message: result.message
          })
          appendOperationMessage(operationSessionId, createMessage('assistant', formatAgentScriptResult(result), {
            type: result.success ? undefined : 'warning',
            toolCalls
          }))
          persistCurrentSession()
          resumeAgentAfterConfirmation(confirmationId, result, operationSessionId)
          return result.success === true
        }
        if (result.success) {
          await refreshAgentTasks({ silent: true })
          const grantResult = result.grantResult || null
          if (grantResult?.success === false) {
            appendOperationMessage(operationSessionId, createMessage('assistant', grantResult.message, { type: 'warning' }))
          }
          if (grantResult?.success) {
            updateConfirmationStatus(confirmationId, {
              grantId: grantResult.grant?.id,
              grantScope: targetConfirmation.grantScope || ''
            })
          }
          appendOperationMessage(operationSessionId,
            createMessage('assistant', result.message || '已执行确认的操作。', {
              toolCalls
            })
          )
          persistCurrentSession()
          resumeAgentAfterConfirmation(confirmationId, result, operationSessionId)
          return true
        }

        updateConfirmationStatus(confirmationId, {
          status: 'failed',
          message: result.message || uiText('ui.theConfirmedOperationFailed')
        })
        appendOperationMessage(operationSessionId,
          createMessage('assistant', result.message || '确认的操作执行失败。', {
            type: 'warning',
            toolCalls
          })
        )
        persistCurrentSession()
        resumeAgentAfterConfirmation(confirmationId, result, operationSessionId)
        return false
      } catch (error) {
        const message = uiText('ui.confirmedOperationFailedValue', { value1: (String(error?.message || uiText('tools.unknownError'))) })
        updateConfirmationStatus(confirmationId, {
          status: 'failed',
          message
        })
        appendOperationMessage(operationSessionId, createMessage('assistant', message, { type: 'warning' }))
        persistCurrentSession()
        return false
      } finally {
        if (isScript && currentExecutionId.value === scriptExecutionId) stopProcessing()
      }
    }

    async function cancelAgentConfirmation(confirmation = {}) {
      const targetConfirmation = sanitizeIpcPayload(confirmation, {})
      const confirmationId = String(targetConfirmation.id || '').trim()
      if (!confirmationId) return

      updateConfirmationStatus(confirmationId, {
        status: 'cancelled',
        cancelledAt: Date.now()
      })
      messages.value.push(createMessage('assistant', '已取消本次授权请求。', { type: 'warning' }))
      persistCurrentSession()

      const executionId = String(targetConfirmation.executionId || '').trim()
      try {
        await ipcRenderer.invoke('ai-agent:confirm-tool', sanitizeIpcPayload({
          confirmationId, sessionId: currentSessionId.value, cancel: true
        }, {}))
      } catch (error) {
        console.warn('[AI Assistant] 确认撤销通知失败：', error?.message || error)
      }
      if (executionId) {
        try {
          await ipcRenderer.invoke(
            'ai-agent:cancel',
            sanitizeIpcPayload({ executionId, reason: 'confirmation_rejected' }, {})
          )
        } catch (error) {
          console.warn('[AI Assistant] 拒绝确认时通知主进程取消失败：', error?.message || error)
        }
      }
    }

    async function cancelCurrentExecution() {
      const run = activeConversation
      if (run?.actionStarted) return
      const targetExecutionId = run?.executionId || remoteExecution.value?.executionId || currentExecutionId.value
      if (!targetExecutionId || isCancelling.value) return
      isCancelling.value = true
      if (run) run.cancelRequested = true
      processingPhase.value = '正在停止'
      if (run && !run.sent) return
      try {
        const result = await ipcRenderer.invoke('ai-agent:cancel', sanitizeIpcPayload({ executionId: targetExecutionId }, {}))
        if (result?.success === false) throw new Error(result.message || uiText('ui.theStopRequestWasNotAccepted'))
        // The chat promise/final execution event owns the transition to stopped.
      } catch {
        processingPhase.value = '尚未确认停止，可再次尝试'
        isCancelling.value = false
        if (run) run.cancelRequested = false
      }
    }

    return {
      currentExecutionId,
      isCancelling,
      canCancelExecution: computed(() => Boolean(currentExecutionId.value || remoteExecution.value?.executionId)),
      deletedSessionIds,
      retryMessage,
      openAiSettings,
      currentContextSnapshot,
      currentSessionId,
      currentSessionTitle,
      sessionHistory,
      messages,
      candidates,
      installPlan,
      nexusManualDownloadOpen,
      nexusManualDownloadItems,
      nexusManualDownloadApiConfig,
      runtimeStatus,
      availableModels,
      isLoadingModels,
      selectedModel,
      selectedModelConfigBasis,
      selectedMode,
      isProcessing: computed(() => isProcessing.value || Boolean(remoteExecution.value)),
      processingPhase: computed(() => processingPhase.value || (remoteExecution.value?.cancelRequested ? '正在停止' : remoteExecution.value ? '另一窗口正在处理' : '')),
      liveToolSteps,
      pendingResultCount,
      submittingPlan,
      agentTasks,
      agentTaskLoading,
      agentTaskActionBusyTaskId,
      assistantWindowState,
      assistantWindowOpen,
      agentTaskSummary,
      assistantModes,
      hasConversationState,
      effectiveSelectedModel,
      effectiveSelectedMode,
      statusLabel,
      statusTone,
      displayStatusLabel,
      displayStatusTone,
      displayPendingResultCount,
      contextTitle,
      setContextSnapshot,
      refreshRuntimeStatus,
      refreshAvailableModels,
      refreshCurrentPageContext,
      setSelectedModel,
      setSelectedMode,
      refreshInstallTaskSnapshot,
      refreshAgentTasks,
      openInstallTaskDetail,
      cancelAgentTask,
      retryAgentTask,
      rollbackAgentTask,
      requestPostRollbackRepairAction,
      analyzeAgentTaskLogs,
      applyAssistantWindowState,
      publishAssistantWindowState,
      createAssistantStoreSnapshot,
      publishAssistantStoreSnapshot,
      syncAssistantStoreSnapshot,
      applyAssistantStoreSnapshot,
      refreshAssistantStoreSnapshot,
      persistCurrentSession,
      startNewSession,
      loadSession,
      deleteSession,
      clearInstallPlan,
      sendMessage,
      createInstallPlan,
      installCandidate,
      loadCandidateDetail,
      submitInstallPlan,
      requestNexusManualDownload,
      applyNexusManualDownloadResolvedItem,
      closeNexusManualDownload,
      cancelNexusManualDownload,
      continueInstallDecision,
      confirmAgentAction,
      cancelAgentConfirmation,
      cancelCurrentExecution
    }
  },
  {
    // 仅持久化会话数据；执行态（isProcessing/executionId）与运行时状态不持久化
    persist: createAiAssistantPersistOptions()
  }
)
