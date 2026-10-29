import path from 'node:path'
import { pathKey } from './executables.js'

// Optional Windows 11/WDDM hint, not evidence that a swapchain presented a frame.
// ABI checked against Windows SDK 10.0.26100 d3dkmthk.h (AMD64). The statistics
// interface is reserved by Microsoft, so failure must never break process inspection.
// System Informer's EtQueryProcessGpuClientHint uses the same query. Do not infer
// an API from loaded DLLs alone or interpret compute/translation hints as graphics.
export const gpuClientProbe = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class VertexGpuClient {
  [StructLayout(LayoutKind.Sequential)]
  struct Adapter { public uint Handle, Low; public int High; public uint Sources; public int Precise; }
  [StructLayout(LayoutKind.Sequential)]
  struct Enumeration { public uint Count; public IntPtr Adapters; }
  [StructLayout(LayoutKind.Explicit, Size=808)]
  struct Statistics {
    [FieldOffset(0)] public uint Type;
    [FieldOffset(4)] public uint Low;
    [FieldOffset(8)] public int High;
    [FieldOffset(16)] public IntPtr Process;
    [FieldOffset(288)] public uint ClientHint;
  }
  [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref Enumeration value);
  [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref uint handle);
  [DllImport("gdi32.dll")] static extern int D3DKMTQueryStatistics(ref Statistics value);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long start, out long end, out long kernel, out long user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);

  public static int[] Query(int id, string expectedPath, DateTime expectedStart) {
    var hints = new HashSet<int>();
    IntPtr process = IntPtr.Zero, buffer = IntPtr.Zero;
    var adapters = new List<Adapter>();
    try {
      // QUERY_INFORMATION only; never request VM read/write or debug privileges.
      process = OpenProcess(0x400, false, id);
      // A null hProcess queries the helper itself. Never issue that query on failure.
      if (process == IntPtr.Zero) return new int[0];
      long start, end, kernel, user;
      if (!GetProcessTimes(process, out start, out end, out kernel, out user) || end != 0 ||
          Math.Abs(start - expectedStart.ToUniversalTime().ToFileTimeUtc()) >= 10000) return new int[0];
      uint length = 32768; var name = new StringBuilder((int)length);
      if (!QueryFullProcessImageName(process, 0, name, ref length) ||
          !String.Equals(name.ToString(), expectedPath, StringComparison.OrdinalIgnoreCase)) return new int[0];
      int stride = Marshal.SizeOf(typeof(Adapter));
      buffer = Marshal.AllocHGlobal(stride * 16);
      var enumeration = new Enumeration { Count=16, Adapters=buffer };
      if (D3DKMTEnumAdapters2(ref enumeration) < 0 || enumeration.Count > 16) return new int[0];
      for (int i=0; i<enumeration.Count; i++)
        adapters.Add((Adapter)Marshal.PtrToStructure(IntPtr.Add(buffer, i*stride), typeof(Adapter)));
      foreach (var adapter in adapters) {
        var query = new Statistics { Type=2, Low=adapter.Low, High=adapter.High, Process=process };
        if (D3DKMTQueryStatistics(ref query) >= 0 && query.ClientHint != 0)
          hints.Add((int)query.ClientHint);
      }
      // Discard data collected while the process was exiting.
      if (!GetProcessTimes(process, out start, out end, out kernel, out user) || end != 0) return new int[0];
      var result = new int[hints.Count]; hints.CopyTo(result); return result;
    } catch { return new int[0]; }
    finally {
      foreach (var adapter in adapters) { uint handle=adapter.Handle; D3DKMTCloseAdapter(ref handle); }
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      if (process != IntPtr.Zero) CloseHandle(process);
    }
  }
}
`

const clients = {
  1: ['opengl', 'opengl32.dll'],
  4: ['vulkan', 'vulkan-1.dll'],
  9: ['d3d9', 'd3d9.dll'],
  10: ['d3d10', 'd3d10.dll'],
  11: ['d3d11', 'd3d11.dll'],
  12: ['d3d12', 'd3d12.dll']
}

export function collectGpuClientEvidence(exe, rows) {
  if (exe.processState !== 'running' || !Array.isArray(rows)) return { evidence: [], issues: [] }
  const matches = rows.filter((item) => item.exe && pathKey(item.exe) === pathKey(exe.path))
  if (matches.length !== 1) return { evidence: [], issues: [] }
  const row = matches[0]
  if (!row.readable || !(row.pid > 0) || !Number.isFinite(Date.parse(row.startedAt)))
    return { evidence: [], issues: [] }
  const hints = [...new Set(row.gpuClientHints || [])]
  if (!hints.length) return { evidence: [], issues: [] }
  const modules = new Set(
    (row.modules || []).map((file) => path.win32.basename(file).toLowerCase())
  )
  // A mixed/translated/unknown client cannot identify the game's presentation API.
  if (hints.length !== 1 || !clients[hints[0]])
    return { evidence: [], issues: ['gpu_client_ambiguous'] }
  const [api, module] = clients[hints[0]]
  if (!modules.has(module)) return { evidence: [], issues: ['gpu_client_uncorroborated'] }
  return {
    evidence: [
      {
        api,
        claim: 'runtime-hint',
        scope: 'current',
        source: 'gpu-client',
        pid: row.pid,
        startedAt: row.startedAt
      }
    ],
    issues: []
  }
}
