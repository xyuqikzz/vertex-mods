function toText(value = '') {
  return String(value ?? '').trim()
}

function createBatchError(error, jobs = [], cancelFailures = []) {
  const target = error instanceof Error ? error : new Error(toText(error) || '创建安装任务失败')
  target.createdJobs = jobs
  target.cancelFailures = cancelFailures
  return target
}

export async function createSourceModpackJobBatch(context = {}, dependencies = {}) {
  const taskPayloads = Array.isArray(context.taskPayloads) ? context.taskPayloads : []
  const jobs = []
  const startedJobIds = new Set()

  try {
    for (const taskPayload of taskPayloads) {
      const preparedPayload = {
        ...taskPayload,
        options: {
          ...(taskPayload.options || {}),
          autoStart: false
        }
      }
      let createdJob = null
      let result
      try {
        result = await dependencies.createTask(context.event, preparedPayload, {
          onCreated(created = {}) {
            const pendingJob = {
              sourcePlatform: taskPayload.source,
              success: true,
              jobId: created.jobId,
              state: created.state
            }
            dependencies.attachJob({
              instanceId: context.instanceId,
              planToken: context.planToken,
              jobId: created.jobId,
              sourcePlatform: taskPayload.source,
              state: created.state,
              result: pendingJob
            })
            createdJob = pendingJob
          }
        })
      } catch (error) {
        if (createdJob?.jobId) jobs.push(createdJob)
        throw error
      }
      if (!result?.success) throw new Error(result?.message || '创建安装任务失败')

      const job = { sourcePlatform: taskPayload.source, ...result }
      jobs.push(job)
      dependencies.attachJob({
        instanceId: context.instanceId,
        planToken: context.planToken,
        jobId: result.jobId,
        sourcePlatform: taskPayload.source,
        state: result.state,
        result
      })

      const detail = dependencies.getTaskDetail(result.jobId)
      if (!detail) throw new Error(`安装任务详情不存在：${result.jobId}`)
      await dependencies.projectTask(detail)
    }

    for (const job of jobs) {
      if (['precheck_blocked', 'waiting_user_action', 'waiting', 'completed', 'completed_with_warning'].includes(job.state)) continue
      const startResult = await dependencies.startTask(context.event, { jobId: job.jobId })
      if (!startResult?.success) {
        throw new Error(startResult?.message || `启动安装任务失败：${job.jobId}`)
      }
      if (startResult.started !== false) startedJobIds.add(job.jobId)
    }

    return jobs
  } catch (error) {
    const cancelFailures = []
    for (const job of [...jobs].reverse()) {
      try {
        const result = await dependencies.cancelTask(
          { jobId: job.jobId, awaitStopped: true },
          { preserveArtifacts: !startedJobIds.has(job.jobId) }
        )
        if (!result?.success) {
          cancelFailures.push({ jobId: job.jobId, message: result?.message || '取消任务失败' })
        }
      } catch (cancelError) {
        cancelFailures.push({ jobId: job.jobId, message: toText(cancelError?.message || cancelError) })
      }
    }
    throw createBatchError(error, jobs, cancelFailures)
  }
}
