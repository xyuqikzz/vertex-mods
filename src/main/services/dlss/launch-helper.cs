using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

// Only creates a new process. It never attaches to an existing game, elevates,
// modifies the DLL search policy, or disables process protection.
public static class VertexGraphicsLauncher {
  [DataContract] public sealed class Request {
    [DataMember] public string exe;
    [DataMember] public string cwd;
    [DataMember] public string dll;
    [DataMember] public string[] args;
  }
  [DataContract] public sealed class Result {
    [DataMember] public bool ok;
    [DataMember] public int pid;
    [DataMember] public string stage;
    [DataMember] public int win32;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public int cb; public string reserved; public string desktop; public string title;
    public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
    public ushort showWindow, reserved2; public IntPtr reservedPtr, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr process, thread; public uint pid, tid;
  }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags; public UIntPtr minimum, maximum;
    public uint activeProcesses; public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits {
    public BasicLimits basic; public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref JobLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protection);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr written);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string module);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateRemoteThread(IntPtr process, IntPtr attributes, UIntPtr stackSize, IntPtr start, IntPtr argument, uint flags, out uint id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeThread(IntPtr thread, out uint exit);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exit);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static string Quote(string text) {
    var b = new StringBuilder("\""); int slashes=0;
    foreach(char c in text) {
      if(c=='\\') { slashes++; continue; }
      b.Append('\\', c=='\"' ? slashes*2+1 : slashes); slashes=0; b.Append(c);
    }
    b.Append('\\', slashes*2); return b.Append('"').ToString();
  }
  static void Reply(Result r) {
    var serializer = new DataContractJsonSerializer(typeof(Result));
    serializer.WriteObject(Console.OpenStandardOutput(), r); Console.Out.WriteLine(); Console.Out.Flush();
  }
  public static int Main() {
    ProcessInfo process = new ProcessInfo(); IntPtr remote = IntPtr.Zero, thread = IntPtr.Zero, job = IntPtr.Zero;
    string stage = "request"; bool resumed = false;
    try {
      var serializer = new DataContractJsonSerializer(typeof(Request));
      string input = Console.ReadLine();
      if(input==null || input.Length > 524288) throw new InvalidDataException();
      Request request;
      using(var buffer=new MemoryStream(Encoding.UTF8.GetBytes(input))) request=(Request)serializer.ReadObject(buffer);
      if(request==null || !Path.IsPathRooted(request.exe) || !Path.IsPathRooted(request.dll) || !File.Exists(request.exe) || !File.Exists(request.dll)) throw new InvalidDataException();
      var command = new StringBuilder(Quote(request.exe));
      foreach(string arg in request.args ?? new string[0]) command.Append(' ').Append(Quote(arg));
      if(command.Length >= 32767) throw new InvalidDataException();
      var startup = new StartupInfo(); startup.cb = Marshal.SizeOf(startup);
      stage = "ownership";
      job=CreateJobObjectW(IntPtr.Zero, null);
      var limits = new JobLimits(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE until the parent durably records ownership.
      if(job==IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new InvalidOperationException();
      stage = "create";
      // CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW.
      if(!CreateProcessW(request.exe, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000604, IntPtr.Zero, request.cwd, ref startup, out process)) throw new InvalidOperationException();
      if(!AssignProcessToJobObject(job, process.process)) throw new InvalidOperationException();
      byte[] name = Encoding.Unicode.GetBytes(request.dll + "\0");
      stage = "allocate";
      remote = VirtualAllocEx(process.process, IntPtr.Zero, (UIntPtr)name.Length, 0x3000, 4);
      if(remote == IntPtr.Zero) throw new InvalidOperationException();
      stage = "write"; UIntPtr written;
      if(!WriteProcessMemory(process.process, remote, name, (UIntPtr)name.Length, out written) || written.ToUInt64() != (ulong)name.Length) throw new InvalidOperationException();
      stage = "load"; uint threadId;
      IntPtr load = GetProcAddress(GetModuleHandleW("kernel32.dll"), "LoadLibraryW");
      if(load == IntPtr.Zero) throw new InvalidOperationException();
      thread = CreateRemoteThread(process.process, IntPtr.Zero, UIntPtr.Zero, load, remote, 0, out threadId);
      if(thread == IntPtr.Zero || WaitForSingleObject(thread, 15000) != 0) throw new InvalidOperationException();
      uint loaded; if(!GetExitCodeThread(thread, out loaded) || loaded==0) throw new InvalidOperationException();
      stage = "verify"; bool found = false;
      using(var target = Process.GetProcessById((int)process.pid)) {
        foreach(ProcessModule module in target.Modules) {
          if(String.Equals(Path.GetFullPath(module.FileName), Path.GetFullPath(request.dll), StringComparison.OrdinalIgnoreCase)) { found=true; break; }
        }
      }
      if(!found) throw new InvalidOperationException();
      // The game cannot enter main until Vertex persists this PID. A lost stdin
      // or a killed helper closes the job and removes only our suspended child.
      Reply(new Result { ok=true, pid=(int)process.pid, stage="ready", win32=0 });
      if(Console.ReadLine()!="resume") throw new InvalidOperationException();
      stage = "resume";
      if(ResumeThread(process.thread)==0xffffffff) throw new InvalidOperationException();
      limits.basic.flags=0;
      if(!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new InvalidOperationException();
      resumed=true;
      Reply(new Result { ok=true, pid=(int)process.pid, stage="loaded", win32=0 });
      return 0;
    } catch {
      int error=Marshal.GetLastWin32Error();
      // Failure belongs only to the suspended child created by this request.
      if(process.process!=IntPtr.Zero && !resumed) { TerminateProcess(process.process, 1); WaitForSingleObject(process.process, 5000); }
      Reply(new Result { ok=false, pid=0, stage=stage, win32=error });
      return 1;
    } finally {
      if(remote!=IntPtr.Zero) VirtualFreeEx(process.process, remote, UIntPtr.Zero, 0x8000);
      if(thread!=IntPtr.Zero) CloseHandle(thread);
      if(process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      if(process.process!=IntPtr.Zero) CloseHandle(process.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
    }
  }
}
