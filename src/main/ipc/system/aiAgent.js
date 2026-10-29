import { ipcMain } from '../../security/ipc.js'
import path from 'node:path'
import { shell, BrowserWindow } from 'electron'
import { commitAssistantChatResult } from '../../assistantWindow.js'
import userPath from '../../initPath.js'
import { AI_AGENT_TOOL_DESCRIPTORS } from '../../../shared/ai/tools/ai-agent-tool-schemas.js'
import { getDefaultAiAgentDefinition } from '../../../shared/ai/config/ai-agent-definition.js'
import { initializeAgentDefinitionStore } from '../../services/ai/agentDefinitionStore.js'
import {
  AI_AGENT_CHAT_CHANNELS,
  AI_AGENT_SESSION_TITLE_CHANNEL
} from '../../../shared/ipc/ai-agent-ipc-channels.js'
import { resolveAgentTaskStatus } from '../../../shared/ai/conversation/ai-agent-task-status.js'
import { AI_AGENT_TOOL_LOG_LIST_CHANNEL } from '../../../shared/ai/tools/ai-agent-tool-log.js'
import {
  cancelAiAgentExecution,
  chatWithAiAgent,
  createAiAgentInstallPlan,
  executeAiAgentConflictRepair,
  generateAiAgentSessionTitle,
  getAiAgentRuntimeStatus,
  listAiAgentModels,
  submitAiAgentInstallPlan
} from '../../services/ai/agentRuntime.js'
import { getAgentTask, listAgentTasks } from '../../services/ai/agent/taskCenter.js'
import {
  cancelAgentTaskAction,
  retryAgentTaskAction,
  rollbackAgentTaskAction
} from '../../services/ai/agent/taskActions.js'
import { invokeAiAgentToolForDebug } from '../../services/ai/agent/debugToolInvoker.js'
import { confirmAgentTool } from '../../services/ai/agent/confirmationService.js'
import { listAgentToolCallLogs } from '../../services/ai/agent/toolCallLogger.js'
import {
  listAgentPermissionGrants,
  revokeAgentPermissionGrant
} from '../../services/ai/agent/permissionGrantStore.js'
import { getModSourceDetail, searchModSource } from '../../services/mod-source/index.js'
import { conversationExecutions } from '../../services/ai/agent/conversationExecution.js'

function shouldRegisterAiAgentChatChannel(channel = '') {
  return !(
    channel === 'ai-agent:chat-v2' && process.env.VERTEX_DISABLE_AGENT_CHAT_V2_HANDLER === '1'
  )
}

export function registerAiAgentIpc() {
  const definitionStore = initializeAgentDefinitionStore(
    path.join(userPath, 'ai-agent.json'), AI_AGENT_TOOL_DESCRIPTORS.map((tool) => tool.name)
  )
  ipcMain.handle('ai-agent:definition', async (_event, payload = {}) => {
    try {
      if (payload.action === 'save') return definitionStore.save(payload.text, payload.revision)
      if (payload.action === 'defaults') return { success: true, text: JSON.stringify(getDefaultAiAgentDefinition(), null, 2) }
      if (payload.action === 'reveal') {
        const current = definitionStore.inspect()
        if (current.revision === 'default') definitionStore.save(current.text, current.revision)
        shell.showItemInFolder(definitionStore.filePath)
        return definitionStore.inspect()
      }
      if (payload.action && payload.action !== 'read') throw new Error('未知配置操作')
      return definitionStore.inspect()
    } catch (error) {
      return { success: false, errorCode: 'agent_config_invalid', message: error.message }
    }
  })
  ipcMain.handle('ai-agent:status', async () => {
    return { ...getAiAgentRuntimeStatus(), activeExecution: conversationExecutions.state() }
  })

  ipcMain.handle('ai-agent:models', async () => {
    return await listAiAgentModels()
  })

  ipcMain.handle(AI_AGENT_SESSION_TITLE_CHANNEL, async (_event, payload = {}) => {
    return await generateAiAgentSessionTitle(payload)
  })

  AI_AGENT_CHAT_CHANNELS.filter(shouldRegisterAiAgentChatChannel).forEach((channel) => {
    ipcMain.handle(channel, async (event, payload = {}) => {
      return await chatWithAiAgent(payload, { event, onSettled: commitAssistantChatResult, onState: broadcastExecutionState })
    })
  })

  ipcMain.handle('ai-agent:cancel', async (_event, payload = {}) => {
    return await conversationExecutions.cancel(payload, cancelAiAgentExecution)
  })

  ipcMain.handle('ai-agent:invoke-tool', async (event, payload = {}) => {
    return await invokeAiAgentToolForDebug(payload, { event })
  })
  ipcMain.handle('ai-agent:confirm-tool', async (event, payload = {}) => confirmAgentTool(payload, { event }))

  ipcMain.handle(AI_AGENT_TOOL_LOG_LIST_CHANNEL, async (_event, payload = {}) => {
    return listAgentToolCallLogs(payload)
  })

  ipcMain.handle('ai-agent:create-install-plan', async (event, payload = {}) => {
    return await createAiAgentInstallPlan(payload, { event })
  })

  ipcMain.handle('ai-agent:submit-install-plan', async (event, payload = {}) => {
    return await submitAiAgentInstallPlan(event, payload)
  })

  ipcMain.handle('ai-agent:execute-conflict-repair', async (event, payload = {}) => {
    return await executeAiAgentConflictRepair(event, payload)
  })

  ipcMain.handle('agent-task:list', async (_event, payload = {}) => {
    return await listAgentTasks(payload)
  })

  ipcMain.handle('agent-task:status', async (_event, payload = {}) => {
    return await resolveAgentTaskStatus(payload, {
      getAgentTask
    })
  })

  ipcMain.handle('agent-task:cancel', async (event, payload = {}) => {
    return await cancelAgentTaskAction(payload, event, {
      cancelAgentExecution: async (cancelPayload) => {
        return await cancelAiAgentExecution(cancelPayload)
      }
    })
  })

  ipcMain.handle('agent-task:retry', async (event, payload = {}) => {
    return await retryAgentTaskAction(payload, event, {
      retryAgentRequest: async (retryPayload, retryEvent) => {
        return await chatWithAiAgent(retryPayload, { event: retryEvent, readonlyRetry: true, onSettled: commitAssistantChatResult, onState: broadcastExecutionState })
      }
    })
  })

  ipcMain.handle('agent-task:rollback', async (event, payload = {}) => {
    return await rollbackAgentTaskAction(payload, event)
  })

  ipcMain.handle('agent-permission:create', async (_event, payload = {}) => {
    void payload
    return { success: false, errorCode: 'confirmation_required', message: '授权只能随有效确认一起创建，请重新准备操作。' }
  })

  ipcMain.handle('agent-permission:list', async (_event, payload = {}) => {
    return listAgentPermissionGrants(payload)
  })

  ipcMain.handle('agent-permission:revoke', async (_event, payload = {}) => {
    return revokeAgentPermissionGrant(payload)
  })

  ipcMain.handle('mod-source:search', async (_event, payload = {}) => {
    return await searchModSource(payload)
  })

  ipcMain.handle('mod-source:detail', async (_event, payload = {}) => {
    return await getModSourceDetail(payload)
  })
}

function broadcastExecutionState(active) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('agent-chat:delta', { type: 'execution-state', active })
  }
}
