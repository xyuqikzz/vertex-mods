import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform, Writable, Readable } from 'node:stream'
import { pipeline, finished } from 'node:stream/promises'
import archiver from 'archiver'
import yauzl from 'yauzl'
import {
  OFFLINE_PACK_MAX_PACKAGE_BYTES,
  OFFLINE_PACK_MAX_ENTRY_BYTES,
  OFFLINE_PACK_MAX_ENTRY_COUNT,
  OFFLINE_PACK_ERROR_CODE,
  isSafeOfflinePackRelativePath,
  normalizeOfflinePackPath
} from '../../../../shared/modpacks/offline-pack-contract.js'

const MAX_METADATA_BYTES = 16 * 1024 * 1024
const limitError = () =>
  Object.assign(new Error('离线安装包超过文件大小或数量限制'), {
    code: OFFLINE_PACK_ERROR_CODE.SIZE_LIMIT_EXCEEDED
  })
const fingerprint = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
const checkedName = (name) => {
  const normalized = normalizeOfflinePackPath(name)
  if (!isSafeOfflinePackRelativePath(normalized)) throw new Error(`离线安装包路径无效：${name}`)
  return normalized
}

class LocalArchiveReader extends yauzl.RandomAccessReader {
  constructor(fd, filePath) {
    super()
    this.fd = fd
    this.filePath = filePath
  }
  _readStreamForRange(start, end) {
    return descriptorStream(this.fd, this.filePath, { start, end: end - 1 })
  }
  close(callback) {
    this.closing ||= new Promise((resolve, reject) =>
      fs.close(this.fd, (error) => (error ? reject(error) : resolve()))
    )
    this.closing.then(() => callback(), callback)
  }
}

function descriptorStream(fd, filePath, options) {
  // Stream destruction must not close the descriptor owned by the archive reader.
  return fs.createReadStream(filePath, {
    ...options,
    fd,
    autoClose: false,
    fs: { read: fs.read, close: (_fd, callback) => queueMicrotask(callback) }
  })
}

function hashMeter(maxBytes, onComplete = () => {}) {
  let bytes = 0
  const hash = crypto.createHash('sha256')
  return new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) return callback(limitError())
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      onComplete({ hash: hash.digest('hex'), sizeBytes: bytes })
      callback()
    }
  })
}

// File descriptors stay open for one inspection/import so metadata and data refer to the same file.
export async function openOfflinePackArchive(filePath) {
  const fd = await new Promise((resolve, reject) =>
    fs.open(filePath, 'r', (error, value) => (error ? reject(error) : resolve(value)))
  )
  let zip, stat, reader
  try {
    stat = await new Promise((resolve, reject) =>
      fs.fstat(fd, (error, result) => (error ? reject(error) : resolve(result)))
    )
    if (stat.size > OFFLINE_PACK_MAX_PACKAGE_BYTES) throw limitError()
    // Native Node streams avoid fd-slicer 1's EOF/destroy incompatibility on current Node runtimes.
    reader = new LocalArchiveReader(fd, filePath)
    zip = await new Promise((resolve, reject) =>
      yauzl.fromRandomAccessReader(
        reader,
        stat.size,
        {
          lazyEntries: true,
          autoClose: false,
          validateEntrySizes: true
        },
        (error, result) => (error ? reject(error) : resolve(result))
      )
    )
  } catch (error) {
    await new Promise((resolve) => (reader ? reader.close(resolve) : fs.close(fd, resolve)))
    throw error
  }
  let failure = null
  zip.on('error', (error) => {
    failure = error
  })
  const signature = fingerprint(stat)
  const entries = new Map()
  const hashes = new Map()
  let expandedBytes = 0
  const close = () => zip.close()
  try {
    if (stat.size > OFFLINE_PACK_MAX_PACKAGE_BYTES || zip.entryCount > OFFLINE_PACK_MAX_ENTRY_COUNT)
      throw limitError()
    await new Promise((resolve, reject) => {
      zip.once('error', reject)
      zip.once('end', () => {
        zip.removeListener('error', reject)
        resolve()
      })
      zip.on('entry', (entry) => {
        try {
          const name = checkedName(entry.fileName)
          const isDirectory = entry.fileName.endsWith('/')
          const unixType = (entry.externalFileAttributes >>> 16) & 0xf000
          if (entries.has(name) || entry.generalPurposeBitFlag & 1 || unixType === 0xa000) {
            throw new Error('离线安装包包含重复条目、加密文件或符号链接')
          }
          expandedBytes += entry.uncompressedSize
          if (
            !Number.isSafeInteger(entry.uncompressedSize) ||
            entry.uncompressedSize < 0 ||
            entry.uncompressedSize > OFFLINE_PACK_MAX_ENTRY_BYTES ||
            expandedBytes > OFFLINE_PACK_MAX_PACKAGE_BYTES
          )
            throw limitError()
          entries.set(name, Object.assign(entry, { entryName: name, isDirectory }))
          zip.readEntry()
        } catch (error) {
          reject(error)
        }
      })
      zip.readEntry()
    })
  } catch (error) {
    close()
    throw error
  }

  const assertUnchanged = async () => {
    if (failure) throw failure
    const current = await new Promise((resolve, reject) =>
      fs.fstat(fd, (error, result) => (error ? reject(error) : resolve(result)))
    )
    if (fingerprint(current) !== signature)
      throw new Error('离线安装包在读取期间发生变化，请重新导入')
  }
  const openStream = async (name) => {
    await assertUnchanged()
    const entry = entries.get(checkedName(name))
    if (!entry || entry.isDirectory) return null
    return new Promise((resolve, reject) =>
      zip.openReadStream(
        entry,
        // yauzl 2's legacy destroy does not emit close; wrap it in a modern stream for pipeline completion.
        (error, stream) => (error ? reject(error) : resolve(Readable.wrap(stream)))
      )
    )
  }
  const readEntryBuffer = async (name, maxBytes = MAX_METADATA_BYTES) => {
    const entry = entries.get(checkedName(name))
    if (!entry || entry.isDirectory) return null
    if (entry.uncompressedSize > maxBytes) throw limitError()
    const chunks = []
    await pipeline(
      await openStream(name),
      hashMeter(maxBytes),
      new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk)
          callback()
        }
      })
    )
    await assertUnchanged()
    return Buffer.concat(chunks)
  }
  const hashEntry = async (name) => {
    await assertUnchanged()
    if (hashes.has(name)) return hashes.get(name)
    const stream = await openStream(name)
    if (!stream) return null
    let result
    await pipeline(
      stream,
      hashMeter(OFFLINE_PACK_MAX_ENTRY_BYTES, (value) => {
        result = value
      }),
      new Writable({
        write(chunk, encoding, callback) {
          callback()
        }
      })
    )
    await assertUnchanged()
    hashes.set(name, result.hash)
    return result.hash
  }
  return {
    sizeBytes: stat.size,
    signature,
    close,
    assertUnchanged,
    getEntry: (name) => entries.get(checkedName(name)),
    getEntries: () => [...entries.values()],
    readEntryBuffer,
    hashEntry,
    readAsText: async (entry) => (await readEntryBuffer(entry.entryName)).toString('utf8'),
    async hashFile() {
      let result
      await pipeline(
        descriptorStream(fd, filePath, { start: 0 }),
        hashMeter(OFFLINE_PACK_MAX_PACKAGE_BYTES, (value) => {
          result = value
        }),
        new Writable({
          write(chunk, encoding, callback) {
            callback()
          }
        })
      )
      await assertUnchanged()
      return result.hash
    },
    async extract(name, targetPath, expectedHash) {
      const stream = await openStream(name)
      if (!stream) throw new Error(`包内缺少离线文件：${name}`)
      const temporary = `${targetPath}.${crypto.randomUUID()}.tmp`
      let result
      try {
        await fsp.mkdir(path.dirname(targetPath), { recursive: true })
        await pipeline(
          stream,
          hashMeter(OFFLINE_PACK_MAX_ENTRY_BYTES, (value) => {
            result = value
          }),
          fs.createWriteStream(temporary, { flags: 'wx' })
        )
        if (expectedHash && result.hash !== expectedHash)
          throw new Error(`离线文件校验失败：${name}`)
        await assertUnchanged()
        await fsp.rename(temporary, targetPath)
      } finally {
        stream.destroy()
        await fsp.rm(temporary, { force: true })
      }
    }
  }
}

// Only small metadata stays in memory. Artifact checksums are calculated on the bytes sent to ZIP.
export async function createOfflinePackWriter(outputPath) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${crypto.randomUUID()}.tmp`
  const zip = archiver('zip', { zlib: { level: 6 }, forceZip64: true })
  const destination = fs.createWriteStream(temporary, { flags: 'wx' })
  const entries = new Map()
  let expandedBytes = 0
  let failure
  let rejectFailure
  const failed = new Promise((resolve, reject) => {
    rejectFailure = reject
  })
  failed.catch(() => {})
  const fail = (error) => {
    failure ||= error
    rejectFailure(error)
    zip.abort()
    destination.destroy(error)
  }
  zip.on('error', fail)
  zip.on('warning', fail)
  const writing = pipeline(zip, hashMeter(OFFLINE_PACK_MAX_PACKAGE_BYTES), destination)
  writing.catch(fail)
  const reserve = (name, size) => {
    if (failure) throw failure
    name = checkedName(name)
    if (entries.has(name)) throw new Error(`离线安装包条目重复：${name}`)
    expandedBytes += size
    if (
      size > OFFLINE_PACK_MAX_ENTRY_BYTES ||
      expandedBytes > OFFLINE_PACK_MAX_PACKAGE_BYTES ||
      entries.size >= OFFLINE_PACK_MAX_ENTRY_COUNT
    )
      throw limitError()
    entries.set(name, { entryName: name, uncompressedSize: size, isDirectory: false })
    return name
  }
  return {
    getEntries: () => [...entries.values()],
    addFile(name, buffer) {
      zip.append(buffer, { name: reserve(name, buffer.length) })
    },
    async addPath(name, sourcePath) {
      const before = await fsp.lstat(sourcePath)
      if (!before.isFile() || before.isSymbolicLink())
        throw new Error(`离线导出仅支持普通文件：${sourcePath}`)
      name = reserve(name, before.size)
      let result
      const meter = hashMeter(OFFLINE_PACK_MAX_ENTRY_BYTES, (value) => {
        result = value
      })
      const input = fs.createReadStream(sourcePath)
      zip.append(meter, { name, date: before.mtime })
      try {
        await Promise.race([pipeline(input, meter), failed])
        if (
          fingerprint(before) !== fingerprint(await fsp.lstat(sourcePath)) ||
          result.sizeBytes !== before.size
        ) {
          throw new Error('离线导出的源文件发生变化，请重试')
        }
        return result
      } catch (error) {
        input.destroy()
        meter.destroy()
        fail(error)
        throw error
      }
    },
    async finish() {
      await Promise.race([Promise.all([zip.finalize(), writing]), failed])
      const handle = await fsp.open(temporary, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fsp.rename(temporary, outputPath)
    },
    async abort() {
      zip.abort()
      destination.destroy()
      await finished(destination).catch(() => {})
      await fsp.rm(temporary, { force: true })
    }
  }
}

export async function listOfflinePackSourceFiles(root) {
  const files = []
  let bytes = 0
  const walk = async (directory, depth) => {
    if (depth > 64) throw new Error('离线导出目录层级过深')
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`离线导出目录包含链接：${entry.name}`)
      if (entry.isDirectory()) await walk(absolute, depth + 1)
      else if (entry.isFile()) {
        const stat = await fsp.lstat(absolute)
        bytes += stat.size
        if (files.length >= OFFLINE_PACK_MAX_ENTRY_COUNT || bytes > OFFLINE_PACK_MAX_ENTRY_BYTES)
          throw limitError()
        files.push({
          path: absolute,
          name: checkedName(path.relative(root, absolute)),
          sizeBytes: stat.size
        })
      } else throw new Error(`离线导出目录包含特殊文件：${entry.name}`)
    }
  }
  await walk(root, 0)
  return { files, sizeBytes: bytes }
}
