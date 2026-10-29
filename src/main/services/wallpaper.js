import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const runPowerShell = promisify(execFile)
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VertexWallpaper {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);
}
'@
if (-not [VertexWallpaper]::SystemParametersInfo(20, 0, $env:VERTEX_WALLPAPER_PATH, 3)) {
  throw 'wallpaper_update_failed'
}
`

export async function setWindowsWallpaper(imagePath, { run = runPowerShell } = {}) {
  if (typeof imagePath !== 'string' || !path.isAbsolute(imagePath) || [...imagePath].some((character) => character.charCodeAt(0) < 32))
    throw new Error('invalid_wallpaper_path')
  // 路径只作为环境数据传入固定脚本，不能改变 PowerShell 或 cmd 的语法。
  await run(
    path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024,
      env: { ...process.env, VERTEX_WALLPAPER_PATH: imagePath } }
  )
}
