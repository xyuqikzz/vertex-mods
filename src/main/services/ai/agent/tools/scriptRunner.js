import { spawn, execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  AGENT_SCRIPT_MAX_LENGTH,
  AGENT_SCRIPT_DEFAULT_TIMEOUT_MS,
  AGENT_SCRIPT_MAX_TIMEOUT_MS,
  AGENT_SCRIPT_OUTPUT_LIMIT
} from '../../../../../shared/ai/tools/ai-agent-script.js'

export async function validateAgentScript(args = {}) {
  if (!['bat', 'ps1'].includes(args.type)) throw new Error('只支持 bat 和 ps1 脚本。')
  if (typeof args.scriptContent !== 'string' || !args.scriptContent.trim() ||
      args.scriptContent.length > AGENT_SCRIPT_MAX_LENGTH || args.scriptContent.includes('\0')) {
    throw new Error(`脚本内容不能为空、包含空字符或超过 ${AGENT_SCRIPT_MAX_LENGTH} 个字符。`)
  }
  const timeoutMs = args.timeoutMs ?? AGENT_SCRIPT_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > AGENT_SCRIPT_MAX_TIMEOUT_MS) {
    throw new Error('脚本超时必须是 1000 到 300000 毫秒之间的整数。')
  }
  let workingDirectory = ''
  if (args.workingDirectory) {
    if (typeof args.workingDirectory !== 'string' || !path.isAbsolute(args.workingDirectory)) {
      throw new Error('工作目录必须是已存在的绝对路径。')
    }
    workingDirectory = await realpath(args.workingDirectory)
    if (!(await stat(workingDirectory)).isDirectory()) throw new Error('工作目录不是文件夹。')
  }
  return { type: args.type, scriptContent: args.scriptContent, workingDirectory, timeoutMs }
}

function terminateProcessTree(child) {
  if (!child.pid) return Promise.resolve()
  return new Promise((resolve) => {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 5000, shell: false }, (error) => {
        if (error) child.kill()
        // 已退出的父进程可能留下继承管道的子进程，不能因此永远等待 close。
        child.stdout?.destroy()
        child.stderr?.destroy()
        resolve()
      })
  })
}

export async function runAgentScript(args = {}, { signal } = {}) {
  const startedAt = Date.now()
  if (signal?.aborted) return { success: false, errorCode: 'cancelled', message: '脚本执行已取消。' }
  if (process.platform !== 'win32') return { success: false, errorCode: 'unsupported_platform', message: '脚本执行仅支持 Windows。' }
  const script = await validateAgentScript(args)
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'vertex-agent-script-'))
  const resolvedRoot = path.resolve(temporaryRoot)
  if (path.dirname(resolvedRoot) !== path.resolve(os.tmpdir()) || !path.basename(resolvedRoot).startsWith('vertex-agent-script-')) {
    throw new Error('脚本临时目录超出预期范围。')
  }
  try {
    const scriptPath = path.join(temporaryRoot, `script.${script.type}`)
    const text = script.scriptContent.replace(/\r\n?|\n/g, '\r\n')
    await writeFile(scriptPath, script.type === 'ps1' ? '\uFEFF' + text : text, { flag: 'wx' })
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    let command = path.join(system32, 'cmd.exe')
    // 路径通过环境变量传入，不拼接用户文本到 cmd 命令；禁用 AutoRun 和延迟展开。
    let commandArgs = ['/d', '/s', '/v:off', '/c', '"chcp 65001>nul & "%VERTEX_AGENT_SCRIPT_FILE%""']
    if (script.type === 'ps1') {
      command = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const launcherPath = path.join(temporaryRoot, 'launcher.ps1')
      await writeFile(launcherPath, '\uFEFF' + [
        "$ErrorActionPreference = 'Stop'",
        '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '$OutputEncoding = [Console]::OutputEncoding',
        '$global:LASTEXITCODE = 0',
        'try {',
        '  & $env:VERTEX_AGENT_SCRIPT_FILE',
        '  $vertexScriptSucceeded = $?',
        '  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
        '  if (!$vertexScriptSucceeded) { exit 1 }',
        '  exit $LASTEXITCODE',
        '} catch {',
        '  [Console]::Error.WriteLine($_.ToString())',
        '  exit 1',
        '}'
      ].join('\r\n'), { flag: 'wx' })
      commandArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', launcherPath]
    }
    if (signal?.aborted) return { success: false, errorCode: 'cancelled', message: '脚本执行已取消。' }
    return await new Promise((resolve) => {
      const streams = { stdout: '', stderr: '' }
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
      let outputTruncated = false
      let stopReason = ''
      let killPromise = null
      let launchError = null
      const child = spawn(command, commandArgs, {
        cwd: script.workingDirectory || temporaryRoot,
        env: { ...process.env, VERTEX_AGENT_SCRIPT_FILE: scriptPath },
        windowsHide: true,
        windowsVerbatimArguments: script.type === 'bat',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const append = (stream, text) => {
        const available = AGENT_SCRIPT_OUTPUT_LIMIT - streams[stream].length
        if (text.length > available) outputTruncated = true
        streams[stream] += text.slice(0, Math.max(0, available))
      }
      for (const stream of ['stdout', 'stderr']) {
        child[stream].on('data', (chunk) => append(stream, decoders[stream].write(chunk)))
      }
      const stop = (reason) => {
        if (stopReason) return
        stopReason = reason
        killPromise = terminateProcessTree(child)
      }
      const onAbort = () => stop('cancelled')
      const timer = setTimeout(() => stop('script_timeout'), script.timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      child.once('error', (error) => { launchError = error })
      child.once('close', async (exitCode) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (killPromise) await killPromise
        for (const stream of ['stdout', 'stderr']) append(stream, decoders[stream].end())
        const errorCode = stopReason || (launchError ? 'script_launch_failed' : exitCode !== 0 ? 'script_failed' : '')
        resolve({
          success: !errorCode,
          errorCode,
          message: errorCode === 'cancelled' ? '脚本执行已取消。'
            : errorCode === 'script_timeout' ? '脚本执行超时，已停止进程。'
              : launchError ? `无法启动脚本：${launchError.message}`
                : errorCode ? '脚本执行失败。' : '脚本执行完成。',
          exitCode,
          ...streams,
          outputTruncated,
          durationMs: Date.now() - startedAt
        })
      })
    })
  } finally {
    await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
