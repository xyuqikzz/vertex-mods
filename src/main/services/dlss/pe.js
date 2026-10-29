import fs from 'node:fs/promises'

export const API_IMPORTS = {
  'd3d9.dll': 'D3D9',
  'd3d10.dll': 'D3D10',
  'd3d10_1.dll': 'D3D10',
  'd3d11.dll': 'D3D11',
  'd3d12.dll': 'D3D12',
  'vulkan-1.dll': 'Vulkan',
  'opengl32.dll': 'OpenGL'
}
const DYNAMIC = [
  ['D3D11', 'd3d11.dll', 'd3d11createdevice'],
  ['D3D12', 'd3d12.dll', 'd3d12createdevice'],
  ['D3D9', 'd3d9.dll', 'direct3dcreate9'],
  ['Vulkan', 'vulkan-1.dll', 'vkgetinstanceprocaddr'],
  ['OpenGL', 'opengl32.dll', 'wglcreatecontext']
]

// Read import RVAs directly. Import tables in large Unreal executables can be
// beyond the first 64 MiB; file length is not evidence of an unknown API.
export async function readPeFile(file, { dynamic = true } = {}) {
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    const result = {
      valid: false,
      architecture: 'unknown',
      bitness: null,
      imports: [],
      apis: [],
      dynamicApis: [],
      version: '',
      bootstrapTarget: '',
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      scanLimited: false
    }
    async function read(offset, size) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= stat.size) return Buffer.alloc(0)
      const buffer = Buffer.alloc(Math.min(size, stat.size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return buffer.subarray(0, bytesRead)
    }
    const dos = await read(0, 64)
    if (dos.length < 64 || dos.toString('ascii', 0, 2) !== 'MZ') return result
    const peOffset = dos.readUInt32LE(0x3c),
      coff = await read(peOffset, 24)
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x4550) return result
    const sectionCount = coff.readUInt16LE(6),
      optionalSize = coff.readUInt16LE(20)
    if (sectionCount > 96 || optionalSize < 96 || optionalSize > 4096) return result
    const optional = await read(peOffset + 24, optionalSize)
    if (optional.length !== optionalSize) return result
    const magic = optional.readUInt16LE(0)
    if (![0x10b, 0x20b].includes(magic)) return result
    result.architecture =
      { 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64' }[coff.readUInt16LE(4)] || 'unknown'
    result.bitness = magic === 0x20b ? 64 : 32
    result.isDll = !!(coff.readUInt16LE(22) & 0x2000)
    result.valid = true
    const sectionTable = await read(peOffset + 24 + optionalSize, sectionCount * 40)
    if (sectionTable.length !== sectionCount * 40) return { ...result, valid: false }
    const sections = []
    for (let at = 0; at < sectionTable.length; at += 40)
      sections.push({
        start: sectionTable.readUInt32LE(at + 12),
        virtualSize: sectionTable.readUInt32LE(at + 8),
        rawSize: sectionTable.readUInt32LE(at + 16),
        raw: sectionTable.readUInt32LE(at + 20)
      })
    const offsetOf = (rva) => {
      const s = sections.find((s) => rva >= s.start && rva - s.start < s.rawSize)
      return s ? s.raw + rva - s.start : rva < peOffset + 24 + optionalSize ? rva : -1
    }
    const directories = magic === 0x20b ? 112 : 96
    // Version data is a PE resource, not an arbitrary matching byte sequence.
    // Follow RT_VERSION -> name -> language, bounded independently of DLL size.
    if (directories + 24 <= optional.length) {
      const resourceRva = optional.readUInt32LE(directories + 16)
      const resourceBase = resourceRva ? offsetOf(resourceRva) : -1
      let visitedEntries = 0
      async function versionResource(relative, depth = 0, resourceType = 16, resourceName = null) {
        if (depth > 3 || relative > 1024 * 1024) return ''
        const header = await read(resourceBase + relative, 16)
        if (header.length < 16) return ''
        const count = Math.min(128, header.readUInt16LE(12) + header.readUInt16LE(14))
        const entries = await read(resourceBase + relative + 16, count * 8)
        for (let at = 0; at + 8 <= entries.length; at += 8) {
          if (++visitedEntries > 128) return ''
          if (depth === 0 && entries.readUInt32LE(at) !== resourceType) continue
          if (depth === 1 && resourceName !== null && entries.readUInt32LE(at) !== resourceName)
            continue
          const child = entries.readUInt32LE(at + 4)
          if (child & 0x80000000) {
            const version = await versionResource(
              child & 0x7fffffff,
              depth + 1,
              resourceType,
              resourceName
            )
            if (version) return version
          } else {
            if (child > 1024 * 1024) continue
            const entry = await read(resourceBase + child, 16)
            if (entry.length < 16 || entry.readUInt32LE(4) > 65536) continue
            const data = await read(offsetOf(entry.readUInt32LE(0)), entry.readUInt32LE(4))
            if (resourceType === 10 && depth === 2 && data.length <= 4096 && data.length % 2 === 0)
              return data.toString('utf16le').replace(/\0+$/, '')
            if (data.length < 40 || data.toString('utf16le', 6, 36) !== 'VS_VERSION_INFO') continue
            for (let offset = 40; offset + 16 <= data.length; offset += 4) {
              if (
                data.readUInt32LE(offset) !== 0xfeef04bd ||
                data.readUInt32LE(offset + 4) !== 0x10000
              )
                continue
              const ms = data.readUInt32LE(offset + 8),
                ls = data.readUInt32LE(offset + 12)
              return `${ms >>> 16}.${ms & 65535}.${ls >>> 16}.${ls & 65535}`
            }
          }
        }
        return ''
      }
      if (resourceBase >= 0) {
        result.version = await versionResource(0)
        visitedEntries = 0
        // Unreal's packaged bootstrap declares its actual executable in RCDATA / 201.
        // The scanner validates this relative path against discovered game candidates.
        if (!result.isDll) {
          const target = await versionResource(0, 0, 10, 201)
          if (/\.exe$/i.test(target) && [...target].every((c) => c.charCodeAt(0) >= 32))
            result.bootstrapTarget = target
        }
      }
    }
    for (const [index, stride, nameOffset] of [
      [1, 20, 12],
      [13, 32, 4]
    ]) {
      if (directories + index * 8 + 8 > optional.length) continue
      const rva = optional.readUInt32LE(directories + index * 8)
      if (!rva) continue
      const start = offsetOf(rva)
      for (let n = 0; n < 1024 && start >= 0; n++) {
        const descriptor = await read(start + n * stride, stride)
        if (descriptor.length !== stride) break
        let name = descriptor.readUInt32LE(nameOffset)
        if (!name) break
        if (index === 13 && !(descriptor.readUInt32LE(0) & 1)) {
          if (magic === 0x20b) continue
          name -= optional.readUInt32LE(28)
        }
        const raw = await read(offsetOf(name), 260),
          end = raw.indexOf(0)
        if (end > 0) result.imports.push(raw.toString('ascii', 0, end).toLowerCase())
      }
    }
    result.imports = [...new Set(result.imports)]
    result.apis = [...new Set(result.imports.map((name) => API_IMPORTS[name]).filter(Boolean))]
    // Markers are secondary evidence. Never overwrite the import-table result.
    if (dynamic && !result.apis.length) {
      const found = new Set()
      for (let at = 0; at < stat.size; at += 4 * 1024 * 1024) {
        const bytes = await read(at, 4 * 1024 * 1024 + 128)
        const text = bytes.toString('latin1').toLowerCase()
        for (const [, library, entry] of DYNAMIC) {
          if (text.includes(library) || bytes.includes(Buffer.from(library, 'utf16le')))
            found.add(library)
          if (text.includes(entry)) found.add(entry)
        }
        if (DYNAMIC.some(([, library, entry]) => found.has(library) && found.has(entry))) break
      }
      result.dynamicApis = DYNAMIC.filter(
        ([, lib, entry]) => found.has(lib) && found.has(entry)
      ).map(([api]) => api)
      result.apis = result.dynamicApis
    }
    return result
  } finally {
    await handle.close()
  }
}
