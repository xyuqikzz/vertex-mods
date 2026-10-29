import fs from 'node:fs/promises'
import path from 'node:path'
import { canonical, fail, hashFile, hasControl, isInside } from './files.js'
import { readPeFile } from './pe.js'

const APIS = {
  'd3d9.dll': 'D3D9',
  'd3d10.dll': 'D3D10',
  'd3d10_1.dll': 'D3D10',
  'd3d11.dll': 'D3D11',
  'd3d12.dll': 'D3D12',
  'vulkan-1.dll': 'Vulkan',
  'opengl32.dll': 'OpenGL'
}
const UTILITY =
  /^(?:unins\d*|uninstall.*|crashreport.*|crashpad.*|reporter|.*redist.*|.*prereq.*|setup|installer|updater|cefsubprocess|epicwebhelper|unitycrashhandler.*|beservice.*|easyanticheat.*)\.exe$/i
const LAUNCHER = /(?:launcher|launchhelper|bootstrap|start_protected_game|startgame)/i
const PROXY =
  /^(?:dxgi|d3d9|d3d11|d3d12|version|winmm|dinput8|dbghelp|opengl32)\.dll$|^reshade.*\.ini$|\.addon(?:32|64)?$/i
const PROTECTION =
  /easyanticheat|battleye|beservice|bedaisy|equ8|faceit|vgk\.sys|start_protected_game|denuvo/i
const SKIP_DIRECTORY =
  /^(?:\.git|node_modules|cache|logs|screenshots|Paks|DerivedDataCache|Movies|Saved|Mods|reshade-shaders|_DLSS5_Backup|_?backup[s]?|bak|_?redist|redistributables?|_commonredist|prerequisites|vcredist)$/i
const API_PRIORITY = ['D3D12', 'D3D11', 'D3D10', 'Vulkan', 'D3D9', 'OpenGL']
const orderApis = (apis) =>
  [...new Set(apis)].sort((a, b) => API_PRIORITY.indexOf(a) - API_PRIORITY.indexOf(b))

export function readPe(buffer) {
  const result = {
    architecture: 'unknown',
    bitness: null,
    imports: [],
    apis: [],
    valid: false,
    version: ''
  }
  if (buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ') return result
  const pe = buffer.readUInt32LE(0x3c)
  if (pe > buffer.length - 26 || buffer.readUInt32LE(pe) !== 0x4550) return result
  const machine = buffer.readUInt16LE(pe + 4)
  result.architecture = { 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64' }[machine] || 'unknown'
  result.bitness =
    result.architecture === 'x86' ? 32 : result.architecture === 'unknown' ? null : 64
  result.valid = true
  result.isDll = !!(buffer.readUInt16LE(pe + 22) & 0x2000)
  const optional = pe + 24,
    optSize = buffer.readUInt16LE(pe + 20)
  const count = buffer.readUInt16LE(pe + 6)
  const magic = buffer.readUInt16LE(optional)
  const directory = optional + (magic === 0x20b ? 112 : 96)
  const sections = []
  for (let i = 0; i < Math.min(count, 96); i++) {
    const at = optional + optSize + i * 40
    if (at + 40 > buffer.length) break
    sections.push({
      va: buffer.readUInt32LE(at + 12),
      size: Math.max(buffer.readUInt32LE(at + 8), buffer.readUInt32LE(at + 16)),
      offset: buffer.readUInt32LE(at + 20)
    })
  }
  const offset = (rva) => {
    const s = sections.find((s) => rva >= s.va && rva < s.va + s.size)
    return s ? s.offset + rva - s.va : rva < optional + optSize ? rva : -1
  }
  for (const [index, stride, nameAt] of [
    [1, 20, 12],
    [13, 32, 4]
  ]) {
    if (directory + index * 8 + 8 > optional + optSize) continue
    const rva = buffer.readUInt32LE(directory + index * 8)
    if (!rva) continue
    let at = offset(rva)
    for (let i = 0; i < 512 && at >= 0 && at + stride <= buffer.length; i++, at += stride) {
      if (index === 13 && !(buffer.readUInt32LE(at) & 1)) break // Legacy VA descriptors need image relocation; do not guess.
      const nameRva = buffer.readUInt32LE(at + nameAt)
      if (!nameRva) break
      const start = offset(nameRva)
      if (start < 0 || start >= buffer.length) continue
      const end = buffer.indexOf(0, start)
      if (end < start || end - start > 260) continue
      result.imports.push(buffer.toString('ascii', start, end).toLowerCase())
    }
  }
  result.imports = [...new Set(result.imports)]
  result.apis = [...new Set(result.imports.map((i) => APIS[i]).filter(Boolean))]
  const signature = buffer.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]))
  if (signature >= 0 && signature + 16 <= buffer.length) {
    const ms = buffer.readUInt32LE(signature + 8),
      ls = buffer.readUInt32LE(signature + 12)
    result.version = `${ms >>> 16}.${ms & 65535}.${ls >>> 16}.${ls & 65535}`
  }
  return result
}
export async function inspectPe(file) {
  return readPeFile(file)
}
export async function inferGameRoot(exePath) {
  const steam = exePath.match(/^(.*?[\\/]steamapps[\\/]common[\\/][^\\/]+)(?:[\\/]|$)/i)
  if (steam) return canonical(steam[1], true)
  const unreal = exePath.match(/^(.*?)[\\/]Binaries[\\/](?:Win64|Win32)[\\/]/i)
  if (unreal) {
    const project = unreal[1],
      parent = path.dirname(project)
    try {
      if ((await fs.stat(path.join(parent, 'Engine'))).isDirectory()) return canonical(parent, true)
    } catch {
      /* A standalone Unreal project may have no Engine sibling. */
    }
    return canonical(project, true)
  }
  return canonical(path.dirname(exePath), true)
}
export async function inspectGame({ gameRoot, exePath } = {}) {
  let target = exePath ? await canonical(exePath) : ''
  const root = gameRoot
    ? await canonical(gameRoot, true)
    : target
      ? await inferGameRoot(target)
      : fail('choose_location', '请选择游戏目录或实际 EXE')
  if (target && (!isInside(root, target) || path.extname(target).toLowerCase() !== '.exe'))
    fail('invalid_target', '目标 EXE 必须位于游戏目录内')
  const files = [],
    warnings = [],
    protection = [],
    queue = [{ dir: root, depth: 0 }]
  let visited = 0,
    truncated = false
  // Breadth first keeps another project's Binaries reachable before deep engine assets.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { dir, depth } = queue[cursor]
    if (visited >= 16000) {
      truncated = true
      break
    }
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      warnings.push(`无法读取 ${path.relative(root, dir) || '游戏目录'}`)
      continue
    }
    for (const e of entries) {
      if (++visited > 16000) {
        truncated = true
        break
      }
      if (e.isSymbolicLink()) {
        warnings.push(`跳过链接 ${e.name}`)
        continue
      }
      const file = path.join(dir, e.name)
      if (PROTECTION.test(e.name) && protection.length < 30)
        protection.push(path.relative(root, file))
      if (e.isDirectory()) {
        if (SKIP_DIRECTORY.test(e.name)) continue
        // Content at the install root can be a GDK game package. Nested Content
        // beside Binaries is engine asset data, not an executable directory.
        if (
          /^Content$/i.test(e.name) &&
          depth > 0 &&
          entries.some((entry) => /^Binaries$/i.test(entry.name) && entry.isDirectory())
        )
          continue
        if (depth >= 12) truncated = true
        else queue.push({ dir: file, depth: depth + 1 })
      } else if (e.isFile()) files.push(file)
    }
  }
  if (target && !files.includes(target)) {
    // An explicit EXE can be inside an excluded folder. Its neighboring files
    // are still required for API evidence and existing-loader conflict checks.
    const directory = path.dirname(target)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isFile() && !entry.isSymbolicLink() && !files.includes(file)) files.push(file)
      if (PROTECTION.test(entry.name) && protection.length < 30)
        protection.push(path.relative(root, file))
    }
    if (!files.includes(target)) files.push(target)
  }
  const candidates = []
  const executableFiles = [
    ...new Set([...(target ? [target] : []), ...files.filter((f) => /\.exe$/i.test(f))])
  ]
  for (const file of executableFiles.slice(0, 200)) {
    try {
      const pe = await inspectPe(file)
      const name = path.basename(file)
      const role = UTILITY.test(name)
        ? 'utility'
        : LAUNCHER.test(name) || pe.bootstrapTarget
          ? 'launcher'
          : 'game'
      candidates.push({ path: file, name, relativePath: path.relative(root, file), role, ...pe })
    } catch {
      warnings.push(`无法读取程序 ${path.basename(file)}`)
    }
  }
  if (files.filter((f) => /\.exe$/i.test(f)).length > 200) truncated = true
  const moduleCache = new Map()
  for (const candidate of candidates) {
    candidate.apiEvidence = candidate.apis.map((api) => `${candidate.relativePath}: ${api}`)
    if (
      candidate.valid &&
      !candidate.isDll &&
      candidate.role === 'game' &&
      !candidate.apis.length
    ) {
      const engines = files
        .filter(
          (file) =>
            path.dirname(file) === path.dirname(candidate.path) &&
            /\.dll$/i.test(file) &&
            !PROXY.test(path.basename(file)) &&
            !/^(?:libcef|libegl|libgles|d3dcompiler|dxcompiler|dxil|nvngx|sl\.|reshade|steam_api|eossdk|qt\d)/i.test(
              path.basename(file)
            )
        )
        .sort(
          (a, b) =>
            Number(candidate.imports.includes(path.basename(b).toLowerCase())) -
            Number(candidate.imports.includes(path.basename(a).toLowerCase()))
        )
        .slice(0, 32)
      for (const file of engines) {
        try {
          if (!moduleCache.has(file))
            moduleCache.set(file, await readPeFile(file, { dynamic: false }))
          const pe = moduleCache.get(file)
          if (!pe.valid || pe.architecture !== candidate.architecture) continue
          candidate.apis.push(...pe.apis)
          candidate.apiEvidence.push(
            ...pe.apis.map((api) => `${path.relative(root, file)}: ${api}`)
          )
        } catch {
          warnings.push(`无法检查渲染库 ${path.basename(file)}`)
        }
      }
    }
    candidate.apis = orderApis(candidate.apis)
  }
  for (const candidate of candidates) {
    const relative = candidate.bootstrapTarget
    if (
      !relative ||
      path.win32.isAbsolute(relative) ||
      relative.includes(':') ||
      hasControl(relative)
    )
      continue
    const destination = path.resolve(path.dirname(candidate.path), ...relative.split(/[\\/]/))
    if (!isInside(root, destination)) continue
    const renderer = candidates.find(
      (c) =>
        c.path.toLowerCase() === destination.toLowerCase() &&
        c.valid &&
        !c.isDll &&
        c.role === 'game' &&
        c.architecture === candidate.architecture
    )
    if (renderer) candidate.launchTarget = renderer.path
  }
  const playable = candidates.filter((c) => c.valid && !c.isDll && c.role === 'game')
  const renderers = playable.filter((c) => c.apis.length)
  const recommended =
    !truncated &&
    (renderers.length === 1 ? renderers[0] : playable.length === 1 ? playable[0] : null)
  if (!target && recommended) target = recommended.path
  const selected = target ? candidates.find((c) => c.path === target) : null
  const selectionReason = selected?.launchTarget
    ? `启动器指向：${path.relative(root, selected.launchTarget)}`
    : recommended && selected?.path === recommended.path
      ? `已识别游戏程序：${recommended.relativePath}`
      : ''
  candidates.sort(
    (a, b) =>
      Number(b.role === 'game' && !!b.apis.length) - Number(a.role === 'game' && !!a.apis.length) ||
      Number(a.role !== 'game') - Number(b.role !== 'game') ||
      a.relativePath.localeCompare(b.relativePath)
  )
  if (target && (!selected?.valid || selected.isDll))
    fail('invalid_executable', '目标不是有效的 Windows 游戏 EXE')
  const conflicts = selected
    ? files
        .filter(
          (f) =>
            path.dirname(f).toLowerCase() === path.dirname(target).toLowerCase() &&
            PROXY.test(path.basename(f))
        )
        .map((f) => path.relative(root, f))
    : []
  const apis = selected?.apis || [],
    apiEvidence = selected?.apiEvidence || []
  if (truncated)
    warnings.push('扫描达到目录或文件数量上限，结果可能不完整；请直接选择实际游戏 EXE。')
  const detectedFiles = []
  for (const file of files
    .filter((f) =>
      /^(?:nvngx_dlss(?:g|d|nr)?\.dll|dxgi\.dll|ReShade64\.dll|renodx-dlss5\.addon64|dlss5-feed\.addon64)$/i.test(
        path.basename(f)
      )
    )
    .slice(0, 64)) {
    try {
      const binary = await readPeFile(file, { dynamic: false })
      detectedFiles.push({
        path: path.relative(root, file),
        name: path.basename(file),
        version: binary.version,
        size: binary.size
      })
    } catch {
      warnings.push(`无法读取组件版本 ${path.basename(file)}`)
    }
  }
  return {
    gameRoot: root,
    exePath: target,
    candidates,
    selected,
    selectionReason,
    apis: [...new Set(apis)],
    apiEvidence,
    detectedFiles,
    conflicts,
    protection,
    warnings,
    truncated,
    nativeDlss: files
      .filter((f) => /^nvngx_dlss\.dll$/i.test(path.basename(f)))
      .map((f) => path.relative(root, f)),
    nativeFrameGeneration: files
      .filter((f) => /^nvngx_dlssg\.dll$/i.test(path.basename(f)))
      .map((f) => path.relative(root, f)),
    fingerprint: selected
      ? { sha256: await hashFile(target), size: selected.size, modifiedAt: selected.modifiedAt }
      : null,
    inspectedAt: new Date().toISOString(),
    effect: 'unverified'
  }
}
