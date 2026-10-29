import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}
export const pathKey = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase()
export const hasControl = (value) => [...value].some((c) => c.charCodeAt(0) < 32)
export function isInside(root, target) {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}
export async function canonical(value, directory = false) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    hasControl(value) ||
    /^(\\\\|\/\/)/.test(value)
  ) {
    fail('invalid_path', '请选择本地绝对路径')
  }
  const real = await fs.realpath(value)
  const stat = await fs.stat(real)
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('invalid_path', '路径类型不正确')
  if (real === path.parse(real).root) fail('invalid_path', '不能选择整个磁盘')
  return real
}
export async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function fileHash(file) {
  try {
    return await hashFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
// No symlink/junction traversal inside a managed deployment or import tree.
export async function safeJoin(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes(':') ||
    hasControl(relative) ||
    relative.split(/[\\/]/).some((p) => !p || p === '.' || p === '..')
  )
    fail('path_escape', '组件路径不合法')
  const target = path.resolve(root, relative)
  try {
    if (pathKey(await fs.realpath(root)) !== pathKey(root))
      fail('path_link', '组件根目录经过链接重定向')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!isInside(root, target)) fail('path_escape', '组件路径超出允许目录')
  let cursor = root
  const roots = [root]
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part)
    roots.push(cursor)
  }
  for (const entry of roots) {
    try {
      if ((await fs.lstat(entry)).isSymbolicLink())
        fail('path_link', '不允许通过链接部署或读取组件')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return target
}
export async function atomicWrite(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temp, 'wx')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
