import path from 'node:path'
import { normalizeLaunchArgumentList } from './runnerUtils.js'

// Authorization and execution must use the same interpreter and expanded argument vector.
export function buildLifecycleCommandInvocation(runtime = {}) {
  const target = String(runtime.resolvedTargetPath || '').trim()
  const args = normalizeLaunchArgumentList(runtime.args)
  const extension = path.extname(target).toLowerCase()
  const windows = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  if (extension === '.bat' || extension === '.cmd')
    return {
      launchTarget: process.env.ComSpec || path.join(windows, 'System32', 'cmd.exe'),
      launchArgs: ['/d', '/c', 'call', target, ...args]
    }
  if (extension === '.ps1')
    return {
      launchTarget: path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      launchArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target, ...args]
    }
  return { launchTarget: target, launchArgs: args }
}
