import { app, nativeImage, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { launchTargetByNodeApi } from '../api/index.js'
import { buildResidualCandidates, isSafeResidualPath, isSafeResidualRegistry } from './appUninstallSafety.js'
import { waitForUninstallProcesses } from './uninstallProcessTracker.js'
import { resolveInstalledAppIconCandidates } from './installedAppIconCandidateClient.js'

const execFileAsync = promisify(execFile)
const shortcutVisualCache = new Map()

function runPowerShellJson(script, timeout = 30000) {
  const wrappedScript = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
${String(script || '').trim()}
`

  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', wrappedScript],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
      timeout
    }
  ).then(({ stdout }) => {
    const content = String(stdout || '')
      .replace(/^\uFEFF/, '')
      .trim()
    if (!content) return []
    return JSON.parse(content)
  })
}

function normalizeUninstallCommand(command = '') {
  let text = String(command).trim()
  if (!text) return ''

  // MSI 的修改命令通常是 /I，卸载场景统一转换成 /X
  if (/msiexec(\.exe)?/i.test(text)) {
    text = text.replace(/\/I(\s*\{[A-Z0-9-]+\})/i, '/X$1')
    text = text.replace(/\s+\/I\s+/i, ' /X ')
  }

  return text
}

function expandWindowsEnvPath(input = '') {
  return String(input).replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`)
}

function extractExecutablePath(value = '') {
  const source = String(value || '').trim()
  if (!source) return ''

  const cleaned = expandWindowsEnvPath(source.replace(/^@/, '').split(',')[0].trim())
  const quoteMatch = cleaned.match(/"([^"]+\.(?:exe|ico|dll))"/i)
  if (quoteMatch?.[1]) return quoteMatch[1]

  const pathMatch = cleaned.match(/([a-zA-Z]:\\[^"']+\.(?:exe|ico|dll))/i)
  if (pathMatch?.[1]) return pathMatch[1]

  if (/^[a-zA-Z]:\\/.test(cleaned) && /\.(?:exe|ico|dll)$/i.test(cleaned)) return cleaned
  return ''
}

/**
 * 宽松提取文件路径（不限制扩展名），用于 PowerShell 回退提取图标
 */
function extractRawFilePath(value = '') {
  const source = String(value || '').trim()
  if (!source) return ''

  const cleaned = expandWindowsEnvPath(source.replace(/^@/, '').split(',')[0].trim())
  const quoteMatch = cleaned.match(/"([^"]+)"/)
  if (quoteMatch?.[1] && /^[a-zA-Z]:\\/.test(quoteMatch[1])) return quoteMatch[1]

  const pathMatch = cleaned.match(/([a-zA-Z]:\\[^"'\s]+)/)
  if (pathMatch?.[1]) return pathMatch[1]

  if (/^[a-zA-Z]:\\/.test(cleaned)) return cleaned
  return ''
}

function extractProtocolUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const match = text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/i)
  return match?.[0] || ''
}

function extractCommandExecutableName(command = '') {
  const text = String(command || '').trim()
  if (!text) return ''

  const quoteMatch = text.match(/^"([^"]+)"/)
  if (quoteMatch?.[1]) {
    return path.basename(quoteMatch[1])
  }

  const token = text.split(/\s+/)[0]
  if (!token) return ''

  if (token.includes('\\') || token.includes('/')) {
    return path.basename(token)
  }

  if (/\.(exe|cmd|bat|com)$/i.test(token)) {
    return token
  }

  if (/^[a-z0-9_.-]+$/i.test(token)) {
    return `${token}.exe`
  }

  return ''
}

function normalizeCommandForCmdShell(command = '') {
  let text = String(command || '').trim()
  if (!text) return ''

  if (/^'".*"$/.test(text) || /^'.*'$/.test(text)) {
    text = text.slice(1, -1).trim()
  }

  text = text.replace(/'(".*?")'/g, '$1')
  text = text.replace(/'([a-zA-Z]:\\[^']+\.(?:exe|cmd|bat|com))'/g, '$1')

  return text.trim()
}

function tokenizeWindowsArgs(text = '') {
  const source = String(text || '').trim()
  if (!source) return []

  const args = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) {
    args.push(current)
  }

  return args
}

function parseLaunchTargetFromCommand(command = '') {
  const normalized = normalizeCommandForCmdShell(command)
  if (!normalized) {
    return {
      command: '',
      target: '',
      args: []
    }
  }

  const quotedMatch = normalized.match(/^"([^"]+\.(?:exe|cmd|bat|com))"\s*(.*)$/i)
  if (quotedMatch?.[1]) {
    return {
      command: normalized,
      target: quotedMatch[1],
      args: tokenizeWindowsArgs(quotedMatch[2] || '')
    }
  }

  const absoluteMatch = normalized.match(/^([a-zA-Z]:\\[^\s]+\.(?:exe|cmd|bat|com))\s*(.*)$/i)
  if (absoluteMatch?.[1]) {
    return {
      command: normalized,
      target: absoluteMatch[1],
      args: tokenizeWindowsArgs(absoluteMatch[2] || '')
    }
  }

  return {
    command: normalized,
    target: '',
    args: []
  }
}

function normalizeRegistryPath(psPath = '') {
  return String(psPath || '')
    .replace(/^Microsoft\.PowerShell\.Core\\Registry::/i, '')
    .trim()
}

function normalizeInstallDateText(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^\d{8}$/.test(text)) return text

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function isValidInstallDateText(value = '') {
  return /^\d{8}$/.test(String(value || '').trim())
}

function formatDateByTimestamp(timestamp = 0) {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function normalizeEstimatedSizeKb(value = 0) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.max(0, Math.round(num))
}

function normalizePathKey(targetPath = '') {
  const text = String(targetPath || '').trim()
  if (!text) return ''
  try {
    return path.resolve(text).toLowerCase()
  } catch {
    return text.toLowerCase()
  }
}

function resolveExistingDirectory(input = '') {
  const source = String(input || '')
    .trim()
    .replace(/^"|"$/g, '')
  if (!source) return ''

  const expanded = expandWindowsEnvPath(source)
  let resolvedPath = expanded

  try {
    resolvedPath = path.resolve(expanded)
  } catch {
    // 忽略路径解析异常，后续再做存在性检查
  }

  if (!fs.existsSync(resolvedPath)) return ''

  try {
    const stat = fs.statSync(resolvedPath)
    if (stat.isDirectory()) return resolvedPath
    if (stat.isFile()) return path.dirname(resolvedPath)
  } catch {
    return ''
  }

  return ''
}

function shouldSkipInstallDirSizeScan(targetPath = '') {
  const p = String(targetPath || '').trim()
  if (!p) return true
  if (/^[a-zA-Z]:\\?$/.test(p)) return true

  let resolvedPath = p
  try {
    resolvedPath = path.resolve(p)
  } catch {
    // 路径异常时交给后续存在性判断
  }

  const lower = resolvedPath.toLowerCase()
  const blockedRoots = new Set([
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata',
    'c:\\users'
  ])
  if (blockedRoots.has(lower)) return true

  const parsed = path.parse(resolvedPath)
  const depth = resolvedPath
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .filter(Boolean).length

  return depth < 2
}

function parseSteamAppId(item = {}) {
  const candidates = [item?.id, item?.registryPath]
  for (const value of candidates) {
    const text = String(value || '').trim()
    if (!text) continue
    const match = text.match(/steam app\s*([0-9]{3,})/i)
    if (match?.[1]) return match[1]
  }
  return ''
}

function resolveInstallDirCandidates(item = {}) {
  const set = new Set()

  const pushDir = (source) => {
    const dir = resolveExistingDirectory(source)
    if (!dir || shouldSkipInstallDirSizeScan(dir)) return
    set.add(dir)
  }

  pushDir(item.installLocation)
  pushDir(item.iconSource)
  pushDir(extractExecutablePath(item.displayIcon))
  pushDir(extractExecutablePath(item.uninstallString))
  pushDir(extractExecutablePath(item.quietUninstallString))

  return Array.from(set)
}

function resolveSteamManifestPath(item = {}, installDirs = []) {
  const appId = parseSteamAppId(item)
  if (!appId) return ''

  const pathSet = new Set()
  const addCandidate = (targetPath = '') => {
    const text = String(targetPath || '').trim()
    if (!text) return
    try {
      pathSet.add(path.resolve(text))
    } catch {
      pathSet.add(text)
    }
  }

  const installLocation = resolveExistingDirectory(item.installLocation)
  if (installLocation) {
    addCandidate(path.join(installLocation, `appmanifest_${appId}.acf`))
    addCandidate(path.join(installLocation, '..', `appmanifest_${appId}.acf`))

    const marker = `${path.sep}steamapps${path.sep}common${path.sep}`.toLowerCase()
    const lowerPath = `${installLocation.toLowerCase()}${path.sep}`
    const markerIndex = lowerPath.indexOf(marker)
    if (markerIndex > 0) {
      const steamAppsDir = installLocation.slice(0, markerIndex + `${path.sep}steamapps`.length)
      addCandidate(path.join(steamAppsDir, `appmanifest_${appId}.acf`))
    }
  }

  for (const dir of installDirs) {
    addCandidate(path.join(dir, `appmanifest_${appId}.acf`))
    addCandidate(path.join(dir, '..', `appmanifest_${appId}.acf`))
    addCandidate(path.join(dir, 'steamapps', `appmanifest_${appId}.acf`))
  }

  for (const candidate of pathSet) {
    if (fs.existsSync(candidate)) return candidate
  }

  return ''
}

function parseSteamManifestMeta(manifestPath = '') {
  const filePath = String(manifestPath || '').trim()
  if (!filePath || !fs.existsSync(filePath)) {
    return { sizeKb: 0, installDate: '' }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const sizeMatch = content.match(/"SizeOnDisk"\s*"(\d+)"/i)
    const updatedMatch = content.match(/"LastUpdated"\s*"(\d+)"/i)

    const sizeBytes = Number(sizeMatch?.[1] || 0)
    const updatedSeconds = Number(updatedMatch?.[1] || 0)

    return {
      sizeKb: sizeBytes > 0 ? Math.round(sizeBytes / 1024) : 0,
      installDate: updatedSeconds > 0 ? formatDateByTimestamp(updatedSeconds * 1000) : ''
    }
  } catch {
    return { sizeKb: 0, installDate: '' }
  }
}

async function getDirectoryMetaByPaths(pathList = []) {
  const uniquePaths = Array.from(
    new Set(
      (Array.isArray(pathList) ? pathList : [])
        .map((item) => resolveExistingDirectory(item))
        .filter(Boolean)
    )
  )

  if (!uniquePaths.length) return new Map()

  const escapedPaths = uniquePaths.map((item) => `'${escapePowerShellText(item)}'`).join(',\n  ')

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  ${escapedPaths}
)
$result = foreach ($p in $paths) {
  if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path -LiteralPath $p)) {
    $bytes = 0
    try {
      $bytes = (Get-ChildItem -LiteralPath $p -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      if (-not $bytes) {
        $bytes = 0
      }
    } catch {
      $bytes = 0
    }

    $createdDate = ''
    $updatedDate = ''
    try {
      $dirItem = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
      if ($dirItem) {
        $createdDate = $dirItem.CreationTime.ToString('yyyyMMdd')
        $updatedDate = $dirItem.LastWriteTime.ToString('yyyyMMdd')
      }
    } catch {
      $createdDate = ''
      $updatedDate = ''
    }

    [PSCustomObject]@{
      path = $p
      bytes = [Int64]$bytes
      createdDate = $createdDate
      updatedDate = $updatedDate
    }
  }
}
$result | ConvertTo-Json -Depth 6 -Compress
`

  try {
    const rawResult = await runPowerShellJson(script)
    const rowList = Array.isArray(rawResult) ? rawResult : rawResult ? [rawResult] : []
    const resultMap = new Map()

    for (const row of rowList) {
      const key = normalizePathKey(row?.path)
      if (!key) continue
      resultMap.set(key, {
        bytes: Number(row?.bytes || 0),
        createdDate: normalizeInstallDateText(row?.createdDate || ''),
        updatedDate: normalizeInstallDateText(row?.updatedDate || '')
      })
    }

    return resultMap
  } catch {
    return new Map()
  }
}

async function enrichInstalledApps(appList = [], { scanDirectories = false } = {}) {
  const list = (Array.isArray(appList) ? appList : []).map((item) => ({
    ...item,
    estimatedSize: normalizeEstimatedSizeKb(item.estimatedSize),
    installDate: normalizeInstallDateText(item.installDate)
  }))

  const pathSet = new Set()
  const pendingItems = []

  for (const item of list) {
    const installDirs = resolveInstallDirCandidates(item)
    const steamManifestPath = resolveSteamManifestPath(item, installDirs)
    const steamMeta = steamManifestPath ? parseSteamManifestMeta(steamManifestPath) : null

    if (item.estimatedSize <= 0 && Number(steamMeta?.sizeKb || 0) > 0) {
      item.estimatedSize = Number(steamMeta.sizeKb)
    }

    if (!isValidInstallDateText(item.installDate) && steamMeta?.installDate) {
      item.installDate = steamMeta.installDate
    }

    if (
      (item.estimatedSize <= 0 || !isValidInstallDateText(item.installDate)) &&
      installDirs.length
    ) {
      pendingItems.push({ item, installDirs })
      installDirs.forEach((dir) => pathSet.add(dir))
    }
  }

  if (!scanDirectories || !pendingItems.length || !pathSet.size) return list

  const directoryMetaMap = await getDirectoryMetaByPaths(Array.from(pathSet))
  if (!directoryMetaMap.size) return list

  for (const row of pendingItems) {
    const { item, installDirs } = row
    for (const dir of installDirs) {
      const meta = directoryMetaMap.get(normalizePathKey(dir))
      if (!meta) continue

      if (item.estimatedSize <= 0 && Number(meta.bytes) > 0) {
        item.estimatedSize = Math.round(meta.bytes / 1024)
      }

      if (!isValidInstallDateText(item.installDate)) {
        if (isValidInstallDateText(meta.createdDate)) {
          item.installDate = meta.createdDate
        } else if (isValidInstallDateText(meta.updatedDate)) {
          item.installDate = meta.updatedDate
        }
      }

      if (item.estimatedSize > 0 && isValidInstallDateText(item.installDate)) {
        break
      }
    }
  }

  return list
}

function dedupeApps(appList = []) {
  const map = new Map()
  for (const appItem of appList) {
    const key = normalizeRegistryPath(appItem.registryPath).toLowerCase()

    if (!map.has(key)) {
      map.set(key, appItem)
    }
  }
  return Array.from(map.values())
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getProcessIdsByName(processName = '') {
  const name = String(processName || '').trim()
  if (!name) return []

  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 5
      }
    )

    const text = String(stdout || '').trim()
    if (!text || /^INFO:/i.test(text)) return []

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.replace(/^"|"$/g, '').split('","')
        const pid = Number(parts[1])
        return Number.isNaN(pid) ? 0 : pid
      })
      .filter((pid) => pid > 0)
  } catch {
    return []
  }
}

function escapePowerShellText(input = '') {
  return String(input || '').replace(/'/g, "''")
}

async function appActivateByPid(pid = 0) {
  const targetPid = Number(pid)
  if (!targetPid || Number.isNaN(targetPid)) return false

  try {
    // 使用 keybd_event 模拟 Alt 键按下/释放来绕过 Windows 对 SetForegroundWindow 的限制
    // 同时枚举进程所有窗口（不仅 MainWindowHandle），并添加 BringWindowToTop 作为补充
    const script = `
      Add-Type @"
        using System;
        using System.Collections.Generic;
        using System.Runtime.InteropServices;
        public class Win32Activate {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool SetForegroundWindow(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

          [DllImport("user32.dll")]
          public static extern bool BringWindowToTop(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

          [DllImport("user32.dll")]
          public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

          public static List<IntPtr> GetProcessWindows(uint pid) {
            var windows = new List<IntPtr>();
            EnumWindows((hWnd, lParam) => {
              uint wpid;
              GetWindowThreadProcessId(hWnd, out wpid);
              if (wpid == pid && IsWindowVisible(hWnd)) {
                windows.Add(hWnd);
              }
              return true;
            }, IntPtr.Zero);
            return windows;
          }

          public static bool ActivateWindow(IntPtr hWnd) {
            // 模拟 Alt 键按下再释放，绕过 Windows 前台窗口限制
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            ShowWindow(hWnd, 9);
            BringWindowToTop(hWnd);
            return SetForegroundWindow(hWnd);
          }
        }
      "@
      $process = Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue
      if (-not $process) { exit }

      # 先尝试 MainWindowHandle
      if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
        if ([Win32Activate]::ActivateWindow($process.MainWindowHandle)) {
          Write-Output 'ok'
          exit
        }
      }

      # 回退：枚举该进程所有可见窗口并逐一尝试激活
      $windows = [Win32Activate]::GetProcessWindows(${targetPid})
      foreach ($hwnd in $windows) {
        if ([Win32Activate]::ActivateWindow($hwnd)) {
          Write-Output 'ok'
          exit
        }
      }
    `
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    )
    return String(stdout || '').includes('ok')
  } catch {
    return false
  }
}

async function appActivateByText(target = '') {
  const text = String(target || '').trim()
  if (!text) return false

  try {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32Text {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool SetForegroundWindow(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

          [DllImport("user32.dll")]
          public static extern bool BringWindowToTop(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        }
      "@
      $processes = Get-Process -Name '${escapePowerShellText(text)}' -ErrorAction SilentlyContinue
      $activated = $false
      foreach ($p in $processes) {
        if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
          [Win32Text]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
          [Win32Text]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
          [Win32Text]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
          [Win32Text]::BringWindowToTop($p.MainWindowHandle) | Out-Null
          if ([Win32Text]::SetForegroundWindow($p.MainWindowHandle)) {
            $activated = $true
            break
          }
        }
      }
      if ($activated) { Write-Output 'ok' }
    `
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    )
    return String(stdout || '').includes('ok')
  } catch {
    return false
  }
}

async function tryActivateProcessWindow(processName = '', existingPids = [], timeoutMs = 15000) {
  const name = String(processName || '').trim()
  if (!name) return false

  const existedSet = new Set(existingPids)
  const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 15000)
  while (Date.now() < deadline) {
    const current = await getProcessIdsByName(name)
    const newPids = current.filter((pid) => !existedSet.has(pid))
    const candidatePids = newPids.length ? newPids : current.slice(-1)

    for (let index = candidatePids.length - 1; index >= 0; index -= 1) {
      const activated = await appActivateByPid(candidatePids[index])
      if (activated) return true
    }

    await sleep(500)
  }

  const baseName = name.replace(/\.exe$/i, '')
  const activatedByBaseName = await appActivateByText(baseName)
  if (activatedByBaseName) return true
  return appActivateByText(name)
}

async function getUninstallProcessSnapshot() {
  const rows = await runPowerShellJson(`
$ErrorActionPreference = 'Stop'
@(Get-CimInstance Win32_Process | ForEach-Object {
  [PSCustomObject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = $_.Name; created = [string]$_.CreationDate }
}) | ConvertTo-Json -Compress
`, 10000)
  return (Array.isArray(rows) ? rows : rows ? [rows] : []).map((row) => ({
    pid: Number(row.pid), parentPid: Number(row.parentPid), name: String(row.name || ''), created: String(row.created || '')
  }))
}

async function resolveShortcutVisualSources(shortcutPaths = []) {
  const rawList = Array.isArray(shortcutPaths) ? shortcutPaths : []
  const uniquePaths = Array.from(
    new Set(
      rawList
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((item) => {
          try {
            return path.resolve(item)
          } catch {
            return item
          }
        })
    )
  )
  if (!uniquePaths.length) return []

  const result = []
  const pendingPaths = []

  for (const shortcutPath of uniquePaths) {
    if (shortcutVisualCache.has(shortcutPath)) {
      const cached = shortcutVisualCache.get(shortcutPath) || []
      if (Array.isArray(cached) && cached.length > 0) {
        result.push(...cached)
        continue
      }
    }
    pendingPaths.push(shortcutPath)
  }

  if (pendingPaths.length) {
    const escapedPaths = pendingPaths.map((p) => `'${escapePowerShellText(p)}'`).join(',\n  ')
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$wsh = New-Object -ComObject WScript.Shell
$links = @(
  ${escapedPaths}
)
$result = foreach ($lnk in $links) {
  if (Test-Path -LiteralPath $lnk) {
    try {
      $s = $wsh.CreateShortcut($lnk)
      [PSCustomObject]@{
        shortcutPath = $lnk
        targetPath = [string]$s.TargetPath
        iconLocation = [string]$s.IconLocation
      }
    } catch {
      [PSCustomObject]@{
        shortcutPath = $lnk
        targetPath = ''
        iconLocation = ''
      }
    }
  }
}
$result | ConvertTo-Json -Depth 6 -Compress
`

    let rowList = []
    try {
      const rawRows = await runPowerShellJson(script)
      rowList = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : []
    } catch {
      rowList = []
    }

    const rowMap = new Map()
    for (const row of rowList) {
      const sourcePath = String(row?.shortcutPath || '').trim()
      if (!sourcePath) continue
      let resolvedShortcut = sourcePath
      try {
        resolvedShortcut = path.resolve(sourcePath)
      } catch {
        resolvedShortcut = sourcePath
      }
      rowMap.set(resolvedShortcut, row)
    }

    for (const shortcutPath of pendingPaths) {
      const row = rowMap.get(shortcutPath) || {}
      const candidateSet = new Set()

      const pushCandidateFile = (value = '') => {
        const filePath =
          extractExecutablePath(value) ||
          extractRawFilePath(value) ||
          expandWindowsEnvPath(String(value || '').trim()).replace(/^"|"$/g, '')
        if (!filePath) return
        try {
          const resolvedPath = path.resolve(filePath)
          if (!fs.existsSync(resolvedPath)) return
          if (!fs.statSync(resolvedPath).isFile()) return
          candidateSet.add(resolvedPath)
        } catch {
          // 忽略无效路径
        }
      }

      pushCandidateFile(row?.iconLocation)
      pushCandidateFile(row?.targetPath)

      const candidateList = Array.from(candidateSet)
      if (candidateList.length) {
        shortcutVisualCache.set(shortcutPath, candidateList)
      } else {
        shortcutVisualCache.delete(shortcutPath)
      }
      result.push(...candidateList)
    }
  }

  return Array.from(new Set(result))
}

function isLikelyUninstallerPath(filePath = '') {
  const rawPath = String(filePath || '').trim()
  const baseName = path.basename(rawPath).toLowerCase()
  if (!baseName) return false
  if (baseName === 'msiexec.exe') return true
  if (/^unins\d*\.exe$/i.test(baseName)) return true
  if (/^uninst(?:all(?:er)?)?(\d+)?\.exe$/i.test(baseName)) return true
  if (baseName.includes('uninstall')) return true

  // 兼容中文/多语言命名的卸载器，例如“xxx卸载.exe”“remove_xxx.exe”
  const text = `${rawPath} ${baseName}`.toLowerCase()
  if (/(?:卸载|移除|删除)/.test(text)) return true
  if (/(?:remove|unist|deinstall|desinstal)/i.test(text)) return true
  return false
}

async function registryKeyExists(registryPath = '') {
  const result = await runPowerShellJson(`
$ErrorActionPreference = 'Stop'
[PSCustomObject]@{ exists = [bool](Test-Path -LiteralPath 'Registry::${escapePowerShellText(registryPath)}' -ErrorAction Stop) } | ConvertTo-Json -Compress
`, 10000)
  return result.exists === true
}

async function deleteRegistryKey(registryPath) {
  await execFileAsync('reg', ['delete', registryPath, '/f'], {
    windowsHide: true, maxBuffer: 1024 * 1024, timeout: 15000
  })
}

async function getResidualFileIdentity(targetPath) {
  if (!isSafeResidualPath(targetPath)) throw new Error('拒绝清理系统、共享或无效路径')
  try {
    // Check every ancestor, not just the leaf: a junction can redirect a safe-looking path.
    let current = targetPath
    while (current !== path.dirname(current)) {
      const stat = await fs.promises.lstat(current)
      if (stat.isSymbolicLink()) throw new Error('拒绝清理经过符号链接或目录联接的路径')
      current = path.dirname(current)
    }
    const stat = await fs.promises.lstat(targetPath)
    const realPath = await fs.promises.realpath(targetPath)
    if (realPath.toLowerCase() !== path.resolve(targetPath).toLowerCase()) throw new Error('清理路径已发生重定向')
    return { realPath, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function listInstalledApps({ metadata = true, enrich = false } = {}) {
  const script = `
$ErrorActionPreference = 'Stop'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = foreach ($path in $paths) {
  if (-not (Test-Path $path)) { continue }
  Get-ItemProperty $path -ErrorAction Stop |
    Where-Object {
      $_.DisplayName -and
      $_.SystemComponent -ne 1
    } |
    Select-Object @{
      Name = 'id'
      Expression = { $_.PSChildName }
    }, @{
      Name = 'displayName'
      Expression = { $_.DisplayName }
    }, @{
      Name = 'displayVersion'
      Expression = { $_.DisplayVersion }
    }, @{
      Name = 'publisher'
      Expression = { $_.Publisher }
    }, @{
      Name = 'installLocation'
      Expression = { $_.InstallLocation }
    }, @{
      Name = 'installDate'
      Expression = {
        $rawDate = $_.InstallDate
        if ($rawDate -and $rawDate.ToString().Trim()) {
          $rawDate.ToString().Trim()
        } else {
          try {
            if ($_.InstallLocation -and (Test-Path -LiteralPath $_.InstallLocation)) {
              (Get-Item -LiteralPath $_.InstallLocation).CreationTime.ToString('yyyyMMdd')
            } else {
              ''
            }
          } catch {
            ''
          }
        }
      }
    }, @{
      Name = 'estimatedSize'
      Expression = { $_.EstimatedSize }
    }, @{
      Name = 'uninstallString'
      Expression = { $_.UninstallString }
    }, @{
      Name = 'quietUninstallString'
      Expression = { $_.QuietUninstallString }
    }, @{
      Name = 'displayIcon'
      Expression = { $_.DisplayIcon }
    }, @{
      Name = 'registryPath'
      Expression = { ($_.PSPath -replace '^Microsoft.PowerShell.Core\\\\Registry::', '') }
    }, @{
      Name = 'windowsInstaller'
      Expression = { $_.WindowsInstaller }
    }, @{
      Name = 'noRemove'
      Expression = { $_.NoRemove }
    }
}
$apps |
  Sort-Object -Property displayName |
  ConvertTo-Json -Depth 6 -Compress
`

  const result = await runPowerShellJson(script)
  const list = Array.isArray(result) ? result : result ? [result] : []

  const normalizedList = dedupeApps(list).map((item) => ({
    ...item,
    installDate: normalizeInstallDateText(item.installDate),
    uninstallString: normalizeUninstallCommand(item.uninstallString),
    quietUninstallString: normalizeUninstallCommand(item.quietUninstallString),
    registryPath: normalizeRegistryPath(item.registryPath),
    iconSource: extractExecutablePath(item.displayIcon)
  }))

  return metadata ? enrichInstalledApps(normalizedList, { scanDirectories: enrich }) : normalizedList
}

export async function runUninstallAndWait(uninstallCommand = '', options = {}) {
  const command = normalizeUninstallCommand(uninstallCommand)
  if (!command) throw new Error('未找到可执行的卸载命令')
  const waitTimeoutMs = Number(options.waitTimeoutMs) || 30 * 60 * 1000
  const { command: commandForExecution, target, args } = parseLaunchTargetFromCommand(command)
  const processName = path.basename(target || extractExecutablePath(commandForExecution) || extractCommandExecutableName(commandForExecution))
  const url = extractProtocolUrl(commandForExecution)
  // A URL argument of an ordinary uninstaller must not replace the executable.
  const protocolUrl = commandForExecution === url ||
    (/^steam\.exe$/i.test(processName) && /^steam:\/\/uninstall\/\d+\/?$/i.test(url)) ? url : ''
  const isMsi = /^msiexec(?:\.exe)?$/i.test(processName)
  const startedAt = Date.now()
  let started = false
  const reportStarted = () => {
    if (started) return
    started = true
    options.onStarted?.({ command, processName })
  }
  if (protocolUrl) {
    // Opening a protocol only acknowledges dispatch. The caller must poll installation state.
    await shell.openExternal(protocolUrl)
    reportStarted()
    return { command, exitCode: null, launchOnly: true, timeout: false, isMsi, durationMs: Date.now() - startedAt }
  }
  const baseline = await getUninstallProcessSnapshot()
  const existingPids = baseline.filter((row) => row.name.toLowerCase() === processName.toLowerCase()).map((row) => row.pid)
  const state = { pid: 0, closed: false, exitCode: null, error: null }
  try {
    const shellPath = process.env.ComSpec || path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe')
    const result = launchTargetByNodeApi(target || shellPath, target ? args : ['/d', '/s', '/c', commandForExecution], (event = {}) => {
      if (Number(event.pid) > 0) state.pid = Number(event.pid)
      if (event.event === 'start_failed') state.error = new Error(event.message || '启动卸载程序失败')
      if (event.event === 'started') reportStarted()
      if (event.event === 'closed') {
        state.closed = true
        state.exitCode = typeof event.exitCode === 'number' ? event.exitCode : null
      }
    })
    if (result?.ok === false) throw new Error(result.error || '启动卸载程序失败')
    if (state.error) throw state.error
    if (Number(result?.pid) > 0) state.pid = Number(result.pid)
    reportStarted()
    if (processName) void tryActivateProcessWindow(processName, existingPids, 10000)
    if (result?.watchSupported === false) {
      return { command, exitCode: null, launchOnly: true, timeout: false, isMsi, durationMs: Date.now() - startedAt }
    }
    const watched = await waitForUninstallProcesses({
      baseline, getSnapshot: getUninstallProcessSnapshot, getLaunchState: () => state,
      processName, timeoutMs: Math.max(1, waitTimeoutMs - (Date.now() - startedAt))
    })
    return { command, ...watched, isMsi, durationMs: Date.now() - startedAt }
  } catch (error) {
    error.started = started
    throw error
  }
}

export async function scanUninstallResiduals(appInfo = {}, installedApps = []) {
  const fileItems = [], registryItems = []
  const candidates = buildResidualCandidates(appInfo, installedApps)
  for (const candidate of candidates) {
    if (candidate.type === 'file') {
      const fileIdentity = await getResidualFileIdentity(candidate.path)
      if (fileIdentity) fileItems.push({ ...candidate, fileIdentity, id: `file-${fileItems.length + 1}` })
    } else if (await registryKeyExists(candidate.path)) {
      registryItems.push({ ...candidate, id: `registry-${registryItems.length + 1}` })
    }
  }
  return { fileItems, registryItems, totalCount: fileItems.length + registryItems.length }
}

export async function cleanupUninstallResiduals(items = [], { appInfo, installedApps = [] } = {}) {
  if (!appInfo?.registryPath) throw new Error('清理缺少应用归属，请重新扫描')
  const allowed = new Set(buildResidualCandidates(appInfo, installedApps).map((item) => `${item.type}:${item.path.toLowerCase()}`))
  const failedItems = []
  let successCount = 0
  for (const item of items) {
    try {
      if (!allowed.has(`${item.type}:${item.path.toLowerCase()}`)) throw new Error('清理范围已变化，请重新扫描')
      if (item.type === 'file') {
        const identity = await getResidualFileIdentity(item.path)
        if (identity) {
          if (!item.fileIdentity || Object.keys(identity).some((key) => identity[key] !== item.fileIdentity[key])) {
            throw new Error('目录或文件在扫描后已被替换，请重新扫描')
          }
          await fs.promises.rm(item.path, { recursive: true, force: true, maxRetries: 2 })
          try {
            await fs.promises.lstat(item.path)
            throw new Error('文件残留删除后仍存在')
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
        }
      } else if (item.type === 'registry') {
        if (!isSafeResidualRegistry(item.path, appInfo.registryPath)) throw new Error('拒绝清理受保护的注册表项')
        if (await registryKeyExists(item.path)) await deleteRegistryKey(item.path)
        if (await registryKeyExists(item.path)) throw new Error('注册表残留删除后仍存在')
      } else throw new Error('不支持的清理类型')
      successCount++
    } catch (error) {
      failedItems.push({ id: item.id, type: item.type, path: item.path, message: error.message || '清理失败' })
    }
  }
  return { success: failedItems.length === 0, totalCount: items.length, successCount, failedItems }
}

async function buildIconCandidatePaths(iconPayload = {}) {
  const payload =
    typeof iconPayload === 'string' ? { iconSource: iconPayload } : { ...(iconPayload || {}) }

  const primarySet = new Set()
  const fallbackSet = new Set()
  const shortcutPathSet = new Set()

  const pushPath = (filePath = '', isFallback = false) => {
    if (!filePath) return
    if (!fs.existsSync(filePath)) return
    const resolvedPath = path.resolve(filePath)
    if (/\.lnk$/i.test(resolvedPath)) {
      shortcutPathSet.add(resolvedPath)
      return
    }
    if (isFallback) {
      fallbackSet.add(resolvedPath)
    } else {
      primarySet.add(resolvedPath)
    }
  }

  const pushExecutable = (value = '', fallbackWhenUninstaller = false) => {
    const filePath = extractExecutablePath(value)
    if (!filePath) return
    const isFallback = fallbackWhenUninstaller && isLikelyUninstallerPath(filePath)
    pushPath(filePath, isFallback)
  }

  const pushRawFile = (value = '', fallbackWhenUninstaller = false) => {
    const filePath = extractRawFilePath(value)
    if (!filePath) return
    try {
      if (!fs.existsSync(filePath)) return
      if (!fs.statSync(filePath).isFile()) return
      const isFallback = fallbackWhenUninstaller && isLikelyUninstallerPath(filePath)
      pushPath(filePath, isFallback)
    } catch {
      // 忽略路径错误
    }
  }

  const pushDirectory = (value = '', isFallback = true) => {
    const dirPath = resolveExistingDirectory(value)
    if (!dirPath) return
    pushPath(dirPath, isFallback)
  }

  // 目录和快捷方式扫描在 Node Worker 中执行，避免阻塞 Electron 主事件循环。
  let workerCandidates = []
  try {
    workerCandidates = await resolveInstalledAppIconCandidates(payload)
  } catch {
    workerCandidates = []
  }
  for (const candidatePath of workerCandidates) {
    pushPath(candidatePath)
  }

  // 2. 先解引用 .lnk 候选，优先使用快捷方式声明的目标图标
  let shortcutVisualSources = []
  if (shortcutPathSet.size) {
    shortcutVisualSources = await resolveShortcutVisualSources(Array.from(shortcutPathSet))
    for (const sourcePath of shortcutVisualSources) {
      if (/\.lnk$/i.test(String(sourcePath || ''))) continue
      pushPath(sourcePath)
    }
  }

  // 3. 再从主程序字段提取图标
  pushExecutable(payload.displayIcon)
  pushRawFile(payload.displayIcon)

  // 兼容历史数据中的 iconSource、卸载命令与目录图标（低优先级兜底）
  pushExecutable(payload.iconSource, true)
  pushRawFile(payload.iconSource, true)
  pushExecutable(payload.uninstallString, true)
  pushExecutable(payload.quietUninstallString, true)
  pushDirectory(payload.installLocation, true)
  pushDirectory(payload.iconSource, true)

  const orderedPrimary = Array.from(primarySet)
  const orderedFallback = Array.from(fallbackSet).filter((item) => !primarySet.has(item))
  return [...orderedPrimary, ...orderedFallback]
}

/**
 * 通过 PowerShell/.NET 的 ExtractAssociatedIcon 提取文件图标
 * 比 Electron 的 app.getFileIcon (SHGetFileInfo) 更可靠，能直接提取 PE 文件内嵌图标资源
 * 这与 Geek Uninstaller 使用的底层机制本质一致
 */
async function extractIconViaShell(candidatePaths = []) {
  const filePaths = candidatePaths.filter((p) => {
    if (!p) return false
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile()
    } catch {
      return false
    }
  })
  if (!filePaths.length) return ''

  const escapedPaths = filePaths.map((p) => `'${escapePowerShellText(p)}'`).join(',')

  const script = `
Add-Type -AssemblyName System.Drawing
$paths = @(${escapedPaths})
foreach ($p in $paths) {
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
    if ($icon) {
      $bmp = $icon.ToBitmap()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      $ms.Dispose()
      $bmp.Dispose()
      $icon.Dispose()
      Write-Output $b64
      return
    }
  } catch { }
}
`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 5, timeout: 8000 }
    )
    const base64 = String(stdout || '').trim()
    if (base64 && base64.length > 100) {
      return `data:image/png;base64,${base64}`
    }
  } catch {
    // 忽略 PowerShell 执行失败
  }
  return ''
}

export async function getAppIconData(iconPayload = {}) {
  const sourceList = await buildIconCandidatePaths(iconPayload)
  if (!sourceList.length) return ''

  const isDirectImagePath = (value = '') =>
    /\.(?:ico|png|jpg|jpeg|bmp|webp)$/i.test(String(value || '').trim())
  const isExecutableIconPath = (value = '') => /\.(?:exe|dll)$/i.test(String(value || '').trim())
  const isDirectoryPath = (value = '') => {
    try {
      return fs.existsSync(value) && fs.statSync(value).isDirectory()
    } catch {
      return false
    }
  }
  const isRegularFilePath = (value = '') => {
    try {
      return fs.existsSync(value) && fs.statSync(value).isFile()
    } catch {
      return false
    }
  }
  const weakIconLengthThreshold = 900
  let weakIconResult = null
  let deferredUninstallerResult = null
  let deferredDirectoryResult = null

  // 1. 优先使用 Electron 的 app.getFileIcon（速度快，无进程开销）
  for (const source of sourceList) {
    if (isDirectImagePath(source)) {
      try {
        const directImage = nativeImage.createFromPath(source)
        if (directImage && !directImage.isEmpty()) {
          return directImage.toDataURL()
        }
      } catch {
        // 忽略图像文件读取异常
      }
    }

    try {
      const icon = await app.getFileIcon(source, { size: 'normal' })
      if (icon && !icon.isEmpty()) {
        const iconDataUrl = icon.toDataURL()
        const isUninstallerCandidate = isLikelyUninstallerPath(source)
        const isWeakExecutableIcon =
          isExecutableIconPath(source) &&
          iconDataUrl.length > 0 &&
          iconDataUrl.length <= weakIconLengthThreshold

        if (isWeakExecutableIcon) {
          weakIconResult = {
            source,
            iconDataUrl
          }
          continue
        }

        if (isUninstallerCandidate) {
          if (!deferredUninstallerResult) {
            deferredUninstallerResult = {
              source,
              iconDataUrl
            }
          }
          continue
        }

        if (isDirectoryPath(source)) {
          if (!deferredDirectoryResult) {
            deferredDirectoryResult = {
              source,
              iconDataUrl
            }
          }
          continue
        }

        return iconDataUrl
      }
    } catch {
      // 忽略单个候选路径失败，继续尝试
    }
  }

  // 2. 回退到 PowerShell ExtractAssociatedIcon（直接提取 PE 内嵌图标，和 Geek 同源）
  const nonUninstallerFileSources = sourceList.filter(
    (source) => !isLikelyUninstallerPath(source) && isRegularFilePath(source)
  )
  const shellCandidateSources = nonUninstallerFileSources.length
    ? nonUninstallerFileSources
    : sourceList.filter((source) => isRegularFilePath(source))
  const shellResult = await extractIconViaShell(shellCandidateSources)
  if (shellResult) return shellResult

  if (weakIconResult) {
    return weakIconResult.iconDataUrl
  }

  if (deferredDirectoryResult) {
    return deferredDirectoryResult.iconDataUrl
  }

  if (deferredUninstallerResult) {
    return deferredUninstallerResult.iconDataUrl
  }

  return ''
}
