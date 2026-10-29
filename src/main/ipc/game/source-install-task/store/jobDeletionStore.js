import {
  assertInstallTaskActionAllowed,
  INSTALL_TASK_ACTION
} from '../../../../../shared/tasks/install-task-center-policy.js'

function normalizeJobIds(jobIds = []) {
  return [
    ...new Set(
      (Array.isArray(jobIds) ? jobIds : [])
        .map((jobId) => String(jobId ?? '').trim())
        .filter(Boolean)
    )
  ]
}

function normalizeExpectedStates(expectedStates = {}) {
  if (!expectedStates || typeof expectedStates !== 'object' || Array.isArray(expectedStates)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(expectedStates)
      .map(([jobId, state]) => [String(jobId ?? '').trim(), String(state ?? '').trim()])
      .filter(([jobId, state]) => jobId && state)
  )
}

function buildRejectedResult(reasonCode, rejected = [], message = '') {
  return {
    success: false,
    changes: 0,
    deletedIds: [],
    rejected,
    reasonCode,
    message
  }
}

export function createJobDeletionStore(database = {}) {
  const { all, run, transaction } = database
  if (![all, run, transaction].every((operation) => typeof operation === 'function')) {
    throw new TypeError('createJobDeletionStore 需要 all、run 和 transaction 数据库操作')
  }

  function deleteJobsByIds(jobIds = [], options = {}) {
    const ids = normalizeJobIds(jobIds)
    if (!ids.length) {
      return buildRejectedResult('task_not_found', [], '未指定要删除的任务')
    }
    const expectedStates = normalizeExpectedStates(options?.expectedStates)

    return transaction(() => {
      const placeholders = ids.map(() => '?').join(', ')
      const jobs = all(
        `SELECT job_id, state, failure_json FROM source_install_job WHERE job_id IN (${placeholders})`,
        ids
      )
      const jobsById = new Map(jobs.map((job) => [String(job?.job_id || ''), job]))
      const missing = ids.filter((jobId) => !jobsById.has(jobId))
      if (missing.length) {
        return buildRejectedResult(
          'task_not_found',
          missing.map((jobId) => ({ jobId, reasonCode: 'task_not_found' })),
          '部分任务不存在，未删除任何任务'
        )
      }

      const changed = ids
        .map((jobId) => jobsById.get(jobId))
        .filter((job) => expectedStates[job.job_id] && expectedStates[job.job_id] !== job.state)
      if (changed.length) {
        return buildRejectedResult(
          'task_state_changed',
          changed.map((job) => ({
            jobId: job.job_id,
            state: job.state,
            expectedState: expectedStates[job.job_id],
            reasonCode: 'task_state_changed'
          })),
          '任务状态已变化，请刷新后重试'
        )
      }

      const notDeletable = ids
        .map((jobId) => jobsById.get(jobId))
        .filter((job) => {
          try {
            assertInstallTaskActionAllowed(job, INSTALL_TASK_ACTION.DELETE)
            return false
          } catch {
            return true
          }
        })
      if (notDeletable.length) {
        return buildRejectedResult(
          'task_delete_not_terminal',
          notDeletable.map((job) => ({
            jobId: job.job_id,
            state: job.state,
            reasonCode: 'task_delete_not_terminal'
          })),
          '只能删除已完成、已取消或明确不可恢复的失败任务'
        )
      }

      run(`DELETE FROM source_install_step_log WHERE job_id IN (${placeholders})`, ids)
      run(`DELETE FROM source_install_job_item WHERE job_id IN (${placeholders})`, ids)
      const result = run(`DELETE FROM source_install_job WHERE job_id IN (${placeholders})`, ids)
      run(`
        DELETE FROM source_install_artifact
        WHERE artifact_key NOT IN (
          SELECT DISTINCT artifact_key
          FROM source_install_job_item
          WHERE trim(artifact_key) <> ''
        )
      `)
      return {
        success: true,
        changes: Number(result?.changes || 0),
        deletedIds: ids,
        rejected: [],
        reasonCode: '',
        message: `已删除 ${Number(result?.changes || 0)} 个任务`
      }
    })
  }

  return Object.freeze({ deleteJobsByIds })
}
