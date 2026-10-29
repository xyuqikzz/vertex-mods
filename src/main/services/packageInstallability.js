import fs from 'node:fs/promises'
import path from 'node:path'
import yauzl from 'yauzl'

export const EXTERNAL_TOOL_PACKAGE_CODE = 'install_engine.external_tool_package'
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_TABLE_BYTES = 1024 * 1024
const MAX_ENTRIES = 2000
const DOCUMENT_FILE =
  /(?:^|\/)(?:readme|license|licence|changelog|credits)(?:[ _-][^/.]*)?$|\.(?:txt|md|rst|png|jpe?g|gif|webp)$/i

// 只识别有内容证据的纯 CE 表包。混合包、截断、超预算和未知类型保持 unknown，
// 继续交给原有预检；不能因为文件名含有 cheat 或 .ct 就推断整个模组不可安装。
export async function inspectPackageInstallability(filePath, options = {}) {
  const unknown = { kind: 'unknown', supported: null }
  if (path.extname(String(filePath || '')).toLowerCase() !== '.zip') return unknown
  const signal = options.signal
  if (signal?.aborted) throw Object.assign(new Error('包类型检查已取消'), { name: 'AbortError' })
  const stat = await fs.lstat(filePath).catch(() => null)
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) return unknown
  return new Promise((resolve, reject) => {
    let zip,
      finished = false,
      count = 0,
      totalBytes = 0
    const tables = []
    const finish = (result, error) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', abort)
      zip?.close()
      if (error) reject(error)
      else resolve(result)
    }
    const abort = () =>
      finish(null, Object.assign(new Error('包类型检查已取消'), { name: 'AbortError' }))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (error, archive) => {
        if (finished) {
          archive?.close()
          return
        }
        if (error) return finish(unknown)
        zip = archive
        zip.on('error', () => finish(unknown))
        zip.on('entry', (entry) => {
          if (finished) return
          if (++count > MAX_ENTRIES) return finish(unknown)
          const name = entry.fileName.replace(/\\/g, '/')
          if (name.endsWith('/')) {
            zip.readEntry()
            return
          }
          if (!/\.ct$/i.test(name)) {
            if (!DOCUMENT_FILE.test(name)) return finish(unknown)
            zip.readEntry()
            return
          }
          if (
            entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize > MAX_TABLE_BYTES ||
            totalBytes + entry.uncompressedSize > MAX_TABLE_BYTES
          )
            return finish(unknown)
          zip.openReadStream(entry, (streamError, stream) => {
            if (finished) {
              stream?.destroy()
              return
            }
            if (streamError) return finish(unknown)
            let bytes = 0
            const chunks = []
            stream.on('error', () => finish(unknown))
            stream.on('data', (chunk) => {
              bytes += chunk.length
              if (bytes > MAX_TABLE_BYTES || totalBytes + bytes > MAX_TABLE_BYTES) {
                stream.destroy()
                finish(unknown)
              } else chunks.push(chunk)
            })
            stream.on('end', () => {
              if (finished) return
              totalBytes += bytes
              const buffer = Buffer.concat(chunks)
              const text = buffer
                .toString(buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8')
                .replace(/^\uFEFF/, '')
                .trimStart()
              if (!/^(?:<\?xml[^>]*\?>\s*)?<CheatTable(?:\s|>)/i.test(text)) return finish(unknown)
              tables.push(name)
              zip.readEntry()
            })
          })
        })
        zip.on('end', () =>
          finish(
            tables.length
              ? {
                  kind: 'cheat_engine_table',
                  supported: false,
                  code: EXTERNAL_TOOL_PACKAGE_CODE,
                  evidence: tables,
                  message:
                    '下载包仅包含 Cheat Engine 表及说明文件，不是可部署到游戏目录的模组。已保留下载文件。',
                  userAction:
                    '可打开下载位置按作者说明使用外部工具，或选择可由客户端安装的模组；补充复制规则和直接重试不能解决此问题。'
                }
              : unknown
          )
        )
        zip.readEntry()
      }
    )
  })
}
