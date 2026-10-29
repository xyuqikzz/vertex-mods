import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { setImmediate } from 'node:timers/promises'
import AdmZip from 'adm-zip'
import { normalizeSafeRelativePath } from '../../../../ipc/game/install-engine/pathSafety.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

const inflate = promisify(inflateRaw)
const references = new Map()
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code })
}
const scope = (ctx) =>
  JSON.stringify([
    ctx.sessionId || '',
    ctx.pageContext?.game?.id || ctx.pageContext?.game?.sourceGameId || '',
    ctx.pageContext?.page?.businessSource || ctx.pageContext?.page?.source || '',
    ctx.pageContext?.route?.query?.profileName || ctx.pageContext?.game?.profileName || ''
  ])
const fingerprint = (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`

export async function resolveArchiveEvidence(args, ctx) {
  assertToolExecutionActive(ctx.signal)
  const now = Date.now()
  for (const [key, item] of references) if (item.expires < now) references.delete(key)
  if (args.archiveRef) {
    const ref = references.get(args.archiveRef)
    if (!ctx.sessionId || !ref || ref.scope !== scope(ctx))
      fail(
        'archive_reference_unavailable',
        '包引用已过期或不属于当前会话、游戏和配置档案，请重新检查包。'
      )
    const stat = await fs.lstat(ref.path)
    if (stat.isSymbolicLink() || fingerprint(stat) !== ref.fingerprint)
      fail('archive_evidence_changed', '包文件已变化，请重新检查，不能继续使用旧证据。')
    return {
      archivePath: ref.path,
      archiveRef: args.archiveRef,
      gameRoot: ref.gameRoot,
      source: ref.source,
      installData: ref.installData
    }
  }
  let taskEvidence = {}
  if (args.jobId) {
    const store = await import('../../../../ipc/game/source-install-task/taskStore.js')
    const job = store.getJob(args.jobId)
    const items = store.getJobItems(args.jobId)
    const item = args.itemId
      ? items.find((entry) => entry.item_id === args.itemId)
      : items.length === 1
        ? items[0]
        : null
    if (!item || !job)
      fail('archive_item_required', '请从任务详情指定唯一 itemId，不能猜测安装项。')
    const artifact = store.getArtifactByKey(item.artifact_key)
    const meta = JSON.parse(item.metadata_json || '{}')
    taskEvidence = {
      jobId: args.jobId,
      itemId: item.item_id,
      archivePath: artifact?.file_path,
      gameRoot: meta.installPayload?.gameRoot || meta.installPayload?.gameRootPath,
      source: job.source,
      installData: meta.installPayload
    }
    if (!taskEvidence.archivePath)
      fail('archive_not_downloaded', '此任务项尚无已下载包，请先检查下载状态。')
  }
  const archivePath = String(
    taskEvidence.archivePath ||
      args.archivePath ||
      args.archive_path ||
      args.filePath ||
      args.file_path ||
      ''
  ).trim()
  if (!archivePath) return { archivePath: '', archiveRef: '' }
  const stat = await fs.lstat(archivePath)
  if (!stat.isFile() || stat.isSymbolicLink())
    fail('invalid_archive_file', '压缩包必须是普通文件。')
  if (!ctx.sessionId) return { ...taskEvidence, archivePath, archiveRef: '' }
  const resolved = path.resolve(archivePath)
  const previous = [...references].find(
    ([, ref]) =>
      ref.path === resolved &&
      ref.scope === scope(ctx) &&
      ref.fingerprint === fingerprint(stat) &&
      ref.jobId === taskEvidence.jobId &&
      ref.itemId === taskEvidence.itemId
  )
  if (previous)
    return {
      ...taskEvidence,
      archivePath: resolved,
      archiveRef: previous[0],
      gameRoot: previous[1].gameRoot || taskEvidence.gameRoot,
      source: previous[1].source || taskEvidence.source
    }
  while (references.size >= 64) references.delete(references.keys().next().value)
  const archiveRef = `archive-${randomUUID()}`
  references.set(archiveRef, {
    ...taskEvidence,
    path: resolved,
    scope: scope(ctx),
    fingerprint: fingerprint(stat),
    expires: now + 60 * 60 * 1000
  })
  return { ...taskEvidence, archivePath: resolved, archiveRef }
}

export async function readArchiveZip(archivePath, signal) {
  assertToolExecutionActive(signal)
  const file = await fs.open(archivePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES)
      fail('archive_evidence_budget', 'ZIP 定向证据读取限 64 MiB；较大的包仍可用原生结构预览。')
    const buffer = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== stat.size || fingerprint(await file.stat()) !== fingerprint(stat))
      fail('archive_evidence_changed', '读取期间压缩包发生变化。')
    const zip = new AdmZip(buffer.subarray(0, bytesRead))
    const entries = zip.getEntries()
    if (entries.length > 50000) fail('archive_evidence_budget', 'ZIP 条目超过 50000 项。')
    assertToolExecutionActive(signal)
    return entries
  } finally {
    await file.close()
  }
}

async function readEntryBuffer(entries, name, budget, signal) {
  const matches = entries.filter((entry) => entry.entryName.replace(/\\/g, '/') === name)
  if (matches.length !== 1)
    fail('archive_entry_not_found', '包内路径不存在或存在重复条目，请先检查目录。')
  const entry = matches[0]
  if (entry.isDirectory || entry.header.flags & 1 || ((entry.attr >>> 16) & 0xf000) === 0xa000)
    fail('archive_entry_unsafe', '不能读取目录、加密条目或符号链接。')
  if (
    entry.header.size > budget ||
    entry.header.size / Math.max(1, entry.header.compressedSize) > 1000
  )
    fail('archive_evidence_budget', '包内条目超过体积或压缩比预算。')
  const compressed = entry.getCompressedData()
  const content =
    entry.header.method === 0
      ? compressed
      : entry.header.method === 8
        ? await inflate(compressed, { maxOutputLength: Math.max(1, budget) })
        : null
  if (!content || content.length !== entry.header.size)
    fail('archive_entry_invalid', '不支持的压缩方法或文本大小不符。')
  let crc = 0xffffffff
  for (let index = 0; index < content.length; index++) {
    const byte = content[index]
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    if (index % 65536 === 0) { await setImmediate(); assertToolExecutionActive(signal) }
  }
  if ((crc ^ 0xffffffff) >>> 0 !== entry.header.crc)
    fail('archive_entry_invalid', '文本 CRC 校验失败。')
  assertToolExecutionActive(signal)
  return content
}

export async function readNestedArchiveEntries(entries, nestedPath = [], signal) {
  if (!Array.isArray(nestedPath) || nestedPath.length > 3) fail('archive_evidence_budget', 'nestedPath 必须是最多三层 ZIP 相对路径数组。')
  let totalBytes = 0, totalEntries = entries.length
  for (const nested of nestedPath) {
    const name = normalizeSafeRelativePath(String(nested).replace(/\\/g, '/'))
    if (!/\.zip$/i.test(name)) fail('archive_text_type_unsupported', '嵌套证据只读取明确指定的 ZIP。')
    const content = await readEntryBuffer(entries, name, MAX_ARCHIVE_BYTES - totalBytes, signal)
    totalBytes += content.length
    entries = new AdmZip(content).getEntries()
    totalEntries += entries.length
    if (totalEntries > 50000) fail('archive_evidence_budget', '嵌套证据总条目超过 50000 项。')
  }
  return entries
}

export async function readArchiveDocument(entries, args, signal) {
  const name = normalizeSafeRelativePath(String(args.entryPath).replace(/\\/g, '/'))
  if (!/\.(?:md|txt|json|xml|ini|cfg|toml|yaml|yml)$/i.test(name) || /(?:^|\/)(?:\.env|credentials|secrets)(?:\.|$)/i.test(name))
    fail('archive_text_type_unsupported', '仅支持包内 README、清单和文本配置片段。')
  const content = await readEntryBuffer(entries, name, MAX_TEXT_BYTES, signal)
  let text = content.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
    ? content.subarray(2).toString('utf16le')
    : content.toString('utf8')
  if (text.includes('\0')) fail('archive_text_type_unsupported', '该条目不是可读取的文本。')
  // Redact before slicing so a later page cannot reveal the tail of a credential.
  text = text
    .replace(
      /(["'](?:api.?key|access.?token|refresh.?token|password|secret(?:.?key)?|authorization|cookie)["']\s*:\s*["'])(?:\\.|[^"'\\])*(["'])/gi,
      '$1[redacted]$2'
    )
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s;]+/gi, '$1[redacted]')
    .replace(
      /((?:api.?key|access.?token|refresh.?token|password|secret(?:.?key)?|cookie)\s*[:=]\s*)[^\s;]+/gi,
      '$1[redacted]'
    )
  const offset = Math.max(0, Math.trunc(Number(args.textOffset) || 0))
  const limit = Math.max(1, Math.min(8000, Math.trunc(Number(args.textLimit) || 4000)))
  return {
    entryPath: name,
    content: text.slice(offset, offset + limit),
    offset,
    total: text.length,
    nextOffset: offset + limit < text.length ? offset + limit : null,
    untrusted: true
  }
}
