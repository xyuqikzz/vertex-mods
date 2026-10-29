/**
 * orchestrator/jobEvents.js — 任务事件广播与日志
 *
 * 统一封装 job/item/artifact/log 的写入与前端广播，并在 job 详情就绪时同步
 * Agent 安装任务投影。属于无运行期状态的叶子模块。
 */
import { toSafeText } from '../contracts.js'
import { appendTaskLog, getArtifactByKey, getJobDetail } from '../taskStore.js'
import { buildSourceInstallTaskUpdate } from '../taskSummary.js'
import {
  buildPublicSourceInstallTaskRecord,
  sanitizeSourceInstallTaskDiagnostic
} from '../taskSecurity.js'
import { emitArtifactUpdated, emitItemUpdated, emitJobUpdated, emitTaskLog } from '../taskEvents.js'
import { projectSourceInstallJobToAgentTask } from '../../../../services/ai/agent/sourceInstallProjection.js'
import { projectSourceModpackInstallJobUpdate } from '../../source-modpack-instance/projection.js'

export function emitLog(jobId = '', itemId = '', level = 'info', message = '', detail = {}) {
  const safeMessage = sanitizeSourceInstallTaskDiagnostic(message)
  const safeDetail = sanitizeSourceInstallTaskDiagnostic(detail)
  appendTaskLog(jobId, itemId, level, safeMessage, safeDetail)
  emitTaskLog({
    jobId,
    itemId,
    level,
    message: safeMessage,
    detail: safeDetail
  })
}

function projectAgentTaskFromJob(detail = null) {
  const agentTaskId = toSafeText(detail?.agent_task_id || detail?.job?.agent_task_id)
  if (!agentTaskId) return
  projectSourceInstallJobToAgentTask(detail).catch((error) => {
    console.error('同步 Agent 安装任务投影失败', error)
  })
}

export function emitJob(jobId = '') {
  const detail = getJobDetail(jobId)
  if (detail) {
    emitJobUpdated(buildSourceInstallTaskUpdate(detail))
    projectAgentTaskFromJob(detail)
    projectSourceModpackInstallJobUpdate(detail).catch((error) => {
      console.error('同步分享整合包实例状态失败', error)
    })
  }
  return detail
}

export function emitItem(itemId = '') {
  emitItemUpdated({ itemId })
}

export function emitArtifact(artifactKey = '') {
  const artifact = getArtifactByKey(artifactKey)
  if (artifact) {
    emitArtifactUpdated(buildPublicSourceInstallTaskRecord(artifact))
  }
  return artifact
}
