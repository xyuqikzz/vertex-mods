import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// This directory owns only public source display data. Installation metadata is never served from it.
export function createPublicSourceCache(rootDirectory) {
  let writing = Promise.resolve()
  const limits = { lists: 100 * 1024 * 1024, images: 200 * 1024 * 1024 }
  async function directory(kind) {
    if (!limits[kind]) throw new Error('invalid_cache_kind')
    const root = typeof rootDirectory === 'function' ? rootDirectory() : rootDirectory
    const target = path.join(root, kind)
    for (const item of [root, target]) {
      await fs.mkdir(item, { recursive: true })
      if ((await fs.lstat(item)).isSymbolicLink()) throw new Error('invalid_cache_directory')
    }
    return target
  }
  const hash = key => createHash('sha256').update(`v1:${key}`).digest('hex')
  async function get(kind, key) {
    try {
      const file = path.join(await directory(kind), `${hash(key)}.json`)
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12 * 1024 * 1024) return null
      const item = JSON.parse(await fs.readFile(file, 'utf8'))
      if (item.version !== 1 || !Number.isFinite(item.updatedAt) || Date.now() - item.updatedAt > 7 * 86400000) return null
      await fs.utimes(file, new Date(), new Date()).catch(() => {})
      return item
    } catch { return null }
  }
  function put(kind, key, payload) {
    const write = async () => {
      let temporary
      try {
        const dir = await directory(kind)
        const bytes = Buffer.from(JSON.stringify({ version: 1, updatedAt: Date.now(), payload }))
        if (bytes.length > 12 * 1024 * 1024) return
        temporary = path.join(dir, `${hash(key)}.${randomUUID()}.tmp`)
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        await fs.rename(temporary, path.join(dir, `${hash(key)}.json`))
        temporary = null
        const files = []
        for (const name of await fs.readdir(dir)) {
          if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
          const file = path.join(dir, name)
          const stat = await fs.lstat(file).catch(() => null)
          if (stat?.isFile() && !stat.isSymbolicLink()) files.push({ file, size: stat.size, time: stat.mtimeMs })
        }
        let size = files.reduce((total, file) => total + file.size, 0)
        for (const file of files.sort((a, b) => a.time - b.time)) {
          if (size <= limits[kind]) break
          await fs.unlink(file.file).catch(() => {})
          size -= file.size
        }
      } catch { /* Cache failure must not invalidate a successful upstream request. */ }
      finally { if (temporary) await fs.unlink(temporary).catch(() => {}) }
    }
    writing = writing.then(write, write)
    return writing
  }
  return { get, put }
}
