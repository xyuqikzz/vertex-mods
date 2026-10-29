<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CloseOutlined, DeleteOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons-vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { $message } from '@renderer/common/message.js'
import AiAssistantInput from '@renderer/component/ai-assistant/AiAssistantInput.vue'
import AiAssistantMessageList from '@renderer/component/ai-assistant/AiAssistantMessageList.vue'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useAiAssistantStore } from '@renderer/store/aiAssistantStore.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { getAiPageQuickSuggestions } from '../../../../shared/ai/conversation/ai-agent-page-context.js'

const aiAssistantStore = useAiAssistantStore()
const historyMenuRef = ref(null)
const deletingSessionId = ref('')

const sidecarTitle = computed(
  () => String(aiAssistantStore.currentSessionTitle || '').trim() || '新对话'
)
const recentSessions = computed(() => aiAssistantStore.sessionHistory.slice(0, 8))
// 停靠形态决定外框：并排时完整描边，停靠进主窗口内容区时只保留与主界面相邻的左侧分隔线。
const dockModeClass = computed(() => {
  const mode = String(aiAssistantStore.assistantWindowState.dockMode || '')
  return ['embedded', 'overlay'].includes(mode) ? `is-dock-${mode}` : 'is-dock-attached'
})
const quickSuggestions = computed(() =>
  getAiPageQuickSuggestions(aiAssistantStore.currentContextSnapshot || {}).slice(0, 3)
)
const isChatEmpty = computed(
  () =>
    !aiAssistantStore.messages.filter((message) => message?.type !== 'context').length &&
    !aiAssistantStore.candidates.length &&
    !aiAssistantStore.installPlan &&
    !aiAssistantStore.isProcessing
)

function applyContextPayload(payload = {}) {
  const safePayload = sanitizeIpcPayload(payload, {})
  if (!safePayload?.context) return false
  aiAssistantStore.setContextSnapshot(safePayload.context)
  if (!aiAssistantStore.hasConversationState) {
    aiAssistantStore.startNewSession(safePayload.context)
  }
  return true
}

async function bootstrapSidecar() {
  await aiAssistantStore.refreshAssistantStoreSnapshot()
  try {
    const state = await ipcRenderer.invoke('ai-assistant-window:state')
    aiAssistantStore.applyAssistantWindowState(state)
  } catch (error) {
    console.error('读取 AI 助手窗口状态失败:', error)
  }

  await aiAssistantStore.refreshRuntimeStatus()
  await aiAssistantStore.refreshAvailableModels({ silent: true })
  await aiAssistantStore.refreshInstallTaskSnapshot()
  await aiAssistantStore.refreshAgentTasks()
  if (!aiAssistantStore.hasConversationState) {
    aiAssistantStore.startNewSession({})
  }
  await aiAssistantStore.syncAssistantStoreSnapshot()
  aiAssistantStore.publishAssistantWindowState()
}

function startNewChat() {
  aiAssistantStore.startNewSession({})
  closeHistoryMenu()
}

function openHistorySession(sessionId = '') {
  aiAssistantStore.loadSession(sessionId)
  closeHistoryMenu()
}

function deleteHistorySession(sessionId = '') {
  deletingSessionId.value = sessionId
}

function confirmDeleteSession() {
  aiAssistantStore.deleteSession(deletingSessionId.value)
  deletingSessionId.value = ''
  return true
}

function closeHistoryMenu() {
  if (historyMenuRef.value) {
    historyMenuRef.value.open = false
  }
}

function handleDocumentPointerDown(event) {
  const menu = historyMenuRef.value
  if (menu?.open && !menu.contains(event.target)) closeHistoryMenu()
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape' || !historyMenuRef.value?.open) return
  closeHistoryMenu()
  historyMenuRef.value.querySelector('summary')?.focus()
}

function sendSuggestion(text = '') {
  if (aiAssistantStore.isProcessing) return
  aiAssistantStore.sendMessage(text)
}

function closeSidecar() {
  ipcRenderer.invoke('ai-assistant-window:close').catch((error) => {
    console.error('关闭 AI 助手窗口失败:', error)
  })
}

async function openAiSettings() {
  try {
    const result = await ipcRenderer.invoke('ai-assistant-window:open-settings')
    if (!result?.success) throw new Error(uiText('ui.theMainWindowIsTemporarilyUnavailable'))
  } catch (error) { $message.error(error.message || '打开设置失败') }
}

async function requestNexusManualDownloadInMainWindow(plan = null) {
  try {
    const targetPlan = sanitizeIpcPayload(plan || aiAssistantStore.installPlan, null)
    const storeSnapshot = await aiAssistantStore.syncAssistantStoreSnapshot({ allowEmpty: true })
    const response = await ipcRenderer.invoke(
      'ai-assistant-window:request-nexus-manual-download',
      sanitizeIpcPayload(
        {
          plan: targetPlan,
          storeSnapshot
        },
        {}
      )
    )
    if (response?.success === false) {
      console.error('主窗口打开 Nexus 手动下载助手失败:', response?.message)
    }
  } catch (error) {
    console.error('主窗口打开 Nexus 手动下载助手失败:', error)
  }
}

useIpc('ai-assistant-window:context', (payload = {}) => {
  applyContextPayload(payload)
  aiAssistantStore.publishAssistantWindowState()
})

watch(
  () => ({
    isProcessing: aiAssistantStore.isProcessing,
    statusLabel: aiAssistantStore.statusLabel,
    statusTone: aiAssistantStore.statusTone,
    pendingResultCount: aiAssistantStore.pendingResultCount,
    agentTaskSummary: aiAssistantStore.agentTaskSummary,
    currentSessionTitle: aiAssistantStore.currentSessionTitle
  }),
  () => {
    aiAssistantStore.publishAssistantWindowState()
  },
  { deep: true }
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
  bootstrapSidecar()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})

defineOptions({
  name: 'AiAssistantSidecar'
})
</script>

<template>
  <div class="ai-sidecar-page">
    <VxConfirmModal
:model-value="Boolean(deletingSessionId)" :title="$t('ui.deleteThisConversation')"
      :description="$t('ui.theConversationWillBeDeletedAndTheCurrentRequestStopped')"
      :confirm-text="$t('ui.deleteConversation')" danger :confirm-action="confirmDeleteSession"
      @update:model-value="!$event && (deletingSessionId = '')" />
    <PageBody :is-scroll-enabled="false" :padding-num="0">
      <section class="ai-sidecar-shell" :class="dockModeClass" role="dialog" :aria-label="$t('modelSettings.assistant')">
        <header class="ai-sidecar-titlebar">
          <div class="ai-sidecar-titlebar__title">
            <h1 :title="sidecarTitle">{{ sidecarTitle }}</h1>
          </div>

          <nav class="ai-sidecar-titlebar__actions" :aria-label="$t('ui.windowControls')">
            <button type="button" :title="$t('ui.newConversation')" :aria-label="$t('ui.newConversation')" @click="startNewChat">
              <PlusOutlined />
            </button>

            <details ref="historyMenuRef" class="ai-sidecar-history">
              <summary :title="$t('ui.conversationHistory')" :aria-label="$t('ui.conversationHistory')">
                <HistoryOutlined />
              </summary>
              <div class="ai-sidecar-history__menu">
                <div
                  v-for="session in recentSessions"
                  :key="session.id"
                  class="ai-sidecar-history__item"
                  :class="{ 'is-active': session.id === aiAssistantStore.currentSessionId }"
                >
                  <button
                    type="button"
                    class="ai-sidecar-history__open"
                    @click="openHistorySession(session.id)"
                  >
                    <span :title="session.title || $t('ui.newConversationVariant2')">{{ session.title || $t('ui.newConversationVariant2') }}</span>
                  </button>
                  <button
                    type="button"
                    class="ai-sidecar-history__delete"
                    :title="$t('ui.deleteConversation')"
                    :aria-label="$t('ui.deleteConversation')"
                    @click.stop="deleteHistorySession(session.id)"
                  >
                    <DeleteOutlined />
                  </button>
                </div>
                <p v-if="!recentSessions.length">{{ $t('ui.noConversationHistory') }}</p>
              </div>
            </details>

            <button type="button" :title="$t('ui.close')" :aria-label="$t('ui.closeAIAssistant')" @click="closeSidecar">
              <CloseOutlined />
            </button>
          </nav>
        </header>

        <main class="ai-sidecar-chat">
          <div class="ai-sidecar-chat__thread">
          <div v-if="isChatEmpty" class="ai-sidecar-empty">
            <template v-if="aiAssistantStore.runtimeStatus.configured">
              <h2>{{ $t('ui.startWithAQuestion') }}</h2>
              <p>{{ $t('ui.searchModsCreateInstallationPlansOrAnalyzeFailedInstallationTasks') }}</p>
              <div class="ai-sidecar-empty__suggestions" :aria-label="$t('ui.suggestedQuestions')">
                <button
                  v-for="item in quickSuggestions"
                  :key="item"
                  type="button"
                  @click="sendSuggestion(item)"
                >
                  {{ item }}
                </button>
              </div>
            </template>
            <template v-else>
              <h2>{{ $t('ui.setUpTheAIAssistantFirst') }}</h2>
              <p>{{ $t('ui.addAnEndpointKeyAndModelInSettingsAIThen') }}</p>
              <VxButton size="sm" @click="openAiSettings">{{ $t('ui.configureAI') }}</VxButton>
            </template>
          </div>

          <AiAssistantMessageList
            class="ai-sidecar-chat__messages"
            :messages="aiAssistantStore.messages"
            :session-id="aiAssistantStore.currentSessionId"
            :processing="aiAssistantStore.isProcessing"
            :phase="aiAssistantStore.processingPhase"
            :candidates="aiAssistantStore.candidates"
            :install-plan="aiAssistantStore.installPlan"
            :submitting-plan="aiAssistantStore.submittingPlan"
            :tasks="aiAssistantStore.agentTasks"
            :task-loading="aiAssistantStore.agentTaskLoading"
            :action-busy-task-id="aiAssistantStore.agentTaskActionBusyTaskId"
            :live-steps="aiAssistantStore.liveToolSteps"
            @retry-message="aiAssistantStore.retryMessage"
            @open-settings="aiAssistantStore.openAiSettings"
            @confirm-action="aiAssistantStore.confirmAgentAction"
            @cancel-confirmation="aiAssistantStore.cancelAgentConfirmation"
            @candidate-detail="aiAssistantStore.loadCandidateDetail"
            @candidate-plan="aiAssistantStore.installCandidate"
            @submit-plan="aiAssistantStore.submitInstallPlan({ plan: $event })"
            @decide-plan="aiAssistantStore.continueInstallDecision"
            @manual-download-plan="requestNexusManualDownloadInMainWindow"
            @cancel-plan="aiAssistantStore.clearInstallPlan"
            @cancel-task="aiAssistantStore.cancelAgentTask"
            @retry-task="aiAssistantStore.retryAgentTask"
            @analyze-logs="aiAssistantStore.analyzeAgentTaskLogs"
            @rollback-task="aiAssistantStore.rollbackAgentTask"
            @repair-post-rollback="aiAssistantStore.requestPostRollbackRepairAction"
            @view-task="aiAssistantStore.openInstallTaskDetail"
            @refresh-tasks="aiAssistantStore.refreshAgentTasks"
          />
          </div>

          <AiAssistantInput
            :session-id="aiAssistantStore.currentSessionId"
            :cancelling="aiAssistantStore.isCancelling"
            :can-cancel="aiAssistantStore.canCancelExecution"
            :submit-action="aiAssistantStore.sendMessage"
            :disabled="aiAssistantStore.isProcessing"
            :processing="aiAssistantStore.isProcessing"
            :model="aiAssistantStore.effectiveSelectedModel"
            :models="aiAssistantStore.availableModels"
            :model-loading="aiAssistantStore.isLoadingModels"
            @send="aiAssistantStore.sendMessage"
            @cancel="aiAssistantStore.cancelCurrentExecution"
            @update:model="aiAssistantStore.setSelectedModel"
          />
        </main>
      </section>
    </PageBody>
  </div>
</template>

<style scoped lang="scss">
.ai-sidecar-page,
.ai-sidecar-shell {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.ai-sidecar-shell {
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-sizing: border-box;

  // 停靠在主窗口内容区：上、右、下贴着主窗口边缘，只保留和主界面之间的分隔线。
  &.is-dock-embedded,
  &.is-dock-overlay {
    border-width: 0 0 0 1px;
  }

  // 浮层会盖住主界面右侧内容，分隔线加深一级，边界更明确。
  &.is-dock-overlay {
    border-left-color: var(--color-border-strong);
  }
}

.ai-sidecar-titlebar {
  height: 44px;
  padding: 0 8px 0 16px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  box-sizing: border-box;
  -webkit-app-region: drag;
}

.ai-sidecar-titlebar__title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;

  h1 {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-md);
    font-weight: 600;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ai-sidecar-titlebar__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;

  > button,
  .ai-sidecar-history > summary {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);
    }

    &:active {
      background: var(--color-surface-active);
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
      outline-offset: 1px;
    }
  }

  .ai-sidecar-history[open] > summary {
    color: var(--color-text);
    background: var(--color-surface-active);
  }
}

.ai-sidecar-history {
  position: relative;

  summary {
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }
  }
}

.ai-sidecar-history__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-index-dropdown);
  width: 240px;
  max-height: 300px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;

  .ai-sidecar-history__item {
    width: 100%;
    height: 32px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    transition: background-color var(--duration-fast) var(--ease-standard);

    &:hover,
    &:focus-within {
      color: var(--color-text);
      background: var(--color-surface-hover);

      .ai-sidecar-history__delete {
        opacity: 1;
        pointer-events: auto;
      }
    }

    &.is-active {
      color: var(--color-accent-strong);
      background: color-mix(in srgb, var(--color-accent-soft) 60%, var(--color-surface));
      font-weight: 600;
    }
  }

  .ai-sidecar-history__open,
  .ai-sidecar-history__delete {
    border: 0;
    background: transparent;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }

  .ai-sidecar-history__open {
    min-width: 0;
    height: 100%;
    flex: 1 1 auto;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: inherit;
    font: inherit;
    font-size: var(--font-size-sm);
    justify-content: flex-start;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
      outline-offset: -2px;
    }
  }

  .ai-sidecar-history__delete {
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    margin-right: 3px;
    border-radius: var(--radius-xs);
    color: var(--color-text-muted);
    justify-content: center;
    opacity: 0;
    pointer-events: none;

    &:hover,
    &:focus-visible {
      color: var(--color-danger);
      background: var(--color-danger-soft);
    }

    &:focus-visible {
      opacity: 1;
      outline: 2px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
      outline-offset: 0;
    }
  }

  p {
    margin: 0;
    padding: 10px;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    line-height: 1.5;
  }

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
    margin: 8px 0;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
    min-height: 40px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

.ai-sidecar-chat {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);

  :deep(.ai-message-list) {
    padding: 16px 14px 12px 16px;
  }

  :deep(.ai-inline-actions),
  :deep(.ai-message__body) {
    max-width: 100%;
  }

  :deep(.ai-message.is-user .ai-message__body) {
    max-width: min(86%, 360px);
  }
}

.ai-sidecar-chat__thread {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

// 空会话：贴近输入框给出起手问题，窄侧栏里手指与视线都不用跨越整屏。
.ai-sidecar-empty {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 8px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-lg);
    font-weight: 600;
    line-height: 1.4;
  }

  p {
    margin: 4px 0 12px;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.6;
  }
}

.ai-sidecar-empty__suggestions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;

  button {
    max-width: 100%;
    min-height: 32px;
    padding: 6px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--font-size-sm);
    line-height: 1.45;
    text-align: left;
    align-self: flex-start;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);

    &:hover {
      color: var(--color-text);
      border-color: var(--color-border-strong);
      background: var(--color-surface-hover);
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
      outline-offset: 1px;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-sidecar-titlebar__actions > button,
  .ai-sidecar-history > summary,
  .ai-sidecar-history__item,
  .ai-sidecar-empty__suggestions button {
    transition: none;
  }
}
</style>
