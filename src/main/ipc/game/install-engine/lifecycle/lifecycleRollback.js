/**
 * lifecycle/lifecycleRollback.js — 生命周期级回滚计划（纯函数）
 *
 * 把「已执行的生命周期步骤记录」映射为逆向动作计划（LIFO 顺序）。安全文件类动作
 * 可自动逆向；命令类动作（run_command/run_script/execute）与无备份的就地修改不可
 * 自动逆向，归入 manual 清单交由用户处理。
 *
 * 说明：本模块产出回滚「计划」，不执行实际 IO；将其接入运行期失败回滚路径属于运行期
 * 改动，需实机验证后再启用，故当前仅作为可独立测试的纯规划能力提供。
 */
import { toSafeText } from '../contracts.js'

function reverseStep(action = '', step = {}) {
  const backup = toSafeText(step.backup || step.backup_path || step.backupPath)
  const target = toSafeText(
    step.to || step.target || step.dest || step.destination || step.path
  )
  const from = toSafeText(step.from || step.source || step.source_path || step.sourcePath)

  switch (action) {
    case 'ensure_dir_exists':
      return { action: 'remove_empty_dir', path: toSafeText(step.path), reason: 'undo_ensure_dir' }
    case 'copy_path':
      return { action: 'remove_path', path: target || from, reason: 'undo_copy' }
    case 'write_text_file':
      return backup
        ? { action: 'copy_path', from: backup, to: target, reason: 'restore_backup' }
        : { action: 'remove_path', path: target, reason: 'undo_write' }
    case 'move_path':
    case 'rename_path':
      return { action, from: target, to: from, reason: 'undo_move' }
    case 'patch_ini':
    case 'patch_json':
      return backup
        ? { action: 'copy_path', from: backup, to: target, reason: 'restore_backup' }
        : null
    case 'remove_path':
    case 'remove_empty_dir':
      return backup
        ? { action: 'copy_path', from: backup, to: target, reason: 'restore_deleted' }
        : null
    case 'backup_path':
      return backup ? { action: 'remove_path', path: backup, reason: 'cleanup_backup' } : null
    default:
      // run_command / run_script / execute 等不可自动逆向
      return null
  }
}

export function buildLifecycleRollbackPlan(executedSteps = []) {
  const steps = Array.isArray(executedSteps) ? executedSteps : []
  const reverseSteps = []
  const manual = []

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index] && typeof steps[index] === 'object' ? steps[index] : {}
    const action = toSafeText(step.action).toLowerCase()
    if (!action) continue
    const reverse = reverseStep(action, step)
    if (reverse) {
      reverseSteps.push(reverse)
    } else {
      manual.push({
        action,
        path: toSafeText(step.path || step.to || step.target),
        reason: 'not_auto_reversible'
      })
    }
  }

  return {
    reversible: manual.length === 0,
    steps: reverseSteps,
    manual
  }
}
