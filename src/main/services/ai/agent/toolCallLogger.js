import dbInstance from '../../../db/dbInstance.js'
import {
  listAgentToolCallLogsFromDatabase,
  logAgentToolCallToDatabase
} from './toolCallLogStore.js'

/**
 * Agent 工具调用审计日志（agent_tool_call_log）
 * 所有经 invokeAgentTool 的调用（含被拒绝、失败、取消）都必须落库。
 */

/**
 * 写入一条工具调用日志，失败时静默（日志不应阻断主流程）。
 */
export function logAgentToolCall(entry = {}) {
  try {
    logAgentToolCallToDatabase(dbInstance, entry)
  } catch (error) {
    console.error('[AI Agent] 写入工具调用日志失败', error?.message || error)
  }
}

/**
 * 查询最近的工具调用日志（调试 / UI 展示用）。
 */
export function listAgentToolCallLogs(options = {}) {
  try {
    return listAgentToolCallLogsFromDatabase(dbInstance, options)
  } catch {
    return []
  }
}
