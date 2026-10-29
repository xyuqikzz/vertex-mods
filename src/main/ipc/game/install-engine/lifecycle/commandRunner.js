import path from 'path'
import fs from 'fs-extra'
import { spawn } from 'child_process'
import { assertLifecycleCommandPolicy } from '../lifecyclePolicy.js'
import { normalizeLaunchArgumentList } from './runnerUtils.js'
import { buildLifecycleCommandInvocation } from './commandInvocation.js'

const MAX_CAPTURE_BYTES = 64 * 1024
function appendCapturedOutput(previous, chunk) {
  const tail = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''))
  return Buffer.concat([previous, tail.subarray(-MAX_CAPTURE_BYTES)]).subarray(-MAX_CAPTURE_BYTES)
}

async function terminateCommand(child) {
  if (!child?.pid) return
  if (process.platform !== 'win32') { child.kill('SIGTERM'); return }
  await new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.once('error', reject)
    killer.once('exit', (code) => code === 0 || child.exitCode !== null
      ? resolve() : reject(new Error('命令进程树未能完全终止')))
  })
}

function rejectAfterTermination(child, error, reject) {
  void terminateCommand(child).then(() => reject(error), (terminationError) => {
    error.needRecovery = true
    error.message += `；${terminationError.message}`
    reject(error)
  })
}


function escapePowerShellSingleQuotedText(value = '') {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function buildPowerShellStringArrayLiteral(value = []) {
  const safeValue = normalizeLaunchArgumentList(value)
  return `@(${safeValue.map((item) => escapePowerShellSingleQuotedText(item)).join(', ')})`
}

function encodePowerShellCommandText(text = '') {
  return Buffer.from(String(text || ''), 'utf16le').toString('base64')
}

function waitMilliseconds(ms = 0) {
  const safeMs = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Math.floor(Number(ms)) : 0
  if (safeMs <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    setTimeout(resolve, safeMs)
  })
}

async function writeLifecycleCommandStdin(stream = null, inputLines = [], intervalMs = 220) {
  if (!stream || stream.destroyed || stream.writableEnded) {
    return
  }

  const safeInputLines = normalizeLaunchArgumentList(inputLines)
  const safeIntervalMs =
    Number.isFinite(Number(intervalMs)) && Number(intervalMs) >= 0
      ? Math.floor(Number(intervalMs))
      : 220

  if (!safeInputLines.length) {
    if (!stream.destroyed && !stream.writableEnded) {
      stream.end()
    }
    return
  }

  for (let index = 0; index < safeInputLines.length; index += 1) {
    if (stream.destroyed || stream.writableEnded) {
      throw new Error('生命周期命令标准输入已关闭，无法继续写入')
    }

    const currentLine = `${safeInputLines[index]}\r\n`
    await new Promise((resolve, reject) => {
      stream.write(currentLine, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    if (index < safeInputLines.length - 1 && safeIntervalMs > 0) {
      await waitMilliseconds(safeIntervalMs)
    }
  }

  if (safeIntervalMs > 0) {
    await waitMilliseconds(safeIntervalMs)
  }

  if (!stream.destroyed && !stream.writableEnded) {
    stream.end()
  }
}

async function executeLifecycleCommandInNewWindowsConsole(payload = {}) {
  const launchTarget = String(payload?.launchTarget || '').trim()
  const launchArgs = normalizeLaunchArgumentList(payload?.launchArgs || [])
  const workingDirectory =
    String(payload?.workingDirectory || '').trim() || path.dirname(launchTarget)
  const timeoutMs =
    Number.isFinite(Number(payload?.timeoutMs)) && Number(payload.timeoutMs) > 0
      ? Math.floor(Number(payload.timeoutMs))
      : 300000
  const displayTargetPath =
    String(payload?.displayTargetPath || launchTarget).trim() || launchTarget
  const powerShellPath = path.join(
    process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const visibleRunnerScript = [
    "$ErrorActionPreference = 'Stop'",
    `$launchTarget = ${escapePowerShellSingleQuotedText(launchTarget)}`,
    `$launchArgs = ${buildPowerShellStringArrayLiteral(launchArgs)}`,
    `$workingDirectory = ${escapePowerShellSingleQuotedText(workingDirectory)}`,
    'Set-Location -LiteralPath $workingDirectory',
    '$exitCode = 0',
    '$extension = [System.IO.Path]::GetExtension($launchTarget).ToLowerInvariant()',
    "if ($extension -eq '.bat' -or $extension -eq '.cmd') { & $env:ComSpec '/d' '/c' 'call' $launchTarget @launchArgs; $exitCode = $LASTEXITCODE } elseif ($extension -eq '.ps1') { & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $launchTarget @launchArgs; $exitCode = $LASTEXITCODE } else { & $launchTarget @launchArgs; $exitCode = $LASTEXITCODE }",
    'if ($null -eq $exitCode) { $exitCode = 0 }',
    "if ($exitCode -ne 0) { Write-Host ''; Write-Host ('命令执行失败，退出码 {0}' -f $exitCode) -ForegroundColor Yellow; Read-Host '按回车关闭窗口' | Out-Null }",
    'exit $exitCode'
  ].join('; ')
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    `$arguments = ${buildPowerShellStringArrayLiteral([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShellCommandText(visibleRunnerScript)
    ])}`,
    `$process = Start-Process -FilePath ${escapePowerShellSingleQuotedText(powerShellPath)} -ArgumentList $arguments -WorkingDirectory ${escapePowerShellSingleQuotedText(workingDirectory)} -PassThru -Wait -WindowStyle Normal`,
    'exit $process.ExitCode'
  ].join('; ')
  const encodedCommand = encodePowerShellCommandText(psScript)

  await new Promise((resolve, reject) => {
    const child = spawn(
      powerShellPath,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      {
        windowsHide: true,
        stdio: 'ignore'
      }
    )

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectAfterTermination(child, new Error(`生命周期命令执行超时：${displayTargetPath}`), reject)
    }, timeoutMs)

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (Number(code || 0) === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `生命周期命令执行失败（退出码 ${Number(code || 0)}）：${displayTargetPath}\n请查看弹出的控制台窗口输出。`
        )
      )
    })
  })
}

export async function executeLifecycleCommandStep(stepRuntime = {}, payload = {}, dependencies = {}) {
  const launchTargetPath = String(stepRuntime?.resolvedTargetPath || '').trim()
  if (!launchTargetPath) {
    throw new Error('生命周期命令缺少执行路径')
  }

  // B1：执行前再次裁决命令策略（白名单 + 参数安全 + 信任/授权），与分发层形成纵深防御。
  assertLifecycleCommandPolicy(stepRuntime, payload?.lifecycleCommandContext || {})

  const { launchTarget, launchArgs } = buildLifecycleCommandInvocation(stepRuntime)

  await fs.access(launchTargetPath, fs.constants.F_OK)

  const lifecycleName = String(payload?.lifecycleName || 'unknown').trim() || 'unknown'
  let logDebug = () => {}
  if (typeof dependencies?.logInstallRuleDebug === 'function') {
    logDebug = dependencies.logInstallRuleDebug
  } else if (typeof dependencies?.logNexusInstallRuleDebug === 'function') {
    logDebug = dependencies.logNexusInstallRuleDebug
  }
  logDebug('lifecycle.execute', {
    lifecycleName,
    action: stepRuntime.action,
    launchTargetPath,
    launchTarget,
    launchArgs,
    repeat: stepRuntime.repeat,
    stdin: stepRuntime.stdin,
    stdinIntervalMs: stepRuntime.stdinIntervalMs,
    requiresConsole: !!stepRuntime.requiresConsole
  })

  for (let index = 0; index < stepRuntime.repeat; index += 1) {
    if (stepRuntime.requiresConsole) {
      if (stepRuntime.stdin.length) {
        throw new Error('需要真实控制台的生命周期命令不支持 stdin 自动输入，请改用命令行参数')
      }

      await executeLifecycleCommandInNewWindowsConsole({
        launchTarget,
        launchArgs,
        workingDirectory: path.dirname(launchTargetPath),
        timeoutMs: stepRuntime.timeoutMs,
        displayTargetPath: launchTargetPath
      })
      continue
    }

    await new Promise((resolve, reject) => {
      const child = spawn(launchTarget, launchArgs, {
        cwd: path.dirname(launchTargetPath),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let settled = false
      let stderrText = Buffer.alloc(0)
      let stdoutText = Buffer.alloc(0)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        rejectAfterTermination(child, new Error(`生命周期命令执行超时：${launchTargetPath}`), reject)
      }, stepRuntime.timeoutMs)

      child.stdout.on('data', (chunk) => {
        stdoutText = appendCapturedOutput(stdoutText, chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderrText = appendCapturedOutput(stderrText, chunk)
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (Number(code || 0) === 0) {
          resolve()
          return
        }
        reject(
          new Error(
            `生命周期命令执行失败（退出码 ${Number(code || 0)}）：${launchTargetPath}${
              stderrText.toString('utf8').trim()
                ? `\n${stderrText.toString('utf8').trim()}`
                : stdoutText.toString('utf8').trim()
                  ? `\n${stdoutText.toString('utf8').trim()}`
                  : ''
            }`
          )
        )
      })

      void writeLifecycleCommandStdin(
        child.stdin,
        stepRuntime.stdin,
        stepRuntime.stdinIntervalMs
      ).catch((error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectAfterTermination(child, error, reject)
      })
    })
  }
}
