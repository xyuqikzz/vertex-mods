import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const exec = promisify(execFile)
// Pin and recheck the observed process, then send an ordinary window-close
// request. No process-name kills, process-tree termination or forced fallback.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VertexCloseDetectedGame {
  delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long start, out long end, out long kernel, out long user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  public static string Close(int id, string expectedPath, DateTime expectedStart, uint timeout) {
    // QUERY_LIMITED_INFORMATION | SYNCHRONIZE: no TERMINATE or debug rights.
    IntPtr process = OpenProcess(0x101000, false, id);
    if (process == IntPtr.Zero) return Marshal.GetLastWin32Error() == 87 ? "already-exited" : "unavailable";
    try {
      if (WaitForSingleObject(process, 0) == 0) return "already-exited";
      long start, end, kernel, user;
      uint size=32768; var name=new StringBuilder((int)size);
      if (!GetProcessTimes(process, out start, out end, out kernel, out user) ||
          !QueryFullProcessImageName(process, 0, name, ref size)) return "unavailable";
      if (Math.Abs(start-expectedStart.ToUniversalTime().ToFileTimeUtc()) >= 10000 ||
          !String.Equals(name.ToString(), expectedPath, StringComparison.OrdinalIgnoreCase)) return "changed";
      IntPtr target=IntPtr.Zero;
      EnumWindows(delegate(IntPtr window, IntPtr parameter) {
        uint owner; GetWindowThreadProcessId(window, out owner);
        // Some game/toolkit windows have a hidden owner. Skip visible modal
        // children, but do not mistake that hidden owner for the game window.
        IntPtr ownerWindow=GetWindow(window, 4);
        if (owner == id && IsWindowVisible(window) && IsWindowEnabled(window) &&
            (ownerWindow == IntPtr.Zero || !IsWindowVisible(ownerWindow))) {
          target=window; return false;
        }
        return true;
      }, IntPtr.Zero);
      if (WaitForSingleObject(process, 0) == 0) return "already-exited";
      if (target == IntPtr.Zero) return "no-window";
      uint finalOwner; GetWindowThreadProcessId(target, out finalOwner);
      if (finalOwner != id) return "changed";
      if (!PostMessage(target, 0x0010, IntPtr.Zero, IntPtr.Zero)) return "unavailable";
      uint wait=WaitForSingleObject(process, timeout);
      return wait == 0 ? "closed" : wait == 258 ? "timeout" : "unavailable";
    } finally { CloseHandle(process); }
  }
}
'@
$inputData = ConvertFrom-Json -InputObject $env:VERTEX_DLSS_CLOSE_SESSION
[pscustomobject]@{ status=[VertexCloseDetectedGame]::Close([int]$inputData.pid, [string]$inputData.exePath, [DateTime]::Parse($inputData.startedAt).ToUniversalTime(), [uint32]$inputData.timeoutMs) } | ConvertTo-Json -Compress
`

export async function closeDetectedGame({ exePath, session }, { signal, timeoutMs = 8000 } = {}) {
  signal?.throwIfAborted()
  if (
    process.platform !== 'win32' ||
    typeof exePath !== 'string' ||
    !path.isAbsolute(exePath) ||
    !/\.exe$/i.test(exePath) ||
    !Number.isSafeInteger(session?.pid) ||
    session.pid <= 0 ||
    !Number.isFinite(Date.parse(session.startedAt))
  )
    return { status: 'unavailable' }
  const duration = Number.isFinite(timeoutMs) ? Math.min(15000, Math.max(0, timeoutMs)) : 8000
  try {
    const { stdout } = await exec(
      path.join(
        process.env.SystemRoot || 'C:/Windows',
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
        timeout: duration + 10000,
        maxBuffer: 64 * 1024,
        signal,
        env: {
          ...process.env,
          VERTEX_DLSS_CLOSE_SESSION: JSON.stringify({
            exePath,
            pid: session.pid,
            startedAt: session.startedAt,
            timeoutMs: duration
          })
        }
      }
    )
    signal?.throwIfAborted()
    const result = JSON.parse(stdout.trim())
    return ['closed', 'already-exited', 'changed', 'unavailable', 'no-window', 'timeout'].includes(
      result.status
    )
      ? result
      : { status: 'unavailable' }
  } catch {
    signal?.throwIfAborted()
    return { status: 'unavailable' }
  }
}
