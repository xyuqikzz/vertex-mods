import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { gpuClientProbe } from './detection/gpu-client.js'

const exec = promisify(execFile)

// Process presence and renderer evidence are independent. A readable path is
// enough to report a running EXE; loaded graphics modules do not confirm its API.
export function gameProcessState(exePath, rows) {
  if (rows === undefined) return 'unchecked'
  if (!Array.isArray(rows)) return 'unavailable'
  const key = path.resolve(exePath).toLowerCase()
  const matches = rows.filter((row) => row.exe && path.resolve(row.exe).toLowerCase() === key)
  if (matches.length > 1) return 'multiple'
  if (
    rows.some(
      (row) =>
        !row.exe &&
        !row.readable &&
        (!row.name || row.name.toLowerCase() === path.basename(exePath).toLowerCase())
    )
  )
    return 'unavailable'
  if (matches.length) return 'running'
  return 'not-running'
}

// Values travel via the helper's environment, never PowerShell source interpolation.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$rows = @(Get-CimInstance Win32_Process)
[int[]]$known = ConvertFrom-Json -InputObject $env:VERTEX_DLSS_PIDS
$selected = @($rows | Where-Object { $_.ExecutablePath -eq $env:VERTEX_DLSS_EXE -or $_.Name -eq [IO.Path]::GetFileName($env:VERTEX_DLSS_EXE) -or $known -contains [int]$_.ProcessId })
for ($i=0; $i -lt 12; $i++) {
  $ids = @($selected | ForEach-Object { [int]$_.ProcessId }) + $known
  $children = @($rows | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId })
  if (!$children.Count) { break }
  $selected += $children
}
$out = @($selected | ForEach-Object {
  $row = $_; $modules = @(); $readable = $true
  try { $modules = @((Get-Process -Id $row.ProcessId -ErrorAction Stop).Modules | ForEach-Object { $_.FileName }) }
  catch { $readable = $false }
  [pscustomobject]@{ pid=[int]$row.ProcessId; parentPid=[int]$row.ParentProcessId; exe=$row.ExecutablePath; startedAt=$row.CreationDate.ToUniversalTime().ToString('o'); readable=$readable; modules=$modules }
})
ConvertTo-Json -InputObject $out -Depth 4 -Compress
`
export async function snapshotProcesses(binding, session) {
  const { stdout } = await exec(
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
    {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        VERTEX_DLSS_EXE: binding.exePath,
        VERTEX_DLSS_PIDS: JSON.stringify(session?.pids || [])
      }
    }
  )
  return JSON.parse(stdout.trim() || '[]')
}

// On-demand, read-only inspection of the selected game directory. Do not use
// name-only matches as proof of an executable's identity or inspect their modules.
export const gameProcessProbe = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath($env:VERTEX_DLSS_ROOT).TrimEnd('\\') + '\\'
[string[]]$focus = ConvertFrom-Json -InputObject $env:VERTEX_DLSS_FOCUS
$names = @($focus | ForEach-Object { [IO.Path]::GetFileName($_) })
$rows = @(Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or
  (!$_.ExecutablePath -and $names -contains $_.Name)
} | Sort-Object @{Expression={ ($_.ExecutablePath -and $focus -contains $_.ExecutablePath) -or (!$_.ExecutablePath -and $names -contains $_.Name) };Descending=$true} | Select-Object -First 32)
$gpuAvailable = $false
if ($rows.Count -and [IntPtr]::Size -eq 8 -and [Environment]::OSVersion.Version.Build -ge 22000) {
  try {
    if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') { throw 'unsupported_gpu_architecture' }
    Add-Type -TypeDefinition @'
${gpuClientProbe}
'@ -ErrorAction Stop
    $gpuAvailable = $true
  } catch { $gpuAvailable = $false }
}
$out = @($rows | ForEach-Object {
  $row = $_; $modules = @(); $readable = !!$row.ExecutablePath
  if ($readable) {
    try { $modules = @((Get-Process -Id $row.ProcessId -ErrorAction Stop).Modules | Select-Object -First 2048 | ForEach-Object { $_.FileName }) }
    catch { $readable = $false }
  }
  $renderArgs = @([regex]::Matches([string]$row.CommandLine, '(?i)(?<!\\S)-(?:dx11|dx12|d3d11|d3d12|vulkan|opengl4?|force-d3d11|force-d3d12|force-vulkan|force-glcore|force-opengl)(?!\\S)') | ForEach-Object { $_.Value.ToLowerInvariant() })
  $gpuHints = @()
  if ($gpuAvailable -and $readable) {
    try { $gpuHints = @([VertexGpuClient]::Query([int]$row.ProcessId, $row.ExecutablePath, $row.CreationDate)) } catch { $gpuHints = @() }
  }
  [pscustomobject]@{ pid=[int]$row.ProcessId; parentPid=[int]$row.ParentProcessId; name=$row.Name; exe=$row.ExecutablePath; startedAt=$row.CreationDate.ToUniversalTime().ToString('o'); readable=$readable; modules=$modules; renderArguments=$renderArgs; gpuClientHints=$gpuHints }
})
ConvertTo-Json -InputObject $out -Depth 4 -Compress
`
export async function snapshotGameProcesses(
  gameRoot,
  exePath,
  { signal, relatedExePath, relatedExePaths = [] } = {}
) {
  if (process.platform !== 'win32') throw new Error('process_inspection_unavailable')
  const { stdout } = await exec(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe'
    ),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(gameProcessProbe, 'utf16le').toString('base64')
    ],
    {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
      env: {
        ...process.env,
        VERTEX_DLSS_ROOT: gameRoot,
        VERTEX_DLSS_FOCUS: JSON.stringify([
          ...new Set([exePath, relatedExePath, ...relatedExePaths].filter(Boolean))
        ])
      }
    }
  )
  return JSON.parse(stdout.trim() || '[]')
}
export function buildSessionEnvironment(base, directory, feeder, api = 'Vulkan') {
  if (api !== 'Vulkan') return { ...base, RESHADE_BASE_PATH_OVERRIDE: directory }
  return {
    ...base,
    VK_LAYER_PATH: [directory, base.VK_LAYER_PATH].filter(Boolean).join(';'),
    VK_INSTANCE_LAYERS: [
      ...new Set([
        ...(base.VK_INSTANCE_LAYERS || '').split(/[;,]/).filter(Boolean),
        ...(feeder ? ['VK_LAYER_feed_vk'] : []),
        'VK_LAYER_reshade'
      ])
    ].join(';'),
    RESHADE_BASE_PATH_OVERRIDE: directory
  }
}
