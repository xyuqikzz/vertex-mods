import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { assertMatchingSignatures } from './updatePolicy.js'
import { assertLocalPath } from './ipcPolicy.js'

const execute = promisify(execFile)
export async function readAuthenticode(file) {
  assertLocalPath(file)
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  // EncodedCommand plus literal quoting: filenames never become shell syntax.
  const script = `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g,"''")}'; @{status=$s.Status.ToString();subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress`
  try {
    const { stdout } = await execute(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 30000, maxBuffer: 16384,
      // Do not inherit a PowerShell 7/user module search path into Windows PowerShell.
      env: { ...process.env, PSModulePath: path.join(path.dirname(executable), 'Modules') }
    })
    return JSON.parse(stdout.replace(/^\uFEFF/,''))
  } catch { throw new Error('signature_verifier_failed') }
}

export async function verifySignedUpdate(file) {
  assertLocalPath(file)
  if (path.extname(file).toLowerCase() !== '.exe') throw new Error('invalid_update_file')
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_update_file')
  const [current, update] = await Promise.all([readAuthenticode(process.execPath), readAuthenticode(file)])
  assertMatchingSignatures(current, update)
}
