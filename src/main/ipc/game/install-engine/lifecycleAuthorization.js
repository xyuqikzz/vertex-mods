/**
 * install-engine/lifecycleAuthorization.js — H6 生命周期命令动作逐次授权
 *
 * method.js 在调用 applyInstallRulePostInstallSteps / applyInstallRuleLifecycleSteps 前，
 * 先通过 requestLifecycleAuthorization 收集用户对该规则命令动作的显式授权。
 *
 * 流程：
 * 1. method.js 调 requestLifecycleAuthorization(deployPlan, postInstallSteps, event)
 * 2. 函数通过 event.sender.send 推送 'vertex:lifecycle:request-authorization' 到前端
 * 3. 前端 LifecycleAuthorizationDialogHost.vue 弹窗收集用户确认
 * 4. 前端通过 ipcRenderer.send('vertex:lifecycle:submit-authorization', { requestId, confirmed })
 *    回传结果
 * 5. index.js 中注册的 ipcMain.on 调用 resolveLifecycleAuthorization(requestId, confirmed)
 * 6. pending Promise resolve，requestLifecycleAuthorization 返回 { authorized, trustLevel, reason }
 *
 * 60 秒超时未响应则拒绝（安全优先）。
 * event 缺失（自动化测试、AI 工具调用）时默认拒绝，可通过环境变量
 * VERTEX_LIFECYCLE_AUTO_AUTHORIZIZE=1 强制放行。
 */

const LIFECYCLE_AUTHORIZATION_TIMEOUT_MS = 60 * 1000
const COMMAND_ACTIONS = ['run_command', 'run_script', 'execute']

const pendingLifecycleAuthorizationMap = new Map()

export function collectLifecycleCommandSteps(postInstallSteps = []) {
  return (Array.isArray(postInstallSteps) ? postInstallSteps : [])
    .filter((step) => {
      const action = String(step?.action || step?.type || step?.name || '')
        .trim()
        .toLowerCase()
      return COMMAND_ACTIONS.includes(action)
    })
    .map((step) => ({
      action: String(step.action || step.type || step.name || '').trim().toLowerCase(),
      path: String(step.path || step.target || step.target_path || step.targetPath || '').trim(),
      args: Array.isArray(step.args) ? step.args : [],
      executable: step.executable || '',
      workingDirectory: step.workingDirectory || '',
      repeat: step.repeat || 1,
      requiresConsole: step.requiresConsole === true
    }))
}

/**
 * 由 IPC handler 调用，解析 pending 授权请求。
 * @param {string} requestId - 请求 ID
 * @param {boolean} confirmed - 用户是否确认
 * @returns {boolean} 是否成功解析（找到对应 pending 请求）
 */
export function resolveLifecycleAuthorization(requestId = '', confirmed = false) {
  const safeRequestId = String(requestId || '')
  const pending = pendingLifecycleAuthorizationMap.get(safeRequestId)
  if (!pending) return false
  pendingLifecycleAuthorizationMap.delete(safeRequestId)
  clearTimeout(pending.timer)
  pending.resolve({ confirmed: confirmed === true })
  return true
}

/**
 * 请求用户对 community/user 规则的命令动作显式授权。
 * @param {object} deployPlan - 部署计划，至少包含 trustLevel
 * @param {Array} postInstallSteps - 生命周期步骤列表
 * @param {object|null} event - Electron IPC event，需有 sender.send
 * @returns {Promise<{ authorized: boolean, trustLevel: string, reason: string }>}
 */
export async function requestLifecycleAuthorization(
  deployPlan = {},
  postInstallSteps = [],
  event = null
) {
  const trustLevel =
    String(deployPlan?.trustLevel || '')
      .trim()
      .toLowerCase() || 'community'

  // 官方规则自动授权
  if (trustLevel === 'official') {
    return { authorized: true, trustLevel, reason: 'official_auto_authorized' }
  }

  // 无命令动作自动授权
  const commandSteps = collectLifecycleCommandSteps(postInstallSteps)
  if (!commandSteps.length) {
    return { authorized: true, trustLevel, reason: 'no_command_steps' }
  }

  // event 不可用：默认拒绝（安全优先），允许环境变量强制放行
  const sender = event?.sender && typeof event.sender.send === 'function' ? event.sender : null
  if (!sender) {
    if (process.env.VERTEX_LIFECYCLE_AUTO_AUTHORIZIZE === '1') {
      return { authorized: true, trustLevel, reason: 'auto_authorize_no_sender' }
    }
    return { authorized: false, trustLevel, reason: 'no_event_sender' }
  }

  const requestId = `lifecycle-auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const authPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingLifecycleAuthorizationMap.has(requestId)) {
        pendingLifecycleAuthorizationMap.delete(requestId)
        console.warn('生命周期授权确认超时，默认拒绝', { requestId, trustLevel })
        resolve({ confirmed: false })
      }
    }, LIFECYCLE_AUTHORIZATION_TIMEOUT_MS)
    pendingLifecycleAuthorizationMap.set(requestId, { resolve, timer })
  })

  try {
    sender.send('vertex:lifecycle:request-authorization', {
      requestId,
      trustLevel,
      commands: commandSteps
    })
  } catch (sendError) {
    resolveLifecycleAuthorization(requestId, false)
    console.error('生命周期授权请求推送失败', sendError?.message || sendError)
    return { authorized: false, trustLevel, reason: 'send_failed' }
  }

  try {
    const result = await authPromise
    return {
      authorized: result?.confirmed === true,
      trustLevel,
      reason: result?.confirmed ? 'user_confirmed' : 'user_declined'
    }
  } catch (error) {
    console.error('生命周期授权确认失败', error?.message || error)
    return { authorized: false, trustLevel, reason: 'confirm_error' }
  }
}
