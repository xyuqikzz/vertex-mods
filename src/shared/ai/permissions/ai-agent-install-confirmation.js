function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstPlainObject(...values) {
  for (const value of values) {
    if (isPlainObject(value)) {
      return value
    }
  }
  return null
}

function hasSourceInstallTaskPayload(plan = null) {
  return isPlainObject(plan?.sourceInstallTaskPayload)
}

export function resolveAiAgentInstallConfirmationPlan(confirmation = {}, context = {}) {
  const safeConfirmation = toPlainJson(confirmation, {})
  const args = isPlainObject(safeConfirmation.args) ? safeConfirmation.args : {}
  const currentInstallPlan = isPlainObject(context.currentInstallPlan)
    ? context.currentInstallPlan
    : null
  const agentTasks = Array.isArray(context.agentTasks) ? context.agentTasks : []
  const directPlan = firstPlainObject(args.installPlan, args.plan)
  const agentTaskId = toSafeText(args.agentTaskId || safeConfirmation.taskId)

  if (directPlan) {
    return toPlainJson(
      {
        ...directPlan,
        agentTaskId: toSafeText(directPlan.agentTaskId || agentTaskId),
        sourceInstallTaskPayload:
          firstPlainObject(directPlan.sourceInstallTaskPayload, args.sourceInstallTaskPayload) ||
          null
      },
      null
    )
  }

  const directPayload = firstPlainObject(args.sourceInstallTaskPayload)
  if (directPayload) {
    return toPlainJson(
      {
        ...(currentInstallPlan || {}),
        agentTaskId: agentTaskId || toSafeText(currentInstallPlan?.agentTaskId),
        canSubmit: true,
        sourceInstallTaskPayload: directPayload
      },
      null
    )
  }

  if (agentTaskId) {
    const task = agentTasks.find((item) => toSafeText(item?.taskId) === agentTaskId)
    if (isPlainObject(task?.plan)) {
      return toPlainJson(
        {
          ...task.plan,
          agentTaskId
        },
        null
      )
    }
  }

  return toPlainJson(currentInstallPlan, null)
}

export function createAiAgentInstallConfirmationSubmitState(confirmation = {}, context = {}) {
  const safeConfirmation = toPlainJson(confirmation, {})
  const toolName = toSafeText(safeConfirmation.toolName)

  if (toolName !== 'vertex.install.execute_plan') {
    return {
      canSubmit: false,
      reason: 'unsupported_tool',
      message: '当前版本暂不支持执行该授权请求。',
      plan: null
    }
  }

  const plan = resolveAiAgentInstallConfirmationPlan(safeConfirmation, context)
  if (!hasSourceInstallTaskPayload(plan)) {
    return {
      canSubmit: false,
      reason: 'missing_source_install_task_payload',
      message: '授权请求缺少安装任务 payload。',
      plan
    }
  }

  return {
    canSubmit: true,
    reason: 'ready',
    message: '',
    plan
  }
}
