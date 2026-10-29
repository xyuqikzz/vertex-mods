import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import { isRouteSourcePathMatched } from './pathMapper.js'
import { createPlanningPathChecker, normalizeSafeRelativePath } from './pathSafety.js'
import { InstallEngineError } from './installEngineError.js'

const fail = (message) => {
  throw new InstallEngineError('install_engine.archive_budget', message)
}
const crcTable = new Uint32Array(256).map((_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export async function expandNestedArchives(snapshot, context, spec) {
  if (!spec) return { snapshot, ignored: [], archives: [] }
  const limits = {
    depth: spec.max_depth ?? 1,
    entries: spec.max_entries ?? 5000,
    bytes: spec.max_bytes ?? 256 * 1024 * 1024
  }
  const files = [...snapshot.allFiles]
  const dirs = [...snapshot.allDirs]
  const candidates = files.filter(
    (file) =>
      !/^__vertex_/i.test(file.relativePath) &&
      isRouteSourcePathMatched(file.relativePath, spec.include)
  )
  if (!candidates.length) fail('未找到规则要求展开的嵌套 ZIP 包')
  if (candidates.length > 32) fail('嵌套压缩包超过 32 个')
  const container = path.join(context.stagingPath, '__vertex_install_plan_v3__')
  const within = createPlanningPathChecker()
  if (!(await within(context.stagingPath, container))) fail('嵌套包物化目录越界')
  await fs.mkdir(container, { recursive: true })
  const workRoot = await fs.mkdtemp(path.join(container, 'nested-'))
  const ignored = []
  const archives = []
  const queue = candidates.map((file) => ({ file, depth: 1 }))
  const keys = new Set([...files, ...dirs].map((entry) => entry.relativePath.toLowerCase()))
  let byteCount = 0
  let entryCount = 0
  const started = Date.now()
  try {
    while (queue.length) {
      const { file, depth } = queue.shift()
      if (Date.now() - started > 30000) fail('嵌套解包超过 30 秒预算')
      if (!/\.zip$/i.test(file.relativePath)) fail('嵌套展开目前只接受显式 ZIP 包')
      if (!(await within(context.stagingPath, file.fullPath))) fail('嵌套源包真实路径越界')
      const stat = await fs.lstat(file.fullPath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
        fail('嵌套 ZIP 必须为不超过 64 MiB 的普通文件')
      const handle = await fs.open(file.fullPath, 'r')
      let buffer
      try {
        const capacity = Buffer.alloc(stat.size + 1)
        const { bytesRead } = await handle.read(capacity, 0, capacity.length, 0)
        if (bytesRead !== stat.size) fail('读取期间嵌套 ZIP 大小发生变化')
        buffer = capacity.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      const zip = new AdmZip(buffer)
      const entries = zip.getEntries()
      if (entryCount + entries.length > limits.entries) fail('嵌套解包条目数量超过预算')
      const prefix = `${file.relativePath}.contents`
      if (keys.has(prefix.toLowerCase())) fail('嵌套包虚拟目录与原包内容冲突')
      keys.add(prefix.toLowerCase())
      const archiveId = String(archives.length)
      const outputRoot = path.join(workRoot, archiveId)
      await fs.mkdir(outputRoot)
      const archiveKeys = new Set()
      for (const entry of entries) {
        if (Date.now() - started > 30000) fail('嵌套解包超过时间预算')
        entryCount++
        const relative = normalizeSafeRelativePath(entry.entryName.replace(/\/$/, ''))
        if (/[<>:"|?*]/.test(relative) || relative.split('/').some((part) => /[. ]$/.test(part)))
          fail('嵌套 ZIP 存在不安全文件名')
        if ((entry.header.flags & 1) !== 0 || ((entry.attr >>> 16) & 0xf000) === 0xa000)
          fail('嵌套 ZIP 不支持加密或链接条目')
        const key = relative.toLowerCase()
        if (archiveKeys.has(key)) fail('嵌套 ZIP 存在重复路径或大小写冲突')
        archiveKeys.add(key)
        const virtual = `${prefix}/${relative}`
        const fullPath = path.join(outputRoot, ...relative.split('/'))
        if (entry.isDirectory) {
          await fs.mkdir(fullPath, { recursive: true })
          dirs.push({ name: path.basename(fullPath), relativePath: virtual, fullPath, type: 'dir' })
          continue
        }
        const declaredSize = entry.header.size
        const budget = Math.min(limits.bytes - byteCount, 64 * 1024 * 1024)
        if (declaredSize > budget || declaredSize / Math.max(1, entry.header.compressedSize) > 1000)
          fail('嵌套 ZIP 超过解压大小或压缩比预算')
        const compressed = entry.getCompressedData()
        let content
        if (entry.header.method === 0) content = compressed
        else if (entry.header.method === 8)
          content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, budget) })
        else fail('嵌套 ZIP 使用不支持的压缩方法')
        if (
          content.length !== declaredSize ||
          content.length > budget ||
          crc32(content) !== entry.header.crc
        )
          fail('嵌套 ZIP 条目大小或 CRC 校验失败')
        byteCount += content.length
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, content, { flag: 'wx' })
        const expanded = {
          name: path.basename(fullPath),
          relativePath: virtual,
          fullPath,
          size: content.length,
          type: 'file'
        }
        files.push(expanded)
        keys.add(virtual.toLowerCase())
        if (
          depth < limits.depth &&
          /\.zip$/i.test(relative) &&
          isRouteSourcePathMatched(virtual, spec.include)
        )
          queue.push({ file: expanded, depth: depth + 1 })
      }
      ignored.push({
        sourceRelativePath: file.relativePath,
        reason: '显式展开为受限嵌套包，子文件单独记录去向'
      })
      archives.push({
        source: file.relativePath,
        virtualRoot: prefix,
        depth,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        entries: entries.length
      })
    }
    return { snapshot: { ...snapshot, allFiles: files, allDirs: dirs }, ignored, archives }
  } catch (error) {
    // workRoot comes exclusively from mkdtemp below the checked private staging container.
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {})
    if (error instanceof InstallEngineError) throw error
    fail(`嵌套 ZIP 解包失败：${error.code || '压缩数据无效'}`)
  }
}
