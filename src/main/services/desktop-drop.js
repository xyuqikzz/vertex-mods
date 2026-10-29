import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const exec = promisify(execFile)
const script = `
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'elevated' } else { 'ready' }
`

// The child inherits the desktop process token. Check that token, rather than
// assuming an asInvoker manifest prevents an elevated parent or shortcut.
export function createDropEnvironmentReader({ platform = process.platform, run = exec } = {}) {
  let pending
  return function readDropEnvironment() {
    if (platform !== 'win32') return Promise.resolve({ status: 'ready' })
    if (pending) return pending
    pending = run(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 }
    )
      .then(({ stdout }) => {
        const status = stdout.trim()
        if (!['ready', 'elevated'].includes(status)) throw new Error('unexpected_drop_status')
        return { status }
      })
      .catch(() => {
        pending = undefined
        return { status: 'unavailable' }
      })
    return pending
  }
}
