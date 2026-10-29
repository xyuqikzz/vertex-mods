import { randomUUID } from 'node:crypto'
import { canUninstallApp, classifyUninstallResult, isSameInstalledApp } from '../../shared/system/installed-app.js'

const publicItem = ({ id, type, path, reason }) => ({ id, type, path, reason })
const publicResiduals = (result) => ({
  fileItems: result.fileItems.map(publicItem),
  registryItems: result.registryItems.map(publicItem),
  totalCount: result.totalCount
})

export function createInstalledAppOperations({
  list, run, scan, cleanup, now = Date.now, uuid = randomUUID,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  externalTimeoutMs = 30 * 60 * 1000, sessionTtlMs = 15 * 60 * 1000
}) {
  let active = null
  const latest = new Map()
  const reply = (event, channel, task, data) => {
    if (!event.sender.isDestroyed()) event.reply(channel, {
      taskId: task.taskId, displayName: task.app?.displayName || '', ...data
    })
  }
  const snapshot = (ownerId) => {
    const task = latest.get(ownerId)
    if (!task) return null
    if (task.phase === 'review' && now() > task.expiresAt) {
      task.phase = 'finished'
      task.message = '清理确认已过期，请重新扫描'
      task.residuals = null
    }
    return {
      taskId: task.taskId, phase: task.phase, mode: task.mode,
      app: task.app ? { registryPath: task.app.registryPath, displayName: task.app.displayName } : null,
      message: task.message || '', scanToken: task.scanToken || '',
      ...(task.residuals ? publicResiduals(task.residuals) : {})
    }
  }
  const finish = (task, message) => {
    task.phase = 'finished'
    task.message = message || ''
  }
  async function start(event, data = {}, mode = 'uninstall') {
    const ownerId = event.sender.id
    snapshot(ownerId)
    const task = { taskId: String(data.taskId || ''), ownerId, phase: 'starting', mode }
    const failureChannel = mode === 'directCleanup' ? 'scanInstalledAppResidualsResult' : 'uninstallInstalledAppClosed'
    if (!/^[a-z0-9-]{8,80}$/i.test(task.taskId)) {
      reply(event, failureChannel, task, { success: false, message: '缺少有效任务标识，请刷新页面' })
      return
    }
    if (active || latest.get(ownerId)?.phase === 'review') {
      reply(event, failureChannel, task, { success: false, message: '请先完成当前卸载或清理任务', busy: true })
      return
    }
    active = task
    latest.set(ownerId, task)
    try {
      let installed = await list()
      // Commands and paths always come from current OS inventory, never from the renderer.
      task.app = installed.find((item) => isSameInstalledApp(item, data))
      if (!task.app) throw new Error('应用登记已变化，请刷新列表后重试')
      if (Number(task.app.noRemove) === 1) throw new Error('此应用不支持独立卸载或清理')
      if (mode === 'directCleanup' && canUninstallApp(task.app)) throw new Error('此应用有卸载程序，请先执行正常卸载')
      if (mode === 'uninstall') {
        const command = task.app.uninstallString || task.app.quietUninstallString
        if (!command) throw new Error('此应用没有有效卸载命令')
        task.phase = 'running'
        const result = await run(command, { onStarted: () => reply(event, 'uninstallInstalledAppStart', task, { success: true }) })
        const outcome = classifyUninstallResult(result)
        if (outcome === 'timeout' || outcome === 'failed' || outcome === 'cancelled' || outcome === 'rebootRequired' || outcome === 'unknown') {
          const messages = {
            timeout: '等待超时，卸载程序可能仍在运行；未执行残留清理',
            failed: `卸载程序返回错误（${result.exitCode}），未执行残留清理`,
            cancelled: '已取消卸载',
            rebootRequired: '卸载程序要求重新启动 Windows，已跳过残留清理',
            unknown: '无法确认卸载程序结果，未执行残留清理'
          }
          finish(task, messages[outcome])
          reply(event, 'uninstallInstalledAppClosed', task, {
            success: outcome !== 'failed', uninstalled: false, willScanResidual: false,
            outcome, message: task.message, exitCode: result.exitCode
          })
          return
        }
        if (outcome === 'external') {
          task.phase = 'external'
          reply(event, 'uninstallInstalledAppProgress', task, { success: true, phase: 'external' })
          const deadline = now() + externalTimeoutMs
          let absentCount = 0
          while (now() < deadline && !task.stopWaiting && !event.sender.isDestroyed()) {
            installed = await list()
            absentCount = installed.some((item) => isSameInstalledApp(item, task.app)) ? 0 : absentCount + 1
            if (absentCount >= 2) break
            await sleep(2000)
          }
          if (absentCount < 2 || task.stopWaiting) {
            finish(task, task.stopWaiting ? '已停止等待，请在外部程序中确认卸载结果' : '等待结束，尚未确认应用已卸载')
            reply(event, 'uninstallInstalledAppClosed', task, { success: true, uninstalled: false, willScanResidual: false, message: task.message })
            return
          }
        } else {
          task.phase = 'checking'
          reply(event, 'uninstallInstalledAppProgress', task, { success: true, phase: 'closed' })
          installed = await list()
          if (installed.some((item) => isSameInstalledApp(item, task.app))) {
            finish(task, '应用仍在已安装列表中，未执行残留清理')
            reply(event, 'uninstallInstalledAppClosed', task, { success: true, uninstalled: false, willScanResidual: false, message: task.message })
            return
          }
        }
        reply(event, 'uninstallInstalledAppClosed', task, { success: true, uninstalled: true, willScanResidual: true, registryPath: task.app.registryPath })
      }
      task.phase = 'scanning'
      const result = await scan(task.app, installed)
      task.residuals = result
      task.scanToken = uuid()
      task.expiresAt = now() + sessionTtlMs
      task.phase = result.totalCount ? 'review' : 'finished'
      reply(event, 'scanInstalledAppResidualsResult', task, { success: true, scanToken: task.scanToken, ...publicResiduals(result) })
    } catch (error) {
      finish(task, error.message || '卸载流程失败')
      reply(event, failureChannel, task, { success: false, uninstalled: false, willScanResidual: false, message: task.message })
    } finally {
      if (active === task) active = null
    }
  }

  async function clean(event, data = {}) {
    const task = latest.get(event.sender.id)
    const responseTask = { taskId: String(data.taskId || '') }
    let acquired = false
    try {
      if (!task || task.taskId !== data.taskId) throw new Error('任务已失效，请刷新后重试')
      if (data.action === 'stopWaiting' && task.phase === 'external') {
        task.stopWaiting = true
        return
      }
      if (active) throw new Error('当前操作仍在执行，请稍候')
      if (data.action === 'skip' && task.phase === 'review') {
        task.residuals = null
        finish(task)
        reply(event, 'cleanupInstalledAppResidualsResult', task, { success: true, skipped: true })
        return
      }
      if (task.phase !== 'review' || !task.residuals || data.scanToken !== task.scanToken ||
          now() > task.expiresAt) throw new Error('清理确认已失效，请关闭后重新扫描')
      const ids = data.itemIds
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('请选择有效的清理项目')
      const approved = [...task.residuals.fileItems, ...task.residuals.registryItems]
      const selected = ids.map((id) => approved.find((item) => item.id === id))
      if (selected.some((item) => !item)) throw new Error('清理项目不属于本次扫描')
      active = task
      acquired = true
      task.phase = 'cleaning'
      const installed = await list()
      const current = installed.find((item) => isSameInstalledApp(item, task.app))
      if ((task.mode === 'uninstall' && current) ||
          (task.mode === 'directCleanup' && current && (canUninstallApp(current) ||
            Number(current.noRemove) === 1 || current.installLocation !== task.app.installLocation ||
            current.displayName !== task.app.displayName || current.publisher !== task.app.publisher))) {
        throw new Error('应用安装状态已变化，拒绝继续清理')
      }
      const result = await cleanup(selected, { appInfo: task.app, installedApps: installed })
      const failed = new Set(result.failedItems.map((item) => item.id))
      const removed = new Set(ids.filter((id) => !failed.has(id)))
      task.residuals.fileItems = task.residuals.fileItems.filter((item) => !removed.has(item.id))
      task.residuals.registryItems = task.residuals.registryItems.filter((item) => !removed.has(item.id))
      task.residuals.totalCount = task.residuals.fileItems.length + task.residuals.registryItems.length
      task.phase = task.residuals.totalCount ? 'review' : 'finished'
      reply(event, 'cleanupInstalledAppResidualsResult', task, {
        ...result, remaining: publicResiduals(task.residuals),
        message: result.success ? '所选项目已清理' : '部分项目清理失败，可查看原因后重试'
      })
    } catch (error) {
      if (acquired && task.phase === 'cleaning') task.phase = 'review'
      reply(event, 'cleanupInstalledAppResidualsResult', responseTask, { success: false, message: error.message || '清理失败' })
    } finally {
      if (acquired && active === task) active = null
    }
  }
  return { start, clean, snapshot }
}
