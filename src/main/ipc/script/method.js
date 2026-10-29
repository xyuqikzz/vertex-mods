import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'

const UTF8_BOM = '\uFEFF'
const SELF_DELETE_DELAY_SECONDS = 3

function normalizeScriptType(scriptType = 'bat') {
  return String(scriptType || 'bat')
    .trim()
    .toLowerCase()
}

function normalizeLineEndings(scriptContent = '', scriptType = 'bat') {
  const normalizedContent = String(scriptContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  if (scriptType === 'bat' || scriptType === 'cmd') {
    return normalizedContent.replace(/\n/g, '\r\n')
  }
  return normalizedContent
}

function escapePowerShellText(input = '') {
  return String(input || '').replace(/'/g, "''")
}

function escapeCmdTitle(input = '') {
  return String(input || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .trim()
}

function createTempScriptFile(tempDir, filePrefix, scriptType, scriptContent) {
  const filePath = path.join(tempDir, `${filePrefix}.${scriptType}`)
  const normalizedContent = normalizeLineEndings(scriptContent, scriptType)

  if (scriptType === 'ps1' || scriptType === 'vbs' || scriptType === 'js') {
    fs.writeFileSync(filePath, `${UTF8_BOM}${normalizedContent}`, { encoding: 'utf8', flag: 'wx' })
  } else {
    fs.writeFileSync(filePath, normalizedContent, { encoding: 'utf8', flag: 'wx' })
  }

  return filePath
}

function buildCmdLauncherContent({ scriptPath, launcherPath, runCommand }) {
  const titleText = escapeCmdTitle('Vertex Script Runner')
  const escapedLauncherPath = String(launcherPath || '').replace(/"/g, '""')

  return [
    '@echo off',
    'setlocal',
    `title ${titleText}`,
    'chcp 65001 >nul',
    'echo [Vertex] CMD window started. UTF-8 enabled.',
    'echo.',
    runCommand,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'echo.',
    'echo [Vertex] Script finished.',
    'echo [Vertex] Exit code: %EXIT_CODE%',
    `del /f /q "${scriptPath}" >nul 2>&1`,
    `start "" /min cmd.exe /d /c "ping 127.0.0.1 -n ${SELF_DELETE_DELAY_SECONDS + 1} >nul & del /f /q ""${escapedLauncherPath}"" >nul 2>&1"`,
    'echo.',
    'pause',
    'exit /b %EXIT_CODE%'
  ].join('\r\n')
}

function buildPowerShellLauncherContent({ scriptPath, launcherPath, scriptName }) {
  const safeScriptPath = escapePowerShellText(scriptPath)
  const safeLauncherPath = escapePowerShellText(launcherPath)
  const safeTitle = escapePowerShellText(`Vertex - ${scriptName || '系统脚本'}`)

  return [
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    'try { chcp 65001 > $null } catch {}',
    `try { $Host.UI.RawUI.WindowTitle = '${safeTitle}' } catch {}`,
    `$scriptPath = '${safeScriptPath}'`,
    `$launcherPath = '${safeLauncherPath}'`,
    "Write-Host '[Vertex] 已启动 PowerShell 执行窗口，默认编码 UTF-8。'",
    "Write-Host ''",
    'try {',
    '  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath',
    '  if ($LASTEXITCODE -is [int]) {',
    '    $exitCode = [int]$LASTEXITCODE',
    '  } elseif ($?) {',
    '    $exitCode = 0',
    '  } else {',
    '    $exitCode = 1',
    '  }',
    '} catch {',
    '  $exitCode = 1',
    '  Write-Error $_',
    '}',
    "Write-Host ''",
    "Write-Host '[Vertex] 脚本执行完成。'",
    'Write-Host ("[Vertex] 退出代码：{0}" -f $exitCode)',
    'Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue',
    "$cleanupCommand = 'ping 127.0.0.1 -n 4 >nul & del /f /q \"' + $launcherPath + '\" >nul 2>&1'",
    "Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -ArgumentList @('/d', '/c', $cleanupCommand) -ErrorAction SilentlyContinue",
    "Write-Host ''",
    "Write-Host '按任意键关闭窗口...'",
    "$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')",
    'exit $exitCode'
  ].join('\r\n')
}

function getLaunchPlan(scriptType, scriptPath, scriptName, tempDir, filePrefix) {
  if (scriptType === 'bat' || scriptType === 'cmd') {
    const launcherPath = path.join(tempDir, `${filePrefix}_launcher.cmd`)
    return {
      launcherPath,
      launcherContent: buildCmdLauncherContent({
        scriptPath,
        launcherPath,
        runCommand: `call "${scriptPath}"`
      }),
      shellType: 'CMD',
      command: 'cmd.exe',
      args: ['/d', '/c', 'start', '', 'cmd.exe', '/d', '/c', launcherPath]
    }
  }

  if (scriptType === 'ps1') {
    const launcherPath = path.join(tempDir, `${filePrefix}_launcher.ps1`)
    return {
      launcherPath,
      launcherContent: buildPowerShellLauncherContent({
        scriptPath,
        launcherPath,
        scriptName
      }),
      shellType: 'PowerShell',
      command: 'cmd.exe',
      args: [
        '/d',
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        launcherPath
      ]
    }
  }

  if (scriptType === 'vbs' || scriptType === 'js') {
    const launcherPath = path.join(tempDir, `${filePrefix}_launcher.cmd`)
    return {
      launcherPath,
      launcherContent: buildCmdLauncherContent({
        scriptPath,
        launcherPath,
        runCommand: `cscript.exe //NoLogo "${scriptPath}"`
      }),
      shellType: 'CMD',
      command: 'cmd.exe',
      args: ['/d', '/c', 'start', '', 'cmd.exe', '/d', '/c', launcherPath]
    }
  }

  return null
}

function writeLauncherFile(launcherPath, launcherContent, scriptType) {
  if (scriptType === 'ps1') {
    fs.writeFileSync(launcherPath, `${UTF8_BOM}${launcherContent}`, { encoding: 'utf8', flag: 'wx' })
  } else {
    fs.writeFileSync(launcherPath, launcherContent, { encoding: 'utf8', flag: 'wx' })
  }
}

function launchVisibleProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function cleanupTempFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return

  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    console.error('清理临时脚本文件失败:', error)
  }
}

/**
 * 执行系统优化脚本
 * @param {*} event
 * @param {*} data
 */
export async function executeSystemScript(event, data) {
  const english = data?.locale === 'en-US'
  const scriptContent = String(data?.scriptContent || '')
  const scriptName = String(data?.name || '系统脚本').trim() || '系统脚本'

  let scriptType = normalizeScriptType(data?.type || 'bat')
  if (!data?.type) {
    if (scriptContent.includes('Write-Host') || scriptContent.includes('$')) {
      scriptType = 'ps1'
    } else if (scriptContent.includes('WScript') || scriptContent.includes('CreateObject')) {
      scriptType = 'vbs'
    } else if (scriptContent.includes('@echo') || scriptContent.includes('set ')) {
      scriptType = 'bat'
    }
  }

  if (!['bat', 'cmd', 'ps1', 'vbs', 'js'].includes(scriptType) || !scriptContent.trim()) throw new Error('invalid_system_script')
  const confirmation = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    title: english ? 'Run system script' : '执行系统脚本',
    message: english ? `Run “${scriptName}”?` : `执行“${scriptName}”？`,
    detail: english
      ? 'Scripts can modify your system and files using this app’s permissions. Confirm that you have reviewed the script.'
      : '脚本可以修改系统和文件，并使用当前程序的权限。请确认已核对脚本内容。',
    buttons: english ? ['Cancel', 'Run script'] : ['取消', '执行脚本'], defaultId: 0, cancelId: 0, noLink: true
  })
  if (confirmation.response !== 1) {
    event.reply('executeSystemScriptResult', { success: false, canceled: true, message: '已取消脚本执行' })
    return
  }

  const tempDir = app.getPath('temp')
  const filePrefix = `vertex_script_${randomUUID()}`
  let tempFilePath = null
  let launcherPath = null
  let launched = false

  try {
    tempFilePath = createTempScriptFile(tempDir, filePrefix, scriptType, scriptContent)
    const launchPlan = getLaunchPlan(scriptType, tempFilePath, scriptName, tempDir, filePrefix)

    if (!launchPlan) {
      throw new Error(`不支持的脚本类型: ${scriptType}`)
    }

    launcherPath = launchPlan.launcherPath
    writeLauncherFile(launcherPath, launchPlan.launcherContent, path.extname(launcherPath).slice(1))

    event.reply('executeSystemScriptOutput', {
      stream: 'stdout',
      data: english ? `Created a temporary ${scriptType.toUpperCase()} script; preparing to run in an external ${launchPlan.shellType} window` : `已创建临时 ${scriptType.toUpperCase()} 脚本，准备通过 ${launchPlan.shellType} 外部窗口执行`
    })
    event.reply('executeSystemScriptOutput', {
      stream: 'stdout',
      data: english ? 'The character set is UTF-8. Check the opened window for full output.' : '默认字符集已切换为 UTF-8，完整输出请查看弹出的执行窗口'
    })

    await launchVisibleProcess(launchPlan.command, launchPlan.args)
    launched = true

    event.reply('executeSystemScriptResult', {
      success: true,
      message: `脚本 "${scriptName}" 已在 ${launchPlan.shellType} 窗口启动`,
      output: '已切换为外部执行模式，请在弹出的执行窗口查看完整执行过程和结果。',
      error: null,
      streamed: false,
      externalWindow: true,
      shellType: launchPlan.shellType
    })
  } catch (error) {
    console.error('脚本执行失败:', error)

    event.reply('executeSystemScriptResult', {
      success: false,
      message: '脚本执行失败: 无法启动外部执行窗口',
      output: null,
      error: error?.message || '未知错误'
    })
  } finally {
    if (!launched) {
      cleanupTempFile(tempFilePath)
      cleanupTempFile(launcherPath)
    }
  }
}
