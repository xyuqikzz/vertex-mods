import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { fail, hashFile, safeJoin } from './files.js'

const HOSTS = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'reshade.me',
  'www.reshade.me'
])
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function normalizedEntry(value) {
  const name = value.replace(/\\/g, '/')
  if (name.startsWith('/') || name.includes(':') || name.split('/').includes('..'))
    fail('archive_path_escape', '压缩包包含越界路径')
  return name
}
export function readComponentArchive(bytes, format = 'zip') {
  if (format === 'sfx') {
    // ReShade's setup contains a ZIP with offsets relative to the ZIP, followed
    // by its certificate. Read that payload without executing the installer.
    const end = bytes.lastIndexOf(Buffer.from('504b0506', 'hex'))
    if (end < 0 || end + 22 > bytes.length) fail('invalid_archive', '未找到安装包中的组件压缩数据')
    const begin = end - bytes.readUInt32LE(end + 12) - bytes.readUInt32LE(end + 16)
    if (begin < 0 || begin > end) fail('invalid_archive', '组件压缩包偏移无效')
    bytes = bytes.subarray(begin)
  }
  const archive = new AdmZip(bytes),
    entries = new Map()
  for (const entry of archive.getEntries()) {
    const name = normalizedEntry(entry.entryName)
    if (entry.isDirectory) continue
    if (entries.has(name.toLowerCase())) fail('archive_duplicate', '压缩包存在重复文件路径')
    entries.set(name.toLowerCase(), entry)
  }
  return entries
}
async function request(url, signal, fetcher) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !HOSTS.has(parsed.hostname)
    )
      fail('component_source_rejected', '组件下载来源不在已审核范围内')
    const response = await fetcher(parsed.href, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'Vertex-DLSS-Components' }
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) fail('component_download_failed', '下载服务返回了无效重定向')
      url = new URL(location, parsed).href
    } else {
      if (!response.ok)
        fail(
          'component_download_failed',
          `组件下载失败（HTTP ${response.status}），可重试或使用本地导入`
        )
      return response
    }
  }
  fail('component_download_failed', '组件下载重定向次数过多')
}
async function downloadAttempt(
  source,
  cacheRoot,
  { signal, onProgress = () => {}, fetcher = fetch, timeoutMs = 600000 } = {}
) {
  signal?.throwIfAborted()
  await fs.mkdir(cacheRoot, { recursive: true })
  const target = await safeJoin(cacheRoot, source.sha256)
  try {
    if ((await hashFile(target)) === source.sha256) {
      const data = await fs.readFile(target)
      onProgress({ phase: 'cached', source: 'cache', received: data.length, total: data.length })
      return data
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const temp = await safeJoin(cacheRoot, `${source.sha256}.${randomUUID()}.part`)
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  let received = 0
  try {
    onProgress({ phase: 'downloading', received: 0, total: source.size || 0 })
    const response = await request(source.url, combined, fetcher)
    const expected =
      source.size ||
      (response.headers.get('content-encoding')
        ? 0
        : Number(response.headers.get('content-length'))) ||
      0
    if (expected > 512 * 1024 * 1024) fail('component_too_large', '组件包超出允许大小')
    const handle = await fs.open(temp, 'wx'),
      hash = createHash('sha256')
    try {
      for await (const chunk of response.body) {
        combined.throwIfAborted()
        received += chunk.length
        if (received > (source.size || 512 * 1024 * 1024))
          fail('component_too_large', '下载内容与锁定版本大小不符')
        hash.update(chunk)
        await handle.writeFile(chunk)
        onProgress({ phase: 'downloading', received, total: expected })
      }
      combined.throwIfAborted()
      await handle.sync()
    } finally {
      await handle.close()
    }
    onProgress({ phase: 'verifying', received, total: expected })
    if (hash.digest('hex') !== source.sha256)
      fail('component_checksum', '下载包 SHA-256 校验失败，未安装任何未验证文件')
    combined.throwIfAborted()
    await fs.rename(temp, target)
    onProgress({ phase: 'saved', received, total: received })
    return await fs.readFile(target)
  } catch (error) {
    if (signal?.aborted) fail('component_cancelled', '已取消组件准备，已验证的缓存可继续复用')
    if (error.name === 'TimeoutError') fail('component_timeout', '组件下载超时，可重试或本地导入')
    if (error instanceof TypeError)
      fail('component_network', '无法连接组件下载服务，请检查网络后重试或使用本地导入')
    throw error
  } finally {
    await fs.rm(temp, { force: true })
  }
}

export async function downloadVerified(source, cacheRoot, options = {}) {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3))
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()
    try {
      return await downloadAttempt(source, cacheRoot, options)
    } catch (error) {
      const transient =
        ['component_network', 'component_timeout'].includes(error.code) ||
        (error.code === 'component_download_failed' &&
          (error.status === 408 || error.status === 429 || error.status >= 500))
      if (!transient || attempt >= attempts || options.signal?.aborted) throw error
      options.onProgress?.({
        phase: 'downloading',
        received: 0,
        total: source.size || 0,
        message: '下载中断，正在重试（' + (attempt + 1) + '/' + attempts + '）'
      })
      await new Promise((resolve) => setTimeout(resolve, attempt * 400))
    }
  }
}
