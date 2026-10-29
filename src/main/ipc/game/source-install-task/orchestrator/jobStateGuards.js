/**
 * orchestrator/jobStateGuards.js — 任务/安装项只读守卫
 *
 * 只读取当前 job/item 状态并在取消/暂停时抛出控制错误，自身不做任何状态写入，
 * 因此与状态写入 hub 无环依赖，可被编排核心安全复用。
 */
import { ITEM_STATE, JOB_STATE, parseJsonObject } from '../contracts.js'
import { getJob, getJobItems } from '../taskStore.js'
import { getSourceModpackInspectionPlan, getSourceModpackInstance } from '../../../../db/mods/sourceModpackInstances.js'
import { createTaskCancelledError, createTaskPausedError } from './jobAbortControl.js'

export function getCurrentJob(jobId = '') {
  const job = getJob(jobId)
  if (!job) {
    throw new Error('安装任务不存在')
  }
  return job
}

export function getCurrentItem(jobId = '', itemId = '', fallback = {}) {
  return getJobItems(jobId).find((entry) => entry.item_id === itemId) || fallback
}

export function assertSourceModpackTaskCanProceed(job = {}) {
  const payload = job.payload || parseJsonObject(job.payload_json, {})
  const binding = payload.sourceMeta || {}
  const planToken = binding.sourceModpackPlanToken
  if (!planToken) return
  const plan = getSourceModpackInspectionPlan(planToken)
  const instance = getSourceModpackInstance(binding.sourceModpackInstanceId)
  if (!plan || !['applying', 'partial'].includes(plan.state) ||
      !instance || ['detached', 'removed', 'orphaned'].includes(instance.state)) {
    throw Object.assign(new Error('整合包安装计划已失效，请从分享入口重新预检'), {
      code: 'manifest_revision_changed'
    })
  }
}

export function assertJobCanProceed(jobId = '') {
  const job = getCurrentJob(jobId)
  if (job.state === JOB_STATE.CANCELLED) {
    throw createTaskCancelledError('安装任务已取消')
  }
  if (job.state === JOB_STATE.PAUSED) {
    throw createTaskPausedError('安装任务已暂停')
  }
  assertSourceModpackTaskCanProceed(job)
  return job
}

export function assertItemCanProceed(jobId = '', itemId = '', fallback = {}) {
  const job = assertJobCanProceed(jobId)
  const item = getCurrentItem(jobId, itemId, fallback)
  if (!item?.item_id) {
    throw new Error('安装项不存在')
  }
  if (item.state === ITEM_STATE.CANCELLED) {
    throw createTaskCancelledError('安装项已取消')
  }
  return { job, item }
}
